// src/utils/menuAccess.js
// The 6 main menus in navigation order (v2.49.0) and which of them an account may open. `key` is the menu_access key the
// server stores and enforces (server/db/menuAccess.js), `tab` is App.jsx's activeTab id. An Admin always has every menu;
// a User's map comes from the session (user.menu_access). The UI only hides - the server answers 403 for `events`,
// `exit_interview` and `action_library`.
export const MENU_TABS = [
  { key: 'dashboard', tab: 'dashboard', label: 'Dashboard & Trends' },
  { key: 'explore', tab: 'calculator', label: 'Explore Metrics' },
  { key: 'exit_interview', tab: 'exit-interview', label: 'Exit Interview' },
  { key: 'action_library', tab: 'alerts', label: 'Action Library & AI Alerts' },
  { key: 'events', tab: 'events', label: 'Signature Program Events' },
  { key: 'about', tab: 'glossary', label: 'About' }
];

// Same defaults as the server: everything except Signature Program Events.
export const DEFAULT_USER_MENU_ACCESS = { dashboard: true, explore: true, exit_interview: true, action_library: true, events: false, about: true };

export function effectiveMenuAccess(isAdmin, menuAccess) {
  if (isAdmin) return MENU_TABS.reduce((o, m) => ({ ...o, [m.key]: true }), {});
  const out = { ...DEFAULT_USER_MENU_ACCESS };
  MENU_TABS.forEach(m => { if (menuAccess && typeof menuAccess[m.key] === 'boolean') out[m.key] = menuAccess[m.key]; });
  return out;
}

// The tab ids this account may open, in navigation order.
export const allowedTabs = (isAdmin, menuAccess) => {
  const access = effectiveMenuAccess(isAdmin, menuAccess);
  return MENU_TABS.filter(m => access[m.key]).map(m => m.tab);
};
