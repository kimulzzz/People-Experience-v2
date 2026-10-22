// server/services/metricPartsService.js
// Composite SUMMARY metrics (v2.55.0). A metric with parts in px_metric_parts (seed: metric 7 "Day 1 Onboarding Satisfaction
// Index" = Meet and Greet Satisfaction / Welcome Session / Onboarding Survey Day 1 / Infrastructure & Application; metric 5
// "Candidate Experience Survey Score" = one part) is scored from the summary file the Admin uploads per part, not from
// per-respondent survey rows (those stay stored, unused for the score). Summary file (first sheet, or the sheet named "Pivot";
// a sheet named "Raw Data" is never read):
//   A Directorate | B Level | C Year | D Month | E <part score, 1-5> | F.. question columns | Jumlah Responden | Periode (...)
//   "CIMB Niaga" / Level "Bankwide" = the bankwide row; every other row is a directorate of the master (former names resolve);
//   several months may be stacked in one file. Score "-" (or Jumlah Responden 0) = no value for that row.
// Scoring (per period window: YTD = January .. the clock-capped end month, MTD = that month):
//   month value = the Bankwide row (no directorate filter) | the directorate's row | the respondent-weighted mean of several
//                 directorates (a USER scope / an Admin merge), per month;
//   part value  = the AVERAGE of its month values in the window (months without a value are not counted);
//   metric value = the AVERAGE of the parts that have a value (parts without data are N/A, not counted); 1-5 scale, the score
//                 is value / 5 x 100 (normalizeScore RATING_5). No part with a value -> NO_DATA.
// The original file is NOT kept (such files carry personal data in a "Raw Data" sheet): file name + SHA-256 + the stored rows
// are the audit trail; the evidence CSV lists the stored rows.
// v2.57.0 Summary Questions: a part with configured questions (part.questions, Admin Parameters -> Summary Questions) maps the
// file's question columns BY POSITION to them (like ESS, v2.50.0): the count must equal the configured count (metric 12: every event
// block = the event score column + the configured per-event questions), each stored question carries the configured text as `label`
// and the file's own header as `file_label`, SCALE columns must hold numbers on the part's scale, TEXT columns are free text (never
// scored). The upload keeps the configured set as columns.questions_snapshot; the stored rows keep the texts used at upload, so
// History / Evidence show them after the configuration changes (a period with more than one question set -> one line per question
// with a Question_Set column). part.questions null (not configured) = the v2.55.0 behaviour (the file's columns as they are).
const crypto = require('crypto');
const storage = require('../db/storage');
const { periodWindow } = require('../db/filterUtils');
const { buildResolver, nameKey } = require('../db/directoryNames');
const { colLetter, readFirstSheet, buildXlsx } = require('./xlsxUtils');
const { parseMonth, MONTH_NAMES } = require('./essSummaryService');
const { isEventPart, questionSetKey } = require('../db/partQuestions');

const QUESTIONS_MENU = 'Admin Parameters -> Summary Questions';

const PART_SCALE_MAX = 5;
const MAX_TEXT = 500;
const MONTH_SHORT = MONTH_NAMES.map(n => n.slice(0, 3));
const periodCode = (year, month) => `${year}-${String(month).padStart(2, '0')}`;
const periodLabel = (year, month) => `${MONTH_NAMES[month - 1]} ${year}`;
const keyOf = r => r.year * 100 + r.month;
const round4 = v => Math.round(v * 10000) / 10000;
const round8 = v => Math.round(v * 1e8) / 1e8; // stored part / event scores (px_metric_part_results.score DECIMAL(18,8))
const nowKeyOf = (now = new Date()) => now.getFullYear() * 100 + now.getMonth() + 1;

// ------------------------------------------------------------------ parts of the metrics
// Map metric_id -> its parts (sort order); a metric is a composite summary metric when it has at least one part.
function partsByMetric(parts) {
  const map = new Map();
  (parts || []).forEach(p => { if (!map.has(p.metric_id)) map.set(p.metric_id, []); map.get(p.metric_id).push(p); });
  map.forEach(list => list.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)));
  return map;
}

