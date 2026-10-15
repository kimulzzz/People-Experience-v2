// src/utils/apiClient.js
// Login support for every API call in the app. Installed once (main.jsx): it wraps window.fetch so that
//  * requests to this app's own /api, /uploads and /exports always send the session cookie
//    (credentials: 'same-origin'), and
//  * a 401 answer from any of them (session expired / logged out elsewhere) raises the
//    'px:unauthorized' event, which App.jsx turns into "back to the login page".
// The login request itself is exempt (a wrong password is also a 401 but must stay on the form).
// Components keep calling plain fetch()/fetchWithRetry(); nothing else needs to change.
const isAppUrl = (url) => typeof url === 'string' && /^\/(api|uploads|exports)(\/|\?|$)/.test(url);

export const UNAUTHORIZED_EVENT = 'px:unauthorized';

export function installApiClient() {
  if (window.__pxApiClientInstalled) return;
  window.__pxApiClientInstalled = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (!isAppUrl(url)) return originalFetch(input, init);
    const res = await originalFetch(input, { credentials: 'same-origin', ...(init || {}) });
    if (res.status === 401 && !url.startsWith('/api/auth/login')) {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    return res;
  };
}
