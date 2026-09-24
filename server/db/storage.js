const fs = require('fs');
const path = require('path');
const {
  initialJourneys,
  initialCheckpoints,
  initialMetrics,
  initialDirectorates,
  initialActionLibrary,
  defaultSurveyQuestions,
  sampleEvents,
  sampleAttendances,
  sampleFeedbackResponses,
  initialSurveyUploadedResponses,
  initialOperationalRecords
} = require('./seedData');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function normalizeDateString(dateVal) {
  if (!dateVal) return null;
  const str = String(dateVal).trim();
  if (!str || str === '-' || str === 'null' || str === 'undefined') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    const p1 = parseInt(slashMatch[1], 10);
    const p2 = parseInt(slashMatch[2], 10);
    const year = slashMatch[3];
    let month, day;
    if (p1 > 12) {
      day = String(p1).padStart(2, '0');
      month = String(p2).padStart(2, '0');
    } else {
      month = String(p1).padStart(2, '0');
      day = String(p2).padStart(2, '0');
    }
    return `${year}-${month}-${day}`;
  }
  const dashMatch = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (dashMatch) {
    const p1 = parseInt(dashMatch[1], 10);
    const p2 = parseInt(dashMatch[2], 10);
    const year = dashMatch[3];
    let month, day;
    if (p1 > 12) {
      day = String(p1).padStart(2, '0');
      month = String(p2).padStart(2, '0');
    } else if (p2 > 12) {
      month = String(p1).padStart(2, '0');
      day = String(p2).padStart(2, '0');
    } else {
      day = String(p1).padStart(2, '0');
      month = String(p2).padStart(2, '0');
    }
    return `${year}-${month}-${day}`;
  }
  try {
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) {
      const y = parsed.getFullYear();
      const m = String(parsed.getMonth() + 1).padStart(2, '0');
      const d = String(parsed.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  } catch (e) {}
  return str;
}

function todayDateString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Default year for filter queries with no explicit year, derived from the real server clock
// instead of a frozen literal — mirrors CURRENT_YEAR in server/services/calculationEngine.js.
const CURRENT_YEAR = String(new Date().getFullYear());

let store = null;

function loadInitialStore() {
  const defaultTargets = {};
  initialMetrics.forEach(m => {
    defaultTargets[m.metric_id] = {
      target_value: m.target_value,
      target_display: m.target_display,
      min_threshold: m.min_threshold
    };
  });

  return {
    journeys: JSON.parse(JSON.stringify(initialJourneys)),
    checkpoints: JSON.parse(JSON.stringify(initialCheckpoints)),
    metrics: JSON.parse(JSON.stringify(initialMetrics)),
    directorates: JSON.parse(JSON.stringify(initialDirectorates)),
    metricTargets: defaultTargets,
    weights: initialMetrics.map(m => ({ metric_id: m.metric_id, weight: m.weight || 1.0 })),
    actionLibrary: initialActionLibrary,
    masterSurveyQuestions: defaultSurveyQuestions,
    events: sampleEvents,
    eventQuestions: {
      'ev-perspektif-2024-q1': [...defaultSurveyQuestions],
      'ev-di-inspire-2024': [...defaultSurveyQuestions]
    },
    attendances: sampleAttendances,
    feedbackResponses: sampleFeedbackResponses,
    surveyUploads: [
      {
        upload_id: 'seed-batch-2026',
        metric_id: null,
        file_name: 'Master_Survey_Baseline_Q1_2026.csv',
        total_rows: initialSurveyUploadedResponses.length,
        valid_rows: initialSurveyUploadedResponses.length,
        invalid_rows: 0,
        calculated_avg_score: 4.5,
        uploaded_by: 'System Scheduler (Air-Gapped)',
        uploaded_at: '2026-03-20T10:00:00.000Z'
      }
    ],
    surveyUploadedResponses: initialSurveyUploadedResponses,
    media: [
      {
        media_id: 'med-1',
        event_id: 'ev-perspektif-2024-q1',
        file_name: 'keynote_presentation.jpg',
        file_path: '/uploads/sample_keynote.jpg',
        file_type: 'IMAGE',
        caption: 'Sesi Keynote Speaker oleh Executive Leadership CIMB Niaga mengenai Strategi Future of Work & Agility.',
        ai_generated_description: 'Keynote session di Auditorium CIMB Niaga dengan antusiasme peserta tinggi mendengarkan pemaparan karir masa depan.',
        highlight_order: 1,
        created_at: new Date().toISOString()
      },
      {
        media_id: 'med-2',
        event_id: 'ev-perspektif-2024-q1',
        file_name: 'panel_discussion.jpg',
        file_path: '/uploads/sample_panel.jpg',
        file_type: 'IMAGE',
        caption: 'Panel Diskusi Interaktif bersama para Head of Division membahas Career Mobility dan Program Mentoring.',
        ai_generated_description: 'Diskusi panel interaktif 4 narasumber dari berbagai direktorat berdialog langsung dengan audiens hybrid.',
        highlight_order: 2,
        created_at: new Date().toISOString()
      },
      {
        media_id: 'med-3',
        event_id: 'ev-perspektif-2024-q1',
        file_name: 'audience_engagement.jpg',
        file_path: '/uploads/sample_audience.jpg',
        file_type: 'IMAGE',
        caption: 'Antusiasme peserta dalam sesi Q&A live polling dan sharing pengalaman kerja positif.',
        ai_generated_description: 'Sesi live polling & Q&A interaktif yang diikuti oleh ratusan karyawan online dan onsite.',
        highlight_order: 3,
        created_at: new Date().toISOString()
      }
    ],
    customSurveyQuestions: {},
    acknowledgedAlerts: [],
    operationalRecords: JSON.parse(JSON.stringify(initialOperationalRecords))
  };
}

