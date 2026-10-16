// server/services/authService.js
// Local login (no AD/LDAP) with two roles, ADMIN and USER:
//  * passwords: crypto.scrypt with a per-user salt, compared with timingSafeEqual (no extra dependency);
//  * sessions: random 32-byte token in an httpOnly SameSite=Strict cookie; only its SHA-256 is stored
//    (px_sessions), so a database leak does not leak usable sessions;
//  * every /api/* route needs a session except a short public whitelist (see PUBLIC_ROUTES);
//  * secrets (password_hash, token hashes) are never returned by any endpoint and never logged.
const crypto = require('crypto');
const storage = require('../db/storage');
const { createRateLimiter } = require('./rateLimiter');
const { normalizeScopes, scopeAllows, rowInScopes } = require('../db/scopeUtils');

const COOKIE_NAME = 'px_session';
const ROLES = ['ADMIN', 'USER'];
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const MAX_PASSWORD_LENGTH = 128;
const GENERIC_LOGIN_ERROR = 'Username atau password salah, atau akun tidak dapat digunakan saat ini.';

// ------------------------------------------------------------------ password hashing
const scryptAsync = (password, salt, opts) => new Promise((resolve, reject) => {
  crypto.scrypt(password, salt, opts.keylen, { N: opts.N, r: opts.r, p: opts.p }, (err, key) => (err ? reject(err) : resolve(key)));
});

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(String(password), salt, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltB64, keyB64] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const expected = Buffer.from(keyB64, 'base64');
    const actual = await scryptAsync(String(password), Buffer.from(saltB64, 'base64'),
      { N: parseInt(N, 10), r: parseInt(r, 10), p: parseInt(p, 10), keylen: expected.length });
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch (_) {
    return false;
  }
}

// A throw-away hash so login for an unknown/disabled username costs the same time as a real check.
let dummyHashPromise = null;
const getDummyHash = () => (dummyHashPromise = dummyHashPromise || hashPassword(crypto.randomBytes(12).toString('hex')));

// Random temporary password (shown ONCE to the admin). No look-alike characters.
function generateTempPassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ', lower = 'abcdefghijkmnpqrstuvwxyz', digits = '23456789';
  const all = upper + lower + digits;
  const pick = set => set[crypto.randomInt(set.length)];
  const chars = [pick(upper), pick(lower), pick(digits)];
  while (chars.length < 12) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

// Standard initial password (env DEFAULT_INITIAL_PASSWORD, read at call time; never stored in code, the database
// in clear text or any log). Empty/unset = every new/reset account gets a random temporary password instead.
// It is system-made, so it is exempt from validateNewPassword; the account still has to change it at first login.
function getDefaultInitialPassword() {
  const v = process.env.DEFAULT_INITIAL_PASSWORD;
  return typeof v === 'string' && v.trim() ? v : null;
}
function makeInitialPassword() {
  const def = getDefaultInitialPassword();
  return def ? { password: def, isDefault: true } : { password: generateTempPassword(), isDefault: false };
}

// Returns an error message, or null when the password is acceptable.
function validateNewPassword(password, user) {
  if (typeof password !== 'string') return 'Password baru wajib diisi.';
  if (password.length < 10) return 'Password baru minimal 10 karakter.';
  if (password.length > MAX_PASSWORD_LENGTH) return `Password baru maksimal ${MAX_PASSWORD_LENGTH} karakter.`;
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Password baru harus mengandung huruf dan angka.';
  if (user && password.toLowerCase() === String(user.username).toLowerCase()) return 'Password tidak boleh sama dengan username.';
  return null;
}

// ------------------------------------------------------------------ settings (px_app_settings)
async function getAuthSettings() {
  const s = await storage.getSettings();
  const num = (v, def) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : def);
  return {
    sessionHours: num(s.session_hours, 8),
    maxAttempts: Math.floor(num(s.login_max_attempts, 5)),
    lockoutMinutes: num(s.login_lockout_minutes, 15),
    rateLimitPerMinute: Math.floor(num(s.login_rate_limit_per_minute, 20)),
    eventManagerDirectorates: (Array.isArray(s.event_manager_directorates) ? s.event_manager_directorates : [])
      .map(o => String((o && o.value) || '').trim().toLowerCase()).filter(Boolean)
  };
}

