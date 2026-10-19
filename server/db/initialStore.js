// server/db/initialStore.js
// Builds a brand-new, store.json-shaped dataset from the seed/demo data in seedData.js.
// Used by jsonStorage.js (first boot / corrupt file) and by sqlStorage.js (empty database).
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
  initialEssResults,
  initialEssUploads,
  initialOperationalRecords,
  initialAppSettings
} = require('./seedData');

function buildInitialStore() {
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
      },
      // one record per seeded ESS summary (v2.32.0)
      ...JSON.parse(JSON.stringify(initialEssUploads))
    ],
    surveyUploadedResponses: initialSurveyUploadedResponses,
    // ESS result summaries (v2.32.0): one row per org unit (Bankwide + directorates) per metric and period
    essResults: initialEssResults.map((r, i) => ({ ess_result_id: i + 1, ...JSON.parse(JSON.stringify(r)),
      created_at: (initialEssUploads.find(u => u.upload_id === r.upload_id) || {}).uploaded_at || '2025-11-30T10:00:00.000Z' })),
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
    operationalRecords: JSON.parse(JSON.stringify(initialOperationalRecords)),
    appSettings: JSON.parse(JSON.stringify(initialAppSettings))
  };
}

module.exports = { buildInitialStore };
