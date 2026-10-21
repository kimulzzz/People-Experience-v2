// server/db/dataStatus.js
// v2.55.0: per-metric switch "Real data not available yet" (px_metrics.data_status), shared by both storage backends and the
// calculation engine. NOT_AVAILABLE = the metric is N/A: no value / score (status NO_DATA + not_applicable), left out of every
// index, journey rollup, alert, trend and the PX Index by directorate; its detail shows no records. Stored data is never
// deleted - once the Admin unticks the switch (AVAILABLE) the metric counts again. NULL = AVAILABLE (never set);
// the boot sets the seed metrics marked NOT_AVAILABLE (4, 6, 8, 10, 23, 26) once while the column is NULL.

const DATA_STATUSES = ['AVAILABLE', 'NOT_AVAILABLE'];
const DATA_NOT_AVAILABLE_REASON = 'Real data not available yet';

function readDataStatus(stored) {
  const v = stored === undefined || stored === null ? '' : String(stored).trim().toUpperCase();
  return DATA_STATUSES.includes(v) ? v : null;
}

/**
 * The value to store when a metric is created / edited. Accepts data_status ('AVAILABLE' | 'NOT_AVAILABLE') or the boolean
 * data_not_available (the Admin Parameters checkbox); nothing sent -> the current value. Throws on bad input (400).
 */
function resolveDataStatus(metricData, current) {
  const d = metricData || {};
  if (d.data_status !== undefined && d.data_status !== null && d.data_status !== '') {
    const v = String(d.data_status).trim().toUpperCase();
    if (!DATA_STATUSES.includes(v)) throw new Error('data_status must be AVAILABLE or NOT_AVAILABLE.');
    return v;
  }
  if (d.data_not_available !== undefined && d.data_not_available !== null) {
    if (typeof d.data_not_available !== 'boolean') throw new Error('data_not_available must be true or false.');
    return d.data_not_available ? 'NOT_AVAILABLE' : 'AVAILABLE';
  }
  return readDataStatus(current);
}

const isDataNotAvailable = m => !!m && readDataStatus(m.data_status) === 'NOT_AVAILABLE';

module.exports = { DATA_STATUSES, DATA_NOT_AVAILABLE_REASON, readDataStatus, resolveDataStatus, isDataNotAvailable };