function getStore() {
  if (!store) {
    if (fs.existsSync(DATA_FILE)) {
      try {
        const raw = fs.readFileSync(DATA_FILE, 'utf8');
        store = JSON.parse(raw);
        if (!store.journeys || store.journeys.length === 0) {
          store.journeys = JSON.parse(JSON.stringify(initialJourneys));
        }
        if (!store.checkpoints || store.checkpoints.length === 0) {
          store.checkpoints = JSON.parse(JSON.stringify(initialCheckpoints));
        }
        if (!store.metrics || store.metrics.length === 0) {
          store.metrics = JSON.parse(JSON.stringify(initialMetrics));
        } else {
          // Sync non-employee flags to existing metrics
          store.metrics.forEach(m => {
            const seed = initialMetrics.find(sm => sm.metric_id === m.metric_id);
            if (seed) {
              if (m.is_employee_metric === undefined) m.is_employee_metric = seed.is_employee_metric;
              if (m.target_audience === undefined) m.target_audience = seed.target_audience;
            } else if (m.is_employee_metric === undefined) {
              m.is_employee_metric = true;
            }
            // Backfill Data Update Cadence & Manual Survey Upload Reminder fields for
            // metrics saved before these parameters existed.
            if (m.update_frequency === undefined) m.update_frequency = (seed && seed.update_frequency) || 'MONTHLY';
            if (m.requires_manual_upload === undefined) m.requires_manual_upload = (seed && seed.requires_manual_upload !== undefined) ? seed.requires_manual_upload : (m.metric_type === 'SURVEY');
            if (m.upload_deadline_day === undefined) m.upload_deadline_day = (seed && seed.upload_deadline_day) || 25;
            if (m.upload_deadline_month === undefined) m.upload_deadline_month = (seed && seed.upload_deadline_month) || 11;
            if (m.pic_name === undefined) m.pic_name = (seed && seed.pic_name) || m.experience_owner || '';
            if (m.pic_email === undefined) m.pic_email = (seed && seed.pic_email) || '';
            if (m.metric_type === 'OUTCOME' && m.last_data_date === undefined) m.last_data_date = (seed && seed.last_data_date) || todayDateString();
          });
        }
        if (!store.directorates || store.directorates.length === 0) {
          store.directorates = JSON.parse(JSON.stringify(initialDirectorates));
        }
        if (!store.weights || store.weights.length === 0) {
          store.weights = store.metrics.map(m => ({ metric_id: m.metric_id, weight: m.weight || 1.0 }));
        }
        if (!store.operationalRecords) {
          store.operationalRecords = JSON.parse(JSON.stringify(initialOperationalRecords));
        }
        if (!store.surveyUploadedResponses || store.surveyUploadedResponses.length < 50) {
          store.surveyUploadedResponses = initialSurveyUploadedResponses;
        } else {
          // Incrementally merge in any newly-generated seed months (e.g. the demo dataset was
          // extended to cover more recent months for the Performance Trend chart) into an
          // existing store.json, without touching real/previously-uploaded response data.
          const existingSeedDates = new Set(
            store.surveyUploadedResponses
              .filter(r => r.upload_id === 'seed-batch-2026')
              .map(r => `${r.metric_id}|${r.survey_date}|${r.nip || r.participant_id || r.candidate_id}`)
          );
          const newSeedRecords = initialSurveyUploadedResponses.filter(
            r => !existingSeedDates.has(`${r.metric_id}|${r.survey_date}|${r.nip || r.participant_id || r.candidate_id}`)
          );
          if (newSeedRecords.length > 0) {
            const maxId = store.surveyUploadedResponses.reduce((mx, r) => Math.max(mx, r.response_id || 0), 0);
            newSeedRecords.forEach((r, i) => {
              store.surveyUploadedResponses.push({ ...r, response_id: maxId + i + 1 });
            });
          }
        }
        // Sanitize and normalize any existing dates to YYYY-MM-DD
        if (store.surveyUploadedResponses && Array.isArray(store.surveyUploadedResponses)) {
          store.surveyUploadedResponses.forEach(r => {
            if (r.survey_date) {
              r.survey_date = normalizeDateString(r.survey_date);
            }
          });
        }
        saveStore();
      } catch (err) {
        console.error('Error loading store.json, falling back to seed data:', err);
        store = loadInitialStore();
        saveStore();
      }
    } else {
      store = loadInitialStore();
      saveStore();
    }
  }
  return store;
}

function saveStore() {
  if (!store) return;
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save store.json:', err);
  }
}