// ------------------------------------------------------------------ users: shapes & permissions
// `scopes` is the data scope of a USER ([{ directorate, divisions: [..] | null }], null = all divisions of
// that directorate; an ADMIN has none and reads everything). `directorate` / `division` are kept only as a
// read-only convenience for v2.26.0 clients: the first scope's directorate and, when the account has exactly
// one single-division scope, that division.
function toPublicUser(u) {
  if (!u) return null;
  const { password_hash, directorate: _d, division: _v, ...rest } = u; // eslint-disable-line no-unused-vars
  const scopes = normalizeScopes(u.scopes);
  const first = scopes[0];
  return {
    ...rest,
    scopes,
    directorate: first ? first.directorate : null,
    division: scopes.length === 1 && first.divisions && first.divisions.length === 1 ? first.divisions[0] : null
  };
}

// An event manager is an Admin, or a User whose scope COVERS at least one of the directorates in the
// event_manager_directorates setting (any division - the scope entry only has to name the directorate).
async function isEventManager(user) {
  if (!user) return false;
  if (user.role === 'ADMIN') return true;
  const scopes = normalizeScopes(user.scopes);
  if (!scopes.length) return false;
  const { eventManagerDirectorates } = await getAuthSettings();
  return scopes.some(s => eventManagerDirectorates.includes(s.directorate.toLowerCase()));
}

// ---- PIC of a metric (v2.27.1). The PIC is still assigned in Parameter Admin (pic_name / pic_email of a SURVEY
// metric; since v2.29.0 EVERY SURVEY metric - SYSTEM or ESS, with or without the reminder flag - can be uploaded by hand,
// e.g. while the source system is down; requires_manual_upload now only decides whether reminder e-mails are sent);
// a USER account is that metric's PIC when its e-mail equals the metric's pic_email (case-insensitive, trimmed). Read from the database on every call - nothing is cached, so editing
// pic_email (or the account's e-mail / active flag) changes the rights from the very next request. A metric
// can have one PIC e-mail; one account can be PIC of many metrics. An ADMIN is not "a PIC": Admin may do
// everything anyway, so these helpers return nothing for an Admin.
const normEmail = v => String(v === undefined || v === null ? '' : v).trim().toLowerCase();
const isPicMetric = m => !!m && m.metric_type === 'SURVEY';

// The metrics this account is PIC of (metric objects). [] for an Admin, a missing/inactive account or one without e-mail.
async function picMetrics(user) {
  if (!user || user.role !== 'USER' || user.is_active === false) return [];
  const mine = normEmail(user.email);
  if (!mine) return [];
  return (await storage.getMetrics()).filter(m => isPicMetric(m) && normEmail(m.pic_email) === mine);
}
async function picMetricIds(user) {
  return (await picMetrics(user)).map(m => m.metric_id);
}
// metricRef = a metric object ({ metric_id }) or an id. The id must be a plain integer ("7abc", arrays, "ALL" -> false).
async function getPicMetric(user, metricRef) {
  const raw = metricRef && typeof metricRef === 'object' ? metricRef.metric_id : metricRef;
  if (typeof raw !== 'number' && typeof raw !== 'string') return null;
  if (!/^\d{1,9}$/.test(String(raw))) return null;
  const id = parseInt(String(raw), 10);
  return (await picMetrics(user)).find(m => m.metric_id === id) || null;
}
async function isPicOfMetric(user, metricRef) {
  return !!(await getPicMetric(user, metricRef));
}

// Per-respondent data (name / NIP / e-mail in metric detail, the evidence CSV, the responses list): the Admin,
// or the PIC of that metric (and then only for rows inside the PIC's own data scope - see rowsForViewer).
async function canSeeRespondentData(user, metricRef) {
  if (!user) return false;
  if (user.role === 'ADMIN') return true;
  return isPicOfMetric(user, metricRef);
}

// The scope list to apply to a PIC's respondent rows of `metric`: null = no restriction (Admin, or a non-employee
// metric such as campus / candidates, which has no directorate and is already read bankwide by every User).
function respondentScopeFor(user, metric) {
  if (!user || user.role === 'ADMIN') return null;
  if (metric && metric.is_employee_metric === false) return null;
  return normalizeScopes(user.scopes);
}
// Keeps only the respondent rows the viewer may see (same row test as the calculation engine's scope filter).
function rowsForViewer(user, metric, rows) {
  const scopes = respondentScopeFor(user, metric);
  if (scopes === null) return rows;
  return rows.filter(r => rowInScopes(scopes, r.directorate || r.university || r.applied_position || '', r.division || r.major || r.recruitment_channel || ''));
}

