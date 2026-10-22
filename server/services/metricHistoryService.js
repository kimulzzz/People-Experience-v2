// server/services/metricHistoryService.js
// History tab of the metric detail (v2.56.0, formerly "Internal Transaction Records"): the rows behind the metric's Evidence
// download for the selected period, as a table. Every kind is built by the SAME function that builds its evidence CSV
// (outcomeEvidenceTable, partEvidenceTable, essEvidenceTables, generateSurveyEvidence tablesOnly), so the History tab and the
// Evidence file cannot disagree. Kinds:
//   NOT_AVAILABLE    - data_status NOT_AVAILABLE ("Real data not available yet"): no rows (the evidence stays downloadable)
//   PARTS            - composite summary metrics (5, 7, 12, 19, 20): the rows of every part (Part column)
//   ESS              - ESS summary results (every period, like the ESS evidence)
//   SURVEY_RESPONSES - SYSTEM survey metrics: one row per respondent
//   EVENT_ATTENDANCE - metric 11: the event attendances of the period
//   OUTCOME_VALUES   - OUTCOME metrics with stored monthly values (1, 3, 14 ...; AVERAGE metrics with their "Average" line)
//   OPERATIONAL      - OUTCOME metrics without stored months: the old operational drilldown records of the detail
// Viewer limits (decided by the route): identity columns only when `seesIdentity` (Admin; the PIC for a SURVEY metric);
// `scopes` (non-Admin, employee metrics) keeps only the rows of the viewer's directorates (directorate-level rows only).
const storage = require('../db/storage');
const { isDataNotAvailable, DATA_NOT_AVAILABLE_REASON } = require('../db/dataStatus');
const { isEssMetric } = require('../db/surveySource');
const { rowInScopes } = require('../db/scopeUtils');
const { outcomeEvidenceTable, isOutcomeUploadMetric, LIVE_EVENT_METRIC_ID } = require('./outcomeValueService');
const { partEvidenceTable } = require('./metricPartsService');
const { essEvidenceTables } = require('./essSummaryService');
const { generateSurveyEvidence } = require('./surveyEvidenceService');

// Evidence columns that repeat the metric itself or are technical: kept in the rows, not shown as table columns
const HIDDEN_COLUMNS = ['Metric_ID', 'Metric_Name', 'Upload_ID', 'File_SHA256', 'Updated_At'];
const labelOf = header => String(header).replace(/_/g, ' ');

/**
 * Turns evidence tables ({ headers, rows (arrays), sortKeys, identity }) into one History table: the union of the columns
 * (first appearance order; a header repeated inside one table gets " (2)"), one object per row, newest first (ties keep the
 * evidence order). drop = headers left out (identity of a viewer who may not see it); keep(row) = row filter.
 */
function mergeTables(tables, { drop = [], keep = null } = {}) {
  const columns = [];
  const seen = new Set();
  const out = [];
  tables.forEach(t => {
    const used = new Map();
    const keys = t.headers.map(h => {
      const n = (used.get(h) || 0) + 1;
      used.set(h, n);
      return n === 1 ? String(h) : `${h} (${n})`;
    });
    keys.forEach(k => {
      if (seen.has(k) || drop.includes(k)) return;
      seen.add(k);
      columns.push({ key: k, label: labelOf(k), ...(HIDDEN_COLUMNS.includes(k) ? { hidden: true } : {}) });
    });
    t.rows.forEach((r, i) => {
      const obj = {};
      keys.forEach((k, j) => { if (!drop.includes(k)) obj[k] = r[j] === undefined || r[j] === null ? '' : r[j]; });
      if (keep && !keep(obj)) return;
      out.push({ row: obj, sort: t.sortKeys ? t.sortKeys[i] : 0, order: out.length });
    });
  });
  out.sort((a, b) => (a.sort === b.sort ? a.order - b.order : (a.sort < b.sort ? 1 : -1)));
  return { columns, rows: out.map(o => o.row) };
}

