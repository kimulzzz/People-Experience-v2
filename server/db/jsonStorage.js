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
  initialEssResults,
  initialEssUploads,
  initialOperationalRecords,
  EXIT_SEED_MONTHS,
  generateExitInterviewDummy,
  initialAppSettings,
  initialEmailSettings,
  LEGACY_OPTION_LABELS,
  upgradeLegacyOptionLabels
} = require('./seedData');
const { parseFilterOptions, normalizeDateString, todayDateString } = require('./filterUtils');
const { normalizeScopes, rowInScopes, legacyUserScopes } = require('./scopeUtils');
const { DEFAULT_USER_MENU_ACCESS, coversEventManagerDirectorate } = require('./menuAccess');
const { isHistoricalTestRow } = require('./testAccounts');
const { defaultUnitForScale, parseUnit } = require('./metricUnit');
const { inferSurveySource, isEssMetric, resolveSurveySource, resolveRequiresManualUpload } = require('./surveySource');
const { buildInitialStore: loadInitialStore } = require('./initialStore');
const { planDirectory, renamedDirectorate, migrateScopes, migrateDirectorateOptions, DIRECTORATE_SETTING_KEYS } = require('./directorateMigration');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}


let store = null;

// Same respondent-type rule as sqlStorage's normalizeResponse: campus / candidate rows keep a
// university / applied position in `directorate`, so only EMPLOYEE rows are renamed.
const isEmployeeResponse = r => {
  const metricId = parseInt(r.metric_id, 10);
  return !(metricId === 2 || r.participant_id || r.university || metricId === 5 || r.candidate_id || r.applied_position);
};

// v2.31.0: renames the 8 old demo directorates to the bank's 12 real ones in the store (mapping in
// directorateMigration.js). Only rows that still carry an old name change, so a second run changes 0
// rows. Returns the rows changed per collection (the caller saves the store).
function migrateStoreDirectorates(s) {
  const counts = { directorates_removed: 0, divisions_moved: 0, survey_responses: 0, attendances: 0, app_settings: 0, operational_records: 0 };
  const plan = planDirectory(s.directorates || [], initialDirectorates);
  if (plan) {
    s.directorates = plan.directorates;
    counts.directorates_removed = plan.removed;
    counts.divisions_moved = plan.moved;
  }
  (s.surveyUploadedResponses || []).forEach(r => {
    if (!isEmployeeResponse(r)) return;
    const to = renamedDirectorate(r.directorate, r.division);
    if (to) { r.directorate = to; counts.survey_responses++; }
  });
  (s.attendances || []).forEach(a => {
    const to = renamedDirectorate(a.directorate, a.division);
    if (to) { a.directorate = to; counts.attendances++; }
  });
  DIRECTORATE_SETTING_KEYS.forEach(k => {
    const cur = s.appSettings && s.appSettings[k];
    const next = cur && migrateDirectorateOptions(cur.value);
    if (next) { s.appSettings[k] = { ...cur, value: next }; counts.app_settings++; }
  });
  Object.values(s.operationalRecords || {}).forEach(rows => (rows || []).forEach(r => {
    const to = r && r.unit !== undefined && renamedDirectorate(r.unit, null);
    if (to) { r.unit = to; counts.operational_records++; }
  }));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total) console.log(`[jsonStorage] Directorate master migrated to the 12 real directorates: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(', ')}.`);
  return counts;
}

// Same for the login accounts (auth.json): scope lists and the legacy v2.26.0 directorate/division fields.
function migrateAuthDirectorates(a) {
  const counts = { user_scopes: 0, users: 0 };
  (a.users || []).forEach(u => {
    const next = Array.isArray(u.scopes) ? migrateScopes(u.scopes) : null;
    if (next) { counts.user_scopes += u.scopes.length; u.scopes = next; }
    const to = renamedDirectorate(u.directorate, u.division);
    if (to) { u.directorate = to; counts.users++; }
  });
  if (counts.user_scopes + counts.users) console.log(`[jsonStorage] Directorate names migrated in login accounts: user_scopes=${counts.user_scopes}, users=${counts.users}.`);
  return counts;
}

// ESS result summaries (v2.32.0). The first load of a store.json without `essResults` is the upgrade: ESS metrics no
// longer have per-respondent rows, so those (seed + old CSV test uploads) are deleted together with the upload
// batches that are empty afterwards. SYSTEM survey data is never touched. Same rule as sqlStorage.cleanupEssRespondentRows.
function cleanupStoreEssRespondentRows(s) {
  const essIds = new Set((s.metrics || []).filter(m => m.metric_type === 'SURVEY' && isEssMetric(m)).map(m => m.metric_id));
  const before = (s.surveyUploadedResponses || []).length;
  const touched = new Set((s.surveyUploadedResponses || []).filter(r => essIds.has(r.metric_id)).map(r => r.upload_id));
  s.surveyUploadedResponses = (s.surveyUploadedResponses || []).filter(r => !essIds.has(r.metric_id));
  const stillUsed = new Set(s.surveyUploadedResponses.map(r => r.upload_id));
  const uploadsBefore = (s.surveyUploads || []).length;
  s.surveyUploads = (s.surveyUploads || []).filter(u => !touched.has(u.upload_id) || stillUsed.has(u.upload_id));
  return { responses: before - s.surveyUploadedResponses.length, uploads: uploadsBefore - s.surveyUploads.length };
}