// Gate for the manual-upload family of routes. Admin passes (any metric). A USER must be PIC: not a PIC at all or
// not of THIS metric -> 403; metric missing/malformed -> 400 (only reported to somebody who is a PIC).
// Returns { metric } (metric = null for an Admin without a metric_id) or answers and returns null.
async function requirePicMetric(req, res, metricRef, { required = true } = {}) {
  if (req.user.role === 'ADMIN') return { metric: null };
  const mine = await picMetrics(req.user);
  if (!mine.length) { res.status(403).json({ error: 'Hanya Admin atau PIC metrik yang dapat menggunakan fitur ini.' }); return null; }
  if (metricRef === undefined || metricRef === null || metricRef === '' || metricRef === 'ALL') {
    if (required) { res.status(400).json({ error: 'metric_id wajib diisi (pilih salah satu metrik PIC Anda).' }); return null; }
    return { metric: null, mine };
  }
  const metric = await getPicMetric(req.user, metricRef);
  if (!metric) { res.status(403).json({ error: 'Anda bukan PIC metrik tersebut.' }); return null; }
  return { metric, mine };
}

const IDENTITY_FIELDS = ['nip', 'employee_name', 'cimb_email', 'email', 'participant_id', 'participant_name', 'candidate_id', 'candidate_name'];
// Walks the WHOLE value (nested objects/arrays, e.g. questions[].verbatim_samples[].employee_name) and
// blanks every identity field, so no payload can leak a respondent's name through a nested list.
function redactRespondent(value) {
  if (Array.isArray(value)) return value.map(redactRespondent);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = IDENTITY_FIELDS.includes(k) ? null : redactRespondent(v);
    return out;
  }
  return value;
}

// What a request may read (v2.27.0). ADMIN: whatever was asked, no scope restriction.
// USER: only inside their scope list. Missing / 'ALL' directorate = "all my scope" (the UNION of every scope
// entry); a named directorate must be one of theirs and a named division must be allowed inside it, otherwise
// the request is refused. Returns { directorate, sub_directorate, scopes } or { error }:
//  - scopes = null for an Admin, else the entries that apply (already narrowed to the requested directorate /
//    division), to be passed to the calculation engine as the union filter;
//  - directorate = the one directorate when exactly one is left, else 'ALL'.
function resolveScope(user, requestedDirectorate, requestedDivision) {
  const dirReq = requestedDirectorate && requestedDirectorate !== 'ALL' ? String(requestedDirectorate) : 'ALL';
  const divReq = requestedDivision && requestedDivision !== 'ALL' ? String(requestedDivision) : 'ALL';
  if (!user || user.role === 'ADMIN') return { directorate: dirReq, sub_directorate: divReq, scopes: null };
  const mine = normalizeScopes(user.scopes);
  if (!mine.length) return { error: 'Akun Anda belum memiliki cakupan data. Hubungi Admin.' };

  let applicable = mine;
  if (dirReq !== 'ALL') {
    applicable = mine.filter(s => s.directorate === dirReq);
    if (!applicable.length) return { error: 'Direktorat tersebut di luar cakupan data Anda.' };
  }
  if (divReq !== 'ALL') {
    // keep only the entries that allow this division
    applicable = applicable.filter(s => scopeAllows([s], s.directorate, divReq) && (s.divisions === null || s.divisions.includes(divReq)));
    if (!applicable.length) return { error: 'Sub-direktorat/divisi tersebut di luar cakupan data Anda.' };
  }
  return {
    directorate: applicable.length === 1 ? applicable[0].directorate : 'ALL',
    sub_directorate: divReq,
    scopes: applicable
  };
}

// Is one (directorate, division) pair readable by this user? Admin: always.
function isInScope(user, directorate, division) {
  if (!user || user.role === 'ADMIN') return true;
  const entry = normalizeScopes(user.scopes).find(s => s.directorate === directorate);
  return !!entry && (entry.divisions === null || (!!division && entry.divisions.includes(division)));
}

// ------------------------------------------------------------------ request helpers
function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > 0) {
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch (_) { /* malformed cookie value: ignore */ }
    }
  });
  return out;
}

