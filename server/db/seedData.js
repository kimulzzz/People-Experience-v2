// server/db/seedData.js
// Master Data for CIMB Niaga People Experience Framework

const initialJourneys = [
  {
    journey_id: 1,
    journey_code: 'ARRIVAL',
    journey_name: 'Arrival',
    tagline: 'Attract and onboard the right talent seamlessly, creating a strong and positive first impression.',
    color: '#FF8000', // CIMB Bright Orange (R:255 G:128 B:0)
    icon: 'UserPlus',
    display_order: 1
  },
  {
    journey_id: 2,
    journey_code: 'CONNECT',
    journey_name: 'Connect',
    tagline: 'Build early trust and alignment through clear role, expectations, and team connection.',
    color: '#F7901E', // CIMB Amber Orange (R:247 G:144 B:30)
    icon: 'Users',
    display_order: 2
  },
  {
    journey_id: 3,
    journey_code: 'BELONG',
    journey_name: 'Belong',
    tagline: 'Foster emotional connection, inclusion, psychological safety, and a strong sense of belonging.',
    color: '#6716C4', // CIMB Royal Purple (R:103 G:22 B:196)
    icon: 'HeartHandshake',
    display_order: 3
  },
  {
    journey_id: 4,
    journey_code: 'CONTRIBUTE',
    journey_name: 'Contribute',
    tagline: 'Enable employees to perform, grow and create meaningful impact.',
    color: '#16C0B7', // CIMB Digital Teal (R:22 G:192 B:183)
    icon: 'TrendingUp',
    display_order: 4
  },
  {
    journey_id: 5,
    journey_code: 'DEPART',
    journey_name: 'Depart',
    tagline: 'Ensure a smooth, respectful, and positive exit experience.',
    color: '#C1009D', // CIMB Magenta (R:193 G:0 B:157)
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

const initialMetrics = [
  // --- ARRIVAL (7 metrics) ---
  {
    metric_id: 1,
    journey_id: 1,
    checkpoint_id: 1,
    metric_name: 'Career website & social media follower, reach & engagement growth',
    metric_type: 'OUTCOME',
    scale_type: 'NUMERIC',
    source_of_data: 'Website & Social Media Analytics',
    experience_owner: 'Talent Partnership',
    target_value: 85.00,
    target_display: '> 85',
    min_threshold: 80.00,
    raw_value: 85.00,
    normalized_score: 85.00,
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
    source_of_data: 'Internal Report (Talent Partnership)',
    experience_owner: 'Talent Partnership',
    target_value: 80.00,
    target_display: 'Target TBC (80%)',
    min_threshold: 70.00,
    raw_value: 80.00,
    normalized_score: 80.00,
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
    source_of_data: 'Arjuna (Recognition Module)',
    experience_owner: 'PXCWB',
    target_value: 5000.00,
    target_display: 'min 5,000 / yr',
    min_threshold: 75.00,
    raw_value: 4330.00,
    normalized_score: 87.00,
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
];

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
  { attendance_id: 1, event_id: 'ev-perspektif-2024-q1', nip: '8801923', employee_name: 'Ahmad Fauzi', cimb_email: 'ahmad.fauzi@cimbniaga.co.id', directorate: 'Information Technology', division: 'Core Banking Solution', attendance_timestamp: '2026-03-15T08:45:00.000Z' },
  { attendance_id: 2, event_id: 'ev-perspektif-2024-q1', nip: '8802341', employee_name: 'Siti Rahmawati', cimb_email: 'siti.rahmawati@cimbniaga.co.id', directorate: 'Human Resources', division: 'People Experience & Culture', attendance_timestamp: '2026-03-15T08:50:00.000Z' },
  { attendance_id: 3, event_id: 'ev-perspektif-2024-q1', nip: '8804552', employee_name: 'Budi Santoso', cimb_email: 'budi.santoso@cimbniaga.co.id', directorate: 'Consumer Banking', division: 'Branch Banking Region 1', attendance_timestamp: '2026-03-15T08:55:00.000Z' },
  { attendance_id: 4, event_id: 'ev-perspektif-2024-q1', nip: '8807890', employee_name: 'Dewi Lestari', cimb_email: 'dewi.lestari@cimbniaga.co.id', directorate: 'Risk Management', division: 'Credit Risk Operations', attendance_timestamp: '2026-03-15T09:02:00.000Z' },
  { attendance_id: 5, event_id: 'ev-perspektif-2024-q1', nip: '8809112', employee_name: 'Rian Pratama', cimb_email: 'rian.pratama@cimbniaga.co.id', directorate: 'Digital Banking', division: 'OCTO Mobile Product', attendance_timestamp: '2026-03-15T09:05:00.000Z' }
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

const initialDirectorates = [
  {
    directorate_name: 'Information Technology',
    divisions: [
      'Application Development',
      'IT Infrastructure & Operations',
      'IT Security & Governance',
      'Core Banking & Digital Solutions'
    ]
  },
  {
    directorate_name: 'Consumer Banking',
    divisions: [
      'Branch Service Excellence',
      'Wealth Management',
      'Consumer Lending & Cards',
      'Digital Banking & Acquisition'
    ]
  },
  {
    directorate_name: 'Commercial & Corporate Banking',
    divisions: [
      'Corporate Banking Coverage',
      'Commercial Banking SME',
      'Transaction Banking',
      'Investment Banking & Markets'
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
    directorate_name: 'Finance & Operations',
    divisions: [
      'Financial Planning & Control',
      'Treasury Operations',
      'Central Operations & Services'
    ]
  },
  {
    directorate_name: 'Internal Audit & Legal',
    divisions: [
      'Internal Audit Group',
      'Legal Counsel & Corporate Secretarial'
    ]
  }
];

// Helper to generate seed multi-month survey responses with question-level breakdown
function generateInitialSurveyResponses() {
  const { DEFAULT_METRIC_QUESTIONS } = require('../services/metricQuestionService');
  const employees = [
    { nip: '8801245', name: 'Dimas Setiawan', email: 'dimas.setiawan@cimbniaga.co.id', dir: 'Information Technology', div: 'Core Banking Solution' },
    { nip: '8802391', name: 'Anisa Rahmawati', email: 'anisa.rahmawati@cimbniaga.co.id', dir: 'Human Resources', div: 'People Experience & Culture' },
    { nip: '8803418', name: 'Reza Pratama', email: 'reza.pratama@cimbniaga.co.id', dir: 'Consumer Banking', div: 'Branch Banking Region 1' },
    { nip: '8804572', name: 'Citra Dewi', email: 'citra.dewi@cimbniaga.co.id', dir: 'Risk Management', div: 'Credit Risk Operations' },
    { nip: '8805629', name: 'Fajar Nugroho', email: 'fajar.nugroho@cimbniaga.co.id', dir: 'Information Technology', div: 'Application Development' },
    { nip: '8806781', name: 'Lestari Wulandari', email: 'lestari.w@cimbniaga.co.id', dir: 'Commercial & Corporate Banking', div: 'Commercial Banking SME' },
    { nip: '8807894', name: 'Bambang Kusuma', email: 'bambang.k@cimbniaga.co.id', dir: 'Internal Audit & Legal', div: 'Internal Audit Group' },
    { nip: '8808935', name: 'Mega Anggraini', email: 'mega.a@cimbniaga.co.id', dir: 'Finance & Operations', div: 'Treasury Operations' }
  ];

  const campusStudents = [
    { id: 'PESERTA-2026-001', name: 'Aditya Pratama', email: 'aditya.pratama@ui.ac.id', university: 'Universitas Indonesia', major: 'Teknik Informatika' },
    { id: 'PESERTA-2026-002', name: 'Nadia Salsabila', email: 'nadia.salsabila@itb.ac.id', university: 'Institut Teknologi Bandung', major: 'Manajemen Bisnis' },
    { id: 'PESERTA-2026-003', name: 'Rizky Ramadhan', email: 'rizky.r@ugm.ac.id', university: 'Universitas Gadjah Mada', major: 'Sistem Informasi' },
    { id: 'PESERTA-2026-004', name: 'Farhan Alamsyah', email: 'farhan.a@unpad.ac.id', university: 'Universitas Padjadjaran', major: 'Akuntansi & Keuangan' }
  ];

  const jobCandidates = [
    { id: 'CAND-2026-101', name: 'Jessica Stephanie', email: 'jessica.stephanie@gmail.com', position: 'Digital Banking Specialist', channel: 'LinkedIn Talent Solutions' },
    { id: 'CAND-2026-102', name: 'Kevin Wijaya', email: 'kevin.wijaya@yahoo.com', position: 'Fullstack Engineer', channel: 'CIMB Career Website' },
    { id: 'CAND-2026-103', name: 'Tasya Kamila', email: 'tasya.kamila@outlook.com', position: 'Credit Risk Analyst', channel: 'Campus Hiring Fair' },
    { id: 'CAND-2026-104', name: 'Hendra Gunawan', email: 'hendra.gunawan@gmail.com', position: 'Wealth Relationship Manager', channel: 'Jobstreet Portal' }
  ];

  const responses = [];
  let respId = 1;

  const dates = [
    '2026-01-15', '2026-01-22', '2026-01-29',
    '2026-02-05', '2026-02-14', '2026-02-24',
    '2026-03-04', '2026-03-12', '2026-03-20'
  ];

  const surveyMetricIds = Object.keys(DEFAULT_METRIC_QUESTIONS).map(k => parseInt(k));

  surveyMetricIds.forEach(metricId => {
    const metricObj = initialMetrics.find(m => m.metric_id === metricId);
    if (!metricObj) return;

    const questions = DEFAULT_METRIC_QUESTIONS[metricId] || [];
    const isScale5 = metricObj.scale_type === 'RATING_5';
    const baseTarget = metricObj.raw_value || (isScale5 ? 4.2 : 85);

    // Create responses across dates
    dates.forEach((surveyDate, dateIdx) => {
      if (metricId === 2) {
        // Metric 2: Non-employee Campus Students
        const studentSubset = [
          campusStudents[dateIdx % campusStudents.length],
          campusStudents[(dateIdx + 1) % campusStudents.length]
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
              const base5 = 4.2;
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
          jobCandidates[(dateIdx + 1) % jobCandidates.length]
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
              const base5 = 4.1;
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
          employees[(dateIdx + 3) % employees.length]
        ];

        empSubset.forEach((emp, empIdx) => {
          const ratings = {};
          let scorableNormalizedSum = 0;
          let scorableCount = 0;

          questions.forEach((q, qIdx) => {
            const type = q.type || 'SCALE_1_5';
            if (type === 'YES_NO') {
              const isYes = (dateIdx + empIdx + qIdx) % 7 !== 0; // mostly Ya
              ratings[q.key] = isYes ? 'Ya' : 'Tidak';
              scorableNormalizedSum += isYes ? 100 : 0;
              scorableCount += 1;
            } else if (type === 'SCALE_1_10') {
              const base10 = isScale5 ? (baseTarget * 2) : (baseTarget / 10);
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
              const base5 = isScale5 ? baseTarget : (baseTarget / 20);
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

module.exports = {
  initialJourneys,
  initialCheckpoints,
  initialMetrics,
  initialDirectorates,
  initialActionLibrary,
  defaultSurveyQuestions,
  sampleEvents,
  sampleAttendances,
  sampleFeedbackResponses,
  initialSurveyUploadedResponses
};

