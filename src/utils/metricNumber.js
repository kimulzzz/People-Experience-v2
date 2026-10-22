// The number shown for a metric (v2.58.0): display_no from the server = its position in journey order, without gaps
// after a deletion. metric_id stays the key for API calls and React keys and is never shown.
export const metricNo = m => (m && m.display_no != null ? m.display_no : '-');

// Sort comparator: the order of the display numbers (metrics without one last).
export const byDisplayNo = (a, b) => (a.display_no ?? Number.MAX_SAFE_INTEGER) - (b.display_no ?? Number.MAX_SAFE_INTEGER);
