// server/db/scopeUtils.js
// Data scope of a login (v2.27.0). A scope list is [{ directorate, divisions }] where
// divisions = null means "every division of that directorate" and an array means only those
// divisions. Shared by BOTH storage backends, authService and the calculation engine so the
// meaning of a scope can never drift between SQL and JSON.

const clean = v => (typeof v === 'string' ? v.trim() : '');

/**
 * Normalises any scope input into the canonical form: one entry per directorate (names
 * trimmed, duplicates merged), "all divisions" (null) absorbs any listed subset, divisions
 * de-duplicated. Entries without a directorate are dropped. Always returns an array.
 */
function normalizeScopes(list) {
  const byDir = new Map(); // directorate -> Set(divisions) | null (all)
  (Array.isArray(list) ? list : []).forEach(item => {
    if (!item) return;
    const dir = clean(item.directorate);
    if (!dir) return;
    const divs = Array.isArray(item.divisions) ? item.divisions.map(clean).filter(Boolean) : [];
    if (divs.length === 0) { byDir.set(dir, null); return; } // null / [] = all divisions
    if (byDir.has(dir) && byDir.get(dir) === null) return;   // already "all"
    const set = byDir.get(dir) || new Set();
    divs.forEach(d => set.add(d));
    byDir.set(dir, set);
  });
  return [...byDir.entries()].map(([directorate, set]) => ({ directorate, divisions: set === null ? null : [...set] }));
}

// Is (directorate, division) inside the scope list? division may be omitted/'ALL' = "any division of the directorate".
function scopeAllows(scopes, directorate, division) {
  const entry = (scopes || []).find(s => s.directorate === directorate);
  if (!entry) return false;
  if (!division || division === 'ALL') return true;
  return entry.divisions === null || entry.divisions.includes(division);
}

// One row (an object with directorate / division, or the org-unit aliases) against a scope list.
function rowInScopes(scopes, directorate, division) {
  return (scopes || []).some(s => s.directorate === directorate && (s.divisions === null || s.divisions.includes(division)));
}

// v2.26.0 accounts had ONE directorate + ONE division. A USER with a directorate becomes one scope entry
// (division empty = every division); anyone else has no scope. Used by the JSON backend's boot migration.
function legacyUserScopes(u) {
  if (!u || u.role !== 'USER' || !clean(u.directorate)) return [];
  return normalizeScopes([{ directorate: u.directorate, divisions: clean(u.division) ? [u.division] : null }]);
}

module.exports = { normalizeScopes, scopeAllows, rowInScopes, legacyUserScopes };
