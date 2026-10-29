// server/server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const QRCode = require('qrcode');
const dotenv = require('dotenv');

dotenv.config();

const storage = require('./db/storage');
const { calculatePEIndex, getMetricDetail, computeMonthlyTrends, getLastCompleteMonth, normalizeTarget, syncLiveEventMetrics,
  pxWeightsError, clearPxWeightsCache } = require('./services/calculationEngine');
const { normalizeScopes } = require('./db/scopeUtils');
const { loadResolver, NAME_MAX_LENGTH, RESERVED_DIRECTORATE_NAMES, RESERVED_DIVISION_NAMES } = require('./db/directoryNames');
const { getAlertsAndRecommendations } = require('./services/alertEngine');
const { generateEventPPT } = require('./services/pptGenerator');
const { isOllamaAvailable, generateEventSummary } = require('./services/localAiService');
const { generateSurveyCsvTemplate } = require('./services/surveyTemplateService');
const { processSurveyCsv } = require('./services/surveyImportService');
const { generateSurveyEvidence } = require('./services/surveyEvidenceService');
const { importEssSummary, generateEssTemplateXlsx, generateEssEvidence, essOriginalFilePath } = require('./services/essSummaryService');
const { importExitInterviews, resolveExitPeriod, getExitInterviewSummary, generateExitTemplateXlsx, generateExitExportCsv } = require('./services/exitInterviewService');
const socialMedia = require('./services/socialMediaService');
const outcomeValues = require('./services/outcomeValueService');
const metricParts = require('./services/metricPartsService');
const partQuestions = require('./db/partQuestions');
const { loadDisplayNumbers, withDisplayNo } = require('./db/metricNumbers');
const { buildMetricHistory } = require('./services/metricHistoryService');
const { isEssMetric } = require('./db/surveySource');
const { getPendingUploadReminders, sendPendingUploadReminders, startReminderScheduler } = require('./services/reminderService');
const emailSettingsService = require('./services/emailSettingsService');
const auth = require('./services/authService');
const { queueMediaSummary, resumeInterruptedSummaries, isSummaryInFlight } = require('./services/mediaSummaryService');
const { queueMediaTranscription, resumeInterruptedTranscriptions, cleanupTranscribeTempDirs, isTranscribeApiReachable, unreachableMessage } = require('./services/transcribeService');
const { repairUploadedName, safeExtension, mediaKindOfName, deleteMediaAndFile } = require('./services/mediaFileService');

// Default year for YTD/unparseable period query params, derived from the real server clock
// instead of a hardcoded literal (mirrors CURRENT_YEAR in calculationEngine.js).
const CURRENT_YEAR = String(new Date().getFullYear());

const app = express();
const PORT = process.env.PORT || 5000;
// Behind an HTTPS reverse proxy set TRUST_PROXY (e.g. 1) so req.secure / req.ip are right and the
// session cookie gets the Secure flag.
if (process.env.TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(process.env.TRUST_PROXY) ? parseInt(process.env.TRUST_PROXY, 10) : process.env.TRUST_PROXY);

app.use(cors());
app.use(express.json());

// Static file serving for uploads & exports
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const EXPORTS_DIR = path.join(__dirname, 'exports');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(EXPORTS_DIR)) fs.mkdirSync(EXPORTS_DIR, { recursive: true });

// Static files need a login too, and both folders belong to Signature Program Events (v2.49.0: menu access `events`):
// event photos/videos and generated PPT reports. (The public check-in / feedback forms use neither.)
// Second line of defence behind the upload filter: nosniff + a sandboxing CSP on every file (script never runs even if an
// HTML/SVG file ever lands here), and anything that is not an allowlisted photo/video type is only offered as a download.
app.use('/uploads', auth.requireLogin, auth.requireEventManager, (req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; media-src 'self'; img-src 'self'; sandbox");
  let name = req.path;
  try { name = decodeURIComponent(req.path); } catch (_) { /* use as is */ }
  if (!mediaKindOfName(name)) res.set('Content-Disposition', 'attachment');
  next();
}, express.static(UPLOADS_DIR));
app.use('/exports', auth.requireLogin, auth.requireEventManager, express.static(EXPORTS_DIR));

