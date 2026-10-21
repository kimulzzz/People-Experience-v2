// server/services/essSummaryService.js
// ESS (Employee Sentiment Survey) SUMMARY upload (v2.32.0). An ESS metric no longer takes per-respondent
// CSV rows: the PIC uploads the ESS result summary as an .xlsx (one row per org unit), e.g.
//   A Directorate | B Level | C Year | D Month | E Participation | F <Index name> | G.. one column per question
//   PT Bank CIMB Niaga Tbk | Bankwide | 2025 | November | 7756 | 0.92 | 0.96 | 0.9 | 0.9
//   Business Banking       | Directorate | 2025 | November | 449 | 0.91 | ...
// The row whose Directorate starts with "PT Bank CIMB Niaga" (or Level = Bankwide) is the bankwide result; every
// other row must be a directorate of the master. Scores may be fractions (0-1) or percentages (0-100).
// v2.50.0: the question columns are mapped BY POSITION to the questions configured in Manage Questions (G = question 1,
// H = question 2, ...); the header text of the file is ignored for mapping and display (kept as file_label for audit).
// Every stored question carries the snapshot { key, label, text, type, order } of the moment of upload.
// The .xlsx reader/writer lives in xlsxUtils.js (shared with the Exit Interview upload). This file holds the
// validation + import, the template, the evidence CSV and the "which ESS result applies" rules of the engine.
const fs = require('fs');
const path = require('path');
const storage = require('../db/storage');
const { ytdEndMonth } = require('../db/filterUtils');
const { buildResolver } = require('../db/directoryNames');
const { snapshotQuestions } = require('./metricQuestionService');
const { groupByQuestionSet, buildVersionedZip } = require('./evidenceVersions');

// Original uploaded files are kept for the audit trail OUTSIDE server/uploads (which is served to every login).
const ESS_UPLOAD_DIR = path.join(__dirname, '..', 'data', 'ess-uploads');

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// English + Indonesian month names and their 3-letter abbreviations -> month number.
const MONTH_LOOKUP = (() => {
  const id = ['januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli', 'agustus', 'september', 'oktober', 'november', 'desember'];
  const extra = { sept: 9, agu: 8, ags: 8, okt: 10, des: 12, mei: 5 };
  const map = { ...extra };
  MONTH_NAMES.forEach((n, i) => { map[n.toLowerCase()] = i + 1; map[n.slice(0, 3).toLowerCase()] = i + 1; });
  id.forEach((n, i) => { map[n] = i + 1; map[n.slice(0, 3)] = i + 1; });
  return map;
})();

const HEADER_NAMES = [
  ['directorate', 'direktorat'],
  ['level'],
  ['year', 'tahun'],
  ['month', 'bulan'],
  ['participation', 'partisipasi']
];
const COLUMN_TITLES = ['Directorate', 'Level', 'Year', 'Month', 'Participation'];
const BANKWIDE_NAME = 'PT Bank CIMB Niaga Tbk';

const periodLabel = (year, month) => `${MONTH_NAMES[month - 1] || month} ${year}`;
const periodCode = (year, month) => `${year}-${String(month).padStart(2, '0')}`;
const round4 = v => Math.round(v * 10000) / 10000;
// "Role Clarity & DS Support Score Index (ESS)" -> "Role Clarity & DS Support Score Index"
const indexTitle = metric => String(metric.metric_name || '').replace(/\s*\(ESS\)\s*$/i, '').trim();

const { colLetter, readFirstSheet, buildXlsx } = require('./xlsxUtils');

// ------------------------------------------------------------------ validation
const cellAt = (row, idx) => (row && row.cells[idx]) || { value: null, type: 'empty', formulaWithoutValue: false };
const isBlank = c => !c || (c.type === 'empty' && !c.formulaWithoutValue);
const cellText = c => (isBlank(c) || c.value === null ? '' : String(c.value).trim());
const canonicalDir = name => String(name || '').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim().toLowerCase();
const isBankwideRow = (dirText, levelText) => /^pt\.?\s*bank\s+cimb\s+niaga/i.test(dirText) || levelText.toLowerCase() === 'bankwide';

