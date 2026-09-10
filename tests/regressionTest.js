// tests/regressionTest.js
const assert = require('assert');

const BASE_URL = 'http://localhost:5000';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function runTest(name, fn) {
  totalTests++;
  return fn()
    .then(() => {
      passedTests++;
      console.log(`  ✅ PASS: ${name}`);
    })
    .catch(err => {
      failedTests++;
      console.error(`  ❌ FAIL: ${name}`);
      console.error(`     Reason: ${err.message}`);
    });
}

async function runRegressionSuite() {
  console.log('\n================================================================');
  console.log('🧪 CIMB NIAGA PEOPLE EXPERIENCE (PX) - REGRESSION TESTING SUITE');
  console.log('================================================================\n');

  // --- 1. SYSTEM HEALTH & METRICS CALCULATION (YTD & PERIOD FILTER) ---
  console.log('📦 MODULE 1: Calculation Engine & Period Filtering');
  await runTest('System health endpoint is online', async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.status, 'online');
    assert.strictEqual(data.system, 'CIMB Niaga People Experience Integrated System');
  });

  await runTest('PX Index Year-to-Date (Default) calculation formula (70% Survey + 30% Outcome)', async () => {
    const res = await fetch(`${BASE_URL}/api/metrics/calculate?period=YTD`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    const pxIndex = data.px_index !== undefined ? data.px_index : data.pe_index;
    assert(pxIndex > 0 && pxIndex <= 100, 'PX Index must be between 0 and 100');
    assert(data.survey_index > 0, 'Survey index must exist');
    assert(data.outcome_index > 0, 'Outcome index must exist');
    assert.strictEqual(data.metrics.length, 27, 'Total metrics must be 27');
    assert.strictEqual(data.journeys.length, 5, 'Total journeys must be 5');
    assert.strictEqual(data.checkpoints.length, 17, 'Total checkpoints must be 17');
    
    // Formula verification: 0.70 * survey + 0.30 * outcome
    const expectedPx = Math.round((0.70 * data.survey_index + 0.30 * data.outcome_index) * 100) / 100;
    const diff = Math.abs(pxIndex - expectedPx);
    assert(diff < 0.1, `Calculated PX Index ${pxIndex} does not match formula ${expectedPx}`);
  });

  await runTest('PX Index monthly period filtering (Jan 2026 vs Feb 2026)', async () => {
    const resJan = await fetch(`${BASE_URL}/api/metrics/calculate?period=2026-01`);
    assert.strictEqual(resJan.status, 200);
    const dataJan = await resJan.json();
    assert.strictEqual(dataJan.period, '2026-01');
    assert(dataJan.px_index > 0 || dataJan.pe_index > 0, 'Jan PX Index should be calculated');

    const resFeb = await fetch(`${BASE_URL}/api/metrics/calculate?period=2026-02`);
    assert.strictEqual(resFeb.status, 200);
    const dataFeb = await resFeb.json();
    assert.strictEqual(dataFeb.period, '2026-02');
    assert(dataFeb.px_index > 0 || dataFeb.pe_index > 0, 'Feb PX Index should be calculated');
  });

  // --- 2. MONTHLY TRENDS & PROGRESSION ---
  console.log('\n📦 MODULE 2: Monthly Trends & Progression Engine');
  await runTest('Monthly trends endpoint returns 12 months with scores and sample counts', async () => {
    const res = await fetch(`${BASE_URL}/api/metrics/trends`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    const trends = data.trends || data;
    assert.strictEqual(trends.length, 12, 'Must return 12 months for 2026');
    
    const jan = trends[0];
    assert.strictEqual(jan.month_code, '2026-01');
    assert.strictEqual(jan.month_name, 'Januari');
    assert(jan.px_index > 0 || jan.pe_index > 0, 'Jan PX Index must be > 0');
    assert(jan.survey_index > 0, 'Jan Survey Index must be > 0');
    assert(jan.outcome_index > 0, 'Jan Outcome Index must be > 0');
  });

  // --- 3. METRIC DETAIL & QUESTION-LEVEL DRILLDOWN ---
  console.log('\n📦 MODULE 3: Metric Question Drilldown & Respondent Analysis');
  await runTest('Drilldown detail for Metric #8 (Onboarding 30/60/90 Satisfaction Index)', async () => {
    const res = await fetch(`${BASE_URL}/api/metrics/8/detail?period=YTD`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.metric_id, 8);
    assert.strictEqual(data.metric_name, 'Onboarding 30/60/90 Satisfaction Index');
    
    // Check questions breakdown
    const questions = data.questions || data.questions_breakdown;
    assert(questions.length >= 3, 'Metric #8 should have question breakdown');
    questions.forEach(q => {
      assert(q.avg_score > 0, `Question ${q.key} average should be > 0`);
      assert(q.text.length > 5, 'Question text must be populated');
    });

    // Check responses table
    assert(data.total_respondents > 0, 'Total respondents should be > 0');
    assert(data.responses.length > 0, 'Responses array should have records');
    const firstResp = data.responses[0];
    assert(firstResp.nip, 'Response should have NIP');
    assert(firstResp.employee_name, 'Response should have employee name');
    assert(firstResp.survey_date, 'Response should have survey date');
  });

  // --- 4. QUESTION-BASED SURVEY CSV TEMPLATE GENERATION ---
  console.log('\n📦 MODULE 4: Question-Based Survey Template Generator');
  await runTest('Download specific survey metric template with dynamic question headers (Metric #8)', async () => {
    const res = await fetch(`${BASE_URL}/api/surveys/template?metric_id=8`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type').includes('text/csv'), true);
    const csv = await res.text();
    
    // Must include question columns
    assert(csv.includes('q1_role_clarity'), 'CSV must have q1_role_clarity column');
    assert(csv.includes('q2_supervisor_support'), 'CSV must have q2_supervisor_support column');
    assert(csv.includes('q3_buddy_support'), 'CSV must have q3_buddy_support column');
    assert(csv.includes('8801245'), 'CSV should have sample respondent');
  });

  await runTest('Download Master All-Surveys Template (20 survey metrics)', async () => {
    const res = await fetch(`${BASE_URL}/api/surveys/template?metric_id=ALL`);
    assert.strictEqual(res.status, 200);
    const csv = await res.text();
    const lines = csv.trim().split('\n');
    assert(lines.length >= 21, `Expected header + at least 20 metric rows, got ${lines.length}`);
  });

  // --- 5. QUESTION-BASED BULK CSV IMPORT & LIVE RECALCULATION ---
  console.log('\n📦 MODULE 5: Question-Based Survey CSV Import & Live Recalculation');
  await runTest('Upload question-level survey CSV for Metric #8 and verify recalculated scores', async () => {
    const questionCsv = [
      'nip,employee_name,cimb_email,directorate,division,metric_id,metric_name,q1_role_clarity,q2_supervisor_support,q3_buddy_support,q4_resource_access,verbatim_feedback,survey_date',
      '8809901,Andi Pratama,andi.p@cimbniaga.co.id,Information Technology,Core Banking,8,Onboarding 30/60/90 Satisfaction Index,5.0,5.0,5.0,5.0,Proses onboarding dan buddy sangat profesional!,2026-03-25',
      '8809902,Siti Rahayu,siti.r@cimbniaga.co.id,Consumer Banking,Wealth Management,8,Onboarding 30/60/90 Satisfaction Index,4.8,5.0,4.8,4.8,Sangat memuaskan dan fasilitas kerja langsung siap,2026-03-25',
      '8809903,Doni Setiawan,doni.s@cimbniaga.co.id,Risk Management,Market Risk,8,Onboarding 30/60/90 Satisfaction Index,5.0,4.8,4.9,5.0,Buddy ramah dan materi jelas,2026-03-25'
    ].join('\r\n');

    const res = await fetch(`${BASE_URL}/api/surveys/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        csvText: questionCsv,
        fileName: 'test_question_upload.csv',
        metric_id: 8
      })
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.valid_rows, 3);
    assert.strictEqual(data.invalid_rows, 0);
    assert.strictEqual(data.affected_metrics[0].metric_id, 8);
    assert(data.affected_metrics[0].calculated_raw_avg >= 4.8);
  });

  // --- 5b. SURVEY EVIDENCE EXPORT & AUDIT TRAIL VERIFICATION ---
  console.log('\n📦 MODULE 5b: Survey Evidence Export & Audit Trail');
  await runTest('Download survey evidence CSV for Metric #8 with dates and question details', async () => {
    const res = await fetch(`${BASE_URL}/api/surveys/evidence?metric_id=8&period=YTD`);
    assert.strictEqual(res.status, 200);
    const csv = await res.text();
    assert(csv.includes('Tanggal_Survei_Dilakukan'), 'Evidence CSV must include Tanggal_Survei_Dilakukan');
    assert(csv.includes('NIP'), 'Evidence CSV must include NIP');
    assert(csv.includes('Komentar_Verbatim_Feedback'), 'Evidence CSV must include Komentar_Verbatim_Feedback');
    assert(csv.includes('q1_role_clarity'), 'Evidence CSV must include question columns');
    
    const lines = csv.trim().split(/\r?\n/);
    assert(lines.length >= 4, 'Should contain header and at least 3 respondent rows');
  });

  await runTest('Download Master Survey Evidence CSV for all metrics', async () => {
    const res = await fetch(`${BASE_URL}/api/surveys/evidence?metric_id=ALL&period=YTD`);
    assert.strictEqual(res.status, 200);
    const csv = await res.text();
    assert(csv.includes('Tanggal_Survei_Dilakukan'));
    assert(csv.includes('Nama_Metrik'));
  });

  // --- 6. ADMIN TARGET & THRESHOLD MANAGEMENT ---
  console.log('\n📦 MODULE 6: Admin Target & Ambang Batas Settings');
  await runTest('Admin fetch metric targets', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/targets`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    const targets = data.targets || data;
    const totalCount = Array.isArray(targets) ? targets.length : Object.keys(targets).length;
    assert.strictEqual(totalCount, 27, 'Should have targets for all 27 metrics');
  });

  await runTest('Admin update custom targets and min threshold', async () => {
    const updateRes = await fetch(`${BASE_URL}/api/admin/targets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targets: [
          { metric_id: 8, target_value: 4.5, target_display: '> 4.50 / 5', min_threshold: 85 }
        ]
      })
    });
    assert.strictEqual(updateRes.status, 200);
    const updateData = await updateRes.json();
    assert.strictEqual(updateData.success, true);

    // Verify in calculation endpoint
    const calcRes = await fetch(`${BASE_URL}/api/metrics/calculate`);
    const calcData = await calcRes.json();
    const metric8 = calcData.metrics.find(m => m.metric_id === 8);
    assert.strictEqual(metric8.target_value, 4.5);
    assert.strictEqual(metric8.target_display, '> 4.50 / 5');
    assert.strictEqual(metric8.min_threshold, 85);
  });

  // --- 7. ALERTS & ACTION RECOMMENDATION ENGINE ---
  console.log('\n📦 MODULE 7: Alert Engine & Verbatim Action Recommendations');
  await runTest('Alert engine maps deficient metrics to Action Library', async () => {
    const res = await fetch(`${BASE_URL}/api/alerts`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert(data.alerts.length > 0, 'Alerts should exist for metrics below target');
    const firstAlert = data.alerts[0];
    assert(firstAlert.recommended_action.length > 10, 'Action recommendation must be populated');
  });

  // --- 8. SIGNATURE PROGRAM EVENTS & PPT GENERATOR ---
  console.log('\n📦 MODULE 8: Signature Program Events & PowerPoint Export');
  await runTest('Event attendance registration and post-event survey', async () => {
    const testNip = `880${Math.floor(1000 + Math.random() * 9000)}`;
    
    // Check-in
    const attRes = await fetch(`${BASE_URL}/api/events/ev-perspektif-2024-q1/attendance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nip: testNip,
        employee_name: 'Test Participant',
        cimb_email: `user.${testNip}@cimbniaga.co.id`,
        directorate: 'Information Technology',
        division: 'Digital Platform'
      })
    });
    assert([200, 201].includes(attRes.status));

    // Feedback
    const fbRes = await fetch(`${BASE_URL}/api/events/ev-perspektif-2024-q1/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nip: testNip,
        ratings: { 'q-relevance': 5, 'q-speaker': 5, 'q-delivery': 5, 'q-overall': 5 },
        verbatim: 'Sesi event sangat inspiratif dan bermanfaat!'
      })
    });
    assert([200, 201].includes(fbRes.status));
  });

  await runTest('PowerPoint (.pptx) corporate report deck generation', async () => {
    const res = await fetch(`${BASE_URL}/api/events/ev-perspektif-2024-q1/generate-ppt`, {
      method: 'POST'
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert(data.fileName.endsWith('.pptx'));
  });

  // --- 9. OUTCOME VS SURVEY METRICS SEPARATION & DATA SOURCE VERIFICATION ---
  console.log('\n📦 MODULE 9: Outcome vs Survey Metrics Separation & Validation');
  await runTest('Verify OUTCOME metric #11 (Signature Program Attendance) is Internal HR data with null respondent count', async () => {
    const res = await fetch(`${BASE_URL}/api/metrics/11/detail?period=YTD`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.metric_type, 'OUTCOME');
    assert.strictEqual(data.is_survey, false);
    assert.strictEqual(data.is_outcome, true);
    assert.strictEqual(data.total_respondents, null, 'Outcome metrics must NOT have total_respondents count');
    assert(data.operational_records !== undefined, 'Outcome metrics should have operational records');
  });

  await runTest('Verify OUTCOME metric #1 (% SLA of candidate fulfillment) is Internal HR data with SLA records', async () => {
    const res = await fetch(`${BASE_URL}/api/metrics/1/detail?period=YTD`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.metric_type, 'OUTCOME');
    assert.strictEqual(data.is_survey, false);
    assert.strictEqual(data.is_outcome, true);
    assert.strictEqual(data.total_respondents, null);
    assert(data.operational_records.length > 0, 'SLA outcome metric should have departmental operational breakdown');
  });

  await runTest('Verify SURVEY metric #5 (Candidate Experience Index) is pure survey with respondent count', async () => {
    const res = await fetch(`${BASE_URL}/api/metrics/5/detail?period=YTD`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.metric_type, 'SURVEY');
    assert.strictEqual(data.is_survey, true);
    assert.strictEqual(data.is_outcome, false);
    assert(data.total_respondents > 0, 'Survey metric must have positive total_respondents count');
    assert(data.questions_breakdown.length > 0, 'Survey metric must have question breakdown');
  });

  // --- 10. ADMIN SURVEY QUESTIONS & 4 QUESTION TYPES ENGINE ---
  console.log('\n📦 MODULE 10: Admin Survey Questions & Multi-Type Questions Engine');
  await runTest('Admin fetch survey questions for all survey metrics', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/survey-questions`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.metrics.length, 20, 'Should have 20 survey metrics');
    assert(data.questions[7], 'Metric #7 questions must exist in store');
  });

  await runTest('Verify Metric #7 (Day 1 Onboarding Satisfaction Index) has exact 15 questions with proper types', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/survey-questions/7`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.metric_id, 7);
    assert.strictEqual(data.questions.length, 15, 'Metric #7 must have exactly 15 questions');

    // Questions 1 - 5 must be SCALE_1_5
    for (let i = 0; i < 5; i++) {
      assert.strictEqual(data.questions[i].type, 'SCALE_1_5', `Question ${i + 1} should be SCALE_1_5`);
      assert(data.questions[i].text.length > 10, `Question ${i + 1} text must be populated`);
    }

    // Questions 6 - 15 must be YES_NO
    for (let i = 5; i < 15; i++) {
      assert.strictEqual(data.questions[i].type, 'YES_NO', `Question ${i + 1} should be YES_NO`);
      assert(data.questions[i].text.length > 10, `Question ${i + 1} text must be populated`);
    }

    // Specific text check for Q1, Q6, Q10, Q15
    assert(data.questions[0].text.includes('Saya puas dengan proses rekrutmen'));
    assert(data.questions[5].text.includes('Welcoming Email'));
    assert(data.questions[9].text.includes('Welcome Kit CIMBian Starter Pack'));
    assert(data.questions[14].text.includes('LAN/VPN/Email'));
  });

  await runTest('Download Metric #7 CSV Template with 15 question columns', async () => {
    const res = await fetch(`${BASE_URL}/api/surveys/template?metric_id=7`);
    assert.strictEqual(res.status, 200);
    const csv = await res.text();
    assert(csv.includes('q1_recruitment_process'));
    assert(csv.includes('q6_welcoming_email'));
    assert(csv.includes('q10_welcome_kit_goodie_bag'));
    assert(csv.includes('q15_system_access_ready'));
    assert(csv.includes('Ya / Tidak'));
    assert(csv.includes('Skala 1.0-5.0'));
  });

  await runTest('Upload Metric #7 CSV responses with mixed SCALE_1_5 and YES_NO answers', async () => {
    const csvContent = [
      'nip,employee_name,cimb_email,directorate,division,metric_id,metric_name,q1_recruitment_process,q2_interview_biz_unit,q3_day1_overall_exp,q4_welcome_kit_interest,q5_meet_greet_satisfaction,q6_welcoming_email,q7_contacted_by_ds_buddy,q8_welcomed_by_ds,q9_welcomed_by_buddy,q10_welcome_kit_goodie_bag,q11_id_card_received,q12_laptop_received,q13_sms_credentials,q14_system_activation_support,q15_system_access_ready,verbatim_feedback,survey_date',
      '8809951,Rian Pratama,rian.p@cimbniaga.co.id,Human Resources,People Experience,7,Day 1 Onboarding Satisfaction Index,5.0,5.0,5.0,5.0,5.0,Ya,Ya,Ya,Ya,Ya,Ya,Ya,Ya,Ya,Ya,Semua perlengkapan dan buddy menyambut dengan sangat baik!,2026-03-25',
      '8809952,Maya Indah,maya.i@cimbniaga.co.id,Digital Banking,OCTO Mobile,7,Day 1 Onboarding Satisfaction Index,4.0,4.0,5.0,4.0,5.0,Ya,Ya,Ya,Ya,Ya,Ya,Ya,Ya,Ya,Tidak,Sangat puas dengan sambutan hari pertama,2026-03-25'
    ].join('\r\n');

    const res = await fetch(`${BASE_URL}/api/surveys/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        csvText: csvContent,
        fileName: 'test_day1_upload.csv',
        metric_id: 7
      })
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.valid_rows, 2);
    assert.strictEqual(data.affected_metrics[0].metric_id, 7);
  });

  await runTest('Admin custom question update and reset for Metric #7', async () => {
    // Custom edit
    const updateRes = await fetch(`${BASE_URL}/api/admin/survey-questions/7`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questions: [
          { key: 'q1_custom', label: 'Kepuasan Hari Pertama Khusus', text: 'Apakah Anda puas?', type: 'SCALE_1_5', mandatory: true },
          { key: 'q2_custom', label: 'Free Text Feedback', text: 'Tuliskan masukan Anda', type: 'FREE_TEXT', mandatory: false }
        ]
      })
    });
    assert.strictEqual(updateRes.status, 200);
    const updateData = await updateRes.json();
    assert.strictEqual(updateData.success, true);
    assert.strictEqual(updateData.questions.length, 2);

    // Reset back to 15 questions default
    const resetRes = await fetch(`${BASE_URL}/api/admin/survey-questions/7/reset`, { method: 'POST' });
    assert.strictEqual(resetRes.status, 200);
    const resetData = await resetRes.json();
    assert.strictEqual(resetData.success, true);
    assert.strictEqual(resetData.questions.length, 15, 'Reset must restore the 15 default questions for Metric #7');
  });

  // --- 11. ESS SURVEY DIMENSIONS & % FAVORABLE SUMMARY BREAKDOWN (ALL 11 METRICS) ---
  console.log('\n📦 MODULE 11: ESS (Employee Sentiment Survey) Dimensions & Summary Scores for all 11 Metrics');

  const essMetricsToTest = [
    { id: 9, name: 'Role Clarity & DS Support Score Index', dim: 'Employee Commitment', qCount: 3, minScore: 85 },
    { id: 13, name: 'Pride & Work Environment Index', dim: 'Pride & Work Environment', qCount: 4, minScore: 88 },
    { id: 15, name: 'Manager Recognition Index', dim: 'Recognition & Appreciation', qCount: 3, minScore: 85 },
    { id: 16, name: 'Wellbeing Index', dim: 'Employee Wellbeing', qCount: 3, minScore: 80 },
    { id: 17, name: 'Psychological Safety Index', dim: 'Psychological Safety & Risk Mindset', qCount: 4, minScore: 90 },
    { id: 18, name: 'Leadership Connection Score', dim: 'Agility & Decision Making', qCount: 6, minScore: 85 },
    { id: 21, name: 'Career Growth & Learning Index', dim: 'Career Growth & Learning', qCount: 3, minScore: 85 },
    { id: 22, name: 'Capability & Enablement Index', dim: 'Capability & Enablement', qCount: 3, minScore: 85 },
    { id: 24, name: 'Performance Feedback Quality Index', dim: 'Performance Feedback & Development', qCount: 3, minScore: 85 },
    { id: 25, name: 'Meaningful Contribution Index', dim: 'Purpose & Meaningful Contribution', qCount: 3, minScore: 85 },
    { id: 27, name: 'Intent to Stay Index', dim: 'Employee Commitment', qCount: 3, minScore: 75 }
  ];

  for (const item of essMetricsToTest) {
    await runTest(`Verify ESS Metric #${item.id} (${item.name}) has valid dimension, % favorable summary, and visible/required config`, async () => {
      const res = await fetch(`${BASE_URL}/api/metrics/${item.id}/detail?period=YTD`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.is_ess, true, `Metric #${item.id} must be recognized as ESS`);
      assert(data.ess_summary !== null, `Metric #${item.id} must have ess_summary`);
      assert.strictEqual(data.ess_summary.dimension_name, item.dim, `Metric #${item.id} dimension must match ${item.dim}`);
      assert(data.ess_summary.summary_score >= item.minScore, `Metric #${item.id} summary score (${data.ess_summary.summary_score}) should be >= ${item.minScore}`);
      assert.strictEqual(data.questions_breakdown.length, item.qCount, `Metric #${item.id} should have ${item.qCount} questions`);
      
      // Verify first question properties
      const q1 = data.questions_breakdown[0];
      assert(q1.percent_favorable !== null && q1.percent_favorable !== undefined, `Q1 must have percent_favorable`);
      assert(q1.percent_neutral !== null && q1.percent_neutral !== undefined, `Q1 must have percent_neutral`);
      assert(q1.percent_unfavorable !== null && q1.percent_unfavorable !== undefined, `Q1 must have percent_unfavorable`);
      assert.strictEqual(q1.visible_based_on, 'Always', `Q1 visible_based_on must be 'Always'`);
      assert.strictEqual(q1.required_based_on, 'Always', `Q1 required_based_on must be 'Always'`);
    });
  }

  // --- 12. DATE NORMALIZATION & ISO YYYY-MM-DD STANDARDIZATION ---
  console.log('\n📦 MODULE 12: Date Normalization & Canonical ISO YYYY-MM-DD Format');
  await runTest('All metrics in calculation output have standardized YYYY-MM-DD date format', async () => {
    const res = await fetch(`${BASE_URL}/api/metrics/calculate?period=YTD`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert(data.metrics && data.metrics.length > 0);
    const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;
    data.metrics.forEach(m => {
      if (m.last_survey_date) {
        assert(isoDateRegex.test(m.last_survey_date), `Metric #${m.metric_id} date "${m.last_survey_date}" must follow YYYY-MM-DD`);
      }
    });
  });

  await runTest('CSV import with M/D/YYYY date is automatically normalized to YYYY-MM-DD', async () => {
    const customCsv = [
      'nip,employee_name,cimb_email,directorate,division,survey_date,q1_clarity,q2_support,verbatim_feedback',
      '# MANDATORY,Nama,Email,Direktorat,Divisi,YYYY-MM-DD,Skala,Skala,Verbatim',
      '8899011,Test Date Normalizer,test.norm@cimbniaga.co.id,Information Technology,App Dev,3/31/2026,5.0,4.8,"Test date normalization"'
    ].join('\r\n');

    const res = await fetch(`${BASE_URL}/api/surveys/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        csvText: customCsv,
        fileName: 'test_date_norm.csv',
        metric_id: 9
      })
    });
    assert.strictEqual(res.status, 200);
    const result = await res.json();
    assert.strictEqual(result.success, true);

    // Verify detail endpoint returns normalized YYYY-MM-DD date
    const detailRes = await fetch(`${BASE_URL}/api/metrics/9/detail?period=YTD`);
    const detailData = await detailRes.json();
    const resp = detailData.responses.find(r => r.nip === '8899011');
    assert(resp !== undefined, 'Uploaded response must be found in responses');
    assert.strictEqual(resp.survey_date, '2026-03-31', 'Uploaded date "3/31/2026" must be normalized to "2026-03-31"');
  });

  // --- 13. NON-EMPLOYEE CORRESPONDENTS (METRIC #2 & METRIC #5) ---
  console.log('\n📦 MODULE 13: Non-Employee Correspondents Template, Ingestion & Evidence');
  await runTest('Metric #2 (CIMB Goes to Campus) CSV template contains student non-employee headers', async () => {
    const res = await fetch(`${BASE_URL}/api/surveys/template?metric_id=2`);
    assert.strictEqual(res.status, 200);
    const csv = await res.text();
    assert(csv.includes('participant_id'), 'Template must include participant_id');
    assert(csv.includes('participant_name'), 'Template must include participant_name');
    assert(csv.includes('university'), 'Template must include university');
    assert(csv.includes('major'), 'Template must include major');
  });

  await runTest('Metric #5 (Candidate Experience Score) CSV template contains candidate non-employee headers', async () => {
    const res = await fetch(`${BASE_URL}/api/surveys/template?metric_id=5`);
    assert.strictEqual(res.status, 200);
    const csv = await res.text();
    assert(csv.includes('candidate_id'), 'Template must include candidate_id');
    assert(csv.includes('candidate_name'), 'Template must include candidate_name');
    assert(csv.includes('applied_position'), 'Template must include applied_position');
    assert(csv.includes('recruitment_channel'), 'Template must include recruitment_channel');
  });

  await runTest('Upload non-employee campus survey for Metric #2 parses student fields correctly', async () => {
    const campusCsv = [
      'participant_id,participant_name,email,university,major,survey_date,q1_event_clarity,q2_speaker_quality,q3_cimb_brand_attraction,q4_interest_to_join,q5_recommend_to_peers,verbatim_feedback',
      '# MANDATORY,Nama,Email,Universitas,Jurusan,YYYY-MM-DD,1-5,1-5,1-5,1-5,1-5,Verbatim',
      'MHS-2026-999,Budi Santoso,budi.s@ui.ac.id,Universitas Indonesia,Teknik Informatika,2026-03-25,5,5,4.8,5,5,"Event Goes to Campus UI sangat inspiratif!"'
    ].join('\r\n');

    const res = await fetch(`${BASE_URL}/api/surveys/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        csvText: campusCsv,
        fileName: 'campus_test.csv',
        metric_id: 2
      })
    });
    assert.strictEqual(res.status, 200);
    const result = await res.json();
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.target_audience, 'CAMPUS_STUDENTS');

    // Check detail
    const detailRes = await fetch(`${BASE_URL}/api/metrics/2/detail?period=YTD`);
    const detail = await detailRes.json();
    const student = detail.responses.find(r => r.participant_id === 'MHS-2026-999');
    assert(student !== undefined, 'Uploaded student record must exist');
    assert.strictEqual(student.university, 'Universitas Indonesia');
    assert.strictEqual(student.major, 'Teknik Informatika');
  });

  await runTest('Upload non-employee candidate survey for Metric #5 parses candidate fields correctly', async () => {
    const candCsv = [
      'candidate_id,candidate_name,email,applied_position,recruitment_channel,survey_date,q1_process_clarity,q2_interviewer_professionalism,q3_communication_speed,q4_portal_experience,q5_overall_impression,verbatim_feedback',
      '# MANDATORY,Nama,Email,Posisi,Saluran,YYYY-MM-DD,1-5,1-5,1-5,1-5,1-5,Verbatim',
      'CAND-2026-888,Rina Wati,rina.wati@gmail.com,Senior Backend Engineer,LinkedIn,2026-03-26,5,4.8,5,4.9,5,"Proses rekrutmen cepat dan transparan."'
    ].join('\r\n');

    const res = await fetch(`${BASE_URL}/api/surveys/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        csvText: candCsv,
        fileName: 'candidate_test.csv',
        metric_id: 5
      })
    });
    assert.strictEqual(res.status, 200);
    const result = await res.json();
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.target_audience, 'JOB_APPLICANTS');

    // Check detail
    const detailRes = await fetch(`${BASE_URL}/api/metrics/5/detail?period=YTD`);
    const detail = await detailRes.json();
    const cand = detail.responses.find(r => r.candidate_id === 'CAND-2026-888');
    assert(cand !== undefined, 'Uploaded candidate record must exist');
    assert.strictEqual(cand.applied_position, 'Senior Backend Engineer');
    assert.strictEqual(cand.recruitment_channel, 'LinkedIn');
  });

  // --- 14. PERIOD FILTER SEPARATION (YEAR & MONTH) AND VIEW MODES (YTD vs MTD) ---
  console.log('\n📦 MODULE 14: Period Separation (Year & Month) & View Modes (YTD vs MTD)');
  await runTest('Calculate PE Index with mode=YTD and year=2026', async () => {
    const res = await fetch(`${BASE_URL}/api/metrics/calculate?mode=YTD&year=2026`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.mode, 'YTD');
    assert.strictEqual(data.year, '2026');
    assert.strictEqual(data.period, 'YTD');
    assert(data.px_index > 0);
  });

  await runTest('Calculate PE Index with mode=MTD, year=2026, month=02', async () => {
    const res = await fetch(`${BASE_URL}/api/metrics/calculate?mode=MTD&year=2026&month=02`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.mode, 'MTD');
    assert.strictEqual(data.year, '2026');
    assert.strictEqual(data.month, '02');
    assert.strictEqual(data.period, '2026-02');
    assert(data.px_index > 0);
  });

  // --- 15. DIRECTORATE & SUB-DIRECTORATE FILTER WITH DYNAMIC NON-EMPLOYEE EXCLUSION ---
  console.log('\n📦 MODULE 15: Directorate & Sub-Directorate Filtering & Metric Exclusion');
  await runTest('GET /api/directorates returns list of 7 Directorates with sub-directorates', async () => {
    const res = await fetch(`${BASE_URL}/api/directorates`);
    assert.strictEqual(res.status, 200);
    const directorates = await res.json();
    assert(Array.isArray(directorates), 'Must return array');
    assert(directorates.length >= 7, 'Must have at least 7 directorates');
    const itDir = directorates.find(d => d.name.includes('Information Technology'));
    assert(itDir !== undefined, 'Information Technology directorate must exist');
    assert(itDir.sub_directorates.length > 0, 'IT must have sub-directorates');
  });

  await runTest('Calculate with Directorate filter disables non-employee metrics (Metrics #1 to #5)', async () => {
    const res = await fetch(`${BASE_URL}/api/metrics/calculate?mode=YTD&year=2026&directorate=Information%20Technology`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.filter_options.directorate, 'Information Technology');
    
    // Check that metrics 1 to 5 are disabled
    const nonEmpMetrics = data.metrics.filter(m => m.metric_id <= 5);
    nonEmpMetrics.forEach(m => {
      assert.strictEqual(m.is_disabled, true, `Metric #${m.metric_id} must be marked is_disabled=true`);
    });

    // Check that employee metrics 6 to 27 are NOT disabled
    const empMetrics = data.metrics.filter(m => m.metric_id >= 6);
    empMetrics.forEach(m => {
      assert.strictEqual(m.is_disabled, false, `Metric #${m.metric_id} must be active (is_disabled=false)`);
    });

    // Journey 1 has 5 disabled external metrics (metrics 1-5) and 2 active employee metrics (metrics 6-7)
    const journey1 = data.journeys.find(j => j.journey_id === 1);
    assert(journey1 !== undefined);
    assert.strictEqual(journey1.disabled_metrics_count, 5, '5 non-employee metrics in Journey 1 should be disabled for directorate');
    assert.strictEqual(journey1.active_metrics_count, 2, '2 employee metrics in Journey 1 should remain active');
    assert(journey1.overall_score > 0, 'Journey 1 score should be calculated from active metrics');

    // Overall PX index should be calculated from remaining active journeys (Journeys 1 to 5)
    assert(data.px_index > 0, 'PX index must be calculated from active employee metrics');
  });

  await runTest('Calculate with Sub-Directorate filter', async () => {
    const res = await fetch(`${BASE_URL}/api/metrics/calculate?mode=YTD&year=2026&directorate=Information%20Technology&sub_directorate=IT%20Architecture%20%26%20Governance`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.filter_options.sub_directorate, 'IT Architecture & Governance');
    assert(data.px_index > 0);
  });

  // --- 16. ADMIN JOURNEY & METRIC PARAMETERS MANAGEMENT (CRUD & RESET) ---
  console.log('\n📦 MODULE 16: Admin Parameters Management (CRUD & Reset)');
  await runTest('GET /api/admin/parameters returns journeys, checkpoints, and metrics', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/parameters`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.journeys.length, 5);
    assert.strictEqual(data.checkpoints.length, 17);
    assert.strictEqual(data.metrics.length, 27);
  });

  await runTest('Update metric parameters (weight, target, threshold) via PUT /api/admin/metrics/:id', async () => {
    const updatePayload = {
      metric_name: 'ESS Overall Engagement Index (Updated Test)',
      metric_weight: 15,
      target_value: 90,
      target_display: '90%',
      min_threshold: 80,
      is_employee_metric: true,
      target_audience: 'INTERNAL_EMPLOYEES'
    };

    const res = await fetch(`${BASE_URL}/api/admin/metrics/18`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatePayload)
    });
    assert.strictEqual(res.status, 200);
    const updated = await res.json();
    assert.strictEqual(updated.metric_name, updatePayload.metric_name);
    assert.strictEqual(updated.metric_weight, 15);
    assert.strictEqual(updated.target_value, 90);
  });

  await runTest('Reset parameters to defaults via POST /api/admin/parameters/reset', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/parameters/reset`, {
      method: 'POST'
    });
    assert.strictEqual(res.status, 200);
    const result = await res.json();
    assert.strictEqual(result.success, true);

    // Verify Metric 18 is reset
    const paramsRes = await fetch(`${BASE_URL}/api/admin/parameters`);
    const params = await paramsRes.json();
    const m18 = params.metrics.find(m => m.metric_id === 18);
    assert.strictEqual(m18.metric_name, 'Leadership Connection Score (ESS)');
    assert.strictEqual(m18.metric_weight, 1.0);
  });

  // --- SUMMARY ---
  console.log('\n================================================================');
  console.log(`📊 REGRESSION TEST SUMMARY: ${passedTests}/${totalTests} Tests Passed (${failedTests} Failed)`);
  console.log('================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runRegressionSuite().catch(err => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
