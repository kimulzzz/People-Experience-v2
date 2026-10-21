// server/services/outcomeValueService.js
// Monthly values of OUTCOME metrics (v2.54.0). Every OUTCOME metric except metric 11 (computed live from event attendance)
// can be fed by the Admin with an .xlsx (Year | Month | Value | Notes), one bankwide value per month - metric 1 too (its
// value; its social media statistics upload stays the drilldown).
// The upload is validated atomically (any bad row -> nothing stored) and stored as an upsert per metric + month
// (px_outcome_values). Scoring: a metric WITH stored months takes the value of the latest stored month inside the selected
// window (YTD = January .. the clock-capped end month, MTD = that month); no month inside the window = NO_DATA. A metric
// without any stored month keeps its static raw_value (the behaviour before v2.54.0).
// Evidence (Admin): a CSV of the stored months of such a metric, of metric 1's social media rows (kind social_media), or of
// the event attendances behind metric 11.
const fs = require('fs');
const path = require('path');
const storage = require('../db/storage');
const { periodWindow, CURRENT_YEAR } = require('../db/filterUtils');
const { colLetter, readFirstSheet, buildXlsx } = require('./xlsxUtils');
const { parseMonth, MONTH_NAMES } = require('./essSummaryService');
const { isSocialMediaMetric } = require('./socialMediaService');

const LIVE_EVENT_METRIC_ID = 11; // participation: computed live from event attendance (calculationEngine.syncLiveEventMetrics)
const MAX_VALUE = 1e12;          // px_outcome_values.value is DECIMAL(18,4)
const MAX_NOTES = 500;
// Original uploaded files are kept for the audit trail OUTSIDE server/uploads (which is served to logged-in users).
const OUTCOME_UPLOAD_DIR = path.join(__dirname, '..', 'data', 'outcome-uploads');

const HEADERS = [
  { key: 'year', title: 'Year', names: ['year', 'tahun'], required: true },
  { key: 'month', title: 'Month', names: ['month', 'bulan'], required: true },
  { key: 'value', title: 'Value', names: ['value', 'nilai'], required: true },
  { key: 'notes', title: 'Notes', names: ['notes', 'note', 'catatan', 'keterangan'], required: false }
];

// OUTCOME metrics fed by this upload (Template + Upload + Evidence)
const isOutcomeUploadMetric = m => !!m && m.metric_type === 'OUTCOME' && m.metric_id !== LIVE_EVENT_METRIC_ID;
// The Evidence a metric offers in Explore Metrics / the detail: OUTCOME metrics only (SURVEY keeps /api/surveys/evidence).
// Metric 1 also offers its social media rows (?kind=social_media).
function evidenceTypeOf(m) {
  if (!m || m.metric_type !== 'OUTCOME') return null;
  if (m.metric_id === LIVE_EVENT_METRIC_ID) return 'EVENT_ATTENDANCE';
  return 'OUTCOME_VALUES';
}

const periodCode = (year, month) => `${year}-${String(month).padStart(2, '0')}`;
const periodLabel = (year, month) => `${MONTH_NAMES[month - 1]} ${year}`;
const keyOf = r => r.year * 100 + r.month;
const dateKey = d => parseInt(d.slice(0, 4), 10) * 100 + parseInt(d.slice(5, 7), 10); // 'YYYY-MM-DD' -> YYYYMM
const nowKey = (now = new Date()) => now.getFullYear() * 100 + now.getMonth() + 1;

// { fromKey, toKey } of a period ({ mode, year, month, endMonth }), null for an empty window (future year / invalid)
function windowKeys(mp) {
  const w = periodWindow(mp);
  if (!w || !w.from) return null;
  return { fromKey: dateKey(w.from), toKey: dateKey(w.to), window: w };
}

/**
 * The stored month a period is scored with: the latest row of `rows` (one metric) inside the window, or null.
 * Returns { row, period, period_label } | null.
 */
function selectOutcomeValue(rows, mp) {
  const k = windowKeys(mp);
  if (!k) return null;
  const inside = rows.filter(r => keyOf(r) >= k.fromKey && keyOf(r) <= k.toKey);
  if (!inside.length) return null;
  const row = inside.reduce((best, r) => (keyOf(r) > keyOf(best) ? r : best), inside[0]);
  return { row, period: periodCode(row.year, row.month), period_label: periodLabel(row.year, row.month) };
}

// ------------------------------------------------------------------ "Last update" of every metric (calculate + detail)
/**
 * Everything lastUpdateFor needs, read once: the stored OUTCOME months, the newest survey date per metric, the ESS
 * results, the newest social media month and the newest event attendance. essResults / outcomeRows may be passed in
 * when the caller already has them.
 */