// A score cell -> percentage (0-100) | { error }. Fractions 0-1 are multiplied by 100, values above 1 up to 100 are
// already percentages; "92%" text is a percentage too.
function parseScore(c) {
  if (c.formulaWithoutValue) return { error: 'is a formula without a saved value (open the file in Excel, save it, and upload it again)' };
  if (c.type === 'error') return { error: `holds an Excel error (${c.value})` };
  let num;
  let isPercentText = false;
  if (c.type === 'number') num = c.value;
  else {
    const text = cellText(c);
    isPercentText = /%\s*$/.test(text);
    num = Number(text.replace(/%\s*$/, '').replace(',', '.').trim());
  }
  if (!Number.isFinite(num)) return { error: `is not a number (${cellText(c)})` };
  let pct;
  if (isPercentText) pct = num;
  else if (num >= 0 && num <= 1) pct = num * 100;
  else if (num > 1 && num <= 100) pct = num;
  else return { error: `(${num}) must be a fraction 0-1 or a percentage 0-100` };
  if (pct < 0 || pct > 100) return { error: `(${num}) must be a fraction 0-1 or a percentage 0-100` };
  return { value: round4(pct) };
}

function parseMonth(c) {
  if (c.type === 'number') return Number.isInteger(c.value) && c.value >= 1 && c.value <= 12 ? c.value : null;
  const text = cellText(c).toLowerCase().replace(/\.$/, '');
  if (/^\d{1,2}$/.test(text)) { const n = parseInt(text, 10); return n >= 1 && n <= 12 ? n : null; }
  return MONTH_LOOKUP[text] || null;
}
function parseIntCell(c) {
  if (c.formulaWithoutValue) return null;
  if (c.type === 'number') return Number.isInteger(c.value) ? c.value : null;
  const text = cellText(c);
  return /^\d+$/.test(text) ? parseInt(text, 10) : null;
}

// The scorable questions of an ESS metric as configured in Manage Questions (display order). FREE_TEXT has no score.
async function configuredEssQuestions(metricId) {
  return (await storage.getSurveyQuestions(metricId)).filter(q => (q.type || 'SCALE_1_5') !== 'FREE_TEXT');
}

/**
 * Validates parsed sheet rows against the ESS summary layout and the directorate master.
 * configuredQuestions (v2.50.0): the metric's scorable questions in Manage Questions order. The question columns that
 * carry values (G up to the last column with a value in any data row) must be exactly that many; column G = question 1.
 * Returns { errors: [{ row_number, column, reason }], rows, period: { year, month } | null, index_label, question_labels,
 * file_question_labels }. Nothing is stored here; any error means the whole file is refused.
 */
