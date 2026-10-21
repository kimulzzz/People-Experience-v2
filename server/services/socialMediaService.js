// server/services/socialMediaService.js
// Social media statistics of metric 1 "Career website & social media follower, reach & engagement growth" (v2.52.0).
// The metric is bankwide (no directorate); its drilldown is one row per platform (Instagram, LinkedIn, TikTok) per month:
// followers at month end, reach and engagement of the month. The Admin uploads an .xlsx (Platform | Year | Month |
// Followers | Reach | Engagement), validated atomically (any bad row -> nothing stored) and stored as an upsert per
// platform + month, source UPLOAD (real rows of a month replace its seed rows). v2.53.0: the token-based integration
// endpoint of v2.52.0 is removed (on-premise app) - the Excel upload is the only way in.
// The score of metric 1 is NOT calculated from these rows yet: it stays the raw_value the Admin enters. The rows are kept
// per platform + month so that a later calculation (growth, engagement rate) can read them directly.
const fs = require('fs');
const path = require('path');
const storage = require('../db/storage');
const { periodWindow } = require('../db/filterUtils');
const { colLetter, readFirstSheet, buildXlsx } = require('./xlsxUtils');
const { parseMonth, MONTH_NAMES } = require('./essSummaryService');

const SOCIAL_MEDIA_METRIC_ID = 1;
const PLATFORMS = ['Instagram', 'LinkedIn', 'TikTok'];
// lower case, without spaces / dots / dashes / underscores -> canonical platform
const PLATFORM_ALIASES = {
  instagram: 'Instagram', ig: 'Instagram', insta: 'Instagram',
  linkedin: 'LinkedIn',
  tiktok: 'TikTok', tt: 'TikTok'
};
const MAX_COUNT = 2000000000; // px_social_media_stats columns are INT
// Original uploaded files are kept for the audit trail OUTSIDE server/uploads (which is served to logged-in users).
const SOCIAL_UPLOAD_DIR = path.join(__dirname, '..', 'data', 'social-uploads');

const HEADERS = [
  { key: 'platform', title: 'Platform', names: ['platform'] },
  { key: 'year', title: 'Year', names: ['year', 'tahun'] },
  { key: 'month', title: 'Month', names: ['month', 'bulan'] },
  { key: 'followers', title: 'Followers', names: ['followers', 'follower', 'pengikut'] },
  { key: 'reach', title: 'Reach', names: ['reach', 'jangkauan'] },
  { key: 'engagement', title: 'Engagement', names: ['engagement', 'engagements', 'interaksi'] }
];
const COUNT_FIELDS = ['followers', 'reach', 'engagement'];
const FIELD_TITLES = Object.fromEntries(HEADERS.map(h => [h.key, h.title]));

const isSocialMediaMetric = m => !!m && m.metric_id === SOCIAL_MEDIA_METRIC_ID && m.metric_type === 'OUTCOME';
const periodCode = (year, month) => `${year}-${String(month).padStart(2, '0')}`;
const periodLabel = (year, month) => `${MONTH_NAMES[month - 1]} ${year}`;
const labelOfCode = code => periodLabel(parseInt(code.slice(0, 4), 10), parseInt(code.slice(5, 7), 10));
const round2 = v => Math.round(v * 100) / 100;
const platformOrder = p => PLATFORMS.indexOf(p);

// ------------------------------------------------------------------ cell parsing (an .xlsx cell)
const EMPTY = { value: null, type: 'empty', formulaWithoutValue: false };
const isBlank = c => !c || (c.type === 'empty' && !c.formulaWithoutValue);
const cellText = c => (isBlank(c) || c.value === null ? '' : String(c.value).trim());