const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');
const clientIp = req => String(req.ip || (req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/, '');
const cleanForLog = (text, max = 60) => String(text === undefined || text === null ? '' : text).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

async function audit(req, action, { user, target } = {}) {
  try {
    const actor = user || req.user || null;
    await storage.addAuditLog({ user_id: actor ? actor.user_id : null, username: actor ? actor.username : null, action, target: target ? cleanForLog(target, 190) : null, ip: clientIp(req) });
  } catch (err) {
    console.error('[auth] audit log failed:', err.message);
  }
}

const cookieOptions = (req, maxAgeMs) => ({ httpOnly: true, sameSite: 'strict', secure: !!req.secure, path: '/', ...(maxAgeMs ? { maxAge: maxAgeMs } : {}) });

async function startSession(req, res, user) {
  const { sessionHours } = await getAuthSettings();
  const token = crypto.randomBytes(32).toString('hex');
  const maxAgeMs = sessionHours * 3600 * 1000;
  await storage.createSession({ token_hash: sha256(token), user_id: user.user_id, expires_at: new Date(Date.now() + maxAgeMs) });
  res.cookie(COOKIE_NAME, token, cookieOptions(req, maxAgeMs));
}

// ------------------------------------------------------------------ middleware
// Routes reachable WITHOUT a login: health check, the login itself, and exactly what the public
// check-in / feedback forms (?checkin= / ?survey=) call.
const PUBLIC_ROUTES = [
  ['GET', /^\/api\/health$/],
  ['POST', /^\/api\/auth\/login$/],
  ['GET', /^\/api\/directorates$/],
  ['GET', /^\/api\/events\/by-code\/[^/]+$/],
  ['POST', /^\/api\/events\/[^/]+\/attendance$/],
  ['POST', /^\/api\/events\/[^/]+\/feedback$/]
];
// A user who must still change the temporary password can only reach these.
const PASSWORD_CHANGE_ROUTES = /^\/api\/auth\/(me|logout|change-password)$/;

const isPublicRoute = (method, path) => PUBLIC_ROUTES.some(([m, re]) => m === method && re.test(path));

// Defence in depth on top of SameSite=Strict: a state-changing request whose Origin header names
// another host is refused (requests without an Origin header, e.g. scripts, are unaffected).
function crossOriginWrite(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return false;
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    const host = new URL(origin).host;
    return host !== req.headers.host && host !== req.headers['x-forwarded-host'];
  } catch (_) {
    return true;
  }
}

async function loadSessionUser(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const hash = sha256(token);
  const session = await storage.getSession(hash);
  if (!session) return null;
  if (new Date(session.expires_at).getTime() <= Date.now()) { await storage.deleteSession(hash); return null; }
  const user = await storage.getUserById(session.user_id);
  if (!user || !user.is_active) return null;
  return { user, hash };
}

// Attaches req.user (public shape, no hash) when the cookie holds a valid session. Does not reject.
async function attachUser(req) {
  const loaded = await loadSessionUser(req);
  if (loaded) { req.user = toPublicUser(loaded.user); req.sessionHash = loaded.hash; }
}

async function authGate(req, res, next) {
  try {
    if (crossOriginWrite(req)) return res.status(403).json({ error: 'Permintaan lintas-origin ditolak.' });
    const path = req.baseUrl + req.path;
    await attachUser(req);
    if (isPublicRoute(req.method, path)) return next();
    if (!req.user) return res.status(401).json({ error: 'Silakan login terlebih dahulu.', code: 'AUTH_REQUIRED' });
    if (req.user.must_change_password && !PASSWORD_CHANGE_ROUTES.test(path)) {
      return res.status(403).json({ error: 'Anda harus mengganti password sementara terlebih dahulu.', code: 'PASSWORD_CHANGE_REQUIRED' });
    }
    next();
  } catch (err) {
    console.error('[auth] gate error:', err.message);
    res.status(500).json({ error: 'Gagal memeriksa sesi login.' });
  }
}

