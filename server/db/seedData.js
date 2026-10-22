// server/db/seedData.js
// Master Data for CIMB Niaga People Experience Framework

const { defaultUnitForScale } = require('./metricUnit');
const { seedNamesMatch } = require('./directoryNames');

const initialJourneys = [
  {
    journey_id: 1,
    journey_code: 'ARRIVAL',
    journey_name: 'Arrival',
    tagline: 'Attract and onboard the right talent seamlessly, creating a strong and positive first impression.',
    color: '#2A5BBA', // Arrival blue (People Experience Measurement slide, v2.45.0)
    icon: 'UserPlus',
    display_order: 1
  },
  {
    journey_id: 2,
    journey_code: 'CONNECT',
    journey_name: 'Connect',
    tagline: 'Build early trust and alignment through clear role, expectations, and team connection.',
    color: '#D9534F', // Connect coral red (v2.45.0)
    icon: 'Users',
    display_order: 2
  },
  {
    journey_id: 3,
    journey_code: 'BELONG',
    journey_name: 'Belong',
    tagline: 'Foster emotional connection, inclusion, psychological safety, and a strong sense of belonging.',
    color: '#0F9CA3', // Belong teal (v2.45.0)
    icon: 'HeartHandshake',
    display_order: 3
  },
  {
    journey_id: 4,
    journey_code: 'CONTRIBUTE',
    journey_name: 'Contribute',
    tagline: 'Enable employees to perform, grow and create meaningful impact.',
    color: '#E08424', // Contribute orange (v2.45.0)
    icon: 'TrendingUp',
    display_order: 4
  },
  {
    journey_id: 5,
    journey_code: 'DEPART',
    journey_name: 'Depart',
    tagline: 'Ensure a smooth, respectful, and positive exit experience.',
    color: '#8731C8', // Depart purple (v2.45.0)
    icon: 'LogOut',
    display_order: 5
  }
];

const initialCheckpoints = [
  // Arrival (4 checkpoints)
  { checkpoint_id: 1, journey_id: 1, checkpoint_name: 'Employer Branding & Attraction', experience_owner: 'Talent Partnership' },
  { checkpoint_id: 2, journey_id: 1, checkpoint_name: 'Apply & Selection', experience_owner: 'Talent Partnership & Acquisition' },
  { checkpoint_id: 3, journey_id: 1, checkpoint_name: 'Pre-boarding', experience_owner: 'HR Onboarding' },
  { checkpoint_id: 4, journey_id: 1, checkpoint_name: 'Day 1 Onboarding', experience_owner: 'HR Onboarding & HRBP' },

  // Connect (2 checkpoints)
  { checkpoint_id: 5, journey_id: 2, checkpoint_name: 'Onboarding Experience', experience_owner: 'HR Onboarding & HRBP' },
  { checkpoint_id: 6, journey_id: 2, checkpoint_name: 'Internal Transition Experience', experience_owner: 'HRBP & PXCWB' },

  // Belong (5 checkpoints)
  { checkpoint_id: 7, journey_id: 3, checkpoint_name: 'Culture & Engagement', experience_owner: 'PXCWB' },
  { checkpoint_id: 8, journey_id: 3, checkpoint_name: 'Recognition & Appreciation', experience_owner: 'PXCWB' },
  { checkpoint_id: 9, journey_id: 3, checkpoint_name: 'Wellbeing', experience_owner: 'PXCWB' },
  { checkpoint_id: 10, journey_id: 3, checkpoint_name: 'Psychological Safety', experience_owner: 'HRBP & PXCWB' },
  { checkpoint_id: 11, journey_id: 3, checkpoint_name: 'Leadership Connection', experience_owner: 'Talent & Leadership Development' },

  // Contribute (4 checkpoints)
  { checkpoint_id: 12, journey_id: 4, checkpoint_name: 'Learning & Growth Experience', experience_owner: 'Learning & Development' },
  { checkpoint_id: 13, journey_id: 4, checkpoint_name: 'Mentoring & Coaching', experience_owner: 'Leadership & Talent Development' },
  { checkpoint_id: 14, journey_id: 4, checkpoint_name: 'Performance & Career Development', experience_owner: 'HRBP' },
  { checkpoint_id: 15, journey_id: 4, checkpoint_name: 'Purpose & Meaningful Contribution', experience_owner: 'PXCWB' },

  // Depart (2 checkpoints)
  { checkpoint_id: 16, journey_id: 5, checkpoint_name: 'Resignation Experience', experience_owner: 'HR Exit Management' },
  { checkpoint_id: 17, journey_id: 5, checkpoint_name: 'Intent to Stay', experience_owner: 'Performance, Reward & Budgeting' }
];

// Last HR-system ingestion date per OUTCOME metric — seed default for the `last_data_date`
// field (admin-editable via PUT /api/admin/metrics/:id), not business logic.
const OUTCOME_INGESTION_DATES = {
  1: '2026-03-24', // Career website & social media
  3: '2026-03-22', // Success ratio targeted university
  4: '2026-03-23', // Success ratio candidate by channel
  10: '2026-03-21', // Internal mobility fulfillment
  11: '2026-03-15', // Signature program attendance
  16: '2026-03-24', // Medical check-up & wellness
  27: '2026-03-25'  // Exit interview completion & turnover
};

// Satuan tampilan nilai aktual per metrik (px_metrics.unit) — default awal, bisa diubah admin di
// Parameter Admin. Hanya memengaruhi tampilan, bukan perhitungan skor. Ditentukan dari nama metrik,
// target_display dan data operasionalnya (skala RATING_5 -> "/ 5", PERCENTAGE -> "%", hitungan -> satuan hitungnya).
const METRIC_UNITS = {
  1: '%',            // NUMERIC indeks 0-100 (follower/reach/engagement growth); target "> 85" tanpa satuan eksplisit
  11: 'pax',         // rata-rata peserta per event, target "min 500 pax"
  14: 'orang/tahun'  // jumlah karyawan penerima recognition per tahun (2.840 + 980 + 510 = 4.330), target "min 5,000 / yr"
};