// Demo ESS summaries, per (metric, period) (v2.37.0): a seed period is only added when that ESS metric has no result
// for that period yet, so an upload of the same period is never overwritten. Returns the seed upload ids added.
function topUpStoreEssSeed(s) {
  const essIds = new Set((s.metrics || []).filter(m => m.metric_type === 'SURVEY' && isEssMetric(m)).map(m => m.metric_id));
  const periodKey = r => `${r.metric_id}|${parseInt(r.survey_year, 10)}-${parseInt(r.survey_month, 10)}`;
  const have = new Set((s.essResults || []).map(periodKey));
  const todo = [...new Set(initialEssResults.filter(r => essIds.has(r.metric_id) && !have.has(periodKey(r))).map(r => r.upload_id))];
  todo.forEach(uploadId => {
    const up = initialEssUploads.find(u => u.upload_id === uploadId);
    if (up && !(s.surveyUploads || []).some(u => u.upload_id === up.upload_id)) s.surveyUploads.push(JSON.parse(JSON.stringify(up)));
    initialEssResults.filter(r => r.upload_id === uploadId).forEach(r => {
      s.essResults.push({ ess_result_id: nextEssResultId(s), ...JSON.parse(JSON.stringify(r)), created_at: up ? up.uploaded_at : new Date().toISOString() });
    });
  });
  return todo;
}
const nextEssResultId = s => (s.essResults || []).reduce((mx, r) => Math.max(mx, r.ess_result_id || 0), 0) + 1;

// Exit Interview (v2.38.0) - same rules as sqlStorage: key (nik, effective_date) compared case-insensitively on the NIK.
const EXIT_FIELDS = ['nik', 'employee_name', 'effective_date', 'leaving_reason', 'leaving_reason_detail', 'grade', 'score_factor', 'directorate',
  'division', 'destination_industry', 'new_company', 'new_company_std', 'new_position', 'pull_factors', 'improve_factors', 'new_company_offers',
  'internal_factors', 'career_scores', 'alumni_network', 'privacy_consent', 'recommend', 'suggestions'];
