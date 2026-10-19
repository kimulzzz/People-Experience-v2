// server/db/directorateMigration.js
// v2.31.0: the directorate master is the bank's 12 real directorates (the ESS 2025 result file) instead of
// the 8 demo directorates. Data that still carries an old demo name is renamed in place at boot by both
// storage backends using the mapping below (a division override first, then the directorate default).
// Division names never change - a division is only re-parented. Names are compared trimmed and
// case-insensitive. Human Resources and Risk Management keep their name, so every new name maps to
// itself and running the migration again changes nothing. Shared by sqlStorage + jsonStorage so the
// mapping can never drift between the two backends.
const { normalizeScopes } = require('./scopeUtils');

const key = v => (typeof v === 'string' ? v.trim().toLowerCase() : '');

const DIRECTORATE_RENAMES = [
  { from: 'Commercial & Corporate Banking', to: 'Business Banking', divisions: { 'Investment Banking & Markets': 'Treasury & Capital Market' } },
  { from: 'Consumer Banking', to: 'Consumer & EBB' },
  { from: 'Digital Banking', to: 'Network & Digital Banking' },
  { from: 'Finance & Operations', to: 'Strategy, Finance & SPAPM', divisions: { 'Treasury Operations': 'Treasury & Capital Market', 'Central Operations & Services': 'Operations, Technology, Analytics & AI' } },
  { from: 'Human Resources', to: 'Human Resources' },
  { from: 'Information Technology', to: 'Operations, Technology, Analytics & AI' },
  { from: 'Internal Audit & Legal', to: 'Compliance, Corporate Affairs & Legal', divisions: { 'Internal Audit Group': 'Corporate Assurance' } },
  { from: 'Risk Management', to: 'Risk Management' }
];

const BY_KEY = new Map(DIRECTORATE_RENAMES.map(r => [key(r.from), {
  to: r.to,
  overrides: Object.entries(r.divisions || {}),
  byDivision: new Map(Object.entries(r.divisions || {}).map(([div, to]) => [key(div), to]))
}]));

// The new directorate of (directorate, division), or null when the directorate is not an old demo name.
function mapDirectorate(directorate, division) {
  const r = BY_KEY.get(key(directorate));
  if (!r) return null;
  return r.byDivision.get(key(division)) || r.to;
}

// The new name only when the stored text has to change (null = keep the row as it is).
function renamedDirectorate(directorate, division) {
  const to = mapDirectorate(directorate, division);
  return to !== null && to !== directorate ? to : null;
}

// Directory [{ directorate_name, divisions }] -> null when nothing has to change, otherwise the new
// directory: the seed's directorates in seed order, every existing division re-parented, then any
// directorate that is neither old nor in the seed (kept with its divisions).
function planDirectory(current, seedDirectorates) {
  const list = (current || []).map(d => ({ name: d.directorate_name || d.name, divisions: d.divisions || d.sub_directorates || [] }));
  const needed = list.some(d => renamedDirectorate(d.name, null) || d.divisions.some(div => renamedDirectorate(d.name, div)));
  if (!needed) return null;
  const out = seedDirectorates.map(d => ({ directorate_name: d.directorate_name, divisions: [] }));
  const entry = name => {
    let e = out.find(x => key(x.directorate_name) === key(name));
    if (!e) { e = { directorate_name: name, divisions: [] }; out.push(e); }
    return e;
  };
  let removed = 0;
  let moved = 0;
  list.forEach(d => {
    const own = mapDirectorate(d.name, null) || d.name;
    if (own !== d.name) removed++;
    entry(own);
    d.divisions.forEach(div => {
      const target = entry(mapDirectorate(d.name, div) || d.name);
      if (target.directorate_name !== d.name) moved++;
      if (!target.divisions.some(x => key(x) === key(div))) target.divisions.push(div);
    });
  });
  return { directorates: out, removed, moved };
}

// A login's scope list -> null when unchanged, otherwise the new list. "All divisions" of an old
// directorate becomes "all divisions" of its default directorate PLUS each override division, so the
// account keeps exactly the same data access.
function migrateScopes(scopes) {
  const before = normalizeScopes(scopes);
  const next = [];
  before.forEach(s => {
    const r = BY_KEY.get(key(s.directorate));
    if (!r) { next.push(s); return; }
    if (s.divisions === null) {
      next.push({ directorate: r.to, divisions: null });
      r.overrides.forEach(([div, to]) => next.push({ directorate: to, divisions: [div] }));
    } else {
      s.divisions.forEach(div => next.push({ directorate: mapDirectorate(s.directorate, div), divisions: [div] }));
    }
  });
  const after = normalizeScopes(next);
  return JSON.stringify(after) === JSON.stringify(before) ? null : after;
}

// Option list [{ value, label }] holding directorate names (e.g. event_manager_directorates) -> null
// when unchanged, otherwise the renamed list (a label equal to the old name follows the new name).
function migrateDirectorateOptions(options) {
  if (!Array.isArray(options)) return null;
  let changed = false;
  const out = [];
  options.forEach(opt => {
    const value = opt && typeof opt === 'object' ? opt.value : opt;
    const to = renamedDirectorate(value, null);
    let next = opt;
    if (to) {
      changed = true;
      next = opt && typeof opt === 'object'
        ? { ...opt, value: to, label: key(opt.label) === key(value) ? to : opt.label }
        : to;
    }
    const nextValue = next && typeof next === 'object' ? next.value : next;
    if (out.some(o => key(o && typeof o === 'object' ? o.value : o) === key(nextValue))) { changed = true; return; }
    out.push(next);
  });
  return changed ? out : null;
}

// Settings whose value is a list of directorate options.
const DIRECTORATE_SETTING_KEYS = ['event_manager_directorates'];

module.exports = {
  DIRECTORATE_RENAMES,
  DIRECTORATE_SETTING_KEYS,
  mapDirectorate,
  renamedDirectorate,
  planDirectory,
  migrateScopes,
  migrateDirectorateOptions
};