const initialMetrics = [
  // --- ARRIVAL (7 metrics) ---
  {
    metric_id: 1,
    journey_id: 1,
    checkpoint_id: 1,
    metric_name: 'Career website & social media follower, reach & engagement growth',
    metric_type: 'OUTCOME',
    scale_type: 'NUMERIC',
    // v2.54.0: social media engagement rate (%) scored by tiers: <= 1% / > 1% / > 2% / > 2.5% / > 3.5%
    score_tiers: { unit: 'percent', bounds: [{ min: 1, op: '>' }, { min: 2, op: '>' }, { min: 2.5, op: '>' }, { min: 3.5, op: '>' }] },
    // v2.55.0: scored with the AVERAGE of the uploaded months of the year (one row of months per year, see outcomeAggregation.js)
    outcome_aggregation: 'AVERAGE',
    source_of_data: 'Website & Social Media Analytics',
    experience_owner: 'Talent Partnership',
    target_value: 2.00,
    target_display: '2%',
    min_threshold: 80.00,
    raw_value: 0.66,
    normalized_score: 13.20,
    weight: 1.0,
    is_indicative: true,
    is_employee_metric: false,
    target_audience: 'EXTERNAL_MARKET',
    underlying_questions: ['Social Media Follower growth (IG, LinkedIn, TikTok)', 'Reach & Engagement index']
  },
  {
    metric_id: 2,
    journey_id: 1,
    checkpoint_id: 1,
    metric_name: 'CIMB Niaga Goes to Campus — event evaluation / rating',
    metric_type: 'SURVEY',
    scale_type: 'RATING_5',
    // v2.54.0: scored by tiers once the Admin sets them; until then (bounds null) the value is N/A and out of the index
    score_tiers: { unit: 'number', bounds: null },
    source_of_data: 'Event Evaluation Form (Talent Partnership)',
    experience_owner: 'Talent Partnership',
    target_value: 4.00,
    target_display: '> 4.00 / 5',
    min_threshold: 75.00,
    raw_value: 4.00,
    normalized_score: 80.00,
    weight: 1.0,
    is_indicative: true,
    is_employee_metric: false,
    target_audience: 'CAMPUS_STUDENTS',
    underlying_questions: ['Overall event satisfaction', 'Topic relevance & speaker rating']
  },
  {
    metric_id: 3,
    journey_id: 1,
    checkpoint_id: 2,
    metric_name: 'Success ratio candidate from targeted university',
    metric_type: 'OUTCOME',
    scale_type: 'PERCENTAGE',
    // v2.54.0: scored by tiers: < 30% / >= 30% / >= 45% / >= 60% / > 75%
    score_tiers: { unit: 'percent', bounds: [{ min: 30, op: '>=' }, { min: 45, op: '>=' }, { min: 60, op: '>=' }, { min: 75, op: '>' }] },
    // v2.55.0: scored with the AVERAGE of the uploaded months of the year (one row of months per year, see outcomeAggregation.js)
    outcome_aggregation: 'AVERAGE',
    source_of_data: 'Internal Report (Talent Partnership)',
    experience_owner: 'Talent Partnership',
    target_value: 70.00,
    target_display: '> 70%',
    min_threshold: 70.00,
    raw_value: 75.04,
    normalized_score: 100.00,
    weight: 1.0,
    is_indicative: true,
    is_employee_metric: false,
    target_audience: 'UNIVERSITY_APPLICANTS',
    underlying_questions: ['Hiring conversion from top tier targeted universities']
  },
  {
    metric_id: 4,
    journey_id: 1,
    checkpoint_id: 2,
    metric_name: 'Success ratio candidate by channel (Career Website, Jobstreet, LinkedIn)',
    metric_type: 'OUTCOME',
    data_status: 'NOT_AVAILABLE', // v2.55.0: real data not available yet -> N/A, not in the PX Index (Admin switch)
    scale_type: 'PERCENTAGE',
    source_of_data: 'Arjuna',
    experience_owner: 'Talent Partnership',
    target_value: 80.00,
    target_display: 'Target TBC (80%)',
    min_threshold: 70.00,
    raw_value: 80.00,
    normalized_score: 80.00,
    weight: 1.0,
    is_indicative: true,
    is_employee_metric: false,
    target_audience: 'SOURCING_CHANNELS',
    underlying_questions: ['Channel conversion efficiency']
  },
  {
    metric_id: 5,
    journey_id: 1,
    checkpoint_id: 2,
    metric_name: 'Candidate Experience Survey Score',
    metric_type: 'SURVEY',
    scale_type: 'RATING_5',
    source_of_data: 'Arjuna (will be developed)',
    experience_owner: 'Talent Acquisition',
    target_value: 4.00,
    target_display: '> 4.00 / 5',
    min_threshold: 75.00,
    raw_value: 4.00,
    normalized_score: 80.00,
    weight: 1.0,
    is_indicative: true,
    is_employee_metric: false,
    target_audience: 'JOB_APPLICANTS',
    underlying_questions: [
      'Interview invitation — clarity & timeliness (H-2)',
      'Interview process — preparedness & professionalism'
    ]
  },
  {
    metric_id: 6,
    journey_id: 1,
    checkpoint_id: 3,
    metric_name: 'Pre-boarding Engagement Index',
    metric_type: 'SURVEY',
    data_status: 'NOT_AVAILABLE', // v2.55.0: real data not available yet -> N/A, not in the PX Index (Admin switch)
    scale_type: 'PERCENTAGE',
    source_of_data: 'Onboarding Survey (from Arjuna)',
    experience_owner: 'HR Onboarding',
    target_value: 80.00,
    target_display: '> 80%',
    min_threshold: 75.00,
    raw_value: 80.00,
    normalized_score: 80.00,
    weight: 1.0,
    is_indicative: true,
    is_employee_metric: true,
    target_audience: 'EMPLOYEE',
    underlying_questions: [
      'Welcome communication & joining information received before Day 1',
      'New joiner contacted by DS / Teman Baru before Day 1',
      'Meet & Greet scheduled & communicated before Day 1'
    ]
  },
  {
    metric_id: 7,
    journey_id: 1,
    checkpoint_id: 4,
    metric_name: 'Day 1 Onboarding Satisfaction Index',
    metric_type: 'SURVEY',
    scale_type: 'RATING_5',
    source_of_data: 'Onboarding Survey (from Arjuna)',
    experience_owner: 'HR Onboarding, HRBP',
    target_value: 4.00,
    target_display: '> 4.00 / 5',
    min_threshold: 80.00,
    raw_value: 4.85,
    normalized_score: 97.00,
    weight: 1.0,
    is_indicative: false,
    is_employee_metric: true,
    target_audience: 'EMPLOYEE',
    underlying_questions: [
      'Meet & Greet satisfaction',
      'Workplace readiness (laptop, user ID, email, LAN / VPN, ID card, welcome kit)',
      'Welcome by Direct Supervisor',
      'LoG+ access',
      'Offer clarity'
    ]
  },

  // --- CONNECT (3 metrics) ---
  {
    metric_id: 8,
    journey_id: 2,
    checkpoint_id: 5,
    metric_name: 'Onboarding 30/60/90 Satisfaction Index',
    metric_type: 'SURVEY',
    data_status: 'NOT_AVAILABLE', // v2.55.0: real data not available yet -> N/A, not in the PX Index (Admin switch)
    scale_type: 'RATING_5',
    source_of_data: 'Onboarding Survey (from Arjuna)',
    experience_owner: 'HR Onboarding',
    target_value: 4.00,
    target_display: '> 4.00 / 5',
    min_threshold: 75.00,
    raw_value: 4.00,
    normalized_score: 80.00,
    weight: 1.0,
    is_indicative: true,
    is_employee_metric: true,
    target_audience: 'EMPLOYEE',
    underlying_questions: ['Role clarity & expectation', 'Direct Supervisor support', 'Teman Baru support score']
  },
  {
    metric_id: 9,
    journey_id: 2,
    checkpoint_id: 5,
    metric_name: 'Role Clarity & DS Support Score Index (ESS)',
    metric_type: 'SURVEY',
    scale_type: 'PERCENTAGE',
    source_of_data: 'ESS (Employee Sentiment Survey)',
    experience_owner: 'HRBP, PXCWB',
    target_value: 85.00,
    target_display: '> 85%',
    min_threshold: 80.00,
    raw_value: 93.00,
    normalized_score: 93.00,
    weight: 1.0,
    is_indicative: false,
    is_employee_metric: true,
    target_audience: 'EMPLOYEE',
    underlying_questions: [
      'I understand how my current job role contributes to a positive impact on customers and society (96%)',
      'Employees clearly understand what is expected of them (90%)',
      'My immediate manager provides me with the support I need to complete my work (91%)'
    ]
  },
  {
    metric_id: 10,
    journey_id: 2,
    checkpoint_id: 6,
    metric_name: 'Internal Transition Satisfaction Index',
    metric_type: 'SURVEY',
    data_status: 'NOT_AVAILABLE', // v2.55.0: real data not available yet -> N/A, not in the PX Index (Admin switch)
    scale_type: 'RATING_5',
    source_of_data: 'Internal Transition Survey',
    experience_owner: 'HRBP, PXCWB',
    target_value: 4.00,
    target_display: '> 80% (> 4.00/5)',
    min_threshold: 75.00,
    raw_value: 4.00,
    normalized_score: 80.00,
    weight: 1.0,
    is_indicative: true,
    is_employee_metric: true,
    target_audience: 'EMPLOYEE',
    underlying_questions: ['Role clarity & expectation', 'Direct Supervisor support', 'Buddy support score']
  },

  // --- BELONG (8 metrics) ---
  {
    metric_id: 11,
    journey_id: 3,
    checkpoint_id: 7,
    metric_name: 'Signature Program participation rate',
    metric_type: 'OUTCOME',
    scale_type: 'QUOTA_COUNT',
    source_of_data: 'Event Registration Data (PXCWB)',
    experience_owner: 'PXCWB',
    target_value: 500.00,
    target_display: 'min 500 pax (hybrid)',
    min_threshold: 80.00,
    raw_value: 450.00,
    normalized_score: 90.00,
    weight: 1.0,
    is_indicative: false,
    is_employee_metric: true,
    target_audience: 'EMPLOYEE',
    underlying_questions: ['Attendance in Perspektif, D&I, Young, EVD programs']
  },
  {
    metric_id: 12,
    journey_id: 3,
    checkpoint_id: 7,
    metric_name: 'Signature Program event satisfaction',
    metric_type: 'SURVEY',
    scale_type: 'RATING_5',
    source_of_data: 'Event Evaluation Form (PXCWB)',
    experience_owner: 'PXCWB',
    target_value: 4.00,
    target_display: '> 4.00 / 5',
    min_threshold: 75.00,
    raw_value: 4.00,
    normalized_score: 80.00,
    weight: 1.0,
    is_indicative: false,
    is_employee_metric: true,
    target_audience: 'EMPLOYEE',
    underlying_questions: ['Event content relevance', 'Speaker engagement', 'Execution & logistics']
  },
  {
    metric_id: 13,
    journey_id: 3,
    checkpoint_id: 7,
    metric_name: 'Pride & Work Environment Index (ESS)',
    metric_type: 'SURVEY',
    scale_type: 'PERCENTAGE',
    source_of_data: 'ESS (Employee Sentiment Survey)',
    experience_owner: 'PXCWB',
    target_value: 85.00,
    target_display: '> 85%',
    min_threshold: 80.00,
    raw_value: 91.25,
    normalized_score: 91.25,
    weight: 1.0,
    is_indicative: false,
    is_employee_metric: true,
    target_audience: 'EMPLOYEE',
    underlying_questions: [
      'I am proud to work at CIMB (96%)',
      'People want to work here because of the culture and work environment (86%)',
      'CIMB consistently implements new and better ways of doing things (91%)',
      'CIMB changes and adapts to stay competitive (92%)'
    ]
  },
  {
    metric_id: 14,
    journey_id: 3,
    checkpoint_id: 8,
    metric_name: '% employees receiving recognition / year',
    metric_type: 'OUTCOME',
    scale_type: 'QUOTA_COUNT',
    // v2.54.0: scored by count tiers (tier 1 < 4,000; 2 from 4,000; 3 from 5,000; 4 from 6,000; 5 from 7,500)
    score_tiers: { unit: 'number', bounds: [{ min: 4000, op: '>=' }, { min: 5000, op: '>=' }, { min: 6000, op: '>=' }, { min: 7500, op: '>=' }] },
    source_of_data: 'Arjuna (Recognition Module)',
    experience_owner: 'PXCWB',
    target_value: 5000.00,
    target_display: 'min 5,000 / yr',
    min_threshold: 75.00,
    raw_value: 6400.00,
    normalized_score: 85.33,
    weight: 1.0,
    is_indicative: false,
    is_employee_metric: true,
    target_audience: 'EMPLOYEE',
    underlying_questions: ['Total unique employees recognized via Arjuna']
  },
  {
    metric_id: 15,
    journey_id: 3,
    checkpoint_id: 8,
    metric_name: 'Manager Recognition Index (ESS)',
    metric_type: 'SURVEY',
    scale_type: 'PERCENTAGE',
    source_of_data: 'ESS (Employee Sentiment Survey)',
    experience_owner: 'PXCWB',
    target_value: 85.00,
    target_display: '> 85%',
    min_threshold: 80.00,
    raw_value: 89.33,
    normalized_score: 89.33,
    weight: 1.0,
    is_indicative: false,
    is_employee_metric: true,
    target_audience: 'EMPLOYEE',
    underlying_questions: [
      'My immediate manager recognizes me when I do a good job (88%)',
      'Employees are held accountable for the results they are expected to deliver (91%)',
      'My personal contributions and dedication are recognized and valued by leadership (89%)'
    ]
  },
  {
    metric_id: 16,
    journey_id: 3,
    checkpoint_id: 9,
    metric_name: 'Wellbeing Index (ESS)',
    metric_type: 'SURVEY',
    scale_type: 'PERCENTAGE',
    source_of_data: 'ESS (Employee Sentiment Survey)',
    experience_owner: 'PXCWB',
    target_value: 85.00,
    target_display: '> 85%',
    min_threshold: 80.00,
    raw_value: 87.00,
    normalized_score: 87.00,
    weight: 1.0,
    is_indicative: false,
    is_employee_metric: true,
    target_audience: 'EMPLOYEE',
    underlying_questions: [
      'CIMB cares about my well-being (86%)',
      'I can manage my job responsibilities in a way that enables healthy work-life balance (87%)',
      'The bank provides sufficient support, wellness resources, and flexibility to manage workplace stress (88%)'
    ]
  },
  {
    metric_id: 17,
    journey_id: 3,
    checkpoint_id: 10,
    metric_name: 'Psychological Safety Index (ESS)',
    metric_type: 'SURVEY',
    scale_type: 'PERCENTAGE',
    source_of_data: 'ESS (Employee Sentiment Survey)',
    experience_owner: 'HRBP, PXCWB',
    target_value: 85.00,
    target_display: '> 85%',
    min_threshold: 80.00,
    raw_value: 94.50,
    normalized_score: 94.50,
    weight: 1.0,
    is_indicative: false,
    is_employee_metric: true,
    target_audience: 'EMPLOYEE',
    underlying_questions: [
      'At work, I can speak up with ideas or suggestions, even if others have different opinions (90%)',
      'Colleagues escalate issues even when these are outside their direct responsibilities (91%)',
      'Escalating an issue helps ensure it is investigated and the root cause is addressed (98%)',
      'I know when an issue is serious enough to require me escalating it (99%)'
    ]
  },
  {
    metric_id: 18,
    journey_id: 3,
    checkpoint_id: 11,
    metric_name: 'Leadership Connection Score (ESS)',
    metric_type: 'SURVEY',
    scale_type: 'PERCENTAGE',
    source_of_data: 'ESS (Employee Sentiment Survey)',
    experience_owner: 'Talent, Leadership Development',
    target_value: 85.00,
    target_display: '> 85%',
    min_threshold: 80.00,
    raw_value: 88.50,
    normalized_score: 88.50,
    weight: 1.0,
    is_indicative: false,
    is_employee_metric: true,
    target_audience: 'EMPLOYEE',
    underlying_questions: [
      'Leaders help us understand and navigate changes happening in CIMB (89%)',
      'In CIMB, we are well equipped to handle changes effectively (88%)',
      'In CIMB, decisions get made without undue delay (81%)',
      'CIMB effectively adapts to changes in its external environment (90%)',
      'CIMB consistently implements new and better ways of doing things (91%)',
      'CIMB changes and adapts to stay competitive (92%)'
    ]
  },

  // --- CONTRIBUTE (7 metrics) ---
  {
    metric_id: 19,
    journey_id: 4,
    checkpoint_id: 12,
    metric_name: 'Mandatory Learning Satisfaction Score',
    metric_type: 'OUTCOME',
    scale_type: 'RATING_5',
    source_of_data: 'LoG+',
    experience_owner: 'Learning & Development',
    target_value: 4.25,
    target_display: '> 4.25 / 5',
    min_threshold: 80.00,
    raw_value: 4.85,
    normalized_score: 97.00,
    weight: 1.0,
    is_indicative: false,
    is_employee_metric: true,
    target_audience: 'EMPLOYEE',
    underlying_questions: ['Mandatory compliance training satisfaction (4.85/5)']
  },
  {
    metric_id: 20,
    journey_id: 4,
    checkpoint_id: 12,
    metric_name: 'Non-Mandatory Learning Satisfaction',
    metric_type: 'OUTCOME',
    scale_type: 'RATING_5',
    source_of_data: 'LoG+',
    experience_owner: 'Learning & Development',
    target_value: 4.00,
    target_display: '> 4.00 / 5',
    min_threshold: 75.00,
    raw_value: 4.83,
    normalized_score: 97.00,
    weight: 1.0,
    is_indicative: false,
    is_employee_metric: true,
    target_audience: 'EMPLOYEE',
    underlying_questions: ['Non-mandatory elective course satisfaction (4.83/5)']
  },
  {
    metric_id: 21,
    journey_id: 4,
    checkpoint_id: 12,
    metric_name: 'Career Growth & Learning Index (ESS)',
    metric_type: 'SURVEY',
    scale_type: 'PERCENTAGE',
    source_of_data: 'ESS (Employee Sentiment Survey)',
    experience_owner: 'Learning & Development',
    target_value: 85.00,
    target_display: '> 85%',
    min_threshold: 80.00,
    raw_value: 90.67,
    normalized_score: 90.67,
    weight: 1.0,
    is_indicative: false,
    is_employee_metric: true,
    target_audience: 'EMPLOYEE',
    underlying_questions: [
      'I have the opportunity to continually learn and grow (89%)',
      'CIMB has employees with the right skills to deliver its strategy (89%)',
      'CIMB has the capability and knowledge to achieve its goals (94%)'
    ]
  },
  {
    metric_id: 22,
    journey_id: 4,
    checkpoint_id: 12,
    metric_name: 'Capability & Enablement Index (ESS)',
    metric_type: 'SURVEY',
    scale_type: 'PERCENTAGE',
    source_of_data: 'ESS (Employee Sentiment Survey)',
    experience_owner: 'Learning & Development, PXCWB',
    target_value: 85.00,
    target_display: '> 85%',
    min_threshold: 80.00,
    raw_value: 87.67,
    normalized_score: 87.67,
    weight: 1.0,
    is_indicative: false,
    is_employee_metric: true,
    target_audience: 'EMPLOYEE',
    underlying_questions: [
      'Employees have sufficient authority to make decisions (84%)',
      'Employees clearly understand what is expected of them (90%)',
      'Employees have the tools, resources, and enablement to perform their duties effectively (89%)'
    ]
  },
  {
    metric_id: 23,
    journey_id: 4,
    checkpoint_id: 13,
    metric_name: 'Mentee / Coachee satisfaction score',
    metric_type: 'SURVEY',
    data_status: 'NOT_AVAILABLE', // v2.55.0: real data not available yet -> N/A, not in the PX Index (Admin switch)
    scale_type: 'RATING_5',
    source_of_data: 'Internal TLD',
    experience_owner: 'Leadership, Talent Development',
    target_value: 4.00,
    target_display: '> 4.00 / 5',
    min_threshold: 75.00,
    raw_value: 4.00,
    normalized_score: 80.00,
    weight: 1.0,
    is_indicative: false,
    is_employee_metric: true,
    target_audience: 'EMPLOYEE',
    underlying_questions: ['Effectiveness of mentor guidance & coaching impact']
  },
  {
    metric_id: 24,
    journey_id: 4,
    checkpoint_id: 14,
    metric_name: 'Performance Feedback Quality Index (ESS)',
    metric_type: 'SURVEY',
    scale_type: 'PERCENTAGE',
    source_of_data: 'ESS (Employee Sentiment Survey)',
    experience_owner: 'HRBP',
    target_value: 85.00,
    target_display: '> 85%',
    min_threshold: 80.00,
    raw_value: 90.33,
    normalized_score: 90.33,
    weight: 1.0,
    is_indicative: false,
    is_employee_metric: true,
    target_audience: 'EMPLOYEE',
    underlying_questions: [
      'My immediate manager gives me feedback that helps me improve my performance (91%)',
      'Employees are held accountable for the results they are expected to deliver (91%)',
      'My direct supervisor conducts regular, open performance conversations focused on continuous development (89%)'
    ]
  },
  {
    metric_id: 25,
    journey_id: 4,
    checkpoint_id: 15,
    metric_name: 'Meaningful Contribution Index (ESS)',
    metric_type: 'SURVEY',
    scale_type: 'PERCENTAGE',
    source_of_data: 'ESS (Employee Sentiment Survey)',
    experience_owner: 'PXCWB',
    target_value: 85.00,
    target_display: '> 85%',
    min_threshold: 80.00,
    raw_value: 90.67,
    normalized_score: 90.67,
    weight: 1.0,
    is_indicative: false,
    is_employee_metric: true,
    target_audience: 'EMPLOYEE',
    underlying_questions: [
      'My work gives me a feeling of personal accomplishment (90%)',
      'I understand how my work contributes to the success and purpose of CIMB (94%)',
      'I feel motivated and energized by the meaningful work I do (88%)'
    ]
  },

  // --- DEPART (2 metrics) ---
  {
    metric_id: 26,
    journey_id: 5,
    checkpoint_id: 16,
    metric_name: 'Exit Survey — resignation experience',
    metric_type: 'SURVEY',
    data_status: 'NOT_AVAILABLE', // v2.55.0: real data not available yet -> N/A, not in the PX Index (Admin switch)
    scale_type: 'RATING_5',
    source_of_data: 'Exit Interview Survey (Arjuna, will be developed)',
    experience_owner: 'HR Exit Management',
    target_value: 4.00,
    target_display: '> 4.00 / 5',
    min_threshold: 75.00,
    raw_value: 3.85,
    normalized_score: 77.00,
    weight: 1.0,
    is_indicative: true,
    is_employee_metric: true,
    target_audience: 'EMPLOYEE',
    underlying_questions: [
      'Saya memahami dengan jelas proses dan persyaratan pengunduran diri.',
      'Saya merasa mudah dalam mengajukan pengunduran diri.'
    ]
  },
  {
    metric_id: 27,
    journey_id: 5,
    checkpoint_id: 17,
    metric_name: 'Intent to Stay Index (ESS)',
    metric_type: 'SURVEY',
    scale_type: 'PERCENTAGE',
    source_of_data: 'ESS (Employee Sentiment Survey)',
    experience_owner: 'Performance, Reward & Budgeting',
    target_value: 80.00,
    target_display: '> 80%',
    min_threshold: 75.00,
    raw_value: 80.00,
    normalized_score: 80.00,
    weight: 1.0,
    is_indicative: false,
    is_employee_metric: true,
    target_audience: 'EMPLOYEE',
    underlying_questions: [
      'Even if offered a comparable role and compensation package at another company, I would choose to stay at CIMB (77%)',
      'I see a promising long-term future and career growth for myself at CIMB (79%)',
      'I would recommend CIMB as a great place to work to prospective candidates (84%)'
    ]
  }
].map(m => {
  // --- Data Update Cadence ("Frekuensi Update Data") ---
  // ESS (Employee Sentiment Survey) metrics are collected once a year in real CIMB HR
  // practice, so their full-year calculation only needs a single annual upload. Everything
  // else (recurring survey instruments, HR system feeds) is refreshed every month.
  const isEssMetric = (m.source_of_data || '').toUpperCase().includes('ESS');
  const update_frequency = isEssMetric ? 'ONE_TIME_ANNUAL' : 'MONTHLY';

  // --- Manual Survey Upload Reminder Settings ---
  // Only SURVEY-type metrics rely on a human PIC manually uploading a CSV each cycle;
  // OUTCOME metrics are sourced from HR system feeds/reports, not manual survey upload.
  const requires_manual_upload = m.metric_type === 'SURVEY';
  const picSlug = m.experience_owner
    ? m.experience_owner.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '')
    : 'pxcwb.team';

  // --- Last HR System Ingestion Date (OUTCOME metrics only) ---
  // This used to live as a hardcoded { metric_id: date } lookup table inside
  // calculationEngine.js's business logic — moved here so it's a real, admin-editable
  // database field (via PUT /api/admin/metrics/:id) instead of a second, code-only source
  // of truth that could silently drift from what an admin configures.
  const last_data_date = m.metric_type === 'OUTCOME' ? (OUTCOME_INGESTION_DATES[m.metric_id] || '2026-03-24') : undefined;

  return {
    ...m,
    unit: METRIC_UNITS[m.metric_id] || defaultUnitForScale(m.scale_type),
    // Sumber survei (v2.29.0): ESS (Employee Sentiment Survey, template ESS) atau SYSTEM (sistem/form lain); OUTCOME = null.
    survey_source: m.metric_type === 'SURVEY' ? (isEssMetric ? 'ESS' : 'SYSTEM') : null,
    update_frequency,
    requires_manual_upload,
    // Monthly metrics: due by the 25th of every month. Annual (ESS) metrics: due by
    // the 25th of November, ahead of Year-to-Date closing calculations in December.
    upload_deadline_day: 25,
    upload_deadline_month: 11,
    pic_name: m.experience_owner || 'PXCWB Team',
    pic_email: `${picSlug}@cimbniaga.co.id`,
    ...(last_data_date ? { last_data_date } : {})
  };
});

