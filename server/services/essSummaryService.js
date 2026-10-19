// server/services/essSummaryService.js
// ESS (Employee Sentiment Survey) SUMMARY upload (v2.32.0). An ESS metric no longer takes per-respondent
// CSV rows: the PIC uploads the ESS result summary as an .xlsx (one row per org unit), e.g.
//   A Directorate | B Level | C Year | D Month | E Participation | F <Index name> | G.. one column per question
//   PT Bank CIMB Niaga Tbk | Bankwide | 2025 | November | 7756 | 0.92 | 0.96 | 0.9 | 0.9
//   Business Banking       | Directorate | 2025 | November | 449 | 0.91 | ...
// The row whose Directorate starts with "PT Bank CIMB Niaga" (or Level = Bankwide) is the bankwide result; every
// other row must be a directorate of the master. Scores may be fractions (0-1) or percentages (0-100).
// This file holds the .xlsx reader/writer (no formula is ever evaluated: Excel's cached values are used), the
// validation + import, the template, the evidence CSV and the "which ESS result applies" rules of the engine.
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const storage = require('../db/storage');

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

// ------------------------------------------------------------------ minimal .xlsx reader
function decodeXml(text) {
  return String(text || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
const attrOf = (attrs, name) => {
  const m = String(attrs || '').match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return m ? decodeXml(m[1]) : null;
};
// All <t> texts of a shared/inline string (rich text runs concatenated, phonetic hints dropped).
const textRuns = xml => {
  const body = String(xml || '').replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  const out = [];
  body.replace(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g, (_, t) => { out.push(decodeXml(t || '')); return ''; });
  return out.join('');
};
const colIndex = ref => {
  const letters = String(ref || '').match(/^[A-Z]+/i);
  if (!letters) return -1;
  return letters[0].toUpperCase().split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
};
const colLetter = idx => {
  let s = '';
  let n = idx + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

/**
 * Reads the FIRST worksheet of an .xlsx buffer into rows of cells.
 * Returns [{ row_number, cells: [{ value, type: 'string'|'number'|'boolean'|'error'|'empty', formulaWithoutValue }] }].
 * Throws an Error with a user-facing message when the bytes are not an .xlsx workbook.
 */
async function readFirstSheet(buffer) {
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (_) {
    throw new Error('The file is not a valid Excel .xlsx workbook. Save it in Excel as "Excel Workbook (*.xlsx)" and upload it again.');
  }
  const read = async name => (zip.file(name) ? zip.file(name).async('string') : null);
  const workbook = await read('xl/workbook.xml');
  if (!workbook) throw new Error('The file is not a valid Excel .xlsx workbook (no workbook part found).');

  // first <sheet> -> its relationship target
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const firstSheet = workbook.match(/<sheet\b([^>]*?)\/?>/);
  const rels = await read('xl/_rels/workbook.xml.rels');
  if (firstSheet && rels) {
    const rid = attrOf(firstSheet[1], 'r:id');
    const rel = [...rels.matchAll(/<Relationship\b([^>]*?)\/?>/g)].map(m => m[1]).find(a => attrOf(a, 'Id') === rid);
    const target = rel ? attrOf(rel, 'Target') : null;
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : path.posix.normalize(`xl/${target}`);
  }
  const sheet = await read(sheetPath);
  if (!sheet) throw new Error('The workbook has no readable worksheet.');

  const shared = [];
  const sst = await read('xl/sharedStrings.xml');
  if (sst) sst.replace(/<si\b[^>]*>([\s\S]*?)<\/si>/g, (_, si) => { shared.push(textRuns(si)); return ''; });

  const rows = [];
  let nextRow = 1;
  const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  let rm;
  while ((rm = rowRe.exec(sheet))) {
    const rAttr = parseInt(attrOf(rm[1], 'r'), 10);
    const rowNumber = Number.isFinite(rAttr) ? rAttr : nextRow;
    nextRow = rowNumber + 1;
    const cells = [];
    let nextCol = 0;
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    while ((cm = cellRe.exec(rm[2] || ''))) {
      const ref = attrOf(cm[1], 'r');
      const idx = ref ? colIndex(ref) : nextCol;
      nextCol = idx + 1;
      const t = attrOf(cm[1], 't');
      const inner = cm[2] || '';
      const vMatch = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
      const hasFormula = /<f\b/.test(inner);
      const raw = vMatch ? decodeXml(vMatch[1]) : null;
      let cell = { value: null, type: 'empty', formulaWithoutValue: false };
      if (t === 'inlineStr') {
        const isMatch = inner.match(/<is\b[^>]*>([\s\S]*?)<\/is>/);
        cell = { value: textRuns(isMatch ? isMatch[1] : ''), type: 'string' };
      } else if (raw === null) {
        cell.formulaWithoutValue = hasFormula;
      } else if (t === 's') {
        cell = { value: shared[parseInt(raw, 10)] !== undefined ? shared[parseInt(raw, 10)] : '', type: 'string' };
      } else if (t === 'str') {
        cell = { value: raw, type: 'string' };
      } else if (t === 'b') {
        cell = { value: raw === '1', type: 'boolean' };
      } else if (t === 'e') {
        cell = { value: raw, type: 'error' };
      } else {
        const num = Number(raw);
        cell = Number.isFinite(num) ? { value: num, type: 'number' } : { value: raw, type: 'string' };
      }
      if (cell.type === 'string' && !String(cell.value).trim()) cell = { value: null, type: 'empty', formulaWithoutValue: false };
      if (idx >= 0) cells[idx] = cell;
    }
    rows.push({ row_number: rowNumber, cells });
  }
  return rows;
}

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

/**
 * Validates parsed sheet rows against the ESS summary layout and the directorate master.
 * Returns { errors: [{ row_number, column, reason }], rows, period: { year, month } | null, index_label, question_labels }.
 * Nothing is stored here; any error means the whole file is refused.
 */
function validateEssSheet(sheetRows, directorates) {
  const errors = [];
  const err = (row_number, column, reason) => errors.push({ row_number, column, reason });
  const header = sheetRows.find(r => r.row_number === 1);
  if (!header || header.cells.every(isBlank)) {
    err(1, null, 'Row 1 must be the header: Directorate | Level | Year | Month | Participation | <Index name> | <question columns ...>.');
    return { errors, rows: [], period: null, index_label: null, question_labels: [] };
  }
  HEADER_NAMES.forEach((names, idx) => {
    const text = cellText(cellAt(header, idx)).toLowerCase();
    if (!names.includes(text)) err(1, colLetter(idx), `Column ${colLetter(idx)} must be "${COLUMN_TITLES[idx]}" (found "${cellText(cellAt(header, idx))}").`);
  });
  const indexLabel = cellText(cellAt(header, 5));
  if (!indexLabel) err(1, 'F', 'Column F must hold the index name (e.g. "Role Clarity & DS Support Index") and the index score in every row.');

  // question columns = every header cell from G on (a data value under an empty header is an error)
  const maxCol = sheetRows.reduce((mx, r) => Math.max(mx, r.cells.length), 0);
  const questionCols = [];
  for (let i = 6; i < maxCol; i++) {
    const label = cellText(cellAt(header, i));
    if (label) questionCols.push({ idx: i, label });
  }

  const dirByKey = new Map((directorates || []).map(d => [canonicalDir(d.directorate_name), d.directorate_name]));
  const dataRows = sheetRows.filter(r => r.row_number > 1 && !r.cells.every(isBlank));
  if (!dataRows.length) err(null, null, 'The sheet has no data rows (row 2 onward must hold the Bankwide row and one row per directorate).');

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
      directorate = dirByKey.get(canonicalDir(dirText)) || null;
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
    questionCols.forEach(q => {
      const c = cellAt(r, q.idx);
      if (isBlank(c)) { questions.push({ label: q.label, score: null }); return; }
      const p = parseScore(c);
      if (p.error) err(n, colLetter(q.idx), `The score of "${q.label.slice(0, 60)}" ${p.error}.`);
      else questions.push({ label: q.label, score: p.value });
    });
    for (let i = 6; i < r.cells.length; i++) {
      if (!questionCols.some(q => q.idx === i) && !isBlank(cellAt(r, i))) err(n, colLetter(i), `Column ${colLetter(i)} has a value but no question text in row 1.`);
    }

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
    question_labels: questionCols.map(q => q.label)
  };
}

// ------------------------------------------------------------------ result selection (used by the engine)
// Participation-weighted mean of rows (plain mean when nobody participated). Question scores are pooled per label.
function poolRows(rows) {
  const totalPart = rows.reduce((s, r) => s + (r.participation || 0), 0);
  const weightOf = r => (totalPart > 0 ? (r.participation || 0) : 1);
  const totalWeight = rows.reduce((s, r) => s + weightOf(r), 0);
  const index = totalWeight > 0 ? rows.reduce((s, r) => s + r.index_score * weightOf(r), 0) / totalWeight : 0;
  const labels = [];
  rows.forEach(r => (r.questions || []).forEach(q => { if (!labels.includes(q.label)) labels.push(q.label); }));
  const questions = labels.map(label => {
    let sum = 0;
    let w = 0;
    rows.forEach(r => {
      const q = (r.questions || []).find(x => x.label === label);
      if (q && q.score !== null && q.score !== undefined) { sum += q.score * weightOf(r); w += weightOf(r); }
    });
    return { label, score: w > 0 ? round4(sum / w) : null };
  });
  return { index: round4(index), participation: totalPart, questions };
}

/**
 * Which ESS result applies to one metric for a period + org selection (carry-forward rule):
 * the latest result whose (year, month) is on or before the period's end, from any earlier year.
 *   results   : every ESS result row (all metrics) - fetched once per calculation
 *   period    : { mode, year, month, endMonth }  (YTD Y [endMonth M] -> Y-M or Y-12; MTD Y-M -> Y-M)
 *   org       : { directorates: null | [names] }  null = bankwide (no directorate filter)
 * Returns null (no data) or { year, month, period, index, participation, questions, level, rows }.
 */
function selectEssResult(results, metricId, period, org) {
  const y = parseInt(period.year, 10);
  if (!Number.isFinite(y)) return null;
  const mode = String(period.mode || 'YTD').toUpperCase();
  let m = mode === 'MTD' ? parseInt(period.month, 10) : (period.endMonth ? parseInt(period.endMonth, 10) : 12);
  if (!(m >= 1 && m <= 12)) m = 12;
  const endKey = y * 100 + m;
  const mine = (results || []).filter(r => r.metric_id === metricId && r.survey_year * 100 + r.survey_month <= endKey);
  if (!mine.length) return null;
  const latestKey = mine.reduce((mx, r) => Math.max(mx, r.survey_year * 100 + r.survey_month), 0);
  const rows = mine.filter(r => r.survey_year * 100 + r.survey_month === latestKey);
  const year = Math.floor(latestKey / 100);
  const month = latestKey % 100;
  const base = { year, month, period: periodCode(year, month), period_label: periodLabel(year, month), rows };

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
  const v = validateEssSheet(sheetRows, directorates);
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
      survey_month: v.period.month
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
const xmlEsc = s => String(s === null || s === undefined ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function buildXlsx(rows, { sheetName = 'Dimensions', colWidths = [] } = {}) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + '</Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '</Relationships>');
  zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `<sheets><sheet name="${xmlEsc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    + '</Relationships>');
  // style 0 = normal, 1 = bold + wrapped (header)
  zip.file('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
    + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs>'
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
    + '</styleSheet>');
  const cols = colWidths.length
    ? `<cols>${colWidths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const sheetRows = rows.map((cells, ri) => {
    const r = ri + 1;
    const body = cells.map((v, ci) => {
      if (v === null || v === undefined || v === '') return '';
      const ref = `${colLetter(ci)}${r}`;
      const style = ri === 0 ? ' s="1"' : '';
      if (typeof v === 'number') return `<c r="${ref}"${style}><v>${v}</v></c>`;
      return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
    }).join('');
    return `<row r="${r}">${body}</row>`;
  }).join('');
  zip.file('xl/worksheets/sheet1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `${cols}<sheetData>${sheetRows}</sheetData></worksheet>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// The ESS summary template of one metric: same layout as the ESS result file, values left empty.
async function generateEssTemplateXlsx(metric) {
  const questions = (await storage.getSurveyQuestions(metric.metric_id)).filter(q => (q.type || 'SCALE_1_5') !== 'FREE_TEXT');
  const directorates = await storage.getDirectorates();
  const header = [...COLUMN_TITLES, indexTitle(metric), ...questions.map(q => q.text || q.label)];
  const rows = [header, [BANKWIDE_NAME, 'Bankwide']];
  directorates.forEach(d => rows.push([d.directorate_name, 'Directorate']));
  return buildXlsx(rows, { colWidths: [38, 13, 10, 13, 15, 26, ...questions.map(() => 30)] });
}

// ------------------------------------------------------------------ evidence
/**
 * Evidence CSV of the stored ESS summary rows of one metric (every period), with the upload that brought them.
 * options.scopes (a PIC's data scope) limits the directorate rows; the Bankwide row is only for viewers without a
 * scope limit (the Admin).
 */
async function generateEssEvidenceCsv(metric, options = {}) {
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
  const labels = [];
  rows.forEach(r => (r.questions || []).forEach(q => { if (!labels.includes(q.label)) labels.push(q.label); }));
  const headers = ['Directorate', 'Level', 'Year', 'Month', 'Participation', 'Index_%', ...labels.map(l => `${l} (%)`),
    'Metric_ID', 'Metric_Name', 'Upload_ID', 'File_Name', 'Uploaded_By', 'Uploaded_At'];
  const lines = [headers.map(escapeCsv).join(',')];
  rows.forEach(r => {
    const u = uploads.get(r.upload_id) || {};
    lines.push([
      r.org_level === 'BANKWIDE' ? BANKWIDE_NAME : r.directorate,
      r.org_level === 'BANKWIDE' ? 'Bankwide' : 'Directorate',
      r.survey_year,
      MONTH_NAMES[r.survey_month - 1],
      r.participation,
      r.index_score,
      ...labels.map(l => { const q = (r.questions || []).find(x => x.label === l); return q && q.score !== null ? q.score : ''; }),
      metric.metric_id,
      metric.metric_name,
      r.upload_id,
      u.file_name || '',
      u.uploaded_by || '',
      u.uploaded_at || ''
    ].map(escapeCsv).join(','));
  });
  return '﻿' + lines.join('\r\n');
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
  essOrgFor,
  importEssSummary,
  essOriginalFilePath,
  buildXlsx,
  generateEssTemplateXlsx,
  generateEssEvidenceCsv
};