function validateEssSheet(sheetRows, directorates, configuredQuestions = [], resolver = null) {
  const errors = [];
  const err = (row_number, column, reason) => errors.push({ row_number, column, reason });
  const header = sheetRows.find(r => r.row_number === 1);
  if (!header || header.cells.every(isBlank)) {
    err(1, null, 'Row 1 must be the header: Directorate | Level | Year | Month | Participation | <Index name> | <question columns ...>.');
    return { errors, rows: [], period: null, index_label: null, question_labels: [], file_question_labels: [] };
  }
  HEADER_NAMES.forEach((names, idx) => {
    const text = cellText(cellAt(header, idx)).toLowerCase();
    if (!names.includes(text)) err(1, colLetter(idx), `Column ${colLetter(idx)} must be "${COLUMN_TITLES[idx]}" (found "${cellText(cellAt(header, idx))}").`);
  });
  const indexLabel = cellText(cellAt(header, 5));
  if (!indexLabel) err(1, 'F', 'Column F must hold the index name (e.g. "Role Clarity & DS Support Index") and the index score in every row.');

  const dirByKey = new Map((directorates || []).map(d => [canonicalDir(d.directorate_name), d.directorate_name]));
  const dataRows = sheetRows.filter(r => r.row_number > 1 && !r.cells.every(isBlank));
  if (!dataRows.length) err(null, null, 'The sheet has no data rows (row 2 onward must hold the Bankwide row and one row per directorate).');

  // question columns = G up to the last column holding a value in any data row, mapped by position to the configured
  // questions (the header text is not used for mapping); their number must equal the number of configured questions
  const lastValueCol = dataRows.reduce((mx, r) => {
    for (let i = r.cells.length - 1; i >= 6; i--) if (!isBlank(cellAt(r, i))) return Math.max(mx, i);
    return mx;
  }, 5);
  const found = lastValueCol - 5;
  const expected = configuredQuestions.length;
  if (found !== expected) {
    err(1, found > 0 ? `G-${colLetter(lastValueCol)}` : 'G', `The file has ${found} question column${found === 1 ? '' : 's'} with values${found > 0 ? ` (G-${colLetter(lastValueCol)})` : ''}, but ${expected} question${expected === 1 ? ' is' : 's are'} configured for this metric in Manage Questions. Column G must hold question 1, H question 2, and so on - download the current template.`);
  }
  const questionCols = configuredQuestions.map((q, i) => ({ idx: 6 + i, q, fileLabel: cellText(cellAt(header, 6 + i)) || null }));

  const out = [];
  const seen = new Map();
  let period = null;
  dataRows.forEach(r => {
    const n = r.row_number;
    const before = errors.length;
    const dirText = cellText(cellAt(r, 0));
    const levelText = cellText(cellAt(r, 1));
    let orgLevel = null;
    let directorate = null;
    if (!dirText) err(n, 'A', 'Directorate is empty.');
    else if (isBankwideRow(dirText, levelText)) orgLevel = 'BANKWIDE';
    else {
      // v2.51.0: a former name (renamed / merged directorate, seed rename) maps to the current directorate
      directorate = dirByKey.get(canonicalDir(dirText)) || (resolver ? resolver.directorate(dirText.replace(/&amp;/gi, '&')) : null) || null;
      if (!directorate) err(n, 'A', `Directorate "${dirText}" is not in the directorate master.`);
      else orgLevel = 'DIRECTORATE';
    }
    if (levelText && !['bankwide', 'directorate'].includes(levelText.toLowerCase())) err(n, 'B', `Level must be "Bankwide" or "Directorate" (found "${levelText}").`);
    if (orgLevel === 'DIRECTORATE' && levelText.toLowerCase() === 'bankwide') err(n, 'B', 'Level "Bankwide" is only for the PT Bank CIMB Niaga row.');

    const yearCell = cellAt(r, 2);
    const year = parseIntCell(yearCell);
    if (year === null || year < 2000 || year > 2100) err(n, 'C', `Year must be a whole number between 2000 and 2100 (found "${cellText(yearCell)}").`);
    const monthCell = cellAt(r, 3);
    const month = parseMonth(monthCell);
    if (!month) err(n, 'D', `Month must be a month name (e.g. November) or a number 1-12 (found "${cellText(monthCell)}").`);
    if (year !== null && year >= 2000 && year <= 2100 && month) {
      if (!period) period = { year, month, row_number: n };
      else if (period.year !== year || period.month !== month) err(n, 'C', `Every row must have the same Year and Month: row ${period.row_number} is ${periodLabel(period.year, period.month)}, this row is ${periodLabel(year, month)}.`);
    }
    const partCell = cellAt(r, 4);
    const participation = parseIntCell(partCell);
    if (participation === null || participation < 0) err(n, 'E', `Participation must be a whole number of 0 or more (found "${cellText(partCell)}").`);

    const fCell = cellAt(r, 5);
    let indexScore = null;
    if (isBlank(fCell)) err(n, 'F', 'The index score (column F) is empty.');
    else {
      const p = parseScore(fCell);
      if (p.error) err(n, 'F', `The index score ${p.error}.`); else indexScore = p.value;
    }
    const questions = [];
    questionCols.forEach(({ idx, q, fileLabel }, i) => {
      const snap = { ...snapshotQuestions([q])[0], order: i + 1, file_label: fileLabel };
      const c = cellAt(r, idx);
      if (isBlank(c)) { questions.push({ ...snap, score: null }); return; }
      const p = parseScore(c);
      if (p.error) err(n, colLetter(idx), `The score of question ${i + 1} ("${String(q.text || q.label || '').slice(0, 60)}") ${p.error}.`);
      else questions.push({ ...snap, score: p.value });
    });

    if (orgLevel) {
      const key = orgLevel === 'BANKWIDE' ? '__BANKWIDE__' : directorate;
      if (seen.has(key)) err(n, 'A', `${orgLevel === 'BANKWIDE' ? 'The Bankwide row' : `Directorate "${directorate}"`} appears more than once (rows ${seen.get(key)} and ${n}).`);
      else seen.set(key, n);
    }
    if (errors.length === before) {
      out.push({ row_number: n, org_level: orgLevel, directorate, participation, index_score: indexScore, questions });
    }
  });

  return {
    errors,
    rows: errors.length ? [] : out,
    period: period ? { year: period.year, month: period.month } : null,
    index_label: indexLabel || null,
    question_labels: questionCols.map(c => c.q.text || c.q.label),
    file_question_labels: questionCols.map(c => c.fileLabel)
  };
}

