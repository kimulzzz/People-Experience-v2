// server/db/menuAccess.js
// Menu access of a login (v2.49.0). Every USER account has a set of the 6 main menus it may open; an ADMIN always
// has all of them (not editable). Stored as px_users.menu_access (JSON) / auth.json `menu_access`: NULL = the
// defaults below. Shared by BOTH storage backends and authService so the meaning can never drift between SQL and JSON.
//
// Server-side enforcement: `events` (every Signature Program Events API except the public check-in / feedback
// routes) and `exit_interview` (/api/exit-interview/*) and `action_library` (GET /api/action-library). Dashboard,
// Explore Metrics and About share the scorecard APIs (or are static), so they are only hidden in the UI.

const MENU_KEYS = ['dashboard', 'explore', 'exit_interview', 'action_library', 'events', 'about'];

// A new / existing USER: everything except Signature Program Events (the Admin ticks it for HR Strategy users).
const DEFAULT_USER_MENU_ACCESS = Object.freeze({
  dashboard: true, explore: true, exit_interview: true, action_library: true, events: false, about: true
});

const ALL_MENUS = Object.freeze(MENU_KEYS.reduce((o, k) => ({ ...o, [k]: true }), {}));

// Stored value (object, JSON text or null) -> the effective full map for this role. Unknown keys and non-boolean
// values in the stored data are ignored (the default applies).
function effectiveMenuAccess(stored, role) {
  if (role === 'ADMIN') return { ...ALL_MENUS };
  let raw = stored;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch (_) { raw = null; }
  }
  const out = { ...DEFAULT_USER_MENU_ACCESS };
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    MENU_KEYS.forEach(k => { if (typeof raw[k] === 'boolean') out[k] = raw[k]; });
  }
  return out;
}

// Request body value -> { patch } (only the keys sent, all valid) or { error }. Every key must be one of MENU_KEYS
// and every value true/false; keys not sent keep their current value.
function validateMenuAccessInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'menu_access must be an object of menu: true/false.' };
  const unknown = Object.keys(input).filter(k => !MENU_KEYS.includes(k));
  if (unknown.length) return { error: `Unknown menu "${unknown[0]}" in menu_access (allowed: ${MENU_KEYS.join(', ')}).` };
  const bad = Object.keys(input).find(k => typeof input[k] !== 'boolean');
  if (bad) return { error: `menu_access.${bad} must be true or false.` };
  return { patch: { ...input } };
}

const hasMenu = (user, key) => !!user && (user.role === 'ADMIN' || effectiveMenuAccess(user.menu_access, user.role)[key] === true);

// Short, secret-free text for the audit trail, e.g. "events:off->on, exit_interview:on->off".
function describeMenuChange(before, after) {
  return MENU_KEYS.filter(k => before[k] !== after[k]).map(k => `${k}:${before[k] ? 'on' : 'off'}->${after[k] ? 'on' : 'off'}`).join(', ');
}

// v2.49.0 upgrade: the setting event_manager_directorates no longer grants anything. A USER whose scope covered one of
// those directorates (the old "event manager") keeps Signature Program Events through menu_access instead.
function coversEventManagerDirectorate(scopes, eventManagerDirectorates) {
  const wanted = (Array.isArray(eventManagerDirectorates) ? eventManagerDirectorates : [])
    .map(o => String((o && o.value !== undefined ? o.value : o) || '').trim().toLowerCase()).filter(Boolean);
  return (Array.isArray(scopes) ? scopes : []).some(s => s && wanted.includes(String(s.directorate || '').trim().toLowerCase()));
}

module.exports = {
  MENU_KEYS, DEFAULT_USER_MENU_ACCESS, effectiveMenuAccess, validateMenuAccessInput, hasMenu, describeMenuChange, coversEventManagerDirectorate
};
