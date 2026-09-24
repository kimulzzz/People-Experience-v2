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
  await runTest('Monthly trends endpoint returns only complete months (Jan..last complete month), with scores and sample counts', async () => {
    const res = await fetch(`${BASE_URL}/api/metrics/trends`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    const trends = data.trends || data;
    assert(typeof data.last_complete_month === 'string', 'Response must report last_complete_month');
    assert.strictEqual(trends.length, parseInt(data.last_complete_month, 10), `Default range must be Jan..last_complete_month (${data.last_complete_month}), got ${trends.length} points`);

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

    try {
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
    } finally {
      await fetch(`${BASE_URL}/api/events/ev-perspektif-2024-q1/feedback/${testNip}`, { method: 'DELETE' });
      await fetch(`${BASE_URL}/api/events/ev-perspektif-2024-q1/attendance/${testNip}`, { method: 'DELETE' });
    }
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

  // --- 17. OLLAMA-POWERED SCORE DEFICIT ALERT NARRATIVES ---
  console.log('\n📦 MODULE 17: Ollama-Powered Score Deficit Alert Narratives');
  await runTest('Alerts endpoint returns a narrative_summary for every deficient metric (Ollama or offline fallback)', async () => {
    const res = await fetch(`${BASE_URL}/api/alerts`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert(Array.isArray(data.alerts), 'alerts must be an array');
    assert(data.total_alerts === data.alerts.length, 'total_alerts count must match alerts array length');
    data.alerts.forEach(a => {
      assert(typeof a.narrative_summary === 'string' && a.narrative_summary.length > 20, `Alert for metric ${a.metric_id} must have a non-trivial narrative_summary`);
    });
  });

  // --- 18. PEOPLE EXPERIENCE PERFORMANCE TREND (DYNAMIC MONTHLY MOVEMENT) ---
  console.log('\n📦 MODULE 18: Performance Trend — Dynamic Monthly Movement Through the Last COMPLETE Month');
  await runTest('Monthly trends NEVER include the current in-progress month or beyond — the series stops exactly at the last complete month', async () => {
    const res = await fetch(`${BASE_URL}/api/metrics/trends`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    const trends = data.trends || data;

    const today = new Date();
    // Last COMPLETE month (0-based index) — the in-progress current month is not "actual" yet.
    const lastCompleteMonthIdx = (today.getFullYear() === 2026) ? (today.getMonth() - 1) : 11;

    // The series must be EXACTLY Jan..last-complete-month — not padded out to 12 months with
    // a forecast tail anymore (regression guard: user reported the chart still showing
    // through December when today is September and only Jan-Aug should appear).
    assert.strictEqual(trends.length, lastCompleteMonthIdx + 1, `Trend series must contain exactly ${lastCompleteMonthIdx + 1} months (Jan..last complete), got ${trends.length}`);

    const currentCalendarMonthCode = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    assert(!trends.some(t => t.month_code === currentCalendarMonthCode), `The current in-progress month (${currentCalendarMonthCode}) must not appear in the trend series at all`);

    // Every returned month should be backed by actual data
    trends.forEach((t, i) => {
      assert.strictEqual(t.has_actual_data, true, `Month index ${i} (${t.month_name}) should have actual data by now`);
      assert(t.response_count > 0, `Month index ${i} (${t.month_name}) should have survey responses`);
    });

    // The survey index (which IS backed by real per-month response data) must not be
    // perfectly flat across the actual-data months (regression guard for the original
    // "flat trend line" bug). Outcome index is intentionally allowed to stay constant —
    // OUTCOME metrics in this app are a current HR-system snapshot, not a monthly
    // time-series, so a static outcome_index per month is honest, not a bug.
    const surveyValues = trends.map(t => t.survey_index);
    const uniqueSurveyValues = new Set(surveyValues);
    assert(uniqueSurveyValues.size > 1, 'Survey index must vary month-to-month, not stay flat');
  });

  await runTest('Trend chart is consistent with the main scorecard for the same bounded period (regression guard for the ~59% chart vs ~83% scorecard bug)', async () => {
    const today = new Date();
    const lastCompleteMonthIdx = (today.getFullYear() === 2026) ? (today.getMonth() - 1) : 11;
    const endMonthPadded = String(lastCompleteMonthIdx + 1).padStart(2, '0');

    // Compare against a YTD scorecard bounded to the SAME "Jan..last complete month" window
    // (not the unbounded full-year YTD, which legitimately also includes the current
    // in-progress month's partial data and would no longer match after the August-cutoff fix).
    const resScorecard = await fetch(`${BASE_URL}/api/metrics/calculate?mode=YTD&endMonth=${endMonthPadded}`);
    assert.strictEqual(resScorecard.status, 200);
    const scorecard = await resScorecard.json();

    const resTrends = await fetch(`${BASE_URL}/api/metrics/trends?mode=YTD`);
    assert.strictEqual(resTrends.status, 200);
    const trends = (await resTrends.json()).trends;
    const lastCompleteMonthPoint = trends[lastCompleteMonthIdx];

    // The trend chart's cumulative-YTD point for the last complete month must match the
    // equivalently-bounded scorecard (both derive from calculatePEIndex's same per-metric
    // weighted normalization) — within floating point rounding tolerance.
    assert(Math.abs(lastCompleteMonthPoint.survey_index - scorecard.survey_index) < 0.5, `Trend survey_index (${lastCompleteMonthPoint.survey_index}) must match scorecard survey_index (${scorecard.survey_index})`);
    assert(Math.abs(lastCompleteMonthPoint.outcome_index - scorecard.outcome_index) < 0.5, `Trend outcome_index (${lastCompleteMonthPoint.outcome_index}) must match scorecard outcome_index (${scorecard.outcome_index})`);
    assert(Math.abs(lastCompleteMonthPoint.px_index - scorecard.px_index) < 0.5, `Trend px_index (${lastCompleteMonthPoint.px_index}) must match scorecard px_index (${scorecard.px_index})`);
  });

  await runTest('Trend chart respects the Dashboard YTD/MTD toggle: YTD is cumulative, MTD is standalone per month', async () => {
    const resYtd = await fetch(`${BASE_URL}/api/metrics/trends?mode=YTD`);
    assert.strictEqual(resYtd.status, 200);
    const ytd = (await resYtd.json()).trends;

    const resMtd = await fetch(`${BASE_URL}/api/metrics/trends?mode=MTD`);
    assert.strictEqual(resMtd.status, 200);
    const mtd = (await resMtd.json()).trends;

    // YTD response_count must accumulate (non-decreasing) month over month through the
    // actual-data range (Jan..last complete month), since it represents cumulative responses.
    const today = new Date();
    const lastCompleteMonthIdx = (today.getFullYear() === 2026) ? (today.getMonth() - 1) : 11;
    for (let i = 1; i <= lastCompleteMonthIdx; i++) {
      assert(ytd[i].response_count >= ytd[i - 1].response_count, `YTD response_count must accumulate: month ${i} (${ytd[i].response_count}) should be >= month ${i - 1} (${ytd[i - 1].response_count})`);
    }
    // The final actual month's YTD cumulative response_count must be strictly greater than
    // that same month's MTD standalone response_count (cumulative always includes more).
    assert(ytd[lastCompleteMonthIdx].response_count > mtd[lastCompleteMonthIdx].response_count, 'YTD cumulative response_count should exceed MTD standalone response_count for the same month');

    // The two modes must genuinely produce different series (not the same data reused) —
    // regression guard for the original bug where the trend chart ignored the YTD/MTD toggle.
    const ytdSurveyValues = JSON.stringify(ytd.map(t => t.survey_index));
    const mtdSurveyValues = JSON.stringify(mtd.map(t => t.survey_index));
    assert.notStrictEqual(ytdSurveyValues, mtdSurveyValues, 'YTD and MTD trend series must differ — the chart must respect the Dashboard mode toggle');
  });

  // --- 19. PERIODIC DATA UPDATE FREQUENCY PARAMETER ---
  console.log('\n📦 MODULE 19: Periodic Data Update Frequency Parameter (Frekuensi Update Data)');
  await runTest('Every metric exposes an update_frequency of MONTHLY or ONE_TIME_ANNUAL', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/parameters`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    data.metrics.forEach(m => {
      assert(['MONTHLY', 'ONE_TIME_ANNUAL'].includes(m.update_frequency), `Metric ${m.metric_id} has invalid update_frequency: ${m.update_frequency}`);
    });
    // ESS metrics are annual-once by default (real-world CIMB HR practice)
    const essMetric = data.metrics.find(m => (m.source_of_data || '').includes('ESS'));
    assert(essMetric, 'Expected at least one ESS metric in the seed data');
    assert.strictEqual(essMetric.update_frequency, 'ONE_TIME_ANNUAL', 'ESS metrics should default to ONE_TIME_ANNUAL');
  });

  await runTest('Admin can update a metric\'s update_frequency via PUT /api/admin/metrics/:id', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/metrics/6`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ update_frequency: 'one_time_annual' })
    });
    assert.strictEqual(res.status, 200);
    const updated = await res.json();
    assert.strictEqual(updated.update_frequency, 'ONE_TIME_ANNUAL');

    // Revert so it doesn't affect other tests / the reset test below
    await fetch(`${BASE_URL}/api/admin/metrics/6`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ update_frequency: 'MONTHLY' })
    });
  });

  // --- 20. MANUAL SURVEY UPLOAD REMINDER (PIC / DEADLINE / EMAIL) ---
  console.log('\n📦 MODULE 20: Manual Survey Upload Reminder (PIC, Deadline & Email Settings)');
  await runTest('SURVEY metrics expose requires_manual_upload, upload_deadline_day, pic_name and pic_email', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/parameters`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    const surveyMetric = data.metrics.find(m => m.metric_type === 'SURVEY');
    assert(surveyMetric, 'Expected at least one SURVEY metric');
    assert.strictEqual(typeof surveyMetric.requires_manual_upload, 'boolean');
    assert(surveyMetric.upload_deadline_day >= 1 && surveyMetric.upload_deadline_day <= 28, 'upload_deadline_day must be a valid day-of-month');
    assert(typeof surveyMetric.pic_name === 'string' && surveyMetric.pic_name.length > 0, 'pic_name must be set');
    assert(typeof surveyMetric.pic_email === 'string' && surveyMetric.pic_email.includes('@'), 'pic_email must look like an email address');
  });

  await runTest('GET /api/admin/upload-reminders returns a well-formed pending-reminders summary', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/upload-reminders`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert(typeof data.total_reminders === 'number');
    assert(typeof data.overdue_count === 'number');
    assert(typeof data.due_soon_count === 'number');
    assert(Array.isArray(data.reminders));
    data.reminders.forEach(r => {
      assert(['OVERDUE', 'DUE_SOON'].includes(r.status));
    });
  });

  await runTest('POST /api/admin/upload-reminders/send never throws even without SMTP configured (graceful on-premise fallback)', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/upload-reminders/send`, { method: 'POST' });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert(typeof data.smtp_configured === 'boolean');
  });

  // --- 21. DATA INTEGRITY AUDIT FIXES (POSITIVE + NEGATIVE TESTING) ---
  // Regression guards for the Auditor subagent's confirmed findings: (1) OUTCOME metrics'
  // "last ingestion date" moved from a hardcoded code map into a real database field, (2) the
  // default year is derived from the real clock instead of a frozen '2026' literal, (3) Score
  // Deficit Alert verbatims aggregate across ALL signature events instead of one hardcoded
  // event ID. Also covers general negative-path / bad-input robustness for the endpoints
  // touched this session.
  console.log('\n📦 MODULE 21: Data Integrity Audit Fixes (Positive & Negative Testing)');

  await runTest('[POSITIVE] OUTCOME metrics expose last_data_date as a real, admin-editable database field', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/parameters`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    const outcomeMetric = data.metrics.find(m => m.metric_type === 'OUTCOME');
    assert(outcomeMetric, 'Expected at least one OUTCOME metric');
    assert(/^\d{4}-\d{2}-\d{2}$/.test(outcomeMetric.last_data_date || ''), `OUTCOME metric ${outcomeMetric.metric_id} must expose a valid last_data_date (got: ${outcomeMetric.last_data_date})`);
  });

  await runTest('[POSITIVE] Editing an OUTCOME metric\'s last_data_date via Admin persists and is reflected in calculation output', async () => {
    const newDate = '2026-08-15';
    const resUpdate = await fetch(`${BASE_URL}/api/admin/metrics/1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ last_data_date: newDate })
    });
    assert.strictEqual(resUpdate.status, 200);
    const updated = await resUpdate.json();
    assert.strictEqual(updated.last_data_date, newDate, 'Updated last_data_date must be persisted, not silently overridden by a hardcoded fallback');

    const resCalc = await fetch(`${BASE_URL}/api/metrics/calculate?period=YTD`);
    const calc = await resCalc.json();
    const m1 = calc.metrics.find(m => m.metric_id === 1);
    assert.strictEqual(m1.last_survey_date, newDate, 'Calculation output must reflect the admin-edited last_data_date, confirming the value is read from storage, not a hardcoded map');

    // Cleanup: restore original default so it doesn't affect other tests / a later reset
    await fetch(`${BASE_URL}/api/admin/metrics/1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ last_data_date: '2026-03-24' })
    });
  });

  await runTest('[POSITIVE] Score Deficit Alerts aggregate verbatim feedback across ALL events, not one hardcoded event ID', async () => {
    // Create a brand-new signature event (i.e. NOT the pre-existing hardcoded
    // 'ev-perspektif-2024-q1' event) and confirm the alerts endpoint still computes cleanly —
    // regression guard for the fixed hardcoded-event-ID bug in alertEngine.js.
    const resEvent = await fetch(`${BASE_URL}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_name: 'Regression Test Event (Audit Fix Check)',
        program_category: 'Testing',
        event_type: 'Online',
        event_date: '2026-08-20',
        target_participants: 10
      })
    });
    assert.strictEqual(resEvent.status, 201);
    const createdEvent = (await resEvent.json()).event;

    try {
      const resAlerts = await fetch(`${BASE_URL}/api/alerts`);
      assert.strictEqual(resAlerts.status, 200);
      const alerts = await resAlerts.json();
      assert(Array.isArray(alerts.alerts), 'Alerts must still compute successfully with multiple events in the database');
    } finally {
      // Clean up — this test's whole point is to exist as a SECOND event alongside the seeded
      // one, not to leave test clutter behind in the Signature Program Events list. Runs even
      // if the assertion above fails, via `finally`.
      await fetch(`${BASE_URL}/api/events/${createdEvent.event_id}`, { method: 'DELETE' });
    }
  });

  await runTest('[POSITIVE] Default year for an unspecified period is derived from the real server clock, not a frozen literal', async () => {
    const res = await fetch(`${BASE_URL}/api/metrics/calculate`); // no period/year/mode at all
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    const expectedYear = String(new Date().getFullYear());
    assert.strictEqual(data.year, expectedYear, `Default year must equal the real current year (${expectedYear}), got ${data.year}`);
  });

  await runTest('[NEGATIVE] Updating a non-existent metric ID returns a clean 400 error, not a server crash', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/metrics/99999`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metric_name: 'Should Not Exist' })
    });
    assert.strictEqual(res.status, 400, 'A non-existent metric_id must return 400, not 500 or a hang');
    const data = await res.json();
    assert(typeof data.error === 'string' && data.error.length > 0, 'Error response must include a message');
  });

  await runTest('[NEGATIVE] Malformed/garbage period string does not crash the calculate endpoint — falls back to sane YTD defaults', async () => {
    const res = await fetch(`${BASE_URL}/api/metrics/calculate?period=not-a-real-period`);
    assert.strictEqual(res.status, 200, 'A garbage period string must not crash the server');
    const data = await res.json();
    assert.strictEqual(data.mode, 'YTD', 'Unparseable period must fall back to YTD mode');
    assert(data.px_index >= 0 && data.px_index <= 100, 'px_index must still be a sane 0-100 value');
  });

  await runTest('[NEGATIVE] Invalid mode value on the trends endpoint does not crash — falls back to YTD', async () => {
    const res = await fetch(`${BASE_URL}/api/metrics/trends?mode=NOT_A_MODE`);
    assert.strictEqual(res.status, 200, 'An invalid mode must not crash the trends endpoint');
    const data = await res.json();
    assert.strictEqual(data.mode, 'YTD', 'Invalid mode must fall back to YTD (mirrors calculatePEIndex\'s default)');
    assert.strictEqual(data.trends.length, parseInt(data.last_complete_month, 10), 'Trend series must still cover exactly Jan..last_complete_month');
  });

  await runTest('[NEGATIVE] Requesting a metric ID that does not exist returns a clean error, not a 500 crash', async () => {
    const res = await fetch(`${BASE_URL}/api/metrics/99999/detail`);
    assert([400, 404].includes(res.status), `Non-existent metric detail must return 400 or 404, got ${res.status}`);
  });

  // --- 22. TREND CHART PERIOD-RANGE FILTER (POSITIVE + NEGATIVE TESTING) ---
  // Regression guard for the "chart still shows through December" follow-up: the trend
  // series must NEVER include the in-progress/future months by default, and the new
  // start/end period-range filter must let the caller narrow the view while still being
  // hard-clamped so it can never reach an incomplete month, no matter what it's asked for.
  console.log('\n📦 MODULE 22: Trend Chart Period-Range Filter (Positive & Negative Testing)');

  await runTest('[POSITIVE] startMonth/endMonth narrows the trend series to the requested sub-range', async () => {
    const res = await fetch(`${BASE_URL}/api/metrics/trends?mode=YTD&startMonth=03&endMonth=06`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.trends.length, 4, 'Maret..Juni must return exactly 4 points');
    assert.strictEqual(data.trends[0].month_code.slice(5), '03', 'First point must be March');
    assert.strictEqual(data.trends[3].month_code.slice(5), '06', 'Last point must be June');
  });

  await runTest('[POSITIVE] A single-month range (startMonth === endMonth) returns exactly one point', async () => {
    const res = await fetch(`${BASE_URL}/api/metrics/trends?mode=MTD&startMonth=05&endMonth=05`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.trends.length, 1, 'A single-month range must return exactly one point');
    assert.strictEqual(data.trends[0].month_name, 'Mei');
  });

  await runTest('[NEGATIVE] endMonth is hard-clamped to the last complete month even if a later month is requested', async () => {
    const res = await fetch(`${BASE_URL}/api/metrics/trends?mode=YTD&startMonth=01&endMonth=12`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    const lastComplete = parseInt(data.last_complete_month, 10);
    assert.strictEqual(data.trends.length, lastComplete, `Requesting up to month 12 must still clamp to last_complete_month (${lastComplete}) worth of points`);
    assert(!data.trends.some(t => parseInt(t.month_code.slice(5), 10) > lastComplete), 'No returned point may be later than the last complete month, regardless of what endMonth was requested');
  });

  await runTest('[NEGATIVE] startMonth after endMonth does not crash — server reconciles the range instead of erroring', async () => {
    const res = await fetch(`${BASE_URL}/api/metrics/trends?mode=YTD&startMonth=06&endMonth=02`);
    assert.strictEqual(res.status, 200, 'An inverted range must not crash the endpoint');
    const data = await res.json();
    assert(Array.isArray(data.trends) && data.trends.length >= 1, 'Must still return a sane, non-empty (or at minimum non-crashing) series');
  });

  await runTest('[NEGATIVE] Garbage startMonth/endMonth values do not crash the endpoint', async () => {
    const res = await fetch(`${BASE_URL}/api/metrics/trends?startMonth=abc&endMonth=xyz`);
    assert.strictEqual(res.status, 200, 'Non-numeric range params must not crash the endpoint');
    const data = await res.json();
    assert(Array.isArray(data.trends), 'Must still return a valid trends array');
  });

  // --- 23. PRIOR-YEAR (2025) SEED DATA & CROSS-YEAR TREND RANGE (POSITIVE + NEGATIVE TESTING) ---
  // Regression guard for the user's report that 2025 still looked hardcoded (identical
  // numbers no matter the year, because no 2025 survey responses actually existed in the
  // database — only each metric's static fallback default), and for the new ability to
  // build a Performance Trend range that genuinely spans a year boundary.
  console.log('\n📦 MODULE 23: Prior-Year (2025) Seed Data & Cross-Year Trend Range (Positive & Negative Testing)');

  await runTest('[POSITIVE] 2025 has real database-backed survey responses, not just static per-metric fallback values', async () => {
    const res2025 = await fetch(`${BASE_URL}/api/metrics/calculate?mode=YTD&year=2025`);
    assert.strictEqual(res2025.status, 200);
    const data2025 = await res2025.json();
    const surveyMetric = data2025.metrics.find(m => m.metric_type === 'SURVEY' && !m.is_disabled);
    assert(surveyMetric.sample_size > 0, `A SURVEY metric for year 2025 (metric ${surveyMetric.metric_id}) must have sample_size > 0 — i.e. real 2025-dated responses in the database, not the metric's static default`);

    // 2025 and 2026 must not be identical — that would indicate both years are just reading
    // the same static per-metric fallback instead of genuinely different per-year data.
    const res2026 = await fetch(`${BASE_URL}/api/metrics/calculate?mode=YTD&year=2026`);
    const data2026 = await res2026.json();
    assert.notStrictEqual(data2025.survey_index, data2026.survey_index, `2025 survey_index (${data2025.survey_index}) must differ from 2026's (${data2026.survey_index}) — identical values would mean 2025 is still just reusing static fallback data instead of its own seeded responses`);
  });

  await runTest('[POSITIVE] A fully past year (2025) returns all 12 months as complete', async () => {
    const res = await fetch(`${BASE_URL}/api/metrics/trends?mode=YTD&year=2025`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.last_complete_month, '12', 'A year entirely in the past must report December as its last complete month');
    assert.strictEqual(data.trends.length, 12, 'A fully past year must return all 12 months');
    assert(data.trends.every(t => t.response_count > 0), 'Every 2025 month must have real survey response data');
  });

  await runTest('[POSITIVE] available_years reflects the database (includes both 2025 and 2026)', async () => {
    const res = await fetch(`${BASE_URL}/api/metrics/trends`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert(Array.isArray(data.available_years), 'available_years must be an array');
    assert(data.available_years.includes('2025'), 'available_years must include 2025 (now that it has real seed data)');
    assert(data.available_years.includes('2026'), 'available_years must include 2026');
  });

  await runTest('[POSITIVE] A cross-year range (Nov 2025 s/d Feb 2026) returns correctly ordered points spanning both years, with YTD resetting at the year boundary', async () => {
    const res = await fetch(`${BASE_URL}/api/metrics/trends?mode=YTD&startYear=2025&startMonth=11&endYear=2026&endMonth=02`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.trends.length, 4, 'Nov 2025..Feb 2026 must be exactly 4 points');
    assert.deepStrictEqual(data.trends.map(t => t.month_code), ['2025-11', '2025-12', '2026-01', '2026-02'], 'Points must be in chronological order across the year boundary');
    assert(data.trends.every((t, i) => t.year === data.trends[i].month_code.slice(0, 4)), 'Each point\'s year field must match its own month_code');

    // YTD must reset on Jan 1 — January 2026's cumulative response_count must NOT be greater
    // than December 2025's (it would be, if the cumulative window incorrectly spanned both
    // years instead of restarting each January).
    const dec2025 = data.trends.find(t => t.month_code === '2025-12');
    const jan2026 = data.trends.find(t => t.month_code === '2026-01');
    assert(jan2026.response_count < dec2025.response_count, `January 2026's YTD-cumulative response_count (${jan2026.response_count}) must be less than December 2025's full-year total (${dec2025.response_count}) — confirms YTD resets at the year boundary instead of accumulating across years`);
  });

  await runTest('[NEGATIVE] A cross-year range reaching into a future year still clamps to the real last complete month, not crash', async () => {
    const res = await fetch(`${BASE_URL}/api/metrics/trends?mode=MTD&startYear=2025&startMonth=01&endYear=2030&endMonth=06`);
    assert.strictEqual(res.status, 200, 'A range reaching a far-future year must not crash');
    const data = await res.json();
    assert(data.trends.length > 0, 'Must still return a non-empty, sane series');
    const lastPoint = data.trends[data.trends.length - 1];
    assert(parseInt(lastPoint.month_code.slice(0, 4), 10) <= new Date().getFullYear(), 'No point may belong to a year later than the real current year');
  });

  await runTest('[NEGATIVE] An inverted cross-year range (start year/month after end year/month) reconciles instead of crashing', async () => {
    const res = await fetch(`${BASE_URL}/api/metrics/trends?mode=YTD&startYear=2026&startMonth=02&endYear=2025&endMonth=11`);
    assert.strictEqual(res.status, 200, 'An inverted cross-year range must not crash');
    const data = await res.json();
    assert(Array.isArray(data.trends) && data.trends.length > 0, 'Must still return a sane, non-empty series after reconciling the inverted range');
  });

  // --- 24. EVENT / ATTENDANCE / FEEDBACK DELETE ENDPOINTS (TEST-HYGIENE CLEANUP ROUTES) ---
  console.log('\n📦 MODULE 24: Event, Attendance & Feedback Deletion (Positive & Negative Testing)');
  await runTest('[POSITIVE] DELETE /api/events/:id removes an event and its attendance/feedback records', async () => {
    const resEvent = await fetch(`${BASE_URL}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_name: 'Regression Test Event (Module 24 Delete Check)',
        program_category: 'Testing',
        event_type: 'Online',
        event_date: '2026-08-20',
        target_participants: 10
      })
    });
    assert.strictEqual(resEvent.status, 201);
    const createdEvent = (await resEvent.json()).event;

    const delRes = await fetch(`${BASE_URL}/api/events/${createdEvent.event_id}`, { method: 'DELETE' });
    assert.strictEqual(delRes.status, 200);
    const delData = await delRes.json();
    assert.strictEqual(delData.success, true);

    const getRes = await fetch(`${BASE_URL}/api/events/${createdEvent.event_id}`);
    assert.strictEqual(getRes.status, 404, 'Deleted event must no longer be retrievable');
  });

  await runTest('[POSITIVE] DELETE /api/events/:id/attendance/:nip and /feedback/:nip remove only the targeted record', async () => {
    const testNip = `880${Math.floor(1000 + Math.random() * 9000)}`;
    const attRes = await fetch(`${BASE_URL}/api/events/ev-perspektif-2024-q1/attendance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nip: testNip,
        employee_name: 'Module 24 Delete Check',
        cimb_email: `user.${testNip}@cimbniaga.co.id`,
        directorate: 'Information Technology',
        division: 'Digital Platform'
      })
    });
    assert([200, 201].includes(attRes.status));
    const fbRes = await fetch(`${BASE_URL}/api/events/ev-perspektif-2024-q1/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nip: testNip,
        ratings: { 'q-relevance': 5, 'q-speaker': 5, 'q-delivery': 5, 'q-overall': 5 },
        verbatim: 'Module 24 delete-endpoint check.'
      })
    });
    assert([200, 201].includes(fbRes.status));

    const delFb = await fetch(`${BASE_URL}/api/events/ev-perspektif-2024-q1/feedback/${testNip}`, { method: 'DELETE' });
    assert.strictEqual(delFb.status, 200);
    const delAtt = await fetch(`${BASE_URL}/api/events/ev-perspektif-2024-q1/attendance/${testNip}`, { method: 'DELETE' });
    assert.strictEqual(delAtt.status, 200);

    const eventDetail = await (await fetch(`${BASE_URL}/api/events/ev-perspektif-2024-q1`)).json();
    assert(!eventDetail.attendances.some(a => a.nip === testNip), 'Deleted attendance must no longer be present');
    assert(!eventDetail.feedbacks.some(f => f.nip === testNip), 'Deleted feedback must no longer be present');
  });

  await runTest('[NEGATIVE] Deleting a non-existent event returns a clean 400, not a crash', async () => {
    const res = await fetch(`${BASE_URL}/api/events/does-not-exist-12345`, { method: 'DELETE' });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert(data.error, 'Response must include an error message');
  });

  await runTest('[NEGATIVE] Deleting a non-existent attendance record returns a clean 400, not a crash', async () => {
    const res = await fetch(`${BASE_URL}/api/events/ev-perspektif-2024-q1/attendance/0000000`, { method: 'DELETE' });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert(data.error, 'Response must include an error message');
  });

  await runTest('[NEGATIVE] Deleting a non-existent feedback record returns a clean 400, not a crash', async () => {
    const res = await fetch(`${BASE_URL}/api/events/ev-perspektif-2024-q1/feedback/0000000`, { method: 'DELETE' });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert(data.error, 'Response must include an error message');
  });

  // --- 25. TARGET / THRESHOLD UNIT CONSISTENCY (POSITIVE TESTING) ---
  console.log('\n📦 MODULE 25: Target & Min Threshold Unit Consistency (Positive Testing)');
  await runTest('[POSITIVE] target_value_normalized converts a RATING_5 raw target (1-5 scale) into the same 0-100 % scale as min_threshold', async () => {
    const res = await fetch(`${BASE_URL}/api/metrics/calculate`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    const metric2 = data.metrics.find(m => m.metric_id === 2);
    assert(metric2, 'Metric #2 (CIMB Niaga Goes to Campus — event evaluation / rating) must exist');
    assert.strictEqual(metric2.scale_type, 'RATING_5');
    const expectedNormalizedTarget = parseFloat(((parseFloat(metric2.target_value) / 5) * 100).toFixed(2));
    assert.strictEqual(metric2.target_value_normalized, expectedNormalizedTarget, `target_value_normalized must equal target_value/5*100 (${expectedNormalizedTarget}), got ${metric2.target_value_normalized} — Target (raw ${metric2.target_value}) and Min Threshold (${metric2.min_threshold}%) must now be directly comparable in the same unit`);
  });

  await runTest('[POSITIVE] Status classification (HEALTHY/WARNING/CRITICAL) compares the normalized score against the normalized target, not the raw scale-native target_value', async () => {
    const res = await fetch(`${BASE_URL}/api/metrics/calculate`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    const scaleMetrics = data.metrics.filter(m => m.scale_type === 'RATING_5' || m.scale_type === 'QUOTA_COUNT');
    assert(scaleMetrics.length > 0, 'There must be at least one RATING_5/QUOTA_COUNT metric to regression-guard');
    scaleMetrics.forEach(m => {
      let expectedStatus;
      if (m.normalized_score < m.min_threshold) {
        expectedStatus = 'CRITICAL';
      } else if (m.normalized_score < m.target_value_normalized) {
        expectedStatus = 'WARNING';
      } else {
        expectedStatus = 'HEALTHY';
      }
      assert.strictEqual(m.status, expectedStatus, `Metric #${m.metric_id} (${m.metric_name}): expected ${expectedStatus} but got ${m.status} — score=${m.normalized_score}, min_threshold=${m.min_threshold}, target%=${m.target_value_normalized}. Before the fix, WARNING was unreachable for scale-based metrics because the raw target_value (e.g. 4 on a 1-5 scale) was compared directly against a 0-100 normalized score.`);
    });
  });

  await runTest('[POSITIVE] GET /api/admin/parameters exposes target_value_normalized (0-100) for every metric, matching min_threshold\'s unit for the Admin Parameters table', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/parameters`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert(Array.isArray(data.metrics) && data.metrics.length > 0, 'Must return a non-empty metrics list');
    data.metrics.forEach(m => {
      assert(typeof m.target_value_normalized === 'number', `Metric #${m.metric_id} must expose a numeric target_value_normalized`);
      assert(m.target_value_normalized >= 0 && m.target_value_normalized <= 100, `Metric #${m.metric_id}'s target_value_normalized (${m.target_value_normalized}) must be within the 0-100 % range shared with min_threshold`);
    });
  });

  await runTest('[POSITIVE] GET /api/metrics/:id/detail also exposes target_value_normalized for both SURVEY and OUTCOME metric types', async () => {
    const surveyRes = await fetch(`${BASE_URL}/api/metrics/2/detail?period=YTD`); // SURVEY, RATING_5
    assert.strictEqual(surveyRes.status, 200);
    const surveyData = await surveyRes.json();
    assert.strictEqual(surveyData.metric_type, 'SURVEY');
    assert.strictEqual(surveyData.target_value_normalized, 80, 'Metric #2 target 4.00/5.0 must normalize to 80%');

    const outcomeRes = await fetch(`${BASE_URL}/api/metrics/1/detail?period=YTD`); // OUTCOME, PERCENTAGE
    assert.strictEqual(outcomeRes.status, 200);
    const outcomeData = await outcomeRes.json();
    assert.strictEqual(outcomeData.metric_type, 'OUTCOME');
    assert(typeof outcomeData.target_value_normalized === 'number', 'OUTCOME metric detail must also expose target_value_normalized');
  });

  // --- 26. HARDCODE AUDIT FOLLOW-UP: OPERATIONAL RECORDS, LIVE EVENT QUOTA & RESPONDENT COUNTS (POSITIVE TESTING) ---
  console.log('\n📦 MODULE 26: Hardcode Audit Follow-up — Operational Records, Live Quota & Respondent Counts (Positive Testing)');
  await runTest('[POSITIVE] OUTCOME metrics\' operational_records drilldown tables are sourced from the database (storage.getOperationalRecords), not frozen inline in calculationEngine.js', async () => {
    const res1 = await fetch(`${BASE_URL}/api/metrics/1/detail?period=YTD`);
    assert.strictEqual(res1.status, 200);
    const data1 = await res1.json();
    assert(Array.isArray(data1.operational_records) && data1.operational_records.length === 5, 'Metric #1 (Recruitment SLA) must expose its 5-unit breakdown table');
    assert(data1.operational_records[0].unit && data1.operational_records[0].sla_achievement, 'Metric #1 records must have the expected unit/sla_achievement shape');

    const res14 = await fetch(`${BASE_URL}/api/metrics/14/detail?period=YTD`);
    assert.strictEqual(res14.status, 200);
    const data14 = await res14.json();
    assert(Array.isArray(data14.operational_records) && data14.operational_records.length === 3, 'Metric #14 (Recognition categories) must expose its 3-category breakdown table');

    // An OUTCOME metric with no seeded operational-records table (e.g. #19, Mandatory Learning
    // Satisfaction) must not crash — storage.getOperationalRecords() returns [] rather than
    // throwing when the store has no entry for that metric_id.
    const res19 = await fetch(`${BASE_URL}/api/metrics/19/detail?period=YTD`);
    assert.strictEqual(res19.status, 200);
    const data19 = await res19.json();
    assert(Array.isArray(data19.operational_records), 'An OUTCOME metric with no seeded breakdown table must still return an array (empty), not crash');

    // A plain SURVEY metric must not crash either.
    const res2 = await fetch(`${BASE_URL}/api/metrics/2/detail?period=YTD`);
    assert.strictEqual(res2.status, 200);
  });

  await runTest('[POSITIVE] Metric #11\'s live event participation score normalizes against its own admin-editable Target Nilai, not a hardcoded 500-pax quota', async () => {
    const originalMetric = await (await fetch(`${BASE_URL}/api/admin/parameters`)).json();
    const metric11Before = originalMetric.metrics.find(m => m.metric_id === 11);
    assert(metric11Before, 'Metric #11 (Signature Program participation rate) must exist');
    const originalTarget = metric11Before.target_value;

    try {
      // Change the quota target far enough that normalized_score visibly shifts if (and only
      // if) the live-sync calculation actually reads this field instead of a frozen literal.
      const newTarget = 10; // deliberately tiny, so even a handful of real attendees looks close to 100%
      const updateRes = await fetch(`${BASE_URL}/api/admin/metrics/11`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_value: newTarget })
      });
      assert.strictEqual(updateRes.status, 200);

      const calcRes = await fetch(`${BASE_URL}/api/metrics/calculate`);
      const calcData = await calcRes.json();
      const metric11After = calcData.metrics.find(m => m.metric_id === 11);
      assert(metric11After.raw_value > 0, 'There must be real attendance data seeded for metric #11 for this test to be meaningful');
      const expectedNormScore = Math.min((metric11After.raw_value / newTarget) * 100, 100);
      assert(Math.abs(metric11After.normalized_score - expectedNormScore) < 1, `normalized_score (${metric11After.normalized_score}) must track the new admin-set target (${newTarget}), expected ~${expectedNormScore.toFixed(2)} — regression guard against a hardcoded 500-pax denominator`);
    } finally {
      // Restore the original target so this test doesn't leave Metric #11 permanently altered.
      await fetch(`${BASE_URL}/api/admin/metrics/11`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_value: originalTarget })
      });
    }
  });

  await runTest('[POSITIVE] total_respondents reports the real database count — 0 for a brand-new metric with zero responses, not a fabricated placeholder', async () => {
    const createRes = await fetch(`${BASE_URL}/api/admin/metrics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        metric_name: 'Regression Test ESS Metric (Module 26 Hardcode Check)',
        journey_id: 3,
        checkpoint_id: 7,
        metric_type: 'SURVEY',
        scale_type: 'RATING_5',
        source_of_data: 'ESS (Employee Sentiment Survey)',
        target_value: 4.0,
        min_threshold: 75
      })
    });
    assert.strictEqual(createRes.status, 201);
    const created = (await createRes.json()).metric;

    try {
      const detailRes = await fetch(`${BASE_URL}/api/metrics/${created.metric_id}/detail?period=YTD`);
      assert.strictEqual(detailRes.status, 200);
      const detail = await detailRes.json();
      assert.strictEqual(detail.total_respondents, 0, `A brand-new metric with zero real responses must report total_respondents=0, got ${detail.total_respondents} — regression guard against a fabricated "1250 ESS respondents" placeholder`);
    } finally {
      await fetch(`${BASE_URL}/api/admin/metrics/${created.metric_id}`, { method: 'DELETE' });
    }
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