const initialActionLibrary = [
  {
    metric_id: 27, // Intent to Stay
    checkpoint_id: 17,
    gap_condition: 'Skor Intent to Stay < 80%',
    recommended_action: 'Adakan Stay Interview proaktif pada unit berisiko turnover tinggi & tinjau competitive benchmark benefit.',
    suggested_initiatives: '1. Luncurkan program Total Rewards communication clarity.\n2. Lakukan retention risk mapping bersama HRBP untuk talent top performer.\n3. Tingkatkan fleksibilitas kerja & program employee recognition.'
  },
  {
    metric_id: 26, // Resignation Experience
    checkpoint_id: 16,
    gap_condition: 'Skor Resignation Experience < 80%',
    recommended_action: 'Sederhanakan proses administrasi exit clearance di Arjuna dan sediakan checklist serah terima digital.',
    suggested_initiatives: '1. Otomasi notifikasi H-7 exit clearance ke IT & General Affairs.\n2. Buat panduan digital transisi pekerjaan untuk employee & supervisor.\n3. Lakukan exit interview tatap muka untuk feedback mendalam.'
  },
  {
    metric_id: 11, // Signature Program Participation
    checkpoint_id: 7,
    gap_condition: 'Partisipasi Signature Program < 500 pax',
    recommended_action: 'Intensifkan kampanye multi-channel H-5 sebelum event dan sediakan format hybrid interaktif.',
    suggested_initiatives: '1. Kirim kalender undangan otomatis (iCal) ke seluruh division champions.\n2. Hadirkan pembicara eksekutif / guest speaker inspiratif.\n3. Berikan gamification & quiz berhadiah e-wallet di akhir sesi.'
  },
  {
    metric_id: 12, // Signature Program Satisfaction
    checkpoint_id: 7,
    gap_condition: 'Kepuasan Signature Program < 4.00/5 (80%)',
    recommended_action: 'Evaluasi relevansi topik dan durasi sesi agar lebih interaktif dengan studi kasus praktis.',
    suggested_initiatives: '1. Alokasikan waktu Q&A lebih banyak (min. 20 menit).\n2. Lakukan pre-survey materi apa yang paling dibutuhkan peserta sebelum event dibuat.\n3. Perbaiki kualitas audio-visual dan koneksi streaming.'
  },
  {
    metric_id: 14, // % employees receiving recognition
    checkpoint_id: 8,
    gap_condition: 'Penerima Recognition < 5,000 karyawan/tahun',
    recommended_action: 'Adakan "Recognition Week" di aplikasi Arjuna dan berikan reminder bulanan kepada para People Manager.',
    suggested_initiatives: '1. Buat leaderboard recognition antar divisi.\n2. Integrasikan shoutout recognition ke WhatsApp bot / Workplace internal.\n3. Berikan token apresiasi yang bisa ditukar voucher.'
  },
  {
    metric_id: 7, // Day 1 Onboarding
    checkpoint_id: 4,
    gap_condition: 'Day 1 Onboarding < 80%',
    recommended_action: 'Pastikan kesiapan alat kerja (laptop, user ID, ID card) 100% tuntas H-1 sebelum new joiner hadir.',
    suggested_initiatives: '1. Perkuat SLA antara IT Onboarding & HR Logistics.\n2. Wajibkan Direct Supervisor menyambut new joiner di pagi hari Day 1.\n3. Sediakan welcome kit dan mentor teman baru sejak hari pertama.'
  }
];

const defaultSurveyQuestions = [
  {
    question_id: 1,
    question_text: 'Seberapa relevan dan bermanfaat materi yang disampaikan dalam event ini bagi Anda?',
    question_type: 'RATING_5',
    display_order: 1,
    is_default: true
  },
  {
    question_id: 2,
    question_text: 'Bagaimana penilaian Anda terhadap kejelasan dan kemampuan pembicara dalam membawakan materi?',
    question_type: 'RATING_5',
    display_order: 2,
    is_default: true
  },
  {
    question_id: 3,
    question_text: 'Bagaimana kepuasan Anda terhadap teknis pelaksanaan acara (waktu, fasilitas/platform streaming, dan interaktivitas)?',
    question_type: 'RATING_5',
    display_order: 3,
    is_default: true
  },
  {
    question_id: 4,
    question_text: 'Secara keseluruhan, seberapa puas Anda mengikuti Signature Program CIMB Niaga ini?',
    question_type: 'RATING_5',
    display_order: 4,
    is_default: true
  },
  {
    question_id: 5,
    question_text: 'Apa hal paling berkesan dan saran perbaikan untuk Signature Program berikutnya?',
    question_type: 'TEXT_VERBATIM',
    display_order: 5,
    is_default: true
  }
];

const sampleEvents = [
  {
    event_id: 'ev-perspektif-2024-q1',
    event_name: 'Perspektif: Navigating Career Growth & Agility in CIMB',
    program_category: 'Perspektif',
    event_date: '2026-03-15T09:00:00.000Z',
    event_type: 'HYBRID',
    location: 'Auditorium Menara CIMB Niaga & Zoom Live',
    target_participants: 500,
    pre_event_code: 'PERSPEKTIF-2024-Q1',
    post_event_code: 'EVAL-PERSPEKTIF-2024-Q1',
    is_attendance_open: true,
    is_feedback_open: true,
    created_by: 'PXCWB Team'
  },
  {
    event_id: 'ev-di-inspire-2024',
    event_name: 'D&I Forum: Embracing Inclusive Leadership & Psychological Safety',
    program_category: 'D&I',
    event_date: '2026-04-10T13:30:00.000Z',
    event_type: 'HYBRID',
    location: 'Graha CIMB Niaga Hall & MS Teams',
    target_participants: 500,
    pre_event_code: 'DI-INSPIRE-2024',
    post_event_code: 'EVAL-DI-INSPIRE-2024',
    is_attendance_open: true,
    is_feedback_open: true,
    created_by: 'PXCWB Team'
  }
];

const sampleAttendances = [
  { attendance_id: 1, event_id: 'ev-perspektif-2024-q1', nip: '8801923', employee_name: 'Ahmad Fauzi', cimb_email: 'ahmad.fauzi@cimbniaga.co.id', directorate: 'Operations, Technology, Analytics & AI', division: 'Core Banking Solution', attendance_timestamp: '2026-03-15T08:45:00.000Z' },
  { attendance_id: 2, event_id: 'ev-perspektif-2024-q1', nip: '8802341', employee_name: 'Siti Rahmawati', cimb_email: 'siti.rahmawati@cimbniaga.co.id', directorate: 'Human Resources', division: 'People Experience & Culture', attendance_timestamp: '2026-03-15T08:50:00.000Z' },
  { attendance_id: 3, event_id: 'ev-perspektif-2024-q1', nip: '8804552', employee_name: 'Budi Santoso', cimb_email: 'budi.santoso@cimbniaga.co.id', directorate: 'Consumer & EBB', division: 'Branch Banking Region 1', attendance_timestamp: '2026-03-15T08:55:00.000Z' },
  { attendance_id: 4, event_id: 'ev-perspektif-2024-q1', nip: '8807890', employee_name: 'Dewi Lestari', cimb_email: 'dewi.lestari@cimbniaga.co.id', directorate: 'Risk Management', division: 'Credit Risk Operations', attendance_timestamp: '2026-03-15T09:02:00.000Z' },
  { attendance_id: 5, event_id: 'ev-perspektif-2024-q1', nip: '8809112', employee_name: 'Rian Pratama', cimb_email: 'rian.pratama@cimbniaga.co.id', directorate: 'Network & Digital Banking', division: 'OCTO Mobile Product', attendance_timestamp: '2026-03-15T09:05:00.000Z' }
];

const sampleFeedbackResponses = [
  {
    response_id: 1,
    event_id: 'ev-perspektif-2024-q1',
    nip: '8801923',
    ratings: { 'q1_topic_relevance': 5, 'q2_speaker_delivery': 5, 'q3_event_technical': 4, 'q4_overall_satisfaction': 5 },
    verbatim: 'Materi sangat inspiratif dan memberikan kejelasan jenjang karir teknis di era digitalisasi CIMB.',
    submitted_at: '2026-03-15T11:45:00.000Z'
  },
  {
    response_id: 2,
    event_id: 'ev-perspektif-2024-q1',
    nip: '8802341',
    ratings: { 'q1_topic_relevance': 5, 'q2_speaker_delivery': 4, 'q3_event_technical': 5, 'q4_overall_satisfaction': 5 },
    verbatim: 'Sangat mengapresiasi sesi sharing dari senior leaders. Sangat membuka wawasan tentang sinergi antar unit.',
    submitted_at: '2026-03-15T11:50:00.000Z'
  },
  {
    response_id: 3,
    event_id: 'ev-perspektif-2024-q1',
    nip: '8804552',
    ratings: { 'q1_topic_relevance': 4, 'q2_speaker_delivery': 4, 'q3_event_technical': 4, 'q4_overall_satisfaction': 4 },
    verbatim: 'Acaranya menarik, ke depannya waktu Q&A bisa diperpanjang agar audiens online bisa lebih banyak bertanya.',
    submitted_at: '2026-03-15T11:52:00.000Z'
  }
];