// ------------------------------------------------------------------ result selection (used by the engine)
// Participation-weighted mean of rows (plain mean when nobody participated). Question scores are pooled per POSITION
// (v2.50.0; the rows of one period come from one upload, so position i is the same question in every row).
function poolRows(rows) {
  const totalPart = rows.reduce((s, r) => s + (r.participation || 0), 0);
  const weightOf = r => (totalPart > 0 ? (r.participation || 0) : 1);
  const totalWeight = rows.reduce((s, r) => s + weightOf(r), 0);
  const index = totalWeight > 0 ? rows.reduce((s, r) => s + r.index_score * weightOf(r), 0) / totalWeight : 0;
  const count = rows.reduce((mx, r) => Math.max(mx, (r.questions || []).length), 0);
  const questions = Array.from({ length: count }, (_, i) => {
    let sum = 0;
    let w = 0;
    let first = null;
    rows.forEach(r => {
      const q = (r.questions || [])[i];
      if (q && !first) first = q;
      if (q && q.score !== null && q.score !== undefined) { sum += q.score * weightOf(r); w += weightOf(r); }
    });
    return { ...(first || {}), score: w > 0 ? round4(sum / w) : null };
  });
  return { index: round4(index), participation: totalPart, questions };
}

/**
 * The last month (key year*100+month) an ESS result may come from for a period (v2.50.0): the period's end - MTD Y-M =
 * Y-M, YTD Y = the clock-capped YTD end month - or null when the period has not started yet (a future month or year).
 */
function essPeriodEndKey(period) {
  const y = parseInt(period.year, 10);
  if (!/^\d{4}$/.test(String(period.year)) || !Number.isFinite(y)) return null;
  const now = new Date();
  const nowKey = now.getFullYear() * 100 + now.getMonth() + 1;
  if (String(period.mode || 'YTD').toUpperCase() === 'MTD') {
    const m = parseInt(period.month, 10);
    if (!(m >= 1 && m <= 12)) return null;
    return y * 100 + m > nowKey ? null : y * 100 + m;
  }
  const end = ytdEndMonth(String(period.year), period.endMonth);
  return end >= 1 && end <= 12 ? y * 100 + end : null;
}