function parsePlatform(c) {
  const key = cellText(c).toLowerCase().replace(/[\s._-]+/g, '');
  return PLATFORM_ALIASES[key] || null;
}
function parseYear(c) {
  if (c.type === 'number') return Number.isInteger(c.value) && c.value >= 2000 && c.value <= 2100 ? c.value : null;
  const text = cellText(c);
  if (!/^\d{4}$/.test(text)) return null;
  const y = parseInt(text, 10);
  return y >= 2000 && y <= 2100 ? y : null;
}
// A whole number 0..MAX_COUNT; text may use spaces or commas as thousands separators ("12,500").
function parseCount(c) {
  if (c.formulaWithoutValue) return { error: 'is a formula without a saved value (open the file in Excel, save it and upload it again)' };
  if (isBlank(c)) return { error: 'is empty' };
  let n;
  if (c.type === 'number') n = c.value;
  else {
    const text = cellText(c).replace(/[\s,]/g, '');
    if (/^-\d+$/.test(text)) return { error: `must not be negative (found "${cellText(c).slice(0, 30)}")` };
    if (!/^\d+$/.test(text)) return { error: `must be a whole number (found "${cellText(c).slice(0, 30)}")` };
    n = Number(text);
  }
  if (!Number.isFinite(n) || !Number.isInteger(n)) return { error: `must be a whole number (found "${cellText(c).slice(0, 30)}")` };
  if (n < 0) return { error: `must not be negative (found ${n})` };
  if (n > MAX_COUNT) return { error: `is too large (maximum ${MAX_COUNT.toLocaleString('en-US')})` };
  return { value: n };
}

/**
 * Checks one record whose six fields are cells. err(field, reason) collects the problems; returns the clean row or null.
 */
function validateRecord(cells, err) {
  const out = {};
  const platform = parsePlatform(cells.platform);
  if (isBlank(cells.platform)) err('platform', 'Platform is empty.');
  else if (!platform) err('platform', `Platform "${cellText(cells.platform).slice(0, 40)}" is unknown (use Instagram, LinkedIn or TikTok).`);
  out.platform = platform;
  const year = parseYear(cells.year);
  if (year === null) err('year', `Year must be a 4-digit year 2000-2100 (found "${cellText(cells.year).slice(0, 20)}").`);
  out.year = year;
  const month = isBlank(cells.month) ? null : parseMonth(cells.month);
  if (!month) err('month', `Month must be a month name (e.g. March, Maret, Mar) or a number 1-12 (found "${cellText(cells.month).slice(0, 20)}").`);
  out.month = month;
  COUNT_FIELDS.forEach(f => {
    const p = parseCount(cells[f]);
    if (p.error) err(f, `${FIELD_TITLES[f]} ${p.error}.`);
    out[f] = p.error ? null : p.value;
  });
  return out;
}

// Duplicate platform + month inside one file
function checkDuplicates(rows, err) {
  const seen = new Map();
  rows.forEach(({ row, at }) => {
    if (!row.platform || !row.year || !row.month) return;
    const key = `${row.platform}|${periodCode(row.year, row.month)}`;
    if (seen.has(key)) err(at, `${row.platform} ${periodLabel(row.year, row.month)} appears more than once (rows ${seen.get(key)} and ${at}).`);
    else seen.set(key, at);
  });
}

// ------------------------------------------------------------------ .xlsx validation
/**
 * Validates the rows of the first sheet. The header row (the first row with a "Platform" cell, within the first 10 rows)
 * names the columns in any order. Returns { errors: [{ row_number, column, reason }], rows } - nothing is stored here.
 */
function validateSocialSheet(sheetRows) {
  const errors = [];
  const header = sheetRows.slice(0, 10).find(r => r.cells.some(c => cellText(c).toLowerCase() === 'platform'));
  if (!header) {
    errors.push({ row_number: null, column: null, reason: 'No header row found: row 1 must hold the column names Platform | Year | Month | Followers | Reach | Engagement (see the template).' });
    return { errors, rows: [] };
  }
  const cols = {};
  header.cells.forEach((c, i) => {
    const name = cellText(c).toLowerCase().replace(/\s+/g, ' ').replace(/[*:]+$/, '').trim();
    const h = HEADERS.find(x => x.names.includes(name));
    if (h && cols[h.key] === undefined) cols[h.key] = i;
  });
  const missing = HEADERS.filter(h => cols[h.key] === undefined).map(h => h.title);
  if (missing.length) {
    errors.push({ row_number: header.row_number, column: null, reason: `The header row has no column ${missing.join(', ')} (required: Platform | Year | Month | Followers | Reach | Engagement).` });
    return { errors, rows: [] };
  }
  const dataRows = sheetRows.filter(r => r.row_number > header.row_number && !Object.values(cols).every(i => isBlank(r.cells[i])));
  if (!dataRows.length) errors.push({ row_number: null, column: null, reason: 'The sheet has no data rows below the header row.' });
  const parsed = [];
  dataRows.forEach(r => {
    const cells = Object.fromEntries(HEADERS.map(h => [h.key, r.cells[cols[h.key]] || EMPTY]));
    const row = validateRecord(cells, (field, reason) => errors.push({ row_number: r.row_number, column: colLetter(cols[field]), reason }));
    parsed.push({ row, at: r.row_number });
  });
  checkDuplicates(parsed, (at, reason) => errors.push({ row_number: at, column: colLetter(cols.platform), reason }));
  return { errors, rows: errors.length ? [] : parsed.map(p => p.row) };
}

