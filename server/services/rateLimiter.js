// server/services/rateLimiter.js
// Tiny in-memory sliding-window counter (per key, e.g. client IP). Used to slow down password
// guessing on POST /api/auth/login. In-memory is enough here: the app is a single on-premise
// process, and the per-account lockout (px_users.locked_until) is the durable defence.
function createRateLimiter({ windowMs = 60 * 1000 } = {}) {
  const hits = new Map(); // key -> [timestamps]

  function prune(key, now) {
    const list = (hits.get(key) || []).filter(t => now - t < windowMs);
    if (list.length) hits.set(key, list); else hits.delete(key);
    return list;
  }

  return {
    // Number of recorded failures for `key` inside the window.
    count(key, now = Date.now()) {
      return prune(key, now).length;
    },
    isBlocked(key, max, now = Date.now()) {
      return prune(key, now).length >= max;
    },
    record(key, now = Date.now()) {
      const list = prune(key, now);
      list.push(now);
      hits.set(key, list);
    },
    // Milliseconds until the oldest failure leaves the window (0 when not blocked).
    retryAfterMs(key, now = Date.now()) {
      const list = prune(key, now);
      return list.length ? Math.max(0, windowMs - (now - list[0])) : 0;
    },
    reset(key) {
      hits.delete(key);
    }
  };
}

module.exports = { createRateLimiter };