// ------------------------------------------------------------------ scoring
// A part's score scale: RATING_5 (1-5, score % = value / 5 x 100; default) or PERCENT (0-100, the value is the score;
// metric 12) - set in the part's template.score_scale.
const scaleOf = part => (part && part.template && String(part.template.score_scale || '').toUpperCase() === 'PERCENT' ? 'PERCENT' : 'RATING_5');
const scoreOf = (value, scale) => Math.round(Math.min(Math.max(scale === 'PERCENT' ? value : value / PART_SCALE_MAX * 100, 0), 100) * 100) / 100;
const scoreOfRow = r => r.score;
// respondents null = the file has no respondents column (metrics 19 / 20): the row counts, weight 1 (plain mean)
const hasValue = (r, pick = scoreOfRow) => { const v = pick(r); return v !== null && v !== undefined && (r.respondents === null || r.respondents === undefined || r.respondents > 0); };
const weightOf = r => (r.respondents === null || r.respondents === undefined ? 1 : r.respondents);
function poolRows(rows, pick = scoreOfRow) {
  const valued = rows.filter(r => hasValue(r, pick));
  if (!valued.length) return null;
  const n = valued.reduce((s, r) => s + weightOf(r), 0);
  const counted = valued.every(r => r.respondents !== null && r.respondents !== undefined);
  return { value: valued.reduce((s, r) => s + pick(r) * weightOf(r), 0) / n, respondents: counted ? n : 0 };
}
// The value of one month of one part for an org selection ({ directorates: null | [names] }), or null. pick = which value of a
// row (the part score; an event's score for the per-event averages).
function monthValue(rows, org, pick = scoreOfRow) {
  if (!org || !org.directorates) {
    const bank = rows.find(r => r.org_level === 'BANKWIDE');
    if (bank) return hasValue(bank, pick) ? { value: pick(bank), respondents: bank.respondents || 0 } : null;
    return poolRows(rows.filter(r => r.org_level === 'DIRECTORATE'), pick);
  }
  const wanted = new Set(org.directorates.map(nameKey));
  return poolRows(rows.filter(r => r.org_level === 'DIRECTORATE' && wanted.has(nameKey(r.directorate))), pick);
}
const rangeLabel = months => {
  if (!months.length) return null;
  const a = months[0];
  const b = months[months.length - 1];
  if (a.key === b.key) return `${MONTH_SHORT[a.month - 1]} ${a.year}`;
  if (a.year === b.year) return `${MONTH_SHORT[a.month - 1]}-${MONTH_SHORT[b.month - 1]} ${b.year}`;
  return `${MONTH_SHORT[a.month - 1]} ${a.year}-${MONTH_SHORT[b.month - 1]} ${b.year}`;
};
// The months (sorted) with a value for one pick: [{ key, year, month, value, respondents }]
function monthsWithValue(byMonth, org, pick) {
  return [...byMonth.keys()].sort((a, b) => a - b).map(k => {
    const v = monthValue(byMonth.get(k), org, pick);
    return v ? { key: k, year: Math.floor(k / 100), month: k % 100, value: v.value, respondents: v.respondents } : null;
  }).filter(Boolean);
}
const avgOf = months => (months.length ? months.reduce((s, m) => s + m.value, 0) / months.length : null);

/**
 * The composite value of one metric for a period ({ mode, year, month, endMonth }) and an org selection.
 * parts: the metric's parts; results: its summary rows (any part). Returns
 * { value (the parts' scale) | null, respondents, parts: [{ part_key, part_name, scale, value, score, has_data, months_count,
 *   months_label, months: [{ period, period_label, value, respondents }], events: [{ event, value, score, months_count }] }],
 *   parts_with_data, last_period }. events = the per-event averages of a part whose file has event columns (metric 12).
 */
function compositeValue(parts, results, mp, org) {
  const w = periodWindow(mp);
  const fromKey = w && w.from ? parseInt(w.from.slice(0, 4), 10) * 100 + parseInt(w.from.slice(5, 7), 10) : null;
  const toKey = w && w.to ? parseInt(w.to.slice(0, 4), 10) * 100 + parseInt(w.to.slice(5, 7), 10) : null;
  let respondents = 0;
  let lastKey = null;
  const outParts = (parts || []).map(p => {
    const scale = scaleOf(p);
    const byMonth = new Map();
    if (fromKey !== null) {
      (results || []).filter(r => r.part_key === p.part_key && keyOf(r) >= fromKey && keyOf(r) <= toKey).forEach(r => {
        if (!byMonth.has(keyOf(r))) byMonth.set(keyOf(r), []);
        byMonth.get(keyOf(r)).push(r);
      });
    }
    const months = monthsWithValue(byMonth, org, scoreOfRow);
    const value = avgOf(months);
    months.forEach(m => { respondents += m.respondents; if (lastKey === null || m.key > lastKey) lastKey = m.key; });
    const eventNames = [];
    [...byMonth.values()].flat().forEach(r => (r.questions || []).forEach(q => { if (q.is_event && !eventNames.includes(q.label)) eventNames.push(q.label); }));
    const events = eventNames.map(name => {
      const pick = r => { const q = (r.questions || []).find(x => x.is_event && x.label === name); return q && typeof q.value === 'number' ? q.value : null; };
      const em = monthsWithValue(byMonth, org, pick);
      const ev = avgOf(em);
      return { event: name, value: ev === null ? null : round4(ev), score: ev === null ? null : scoreOf(ev, scale), months_count: em.length };
    });
    return {
      part_key: p.part_key,
      part_name: p.part_name,
      scale,
      raw: value, // unrounded (the metric value averages these)
      value: value === null ? null : round4(value),
      score: value === null ? null : scoreOf(value, scale),
      has_data: value !== null,
      months_count: months.length,
      months_label: rangeLabel(months),
      months: months.map(m => ({ period: periodCode(m.year, m.month), period_label: periodLabel(m.year, m.month), value: round4(m.value), respondents: m.respondents })),
      events
    };
  });
  const withData = outParts.filter(p => p.has_data);
  const value = withData.length ? withData.reduce((s, p) => s + p.raw, 0) / withData.length : null;
  return {
    value,
    respondents,
    parts: outParts.map(({ raw, ...p }) => p), // eslint-disable-line no-unused-vars
    parts_with_data: withData.length,
    last_period: lastKey === null ? null : periodCode(Math.floor(lastKey / 100), lastKey % 100)
  };
}