const exitKey = r => `${String(r.nik).trim().toLowerCase()}|${r.effective_date}`;
const nextExitId = s => (s.exitInterviews || []).reduce((mx, r) => Math.max(mx, r.exit_id || 0), 0) + 1;
const nextMonthStartStr = ym => { const [y, m] = ym.split('-').map(n => parseInt(n, 10)); return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`; };
// Last calendar day of 'YYYY-MM' (an inclusive period end, e.g. for the upload history).
const lastDayOfMonthStr = ym => { const [y, m] = ym.split('-').map(n => parseInt(n, 10)); return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; };
function exitMonthCountsOf(s) {
  const by = new Map();
  (s.exitInterviews || []).forEach(r => {
    const key = r.effective_date.slice(0, 7);
    const e = by.get(key) || { year: parseInt(key.slice(0, 4), 10), month: parseInt(key.slice(5, 7), 10), total: 0, dummy: 0 };
    e.total++;
    if (r.source === 'SEED_DUMMY') e.dummy++;
    by.set(key, e);
  });
  return [...by.values()].sort((a, b) => a.year - b.year || a.month - b.month);
}
// Demo exit rows for every seed month without any exit row (same rule as sqlStorage.topUpExitInterviewSeed).
function topUpStoreExitSeed(s) {
  s.exitInterviews = s.exitInterviews || [];
  s.exitInterviewUploads = s.exitInterviewUploads || [];
  const have = new Set(exitMonthCountsOf(s).map(m => `${m.year}-${m.month}`));
  const todo = (EXIT_SEED_MONTHS || []).filter(m => !have.has(`${m.year}-${m.month}`));
  if (!todo.length) return [];
  const all = generateExitInterviewDummy((s.directorates || []).length ? s.directorates.map(d => ({ directorate_name: d.directorate_name || d.name, divisions: d.divisions || d.sub_directorates || [] })) : undefined);
  const added = [];
  const now = new Date().toISOString();
  todo.forEach(({ year, month }) => {
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    const rows = all.filter(r => r.effective_date.startsWith(ym) && r.directorate);
    if (!rows.length) return;
    const uploadId = `seed-exit-${ym}`;
    s.exitInterviewUploads = s.exitInterviewUploads.filter(u => u.upload_id !== uploadId);
    s.exitInterviewUploads.push({ upload_id: uploadId, file_name: `Exit_Interview_Dummy_${ym}.xlsx`, source: 'SEED_DUMMY', total_rows: rows.length,
      inserted_rows: rows.length, updated_rows: 0, removed_dummy_rows: 0, period_from: `${ym}-01`, period_to: lastDayOfMonthStr(ym), uploaded_by: 'Seed (dummy)', uploaded_at: now });
    let id = nextExitId(s);
    rows.forEach(r => s.exitInterviews.push({ exit_id: id++, ...JSON.parse(JSON.stringify(r)), upload_id: uploadId, created_at: now, updated_at: null }));
    added.push(ym);
  });
  return added;
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
            // Satuan tampilan nilai aktual (v2.25.0): isi hanya yang belum ada — edit admin tidak ditimpa.
            if (typeof m.unit !== 'string' || !m.unit.trim()) m.unit = (seed && seed.unit) || defaultUnitForScale(m.scale_type);
            // Sumber survei (v2.29.0): isi hanya yang kosong pada metrik SURVEY (edit admin tidak ditimpa); OUTCOME = null.
            if (m.metric_type === 'SURVEY') {
              if (m.survey_source !== 'SYSTEM' && m.survey_source !== 'ESS') m.survey_source = (seed && (seed.survey_source === 'SYSTEM' || seed.survey_source === 'ESS')) ? seed.survey_source : inferSurveySource(m);
              // Data ESS selalu di-upload manual (tidak bisa ditarik dari sistem).
              if (m.survey_source === 'ESS' && m.requires_manual_upload !== true) {
                m.requires_manual_upload = true;
                console.log(`[jsonStorage] ESS metrics are always uploaded manually: requires_manual_upload turned on for metric ${m.metric_id}.`);
              }
            } else if (m.survey_source === undefined) {
              m.survey_source = null;
            }
            if (m.metric_type === 'OUTCOME' && m.last_data_date === undefined) m.last_data_date = (seed && seed.last_data_date) || todayDateString();
          });
        }
        if (!store.directorates || store.directorates.length === 0) {
          store.directorates = JSON.parse(JSON.stringify(initialDirectorates));
        }
        if (!store.weights || store.weights.length === 0) {
          store.weights = store.metrics.map(m => ({ metric_id: m.metric_id, weight: m.weight || 1.0 }));
        }
        // v2.31.0: old demo directorate names -> the 12 real directorates (before the top-up below).
        migrateStoreDirectorates(store);
        // Add org units that exist in the seed directory but not yet in this store (non-destructive).
        initialDirectorates.forEach(sd => {
          let d = store.directorates.find(x => (x.directorate_name || x.name) === sd.directorate_name);
          if (!d) { d = { directorate_name: sd.directorate_name, divisions: [] }; store.directorates.push(d); }
          const list = d.divisions || d.sub_directorates || (d.divisions = []);
          sd.divisions.forEach(div => { if (!list.includes(div)) list.push(div); });
        });
        // Backfill any admin setting that was added after this store.json was created.
        store.appSettings = { ...JSON.parse(JSON.stringify(initialAppSettings)), ...(store.appSettings || {}) };
        // v2.30.0: Indonesian default option labels -> English, only when still exactly the old default (admin edits stay).
        Object.keys(LEGACY_OPTION_LABELS).forEach(key => {
          const cur = store.appSettings[key];
          const next = cur && upgradeLegacyOptionLabels(key, cur.value);
          if (next) store.appSettings[key] = { ...cur, value: next };
        });
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
        if (!Array.isArray(store.essResults)) {
          const cleaned = cleanupStoreEssRespondentRows(store);
          store.essResults = [];
          console.log(`[jsonStorage] ESS now uses uploaded summaries: deleted ${cleaned.responses} per-respondent ESS rows and ${cleaned.uploads} upload batches left empty.`);
        }
        if (String(process.env.SEED_DEMO_DATA || 'true').toLowerCase() !== 'false') {
          const seededEss = topUpStoreEssSeed(store);
          if (seededEss.length) console.log(`[jsonStorage] Seeded demo ESS summaries: ${seededEss.join(', ')}.`);
          const seededExit = topUpStoreExitSeed(store);
          if (seededExit.length) console.log(`[jsonStorage] Seeded demo Exit Interview rows for: ${seededExit.join(', ')}.`);
        }
        saveStore();
      } catch (err) {
        console.error('Error loading store.json, falling back to seed data:', err);
        store = loadInitialStore();
        saveStore();
      }
    } else {
      store = loadInitialStore();
      if (String(process.env.SEED_DEMO_DATA || 'true').toLowerCase() !== 'false') topUpStoreExitSeed(store);
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
// Login accounts, sessions and the audit trail live in their OWN file (server/data/auth.json,
// gitignored) — never in store.json, which is committed and can be exported/imported as a whole.
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
let authStore = null;

function getAuth() {
  if (!authStore) {
    authStore = { users: [], sessions: [], audit: [] };
    if (fs.existsSync(AUTH_FILE)) {
      try { authStore = { ...authStore, ...JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')) }; }
      catch (err) { console.error('Error loading auth.json:', err.message); }
    }
    // v2.26.0 accounts had ONE directorate + ONE division: turn them into scope entries (division empty =
    // all divisions). Only users without a `scopes` array are touched, so this is safe on every load.
    let migrated = false;
    authStore.users.forEach(u => {
      if (Array.isArray(u.scopes)) return;
      u.scopes = legacyUserScopes(u);
      migrated = true;
    });
    const renamed = migrateAuthDirectorates(authStore);
    // v2.49.0: accounts written before menu_access existed (no such property) are classified ONCE: a USER whose scope
    // covered an event_manager_directorates directorate (the old "event manager") keeps Signature Program Events,
    // everybody else gets null (= the defaults, events off). Same rule as sqlStorage.migrateEventManagerMenuAccess.
    const preMenu = authStore.users.filter(u => u.menu_access === undefined);
    if (preMenu.length) {
      const managerDirs = ((getStore().appSettings || {}).event_manager_directorates || {}).value || [];
      let moved = 0;
      preMenu.forEach(u => {
        const keep = u.role === 'USER' && coversEventManagerDirectorate(u.scopes, managerDirs);
        u.menu_access = keep ? { ...DEFAULT_USER_MENU_ACCESS, events: true } : null;
        if (keep) moved++;
      });
      console.log(`[jsonStorage] Menu access: ${moved} User account(s) whose scope covered an event_manager_directorates directorate keep Signature Program Events.`);
    }
    // v2.43.0: audit rows written before is_test existed are classified ONCE (rules in testAccounts.js); later rows
    // always carry is_test from addAuditLog, so this only ever touches the pre-upgrade rows.
    const unclassified = authStore.audit.filter(e => e.is_test === undefined);
    if (unclassified.length) {
      const marked = markAuditRows(authStore, unclassified);
      unclassified.forEach(e => { if (e.is_test === undefined) e.is_test = false; });
      console.log(`[jsonStorage] Audit trail: marked ${marked} test-run row(s) of old test accounts as is_test (nothing deleted).`);
    }
    if (migrated || unclassified.length || preMenu.length || renamed.user_scopes + renamed.users) saveAuth();
  }
  return authStore;
}

// Sets is_test on the given audit rows that belong to (old) test-run accounts; returns how many were marked.
function markAuditRows(a, rows) {
  const accounts = new Map(a.users.map(u => [String(u.username).toLowerCase(), u.is_test_account === true]));
  let marked = 0;
  rows.forEach(e => { if (isHistoricalTestRow(e, accounts)) { e.is_test = true; marked++; } });
  return marked;
}

function saveAuth() {
  try { fs.writeFileSync(AUTH_FILE, JSON.stringify(authStore, null, 2), 'utf8'); }
  catch (err) { console.error('Failed to save auth.json:', err); }
}

const copyUser = u => (u ? { ...u, scopes: normalizeScopes(u.scopes), is_test_account: u.is_test_account === true,
  menu_access: u.menu_access && typeof u.menu_access === 'object' ? { ...u.menu_access } : null } : null);

const storage = {
  // v2.31.0 directorate rename (runs by itself when the store / auth file is loaded; calling it again
  // changes 0 rows). Same counters as sqlStorage.migrateDirectorates.
  async migrateDirectorates() {
    const s = getStore();
    const a = getAuth();
    const counts = { ...migrateStoreDirectorates(s), ...migrateAuthDirectorates(a) };
    if (counts.directorates_removed + counts.divisions_moved + counts.survey_responses + counts.attendances + counts.app_settings + counts.operational_records) saveStore();
    if (counts.user_scopes + counts.users) saveAuth();
    return counts;
  },

  // v2.49.0 upgrade step (runs by itself once when auth.json is loaded); same contract as the SQL backend: Users still at
  // null whose scope covers an event_manager_directorates directorate get events = true. Returns the accounts changed.
  async migrateEventManagerMenuAccess({ onlyUserIds } = {}) {
    const a = getAuth();
    const managerDirs = ((getStore().appSettings || {}).event_manager_directorates || {}).value || [];
    const targets = a.users.filter(u => u.role === 'USER' && !u.menu_access && (!onlyUserIds || onlyUserIds.includes(u.user_id))
      && coversEventManagerDirectorate(u.scopes, managerDirs));
    targets.forEach(u => { u.menu_access = { ...DEFAULT_USER_MENU_ACCESS, events: true }; });
    if (targets.length) saveAuth();
    return targets.length;
  },

  // --- APP SETTINGS (admin-managed UI values: PX target line, event dropdown options) ---
  getSettings() {
    const out = {};
    Object.entries(getStore().appSettings || {}).forEach(([k, v]) => { out[k] = v.value; });
    return out;
  },
  setSetting(key, value) {
    const s = getStore();
    if (!s.appSettings || !s.appSettings[key]) throw new Error(`Setting "${key}" not found.`);
    s.appSettings[key] = { ...s.appSettings[key], value };
    saveStore();
    return value;
  },

  // --- SURVEY UPLOAD REMINDERS ---
  // Is there ANY survey response for this metric dated in [startDate, endDate)? (YYYY-MM-DD strings)
  hasSurveyDataInPeriod(metric_id, startDate, endDate) {
    const id = parseInt(metric_id);
    // an ESS summary (v2.32.0) is dated on the 1st of its month
    const essHit = (getStore().essResults || []).some(r => {
      if (r.metric_id !== id) return false;
      const d = `${r.survey_year}-${String(r.survey_month).padStart(2, '0')}-01`;
      return d >= startDate && d < endDate;
    });
    return essHit || (getStore().surveyUploadedResponses || []).some(r => {
      if (r.metric_id !== id) return false;
      const d = normalizeDateString(r.survey_date || r.created_at) || '';
      return d >= startDate && d < endDate;
    });
  },
  getReminderLog(limit = 50) {
    return [...(getStore().reminderLog || [])].sort((a, b) => b.log_id - a.log_id).slice(0, limit);
  },
  getReminderLogFor(metric_id, expected_period) {
    return (getStore().reminderLog || []).filter(l => l.metric_id === parseInt(metric_id) && l.expected_period === expected_period);
  },
  addReminderLog(entry) {
    const s = getStore();
    s.reminderLog = s.reminderLog || [];
    const record = {
      log_id: s.reminderLog.reduce((mx, l) => Math.max(mx, l.log_id || 0), 0) + 1,
      metric_id: parseInt(entry.metric_id),
      expected_period: String(entry.expected_period),
      sent_on: entry.sent_on,
      attempted_at: new Date().toISOString(),
      status: entry.status,
      pic_email: entry.pic_email,
      error_message: entry.error_message || null
    };
    s.reminderLog.push(record);
    saveStore();
    return record;
  },

  // --- LOGIN ACCOUNTS, SESSIONS, AUDIT TRAIL (server/data/auth.json) ---
  countUsers() {
    return getAuth().users.length;
  },
  listUsers() {
    return getAuth().users.map(copyUser);
  },
  getUserById(user_id) {
    return copyUser(getAuth().users.find(u => u.user_id === parseInt(user_id, 10)));
  },
  getUserByUsername(username) {
    const key = String(username).toLowerCase();
    return copyUser(getAuth().users.find(u => u.username.toLowerCase() === key));
  },
  // is_test_account (v2.43.0) is server-side only: the regression suite and any verification/QC script that creates a
  // temporary account must pass `is_test_account: true` so its audit rows are hidden from the Audit Trail by default:
  //   await storage.createUser({ username: 'verify-<stamp>', ..., role: 'ADMIN', is_test_account: true });
  // POST /api/admin/users never reads it from the body; it only inherits the flag of the (test) admin creating the account.
  createUser(u) {
    const a = getAuth();
    if (a.users.some(x => x.username.toLowerCase() === String(u.username).toLowerCase())) {
      const e = new Error(`Username "${u.username}" is already taken.`);
      e.code = 'DUPLICATE_USER';
      throw e;
    }
    const record = {
      user_id: a.users.reduce((mx, x) => Math.max(mx, x.user_id), 0) + 1,
      username: u.username,
      full_name: u.full_name,
      email: u.email || '',
      password_hash: u.password_hash,
      role: u.role,
      scopes: normalizeScopes(u.scopes),
      is_active: u.is_active === undefined ? true : !!u.is_active,
      must_change_password: u.must_change_password === undefined ? true : !!u.must_change_password,
      failed_attempts: 0,
      locked_until: null,
      created_at: new Date().toISOString(),
      last_login_at: null,
      is_test_account: u.is_test_account === true,
      menu_access: u.menu_access && typeof u.menu_access === 'object' ? { ...u.menu_access } : null // v2.49.0: null = defaults
    };
    a.users.push(record);
    saveAuth();
    return copyUser(record);
  },
  updateUser(user_id, patch) {
    const a = getAuth();
    const u = a.users.find(x => x.user_id === parseInt(user_id, 10));
    if (!u) return null;
    ['full_name', 'email', 'password_hash', 'role', 'is_active', 'must_change_password',
      'failed_attempts', 'locked_until', 'last_login_at'].forEach(f => {
      if (patch[f] !== undefined) u[f] = (f === 'locked_until' || f === 'last_login_at') && patch[f] ? new Date(patch[f]).toISOString() : patch[f];
    });
    if (patch.scopes !== undefined) u.scopes = normalizeScopes(patch.scopes);
    if (patch.menu_access !== undefined) u.menu_access = patch.menu_access && typeof patch.menu_access === 'object' ? { ...patch.menu_access } : null;
    saveAuth();
    return copyUser(u);
  },
  deleteUser(user_id) {
    const a = getAuth();
    const id = parseInt(user_id, 10);
    const idx = a.users.findIndex(x => x.user_id === id);
    if (idx === -1) return null;
    const [removed] = a.users.splice(idx, 1);
    a.sessions = a.sessions.filter(s => s.user_id !== id);
    saveAuth();
    return copyUser(removed);
  },
  createSession({ token_hash, user_id, expires_at, last_activity_at }) {
    const a = getAuth();
    const now = new Date().toISOString();
    a.sessions.push({ token_hash, user_id: parseInt(user_id, 10), expires_at: new Date(expires_at).toISOString(), created_at: now,
      last_activity_at: last_activity_at ? new Date(last_activity_at).toISOString() : now });
    saveAuth();
  },
  // last_activity_at (v2.44.0): missing on sessions opened before v2.44.0 -> read as created_at.
  getSession(token_hash) {
    const s = getAuth().sessions.find(x => x.token_hash === token_hash);
    return s ? { token_hash: s.token_hash, user_id: s.user_id, expires_at: s.expires_at, last_activity_at: s.last_activity_at || s.created_at || null } : null;
  },
  // Records real user activity on one session (login / POST /api/auth/activity only - never on ordinary requests).
  setSessionActivity(token_hash, at) {
    const s = getAuth().sessions.find(x => x.token_hash === token_hash);
    if (!s) return false;
    s.last_activity_at = (at ? new Date(at) : new Date()).toISOString();
    saveAuth();
    return true;
  },
  // Returns true when a session was actually removed (lets the idle sign-out audit exactly once).
  deleteSession(token_hash) {
    const a = getAuth();
    const before = a.sessions.length;
    a.sessions = a.sessions.filter(x => x.token_hash !== token_hash);
    if (a.sessions.length === before) return false;
    saveAuth();
    return true;
  },
  deleteSessionsForUser(user_id, exceptTokenHash) {
    const a = getAuth();
    const id = parseInt(user_id, 10);
    a.sessions = a.sessions.filter(x => x.user_id !== id || (exceptTokenHash && x.token_hash === exceptTokenHash));
    saveAuth();
  },
  purgeExpiredSessions() {
    const a = getAuth();
    const now = Date.now();
    a.sessions = a.sessions.filter(x => new Date(x.expires_at).getTime() >= now);
    saveAuth();
  },
  addAuditLog(e) {
    const a = getAuth();
    a.audit.push({
      audit_id: (a.audit.length ? a.audit[a.audit.length - 1].audit_id : 0) + 1,
      occurred_at: new Date().toISOString(),
      user_id: e.user_id === undefined ? null : e.user_id,
      username: e.username || null,
      action: String(e.action).slice(0, 50),
      target: e.target ? String(e.target).slice(0, 200) : null,
      ip: e.ip ? String(e.ip).slice(0, 64) : null,
      is_test: e.is_test === true
    });
    if (a.audit.length > 20000) a.audit = a.audit.slice(-20000);
    saveAuth();
  },
  // Test-run rows (is_test) are left out unless includeTest; the limit applies after that filter.
  getAuditLog(limit = 200, { includeTest = false } = {}) {
    const n = Math.max(1, Math.min(parseInt(limit, 10) || 200, 1000));
    return getAuth().audit.filter(e => includeTest || e.is_test !== true).reverse().slice(0, n).map(e => ({ ...e, is_test: e.is_test === true }));
  },
  // Same rules as sqlStorage.markHistoricalTestAudit (also runs by itself when auth.json is loaded); a second call marks 0.
  markHistoricalTestAudit() {
    const a = getAuth();
    const open = a.audit.filter(e => e.is_test !== true);
    const marked = markAuditRows(a, open);
    if (marked) saveAuth();
    return { marked, visible: open.length - marked };
  },

  // --- REMINDER E-MAIL SENDER SETTINGS (password is stored encrypted — see secretBox.js) ---
  getEmailSettings() {
    return { ...initialEmailSettings, ...(getStore().emailSettings || {}) };
  },
  saveEmailSettings(settings) {
    const s = getStore();
    s.emailSettings = { ...settings, updated_at: new Date().toISOString() };
    saveStore();
    return s.emailSettings;
  },

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
      throw new Error(`Journey #${id} not found.`);
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
      throw new Error(`Journey #${id} not found.`);
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
      throw new Error(`Checkpoint #${id} not found.`);
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
      throw new Error(`Checkpoint #${id} not found.`);
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

    const surveySource = resolveSurveySource({ requested: metricData.survey_source, metricType: (metricData.metric_type || 'SURVEY').toUpperCase() });
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
      requires_manual_upload: resolveRequiresManualUpload({
        surveySource, requested: metricData.requires_manual_upload, defaultValue: (metricData.metric_type || 'SURVEY').toUpperCase() === 'SURVEY'
      }),
      upload_deadline_day: metricData.upload_deadline_day !== undefined && metricData.upload_deadline_day !== '' ? parseInt(metricData.upload_deadline_day) : 25,
      upload_deadline_month: metricData.upload_deadline_month !== undefined && metricData.upload_deadline_month !== '' ? parseInt(metricData.upload_deadline_month) : 11,
      pic_name: metricData.pic_name ? String(metricData.pic_name).trim() : (metricData.experience_owner || ''),
      pic_email: metricData.pic_email ? String(metricData.pic_email).trim() : '',
      unit: metricData.unit !== undefined && metricData.unit !== null ? parseUnit(metricData.unit) : defaultUnitForScale(metricData.scale_type || (metricData.metric_type === 'SURVEY' ? 'RATING_5' : 'PERCENTAGE')),
      survey_source: surveySource
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
      throw new Error(`Metric #${id} not found.`);
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
    const surveySource = resolveSurveySource({
      requested: metricData.survey_source, metricType: resolvedMetricType, current: current.survey_source, fallback: inferSurveySource({ ...current, metric_type: resolvedMetricType })
    });

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
      survey_source: surveySource,
      requires_manual_upload: resolveRequiresManualUpload({
        surveySource, requested: metricData.requires_manual_upload, current: current.requires_manual_upload, defaultValue: defaultRequiresManualUpload
      }),
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
      last_data_date: metricData.last_data_date !== undefined ? String(metricData.last_data_date).trim() : current.last_data_date,
      unit: metricData.unit !== undefined ? parseUnit(metricData.unit) : current.unit
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
      throw new Error(`Metric #${id} not found.`);
    }

    const deleted = s.metrics.splice(idx, 1)[0];
    s.reminderLog = (s.reminderLog || []).filter(l => l.metric_id !== id);
    // A metric's survey data goes with it: orphaned responses would otherwise attach themselves to
    // whichever new metric later receives the same id (ids are max+1).
    s.surveyUploadedResponses = (s.surveyUploadedResponses || []).filter(r => r.metric_id !== id);
    s.essResults = (s.essResults || []).filter(r => r.metric_id !== id);
    s.surveyUploads = (s.surveyUploads || []).filter(u => u.metric_id !== id);
    
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
      throw new Error(`Event "${event_id}" not found.`);
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
      throw new Error(`NIP ${attendanceData.nip} has already checked in to this event.`);
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
      throw new Error(`Attendance record of NIP ${nip} in event "${event_id}" not found.`);
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
      throw new Error(`NIP ${feedbackData.nip} has already filled in the evaluation questionnaire for this event.`);
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
      throw new Error(`Feedback of NIP ${nip} in event "${event_id}" not found.`);
    }
    const [removed] = s.feedbackResponses.splice(idx, 1);
    saveStore();
    return removed;
  },

  // --- MEDIA GALLERY ---
  getMediaByEvent(event_id) {
    return getStore().media.filter(m => m.event_id === event_id);
  },
  getAllMedia() {
    return getStore().media;
  },
  getMediaById(media_id) {
    return getStore().media.find(m => m.media_id === media_id) || null;
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
    // Videos get an AI transcript (transcribeService.js); null for everything else.
    if (mediaItem.transcript_status) newMedia.transcript_status = mediaItem.transcript_status;
    s.media.push(newMedia);
    saveStore();
    return newMedia;
  },
  // Whitelisted partial update — used by the background transcription job to record its
  // progress/result without being able to rewrite identity fields (media_id/event_id). file_path is only changed by
  // mediaFileService (renaming a finished video to its original upload name).
  updateMedia(media_id, patch) {
    const s = getStore();
    const media = s.media.find(m => m.media_id === media_id);
    if (!media) return null;
    const allowed = [
      'caption', 'file_path', 'ai_generated_description', 'transcript', 'transcript_segments',
      'transcript_status', 'transcript_error', 'transcript_language', 'duration_seconds',
      'summary', 'summary_points', 'summary_status', 'summary_source', 'summary_model',
      'summary_language', 'summary_generated_at', 'summary_error'
    ];
    allowed.forEach(k => {
      if (patch[k] !== undefined) media[k] = patch[k];
    });
    saveStore();
    return media;
  },
  // Returns the removed record (so the caller can delete its file from disk), or null.
  deleteMedia(media_id) {
    const s = getStore();
    const removed = s.media.find(m => m.media_id === media_id) || null;
    s.media = s.media.filter(m => m.media_id !== media_id);
    saveStore();
    return removed;
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
        employee_name: r.employee_name ? r.employee_name.trim() : (r.participant_name || r.candidate_name || 'CIMB Employee'),
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

  // --- ESS RESULT SUMMARIES (v2.32.0) --- same contract as sqlStorage
  getEssResults(metric_id, { year, month } = {}) {
    const id = metric_id === null || metric_id === undefined ? null : parseInt(metric_id);
    return (getStore().essResults || [])
      .filter(r => (id === null || r.metric_id === id) && (!year || r.survey_year === parseInt(year)) && (!month || r.survey_month === parseInt(month)))
      .sort((a, b) => a.metric_id - b.metric_id || a.survey_year - b.survey_year || a.survey_month - b.survey_month || a.ess_result_id - b.ess_result_id)
      .map(r => JSON.parse(JSON.stringify(r)));
  },
  getLatestEssPeriod(metric_id, endYear, endMonth) {
    const id = parseInt(metric_id);
    const endKey = parseInt(endYear) * 100 + parseInt(endMonth || 12);
    const keys = (getStore().essResults || []).filter(r => r.metric_id === id).map(r => r.survey_year * 100 + r.survey_month).filter(k => k <= endKey);
    if (!keys.length) return null;
    const k = Math.max(...keys);
    return { year: Math.floor(k / 100), month: k % 100 };
  },
  saveEssResultUpload(meta, rows) {
    const s = getStore();
    s.surveyUploads = s.surveyUploads || [];
    s.essResults = s.essResults || [];
    const record = {
      upload_id: meta.upload_id || `ess-${Date.now()}`,
      metric_id: parseInt(meta.metric_id),
      file_name: meta.file_name,
      total_rows: meta.total_rows,
      valid_rows: meta.valid_rows,
      invalid_rows: meta.invalid_rows || 0,
      calculated_avg_score: meta.calculated_avg_score,
      uploaded_by: meta.uploaded_by || 'HR Admin',
      uploaded_at: new Date().toISOString()
    };
    const y = parseInt(meta.survey_year);
    const m = parseInt(meta.survey_month);
    const before = s.essResults.length;
    s.essResults = s.essResults.filter(r => !(r.metric_id === record.metric_id && r.survey_year === y && r.survey_month === m));
    const replaced = before - s.essResults.length;
    s.surveyUploads.unshift(record);
    rows.forEach(r => {
      s.essResults.push({
        ess_result_id: nextEssResultId(s),
        upload_id: record.upload_id,
        metric_id: record.metric_id,
        survey_year: y,
        survey_month: m,
        org_level: r.org_level,
        directorate: r.org_level === 'BANKWIDE' ? null : r.directorate,
        participation: parseInt(r.participation) || 0,
        index_score: Number(r.index_score),
        questions: r.questions || [],
        created_at: record.uploaded_at
      });
    });
    saveStore();
    return { record, replaced_rows: replaced };
  },
  // --- EXIT INTERVIEW (v2.38.0) --- same contract as sqlStorage
  getExitInterviews({ from, to } = {}) {
    return (getStore().exitInterviews || [])
      .filter(r => (!from || r.effective_date >= from) && (!to || r.effective_date <= to))
      .sort((a, b) => (a.effective_date < b.effective_date ? -1 : a.effective_date > b.effective_date ? 1 : a.exit_id - b.exit_id))
      .map(r => JSON.parse(JSON.stringify({ career_scores: null, updated_at: null, ...r })));
  },
  getExitInterviewMonthCounts() {
    return exitMonthCountsOf(getStore());
  },
  getExitInterviewUploads() {
    return [...(getStore().exitInterviewUploads || [])]
      .sort((a, b) => (a.uploaded_at < b.uploaded_at ? 1 : a.uploaded_at > b.uploaded_at ? -1 : (a.upload_id < b.upload_id ? 1 : -1)))
      .map(u => ({ ...u }));
  },
  saveExitInterviewUpload(meta, rows) {
    const s = getStore();
    s.exitInterviews = s.exitInterviews || [];
    s.exitInterviewUploads = s.exitInterviewUploads || [];
    let removed = 0;
    if (meta.source !== 'SEED_DUMMY') {
      const months = new Set(rows.map(r => r.effective_date.slice(0, 7)));
      const before = s.exitInterviews.length;
      s.exitInterviews = s.exitInterviews.filter(r => !(r.source === 'SEED_DUMMY' && months.has(r.effective_date.slice(0, 7))));
      removed = before - s.exitInterviews.length;
    }
    const byKey = new Map(s.exitInterviews.map(r => [exitKey(r), r]));
    const now = new Date().toISOString();
    let inserted = 0;
    let updated = 0;
    let id = nextExitId(s);
    rows.forEach(r => {
      const values = {};
      EXIT_FIELDS.forEach(k => { values[k] = r[k] === undefined ? null : JSON.parse(JSON.stringify(r[k])); });
      values.employee_name = values.employee_name || '';
      const existing = byKey.get(exitKey(r));
      if (existing) {
        Object.assign(existing, values, { nik: existing.nik, upload_id: meta.upload_id, source: meta.source, updated_at: now });
        updated++;
      } else {
        const row = { exit_id: id++, upload_id: meta.upload_id, ...values, source: meta.source, created_at: now, updated_at: null };
        s.exitInterviews.push(row);
        byKey.set(exitKey(row), row);
        inserted++;
      }
    });
    const record = { ...meta, total_rows: rows.length, inserted_rows: inserted, updated_rows: updated, removed_dummy_rows: removed,
      period_from: meta.period_from || null, period_to: meta.period_to || null, uploaded_by: meta.uploaded_by || 'HR Admin', uploaded_at: now };
    s.exitInterviewUploads.push(record);
    saveStore();
    return { record: { ...record }, inserted, updated, removed_dummy: removed };
  },
  topUpExitInterviewSeed() {
    const added = topUpStoreExitSeed(getStore());
    if (added.length) saveStore();
    return added;
  },

  deleteEssResultsForMetric(metric_id) {
    const s = getStore();
    const id = parseInt(metric_id);
    const before = (s.essResults || []).length;
    s.essResults = (s.essResults || []).filter(r => r.metric_id !== id);
    saveStore();
    return before - s.essResults.length;
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
      throw new Error('The questions must be an array.');
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
    (s.essResults || []).forEach(r => years.add(String(r.survey_year)));
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
    const parsed = parseFilterOptions(filterOptions);
    if (!parsed) return responses;
    const { mode, year, month, directorate, subDirectorate, endMonth, scopes } = parsed;

    return responses.filter(r => {
      const d = normalizeDateString(r.survey_date || r.created_at) || '';

      // 1. Period / Date Filtering
      if (mode === 'MTD') {
        const targetPrefix = `${year}-${month}`;
        if (!d.startsWith(targetPrefix)) return false;
      } else if (mode === 'YTD') {
        if (year && !d.startsWith(year)) return false;
        // endMonth is capped by the clock in parseFilterOptions (current year -> this month); '00' = a future year
        if (endMonth === '00') return false;
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

      // 4. Union scope (login's data scope): the row must fall in at least one scope entry
      if (scopes && !rowInScopes(scopes, r.directorate || r.university || r.applied_position || '', r.division || r.major || r.recruitment_channel || '')) return false;

      return true;
    });
  }
};

module.exports = storage;