// The bank's 12 real directorates (ESS 2025 result file; v2.31.0 replaced the 8 demo directorates - old
// names in existing data are renamed at boot by directorateMigration.js). Divisions of the old demo
// directory were re-parented, never invented: a directorate may have no division yet.
// v2.51.0: the bank's reorganisation renamed four of them (Sharia Banking -> Syariah Banking, Special Asset -> SLC,
// Strategy, Finance & SPAPM -> Strategy & Finance, Treasury & Capital Market -> Treasury & Financial Institutions;
// directoryNames.SEED_DIRECTORATE_RENAMES). Only a FRESH database gets these names from the seed; an existing one keeps
// its names until the Admin renames them in Admin Parameters -> Directorates (the boot never renames the master).
const initialDirectorates = [
  {
    directorate_name: 'Business Banking',
    divisions: [
      'Corporate Banking Coverage',
      'Commercial Banking SME',
      'Transaction Banking'
    ]
  },
  {
    directorate_name: 'Compliance, Corporate Affairs & Legal',
    divisions: [
      'Legal Counsel & Corporate Secretarial'
    ]
  },
  {
    directorate_name: 'Consumer & EBB',
    divisions: [
      'Branch Service Excellence',
      'Wealth Management',
      'Consumer Lending & Cards',
      'Digital Banking & Acquisition'
    ]
  },
  {
    directorate_name: 'Corporate Assurance',
    divisions: [
      'Internal Audit Group'
    ]
  },
  {
    directorate_name: 'Human Resources',
    divisions: [
      'People Experience & Culture (PXCWB)',
      'Talent Acquisition & Partnership',
      'HR Onboarding & HRBP',
      'Learning & Talent Development (TLD)',
      'Performance, Reward & Budgeting',
      'HR Exit & Industrial Relations'
    ]
  },
  {
    directorate_name: 'Network & Digital Banking',
    divisions: []
  },
  {
    directorate_name: 'Operations, Technology, Analytics & AI',
    divisions: [
      'Application Development',
      'IT Infrastructure & Operations',
      'IT Security & Governance',
      'Core Banking & Digital Solutions',
      'Central Operations & Services'
    ]
  },
  {
    directorate_name: 'Risk Management',
    divisions: [
      'Enterprise Risk Management',
      'Credit Risk Analytics',
      'Market & Operational Risk',
      'Compliance & AML/CFT'
    ]
  },
  {
    directorate_name: 'Syariah Banking',
    divisions: []
  },
  {
    directorate_name: 'SLC ASG Satyaguna Langgeng Capital',
    divisions: []
  },
  {
    directorate_name: 'Strategy & Finance',
    divisions: [
      'Financial Planning & Control'
    ]
  },
  {
    directorate_name: 'Treasury & Financial Institutions',
    divisions: [
      'Investment Banking & Markets',
      'Treasury Operations'
    ]
  }
];

// Organisation units the demo respondents (survey responses + event attendance) actually belong
// to. They are part of the directory so that every respondent can be reached through the
// Directorate / Sub-Directorate filters (previously these units existed only as free text on
// the responses and ~15 divisions were unreachable).
const respondentOrgUnits = [
  ['Business Banking', 'Corporate Banking'],
  ['Consumer & EBB', 'Branch Banking Region 1'],
  ['Consumer & EBB', 'Branch Banking Region 2'],
  ['Strategy & Finance', 'Financial Planning & Analysis'],
  ['Human Resources', 'Talent Acquisition'],
  ['Human Resources', 'People Experience & Culture'],
  ['Operations, Technology, Analytics & AI', 'Core Banking Solution'],
  ['Operations, Technology, Analytics & AI', 'IT Infrastructure & Security'],
  ['Compliance, Corporate Affairs & Legal', 'Legal & Compliance'],
  ['Risk Management', 'Market Risk'],
  ['Risk Management', 'Credit Risk Operations'],
  ['Network & Digital Banking', 'OCTO Mobile Product'],
  ['Network & Digital Banking', 'OCTO Mobile'],
  ['Operations, Technology, Analytics & AI', 'App Dev'],
  ['Operations, Technology, Analytics & AI', 'Core Banking'],
  ['Human Resources', 'People Experience']
];
respondentOrgUnits.forEach(([directorate_name, division]) => {
  let d = initialDirectorates.find(x => x.directorate_name === directorate_name);
  if (!d) { d = { directorate_name, divisions: [] }; initialDirectorates.push(d); }
  if (!d.divisions.includes(division)) d.divisions.push(division);
});

// Helper to generate seed multi-month survey responses with question-level breakdown
function generateInitialSurveyResponses() {
  const { DEFAULT_METRIC_QUESTIONS } = require('../services/metricQuestionService');
  const employees = [
    { nip: '8801245', name: 'Dimas Setiawan', email: 'dimas.setiawan@cimbniaga.co.id', dir: 'Operations, Technology, Analytics & AI', div: 'Core Banking Solution' },
    { nip: '8802391', name: 'Anisa Rahmawati', email: 'anisa.rahmawati@cimbniaga.co.id', dir: 'Human Resources', div: 'People Experience & Culture' },
    { nip: '8803418', name: 'Reza Pratama', email: 'reza.pratama@cimbniaga.co.id', dir: 'Consumer & EBB', div: 'Branch Banking Region 1' },
    { nip: '8804572', name: 'Citra Dewi', email: 'citra.dewi@cimbniaga.co.id', dir: 'Risk Management', div: 'Credit Risk Operations' },
    { nip: '8805629', name: 'Fajar Nugroho', email: 'fajar.nugroho@cimbniaga.co.id', dir: 'Operations, Technology, Analytics & AI', div: 'Application Development' },
    { nip: '8806781', name: 'Lestari Wulandari', email: 'lestari.w@cimbniaga.co.id', dir: 'Business Banking', div: 'Commercial Banking SME' },
    { nip: '8807894', name: 'Bambang Kusuma', email: 'bambang.k@cimbniaga.co.id', dir: 'Corporate Assurance', div: 'Internal Audit Group' },
    { nip: '8808935', name: 'Mega Anggraini', email: 'mega.a@cimbniaga.co.id', dir: 'Treasury & Financial Institutions', div: 'Treasury Operations' },
    { nip: '8810127', name: 'Yoga Prasetyo', email: 'yoga.prasetyo@cimbniaga.co.id', dir: 'Consumer & EBB', div: 'Branch Banking Region 2' },
    { nip: '8811284', name: 'Putri Handayani', email: 'putri.handayani@cimbniaga.co.id', dir: 'Network & Digital Banking', div: 'OCTO Mobile Product' },
    { nip: '8812356', name: 'Arief Budiman', email: 'arief.budiman@cimbniaga.co.id', dir: 'Risk Management', div: 'Market Risk' },
    { nip: '8813492', name: 'Sri Wahyuni', email: 'sri.wahyuni@cimbniaga.co.id', dir: 'Human Resources', div: 'Talent Acquisition' },
    { nip: '8814518', name: 'Bayu Firmansyah', email: 'bayu.firmansyah@cimbniaga.co.id', dir: 'Operations, Technology, Analytics & AI', div: 'IT Infrastructure & Security' },
    { nip: '8815673', name: 'Indah Permatasari', email: 'indah.permatasari@cimbniaga.co.id', dir: 'Business Banking', div: 'Corporate Banking' },
    { nip: '8816729', name: 'Rendy Saputra', email: 'rendy.saputra@cimbniaga.co.id', dir: 'Strategy & Finance', div: 'Financial Planning & Analysis' },
    { nip: '8817845', name: 'Melati Kusumawardhani', email: 'melati.k@cimbniaga.co.id', dir: 'Compliance, Corporate Affairs & Legal', div: 'Legal & Compliance' }
  ];

  const campusStudents = [
    { id: 'PESERTA-2026-001', name: 'Aditya Pratama', email: 'aditya.pratama@ui.ac.id', university: 'Universitas Indonesia', major: 'Teknik Informatika' },
    { id: 'PESERTA-2026-002', name: 'Nadia Salsabila', email: 'nadia.salsabila@itb.ac.id', university: 'Institut Teknologi Bandung', major: 'Manajemen Bisnis' },
    { id: 'PESERTA-2026-003', name: 'Rizky Ramadhan', email: 'rizky.r@ugm.ac.id', university: 'Universitas Gadjah Mada', major: 'Sistem Informasi' },
    { id: 'PESERTA-2026-004', name: 'Farhan Alamsyah', email: 'farhan.a@unpad.ac.id', university: 'Universitas Padjadjaran', major: 'Akuntansi & Keuangan' },
    { id: 'PESERTA-2026-005', name: 'Bella Anggraeni', email: 'bella.anggraeni@its.ac.id', university: 'Institut Teknologi Sepuluh Nopember', major: 'Teknik Industri' },
    { id: 'PESERTA-2026-006', name: 'Dimas Aryasatya', email: 'dimas.aryasatya@unair.ac.id', university: 'Universitas Airlangga', major: 'Ekonomi Pembangunan' }
  ];

  const jobCandidates = [
    { id: 'CAND-2026-101', name: 'Jessica Stephanie', email: 'jessica.stephanie@gmail.com', position: 'Digital Banking Specialist', channel: 'LinkedIn Talent Solutions' },
    { id: 'CAND-2026-102', name: 'Kevin Wijaya', email: 'kevin.wijaya@yahoo.com', position: 'Fullstack Engineer', channel: 'CIMB Career Website' },
    { id: 'CAND-2026-103', name: 'Tasya Kamila', email: 'tasya.kamila@outlook.com', position: 'Credit Risk Analyst', channel: 'Campus Hiring Fair' },
    { id: 'CAND-2026-104', name: 'Hendra Gunawan', email: 'hendra.gunawan@gmail.com', position: 'Wealth Relationship Manager', channel: 'Jobstreet Portal' },
    { id: 'CAND-2026-105', name: 'Clara Amelia', email: 'clara.amelia@gmail.com', position: 'Data Analyst', channel: 'Employee Referral Program' },
    { id: 'CAND-2026-106', name: 'Fikri Ramadhan', email: 'fikri.ramadhan@outlook.com', position: 'Relationship Manager SME', channel: 'LinkedIn Talent Solutions' }
  ];

  const responses = [];
  let respId = 1;

  const dates = [];

  // --- Prior year (2025) — a FULL 12-month dataset, so switching the Dashboard's year
  // selector to 2025 (or building a cross-year Performance Trend range, e.g. Nov 2025 s/d
  // Feb 2026) pulls genuine database-backed monthly variation instead of silently falling
  // back to each metric's static default raw_value (which looked identical/"hardcoded" no
  // matter which year was selected).
  const PRIOR_YEAR = 2025;
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, '0');
    dates.push(`${PRIOR_YEAR}-${mm}-05`, `${PRIOR_YEAR}-${mm}-15`, `${PRIOR_YEAR}-${mm}-25`);
  }

  // --- Current seed year (2026) --- 4 survey dates per month (was 3) for a denser,
  // richer-looking Performance Trend chart with more underlying response volume per point.
  dates.push(
    '2026-01-08', '2026-01-15', '2026-01-22', '2026-01-29',
    '2026-02-05', '2026-02-12', '2026-02-19', '2026-02-24',
    '2026-03-04', '2026-03-12', '2026-03-20', '2026-03-27'
  );

  // Dynamically extend seed survey response dates through the CURRENT calendar month
  // (whatever "today" is when the server boots), so the People Experience Performance
  // Trend chart always shows real monthly movement up through the latest month instead
  // of flatlining on a static forecast formula for months that have already passed.
  // Months genuinely in the future keep using calculationEngine's forecast projection.
  const SEED_YEAR = 2026;
  const today = new Date();
  const currentMonth = (today.getFullYear() === SEED_YEAR) ? (today.getMonth() + 1) : 12;
  for (let m = 4; m <= currentMonth; m++) {
    const mm = String(m).padStart(2, '0');
    dates.push(`${SEED_YEAR}-${mm}-05`, `${SEED_YEAR}-${mm}-12`, `${SEED_YEAR}-${mm}-19`, `${SEED_YEAR}-${mm}-25`);
  }

  // Gentle, monotonic month-over-month improvement across 2026 only (2025's baseline dataset
  // is left untouched) — represents PXCWB's intervention programs taking effect through the
  // year. Expressed in 0-100 normalized percentage-points (0pp in January, ramping to roughly
  // +9pp by December); each scale branch below converts this into its own native scale. This
  // is what gives the YTD Performance Trend chart genuine, visible upward movement instead of
  // a nearly flat cumulative line — previously every month used the exact same static base
  // score, so the cumulative YTD average barely moved (~83.0-83.7% across all of Jan-Aug).
  function monthTrendBonusPercent(surveyDate) {
    const str = String(surveyDate);
    if (str.slice(0, 4) !== String(SEED_YEAR)) return 0;
    const month = parseInt(str.slice(5, 7), 10) || 1;
    return (month - 1) * 0.85;
  }

  const surveyMetricIds = Object.keys(DEFAULT_METRIC_QUESTIONS).map(k => parseInt(k));

  surveyMetricIds.forEach(metricId => {
    const metricObj = initialMetrics.find(m => m.metric_id === metricId);
    if (!metricObj) return;
    // ESS metrics have no per-respondent rows (v2.32.0): their data is the uploaded ESS summary (initialEssResults).
    if (metricObj.survey_source === 'ESS') return;

    const questions = DEFAULT_METRIC_QUESTIONS[metricId] || [];
    const isScale5 = metricObj.scale_type === 'RATING_5';
    const baseTarget = metricObj.raw_value || (isScale5 ? 4.2 : 85);

    // Create responses across dates
    dates.forEach((surveyDate, dateIdx) => {
      if (metricId === 2) {
        // Metric 2: Non-employee Campus Students
        const studentSubset = [
          campusStudents[dateIdx % campusStudents.length],
          campusStudents[(dateIdx + 1) % campusStudents.length],
          campusStudents[(dateIdx + 3) % campusStudents.length]
        ];

        studentSubset.forEach((student, sIdx) => {
          const ratings = {};
          let scorableNormalizedSum = 0;
          let scorableCount = 0;

          questions.forEach((q, qIdx) => {
            const type = q.type || 'SCALE_1_5';
            if (type === 'FREE_TEXT') {
              ratings[q.key] = 'Sesi Goes to Campus sangat menarik dan memberi gambaran karir perbankan modern.';
            } else {
              const base5 = 4.2 + monthTrendBonusPercent(surveyDate) / 20;
              const variance = ((dateIdx + sIdx + qIdx) % 5 - 2) * 0.15;
              const score = Math.min(5.0, Math.max(3.5, Math.round((base5 + variance) * 10) / 10));
              ratings[q.key] = score;
              scorableNormalizedSum += (score / 5.0) * 100;
              scorableCount += 1;
            }
          });

          const normalizedAvg = scorableCount > 0 ? (scorableNormalizedSum / scorableCount) : 84;
          const avgScore = Math.round(((normalizedAvg / 100) * 5) * 100) / 100;

          responses.push({
            response_id: respId++,
            upload_id: 'seed-batch-2026',
            metric_id: 2,
            nip: student.id,
            participant_id: student.id,
            employee_name: student.name,
            participant_name: student.name,
            cimb_email: student.email,
            email: student.email,
            directorate: student.university,
            university: student.university,
            division: student.major,
            major: student.major,
            ratings,
            rating_score: avgScore,
            verbatim_feedback: 'Sangat menginspirasi mahasiswa tingkat akhir dalam persiapan memasuki dunia kerja di CIMB.',
            survey_date: surveyDate,
            source: 'CAMPUS_SURVEY',
            created_at: `${surveyDate}T10:00:00.000Z`
          });
        });
      } else if (metricId === 5) {
        // Metric 5: Non-employee Job Candidates
        const candidateSubset = [
          jobCandidates[dateIdx % jobCandidates.length],
          jobCandidates[(dateIdx + 1) % jobCandidates.length],
          jobCandidates[(dateIdx + 3) % jobCandidates.length]
        ];

        candidateSubset.forEach((cand, cIdx) => {
          const ratings = {};
          let scorableNormalizedSum = 0;
          let scorableCount = 0;

          questions.forEach((q, qIdx) => {
            const type = q.type || 'SCALE_1_5';
            if (type === 'FREE_TEXT') {
              ratings[q.key] = 'Proses rekrutmen sangat profesional, tepat waktu, dan komunikatif.';
            } else {
              const base5 = 4.1 + monthTrendBonusPercent(surveyDate) / 20;
              const variance = ((dateIdx + cIdx + qIdx) % 5 - 2) * 0.15;
              const score = Math.min(5.0, Math.max(3.5, Math.round((base5 + variance) * 10) / 10));
              ratings[q.key] = score;
              scorableNormalizedSum += (score / 5.0) * 100;
              scorableCount += 1;
            }
          });

          const normalizedAvg = scorableCount > 0 ? (scorableNormalizedSum / scorableCount) : 82;
          const avgScore = Math.round(((normalizedAvg / 100) * 5) * 100) / 100;

          responses.push({
            response_id: respId++,
            upload_id: 'seed-batch-2026',
            metric_id: 5,
            nip: cand.id,
            candidate_id: cand.id,
            employee_name: cand.name,
            candidate_name: cand.name,
            cimb_email: cand.email,
            email: cand.email,
            directorate: cand.position,
            applied_position: cand.position,
            division: cand.channel,
            recruitment_channel: cand.channel,
            ratings,
            rating_score: avgScore,
            verbatim_feedback: 'Pengalaman wawancara sangat nyaman dan interviewer memberikan feedback yang membangun.',
            survey_date: surveyDate,
            source: 'CANDIDATE_SURVEY',
            created_at: `${surveyDate}T10:00:00.000Z`
          });
        });
      } else {
        // Regular Employee Metrics
        const empSubset = [
          employees[dateIdx % employees.length],
          employees[(dateIdx + 3) % employees.length],
          employees[(dateIdx + 7) % employees.length]
        ];

        empSubset.forEach((emp, empIdx) => {
          const ratings = {};
          let scorableNormalizedSum = 0;
          let scorableCount = 0;
          const monthBonus = monthTrendBonusPercent(surveyDate);

          questions.forEach((q, qIdx) => {
            const type = q.type || 'SCALE_1_5';
            if (type === 'YES_NO') {
              // "Tidak" rate starts at ~1-in-7 in January and gets progressively rarer through
              // the year as the month-trend bonus grows, instead of staying fixed all year.
              const yesThresholdDivisor = 7 + Math.floor(monthBonus / 2);
              const isYes = (dateIdx + empIdx + qIdx) % yesThresholdDivisor !== 0;
              ratings[q.key] = isYes ? 'Ya' : 'Tidak';
              scorableNormalizedSum += isYes ? 100 : 0;
              scorableCount += 1;
            } else if (type === 'SCALE_1_10') {
              const base10 = (isScale5 ? (baseTarget * 2) : (baseTarget / 10)) + monthBonus / 10;
              const variance = ((dateIdx + empIdx + qIdx) % 5 - 2) * 0.25;
              const score = Math.min(10.0, Math.max(6.0, Math.round((base10 + variance) * 10) / 10));
              ratings[q.key] = score;
              scorableNormalizedSum += (score / 10.0) * 100;
              scorableCount += 1;
            } else if (type === 'FREE_TEXT') {
              const verbatimList = [
                'Program pembekalan dan fasilitas kerja sangat membantu adaptasi.',
                'Komunikasi dengan mentor dan atasan berjalan sangat efektif dan terbuka.',
                'Fasilitas kerja dan akses sistem sudah siap sejak hari pertama.',
                'Materi orientasi sangat komprehensif dan mudah dipahami.'
              ];
              ratings[q.key] = verbatimList[(dateIdx + empIdx + qIdx) % verbatimList.length];
            } else {
              // SCALE_1_5
              const base5 = (isScale5 ? baseTarget : (baseTarget / 20)) + monthBonus / 20;
              const variance = ((dateIdx + empIdx + qIdx) % 5 - 2) * 0.12;
              const score = Math.min(5.0, Math.max(3.0, Math.round((base5 + variance) * 10) / 10));
              ratings[q.key] = score;
              scorableNormalizedSum += (score / 5.0) * 100;
              scorableCount += 1;
            }
          });

          const normalizedAvg = scorableCount > 0 ? (scorableNormalizedSum / scorableCount) : 85;
          const avgScore = isScale5
            ? Math.round(((normalizedAvg / 100) * 5) * 100) / 100
            : Math.round(normalizedAvg * 100) / 100;

          const verbatimSamples = [
            'Proses dan fasilitas sangat baik, komunikasi tim sangat responsif.',
            'Sangat membantu dalam menunjang produktivitas dan kenyamanan kerja harian.',
            'Harap terus dipertahankan dan ditingkatkan untuk program periode berikutnya.',
            'Koordinasi antar tim berjalan sangat lancar dan transparan.',
            'Materi dan arahan yang diberikan sangat aplikatif di lapangan.'
          ];

          responses.push({
            response_id: respId++,
            upload_id: 'seed-batch-2026',
            metric_id: metricId,
            nip: emp.nip,
            employee_name: emp.name,
            cimb_email: emp.email,
            directorate: emp.dir,
            division: emp.div,
            ratings,
            rating_score: avgScore,
            verbatim_feedback: verbatimSamples[(respId + dateIdx) % verbatimSamples.length],
            survey_date: surveyDate,
            source: 'SEED_SURVEY',
            created_at: `${surveyDate}T10:00:00.000Z`
          });
        });
      }
    });
  });

  return responses;
}

