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
const { getPendingUploadReminders, sendPendingUploadReminders } = require('./services/reminderService');

// Default year for YTD/unparseable period query params, derived from the real server clock
// instead of a hardcoded literal (mirrors CURRENT_YEAR in calculationEngine.js).
const CURRENT_YEAR = String(new Date().getFullYear());

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Static file serving for uploads & exports
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const EXPORTS_DIR = path.join(__dirname, 'exports');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(EXPORTS_DIR)) fs.mkdirSync(EXPORTS_DIR, { recursive: true });

app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/exports', express.static(EXPORTS_DIR));

// Multer storage for media uploads
const multerStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `media-${Date.now()}-${Math.random().toString(36).substring(2, 8)}${ext}`);
  }
});
const upload = multer({ storage: multerStorage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB limit

// ==========================================
// API ROUTES
// ==========================================

// 1. Health & Status
app.get('/api/health', async (req, res) => {
  const ollama = await isOllamaAvailable();
  res.json({
    status: 'online',
    system: 'CIMB Niaga People Experience Integrated System',
    version: '2.18.0',
    local_ai: {
      ollama_status: ollama ? 'connected' : 'offline (using local heuristic engine)',
      host: process.env.OLLAMA_HOST || 'http://localhost:11434'
    },
    database: {
      mode: process.env.DB_SERVER ? 'MS SQL Server (Connected)' : 'Local File Store (Active)',
      store_file: 'server/data/store.json'
    }
  });
});

// 1b. Directorates & Divisions List
app.get('/api/directorates', (req, res) => {
  try {
    const directorates = storage.getDirectorates();
    res.json(directorates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Metrics & PE Index Calculation (Supports ?mode=YTD|MTD&year=2026&month=03&directorate=...&sub_directorate=...)
app.get('/api/metrics/calculate', (req, res) => {
  try {
    const { period, mode, year, month, endMonth, directorate, sub_directorate, subDirectorate } = req.query;
    const filterOptions = {
      period: period || (mode === 'MTD' ? `${year || CURRENT_YEAR}-${month || '01'}` : (mode === 'YTD' ? 'YTD' : (year || CURRENT_YEAR))),
      mode: mode || (period && /^\d{4}-\d{2}$/.test(period) ? 'MTD' : 'YTD'),
      year: year || (period && /^\d{4}/.test(period) ? period.slice(0, 4) : CURRENT_YEAR),
      month: month || (period && period.length >= 7 && /^\d{4}-\d{2}/.test(period) ? period.slice(5, 7) : '01'),
      // Optional: bound a YTD query to "Jan..end of this month" (e.g. ?mode=YTD&endMonth=08)
      // instead of the full year — mainly used to audit/verify the Performance Trend chart's
      // cumulative points against this same scorecard endpoint.
      endMonth: endMonth || null,
      directorate: directorate || 'ALL',
      sub_directorate: sub_directorate || subDirectorate || 'ALL'
    };
    const calculation = calculatePEIndex(filterOptions);
    res.json(calculation);
  } catch (err) {
    console.error('Error calculating PE Index:', err);
    res.status(500).json({ error: 'Failed to calculate People Experience Index' });
  }
});

// 2b. Metric Drilldown Detail with Questions Breakdown & Responses
app.get('/api/metrics/:id/detail', (req, res) => {
  try {
    const { period, mode, year, month, directorate, sub_directorate, subDirectorate } = req.query;
    const filterOptions = {
      period: period || (mode === 'MTD' ? `${year || CURRENT_YEAR}-${month || '01'}` : (mode === 'YTD' ? 'YTD' : (year || CURRENT_YEAR))),
      mode: mode || (period && /^\d{4}-\d{2}$/.test(period) ? 'MTD' : 'YTD'),
      year: year || (period && /^\d{4}/.test(period) ? period.slice(0, 4) : CURRENT_YEAR),
      month: month || (period && period.length >= 7 && /^\d{4}-\d{2}/.test(period) ? period.slice(5, 7) : '01'),
      directorate: directorate || 'ALL',
      sub_directorate: sub_directorate || subDirectorate || 'ALL'
    };
    const detail = getMetricDetail(req.params.id, filterOptions);
    if (!detail) {
      return res.status(404).json({ error: `Metric #${req.params.id} not found` });
    }
    res.json(detail);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2c. Monthly Trend Series
app.get('/api/metrics/trends', (req, res) => {
  try {
    const { mode, year, startYear, startMonth, endYear, endMonth, directorate, sub_directorate, subDirectorate } = req.query;
    const targetYear = year || CURRENT_YEAR;
    const filterOptions = {
      mode: (mode || 'YTD').toUpperCase() === 'MTD' ? 'MTD' : 'YTD',
      year: targetYear,
      startYear: startYear || null,
      startMonth: startMonth || null,
      endYear: endYear || null,
      endMonth: endMonth || null,
      directorate: directorate || 'ALL',
      sub_directorate: sub_directorate || subDirectorate || 'ALL'
    };
    const trends = computeMonthlyTrends(filterOptions);
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
      available_years: storage.getAvailableSurveyYears()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// ADMIN PARAMETERS: JOURNEYS & METRICS CRUD
// ==========================================
app.get('/api/admin/parameters', (req, res) => {
  try {
    const journeys = storage.getJourneys();
    const checkpoints = storage.getCheckpoints();
    const directorates = storage.getDirectorates();
    // target_value_normalized converts each metric's raw target (e.g. 4.00 on a 1-5
    // Likert scale) into the same 0-100 scale as min_threshold, so Admin Parameters can
    // display Target and Threshold using one consistent unit instead of mixing scales.
    const metrics = storage.getMetrics().map(m => ({
      ...m,
      target_value_normalized: parseFloat(normalizeTarget(m, m).toFixed(2))
    }));
    res.json({
      success: true,
      journeys,
      checkpoints,
      metrics,
      directorates
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add Journey
app.post('/api/admin/journeys', (req, res) => {
  try {
    const journey = storage.addJourney(req.body);
    const calculation = calculatePEIndex();
    res.status(201).json({ success: true, journey, calculation });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update Journey
app.put('/api/admin/journeys/:id', (req, res) => {
  try {
    const journey = storage.updateJourney(req.params.id, req.body);
    const calculation = calculatePEIndex();
    res.json({ success: true, journey, calculation });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete Journey
app.delete('/api/admin/journeys/:id', (req, res) => {
  try {
    const result = storage.deleteJourney(req.params.id);
    const calculation = calculatePEIndex();
    res.json({ success: true, ...result, calculation });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Add Metric
app.post('/api/admin/metrics', (req, res) => {
  try {
    const metric = storage.addMetric(req.body);
    const calculation = calculatePEIndex();
    res.status(201).json({ success: true, metric, calculation, ...metric });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update Metric (Parameters: Name, Journey, Checkpoint, Weight, Target, Threshold, Audience, etc.)
app.put('/api/admin/metrics/:id', (req, res) => {
  try {
    const metric = storage.updateMetric(req.params.id, req.body);
    const calculation = calculatePEIndex();
    res.json({ success: true, metric, calculation, ...metric });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete Metric
app.delete('/api/admin/metrics/:id', (req, res) => {
  try {
    const result = storage.deleteMetric(req.params.id);
    const calculation = calculatePEIndex();
    res.json({ success: true, ...result, calculation });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Reset All Parameters (Journeys, Checkpoints, Metrics, Targets) to Seed Defaults
app.post('/api/admin/parameters/reset', (req, res) => {
  try {
    const resetData = storage.resetParametersToDefault();
    const calculation = calculatePEIndex('YTD');
    res.json({
      success: true,
      message: 'Seluruh parameter Journey, Checkpoint, dan Metric berhasil direset ke konfigurasi default!',
      data: resetData,
      calculation
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Metric Target & Threshold Settings (Backward Compatible)
app.get('/api/admin/targets', (req, res) => {
  try {
    const targets = storage.getMetricTargets();
    res.json({ targets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/targets', (req, res) => {
  try {
    const { targets } = req.body;
    if (!targets) return res.status(400).json({ error: 'targets is required' });
    const saved = storage.saveMetricTargets(targets);
    const period = req.query.period || 'YTD';
    const newCalculation = calculatePEIndex(period);
    res.json({ success: true, targets: saved, calculation: newCalculation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/targets/reset', (req, res) => {
  try {
    const reset = storage.resetMetricTargets();
    const newCalculation = calculatePEIndex('YTD');
    res.json({ success: true, targets: reset, calculation: newCalculation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Survey Questions Admin Settings
app.get('/api/admin/survey-questions', (req, res) => {
  try {
    const allQuestions = storage.getAllSurveyQuestions();
    const metrics = storage.getMetrics().filter(m => m.metric_type === 'SURVEY');
    res.json({
      success: true,
      questions: allQuestions,
      metrics
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/survey-questions/:metric_id', (req, res) => {
  try {
    const metric_id = parseInt(req.params.metric_id);
    const questions = storage.getSurveyQuestions(metric_id);
    const metric = storage.getMetrics().find(m => m.metric_id === metric_id);
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

app.post('/api/admin/survey-questions/:metric_id', (req, res) => {
  try {
    const metric_id = parseInt(req.params.metric_id);
    const { questions } = req.body;
    if (!Array.isArray(questions)) {
      return res.status(400).json({ error: 'questions must be an array' });
    }
    const saved = storage.saveSurveyQuestions(metric_id, questions);
    res.json({
      success: true,
      message: `Pertanyaan survei untuk Metric ID ${metric_id} berhasil disimpan`,
      questions: saved
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/survey-questions/:metric_id/reset', (req, res) => {
  try {
    const metric_id = parseInt(req.params.metric_id);
    const reset = storage.resetSurveyQuestions(metric_id);
    res.json({
      success: true,
      message: `Pertanyaan survei untuk Metric ID ${metric_id} berhasil direset ke template default`,
      questions: reset
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Survey Upload Reminders — Periodic Data Update / Manual Survey Upload Deadline tracking
app.get('/api/admin/upload-reminders', (req, res) => {
  try {
    const reminders = getPendingUploadReminders();
    res.json({
      total_reminders: reminders.length,
      overdue_count: reminders.filter(r => r.status === 'OVERDUE').length,
      due_soon_count: reminders.filter(r => r.status === 'DUE_SOON').length,
      reminders
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/upload-reminders/send', async (req, res) => {
  try {
    const result = await sendPendingUploadReminders();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/metrics/score', (req, res) => {
  try {
    const { metric_id, raw_value, normalized_score, notes } = req.body;
    if (!metric_id) return res.status(400).json({ error: 'metric_id is required' });

    const updated = storage.updateMetricScore(metric_id, raw_value, normalized_score, notes);
    const newCalculation = calculatePEIndex();
    res.json({ success: true, updated_metric: updated, calculation: newCalculation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/metrics/weights', (req, res) => {
  try {
    const { weights } = req.body; // Array of { metric_id, weight }
    if (!Array.isArray(weights)) return res.status(400).json({ error: 'weights must be an array' });

    storage.updateMetricWeights(weights);
    const newCalculation = calculatePEIndex();
    res.json({ success: true, calculation: newCalculation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Alerts & Action Library Recommendations
app.get('/api/alerts', async (req, res) => {
  try {
    const alertsData = await getAlertsAndRecommendations();
    res.json(alertsData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/alerts/acknowledge', (req, res) => {
  try {
    const { metric_id } = req.body;
    storage.acknowledgeAlert(parseInt(metric_id));
    res.json({ success: true, message: `Alert for metric ${metric_id} acknowledged` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/action-library', (req, res) => {
  res.json(storage.getActionLibrary());
});

app.post('/api/action-library', (req, res) => {
  try {
    const { items } = req.body;
    const updated = storage.updateActionLibrary(items);
    res.json({ success: true, items: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Manual Survey Data Upload & Template Generation
app.get('/api/surveys/metrics', (req, res) => {
  try {
    const metrics = storage.getMetrics().filter(m => m.metric_type === 'SURVEY');
    res.json(metrics);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/surveys/template', (req, res) => {
  try {
    const metric_id = req.query.metric_id || 'ALL';
    const csvContent = generateSurveyCsvTemplate(metric_id);
    
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
app.get('/api/surveys/evidence', (req, res) => {
  try {
    const { metric_id = 'ALL', period = 'YTD' } = req.query;
    const csvContent = generateSurveyEvidenceCsv(metric_id, period);
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

app.post('/api/surveys/upload', upload.single('csvFile'), (req, res) => {
  try {
    let csvText = '';
    let fileName = 'manual_survey_data.csv';

    if (req.file) {
      csvText = fs.readFileSync(req.file.path, 'utf8');
      fileName = req.file.originalname;
    } else if (req.body && req.body.csvText) {
      csvText = req.body.csvText;
      fileName = req.body.fileName || 'manual_survey_input.csv';
    } else {
      return res.status(400).json({ error: 'File CSV atau data teks CSV wajib disertakan.' });
    }

    const targetMetricId = req.body.metric_id ? parseInt(req.body.metric_id) : null;
    const result = processSurveyCsv(csvText, fileName, targetMetricId);

    res.json(result);
  } catch (err) {
    console.error('Survey upload error:', err);
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/surveys/history', (req, res) => {
  try {
    res.json(storage.getSurveyUploads());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/surveys/responses/:metric_id', (req, res) => {
  try {
    const responses = storage.getUploadedResponsesByMetric(req.params.metric_id);
    res.json(responses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Events Management (Signature Programs)
app.get('/api/events', (req, res) => {
  try {
    const events = storage.getEvents();
    const enriched = events.map(e => {
      const atts = storage.getAttendancesByEvent(e.event_id);
      const feedbacks = storage.getFeedbackByEvent(e.event_id);

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
    });
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/events/:id', (req, res) => {
  try {
    const event = storage.getEventById(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const questions = storage.getEventQuestions(event.event_id);
    const attendances = storage.getAttendancesByEvent(event.event_id);
    const feedbacks = storage.getFeedbackByEvent(event.event_id);
    const media = storage.getMediaByEvent(event.event_id);

    res.json({
      event,
      questions,
      attendances,
      feedbacks,
      media
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/events', (req, res) => {
  try {
    const newEvent = storage.createEvent(req.body);
    // Recalculate metrics
    calculatePEIndex();
    res.status(201).json({ success: true, event: newEvent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/events/:id', (req, res) => {
  try {
    const removed = storage.deleteEvent(req.params.id);
    calculatePEIndex();
    res.json({ success: true, event: removed });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/events/by-code/:code', (req, res) => {
  const code = req.params.code.toUpperCase();
  const preEvent = storage.getEventByPreCode(code);
  if (preEvent) {
    return res.json({ type: 'PRE_EVENT', event: preEvent });
  }
  const postEvent = storage.getEventByPostCode(code);
  if (postEvent) {
    const questions = storage.getEventQuestions(postEvent.event_id);
    return res.json({ type: 'POST_EVENT', event: postEvent, questions });
  }
  res.status(404).json({ error: 'Invalid event access code' });
});

// Master & Event Questions
app.get('/api/questions/master', (req, res) => {
  res.json(storage.getMasterQuestions());
});

app.post('/api/questions/master', (req, res) => {
  try {
    const updated = storage.updateMasterQuestions(req.body.questions);
    res.json({ success: true, questions: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/events/:id/questions', (req, res) => {
  try {
    const updated = storage.saveEventQuestions(req.params.id, req.body.questions);
    res.json({ success: true, questions: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Public Form Submissions (Attendance & Post-Event Evaluation)
app.post('/api/events/:id/attendance', (req, res) => {
  try {
    const { nip, employee_name, cimb_email, directorate, division } = req.body;
    if (!nip || !employee_name || !cimb_email) {
      return res.status(400).json({ error: 'NIP, Nama Karyawan, dan Email CIMB wajib diisi.' });
    }

    // Format validation
    if (!/^[a-zA-Z0-9]{4,15}$/.test(nip.trim())) {
      return res.status(400).json({ error: 'Format NIP tidak valid. Masukkan 4-15 karakter alfanumerik.' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cimb_email.trim())) {
      return res.status(400).json({ error: 'Format email tidak valid.' });
    }

    const record = storage.addAttendance({
      event_id: req.params.id,
      nip,
      employee_name,
      cimb_email,
      directorate,
      division
    });

    // Auto-recalculate PE Index in real-time
    calculatePEIndex();

    res.status(201).json({ success: true, message: 'Absensi berhasil tercatat!', attendance: record });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/events/:id/feedback', (req, res) => {
  try {
    const { nip, ratings, verbatim } = req.body;
    if (!nip) {
      return res.status(400).json({ error: 'NIP wajib diisi untuk verifikasi partisipasi.' });
    }

    const record = storage.addFeedbackResponse({
      event_id: req.params.id,
      nip,
      ratings,
      verbatim
    });

    // Auto-recalculate PE Index in real-time
    calculatePEIndex();

    res.status(201).json({ success: true, message: 'Terima kasih, evaluasi kepuasan Anda telah berhasil dikirim!', response: record });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/events/:id/attendance/:nip', (req, res) => {
  try {
    const removed = storage.deleteAttendance(req.params.id, req.params.nip);
    calculatePEIndex();
    res.json({ success: true, attendance: removed });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/events/:id/feedback/:nip', (req, res) => {
  try {
    const removed = storage.deleteFeedbackResponse(req.params.id, req.params.nip);
    calculatePEIndex();
    res.json({ success: true, feedback: removed });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 6. Media Gallery Uploads
app.post('/api/events/:id/media', upload.single('mediaFile'), async (req, res) => {
  try {
    const { caption, file_type } = req.body;
    const file = req.file;

    const event = storage.getEventById(req.params.id);
    const mediaPath = file ? `/uploads/${file.filename}` : '/uploads/sample.jpg';
    const originalName = file ? file.originalname : 'media_upload.jpg';

    const newMedia = storage.addMedia({
      event_id: req.params.id,
      file_name: originalName,
      file_path: mediaPath,
      file_type: file_type || 'IMAGE',
      caption: caption || `Dokumentasi ${event ? event.event_name : 'Event'}`
    });

    res.status(201).json({ success: true, media: newMedia });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/media/:id', (req, res) => {
  try {
    storage.deleteMedia(req.params.id);
    res.json({ success: true, message: 'Media deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. PowerPoint (PPTX) Generation & Download
app.post('/api/events/:id/generate-ppt', async (req, res) => {
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

app.get('/api/reports/download/:fileName', (req, res) => {
  const filePath = path.join(EXPORTS_DIR, req.params.fileName);
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

// Start Server
app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 CIMB Niaga People Experience Backend is running`);
  console.log(`📡 URL: http://localhost:${PORT}`);
  console.log(`📊 Health: http://localhost:${PORT}/api/health`);
  console.log(`=======================================================`);

  // Daily automatic check for Survey Upload Reminders (Batas Waktu Upload Survei).
  // Runs once shortly after boot, then every 24h — emails PICs whose metrics are
  // DUE_SOON or OVERDUE. Safe to run repeatedly: metrics already uploaded this
  // cycle are automatically skipped, so PICs aren't spammed once they've uploaded.
  const DAILY_MS = 24 * 60 * 60 * 1000;
  setTimeout(() => {
    sendPendingUploadReminders().catch(err => console.error('[reminderService] daily check failed:', err.message));
    setInterval(() => {
      sendPendingUploadReminders().catch(err => console.error('[reminderService] daily check failed:', err.message));
    }, DAILY_MS);
  }, 15000);
});
