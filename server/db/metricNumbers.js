// server/db/metricNumbers.js
// Display number of a metric (v2.58.0). metric_id stays the backend key (API routes, storage, CSV metric_id column), but the
// UI shows display_no: the 1-based position of the metric when all EXISTING metrics are ordered by journey (journey_id, the
// order the app shows its journeys in) and then by metric_id inside the journey. A deleted metric leaves no gap (the next
// ones move up) and a new metric (max id + 1) becomes the last number of its journey, shifting the later journeys by one.

// Map metric_id -> display_no for the given metric and journey lists. Metrics of an unknown journey come last.
function displayNumberMap(metrics, journeys = []) {
  const journeyRank = new Map([...(journeys || [])]
    .sort((a, b) => a.journey_id - b.journey_id)
    .map((j, i) => [j.journey_id, i]));
  const rank = m => (journeyRank.has(m.journey_id) ? journeyRank.get(m.journey_id) : Number.MAX_SAFE_INTEGER);
  const ordered = [...(metrics || [])].sort((a, b) => rank(a) - rank(b) || (a.journey_id || 0) - (b.journey_id || 0) || a.metric_id - b.metric_id);
  return new Map(ordered.map((m, i) => [m.metric_id, i + 1]));
}

// Reads the metrics and journeys from storage (either backend) and returns the map above.
async function loadDisplayNumbers(storage) {
  const [metrics, journeys] = await Promise.all([storage.getMetrics(), storage.getJourneys()]);
  return displayNumberMap(metrics, journeys);
}

// Copies of the given objects (anything carrying metric_id) with display_no added (null when the metric no longer exists).
function withDisplayNo(list, numbers) {
  return (list || []).map(o => ({ ...o, display_no: numbers.get(Number(o.metric_id)) ?? null }));
}

module.exports = { displayNumberMap, loadDisplayNumbers, withDisplayNo };