// Database / Storage Adapter API
const storage = {
  // --- METRICS & JOURNEYS CRUD ---
  getJourneys() {
    return getStore().journeys;
  },
  getJourneyById(journey_id) {
    return getStore().journeys.find(j => j.journey_id === parseInt(journey_id));
  },
  addJourney(journeyData) {
    const s = getStore();
    const maxId = s.journeys.reduce((max, j) => Math.max(max, j.journey_id || 0), 0);
    const newJourney = {
      journey_id: maxId + 1,
      journey_code: (journeyData.journey_code || `JOURNEY_${maxId + 1}`).toUpperCase().trim(),
      journey_name: journeyData.journey_name ? journeyData.journey_name.trim() : `Journey ${maxId + 1}`,
      tagline: journeyData.tagline ? journeyData.tagline.trim() : '',
      color: journeyData.color || '#ED1C24',
      icon: journeyData.icon || 'Users',
      display_order: parseInt(journeyData.display_order || maxId + 1)
    };
    s.journeys.push(newJourney);
    saveStore();
    return newJourney;
  },
  updateJourney(journey_id, journeyData) {
    const s = getStore();
    const id = parseInt(journey_id);
    const idx = s.journeys.findIndex(j => j.journey_id === id);
    if (idx === -1) {
      throw new Error(`Journey #${id} tidak ditemukan.`);
    }
    const current = s.journeys[idx];
    s.journeys[idx] = {
      ...current,
      journey_code: journeyData.journey_code ? journeyData.journey_code.toUpperCase().trim() : current.journey_code,
      journey_name: journeyData.journey_name ? journeyData.journey_name.trim() : current.journey_name,
      tagline: journeyData.tagline !== undefined ? journeyData.tagline.trim() : current.tagline,
      color: journeyData.color || current.color,
      icon: journeyData.icon || current.icon,
      display_order: journeyData.display_order !== undefined ? parseInt(journeyData.display_order) : current.display_order
    };
    saveStore();
    return s.journeys[idx];
  },
  deleteJourney(journey_id) {
    const s = getStore();
    const id = parseInt(journey_id);
    const idx = s.journeys.findIndex(j => j.journey_id === id);
    if (idx === -1) {
      throw new Error(`Journey #${id} tidak ditemukan.`);
    }
    const deleted = s.journeys.splice(idx, 1)[0];
    saveStore();
    return deleted;
  },

  getCheckpoints() {
    return getStore().checkpoints;
  },
  getCheckpointById(checkpoint_id) {
    return getStore().checkpoints.find(c => c.checkpoint_id === parseInt(checkpoint_id));
  },
  addCheckpoint(cpData) {
    const s = getStore();
    const maxId = s.checkpoints.reduce((max, c) => Math.max(max, c.checkpoint_id || 0), 0);
    const newCp = {
      checkpoint_id: maxId + 1,
      journey_id: parseInt(cpData.journey_id || 1),
      checkpoint_name: cpData.checkpoint_name ? cpData.checkpoint_name.trim() : `Checkpoint ${maxId + 1}`,
      experience_owner: cpData.experience_owner ? cpData.experience_owner.trim() : 'People Experience Team'
    };
    s.checkpoints.push(newCp);
    saveStore();
    return newCp;
  },
  updateCheckpoint(checkpoint_id, cpData) {
    const s = getStore();
    const id = parseInt(checkpoint_id);
    const idx = s.checkpoints.findIndex(c => c.checkpoint_id === id);
    if (idx === -1) {
      throw new Error(`Checkpoint #${id} tidak ditemukan.`);
    }
    const current = s.checkpoints[idx];
    s.checkpoints[idx] = {
      ...current,
      journey_id: cpData.journey_id !== undefined ? parseInt(cpData.journey_id) : current.journey_id,
      checkpoint_name: cpData.checkpoint_name ? cpData.checkpoint_name.trim() : current.checkpoint_name,
      experience_owner: cpData.experience_owner ? cpData.experience_owner.trim() : current.experience_owner
    };
    saveStore();
    return s.checkpoints[idx];
  },
  deleteCheckpoint(checkpoint_id) {
    const s = getStore();
    const id = parseInt(checkpoint_id);
    const idx = s.checkpoints.findIndex(c => c.checkpoint_id === id);
    if (idx === -1) {
      throw new Error(`Checkpoint #${id} tidak ditemukan.`);
    }
    const deleted = s.checkpoints.splice(idx, 1)[0];
    saveStore();
    return deleted;
  },

  getMetrics() {
    return getStore().metrics;
  },
  getMetricById(metric_id) {
    return getStore().metrics.find(m => m.metric_id === parseInt(metric_id));
  },
  // Per-metric operational drilldown records for OUTCOME metrics backed by an internal HR
  // breakdown table rather than individual survey responses (recruitment SLA by unit, approval
  // stage compliance, hiring channel mix, recognition categories, attrition by tenure).
  getOperationalRecords(metric_id) {
    const s = getStore();
    return (s.operationalRecords && s.operationalRecords[parseInt(metric_id)]) || [];
  },
  addMetric(metricData) {
    const s = getStore();
    const maxId = s.metrics.reduce((max, m) => Math.max(max, m.metric_id || 0), 0);
    const newId = maxId + 1;
    const isEmployee = metricData.is_employee_metric !== undefined 
      ? Boolean(metricData.is_employee_metric) 
      : true;

    const newMetric = {
      metric_id: newId,
      journey_id: parseInt(metricData.journey_id || 1),
      checkpoint_id: parseInt(metricData.checkpoint_id || 1),
      metric_name: metricData.metric_name ? metricData.metric_name.trim() : `Metric #${newId}`,
      metric_type: (metricData.metric_type || 'SURVEY').toUpperCase(),
      scale_type: metricData.scale_type || (metricData.metric_type === 'SURVEY' ? 'RATING_5' : 'PERCENTAGE'),
      source_of_data: metricData.source_of_data ? metricData.source_of_data.trim() : 'Internal Survey',
      experience_owner: metricData.experience_owner ? metricData.experience_owner.trim() : 'PXCWB Team',
      target_value: parseFloat(metricData.target_value !== undefined ? metricData.target_value : (metricData.scale_type === 'RATING_5' ? 4.0 : 85)),
      target_display: metricData.target_display ? metricData.target_display.trim() : (metricData.scale_type === 'RATING_5' ? '> 4.00 / 5' : '> 85%'),
      min_threshold: parseFloat(metricData.min_threshold !== undefined ? metricData.min_threshold : 75),
      raw_value: parseFloat(metricData.raw_value !== undefined ? metricData.raw_value : (metricData.scale_type === 'RATING_5' ? 4.0 : 85)),
      normalized_score: parseFloat(metricData.normalized_score !== undefined ? metricData.normalized_score : 80),
      weight: parseFloat(metricData.weight !== undefined ? metricData.weight : 1.0),
      is_indicative: Boolean(metricData.is_indicative),
      is_employee_metric: isEmployee,
      target_audience: metricData.target_audience || (isEmployee ? 'EMPLOYEE' : 'EXTERNAL_MARKET'),
      underlying_questions: Array.isArray(metricData.underlying_questions) ? metricData.underlying_questions : [metricData.metric_name || 'Satisfaction Score'],
      // --- Data Update Cadence & Manual Survey Upload Reminder Settings (defaults) ---
      update_frequency: metricData.update_frequency ? String(metricData.update_frequency).toUpperCase() : 'MONTHLY',
      requires_manual_upload: metricData.requires_manual_upload !== undefined
        ? Boolean(metricData.requires_manual_upload)
        : ((metricData.metric_type || 'SURVEY').toUpperCase() === 'SURVEY'),
      upload_deadline_day: metricData.upload_deadline_day !== undefined && metricData.upload_deadline_day !== '' ? parseInt(metricData.upload_deadline_day) : 25,
      upload_deadline_month: metricData.upload_deadline_month !== undefined && metricData.upload_deadline_month !== '' ? parseInt(metricData.upload_deadline_month) : 11,
      pic_name: metricData.pic_name ? String(metricData.pic_name).trim() : (metricData.experience_owner || ''),
      pic_email: metricData.pic_email ? String(metricData.pic_email).trim() : ''
    };

    s.metrics.push(newMetric);

    // Sync weight & target stores
    s.weights.push({ metric_id: newId, weight: newMetric.weight });
    s.metricTargets[newId] = {
      target_value: newMetric.target_value,
      target_display: newMetric.target_display,
      min_threshold: newMetric.min_threshold
    };

    saveStore();
    return newMetric;
  },
  updateMetric(metric_id, metricData) {
    const s = getStore();
    const id = parseInt(metric_id);
    const idx = s.metrics.findIndex(m => m.metric_id === id);
    if (idx === -1) {
      throw new Error(`Metric #${id} tidak ditemukan.`);
    }

    const current = s.metrics[idx];
    const isEmployee = metricData.is_employee_metric !== undefined 
      ? Boolean(metricData.is_employee_metric) 
      : (current.is_employee_metric !== undefined ? current.is_employee_metric : true);

    const weightVal = metricData.metric_weight !== undefined
      ? parseFloat(metricData.metric_weight)
      : (metricData.weight !== undefined ? parseFloat(metricData.weight) : (current.weight !== undefined ? current.weight : 1.0));

    const resolvedMetricType = metricData.metric_type ? metricData.metric_type.toUpperCase().trim() : current.metric_type;
    const defaultRequiresManualUpload = resolvedMetricType === 'SURVEY';

    const updated = {
      ...current,
      journey_id: metricData.journey_id !== undefined ? parseInt(metricData.journey_id) : current.journey_id,
      checkpoint_id: metricData.checkpoint_id !== undefined ? parseInt(metricData.checkpoint_id) : current.checkpoint_id,
      metric_name: metricData.metric_name ? metricData.metric_name.trim() : current.metric_name,
      metric_type: metricData.metric_type ? metricData.metric_type.toUpperCase().trim() : current.metric_type,
      scale_type: metricData.scale_type || current.scale_type,
      source_of_data: metricData.source_of_data ? metricData.source_of_data.trim() : current.source_of_data,
      experience_owner: metricData.experience_owner ? metricData.experience_owner.trim() : current.experience_owner,
      target_value: metricData.target_value !== undefined ? parseFloat(metricData.target_value) : current.target_value,
      target_display: metricData.target_display !== undefined ? metricData.target_display.trim() : current.target_display,
      min_threshold: metricData.min_threshold !== undefined ? parseFloat(metricData.min_threshold) : current.min_threshold,
      weight: weightVal,
      metric_weight: weightVal,
      is_employee_metric: isEmployee,
      target_audience: metricData.target_audience || (isEmployee ? 'EMPLOYEE' : current.target_audience || 'EXTERNAL_MARKET'),
      // --- Data Update Cadence ("Frekuensi Update Data") ---
      update_frequency: metricData.update_frequency
        ? String(metricData.update_frequency).toUpperCase()
        : (current.update_frequency || 'MONTHLY'),
      // --- Manual Survey Upload Reminder Settings ---
      requires_manual_upload: metricData.requires_manual_upload !== undefined
        ? Boolean(metricData.requires_manual_upload)
        : (current.requires_manual_upload !== undefined ? current.requires_manual_upload : defaultRequiresManualUpload),
      upload_deadline_day: metricData.upload_deadline_day !== undefined && metricData.upload_deadline_day !== ''
        ? parseInt(metricData.upload_deadline_day)
        : (current.upload_deadline_day !== undefined ? current.upload_deadline_day : 25),
      upload_deadline_month: metricData.upload_deadline_month !== undefined && metricData.upload_deadline_month !== ''
        ? parseInt(metricData.upload_deadline_month)
        : (current.upload_deadline_month !== undefined ? current.upload_deadline_month : 11),
      pic_name: metricData.pic_name !== undefined ? String(metricData.pic_name).trim() : (current.pic_name || current.experience_owner || ''),
      pic_email: metricData.pic_email !== undefined ? String(metricData.pic_email).trim() : (current.pic_email || ''),
      // Last HR-system ingestion date (OUTCOME metrics) — must be explicitly whitelisted here
      // too, or admin edits via PUT /api/admin/metrics/:id would silently be dropped and the
      // metric would keep falling back to its seeded/previous value forever.
      last_data_date: metricData.last_data_date !== undefined ? String(metricData.last_data_date).trim() : current.last_data_date
    };

    s.metrics[idx] = updated;

    // Sync weight and targets
    const wIdx = s.weights.findIndex(w => w.metric_id === id);
    if (wIdx !== -1) {
      s.weights[wIdx].weight = updated.weight;
    } else {
      s.weights.push({ metric_id: id, weight: updated.weight });
    }

    s.metricTargets[id] = {
      target_value: updated.target_value,
      target_display: updated.target_display,
      min_threshold: updated.min_threshold
    };

    saveStore();
    return updated;
  },
  deleteMetric(metric_id) {
    const s = getStore();
    const id = parseInt(metric_id);
    const idx = s.metrics.findIndex(m => m.metric_id === id);
    if (idx === -1) {
      throw new Error(`Metric #${id} tidak ditemukan.`);
    }

    const deleted = s.metrics.splice(idx, 1)[0];
    
    // Remove from weights and targets
    s.weights = s.weights.filter(w => w.metric_id !== id);
    delete s.metricTargets[id];
    delete s.customSurveyQuestions[id];

    saveStore();
    return deleted;
  },
  resetParametersToDefault() {
    const s = getStore();
    s.journeys = JSON.parse(JSON.stringify(initialJourneys));
    s.checkpoints = JSON.parse(JSON.stringify(initialCheckpoints));
    s.metrics = JSON.parse(JSON.stringify(initialMetrics)).map(m => ({
      ...m,
      weight: m.weight !== undefined ? m.weight : 1.0,
      metric_weight: m.weight !== undefined ? m.weight : 1.0
    }));
    s.directorates = JSON.parse(JSON.stringify(initialDirectorates));
    s.weights = initialMetrics.map(m => ({ metric_id: m.metric_id, weight: m.weight || 1.0 }));
    
    const defaultTargets = {};
    initialMetrics.forEach(m => {
      defaultTargets[m.metric_id] = {
        target_value: m.target_value,
        target_display: m.target_display,
        min_threshold: m.min_threshold
      };
    });
    s.metricTargets = defaultTargets;
    s.customSurveyQuestions = {};

    saveStore();
    return {
      journeys: s.journeys,
      checkpoints: s.checkpoints,
      metrics: s.metrics
    };
  },

  getDirectorates() {
    const raw = getStore().directorates || initialDirectorates;
    return raw.map(d => ({
      ...d,
      name: d.directorate_name || d.name,
      directorate_name: d.directorate_name || d.name,
      sub_directorates: d.divisions || d.sub_directorates || [],
      divisions: d.divisions || d.sub_directorates || []
    }));
  },

  updateMetricScore(metric_id, raw_value, normalized_score, notes = '') {
    const s = getStore();
    const idx = s.metrics.findIndex(m => m.metric_id === parseInt(metric_id));
    if (idx !== -1) {
      s.metrics[idx].raw_value = parseFloat(raw_value);
      s.metrics[idx].normalized_score = parseFloat(normalized_score);
      if (notes) s.metrics[idx].notes = notes;
      saveStore();
      return s.metrics[idx];
    }
    return null;
  },
  updateMetricWeights(weightUpdates) {
    // weightUpdates: [{ metric_id, weight }]
    const s = getStore();
    weightUpdates.forEach(({ metric_id, weight }) => {
      const idx = s.metrics.findIndex(m => m.metric_id === parseInt(metric_id));
      if (idx !== -1) {
        s.metrics[idx].weight = parseFloat(weight);
      }
      const wIdx = s.weights.findIndex(w => w.metric_id === parseInt(metric_id));
      if (wIdx !== -1) {
        s.weights[wIdx].weight = parseFloat(weight);
      } else {
        s.weights.push({ metric_id: parseInt(metric_id), weight: parseFloat(weight) });
      }
    });
    saveStore();
    return s.metrics;
  },

  // --- EVENTS ---
  getEvents() {
    return getStore().events;
  },
  getEventById(event_id) {
    return getStore().events.find(e => e.event_id === event_id);
  },
  getEventByPreCode(pre_event_code) {
    return getStore().events.find(e => e.pre_event_code.toUpperCase() === pre_event_code.toUpperCase());
  },
  getEventByPostCode(post_event_code) {
    return getStore().events.find(e => e.post_event_code.toUpperCase() === post_event_code.toUpperCase());
  },
  createEvent(eventData) {
    const s = getStore();
    const newEvent = {
      event_id: eventData.event_id || `ev-${Date.now()}`,
      event_name: eventData.event_name,
      program_category: eventData.program_category || 'Perspektif',
      event_date: eventData.event_date || new Date().toISOString(),
      event_type: eventData.event_type || 'HYBRID',
      location: eventData.location || 'Menara CIMB Niaga',
      target_participants: parseInt(eventData.target_participants || 500),
      pre_event_code: (eventData.pre_event_code || `PRE-${Date.now()}`).toUpperCase(),
      post_event_code: (eventData.post_event_code || `POST-${Date.now()}`).toUpperCase(),
      is_attendance_open: eventData.is_attendance_open !== undefined ? eventData.is_attendance_open : true,
      is_feedback_open: eventData.is_feedback_open !== undefined ? eventData.is_feedback_open : true,
      created_by: eventData.created_by || 'HR PX Team'
    };
    s.events.push(newEvent);

    // Clone master questions for this event
    const questions = eventData.questions && eventData.questions.length > 0
      ? eventData.questions
      : [...s.masterSurveyQuestions];
    s.eventQuestions[newEvent.event_id] = questions;

    saveStore();
    return newEvent;
  },
  deleteEvent(event_id) {
    const s = getStore();
    const idx = s.events.findIndex(e => e.event_id === event_id);
    if (idx === -1) {
      throw new Error(`Event "${event_id}" tidak ditemukan.`);
    }
    const [removed] = s.events.splice(idx, 1);
    // Clean up everything tied to this event so no orphaned records remain.
    s.attendances = (s.attendances || []).filter(a => a.event_id !== event_id);
    if (s.feedbackResponses) s.feedbackResponses = s.feedbackResponses.filter(f => f.event_id !== event_id);
    if (s.eventQuestions) delete s.eventQuestions[event_id];
    saveStore();
    return removed;
  },

  // --- ATTENDANCE ---
  getAttendances() {
    return getStore().attendances || [];
  },
  getAllAttendances() {
    return getStore().attendances || [];
  },
  getAttendancesByEvent(event_id) {
    return getStore().attendances.filter(a => a.event_id === event_id);
  },
  addAttendance(attendanceData) {
    const s = getStore();
    const existing = s.attendances.find(
      a => a.event_id === attendanceData.event_id && a.nip === attendanceData.nip
    );
    if (existing) {
      throw new Error(`NIP ${attendanceData.nip} sudah tercatat absensi di event ini.`);
    }

    const record = {
      attendance_id: s.attendances.length + 1,
      event_id: attendanceData.event_id,
      nip: attendanceData.nip.trim(),
      employee_name: attendanceData.employee_name.trim(),
      cimb_email: attendanceData.cimb_email.trim().toLowerCase(),
      directorate: attendanceData.directorate || 'General',
      division: attendanceData.division || 'General',
      attendance_timestamp: new Date().toISOString()
    };
    s.attendances.push(record);
    saveStore();
    return record;
  },
  deleteAttendance(event_id, nip) {
    const s = getStore();
    const idx = s.attendances.findIndex(a => a.event_id === event_id && a.nip === nip);
    if (idx === -1) {
      throw new Error(`Data absensi NIP ${nip} pada event "${event_id}" tidak ditemukan.`);
    }
    const [removed] = s.attendances.splice(idx, 1);
    saveStore();
    return removed;
  },

  // --- SURVEY QUESTIONS & FEEDBACK ---
  getMasterQuestions() {
    return getStore().masterSurveyQuestions;
  },
  updateMasterQuestions(questions) {
    const s = getStore();
    s.masterSurveyQuestions = questions;
    saveStore();
    return s.masterSurveyQuestions;
  },
  getEventQuestions(event_id) {
    const s = getStore();
    return s.eventQuestions[event_id] || s.masterSurveyQuestions;
  },
  saveEventQuestions(event_id, questions) {
    const s = getStore();
    s.eventQuestions[event_id] = questions;
    saveStore();
    return s.eventQuestions[event_id];
  },
  getFeedbackByEvent(event_id) {
    return getStore().feedbackResponses.filter(f => f.event_id === event_id);
  },
  addFeedbackResponse(feedbackData) {
    const s = getStore();
    const existing = s.feedbackResponses.find(
      f => f.event_id === feedbackData.event_id && f.nip === feedbackData.nip
    );
    if (existing) {
      throw new Error(`NIP ${feedbackData.nip} sudah mengisi kuesioner evaluasi untuk event ini.`);
    }

    const responseRecord = {
      response_id: s.feedbackResponses.length + 1,
      event_id: feedbackData.event_id,
      nip: feedbackData.nip.trim(),
      ratings: feedbackData.ratings || {}, // { question_id: score }
      verbatim: feedbackData.verbatim || '',
      submitted_at: new Date().toISOString()
    };
    s.feedbackResponses.push(responseRecord);
    saveStore();
    return responseRecord;
  },
  deleteFeedbackResponse(event_id, nip) {
    const s = getStore();
    const idx = s.feedbackResponses.findIndex(f => f.event_id === event_id && f.nip === nip);
    if (idx === -1) {
      throw new Error(`Feedback NIP ${nip} pada event "${event_id}" tidak ditemukan.`);
    }
    const [removed] = s.feedbackResponses.splice(idx, 1);
    saveStore();
    return removed;
  },

  // --- MEDIA GALLERY ---
  getMediaByEvent(event_id) {
    return getStore().media.filter(m => m.event_id === event_id);
  },
  addMedia(mediaItem) {
    const s = getStore();
    const newMedia = {
      media_id: mediaItem.media_id || `med-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      event_id: mediaItem.event_id,
      file_name: mediaItem.file_name,
      file_path: mediaItem.file_path,
      file_type: mediaItem.file_type || 'IMAGE',
      caption: mediaItem.caption || '',
      ai_generated_description: mediaItem.ai_generated_description || '',
      highlight_order: mediaItem.highlight_order || s.media.length + 1,
      created_at: new Date().toISOString()
    };
    s.media.push(newMedia);
    saveStore();
    return newMedia;
  },
  deleteMedia(media_id) {
    const s = getStore();
    s.media = s.media.filter(m => m.media_id !== media_id);
    saveStore();
    return true;
  },

  // --- ACTION LIBRARY & ALERTS ---
  getActionLibrary() {
    return getStore().actionLibrary;
  },
  updateActionLibrary(items) {
    const s = getStore();
    s.actionLibrary = items;
    saveStore();
    return s.actionLibrary;
  },
  getAcknowledgedAlerts() {
    const s = getStore();
    return s.acknowledgedAlerts || [];
  },
  acknowledgeAlert(metric_id) {
    const s = getStore();
    s.acknowledgedAlerts = s.acknowledgedAlerts || [];
    if (!s.acknowledgedAlerts.includes(metric_id)) {
      s.acknowledgedAlerts.push(metric_id);
      saveStore();
    }
    return true;
  },
  resetAcknowledgedAlerts() {
    const s = getStore();
    s.acknowledgedAlerts = [];
    saveStore();
    return true;
  },

  // --- MANUAL SURVEY UPLOADS & RESPONSES ---
  getSurveyUploads() {
    const s = getStore();
    return s.surveyUploads || [];
  },
  getUploadedResponsesByMetric(metric_id) {
    const s = getStore();
    const responses = s.surveyUploadedResponses || [];
    return responses.filter(r => r.metric_id === parseInt(metric_id));
  },
  getAllUploadedVerbatims() {
    const s = getStore();
    const responses = s.surveyUploadedResponses || [];
    return responses
      .filter(r => r.verbatim_feedback && r.verbatim_feedback.trim().length > 3)
      .map(r => ({
        metric_id: r.metric_id,
        nip: r.nip,
        verbatim: r.verbatim_feedback,
        date: r.survey_date || r.created_at
      }));
  },
  saveSurveyUploadBatch(batchData, responses = []) {
    const s = getStore();
    s.surveyUploads = s.surveyUploads || [];
    s.surveyUploadedResponses = s.surveyUploadedResponses || [];

    const uploadRecord = {
      upload_id: batchData.upload_id || `upl-${Date.now()}`,
      metric_id: batchData.metric_id || null,
      file_name: batchData.file_name,
      total_rows: batchData.total_rows,
      valid_rows: batchData.valid_rows,
      invalid_rows: batchData.invalid_rows,
      calculated_avg_score: batchData.calculated_avg_score,
      uploaded_by: batchData.uploaded_by || 'HR Admin',
      uploaded_at: new Date().toISOString()
    };

    s.surveyUploads.unshift(uploadRecord);

    // Append individual responses
    responses.forEach(r => {
      const normalizedDate = normalizeDateString(r.survey_date) || new Date().toISOString().slice(0, 10);
      s.surveyUploadedResponses.push({
        response_id: s.surveyUploadedResponses.length + 1,
        upload_id: uploadRecord.upload_id,
        metric_id: parseInt(r.metric_id),
        nip: r.nip ? r.nip.toString().trim() : (r.participant_id || r.candidate_id || ''),
        participant_id: r.participant_id || (r.metric_id === 2 ? r.nip : undefined),
        candidate_id: r.candidate_id || (r.metric_id === 5 ? r.nip : undefined),
        employee_name: r.employee_name ? r.employee_name.trim() : (r.participant_name || r.candidate_name || 'Karyawan CIMB'),
        participant_name: r.participant_name || (r.metric_id === 2 ? r.employee_name : undefined),
        candidate_name: r.candidate_name || (r.metric_id === 5 ? r.employee_name : undefined),
        cimb_email: r.cimb_email ? r.cimb_email.trim().toLowerCase() : (r.email || ''),
        email: r.email || r.cimb_email || '',
        directorate: r.directorate ? r.directorate.trim() : (r.university || r.applied_position || 'General'),
        university: r.university || (r.metric_id === 2 ? r.directorate : undefined),
        applied_position: r.applied_position || (r.metric_id === 5 ? r.directorate : undefined),
        division: r.division ? r.division.trim() : (r.major || r.recruitment_channel || 'General'),
        major: r.major || (r.metric_id === 2 ? r.division : undefined),
        recruitment_channel: r.recruitment_channel || (r.metric_id === 5 ? r.division : undefined),
        ratings: r.ratings || {},
        rating_score: parseFloat(r.rating_score),
        verbatim_feedback: r.verbatim_feedback ? r.verbatim_feedback.trim() : '',
        survey_date: normalizedDate,
        source: r.source || 'MANUAL_UPLOAD',
        created_at: new Date().toISOString()
      });
    });

    saveStore();
    return uploadRecord;
  },

  // --- TARGET & THRESHOLD ADMIN SETTINGS ---
  getMetricTargets() {
    const s = getStore();
    if (!s.metricTargets) {
      s.metricTargets = {};
      s.metrics.forEach(m => {
        s.metricTargets[m.metric_id] = {
          target_value: m.target_value,
          target_display: m.target_display,
          min_threshold: m.min_threshold
        };
      });
      saveStore();
    }
    return s.metricTargets;
  },
  getMetricTargetById(metric_id) {
    const targets = this.getMetricTargets();
    return targets[parseInt(metric_id)] || null;
  },
  saveMetricTargets(newTargets) {
    const s = getStore();
    s.metricTargets = s.metricTargets || {};

    if (Array.isArray(newTargets)) {
      newTargets.forEach(t => {
        const id = parseInt(t.metric_id);
        s.metricTargets[id] = {
          target_value: parseFloat(t.target_value),
          target_display: t.target_display ? t.target_display.trim() : `Target: ${t.target_value}`,
          min_threshold: parseFloat(t.min_threshold)
        };
        // Also update metric object in memory
        const metric = s.metrics.find(m => m.metric_id === id);
        if (metric) {
          metric.target_value = parseFloat(t.target_value);
          metric.target_display = t.target_display ? t.target_display.trim() : metric.target_display;
          metric.min_threshold = parseFloat(t.min_threshold);
        }
      });
    } else if (typeof newTargets === 'object') {
      Object.keys(newTargets).forEach(key => {
        const id = parseInt(key);
        const t = newTargets[key];
        s.metricTargets[id] = {
          target_value: parseFloat(t.target_value),
          target_display: t.target_display || `Target: ${t.target_value}`,
          min_threshold: parseFloat(t.min_threshold)
        };
        const metric = s.metrics.find(m => m.metric_id === id);
        if (metric) {
          metric.target_value = parseFloat(t.target_value);
          metric.target_display = t.target_display || metric.target_display;
          metric.min_threshold = parseFloat(t.min_threshold);
        }
      });
    }

    saveStore();
    return s.metricTargets;
  },
  resetMetricTargets() {
    const s = getStore();
    s.metricTargets = {};
    initialMetrics.forEach(m => {
      s.metricTargets[m.metric_id] = {
        target_value: m.target_value,
        target_display: m.target_display,
        min_threshold: m.min_threshold
      };
      const metric = s.metrics.find(x => x.metric_id === m.metric_id);
      if (metric) {
        metric.target_value = m.target_value;
        metric.target_display = m.target_display;
        metric.min_threshold = m.min_threshold;
      }
    });
    saveStore();
    return s.metricTargets;
  },

  // --- SURVEY QUESTIONS ADMIN SETTINGS ---
  getSurveyQuestions(metric_id) {
    const s = getStore();
    const { getQuestionsForMetric } = require('../services/metricQuestionService');
    return getQuestionsForMetric(metric_id, s.customSurveyQuestions || {});
  },
  getAllSurveyQuestions() {
    const s = getStore();
    const { getAllDefaultSurveyQuestions } = require('../services/metricQuestionService');
    const defaults = getAllDefaultSurveyQuestions();
    const customs = s.customSurveyQuestions || {};
    const result = {};
    Object.keys(defaults).forEach(k => {
      result[k] = defaults[k];
    });
    Object.keys(customs).forEach(k => {
      result[k] = customs[k];
    });
    return result;
  },
  saveSurveyQuestions(metric_id, questions) {
    const s = getStore();
    s.customSurveyQuestions = s.customSurveyQuestions || {};
    const id = parseInt(metric_id);
    if (!Array.isArray(questions)) {
      throw new Error('Format pertanyaan harus berupa array.');
    }
    s.customSurveyQuestions[id] = questions;
    saveStore();
    return s.customSurveyQuestions[id];
  },
  resetSurveyQuestions(metric_id) {
    const s = getStore();
    s.customSurveyQuestions = s.customSurveyQuestions || {};
    const id = parseInt(metric_id);
    if (s.customSurveyQuestions[id]) {
      delete s.customSurveyQuestions[id];
      saveStore();
    }
    const { getQuestionsForMetric } = require('../services/metricQuestionService');
    return getQuestionsForMetric(id);
  },

  // Distinct years that actually have survey response data in the database, ascending —
  // used to populate year dropdowns (e.g. the Performance Trend period-range filter) instead
  // of hardcoding a fixed list of years in the frontend.
  getAvailableSurveyYears() {
    const s = getStore();
    const responses = s.surveyUploadedResponses || [];
    const years = new Set();
    responses.forEach(r => {
      const d = normalizeDateString(r.survey_date || r.created_at);
      if (d && /^\d{4}/.test(d)) years.add(d.slice(0, 4));
    });
    years.add(String(new Date().getFullYear())); // always include the real current year
    return Array.from(years).sort();
  },

  // --- PERIOD & DIRECTORATE FILTERED RESPONSES ---
  getResponsesByMetricAndPeriod(metric_id, filterOptions = 'YTD') {
    let responses = this.getUploadedResponsesByMetric(metric_id);
    return this.applyResponseFilters(responses, filterOptions);
  },
  getAllResponsesByPeriod(filterOptions = 'YTD') {
    const s = getStore();
    let responses = s.surveyUploadedResponses || [];
    return this.applyResponseFilters(responses, filterOptions);
  },
  applyResponseFilters(responses, filterOptions) {
    if (!filterOptions) return responses;

    let mode = 'YTD';
    let year = CURRENT_YEAR;
    let month = '01';
    let directorate = 'ALL';
    let subDirectorate = 'ALL';
    let rawPeriod = '';
    let endMonth = null;

    if (typeof filterOptions === 'string') {
      rawPeriod = filterOptions.trim();
      if (rawPeriod === 'YTD' || rawPeriod === 'ALL') {
        mode = 'YTD';
        year = CURRENT_YEAR;
      } else if (/^\d{4}-\d{2}$/.test(rawPeriod)) {
        mode = 'MTD';
        const parts = rawPeriod.split('-');
        year = parts[0];
        month = parts[1];
      } else if (/^\d{4}$/.test(rawPeriod)) {
        mode = 'YTD';
        year = rawPeriod;
      } else {
        mode = 'YTD';
        year = CURRENT_YEAR;
      }
    } else if (typeof filterOptions === 'object') {
      mode = filterOptions.mode || (filterOptions.period && /^\d{4}-\d{2}$/.test(filterOptions.period) ? 'MTD' : 'YTD');
      year = filterOptions.year ? String(filterOptions.year) : (filterOptions.period && /^\d{4}/.test(filterOptions.period) ? filterOptions.period.slice(0, 4) : CURRENT_YEAR);
      month = filterOptions.month ? String(filterOptions.month).padStart(2, '0') : (filterOptions.period && filterOptions.period.length >= 7 && /^\d{4}-\d{2}/.test(filterOptions.period) ? filterOptions.period.slice(5, 7) : '01');
      directorate = filterOptions.directorate || 'ALL';
      subDirectorate = filterOptions.sub_directorate || filterOptions.subDirectorate || 'ALL';
      // Optional upper bound month for YTD mode — used to compute a "cumulative Year-to-Date
      // as of the end of this month" snapshot (e.g. for the Performance Trend chart), instead
      // of the whole year. Ignored when mode is MTD or when not provided (full-year YTD).
      endMonth = filterOptions.endMonth ? String(filterOptions.endMonth).padStart(2, '0') : null;
    }

    return responses.filter(r => {
      const d = normalizeDateString(r.survey_date || r.created_at) || '';

      // 1. Period / Date Filtering
      if (mode === 'MTD') {
        const targetPrefix = `${year}-${month}`;
        if (!d.startsWith(targetPrefix)) return false;
      } else if (mode === 'YTD') {
        if (year && !d.startsWith(year)) return false;
        if (endMonth && d > `${year}-${endMonth}-31`) return false;
      }

      // 2. Directorate Filtering
      if (directorate && directorate !== 'ALL') {
        const itemDir = r.directorate || r.university || r.applied_position || '';
        if (itemDir !== directorate) return false;
      }

      // 3. Sub-Directorate Filtering
      if (subDirectorate && subDirectorate !== 'ALL') {
        const itemSubDir = r.division || r.major || r.recruitment_channel || '';
        if (itemSubDir !== subDirectorate) return false;
      }

      return true;
    });
  }
};

module.exports = storage;