const initialSurveyUploadedResponses = generateInitialSurveyResponses();

// ESS result summaries (v2.32.0) - the ESS data of every ESS metric is the uploaded summary file (one row per
// org unit), not per-respondent rows. Period November 2025 for every ESS metric. The metric "Role Clarity & DS
// Support Score Index" carries the EXACT values of the real file "ESS 2025 Result_Role Clarity & DS Support.xlsx"
// (fractions x 100); the other ESS metrics get deterministic DUMMY rows with the same participation numbers, the
// bankwide index equal to the metric's seed raw_value and each directorate within about 4 points of it.
// Inserted once per metric by the storage boot top-up (only when the metric has no ESS result at all).
const ESS_SEED_PERIOD = { year: 2025, month: 11 };
const ESS_SEED_PARTICIPATION = [
  ['Business Banking', 449],
  ['Compliance, Corporate Affairs & Legal', 95],
  ['Consumer & EBB', 1816],
  ['Corporate Assurance', 108],
  ['Human Resources', 129],
  ['Network & Digital Banking', 2579],
  ['Operations, Technology, Analytics & AI', 1494],
  ['Risk Management', 192],
  ['Syariah Banking', 365],
  ['SLC ASG Satyaguna Langgeng Capital', 39],
  ['Strategy & Finance', 274],
  ['Treasury & Financial Institutions', 88]
];
const ESS_SEED_BANKWIDE_PARTICIPATION = 7756;
// Real file, metric Role Clarity & DS Support: [index, q1, q2, q3] per row (Bankwide first, then the 12 directorates above).
const ESS_ROLE_CLARITY_QUESTIONS = [
  'I understand how my current job role contributes to a positive impact on customers and society.',
  'Employees clearly understand what is expected of them.',
  'My immediate manager gives me feedback that helps me improve my performance.'
];
const ESS_ROLE_CLARITY_ROWS = [
  [92, 96, 90, 90],
  [91, 95, 88, 90],
  [93.6667, 99, 89, 93],
  [93.6667, 96, 93, 92],
  [90.6667, 96, 92, 84],
  [92.3333, 98, 84, 95],
  [93.6667, 97, 93, 91],
  [87.3333, 93, 84, 85],
  [92.3333, 94, 90, 93],
  [93, 96, 93, 90],
  [98, 97, 97, 100],
  [89.3333, 92, 88, 88],
  [90.3333, 95, 88, 88]
];

// v2.50.0: ESS runs once a year (November) and a later period reads the latest result (carry-forward), so the 2026
// dummy quarters of v2.37.0 (March, June, September) were removed. These are the periods whose seed uploads
// (upload_id seed-ess-<metric>-<period>, uploaded_by "Seed (dummy)") the storage boot deletes from an existing database.
const ESS_REMOVED_DUMMY_PERIODS = ['2026-03', '2026-06', '2026-09'];
const ESS_SEED_UPLOADED_BY = 'Seed (dummy)';
const isRemovedEssDummyUpload = u => !!u && u.uploaded_by === ESS_SEED_UPLOADED_BY
  && ESS_REMOVED_DUMMY_PERIODS.some(p => String(u.upload_id || '') === 'seed-ess-' + u.metric_id + '-' + p);

function generateInitialEssResults() {
  const { DEFAULT_METRIC_QUESTIONS } = require('../services/metricQuestionService');
  const results = [];
  const uploads = [];
  const clamp = v => Math.min(100, Math.max(0, v));
  const r2 = v => Math.round(v * 100) / 100;
  const pushUpload = (uploadId, m, fileName, rowCount, uploadedAt) => uploads.push({
    upload_id: uploadId,
    metric_id: m.metric_id,
    file_name: fileName,
    total_rows: rowCount,
    valid_rows: rowCount,
    invalid_rows: 0,
    calculated_avg_score: results.find(r => r.upload_id === uploadId && r.org_level === 'BANKWIDE').index_score,
    uploaded_by: ESS_SEED_UPLOADED_BY,
    uploaded_at: uploadedAt
  });
  initialMetrics.filter(m => m.survey_source === 'ESS').forEach(m => {
    const uploadId = `seed-ess-${m.metric_id}-2025-11`;
    const isRoleClarity = /role clarity/i.test(m.metric_name);
    const shortName = m.metric_name.replace(/\s*\(ESS\)\s*$/i, '');
    const labels = isRoleClarity
      ? ESS_ROLE_CLARITY_QUESTIONS
      : (DEFAULT_METRIC_QUESTIONS[m.metric_id] || []).filter(q => (q.type || 'SCALE_1_5') !== 'FREE_TEXT').map(q => q.text || q.label);
    const orgRows = [[null, ESS_SEED_BANKWIDE_PARTICIPATION], ...ESS_SEED_PARTICIPATION];
    orgRows.forEach(([directorate, participation], i) => {
      let index;
      let scores;
      if (isRoleClarity) {
        [index, ...scores] = ESS_ROLE_CLARITY_ROWS[i];
      } else {
        const base = parseFloat(m.raw_value) || 85;
        index = r2(clamp(i === 0 ? base : base + (((m.metric_id * 7 + i * 13) % 17) - 8) / 2));
        scores = labels.map((_, q) => Math.round(clamp(index + (((q * 5 + i * 3 + m.metric_id) % 7) - 3))));
      }
      results.push({
        upload_id: uploadId,
        metric_id: m.metric_id,
        survey_year: ESS_SEED_PERIOD.year,
        survey_month: ESS_SEED_PERIOD.month,
        org_level: directorate ? 'DIRECTORATE' : 'BANKWIDE',
        directorate,
        participation,
        index_score: index,
        questions: labels.map((label, q) => ({ label, score: scores[q] === undefined ? null : scores[q] }))
      });
    });
    pushUpload(uploadId, m, isRoleClarity ? 'ESS 2025 Result_Role Clarity & DS Support.xlsx' : `ESS 2025 Result_${shortName} (dummy).xlsx`,
      orgRows.length, '2025-11-30T10:00:00.000Z');
  });
  return { results, uploads };
}

const { results: initialEssResults, uploads: initialEssUploads } = generateInitialEssResults();

