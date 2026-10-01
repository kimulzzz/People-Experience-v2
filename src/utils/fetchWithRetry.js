// src/utils/fetchWithRetry.js
// `npm run dev` launches the Express backend (port 5000) and the Vite frontend (port 3000)
// concurrently with no readiness handshake between them, so any fetch fired in the first
// couple of seconds after the dev server starts (initial dashboard load, trend chart mount)
// can hit the backend before it has finished booting — surfacing either a 502 from Vite's
// proxy or a raw "Failed to fetch" network error straight to the user. This retries through
// that startup window instead of letting it reach the UI as a permanent error.
export async function fetchWithRetry(url, options, { retries = 4, delayMs = 600 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if ([502, 503, 504].includes(res.status) && attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt >= retries) throw err;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw lastErr;
}
