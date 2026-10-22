// tests/regressionTest.js
const assert = require('assert');

// Overridable so the suite can run against a second backend (e.g. one pointed at a fake transcribe API).
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:5000';
const TRANSCRIBE_PORT = parseInt(process.env.TEST_TRANSCRIBE_PORT || '8000', 10);

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
let skippedTests = 0;

// Optional module skip (e.g. a change that does not touch media / transcript / AI summary code):
//   TEST_SKIP_MODULES=27,32,38,41,42,43   or   TEST_SKIP_MEDIA=1 (= exactly those six modules)
// A skipped test is counted and reported as SKIPPED - never as passed. The current module is taken from the
// "📦 MODULE <n>:" header line each module prints.
const SKIP_MODULES = new Set(String(process.env.TEST_SKIP_MODULES || (process.env.TEST_SKIP_MEDIA === '1' ? '27,32,38,41,42,43' : ''))
  .split(',').map(x => x.trim()).filter(Boolean));
let currentModule = null;
if (SKIP_MODULES.size) {
  const origLog = console.log;
  console.log = (...args) => {
    const m = typeof args[0] === 'string' && args[0].match(/📦 MODULE (\d+[a-z]?):/);
    if (m) currentModule = m[1];
    origLog(...args);
  };
}
// Guard for modules whose setup (second backends, fake services) lives outside runTest: true = skip the whole block.
function skipModuleBlock(n) {
  if (!SKIP_MODULES.has(String(n))) return false;
  console.log(`  ⏭️  SKIPPED: Module ${n} (TEST_SKIP_MODULES / TEST_SKIP_MEDIA) - none of its tests ran`);
  return true;
}

// One CSV cell: quoted when it holds a comma / quote (real directorate names such as "Strategy, Finance & SPAPM" do).
const csvCell = v => (/[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

// v2.51.0: the Admin can rename / merge directorates (Admin Parameters -> Directorates). Modules that name a real directorate
// map it through the CURRENT directory + its former names, so they keep working after e.g. "Special Asset" became "SLC ASG Satyaguna Langgeng Capital".
async function currentDirectorateName() {
  const dirs = await (await fetch(`${BASE_URL}/api/directorates`)).json();
  const admin = await (await fetch(`${BASE_URL}/api/admin/directorates`)).json();
  const aliases = (admin.directorates || []).flatMap(d => (d.former_names || []).map(alias_name => ({ alias_name, directorate_name: d.name })));
  const resolver = require('../server/db/directoryNames').buildResolver(dirs, { directorates: aliases });
  return name => resolver.directorate(name) || name;
}

// ESS summary workbook (v2.32.0) built in-test: rows = arrays of cell values (row 1 = header). Uses the app's own minimal
// .xlsx writer (required lazily, after the suite has loaded .env); parsing in the tests goes through jszip directly.
const essXlsx = rows => require('../server/services/essSummaryService').buildXlsx(rows);
const ESS_HEAD = (index = 'Test Index', questions = ['Question one']) => ['Directorate', 'Level', 'Year', 'Month', 'Participation', index, ...questions];
// multipart upload of an ESS file; cookie = another user's session (otherwise the suite admin)
async function postEssFile(metricId, buf, fileName = 'ess_summary.xlsx', cookie = null) {
  const fd = new FormData();
  if (metricId !== null && metricId !== undefined) fd.append('metric_id', String(metricId));
  fd.append('file', new Blob([buf]), fileName);
  return cookie
    ? realFetch(`${BASE_URL}/api/surveys/upload`, { method: 'POST', body: fd, headers: { Cookie: cookie } })
    : fetch(`${BASE_URL}/api/surveys/upload`, { method: 'POST', body: fd });
}

function runTest(name, fn) {
  if (currentModule && SKIP_MODULES.has(currentModule)) {
    skippedTests++;
    console.log(`  ⏭️  SKIP: ${name}`);
    return Promise.resolve();
  }
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
// Idle sign-out (v2.44.0): a session ends after session_idle_timeout_minutes (default 5) without REAL activity, and
// ordinary requests do not count. The suite runs far longer with one login, so - like a user who keeps working - every
// session cookie it sends to the app reports activity (POST /api/auth/activity) at most once per SUITE_KEEPALIVE_MS.
// nativeFetch skips that (Module 49 tests the idle rule itself on its own sessions).
const nativeFetch = globalThis.fetch;
const SUITE_KEEPALIVE_MS = 60 * 1000;
const sessionPings = new Map(); // cookie -> time of the last activity ping
async function keepSessionAlive(url, opts) {
  const cookie = opts && opts.headers && !(opts.headers instanceof Headers) ? opts.headers.Cookie : null;
  if (!cookie || !/px_session=/.test(cookie) || !String(url).startsWith(BASE_URL) || /\/api\/auth\/(activity|login|logout)/.test(String(url))) return;
  if (Date.now() - (sessionPings.get(cookie) || 0) < SUITE_KEEPALIVE_MS) return;
  sessionPings.set(cookie, Date.now());
  try { await nativeFetch(`${BASE_URL}/api/auth/activity`, { method: 'POST', headers: { Cookie: cookie } }); } catch (_) { /* the request itself reports the problem */ }
}
const realFetch = async (url, opts = {}) => { await keepSessionAlive(url, opts); return nativeFetch(url, opts); };
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
    const created = await storage.createUser({ is_test_account: true, username, full_name: 'Regression Suite Admin', email: '', role: 'ADMIN', password_hash: await hashPassword(password), must_change_password: false });
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

// --- CONFIGURATION GUARD (v2.51.0) ---
// The suite runs against the SAME database as the live app, and some modules reset or edit what an Admin configures
// (Module 16 resets every journey / checkpoint / metric, others PUT metric parameters, reset survey questions or change
// settings) - an Admin's own edits used to be lost that way. So, on SQL Server, the suite takes a snapshot of the whole
// Admin configuration (storage.snapshotConfiguration: journeys, checkpoints, metrics + targets, survey questions, master
// questions, action library, app settings, directorate master + former names) before the first module and puts it back
// exactly (ids kept; metrics created by tests are deleted with their data) right after the Module 16 reset and at the end
// of the run - also after a failed assertion or a fatal error. The snapshot is written to a gitignored file first. If a run
// is killed, that file stays behind and the NEXT run stops before it does anything: the file may be days old and restoring
// it would undo real Admin edits since then, so it is never restored (or thrown away) without an explicit choice:
//   TEST_RESTORE_STALE_SNAPSHOT=1  restore it, delete the file, then run the suite as usual (with a fresh snapshot)
//   TEST_DISCARD_STALE_SNAPSHOT=1  keep the live configuration, rename the file to *.discarded-<stamp>.json, run the suite
// JSON backend: the server keeps store.json in memory, so the suite cannot put it back - back the file up and restore it.
const CONFIG_SNAPSHOT_FILE = require('path').join(__dirname, '..', 'server', 'data', 'backups', 'regression-config-snapshot.json');
let configGuard = null; // { storage, snapshot } while the guard is active

const describeRestore = r => [
  r.restored_tables.length ? `tables put back: ${r.restored_tables.join(', ')}` : 'nothing had changed',
  ...(r.removed_metrics.length ? [`test metrics removed: ${r.removed_metrics.map(m => `#${m.metric_id} "${m.metric_name}"`).join(', ')}`] : [])
].join('; ');

// A snapshot file left behind by a run that was killed. choice = { restore, discard } (default: the env variables above).
// No choice -> throws (err.staleSnapshot) with the file's age and what differs from the live configuration; nothing changes.
// restore -> restores it and deletes the file; discard -> renames it to *.discarded-<stamp>.json. Returns null without a file.
const staleChoiceFromEnv = () => ({ restore: process.env.TEST_RESTORE_STALE_SNAPSHOT === '1', discard: process.env.TEST_DISCARD_STALE_SNAPSHOT === '1' });
async function handleStaleConfigSnapshot(storage, file, choice = staleChoiceFromEnv()) {
  const fs = require('fs');
  if (!fs.existsSync(file)) return null;
  const stale = err => Object.assign(new Error(err), { staleSnapshot: true });
  let left = null;
  let summary;
  try {
    left = JSON.parse(fs.readFileSync(file, 'utf8'));
    const ageH = (Date.now() - new Date(left.taken_at).getTime()) / 3600000;
    const cmp = await storage.compareConfiguration(left);
    summary = [`taken ${left.taken_at} (${ageH < 48 ? `${ageH.toFixed(1)} hours` : `${(ageH / 24).toFixed(1)} days`} ago)`,
      cmp.differing_tables.length ? `differs from the live configuration in: ${cmp.differing_tables.join(', ')}` : 'equal to the live configuration',
      ...(cmp.extra_metrics.length ? [`live metrics a restore would DELETE with their data: ${cmp.extra_metrics.map(m => `#${m.metric_id} "${m.metric_name}"`).join(', ')}`] : []),
      ...(cmp.missing_metrics.length ? [`metrics a restore would bring back: ${cmp.missing_metrics.map(m => `#${m.metric_id} "${m.metric_name}"`).join(', ')}`] : [])];
  } catch (err) {
    left = null;
    summary = [`cannot be used for a restore: ${err.message}`];
  }
  if (choice.restore && choice.discard) throw stale('Set only ONE of TEST_RESTORE_STALE_SNAPSHOT / TEST_DISCARD_STALE_SNAPSHOT.');
  if (choice.restore) {
    if (!left) throw stale(`Configuration guard: the leftover snapshot ${file} ${summary[0]} - discard it instead (TEST_DISCARD_STALE_SNAPSHOT=1).`);
    console.log(`  ⚠️  Configuration guard: restoring the leftover snapshot (TEST_RESTORE_STALE_SNAPSHOT=1) - ${summary.join('; ')}`);
    const r = await storage.restoreConfiguration(left);
    console.log(`     restored: ${describeRestore(r)}`);
    fs.unlinkSync(file);
    return { action: 'restored', result: r };
  }
  if (choice.discard) {
    const kept = file.replace(/\.json$/, `.discarded-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.renameSync(file, kept);
    console.log(`  ⚠️  Configuration guard: leftover snapshot NOT restored (TEST_DISCARD_STALE_SNAPSHOT=1), kept as ${kept} - ${summary.join('; ')}`);
    return { action: 'discarded', file: kept };
  }
  throw stale(['', '  ⛔ Configuration guard: a configuration snapshot from an earlier run that did not finish was found:', `     ${file}`,
    ...summary.map(x => `     - ${x}`),
    '     It is NOT restored automatically (it may undo Admin edits made since then). Nothing was changed and no test ran. Choose:',
    '       TEST_RESTORE_STALE_SNAPSHOT=1  put that configuration back, then run the suite',
    '       TEST_DISCARD_STALE_SNAPSHOT=1  keep the live configuration (the file is renamed to *.discarded-<stamp>.json), then run the suite', ''].join('\n'));
}

// Before anything else (login included): a leftover snapshot stops the run unless the env variables say what to do with it.
async function checkStaleConfigSnapshot() {
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
  const storage = require('../server/db/storage');
  if (storage.backend !== 'sql') return;
  await handleStaleConfigSnapshot(storage, CONFIG_SNAPSHOT_FILE);
}

async function startConfigGuard() {
  const fs = require('fs');
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
  const storage = require('../server/db/storage');
  if (storage.backend !== 'sql') {
    console.log('  ⚠️  Configuration guard OFF: JSON backend (the server keeps store.json in memory) - back up server/data/store.json before the run and restore it afterwards.\n');
    return;
  }
  const snapshot = await storage.snapshotConfiguration();
  fs.mkdirSync(require('path').dirname(CONFIG_SNAPSHOT_FILE), { recursive: true });
  fs.writeFileSync(`${CONFIG_SNAPSHOT_FILE}.tmp`, JSON.stringify(snapshot), 'utf8');
  fs.renameSync(`${CONFIG_SNAPSHOT_FILE}.tmp`, CONFIG_SNAPSHOT_FILE);
  configGuard = { storage, snapshot };
  console.log(`  🛡️  Configuration guard ON: Admin configuration saved (${Object.entries(snapshot.tables).map(([t, v]) => `${t.replace(/^px_/, '')} ${v.rows.length}`).join(', ')}); it is put back after the run.\n`);
}

// Puts the saved configuration back now (the guard stays active). Returns the restore result, or null without a guard.
async function restoreConfigGuard(reason) {
  if (!configGuard) return null;
  const r = await configGuard.storage.restoreConfiguration(configGuard.snapshot);
  console.log(`  🛡️  Configuration restored (${reason}): ${describeRestore(r)}`);
  return r;
}

async function finishConfigGuard(reason = 'end of run') {
  if (!configGuard) return;
  try {
    await restoreConfigGuard(reason);
    require('fs').unlinkSync(CONFIG_SNAPSHOT_FILE);
    configGuard = null;
  } catch (err) {
    failedTests++;
    console.error(`  ❌ Configuration guard: restoring the Admin configuration FAILED (${err.message}). The snapshot stays in ${CONFIG_SNAPSHOT_FILE}; the next run restores it first.`);
  }
}

// Ctrl+C / kill: put the configuration back before leaving (if that fails too, the next run does it from the file)
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, () => {
    console.error(`\n  ⚠️  ${sig}: restoring the Admin configuration before exiting ...`);
    finishConfigGuard(`interrupted by ${sig}`).finally(() => process.exit(130));
  });
}

// v2.55.0: metric 4 and the seed survey metrics with per-respondent rows (6, 8, 10, 23, 26) are N/A live ("real data not available yet");
// many older modules use them (metric 8 above all) as their per-respondent fixture. For the run they are switched AVAILABLE
// through the Admin API (audited as test-run rows) and switched back at the end (the configuration guard also restores
// px_metrics). Re-applied after every configuration restore; Module 60 switches them back to check the live state.
const LEGACY_FIXTURE_METRICS = [4, 6, 8, 10, 23, 26];
// v2.58.0: the metrics that exist when the run starts. An Admin may delete a seed metric (live: metric 4 was deleted in Admin
// Parameters), so the count / id assertions on the 27 seed metrics read this list instead of assuming all 27 still exist.
let LIVE_METRIC_IDS = [];
const liveSeedIds = (max = 27) => LIVE_METRIC_IDS.filter(id => id <= max);
const isLiveMetric = id => LIVE_METRIC_IDS.includes(id);
let legacyFixturesOn = [];
async function setLegacyFixtures(on) {
  if (on) {
    for (const id of LEGACY_FIXTURE_METRICS) {
      const m = await (await fetch(`${BASE_URL}/api/admin/parameters`)).json().then(p => p.metrics.find(x => x.metric_id === id)).catch(() => null);
      if (!m || m.data_status !== 'NOT_AVAILABLE') continue;
      const r = await fetch(`${BASE_URL}/api/admin/metrics/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data_status: 'AVAILABLE' }) });
      if (r.status === 200 && !legacyFixturesOn.includes(id)) legacyFixturesOn.push(id);
    }
    if (legacyFixturesOn.length) console.log(`  🧩 Test fixtures: metrics ${legacyFixturesOn.join(', ')} counted (AVAILABLE) for this run.`);
  } else {
    for (const id of legacyFixturesOn) await fetch(`${BASE_URL}/api/admin/metrics/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data_status: 'NOT_AVAILABLE' }) });
    if (legacyFixturesOn.length) console.log(`  🧩 Test fixtures: metrics ${legacyFixturesOn.join(', ')} back to N/A.`);
    legacyFixturesOn = [];
  }
}

async function runRegressionSuite() {
  console.log('\n================================================================');
  console.log('🧪 CIMB NIAGA PEOPLE EXPERIENCE (PX) - REGRESSION TESTING SUITE');
  console.log('================================================================\n');

  try {
    await checkStaleConfigSnapshot();
  } catch (err) {
    if (!err.staleSnapshot) throw err;
    console.error(err.message);
    process.exit(2);
  }
  await setupSuiteLogin();
  LIVE_METRIC_IDS = (await (await fetch(`${BASE_URL}/api/admin/parameters`)).json()).metrics.map(m => m.metric_id);
  await startConfigGuard();
  try {
    await setLegacyFixtures(true);
    await runAllModules();
  } finally {
    await setLegacyFixtures(false);
    await finishConfigGuard();
  }

  // --- SUMMARY ---
  console.log('\n================================================================');
  console.log(`📊 REGRESSION TEST SUMMARY: ${passedTests}/${totalTests} Tests Passed (${failedTests} Failed)${SKIP_MODULES.size ? `, ${skippedTests} test(s) SKIPPED + whole module block(s) skipped: modules ${[...SKIP_MODULES].join(', ')}` : ''}`);
  console.log('================================================================\n');

  await teardownSuiteLogin();
  if (failedTests > 0) {
    process.exit(1);
  }
}

async function runAllModules() {
  // --- 1. SYSTEM HEALTH & METRICS CALCULATION (YTD & PERIOD FILTER) ---
  console.log('📦 MODULE 1: Calculation Engine & Period Filtering');
  await runTest('System health endpoint is online', async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.status, 'online');
    assert.strictEqual(data.system, 'CIMB Niaga People Experience Integrated System');
  });

  await runTest('PX Index Year-to-Date (Default) calculation formula (configured weights, default 70% Survey + 30% Outcome)', async () => {
    const res = await fetch(`${BASE_URL}/api/metrics/calculate?period=YTD`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    const pxIndex = data.px_index !== undefined ? data.px_index : data.pe_index;
    assert(pxIndex > 0 && pxIndex <= 100, 'PX Index must be between 0 and 100');
    assert(data.survey_index > 0, 'Survey index must exist');
    assert(data.outcome_index > 0, 'Outcome index must exist');
    assert.strictEqual(data.metrics.length, LIVE_METRIC_IDS.length, 'Total metrics must be every existing metric (27 seed metrics minus those an Admin deleted)');
    assert.strictEqual(data.journeys.length, 5, 'Total journeys must be 5');
    assert.strictEqual(data.checkpoints.length, 17, 'Total checkpoints must be 17');
    
    // Formula verification: survey weight * survey + outcome weight * outcome (px_index_weights, default 70/30 - v2.48.0;
    // v2.51.0: the weights the Admin configured - the suite no longer resets the live configuration, Module 50 tests 70/30)
    const configuredWeights = (await (await fetch(`${BASE_URL}/api/settings`)).json()).px_index_weights;
    assert.deepStrictEqual(data.px_weights, configuredWeights, 'the configured PX Index weights');
    const expectedPx = Math.round((data.px_weights.survey / 100 * data.survey_index + data.px_weights.outcome / 100 * data.outcome_index) * 100) / 100;
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
    assert.strictEqual(jan.month_name, 'January');
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
    // v2.51.0: the name the Admin configured (e.g. renamed to "Day 90 Onboarding Satisfaction Index")
    const configured8 = (await (await fetch(`${BASE_URL}/api/admin/parameters`)).json()).metrics.find(m => m.metric_id === 8);
    assert.strictEqual(data.metric_name, configured8.metric_name);
    
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

  await runTest('Download Master All-Surveys Template (every SYSTEM survey metric; ESS metrics take their own .xlsx since v2.32.0)', async () => {
    const res = await fetch(`${BASE_URL}/api/surveys/template?metric_id=ALL`);
    assert.strictEqual(res.status, 200);
    const csv = await res.text();
    const lines = csv.trim().split('\n');
    const params = (await (await fetch(`${BASE_URL}/api/admin/parameters`)).json()).metrics;
    const systemCount = params.filter(m => m.metric_type === 'SURVEY' && m.survey_source !== 'ESS').length;
    assert.strictEqual(lines.length, 1 + systemCount, `Expected header + ${systemCount} SYSTEM metric rows, got ${lines.length}`);
  });

  // --- 5. QUESTION-BASED BULK CSV IMPORT & LIVE RECALCULATION ---
  console.log('\n📦 MODULE 5: Question-Based Survey CSV Import & Live Recalculation');
  await runTest('Upload question-level survey CSV for Metric #8 and verify recalculated scores', async () => {
    const questionCsv = [
      'nip,employee_name,cimb_email,directorate,division,metric_id,metric_name,q1_role_clarity,q2_supervisor_support,q3_buddy_support,q4_resource_access,verbatim_feedback,survey_date',
      '8809901,Andi Pratama,andi.p@cimbniaga.co.id,"Operations, Technology, Analytics & AI",Core Banking,8,Onboarding 30/60/90 Satisfaction Index,5.0,5.0,5.0,5.0,Proses onboarding dan buddy sangat profesional!,2026-03-25',
      '8809902,Siti Rahayu,siti.r@cimbniaga.co.id,Consumer & EBB,Wealth Management,8,Onboarding 30/60/90 Satisfaction Index,4.8,5.0,4.8,4.8,Sangat memuaskan dan fasilitas kerja langsung siap,2026-03-25',
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
    assert.strictEqual(totalCount, LIVE_METRIC_IDS.length, 'Should have targets for every existing metric');
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
          directorate: 'Operations, Technology, Analytics & AI',
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

  await runTest('Verify OUTCOME metric #1 (career website & social media) is Internal HR data without records (v2.52.0: no recruitment-SLA rows; v2.55.0: social media drilldown hidden)', async () => {
    const res = await fetch(`${BASE_URL}/api/metrics/1/detail?mode=YTD&year=2026`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.metric_type, 'OUTCOME');
    assert.strictEqual(data.is_survey, false);
    assert.strictEqual(data.is_outcome, true);
    assert.strictEqual(data.total_respondents, null);
    // v2.55.0: the social media drilldown is switched off for now (dormant) - no Internal Transaction Records for metric 1
    assert.deepStrictEqual([data.operational_records, data.operational_records_hidden, data.social_media], [[], true, undefined]);
  });

  await runTest('Verify SURVEY metric #5 (Candidate Experience Survey Score) is a survey summary metric (v2.55.0: one uploaded summary part, respondents from the summary)', async () => {
    const res = await fetch(`${BASE_URL}/api/metrics/5/detail?period=YTD`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.metric_type, 'SURVEY');
    assert.strictEqual(data.is_survey, true);
    assert.strictEqual(data.is_outcome, false);
    assert.strictEqual(data.data_upload, 'PART_SUMMARY');
    assert.ok(Number.isInteger(data.total_respondents) && data.total_respondents >= 0, 'respondent count from the uploaded summary (0 before an upload)');
    assert.deepStrictEqual(data.parts.map(p => p.part_name), ['Candidate Experience Survey']);
    assert.strictEqual(data.questions_breakdown.length, 0, 'the old per-respondent questions are not used for the score');
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
      '8809952,Maya Indah,maya.i@cimbniaga.co.id,Network & Digital Banking,OCTO Mobile,7,Day 1 Onboarding Satisfaction Index,4.0,4.0,5.0,4.0,5.0,Ya,Ya,Ya,Ya,Ya,Ya,Ya,Ya,Ya,Tidak,Sangat puas dengan sambutan hari pertama,2026-03-25'
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

  // v2.51.0: the question sets (and their count) are whatever the Admin configured in Manage Questions - the default
  // template follows the ESS result files (Module 54) - so the count and dimension are read from the configuration.
  const essMetricsToTest = [
    { id: 9, name: 'Role Clarity & DS Support Score Index', minScore: 85 },
    { id: 13, name: 'Pride & Work Environment Index', minScore: 88 },
    { id: 15, name: 'Manager Recognition Index', minScore: 85 },
    { id: 16, name: 'Wellbeing Index', minScore: 80 },
    { id: 17, name: 'Psychological Safety Index', minScore: 90 },
    { id: 18, name: 'Leadership Connection Score', minScore: 85 },
    { id: 21, name: 'Career Growth & Learning Index', minScore: 85 },
    { id: 22, name: 'Capability & Enablement Index', minScore: 85 },
    { id: 24, name: 'Performance Feedback Quality Index', minScore: 85 },
    { id: 25, name: 'Meaningful Contribution Index', minScore: 85 },
    { id: 27, name: 'Intent to Stay Index', minScore: 75 }
  ];

  for (const item of essMetricsToTest) {
    await runTest(`Verify ESS Metric #${item.id} (${item.name}) has valid dimension, % favorable summary, and visible/required config`, async () => {
      // the seed result (2025-11) read through a 2025 window (v2.50.0: later periods carry it forward too, see Module 52)
      const res = await fetch(`${BASE_URL}/api/metrics/${item.id}/detail?mode=YTD&year=2025`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.is_ess, true, `Metric #${item.id} must be recognized as ESS`);
      assert(data.ess_summary !== null, `Metric #${item.id} must have ess_summary`);
      const configured = (await (await fetch(`${BASE_URL}/api/admin/survey-questions/${item.id}`)).json()).questions;
      assert.ok(configured.length >= 1, `Metric #${item.id} has configured questions`);
      const dim = (configured.find(q => q.dimension) || {}).dimension || data.metric_name.replace(/\s*\(ESS\)\s*$/i, '');
      assert.strictEqual(data.ess_summary.dimension_name, dim, `Metric #${item.id} dimension must match ${dim}`);
      assert(data.ess_summary.summary_score >= item.minScore, `Metric #${item.id} summary score (${data.ess_summary.summary_score}) should be >= ${item.minScore}`);
      assert.strictEqual(data.questions_breakdown.length, configured.length, `Metric #${item.id} should have ${configured.length} questions`);
      
      // v2.32.0: an ESS metric reads its uploaded ESS summary (seed: 2025-11; v2.36.0: only inside a window containing it)
      assert.strictEqual(data.is_ess_summary, true, `Metric #${item.id} must be read from its ESS summary`);
      assert.strictEqual(data.ess_period, '2025-11', `Metric #${item.id} uses the latest ESS result on or before the period`);
      assert.strictEqual(data.total_respondents, 7756, 'total respondents = participation of the Bankwide row');
      assert.strictEqual(data.responses.length, 0, 'an ESS summary has no respondent rows');
      // Verify first question properties (the summary holds % favorable only)
      const q1 = data.questions_breakdown[0];
      assert(q1.percent_favorable !== null && q1.percent_favorable !== undefined, `Q1 must have percent_favorable`);
      assert.strictEqual(q1.percent_neutral, null, 'neutral is not part of the ESS summary');
      assert.strictEqual(q1.percent_unfavorable, null, 'unfavorable is not part of the ESS summary');
      assert.strictEqual(q1.visible_based_on, 'Always', `Q1 visible_based_on must be 'Always'`);
      assert.strictEqual(q1.required_based_on, 'Always', `Q1 required_based_on must be 'Always'`);
      // v2.50.0: the questions shown are the ones configured in Manage Questions, all of type PERCENTAGE
      assert.deepStrictEqual(data.questions_breakdown.map(q => [q.key, q.text]), configured.map(q => [q.key, q.text || q.label]));
      assert.ok(configured.every(q => q.type === 'PERCENTAGE') && data.questions_breakdown.every(q => q.type === 'PERCENTAGE'), 'ESS questions are PERCENTAGE');
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
        // an ESS metric with an ESS result reports that result's period (YYYY-MM, v2.32.0)
        const re = m.survey_source === 'ESS' && m.ess_period ? /^\d{4}-\d{2}$/ : isoDateRegex;
        assert(re.test(m.last_survey_date), `Metric #${m.metric_id} date "${m.last_survey_date}" must follow ${m.ess_period ? 'YYYY-MM' : 'YYYY-MM-DD'}`);
      }
    });
  });

  await runTest('CSV import with M/D/YYYY date is automatically normalized to YYYY-MM-DD', async () => {
    const customCsv = [
      'nip,employee_name,cimb_email,directorate,division,survey_date,q1_clarity,q2_support,verbatim_feedback',
      '# MANDATORY,Nama,Email,Direktorat,Divisi,YYYY-MM-DD,Skala,Skala,Verbatim',
      '8899011,Test Date Normalizer,test.norm@cimbniaga.co.id,"Operations, Technology, Analytics & AI",App Dev,3/31/2026,5.0,4.8,"Test date normalization"'
    ].join('\r\n');

    const res = await fetch(`${BASE_URL}/api/surveys/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        csvText: customCsv,
        fileName: 'test_date_norm.csv',
        metric_id: 8 // a SYSTEM survey metric (ESS metric 9 takes only its .xlsx summary since v2.32.0)
      })
    });
    assert.strictEqual(res.status, 200);
    const result = await res.json();
    assert.strictEqual(result.success, true);

    // Verify detail endpoint returns normalized YYYY-MM-DD date (MTD March: the row is within the 100 newest)
    const detailRes = await fetch(`${BASE_URL}/api/metrics/8/detail?period=2026-03`);
    const detailData = await detailRes.json();
    const resp = detailData.responses.find(r => r.nip === '8899011');
    assert(resp !== undefined, 'Uploaded response must be found in responses');
    assert.strictEqual(resp.survey_date, '2026-03-31', 'Uploaded date "3/31/2026" must be normalized to "2026-03-31"');

    // the same CSV sent to an ESS metric is refused as a whole (v2.32.0)
    const essRes = await fetch(`${BASE_URL}/api/surveys/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csvText: customCsv, fileName: 'test_date_norm.csv', metric_id: 9 })
    });
    assert.strictEqual(essRes.status, 400);
    assert.match((await essRes.json()).error, /ESS/);
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

    // Check the stored rows (v2.55.0: metric 5 is scored from its uploaded summary, its detail lists no respondent rows)
    const stored = await (await fetch(`${BASE_URL}/api/surveys/responses/5`)).json();
    const cand = (Array.isArray(stored) ? stored : (stored.responses || [])).find(r => r.candidate_id === 'CAND-2026-888');
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
  await runTest('GET /api/directorates returns the 12 real Directorates with sub-directorates', async () => {
    const res = await fetch(`${BASE_URL}/api/directorates`);
    assert.strictEqual(res.status, 200);
    const directorates = await res.json();
    assert(Array.isArray(directorates), 'Must return array');
    assert(directorates.length >= 12, 'Must have at least 12 directorates');
    const itDir = directorates.find(d => d.name === 'Operations, Technology, Analytics & AI');
    assert(itDir !== undefined, 'Operations, Technology, Analytics & AI directorate must exist');
    assert(itDir.sub_directorates.length > 0, 'Operations, Technology, Analytics & AI must have sub-directorates');
  });

  // v2.48.0: was "disables non-employee metrics". Since v2.48.0 a directorate filter reads the non-employee metrics
  // (#1-#5) at their BANKWIDE value and counts them in the index (nothing is exempted any more).
  await runTest('Calculate with Directorate filter reads non-employee metrics (Metrics #1 to #5) at their bankwide value and counts them', async () => {
    const res = await fetch(`${BASE_URL}/api/metrics/calculate?mode=YTD&year=2026&directorate=${encodeURIComponent('Operations, Technology, Analytics & AI')}`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.filter_options.directorate, 'Operations, Technology, Analytics & AI');
    const bank = await (await fetch(`${BASE_URL}/api/metrics/calculate?mode=YTD&year=2026`)).json();

    // Metrics 1 to 5: not disabled, flagged as bankwide values, equal to the bankwide view
    const nonEmpMetrics = data.metrics.filter(m => m.metric_id <= 5);
    assert.strictEqual(nonEmpMetrics.length, liveSeedIds(5).length);
    nonEmpMetrics.forEach(m => {
      assert.strictEqual(m.is_disabled, false, `Metric #${m.metric_id} must not be exempted`);
      assert.strictEqual(m.excluded_from_index, false, `Metric #${m.metric_id} must count in the index`);
      assert.strictEqual(m.is_bankwide_value, true, `Metric #${m.metric_id} must be flagged as a bankwide value`);
      const b = bank.metrics.find(x => x.metric_id === m.metric_id);
      assert.strictEqual(m.normalized_score, b.normalized_score, `Metric #${m.metric_id} bankwide score`);
      assert.strictEqual(m.sample_size, b.sample_size, `Metric #${m.metric_id} bankwide sample`);
    });

    // Employee metrics 6 to 27: directorate data, never flagged as bankwide
    const empMetrics = data.metrics.filter(m => m.metric_id >= 6);
    empMetrics.forEach(m => {
      assert.strictEqual(m.is_disabled, false, `Metric #${m.metric_id} must be active (is_disabled=false)`);
      assert.strictEqual(m.is_bankwide_value, false, `Metric #${m.metric_id} is directorate data`);
    });

    // Journey 1 (metrics 1-7): nothing disabled, every metric with data is active
    const journey1 = data.journeys.find(j => j.journey_id === 1);
    assert(journey1 !== undefined);
    assert.strictEqual(journey1.disabled_metrics_count, 0, 'no metric of Journey 1 is exempted any more');
    assert.strictEqual(journey1.active_metrics_count, journey1.metrics.filter(m => m.has_data).length, 'every Journey 1 metric with data is active');
    // v2.55.0: metrics 5 / 7 are summary metrics (no data before an upload) - the bankwide non-employee metrics with data still count
    assert(journey1.metrics.some(m => m.has_data && m.is_bankwide_value), 'Journey 1 counts the bankwide non-employee metrics');
    assert(journey1.overall_score > 0, 'Journey 1 score should be calculated from active metrics');
    assert.strictEqual(data.disabled_metrics_count, 0);
    assert.strictEqual(data.bankwide_value_metrics_count, data.metrics.filter(m => m.is_employee_metric === false).length);

    // Overall PX index should be calculated from remaining active journeys (Journeys 1 to 5)
    assert(data.px_index > 0, 'PX index must be calculated from active employee metrics');
  });

  await runTest('Calculate with Sub-Directorate filter', async () => {
    const res = await fetch(`${BASE_URL}/api/metrics/calculate?mode=YTD&year=2026&directorate=${encodeURIComponent('Operations, Technology, Analytics & AI')}&sub_directorate=IT%20Architecture%20%26%20Governance`);
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
    assert.strictEqual(data.metrics.length, LIVE_METRIC_IDS.length);
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

  await runTest('Reset parameters to defaults via POST /api/admin/parameters/reset (audited as PARAMETERS_RESET)', async () => {
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
    // v2.51.0: the reset and the edit before it are in the audit trail (test-run rows)
    const audit = await (await fetch(`${BASE_URL}/api/admin/audit-log?limit=50&include_test=1`)).json();
    assert.ok(audit.some(e => e.action === 'PARAMETERS_RESET' && e.is_test === true && /reset to the defaults \(5 journeys, 17 checkpoints, 27 metrics\)/.test(e.target)), 'PARAMETERS_RESET audited');
    assert.ok(audit.some(e => e.action === 'METRIC_UPDATE' && e.target.startsWith('#18:') && e.target.includes('-> ESS Overall Engagement Index (Updated Test)')), 'METRIC_UPDATE audited with old -> new');
  });
  // v2.51.0: the reset above changed the LIVE Admin configuration (shared database) - put it back at once
  await restoreConfigGuard('after the Module 16 reset test');
  legacyFixturesOn = [];
  await setLegacyFixtures(true); // the restore put the N/A flags back

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
    // v2.54.0: was metric 4 (static snapshot) - metric 1 takes uploaded monthly values, which set its date. v2.58.0: the Admin
    // deleted metric 4 live, so the check runs on a temporary static OUTCOME metric (deleted afterwards).
    const created = await fetch(`${BASE_URL}/api/admin/metrics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metric_name: 'REGRESSION last_data_date Metric', metric_type: 'OUTCOME', scale_type: 'QUOTA_COUNT', target_value: 100, target_display: 'min 100', raw_value: 40, requires_manual_upload: false })
    });
    assert.strictEqual(created.status, 201);
    const tempId = (await created.json()).metric_id;
    try {
      const resUpdate = await fetch(`${BASE_URL}/api/admin/metrics/${tempId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ last_data_date: newDate })
      });
      assert.strictEqual(resUpdate.status, 200);
      const updated = await resUpdate.json();
      assert.strictEqual(updated.last_data_date, newDate, 'Updated last_data_date must be persisted, not silently overridden by a hardcoded fallback');

      const resCalc = await fetch(`${BASE_URL}/api/metrics/calculate?period=YTD`);
      const calc = await resCalc.json();
      const m1 = calc.metrics.find(m => m.metric_id === tempId);
      assert.strictEqual(m1.last_survey_date, newDate, 'Calculation output must reflect the admin-edited last_data_date, confirming the value is read from storage, not a hardcoded map');
    } finally {
      await fetch(`${BASE_URL}/api/admin/metrics/${tempId}`, { method: 'DELETE' });
    }
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
    assert.strictEqual(data.trends[0].month_name, 'May');
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
        directorate: 'Operations, Technology, Analytics & AI',
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
    // v2.54.0: metric 2 is tier-scored (tiers not configured yet -> N/A), so the RATING_5 rule is checked on metric 5
    const metric2 = data.metrics.find(m => m.metric_id === 5);
    assert(metric2, 'Metric #5 (Candidate Experience Survey Score, RATING_5) must exist');
    assert.strictEqual(metric2.scale_type, 'RATING_5');
    const expectedNormalizedTarget = parseFloat(((parseFloat(metric2.target_value) / 5) * 100).toFixed(2));
    assert.strictEqual(metric2.target_value_normalized, expectedNormalizedTarget, `target_value_normalized must equal target_value/5*100 (${expectedNormalizedTarget}), got ${metric2.target_value_normalized} — Target (raw ${metric2.target_value}) and Min Threshold (${metric2.min_threshold}%) must now be directly comparable in the same unit`);
  });

  await runTest('[POSITIVE] Status classification (HEALTHY/WARNING/CRITICAL) compares the normalized score against the normalized target, not the raw scale-native target_value', async () => {
    const res = await fetch(`${BASE_URL}/api/metrics/calculate`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    // v2.54.0: a NO_DATA / N/A metric (e.g. metric 2 with its tiers not configured) has no status band to check
    const scaleMetrics = data.metrics.filter(m => (m.scale_type === 'RATING_5' || m.scale_type === 'QUOTA_COUNT') && m.has_data !== false);
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
      // v2.54.0: a tier-scored metric whose tiers are not configured yet has no target percentage (N/A)
      if (m.score_tiers && !m.score_tiers.bounds) { assert.strictEqual(m.target_value_normalized, null); return; }
      assert(typeof m.target_value_normalized === 'number', `Metric #${m.metric_id} must expose a numeric target_value_normalized`);
      assert(m.target_value_normalized >= 0 && m.target_value_normalized <= 100, `Metric #${m.metric_id}'s target_value_normalized (${m.target_value_normalized}) must be within the 0-100 % range shared with min_threshold`);
    });
  });

  await runTest('[POSITIVE] GET /api/metrics/:id/detail also exposes target_value_normalized for both SURVEY and OUTCOME metric types', async () => {
    const surveyRes = await fetch(`${BASE_URL}/api/metrics/5/detail?period=YTD`); // SURVEY, RATING_5 (v2.54.0: metric 2 is tier-scored)
    assert.strictEqual(surveyRes.status, 200);
    const surveyData = await surveyRes.json();
    assert.strictEqual(surveyData.metric_type, 'SURVEY');
    assert.strictEqual(surveyData.target_value_normalized, 80, 'Metric #5 target 4.00/5.0 must normalize to 80%');

    const outcomeRes = await fetch(`${BASE_URL}/api/metrics/1/detail?period=YTD`); // OUTCOME, PERCENTAGE
    assert.strictEqual(outcomeRes.status, 200);
    const outcomeData = await outcomeRes.json();
    assert.strictEqual(outcomeData.metric_type, 'OUTCOME');
    assert(typeof outcomeData.target_value_normalized === 'number', 'OUTCOME metric detail must also expose target_value_normalized');
  });

  // --- 26. HARDCODE AUDIT FOLLOW-UP: OPERATIONAL RECORDS, LIVE EVENT QUOTA & RESPONDENT COUNTS (POSITIVE TESTING) ---
  console.log('\n📦 MODULE 26: Hardcode Audit Follow-up — Operational Records, Live Quota & Respondent Counts (Positive Testing)');
  await runTest('[POSITIVE] OUTCOME metrics\' operational_records drilldown tables are sourced from the database (storage.getOperationalRecords), not frozen inline in calculationEngine.js', async () => {
    // v2.52.0: metric 1's records were its social media statistics; v2.55.0: that drilldown is hidden (no records, no SLA rows)
    const res1 = await fetch(`${BASE_URL}/api/metrics/1/detail?mode=YTD&year=2026`);
    assert.strictEqual(res1.status, 200);
    const data1 = await res1.json();
    assert(Array.isArray(data1.operational_records) && data1.operational_records.length === 0 && data1.operational_records_hidden === true, 'Metric #1 shows no records (social media drilldown hidden)');

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
    // v2.54.2: a temporary manual value of metric 11 (setting metric_manual_overrides) would replace the live calculation -
    // take it out for this test and put it back exactly afterwards.
    const st11 = require('../server/db/storage');
    const overrides11 = (await st11.getSettings()).metric_manual_overrides;
    const hasOverride11 = !!(overrides11 && overrides11['11']);
    if (hasOverride11) { const rest = { ...overrides11 }; delete rest['11']; await st11.setSetting('metric_manual_overrides', rest); }

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
      if (hasOverride11) await st11.setSetting('metric_manual_overrides', overrides11);
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
    assert.ok(healthDb.tables.metrics >= LIVE_METRIC_IDS.length && healthDb.tables.metrics > 0, 'metrics table must be populated');
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
    assert.ok(/already/i.test(body.error || ''), `Expected the "already checked in" message, got: ${body.error}`);
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
    assert.ok(body.error && /not configured/i.test(body.error));
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
      assert.strictEqual(jan.expected_period_label, 'December 2026');
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
      assert.ok(/not running/i.test(failed.transcript_error));

      const down = await fetch(`${BASE_URL}/api/media/${media.media_id}/transcribe`, { method: 'POST' });
      assert.strictEqual(down.status, 503, 'Retry while the service is down must say so immediately');
      assert.ok(/not running/i.test((await down.json()).error));
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

  await runTest('[POSITIVE] Every existing metric exposes a non-empty unit (calculate + admin parameters) and RATING_5 metrics read "/ 5"', async () => {
    const calc = await (await fetch(`${BASE_URL}/api/metrics/calculate?period=YTD`)).json();
    const admin = (await (await fetch(`${BASE_URL}/api/admin/parameters`)).json()).metrics;
    assert.strictEqual(calc.metrics.length, LIVE_METRIC_IDS.length);
    for (const m of [...calc.metrics, ...admin]) {
      assert.ok(typeof m.unit === 'string' && m.unit.trim().length > 0 && m.unit.length <= 30, `Metric ${m.metric_id} has no valid unit: ${JSON.stringify(m.unit)}`);
    }
    calc.metrics.filter(m => m.scale_type === 'RATING_5').forEach(m => assert.strictEqual(m.unit, '/ 5', `Metric ${m.metric_id}`));
  });

  await runTest('[POSITIVE] Metric 14 (recognition recipients per year) is a count — its unit is not "%" and its score/status/bar are untouched', async () => {
    const m = await unitCalcMetric(14);
    assert.ok(m.unit && m.unit !== '%', `Metric 14 unit must not be "%", got "${m.unit}"`);
    assert.strictEqual(m.scale_type, 'QUOTA_COUNT');
    // v2.54.0: metric 14 is scored by count tiers (Module 56); the unit stays display-only
    const expected = require('../server/db/scoreTiers').tieredScore(m.raw_value, m.score_tiers.bounds).percent;
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
      scopes: dir ? [{ directorate: dir.directorate_name, divisions: null }] : undefined // the whole directorate (v2.27.0 scope)
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
      // The standard initial password from the env (is_default_password) may be shorter; a random one must be >= 10.
      if (rb.is_default_password === true) assert.ok(rb.temporary_password);
      else assert.ok(rb.temporary_password && rb.temporary_password.length >= 10);
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
      // v2.49.0: a USER without the Signature Program Events menu gets no event data at all (attendees, codes): 403
      assert.strictEqual((await rawFetch(`${BASE_URL}/api/events/ev-perspektif-2024-q1`, asUser(u.cookie))).status, 403);
      assert.strictEqual((await rawFetch(`${BASE_URL}/api/events`, asUser(u.cookie))).status, 403);
      const evAdmin = await (await adminJson('GET', '/api/events/ev-perspektif-2024-q1')).json();
      assert.ok(evAdmin.attendances.every(a => a.nip));
      assert.ok(evAdmin.event.pre_event_code && evAdmin.event.post_event_code, 'Admin still gets the codes');
    });

    await runTest('[POSITIVE/NEGATIVE] Signature Program Events (v2.49.0): ADMIN and a USER with menu access "events" may read and manage; a USER without it - even one of the HR directorate in event_manager_directorates - gets 403 on every event API, reads included', async () => {
      assert.ok(hrDir, `directorate "${hrName}" from event_manager_directorates must exist in the directory`);
      const noMenu = await readyUser('hr', 'USER', hrDir); // HR directorate, but no events menu: the setting no longer grants anything
      const withMenu = await readyUser('it', 'USER', itDir); // another directorate, given the events menu by the Admin
      assert.strictEqual((await adminJson('PUT', `/api/admin/users/${withMenu.id}`, { menu_access: { events: true } })).status, 200);
      assert.strictEqual((await rawFetch(`${BASE_URL}/api/auth/me`, asUser(withMenu.cookie)).then(r => r.json())).permissions.can_manage_events, true);
      assert.strictEqual((await rawFetch(`${BASE_URL}/api/auth/me`, asUser(noMenu.cookie)).then(r => r.json())).permissions.can_manage_events, false);
      const payload = { event_name: 'Regression Test Event (Module 34 Access)', program_category: 'Testing', event_type: 'Online', event_date: '2026-08-20', target_participants: 5 };
      const made = [];
      try {
        assert.strictEqual((await rawFetch(`${BASE_URL}/api/events`, jsonBody('POST', payload, noMenu.cookie))).status, 403, 'USER without the events menu cannot create');
        const byHr = await rawFetch(`${BASE_URL}/api/events`, jsonBody('POST', payload, withMenu.cookie));
        assert.strictEqual(byHr.status, 201, 'USER with the events menu can create');
        made.push((await byHr.json()).event.event_id);
        const byAdmin = await adminJson('POST', '/api/events', payload);
        assert.strictEqual(byAdmin.status, 201, 'ADMIN can create');
        made.push((await byAdmin.json()).event.event_id);
        const eventId = made[0];
        // without the menu: not even reading (list, detail, question bank, QR, media files)
        for (const p of [`/api/events/${eventId}`, '/api/events', '/api/questions/master', '/api/qrcode?text=x', '/uploads/sample.jpg']) {
          assert.strictEqual((await rawFetch(`${BASE_URL}${p}`, asUser(noMenu.cookie))).status, 403, `GET ${p}`);
        }
        assert.strictEqual((await rawFetch(`${BASE_URL}/api/events/${eventId}`, asUser(withMenu.cookie))).status, 200);
        assert.ok((await (await rawFetch(`${BASE_URL}/api/events`, asUser(withMenu.cookie))).json()).some(e => e.event_id === eventId));
        // without the menu: no delete, media, transcript, PPT, report download, questions, check-in clean-up
        assert.strictEqual((await rawFetch(`${BASE_URL}/api/events/${eventId}`, jsonBody('DELETE', undefined, noMenu.cookie))).status, 403);
        assert.strictEqual((await rawFetch(`${BASE_URL}/api/events/${eventId}/generate-ppt`, jsonBody('POST', {}, noMenu.cookie))).status, 403);
        assert.strictEqual((await rawFetch(`${BASE_URL}/api/events/${eventId}/questions`, jsonBody('POST', { questions: [] }, noMenu.cookie))).status, 403);
        assert.strictEqual((await rawFetch(`${BASE_URL}/api/events/${eventId}/attendance/12345`, jsonBody('DELETE', undefined, noMenu.cookie))).status, 403);
        assert.strictEqual((await rawFetch(`${BASE_URL}/api/events/${eventId}/feedback/12345`, jsonBody('DELETE', undefined, noMenu.cookie))).status, 403);
        assert.strictEqual((await rawFetch(`${BASE_URL}/api/media/x/transcribe`, jsonBody('POST', {}, noMenu.cookie))).status, 403);
        assert.strictEqual((await rawFetch(`${BASE_URL}/api/media/x`, jsonBody('DELETE', undefined, noMenu.cookie))).status, 403);
        assert.strictEqual((await rawFetch(`${BASE_URL}/api/reports/download/x.pptx`, asUser(noMenu.cookie))).status, 403);
        assert.strictEqual((await rawFetch(`${BASE_URL}/exports/x.pptx`, asUser(noMenu.cookie))).status, 403);
        const form = new FormData();
        form.append('mediaFile', new Blob([Buffer.from('x')], { type: 'image/png' }), 'x.png');
        assert.strictEqual((await rawFetch(`${BASE_URL}/api/events/${eventId}/media`, asUser(noMenu.cookie, { method: 'POST', body: form }))).status, 403);
        // USER with the events menu: PPT generation works, and the generated file is downloadable only with the menu
        const ppt = await rawFetch(`${BASE_URL}/api/events/ev-perspektif-2024-q1/generate-ppt`, jsonBody('POST', {}, withMenu.cookie));
        assert.strictEqual(ppt.status, 200);
        const pptBody = await ppt.json();
        assert.strictEqual((await rawFetch(`${BASE_URL}${pptBody.download_url}`, asUser(withMenu.cookie))).status, 200);
        assert.strictEqual((await rawFetch(`${BASE_URL}${pptBody.download_url}`, asUser(noMenu.cookie))).status, 403);
        assert.strictEqual((await rawFetch(`${BASE_URL}${pptBody.download_url}`)).status, 401);
        assert.strictEqual((await rawFetch(`${BASE_URL}/api/reports/download/..%2F..%2Fpackage.json`, asUser(withMenu.cookie))).status, 404, 'no path traversal');
        const hrRead = await (await rawFetch(`${BASE_URL}/api/events/ev-perspektif-2024-q1`, asUser(withMenu.cookie))).json();
        assert.ok(hrRead.attendances.every(a => a.nip), 'a USER with the events menu sees attendee data of events');
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
      const log = await (await adminJson('GET', '/api/admin/audit-log?limit=500&include_test=1')).json();
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
            if (['employee_name', 'participant_name', 'candidate_name'].includes(k) && typeof x === 'string' && x.length >= 5 && x !== 'Respondent') names.add(x);
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

    await runTest('[POSITIVE] A USER sees non-employee metrics (#1-#5) as read-only bankwide values (not exempted), equal to the Admin ALL view, and the index equals the Admin view of that directorate (which reads them the same way since v2.48.0)', async () => {
      const u = await readyUser('l', 'USER', itDir);
      const own = encodeURIComponent(itDir.directorate_name);
      const user = await (await rawFetch(`${BASE_URL}/api/metrics/calculate?period=YTD`, asUser(u.cookie))).json();
      const adminAll = await (await adminJson('GET', '/api/metrics/calculate?period=YTD')).json();
      const adminDir = await (await adminJson('GET', `/api/metrics/calculate?period=YTD&directorate=${own}`)).json();
      const nonEmp = user.metrics.filter(m => m.is_employee_metric === false);
      assert.ok(nonEmp.length >= liveSeedIds(5).length);
      for (const m of nonEmp) {
        assert.strictEqual(m.is_disabled, false, `metric ${m.metric_id} must not be exempted for a USER`);
        const a = adminAll.metrics.find(x => x.metric_id === m.metric_id);
        assert.strictEqual(m.normalized_score, a.normalized_score, `metric ${m.metric_id} bankwide value`);
        assert.strictEqual(m.sample_size, a.sample_size);
      }
      assert.strictEqual(user.px_index, adminDir.px_index, 'scorecard total equals the Admin view of the same directorate');
      assert.strictEqual(user.survey_index, adminDir.survey_index);
      // v2.48.0: was "Admin directorate view is unchanged (exempted)" - now Admin and USER read #1-#5 identically
      assert.ok(adminDir.metrics.filter(m => m.is_employee_metric === false).every(m => !m.is_disabled && m.is_bankwide_value), 'Admin directorate view reads them at the bankwide value too');
      assert.ok(nonEmp.every(m => m.is_bankwide_value === true && m.excluded_from_index === false), 'USER: bankwide value, counted in the index');
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
      const log = JSON.stringify(await (await adminJson('GET', '/api/admin/audit-log?limit=50&include_test=1')).json());
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
      const user = { role: 'USER', scopes: [{ directorate: 'D1', divisions: null }] };
      assert.strictEqual(await auth.canSeeRespondentData(user, { metric_id: 1 }), false);
      assert.strictEqual(await auth.canSeeRespondentData({ role: 'ADMIN' }, { metric_id: 1 }), true);
      assert.strictEqual(await auth.canSeeRespondentData(null, { metric_id: 1 }), false);
      const one = { role: 'USER', scopes: [{ directorate: 'D1', divisions: null }] };
      assert.strictEqual(auth.resolveScope(one, undefined).directorate, 'D1');
      assert.strictEqual(auth.resolveScope(one, 'ALL').directorate, 'D1');
      assert.ok(auth.resolveScope(one, 'D2').error);
      assert.ok(auth.resolveScope({ role: 'USER', scopes: [] }, 'ALL').error, 'USER without scope is refused');
      assert.strictEqual(auth.resolveScope({ role: 'ADMIN' }, 'D2').directorate, 'D2');
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

    // --- 35. FLEXIBLE DATA SCOPE (v2.27.0) ---
    console.log('\n📦 MODULE 35: User Data Scope - multiple directorates, all/subset of divisions (Positive & Negative Testing)');

    const enc = encodeURIComponent;
    const dName = d => d.directorate_name;
    const scopeUser = async (suffix, scopes) => {
      const username = `rt${suffix}${stamp}`;
      const res = await adminJson('POST', '/api/admin/users', { username, full_name: `Regression ${suffix}`, email: `${username}@example.test`, role: 'USER', scopes });
      assert.strictEqual(res.status, 201, `create ${suffix}: ${res.status} ${await res.clone().text()}`);
      const body = await res.json();
      createdUserIds.push(body.user.user_id);
      const { cookie } = await loginAs(username, body.temporary_password);
      const ch = await rawFetch(`${BASE_URL}/api/auth/change-password`, jsonBody('POST', { current_password: body.temporary_password, new_password: STRONG }, cookie));
      assert.strictEqual(ch.status, 200);
      return { id: body.user.user_id, username, cookie, body };
    };
    const uget = (u, q) => rawFetch(`${BASE_URL}${q}`, asUser(u.cookie));
    const uj = async (u, q) => (await uget(u, q)).json();
    const aj = async q => (await adminJson('GET', q)).json();
    // v2.55.0: metric 8 is N/A (real data not available yet) - the scope checks use a SYSTEM employee survey metric that has rows
    const SM35 = ((await aj('/api/metrics/calculate?period=YTD')).metrics.find(x => x.metric_type === 'SURVEY' && x.survey_source === 'SYSTEM' && x.is_employee_metric && x.has_data && !x.data_upload) || { metric_id: 8 }).metric_id;
    const dq = (dir, div) => `directorate=${enc(dir)}${div ? `&sub_directorate=${enc(div)}` : ''}`;
    const respondents = async (dir, div) => (await aj(`/api/metrics/${SM35}/detail?period=YTD&${dq(dir, div)}`)).total_respondents;

    // Directories that really hold survey data: A has two divisions with data (X, Y), B and C are other directorates with data.
    let dirA = null, divX = null, divY = null; const withData = [];
    for (const d of directory) {
      if (!d.divisions.length) continue;
      if ((await respondents(dName(d))) > 0) withData.push(d);
    }
    for (const d of withData) {
      const have = [];
      for (const v of d.divisions) { if ((await respondents(dName(d), v)) > 0) have.push(v); if (have.length === 2) break; }
      if (have.length === 2) { dirA = d; [divX, divY] = have; break; }
    }
    assert.ok(dirA, 'seed data must contain a directorate with two divisions that have survey responses');
    const [dirB, dirC] = withData.filter(d => dName(d) !== dName(dirA));
    assert.ok(dirB && dirC, 'seed data must contain two more directorates with survey responses');
    const A = dName(dirA), B = dName(dirB), C = dName(dirC);
    const empMetrics = calc => calc.metrics.filter(m => m.is_employee_metric !== false && !m.is_disabled);

    await runTest('[POSITIVE] A scope of ONE WHOLE directorate gives numbers identical to the Admin filtering that directorate (scorecard, every employee metric, trend series, alerts)', async () => {
      const u = await scopeUser('s1', [{ directorate: A, divisions: null }]);
      const user = await uj(u, '/api/metrics/calculate?period=YTD');
      const adm = await aj(`/api/metrics/calculate?period=YTD&${dq(A)}`);
      assert.strictEqual(user.px_index, adm.px_index);
      assert.strictEqual(user.survey_index, adm.survey_index);
      assert.strictEqual(user.outcome_index, adm.outcome_index);
      assert.strictEqual(user.directorate, A);
      for (const m of empMetrics(adm)) {
        const x = user.metrics.find(k => k.metric_id === m.metric_id);
        assert.strictEqual(x.normalized_score, m.normalized_score, `metric ${m.metric_id}`);
        assert.strictEqual(x.sample_size, m.sample_size, `metric ${m.metric_id} sample`);
      }
      const ut = await uj(u, '/api/metrics/trends?mode=YTD');
      const at = await aj(`/api/metrics/trends?mode=YTD&${dq(A)}`);
      assert.deepStrictEqual(ut.trends.map(t => t.px_index), at.trends.map(t => t.px_index), 'trend series');
      const alerts = await uj(u, '/api/alerts');
      // v2.36.0: a NO_DATA metric (no survey data in the window) is not a deficit and raises no alert
      const expected = empMetrics(adm).filter(m => m.status !== 'HEALTHY' && m.status !== 'NO_DATA').map(m => m.metric_id).sort((a, b) => a - b);
      const got = alerts.alerts.filter(a => !a.is_bankwide_readonly).map(a => a.metric_id).sort((a, b) => a - b);
      assert.deepStrictEqual(got, expected, 'alerts = deficits of the in-scope data');
      alerts.alerts.filter(a => !a.is_bankwide_readonly).forEach(a => assert.strictEqual(a.current_score, adm.metrics.find(m => m.metric_id === a.metric_id).normalized_score, 'alert score is computed from in-scope data'));
    });

    await runTest('[POSITIVE] Two directorates = ONE pooled aggregate: each metric\'s sample = A + B and its mean is the sample-weighted mean (same pipeline as the scorecard, not an average of averages)', async () => {
      const u = await scopeUser('s2', [{ directorate: A, divisions: null }, { directorate: B, divisions: null }]);
      const user = await uj(u, '/api/metrics/calculate?period=YTD');
      const a = await aj(`/api/metrics/calculate?period=YTD&${dq(A)}`);
      const b = await aj(`/api/metrics/calculate?period=YTD&${dq(B)}`);
      assert.strictEqual(user.directorate, 'ALL', 'two directorates: no single directorate to echo');
      assert.strictEqual(user.filter_options.is_directorate_filtered, true);
      assert.strictEqual(user.filter_options.scopes.length, 2);
      let checked = 0;
      // v2.55.0: summary-part metrics (7, 12) pool per month (respondent-weighted) and then average the months - Module 59
      for (const m of empMetrics(a).filter(x => x.metric_type === 'SURVEY' && x.data_upload !== 'PART_SUMMARY')) {
        const mb = b.metrics.find(k => k.metric_id === m.metric_id);
        const mu = user.metrics.find(k => k.metric_id === m.metric_id);
        assert.strictEqual(mu.sample_size, m.sample_size + mb.sample_size, `metric ${m.metric_id} sample`);
        if (mu.sample_size > 0) {
          const pooled = (m.raw_value * m.sample_size + mb.raw_value * mb.sample_size) / mu.sample_size;
          assert.ok(Math.abs(pooled - mu.raw_value) <= 0.02, `metric ${m.metric_id}: pooled ${pooled} vs ${mu.raw_value}`);
          checked++;
        }
      }
      assert.ok(checked >= 3, `expected several pooled metrics, got ${checked}`);
      // narrowing the union to one of its directorates equals the Admin view of that directorate
      const narrowed = await uj(u, `/api/metrics/calculate?period=YTD&${dq(B)}`);
      assert.strictEqual(narrowed.px_index, b.px_index);
      assert.strictEqual(narrowed.directorate, B);
      // bankwide non-employee metrics stay read-only, equal to the Admin bankwide view
      const all = await aj('/api/metrics/calculate?period=YTD');
      for (const m of user.metrics.filter(x => x.is_employee_metric === false)) {
        assert.strictEqual(m.is_disabled, false);
        assert.strictEqual(m.is_bankwide_value, true); // v2.48.0: counted in the index at the bankwide value
        assert.strictEqual(m.normalized_score, all.metrics.find(k => k.metric_id === m.metric_id).normalized_score);
      }
    });

    await runTest('[POSITIVE/NEGATIVE] A subset of divisions limits the data to those divisions; a division/directorate outside the scope is 403 on calculate, trends, detail and alerts', async () => {
      const u = await scopeUser('s3', [{ directorate: A, divisions: [divX] }]);
      assert.strictEqual((await uj(u, `/api/metrics/${SM35}/detail?period=YTD`)).total_respondents, await respondents(A, divX), 'only the allowed division counts');
      assert.ok((await respondents(A, divX)) < (await respondents(A)), 'guard: subset really is smaller than the whole directorate');
      const own = await uj(u, `/api/metrics/calculate?period=YTD&${dq(A, divX)}`);
      const adm = await aj(`/api/metrics/calculate?period=YTD&${dq(A, divX)}`);
      assert.strictEqual(own.px_index, adm.px_index);
      assert.strictEqual((await uget(u, `/api/metrics/calculate?period=YTD&sub_directorate=${enc(divX)}`)).status, 200, 'division with directorate ALL = inside the scope');
      for (const q of [`/api/metrics/calculate?period=YTD&${dq(A, divY)}`, `/api/metrics/${SM35}/detail?${dq(A, divY)}`, `/api/metrics/trends?${dq(A, divY)}`, `/api/alerts?${dq(A, divY)}`,
        `/api/metrics/calculate?period=YTD&sub_directorate=${enc(divY)}`, `/api/metrics/calculate?period=YTD&${dq(B)}`, `/api/metrics/trends?${dq(B)}`, `/api/alerts?${dq(C)}`,
        `/api/metrics/${SM35}/detail?${dq(B)}`, '/api/metrics/calculate?directorate=Direktorat%20Fiktif']) {
        const r = await uget(u, q);
        assert.strictEqual(r.status, 403, q);
        assert.ok((await r.json()).error);
      }
      assert.strictEqual((await adminJson('GET', `/api/metrics/calculate?period=YTD&${dq(A, divY)}`)).status, 200, 'Admin is never restricted');
    });

    await runTest('[POSITIVE] Mixed scope (some divisions of A + all of B) is the union; a user with a scope sees the SAME bankwide read-only values for #1-#5 and nothing of other directorates', async () => {
      const u = await scopeUser('s4', [{ directorate: A, divisions: [divX] }, { directorate: B, divisions: null }]);
      assert.strictEqual((await uj(u, `/api/metrics/${SM35}/detail?period=YTD`)).total_respondents, (await respondents(A, divX)) + (await respondents(B)));
      assert.strictEqual((await uget(u, `/api/metrics/calculate?period=YTD&${dq(A, divX)}`)).status, 200);
      assert.strictEqual((await uget(u, `/api/metrics/calculate?period=YTD&${dq(A, divY)}`)).status, 403);
      assert.strictEqual((await uget(u, `/api/metrics/calculate?period=YTD&${dq(C)}`)).status, 403);
      assert.strictEqual((await uget(u, `/api/metrics/trends?${dq(B)}`)).status, 200);
      const me = (await uj(u, '/api/auth/me')).user;
      assert.deepStrictEqual(me.scopes, [{ directorate: A, divisions: [divX] }, { directorate: B, divisions: null }], '/me returns the effective scope');
    });

    await runTest('[NEGATIVE] Alerts of a scoped user are computed from in-scope data only: scores differ from the bankwide ones and no out-of-scope comment (uploaded or event) leaks into them', async () => {
      const u = await scopeUser('s5', [{ directorate: A, divisions: [divX] }]);
      const alerts = await uj(u, '/api/alerts');
      const adm = await aj(`/api/metrics/calculate?period=YTD&${dq(A, divX)}`);
      const bankwide = await aj('/api/alerts');
      alerts.alerts.filter(a => !a.is_bankwide_readonly).forEach(a => assert.strictEqual(a.current_score, adm.metrics.find(m => m.metric_id === a.metric_id).normalized_score));
      const bankCalc = await aj('/api/metrics/calculate?period=YTD');
      assert.ok(adm.metrics.some(m => m.metric_type === 'SURVEY' && !m.is_disabled && m.normalized_score !== bankCalc.metrics.find(k => k.metric_id === m.metric_id).normalized_score), 'guard: the scope really changes survey scores vs bankwide');
      assert.ok(bankwide.alerts.length > 0);
      // Seed comments come from a shared pool, so a leak cannot be spotted by text alone; instead the comments shown
      // must be exactly the first ones of the IN-SCOPE respondents - uploaded survey comments first, then event feedback
      // of in-scope attendees (a leaking engine would show the bankwide first ones).
      const u2 = await scopeUser('s5b', [{ directorate: A, divisions: [divX, divY] }]);
      const alerts2 = await uj(u2, '/api/alerts');
      const inScope = r => r.directorate === A && (r.division === divX || r.division === divY);
      const eventComments = [];
      for (const ev of await aj('/api/events')) {
        const det = await aj(`/api/events/${ev.event_id}`);
        const mine = new Set(det.attendances.filter(inScope).map(x => x.nip));
        det.feedbacks.filter(f => mine.has(f.nip) && f.verbatim && f.verbatim.length > 5).forEach(f => eventComments.push(f.verbatim));
      }
      let differFromBankwide = 0;
      assert.ok(alerts2.alerts.length > 0, 'guard: the scope has alerts to check');
      for (const a of alerts2.alerts.filter(x => !x.is_bankwide_readonly)) {
        const rows = await aj(`/api/surveys/responses/${a.metric_id}`);
        const uploaded = (Array.isArray(rows) ? rows : []).filter(inScope).map(r => (r.verbatim_feedback || '').trim()).filter(v => v.length > 3);
        assert.deepStrictEqual(a.verbatim_insights, [...uploaded, ...eventComments].slice(0, 3), `metric ${a.metric_id}: comments must come from in-scope respondents only`);
        if (JSON.stringify((bankwide.alerts.find(b => b.metric_id === a.metric_id) || {}).verbatim_insights) !== JSON.stringify(a.verbatim_insights)) differFromBankwide++;
      }
      assert.ok(differFromBankwide > 0, 'guard: the in-scope comments really differ from the bankwide ones');
      assert.ok(alerts.alerts.every(a => a.verbatim_insights.length <= 3));
    });

    await runTest('[POSITIVE/NEGATIVE] Events (v2.49.0): a multi-scope user without the events menu gets 403 (no attendee data at all); with it, the full event view like an Admin; no respondent identity anywhere in the user\'s metric payloads', async () => {
      const u = await scopeUser('s6', [{ directorate: A, divisions: null }, { directorate: B, divisions: [dirB.divisions[0]] }]);
      assert.strictEqual((await uget(u, '/api/events/ev-perspektif-2024-q1')).status, 403);
      assert.strictEqual((await uget(u, '/api/events')).status, 403);
      const adm = await aj('/api/events/ev-perspektif-2024-q1');
      assert.strictEqual((await adminJson('PUT', `/api/admin/users/${u.id}`, { menu_access: { events: true } })).status, 200);
      const ev = await uj(u, '/api/events/ev-perspektif-2024-q1');
      assert.strictEqual(ev.attendances.length, adm.attendances.length, 'event access = the full event, not scope-filtered');
      assert.strictEqual(ev.feedbacks.length, adm.feedbacks.length);
      const listed = (await uj(u, '/api/events')).find(e => e.event_id === 'ev-perspektif-2024-q1');
      assert.strictEqual(listed.total_attendees, adm.attendances.length);
      assert.strictEqual((await adminJson('PUT', `/api/admin/users/${u.id}`, { menu_access: { events: false } })).status, 200);
      assert.strictEqual((await uget(u, '/api/events')).status, 403, 'switched off again: effective on the next request');
      const names = new Set();
      [...(await aj(`/api/metrics/${SM35}/detail?period=YTD`)).responses, ...(await aj('/api/metrics/5/detail?period=YTD')).questions.flatMap(q => q.verbatim_samples || [])]
        .forEach(r => { if (typeof r.employee_name === 'string' && r.employee_name.length >= 5 && r.employee_name !== 'Respondent') names.add(r.employee_name); });
      adm.attendances.forEach(a => { if (a.employee_name && a.employee_name.length >= 5) names.add(a.employee_name); });
      assert.ok(names.size > 3);
      const payload = [await (await uget(u, `/api/metrics/${SM35}/detail?period=YTD`)).text(), await (await uget(u, '/api/metrics/5/detail?period=YTD')).text(),
        await (await uget(u, '/api/alerts')).text()].join('\n');
      for (const n of names) assert.ok(!payload.includes(JSON.stringify(n).slice(1, -1)), `name "${n}" leaked`);
    });

    await runTest('[POSITIVE/NEGATIVE] Create/update validation of scopes: >=1 for USER, none for ADMIN, directorate/division must exist and match, overlaps are merged, legacy directorate+division still works', async () => {
      const mk = async (suffix, body) => {
        const res = await adminJson('POST', '/api/admin/users', { username: `rt${suffix}${stamp}`, full_name: 'Regression V', email: 'v@example.test', ...body });
        return res;
      };
      for (const [i, bad] of [
        { role: 'USER' }, { role: 'USER', scopes: [] }, { role: 'USER', scopes: 'IT' }, { role: 'USER', scopes: [{}] },
        { role: 'USER', scopes: [{ directorate: 'Direktorat Fiktif', divisions: null }] },
        { role: 'USER', scopes: [{ directorate: A, divisions: ['Divisi Fiktif'] }] },
        { role: 'USER', scopes: [{ directorate: A, divisions: dirB.divisions.slice(0, 1) }] },
        { role: 'USER', scopes: [{ directorate: A, divisions: 'x' }] }, { role: 'USER', scopes: [{ directorate: A, divisions: [1] }] },
        { role: 'ADMIN', scopes: [{ directorate: A, divisions: null }] },
        { role: 'USER', directorate: A }, { role: 'USER', directorate: A, division: dirB.divisions[0] }
      ].entries()) {
        const r = await mk(`v${i}`, bad);
        assert.strictEqual(r.status, 400, `case ${i} ${JSON.stringify(bad)} -> ${r.status}`);
        assert.ok((await r.json()).error);
      }
      assert.strictEqual((await adminJson('GET', '/api/admin/users')).status, 200);
      const users = await (await adminJson('GET', '/api/admin/users')).json();
      assert.ok(!users.some(x => (x.username.startsWith('rtv') && x.username.endsWith(stamp) && x.username.length > ('rtv' + stamp).length)), 'rejected requests store nothing');
      // overlaps / duplicates are normalized: listed divisions merge, "all" absorbs a subset
      const merged = await mk('m1', { role: 'USER', scopes: [{ directorate: A, divisions: [divX] }, { directorate: A, divisions: [divY, divX] }, { directorate: B, divisions: [dirB.divisions[0]] }, { directorate: B, divisions: null }] });
      assert.strictEqual(merged.status, 201);
      const mb = await merged.json(); createdUserIds.push(mb.user.user_id);
      assert.deepStrictEqual(mb.user.scopes, [{ directorate: A, divisions: [divX, divY] }, { directorate: B, divisions: null }]);
      // divisions [] means all divisions; legacy single directorate+division is one single-division scope
      const empty = await mk('m2', { role: 'USER', scopes: [{ directorate: A, divisions: [] }] });
      assert.strictEqual(empty.status, 201);
      const eb = await empty.json(); createdUserIds.push(eb.user.user_id);
      assert.deepStrictEqual(eb.user.scopes, [{ directorate: A, divisions: null }]);
      const legacy = await mk('m3', { role: 'USER', directorate: A, division: divX });
      assert.strictEqual(legacy.status, 201);
      const lb = await legacy.json(); createdUserIds.push(lb.user.user_id);
      assert.deepStrictEqual(lb.user.scopes, [{ directorate: A, divisions: [divX] }]);
      assert.strictEqual(lb.user.directorate, A);
      assert.strictEqual(lb.user.division, divX);
      // ADMIN with an explicit empty scope list is fine and has none
      const adm = await mk('m4', { role: 'ADMIN', scopes: [] });
      assert.strictEqual(adm.status, 201);
      const ab = await adm.json(); createdUserIds.push(ab.user.user_id);
      assert.deepStrictEqual(ab.user.scopes, []);
      // update: replace scopes; invalid ones rejected without touching the account; ADMIN <-> USER transitions
      const put = (id, body) => adminJson('PUT', `/api/admin/users/${id}`, body);
      assert.strictEqual((await put(mb.user.user_id, { scopes: [] })).status, 400, 'USER cannot end up without scope');
      assert.strictEqual((await put(mb.user.user_id, { scopes: [{ directorate: C, divisions: [divX] }] })).status, 400);
      assert.strictEqual((await put(mb.user.user_id, { role: 'ADMIN', scopes: [{ directorate: A, divisions: null }] })).status, 400);
      assert.strictEqual((await put(mb.user.user_id, { directorate: C })).status, 400, 'legacy form still needs the division');
      assert.strictEqual((await put(9999999, { scopes: [{ directorate: A, divisions: null }] })).status, 404);
      const stillMerged = (await (await adminJson('GET', '/api/admin/users')).json()).find(x => x.user_id === mb.user.user_id);
      assert.deepStrictEqual(stillMerged.scopes, mb.user.scopes, 'rejected updates change nothing');
      const toC = await put(mb.user.user_id, { scopes: [{ directorate: C, divisions: null }] });
      assert.strictEqual(toC.status, 200);
      assert.deepStrictEqual((await toC.json()).user.scopes, [{ directorate: C, divisions: null }]);
      const toAdmin = await put(mb.user.user_id, { role: 'ADMIN' });
      assert.strictEqual(toAdmin.status, 200);
      assert.deepStrictEqual((await toAdmin.json()).user.scopes, [], 'promoting to ADMIN clears the scope');
      assert.strictEqual((await put(mb.user.user_id, { role: 'USER' })).status, 400, 'demoting to USER needs a scope');
      const back = await put(mb.user.user_id, { role: 'USER', scopes: [{ directorate: B, divisions: null }] });
      assert.strictEqual(back.status, 200);
      assert.strictEqual((await back.json()).user.role, 'USER');
    });

    await runTest('[POSITIVE] A scope change applies at once to an open session (no re-login), is recorded in the audit trail, and covering an event_manager_directorates directorate no longer grants event rights (v2.49.0: menu access does)', async () => {
      const u = await scopeUser('s7', [{ directorate: A, divisions: null }]);
      assert.strictEqual((await uget(u, `/api/metrics/calculate?period=YTD&${dq(A)}`)).status, 200);
      assert.strictEqual((await uget(u, `/api/metrics/calculate?period=YTD&${dq(B)}`)).status, 403);
      const put = await adminJson('PUT', `/api/admin/users/${u.id}`, { scopes: [{ directorate: B, divisions: [dirB.divisions[0]] }] });
      assert.strictEqual(put.status, 200);
      assert.strictEqual((await uget(u, '/api/auth/me')).status, 200, 'session survives a scope change');
      assert.strictEqual((await uget(u, `/api/metrics/calculate?period=YTD&${dq(A)}`)).status, 403, 'old scope gone immediately');
      assert.strictEqual((await uget(u, `/api/metrics/calculate?period=YTD&${dq(B, dirB.divisions[0])}`)).status, 200, 'new scope works immediately');
      if (dirB.divisions.length > 1) assert.strictEqual((await uget(u, `/api/metrics/calculate?period=YTD&${dq(B, dirB.divisions[1])}`)).status, 403, 'other division of B is outside the new scope');
      const log = await (await adminJson('GET', '/api/admin/audit-log?limit=100&include_test=1')).json();
      const entry = log.find(e => e.action === 'USER_SCOPE_CHANGE' && e.target && e.target.startsWith(u.username));
      assert.ok(entry, 'USER_SCOPE_CHANGE recorded');
      assert.ok(entry.target.includes(A) && entry.target.includes(B));
      assert.ok(!JSON.stringify(log).includes(STRONG), 'no password in the audit trail');
      // v2.49.0: covering the HR directorate (setting event_manager_directorates) grants nothing; the events menu does
      if (hrDir) {
        const hrDivision = hrDir.divisions[0];
        await adminJson('PUT', `/api/admin/users/${u.id}`, { scopes: [{ directorate: A, divisions: null }, { directorate: hrName, divisions: hrDivision ? [hrDivision] : null }] });
        assert.strictEqual((await uj(u, '/api/auth/me')).permissions.can_manage_events, false, 'scope alone no longer makes an event manager');
        assert.strictEqual((await uget(u, '/api/events')).status, 403);
        await adminJson('PUT', `/api/admin/users/${u.id}`, { menu_access: { events: true } });
        assert.strictEqual((await uj(u, '/api/auth/me')).permissions.can_manage_events, true);
        await adminJson('PUT', `/api/admin/users/${u.id}`, { scopes: [{ directorate: A, divisions: null }] });
        assert.strictEqual((await uj(u, '/api/auth/me')).permissions.can_manage_events, true, 'menu access does not depend on the scope');
      }
    });

    await runTest('[POSITIVE/NEGATIVE] Migration of v2.26.0 single-scope accounts (division empty = all divisions, ADMIN gets none, idempotent) and scope helper units', async () => {
      const { legacyUserScopes, normalizeScopes, scopeAllows, rowInScopes } = require('../server/db/scopeUtils');
      assert.deepStrictEqual(legacyUserScopes({ role: 'USER', directorate: 'D1', division: 'V1' }), [{ directorate: 'D1', divisions: ['V1'] }]);
      assert.deepStrictEqual(legacyUserScopes({ role: 'USER', directorate: 'D1', division: '  ' }), [{ directorate: 'D1', divisions: null }]);
      assert.deepStrictEqual(legacyUserScopes({ role: 'USER', directorate: 'D1', division: null }), [{ directorate: 'D1', divisions: null }]);
      assert.deepStrictEqual(legacyUserScopes({ role: 'ADMIN', directorate: 'D1', division: 'V1' }), []);
      assert.deepStrictEqual(legacyUserScopes({ role: 'USER', directorate: null }), []);
      assert.deepStrictEqual(normalizeScopes([{ directorate: ' D1 ', divisions: ['a', 'a', ' '] }, { directorate: 'D1', divisions: ['b'] }, { directorate: '', divisions: null }, null]), [{ directorate: 'D1', divisions: ['a', 'b'] }]);
      assert.deepStrictEqual(normalizeScopes([{ directorate: 'D1', divisions: ['a'] }, { directorate: 'D1', divisions: null }]), [{ directorate: 'D1', divisions: null }]);
      assert.deepStrictEqual(normalizeScopes('x'), []);
      const sc = [{ directorate: 'D1', divisions: ['a'] }, { directorate: 'D2', divisions: null }];
      assert.strictEqual(scopeAllows(sc, 'D1', 'a'), true);
      assert.strictEqual(scopeAllows(sc, 'D1', 'b'), false);
      assert.strictEqual(scopeAllows(sc, 'D1'), true);
      assert.strictEqual(scopeAllows(sc, 'D3'), false);
      assert.strictEqual(rowInScopes(sc, 'D2', 'zzz'), true);
      assert.strictEqual(rowInScopes(sc, 'D1', 'b'), false);
      assert.strictEqual(rowInScopes([], 'D1', 'a'), false);
      const auth = require('../server/services/authService');
      const user = { role: 'USER', scopes: sc };
      assert.deepStrictEqual(auth.resolveScope(user, undefined), { directorate: 'ALL', sub_directorate: 'ALL', scopes: sc });
      assert.deepStrictEqual(auth.resolveScope(user, 'D1'), { directorate: 'D1', sub_directorate: 'ALL', scopes: [sc[0]] });
      assert.strictEqual(auth.resolveScope(user, 'ALL', 'a').scopes.length, 2, 'a division with directorate ALL keeps the entries that allow it (the filter then ANDs the division)');
      assert.deepStrictEqual(auth.resolveScope({ role: 'USER', scopes: [sc[0]] }, 'ALL', 'a').scopes, [sc[0]]);
      assert.ok(auth.resolveScope({ role: 'USER', scopes: [sc[0]] }, 'ALL', 'b').error);
      assert.ok(auth.resolveScope(user, 'D1', 'b').error);
      assert.ok(auth.resolveScope(user, 'D3').error);
      assert.ok(auth.resolveScope({ role: 'USER', scopes: [sc[0]] }, 'ALL', 'nope').error);
      assert.ok(auth.resolveScope({ role: 'USER', scopes: [] }, 'ALL').error, 'USER without scope is refused');
      assert.deepStrictEqual(auth.resolveScope({ role: 'ADMIN' }, 'D9', 'v'), { directorate: 'D9', sub_directorate: 'v', scopes: null });
      assert.strictEqual(auth.isInScope(user, 'D1', 'a'), true);
      assert.strictEqual(auth.isInScope(user, 'D1', 'b'), false);
      assert.strictEqual(auth.isInScope({ role: 'ADMIN' }, 'D9', 'x'), true);
      // SQL Server: a real v2.26.0 row (directorate/division columns, no scope rows) is converted by the boot migration
      require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
      const storage = require('../server/db/storage');
      if (storage.backend !== 'sql') { console.log('     (SQL part skipped: JSON backend - its migration runs when auth.json is loaded and is covered by the units above)'); return; }
      const sql = require('mssql');
      const pool = await new sql.ConnectionPool({ server: process.env.DB_SERVER || 'localhost', port: parseInt(process.env.DB_PORT || '1433', 10), database: process.env.DB_NAME || 'PeopleExperiencePX',
        user: process.env.DB_USER, password: process.env.DB_PASSWORD, options: { encrypt: false, trustServerCertificate: true } }).connect();
      const made = [];
      try {
        for (const [suffix, role, dir, div] of [['g1', 'USER', A, divX], ['g2', 'USER', B, null], ['g3', 'ADMIN', A, divX]]) {
          const created = await storage.createUser({ is_test_account: true, username: `rt${suffix}${stamp}`, full_name: 'Legacy', email: '', role, password_hash: 'x', scopes: [] });
          made.push(created.user_id);
          await pool.request().input('id', sql.Int, created.user_id).input('d', sql.NVarChar, dir).input('v', sql.NVarChar, div)
            .query('DELETE FROM dbo.px_user_scopes WHERE user_id = @id; UPDATE dbo.px_users SET directorate = @d, division = @v WHERE user_id = @id');
        }
        await storage.migrateLegacyUserScopes();
        await storage.migrateLegacyUserScopes(); // idempotent
        const [g1, g2, g3] = await Promise.all(made.map(id => storage.getUserById(id)));
        assert.deepStrictEqual(g1.scopes, [{ directorate: A, divisions: [divX] }]);
        assert.deepStrictEqual(g2.scopes, [{ directorate: B, divisions: null }], 'empty division = all divisions');
        assert.deepStrictEqual(g3.scopes, [], 'ADMIN gets no scope');
        // an account that already has scope rows is never overwritten by the migration
        await storage.updateUser(g1.user_id, { scopes: [{ directorate: C, divisions: null }] });
        await storage.migrateLegacyUserScopes();
        assert.deepStrictEqual((await storage.getUserById(g1.user_id)).scopes, [{ directorate: C, divisions: null }]);
        // deleting the account removes its scope rows (cascade)
        await storage.deleteUser(g1.user_id);
        const left = await pool.request().input('id', sql.Int, g1.user_id).query('SELECT COUNT(*) AS c FROM dbo.px_user_scopes WHERE user_id = @id');
        assert.strictEqual(left.recordset[0].c, 0);
      } finally {
        for (const id of made) await storage.deleteUser(id);
        await pool.close();
        if (typeof storage.close === 'function' && !tempAdmin) await storage.close();
      }
    });
    // --- 36. PIC OF A METRIC (v2.27.1) ---
    console.log('\n📦 MODULE 36: PIC of a metric - upload / template / evidence / respondent identity limited to own metrics and own scope (Positive & Negative Testing)');

    const fs36 = require('fs');
    const path36 = require('path');
    const UPLOADS_DIR36 = path36.join(__dirname, '..', 'server', 'uploads');
    const tempMetricIds36 = [];
    const mkMetric36 = async (name, overrides = {}) => {
      const res = await adminJson('POST', '/api/admin/metrics', {
        metric_name: name, metric_type: 'SURVEY', scale_type: 'RATING_5', requires_manual_upload: true, update_frequency: 'MONTHLY',
        upload_deadline_day: 10, pic_name: 'PIC Regresi', pic_email: 'nobody.pic@example.test', ...overrides
      });
      assert.strictEqual(res.status, 201, `create metric: ${res.status}`);
      const id = (await res.json()).metric_id;
      tempMetricIds36.push(id);
      return id;
    };
    const csv36 = rows => ['nip,employee_name,cimb_email,directorate,division,survey_date,q1_overall', ...rows].join('\r\n');
    const adminUpload36 = async (metricId, rows) => {
      const res = await adminJson('POST', '/api/surveys/upload', { csvText: csv36(rows), fileName: 'rt36.csv', metric_id: metricId });
      assert.strictEqual(res.status, 200);
      return res.json();
    };
    const post36 = (u, body) => rawFetch(`${BASE_URL}/api/surveys/upload`, jsonBody('POST', body, u.cookie));
    const csvFor = (u, metricId) => rawFetch(`${BASE_URL}/api/surveys/template?metric_id=${metricId}`, asUser(u.cookie));

    try {
      const uMail = n => `rt${n}${stamp}@example.test`;
      const picUser = await scopeUser('p1', [{ directorate: A, divisions: [divX] }]);
      const plainUser = await scopeUser('p2', [{ directorate: A, divisions: null }]);
      // pic_email is typed in a different letter case on purpose: the match is case-insensitive
      const P = await mkMetric36('REGRESSION PIC Own Metric', { pic_email: uMail('p1').toUpperCase() });
      const Q = await mkMetric36('REGRESSION PIC Other Metric', { pic_email: 'someone.else@example.test' });
      // v2.29.0: no reminder flag, yet still uploadable by its PIC (every SURVEY metric can be uploaded by hand)
      const R = await mkMetric36('REGRESSION PIC Not Manual', { pic_email: uMail('p1'), requires_manual_upload: false });
      const day = new Date().toISOString().slice(0, 10);
      const rowsFor = tag => [
        `9${tag}001,Nama In ${tag},in${tag}@cimbniaga.co.id,${csvCell(A)},${csvCell(divX)},${day},4`,
        `9${tag}002,Nama Div Lain ${tag},y${tag}@cimbniaga.co.id,${csvCell(A)},${csvCell(divY)},${day},3`,
        `9${tag}003,Nama Dir Lain ${tag},b${tag}@cimbniaga.co.id,${csvCell(B)},${csvCell(dirB.divisions[0])},${day},5`
      ];
      await adminUpload36(P, rowsFor('1'));
      await adminUpload36(Q, rowsFor('2'));

      await runTest('[POSITIVE] A User whose e-mail equals a metric\'s pic_email (any letter case) is its PIC: own metric list, template, history; the flags come from the server', async () => {
        const list = await uj(picUser, '/api/surveys/metrics');
        assert.deepStrictEqual(list.map(m => m.metric_id), [P, R], 'only the metrics the account is PIC of (R has no reminder flag but is still uploadable since v2.29.0)');
        const t = await csvFor(picUser, P);
        assert.strictEqual(t.status, 200);
        assert.ok((t.headers.get('content-type') || '').includes('text/csv'));
        const hist = await uj(picUser, '/api/surveys/history');
        assert.ok(hist.length >= 1 && hist.every(h => h.metric_id === P), 'history = batches of own metric only');
        const calc = await uj(picUser, '/api/metrics/calculate?period=YTD');
        assert.strictEqual(calc.metrics.find(m => m.metric_id === P).can_upload, true);
        assert.strictEqual(calc.metrics.find(m => m.metric_id === Q).can_upload, false);
        assert.strictEqual(calc.metrics.find(m => m.metric_id === R).can_upload, true, 'v2.29.0: a SURVEY metric without the reminder flag is still uploadable by its PIC');
        assert.strictEqual(calc.metrics.find(m => m.metric_id === 8).can_upload, false);
        assert.ok(calc.metrics.filter(m => m.metric_type === 'OUTCOME').every(m => m.can_upload === false));
        assert.strictEqual((await uj(picUser, `/api/metrics/${P}/detail?period=YTD`)).can_upload, true);
        assert.strictEqual((await uj(picUser, `/api/metrics/${Q}/detail?period=YTD`)).can_upload, false);
        const adm = await aj('/api/metrics/calculate?period=YTD');
        assert.ok(adm.metrics.filter(m => m.metric_type === 'SURVEY').every(m => m.can_upload === true), 'Admin may upload every SURVEY metric');
        assert.ok(adm.metrics.filter(m => m.metric_type === 'OUTCOME').every(m => m.can_upload === false));
        const plainCalc = await uj(plainUser, '/api/metrics/calculate?period=YTD');
        assert.ok(plainCalc.metrics.every(m => m.can_upload === false), 'a non-PIC never gets can_upload');
      });

      await runTest('[POSITIVE] The PIC uploads for own metric (text and multipart file): uploaded_by is the login account, SURVEY_UPLOAD is audited with the metric and row counts but no respondent data, no bankwide calculation is returned, the temp CSV is not left in /uploads, and a metric_id column inside the CSV cannot redirect the data', async () => {
        const csvFiles = () => fs36.readdirSync(UPLOADS_DIR36).filter(f => /\.csv$/i.test(f)).length; // (media files come and go on their own)
        const before = csvFiles();
        const nipTag = `9${Date.now().toString().slice(-5)}`;
        const bodyCsv = ['nip,employee_name,cimb_email,directorate,division,survey_date,q1_overall,metric_id',
          `${nipTag}1,Nama Audit Rahasia,rahasia@cimbniaga.co.id,${csvCell(A)},${csvCell(divX)},${day},4,${Q}`].join('\r\n');
        const qBefore = (await aj(`/api/surveys/responses/${Q}`)).length;
        const pBefore = (await aj(`/api/surveys/responses/${P}`)).length;
        const r1 = await post36(picUser, { csvText: bodyCsv, fileName: 'pic.csv', metric_id: String(P) });
        assert.strictEqual(r1.status, 200);
        const b1 = await r1.json();
        assert.strictEqual(b1.success, true);
        assert.strictEqual(b1.valid_rows_count, 1);
        assert.strictEqual(b1.calculation, undefined, 'no bankwide calculation for a PIC');
        assert.strictEqual(b1.updated_pe_index, undefined);
        assert.ok(b1.affected_metrics.every(a => a.normalized_score === null));
        assert.strictEqual((await aj(`/api/surveys/responses/${Q}`)).length, qBefore, 'the metric_id column inside the CSV must not write into another metric');
        assert.strictEqual((await aj(`/api/surveys/responses/${P}`)).length, pBefore + 1);
        // multipart file
        const fd = new FormData();
        fd.append('csvFile', new Blob([csv36([`${nipTag}2,Nama File Rahasia,file@cimbniaga.co.id,${csvCell(A)},${csvCell(divX)},${day},5`])], { type: 'text/csv' }), 'pic-file.csv');
        fd.append('metric_id', String(P));
        const r2 = await rawFetch(`${BASE_URL}/api/surveys/upload`, { method: 'POST', headers: { Cookie: picUser.cookie }, body: fd });
        assert.strictEqual(r2.status, 200);
        assert.strictEqual((await r2.json()).valid_rows_count, 1);
        assert.strictEqual(csvFiles(), before, 'the temporary CSV (it holds identities) is deleted after import');
        const hist = await aj('/api/surveys/history');
        const mine = hist.filter(h => h.metric_id === P && h.uploaded_by.includes(picUser.username));
        assert.ok(mine.length >= 2, 'uploaded_by records the login account');
        const log = await aj('/api/admin/audit-log?limit=100&include_test=1');
        const entry = log.find(e => e.action === 'SURVEY_UPLOAD' && e.username === picUser.username && e.target.includes(`metric ${P};`));
        assert.ok(entry, 'SURVEY_UPLOAD audited');
        assert.ok(/1 valid rows/.test(entry.target));
        const logText = JSON.stringify(log);
        for (const secret of ['Nama Audit Rahasia', 'Nama File Rahasia', 'rahasia@cimbniaga', `${nipTag}1`]) assert.ok(!logText.includes(secret), `audit log must not hold respondent data (${secret})`);
      });

      await runTest('[NEGATIVE] A PIC is refused (403) for every other metric on template, upload, evidence, responses; a non-PIC User for all; "ALL"/missing/malformed metric ids never open anything', async () => {
        const probe = async (u, metric) => {
          const out = {};
          out.template = (await csvFor(u, metric)).status;
          out.upload = (await post36(u, { csvText: csv36([`9990001,X,x@cimbniaga.co.id,${csvCell(A)},${csvCell(divX)},${day},4`]), metric_id: metric })).status;
          out.evidence = (await uget(u, `/api/surveys/evidence?metric_id=${metric}&period=YTD`)).status;
          out.responses = (await uget(u, `/api/surveys/responses/${metric}`)).status;
          return out;
        };
        const qBefore = (await aj(`/api/surveys/responses/${Q}`)).length;
        for (const m of [Q, 8, 99999]) {
          const o = await probe(picUser, m);
          Object.entries(o).forEach(([k, v]) => assert.strictEqual(v, 403, `PIC ${k} of metric ${m} -> ${v}`));
        }
        for (const m of [P, Q]) {
          const o = await probe(plainUser, m);
          Object.entries(o).forEach(([k, v]) => assert.strictEqual(v, 403, `non-PIC ${k} of metric ${m} -> ${v}`));
        }
        for (const bad of [`${P}abc`, `${P}.0`, '-1', '1;2']) {
          assert.strictEqual((await csvFor(picUser, encodeURIComponent(bad))).status, 403, `template ${bad}`);
          assert.strictEqual((await uget(picUser, `/api/surveys/evidence?metric_id=${encodeURIComponent(bad)}&period=YTD`)).status, 403, `evidence ${bad}`);
          assert.strictEqual((await post36(picUser, { csvText: csv36([`9990002,X,x@cimbniaga.co.id,${csvCell(A)},${csvCell(divX)},${day},4`]), metric_id: bad })).status, 403, `upload ${bad}`);
        }
        assert.strictEqual((await uget(picUser, `/api/surveys/evidence?metric_id=${P}&metric_id=${Q}&period=YTD`)).status, 403, 'repeated metric_id');
        assert.strictEqual((await uget(picUser, '/api/surveys/evidence?metric_id=ALL&period=YTD')).status, 403, 'no master evidence for a PIC');
        assert.strictEqual((await uget(picUser, '/api/surveys/evidence?period=YTD')).status, 403, 'evidence without metric_id defaults to ALL');
        for (const m of ['ALL', '']) {
          assert.strictEqual((await csvFor(picUser, m)).status, 400, 'a PIC must name a metric (no master template)');
          assert.strictEqual((await post36(picUser, { csvText: csv36([`9990003,X,x@cimbniaga.co.id,${csvCell(A)},${csvCell(divX)},${day},4`]), metric_id: m })).status, 400);
        }
        assert.strictEqual((await post36(picUser, { csvText: csv36([`9990004,X,x@cimbniaga.co.id,${csvCell(A)},${csvCell(divX)},${day},4`]) })).status, 400, 'no metric_id');
        assert.strictEqual((await uget(plainUser, '/api/surveys/metrics')).status, 403);
        assert.strictEqual((await uget(plainUser, '/api/surveys/history')).status, 403);
        assert.strictEqual((await post36(plainUser, {})).status, 403);
        assert.strictEqual((await aj(`/api/surveys/responses/${Q}`)).length, qBefore, 'nothing was written into the other metric');
        const log = await aj('/api/admin/audit-log?limit=100&include_test=1');
        assert.ok(!log.some(e => e.action === 'SURVEY_UPLOAD' && (e.username === plainUser.username)), 'refused uploads are not audited as uploads');
      });

      await runTest('[NEGATIVE] Upload keeps its validation for a PIC: empty NIP and an out-of-range rating are rejected row by row and nothing invalid is stored; a CSV with no valid row stores no batch', async () => {
        const pBefore = (await aj(`/api/surveys/responses/${P}`)).length;
        const hBefore = (await uj(picUser, '/api/surveys/history')).length;
        const res = await post36(picUser, { metric_id: String(P), csvText: csv36([
          `,Tanpa NIP,t@cimbniaga.co.id,${csvCell(A)},${csvCell(divX)},${day},4`,
          `9880001,Nilai Salah,n@cimbniaga.co.id,${csvCell(A)},${csvCell(divX)},${day},9`,
          `9880002,Valid,v@cimbniaga.co.id,${csvCell(A)},${csvCell(divX)},${day},4`]) });
        assert.strictEqual(res.status, 200);
        const body = await res.json();
        assert.strictEqual(body.valid_rows_count, 1);
        assert.strictEqual(body.invalid_rows_count, 2);
        assert.ok(body.errors.some(e => /NIP/.test(e.reason)) && body.errors.some(e => /range/.test(e.reason)));
        assert.strictEqual((await aj(`/api/surveys/responses/${P}`)).length, pBefore + 1);
        const allBad = await post36(picUser, { metric_id: String(P), csvText: csv36([`,Tanpa NIP,t@cimbniaga.co.id,${csvCell(A)},${csvCell(divX)},${day},4`]) });
        assert.strictEqual((await allBad.json()).success, false);
        assert.strictEqual((await uj(picUser, '/api/surveys/history')).length, hBefore + 1, 'only the batch with a valid row was recorded');
        assert.strictEqual((await post36(picUser, { metric_id: String(P) })).status, 400, 'no CSV at all');
      });

      await runTest('[POSITIVE/NEGATIVE] The PIC sees respondent identity ONLY for own metric and ONLY inside own scope (detail, responses, evidence CSV); other metrics stay masked; a non-PIC stays masked on the same metric', async () => {
        const d = await uj(picUser, `/api/metrics/${P}/detail?period=YTD`);
        assert.strictEqual(d.respondent_data_hidden, undefined, 'identity is not hidden from the PIC');
        const named = d.responses.filter(r => r.nip && r.employee_name);
        assert.ok(named.length > 0 && named.length === d.responses.length, 'all rows are named');
        assert.ok(d.responses.every(r => r.directorate === A && r.division === divX), 'only rows inside the PIC scope (detail)');
        const dQ = await uj(picUser, `/api/metrics/${Q}/detail?period=YTD`);
        assert.strictEqual(dQ.respondent_data_hidden, true);
        dQ.responses.forEach(r => ['nip', 'employee_name', 'cimb_email', 'email'].forEach(f => assert.ok(r[f] === null || r[f] === undefined)));
        const d8 = await uj(picUser, '/api/metrics/8/detail?period=YTD');
        assert.strictEqual(d8.respondent_data_hidden, true, 'a metric the account is not PIC of stays masked');
        const dPlain = await uj(plainUser, `/api/metrics/${P}/detail?period=YTD`);
        assert.strictEqual(dPlain.respondent_data_hidden, true, 'a non-PIC is masked on the very same metric');
        dPlain.responses.forEach(r => assert.ok(!r.nip && !r.employee_name && !r.cimb_email));
        // the masked payload leaks no name anywhere (recursive redaction still applies)
        const plainText = JSON.stringify(dPlain);
        for (const n of ['Nama In 1', 'Nama Div Lain 1', 'Nama Dir Lain 1']) assert.ok(!plainText.includes(n), `${n} leaked to a non-PIC`);
        // responses list + evidence CSV: same scope rule
        const rows = await uj(picUser, `/api/surveys/responses/${P}`);
        assert.ok(rows.length > 0 && rows.every(r => r.directorate === A && r.division === divX), 'responses limited to the PIC scope');
        const adminRows = await aj(`/api/surveys/responses/${P}`);
        assert.ok(adminRows.some(r => r.division === divY) && adminRows.some(r => r.directorate === B), 'guard: the Admin sees the out-of-scope rows');
        const ev = await (await uget(picUser, `/api/surveys/evidence?metric_id=${P}&period=YTD`)).text();
        assert.ok(ev.includes('Nama In 1'), 'in-scope identity is in the evidence CSV');
        assert.ok(!ev.includes('Nama Div Lain 1') && !ev.includes('Nama Dir Lain 1'), 'out-of-scope respondents are not in the PIC\'s evidence');
        const evAdmin = await (await adminJson('GET', `/api/surveys/evidence?metric_id=${P}&period=YTD`)).text();
        assert.ok(evAdmin.includes('Nama Div Lain 1') && evAdmin.includes('Nama Dir Lain 1'), 'Admin evidence is complete');
        // another metric's identities never show in this PIC's responses/evidence
        assert.ok(!ev.includes('Nama In 2'));
      });

      await runTest('[POSITIVE/NEGATIVE] Changing pic_email (or the account e-mail) takes effect on the very next request: access is revoked and granted again with no re-login; a deactivated PIC is locked out; Admin is unaffected', async () => {
        assert.strictEqual((await csvFor(picUser, P)).status, 200);
        assert.strictEqual((await adminJson('PUT', `/api/admin/metrics/${P}`, { pic_email: 'another.person@example.test' })).status, 200);
        assert.strictEqual((await csvFor(picUser, P)).status, 403, 'revoked at once');
        assert.strictEqual((await post36(picUser, { csvText: csv36([`9990005,X,x@cimbniaga.co.id,${csvCell(A)},${csvCell(divX)},${day},4`]), metric_id: String(P) })).status, 403);
        assert.strictEqual((await uget(picUser, `/api/surveys/responses/${P}`)).status, 403);
        assert.strictEqual((await uj(picUser, `/api/metrics/${P}/detail?period=YTD`)).respondent_data_hidden, true);
        assert.strictEqual((await uj(picUser, '/api/metrics/calculate?period=YTD')).metrics.find(m => m.metric_id === P).can_upload, false);
        assert.deepStrictEqual((await uj(picUser, '/api/surveys/metrics')).map(m => m.metric_id), [R], 'still PIC of R only');
        assert.strictEqual((await adminJson('PUT', `/api/admin/metrics/${P}`, { pic_email: uMail('p1') })).status, 200);
        assert.strictEqual((await csvFor(picUser, P)).status, 200, 'granted again at once');
        // the account e-mail is the other half of the match
        assert.strictEqual((await adminJson('PUT', `/api/admin/users/${picUser.id}`, { email: 'moved@example.test' })).status, 200);
        assert.strictEqual((await csvFor(picUser, P)).status, 403, 'e-mail no longer matches');
        assert.strictEqual((await adminJson('PUT', `/api/admin/users/${picUser.id}`, { email: uMail('p1').toUpperCase() })).status, 200);
        assert.strictEqual((await csvFor(picUser, P)).status, 200, 'case does not matter');
        // helpers: inactive / admin / strict id parsing
        const auth = require('../server/services/authService');
        const asObj = { role: 'USER', email: uMail('p1'), is_active: true };
        assert.deepStrictEqual(await auth.picMetricIds(asObj), [P, R]);
        assert.deepStrictEqual(await auth.picMetricIds({ ...asObj, is_active: false }), [], 'inactive account has no PIC rights');
        assert.deepStrictEqual(await auth.picMetricIds({ ...asObj, email: '' }), []);
        assert.deepStrictEqual(await auth.picMetricIds({ role: 'ADMIN', email: uMail('p1') }), [], 'Admin is not "a PIC" (needs no PIC right)');
        assert.strictEqual(await auth.canSeeRespondentData({ role: 'ADMIN' }, 12345), true);
        assert.strictEqual(await auth.isPicOfMetric(asObj, P), true);
        assert.strictEqual(await auth.isPicOfMetric(asObj, { metric_id: P }), true);
        assert.strictEqual(await auth.isPicOfMetric(asObj, String(P)), true);
        for (const bad of [`${P}x`, [P], null, undefined, 'ALL', '', Q, {}]) assert.strictEqual(await auth.isPicOfMetric(asObj, bad), false, `isPicOfMetric(${JSON.stringify(bad)})`);
        // Admin keeps full access regardless of pic_email
        assert.strictEqual((await adminJson('GET', `/api/surveys/template?metric_id=${Q}`)).status, 200);
        assert.strictEqual((await adminJson('GET', '/api/surveys/template?metric_id=ALL')).status, 200);
        // deactivating the PIC ends their access
        assert.strictEqual((await adminJson('PUT', `/api/admin/users/${picUser.id}`, { is_active: false })).status, 200);
        assert.strictEqual((await csvFor(picUser, P)).status, 401);
        assert.strictEqual((await adminJson('PUT', `/api/admin/users/${picUser.id}`, { is_active: true })).status, 200);
        picUser.cookie = (await loginAs(picUser.username, STRONG)).cookie; // deactivation ended the old session
      });

      await runTest('[POSITIVE] Admin screens get the PIC data from the server: Parameter Admin lists the active account e-mails (for the "PIC belum punya akun" hint) and Kelola User lists each account\'s PIC metrics; a PIC gets no Admin screens', async () => {
        const params = await aj('/api/admin/parameters');
        assert.ok(Array.isArray(params.active_account_emails));
        assert.ok(params.active_account_emails.includes(uMail('p1')), 'lower-cased e-mail of an active account');
        assert.ok(!params.active_account_emails.includes('nobody.pic@example.test'));
        assert.ok(params.active_account_emails.every(e => e === e.toLowerCase()));
        const users = await aj('/api/admin/users');
        const mine = users.find(x => x.user_id === picUser.id);
        assert.deepStrictEqual(mine.pic_metrics.map(m => m.metric_id), [P, R]);
        assert.ok(users.find(x => x.user_id === plainUser.id).pic_metrics.length === 0);
        assert.ok(users.filter(x => x.role === 'ADMIN').every(x => x.pic_metrics.length === 0));
        // a deactivated account is not a match for the hint
        await adminJson('PUT', `/api/admin/users/${plainUser.id}`, { is_active: false });
        assert.ok(!(await aj('/api/admin/parameters')).active_account_emails.includes(uMail('p2')));
        await adminJson('PUT', `/api/admin/users/${plainUser.id}`, { is_active: true });
        assert.strictEqual((await uget(picUser, '/api/admin/parameters')).status, 403, 'PIC still has no Admin screens');
        assert.strictEqual((await uget(picUser, '/api/admin/users')).status, 403);
        assert.strictEqual((await uget(picUser, '/api/admin/upload-reminders')).status, 403);
      });

      await runTest('[NEGATIVE] CSV injection: respondent text starting with = + - @ is written with a leading apostrophe in the evidence CSV (never as a formula); plain values and numbers are untouched', async () => {
        await adminUpload36(P, [
          `=1+1,=cmd|x,e@cimbniaga.co.id,${csvCell(A)},${csvCell(divX)},${day},4`,
          `+SUM(1),@name,f@cimbniaga.co.id,${csvCell(A)},${csvCell(divX)},${day},3`]);
        const csv = await (await adminJson('GET', `/api/surveys/evidence?metric_id=${P}&period=YTD`)).text();
        assert.ok(csv.includes("'=1+1") && csv.includes("'=cmd|x") && csv.includes("'+SUM(1)") && csv.includes("'@name"));
        assert.ok(!/(^|,)=1\+1/m.test(csv) && !/(^|,)=cmd/m.test(csv) && !/(^|,)\+SUM/m.test(csv) && !/(^|,)@name/m.test(csv), 'no cell may start with a formula character');
        const normal = csv.split(/\r\n/).find(l => l.includes('Nama In 1'));
        assert.ok(normal && normal.includes(',4,'), 'a numeric rating is not altered');
        const picCsv = await (await uget(picUser, `/api/surveys/evidence?metric_id=${P}&period=YTD`)).text();
        assert.ok(picCsv.includes("'=1+1"), 'same guard on the PIC download');
      });

      await runTest('[NEGATIVE] Admin evidence/responses with a malformed or unknown metric id answer a clean 400/404 (not 500); the master evidence still works', async () => {
        for (const bad of ['abc', '7abc', '-3', '1e3']) {
          assert.strictEqual((await adminJson('GET', `/api/surveys/evidence?metric_id=${bad}&period=YTD`)).status, 400, `evidence ${bad}`);
          assert.strictEqual((await adminJson('GET', `/api/surveys/responses/${bad}`)).status, 400, `responses ${bad}`);
        }
        for (const gone of ['99999', '123456789']) {
          assert.strictEqual((await adminJson('GET', `/api/surveys/evidence?metric_id=${gone}&period=YTD`)).status, 404, `evidence ${gone}`);
          assert.strictEqual((await adminJson('GET', `/api/surveys/responses/${gone}`)).status, 404, `responses ${gone}`);
        }
        const bad = await adminJson('GET', '/api/surveys/evidence?metric_id=abc&period=YTD');
        assert.ok((await bad.json()).error);
        assert.strictEqual((await adminJson('GET', '/api/surveys/evidence?metric_id=ALL&period=YTD')).status, 200);
      });

      await runTest('[NEGATIVE] An oversize CSV upload gets a clean JSON 413 and a malformed JSON body a clean JSON 400 - no HTML page and no stack trace', async () => {
        const fd = new FormData();
        fd.append('csvFile', new Blob([Buffer.alloc(51 * 1024 * 1024, 97)], { type: 'text/csv' }), 'big.csv');
        fd.append('metric_id', String(P));
        const r = await rawFetch(`${BASE_URL}/api/surveys/upload`, { method: 'POST', headers: { Cookie: picUser.cookie }, body: fd });
        assert.strictEqual(r.status, 413);
        assert.ok((r.headers.get('content-type') || '').includes('application/json'));
        const body = await r.json();
        assert.ok(body.error && !/\bat \S+\.js|node_modules/.test(JSON.stringify(body)));
        const garbage = await rawFetch(`${BASE_URL}/api/surveys/upload`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: picUser.cookie }, body: '{"metric_id": ' });
        assert.strictEqual(garbage.status, 400);
        const gt = await garbage.text();
        assert.ok(gt.startsWith('{') && !/SyntaxError|node_modules|<pre>|\bat \S+\.js/.test(gt), `clean error body, got: ${gt.slice(0, 120)}`);
      });

      await runTest('[POSITIVE] The reminder list is unchanged by PIC rights (still addressed to the metric\'s pic_email, no secrets)', async () => {
        const rem = await aj('/api/admin/upload-reminders');
        assert.ok(Array.isArray(rem.reminders));
        assert.ok(!JSON.stringify(rem).toLowerCase().includes('password'));
      });

      // --- 39. SURVEY SOURCE (SYSTEM / ESS) + MANUAL UPLOAD FOR EVERY SURVEY METRIC (v2.29.0) ---
      // Runs inside the Module 36 scope so it can reuse the PIC accounts; every metric it creates is added to
      // tempMetricIds36, whose cleanup deletes the metric together with its survey data (documented cascade).
      console.log('\n📦 MODULE 39: Survey Source (SYSTEM/ESS) column and manual upload for every SURVEY metric (Positive & Negative Testing)');

      const ESS_IDS = [9, 13, 15, 16, 17, 18, 21, 22, 24, 25, 27];
      const mkSurvey39 = async (name, body = {}) => {
        const res = await adminJson('POST', '/api/admin/metrics', { metric_name: name, metric_type: 'SURVEY', scale_type: 'RATING_5', pic_name: 'PIC Regresi', pic_email: 'nobody.pic@example.test', ...body });
        const json = await res.json();
        if (res.status === 201) tempMetricIds36.push(json.metric_id);
        return { status: res.status, body: json };
      };
      const put39 = async (id, body) => { const res = await adminJson('PUT', `/api/admin/metrics/${id}`, body); return { status: res.status, body: await res.json() }; };
      const getMetric39 = async id => (await aj('/api/admin/parameters')).metrics.find(m => m.metric_id === id);

      await runTest('[POSITIVE] survey_source is filled for every metric: exactly the 11 ESS metrics are ESS, the other SURVEY metrics are SYSTEM, OUTCOME metrics are NULL; ESS metrics are manual-upload; calculate and detail expose it and detail.is_ess follows it', async () => {
        const params = (await aj('/api/admin/parameters')).metrics.filter(m => m.metric_id <= 27);
        assert.strictEqual(params.length, liveSeedIds().length);
        assert.deepStrictEqual(params.filter(m => m.survey_source === 'ESS').map(m => m.metric_id), ESS_IDS);
        const system = params.filter(m => m.metric_type === 'SURVEY' && m.survey_source === 'SYSTEM').map(m => m.metric_id);
        assert.deepStrictEqual(system, [2, 5, 6, 7, 8, 10, 12, 23, 26]);
        assert.ok(params.filter(m => m.metric_type === 'OUTCOME').every(m => m.survey_source === null), 'OUTCOME has no survey source');
        assert.ok(params.filter(m => m.survey_source === 'ESS').every(m => m.requires_manual_upload === true), 'ESS is always manual upload');
        const calc = await aj('/api/metrics/calculate?period=YTD');
        for (const m of calc.metrics.filter(x => x.metric_id <= 27)) assert.strictEqual(m.survey_source, params.find(p => p.metric_id === m.metric_id).survey_source, `calculate metric ${m.metric_id}`);
        const d9 = await aj('/api/metrics/9/detail?period=YTD');
        const d8 = await aj('/api/metrics/8/detail?period=YTD');
        const d1 = await aj('/api/metrics/1/detail?period=YTD');
        assert.strictEqual(d9.survey_source, 'ESS'); assert.strictEqual(d9.is_ess, true); assert.strictEqual(d9.metric.survey_source, 'ESS');
        assert.ok(d9.ess_summary, 'ESS metrics keep their dimension summary');
        assert.strictEqual(d8.survey_source, 'SYSTEM'); assert.strictEqual(d8.is_ess, false); assert.strictEqual(d8.ess_summary, null);
        assert.strictEqual(d1.survey_source, null); assert.strictEqual(d1.is_ess, false);
        const uCalc = await uj(picUser, '/api/metrics/calculate?period=YTD');
        assert.strictEqual(uCalc.metrics.find(m => m.metric_id === 9).survey_source, 'ESS', 'a User sees the source too');
      });

      await runTest('[NEGATIVE] Survey Source validation: values other than SYSTEM/ESS (any case is fine, other types are not) are refused with 400 on add and update, also for an OUTCOME metric; refused calls change nothing', async () => {
        for (const bad of ['FOO', 'SYSTEMS', 'ES S', 5, true, ['ESS'], { v: 'ESS' }]) {
          const created = await mkSurvey39('REGRESSION SRC Bad', { survey_source: bad });
          assert.strictEqual(created.status, 400, `POST survey_source=${JSON.stringify(bad)} -> ${created.status}`);
        }
        const out = await adminJson('POST', '/api/admin/metrics', { metric_name: 'REGRESSION SRC Out Bad', metric_type: 'OUTCOME', scale_type: 'PERCENTAGE', survey_source: 'FOO' });
        assert.strictEqual(out.status, 400, 'a typo is not silently ignored for OUTCOME either');
        const m = await mkSurvey39('REGRESSION SRC Edit');
        assert.strictEqual(m.status, 201);
        assert.strictEqual(m.body.survey_source, 'SYSTEM', 'SURVEY without survey_source defaults to SYSTEM');
        for (const bad of ['FOO', 7, ['ESS']]) {
          assert.strictEqual((await put39(m.body.metric_id, { survey_source: bad, metric_name: 'REGRESSION SRC Changed' })).status, 400, `PUT ${JSON.stringify(bad)}`);
        }
        const after = await getMetric39(m.body.metric_id);
        assert.strictEqual(after.survey_source, 'SYSTEM'); assert.strictEqual(after.metric_name, 'REGRESSION SRC Edit', 'a refused update changes nothing');
        assert.strictEqual((await adminJson('PUT', '/api/admin/metrics/99999', { survey_source: 'FOO' })).status, 400);
      });

      await runTest('[POSITIVE] Survey Source rules: accepted in any case, SURVEY keeps/changes it, OUTCOME is always NULL (even when ESS is sent), SURVEY->OUTCOME clears it and OUTCOME->SURVEY gets a source again', async () => {
        const e = await mkSurvey39('REGRESSION SRC Lower', { survey_source: 'ess' });
        assert.strictEqual(e.status, 201); assert.strictEqual(e.body.survey_source, 'ESS');
        assert.strictEqual((await put39(e.body.metric_id, { survey_source: ' system ' })).body.survey_source, 'SYSTEM');
        assert.strictEqual((await getMetric39(e.body.metric_id)).survey_source, 'SYSTEM');
        assert.strictEqual((await put39(e.body.metric_id, { survey_source: 'ESS' })).body.survey_source, 'ESS');
        assert.strictEqual((await put39(e.body.metric_id, { metric_name: 'REGRESSION SRC Lower 2' })).body.survey_source, 'ESS', 'an update that does not mention it keeps it');
        const toOut = await put39(e.body.metric_id, { metric_type: 'OUTCOME' });
        assert.strictEqual(toOut.status, 200); assert.strictEqual(toOut.body.survey_source, null, 'OUTCOME is NULL');
        assert.strictEqual((await put39(e.body.metric_id, { survey_source: 'ESS' })).body.survey_source, null, 'ESS sent to an OUTCOME metric is ignored');
        const back = await put39(e.body.metric_id, { metric_type: 'SURVEY' });
        assert.ok(['SYSTEM', 'ESS'].includes(back.body.survey_source), `SURVEY again has a source (${back.body.survey_source})`);
        const out = await adminJson('POST', '/api/admin/metrics', { metric_name: 'REGRESSION SRC Outcome', metric_type: 'OUTCOME', scale_type: 'PERCENTAGE', survey_source: 'ESS' });
        assert.strictEqual(out.status, 201);
        const outBody = await out.json(); tempMetricIds36.push(outBody.metric_id);
        assert.strictEqual(outBody.survey_source, null);
      });

      await runTest('[NEGATIVE] An ESS metric is always manual upload: requires_manual_upload=false is refused (400) on add and update (also for the real ESS metric 9, which stays unchanged); turning on ESS turns the flag on; a SYSTEM metric may have it off', async () => {
        const bad = await mkSurvey39('REGRESSION SRC Ess Off', { survey_source: 'ESS', requires_manual_upload: false });
        assert.strictEqual(bad.status, 400);
        assert.ok(/ESS/.test(bad.body.error) && /manual/i.test(bad.body.error));
        const e = await mkSurvey39('REGRESSION SRC Ess Default', { survey_source: 'ESS' });
        assert.strictEqual(e.status, 201); assert.strictEqual(e.body.requires_manual_upload, true, 'ESS defaults to manual upload');
        assert.strictEqual((await put39(e.body.metric_id, { requires_manual_upload: false })).status, 400);
        assert.strictEqual((await put39(e.body.metric_id, { survey_source: 'ESS', requires_manual_upload: false })).status, 400);
        assert.strictEqual((await getMetric39(e.body.metric_id)).requires_manual_upload, true);
        assert.strictEqual((await put39(e.body.metric_id, { requires_manual_upload: true })).status, 200);
        const before9 = await getMetric39(9);
        assert.strictEqual((await put39(9, { requires_manual_upload: false })).status, 400);
        assert.deepStrictEqual(await getMetric39(9), before9, 'the real ESS metric is untouched by the refused call');
        // SYSTEM may be off, and switching it to ESS in the same request that says false is refused, but without the flag it turns on
        const s = await mkSurvey39('REGRESSION SRC Sys Off', { requires_manual_upload: false });
        assert.strictEqual(s.status, 201); assert.strictEqual(s.body.survey_source, 'SYSTEM'); assert.strictEqual(s.body.requires_manual_upload, false);
        assert.strictEqual((await put39(s.body.metric_id, { survey_source: 'ESS', requires_manual_upload: false })).status, 400);
        const toEss = await put39(s.body.metric_id, { survey_source: 'ESS' });
        assert.strictEqual(toEss.status, 200); assert.strictEqual(toEss.body.requires_manual_upload, true, 'becoming ESS turns the flag on');
        const toSys = await put39(s.body.metric_id, { survey_source: 'SYSTEM', requires_manual_upload: false });
        assert.strictEqual(toSys.status, 200); assert.strictEqual(toSys.body.requires_manual_upload, false, 'leaving ESS releases the lock');
      });

      await runTest('[POSITIVE] ESS is detected by the survey_source column, not by the words in source_of_data (and the score does not depend on it)', async () => {
        const a = await mkSurvey39('REGRESSION SRC Col ESS', { survey_source: 'ESS', source_of_data: 'Pulse Check Form' });
        const b = await mkSurvey39('REGRESSION SRC Col System', { survey_source: 'SYSTEM', source_of_data: 'ESS (Employee Sentiment Survey)' });
        assert.strictEqual(a.status, 201); assert.strictEqual(b.status, 201);
        const dA = await aj(`/api/metrics/${a.body.metric_id}/detail?period=YTD`);
        const dB = await aj(`/api/metrics/${b.body.metric_id}/detail?period=YTD`);
        assert.strictEqual(dA.is_ess, true, 'ESS without the word ESS in the text');
        assert.ok(dA.ess_summary, 'the ESS dimension summary is built for it');
        assert.strictEqual(dB.is_ess, false, 'text says ESS but the column says SYSTEM');
        assert.strictEqual(dB.ess_summary, null);
        // editing the text does not flip it
        assert.strictEqual((await put39(a.body.metric_id, { source_of_data: 'Something else' })).status, 200);
        assert.strictEqual((await aj(`/api/metrics/${a.body.metric_id}/detail?period=YTD`)).is_ess, true);
        // v2.32.0: the column also decides the upload format - CSV rows to an ESS metric are refused (400, nothing stored)
        const day39 = new Date().toISOString().slice(0, 10);
        const csvRows = csv36([`9300001,Skor Sama,s@cimbniaga.co.id,${csvCell(A)},${csvCell(divX)},${day39},4`, `9300002,Skor Sama 2,s2@cimbniaga.co.id,${csvCell(A)},${csvCell(divX)},${day39},5`]);
        const refused = await adminJson('POST', '/api/surveys/upload', { csvText: csvRows, fileName: 'rt39.csv', metric_id: a.body.metric_id });
        assert.strictEqual(refused.status, 400);
        assert.match((await refused.json()).error, /ESS/);
        assert.strictEqual((await aj(`/api/surveys/responses/${a.body.metric_id}`)).length, 0, 'nothing stored');
        // the same metric switched to SYSTEM takes the CSV
        assert.strictEqual((await put39(a.body.metric_id, { survey_source: 'SYSTEM' })).status, 200);
        const up = await adminJson('POST', '/api/surveys/upload', { csvText: csvRows, fileName: 'rt39.csv', metric_id: a.body.metric_id });
        assert.strictEqual((await up.json()).valid_rows_count, 2);
      });

      await runTest('[POSITIVE] Boot top-up (SQL Server): NULL survey_source of a SURVEY metric is filled (text with ESS -> ESS, otherwise SYSTEM), an admin\'s value is never overwritten, OUTCOME stays NULL, ESS with the reminder flag off is switched on, and running it twice changes nothing', async () => {
        require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
        const storage = require('../server/db/storage');
        if (storage.backend !== 'sql') { console.log('     (skipped: JSON backend - its backfill runs when store.json is loaded and is covered by the unit run documented in docs/07)'); return; }
        const sql = require('mssql');
        const pool = await new sql.ConnectionPool({ server: process.env.DB_SERVER || 'localhost', port: parseInt(process.env.DB_PORT || '1433', 10), database: process.env.DB_NAME || 'PeopleExperiencePX',
          user: process.env.DB_USER, password: process.env.DB_PASSWORD, options: { encrypt: false, trustServerCertificate: true } }).connect();
        try {
          const withText = await mkSurvey39('REGRESSION SRC Top ESS text', { source_of_data: 'ESS (Employee Sentiment Survey)' });
          const plain = await mkSurvey39('REGRESSION SRC Top plain', { source_of_data: 'Event Evaluation Form' });
          const adminChoice = await mkSurvey39('REGRESSION SRC Top admin', { source_of_data: 'ESS (Employee Sentiment Survey)', survey_source: 'SYSTEM' });
          const essOff = await mkSurvey39('REGRESSION SRC Top ess off', { survey_source: 'ESS' });
          const outc = await adminJson('POST', '/api/admin/metrics', { metric_name: 'REGRESSION SRC Top outcome', metric_type: 'OUTCOME', scale_type: 'PERCENTAGE' });
          const outId = (await outc.json()).metric_id; tempMetricIds36.push(outId);
          const ids = [withText, plain, adminChoice, essOff].map(x => x.body.metric_id);
          assert.ok(ids.every(Boolean));
          // simulate a database from before v2.29.0 for three metrics, and an ESS metric whose flag was switched off behind the app's back
          await pool.request().query(`UPDATE dbo.px_metrics SET survey_source = NULL WHERE metric_id IN (${ids[0]}, ${ids[1]})`);
          await pool.request().query(`UPDATE dbo.px_metrics SET requires_manual_upload = 0 WHERE metric_id = ${ids[3]}`);
          await storage.topUpSurveySource();
          await storage.enforceEssManualUpload();
          await storage.topUpSurveySource(); await storage.enforceEssManualUpload(); // idempotent
          assert.strictEqual((await getMetric39(ids[0])).survey_source, 'ESS');
          assert.strictEqual((await getMetric39(ids[1])).survey_source, 'SYSTEM');
          assert.strictEqual((await getMetric39(ids[2])).survey_source, 'SYSTEM', 'an admin\'s SYSTEM is not overwritten although the text says ESS');
          assert.strictEqual((await getMetric39(ids[3])).requires_manual_upload, true, 'ESS flag switched back on');
          assert.strictEqual((await getMetric39(outId)).survey_source, null, 'OUTCOME stays NULL');
          // the database also refuses a value outside SYSTEM/ESS
          await assert.rejects(() => pool.request().query(`UPDATE dbo.px_metrics SET survey_source = 'FOO' WHERE metric_id = ${ids[1]}`), /CK_px_metrics_survey_source|CHECK/i);
        } finally {
          await pool.close();
          if (typeof storage.close === 'function' && !tempAdmin) await storage.close();
        }
      });

      await runTest('[POSITIVE] Every SURVEY metric can be uploaded by hand (Admin): SYSTEM and ESS, with or without the reminder flag - upload, template, evidence and the responses list work; template and evidence also answer for all 20 real SURVEY metrics', async () => {
        const sysOff = await mkSurvey39('REGRESSION UP System Off', { survey_source: 'SYSTEM', requires_manual_upload: false });
        const sysOn = await mkSurvey39('REGRESSION UP System On', { survey_source: 'SYSTEM', requires_manual_upload: true });
        const essM = await mkSurvey39('REGRESSION UP ESS', { survey_source: 'ESS' });
        const day39 = new Date().toISOString().slice(0, 10);
        const list = await aj('/api/surveys/metrics');
        for (const m of [sysOff, sysOn, essM]) {
          const id = m.body.metric_id;
          assert.ok(list.some(x => x.metric_id === id), `metric ${id} is offered in the upload list`);
          const isEss39 = m === essM;
          // ESS (v2.32.0): the ESS summary .xlsx with one Bankwide row of participation 1; SYSTEM: one CSV row
          const up = isEss39
            ? await postEssFile(id, await essXlsx([ESS_HEAD(), ['PT Bank CIMB Niaga Tbk', 'Bankwide', new Date().getFullYear(), 'January', 1, 0.8, 0.8]]))
            : await adminJson('POST', '/api/surveys/upload', { csvText: csv36([`93100${id}1,Unggah ${id},u${id}@cimbniaga.co.id,${csvCell(A)},${csvCell(divX)},${day39},4`]), fileName: 'rt39.csv', metric_id: id });
          assert.strictEqual(up.status, 200);
          const body = await up.json();
          assert.strictEqual(body.success, true, `upload to ${id}`); assert.strictEqual(body.valid_rows_count, 1);
          assert.strictEqual((await aj(`/api/surveys/responses/${id}`)).length, isEss39 ? 0 : 1, 'the row is stored in that metric (ESS: as a summary row, no respondent rows)');
          assert.strictEqual((await adminJson('GET', `/api/surveys/template?metric_id=${id}`)).status, 200);
          assert.strictEqual((await adminJson('GET', `/api/surveys/evidence?metric_id=${id}&period=YTD`)).status, 200);
          const d = await aj(`/api/metrics/${id}/detail?period=YTD`);
          assert.strictEqual(d.can_upload, true);
          assert.strictEqual(d.total_respondents, 1);
        }
        const calc = await aj('/api/metrics/calculate?period=YTD');
        assert.ok(calc.metrics.filter(m => m.metric_type === 'SURVEY').every(m => m.can_upload === true), 'the UI buttons are shown for every SURVEY metric');
        const real = calc.metrics.filter(m => m.metric_type === 'SURVEY' && m.metric_id <= 27).map(m => m.metric_id);
        assert.strictEqual(real.length, 20);
        for (const id of real) {
          assert.strictEqual((await adminJson('GET', `/api/surveys/template?metric_id=${id}`)).status, 200, `template ${id}`);
          assert.strictEqual((await adminJson('GET', `/api/surveys/evidence?metric_id=${id}&period=YTD`)).status, 200, `evidence ${id}`);
        }
      });

      await runTest('[POSITIVE/NEGATIVE] The PIC of a SYSTEM metric without the reminder flag can upload (audited), the PIC of an ESS metric too; a User who is not the PIC, or the PIC of another metric, gets 403 on every upload route; rights follow the metric\'s PIC e-mail', async () => {
        plainUser.cookie = (await loginAs(plainUser.username, STRONG)).cookie; // Module 36 deactivated/reactivated this account, which ended its session
        const day39 = new Date().toISOString().slice(0, 10);
        const sysM = await mkSurvey39('REGRESSION UP PIC System', { survey_source: 'SYSTEM', requires_manual_upload: false, pic_email: uMail('p1') });
        const essM = await mkSurvey39('REGRESSION UP PIC ESS', { survey_source: 'ESS', pic_email: uMail('p1') });
        const otherM = await mkSurvey39('REGRESSION UP PIC Other', { survey_source: 'ESS', pic_email: 'someone.else@example.test' });
        for (const m of [sysM, essM]) {
          const id = m.body.metric_id;
          const calc = await uj(picUser, '/api/metrics/calculate?period=YTD');
          assert.strictEqual(calc.metrics.find(x => x.metric_id === id).can_upload, true, `PIC sees the upload buttons for ${id}`);
          assert.strictEqual((await csvFor(picUser, id)).status, 200);
          const up = m === essM
            // v2.50.0: one value per configured question (the new ESS metric has 1 question), mapped by position
            ? await postEssFile(id, await essXlsx([ESS_HEAD(), [A, 'Directorate', new Date().getFullYear(), 1, 1, 0.9, 0.9]]), 'pic39.xlsx', picUser.cookie)
            : await post36(picUser, { csvText: csv36([`93200${id}1,Pic Unggah ${id},pu${id}@cimbniaga.co.id,${csvCell(A)},${csvCell(divX)},${day39},5`]), metric_id: String(id), fileName: 'pic39.csv' });
          assert.strictEqual(up.status, 200, `PIC upload to ${id}`);
          const body = await up.json();
          assert.strictEqual(body.valid_rows_count, 1); assert.strictEqual(body.calculation, undefined, 'no bankwide calculation for a PIC');
          const log = await aj('/api/admin/audit-log?limit=100&include_test=1');
          assert.ok(log.some(e => e.action === 'SURVEY_UPLOAD' && e.username === picUser.username && e.target.includes(`metric ${id};`)), 'audited');
          assert.strictEqual((await uget(picUser, `/api/surveys/evidence?metric_id=${id}&period=YTD`)).status, 200);
          // a non-PIC User: 403 everywhere
          assert.strictEqual((await csvFor(plainUser, id)).status, 403);
          assert.strictEqual((await post36(plainUser, { csvText: csv36([`9330001,X,x@cimbniaga.co.id,${csvCell(A)},${csvCell(divX)},${day39},4`]), metric_id: String(id) })).status, 403);
          assert.strictEqual((await uget(plainUser, `/api/surveys/evidence?metric_id=${id}&period=YTD`)).status, 403);
          assert.strictEqual((await uget(plainUser, `/api/surveys/responses/${id}`)).status, 403);
        }
        const otherId = otherM.body.metric_id;
        assert.strictEqual((await csvFor(picUser, otherId)).status, 403, 'PIC of other metrics cannot use an ESS metric that is not theirs');
        assert.strictEqual((await post36(picUser, { csvText: csv36([`9340001,X,x@cimbniaga.co.id,${csvCell(A)},${csvCell(divX)},${day39},4`]), metric_id: String(otherId) })).status, 403);
        assert.strictEqual((await aj(`/api/surveys/responses/${otherId}`)).length, 0, 'nothing was written into the other metric');
        // OUTCOME metrics are never uploadable, not even for the Admin
        assert.strictEqual((await csvFor(picUser, 1)).status, 403);
        const calcAdm = await aj('/api/metrics/calculate?period=YTD');
        assert.ok(calcAdm.metrics.filter(m => m.metric_type === 'OUTCOME').every(m => m.can_upload === false));
        // revoking: change the e-mail of the SYSTEM metric -> the very next request is refused
        assert.strictEqual((await put39(sysM.body.metric_id, { pic_email: 'gone@example.test' })).status, 200);
        assert.strictEqual((await csvFor(picUser, sysM.body.metric_id)).status, 403);
      });

      await runTest('[NEGATIVE] Upload keeps rejecting a target that is not a SURVEY metric: an OUTCOME or unknown metric id (form field) and a CSV metric_id column that names an OUTCOME or unknown metric store nothing; the form metric still wins over a mismatching CSV column', async () => {
        const day39 = new Date().toISOString().slice(0, 10);
        const t1 = await mkSurvey39('REGRESSION UP Target 1', { survey_source: 'SYSTEM' });
        const t2 = await mkSurvey39('REGRESSION UP Target 2', { survey_source: 'SYSTEM' });
        const t3 = await mkSurvey39('REGRESSION UP Target 3 ESS', { survey_source: 'ESS' });
        const row = (nip, extra) => `${nip},Salah Sasaran,s@cimbniaga.co.id,${csvCell(A)},${csvCell(divX)},${day39},4${extra === undefined ? '' : ',' + extra}`;
        const withCol = rows => ['nip,employee_name,cimb_email,directorate,division,survey_date,q1_overall,metric_id', ...rows].join('\r\n');
        const total = async () => (await aj(`/api/surveys/responses/${t1.body.metric_id}`)).length + (await aj(`/api/surveys/responses/${t2.body.metric_id}`)).length;
        const baseline = await total();
        for (const [label, payload] of [
          ['form OUTCOME', { csvText: csv36([row('9350001')]), metric_id: 1 }],
          ['form unknown', { csvText: csv36([row('9350002')]), metric_id: 99999 }],
          ['column OUTCOME', { csvText: withCol([row('9350003', 1)]) }],
          ['column unknown', { csvText: withCol([row('9350004', 99999)]) }],
          ['column ESS', { csvText: withCol([row('9350006', t3.body.metric_id)]) }]
        ]) {
          const res = await adminJson('POST', '/api/surveys/upload', { fileName: 'rt39.csv', ...payload });
          assert.strictEqual(res.status, 200, label);
          const body = await res.json();
          assert.strictEqual(body.success, false, `${label} must be rejected`);
          assert.strictEqual(body.valid_rows_count || 0, 0, label);
        }
        assert.strictEqual(await total(), baseline, 'no row was stored by the rejected uploads');
        // the form metric wins over the CSV column: the row goes to t2, not to t1
        const res = await adminJson('POST', '/api/surveys/upload', { fileName: 'rt39.csv', metric_id: t2.body.metric_id, csvText: withCol([row('9350005', t1.body.metric_id)]) });
        assert.strictEqual((await res.json()).valid_rows_count, 1);
        assert.strictEqual((await aj(`/api/surveys/responses/${t2.body.metric_id}`)).length, 1);
        assert.strictEqual((await aj(`/api/surveys/responses/${t1.body.metric_id}`)).length, 0);
      });

      await runTest('[POSITIVE] Reminders stay opt-in: a SURVEY metric without the reminder flag is never reminded (even when its PIC e-mail is set and its deadline is past); ESS metrics are in the reminder set (flag always on)', async () => {
        const rem = await aj('/api/admin/upload-reminders');
        const ids = new Set((rem.reminders || []).map(r => r.metric_id));
        assert.ok(!ids.has(R), 'R has the reminder flag off and must not be reminded');
        const flagOff = await mkSurvey39('REGRESSION UP No Reminder', { survey_source: 'SYSTEM', requires_manual_upload: false, upload_deadline_day: 1 });
        const flagOn = await mkSurvey39('REGRESSION UP Reminder', { survey_source: 'SYSTEM', requires_manual_upload: true, upload_deadline_day: 1 });
        const after = new Set(((await aj('/api/admin/upload-reminders')).reminders || []).map(r => r.metric_id));
        assert.ok(!after.has(flagOff.body.metric_id), 'flag off -> no reminder');
        assert.ok(after.has(flagOn.body.metric_id), 'flag on + deadline day 1 + no data -> reminder (control)');
        const reminderMetrics = (await aj('/api/admin/parameters')).metrics.filter(m => m.metric_type === 'SURVEY' && m.requires_manual_upload && m.pic_email && m.metric_id <= 27);
        assert.ok(ESS_IDS.every(id => reminderMetrics.some(m => m.metric_id === id)), 'all 11 ESS metrics are reminder candidates');
      });
    } finally {
      for (const id of tempMetricIds36) await adminJson('DELETE', `/api/admin/metrics/${id}`);
      const left = (await aj('/api/admin/parameters')).metrics.filter(m => /^REGRESSION (PIC|SRC|UP)/.test(m.metric_name));
      if (left.length) console.error(`     cleanup: ${left.length} PIC test metrics remain`);
    }
  } finally {
    for (const id of createdUserIds) await adminJson('DELETE', `/api/admin/users/${id}`);
    const left = (await (await adminJson('GET', '/api/admin/users')).json()).filter(x => x.username.endsWith(stamp) && x.username.startsWith('rt'));
    if (left.length) console.error(`     cleanup: ${left.length} test users remain`);
  }

  // --- MODULE 37 (v2.27.2): standard initial password via env DEFAULT_INITIAL_PASSWORD ---
  // The real server has its own environment, so this module mounts the REAL auth routes (registerAuthRoutes) on a
  // throw-away in-process express app over the same SQL database and sets process.env here. The test value is made
  // up per run; no real/default password exists in the repo. SQL backend only (the JSON backend keeps its data in
  // the running server's memory, which an in-process app cannot share).
  console.log('\n📦 MODULE 37: Standard Initial Password - env DEFAULT_INITIAL_PASSWORD (Positive & Negative Testing)');
  {
    const storage37 = require('../server/db/storage');
    if (storage37.backend !== 'sql') {
      console.log('  ⏭️  SKIP: Module 37 needs the SQL backend (in-process auth routes over the same database)');
    } else {
      const express = require('express');
      const auth37 = require('../server/services/authService');
      const crypto37 = require('crypto');
      const savedEnv = process.env.DEFAULT_INITIAL_PASSWORD;
      const DEFAULT_PW = 'Init-' + crypto37.randomBytes(6).toString('hex') + 'Zz'; // made up for this run only
      const app37 = express();
      app37.use(express.json());
      auth37.registerAuthRoutes(app37);
      const server37 = await new Promise(resolve => { const s = app37.listen(0, '127.0.0.1', () => resolve(s)); });
      const B = `http://127.0.0.1:${server37.address().port}`;
      const stamp37 = Date.now().toString(36);
      const ids37 = [];
      const post = (p, body, cookie) => realFetch(`${B}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body || {}) });
      const ck = r => (r.headers.getSetCookie() || []).map(c => c.split(';')[0]).find(c => c.startsWith('px_session=')) || null;
      const adminPw = crypto37.randomBytes(9).toString('hex') + 'Aa1';
      const admin = await storage37.createUser({ is_test_account: true, username: `rt37admin${stamp37}`, full_name: 'Regression 37 Admin', email: '', role: 'ADMIN', password_hash: await auth37.hashPassword(adminPw), must_change_password: false });
      ids37.push(admin.user_id);
      try {
        const adminLogin = await post('/api/auth/login', { username: admin.username, password: adminPw });
        assert.strictEqual(adminLogin.status, 200);
        const adminCookie = ck(adminLogin);
        const createUser = async suffix => {
          const username = `rt37${suffix}${stamp37}`;
          const r = await post('/api/admin/users', { username, full_name: `Regression 37 ${suffix}`, role: 'ADMIN', scopes: [] }, adminCookie);
          assert.strictEqual(r.status, 201);
          const b = await r.json(); ids37.push(b.user.user_id);
          return { username, id: b.user.user_id, body: b };
        };

        process.env.DEFAULT_INITIAL_PASSWORD = DEFAULT_PW;

        await runTest('[POSITIVE] With the env set, a new account gets the standard initial password, must change it (403 elsewhere), and the policy still applies to its replacement', async () => {
          const u = await createUser('a');
          assert.strictEqual(u.body.temporary_password, DEFAULT_PW);
          assert.strictEqual(u.body.is_default_password, true);
          assert.strictEqual(u.body.user.must_change_password, true);
          const login = await post('/api/auth/login', { username: u.username, password: DEFAULT_PW });
          assert.strictEqual(login.status, 200);
          const cookie = ck(login);
          const blocked = await realFetch(`${B}/api/admin/users`, { headers: { Cookie: cookie } });
          assert.strictEqual(blocked.status, 403);
          assert.strictEqual((await blocked.json()).code, 'PASSWORD_CHANGE_REQUIRED');
          const weak = await post('/api/auth/change-password', { current_password: DEFAULT_PW, new_password: 'short1' }, cookie);
          assert.strictEqual(weak.status, 400);
          const strong = 'Repl-' + crypto37.randomBytes(6).toString('hex') + '9';
          const ok = await post('/api/auth/change-password', { current_password: DEFAULT_PW, new_password: strong }, cookie);
          assert.strictEqual(ok.status, 200);
          assert.strictEqual((await post('/api/auth/login', { username: u.username, password: DEFAULT_PW })).status, 401, 'initial password dead after the change');
          assert.strictEqual((await post('/api/auth/login', { username: u.username, password: strong })).status, 200);
        });

        await runTest('[NEGATIVE] Changing to the standard initial password itself is refused (400, clear message) - also when it satisfies the policy', async () => {
          const u = await createUser('b');
          const cookie = ck(await post('/api/auth/login', { username: u.username, password: DEFAULT_PW }));
          // A different current password so the "same as current" rule cannot be what refuses it: first move to a strong one.
          const mid = 'Mid-' + crypto37.randomBytes(6).toString('hex') + '7';
          assert.strictEqual((await post('/api/auth/change-password', { current_password: DEFAULT_PW, new_password: mid }, cookie)).status, 200);
          const cookie2 = ck(await post('/api/auth/login', { username: u.username, password: mid }));
          const r = await post('/api/auth/change-password', { current_password: mid, new_password: DEFAULT_PW }, cookie2);
          assert.strictEqual(r.status, 400);
          assert.ok(/standard initial/i.test((await r.json()).error));
          assert.strictEqual((await post('/api/auth/login', { username: u.username, password: mid })).status, 200, 'password unchanged');
        });

        await runTest('[POSITIVE] reset-password uses the standard initial password too, forces a change and unlocks the account (lockout rules unchanged)', async () => {
          const u = await createUser('c');
          for (let i = 0; i < 5; i++) assert.strictEqual((await post('/api/auth/login', { username: u.username, password: 'Bad-Password-1' })).status, 401);
          assert.strictEqual((await post('/api/auth/login', { username: u.username, password: DEFAULT_PW })).status, 401, 'locked after 5 failures even with the right password');
          const reset = await post(`/api/admin/users/${u.id}/reset-password`, {}, adminCookie);
          assert.strictEqual(reset.status, 200);
          const rb = await reset.json();
          assert.strictEqual(rb.temporary_password, DEFAULT_PW);
          assert.strictEqual(rb.is_default_password, true);
          assert.strictEqual(rb.user.must_change_password, true);
          assert.strictEqual((await post('/api/auth/login', { username: u.username, password: DEFAULT_PW })).status, 200);
        });

        await runTest('[NEGATIVE] The standard initial password is never in the audit log or the user list', async () => {
          const log = JSON.stringify(await storage37.getAuditLog(500, { includeTest: true }));
          assert.ok(log.includes(`rt37a${stamp37}`) || log.includes('USER_CREATE'), 'audit log has the events');
          assert.strictEqual(log.includes(DEFAULT_PW), false, 'audit log must not contain the password');
          const list = await realFetch(`${B}/api/admin/users`, { headers: { Cookie: adminCookie } });
          assert.strictEqual((await list.text()).includes(DEFAULT_PW), false, 'user list must not contain the password');
        });

        await runTest('[POSITIVE] With the env empty or unset, accounts get a random temporary password as before (policy-conform, different each time, flagged not-default)', async () => {
          for (const value of ['', '   ', undefined]) {
            if (value === undefined) delete process.env.DEFAULT_INITIAL_PASSWORD; else process.env.DEFAULT_INITIAL_PASSWORD = value;
            const u = await createUser(`r${ids37.length}`);
            assert.notStrictEqual(u.body.temporary_password, DEFAULT_PW);
            assert.strictEqual(u.body.is_default_password, false);
            assert.strictEqual(auth37.validateNewPassword(u.body.temporary_password, null), null);
            const reset = await (await post(`/api/admin/users/${u.id}/reset-password`, {}, adminCookie)).json();
            assert.strictEqual(reset.is_default_password, false);
            assert.notStrictEqual(reset.temporary_password, u.body.temporary_password);
          }
        });
      } finally {
        if (savedEnv === undefined) delete process.env.DEFAULT_INITIAL_PASSWORD; else process.env.DEFAULT_INITIAL_PASSWORD = savedEnv;
        await new Promise(resolve => server37.close(resolve));
        for (const id of ids37) { try { await storage37.deleteUser(id); } catch (_) { /* ignore */ } }
        const leftovers = (await storage37.listUsers()).filter(x => x.username.endsWith(stamp37) && x.username.startsWith('rt37'));
        if (leftovers.length) console.error(`     cleanup: ${leftovers.length} Module 37 users remain`);
      }
    }
  }

  // --- MODULE 38 (v2.28.0): AI SUMMARY OF A VIDEO TRANSCRIPT (local Gemma, FAKE Ollama) ---
  // The suite never talks to the real Gemma: a throw-away second backend is started with OLLAMA_HOST and
  // TRANSCRIBE_API_URL pointing at in-process fakes, over the same SQL database. SQL backend only.
  console.log('\n📦 MODULE 38: Video AI Summary - Gemma only for a new video, validator, fallback, zero stray calls (Positive & Negative Testing)');
  if (!skipModuleBlock(38)) {
    const storage38 = require('../server/db/storage');
    // Validator: numbers written as words are facts too (offline, no Ollama).
    const summarySvc = require('../server/services/mediaSummaryService');
    const wrap = (summary, points = ['Mentor mendampingi peserta baru.', 'Mentor bertemu para peserta.']) => ({ summary, points });
    const NUM_TR_ID = 'Setiap mentor mendampingi peserta selama enam bulan pertama dan bertemu dua kali seminggu dengan para peserta baru di kantor pusat setiap pekan.';
    const NUM_TR_EN = 'Every mentor supports the participants for six months and meets them twice a week at the head office for new employees.';
    await runTest('[NEGATIVE] Validator: invented number WORDS are rejected (enam -> sepuluh bulan, dua -> tiga kali, seminggu -> setahun, six -> ten, twice -> three times)', async () => {
      const bad = [
        ['Setiap mentor mendampingi peserta selama sepuluh bulan pertama di kantor pusat.', NUM_TR_ID, 'id', /sepuluh/],
        ['Setiap mentor bertemu tiga kali seminggu dengan para peserta baru di kantor pusat.', NUM_TR_ID, 'id', /tiga/],
        ['Setiap mentor bertemu dua kali setahun dengan para peserta baru di kantor pusat.', NUM_TR_ID, 'id', /setahun/],
        ['Every mentor supports the participants for ten months at the head office for new employees.', NUM_TR_EN, 'en', /ten/],
        ['Every mentor meets them three times a week at the head office for new employees.', NUM_TR_EN, 'en', /three/]
      ];
      for (const [text, tr, lang, re] of bad) {
        const reason = summarySvc.validateAnswer(wrap(text), tr, lang);
        assert.ok(reason && re.test(reason), `"${text}" must be rejected for a number word, got: ${reason}`);
      }
      // a number word in a key point is checked too
      assert.ok(summarySvc.validateAnswer(wrap('Setiap mentor mendampingi peserta selama enam bulan pertama di kantor pusat.', ['Bertemu seratus kali.', 'Poin lain yang wajar.']), NUM_TR_ID, 'id'));
    });
    await runTest('[POSITIVE] Validator: number words (and equal digits) that ARE in the transcript are accepted; the stored real summary of the user video is still accepted', async () => {
      const ok = [
        ['Setiap mentor mendampingi peserta selama enam bulan pertama dan bertemu dua kali seminggu di kantor pusat.', NUM_TR_ID, 'id'],
        ['Setiap mentor mendampingi peserta selama 6 bulan pertama dan bertemu 2 kali seminggu di kantor pusat.', NUM_TR_ID, 'id'],
        ['Every mentor supports the participants for six months and meets them twice a week at the head office.', NUM_TR_EN, 'en', ['Every mentor supports the participants.', 'Mentors meet the participants.']],
        ['Every mentor supports the participants for 6 months and meets them 2 times a week at the head office.', NUM_TR_EN, 'en', ['Every mentor supports the participants.', 'Mentors meet the participants.']]
      ];
      for (const [text, tr, lang, pts] of ok) assert.strictEqual(summarySvc.validateAnswer(wrap(text, pts), tr, lang), null, text);
      const REAL_TR = 'Orang yang pasif, banyak dihabiskan untuk menyendiri, sibuk dengan diri sendiri, mencari sebuah ketenangan, tapi sembuh. Pelan-pelan aku sadar, semua ini terasa hampak, lebih lagi saat ku ingat, demi masa, sesungguhnya manusia berada dalam kerugian. hingga akhirnya aku memberanikan diri untuk beranjak keluar mencoba jadi bagian dari hidup ini bagian yang berarti kalau tidak waktuku tidak habis dengan sia-sia';
      const real = summarySvc.parseModelAnswer('RINGKASAN: Orang yang sebelumnya pasif dan banyak menyendiri, mencari ketenangan, namun kemudian sembuh. Ia mulai menyadari bahwa hal tersebut terasa sangat mengganggu, terutama ketika mengingat bahwa manusia sebenarnya berada dalam kerugian. Akhirnya, ia berani keluar dan mencoba menjadi bagian dari kehidupan, agar tidak menyia-nyiakan waktu.\n\nPOIN:\n- Orang tersebut sebelumnya banyak menyendiri dan mencari ketenangan.\n- Ia menyadari bahwa tindakannya terasa sangat mengganggu.\n- Ia mengingat bahwa manusia sebenarnya berada dalam kerugian.\n- Ia berani keluar dan mencoba menjadi bagian dari kehidupan.\n- Ia ingin agar waktunya tidak terbuang sia-sia.');
      assert.strictEqual(summarySvc.validateAnswer(real, REAL_TR, 'id'), null, 'the real stored Gemma summary must not be over-rejected');
    });
    if (storage38.backend !== 'sql') {
      console.log('  ⏭️  SKIP: Module 38 needs the SQL backend (second backend over the same database)');
    } else {
      const http38 = require('http');
      const { spawn } = require('child_process');
      const path38 = require('path');
      const crypto38 = require('crypto');
      const auth38 = require('../server/services/authService');
      const EVENT = 'ev-perspektif-2024-q1';
      const TEXT_ID = 'Hari ini kami membahas program mentoring untuk karyawan baru di kantor pusat. Setiap mentor mendampingi peserta selama enam bulan pertama, bertemu secara rutin, dan membantu mereka memahami budaya kerja. Peserta merasa lebih percaya diri setelah mengikuti sesi tersebut dan ingin program ini diteruskan.';
      const TEXT_EN = 'Today we talked about the mentoring program for new employees at the head office. Every mentor supports a participant during the first months, meets regularly, and helps them understand the working culture. Participants felt more confident after the sessions and want this program to continue.';
      const TEXT_SHORT = 'Halo semuanya, terima kasih sudah hadir.';
      const GOOD_ID = 'RINGKASAN: Program mentoring untuk karyawan baru di kantor pusat dibahas. Mentor mendampingi peserta selama enam bulan pertama dan membantu mereka memahami budaya kerja. Peserta merasa lebih percaya diri dan ingin program diteruskan.\n\nPOIN:\n- Program mentoring untuk karyawan baru di kantor pusat.\n- Mentor mendampingi peserta dan bertemu secara rutin.\n- Peserta ingin program ini diteruskan.';
      const GOOD_EN = 'SUMMARY: The mentoring program for new employees at the head office was discussed. Every mentor supports a participant, meets regularly and helps them understand the working culture. Participants felt more confident and want the program to continue.\n\nPOINTS:\n- Mentoring program for new employees at the head office.\n- Mentors meet participants regularly.\n- Participants want this program to continue.';
      const FABRICATED = 'RINGKASAN: Program mentoring untuk karyawan baru dibuka oleh Budi Santoso pada tahun 2019 dengan 350 peserta di kantor pusat. Mentor mendampingi peserta dengan rutin.\n\nPOIN:\n- Dibuka oleh Budi Santoso.\n- Diikuti 350 peserta sejak 2019.\n- Mentor mendampingi peserta.';

      const oll = { calls: [], mode: 'good', delay: 0 };
      const fakeOllama = http38.createServer((req, res) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
          let body = {};
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) { /* tags etc. */ }
          oll.calls.push({ method: req.method, url: req.url, prompt: body.prompt || '', model: body.model });
          if (oll.mode === 'close') return req.socket.destroy();
          const endLater = payload => setTimeout(() => res.end(payload), oll.delay || 0);
          res.setHeader('Content-Type', 'application/json');
          if (oll.mode === 'missing') { res.statusCode = 404; return res.end(JSON.stringify({ error: "model 'gemma3:4b' not found" })); }
          let answer = (body.prompt || '').includes('Summarize the transcript') ? GOOD_EN : GOOD_ID;
          if (oll.mode === 'fabricate') answer = FABRICATED;
          if (oll.mode === 'fabricate-once' && oll.calls.filter(c => c.url === '/api/generate').length === 1) answer = FABRICATED;
          endLater(JSON.stringify({ response: answer, done: true }));
        });
      });
      const tr = { text: TEXT_ID, language: 'id', fail: false };
      const fakeTranscribe = http38.createServer((req, res) => {
        req.resume();
        req.on('end', () => {
          res.setHeader('Content-Type', 'application/json');
          if (req.method === 'POST' && req.url === '/transcribe') {
            if (tr.fail) { res.statusCode = 500; return res.end('{"detail":"boom"}'); }
            return res.end(JSON.stringify({ text: tr.text, language: tr.language, duration: 30, segments: [{ start: 0, end: 30, text: tr.text }] }));
          }
          res.end('{"status":"ok"}');
        });
      });
      const listen = srv => new Promise(resolve => srv.listen(0, '127.0.0.1', () => resolve(srv.address().port)));
      const sleep38 = ms => new Promise(r => setTimeout(r, ms));
      const ollamaPort = await listen(fakeOllama);
      const trPort = await listen(fakeTranscribe);
      const freePort = await (async () => { const s = http38.createServer(); const p = await listen(s); await new Promise(r => s.close(r)); return p; })();
      const CHILD = `http://127.0.0.1:${freePort}`;

      const stamp38 = Date.now().toString(36);
      const pw38 = { admin: crypto38.randomBytes(9).toString('hex') + 'Aa1', user: crypto38.randomBytes(9).toString('hex') + 'Bb2' };
      const userIds = [];
      const mediaIds = new Set();
      let child = null;
      let adminCookie = null;
      let userCookie = null;
      const cookieOf = r => (r.headers.getSetCookie() || []).map(c => c.split(';')[0]).find(c => c.startsWith('px_session='));
      const api = (p, opts = {}, cookie = adminCookie) => realFetch(`${CHILD}${p}`, { ...opts, headers: { ...(opts.headers || {}), ...(cookie ? { Cookie: cookie } : {}) } });
      const generateCalls = () => oll.calls.filter(c => c.url === '/api/generate').length;
      const eventMedia = async (id, cookie = adminCookie) => (await (await api(`/api/events/${EVENT}`, {}, cookie)).json()).media.find(m => m.media_id === id);
      const waitFor = async (id, pred, ms = 20000) => {
        for (let i = 0; i < ms / 250; i++) { const m = await eventMedia(id); if (m && pred(m)) return m; await sleep38(250); }
        return await eventMedia(id);
      };
      const upload = async (buffer, name, mime) => {
        const form = new FormData();
        form.append('mediaFile', new Blob([buffer], { type: mime }), name);
        const res = await api(`/api/events/${EVENT}/media`, { method: 'POST', body: form });
        const body = await res.json();
        if (body.media) mediaIds.add(body.media.media_id);
        return { res, media: body.media };
      };
      const uploadVideo = async (text, language = 'id') => {
        tr.text = text; tr.language = language; tr.fail = false;
        const up = await upload(Buffer.from('fake video bytes'), 'regression-summary.mp4', 'video/mp4');
        assert.strictEqual(up.res.status, 201);
        return up.media;
      };

      // Videos that exist BEFORE the second backend boots: one "old" without a summary, one interrupted mid-summary.
      const oldVideo = await storage38.addMedia({ event_id: EVENT, file_name: 'rt38-old.mp4', file_path: '/uploads/rt38-old.mp4', file_type: 'VIDEO', caption: 'rt38 old', transcript_status: 'DONE' });
      mediaIds.add(oldVideo.media_id);
      await storage38.updateMedia(oldVideo.media_id, { transcript: TEXT_ID, transcript_language: 'id', transcript_segments: [] });
      const interrupted = await storage38.addMedia({ event_id: EVENT, file_name: 'rt38-int.mp4', file_path: '/uploads/rt38-int.mp4', file_type: 'VIDEO', caption: 'rt38 interrupted', transcript_status: 'DONE' });
      mediaIds.add(interrupted.media_id);
      await storage38.updateMedia(interrupted.media_id, { transcript: TEXT_ID, transcript_language: 'id', transcript_segments: [], summary_status: 'PROCESSING' });

      try {
        const mk = async (suffix, role) => {
          const pw = pw38[role === 'ADMIN' ? 'admin' : 'user'];
          const u = await storage38.createUser({ is_test_account: true, username: `rt38${suffix}${stamp38}`, full_name: `Regression 38 ${suffix}`, email: '', role, password_hash: await auth38.hashPassword(pw), must_change_password: false });
          userIds.push(u.user_id);
          return { username: u.username, password: pw };
        };
        const adminAcc = await mk('a', 'ADMIN');
        const userAcc = await mk('u', 'USER');

        child = spawn(process.execPath, [path38.join(__dirname, '..', 'server', 'server.js')], {
          cwd: path38.join(__dirname, '..'),
          env: { ...process.env, PORT: String(freePort), OLLAMA_HOST: `http://127.0.0.1:${ollamaPort}`, OLLAMA_MODEL: 'gemma3:4b', TRANSCRIBE_API_URL: `http://127.0.0.1:${trPort}`, PX_DISABLE_SCHEDULERS: '1' },
          stdio: 'ignore'
        });
        let booted = false;
        for (let i = 0; i < 120 && !booted; i++) { try { booted = (await realFetch(`${CHILD}/api/health`)).ok; } catch (_) { await sleep38(500); } }
        assert.ok(booted, 'second backend did not start');
        const login = async acc => {
          const r = await realFetch(`${CHILD}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(acc) });
          assert.strictEqual(r.status, 200);
          return cookieOf(r);
        };
        adminCookie = await login(adminAcc);
        userCookie = await login(userAcc);

        // The interrupted summary job resumes at boot (it belongs to a video that was being processed); the old video does not.
        await waitFor(interrupted.media_id, m => m.summary_status === 'DONE');
        await sleep38(1500);

        await runTest('[POSITIVE] At boot only the interrupted summary continues (exactly 1 Gemma call); an old video without a summary is NOT processed automatically', async () => {
          assert.strictEqual(generateCalls(), 1, `boot made ${generateCalls()} generate calls`);
          assert.strictEqual(oll.calls.filter(c => c.url !== '/api/generate').length, 0, 'no other Ollama request at boot');
          assert.strictEqual((await eventMedia(interrupted.media_id)).summary_status, 'DONE');
          const old = await eventMedia(oldVideo.media_id);
          assert.strictEqual(old.summary_status, undefined, 'old video must stay without a summary');
          assert.strictEqual(old.summary, undefined);
        });

        oll.calls.length = 0;
        await runTest('[POSITIVE] Page loads / opening an event / dashboard / alerts / health / photo upload / PPT all make ZERO Ollama requests', async () => {
          for (const p of ['/api/events', `/api/events/${EVENT}`, '/api/metrics/calculate', '/api/alerts', '/api/health', '/api/settings', '/api/directorates']) {
            assert.strictEqual((await api(p)).status, 200, p);
          }
          const photo = await upload(TINY_PNG, 'rt38.png', 'image/png');
          assert.strictEqual(photo.res.status, 201);
          assert.strictEqual(photo.media.summary_status, undefined);
          await sleep38(800);
          assert.strictEqual((await eventMedia(photo.media.media_id)).summary_status, undefined, 'a photo is never summarized');
          const ppt = await api(`/api/events/${EVENT}/generate-ppt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
          assert.strictEqual(ppt.status, 200);
          await sleep38(500);
          assert.strictEqual(oll.calls.length, 0, `unexpected Ollama requests: ${JSON.stringify(oll.calls.map(c => c.url))}`);
        });

        await runTest('[POSITIVE] A NEW video: upload answers at once (no summary yet), transcript DONE triggers exactly one Gemma call, summary + key points stored with source AI, model, language, time', async () => {
          oll.calls.length = 0; oll.mode = 'good';
          const media = await uploadVideo(TEXT_ID);
          assert.strictEqual(media.transcript_status, 'PROCESSING');
          assert.strictEqual(media.summary_status, undefined);
          const done = await waitFor(media.media_id, m => m.summary_status === 'DONE');
          assert.strictEqual(done.transcript_status, 'DONE');
          assert.strictEqual(done.summary_status, 'DONE', done.summary_error);
          assert.strictEqual(done.summary_source, 'AI');
          assert.strictEqual(done.summary_model, 'gemma3:4b');
          assert.strictEqual(done.summary_language, 'id');
          assert.ok(done.summary_generated_at);
          assert.ok(done.summary.length > 40);
          assert.ok(done.summary_points.length >= 2 && done.summary_points.length <= 5);
          assert.strictEqual(generateCalls(), 1);
          assert.ok(oll.calls[0].prompt.includes(TEXT_ID), 'the transcript was sent to the model');
          assert.strictEqual(oll.calls[0].model, 'gemma3:4b');
        });

        await runTest('[POSITIVE] An English video is summarized in English (English instructions, summary_language en)', async () => {
          oll.calls.length = 0; oll.mode = 'good';
          const media = await uploadVideo(TEXT_EN, 'en');
          const done = await waitFor(media.media_id, m => m.summary_status === 'DONE');
          assert.strictEqual(done.summary_status, 'DONE', done.summary_error);
          assert.strictEqual(done.summary_language, 'en');
          assert.strictEqual(done.summary_source, 'AI');
          assert.ok(oll.calls[0].prompt.includes('Summarize the transcript below in English'));
          assert.ok(/mentoring program/i.test(done.summary));
        });

        await runTest('[NEGATIVE] Invented numbers/names are rejected: one retry naming the offending facts, then the rule-based summary (source RULE) - nothing invented is stored', async () => {
          oll.calls.length = 0; oll.mode = 'fabricate';
          const media = await uploadVideo(TEXT_ID);
          const done = await waitFor(media.media_id, m => m.summary_status === 'DONE');
          assert.strictEqual(done.summary_status, 'DONE');
          assert.strictEqual(done.summary_source, 'RULE');
          assert.strictEqual(done.summary_model, null);
          assert.strictEqual(generateCalls(), 2, 'exactly one retry');
          assert.ok(oll.calls[1].prompt.includes('PERBAIKAN') && /2019|350/.test(oll.calls[1].prompt), 'retry prompt names the rejected facts');
          assert.ok(oll.calls[1].prompt.includes('benar-benar ada di transkrip'), 'retry prompt asks for words that are in the transcript');
          assert.ok(/validator/i.test(done.summary_error));
          const stored = `${done.summary} ${done.summary_points.join(' ')}`;
          assert.ok(!/2019|350|Budi|Santoso/.test(stored), 'invented facts must not be stored');
          for (const sentence of done.summary.split(/(?<=[.!?])\s+/)) assert.ok(TEXT_ID.includes(sentence.replace(/…$/, '').trim()), 'rule summary is extracted from the transcript');
        });

        await runTest('[POSITIVE] First answer invented, retry clean: the retry result is used (source AI, 2 calls)', async () => {
          oll.calls.length = 0; oll.mode = 'fabricate-once';
          const media = await uploadVideo(TEXT_ID);
          const done = await waitFor(media.media_id, m => m.summary_status === 'DONE');
          assert.strictEqual(done.summary_source, 'AI');
          assert.strictEqual(generateCalls(), 2);
        });

        await runTest('[NEGATIVE] Ollama off (connection dropped) or model missing: the upload and transcript are unaffected, the summary falls back to rules with a clear reason - no crash', async () => {
          oll.calls.length = 0; oll.mode = 'close';
          const a = await uploadVideo(TEXT_ID);
          const doneA = await waitFor(a.media_id, m => m.summary_status === 'DONE' || m.summary_status === 'FAILED');
          assert.strictEqual(doneA.transcript_status, 'DONE');
          assert.strictEqual(doneA.summary_status, 'DONE');
          assert.strictEqual(doneA.summary_source, 'RULE');
          assert.ok(doneA.summary_error.length > 5, 'reason shown');
          oll.mode = 'missing';
          const b = await uploadVideo(TEXT_ID);
          const doneB = await waitFor(b.media_id, m => m.summary_status === 'DONE' || m.summary_status === 'FAILED');
          assert.strictEqual(doneB.summary_source, 'RULE');
          assert.ok(/ollama pull/i.test(doneB.summary_error), doneB.summary_error);
          assert.strictEqual((await api('/api/health')).status, 200, 'server still alive');
        });

        await runTest('[POSITIVE] A long transcript is summarized part by part (safe context size) and then combined; the final answer is checked against the whole transcript', async () => {
          oll.calls.length = 0; oll.mode = 'good';
          const long = Array(30).fill(TEXT_ID).join(' ');
          const media = await uploadVideo(long);
          const done = await waitFor(media.media_id, m => m.summary_status === 'DONE', 30000);
          assert.strictEqual(done.summary_status, 'DONE', done.summary_error);
          assert.strictEqual(done.summary_source, 'AI');
          assert.ok(generateCalls() >= 3, `expected part calls + combine, got ${generateCalls()}`);
          assert.ok(oll.calls.every(c => c.prompt.length < 7500), 'no single prompt may exceed the safe context size');
          assert.ok(oll.calls[0].prompt.includes('bagian 1 dari'));
        });

        await runTest('[NEGATIVE] A too-short transcript is not sent to the model: INSUFFICIENT, zero calls', async () => {
          oll.calls.length = 0; oll.mode = 'good';
          const media = await uploadVideo(TEXT_SHORT);
          const done = await waitFor(media.media_id, m => m.summary_status);
          assert.strictEqual(done.summary_status, 'INSUFFICIENT');
          assert.ok(/not long enough/i.test(done.summary_error));
          await sleep38(500);
          assert.strictEqual(oll.calls.length, 0);
        });

        await runTest('[POSITIVE] Manual "Buat ulang ringkasan": an event manager can make the summary of an old video (202 PROCESSING -> DONE, exactly one Gemma call)', async () => {
          oll.calls.length = 0; oll.mode = 'good'; oll.delay = 1500;
          const r = await api(`/api/media/${oldVideo.media_id}/summarize`, { method: 'POST' });
          assert.strictEqual(r.status, 202);
          assert.strictEqual((await api(`/api/media/${oldVideo.media_id}/summarize`, { method: 'POST' })).status, 409, 'a second press while PROCESSING/queued is refused');
          assert.strictEqual((await r.json()).media.summary_status, 'PROCESSING');
          const done = await waitFor(oldVideo.media_id, m => m.summary_status === 'DONE');
          oll.delay = 0;
          assert.strictEqual(done.summary_source, 'AI');
          assert.strictEqual(generateCalls(), 1);
        });

        await runTest('[NEGATIVE] Manual summary: non-manager User 403 (zero calls), no login 401, photo 400, unknown 404, transcript not DONE 409', async () => {
          oll.calls.length = 0;
          assert.strictEqual((await api(`/api/media/${oldVideo.media_id}/summarize`, { method: 'POST' }, userCookie)).status, 403);
          assert.strictEqual((await api(`/api/media/${oldVideo.media_id}/summarize`, { method: 'POST' }, null)).status, 401);
          const photo = await upload(TINY_PNG, 'rt38b.png', 'image/png');
          assert.strictEqual((await api(`/api/media/${photo.media.media_id}/summarize`, { method: 'POST' })).status, 400);
          assert.strictEqual((await api('/api/media/does-not-exist/summarize', { method: 'POST' })).status, 404);
          tr.fail = true;
          const bad = await upload(Buffer.from('fake video bytes'), 'rt38-fail.mp4', 'video/mp4');
          const failed = await waitFor(bad.media.media_id, m => m.transcript_status === 'FAILED');
          assert.strictEqual(failed.transcript_status, 'FAILED');
          assert.strictEqual((await api(`/api/media/${bad.media.media_id}/summarize`, { method: 'POST' })).status, 409);
          tr.fail = false;
          await sleep38(500);
          assert.strictEqual(oll.calls.length, 0, 'none of these may reach Ollama');
        });

        await runTest('[POSITIVE] A User with the Signature Program Events menu can READ the summary on the event (v2.49.0: a plain User without it gets 403); the summary carries no respondent identity', async () => {
          assert.strictEqual((await api(`/api/events/${EVENT}`, {}, userCookie)).status, 403);
          const acc = await storage38.getUserByUsername(`rt38u${stamp38}`);
          await storage38.updateUser(acc.user_id, { menu_access: { dashboard: true, explore: true, exit_interview: true, action_library: true, events: true, about: true } });
          try {
            const m = await eventMedia(oldVideo.media_id, userCookie);
            assert.strictEqual(m.summary_status, 'DONE');
            assert.ok(m.summary && m.summary_points.length > 0);
            assert.ok(!/nip|email|password/i.test(JSON.stringify({ s: m.summary, p: m.summary_points })));
          } finally {
            await storage38.updateUser(acc.user_id, { menu_access: null });
          }
        });

        await runTest('[POSITIVE] The PPT is generated from stored data only (still zero Ollama calls with summaries present)', async () => {
          oll.calls.length = 0;
          const ppt = await api(`/api/events/${EVENT}/generate-ppt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
          assert.strictEqual(ppt.status, 200);
          assert.strictEqual(oll.calls.length, 0);
          // slide 5 (media slots): videos with a finished summary come first and the text is clean UTF-8
          const file = await api((await ppt.json()).download_url);
          assert.strictEqual(file.status, 200);
          const zip = await require('jszip').loadAsync(Buffer.from(await file.arrayBuffer()));
          const xml = await zip.file('ppt/slides/slide5.xml').async('string');
          assert.ok(xml.includes('AI summary:'), 'slide 5 must carry the video summary');
          assert.ok(/[Pp]rogram mentoring/.test(xml), 'summary text of the video');
          assert.ok(!/\u00e2\u20ac|\u00c3/.test(xml), 'no mojibake in slide 5');
        });
      } finally {
        if (child) child.kill();
        await sleep38(500);
        for (const id of mediaIds) {
          try { const removed = await storage38.deleteMedia(id); const abs = removed && require('../server/services/transcribeService').resolveUploadPath(removed.file_path); if (abs) require('fs').unlink(abs, () => {}); } catch (_) { /* ignore */ }
        }
        for (const id of userIds) { try { await storage38.deleteUser(id); } catch (_) { /* ignore */ } }
        await new Promise(r => fakeOllama.close(r));
        await new Promise(r => fakeTranscribe.close(r));
      }
    }
  }

  // --- MODULE 40 (v2.30.0): ENGLISH UI TEXT FROM THE BACKEND, ENGLISH OPTION LABELS, 120-MINUTE LIMITS ---
  console.log('\n📦 MODULE 40: English backend messages & option labels, month names, 120-minute AI/transcript limits (Positive & Negative Testing)');
  {
    const seed40 = require('../server/db/seedData');
    const INDONESIAN = /\b(tidak|wajib|salah|harus|ditemukan|silakan|gagal|berhasil|hanya|sudah|belum|diisi|melebihi|terlalu|tersebut)\b/i;
    const call40 = async (method, p, body) => {
      const res = await fetch(`${BASE_URL}${p}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      let json = null; try { json = await res.json(); } catch (_) { /* no body */ }
      return { status: res.status, body: json };
    };

    await runTest('[POSITIVE] The option catalogs in the database no longer carry an Indonesian default label (values untouched)', async () => {
      const s = await (await fetch(`${BASE_URL}/api/settings`)).json();
      for (const key of Object.keys(seed40.LEGACY_OPTION_LABELS)) {
        assert.ok(Array.isArray(s[key]) && s[key].length > 0, `${key} must be served from the database`);
        for (const opt of s[key]) {
          assert.notStrictEqual(opt.label, seed40.LEGACY_OPTION_LABELS[key][opt.value], `${key}.${opt.value} still has the old Indonesian label`);
        }
      }
      // the logic-driving values are exactly the ones the code expects
      assert.deepStrictEqual(s.metric_types.map(o => o.value), ['SURVEY', 'OUTCOME']);
      assert.deepStrictEqual(s.update_frequencies.map(o => o.value), ['MONTHLY', 'ONE_TIME_ANNUAL']);
    });

    await runTest('[POSITIVE] The label top-up replaces ONLY a label that is still exactly the old Indonesian default; an admin edit and every value stay', async () => {
      const key = 'update_frequencies';
      const fresh = seed40.initialAppSettings[key].value;
      const legacy = seed40.LEGACY_OPTION_LABELS[key];
      const upgraded = seed40.upgradeLegacyOptionLabels(key, [
        { value: 'MONTHLY', label: legacy.MONTHLY },                 // old default -> replaced
        { value: 'ONE_TIME_ANNUAL', label: 'My own wording' }         // admin edit -> kept
      ]);
      assert.deepStrictEqual(upgraded, [
        { value: 'MONTHLY', label: fresh.find(o => o.value === 'MONTHLY').label },
        { value: 'ONE_TIME_ANNUAL', label: 'My own wording' }
      ]);
      assert.strictEqual(seed40.upgradeLegacyOptionLabels(key, fresh), null, 'already English: nothing to change');
      assert.strictEqual(seed40.upgradeLegacyOptionLabels(key, [{ value: 'MONTHLY', label: `${legacy.MONTHLY} ` }]), null, 'a near-miss (admin edit) is not touched');
      assert.strictEqual(seed40.upgradeLegacyOptionLabels('event_types', [{ value: 'HYBRID', label: 'x' }]), null, 'catalogs outside the list are never touched');
    });

    await runTest('[NEGATIVE] The label top-up ignores garbage input without throwing', async () => {
      for (const bad of [null, undefined, 'text', 42, {}, [null], [{ value: 'MONTHLY' }]]) {
        assert.doesNotThrow(() => seed40.upgradeLegacyOptionLabels('update_frequencies', bad));
      }
      assert.strictEqual(seed40.upgradeLegacyOptionLabels('does_not_exist', [{ value: 'a', label: 'b' }]), null);
    });

    await runTest('[POSITIVE] month_name is the English month name (the trend X-axis abbreviations are derived client-side from month_code)', async () => {
      const first = (await (await fetch(`${BASE_URL}/api/metrics/trends?mode=MTD&startMonth=01&endMonth=01`)).json()).trends[0];
      assert.strictEqual(first.month_name, 'January');
      assert.ok(/^\d{4}-01$/.test(first.month_code));
      const dec = await (await fetch(`${BASE_URL}/api/metrics/trends?mode=MTD&startYear=2025&startMonth=12&endYear=2025&endMonth=12`)).json();
      assert.strictEqual(dec.trends[0].month_name, 'December');
    });

    await runTest('[NEGATIVE] Common error responses are English, with no Indonesian text left', async () => {
      const probes = [
        await call40('POST', '/api/auth/login', {}),
        await call40('PUT', '/api/admin/settings/px_index_target', { value: 'abc' }),
        await call40('PUT', '/api/admin/settings/no_such_setting', { value: 1 }),
        await call40('PUT', '/api/admin/settings/metric_types', { value: [{ value: 'NEW', label: 'New' }] }),
        await call40('POST', '/api/surveys/upload', {}),
        await call40('POST', '/api/admin/survey-questions/99999', { questions: [] }),
        await call40('POST', '/api/media/does-not-exist/summarize')
      ];
      const loginBad = await realFetch(`${BASE_URL}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'nobody-rt40', password: 'WrongPassword123' }) });
      probes.push({ status: loginBad.status, body: await loginBad.json() });
      const anon = await realFetch(`${BASE_URL}/api/metrics/calculate`);
      probes.push({ status: anon.status, body: await anon.json() });
      for (const p of probes) {
        assert.ok(p.status >= 400 && p.status < 500, `expected a 4xx, got ${p.status}: ${JSON.stringify(p.body)}`);
        const text = String(p.body && p.body.error);
        assert.ok(text && text !== 'undefined', 'an error message is returned');
        assert.ok(!INDONESIAN.test(text), `Indonesian text left in: ${text}`);
      }
    });

    await runTest('[POSITIVE] The transcript and the Gemma summary job limits default to 120 minutes (env can still override)', async () => {
      const MIN120 = 120 * 60 * 1000;
      assert.strictEqual(MIN120, 7200000);
      const ai = require('../server/services/localAiService');
      const tr = require('../server/services/transcribeService');
      const sm = require('../server/services/mediaSummaryService');
      assert.strictEqual(ai.DEFAULT_AI_TIMEOUT_MS, MIN120);
      assert.strictEqual(tr.DEFAULT_TIMEOUT_MS, MIN120);
      if (!process.env.OLLAMA_TIMEOUT_MS) assert.strictEqual(ai.OLLAMA_TIMEOUT_MS, MIN120);
      if (!process.env.TRANSCRIBE_TIMEOUT_MS) assert.strictEqual(tr.TIMEOUT_MS, MIN120);
      if (!process.env.SUMMARY_JOB_TIMEOUT_MS) assert.strictEqual(sm.SUMMARY_JOB_TIMEOUT_MS, MIN120);
    });

    // Public (no-login) pages: the public mode must be known on the very first render, and the Header must survive user === null.
    const fs40 = require('fs');
    const path40 = require('path');
    const readSrc40 = (...p) => fs40.readFileSync(path40.join(__dirname, '..', ...p), 'utf8');
    const loadPublicRoute40 = async () => {
      const code = readSrc40('src', 'utils', 'publicRoute.js');
      return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
    };

    await runTest('[POSITIVE] Public mode is computed synchronously from the URL (?checkin= / ?survey=), so the first render is already the public form', async () => {
      const pr = await loadPublicRoute40();
      assert.deepStrictEqual(pr.getPublicCodes('?checkin=PERSPEKTIF-2024-Q1'), { checkin: 'PERSPEKTIF-2024-Q1', survey: null });
      assert.deepStrictEqual(pr.getPublicCodes('?survey=ABC'), { checkin: null, survey: 'ABC' });
      assert.strictEqual(pr.isPublicRoute('?checkin=X'), true);
      assert.strictEqual(pr.isPublicRoute('?survey=X'), true);
      const app = readSrc40('src', 'App.jsx');
      assert.ok(/useState\(\(\) => getPublicCodes\(\)\.checkin\)/.test(app) && /useState\(\(\) => getPublicCodes\(\)\.survey\)/.test(app), 'public codes must be state initialisers, not set in an effect');
      assert.ok(!/setPublicCheckinCode\(checkin\)|setPublicSurveyCode\(survey\)/.test(app), 'public codes must not be set from an effect after the first render');
      assert.ok(/isPublicRoute\(\)/.test(app), 'App() decides public mode through isPublicRoute');
    });

    await runTest('[NEGATIVE] Normal URLs and empty/unrelated parameters are NOT public pages (the login gate stays in force)', async () => {
      const pr = await loadPublicRoute40();
      for (const s of ['', '?', '?checkin=', '?survey=', '?foo=bar', '?tab=checkin']) {
        assert.strictEqual(pr.isPublicRoute(s), false, `"${s}" must not be public`);
      }
    });

    await runTest('[NEGATIVE] Header never reads user.* unguarded in a way that crashes when user is null (public-mode regression of v2.27.0)', async () => {
      const header = readSrc40('src', 'components', 'Header.jsx');
      // allowed only inside the `{user && (...)}` block; every such line must come after that block starts
      const blockStart = header.split(/\r?\n/).findIndex(l => /\{user && \(/.test(l));
      assert.ok(blockStart >= 0, 'the user card must be wrapped in {user && (...)}');
      const lines = header.split(/\r?\n/);
      lines.forEach((l, i) => {
        if (/(?<![?\w.])user\.(scopes|full_name|username|role)/.test(l)) {
          assert.ok(i > blockStart, `Header.jsx line ${i + 1} reads user.* outside the {user && ...} guard: ${l.trim()}`);
        }
      });
      assert.ok(/user\?\.scopes/.test(header), 'userScopes must use user?.scopes');
    });

    await runTest('[POSITIVE] Leftover Indonesian texts are English: username rule, e-mail password length, ESS description, PPT documentation label', async () => {
      const src = (...p) => readSrc40('server', ...p);
      assert.ok(!/Username\/NIP 3-50 karakter/.test(src('services', 'authService.js')));
      assert.ok(!/Password terlalu panjang/.test(src('services', 'emailSettingsService.js')));
      assert.ok(!/Data ESS merupakan/.test(src('services', 'calculationEngine.js')));
      const ppt = src('services', 'pptGenerator.js');
      assert.ok(!/\[ Dokumentasi #/.test(ppt) && /\[ Documentation #/.test(ppt));
      assert.ok(/replace\(\/\^\(Documentation\|Dokumentasi\)\\s\+\/i, ''\)/.test(ppt), 'PPT strips the old caption prefix like the UI does');
      assert.ok(!/`Dokumentasi \$\{/.test(src('server.js')), 'default media caption must not be Indonesian');
    });
  }

  // --- MODULE 41 (v2.30.1): A FINISHED VIDEO FILE IS RENAMED TO ITS ORIGINAL UPLOAD NAME ---
  // Uploads are stored under a random temporary name (media-<time>-<random>.<ext>). When the whole pipeline of a video is
  // over (transcript + AI summary done, or a final failure) the physical file gets the name it was uploaded with and
  // px_media.file_path follows. Uses real files in server/uploads (every test file carries a unique stamp and is removed),
  // never the real Gemma / Video Extractor (a second backend with in-process fakes). SQL backend only for the in-process part.
  console.log('\n📦 MODULE 41: Video file renamed to its original upload name after the pipeline (Positive & Negative Testing)');
  if (!skipModuleBlock(41)) {
    const fs41 = require('fs');
    const path41 = require('path');
    const st41 = require('../server/db/storage');
    const fileSvc = require('../server/services/mediaFileService');
    const UP = fileSvc.UPLOADS_DIR;
    const EVENT = 'ev-perspektif-2024-q1';
    const stamp41 = Date.now().toString(36);
    const TINY_PNG41 = TINY_PNG;
    const sleep41 = ms => new Promise(r => setTimeout(r, ms));
    const webPath = name => `/uploads/${encodeURIComponent(name)}`;

    await runTest('[POSITIVE] Name rules: basename only, illegal Windows characters removed, reserved names, dots/spaces trimmed, 150-character stem, extension kept or taken from the temporary name', async () => {
      const S = (name, cur = 'media-1-abc.mp4') => fileSvc.sanitizeVideoFileName(name, cur);
      assert.deepStrictEqual(S('Rekaman Tim.mp4'), { stem: 'Rekaman Tim', ext: '.mp4' });
      assert.deepStrictEqual(S('../../x.mp4'), { stem: 'x', ext: '.mp4' });
      assert.deepStrictEqual(S('C:\\Users\\me\\video final.MOV'), { stem: 'video final', ext: '.MOV' });
      assert.deepStrictEqual(S('a:b?<c>"d"|e*.mp4'), { stem: 'abcde', ext: '.mp4' });
      assert.deepStrictEqual(S('CON.mp4'), { stem: '_CON', ext: '.mp4' });
      assert.deepStrictEqual(S('nul.txt.mp4'), { stem: '_nul.txt', ext: '.mp4' });
      assert.deepStrictEqual(S('LPT1.mp4'), { stem: '_LPT1', ext: '.mp4' });
      assert.deepStrictEqual(S('  ..hidden video.. .mp4'), { stem: 'hidden video', ext: '.mp4' });
      assert.deepStrictEqual(S("Tim 'Q1' (final) ünggul #1.webm"), { stem: "Tim 'Q1' (final) ünggul #1", ext: '.webm' });
      assert.deepStrictEqual(S('bad\u0000na\u202eme\n.mp4'), { stem: 'badname', ext: '.mp4' }, 'control and bidi characters are removed');
      const long = fileSvc.sanitizeVideoFileName(`${'a'.repeat(400)}.mp4`, 'media-1-abc.mp4');
      assert.strictEqual(long.stem.length, 150);
      assert.strictEqual(long.ext, '.mp4');
      const cjk = fileSvc.sanitizeVideoFileName(`${'\u4e2d'.repeat(300)}.mp4`, 'media-1-abc.mp4');
      assert.ok(`/uploads/${encodeURIComponent(`${cjk.stem} (999)${cjk.ext}`)}`.length <= 480, 'the URL-encoded path must fit the 500-character column');
      // an unknown / dangerous extension is never kept: the temporary name's video extension is appended
      assert.deepStrictEqual(S('clip.exe'), { stem: 'clip.exe', ext: '.mp4' });
      assert.deepStrictEqual(S('page.html'), { stem: 'page.html', ext: '.mp4' });
      // no known video extension anywhere -> no rename at all (a final name always ends in a video extension)
      assert.strictEqual(S('noext', 'media-1-abc'), null);
      assert.strictEqual(S('evil.html', 'media-1-abc'), null);
      for (const name of ['evil.html', 'clip.exe', 'a.svg', 'x.js', 'a.html.mp4', 'a.mp4.html', 'b.exe.', 'c.php.webm']) {
        const r = S(name);
        assert.ok(r && fileSvc.VIDEO_EXTENSIONS.has(r.ext.toLowerCase()), `${name} -> ${JSON.stringify(r)} must end in a video extension`);
      }
    });

    await runTest('[NEGATIVE] Names with nothing usable left are refused (the random name is kept): empty, dots only, only illegal characters, extension only', async () => {
      for (const bad of ['', '...', '   ', '???.mp4', '<>:|.mp4', '.mp4', '..mp4', '/', '\\', null, undefined]) {
        assert.strictEqual(fileSvc.sanitizeVideoFileName(bad, 'media-1-abc.mp4'), null, JSON.stringify(bad));
      }
    });

    await runTest('[POSITIVE] A UTF-8 name that busboy read as latin1 is repaired; ASCII, already-correct and ambiguous names are never changed', async () => {
      const original = 'Rekaman Tim Ünggul – Año 2026 🎬.mp4';
      assert.strictEqual(fileSvc.repairUploadedName(Buffer.from(original, 'utf8').toString('latin1')), original);
      assert.strictEqual(fileSvc.repairUploadedName('Rekaman Tim.mp4'), 'Rekaman Tim.mp4');
      assert.strictEqual(fileSvc.repairUploadedName('Ünggul.mp4'), 'Ünggul.mp4', 'a correctly decoded name must stay');
      assert.strictEqual(fileSvc.repairUploadedName(original), original, 'characters above U+00FF mean it was decoded correctly already');
      assert.strictEqual(fileSvc.repairUploadedName('caf\u00e9 \u00ff.mp4'), 'caf\u00e9 \u00ff.mp4', 'invalid UTF-8 when re-read stays as it is');
      assert.strictEqual(fileSvc.repairUploadedName(''), '');
      assert.strictEqual(fileSvc.repairUploadedName(undefined), '');
    });

    await runTest('[POSITIVE] /uploads paths are URL-decoded safely; anything outside the uploads folder resolves to null', async () => {
      assert.strictEqual(fileSvc.resolveUploadPath('/uploads/media-1-abc.mp4'), path41.join(UP, 'media-1-abc.mp4'));
      assert.strictEqual(fileSvc.resolveUploadPath(webPath("My Video 'Q1' #1 ünggul.mp4")), path41.join(UP, "My Video 'Q1' #1 ünggul.mp4"));
      assert.strictEqual(fileSvc.resolveUploadPath('/uploads/100%25 done.mp4'), path41.join(UP, '100% done.mp4'));
      for (const bad of [null, '', '/etc/passwd', '/uploads/', '/uploads/..', '/uploads/%2e%2e', '/uploads/a%00b.mp4', 'uploads/x.mp4', '/other/x.mp4']) {
        assert.strictEqual(fileSvc.resolveUploadPath(bad), null, String(bad));
      }
      // traversal tries are cut down to a file name inside the uploads folder - never outside it
      for (const tricky of ['/uploads/../../.env', '/uploads/..%2f..%2fserver.js', '/uploads/..%5c..%5cserver.js']) {
        const abs = fileSvc.resolveUploadPath(tricky);
        assert.ok(abs === null || path41.dirname(abs) === UP, `${tricky} -> ${abs}`);
      }
    });

    await runTest('[POSITIVE] Upload allowlist: only the LAST extension counts; html/exe/svg/js/no extension are not media; every allowed extension is a plain photo/video type', async () => {
      const K = fileSvc.mediaKindOfName;
      for (const n of ['a.mp4', 'a.MOV', 'a.webm', 'a.html.mp4', 'x y (1).mkv', 'ü.m4v']) assert.strictEqual(K(n), 'VIDEO', n);
      for (const n of ['a.jpg', 'a.JPEG', 'a.png', 'a.gif', 'a.webp', 'a.bmp', 'a.avif', 'a.php.png']) assert.strictEqual(K(n), 'IMAGE', n);
      for (const n of ['evil.html', 'clip.exe', 'a.svg', 'a.svgz', 'x.js', 'a.mp4.html', 'a.png.svg', 'noext', '', null, undefined, 'a.mp4 ', 'a.mp4.', '.mp4x', 'a.htm', 'a.xhtml', 'a.shtml', 'a.hta', 'a.bat']) assert.strictEqual(K(n), null, String(n));
      for (const e of [...fileSvc.IMAGE_EXTENSIONS, ...fileSvc.VIDEO_EXTENSIONS]) assert.ok(!['.svg', '.html', '.htm', '.js', '.exe', '.xml'].includes(e), e);
      assert.ok(![...fileSvc.IMAGE_EXTENSIONS].some(e => fileSvc.VIDEO_EXTENSIONS.has(e)), 'an extension is either photo or video');
    });

    await runTest('[POSITIVE] Frontend: MediaCard resets its "file not available" state when file_path changes (renamed video), and the photo/video element is re-created for the new path', async () => {
      const src = fs41.readFileSync(path41.join(__dirname, '..', 'src', 'components', 'EventManager.jsx'), 'utf8');
      const card = src.slice(src.indexOf('function MediaCard('), src.indexOf('function MediaCard(') + 6000);
      assert.ok(/useEffect\(\(\) => \{ setBroken\(false\); \}, \[med\.file_path\]\)/.test(card), 'broken must be reset by an effect keyed on med.file_path');
      assert.ok(/<video\s+key=\{med\.file_path\}/.test(card), '<video> must be keyed by file_path');
      assert.ok(/<img\s+key=\{med\.file_path\}/.test(card), '<img> must be keyed by file_path');
      // the error handlers still exist: a seed photo that was never on disk keeps showing "File not available" (its path never changes -> no reload loop)
      assert.strictEqual((card.match(/onError=\{\(\) => setBroken\(true\)\}/g) || []).length, 2);
      assert.ok(/File not available on the server/.test(card));
      assert.ok(!/accept="image\/\*,video\/\*"/.test(src), 'the file picker must not offer SVG through image/*');
    });

    if (st41.backend !== 'sql') {
      console.log('  ⏭️  SKIP: Module 41 file/pipeline tests need the SQL backend (they use the database directly and a second backend)');
      await runTest('[POSITIVE] Both storage backends allow updateMedia to change file_path (and only through that whitelist)', async () => {
        const read = f => fs41.readFileSync(path41.join(__dirname, '..', 'server', 'db', f), 'utf8');
        assert.ok(/setIf\('file_path'/.test(read('sqlStorage.js')));
        assert.ok(/'caption', 'file_path'/.test(read('jsonStorage.js')));
      });
    } else {
      const http41 = require('http');
      const { spawn } = require('child_process');
      const crypto41 = require('crypto');
      const auth41 = require('../server/services/authService');
      const aiQueue41 = require('../server/services/aiQueue');
      const ids = new Set();
      const userIds = [];
      let child = null;
      let seq = 0;
      const before = new Set(fs41.readdirSync(UP));

      // A video record + a real (tiny) file under a temporary media-... name, in the given pipeline state.
      const DONE_AI = { transcript_status: 'DONE', transcript: 'x', summary_status: 'DONE', summary_source: 'AI' };
      const DONE_RULE = { transcript_status: 'DONE', transcript: 'x', summary_status: 'DONE', summary_source: 'RULE' };
      const INSUFFICIENT = { transcript_status: 'DONE', transcript: 'x', summary_status: 'INSUFFICIENT' };
      const SUMMARY_FAILED = { transcript_status: 'DONE', transcript: 'x', summary_status: 'FAILED' };
      const TRANSCRIPT_FAILED = { transcript_status: 'FAILED' };
      const mkVideo = async (name, state, { create = true, type = 'VIDEO', bytes } = {}) => {
        const tmp = `media-rt41-${stamp41}-${++seq}.mp4`;
        const abs = path41.join(UP, tmp);
        if (create) fs41.writeFileSync(abs, bytes || `bytes of ${tmp}`);
        const m = await st41.addMedia({ event_id: EVENT, file_name: name, file_path: `/uploads/${tmp}`, file_type: type, caption: 'rt41', transcript_status: 'DONE' });
        ids.add(m.media_id);
        await st41.updateMedia(m.media_id, state);
        return { id: m.media_id, tmp, abs, content: bytes || `bytes of ${tmp}` };
      };
      const current = async v => await st41.getMediaById(v.id);
      const diskPath = async v => fileSvc.resolveUploadPath((await current(v)).file_path);

      try {
        for (const [label, state] of [['summary DONE (AI)', DONE_AI], ['summary DONE (RULE)', DONE_RULE], ['summary INSUFFICIENT', INSUFFICIENT], ['summary FAILED', SUMMARY_FAILED], ['transcript FAILED', TRANSCRIPT_FAILED]]) {
          await runTest(`[POSITIVE] Final state "${label}": the file is renamed to the original upload name, file_path follows (URL-encoded), content intact, served with 200`, async () => {
            const name = `rt41-${stamp41} Video Tim (final) 'Q1' ünggul #${++seq}.mp4`;
            const v = await mkVideo(name, state);
            const r = await fileSvc.finalizeMediaFileName(v.id);
            assert.strictEqual(r.renamed, true, JSON.stringify(r));
            const m = await current(v);
            assert.strictEqual(m.file_path, webPath(name));
            assert.ok(!fs41.existsSync(v.abs), 'the temporary file must be gone');
            assert.strictEqual(fs41.readFileSync(path41.join(UP, name), 'utf8'), v.content);
            assert.strictEqual(await diskPath(v), path41.join(UP, name));
            const served = await fetch(`${BASE_URL}${m.file_path}`);
            assert.strictEqual(served.status, 200, 'the static route must serve spaces, quotes, # and unicode');
            assert.strictEqual(await served.text(), v.content);
          });
        }

        await runTest('[POSITIVE] Idempotent: a second call changes nothing', async () => {
          const name = `rt41-${stamp41} idempotent.mp4`;
          const v = await mkVideo(name, DONE_AI);
          assert.strictEqual((await fileSvc.finalizeMediaFileName(v.id)).renamed, true);
          const again = await fileSvc.finalizeMediaFileName(v.id);
          assert.strictEqual(again.renamed, false);
          assert.strictEqual(again.reason, 'already-named');
          assert.strictEqual((await current(v)).file_path, webPath(name));
          assert.ok(fs41.existsSync(path41.join(UP, name)));
          assert.strictEqual(fs41.readdirSync(UP).filter(f => f.includes(`idempotent`) && f.includes(stamp41)).length, 1, 'no extra copy / suffix');
        });

        await runTest('[NEGATIVE] Never while the pipeline is not final: transcript PROCESSING, summary PROCESSING, summary not made yet (old video), photo, summary job queued/running', async () => {
          const cases = [
            ['transcript-processing', { transcript_status: 'PROCESSING' }, 'VIDEO'],
            ['summary-processing', { transcript_status: 'DONE', transcript: 'x', summary_status: 'PROCESSING' }, 'VIDEO'],
            ['old-video-no-summary', { transcript_status: 'DONE', transcript: 'x' }, 'VIDEO'],
            ['no-transcript-status', { transcript_status: null }, 'VIDEO'],
            ['photo', { transcript_status: null }, 'IMAGE']
          ];
          for (const [label, state, type] of cases) {
            const v = await mkVideo(`rt41-${stamp41} ${label}.mp4`, state, { type });
            const r = await fileSvc.finalizeMediaFileName(v.id);
            assert.strictEqual(r.renamed, false, label);
            assert.strictEqual((await current(v)).file_path, `/uploads/${v.tmp}`, label);
            assert.ok(fs41.existsSync(v.abs), `${label}: file must stay`);
          }
          // a summary job that is queued or running in this process blocks the rename even when the record already says DONE
          const v = await mkVideo(`rt41-${stamp41} queued.mp4`, DONE_AI);
          let release;
          assert.strictEqual(aiQueue41.enqueue(`media:${v.id}`, () => new Promise(r => { release = r; })), 'queued');
          await sleep41(50);
          const busy = await fileSvc.finalizeMediaFileName(v.id);
          assert.deepStrictEqual([busy.renamed, busy.reason], [false, 'busy']);
          assert.ok(fs41.existsSync(v.abs));
          release();
          await sleep41(100);
          assert.strictEqual((await fileSvc.finalizeMediaFileName(v.id)).renamed, true, 'free again once the job is over');
          // ... but the job's own last step may call it while it is still "running"
          const w = await mkVideo(`rt41-${stamp41} self.mp4`, DONE_AI);
          let done;
          const finished = new Promise(r => { done = r; });
          aiQueue41.enqueue(`media:${w.id}`, async () => { done(await fileSvc.finalizeMediaFileName(w.id, { ignoreSummaryJob: true })); });
          assert.strictEqual((await finished).renamed, true);
        });

        await runTest('[POSITIVE] Name collision: an existing file is never overwritten - " (1)", " (2)" are added; two jobs finishing together get different names', async () => {
          const base = `rt41-${stamp41} same name`;
          fs41.writeFileSync(path41.join(UP, `${base}.mp4`), 'UNRELATED FILE');     // not a media record at all
          const a = await mkVideo(`${base}.mp4`, DONE_AI);
          const b = await mkVideo(`${base}.mp4`, DONE_RULE);
          const c = await mkVideo(`${base}.mp4`, INSUFFICIENT);
          const results = await Promise.all([a, b, c].map(v => fileSvc.finalizeMediaFileName(v.id)));
          assert.ok(results.every(r => r.renamed), JSON.stringify(results));
          const names = [];
          for (const v of [a, b, c]) names.push(path41.basename(await diskPath(v)));
          assert.deepStrictEqual([...names].sort(), [`${base} (1).mp4`, `${base} (2).mp4`, `${base} (3).mp4`]);
          assert.strictEqual(fs41.readFileSync(path41.join(UP, `${base}.mp4`), 'utf8'), 'UNRELATED FILE', 'the existing file is untouched');
          for (const v of [a, b, c]) assert.strictEqual(fs41.readFileSync(await diskPath(v), 'utf8'), v.content, 'each video keeps its own bytes');
        });

        await runTest('[NEGATIVE] A name another record already points to (its file missing) is not reused; case differences count as the same name on Windows', async () => {
          const base = `rt41-${stamp41} claimed`;
          const ghost = await mkVideo(`${base}.mp4`, DONE_AI, { create: false });   // record only, no file
          await st41.updateMedia(ghost.id, { file_path: webPath(`${base}.mp4`) });
          const v = await mkVideo(`${base}.mp4`, DONE_AI);
          assert.strictEqual((await fileSvc.finalizeMediaFileName(v.id)).renamed, true);
          assert.strictEqual(path41.basename(await diskPath(v)), `${base} (1).mp4`);
          if (process.platform === 'win32') {
            fs41.writeFileSync(path41.join(UP, `${base} CASE.mp4`), 'OTHER');
            const w = await mkVideo(`${base} case.mp4`, DONE_AI);
            assert.strictEqual((await fileSvc.finalizeMediaFileName(w.id)).renamed, true);
            assert.strictEqual(fs41.readFileSync(path41.join(UP, `${base} CASE.mp4`), 'utf8'), 'OTHER');
            assert.notStrictEqual(path41.basename(await diskPath(w)).toLowerCase(), `${base} case.mp4`.toLowerCase());
          }
        });

        await runTest('[NEGATIVE] Dangerous original names stay inside server/uploads and follow the name rules (../../x.mp4, a:b?.mp4, CON.mp4, 400-character name, only-illegal name)', async () => {
          const outside = path41.join(UP, '..', `rt41-${stamp41}-escape.mp4`);
          const long = `rt41-${stamp41} ${'L'.repeat(400)}.mp4`;
          const cases = [
            [`../../rt41-${stamp41}-escape.mp4`, `rt41-${stamp41}-escape.mp4`],
            [`a:b?${stamp41}.mp4`, `ab${stamp41}.mp4`],
            [`..\\..\\rt41-${stamp41}-win.mp4`, `rt41-${stamp41}-win.mp4`],
            ['CON.mp4', '_CON.mp4'],
            [long, `${long.slice(0, 150)}.mp4`]
          ];
          for (const [original, expected] of cases) {
            const v = await mkVideo(original, DONE_AI);
            const r = await fileSvc.finalizeMediaFileName(v.id);
            assert.strictEqual(r.renamed, true, `${original}: ${JSON.stringify(r)}`);
            const abs = await diskPath(v);
            assert.strictEqual(path41.dirname(abs), UP, `${original} must stay in the uploads folder`);
            assert.strictEqual(path41.basename(abs), expected);
            assert.ok(fs41.existsSync(abs));
          }
          assert.ok(!fs41.existsSync(outside), 'nothing may be written outside server/uploads');
          const bad = await mkVideo('???.mp4', DONE_AI);
          const rb = await fileSvc.finalizeMediaFileName(bad.id);
          assert.deepStrictEqual([rb.renamed, rb.reason], [false, 'no-usable-name']);
          assert.strictEqual((await current(bad)).file_path, `/uploads/${bad.tmp}`);
        });

        await runTest('[NEGATIVE] File missing on disk: no error, nothing renamed, the record is left as it was', async () => {
          const v = await mkVideo(`rt41-${stamp41} missing.mp4`, DONE_AI, { create: false });
          const r = await fileSvc.finalizeMediaFileName(v.id);
          assert.deepStrictEqual([r.renamed, r.reason], [false, 'missing-file']);
          assert.strictEqual((await current(v)).file_path, `/uploads/${v.tmp}`);
          const none = await fileSvc.finalizeMediaFileName('med-does-not-exist');
          assert.strictEqual(none.renamed, false);
        });

        await runTest('[NEGATIVE] Rename refused by the OS (EPERM/EACCES): warning only, file_path unchanged; a short EBUSY is retried once and then succeeds', async () => {
          const warn = console.warn; console.warn = () => {};
          const realRename = fs41.promises.rename;
          try {
            const v = await mkVideo(`rt41-${stamp41} locked.mp4`, DONE_AI);
            fs41.promises.rename = async () => { const e = new Error('EPERM: operation not permitted'); e.code = 'EPERM'; throw e; };
            const r = await fileSvc.finalizeMediaFileName(v.id);
            assert.strictEqual(r.renamed, false);
            assert.strictEqual((await current(v)).file_path, `/uploads/${v.tmp}`);
            assert.ok(fs41.existsSync(v.abs));
            let calls = 0;
            fs41.promises.rename = async (a, b) => { if (++calls === 1) { const e = new Error('EBUSY'); e.code = 'EBUSY'; throw e; } return realRename(a, b); };
            const retried = await fileSvc.finalizeMediaFileName(v.id);
            assert.strictEqual(retried.renamed, true, JSON.stringify(retried));
            assert.strictEqual(calls, 2);
            assert.ok(fs41.existsSync(await diskPath(v)));
          } finally { fs41.promises.rename = realRename; console.warn = warn; }
        });

        await runTest('[NEGATIVE] Database update fails after the rename: the file name is restored, the record never points to a missing file', async () => {
          const warn = console.warn; console.warn = () => {};
          const realUpdate = st41.updateMedia;
          try {
            const v = await mkVideo(`rt41-${stamp41} rollback.mp4`, DONE_AI);
            st41.updateMedia = async () => { throw new Error('simulated database failure'); };
            const r = await fileSvc.finalizeMediaFileName(v.id);
            st41.updateMedia = realUpdate;
            assert.strictEqual(r.renamed, false);
            assert.ok(fs41.existsSync(v.abs), 'the temporary name is back');
            assert.ok(!fs41.existsSync(path41.join(UP, `rt41-${stamp41} rollback.mp4`)));
            assert.strictEqual((await current(v)).file_path, `/uploads/${v.tmp}`);
            assert.strictEqual((await fileSvc.finalizeMediaFileName(v.id)).renamed, true, 'a later call works normally');
          } finally { st41.updateMedia = realUpdate; console.warn = warn; }
        });

        await runTest('[POSITIVE] Deleting a renamed video removes the file under its NEW name; deleting a never-renamed one still works', async () => {
          const v = await mkVideo(`rt41-${stamp41} to delete.mp4`, DONE_AI);
          await fileSvc.finalizeMediaFileName(v.id);
          const abs = await diskPath(v);
          assert.ok(fs41.existsSync(abs));
          const removed = await fileSvc.deleteMediaAndFile(v.id);
          assert.ok(removed);
          assert.ok(!fs41.existsSync(abs), 'renamed file removed');
          assert.strictEqual(await st41.getMediaById(v.id), null);
          const w = await mkVideo(`rt41-${stamp41} not renamed.mp4`, { transcript_status: 'PROCESSING' });
          await fileSvc.deleteMediaAndFile(w.id);
          assert.ok(!fs41.existsSync(w.abs));
          assert.strictEqual(await fileSvc.deleteMediaAndFile('med-does-not-exist'), null);
        });

        // ------------------------------------------------------------ end-to-end through a second backend (fake Ollama + fake Video Extractor)
        const EVENT_ID = EVENT;
        const TEXT_ID = 'Hari ini kami membahas program mentoring untuk karyawan baru di kantor pusat. Setiap mentor mendampingi peserta selama enam bulan pertama, bertemu secara rutin, dan membantu mereka memahami budaya kerja. Peserta merasa lebih percaya diri setelah mengikuti sesi tersebut dan ingin program ini diteruskan.';
        const GOOD_ID = 'RINGKASAN: Program mentoring untuk karyawan baru di kantor pusat dibahas. Mentor mendampingi peserta selama enam bulan pertama dan membantu mereka memahami budaya kerja. Peserta merasa lebih percaya diri dan ingin program diteruskan.\n\nPOIN:\n- Program mentoring untuk karyawan baru di kantor pusat.\n- Mentor mendampingi peserta dan bertemu secara rutin.\n- Peserta ingin program ini diteruskan.';
        const oll = { calls: 0, delay: 0 };
        const fakeOllama = http41.createServer((req, res) => {
          req.resume();
          req.on('end', () => {
            oll.calls++;
            res.setHeader('Content-Type', 'application/json');
            setTimeout(() => res.end(JSON.stringify({ response: GOOD_ID, done: true })), oll.delay);
          });
        });
        const tr = { text: TEXT_ID, fail: false, sources: [], delay: 0 };
        const fakeTranscribe = http41.createServer((req, res) => {
          const chunks = [];
          req.on('data', c => chunks.push(c));
          req.on('end', () => {
            res.setHeader('Content-Type', 'application/json');
            if (req.method === 'POST' && req.url === '/transcribe') {
              let body = {}; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) { /* ignore */ }
              tr.sources.push(body.source);
              return setTimeout(() => {
                if (tr.fail) { res.statusCode = 500; return res.end('{"detail":"boom"}'); }
                res.end(JSON.stringify({ text: tr.text, language: 'id', duration: 30, segments: [{ start: 0, end: 30, text: tr.text }] }));
              }, tr.delay);
            }
            res.end('{"status":"ok"}');
          });
        });
        const listen = srv => new Promise(resolve => srv.listen(0, '127.0.0.1', () => resolve(srv.address().port)));
        const ollamaPort = await listen(fakeOllama);
        const trPort = await listen(fakeTranscribe);
        const freePort = await (async () => { const s = http41.createServer(); const p = await listen(s); await new Promise(r => s.close(r)); return p; })();
        const CHILD = `http://127.0.0.1:${freePort}`;
        const pw = crypto41.randomBytes(9).toString('hex') + 'Aa1';
        const cookieOf = r => (r.headers.getSetCookie() || []).map(c => c.split(';')[0]).find(c => c.startsWith('px_session='));
        let cookie = null;
        const api = (p, opts = {}) => realFetch(`${CHILD}${p}`, { ...opts, headers: { ...(opts.headers || {}), ...(cookie ? { Cookie: cookie } : {}) } });
        const eventMedia = async id => (await (await api(`/api/events/${EVENT_ID}`)).json()).media.find(m => m.media_id === id);
        const waitFor = async (id, pred, ms = 20000) => {
          for (let i = 0; i < ms / 200; i++) { const m = await eventMedia(id); if (m && pred(m)) return m; await sleep41(200); }
          return await eventMedia(id);
        };
        const upload = async (name, mime = 'video/mp4') => {
          const form = new FormData();
          form.append('mediaFile', new Blob([Buffer.from(`video bytes ${name}`)], { type: mime }), name);
          const res = await api(`/api/events/${EVENT_ID}/media`, { method: 'POST', body: form });
          const body = await res.json();
          if (body.media) ids.add(body.media.media_id);
          return { res, media: body.media };
        };
        const renamedTo = (m, name) => m.file_path === webPath(name);

        // An interrupted summary exists BEFORE the second backend boots: with PX_DISABLE_RESUME=1 it must not be touched.
        const interrupted = await mkVideo(`rt41-${stamp41} interrupted.mp4`, { transcript_status: 'DONE', transcript: TEXT_ID, transcript_language: 'id', summary_status: 'PROCESSING' });
        // An "old" video: finished long ago, still under its random name.
        const oldVideo = await mkVideo(`rt41-${stamp41} old video.mp4`, { transcript_status: 'DONE', transcript: TEXT_ID, transcript_language: 'id', summary_status: 'DONE', summary_source: 'AI', summary: 'x'.repeat(50), summary_points: ['a', 'b'] });
        try {
          const u = await st41.createUser({ is_test_account: true, username: `rt41a${stamp41}`, full_name: 'Regression 41', email: '', role: 'ADMIN', password_hash: await auth41.hashPassword(pw), must_change_password: false });
          userIds.push(u.user_id);
          child = spawn(process.execPath, [path41.join(__dirname, '..', 'server', 'server.js')], {
            cwd: path41.join(__dirname, '..'),
            env: { ...process.env, PORT: String(freePort), OLLAMA_HOST: `http://127.0.0.1:${ollamaPort}`, OLLAMA_MODEL: 'gemma3:4b', TRANSCRIBE_API_URL: `http://127.0.0.1:${trPort}`, PX_DISABLE_SCHEDULERS: '1', PX_DISABLE_RESUME: '1' },
            stdio: 'ignore'
          });
          let booted = false;
          for (let i = 0; i < 120 && !booted; i++) { try { booted = (await realFetch(`${CHILD}/api/health`)).ok; } catch (_) { await sleep41(500); } }
          assert.ok(booted, 'second backend did not start');
          const login = await realFetch(`${CHILD}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u.username, password: pw }) });
          assert.strictEqual(login.status, 200);
          cookie = cookieOf(login);
          await sleep41(1500);

          await runTest('[POSITIVE] PX_DISABLE_RESUME=1: a second backend does not take over a video that is being processed (no Ollama call, status untouched)', async () => {
            assert.strictEqual(oll.calls, 0);
            assert.strictEqual((await current(interrupted)).summary_status, 'PROCESSING');
            assert.strictEqual((await current(interrupted)).file_path, `/uploads/${interrupted.tmp}`);
            assert.ok(fs41.existsSync(interrupted.abs));
          });

          await runTest('[POSITIVE] A page load / opening the event / listing events never renames an old video (GET is read-only)', async () => {
            for (const p of ['/api/events', `/api/events/${EVENT_ID}`, '/api/metrics/calculate', '/api/alerts', '/api/health']) assert.strictEqual((await api(p)).status, 200, p);
            await sleep41(300);
            assert.strictEqual((await current(oldVideo)).file_path, `/uploads/${oldVideo.tmp}`);
            assert.ok(fs41.existsSync(oldVideo.abs));
          });

          await runTest('[POSITIVE] New video end to end: the temporary name is kept while the transcript and the AI summary run, then the file takes the uploaded name', async () => {
            tr.text = TEXT_ID; tr.fail = false; tr.delay = 600; oll.delay = 2000;
            const name = `rt41-${stamp41} e2e ünggul (1).mp4`;
            const up = await upload(name);
            assert.strictEqual(up.res.status, 201);
            assert.strictEqual(up.media.file_name, name);
            assert.ok(/^\/uploads\/media-\d+-[a-z0-9]+\.mp4$/.test(up.media.file_path), `temporary name expected, got ${up.media.file_path}`);
            const tmpAbs = fileSvc.resolveUploadPath(up.media.file_path);
            const mid1 = await waitFor(up.media.media_id, m => m.transcript_status === 'DONE' && m.summary_status === 'PROCESSING', 8000);
            assert.strictEqual(mid1.summary_status, 'PROCESSING');
            assert.strictEqual(mid1.file_path, up.media.file_path, 'no rename while the summary is processing');
            assert.ok(fs41.existsSync(tmpAbs));
            const done = await waitFor(up.media.media_id, m => m.summary_status === 'DONE' && m.file_path !== up.media.file_path);
            tr.delay = 0; oll.delay = 0;
            assert.strictEqual(done.summary_status, 'DONE');
            assert.ok(renamedTo(done, name), `file_path ${done.file_path}`);
            assert.ok(!fs41.existsSync(tmpAbs));
            assert.ok(fs41.existsSync(path41.join(UP, name)));
            // v2.30.2: the Extractor gets a hard link (outside server/uploads) that carries the uploaded name, not the random temporary name
            const sentSource = tr.sources[tr.sources.length - 1];
            assert.strictEqual(path41.basename(sentSource), name, 'the Video Extractor was given the original upload name');
            assert.notStrictEqual(path41.dirname(path41.resolve(sentSource)), UP, 'the named link must not be in server/uploads');
            assert.ok(!path41.basename(sentSource).startsWith('media-'));
            const served = await api(done.file_path);
            assert.strictEqual(served.status, 200);
          });

          await runTest('[POSITIVE] Mojibake-proof: a UTF-8 file name is stored and used as written (file_name and the renamed file)', async () => {
            const name = `rt41-${stamp41} Tim Ünggul – Año.mp4`;
            const up = await upload(name);
            assert.strictEqual(up.media.file_name, name);
            const done = await waitFor(up.media.media_id, m => m.summary_status === 'DONE' && m.file_path !== up.media.file_path);
            assert.ok(renamedTo(done, name), done.file_path);
            assert.ok(fs41.readdirSync(UP).includes(name));
          });

          await runTest('[POSITIVE] Two uploads with the same name at the same time are both safe: random temporary names, final names differ (" (1)")', async () => {
            const name = `rt41-${stamp41} twin.mp4`;
            const [a, b] = await Promise.all([upload(name), upload(name)]);
            assert.notStrictEqual(a.media.file_path, b.media.file_path);
            const [da, db] = await Promise.all([a, b].map(x => waitFor(x.media.media_id, m => m.summary_status === 'DONE' && m.file_path !== x.media.file_path)));
            assert.deepStrictEqual([da.file_path, db.file_path].sort(), [webPath(name), webPath(`rt41-${stamp41} twin (1).mp4`)].sort());
            assert.ok(fs41.existsSync(path41.join(UP, name)) && fs41.existsSync(path41.join(UP, `rt41-${stamp41} twin (1).mp4`)));
          });

          await runTest('[POSITIVE] A too-short transcript (INSUFFICIENT, no Gemma call) also ends with the original name', async () => {
            tr.text = 'Halo semuanya terima kasih.';
            const before = oll.calls;
            const name = `rt41-${stamp41} short.mp4`;
            const up = await upload(name);
            const done = await waitFor(up.media.media_id, m => m.summary_status === 'INSUFFICIENT' && m.file_path !== up.media.file_path);
            tr.text = TEXT_ID;
            assert.strictEqual(done.summary_status, 'INSUFFICIENT');
            assert.ok(renamedTo(done, name), done.file_path);
            assert.strictEqual(oll.calls, before);
          });

          await runTest('[POSITIVE] Transcript FAILED is final: the file is renamed, and "Try again" then uses the NEW path and completes normally', async () => {
            tr.fail = true;
            const name = `rt41-${stamp41} failed first.mp4`;
            const up = await upload(name);
            const failed = await waitFor(up.media.media_id, m => m.transcript_status === 'FAILED' && m.file_path !== up.media.file_path);
            assert.strictEqual(failed.transcript_status, 'FAILED');
            assert.ok(renamedTo(failed, name), failed.file_path);
            assert.ok(fs41.existsSync(path41.join(UP, name)));
            tr.fail = false; tr.text = TEXT_ID;
            const retry = await api(`/api/media/${up.media.media_id}/transcribe`, { method: 'POST' });
            assert.strictEqual(retry.status, 202);
            const done = await waitFor(up.media.media_id, m => m.summary_status === 'DONE');
            assert.strictEqual(done.transcript_status, 'DONE');
            // v2.30.2: "Try again" sends a named hard link to the (renamed) file; same file name, folder outside server/uploads
            assert.strictEqual(path41.basename(tr.sources[tr.sources.length - 1]), name, 'Try again must send the file under its original name');
            assert.ok(renamedTo(done, name));
            assert.ok(fs41.existsSync(path41.join(UP, name)));
          });

          await runTest('[POSITIVE] Manual "Regenerate summary" on an old video is an explicit action: when it finishes the old random name becomes the original name', async () => {
            const before = oll.calls;
            const r = await api(`/api/media/${oldVideo.id}/summarize`, { method: 'POST' });
            assert.strictEqual(r.status, 202);
            const done = await waitFor(oldVideo.id, m => m.summary_status === 'DONE' && m.file_path !== `/uploads/${oldVideo.tmp}`);
            assert.ok(renamedTo(done, `rt41-${stamp41} old video.mp4`), done.file_path);
            assert.ok(!fs41.existsSync(oldVideo.abs));
            assert.strictEqual(oll.calls, before + 1);
          });

          await runTest('[POSITIVE] DELETE /api/media/:id removes the renamed file from disk', async () => {
            const name = `rt41-${stamp41} api delete.mp4`;
            const up = await upload(name);
            const done = await waitFor(up.media.media_id, m => m.summary_status === 'DONE' && m.file_path !== up.media.file_path);
            const abs = fileSvc.resolveUploadPath(done.file_path);
            assert.ok(fs41.existsSync(abs));
            assert.strictEqual((await api(`/api/media/${up.media.media_id}`, { method: 'DELETE' })).status, 200);
            await sleep41(200);
            assert.ok(!fs41.existsSync(abs));
            assert.strictEqual(await eventMedia(up.media.media_id), undefined);
          });

          const rawUpload = async (name, mime, content = '<script>alert(1)</script>') => {
            const form = new FormData();
            form.append('mediaFile', new Blob([content], { type: mime }), name);
            const res = await api(`/api/events/${EVENT_ID}/media`, { method: 'POST', body: form });
            const body = await res.json().catch(() => ({}));
            if (body.media) ids.add(body.media.media_id);
            return { res, body };
          };
          const allMediaIds = async () => new Set((await st41.getAllMedia()).map(m => m.media_id));

          await runTest('[NEGATIVE] Dangerous uploads are refused with 415 and NOTHING is stored: evil.html / clip.exe / x.js sent as video/mp4 or image/png, SVG (any MIME), no extension, MIME vs extension mismatch, an illegal extension (.m<p4)', async () => {
            const filesBefore = new Set(fs41.readdirSync(UP));
            const mediaBefore = await allMediaIds();
            const cases = [
              ['evil.html', 'video/mp4'], ['evil.html', 'image/png'], ['evil.html', 'text/html'], ['clip.exe', 'video/mp4'], ['x.js', 'video/mp4'],
              ['EVIL.HTM', 'video/mp4'], ['x.svg', 'image/svg+xml'], ['x.svg', 'image/png'], ['x.png', 'image/svg+xml'], ['x.svg', 'video/mp4'],
              ['video', 'video/mp4'], ['a.mp4.html', 'video/mp4'], ['photo.png', 'video/mp4'], ['clip.mp4', 'image/png'], ['x.mp4', 'application/octet-stream'],
              ['odd.m<p4', 'video/mp4']
            ];
            for (const [name, mime] of cases) {
              const { res, body } = await rawUpload(`rt41-${stamp41} ${name}`, mime);
              assert.strictEqual(res.status, 415, `${name} as ${mime} -> ${res.status}`);
              assert.ok(body.error && /SVG|format/i.test(body.error));
            }
            assert.deepStrictEqual(fs41.readdirSync(UP).filter(f => !filesBefore.has(f)), [], 'no file may be written for a refused upload');
            assert.deepStrictEqual([...(await allMediaIds())].filter(id => !mediaBefore.has(id)), [], 'no media record may be created for a refused upload');
          });

          await runTest('[POSITIVE] Normal MP4 and JPG still upload (201), the stored names keep their allowlisted extension, illegal characters in the stem are dropped from the final name, the JPG is served as an image', async () => {
            const v = await rawUpload(`rt41-${stamp41} odd<x.MP4`, 'video/mp4', 'video bytes');
            assert.strictEqual(v.res.status, 201);
            assert.strictEqual(v.body.media.file_type, 'VIDEO');
            assert.ok(/^\/uploads\/media-\d+-[a-z0-9]+\.mp4$/.test(v.body.media.file_path), v.body.media.file_path);
            const p = await rawUpload(`rt41-${stamp41} photo.JPG`, 'image/jpeg', TINY_PNG41);
            assert.strictEqual(p.res.status, 201);
            assert.strictEqual(p.body.media.file_type, 'IMAGE');
            assert.ok(/\.jpg$/.test(p.body.media.file_path), p.body.media.file_path);
            const served = await api(p.body.media.file_path);
            assert.strictEqual(served.status, 200);
            assert.ok((served.headers.get('content-type') || '').startsWith('image/'));
            const done = await waitFor(v.body.media.media_id, m => m.summary_status === 'DONE' && m.file_path !== v.body.media.file_path);
            assert.ok(renamedTo(done, `rt41-${stamp41} oddx.MP4`), done.file_path);
          });

          await runTest('[POSITIVE] A double extension is allowed when the LAST one is video (a.html.mp4): stored as .mp4 and the final name keeps ".html" inside the name, never as the extension', async () => {
            const name = `rt41-${stamp41} a.html.mp4`;
            const up = await upload(name);
            assert.strictEqual(up.res.status, 201);
            assert.ok(/^\/uploads\/media-\d+-[a-z0-9]+\.mp4$/.test(up.media.file_path), up.media.file_path);
            const done = await waitFor(up.media.media_id, m => m.summary_status === 'DONE' && m.file_path !== up.media.file_path);
            assert.ok(renamedTo(done, name), done.file_path);
            assert.ok(/\.mp4$/.test(path41.basename(fileSvc.resolveUploadPath(done.file_path))));
            const served = await api(done.file_path);
            assert.strictEqual(served.status, 200);
            assert.ok((served.headers.get('content-type') || '').startsWith('video/'), served.headers.get('content-type'));
          });

          await runTest('[POSITIVE] /uploads headers: nosniff + sandbox CSP on every file; a non-allowlisted file (legacy .html) is only offered as a download; a video keeps range requests (206) and is not an attachment; no session = 401', async () => {
            const htmlName = `media-rt41-${stamp41}-legacy.html`;
            fs41.writeFileSync(path41.join(UP, htmlName), '<script>alert(1)</script>');
            const h = await api(`/uploads/${htmlName}`);
            assert.strictEqual(h.status, 200);
            assert.strictEqual(h.headers.get('x-content-type-options'), 'nosniff');
            assert.ok(/sandbox/.test(h.headers.get('content-security-policy') || ''));
            assert.ok(/^attachment/.test(h.headers.get('content-disposition') || ''), 'a non-media file must be a download');
            await h.text();
            const vid = await mkVideo(`rt41-${stamp41} range.mp4`, DONE_AI, { bytes: '0123456789abcdef' });
            const r = await api(`/uploads/${vid.tmp}`, { headers: { Range: 'bytes=2-5' } });
            assert.strictEqual(r.status, 206);
            assert.strictEqual(await r.text(), '2345');
            assert.strictEqual(r.headers.get('content-disposition'), null);
            assert.strictEqual(r.headers.get('x-content-type-options'), 'nosniff');
            const anon = await realFetch(`${CHILD}/uploads/${vid.tmp}`);
            assert.strictEqual(anon.status, 401);
          });
        } finally {
          if (child) child.kill();
          await sleep41(500);
          await new Promise(r => fakeOllama.close(r));
          await new Promise(r => fakeTranscribe.close(r));
        }
      } finally {
        for (const id of ids) { try { await fileSvc.deleteMediaAndFile(id); } catch (_) { /* ignore */ } }
        for (const id of userIds) { try { await st41.deleteUser(id); } catch (_) { /* ignore */ } }
        // every file this module made carries the stamp; nothing else in server/uploads is touched
        for (const f of fs41.readdirSync(UP)) if (f.includes(stamp41) && !before.has(f)) { try { fs41.unlinkSync(path41.join(UP, f)); } catch (_) { /* ignore */ } }
        try { fs41.unlinkSync(path41.join(UP, '..', `rt41-${stamp41}-escape.mp4`)); } catch (_) { /* never created */ }
      }
      await runTest('[POSITIVE] Cleanup: no test record or test file is left behind in server/uploads', async () => {
        assert.deepStrictEqual(fs41.readdirSync(UP).filter(f => f.includes(stamp41)), []);
        const left = (await st41.getAllMedia()).filter(m => ids.has(m.media_id));
        assert.deepStrictEqual(left, []);
      });
    }
  }

  // --- MODULE 42 (v2.30.2): THE VIDEO EXTRACTOR RECEIVES A HARD LINK THAT CARRIES THE ORIGINAL UPLOAD NAME ---
  // The Extractor shows the `source` path it is given; its API has no display-name field. So the transcript job hard-links
  // the video to server/tmp-transcribe/<media_id>/<sanitized upload name> (outside server/uploads), sends THAT path, and
  // removes the link when the call is over. Fallback: the stored (random) path. One retry with it on a fast "unreadable file" error.
  // A second backend with fake Ollama + a fake Video Extractor that RECORDS the `source` it receives (never the real ones).
  console.log('\n📦 MODULE 42: Video Extractor gets a named hard link (Positive & Negative Testing)');
  if (!skipModuleBlock(42)) {
    const fs42 = require('fs');
    const os42 = require('os');
    const path42 = require('path');
    const st42 = require('../server/db/storage');
    const fileSvc42 = require('../server/services/mediaFileService');
    const trSvc42 = require('../server/services/transcribeService');
    const UP42 = fileSvc42.UPLOADS_DIR;
    const TMP42 = trSvc42.TMP_DIR;
    const stamp42 = Date.now().toString(36);
    const sleep42 = ms => new Promise(r => setTimeout(r, ms));
    const webPath42 = name => `/uploads/${encodeURIComponent(name)}`;
    const norm42 = p => path42.resolve(p).toLowerCase();

    await runTest('[POSITIVE] Safety by construction: the link folder is outside server/uploads (never served statically), git-ignored, and not mounted by any route', async () => {
      assert.ok(!norm42(TMP42).startsWith(norm42(UP42) + path42.sep) && norm42(TMP42) !== norm42(UP42), 'tmp-transcribe must not be inside server/uploads');
      assert.strictEqual(path42.basename(TMP42), 'tmp-transcribe');
      assert.ok(/^server\/tmp-transcribe\/?\s*$/m.test(fs42.readFileSync(path42.join(__dirname, '..', '.gitignore'), 'utf8')));
      const server = fs42.readFileSync(path42.join(__dirname, '..', 'server', 'server.js'), 'utf8');
      assert.ok(!/express\.static\([^)]*tmp-transcribe/.test(server) && !/['"`]\/tmp-transcribe/.test(server));
      const svc = fs42.readFileSync(path42.join(__dirname, '..', 'server', 'services', 'transcribeService.js'), 'utf8');
      assert.ok(/sanitizeVideoFileName/.test(svc) && !/function sanitize/.test(svc), 'the name rules are reused from mediaFileService, not duplicated');
    });

    const processing42 = (await st42.getAllMedia()).filter(m => m.transcript_status === 'PROCESSING');
    if (st42.backend !== 'sql') {
      console.log('  ⏭️  SKIP: Module 42 pipeline tests need the SQL backend (they use the database directly and a second backend)');
    } else if (processing42.length) {
      console.log(`  ⏭️  SKIP: Module 42 pipeline tests need no video in PROCESSING (found ${processing42.length}); try again when the pipeline is idle`);
    } else {
      const http42 = require('http');
      const { spawn } = require('child_process');
      const crypto42 = require('crypto');
      const auth42 = require('../server/services/authService');
      const EVENT42 = 'ev-perspektif-2024-q1';
      const ids = new Set();
      const userIds = [];
      let child = null;
      const keepDirs = [];
      const flagFile = path42.join(os42.tmpdir(), `rt42-${stamp42}.nolink.flag`);
      const before42 = new Set(fs42.readdirSync(UP42));
      // the three real videos of the user must come out of this module exactly as they went in
      const userVideos = ['media-1791719574686-vlyjb7.mp4', 'media-1792120436536-ol9m3m.mp4', 'media-1792140201332-gc585x.mp4'];
      const snapshot = () => userVideos.map(f => { try { const s = fs42.statSync(path42.join(UP42, f)); return [f, s.size, s.mtimeMs, s.ino]; } catch (_) { return [f, null]; } });
      const userBefore = snapshot();

      const TEXT = 'Hari ini kami membahas program mentoring untuk karyawan baru di kantor pusat. Setiap mentor mendampingi peserta selama enam bulan pertama, bertemu secara rutin, dan membantu mereka memahami budaya kerja. Peserta merasa lebih percaya diri setelah mengikuti sesi tersebut dan ingin program ini diteruskan.';
      const GOOD = 'RINGKASAN: Program mentoring untuk karyawan baru di kantor pusat dibahas. Mentor mendampingi peserta selama enam bulan pertama dan membantu mereka memahami budaya kerja. Peserta merasa lebih percaya diri dan ingin program diteruskan.\n\nPOIN:\n- Program mentoring untuk karyawan baru di kantor pusat.\n- Mentor mendampingi peserta dan bertemu secara rutin.\n- Peserta ingin program ini diteruskan.';
      const fakeOllama = http42.createServer((req, res) => {
        req.resume();
        req.on('end', () => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ response: GOOD, done: true })); });
      });

      // The fake Video Extractor: records the `source` it is given AND what is behind that path at that very moment.
      // Behaviour is chosen by a marker in the file NAME (the basename of the source), so concurrent tests do not interfere.
      const calls = [];
      const pending = [];
      const alwaysFail = new Set();   // stored (random) file names that the fake must refuse too, to prove the retry is a single one
      const fakeTranscribe = http42.createServer((req, res) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
          res.setHeader('Content-Type', 'application/json');
          if (!(req.method === 'POST' && req.url === '/transcribe')) return res.end('{"status":"ok"}');
          let body = {}; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) { /* ignore */ }
          const source = String(body.source || '');
          const rec = { source, base: path42.basename(source), dirId: path42.basename(path42.dirname(source)), at: Date.now() };
          try {
            const st = fs42.statSync(source);
            Object.assign(rec, { exists: true, size: st.size, nlink: st.nlink, ino: st.ino, content: fs42.readFileSync(source, 'utf8') });
          } catch (_) { rec.exists = false; }
          calls.push(rec);
          const linkPath = source.replace(/\\/g, '/').includes('/tmp-transcribe/');
          const ok = () => res.end(JSON.stringify({ text: TEXT, language: 'id', duration: 30, segments: [{ start: 0, end: 30, text: TEXT }] }));
          const bad = (code, detail) => { res.statusCode = code; res.end(JSON.stringify({ detail })); };
          if (rec.base.includes('HANG')) { pending.push(res); return; }
          if (rec.base.includes('RESET')) return req.socket.destroy();
          if (rec.base.includes('SLOWFAIL')) return setTimeout(() => bad(500, `file not found: ${source}`), 15500);
          if (rec.base.includes('REFUSELINK') && linkPath) return bad(500, `No such file or directory: ${source}`);
          if (rec.base.includes('BOOM') || alwaysFail.has(rec.base)) return bad(500, 'boom');
          if (rec.base.includes('TWIN') || rec.base.includes('DELME')) return setTimeout(ok, 1500);
          ok();
        });
      });
      const listen = (srv, port = 0) => new Promise(resolve => srv.listen(port, '127.0.0.1', () => resolve(srv.address().port)));
      const ollamaPort = await listen(fakeOllama);
      const trPort = await listen(fakeTranscribe);
      const freePort = await (async () => { const s = http42.createServer(); const p = await listen(s); await new Promise(r => s.close(r)); return p; })();
      const CHILD = `http://127.0.0.1:${freePort}`;
      const pw = crypto42.randomBytes(9).toString('hex') + 'Aa1';
      const cookieOf = r => (r.headers.getSetCookie() || []).map(c => c.split(';')[0]).find(c => c.startsWith('px_session='));
      let cookie = null;
      const api = (p, opts = {}) => realFetch(`${CHILD}${p}`, { ...opts, headers: { ...(opts.headers || {}), ...(cookie ? { Cookie: cookie } : {}) } });
      const eventMedia = async id => (await (await api(`/api/events/${EVENT42}`)).json()).media.find(m => m.media_id === id);
      const waitFor = async (id, pred, ms = 20000) => {
        for (let i = 0; i < ms / 200; i++) { const m = await eventMedia(id); if (m && pred(m)) return m; await sleep42(200); }
        return await eventMedia(id);
      };
      const upload = async name => {
        const form = new FormData();
        form.append('mediaFile', new Blob([Buffer.from(`video bytes ${name}`)], { type: 'video/mp4' }), name);
        const res = await api(`/api/events/${EVENT42}/media`, { method: 'POST', body: form });
        const body = await res.json();
        if (body.media) ids.add(body.media.media_id);
        return { res, media: body.media, name, tmpBase: body.media ? path42.basename(body.media.file_path) : null };
      };
      const callsOf = up => calls.filter(c => c.dirId === up.media.media_id || c.base === up.tmpBase);
      const jobDir = id => path42.join(TMP42, id);
      const finished = (up, summary = 'DONE') => waitFor(up.media.media_id, m => m.summary_status === summary && m.file_path !== up.media.file_path);
      // a video record + real file made directly in the database (for names the upload route would not carry)
      let seq = 0;
      const mkRecord = async (fileName, state) => {
        const tmp = `media-rt42-${stamp42}-${++seq}.mp4`;
        fs42.writeFileSync(path42.join(UP42, tmp), `bytes of ${tmp}`);
        const m = await st42.addMedia({ event_id: EVENT42, file_name: fileName, file_path: `/uploads/${tmp}`, file_type: 'VIDEO', caption: 'rt42', transcript_status: 'FAILED' });
        ids.add(m.media_id);
        if (state) await st42.updateMedia(m.media_id, state);
        return { id: m.media_id, tmp };
      };

      try {
        // Leftovers a crashed/killed server could have left behind - the new backend removes them at boot (test h).
        fs42.mkdirSync(TMP42, { recursive: true });
        const doneRec = await mkRecord(`rt42-${stamp42} left over.mp4`, { transcript_status: 'DONE', transcript: 'x' });
        const procRec = await mkRecord(`rt42-${stamp42} still running.mp4`, { transcript_status: 'PROCESSING' });
        const leftovers = {
          done: jobDir(doneRec.id), unknown: jobDir(`med-rt42-${stamp42}-unknown`), proc: jobDir(procRec.id), stray: path42.join(TMP42, `rt42-${stamp42}-stray.txt`)
        };
        for (const d of [leftovers.done, leftovers.unknown, leftovers.proc]) { fs42.mkdirSync(d, { recursive: true }); fs42.writeFileSync(path42.join(d, 'left.mp4'), 'link-ish'); }
        fs42.writeFileSync(leftovers.stray, 'stray');
        keepDirs.push(leftovers.done, leftovers.unknown, leftovers.proc, leftovers.stray);

        const u = await st42.createUser({ is_test_account: true, username: `rt42a${stamp42}`, full_name: 'Regression 42', email: '', role: 'ADMIN', password_hash: await auth42.hashPassword(pw), must_change_password: false });
        userIds.push(u.user_id);
        child = spawn(process.execPath, ['--require', path42.join(__dirname, 'helpers', 'failLinkPreload.js'), path42.join(__dirname, '..', 'server', 'server.js')], {
          cwd: path42.join(__dirname, '..'),
          env: { ...process.env, PORT: String(freePort), OLLAMA_HOST: `http://127.0.0.1:${ollamaPort}`, OLLAMA_MODEL: 'gemma3:4b', TRANSCRIBE_API_URL: `http://127.0.0.1:${trPort}`, TRANSCRIBE_TIMEOUT_MS: '17000', RT42_FAIL_LINK_FLAG: flagFile, PX_DISABLE_SCHEDULERS: '1', PX_DISABLE_RESUME: '1' },
          stdio: 'ignore'
        });
        let booted = false;
        for (let i = 0; i < 120 && !booted; i++) { try { booted = (await realFetch(`${CHILD}/api/health`)).ok; } catch (_) { await sleep42(500); } }
        assert.ok(booted, 'second backend did not start');
        const login = await realFetch(`${CHILD}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u.username, password: pw }) });
        assert.strictEqual(login.status, 200);
        cookie = cookieOf(login);
        await sleep42(1500);

        await runTest('[POSITIVE] Boot cleanup: tmp-transcribe folders of finished/unknown jobs and stray files are removed; the folder of a media still PROCESSING is kept', async () => {
          assert.ok(!fs42.existsSync(leftovers.done), 'folder of a DONE media must be removed');
          assert.ok(!fs42.existsSync(leftovers.unknown), 'folder of an unknown media must be removed');
          assert.ok(!fs42.existsSync(leftovers.stray), 'a stray file must be removed');
          assert.ok(fs42.existsSync(path42.join(leftovers.proc, 'left.mp4')), 'folder of a PROCESSING media must stay');
          // cleanup removed only link-side entries: the uploaded files of those records are untouched
          assert.ok(fs42.existsSync(path42.join(UP42, doneRec.tmp)) && fs42.existsSync(path42.join(UP42, procRec.tmp)));
        });

        const NAME_A = `rt42-${stamp42} Rapat Q3 [final] (v2) é.mp4`;
        let upA = null;
        await runTest('[POSITIVE] The Extractor receives the ORIGINAL upload name (not media-<ts>-<rand>), from a folder outside server/uploads, and it is a real hard link to the same bytes', async () => {
          upA = await upload(NAME_A);
          assert.strictEqual(upA.res.status, 201);
          assert.ok(/^media-\d+-[a-z0-9]+\.mp4$/.test(upA.tmpBase), `stored under a temporary name: ${upA.tmpBase}`);
          const done = await finished(upA);
          assert.strictEqual(done.summary_status, 'DONE');
          const cs = callsOf(upA);
          assert.strictEqual(cs.length, 1, JSON.stringify(cs.map(c => c.source)));
          const c = cs[0];
          assert.strictEqual(c.base, NAME_A, 'basename of source = the sanitized original name');
          assert.ok(!c.base.startsWith('media-'));
          assert.strictEqual(path42.dirname(path42.dirname(path42.resolve(c.source))).toLowerCase(), norm42(TMP42), 'source = <tmp-transcribe>/<media_id>/<name>');
          assert.strictEqual(c.dirId, upA.media.media_id, 'one folder per job');
          assert.ok(!norm42(c.source).startsWith(norm42(UP42) + path42.sep), 'never inside server/uploads');
          assert.strictEqual(c.exists, true, 'the path existed while the Extractor was reading');
          assert.strictEqual(c.content, `video bytes ${NAME_A}`, 'same bytes as the uploaded file');
          assert.strictEqual(c.size, Buffer.byteLength(`video bytes ${NAME_A}`));
          assert.strictEqual(c.nlink, 2, 'a hard link (2 names for one file), not a copy');
          assert.strictEqual(c.ino, fs42.statSync(path42.join(UP42, NAME_A)).ino, 'same file on disk as the final upload file');
        });

        await runTest('[POSITIVE] After DONE the link folder is gone, and the v2.30.1 rename still works: the file in server/uploads has the original name, intact, served 200', async () => {
          assert.ok(!fs42.existsSync(jobDir(upA.media.media_id)), 'folder must be removed');
          const m = await eventMedia(upA.media.media_id);
          assert.strictEqual(m.file_path, webPath42(NAME_A));
          assert.strictEqual(fs42.readFileSync(path42.join(UP42, NAME_A), 'utf8'), `video bytes ${NAME_A}`);
          assert.ok(!fs42.existsSync(path42.join(UP42, upA.tmpBase)), 'temporary name gone after the rename');
          assert.strictEqual((await api(m.file_path)).status, 200);
        });

        await runTest('[NEGATIVE] Transcript FAILED (Extractor error): the link folder is removed, the failure is recorded, the file is renamed; a failure that looks like an unreadable path gets exactly ONE retry with the stored path', async () => {
          const up = await upload(`rt42-${stamp42} BOOM.mp4`);
          alwaysFail.add(up.tmpBase);
          const failed = await waitFor(up.media.media_id, m => m.transcript_status === 'FAILED' && m.file_path !== up.media.file_path);
          assert.strictEqual(failed.transcript_status, 'FAILED');
          assert.ok(/boom/.test(failed.transcript_error));
          const cs = callsOf(up);
          assert.strictEqual(cs.length, 2, 'link path, then ONE retry with the stored path (no loop)');
          assert.strictEqual(cs[0].base, `rt42-${stamp42} BOOM.mp4`);
          assert.strictEqual(cs[1].base, up.tmpBase);
          assert.ok(!fs42.existsSync(jobDir(up.media.media_id)));
          assert.ok(fs42.existsSync(path42.join(UP42, `rt42-${stamp42} BOOM.mp4`)), 'v2.30.1 rename after a failed transcript');
        });

        await runTest('[POSITIVE] Retry: the Extractor rejects the link path quickly with "file not found" -> ONE retry with the stored (random) path -> DONE, folder removed, final rename OK', async () => {
          const up = await upload(`rt42-${stamp42} REFUSELINK.mp4`);
          const done = await finished(up);
          assert.strictEqual(done.transcript_status, 'DONE');
          assert.strictEqual(done.summary_status, 'DONE');
          const cs = callsOf(up);
          assert.strictEqual(cs.length, 2, JSON.stringify(cs.map(c => c.source)));
          assert.strictEqual(cs[0].base, `rt42-${stamp42} REFUSELINK.mp4`);
          assert.strictEqual(cs[1].base, up.tmpBase);
          assert.strictEqual(norm42(path42.dirname(cs[1].source)), norm42(UP42), 'the retry used the stored path');
          assert.ok(!fs42.existsSync(jobDir(up.media.media_id)));
          assert.strictEqual(done.file_path, webPath42(`rt42-${stamp42} REFUSELINK.mp4`));
        });

        await runTest('[NEGATIVE] No retry on a connection reset (Extractor died mid-call): one call, FAILED, folder removed', async () => {
          const up = await upload(`rt42-${stamp42} RESET.mp4`);
          const failed = await waitFor(up.media.media_id, m => m.transcript_status === 'FAILED');
          assert.strictEqual(failed.transcript_status, 'FAILED');
          await sleep42(500);
          assert.strictEqual(callsOf(up).length, 1);
          assert.ok(!fs42.existsSync(jobDir(up.media.media_id)));
        });

        await runTest('[NEGATIVE] No retry when the Extractor is not running (connection refused): FAILED with the "not running" message, no call recorded, folder removed', async () => {
          fakeTranscribe.closeAllConnections();
          await new Promise(r => fakeTranscribe.close(r));
          try {
            const up = await upload(`rt42-${stamp42} DOWN.mp4`);
            const failed = await waitFor(up.media.media_id, m => m.transcript_status === 'FAILED');
            assert.strictEqual(failed.transcript_status, 'FAILED');
            assert.ok(/not running/.test(failed.transcript_error), failed.transcript_error);
            assert.strictEqual(callsOf(up).length, 0);
            assert.ok(!fs42.existsSync(jobDir(up.media.media_id)));
          } finally {
            await listen(fakeTranscribe, trPort);
          }
        });

        await runTest('[NEGATIVE] No retry on a timeout, and none when the link path fails only AFTER the 15-second window (slow failure); the folder is removed in both cases', async () => {
          const [hang, slow] = await Promise.all([upload(`rt42-${stamp42} HANG.mp4`), upload(`rt42-${stamp42} SLOWFAIL.mp4`)]);
          const [fh, fs_] = await Promise.all([hang, slow].map(x => waitFor(x.media.media_id, m => m.transcript_status === 'FAILED', 40000)));
          assert.strictEqual(fh.transcript_status, 'FAILED');
          assert.ok(/exceeded/.test(fh.transcript_error), fh.transcript_error);
          assert.strictEqual(fs_.transcript_status, 'FAILED');
          assert.ok(/file not found/.test(fs_.transcript_error), fs_.transcript_error);
          await sleep42(500);
          assert.strictEqual(callsOf(hang).length, 1, 'timeout: no second call');
          assert.strictEqual(callsOf(slow).length, 1, 'slow failure: no second call');
          assert.ok(!fs42.existsSync(jobDir(hang.media.media_id)) && !fs42.existsSync(jobDir(slow.media.media_id)));
          pending.splice(0).forEach(r => { try { r.destroy(); } catch (_) { /* ignore */ } });
        });

        await runTest('[POSITIVE] Fallback: when the hard link cannot be made (simulated EXDEV) the stored path is sent, nothing fails, no folder is left, final rename OK', async () => {
          fs42.writeFileSync(flagFile, '1');
          try {
            const up = await upload(`rt42-${stamp42} NOLINK.mp4`);
            const done = await finished(up);
            assert.strictEqual(done.transcript_status, 'DONE');
            const cs = callsOf(up);
            assert.strictEqual(cs.length, 1);
            assert.strictEqual(cs[0].base, up.tmpBase, 'the random stored name was sent');
            assert.strictEqual(norm42(path42.dirname(cs[0].source)), norm42(UP42));
            assert.strictEqual(cs[0].exists, true);
            assert.ok(!fs42.existsSync(jobDir(up.media.media_id)));
            assert.strictEqual(done.file_path, webPath42(`rt42-${stamp42} NOLINK.mp4`));
          } finally { try { fs42.unlinkSync(flagFile); } catch (_) { /* ignore */ } }
        });

        await runTest('[POSITIVE] Same name, two jobs at the same time: two different folders, both named after the upload; the final files are "name" and "name (1)"', async () => {
          const name = `rt42-${stamp42} TWIN.mp4`;
          const [a, b] = await Promise.all([upload(name), upload(name)]);
          const [da, db] = await Promise.all([a, b].map(x => finished(x)));
          const ca = callsOf(a)[0], cb = callsOf(b)[0];
          assert.ok(ca && cb);
          assert.strictEqual(ca.base, name);
          assert.strictEqual(cb.base, name);
          assert.notStrictEqual(norm42(path42.dirname(ca.source)), norm42(path42.dirname(cb.source)));
          assert.ok(ca.exists && cb.exists, 'both links existed while their jobs were running');
          assert.deepStrictEqual([da.file_path, db.file_path].sort(), [webPath42(name), webPath42(`rt42-${stamp42} TWIN (1).mp4`)].sort());
          assert.ok(!fs42.existsSync(jobDir(a.media.media_id)) && !fs42.existsSync(jobDir(b.media.media_id)));
        });

        await runTest('[NEGATIVE] Dangerous names ("../../x.mp4", "CON.mp4", "a:b?.mp4", "..\\..\\y.mp4", only-illegal "???.mp4") never leave the job folder; an unusable name falls back to the stored path', async () => {
          const outsideA = path42.join(TMP42, '..', `rt42-${stamp42}-evil.mp4`);
          const outsideB = path42.join(UP42, '..', `rt42-${stamp42}-evil.mp4`);
          const cases = [
            [`../../rt42-${stamp42}-evil.mp4`, `rt42-${stamp42}-evil.mp4`],
            [`..\\..\\rt42-${stamp42}-win.mp4`, `rt42-${stamp42}-win.mp4`],
            ['CON.mp4', '_CON.mp4'],
            [`a:b?${stamp42}.mp4`, `ab${stamp42}.mp4`]
          ];
          for (const [original, expected] of cases) {
            const rec = await mkRecord(original, { transcript_status: 'FAILED' });
            const r = await api(`/api/media/${rec.id}/transcribe`, { method: 'POST' });
            assert.strictEqual(r.status, 202, original);
            const done = await waitFor(rec.id, m => m.transcript_status === 'DONE', 15000);
            assert.strictEqual(done.transcript_status, 'DONE', original);
            const c = calls.filter(x => x.dirId === rec.id)[0];
            assert.ok(c, `${original}: link path expected`);
            assert.strictEqual(c.base, expected, original);
            assert.strictEqual(norm42(path42.dirname(c.source)), norm42(jobDir(rec.id)), `${original} must stay in its job folder`);
            assert.ok(c.exists && c.nlink === 2, original);
            assert.ok(!fs42.existsSync(jobDir(rec.id)), `${original}: folder removed`);
          }
          const bad = await mkRecord('???.mp4', { transcript_status: 'FAILED' });
          assert.strictEqual((await api(`/api/media/${bad.id}/transcribe`, { method: 'POST' })).status, 202);
          await waitFor(bad.id, m => m.transcript_status === 'DONE', 15000);
          const cb = calls.filter(x => x.base === bad.tmp);
          assert.strictEqual(cb.length, 1, 'unusable name -> the stored path is sent');
          assert.ok(!fs42.existsSync(outsideA) && !fs42.existsSync(outsideB), 'nothing may be written outside the job folder');
        });

        await runTest('[POSITIVE] Deleting a media while its transcript is PROCESSING leaves no folder behind and no file in server/uploads (the job ends cleanly)', async () => {
          const up = await upload(`rt42-${stamp42} DELME.mp4`);
          for (let i = 0; i < 50 && !callsOf(up).length; i++) await sleep42(100);
          assert.ok(callsOf(up).length, 'the job reached the Extractor');
          assert.ok(fs42.existsSync(jobDir(up.media.media_id)), 'folder exists while processing');
          const del = await api(`/api/media/${up.media.media_id}`, { method: 'DELETE' });
          assert.strictEqual(del.status, 200);
          for (let i = 0; i < 50 && fs42.existsSync(jobDir(up.media.media_id)); i++) await sleep42(100);
          assert.ok(!fs42.existsSync(jobDir(up.media.media_id)), 'folder removed when the job ends');
          assert.strictEqual(await st42.getMediaById(up.media.media_id), null, 'the record is not resurrected');
          assert.ok(!fs42.readdirSync(UP42).some(f => f === up.tmpBase || f.includes('DELME')), 'no file left in server/uploads');
        });

        await runTest('[POSITIVE] The three real videos of the user and the real uploads folder are untouched by this module', async () => {
          assert.deepStrictEqual(snapshot(), userBefore);
        });
      } finally {
        if (child) child.kill();
        await sleep42(500);
        pending.splice(0).forEach(r => { try { r.destroy(); } catch (_) { /* ignore */ } });
        try { fakeTranscribe.closeAllConnections(); } catch (_) { /* ignore */ }
        await new Promise(r => fakeOllama.close(r));
        await new Promise(r => fakeTranscribe.close(r));
        try { fs42.unlinkSync(flagFile); } catch (_) { /* ignore */ }
        for (const id of ids) { try { await fileSvc42.deleteMediaAndFile(id); } catch (_) { /* ignore */ } }
        for (const id of userIds) { try { await st42.deleteUser(id); } catch (_) { /* ignore */ } }
        for (const id of ids) { try { fs42.rmSync(path42.join(TMP42, id), { recursive: true, force: true }); } catch (_) { /* ignore */ } }
        for (const d of keepDirs) { try { fs42.rmSync(d, { recursive: true, force: true }); } catch (_) { /* ignore */ } }
        for (const f of fs42.readdirSync(UP42)) if ((f.includes(stamp42)) && !before42.has(f)) { try { fs42.unlinkSync(path42.join(UP42, f)); } catch (_) { /* ignore */ } }
        for (const f of [`rt42-${stamp42}-evil.mp4`]) for (const dir of [path42.join(TMP42, '..'), path42.join(UP42, '..')]) { try { fs42.unlinkSync(path42.join(dir, f)); } catch (_) { /* never created */ } }
      }
      await runTest('[POSITIVE] Cleanup: no test record, file or link folder of this module is left behind', async () => {
        assert.deepStrictEqual(fs42.readdirSync(UP42).filter(f => f.includes(stamp42)), []);
        assert.deepStrictEqual((await st42.getAllMedia()).filter(m => ids.has(m.media_id)), []);
        const tmpLeft = fs42.existsSync(TMP42) ? fs42.readdirSync(TMP42).filter(f => f.includes(stamp42) || ids.has(f)) : [];
        assert.deepStrictEqual(tmpLeft, []);
        assert.deepStrictEqual(snapshot(), userBefore);
      });
    }
  }

  // --- MODULE 43 (v2.30.3): AI SUMMARY VALIDATOR TOLERATES PARAPHRASE (STEMMING) BUT STILL BLOCKS INVENTED FACTS ---
  // Offline: no Ollama, no database. A summary used to be rejected when 3+ of its content words (over 20%) were not in the
  // transcript, which also hit harmless affixed forms ("dampaknya" for "dampak"). The match is now stem based, more neutral
  // words are ignored and the limits are 5 words AND over 30%, or 12 words in any case (long transcript: over 35% / 18).
  // Numbers, number words, capitalised names, wrong language, meta phrases and markup are rejected exactly as before.
  console.log('\n📦 MODULE 43: AI summary validator - paraphrase tolerance with stemming, invented facts still rejected (Positive & Negative Testing)');
  if (!skipModuleBlock(43)) {
    const sm43 = require('../server/services/mediaSummaryService');
    const sets43 = require('./helpers/summaryValidatorCases');
    const answerOf = c => c.answer || sm43.parseModelAnswer(c.raw);
    const verdict43 = c => { const a = answerOf(c); return a ? sm43.validateAnswer(a, c.transcript, c.lang) : 'FORMAT'; };

    await runTest('[POSITIVE] Paraphrase set: affixed forms of words that are in the transcript pass (Indonesian + English, short + long transcript, log-case words, frozen real Gemma answer)', async () => {
      const positives = sets43.CASES.filter(c => c.set === 'POSITIVE');
      assert.ok(positives.length >= 8, `expected a real positive set, got ${positives.length}`);
      for (const c of positives) assert.strictEqual(verdict43(c), null, `must pass: ${c.name}`);
    });

    await runTest('[NEGATIVE] Invented-fact set is still rejected, for the right reason: digits, number words, names, acronyms, wrong language, invented story (also against a long transcript), markup, meta phrase, frozen invented Gemma answer', async () => {
      const negatives = sets43.CASES.filter(c => c.set === 'NEGATIVE');
      assert.ok(negatives.length >= 12, `expected a real negative set, got ${negatives.length}`);
      for (const c of negatives) {
        const reason = verdict43(c);
        assert.ok(reason, `must be rejected: ${c.name}`);
        assert.ok(c.reason.test(reason), `${c.name}: rejected for the wrong reason: ${reason}`);
      }
    });

    await runTest('[POSITIVE] Stemming: the words of the real log case match their roots (dampaknya, tindakannya, berpartisipasi, merasa~terasa, waktunya~waktuku, kebiasaan, membuatnya, tujuannya, mengganggu~terganggu, learned, participating)', async () => {
      const tr = 'dampak tindakan partisipasi terasa waktuku biasa dibuat tujuan terganggu gangguan sosial';
      const out = 'dampaknya tindakannya berpartisipasi merasa waktunya kebiasaan membuatnya tujuannya mengganggu sosial';
      assert.deepStrictEqual(sm43.novelWords(out, tr, 'id').novel, []);
      assert.deepStrictEqual(sm43.novelWords('learned supports participating decisions consideration', 'learn support participate decision consider', 'en').novel, []);
      // 'sosial' ~ 'sosialisasi' and 'bahas' ~ 'bahasa': the shorter stem is the beginning of the other (max 4 letters longer)
      assert.deepStrictEqual(sm43.novelWords('sosial', 'kegiatan sosialisasi', 'id').novel, []);
    });

    await runTest('[NEGATIVE] Stemming does not over-match: 3-letter stems never match, unrelated look-alikes stay new, number words are not rescued by an affix', async () => {
      assert.deepStrictEqual(sm43.novelWords('adaptasi', 'saya ada di rumah', 'id').novel, ['adaptasi']);
      assert.deepStrictEqual(sm43.novelWords('kendaraan', 'kendali penuh', 'id').novel, ['kendaraan']);
      assert.deepStrictEqual(sm43.novelWords('pertumbuhan pendapatan', 'saya makan nasi', 'id').novel, ['pertumbuhan', 'pendapatan']);
      // "keenam" (sixth) is not "enam" (six): a number word with an affix is still checked as a number
      const tr = 'Mentor mendampingi peserta selama enam bulan pertama di kantor pusat untuk karyawan baru.';
      const reason = sm43.validateAnswer({ summary: 'Mentor mendampingi peserta pada bulan keenam di kantor pusat untuk karyawan baru.', points: ['Mentor mendampingi peserta.', 'Karyawan baru didampingi.'] }, tr, 'id');
      assert.ok(reason && /keenam/.test(reason), `got: ${reason}`);
    });

    await runTest('[POSITIVE] Limits: 5 new words AND over 30%, or 12 new words in any case; a long (chunked) transcript allows over 35% / 18 words; fewer than 5 never rejects', async () => {
      assert.deepStrictEqual({ ...sm43.NOVEL_LIMITS }, { min: 5, ratio: 0.30, max: 12, longRatio: 0.35, longMax: 18 });
      const short = 'x'.repeat(100);
      const long = 'x'.repeat(5001);
      const T = sm43.tooManyNovelWords;
      assert.strictEqual(T(4, 5, short), false, 'under 5 words is never enough, even when it is 80% of the summary');
      assert.strictEqual(T(5, 16, short), true, '5 of 16 = 31%');
      assert.strictEqual(T(5, 17, short), false, '5 of 17 = 29%');
      assert.strictEqual(T(11, 40, short), false);
      assert.strictEqual(T(12, 80, short), true, '12 words are too many in any case');
      assert.strictEqual(T(12, 40, long), false, 'long transcript: 12 of 40 = 30%');
      assert.strictEqual(T(15, 40, long), true, 'long transcript: 15 of 40 = 37.5%');
      assert.strictEqual(T(18, 200, long), true, 'long transcript: 18 words in any case');
    });

    await runTest('[POSITIVE] The Module 38 behaviour is kept: the stored real summary and the invented one are still told apart, and the retry prompt asks for words from the transcript', async () => {
      const real = sets43.CASES.find(c => /earlier stored summary/.test(c.name));
      const invented = sets43.CASES.find(c => /Gemma answer 1/.test(c.name));
      assert.strictEqual(verdict43(real), null);
      assert.ok(verdict43(invented));
      const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'server', 'services', 'mediaSummaryService.js'), 'utf8');
      assert.ok(/Pakai hanya kata yang benar-benar ada di transkrip/.test(src) && /Use only words that really occur in the transcript/.test(src), 'both retry prompts carry the instruction');
      assert.ok(/novel\.slice\(0, 12\)/.test(src), 'the retry feedback names up to 12 rejected words');
    });
  }

  // --- MODULE 44 (v2.31.0): THE DIRECTORATE MASTER IS THE BANK'S 12 REAL DIRECTORATES ---
  // The 8 demo directorates were replaced by the 12 directorates of the ESS 2025 result file; old names in existing
  // data are renamed at boot (server/db/directorateMigration.js, division overrides first). Data checks read the SQL
  // database (SQL backend) or store.json (JSON backend, read only); the in-place rerun/rename tests are SQL only.
  console.log('\n📦 MODULE 44: Real directorate master (12 ESS directorates) and the boot rename of the old demo names (Positive & Negative Testing)');
  {
    const dm44 = require('../server/db/directorateMigration');
    const REAL44 = ['Business Banking', 'Compliance, Corporate Affairs & Legal', 'Consumer & EBB', 'Corporate Assurance', 'Human Resources',
      'Network & Digital Banking', 'Operations, Technology, Analytics & AI', 'Risk Management', 'Sharia Banking', 'Special Asset',
      'Strategy, Finance & SPAPM', 'Treasury & Capital Market'];
    const OLD44 = ['Commercial & Corporate Banking', 'Consumer Banking', 'Digital Banking', 'Finance & Operations', 'Information Technology', 'Internal Audit & Legal'];
    require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
    const storage44 = require('../server/db/storage');
    const sql44 = storage44.backend === 'sql' ? require('mssql') : null;
    const pool44 = sql44 ? await new sql44.ConnectionPool({ server: process.env.DB_SERVER || 'localhost', port: parseInt(process.env.DB_PORT || '1433', 10), database: process.env.DB_NAME || 'PeopleExperiencePX',
      user: process.env.DB_USER, password: process.env.DB_PASSWORD, options: { encrypt: false, trustServerCertificate: true } }).connect() : null;
    // EMPLOYEE survey rows as { directorate, division } (SQL: the table; JSON: store.json as the server saved it)
    const employeeRows44 = async () => {
      if (pool44) {
        return (await pool44.request().query(`SELECT org_unit_1 AS directorate, org_unit_2 AS division, COUNT(*) AS n FROM dbo.px_survey_uploaded_responses
                                              WHERE respondent_type = 'EMPLOYEE' GROUP BY org_unit_1, org_unit_2`)).recordset;
      }
      const store = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'server', 'data', 'store.json'), 'utf8'));
      return (store.surveyUploadedResponses || [])
        .filter(r => ![2, 5].includes(parseInt(r.metric_id, 10)) && !r.participant_id && !r.university && !r.candidate_id && !r.applied_position)
        .map(r => ({ directorate: r.directorate, division: r.division, n: 1 }));
    };
    // v2.51.0: the names as the Admin may have renamed them since (former names resolve to the current one)
    const cur44 = await currentDirectorateName();
    try {
      await runTest('[POSITIVE] GET /api/directorates returns exactly the 12 real directorates (no demo name, no "PT Bank CIMB Niaga Tbk" Bankwide row)', async () => {
        const dirs = await (await fetch(`${BASE_URL}/api/directorates`)).json();
        assert.deepStrictEqual(dirs.map(d => d.name).sort(), REAL44.map(cur44).sort());
        assert.ok(!dirs.some(d => /PT Bank CIMB Niaga/i.test(d.name)), 'the Bankwide row is not a directorate');
        // re-parented divisions (overrides) sit under their new directorate
        const divsOf = n => dirs.find(d => d.name === cur44(n)).divisions;
        assert.ok(divsOf('Treasury & Capital Market').includes('Treasury Operations') && divsOf('Treasury & Capital Market').includes('Investment Banking & Markets'));
        assert.ok(divsOf('Corporate Assurance').includes('Internal Audit Group'));
        assert.ok(divsOf('Operations, Technology, Analytics & AI').includes('Central Operations & Services'));
        assert.ok(!divsOf('Strategy, Finance & SPAPM').includes('Treasury Operations'));
      });

      await runTest('[POSITIVE] No EMPLOYEE survey row carries an old directorate name and every EMPLOYEE directorate + division exists in the directory', async () => {
        const dirs = await (await fetch(`${BASE_URL}/api/directorates`)).json();
        const pairs = new Set(dirs.flatMap(d => d.divisions.map(v => `${d.name}|${v}`)));
        const rows = await employeeRows44();
        assert.ok(rows.length > 0, 'there must be employee survey rows');
        const old = rows.filter(r => OLD44.some(o => o.toLowerCase() === String(r.directorate).trim().toLowerCase()));
        assert.deepStrictEqual(old, [], 'old directorate names left');
        const outside = rows.filter(r => !pairs.has(`${r.directorate}|${r.division}`));
        assert.deepStrictEqual(outside.map(r => `${r.directorate}|${r.division}`), [], 'employee rows outside the directory');
      });

      await runTest('[POSITIVE] Mapping: division overrides first, then the directorate default; trimmed and case-insensitive; "all divisions" scopes keep exactly the same access', async () => {
        assert.strictEqual(dm44.mapDirectorate('Finance & Operations', 'Treasury Operations'), 'Treasury & Capital Market');
        assert.strictEqual(dm44.mapDirectorate('Finance & Operations', 'Central Operations & Services'), 'Operations, Technology, Analytics & AI');
        assert.strictEqual(dm44.mapDirectorate('Finance & Operations', 'Financial Planning & Analysis'), 'Strategy, Finance & SPAPM');
        assert.strictEqual(dm44.mapDirectorate('  commercial & corporate BANKING ', ' investment banking & markets'), 'Treasury & Capital Market');
        assert.strictEqual(dm44.mapDirectorate('Internal Audit & Legal', 'Internal Audit Group'), 'Corporate Assurance');
        assert.strictEqual(dm44.mapDirectorate('Internal Audit & Legal', 'Legal & Compliance'), 'Compliance, Corporate Affairs & Legal');
        assert.strictEqual(dm44.mapDirectorate('Digital Banking', 'OCTO Mobile'), 'Network & Digital Banking');
        assert.strictEqual(dm44.renamedDirectorate('Human Resources', 'Talent Acquisition'), null, 'Human Resources keeps its name');
        assert.deepStrictEqual(dm44.migrateScopes([{ directorate: 'Finance & Operations', divisions: null }]), [
          { directorate: 'Strategy, Finance & SPAPM', divisions: null },
          { directorate: 'Treasury & Capital Market', divisions: ['Treasury Operations'] },
          { directorate: 'Operations, Technology, Analytics & AI', divisions: ['Central Operations & Services'] }]);
        assert.deepStrictEqual(dm44.migrateScopes([{ directorate: 'Consumer Banking', divisions: ['Wealth Management'] }, { directorate: 'Human Resources', divisions: null }]),
          [{ directorate: 'Consumer & EBB', divisions: ['Wealth Management'] }, { directorate: 'Human Resources', divisions: null }]);
        assert.deepStrictEqual(dm44.migrateDirectorateOptions([{ value: 'Information Technology', label: 'Information Technology' }, { value: 'Human Resources', label: 'HR' }]),
          [{ value: 'Operations, Technology, Analytics & AI', label: 'Operations, Technology, Analytics & AI' }, { value: 'Human Resources', label: 'HR' }]);
        const plan = dm44.planDirectory([
          { directorate_name: 'Finance & Operations', divisions: ['Treasury Operations', 'Financial Planning & Control'] },
          { directorate_name: 'Human Resources', divisions: ['Talent Acquisition'] },
          { directorate_name: 'Unit Lain', divisions: ['X'] }], [{ directorate_name: 'Human Resources', divisions: [] }, { directorate_name: 'Sharia Banking', divisions: [] }]);
        assert.deepStrictEqual(plan.directorates, [
          { directorate_name: 'Human Resources', divisions: ['Talent Acquisition'] }, { directorate_name: 'Sharia Banking', divisions: [] },
          { directorate_name: 'Strategy, Finance & SPAPM', divisions: ['Financial Planning & Control'] },
          { directorate_name: 'Treasury & Capital Market', divisions: ['Treasury Operations'] },
          { directorate_name: 'Unit Lain', divisions: ['X'] }]);
        assert.strictEqual(plan.removed, 1);
        assert.strictEqual(plan.moved, 2);
        assert.strictEqual(dm44.planDirectory(plan.directorates, []), null, 'second run plans nothing');
      });

      await runTest('[NEGATIVE] The mapping leaves new names, unknown names, look-alikes and empty values alone (second run = no change)', async () => {
        for (const n of REAL44) {
          assert.strictEqual(dm44.renamedDirectorate(n, 'Treasury Operations'), null, n);
          assert.strictEqual(dm44.migrateScopes([{ directorate: n, divisions: null }]), null, n);
        }
        for (const n of ['Digital Banking Specialist', 'Universitas Indonesia', 'General', 'Treasury Operations', 'PT Bank CIMB Niaga Tbk', '', null, undefined]) {
          assert.strictEqual(dm44.renamedDirectorate(n, null), null, String(n));
        }
        assert.strictEqual(dm44.migrateDirectorateOptions([{ value: 'Human Resources', label: 'Human Resources' }]), null);
        assert.strictEqual(dm44.migrateDirectorateOptions('not a list'), null);
      });

      if (!pool44) {
        console.log('  ⏭️  SKIP: Module 44 in-place rename tests need the SQL backend (they write to the database directly)');
      } else {
        const tag44 = `rt44-${Date.now().toString(36)}`;
        await runTest('[POSITIVE] Running the migration again on the migrated database changes 0 rows', async () => {
          const counts = await storage44.migrateDirectorates();
          assert.deepStrictEqual(Object.values(counts).filter(v => v !== 0), [], JSON.stringify(counts));
        });

        await runTest('[POSITIVE/NEGATIVE] A leftover old name is renamed (EMPLOYEE row by division override, user scope expanded), a campus row with the same text is NOT touched, and a rerun changes 0 rows', async () => {
          let userId = null;
          try {
            const ins = (type, o1, o2) => pool44.request().input('u', sql44.NVarChar, tag44).input('t', sql44.VarChar, type).input('o1', sql44.NVarChar, o1).input('o2', sql44.NVarChar, o2)
              .query(`INSERT INTO dbo.px_survey_uploaded_responses (upload_id, metric_id, respondent_type, respondent_id, org_unit_1, org_unit_2, rating_score, survey_date)
                      VALUES (@u, 8, @t, @u, @o1, @o2, 4, '2020-01-01')`);
            await ins('EMPLOYEE', 'Finance & Operations', 'Treasury Operations');
            await ins('EMPLOYEE', ' consumer banking', 'Wealth Management');
            await ins('CAMPUS_STUDENT', 'Information Technology', 'Teknik Informatika');
            const user = await storage44.createUser({ is_test_account: true, username: tag44, full_name: 'Module 44', email: '', role: 'USER', password_hash: 'x', scopes: [] });
            userId = user.user_id;
            await pool44.request().input('id', sql44.Int, userId).query(`INSERT INTO dbo.px_user_scopes (user_id, directorate, division) VALUES (@id, N'Finance & Operations', NULL)`);

            const counts = await storage44.migrateDirectorates();
            assert.strictEqual(counts.survey_responses, 2, JSON.stringify(counts));
            assert.strictEqual(counts.user_scopes, 1, JSON.stringify(counts));
            const rows = (await pool44.request().input('u', sql44.NVarChar, tag44)
              .query('SELECT respondent_type, org_unit_1, org_unit_2 FROM dbo.px_survey_uploaded_responses WHERE upload_id = @u ORDER BY response_id')).recordset;
            assert.deepStrictEqual(rows.map(r => `${r.respondent_type}|${r.org_unit_1}|${r.org_unit_2}`), [
              `EMPLOYEE|${cur44('Treasury & Capital Market')}|Treasury Operations`, `EMPLOYEE|${cur44('Consumer & EBB')}|Wealth Management`, 'CAMPUS_STUDENT|Information Technology|Teknik Informatika']);
            assert.deepStrictEqual((await storage44.getUserById(userId)).scopes, [
              { directorate: cur44('Strategy, Finance & SPAPM'), divisions: null },
              { directorate: cur44('Treasury & Capital Market'), divisions: ['Treasury Operations'] },
              { directorate: cur44('Operations, Technology, Analytics & AI'), divisions: ['Central Operations & Services'] }]);
            const again = await storage44.migrateDirectorates();
            assert.deepStrictEqual(Object.values(again).filter(v => v !== 0), [], JSON.stringify(again));
          } finally {
            await pool44.request().input('u', sql44.NVarChar, tag44).query('DELETE FROM dbo.px_survey_uploaded_responses WHERE upload_id = @u');
            if (userId) await storage44.deleteUser(userId);
          }
        });
      }
    } finally {
      if (pool44) await pool44.close();
    }
  }

  // --- MODULE 45 (v2.32.0): ESS METRICS TAKE THE ESS SUMMARY .XLSX (ONE ROW PER ORG UNIT) INSTEAD OF RESPONDENT ROWS ---
  // Template, the user's real ESS result file, carry-forward period rule, bankwide / directorate / division / scope
  // selection, atomic validation (negative cases store nothing), re-upload replaces the period, evidence, original-file
  // download and access rules. Cleans up after itself: temp users / metrics are deleted, the seed 2025-11 result of the
  // Role Clarity metric is restored (SQL: exactly - rows re-pointed to the seed upload, test uploads removed).
  console.log('\n📦 MODULE 45: ESS summary upload (.xlsx) - template, real file, period carry-forward, org level, validation, access (Positive & Negative Testing)');
  {
    const fs45 = require('fs');
    const path45 = require('path');
    const ess45 = require('../server/services/essSummaryService');
    const aj45 = async q => (await adminJson('GET', q)).json();
    const params45 = (await aj45('/api/admin/parameters')).metrics;
    const m9 = params45.find(m => m.metric_type === 'SURVEY' && m.survey_source === 'ESS' && /role clarity/i.test(m.metric_name));
    const RC = m9 ? m9.metric_id : 9;
    const REAL_FILE = path45.join(__dirname, '..', 'docs', 'ESS 2025 Result_Role Clarity & DS Support.xlsx');
    const DIRS45 = ['Business Banking', 'Compliance, Corporate Affairs & Legal', 'Consumer & EBB', 'Corporate Assurance', 'Human Resources',
      'Network & Digital Banking', 'Operations, Technology, Analytics & AI', 'Risk Management', 'Sharia Banking', 'Special Asset',
      'Strategy, Finance & SPAPM', 'Treasury & Capital Market'];
    const PART45 = [449, 95, 1816, 108, 129, 2579, 1494, 192, 365, 39, 274, 88];
    const QS45 = ['I understand how my current job role contributes to a positive impact on customers and society.',
      'Employees clearly understand what is expected of them.', 'My immediate manager gives me feedback that helps me improve my performance.'];
    // the real file's values (fractions), used when the file itself is not on this machine
    const VALS45 = [[0.92, 0.96, 0.9, 0.9], [0.91, 0.95, 0.88, 0.9], [0.93666666666666665, 0.99, 0.89, 0.93], [0.93666666666666665, 0.96, 0.93, 0.92],
      [0.90666666666666662, 0.96, 0.92, 0.84], [0.92333333333333323, 0.98, 0.84, 0.95], [0.93666666666666665, 0.97, 0.93, 0.91], [0.87333333333333341, 0.93, 0.84, 0.85],
      [0.92333333333333334, 0.94, 0.9, 0.93], [0.93, 0.96, 0.93, 0.9], [0.98, 0.97, 0.97, 1], [0.89333333333333342, 0.92, 0.88, 0.88], [0.90333333333333332, 0.95, 0.88, 0.88]];
    const realRows45 = () => [ESS_HEAD('Role Clarity & DS Support Index', QS45),
      ['PT Bank CIMB Niaga Tbk', 'Bankwide', 2025, 'November', 7756, ...VALS45[0]],
      ...DIRS45.map((d, i) => [d, 'Directorate', 2025, 'November', PART45[i], ...VALS45[i + 1]])];
    const realFile45 = async () => (fs45.existsSync(REAL_FILE) ? fs45.readFileSync(REAL_FILE) : essXlsx(realRows45()));
    const uploads45 = [];   // upload ids made by this module (original files to remove)
    const users45 = [];
    const metrics45 = [];
    const history45 = async () => (await aj45('/api/surveys/history')).length;
    const m9calc = async q => (await aj45(`/api/metrics/calculate?${q}`)).metrics.find(m => m.metric_id === RC);
    const mkUser45 = async (suffix, scopes) => {
      const username = `rt45${suffix}${stamp}`;
      const res = await adminJson('POST', '/api/admin/users', { username, full_name: `Regression 45 ${suffix}`, email: `${username}@example.test`, role: 'USER', scopes });
      assert.strictEqual(res.status, 201);
      const body = await res.json();
      users45.push(body.user.user_id);
      const { cookie } = await loginAs(username, body.temporary_password);
      assert.strictEqual((await rawFetch(`${BASE_URL}/api/auth/change-password`, jsonBody('POST', { current_password: body.temporary_password, new_password: STRONG }, cookie))).status, 200);
      return { username, email: `${username}@example.test`, cookie };
    };
    const asUj45 = async (u, q) => (await rawFetch(`${BASE_URL}${q}`, asUser(u.cookie))).json();
    const storageBackendIsSql45 = () => require('../server/db/storage').backend === 'sql';
    let rcTouched = false; // an upload to the real Role Clarity metric happened (restore its seed result afterwards)

    try {
      await runTest('[POSITIVE] The ESS template is a real .xlsx: Directorate | Level | Year | Month | Participation | <index name> | one column per configured question, a Bankwide row and one row per master directorate; SYSTEM templates stay CSV and the master CSV has no ESS metric', async () => {
        const res = await fetch(`${BASE_URL}/api/surveys/template?metric_id=${RC}`);
        assert.strictEqual(res.status, 200);
        assert.match(res.headers.get('content-type'), /spreadsheetml\.sheet/);
        assert.match(res.headers.get('content-disposition'), new RegExp(`Template_ESS_Metric_${RC}\\.xlsx`));
        const rows = await ess45.readFirstSheet(Buffer.from(await res.arrayBuffer()));
        const text = r => r.cells.map(c => (c && c.value !== null ? String(c.value) : ''));
        const questions = (await aj45(`/api/admin/survey-questions/${RC}`)).questions.filter(q => q.type !== 'FREE_TEXT').map(q => q.text || q.label);
        assert.deepStrictEqual(text(rows[0]), ['Directorate', 'Level', 'Year', 'Month', 'Participation', m9.metric_name.replace(/\s*\(ESS\)\s*$/, ''), ...questions]);
        assert.deepStrictEqual(text(rows[1]).slice(0, 2), ['PT Bank CIMB Niaga Tbk', 'Bankwide']);
        const directory = (await aj45('/api/directorates')).map(d => d.name || d.directorate_name);
        assert.deepStrictEqual(rows.slice(2).map(r => text(r)[0]), directory);
        assert.ok(rows.slice(2).every(r => text(r)[1] === 'Directorate'));
        assert.strictEqual(rows.length, 2 + directory.length);
        const sys = await fetch(`${BASE_URL}/api/surveys/template?metric_id=8`);
        assert.match(sys.headers.get('content-type'), /text\/csv/);
        const master = (await (await fetch(`${BASE_URL}/api/surveys/template?metric_id=ALL`)).text()).split(/\r?\n/).slice(1).map(l => l.split(',')[5]);
        const essIds = params45.filter(m => m.survey_source === 'ESS').map(m => String(m.metric_id));
        assert.ok(master.length > 0 && master.every(id => !essIds.includes(id)), 'no ESS metric in the master CSV');
      });

      await runTest('[POSITIVE] Seed / boot cleanup: no ESS metric has per-respondent rows any more, and every ESS metric has its 2025-11 summary (Bankwide + 12 directorates)', async () => {
        for (const m of params45.filter(x => x.metric_type === 'SURVEY' && x.survey_source === 'ESS' && x.metric_id <= 27)) {
          assert.strictEqual((await aj45(`/api/surveys/responses/${m.metric_id}`)).length, 0, `metric ${m.metric_id} respondent rows`);
          const d = await aj45(`/api/metrics/${m.metric_id}/detail?mode=YTD&year=2025`);
          assert.strictEqual(d.ess_period, '2025-11', `metric ${m.metric_id}`);
          assert.strictEqual(d.ess_results_by_directorate.length, 13, `metric ${m.metric_id} rows`);
          assert.strictEqual(d.total_respondents, 7756);
        }
      });

      await runTest('[POSITIVE] The user\'s real ESS file uploads to Role Clarity: 13 rows, period 2025-11, bankwide 92.00, it replaces the seeded 2025-11 result, is in the history and the audit log', async () => {
        const before = await history45();
        rcTouched = true;
        const res = await postEssFile(RC, await realFile45(), 'ESS 2025 Result_Role Clarity & DS Support.xlsx');
        const body = await res.json();
        assert.strictEqual(res.status, 200, JSON.stringify(body).slice(0, 300));
        uploads45.push(body.upload_id);
        assert.strictEqual(body.success, true);
        assert.strictEqual(body.metric_id, RC);
        assert.strictEqual(body.period, '2025-11');
        assert.strictEqual(body.rows_imported, 13);
        assert.strictEqual(body.bankwide_index, 92);
        assert.strictEqual(body.replaced_previous, true, 'the seeded 2025-11 rows were replaced');
        assert.deepStrictEqual(body.errors, []);
        assert.strictEqual(await history45(), before + 1);
        const log = await aj45('/api/admin/audit-log?limit=50&include_test=1');
        assert.ok(log.some(e => e.action === 'SURVEY_UPLOAD' && e.target.includes(`ESS summary metric ${RC};`) && e.target.includes(body.upload_id)), 'audited');
      });

      // v2.50.0: carry-forward - the latest result on or before the period's end (Module 52 covers the later periods)
      await runTest('[POSITIVE] ESS period and org level: YTD 2025 = Bankwide 92 / 7756 from 2025-11; Business Banking 91 / 449; a Human Resources division reads Human Resources (92.33 / 129, flagged); YTD 2025 to October and MTD 2025-10 = NO_DATA (no result on or before), full 2025 and MTD 2025-11 = the result', async () => {
        const year = 2025;
        const all = await m9calc(`mode=YTD&year=${year}`);
        assert.strictEqual(all.normalized_score, 92); assert.strictEqual(all.sample_size, 7756);
        assert.strictEqual(all.last_survey_date, '2025-11'); assert.strictEqual(all.ess_level, 'BANKWIDE');
        const bb = await m9calc(`mode=YTD&year=${year}&directorate=${encodeURIComponent('Business Banking')}`);
        assert.strictEqual(bb.normalized_score, 91); assert.strictEqual(bb.sample_size, 449);
        const hrDiv = (await aj45('/api/directorates')).find(d => (d.name || d.directorate_name) === 'Human Resources').divisions[0];
        const hr = await m9calc(`mode=YTD&year=${year}&directorate=${encodeURIComponent('Human Resources')}&sub_directorate=${encodeURIComponent(hrDiv)}`);
        assert.strictEqual(hr.normalized_score, 92.33); assert.strictEqual(hr.sample_size, 129); assert.strictEqual(hr.ess_level, 'DIRECTORATE');
        const hrDetail = await aj45(`/api/metrics/${RC}/detail?mode=YTD&year=${year}&directorate=${encodeURIComponent('Human Resources')}&sub_directorate=${encodeURIComponent(hrDiv)}`);
        assert.strictEqual(hrDetail.ess_division_filtered, true);
        assert.strictEqual(hrDetail.normalized_score, 92.33);
        const early = await m9calc('mode=YTD&year=2025&endMonth=10');
        assert.strictEqual(early.sample_size, 0, 'no ESS result on or before October 2025');
        assert.strictEqual(early.status, 'NO_DATA', 'no static raw_value fallback any more (v2.36.0)');
        assert.strictEqual(early.normalized_score, null);
        assert.strictEqual(early.ess_period, null);
        const full = await m9calc('mode=YTD&year=2025');
        assert.strictEqual(full.normalized_score, 92); assert.strictEqual(full.sample_size, 7756);
        assert.strictEqual((await m9calc('mode=MTD&year=2025&month=11')).normalized_score, 92);
        assert.strictEqual((await m9calc('mode=MTD&year=2025&month=10')).sample_size, 0);
        assert.strictEqual((await m9calc('mode=MTD&year=2025&month=10')).status, 'NO_DATA');
      });

      await runTest('[POSITIVE] Detail of an ESS metric: participation, period "November 2025", per-question % favorable from the file mapped BY POSITION to the configured questions (file header kept as file_label; neutral/unfavorable null), results by directorate (Bankwide first for the Admin) and the upload of the period', async () => {
        const d = await aj45(`/api/metrics/${RC}/detail?mode=YTD&year=2025`);
        assert.strictEqual(d.is_ess_summary, true);
        assert.strictEqual(d.total_respondents, 7756);
        assert.strictEqual(d.ess_period_label, 'November 2025');
        assert.strictEqual(d.latest_survey_period, '2025-11');
        assert.deepStrictEqual(d.questions_breakdown.map(q => q.percent_favorable), [96, 90, 90]);
        // v2.50.0: the texts are the Manage Questions texts (G = question 1 ...), the file header text is only file_label
        const configured45 = (await aj45(`/api/admin/survey-questions/${RC}`)).questions;
        assert.deepStrictEqual(d.questions_breakdown.map(q => q.text), configured45.map(q => q.text || q.label));
        assert.deepStrictEqual(d.questions_breakdown.map(q => q.file_label), QS45);
        assert.strictEqual(d.question_text_source, 'SNAPSHOT');
        assert.strictEqual(d.questions_changed_since_upload, false, 'uploaded with the current questions');
        assert.ok(d.questions_breakdown.every(q => q.percent_neutral === null && q.percent_unfavorable === null));
        assert.strictEqual(d.ess_results_by_directorate.length, 13);
        assert.strictEqual(d.ess_results_by_directorate[0].org_level, 'BANKWIDE');
        assert.strictEqual(d.ess_results_by_directorate[0].is_selected, true);
        assert.strictEqual(d.ess_upload.upload_id, uploads45[0]);
        assert.strictEqual(d.responses.length, 0);
      });

      await runTest('[POSITIVE] A User scoped to two directorates (one with a division subset) gets the participation-weighted mean of both directorate rows, never the Bankwide row', async () => {
        const SA = (await currentDirectorateName())('Special Asset');   // v2.51.0: "SLC ASG Satyaguna Langgeng Capital" once the Admin renamed it
        const u = await mkUser45('s', [{ directorate: 'Business Banking', divisions: null }, { directorate: SA, divisions: null }]);
        const calc = await asUj45(u, '/api/metrics/calculate?mode=YTD&year=2025'); // v2.36.0: strict period
        const m = calc.metrics.find(x => x.metric_id === RC);
        assert.strictEqual(m.sample_size, 449 + 39);
        assert.strictEqual(m.normalized_score, parseFloat(((91 * 449 + 98 * 39) / 488).toFixed(2)));
        const d = await asUj45(u, `/api/metrics/${RC}/detail?mode=YTD&year=2025`);
        assert.deepStrictEqual(d.ess_results_by_directorate.map(r => r.directorate).sort(), ['Business Banking', SA].sort());
        assert.ok(d.ess_results_by_directorate.every(r => r.org_level === 'DIRECTORATE'), 'no Bankwide row for a User');
        const one = await asUj45(u, `/api/metrics/calculate?mode=YTD&year=2025&directorate=${encodeURIComponent(SA)}`);
        assert.strictEqual(one.metrics.find(x => x.metric_id === RC).normalized_score, 98);
        // an employee directorate row the user may not see stays a 403
        assert.strictEqual((await rawFetch(`${BASE_URL}/api/metrics/${RC}/detail?period=YTD&directorate=${encodeURIComponent('Human Resources')}`, asUser(u.cookie))).status, 403);
      });

      await runTest('[POSITIVE] Re-uploading the same metric + period replaces its rows (still 13), keeps both uploads in the history; evidence CSV lists the stored summary rows with the upload', async () => {
        const before = await history45();
        const res = await postEssFile(RC, await realFile45(), 'ESS 2025 Result_Role Clarity & DS Support (again).xlsx');
        const body = await res.json();
        assert.strictEqual(res.status, 200);
        uploads45.push(body.upload_id);
        assert.strictEqual(body.replaced_previous, true);
        assert.strictEqual(body.replaced_rows, 13);
        assert.strictEqual(await history45(), before + 1, 'history keeps both upload records');
        const d = await aj45(`/api/metrics/${RC}/detail?mode=YTD&year=2025`);
        assert.strictEqual(d.ess_results_by_directorate.length, 13);
        assert.strictEqual(d.ess_upload.upload_id, body.upload_id);
        const evRes = await fetch(`${BASE_URL}/api/surveys/evidence?metric_id=${RC}&period=YTD`);
        assert.strictEqual(evRes.status, 200);
        const lines = (await evRes.text()).replace(/^﻿/, '').split(/\r\n/);
        assert.match(lines[0], /^Directorate,Level,Year,Month,Participation,Index_%,/);
        assert.ok(lines[0].includes('Upload_ID') && lines[0].includes('Uploaded_By'));
        const nov = lines.filter(l => l.includes(',2025,November,'));
        assert.strictEqual(nov.length, 13);
        assert.ok(nov.every(l => l.includes(body.upload_id)), 'every row names its upload');
        assert.ok(nov[0].startsWith('PT Bank CIMB Niaga Tbk,Bankwide,2025,November,7756,92,96,90,90,'));
      });

      await runTest('[NEGATIVE] Invalid ESS files are refused as a whole (400 + every error with its row) and store nothing: unknown directorate, mixed months, score out of range, missing column, duplicate directorate, empty sheet, formula without a saved value, non-xlsx bytes named .xlsx; CSV to an ESS metric -> 415/400; .xlsx to a SYSTEM metric -> 400', async () => {
        const head = ESS_HEAD();
        const bank = ['PT Bank CIMB Niaga Tbk', 'Bankwide', 2025, 'November', 100, 0.8, 0.8];
        const formulaFile = async () => {
          const JSZip = require('jszip');
          const zip = await JSZip.loadAsync(await essXlsx([head, bank]));
          const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
          zip.file('xl/worksheets/sheet1.xml', sheet.replace('<c r="F2"><v>0.8</v></c>', '<c r="F2"><f>AVERAGE(G2:G2)</f></c>'));
          return zip.generateAsync({ type: 'nodebuffer' });
        };
        const cases = [
          ['unknown directorate', await essXlsx([head, bank, ['Direktorat Fiktif', 'Directorate', 2025, 'November', 5, 0.8, 0.8]]), 3],
          ['mixed months', await essXlsx([head, bank, ['Business Banking', 'Directorate', 2025, 'December', 5, 0.8, 0.8]]), 3],
          ['score out of range', await essXlsx([head, ['PT Bank CIMB Niaga Tbk', 'Bankwide', 2025, 'November', 100, 150, 0.8]]), 2],
          ['question out of range', await essXlsx([head, ['PT Bank CIMB Niaga Tbk', 'Bankwide', 2025, 'November', 100, 0.8, -1]]), 2],
          ['bad participation', await essXlsx([head, ['PT Bank CIMB Niaga Tbk', 'Bankwide', 2025, 'November', 12.5, 0.8, 0.8]]), 2],
          ['missing column', await essXlsx([['Directorate', 'Level', 'Year', 'Month', 'Index'], ['PT Bank CIMB Niaga Tbk', 'Bankwide', 2025, 'November', 0.8]]), 1],
          ['duplicate directorate', await essXlsx([head, bank, ['Business Banking', 'Directorate', 2025, 'November', 5, 0.8, 0.8], ['business banking', 'Directorate', 2025, 'November', 6, 0.7, 0.7]]), 4],
          ['empty sheet', await essXlsx([head]), null],
          ['formula without a saved value', await formulaFile(), 2],
          ['not an xlsx', Buffer.from('nip,score\n1,2\n'), null]
        ];
        const before = await history45();
        const calcBefore = await m9calc('period=YTD');
        for (const [label, buf, row] of cases) {
          const res = await postEssFile(RC, buf, `bad_${label.replace(/\W+/g, '_')}.xlsx`);
          const body = await res.json();
          assert.strictEqual(res.status, 400, `${label}: ${res.status}`);
          assert.strictEqual(body.success, false, label);
          assert.ok(Array.isArray(body.errors) && body.errors.length > 0, `${label}: errors listed`);
          if (row !== null) assert.ok(body.errors.some(e => e.row_number === row), `${label}: row ${row} named (${JSON.stringify(body.errors)})`);
          assert.ok(body.errors.every(e => typeof e.reason === 'string' && e.reason.length > 5), label);
        }
        const csvFile = await postEssFile(RC, Buffer.from('nip,rating_score\n1,4\n'), 'ess.csv');
        assert.strictEqual(csvFile.status, 415);
        assert.match((await csvFile.json()).error, /\.xlsx/);
        const xls = await postEssFile(RC, Buffer.from('x'), 'ess.xls');
        assert.strictEqual(xls.status, 415);
        const csvText = await adminJson('POST', '/api/surveys/upload', { csvText: 'nip,rating_score\n1,4', fileName: 'x.csv', metric_id: RC });
        assert.strictEqual(csvText.status, 400);
        const toSystem = await postEssFile(8, await essXlsx([head, bank]), 'sys.xlsx');
        assert.strictEqual(toSystem.status, 400);
        assert.strictEqual(await history45(), before, 'nothing was recorded');
        const calcAfter = await m9calc('period=YTD');
        assert.deepStrictEqual([calcAfter.normalized_score, calcAfter.sample_size], [calcBefore.normalized_score, calcBefore.sample_size], 'the stored result is unchanged');
      });

      await runTest('[POSITIVE/NEGATIVE] Access: the PIC of an ESS metric uploads its summary (no Bankwide in their evidence, no bankwide calculation in the answer) and downloads its original file; a non-PIC User gets 403 on upload, evidence and the original file; the Admin downloads the exact uploaded bytes; unknown / seed uploads -> 404', async () => {
        const pic = await mkUser45('p', [{ directorate: 'Business Banking', divisions: null }]);
        const other = await mkUser45('o', [{ directorate: 'Business Banking', divisions: null }]);
        const created = await adminJson('POST', '/api/admin/metrics', { metric_name: 'REGRESSION ESS45 PIC Metric', metric_type: 'SURVEY', scale_type: 'PERCENTAGE', survey_source: 'ESS', journey_id: 2, checkpoint_id: 5, target_value: 85, min_threshold: 80, pic_email: pic.email });
        assert.strictEqual(created.status, 201);
        const mid = (await created.json()).metric.metric_id;
        metrics45.push(mid);
        // v2.50.0: the file's question columns must match the configured questions in number (2 here)
        assert.strictEqual((await adminJson('POST', `/api/admin/survey-questions/${mid}`, { questions: [
          { key: 'q1_a', label: 'Q A', text: 'Q A', type: 'SCALE_1_5', mandatory: true }, { key: 'q2_b', label: 'Q B', text: 'Q B', type: 'SCALE_1_5', mandatory: true }] })).status, 200);
        const file = await essXlsx([ESS_HEAD('PIC Index', ['Q A', 'Q B']), ['PT Bank CIMB Niaga Tbk', 'Bankwide', 2026, 2, 50, 0.81, 0.8, 0.82], ['Business Banking', 'Directorate', 2026, 'Feb', 20, 82, 80, ''], ['Human Resources', 'Directorate', 2026, 'Februari', 30, '79%', 0.79, 0.79]]);
        const res = await postEssFile(mid, file, 'pic45.xlsx', pic.cookie);
        const body = await res.json();
        assert.strictEqual(res.status, 200, JSON.stringify(body).slice(0, 300));
        uploads45.push(body.upload_id);
        assert.strictEqual(body.period, '2026-02'); assert.strictEqual(body.rows_imported, 3); assert.strictEqual(body.bankwide_index, 81);
        assert.strictEqual(body.calculation, undefined);
        // PIC: evidence only for their scope (Business Banking), no Bankwide / other directorate rows
        const ev = await rawFetch(`${BASE_URL}/api/surveys/evidence?metric_id=${mid}&period=YTD`, asUser(pic.cookie));
        assert.strictEqual(ev.status, 200);
        const evRows = (await ev.text()).replace(/^﻿/, '').split(/\r\n/).slice(1);
        assert.deepStrictEqual(evRows.map(l => l.split(',')[0].replace(/"/g, '')), ['Business Banking']);
        const own = await rawFetch(`${BASE_URL}/api/surveys/ess-file/${body.upload_id}`, asUser(pic.cookie));
        assert.strictEqual(own.status, 200);
        // non-PIC user: 403 on upload, evidence and the original file
        assert.strictEqual((await postEssFile(mid, file, 'x.xlsx', other.cookie)).status, 403);
        assert.strictEqual((await postEssFile(RC, await realFile45(), 'x.xlsx', other.cookie)).status, 403);
        assert.strictEqual((await rawFetch(`${BASE_URL}/api/surveys/evidence?metric_id=${mid}&period=YTD`, asUser(other.cookie))).status, 403);
        assert.strictEqual((await rawFetch(`${BASE_URL}/api/surveys/ess-file/${body.upload_id}`, asUser(other.cookie))).status, 403);
        assert.strictEqual((await rawFetch(`${BASE_URL}/api/surveys/ess-file/${uploads45[0]}`, asUser(pic.cookie))).status, 403, 'the PIC of another metric');
        // Admin: exact bytes back; unknown / seed upload -> 404
        const adm = await fetch(`${BASE_URL}/api/surveys/ess-file/${body.upload_id}`);
        assert.strictEqual(adm.status, 200);
        assert.ok(Buffer.from(await adm.arrayBuffer()).equals(Buffer.from(file)), 'the stored original file is byte-identical');
        assert.strictEqual((await fetch(`${BASE_URL}/api/surveys/ess-file/nope-123`)).status, 404);
        assert.strictEqual((await fetch(`${BASE_URL}/api/surveys/ess-file/seed-ess-${RC}-2025-11`)).status, 404, 'seed data has no original file');
        // the uploaded values drive the metric (Bankwide 81 for the Admin; Business Banking 82 for the scoped PIC)
        assert.strictEqual((await aj45(`/api/metrics/calculate?mode=YTD&year=2026`)).metrics.find(m => m.metric_id === mid).normalized_score, 81);
        assert.strictEqual((await asUj45(pic, '/api/metrics/calculate?mode=YTD&year=2026')).metrics.find(m => m.metric_id === mid).normalized_score, 82);
        // deleting the metric deletes its ESS results and uploads (documented cascade)
        assert.strictEqual((await adminJson('DELETE', `/api/admin/metrics/${mid}`)).status, 200);
        metrics45.splice(metrics45.indexOf(mid), 1);
        assert.ok(!(await aj45('/api/surveys/history')).some(h => h.upload_id === body.upload_id), 'upload record removed with the metric');
      });

      if (storageBackendIsSql45()) {
        await runTest('[POSITIVE] (SQL Server) Reminders see an ESS summary as the data of its year (hasSurveyDataInPeriod), and px_ess_results enforces one row per org unit and period', async () => {
          const st = require('../server/db/storage');
          assert.strictEqual(await st.hasSurveyDataInPeriod(RC, '2025-01-01', '2026-01-01'), true);
          assert.strictEqual(await st.hasSurveyDataInPeriod(RC, '2025-11-01', '2025-12-01'), true);
          assert.strictEqual(await st.hasSurveyDataInPeriod(RC, '2025-12-01', '2026-01-01'), false);
          const rows = await st.getEssResults(RC, { year: 2025, month: 11 });
          assert.strictEqual(rows.length, 13);
          assert.strictEqual(rows.filter(r => r.org_level === 'BANKWIDE').length, 1);
        });
      }
    } finally {
      // restore the seed 2025-11 result of Role Clarity: the real file carries exactly the seed values
      if (rcTouched) {
        const r = await postEssFile(RC, await realFile45(), 'ESS 2025 Result_Role Clarity & DS Support.xlsx');
        const rb = await r.json();
        if (rb.upload_id) uploads45.push(rb.upload_id); else console.error('     cleanup: Role Clarity seed result could not be restored', JSON.stringify(rb).slice(0, 200));
        if (storageBackendIsSql45()) {
          // SQL: exact restore - the rows go back on the seed upload, the test uploads leave the history
          const sql = require('mssql');
          const pool = await new sql.ConnectionPool({ server: process.env.DB_SERVER || 'localhost', port: parseInt(process.env.DB_PORT || '1433', 10), database: process.env.DB_NAME || 'PeopleExperiencePX',
            user: process.env.DB_USER, password: process.env.DB_PASSWORD, options: { encrypt: false, trustServerCertificate: true } }).connect();
          try {
            await pool.request().input('m', sql.Int, RC).input('u', sql.NVarChar, `seed-ess-${RC}-2025-11`)
              .query('UPDATE dbo.px_ess_results SET upload_id = @u WHERE metric_id = @m AND survey_year = 2025 AND survey_month = 11');
            // v2.50.0: an upload stores a question snapshot per row; the seed rows hold only the file's header text
            const cur45 = await currentDirectorateName();   // v2.51.0: the seed spells the four renamed directorates the new way
            for (const r of require('../server/db/seedData').initialEssResults.filter(x => x.metric_id === RC && x.survey_year === 2025 && x.survey_month === 11)) {
              await pool.request().input('m', sql.Int, RC).input('q', sql.NVarChar(sql.MAX), JSON.stringify(r.questions)).input('d', sql.NVarChar, r.directorate ? cur45(r.directorate) : r.directorate)
                .query(`UPDATE dbo.px_ess_results SET questions_json = @q WHERE metric_id = @m AND survey_year = 2025 AND survey_month = 11
                        AND ${r.org_level === 'BANKWIDE' ? "org_level = 'BANKWIDE'" : "org_level = 'DIRECTORATE' AND directorate = @d"}`);
            }
            for (const id of uploads45.filter(Boolean)) await pool.request().input('u', sql.NVarChar, id).query('DELETE FROM dbo.px_survey_uploads WHERE upload_id = @u');
          } finally {
            await pool.close();
          }
        }
      }
      for (const id of uploads45.filter(Boolean)) {
        const f = path45.join(ess45.ESS_UPLOAD_DIR, `${id}.xlsx`);
        if (fs45.existsSync(f)) fs45.unlinkSync(f);
      }
      for (const id of metrics45) await adminJson('DELETE', `/api/admin/metrics/${id}`);
      for (const id of users45) await adminJson('DELETE', `/api/admin/users/${id}`);
    }
  }

  // --- MODULE 46 (v2.36.0): EXACT PERIOD WINDOWS - YTD UP TO THIS MONTH, STRICT ESS PERIOD, NO_DATA INSTEAD OF A STATIC FALLBACK ---
  // YTD of the current year = Jan 1 .. end of the current month (real clock), a past year = the full year, MTD = that
  // month only; an ESS result only counts inside the window; a SURVEY metric without data in the window is NO_DATA
  // (null scores) and stays out of the Survey Index, the journey / checkpoint rollups and the alerts.
  console.log('\n📦 MODULE 46: Exact period windows (YTD to this month, strict ESS period) and NO_DATA survey metrics (Positive & Negative Testing)');
  {
    const aj46 = async q => (await adminJson('GET', q)).json();
    const now46 = new Date();
    const Y46 = now46.getFullYear();
    const M46 = now46.getMonth() + 1;
    const mm46 = n => String(n).padStart(2, '0');
    const calc46 = q => aj46(`/api/metrics/calculate?${q}`);
    const metricOf46 = (calc, id) => calc.metrics.find(m => m.metric_id === id);
    const params46 = (await aj46('/api/admin/parameters')).metrics;
    const rc46 = params46.find(m => m.metric_type === 'SURVEY' && m.survey_source === 'ESS' && /role clarity/i.test(m.metric_name));
    const RC46 = rc46 ? rc46.metric_id : 9;
    const SYS46 = 8; // Onboarding 30/60/90 (SYSTEM survey, employee metric)
    const isSql46 = () => require('../server/db/storage').backend === 'sql';

    await runTest('[POSITIVE] YTD of the current year ends with the current month: a response dated next month is left out of YTD but counted in MTD of that month (planted and removed again)', async () => {
      if (M46 === 12) { console.log('     (December: there is no later month in this year - only the window equality is checked)'); }
      const ytd0 = metricOf46(await calc46(`mode=YTD&year=${Y46}`), SYS46).sample_size;
      // the default YTD window equals an explicit endMonth = this month, and an endMonth past this month is capped to it
      assert.strictEqual(metricOf46(await calc46(`mode=YTD&year=${Y46}&endMonth=${mm46(M46)}`), SYS46).sample_size, ytd0);
      assert.strictEqual(metricOf46(await calc46(`mode=YTD&year=${Y46}&endMonth=12`), SYS46).sample_size, ytd0, 'endMonth beyond this month is capped');
      if (M46 === 12) return;
      if (!isSql46()) { console.log('     (JSON backend: the planted response cannot be removed from outside the server - planting skipped)'); return; }
      const next = `${Y46}-${mm46(M46 + 1)}`;
      const mtd0 = metricOf46(await calc46(`mode=MTD&year=${Y46}&month=${mm46(M46 + 1)}`), SYS46).sample_size;
      const csv = [
        'nip,employee_name,cimb_email,directorate,division,metric_id,metric_name,q1_role_clarity,q2_supervisor_support,q3_buddy_support,q4_resource_access,verbatim_feedback,survey_date',
        `8846001,Regression Window46,window46@cimbniaga.co.id,Human Resources,People Experience & Culture,${SYS46},Onboarding 30/60/90 Satisfaction Index,4.0,4.0,4.0,4.0,Module 46 window probe,${next}-05`
      ].join('\r\n');
      let uploadId = null;
      try {
        const res = await adminJson('POST', '/api/surveys/upload', { csvText: csv, fileName: 'module46_window_probe.csv', metric_id: SYS46 });
        const body = await res.json();
        assert.strictEqual(res.status, 200, JSON.stringify(body).slice(0, 300));
        uploadId = body.upload_id || (body.upload && body.upload.upload_id) || null;
        assert.strictEqual(body.valid_rows, 1);
        assert.strictEqual(metricOf46(await calc46(`mode=YTD&year=${Y46}`), SYS46).sample_size, ytd0, `a response dated ${next}-05 is outside YTD ${Y46}`);
        assert.strictEqual(metricOf46(await calc46(`mode=MTD&year=${Y46}&month=${mm46(M46 + 1)}`), SYS46).sample_size, mtd0 + 1, `but inside MTD ${next}`);
      } finally {
        const sql = require('mssql');
        const pool = await new sql.ConnectionPool({ server: process.env.DB_SERVER || 'localhost', port: parseInt(process.env.DB_PORT || '1433', 10), database: process.env.DB_NAME || 'PeopleExperiencePX',
          user: process.env.DB_USER, password: process.env.DB_PASSWORD, options: { encrypt: false, trustServerCertificate: true } }).connect();
        try {
          // only this test's own probe: by upload id when known, else by its unique NIP + file name
          const ids = uploadId ? [uploadId] : (await pool.request().query("SELECT upload_id FROM dbo.px_survey_uploads WHERE file_name = 'module46_window_probe.csv'")).recordset.map(r => r.upload_id);
          for (const id of ids) {
            await pool.request().input('u', sql.NVarChar, id).query('DELETE FROM dbo.px_survey_uploaded_responses WHERE upload_id = @u');
            await pool.request().input('u', sql.NVarChar, id).query('DELETE FROM dbo.px_survey_uploads WHERE upload_id = @u');
          }
        } finally {
          await pool.close();
        }
      }
    });

    await runTest('[POSITIVE] A past year YTD is the full year (= endMonth 12, more than up to November); MTD counts only the rows of that month', async () => {
      const full = metricOf46(await calc46('mode=YTD&year=2025'), SYS46);
      assert.strictEqual(metricOf46(await calc46('mode=YTD&year=2025&endMonth=12'), SYS46).sample_size, full.sample_size);
      const toNov = metricOf46(await calc46('mode=YTD&year=2025&endMonth=11'), SYS46).sample_size;
      const dec = metricOf46(await calc46('mode=MTD&year=2025&month=12'), SYS46).sample_size;
      assert.ok(dec > 0, 'the seed has December 2025 rows');
      assert.strictEqual(full.sample_size, toNov + dec, 'full year = Jan..Nov + December');
      const sep = `${Y46 - (M46 > 9 ? 0 : 1)}-09`;
      const d = await aj46(`/api/metrics/${SYS46}/detail?mode=MTD&year=${sep.slice(0, 4)}&month=09`);
      assert.strictEqual(d.total_respondents, metricOf46(await calc46(`mode=MTD&year=${sep.slice(0, 4)}&month=09`), SYS46).sample_size);
      assert.ok(d.responses.length > 0 && d.responses.every(r => String(r.survey_date).startsWith(sep)), `MTD ${sep}: only rows of that month`);
    });

    // v2.50.0: ESS runs once a year (November): every period reads the LATEST result on or before its end, from any
    // earlier year (carry-forward; replaces the v2.37.0 exact-month rule). Seed: 2025-11 only (metric 9 = the real file).
    const essSeed46 = require('../server/db/seedData').initialEssResults;
    const essOf46 = c => c.metrics.filter(m => m.metric_type === 'SURVEY' && m.survey_source === 'ESS');

    await runTest('[POSITIVE] ESS carry-forward: Role Clarity MTD 2025-11 = YTD 2025 = 92 (basis LATEST_RESULT, not carried); MTD 2026-06 and YTD 2026 read 2025-11 (= 92, carried forward); the detail says so', async () => {
      assert.strictEqual(rc46 ? rc46.update_frequency : 'ONE_TIME_ANNUAL', 'ONE_TIME_ANNUAL', 'still annual (reminders only)');
      const nov = metricOf46(await calc46('mode=MTD&year=2025&month=11'), RC46);
      assert.deepStrictEqual([nov.normalized_score, nov.ess_period, nov.ess_carried_forward], [92, '2025-11', false]);
      assert.deepStrictEqual(nov.period_window, { from: '2025-11-01', to: '2025-11-30', basis: 'LATEST_RESULT' });
      const y25 = metricOf46(await calc46('mode=YTD&year=2025'), RC46);
      assert.deepStrictEqual([y25.normalized_score, y25.ess_period, y25.ess_carried_forward], [92, '2025-11', false]);
      const jun = metricOf46(await calc46('mode=MTD&year=2026&month=06'), RC46);
      assert.deepStrictEqual([jun.normalized_score, jun.ess_period, jun.sample_size, jun.ess_carried_forward], [92, '2025-11', 7756, true]);
      assert.deepStrictEqual(jun.period_window, { from: '2026-06-01', to: '2026-06-30', basis: 'LATEST_RESULT' });
      const y26 = metricOf46(await calc46('mode=YTD&year=2026'), RC46);
      assert.deepStrictEqual([y26.normalized_score, y26.ess_period, y26.ess_carried_forward], [92, '2025-11', true]);
      const d = await aj46(`/api/metrics/${RC46}/detail?mode=MTD&year=2026&month=06`);
      assert.deepStrictEqual([d.ess_period, d.ess_period_label, d.ess_carried_forward, d.normalized_score, d.ess_results_by_directorate.length, d.period_window.basis],
        ['2025-11', 'November 2025', true, 92, 13, 'LATEST_RESULT']);
    });

    await runTest('[NEGATIVE] ESS without a result on or before the period is NO_DATA: MTD 2025-10, MTD 2024-12, YTD 2024 and a month that has not started yet; MTD 2025-12 / 2026-01 / 2026-03 hold all 11 from 2025-11', async () => {
      const oct = metricOf46(await calc46('mode=MTD&year=2025&month=10'), RC46);
      assert.deepStrictEqual([oct.status, oct.has_data, oct.raw_value, oct.normalized_score, oct.sample_size, oct.gap, oct.ess_period || null], ['NO_DATA', false, null, null, 0, null, null]);
      assert.deepStrictEqual(oct.period_window, { from: '2025-10-01', to: '2025-10-31', basis: 'LATEST_RESULT' });
      const empties = ['mode=MTD&year=2025&month=10', 'mode=MTD&year=2024&month=12', 'mode=YTD&year=2024'];
      if (M46 < 12) empties.push(`mode=MTD&year=${Y46}&month=${mm46(M46 + 1)}`); // not started yet
      for (const q of empties) {
        const ess = essOf46(await calc46(q));
        assert.ok(ess.length >= 11 && ess.every(m => m.status === 'NO_DATA'), `${q}: ${ess.filter(m => m.has_data).map(m => m.metric_id)}`);
      }
      for (const p of ['2025-12', '2026-01', '2026-03']) {
        const ess = essOf46(await calc46(`mode=MTD&year=${p.slice(0, 4)}&month=${p.slice(5)}`)).filter(m => m.metric_id <= 27);
        assert.ok(ess.length === 11 && ess.every(m => m.has_data && m.ess_period === '2025-11' && m.ess_carried_forward === true), `MTD ${p}`);
      }
    });

    await runTest('[POSITIVE] The 2025-11 rows of Role Clarity are still exactly the user\'s real file (index + participation + question scores of all 13 org units)', async () => {
      const d = await aj46(`/api/metrics/${RC46}/detail?mode=MTD&year=2025&month=11`);
      const seedRows = essSeed46.filter(r => r.metric_id === RC46 && r.survey_year === 2025 && r.survey_month === 11);
      assert.strictEqual(d.ess_results_by_directorate.length, 13);
      const cur46 = await currentDirectorateName();   // v2.51.0: the seed spells the four renamed directorates the new way
      for (const r of seedRows) {
        const got = d.ess_results_by_directorate.find(x => (r.org_level === 'BANKWIDE' ? x.org_level === 'BANKWIDE' : x.directorate === cur46(r.directorate)));
        assert.ok(got, r.directorate || 'Bankwide');
        assert.deepStrictEqual([got.index_score, got.participation, got.questions.map(q => q.score)],
          [parseFloat(r.index_score.toFixed(2)), r.participation, r.questions.map(q => q.score)], r.directorate || 'Bankwide');
      }
      assert.strictEqual(d.ess_results_by_directorate.find(x => x.org_level === 'BANKWIDE').index_score, 92);
    });

    if (isSql46()) {
      await runTest('[POSITIVE/NEGATIVE] (SQL Server) An admin ESS upload of a 2026 period survives the boot (seed top-up + dummy cleanup) and becomes the latest result: MTD / YTD 2026-06 read it, 2026-05 still carries 2025-11; removed again afterwards', async () => {
        const st = require('../server/db/storage');
        const ess46 = require('../server/services/essSummaryService');
        const sql = require('mssql');
        const file = await essXlsx([ESS_HEAD('Role Clarity & DS Support Index', ['Q1', 'Q2', 'Q3']), ['PT Bank CIMB Niaga Tbk', 'Bankwide', 2026, 'June', 321, 0.7777, 0.7, 0.8, 0.8]]);
        let uploadId = null;
        const pool = await new sql.ConnectionPool({ server: process.env.DB_SERVER || 'localhost', port: parseInt(process.env.DB_PORT || '1433', 10), database: process.env.DB_NAME || 'PeopleExperiencePX',
          user: process.env.DB_USER, password: process.env.DB_PASSWORD, options: { encrypt: false, trustServerCertificate: true } }).connect();
        try {
          const res = await postEssFile(RC46, file, 'module46_overwrite_probe.xlsx');
          const body = await res.json();
          assert.strictEqual(res.status, 200, JSON.stringify(body).slice(0, 300));
          uploadId = body.upload_id;
          assert.deepStrictEqual([body.period, body.replaced_rows], ['2026-06', 0], 'no seed rows for 2026-06 any more');
          await st.init(); // the boot: seed top-up + removal of the old dummy quarters
          const after = await st.getEssResults(RC46, { year: 2026, month: 6 });
          assert.deepStrictEqual(after.map(r => [r.upload_id, r.index_score, r.participation]), [[uploadId, 77.77, 321]], 'the upload survives the boot');
          assert.strictEqual(metricOf46(await calc46('mode=MTD&year=2026&month=06'), RC46).normalized_score, 77.77);
          assert.strictEqual(metricOf46(await calc46('mode=YTD&year=2026'), RC46).ess_period, '2026-06');
          assert.deepStrictEqual([metricOf46(await calc46('mode=MTD&year=2026&month=05'), RC46).ess_period, metricOf46(await calc46('mode=MTD&year=2026&month=05'), RC46).normalized_score], ['2025-11', 92]);
        } finally {
          await pool.request().input('m', sql.Int, RC46).query('DELETE FROM dbo.px_ess_results WHERE metric_id = @m AND survey_year = 2026 AND survey_month = 6');
          if (uploadId) {
            await pool.request().input('u', sql.NVarChar, uploadId).query('DELETE FROM dbo.px_survey_uploads WHERE upload_id = @u');
            const f = require('path').join(ess46.ESS_UPLOAD_DIR, `${uploadId}.xlsx`);
            if (require('fs').existsSync(f)) require('fs').unlinkSync(f);
          }
          await pool.close();
        }
      });
    }

    await runTest('[POSITIVE] update_frequency no longer changes the period: a SYSTEM survey set to Annual still reads only month M under MTD Y-M (basis MONTH); setting restored', async () => {
      const before = params46.find(m => m.metric_id === SYS46).update_frequency || 'MONTHLY';
      const mtdMonthly = metricOf46(await calc46('mode=MTD&year=2025&month=06'), SYS46);
      assert.deepStrictEqual(mtdMonthly.period_window, { from: '2025-06-01', to: '2025-06-30', basis: 'MONTH' });
      const ytdToJune = metricOf46(await calc46('mode=YTD&year=2025&endMonth=06'), SYS46);
      assert.ok(ytdToJune.sample_size > mtdMonthly.sample_size, 'Jan..June holds more rows than June alone');
      try {
        assert.strictEqual((await adminJson('PUT', `/api/admin/metrics/${SYS46}`, { update_frequency: 'ONE_TIME_ANNUAL' })).status, 200);
        const mtdAnnual = metricOf46(await calc46('mode=MTD&year=2025&month=06'), SYS46);
        assert.deepStrictEqual([mtdAnnual.sample_size, mtdAnnual.raw_value], [mtdMonthly.sample_size, mtdMonthly.raw_value]);
        assert.deepStrictEqual(mtdAnnual.period_window, { from: '2025-06-01', to: '2025-06-30', basis: 'MONTH' });
        const d = await aj46(`/api/metrics/${SYS46}/detail?mode=MTD&year=2025&month=06`);
        assert.strictEqual(d.total_respondents, mtdMonthly.sample_size);
        assert.strictEqual(d.update_frequency, 'ONE_TIME_ANNUAL');
        assert.strictEqual(d.period_window.basis, 'MONTH');
      } finally {
        await adminJson('PUT', `/api/admin/metrics/${SYS46}`, { update_frequency: before });
      }
      assert.strictEqual(metricOf46(await calc46('mode=MTD&year=2025&month=06'), SYS46).sample_size, mtdMonthly.sample_size, 'Monthly again');
    });

    await runTest('[POSITIVE] OUTCOME metrics without uploaded monthly values are a current snapshot: the same value for any YTD / MTD filter, never NO_DATA', async () => {
      const a = await calc46(`mode=YTD&year=${Y46}`);
      const b = await calc46('mode=MTD&year=2025&month=03');
      const c = await calc46(`mode=YTD&year=${Y46 + 1}`);
      // v2.54.0: an OUTCOME metric with uploaded monthly values follows the window instead (Module 56)
      // v2.55.0: and so does an OUTCOME summary-part metric with uploaded summaries (19, 20 - Module 59)
      const outA = a.metrics.filter(m => m.metric_type === 'OUTCOME' && m.value_basis !== 'MONTHLY_VALUES' && m.data_upload !== 'PART_SUMMARY');
      assert.ok(outA.length > 0);
      for (const m of outA) {
        for (const other of [b, c]) {
          const x = metricOf46(other, m.metric_id);
          assert.deepStrictEqual([x.status === 'NO_DATA', x.raw_value, x.period_window], [false, m.raw_value, null], `metric ${m.metric_id}`);
        }
      }
      if (!a.metrics.some(m => m.value_basis === 'MONTHLY_VALUES' || m.data_upload === 'PART_SUMMARY')) assert.strictEqual(a.outcome_index, c.outcome_index);
    });

    await runTest('[POSITIVE] Survey Index = weighted mean of the survey metrics WITH data only; PX = the configured weights (default 70/30) with basis BOTH; journeys / checkpoints only roll up metrics with data', async () => {
      const c = await calc46('mode=MTD&year=2025&month=10'); // SYSTEM surveys have October 2025 rows, ESS has no result on or before it (v2.50.0)
      const live = c.metrics.filter(m => !m.is_disabled && !m.excluded_from_index);
      const noData = live.filter(m => m.status === 'NO_DATA');
      // v2.54.0: OUTCOME metrics with uploaded monthly values but none in October 2025 (and N/A metrics) are NO_DATA too
      assert.ok(noData.length > 0 && noData.every(m => (m.metric_type === 'SURVEY' || m.value_basis === 'MONTHLY_VALUES' || m.not_applicable || m.data_upload === 'PART_SUMMARY') && m.normalized_score === null), 'the ESS metrics have no data in October 2025');
      assert.strictEqual(c.no_data_metrics_count, noData.length);
      const surveys = live.filter(m => m.metric_type === 'SURVEY' && m.has_data);
      const w = surveys.reduce((s, m) => s + m.weight, 0);
      const expected = surveys.reduce((s, m) => s + m.normalized_score * m.weight, 0) / w;
      assert.ok(Math.abs(c.survey_index - expected) < 0.02, `survey_index ${c.survey_index} vs ${expected.toFixed(2)}`);
      assert.strictEqual(c.survey_metrics_count, surveys.length);
      assert.strictEqual(c.px_index_basis, 'BOTH');
      // v2.51.0: the configured weights (70/30 by default; the suite no longer resets an Admin's own weights)
      assert.ok(Math.abs(c.px_index - (c.px_weights.survey / 100 * c.survey_index + c.px_weights.outcome / 100 * c.outcome_index)) < 0.02);
      for (const j of c.journeys) {
        const jm = j.metrics.filter(m => !m.is_disabled && !m.excluded_from_index && m.has_data && m.metric_type === 'SURVEY');
        if (!jm.length) assert.strictEqual(j.survey_score, null, `journey ${j.journey_id}`);
        else {
          const jw = jm.reduce((s, m) => s + m.weight, 0);
          assert.ok(Math.abs(j.survey_score - jm.reduce((s, m) => s + m.normalized_score * m.weight, 0) / jw) < 0.02, `journey ${j.journey_id}`);
        }
        assert.strictEqual(j.has_data, j.overall_score !== null);
      }
      assert.ok(c.checkpoints.every(cp => (cp.score === null) === !cp.has_data));
    });

    await runTest('[POSITIVE] Alerts never list a NO_DATA metric (no Score Deficit alert without data)', async () => {
      const c = await calc46(`mode=YTD&year=${Y46}`);
      const noDataIds = new Set(c.metrics.filter(m => m.status === 'NO_DATA').map(m => m.metric_id));
      const alerts = await aj46('/api/alerts');
      assert.ok(Array.isArray(alerts.alerts));
      assert.ok(alerts.alerts.every(a => !noDataIds.has(a.metric_id) && typeof a.current_score === 'number'), JSON.stringify(alerts.alerts.map(a => a.metric_id)));
    });

    await runTest('[POSITIVE] Detail of a NO_DATA metric answers 200 with null scores (ESS without a result in the window; SYSTEM survey in a month without rows)', async () => {
      const ess = await aj46(`/api/metrics/${RC46}/detail?mode=MTD&year=2025&month=10`); // v2.50.0: no ESS result on or before October 2025
      assert.deepStrictEqual([ess.status, ess.has_data, ess.current_raw_value, ess.normalized_score], ['NO_DATA', false, null, null]);
      assert.ok(ess.ess_summary && ess.ess_summary.summary_score === null, 'the ESS card has no score for this period');
      const sys = await aj46(`/api/metrics/${SYS46}/detail?mode=MTD&year=${Y46 + 1}&month=01`);
      assert.deepStrictEqual([sys.status, sys.has_data, sys.current_raw_value, sys.normalized_score, sys.total_respondents], ['NO_DATA', false, null, null, 0]);
      assert.ok(sys.questions_breakdown.filter(q => q.type !== 'FREE_TEXT').every(q => q.normalized_score === null && q.avg_score === null), 'no default question scores');
    });

    await runTest('[NEGATIVE] A future year has no survey data: Survey Index null, PX Index = Outcome only (basis OUTCOME_ONLY), every SURVEY metric NO_DATA; an invalid year does not crash', async () => {
      const f = await calc46(`mode=YTD&year=${Y46 + 1}`);
      assert.strictEqual(f.survey_index, null);
      assert.strictEqual(f.px_index_basis, 'OUTCOME_ONLY');
      assert.strictEqual(f.px_index, f.outcome_index);
      assert.ok(f.metrics.filter(m => m.metric_type === 'SURVEY').every(m => m.status === 'NO_DATA'));
      assert.ok(f.journeys.every(j => j.overall_score === null || typeof j.overall_score === 'number'));
      const bad = await adminJson('GET', '/api/metrics/calculate?mode=YTD&year=20x6');
      assert.strictEqual(bad.status, 200);
      const b = await bad.json();
      assert.ok(b.survey_index === null || typeof b.survey_index === 'number');
    });

    await runTest('[NEGATIVE] Trend points of months without survey data are gaps (null survey and PX index), never NaN; months with data have numbers', async () => {
      const r = await adminJson('GET', `/api/metrics/trends?mode=MTD&startYear=2025&startMonth=01&endYear=${Y46}&endMonth=12`);
      assert.strictEqual(r.status, 200);
      const text = await r.text();
      assert.ok(!/NaN/.test(text));
      const body = JSON.parse(text);
      const pts = body.trends;
      assert.ok(Array.isArray(pts) && pts.length > 0);
      assert.ok(pts.every(p => (p.survey_index === null) === (p.px_index === null)), 'PX is a gap exactly where the survey index is');
      assert.ok(pts.every(p => p.survey_index === null || typeof p.survey_index === 'number'));
    });
  }

  // --- MODULE 47 (v2.38.0): EXIT INTERVIEW DASHBOARD - UPLOAD (.XLSX), AGGREGATES, PERIOD / DIRECTORATE FILTER, USER SCOPE ---
  // Fixtures live in months no other data uses (March + November 2019, January 2030) and are removed at the end by NIK prefix
  // and by this run's upload ids (SQL Server only: the JSON server keeps its data in memory, so the module is skipped there).
  console.log('\n📦 MODULE 47: Exit Interview dashboard - .xlsx upload, aggregates, YTD/MTD + directorate filter, USER scope (Positive & Negative Testing)');
  if (require('../server/db/storage').backend !== 'sql') {
    console.log('  ⏭️  SKIPPED: Module 47 needs the SQL Server backend (its fixtures are removed through SQL)');
  } else if (!skipModuleBlock(47)) {
    const exitSvc = require('../server/services/exitInterviewService');
    const { buildXlsx: buildXlsx47, readFirstSheet: readSheet47 } = require('../server/services/xlsxUtils');
    const sql47 = require('mssql');
    const directory47 = await (await rawFetch(`${BASE_URL}/api/directorates`)).json();
    const dirA = directory47.find(d => d.divisions.length > 0);
    const dirB = directory47.find(d => d.directorate_name !== dirA.directorate_name);
    const divA = dirA.divisions[0];
    const FIN = 'Perbankan / Asuransi / Keuangan Lainnya';
    const HEAD47 = [...exitSvc.TEMPLATE_COLUMNS.map(c => c.title), 'Directorate', 'Division'];
    const serial = iso => (Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000;
    // one Termination Report row (35 cells); scores = up to 15 values, the rest "-"
    const fx = o => [o.nik, `Regression Exit ${o.nik}`, o.date, o.d || 'NORMAL_RESIGNATION', o.e, 'U7', '70', o.h || '-', o.i || '-', 'Officer',
      o.k || '-', '-', o.m || '-', o.n || '-', ...Array.from({ length: 15 }, (_, i) => (o.scores && o.scores[i] !== undefined ? o.scores[i] : '-')),
      'Yes', 'Yes', o.af || '-', o.ag || '-', o.dir === undefined ? dirA.directorate_name : o.dir, o.div || ''];
    const xlsx47 = rows => buildXlsx47([['Report Exit Interview (regression)'], HEAD47, ...rows], { headerRow: 1 });
    const postExit = async (buf, fileName = 'module47.xlsx', cookie = null) => {
      const fd = new FormData();
      fd.append('file', new Blob([buf]), fileName);
      return cookie ? realFetch(`${BASE_URL}/api/exit-interview/upload`, { method: 'POST', body: fd, headers: { Cookie: cookie } })
        : fetch(`${BASE_URL}/api/exit-interview/upload`, { method: 'POST', body: fd });
    };
    const summary47 = async (q, cookie = null) => {
      const r = cookie ? await realFetch(`${BASE_URL}/api/exit-interview/summary?${q}`, { headers: { Cookie: cookie } }) : await fetch(`${BASE_URL}/api/exit-interview/summary?${q}`);
      return { status: r.status, body: await r.json() };
    };
    const counts47 = list => Object.fromEntries((list || []).map(i => [i.label, i.count]));
    const FIXTURES = [
      { nik: 'RT47-001', date: serial('2030-01-05'), e: 'MOVE_COMPANY', h: FIN, i: 'Bank Permata', k: 'Kompensasi & benefit yang lebih menarik | Jabatan / posisi lebih tinggi',
        m: 'Kompensasi & benefit yang lebih menarik', n: 'Kurangnya kesempatan karir', scores: Array(15).fill(2), af: 'No' },
      { nik: 'RT47-002', date: '2030-01-06', e: 'BETTER_OFFER', h: FIN, i: 'PT Bank Permata Tbk', k: 'Kompensasi & benefit yang lebih menarik', m: 'Lokasi kantor dekat rumah',
        n: 'Target yang terlalu tinggi | Konflik internal dengan atasan atau rekan kerja', scores: [5, 5, 5, 4], af: 'Yes', div: divA },
      { nik: 'RT47-003', date: '07/01/2030', e: 'MOVE_COMPANY', h: 'Teknologi Informasi', i: 'PT Startup Fiktif', k: 'Pekerjaan yang lebih sesuai dan disukai | Tidak ada',
        m: 'Tidak ada', n: 'Budaya kerja tidak sesuai', scores: [4, 3], af: 'Yes', dir: dirB.directorate_name },
      { nik: 'RT47-004', date: '2030-01-08', e: 'FAMILY' },
      { nik: 'RT47-005', date: '2030-01-09', e: 'OWN_BUSINESS', dir: dirB.directorate_name },
      { nik: 'RT47-006', date: '2030-01-10', d: 'END_OF_CONTRACT', e: 'END_OF_CONTRACT' },
      { nik: 'RT47-007', date: '2030-01-11', e: 'MOVE_COMPANY', k: 'Mobil dinas', m: 'Reputasi perusahaan yang lebih baik', ag: '=HYPERLINK("http://x")' },
      { nik: 'RT47-010', date: '2030-01-12', e: 'MOVE_COMPANY', h: FIN, i: 'Koperasi Fiktif Sejahtera', k: 'Kompensasi & benefit yang lebih menarik' },
      { nik: 'RT47-008', date: '15/03/2019', e: 'PERSONAL' },
      { nik: 'RT47-009', date: '2019-11-20', e: 'MOVE_COMPANY' }
    ];
    const runStart47 = new Date();
    const uploadIds47 = [];
    const userIds47 = [];
    const filesBefore47 = fs47 => (fs47.existsSync(exitSvc.EXIT_UPLOAD_DIR) ? fs47.readdirSync(exitSvc.EXIT_UPLOAD_DIR).length : 0);
    const fs47 = require('fs');
    const dirFiles0 = filesBefore47(fs47);
    let userCookie47 = null;
    try {
      await runTest('[POSITIVE] Admin uploads a Termination Report .xlsx (Excel serial, ISO and dd/mm/yyyy dates, extra Directorate/Division columns): 10 rows stored, audited', async () => {
        const res = await postExit(await xlsx47(FIXTURES.map(fx)), 'module47_fixtures.xlsx');
        const body = await res.json();
        assert.strictEqual(res.status, 200, JSON.stringify(body).slice(0, 400));
        uploadIds47.push(body.upload_id);
        assert.deepStrictEqual([body.rows_imported, body.inserted_rows, body.updated_rows, body.removed_dummy_rows], [10, 10, 0, 0]);
        assert.deepStrictEqual(body.months, ['2019-03', '2019-11', '2030-01']);
        assert.ok(fs47.existsSync(require('path').join(exitSvc.EXIT_UPLOAD_DIR, `${body.upload_id}.xlsx`)), 'original file kept (non-public folder)');
        const audit = await require('../server/db/storage').getAuditLog(30, { includeTest: true });
        assert.ok(audit.some(a => a.action === 'EXIT_INTERVIEW_UPLOAD' && String(a.target).includes(body.upload_id)), 'EXIT_INTERVIEW_UPLOAD audit entry');
        const hist = await (await fetch(`${BASE_URL}/api/exit-interview/uploads`)).json();
        assert.ok(hist.some(u => u.upload_id === body.upload_id && u.source === 'UPLOAD' && /Regression Suite Admin|\(/.test(u.uploaded_by)));
      });

      await runTest('[POSITIVE] MTD 2030-01 bankwide: every card equals the hand-computed values of the fixtures (reasons, industry, top 10, pull factors + KPI, career buckets + average, recommend, themes A and B)', async () => {
        const { status, body: s } = await summary47('mode=MTD&year=2030&month=01');
        assert.strictEqual(status, 200);
        assert.deepStrictEqual(s.counts, { total_records: 8, voluntary_records: 7, movers: 5 });
        assert.deepStrictEqual(counts47(s.reasons.items), { 'Move company': 5, Family: 1, 'Own business': 1 });
        assert.strictEqual(s.reasons.base, 7);
        assert.deepStrictEqual([s.industry.base, counts47(s.industry.items)], [4, { Financial: 3, 'Non-financial': 1 }]);
        assert.strictEqual(s.industry.items[0].pct, 75);
        assert.deepStrictEqual([s.top_financial.base, s.top_financial.items.map(i => [i.label, i.count])], [3, [['PT Bank Permata Tbk', 2], ['Koperasi Fiktif Sejahtera', 1]]]);
        assert.deepStrictEqual([s.pull_factors.base, counts47(s.pull_factors.items), s.pull_factors.kpi.pct], [5, { Compensation: 3, Position: 1, Job: 1, Reputation: 0, Other: 1 }, 60]);
        assert.deepStrictEqual([s.career.base, s.career.buckets.map(b => b.count), s.career.average, s.career.negative, s.career.positive], [3, [0, 1, 0, 1, 1, 0], 3.42, 1, 2]);
        assert.deepStrictEqual([s.recommend.base, counts47(s.recommend.items)], [3, { Yes: 2, No: 1 }]);
        assert.deepStrictEqual([s.themes_open.base, counts47(s.themes_open.items)], [3, { 'Compensation & benefits': 1, 'Location / commute': 1, 'Company reputation': 1 }]);
        const b = s.themes_internal;
        assert.deepStrictEqual([b.negative_base, b.positive_base], [1, 2]);
        const cellOf = label => { const i = b.items.find(x => x.label === label); return i ? [i.negative.count, i.positive.count] : null; };
        assert.deepStrictEqual(cellOf('Career progression & certainty'), [1, 0]);
        assert.deepStrictEqual(cellOf('Workload, targets & role fit'), [0, 1]);
        assert.deepStrictEqual(cellOf('Leadership, fairness & voice'), [0, 1]);
        assert.deepStrictEqual(cellOf('Work environment & culture'), [0, 1]);
        assert.strictEqual(b.items.length, 4);
        assert.ok(/^January 2030 \| 7 voluntary exit records as of January 2030$/.test(s.subtitle), s.subtitle);
      });

      await runTest('[POSITIVE] Period window on Effective Resignation Date: YTD 2019 = both 2019 rows, MTD 2019-03 = only March; YTD of a future year (2030) is empty', async () => {
        const ytd = (await summary47('mode=YTD&year=2019')).body;
        assert.deepStrictEqual([ytd.counts.total_records, ytd.counts.voluntary_records, ytd.counts.movers], [2, 2, 1]);
        assert.strictEqual(ytd.period.label, 'January - December 2019');
        const mtd = (await summary47('mode=MTD&year=2019&month=3')).body;
        assert.deepStrictEqual([mtd.counts.total_records, mtd.counts.movers, counts47(mtd.reasons.items)], [1, 0, { Personal: 1 }]);
        const future = (await summary47('mode=YTD&year=2030')).body;
        assert.strictEqual(future.counts.total_records, 0, 'a future year has no elapsed month');
        assert.ok(/No exit records/.test(future.subtitle));
        assert.strictEqual(future.career.base, 0);
      });

      await runTest('[POSITIVE] Directorate and division filter: directorate B = its 2 rows, directorate A + division = the 1 row of that division', async () => {
        const b = (await summary47(`mode=MTD&year=2030&month=01&directorate=${encodeURIComponent(dirB.directorate_name)}`)).body;
        assert.deepStrictEqual([b.counts.total_records, b.counts.voluntary_records, b.counts.movers, b.scope.label], [2, 2, 1, dirB.directorate_name]);
        const a = (await summary47(`mode=MTD&year=2030&month=01&directorate=${encodeURIComponent(dirA.directorate_name)}&sub_directorate=${encodeURIComponent(divA)}`)).body;
        assert.deepStrictEqual([a.counts.total_records, a.counts.movers, a.recommend.base], [1, 1, 1]);
      });

      await runTest('[NEGATIVE] Bad filters answer 400 (month 13, month missing for MTD, year "20x6") - never a 500', async () => {
        for (const q of ['mode=MTD&year=2030&month=13', 'mode=MTD&year=2030', 'mode=YTD&year=20x6', 'mode=MTD&year=2030&month=1a']) {
          const r = await summary47(q);
          assert.strictEqual(r.status, 400, q);
          assert.ok(r.body.error, q);
        }
      });

      await runTest('[POSITIVE] Re-upload of an existing NIK + date UPDATES that row (upsert) and a new row is inserted', async () => {
        const changed = FIXTURES.find(f => f.nik === 'RT47-002');
        const res = await postExit(await xlsx47([fx({ ...changed, af: 'No' }), fx({ nik: 'RT47-011', date: '2030-01-13', e: 'STUDY' })]), 'module47_upsert.xlsx');
        const body = await res.json();
        assert.strictEqual(res.status, 200, JSON.stringify(body).slice(0, 300));
        uploadIds47.push(body.upload_id);
        assert.deepStrictEqual([body.inserted_rows, body.updated_rows], [1, 1]);
        const s = (await summary47('mode=MTD&year=2030&month=01')).body;
        assert.deepStrictEqual([s.counts.total_records, counts47(s.recommend.items)], [9, { Yes: 1, No: 2 }]);
        assert.strictEqual(counts47(s.reasons.items).Study, 1);
      });

      await runTest('[NEGATIVE] Upload validation refuses the whole file (400, nothing stored): unknown directorate, bad date, score 7, duplicate NIK + date, missing NIK, division of another directorate, no Directorate column', async () => {
        const good = fx({ nik: 'RT47N-001', date: '2030-02-03', e: 'MOVE_COMPANY' });
        const cases = [
          ['unknown directorate', [good, fx({ nik: 'RT47N-002', date: '2030-02-04', e: 'FAMILY', dir: 'Direktorat Fiktif 47' })], /not in the directorate master/],
          ['bad date', [good, fx({ nik: 'RT47N-003', date: '31/02/2030', e: 'FAMILY' })], /Effective Resignation Date must be a date/],
          ['score 7', [good, fx({ nik: 'RT47N-004', date: '2030-02-05', e: 'FAMILY', scores: [5, 7] })], /1-6/],
          ['duplicate', [good, fx({ nik: 'RT47N-001', date: '2030-02-03', e: 'FAMILY' })], /more than once/],
          ['missing NIK', [good, fx({ nik: '', date: '2030-02-06', e: 'FAMILY' })], /NIK is empty/],
          ['foreign division', [good, fx({ nik: 'RT47N-005', date: '2030-02-07', e: 'FAMILY', div: 'Division Fiktif 47' })], /does not belong/]
        ];
        for (const [name, rows, re] of cases) {
          const r = await postExit(await xlsx47(rows), `module47_${name.replace(/\s+/g, '_')}.xlsx`);
          const body = await r.json();
          assert.strictEqual(r.status, 400, name);
          assert.ok(Array.isArray(body.errors) && body.errors.some(e => re.test(e.reason) && e.row_number), `${name}: ${JSON.stringify(body.errors).slice(0, 200)}`);
        }
        const noDir = await buildXlsx47([['t'], exitSvc.TEMPLATE_COLUMNS.map(c => c.title), good.slice(0, 33)], { headerRow: 1 });
        const r = await postExit(noDir, 'module47_nodir.xlsx');
        assert.strictEqual(r.status, 400);
        assert.ok(/Directorate/.test(JSON.stringify(await r.json())));
        const s = (await summary47('mode=MTD&year=2030&month=02')).body;
        assert.strictEqual(s.counts.total_records, 0, 'none of the refused files stored a row');
      });

      await runTest('[NEGATIVE] Not an .xlsx: a .csv file and garbage bytes named .xlsx are refused with 400; no file field -> 400', async () => {
        const csv = await postExit(Buffer.from('NIK,EMP NAME\nRT47N-9,x\n'), 'module47.csv');
        assert.strictEqual(csv.status, 400);
        assert.ok(/\.xlsx/.test((await csv.json()).error));
        const junk = await postExit(Buffer.from('this is not a zip'), 'module47_junk.xlsx');
        assert.strictEqual(junk.status, 400);
        assert.ok(/not a valid Excel/i.test((await junk.json()).error));
        const none = await fetch(`${BASE_URL}/api/exit-interview/upload`, { method: 'POST', body: new FormData() });
        assert.strictEqual(none.status, 400);
        assert.strictEqual(filesBefore47(fs47) - dirFiles0, uploadIds47.length, 'refused files were not kept on disk');
      });

      await runTest('[POSITIVE] Template download is a valid .xlsx: title row, header row with NIK ... Directorate + Division (35 columns), an example row that passes the validator', async () => {
        const r = await fetch(`${BASE_URL}/api/exit-interview/template`);
        assert.strictEqual(r.status, 200);
        assert.ok(/spreadsheetml/.test(r.headers.get('content-type')));
        const rows = await readSheet47(Buffer.from(await r.arrayBuffer()));
        const header = rows.find(x => x.row_number === 2).cells.map(c => c && c.value);
        assert.deepStrictEqual([header.length, header[0], header[2], header[33], header[34]], [35, 'NIK', 'Effective Resignation Date', 'Directorate', 'Division']);
        const v = exitSvc.validateExitSheet(rows, directory47);
        assert.deepStrictEqual([v.errors.length, v.rows.length], [0, 1]);
      });

      await runTest('[POSITIVE] Admin CSV export follows the filter and escapes formulas; [NEGATIVE] no NIK of another month leaks into it', async () => {
        const r = await fetch(`${BASE_URL}/api/exit-interview/export?mode=MTD&year=2030&month=01`);
        assert.strictEqual(r.status, 200);
        const text = await r.text();
        const lines = text.replace(/^﻿/, '').split('\r\n');
        assert.strictEqual(lines.length, 1 + 9, 'header + 9 rows of January 2030');
        assert.ok(text.includes('RT47-001') && !text.includes('RT47-008'), 'only rows of the filter');
        assert.ok(text.includes(`"'=HYPERLINK(""http://x"")"`), 'formula escaped');
      });

      await runTest('[POSITIVE] USER of directorate A: 200 with the aggregates of A only and NO NIK, name, unknown company name or verbatim in the payload', async () => {
        const stamp47 = Date.now().toString(36);
        const username = `rt47u${stamp47}`;
        const created = await adminJson('POST', '/api/admin/users', { username, full_name: 'Regression Exit User', email: `${username}@example.test`, role: 'USER', scopes: [{ directorate: dirA.directorate_name, divisions: null }] });
        assert.strictEqual(created.status, 201);
        const cb = await created.json();
        userIds47.push(cb.user.user_id);
        const { res, cookie } = await loginAs(username, cb.temporary_password);
        assert.strictEqual(res.status, 200);
        const ch = await rawFetch(`${BASE_URL}/api/auth/change-password`, jsonBody('POST', { current_password: cb.temporary_password, new_password: STRONG }, cookie));
        assert.strictEqual(ch.status, 200);
        userCookie47 = cookie;
        const s = await summary47('mode=MTD&year=2030&month=01', cookie);
        assert.strictEqual(s.status, 200);
        assert.deepStrictEqual(s.body.counts, { total_records: 7, voluntary_records: 6, movers: 4 }, 'rows of directorate A only (incl. RT47-011 of the upsert test)');
        assert.deepStrictEqual(s.body.top_financial.items.map(i => i.label), ['PT Bank Permata Tbk'], 'unknown free-text employer hidden from a USER');
        assert.strictEqual(s.body.top_financial.base, 3);
        const text = JSON.stringify(s.body);
        for (const secret of ['RT47-', 'Regression Exit', 'Koperasi Fiktif', 'HYPERLINK', 'Lokasi kantor', 'Mobil dinas']) assert.ok(!text.includes(secret), `USER payload leaks "${secret}"`);
        const admin = JSON.stringify((await summary47('mode=MTD&year=2030&month=01')).body);
        assert.ok(admin.includes('Koperasi Fiktif') && !admin.includes('RT47-'), 'the Admin sees the name list, still no NIK');
      });

      await runTest('[NEGATIVE] USER: another directorate -> 403; template / upload / history / export -> 403', async () => {
        assert.ok(userCookie47, 'user from the previous test');
        assert.strictEqual((await summary47(`mode=MTD&year=2030&month=01&directorate=${encodeURIComponent(dirB.directorate_name)}`, userCookie47)).status, 403);
        for (const p of ['/api/exit-interview/template', '/api/exit-interview/uploads', '/api/exit-interview/export?mode=MTD&year=2030&month=01']) {
          assert.strictEqual((await realFetch(`${BASE_URL}${p}`, { headers: { Cookie: userCookie47 } })).status, 403, p);
        }
        const up = await postExit(await xlsx47([fx({ nik: 'RT47N-U1', date: '2030-02-10', e: 'FAMILY' })]), 'module47_user.xlsx', userCookie47);
        assert.strictEqual(up.status, 403);
        assert.strictEqual((await realFetch(`${BASE_URL}/api/exit-interview/summary?mode=YTD&year=2026`)).status, 401, 'no login -> 401');
      });

      // v2.39.0: slide-1 headline generated from cards 1 and 4 (rule-based)
      await runTest('[POSITIVE] Slide-1 headline rules (pure): top reason >= 40% -> "dominate", < 40% -> "lead", runner-up within 5 pp named, singular verb, pull factor >= 40% "main" / < 40% "most cited", Other never heads it', async () => {
        const R = (base, list) => ({ base, items: list.map(([label, count]) => ({ label, count })) });
        const P = (base, list) => ({ base, items: list.map(([label, count]) => ({ label, count })) });
        const h = exitSvc.buildOverviewHeadline;
        assert.strictEqual(h(R(10, [['Move company', 5], ['Family', 3], ['Personal', 2]]), P(5, [['Compensation', 3], ['Position', 1], ['Other', 1]])),
          'Company moves dominate exits; compensation is the main attraction');
        assert.strictEqual(h(R(10, [['Move company', 4], ['Family', 4]]), P(4, [['Compensation', 4]])),
          'Company moves and family reasons dominate exits; compensation is the main attraction', 'tie at 40% -> both named, still dominate');
        assert.strictEqual(h(R(10, [['Family', 3], ['Personal', 3], ['Move company', 2], ['Study', 2]]), P(2, [['Position', 2]])),
          'Family and personal reasons lead exits; a higher position is the main attraction');
        assert.strictEqual(h(R(100, [['Move company', 39], ['Family', 33]]), P(39, [['Compensation', 15], ['Job', 10], ['Other', 30]])),
          'Company moves lead exits; compensation is the most cited attraction', '6 pp gap -> no runner-up; Other (30) is skipped');
        assert.strictEqual(h(R(3, [['Study', 2], ['Family', 1]]), P(0, [])), 'Further study dominates exits', 'singular verb, no pull clause without movers');
        assert.strictEqual(h(R(10, [['Relocation', 3], ['Family', 2]]), P(0, [])), 'Relocation leads exits', 'unknown reason = its own label, singular');
        assert.strictEqual(h(R(4, [['Move company', 4]]), P(4, [['Other', 2], ['Compensation', 0]])), 'Company moves dominate exits', 'only Other named -> no pull clause');
        for (const empty of [R(0, []), null, { base: 0, items: [] }]) assert.strictEqual(h(empty, P(0, [])), 'No voluntary exit records in this period');
      });

      await runTest('[POSITIVE] Slide-1 headline from the data: MTD 2030-01 "dominate" (5/8 company moves), March 2030 fixture "lead" with runner-up, per directorate, USER of A gets the headline of A; empty month -> neutral line; slide-2 headline unchanged', async () => {
        const jan = (await summary47('mode=MTD&year=2030&month=01')).body;
        assert.strictEqual(jan.overview_headline, 'Company moves dominate exits; compensation is the main attraction');
        assert.strictEqual(jan.headline, 'Movers highlight company reputation and compensation & benefits; career progression & certainty is the clearest satisfaction gap');
        assert.strictEqual(jan.headline, exitSvc.buildThemesHeadline(jan.themes_open, jan.themes_internal));
        // March 2030: bankwide Family 3, Personal 3, Move company 2, Own business 1, Study 1 (base 10); movers name Position 2x, Compensation 1x
        const mar = [
          { nik: 'RT47-101', date: '2030-03-02', e: 'FAMILY' }, { nik: 'RT47-102', date: '2030-03-03', e: 'FAMILY' }, { nik: 'RT47-103', date: '2030-03-04', e: 'FAMILY' },
          { nik: 'RT47-104', date: '2030-03-05', e: 'PERSONAL' }, { nik: 'RT47-105', date: '2030-03-06', e: 'PERSONAL' },
          { nik: 'RT47-106', date: '2030-03-07', e: 'PERSONAL', dir: dirB.directorate_name },
          { nik: 'RT47-107', date: '2030-03-08', e: 'MOVE_COMPANY', k: 'Jabatan / posisi lebih tinggi' },
          { nik: 'RT47-108', date: '2030-03-09', e: 'BETTER_OFFER', k: 'Jabatan / posisi lebih tinggi | Kompensasi & benefit yang lebih menarik' },
          { nik: 'RT47-109', date: '2030-03-10', e: 'OWN_BUSINESS', dir: dirB.directorate_name },
          { nik: 'RT47-110', date: '2030-03-11', e: 'STUDY', dir: dirB.directorate_name }
        ];
        const up = await postExit(await xlsx47(mar.map(fx)), 'module47_headline.xlsx');
        const ub = await up.json();
        assert.strictEqual(up.status, 200, JSON.stringify(ub).slice(0, 300));
        uploadIds47.push(ub.upload_id);
        const all = (await summary47('mode=MTD&year=2030&month=03')).body;
        assert.strictEqual(all.reasons.base, 10);
        assert.strictEqual(all.overview_headline, 'Family and personal reasons lead exits; a higher position is the main attraction');
        const a = (await summary47(`mode=MTD&year=2030&month=03&directorate=${encodeURIComponent(dirA.directorate_name)}`)).body;
        assert.strictEqual(a.overview_headline, 'Family reasons dominate exits; a higher position is the main attraction', 'A: Family 3/7 = 42.9%, Personal 14.3 pp behind');
        const b = (await summary47(`mode=MTD&year=2030&month=03&directorate=${encodeURIComponent(dirB.directorate_name)}`)).body;
        assert.strictEqual(b.overview_headline, 'Own-business exits and personal reasons lead exits', 'B: three-way tie at 33.3%, no movers -> no pull clause');
        assert.ok(userCookie47, 'user from the USER test');
        const u = await summary47('mode=MTD&year=2030&month=03', userCookie47);
        assert.strictEqual(u.status, 200);
        assert.strictEqual(u.body.overview_headline, a.overview_headline, 'USER of A = the headline of A only');
        const feb = (await summary47('mode=MTD&year=2030&month=02')).body;
        assert.strictEqual(feb.overview_headline, 'No voluntary exit records in this period');
        assert.strictEqual(feb.headline, null);
      });

      await runTest('[NEGATIVE] Boot top-up never touches a month that already has exit rows (seed months keep their row counts and sources; fixture months untouched)', async () => {
        const st = require('../server/db/storage');
        const before = JSON.stringify(await st.getExitInterviewMonthCounts());
        const added = await st.topUpExitInterviewSeed();
        assert.deepStrictEqual(added, [], 'every seed month already has rows');
        assert.strictEqual(JSON.stringify(await st.getExitInterviewMonthCounts()), before);
        const months = await st.getExitInterviewMonthCounts();
        assert.ok(months.some(m => m.year === 2030 && m.month === 1 && m.dummy === 0 && m.total === 9));
      });
    } finally {
      const pool = await new sql47.ConnectionPool({ server: process.env.DB_SERVER || 'localhost', port: parseInt(process.env.DB_PORT || '1433', 10), database: process.env.DB_NAME || 'PeopleExperiencePX',
        user: process.env.DB_USER, password: process.env.DB_PASSWORD, options: { encrypt: false, trustServerCertificate: true } }).connect();
      try {
        // only this module's own rows: the fixture NIK prefixes and the upload batches made by this run
        await pool.request().query("DELETE FROM dbo.px_exit_interviews WHERE nik LIKE 'RT47-%' OR nik LIKE 'RT47N-%'");
        const ids = [...uploadIds47];
        (await pool.request().input('t', sql47.DateTime2(3), runStart47).query("SELECT upload_id FROM dbo.px_exit_interview_uploads WHERE file_name LIKE 'module47[_]%' AND uploaded_at >= DATEADD(minute, -5, @t)"))
          .recordset.forEach(r => { if (!ids.includes(r.upload_id)) ids.push(r.upload_id); });
        for (const id of ids) {
          await pool.request().input('u', sql47.NVarChar, id).query('DELETE FROM dbo.px_exit_interviews WHERE upload_id = @u; DELETE FROM dbo.px_exit_interview_uploads WHERE upload_id = @u');
          const f = require('path').join(exitSvc.EXIT_UPLOAD_DIR, `${id}.xlsx`);
          if (fs47.existsSync(f)) fs47.unlinkSync(f);
        }
      } finally {
        await pool.close();
      }
      for (const id of userIds47) await adminJson('DELETE', `/api/admin/users/${id}`);
    }
  }

  // --- MODULE 48 (v2.43.0): TEST-RUN ENTRIES IN THE AUDIT TRAIL ---
  // Accounts made by the suite / QC scripts are marked server-side (px_users.is_test_account) and their audit rows
  // get is_test, which the Audit Trail hides unless ?include_test=1. Nothing is deleted from the trail - except the
  // rows part B itself writes as a NON-test admin, removed by their made-up client IP at the end (test fixtures).
  console.log('\n📦 MODULE 48: Test-run entries hidden from the Audit Trail (Positive & Negative Testing)');
  {
    const stamp48 = Date.now().toString(36);
    const users48 = [];
    const auditLog48 = async (query) => (await adminJson('GET', `/api/admin/audit-log?limit=1000${query || ''}`)).json();
    const me48 = (await (await adminJson('GET', '/api/auth/me')).json()).user || {};
    const about = (e, username) => e.username === username || String(e.target || '').startsWith(username);

    await runTest('[POSITIVE/NEGATIVE] Name rules for audit rows written before v2.43.0 (pure function): deleted test accounts are marked, admin / real accounts / unknown-username failures are not', async () => {
      const { isHistoricalTestRow, isTestUsernamePattern } = require('../server/db/testAccounts');
      const accounts = new Map([['admin', false], ['qc-real', false], ['rt-suite-keep', true]]);
      const row = (username, target) => ({ username, target });
      assert.strictEqual(isHistoricalTestRow(row('rt37adminmvg452zw', null), accounts), true, 'deleted Module 37 admin');
      assert.strictEqual(isHistoricalTestRow(row('rt-suite-mvf0j0y4', 'rt45amvf0j0y4 (USER) scope: X'), accounts), true);
      assert.strictEqual(isHistoricalTestRow(row('qc-tmp-mveyktw0', null), accounts), true);
      assert.strictEqual(isHistoricalTestRow(row('verify-abc', null), accounts), true);
      assert.strictEqual(isHistoricalTestRow(row(null, 'rt44-mvf0j0y4: email'), accounts), true, 'actor unknown, subject a deleted test account');
      assert.strictEqual(isHistoricalTestRow(row('rt-suite-keep', null), accounts), true, 'existing account: its flag decides');
      assert.strictEqual(isHistoricalTestRow(row('admin', 'rt37amvg452zw (ADMIN) scope: -'), accounts), false, 'rows of admin are never marked');
      assert.strictEqual(isHistoricalTestRow(row('qc-real', null), accounts), false, 'an existing non-test account wins over the name pattern');
      assert.strictEqual(isHistoricalTestRow(row(null, '(unknown username)'), accounts), false, 'failed login of an unknown username stays visible');
      assert.strictEqual(isTestUsernamePattern('rtanaka'), false);
      assert.strictEqual(isTestUsernamePattern('rtzzzzzzzzzz'), false, 'rt + 8 chars that are no plausible timestamp');
      assert.strictEqual(isTestUsernamePattern('12345678'), false);
      // v2.43.1: old development accounts confirmed by the user as test accounts
      for (const u of ['probe-mvalwxyv', 'snap-mvalp3kd', 'devadmin', 'dev-admin', 'DevAdmin']) assert.strictEqual(isTestUsernamePattern(u), true, u);
      for (const u of ['probe', 'probe-team', 'snapshot', 'snap-zzzzzzzz', 'developer', 'devadmin2']) assert.strictEqual(isTestUsernamePattern(u), false, u);
    });

    if (me48.is_test_account !== true) {
      console.log('  ⏭️  SKIP: Module 48 part A needs a test-run suite admin (TEST_ADMIN_USER is a real account)');
    } else {
      await runTest('[POSITIVE] An account created through the API by a test admin is a test account; its login and failures are written with is_test, hidden by default and shown with include_test=1', async () => {
        const username = `rt48u${stamp48}`;
        const res = await adminJson('POST', '/api/admin/users', { username, full_name: 'Regression 48 User', role: 'ADMIN', scopes: [] });
        assert.strictEqual(res.status, 201);
        const body = await res.json();
        users48.push(body.user.user_id);
        assert.strictEqual(body.user.is_test_account, true, 'inherited from the test admin');
        assert.strictEqual((await loginAs(username, 'Wrong-Pass-48x')).res.status, 401);
        assert.strictEqual((await loginAs(username, body.temporary_password)).res.status, 200);
        const mine = (await auditLog48('&include_test=1')).filter(e => about(e, username));
        ['USER_CREATE', 'LOGIN_FAILED', 'LOGIN_SUCCESS'].forEach(a => assert.ok(mine.some(e => e.action === a), `include_test has ${a}`));
        assert.ok(mine.every(e => e.is_test === true), 'all of them marked is_test');
        const visible = await auditLog48();
        assert.ok(visible.every(e => e.is_test === false), 'default list has no test rows');
        assert.ok(!visible.some(e => about(e, username)), 'nothing of the test account is visible');
        assert.ok(!visible.some(e => e.username === me48.username), 'the suite admin itself is hidden');
      });

      await runTest('[NEGATIVE] The client cannot set or clear is_test_account (POST body and PUT ignored); the audit log needs a session', async () => {
        const username = `rt48n${stamp48}`;
        const res = await adminJson('POST', '/api/admin/users', { username, full_name: 'Regression 48 N', role: 'ADMIN', scopes: [], is_test_account: false });
        assert.strictEqual(res.status, 201);
        const created = (await res.json()).user;
        users48.push(created.user_id);
        assert.strictEqual(created.is_test_account, true, 'body is_test_account:false is ignored');
        const put = await adminJson('PUT', `/api/admin/users/${created.user_id}`, { full_name: 'Regression 48 N2', is_test_account: false });
        assert.strictEqual(put.status, 200);
        assert.strictEqual((await put.json()).user.is_test_account, true, 'PUT cannot clear the flag');
        assert.strictEqual((await rawFetch(`${BASE_URL}/api/admin/audit-log?include_test=1`)).status, 401, 'no session -> no audit log');
      });

      await runTest('[POSITIVE] The limit applies after the filter: limit=5 gives only visible rows by default, and 5 rows (newest = test rows) with include_test=1', async () => {
        const visible = await (await adminJson('GET', '/api/admin/audit-log?limit=5')).json();
        assert.ok(visible.length <= 5 && visible.every(e => e.is_test === false));
        const all = await (await adminJson('GET', '/api/admin/audit-log?limit=5&include_test=1')).json();
        assert.strictEqual(all.length, 5);
        assert.ok(all.some(e => e.is_test === true), 'the newest rows are this run\'s test rows');
        assert.ok(all[0].audit_id >= (visible[0] ? visible[0].audit_id : 0), 'still newest first');
      });
    }

    const storage48 = require('../server/db/storage');
    if (storage48.backend !== 'sql') {
      console.log('  ⏭️  SKIP: Module 48 part B needs the SQL backend (in-process auth routes over the same database)');
    } else {
      const express = require('express');
      const auth48 = require('../server/services/authService');
      const crypto48 = require('crypto');
      const sql48 = require('mssql');
      const app48 = express();
      app48.set('trust proxy', true); // a made-up client IP per run identifies this part's own rows for the cleanup
      app48.use(express.json());
      auth48.registerAuthRoutes(app48);
      const server48 = await new Promise(resolve => { const s = app48.listen(0, '127.0.0.1', () => resolve(s)); });
      const B48 = `http://127.0.0.1:${server48.address().port}`;
      const ip48 = `10.248.${crypto48.randomInt(1, 254)}.${crypto48.randomInt(1, 254)}`;
      const call = (method, p, body, cookie, extra = {}) => realFetch(`${B48}${p}`, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip48, ...(cookie ? { Cookie: cookie } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
      const ck48 = r => (r.headers.getSetCookie() || []).map(c => c.split(';')[0]).find(c => c.startsWith('px_session=')) || null;
      const ids48 = [];
      const realPw = crypto48.randomBytes(9).toString('hex') + 'Aa1';
      // deliberately NOT a test account (is_test_account: false) - its rows are removed by IP in the finally block
      const real = await storage48.createUser({ is_test_account: false, username: `rt48real${stamp48}`, full_name: 'Regression 48 non-test admin (temporary)', email: '', role: 'ADMIN', password_hash: await auth48.hashPassword(realPw), must_change_password: false });
      ids48.push(real.user_id);
      const flagged = await storage48.createUser({ is_test_account: true, username: `rt48t${stamp48}`, full_name: 'Regression 48 test', email: '', role: 'USER', password_hash: 'x', scopes: [] });
      ids48.push(flagged.user_id);
      try {
        const login = await call('POST', '/api/auth/login', { username: real.username, password: realPw });
        assert.strictEqual(login.status, 200);
        const cookie = ck48(login);
        const own = async () => (await (await call('GET', '/api/admin/audit-log?limit=1000&include_test=1', undefined, cookie)).json()).filter(e => e.ip === ip48);

        await runTest('[POSITIVE/NEGATIVE] A non-test admin\'s actions stay visible; an account it creates is NOT a test account (is_test_account in the body, spoofed headers/query and PUT are ignored)', async () => {
          const r = await call('POST', '/api/admin/users?is_test=1&include_test=1', { username: `rt48c${stamp48}`, full_name: 'Regression 48 C', role: 'ADMIN', scopes: [], is_test_account: true, is_test: true }, cookie, { 'X-Test-Run': '1', 'X-Is-Test': 'true' });
          assert.strictEqual(r.status, 201);
          const created = (await r.json()).user;
          ids48.push(created.user_id);
          assert.strictEqual(created.is_test_account, false, 'client cannot make an account a test account');
          assert.strictEqual((await call('PUT', `/api/admin/users/${created.user_id}`, { is_test_account: true }, cookie)).status, 200);
          assert.strictEqual((await storage48.getUserById(created.user_id)).is_test_account, false, 'PUT cannot set the flag');
          const rows = await own();
          ['LOGIN_SUCCESS', 'USER_CREATE', 'USER_UPDATE'].forEach(a => assert.ok(rows.some(e => e.action === a && e.is_test === false), `${a} visible (is_test false)`));
          const visible = await (await call('GET', '/api/admin/audit-log?limit=1000', undefined, cookie)).json();
          assert.ok(visible.some(e => e.ip === ip48 && e.action === 'USER_CREATE'), 'shown in the default Audit Trail');
        });

        await runTest('[POSITIVE/NEGATIVE] A real admin acting on a test account writes is_test (subject rule); a failed login of an unknown username stays visible', async () => {
          assert.strictEqual((await call('POST', `/api/admin/users/${flagged.user_id}/reset-password`, {}, cookie)).status, 200);
          assert.strictEqual((await call('POST', '/api/auth/login', { username: `nobody48${stamp48}`, password: 'Whatever-48' })).status, 401);
          const rows = await own();
          const reset = rows.find(e => e.action === 'PASSWORD_RESET' && e.target === flagged.username);
          assert.ok(reset && reset.is_test === true && reset.username === real.username, 'PASSWORD_RESET of a test account is marked');
          const unknown = rows.find(e => e.action === 'LOGIN_FAILED' && e.username === null);
          assert.ok(unknown && unknown.is_test === false, 'unknown-username failure is not marked');
        });

        await runTest('[POSITIVE] Historical marking is idempotent (a second run marks 0 rows) and never marks rows of an existing non-test account', async () => {
          await storage48.markHistoricalTestAudit();
          const again = await storage48.markHistoricalTestAudit();
          assert.strictEqual(again.marked, 0);
          const rows = await own();
          assert.ok(rows.some(e => e.username === real.username && e.is_test === false), 'the non-test admin\'s rows are still unmarked');
        });
      } finally {
        await new Promise(resolve => server48.close(resolve));
        for (const id of ids48) { try { await storage48.deleteUser(id); } catch (_) { /* ignore */ } }
        // part B's fixture rows (this run's made-up IP only): written by a non-test admin, so they would stay visible
        const pool48 = await new sql48.ConnectionPool({ server: process.env.DB_SERVER || 'localhost', port: parseInt(process.env.DB_PORT || '1433', 10), database: process.env.DB_NAME || 'PeopleExperiencePX',
          user: process.env.DB_USER, password: process.env.DB_PASSWORD, options: { encrypt: false, trustServerCertificate: true } }).connect();
        try {
          const del = await pool48.request().input('ip', sql48.NVarChar, ip48).query('DELETE FROM dbo.px_audit_log WHERE ip = @ip');
          if (!del.rowsAffected[0]) console.error('     cleanup: no Module 48 audit fixture rows found');
        } finally {
          await pool48.close();
        }
      }
    }
    for (const id of users48) await adminJson('DELETE', `/api/admin/users/${id}`);
  }

  // --- MODULE 49 (v2.44.0): AUTO SIGN-OUT AFTER INACTIVITY ---
  // Setting session_idle_timeout_minutes (default 5, 1-120, Admin only). The server ends a session whose last REAL
  // activity (login / POST /api/auth/activity) is older than that: 401 reason IDLE_TIMEOUT, row deleted, audit LOGOUT_IDLE.
  // Ordinary requests never refresh it. The session-row checks move last_activity_at with the storage layer in-process,
  // so they need the SQL backend (the JSON server keeps auth.json in its own memory). This module's own sessions use
  // nativeFetch, so the suite's keep-alive ping never touches them.
  console.log('\n📦 MODULE 49: Auto sign-out after inactivity - setting, server-side idle check, activity endpoint (Positive & Negative Testing)');
  {
    const KEY49 = 'session_idle_timeout_minutes';
    const stamp49 = Date.now().toString(36);
    const users49 = [];
    const json49 = (method, p, body, cookie) => nativeFetch(`${BASE_URL}${p}`, jsonBody(method, body, cookie));
    const putIdle = value => adminJson('PUT', `/api/admin/settings/${KEY49}`, { value });
    const idleSetting = async () => (await (await adminJson('GET', '/api/settings')).json())[KEY49];
    const tokenHash = cookie => require('crypto').createHash('sha256').update(cookie.split('=')[1]).digest('hex');
    const storage49 = tempAdmin ? tempAdmin.storage : null; // SQL only (the suite made its own admin)
    const minutesAgo = m => new Date(Date.now() - m * 60 * 1000);
    const auditOf = async username => (await (await adminJson('GET', '/api/admin/audit-log?limit=500&include_test=1')).json()).filter(e => e.username === username);

    // a USER account (test-marked: created by the test admin) that has completed the forced password change
    const makeUser49 = async (suffix) => {
      const dirs = await (await adminJson('GET', '/api/directorates')).json();
      const username = `rt49${suffix}${stamp49}`;
      const res = await adminJson('POST', '/api/admin/users', { username, full_name: `Regression 49 ${suffix}`, role: 'USER', scopes: [{ directorate: dirs[0].name, divisions: null }] });
      assert.strictEqual(res.status, 201);
      const body = await res.json();
      users49.push(body.user.user_id);
      const first = await loginAs(username, body.temporary_password);
      const password = require('crypto').randomBytes(9).toString('hex') + 'Bb2';
      const changed = await json49('POST', '/api/auth/change-password', { current_password: body.temporary_password, new_password: password }, first.cookie);
      assert.strictEqual(changed.status, 200, 'forced password change');
      return { username, password, user_id: body.user.user_id };
    };
    const login49 = async (u) => {
      const { res, cookie } = await loginAs(u.username, u.password);
      assert.strictEqual(res.status, 200);
      return cookie;
    };

    // v2.55.1: the Admin may have configured another idle time (e.g. 120 on 2026-10-22) - the tests read the stored value and put it back
    const idle49 = await idleSetting();
    try {
      await runTest('[POSITIVE] The configured idle time (default 5 minutes) is valid and every signed-in account reads it (/api/auth/me idle_timeout_minutes)', async () => {
        assert.ok(Number.isInteger(idle49) && idle49 >= 1 && idle49 <= 120, `stored idle time ${idle49}`);
        assert.strictEqual((await (await adminJson('GET', '/api/auth/me')).json()).idle_timeout_minutes, idle49);
        const u = await makeUser49('r');
        const me = await (await json49('GET', '/api/auth/me', undefined, await login49(u))).json();
        assert.strictEqual(me.idle_timeout_minutes, idle49, 'a USER sees it too');
      });

      await runTest('[NEGATIVE] Invalid idle times are refused with 400 and leave the setting unchanged (0, 121, "abc", 2.5, empty, null)', async () => {
        for (const bad of [0, 121, 'abc', 2.5, '', null, -5]) {
          const res = await putIdle(bad);
          assert.strictEqual(res.status, 400, `value ${JSON.stringify(bad)}`);
          assert.ok(/between 1 and 120/.test((await res.json()).error));
        }
        assert.strictEqual(await idleSetting(), idle49);
      });

      await runTest('[POSITIVE] 120 and 1 are accepted, /api/auth/me follows at once, the change is audited (SETTINGS_CHANGE); the module then runs at 5 (configured value restored at the end)', async () => {
        await nativeFetch(`${BASE_URL}/api/auth/activity`, { method: 'POST', headers: { Cookie: suiteCookie } }); // fresh activity before a 1-minute window
        try {
          for (const n of [120, 1]) {
            const res = await putIdle(n);
            assert.strictEqual(res.status, 200);
            assert.strictEqual((await res.json()).value, n);
            assert.strictEqual((await (await adminJson('GET', '/api/auth/me')).json()).idle_timeout_minutes, n);
          }
        } finally {
          assert.strictEqual((await putIdle(5)).status, 200);
        }
        assert.strictEqual(await idleSetting(), 5);
        const me = (await (await adminJson('GET', '/api/auth/me')).json()).user;
        const rows = (await auditOf(me.username)).filter(e => e.action === 'SETTINGS_CHANGE' && String(e.target).startsWith(KEY49));
        assert.ok(rows.some(e => e.target === `${KEY49}: 120 -> 1`), 'audit target names old -> new value');
        assert.ok(rows.every(e => e.is_test === true), 'written by the test admin -> test-marked');
      });

      await runTest('[NEGATIVE] A User cannot change the idle time (403), and nobody can without a session (401)', async () => {
        const u = await makeUser49('n');
        const cookie = await login49(u);
        assert.strictEqual((await json49('PUT', `/api/admin/settings/${KEY49}`, { value: 30 }, cookie)).status, 403);
        assert.strictEqual((await json49('PUT', `/api/admin/settings/${KEY49}`, { value: 30 })).status, 401);
        assert.strictEqual(await idleSetting(), 5);
      });

      await runTest('[POSITIVE] Public routes work without a login and with an idle-expired cookie (health, directorates)', async () => {
        assert.strictEqual((await nativeFetch(`${BASE_URL}/api/health`)).status, 200);
        assert.strictEqual((await nativeFetch(`${BASE_URL}/api/directorates`)).status, 200);
        if (storage49) {
          const u = await makeUser49('p');
          const cookie = await login49(u);
          await storage49.setSessionActivity(tokenHash(cookie), minutesAgo(30));
          assert.strictEqual((await json49('GET', '/api/directorates', undefined, cookie)).status, 200, 'public route unaffected by the idle cookie');
          assert.strictEqual(await storage49.getSession(tokenHash(cookie)), null, 'but the idle session is ended');
        }
      });

      if (!storage49) {
        console.log('  ⏭️  SKIP: Module 49 session-row tests need the SQL backend (in-process storage over the same database)');
      } else {
        await runTest('[NEGATIVE] A session idle longer than the timeout gets 401 reason IDLE_TIMEOUT, its row is deleted, LOGOUT_IDLE is audited once', async () => {
          const u = await makeUser49('i');
          const cookie = await login49(u);
          const hash = tokenHash(cookie);
          await storage49.setSessionActivity(hash, minutesAgo(6));
          const res = await json49('GET', '/api/auth/me', undefined, cookie);
          assert.strictEqual(res.status, 401);
          const body = await res.json();
          assert.strictEqual(body.reason, 'IDLE_TIMEOUT');
          assert.strictEqual(body.idle_timeout_minutes, 5);
          assert.ok((res.headers.getSetCookie() || []).some(c => /^px_session=;/.test(c)), 'cookie cleared');
          assert.strictEqual(await storage49.getSession(hash), null, 'session row deleted');
          const again = await json49('GET', '/api/metrics/calculate', undefined, cookie);
          assert.strictEqual(again.status, 401);
          assert.strictEqual((await again.json()).reason, undefined, 'second request: plain AUTH_REQUIRED (session already gone)');
          const idleRows = (await auditOf(u.username)).filter(e => e.action === 'LOGOUT_IDLE');
          assert.strictEqual(idleRows.length, 1, 'audited exactly once');
          assert.strictEqual(idleRows[0].is_test, true, 'test-marked (test account)');
        });

        await runTest('[NEGATIVE] An idle-expired session cannot be revived by POST /api/auth/activity (401 IDLE_TIMEOUT)', async () => {
          const u = await makeUser49('v');
          const cookie = await login49(u);
          await storage49.setSessionActivity(tokenHash(cookie), minutesAgo(5.5));
          const res = await json49('POST', '/api/auth/activity', {}, cookie);
          assert.strictEqual(res.status, 401);
          assert.strictEqual((await res.json()).reason, 'IDLE_TIMEOUT');
          assert.strictEqual(await storage49.getSession(tokenHash(cookie)), null);
        });

        await runTest('[POSITIVE/NEGATIVE] Ordinary requests do NOT refresh last activity; a session within the timeout keeps working; POST /api/auth/activity does refresh it', async () => {
          const u = await makeUser49('a');
          const cookie = await login49(u);
          const hash = tokenHash(cookie);
          const login = new Date((await storage49.getSession(hash)).last_activity_at).getTime();
          assert.ok(Math.abs(Date.now() - login) < 60 * 1000, 'login sets last activity');
          const past = minutesAgo(4);
          await storage49.setSessionActivity(hash, past);
          // (v2.49.0: /api/events -> /api/alerts - a default USER has no Signature Program Events menu any more)
          for (const p of ['/api/auth/me', '/api/settings', '/api/alerts', `/api/metrics/calculate`]) {
            assert.strictEqual((await json49('GET', p, undefined, cookie)).status, 200, `${p} within the timeout`);
          }
          assert.strictEqual(new Date((await storage49.getSession(hash)).last_activity_at).getTime(), past.getTime(), 'GET requests left last activity untouched');
          const before = Date.now();
          const act = await json49('POST', '/api/auth/activity', {}, cookie);
          assert.strictEqual(act.status, 200);
          assert.strictEqual((await act.json()).idle_timeout_minutes, 5);
          const after = new Date((await storage49.getSession(hash)).last_activity_at).getTime();
          assert.ok(after >= before - 1000, 'activity moved last activity to now');
        });

        await runTest('[POSITIVE] Sign-out by the client idle timer ({ reason: "IDLE_TIMEOUT" }) is audited LOGOUT_IDLE, a normal sign-out stays LOGOUT', async () => {
          const u = await makeUser49('l');
          const c1 = await login49(u);
          assert.strictEqual((await json49('POST', '/api/auth/logout', { reason: 'IDLE_TIMEOUT' }, c1)).status, 200);
          const c2 = await login49(u);
          assert.strictEqual((await json49('POST', '/api/auth/logout', { reason: 'something else' }, c2)).status, 200);
          const rows = await auditOf(u.username);
          assert.strictEqual(rows.filter(e => e.action === 'LOGOUT_IDLE').length, 1);
          assert.strictEqual(rows.filter(e => e.action === 'LOGOUT').length, 1);
          assert.strictEqual(await storage49.getSession(tokenHash(c1)), null);
        });
      }
    } finally {
      // v2.55.1: put back the idle time the Admin configured (was always reset to 5 before)
      if ((await idleSetting()) !== idle49) await putIdle(idle49);
      for (const id of users49) await adminJson('DELETE', `/api/admin/users/${id}`);
    }
  }

  // --- MODULE 50 (v2.48.0): PX INDEX WEIGHTS SETTING + PX INDEX PER DIRECTORATE ---
  // px_index_weights { survey, outcome } (whole numbers adding up to 100, Admin only, default 70/30) drives every PX Index;
  // GET /api/metrics/by-directorate lists the PX Index per directorate of the caller's scope, each equal to
  // /api/metrics/calculate?directorate=<that one>; under a directorate filter the non-employee metrics count at their
  // bankwide value.
  console.log('\n📦 MODULE 50: PX Index weights setting, PX Index by directorate, bankwide non-employee metrics under a directorate filter (Positive & Negative Testing)');
  {
    const KEY50 = 'px_index_weights';
    const stamp50 = Date.now().toString(36);
    const users50 = [];
    const json50 = (method, p, body, cookie) => nativeFetch(`${BASE_URL}${p}`, jsonBody(method, body, cookie));
    const putWeights = value => adminJson('PUT', `/api/admin/settings/${KEY50}`, { value });
    const weightsSetting = async () => (await (await adminJson('GET', '/api/settings')).json())[KEY50];
    const aj50 = async p => { const r = await adminJson('GET', p); assert.strictEqual(r.status, 200, p); return r.json(); };
    const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
    const dirNames = (await (await adminJson('GET', '/api/directorates')).json()).map(d => d.name);
    const makeUser50 = async (suffix, scopes) => {
      const username = `rt50${suffix}${stamp50}`;
      const res = await adminJson('POST', '/api/admin/users', { username, full_name: `Regression 50 ${suffix}`, role: 'USER', scopes });
      assert.strictEqual(res.status, 201);
      const body = await res.json();
      users50.push(body.user.user_id);
      const first = await loginAs(username, body.temporary_password);
      const password = require('crypto').randomBytes(9).toString('hex') + 'Cc3';
      assert.strictEqual((await json50('POST', '/api/auth/change-password', { current_password: body.temporary_password, new_password: password }, first.cookie)).status, 200);
      const { res: lr, cookie } = await loginAs(username, password);
      assert.strictEqual(lr.status, 200);
      return cookie;
    };
    const userGet = async (cookie, p) => { const r = await json50('GET', p, undefined, cookie); assert.strictEqual(r.status, 200, p); return r.json(); };
    // v2.51.0: the module needs the default 70/30; an Admin's own weights are put back afterwards
    const weights50 = await weightsSetting();
    if (!weights50 || weights50.survey !== 70 || weights50.outcome !== 30) await putWeights({ survey: 70, outcome: 30 });

    try {
      await runTest('[POSITIVE] PX Index weights default to 70/30 and are exposed by /api/metrics/calculate (px_weights, weights_formula)', async () => {
        assert.deepStrictEqual(await weightsSetting(), { survey: 70, outcome: 30 });
        const calc = await aj50('/api/metrics/calculate?mode=YTD');
        assert.deepStrictEqual(calc.px_weights, { survey: 70, outcome: 30 });
        assert.ok(calc.weights_formula.startsWith('70% Survey + 30% Outcomes'));
      });

      await runTest('[NEGATIVE] Invalid weights are refused with 400 and leave the setting unchanged (sum != 100, decimals, negative, > 100, wrong shape)', async () => {
        const bad = [{ survey: 70, outcome: 20 }, { survey: 60, outcome: 60 }, { survey: 70.5, outcome: 29.5 }, { survey: -10, outcome: 110 },
          { survey: 110, outcome: -10 }, { survey: '70', outcome: '30' }, { survey: 100 }, [70, 30], 'abc', 70, null];
        for (const value of bad) {
          const res = await putWeights(value);
          assert.strictEqual(res.status, 400, `value ${JSON.stringify(value)}`);
          assert.ok((await res.json()).error);
        }
        assert.deepStrictEqual(await weightsSetting(), { survey: 70, outcome: 30 });
      });

      await runTest('[NEGATIVE] A User cannot change the weights (403) and nobody can without a session (401)', async () => {
        const cookie = await makeUser50('w', [{ directorate: dirNames[0], divisions: null }]);
        assert.strictEqual((await json50('PUT', `/api/admin/settings/${KEY50}`, { value: { survey: 50, outcome: 50 } }, cookie)).status, 403);
        assert.strictEqual((await json50('PUT', `/api/admin/settings/${KEY50}`, { value: { survey: 50, outcome: 50 } })).status, 401);
        assert.deepStrictEqual(await weightsSetting(), { survey: 70, outcome: 30 });
      });

      await runTest('[POSITIVE] 60/40 is saved and used at once: px_index = 0.6 x Survey + 0.4 x Outcome (bankwide, directorate, journey, by-directorate), audited; restored to 70/30', async () => {
        try {
          const res = await putWeights({ survey: 60, outcome: 40 });
          assert.strictEqual(res.status, 200);
          assert.deepStrictEqual((await res.json()).value, { survey: 60, outcome: 40 });
          const calc = await aj50('/api/metrics/calculate?mode=YTD');
          assert.deepStrictEqual(calc.px_weights, { survey: 60, outcome: 40 });
          assert.strictEqual(calc.px_index_basis, 'BOTH');
          near(calc.px_index, 0.6 * calc.survey_index + 0.4 * calc.outcome_index, 0.02, 'bankwide px');
          const dir = await aj50(`/api/metrics/calculate?mode=YTD&directorate=${encodeURIComponent(dirNames[0])}`);
          near(dir.px_index, 0.6 * dir.survey_index + 0.4 * dir.outcome_index, 0.02, 'directorate px');
          const j = calc.journeys.find(x => x.survey_score !== null && x.outcome_score !== null);
          assert.ok(j, 'guard: a journey with both survey and outcome scores');
          near(j.overall_score, 0.6 * j.survey_score + 0.4 * j.outcome_score, 0.02, 'journey score');
          const byDir = await aj50('/api/metrics/by-directorate?mode=YTD');
          assert.deepStrictEqual(byDir.px_weights, { survey: 60, outcome: 40 });
          assert.strictEqual(byDir.directorates.find(d => d.directorate === dirNames[0]).px_index, dir.px_index);
        } finally {
          assert.strictEqual((await putWeights({ survey: 70, outcome: 30 })).status, 200);
        }
        assert.deepStrictEqual(await weightsSetting(), { survey: 70, outcome: 30 });
        const me = (await (await adminJson('GET', '/api/auth/me')).json()).user;
        const rows = (await (await adminJson('GET', '/api/admin/audit-log?limit=500&include_test=1')).json())
          .filter(e => e.username === me.username && e.action === 'SETTINGS_CHANGE' && String(e.target).startsWith(KEY50));
        assert.ok(rows.some(e => e.target === `${KEY50}: 70/30 -> 60/40`), 'audit target names old -> new value');
      });

      await runTest('[POSITIVE] Admin: /api/metrics/by-directorate lists every master directorate, sorted by PX Index, each equal to /api/metrics/calculate?directorate=X (YTD and MTD)', async () => {
        const byDir = await aj50('/api/metrics/by-directorate?mode=YTD');
        assert.strictEqual(byDir.directorates.length, dirNames.length);
        assert.deepStrictEqual(byDir.directorates.map(d => d.directorate).sort(), [...dirNames].sort());
        const pxs = byDir.directorates.map(d => d.px_index);
        for (let i = 1; i < pxs.length; i++) assert.ok(pxs[i] === null || (pxs[i - 1] !== null && pxs[i - 1] >= pxs[i]), 'sorted highest first, no-data last');
        for (const d of byDir.directorates) {
          const c = await aj50(`/api/metrics/calculate?mode=YTD&directorate=${encodeURIComponent(d.directorate)}`);
          assert.strictEqual(d.px_index, c.px_index, `${d.directorate} px`);
          assert.strictEqual(d.survey_index, c.survey_index, `${d.directorate} survey`);
          assert.strictEqual(d.outcome_index, c.outcome_index, `${d.directorate} outcome`);
          assert.strictEqual(d.px_index_basis, c.px_index_basis);
        }
        const year = String(new Date().getFullYear());
        const mtd = await aj50(`/api/metrics/by-directorate?mode=MTD&year=${year}&month=03`);
        assert.strictEqual(mtd.mode, 'MTD');
        const first = mtd.directorates[0];
        const c = await aj50(`/api/metrics/calculate?mode=MTD&year=${year}&month=03&directorate=${encodeURIComponent(first.directorate)}`);
        assert.strictEqual(first.px_index, c.px_index, 'MTD entry equals the MTD scorecard');
      });

      await runTest('[POSITIVE/NEGATIVE] USER with a 2-directorate scope gets exactly those 2 (equal to their own scorecard per directorate); a directorate outside the scope never appears; no session -> 401', async () => {
        const [dA, dB] = [dirNames[1], dirNames[2]];
        const cookie = await makeUser50('s', [{ directorate: dA, divisions: null }, { directorate: dB, divisions: null }]);
        const byDir = await userGet(cookie, '/api/metrics/by-directorate?mode=YTD');
        assert.deepStrictEqual(byDir.directorates.map(d => d.directorate).sort(), [dA, dB].sort());
        assert.ok(!JSON.stringify(byDir).includes(JSON.stringify(dirNames[0])), 'no other directorate in the payload');
        for (const d of byDir.directorates) {
          const own = await userGet(cookie, `/api/metrics/calculate?mode=YTD&directorate=${encodeURIComponent(d.directorate)}`);
          assert.strictEqual(d.px_index, own.px_index, `${d.directorate}: equals the user's scorecard`);
          const adm = await aj50(`/api/metrics/calculate?mode=YTD&directorate=${encodeURIComponent(d.directorate)}`);
          assert.strictEqual(d.px_index, adm.px_index, `${d.directorate}: whole-directorate scope equals the Admin view`);
        }
        // the endpoint ignores ?directorate (it lists the scope), so asking for another directorate leaks nothing
        const sneaky = await userGet(cookie, `/api/metrics/by-directorate?mode=YTD&directorate=${encodeURIComponent(dirNames[0])}`);
        assert.deepStrictEqual(sneaky.directorates.map(d => d.directorate).sort(), [dA, dB].sort());
        assert.strictEqual((await nativeFetch(`${BASE_URL}/api/metrics/by-directorate`)).status, 401);
      });

      await runTest('[POSITIVE] Under a directorate filter the bankwide-only metrics count at their bankwide value: recomputing Survey/Outcome/PX from the per-metric values gives the scorecard; detail and alerts read them bankwide too', async () => {
        const name = dirNames[0];
        const q = `mode=YTD&directorate=${encodeURIComponent(name)}`;
        const dir = await aj50(`/api/metrics/calculate?${q}`);
        const bank = await aj50('/api/metrics/calculate?mode=YTD');
        const nonEmp = dir.metrics.filter(m => m.is_employee_metric === false);
        assert.ok(nonEmp.length >= liveSeedIds(5).length);
        for (const m of nonEmp) {
          const b = bank.metrics.find(x => x.metric_id === m.metric_id);
          assert.strictEqual(m.is_bankwide_value, true);
          assert.strictEqual(m.normalized_score, b.normalized_score, `metric ${m.metric_id} at its bankwide value`);
        }
        const wmean = list => { const w = list.reduce((s, m) => s + m.weight, 0); return w > 0 ? list.reduce((s, m) => s + m.normalized_score * m.weight, 0) / w : null; };
        const live = dir.metrics.filter(m => m.has_data && !m.is_disabled && !m.excluded_from_index);
        assert.strictEqual(live.length, dir.metrics.filter(m => m.has_data).length, 'every metric with data counts');
        const S = wmean(live.filter(m => m.metric_type === 'SURVEY'));
        const O = wmean(live.filter(m => m.metric_type === 'OUTCOME'));
        near(dir.survey_index, S, 0.02, 'survey index incl. bankwide-only survey metrics');
        near(dir.outcome_index, O, 0.02, 'outcome index = all outcome metrics');
        // outcome metrics are bankwide snapshots; a bankwide-only manual value (v2.54.2) is N/A per directorate, so compare with the
        // bankwide values of the outcome metrics that count under this filter
        // v2.55.0: an employee OUTCOME summary-part metric (19, 20) reads the directorate's own rows - only the others equal bankwide
        const bankLike = live.filter(m => m.metric_type === 'OUTCOME' && !(m.data_upload === 'PART_SUMMARY' && m.is_employee_metric !== false));
        const bankO = wmean(bank.metrics.filter(m => bankLike.some(l => l.metric_id === m.metric_id)));
        near(wmean(bankLike), bankO, 0.01, 'the outcome metrics without directorate data equal their bankwide values');
        near(dir.px_index, 0.7 * S + 0.3 * O, 0.02, 'px index');
        // the employee-only index differs: proves the bankwide-only survey metrics really are inside
        const empOnly = wmean(live.filter(m => m.metric_type === 'SURVEY' && m.is_employee_metric !== false));
        // (v2.55.0: metric 2 is N/A and metric 5 a summary metric without an upload yet - only when one has data)
        if (live.some(m => m.metric_type === 'SURVEY' && m.is_employee_metric === false)) assert.ok(Math.abs(empOnly - S) > 0.001, 'guard: including the bankwide-only survey metrics changes the survey index');
        // detail of a non-employee metric under the filter = bankwide detail (Admin too)
        const sm = nonEmp.find(m => m.metric_type === 'SURVEY' && m.has_data) || nonEmp.find(m => m.metric_type === 'SURVEY');
        const dDir = await aj50(`/api/metrics/${sm.metric_id}/detail?${q}`);
        const dBank = await aj50(`/api/metrics/${sm.metric_id}/detail?mode=YTD`);
        assert.strictEqual(dDir.is_bankwide_value, true);
        assert.strictEqual(dDir.is_disabled, false);
        assert.strictEqual(dDir.total_respondents, dBank.total_respondents);
        // alerts under the filter: non-employee deficits appear flagged as bankwide, with the bankwide score
        const alerts = await aj50(`/api/alerts?directorate=${encodeURIComponent(name)}`);
        const expected = live.filter(m => m.status === 'CRITICAL' || m.status === 'WARNING').map(m => m.metric_id).sort((a, b) => a - b);
        assert.deepStrictEqual(alerts.alerts.map(a => a.metric_id).sort((a, b) => a - b), expected, 'alerts = deficits of every counted metric');
        alerts.alerts.forEach(a => {
          const m = dir.metrics.find(x => x.metric_id === a.metric_id);
          assert.strictEqual(a.is_bankwide_readonly, m.is_bankwide_value);
          assert.strictEqual(a.current_score, m.normalized_score);
        });
      });
    } finally {
      const w = await weightsSetting();
      if (JSON.stringify(w) !== JSON.stringify(weights50)) await putWeights(weights50);
      for (const id of users50) await adminJson('DELETE', `/api/admin/users/${id}`);
    }
  }

  // --- MODULE 51 (v2.49.0): MENU ACCESS PER USER ---
  // Every USER has a menu access set over 6 menus (default: all on except Signature Program Events); an ADMIN always has
  // all. `events` gates every event API except the public check-in / feedback routes, `exit_interview` gates
  // /api/exit-interview/*, `action_library` gates GET /api/action-library; the other menus are hidden in the UI only.
  // The setting event_manager_directorates no longer grants anything (upgrade step moves old event managers to events = true).
  console.log('\n📦 MODULE 51: Menu access per user - defaults, events / exit interview / action library enforced server-side, validation, migration (Positive & Negative Testing)');
  {
    const stamp51 = Date.now().toString(36);
    const users51 = [];
    const events51 = [];
    const DEFAULT51 = { dashboard: true, explore: true, exit_interview: true, action_library: true, events: false, about: true };
    const ALL51 = { dashboard: true, explore: true, exit_interview: true, action_library: true, events: true, about: true };
    const call51 = (method, p, body, cookie) => nativeFetch(`${BASE_URL}${p}`, jsonBody(method, body, cookie));
    const putMenu = (id, menu_access) => adminJson('PUT', `/api/admin/users/${id}`, { menu_access });
    const makeUser51 = async (suffix, extra = {}) => {
      const username = `rt51${suffix}${stamp51}`;
      const res = await adminJson('POST', '/api/admin/users', { username, full_name: `Regression 51 ${suffix}`, role: 'USER', scopes: [{ directorate: itDir.directorate_name, divisions: null }], ...extra });
      assert.strictEqual(res.status, 201, `create ${suffix}: ${res.status}`);
      const body = await res.json();
      users51.push(body.user.user_id);
      const first = await loginAs(username, body.temporary_password);
      const password = require('crypto').randomBytes(9).toString('hex') + 'Dd4';
      assert.strictEqual((await call51('POST', '/api/auth/change-password', { current_password: body.temporary_password, new_password: password }, first.cookie)).status, 200);
      const { cookie } = await loginAs(username, password);
      return { id: body.user.user_id, username, cookie, created: body.user };
    };
    const me51 = async cookie => (await call51('GET', '/api/auth/me', undefined, cookie)).json();

    try {
      await runTest('[POSITIVE] A new USER gets the default menu access (all on except Signature Program Events) in the create answer, /api/auth/me and the user list; the Admin has every menu', async () => {
        const u = await makeUser51('a');
        assert.deepStrictEqual(u.created.menu_access, DEFAULT51);
        const me = await me51(u.cookie);
        assert.deepStrictEqual(me.user.menu_access, DEFAULT51);
        assert.strictEqual(me.permissions.can_manage_events, false);
        const listed = (await (await adminJson('GET', '/api/admin/users')).json()).find(x => x.user_id === u.id);
        assert.deepStrictEqual(listed.menu_access, DEFAULT51);
        const admin = await (await adminJson('GET', '/api/auth/me')).json();
        assert.deepStrictEqual(admin.user.menu_access, ALL51, 'ADMIN always has every menu');
        assert.strictEqual(admin.permissions.can_manage_events, true);
        // the defaults are enforced: events 403, exit interview + action library 200
        assert.strictEqual((await call51('GET', '/api/events', undefined, u.cookie)).status, 403);
        assert.strictEqual((await call51('GET', '/api/exit-interview/summary', undefined, u.cookie)).status, 200);
        assert.strictEqual((await call51('GET', '/api/action-library', undefined, u.cookie)).status, 200);
      });

      await runTest('[POSITIVE] Admin ticks Signature Program Events: the USER can read and manage events at once (list, detail, question bank, QR, create, questions, delete), audited as USER_MENU_ACCESS_CHANGE; switched off -> 403 on the next request', async () => {
        const u = await makeUser51('b');
        const put = await putMenu(u.id, { events: true });
        assert.strictEqual(put.status, 200);
        assert.deepStrictEqual((await put.json()).user.menu_access, { ...DEFAULT51, events: true });
        assert.strictEqual((await me51(u.cookie)).permissions.can_manage_events, true, 'no re-login needed');
        for (const p of ['/api/events', '/api/events/ev-perspektif-2024-q1', '/api/questions/master', '/api/qrcode?text=x']) {
          assert.strictEqual((await call51('GET', p, undefined, u.cookie)).status, 200, `GET ${p}`);
        }
        const detail = await (await call51('GET', '/api/events/ev-perspektif-2024-q1', undefined, u.cookie)).json();
        assert.ok(detail.event.pre_event_code && detail.attendances.every(a => a.nip), 'full manager view (codes, attendee data)');
        const created = await call51('POST', '/api/events', { event_name: 'Regression Test Event (Module 51 Menu Access)', program_category: 'Testing', event_type: 'Online', event_date: '2026-08-21', target_participants: 3 }, u.cookie);
        assert.strictEqual(created.status, 201);
        const eventId = (await created.json()).event.event_id;
        events51.push(eventId);
        assert.strictEqual((await call51('POST', `/api/events/${eventId}/questions`, { questions: [] }, u.cookie)).status, 200);
        assert.strictEqual((await call51('DELETE', `/api/events/${eventId}`, undefined, u.cookie)).status, 200);
        events51.splice(events51.indexOf(eventId), 1);
        const log = await (await adminJson('GET', '/api/admin/audit-log?limit=100&include_test=1')).json();
        const entry = log.find(e => e.action === 'USER_MENU_ACCESS_CHANGE' && e.target === `${u.username}: events:off->on`);
        assert.ok(entry, 'USER_MENU_ACCESS_CHANGE recorded with the change');
        assert.strictEqual(entry.is_test, true, 'test-run account -> test-marked audit row');
        assert.strictEqual((await putMenu(u.id, { events: false })).status, 200);
        assert.strictEqual((await call51('GET', '/api/events', undefined, u.cookie)).status, 403);
        assert.strictEqual((await me51(u.cookie)).permissions.can_manage_events, false);
      });

      await runTest('[NEGATIVE] Events menu off: every event API answers 403 for the USER, while the public check-in / feedback routes by event code still work (with and without that login)', async () => {
        const u = await makeUser51('c');
        const ev = await (await adminJson('GET', '/api/events/ev-perspektif-2024-q1')).json();
        const gets = ['/api/events', '/api/events/ev-perspektif-2024-q1', '/api/questions/master', '/api/qrcode?text=x', '/api/reports/download/x.pptx', '/uploads/sample.jpg', '/exports/x.pptx'];
        for (const p of gets) assert.strictEqual((await call51('GET', p, undefined, u.cookie)).status, 403, `GET ${p}`);
        const writes = [['POST', '/api/events', {}], ['DELETE', '/api/events/ev-x'], ['POST', '/api/events/ev-x/questions', { questions: [] }], ['DELETE', '/api/events/ev-x/attendance/1234'],
          ['DELETE', '/api/events/ev-x/feedback/1234'], ['POST', '/api/events/ev-x/generate-ppt', {}], ['POST', '/api/media/x/transcribe', {}], ['POST', '/api/media/x/summarize', {}], ['DELETE', '/api/media/x']];
        for (const [m, p, b] of writes) assert.strictEqual((await call51(m, p, b, u.cookie)).status, 403, `${m} ${p}`);
        const denied = await (await call51('GET', '/api/events', undefined, u.cookie)).json();
        assert.strictEqual(denied.code, 'MENU_ACCESS_DENIED');
        assert.strictEqual(denied.menu, 'events');
        for (const cookie of [u.cookie, undefined]) {
          const pre = await call51('GET', `/api/events/by-code/${ev.event.pre_event_code}`, undefined, cookie);
          assert.strictEqual(pre.status, 200, 'public by-code lookup');
          assert.strictEqual((await pre.json()).type, 'PRE_EVENT');
          assert.strictEqual((await call51('POST', '/api/events/ev-perspektif-2024-q1/attendance', {}, cookie)).status, 400, 'public check-in reaches validation (400), not 403');
          assert.strictEqual((await call51('POST', '/api/events/ev-perspektif-2024-q1/feedback', {}, cookie)).status, 400, 'public feedback reaches validation (400), not 403');
        }
      });

      await runTest('[NEGATIVE] Exit Interview menu off -> 403 on /api/exit-interview/* ; Action Library off -> 403 on GET /api/action-library; Dashboard/Explore off stay UI-only (scorecard APIs still answer within the scope)', async () => {
        const u = await makeUser51('d', { menu_access: { exit_interview: false, action_library: false, dashboard: false, explore: false } });
        assert.deepStrictEqual(u.created.menu_access, { ...DEFAULT51, exit_interview: false, action_library: false, dashboard: false, explore: false });
        for (const p of ['/api/exit-interview/summary', '/api/exit-interview/summary?mode=MTD&year=2026&month=09', '/api/exit-interview/template', '/api/exit-interview/uploads', '/api/action-library']) {
          assert.strictEqual((await call51('GET', p, undefined, u.cookie)).status, 403, `GET ${p}`);
        }
        assert.strictEqual((await call51('GET', '/api/metrics/calculate?mode=YTD', undefined, u.cookie)).status, 200, 'scorecard API is not gated by the dashboard menu');
        assert.strictEqual((await call51('GET', '/api/alerts', undefined, u.cookie)).status, 200, 'alerts feed the Dashboard too');
        assert.strictEqual((await putMenu(u.id, { exit_interview: true })).status, 200);
        assert.strictEqual((await call51('GET', '/api/exit-interview/summary', undefined, u.cookie)).status, 200);
        assert.strictEqual((await adminJson('GET', '/api/exit-interview/summary')).status, 200, 'Admin always');
        assert.strictEqual((await adminJson('GET', '/api/action-library')).status, 200, 'Admin always');
      });

      await runTest('[NEGATIVE] Invalid menu_access is refused with 400 and stores nothing (unknown key, non-boolean, array, text); an ADMIN cannot be limited (any false -> 400, all true is accepted and ignored)', async () => {
        const u = await makeUser51('e');
        const bad = [{ reports: true }, { events: 'yes' }, { events: 1 }, { dashboard: null }, [true], 'events', 5];
        for (const v of bad) {
          const r = await putMenu(u.id, v);
          assert.strictEqual(r.status, 400, `PUT ${JSON.stringify(v)}`);
          assert.ok((await r.json()).error);
          const c = await adminJson('POST', '/api/admin/users', { username: `rt51x${stamp51}`, full_name: 'Regression 51 X', role: 'USER', scopes: [{ directorate: itDir.directorate_name, divisions: null }], menu_access: v });
          assert.strictEqual(c.status, 400, `POST ${JSON.stringify(v)}`);
        }
        assert.ok(!(await (await adminJson('GET', '/api/admin/users')).json()).some(x => x.username === `rt51x${stamp51}`), 'rejected creates store nothing');
        assert.deepStrictEqual((await me51(u.cookie)).user.menu_access, DEFAULT51, 'rejected updates change nothing');
        const adm = await adminJson('POST', '/api/admin/users', { username: `rt51adm${stamp51}`, full_name: 'Regression 51 Admin', role: 'ADMIN', scopes: [], menu_access: { events: false } });
        assert.strictEqual(adm.status, 400, 'ADMIN with a menu switched off');
        const adm2 = await adminJson('POST', '/api/admin/users', { username: `rt51adm${stamp51}`, full_name: 'Regression 51 Admin', role: 'ADMIN', scopes: [], menu_access: ALL51 });
        assert.strictEqual(adm2.status, 201);
        const a2 = (await adm2.json()).user;
        users51.push(a2.user_id);
        assert.deepStrictEqual(a2.menu_access, ALL51);
        assert.strictEqual((await putMenu(a2.user_id, { about: false })).status, 400);
        // null resets a USER to the defaults
        assert.strictEqual((await putMenu(u.id, { events: true, about: false })).status, 200);
        const reset = await putMenu(u.id, null);
        assert.strictEqual(reset.status, 200);
        assert.deepStrictEqual((await reset.json()).user.menu_access, DEFAULT51);
      });

      await runTest('[NEGATIVE] A USER cannot change their own (or anyone\'s) menu access: PUT /api/admin/users is 403 and nothing changes; without a session 401', async () => {
        const u = await makeUser51('f');
        assert.strictEqual((await call51('PUT', `/api/admin/users/${u.id}`, { menu_access: { events: true } }, u.cookie)).status, 403);
        assert.strictEqual((await call51('PUT', `/api/admin/users/${u.id}`, { menu_access: { events: true } })).status, 401);
        const me = await me51(u.cookie);
        assert.strictEqual(me.user.menu_access.events, false);
        assert.strictEqual((await call51('GET', '/api/events', undefined, u.cookie)).status, 403);
      });

      await runTest('[POSITIVE/NEGATIVE] event_manager_directorates no longer grants event rights; the upgrade step gives events = true only to a USER still at the defaults whose scope covers such a directorate (idempotent; others untouched) + menu helper units', async () => {
        const m = require('../server/db/menuAccess');
        assert.deepStrictEqual(m.effectiveMenuAccess(null, 'USER'), DEFAULT51);
        assert.deepStrictEqual(m.effectiveMenuAccess('{"events":true,"x":true,"about":"no"}', 'USER'), { ...DEFAULT51, events: true }, 'unknown keys / non-booleans in stored data are ignored');
        assert.deepStrictEqual(m.effectiveMenuAccess({ events: false, dashboard: false }, 'ADMIN'), ALL51);
        assert.deepStrictEqual(m.effectiveMenuAccess('garbage', 'USER'), DEFAULT51);
        assert.ok(m.validateMenuAccessInput({ nope: true }).error);
        assert.deepStrictEqual(m.validateMenuAccessInput({ events: true }).patch, { events: true });
        assert.strictEqual(m.hasMenu({ role: 'USER', menu_access: null }, 'events'), false);
        assert.strictEqual(m.hasMenu({ role: 'ADMIN' }, 'events'), true);
        assert.strictEqual(m.hasMenu(null, 'events'), false);
        assert.strictEqual(m.coversEventManagerDirectorate([{ directorate: ' Human Resources ', divisions: ['x'] }], [{ value: 'human resources' }]), true);
        assert.strictEqual(m.coversEventManagerDirectorate([{ directorate: 'IT', divisions: null }], [{ value: 'Human Resources' }]), false);
        assert.strictEqual(m.describeMenuChange(DEFAULT51, { ...DEFAULT51, events: true, about: false }), 'events:off->on, about:on->off');
        // over HTTP: a USER of the HR directorate (from the setting) is NOT an event manager any more
        assert.ok(hrDir, 'the event_manager_directorates directorate exists');
        const hrUser = await makeUser51('g', { scopes: [{ directorate: hrName, divisions: null }] });
        assert.strictEqual((await me51(hrUser.cookie)).permissions.can_manage_events, false);
        assert.strictEqual((await call51('GET', '/api/events', undefined, hrUser.cookie)).status, 403);
        // the upgrade step itself (SQL backend: in-process storage over the same database; JSON runs it when auth.json loads)
        require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
        const st = require('../server/db/storage');
        if (st.backend !== 'sql') { console.log('     (upgrade-step part skipped: JSON backend - the step runs when auth.json is loaded)'); return; }
        const mk = async (suffix, scopes, menu_access) => {
          const c = await st.createUser({ is_test_account: true, username: `rt51m${suffix}${stamp51}`, full_name: 'Regression 51 migration', email: '', role: 'USER', password_hash: 'x', scopes, menu_access });
          users51.push(c.user_id);
          return c;
        };
        const covered = await mk('1', [{ directorate: itDir.directorate_name, divisions: null }, { directorate: hrName, divisions: hrDir.divisions.slice(0, 1) }], null);
        const explicit = await mk('2', [{ directorate: hrName, divisions: null }], { ...DEFAULT51, about: false });
        const other = await mk('3', [{ directorate: itDir.directorate_name, divisions: null }], null);
        assert.strictEqual(covered.menu_access, null, 'created at the defaults (NULL)');
        const ids = [covered.user_id, explicit.user_id, other.user_id];
        assert.strictEqual(await st.migrateEventManagerMenuAccess({ onlyUserIds: ids }), 1);
        assert.strictEqual(await st.migrateEventManagerMenuAccess({ onlyUserIds: ids }), 0, 'idempotent');
        assert.deepStrictEqual((await st.getUserById(covered.user_id)).menu_access, { ...DEFAULT51, events: true });
        assert.deepStrictEqual((await st.getUserById(explicit.user_id)).menu_access, { ...DEFAULT51, about: false }, 'an explicit choice is never overwritten');
        assert.strictEqual((await st.getUserById(other.user_id)).menu_access, null, 'outside the setting: untouched');
      });
    } finally {
      for (const id of events51) await adminJson('DELETE', `/api/events/${id}`);
      for (const id of users51) await adminJson('DELETE', `/api/admin/users/${id}`);
    }
  }

  // --- MODULE 52 (v2.50.0): ESS QUESTIONS FROM MANAGE QUESTIONS, PERCENTAGE TYPE, ESS CARRY-FORWARD, QUESTION SNAPSHOTS ---
  // Temporary ESS + SYSTEM metrics (deleted at the end: their uploads, results and responses go with them, the original
  // ESS files are removed); the real data is only read. Cases: template = configured questions, position mapping, wrong
  // number of question columns refused, PERCENTAGE type, carry-forward of the 2025-11 result, the 2026 dummy quarters
  // gone, an admin upload survives the boot cleanup, and evidence that keeps the question texts of each upload (.zip
  // per question-set version, plain CSV when there is one version).
  console.log('\n📦 MODULE 52: ESS questions from Manage Questions, PERCENTAGE type, ESS carry-forward, question snapshots in history / evidence (Positive & Negative Testing)');
  {
    const JSZip52 = require('jszip');
    const fs52 = require('fs');
    const path52 = require('path');
    const ess52 = require('../server/services/essSummaryService');
    const aj52 = async q => (await adminJson('GET', q)).json();
    const calc52 = q => aj52(`/api/metrics/calculate?${q}`);
    const params52 = (await aj52('/api/admin/parameters')).metrics;
    const realEss52 = params52.filter(m => m.metric_type === 'SURVEY' && m.survey_source === 'ESS' && m.metric_id <= 27);
    const RC52 = (realEss52.find(m => /role clarity/i.test(m.metric_name)) || { metric_id: 9 }).metric_id;
    const metrics52 = [];
    const essUploads52 = [];
    const isSql52 = () => require('../server/db/storage').backend === 'sql';
    const mkMetric52 = async (name, source, questions) => {
      const res = await adminJson('POST', '/api/admin/metrics', { metric_name: name, metric_type: 'SURVEY', scale_type: 'PERCENTAGE', survey_source: source, journey_id: 2, checkpoint_id: 5, target_value: 85, min_threshold: 80 });
      assert.strictEqual(res.status, 201);
      const id = (await res.json()).metric.metric_id;
      metrics52.push(id);
      const q = await adminJson('POST', `/api/admin/survey-questions/${id}`, { questions });
      assert.strictEqual(q.status, 200);
      return { id, saved: (await q.json()).questions };
    };
    const QA52 = [{ key: 'q1_clarity', label: 'Clarity', text: 'Text A one', type: 'SCALE_1_5', mandatory: true },
      { key: 'q2_support', label: 'Support', text: 'Text A two', type: 'SCALE_1_5', mandatory: true }];
    const essRow52 = (dir, level, y, m, part, idx, ...qs) => [dir, level, y, m, part, idx, ...qs];
    const essFile52 = (y, m, heads, vals) => essXlsx([ESS_HEAD('Module52 Index', heads),
      essRow52('PT Bank CIMB Niaga Tbk', 'Bankwide', y, m, 500, ...vals), essRow52('Business Banking', 'Directorate', y, m, 100, ...vals)]);
    const postEss52 = async (id, buf, name) => {
      const res = await postEssFile(id, buf, name);
      const body = await res.json();
      if (body.upload_id) essUploads52.push(body.upload_id);
      return { status: res.status, body };
    };
    const unzip52 = async res => {
      const zip = await JSZip52.loadAsync(Buffer.from(await res.arrayBuffer()));
      const out = {};
      for (const name of Object.keys(zip.files)) out[name] = await zip.file(name).async('string');
      return out;
    };

    try {
      await runTest('[POSITIVE] Question type PERCENTAGE: in the question_types catalog ("Percentage (0–100%)"), accepted by the question API for a SYSTEM metric, and every question of the 11 ESS metrics is PERCENTAGE after the boot', async () => {
        const opts = (await aj52('/api/settings')).question_types;
        assert.ok(opts.some(o => o.value === 'PERCENTAGE' && o.label === 'Percentage (0–100%)'), JSON.stringify(opts.map(o => o.value)));
        assert.ok(['SCALE_1_5', 'SCALE_1_10', 'YES_NO', 'FREE_TEXT'].every(v => opts.some(o => o.value === v)), 'the other types stay');
        const sys = await mkMetric52('REGRESSION M52 SYSTEM Metric', 'SYSTEM', [{ key: 'q1_pct', label: 'Pct Q', text: 'System text A', type: 'PERCENTAGE', mandatory: true }]);
        assert.strictEqual(sys.saved[0].type, 'PERCENTAGE');
        assert.strictEqual(realEss52.length, 11);
        for (const m of realEss52) {
          const qs = (await aj52(`/api/admin/survey-questions/${m.metric_id}`)).questions;
          assert.ok(qs.length > 0 && qs.every(q => q.type === 'PERCENTAGE'), `metric ${m.metric_id}: ${qs.map(q => q.type)}`);
        }
        const sysQs = (await aj52('/api/admin/survey-questions/8')).questions;
        assert.ok(sysQs.every(q => q.type !== 'PERCENTAGE'), 'SYSTEM survey questions are not switched');
      });

      await runTest('[POSITIVE] ESS questions come from Manage Questions: the template header = the configured texts; saving ESS questions stores them as PERCENTAGE; a text change is in the template at once', async () => {
        const e = await mkMetric52('REGRESSION M52 ESS Metric', 'ESS', QA52);
        assert.ok(e.saved.every(q => q.type === 'PERCENTAGE'), 'ESS questions saved as PERCENTAGE');
        const head = async () => (await ess52.readFirstSheet(Buffer.from(await (await fetch(`${BASE_URL}/api/surveys/template?metric_id=${e.id}`)).arrayBuffer())))[0].cells.map(c => (c && c.value !== null ? String(c.value) : ''));
        assert.deepStrictEqual((await head()).slice(5), ['REGRESSION M52 ESS Metric', 'Text A one', 'Text A two']);
      });
      const E52 = metrics52[1];

      await runTest('[NEGATIVE] An ESS file whose number of question columns with values differs from the configured questions is refused (400, nothing stored): 3 columns and 1 column for 2 questions; a header text that differs is NOT an error', async () => {
        const before = (await aj52('/api/surveys/history')).length;
        for (const [heads, vals, found] of [[['x', 'y', 'z'], [0.9, 0.8, 0.7, 0.6], 3], [['x'], [0.9, 0.8], 1]]) {
          const r = await postEss52(E52, await essFile52(2025, 'November', heads, vals), 'm52_wrong_count.xlsx');
          assert.strictEqual(r.status, 400, JSON.stringify(r.body).slice(0, 300));
          assert.ok(r.body.errors.some(er => er.row_number === 1 && er.reason.includes(`${found} question column`) && er.reason.includes('2 questions are configured')), JSON.stringify(r.body.errors));
        }
        assert.strictEqual((await aj52('/api/surveys/history')).length, before, 'nothing recorded');
        assert.strictEqual((await calc52('mode=YTD&year=2025')).metrics.find(m => m.metric_id === E52).status, 'NO_DATA');
      });

      await runTest('[POSITIVE] Position mapping: column G = question 1, H = question 2 whatever the header says; the detail shows the configured texts, the file header as file_label, and the upload stores the question snapshot', async () => {
        const r = await postEss52(E52, await essFile52(2025, 'November', ['File header X', 'File header Y'], [0.9, 0.8, 0.7]), 'm52_2025.xlsx');
        assert.strictEqual(r.status, 200, JSON.stringify(r.body).slice(0, 300));
        assert.deepStrictEqual(r.body.question_labels, ['Text A one', 'Text A two']);
        assert.deepStrictEqual(r.body.file_question_labels, ['File header X', 'File header Y']);
        const d = await aj52(`/api/metrics/${E52}/detail?mode=YTD&year=2025`);
        assert.deepStrictEqual(d.questions_breakdown.map(q => [q.key, q.text, q.normalized_score, q.file_label, q.type]),
          [['q1_clarity', 'Text A one', 80, 'File header X', 'PERCENTAGE'], ['q2_support', 'Text A two', 70, 'File header Y', 'PERCENTAGE']]);
        assert.deepStrictEqual([d.question_text_source, d.questions_changed_since_upload], ['SNAPSHOT', false]);
        const h = (await aj52('/api/surveys/history')).find(x => x.upload_id === r.body.upload_id);
        assert.deepStrictEqual(h.questions_snapshot[E52].map(q => [q.key, q.text, q.type, q.order]), [['q1_clarity', 'Text A one', 'PERCENTAGE', 1], ['q2_support', 'Text A two', 'PERCENTAGE', 2]]);
        const ev = await fetch(`${BASE_URL}/api/surveys/evidence?metric_id=${E52}&period=YTD`);
        assert.match(ev.headers.get('content-type'), /text\/csv/, 'one question-set version -> plain CSV as before');
        assert.match(ev.headers.get('content-disposition'), new RegExp(`Evidence_ESS_Summary_Metric_${E52}\\.csv`));
        const lines = (await ev.text()).replace(/^﻿/, '').split(/\r\n/);
        assert.ok(lines[0].startsWith('Directorate,Level,Year,Month,Participation,Index_%,Text A one (%),Text A two (%),Metric_ID,'), lines[0]);
        assert.ok(lines[1].startsWith('PT Bank CIMB Niaga Tbk,Bankwide,2025,November,500,90,80,70,'), lines[1]);
      });

      await runTest('[POSITIVE] Question text changed after the upload: template and detail follow the new text at once, the old result is flagged "changed since upload" with its original text; a second upload makes the evidence a .zip with one CSV per question set (text A / text B) + README', async () => {
        const qB = [{ ...QA52[0], text: 'Text B one' }, QA52[1]];
        assert.strictEqual((await adminJson('POST', `/api/admin/survey-questions/${E52}`, { questions: qB })).status, 200);
        const tpl = await ess52.readFirstSheet(Buffer.from(await (await fetch(`${BASE_URL}/api/surveys/template?metric_id=${E52}`)).arrayBuffer()));
        assert.deepStrictEqual(tpl[0].cells.slice(6).map(c => c.value), ['Text B one', 'Text A two']);
        const d = await aj52(`/api/metrics/${E52}/detail?mode=YTD&year=2025`);
        assert.strictEqual(d.questions_changed_since_upload, true);
        assert.deepStrictEqual(d.questions_breakdown.map(q => [q.text, q.text_changed, q.original_texts]), [['Text B one', true, ['Text A one']], ['Text A two', false, []]]);
        const r = await postEss52(E52, await essFile52(2026, 'March', ['a', 'b'], [0.95, 0.9, 0.85]), 'm52_2026.xlsx');
        assert.strictEqual(r.status, 200, JSON.stringify(r.body).slice(0, 300));
        assert.strictEqual((await aj52(`/api/metrics/${E52}/detail?mode=MTD&year=2026&month=03`)).questions_changed_since_upload, false);
        const ev = await fetch(`${BASE_URL}/api/surveys/evidence?metric_id=${E52}&period=YTD`);
        assert.strictEqual(ev.status, 200);
        assert.match(ev.headers.get('content-type'), /application\/zip/);
        assert.match(ev.headers.get('content-disposition'), new RegExp(`Evidence_ESS_Summary_Metric_${E52}\\.zip`));
        const files = await unzip52(ev);
        const csvs = Object.keys(files).filter(n => n.endsWith('.csv')).sort();
        assert.strictEqual(csvs.length, 2, Object.keys(files).join(','));
        assert.ok(files['README.txt'] && files['README.txt'].includes('Text A one') && files['README.txt'].includes('Text B one'));
        const heads = csvs.map(n => files[n].replace(/^﻿/, '').split(/\r\n/));
        const vA = heads.find(l => l[0].includes('Text A one (%)'));
        const vB = heads.find(l => l[0].includes('Text B one (%)'));
        assert.ok(vA && vB, csvs.map(n => files[n].split(/\r\n/)[0]).join(' | '));
        assert.ok(vA.slice(1).every(l => l.includes(',2025,November,')) && vA.length === 3, 'version A = the 2025 rows');
        assert.ok(vB.slice(1).every(l => l.includes(',2026,March,')) && vB.length === 3, 'version B = the 2026 rows');
        assert.ok(!vA[0].includes('Text B one'), 'old rows are never relabelled with the new text');
      });

      await runTest('[POSITIVE] SYSTEM CSV upload: a PERCENTAGE question takes 0-100 (a value over 100 is refused), the batch stores its question snapshot, one version = plain CSV; after a text change + new upload the evidence is a .zip and the detail flags the changed question', async () => {
        const S52 = metrics52[0];
        const csv = (rows) => ['nip,employee_name,cimb_email,directorate,division,survey_date,q1_pct,verbatim_feedback', ...rows].join('\r\n');
        const up1 = await adminJson('POST', '/api/surveys/upload', { csvText: csv(['8852001,Regression M52 A,m52a@cimbniaga.co.id,Human Resources,People Experience & Culture,2026-02-10,85%,ok', '8852002,Regression M52 B,m52b@cimbniaga.co.id,Human Resources,People Experience & Culture,2026-02-11,150,too high']), fileName: 'm52_sys_1.csv', metric_id: S52 });
        const b1 = await up1.json();
        assert.strictEqual(up1.status, 200, JSON.stringify(b1).slice(0, 300));
        assert.deepStrictEqual([b1.valid_rows, b1.invalid_rows], [1, 1]);
        assert.match(b1.errors[0].reason, /0 - 100%/);
        const h = (await aj52('/api/surveys/history')).find(x => x.upload_id === b1.upload_id);
        assert.deepStrictEqual(h.questions_snapshot[S52].map(q => [q.key, q.text, q.type]), [['q1_pct', 'System text A', 'PERCENTAGE']]);
        const one = await fetch(`${BASE_URL}/api/surveys/evidence?metric_id=${S52}&period=2026`);
        assert.match(one.headers.get('content-type'), /text\/csv/);
        const lines = (await one.text()).replace(/^﻿/, '').split(/\r\n/);
        assert.ok(lines[0].includes('q1_pct_Pct_Q') && lines.length === 2 && lines[1].includes(',85,'), lines.join(' | '));
        assert.strictEqual((await aj52(`/api/metrics/${S52}/detail?mode=YTD&year=2026`)).questions_breakdown[0].avg_score, 85);
        assert.strictEqual((await adminJson('POST', `/api/admin/survey-questions/${S52}`, { questions: [{ key: 'q1_pct', label: 'Pct Q', text: 'System text B', type: 'PERCENTAGE', mandatory: true }] })).status, 200);
        const up2 = await adminJson('POST', '/api/surveys/upload', { csvText: csv(['8852003,Regression M52 C,m52c@cimbniaga.co.id,Human Resources,People Experience & Culture,2026-03-10,70,ok']), fileName: 'm52_sys_2.csv', metric_id: S52 });
        assert.strictEqual(up2.status, 200);
        const d = await aj52(`/api/metrics/${S52}/detail?mode=YTD&year=2026`);
        assert.strictEqual(d.questions_changed_since_upload, true);
        assert.deepStrictEqual(d.questions_breakdown[0].original_texts, ['System text A']);
        const two = await fetch(`${BASE_URL}/api/surveys/evidence?metric_id=${S52}&period=2026`);
        assert.match(two.headers.get('content-type'), /application\/zip/);
        const files = await unzip52(two);
        assert.strictEqual(Object.keys(files).filter(n => n.endsWith('.csv')).length, 2);
        assert.ok(files['README.txt'].includes('System text A') && files['README.txt'].includes('System text B'));
      });

      await runTest('[POSITIVE] ESS carry-forward on the real data: YTD 2026, MTD 2026-01 and MTD 2026-10 read the 2025-11 result for all 11 ESS metrics (Role Clarity = 92), YTD 2025 too; the temporary metric reads 2025-11 until its 2026-03 upload', async () => {
        for (const q of ['mode=YTD&year=2026', 'mode=MTD&year=2026&month=01', 'mode=MTD&year=2026&month=10', 'mode=YTD&year=2025']) {
          const c = await calc52(q);
          const ess = c.metrics.filter(m => realEss52.some(r => r.metric_id === m.metric_id));
          assert.ok(ess.length === 11 && ess.every(m => m.has_data && m.ess_period === '2025-11' && m.period_window.basis === 'LATEST_RESULT'), `${q}: ${ess.map(m => `${m.metric_id}:${m.ess_period}`)}`);
          assert.strictEqual(ess.find(m => m.metric_id === RC52).normalized_score, 92, q);
        }
        assert.strictEqual((await calc52('mode=MTD&year=2026&month=02')).metrics.find(m => m.metric_id === E52).ess_period, '2025-11');
        assert.strictEqual((await calc52('mode=MTD&year=2026&month=03')).metrics.find(m => m.metric_id === E52).normalized_score, 95);
      });

      await runTest('[NEGATIVE] ESS before the first result is NO_DATA (MTD 2025-10: all 11); the 2026 dummy quarters are gone (no seed-ess-*-2026-* upload, no 2026 ESS result of the seed)', async () => {
        const c = await calc52('mode=MTD&year=2025&month=10');
        assert.ok(c.metrics.filter(m => realEss52.some(r => r.metric_id === m.metric_id)).every(m => m.status === 'NO_DATA'));
        const hist = await aj52('/api/surveys/history');
        assert.ok(!hist.some(u => /^seed-ess-\d+-2026-/.test(u.upload_id)), 'no dummy 2026 seed uploads');
        assert.strictEqual(hist.filter(u => /^seed-ess-\d+-2025-11$/.test(u.upload_id)).length, 11, 'the 2025-11 seed stays');
        const seed = require('../server/db/seedData');
        assert.ok(seed.initialEssResults.every(r => r.survey_year === 2025 && r.survey_month === 11), 'the seed has only 2025-11');
        assert.strictEqual(seed.isRemovedEssDummyUpload({ upload_id: `seed-ess-${RC52}-2026-03`, metric_id: RC52, uploaded_by: 'Regression Suite Admin (rt-suite-x)' }), false, 'never an upload by somebody else');
        assert.strictEqual(seed.isRemovedEssDummyUpload({ upload_id: `seed-ess-${RC52}-2025-11`, metric_id: RC52, uploaded_by: 'Seed (dummy)' }), false, 'never the 2025-11 seed');
        assert.strictEqual(seed.isRemovedEssDummyUpload({ upload_id: `seed-ess-${RC52}-2026-06`, metric_id: RC52, uploaded_by: 'Seed (dummy)' }), true);
      });

      if (isSql52()) {
        await runTest('[POSITIVE] (SQL Server) The boot (ESS PERCENTAGE switch + dummy-quarter cleanup + seed top-up) never deletes an admin ESS upload of a 2026 period', async () => {
          const st = require('../server/db/storage');
          const before = (await st.getEssResults(E52)).map(r => `${r.upload_id}|${r.survey_year}-${r.survey_month}`).sort();
          assert.ok(before.some(k => k.endsWith('|2026-3')));
          await st.init();
          assert.deepStrictEqual((await st.getEssResults(E52)).map(r => `${r.upload_id}|${r.survey_year}-${r.survey_month}`).sort(), before);
          assert.ok((await st.getSurveyUploads()).some(u => u.upload_id === essUploads52[essUploads52.length - 1]));
        });
      }
    } finally {
      for (const id of metrics52) await adminJson('DELETE', `/api/admin/metrics/${id}`);
      for (const id of essUploads52) {
        const f = path52.join(ess52.ESS_UPLOAD_DIR, `${id}.xlsx`);
        if (fs52.existsSync(f)) fs52.unlinkSync(f);
      }
    }
  }

  // --- MODULE 53 (v2.51.0): DIRECTORATE MASTER ADMINISTRATION (ADMIN PARAMETERS -> DIRECTORATES) ---
  // Add / rename / delete / merge directorates and add / rename / delete divisions (Admin only, 403 for a User). A rename or
  // merge cascades the name into every table that copies it and records the former name (alias), which the ESS / Exit
  // Interview / survey CSV imports and the check-in keep recognising (chains included); delete only when nothing references
  // the directorate / division (409 + counts). Works on temporary "RT53 ..." directorates only, with its own temp metrics
  // (their survey + ESS rows go with them), users, attendances and fixtures, all removed in finally; the settings it touches
  // are restored. Exit Interview fixtures, legacy user columns, recruitment SLA rows and the boot checks are SQL Server only.
  console.log('\n📦 MODULE 53: Directorate master - add / rename / delete / merge directorates and divisions, cascade, former names, boot protection (Positive & Negative Testing)');
  if (!skipModuleBlock(53)) {
    const st53 = require('../server/db/storage');
    const isSql53 = st53.backend === 'sql';
    const dn53 = require('../server/db/directoryNames');
    const dm53 = require('../server/db/directorateMigration');
    const seed53 = require('../server/db/seedData');
    const stamp53 = Date.now().toString(36);
    const N = s => `RT53 ${s} ${stamp53}`;
    const A0 = N('Alpha');
    const A1 = N('Beta');
    const A2 = N('Gamma');
    const B0 = N('Delta');
    const EV = 'ev-perspektif-2024-q1';
    const call53 = (method, p, body, cookie) => nativeFetch(`${BASE_URL}${p}`, jsonBody(method, body, cookie));
    const aj53 = async (method, p, body) => { const r = await adminJson(method, p, body); return { status: r.status, body: await r.json().catch(() => ({})) }; };
    const list53 = async () => (await aj53('GET', '/api/admin/directorates')).body.directorates;
    const find53 = async name => (await list53()).find(d => d.name === name);
    const idOf = async name => (await find53(name)).directorate_id;
    const metrics53 = [];
    const users53 = [];
    const nips53 = [];
    const essUploads53 = [];
    const exitUploads53 = [];
    const settings0 = await (await fetch(`${BASE_URL}/api/settings`)).json();
    const managers0 = settings0.event_manager_directorates;
    const flag0 = settings0.directory_admin_managed;
    const pool53 = isSql53 ? await new (require('mssql').ConnectionPool)({ server: process.env.DB_SERVER || 'localhost', port: parseInt(process.env.DB_PORT || '1433', 10), database: process.env.DB_NAME || 'PeopleExperiencePX',
      user: process.env.DB_USER, password: process.env.DB_PASSWORD, options: { encrypt: false, trustServerCertificate: true } }).connect() : null;
    const q53 = async (text, params = {}) => {
      const r = pool53.request();
      Object.entries(params).forEach(([k, v]) => r.input(k, v));
      return (await r.query(text)).recordset;
    };
    const createDir53 = async (name, divisions) => {
      const r = await aj53('POST', '/api/admin/directorates', { name, divisions });
      assert.strictEqual(r.status, 201, JSON.stringify(r.body));
      return r.body.directorate;
    };
    const mkMetric53 = async (name, extra) => {
      const res = await adminJson('POST', '/api/admin/metrics', { metric_name: name, metric_type: 'SURVEY', journey_id: 2, checkpoint_id: 5, target_value: 85, min_threshold: 80, ...extra });
      assert.strictEqual(res.status, 201);
      const id = (await res.json()).metric.metric_id;
      metrics53.push(id);
      return id;
    };
    const makeUser53 = async (suffix, scopes) => {
      const username = `rt53${suffix}${stamp53}`;
      const res = await adminJson('POST', '/api/admin/users', { username, full_name: `Regression 53 ${suffix}`, role: 'USER', scopes });
      assert.strictEqual(res.status, 201, `create user ${suffix}: ${res.status}`);
      const body = await res.json();
      users53.push(body.user.user_id);
      const first = await loginAs(username, body.temporary_password);
      const password = require('crypto').randomBytes(9).toString('hex') + 'Ee5';
      assert.strictEqual((await call53('POST', '/api/auth/change-password', { current_password: body.temporary_password, new_password: password }, first.cookie)).status, 200);
      const { cookie } = await loginAs(username, password);
      return { id: body.user.user_id, cookie, username };
    };
    // v2.51.0 fix: a division is named in the body (PUT) / query string (DELETE), never in the URL path
    const divUrl = (id, division) => `/api/admin/directorates/${id}/divisions${division === undefined ? '' : `?${new URLSearchParams({ division })}`}`;
    const scopesOf53 = async userId => (await (await adminJson('GET', '/api/admin/users')).json()).find(u => u.user_id === userId).scopes;
    const scopeStatus = async (u, dir, div) => (await call53('GET', `/api/metrics/calculate?mode=YTD&directorate=${encodeURIComponent(dir)}${div ? `&sub_directorate=${encodeURIComponent(div)}` : ''}`, undefined, u.cookie)).status;
    const checkIn53 = async (tag, directorate, division) => {
      const nip = `RT53${tag}${stamp53}`.slice(0, 15);
      const r = await aj53('POST', `/api/events/${EV}/attendance`, { nip, employee_name: `Regression 53 ${tag}`, cimb_email: `${nip.toLowerCase()}@example.test`, directorate, division });
      assert.strictEqual(r.status, 201, JSON.stringify(r.body));
      nips53.push(nip);
      return r.body.attendance;
    };
    const day53 = new Date().toISOString().slice(0, 10);
    const csv53 = rows => ['nip,employee_name,cimb_email,directorate,division,survey_date,q1_overall', ...rows].join('\r\n');
    const csvRow53 = (nip, dir, div, score) => `${nip},Regression 53,${nip}@example.test,${csvCell(dir)},${csvCell(div)},${day53},${score}`;
    const uploadCsv53 = async (metricId, rows) => {
      const res = await adminJson('POST', '/api/surveys/upload', { csvText: csv53(rows), fileName: 'rt53.csv', metric_id: metricId });
      assert.strictEqual(res.status, 200);
      return res.json();
    };
    const essFile53 = (year, month, rows) => essXlsx([ESS_HEAD('RT53 Index', ['RT53 question']), ...rows.map(([dir, part, idx, q]) => [dir, 'Directorate', year, month, part, idx, q])]);
    const postEss53 = async (metricId, buf) => {
      const res = await postEssFile(metricId, buf, 'rt53_ess.xlsx');
      const body = await res.json();
      if (body.upload_id) essUploads53.push(body.upload_id);
      return { status: res.status, body };
    };
    const essDirs53 = async (metricId, period) => (await aj53('GET', `/api/metrics/${metricId}/detail?period=${period}`)).body.ess_results_by_directorate
      .filter(r => r.org_level === 'DIRECTORATE');
    const attendance53 = async () => (await aj53('GET', `/api/events/${EV}`)).body.attendances.filter(a => nips53.includes(a.nip));
    // Exit Interview fixtures (SQL only): one Termination Report row; NIK prefix RT53-, month 2098-05 (no other data)
    const exitSvc53 = require('../server/services/exitInterviewService');
    const exitRow53 = (nik, dir, div) => [nik, `Regression Exit ${nik}`, '2098-05-10', 'NORMAL_RESIGNATION', 'FAMILY', 'U7', '70', '-', '-', 'Officer', '-', '-', '-', '-',
      ...Array.from({ length: 15 }, () => '-'), 'Yes', 'Yes', '-', '-', dir, div || ''];
    const postExit53 = async rows => {
      const buf = await require('../server/services/xlsxUtils').buildXlsx([['Report Exit Interview (regression 53)'], [...exitSvc53.TEMPLATE_COLUMNS.map(c => c.title), 'Directorate', 'Division'], ...rows], { headerRow: 1 });
      const fd = new FormData();
      fd.append('file', new Blob([buf]), 'module53_exit.xlsx');
      const res = await fetch(`${BASE_URL}/api/exit-interview/upload`, { method: 'POST', body: fd });
      const body = await res.json();
      if (body.upload_id) exitUploads53.push(body.upload_id);
      return { status: res.status, body };
    };

    let SYS53 = null;   // temp SYSTEM survey metric (CSV rows)
    let ESS53 = null;   // temp ESS metric (ESS summary rows)
    let U1 = null;      // USER, all divisions of A
    let U2 = null;      // USER, division "RT53 Div One" of A
    try {
      await runTest('[POSITIVE] GET /api/admin/directorates: every directorate of /api/directorates with its id, divisions, usage counts per source, total and former names; name limit 200; reserved values listed', async () => {
        const r = await aj53('GET', '/api/admin/directorates');
        assert.strictEqual(r.status, 200);
        const pub = await (await fetch(`${BASE_URL}/api/directorates`)).json();
        assert.deepStrictEqual(r.body.directorates.map(d => d.name), pub.map(d => d.name));
        assert.deepStrictEqual(r.body.directorates.map(d => d.directorate_id), pub.map(d => d.directorate_id), 'the public list carries the same ids');
        const d = r.body.directorates[0];
        assert.ok(Number.isInteger(d.directorate_id) && Array.isArray(d.divisions) && Array.isArray(d.former_names));
        assert.deepStrictEqual(Object.keys(d.usage).sort(), ['attendances', 'ess_results', 'exit_interviews', 'operational_records', 'part_results', 'settings', 'survey_responses', 'user_scopes', 'users']);
        assert.strictEqual(d.total_references, Object.values(d.usage).reduce((a, b) => a + b, 0));
        assert.strictEqual(r.body.max_length, 200);
        assert.ok(['ALL', 'Bankwide', 'General'].every(x => r.body.reserved_directorate_names.includes(x)));
        assert.ok(r.body.directorates.some(x => x.total_references > 0), 'the real directorates are referenced by data');
      });

      await runTest('[NEGATIVE] Invalid names are refused with 400 and nothing is created: empty, blanks, reserved ALL / Bankwide / General / "-", "PT Bank CIMB Niaga ...", 201 characters, an existing name in another letter case, divisions not a list, duplicate divisions, a reserved division', async () => {
        const before = (await list53()).length;
        const existing = (await list53())[0].name;
        const bad = [{}, { name: '' }, { name: '   ' }, { name: 42 }, { name: 'all' }, { name: 'BANKWIDE' }, { name: 'General' }, { name: '-' }, { name: 'PT Bank CIMB Niaga Syariah' },
          { name: 'x'.repeat(201) }, { name: ` ${existing.toUpperCase()} ` }, { name: N('Bad'), divisions: 'one' }, { name: N('Bad'), divisions: ['D1', ' d1 '] }, { name: N('Bad'), divisions: ['ALL'] }];
        for (const body of bad) {
          const r = await aj53('POST', '/api/admin/directorates', body);
          assert.strictEqual(r.status, 400, `${JSON.stringify(body).slice(0, 60)} -> ${r.status}`);
          assert.ok(r.body.error);
        }
        assert.strictEqual((await list53()).length, before);
        assert.ok(!(await find53(N('Bad'))));
      });

      await runTest('[NEGATIVE] (fix #1/#3/#4) Names made of dots, invisible characters (zero-width space / joiner, BOM, bidi marks) and an NFD spelling of an existing name are refused; non-breaking / odd spaces become ordinary spaces and names are stored in NFC', async () => {
        for (const name of ['.', '..', ' ... ', N('ZW') + '\u200b', `RT53\u200dJ ${stamp53}`, `\ufeff${N('BOM')}`, `RT53 \u202eBidi ${stamp53}`]) {
          const r = await aj53('POST', '/api/admin/directorates', { name });
          assert.strictEqual(r.status, 400, `${JSON.stringify(name)} -> ${r.status}`);
        }
        const cafe = await createDir53(`RT53 Caf\u00e9 ${stamp53}`);
        const nfd = await aj53('POST', '/api/admin/directorates', { name: `RT53 Cafe\u0301 ${stamp53}` });
        assert.strictEqual(nfd.status, 400, 'the decomposed spelling is the same name');
        const nfdOnly = await createDir53(`RT53 Sole\u0301 ${stamp53}`);
        assert.strictEqual(nfdOnly.name, `RT53 Sol\u00e9 ${stamp53}`, 'stored in NFC');
        const nb = await createDir53(`RT53\u00a0Space\u3000${stamp53}`);
        assert.strictEqual(nb.name, `RT53 Space ${stamp53}`);
        assert.strictEqual((await aj53('PUT', `/api/admin/directorates/${nb.directorate_id}`, { name: `RT53 Space${'\u200b'} ${stamp53}` })).status, 400);
        for (const d of [cafe, nfdOnly, nb]) assert.strictEqual((await aj53('DELETE', `/api/admin/directorates/${d.directorate_id}`)).status, 200);
      });

      await runTest('[NEGATIVE] (fix #3) Parallel requests: six POSTs of one new name create it once (others 400 / 409, never 500); two parallel renames to one name succeed once', async () => {
        const race = N('Race');
        const rs = await Promise.all(Array.from({ length: 6 }, () => aj53('POST', '/api/admin/directorates', { name: race })));
        assert.strictEqual(rs.filter(r => r.status === 201).length, 1, rs.map(r => r.status).join(','));
        assert.ok(rs.every(r => [201, 400, 409].includes(r.status) && !/SQL|Violation|deadlock|constraint/i.test(r.body.error || '')), JSON.stringify(rs.map(r => [r.status, r.body.error])));
        const one = await createDir53(N('Race one'));
        const two = await createDir53(N('Race two'));
        const rn = await Promise.all([one, two].map(d => aj53('PUT', `/api/admin/directorates/${d.directorate_id}`, { name: N('Race final') })));
        assert.strictEqual(rn.filter(r => r.status === 200).length, 1, rn.map(r => r.status).join(','));
        assert.ok(rn.every(r => [200, 400, 409].includes(r.status)), JSON.stringify(rn.map(r => [r.status, r.body.error])));
        for (const d of (await list53()).filter(x => x.name.startsWith('RT53 Race'))) await aj53('DELETE', `/api/admin/directorates/${d.directorate_id}`);
        assert.ok(!(await list53()).some(x => x.name.startsWith('RT53 Race')));
      });

      await runTest('[POSITIVE] Admin adds directorates with divisions (blanks trimmed / collapsed, 200 characters accepted): 201, listed in /api/directorates at once, the boot top-up is switched off (directory_admin_managed), audited DIRECTORATE_CREATE', async () => {
        const a = await createDir53(`  RT53   Alpha ${stamp53} `, ['RT53 Div One', '  RT53   Div  Two ']);
        assert.strictEqual(a.name, A0);
        assert.deepStrictEqual(a.divisions.map(v => v.name), ['RT53 Div One', 'RT53 Div Two']);
        assert.strictEqual(a.total_references, 0);
        const b = await createDir53(B0, ['rt53 div uno', 'RT53 Div Four']);
        assert.strictEqual(b.name, B0);
        const long = await createDir53(`RT53 ${stamp53} ${'L'.repeat(200 - 6 - stamp53.length)}`);
        assert.strictEqual(long.name.length, 200);
        assert.strictEqual((await aj53('DELETE', `/api/admin/directorates/${long.directorate_id}`)).status, 200);
        const pub = await (await fetch(`${BASE_URL}/api/directorates`)).json();
        assert.deepStrictEqual(pub.find(d => d.name === A0).divisions, ['RT53 Div One', 'RT53 Div Two']);
        assert.strictEqual((await (await fetch(`${BASE_URL}/api/settings`)).json()).directory_admin_managed, true);
        const audit = await (await fetch(`${BASE_URL}/api/admin/audit-log?limit=50&include_test=1`)).json();
        assert.ok(audit.some(e => e.action === 'DIRECTORATE_CREATE' && String(e.target).includes(A0)), 'DIRECTORATE_CREATE audited');
      });

      await runTest('[NEGATIVE] (fix #5) An id is only an exact positive whole number: " <id>", "<id> ", "0<id>", "+<id>", "<id>.0" in the URL and such target_id values in a merge are 404 - nothing changes', async () => {
        const id = await idOf(A0);
        const bid = await idOf(B0);
        for (const raw of [`%20${id}`, `${id}%20`, `0${id}`, `%2B${id}`, `${id}.0`, `${id}abc`, '-1', '0']) {
          assert.strictEqual((await aj53('PUT', `/api/admin/directorates/${raw}`, { name: N('Hijack') })).status, 404, `PUT ${raw}`);
          assert.strictEqual((await aj53('DELETE', `/api/admin/directorates/${raw}`)).status, 404, `DELETE ${raw}`);
          assert.strictEqual((await aj53('POST', `/api/admin/directorates/${raw}/merge`, { target_id: bid })).status, 404, `merge ${raw}`);
          assert.strictEqual((await aj53('POST', `/api/admin/directorates/${raw}/divisions`, { name: 'RT53 X' })).status, 404, `division ${raw}`);
        }
        for (const target of [` ${id}`, `${id} `, `0${id}`, `${id}.0`, 1.5, true, [id], { id }, -id]) {
          assert.strictEqual((await aj53('POST', `/api/admin/directorates/${bid}/merge`, { target_id: target })).status, 404, `target_id ${JSON.stringify(target)}`);
          if (!/^[1-9]\d*$/.test(String(target))) assert.strictEqual((await aj53('GET', `/api/admin/directorates/${bid}/merge-preview?target_id=${encodeURIComponent(String(target))}`)).status, 404, `preview ${JSON.stringify(target)}`);
        }
        assert.ok(await find53(A0) && await find53(B0) && !(await find53(N('Hijack'))), 'nothing renamed, merged or deleted');
        assert.strictEqual((await aj53('POST', `/api/admin/directorates/${bid}/merge`, { target_id: String(bid) })).status, 400, 'a digit string id is accepted (here: into itself = 400)');
      });

      // data that references A0: EMPLOYEE CSV rows, ESS rows (A0 + B0, period 2024-01), attendance, two scoped users, a setting
      SYS53 = await mkMetric53(`REGRESSION RT53 System ${stamp53}`, { scale_type: 'RATING_5', survey_source: 'SYSTEM', requires_manual_upload: false });
      ESS53 = await mkMetric53(`REGRESSION RT53 ESS ${stamp53}`, { scale_type: 'PERCENTAGE', survey_source: 'ESS' });
      assert.strictEqual((await adminJson('POST', `/api/admin/survey-questions/${ESS53}`, { questions: [{ key: 'q1_rt53', label: 'RT53', text: 'RT53 question', type: 'PERCENTAGE', mandatory: true }] })).status, 200);
      await uploadCsv53(SYS53, [csvRow53(`9${stamp53}01`, A0, 'RT53 Div One', 4), csvRow53(`9${stamp53}02`, A0, 'RT53 Div One', 5), csvRow53(`9${stamp53}03`, A0, 'RT53 Div Two', 3)]);
      const ess0 = await postEss53(ESS53, await essFile53(2024, 'January', [[A0, 100, 0.8, 0.7], [B0, 300, 0.6, 0.5]]));
      assert.strictEqual(ess0.status, 200, JSON.stringify(ess0.body).slice(0, 300));
      await checkIn53('a', A0, 'RT53 Div Two');
      U1 = await makeUser53('a', [{ directorate: A0, divisions: null }]);
      U2 = await makeUser53('b', [{ directorate: A0, divisions: ['RT53 Div One'] }]);
      assert.strictEqual((await aj53('PUT', '/api/admin/settings/event_manager_directorates', { value: [...managers0, { value: A0, label: A0 }] })).status, 200);
      if (isSql53) {
        await q53('UPDATE dbo.px_users SET directorate = @d, division = @v WHERE user_id = @id', { d: A0, v: 'RT53 Div One', id: U1.id });   // legacy v2.26.0 columns
        await q53("INSERT INTO dbo.px_recruitment_sla_by_unit (metric_id, unit, target_headcount, fulfilled, sla_achievement, status) VALUES (1, @u, 1, 1, '100%', 'Achieved')", { u: A0 });
      }

      await runTest('[POSITIVE] The usage counts show what references the directorate (survey 3, ESS 1, attendance 1, user scopes 2, setting 1; SQL also legacy user 1 + SLA 1) and per division', async () => {
        const a = await find53(A0);
        assert.deepStrictEqual([a.usage.survey_responses, a.usage.ess_results, a.usage.attendances, a.usage.user_scopes, a.usage.settings], [3, 1, 1, 2, 1]);
        if (isSql53) assert.deepStrictEqual([a.usage.users, a.usage.operational_records], [1, 1]);
        const one = a.divisions.find(v => v.name === 'RT53 Div One');
        assert.deepStrictEqual([one.usage.survey_responses, one.usage.user_scopes], [2, 1]);
        assert.strictEqual(a.divisions.find(v => v.name === 'RT53 Div Two').usage.attendances, 1);
      });

      await runTest('[NEGATIVE] Deleting a referenced directorate is refused with 409 and the per-source counts; nothing is removed', async () => {
        const r = await aj53('DELETE', `/api/admin/directorates/${await idOf(A0)}`);
        assert.strictEqual(r.status, 409);
        assert.ok(/still referenced/i.test(r.body.error));
        assert.deepStrictEqual([r.body.references.survey_responses, r.body.references.ess_results, r.body.references.attendances, r.body.references.user_scopes, r.body.references.settings], [3, 1, 1, 2, 1]);
        assert.ok(r.body.divisions_with_data.includes('RT53 Div One'));
        assert.ok(await find53(A0), 'still there');
      });

      await runTest('[POSITIVE] Rename cascades in one go: survey rows, ESS row, attendance, both user scopes (all / one division), the event_manager_directorates setting (SQL: legacy user columns, SLA unit); old name gone everywhere, kept as a former name; scoped Users read the new name at once (old name 403); audited DIRECTORATE_RENAME', async () => {
        const r = await aj53('PUT', `/api/admin/directorates/${await idOf(A0)}`, { name: A1 });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        assert.deepStrictEqual([r.body.changed, r.body.from, r.body.to], [true, A0, A1]);
        assert.deepStrictEqual([r.body.counts.survey_responses, r.body.counts.ess_results, r.body.counts.attendances, r.body.counts.user_scopes, r.body.counts.settings], [3, 1, 1, 2, 1]);
        const a = await find53(A1);
        assert.deepStrictEqual([a.usage.survey_responses, a.usage.ess_results, a.usage.attendances, a.usage.user_scopes, a.usage.settings], [3, 1, 1, 2, 1]);
        assert.deepStrictEqual(a.former_names, [A0]);
        assert.ok(!(await find53(A0)));
        assert.deepStrictEqual((await essDirs53(ESS53, '2024-01')).map(x => x.directorate).sort(), [A1, B0].sort());
        assert.deepStrictEqual((await attendance53()).map(x => x.directorate), [A1]);
        const mgr = (await (await fetch(`${BASE_URL}/api/settings`)).json()).event_manager_directorates;
        assert.ok(mgr.some(o => o.value === A1 && o.label === A1) && !mgr.some(o => o.value === A0));
        assert.strictEqual(await scopeStatus(U1, A1), 200);
        assert.strictEqual(await scopeStatus(U1, A0), 403);
        assert.strictEqual(await scopeStatus(U2, A1, 'RT53 Div One'), 200);
        assert.strictEqual(await scopeStatus(U2, A1, 'RT53 Div Two'), 403, 'a restricted scope stays restricted');
        if (isSql53) {
          assert.deepStrictEqual((await q53('SELECT directorate FROM dbo.px_users WHERE user_id = @id', { id: U1.id }))[0].directorate, A1);
          assert.strictEqual((await q53('SELECT COUNT(*) AS n FROM dbo.px_recruitment_sla_by_unit WHERE unit = @u', { u: A1 }))[0].n, 1);
          assert.strictEqual((await q53('SELECT COUNT(*) AS n FROM dbo.px_survey_uploaded_responses WHERE org_unit_1 = @u', { u: A0 }))[0].n, 0, 'no row keeps the old name');
        }
        const audit = await (await fetch(`${BASE_URL}/api/admin/audit-log?limit=50&include_test=1`)).json();
        assert.ok(audit.some(e => e.action === 'DIRECTORATE_RENAME' && String(e.target).includes(`"${A0}" -> "${A1}"`)));
      });

      await runTest('[POSITIVE] Renaming to the same name is a 200 no-op; a case-only rename changes the spelling everywhere without adding a former name', async () => {
        const id = await idOf(A1);
        const same = await aj53('PUT', `/api/admin/directorates/${id}`, { name: ` ${A1} ` });
        assert.deepStrictEqual([same.status, same.body.changed], [200, false]);
        const up = await aj53('PUT', `/api/admin/directorates/${id}`, { name: A1.toUpperCase() });
        assert.deepStrictEqual([up.status, up.body.changed, up.body.counts.survey_responses], [200, true, 3]);
        assert.strictEqual((await scopeStatus(U1, A1.toUpperCase())), 200);
        const back = await aj53('PUT', `/api/admin/directorates/${id}`, { name: A1 });
        assert.strictEqual(back.status, 200);
        assert.deepStrictEqual((await find53(A1)).former_names, [A0], 'no former name for a case-only change');
      });

      await runTest('[POSITIVE] Former names keep working in imports: an ESS summary, a survey CSV and a check-in that still use the old name are stored under the current one', async () => {
        const e = await postEss53(ESS53, await essFile53(2024, 'February', [[A0, 50, 0.9, 0.9]]));
        assert.strictEqual(e.status, 200, JSON.stringify(e.body).slice(0, 300));
        assert.deepStrictEqual((await essDirs53(ESS53, '2024-02')).map(x => x.directorate), [A1]);
        await uploadCsv53(SYS53, [csvRow53(`9${stamp53}04`, A0.toLowerCase(), 'RT53 Div Two', 4)]);
        const att = await checkIn53('b', A0, 'rt53 div two');
        assert.deepStrictEqual([att.directorate, att.division], [A1, 'RT53 Div Two']);
        const a = await find53(A1);
        assert.deepStrictEqual([a.usage.survey_responses, a.usage.ess_results, a.usage.attendances], [4, 2, 2]);
        assert.strictEqual(a.divisions.find(v => v.name === 'RT53 Div Two').usage.survey_responses, 2);
      });

      await runTest('[POSITIVE] A chain of renames resolves: A -> B -> C, an ESS file with A lands on C; former names A and B both point at C', async () => {
        const r = await aj53('PUT', `/api/admin/directorates/${await idOf(A1)}`, { name: A2 });
        assert.strictEqual(r.status, 200);
        assert.deepStrictEqual((await find53(A2)).former_names.sort(), [A0, A1].sort());
        const e = await postEss53(ESS53, await essFile53(2024, 'March', [[A0, 10, 0.5, 0.5]]));
        assert.strictEqual(e.status, 200);
        assert.deepStrictEqual((await essDirs53(ESS53, '2024-03')).map(x => x.directorate), [A2]);
        const unknown = await postEss53(ESS53, await essFile53(2024, 'March', [[N('Never existed'), 10, 0.5, 0.5]]));
        assert.strictEqual(unknown.status, 400, 'an unknown name is still refused');
      });

      await runTest('[POSITIVE] Divisions: add (201), rename cascades to survey rows and division scopes (old division 403, kept as a former division name), delete an unused one (200); rename to the same name = no-op', async () => {
        const id = await idOf(A2);
        const add = await aj53('POST', `/api/admin/directorates/${id}/divisions`, { name: ' RT53  Div Three ' });
        assert.deepStrictEqual([add.status, add.body.division], [201, 'RT53 Div Three']);
        const ren = await aj53('PUT', divUrl(id), { division: 'RT53 Div One', name: 'RT53 Div Uno' });
        assert.strictEqual(ren.status, 200, JSON.stringify(ren.body));
        assert.deepStrictEqual([ren.body.counts.survey_responses, ren.body.counts.user_scopes], [2, 1]);
        assert.strictEqual(await scopeStatus(U2, A2, 'RT53 Div Uno'), 200);
        assert.strictEqual(await scopeStatus(U2, A2, 'RT53 Div One'), 403);
        const a = await find53(A2);
        assert.deepStrictEqual(a.divisions.map(v => v.name), ['RT53 Div Three', 'RT53 Div Two', 'RT53 Div Uno'], 'listed alphabetically (v2.51.0)');
        assert.strictEqual(a.divisions.find(v => v.name === 'RT53 Div Uno').usage.survey_responses, 2);
        assert.deepStrictEqual(a.former_division_names, [{ alias_name: 'RT53 Div One', division_name: 'RT53 Div Uno' }]);
        const same = await aj53('PUT', divUrl(id), { division: 'RT53 Div Three', name: 'RT53 Div Three' });
        assert.deepStrictEqual([same.status, same.body.changed], [200, false]);
        const del = await aj53('DELETE', divUrl(id, 'RT53 Div Three'));
        assert.strictEqual(del.status, 200);
        assert.ok(!(await find53(A2)).divisions.some(v => v.name === 'RT53 Div Three'));
        const audit = await (await fetch(`${BASE_URL}/api/admin/audit-log?limit=50&include_test=1`)).json();
        assert.ok(['DIVISION_CREATE', 'DIVISION_RENAME', 'DIVISION_DELETE'].every(act => audit.some(e => e.action === act && String(e.target).includes(A2))));
      });

      await runTest('[NEGATIVE] Divisions: a duplicate (other letter case) or reserved name 400, deleting a referenced division 409 with counts, an unknown division 404', async () => {
        const id = await idOf(A2);
        assert.strictEqual((await aj53('POST', `/api/admin/directorates/${id}/divisions`, { name: 'rt53 div two' })).status, 400);
        assert.strictEqual((await aj53('POST', `/api/admin/directorates/${id}/divisions`, { name: 'General' })).status, 400);
        assert.strictEqual((await aj53('PUT', divUrl(id), { division: 'RT53 Div Uno', name: 'RT53 DIV TWO' })).status, 400);
        const ref = await aj53('DELETE', divUrl(id, 'RT53 Div Uno'));
        assert.strictEqual(ref.status, 409);
        assert.deepStrictEqual([ref.body.references.survey_responses, ref.body.references.user_scopes], [2, 1]);
        assert.strictEqual((await aj53('DELETE', divUrl(id, 'RT53 No Such'))).status, 404);
        assert.strictEqual((await aj53('PUT', divUrl(id), { division: 'RT53 No Such', name: 'X' })).status, 404);
        // fix #1: "." / ".." are refused as names and, sent in the body / query string, can never reach the directorate itself
        for (const dots of ['.', '..', ' ... ']) {
          assert.strictEqual((await aj53('POST', divUrl(id), { name: dots })).status, 400, `add "${dots}"`);
          assert.strictEqual((await aj53('PUT', divUrl(id), { division: 'RT53 Div Two', name: dots })).status, 400, `rename to "${dots}"`);
        }
        assert.strictEqual((await aj53('DELETE', divUrl(id, '..'))).status, 404);
        assert.strictEqual((await aj53('PUT', divUrl(id), { division: '..', name: 'X' })).status, 404);
        assert.strictEqual((await aj53('PUT', divUrl(id), { name: 'X' })).status, 400, 'division missing');
        assert.strictEqual((await aj53('DELETE', divUrl(id))).status, 400, 'division missing');
        const still = await find53(A2);
        assert.ok(still && still.divisions.some(v => v.name === 'RT53 Div Two'), 'the directorate and its divisions are untouched');
        assert.strictEqual((await aj53('POST', '/api/admin/directorates/99999999/divisions', { name: 'X' })).status, 404);
      });

      if (isSql53) {
        await runTest('[POSITIVE] (SQL Server) The Exit Interview import maps a former directorate AND a former division name to the current ones', async () => {
          const r = await postExit53([exitRow53('RT53-001', A0, 'RT53 Div One'), exitRow53('RT53-002', A1.toUpperCase(), '')]);
          assert.strictEqual(r.status, 200, JSON.stringify(r.body).slice(0, 300));
          const rows = await q53("SELECT nik, directorate, division FROM dbo.px_exit_interviews WHERE nik LIKE 'RT53-%' ORDER BY nik");
          assert.deepStrictEqual(rows.map(x => [x.nik, x.directorate, x.division]), [['RT53-001', A2, 'RT53 Div Uno'], ['RT53-002', A2, null]]);
          assert.strictEqual((await find53(A2)).usage.exit_interviews, 2);
        });
      }

      await runTest('[NEGATIVE/POSITIVE] (fix #6) Creating or renaming to a name that unlinked data rows already carry needs confirm_adopt: 409 requires_confirmation with the counts and nothing changed; confirmed -> the rows belong to it', async () => {
        await checkIn53('o', N('Orphan'), 'RT53 Free Div');
        const r = await aj53('POST', '/api/admin/directorates', { name: N('Orphan') });
        assert.strictEqual(r.status, 409);
        assert.deepStrictEqual([r.body.requires_confirmation, r.body.orphan_references.attendances], [true, 1]);
        assert.ok(!(await find53(N('Orphan'))), 'not created');
        const ok = await aj53('POST', '/api/admin/directorates', { name: N('Orphan'), confirm_adopt: true });
        assert.strictEqual(ok.status, 201);
        assert.deepStrictEqual([ok.body.adopted_orphans.attendances, ok.body.directorate.usage.attendances], [1, 1]);
        await checkIn53('p', N('Orphan two'), '');
        const ren = await aj53('PUT', `/api/admin/directorates/${ok.body.directorate.directorate_id}`, { name: N('Orphan two') });
        assert.deepStrictEqual([ren.status, ren.body.requires_confirmation, ren.body.orphan_references.attendances], [409, true, 1]);
        assert.ok(await find53(N('Orphan')), 'not renamed');
        const ren2 = await aj53('PUT', `/api/admin/directorates/${ok.body.directorate.directorate_id}`, { name: N('Orphan two'), confirm_adopt: true });
        assert.strictEqual(ren2.status, 200);
        assert.strictEqual((await find53(N('Orphan two'))).usage.attendances, 2);
        const audit = await (await fetch(`${BASE_URL}/api/admin/audit-log?limit=50&include_test=1`)).json();
        assert.ok(audit.some(e => e.action === 'DIRECTORATE_CREATE' && String(e.target).includes('adopted')));
      });

      await runTest('[POSITIVE] (fix #2) Merge preview (read only): rows that move, pooled ESS periods, divisions moved / merged and every account whose scope changes - the all-divisions account is flagged as widened; bad requests 400 / 404', async () => {
        const src = await idOf(A2);
        const tgt = await idOf(B0);
        const p = await aj53('GET', `/api/admin/directorates/${src}/merge-preview?target_id=${tgt}`);
        assert.strictEqual(p.status, 200, JSON.stringify(p.body));
        assert.deepStrictEqual([p.body.from, p.body.to, p.body.rows.survey_responses, p.body.rows.attendances, p.body.ess_results_pooled], [A2, B0, 4, 2, 1]);
        assert.deepStrictEqual(p.body.divisions_moved, ['RT53 Div Two']);
        assert.deepStrictEqual(p.body.divisions_merged, [{ from: 'RT53 Div Uno', into: 'rt53 div uno' }]);
        const a1 = p.body.accounts.find(a => a.user_id === U1.id);
        const a2 = p.body.accounts.find(a => a.user_id === U2.id);
        assert.deepStrictEqual([a1.widened, a1.after], [true, [{ directorate: B0, divisions: null }]]);
        assert.deepStrictEqual([a2.widened, a2.after], [false, [{ directorate: B0, divisions: ['rt53 div uno'] }]]);
        assert.ok(await find53(A2), 'nothing changed');
        assert.strictEqual((await aj53('GET', `/api/admin/directorates/${src}/merge-preview`)).status, 400);
        assert.strictEqual((await aj53('GET', `/api/admin/directorates/${src}/merge-preview?target_id=${src}`)).status, 400);
        assert.strictEqual((await aj53('GET', `/api/admin/directorates/${src}/merge-preview?target_id=99999999`)).status, 404);
      });

      await runTest('[NEGATIVE] Merge: into itself 400, without target 400, unknown source or target 404; nothing changes', async () => {
        const id = await idOf(A2);
        assert.strictEqual((await aj53('POST', `/api/admin/directorates/${id}/merge`, { target_id: id })).status, 400);
        assert.strictEqual((await aj53('POST', `/api/admin/directorates/${id}/merge`, {})).status, 400);
        assert.strictEqual((await aj53('POST', `/api/admin/directorates/${id}/merge`, { target_id: 99999999 })).status, 404);
        assert.strictEqual((await aj53('POST', `/api/admin/directorates/99999999/merge`, { target_id: id })).status, 404);
        assert.strictEqual((await aj53('PUT', '/api/admin/directorates/abc', { name: N('X') })).status, 404);
        assert.strictEqual((await aj53('DELETE', '/api/admin/directorates/99999999')).status, 404);
        assert.ok(await find53(A2));
      });

      await runTest('[POSITIVE] Merge A into B: divisions move (same-named one merges into B\'s spelling), every row moves, ESS rows of the same period are pooled (participation-weighted), an all-divisions scope of A becomes all of B (fix #2, audited as USER_SCOPE_CHANGE), a division scope keeps its division; A and its former names become former names of B; a file with the oldest name lands on B', async () => {
        const src = await find53(A2);
        const r = await aj53('POST', `/api/admin/directorates/${src.directorate_id}/merge`, { target_id: await idOf(B0) });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        assert.deepStrictEqual([r.body.from, r.body.to, r.body.divisions_moved, r.body.divisions_merged], [A2, B0, 1, 1]);
        assert.deepStrictEqual([r.body.counts.ess_results, r.body.counts.ess_results_pooled], [3, 1]);
        assert.ok(!(await find53(A2)));
        const b = await find53(B0);
        assert.deepStrictEqual(b.divisions.map(v => v.name).sort(), ['rt53 div uno', 'RT53 Div Four', 'RT53 Div Two'].sort());
        assert.deepStrictEqual(b.former_division_names, [{ alias_name: 'RT53 Div One', division_name: 'rt53 div uno' }], 'a former division name follows the merge');
        assert.deepStrictEqual(b.former_names.sort(), [A0, A1, A2].sort());
        assert.deepStrictEqual([b.usage.survey_responses, b.usage.attendances, b.usage.user_scopes > 0, b.usage.settings], [4, 2, true, 1]);
        assert.strictEqual(b.divisions.find(v => v.name === 'rt53 div uno').usage.survey_responses, 2, 'rows of the merged division take B\'s spelling');
        const pooled = (await essDirs53(ESS53, '2024-01'));
        assert.deepStrictEqual(pooled.map(x => [x.directorate, x.participation, x.index_score, x.questions[0].score]), [[B0, 400, 65, 55]]);
        assert.strictEqual(await scopeStatus(U1, B0), 200);
        assert.strictEqual(await scopeStatus(U1, B0, 'rt53 div uno'), 200);
        assert.strictEqual(await scopeStatus(U1, B0, 'RT53 Div Two'), 200);
        assert.strictEqual(await scopeStatus(U1, B0, 'RT53 Div Four'), 200, 'all divisions of A -> all divisions of B');
        assert.deepStrictEqual(await scopesOf53(U1.id), [{ directorate: B0, divisions: null }]);
        assert.deepStrictEqual(await scopesOf53(U2.id), [{ directorate: B0, divisions: ['rt53 div uno'] }]);
        assert.strictEqual(await scopeStatus(U2, B0, 'rt53 div uno'), 200);
        assert.strictEqual(await scopeStatus(U2, B0, 'RT53 Div Four'), 403, 'a division scope stays that division');
        assert.deepStrictEqual(r.body.scope_changes.map(c => [c.user_id, c.widened]).sort(), [[U1.id, true], [U2.id, false]].sort());
        const audit53 = await (await fetch(`${BASE_URL}/api/admin/audit-log?limit=80&include_test=1`)).json();
        for (const u of [U1, U2]) assert.ok(audit53.some(e => e.action === 'USER_SCOPE_CHANGE' && String(e.target).startsWith(`${u.username}:`) && String(e.target).includes(`(merge "${A2}")`)), `scope change of ${u.username} audited`);
        assert.deepStrictEqual((await attendance53()).filter(x => [A0, A1, A2, B0].includes(x.directorate)).map(x => x.directorate), [B0, B0]);
        const e = await postEss53(ESS53, await essFile53(2024, 'April', [[A0, 10, 0.5, 0.5]]));
        assert.strictEqual(e.status, 200);
        assert.deepStrictEqual((await essDirs53(ESS53, '2024-04')).map(x => x.directorate), [B0]);
        if (isSql53) {
          const rows = await q53("SELECT directorate, division FROM dbo.px_exit_interviews WHERE nik LIKE 'RT53-%' ORDER BY nik");
          assert.deepStrictEqual(rows.map(x => [x.directorate, x.division]), [[B0, 'rt53 div uno'], [B0, null]]);
          // the exit row WITHOUT a division stays readable for the all-divisions account (fix #2)
          const ex = await call53('GET', `/api/exit-interview/summary?mode=MTD&year=2098&month=05&directorate=${encodeURIComponent(B0)}`, undefined, U1.cookie);
          assert.strictEqual(ex.status, 200);
          assert.strictEqual((await ex.json()).counts.total_records, 2);
          assert.strictEqual((await q53('SELECT directorate FROM dbo.px_users WHERE user_id = @id', { id: U1.id }))[0].directorate, B0);
          assert.strictEqual((await q53("SELECT COUNT(*) AS n FROM dbo.px_survey_uploaded_responses WHERE org_unit_1 = @d AND org_unit_2 COLLATE Latin1_General_100_BIN2 = N'rt53 div uno'", { d: B0 }))[0].n, 2, 'exact spelling');
        }
        const audit = await (await fetch(`${BASE_URL}/api/admin/audit-log?limit=50&include_test=1`)).json();
        assert.ok(audit.some(e2 => e2.action === 'DIRECTORATE_MERGE' && String(e2.target).includes(`"${A2}" -> "${B0}"`)));
      });

      await runTest('[POSITIVE] (fix #2) Merging a directorate WITHOUT divisions (like Sharia Banking / Special Asset): its all-divisions account gets all of the target - never an empty scope, never "General"; its rows without a division move along', async () => {
        const z = await createDir53(N('Zero'));
        await checkIn53('z', N('Zero'), '');
        const u3 = await makeUser53('c', [{ directorate: N('Zero'), divisions: null }]);
        const p = await aj53('GET', `/api/admin/directorates/${z.directorate_id}/merge-preview?target_id=${await idOf(B0)}`);
        assert.deepStrictEqual(p.body.accounts.map(a => [a.user_id, a.widened, a.after]), [[u3.id, true, [{ directorate: B0, divisions: null }]]]);
        const r = await aj53('POST', `/api/admin/directorates/${z.directorate_id}/merge`, { target_id: await idOf(B0) });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        assert.deepStrictEqual(await scopesOf53(u3.id), [{ directorate: B0, divisions: null }]);
        assert.strictEqual(await scopeStatus(u3, B0), 200);
        assert.ok((await attendance53()).filter(a => a.directorate === B0 && a.division === 'General').length >= 1, 'the attendance without a division moved');
      });

      await runTest('[POSITIVE] (fix #9) PX Index by directorate: a directorate without data of its own (only the bankwide metrics #1-#5 and the directorate-independent OUTCOME snapshot) comes back with has_own_data false and null scores and is listed after every ranked one; a directorate with own data keeps its score; calculate?directorate= is unchanged', async () => {
        const e = await createDir53(N('Empty PX'));
        const year = String(new Date().getFullYear());
        const r = await aj53('GET', `/api/metrics/by-directorate?mode=YTD&year=${year}`);
        assert.strictEqual(r.status, 200);
        const list = r.body.directorates;
        const empty = list.find(x => x.directorate === e.name);
        assert.deepStrictEqual([empty.has_own_data, empty.px_index, empty.survey_index, empty.outcome_index, empty.px_index_basis], [false, null, null, null, 'NONE']);
        const own = list.find(x => x.directorate === B0);
        assert.deepStrictEqual([own.has_own_data, typeof own.px_index], [true, 'number']);
        assert.ok(list.indexOf(empty) > list.filter(x => x.px_index !== null).length - 1, 'listed after every directorate with a score');
        const calc = await aj53('GET', `/api/metrics/calculate?mode=YTD&year=${year}&directorate=${encodeURIComponent(e.name)}`);
        assert.strictEqual(typeof calc.body.px_index, 'number', 'calculate itself still counts the bankwide metrics');
        assert.strictEqual((await aj53('DELETE', `/api/admin/directorates/${e.directorate_id}`)).status, 200);
      });

      await runTest('[POSITIVE] A former name can be given to a new directorate: the alias moves to it (released_alias_of) and imports with that name land there; deleting the empty directorate removes it again', async () => {
        const r = await aj53('POST', '/api/admin/directorates', { name: A1 });
        assert.strictEqual(r.status, 201);
        assert.strictEqual(r.body.released_alias_of, B0);
        const fn = (await find53(B0)).former_names;
        assert.ok(fn.includes(A0) && fn.includes(A2) && !fn.includes(A1), fn.join(' | '));
        const del = await aj53('DELETE', `/api/admin/directorates/${r.body.directorate.directorate_id}`);
        assert.deepStrictEqual([del.status, del.body.deleted], [200, A1]);
        assert.ok(!(await (await fetch(`${BASE_URL}/api/directorates`)).json()).some(d => d.name === A1));
        const audit = await (await fetch(`${BASE_URL}/api/admin/audit-log?limit=50&include_test=1`)).json();
        assert.ok(audit.some(e => e.action === 'DIRECTORATE_DELETE' && String(e.target).includes(A1)));
      });

      await runTest('[NEGATIVE] A User gets 403 on every directory route (list, add, rename, delete, merge, divisions) and nothing changes; the directory_admin_managed setting cannot be edited (400)', async () => {
        const id = await idOf(B0);
        const tries = [['GET', '/api/admin/directorates'], ['POST', '/api/admin/directorates', { name: N('ByUser') }], ['PUT', `/api/admin/directorates/${id}`, { name: N('ByUser') }],
          ['DELETE', `/api/admin/directorates/${id}`], ['POST', `/api/admin/directorates/${id}/merge`, { target_id: id }], ['POST', `/api/admin/directorates/${id}/divisions`, { name: 'X' }],
          ['PUT', divUrl(id), { division: 'RT53 Div Four', name: 'X' }], ['DELETE', divUrl(id, 'RT53 Div Four')], ['GET', `/api/admin/directorates/${id}/merge-preview?target_id=${id}`]];
        for (const [m, p, b] of tries) assert.strictEqual((await call53(m, p, b, U1.cookie)).status, 403, `${m} ${p}`);
        assert.ok(await find53(B0) && !(await find53(N('ByUser'))));
        assert.ok((await find53(B0)).divisions.some(v => v.name === 'RT53 Div Four'));
        const put = await aj53('PUT', '/api/admin/settings/directory_admin_managed', { value: false });
        assert.strictEqual(put.status, 400);
        assert.strictEqual((await (await fetch(`${BASE_URL}/api/settings`)).json()).directory_admin_managed, true);
      });

      await runTest('[POSITIVE] Name resolver (pure): current name, former name (any case / spacing), division former name, seed renames both ways (Sharia Banking <-> Syariah Banking) and through an Admin alias; v2.31.0 demo targets map to the CURRENT name and never resurrect a renamed one', async () => {
        const res = dn53.buildResolver([{ directorate_name: 'Dir X', divisions: ['Div 1'] }, { directorate_name: 'Sharia Banking', divisions: [] }],
          { directorates: [{ alias_name: 'Old X', directorate_name: 'Dir X' }], divisions: [{ directorate_name: 'Dir X', alias_name: 'Old 1', division_name: 'Div 1' }] });
        assert.strictEqual(res.directorate(' old   X '), 'Dir X');
        assert.strictEqual(res.division('OLD X', 'old 1'), 'Div 1');
        assert.strictEqual(res.directorate('Syariah Banking'), 'Sharia Banking', 'a database that has not renamed yet');
        assert.strictEqual(res.directorate('Nope'), null);
        const fresh = dn53.buildResolver([{ directorate_name: 'Syariah Banking', divisions: [] }, { directorate_name: 'Strategy & Finance', divisions: [] }], {});
        assert.strictEqual(fresh.directorate('Sharia Banking'), 'Syariah Banking', 'the real ESS 2025 file on a fresh install');
        assert.strictEqual(fresh.directorate('Strategy, Finance & SPAPM'), 'Strategy & Finance');
        const renamed = dn53.buildResolver([{ directorate_name: 'Islamic Banking', divisions: [] }], { directorates: [{ alias_name: 'Syariah Banking', directorate_name: 'Islamic Banking' }] });
        assert.strictEqual(renamed.directorate('Sharia Banking'), 'Islamic Banking', 'seed rename + Admin alias chain');
        const opts = r2 => ({ isCurrent: r2.isCurrent, mapTarget: n => r2.directorate(n) });
        assert.strictEqual(dm53.renamedDirectorate('Finance & Operations', 'Financial Planning & Analysis', opts(fresh)), 'Strategy & Finance');
        const old = dn53.buildResolver([{ directorate_name: 'Strategy, Finance & SPAPM', divisions: [] }], {});
        assert.strictEqual(dm53.renamedDirectorate('Finance & Operations', 'X', opts(old)), 'Strategy, Finance & SPAPM');
        const live = dn53.buildResolver([{ directorate_name: 'Consumer Banking', divisions: [] }, { directorate_name: 'Consumer & EBB', divisions: [] }], {});
        assert.strictEqual(dm53.renamedDirectorate('Consumer Banking', null, opts(live)), null, 'a directorate the Admin created with an old demo name is left alone');
        const plan = dm53.planDirectory([{ directorate_name: 'Finance & Operations', divisions: ['Financial Planning & Analysis', 'Treasury Operations'] }], seed53.initialDirectorates, { mapTarget: dn53.currentSeedName });
        const names = plan.directorates.map(d => d.directorate_name);
        assert.ok(!names.includes('Strategy, Finance & SPAPM') && !names.includes('Treasury & Capital Market'), names.join(' | '));
        assert.strictEqual(names.length, seed53.initialDirectorates.length);
        assert.ok(plan.directorates.find(d => d.directorate_name === 'Treasury & Financial Institutions').divisions.includes('Treasury Operations'));
        assert.deepStrictEqual(seed53.initialDirectorates.filter(d => ['Syariah Banking', 'SLC ASG Satyaguna Langgeng Capital', 'Strategy & Finance', 'Treasury & Financial Institutions'].includes(d.directorate_name)).length, 4, 'the seed uses the new names');
        const pooled = dn53.mapEssSeedRows([{ upload_id: 'u', metric_id: 9, survey_year: 2025, survey_month: 11, org_level: 'DIRECTORATE', directorate: 'Special Asset', participation: 100, index_score: 80, questions: [{ score: 70 }] },
          { upload_id: 'u', metric_id: 9, survey_year: 2025, survey_month: 11, org_level: 'DIRECTORATE', directorate: 'Risk Management', participation: 300, index_score: 60, questions: [{ score: 50 }] },
          { upload_id: 'u', metric_id: 9, survey_year: 2025, survey_month: 11, org_level: 'DIRECTORATE', directorate: 'Gone', participation: 1, index_score: 1, questions: [] }],
        dn53.buildResolver([{ directorate_name: 'Risk Management', divisions: [] }], { directorates: [{ alias_name: 'SLC', directorate_name: 'Risk Management' }] }));
        assert.deepStrictEqual(pooled.map(x => [x.directorate, x.participation, x.index_score, x.questions[0].score]), [['Risk Management', 400, 65, 55]]);
      });

      if (isSql53) {
        await runTest('[POSITIVE] (SQL Server) Boot protection: once the Admin manages the directory the seed top-up adds nothing (not a deleted / renamed name, not a division); before that a seed name is looked up through former names; the v2.31.0 boot rename changes 0 rows', async () => {
          const b = await find53(B0);
          assert.strictEqual(await st53.isDirectoryManaged(), true);
          assert.strictEqual(await st53.topUpDirectory([{ directorate_name: A1, divisions: ['RT53 Div Three'] }, { directorate_name: A0, divisions: ['RT53 Div One', 'RT53 Div Five'] }]), 0);
          assert.ok(!(await find53(A1)) && !(await find53(A0)));
          // unmanaged (pre-v2.51.0 behaviour): a seed entry under a FORMER name is the current directorate - no second directorate
          await st53.setSetting('directory_admin_managed', false);
          try {
            assert.strictEqual(await st53.topUpDirectory([{ directorate_name: A0, divisions: ['RT53 Div One', 'rt53 div two'] }]), 0, 'former names (directorate + division) resolve');
          } finally {
            await st53.setSetting('directory_admin_managed', true);
          }
          const counts = await st53.migrateDirectorates();
          assert.strictEqual(Object.values(counts).reduce((x, y) => x + y, 0), 0, JSON.stringify(counts));
          assert.deepStrictEqual((await find53(B0)).divisions, b.divisions);
          const after = await (await fetch(`${BASE_URL}/api/directorates`)).json();
          assert.ok(!after.some(d => /^RT53 (Alpha|Beta|Gamma) /.test(d.name)));
        });
      }
    } finally {
      for (const id of metrics53) await adminJson('DELETE', `/api/admin/metrics/${id}`);   // their survey + ESS rows go with them
      for (const id of essUploads53) {
        const f = require('path').join(require('../server/services/essSummaryService').ESS_UPLOAD_DIR, `${id}.xlsx`);
        if (require('fs').existsSync(f)) require('fs').unlinkSync(f);
      }
      for (const nip of nips53) await adminJson('DELETE', `/api/events/${EV}/attendance/${nip}`);
      for (const id of users53) await adminJson('DELETE', `/api/admin/users/${id}`);
      await adminJson('PUT', '/api/admin/settings/event_manager_directorates', { value: managers0 });
      if (pool53) {
        try {
          await q53("DELETE FROM dbo.px_exit_interviews WHERE nik LIKE 'RT53-%'");
          for (const id of exitUploads53) {
            await q53('DELETE FROM dbo.px_exit_interviews WHERE upload_id = @u; DELETE FROM dbo.px_exit_interview_uploads WHERE upload_id = @u', { u: id });
            const f = require('path').join(exitSvc53.EXIT_UPLOAD_DIR, `${id}.xlsx`);
            if (require('fs').existsSync(f)) require('fs').unlinkSync(f);
          }
          await q53("DELETE FROM dbo.px_recruitment_sla_by_unit WHERE unit LIKE 'RT53 %' + @s", { s: stamp53 });
        } catch (err) {
          console.error('     Module 53 SQL cleanup:', err.message);
        }
      }
      // the temporary directorates (now unreferenced) and with them their former names
      for (const d of (await list53()).filter(x => x.name.startsWith('RT53 ') && x.name.includes(stamp53))) {
        const r = await aj53('DELETE', `/api/admin/directorates/${d.directorate_id}`);
        if (r.status !== 200) console.error(`     Module 53 cleanup: could not delete "${d.name}" (${r.status}: ${JSON.stringify(r.body.references || r.body.error)})`);
      }
      if (pool53) {
        try {
          await q53("DELETE FROM dbo.px_directorate_aliases WHERE alias_name LIKE 'RT53 %' + @s OR directorate_name LIKE 'RT53 %' + @s; DELETE FROM dbo.px_division_aliases WHERE directorate_name LIKE 'RT53 %' + @s", { s: stamp53 });
          if (flag0 !== true) await st53.setSetting('directory_admin_managed', flag0 === undefined ? false : flag0);   // the suite does not leave the flag behind
        } finally {
          await pool53.close();
        }
      }
    }
  }
  // --- MODULE 54 (v2.51.0): CONFIGURATION GUARD, PARAMETER AUDIT, ORPHAN SPELLING, MANUAL FORMER NAMES, ESS TEMPLATES ---
  // (2) a suite run never changes the live Admin configuration (snapshot / restore through the storage layer, a killed run
  // is restored by the next one); (3) Admin parameter changes are audited; (4) adopted orphan rows take the master spelling;
  // (5) former / alternative names can be added and removed by hand and imports resolve them; (6) the default question
  // sets of the 11 ESS metrics = the columns of the ESS result templates.
  console.log('\n📦 MODULE 54: Configuration guard, parameter audit trail, orphan spelling on adopt, manual former names, ESS question templates (Positive & Negative Testing)');
  if (!skipModuleBlock(54)) {
    const st54 = require('../server/db/storage');
    const isSql54 = st54.backend === 'sql';
    const stamp54 = Date.now().toString(36);
    const N54 = x => `RT54 ${x} ${stamp54}`;
    const EV54 = 'ev-perspektif-2024-q1';
    const aj54 = async (method, p, body) => { const r = await adminJson(method, p, body); return { status: r.status, body: await r.json().catch(() => ({})) }; };
    const call54 = (method, p, body, cookie) => nativeFetch(`${BASE_URL}${p}`, jsonBody(method, body, cookie));
    const list54 = async () => (await aj54('GET', '/api/admin/directorates')).body.directorates;
    const find54 = async name => (await list54()).find(d => d.name === name);
    const audit54 = async action => (await (await fetch(`${BASE_URL}/api/admin/audit-log?limit=300&include_test=1`)).json()).filter(e => !action || e.action === action);
    const me54 = (await (await adminJson('GET', '/api/auth/me')).json()).user.username;
    const metrics54 = [];
    const journeys54 = [];
    const users54 = [];
    const nips54 = [];
    const essUploads54 = [];
    const flag54 = (await (await fetch(`${BASE_URL}/api/settings`)).json()).directory_admin_managed;
    const mkMetric54 = async (name, extra) => {
      const res = await adminJson('POST', '/api/admin/metrics', { metric_name: name, metric_type: 'SURVEY', journey_id: 2, checkpoint_id: 5, target_value: 85, min_threshold: 80, ...extra });
      assert.strictEqual(res.status, 201);
      const id = (await res.json()).metric.metric_id;
      metrics54.push(id);
      return id;
    };
    const checkIn54 = async (tag, directorate, division) => {
      const nip = `RT54${tag}${stamp54}`.slice(0, 15);
      const r = await aj54('POST', `/api/events/${EV54}/attendance`, { nip, employee_name: `Regression 54 ${tag}`, cimb_email: `${nip.toLowerCase()}@example.test`, directorate, division });
      assert.strictEqual(r.status, 201, JSON.stringify(r.body));
      nips54.push(nip);
      return r.body.attendance;
    };
    const attendance54 = async nip => (await aj54('GET', `/api/events/${EV54}`)).body.attendances.find(a => a.nip === nip);
    const nipOf = tag => `RT54${tag}${stamp54}`.slice(0, 15);
    // a USER whose scope names a directorate that is not (yet) in the master - only possible in the database itself
    const scopedUser54 = async (suffix, scopes) => {
      const auth54 = require('../server/services/authService');
      const username = `rt54${suffix}${stamp54}`;
      const password = require('crypto').randomBytes(9).toString('hex') + 'Gg7';
      const u = await st54.createUser({ is_test_account: true, username, full_name: `Regression 54 ${suffix}`, email: '', role: 'USER', password_hash: await auth54.hashPassword(password), must_change_password: false, scopes });
      users54.push(u.user_id);
      const { cookie } = await loginAs(username, password);
      return { id: u.user_id, cookie };
    };
    const calcStatus54 = async (cookie, dir, div) => (await call54('GET', `/api/metrics/calculate?mode=YTD&directorate=${encodeURIComponent(dir)}${div ? `&sub_directorate=${encodeURIComponent(div)}` : ''}`, undefined, cookie)).status;

    try {
      // ---------------------------------------------------------------- (2) configuration guard
      if (!isSql54 || !configGuard) {
        console.log('  ⏭️  SKIP: Module 54 configuration-guard tests need the SQL backend with the guard active (JSON: the server keeps the store in memory)');
      } else {
        const fs54 = require('fs');
        const metricRow = (snap, id, col) => {
          const t = snap.tables.px_metrics;
          const row = t.rows.find(r => r[t.columns.indexOf('metric_id')] === id);
          return row ? row[t.columns.indexOf(col)] : undefined;
        };
        await runTest('[POSITIVE] (2) The guard saved the configuration before the first module (gitignored file) and the Module 16 reset was undone: every metric name, weight and PIC e-mail and the px_index_weights are the values from BEFORE the run', async () => {
          assert.ok(fs54.existsSync(CONFIG_SNAPSHOT_FILE), 'snapshot file exists while the run is going');
          assert.ok(/server[\\/]data[\\/]backups[\\/]/.test(CONFIG_SNAPSHOT_FILE), 'kept in server/data/backups (gitignored)');
          const onDisk = JSON.parse(fs54.readFileSync(CONFIG_SNAPSHOT_FILE, 'utf8'));
          assert.strictEqual(onDisk.taken_at, configGuard.snapshot.taken_at);
          const snap = configGuard.snapshot;
          const metrics = await st54.getMetrics();
          const ids = snap.tables.px_metrics.rows.map(r => r[snap.tables.px_metrics.columns.indexOf('metric_id')]);
          for (const id of ids) {
            const m = metrics.find(x => x.metric_id === id);
            assert.ok(m, `metric #${id} still there`);
            assert.strictEqual(m.metric_name, metricRow(snap, id, 'metric_name'), `metric #${id} name`);
            assert.strictEqual(m.weight, metricRow(snap, id, 'weight'), `metric #${id} weight`);
            assert.strictEqual(m.pic_email, metricRow(snap, id, 'pic_email'), `metric #${id} pic_email`);
          }
          const t = snap.tables.px_app_settings;
          const w = t.rows.find(r => r[t.columns.indexOf('setting_key')] === 'px_index_weights');
          assert.deepStrictEqual((await st54.getSettings()).px_index_weights, JSON.parse(w[t.columns.indexOf('setting_value')]));
        });

        await runTest('[POSITIVE] (2) restoreConfiguration puts back exactly what was saved (metric name, target, PIC e-mail, a metric-9 question text, px_index_weights, a reset question set) and deletes a metric created afterwards WITH its survey rows; a second restore changes nothing', async () => {
          const snap = await st54.snapshotConfiguration();
          const m8 = await st54.getMetricById(8);
          const q9 = await st54.getSurveyQuestions(9);
          const w0 = (await st54.getSettings()).px_index_weights;
          await st54.updateMetric(8, { metric_name: `${m8.metric_name} RT54`, target_value: 4.37, pic_email: `rt54${stamp54}@example.test` });
          await st54.saveSurveyQuestions(9, q9.map((q, i) => (i === 0 ? { ...q, text: `${q.text} RT54` } : q)));
          await st54.setSetting('px_index_weights', { survey: 55, outcome: 45 });
          await st54.resetSurveyQuestions(13);
          const temp = await st54.addMetric({ metric_name: N54('Temp metric'), metric_type: 'SURVEY', journey_id: 1, checkpoint_id: 1 });
          const csv = ['nip,employee_name,cimb_email,directorate,division,survey_date,q1_overall', `5${stamp54}9,Regression 54,r54@example.test,Human Resources,People Experience & Culture,2026-01-05,4`].join('\r\n');
          const up = await adminJson('POST', '/api/surveys/upload', { csvText: csv, fileName: 'rt54.csv', metric_id: temp.metric_id });
          assert.strictEqual(up.status, 200);
          assert.strictEqual((await st54.getResponsesByMetricAndPeriod(temp.metric_id, { mode: 'YTD', year: '2026' })).length, 1, 'guard: the temp metric has a survey row');
          const r = await st54.restoreConfiguration(JSON.parse(JSON.stringify(snap)));
          assert.deepStrictEqual(r.removed_metrics.map(m => m.metric_id), [temp.metric_id]);
          assert.ok(['px_metrics', 'px_metric_targets', 'px_survey_questions', 'px_app_settings'].every(x => r.restored_tables.includes(x)), JSON.stringify(r.restored_tables));
          const back = await st54.getMetricById(8);
          assert.deepStrictEqual([back.metric_name, back.target_value, back.pic_email], [m8.metric_name, m8.target_value, m8.pic_email]);
          assert.deepStrictEqual(await st54.getSurveyQuestions(9), q9);
          assert.deepStrictEqual((await st54.getSettings()).px_index_weights, w0);
          assert.strictEqual(await st54.getMetricById(temp.metric_id), undefined, 'the metric made after the snapshot is gone');
          assert.strictEqual((await st54.getResponsesByMetricAndPeriod(temp.metric_id, { mode: 'YTD', year: '2026' })).length, 0, 'with its survey rows');
          assert.deepStrictEqual((await st54.restoreConfiguration(snap)).restored_tables, [], 'nothing left to restore');
        });

        await runTest('[NEGATIVE/POSITIVE] (2) A snapshot file left by a killed run is NEVER used silently: without a choice the run stops (age + which tables / metrics differ) and nothing changes; TEST_DISCARD keeps the live configuration and renames the file; TEST_RESTORE restores it and deletes the file; both at once / a foreign snapshot refused', async () => {
          const file = CONFIG_SNAPSHOT_FILE.replace(/\.json$/, `.rt54-${stamp54}.json`);
          const snap = await st54.snapshotConfiguration();
          const m8 = await st54.getMetricById(8);
          const discarded = [];
          try {
            await st54.updateMetric(8, { metric_name: `${m8.metric_name} RT54 later edit` });   // an Admin edit made after the killed run
            fs54.writeFileSync(file, JSON.stringify(snap), 'utf8');
            await assert.rejects(() => handleStaleConfigSnapshot(st54, file, {}), err => err.staleSnapshot && err.message.includes('px_metrics')
              && err.message.includes('TEST_RESTORE_STALE_SNAPSHOT=1') && err.message.includes('TEST_DISCARD_STALE_SNAPSHOT=1') && /ago\)/.test(err.message));
            assert.ok(fs54.existsSync(file), 'the file is left alone');
            assert.strictEqual((await st54.getMetricById(8)).metric_name, `${m8.metric_name} RT54 later edit`, 'the live edit is kept');
            await assert.rejects(() => handleStaleConfigSnapshot(st54, file, { restore: true, discard: true }), err => err.staleSnapshot);
            assert.ok(fs54.existsSync(file));
            const d = await handleStaleConfigSnapshot(st54, file, { discard: true });
            discarded.push(d.file);
            assert.strictEqual(d.action, 'discarded');
            assert.ok(!fs54.existsSync(file) && fs54.existsSync(d.file) && /\.discarded-[0-9TZ-]+\.json$/.test(d.file));
            assert.strictEqual((await st54.getMetricById(8)).metric_name, `${m8.metric_name} RT54 later edit`, 'discard changes nothing live');
            fs54.writeFileSync(file, JSON.stringify(snap), 'utf8');
            const r = await handleStaleConfigSnapshot(st54, file, { restore: true });
            assert.ok(r.action === 'restored' && r.result.restored_tables.includes('px_metrics'));
            assert.strictEqual((await st54.getMetricById(8)).metric_name, m8.metric_name);
            assert.ok(!fs54.existsSync(file), 'the file is deleted after the restore');
            assert.strictEqual(await handleStaleConfigSnapshot(st54, file, {}), null, 'no file -> nothing to do');
            fs54.writeFileSync(file, JSON.stringify({ ...snap, database: 'SomeOtherDb' }), 'utf8');
            await assert.rejects(() => handleStaleConfigSnapshot(st54, file, { restore: true }), err => err.staleSnapshot && /discard it instead/.test(err.message));
            assert.ok(fs54.existsSync(file));
          } finally {
            for (const f of [file, ...discarded]) if (fs54.existsSync(f)) fs54.unlinkSync(f);
            if ((await st54.getMetricById(8)).metric_name !== m8.metric_name) await st54.updateMetric(8, { metric_name: m8.metric_name });
          }
          for (const bad of [{ ...snap, database: 'SomeOtherDb' }, { ...snap, backend: 'json' }, { ...snap, kind: 'x' }, { ...snap, tables: { px_metrics: snap.tables.px_metrics } }, null]) {
            await assert.rejects(() => st54.restoreConfiguration(bad));
          }
          assert.strictEqual((await st54.getMetricById(8)).metric_name, m8.metric_name);
        });

        await runTest('[NEGATIVE] (2) The suite itself refuses to start over a leftover snapshot (here: this run\'s own, still active file): exit code 2, the message names the choices, no login account is created and the file is untouched', async () => {
          const before = fs54.readFileSync(CONFIG_SNAPSHOT_FILE);
          const users0 = (await st54.listUsers()).length;
          const env = { ...process.env };
          delete env.TEST_RESTORE_STALE_SNAPSHOT;
          delete env.TEST_DISCARD_STALE_SNAPSHOT;
          const out = require('child_process').spawnSync(process.execPath, [__filename], { env, encoding: 'utf8', timeout: 120000 });
          assert.strictEqual(out.status, 2, `exit code (${(out.stdout + out.stderr).slice(-400)})`);
          assert.ok(/TEST_RESTORE_STALE_SNAPSHOT=1/.test(out.stderr) && /TEST_DISCARD_STALE_SNAPSHOT=1/.test(out.stderr) && /no test ran/.test(out.stderr), out.stderr.slice(0, 400));
          assert.ok(!/MODULE 1:/.test(out.stdout), 'no module ran');
          assert.ok(fs54.readFileSync(CONFIG_SNAPSHOT_FILE).equals(before), 'the snapshot file is untouched');
          assert.strictEqual((await st54.listUsers()).length, users0, 'no suite admin was created');
        });

        await runTest('[NEGATIVE/POSITIVE] (2) Restore is one transaction: a snapshot that fails half-way changes nothing (the metric created after it keeps its data); a good restore deletes that metric with its survey rows, ESS results and the original ESS file', async () => {
          const snap = await st54.snapshotConfiguration();
          const essId = await mkMetric54(N54('Restore order ESS'), { scale_type: 'PERCENTAGE', survey_source: 'ESS' });
          assert.strictEqual((await adminJson('POST', `/api/admin/survey-questions/${essId}`, { questions: [{ key: 'q1_rt54', label: 'RT54', text: 'RT54 question', type: 'PERCENTAGE', mandatory: true }] })).status, 200);
          const dir = (await list54())[0].name;
          const up = await postEssFile(essId, await essXlsx([ESS_HEAD('RT54 Index', ['RT54 question']), [dir, 'Directorate', 2024, 'June', 50, 0.7, 0.7]]), 'rt54_order.xlsx');
          const upBody = await up.json();
          assert.strictEqual(up.status, 200, JSON.stringify(upBody).slice(0, 200));
          essUploads54.push(upBody.upload_id);
          const essFile = require('../server/services/essSummaryService').essOriginalFilePath(upBody.upload_id);
          assert.ok(essFile, 'guard: the original ESS file was kept');
          const rows = async () => (await st54.getEssResults(essId)).length;   // straight from the database (the detail of a deleted metric is a 404)
          assert.ok(await rows() > 0);
          // a snapshot whose px_metrics rows cannot be inserted (NOT NULL metric_name): the transaction fails at the table step
          const broken = JSON.parse(JSON.stringify(snap));
          broken.tables.px_metrics.rows[0][broken.tables.px_metrics.columns.indexOf('metric_name')] = null;
          const cmp0 = await st54.compareConfiguration(snap);
          await assert.rejects(() => st54.restoreConfiguration(broken));
          assert.ok(await st54.getMetricById(essId), 'the metric is still there');
          assert.ok(await rows() > 0, 'its ESS results are still there');
          assert.ok(require('fs').existsSync(essFile), 'its original file is still there');
          assert.deepStrictEqual(await st54.compareConfiguration(snap), cmp0, 'nothing of the configuration changed');
          assert.deepStrictEqual(cmp0.extra_metrics.map(m => m.metric_id), [essId]);
          const r = await st54.restoreConfiguration(snap);
          assert.deepStrictEqual([r.removed_metrics.map(m => m.metric_id), r.removed_ess_files], [[essId], 1]);
          metrics54.splice(metrics54.indexOf(essId), 1);
          assert.strictEqual(await st54.getMetricById(essId), undefined);
          assert.strictEqual(await rows(), 0, 'ESS results gone');
          await new Promise(res => setTimeout(res, 300));   // the file is unlinked after the commit
          assert.ok(!require('fs').existsSync(essFile), 'the original ESS file is removed');
          assert.deepStrictEqual(await st54.compareConfiguration(snap), { differing_tables: [], extra_metrics: [], missing_metrics: [] });
        });
      }

      // ---------------------------------------------------------------- (3) audit trail of parameter changes
      await runTest('[POSITIVE] (3) Metric create / update (changed fields old -> new) / delete, journey create / update / delete, survey questions save / reset, targets save and the Module 16 parameter reset are in the audit trail, marked as test-run rows', async () => {
        const id = await mkMetric54(N54('Audit metric'), { scale_type: 'RATING_5', survey_source: 'SYSTEM', requires_manual_upload: false, pic_email: 'old54@example.test' });
        assert.strictEqual((await aj54('PUT', `/api/admin/metrics/${id}`, { metric_name: N54('Audit metric renamed'), target_value: 4.2, pic_email: 'new54@example.test' })).status, 200);
        assert.strictEqual((await aj54('POST', `/api/admin/survey-questions/${id}`, { questions: [{ key: 'q1_rt54', label: 'RT54', text: 'RT54 question', type: 'SCALE_1_5', mandatory: true }] })).status, 200);
        assert.strictEqual((await aj54('POST', `/api/admin/survey-questions/${id}/reset`)).status, 200);
        const targets = (await aj54('GET', '/api/admin/targets')).body.targets;
        assert.strictEqual((await aj54('POST', '/api/admin/targets', { targets: { [id]: { ...targets[id], target_value: 4.4 } } })).status, 200);
        const j = await aj54('POST', '/api/admin/journeys', { journey_code: `RT54_${stamp54}`, journey_name: N54('Journey') });
        assert.strictEqual(j.status, 201);
        journeys54.push(j.body.journey.journey_id);
        assert.strictEqual((await aj54('PUT', `/api/admin/journeys/${j.body.journey.journey_id}`, { journey_name: N54('Journey renamed') })).status, 200);
        assert.strictEqual((await aj54('DELETE', `/api/admin/journeys/${j.body.journey.journey_id}`)).status, 200);
        journeys54.pop();
        assert.strictEqual((await aj54('DELETE', `/api/admin/metrics/${id}`)).status, 200);
        metrics54.splice(metrics54.indexOf(id), 1);
        const rows = (await audit54()).filter(e => e.username === me54);
        const one = (action, test) => {
          const hit = rows.find(e => e.action === action && test(String(e.target)));
          assert.ok(hit, `${action} row (${rows.filter(e => e.action === action).map(e => e.target).slice(0, 3).join(' | ')})`);
          assert.strictEqual(hit.is_test, true, `${action} is a test-run row`);
          return hit;
        };
        one('METRIC_CREATE', t => t.startsWith(`#${id} "${N54('Audit metric')}"`));
        const upd = one('METRIC_UPDATE', t => t.startsWith(`#${id}:`) && t.includes('metric_name'));
        assert.ok(upd.target.includes(`metric_name ${N54('Audit metric')} -> ${N54('Audit metric renamed')}`), upd.target);
        assert.ok(upd.target.length <= 190, 'cut at the audit target limit');
        assert.ok(rows.some(e => e.action === 'METRIC_UPDATE' && e.target.startsWith(`#${id}:`) && e.target.includes('pic_email old54@example.test -> new54@example.test')) || upd.target.length === 190, 'PIC e-mail change listed (unless cut off)');
        one('SURVEY_QUESTIONS_UPDATE', t => t.startsWith(`#${id}:`) && t.includes('1 questions'));
        one('SURVEY_QUESTIONS_RESET', t => t.startsWith(`#${id} reset to the default template`));
        one('METRIC_TARGETS_UPDATE', t => t.includes(`#${id} target_value 4.2 -> 4.4`));
        one('JOURNEY_CREATE', t => t.includes(N54('Journey')));
        one('JOURNEY_UPDATE', t => t.includes(`journey_name ${N54('Journey')} -> ${N54('Journey renamed')}`));
        one('JOURNEY_DELETE', t => t.includes(N54('Journey renamed')));
        one('METRIC_DELETE', t => t.startsWith(`#${id} "${N54('Audit metric renamed')}"`));
        const visible = await (await fetch(`${BASE_URL}/api/admin/audit-log?limit=300`)).json();
        assert.ok(!visible.some(e => e.username === me54), 'test-run rows are hidden from the default Audit Trail');
      });

      await runTest('[NEGATIVE] (3) A refused parameter change writes no audit row: a User gets 403 on PUT metric / reset / survey questions, an unknown metric id 400 / 404 - and the metric is unchanged', async () => {
        const u = await scopedUser54('aud', [{ directorate: (await list54())[0].name, divisions: null }]);
        const before = await audit54();
        const m8 = await st54.getMetricById(8);
        assert.strictEqual((await call54('PUT', '/api/admin/metrics/8', { metric_name: 'Hacked' }, u.cookie)).status, 403);
        assert.strictEqual((await call54('POST', '/api/admin/parameters/reset', {}, u.cookie)).status, 403);
        assert.strictEqual((await call54('POST', '/api/admin/survey-questions/9/reset', {}, u.cookie)).status, 403);
        assert.strictEqual((await aj54('PUT', '/api/admin/metrics/999999', { metric_name: 'x' })).status, 400);
        assert.strictEqual((await aj54('POST', '/api/admin/survey-questions/999999/reset')).status, 404);
        assert.strictEqual((await st54.getMetricById(8)).metric_name, m8.metric_name);
        const after = await audit54();
        const fresh = after.filter(e => !before.some(b => b.audit_id === e.audit_id));
        assert.ok(!fresh.some(e => /^(METRIC_|PARAMETERS_|SURVEY_QUESTIONS_)/.test(e.action)), JSON.stringify(fresh.map(e => e.action)));
      });

      // ---------------------------------------------------------------- (4) adopting orphan rows takes the master spelling
      if (!isSql54) {
        console.log('  ⏭️  SKIP: Module 54 orphan-spelling tests need the SQL backend (the orphan login scope is written to the database directly)');
      } else {
        await runTest('[POSITIVE/NEGATIVE] (4) Creating "rt54 orphan x" over rows and a login scope spelled "RT54 ORPHAN X" (division "RT54 DIV A"): 409 without confirm_adopt; confirmed -> the attendance and the scope take the master spelling of the directorate AND the division, and the User reads it with the master name (no 403)', async () => {
          const upper = N54('ORPHAN X').toUpperCase();
          const master = upper.toLowerCase();
          await checkIn54('ox', upper, 'RT54 DIV A');
          const u = await scopedUser54('ox', [{ directorate: upper, divisions: ['RT54 DIV A'] }]);
          const r = await aj54('POST', '/api/admin/directorates', { name: master, divisions: ['rt54 div a'] });
          assert.deepStrictEqual([r.status, r.body.requires_confirmation], [409, true]);
          assert.deepStrictEqual([r.body.orphan_references.attendances, r.body.orphan_references.user_scopes], [1, 1]);
          const ok = await aj54('POST', '/api/admin/directorates', { name: master, divisions: ['rt54 div a'], confirm_adopt: true });
          assert.strictEqual(ok.status, 201, JSON.stringify(ok.body));
          const a = await attendance54(nipOf('ox'));
          assert.deepStrictEqual([a.directorate, a.division], [master, 'rt54 div a']);
          assert.deepStrictEqual(await (async () => (await st54.getUserById(u.id)).scopes)(), [{ directorate: master, divisions: ['rt54 div a'] }]);
          assert.strictEqual(await calcStatus54(u.cookie, master, 'rt54 div a'), 200, 'the master spelling is in scope');
          assert.strictEqual(await calcStatus54(u.cookie, upper, 'RT54 DIV A'), 403, 'the old spelling is gone from the scope');
          const d = await find54(master);
          assert.deepStrictEqual([d.usage.attendances, d.usage.user_scopes, d.divisions[0].usage.attendances], [1, 1, 1]);
        });

        await runTest('[POSITIVE] (4) Renaming a directorate to a name orphan rows carry in another letter case ("RT54 ORPHAN Y" -> "rt54 orphan y", confirmed) rewrites those rows to the master spelling too', async () => {
          const upper = N54('ORPHAN Y').toUpperCase();
          const master = upper.toLowerCase();
          const made = await aj54('POST', '/api/admin/directorates', { name: N54('Rename source') });
          assert.strictEqual(made.status, 201);
          await checkIn54('oy', upper, '');
          const u = await scopedUser54('oy', [{ directorate: upper, divisions: null }]);
          const ren = await aj54('PUT', `/api/admin/directorates/${made.body.directorate.directorate_id}`, { name: master, confirm_adopt: true });
          assert.strictEqual(ren.status, 200, JSON.stringify(ren.body));
          assert.strictEqual((await attendance54(nipOf('oy'))).directorate, master);
          assert.deepStrictEqual((await st54.getUserById(u.id)).scopes, [{ directorate: master, divisions: null }]);
          assert.strictEqual(await calcStatus54(u.cookie, master), 200);
        });
      }

      // ---------------------------------------------------------------- (5) manual former / alternative names
      const D54 = N54('Consumer');
      const ALIAS54 = N54('Consumer & Emerging Business Banking');
      let d54 = null;
      await runTest('[POSITIVE] (5) Add a former / alternative name to a directorate: 201, listed under former_names, audited DIRECTORATE_ALIAS_ADD, directory marked as Admin-managed; a check-in with that name lands on the directorate', async () => {
        const made = await aj54('POST', '/api/admin/directorates', { name: D54, divisions: ['RT54 Div One'] });
        assert.strictEqual(made.status, 201);
        d54 = made.body.directorate;
        const r = await aj54('POST', `/api/admin/directorates/${d54.directorate_id}/aliases`, { name: `  ${ALIAS54.replace(/ /g, '\u00a0')}  ` });
        assert.strictEqual(r.status, 201, JSON.stringify(r.body));
        assert.deepStrictEqual([r.body.directorate, r.body.alias, r.body.adopted_orphans], [D54, ALIAS54, null]);
        assert.ok((await find54(D54)).former_names.includes(ALIAS54));
        assert.strictEqual((await (await fetch(`${BASE_URL}/api/settings`)).json()).directory_admin_managed, true);
        const a = await checkIn54('al', ALIAS54, 'RT54 Div One');
        assert.deepStrictEqual([a.directorate, a.division], [D54, 'RT54 Div One']);
        assert.ok((await audit54('DIRECTORATE_ALIAS_ADD')).some(e => e.target === `"${ALIAS54}" -> "${D54}"` && e.is_test === true));
      });

      await runTest('[NEGATIVE] (5) Former-name validation: a live directorate name 400, the same name again / another directorate\'s former name 409, empty / reserved / dots only / invisible characters / too long / "PT Bank CIMB Niaga ..." 400, unknown directorate 404, a User 403 - nothing stored', async () => {
        const other = await aj54('POST', '/api/admin/directorates', { name: N54('Other') });
        assert.strictEqual(other.status, 201);
        const url = `/api/admin/directorates/${d54.directorate_id}/aliases`;
        assert.strictEqual((await aj54('POST', url, { name: N54('Other') })).status, 400, 'a live directorate');
        assert.strictEqual((await aj54('POST', url, { name: D54.toUpperCase() })).status, 400, 'its own name');
        assert.strictEqual((await aj54('POST', url, { name: ALIAS54.toLowerCase() })).status, 409, 'already its former name');
        assert.strictEqual((await aj54('POST', `/api/admin/directorates/${other.body.directorate.directorate_id}/aliases`, { name: ALIAS54 })).status, 409, 'former name of another directorate');
        for (const name of ['', '   ', 'ALL', 'bankwide', '..', `RT54\u200b${stamp54}`, 'x'.repeat(201), 'PT Bank CIMB Niaga Tbk', 42, null]) {
          assert.strictEqual((await aj54('POST', url, { name })).status, 400, JSON.stringify(name));
        }
        assert.strictEqual((await aj54('POST', '/api/admin/directorates/99999999/aliases', { name: N54('Nope') })).status, 404);
        assert.strictEqual((await aj54('POST', '/api/admin/directorates/abc/aliases', { name: N54('Nope') })).status, 404);
        const u = await scopedUser54('al', [{ directorate: D54, divisions: null }]);
        assert.strictEqual((await call54('POST', url, { name: N54('By user') }, u.cookie)).status, 403);
        assert.strictEqual((await call54('DELETE', `${url}?${new URLSearchParams({ name: ALIAS54 })}`, undefined, u.cookie)).status, 403);
        assert.deepStrictEqual((await find54(D54)).former_names, [ALIAS54]);
        assert.deepStrictEqual((await find54(N54('Other'))).former_names, []);
      });

      await runTest('[POSITIVE/NEGATIVE] (5) A former name that orphan rows already carry needs confirm_adopt (409 requires_confirmation, nothing stored); confirmed -> the rows are renamed to the directorate in its master spelling', async () => {
        const legacy = N54('Legacy Spelling');
        await checkIn54('lg', legacy.toUpperCase(), 'rt54 div one');
        const url = `/api/admin/directorates/${d54.directorate_id}/aliases`;
        const r = await aj54('POST', url, { name: legacy });
        assert.deepStrictEqual([r.status, r.body.requires_confirmation, r.body.orphan_references.attendances], [409, true, 1]);
        assert.ok(!(await find54(D54)).former_names.includes(legacy));
        const ok = await aj54('POST', url, { name: legacy, confirm_adopt: true });
        assert.strictEqual(ok.status, 201, JSON.stringify(ok.body));
        assert.strictEqual(ok.body.adopted_orphans.attendances, 1);
        const a = await attendance54(nipOf('lg'));
        assert.deepStrictEqual([a.directorate, a.division], [D54, 'RT54 Div One'], 'directorate AND division in the master spelling');
        assert.ok((await audit54('DIRECTORATE_ALIAS_ADD')).some(e => e.target.startsWith(`"${legacy}" -> "${D54}"; adopted`)));
      });

      await runTest('[POSITIVE/NEGATIVE] (5) An ESS upload whose column A uses a manual former name is stored under the directorate; after removing the former name (DELETE, audited) the same file is refused as an unknown directorate; removing it again 404, without a name 400', async () => {
        const essId = await mkMetric54(N54('ESS metric'), { scale_type: 'PERCENTAGE', survey_source: 'ESS' });
        assert.strictEqual((await adminJson('POST', `/api/admin/survey-questions/${essId}`, { questions: [{ key: 'q1_rt54', label: 'RT54', text: 'RT54 question', type: 'PERCENTAGE', mandatory: true }] })).status, 200);
        const file = await essXlsx([ESS_HEAD('RT54 Index', ['RT54 question']), [ALIAS54, 'Directorate', 2024, 'May', 120, 0.81, 0.79]]);
        const up = await postEssFile(essId, file, 'rt54_ess.xlsx');
        const body = await up.json();
        if (body.upload_id) essUploads54.push(body.upload_id);
        assert.strictEqual(up.status, 200, JSON.stringify(body).slice(0, 300));
        const rows = (await aj54('GET', `/api/metrics/${essId}/detail?period=2024-05`)).body.ess_results_by_directorate.filter(x => x.org_level === 'DIRECTORATE');
        assert.deepStrictEqual(rows.map(x => [x.directorate, x.participation]), [[D54, 120]]);
        const del = await aj54('DELETE', `/api/admin/directorates/${d54.directorate_id}/aliases?${new URLSearchParams({ name: ALIAS54.toUpperCase() })}`);
        assert.strictEqual(del.status, 200, JSON.stringify(del.body));
        assert.strictEqual(del.body.alias, ALIAS54);
        assert.ok(!(await find54(D54)).former_names.includes(ALIAS54));
        assert.ok((await audit54('DIRECTORATE_ALIAS_REMOVE')).some(e => e.target.startsWith(`"${ALIAS54}"`)));
        const again = await postEssFile(essId, file, 'rt54_ess.xlsx');
        const againBody = await again.json();
        if (againBody.upload_id) essUploads54.push(againBody.upload_id);
        assert.strictEqual(again.status, 400, 'unknown directorate once the former name is gone');
        assert.strictEqual((await aj54('DELETE', `/api/admin/directorates/${d54.directorate_id}/aliases?${new URLSearchParams({ name: ALIAS54 })}`)).status, 404);
        assert.strictEqual((await aj54('DELETE', `/api/admin/directorates/${d54.directorate_id}/aliases`)).status, 400);
      });

      await runTest('[POSITIVE/NEGATIVE] (5) Former division names: add (201, listed, a check-in with it lands on the division), a live division 400, the same again 409, an unknown division 404; remove (200) / remove again 404', async () => {
        const url = `/api/admin/directorates/${d54.directorate_id}/divisions/aliases`;
        const r = await aj54('POST', url, { division: 'rt54 div one', name: 'RT54 Division 1' });
        assert.strictEqual(r.status, 201, JSON.stringify(r.body));
        assert.deepStrictEqual([r.body.division, r.body.alias], ['RT54 Div One', 'RT54 Division 1']);
        assert.deepStrictEqual((await find54(D54)).former_division_names, [{ alias_name: 'RT54 Division 1', division_name: 'RT54 Div One' }]);
        const a = await checkIn54('dv', D54, 'RT54 Division 1');
        assert.strictEqual(a.division, 'RT54 Div One');
        assert.strictEqual((await aj54('POST', url, { division: 'RT54 Div One', name: 'rt54 div one' })).status, 400);
        assert.strictEqual((await aj54('POST', url, { division: 'RT54 Div One', name: 'rt54 division 1' })).status, 409);
        assert.strictEqual((await aj54('POST', url, { division: 'No Such Division', name: 'RT54 Division 2' })).status, 404);
        assert.strictEqual((await aj54('POST', url, { name: 'RT54 Division 2' })).status, 400);
        assert.ok((await audit54('DIVISION_ALIAS_ADD')).some(e => e.target === `"${D54}": "RT54 Division 1" -> "RT54 Div One"`));
        assert.strictEqual((await aj54('DELETE', `${url}?${new URLSearchParams({ name: 'RT54 Division 1' })}`)).status, 200);
        assert.deepStrictEqual((await find54(D54)).former_division_names, []);
        assert.strictEqual((await aj54('DELETE', `${url}?${new URLSearchParams({ name: 'RT54 Division 1' })}`)).status, 404);
        assert.ok((await audit54('DIVISION_ALIAS_REMOVE')).some(e => e.target.startsWith(`"${D54}": "RT54 Division 1"`)));
      });

      // ---------------------------------------------------------------- uniform directorate order (alphabetical)
      await runTest('[POSITIVE] Directorates are listed alphabetically everywhere (locale-aware, case-insensitive) with their divisions alphabetical too: /api/directorates, the Directorates tab list, /api/admin/parameters and the ESS template rows (Bankwide row first) - also after adding "aaa ..." / "zzz ..." names in another letter case', async () => {
        const cmp = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' });
        const sorted = list => list.every((x, i) => i === 0 || cmp(list[i - 1], x) <= 0);
        const lo = await aj54('POST', '/api/admin/directorates', { name: N54('zzz Last'), divisions: ['RT54 b div', 'RT54 A div', 'RT54 c div'] });
        const hi = await aj54('POST', '/api/admin/directorates', { name: N54('AAA first').replace('RT54', 'rt54') });
        assert.ok(lo.status === 201 && hi.status === 201);
        const pub = await (await fetch(`${BASE_URL}/api/directorates`)).json();
        assert.ok(sorted(pub.map(d => d.name)), pub.map(d => d.name).join(' | '));
        pub.forEach(d => assert.ok(sorted(d.divisions) && sorted(d.sub_directorates), `divisions of ${d.name}: ${d.divisions.join(' | ')}`));
        assert.deepStrictEqual(pub.find(d => d.name === N54('zzz Last')).divisions, ['RT54 A div', 'RT54 b div', 'RT54 c div']);
        assert.ok(pub.findIndex(d => d.name === N54('AAA first').replace('RT54', 'rt54')) < pub.findIndex(d => d.name === N54('zzz Last')), 'case-insensitive');
        const admin = await list54();
        assert.deepStrictEqual(admin.map(d => d.name), pub.map(d => d.name), 'the Directorates tab: same order');
        admin.forEach(d => assert.ok(sorted(d.divisions.map(v => v.name))));
        const params = (await aj54('GET', '/api/admin/parameters')).body;
        assert.deepStrictEqual(params.directorates.map(d => d.directorate_name || d.name), pub.map(d => d.name));
        const tpl = await fetch(`${BASE_URL}/api/surveys/template?metric_id=9`);
        assert.strictEqual(tpl.status, 200);
        const rows = (await require('../server/services/xlsxUtils').readFirstSheet(Buffer.from(await tpl.arrayBuffer()))).map(r => r.cells.map(c => c.value));
        assert.deepStrictEqual(rows[1].slice(0, 2), ['PT Bank CIMB Niaga Tbk', 'Bankwide'], 'the Bankwide row first');
        assert.deepStrictEqual(rows.slice(2).map(r => r[0]), pub.map(d => d.name), 'then the directorates alphabetically');
        for (const r of [lo, hi]) assert.strictEqual((await aj54('DELETE', `/api/admin/directorates/${r.body.directorate.directorate_id}`)).status, 200);
      });

      // ---------------------------------------------------------------- (6) ESS question templates
      const ESS_TEMPLATE54 = {
        9: ['I understand how my current job role contributes to a positive impact on customers and society.', 'Employees clearly understand what is expected of them.', 'My immediate manager gives me feedback that helps me improve my performance.'],
        13: ['I am proud to work at CIMB.', 'People want to work here because of the culture and work environment.', 'I feel energized by my work.'],
        15: ['My immediate manager recognizes me when I do a good job.'],
        16: ['CIMB cares about my well-being.', 'I can manage my job responsibilities in a way that enables healthy work-life balance.'],
        17: ['At work, I can speak up with ideas or suggestions, even if others have different opinions.', 'Colleagues escalate issues even when these are outside their direct responsibilities.'],
        18: ['Leaders help us understand and navigate changes happening in CIMB.', 'Leaders makes an effort to get input, ideas, and opinions from employees.'],
        21: ['I have the opportunity to continually learn and grow.'],
        22: ['CIMB has employees with the right skills to deliver its strategy.', 'Employees have sufficient authority to make decisions.'],
        24: ['My immediate manager gives me feedback that helps me improve my performance.'],
        25: ['My work gives me a feeling of personal accomplishment.'],
        27: ['Even if offered a comparable role and compensation package at another company, I would choose to stay at CIMB.']
      };
      await runTest('[POSITIVE] (6) The default question set of each of the 11 ESS metrics = the question columns of its ESS result template, in column order, all PERCENTAGE with stable keys q<n>_<slug>; metric 9 equals the real file in docs/ column by column', async () => {
        const { DEFAULT_METRIC_QUESTIONS } = require('../server/services/metricQuestionService');
        const seed54 = require('../server/db/seedData');
        const essIds = seed54.initialMetrics.filter(m => m.survey_source === 'ESS').map(m => m.metric_id).sort((a, b) => a - b);
        assert.deepStrictEqual(essIds, Object.keys(ESS_TEMPLATE54).map(Number));
        for (const id of essIds) {
          const qs = DEFAULT_METRIC_QUESTIONS[id];
          assert.deepStrictEqual(qs.map(q => q.text), ESS_TEMPLATE54[id], `metric ${id} texts`);
          qs.forEach((q, i) => {
            assert.ok(new RegExp(`^q${i + 1}_[a-z0-9_]+$`).test(q.key), `metric ${id} key ${q.key}`);
            assert.strictEqual(q.type, 'PERCENTAGE');
            assert.ok(q.label && q.dimension, `metric ${id} label + dimension`);
          });
        }
        const { readFirstSheet } = require('../server/services/xlsxUtils');
        const sheet = await readFirstSheet(require('fs').readFileSync(require('path').join(__dirname, '..', 'docs', 'ESS 2025 Result_Role Clarity & DS Support.xlsx')));
        const head = sheet[0].cells.map(c => String(c.value === null || c.value === undefined ? '' : c.value).replace(/\s+/g, ' ').trim());
        assert.deepStrictEqual(head.slice(6), DEFAULT_METRIC_QUESTIONS[9].map(q => q.text));
      });

      await runTest('[POSITIVE] (6) Fresh-install consistency: every seed ESS result row carries exactly the template questions (same count and order) and "Reset to default" of an ESS metric gives the template', async () => {
        const { DEFAULT_METRIC_QUESTIONS } = require('../server/services/metricQuestionService');
        const seed54 = require('../server/db/seedData');
        for (const r of seed54.initialEssResults) {
          assert.deepStrictEqual(r.questions.map(q => q.label), ESS_TEMPLATE54[r.metric_id], `seed row ${r.upload_id} ${r.directorate || 'Bankwide'}`);
          assert.ok(r.questions.every(q => typeof q.score === 'number'), 'every question has a score');
        }
        const before = (await aj54('GET', '/api/admin/survey-questions/15')).body.questions;
        try {
          const reset = await aj54('POST', '/api/admin/survey-questions/15/reset');
          assert.strictEqual(reset.status, 200);
          assert.deepStrictEqual(reset.body.questions.map(q => [q.key, q.text, q.type]), DEFAULT_METRIC_QUESTIONS[15].map(q => [q.key, q.text, 'PERCENTAGE']));
        } finally {
          assert.strictEqual((await aj54('POST', '/api/admin/survey-questions/15', { questions: before })).status, 200);
        }
      });

      await runTest('[NEGATIVE] (6) Non-ESS templates are unchanged by the ESS update (metric 8 keeps its 1-5 / yes-no questions, metric 12 its free-text question) and no ESS template has a FREE_TEXT or 1-5 question', async () => {
        const { DEFAULT_METRIC_QUESTIONS } = require('../server/services/metricQuestionService');
        assert.ok(DEFAULT_METRIC_QUESTIONS[8].some(q => q.type === 'SCALE_1_5') && DEFAULT_METRIC_QUESTIONS[8].every(q => q.type !== 'PERCENTAGE'));
        assert.ok(DEFAULT_METRIC_QUESTIONS[12].some(q => q.type === 'FREE_TEXT'));
        for (const id of Object.keys(ESS_TEMPLATE54)) assert.ok(DEFAULT_METRIC_QUESTIONS[id].every(q => q.type === 'PERCENTAGE'), `metric ${id}`);
      });
    } finally {
      for (const id of metrics54) await adminJson('DELETE', `/api/admin/metrics/${id}`);
      for (const id of journeys54) await adminJson('DELETE', `/api/admin/journeys/${id}`);
      for (const id of essUploads54) {
        const f = require('path').join(require('../server/services/essSummaryService').ESS_UPLOAD_DIR, `${id}.xlsx`);
        if (require('fs').existsSync(f)) require('fs').unlinkSync(f);
      }
      for (const nip of nips54) await adminJson('DELETE', `/api/events/${EV54}/attendance/${nip}`);
      for (const id of users54) { try { await st54.deleteUser(id); } catch (_) { /* gone */ } }
      for (const d of (await list54()).filter(x => x.name.toLowerCase().startsWith('rt54 ') && x.name.toLowerCase().endsWith(stamp54))) {
        const r = await aj54('DELETE', `/api/admin/directorates/${d.directorate_id}`);
        if (r.status !== 200) console.error(`     Module 54 cleanup: could not delete "${d.name}" (${r.status}: ${JSON.stringify(r.body.references || r.body.error)})`);
      }
      // the flag and anything else of the configuration: the guard puts the whole snapshot back (SQL); JSON: only the flag
      if (configGuard) { await restoreConfigGuard('end of Module 54'); legacyFixturesOn = []; await setLegacyFixtures(true); }
      else if (flag54 !== true && typeof st54.setSetting === 'function' && isSql54) await st54.setSetting('directory_admin_managed', flag54 === undefined ? false : flag54);
    }
  }
  // --- MODULE 55 (v2.52.0): SOCIAL MEDIA DATA OF METRIC 1 - EXCEL UPLOAD, DRILLDOWN TABLE (v2.53.0: integration removed) ---
  // Fixtures live in years no other data uses (2097, 2099; YTD on a past year: 2018) and are removed at the end by this run's
  // upload ids / the seed rows the module inserted itself. SQL Server only
  // (the cleanup goes through SQL; on SQL the JSON backend is also checked in-process, with store.json / auth.json restored
  // byte-identically).
  console.log('\n📦 MODULE 55: Social media data of metric 1 - template, .xlsx upload, drilldown table, integration removed (Positive & Negative Testing)');
  if (require('../server/db/storage').backend !== 'sql') {
    console.log('  ⏭️  SKIPPED: Module 55 needs the SQL Server backend (its fixtures are removed through SQL)');
  } else if (!skipModuleBlock(55)) {
    const st55 = require('../server/db/storage');
    const sm55 = require('../server/services/socialMediaService');
    const { buildXlsx: buildXlsx55, readFirstSheet: readSheet55 } = require('../server/services/xlsxUtils');
    const sql55 = require('mssql');
    const fs55 = require('fs');
    const path55 = require('path');
    const pool55 = await new sql55.ConnectionPool({ server: process.env.DB_SERVER || 'localhost', port: parseInt(process.env.DB_PORT || '1433', 10), database: process.env.DB_NAME || 'PeopleExperiencePX',
      user: process.env.DB_USER, password: process.env.DB_PASSWORD, options: { encrypt: false, trustServerCertificate: true } }).connect();
    const q55 = async (text, params = {}) => {
      const r = pool55.request();
      Object.entries(params).forEach(([k, v]) => r.input(k, v));
      return (await r.query(text)).recordset || [];
    };
    const HEAD55 = ['Platform', 'Year', 'Month', 'Followers', 'Reach', 'Engagement'];
    const xlsx55 = rows => buildXlsx55([HEAD55, ...rows]);
    const uploadIds55 = [];
    const userIds55 = [];
    const stamp55 = Date.now().toString(36);
    const postSocial = async (buf, fileName = 'module55.xlsx', cookie = null, type = undefined) => {
      const fd = new FormData();
      fd.append('file', new Blob([buf], type ? { type } : undefined), fileName);
      return cookie ? realFetch(`${BASE_URL}/api/admin/social-media/upload`, { method: 'POST', body: fd, headers: { Cookie: cookie } })
        : fetch(`${BASE_URL}/api/admin/social-media/upload`, { method: 'POST', body: fd });
    };
    // v2.55.0: the social media drilldown is switched off in the metric detail (SOCIAL_MEDIA_DRILLDOWN_ENABLED false) but kept
    // dormant - its table is checked in-process through socialMediaService.getSocialMediaDrilldown (same period parsing as the
    // detail: mode, year, month padded); the HTTP detail of metric 1 is checked to carry none of it.
    const detail55 = async q => {
      const p = new URLSearchParams(q);
      const sm = await sm55.getSocialMediaDrilldown({ mode: p.get('mode') || 'YTD', year: p.get('year'), month: String(p.get('month') || '01').padStart(2, '0') });
      return { status: 200, body: { operational_records: sm.rows, social_media: sm } };
    };
    const httpDetail55 = async (q, cookie = null) => {
      const r = cookie ? await realFetch(`${BASE_URL}/api/metrics/1/detail?${q}`, { headers: { Cookie: cookie } }) : await fetch(`${BASE_URL}/api/metrics/1/detail?${q}`);
      return { status: r.status, body: await r.json() };
    };
    const assertHidden55 = (d, label) => {
      assert.strictEqual(d.operational_records_hidden, true, `${label}: no Internal Transaction Records tab`);
      assert.deepStrictEqual(d.operational_records, [], `${label}: no records`);
      assert.strictEqual(d.data_upload, undefined, `${label}: no social media upload flag`);
      assert.strictEqual(d.social_media, undefined, `${label}: no social media block`);
    };
    const rowsOf = d => d.operational_records.map(r => [r.platform, r.period, r.followers, r.follower_growth_pct, r.reach, r.engagement, r.engagement_rate_pct]);
    const yearCount55 = async y => (await q55('SELECT COUNT(*) AS n FROM dbo.px_social_media_stats WHERE stat_year = @y', { y }))[0].n;
    let userCookie55 = null;
    let preExisting55 = 0;
    try {
      preExisting55 = (await yearCount55(2018)) + (await yearCount55(2097)) + (await yearCount55(2099));

      await runTest('[POSITIVE] Metric 1 has no recruitment-SLA rows any more (boot cleanup idempotent), the other drilldown tables are untouched; v2.55.0: the social media drilldown is off - no data_upload flag in calculate, the metric-1 detail has no records / social block (operational_records_hidden), the dormant drilldown still reads the platforms', async () => {
        assert.strictEqual(preExisting55, 0, 'the fixture years 2018 / 2097 / 2099 must be empty before the module runs (nothing of somebody else is touched)');
        assert.strictEqual((await q55('SELECT COUNT(*) AS n FROM dbo.px_recruitment_sla_by_unit WHERE metric_id = 1'))[0].n, 0);
        assert.strictEqual(await st55.removeMetric1SlaRows(), 0, 'a second cleanup removes nothing');
        for (const [id, n] of [[3, 3], [4, 4], [14, 3]].filter(([id]) => isLiveMetric(id))) { // v2.58.0: a metric the Admin deleted is skipped
          const d = await (await fetch(`${BASE_URL}/api/metrics/${id}/detail?period=YTD`)).json();
          assert.strictEqual(d.operational_records.length, n, `metric ${id} keeps its ${n} drilldown rows`);
        }
        assert.strictEqual((await q55('SELECT COUNT(*) AS n FROM dbo.px_attrition_by_tenure WHERE metric_id = 25'))[0].n, 3, 'metric 25 keeps its attrition rows');
        const calc = await (await fetch(`${BASE_URL}/api/metrics/calculate?period=YTD`)).json();
        assert.deepStrictEqual(calc.metrics.filter(m => m.data_upload === 'SOCIAL_MEDIA').map(m => m.metric_id), [], 'no metric offers the social media upload');
        const h1 = (await httpDetail55('mode=YTD&year=2026')).body;
        assertHidden55(h1, 'metric 1 YTD 2026');
        const d1 = (await detail55('mode=YTD&year=2026')).body;
        assert.ok(d1.operational_records.length > 0 && d1.operational_records.every(r => r.platform && r.unit === undefined && r.sla_achievement === undefined));
        assert.deepStrictEqual(d1.social_media.platforms, ['Instagram', 'LinkedIn', 'TikTok']);
        // v2.55.0: the value of metric 1 = the AVERAGE of its uploaded months of the period, else the Admin raw_value
        const months1 = (await st55.getOutcomeValues(1)).filter(r => r.year === 2026 && r.month <= new Date().getMonth() + 1);
        const avg1 = months1.length ? months1.reduce((s, r) => s + r.value, 0) / months1.length : parseFloat((await st55.getMetricById(1)).raw_value || 0);
        assert.ok(Math.abs(h1.current_raw_value - avg1) < 0.0001, `${h1.current_raw_value} vs ${avg1}`);
      });

      await runTest('[POSITIVE] Template download (.xlsx): header Platform | Year | Month | Followers | Reach | Engagement and one row per platform for the last complete month, numbers empty', async () => {
        const r = await fetch(`${BASE_URL}/api/admin/social-media/template`);
        assert.strictEqual(r.status, 200);
        assert.ok(/spreadsheetml/.test(r.headers.get('content-type')));
        assert.ok(/Template_Social_Media_Metric_1\.xlsx/.test(r.headers.get('content-disposition')));
        const rows = await readSheet55(Buffer.from(await r.arrayBuffer()));
        assert.deepStrictEqual(rows[0].cells.map(c => c.value), HEAD55);
        const now = new Date();
        const y = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
        const m = now.getMonth() === 0 ? 12 : now.getMonth();
        assert.deepStrictEqual(rows.slice(1).map(x => x.cells.filter(Boolean).map(c => c.value)), ['Instagram', 'LinkedIn', 'TikTok'].map(p => [p, y, require('../server/services/essSummaryService').MONTH_NAMES[m - 1]]));
        const v = sm55.validateSocialSheet(rows);
        assert.ok(v.errors.length === 9 && v.errors.every(e => /is empty/.test(e.reason)), 'only the empty numbers are reported');
      });

      await runTest('[POSITIVE] Admin uploads a valid .xlsx (aliases IG / Linked In / TT, months "Maret" / "Feb" / 3, "1,500"): 200, counts + periods, original kept, history entry, audit SOCIAL_MEDIA_UPLOAD (test-run row)', async () => {
        const res = await postSocial(await xlsx55([
          ['IG', 2099, 'Maret', 1100, 2000, 100],
          ['Linked In', '2099', 3, '1,500', 0, 5],
          ['TT', 2099, 'Mar', 10, 20, 30],
          ['instagram', 2099, 'Feb', 1000, 1000, 10]
        ]), 'module55_valid.xlsx');
        const body = await res.json();
        assert.strictEqual(res.status, 200, JSON.stringify(body).slice(0, 400));
        uploadIds55.push(body.upload_id);
        assert.deepStrictEqual([body.rows_imported, body.inserted_rows, body.updated_rows, body.replaced_seed_rows, body.source], [4, 4, 0, 0, 'UPLOAD']);
        assert.deepStrictEqual(body.periods, ['2099-02', '2099-03']);
        assert.ok(fs55.existsSync(path55.join(sm55.SOCIAL_UPLOAD_DIR, `${body.upload_id}.xlsx`)), 'original file kept (non-public folder)');
        const hist = await (await fetch(`${BASE_URL}/api/admin/social-media/uploads`)).json();
        const h = hist.find(u => u.upload_id === body.upload_id);
        assert.ok(h && h.source === 'UPLOAD' && h.file_name === 'module55_valid.xlsx' && h.has_original_file && h.period_from === '2099-02' && h.period_to === '2099-03');
        const file = await fetch(`${BASE_URL}/api/admin/social-media/file/${body.upload_id}`);
        assert.strictEqual(file.status, 200);
        assert.strictEqual((await fetch(`${BASE_URL}/api/admin/social-media/file/not-there`)).status, 404);
        const audit = await st55.getAuditLog(30, { includeTest: true });
        const a = audit.find(x => x.action === 'SOCIAL_MEDIA_UPLOAD' && String(x.target).includes(body.upload_id));
        assert.ok(a && a.is_test === true && /4 rows \(4 new, 0 updated, 0 seed replaced\); 2099-02 2099-03/.test(a.target), JSON.stringify(a));
      });

      await runTest('[POSITIVE] Detail MTD March 2099: rows Instagram, LinkedIn, TikTok with follower growth vs February (Instagram +10%, LinkedIn no February -> null), engagement rate (reach 0 -> null), an "All platforms" total; MTD February: no January -> growth null', async () => {
        const { status, body: d } = await detail55('mode=MTD&year=2099&month=03');
        assert.strictEqual(status, 200);
        assert.deepStrictEqual(rowsOf(d), [
          ['Instagram', '2099-03', 1100, 10, 2000, 100, 5],
          ['LinkedIn', '2099-03', 1500, null, 0, 5, null],
          ['TikTok', '2099-03', 10, null, 20, 30, 150]
        ]);
        assert.ok(d.operational_records.every(r => r.is_dummy === false && r.source === 'UPLOAD' && r.period_label === 'March 2099'));
        assert.deepStrictEqual(d.social_media.period_totals, [{ period: '2099-03', period_label: 'March 2099', platforms: 3, followers: 2610, follower_growth_pct: null, reach: 2020, engagement: 135, engagement_rate_pct: 6.68 }]);
        assert.deepStrictEqual(d.social_media.window, { from: '2099-03-01', to: '2099-03-31', basis: 'MONTH' });
        const feb = (await detail55('mode=MTD&year=2099&month=02')).body;
        assert.deepStrictEqual(rowsOf(feb), [['Instagram', '2099-02', 1000, null, 1000, 10, 1]]);
        assert.deepStrictEqual(feb.social_media.period_totals, [], 'one platform -> no total line');
      });

      await runTest('[POSITIVE] v2.55.0: the metric-1 detail shows no social media rows under a directorate, a division or for a USER (drilldown off; the stored 2099 rows stay in the database)', async () => {
        const directory55 = await (await rawFetch(`${BASE_URL}/api/directorates`)).json();
        const dir = directory55.find(d => d.divisions.length > 0);
        assert.ok(rowsOf((await detail55('mode=MTD&year=2099&month=03')).body).length === 3, 'the dormant drilldown still has the March 2099 rows');
        const byDir = await httpDetail55(`mode=MTD&year=2099&month=03&directorate=${encodeURIComponent(dir.directorate_name)}`);
        assert.strictEqual(byDir.status, 200);
        assertHidden55(byDir.body, 'under a directorate');
        assertHidden55((await httpDetail55(`mode=MTD&year=2099&month=03&directorate=${encodeURIComponent(dir.directorate_name)}&sub_directorate=${encodeURIComponent(dir.divisions[0])}`)).body, 'under a division');
        const username = `rt55u${stamp55}`;
        const created = await adminJson('POST', '/api/admin/users', { username, full_name: 'Regression Social User', email: `${username}@example.test`, role: 'USER', scopes: [{ directorate: dir.directorate_name, divisions: null }] });
        assert.strictEqual(created.status, 201);
        const cb = await created.json();
        userIds55.push(cb.user.user_id);
        const { cookie } = await loginAs(username, cb.temporary_password);
        assert.strictEqual((await rawFetch(`${BASE_URL}/api/auth/change-password`, jsonBody('POST', { current_password: cb.temporary_password, new_password: STRONG }, cookie))).status, 200);
        userCookie55 = cookie;
        const u = await httpDetail55('mode=MTD&year=2099&month=03', cookie);
        assert.strictEqual(u.status, 200);
        assertHidden55(u.body, 'USER');
      });

      await runTest('[POSITIVE] Upsert: uploading March 2099 Instagram again UPDATES that row (1 updated, 0 new) and the growth follows (+21%)', async () => {
        const res = await postSocial(await xlsx55([['Instagram', 2099, 'March', 1210, 2000, 120]]), 'module55_upsert.xlsx');
        const body = await res.json();
        assert.strictEqual(res.status, 200, JSON.stringify(body).slice(0, 300));
        uploadIds55.push(body.upload_id);
        assert.deepStrictEqual([body.inserted_rows, body.updated_rows], [0, 1]);
        const ig = (await detail55('mode=MTD&year=2099&month=03')).body.operational_records.find(r => r.platform === 'Instagram');
        assert.deepStrictEqual([ig.followers, ig.follower_growth_pct, ig.engagement_rate_pct], [1210, 21, 6]);
        assert.strictEqual(await yearCount55(2099), 4, 'no duplicate row');
      });

      await runTest('[POSITIVE] Real data of a month replaces ALL seed rows of that month; the seed top-up adds a (platform, month) only while the month has no real row and never twice', async () => {
        const seedRow = (platform, month, n) => ({ platform, year: 2099, month, followers: n, reach: n * 2, engagement: n / 10 });
        assert.deepStrictEqual(await st55.topUpSocialMediaSeed([seedRow('Instagram', 6, 500), seedRow('LinkedIn', 6, 600), seedRow('TikTok', 6, 700)]), ['2099-06']);
        assert.deepStrictEqual(await st55.topUpSocialMediaSeed([seedRow('Instagram', 6, 500)]), [], 'idempotent');
        const before = (await detail55('mode=MTD&year=2099&month=06')).body;
        assert.ok(before.operational_records.length === 3 && before.operational_records.every(r => r.is_dummy === true && r.source === 'SEED'));
        const res = await postSocial(await xlsx55([['Instagram', 2099, 'June', 900, 1800, 90]]), 'module55_replace_seed.xlsx');
        const body = await res.json();
        assert.strictEqual(res.status, 200, JSON.stringify(body).slice(0, 300));
        uploadIds55.push(body.upload_id);
        assert.deepStrictEqual([body.inserted_rows, body.updated_rows, body.replaced_seed_rows], [1, 0, 3]);
        assert.ok(/3 dummy rows of that month replaced/.test(body.message));
        assert.deepStrictEqual(rowsOf((await detail55('mode=MTD&year=2099&month=06')).body), [['Instagram', '2099-06', 900, null, 1800, 90, 5]]);
        // June has a real row now -> no seed for June; July (no row at all) gets its seed rows
        assert.deepStrictEqual(await st55.topUpSocialMediaSeed([seedRow('LinkedIn', 6, 600), seedRow('TikTok', 7, 700)]), ['2099-07']);
        const jul = (await detail55('mode=MTD&year=2099&month=07')).body.operational_records;
        assert.deepStrictEqual(jul.map(r => [r.platform, r.is_dummy]), [['TikTok', true]]);
      });

      await runTest('[POSITIVE] YTD vs MTD on a past year (2018): YTD = January..December rows in period order, MTD February = one row with growth vs January; YTD of a future year (2099) = no rows', async () => {
        const res = await postSocial(await xlsx55([['TikTok', 2018, 12, 300, 3000, 30], ['Instagram', 2018, 1, 200, 400, 4], ['Instagram', 2018, 2, 250, 500, 50], ['LinkedIn', 2018, 1, 100, 100, 1]]), 'module55_ytd.xlsx');
        const body = await res.json();
        assert.strictEqual(res.status, 200, JSON.stringify(body).slice(0, 300));
        uploadIds55.push(body.upload_id);
        const ytd = (await detail55('mode=YTD&year=2018')).body;
        assert.deepStrictEqual(ytd.operational_records.map(r => [r.platform, r.period]), [['Instagram', '2018-01'], ['LinkedIn', '2018-01'], ['Instagram', '2018-02'], ['TikTok', '2018-12']]);
        assert.deepStrictEqual(ytd.social_media.window, { from: '2018-01-01', to: '2018-12-31', basis: 'YEAR_TO_MONTH' });
        assert.deepStrictEqual(ytd.social_media.period_totals.map(t => [t.period, t.followers, t.follower_growth_pct]), [['2018-01', 300, null]]);
        const mtd = (await detail55('mode=MTD&year=2018&month=2')).body;
        assert.deepStrictEqual(rowsOf(mtd), [['Instagram', '2018-02', 250, 25, 500, 50, 10]]);
        const future = (await detail55('mode=YTD&year=2099')).body;
        assert.deepStrictEqual([future.operational_records.length, future.social_media.window], [0, null], 'a future year has no elapsed month');
        assert.ok(future.social_media.latest_period >= '2099-07', 'latest_period = the newest stored month');
      });

      await runTest('[NEGATIVE] Upload validation refuses the whole file (400, every error with row + column, nothing stored): unknown platform, bad year, bad month, negative, non-numeric, decimal, empty number, duplicate platform + month, missing column, no data rows', async () => {
        const before = await yearCount55(2099);
        const cases = [
          ['platform', [['Facebook', 2099, 4, 1, 1, 1]], 2, 'A', /Platform "Facebook" is unknown/],
          ['year', [['Instagram', '20x9', 4, 1, 1, 1]], 2, 'B', /Year must be a 4-digit year/],
          ['old year', [['Instagram', 1999, 4, 1, 1, 1]], 2, 'B', /Year must be/],
          ['month 13', [['Instagram', 2099, 13, 1, 1, 1]], 2, 'C', /Month must be a month name/],
          ['month name', [['Instagram', 2099, 'Smarch', 1, 1, 1]], 2, 'C', /Month must be/],
          ['negative', [['Instagram', 2099, 4, -5, 1, 1]], 2, 'D', /Followers must not be negative/],
          ['non-numeric', [['Instagram', 2099, 4, 1, 'many', 1]], 2, 'E', /Reach must be a whole number/],
          ['decimal', [['Instagram', 2099, 4, 1, 1, 2.5]], 2, 'F', /Engagement must be a whole number/],
          ['empty', [['Instagram', 2099, 4, 1, null, 1]], 2, 'E', /Reach is empty/],
          ['duplicate', [['Instagram', 2099, 4, 1, 1, 1], ['IG', 2099, 'April', 2, 2, 2]], 3, 'A', /Instagram April 2099 appears more than once \(rows 3 and 4\)/]
        ];
        for (const [name, rows, rowNo, col, re] of cases) {
          const r = await postSocial(await xlsx55([['LinkedIn', 2099, 4, 1, 1, 1], ...rows]), `module55_bad_${name.replace(/\s+/g, '_')}.xlsx`);
          const b = await r.json();
          assert.strictEqual(r.status, 400, name);
          assert.ok(/nothing was stored/.test(b.error), name);
          assert.ok(b.errors.some(e => e.row_number === rowNo + 1 && e.column === col && re.test(e.reason)), `${name}: ${JSON.stringify(b.errors).slice(0, 300)}`);
        }
        const noCol = await postSocial(await buildXlsx55([['Platform', 'Year', 'Month', 'Followers', 'Reach'], ['Instagram', 2099, 4, 1, 1]]), 'module55_nocol.xlsx');
        assert.strictEqual(noCol.status, 400);
        assert.ok(/no column Engagement/.test(JSON.stringify(await noCol.json())));
        const noRows = await postSocial(await buildXlsx55([HEAD55]), 'module55_norows.xlsx');
        assert.strictEqual(noRows.status, 400);
        assert.ok(/no data rows/.test(JSON.stringify(await noRows.json())));
        assert.strictEqual(await yearCount55(2099), before, 'none of the refused files stored a row (not even the valid LinkedIn row)');
        const hist = await (await fetch(`${BASE_URL}/api/admin/social-media/uploads`)).json();
        assert.ok(!hist.some(u => /^module55_(bad|nocol|norows)/.test(u.file_name || '')), 'no upload record for a refused file');
      });

      await runTest('[NEGATIVE] Not an .xlsx: .csv / .xls -> 415, an .xlsx name sent as text/csv -> 415, garbage bytes named .xlsx -> 400, no file -> 400, over 5 MB -> 413', async () => {
        const before = await yearCount55(2099);
        assert.strictEqual((await postSocial(Buffer.from('Platform,Year\nIG,2099\n'), 'module55.csv')).status, 415);
        assert.strictEqual((await postSocial(Buffer.from('xx'), 'module55.xls')).status, 415);
        assert.strictEqual((await postSocial(await xlsx55([['Instagram', 2099, 4, 1, 1, 1]]), 'module55_mime.xlsx', null, 'text/csv')).status, 415);
        const junk = await postSocial(Buffer.from('this is not a zip'), 'module55_junk.xlsx');
        assert.strictEqual(junk.status, 400);
        assert.ok(/not a valid Excel/i.test((await junk.json()).error));
        assert.strictEqual((await fetch(`${BASE_URL}/api/admin/social-media/upload`, { method: 'POST', body: new FormData() })).status, 400);
        assert.strictEqual((await postSocial(Buffer.alloc(5 * 1024 * 1024 + 10), 'module55_big.xlsx')).status, 413);
        assert.strictEqual(await yearCount55(2099), before, 'no refused file stored a row');
      });

      await runTest('[NEGATIVE] USER: template / upload / history / original file -> 403; without login -> 401', async () => {
        assert.ok(userCookie55, 'user from the directorate-filter test');
        for (const p of ['/api/admin/social-media/template', '/api/admin/social-media/uploads', `/api/admin/social-media/file/${uploadIds55[0]}`]) {
          assert.strictEqual((await realFetch(`${BASE_URL}${p}`, { headers: { Cookie: userCookie55 } })).status, 403, p);
          assert.strictEqual((await realFetch(`${BASE_URL}${p}`)).status, 401, `${p} without login`);
        }
        assert.strictEqual((await postSocial(await xlsx55([['Instagram', 2099, 5, 1, 1, 1]]), 'module55_user.xlsx', userCookie55)).status, 403);
        assert.strictEqual((await q55('SELECT COUNT(*) AS n FROM dbo.px_social_media_stats WHERE stat_year = 2099 AND stat_month = 5'))[0].n, 0, 'the USER upload stored nothing');
      });

      // v2.53.0: the integration feature of v2.52.0 (token-based ingest endpoint + token admin routes + px_integration_tokens) is
      // removed - the app is on-premise, the Excel upload is the only way in. The old URLs get the normal unknown-route answers.
      await runTest('[NEGATIVE] v2.53.0 integration removed: POST /api/integrations/social-media -> 401 without login (also with a Bearer header), 404 for an Admin / a USER session; /api/admin/integration-tokens (GET, POST, /:id/revoke, DELETE /:id) -> 404 for an Admin, 403 for a USER, 401 without login; nothing stored', async () => {
        const before = await yearCount55(2099);
        const one = JSON.stringify({ rows: [{ platform: 'Instagram', year: 2099, month: 5, followers: 1, reach: 1, engagement: 1 }] });
        const post = headers => realFetch(`${BASE_URL}/api/integrations/social-media`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: one });
        assert.strictEqual((await post({})).status, 401, 'no session');
        assert.strictEqual((await post({ Authorization: `Bearer pxi_${'a'.repeat(64)}` })).status, 401, 'a token-shaped Bearer header opens nothing');
        assert.strictEqual((await fetch(`${BASE_URL}/api/integrations/social-media`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: one })).status, 404, 'Admin session');
        assert.strictEqual((await post({ Cookie: userCookie55 })).status, 404, 'USER session');
        const routes = [['GET', '/api/admin/integration-tokens'], ['POST', '/api/admin/integration-tokens'], ['POST', '/api/admin/integration-tokens/1/revoke'], ['DELETE', '/api/admin/integration-tokens/1']];
        for (const [m, p] of routes) {
          assert.strictEqual((await adminJson(m, p, m === 'GET' ? undefined : { name: 'RT55 removed' })).status, 404, `Admin ${m} ${p}`);
          assert.strictEqual((await realFetch(`${BASE_URL}${p}`, { method: m, headers: { Cookie: userCookie55 } })).status, 403, `USER ${m} ${p}`);
          assert.strictEqual((await realFetch(`${BASE_URL}${p}`, { method: m })).status, 401, `${m} ${p} without login`);
        }
        assert.strictEqual(await yearCount55(2099), before, 'nothing stored');
        assert.strictEqual((await q55("SELECT COUNT(*) AS n FROM dbo.px_social_media_uploads WHERE source = 'INTEGRATION'"))[0].n, 0, 'no INTEGRATION batch exists');
        for (const name of ['getIntegrationTokens', 'getIntegrationTokenByHash', 'createIntegrationToken', 'touchIntegrationToken', 'revokeIntegrationToken', 'deleteIntegrationToken']) {
          assert.strictEqual(st55[name], undefined, `storage.${name} removed`);
          assert.strictEqual(require('../server/db/jsonStorage')[name], undefined, `jsonStorage.${name} removed`);
        }
        for (const name of ['ingestSocialMediaRows', 'validateIngestBody', 'createIntegrationToken', 'authenticateIntegrationToken', 'takeIngestSlot', 'INGEST_PER_MINUTE']) assert.strictEqual(sm55[name], undefined, `socialMediaService.${name} removed`);
      });

      await runTest('[POSITIVE] v2.53.0 guarded DROP of px_integration_tokens: gone after boot; a table that holds rows is KEPT (never dropped with data), once empty it is DROPPED, then ABSENT (idempotent)', async () => {
        const exists = async () => !!(await q55("SELECT OBJECT_ID(N'dbo.px_integration_tokens', N'U') AS id"))[0].id;
        assert.strictEqual(await exists(), false, 'the boot of this backend dropped the empty table');
        assert.deepStrictEqual(await st55.dropRetiredIntegrationTokens(), { state: 'ABSENT', rows: 0 });
        let created = false;
        try {
          await q55('CREATE TABLE dbo.px_integration_tokens (token_id INT NOT NULL); INSERT INTO dbo.px_integration_tokens (token_id) VALUES (1)');
          created = true;
          assert.deepStrictEqual(await st55.dropRetiredIntegrationTokens(), { state: 'KEPT', rows: 1 });
          assert.strictEqual(await exists(), true, 'a table with rows is kept');
          await q55('DELETE FROM dbo.px_integration_tokens');
          assert.deepStrictEqual(await st55.dropRetiredIntegrationTokens(), { state: 'DROPPED', rows: 0 });
          assert.strictEqual(await exists(), false);
          assert.deepStrictEqual(await st55.dropRetiredIntegrationTokens(), { state: 'ABSENT', rows: 0 });
        } finally {
          if (created) await q55("IF OBJECT_ID(N'dbo.px_integration_tokens', N'U') IS NOT NULL DROP TABLE dbo.px_integration_tokens");
        }
      });

      await runTest('[POSITIVE] v2.53.0 JSON backend: an empty auth.json integrationTokens list is removed on load, a non-empty one is kept (nothing reads it); store.json and auth.json restored byte-identically', async () => {
        const dataDir = path55.join(__dirname, '..', 'server', 'data');
        const files = ['store.json', 'auth.json'].map(f => path55.join(dataDir, f));
        const saved = files.map(f => (fs55.existsSync(f) ? fs55.readFileSync(f) : null));
        const modPath = require.resolve('../server/db/jsonStorage');
        const cached = require.cache[modPath];
        const loadWith = auth => {
          fs55.writeFileSync(files[1], JSON.stringify(auth, null, 2), 'utf8');
          delete require.cache[modPath];
          const js = require('../server/db/jsonStorage');
          js.countUsers(); // loads auth.json
          return JSON.parse(fs55.readFileSync(files[1], 'utf8'));
        };
        let emptyAfter;
        let keptAfter;
        try {
          emptyAfter = loadWith({ users: [], sessions: [], audit: [], integrationTokens: [] });
          keptAfter = loadWith({ users: [], sessions: [], audit: [], integrationTokens: [{ token_id: 1, name: 'RT55 legacy' }] });
        } finally {
          if (cached) require.cache[modPath] = cached; else delete require.cache[modPath];
          files.forEach((f, i) => { if (saved[i] === null) { if (fs55.existsSync(f)) fs55.unlinkSync(f); } else fs55.writeFileSync(f, saved[i]); });
        }
        files.forEach((f, i) => assert.ok(saved[i] === null ? !fs55.existsSync(f) : Buffer.compare(fs55.readFileSync(f), saved[i]) === 0, `${path55.basename(f)} restored byte-identically`));
        assert.strictEqual('integrationTokens' in emptyAfter, false, 'empty list removed');
        assert.deepStrictEqual(keptAfter.integrationTokens, [{ token_id: 1, name: 'RT55 legacy' }], 'a non-empty list is kept untouched');
      });

      await runTest('[POSITIVE] JSON backend in-process (same contract): save / upsert / seed replacement / top-up / stats / uploads give the same results as SQL Server; store.json and auth.json are restored byte-identically', async () => {
        const dataDir = path55.join(__dirname, '..', 'server', 'data');
        const files = ['store.json', 'auth.json'].map(f => path55.join(dataDir, f));
        const saved = files.map(f => (fs55.existsSync(f) ? fs55.readFileSync(f) : null));
        const strip = rows => rows.map(({ stat_id, created_at, updated_at, upload_id, ...r }) => r); // eslint-disable-line no-unused-vars
        const run = async st => {
          const out = {};
          out.seed = await st.topUpSocialMediaSeed([{ platform: 'TikTok', year: 2097, month: 1, followers: 10, reach: 20, engagement: 2 }, { platform: 'LinkedIn', year: 2097, month: 2, followers: 30, reach: 40, engagement: 4 }]);
          const s1 = await st.saveSocialMediaStats({ upload_id: `rt55-parity-a-${stamp55}`, source: 'UPLOAD', file_name: 'parity.xlsx', uploaded_by: 'RT55', period_from: '2097-01', period_to: '2097-01' },
            [{ platform: 'Instagram', year: 2097, month: 1, followers: 100, reach: 200, engagement: 20 }]);
          const s2 = await st.saveSocialMediaStats({ upload_id: `rt55-parity-b-${stamp55}`, source: 'UPLOAD', file_name: 'parity-b.xlsx', uploaded_by: 'RT55', period_from: '2097-01', period_to: '2097-02' },
            [{ platform: 'Instagram', year: 2097, month: 1, followers: 110, reach: 200, engagement: 20 }, { platform: 'TikTok', year: 2097, month: 2, followers: 5, reach: 0, engagement: 0 }]);
          out.saves = [s1, s2].map(x => [x.inserted, x.updated, x.replaced_seed, x.record.total_rows, x.record.source]);
          out.stats = strip(await st.getSocialMediaStats({ from: '2097-01', to: '2097-12' }));
          out.statsSources = (await st.getSocialMediaStats({ from: '2097-01', to: '2097-12' })).map(r => r.upload_id);
          out.latestOk = !!(await st.getLatestSocialMediaPeriod());
          out.uploads = (await st.getSocialMediaUploads()).filter(u => String(u.upload_id).startsWith('rt55-parity-')).map(u => [u.upload_id.replace(stamp55, ''), u.source, u.file_name, u.total_rows, u.inserted_rows, u.updated_rows, u.replaced_seed_rows, u.period_from, u.period_to]);
          out.reseed = await st.topUpSocialMediaSeed([{ platform: 'TikTok', year: 2097, month: 1, followers: 1, reach: 1, engagement: 1 }]);
          return out;
        };
        let jsonOut;
        let sqlOut;
        try {
          const js = require('../server/db/jsonStorage');
          jsonOut = await run(js);
          sqlOut = await run(st55);
        } finally {
          files.forEach((f, i) => { if (saved[i] === null) { if (fs55.existsSync(f)) fs55.unlinkSync(f); } else fs55.writeFileSync(f, saved[i]); });
          await q55("DELETE FROM dbo.px_social_media_stats WHERE stat_year = 2097; DELETE FROM dbo.px_social_media_uploads WHERE upload_id LIKE 'rt55-parity-%'");
        }
        files.forEach((f, i) => assert.ok(saved[i] === null ? !fs55.existsSync(f) : Buffer.compare(fs55.readFileSync(f), saved[i]) === 0, `${path55.basename(f)} restored byte-identically`));
        assert.deepStrictEqual(jsonOut, sqlOut);
        assert.deepStrictEqual(sqlOut.seed, ['2097-01', '2097-02']);
        assert.deepStrictEqual(sqlOut.saves, [[1, 0, 1, 1, 'UPLOAD'], [1, 1, 1, 2, 'UPLOAD']], 'Jan: seed TikTok replaced by Instagram; Feb: seed LinkedIn replaced by TikTok');
        assert.deepStrictEqual(sqlOut.stats.map(r => [r.platform, r.year, r.month, r.followers, r.source]), [['Instagram', 2097, 1, 110, 'UPLOAD'], ['TikTok', 2097, 2, 5, 'UPLOAD']]);
        assert.deepStrictEqual(sqlOut.reseed, [], 'a month with a real row gets no seed');
      });
    } finally {
      try {
        const ids = [...new Set(uploadIds55.filter(Boolean))];
        for (const id of ids) {
          await q55('DELETE FROM dbo.px_social_media_stats WHERE upload_id = @u; DELETE FROM dbo.px_social_media_uploads WHERE upload_id = @u', { u: id });
          const f = path55.join(sm55.SOCIAL_UPLOAD_DIR, `${id}.xlsx`);
          if (fs55.existsSync(f)) fs55.unlinkSync(f);
        }
        // the seed rows this module inserted itself (2099-06 replaced by the upload, 2099-07) - the fixture years were empty before
        if (preExisting55 === 0) await q55("DELETE FROM dbo.px_social_media_stats WHERE stat_year IN (2018, 2097, 2099) AND source = 'SEED'");
      } finally {
        await pool55.close();
      }
      for (const id of userIds55) await adminJson('DELETE', `/api/admin/users/${id}`);
    }
  }
  // --- MODULE 56 (v2.54.0): TIERED SCORE (METRICS 1, 2, 3, 14) + MONTHLY VALUES OF OUTCOME METRICS (TEMPLATE, UPLOAD, EVIDENCE) ---
  // Upload fixtures only go to two metrics this module creates itself (deleted at the end with their monthly values, uploads
  // and original files - the documented metric-delete cascade) and to far-past periods (2003 / 2004); real metrics are only
  // read. SQL Server only (config guard snapshot + in-process JSON parity check with store.json / auth.json restored
  // byte-identically).
  console.log('\n📦 MODULE 56: Tiered score (metrics 1, 2, 3, 14; N/A) & monthly values of OUTCOME metrics - template, upload, evidence, Last update (Positive & Negative Testing)');
  if (require('../server/db/storage').backend !== 'sql') {
    console.log('  ⏭️  SKIPPED: Module 56 needs the SQL Server backend (config guard snapshot and in-process JSON parity check)');
  } else if (!skipModuleBlock(56)) {
    const st56 = require('../server/db/storage');
    const tiers56 = require('../server/db/scoreTiers');
    const engine56 = require('../server/services/calculationEngine');
    const ov56 = require('../server/services/outcomeValueService');
    const { buildXlsx: buildXlsx56, readFirstSheet: readSheet56 } = require('../server/services/xlsxUtils');
    const { MONTH_NAMES: MONTHS56 } = require('../server/services/essSummaryService');
    const fs56 = require('fs');
    const path56 = require('path');
    const stamp56 = Date.now().toString(36);
    const HEAD56 = ['Year', 'Month', 'Value', 'Notes'];
    const xlsx56 = rows => buildXlsx56([HEAD56, ...rows]);
    const metricIds56 = [];
    const userIds56 = [];
    const uploadIds56 = [];
    let userCookie56 = null;
    const postOutcome = async (metricId, buf, fileName = 'module56.xlsx', cookie = null, type = undefined) => {
      const fd = new FormData();
      fd.append('file', new Blob([buf], type ? { type } : undefined), fileName);
      const url = `${BASE_URL}/api/admin/outcome-values/${metricId}/upload`;
      return cookie ? realFetch(url, { method: 'POST', body: fd, headers: { Cookie: cookie } }) : fetch(url, { method: 'POST', body: fd });
    };
    const calcMetric56 = async (q, id) => {
      const r = await fetch(`${BASE_URL}/api/metrics/calculate?${q}`);
      assert.strictEqual(r.status, 200);
      const body = await r.json();
      return { calc: body, m: body.metrics.find(x => x.metric_id === id) };
    };
    const detail56 = async (id, q) => {
      const r = await fetch(`${BASE_URL}/api/metrics/${id}/detail?${q}`);
      assert.strictEqual(r.status, 200);
      return r.json();
    };
    const csvLines56 = text => text.replace(/^﻿/, '').split('\r\n').filter(Boolean);
    const createMetric56 = async body => {
      const r = await adminJson('POST', '/api/admin/metrics', { journey_id: 3, checkpoint_id: 8, metric_type: 'OUTCOME', is_employee_metric: true, ...body });
      const b = await r.json();
      assert.strictEqual(r.status, 201, JSON.stringify(b).slice(0, 300));
      metricIds56.push(b.metric.metric_id);
      return b.metric;
    };
    try {
      const B14 = [{ min: 4000, op: '>=' }, { min: 5000, op: '>=' }, { min: 6000, op: '>=' }, { min: 7500, op: '>=' }];
      const B1 = [{ min: 1, op: '>' }, { min: 2, op: '>' }, { min: 2.5, op: '>' }, { min: 3.5, op: '>' }];
      const B3 = [{ min: 30, op: '>=' }, { min: 45, op: '>=' }, { min: 60, op: '>=' }, { min: 75, op: '>' }];
      const checkTiers = (bounds, cases) => cases.forEach(([v, tier, pct]) => {
        const t = tiers56.tieredScore(v, bounds);
        assert.strictEqual(t.tier, tier, `${v}: tier ${t.tier}`);
        assert.ok(Math.abs(t.percent - pct) < 0.001, `${v}: ${t.percent} vs ${pct}`);
        assert.ok(Math.abs(engine56.normalizeScore({ scale_type: 'QUOTA_COUNT', score_tiers: JSON.stringify({ unit: 'number', bounds }), target_value: 1 }, v) - pct) < 0.001, `${v} via normalizeScore`);
      });

      await runTest('[POSITIVE] Tier function, metric 14 bounds (all >=): 0 / 3000 / 3999 / 4000 / 4999 / 5000 / 5999 / 6000 / 6400 / 7499 / 7500 / 9000 / negative -> right tier and % (v2.54.1 interpolation: tier 1 proportional to the tier-2 bound, tier t = t + share of the way to the next bound, tier 5 = 100%, floor 0)', async () => {
        checkTiers(B14, [[0, 1, 0], [3000, 1, 15], [3999, 1, 19.995], [4000, 2, 40], [4999, 2, 59.98], [5000, 3, 60], [5999, 3, 79.98], [6000, 4, 80],
          [6400, 4, 85.3333], [7499, 4, 99.9867], [7500, 5, 100], [9000, 5, 100], [-50, 1, 0]]);
        const capped = engine56.tierInfo({ score_tiers: { unit: 'number', bounds: B14 } }, 9000);
        assert.deepStrictEqual([capped.tier, capped.score, capped.score_uncapped, capped.percent, capped.capped], [5, 5, 5, 100, false]);
        const t6400 = engine56.tierInfo({ score_tiers: { unit: 'number', bounds: B14 } }, 6400);
        assert.deepStrictEqual([t6400.tier, t6400.lower_bound, t6400.score, t6400.percent, t6400.unit], [4, 6000, 4.27, 85.33, 'number']);
        assert.strictEqual(engine56.tierInfo({ score_tiers: null }, 6400), null, 'a metric without tiers has no tier info');
        assert.strictEqual(engine56.tierInfo({ score_tiers: { unit: 'number', bounds: null } }, 6400), null, 'tiers not configured: no tier info');
      });

      await runTest('[POSITIVE] Per-boundary > vs >=: metric 1 (all ">": 1 -> tier 1, 1.0001 -> tier 2, 2 -> tier 2, 2.5 -> tier 3, 2.6 / 3.5 -> tier 4, 3.51 -> tier 5; 0.66 -> 13.2%) and metric 3 (">=" 30/45/60, ">" 75: 29.99 -> 1, 30 -> 2, 60 -> 4, 75 -> 4, 75.04 -> 5 capped)', async () => {
        checkTiers(B1, [[0.66, 1, 13.2], [1, 1, 20], [1.0001, 2, 40.002], [2, 2, 60], [2.0001, 3, 60.004], [2.5, 3, 80], [2.6, 4, 82], [3.5, 4, 100], [3.51, 5, 100]]);
        checkTiers(B3, [[29.99, 1, 19.9933], [30, 2, 40], [44.99, 2, 59.9867], [45, 3, 60], [60, 4, 80], [70, 4, 93.3333], [75, 4, 100], [75.04, 5, 100]]);
        // v2.54.1: never lower for a higher value (the v2.54.0 rule dropped from 80% at 2.00% to 60.3% at 2.01%)
        for (const bounds of [B14, B1, B3]) {
          let prev = -1;
          for (let i = 0; i <= 400; i++) {
            const v = bounds[3].min * 1.2 * i / 400;
            const pct = tiers56.tieredScore(v, bounds).percent;
            assert.ok(pct >= prev - 1e-9, `monotonic: ${v} -> ${pct} < ${prev}`);
            prev = pct;
          }
        }
        // the same value on a >= boundary and on a > boundary lands in different tiers
        assert.strictEqual(tiers56.tieredScore(2, [{ min: 1, op: '>' }, { min: 2, op: '>=' }, { min: 3, op: '>' }, { min: 4, op: '>' }]).tier, 3);
        assert.strictEqual(tiers56.tieredScore(2, [{ min: 1, op: '>' }, { min: 2, op: '>' }, { min: 3, op: '>' }, { min: 4, op: '>' }]).tier, 2);
      });

      await runTest('[POSITIVE] Target normalization uses the same tiers (14: 5000 -> 60%, 1: 2% -> 60%, 3: 70% -> 93.33%); tiers not configured -> null (N/A); a metric without tiers keeps its scale rule', async () => {
        const norm = (bounds, target) => engine56.normalizeTarget({ scale_type: 'PERCENTAGE', score_tiers: { unit: 'number', bounds } }, { target_value: target, min_threshold: 75 });
        assert.strictEqual(norm(B14, 5000), 60);
        assert.strictEqual(norm(B1, 2), 60);
        assert.ok(Math.abs(norm(B3, 70) - 93.3333) < 0.001);
        assert.strictEqual(norm(null, 4), null);
        assert.strictEqual(engine56.normalizeScore({ scale_type: 'QUOTA_COUNT', score_tiers: null, target_value: 5000 }, 2500), 50);
      });

      await runTest('[NEGATIVE] Tier configuration validation: not 4 bounds, not strictly increasing, zero / negative / text, unknown operator or unit, bad JSON -> refused; a stored invalid value reads as null', async () => {
        const bad = [
          { unit: 'number', bounds: B14.slice(0, 3) },
          { unit: 'number', bounds: [...B14, { min: 9000, op: '>=' }] },
          { unit: 'number', bounds: [{ min: 4000, op: '>=' }, { min: 4000, op: '>' }, { min: 6000, op: '>=' }, { min: 7500, op: '>=' }] },
          { unit: 'number', bounds: [...B14].reverse() },
          { unit: 'number', bounds: [{ min: 0, op: '>=' }, ...B14.slice(1)] },
          { unit: 'number', bounds: [{ min: -1, op: '>=' }, ...B14.slice(1)] },
          { unit: 'number', bounds: [{ min: 'abc', op: '>=' }, ...B14.slice(1)] },
          { unit: 'number', bounds: [{ min: 4000, op: '=>' }, ...B14.slice(1)] },
          { unit: 'number', bounds: [{ min: 4000, op: '<' }, ...B14.slice(1)] },
          { unit: 'euro', bounds: B14 },
          '{not json', 42
        ];
        bad.forEach(b => {
          assert.throws(() => tiers56.parseTierConfig(b), Error, JSON.stringify(b));
          assert.strictEqual(tiers56.readTierConfig(b), null);
        });
        assert.deepStrictEqual(tiers56.parseTierConfig('{"unit":"percent","bounds":[{"min":1,"op":">"},{"min":2,"op":">"},{"min":2.5,"op":">"},{"min":3.5,"op":">"}]}'), { unit: 'percent', bounds: B1 });
        assert.deepStrictEqual(tiers56.parseTierConfig([4000, 5000, 6000, 7500]), { unit: 'number', bounds: B14 }, 'a plain array = number, >=');
        assert.deepStrictEqual(tiers56.parseTierConfig({ unit: 'percent', bounds: null }), { unit: 'percent', bounds: null }, 'not configured');
        assert.strictEqual(tiers56.parseTierConfig(''), null);
        assert.deepStrictEqual(tiers56.resolveTierConfig(null, { unit: 'number', bounds: B14 }), { unit: 'number', bounds: B14 }, 'null / undefined keep the stored configuration');
      });

      await runTest('[POSITIVE] Live configuration: metric 14 = 6,400 people -> tier 4 -> 4.27 / 5 = 85.33% (target 60%); metric 1 = the stored Sept 2026 value through its tiers (target 2% -> 60%); metric 3 = 75.04% (Sept 2026) -> 100% capped (target 70% -> 93.33%); detail agrees', async () => {
        const { calc } = await calcMetric56('mode=YTD&year=2026', 14);
        const byId = id => calc.metrics.find(x => x.metric_id === id);
        const m14 = byId(14);
        assert.strictEqual(m14.scale_type, 'QUOTA_COUNT', 'native scale kept');
        assert.deepStrictEqual(m14.score_tiers, { unit: 'number', bounds: B14 });
        assert.strictEqual((await st56.getMetricById(14)).raw_value, 6400, 'the approved live default of metric 14');
        if (m14.value_basis === 'STATIC_SNAPSHOT') assert.deepStrictEqual([m14.raw_value, m14.normalized_score, m14.tier_info.tier, m14.tier_info.score], [6400, 85.33, 4, 4.27]);
        assert.strictEqual(m14.target_value_normalized, 60);
        const m1 = byId(1);
        assert.deepStrictEqual(m1.score_tiers, { unit: 'percent', bounds: B1 });
        // the live 2026 values may be updated by the Admin (0.66% at v2.54.0, 3.19% since 2026-10-22, a whole year by upload):
        // expect what is stored. v2.55.0: metric 1 = the AVERAGE of its 2026 months up to this month
        const nowKey56 = new Date().getFullYear() * 100 + new Date().getMonth() + 1;
        const m1Rows = (await st56.getOutcomeValues(1)).filter(r => r.year === 2026 && 2026 * 100 + r.month <= nowKey56);
        const m1Avg = m1Rows.reduce((s, r) => s + Number(r.value), 0) / m1Rows.length;
        const m1Pct = Math.round(tiers56.tieredScore(m1Avg, B1).percent * 100) / 100;
        const m1Status = m1Pct < m1.min_threshold ? 'CRITICAL' : (m1Pct < 60 ? 'WARNING' : 'HEALTHY');
        const m1Last = m1Rows[m1Rows.length - 1];
        assert.deepStrictEqual([m1.raw_value, m1.normalized_score, m1.outcome_period, m1.outcome_aggregation, m1.outcome_months_count, m1.target_value, m1.target_value_normalized, m1.status],
          [parseFloat(m1Avg.toFixed(2)), m1Pct, `2026-${String(m1Last.month).padStart(2, '0')}`, 'AVERAGE', m1Rows.length, 2, 60, m1Status]);
        const m3 = byId(3);
        assert.deepStrictEqual(m3.score_tiers, { unit: 'percent', bounds: B3 });
        // v2.55.0: metric 3 = the AVERAGE of its 2026 months too (75.04% Sept 2026 at v2.54.0; a whole year once uploaded)
        const m3Rows = (await st56.getOutcomeValues(3)).filter(r => r.year === 2026 && 2026 * 100 + r.month <= nowKey56);
        const m3Avg = m3Rows.reduce((s, r) => s + Number(r.value), 0) / m3Rows.length;
        const m3t = tiers56.tieredScore(m3Avg, B3);
        assert.deepStrictEqual([m3.raw_value, m3.normalized_score, m3.tier_info.tier, m3.tier_info.capped, m3.target_value, m3.target_value_normalized, m3.outcome_aggregation],
          [parseFloat(m3Avg.toFixed(2)), Math.round(m3t.percent * 100) / 100, m3t.tier, false, 70, 93.33, 'AVERAGE']);
        for (const m of [m1, m3, m14]) {
          const expected = m.normalized_score < m.min_threshold ? 'CRITICAL' : (m.normalized_score < m.target_value_normalized ? 'WARNING' : 'HEALTHY');
          assert.strictEqual(m.status, expected, `metric ${m.metric_id}`);
          const d = await detail56(m.metric_id, 'mode=YTD&year=2026');
          assert.deepStrictEqual([parseFloat(Number(d.current_raw_value).toFixed(2)), d.normalized_score, d.status, d.target_value_normalized], [m.raw_value, m.normalized_score, m.status, m.target_value_normalized], `detail ${m.metric_id}`);
          assert.deepStrictEqual(d.tier_info, m.tier_info);
        }
        const aug = (await calcMetric56('mode=MTD&year=2026&month=08', 1)).calc;
        const augRows = (await st56.getOutcomeValues()).filter(r => r.year === 2026 && r.month === 8);
        for (const id of [1, 3]) {
          const augRow = augRows.find(r => r.metric_id === id);
          const am = aug.metrics.find(x => x.metric_id === id);
          if (augRow) assert.strictEqual(am.raw_value, parseFloat(Number(augRow.value).toFixed(2)), `metric ${id}: MTD = that month's value`);
          else assert.strictEqual(am.status, 'NO_DATA', `metric ${id}: a month without an uploaded value is NO_DATA (agreed rule)`);
        }
        const s = await (await fetch(`${BASE_URL}/api/settings`)).json();
        assert.ok(!s.scale_types.some(o => o.value === 'TIERED_COUNT'), 'tiers are a per-metric configuration, not a scale type');
      });

      await runTest('[POSITIVE] Metric 2 (tiers not configured) is N/A: no value / score, status NO_DATA + not_applicable, target N/A, not in the Survey Index, its journey rollup, alerts, trend or the detail; the PX Index ignores it', async () => {
        const { calc, m } = await calcMetric56('mode=YTD&year=2026', 2);
        assert.deepStrictEqual(m.score_tiers, { unit: 'number', bounds: null });
        assert.deepStrictEqual([m.has_data, m.not_applicable, m.status, m.raw_value, m.normalized_score, m.target_value_normalized, m.tier_info], [false, true, 'NO_DATA', null, null, null, null]);
        const surveys = calc.metrics.filter(x => x.metric_type === 'SURVEY' && x.has_data);
        assert.ok(!surveys.some(x => x.metric_id === 2));
        const expected = surveys.reduce((a, x) => a + x.normalized_score * x.weight, 0) / surveys.reduce((a, x) => a + x.weight, 0);
        assert.ok(Math.abs(calc.survey_index - expected) < 0.01, 'Survey Index without metric 2');
        const j = calc.journeys.find(x => x.journey_id === m.journey_id);
        assert.ok(j.no_data_count >= 1 && !j.metrics.filter(x => x.has_data).some(x => x.metric_id === 2));
        const d = await detail56(2, 'mode=YTD&year=2026');
        assert.deepStrictEqual([d.has_data, d.not_applicable, d.status, d.current_raw_value, d.normalized_score, d.target_value_normalized], [false, true, 'NO_DATA', null, null, null]);
        assert.ok(d.questions.filter(q => q.type !== 'FREE_TEXT').every(q => q.avg_score === null), 'no question score either');
        const alerts = await (await fetch(`${BASE_URL}/api/alerts`)).json();
        const list = Array.isArray(alerts) ? alerts : (alerts.alerts || []);
        assert.ok(!list.some(a => a.metric_id === 2), 'no alert for an N/A metric');
        const params = await (await fetch(`${BASE_URL}/api/admin/parameters`)).json();
        assert.strictEqual(params.metrics.find(x => x.metric_id === 2).target_value_normalized, null);
      });

      let tiered56 = null;
      await runTest('[POSITIVE] Admin creates a tier-scored metric and edits its tiers (unit, bounds, >= / >, N/A): stored, exposed by parameters / calculate, the score follows; N/A takes it out of the index; the config snapshot covers px_metrics.score_tiers; audited', async () => {
        tiered56 = await createMetric56({ metric_name: `RT56 Tiered ${stamp56}`, scale_type: 'QUOTA_COUNT', target_value: 20, min_threshold: 50, raw_value: 25, unit: 'pax',
          score_tiers: { unit: 'number', bounds: [{ min: 10, op: '>=' }, { min: 20, op: '>=' }, { min: 30, op: '>=' }, { min: 40, op: '>=' }] } });
        assert.deepStrictEqual(tiered56.score_tiers.bounds.map(b => b.min), [10, 20, 30, 40]);
        let { m } = await calcMetric56('mode=YTD', tiered56.metric_id);
        assert.deepStrictEqual([m.raw_value, m.normalized_score, m.tier_info.tier, m.target_value_normalized, m.status], [25, 70, 3, 60, 'HEALTHY']);
        const cfg2 = { unit: 'percent', bounds: [{ min: 5, op: '>' }, { min: 10, op: '>' }, { min: 25, op: '>' }, { min: 50, op: '>' }] };
        assert.strictEqual((await adminJson('PUT', `/api/admin/metrics/${tiered56.metric_id}`, { score_tiers: cfg2 })).status, 200);
        const params = await (await fetch(`${BASE_URL}/api/admin/parameters`)).json();
        assert.deepStrictEqual(params.metrics.find(x => x.metric_id === tiered56.metric_id).score_tiers, cfg2);
        ({ m } = await calcMetric56('mode=YTD', tiered56.metric_id));
        assert.deepStrictEqual([m.tier_info.tier, m.normalized_score, m.tier_info.capped], [3, 80, false], '25 is not > 25 -> tier 3 (10..25) -> 3 + 15/15 = 4 -> 80%');
        const snap = await st56.snapshotConfiguration();
        const t = snap.tables.px_metrics;
        assert.ok(t.columns.includes('score_tiers'), 'px_metrics.score_tiers is in the configuration snapshot');
        const row = t.rows.find(r => r[t.columns.indexOf('metric_id')] === tiered56.metric_id);
        assert.deepStrictEqual(JSON.parse(row[t.columns.indexOf('score_tiers')]), cfg2);
        const audit = await st56.getAuditLog(20, { includeTest: true });
        assert.ok(audit.some(a => a.action === 'METRIC_UPDATE' && String(a.target).startsWith(`#${tiered56.metric_id}:`) && /score_tiers/.test(a.target)), 'the tier change is audited');
        // N/A: tiers not configured -> out of the index
        assert.strictEqual((await adminJson('PUT', `/api/admin/metrics/${tiered56.metric_id}`, { score_tiers: { unit: 'percent', bounds: null } })).status, 200);
        const na = await calcMetric56('mode=YTD', tiered56.metric_id);
        assert.deepStrictEqual([na.m.has_data, na.m.not_applicable, na.m.status, na.m.raw_value], [false, true, 'NO_DATA', null]);
        const outcomes = na.calc.metrics.filter(x => x.metric_type === 'OUTCOME' && x.has_data);
        const expected = outcomes.reduce((a, x) => a + x.normalized_score * x.weight, 0) / outcomes.reduce((a, x) => a + x.weight, 0);
        assert.ok(Math.abs(na.calc.outcome_index - expected) < 0.01 && !outcomes.some(x => x.metric_id === tiered56.metric_id));
        assert.strictEqual((await adminJson('PUT', `/api/admin/metrics/${tiered56.metric_id}`, { score_tiers: cfg2 })).status, 200);
      });

      await runTest('[NEGATIVE] Tier validation through the Admin API: 3 bounds, decreasing, zero, text, bad operator, bad unit -> 400 and nothing changes; sending no / null tiers keeps them', async () => {
        const before = (await st56.getMetricById(tiered56.metric_id)).score_tiers;
        const bounds = n => [{ min: 5, op: '>' }, { min: 10, op: '>' }, { min: 25, op: '>' }, { min: 50, op: '>' }].slice(0, n);
        for (const bad of [{ unit: 'number', bounds: bounds(3) }, { unit: 'number', bounds: [...bounds(4)].reverse() }, { unit: 'number', bounds: [{ min: 0, op: '>' }, ...bounds(4).slice(1)] },
          { unit: 'number', bounds: [{ min: 'x', op: '>' }, ...bounds(4).slice(1)] }, { unit: 'number', bounds: [{ min: 5, op: '=' }, ...bounds(4).slice(1)] }, { unit: 'kg', bounds: bounds(4) }, 'garbage']) {
          const r = await adminJson('PUT', `/api/admin/metrics/${tiered56.metric_id}`, { score_tiers: bad });
          assert.strictEqual(r.status, 400, JSON.stringify(bad));
        }
        const noTiers = await adminJson('POST', '/api/admin/metrics', { metric_name: `RT56 bad ${stamp56}`, metric_type: 'OUTCOME', scale_type: 'PERCENTAGE', target_value: 10, raw_value: 1, score_tiers: { unit: 'x', bounds: null } });
        assert.strictEqual(noTiers.status, 400);
        assert.ok(!(await st56.getMetrics()).some(x => x.metric_name === `RT56 bad ${stamp56}`), 'no metric created');
        assert.strictEqual((await adminJson('PUT', `/api/admin/metrics/${tiered56.metric_id}`, { metric_name: `RT56 Tiered ${stamp56} b`, score_tiers: null })).status, 200);
        assert.deepStrictEqual((await st56.getMetricById(tiered56.metric_id)).score_tiers, before, 'tiers unchanged');
      });

      let om56 = null;
      let legacy56 = null;
      await runTest('[POSITIVE] Template (.xlsx) of an OUTCOME metric: title with the metric name and unit, header Year | Month | Value | Notes and the last complete month prefilled; metric 1 -> 200 (its value), metric 11 / SURVEY -> 400, unknown -> 404, malformed -> 400', async () => {
        om56 = await createMetric56({ metric_name: `RT56 Outcome ${stamp56}`, scale_type: 'PERCENTAGE', target_value: 80, min_threshold: 70, raw_value: 50, unit: '%' });
        legacy56 = await createMetric56({ metric_name: `RT56 Legacy ${stamp56}`, scale_type: 'PERCENTAGE', target_value: 80, min_threshold: 70, raw_value: 55, unit: '%', last_data_date: '2004-05-10' });
        assert.strictEqual((await adminJson('PUT', `/api/admin/metrics/${legacy56.metric_id}`, { last_data_date: '2004-05-10' })).status, 200);
        const r = await fetch(`${BASE_URL}/api/admin/outcome-values/${om56.metric_id}/template`);
        assert.strictEqual(r.status, 200);
        assert.ok(/spreadsheetml/.test(r.headers.get('content-type')));
        assert.ok(new RegExp(`Template_Outcome_Metric_${om56.metric_id}\\.xlsx`).test(r.headers.get('content-disposition')));
        const rows = await readSheet56(Buffer.from(await r.arrayBuffer()));
        assert.ok(String(rows[0].cells[0].value).includes(om56.metric_name));
        assert.ok(/Value unit: %/.test(String(rows[1].cells[0].value)));
        assert.deepStrictEqual(rows[2].cells.map(c => c.value), HEAD56);
        const now = new Date();
        const y = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
        const mo = now.getMonth() === 0 ? 12 : now.getMonth();
        assert.deepStrictEqual(rows[3].cells.filter(c => c && c.type !== 'empty').map(c => c.value), [y, MONTHS56[mo - 1]]);
        const v = ov56.validateOutcomeSheet(rows);
        assert.ok(v.errors.length === 1 && /Value is empty/.test(v.errors[0].reason), JSON.stringify(v.errors));
        for (const [id, status] of [[1, 200], [11, 400], [2, 400], [999999, 404], ['abc', 400]]) {
          assert.strictEqual((await fetch(`${BASE_URL}/api/admin/outcome-values/${id}/template`)).status, status, `template ${id}`);
        }
        assert.strictEqual((await postOutcome(11, await xlsx56([[2003, 1, 10]]))).status, 400, 'metric 11 is computed from attendance');
      });

      let firstUpload56 = null;
      await runTest('[POSITIVE] Admin uploads valid monthly values (month names EN/ID, "70,5" decimal comma, notes): 200 with counts + periods, original kept + downloadable (nosniff), history entry, audit OUTCOME_UPLOAD (test-run row)', async () => {
        const res = await postOutcome(om56.metric_id, await xlsx56([
          ['2003', 'January', '40', ''],
          [2003, 'Maret', 60, '=HYPERLINK("http://x")'],
          [2003, 7, '70,5', 'mid-year figure']
        ]), 'module56_valid.xlsx');
        const body = await res.json();
        assert.strictEqual(res.status, 200, JSON.stringify(body).slice(0, 400));
        uploadIds56.push(body.upload_id);
        firstUpload56 = body;
        assert.deepStrictEqual([body.rows_imported, body.inserted_rows, body.updated_rows, body.metric_id], [3, 3, 0, om56.metric_id]);
        assert.deepStrictEqual(body.periods, ['2003-01', '2003-03', '2003-07']);
        assert.deepStrictEqual(body.period_labels, ['January 2003', 'March 2003', 'July 2003']);
        assert.ok(fs56.existsSync(path56.join(ov56.OUTCOME_UPLOAD_DIR, `${body.upload_id}.xlsx`)), 'original kept (non-public folder)');
        const hist = await (await fetch(`${BASE_URL}/api/admin/outcome-values/${om56.metric_id}/uploads`)).json();
        const h = hist.find(u => u.upload_id === body.upload_id);
        assert.ok(h && h.file_name === 'module56_valid.xlsx' && h.has_original_file && h.period_from === '2003-01' && h.period_to === '2003-07' && h.metric_id === om56.metric_id);
        const file = await fetch(`${BASE_URL}/api/admin/outcome-values/uploads/${body.upload_id}/file`);
        assert.strictEqual(file.status, 200);
        assert.strictEqual(file.headers.get('x-content-type-options'), 'nosniff');
        assert.ok(/attachment; filename="module56_valid\.xlsx"/.test(file.headers.get('content-disposition')));
        assert.strictEqual((await fetch(`${BASE_URL}/api/admin/outcome-values/uploads/not-there/file`)).status, 404);
        const stored = await st56.getOutcomeValues(om56.metric_id);
        assert.deepStrictEqual(stored.map(r => [r.year, r.month, r.value, r.source]), [[2003, 1, 40, 'UPLOAD'], [2003, 3, 60, 'UPLOAD'], [2003, 7, 70.5, 'UPLOAD']]);
        const audit = await st56.getAuditLog(30, { includeTest: true });
        const a = audit.find(x => x.action === 'OUTCOME_UPLOAD' && String(x.target).includes(body.upload_id));
        assert.ok(a && a.is_test === true && new RegExp(`metric ${om56.metric_id}; 3 months \\(3 new, 0 updated\\); 2003-01 2003-03 2003-07`).test(a.target), JSON.stringify(a));
      });

      await runTest('[POSITIVE] Scoring: YTD 2003 = latest uploaded month (July 70.5), MTD 2003-03 = that month (60), MTD 2003-02 and YTD 2004 = NO_DATA (out of the index); detail agrees; Last update = July 2003', async () => {
        let { m, calc } = await calcMetric56('mode=YTD&year=2003', om56.metric_id);
        assert.deepStrictEqual([m.raw_value, m.normalized_score, m.has_data, m.value_basis, m.outcome_period, m.outcome_period_label, m.outcome_value_source],
          [70.5, 70.5, true, 'MONTHLY_VALUES', '2003-07', 'July 2003', 'UPLOAD']);
        assert.deepStrictEqual(m.period_window, { from: '2003-01-01', to: '2003-12-31', basis: 'LATEST_MONTH' });
        assert.deepStrictEqual([m.last_update_period, m.last_update_label], ['2003-07', 'July 2003']);
        ({ m } = await calcMetric56('mode=MTD&year=2003&month=03', om56.metric_id));
        assert.deepStrictEqual([m.raw_value, m.status, m.outcome_period], [60, 'CRITICAL', '2003-03'], '60% < min 70 -> CRITICAL');
        ({ m, calc } = await calcMetric56('mode=MTD&year=2003&month=02', om56.metric_id));
        assert.deepStrictEqual([m.has_data, m.status, m.raw_value, m.normalized_score, m.outcome_period], [false, 'NO_DATA', null, null, null]);
        const others = calc.metrics.filter(x => x.metric_type === 'OUTCOME' && x.has_data);
        const expected = others.reduce((s, x) => s + x.normalized_score * x.weight, 0) / others.reduce((s, x) => s + x.weight, 0);
        assert.ok(Math.abs(calc.outcome_index - expected) < 0.01, 'the NO_DATA metric is left out of the Outcome Index');
        ({ m } = await calcMetric56('mode=YTD&year=2004', om56.metric_id));
        assert.strictEqual(m.status, 'NO_DATA', 'uploads exist but none inside 2004');
        const d = await detail56(om56.metric_id, 'mode=MTD&year=2003&month=03');
        assert.deepStrictEqual([d.current_raw_value, d.normalized_score, d.status, d.outcome_period_label, d.last_update_label], [60, 60, 'CRITICAL', 'March 2003', 'July 2003']);
        const dNo = await detail56(om56.metric_id, 'mode=MTD&year=2003&month=02');
        assert.deepStrictEqual([dNo.has_data, dNo.status, dNo.current_raw_value, dNo.normalized_score], [false, 'NO_DATA', null, null]);
        // directorate filter: bankwide, same value
        const directory56 = await (await rawFetch(`${BASE_URL}/api/directorates`)).json();
        const byDir = await calcMetric56(`mode=MTD&year=2003&month=03&directorate=${encodeURIComponent(directory56[0].directorate_name)}`, om56.metric_id);
        assert.strictEqual(byDir.m.raw_value, 60, 'a directorate filter does not change an OUTCOME value');
      });

      await runTest('[POSITIVE] Trend chart and PX Index by directorate use the same rule: MTD trend points of 2003 equal calculate MTD of that month (the metric is NO_DATA in February)', async () => {
        const t = await (await fetch(`${BASE_URL}/api/metrics/trends?mode=MTD&year=2003&startYear=2003&startMonth=02&endYear=2003&endMonth=03`)).json();
        const feb = t.trends.find(p => p.month_code === '2003-02');
        const mar = t.trends.find(p => p.month_code === '2003-03');
        assert.strictEqual(feb.outcome_index, (await calcMetric56('mode=MTD&year=2003&month=02', om56.metric_id)).calc.outcome_index);
        assert.strictEqual(mar.outcome_index, (await calcMetric56('mode=MTD&year=2003&month=03', om56.metric_id)).calc.outcome_index);
        assert.notStrictEqual(feb.outcome_index, mar.outcome_index);
        const byDir = await (await fetch(`${BASE_URL}/api/metrics/by-directorate?mode=MTD&year=2003&month=03`)).json();
        assert.ok(Array.isArray(byDir.directorates) && byDir.directorates.length > 0);
      });

      await runTest('[POSITIVE] Upsert: uploading July 2003 again UPDATES it (0 new, 1 updated) and the current month is accepted; YTD 2003 follows (72)', async () => {
        const now = new Date();
        const res = await postOutcome(om56.metric_id, await xlsx56([[2003, 'Jul', 72, 'revised'], [now.getFullYear(), now.getMonth() + 1, 10, 'current month']]), 'module56_upsert.xlsx');
        const body = await res.json();
        assert.strictEqual(res.status, 200, JSON.stringify(body).slice(0, 300));
        uploadIds56.push(body.upload_id);
        assert.deepStrictEqual([body.inserted_rows, body.updated_rows], [1, 1]);
        const { m } = await calcMetric56('mode=YTD&year=2003', om56.metric_id);
        assert.strictEqual(m.raw_value, 72);
        assert.strictEqual((await st56.getOutcomeValues(om56.metric_id)).length, 4, 'no duplicate month');
        const cur = await calcMetric56('mode=YTD', om56.metric_id);
        assert.strictEqual(cur.m.last_update_label, `${MONTHS56[now.getMonth()]} ${now.getFullYear()}`);
      });

      await runTest('[NEGATIVE] Invalid file refused as a whole with every error listed (bad year, unknown month, text value, negative, duplicate month, future month, notes too long) - nothing stored', async () => {
        const now = new Date();
        const fy = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
        const fm = now.getMonth() === 11 ? 1 : now.getMonth() + 2;
        const before = await st56.getOutcomeValues(om56.metric_id);
        const res = await postOutcome(om56.metric_id, await xlsx56([
          [1999, 'January', 10],
          [2004, 'Foo', 10],
          [2004, 2, 'abc'],
          [2004, 3, -5],
          [2004, 4, 10],
          [2004, 'April', 11],
          [fy, fm, 10],
          [2004, 5, 10, 'x'.repeat(501)]
        ]), 'module56_bad.xlsx');
        const body = await res.json();
        assert.strictEqual(res.status, 400);
        const reasons = body.errors.map(e => `${e.row_number}|${e.column}|${e.reason}`).join('\n');
        assert.ok(/^2\|A\|Year must be a 4-digit year/m.test(reasons), reasons);
        assert.ok(/^3\|B\|Month must be a month name/m.test(reasons), reasons);
        assert.ok(/^4\|C\|Value must be a number/m.test(reasons), reasons);
        assert.ok(/^5\|C\|Value must not be negative/m.test(reasons), reasons);
        assert.ok(/^7\|B\|April 2004 appears more than once \(rows 6 and 7\)/m.test(reasons), reasons);
        assert.ok(new RegExp(`^8\\|B\\|${MONTHS56[fm - 1]} ${fy} is in the future`, 'm').test(reasons), reasons);
        assert.ok(/^9\|D\|Notes must be at most 500 characters/m.test(reasons), reasons);
        assert.strictEqual(body.errors.length, 7);
        assert.deepStrictEqual(await st56.getOutcomeValues(om56.metric_id), before, 'nothing stored');
        const noHeader = await postOutcome(om56.metric_id, await buildXlsx56([['Something', 'Else'], [1, 2]]));
        assert.strictEqual(noHeader.status, 400);
        assert.ok(/No header row found/.test((await noHeader.json()).errors[0].reason));
        const notXlsx = await postOutcome(om56.metric_id, Buffer.from('not a zip at all'), 'fake.xlsx');
        assert.strictEqual(notXlsx.status, 400);
      });

      await runTest('[NEGATIVE] Wrong file type -> 415 (.csv, .xls, .xlsx sent as text/plain), too large -> 413, no file -> 400; nothing stored', async () => {
        const before = (await st56.getOutcomeValues(om56.metric_id)).length;
        assert.strictEqual((await postOutcome(om56.metric_id, Buffer.from('Year,Month,Value\n2003,1,1'), 'values.csv', null, 'text/csv')).status, 415);
        assert.strictEqual((await postOutcome(om56.metric_id, await xlsx56([[2003, 2, 5]]), 'values.xls', null, 'application/vnd.ms-excel')).status, 415);
        assert.strictEqual((await postOutcome(om56.metric_id, await xlsx56([[2003, 2, 5]]), 'values.xlsx', null, 'text/plain')).status, 415);
        assert.strictEqual((await postOutcome(om56.metric_id, Buffer.alloc(5 * 1024 * 1024 + 100), 'big.xlsx')).status, 413);
        assert.strictEqual((await fetch(`${BASE_URL}/api/admin/outcome-values/${om56.metric_id}/upload`, { method: 'POST', body: new FormData() })).status, 400);
        assert.strictEqual((await st56.getOutcomeValues(om56.metric_id)).length, before);
      });

      await runTest('[NEGATIVE] A USER gets 403 and a request without login 401 on template / upload / history / evidence; the USER calculate payload still has the Last update', async () => {
        const directory56 = await (await rawFetch(`${BASE_URL}/api/directorates`)).json();
        const username = `rt56u${stamp56}`;
        const created = await adminJson('POST', '/api/admin/users', { username, full_name: 'Regression Outcome User', email: `${username}@example.test`, role: 'USER', scopes: [{ directorate: directory56[0].directorate_name, divisions: null }] });
        assert.strictEqual(created.status, 201);
        const cb = await created.json();
        userIds56.push(cb.user.user_id);
        const { cookie } = await loginAs(username, cb.temporary_password);
        assert.strictEqual((await rawFetch(`${BASE_URL}/api/auth/change-password`, jsonBody('POST', { current_password: cb.temporary_password, new_password: STRONG }, cookie))).status, 200);
        userCookie56 = cookie;
        const paths = [`/api/admin/outcome-values/${om56.metric_id}/template`, `/api/admin/outcome-values/${om56.metric_id}/uploads`,
          `/api/admin/outcome-evidence/${om56.metric_id}?period=2003`, '/api/admin/outcome-evidence/11?period=ALL', '/api/admin/outcome-evidence/1?period=ALL',
          `/api/admin/outcome-values/uploads/${firstUpload56.upload_id}/file`];
        for (const p of paths) {
          assert.strictEqual((await rawFetch(`${BASE_URL}${p}`, { headers: { Cookie: cookie } })).status, 403, `USER ${p}`);
          assert.strictEqual((await rawFetch(`${BASE_URL}${p}`)).status, 401, `no login ${p}`);
        }
        const before = (await st56.getOutcomeValues(om56.metric_id)).length;
        assert.strictEqual((await postOutcome(om56.metric_id, await xlsx56([[2003, 2, 5]]), 'user.xlsx', cookie)).status, 403);
        const fd = new FormData();
        fd.append('file', new Blob([await xlsx56([[2003, 2, 5]])]), 'anon.xlsx');
        assert.strictEqual((await rawFetch(`${BASE_URL}/api/admin/outcome-values/${om56.metric_id}/upload`, { method: 'POST', body: fd })).status, 401);
        assert.strictEqual((await st56.getOutcomeValues(om56.metric_id)).length, before, 'nothing stored');
        const u = await (await rawFetch(`${BASE_URL}/api/metrics/calculate?mode=YTD&year=2003`, { headers: { Cookie: cookie } })).json();
        const um = u.metrics.find(x => x.metric_id === om56.metric_id);
        assert.deepStrictEqual([um.raw_value, um.last_update_label !== null], [72, true], 'the USER sees the same bankwide OUTCOME value');
      });

      await runTest('[POSITIVE] Evidence CSV of the stored months: period filter, Used_In_Score marks the month the period is scored with, notes formula-escaped, uploaded_by / uploaded_at filled; invalid period -> 400; SURVEY metric -> 400', async () => {
        const r = await fetch(`${BASE_URL}/api/admin/outcome-evidence/${om56.metric_id}?period=2003`);
        assert.strictEqual(r.status, 200);
        assert.ok(/text\/csv/.test(r.headers.get('content-type')));
        assert.ok(new RegExp(`Evidence_Outcome_Metric_${om56.metric_id}_YTD_2003\\.csv`).test(r.headers.get('content-disposition')));
        const lines = csvLines56(await r.text());
        assert.strictEqual(lines[0], 'Metric_ID,Metric_Name,Unit,Year,Month,Period,Value,Notes,Source,Used_In_Score,Upload_ID,File_Name,Uploaded_By,Uploaded_At,Updated_At');
        assert.strictEqual(lines.length, 4, 'January, March, July 2003');
        assert.ok(lines[1].startsWith(`${om56.metric_id},RT56 Outcome ${stamp56},%,2003,January,2003-01,40,,UPLOAD,NO,${firstUpload56.upload_id},module56_valid.xlsx,Regression Suite Admin (rt-suite-`), lines[1]);
        assert.ok(lines[2].includes(`,2003-03,60,"'=HYPERLINK(""http://x"")",UPLOAD,NO,`), lines[2]);
        assert.ok(lines[3].includes(',2003-07,72,revised,UPLOAD,YES,'), lines[3]);
        assert.ok(/,\d{4}-\d{2}-\d{2}T/.test(lines[3]), 'uploaded_at / updated_at present');
        const mar = csvLines56(await (await fetch(`${BASE_URL}/api/admin/outcome-evidence/${om56.metric_id}?period=2003-03`)).text());
        assert.strictEqual(mar.length, 2);
        assert.ok(mar[1].includes(',UPLOAD,YES,'));
        const all = csvLines56(await (await fetch(`${BASE_URL}/api/admin/outcome-evidence/${om56.metric_id}`)).text());
        assert.strictEqual(all.length, 5, 'ALL = every stored month (incl. the current month)');
        assert.ok(all.slice(1).every(l => l.split(',')[9] === ''), 'no Used_In_Score for ALL');
        for (const bad of ['abc', '2003-13', '20031']) assert.strictEqual((await fetch(`${BASE_URL}/api/admin/outcome-evidence/${om56.metric_id}?period=${bad}`)).status, 400, bad);
        assert.strictEqual((await fetch(`${BASE_URL}/api/admin/outcome-evidence/2`)).status, 400, 'SURVEY metric');
        assert.strictEqual((await fetch(`${BASE_URL}/api/admin/outcome-evidence/999999`)).status, 404);
      });

      await runTest('[POSITIVE] Evidence of metric 1 (social media rows of the period) and metric 11 (event attendances of the period, with identity - Admin only); offered as evidence_type in calculate', async () => {
        const { calc } = await calcMetric56('mode=YTD', 1);
        const byId = id => calc.metrics.find(x => x.metric_id === id);
        // v2.55.0: no data_upload SOCIAL_MEDIA any more (drilldown off); the social media evidence route stays (dormant, Admin API only)
        assert.deepStrictEqual([byId(1).evidence_type, byId(1).outcome_upload, byId(1).data_upload, byId(11).evidence_type, byId(11).outcome_upload, byId(14).evidence_type, byId(2).evidence_type],
          ['OUTCOME_VALUES', true, undefined, 'EVENT_ATTENDANCE', false, 'OUTCOME_VALUES', undefined]);
        const v1 = csvLines56(await (await fetch(`${BASE_URL}/api/admin/outcome-evidence/1?period=2026-09`)).text());
        assert.ok(v1[0].startsWith('Metric_ID,Metric_Name,Unit,Year,Month,Period,Value'), 'metric 1 default evidence = its monthly values');
        for (const [q, status] of [['1?kind=bogus', 400], ['14?kind=social_media', 400], ['14?kind=values', 200]]) {
          assert.strictEqual((await fetch(`${BASE_URL}/api/admin/outcome-evidence/${q}`)).status, status, q);
        }
        const stats = await st56.getSocialMediaStats();
        const latest = stats[stats.length - 1];
        const period = `${latest.year}-${String(latest.month).padStart(2, '0')}`;
        const sm = await fetch(`${BASE_URL}/api/admin/outcome-evidence/1?period=${period}&kind=social_media`);
        assert.strictEqual(sm.status, 200);
        const smLines = csvLines56(await sm.text());
        assert.strictEqual(smLines[0], 'Metric_ID,Metric_Name,Platform,Year,Month,Period,Followers,Reach,Engagement,Source,Upload_ID,File_Name,Uploaded_By,Uploaded_At');
        assert.strictEqual(smLines.length - 1, stats.filter(s => s.year === latest.year && s.month === latest.month).length);
        const att = await fetch(`${BASE_URL}/api/admin/outcome-evidence/11?period=ALL`);
        assert.strictEqual(att.status, 200);
        const attLines = csvLines56(await att.text());
        assert.strictEqual(attLines[0], 'Metric_ID,Metric_Name,Event_ID,Event_Name,Event_Date,NIP,Employee_Name,CIMB_Email,Directorate,Division,Attendance_Timestamp');
        assert.strictEqual(attLines.length - 1, (await st56.getAttendances()).length);
        const empty = csvLines56(await (await fetch(`${BASE_URL}/api/admin/outcome-evidence/11?period=2003`)).text());
        assert.strictEqual(empty.length, 1, 'no attendance in 2003 - header only');
      });

      await runTest('[POSITIVE] Legacy rule: an OUTCOME metric without any uploaded month keeps its static raw_value in every period (STATIC_SNAPSHOT), Last update = last_data_date month; metric 1 / 11 / SURVEY / ESS metrics get a Last update too (metric 1 = its latest value month)', async () => {
        for (const q of ['mode=YTD&year=2003', 'mode=MTD&year=2004&month=02', 'mode=YTD']) {
          const { m } = await calcMetric56(q, legacy56.metric_id);
          assert.deepStrictEqual([m.raw_value, m.has_data, m.value_basis, m.outcome_period, m.period_window], [55, true, 'STATIC_SNAPSHOT', null, null], q);
        }
        const { calc } = await calcMetric56('mode=YTD', legacy56.metric_id);
        const byId = id => calc.metrics.find(x => x.metric_id === id);
        assert.deepStrictEqual([byId(legacy56.metric_id).last_update_period, byId(legacy56.metric_id).last_update_label], ['2004-05', 'May 2004']);
        const ov1 = await st56.getOutcomeValues(1);
        const stats = await st56.getSocialMediaStats();
        // v2.55.0: no fallback to the social media months any more (drilldown off): latest stored month, else last_data_date
        const ld1 = String((await st56.getMetricById(1)).last_data_date || '');
        const latest1 = ov1.length ? ov1.reduce((mx, r) => Math.max(mx, r.year * 100 + r.month), 0) : parseInt(ld1.slice(0, 4), 10) * 100 + parseInt(ld1.slice(5, 7), 10);
        assert.ok(stats.length >= 0);
        assert.strictEqual(byId(1).last_update_period, `${Math.floor(latest1 / 100)}-${String(latest1 % 100).padStart(2, '0')}`, 'metric 1: its latest uploaded value month');
        const atts = await st56.getAttendances();
        const latestAtt = atts.map(a => String(a.attendance_timestamp).slice(0, 7)).sort().pop() || null;
        assert.strictEqual(byId(11).last_update_period, latestAtt);
        const surveyDates = await st56.getLatestSurveyDates();
        const sys = calc.metrics.find(x => x.metric_type === 'SURVEY' && x.survey_source === 'SYSTEM' && surveyDates[x.metric_id]);
        assert.strictEqual(sys.last_update_period, surveyDates[sys.metric_id].slice(0, 7));
        const ess = calc.metrics.find(x => x.survey_source === 'ESS' && x.last_update_period);
        if (ess) {
          const rows = await st56.getEssResults(ess.metric_id);
          const k = rows.reduce((mx, r) => Math.max(mx, r.survey_year * 100 + r.survey_month), 0);
          assert.strictEqual(ess.last_update_period, `${Math.floor(k / 100)}-${String(k % 100).padStart(2, '0')}`);
        }
        const d = await detail56(legacy56.metric_id, 'mode=YTD');
        assert.deepStrictEqual([d.value_basis, d.current_raw_value, d.last_update_label], ['STATIC_SNAPSHOT', 55, 'May 2004']);
      });

      await runTest('[POSITIVE] JSON backend in-process (same contract): save / upsert / read / uploads / latest survey dates give the same results as SQL Server; metrics 14 / 2 get the same tier configuration there; store.json and auth.json restored byte-identically', async () => {
        const dataDir = path56.join(__dirname, '..', 'server', 'data');
        const files = ['store.json', 'auth.json'].map(f => path56.join(dataDir, f));
        const saved = files.map(f => (fs56.existsSync(f) ? fs56.readFileSync(f) : null));
        const fakeId = 990000 + Math.floor(Math.random() * 9000);
        const run = async st => {
          const a = await st.saveOutcomeValues({ upload_id: `rt56-parity-a-${stamp56}`, metric_id: fakeId, file_name: 'a.xlsx', uploaded_by: 'RT56', period_from: '2003-01', period_to: '2003-02' },
            [{ year: 2003, month: 1, value: 10.25, notes: 'n1' }, { year: 2003, month: 2, value: 0, notes: null }]);
          const b = await st.saveOutcomeValues({ upload_id: `rt56-parity-b-${stamp56}`, metric_id: fakeId, file_name: 'b.xlsx', uploaded_by: 'RT56', period_from: '2003-02', period_to: '2003-03' },
            [{ year: 2003, month: 2, value: 7, notes: 'upd' }, { year: 2003, month: 3, value: 1234567.8912, notes: null }]);
          return {
            saves: [a, b].map(x => [x.inserted, x.updated, x.replaced_seed, x.record.total_rows, x.record.metric_id]),
            values: (await st.getOutcomeValues(fakeId)).map(r => [r.metric_id, r.year, r.month, r.value, r.notes, r.source, r.upload_id.replace(stamp56, '')]),
            uploads: (await st.getOutcomeUploads(fakeId)).map(u => [u.upload_id.replace(stamp56, ''), u.metric_id, u.file_name, u.total_rows, u.inserted_rows, u.updated_rows, u.period_from, u.period_to]),
            allHas: (await st.getOutcomeValues()).some(r => r.metric_id === fakeId),
            latestType: typeof (await st.getLatestSurveyDates())
          };
        };
        let jsonOut;
        let sqlOut;
        let json14;
        let json2;
        try {
          const js = require('../server/db/jsonStorage');
          jsonOut = await run(js);
          json14 = await js.getMetricById(14);
          json2 = await js.getMetricById(2);
          sqlOut = await run(st56);
        } finally {
          files.forEach((f, i) => { if (saved[i] === null) { if (fs56.existsSync(f)) fs56.unlinkSync(f); } else fs56.writeFileSync(f, saved[i]); });
          await st56.deleteMetric(fakeId).catch(() => {}); // no px_metrics row -> throws; the rows go via the SQL below
          const sql56 = require('mssql');
          const pool = await new sql56.ConnectionPool({ server: process.env.DB_SERVER || 'localhost', port: parseInt(process.env.DB_PORT || '1433', 10), database: process.env.DB_NAME || 'PeopleExperiencePX',
            user: process.env.DB_USER, password: process.env.DB_PASSWORD, options: { encrypt: false, trustServerCertificate: true } }).connect();
          try {
            await pool.request().input('id', sql56.Int, fakeId).query('DELETE FROM dbo.px_outcome_values WHERE metric_id = @id; DELETE FROM dbo.px_outcome_uploads WHERE metric_id = @id;');
          } finally { await pool.close(); }
        }
        files.forEach((f, i) => assert.ok(saved[i] === null ? !fs56.existsSync(f) : Buffer.compare(fs56.readFileSync(f), saved[i]) === 0, `${path56.basename(f)} restored byte-identically`));
        assert.deepStrictEqual(jsonOut, sqlOut);
        assert.deepStrictEqual(sqlOut.saves, [[2, 0, 0, 2, fakeId], [1, 1, 0, 2, fakeId]]);
        assert.deepStrictEqual(sqlOut.values, [[fakeId, 2003, 1, 10.25, 'n1', 'UPLOAD', 'rt56-parity-a-'], [fakeId, 2003, 2, 7, 'upd', 'UPLOAD', 'rt56-parity-b-'], [fakeId, 2003, 3, 1234567.8912, null, 'UPLOAD', 'rt56-parity-b-']]);
        assert.deepStrictEqual([json14.scale_type, json14.score_tiers], ['QUOTA_COUNT', { unit: 'number', bounds: B14 }]);
        assert.deepStrictEqual(json2.score_tiers, { unit: 'number', bounds: null }, 'metric 2 not configured (N/A) on JSON too');
        assert.strictEqual(sqlOut.latestType, 'object');
      });

      await runTest('[POSITIVE] Deleting a metric deletes its monthly values, upload history and original files (documented cascade)', async () => {
        const id = om56.metric_id;
        const r = await adminJson('DELETE', `/api/admin/metrics/${id}`);
        assert.strictEqual(r.status, 200);
        metricIds56.splice(metricIds56.indexOf(id), 1);
        assert.deepStrictEqual(await st56.getOutcomeValues(id), []);
        assert.deepStrictEqual(await st56.getOutcomeUploads(id), []);
        for (let i = 0; i < 20 && uploadIds56.some(u => fs56.existsSync(path56.join(ov56.OUTCOME_UPLOAD_DIR, `${u}.xlsx`))); i++) await new Promise(r => setTimeout(r, 100)); // unlink is asynchronous
        for (const u of uploadIds56) assert.ok(!fs56.existsSync(path56.join(ov56.OUTCOME_UPLOAD_DIR, `${u}.xlsx`)), `${u} file removed`);
      });
    } finally {
      for (const id of [...metricIds56].reverse()) await adminJson('DELETE', `/api/admin/metrics/${id}`);
      for (const u of uploadIds56) { const f = path56.join(ov56.OUTCOME_UPLOAD_DIR, `${u}.xlsx`); if (fs56.existsSync(f)) fs56.unlinkSync(f); }
      for (const id of userIds56) await adminJson('DELETE', `/api/admin/users/${id}`);
      if (userCookie56) userCookie56 = null;
    }
  }

  // --- MODULE 57 (v2.54.2): TEMPORARY MANUAL VALUE PER METRIC (setting metric_manual_overrides; metric 11 = 714 pax / 87%) ---
  // Works on a metric this module creates; the setting is restored exactly in finally (the config guard also covers px_app_settings).
  console.log('\n📦 MODULE 57: Temporary manual metric value (bankwide only; N/A under a directorate filter) (Positive & Negative Testing)');
  if (!skipModuleBlock(57)) {
    const st57 = require('../server/db/storage');
    const before57 = (await st57.getSettings()).metric_manual_overrides;
    if (before57 === undefined) {
      console.log('  ⏭️  SKIPPED: setting metric_manual_overrides does not exist in this database');
    } else {
      let metric57 = null;
      const dirList57 = await (await fetch(`${BASE_URL}/api/directorates`)).json();
      const dir57 = (Array.isArray(dirList57) ? dirList57 : (dirList57.directorates || []))[0];
      const calc57 = async q => {
        const r = await fetch(`${BASE_URL}/api/metrics/calculate${q ? `?${q}` : ''}`);
        assert.strictEqual(r.status, 200);
        const body = await r.json();
        return { body, m: body.metrics.find(x => x.metric_id === metric57.metric_id) };
      };
      try {
        const r = await adminJson('POST', '/api/admin/metrics', { journey_id: 3, checkpoint_id: 8, metric_type: 'OUTCOME', is_employee_metric: true,
          metric_name: `RT57 Manual ${Date.now().toString(36)}`, scale_type: 'QUOTA_COUNT', target_value: 500, min_threshold: 60, raw_value: 10, unit: 'pax' });
        assert.strictEqual(r.status, 201);
        metric57 = (await r.json()).metric;
        const withOverride = Object.assign({}, before57 || {}, { [metric57.metric_id]: { value: 321, score: 65, note: 'RT57 temporary', bankwide_only: true } });
        await st57.setSetting('metric_manual_overrides', withOverride);

        await runTest('[POSITIVE] Bankwide: the manual value and score replace the calculated ones and count in the index; detail shows the same', async () => {
          const { m } = await calc57('');
          assert.deepStrictEqual([m.raw_value, m.normalized_score, m.status, !!m.manual_override], [321, 65, 'WARNING', true]);
          assert.strictEqual(m.manual_override.note, 'RT57 temporary');
          const d = await (await fetch(`${BASE_URL}/api/metrics/${metric57.metric_id}/detail`)).json();
          assert.deepStrictEqual([d.current_raw_value, d.normalized_score, d.has_data, !!d.not_applicable], [321, 65, true, false]);
        });

        await runTest('[POSITIVE] Directorate filter: a bankwide-only manual value is N/A (not counted), in calculate and detail', async () => {
          assert.ok(dir57, 'a directorate exists');
          const q = `directorate=${encodeURIComponent(dir57.name)}`;
          const { m } = await calc57(q);
          assert.deepStrictEqual([m.raw_value, m.normalized_score, m.status, m.not_applicable], [null, null, 'NO_DATA', true]);
          const d = await (await fetch(`${BASE_URL}/api/metrics/${metric57.metric_id}/detail?${q}`)).json();
          assert.deepStrictEqual([d.normalized_score, d.has_data, d.not_applicable], [null, false, true]);
        });

        await runTest('[NEGATIVE] An invalid manual entry (score not a number) is ignored; removing the key returns to the calculated value', async () => {
          await st57.setSetting('metric_manual_overrides', Object.assign({}, before57 || {}, { [metric57.metric_id]: { value: 321, score: 'abc' } }));
          let { m } = await calc57('');
          assert.strictEqual(m.manual_override, null);
          assert.strictEqual(m.raw_value, 10);
          await st57.setSetting('metric_manual_overrides', before57);
          ({ m } = await calc57(''));
          assert.deepStrictEqual([m.raw_value, m.manual_override], [10, null]);
        });

        await runTest('[POSITIVE] Live: metric 11 follows its manual entry when one is set (714 pax / 87% bankwide, N/A per directorate)', async () => {
          const entry = before57 && before57['11'];
          const r11 = await fetch(`${BASE_URL}/api/metrics/calculate`);
          const m11 = (await r11.json()).metrics.find(x => x.metric_id === 11);
          if (!entry) { assert.strictEqual(m11.manual_override, null); return; }
          assert.deepStrictEqual([m11.raw_value, m11.normalized_score], [Number(entry.value), Number(entry.score)]);
          if (entry.target_score !== undefined) {
            assert.strictEqual(m11.target_value_normalized, Number(entry.target_score), 'the manual target in % drives the status');
            assert.strictEqual(m11.status, Number(entry.score) < m11.min_threshold ? 'CRITICAL' : (Number(entry.score) < Number(entry.target_score) ? 'WARNING' : 'HEALTHY'));
          }
          const m11d = (await (await fetch(`${BASE_URL}/api/metrics/calculate?directorate=${encodeURIComponent(dir57.name)}`)).json()).metrics.find(x => x.metric_id === 11);
          assert.deepStrictEqual([m11d.normalized_score, m11d.not_applicable], [null, true]);
        });
      } finally {
        await st57.setSetting('metric_manual_overrides', before57);
        if (metric57) await adminJson('DELETE', `/api/admin/metrics/${metric57.metric_id}`);
      }
    }
  }

  // --- MODULE 58 (v2.55.0): METRIC 1 = AVERAGE OF THE UPLOADED MONTHS OF A YEAR (one row of months per year), SOCIAL MEDIA DRILLDOWN HIDDEN ---
  // Uploads only go to metrics this module creates itself (deleted at the end with their monthly values, uploads and original
  // files - the documented metric-delete cascade) and to far-past years (2003 / 2004); metric 1 is only read, its stored
  // months are compared before / after. The JSON parity check restores store.json / auth.json byte-identically. SQL Server only.
  console.log('\n📦 MODULE 58: Metric 1 - yearly upload (Metrics | Jan..Dec), AVERAGE of the months through the tiers, social media drilldown hidden (Positive & Negative Testing)');
  if (require('../server/db/storage').backend !== 'sql') {
    console.log('  ⏭️  SKIPPED: Module 58 needs the SQL Server backend (in-process JSON parity check)');
  } else if (!skipModuleBlock(58)) {
    const st58 = require('../server/db/storage');
    const ov58 = require('../server/services/outcomeValueService');
    const tiers58 = require('../server/db/scoreTiers');
    const { buildXlsx: buildXlsx58, readFirstSheet: readSheet58 } = require('../server/services/xlsxUtils');
    const fs58 = require('fs');
    const path58 = require('path');
    const ZW = String.fromCharCode(0x200B); // zero-width space, as in the user's template ("3.87%" + U+200B)
    const NBSP = String.fromCharCode(0x00A0);
    const B1_58 = [{ min: 1, op: '>' }, { min: 2, op: '>' }, { min: 2.5, op: '>' }, { min: 3.5, op: '>' }];
    const MON58 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const HEAD58 = ['Metrics', ...MON58, 'Target', 1, 2, 3, 4, 5, '(Contoh Pengisian)'];
    const BANDS58 = ['<1%', '1.1-2.0%', '2.1-2.5%', '2.51%-3.5%', '>3.5%'];
    // the user's layout: row 1 "Score Asli" over the months, row 2 the header, row 3 the metric (12 month cells + info columns)
    const yearSheet = (months, { label = 'Social media engagement rate (IG)', extraRows = [], info = ['2-2.5%', ...BANDS58, 0.03] } = {}) => buildXlsx58([
      [null, 'Score Asli'], HEAD58, [label, ...months, ...info], ...extraRows
    ], { merges: ['B1:M1'] });
    const USER_MONTHS = ['-', '-', `3.87%${ZW}`, `2.01%${ZW}`, `5.45%${ZW}`, `3.03%${ZW}`, `3.84%${ZW}`, `3.49%${ZW}`, `0.66%${ZW}`, '-', '-', '-'];
    const metricIds58 = [];
    const uploadIds58 = [];
    const stamp58 = Date.now().toString(36);
    const postYear = async (metricId, buf, year, fileName = 'module58.xlsx') => {
      const fd = new FormData();
      fd.append('file', new Blob([buf]), fileName);
      if (year !== undefined) fd.append('year', String(year));
      const r = await fetch(`${BASE_URL}/api/admin/outcome-values/${metricId}/upload`, { method: 'POST', body: fd });
      const body = await r.json();
      if (r.status === 200 && body.upload_id) uploadIds58.push(body.upload_id);
      return { status: r.status, body };
    };
    const calc58 = async (q, id) => (await (await fetch(`${BASE_URL}/api/metrics/calculate?${q}`)).json()).metrics.find(x => x.metric_id === id);
    const detail58 = async (id, q) => (await fetch(`${BASE_URL}/api/metrics/${id}/detail?${q}`)).json();
    const csv58 = text => text.replace(/^﻿/, '').split('\r\n').filter(Boolean);
    const values58 = async id => (await st58.getOutcomeValues(id)).map(r => [r.year, r.month, r.value]);
    const pct58 = v => Math.round(tiers58.tieredScore(v, B1_58).percent * 100) / 100;
    let am58 = null; // the AVERAGE test metric
    let metric1Before = null;
    try {
      metric1Before = JSON.stringify(await st58.getOutcomeValues(1));

      await runTest('[POSITIVE] Metric 1 reads its months as AVERAGE (boot top-up of a NULL column; px_metrics column + admin parameters), its detail has no Internal Transaction Records (operational_records_hidden, no social media block / upload flag), and metric 14 stays LATEST', async () => {
        assert.strictEqual((await st58.getMetricById(1)).outcome_aggregation, 'AVERAGE');
        const params = await (await fetch(`${BASE_URL}/api/admin/parameters`)).json();
        assert.strictEqual(params.metrics.find(m => m.metric_id === 1).outcome_aggregation, 'AVERAGE');
        const m1 = await calc58('mode=YTD', 1);
        assert.deepStrictEqual([m1.outcome_aggregation, m1.data_upload], ['AVERAGE', undefined]);
        const m14 = await calc58('mode=YTD', 14);
        assert.strictEqual(m14.outcome_aggregation, 'LATEST', 'NULL = LATEST');
        // metric 3 gets the same yearly upload + AVERAGE (boot top-up), but keeps its Internal Transaction Records
        assert.strictEqual((await st58.getMetricById(3)).outcome_aggregation, 'AVERAGE');
        assert.strictEqual((await calc58('mode=YTD', 3)).outcome_aggregation, 'AVERAGE');
        assert.strictEqual((await detail58(3, 'mode=YTD')).operational_records_hidden, false);
        const t3 = await readSheet58(Buffer.from(await (await fetch(`${BASE_URL}/api/admin/outcome-values/3/template`)).arrayBuffer()));
        assert.deepStrictEqual(t3[1].cells.slice(0, 14).map(c => c.value), ['Metrics', ...MON58, 'Target']);
        assert.deepStrictEqual(t3[2].cells.slice(14, 19).map(c => c.value), ['< 30%', '>= 30% - < 45%', '>= 45% - < 60%', '>= 60% - <= 75%', '> 75%'], 'metric 3 tier bands (>= / >)');
        for (const q of ['mode=YTD', 'mode=MTD&year=2026&month=09']) {
          const d = await detail58(1, q);
          assert.deepStrictEqual([d.operational_records_hidden, d.operational_records, d.data_upload, d.social_media], [true, [], undefined, undefined], q);
        }
        const d14 = await detail58(14, 'mode=YTD');
        assert.strictEqual(d14.operational_records_hidden, false, 'other OUTCOME metrics keep their records tab');
      });

      await runTest('[POSITIVE] Template of metric 1 = the user layout: A1 metric + year, B1:M1 "Score Asli" (merged), row 2 Metrics | Jan..Dec | Target | 1..5 | (Contoh Pengisian), row 3 metric name, stored values of the year as "x%" or "-", target, tier bands from score_tiers', async () => {
        const year = new Date().getFullYear();
        const r = await fetch(`${BASE_URL}/api/admin/outcome-values/1/template`);
        assert.strictEqual(r.status, 200);
        const buf = Buffer.from(await r.arrayBuffer());
        const rows = await readSheet58(buf);
        assert.deepStrictEqual(rows[0].cells.filter(Boolean).map(c => c.value), [`Metric 1 - ${year}`, 'Score Asli']);
        assert.deepStrictEqual(rows[1].cells.map(c => c.value), [...['Metrics', ...MON58, 'Target'], 1, 2, 3, 4, 5, '(Contoh Pengisian)']);
        const stored = (await st58.getOutcomeValues(1)).filter(x => x.year === year);
        const now = new Date();
        const expectMonths = MON58.map((_, i) => {
          const s = stored.find(x => x.month === i + 1);
          return s && (year * 100 + i + 1) <= now.getFullYear() * 100 + now.getMonth() + 1 ? `${Math.round(s.value * 10000) / 10000}%` : '-';
        });
        const metric1 = await st58.getMetricById(1);
        assert.deepStrictEqual(rows[2].cells.map(c => c.value), [metric1.metric_name, ...expectMonths, (await st58.getMetricTargetById(1)).target_display,
          '<= 1%', '> 1% - <= 2%', '> 2% - <= 2.5%', '> 2.5% - <= 3.5%', '> 3.5%', `${(await st58.getMetricTargetById(1)).target_value}%`]);
        const zip = await require('jszip').loadAsync(buf);
        assert.ok(/<mergeCell ref="B1:M1"\/>/.test(await zip.file('xl/worksheets/sheet1.xml').async('string')), 'B1:M1 merged');
        assert.strictEqual(ov58.validateOutcomeYearSheet(rows, metric1, year).errors.length, stored.length ? 0 : 1, 'the template reads back (only "-" -> "no month holds a value")');
        assert.strictEqual((await fetch(`${BASE_URL}/api/admin/outcome-values/1/template?year=20x6`)).status, 400);
        assert.strictEqual((await fetch(`${BASE_URL}/api/admin/outcome-values/1/template?year=${year + 1}`)).status, 400, 'a future year');
      });

      await runTest('[POSITIVE] outcome_aggregation on a created / edited metric: OUTCOME AVERAGE stored; bad value -> 400 (create and edit); a SURVEY metric never stores one; an edit without the field keeps it', async () => {
        const bad = await adminJson('POST', '/api/admin/metrics', { metric_name: `RT58 bad ${stamp58}`, metric_type: 'OUTCOME', journey_id: 1, checkpoint_id: 1, outcome_aggregation: 'MEDIAN' });
        assert.strictEqual(bad.status, 400);
        assert.ok(/LATEST or AVERAGE/.test((await bad.json()).error));
        const r = await adminJson('POST', '/api/admin/metrics', { metric_name: `RT58 Average ${stamp58}`, metric_type: 'OUTCOME', scale_type: 'NUMERIC', journey_id: 1, checkpoint_id: 1,
          is_employee_metric: false, unit: '%', raw_value: 0.5, target_value: 2, target_display: '2%', min_threshold: 20, score_tiers: { unit: 'percent', bounds: B1_58 }, outcome_aggregation: 'average' });
        const b = await r.json();
        assert.strictEqual(r.status, 201, JSON.stringify(b).slice(0, 300));
        am58 = b.metric;
        metricIds58.push(am58.metric_id);
        assert.strictEqual((await st58.getMetricById(am58.metric_id)).outcome_aggregation, 'AVERAGE');
        assert.strictEqual((await adminJson('PUT', `/api/admin/metrics/${am58.metric_id}`, { outcome_aggregation: 'bogus' })).status, 400);
        assert.strictEqual((await adminJson('PUT', `/api/admin/metrics/${am58.metric_id}`, { notes: 'rt58' })).status, 200);
        assert.strictEqual((await st58.getMetricById(am58.metric_id)).outcome_aggregation, 'AVERAGE', 'kept by an edit without the field');
        const s = await adminJson('POST', '/api/admin/metrics', { metric_name: `RT58 Survey ${stamp58}`, metric_type: 'SURVEY', journey_id: 1, checkpoint_id: 1, outcome_aggregation: 'AVERAGE' });
        const sb = await s.json();
        assert.strictEqual(s.status, 201);
        metricIds58.push(sb.metric.metric_id);
        assert.strictEqual((await st58.getMetricById(sb.metric.metric_id)).outcome_aggregation, null);
      });

      await runTest('[POSITIVE] Upload of the user layout for 2004 (U+200B after "x%", "-" = no value, info columns ignored): 200, 7 months stored as percent numbers, average 3.1929, original kept, history, audit OUTCOME_UPLOAD names the year', async () => {
        assert.ok(am58, 'metric from the previous test');
        const { status, body } = await postYear(am58.metric_id, await yearSheet(USER_MONTHS), 2004, 'module58_user_layout.xlsx');
        assert.strictEqual(status, 200, JSON.stringify(body).slice(0, 400));
        assert.deepStrictEqual([body.year, body.aggregation, body.rows_imported, body.inserted_rows, body.updated_rows, body.deleted_rows], [2004, 'AVERAGE', 7, 7, 0, 0]);
        assert.deepStrictEqual(body.periods, ['2004-03', '2004-04', '2004-05', '2004-06', '2004-07', '2004-08', '2004-09']);
        assert.strictEqual(body.average_value, 3.1929);
        assert.strictEqual(body.average_label, 'Average of 7 months (Mar-Sep 2004)');
        assert.deepStrictEqual(await values58(am58.metric_id), [[2004, 3, 3.87], [2004, 4, 2.01], [2004, 5, 5.45], [2004, 6, 3.03], [2004, 7, 3.84], [2004, 8, 3.49], [2004, 9, 0.66]]);
        assert.ok(fs58.existsSync(path58.join(ov58.OUTCOME_UPLOAD_DIR, `${body.upload_id}.xlsx`)), 'original kept');
        const hist = await (await fetch(`${BASE_URL}/api/admin/outcome-values/${am58.metric_id}/uploads`)).json();
        assert.ok(hist.some(h => h.upload_id === body.upload_id && h.period_from === '2004-03' && h.period_to === '2004-09' && h.has_original_file));
        const a = (await st58.getAuditLog(30, { includeTest: true })).find(x => x.action === 'OUTCOME_UPLOAD' && String(x.target).includes(body.upload_id));
        assert.ok(a && /year 2004 replaced, 0 removed; average 3\.1929/.test(a.target), JSON.stringify(a));
        // the user's own template file, read as it is (not changed), gives the same months
        const userFile = path58.join(__dirname, '..', 'docs', 'Template Survey', 'Metrics #1 Template.xlsx');
        if (fs58.existsSync(userFile)) {
          const v = ov58.validateOutcomeYearSheet(await readSheet58(fs58.readFileSync(userFile)), am58, 2004);
          assert.deepStrictEqual([v.errors, v.rows.map(x => [x.month, x.value]), v.label], [[], [[3, 3.87], [4, 2.01], [5, 5.45], [6, 3.03], [7, 3.84], [8, 3.49], [9, 0.66]], 'Social media engagement rate (IG)']);
        }
      });

      await runTest('[POSITIVE] Scoring = AVERAGE of the months in the window through the tiers: YTD 2004 = 3.1929% -> tier 4 -> 93.86% ("Average of 7 months (Mar-Sep 2004)"), MTD Apr 2004 = 2.01% only, MTD Jan 2004 / YTD 2005 = NO_DATA; detail agrees, Last update = September 2004', async () => {
        const avg = (3.87 + 2.01 + 5.45 + 3.03 + 3.84 + 3.49 + 0.66) / 7;
        const y = await calc58('mode=YTD&year=2004', am58.metric_id);
        assert.deepStrictEqual([y.raw_value, y.normalized_score, y.tier_info.tier, y.outcome_aggregation, y.outcome_months_count, y.outcome_average_label, y.outcome_period, y.period_window.basis, y.status],
          [3.19, 93.86, 4, 'AVERAGE', 7, 'Average of 7 months (Mar-Sep 2004)', '2004-09', 'AVERAGE_OF_MONTHS', 'HEALTHY']);
        assert.strictEqual(pct58(avg), 93.86);
        assert.deepStrictEqual([y.last_update_period, y.last_update_label], ['2004-09', 'September 2004']);
        const apr = await calc58('mode=MTD&year=2004&month=04', am58.metric_id);
        assert.deepStrictEqual([apr.raw_value, apr.normalized_score, apr.outcome_months_count, apr.period_window.basis], [2.01, pct58(2.01), 1, 'MONTH']);
        for (const q of ['mode=MTD&year=2004&month=01', 'mode=YTD&year=2005']) {
          const n = await calc58(q, am58.metric_id);
          assert.deepStrictEqual([n.status, n.raw_value, n.normalized_score, n.outcome_average_label], ['NO_DATA', null, null, null], q);
        }
        const d = await detail58(am58.metric_id, 'mode=YTD&year=2004');
        assert.deepStrictEqual([d.current_raw_value, d.normalized_score, d.outcome_average_label, d.tier_info.tier, d.operational_records_hidden],
          [Math.round(avg * 10000) / 10000, 93.86, 'Average of 7 months (Mar-Sep 2004)', 4, false]);
      });

      await runTest('[POSITIVE] An upload for a year REPLACES that year only: 2003 stays, 2004 re-uploaded with Jan "1%", Mar numeric 0.0349 (Excel percent -> 3.49%), Jun "2,5 %" with NBSP, "–" / "n/a" / empty = no value -> 2004 = Jan, Mar, Jun (5 months removed)', async () => {
        const y2003 = await postYear(am58.metric_id, await yearSheet(['4%', ...Array(11).fill('-')]), 2003, 'module58_2003.xlsx');
        assert.strictEqual(y2003.status, 200, JSON.stringify(y2003.body).slice(0, 300));
        const months = ['1%', '-', 0.0349, String.fromCharCode(0x2013), 'n/a', `2,5${NBSP}%`, null, '-', '-', '-', '-', '-'];
        const { status, body } = await postYear(am58.metric_id, await yearSheet(months), '2004', 'module58_replace.xlsx');
        assert.strictEqual(status, 200, JSON.stringify(body).slice(0, 300));
        assert.deepStrictEqual([body.rows_imported, body.inserted_rows, body.updated_rows, body.deleted_rows], [3, 1, 2, 5]);
        assert.deepStrictEqual(await values58(am58.metric_id), [[2003, 1, 4], [2004, 1, 1], [2004, 3, 3.49], [2004, 6, 2.5]]);
        const y = await calc58('mode=YTD&year=2004', am58.metric_id);
        assert.deepStrictEqual([y.raw_value, y.outcome_months_count, y.outcome_average_label], [2.33, 3, 'Average of 3 months (Jan-Jun 2004)']);
        const t = await fetch(`${BASE_URL}/api/admin/outcome-values/${am58.metric_id}/template?year=2004`);
        const rows = await readSheet58(Buffer.from(await t.arrayBuffer()));
        assert.deepStrictEqual(rows[2].cells.slice(1, 13).map(c => c.value), ['1%', '-', '3.49%', '-', '-', '2.5%', '-', '-', '-', '-', '-', '-'], 'the template shows the stored months of the chosen year');
      });

      await runTest('[POSITIVE] Metric-3 layout (numeric Excel fractions 0.69 / 0.7504, Jan-Jul BLANK, Oct-Dec "-", info columns with an en dash, example 0.65) on a metric with metric 3 tiers: 2004 = Aug 69%, Sep 75.04% -> average 72.02% -> tier 4 -> 96.03%; the user file reads the same', async () => {
        const B3_58 = [{ min: 30, op: '>=' }, { min: 45, op: '>=' }, { min: 60, op: '>=' }, { min: 75, op: '>' }];
        const r = await adminJson('POST', '/api/admin/metrics', { metric_name: `RT58 Ratio ${stamp58}`, metric_type: 'OUTCOME', scale_type: 'PERCENTAGE', journey_id: 1, checkpoint_id: 2,
          is_employee_metric: false, unit: '%', raw_value: 50, target_value: 70, target_display: '> 70%', min_threshold: 70, score_tiers: { unit: 'percent', bounds: B3_58 }, outcome_aggregation: 'AVERAGE' });
        const b = await r.json();
        assert.strictEqual(r.status, 201, JSON.stringify(b).slice(0, 300));
        metricIds58.push(b.metric.metric_id);
        const ND = String.fromCharCode(0x2013);
        const months = [null, null, null, null, null, null, null, 0.69, 0.7504, '-', '-', '-'];
        const info = ['>70%', '< 30%', `30 ${ND} 44%`, `45 ${ND} 59 %`, `60 ${ND} 75%`, '>75%', 0.65];
        const up = await postYear(b.metric.metric_id, await yearSheet(months, { label: 'Success ratio candidate from targeted university', info }), 2004, 'module58_metric3_layout.xlsx');
        assert.strictEqual(up.status, 200, JSON.stringify(up.body).slice(0, 300));
        assert.deepStrictEqual(await values58(b.metric.metric_id), [[2004, 8, 69], [2004, 9, 75.04]]);
        const y = await calc58('mode=YTD&year=2004', b.metric.metric_id);
        const expected = Math.round(tiers58.tieredScore((69 + 75.04) / 2, B3_58).percent * 100) / 100;
        assert.deepStrictEqual([y.raw_value, y.normalized_score, y.tier_info.tier, y.outcome_average_label, y.status], [72.02, 96.03, 4, 'Average of 2 months (Aug-Sep 2004)', 'HEALTHY']);
        assert.strictEqual(expected, 96.03);
        const userFile3 = path58.join(__dirname, '..', 'docs', 'Template Survey', 'Metrics #3 Template.xlsx');
        if (fs58.existsSync(userFile3)) {
          const v = ov58.validateOutcomeYearSheet(await readSheet58(fs58.readFileSync(userFile3)), b.metric, 2004);
          assert.deepStrictEqual([v.errors, v.rows.map(x => [x.month, x.value]), v.label], [[], [[8, 69], [9, 75.04]], 'Success ratio candidate from targeted university']);
        }
      });

      await runTest('[POSITIVE] Evidence CSV of an AVERAGE metric: the months of the period marked Used_In_Score YES plus an "Average" line (CALCULATED) per year; ALL lists every year with its own average', async () => {
        const lines = csv58(await (await fetch(`${BASE_URL}/api/admin/outcome-evidence/${am58.metric_id}?period=2004`)).text());
        assert.strictEqual(lines.length, 5, 'header + 3 months + average');
        assert.ok(lines.slice(1, 4).every(l => l.split(',')[9] === 'YES'));
        assert.ok(lines[4].startsWith(`${am58.metric_id},RT58 Average ${stamp58},%,2004,,Average,2.33,Average of 3 months (Jan-Jun 2004),CALCULATED,YES,`), lines[4]);
        const mar = csv58(await (await fetch(`${BASE_URL}/api/admin/outcome-evidence/${am58.metric_id}?period=2004-03`)).text());
        assert.deepStrictEqual(mar.slice(1).map(l => l.split(',')[5]), ['2004-03', 'Average']);
        const all = csv58(await (await fetch(`${BASE_URL}/api/admin/outcome-evidence/${am58.metric_id}`)).text());
        assert.deepStrictEqual(all.filter(l => l.includes(',Average,')).map(l => l.split(',').slice(3, 7)), [['2003', '', 'Average', '4'], ['2004', '', 'Average', '2.33']]);
      });

      await runTest('[NEGATIVE] Bad month cells refuse the whole file (400, one error per cell with column + month, nothing stored): negative, text, a number cell read as 387%, "%" text on a non-% metric is checked separately', async () => {
        const before = await values58(am58.metric_id);
        const months = ['-1%', 'abc', 3.87, '2%', '-', '-', '-', '-', '-', '-', '-', '-'];
        const { status, body } = await postYear(am58.metric_id, await yearSheet(months), 2004, 'module58_bad.xlsx');
        assert.strictEqual(status, 400);
        assert.ok(/nothing was stored/.test(body.error));
        assert.deepStrictEqual(body.errors.map(e => [e.row_number, e.column]), [[3, 'B'], [3, 'C'], [3, 'D']]);
        assert.ok(/^January: .*must not be negative/.test(body.errors[0].reason), body.errors[0].reason);
        assert.ok(/^February: .*percentage such as 3\.87%.*"abc"/.test(body.errors[1].reason), body.errors[1].reason);
        assert.ok(/^March: .*387% - above 100%/.test(body.errors[2].reason), body.errors[2].reason);
        assert.deepStrictEqual(await values58(am58.metric_id), before);
        // a metric that is not a percentage: "%" text is refused, a number cell is read as written
        const num = { metric_id: 0, metric_type: 'OUTCOME', unit: 'pax', outcome_aggregation: 'AVERAGE', score_tiers: null };
        const v = ov58.validateOutcomeYearSheet(await readSheet58(await yearSheet(['5%', 12, ...Array(10).fill('-')])), num, 2004);
        assert.deepStrictEqual([v.errors.length, v.errors[0].column, /not a percentage/.test(v.errors[0].reason)], [1, 'B', true]);
        assert.deepStrictEqual(ov58.validateOutcomeYearSheet(await readSheet58(await yearSheet(['-', 12, ...Array(10).fill('-')])), num, 2004).rows.map(x => x.value), [12]);
      });

      await runTest('[NEGATIVE] Year and layout: no year / "20x4" / 1999 / next year -> 400; a month after the current month of this year -> 400 naming it; no month header row, two metric rows, every month "-" -> 400; nothing stored', async () => {
        const before = await values58(am58.metric_id);
        const ok = await yearSheet(USER_MONTHS);
        const now = new Date();
        for (const y of [undefined, '', '20x4', 1999, now.getFullYear() + 1]) {
          const r = await postYear(am58.metric_id, ok, y);
          assert.strictEqual(r.status, 400, String(y));
          assert.ok(/year/i.test(r.body.error), r.body.error);
        }
        if (now.getMonth() < 11) {
          const fut = Array(12).fill('-');
          fut[now.getMonth()] = '1%';
          fut[now.getMonth() + 1] = '2%';
          const r = await postYear(am58.metric_id, await yearSheet(fut), now.getFullYear());
          assert.strictEqual(r.status, 400);
          const nextName = require('../server/services/essSummaryService').MONTH_NAMES[now.getMonth() + 1];
          assert.strictEqual(r.body.errors.length, 1, 'only the month after the current one');
          assert.ok(r.body.errors[0].reason.startsWith(`${nextName} ${now.getFullYear()} is in the future`), r.body.errors[0].reason);
        }
        const noHeader = await postYear(am58.metric_id, await buildXlsx58([['Metrics', 'Year', 'Value'], ['x', 2004, 1]]), 2004);
        assert.deepStrictEqual([noHeader.status, /No header row with the month columns/.test(noHeader.body.errors[0].reason)], [400, true]);
        const two = await postYear(am58.metric_id, await yearSheet(USER_MONTHS, { extraRows: [['Second metric', '1%']] }), 2004);
        assert.deepStrictEqual([two.status, /ONE metric row.*rows 3, 4/.test(two.body.errors[0].reason)], [400, true]);
        const empty = await postYear(am58.metric_id, await yearSheet(Array(12).fill('-')), 2004);
        assert.deepStrictEqual([empty.status, /No month of row 3 holds a value/.test(empty.body.errors[0].reason)], [400, true]);
        assert.deepStrictEqual(await values58(am58.metric_id), before, 'nothing stored by any refused upload');
      });

      await runTest('[POSITIVE] JSON backend in-process (same contract): outcome_aggregation create / edit / bad value, saveOutcomeValues with replaceYear (deleted count, other years kept) give the same results as SQL Server; store.json and auth.json restored byte-identically', async () => {
        const dataDir = path58.join(__dirname, '..', 'server', 'data');
        const files = ['store.json', 'auth.json'].map(f => path58.join(dataDir, f));
        const saved = files.map(f => (fs58.existsSync(f) ? fs58.readFileSync(f) : null));
        const run = async (st, label) => {
          const m = await st.addMetric({ metric_name: `RT58 parity ${label} ${stamp58}`, metric_type: 'OUTCOME', journey_id: 1, checkpoint_id: 1, outcome_aggregation: 'AVERAGE' });
          const out = { created: (await st.getMetricById(m.metric_id)).outcome_aggregation };
          await st.updateMetric(m.metric_id, { outcome_aggregation: 'LATEST' });
          out.edited = (await st.getMetricById(m.metric_id)).outcome_aggregation;
          try { await st.updateMetric(m.metric_id, { outcome_aggregation: 'X' }); out.bad = 'accepted'; } catch (e) { out.bad = e.message; }
          const meta = (id, from, to) => ({ upload_id: `rt58-parity-${id}-${stamp58}`, metric_id: m.metric_id, file_name: 'p.xlsx', uploaded_by: 'RT58', period_from: from, period_to: to });
          const s1 = await st.saveOutcomeValues(meta('a', '2003-01', '2004-02'), [{ year: 2003, month: 1, value: 1, notes: null }, { year: 2004, month: 1, value: 2, notes: null }, { year: 2004, month: 2, value: 3, notes: null }]);
          const s2 = await st.saveOutcomeValues(meta('b', '2004-02', '2004-03'), [{ year: 2004, month: 2, value: 4, notes: null }, { year: 2004, month: 3, value: 5, notes: null }], { replaceYear: 2004 });
          out.saves = [s1, s2].map(x => [x.inserted, x.updated, x.deleted || 0]);
          out.values = (await st.getOutcomeValues(m.metric_id)).map(r => [r.year, r.month, r.value]);
          await st.deleteMetric(m.metric_id);
          out.afterDelete = (await st.getOutcomeValues(m.metric_id)).length;
          return out;
        };
        let jsonOut;
        let sqlOut;
        try {
          jsonOut = await run(require('../server/db/jsonStorage'), 'json');
          sqlOut = await run(st58, 'sql');
        } finally {
          files.forEach((f, i) => { if (saved[i] === null) { if (fs58.existsSync(f)) fs58.unlinkSync(f); } else fs58.writeFileSync(f, saved[i]); });
        }
        files.forEach((f, i) => assert.ok(saved[i] === null ? !fs58.existsSync(f) : Buffer.compare(fs58.readFileSync(f), saved[i]) === 0, `${path58.basename(f)} restored byte-identically`));
        assert.deepStrictEqual(jsonOut, sqlOut);
        assert.deepStrictEqual(sqlOut, { created: 'AVERAGE', edited: 'LATEST', bad: 'outcome_aggregation must be LATEST or AVERAGE.', saves: [[3, 0, 0], [1, 1, 1]],
          values: [[2003, 1, 1], [2004, 2, 4], [2004, 3, 5]], afterDelete: 0 });
      });

      await runTest('[POSITIVE] Metric 1 untouched by this module: its stored months are byte-for-byte the same as before', async () => {
        assert.strictEqual(JSON.stringify(await st58.getOutcomeValues(1)), metric1Before);
      });
    } finally {
      for (const id of [...metricIds58].reverse()) await adminJson('DELETE', `/api/admin/metrics/${id}`);
      for (const u of uploadIds58) { const f = path58.join(ov58.OUTCOME_UPLOAD_DIR, `${u}.xlsx`); if (fs58.existsSync(f)) fs58.unlinkSync(f); }
    }
  }

  // --- MODULE 59 (v2.55.0): COMPOSITE SUMMARY METRICS (7 = 4 parts, 5, 12, 19, 20) - PART UPLOAD, AVERAGE PER PART, N/A PARTS ---
  // Uploads only go to metrics this module creates itself (parts inserted through SQL; deleted at the end with their parts, rows
  // and uploads - the metric-delete cascade) and to far-past months (2004). The live metrics 5 / 7 / 12 / 19 / 20 are only read;
  // their part rows are compared before / after. The user's template files are read in-process only (never uploaded). SQL only.
  console.log('\n📦 MODULE 59: Composite summary metrics - part summary upload, per-part average, N/A parts, events, score column (Positive & Negative Testing)');
  if (require('../server/db/storage').backend !== 'sql') {
    console.log('  ⏭️  SKIPPED: Module 59 needs the SQL Server backend (its fixture parts are inserted through SQL)');
  } else if (!skipModuleBlock(59)) {
    const st59 = require('../server/db/storage');
    const mp59 = require('../server/services/metricPartsService');
    const { buildXlsx: buildXlsx59, readFirstSheet: readSheet59 } = require('../server/services/xlsxUtils');
    const { buildResolver: buildResolver59 } = require('../server/db/directoryNames');
    const seed59 = require('../server/db/seedData');
    const fs59 = require('fs');
    const path59 = require('path');
    const sql59 = require('mssql');
    const pool59 = await new sql59.ConnectionPool({ server: process.env.DB_SERVER || 'localhost', port: parseInt(process.env.DB_PORT || '1433', 10), database: process.env.DB_NAME || 'PeopleExperiencePX',
      user: process.env.DB_USER, password: process.env.DB_PASSWORD, options: { encrypt: false, trustServerCertificate: true } }).connect();
    const q59 = async (text, params = {}) => {
      const r = pool59.request();
      Object.entries(params).forEach(([k, v]) => r.input(k, v));
      return (await r.query(text)).recordset || [];
    };
    const stamp59 = Date.now().toString(36);
    const metricIds59 = [];
    const TPL = path59.join(__dirname, '..', 'docs', 'Template Survey');
    const live59 = async () => JSON.stringify(await q59('SELECT metric_id, part_key, COUNT(*) AS n FROM dbo.px_metric_part_results WHERE metric_id IN (5, 7, 12, 19, 20) GROUP BY metric_id, part_key ORDER BY metric_id, part_key'));
    const addPart = (metricId, key, name, order, template = null) => q59('INSERT INTO dbo.px_metric_parts (metric_id, part_key, part_name, sort_order, template_json) VALUES (@m, @k, @n, @o, @t)',
      { m: metricId, k: key, n: name, o: order, t: template ? JSON.stringify(template) : null });
    const createMetric59 = async body => {
      const r = await adminJson('POST', '/api/admin/metrics', { journey_id: 1, checkpoint_id: 4, metric_type: 'SURVEY', scale_type: 'RATING_5', target_value: 4, target_display: '> 4.00 / 5', min_threshold: 75, is_employee_metric: true, ...body });
      const b = await r.json();
      assert.strictEqual(r.status, 201, JSON.stringify(b).slice(0, 300));
      metricIds59.push(b.metric.metric_id);
      return b.metric;
    };
    const postPart = async (metricId, key, buf, fileName = 'module59.xlsx') => {
      const fd = new FormData();
      fd.append('file', new Blob([buf]), fileName);
      const r = await fetch(`${BASE_URL}/api/admin/metric-parts/${metricId}/${key}/upload`, { method: 'POST', body: fd });
      return { status: r.status, body: await r.json() };
    };
    const calc59 = async (q, id) => (await (await fetch(`${BASE_URL}/api/metrics/calculate?${q}`)).json()).metrics.find(x => x.metric_id === id);
    const detail59 = async (id, q) => (await fetch(`${BASE_URL}/api/metrics/${id}/detail?${q}`)).json();
    const csv59 = text => text.replace(/^./, c => (c.charCodeAt(0) === 0xFEFF ? '' : c)).split('\r\n').filter(Boolean);
    const HEAD = ['Directorate', 'Level', 'Year', 'Month', 'Part Score', 'Q1 rating', 'Q2 reason', 'Jumlah Responden', 'Periode (Join Date)'];
    let liveBefore59 = null;
    let dirA = null;
    let dirB = null;
    let alias59 = null;
    let am59 = null; // 3-part RATING_5 metric
    try {
      liveBefore59 = await live59();
      const dirs = (await st59.getDirectorates()).map(d => d.directorate_name);
      [dirA, dirB] = dirs;
      const aliases = await st59.getDirectoryAliases();
      alias59 = (aliases.directorates || []).find(x => x.directorate_name !== dirA && x.directorate_name !== dirB) || null; // a former name (e.g. "Consumer & Emerging Business Banking")

      await runTest('[POSITIVE] Live configuration: metric 7 has the 4 parts (Meet and Greet / Welcome Session / Onboarding Survey Day 1 / Infrastructure & Application), 5 / 12 / 19 / 20 one part each; metric 12 is a % metric (PERCENTAGE, target 80); calculate flags them PART_SUMMARY and the detail of 7 shows no respondent rows / questions', async () => {
        const parts = await st59.getMetricParts();
        const of = id => parts.filter(p => p.metric_id === id).map(p => p.part_name);
        assert.deepStrictEqual(of(7), ['Meet and Greet Satisfaction', 'Welcome Session', 'Onboarding Survey Day 1', 'Infrastructure & Application']);
        assert.deepStrictEqual([of(5), of(12), of(19), of(20)], [['Candidate Experience Survey'], ['Signature Program Event Satisfaction'], ['Mandatory Learning'], ['Non Mandatory Learning']]);
        const m12 = await st59.getMetricById(12);
        assert.deepStrictEqual([m12.scale_type, m12.unit, Number((await st59.getMetricTargetById(12)).target_value)], ['PERCENTAGE', '%', 80]);
        for (const id of [5, 7, 12, 19, 20]) assert.strictEqual((await calc59('mode=YTD', id)).data_upload, 'PART_SUMMARY', `metric ${id}`);
        const d7 = await detail59(7, 'mode=YTD');
        assert.deepStrictEqual([d7.data_upload, d7.responses.length, d7.questions_breakdown.length, d7.parts.length], ['PART_SUMMARY', 0, 0, 4]);
        await st59.topUpMetricParts();
        assert.strictEqual((await st59.getMetricParts(7)).length, 4, 'the boot top-up never adds parts twice');
      });

      await runTest('[POSITIVE] The user templates (read in-process, never uploaded): Meet & Greet Pivot (Raw Data sheet never read) Jun-Oct, Day 1 Sept-Oct (Nov/Dec "-" rows skipped), Candidate Experience, Signature Program events (blue header fill), Mandatory / Non Mandatory Learning columns -> 92.37% / 91.07% / 99.1746% / 97.00% / 96.46%', async () => {
        const files = {
          MEET_GREET: '1. Meet & Greet Satisfaction_update.xlsx', DAY1_SURVEY: 'Onboarding Day 1 Survey.xlsx', CANDIDATE_EXPERIENCE: 'Candidate Experience Survey Score Template.xlsx',
          EVENT_SATISFACTION: 'Signature Program Event Satisfaction Score Template.xlsx', MANDATORY_LEARNING: 'Mandatory & Non Mandatory Learning_PX.xlsx', NON_MANDATORY_LEARNING: 'Mandatory & Non Mandatory Learning_PX.xlsx'
        };
        if (!Object.values(files).every(f => fs59.existsSync(path59.join(TPL, f)))) return; // the user's files are not in the repository
        const resolver = buildResolver59(await st59.getDirectorates(), await st59.getDirectoryAliases());
        const rows = [];
        const now = new Date(2026, 9, 21);
        for (const [key, f] of Object.entries(files)) {
          const part = seed59.initialMetricParts.find(p => p.part_key === key);
          const sheet = await readSheet59(fs59.readFileSync(path59.join(TPL, f)), { preferSheet: 'Pivot', refuseSheet: /^\s*raw\s*data\s*$/i, withFill: true });
          const tpl = part.template || {};
          const v = mp59.validatePartSheet(sheet, resolver, now, { scale: mp59.scaleOf(part), scoreColumn: tpl.score_column || null, respondentsColumn: tpl.respondents_column !== false });
          assert.deepStrictEqual(v.errors, [], key);
          v.rows.forEach(r => rows.push({ ...r, part_key: key, metric_id: part.metric_id }));
          if (key === 'DAY1_SURVEY') assert.deepStrictEqual(v.periods, ['2026-09', '2026-10'], 'Nov / Dec rows without a score are skipped');
          if (key === 'EVENT_SATISFACTION') assert.deepStrictEqual(v.columns.event_labels, ['EPICC Podcast', 'Perspektif', 'DLC', 'Young', 'EVD']);
          if (key === 'DAY1_SURVEY') assert.ok(v.rows.some(r => r.questions.some(q => q.value === 'Suitable role')), 'text answers kept');
        }
        const ytd = { mode: 'YTD', year: '2026', month: '01' };
        const pct = (metricId, scale = 5) => {
          const c = mp59.compositeValue(seed59.initialMetricParts.filter(p => p.metric_id === metricId), rows.filter(r => r.metric_id === metricId), ytd, null);
          return Math.round((scale === 100 ? c.value : c.value / 5 * 100) * 100) / 100;
        };
        assert.deepStrictEqual([pct(7), pct(5), pct(12, 100), pct(19), pct(20)], [92.37, 91.07, 99.17, 97, 96.46]);
        const c12 = mp59.compositeValue(seed59.initialMetricParts.filter(p => p.metric_id === 12), rows.filter(r => r.metric_id === 12), ytd, null);
        assert.strictEqual(Math.round(c12.value * 10000) / 10000, 99.1746);
        assert.deepStrictEqual(c12.parts[0].events.map(e => [e.event, e.value === null ? null : Math.round(e.value * 100) / 100]), [['EPICC Podcast', 99.17], ['Perspektif', null], ['DLC', null], ['Young', null], ['EVD', null]]);
        // a workbook whose only sheet is "Raw Data" is refused (personal data is never parsed)
        await assert.rejects(readSheet59(await buildXlsx59([['NIP', 'Name'], ['123', 'X']], { sheetName: 'Raw Data' }), { preferSheet: 'Pivot', refuseSheet: /^\s*raw\s*data\s*$/i }), /is not read/);
      });

      await runTest('[POSITIVE] Upload of a part (stacked months 2004, "Sept" month name, a former directorate name, a text answer, "-" rows): 200, rows stored with the current directorate name, Nov+ months refused only when scored, history + audit METRIC_PART_UPLOAD; the file is not kept', async () => {
        am59 = await createMetric59({ metric_name: `RT59 Composite ${stamp59}` });
        await addPart(am59.metric_id, 'P1', 'Part One', 1, { score_label: 'Part One', question_labels: ['Q1 rating', 'Q2 reason'], respondents_label: 'Jumlah Responden', period_label: 'Periode (Join Date)' });
        await addPart(am59.metric_id, 'P2', 'Part Two', 2, null);
        await addPart(am59.metric_id, 'P3', 'Part Three', 3, null);
        const aliasName = alias59 ? alias59.alias_name : dirB;
        const aliasTarget = alias59 ? alias59.directorate_name : dirB;
        const buf = await buildXlsx59([HEAD,
          ['CIMB Niaga', 'Bankwide', 2004, 'Jan', 4, 4, 'Suitable role', 10, 38000],
          [dirA, 'Directorate', 2004, 'Jan', 3, 3, '=cmd', 4, 38000],
          [aliasName, 'Directorate', 2004, 'Jan', 5, 5, 'Career', 6, 38000],
          ['CIMB Niaga', 'Bankwide', 2004, 'Feb', '-', '-', '-', 0, 38031],
          [dirA, 'Directorate', 2004, 'Feb', 4.5, 4.5, 'x', 2, 38031],
          ['CIMB Niaga', 'Bankwide', 2004, 'Sept', 4.6, 4.6, 'y', 5, 38231]
        ]);
        const { status, body } = await postPart(am59.metric_id, 'P1', buf, 'module59_p1.xlsx');
        assert.strictEqual(status, 200, JSON.stringify(body).slice(0, 400));
        assert.deepStrictEqual([body.rows_imported, body.replaced_rows, body.periods], [6, 0, ['2004-01', '2004-02', '2004-09']]);
        assert.deepStrictEqual(body.bankwide_by_month.map(b => [b.period, b.value]), [['2004-01', 4], ['2004-02', null], ['2004-09', 4.6]]);
        const stored = await st59.getMetricPartResults(am59.metric_id, 'P1');
        assert.ok(stored.some(r => r.directorate === aliasTarget && r.score === 5), 'a former name is stored as the current directorate');
        assert.ok(stored.find(r => r.directorate === dirA && r.month === 1).questions.some(q => q.value === '=cmd'));
        assert.strictEqual(stored.find(r => r.directorate === dirA && r.month === 1).period_text, '2004-01-14', 'Excel date serial -> date');
        const hist = (await (await fetch(`${BASE_URL}/api/admin/metric-parts/${am59.metric_id}`)).json()).parts.find(p => p.part_key === 'P1').uploads;
        assert.ok(hist.length === 1 && hist[0].file_name === 'module59_p1.xlsx' && /^[0-9a-f]{64}$/.test(hist[0].file_sha256));
        const a = (await st59.getAuditLog(30, { includeTest: true })).find(x => x.action === 'METRIC_PART_UPLOAD' && String(x.target).includes(body.upload_id));
        assert.ok(a && a.is_test === true && /P1; 6 rows \(0 replaced\); 2004-01 2004-02 2004-09/.test(a.target), JSON.stringify(a));
      });

      await runTest('[POSITIVE] Scoring: part = average of its months with a value (bankwide rows; "-" month not counted), parts without data are N/A, metric = average of the parts with a value, score = value / 5 x 100; MTD = that month; a directorate filter reads that directorate; several directorates = respondent-weighted', async () => {
        const y = await calc59('mode=YTD&year=2004', am59.metric_id);
        assert.deepStrictEqual([y.raw_value, y.normalized_score, y.parts_with_data, y.metric_parts.map(p => [p.part_key, p.value, p.has_data, p.months_label])],
          [4.3, 86, 1, [['P1', 4.3, true, 'Jan-Sep 2004'], ['P2', null, false, null], ['P3', null, false, null]]]);
        const p2 = await postPart(am59.metric_id, 'P2', await buildXlsx59([HEAD, ['CIMB Niaga', 'Bankwide', 2004, 'Mar', 3.5, 3.5, '-', 8, '']]), 'module59_p2.xlsx');
        assert.strictEqual(p2.status, 200, JSON.stringify(p2.body).slice(0, 300));
        const y2 = await calc59('mode=YTD&year=2004', am59.metric_id);
        assert.deepStrictEqual([y2.raw_value, y2.normalized_score, y2.parts_with_data], [3.9, 78, 2], '(4.3 + 3.5) / 2');
        const feb = await calc59('mode=MTD&year=2004&month=02', am59.metric_id);
        assert.deepStrictEqual([feb.status, feb.raw_value], ['NO_DATA', null], 'February bankwide is "-"');
        const dir = await calc59(`mode=YTD&year=2004&directorate=${encodeURIComponent(dirA)}`, am59.metric_id);
        assert.deepStrictEqual([dir.raw_value, dir.parts_with_data], [3.75, 1], `${dirA}: (3 + 4.5) / 2`);
        const pooled = mp59.compositeValue(await st59.getMetricParts(am59.metric_id), await st59.getMetricPartResults(am59.metric_id), { mode: 'MTD', year: '2004', month: '01' },
          { directorates: [dirA, alias59 ? alias59.directorate_name : dirB] });
        assert.strictEqual(pooled.parts[0].value, (3 * 4 + 5 * 6) / 10, 'respondent-weighted mean of two directorates');
        const d = await detail59(am59.metric_id, 'mode=YTD&year=2004');
        assert.deepStrictEqual([d.current_raw_value, d.normalized_score, d.composite.parts_with_data, d.parts.map(p => p.months_count), d.last_update_label, d.total_respondents],
          [3.9, 78, 2, [2, 1, 0], 'September 2004', 23]);
      });

      await runTest('[POSITIVE] Re-upload of a part replaces only the months in the file (January 2004 replaced, September kept); template = the part layout (latest upload columns / generic Q1..Q3); evidence CSV = stored rows with question headers, formula-escaped', async () => {
        const { status, body } = await postPart(am59.metric_id, 'P1', await buildXlsx59([HEAD, ['CIMB Niaga', 'Bankwide', 2004, 'January', 2, 2, '-', 3, '']]), 'module59_p1_again.xlsx');
        assert.strictEqual(status, 200, JSON.stringify(body).slice(0, 300));
        assert.strictEqual(body.replaced_rows, 3, 'the 3 January rows');
        const rows = await st59.getMetricPartResults(am59.metric_id, 'P1');
        assert.deepStrictEqual(rows.map(r => `${r.month}:${r.org_level}`).sort(), ['1:BANKWIDE', '2:BANKWIDE', '2:DIRECTORATE', '9:BANKWIDE']);
        const t = await fetch(`${BASE_URL}/api/admin/metric-parts/${am59.metric_id}/P1/template`);
        assert.strictEqual(t.status, 200);
        const tr = await readSheet59(Buffer.from(await t.arrayBuffer()));
        assert.deepStrictEqual(tr[0].cells.map(c => c.value), HEAD.slice(0, 4).concat(['Part Score', 'Q1 rating', 'Q2 reason', 'Jumlah Responden', 'Periode (Join Date)']));
        assert.deepStrictEqual(tr[1].cells.slice(0, 2).map(c => c.value), ['CIMB Niaga', 'Bankwide']);
        const t3 = await readSheet59(Buffer.from(await (await fetch(`${BASE_URL}/api/admin/metric-parts/${am59.metric_id}/P3/template`)).arrayBuffer()));
        assert.deepStrictEqual(t3[0].cells.map(c => c.value), ['Directorate', 'Level', 'Year', 'Month', 'Part Three', 'Q1', 'Q2', 'Q3', 'Jumlah Responden', 'Periode']);
        const lines = csv59(await (await fetch(`${BASE_URL}/api/admin/metric-parts/${am59.metric_id}/P1/evidence?period=2004`)).text());
        assert.strictEqual(lines[0], 'Metric_ID,Metric_Name,Part,Directorate,Level,Year,Month,Period,Part_Score,Q1 rating,Q2 reason,Jumlah_Responden,Periode,Has_Value,Upload_ID,File_Name,File_SHA256,Uploaded_By,Uploaded_At');
        assert.strictEqual(lines.length, 5);
        const feb = csv59(await (await fetch(`${BASE_URL}/api/admin/metric-parts/${am59.metric_id}/P1/evidence?period=2004-02`)).text());
        assert.ok(feb.some(l => l.includes(',Bankwide,2004,February,2004-02,-,-,-,0,') && l.includes(',NO,')), feb.join('\n'));
        const all = await (await fetch(`${BASE_URL}/api/admin/metric-parts/${am59.metric_id}/P1/evidence`)).text();
        assert.ok(!all.includes(',=cmd'), 'the January row with "=cmd" was replaced');
        const rowsP1 = await st59.getMetricPartResults(am59.metric_id, 'P1');
        assert.ok(rowsP1.every(r => !r.questions.some(q => q.value === '=cmd')));
      });

      await runTest('[NEGATIVE] A bad summary file is refused as a whole (400, every error with row + column, nothing stored): unknown directorate, score 6, bad month, a future month with a score, a duplicate row, respondents -1, no "Jumlah Responden" header; .csv -> 415; unknown part / metric without parts -> 404; bad id -> 400', async () => {
        const before = (await st59.getMetricPartResults(am59.metric_id)).length;
        const now = new Date();
        const bad = await postPart(am59.metric_id, 'P1', await buildXlsx59([HEAD,
          ['Nowhere Directorate', 'Directorate', 2004, 'Jan', 4, 4, '', 1, ''],
          ['CIMB Niaga', 'Bankwide', 2004, 'Jan', 6, 4, '', 1, ''],
          ['CIMB Niaga', 'Bankwide', 2004, 'Smarch', 4, 4, '', 1, ''],
          ['CIMB Niaga', 'Bankwide', now.getFullYear() + 1, 'Jan', 4, 4, '', 1, ''],
          [dirA, 'Directorate', 2004, 'Apr', 4, 4, '', 1, ''],
          [dirA, 'Directorate', 2004, 'April', 4, 4, '', 1, ''],
          [dirA, 'Directorate', 2004, 'May', 4, 4, '', -1, '']
        ]), 'module59_bad.xlsx');
        assert.strictEqual(bad.status, 400);
        assert.ok(/nothing was stored/.test(bad.body.error));
        const got = bad.body.errors.map(e => [e.row_number, e.column]);
        assert.deepStrictEqual(got, [[2, 'A'], [3, 'E'], [4, 'D'], [5, 'D'], [7, 'A'], [8, 'H']], JSON.stringify(bad.body.errors));
        assert.ok(/not in the directorate master/.test(bad.body.errors[0].reason) && /between 1 and 5|from 1 to 5/.test(bad.body.errors[1].reason) && /in the future/.test(bad.body.errors[3].reason) && /more than once/.test(bad.body.errors[4].reason));
        const noResp = await postPart(am59.metric_id, 'P1', await buildXlsx59([['Directorate', 'Level', 'Year', 'Month', 'Score', 'Q1'], ['CIMB Niaga', 'Bankwide', 2004, 'Jan', 4, 4]]));
        assert.deepStrictEqual([noResp.status, /Jumlah Responden/.test(noResp.body.errors[0].reason)], [400, true]);
        const fd = new FormData();
        fd.append('file', new Blob(['a,b']), 'x.csv');
        assert.strictEqual((await fetch(`${BASE_URL}/api/admin/metric-parts/${am59.metric_id}/P1/upload`, { method: 'POST', body: fd })).status, 415);
        assert.strictEqual((await fetch(`${BASE_URL}/api/admin/metric-parts/${am59.metric_id}/NOPE/template`)).status, 404);
        assert.strictEqual((await fetch(`${BASE_URL}/api/admin/metric-parts/14`)).status, 404, 'metric 14 has no parts');
        assert.strictEqual((await fetch(`${BASE_URL}/api/admin/metric-parts/abc`)).status, 400);
        assert.strictEqual((await st59.getMetricPartResults(am59.metric_id)).length, before, 'nothing stored');
      });

      await runTest('[POSITIVE] A % part with event blocks (structural fallback without header fill): per-event averages, the part score is the % itself (no / 5); evidence in long format Event | Question | Value', async () => {
        const m = await createMetric59({ metric_name: `RT59 Events ${stamp59}`, scale_type: 'PERCENTAGE', target_value: 80, target_display: '> 80%' });
        await addPart(m.metric_id, 'EV', 'Events', 1, { score_scale: 'PERCENT' });
        const Q = ['Makna', 'Hadir lagi'];
        const head = ['Directorate', 'Level', 'Year', 'Month', 'Satisfaction Event', 'Event A', ...Q, 'Event B', ...Q, 'Periode (Start time)', 'Jumlah Responden Valid'];
        const up = await postPart(m.metric_id, 'EV', await buildXlsx59([head,
          ['CIMB Niaga', 'Bankwide', 2004, 'Sep', 90, 90, 100, 80, '-', '-', '-', 38231, 20],
          ['CIMB Niaga', 'Bankwide', 2004, 'Oct', 96, 94, 100, 88, 98, 100, 96, 38261, 10]
        ]), 'module59_events.xlsx');
        assert.strictEqual(up.status, 200, JSON.stringify(up.body).slice(0, 300));
        assert.deepStrictEqual(up.body.columns.event_labels, ['Event A', 'Event B']);
        const y = await calc59('mode=YTD&year=2004', m.metric_id);
        assert.deepStrictEqual([y.raw_value, y.normalized_score], [93, 93]);
        const d = await detail59(m.metric_id, 'mode=YTD&year=2004');
        assert.deepStrictEqual(d.parts[0].events.map(e => [e.event, e.value, e.months_count]), [['Event A', 92, 2], ['Event B', 98, 1]]);
        const lines = csv59(await (await fetch(`${BASE_URL}/api/admin/metric-parts/${m.metric_id}/EV/evidence?period=2004-10`)).text());
        assert.ok(lines[0].includes(',Event,Question,Value,'));
        assert.strictEqual(lines.length, 1 + 6, 'one line per event / question of the October row');
        assert.ok(lines.some(l => l.includes(',Event B,(event score),98,')) && lines.some(l => l.includes(',Event A,Hadir lagi,88,')));
      });

      await runTest('[POSITIVE] OUTCOME score-column part (metrics 19 / 20 layout: one combined file, no respondents column): static raw_value until the first upload, then the average of the months; each metric reads its own column by header text; several directorates = plain mean', async () => {
        const m = await createMetric59({ metric_name: `RT59 Learning ${stamp59}`, metric_type: 'OUTCOME', raw_value: 4.2 });
        await addPart(m.metric_id, 'ML', 'Mandatory', 1, { score_label: 'Mandatory Learning', score_column: 'Mandatory Learning', respondents_column: false, question_labels: [] });
        const before = await calc59('mode=YTD&year=2004', m.metric_id);
        assert.deepStrictEqual([before.raw_value, before.has_data, before.data_upload, before.parts_with_data], [4.2, true, 'PART_SUMMARY', 0], 'static value before any upload');
        const dBefore = await detail59(m.metric_id, 'mode=YTD&year=2004');
        assert.deepStrictEqual([dBefore.data_upload, dBefore.outcome_upload, dBefore.current_raw_value], ['PART_SUMMARY', false, 4.2]);
        const head = ['Directorate', 'Level', 'Year', 'Month', 'Mandatory Learning', 'Non Mandatory Learning'];
        const up = await postPart(m.metric_id, 'ML', await buildXlsx59([head,
          ['CIMB Niaga', 'Bankwide', 2004, 'Jun', 4.8, 1.0],
          ['CIMB Niaga', 'Bankwide', 2004, 'Jul', 4.6, 1.0],
          [dirA, 'Directorate', 2004, 'Jun', 4.0, '-'],
          [dirB, 'Directorate', 2004, 'Jun', 5.0, '-'],
          [dirA, 'Directorate', 2004, 'Jul', '-', 2]
        ]), 'module59_learning.xlsx');
        assert.strictEqual(up.status, 200, JSON.stringify(up.body).slice(0, 300));
        const y = await calc59('mode=YTD&year=2004', m.metric_id);
        assert.deepStrictEqual([y.raw_value, y.normalized_score], [4.7, 94]);
        const two = mp59.compositeValue(await st59.getMetricParts(m.metric_id), await st59.getMetricPartResults(m.metric_id), { mode: 'MTD', year: '2004', month: '06' }, { directorates: [dirA, dirB] });
        assert.strictEqual(two.parts[0].value, 4.5, 'plain mean (no respondents column)');
        const t = await readSheet59(Buffer.from(await (await fetch(`${BASE_URL}/api/admin/metric-parts/${m.metric_id}/ML/template`)).arrayBuffer()));
        assert.deepStrictEqual(t[0].cells.map(c => c.value), ['Directorate', 'Level', 'Year', 'Month', 'Mandatory Learning']);
        const miss = await postPart(m.metric_id, 'ML', await buildXlsx59([['Directorate', 'Level', 'Year', 'Month', 'Other'], ['CIMB Niaga', 'Bankwide', 2004, 'Jun', 4]]));
        assert.deepStrictEqual([miss.status, /no column "Mandatory Learning"/.test(miss.body.errors[0].reason)], [400, true]);
      });

      await runTest('[POSITIVE] JSON backend in-process (same contract): saveMetricPartUpload replaces the months of the file, results / uploads read back like SQL Server, respondents null kept; store.json and auth.json restored byte-identically', async () => {
        const dataDir = path59.join(__dirname, '..', 'server', 'data');
        const files = ['store.json', 'auth.json'].map(f => path59.join(dataDir, f));
        const saved = files.map(f => (fs59.existsSync(f) ? fs59.readFileSync(f) : null));
        const fakeId = 990000 + Math.floor(Math.random() * 9000);
        const row = (y, m, score, respondents, extra = {}) => ({ org_level: 'BANKWIDE', directorate: null, year: y, month: m, score, respondents, questions: [{ label: 'Q', value: 'txt' }], period_text: null, ...extra });
        const run = async st => {
          const a = await st.saveMetricPartUpload({ upload_id: `rt59-a-${stamp59}`, metric_id: fakeId, part_key: 'K', file_name: 'a.xlsx', file_sha256: 'f'.repeat(64), uploaded_by: 'RT59', periods: ['2004-01', '2004-02'], columns: { score_label: 'S' } },
            [row(2004, 1, 4, 3), row(2004, 2, null, 0), row(2004, 1, 3.5, null, { org_level: 'DIRECTORATE', directorate: dirA })]);
          const b = await st.saveMetricPartUpload({ upload_id: `rt59-b-${stamp59}`, metric_id: fakeId, part_key: 'K', file_name: 'b.xlsx', uploaded_by: 'RT59', periods: ['2004-02'], columns: null }, [row(2004, 2, 4.25, 7)]);
          return {
            saves: [a.replaced, b.replaced, a.record.total_rows, b.record.total_rows],
            rows: (await st.getMetricPartResults(fakeId)).map(r => [r.part_key, r.org_level, r.directorate, r.year, r.month, r.score, r.respondents, r.questions, r.upload_id.replace(stamp59, '')]),
            uploads: (await st.getMetricPartUploads(fakeId, 'K')).map(u => [u.upload_id.replace(stamp59, ''), u.total_rows, u.replaced_rows, u.periods, u.columns])
          };
        };
        let jsonOut;
        let sqlOut;
        try {
          jsonOut = await run(require('../server/db/jsonStorage'));
          sqlOut = await run(st59);
        } finally {
          files.forEach((f, i) => { if (saved[i] === null) { if (fs59.existsSync(f)) fs59.unlinkSync(f); } else fs59.writeFileSync(f, saved[i]); });
          await q59('DELETE FROM dbo.px_metric_part_results WHERE metric_id = @id; DELETE FROM dbo.px_metric_part_uploads WHERE metric_id = @id', { id: fakeId });
        }
        files.forEach((f, i) => assert.ok(saved[i] === null ? !fs59.existsSync(f) : Buffer.compare(fs59.readFileSync(f), saved[i]) === 0, `${path59.basename(f)} restored byte-identically`));
        assert.deepStrictEqual(jsonOut, sqlOut);
        assert.deepStrictEqual(sqlOut.saves, [0, 1, 3, 1]);
        assert.deepStrictEqual(sqlOut.rows.map(r => [r[1], r[4], r[5], r[6]]), [['BANKWIDE', 1, 4, 3], ['DIRECTORATE', 1, 3.5, null], ['BANKWIDE', 2, 4.25, 7]]);
      });

      await runTest('[POSITIVE] Deleting a composite metric deletes its parts, summary rows and uploads (documented cascade); the live metrics 5 / 7 / 12 / 19 / 20 part rows are untouched by this module', async () => {
        const id = am59.metric_id;
        assert.strictEqual((await adminJson('DELETE', `/api/admin/metrics/${id}`)).status, 200);
        metricIds59.splice(metricIds59.indexOf(id), 1);
        assert.deepStrictEqual([(await st59.getMetricParts(id)).length, (await st59.getMetricPartResults(id)).length, (await st59.getMetricPartUploads(id)).length], [0, 0, 0]);
        assert.strictEqual(await live59(), liveBefore59);
      });
    } finally {
      for (const id of [...metricIds59].reverse()) await adminJson('DELETE', `/api/admin/metrics/${id}`);
      await pool59.close();
    }
  }

  // --- MODULE 60 (v2.55.0): "REAL DATA NOT AVAILABLE YET" SWITCH (px_metrics.data_status; live 4, 6, 8, 10, 23, 26 = N/A) ---
  // Switches only a metric this module creates; the six live metrics are only read.
  console.log('\n📦 MODULE 60: "Real data not available yet" switch - N/A, out of every index, records hidden (Positive & Negative Testing)');
  if (!skipModuleBlock(60)) {
    const st60 = require('../server/db/storage');
    let m60 = null;
    await setLegacyFixtures(false); // the live N/A state of 4, 6, 8, 10, 23, 26
    try {
      await runTest('[POSITIVE] Live: metrics 4, 6, 8, 10, 23, 26 are N/A ("Real data not available yet"), out of the Survey / Outcome index; their detail shows no records / responses / question scores', async () => {
        const calc = await (await fetch(`${BASE_URL}/api/metrics/calculate?mode=YTD`)).json();
        for (const id of [4, 6, 8, 10, 23, 26].filter(isLiveMetric)) {
          const m = calc.metrics.find(x => x.metric_id === id);
          assert.strictEqual((await st60.getMetricById(id)).data_status, 'NOT_AVAILABLE', `metric ${id}`);
          assert.deepStrictEqual([m.status, m.not_applicable, m.not_applicable_reason, m.data_not_available, m.raw_value, m.normalized_score], ['NO_DATA', true, 'Real data not available yet', true, null, null], `metric ${id}`);
        }
        const surveys = calc.metrics.filter(x => x.metric_type === 'SURVEY' && x.has_data);
        assert.ok(!surveys.some(x => [6, 8, 10, 23, 26].includes(x.metric_id)));
        const expected = surveys.reduce((a, x) => a + x.normalized_score * x.weight, 0) / surveys.reduce((a, x) => a + x.weight, 0);
        assert.ok(Math.abs(calc.survey_index - expected) < 0.01, 'Survey Index without the N/A metrics');
        const d8 = await (await fetch(`${BASE_URL}/api/metrics/8/detail?mode=YTD`)).json();
        assert.deepStrictEqual([d8.not_applicable_reason, d8.responses.length, d8.questions_breakdown.length, d8.total_respondents, d8.current_raw_value], ['Real data not available yet', 0, 0, 0, null]);
        if (isLiveMetric(4)) { // the Admin deleted metric 4 live (v2.58.0)
          const d4 = await (await fetch(`${BASE_URL}/api/metrics/4/detail?mode=YTD`)).json();
          assert.deepStrictEqual([d4.operational_records.length, d4.status, d4.data_not_available], [0, 'NO_DATA', true]);
        }
      });

      await runTest('[POSITIVE] The switch on a metric: ticked -> N/A and out of the Outcome Index (and back in when unticked, data kept); audited METRIC_UPDATE; bad value -> 400', async () => {
        const r = await adminJson('POST', '/api/admin/metrics', { metric_name: `RT60 Switch ${Date.now().toString(36)}`, metric_type: 'OUTCOME', scale_type: 'PERCENTAGE', journey_id: 1, checkpoint_id: 1, raw_value: 10, target_value: 85, min_threshold: 75, weight: 1 });
        const b = await r.json();
        assert.strictEqual(r.status, 201, JSON.stringify(b).slice(0, 200));
        m60 = b.metric;
        const idx = async () => (await (await fetch(`${BASE_URL}/api/metrics/calculate?mode=YTD`)).json());
        const on = await idx();
        assert.strictEqual(on.metrics.find(x => x.metric_id === m60.metric_id).raw_value, 10);
        assert.strictEqual((await adminJson('PUT', `/api/admin/metrics/${m60.metric_id}`, { data_not_available: true })).status, 200);
        const off = await idx();
        const mo = off.metrics.find(x => x.metric_id === m60.metric_id);
        assert.deepStrictEqual([mo.status, mo.not_applicable, mo.not_applicable_reason], ['NO_DATA', true, 'Real data not available yet']);
        assert.ok(off.outcome_index > on.outcome_index, 'a 10% metric left the Outcome Index');
        const a = (await st60.getAuditLog(20, { includeTest: true })).find(x => x.action === 'METRIC_UPDATE' && String(x.target).startsWith(`#${m60.metric_id}`));
        assert.ok(a && /data_status/.test(a.target), JSON.stringify(a));
        assert.strictEqual((await adminJson('PUT', `/api/admin/metrics/${m60.metric_id}`, { data_status: 'MAYBE' })).status, 400);
        assert.strictEqual((await adminJson('PUT', `/api/admin/metrics/${m60.metric_id}`, { data_not_available: 'yes' })).status, 400);
        assert.strictEqual((await adminJson('PUT', `/api/admin/metrics/${m60.metric_id}`, { data_status: 'AVAILABLE' })).status, 200);
        const back = await idx();
        assert.strictEqual(back.metrics.find(x => x.metric_id === m60.metric_id).raw_value, 10);
        assert.ok(Math.abs(back.outcome_index - on.outcome_index) < 0.01);
        assert.strictEqual((await st60.getMetricById(m60.metric_id)).data_status, 'AVAILABLE', 'stored explicitly, so the boot never sets it back');
      });
    } finally {
      if (m60) await adminJson('DELETE', `/api/admin/metrics/${m60.metric_id}`);
    }
  }

  // --- MODULE 61 (v2.56.0): HISTORY TAB (GET /api/metrics/:id/history = the rows of the metric's Evidence download) ---
  // Read-only on the live data; a temporary USER account (is_test_account) is created on SQL Server and deleted at the end.
  console.log('\n📦 MODULE 61: History tab - the rows behind the Evidence download of each metric, per kind (Positive & Negative Testing)');
  if (!skipModuleBlock(61)) {
    const st61 = require('../server/db/storage');
    const JSZip61 = require('jszip');
    // RFC 4180 rows of a CSV text (quoted cells may hold commas / newlines); the header line is dropped
    const csvRows61 = text => {
      const t = String(text).replace(/^﻿/, '');
      const rows = []; let row = [], cell = '', q = false;
      for (let i = 0; i < t.length; i++) {
        const c = t[i];
        if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
        else if (c === '"') q = true;
        else if (c === ',') { row.push(cell); cell = ''; }
        else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
        else cell += c;
      }
      if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
      return rows.slice(1);
    };
    // every data row of an evidence download (CSV, or the .zip of question-set versions)
    const evidenceRows61 = async p => {
      const res = await fetch(`${BASE_URL}${p}`);
      assert.strictEqual(res.status, 200, `${p} -> ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (!/zip/.test(res.headers.get('content-type') || '')) return csvRows61(buf.toString('utf8'));
      const zip = await JSZip61.loadAsync(buf);
      const out = [];
      for (const name of Object.keys(zip.files).filter(n => /\.csv$/i.test(n))) out.push(...csvRows61(await zip.files[name].async('string')));
      return out;
    };
    const history61 = async (id, query = 'period=2026', cookie = null) => {
      const res = cookie ? await rawFetch(`${BASE_URL}/api/metrics/${id}/history?${query}`, asUser(cookie)) : await fetch(`${BASE_URL}/api/metrics/${id}/history?${query}`);
      return { status: res.status, body: await res.json().catch(() => null) };
    };
    const keys61 = h => h.columns.map(c => c.key);
    let user61 = null;
    let userCookie61 = null;
    let userDir61 = null;
    try {
      await runTest('[POSITIVE] OUTCOME monthly values (metric 14 LATEST, metrics 1 / 3 AVERAGE): kind OUTCOME_VALUES, same rows as the outcome evidence CSV (YTD year, one month, ALL), newest first, one "Average" line heading each year for AVERAGE metrics; mode/year/month = period', async () => {
        for (const id of [14, 1, 3]) {
          for (const period of ['2026', '2026-09', 'ALL']) {
            const { status, body } = await history61(id, `period=${period}`);
            assert.strictEqual(status, 200, `metric ${id} ${period}`);
            assert.strictEqual(body.kind, 'OUTCOME_VALUES', `metric ${id}`);
            const ev = await evidenceRows61(`/api/admin/outcome-evidence/${id}?period=${period}`);
            assert.strictEqual(body.total, ev.length, `metric ${id} ${period}: history ${body.total} vs evidence ${ev.length}`);
            assert.strictEqual(body.rows.length, body.total);
            assert.ok(['Period', 'Value', 'Notes', 'Source', 'Used_In_Score', 'Uploaded_By', 'Uploaded_At'].every(k => keys61(body).includes(k)), keys61(body).join('|'));
            assert.deepStrictEqual(body.rows.map(r => String(r.Period)).sort(), ev.map(r => r[5]).sort(), `metric ${id} ${period}: same periods`);
            const months = body.rows.filter(r => r.Period !== 'Average').map(r => r.Period);
            assert.deepStrictEqual(months, [...months].sort().reverse(), 'newest first');
            if (id !== 14) {
              const years = [...new Set(months.map(p => p.slice(0, 4)))];
              assert.strictEqual(body.rows.filter(r => r.Period === 'Average').length, years.length, `metric ${id}: one Average line per year`);
              years.forEach(y => assert.strictEqual(body.rows.find(r => String(r.Year) === y).Period, 'Average', `metric ${id} ${y}: the Average line heads its year`));
            }
          }
        }
        const viaMode = await history61(14, 'mode=MTD&year=2026&month=09');
        const viaPeriod = await history61(14, 'period=2026-09');
        assert.deepStrictEqual(viaMode.body.rows, viaPeriod.body.rows);
        assert.strictEqual(viaMode.body.period, '2026-09');
        assert.strictEqual((await history61(14, 'mode=YTD&year=2026')).body.period, '2026');
      });

      await runTest('[POSITIVE] Summary-part metrics (5, 7, 12, 19, 20): kind PARTS, rows = the rows of every part evidence CSV together (Part column), newest first; metric 12 per event / question', async () => {
        for (const id of [5, 7, 12, 19, 20]) {
          const { status, body } = await history61(id, 'period=2026');
          assert.strictEqual(status, 200);
          assert.strictEqual(body.kind, 'PARTS', `metric ${id}`);
          let ev = [];
          for (const p of await st61.getMetricParts(id)) ev = ev.concat(await evidenceRows61(`/api/admin/metric-parts/${id}/${p.part_key}/evidence?period=2026`));
          assert.strictEqual(body.total, ev.length, `metric ${id}: history ${body.total} vs evidence ${ev.length}`);
          assert.ok(['Part', 'Directorate', 'Level', 'Year', 'Month', 'Part_Score', 'Jumlah_Responden', 'Periode'].every(k => keys61(body).includes(k)), `metric ${id}: ${keys61(body).join('|')}`);
          assert.deepStrictEqual([...new Set(body.rows.map(r => r.Part))].sort(), [...new Set(ev.map(r => r[2]))].sort());
          const periods = body.rows.map(r => r.Period);
          assert.deepStrictEqual(periods, [...periods].sort().reverse(), `metric ${id}: newest first`);
          if (id === 12 && body.total) assert.ok(['Event', 'Question', 'Value'].every(k => keys61(body).includes(k)), 'metric 12: per event / question');
        }
      });

      await runTest('[POSITIVE] ESS metrics: kind ESS, rows = the ESS evidence rows (every period, Directorate + Bankwide rows, participation, index, question scores)', async () => {
        const ess = (await st61.getMetrics()).filter(m => m.metric_type === 'SURVEY' && m.survey_source === 'ESS' && m.data_status !== 'NOT_AVAILABLE');
        assert.ok(ess.length >= 1);
        for (const m of ess) {
          const { status, body } = await history61(m.metric_id, 'period=2026-09');
          assert.strictEqual(status, 200);
          assert.strictEqual(body.kind, 'ESS', `metric ${m.metric_id}`);
          const ev = await evidenceRows61(`/api/surveys/evidence?metric_id=${m.metric_id}&period=2026-09`);
          assert.strictEqual(body.total, ev.length, `metric ${m.metric_id}: history ${body.total} vs evidence ${ev.length}`);
          assert.ok(['Directorate', 'Level', 'Participation', 'Index_%'].every(k => keys61(body).includes(k)));
          assert.deepStrictEqual(body.rows.map(r => `${r.Directorate}|${r.Level}`).sort(), ev.map(r => `${r[0]}|${r[1]}`).sort());
        }
      });

      await runTest('[POSITIVE] SYSTEM survey metric 2 (Admin): kind SURVEY_RESPONSES, same respondents as the survey evidence (identity columns included), newest survey date first', async () => {
        for (const period of ['2026', '2026-09']) {
          const { status, body } = await history61(2, `period=${period}`);
          assert.strictEqual(status, 200);
          assert.strictEqual(body.kind, 'SURVEY_RESPONSES');
          assert.strictEqual(body.identity_hidden, false);
          const ev = await evidenceRows61(`/api/surveys/evidence?metric_id=2&period=${period}`);
          assert.strictEqual(body.total, ev.length, `${period}: history ${body.total} vs evidence ${ev.length}`);
          assert.ok(['ID_Peserta', 'Nama_Peserta', 'Email_Peserta', 'Tanggal_Survei_Dilakukan'].every(k => keys61(body).includes(k)));
          assert.deepStrictEqual(body.rows.map(r => String(r.ID_Peserta)).sort(), ev.map(r => r[0].replace(/^'/, '')).sort());
          const dates = body.rows.map(r => r.Tanggal_Survei_Dilakukan);
          assert.deepStrictEqual(dates, [...dates].sort().reverse());
        }
      });

      await runTest('[POSITIVE] Metric 11 (Admin): kind EVENT_ATTENDANCE, same attendances as its evidence (NIP / name / e-mail included)', async () => {
        for (const period of ['ALL', '2026']) {
          const { status, body } = await history61(11, `period=${period}`);
          assert.strictEqual(status, 200);
          assert.strictEqual(body.kind, 'EVENT_ATTENDANCE');
          const ev = await evidenceRows61(`/api/admin/outcome-evidence/11?period=${period}`);
          assert.strictEqual(body.total, ev.length);
          assert.ok(['NIP', 'Employee_Name', 'CIMB_Email', 'Event_Name', 'Directorate', 'Attendance_Timestamp'].every(k => keys61(body).includes(k)));
        }
      });

      await runTest('[POSITIVE] N/A metrics (data_status NOT_AVAILABLE, live 4, 6, 8, 10, 23, 26): History empty with the reason, while their evidence still holds the stored rows', async () => {
        let checked = 0;
        for (const id of [4, 6, 8, 10, 23, 26].filter(isLiveMetric)) {
          if ((await st61.getMetricById(id)).data_status !== 'NOT_AVAILABLE') continue;
          const { status, body } = await history61(id, 'period=2026');
          assert.strictEqual(status, 200);
          assert.deepStrictEqual([body.kind, body.total, body.rows.length, body.reason], ['NOT_AVAILABLE', 0, 0, 'Real data not available yet'], `metric ${id}`);
          checked++;
        }
        assert.ok(checked >= 1, 'at least one N/A metric');
        if ((await st61.getMetricById(8)).data_status === 'NOT_AVAILABLE') {
          assert.ok((await evidenceRows61('/api/surveys/evidence?metric_id=8&period=2026')).length > 0, 'metric 8 keeps its data (evidence still downloadable)');
        }
      });

      if (st61.backend === 'sql') {
        // a USER scoped to one directorate that has ESS directorate rows
        const essAdmin = (await history61(9, 'period=2026')).body;
        userDir61 = (essAdmin.rows.find(r => r.Level === 'Directorate') || {}).Directorate;
        const pw61 = require('crypto').randomBytes(9).toString('hex') + 'Aa1';
        user61 = await st61.createUser({ is_test_account: true, username: `rt61u${Date.now().toString(36)}`, full_name: 'Regression 61 User', email: '', role: 'USER',
          password_hash: await require('../server/services/authService').hashPassword(pw61), must_change_password: false, scopes: [{ directorate: userDir61, divisions: null }] });
        userCookie61 = (await loginAs(user61.username, pw61)).cookie;

        await runTest('[POSITIVE] USER: survey rows without identity columns (metric 2, non-employee = every row), attendances without identity and only of own directorates (metric 11), ESS / part rows only of own directorates (no Bankwide row), OUTCOME values unchanged', async () => {
          assert.ok(userDir61 && userCookie61, 'USER login');
          const a2 = (await history61(2, 'period=2026')).body;
          const u2 = await history61(2, 'period=2026', userCookie61);
          assert.strictEqual(u2.status, 200);
          assert.strictEqual(u2.body.identity_hidden, true);
          assert.ok(!['ID_Peserta', 'Nama_Peserta', 'Email_Peserta'].some(k => keys61(u2.body).includes(k)), keys61(u2.body).join('|'));
          assert.ok(!u2.body.rows.some(r => 'ID_Peserta' in r || 'Nama_Peserta' in r || 'Email_Peserta' in r));
          assert.strictEqual(u2.body.total, a2.total, 'non-employee survey: the same respondents, without identity');
          assert.strictEqual((await rawFetch(`${BASE_URL}/api/surveys/evidence?metric_id=2&period=2026`, asUser(userCookie61))).status, 403, 'the survey evidence itself stays Admin / PIC only');

          const u11 = (await history61(11, 'period=ALL', userCookie61)).body;
          assert.ok(!['NIP', 'Employee_Name', 'CIMB_Email'].some(k => keys61(u11).includes(k)));
          assert.ok(u11.rows.every(r => r.Directorate === userDir61 && !('NIP' in r)));

          const u9 = (await history61(9, 'period=2026', userCookie61)).body;
          assert.strictEqual(u9.scope_limited, true);
          assert.ok(u9.total >= 1 && u9.rows.every(r => r.Level === 'Directorate' && r.Directorate === userDir61), JSON.stringify(u9.rows.map(r => r.Directorate)));
          assert.strictEqual(u9.total, essAdmin.rows.filter(r => r.Level === 'Directorate' && r.Directorate === userDir61).length);

          const u7 = (await history61(7, 'period=2026', userCookie61)).body;
          assert.ok(u7.rows.every(r => r.Level === 'Directorate' && r.Directorate === userDir61));

          const a14 = (await history61(14, 'period=2026')).body;
          const u14 = (await history61(14, 'period=2026', userCookie61)).body;
          assert.deepStrictEqual(u14.rows, a14.rows, 'OUTCOME values are bankwide aggregates');
        });

        await runTest('[NEGATIVE] USER asking a directorate outside the scope -> 403; the Admin-only evidence downloads stay 403 for the USER', async () => {
          const other = (await (await rawFetch(`${BASE_URL}/api/directorates`)).json()).find(d => d.directorate_name !== userDir61);
          assert.strictEqual((await history61(9, `period=2026&directorate=${encodeURIComponent(other.directorate_name)}`, userCookie61)).status, 403);
          assert.strictEqual((await rawFetch(`${BASE_URL}/api/admin/outcome-evidence/14?period=2026`, asUser(userCookie61))).status, 403);
        });
      }

      await runTest('[NEGATIVE] No login -> 401; malformed id -> 400; unknown metric -> 404; bad period -> 400', async () => {
        assert.strictEqual((await rawFetch(`${BASE_URL}/api/metrics/14/history?period=2026`)).status, 401);
        for (const bad of ['abc', '1.5', '-3', '%2014']) assert.strictEqual((await history61(bad)).status, 400, `id ${bad}`);
        assert.strictEqual((await history61(999999)).status, 404);
        for (const p of ['2026-13', 'garbage', '20261', '2026-9x']) assert.strictEqual((await history61(14, `period=${encodeURIComponent(p)}`)).status, 400, `period ${p}`);
      });
    } finally {
      if (user61) await st61.deleteUser(user61.user_id);
    }
  }

  // --- MODULE 62 (v2.57.0): SUMMARY QUESTIONS (Admin Parameters -> Summary Questions; px_metric_parts.questions_json) ---
  // The live parts (5, 7, 12, 19, 20) are only read. Edits / uploads go to metrics this module creates (parts inserted through
  // SQL, deleted at the end with their parts, rows and uploads - the metric-delete cascade) and to far-past months (2003). A
  // temporary USER (is_test_account) is created and deleted. The HTTP part is SQL only; the JSON contract is checked in-process
  // with store.json / auth.json restored byte-identically.
  console.log('\n📦 MODULE 62: Summary Questions - configured questions per summary part, by-position upload, template, snapshot in History / Evidence (Positive & Negative Testing)');
  if (require('../server/db/storage').backend !== 'sql') {
    console.log('  ⏭️  SKIPPED: Module 62 needs the SQL Server backend (its fixture parts are inserted through SQL)');
  } else if (!skipModuleBlock(62)) {
    const st62 = require('../server/db/storage');
    const pq62 = require('../server/db/partQuestions');
    const { buildXlsx: buildXlsx62, readFirstSheet: readSheet62 } = require('../server/services/xlsxUtils');
    const fs62 = require('fs');
    const path62 = require('path');
    const sql62 = require('mssql');
    const pool62 = await new sql62.ConnectionPool({ server: process.env.DB_SERVER || 'localhost', port: parseInt(process.env.DB_PORT || '1433', 10), database: process.env.DB_NAME || 'PeopleExperiencePX',
      user: process.env.DB_USER, password: process.env.DB_PASSWORD, options: { encrypt: false, trustServerCertificate: true } }).connect();
    const q62 = async (text, params = {}) => {
      const r = pool62.request();
      Object.entries(params).forEach(([k, v]) => r.input(k, v));
      return (await r.query(text)).recordset || [];
    };
    const stamp62 = Date.now().toString(36);
    const metricIds62 = [];
    const addPart62 = (metricId, key, name, order, template = null) => q62('INSERT INTO dbo.px_metric_parts (metric_id, part_key, part_name, sort_order, template_json) VALUES (@m, @k, @n, @o, @t)',
      { m: metricId, k: key, n: name, o: order, t: template ? JSON.stringify(template) : null });
    const createMetric62 = async body => {
      const r = await adminJson('POST', '/api/admin/metrics', { journey_id: 1, checkpoint_id: 4, metric_type: 'SURVEY', scale_type: 'RATING_5', target_value: 4, target_display: '> 4.00 / 5', min_threshold: 75, is_employee_metric: true, ...body });
      const b = await r.json();
      assert.strictEqual(r.status, 201, JSON.stringify(b).slice(0, 300));
      metricIds62.push(b.metric.metric_id);
      return b.metric;
    };
    const putQ62 = (metricId, key, questions, cookie) => (cookie
      ? rawFetch(`${BASE_URL}/api/admin/part-questions/${metricId}/${key}`, jsonBody('PUT', { questions }, cookie))
      : adminJson('PUT', `/api/admin/part-questions/${metricId}/${key}`, { questions }));
    const postPart62 = async (metricId, key, buf, fileName = 'module62.xlsx') => {
      const fd = new FormData();
      fd.append('file', new Blob([buf]), fileName);
      const r = await fetch(`${BASE_URL}/api/admin/metric-parts/${metricId}/${key}/upload`, { method: 'POST', body: fd });
      return { status: r.status, body: await r.json() };
    };
    const templateHeader62 = async (metricId, key) => {
      const t = await fetch(`${BASE_URL}/api/admin/metric-parts/${metricId}/${key}/template`);
      assert.strictEqual(t.status, 200);
      return (await readSheet62(Buffer.from(await t.arrayBuffer())))[0].cells.map(c => c.value);
    };
    const csvRows62 = text => {
      const t = String(text).replace(/^﻿/, '');
      const rows = []; let row = [], cell = '', q = false;
      for (let i = 0; i < t.length; i++) {
        const c = t[i];
        if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
        else if (c === '"') q = true;
        else if (c === ',') { row.push(cell); cell = ''; }
        else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
        else cell += c;
      }
      if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
      return rows;
    };
    const HEAD62 = (score, questions) => ['Directorate', 'Level', 'Year', 'Month', score, ...questions, 'Jumlah Responden', 'Periode (Join Date)'];
    let m62 = null;
    let user62 = null;
    let userCookie62 = null;
    try {
      await runTest('[POSITIVE] Live configuration seeded from the stored files: every live part is configured; a part never edited in Summary Questions has the question texts of its latest upload (metric 12: one event block; Onboarding Survey Day 1 = 3 questions, question 2 TEXT), Welcome Session / Infrastructure & Application none, 19 / 20 a score table; the boot top-up never overwrites', async () => {
        const parts = (await st62.getMetricParts()).filter(p => [5, 7, 12, 19, 20].includes(p.metric_id));
        assert.ok(parts.length >= 8, `live parts: ${parts.length}`);
        const edited = new Set((await st62.getAuditLog(5000, { includeTest: false })).filter(a => a.action === 'PART_QUESTIONS_UPDATE').map(a => (String(a.target).match(/^metric (\d+) (\S+):/) || []).slice(1, 3).join('|')));
        let compared = 0;
        for (const p of parts) {
          assert.ok(Array.isArray(p.questions), `metric ${p.metric_id} ${p.part_key} configured`);
          if (edited.has(`${p.metric_id}|${p.part_key}`)) continue; // the Admin changed it - nothing to compare with the files
          const latest = (await st62.getMetricPartUploads(p.metric_id, p.part_key))[0];
          const cols = (latest && latest.columns) || {};
          const expected = latest
            ? (Array.isArray(cols.questions_snapshot) ? cols.questions_snapshot.map(q => q.text) : pq62.firstEventBlock(cols.question_labels || [], cols.event_labels || []))
            : ((p.template && !p.template.score_column && p.template.question_labels) || []);
          assert.deepStrictEqual(p.questions.map(q => q.text), expected, `metric ${p.metric_id} ${p.part_key}`);
          compared++;
          if (p.part_key === 'DAY1_SURVEY' && latest) {
            assert.deepStrictEqual(p.questions.map(q => q.type), ['SCALE', 'TEXT', 'SCALE'], 'Day 1: "What makes you interested in joining CIMB Niaga?" is a free-text answer');
          }
          if (['WELCOME_SESSION', 'INFRA_APP'].includes(p.part_key) && !latest) assert.deepStrictEqual(p.questions, [], `${p.part_key}: none yet`);
          if (p.metric_id === 12 && latest) assert.strictEqual(p.questions.length, 3, 'metric 12: the 3 questions of one event block');
        }
        assert.ok(compared >= 1, 'at least one live part compared');
        const list = await (await fetch(`${BASE_URL}/api/admin/part-questions`)).json();
        const kinds = Object.fromEntries(list.metrics.flatMap(m => m.parts.map(p => [`${m.metric_id}|${p.part_key}`, p.kind])));
        assert.deepStrictEqual([kinds['12|EVENT_SATISFACTION'], kinds['19|MANDATORY_LEARNING'], kinds['20|NON_MANDATORY_LEARNING'], kinds['7|MEET_GREET']], ['EVENT_BLOCKS', 'SCORE_TABLE', 'SCORE_TABLE', 'QUESTIONS']);
        assert.deepStrictEqual(list.question_types, ['SCALE', 'TEXT']);
        const before = JSON.stringify(await st62.getMetricParts());
        assert.strictEqual(await st62.topUpPartQuestions(), 0, 'nothing left to configure');
        assert.strictEqual(JSON.stringify(await st62.getMetricParts()), before, 'the top-up never overwrites a configured part');
      });

      await runTest('[POSITIVE] Admin edits a part: the boot top-up seeds an unconfigured part from its template; PUT adds (key assigned), edits a text, changes a type and reorders -> 200; GET shows it; audit PART_QUESTIONS_UPDATE names the changes; the configuration guard snapshot covers it (restore puts the questions back)', async () => {
        m62 = await createMetric62({ metric_name: `RT62 Summary ${stamp62}` });
        await addPart62(m62.metric_id, 'P1', 'Part One', 1, { score_label: 'Part One', question_labels: ['Old A', 'Old B'], question_types: ['SCALE', 'TEXT'], respondents_label: 'Jumlah Responden', period_label: 'Periode (Join Date)' });
        await addPart62(m62.metric_id, 'ST', 'Score Table', 2, { score_label: 'ST', score_column: 'ST', respondents_column: false, question_labels: [] });
        assert.strictEqual((await st62.getMetricParts(m62.metric_id))[0].questions, null, 'inserted without questions');
        assert.strictEqual(await st62.topUpPartQuestions(), 2);
        const seeded = (await st62.getMetricParts(m62.metric_id)).find(p => p.part_key === 'P1').questions;
        assert.deepStrictEqual(seeded, [{ key: 'q1', text: 'Old A', type: 'SCALE' }, { key: 'q2', text: 'Old B', type: 'TEXT' }]);
        const snap = await st62.snapshotConfiguration();
        assert.ok(snap.tables.px_metric_parts && snap.tables.px_metric_parts.columns.includes('questions_json'), 'px_metric_parts is in the configuration snapshot');
        const r = await putQ62(m62.metric_id, 'P1', [{ key: 'q2', text: '  Reason   to join ', type: 'TEXT' }, { key: 'q1', text: 'Overall rating', type: 'SCALE' }, { text: 'Day one experience' }]);
        const b = await r.json();
        assert.strictEqual(r.status, 200, JSON.stringify(b));
        assert.deepStrictEqual(b.part.questions, [{ key: 'q2', text: 'Reason to join', type: 'TEXT' }, { key: 'q1', text: 'Overall rating', type: 'SCALE' }, { key: 'q3', text: 'Day one experience', type: 'SCALE' }]);
        assert.strictEqual(b.changes, '2 -> 3 questions; added q3; text q2,q1; reordered');
        const list = await (await fetch(`${BASE_URL}/api/admin/part-questions`)).json();
        const mine = list.metrics.find(m => m.metric_id === m62.metric_id);
        assert.deepStrictEqual(mine.parts.map(p => [p.part_key, p.kind, p.questions.length, p.configured, p.latest_upload]), [['P1', 'QUESTIONS', 3, true, null], ['ST', 'SCORE_TABLE', 0, true, null]]);
        const a = (await st62.getAuditLog(30, { includeTest: true })).find(x => x.action === 'PART_QUESTIONS_UPDATE' && String(x.target).startsWith(`metric ${m62.metric_id} P1:`));
        assert.ok(a && a.is_test === true && a.target.includes('2 -> 3 questions; added q3'), JSON.stringify(a));
        const cmp = await st62.compareConfiguration(snap);
        assert.deepStrictEqual(cmp.differing_tables, ['px_metric_parts']);
        const restored = await st62.restoreConfiguration(snap);
        assert.deepStrictEqual(restored.restored_tables, ['px_metric_parts']);
        assert.deepStrictEqual((await st62.getMetricParts(m62.metric_id)).find(p => p.part_key === 'P1').questions, seeded, 'the restore puts the questions back');
        assert.strictEqual((await putQ62(m62.metric_id, 'P1', b.part.questions)).status, 200);
      });

      await runTest('[NEGATIVE] Validation (400, nothing saved): not a list, empty / too long text, unknown type, duplicate / malformed key, more than 60 questions, a score-table part; unknown part / metric without parts -> 404, bad id -> 400', async () => {
        const before = JSON.stringify((await st62.getMetricParts(m62.metric_id)).map(p => p.questions));
        const bad = [
          ['not a list', 'x'],
          ['empty text', [{ text: '   ' }]],
          ['too long', [{ text: 'x'.repeat(501) }]],
          ['bad type', [{ text: 'A', type: 'STARS' }]],
          ['duplicate key', [{ key: 'k', text: 'A' }, { key: 'K', text: 'B' }]],
          ['bad key', [{ key: 'a b', text: 'A' }]],
          ['too many', Array.from({ length: 61 }, (_, i) => ({ text: `Q${i}` }))],
          ['not an object', ['A']]
        ];
        for (const [what, questions] of bad) {
          const r = await putQ62(m62.metric_id, 'P1', questions);
          assert.strictEqual(r.status, 400, what);
          assert.ok((await r.json()).error, what);
        }
        const st = await putQ62(m62.metric_id, 'ST', [{ text: 'A' }]);
        assert.deepStrictEqual([st.status, /no question columns/.test((await st.json()).error)], [400, true]);
        assert.strictEqual((await putQ62(m62.metric_id, 'NOPE', [])).status, 404);
        assert.strictEqual((await putQ62(14, 'P1', [])).status, 404, 'metric 14 has no parts');
        assert.strictEqual((await putQ62('abc', 'P1', [])).status, 400);
        assert.strictEqual(JSON.stringify((await st62.getMetricParts(m62.metric_id)).map(p => p.questions)), before, 'nothing saved');
      });

      await runTest('[NEGATIVE] Admin only: a USER gets 403 on GET / PUT, no login 401; the questions are unchanged', async () => {
        const before = JSON.stringify((await st62.getMetricParts(m62.metric_id)).map(p => p.questions));
        const pw = require('crypto').randomBytes(9).toString('hex') + 'Aa1';
        const dir = (await st62.getDirectorates())[0].directorate_name;
        user62 = await st62.createUser({ is_test_account: true, username: `rt62u${stamp62}`, full_name: 'Regression 62 User', email: '', role: 'USER',
          password_hash: await require('../server/services/authService').hashPassword(pw), must_change_password: false, scopes: [{ directorate: dir, divisions: null }] });
        userCookie62 = (await loginAs(user62.username, pw)).cookie;
        assert.ok(userCookie62, 'USER login');
        assert.strictEqual((await rawFetch(`${BASE_URL}/api/admin/part-questions`, asUser(userCookie62))).status, 403);
        assert.strictEqual((await putQ62(m62.metric_id, 'P1', [{ text: 'Hijack' }], userCookie62)).status, 403);
        assert.strictEqual((await rawFetch(`${BASE_URL}/api/admin/part-questions`)).status, 401);
        assert.strictEqual((await rawFetch(`${BASE_URL}/api/admin/part-questions/${m62.metric_id}/P1`, jsonBody('PUT', { questions: [{ text: 'Hijack' }] }))).status, 401);
        assert.strictEqual(JSON.stringify((await st62.getMetricParts(m62.metric_id)).map(p => p.questions)), before);
      });

      await runTest('[POSITIVE/NEGATIVE] Template + upload follow the configuration: template headers = the configured texts in order; a file with another number of question columns -> 400 naming both counts and the menu (nothing stored); question columns mapped BY POSITION (own header kept as file_label), TEXT kept as text, a text in a Scale column -> 400; upload keeps questions_snapshot', async () => {
        assert.deepStrictEqual(await templateHeader62(m62.metric_id, 'P1'), HEAD62('Part One', ['Reason to join', 'Overall rating', 'Day one experience']));
        const rows0 = (await st62.getMetricPartResults(m62.metric_id)).length;
        const two = await postPart62(m62.metric_id, 'P1', await buildXlsx62([HEAD62('Part One', ['Reason to join', 'Overall rating']), ['CIMB Niaga', 'Bankwide', 2003, 'Jan', 4, 'x', 4, 5, '']]));
        assert.strictEqual(two.status, 400);
        assert.ok(/The file has 2 question columns .*the configured template has 3 questions - update the questions in Admin Parameters -> Summary Questions or use the latest template/.test(two.body.errors[0].reason), two.body.errors[0].reason);
        const scaleText = await postPart62(m62.metric_id, 'P1', await buildXlsx62([HEAD62('Part One', ['A', 'B', 'C']), ['CIMB Niaga', 'Bankwide', 2003, 'Jan', 4, 'Career', 'good', 4, 5, '']]));
        assert.strictEqual(scaleText.status, 400);
        assert.deepStrictEqual(scaleText.body.errors.map(e => [e.row_number, e.column]), [[2, 'G']]);
        assert.ok(/is a Scale question .*set its type to Text in Admin Parameters -> Summary Questions/.test(scaleText.body.errors[0].reason), scaleText.body.errors[0].reason);
        assert.strictEqual((await st62.getMetricPartResults(m62.metric_id)).length, rows0, 'nothing stored');
        const ok = await postPart62(m62.metric_id, 'P1', await buildXlsx62([HEAD62('Part One', ['Kenapa join', 'Rating', 'Hari pertama']),
          ['CIMB Niaga', 'Bankwide', 2003, 'Jan', 4, 'Suitable role', 4.5, '-', 5, '']]), 'module62_jan.xlsx');
        assert.strictEqual(ok.status, 200, JSON.stringify(ok.body).slice(0, 300));
        const row = (await st62.getMetricPartResults(m62.metric_id, 'P1'))[0];
        assert.deepStrictEqual(row.questions, [
          { key: 'q2', label: 'Reason to join', file_label: 'Kenapa join', type: 'TEXT', value: 'Suitable role' },
          { key: 'q1', label: 'Overall rating', file_label: 'Rating', type: 'SCALE', value: 4.5 },
          { key: 'q3', label: 'Day one experience', file_label: 'Hari pertama', type: 'SCALE', value: null }
        ]);
        const up = (await st62.getMetricPartUploads(m62.metric_id, 'P1'))[0];
        assert.deepStrictEqual([up.columns.question_labels, up.columns.questions_snapshot.map(q => q.text)], [['Kenapa join', 'Rating', 'Hari pertama'], ['Reason to join', 'Overall rating', 'Day one experience']]);
        assert.deepStrictEqual([ok.body.bankwide_by_month[0].value], [4], 'the score (column E) is unaffected by the questions');
      });

      await runTest('[POSITIVE] Snapshot per upload: after the questions change, History / Evidence keep the January texts; a period with both sets -> one line per question with Question_Set + a note; one month = the wide layout with that month\'s texts; the template follows the new configuration; GET flags the difference to the latest upload', async () => {
        const r = await putQ62(m62.metric_id, 'P1', [{ key: 'q2', text: 'Reason to join', type: 'TEXT' }, { key: 'q1', text: 'Overall rating (new)', type: 'SCALE' }, { key: 'q3', text: 'Day one experience', type: 'SCALE' }]);
        assert.strictEqual(r.status, 200);
        const view = (await (await fetch(`${BASE_URL}/api/admin/part-questions`)).json()).metrics.find(m => m.metric_id === m62.metric_id).parts[0];
        assert.strictEqual(view.differs_from_latest_upload, true);
        assert.deepStrictEqual(view.latest_upload.question_texts, ['Reason to join', 'Overall rating', 'Day one experience']);
        assert.deepStrictEqual(await templateHeader62(m62.metric_id, 'P1'), HEAD62('Part One', ['Reason to join', 'Overall rating (new)', 'Day one experience']));
        const feb = await postPart62(m62.metric_id, 'P1', await buildXlsx62([HEAD62('Part One', ['a', 'b', 'c']), ['CIMB Niaga', 'Bankwide', 2003, 'Feb', 3, '-', 3, 3.5, 4, '']]), 'module62_feb.xlsx');
        assert.strictEqual(feb.status, 200, JSON.stringify(feb.body).slice(0, 300));
        const jan = (await st62.getMetricPartResults(m62.metric_id, 'P1')).find(x => x.month === 1);
        assert.strictEqual(jan.questions[1].label, 'Overall rating', 'the stored January row keeps its text');
        // the year: both sets -> long layout
        const h = await (await fetch(`${BASE_URL}/api/metrics/${m62.metric_id}/history?period=2003`)).json();
        assert.strictEqual(h.kind, 'PARTS');
        assert.ok(h.notes.length === 1 && /Part One: the questions changed within this period \(Set 1, Set 2\)/.test(h.notes[0]), JSON.stringify(h.notes));
        assert.ok(['Question_Set', 'Question_No', 'Question', 'File_Header', 'Value'].every(k => h.columns.some(c => c.key === k)), h.columns.map(c => c.key).join('|'));
        const line = (set, no) => h.rows.find(x => x.Question_Set === set && x.Question_No === no);
        assert.deepStrictEqual([line('Set 1', 2).Question, line('Set 1', 2).File_Header, line('Set 1', 2).Value, line('Set 1', 2).Period], ['Overall rating', 'Rating', 4.5, '2003-01']);
        assert.deepStrictEqual([line('Set 2', 2).Question, line('Set 2', 2).File_Header, line('Set 2', 2).Period], ['Overall rating (new)', 'b', '2003-02']);
        assert.strictEqual(h.total, 6, '2 rows x 3 questions');
        const ev = csvRows62(await (await fetch(`${BASE_URL}/api/admin/metric-parts/${m62.metric_id}/P1/evidence?period=2003`)).text());
        assert.ok(['Question_Set', 'Question_No', 'Question', 'File_Header', 'Value'].every(k => ev[0].includes(k)), ev[0].join('|'));
        assert.strictEqual(ev.length - 1, h.total, 'History = Evidence');
        assert.ok(ev.some(l => l.includes('Set 1') && l.includes('Overall rating')) && ev.some(l => l.includes('Set 2') && l.includes('Overall rating (new)')));
        // one month: one set -> wide layout with that month's texts, no note
        const h1 = await (await fetch(`${BASE_URL}/api/metrics/${m62.metric_id}/history?period=2003-01`)).json();
        assert.deepStrictEqual([h1.notes, h1.columns.some(c => c.key === 'Question_Set'), h1.columns.some(c => c.key === 'Overall rating'), h1.columns.some(c => c.key === 'Overall rating (new)')], [[], false, true, false]);
        const ev2 = csvRows62(await (await fetch(`${BASE_URL}/api/admin/metric-parts/${m62.metric_id}/P1/evidence?period=2003-02`)).text());
        assert.ok(ev2[0].includes('Overall rating (new)') && !ev2[0].includes('Question_Set'), ev2[0].join('|'));
      });

      await runTest('[POSITIVE/NEGATIVE] Event-block part (metric 12 layout): the configured questions are the questions of ONE event block; template = every event (from the latest file / template) + those questions; upload with blocks of 1 + N columns -> 200 (event names from the file, question texts configured); another block size -> 400', async () => {
        const m = await createMetric62({ metric_name: `RT62 Events ${stamp62}`, scale_type: 'PERCENTAGE', target_value: 80, target_display: '> 80%' });
        await addPart62(m.metric_id, 'EV', 'Events', 1, { score_label: 'Satisfaction Event', score_scale: 'PERCENT', event_labels: ['Event A', 'Event B'],
          question_labels: ['Event A', 'Makna', 'Hadir', 'Rekomendasi', 'Event B', 'Makna', 'Hadir', 'Rekomendasi'], respondents_label: 'Jumlah Responden Valid', period_label: 'Periode (Start time)', period_before_respondents: true });
        await st62.topUpPartQuestions();
        assert.deepStrictEqual((await st62.getMetricParts(m.metric_id))[0].questions.map(q => q.text), ['Makna', 'Hadir', 'Rekomendasi'], 'seeded: one event block');
        assert.strictEqual((await putQ62(m.metric_id, 'EV', [{ key: 'q1', text: 'Saya mendapatkan makna' }, { key: 'q2', text: 'Saya akan hadir lagi' }])).status, 200);
        const head = ['Directorate', 'Level', 'Year', 'Month', 'Satisfaction Event', 'Event A', 'Saya mendapatkan makna', 'Saya akan hadir lagi', 'Event B', 'Saya mendapatkan makna', 'Saya akan hadir lagi', 'Periode (Start time)', 'Jumlah Responden Valid'];
        assert.deepStrictEqual(await templateHeader62(m.metric_id, 'EV'), head);
        const three = await postPart62(m.metric_id, 'EV', await buildXlsx62([['Directorate', 'Level', 'Year', 'Month', 'S', 'Event A', 'x', 'y', 'z', 'Event B', 'x', 'y', 'z', 'Periode', 'Jumlah Responden Valid'],
          ['CIMB Niaga', 'Bankwide', 2003, 'Mar', 90, 90, 90, 90, 90, '-', '-', '-', '-', '', 10]]));
        assert.strictEqual(three.status, 400);
        assert.ok(/not a whole number of event blocks of 3 columns/.test(three.body.errors[0].reason), three.body.errors[0].reason);
        const ok = await postPart62(m.metric_id, 'EV', await buildXlsx62([['Directorate', 'Level', 'Year', 'Month', 'S', 'Podcast', 'makna?', 'hadir?', 'Talkshow', 'makna?', 'hadir?', 'Periode', 'Jumlah Responden Valid'],
          ['CIMB Niaga', 'Bankwide', 2003, 'Mar', 92, 94, 100, 88, 90, 96, 84, '', 10]]));
        assert.strictEqual(ok.status, 200, JSON.stringify(ok.body).slice(0, 300));
        assert.deepStrictEqual(ok.body.columns.event_labels, ['Podcast', 'Talkshow']);
        const row = (await st62.getMetricPartResults(m.metric_id, 'EV'))[0];
        assert.deepStrictEqual(row.questions.map(q => [q.label, q.event, q.is_event || false, q.file_label || null, q.value]), [
          ['Podcast', 'Podcast', true, null, 94], ['Saya mendapatkan makna', 'Podcast', false, 'makna?', 100], ['Saya akan hadir lagi', 'Podcast', false, 'hadir?', 88],
          ['Talkshow', 'Talkshow', true, null, 90], ['Saya mendapatkan makna', 'Talkshow', false, 'makna?', 96], ['Saya akan hadir lagi', 'Talkshow', false, 'hadir?', 84]]);
        const d = await (await fetch(`${BASE_URL}/api/metrics/${m.metric_id}/detail?mode=YTD&year=2003`)).json();
        assert.deepStrictEqual(d.parts[0].events.map(e => [e.event, e.value]), [['Podcast', 94], ['Talkshow', 90]]);
        assert.deepStrictEqual(await templateHeader62(m.metric_id, 'EV'), ['Directorate', 'Level', 'Year', 'Month', 'S', 'Podcast', 'Saya mendapatkan makna', 'Saya akan hadir lagi', 'Talkshow', 'Saya mendapatkan makna', 'Saya akan hadir lagi', 'Periode', 'Jumlah Responden Valid'], 'events (and score / period headers) of the latest file');
      });

      await runTest('[POSITIVE] JSON backend in-process (same contract): every part configured on load (Day 1 = the 3 template questions, question 2 TEXT), setMetricPartQuestions saves, metricParts is in the configuration snapshot; store.json and auth.json restored byte-identically', async () => {
        const dataDir = path62.join(__dirname, '..', 'server', 'data');
        const files = ['store.json', 'auth.json'].map(f => path62.join(dataDir, f));
        const saved = files.map(f => (fs62.existsSync(f) ? fs62.readFileSync(f) : null));
        let out;
        try {
          const js = require('../server/db/jsonStorage');
          const parts = await js.getMetricParts();
          const day1 = parts.find(p => p.metric_id === 7 && p.part_key === 'DAY1_SURVEY');
          const ws = parts.find(p => p.metric_id === 7 && p.part_key === 'WELCOME_SESSION');
          const set = await js.setMetricPartQuestions(7, 'WELCOME_SESSION', [{ key: 'q1', text: 'RT62 welcome', type: 'SCALE' }]);
          const snap = js.snapshotConfiguration();
          out = {
            allConfigured: parts.every(p => Array.isArray(p.questions)),
            day1: day1 ? day1.questions.map(q => q.type) : null,
            ws: ws ? ws.questions : null,
            set: set && set.questions,
            missing: await js.setMetricPartQuestions(7, 'NOPE', []),
            snap: Array.isArray(snap.keys.metricParts) && snap.keys.metricParts.some(p => p.part_key === 'WELCOME_SESSION' && p.questions.length === 1)
          };
        } finally {
          files.forEach((f, i) => { if (saved[i] === null) { if (fs62.existsSync(f)) fs62.unlinkSync(f); } else fs62.writeFileSync(f, saved[i]); });
        }
        files.forEach((f, i) => assert.ok(saved[i] === null ? !fs62.existsSync(f) : Buffer.compare(fs62.readFileSync(f), saved[i]) === 0, `${path62.basename(f)} restored byte-identically`));
        assert.strictEqual(out.allConfigured, true);
        if (out.day1 && out.day1.length === 3) assert.deepStrictEqual(out.day1, ['SCALE', 'TEXT', 'SCALE']);
        assert.deepStrictEqual([out.ws, out.set, out.missing, out.snap], [[], [{ key: 'q1', text: 'RT62 welcome', type: 'SCALE' }], null, true]);
      });
    } finally {
      if (user62) await st62.deleteUser(user62.user_id);
      for (const id of [...metricIds62].reverse()) await adminJson('DELETE', `/api/admin/metrics/${id}`);
      await pool62.close();
    }
  }

  // --- MODULE 63 (v2.58.0): DISPLAY NUMBER OF A METRIC (display_no = position in journey order, no gaps; metric_id stays the key) ---
  console.log('\n📦 MODULE 63: Metric display number - contiguous 1..N in journey order, closes the gap after a delete, a new metric is last of its journey (Positive & Negative Testing)');
  {
    const calc63 = async () => (await (await fetch(`${BASE_URL}/api/metrics/calculate?period=YTD`)).json());
    const params63 = async () => (await (await fetch(`${BASE_URL}/api/admin/parameters`)).json());
    const numbers63 = list => new Map(list.map(m => [m.metric_id, m.display_no]));
    // Expected numbering from the raw lists: journeys by journey_id, metrics by metric_id inside the journey
    const expected63 = (metrics, journeys) => {
      const rank = new Map([...journeys].sort((a, b) => a.journey_id - b.journey_id).map((j, i) => [j.journey_id, i]));
      const r = m => (rank.has(m.journey_id) ? rank.get(m.journey_id) : Number.MAX_SAFE_INTEGER);
      return new Map([...metrics].sort((a, b) => r(a) - r(b) || a.metric_id - b.metric_id).map((m, i) => [m.metric_id, i + 1]));
    };
    const created63 = [];
    try {
      const base = await params63();
      const baseNo = numbers63(base.metrics);

      await runTest('[POSITIVE] display_no is 1..N without gaps in journey order (then metric_id) and equal in calculate, detail, admin parameters, survey metrics, alerts and part questions', async () => {
        const calc = await calc63();
        const exp = expected63(base.metrics, base.journeys);
        assert.deepStrictEqual([...baseNo.values()].sort((a, b) => a - b), base.metrics.map((_, i) => i + 1), 'contiguous 1..N');
        base.metrics.forEach(m => assert.strictEqual(m.display_no, exp.get(m.metric_id), `admin parameters metric ${m.metric_id}`));
        calc.metrics.forEach(m => assert.strictEqual(m.display_no, baseNo.get(m.metric_id), `calculate metric ${m.metric_id}`));
        const sample = base.metrics[base.metrics.length - 1];
        const detail = await (await fetch(`${BASE_URL}/api/metrics/${sample.metric_id}/detail?period=YTD`)).json();
        assert.strictEqual(detail.display_no, baseNo.get(sample.metric_id), 'detail');
        const survey = await (await fetch(`${BASE_URL}/api/surveys/metrics`)).json();
        assert.ok(survey.length > 0);
        survey.forEach(m => assert.strictEqual(m.display_no, baseNo.get(m.metric_id), `survey metric ${m.metric_id}`));
        const alerts = await (await fetch(`${BASE_URL}/api/alerts`)).json();
        (Array.isArray(alerts) ? alerts : (alerts.alerts || [])).forEach(a => assert.strictEqual(a.display_no, baseNo.get(a.metric_id), `alert ${a.metric_id}`));
        const pq = await (await fetch(`${BASE_URL}/api/admin/part-questions`)).json();
        pq.metrics.forEach(m => assert.strictEqual(m.display_no, baseNo.get(m.metric_id), `part questions ${m.metric_id}`));
        // a metric right after a missing metric_id carries the shifted (gap-free) number
        const ids = base.metrics.map(m => m.metric_id).sort((a, b) => a - b);
        const afterGap = ids.find((id, i) => i > 0 && id !== ids[i - 1] + 1);
        if (afterGap) {
          const m = base.metrics.find(x => x.metric_id === afterGap);
          const before = base.metrics.filter(x => exp.get(x.metric_id) < exp.get(afterGap)).length;
          assert.strictEqual(m.display_no, before + 1, `metric ${afterGap} after a gap`);
        }
      });

      // A middle journey (the 3rd by journey_id) that has a checkpoint, and the later journeys' metrics
      const journeys = [...base.journeys].sort((a, b) => a.journey_id - b.journey_id);
      const mid = journeys[Math.min(2, journeys.length - 2)];
      const later = base.metrics.filter(m => m.journey_id > mid.journey_id);
      const cp = base.checkpoints.find(c => c.journey_id === mid.journey_id);
      const firstLater = later.length ? later.reduce((a, b) => (baseNo.get(a.metric_id) < baseNo.get(b.metric_id) ? a : b)) : null;
      const lastOfMid = base.metrics.filter(m => m.journey_id <= mid.journey_id).length; // number of the middle journey's last metric now
      const addTemp = async name => {
        const res = await adminJson('POST', '/api/admin/metrics', { metric_name: name, metric_type: 'OUTCOME', scale_type: 'QUOTA_COUNT', journey_id: mid.journey_id,
          checkpoint_id: cp ? cp.checkpoint_id : undefined, target_value: 100, target_display: 'min 100', raw_value: 40, requires_manual_upload: false });
        assert.strictEqual(res.status, 201, `create ${name}`);
        const id = (await res.json()).metric_id;
        created63.push(id);
        return id;
      };

      await runTest('[POSITIVE] A new metric in a middle journey becomes the last number of that journey and every metric of the later journeys moves up by one', async () => {
        assert.ok(cp && firstLater, 'fixture: middle journey with a checkpoint and later journeys with metrics');
        const t1 = await addTemp('REGRESSION RT63 display no A');
        const after = numbers63((await params63()).metrics);
        assert.strictEqual(after.get(t1), lastOfMid + 1, 'temp metric = last of its journey');
        assert.strictEqual(after.get(firstLater.metric_id), baseNo.get(firstLater.metric_id) + 1, 'first metric of the next journey shifted by one');
        later.forEach(m => assert.strictEqual(after.get(m.metric_id), baseNo.get(m.metric_id) + 1, `later metric ${m.metric_id} shifted`));
        base.metrics.filter(m => m.journey_id <= mid.journey_id).forEach(m => assert.strictEqual(after.get(m.metric_id), baseNo.get(m.metric_id), `earlier metric ${m.metric_id} unchanged`));
        assert.strictEqual(numbers63((await calc63()).metrics).get(t1), lastOfMid + 1, 'calculate agrees');
      });

      await runTest('[POSITIVE] Deleting a metric closes its gap: the metric after it takes its number, later journeys move back, the deleted number is gone', async () => {
        assert.strictEqual(created63.length, 1, 'fixture: first temp metric exists');
        const [t1] = created63;
        const t2 = await addTemp('REGRESSION RT63 display no B');
        let now = numbers63((await params63()).metrics);
        assert.deepStrictEqual([now.get(t1), now.get(t2)], [lastOfMid + 1, lastOfMid + 2]);
        assert.strictEqual(now.get(firstLater.metric_id), baseNo.get(firstLater.metric_id) + 2);
        assert.strictEqual((await adminJson('DELETE', `/api/admin/metrics/${t1}`)).status, 200);
        created63.splice(created63.indexOf(t1), 1);
        const list = (await params63()).metrics;
        now = numbers63(list);
        assert.ok(!now.has(t1), 'deleted metric has no number');
        assert.strictEqual(now.get(t2), lastOfMid + 1, 'the metric after the deleted one takes its number');
        assert.strictEqual(now.get(firstLater.metric_id), baseNo.get(firstLater.metric_id) + 1);
        assert.deepStrictEqual([...now.values()].sort((a, b) => a - b), list.map((_, i) => i + 1), 'still contiguous');
        assert.strictEqual((await fetch(`${BASE_URL}/api/metrics/${t1}/detail?period=YTD`)).status, 404, 'deleted metric detail 404');
        assert.strictEqual((await adminJson('DELETE', `/api/admin/metrics/${t2}`)).status, 200);
        created63.splice(created63.indexOf(t2), 1);
        assert.deepStrictEqual(numbers63((await params63()).metrics), baseNo, 'back to the original numbering');
      });

      await runTest('[NEGATIVE] display_no never repeats and stays inside 1..N; an unknown metric has no detail (404)', async () => {
        const list = (await params63()).metrics;
        assert.strictEqual(new Set(list.map(m => m.display_no)).size, list.length, 'unique');
        list.forEach(m => assert.ok(Number.isInteger(m.display_no) && m.display_no >= 1 && m.display_no <= list.length, `metric ${m.metric_id} number in 1..N`));
        assert.strictEqual((await fetch(`${BASE_URL}/api/metrics/999999/detail?period=YTD`)).status, 404);
      });
    } finally {
      for (const id of created63) await adminJson('DELETE', `/api/admin/metrics/${id}`);
    }
  }
}

runRegressionSuite().catch(async err => {
  console.error('Test runner fatal error:', err);
  try { await teardownSuiteLogin(); } catch (_) { /* ignore */ }
  process.exit(1);
});