async function loadLastUpdateContext({ essResults = null, outcomeRows = null } = {}) {
  const [surveyLatest, ess, outcome, social, attendances] = await Promise.all([
    storage.getLatestSurveyDates(),
    essResults ? Promise.resolve(essResults) : storage.getEssResults(null),
    outcomeRows ? Promise.resolve(outcomeRows) : storage.getOutcomeValues(),
    storage.getLatestSocialMediaPeriod(),
    storage.getAttendances()
  ]);
  const essLatest = {};
  (ess || []).forEach(r => {
    const k = r.survey_year * 100 + r.survey_month;
    if (!essLatest[r.metric_id] || k > essLatest[r.metric_id]) essLatest[r.metric_id] = k;
  });
  const outcomeLatest = {};
  (outcome || []).forEach(r => { if (!outcomeLatest[r.metric_id] || keyOf(r) > outcomeLatest[r.metric_id]) outcomeLatest[r.metric_id] = keyOf(r); });
  const attendanceLatest = (attendances || []).reduce((mx, a) => {
    const d = String(a.attendance_timestamp || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(d) && (!mx || d > mx) ? d : mx;
  }, null);
  return { surveyLatest: surveyLatest || {}, essLatest, outcomeLatest, socialLatest: social, attendanceLatest };
}

/**
 * The latest data period of a metric (bankwide, not limited to the selected window): { last_update_period: 'YYYY-MM',
 * last_update_label: 'September 2026' } (both null when the metric has no data at all).
 * SURVEY: newest survey date (ESS: newest ESS result); OUTCOME: newest stored month, else (metric 1) the newest social media
 * month, else last_data_date; metric 11: newest event attendance.
 */
function lastUpdateFor(metric, ctx) {
  let key = null;
  const fromDate = d => (/^\d{4}-\d{2}/.test(String(d || '')) ? dateKey(String(d)) : null);
  if (metric.metric_type === 'SURVEY') {
    key = metric.survey_source === 'ESS' ? (ctx.essLatest[metric.metric_id] || null) : fromDate(ctx.surveyLatest[metric.metric_id]);
  } else if (metric.metric_id === LIVE_EVENT_METRIC_ID) {
    key = fromDate(ctx.attendanceLatest);
  } else if (ctx.outcomeLatest[metric.metric_id]) {
    key = ctx.outcomeLatest[metric.metric_id];
  } else if (isSocialMediaMetric(metric) && ctx.socialLatest) {
    key = ctx.socialLatest.year * 100 + ctx.socialLatest.month;
  } else {
    key = fromDate(metric.last_data_date);
  }
  if (!key) return { last_update_period: null, last_update_label: null };
  const y = Math.floor(key / 100);
  const m = key % 100;
  return { last_update_period: periodCode(y, m), last_update_label: periodLabel(y, m) };
}

// ------------------------------------------------------------------ cell parsing (an .xlsx cell)
const EMPTY = { value: null, type: 'empty', formulaWithoutValue: false };
const isBlank = c => !c || (c.type === 'empty' && !c.formulaWithoutValue);
const cellText = c => (isBlank(c) || c.value === null ? '' : String(c.value).trim());

function parseYear(c) {
  if (c.type === 'number') return Number.isInteger(c.value) && c.value >= 2000 && c.value <= 2100 ? c.value : null;
  const text = cellText(c);
  if (!/^\d{4}$/.test(text)) return null;
  const y = parseInt(text, 10);
  return y >= 2000 && y <= 2100 ? y : null;
}

// A number >= 0 (decimals allowed). Text may use thousands separators ("6,400", "1 250") or a decimal comma ("85,5"), and
// a trailing "%".
function parseValue(c) {
  if (c.formulaWithoutValue) return { error: 'is a formula without a saved value (open the file in Excel, save it and upload it again)' };
  if (c.type === 'error') return { error: `holds an Excel error (${c.value})` };
  if (isBlank(c)) return { error: 'is empty' };
  let n;
  if (c.type === 'number') n = c.value;
  else {
    let text = cellText(c).replace(/\s+/g, '').replace(/%$/, '');
    if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) text = text.replace(/,/g, '');
    else if (/^-?\d+,\d+$/.test(text)) text = text.replace(',', '.');
    if (!/^-?\d+(\.\d+)?$/.test(text)) return { error: `must be a number (found "${cellText(c).slice(0, 30)}")` };
    n = Number(text);
  }
  if (!Number.isFinite(n)) return { error: `must be a number (found "${cellText(c).slice(0, 30)}")` };
  if (n < 0) return { error: `must not be negative (found ${n})` };
  if (n > MAX_VALUE) return { error: `is too large (maximum ${MAX_VALUE.toLocaleString('en-US')})` };
  return { value: Math.round(n * 10000) / 10000 };
}

