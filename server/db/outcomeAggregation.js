// server/db/outcomeAggregation.js
// How an OUTCOME metric with uploaded monthly values (px_outcome_values) is read for a period (v2.55.0), shared by both
// storage backends (stored configuration) and outcomeValueService (scoring + upload layout):
//   LATEST  (default, also when NULL) - the latest stored month inside the window; upload = Year | Month | Value | Notes rows
//   AVERAGE - the average of the stored months inside the window (YTD = the months of that year up to the window end,
//             MTD = that month only); upload = one year as a row of months (Jan..Dec columns, the year chosen at upload),
//             and an upload of year Y replaces every stored month of Y.
// Stored in px_metrics.outcome_aggregation (NULL on SURVEY metrics); metrics 1 and 3 get AVERAGE once at boot while it is NULL.

const OUTCOME_AGGREGATIONS = ['LATEST', 'AVERAGE'];

// The stored value as a valid aggregation, or null (not set / unreadable) - never throws (reading the database).
function readOutcomeAggregation(stored) {
  const v = stored === undefined || stored === null ? '' : String(stored).trim().toUpperCase();
  return OUTCOME_AGGREGATIONS.includes(v) ? v : null;
}

// The value to store when a metric is created / edited: null for a non-OUTCOME metric, the current one when nothing was
// sent, else the requested one (an Error on bad input - the admin routes answer 400).
function resolveOutcomeAggregation(requested, current, metricType) {
  if (String(metricType || '').toUpperCase() !== 'OUTCOME') return null;
  if (requested === undefined || requested === null || requested === '') return readOutcomeAggregation(current);
  const v = String(requested).trim().toUpperCase();
  if (!OUTCOME_AGGREGATIONS.includes(v)) throw new Error('outcome_aggregation must be LATEST or AVERAGE.');
  return v;
}

const isAverageOutcome = m => !!m && m.metric_type === 'OUTCOME' && readOutcomeAggregation(m.outcome_aggregation) === 'AVERAGE';

module.exports = { OUTCOME_AGGREGATIONS, readOutcomeAggregation, resolveOutcomeAggregation, isAverageOutcome };