/**
 * Which ESS result applies to one metric for a period + org selection (v2.50.0: carry-forward; replaces the exact-month
 * rule of v2.37.0). ESS runs once a year (November), so every period - YTD or MTD - reads the LATEST result whose
 * (year, month) is on or before the period's end, from any earlier year: 2026 reads November 2025 until a 2026 result
 * is uploaded. No result on or before the end, or a period that has not started yet -> null (NO_DATA).
 *   results   : every ESS result row (all metrics) - fetched once per calculation
 *   period    : { mode, year, month, endMonth }
 *   org       : { directorates: null | [names] }  null = bankwide (no directorate filter)
 * Returns null (no data) or { year, month, period, period_label, carried_forward, index, participation, questions, level, rows }.
 */
function selectEssResult(results, metricId, period, org) {
  const endKey = essPeriodEndKey(period);
  if (endKey === null) return null;
  const mine = (results || []).filter(r => r.metric_id === metricId && r.survey_year * 100 + r.survey_month <= endKey);
  if (!mine.length) return null;
  const latestKey = mine.reduce((mx, r) => Math.max(mx, r.survey_year * 100 + r.survey_month), 0);
  const rows = mine.filter(r => r.survey_year * 100 + r.survey_month === latestKey);
  const year = Math.floor(latestKey / 100);
  const month = latestKey % 100;
  // carried forward = the result lies before the selected period (MTD: another month; YTD: an earlier year)
  const isMtd = String(period.mode || 'YTD').toUpperCase() === 'MTD';
  const carriedForward = isMtd ? latestKey !== endKey : year !== parseInt(period.year, 10);
  const base = { year, month, period: periodCode(year, month), period_label: periodLabel(year, month), carried_forward: carriedForward, rows };

  if (!org || !org.directorates) {
    const bank = rows.find(r => r.org_level === 'BANKWIDE');
    if (bank) return { ...base, level: 'BANKWIDE', index: bank.index_score, participation: bank.participation, questions: bank.questions || [] };
    const dirRows = rows.filter(r => r.org_level === 'DIRECTORATE');
    if (!dirRows.length) return null;
    return { ...base, level: 'BANKWIDE', ...poolRows(dirRows) };
  }
  const wanted = [...new Set(org.directorates)];
  const dirRows = rows.filter(r => r.org_level === 'DIRECTORATE' && wanted.includes(r.directorate));
  if (!dirRows.length) return null;
  if (dirRows.length === 1) return { ...base, level: 'DIRECTORATE', index: dirRows[0].index_score, participation: dirRows[0].participation, questions: dirRows[0].questions || [] };
  return { ...base, level: 'DIRECTORATE', ...poolRows(dirRows) };
}

// Directorates an engine filter points at: null = bankwide. A division filter reads its parent directorate's row
// (ESS is reported per directorate only); a USER scope counts each scoped directorate once.
function essOrgFor({ directorate, scopes, bankwide }) {
  if (bankwide) return { directorates: null };
  if (Array.isArray(scopes)) return { directorates: scopes.map(s => s.directorate) };
  if (directorate && directorate !== 'ALL') return { directorates: [directorate] };
  return { directorates: null };
}

// ------------------------------------------------------------------ import
/**
 * Validates and stores one ESS summary file for an ESS metric. Atomic: any invalid row -> nothing stored.
 * Returns { success, status, ... } - status is the HTTP status the route should answer with.
 */