// The kind of History a metric has (see the header)
async function historyKindOf(metric) {
  if (isDataNotAvailable(metric)) return 'NOT_AVAILABLE';
  if ((await storage.getMetricParts(metric.metric_id)).length) return 'PARTS';
  if (metric.metric_type === 'SURVEY') return isEssMetric(metric) ? 'ESS' : 'SURVEY_RESPONSES';
  if (metric.metric_id === LIVE_EVENT_METRIC_ID) return 'EVENT_ATTENDANCE';
  if (isOutcomeUploadMetric(metric) && (await storage.getOutcomeValues(metric.metric_id)).length) return 'OUTCOME_VALUES';
  return 'OPERATIONAL';
}

/**
 * History of one metric.
 *   period       : the evidence period string ('YTD' | 'YYYY' | 'YYYY-MM' | 'ALL')
 *   mp           : the same period parsed (outcomeValueService.parseEvidencePeriod)
 *   seesIdentity : the viewer may see respondent / attendee identities
 *   scopes       : null = every row; otherwise the viewer's scope list (employee metrics of a non-Admin)
 *   operational  : async () => the detail's { operational_records, operational_records_hidden } (OPERATIONAL only)
 * Returns { kind, columns, rows, total, identity_hidden, scope_limited, reason, notes (v2.57.0: question set changed in the period) }.
 */
async function buildMetricHistory(metric, { period, mp, seesIdentity, scopes, operational }) {
  const kind = await historyKindOf(metric);
  const base = { metric_id: metric.metric_id, kind, period, identity_hidden: !seesIdentity, scope_limited: !!scopes, reason: null };
  const dirs = scopes ? scopes.map(s => s.directorate) : null;
  let table;
  let notes = [];
  if (kind === 'NOT_AVAILABLE') {
    return { ...base, columns: [], rows: [], total: 0, reason: DATA_NOT_AVAILABLE_REASON };
  } else if (kind === 'PARTS') {
    const parts = (await storage.getMetricParts(metric.metric_id)).slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const tables = [];
    for (const part of parts) tables.push(await partEvidenceTable(metric, part, mp));
    notes = tables.map(t => t.note).filter(Boolean); // v2.57.0: a part whose questions changed within the period
    // a scope-limited viewer gets the directorate rows of their own directorates (the Bankwide row is for the Admin)
    table = mergeTables(tables, { keep: dirs ? r => r.Level === 'Directorate' && dirs.includes(r.Directorate) : null });
  } else if (kind === 'ESS') {
    table = mergeTables((await essEvidenceTables(metric, { scopes })).versions);
  } else if (kind === 'SURVEY_RESPONSES') {
    const { versions } = await generateSurveyEvidence(metric.metric_id, period, { scopes, tablesOnly: true });
    table = mergeTables(versions, { drop: seesIdentity ? [] : versions.flatMap(v => v.identity) });
  } else if (kind === 'EVENT_ATTENDANCE') {
    const t = await outcomeEvidenceTable(metric, mp);
    table = mergeTables([t], {
      drop: seesIdentity ? [] : t.identity,
      keep: scopes ? r => rowInScopes(scopes, r.Directorate || '', r.Division || '') : null
    });
  } else if (kind === 'OUTCOME_VALUES') {
    table = mergeTables([await outcomeEvidenceTable(metric, mp)]);
  } else {
    const detail = await operational();
    const records = detail && !detail.operational_records_hidden ? (detail.operational_records || []) : [];
    const headers = [...new Set(records.flatMap(r => Object.keys(r)))];
    table = mergeTables([{ headers, rows: records.map(r => headers.map(h => (typeof r[h] === 'object' && r[h] !== null ? JSON.stringify(r[h]) : r[h]))), sortKeys: null }]);
  }
  return { ...base, columns: table.columns, rows: table.rows, total: table.rows.length, notes };
}

module.exports = { buildMetricHistory, historyKindOf, mergeTables };