// ------------------------------------------------------------------ .xlsx validation
const isBlank = c => !c || (c.type === 'empty' && !c.formulaWithoutValue);
const cellText = c => (isBlank(c) || c.value === null ? '' : String(c.value).trim());
const cellAt = (row, idx) => (row && row.cells[idx]) || { value: null, type: 'empty', formulaWithoutValue: false };
const NO_VALUE = ['', '-', String.fromCharCode(0x2013), String.fromCharCode(0x2014), 'n/a', 'na'];
const isNoValueText = t => NO_VALUE.includes(String(t).replace(/\s+/g, '').toLowerCase());
const isRespondentsHeader = t => /^(jumlah\s+respond[ae]n|respondents?\b|number of respondents)/i.test(String(t).trim());
const isPeriodHeader = t => /^(periode|period)\b/i.test(String(t).trim());
// an event column of a multi-event file (metric 12): its header is filled blue (FF0070C0)
const isEventFill = f => typeof f === 'string' && /0070C0$/i.test(f);
const isBankwideText = (dirText, levelText) => /^(pt\.?\s*bank\s+)?cimb\s+niaga\b/i.test(dirText) || /^bankwide$/i.test(levelText);
// An Excel date serial (e.g. 46174) -> 'YYYY-MM-DD'
const excelDate = n => new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10);

// A number cell or numeric text ("4,5"), or null when it is not a number
function numberOf(c) {
  if (c.type === 'number') return c.value;
  const t = cellText(c).replace(/\s+/g, '');
  if (/^-?\d+([.,]\d+)?$/.test(t)) return Number(t.replace(',', '.'));
  return null;
}

/**
 * The question / event columns of a header (index >= 5, not the respondents / period column). An event column (metric 12:
 * "EPICC Podcast", "Perspektif", ...) is found by its blue header fill; without fill information a header that occurs once,
 * followed by a header that repeats (the same question texts per event), is an event. Returns [{ idx, label, is_event, event }].
 */
function questionColumns(header, respCol, periodCol) {
  const lastCol = header.cells.reduce((mx, c, i) => (cellText(c) ? i : mx), -1);
  const cols = [];
  for (let i = 5; i <= lastCol; i++) if (i !== respCol && i !== periodCol) cols.push({ idx: i, label: cellText(cellAt(header, i)) || `Q${cols.length + 1}`, fill: cellAt(header, i).fill });
  const byFill = cols.some(c => isEventFill(c.fill));
  const counts = new Map();
  cols.forEach(c => counts.set(c.label, (counts.get(c.label) || 0) + 1));
  let event = null;
  return cols.map((c, i) => {
    const next = cols[i + 1];
    const isEvent = byFill ? isEventFill(c.fill) : (counts.get(c.label) === 1 && !!next && counts.get(next.label) > 1);
    if (isEvent) event = c.label;
    return { idx: c.idx, label: c.label, is_event: isEvent, event: isEvent ? c.label : event, filled_event: isEventFill(c.fill) };
  });
}

/**
 * v2.57.0: maps the question columns of a file BY POSITION to the configured questions of the part. cols = questionColumns(...);
 * questions = [{ key, text, type }]; eventPart = metric 12 layout (blocks of event score + per-event questions). Returns { cols }
 * (each with key / type / label = the configured text / file_label = the header) or { error }.
 */