// ------------------------------------------------------------------ .xlsx validation
/**
 * Validates the rows of the first sheet. The header row (the first row with a "Year" and a "Value" cell, within the
 * first 10 rows - the template has a title above it) names the columns in any order; Notes is optional. A month after
 * the current month is refused. Returns { errors: [{ row_number, column, reason }], rows } - nothing is stored here.
 */
function validateOutcomeSheet(sheetRows, now = new Date()) {
  const errors = [];
  const norm = c => cellText(c).toLowerCase().replace(/\s+/g, ' ').replace(/[*:]+$/, '').trim();
  const header = sheetRows.slice(0, 10).find(r => r.cells.some(c => norm(c) === 'year') && r.cells.some(c => ['value', 'nilai'].includes(norm(c))));
  if (!header) {
    errors.push({ row_number: null, column: null, reason: 'No header row found: the sheet must hold the column names Year | Month | Value | Notes (see the template).' });
    return { errors, rows: [] };
  }
  const cols = {};
  header.cells.forEach((c, i) => {
    const h = HEADERS.find(x => x.names.includes(norm(c)));
    if (h && cols[h.key] === undefined) cols[h.key] = i;
  });
  const missing = HEADERS.filter(h => h.required && cols[h.key] === undefined).map(h => h.title);
  if (missing.length) {
    errors.push({ row_number: header.row_number, column: null, reason: `The header row has no column ${missing.join(', ')} (required: Year | Month | Value; Notes optional).` });
    return { errors, rows: [] };
  }
  const used = Object.values(cols);
  const dataRows = sheetRows.filter(r => r.row_number > header.row_number && !used.every(i => isBlank(r.cells[i])));
  if (!dataRows.length) errors.push({ row_number: null, column: null, reason: 'The sheet has no data rows below the header row.' });
  const limit = nowKey(now);
  const limitLabel = periodLabel(Math.floor(limit / 100), limit % 100);
  const parsed = [];
  const seen = new Map();
  dataRows.forEach(r => {
    const cell = k => (cols[k] === undefined ? EMPTY : r.cells[cols[k]] || EMPTY);
    const err = (k, reason) => errors.push({ row_number: r.row_number, column: colLetter(cols[k]), reason });
    const year = parseYear(cell('year'));
    if (year === null) err('year', `Year must be a 4-digit year 2000-2100 (found "${cellText(cell('year')).slice(0, 20)}").`);
    const month = isBlank(cell('month')) ? null : parseMonth(cell('month'));
    if (!month) err('month', `Month must be a month name (e.g. March, Maret, Mar) or a number 1-12 (found "${cellText(cell('month')).slice(0, 20)}").`);
    const v = parseValue(cell('value'));
    if (v.error) err('value', `Value ${v.error}.`);
    const notes = cols.notes === undefined ? '' : cellText(cell('notes'));
    if (notes.length > MAX_NOTES) err('notes', `Notes must be at most ${MAX_NOTES} characters (found ${notes.length}).`);
    if (year !== null && month) {
      const key = year * 100 + month;
      if (key > limit) err('month', `${periodLabel(year, month)} is in the future - only months up to ${limitLabel} can be uploaded.`);
      if (seen.has(key)) err('month', `${periodLabel(year, month)} appears more than once (rows ${seen.get(key)} and ${r.row_number}).`);
      else seen.set(key, r.row_number);
    }
    parsed.push({ year, month, value: v.error ? null : v.value, notes: notes || null });
  });
  return { errors, rows: errors.length ? [] : parsed };
}

