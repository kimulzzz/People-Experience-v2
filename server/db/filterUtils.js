// server/db/filterUtils.js
// Period / directorate filter parsing shared by BOTH storage backends (jsonStorage.js and
// sqlStorage.js), so the rules for what "YTD", "2026-03", {mode, year, month, endMonth, ...}
// mean can never drift apart between them.

const { normalizeScopes } = require('./scopeUtils');

// Default year for filter queries with no explicit year, derived from the real server clock
// instead of a frozen literal — mirrors CURRENT_YEAR in server/services/calculationEngine.js.
const CURRENT_YEAR = String(new Date().getFullYear());

/**
 * Normalises the many accepted filter shapes into one object. Returns null when no filter was
 * given at all (callers then return every row unfiltered).
 *   'YTD' | 'ALL' | '2026' | '2026-03'          (string period)
 *   { mode, year, month, period, directorate, sub_directorate|subDirectorate, endMonth }
 */
function parseFilterOptions(filterOptions) {
  if (!filterOptions) return null;

  let mode = 'YTD';
  let year = CURRENT_YEAR;
  let month = '01';
  let directorate = 'ALL';
  let subDirectorate = 'ALL';
  let endMonth = null;
  let scopes = null;

  if (typeof filterOptions === 'string') {
    const rawPeriod = filterOptions.trim();
    if (rawPeriod === 'YTD' || rawPeriod === 'ALL') {
      mode = 'YTD';
      year = CURRENT_YEAR;
    } else if (/^\d{4}-\d{2}$/.test(rawPeriod)) {
      mode = 'MTD';
      const parts = rawPeriod.split('-');
      year = parts[0];
      month = parts[1];
    } else if (/^\d{4}$/.test(rawPeriod)) {
      mode = 'YTD';
      year = rawPeriod;
    } else {
      mode = 'YTD';
      year = CURRENT_YEAR;
    }
  } else if (typeof filterOptions === 'object') {
    mode = filterOptions.mode || (filterOptions.period && /^\d{4}-\d{2}$/.test(filterOptions.period) ? 'MTD' : 'YTD');
    year = filterOptions.year ? String(filterOptions.year) : (filterOptions.period && /^\d{4}/.test(filterOptions.period) ? filterOptions.period.slice(0, 4) : CURRENT_YEAR);
    month = filterOptions.month ? String(filterOptions.month).padStart(2, '0') : (filterOptions.period && filterOptions.period.length >= 7 && /^\d{4}-\d{2}/.test(filterOptions.period) ? filterOptions.period.slice(5, 7) : '01');
    directorate = filterOptions.directorate || 'ALL';
    subDirectorate = filterOptions.sub_directorate || filterOptions.subDirectorate || 'ALL';
    // Optional upper bound month for YTD mode — used to compute a "cumulative Year-to-Date
    // as of the end of this month" snapshot (e.g. for the Performance Trend chart), instead
    // of the whole year. Ignored when mode is MTD or when not provided (full-year YTD).
    endMonth = filterOptions.endMonth ? String(filterOptions.endMonth).padStart(2, '0') : null;
    // Optional union scope (v2.27.0): [{ directorate, divisions: [..] | null }]. A row must fall in
    // at least one entry (ANDed with the single directorate/sub-directorate above). An empty list
    // matches nothing; absent = no scope restriction.
    if (Array.isArray(filterOptions.scopes)) scopes = normalizeScopes(filterOptions.scopes);
  }

  return { mode, year, month, directorate, subDirectorate, endMonth, scopes };
}

function normalizeDateString(dateVal) {
  if (!dateVal) return null;
  const str = String(dateVal).trim();
  if (!str || str === '-' || str === 'null' || str === 'undefined') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    const p1 = parseInt(slashMatch[1], 10);
    const p2 = parseInt(slashMatch[2], 10);
    const year = slashMatch[3];
    let month, day;
    if (p1 > 12) {
      day = String(p1).padStart(2, '0');
      month = String(p2).padStart(2, '0');
    } else {
      month = String(p1).padStart(2, '0');
      day = String(p2).padStart(2, '0');
    }
    return `${year}-${month}-${day}`;
  }
  const dashMatch = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (dashMatch) {
    const p1 = parseInt(dashMatch[1], 10);
    const p2 = parseInt(dashMatch[2], 10);
    const year = dashMatch[3];
    let month, day;
    if (p1 > 12) {
      day = String(p1).padStart(2, '0');
      month = String(p2).padStart(2, '0');
    } else if (p2 > 12) {
      month = String(p1).padStart(2, '0');
      day = String(p2).padStart(2, '0');
    } else {
      day = String(p1).padStart(2, '0');
      month = String(p2).padStart(2, '0');
    }
    return `${year}-${month}-${day}`;
  }
  try {
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) {
      const y = parsed.getFullYear();
      const m = String(parsed.getMonth() + 1).padStart(2, '0');
      const d = String(parsed.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  } catch (e) {}
  return str;
}

function todayDateString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

module.exports = { CURRENT_YEAR, parseFilterOptions, normalizeDateString, todayDateString };