function mapConfiguredColumns(cols, questions, eventPart) {
  const m = questions.length;
  const n = cols.length;
  const plural = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`;
  if (!eventPart) {
    if (n !== m) {
      return { error: `The file has ${plural(n, 'question column')} (after the score in column E), the configured template has ${plural(m, 'question')} - update the questions in ${QUESTIONS_MENU} or use the latest template.` };
    }
    return { cols: cols.map((c, i) => ({ idx: c.idx, label: questions[i].text, file_label: c.label, key: questions[i].key, type: questions[i].type, is_event: false, event: null })) };
  }
  const block = m + 1;
  if (!n || n % block !== 0) {
    return { error: `The file has ${plural(n, 'event / question column')}, which is not a whole number of event blocks of ${block} columns (the event score + the ${plural(m, 'configured per-event question')}) - update the questions in ${QUESTIONS_MENU} or use the latest template.` };
  }
  // a file with blue event headers: they must stand at the start of every block
  const misplaced = cols.find((c, i) => c.filled_event !== (i % block === 0));
  if (cols.some(c => c.filled_event) && misplaced) {
    return { error: `Column ${colLetter(misplaced.idx)} ("${String(misplaced.label).slice(0, 60)}"): the blue event headers do not line up with event blocks of ${block} columns (the event score + the ${plural(m, 'configured per-event question')}) - update the questions in ${QUESTIONS_MENU} or use the latest template.` };
  }
  let event = null;
  return {
    cols: cols.map((c, i) => {
      if (i % block === 0) { event = c.label; return { idx: c.idx, label: c.label, is_event: true, event: c.label }; }
      const q = questions[(i % block) - 1];
      return { idx: c.idx, label: q.text, file_label: c.label, key: q.key, type: q.type, is_event: false, event };
    })
  };
}

/**
 * Validates the summary sheet of a part. The header is row 1: A Directorate | B Level | C Year | D Month | E score (its header
 * text is only a label) | question (and event) columns | "Jumlah Responden ..." | "Periode ..." (in any order after E).
 * scale: RATING_5 (scores 1-5) | PERCENT (0-100). Returns { errors: [{ row_number, column, reason }], rows, columns, periods } -
 * nothing is stored here; any error refuses the whole file. Rows of a month after the current month are refused when they hold
 * a score; without a score they are skipped (the user's templates list the coming months with "-").
 */
function validatePartSheet(sheetRows, resolver, now = new Date(), { scale = 'RATING_5', scoreColumn = null, respondentsColumn = true, questions = null, eventPart = false } = {}) {
  const errors = [];
  const err = (row_number, column, reason) => errors.push({ row_number, column, reason });
  const fail = reason => { err(1, null, reason); return { errors, rows: [], columns: null, periods: [] }; };
  const header = sheetRows.find(r => r.row_number === 1);
  if (!header || header.cells.every(isBlank)) return fail('Row 1 must be the header: Directorate | Level | Year | Month | <score> | <questions ...> | Jumlah Responden | Periode.');
  const expect = [['directorate', 'direktorat'], ['level'], ['year', 'tahun'], ['month', 'bulan']];
  expect.forEach((names, i) => {
    const t = cellText(cellAt(header, i)).toLowerCase();
    if (!names.includes(t)) err(1, colLetter(i), `Column ${colLetter(i)} must be "${names[0][0].toUpperCase()}${names[0].slice(1)}" (found "${cellText(cellAt(header, i))}").`);
  });
  // score column: E, or (a combined file, metrics 19 / 20) the column whose header is the part's score_column (text match)
  const headerKey = t => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const scoreCol = scoreColumn ? header.cells.findIndex((c, i) => i >= 4 && headerKey(cellText(c)) === headerKey(scoreColumn)) : 4;
  if (scoreColumn && scoreCol < 0) err(1, null, `The header has no column "${scoreColumn}" (the score of this metric).`);
  const respCol = respondentsColumn === false ? -1 : header.cells.findIndex((c, i) => i >= 5 && isRespondentsHeader(cellText(c)));
  if (respondentsColumn !== false && respCol < 0) err(1, null, 'The header has no "Jumlah Responden" column (after the score in column E and the question columns).');
  if (errors.length) return { errors, rows: [], columns: null, periods: [] };
  const periodCol = scoreColumn ? -1 : header.cells.findIndex((c, i) => i >= 5 && i !== respCol && isPeriodHeader(cellText(c)));
  // a combined score table (score_column) has no question columns: the other columns belong to other metrics
  let qCols = scoreColumn ? [] : questionColumns(header, respCol, periodCol);
  // v2.57.0: configured questions -> by position (count checked)
  const configured = !scoreColumn && Array.isArray(questions);
  if (configured) {
    const mapped = mapConfiguredColumns(qCols, questions, eventPart);
    if (mapped.error) return fail(mapped.error);
    qCols = mapped.cols;
  }
  const columns = {
    score_label: cellText(cellAt(header, scoreCol)) || 'Score',
    question_labels: qCols.map(q => (q.file_label === undefined ? q.label : q.file_label)), // the file's own headers
    event_labels: qCols.filter(q => q.is_event).map(q => q.label),
    respondents_label: respCol >= 0 ? cellText(cellAt(header, respCol)) : null,
    period_label: periodCol >= 0 ? cellText(cellAt(header, periodCol)) : null,
    period_before_respondents: periodCol >= 0 && periodCol < respCol,
    score_scale: scale,
    ...(configured ? { questions_snapshot: questions.map(q => ({ key: q.key, text: q.text, type: q.type })) } : {})
  };
  const [minScore, maxScore] = scale === 'PERCENT' ? [0, 100] : [1, PART_SCALE_MAX];
  const scaleText = scale === 'PERCENT' ? 'a percentage from 0 to 100' : 'a number from 1 to 5';

  const limit = nowKeyOf(now);
  const out = [];
  const seen = new Map();
  sheetRows.filter(r => r.row_number > 1 && !r.cells.every(isBlank)).forEach(r => {
    const n = r.row_number;
    const before = errors.length;
    const dirText = cellText(cellAt(r, 0));
    const levelText = cellText(cellAt(r, 1));
    let orgLevel = null;
    let directorate = null;
    if (!dirText) err(n, 'A', 'Directorate is empty.');
    else if (isBankwideText(dirText, levelText)) orgLevel = 'BANKWIDE';
    else {
      directorate = resolver ? resolver.directorate(dirText.replace(/&amp;/gi, '&')) : null;
      if (!directorate) err(n, 'A', `Directorate "${dirText}" is not in the directorate master (nor a former name).`);
      else orgLevel = 'DIRECTORATE';
    }
    if (levelText && !/^(bankwide|directorate)$/i.test(levelText)) err(n, 'B', `Level must be "Bankwide" or "Directorate" (found "${levelText}").`);
    if (orgLevel === 'DIRECTORATE' && /^bankwide$/i.test(levelText)) err(n, 'B', 'Level "Bankwide" is only for the CIMB Niaga row.');
    const yc = cellAt(r, 2);
    const yn = numberOf(yc);
    const year = Number.isInteger(yn) && yn >= 2000 && yn <= 2100 ? yn : null;
    if (year === null) err(n, 'C', `Year must be a 4-digit year 2000-2100 (found "${cellText(yc)}").`);
    const mc = cellAt(r, 3);
    const month = isBlank(mc) ? null : parseMonth(mc);
    if (!month) err(n, 'D', `Month must be a month name (Jun, Sept, Oktober ...) or 1-12 (found "${cellText(mc)}").`);

    const scoreCell = (c, what, col) => {
      if (c.formulaWithoutValue) { err(n, col, `${what} is a formula without a saved value (open the file in Excel, save it and upload it again).`); return null; }
      if (c.type === 'error') { err(n, col, `${what} holds an Excel error (${c.value}).`); return null; }
      if (isBlank(c) || isNoValueText(cellText(c))) return null;
      const v = numberOf(c);
      if (v === null) { err(n, col, `${what} must be ${scaleText} or "-" (found "${cellText(c).slice(0, 30)}").`); return null; }
      if (v < minScore || v > maxScore) { err(n, col, `${what} must be ${scaleText} (found ${v}).`); return null; }
      return round8(v);
    };
    const score = scoreCell(cellAt(r, scoreCol), 'The score', colLetter(scoreCol));
    const rc = cellAt(r, respCol);
    let respondents = respCol < 0 ? null : 0;
    if (respCol >= 0 && !isBlank(rc) && !isNoValueText(cellText(rc))) {
      const v = numberOf(rc);
      if (v === null || !Number.isInteger(v) || v < 0) err(n, colLetter(respCol), `${columns.respondents_label} must be a whole number of 0 or more (found "${cellText(rc).slice(0, 30)}").`);
      else respondents = v;
    }
    const answers = qCols.map(({ idx, label, is_event: isEvent, event, key, type, file_label: fileLabel }) => {
      const c = cellAt(r, idx);
      const base = { ...(key ? { key } : {}), label, ...(fileLabel !== undefined ? { file_label: fileLabel } : {}), ...(type ? { type } : {}), ...(isEvent ? { is_event: true } : {}), ...(event ? { event } : {}) };
      if (isEvent) return { ...base, value: scoreCell(c, `The score of event "${label.slice(0, 40)}"`, colLetter(idx)) };
      if (type === 'SCALE') {
        // a configured Scale question: a number on the part's scale, or "-" / empty
        if (!c.formulaWithoutValue && c.type !== 'error' && !isBlank(c) && !isNoValueText(cellText(c)) && numberOf(c) === null) {
          err(n, colLetter(idx), `"${label.slice(0, 60)}" is a Scale question (${scaleText}), found the text "${cellText(c).slice(0, 30)}" - if it is a free-text answer, set its type to Text in ${QUESTIONS_MENU}.`);
          return { ...base, value: null };
        }
        const v = scoreCell(c, `"${label.slice(0, 60)}"`, colLetter(idx));
        return { ...base, value: v === null ? null : round4(v) };
      }
      if (type === 'TEXT') {
        if (c.formulaWithoutValue) { err(n, colLetter(idx), `"${label.slice(0, 60)}" is a formula without a saved value.`); return { ...base, value: null }; }
        if (c.type === 'error') { err(n, colLetter(idx), `"${label.slice(0, 60)}" holds an Excel error (${c.value}).`); return { ...base, value: null }; }
        if (isBlank(c) || isNoValueText(cellText(c))) return { ...base, value: null };
        return { ...base, value: cellText(c).slice(0, MAX_TEXT) }; // a free-text answer - evidence only, never scored
      }
      if (c.formulaWithoutValue) { err(n, colLetter(idx), `"${label.slice(0, 60)}" is a formula without a saved value.`); return { ...base, value: null }; }
      if (c.type === 'error') { err(n, colLetter(idx), `"${label.slice(0, 60)}" holds an Excel error (${c.value}).`); return { ...base, value: null }; }
      if (isBlank(c) || isNoValueText(cellText(c))) return { ...base, value: null };
      if (c.type === 'number') return { ...base, value: round4(c.value) };
      return { ...base, value: cellText(c).slice(0, MAX_TEXT) }; // a text answer (e.g. "Suitable role") - evidence only
    });
    let periodText = null;
    if (periodCol >= 0) {
      const pc = cellAt(r, periodCol);
      if (pc.type === 'number' && pc.value > 20000 && pc.value < 80000) periodText = excelDate(pc.value);
      else if (!isBlank(pc)) periodText = cellText(pc).slice(0, 100);
    }
    if (errors.length > before || !orgLevel || year === null || !month) return;
    const key = year * 100 + month;
    if (key > limit) {
      if (score !== null) err(n, 'D', `${periodLabel(year, month)} is in the future - only months up to ${periodLabel(Math.floor(limit / 100), limit % 100)} can hold a score (use "-").`);
      return; // a coming month without a score is skipped
    }
    const dupKey = `${key}|${orgLevel === 'BANKWIDE' ? '__BANKWIDE__' : nameKey(directorate)}`;
    if (seen.has(dupKey)) { err(n, 'A', `${orgLevel === 'BANKWIDE' ? 'The Bankwide row' : `Directorate "${directorate}"`} of ${periodLabel(year, month)} appears more than once (rows ${seen.get(dupKey)} and ${n}).`); return; }
    seen.set(dupKey, n);
    out.push({ row_number: n, org_level: orgLevel, directorate, year, month, score, respondents, questions: answers, period_text: periodText });
  });
  if (!errors.length && !out.length) err(null, null, 'The sheet has no data row up to the current month (row 2 onward: the Bankwide row and one row per directorate per month).');
  const periods = [...new Set(out.map(r => periodCode(r.year, r.month)))].sort();
  return { errors, rows: errors.length ? [] : out, columns, periods: errors.length ? [] : periods };
}

// ------------------------------------------------------------------ import
async function importPartXlsx(buffer, fileName, metric, part, { uploadedBy, now = new Date() } = {}) {
  let sheetRows;
  try {
    sheetRows = await readFirstSheet(buffer, { preferSheet: 'Pivot', refuseSheet: /^\s*raw\s*data\s*$/i, withFill: true });
  } catch (e) {
    return { success: false, status: 400, error: e.message, errors: [{ row_number: null, column: null, reason: e.message }] };
  }
  const resolver = buildResolver(await storage.getDirectorates(), await storage.getDirectoryAliases());
  const tpl = part.template || {};
  const v = validatePartSheet(sheetRows, resolver, now, {
    scale: scaleOf(part), scoreColumn: tpl.score_column || null, respondentsColumn: tpl.respondents_column !== false,
    questions: Array.isArray(part.questions) ? part.questions : null, eventPart: isEventPart(part)
  });
  if (v.errors.length) {
    return { success: false, status: 400, error: `The file was refused (${v.errors.length} error${v.errors.length === 1 ? '' : 's'}); nothing was stored.`, errors: v.errors };
  }
  const uploadId = `mp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const saved = await storage.saveMetricPartUpload({
    upload_id: uploadId, metric_id: metric.metric_id, part_key: part.part_key, file_name: String(fileName || 'summary.xlsx').slice(0, 260),
    file_sha256: crypto.createHash('sha256').update(buffer).digest('hex'), uploaded_by: uploadedBy || 'HR Admin', periods: v.periods, columns: v.columns
  }, v.rows);
  const bank = v.periods.map(p => {
    const mv = monthValue(v.rows.filter(r => periodCode(r.year, r.month) === p), null);
    return { period: p, period_label: periodLabel(parseInt(p.slice(0, 4), 10), parseInt(p.slice(5, 7), 10)), value: mv ? round4(mv.value) : null, respondents: mv ? mv.respondents : 0 };
  });
  return {
    success: true,
    status: 200,
    upload_id: uploadId,
    metric_id: metric.metric_id,
    part_key: part.part_key,
    part_name: part.part_name,
    file_name: fileName,
    rows_imported: v.rows.length,
    replaced_rows: saved.replaced,
    periods: v.periods,
    bankwide_by_month: bank,
    columns: v.columns,
    errors: [],
    message: `${part.part_name}: ${v.rows.length} summary rows stored for ${bank.map(b => b.period_label).join(', ')}${saved.replaced ? ` (${saved.replaced} earlier rows of these months replaced)` : ''}.`
  };
}