// ------------------------------------------------------------------ storing
const newUploadId = () => `sm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function storeRows(rows, meta) {
  const periods = [...new Set(rows.map(r => periodCode(r.year, r.month)))].sort();
  const saved = await storage.saveSocialMediaStats({ ...meta, period_from: periods[0], period_to: periods[periods.length - 1] }, rows);
  return {
    success: true,
    status: 200,
    upload_id: meta.upload_id,
    source: meta.source,
    rows_imported: rows.length,
    inserted_rows: saved.inserted,
    updated_rows: saved.updated,
    replaced_seed_rows: saved.replaced_seed,
    periods,
    period_labels: periods.map(labelOfCode),
    errors: [],
    message: `${rows.length} social media row${rows.length === 1 ? '' : 's'} stored (${saved.inserted} new, ${saved.updated} updated) for ${periods.map(labelOfCode).join(', ')}`
      + `${saved.replaced_seed ? `; ${saved.replaced_seed} dummy row${saved.replaced_seed === 1 ? '' : 's'} of ${periods.length === 1 ? 'that month' : 'those months'} replaced` : ''}.`
  };
}

const refused = (errors, what) => ({
  success: false,
  status: 400,
  error: `The ${what} was refused (${errors.length} error${errors.length === 1 ? '' : 's'}); nothing was stored.`,
  errors
});

/** Admin .xlsx upload. Returns { success, status, ... } - status is the HTTP status the route answers with. */
async function importSocialMediaXlsx(buffer, fileName, { uploadedBy } = {}) {
  let sheetRows;
  try {
    sheetRows = await readFirstSheet(buffer);
  } catch (e) {
    return { success: false, status: 400, error: e.message, errors: [{ row_number: null, column: null, reason: e.message }] };
  }
  const v = validateSocialSheet(sheetRows);
  if (v.errors.length) return refused(v.errors, 'social media file');
  const uploadId = newUploadId();
  fs.mkdirSync(SOCIAL_UPLOAD_DIR, { recursive: true });
  const filePath = path.join(SOCIAL_UPLOAD_DIR, `${uploadId}.xlsx`);
  fs.writeFileSync(filePath, buffer);
  try {
    return { ...await storeRows(v.rows, { upload_id: uploadId, source: 'UPLOAD', file_name: String(fileName || 'social_media.xlsx').slice(0, 260), uploaded_by: uploadedBy || 'HR Admin' }), file_name: fileName };
  } catch (e) {
    fs.unlink(filePath, () => {});
    throw e;
  }
}

function socialOriginalFilePath(uploadId) {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(String(uploadId || ''))) return null;
  const p = path.join(SOCIAL_UPLOAD_DIR, `${uploadId}.xlsx`);
  return fs.existsSync(p) ? p : null;
}

async function getSocialMediaUploads() {
  return (await storage.getSocialMediaUploads()).map(u => ({ ...u, has_original_file: !!socialOriginalFilePath(u.upload_id) }));
}

// ------------------------------------------------------------------ template
// Header + one row per platform for the last complete month; the numbers are left empty for the Admin to fill in.
async function generateSocialTemplateXlsx(now = new Date()) {
  const y = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const m = now.getMonth() === 0 ? 12 : now.getMonth();
  const rows = [HEADERS.map(h => h.title), ...PLATFORMS.map(p => [p, y, MONTH_NAMES[m - 1]])];
  return buildXlsx(rows, { sheetName: 'Social Media', colWidths: [14, 8, 13, 14, 14, 14] });
}

// ------------------------------------------------------------------ drilldown table (metric detail)
/**
 * Pure: the table rows of the window from the stored stats (which should start one month before the window, so the
 * first month's follower growth can be computed). Follower growth % = vs the previous calendar month of the same
 * platform (null when that month has no row or 0 followers); engagement rate % = engagement / reach (null when reach 0).
 * period_totals: one "All platforms" line per month with 2+ platforms (growth only when every platform has its previous
 * month). fromKey / toKey = year*100+month, inclusive.
 */
function buildSocialMediaTable(stats, fromKey, toKey) {
  const keyOf = r => r.year * 100 + r.month;
  const prevKey = k => (k % 100 === 1 ? (Math.floor(k / 100) - 1) * 100 + 12 : k - 1);
  const byPlatformMonth = new Map(stats.map(r => [`${r.platform}|${keyOf(r)}`, r]));
  const growthOf = (now, before) => (before > 0 ? round2(((now - before) / before) * 100) : null);
  const rateOf = (eng, reach) => (reach > 0 ? round2((eng / reach) * 100) : null);
  const rows = stats
    .filter(r => keyOf(r) >= fromKey && keyOf(r) <= toKey)
    .sort((a, b) => keyOf(a) - keyOf(b) || platformOrder(a.platform) - platformOrder(b.platform))
    .map(r => {
      const prev = byPlatformMonth.get(`${r.platform}|${prevKey(keyOf(r))}`);
      return {
        platform: r.platform,
        year: r.year,
        month: r.month,
        period: periodCode(r.year, r.month),
        period_label: periodLabel(r.year, r.month),
        followers: r.followers,
        previous_followers: prev ? prev.followers : null,
        follower_growth_pct: prev ? growthOf(r.followers, prev.followers) : null,
        reach: r.reach,
        engagement: r.engagement,
        engagement_rate_pct: rateOf(r.engagement, r.reach),
        source: r.source,
        is_dummy: r.source === 'SEED'
      };
    });
  const periodTotals = [];
  [...new Set(rows.map(r => r.period))].forEach(period => {
    const group = rows.filter(r => r.period === period);
    if (group.length < 2) return;
    const sum = f => group.reduce((s, r) => s + r[f], 0);
    const allPrev = group.every(r => r.previous_followers !== null);
    const followers = sum('followers');
    periodTotals.push({
      period,
      period_label: group[0].period_label,
      platforms: group.length,
      followers,
      follower_growth_pct: allPrev ? growthOf(followers, sum('previous_followers')) : null,
      reach: sum('reach'),
      engagement: sum('engagement'),
      engagement_rate_pct: rateOf(sum('engagement'), sum('reach'))
    });
  });
  return { rows, period_totals: periodTotals };
}

/**
 * The metric-1 drilldown for a Header period ({ mode, year, month }): same windows as the scorecard (YTD of a year =
 * January .. the clock-capped end month, MTD = that month). Bankwide: no directorate filter applies.
 */
async function getSocialMediaDrilldown({ mode, year, month }) {
  const w = periodWindow({ mode, year, month });
  const latest = await storage.getLatestSocialMediaPeriod();
  const base = {
    platforms: PLATFORMS,
    window: w && w.from ? { from: w.from, to: w.to, basis: w.basis } : null,
    latest_period: latest ? periodCode(latest.year, latest.month) : null,
    latest_period_label: latest ? periodLabel(latest.year, latest.month) : null
  };
  if (!w || !w.from) return { ...base, rows: [], period_totals: [] };
  const fy = parseInt(w.from.slice(0, 4), 10);
  const fm = parseInt(w.from.slice(5, 7), 10);
  const fromKey = fy * 100 + fm;
  const toKey = parseInt(w.to.slice(0, 4), 10) * 100 + parseInt(w.to.slice(5, 7), 10);
  const before = fm === 1 ? periodCode(fy - 1, 12) : periodCode(fy, fm - 1);
  const stats = await storage.getSocialMediaStats({ from: before, to: periodCode(Math.floor(toKey / 100), toKey % 100) });
  return { ...base, ...buildSocialMediaTable(stats, fromKey, toKey) };
}

module.exports = {
  SOCIAL_MEDIA_METRIC_ID,
  PLATFORMS,
  SOCIAL_UPLOAD_DIR,
  isSocialMediaMetric,
  parsePlatform,
  validateSocialSheet,
  importSocialMediaXlsx,
  socialOriginalFilePath,
  getSocialMediaUploads,
  generateSocialTemplateXlsx,
  buildSocialMediaTable,
  getSocialMediaDrilldown
};