// For static file mounts (/uploads, /exports): same session check, same 401 answer.
async function requireLogin(req, res, next) {
  try {
    await attachUser(req);
    if (!req.user) return res.status(401).json({ error: 'Silakan login terlebih dahulu.', code: 'AUTH_REQUIRED' });
    if (req.user.must_change_password) return res.status(403).json({ error: 'Anda harus mengganti password sementara terlebih dahulu.', code: 'PASSWORD_CHANGE_REQUIRED' });
    next();
  } catch (err) {
    res.status(500).json({ error: 'Gagal memeriksa sesi login.' });
  }
}

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Silakan login terlebih dahulu.', code: 'AUTH_REQUIRED' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Anda tidak memiliki akses ke fitur ini.' });
  next();
};

async function requireEventManager(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ error: 'Silakan login terlebih dahulu.', code: 'AUTH_REQUIRED' });
    if (!(await isEventManager(req.user))) return res.status(403).json({ error: 'Hanya Admin dan direktorat pengelola event yang dapat mengelola Signature Event.' });
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// For the scoped read routes: returns { directorate, sub_directorate, scopes } for this request (see
// resolveScope), or answers 403 and returns null. Reads ?directorate and ?sub_directorate / ?subDirectorate.
function scopeFilter(req, res) {
  const q = req.query || {};
  const scope = resolveScope(req.user, q.directorate, q.sub_directorate || q.subDirectorate);
  if (scope.error) { res.status(403).json({ error: scope.error }); return null; }
  return scope;
}

