// tests/regressionTest.js
const assert = require('assert');

// Overridable so the suite can run against a second backend (e.g. one pointed at a fake transcribe API).
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:5000';
const TRANSCRIBE_PORT = parseInt(process.env.TEST_TRANSCRIBE_PORT || '8000', 10);

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

// --- LOGIN (v2.26.0): every /api route needs a session, so the suite logs in first. ---
// Credentials are never stored in the repo: either TEST_ADMIN_USER / TEST_ADMIN_PASSWORD (e.g. an account made
// with `npm run auth:create-admin`; required for the JSON backend, whose data the server keeps in memory) or, on
// SQL Server, a temporary admin that the suite creates itself (random password) and deletes at the end.
const realFetch = globalThis.fetch;
let suiteCookie = null;
// Every fetch to the app carries the suite admin's session cookie, unless the test sends its own Cookie header.
globalThis.fetch = (url, opts = {}) => {
  const headers = opts.headers || {};
  if (suiteCookie && String(url).startsWith(BASE_URL) && !('Cookie' in headers)) {
    return realFetch(url, { ...opts, headers: { ...headers, Cookie: suiteCookie } });
  }
  return realFetch(url, opts);
};
let tempAdmin = null; // { storage, user_id } when the suite created its own admin

async function setupSuiteLogin() {
  const login = async (username, password) => {
    const res = await realFetch(`${BASE_URL}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    if (res.status !== 200) throw new Error(`Suite login failed (HTTP ${res.status})`);
    const cookie = (res.headers.getSetCookie() || []).map(c => c.split(';')[0]).find(c => c.startsWith('px_session='));
    return { cookie, body: await res.json() };
  };
  let username = process.env.TEST_ADMIN_USER;
  let password = process.env.TEST_ADMIN_PASSWORD;
  if (!username || !password) {
    require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
    const storage = require('../server/db/storage');
    if (storage.backend !== 'sql') {
      throw new Error('Set TEST_ADMIN_USER and TEST_ADMIN_PASSWORD (create the account with `npm run auth:create-admin`) - the suite can only create its own admin on the SQL backend.');
    }
    const { hashPassword, generateTempPassword } = require('../server/services/authService');
    username = `rt-suite-${Date.now().toString(36)}`;
    password = generateTempPassword();
    const created = await storage.createUser({ username, full_name: 'Regression Suite Admin', email: '', role: 'ADMIN', password_hash: await hashPassword(password), must_change_password: false });
    tempAdmin = { storage, user_id: created.user_id };
  }
  let { cookie, body } = await login(username, password);
  if (body.user.must_change_password) { // a fresh `auth:create-admin` account: complete the forced change
    const newPassword = require('crypto').randomBytes(9).toString('hex') + 'Aa1';
    const res = await realFetch(`${BASE_URL}/api/auth/change-password`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ current_password: password, new_password: newPassword }) });
    if (res.status !== 200) throw new Error('Suite could not complete the forced password change');
  }
  suiteCookie = cookie;
}

async function teardownSuiteLogin() {
  if (tempAdmin) {
    await tempAdmin.storage.deleteUser(tempAdmin.user_id);
    if (typeof tempAdmin.storage.close === 'function') await tempAdmin.storage.close();
  }
}

async function runRegressionSuite() {
  console.log('\n================================================================');
  console.log('🧪 CIMB NIAGA PEOPLE EXPERIENCE (PX) - REGRESSION TESTING SUITE');
  console.log('================================================================\n');

  await setupSuiteLogin();

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
    assert(typeof data.due_today_count === 'number');
    assert(Array.isArray(data.reminders));
    data.reminders.forEach(r => {
      assert(['OVERDUE', 'DUE_TODAY'].includes(r.status));
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

  // --- 27. EVENT MEDIA GALLERY: VIEWABLE FILES + VIDEO AI TRANSCRIPT ---
  console.log('\n📦 MODULE 27: Event Media Upload, Viewing & Video AI Transcript (Positive & Negative Testing)');

  // Smallest valid 1x1 PNG — enough for the server to accept, store and serve an image upload.
  const TINY_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  const MEDIA_EVENT_ID = 'ev-perspektif-2024-q1';

  async function uploadMedia(buffer, filename, mimeType, extra = {}) {
    const form = new FormData();
    form.append('mediaFile', new Blob([buffer], { type: mimeType }), filename);
    Object.entries(extra).forEach(([k, v]) => form.append(k, v));
    return fetch(`${BASE_URL}/api/events/${MEDIA_EVENT_ID}/media`, { method: 'POST', body: form });
  }

  await runTest('[POSITIVE] An uploaded photo is stored as IMAGE (no transcript job) and is served back so it can be viewed', async () => {
    const res = await uploadMedia(TINY_PNG, 'regression-photo.png', 'image/png', { caption: 'Regression photo' });
    assert.strictEqual(res.status, 201);
    const media = (await res.json()).media;
    try {
      assert.strictEqual(media.file_type, 'IMAGE');
      assert.strictEqual(media.transcript_status, undefined, 'Photos must not get an AI transcript job');
      const fileRes = await fetch(`${BASE_URL}${media.file_path}`);
      assert.strictEqual(fileRes.status, 200, `Uploaded photo must be served at ${media.file_path}`);
      assert.ok((fileRes.headers.get('content-type') || '').startsWith('image/'), 'Photo must be served with an image/* content type');
    } finally {
      await fetch(`${BASE_URL}/api/media/${media.media_id}`, { method: 'DELETE' });
    }
  });

  await runTest('[POSITIVE] Deleting media also removes its file from disk (large videos must not be left orphaned)', async () => {
    const res = await uploadMedia(TINY_PNG, 'regression-delete.png', 'image/png');
    const media = (await res.json()).media;
    const delRes = await fetch(`${BASE_URL}/api/media/${media.media_id}`, { method: 'DELETE' });
    assert.strictEqual(delRes.status, 200);
    await new Promise(resolve => setTimeout(resolve, 300)); // unlink is fire-and-forget
    const fileRes = await fetch(`${BASE_URL}${media.file_path}`);
    assert.notStrictEqual(fileRes.status, 200, 'The uploaded file must be gone after its media record is deleted');
  });

  await runTest('[POSITIVE] An uploaded video is answered immediately as PROCESSING and its transcript job always settles (DONE or FAILED with a reason)', async () => {
    // Not a decodable video on purpose: the job must still terminate, with a reason, instead of
    // hanging on PROCESSING forever — whether or not the local transcribe API is running.
    const res = await uploadMedia(Buffer.from('not really a video'), 'regression-video.mp4', 'video/mp4');
    assert.strictEqual(res.status, 201);
    const media = (await res.json()).media;
    try {
      assert.strictEqual(media.file_type, 'VIDEO');
      assert.strictEqual(media.transcript_status, 'PROCESSING');

      let settled = null;
      for (let i = 0; i < 40; i++) {
        await new Promise(resolve => setTimeout(resolve, 1500));
        const detail = await (await fetch(`${BASE_URL}/api/events/${MEDIA_EVENT_ID}`)).json();
        const current = detail.media.find(m => m.media_id === media.media_id);
        if (current && current.transcript_status !== 'PROCESSING') { settled = current; break; }
      }
      assert.ok(settled, 'Transcript job never left PROCESSING within 60s');
      assert.ok(['DONE', 'FAILED'].includes(settled.transcript_status));
      if (settled.transcript_status === 'FAILED') {
        assert.ok(settled.transcript_error && settled.transcript_error.length > 0, 'A FAILED transcript must carry a human-readable reason');
      }
    } finally {
      await fetch(`${BASE_URL}/api/media/${media.media_id}`, { method: 'DELETE' });
    }
  });

  await runTest('[NEGATIVE] Non-photo/video uploads (e.g. HTML) are rejected with 415 so they can never be served from /uploads', async () => {
    const res = await uploadMedia(Buffer.from('<script>alert(1)</script>'), 'evil.html', 'text/html');
    assert.strictEqual(res.status, 415);
    const body = await res.json();
    assert.ok(body.error, 'Rejection must explain why');
  });

  await runTest('[NEGATIVE] Requesting an AI transcript for a photo returns 400, not a transcription attempt', async () => {
    const res = await uploadMedia(TINY_PNG, 'regression-notvideo.png', 'image/png');
    const media = (await res.json()).media;
    try {
      const tRes = await fetch(`${BASE_URL}/api/media/${media.media_id}/transcribe`, { method: 'POST' });
      assert.strictEqual(tRes.status, 400);
    } finally {
      await fetch(`${BASE_URL}/api/media/${media.media_id}`, { method: 'DELETE' });
    }
  });

  await runTest('[NEGATIVE] Requesting an AI transcript for a non-existent media ID returns a clean 404', async () => {
    const res = await fetch(`${BASE_URL}/api/media/does-not-exist/transcribe`, { method: 'POST' });
    assert.strictEqual(res.status, 404);
  });

  // --- 28. STORAGE BACKEND (JSON file store or Microsoft SQL Server) ---
  console.log('\n📦 MODULE 28: Storage Backend — JSON Store or SQL Server (Positive & Negative Testing)');

  let healthDb = null;
  await runTest('[POSITIVE] /api/health reports the REAL active storage backend (json or sql), not a label guessed from env vars', async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    const body = await res.json();
    healthDb = body.database;
    assert.ok(['json', 'sql'].includes(healthDb.backend), `Unexpected backend: ${healthDb.backend}`);
    if (healthDb.backend === 'sql') {
      assert.strictEqual(healthDb.mode, 'MS SQL Server (Connected)');
      assert.ok(healthDb.server && healthDb.database, 'SQL health must name the server and database');
    } else {
      assert.strictEqual(healthDb.mode, 'Local File Store (Active)');
    }
  });

  await runTest('[POSITIVE] SQL backend only: health shows live row counts read from the database (survey responses, metrics, events, media)', async () => {
    if (healthDb.backend !== 'sql') return; // JSON store: nothing to check
    assert.ok(healthDb.tables.metrics >= 27, 'metrics table must be populated');
    assert.ok(healthDb.tables.survey_responses > 0, 'survey responses must be populated');
    assert.ok(healthDb.tables.events >= 1, 'events table must be populated');
  });

  await runTest('[POSITIVE] Event photos/videos are referenced by their file PATH (/uploads/...) — the file itself is never stored in the database', async () => {
    const res = await fetch(`${BASE_URL}/api/events/ev-perspektif-2024-q1`);
    const body = await res.json();
    assert.ok(Array.isArray(body.media) && body.media.length > 0, 'Seed event must have media records');
    body.media.forEach(m => {
      assert.ok(typeof m.file_path === 'string' && m.file_path.startsWith('/uploads/'), `file_path must be a /uploads path, got ${m.file_path}`);
      assert.ok(!('file_data' in m) && !('file_content' in m), 'Binary content must not be part of the record');
    });
  });

  await runTest('[NEGATIVE] A duplicate NIP attendance is still rejected with the same clean error (DB unique constraint on SQL, array check on JSON)', async () => {
    const eventRes = await fetch(`${BASE_URL}/api/events/ev-perspektif-2024-q1`);
    const first = (await eventRes.json()).attendances[0];
    const res = await fetch(`${BASE_URL}/api/events/ev-perspektif-2024-q1/attendance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nip: first.nip, employee_name: first.employee_name, cimb_email: first.cimb_email })
    });
    assert.ok(res.status >= 400 && res.status < 500, `Expected a 4xx rejection, got ${res.status}`);
    const body = await res.json();
    assert.ok(/sudah/i.test(body.error || ''), `Expected the "sudah tercatat" message, got: ${body.error}`);
  });

  await runTest('[NEGATIVE] Lookups of non-existent records return clean 404/empty results on either backend (no crash, no 500)', async () => {
    const ev = await fetch(`${BASE_URL}/api/events/ev-does-not-exist`);
    assert.strictEqual(ev.status, 404);
    const code = await fetch(`${BASE_URL}/api/events/by-code/NO-SUCH-CODE`);
    assert.ok(code.status >= 400 && code.status < 500, `Expected 4xx, got ${code.status}`);
  });

  // --- 29. DASHBOARD DATA SOURCED FROM THE DATABASE (auditor follow-up, v2.22.1) ---
  console.log('\n📦 MODULE 29: Dashboard Data Sourced From the Database (Positive & Negative Testing)');

  const getJson = async (p) => (await fetch(`${BASE_URL}${p}`)).json();
  const putJson = (p, body) => fetch(`${BASE_URL}${p}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });

  await runTest('[POSITIVE] GET /api/settings serves the PX target and the Create-Event dropdown options from the database', async () => {
    const s = await getJson('/api/settings');
    assert.strictEqual(typeof s.px_index_target, 'number');
    assert.ok(Array.isArray(s.event_program_categories) && s.event_program_categories.length > 0);
    assert.ok(Array.isArray(s.event_types) && s.event_types.every(o => o.value && o.label));
  });

  await runTest('[POSITIVE] Changing px_index_target is stored and reflected by the trend endpoint (chart target line), then restored', async () => {
    const original = (await getJson('/api/settings')).px_index_target;
    try {
      const res = await putJson('/api/admin/settings/px_index_target', { value: 90 });
      assert.strictEqual(res.status, 200);
      const trends = await getJson('/api/metrics/trends?mode=YTD');
      assert.strictEqual(trends.px_index_target, 90);
    } finally {
      await putJson('/api/admin/settings/px_index_target', { value: original });
    }
    assert.strictEqual((await getJson('/api/settings')).px_index_target, original);
  });

  await runTest('[NEGATIVE] Invalid settings are rejected (target outside 0-100 → 400, unknown key → 404, empty option list → 400)', async () => {
    assert.strictEqual((await putJson('/api/admin/settings/px_index_target', { value: 150 })).status, 400);
    assert.strictEqual((await putJson('/api/admin/settings/px_index_target', { value: 'abc' })).status, 400);
    assert.strictEqual((await putJson('/api/admin/settings/no_such_key', { value: 1 })).status, 404);
    assert.strictEqual((await putJson('/api/admin/settings/event_types', { value: [] })).status, 400);
  });

  await runTest('[POSITIVE] Every SURVEY metric has its question set in the database (not only in code)', async () => {
    const surveyMetrics = await getJson('/api/surveys/metrics');
    const all = (await getJson('/api/admin/survey-questions')).questions;
    surveyMetrics.forEach(m => {
      assert.ok(Array.isArray(all[m.metric_id]) && all[m.metric_id].length > 0, `Metric ${m.metric_id} has no question set`);
    });
  });

  await runTest('[POSITIVE] Editing a metric\'s questions persists and "Reset to default" restores the original set', async () => {
    const before = (await getJson('/api/admin/survey-questions/2')).questions;
    const edited = before.map((q, i) => (i === 0 ? { ...q, text: 'REGRESSION-EDITED QUESTION TEXT' } : q));
    try {
      const saveRes = await fetch(`${BASE_URL}/api/admin/survey-questions/2`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ questions: edited })
      });
      assert.ok(saveRes.ok, `save failed: ${saveRes.status}`);
      const after = (await getJson('/api/admin/survey-questions/2')).questions;
      assert.strictEqual(after[0].text, 'REGRESSION-EDITED QUESTION TEXT');
      assert.strictEqual(after.length, before.length);
    } finally {
      await fetch(`${BASE_URL}/api/admin/survey-questions/2/reset`, { method: 'POST' });
    }
    const restored = (await getJson('/api/admin/survey-questions/2')).questions;
    assert.strictEqual(restored[0].text, before[0].text);
  });

  await runTest('[POSITIVE] Every directorate/division respondents belong to exists in the directory, so the Header filters can reach them', async () => {
    const directory = await getJson('/api/directorates');
    for (const metricId of [7, 8, 9]) {
      const detail = await getJson(`/api/metrics/${metricId}/detail?mode=YTD&year=${new Date().getFullYear()}`);
      (detail.responses || []).forEach(r => {
        const dir = directory.find(d => d.name === r.directorate);
        assert.ok(dir, `Directorate "${r.directorate}" (metric ${metricId}) is missing from the directory`);
        assert.ok(dir.divisions.includes(r.division), `Division "${r.division}" is missing under "${r.directorate}"`);
      });
    }
  });

  await runTest('[POSITIVE] Metric #11 drilldown rows carry the real event name and registration time (not blank)', async () => {
    const detail = await getJson('/api/metrics/11/detail');
    assert.ok(detail.operational_records.length > 0, 'Seed event has attendances');
    detail.operational_records.forEach(r => {
      assert.ok(r.event_title && r.event_title !== 'Signature Program Event', `event_title missing: ${r.event_title}`);
      assert.ok(r.registered_at, 'registered_at missing');
    });
  });

  await runTest('[POSITIVE] Every WARNING or CRITICAL metric on the scorecard has an alert (WARNING uses the normalized target, same as the status)', async () => {
    const calc = await getJson('/api/metrics/calculate');
    const alerts = await getJson('/api/alerts');
    const alertIds = new Set(alerts.alerts.map(a => a.metric_id));
    calc.metrics.filter(m => !m.is_disabled && (m.status === 'WARNING' || m.status === 'CRITICAL')).forEach(m => {
      assert.ok(alertIds.has(m.metric_id), `Metric ${m.metric_id} is ${m.status} but has no alert`);
    });
  });

  await runTest('[NEGATIVE] Saving or resetting questions of a non-existent metric returns 404 and writes nothing', async () => {
    const reset = await fetch(`${BASE_URL}/api/admin/survey-questions/9999/reset`, { method: 'POST' });
    assert.strictEqual(reset.status, 404);
    const save = await fetch(`${BASE_URL}/api/admin/survey-questions/9999`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ questions: [{ key: 'q1', label: 'x', text: 'x', type: 'SCALE_1_5' }] })
    });
    assert.strictEqual(save.status, 404);
    const all = (await getJson('/api/admin/survey-questions')).questions;
    assert.ok(!all[9999], 'No orphan question rows may be created');
  });

  // --- 30. REMINDER E-MAIL SENDER SETTINGS + OPTION CATALOGS (v2.23.0) ---
  console.log('\n📦 MODULE 30: Setting Email (Reminder Sender) & Option Catalogs (Positive & Negative Testing)');

  const net = require('net');
  // Minimal in-process SMTP server (AUTH PLAIN) so the full send path is tested without any real
  // mail account: it records who authenticated with which password and every delivered message.
  function startFakeSmtp() {
    const received = { messages: [], authPasswords: [] };
    const server = net.createServer(sock => {
      sock.write('220 fake ESMTP\r\n');
      let buf = ''; let inData = false; let data = ''; let rcpts = [];
      sock.on('data', chunk => {
        buf += chunk.toString('utf8');
        let idx;
        while ((idx = buf.indexOf('\r\n')) !== -1) {
          const line = buf.slice(0, idx); buf = buf.slice(idx + 2);
          if (inData) {
            if (line === '.') { inData = false; received.messages.push({ to: rcpts.slice(), data }); data = ''; rcpts = []; sock.write('250 OK queued\r\n'); }
            else data += line + '\n';
            continue;
          }
          const cmd = line.toUpperCase();
          if (cmd.startsWith('EHLO') || cmd.startsWith('HELO')) sock.write('250-fake\r\n250 AUTH PLAIN\r\n');
          else if (cmd.startsWith('AUTH PLAIN')) {
            const parts = Buffer.from(line.split(' ')[2] || '', 'base64').toString().split('\0');
            received.authPasswords.push(parts[2]);
            sock.write('235 OK\r\n');
          } else if (cmd.startsWith('RCPT TO')) { rcpts.push(line.slice(line.indexOf(':') + 1).replace(/[<>\s]/g, '')); sock.write('250 OK\r\n'); }
          else if (cmd === 'DATA') { inData = true; sock.write('354 go\r\n'); }
          else if (cmd === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
          else sock.write('250 OK\r\n');
        }
      });
      sock.on('error', () => {});
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, received, port: server.address().port })));
  }

  const getEmail = async () => getJson('/api/admin/email-settings');
  const putEmail = (body) => putJson('/api/admin/email-settings', body);
  const initialEmail = await getEmail();
  const canWriteEmail = !initialEmail.has_password && !initialEmail.enabled; // never overwrite a real configuration
  const resetEmail = () => putEmail({ enabled: false, provider: 'GMAIL', smtp_user: '', from_name: 'People Experience CIMB Niaga', from_email: '', clear_password: true });

  await runTest('[POSITIVE] Email settings are served from the database WITHOUT any password field (write-only secret)', async () => {
    const s = await getEmail();
    assert.ok(['GMAIL', 'SMTP'].includes(s.provider));
    assert.strictEqual(typeof s.has_password, 'boolean');
    Object.keys(s).forEach(k => assert.ok(!/pass/i.test(k) || ['has_password', 'password_readable'].includes(k), `Response must not expose "${k}"`));
  });

  await runTest('[POSITIVE] The SMTP password is stored encrypted (AES-256-GCM) and round-trips; ciphertext never equals the plain text', async () => {
    const { encrypt, decrypt } = require('../server/services/secretBox');
    const c1 = encrypt('Sup3r-secret!'); const c2 = encrypt('Sup3r-secret!');
    assert.ok(c1.startsWith('v1:') && !c1.includes('Sup3r-secret!'));
    assert.notStrictEqual(c1, c2, 'A random IV must make every ciphertext different');
    assert.strictEqual(decrypt(c1), 'Sup3r-secret!');
    assert.strictEqual(decrypt(c1.slice(0, -4) + 'AAAA'), '', 'A tampered ciphertext must not decrypt');
  });

  await runTest('[POSITIVE] The encryption key is never re-generated: a process that did not load .env reuses the existing key (previously every test run appended a new one)', async () => {
    const fs = require('fs');
    const envPath = require('path').join(__dirname, '..', '.env');
    const countKeys = () => (fs.readFileSync(envPath, 'utf8').match(/^SETTINGS_ENCRYPTION_KEY=/gm) || []).length;
    const { encrypt } = require('../server/services/secretBox');
    encrypt('warm-up');
    const before = countKeys();
    delete process.env.SETTINGS_ENCRYPTION_KEY; // simulate a process that never loaded .env
    encrypt('again'); encrypt('and again');
    assert.strictEqual(countKeys(), before, 'No additional key may be written to .env');
    assert.strictEqual(before, 1, 'Exactly one encryption key must exist in .env');
  });

  await runTest('[POSITIVE] Full path: save SMTP settings → test email is delivered with the decrypted password; reminders use the database sender', async () => {
    if (!canWriteEmail) return; // a real configuration exists — do not touch it
    const fake = await startFakeSmtp();
    try {
      const res = await putEmail({ enabled: true, provider: 'SMTP', smtp_host: '127.0.0.1', smtp_port: fake.port, smtp_secure: false,
        smtp_user: 'regression@example.test', smtp_password: 'RegressionPw-123', from_name: 'PX Regression', from_email: '' });
      const saved = await res.json();
      assert.strictEqual(res.status, 200, JSON.stringify(saved));
      assert.strictEqual(saved.has_password, true);
      assert.ok(!JSON.stringify(saved).includes('RegressionPw-123'), 'The password must never be echoed back');

      const testRes = await fetch(`${BASE_URL}/api/admin/email-settings/test`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: 'pic.test@example.test' })
      });
      const result = await testRes.json();
      assert.strictEqual(result.sent, true, JSON.stringify(result));
      assert.deepStrictEqual(fake.received.authPasswords.slice(-1), ['RegressionPw-123'], 'Server must authenticate with the decrypted password');
      assert.ok(fake.received.messages.some(m => m.to.includes('pic.test@example.test')), 'Test message must reach the chosen recipient');

      const before = fake.received.messages.length;
      const rem = await (await fetch(`${BASE_URL}/api/admin/upload-reminders/send`, { method: 'POST' })).json();
      assert.strictEqual(rem.sender_source, 'database');
      const sent = rem.results.filter(r => r.email_status === 'SENT').length;
      assert.strictEqual(fake.received.messages.length - before, sent, 'Every SENT reminder must have been delivered to the SMTP server');
    } finally {
      fake.server.close();
      await resetEmail();
    }
  });

  await runTest('[POSITIVE] Test email with no account configured fails cleanly (502 + explanation), not a crash', async () => {
    if (!canWriteEmail) return;
    const res = await fetch(`${BASE_URL}/api/admin/email-settings/test`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: 'someone@example.test' })
    });
    const body = await res.json();
    assert.strictEqual(res.status, 502);
    assert.strictEqual(body.sent, false);
    assert.ok(body.error && /belum dikonfigurasi/i.test(body.error));
  });

  await runTest('[NEGATIVE] Invalid email settings are rejected with 400 (provider, port, address format, enabling without a password)', async () => {
    assert.strictEqual((await putEmail({ provider: 'YAHOO' })).status, 400);
    assert.strictEqual((await putEmail({ provider: 'SMTP', smtp_port: 70000 })).status, 400);
    assert.strictEqual((await putEmail({ from_email: 'not-an-email' })).status, 400);
    assert.strictEqual((await putEmail({ provider: 'GMAIL', smtp_user: 'not-an-email' })).status, 400);
    if (canWriteEmail) {
      assert.strictEqual((await putEmail({ enabled: true, provider: 'GMAIL', smtp_user: 'someone@gmail.com' })).status, 400, 'Enabling needs a password');
    }
  });

  await runTest('[NEGATIVE] A test email to an invalid recipient is rejected with 400', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/email-settings/test`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: 'definitely not an address' })
    });
    assert.strictEqual(res.status, 400);
  });

  await runTest('[POSITIVE] Parameter Admin / Survey Question option catalogs (metric type, scale, audience, frequency, question type) come from the database', async () => {
    const s = await getJson('/api/settings');
    ['metric_types', 'scale_types', 'target_audiences', 'update_frequencies', 'question_types'].forEach(key => {
      assert.ok(Array.isArray(s[key]) && s[key].length > 0, `${key} missing`);
      s[key].forEach(o => assert.ok(o.value && o.label));
    });
    assert.ok(s.metric_types.some(o => o.value === 'SURVEY') && s.metric_types.some(o => o.value === 'OUTCOME'));
  });

  await runTest('[NEGATIVE] Catalog VALUES that drive calculation logic cannot be added or renamed — only labels are editable', async () => {
    const original = (await getJson('/api/settings')).scale_types;
    const renamedValue = original.map((o, i) => (i === 0 ? { ...o, value: 'HACKED' } : o));
    assert.strictEqual((await putJson('/api/admin/settings/scale_types', { value: renamedValue })).status, 400);
    assert.strictEqual((await putJson('/api/admin/settings/scale_types', { value: [...original, { value: 'EXTRA', label: 'Extra' }] })).status, 400);
    try {
      const relabelled = original.map((o, i) => (i === 0 ? { ...o, label: 'REGRESSION LABEL' } : o));
      assert.strictEqual((await putJson('/api/admin/settings/scale_types', { value: relabelled })).status, 200);
      assert.strictEqual((await getJson('/api/settings')).scale_types[0].label, 'REGRESSION LABEL');
    } finally {
      await putJson('/api/admin/settings/scale_types', { value: original });
    }
  });

  // --- 31. AUTOMATIC UPLOAD REMINDERS TO PICs (v2.24.0) ---
  console.log('\n📦 MODULE 31: Automatic Survey Upload Reminders to PIC (Positive & Negative Testing)');

  const postJson = (p, body) => fetch(`${BASE_URL}${p}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {})
  });
  const remind = async (body) => (await postJson('/api/admin/upload-reminders/send', body)).json();
  const createReminderMetric = async (overrides = {}) => {
    const res = await postJson('/api/admin/metrics', {
      metric_name: 'REGRESSION Reminder Metric', metric_type: 'SURVEY', scale_type: 'RATING_5',
      requires_manual_upload: true, update_frequency: 'MONTHLY', upload_deadline_day: 10,
      pic_name: 'PIC Regresi', pic_email: 'pic.regresi@example.test', ...overrides
    });
    assert.strictEqual(res.status, 201);
    return (await res.json()).metric_id;
  };
  const uploadSurveyRow = async (metricId, surveyDate, nip = '7700001') => postJson('/api/surveys/upload', {
    csvText: ['nip,employee_name,cimb_email,directorate,division,survey_date,q1_overall',
      `${nip},Reminder Tester,reminder.tester@cimbniaga.co.id,Human Resources,People Experience & Culture,${surveyDate},4.5`].join('\r\n'),
    fileName: 'reminder_test.csv', metric_id: metricId
  });
  const findIn = (summary, metricId) => summary.results.find(r => r.metric_id === metricId);
  const deleteMetric = (id) => fetch(`${BASE_URL}/api/admin/metrics/${id}`, { method: 'DELETE' });

  await runTest('[POSITIVE] Before the deadline day nothing is reminded; ON the deadline day (10 Oct) a PIC with no September data is reminded for September', async () => {
    const id = await createReminderMetric();
    try {
      const before = await remind({ reference_date: '2026-10-09', dry_run: true });
      assert.ok(!findIn(before, id), 'No reminder before the deadline day');
      const onDay = findIn(await remind({ reference_date: '2026-10-10', dry_run: true }), id);
      assert.ok(onDay, 'Reminder expected on the deadline day');
      assert.strictEqual(onDay.status, 'DUE_TODAY');
      assert.strictEqual(onDay.expected_period, '2026-09');
      assert.strictEqual(onDay.expected_period_label, 'September 2026');
      assert.strictEqual(onDay.email_status, 'WOULD_SEND');
    } finally { await deleteMetric(id); }
  });

  await runTest('[POSITIVE] After the deadline the PIC stays pending for the same (previous) month with days_overdue counted; January rolls back to December', async () => {
    const id = await createReminderMetric();
    try {
      const later = findIn(await remind({ reference_date: '2026-10-14', dry_run: true }), id);
      assert.strictEqual(later.status, 'OVERDUE');
      assert.strictEqual(later.days_overdue, 4);
      assert.strictEqual(later.expected_period, '2026-09');
      const jan = findIn(await remind({ reference_date: '2027-01-12', dry_run: true }), id);
      assert.strictEqual(jan.expected_period, '2026-12');
      assert.strictEqual(jan.expected_period_label, 'Desember 2026');
    } finally { await deleteMetric(id); }
  });

  await runTest('[POSITIVE] Only the PREVIOUS month counts: September data stops the reminder, October data alone does not', async () => {
    const id = await createReminderMetric();
    try {
      assert.strictEqual((await uploadSurveyRow(id, '2026-10-03')).status, 200);
      assert.ok(findIn(await remind({ reference_date: '2026-10-10', dry_run: true }), id), 'October data must NOT satisfy the September check');
      assert.strictEqual((await uploadSurveyRow(id, '2026-09-15', '7700002')).status, 200);
      assert.ok(!findIn(await remind({ reference_date: '2026-10-10', dry_run: true }), id), 'September data present → no reminder');
    } finally { await deleteMetric(id); }
  });

  await runTest('[POSITIVE] The check is per metric: another metric\'s September data does not satisfy this metric', async () => {
    const a = await createReminderMetric({ metric_name: 'REGRESSION Reminder A' });
    const b = await createReminderMetric({ metric_name: 'REGRESSION Reminder B', pic_email: 'pic.b@example.test' });
    try {
      await uploadSurveyRow(a, '2026-09-20');
      const summary = await remind({ reference_date: '2026-10-10', dry_run: true });
      assert.ok(!findIn(summary, a));
      assert.ok(findIn(summary, b));
    } finally { await deleteMetric(a); await deleteMetric(b); }
  });

  await runTest('[POSITIVE] Annual (Tahunan) metrics are reminded from their deadline date of the year if there is no data for that year', async () => {
    const id = await createReminderMetric({ update_frequency: 'ONE_TIME_ANNUAL', upload_deadline_month: 11, upload_deadline_day: 25 });
    try {
      assert.ok(!findIn(await remind({ reference_date: '2026-11-24', dry_run: true }), id));
      const due = findIn(await remind({ reference_date: '2026-11-25', dry_run: true }), id);
      assert.strictEqual(due.status, 'DUE_TODAY');
      assert.strictEqual(due.expected_period, '2026');
    } finally { await deleteMetric(id); }
  });

  await runTest('[POSITIVE] Automatic cycle end-to-end: emailed once on the deadline day, not again the same day, follow-up next day, stops when repeat is 0 and when data arrives', async () => {
    if (!canWriteEmail) return; // a real sender is configured — never send through it from a test
    const fake = await startFakeSmtp();
    const id = await createReminderMetric();
    const originalRepeat = (await getJson('/api/settings')).reminder_repeat_days;
    try {
      await putEmail({ enabled: true, provider: 'SMTP', smtp_host: '127.0.0.1', smtp_port: fake.port, smtp_secure: false,
        smtp_user: 'regression@example.test', smtp_password: 'RegressionPw-123' });
      await putJson('/api/admin/settings/reminder_repeat_days', { value: 1 });
      const mine = () => fake.received.messages.filter(m => m.to.includes('pic.regresi@example.test'));

      let r = findIn(await remind({ reference_date: '2026-10-10', automatic: true, metric_id: id }), id);
      assert.strictEqual(r.email_status, 'SENT');
      assert.strictEqual(mine().length, 1);
      assert.ok(/September 2026/.test(mine()[0].data), 'Email must name the missing month');

      r = findIn(await remind({ reference_date: '2026-10-10', automatic: true, metric_id: id }), id);
      assert.strictEqual(r.skip_reason, 'ALREADY_SENT_TODAY');
      assert.strictEqual(mine().length, 1, 'No duplicate on the same day (e.g. after a restart)');

      r = findIn(await remind({ reference_date: '2026-10-11', automatic: true, metric_id: id }), id);
      assert.strictEqual(r.email_status, 'SENT');
      assert.strictEqual(mine().length, 2);
      assert.ok(/pengingat ke-2/.test(mine()[1].data), 'Follow-up must say it is the 2nd reminder');

      await putJson('/api/admin/settings/reminder_repeat_days', { value: 0 });
      r = findIn(await remind({ reference_date: '2026-10-12', automatic: true, metric_id: id }), id);
      assert.strictEqual(r.skip_reason, 'REPEAT_DISABLED');
      assert.strictEqual(mine().length, 2);

      await putJson('/api/admin/settings/reminder_repeat_days', { value: 1 });
      await uploadSurveyRow(id, '2026-09-30');
      assert.ok(!findIn(await remind({ reference_date: '2026-10-13', automatic: true, metric_id: id }), id), 'Data uploaded → reminders stop');
      assert.strictEqual(mine().length, 2);

      const history = (await getJson('/api/admin/upload-reminders')).history.filter(h => h.metric_id === id);
      assert.strictEqual(history.filter(h => h.status === 'SENT').length, 2, 'Both emails are recorded in the reminder log');
    } finally {
      fake.server.close();
      await putJson('/api/admin/settings/reminder_repeat_days', { value: originalRepeat });
      await deleteMetric(id);
      await resetEmail();
    }
  });

  await runTest('[NEGATIVE] A metric without a PIC email is skipped (not crashed), and metrics not flagged as manual upload are never reminded', async () => {
    const noMail = await createReminderMetric({ pic_email: '' });
    const notManual = await createReminderMetric({ requires_manual_upload: false });
    try {
      const summary = await remind({ reference_date: '2026-10-10', dry_run: true });
      assert.strictEqual(findIn(summary, noMail).email_status, 'SKIPPED_NO_EMAIL');
      assert.ok(!findIn(summary, notManual));
    } finally { await deleteMetric(noMail); await deleteMetric(notManual); }
  });

  await runTest('[NEGATIVE] Bad input is rejected: malformed reference_date → 400; reminder schedule settings outside their range / non-integer → 400', async () => {
    assert.strictEqual((await postJson('/api/admin/upload-reminders/send', { reference_date: '10-10-2026' })).status, 400);
    assert.strictEqual((await putJson('/api/admin/settings/reminder_send_hour', { value: 24 })).status, 400);
    assert.strictEqual((await putJson('/api/admin/settings/reminder_send_hour', { value: -1 })).status, 400);
    assert.strictEqual((await putJson('/api/admin/settings/reminder_repeat_days', { value: 1.5 })).status, 400);
    assert.strictEqual((await putJson('/api/admin/settings/reminder_repeat_days', { value: 99 })).status, 400);
  });

  await runTest('[POSITIVE] Deleting a metric also deletes its survey data, so a new metric that reuses the id starts empty (no inherited "September data")', async () => {
    const first = await createReminderMetric();
    await uploadSurveyRow(first, '2026-09-15');
    await deleteMetric(first);
    const second = await createReminderMetric();
    try {
      assert.strictEqual(second, first, 'Ids are max+1, so the freed id is reused');
      assert.ok(findIn(await remind({ reference_date: '2026-10-10', dry_run: true }), second), 'New metric must NOT inherit the deleted metric\'s September data');
    } finally { await deleteMetric(second); }
  });

  await runTest('[POSITIVE] Without any email sender configured the reminder is not lost: it is reported (LOGGED_ONLY) and nothing is recorded as sent', async () => {
    if (!canWriteEmail) return;
    const id = await createReminderMetric();
    try {
      const r = findIn(await remind({ reference_date: '2026-10-10', automatic: true, metric_id: id }), id);
      assert.strictEqual(r.email_status, 'LOGGED_ONLY');
      const history = (await getJson('/api/admin/upload-reminders')).history.filter(h => h.metric_id === id);
      assert.strictEqual(history.length, 0, 'Nothing may be logged as sent, so it goes out once a sender is configured');
    } finally { await deleteMetric(id); }
  });

  // --- 32. VIDEO TRANSCRIPT: "COBA LAGI" + FULL TEXT FROM `text` (v2.24.1) ---
  console.log('\n📦 MODULE 32: Video Transcript — Retry Button & Full Text (Positive & Negative Testing)');

  const http = require('http');
  const FULL_TEXT = 'Halo semuanya, ini adalah transkrip lengkap dari variabel text.';
  const FAKE_SEGMENTS = [
    { start: 0, end: 4, text: ' Halo semuanya,' },
    { start: 4, end: 12.5, text: ' ini segmen kedua yang berbeda' } // deliberately different from FULL_TEXT
  ];
  // Fake "Video Extractor" (default port 8000, or TEST_TRANSCRIBE_PORT) — only when nothing real is listening there.
  function startFakeTranscribeApi(mode) {
    return new Promise(resolve => {
      const server = http.createServer((req, res) => {
        if (req.method === 'POST' && req.url === '/transcribe') {
          req.resume();
          req.on('end', () => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(mode.value === 'segments-only'
              ? { language: 'id', duration: 12.5, segments: FAKE_SEGMENTS }
              : { text: FULL_TEXT, language: 'id', duration: 12.5, segments: FAKE_SEGMENTS }));
          });
        } else { res.setHeader('Content-Type', 'application/json'); res.end('{"status":"ok"}'); }
      });
      server.on('error', () => resolve(null)); // port taken → the real service is running
      server.listen(TRANSCRIBE_PORT, '127.0.0.1', () => resolve(server));
    });
  }
  const apiReachable = async () => { try { await fetch(`http://127.0.0.1:${TRANSCRIBE_PORT}/`, { signal: AbortSignal.timeout(2000) }); return true; } catch (_) { return false; } };
  const getMedia = async (id) => (await (await fetch(`${BASE_URL}/api/events/${MEDIA_EVENT_ID}`)).json()).media.find(m => m.media_id === id);
  const waitSettled = async (id) => {
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 500));
      const m = await getMedia(id);
      if (m && m.transcript_status !== 'PROCESSING') return m;
    }
    return null;
  };

  await runTest('[POSITIVE] "Coba lagi": refused with 503 + clear message while the Video Extractor is down; once it is up the retry runs and the transcript is stored — full text from `text`, segments kept', async () => {
    if (await apiReachable()) return; // a real Video Extractor is running — don't impersonate it
    const mode = { value: 'full' };
    let fake = null;
    const up = await uploadMedia(Buffer.from('fake video bytes'), 'regression-retry.mp4', 'video/mp4');
    assert.strictEqual(up.status, 201);
    const media = (await up.json()).media;
    try {
      const failed = await waitSettled(media.media_id);
      assert.strictEqual(failed.transcript_status, 'FAILED', 'API is down → first attempt FAILED');
      assert.ok(/tidak aktif/i.test(failed.transcript_error));

      const down = await fetch(`${BASE_URL}/api/media/${media.media_id}/transcribe`, { method: 'POST' });
      assert.strictEqual(down.status, 503, 'Retry while the service is down must say so immediately');
      assert.ok(/tidak aktif/i.test((await down.json()).error));
      assert.strictEqual((await getMedia(media.media_id)).transcript_status, 'FAILED', 'A refused retry must not change the state');

      fake = await startFakeTranscribeApi(mode);
      assert.ok(fake, 'Could not start the fake transcribe API on :8000');
      const retry = await fetch(`${BASE_URL}/api/media/${media.media_id}/transcribe`, { method: 'POST' });
      assert.strictEqual(retry.status, 202);
      assert.strictEqual((await retry.json()).media.transcript_status, 'PROCESSING');

      const done = await waitSettled(media.media_id);
      assert.strictEqual(done.transcript_status, 'DONE', done.transcript_error);
      assert.strictEqual(done.transcript, FULL_TEXT, 'Full transcript must be exactly the API `text`');
      assert.strictEqual(done.transcript_segments.length, 2, 'Per-segment results are kept');
      assert.deepStrictEqual(done.transcript_segments.map(s => [s.start, s.end]), [[0, 4], [4, 12.5]]);
      assert.strictEqual(done.transcript_segments[1].text, FAKE_SEGMENTS[1].text);
      assert.strictEqual(done.transcript_language, 'id');
      assert.strictEqual(done.duration_seconds, 12.5);
      assert.ok(done.ai_generated_description.includes('Halo semuanya'));
    } finally {
      if (fake) fake.close();
      await fetch(`${BASE_URL}/api/media/${media.media_id}`, { method: 'DELETE' });
    }
  });

  await runTest('[POSITIVE] If the API returns no `text`, the full transcript is rebuilt from the segments (segments unchanged)', async () => {
    if (await apiReachable()) return;
    const mode = { value: 'segments-only' };
    const fake = await startFakeTranscribeApi(mode);
    assert.ok(fake, 'Could not start the fake transcribe API on :8000');
    const up = await uploadMedia(Buffer.from('fake video bytes'), 'regression-segments-only.mp4', 'video/mp4');
    const media = (await up.json()).media;
    try {
      const done = await waitSettled(media.media_id);
      assert.strictEqual(done.transcript_status, 'DONE', done.transcript_error);
      assert.strictEqual(done.transcript, 'Halo semuanya, ini segmen kedua yang berbeda');
      assert.strictEqual(done.transcript_segments.length, 2);
    } finally {
      fake.close();
      await fetch(`${BASE_URL}/api/media/${media.media_id}`, { method: 'DELETE' });
    }
  });

  await runTest('[NEGATIVE] Retrying a transcript that is already PROCESSING returns 409; an unknown media → 404', async () => {
    if (await apiReachable()) return;
    const mode = { value: 'full' };
    const fake = await startFakeTranscribeApi(mode);
    assert.ok(fake);
    // make the fake API slow so the job stays PROCESSING while we poke it
    fake.removeAllListeners('request');
    fake.on('request', (req, res) => { req.resume(); setTimeout(() => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ text: FULL_TEXT, segments: [] })); }, 2500); });
    const up = await uploadMedia(Buffer.from('fake video bytes'), 'regression-busy.mp4', 'video/mp4');
    const media = (await up.json()).media;
    try {
      const busy = await fetch(`${BASE_URL}/api/media/${media.media_id}/transcribe`, { method: 'POST' });
      assert.strictEqual(busy.status, 409);
      assert.strictEqual((await fetch(`${BASE_URL}/api/media/no-such-media/transcribe`, { method: 'POST' })).status, 404);
      await waitSettled(media.media_id);
    } finally {
      fake.close();
      await fetch(`${BASE_URL}/api/media/${media.media_id}`, { method: 'DELETE' });
    }
  });

  // --- 33. METRIC DISPLAY UNIT (px_metrics.unit) ---
  console.log('\n📦 MODULE 33: Metric Display Unit — "4330%" Bug (Positive & Negative Testing)');

  const unitJson = (method, p, body) => fetch(`${BASE_URL}${p}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body)
  });
  const unitCalcMetric = async (id) => (await (await fetch(`${BASE_URL}/api/metrics/calculate?period=YTD`)).json()).metrics.find(m => m.metric_id === id);
  const unitAdminMetric = async (id) => (await (await fetch(`${BASE_URL}/api/admin/parameters`)).json()).metrics.find(m => m.metric_id === id);
  const unitTempMetric = (overrides = {}) => unitJson('POST', '/api/admin/metrics', {
    metric_name: 'REGRESSION Unit Metric', metric_type: 'OUTCOME', scale_type: 'QUOTA_COUNT',
    target_value: 100, target_display: 'min 100', raw_value: 40, requires_manual_upload: false, ...overrides
  });
  const unitDeleteMetric = (id) => fetch(`${BASE_URL}/api/admin/metrics/${id}`, { method: 'DELETE' });

  await runTest('[POSITIVE] Every one of the 27 metrics exposes a non-empty unit (calculate + admin parameters) and RATING_5 metrics read "/ 5"', async () => {
    const calc = await (await fetch(`${BASE_URL}/api/metrics/calculate?period=YTD`)).json();
    const admin = (await (await fetch(`${BASE_URL}/api/admin/parameters`)).json()).metrics;
    assert.strictEqual(calc.metrics.length, 27);
    for (const m of [...calc.metrics, ...admin]) {
      assert.ok(typeof m.unit === 'string' && m.unit.trim().length > 0 && m.unit.length <= 30, `Metric ${m.metric_id} has no valid unit: ${JSON.stringify(m.unit)}`);
    }
    calc.metrics.filter(m => m.scale_type === 'RATING_5').forEach(m => assert.strictEqual(m.unit, '/ 5', `Metric ${m.metric_id}`));
  });

  await runTest('[POSITIVE] Metric 14 (recognition recipients per year) is a count — its unit is not "%" and its score/status/bar are untouched', async () => {
    const m = await unitCalcMetric(14);
    assert.ok(m.unit && m.unit !== '%', `Metric 14 unit must not be "%", got "${m.unit}"`);
    assert.strictEqual(m.scale_type, 'QUOTA_COUNT');
    // the unit is display-only: normalized score is still raw / target * 100 (capped at 100)
    const expected = Math.min(m.raw_value / m.target_value * 100, 100);
    assert.ok(Math.abs(m.normalized_score - expected) < 0.01, `normalized ${m.normalized_score} vs ${expected}`);
    const detail = await (await fetch(`${BASE_URL}/api/metrics/14/detail`)).json();
    assert.strictEqual(detail.unit, m.unit);
    assert.strictEqual(detail.metric.unit, m.unit);
    assert.strictEqual(detail.status, m.status);
  });

  await runTest('[POSITIVE] The detail endpoint returns the unit for a SURVEY metric as well', async () => {
    const detail = await (await fetch(`${BASE_URL}/api/metrics/2/detail`)).json();
    assert.strictEqual(detail.unit, '/ 5');
    assert.strictEqual(detail.metric.unit, '/ 5');
  });

  await runTest('[POSITIVE] A new metric created without a unit gets the default of its scale; an explicit unit is kept (and trimmed)', async () => {
    const ids = [];
    try {
      for (const [scale, expected] of [['RATING_5', '/ 5'], ['PERCENTAGE', '%'], ['QUOTA_COUNT', 'pax']]) {
        const res = await unitTempMetric({ scale_type: scale });
        assert.strictEqual(res.status, 201);
        const body = await res.json();
        ids.push(body.metric_id);
        assert.strictEqual(body.metric.unit, expected, scale);
      }
      const res = await unitTempMetric({ unit: '  orang/bulan  ' });
      const body = await res.json();
      ids.push(body.metric_id);
      assert.strictEqual(body.metric.unit, 'orang/bulan', 'unit must be trimmed');
      assert.strictEqual((await unitAdminMetric(body.metric_id)).unit, 'orang/bulan');
    } finally {
      for (const id of ids) await unitDeleteMetric(id);
    }
  });

  await runTest('[POSITIVE] Admin can edit a unit; it shows in calculate / parameters / detail, a later edit of another field keeps it, and the score is unchanged', async () => {
    const id = (await (await unitTempMetric()).json()).metric_id;
    try {
      const before = await unitCalcMetric(id);
      const put = await unitJson('PUT', `/api/admin/metrics/${id}`, { unit: 'peserta/tahun' });
      assert.strictEqual(put.status, 200);
      assert.strictEqual((await put.json()).metric.unit, 'peserta/tahun');
      const after = await unitCalcMetric(id);
      assert.strictEqual(after.unit, 'peserta/tahun');
      assert.strictEqual((await unitAdminMetric(id)).unit, 'peserta/tahun');
      assert.strictEqual((await (await fetch(`${BASE_URL}/api/metrics/${id}/detail`)).json()).unit, 'peserta/tahun');
      assert.strictEqual(after.normalized_score, before.normalized_score, 'changing the unit must not change the score');
      assert.strictEqual(after.status, before.status);
      // an update that does not mention the unit must not wipe it
      await unitJson('PUT', `/api/admin/metrics/${id}`, { experience_owner: 'REGRESSION Owner' });
      assert.strictEqual((await unitAdminMetric(id)).unit, 'peserta/tahun');
    } finally {
      await unitDeleteMetric(id);
    }
  });

  await runTest('[NEGATIVE] A blank or over-long unit is rejected with 400 and the stored unit is unchanged (30 characters is the maximum)', async () => {
    const id = (await (await unitTempMetric({ unit: 'orang' })).json()).metric_id;
    try {
      for (const bad of ['', '    ', 'x'.repeat(31)]) {
        const put = await unitJson('PUT', `/api/admin/metrics/${id}`, { unit: bad });
        assert.strictEqual(put.status, 400, `unit ${JSON.stringify(bad)} must be rejected`);
        assert.ok((await put.json()).error);
        assert.strictEqual((await unitAdminMetric(id)).unit, 'orang');
      }
      const edge = await unitJson('PUT', `/api/admin/metrics/${id}`, { unit: 'y'.repeat(30) });
      assert.strictEqual(edge.status, 200, 'exactly 30 characters is allowed');
    } finally {
      await unitDeleteMetric(id);
    }
  });

  await runTest('[NEGATIVE] Creating a metric with a blank or over-long unit is rejected with 400 and no metric is stored', async () => {
    const countBefore = (await (await fetch(`${BASE_URL}/api/admin/parameters`)).json()).metrics.length;
    assert.strictEqual((await unitTempMetric({ unit: '   ' })).status, 400);
    assert.strictEqual((await unitTempMetric({ unit: 'z'.repeat(31) })).status, 400);
    const countAfter = (await (await fetch(`${BASE_URL}/api/admin/parameters`)).json()).metrics.length;
    assert.strictEqual(countAfter, countBefore, 'a rejected metric must not be stored');
  });

  await runTest('[NEGATIVE] Updating the unit of a non-existent metric returns 400 (not a crash)', async () => {
    const put = await unitJson('PUT', '/api/admin/metrics/99999', { unit: 'pax' });
    assert.strictEqual(put.status, 400);
  });

  // --- 34. LOGIN, ROLES & ACCESS CONTROL (v2.26.0) ---
  console.log('\n📦 MODULE 34: Login, Roles (Admin / User) & Access Control (Positive & Negative Testing)');

  const rawFetch = realFetch; // never adds the suite admin's cookie
  const asUser = (cookie, extra = {}) => ({ ...extra, headers: { ...(extra.headers || {}), ...(cookie ? { Cookie: cookie } : {}) } });
  const jsonBody = (method, body, cookie) => asUser(cookie, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const cookieFrom = res => (res.headers.getSetCookie() || []).map(c => c.split(';')[0]).find(c => c.startsWith('px_session=')) || null;
  const loginAs = async (username, password) => {
    const res = await rawFetch(`${BASE_URL}/api/auth/login`, jsonBody('POST', { username, password }));
    return { res, cookie: cookieFrom(res) };
  };
  const adminJson = (method, p, body) => fetch(`${BASE_URL}${p}`, jsonBody(method, body)); // suite admin session via the fetch wrapper
  const allBodies = []; // every JSON body we read in this module is scanned for secrets at the end

  // Pick a non-HR directorate and the HR directorate (setting event_manager_directorates) from the database.
  const directory = await (await rawFetch(`${BASE_URL}/api/directorates`)).json();
  const settings = await (await fetch(`${BASE_URL}/api/settings`)).json();
  const hrName = settings.event_manager_directorates[0].value;
  const hrDir = directory.find(d => d.directorate_name === hrName);
  const otherDirs = directory.filter(d => d.directorate_name !== hrName && d.divisions.length > 0);
  const itDir = otherDirs[0];
  const otherDir2 = otherDirs[1];

  const stamp = Date.now().toString(36);
  const createdUserIds = [];
  const newUser = async (suffix, role, dir) => {
    const username = `rt${suffix}${stamp}`;
    const res = await adminJson('POST', '/api/admin/users', {
      username, full_name: `Regression ${suffix}`, email: `${username}@example.test`, role,
      directorate: dir ? dir.directorate_name : undefined, division: dir ? dir.divisions[0] : undefined
    });
    assert.strictEqual(res.status, 201, `create ${suffix}: ${res.status}`);
    const body = await res.json();
    createdUserIds.push(body.user.user_id);
    return { id: body.user.user_id, username, tempPassword: body.temporary_password, body };
  };
  const STRONG = 'Regress1on-Pass-9x';
  // Creates a user and completes the forced password change; returns { id, username, cookie }.
  const readyUser = async (suffix, role, dir) => {
    const u = await newUser(suffix, role, dir);
    const { res, cookie } = await loginAs(u.username, u.tempPassword);
    assert.strictEqual(res.status, 200);
    const ch = await rawFetch(`${BASE_URL}/api/auth/change-password`, jsonBody('POST', { current_password: u.tempPassword, new_password: STRONG }, cookie));
    assert.strictEqual(ch.status, 200);
    return { ...u, cookie, password: STRONG };
  };

  try {
    await runTest('[POSITIVE] Login sets an httpOnly SameSite=Strict session cookie; /me returns the user and permissions with no secrets', async () => {
      const u = await newUser('a', 'USER', itDir);
      const { res, cookie } = await loginAs(u.username, u.tempPassword);
      assert.strictEqual(res.status, 200);
      const setCookie = res.headers.getSetCookie().find(c => c.startsWith('px_session='));
      assert.ok(/HttpOnly/i.test(setCookie) && /SameSite=Strict/i.test(setCookie), setCookie);
      const body = await res.json(); allBodies.push(JSON.stringify(body));
      assert.strictEqual(body.user.username, u.username);
      assert.strictEqual(body.user.role, 'USER');
      assert.strictEqual(body.user.directorate, itDir.directorate_name);
      assert.strictEqual(body.user.password_hash, undefined);
      assert.strictEqual(body.permissions.is_admin, false);
      assert.strictEqual(body.permissions.can_manage_events, false);
    });

    await runTest('[POSITIVE] A new account must change its temporary password first (403 PASSWORD_CHANGE_REQUIRED), then gets access; weak passwords are refused', async () => {
      const u = await newUser('b', 'USER', itDir);
      const { cookie } = await loginAs(u.username, u.tempPassword);
      const blocked = await rawFetch(`${BASE_URL}/api/metrics/calculate`, asUser(cookie));
      assert.strictEqual(blocked.status, 403);
      assert.strictEqual((await blocked.json()).code, 'PASSWORD_CHANGE_REQUIRED');
      assert.strictEqual((await rawFetch(`${BASE_URL}/api/auth/me`, asUser(cookie))).status, 200, '/me stays reachable');
      for (const weak of ['short1', 'onlyletterspassword', '1234567890123', u.username]) {
        const r = await rawFetch(`${BASE_URL}/api/auth/change-password`, jsonBody('POST', { current_password: u.tempPassword, new_password: weak }, cookie));
        assert.strictEqual(r.status, 400, `weak password "${weak}" must be refused`);
      }
      const wrongCurrent = await rawFetch(`${BASE_URL}/api/auth/change-password`, jsonBody('POST', { current_password: 'Wrong-current-1', new_password: STRONG }, cookie));
      assert.strictEqual(wrongCurrent.status, 400);
      const ok = await rawFetch(`${BASE_URL}/api/auth/change-password`, jsonBody('POST', { current_password: u.tempPassword, new_password: STRONG }, cookie));
      assert.strictEqual(ok.status, 200);
      assert.strictEqual((await rawFetch(`${BASE_URL}/api/metrics/calculate`, asUser(cookie))).status, 200);
      assert.strictEqual((await loginAs(u.username, u.tempPassword)).res.status, 401, 'old temporary password no longer works');
      assert.strictEqual((await loginAs(u.username, STRONG)).res.status, 200);
    });

    await runTest('[POSITIVE] Logout invalidates the session server-side (the old cookie gets 401)', async () => {
      const u = await readyUser('c', 'USER', itDir);
      assert.strictEqual((await rawFetch(`${BASE_URL}/api/auth/me`, asUser(u.cookie))).status, 200);
      assert.strictEqual((await rawFetch(`${BASE_URL}/api/auth/logout`, jsonBody('POST', {}, u.cookie))).status, 200);
      assert.strictEqual((await rawFetch(`${BASE_URL}/api/auth/me`, asUser(u.cookie))).status, 401);
    });

    await runTest('[NEGATIVE] Wrong password / unknown user / empty fields: the same generic 401 message (no user enumeration), 400 for missing fields', async () => {
      const u = await readyUser('d', 'USER', itDir);
      const wrong = await loginAs(u.username, 'Totally-Wrong-1');
      const unknown = await loginAs(`nobody${stamp}`, 'Totally-Wrong-1');
      assert.strictEqual(wrong.res.status, 401);
      assert.strictEqual(unknown.res.status, 401);
      assert.strictEqual((await wrong.res.json()).error, (await unknown.res.json()).error);
      assert.strictEqual(wrong.cookie, null);
      assert.strictEqual((await rawFetch(`${BASE_URL}/api/auth/login`, jsonBody('POST', { username: u.username }))).status, 400);
      assert.strictEqual((await rawFetch(`${BASE_URL}/api/auth/login`, jsonBody('POST', {}))).status, 400);
      assert.strictEqual((await rawFetch(`${BASE_URL}/api/auth/login`, jsonBody('POST', { username: { $ne: 1 }, password: { $ne: 1 } }))).status, 400);
    });

    await runTest('[NEGATIVE] 5 wrong passwords lock the account: even the right password is refused until the Admin resets it (reset also unlocks, shows the temp password once)', async () => {
      const u = await readyUser('e', 'USER', itDir);
      for (let i = 0; i < 5; i++) assert.strictEqual((await loginAs(u.username, 'Bad-Password-1')).res.status, 401);
      assert.strictEqual((await loginAs(u.username, u.password)).res.status, 401, 'locked: correct password must be refused');
      const listed = (await (await adminJson('GET', '/api/admin/users')).json()).find(x => x.user_id === u.id);
      assert.ok(listed.locked_until, 'admin list shows the lock');
      const reset = await adminJson('POST', `/api/admin/users/${u.id}/reset-password`);
      assert.strictEqual(reset.status, 200);
      const rb = await reset.json();
      assert.ok(rb.temporary_password && rb.temporary_password.length >= 10);
      assert.strictEqual(rb.user.must_change_password, true);
      assert.strictEqual((await loginAs(u.username, u.password)).res.status, 401, 'old password dead after reset');
      assert.strictEqual((await loginAs(u.username, rb.temporary_password)).res.status, 200);
      const again = (await (await adminJson('GET', '/api/admin/users')).json()).find(x => x.user_id === u.id);
      assert.strictEqual(JSON.stringify(again).includes(rb.temporary_password), false, 'the temporary password is never shown again');
    });

    await runTest('[NEGATIVE] Without a login the data/API routes answer 401 (sample of every area), and so do /uploads and /exports', async () => {
      const gets = ['/api/metrics/calculate', '/api/metrics/trends', '/api/metrics/8/detail', '/api/alerts', '/api/action-library', '/api/settings',
        '/api/events', '/api/events/ev-perspektif-2024-q1', '/api/questions/master', '/api/qrcode?text=x', '/api/surveys/metrics', '/api/surveys/template',
        '/api/surveys/evidence', '/api/surveys/history', '/api/surveys/responses/8', '/api/admin/parameters', '/api/admin/users', '/api/admin/audit-log',
        '/api/admin/email-settings', '/api/admin/targets', '/api/auth/me', '/api/reports/download/x.pptx', '/uploads/sample.jpg', '/exports/x.pptx'];
      for (const p of gets) assert.strictEqual((await rawFetch(`${BASE_URL}${p}`)).status, 401, `GET ${p}`);
      const posts = ['/api/events', '/api/metrics/weights', '/api/metrics/score', '/api/alerts/acknowledge', '/api/surveys/upload', '/api/admin/users', '/api/events/x/media',
        '/api/events/x/generate-ppt', '/api/media/x/transcribe', '/api/auth/logout', '/api/auth/change-password'];
      for (const p of posts) assert.strictEqual((await rawFetch(`${BASE_URL}${p}`, jsonBody('POST', {}))).status, 401, `POST ${p}`);
      assert.strictEqual((await rawFetch(`${BASE_URL}/api/events/x`, jsonBody('DELETE'))).status, 401);
      assert.strictEqual((await rawFetch(`${BASE_URL}/api/media/x`, jsonBody('DELETE'))).status, 401);
      assert.strictEqual((await rawFetch(`${BASE_URL}/api/admin/metrics/1`, jsonBody('DELETE'))).status, 401);
      assert.strictEqual((await rawFetch(`${BASE_URL}/api/metrics/calculate`, asUser('px_session=' + 'a'.repeat(64)))).status, 401, 'forged cookie');
      assert.strictEqual((await rawFetch(`${BASE_URL}/api/metrics/calculate`, asUser('px_session=garbage'))).status, 401);
    });

    await runTest('[POSITIVE] The public check-in / feedback forms still work with no login (directory, event by code, attendance, feedback); /health hides database details', async () => {
      assert.strictEqual((await rawFetch(`${BASE_URL}/api/directorates`)).status, 200);
      assert.strictEqual((await rawFetch(`${BASE_URL}/api/events/by-code/NOSUCHCODE`)).status, 404, '404 (unknown code), not 401');
      assert.strictEqual((await rawFetch(`${BASE_URL}/api/events/ev-perspektif-2024-q1/attendance`, jsonBody('POST', {}))).status, 400, '400 (validation), not 401');
      assert.strictEqual((await rawFetch(`${BASE_URL}/api/events/ev-perspektif-2024-q1/feedback`, jsonBody('POST', {}))).status, 400);
      const health = await (await rawFetch(`${BASE_URL}/api/health`)).json();
      assert.strictEqual(health.status, 'online');
      assert.strictEqual(health.database, undefined, 'database details only for logged-in users');
      const full = await (await fetch(`${BASE_URL}/api/health`)).json();
      assert.ok(full.database, 'logged-in users still get the database block');
    });

    await runTest('[NEGATIVE] A state-changing request from another Origin is refused (CSRF defence in depth)', async () => {
      const res = await rawFetch(`${BASE_URL}/api/events/ev-perspektif-2024-q1/attendance`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' }, body: '{}' });
      assert.strictEqual(res.status, 403);
    });

    await runTest('[NEGATIVE] A USER gets 403 on every /api/admin route and on admin-only actions; ADMIN does not', async () => {
      const u = await readyUser('f', 'USER', itDir);
      const gets = ['/api/admin/parameters', '/api/admin/users', '/api/admin/audit-log', '/api/admin/email-settings', '/api/admin/targets', '/api/admin/survey-questions',
        '/api/admin/upload-reminders', '/api/surveys/metrics', '/api/surveys/template', '/api/surveys/history'];
      for (const p of gets) assert.strictEqual((await rawFetch(`${BASE_URL}${p}`, asUser(u.cookie))).status, 403, `GET ${p}`);
      const posts = [['/api/admin/users', { username: 'x' }], ['/api/admin/metrics', {}], ['/api/admin/parameters/reset', {}], ['/api/admin/upload-reminders/send', {}],
        ['/api/surveys/upload', {}], ['/api/metrics/weights', { weights: [] }], ['/api/metrics/score', { metric_id: 1 }], ['/api/alerts/acknowledge', { metric_id: 1 }],
        ['/api/action-library', { items: [] }], ['/api/questions/master', { questions: [] }]];
      for (const [p, b] of posts) assert.strictEqual((await rawFetch(`${BASE_URL}${p}`, jsonBody('POST', b, u.cookie))).status, 403, `POST ${p}`);
      assert.strictEqual((await rawFetch(`${BASE_URL}/api/admin/settings/px_index_target`, jsonBody('PUT', { value: 50 }, u.cookie))).status, 403);
      assert.strictEqual((await rawFetch(`${BASE_URL}/api/admin/email-settings`, jsonBody('PUT', { enabled: true }, u.cookie))).status, 403);
      assert.strictEqual((await rawFetch(`${BASE_URL}/api/admin/users/${u.id}`, jsonBody('PUT', { role: 'ADMIN' }, u.cookie))).status, 403, 'no self-promotion');
      assert.strictEqual((await adminJson('GET', '/api/admin/parameters')).status, 200);
      assert.strictEqual((await adminJson('GET', '/api/surveys/metrics')).status, 200);
      const me = await (await rawFetch(`${BASE_URL}/api/auth/me`, asUser(u.cookie))).json();
      assert.strictEqual(me.user.role, 'USER', 'role unchanged');
    });

    await runTest('[POSITIVE/NEGATIVE] A USER only sees their own directorate: no/ALL/own is accepted and forced to own; another directorate is 403 (calculate, trends, detail)', async () => {
      const u = await readyUser('g', 'USER', itDir);
      const own = itDir.directorate_name;
      const get = async q => rawFetch(`${BASE_URL}${q}`, asUser(u.cookie));
      for (const q of ['/api/metrics/calculate?period=YTD', '/api/metrics/calculate?period=YTD&directorate=ALL', `/api/metrics/calculate?period=YTD&directorate=${encodeURIComponent(own)}`]) {
        const r = await get(q);
        assert.strictEqual(r.status, 200, q);
        assert.strictEqual((await r.json()).directorate, own, `${q} must be forced to the user's directorate`);
      }
      const other = encodeURIComponent(otherDir2.directorate_name);
      for (const q of [`/api/metrics/calculate?period=YTD&directorate=${other}`, `/api/metrics/trends?directorate=${other}`, `/api/metrics/8/detail?directorate=${other}`,
        `/api/metrics/calculate?directorate=${encodeURIComponent('Nama Ngawur')}`]) {
        assert.strictEqual((await get(q)).status, 403, q);
      }
      assert.strictEqual((await get('/api/metrics/trends')).status, 200);
      assert.strictEqual((await get(`/api/metrics/trends?directorate=${encodeURIComponent(own)}`)).status, 200);
      // the Admin can still pick any directorate
      const adminOther = await (await adminJson('GET', `/api/metrics/calculate?period=YTD&directorate=${other}`)).json();
      assert.strictEqual(adminOther.directorate, otherDir2.directorate_name);
      // read-only bankwide view of a non-employee metric (campus, #2) stays available to the USER
      assert.strictEqual((await get('/api/metrics/2/detail')).status, 200);
      assert.strictEqual((await get('/api/metrics/1/detail')).status, 200);
    });

    await runTest('[NEGATIVE] A USER never sees respondent identity (metric detail, metric 11 attendees, evidence CSV, responses); the Admin does', async () => {
      const u = await readyUser('h', 'USER', itDir);
      const detail = await (await rawFetch(`${BASE_URL}/api/metrics/8/detail?period=YTD`, asUser(u.cookie))).json();
      assert.ok(detail.responses.length > 0, 'USER still sees the (anonymous) answers');
      assert.strictEqual(detail.respondent_data_hidden, true);
      detail.responses.forEach(r => {
        ['nip', 'employee_name', 'cimb_email', 'email'].forEach(f => assert.ok(r[f] === null || r[f] === undefined, `response.${f} must be hidden`));
        assert.ok(r.ratings, 'answers remain visible');
      });
      const adminDetail = await (await adminJson('GET', '/api/metrics/8/detail?period=YTD')).json();
      assert.ok(adminDetail.responses.some(r => r.nip && r.employee_name), 'Admin still sees identities');
      const d11 = await (await rawFetch(`${BASE_URL}/api/metrics/11/detail?period=YTD`, asUser(u.cookie))).json();
      (d11.operational_records || []).forEach(r => {
        assert.ok(!r.nip && !r.employee_name && !r.cimb_email, 'metric 11 attendee identity hidden');
      });
      assert.strictEqual((await rawFetch(`${BASE_URL}/api/surveys/evidence?metric_id=8&period=YTD`, asUser(u.cookie))).status, 403);
      assert.strictEqual((await rawFetch(`${BASE_URL}/api/surveys/evidence?metric_id=ALL&period=YTD`, asUser(u.cookie))).status, 403);
      assert.strictEqual((await rawFetch(`${BASE_URL}/api/surveys/responses/8`, asUser(u.cookie))).status, 403);
      assert.strictEqual((await adminJson('GET', '/api/surveys/evidence?metric_id=8&period=YTD')).status, 200);
      // attendee / feedback identity inside the event detail is also hidden for non-managers
      const ev = await (await rawFetch(`${BASE_URL}/api/events/ev-perspektif-2024-q1`, asUser(u.cookie))).json();
      ev.attendances.forEach(a => assert.ok(!a.nip && !a.employee_name && !a.cimb_email));
      ev.feedbacks.forEach(f => assert.ok(!f.nip));
      const evAdmin = await (await adminJson('GET', '/api/events/ev-perspektif-2024-q1')).json();
      assert.ok(evAdmin.attendances.every(a => a.nip));
      // the public form access codes are not sent to non-managers either (list + detail), but are to Admin
      const evList = await (await rawFetch(`${BASE_URL}/api/events`, asUser(u.cookie))).json();
      evList.forEach(e => assert.ok(!e.pre_event_code && !e.post_event_code, 'codes hidden in list'));
      assert.ok(!ev.event.pre_event_code && !ev.event.post_event_code, 'codes hidden in detail');
      assert.ok(evAdmin.event.pre_event_code && evAdmin.event.post_event_code, 'Admin still gets the codes');
    });

    await runTest('[POSITIVE/NEGATIVE] Event writes: ADMIN and a USER of the HR directorate (from the database setting) may; a USER of another directorate gets 403 but can read', async () => {
      assert.ok(hrDir, `directorate "${hrName}" from event_manager_directorates must exist in the directory`);
      const hr = await readyUser('hr', 'USER', hrDir);
      const it = await readyUser('it', 'USER', itDir);
      assert.strictEqual((await rawFetch(`${BASE_URL}/api/auth/me`, asUser(hr.cookie)).then(r => r.json())).permissions.can_manage_events, true);
      assert.strictEqual((await rawFetch(`${BASE_URL}/api/auth/me`, asUser(it.cookie)).then(r => r.json())).permissions.can_manage_events, false);
      const payload = { event_name: 'Regression Test Event (Module 34 Access)', program_category: 'Testing', event_type: 'Online', event_date: '2026-08-20', target_participants: 5 };
      const made = [];
      try {
        assert.strictEqual((await rawFetch(`${BASE_URL}/api/events`, jsonBody('POST', payload, it.cookie))).status, 403, 'non-HR USER cannot create');
        const byHr = await rawFetch(`${BASE_URL}/api/events`, jsonBody('POST', payload, hr.cookie));
        assert.strictEqual(byHr.status, 201, 'HR USER can create');
        made.push((await byHr.json()).event.event_id);
        const byAdmin = await adminJson('POST', '/api/events', payload);
        assert.strictEqual(byAdmin.status, 201, 'ADMIN can create');
        made.push((await byAdmin.json()).event.event_id);
        const eventId = made[0];
        // everyone logged in can read
        assert.strictEqual((await rawFetch(`${BASE_URL}/api/events/${eventId}`, asUser(it.cookie))).status, 200);
        assert.ok((await (await rawFetch(`${BASE_URL}/api/events`, asUser(it.cookie))).json()).some(e => e.event_id === eventId));
        // non-HR USER: no delete, media, transcript, PPT, report download, questions, check-in clean-up
        assert.strictEqual((await rawFetch(`${BASE_URL}/api/events/${eventId}`, jsonBody('DELETE', undefined, it.cookie))).status, 403);
        assert.strictEqual((await rawFetch(`${BASE_URL}/api/events/${eventId}/generate-ppt`, jsonBody('POST', {}, it.cookie))).status, 403);
        assert.strictEqual((await rawFetch(`${BASE_URL}/api/events/${eventId}/questions`, jsonBody('POST', { questions: [] }, it.cookie))).status, 403);
        assert.strictEqual((await rawFetch(`${BASE_URL}/api/events/${eventId}/attendance/12345`, jsonBody('DELETE', undefined, it.cookie))).status, 403);
        assert.strictEqual((await rawFetch(`${BASE_URL}/api/events/${eventId}/feedback/12345`, jsonBody('DELETE', undefined, it.cookie))).status, 403);
        assert.strictEqual((await rawFetch(`${BASE_URL}/api/media/x/transcribe`, jsonBody('POST', {}, it.cookie))).status, 403);
        assert.strictEqual((await rawFetch(`${BASE_URL}/api/media/x`, jsonBody('DELETE', undefined, it.cookie))).status, 403);
        assert.strictEqual((await rawFetch(`${BASE_URL}/api/reports/download/x.pptx`, asUser(it.cookie))).status, 403);
        assert.strictEqual((await rawFetch(`${BASE_URL}/exports/x.pptx`, asUser(it.cookie))).status, 403);
        const form = new FormData();
        form.append('mediaFile', new Blob([Buffer.from('x')], { type: 'image/png' }), 'x.png');
        assert.strictEqual((await rawFetch(`${BASE_URL}/api/events/${eventId}/media`, asUser(it.cookie, { method: 'POST', body: form }))).status, 403);
        // HR USER: PPT generation works, and the generated file is downloadable only by managers
        const ppt = await rawFetch(`${BASE_URL}/api/events/ev-perspektif-2024-q1/generate-ppt`, jsonBody('POST', {}, hr.cookie));
        assert.strictEqual(ppt.status, 200);
        const pptBody = await ppt.json();
        assert.strictEqual((await rawFetch(`${BASE_URL}${pptBody.download_url}`, asUser(hr.cookie))).status, 200);
        assert.strictEqual((await rawFetch(`${BASE_URL}${pptBody.download_url}`, asUser(it.cookie))).status, 403);
        assert.strictEqual((await rawFetch(`${BASE_URL}${pptBody.download_url}`)).status, 401);
        assert.strictEqual((await rawFetch(`${BASE_URL}/api/reports/download/..%2F..%2Fpackage.json`, asUser(hr.cookie))).status, 404, 'no path traversal');
        const hrRead = await (await rawFetch(`${BASE_URL}/api/events/ev-perspektif-2024-q1`, asUser(hr.cookie))).json();
        assert.ok(hrRead.attendances.every(a => a.nip), 'HR USER sees attendee data of events');
      } finally {
        for (const id of made) await adminJson('DELETE', `/api/events/${id}`);
      }
    });

    await runTest('[POSITIVE/NEGATIVE] User management: validation (role, directorate/division from the directory, duplicate, bad username), no self lock-out, deactivated user is shut out', async () => {
      const base = { username: `rtv${stamp}`, full_name: 'Regression V', email: 'v@example.test', role: 'USER', directorate: itDir.directorate_name, division: itDir.divisions[0] };
      const create = body => adminJson('POST', '/api/admin/users', body);
      assert.strictEqual((await create({ ...base, role: 'SUPERUSER' })).status, 400);
      assert.strictEqual((await create({ ...base, directorate: undefined, division: undefined })).status, 400, 'USER needs directorate + division');
      assert.strictEqual((await create({ ...base, directorate: 'Direktorat Fiktif' })).status, 400);
      assert.strictEqual((await create({ ...base, division: otherDir2.divisions[0] })).status, 400, 'division must belong to the directorate');
      assert.strictEqual((await create({ ...base, username: 'a b' })).status, 400);
      assert.strictEqual((await create({ ...base, username: 'ab' })).status, 400);
      assert.strictEqual((await create({ ...base, full_name: '   ' })).status, 400);
      assert.strictEqual((await create({ ...base, email: 'not-an-email' })).status, 400);
      const ok = await create(base);
      assert.strictEqual(ok.status, 201);
      const okBody = await ok.json();
      createdUserIds.push(okBody.user.user_id);
      assert.strictEqual(okBody.user.must_change_password, true);
      assert.strictEqual((await create(base)).status, 409, 'duplicate username');
      assert.strictEqual((await create({ ...base, username: base.username.toUpperCase() })).status, 409, 'username is case-insensitive');
      // an ADMIN account is not tied to a directorate
      const adm = await create({ ...base, username: `rtadm${stamp}`, role: 'ADMIN', directorate: itDir.directorate_name, division: itDir.divisions[0] });
      assert.strictEqual(adm.status, 201);
      const admBody = await adm.json();
      createdUserIds.push(admBody.user.user_id);
      assert.strictEqual(admBody.user.directorate, null);
      // update: changing directorate re-validates, deactivation shuts the user out
      const u = await readyUser('i', 'USER', itDir);
      assert.strictEqual((await adminJson('PUT', `/api/admin/users/${u.id}`, { directorate: otherDir2.directorate_name })).status, 400, 'old division no longer valid');
      const moved = await adminJson('PUT', `/api/admin/users/${u.id}`, { directorate: otherDir2.directorate_name, division: otherDir2.divisions[0] });
      assert.strictEqual(moved.status, 200);
      assert.strictEqual((await (await rawFetch(`${BASE_URL}/api/metrics/calculate`, asUser(u.cookie))).json()).directorate, otherDir2.directorate_name, 'scope follows the account at once');
      assert.strictEqual((await adminJson('PUT', `/api/admin/users/${u.id}`, { is_active: false })).status, 200);
      assert.strictEqual((await rawFetch(`${BASE_URL}/api/auth/me`, asUser(u.cookie))).status, 401, 'existing session dies on deactivation');
      assert.strictEqual((await loginAs(u.username, u.password)).res.status, 401, 'deactivated user cannot log in');
      assert.strictEqual((await adminJson('PUT', `/api/admin/users/${u.id}`, { is_active: true })).status, 200);
      assert.strictEqual((await loginAs(u.username, u.password)).res.status, 200);
      assert.strictEqual((await adminJson('PUT', '/api/admin/users/999999', { is_active: false })).status, 404);
      // no self lock-out
      const me = (await (await adminJson('GET', '/api/auth/me')).json()).user;
      assert.strictEqual((await adminJson('PUT', `/api/admin/users/${me.user_id}`, { is_active: false })).status, 400);
      assert.strictEqual((await adminJson('PUT', `/api/admin/users/${me.user_id}`, { role: 'USER', directorate: itDir.directorate_name, division: itDir.divisions[0] })).status, 400);
      assert.strictEqual((await adminJson('DELETE', `/api/admin/users/${me.user_id}`)).status, 400);
      assert.strictEqual((await adminJson('POST', `/api/admin/users/${me.user_id}/reset-password`)).status, 400);
      assert.strictEqual((await adminJson('GET', '/api/auth/me')).status, 200, 'admin still logged in');
    });

    await runTest('[POSITIVE] Audit trail records logins (ok / failed / locked), logout and user management, and never contains a password; secrets never appear in any response', async () => {
      const u = await readyUser('j', 'USER', itDir);
      await loginAs(u.username, 'Wrong-Audit-Pass-1');
      const log = await (await adminJson('GET', '/api/admin/audit-log?limit=500')).json();
      const text = JSON.stringify(log);
      allBodies.push(text);
      const mine = log.filter(e => e.username === u.username).map(e => e.action);
      ['LOGIN_SUCCESS', 'LOGIN_FAILED', 'PASSWORD_CHANGE'].forEach(a => assert.ok(mine.includes(a), `audit has ${a}`));
      assert.ok(log.some(e => e.action === 'USER_CREATE' && e.target && e.target.startsWith(u.username)));
      assert.ok(log.some(e => e.action === 'PASSWORD_RESET'));
      assert.ok(log.some(e => e.action === 'LOGOUT'));
      assert.ok(log.some(e => e.action === 'LOGIN_LOCKED'));
      [u.password, u.tempPassword, 'Wrong-Audit-Pass-1', STRONG].forEach(p => assert.ok(!text.includes(p), 'audit log must not contain passwords'));
      assert.strictEqual((await rawFetch(`${BASE_URL}/api/admin/audit-log`, asUser(u.cookie))).status, 403, 'audit log is Admin only');
      // sweep: no hash / scrypt string anywhere in what the API returned
      for (const p of ['/api/admin/users', '/api/auth/me', '/api/settings', '/api/admin/email-settings']) allBodies.push(JSON.stringify(await (await adminJson('GET', p)).json()));
      allBodies.forEach(b => {
        assert.ok(!b.includes('password_hash'), 'password_hash leaked');
        assert.ok(!b.includes('scrypt$'), 'scrypt hash leaked');
        assert.ok(!/"token_hash"/.test(b), 'token hash leaked');
      });
    });

    await runTest('[NEGATIVE] No respondent name appears ANYWHERE in what a USER receives (full-payload scan of every metric detail + alerts + events), even nested verbatim samples', async () => {
      const u = await readyUser('k', 'USER', itDir);
      const names = new Set();
      const collect = v => {
        if (Array.isArray(v)) return v.forEach(collect);
        if (v && typeof v === 'object') {
          for (const [k, x] of Object.entries(v)) {
            if (['employee_name', 'participant_name', 'candidate_name'].includes(k) && typeof x === 'string' && x.length >= 5 && x !== 'Responden') names.add(x);
            else collect(x);
          }
        }
      };
      const userJson = [];
      for (let id = 1; id <= 27; id++) {
        collect(await (await adminJson('GET', `/api/metrics/${id}/detail?period=YTD`)).json());
        const r = await rawFetch(`${BASE_URL}/api/metrics/${id}/detail?period=YTD`, asUser(u.cookie));
        if (r.status === 200) userJson.push(await r.text());
      }
      userJson.push(await (await rawFetch(`${BASE_URL}/api/alerts`, asUser(u.cookie))).text());
      userJson.push(await (await rawFetch(`${BASE_URL}/api/events/ev-perspektif-2024-q1`, asUser(u.cookie))).text());
      userJson.push(await (await rawFetch(`${BASE_URL}/api/metrics/calculate?period=YTD`, asUser(u.cookie))).text());
      assert.ok(names.size > 5, `expected known respondent names from the Admin view, got ${names.size}`);
      assert.ok(userJson.length >= 20);
      const all = userJson.join('\n');
      for (const n of names) assert.ok(!all.includes(JSON.stringify(n).slice(1, -1)), `respondent name "${n}" leaked to a USER`);
      // the free-text answers themselves stay visible (anonymous)
      const d5 = await (await rawFetch(`${BASE_URL}/api/metrics/5/detail?period=YTD`, asUser(u.cookie))).json();
      const samples = (d5.questions_breakdown || d5.questions || []).flatMap(q => q.verbatim_samples || []);
      samples.forEach(sm => assert.ok(sm.employee_name === null && sm.text));
    });

    await runTest('[POSITIVE] A USER sees non-employee metrics (#1-#5) as read-only bankwide values (not exempted), equal to the Admin ALL view, while the directorate index equals the Admin view of that directorate', async () => {
      const u = await readyUser('l', 'USER', itDir);
      const own = encodeURIComponent(itDir.directorate_name);
      const user = await (await rawFetch(`${BASE_URL}/api/metrics/calculate?period=YTD`, asUser(u.cookie))).json();
      const adminAll = await (await adminJson('GET', '/api/metrics/calculate?period=YTD')).json();
      const adminDir = await (await adminJson('GET', `/api/metrics/calculate?period=YTD&directorate=${own}`)).json();
      const nonEmp = user.metrics.filter(m => m.is_employee_metric === false);
      assert.ok(nonEmp.length >= 5);
      for (const m of nonEmp) {
        assert.strictEqual(m.is_disabled, false, `metric ${m.metric_id} must not be exempted for a USER`);
        const a = adminAll.metrics.find(x => x.metric_id === m.metric_id);
        assert.strictEqual(m.normalized_score, a.normalized_score, `metric ${m.metric_id} bankwide value`);
        assert.strictEqual(m.sample_size, a.sample_size);
      }
      assert.strictEqual(user.px_index, adminDir.px_index, 'scorecard total equals the Admin view of the same directorate');
      assert.strictEqual(user.survey_index, adminDir.survey_index);
      assert.ok(adminDir.metrics.filter(m => m.is_employee_metric === false).every(m => m.is_disabled), 'Admin directorate view is unchanged (exempted)');
    });

    await runTest('[POSITIVE/NEGATIVE] Public by-code lookup does not hand out the partner access code; failed logins for an unknown username store no raw text in the audit log', async () => {
      const ev = await (await adminJson('GET', '/api/events/ev-perspektif-2024-q1')).json();
      const pre = await (await rawFetch(`${BASE_URL}/api/events/by-code/${ev.event.pre_event_code}`)).json();
      const post = await (await rawFetch(`${BASE_URL}/api/events/by-code/${ev.event.post_event_code}`)).json();
      assert.strictEqual(pre.type, 'PRE_EVENT');
      assert.strictEqual(post.type, 'POST_EVENT');
      [pre.event, post.event].forEach(e => assert.ok(!e.pre_event_code && !e.post_event_code));
      const typo = `Typo-Pass-${stamp}-9`;
      assert.strictEqual((await loginAs(typo, 'whatever')).res.status, 401);
      const log = JSON.stringify(await (await adminJson('GET', '/api/admin/audit-log?limit=50')).json());
      assert.ok(!log.includes(typo), 'raw text typed into the username field must not be stored');
      assert.ok(log.includes('LOGIN_FAILED'));
    });

    await runTest('[POSITIVE/NEGATIVE] Through the Vite dev proxy (:3000, only when running): login works, a foreign Origin is still refused', async () => {
      const VITE = process.env.TEST_VITE_URL || 'http://localhost:3000';
      let up = false;
      try { up = (await rawFetch(`${VITE}/api/health`, { signal: AbortSignal.timeout(1500) })).ok; } catch (_) { /* vite not running: skipped */ }
      if (!up) { console.log('     (skipped: Vite dev server not running)'); return; }
      const body = JSON.stringify({ username: `nobody${stamp}`, password: 'x' });
      const viaProxy = await rawFetch(`${VITE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: VITE }, body });
      assert.strictEqual(viaProxy.status, 401, 'same-origin request through the proxy must reach the login handler, not be refused as cross-origin');
      const evil = await rawFetch(`${VITE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' }, body });
      assert.strictEqual(evil.status, 403);
    });

    await runTest('[POSITIVE/NEGATIVE] Units: scrypt hashing is salted and verifies only the right password; scope & identity helpers; login rate limiter blocks and expires', async () => {
      const auth = require('../server/services/authService');
      const { createRateLimiter } = require('../server/services/rateLimiter');
      const h1 = await auth.hashPassword('Sama-Saja-123');
      const h2 = await auth.hashPassword('Sama-Saja-123');
      assert.notStrictEqual(h1, h2, 'per-user salt');
      assert.ok(h1.startsWith('scrypt$'));
      assert.strictEqual(await auth.verifyPassword('Sama-Saja-123', h1), true);
      assert.strictEqual(await auth.verifyPassword('sama-saja-123', h1), false);
      assert.strictEqual(await auth.verifyPassword('', h1), false);
      assert.strictEqual(await auth.verifyPassword('x', 'garbage'), false);
      assert.strictEqual(await auth.verifyPassword('x', undefined), false);
      assert.notStrictEqual(auth.generateTempPassword(), auth.generateTempPassword());
      assert.strictEqual(auth.validateNewPassword(auth.generateTempPassword(), { username: 'x' }), null);
      const user = { role: 'USER', directorate: 'D1' };
      assert.strictEqual(auth.canSeeRespondentData(user, { metric_id: 1 }), false);
      assert.strictEqual(auth.canSeeRespondentData({ role: 'ADMIN' }, { metric_id: 1 }), true);
      assert.strictEqual(auth.canSeeRespondentData(null, { metric_id: 1 }), false);
      assert.deepStrictEqual(auth.resolveDirectorateScope(user, undefined), { directorate: 'D1' });
      assert.deepStrictEqual(auth.resolveDirectorateScope(user, 'ALL'), { directorate: 'D1' });
      assert.ok(auth.resolveDirectorateScope(user, 'D2').error);
      assert.ok(auth.resolveDirectorateScope({ role: 'USER', directorate: null }, 'ALL').error, 'USER without directorate is refused');
      assert.deepStrictEqual(auth.resolveDirectorateScope({ role: 'ADMIN' }, 'D2'), { directorate: 'D2' });
      const red = auth.redactRespondent({ nip: '1', employee_name: 'N', cimb_email: 'e', rating_score: 4 });
      assert.deepStrictEqual(red, { nip: null, employee_name: null, cimb_email: null, rating_score: 4 });
      const lim = createRateLimiter({ windowMs: 1000 });
      for (let i = 0; i < 3; i++) lim.record('ip', 1000 + i);
      assert.strictEqual(lim.isBlocked('ip', 3, 1100), true);
      assert.strictEqual(lim.isBlocked('ip', 4, 1100), false);
      assert.strictEqual(lim.isBlocked('other', 3, 1100), false);
      assert.strictEqual(lim.isBlocked('ip', 3, 2500), false, 'window expired');
      lim.record('ip2'); lim.reset('ip2');
      assert.strictEqual(lim.count('ip2'), 0);
    });
  } finally {
    for (const id of createdUserIds) await adminJson('DELETE', `/api/admin/users/${id}`);
    const left = (await (await adminJson('GET', '/api/admin/users')).json()).filter(x => x.username.endsWith(stamp) && x.username.startsWith('rt'));
    if (left.length) console.error(`     cleanup: ${left.length} test users remain`);
  }

  // --- SUMMARY ---
  console.log('\n================================================================');
  console.log(`📊 REGRESSION TEST SUMMARY: ${passedTests}/${totalTests} Tests Passed (${failedTests} Failed)`);
  console.log('================================================================\n');

  await teardownSuiteLogin();
  if (failedTests > 0) {
    process.exit(1);
  }
}

runRegressionSuite().catch(async err => {
  console.error('Test runner fatal error:', err);
  try { await teardownSuiteLogin(); } catch (_) { /* ignore */ }
  process.exit(1);
});
