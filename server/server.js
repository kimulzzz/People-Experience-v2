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
const { calculatePEIndex, getMetricDetail, computeMonthlyTrends, getLastCompleteMonth, normalizeTarget } = require('./services/calculationEngine');
const { getAlertsAndRecommendations } = require('./services/alertEngine');
const { generateEventPPT } = require('./services/pptGenerator');
const { isOllamaAvailable, generateEventSummary } = require('./services/localAiService');
const { generateSurveyCsvTemplate } = require('./services/surveyTemplateService');
const { processSurveyCsv } = require('./services/surveyImportService');
const { generateSurveyEvidenceCsv } = require('./services/surveyEvidenceService');
const { importEssSummary, generateEssTemplateXlsx, generateEssEvidenceCsv, essOriginalFilePath } = require('./services/essSummaryService');
const { importExitInterviews, resolveExitPeriod, getExitInterviewSummary, generateExitTemplateXlsx, generateExitExportCsv } = require('./services/exitInterviewService');
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

// Static files need a login too: uploaded media for any logged-in user, generated PPT reports only
// for people who may manage events. (The public check-in / feedback forms use neither.)
// Second line of defence behind the upload filter: nosniff + a sandboxing CSP on every file (script never runs even if an
// HTML/SVG file ever lands here), and anything that is not an allowlisted photo/video type is only offered as a download.
app.use('/uploads', auth.requireLogin, (req, res, next) => {
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
// Videos get a higher cap than the 50MB CSV limit — event recordings are routinely larger.
const MEDIA_MAX_MB = parseInt(process.env.MEDIA_MAX_MB || '200', 10);
const mediaUpload = multer({
  storage: multerStorage,
  limits: { fileSize: MEDIA_MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // Both checks must agree: the (client-supplied) MIME type AND the file extension, which decides the stored name and
    // how /uploads serves it. SVG is refused (script), as is anything like evil.html sent with a video/mp4 MIME type.
    const mimeKind = /^image\/(?!svg)/.test(file.mimetype) ? 'IMAGE' : (/^video\//.test(file.mimetype) ? 'VIDEO' : null);
    const nameKind = mediaKindOfName(repairUploadedName(file.originalname));
    if (mimeKind && mimeKind === nameKind) return cb(null, true);
    const err = new Error('Unsupported file format. Upload a photo (JPG/PNG/GIF/WEBP/BMP/AVIF) or a video (MP4/MOV/WEBM/MKV/AVI) whose file extension matches its type. SVG is not accepted.');
    err.code = 'UNSUPPORTED_MEDIA_TYPE';
    cb(err);
  }
});

// ==========================================
// API ROUTES
// ==========================================

// Login gate: every /api route below needs a session except the public whitelist in
// services/authService.js (PUBLIC_ROUTES); everything under /api/admin is ADMIN only.
auth.registerAuthRoutes(app);
const ADMIN_ONLY = auth.requireRole('ADMIN');
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
    return res.json({ status: 'online', system: 'CIMB Niaga People Experience Integrated System', version: '2.46.0' });
  }
  res.json({
    status: 'online',
    system: 'CIMB Niaga People Experience Integrated System',
    version: '2.46.0',
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
  session_idle_timeout_minutes: { min: 1, max: 120, integer: true, label: 'Auto sign-out after inactivity (minutes)' }
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
    if (NUMERIC_SETTINGS[key]) {
      const { min, max, integer, label } = NUMERIC_SETTINGS[key];
      const n = Number(value);
      if (value === '' || value === null || !Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
        return res.status(400).json({ error: `${label} must be ${integer ? 'a whole number' : 'a number'} between ${min} and ${max}.` });
      }
      const saved = await storage.setSetting(key, n);
      if (key === 'session_idle_timeout_minutes') auth.clearIdleTimeoutCache();
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
    res.json(await emailSettingsService.updateSettings(req.body || {}));
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
    // A USER reads non-employee metrics (#1-#5 ...) as read-only bankwide values instead of "exempted";
    // they stay out of the directorate's index so the total equals what the Admin sees for that directorate.
    const calculation = await calculatePEIndex(filterOptions, { bankwideReadOnly: req.user.role !== 'ADMIN' });
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
    let { directorate, sub_directorate, scopes } = scope;
    // Bankwide / non-employee metrics (campus, candidates, ...) have no directorate: a USER reads
    // them as the bankwide aggregate (read-only) instead of an "exempted" empty view.
    if (req.user.role !== 'ADMIN') {
      const metric = (await storage.getMetrics()).find(m => String(m.metric_id) === String(req.params.id));
      if (metric && metric.is_employee_metric === false) { directorate = 'ALL'; sub_directorate = 'ALL'; scopes = null; }
    }
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

// ==========================================
// ADMIN PARAMETERS: JOURNEYS & METRICS CRUD
// ==========================================
app.get('/api/admin/parameters', async (req, res) => {
  try {
    const journeys = await storage.getJourneys();
    const checkpoints = await storage.getCheckpoints();
    const directorates = await storage.getDirectorates();
    // target_value_normalized converts each metric's raw target (e.g. 4.00 on a 1-5
    // Likert scale) into the same 0-100 scale as min_threshold, so Admin Parameters can
    // display Target and Threshold using one consistent unit instead of mixing scales.
    const metrics = (await storage.getMetrics()).map(m => ({
      ...m,
      target_value_normalized: parseFloat(normalizeTarget(m, m).toFixed(2))
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

// Add Journey
app.post('/api/admin/journeys', async (req, res) => {
  try {
    const journey = await storage.addJourney(req.body);
    const calculation = await calculatePEIndex();
    res.status(201).json({ success: true, journey, calculation });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update Journey
app.put('/api/admin/journeys/:id', async (req, res) => {
  try {
    const journey = await storage.updateJourney(req.params.id, req.body);
    const calculation = await calculatePEIndex();
    res.json({ success: true, journey, calculation });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete Journey
app.delete('/api/admin/journeys/:id', async (req, res) => {
  try {
    const result = await storage.deleteJourney(req.params.id);
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
    const calculation = await calculatePEIndex();
    res.status(201).json({ success: true, metric, calculation, ...metric });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update Metric (Parameters: Name, Journey, Checkpoint, Weight, Target, Threshold, Audience, etc.)
app.put('/api/admin/metrics/:id', async (req, res) => {
  try {
    const metric = await storage.updateMetric(req.params.id, req.body);
    const calculation = await calculatePEIndex();
    res.json({ success: true, metric, calculation, ...metric });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete Metric
app.delete('/api/admin/metrics/:id', async (req, res) => {
  try {
    // its ESS uploads go with it (documented cascade), so their original files are removed too (v2.32.0)
    const essUploadIds = (await storage.getSurveyUploads()).filter(u => String(u.metric_id) === String(parseInt(req.params.id, 10))).map(u => u.upload_id);
    const result = await storage.deleteMetric(req.params.id);
    essUploadIds.forEach(id => { const f = essOriginalFilePath(id); if (f) fs.unlink(f, () => {}); });
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
    const saved = await storage.saveMetricTargets(targets);
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
    if (!(await storage.getMetricById(metric_id))) return res.status(404).json({ error: `Metric #${metric_id} not found.` });
    const saved = await storage.saveSurveyQuestions(metric_id, questions);
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
    const reset = await storage.resetSurveyQuestions(metric_id);
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
    const reminders = await getPendingUploadReminders();
    res.json({
      total_reminders: reminders.length,
      overdue_count: reminders.filter(r => r.status === 'OVERDUE').length,
      due_today_count: reminders.filter(r => r.status === 'DUE_TODAY').length,
      reminders,
      history: await storage.getReminderLog(20)
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

    await storage.updateMetricWeights(weights);
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
    const alertsData = await getAlertsAndRecommendations({ ...scope, bankwideReadOnly: req.user.role !== 'ADMIN' });
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

app.get('/api/action-library', async (req, res) => {
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
    const metrics = (await storage.getMetrics()).filter(m => m.metric_type === 'SURVEY');
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
    if (essMetric) {
      // ESS (v2.32.0): the stored summary rows of every period with the upload that brought them. A PIC gets only the
      // directorates of their own scope (the Bankwide row is for the Admin).
      const essCsv = await generateEssEvidenceCsv(essMetric, { scopes: picMetric ? auth.respondentScopeFor(req.user, picMetric) : null });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="Evidence_ESS_Summary_Metric_${essMetric.metric_id}.csv"`);
      return res.send(essCsv);
    }
    const csvContent = await generateSurveyEvidenceCsv(metric_id, period, { scopes: picMetric ? auth.respondentScopeFor(req.user, picMetric) : null });
    const filename = metric_id === 'ALL'
      ? `Evidence_Survey_Master_All_Metrics_${period}.csv`
      : `Evidence_Survey_Metric_${metric_id}_${period}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvContent);
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
    res.setHeader('Content-Disposition', `attachment; filename="${String(upload.file_name || 'ESS_summary.xlsx').replace(/["\r\n\\/]/g, '_')}"`);
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

// 5. Events Management (Signature Programs)
const hideEventCodes = e => ({ ...e, pre_event_code: null, post_event_code: null });

// A User who does not manage events only sees attendance / feedback rows of attendees inside their data
// scope (feedback carries just the NIP, so it follows the attendee's directorate/division). Managers and
// Admins see everything.
async function eventRowsForViewer(req, eventId) {
  let atts = await storage.getAttendancesByEvent(eventId);
  let feedbacks = await storage.getFeedbackByEvent(eventId);
  if (!(await auth.isEventManager(req.user))) {
    const inScope = new Set(atts.filter(a => auth.isInScope(req.user, a.directorate, a.division)).map(a => a.nip));
    atts = atts.filter(a => inScope.has(a.nip));
    feedbacks = feedbacks.filter(f => inScope.has(f.nip));
  }
  return { atts, feedbacks };
}

app.get('/api/events', async (req, res) => {
  try {
    const events = await storage.getEvents();
    const enriched = await Promise.all(events.map(async e => {
      const { atts, feedbacks } = await eventRowsForViewer(req, e.event_id);

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
    // The public check-in / feedback access codes are only for those who manage events.
    res.json((await auth.isEventManager(req.user)) ? enriched : enriched.map(hideEventCodes));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/events/:id', async (req, res) => {
  try {
    const event = await storage.getEventById(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const questions = await storage.getEventQuestions(event.event_id);
    const { atts: attendances, feedbacks } = await eventRowsForViewer(req, event.event_id);
    const media = await storage.getMediaByEvent(event.event_id);

    // Attendee / respondent identity (NIP, name, e-mail) is only for those who manage events.
    const manager = await auth.isEventManager(req.user);
    res.json({
      event: manager ? event : hideEventCodes(event),
      questions,
      attendances: manager ? attendances : attendances.map(auth.redactRespondent),
      feedbacks: manager ? feedbacks : feedbacks.map(auth.redactRespondent),
      media
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
app.get('/api/questions/master', async (req, res) => {
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

    const record = await storage.addAttendance({
      event_id: req.params.id,
      nip,
      employee_name,
      cimb_email,
      directorate,
      division
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
app.post('/api/events/:id/media', EVENT_MANAGER, (req, res, next) => {
  mediaUpload.single('mediaFile')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `The file exceeds the ${MEDIA_MAX_MB} MB limit.` });
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

// 8. QR Code Generator Endpoint
app.get('/api/qrcode', async (req, res) => {
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