// Exit Interview demo rows (v2.38.0), source 'SEED_DUMMY'. Generated - deterministically, one seeded PRNG per month - from
// AGGREGATE distributions of the September 2026 "Termination Report" (category frequencies, option labels, score shares)
// and the voluntary-exit totals of the "exit interview dashboard template" deck. No employee row, name or free-text answer
// of that file is copied here. Months January - September 2026; the storage boot top-up inserts a month only while it has
// no exit row at all, and real rows (upload / template import) of a month replace that month's dummy rows.
const EXIT_SEED_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(month => ({ year: 2026, month }));
const EXIT_SEED_ROWS_PER_MONTH = 205; // +/-15% per month
const EXIT_LEAVING_REASONS = [ // [LEAVING REASON, weight] - September 2026 counts
  ['NORMAL_RESIGNATION', 121], ['END_OF_CONTRACT', 33], ['NORMAL_RETIREMENT', 18], ['END_OF_EDUCATION_PROGRAM', 8],
  ['DO_NOT_PASS_PROBATION', 8], ['CANCEL_HIRE', 7], ['PERJANJIAN_BERSAMA', 6], ['DO_NOT_PASS_EDUCATION', 4]
];
const EXIT_RESIGNATION_DETAILS = [ // LEAVING REASON DETAIL of a NORMAL_RESIGNATION - deck totals (Move company 584 split 42:27)
  ['MOVE_COMPANY', 355], ['BETTER_OFFER', 229], ['FAMILY', 164], ['PERSONAL', 155], ['OWN_BUSINESS', 97], ['STUDY', 41],
  ['HEALTH', 21], ['PERFORMANCE_ISSUE', 5]
];
const EXIT_PB_DETAILS = [['NON_COMPLIANCE_PB', 1], ['PERFORMANCE_ISSUE_PB', 1], ['FRAUD_PB', 1]];
const EXIT_GRADES = [['U7', 44], ['U10', 40], ['U8', 32], ['MT', 30], ['U6', 25], ['U9', 18], ['U5', 6], ['U4', 5], ['U1', 2], ['U2', 1], ['U3', 1], ['UNG', 1]];
const EXIT_FINANCIAL_INDUSTRY = 'Perbankan / Asuransi / Keuangan Lainnya';
const EXIT_FINANCIAL_SHARE = 0.666;
const EXIT_OTHER_INDUSTRIES = ['Teknologi Informasi', 'Media / Periklanan', 'Manufaktur', 'Otomotif', 'Ritel', 'Telekomunikasi',
  'Logistik', 'Pendidikan', 'Kesehatan', 'Konsultan', 'Travel & Pariwisata', 'Energi / Pertambangan', 'Properti', 'Wiraswasta'];
const EXIT_FINANCIAL_COMPANIES = [ // standardized legal names, weights ~ the deck's top-10 + a tail of other institutions
  ['PT Bank Danamon Indonesia Tbk', 44], ['PT Bank Maybank Indonesia Tbk', 44], ['PT Bank Permata Tbk', 40], ['PT Bank OCBC NISP Tbk', 21],
  ['PT Bank SMBC Indonesia Tbk', 15], ['PT Bank Sinarmas Tbk', 15], ['PT Bank DBS Indonesia', 12], ['PT Bank Mandiri (Persero) Tbk', 10],
  ['PT Bank Mega Tbk', 9], ['PT Bank UOB Indonesia', 9], ['PT Bank KEB Hana Indonesia', 7], ['PT Bank Central Asia Tbk', 7],
  ['PT Bank Tabungan Negara (Persero) Tbk', 6], ['Citibank N.A. Indonesia', 6], ['PT Bank Rakyat Indonesia (Persero) Tbk', 5],
  ['PT Bank Negara Indonesia (Persero) Tbk', 5], ['PT Bank Syariah Indonesia Tbk', 5], ['PT Bank HSBC Indonesia', 4],
  ['PT Bank Panin Indonesia Tbk', 4], ['PT Bank Jago Tbk', 3], ['PT Asuransi Jiwa Sejahtera (dummy)', 4], ['PT Multifinance Nusantara (dummy)', 4]
];
const EXIT_OTHER_COMPANIES = ['PT Solusi Digital Nusantara (dummy)', 'PT Media Kreasi Indonesia (dummy)', 'PT Manufaktur Jaya Abadi (dummy)',
  'PT Ritel Sejahtera (dummy)', 'PT Logistik Prima (dummy)', 'PT Telekomunikasi Mandala (dummy)', 'PT Konsultan Bisnis Utama (dummy)'];
const EXIT_POSITIONS = ['Relationship Manager', 'Account Officer', 'Credit Analyst', 'Branch Manager', 'Sales Executive', 'Assistant Manager',
  'Manager', 'Senior Officer', 'Officer', 'Analyst', 'Team Leader', 'Supervisor', 'Business Development'];
// Multi-select option labels of the exit form (K, L, M) with the share of answering rows that tick each one.
const EXIT_MOVE_OPTIONS = [
  ['Kompensasi & benefit yang lebih menarik', 0.66], ['Jabatan / posisi lebih tinggi', 0.16], ['Pekerjaan yang lebih sesuai dan disukai', 0.15],
  ['Reputasi perusahaan yang lebih baik', 0.03]
];
// Short neutral answers outside the option list (written for the demo, not taken from the file) -> the "Other" groups.
const EXIT_OTHER_ANSWERS = ['Lokasi kantor lebih dekat', 'Jam kerja lebih fleksibel', 'Waktu lebih banyak untuk keluarga'];
const EXIT_INTERNAL_OPTIONS = [ // N, [label, % when career-positive, % when career-negative]
  ['Kurangnya kesempatan karir', 43, 70], ['Kompensasi & Benefit yang tidak kompetitif', 37, 45], ['Target yang terlalu tinggi', 35, 30],
  ['Pekerjaan yang tidak sesuai', 26, 25], ['Lingkungan kerja yang tidak mendukung', 21, 40], ['Budaya kerja tidak sesuai', 15, 30],
  ['Kurangnya pelatihan & pengembangan', 14, 25], ['Kurangnya penyediaan infrastruktur & fasilitas kerja', 5, 8],
  ['Tidak ada tantangan pekerjaan lagi', 5, 5], ['Konflik internal dengan atasan atau rekan kerja', 4, 20]
];
const EXIT_CAREER_LEVELS = [[1, 2.4], [2, 4.1], [3, 8.0], [4, 24.8], [5, 45.7], [6, 14.9]]; // respondent level 1-6 (deck shares, %)
const EXIT_ANSWER_SHARE = { mover: 0.9, voluntary: 0.75, other: 0.12 }; // share of rows that filled in the questionnaire
// Directorate weights = the ESS participation sizes (+ a floor so that small directorates still have exits most months).
const EXIT_DIRECTORATE_FLOOR = 150;