async function importEssSummary(buffer, fileName, metric, { uploadedBy } = {}) {
  let sheetRows;
  try {
    sheetRows = await readFirstSheet(buffer);
  } catch (e) {
    return { success: false, status: 400, error: e.message, errors: [{ row_number: null, column: null, reason: e.message }] };
  }
  const directorates = await storage.getDirectorates();
  const configured = await configuredEssQuestions(metric.metric_id);
  const v = validateEssSheet(sheetRows, directorates, configured, buildResolver(directorates, await storage.getDirectoryAliases()));
  if (v.errors.length) {
    return {
      success: false,
      status: 400,
      error: `The ESS summary file was refused (${v.errors.length} error${v.errors.length === 1 ? '' : 's'}); nothing was stored.`,
      errors: v.errors
    };
  }
  const bank = v.rows.find(r => r.org_level === 'BANKWIDE');
  const bankwideIndex = bank ? bank.index_score : poolRows(v.rows).index;
  const uploadId = `ess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  fs.mkdirSync(ESS_UPLOAD_DIR, { recursive: true });
  const filePath = path.join(ESS_UPLOAD_DIR, `${uploadId}.xlsx`);
  fs.writeFileSync(filePath, buffer);
  let saved;
  try {
    saved = await storage.saveEssResultUpload({
      upload_id: uploadId,
      metric_id: metric.metric_id,
      file_name: fileName,
      total_rows: v.rows.length,
      valid_rows: v.rows.length,
      invalid_rows: 0,
      calculated_avg_score: bankwideIndex,
      uploaded_by: uploadedBy || 'HR Admin',
      survey_year: v.period.year,
      survey_month: v.period.month,
      questions_snapshot: { [metric.metric_id]: snapshotQuestions(configured) }
    }, v.rows);
  } catch (e) {
    fs.unlink(filePath, () => {});
    throw e;
  }
  return {
    success: true,
    status: 200,
    is_ess_summary: true,
    upload_id: uploadId,
    metric_id: metric.metric_id,
    metric_name: metric.metric_name,
    file_name: fileName,
    period: periodCode(v.period.year, v.period.month),
    period_label: periodLabel(v.period.year, v.period.month),
    index_label: v.index_label,
    question_labels: v.question_labels,
    file_question_labels: v.file_question_labels,
    rows_imported: v.rows.length,
    // same counters as a CSV upload (history / UI)
    total_rows: v.rows.length,
    valid_rows: v.rows.length,
    valid_rows_count: v.rows.length,
    invalid_rows: 0,
    invalid_rows_count: 0,
    has_bankwide_row: !!bank,
    bankwide_index: round4(bankwideIndex),
    replaced_previous: saved.replaced_rows > 0,
    replaced_rows: saved.replaced_rows,
    errors: [],
    message: `ESS summary ${periodLabel(v.period.year, v.period.month)} imported: ${v.rows.length} rows${saved.replaced_rows > 0 ? ' (the previous upload of this period was replaced)' : ''}.`
  };
}

// Path of the original uploaded file (null when it is not on disk, e.g. the seed results).
function essOriginalFilePath(uploadId) {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(String(uploadId || ''))) return null;
  const p = path.join(ESS_UPLOAD_DIR, `${uploadId}.xlsx`);
  return fs.existsSync(p) ? p : null;
}

// ------------------------------------------------------------------ template (.xlsx writer)
// The ESS summary template of one metric: same layout as the ESS result file, values left empty.
// v2.50.0: the question columns are always the questions configured in Manage Questions (display order).
async function generateEssTemplateXlsx(metric) {
  const questions = await configuredEssQuestions(metric.metric_id);
  const directorates = await storage.getDirectorates();
  const header = [...COLUMN_TITLES, indexTitle(metric), ...questions.map(q => q.text || q.label)];
  const rows = [header, [BANKWIDE_NAME, 'Bankwide']];
  directorates.forEach(d => rows.push([d.directorate_name, 'Directorate']));
  return buildXlsx(rows, { colWidths: [38, 13, 10, 13, 15, 26, ...questions.map(() => 30)] });
}

// ------------------------------------------------------------------ evidence
/**
 * Evidence of the stored ESS summary rows of one metric (every period), with the upload that brought them.
 * options.scopes (a PIC's data scope) limits the directorate rows; the Bankwide row is only for viewers without a
 * scope limit (the Admin).
 * v2.50.0: every row is exported with the question texts stored with it (snapshot of the upload; before v2.50.0 the file
 * header). One question-set version -> { kind: 'csv', content } (the CSV of before); several -> { kind: 'zip', buffer,
 * fileName } with one CSV per version + README.txt.
 */
async function generateEssEvidence(metric, options = {}) {
  const escapeCsv = (val) => {
    if (val === null || val === undefined) return '';
    let str = val.toString();
    if (typeof val === 'string' && str !== '-' && /^[=+\-@\t\r]/.test(str) && !/^[+-]?\d+([.,]\d+)?$/.test(str)) str = `'${str}`;
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) return `"${str.replace(/"/g, '""')}"`;
    return str;
  };
  let rows = await storage.getEssResults(metric.metric_id);
  if (options.scopes) {
    const dirs = options.scopes.map(s => s.directorate);
    rows = rows.filter(r => r.org_level === 'DIRECTORATE' && dirs.includes(r.directorate));
  }
  const uploads = new Map((await storage.getSurveyUploads()).map(u => [u.upload_id, u]));
  rows.sort((a, b) => (b.survey_year * 100 + b.survey_month) - (a.survey_year * 100 + a.survey_month)
    || (a.org_level === b.org_level ? String(a.directorate).localeCompare(String(b.directorate)) : (a.org_level === 'BANKWIDE' ? -1 : 1)));
  // the question texts of a row: its own snapshot (key + text) or, before v2.50.0, the header text of its file
  const versions = groupByQuestionSet(rows, r => ({
    questions: (r.questions || []).map(q => (q.key ? { key: q.key, label: q.label, text: q.text, type: q.type } : { text: q.label })),
    source: (r.questions || []).some(q => q.key) ? 'SNAPSHOT' : 'FILE_HEADER',
    uploaded_at: (uploads.get(r.upload_id) || {}).uploaded_at || r.created_at
  }));
  const csvOf = vRows => {
    const count = vRows.reduce((mx, r) => Math.max(mx, (r.questions || []).length), 0);
    const first = vRows.find(r => (r.questions || []).length === count) || { questions: [] };
    const labels = first.questions.map(q => q.text || q.label);
    const headers = ['Directorate', 'Level', 'Year', 'Month', 'Participation', 'Index_%', ...labels.map(l => `${l} (%)`),
      'Metric_ID', 'Metric_Name', 'Upload_ID', 'File_Name', 'Uploaded_By', 'Uploaded_At'];
    const lines = [headers.map(escapeCsv).join(',')];
    vRows.forEach(r => {
      const u = uploads.get(r.upload_id) || {};
      lines.push([
        r.org_level === 'BANKWIDE' ? BANKWIDE_NAME : r.directorate,
        r.org_level === 'BANKWIDE' ? 'Bankwide' : 'Directorate',
        r.survey_year,
        MONTH_NAMES[r.survey_month - 1],
        r.participation,
        r.index_score,
        ...labels.map((_, i) => { const q = (r.questions || [])[i]; return q && q.score !== null && q.score !== undefined ? q.score : ''; }),
        metric.metric_id,
        metric.metric_name,
        r.upload_id,
        u.file_name || '',
        u.uploaded_by || '',
        u.uploaded_at || ''
      ].map(escapeCsv).join(','));
    });
    return '﻿' + lines.join('\r\n');
  };
  if (versions.length <= 1) return { kind: 'csv', content: csvOf(rows) };
  const zip = await buildVersionedZip({
    baseName: `Evidence_ESS_Summary_Metric_${metric.metric_id}`,
    title: `ESS summary evidence - metric ${metric.metric_id} ${metric.metric_name}`,
    versions: versions.map(v => ({ ...v, csv: csvOf(v.items) }))
  });
  return { kind: 'zip', ...zip };
}

module.exports = {
  ESS_UPLOAD_DIR,
  BANKWIDE_NAME,
  MONTH_NAMES,
  periodCode,
  periodLabel,
  indexTitle,
  readFirstSheet,
  validateEssSheet,
  parseScore,
  poolRows,
  selectEssResult,
  essPeriodEndKey,
  essOrgFor,
  configuredEssQuestions,
  importEssSummary,
  essOriginalFilePath,
  buildXlsx,
  generateEssTemplateXlsx,
  generateEssEvidence
};