// ------------------------------------------------------------------ template
// The part's file layout: v2.57.0 the configured questions (Summary Questions; metric 12: one block per event of its latest upload /
// template = the event + the configured per-event questions); a part without configured questions keeps the v2.55.0 layout: the
// columns of its latest upload, else its seeded template, else the generic Q1..Q3 layout. One Bankwide row ("CIMB Niaga") + one row
// per directorate for the last complete month, values left empty.
async function generatePartTemplateXlsx(metric, part, now = new Date()) {
  const latest = (await storage.getMetricPartUploads(metric.metric_id, part.part_key))[0];
  const cols = (latest && latest.columns) || part.template || {};
  let questions = cols.question_labels && (cols.question_labels.length || (part.template && part.template.score_column)) ? cols.question_labels : ['Q1', 'Q2', 'Q3'];
  if (Array.isArray(part.questions) && !(part.template && part.template.score_column)) {
    const texts = part.questions.map(q => q.text);
    if (isEventPart(part)) {
      const events = latest && latest.columns && Array.isArray(latest.columns.event_labels) && latest.columns.event_labels.length ? latest.columns.event_labels : part.template.event_labels;
      questions = events.flatMap(e => [e, ...texts]);
    } else questions = texts;
  }
  const resp = cols.respondents_label || 'Jumlah Responden';
  const period = cols.period_label || 'Periode';
  const y = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const m = now.getMonth() === 0 ? 12 : now.getMonth();
  const scoreTable = !!(part.template && part.template.score_column); // metrics 19 / 20: Directorate | Level | Year | Month | <score>
  const header = scoreTable ? ['Directorate', 'Level', 'Year', 'Month', part.template.score_column]
    : ['Directorate', 'Level', 'Year', 'Month', cols.score_label || part.part_name, ...questions, ...(cols.period_before_respondents ? [period, resp] : [resp, period])];
  const dirs = (await storage.getDirectorates()).map(d => d.directorate_name);
  const rows = [header, ['CIMB Niaga', 'Bankwide', y, MONTH_SHORT[m - 1]], ...dirs.map(d => [d, 'Directorate', y, MONTH_SHORT[m - 1]])];
  return buildXlsx(rows, { sheetName: 'Pivot', colWidths: [36, 12, 8, 8, 16, ...questions.map(() => 18), 18, 18] });
}