// ------------------------------------------------------------------ routes
const loginLimiter = createRateLimiter({ windowMs: 60 * 1000 });
const USERNAME_RE = /^[A-Za-z0-9._-]{3,50}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Validates role + data scope against the directory in the database and returns { scopes } (normalized:
// one entry per directorate, overlaps merged - "all divisions" absorbs a listed subset, duplicates dropped)
// or { error }. `scopes` is [{ directorate, divisions: [..] | null | [] }] (null / [] = every division).
// An ADMIN has no scope (a non-empty list is refused); a USER needs at least one.
async function validateAssignment(role, scopesInput) {
  if (!ROLES.includes(role)) return { error: 'Role harus ADMIN atau USER.' };
  if (role === 'ADMIN') {
    if (Array.isArray(scopesInput) && scopesInput.length) return { error: 'Role ADMIN tidak memiliki cakupan data (Admin membaca semua data). Kosongkan cakupan.' };
    return { scopes: [] };
  }
  if (!Array.isArray(scopesInput) || scopesInput.length === 0) return { error: 'User wajib memiliki minimal satu cakupan (direktorat).' };
  const directory = await storage.getDirectorates();
  for (const item of scopesInput) {
    if (!item || typeof item !== 'object' || typeof item.directorate !== 'string' || !item.directorate.trim()) return { error: 'Setiap cakupan harus memiliki nama direktorat.' };
    if (item.divisions !== undefined && item.divisions !== null && !(Array.isArray(item.divisions) && item.divisions.every(v => typeof v === 'string'))) {
      return { error: 'Daftar divisi pada cakupan harus berupa array nama divisi (atau kosong/null = semua divisi).' };
    }
    const d = directory.find(x => x.directorate_name === item.directorate.trim());
    if (!d) return { error: `Direktorat "${item.directorate}" tidak valid (pilih dari daftar direktorat).` };
    const bad = (item.divisions || []).map(v => v.trim()).filter(Boolean).find(v => !(d.divisions || []).includes(v));
    if (bad) return { error: `Divisi "${bad}" bukan bagian dari direktorat ${d.directorate_name}.` };
  }
  const scopes = normalizeScopes(scopesInput);
  return scopes.length ? { scopes } : { error: 'User wajib memiliki minimal satu cakupan (direktorat).' };
}

// Cakupan from a request body: `scopes`, or (v2.26.0 clients) directorate + division as a single scope - there
// the division stays mandatory, an omitted one is refused instead of silently meaning "all divisions"; and an
// ADMIN's leftover directorate/division is ignored as before. Returns { scopes } (undefined = body names no
// scope), or { error }.
function scopesFromBody(b, role) {
  if (b.scopes !== undefined) return { scopes: b.scopes === null ? [] : b.scopes };
  if (b.directorate !== undefined || b.division !== undefined) {
    if (role === 'ADMIN') return { scopes: [] };
    if (!b.directorate || !b.division) return { error: 'Divisi wajib diisi bersama direktorat (atau kirim "scopes" untuk memilih beberapa direktorat / semua divisi).' };
    return { scopes: [{ directorate: b.directorate, divisions: [b.division] }] };
  }
  return { scopes: undefined };
}

// Short, secret-free text of a scope list for the audit trail.
const describeScopes = scopes => (scopes && scopes.length
  ? scopes.map(s => `${s.directorate}${s.divisions === null ? ' (semua)' : ` [${s.divisions.join(', ')}]`}`).join('; ')
  : '(tanpa cakupan)');

function registerAuthRoutes(app) {
  app.use('/api', authGate);
  app.use('/api/admin', requireRole('ADMIN'));

  const sessionPayload = async user => ({
    user: toPublicUser(user),
    permissions: { is_admin: user.role === 'ADMIN', can_manage_events: await isEventManager(user) }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const ip = clientIp(req);
      const settings = await getAuthSettings();
      if (loginLimiter.isBlocked(ip, settings.rateLimitPerMinute)) {
        res.set('Retry-After', String(Math.ceil(loginLimiter.retryAfterMs(ip) / 1000)));
        return res.status(429).json({ error: 'Terlalu banyak percobaan login. Coba lagi beberapa saat lagi.' });
      }
      const { username, password } = req.body || {};
      if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password || username.length > 100 || password.length > 256) {
        return res.status(400).json({ error: 'Username dan password wajib diisi.' });
      }
      const fail = async (action, user) => {
        loginLimiter.record(ip);
        await audit(req, action, user ? { user } : { user: { user_id: null, username: null }, target: '(username tidak dikenal)' });
        return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
      };

      const user = await storage.getUserByUsername(username.trim());
      if (!user || !user.is_active) {
        await verifyPassword(password, await getDummyHash());
        return fail('LOGIN_FAILED');
      }
      if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
        await verifyPassword(password, await getDummyHash());
        return fail('LOGIN_BLOCKED_LOCKED', user);
      }
      if (!(await verifyPassword(password, user.password_hash))) {
        const attempts = (user.failed_attempts || 0) + 1;
        if (attempts >= settings.maxAttempts) {
          await storage.updateUser(user.user_id, { failed_attempts: 0, locked_until: new Date(Date.now() + settings.lockoutMinutes * 60 * 1000) });
          return fail('LOGIN_LOCKED', user);
        }
        await storage.updateUser(user.user_id, { failed_attempts: attempts });
        return fail('LOGIN_FAILED', user);
      }

      const updated = await storage.updateUser(user.user_id, { failed_attempts: 0, locked_until: null, last_login_at: new Date() });
      await startSession(req, res, updated);
      loginLimiter.reset(ip);
      await audit(req, 'LOGIN_SUCCESS', { user: updated });
      res.json(await sessionPayload(updated));
    } catch (err) {
      console.error('[auth] login error:', err.message);
      res.status(500).json({ error: 'Login gagal diproses. Coba lagi.' });
    }
  });

  app.post('/api/auth/logout', async (req, res) => {
    try {
      await storage.deleteSession(req.sessionHash);
      await audit(req, 'LOGOUT');
      res.clearCookie(COOKIE_NAME, cookieOptions(req));
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/auth/me', async (req, res) => {
    try {
      res.json(await sessionPayload(req.user));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/auth/change-password', async (req, res) => {
    try {
      const { current_password, new_password } = req.body || {};
      if (typeof current_password !== 'string' || !current_password || current_password.length > 256) {
        return res.status(400).json({ error: 'Password saat ini wajib diisi.' });
      }
      const user = await storage.getUserById(req.user.user_id);
      if (!(await verifyPassword(current_password, user.password_hash))) {
        await audit(req, 'PASSWORD_CHANGE_FAILED');
        return res.status(400).json({ error: 'Password saat ini salah.' });
      }
      const problem = validateNewPassword(new_password, user);
      if (problem) return res.status(400).json({ error: problem });
      if (new_password === current_password) return res.status(400).json({ error: 'Password baru harus berbeda dari password saat ini.' });
      if (new_password === getDefaultInitialPassword()) return res.status(400).json({ error: 'Password baru tidak boleh sama dengan password awal standar. Pilih password lain.' });
      const updated = await storage.updateUser(user.user_id, { password_hash: await hashPassword(new_password), must_change_password: false });
      await storage.deleteSessionsForUser(user.user_id, req.sessionHash);
      await audit(req, 'PASSWORD_CHANGE');
      res.json(await sessionPayload(updated));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- user management (ADMIN only, enforced by app.use('/api/admin', requireRole('ADMIN')))
  const activeAdminCount = users => users.filter(u => u.role === 'ADMIN' && u.is_active).length;

  app.get('/api/admin/users', async (req, res) => {
    try {
      // pic_metrics (read-only): the metrics each account is PIC of, i.e. whose pic_email equals the account's e-mail
      const users = await storage.listUsers();
      const metrics = (await storage.getMetrics()).filter(isPicMetric);
      res.json(users.map(u => ({
        ...toPublicUser(u),
        pic_metrics: u.role === 'USER' && u.email
          ? metrics.filter(m => normEmail(m.pic_email) === normEmail(u.email)).map(m => ({ metric_id: m.metric_id, metric_name: m.metric_name }))
          : []
      })));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/users', async (req, res) => {
    try {
      const b = req.body || {};
      const username = typeof b.username === 'string' ? b.username.trim() : '';
      const fullName = typeof b.full_name === 'string' ? b.full_name.trim() : '';
      const email = typeof b.email === 'string' ? b.email.trim() : '';
      if (!USERNAME_RE.test(username)) return res.status(400).json({ error: 'Username/NIP 3-50 karakter (huruf, angka, titik, minus, garis bawah).' });
      if (!fullName || fullName.length > 200) return res.status(400).json({ error: 'Nama lengkap wajib diisi (maks. 200 karakter).' });
      if (email && (!EMAIL_RE.test(email) || email.length > 200)) return res.status(400).json({ error: 'Format email tidak valid.' });
      const fromBody = scopesFromBody(b, b.role);
      if (fromBody.error) return res.status(400).json({ error: fromBody.error });
      const assign = await validateAssignment(b.role, fromBody.scopes);
      if (assign.error) return res.status(400).json({ error: assign.error });

      const { password: temporaryPassword, isDefault } = makeInitialPassword();
      let created;
      try {
        created = await storage.createUser({
          username, full_name: fullName, email, role: b.role, scopes: assign.scopes,
          password_hash: await hashPassword(temporaryPassword), is_active: true, must_change_password: true
        });
      } catch (err) {
        if (err.code === 'DUPLICATE_USER') return res.status(409).json({ error: err.message });
        throw err;
      }
      await audit(req, 'USER_CREATE', { target: `${created.username} (${created.role}) cakupan: ${describeScopes(created.scopes)}` });
      res.status(201).json({ user: toPublicUser(created), temporary_password: temporaryPassword, is_default_password: isDefault });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/admin/users/:id', async (req, res) => {
    try {
      const target = await storage.getUserById(req.params.id);
      if (!target) return res.status(404).json({ error: 'User tidak ditemukan.' });
      const b = req.body || {};
      const patch = {};
      if (b.full_name !== undefined) {
        if (typeof b.full_name !== 'string' || !b.full_name.trim() || b.full_name.length > 200) return res.status(400).json({ error: 'Nama lengkap tidak valid.' });
        patch.full_name = b.full_name.trim();
      }
      if (b.email !== undefined) {
        if (typeof b.email !== 'string' || (b.email.trim() && (!EMAIL_RE.test(b.email.trim()) || b.email.length > 200))) return res.status(400).json({ error: 'Format email tidak valid.' });
        patch.email = b.email.trim();
      }
      if (b.is_active !== undefined) {
        if (typeof b.is_active !== 'boolean') return res.status(400).json({ error: 'is_active harus true/false.' });
        patch.is_active = b.is_active;
      }
      let scopeChanged = false;
      const newRole = b.role !== undefined ? b.role : target.role;
      const fromBody = scopesFromBody(b, newRole);
      if (fromBody.error) return res.status(400).json({ error: fromBody.error });
      const bodyScopes = fromBody.scopes;
      if (b.role !== undefined || bodyScopes !== undefined) {
        // Role change without new scopes: ADMIN -> none, USER keeps the current ones (empty -> refused).
        const wanted = bodyScopes !== undefined ? bodyScopes : (newRole === 'ADMIN' ? [] : target.scopes);
        const assign = await validateAssignment(newRole, wanted);
        if (assign.error) return res.status(400).json({ error: assign.error });
        patch.role = newRole; patch.scopes = assign.scopes;
        scopeChanged = JSON.stringify(normalizeScopes(target.scopes)) !== JSON.stringify(assign.scopes);
      }

      const isSelf = target.user_id === req.user.user_id;
      const losesAdmin = target.role === 'ADMIN' && target.is_active && (patch.is_active === false || (patch.role && patch.role !== 'ADMIN'));
      if (isSelf && (patch.is_active === false || (patch.role && patch.role !== 'ADMIN'))) {
        return res.status(400).json({ error: 'Anda tidak dapat menonaktifkan atau menurunkan akun Anda sendiri.' });
      }
      if (losesAdmin && activeAdminCount(await storage.listUsers()) <= 1) {
        return res.status(400).json({ error: 'Tidak dapat menonaktifkan/menurunkan Admin aktif terakhir.' });
      }

      const updated = await storage.updateUser(target.user_id, patch);
      if (patch.is_active === false || (patch.role && patch.role !== target.role)) await storage.deleteSessionsForUser(target.user_id);
      // A scope change takes effect on the very next request of an open session: every request reloads the
      // account (and its scopes) from the database, so no re-login and no session revocation is needed.
      await audit(req, 'USER_UPDATE', { target: `${target.username}: ${Object.keys(patch).filter(k => k !== 'scopes').join(',')}` });
      if (scopeChanged) await audit(req, 'USER_SCOPE_CHANGE', { target: `${target.username}: ${describeScopes(target.scopes)} -> ${describeScopes(updated.scopes)}` });
      res.json({ user: toPublicUser(updated) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/users/:id/reset-password', async (req, res) => {
    try {
      const target = await storage.getUserById(req.params.id);
      if (!target) return res.status(404).json({ error: 'User tidak ditemukan.' });
      if (target.user_id === req.user.user_id) return res.status(400).json({ error: 'Gunakan menu ganti password untuk akun Anda sendiri.' });
      const { password: temporaryPassword, isDefault } = makeInitialPassword();
      const updated = await storage.updateUser(target.user_id, {
        password_hash: await hashPassword(temporaryPassword), must_change_password: true, failed_attempts: 0, locked_until: null
      });
      await storage.deleteSessionsForUser(target.user_id);
      await audit(req, 'PASSWORD_RESET', { target: target.username });
      res.json({ user: toPublicUser(updated), temporary_password: temporaryPassword, is_default_password: isDefault });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/admin/users/:id', async (req, res) => {
    try {
      const target = await storage.getUserById(req.params.id);
      if (!target) return res.status(404).json({ error: 'User tidak ditemukan.' });
      if (target.user_id === req.user.user_id) return res.status(400).json({ error: 'Anda tidak dapat menghapus akun Anda sendiri.' });
      if (target.role === 'ADMIN' && target.is_active && activeAdminCount(await storage.listUsers()) <= 1) {
        return res.status(400).json({ error: 'Tidak dapat menghapus Admin aktif terakhir.' });
      }
      await storage.deleteUser(target.user_id);
      await audit(req, 'USER_DELETE', { target: target.username });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/admin/audit-log', async (req, res) => {
    try {
      res.json(await storage.getAuditLog(req.query.limit));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

// Boot-time hint: without any account nobody can log in.
async function warnIfNoUsers() {
  try {
    await storage.purgeExpiredSessions();
    if ((await storage.countUsers()) === 0) {
      console.warn('=======================================================');
      console.warn('[auth] PERINGATAN: belum ada akun login. Tidak ada yang dapat masuk ke aplikasi.');
      console.warn('[auth] Buat Admin pertama:  npm run auth:create-admin');
      console.warn('=======================================================');
    }
  } catch (err) {
    console.error('[auth] gagal memeriksa akun:', err.message);
  }
}

module.exports = {
  COOKIE_NAME, ROLES, PUBLIC_ROUTES,
  hashPassword, verifyPassword, generateTempPassword, getDefaultInitialPassword, makeInitialPassword, validateNewPassword,
  getAuthSettings, toPublicUser, isEventManager, canSeeRespondentData, redactRespondent,
  isPicOfMetric, picMetricIds, picMetrics, getPicMetric, requirePicMetric, rowsForViewer, respondentScopeFor, audit, resolveScope, isInScope, describeScopes,
  parseCookies, requireRole, requireLogin, requireEventManager, scopeFilter, registerAuthRoutes, warnIfNoUsers
};