function mulberry32(seedValue) {
  let a = seedValue >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// directorates: [{ directorate_name, divisions }] (the master); defaults to the seed master.
function generateExitInterviewDummy(directorates = initialDirectorates) {
  const rows = [];
  let seq = 0;
  const dirWeights = (directorates || []).map(d => {
    const ess = ESS_SEED_PARTICIPATION.find(([name]) => seedNamesMatch(name, d.directorate_name));
    return [d, (ess ? ess[1] : 100) + EXIT_DIRECTORATE_FLOOR];
  });
  EXIT_SEED_MONTHS.forEach(({ year, month }) => {
    const rnd = mulberry32(year * 100 + month + 7919);
    const pick = list => { const total = list.reduce((s, x) => s + x[1], 0); let r = rnd() * total; for (const x of list) { r -= x[1]; if (r < 0) return x[0]; } return list[list.length - 1][0]; };
    const one = list => list[Math.floor(rnd() * list.length)];
    const ticks = options => options.filter(([, p]) => rnd() < p).map(([label]) => label);
    const mm = String(month).padStart(2, '0');
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const count = Math.round(EXIT_SEED_ROWS_PER_MONTH * (0.85 + 0.3 * rnd()));
    for (let i = 0; i < count; i++) {
      seq++;
      const reason = pick(EXIT_LEAVING_REASONS);
      const detail = reason === 'NORMAL_RESIGNATION' ? pick(EXIT_RESIGNATION_DETAILS) : (reason === 'PERJANJIAN_BERSAMA' ? pick(EXIT_PB_DETAILS) : reason);
      const voluntary = reason === 'NORMAL_RESIGNATION';
      const mover = voluntary && (detail === 'MOVE_COMPANY' || detail === 'BETTER_OFFER');
      const answered = rnd() < (mover ? EXIT_ANSWER_SHARE.mover : (voluntary ? EXIT_ANSWER_SHARE.voluntary : EXIT_ANSWER_SHARE.other));
      const dir = dirWeights.length ? pick(dirWeights) : null;
      const divisions = dir && Array.isArray(dir.divisions) ? dir.divisions : [];
      const row = {
        upload_id: `seed-exit-${year}-${mm}`,
        nik: `D${String(year).slice(2)}${mm}${String(i + 1).padStart(4, '0')}`,
        employee_name: `Dummy Employee ${String(seq).padStart(4, '0')}`,
        effective_date: `${year}-${mm}-${String(1 + Math.floor(rnd() * lastDay)).padStart(2, '0')}`,
        leaving_reason: reason,
        leaving_reason_detail: detail,
        grade: pick(EXIT_GRADES),
        score_factor: rnd() < 0.45 ? '0' : String(Math.max(30, Math.min(90, Math.round(68 + (rnd() + rnd() + rnd() - 1.5) * 24)))),
        directorate: dir ? dir.directorate_name : null,
        division: divisions.length && rnd() < 0.85 ? one(divisions) : null,
        destination_industry: null, new_company: null, new_company_std: null, new_position: null,
        pull_factors: null, improve_factors: null, new_company_offers: null, internal_factors: null,
        career_scores: null, alumni_network: null, privacy_consent: null, recommend: null, suggestions: null,
        source: 'SEED_DUMMY'
      };
      if (answered) {
        const level = pick(EXIT_CAREER_LEVELS);
        const negative = level <= 3;
        row.career_scores = Array.from({ length: 15 }, (_, q) => {
          const r = rnd();
          let s = level + (r < 0.2 ? -1 : (r > 0.8 ? 1 : 0));
          if (q === 1 && rnd() < 0.35) s -= 1; // statement 2 (fair promotion) runs a little lower
          return Math.max(1, Math.min(6, s));
        });
        const multi = options => { const t = ticks(options); if (rnd() < 0.07) t.push(one(EXIT_OTHER_ANSWERS)); return (t.length ? t : [one(options)[0]]).join(' | '); };
        if (mover) {
          if (rnd() < 0.95) {
            const financial = rnd() < EXIT_FINANCIAL_SHARE;
            row.destination_industry = financial ? EXIT_FINANCIAL_INDUSTRY : one(EXIT_OTHER_INDUSTRIES);
            row.new_company = rnd() < 0.05 ? null : (financial ? pick(EXIT_FINANCIAL_COMPANIES) : one(EXIT_OTHER_COMPANIES));
            row.new_company_std = row.new_company;
          }
          row.new_position = rnd() < 0.9 ? one(EXIT_POSITIONS) : null;
          row.pull_factors = multi(EXIT_MOVE_OPTIONS);
          row.new_company_offers = multi(EXIT_MOVE_OPTIONS);
        } else if (voluntary && rnd() < 0.25) {
          row.destination_industry = one(EXIT_OTHER_INDUSTRIES);
        }
        row.improve_factors = multi(EXIT_MOVE_OPTIONS);
        const internal = EXIT_INTERNAL_OPTIONS.map(([label, pos, neg]) => [label, (negative ? neg : pos) / 100]);
        const picked = ticks(internal);
        row.internal_factors = (picked.length ? picked : [EXIT_INTERNAL_OPTIONS[0][0]]).join(' | ');
        row.alumni_network = rnd() < 0.84 ? 'Yes' : 'No';
        row.privacy_consent = 'Yes';
        row.recommend = rnd() < (negative ? 0.7 : 0.95) ? 'Yes' : 'No';
      }
      rows.push(row);
    }
  });
  return rows;
}
const initialExitInterviews = generateExitInterviewDummy();

// A deterministic directorate (+ division) for one numeric key - e.g. a row number of the real September template, which
// has no directorate column (scripts/import-exit-template.js). Same weights as the demo rows above.
function exitDummyOrgUnit(directorates, key) {
  const list = (directorates && directorates.length ? directorates : initialDirectorates).map(d => {
    const ess = ESS_SEED_PARTICIPATION.find(([name]) => seedNamesMatch(name, d.directorate_name));
    return [d, (ess ? ess[1] : 100) + EXIT_DIRECTORATE_FLOOR];
  });
  const rnd = mulberry32((parseInt(key, 10) || 0) * 7919 + 104729);
  const total = list.reduce((s, x) => s + x[1], 0);
  let r = rnd() * total;
  let dir = list[list.length - 1][0];
  for (const x of list) { r -= x[1]; if (r < 0) { dir = x[0]; break; } }
  const divisions = Array.isArray(dir.divisions) ? dir.divisions : [];
  return { directorate: dir.directorate_name, division: divisions.length && rnd() < 0.85 ? divisions[Math.floor(rnd() * divisions.length)] : null };
}

// Per-metric operational drilldown records for OUTCOME metrics whose "raw data" is an internal
// HR operational breakdown table (not individual survey responses) — e.g. approval-stage
// compliance, hiring channel mix, recognition categories, attrition by tenure. Seeded here (like
// every other demo dataset in this file) so it lives in the database layer and is admin-editable
// in principle, instead of being frozen directly inside calculationEngine.js's business logic.
// v2.52.0: metric 1 no longer has recruitment-SLA rows per unit (wrong data for a bankwide social media metric); its
// records are the social media statistics below (px_social_media_stats).
const initialOperationalRecords = {
  3: [
    { stage: 'Directorate Head Approval', avg_sla_hours: 36, sla_target_hours: 48, compliance: '94.5%' },
    { stage: 'Talent Acquisition Review', avg_sla_hours: 24, sla_target_hours: 24, compliance: '96.0%' },
    { stage: 'Total Rewards Compensation Review', avg_sla_hours: 28, sla_target_hours: 48, compliance: '93.2%' }
  ],
  4: [
    { channel: 'CIMB Niaga Careers Official Website', hires_count: 95, percentage: '39.6%', quality_score: '88.5%' },
    { channel: 'LinkedIn Talent Solutions', hires_count: 82, percentage: '34.2%', quality_score: '86.0%' },
    { channel: 'Jobstreet / Job Portals', hires_count: 42, percentage: '17.5%', quality_score: '80.0%' },
    { channel: 'Employee Referral Program (Teman Baru)', hires_count: 21, percentage: '8.7%', quality_score: '92.0%' }
  ],
  14: [
    { category: 'Bravo! Peer-to-Peer Recognition', recipient_count: 2840, points_awarded: '142,000 pts', source: 'Arjuna Recognition' },
    { category: 'Shining Star Quarterly Award', recipient_count: 980, points_awarded: '98,000 pts', source: 'Arjuna Recognition' },
    { category: 'Long Service & Milestone Recognition', recipient_count: 510, points_awarded: '51,000 pts', source: 'Arjuna HRIS' }
  ],
  25: [
    { tenure_bracket: 'Month 1 - 2 (Onboarding & Probation)', attrition_count: 12, rate: '1.2%', benchmark: '< 2.0%' },
    { tenure_bracket: 'Month 3 - 4 (Initial Assignment)', attrition_count: 18, rate: '1.8%', benchmark: '< 2.0%' },
    { tenure_bracket: 'Month 5 - 6 (Probation Review)', attrition_count: 12, rate: '1.2%', benchmark: '< 2.0%' }
  ]
};

// Social media statistics of metric 1 (v2.52.0), source 'SEED': FICTIONAL monthly Instagram / LinkedIn / TikTok numbers
// (followers at month end, reach and engagement of the month) for January - September 2026, so the metric-1 drilldown has
// something to show before real data is uploaded (.xlsx). Deterministic (one seeded PRNG per
// platform). The storage boot top-up adds a (platform, month) only while it has no row and the month has no real row; real
// rows (UPLOAD) of a month replace that month's seed rows. The score of metric 1 stays the Admin's raw_value.
const SOCIAL_MEDIA_SEED_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(month => ({ year: 2026, month }));
const SOCIAL_MEDIA_SEED_PROFILES = [ // [platform, followers in Dec 2025, monthly follower growth range, reach / followers, engagement / reach]
  ['Instagram', 182000, [0.012, 0.024], [1.8, 2.6], [0.032, 0.046]],
  ['LinkedIn', 405000, [0.008, 0.016], [0.9, 1.4], [0.018, 0.027]],
  ['TikTok', 46500, [0.035, 0.065], [4.0, 6.5], [0.055, 0.085]]
];

function generateSocialMediaSeed(months = SOCIAL_MEDIA_SEED_MONTHS) {
  const rows = [];
  SOCIAL_MEDIA_SEED_PROFILES.forEach(([platform, start, growth, reachRatio, engRate], p) => {
    const rnd = mulberry32(52000 + p);
    const between = ([lo, hi]) => lo + (hi - lo) * rnd();
    let followers = start;
    months.forEach(({ year, month }) => {
      followers = Math.round(followers * (1 + between(growth)));
      const reach = Math.round(followers * between(reachRatio));
      rows.push({ platform, year, month, followers, reach, engagement: Math.round(reach * between(engRate)) });
    });
  });
  return rows;
}

// Admin-managed UI values (px_app_settings). Seeded once, then read from the database only.
const initialAppSettings = {
  // Option catalogs for Parameter Admin / Survey Questions. Only the LABELS are editable: the
  // values drive calculation logic (normalisation, reminders, who is an "employee" metric...).
  metric_types: {
    value: [
      { value: 'SURVEY', label: 'SURVEY (Respondent Responses)' },
      { value: 'OUTCOME', label: 'OUTCOME (Operational HR Data)' }
    ],
    description: 'Pilihan Tipe Metrik di Parameter Admin'
  },
  scale_types: {
    value: [
      { value: 'RATING_5', label: 'Rating Scale 1.0 - 5.0' },
      { value: 'PERCENTAGE', label: 'Percentage (0 - 100%)' },
      { value: 'QUOTA_COUNT', label: 'Quota Count / Numeric' }
    ],
    description: 'Pilihan Skala Penilaian di Parameter Admin'
  },
  target_audiences: {
    value: [
      { value: 'EMPLOYEE', label: 'Internal CIMB Niaga Employees' },
      { value: 'CAMPUS_STUDENTS', label: 'Campus Students (CIMB Goes to Campus)' },
      { value: 'JOB_APPLICANTS', label: 'Job Applicant Candidates (Candidate Exp)' },
      { value: 'EXTERNAL_MARKET', label: 'External Market / Public' }
    ],
    description: 'Pilihan Target Responden di Parameter Admin'
  },
  update_frequencies: {
    value: [
      { value: 'MONTHLY', label: 'Monthly (Periodic Update Every Month)' },
      { value: 'ONE_TIME_ANNUAL', label: 'Annual (One Upload for the Full Year)' }
    ],
    description: 'Pilihan Frekuensi Update Data di Parameter Admin'
  },
  question_types: {
    value: [
      { value: 'SCALE_1_5', label: '1. Scale 1 - 5 (Rating 1.0 to 5.0)', desc: 'Score rating 1 to 5, normalized as (score/5)*100' },
      { value: 'SCALE_1_10', label: '2. Scale 1 - 10 (Rating 1.0 to 10.0)', desc: 'Score rating 1 to 10, normalized as (score/10)*100' },
      { value: 'YES_NO', label: '3. Yes / No Binary (Score 100 / 0)', desc: 'Binary choice: Yes = 100%, No = 0%' },
      { value: 'FREE_TEXT', label: '4. Free Text Response (Qualitative / Feedback)', desc: 'Open text feedback without numeric scale' },
      { value: 'PERCENTAGE', label: 'Percentage (0–100%)', desc: 'Score 0 to 100 (%), used as is (every question of an ESS metric)' }
    ],
    description: 'Pilihan Tipe Pertanyaan di Survey Questions'
  },
  reminder_send_hour: { value: 8, description: 'Jam (0-23, waktu server) mulai pengiriman otomatis email reminder upload survei ke PIC' },
  reminder_repeat_days: { value: 1, description: 'Ulangi reminder setiap N hari sampai data diupload (0 = hanya satu kali pada tanggal batas)' },
  // Login & akses (v2.26.0)
  session_hours: { value: 8, description: 'Masa berlaku sesi login (jam) sejak login' },
  login_max_attempts: { value: 5, description: 'Jumlah gagal login berturut-turut sebelum akun dikunci sementara' },
  login_lockout_minutes: { value: 15, description: 'Lama penguncian akun (menit) setelah gagal login berulang' },
  login_rate_limit_per_minute: { value: 20, description: 'Batas percobaan login GAGAL per alamat IP per menit' },
  // v2.44.0: sesi diakhiri otomatis bila tidak ada aktivitas pengguna selama N menit (1-120)
  session_idle_timeout_minutes: { value: 5, description: 'Logout otomatis setelah N menit tanpa aktivitas pengguna (1-120)' },
  // v2.51.0: set to true by the first change in Admin Parameters -> Directorates. From then on the Admin owns the
  // directorate master and the boot never adds seed directorates / divisions again (a renamed, merged or deleted one
  // would otherwise come back). Not editable through PUT /api/admin/settings.
  directory_admin_managed: { value: false, description: 'Direktori direktorat dikelola Admin (Admin Parameters -> Directorates): boot tidak lagi menambah direktorat/divisi seed' },
  event_manager_directorates: {
    value: [{ value: 'Human Resources', label: 'Human Resources' }],
    description: 'Direktorat yang pengguna (role User)-nya boleh mengelola Signature Event (Admin selalu boleh)'
  },
  px_index_target: { value: 85, description: 'Target PX Index (%) — garis target pada Performance Trend chart' },
  // v2.48.0: bobot PX Index (bilangan bulat 0-100, jumlah harus 100) — Admin Parameters -> Index Weights
  px_index_weights: { value: { survey: 70, outcome: 30 }, description: 'Bobot PX Index: % Survey Index + % Outcome Index (jumlah 100)' },
  event_program_categories: {
    value: [
      { value: 'Perspektif', label: 'Perspektif' },
      { value: 'D&I', label: 'D&I (Diversity & Inclusion)' },
      { value: 'Young', label: 'Young CIMB' },
      { value: 'EVD', label: 'EVD (Employee Value & Development)' },
      { value: 'Special Program', label: 'Special Program' }
    ],
    description: 'Pilihan kategori program pada form Create Signature Event'
  },
  event_types: {
    value: [
      { value: 'HYBRID', label: 'Hybrid (Onsite + Online)' },
      { value: 'OFFLINE', label: 'Offline / In-Person' },
      { value: 'ONLINE', label: 'Online Streaming (Zoom / Teams)' }
    ],
    description: 'Pilihan format pelaksanaan pada form Create Signature Event'
  },
  // Exit Interview dashboard (v2.38.0) - rule-based grouping of the answers, no AI. Every list is { value, label }:
  // value = a keyword/phrase that must appear at the START of a word in the answer (case, punctuation and extra spaces
  // ignored), label = the group it counts for. One answer may hit several groups; the longest keyword is tried first.
  exit_interview_k_factors: {
    value: [
      { value: 'kompensasi', label: 'Compensation' },
      { value: 'benefit', label: 'Compensation' },
      { value: 'jabatan', label: 'Position' },
      { value: 'posisi lebih tinggi', label: 'Position' },
      { value: 'pekerjaan yang lebih sesuai', label: 'Job' },
      { value: 'reputasi', label: 'Reputation' }
    ],
    description: 'Exit Interview kartu 4 (kolom K): kata kunci -> faktor penarik (Compensation / Position / Job / Reputation); jawaban lain = Other'
  },
  exit_interview_m_themes: {
    value: [
      { value: 'kompensasi', label: 'Compensation & benefits' },
      { value: 'benefit', label: 'Compensation & benefits' },
      { value: 'gaji', label: 'Compensation & benefits' },
      { value: 'salary', label: 'Compensation & benefits' },
      { value: 'insentif', label: 'Compensation & benefits' },
      { value: 'bonus', label: 'Compensation & benefits' },
      { value: 'tunjangan', label: 'Compensation & benefits' },
      { value: 'jabatan', label: 'Higher position' },
      { value: 'posisi lebih tinggi', label: 'Higher position' },
      { value: 'promosi', label: 'Higher position' },
      { value: 'pekerjaan yang lebih sesuai', label: 'Better-fit job' },
      { value: 'jobdesk', label: 'Better-fit job' },
      { value: 'fleksib', label: 'Better-fit job' },
      { value: 'work life', label: 'Better-fit job' },
      { value: 'reputasi', label: 'Company reputation' },
      { value: 'lokasi', label: 'Location / commute' },
      { value: 'jarak', label: 'Location / commute' },
      { value: 'dekat', label: 'Location / commute' },
      { value: 'domisili', label: 'Location / commute' },
      { value: 'keluarga', label: 'Family & personal' },
      { value: 'family', label: 'Family & personal' },
      { value: 'menikah', label: 'Family & personal' },
      { value: 'pribadi', label: 'Family & personal' },
      { value: 'personal', label: 'Family & personal' },
      { value: 'kesehatan', label: 'Family & personal' }
    ],
    description: 'Exit Interview slide 2 A (kolom M, apa yang ditawarkan perusahaan baru): kata kunci -> tema; jawaban lain = Other'
  },
  exit_interview_n_themes: {
    value: [
      { value: 'kurangnya kesempatan karir', label: 'Career progression & certainty' },
      { value: 'karir', label: 'Career progression & certainty' },
      { value: 'karier', label: 'Career progression & certainty' },
      { value: 'jenjang', label: 'Career progression & certainty' },
      { value: 'promosi', label: 'Career progression & certainty' },
      { value: 'kompensasi', label: 'Compensation & recognition' },
      { value: 'benefit', label: 'Compensation & recognition' },
      { value: 'gaji', label: 'Compensation & recognition' },
      { value: 'insentif', label: 'Compensation & recognition' },
      { value: 'penghargaan', label: 'Compensation & recognition' },
      { value: 'apresiasi', label: 'Compensation & recognition' },
      { value: 'konflik', label: 'Leadership, fairness & voice' },
      { value: 'atasan', label: 'Leadership, fairness & voice' },
      { value: 'leadership', label: 'Leadership, fairness & voice' },
      { value: 'pimpinan', label: 'Leadership, fairness & voice' },
      { value: 'lingkungan kerja', label: 'Work environment & culture' },
      { value: 'budaya', label: 'Work environment & culture' },
      { value: 'pelatihan', label: 'Learning & development' },
      { value: 'pengembangan', label: 'Learning & development' },
      { value: 'training', label: 'Learning & development' },
      { value: 'sertifikasi', label: 'Learning & development' },
      { value: 'infrastruktur', label: 'Processes, tools & facilities' },
      { value: 'fasilitas', label: 'Processes, tools & facilities' },
      { value: 'prosedur', label: 'Processes, tools & facilities' },
      { value: 'sistem', label: 'Processes, tools & facilities' },
      { value: 'target', label: 'Workload, targets & role fit' },
      { value: 'pekerjaan yang tidak sesuai', label: 'Workload, targets & role fit' },
      { value: 'workload', label: 'Workload, targets & role fit' },
      { value: 'beban kerja', label: 'Workload, targets & role fit' },
      { value: 'lembur', label: 'Workload, targets & role fit' },
      { value: 'tantangan', label: 'Workload, targets & role fit' }
    ],
    description: 'Exit Interview slide 2 B (kolom N, faktor internal): kata kunci -> tema; jawaban lain = Other'
  },
  exit_interview_company_aliases: {
    value: [
      { value: 'danamon', label: 'PT Bank Danamon Indonesia Tbk' },
      { value: 'maybank', label: 'PT Bank Maybank Indonesia Tbk' },
      { value: 'may bank', label: 'PT Bank Maybank Indonesia Tbk' },
      { value: 'permata', label: 'PT Bank Permata Tbk' },
      { value: 'ocbc', label: 'PT Bank OCBC NISP Tbk' },
      { value: 'smbc', label: 'PT Bank SMBC Indonesia Tbk' },
      { value: 'btpn syariah', label: 'PT Bank BTPN Syariah Tbk' },
      { value: 'btpn', label: 'PT Bank SMBC Indonesia Tbk' },
      { value: 'sinarmas', label: 'PT Bank Sinarmas Tbk' },
      { value: 'dbs', label: 'PT Bank DBS Indonesia' },
      { value: 'mandiri', label: 'PT Bank Mandiri (Persero) Tbk' },
      { value: 'bank mega', label: 'PT Bank Mega Tbk' },
      { value: 'uob', label: 'PT Bank UOB Indonesia' },
      { value: 'oub', label: 'PT Bank UOB Indonesia' },
      { value: 'hana bank', label: 'PT Bank KEB Hana Indonesia' },
      { value: 'keb hana', label: 'PT Bank KEB Hana Indonesia' },
      { value: 'bank tabungan negara', label: 'PT Bank Tabungan Negara (Persero) Tbk' },
      { value: 'btn', label: 'PT Bank Tabungan Negara (Persero) Tbk' },
      { value: 'citibank', label: 'Citibank N.A. Indonesia' },
      { value: 'citi bank', label: 'Citibank N.A. Indonesia' },
      { value: 'mufg', label: 'MUFG Bank, Ltd. Jakarta Branch' },
      { value: 'panin dubai syariah', label: 'PT Bank Panin Dubai Syariah Tbk' },
      { value: 'panin', label: 'PT Bank Panin Indonesia Tbk' },
      { value: 'krom bank', label: 'PT Krom Bank Indonesia Tbk' },
      { value: 'bank central asia', label: 'PT Bank Central Asia Tbk' },
      { value: 'bca', label: 'PT Bank Central Asia Tbk' },
      { value: 'bank rakyat indonesia', label: 'PT Bank Rakyat Indonesia (Persero) Tbk' },
      { value: 'bri', label: 'PT Bank Rakyat Indonesia (Persero) Tbk' },
      { value: 'bank negara indonesia', label: 'PT Bank Negara Indonesia (Persero) Tbk' },
      { value: 'bni', label: 'PT Bank Negara Indonesia (Persero) Tbk' },
      { value: 'bank syariah indonesia', label: 'PT Bank Syariah Indonesia Tbk' },
      { value: 'bsi', label: 'PT Bank Syariah Indonesia Tbk' },
      { value: 'hsbc', label: 'PT Bank HSBC Indonesia' },
      { value: 'standard chartered', label: 'Standard Chartered Bank Indonesia' },
      { value: 'bank jago', label: 'PT Bank Jago Tbk' },
      { value: 'seabank', label: 'PT Bank Seabank Indonesia' }
    ],
    description: 'Exit Interview kartu 3 (kolom I): kata kunci nama perusahaan -> nama legal standar; nama lain dipakai apa adanya'
  },
  exit_interview_none_answers: {
    value: [
      { value: 'tidak ada', label: 'No answer' },
      { value: 'tidak', label: 'No answer' },
      { value: 'na', label: 'No answer' },
      { value: 'n a', label: 'No answer' },
      { value: 'none', label: 'No answer' },
      { value: 'nihil', label: 'No answer' },
      { value: 'no', label: 'No answer' },
      { value: 'tidak juga', label: 'No answer' },
      { value: 'tidak bisa saya sebutkan', label: 'No answer' },
      { value: 'confidential', label: 'No answer' },
      { value: 'rahasia', label: 'No answer' },
      { value: 'confidence', label: 'No answer' },
      { value: 'perbankan swasta', label: 'No answer' },
      { value: 'tidak pindah*', label: 'Not moving' },
      { value: 'berhenti tidak karena*', label: 'Not moving' },
      { value: 'belum bekerja*', label: 'Not moving' },
      { value: 'belum mendapatkan pekerjaan*', label: 'Not moving' },
      { value: 'not moving*', label: 'Not moving' }
    ],
    description: 'Exit Interview: jawaban yang dianggap "tidak menjawab" (sama persis; akhiran * = diawali frasa itu); "-" dan kosong selalu tidak menjawab'
  }
};

// v2.30.0: the option labels above were Indonesian before. A boot top-up (both backends) replaces a label ONLY when it
// is still exactly the old Indonesian default, so an admin's own edit is never overwritten. Values never change.
const LEGACY_OPTION_LABELS = {
  metric_types: { SURVEY: 'SURVEY (Koresponden Respon)' },
  scale_types: {
    RATING_5: 'Rating Skala 1.0 - 5.0',
    PERCENTAGE: 'Persentase (0 - 100%)',
    QUOTA_COUNT: 'Quota Count / Numerik'
  },
  target_audiences: {
    EMPLOYEE: 'Karyawan Internal CIMB Niaga',
    CAMPUS_STUDENTS: 'Mahasiswa Kampus (CIMB Goes to Campus)',
    JOB_APPLICANTS: 'Kandidat Pelamar Kerja (Candidate Exp)',
    EXTERNAL_MARKET: 'Eksternal Market / Public'
  },
  update_frequencies: {
    MONTHLY: 'Bulanan (Update Berkala Tiap Bulan)',
    ONE_TIME_ANNUAL: 'Tahunan (Sekali Upload untuk Full Year)'
  }
};

// Returns the upgraded option list for `settingKey`, or null when nothing needs to change.
// v2.50.0: option values added to a value-locked catalog after it was first seeded (only the labels of these catalogs
// are admin-editable, so a new value can only arrive through the boot). Appends the missing default options; null when
// nothing is missing.
const ADDED_OPTION_VALUES = { question_types: ['PERCENTAGE'] };

// v2.54.0: seed metrics that are scored by tiers (their score_tiers in initialMetrics). The boot gives an existing database
// the tier configuration ONCE, only while the metric has none yet (score_tiers NULL), so a later Admin edit is never
// overwritten. raw_value / target are replaced only while they are still the old seed values (approved by the user:
// metric 14 4,330 -> 6,400 recognised employees; targets metric 1 85 -> 2%, metric 3 80% -> 70%).
const SCORE_TIER_UPGRADES = {
  1: { target: { from: 85, to: 2, display: '2%' } },
  2: {},
  3: { target: { from: 80, to: 70, display: '> 70%' } },
  14: { raw: { from: 4330, to: 6400 } }
};
function addMissingOptions(settingKey, currentValue) {
  const wanted = ADDED_OPTION_VALUES[settingKey];
  const target = initialAppSettings[settingKey];
  if (!wanted || !target || !Array.isArray(currentValue)) return null;
  const missing = target.value.filter(o => wanted.includes(o.value) && !currentValue.some(c => c && c.value === o.value));
  return missing.length ? [...currentValue, ...missing.map(o => ({ ...o }))] : null;
}

function upgradeLegacyOptionLabels(settingKey, currentValue) {
  const legacy = LEGACY_OPTION_LABELS[settingKey];
  const target = initialAppSettings[settingKey];
  if (!legacy || !target || !Array.isArray(currentValue)) return null;
  let changed = false;
  const next = currentValue.map(opt => {
    if (!opt || legacy[opt.value] === undefined || opt.label !== legacy[opt.value]) return opt;
    const fresh = target.value.find(o => o.value === opt.value);
    if (!fresh) return opt;
    changed = true;
    return { ...opt, label: fresh.label };
  });
  return changed ? next : null;
}

// Default sender settings for the reminder e-mails (px_email_settings, single row). No account and
// no password here — the admin fills those in the "Setting Email" menu.
const initialEmailSettings = {
  enabled: false,
  provider: 'GMAIL',
  smtp_host: 'smtp.gmail.com',
  smtp_port: 465,
  smtp_secure: true,
  smtp_user: '',
  smtp_password_enc: '',
  from_name: 'People Experience CIMB Niaga',
  from_email: ''
};

// v2.55.0: composite SUMMARY metrics - metric 7 "Day 1 Onboarding Satisfaction Index" is the average of its parts (each part:
// the average of its uploaded monthly summary values, 1-5). Written to px_metric_parts once (boot: only while the metric has no
// part). template = the columns of the part's summary file (the user's templates in docs/Template Survey/), used for the
// template download; a part without a known file layout gets the generic Directorate | Level | Year | Month | Score | Q1.. layout.
// v2.57.0: the part's configured questions (Admin Parameters -> Summary Questions) are seeded once from its latest upload, else from
// template.question_labels (+ question_types), else none.
const initialMetricParts = [
  {
    metric_id: 7, part_key: 'MEET_GREET', part_name: 'Meet and Greet Satisfaction', sort_order: 1,
    template: {
      score_label: 'Meet & Greet',
      question_labels: [
        'Sesi Meet & Greet berlangsung dengan terorganisir dan lancar?',
        'Durasi sesi sudah sesuai dengan kebutuhan saya sebagai karyawan baru?',
        'Materi dan aktivitas yang diberikan selama sesi berjalan dengan baik?',
        'Sesi ini membantu saya memahami CIMB Niaga terkait budaya, nilai-nilai, cara kerja serta informasi penting yang perlu saya ketahui sebagai karyawan baru?',
        'Setelah mengikuti sesi ini, saya merasa siap untuk memulai perjalanan saya di CIMB Niaga',
        'Fasilitator menyampaikan materi dengan jelas dan menarik.',
        'Fasilitator menguasai materi yang disampaikan.',
        'Fasilitator menciptakan suasana yang nyaman dan interaktif.',
        'Fasilitator memberikan kesempatan yang cukup untuk bertanya atau berdiskusi.',
        'Fasilitator menjawab pertanyaan peserta dengan baik.',
        'Secara keseluruhan, saya puas dengan pelaksanaan sesi Meet & Greet'
      ],
      respondents_label: 'Jumlah Responden',
      period_label: 'Periode (Tanggal Absen)'
    }
  },
  { metric_id: 7, part_key: 'WELCOME_SESSION', part_name: 'Welcome Session', sort_order: 2, template: null },
  {
    metric_id: 7, part_key: 'DAY1_SURVEY', part_name: 'Onboarding Survey Day 1', sort_order: 3,
    template: {
      score_label: 'Onboarding Survey Day 1',
      // v2.57.0: the user's current file (3 questions; the recruitment / interview questions moved to metric 5). question_types = the
      // seed of the part's Summary Questions (question 2 is a free-text answer, never scored)
      question_labels: [
        '1.How was your overall first day of work experience?',
        '2.What makes you interested in joining CIMB Niaga?',
        '3.How was your experience with the Meet & Greet session at CIMB Niaga?'
      ],
      question_types: ['SCALE', 'TEXT', 'SCALE'],
      respondents_label: 'Jumlah Responden',
      period_label: 'Periode (Join Date)'
    }
  },
  { metric_id: 7, part_key: 'INFRA_APP', part_name: 'Infrastructure & Application', sort_order: 4, template: null },
  // metric 12 "Signature Program event satisfaction": one part, its score is ALREADY a percentage (score_scale PERCENT); the file
  // has an event block per Signature Program event (event score column with a blue header + its 3 questions)
  {
    metric_id: 12, part_key: 'EVENT_SATISFACTION', part_name: 'Signature Program Event Satisfaction', sort_order: 1,
    template: {
      score_label: 'Satisfaction Event',
      score_scale: 'PERCENT',
      question_labels: ['EPICC Podcast', 'Perspektif', 'DLC', 'Young', 'EVD'].flatMap(e => [e,
        'Saya mendapatkan makna dari pelaksanaan event ini.',
        'Saya bersedia untuk hadir kembali di penyelenggaraan event ini berikutnya.',
        'Saya bersedia merekomendasikan event ini kepada orang yang saya kenal.']),
      event_labels: ['EPICC Podcast', 'Perspektif', 'DLC', 'Young', 'EVD'],
      respondents_label: 'Jumlah Responden Valid',
      period_label: 'Periode (Start time)',
      period_before_respondents: true
    }
  },
  // metrics 19 / 20 (OUTCOME): one part each, read from ONE combined file ("Mandatory & Non Mandatory Learning_PX.xlsx", sheet
  // "Score": Directorate | Level | Year | Month | Mandatory Learning | Non Mandatory Learning) - score_column = the column of this
  // metric (matched by header text), no respondents column (respondents_column false), no question columns
  {
    metric_id: 19, part_key: 'MANDATORY_LEARNING', part_name: 'Mandatory Learning', sort_order: 1,
    template: { score_label: 'Mandatory Learning', score_column: 'Mandatory Learning', respondents_column: false, question_labels: [] }
  },
  {
    metric_id: 20, part_key: 'NON_MANDATORY_LEARNING', part_name: 'Non Mandatory Learning', sort_order: 1,
    template: { score_label: 'Non Mandatory Learning', score_column: 'Non Mandatory Learning', respondents_column: false, question_labels: [] }
  },
  // metric 5 "Candidate Experience Survey Score": one part (the user's "Candidate Experience Survey Score Template.xlsx")
  {
    metric_id: 5, part_key: 'CANDIDATE_EXPERIENCE', part_name: 'Candidate Experience Survey', sort_order: 1,
    template: {
      score_label: 'Candidate Experience Survey',
      question_labels: [
        '1.How was your overall recruitment experience from being contacted by the Recruiter until signing the agreement?',
        '2.How would you rate your interview experience with the Business Unit?'
      ],
      respondents_label: 'Jumlah Responden',
      period_label: 'Periode (Join Date)'
    }
  }
];

// v2.55.0: the configuration a metric gets ONCE, when the boot gives it its summary parts - only where the values are still the
// old seed values (an Admin's later edit is never overwritten). Metric 12's summary score is a percentage, not a 1-5 rating.
const METRIC_PART_UPGRADES = {
  12: { scale_type: { from: 'RATING_5', to: 'PERCENTAGE' }, unit: { from: '/ 5', to: '%' }, target: { from: 4, to: 80, display: '> 80%' } }
};

module.exports = {
  initialMetricParts,
  METRIC_PART_UPGRADES,
  initialAppSettings,
  LEGACY_OPTION_LABELS,
  upgradeLegacyOptionLabels,
  ADDED_OPTION_VALUES,
  SCORE_TIER_UPGRADES,
  addMissingOptions,
  ESS_REMOVED_DUMMY_PERIODS,
  isRemovedEssDummyUpload,
  initialEmailSettings,
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
  SOCIAL_MEDIA_SEED_MONTHS,
  generateSocialMediaSeed,
  EXIT_SEED_MONTHS,
  generateExitInterviewDummy,
  exitDummyOrgUnit,
  initialExitInterviews
};