// ------------------------------------------------------------------ storing
const newUploadId = () => `ov-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Admin .xlsx upload for one metric. Returns { success, status, ... } - status is the HTTP status the route answers with. */
async function importOutcomeXlsx(buffer, fileName, metric, { uploadedBy } = {}) {
  let sheetRows;
  try {
    sheetRows = await readFirstSheet(buffer);
  } catch (e) {
    return { success: false, status: 400, error: e.message, errors: [{ row_number: null, column: null, reason: e.message }] };
  }
  const v = validateOutcomeSheet(sheetRows);
  if (v.errors.length) {
    return { success: false, status: 400, error: `The file was refused (${v.errors.length} error${v.errors.length === 1 ? '' : 's'}); nothing was stored.`, errors: v.errors };
  }
  const uploadId = newUploadId();
  fs.mkdirSync(OUTCOME_UPLOAD_DIR, { recursive: true });
  const filePath = path.join(OUTCOME_UPLOAD_DIR, `${uploadId}.xlsx`);
  fs.writeFileSync(filePath, buffer);
  const periods = [...new Set(v.rows.map(r => periodCode(r.year, r.month)))].sort();
  try {
    const saved = await storage.saveOutcomeValues({
      upload_id: uploadId, metric_id: metric.metric_id, file_name: String(fileName || 'outcome_values.xlsx').slice(0, 260),
      uploaded_by: uploadedBy || 'HR Admin', period_from: periods[0], period_to: periods[periods.length - 1]
    }, v.rows);
    const labels = periods.map(p => periodLabel(parseInt(p.slice(0, 4), 10), parseInt(p.slice(5, 7), 10)));
    return {
      success: true,
      status: 200,
      upload_id: uploadId,
      metric_id: metric.metric_id,
      file_name: fileName,
      rows_imported: v.rows.length,
      inserted_rows: saved.inserted,
      updated_rows: saved.updated,
      replaced_seed_rows: saved.replaced_seed,
      periods,
      period_labels: labels,
      errors: [],
      message: `${v.rows.length} monthly value${v.rows.length === 1 ? '' : 's'} stored for metric ${metric.metric_id} (${saved.inserted} new, ${saved.updated} updated): ${labels.join(', ')}.`
    };
  } catch (e) {
    fs.unlink(filePath, () => {});
    throw e;
  }
}

function outcomeOriginalFilePath(uploadId) {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(String(uploadId || ''))) return null;
  const p = path.join(OUTCOME_UPLOAD_DIR, `${uploadId}.xlsx`);
  return fs.existsSync(p) ? p : null;
}

async function getOutcomeUploads(metricId) {
  return (await storage.getOutcomeUploads(metricId)).map(u => ({ ...u, has_original_file: !!outcomeOriginalFilePath(u.upload_id) }));
}

// ------------------------------------------------------------------ template
// Title + note (metric name, unit), then the header and one row for the last complete month with the value left empty.
async function generateOutcomeTemplateXlsx(metric, now = new Date()) {
  const y = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const m = now.getMonth() === 0 ? 12 : now.getMonth();
  const rows = [
    [`Metric ${metric.metric_id} - ${metric.metric_name}`],
    [`Value unit: ${metric.unit || '-'}. One bankwide value per month; Month as a name (September, Sep, Mei) or 1-12. Future months are refused; a month uploaded again replaces its value.`],
    HEADERS.map(h => h.title),
    [y, MONTH_NAMES[m - 1]]
  ];
  return buildXlsx(rows, { sheetName: 'Monthly Values', colWidths: [10, 14, 16, 50], headerRow: 2 });
}

// ------------------------------------------------------------------ evidence (CSV)
// Same formula escaping as the other evidence CSVs: text starting with = + - @ tab CR gets a leading apostrophe.
const csvCell = val => {
  if (val === null || val === undefined) return '';
  let str = String(val);
  if (typeof val === 'string' && str !== '-' && /^[=+\-@\t\r]/.test(str) && !/^[+-]?\d+([.,]\d+)?$/.test(str)) str = `'${str}`;
  if (/[",\r\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
};
const toCsv = (headers, rows) => '﻿' + [headers, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');

/**
 * ?period= of an evidence download: 'ALL' (default) | 'YTD' (this year) | 'YYYY' (YTD of that year) | 'YYYY-MM' (that
 * month). Returns { all: true } | { mode, year, month } | null (invalid).
 */
function parseEvidencePeriod(period) {
  const p = String(period === undefined || period === null || period === '' ? 'ALL' : period).trim().toUpperCase();
  if (p === 'ALL') return { all: true };
  if (p === 'YTD') return { mode: 'YTD', year: CURRENT_YEAR, month: '01' };
  if (/^\d{4}$/.test(p)) return { mode: 'YTD', year: p, month: '01' };
  const m = p.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (m) return { mode: 'MTD', year: m[1], month: m[2] };
  return null;
}
const inPeriod = (key, mp) => {
  if (mp.all) return true;
  const k = windowKeys(mp);
  return !!k && key >= k.fromKey && key <= k.toKey;
};

/** Evidence CSV of a metric for a parsed period; kind 'social_media' = metric 1's social media rows. Returns { fileName, csv }. */
async function generateOutcomeEvidence(metric, mp, kind = null) {
  const tag = mp.all ? 'ALL' : (mp.mode === 'MTD' ? `${mp.year}-${mp.month}` : `YTD_${mp.year}`);
  const type = kind === 'social_media' && isSocialMediaMetric(metric) ? 'SOCIAL_MEDIA' : evidenceTypeOf(metric);
  if (type === 'SOCIAL_MEDIA') {
    const uploads = new Map((await storage.getSocialMediaUploads()).map(u => [u.upload_id, u]));
    const rows = (await storage.getSocialMediaStats()).filter(r => inPeriod(keyOf(r), mp)).map(r => {
      const u = uploads.get(r.upload_id) || {};
      return [metric.metric_id, metric.metric_name, r.platform, r.year, MONTH_NAMES[r.month - 1], periodCode(r.year, r.month), r.followers, r.reach,
        r.engagement, r.source, r.upload_id || '', u.file_name || '', u.uploaded_by || '', u.uploaded_at || r.created_at || ''];
    });
    return {
      fileName: `Evidence_Social_Media_Metric_${metric.metric_id}_${tag}.csv`,
      csv: toCsv(['Metric_ID', 'Metric_Name', 'Platform', 'Year', 'Month', 'Period', 'Followers', 'Reach', 'Engagement', 'Source', 'Upload_ID',
        'File_Name', 'Uploaded_By', 'Uploaded_At'], rows)
    };
  }
  if (type === 'EVENT_ATTENDANCE') {
    const events = new Map((await storage.getEvents()).map(e => [e.event_id, e]));
    const rows = (await storage.getAttendances())
      .filter(a => { const d = String(a.attendance_timestamp || '').slice(0, 10); return /^\d{4}-\d{2}/.test(d) && inPeriod(dateKey(d), mp); })
      .sort((a, b) => String(a.attendance_timestamp).localeCompare(String(b.attendance_timestamp)))
      .map(a => {
        const ev = events.get(a.event_id) || {};
        return [metric.metric_id, metric.metric_name, a.event_id, ev.event_name || '', ev.event_date || '', a.nip, a.employee_name, a.cimb_email,
          a.directorate, a.division, a.attendance_timestamp];
      });
    return {
      fileName: `Evidence_Event_Attendance_Metric_${metric.metric_id}_${tag}.csv`,
      csv: toCsv(['Metric_ID', 'Metric_Name', 'Event_ID', 'Event_Name', 'Event_Date', 'NIP', 'Employee_Name', 'CIMB_Email', 'Directorate', 'Division',
        'Attendance_Timestamp'], rows)
    };
  }
  // OUTCOME_VALUES: every stored month of the period; Used_In_Score = the month the period is scored with
  const all = await storage.getOutcomeValues(metric.metric_id);
  const used = mp.all ? null : selectOutcomeValue(all, mp);
  const uploads = new Map((await storage.getOutcomeUploads(metric.metric_id)).map(u => [u.upload_id, u]));
  const rows = all.filter(r => inPeriod(keyOf(r), mp)).map(r => {
    const u = uploads.get(r.upload_id) || {};
    return [metric.metric_id, metric.metric_name, metric.unit || '', r.year, MONTH_NAMES[r.month - 1], periodCode(r.year, r.month), r.value,
      r.notes || '', r.source, used && used.row === r ? 'YES' : (mp.all ? '' : 'NO'), r.upload_id || '', u.file_name || '', u.uploaded_by || '',
      u.uploaded_at || r.created_at || '', r.updated_at || ''];
  });
  return {
    fileName: `Evidence_Outcome_Metric_${metric.metric_id}_${tag}.csv`,
    csv: toCsv(['Metric_ID', 'Metric_Name', 'Unit', 'Year', 'Month', 'Period', 'Value', 'Notes', 'Source', 'Used_In_Score', 'Upload_ID', 'File_Name',
      'Uploaded_By', 'Uploaded_At', 'Updated_At'], rows)
  };
}

module.exports = {
  LIVE_EVENT_METRIC_ID,
  OUTCOME_UPLOAD_DIR,
  isOutcomeUploadMetric,
  evidenceTypeOf,
  selectOutcomeValue,
  loadLastUpdateContext,
  lastUpdateFor,
  validateOutcomeSheet,
  importOutcomeXlsx,
  outcomeOriginalFilePath,
  getOutcomeUploads,
  generateOutcomeTemplateXlsx,
  parseEvidencePeriod,
  generateOutcomeEvidence
};