// Multer storage for media uploads
const multerStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    // Temporary random name (two uploads with the same name never collide); a finished video is renamed to its
    // original name by mediaFileService. Only a harmless extension is taken from the client's name.
    const ext = safeExtension(file.originalname);
    cb(null, `media-${Date.now()}-${Math.random().toString(36).substring(2, 8)}${ext}`);
  }
});
const upload = multer({ storage: multerStorage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB limit

// Event photo/video uploads are served back as static files from /uploads, so only real
// image/video MIME types are accepted (an uploaded .html would otherwise be served and run).
// v2.59.0: the size cap per file is the Admin setting media_upload_max_mb (MB, 1-4096, default 1024; Admin Parameters ->
// Journey Parameters), read per upload with a 30 s cache that a save clears, so a change needs no restart. The env
// MEDIA_MAX_MB is only the fallback when the setting cannot be read (then 1024). multer writes to disk as a stream, so
// a large file never sits in memory.
const MEDIA_MAX_MB_DEFAULT = 1024;
const MEDIA_MAX_MB_RANGE = { min: 1, max: 4096 };
const validMediaMaxMb = n => Number.isInteger(n) && n >= MEDIA_MAX_MB_RANGE.min && n <= MEDIA_MAX_MB_RANGE.max;
let mediaMaxMbCache = { value: null, at: 0 };
async function getMediaMaxMb() {
  if (mediaMaxMbCache.value !== null && Date.now() - mediaMaxMbCache.at < 30 * 1000) return mediaMaxMbCache.value;
  try {
    const n = Number((await storage.getSettings()).media_upload_max_mb);
    if (validMediaMaxMb(n)) {
      mediaMaxMbCache = { value: n, at: Date.now() };
      return n;
    }
  } catch (err) {
    console.error('Reading media_upload_max_mb failed, using the fallback limit:', err.message);
  }
  const env = parseInt(process.env.MEDIA_MAX_MB || '', 10);
  return validMediaMaxMb(env) ? env : MEDIA_MAX_MB_DEFAULT;
}
function clearMediaMaxMbCache() { mediaMaxMbCache = { value: null, at: 0 }; }
// "1024 MB (1 GB)" / "500 MB"
function mediaLimitLabel(mb) {
  return mb >= 1024 ? `${mb} MB (${Number((mb / 1024).toFixed(2))} GB)` : `${mb} MB`;
}
const mediaFileFilter = (req, file, cb) => {
  // Both checks must agree: the (client-supplied) MIME type AND the file extension, which decides the stored name and
  // how /uploads serves it. SVG is refused (script), as is anything like evil.html sent with a video/mp4 MIME type.
  const mimeKind = /^image\/(?!svg)/.test(file.mimetype) ? 'IMAGE' : (/^video\//.test(file.mimetype) ? 'VIDEO' : null);
  const nameKind = mediaKindOfName(repairUploadedName(file.originalname));
  if (mimeKind && mimeKind === nameKind) return cb(null, true);
  const err = new Error('Unsupported file format. Upload a photo (JPG/PNG/GIF/WEBP/BMP/AVIF) or a video (MP4/MOV/WEBM/MKV/AVI) whose file extension matches its type. SVG is not accepted.');
  err.code = 'UNSUPPORTED_MEDIA_TYPE';
  cb(err);
};
// one multer instance per limit (the limit is fixed per instance; it only changes when an Admin saves a new value)
const mediaUploaders = new Map();
function mediaUploaderFor(mb) {
  if (!mediaUploaders.has(mb)) {
    mediaUploaders.set(mb, multer({ storage: multerStorage, limits: { fileSize: mb * 1024 * 1024 }, fileFilter: mediaFileFilter }));
  }
  return mediaUploaders.get(mb);
}

// ==========================================
// API ROUTES
// ==========================================

// Login gate: every /api route below needs a session except the public whitelist in
// services/authService.js (PUBLIC_ROUTES); everything under /api/admin is ADMIN only.
auth.registerAuthRoutes(app);
const ADMIN_ONLY = auth.requireRole('ADMIN');
// Signature Program Events (v2.49.0): Admin, or a User with menu access `events` - view AND manage. Every event route
// below carries it except the three public check-in / feedback routes (by-code, attendance, feedback).
const EVENT_MANAGER = auth.requireEventManager;

// 1. Health & Status
app.get('/api/health', async (req, res) => {
  // Only listing Ollama's models (no model run) and only on request: a page load must not touch the local AI.
  const checkAi = req.user && req.query.check_ai === '1';
  const ollama = checkAi ? await isOllamaAvailable() : null;

  // Report the REAL state of the active storage backend (for SQL Server: a live query).
  let database;
  if (storage.backend === 'sql') {
    try {
      const h = await storage.health();
      database = {
        mode: 'MS SQL Server (Connected)',
        backend: 'sql',
        server: h.server,
        database: h.database,
        edition: h.edition,
        version: h.version,
        tables: h.tables
      };
    } catch (err) {
      database = { mode: 'MS SQL Server (ERROR)', backend: 'sql', error: err.message };
    }
  } else {
    database = { mode: 'Local File Store (Active)', backend: 'json', store_file: 'server/data/store.json' };
  }

  // Without a login only the bare status is shown (no database server / host details).
  if (!req.user) {
    return res.json({ status: 'online', system: 'CIMB Niaga People Experience Integrated System', version: '2.60.4' });
  }
  res.json({
    status: 'online',
    system: 'CIMB Niaga People Experience Integrated System',
    version: '2.60.4',
    local_ai: {
      ollama_status: ollama === null ? 'not checked (add ?check_ai=1)' : (ollama ? 'connected' : 'offline (summaries fall back to the rule engine)'),
      model: process.env.OLLAMA_MODEL || 'gemma3:4b',
      host: process.env.OLLAMA_HOST || 'http://localhost:11434'
    },
    database
  });
});

const NUMERIC_SETTINGS = {
  px_index_target: { min: 0, max: 100, integer: false, label: 'Target PX Index' },
  reminder_send_hour: { min: 0, max: 23, integer: true, label: 'Reminder send hour' },
  reminder_repeat_days: { min: 0, max: 31, integer: true, label: 'Reminder repeat interval (days)' },
  session_hours: { min: 1, max: 72, integer: true, label: 'Login session lifetime (hours)' },
  login_max_attempts: { min: 3, max: 20, integer: true, label: 'Failed login limit' },
  login_lockout_minutes: { min: 1, max: 1440, integer: true, label: 'Account lockout duration (minutes)' },
  login_rate_limit_per_minute: { min: 5, max: 200, integer: true, label: 'Failed login attempt limit per IP per minute' },
  session_idle_timeout_minutes: { min: 1, max: 120, integer: true, label: 'Auto sign-out after inactivity (minutes)' },
  media_upload_max_mb: { ...MEDIA_MAX_MB_RANGE, integer: true, label: 'Max photo/video upload size (MB)' }
};
const LABEL_ONLY_SETTINGS = new Set(['metric_types', 'scale_types', 'target_audiences', 'update_frequencies', 'question_types']);

// 1a. Admin-managed UI settings (PX target line, event dropdown options) — stored in the database
app.get('/api/settings', async (req, res) => {
  try {
    res.json(await storage.getSettings());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/settings/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body || {};
    const current = (await storage.getSettings())[key];
    if (current === undefined) return res.status(404).json({ error: `Setting "${key}" not found.` });
    // v2.51.0: set by Admin Parameters -> Directorates only (it stops the boot from topping the directory up again)
    if (key === 'directory_admin_managed') return res.status(400).json({ error: 'This setting is maintained by Admin Parameters -> Directorates and cannot be edited directly.' });
    if (key === 'px_index_weights') {
      // v2.48.0: { survey, outcome } whole percentages adding up to 100
      const invalid = pxWeightsError(value);
      if (invalid) return res.status(400).json({ error: invalid });
      const saved = await storage.setSetting(key, { survey: value.survey, outcome: value.outcome });
      clearPxWeightsCache();
      await auth.audit(req, 'SETTINGS_CHANGE', { target: `${key}: ${current ? `${current.survey}/${current.outcome}` : '-'} -> ${saved.survey}/${saved.outcome}` });
      return res.json({ key, value: saved });
    }
    if (NUMERIC_SETTINGS[key]) {
      const { min, max, integer, label } = NUMERIC_SETTINGS[key];
      const n = Number(value);
      if (value === '' || value === null || !Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
        return res.status(400).json({ error: `${label} must be ${integer ? 'a whole number' : 'a number'} between ${min} and ${max}.` });
      }
      const saved = await storage.setSetting(key, n);
      if (key === 'session_idle_timeout_minutes') auth.clearIdleTimeoutCache();
      if (key === 'media_upload_max_mb') clearMediaMaxMbCache();
      await auth.audit(req, 'SETTINGS_CHANGE', { target: `${key}: ${current} -> ${saved}` });
      return res.json({ key, value: saved });
    }
    const validList = Array.isArray(value) && value.length > 0 &&
      value.every(o => o && typeof o.value === 'string' && o.value.trim() && typeof o.label === 'string' && o.label.trim());
    if (!validList) return res.status(400).json({ error: 'The value must be a non-empty list of { value, label }.' });
    // Option catalogs whose values drive calculation logic: only the labels may be edited.
    if (LABEL_ONLY_SETTINGS.has(key)) {
      const before = (current || []).map(o => o.value).sort().join('|');
      const after = value.map(o => o.value.trim()).sort().join('|');
      if (before !== after) return res.status(400).json({ error: `The values of "${key}" cannot be added or changed — only the labels can be edited.` });
    }
    const saved = await storage.setSetting(key, value.map(o => ({ value: o.value.trim(), label: o.label.trim(), ...(typeof o.desc === 'string' ? { desc: o.desc } : {}) })));
    await auth.audit(req, 'SETTINGS_CHANGE', { target: `${key} (${saved.length} options)` });
    res.json({ key, value: saved });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 1a-2. Reminder e-mail sender ("Setting Email" menu). The password is write-only: it is stored
// encrypted and no endpoint ever returns it.
app.get('/api/admin/email-settings', async (req, res) => {
  try {
    res.json(await emailSettingsService.getPublicSettings());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/email-settings', async (req, res) => {
  try {
    const before = await emailSettingsService.getPublicSettings();
    const saved = await emailSettingsService.updateSettings(req.body || {});
    // v2.51.0: audited like every other setting - field names and public values only, never the password
    const changes = changedFields(before, saved, new Set(['updated_at', 'password_readable', 'has_password', 'env_fallback_available']));
    const body = req.body || {};
    if (body.clear_password) changes.push('password cleared');
    else if (typeof body.smtp_password === 'string' && body.smtp_password) changes.push('password replaced');
    await auth.audit(req, 'SETTINGS_CHANGE', { target: `email_settings: ${changes.join('; ') || 'no changes'}` });
    res.json(saved);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Sends ONE test message to the given address (defaults to the sender's own address).
app.post('/api/admin/email-settings/test', async (req, res) => {
  try {
    const result = await emailSettingsService.sendTestEmail((req.body || {}).to);
    res.status(result.sent ? 200 : 502).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ sent: false, error: err.message });
  }
});

// 1b. Directorates & Divisions List
app.get('/api/directorates', async (req, res) => {
  try {
    const directorates = await storage.getDirectorates();
    res.json(directorates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 1c. Directorate master administration (v2.51.0, Admin Parameters -> Directorates; everything under /api/admin is Admin
// only). Every change runs in one transaction, cascades the name into all data that copies it (EMPLOYEE survey rows, ESS
// results, exit interviews, attendances, login scopes, legacy user fields, recruitment SLA units, directorate settings)
// and records the former name as an alias that imports keep recognising. Errors: 400 invalid, 404 unknown id (only a
// positive whole number is an id - " 853" is not), 409 still referenced / name taken / adopting orphan data needs
// confirm_adopt. A database error is logged and answered with a generic 500 (its text never reaches the client).
// A division is named in the body / query string, never in the URL path ("." / ".." would be normalised away).
const directoryCounts = c => Object.entries(c || {}).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(', ') || 'no data rows';
async function directoryRoute(res, work, status = 200) {
  try {
    res.status(status).json(await work());
  } catch (err) {
    if (!err.status) {
      console.error('[directories] change failed:', err);
      return res.status(500).json({ error: 'The directory change failed on the server; nothing was changed. Try again or check the server log.' });
    }
    res.status(err.status).json({
      error: err.message,
      ...(err.references ? { references: err.references } : {}),
      ...(err.divisions_with_data ? { divisions_with_data: err.divisions_with_data } : {}),
      ...(err.requires_confirmation ? { requires_confirmation: true, orphan_references: err.orphan_references } : {})
    });
  }
}

app.get('/api/admin/directorates', (req, res) => directoryRoute(res, async () => ({
  ...(await storage.getDirectoryAdmin()),
  max_length: NAME_MAX_LENGTH,
  reserved_directorate_names: RESERVED_DIRECTORATE_NAMES,
  reserved_division_names: RESERVED_DIVISION_NAMES
})));

app.post('/api/admin/directorates', (req, res) => directoryRoute(res, async () => {
  const { name, divisions, confirm_adopt } = req.body || {};
  const out = await storage.createDirectorate({ name, divisions, confirm_adopt });
  await auth.audit(req, 'DIRECTORATE_CREATE', { target: `"${out.directorate.name}" (${out.directorate.divisions.length} divisions)${out.released_alias_of ? `; was a former name of "${out.released_alias_of}"` : ''}${out.adopted_orphans ? `; adopted ${directoryCounts(out.adopted_orphans)}` : ''}` });
  return out;
}, 201));

app.put('/api/admin/directorates/:id', (req, res) => directoryRoute(res, async () => {
  const { name, confirm_adopt } = req.body || {};
  const out = await storage.renameDirectorate(req.params.id, name, { confirm_adopt });
  if (out.changed) await auth.audit(req, 'DIRECTORATE_RENAME', { target: `"${out.from}" -> "${out.to}"; ${directoryCounts(out.counts)}${out.adopted_orphans ? `; adopted ${directoryCounts(out.adopted_orphans)}` : ''}` });
  return out;
}));

app.delete('/api/admin/directorates/:id', (req, res) => directoryRoute(res, async () => {
  const out = await storage.deleteDirectorate(req.params.id);
  await auth.audit(req, 'DIRECTORATE_DELETE', { target: `"${out.deleted}" (${out.divisions} divisions, ${out.former_names_removed} former names)` });
  return out;
}));

// What a merge would do (rows, pooled ESS periods, divisions, every login whose scope changes) - read only
app.get('/api/admin/directorates/:id/merge-preview', (req, res) => directoryRoute(res, () => storage.previewMergeDirectorate(req.params.id, req.query.target_id)));

app.post('/api/admin/directorates/:id/merge', (req, res) => directoryRoute(res, async () => {
  const out = await storage.mergeDirectorate(req.params.id, (req.body || {}).target_id);
  await auth.audit(req, 'DIRECTORATE_MERGE', { target: `"${out.from}" -> "${out.to}"; divisions moved ${out.divisions_moved}, merged ${out.divisions_merged}; ${directoryCounts(out.counts)}` });
  // every login whose data scope the merge changed gets its own scope-change entry (same action as Manage Users)
  for (const c of out.scope_changes || []) {
    await auth.audit(req, 'USER_SCOPE_CHANGE', { subject: c, target: `${c.username}: ${auth.describeScopes(c.before)} -> ${auth.describeScopes(c.after)} (merge "${out.from}")` });
  }
  return out;
}));

app.post('/api/admin/directorates/:id/divisions', (req, res) => directoryRoute(res, async () => {
  const out = await storage.addDivision(req.params.id, (req.body || {}).name);
  await auth.audit(req, 'DIVISION_CREATE', { target: `"${out.directorate}" / "${out.division}"` });
  return out;
}, 201));

app.put('/api/admin/directorates/:id/divisions', (req, res) => directoryRoute(res, async () => {
  const { division, name } = req.body || {};
  if (typeof division !== 'string' || !division) throw Object.assign(new Error('division (the current division name) is required.'), { status: 400 });
  const out = await storage.renameDivision(req.params.id, division, name);
  if (out.changed) await auth.audit(req, 'DIVISION_RENAME', { target: `"${out.directorate}": "${out.from}" -> "${out.to}"; ${directoryCounts(out.counts)}` });
  return out;
}));

app.delete('/api/admin/directorates/:id/divisions', (req, res) => directoryRoute(res, async () => {
  const division = typeof req.query.division === 'string' ? req.query.division : (req.body || {}).division;
  if (typeof division !== 'string' || !division) throw Object.assign(new Error('division (the division name, ?division=) is required.'), { status: 400 });
  const out = await storage.deleteDivision(req.params.id, division);
  await auth.audit(req, 'DIVISION_DELETE', { target: `"${out.directorate}" / "${out.deleted}"` });
  return out;
}));

// Former / alternative names added by hand (v2.51.0), e.g. the spelling an ESS file uses for a directorate. Same name rules
// as a directorate / division; 400 = the name of a live directorate / division, 409 = already a former name (here or of
// another directorate) or rows already carry it (requires_confirmation - send confirm_adopt: true to adopt them).
app.post('/api/admin/directorates/:id/aliases', (req, res) => directoryRoute(res, async () => {
  const { name, confirm_adopt } = req.body || {};
  const out = await storage.addDirectorateAlias(req.params.id, name, { confirm_adopt });
  await auth.audit(req, 'DIRECTORATE_ALIAS_ADD', { target: `"${out.alias}" -> "${out.directorate}"${out.adopted_orphans ? `; adopted ${directoryCounts(out.adopted_orphans)}` : ''}` });
  return out;
}, 201));

app.delete('/api/admin/directorates/:id/aliases', (req, res) => directoryRoute(res, async () => {
  const name = typeof req.query.name === 'string' ? req.query.name : (req.body || {}).name;
  const out = await storage.removeDirectorateAlias(req.params.id, name);
  await auth.audit(req, 'DIRECTORATE_ALIAS_REMOVE', { target: `"${out.alias}" (was -> "${out.directorate}")` });
  return out;
}));

app.post('/api/admin/directorates/:id/divisions/aliases', (req, res) => directoryRoute(res, async () => {
  const { division, name, confirm_adopt } = req.body || {};
  if (typeof division !== 'string' || !division) throw Object.assign(new Error('division (the division the former name belongs to) is required.'), { status: 400 });
  const out = await storage.addDivisionAlias(req.params.id, division, name, { confirm_adopt });
  await auth.audit(req, 'DIVISION_ALIAS_ADD', { target: `"${out.directorate}": "${out.alias}" -> "${out.division}"${out.adopted_orphans ? `; adopted ${directoryCounts(out.adopted_orphans)}` : ''}` });
  return out;
}, 201));

app.delete('/api/admin/directorates/:id/divisions/aliases', (req, res) => directoryRoute(res, async () => {
  const name = typeof req.query.name === 'string' ? req.query.name : (req.body || {}).name;
  const out = await storage.removeDivisionAlias(req.params.id, name);
  await auth.audit(req, 'DIVISION_ALIAS_REMOVE', { target: `"${out.directorate}": "${out.alias}" (was -> "${out.division}")` });
  return out;
}));

// 2. Metrics & PE Index Calculation (Supports ?mode=YTD|MTD&year=2026&month=03&directorate=...&sub_directorate=...)
app.get('/api/metrics/calculate', async (req, res) => {
  try {
    const { period, mode, year, month, endMonth, sub_directorate, subDirectorate } = req.query;
    // A USER is limited to their data scope (one or more directorates, each all or some divisions): a
    // directorate/division outside it -> 403; "ALL" means the union of their whole scope.
    const scope = auth.scopeFilter(req, res);
    if (scope === null) return;
    const filterOptions = {
      period: period || (mode === 'MTD' ? `${year || CURRENT_YEAR}-${month || '01'}` : (mode === 'YTD' ? 'YTD' : (year || CURRENT_YEAR))),
      mode: mode || (period && /^\d{4}-\d{2}$/.test(period) ? 'MTD' : 'YTD'),
      year: year || (period && /^\d{4}/.test(period) ? period.slice(0, 4) : CURRENT_YEAR),
      month: month || (period && period.length >= 7 && /^\d{4}-\d{2}/.test(period) ? period.slice(5, 7) : '01'),
      // Optional: bound a YTD query to "Jan..end of this month" (e.g. ?mode=YTD&endMonth=08)
      // instead of the full year — mainly used to audit/verify the Performance Trend chart's
      // cumulative points against this same scorecard endpoint.
      endMonth: endMonth || null,
      directorate: scope.directorate,
      sub_directorate: scope.sub_directorate,
      scopes: scope.scopes
    };
    // Under a directorate/division filter the non-employee metrics (#1-#5 ...) are read at their bankwide value and
    // count in the index (v2.48.0, Admin and USER alike), so the number equals GET /api/metrics/by-directorate.
    const calculation = await calculatePEIndex(filterOptions);
    // can_upload (computed here, never by the client): the Template / Evidence / Upload buttons of a SURVEY metric
    // are for the Admin and for that metric's PIC (v2.27.1).
    const picIds = new Set(await auth.picMetricIds(req.user));
    calculation.metrics = (calculation.metrics || []).map(m => ({ ...m, can_upload: m.metric_type === 'SURVEY' && (req.user.role === 'ADMIN' || picIds.has(m.metric_id)) }));
    res.json(calculation);
  } catch (err) {
    console.error('Error calculating PE Index:', err);
    res.status(500).json({ error: 'Failed to calculate People Experience Index' });
  }
});

// 2b. Metric Drilldown Detail with Questions Breakdown & Responses
app.get('/api/metrics/:id/detail', async (req, res) => {
  try {
    const { period, mode, year, month } = req.query;
    const scope = auth.scopeFilter(req, res);
    if (scope === null) return;
    const { directorate, sub_directorate, scopes } = scope;
    // Bankwide / non-employee metrics (campus, candidates, ...) have no directorate: getMetricDetail reads them as the
    // bankwide aggregate (read-only, is_bankwide_value) under any directorate/scope filter - USER and Admin (v2.48.0).
    const filterOptions = {
      period: period || (mode === 'MTD' ? `${year || CURRENT_YEAR}-${month || '01'}` : (mode === 'YTD' ? 'YTD' : (year || CURRENT_YEAR))),
      mode: mode || (period && /^\d{4}-\d{2}$/.test(period) ? 'MTD' : 'YTD'),
      year: year || (period && /^\d{4}/.test(period) ? period.slice(0, 4) : CURRENT_YEAR),
      month: month || (period && period.length >= 7 && /^\d{4}-\d{2}/.test(period) ? period.slice(5, 7) : '01'),
      directorate,
      sub_directorate,
      scopes
    };
    const detail = await getMetricDetail(req.params.id, filterOptions);
    if (!detail) {
      return res.status(404).json({ error: `Metric #${req.params.id} not found` });
    }
    // Per-respondent identity (name / NIP / e-mail) only for those allowed to see it: the Admin and the metric's PIC
    // (the PIC's detail is already limited to the PIC's own data scope by the filter above).
    const seesIdentity = await auth.canSeeRespondentData(req.user, detail.metric_id);
    const canUpload = detail.metric_type === 'SURVEY' && seesIdentity;
    if (!seesIdentity) {
      return res.json({ ...auth.redactRespondent(detail), respondent_data_hidden: true, can_upload: false });
    }
    res.json({ ...detail, can_upload: canUpload });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2b-2. History of a metric (v2.56.0, the detail's "History" tab, formerly "Internal Transaction Records"): the rows behind
// the metric's Evidence download for the period (?period= as the evidence: YTD | YYYY | YYYY-MM | ALL, or ?mode=&year=&month=
// like the detail), built by the same functions as the evidence CSV. Every login may read it, limited like the detail:
// identities (respondents, attendees) only for the Admin and the PIC of a SURVEY metric; a non-Admin gets only the rows
// of their own directorates for employee metrics (aggregate rows of OUTCOME values stay bankwide); directorate outside the
// scope -> 403. The Admin's rows are not narrowed by the directorate filter (the evidence download is not either).
app.get('/api/metrics/:id/history', async (req, res) => {
  try {
    if (!/^\d{1,9}$/.test(String(req.params.id))) return res.status(400).json({ error: 'The metric id must be a metric number.' });
    const scope = auth.scopeFilter(req, res);
    if (scope === null) return;
    const metric = await storage.getMetricById(parseInt(req.params.id, 10));
    if (!metric) return res.status(404).json({ error: `Metric #${req.params.id} not found` });
    const { mode, year, month } = req.query;
    const period = req.query.period !== undefined && req.query.period !== ''
      ? String(req.query.period)
      : (mode === 'MTD' ? `${year || CURRENT_YEAR}-${String(month || '01').padStart(2, '0')}` : String(year || CURRENT_YEAR));
    const mp = outcomeValues.parseEvidencePeriod(period);
    if (!mp) return res.status(400).json({ error: 'period must be ALL, YTD, a year (YYYY) or a month (YYYY-MM).' });
    const evidencePeriod = period.trim().toUpperCase();
    const seesIdentity = await auth.canSeeRespondentData(req.user, metric.metric_id);
    const scopes = req.user.role === 'ADMIN' || metric.is_employee_metric === false ? null : scope.scopes;
    const history = await buildMetricHistory(metric, {
      period: evidencePeriod, mp, seesIdentity, scopes,
      // OPERATIONAL records come from the detail (same filter as the detail itself)
      operational: async () => {
        const detail = await getMetricDetail(metric.metric_id, {
          period: mp.all || mp.mode !== 'MTD' ? (mp.all ? CURRENT_YEAR : mp.year) : `${mp.year}-${mp.month}`,
          mode: !mp.all && mp.mode === 'MTD' ? 'MTD' : 'YTD',
          year: mp.all ? CURRENT_YEAR : mp.year,
          month: mp.all ? '01' : mp.month,
          directorate: scope.directorate, sub_directorate: scope.sub_directorate, scopes: scope.scopes
        });
        return detail && !seesIdentity ? auth.redactRespondent(detail) : detail;
      }
    });
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2c. Monthly Trend Series
app.get('/api/metrics/trends', async (req, res) => {
  try {
    const { mode, year, startYear, startMonth, endYear, endMonth } = req.query;
    const scope = auth.scopeFilter(req, res);
    if (scope === null) return;
    const targetYear = year || CURRENT_YEAR;
    const filterOptions = {
      mode: (mode || 'YTD').toUpperCase() === 'MTD' ? 'MTD' : 'YTD',
      year: targetYear,
      startYear: startYear || null,
      startMonth: startMonth || null,
      endYear: endYear || null,
      endMonth: endMonth || null,
      directorate: scope.directorate,
      sub_directorate: scope.sub_directorate,
      scopes: scope.scopes
    };
    const trends = await computeMonthlyTrends(filterOptions);
    // last_complete_month tells the frontend range picker which months of `year` are even
    // selectable — the chart can never be pushed into showing the in-progress current month
    // or beyond. available_years lists every year that actually has survey data (plus the
    // real current year), so the frontend's year dropdowns reflect the database, not a
    // hardcoded guess.
    const lastCompleteMonth = getLastCompleteMonth(targetYear);
    res.json({
      trends,
      mode: filterOptions.mode,
      year: targetYear,
      last_complete_month: lastCompleteMonth > 0 ? String(lastCompleteMonth).padStart(2, '0') : null,
      available_years: await storage.getAvailableSurveyYears(),
      px_index_target: (await storage.getSettings()).px_index_target
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2d. PX Index per directorate (v2.48.0) for the selected period (?mode=YTD|MTD&year=&month=). Admin: every directorate
// of the master list; USER: only the directorates of their own scope (a directorate outside it is never computed).
// Every entry is computed exactly like GET /api/metrics/calculate?directorate=<that directorate> for this user, so
// clicking it in the Dashboard (= setting the Header filter) shows the same number.
app.get('/api/metrics/by-directorate', async (req, res) => {
  try {
    const { mode, year, month } = req.query;
    const isMtd = (mode || 'YTD').toUpperCase() === 'MTD';
    const y = /^\d{4}$/.test(String(year || '')) ? String(year) : CURRENT_YEAR;
    const mo = /^(0?[1-9]|1[0-2])$/.test(String(month || '')) ? String(month).padStart(2, '0') : '01';
    const period = { mode: isMtd ? 'MTD' : 'YTD', year: y, month: mo, period: isMtd ? `${y}-${mo}` : 'YTD' }; // same period string as /api/metrics/calculate

    const names = req.user.role === 'ADMIN'
      ? (await storage.getDirectorates()).map(d => d.directorate_name || d.name).filter(Boolean)
      : normalizeScopes(req.user.scopes).map(s => s.directorate);

    await syncLiveEventMetrics(); // once; the per-directorate calls below skip it (skipTrends)
    const rows = await Promise.all(names.map(async name => {
      const scope = auth.resolveScope(req.user, name, 'ALL');
      if (scope.error) return null; // cannot happen for the names above; never compute outside the scope
      const calc = await calculatePEIndex({ ...period, directorate: scope.directorate, sub_directorate: scope.sub_directorate, scopes: scope.scopes },
        { skipTrends: true });
      const own = scope.scopes ? scope.scopes.find(s => s.directorate === name) : null;
      // v2.51.0: a directorate without data of its own (e.g. a brand-new one) has no PX Index of its own: null scores,
      // has_own_data false, not ranked (calculate?directorate= itself is unchanged). Own data = a SURVEY metric (SYSTEM rows
      // or an ESS result) with data that is not a bankwide value; the bankwide metrics #1-#5 and the OUTCOME metrics
      // (an unfiltered snapshot, the same for every directorate since v2.36.0) do not count.
      const hasOwnData = calc.metrics.some(m => m.has_data && m.metric_type === 'SURVEY' && !m.is_bankwide_value);
      return {
        directorate: name,
        divisions: own ? own.divisions : null, // USER with a subset of divisions: the divisions the number covers
        has_own_data: hasOwnData,
        px_index: hasOwnData ? calc.px_index : null,
        survey_index: hasOwnData ? calc.survey_index : null,
        outcome_index: hasOwnData ? calc.outcome_index : null,
        px_index_basis: hasOwnData ? calc.px_index_basis : 'NONE',
        active_metrics_count: calc.active_metrics_count,
        no_data_metrics_count: calc.no_data_metrics_count,
        critical_count: hasOwnData ? calc.metrics.filter(m => m.status === 'CRITICAL').length : 0,
        warning_count: hasOwnData ? calc.metrics.filter(m => m.status === 'WARNING').length : 0,
        px_weights: calc.px_weights
      };
    }));
    // highest PX Index first; directorates without data last; ties by name
    const list = rows.filter(Boolean).sort((a, b) => (a.px_index === null) - (b.px_index === null)
      || (b.px_index || 0) - (a.px_index || 0) || a.directorate.localeCompare(b.directorate));
    res.json({ mode: period.mode, year: y, month: isMtd ? mo : null, px_weights: list.length ? list[0].px_weights : null, directorates: list });
  } catch (err) {
    console.error('Error calculating PX Index by directorate:', err);
    res.status(500).json({ error: 'Failed to calculate the PX Index by directorate' });
  }
});

// ==========================================
// ADMIN PARAMETERS: JOURNEYS & METRICS CRUD
// ==========================================
// null when the target has no percentage (tier-scored metric whose tiers are not configured yet, v2.54.0)
const targetPercent = v => (v === null || v === undefined ? null : parseFloat(v.toFixed(2)));
app.get('/api/admin/parameters', async (req, res) => {
  try {
    const journeys = await storage.getJourneys();
    const checkpoints = await storage.getCheckpoints();
    const directorates = await storage.getDirectorates();
    // target_value_normalized converts each metric's raw target (e.g. 4.00 on a 1-5
    // Likert scale) into the same 0-100 scale as min_threshold, so Admin Parameters can
    // display Target and Threshold using one consistent unit instead of mixing scales.
    const numbers = await loadDisplayNumbers(storage); // v2.58.0: display_no = the number the UI shows
    const metrics = (await storage.getMetrics()).map(m => ({
      ...m,
      display_no: numbers.get(m.metric_id) ?? null,
      target_value_normalized: targetPercent(normalizeTarget(m, m))
    }));
    res.json({
      success: true,
      journeys,
      checkpoints,
      metrics,
      directorates,
      // E-mails of the active login accounts: Parameter Admin warns when a PIC e-mail matches none of them
      // (that PIC could not log in to upload). Admin-only route.
      active_account_emails: [...new Set((await storage.listUsers()).filter(u => u.is_active && u.email).map(u => String(u.email).trim().toLowerCase()))]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// v2.51.0: every Admin parameter change is written to the audit trail (Manage Users -> Audit Trail), so an edit that later
// disappears can be traced: the fields that changed, old -> new (auth.audit cuts the text at its 190-character limit).
const auditValue = v => (v === null || v === undefined || v === '' ? '-' : typeof v === 'object' ? JSON.stringify(v) : String(v)).slice(0, 60);
const DERIVED_METRIC_FIELDS = new Set(['metric_weight', 'target_value_normalized']);
function changedFields(before, after, skip = new Set()) {
  const b = before || {};
  const a = after || {};
  return [...new Set([...Object.keys(b), ...Object.keys(a)])]
    .filter(k => !skip.has(k) && JSON.stringify(b[k] === undefined ? null : b[k]) !== JSON.stringify(a[k] === undefined ? null : a[k]))
    .map(k => `${k} ${auditValue(b[k])} -> ${auditValue(a[k])}`);
}
// Survey questions before / after a save: changed, added and removed question keys
function questionChanges(before, after) {
  const byKey = list => new Map((list || []).map(q => [q.key || q.question_key || q.id, q]));
  const b = byKey(before);
  const a = byKey(after);
  const sig = q => JSON.stringify([q.text || q.question_text || '', q.type || q.question_type || '', q.label || '', q.options || null, q.mandatory || false]);
  const changed = [...a.keys()].filter(k => b.has(k) && sig(a.get(k)) !== sig(b.get(k)));
  const added = [...a.keys()].filter(k => !b.has(k));
  const removed = [...b.keys()].filter(k => !a.has(k));
  const order = [...a.keys()].filter(k => b.has(k)).join('|') !== [...b.keys()].filter(k => a.has(k)).join('|');
  return [`${(before || []).length} -> ${(after || []).length} questions`,
    ...(changed.length ? [`changed ${changed.join(', ')}`] : []), ...(added.length ? [`added ${added.join(', ')}`] : []),
    ...(removed.length ? [`removed ${removed.join(', ')}`] : []), ...(order ? ['order changed'] : [])].join('; ');
}

// Add Journey
app.post('/api/admin/journeys', async (req, res) => {
  try {
    const journey = await storage.addJourney(req.body);
    await auth.audit(req, 'JOURNEY_CREATE', { target: `#${journey.journey_id} "${journey.journey_name}"` });
    const calculation = await calculatePEIndex();
    res.status(201).json({ success: true, journey, calculation });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update Journey
app.put('/api/admin/journeys/:id', async (req, res) => {
  try {
    const before = await storage.getJourneyById(req.params.id);
    const journey = await storage.updateJourney(req.params.id, req.body);
    await auth.audit(req, 'JOURNEY_UPDATE', { target: `#${journey.journey_id}: ${changedFields(before, journey).join('; ') || 'no changes'}` });
    const calculation = await calculatePEIndex();
    res.json({ success: true, journey, calculation });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete Journey
app.delete('/api/admin/journeys/:id', async (req, res) => {
  try {
    const before = await storage.getJourneyById(req.params.id);
    const result = await storage.deleteJourney(req.params.id);
    await auth.audit(req, 'JOURNEY_DELETE', { target: before ? `#${before.journey_id} "${before.journey_name}"` : `#${req.params.id}` });
    const calculation = await calculatePEIndex();
    res.json({ success: true, ...result, calculation });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Add Metric
app.post('/api/admin/metrics', async (req, res) => {
  try {
    const metric = await storage.addMetric(req.body);
    await auth.audit(req, 'METRIC_CREATE', { target: `#${metric.metric_id} "${metric.metric_name}" (${metric.metric_type}${metric.survey_source ? ` / ${metric.survey_source}` : ''})` });
    const calculation = await calculatePEIndex();
    res.status(201).json({ success: true, metric, calculation, ...metric });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update Metric (Parameters: Name, Journey, Checkpoint, Weight, Target, Threshold, Audience, etc.)
app.put('/api/admin/metrics/:id', async (req, res) => {
  try {
    const before = await storage.getMetricById(req.params.id);
    const metric = await storage.updateMetric(req.params.id, req.body);
    const after = await storage.getMetricById(metric.metric_id);
    await auth.audit(req, 'METRIC_UPDATE', { target: `#${metric.metric_id}: ${changedFields(before, after, DERIVED_METRIC_FIELDS).join('; ') || 'no changes'}` });
    const calculation = await calculatePEIndex();
    res.json({ success: true, metric, calculation, ...metric });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete Metric
app.delete('/api/admin/metrics/:id', async (req, res) => {
  try {
    // its ESS uploads go with it (documented cascade), so their original files are removed too (v2.32.0); the same for the
    // uploaded monthly OUTCOME values (v2.54.0)
    const essUploadIds = (await storage.getSurveyUploads()).filter(u => String(u.metric_id) === String(parseInt(req.params.id, 10))).map(u => u.upload_id);
    const outcomeUploadIds = /^\d{1,9}$/.test(String(req.params.id)) ? (await storage.getOutcomeUploads(parseInt(req.params.id, 10))).map(u => u.upload_id) : [];
    const result = await storage.deleteMetric(req.params.id);
    await auth.audit(req, 'METRIC_DELETE', { target: `#${result.metric_id} "${result.metric_name}" (with its survey data, ESS results, monthly values and uploads)` });
    essUploadIds.forEach(id => { const f = essOriginalFilePath(id); if (f) fs.unlink(f, () => {}); });
    outcomeUploadIds.forEach(id => { const f = outcomeValues.outcomeOriginalFilePath(id); if (f) fs.unlink(f, () => {}); });
    const calculation = await calculatePEIndex();
    res.json({ success: true, ...result, calculation });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Reset All Parameters (Journeys, Checkpoints, Metrics, Targets) to Seed Defaults
app.post('/api/admin/parameters/reset', async (req, res) => {
  try {
    const resetData = await storage.resetParametersToDefault();
    await auth.audit(req, 'PARAMETERS_RESET', { target: `journeys, checkpoints, metrics, targets and survey questions reset to the defaults (${resetData.journeys.length} journeys, ${resetData.checkpoints.length} checkpoints, ${resetData.metrics.length} metrics)` });
    const calculation = await calculatePEIndex('YTD');
    res.json({
      success: true,
      message: 'All Journey, Checkpoint and Metric parameters were reset to the default configuration!',
      data: resetData,
      calculation
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Metric Target & Threshold Settings (Backward Compatible)
app.get('/api/admin/targets', async (req, res) => {
  try {
    const targets = await storage.getMetricTargets();
    res.json({ targets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/targets', async (req, res) => {
  try {
    const { targets } = req.body;
    if (!targets) return res.status(400).json({ error: 'targets is required' });
    const before = await storage.getMetricTargets();
    const saved = await storage.saveMetricTargets(targets);
    const diffs = Object.keys({ ...before, ...saved }).map(id => ({ id, f: changedFields(before[id], saved[id]) })).filter(x => x.f.length);
    await auth.audit(req, 'METRIC_TARGETS_UPDATE', { target: diffs.map(x => `#${x.id} ${x.f.join(', ')}`).join('; ') || 'no changes' });
    const period = req.query.period || 'YTD';
    const newCalculation = await calculatePEIndex(period);
    res.json({ success: true, targets: saved, calculation: newCalculation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/targets/reset', async (req, res) => {
  try {
    const reset = await storage.resetMetricTargets();
    await auth.audit(req, 'METRIC_TARGETS_RESET', { target: `targets and thresholds of ${Object.keys(reset || {}).length} metrics reset to the defaults` });
    const newCalculation = await calculatePEIndex('YTD');
    res.json({ success: true, targets: reset, calculation: newCalculation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Survey Questions Admin Settings
app.get('/api/admin/survey-questions', async (req, res) => {
  try {
    const allQuestions = await storage.getAllSurveyQuestions();
    const metrics = (await storage.getMetrics()).filter(m => m.metric_type === 'SURVEY');
    res.json({
      success: true,
      questions: allQuestions,
      metrics
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/survey-questions/:metric_id', async (req, res) => {
  try {
    const metric_id = parseInt(req.params.metric_id);
    const questions = await storage.getSurveyQuestions(metric_id);
    const metric = (await storage.getMetrics()).find(m => m.metric_id === metric_id);
    res.json({
      success: true,
      metric_id,
      metric_name: metric ? metric.metric_name : `Metric ${metric_id}`,
      questions
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/survey-questions/:metric_id', async (req, res) => {
  try {
    const metric_id = parseInt(req.params.metric_id);
    const { questions } = req.body;
    if (!Array.isArray(questions)) {
      return res.status(400).json({ error: 'questions must be an array' });
    }
    const metric = await storage.getMetricById(metric_id);
    if (!metric) return res.status(404).json({ error: `Metric #${metric_id} not found.` });
    // v2.50.0: an ESS summary reports every question as a percentage, so the questions of an ESS metric are always PERCENTAGE
    const isEss = metric.metric_type === 'SURVEY' && isEssMetric(metric);
    const before = await storage.getSurveyQuestions(metric_id);
    const saved = await storage.saveSurveyQuestions(metric_id, isEss ? questions.map(q => ({ ...(q || {}), type: 'PERCENTAGE' })) : questions);
    await auth.audit(req, 'SURVEY_QUESTIONS_UPDATE', { target: `#${metric_id}: ${questionChanges(before, saved)}` });
    res.json({
      success: true,
      message: `Survey questions for Metric ID ${metric_id} saved successfully`,
      questions: saved
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/survey-questions/:metric_id/reset', async (req, res) => {
  try {
    const metric_id = parseInt(req.params.metric_id);
    if (!(await storage.getMetricById(metric_id))) return res.status(404).json({ error: `Metric #${metric_id} not found.` });
    const before = await storage.getSurveyQuestions(metric_id);
    const reset = await storage.resetSurveyQuestions(metric_id);
    await auth.audit(req, 'SURVEY_QUESTIONS_RESET', { target: `#${metric_id} reset to the default template: ${questionChanges(before, reset)}` });
    res.json({
      success: true,
      message: `Survey questions for Metric ID ${metric_id} reset to the default template`,
      questions: reset
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Survey Upload Reminders — Periodic Data Update / Manual Survey Upload Deadline tracking
app.get('/api/admin/upload-reminders', async (req, res) => {
  try {
    const numbers = await loadDisplayNumbers(storage);
    const reminders = withDisplayNo(await getPendingUploadReminders(), numbers);
    res.json({
      total_reminders: reminders.length,
      overdue_count: reminders.filter(r => r.status === 'OVERDUE').length,
      due_today_count: reminders.filter(r => r.status === 'DUE_TODAY').length,
      reminders,
      history: withDisplayNo(await storage.getReminderLog(20), numbers)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/upload-reminders/send', async (req, res) => {
  try {
    // Optional: { reference_date: 'YYYY-MM-DD' } simulates another day, { dry_run: true } sends nothing.
    // { automatic: true } runs it exactly like the scheduler would (dedupe + repeat interval) instead of "send now".
    const { reference_date, dry_run, automatic, metric_id } = req.body || {};
    if (reference_date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(reference_date))) {
      return res.status(400).json({ error: 'reference_date must be in YYYY-MM-DD format.' });
    }
    const result = await sendPendingUploadReminders({ referenceDate: reference_date, dryRun: !!dry_run, force: !automatic, metricId: metric_id !== undefined ? parseInt(metric_id, 10) : null });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/metrics/score', ADMIN_ONLY, async (req, res) => {
  try {
    const { metric_id, raw_value, normalized_score, notes } = req.body;
    if (!metric_id) return res.status(400).json({ error: 'metric_id is required' });

    const updated = await storage.updateMetricScore(metric_id, raw_value, normalized_score, notes);
    const newCalculation = await calculatePEIndex();
    res.json({ success: true, updated_metric: updated, calculation: newCalculation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/metrics/weights', ADMIN_ONLY, async (req, res) => {
  try {
    const { weights } = req.body; // Array of { metric_id, weight }
    if (!Array.isArray(weights)) return res.status(400).json({ error: 'weights must be an array' });

    const before = new Map((await storage.getMetrics()).map(m => [m.metric_id, m.weight]));
    await storage.updateMetricWeights(weights);
    const after = new Map((await storage.getMetrics()).map(m => [m.metric_id, m.weight]));
    const diffs = [...after.keys()].filter(id => before.get(id) !== after.get(id)).map(id => `#${id} weight ${auditValue(before.get(id))} -> ${auditValue(after.get(id))}`);
    await auth.audit(req, 'METRIC_UPDATE', { target: diffs.join('; ') || 'weights: no changes' });
    const newCalculation = await calculatePEIndex();
    res.json({ success: true, calculation: newCalculation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Alerts & Action Library Recommendations
app.get('/api/alerts', async (req, res) => {
  try {
    // A USER's alerts are computed from the data inside their scope only (Admin: bankwide, or the
    // optional ?directorate / ?sub_directorate filter).
    const scope = auth.scopeFilter(req, res);
    if (scope === null) return;
    const alertsData = await getAlertsAndRecommendations(scope);
    res.json(alertsData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/alerts/acknowledge', ADMIN_ONLY, async (req, res) => {
  try {
    const { metric_id } = req.body;
    await storage.acknowledgeAlert(parseInt(metric_id));
    res.json({ success: true, message: `Alert for metric ${metric_id} acknowledged` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/action-library', auth.requireMenu('action_library'), async (req, res) => {
  res.json(await storage.getActionLibrary());
});

app.post('/api/action-library', ADMIN_ONLY, async (req, res) => {
  try {
    const { items } = req.body;
    const updated = await storage.updateActionLibrary(items);
    res.json({ success: true, items: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Manual Survey Data Upload & Template Generation
// Open to the Admin and (v2.27.1) to the PIC of a metric - an account whose e-mail equals the metric's pic_email set in
// Parameter Admin - for THAT metric only (auth.requirePicMetric answers 403 for everything else). A PIC always has to
// name the metric; "ALL" / master files stay Admin-only.
// Clean 400 / 404 for a malformed or unknown metric id (reached by the Admin; a PIC is refused earlier with 403).
async function checkMetricRef(res, ref, { allowAll = false } = {}) {
  if (allowAll && ref === 'ALL') return true;
  if (typeof ref !== 'string' || !/^\d{1,9}$/.test(ref)) { res.status(400).json({ error: 'Invalid metric_id.' }); return false; }
  if (!(await storage.getMetrics()).some(m => String(m.metric_id) === String(parseInt(ref, 10)))) { res.status(404).json({ error: `Metric ${ref} not found.` }); return false; }
  return true;
}

// Cheap pre-check before multer touches the disk: only the Admin and accounts that are PIC of some metric go on.
const PIC_OR_ADMIN = async (req, res, next) => {
  try {
    if (req.user.role === 'ADMIN' || (await auth.picMetrics(req.user)).length) return next();
    res.status(403).json({ error: 'Only an Admin or the metric PIC can use this feature.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

app.get('/api/surveys/metrics', async (req, res) => {
  try {
    const gate = await auth.requirePicMetric(req, res, null, { required: false });
    if (!gate) return;
    const metrics = withDisplayNo((await storage.getMetrics()).filter(m => m.metric_type === 'SURVEY'), await loadDisplayNumbers(storage));
    res.json(req.user.role === 'ADMIN' ? metrics : metrics.filter(m => gate.mine.some(p => p.metric_id === m.metric_id)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/surveys/template', async (req, res) => {
  try {
    const gate = await auth.requirePicMetric(req, res, req.query.metric_id);
    if (!gate) return;
    const metric_id = req.query.metric_id || 'ALL';
    // An ESS metric (v2.32.0) takes the ESS summary .xlsx, so its template is that workbook.
    const essMetric = metric_id !== 'ALL' ? (await storage.getMetrics()).find(m => m.metric_id === parseInt(metric_id, 10) && m.metric_type === 'SURVEY' && isEssMetric(m)) : null;
    if (essMetric) {
      const xlsx = await generateEssTemplateXlsx(essMetric);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="Template_ESS_Metric_${essMetric.metric_id}.xlsx"`);
      return res.send(xlsx);
    }
    const csvContent = await generateSurveyCsvTemplate(metric_id);
    
    const filename = metric_id === 'ALL' 
      ? 'Template_Survey_Master_All_Metrics.csv' 
      : `Template_Survey_Metric_${metric_id}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvContent);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 4b. Download Raw Survey Evidence CSV (Audit Trail & Proof of Assessment)
// Admin: any metric or ALL. PIC: only own metric, and only respondents inside the PIC's own data scope.
app.get('/api/surveys/evidence', async (req, res) => {
  try {
    const { metric_id = 'ALL', period = 'YTD' } = req.query;
    if (!(await auth.canSeeRespondentData(req.user, metric_id))) return res.status(403).json({ error: 'The survey evidence contains personal respondent data and can only be downloaded by an Admin or the PIC of that metric.' });
    if (!(await checkMetricRef(res, metric_id, { allowAll: true }))) return;
    const picMetric = req.user.role === 'ADMIN' ? null : await auth.getPicMetric(req.user, metric_id);
    const essMetric = metric_id !== 'ALL' ? (await storage.getMetrics()).find(m => m.metric_id === parseInt(metric_id, 10) && m.metric_type === 'SURVEY' && isEssMetric(m)) : null;
    // v2.50.0: rows are exported with the question texts stored with their upload; rows of more than one question-set
    // version come as a .zip (one CSV per version + README.txt), one version stays the single CSV of before.
    const sendEvidence = (out, csvName) => {
      if (out.kind === 'zip') {
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${out.fileName}"`);
        return res.send(out.buffer);
      }
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${csvName}"`);
      return res.send(out.content);
    };
    if (essMetric) {
      // ESS (v2.32.0): the stored summary rows of every period with the upload that brought them. A PIC gets only the
      // directorates of their own scope (the Bankwide row is for the Admin).
      const essOut = await generateEssEvidence(essMetric, { scopes: picMetric ? auth.respondentScopeFor(req.user, picMetric) : null });
      return sendEvidence(essOut, `Evidence_ESS_Summary_Metric_${essMetric.metric_id}.csv`);
    }
    const out = await generateSurveyEvidence(metric_id, period, { scopes: picMetric ? auth.respondentScopeFor(req.user, picMetric) : null });
    sendEvidence(out, metric_id === 'ALL'
      ? `Evidence_Survey_Master_All_Metrics_${period}.csv`
      : `Evidence_Survey_Metric_${metric_id}_${period}.csv`);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const csvUploadSingle = (req, res, next) => upload.fields([{ name: 'csvFile', maxCount: 1 }, { name: 'file', maxCount: 1 }])(req, res, err => {
  if (!err) {
    req.file = (req.files && ((req.files.csvFile && req.files.csvFile[0]) || (req.files.file && req.files.file[0]))) || undefined;
    // a second file in the other field is never used: remove it right away
    Object.values(req.files || {}).flat().forEach(f => { if (f !== req.file) fs.unlink(f.path, () => {}); });
    return next();
  }
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'The CSV file exceeds the 50 MB limit.' });
  return res.status(400).json({ error: 'The uploaded file could not be processed.' });
});

app.post('/api/surveys/upload', PIC_OR_ADMIN, csvUploadSingle, async (req, res) => {
  const tempFile = req.file ? req.file.path : null;
  try {
    // The target metric comes ONLY from the form field for a PIC (a metric_id column inside the CSV is ignored
    // by the importer whenever a target metric is given), so a PIC cannot write into somebody else's metric.
    const metricField = req.body ? req.body.metric_id : undefined;
    const gate = await auth.requirePicMetric(req, res, metricField);
    if (!gate) return;

    // The uploaded file is read once and removed from disk right away (before any answer is sent): it holds respondent
    // identities and /uploads is readable by every login.
    const fileBuf = req.file ? fs.readFileSync(req.file.path) : null;
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch (_) { /* finally retries */ } }

    // ESS metrics (v2.32.0) take ONLY the ESS summary .xlsx (one row per org unit); SYSTEM metrics keep the CSV import.
    const fileExt = req.file ? path.extname(repairUploadedName(req.file.originalname || '')).toLowerCase() : '';
    const targetMetric = metricField !== undefined && /^\d{1,9}$/.test(String(metricField))
      ? (await storage.getMetrics()).find(m => m.metric_id === parseInt(metricField, 10)) : null;
    // a file sent to a metric id that does not exist: say so (the CSV-text path keeps its per-row rejection, Module 39)
    if (req.file && metricField !== undefined && /^\d{1,9}$/.test(String(metricField)) && !targetMetric) {
      return res.status(404).json({ error: `Metric ${metricField} was not found.` });
    }
    if (targetMetric &&targetMetric.metric_type === 'SURVEY' && isEssMetric(targetMetric)) {
      if (!req.file) return res.status(400).json({ error: 'ESS metrics accept only the ESS summary Excel file (.xlsx). Download the ESS template, fill it in and upload it.' });
      if (fileExt !== '.xlsx') return res.status(415).json({ error: `ESS metrics accept only the ESS summary Excel file (.xlsx), not ${fileExt || 'a file without extension'}. CSV and the old .xls format are not accepted.` });
      const uploadedByEss = `${req.user.full_name} (${req.user.username})`.slice(0, 200);
      const essResult = await importEssSummary(fileBuf, repairUploadedName(req.file.originalname), targetMetric, { uploadedBy: uploadedByEss });
      if (!essResult.success) return res.status(essResult.status || 400).json(essResult);
      await auth.audit(req, 'SURVEY_UPLOAD', { target: `ESS summary metric ${targetMetric.metric_id}; period ${essResult.period}; ${essResult.rows_imported} rows${essResult.replaced_previous ? ' (replaced)' : ''}; batch ${essResult.upload_id}` });
      const { status, ...body } = essResult;
      // Directorate rows a PIC may not see are not echoed; the bankwide index of the file is the PIC's own upload.
      return res.json(body);
    }
    if (req.file && fileExt === '.xlsx') return res.status(400).json({ error: 'Excel (.xlsx) upload is only for ESS metrics. Upload a CSV file for this survey metric.' });

    let csvText = '';
    let fileName = 'manual_survey_data.csv';

    if (req.file) {
      csvText = fileBuf.toString('utf8');
      fileName = req.file.originalname;
    } else if (req.body && req.body.csvText) {
      csvText = req.body.csvText;
      fileName = req.body.fileName || 'manual_survey_input.csv';
    } else {
      return res.status(400).json({ error: 'A CSV file or CSV text data is required.' });
    }

    const targetMetricId = gate.metric ? gate.metric.metric_id : (metricField ? parseInt(metricField) : null);
    const uploadedBy = `${req.user.full_name} (${req.user.username})`.slice(0, 200);
    const result = await processSurveyCsv(csvText, fileName, targetMetricId, { uploadedBy });

    // Audit trail: who uploaded into which metric and how many rows - never the respondents' data.
    if (result.success) await auth.audit(req, 'SURVEY_UPLOAD', { target: `metric ${targetMetricId === null ? '(from the metric_id column)' : targetMetricId}; ${result.valid_rows_count} valid rows, ${result.invalid_rows_count} rejected; batch ${result.upload_id}` });
    // The PE Index recalculation below the import is bankwide; a PIC only gets what concerns the upload itself.
    if (req.user.role !== 'ADMIN') {
      delete result.calculation; delete result.updated_pe_index; delete result.updated_survey_index;
      result.affected_metrics = (result.affected_metrics || []).map(a => ({ ...a, normalized_score: null }));
    }
    res.json(result);
  } catch (err) {
    console.error('Survey upload error:', err);
    res.status(400).json({ error: err.message });
  } finally {
    // the uploaded CSV holds respondent identities and /uploads is readable by every logged-in user: never keep it
    if (tempFile) fs.unlink(tempFile, () => {});
  }
});

app.get('/api/surveys/history', async (req, res) => {
  try {
    const gate = await auth.requirePicMetric(req, res, null, { required: false });
    if (!gate) return;
    const history = await storage.getSurveyUploads();
    res.json(req.user.role === 'ADMIN' ? history : history.filter(h => h.metric_id !== null && gate.mine.some(p => p.metric_id === h.metric_id)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Original ESS summary file of one upload (audit trail, v2.32.0): the Admin, or the PIC of that upload's metric.
// Content-Disposition for an uploaded original file: an ASCII fallback name plus the UTF-8 name (RFC 6266 / 5987), so a
// name with characters outside Latin-1 (e.g. "März 数据.xlsx") no longer makes Node refuse the header with a 500 (v2.52.0).
function attachmentDisposition(fileName, fallback) {
  const name = String(fileName || fallback).replace(/["\r\n\\/]/g, '_');
  const ascii = name.normalize('NFKD').replace(/[^\x20-\x7E]/g, '_') || fallback;
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

app.get('/api/surveys/ess-file/:upload_id', async (req, res) => {
  try {
    const upload = (await storage.getSurveyUploads()).find(u => u.upload_id === req.params.upload_id);
    if (!upload || upload.metric_id === null) return res.status(404).json({ error: 'Upload not found.' });
    if (req.user.role !== 'ADMIN' && !(await auth.getPicMetric(req.user, upload.metric_id))) {
      return res.status(403).json({ error: 'The original ESS file can only be downloaded by an Admin or the PIC of that metric.' });
    }
    const filePath = essOriginalFilePath(upload.upload_id);
    if (!filePath) return res.status(404).json({ error: 'The original file of this upload is not stored (e.g. seed data).' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', attachmentDisposition(upload.file_name, 'ESS_summary.xlsx'));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(filePath);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/surveys/responses/:metric_id', async (req, res) => {
  try {
    if (!(await auth.canSeeRespondentData(req.user, req.params.metric_id))) return res.status(403).json({ error: 'Respondent data can only be viewed by an Admin or the PIC of that metric.' });
    if (!(await checkMetricRef(res, req.params.metric_id))) return;
    const responses = await storage.getUploadedResponsesByMetric(req.params.metric_id);
    if (req.user.role === 'ADMIN') return res.json(responses);
    res.json(auth.rowsForViewer(req.user, await auth.getPicMetric(req.user, req.params.metric_id), responses));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4c. Exit Interview dashboard (v2.38.0). Every login may read the aggregates (a USER only of their own data scope:
// another directorate -> 403); the per-employee rows (upload, template, history, CSV export) are Admin only.
const exitUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }); // never written to /uploads
const exitUploadSingle = (req, res, next) => exitUpload.single('file')(req, res, err => {
  if (!err) return next();
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'The exit interview file exceeds the 20 MB limit.' });
  return res.status(400).json({ error: 'The uploaded file could not be processed (send one .xlsx file in the field "file").' });
});

// v2.49.0: the whole Exit Interview API needs menu access `exit_interview` (an Admin always has it).
app.use('/api/exit-interview', auth.requireMenu('exit_interview'));

app.get('/api/exit-interview/summary', async (req, res) => {
  try {
    const scope = auth.scopeFilter(req, res);
    if (scope === null) return;
    const period = resolveExitPeriod(req.query);
    if (period.error) return res.status(400).json({ error: period.error });
    res.json(await getExitInterviewSummary(period, scope, { isAdmin: req.user.role === 'ADMIN' }));
  } catch (err) {
    console.error('Exit interview summary error:', err);
    res.status(500).json({ error: 'Failed to build the exit interview summary' });
  }
});

app.get('/api/exit-interview/template', ADMIN_ONLY, async (req, res) => {
  try {
    const xlsx = await generateExitTemplateXlsx();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Template_Exit_Interview.xlsx"');
    res.send(xlsx);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/exit-interview/upload', ADMIN_ONLY, exitUploadSingle, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Choose the exit interview Excel file (.xlsx) to upload.' });
    const fileName = repairUploadedName(req.file.originalname || 'exit_interview.xlsx');
    const ext = path.extname(fileName).toLowerCase();
    if (ext !== '.xlsx') return res.status(400).json({ error: `Only the exit interview Excel file (.xlsx) is accepted, not ${ext || 'a file without extension'}. CSV and the old .xls format are not accepted.` });
    const result = await importExitInterviews(req.file.buffer, fileName, { uploadedBy: `${req.user.full_name} (${req.user.username})`.slice(0, 200) });
    if (!result.success) return res.status(result.status || 400).json(result);
    await auth.audit(req, 'EXIT_INTERVIEW_UPLOAD', { target: `${result.rows_imported} rows (${result.inserted_rows} new, ${result.updated_rows} updated, ${result.removed_dummy_rows} dummy replaced); ${result.months.join(' ')}; batch ${result.upload_id}` });
    const { status, ...body } = result;
    res.json(body);
  } catch (err) {
    console.error('Exit interview upload error:', err);
    res.status(500).json({ error: 'The exit interview file could not be stored; nothing was imported.' });
  }
});

app.get('/api/exit-interview/uploads', ADMIN_ONLY, async (req, res) => {
  try {
    res.json(await storage.getExitInterviewUploads());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/exit-interview/export', ADMIN_ONLY, async (req, res) => {
  try {
    const scope = auth.scopeFilter(req, res);
    if (scope === null) return;
    const period = resolveExitPeriod(req.query);
    if (period.error) return res.status(400).json({ error: period.error });
    const { csv } = await generateExitExportCsv(period, scope);
    const tag = period.mode === 'MTD' ? `${period.year}-${String(period.month).padStart(2, '0')}` : `YTD_${period.year}`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="Exit_Interview_${tag}.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4d. Social media statistics of metric 1 (v2.52.0): Instagram / LinkedIn / TikTok followers, reach and engagement per
// month (bankwide). The Admin uploads an .xlsx (routes under /api/admin = Admin only; v2.53.0: the token-based integration
// endpoint of v2.52.0 is removed - the app is on-premise). The metric score itself stays the Admin's raw_value.
const SOCIAL_MAX_MB = 5;
const XLSX_MIME_TYPES = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream', 'application/zip', 'application/x-zip-compressed'];
const socialUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: SOCIAL_MAX_MB * 1024 * 1024 } }); // never written to /uploads
const socialUploadSingle = (req, res, next) => socialUpload.single('file')(req, res, err => {
  if (!err) return next();
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `The social media file exceeds the ${SOCIAL_MAX_MB} MB limit.` });
  return res.status(400).json({ error: 'The uploaded file could not be processed (send one .xlsx file in the field "file").' });
});

app.get('/api/admin/social-media/template', async (req, res) => {
  try {
    const xlsx = await socialMedia.generateSocialTemplateXlsx();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Template_Social_Media_Metric_${socialMedia.SOCIAL_MEDIA_METRIC_ID}.xlsx"`);
    res.send(xlsx);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/social-media/upload', socialUploadSingle, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Choose the social media Excel file (.xlsx) to upload.' });
    const fileName = repairUploadedName(req.file.originalname || 'social_media.xlsx');
    const ext = path.extname(fileName).toLowerCase();
    // the extension AND the (client-supplied) MIME type must both be an Excel workbook
    if (ext !== '.xlsx' || !XLSX_MIME_TYPES.includes(String(req.file.mimetype || '').toLowerCase())) {
      return res.status(415).json({ error: `Only the social media Excel file (.xlsx) is accepted, not ${ext || 'a file without extension'}${ext === '.xlsx' ? ` sent as ${req.file.mimetype}` : ''}. CSV and the old .xls format are not accepted.` });
    }
    const result = await socialMedia.importSocialMediaXlsx(req.file.buffer, fileName, { uploadedBy: `${req.user.full_name} (${req.user.username})`.slice(0, 200) });
    if (!result.success) return res.status(result.status || 400).json(result);
    await auth.audit(req, 'SOCIAL_MEDIA_UPLOAD', { target: `${result.rows_imported} rows (${result.inserted_rows} new, ${result.updated_rows} updated, ${result.replaced_seed_rows} seed replaced); ${result.periods.join(' ')}; batch ${result.upload_id}` });
    const { status, ...body } = result;
    res.json(body);
  } catch (err) {
    console.error('Social media upload error:', err.message);
    res.status(500).json({ error: 'The social media file could not be stored; nothing was imported.' });
  }
});

app.get('/api/admin/social-media/uploads', async (req, res) => {
  try {
    res.json(await socialMedia.getSocialMediaUploads());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/social-media/file/:upload_id', async (req, res) => {
  try {
    const upload = (await socialMedia.getSocialMediaUploads()).find(u => u.upload_id === req.params.upload_id);
    const filePath = upload ? socialMedia.socialOriginalFilePath(upload.upload_id) : null;
    if (!filePath) return res.status(404).json({ error: 'The original file of this upload is not stored.' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', attachmentDisposition(upload.file_name, 'social_media.xlsx'));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(filePath);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4e. Monthly values of OUTCOME metrics (v2.54.0): one bankwide value per month for every OUTCOME metric except metric 11 (live
// event attendance); metric 1's value too (its social media upload above stays the drilldown). Admin only (under /api/admin).
// A metric with stored months is scored from them (YTD = latest month in the window, MTD = that month, none -> NO_DATA).
// Evidence: the stored months (OUTCOME_VALUES; metric 1 with ?kind=social_media: its social media rows) or metric 11's
// attendances - Admin only, as
// OUTCOME metrics have no PIC login (respondent-level evidence is Admin / PIC only) and the attendances carry identities.
const OUTCOME_MAX_MB = 5;
const outcomeUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: OUTCOME_MAX_MB * 1024 * 1024 } }); // never written to /uploads
const outcomeUploadSingle = (req, res, next) => outcomeUpload.single('file')(req, res, err => {
  if (!err) return next();
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `The monthly values file exceeds the ${OUTCOME_MAX_MB} MB limit.` });
  return res.status(400).json({ error: 'The uploaded file could not be processed (send one .xlsx file in the field "file").' });
});

// The metric of :metric_id (strict number) or an answer: 400 malformed, 404 unknown; with uploadOnly, 400 when the metric
// takes no monthly values (SURVEY, metric 11); otherwise 400 when it has no OUTCOME evidence (SURVEY).
async function outcomeMetricOf(req, res, { uploadOnly }) {
  if (!/^\d{1,9}$/.test(String(req.params.metric_id))) { res.status(400).json({ error: 'metric_id must be a metric number.' }); return null; }
  const metric = await storage.getMetricById(parseInt(req.params.metric_id, 10));
  if (!metric) { res.status(404).json({ error: `Metric ${req.params.metric_id} was not found.` }); return null; }
  if (uploadOnly && !outcomeValues.isOutcomeUploadMetric(metric)) {
    res.status(400).json({ error: `Metric ${metric.metric_id} does not take uploaded monthly values (only OUTCOME metrics; metric 11 is calculated from event attendance, SURVEY metrics use the survey upload).` });
    return null;
  }
  if (!uploadOnly && !outcomeValues.evidenceTypeOf(metric)) {
    res.status(400).json({ error: `Metric ${metric.metric_id} is a SURVEY metric: its evidence is /api/surveys/evidence.` });
    return null;
  }
  return metric;
}

app.get('/api/admin/outcome-values/:metric_id/template', async (req, res) => {
  try {
    const metric = await outcomeMetricOf(req, res, { uploadOnly: true });
    if (!metric) return;
    // v2.55.0: ?year= (AVERAGE metrics: the year whose stored values the template shows; default the current year)
    let year = null;
    if (req.query.year !== undefined && req.query.year !== '') {
      const y = outcomeValues.parseUploadYear(req.query.year);
      if (y.error) return res.status(400).json({ error: y.error });
      year = y.year;
    }
    const xlsx = await outcomeValues.generateOutcomeTemplateXlsx(metric, new Date(), { year });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Template_Outcome_Metric_${metric.metric_id}.xlsx"`);
    res.send(xlsx);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/outcome-values/:metric_id/upload', outcomeUploadSingle, async (req, res) => {
  try {
    const metric = await outcomeMetricOf(req, res, { uploadOnly: true });
    if (!metric) return;
    if (!req.file) return res.status(400).json({ error: 'Choose the monthly values Excel file (.xlsx) to upload.' });
    const fileName = repairUploadedName(req.file.originalname || 'outcome_values.xlsx');
    const ext = path.extname(fileName).toLowerCase();
    // the extension AND the (client-supplied) MIME type must both be an Excel workbook
    if (ext !== '.xlsx' || !XLSX_MIME_TYPES.includes(String(req.file.mimetype || '').toLowerCase())) {
      return res.status(415).json({ error: `Only the monthly values Excel file (.xlsx) is accepted, not ${ext || 'a file without extension'}${ext === '.xlsx' ? ` sent as ${req.file.mimetype}` : ''}. CSV and the old .xls format are not accepted.` });
    }
    // v2.55.0: AVERAGE metrics (metric 1) are uploaded one year at a time - the form field "year" (the file has no year)
    const result = await outcomeValues.importOutcomeXlsx(req.file.buffer, fileName, metric, {
      uploadedBy: `${req.user.full_name} (${req.user.username})`.slice(0, 200), year: req.body ? req.body.year : undefined
    });
    if (!result.success) return res.status(result.status || 400).json(result);
    const yearPart = result.year ? `year ${result.year} replaced, ${result.deleted_rows} removed; average ${result.average_value}; ` : '';
    await auth.audit(req, 'OUTCOME_UPLOAD', { target: `metric ${metric.metric_id}; ${yearPart}${result.rows_imported} months (${result.inserted_rows} new, ${result.updated_rows} updated); ${result.periods.join(' ')}; batch ${result.upload_id}` });
    const { status, ...body } = result;
    res.json(body);
  } catch (err) {
    console.error('Outcome values upload error:', err.message);
    res.status(500).json({ error: 'The monthly values file could not be stored; nothing was imported.' });
  }
});

app.get('/api/admin/outcome-values/:metric_id/uploads', async (req, res) => {
  try {
    const metric = await outcomeMetricOf(req, res, { uploadOnly: true });
    if (!metric) return;
    res.json(await outcomeValues.getOutcomeUploads(metric.metric_id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/outcome-values/uploads/:upload_id/file', async (req, res) => {
  try {
    const upload = (await storage.getOutcomeUploads()).find(u => u.upload_id === req.params.upload_id);
    const filePath = upload ? outcomeValues.outcomeOriginalFilePath(upload.upload_id) : null;
    if (!filePath) return res.status(404).json({ error: 'The original file of this upload is not stored.' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', attachmentDisposition(upload.file_name, 'outcome_values.xlsx'));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(filePath);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ?period= ALL (default) | YTD | YYYY | YYYY-MM; ?kind=social_media (metric 1 only) = its social media rows
app.get('/api/admin/outcome-evidence/:metric_id', async (req, res) => {
  try {
    const metric = await outcomeMetricOf(req, res, { uploadOnly: false });
    if (!metric) return;
    const mp = outcomeValues.parseEvidencePeriod(req.query.period);
    if (!mp) return res.status(400).json({ error: 'period must be ALL, YTD, a year (YYYY) or a month (YYYY-MM).' });
    const kind = req.query.kind ? String(req.query.kind) : null;
    if (kind && !(kind === 'values' || (kind === 'social_media' && socialMedia.isSocialMediaMetric(metric)))) {
      return res.status(400).json({ error: 'kind must be "values" (or "social_media" for metric 1).' });
    }
    const { fileName, csv } = await outcomeValues.generateOutcomeEvidence(metric, mp, kind);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// v2.55.0: composite SUMMARY metrics (metric 7 = 4 parts, metric 5 and 12 = 1 part): per part an Admin .xlsx summary upload
// (Directorate | Level | Year | Month | score | questions | Jumlah Responden | Periode), its template and its evidence CSV.
// Admin only (like the OUTCOME uploads): these metrics' summaries are not per-respondent data, so no PIC path was added.
const partUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: OUTCOME_MAX_MB * 1024 * 1024 } }); // never written to disk
const partUploadSingle = (req, res, next) => partUpload.single('file')(req, res, err => {
  if (!err) return next();
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `The summary file exceeds the ${OUTCOME_MAX_MB} MB limit.` });
  return res.status(400).json({ error: 'The uploaded file could not be processed (send one .xlsx file in the field "file").' });
});

// { metric, parts, part } of :metric_id (+ :part_key) or an answer: 400 malformed, 404 unknown metric / part or a metric
// without parts
async function metricPartOf(req, res, { needPart = true } = {}) {
  if (!/^\d{1,9}$/.test(String(req.params.metric_id))) { res.status(400).json({ error: 'metric_id must be a metric number.' }); return null; }
  const metric = await storage.getMetricById(parseInt(req.params.metric_id, 10));
  if (!metric) { res.status(404).json({ error: `Metric ${req.params.metric_id} was not found.` }); return null; }
  const parts = await storage.getMetricParts(metric.metric_id);
  if (!parts.length) { res.status(404).json({ error: `Metric ${metric.metric_id} is not scored from uploaded summary parts.` }); return null; }
  if (!needPart) return { metric, parts };
  const part = parts.find(p => p.part_key === String(req.params.part_key || ''));
  if (!part) { res.status(404).json({ error: `Metric ${metric.metric_id} has no part "${String(req.params.part_key || '').slice(0, 40)}".` }); return null; }
  return { metric, parts, part };
}

app.get('/api/admin/metric-parts/:metric_id', async (req, res) => {
  try {
    const found = await metricPartOf(req, res, { needPart: false });
    if (!found) return;
    const uploads = await storage.getMetricPartUploads(found.metric.metric_id);
    res.json({
      metric_id: found.metric.metric_id,
      metric_name: found.metric.metric_name,
      parts: found.parts.map(p => ({ part_key: p.part_key, part_name: p.part_name, sort_order: p.sort_order, scale: metricParts.scaleOf(p),
        kind: partQuestions.partKind(p), questions: Array.isArray(p.questions) ? p.questions : null, // v2.57.0 Summary Questions
        uploads: uploads.filter(u => u.part_key === p.part_key) }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/metric-parts/:metric_id/:part_key/template', async (req, res) => {
  try {
    const found = await metricPartOf(req, res);
    if (!found) return;
    const xlsx = await metricParts.generatePartTemplateXlsx(found.metric, found.part);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Template_Metric_${found.metric.metric_id}_${found.part.part_key}.xlsx"`);
    res.send(xlsx);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/metric-parts/:metric_id/:part_key/upload', partUploadSingle, async (req, res) => {
  try {
    const found = await metricPartOf(req, res);
    if (!found) return;
    if (!req.file) return res.status(400).json({ error: 'Choose the summary Excel file (.xlsx) to upload.' });
    const fileName = repairUploadedName(req.file.originalname || 'summary.xlsx');
    const ext = path.extname(fileName).toLowerCase();
    if (ext !== '.xlsx' || !XLSX_MIME_TYPES.includes(String(req.file.mimetype || '').toLowerCase())) {
      return res.status(415).json({ error: `Only the summary Excel file (.xlsx) is accepted, not ${ext || 'a file without extension'}${ext === '.xlsx' ? ` sent as ${req.file.mimetype}` : ''}.` });
    }
    const result = await metricParts.importPartXlsx(req.file.buffer, fileName, found.metric, found.part, { uploadedBy: `${req.user.full_name} (${req.user.username})`.slice(0, 200) });
    if (!result.success) return res.status(result.status || 400).json(result);
    await auth.audit(req, 'METRIC_PART_UPLOAD', { target: `metric ${found.metric.metric_id} ${found.part.part_key}; ${result.rows_imported} rows (${result.replaced_rows} replaced); ${result.periods.join(' ')}; batch ${result.upload_id}` });
    const { status, ...body } = result;
    res.json(body);
  } catch (err) {
    console.error('Metric part upload error:', err.message);
    res.status(500).json({ error: 'The summary file could not be stored; nothing was imported.' });
  }
});

// v2.57.0: Summary Questions (Admin Parameters -> Summary Questions; Admin only like every /api/admin route): the configured questions
// of every summary part. The upload maps the file's question columns BY POSITION to them (count must match), the template uses them
// as its headers. GET lists every summary metric with its parts; PUT replaces the questions of one part (audit PART_QUESTIONS_UPDATE).
async function partQuestionsView(part) {
  const uploads = await storage.getMetricPartUploads(part.metric_id, part.part_key);
  const latest = uploads[0] || null;
  const latestCols = (latest && latest.columns) || {};
  const latestTexts = Array.isArray(latestCols.questions_snapshot)
    ? latestCols.questions_snapshot.map(q => q.text)
    : (latest ? partQuestions.firstEventBlock(latestCols.question_labels || [], latestCols.event_labels || []) : null);
  const questions = Array.isArray(part.questions) ? part.questions : [];
  return {
    part_key: part.part_key,
    part_name: part.part_name,
    sort_order: part.sort_order,
    scale: metricParts.scaleOf(part),
    kind: partQuestions.partKind(part),
    configured: Array.isArray(part.questions),
    questions,
    event_labels: partQuestions.isEventPart(part)
      ? (Array.isArray(latestCols.event_labels) && latestCols.event_labels.length ? latestCols.event_labels : part.template.event_labels)
      : [],
    uploads_count: uploads.length,
    latest_upload: latest ? { upload_id: latest.upload_id, file_name: latest.file_name, uploaded_at: latest.uploaded_at, question_texts: latestTexts } : null,
    // the configured texts differ from those of the latest upload: the next upload must follow the new configuration
    differs_from_latest_upload: !!latest && partQuestions.questionSetKey(questions) !== partQuestions.questionSetKey((latestTexts || []).map(text => ({ text })))
  };
}

app.get('/api/admin/part-questions', async (req, res) => {
  try {
    const parts = await storage.getMetricParts();
    const metrics = await storage.getMetrics();
    const numbers = await loadDisplayNumbers(storage);
    const out = [];
    for (const [metricId, list] of metricParts.partsByMetric(parts)) {
      const m = metrics.find(x => x.metric_id === metricId);
      if (!m) continue;
      const views = [];
      for (const p of list) views.push(await partQuestionsView(p));
      out.push({ metric_id: metricId, display_no: numbers.get(metricId) ?? null, metric_name: m.metric_name, parts: views });
    }
    out.sort((a, b) => a.display_no - b.display_no);
    res.json({ metrics: out, question_types: partQuestions.QUESTION_TYPES, max_text: partQuestions.MAX_QUESTION_TEXT, max_questions: partQuestions.MAX_QUESTIONS });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/part-questions/:metric_id/:part_key', async (req, res) => {
  try {
    const found = await metricPartOf(req, res);
    if (!found) return;
    const body = req.body || {};
    const norm = partQuestions.normalizeQuestions(body.questions, found.part);
    if (norm.error) return res.status(400).json({ error: norm.error });
    const saved = await storage.setMetricPartQuestions(found.metric.metric_id, found.part.part_key, norm.questions);
    if (!saved) return res.status(404).json({ error: `Metric ${found.metric.metric_id} has no part "${found.part.part_key}".` });
    const changes = partQuestions.describeChanges(Array.isArray(found.part.questions) ? found.part.questions : null, norm.questions);
    await auth.audit(req, 'PART_QUESTIONS_UPDATE', { target: `metric ${found.metric.metric_id} ${found.part.part_key}: ${changes}` });
    res.json({ success: true, metric_id: found.metric.metric_id, changes, part: await partQuestionsView(saved) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ?period= ALL (default) | YTD | YYYY | YYYY-MM
app.get('/api/admin/metric-parts/:metric_id/:part_key/evidence', async (req, res) => {
  try {
    const found = await metricPartOf(req, res);
    if (!found) return;
    const mp = outcomeValues.parseEvidencePeriod(req.query.period);
    if (!mp) return res.status(400).json({ error: 'period must be ALL, YTD, a year (YYYY) or a month (YYYY-MM).' });
    const { fileName, csv } = await metricParts.generatePartEvidence(found.metric, found.part, mp);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Events Management (Signature Programs)

// Only Admins and Users with menu access `events` get here (EVENT_MANAGER), and they see every attendance /
// feedback row and the access codes - the rights the old "event manager" had (before v2.49.0 other Users could read
// a scope-filtered, redacted view).
app.get('/api/events', EVENT_MANAGER, async (req, res) => {
  try {
    const events = await storage.getEvents();
    const enriched = await Promise.all(events.map(async e => {
      const atts = await storage.getAttendancesByEvent(e.event_id);
      const feedbacks = await storage.getFeedbackByEvent(e.event_id);

      let totalRating = 0;
      let count = 0;
      feedbacks.forEach(f => {
        if (f.ratings) {
          Object.values(f.ratings).forEach(v => {
            if (typeof v === 'number') {
              totalRating += v;
              count++;
            }
          });
        }
      });
      const avgScore = count > 0 ? (totalRating / count).toFixed(2) : '0.00';

      return {
        ...e,
        total_attendees: atts.length,
        total_feedbacks: feedbacks.length,
        average_rating: avgScore,
        satisfaction_percentage: ((parseFloat(avgScore) / 5.0) * 100).toFixed(1)
      };
    }));
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/events/:id', EVENT_MANAGER, async (req, res) => {
  try {
    const event = await storage.getEventById(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    res.json({
      event,
      questions: await storage.getEventQuestions(event.event_id),
      attendances: await storage.getAttendancesByEvent(event.event_id),
      feedbacks: await storage.getFeedbackByEvent(event.event_id),
      media: await storage.getMediaByEvent(event.event_id)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/events', EVENT_MANAGER, async (req, res) => {
  try {
    const newEvent = await storage.createEvent(req.body);
    // Recalculate metrics
    await calculatePEIndex();
    res.status(201).json({ success: true, event: newEvent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/events/:id', EVENT_MANAGER, async (req, res) => {
  try {
    const removed = await storage.deleteEvent(req.params.id);
    await calculatePEIndex();
    res.json({ success: true, event: removed });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// The public forms never need the access codes (the visitor already has one); do not hand out the partner code.
const publicEvent = e => ({ ...e, pre_event_code: null, post_event_code: null });

app.get('/api/events/by-code/:code', async (req, res) => {
  const code = req.params.code.toUpperCase();
  const preEvent = await storage.getEventByPreCode(code);
  if (preEvent) {
    return res.json({ type: 'PRE_EVENT', event: publicEvent(preEvent) });
  }
  const postEvent = await storage.getEventByPostCode(code);
  if (postEvent) {
    const questions = await storage.getEventQuestions(postEvent.event_id);
    return res.json({ type: 'POST_EVENT', event: publicEvent(postEvent), questions });
  }
  res.status(404).json({ error: 'Invalid event access code' });
});

// Master & Event Questions
app.get('/api/questions/master', EVENT_MANAGER, async (req, res) => { // the Create Event form's question bank
  res.json(await storage.getMasterQuestions());
});

app.post('/api/questions/master', ADMIN_ONLY, async (req, res) => {
  try {
    const updated = await storage.updateMasterQuestions(req.body.questions);
    res.json({ success: true, questions: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/events/:id/questions', EVENT_MANAGER, async (req, res) => {
  try {
    const updated = await storage.saveEventQuestions(req.params.id, req.body.questions);
    res.json({ success: true, questions: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Public Form Submissions (Attendance & Post-Event Evaluation)
app.post('/api/events/:id/attendance', async (req, res) => {
  try {
    const { nip, employee_name, cimb_email, directorate, division } = req.body;
    if (!nip || !employee_name || !cimb_email) {
      return res.status(400).json({ error: 'NIP, Employee Name and CIMB Email are required.' });
    }

    // Format validation
    if (!/^[a-zA-Z0-9]{4,15}$/.test(nip.trim())) {
      return res.status(400).json({ error: 'Invalid NIP format. Enter 4-15 alphanumeric characters.' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cimb_email.trim())) {
      return res.status(400).json({ error: 'Invalid email format.' });
    }

    // v2.51.0: a former directorate / division name (renamed or merged) is stored under the current one
    const resolver = await loadResolver(storage);
    const currentDir = directorate ? resolver.directorate(directorate) : null;
    const record = await storage.addAttendance({
      event_id: req.params.id,
      nip,
      employee_name,
      cimb_email,
      directorate: currentDir || directorate,
      division: (currentDir && division && resolver.division(currentDir, division)) || division
    });

    // Auto-recalculate PE Index in real-time
    await calculatePEIndex();

    res.status(201).json({ success: true, message: 'Attendance recorded successfully!', attendance: record });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/events/:id/feedback', async (req, res) => {
  try {
    const { nip, ratings, verbatim } = req.body;
    if (!nip) {
      return res.status(400).json({ error: 'NIP is required to verify participation.' });
    }

    const record = await storage.addFeedbackResponse({
      event_id: req.params.id,
      nip,
      ratings,
      verbatim
    });

    // Auto-recalculate PE Index in real-time
    await calculatePEIndex();

    res.status(201).json({ success: true, message: 'Thank you, your satisfaction evaluation was submitted successfully!', response: record });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/events/:id/attendance/:nip', EVENT_MANAGER, async (req, res) => {
  try {
    const removed = await storage.deleteAttendance(req.params.id, req.params.nip);
    await calculatePEIndex();
    res.json({ success: true, attendance: removed });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/events/:id/feedback/:nip', EVENT_MANAGER, async (req, res) => {
  try {
    const removed = await storage.deleteFeedbackResponse(req.params.id, req.params.nip);
    await calculatePEIndex();
    res.json({ success: true, feedback: removed });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 6. Media Gallery Uploads
app.post('/api/events/:id/media', EVENT_MANAGER, async (req, res, next) => {
  const maxMb = await getMediaMaxMb();
  mediaUploaderFor(maxMb).single('mediaFile')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `The file exceeds the ${mediaLimitLabel(maxMb)} limit.`, max_mb: maxMb });
    }
    if (err.code === 'UNSUPPORTED_MEDIA_TYPE') {
      return res.status(415).json({ error: err.message });
    }
    return res.status(400).json({ error: err.message });
  });
}, async (req, res) => {
  try {
    const { caption, file_type } = req.body;
    const file = req.file;

    const event = await storage.getEventById(req.params.id);
    const mediaPath = file ? `/uploads/${file.filename}` : '/uploads/sample.jpg';
    const originalName = file ? repairUploadedName(file.originalname) : 'media_upload.jpg';
    // The browser-reported MIME type is more trustworthy than the client's file_type field.
    const detectedType = file
      ? (file.mimetype.startsWith('video/') ? 'VIDEO' : 'IMAGE')
      : (file_type || 'IMAGE');

    const newMedia = await storage.addMedia({
      event_id: req.params.id,
      file_name: originalName,
      file_path: mediaPath,
      file_type: detectedType,
      caption: caption || `Documentation ${event ? event.event_name : 'Event'}`,
      transcript_status: detectedType === 'VIDEO' && file ? 'PROCESSING' : undefined
    });

    // Transcription can take minutes (Whisper on CPU) — answer the upload right away and let
    // the UI poll the event detail for the transcript.
    if (newMedia.transcript_status === 'PROCESSING') {
      setImmediate(() => queueMediaTranscription(newMedia.media_id).catch(err => console.error('Transcription queue failed:', err.message)));
    }

    res.status(201).json({ success: true, media: newMedia });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// (Re)run the AI transcript for an uploaded video — used by the "Coba lagi" button after a
// failure, e.g. when the local transcribe API wasn't running at upload time.
app.post('/api/media/:id/transcribe', EVENT_MANAGER, async (req, res) => {
  try {
    const media = await storage.getMediaById(req.params.id);
    if (!media) return res.status(404).json({ error: 'Media not found.' });
    if (media.file_type !== 'VIDEO') {
      return res.status(400).json({ error: 'The AI transcript is only available for video files.' });
    }
    if (media.transcript_status === 'PROCESSING') {
      return res.status(409).json({ error: 'The transcript is already being processed.' });
    }
    // Tell the user right away (instead of flipping PROCESSING → FAILED in a few milliseconds) when the
    // Video Extractor is not running.
    if (!(await isTranscribeApiReachable())) {
      return res.status(503).json({ error: unreachableMessage() });
    }
    await queueMediaTranscription(media.media_id);
    res.status(202).json({ success: true, media: await storage.getMediaById(media.media_id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// (Re)make the AI summary of a video's transcript - the "Buat ulang ringkasan" button, for event managers only.
// This is an explicit user action; the only other trigger is a NEW video's transcript finishing (transcribeService).
app.post('/api/media/:id/summarize', EVENT_MANAGER, async (req, res) => {
  try {
    const media = await storage.getMediaById(req.params.id);
    if (!media) return res.status(404).json({ error: 'Media not found.' });
    if (media.file_type !== 'VIDEO') return res.status(400).json({ error: 'The AI summary is only available for video files.' });
    if (media.transcript_status !== 'DONE' || !media.transcript) {
      return res.status(409).json({ error: 'The video transcript is not finished yet, so the summary cannot be created.' });
    }
    if (media.summary_status === 'PROCESSING' || isSummaryInFlight(media.media_id)) return res.status(409).json({ error: 'The summary is already being processed.' });
    await queueMediaSummary(media.media_id);
    res.status(202).json({ success: true, media: await storage.getMediaById(media.media_id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/media/:id', EVENT_MANAGER, async (req, res) => {
  try {
    // Uploaded videos are large - don't leave the file behind once its record is gone (always the file the record
    // currently points to: a finished video may have been renamed to its original upload name).
    await deleteMediaAndFile(req.params.id);
    res.json({ success: true, message: 'Media deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. PowerPoint (PPTX) Generation & Download
app.post('/api/events/:id/generate-ppt', EVENT_MANAGER, async (req, res) => {
  try {
    const { fileName, filePath } = await generateEventPPT(req.params.id);
    res.json({
      success: true,
      message: 'PPT Presentation successfully generated on local server!',
      fileName,
      download_url: `/api/reports/download/${fileName}`
    });
  } catch (err) {
    console.error('Error generating PPT:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reports/download/:fileName', EVENT_MANAGER, async (req, res) => {
  const filePath = path.join(EXPORTS_DIR, path.basename(req.params.fileName));
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).json({ error: 'File not found' });
  }
});

// 8. QR Code Generator Endpoint (the QR codes of the event check-in / feedback forms)
app.get('/api/qrcode', EVENT_MANAGER, async (req, res) => {
  const { text } = req.query;
  if (!text) return res.status(400).json({ error: 'Text query param is required' });
  try {
    const qrDataUrl = await QRCode.toDataURL(text, {
      color: {
        dark: '#ED1C24', // CIMB Red QR
        light: '#FFFFFF'
      },
      width: 280,
      margin: 2
    });
    res.json({ qr_data_url: qrDataUrl });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// Last-resort error handler: a clean JSON answer, never an HTML page with a stack trace.
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (res.headersSent) return next(err);
  const status = err && Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status === 500) console.error('Unhandled error:', err && err.message);
  const messages = { 400: 'Invalid request.', 413: 'The request exceeds the size limit.' };
  res.status(status).json({ error: err && err.code === 'LIMIT_FILE_SIZE' ? 'The file exceeds the size limit.' : (messages[status] || 'A server error occurred.') });
});

// Serve frontend dist assets for production
const DIST_DIR = path.join(__dirname, '..', 'dist');
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/exports')) {
      return next();
    }
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

// Start Server — after the storage backend is ready (a no-op for the JSON file store; for SQL
// Server it opens the connection pool, verifies the schema and tops up the seed data).
const storageReady = Promise.resolve(typeof storage.init === 'function' ? storage.init() : null);
// Node's default requestTimeout is 5 minutes for receiving ONE whole request; a large event video over a slow link can
// need longer, so it follows the 120-minute job limit (override: REQUEST_TIMEOUT_MS). headersTimeout / keepAliveTimeout
// keep Node's defaults (they only concern the header and idle keep-alive connections, not long uploads or jobs; the
// transcript and summary jobs run in the background and the HTTP answer of their routes is immediate).
const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS || String(120 * 60 * 1000), 10);
storageReady.then(() => { const httpServer = app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 CIMB Niaga People Experience Backend is running`);
  console.log(`📡 URL: http://localhost:${PORT}`);
  console.log(`📊 Health: http://localhost:${PORT}/api/health`);
  console.log(`=======================================================`);

  // Video transcripts interrupted by a restart would otherwise sit on PROCESSING forever.
  // (PX_DISABLE_RESUME=1 is only for a throw-away second backend sharing the database of a running one, so it does not
  // take over that backend's videos that are being processed.)
  // Leftover server/tmp-transcribe folders (named hard links for the Video Extractor) of jobs that are no longer running
  // are removed first; the folder of a media that is still PROCESSING stays and is re-made when its job resumes.
  cleanupTranscribeTempDirs().catch(err => console.error('Cleanup of temporary transcript folders failed:', err.message)).then(() => {
    if (process.env.PX_DISABLE_RESUME !== '1') {
      resumeInterruptedTranscriptions().catch(err => console.error('Resume transcriptions failed:', err.message));
      // Only summaries that were mid-way (PROCESSING) when the server stopped continue; old videos without one stay untouched.
      resumeInterruptedSummaries().catch(err => console.error('Resume summaries failed:', err.message));
    }
  });

  // Automatic Survey Upload Reminders: on a metric's deadline day, if the PIC has not uploaded the
  // previous month's survey data, the PIC is emailed (see services/reminderService.js). Runs at boot
  // (catch-up) and every 30 minutes; px_reminder_log prevents duplicate emails.
  // (PX_DISABLE_SCHEDULERS=1 is only for the throw-away second backend that the regression suite starts.)
  if (process.env.PX_DISABLE_SCHEDULERS !== '1') startReminderScheduler();

  // Warn loudly when there is no login account yet (create one with `npm run auth:create-admin`).
  auth.warnIfNoUsers();
}); httpServer.requestTimeout = REQUEST_TIMEOUT_MS; }).catch(err => {
  console.error('Storage backend failed to start:', err.message);
  console.error('Set STORAGE_BACKEND=json in .env to fall back to the JSON file store.');
  process.exit(1);
});