// ------------------------------------------------------------------ evidence (CSV)
const csvCell = val => {
  if (val === null || val === undefined) return '';
  let str = String(val);
  if (typeof val === 'string' && str !== '-' && /^[=+\-@\t\r]/.test(str) && !/^[+-]?\d+([.,]\d+)?$/.test(str)) str = `'${str}`;
  if (/[",\r\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
};
const BOM = String.fromCharCode(0xFEFF);
const toCsv = (headers, rows) => BOM + [headers, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
const dash = v => (v === null || v === undefined ? '-' : v);

/**
 * Evidence of one part: every stored row of the period (mp = { all: true } | { mode, year, month }). A part without event
 * columns: one line per row with every question column (header text of the upload). A part with event columns (metric 12):
 * one line per row, event and question (Event | Question | Value).
 * v2.56.0: the TABLE first - the evidence CSV and the History tab of the metric detail are both built from it, so they cannot
 * disagree. Returns { fileName, headers, rows (arrays), sortKeys (YYYYMM per row), identity: [] }.
 */
// The question texts a stored row was uploaded with (an event row: the questions of its first event block) - its question set
function rowQuestionTexts(r) {
  const qs = r.questions || [];
  const first = qs.findIndex(q => q.is_event);
  if (first < 0) return qs.map(q => q.label);
  const out = [];
  for (let i = first + 1; i < qs.length && !qs[i].is_event; i++) out.push(qs[i].label);
  return out;
}
const rowSetKey = r => questionSetKey(rowQuestionTexts(r).map(text => ({ text })));

async function partEvidenceTable(metric, part, mp) {
  const w = mp.all ? null : periodWindow(mp);
  const inside = r => {
    if (mp.all) return true;
    if (!w || !w.from) return false;
    const k = keyOf(r);
    return k >= parseInt(w.from.slice(0, 4), 10) * 100 + parseInt(w.from.slice(5, 7), 10) && k <= parseInt(w.to.slice(0, 4), 10) * 100 + parseInt(w.to.slice(5, 7), 10);
  };
  const allRows = await storage.getMetricPartResults(metric.metric_id, part.part_key);
  const rows = allRows.filter(inside);
  // v2.57.0: the question sets, numbered in upload order over every stored row of the part (Set 1 = the oldest)
  const setNo = new Map();
  allRows.slice().sort((a, b) => (String(a.created_at) < String(b.created_at) ? -1 : String(a.created_at) > String(b.created_at) ? 1 : (a.result_id || 0) - (b.result_id || 0)))
    .forEach(r => { const k = rowSetKey(r); if (!setNo.has(k)) setNo.set(k, setNo.size + 1); });
  const setOf = r => setNo.get(rowSetKey(r));
  const setsInPeriod = [...new Set(rows.map(setOf))].sort((a, b) => a - b);
  const changed = setsInPeriod.length > 1;
  const note = changed
    ? `${part.part_name}: the questions changed within this period (${setsInPeriod.map(x => `Set ${x}`).join(', ')}) - every line shows the question text used at upload (column Question Set).`
    : null;
  const uploads = new Map((await storage.getMetricPartUploads(metric.metric_id, part.part_key)).map(u => [u.upload_id, u]));
  const tag = mp.all ? 'ALL' : (String(mp.mode).toUpperCase() === 'MTD' ? `${mp.year}-${mp.month}` : `YTD_${mp.year}`);
  const lead = r => [metric.metric_id, metric.metric_name, part.part_name, r.org_level === 'BANKWIDE' ? 'CIMB Niaga' : r.directorate,
    r.org_level === 'BANKWIDE' ? 'Bankwide' : 'Directorate', r.year, MONTH_NAMES[r.month - 1], periodCode(r.year, r.month), dash(r.score)];
  const tail = r => {
    const u = uploads.get(r.upload_id) || {};
    return [r.respondents === null || r.respondents === undefined ? '' : r.respondents, r.period_text || '', hasValue(r) ? 'YES' : 'NO', r.upload_id || '', u.file_name || '', u.file_sha256 || '', u.uploaded_by || '', u.uploaded_at || r.created_at || ''];
  };
  const TAIL = ['Jumlah_Responden', 'Periode', 'Has_Value', 'Upload_ID', 'File_Name', 'File_SHA256', 'Uploaded_By', 'Uploaded_At'];
  const LEAD = ['Metric_ID', 'Metric_Name', 'Part', 'Directorate', 'Level', 'Year', 'Month', 'Period', 'Part_Score'];
  const fileName = `Evidence_Metric_${metric.metric_id}_${part.part_key}_${tag}.csv`;
  const setCol = changed ? ['Question_Set'] : [];
  const setCell = r => (changed ? [`Set ${setOf(r)}`] : []);
  if (rows.some(r => (r.questions || []).some(q => q.is_event))) {
    const body = [];
    const sortKeys = [];
    rows.forEach(r => (r.questions || []).forEach(q => { body.push([...lead(r), ...setCell(r), q.event || '', q.is_event ? '(event score)' : q.label, dash(q.value), ...tail(r)]); sortKeys.push(keyOf(r)); }));
    return { fileName, headers: [...LEAD, ...setCol, 'Event', 'Question', 'Value', ...TAIL], rows: body, sortKeys, identity: [], note };
  }
  if (changed) {
    // several question sets in the period: one line per row and question, each with the text it was uploaded with
    const body = [];
    const sortKeys = [];
    rows.forEach(r => (r.questions || []).forEach((q, i) => {
      body.push([...lead(r), ...setCell(r), i + 1, q.label, q.file_label === undefined ? q.label : q.file_label, dash(q.value), ...tail(r)]);
      sortKeys.push(keyOf(r));
    }));
    return { fileName, headers: [...LEAD, ...setCol, 'Question_No', 'Question', 'File_Header', 'Value', ...TAIL], rows: body, sortKeys, identity: [], note };
  }
  const qCount = rows.reduce((mx, r) => Math.max(mx, (r.questions || []).length), 0);
  const labels = Array.from({ length: qCount }, (_, i) => ((rows.find(r => r.questions && r.questions[i]) || { questions: [{}] }).questions[i] || {}).label || `Q${i + 1}`);
  const body = rows.map(r => [...lead(r), ...Array.from({ length: qCount }, (_, i) => dash(((r.questions || [])[i] || {}).value)), ...tail(r)]);
  return { fileName, headers: [...LEAD, ...labels, ...TAIL], rows: body, sortKeys: rows.map(keyOf), identity: [], note };
}

// Evidence CSV of one part for a parsed period: { fileName, csv } (built from partEvidenceTable, like the History tab)
async function generatePartEvidence(metric, part, mp) {
  const t = await partEvidenceTable(metric, part, mp);
  return { fileName: t.fileName, csv: toCsv(t.headers, t.rows) };
}

module.exports = {
  PART_SCALE_MAX,
  scaleOf,
  partsByMetric,
  monthValue,
  compositeValue,
  questionColumns,
  mapConfiguredColumns,
  validatePartSheet,
  importPartXlsx,
  generatePartTemplateXlsx,
  partEvidenceTable,
  generatePartEvidence
};
