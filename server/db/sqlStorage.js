// server/db/sqlStorage.js
// Microsoft SQL Server storage backend (STORAGE_BACKEND=sql). Implements the exact same
// (async) method contract as jsonStorage.js, so server.js and the services never know which
// backend they are talking to. Every read goes to SQL Server; nothing is cached in memory.
//
// Photos & videos of Signature Events are NOT stored in the database: the files stay on disk
// under server/uploads and px_media.file_path holds their path (plus caption + AI transcript).
const fs = require('fs');
const path = require('path');
const sql = require('mssql');
const seed = require('./seedData');
const { defaultUnitForScale, parseUnit } = require('./metricUnit');
const { inferSurveySource, isEssMetric, resolveSurveySource, resolveRequiresManualUpload } = require('./surveySource');
const { buildInitialStore } = require('./initialStore');
const { parseFilterOptions, normalizeDateString, CURRENT_YEAR } = require('./filterUtils');
const { normalizeScopes } = require('./scopeUtils');
const { planDirectory, renamedDirectorate, migrateScopes, migrateDirectorateOptions, DIRECTORATE_SETTING_KEYS } = require('./directorateMigration');

// ------------------------------------------------------------------ connection
let poolPromise = null;

function connectionConfig() {
  return {
    server: process.env.DB_SERVER || 'localhost',
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME || 'PeopleExperiencePX',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: {
      encrypt: String(process.env.DB_ENCRYPT || 'false').toLowerCase() === 'true',
      trustServerCertificate: String(process.env.DB_TRUST_SERVER_CERTIFICATE || 'true').toLowerCase() !== 'false'
    },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    connectionTimeout: 15000,
    requestTimeout: 120000
  };
}

function getPool() {
  if (!poolPromise) {
    const pool = new sql.ConnectionPool(connectionConfig());
    pool.on('error', err => console.error('[sqlStorage] pool error:', err.message));
    poolPromise = pool.connect().catch(err => {
      poolPromise = null; // allow a later retry instead of caching the failure
      throw err;
    });
  }
  return poolPromise;
}

// Typed-parameter helpers for the few cases where inference is not enough.
const T = {
  date: v => ({ __t: sql.VarChar(10), v }),                 // 'YYYY-MM-DD' -> implicit DATE conversion
  max: v => ({ __t: sql.NVarChar(sql.MAX), v })
};

function bindParams(request, params) {
  for (const [name, v] of Object.entries(params || {})) {
    if (v && typeof v === 'object' && v.__t) request.input(name, v.__t, v.v);
    else if (v === null || v === undefined) request.input(name, sql.NVarChar(sql.MAX), null);
    else if (typeof v === 'boolean') request.input(name, sql.Bit, v);
    else if (typeof v === 'number') request.input(name, Number.isInteger(v) ? sql.Int : sql.Float, v);
    else if (v instanceof Date) request.input(name, sql.DateTime2(3), v);
    else request.input(name, sql.NVarChar(sql.MAX), String(v));
  }
  return request;
}

// Runs a parameterized query on the pool, or inside a transaction when `tx` is given.
async function run(text, params, tx) {
  const request = tx ? new sql.Request(tx) : (await getPool()).request();
  bindParams(request, params);
  const result = await request.query(text);
  return result.recordset || [];
}

async function inTransaction(work) {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const out = await work(tx);
    await tx.commit();
    return out;
  } catch (err) {
    try { await tx.rollback(); } catch (_) { /* already rolled back */ }
    throw err;
  }
}

function isUniqueViolation(err) {
  const n = err && (err.number || (err.originalError && err.originalError.info && err.originalError.info.number));
  return n === 2627 || n === 2601;
}

// ------------------------------------------------------------------ small converters
const iso = d => (d instanceof Date ? d.toISOString() : (d || null));
const parseJson = (text, fallback) => {
  if (text === null || text === undefined || text === '') return fallback;
  try { return JSON.parse(text); } catch (_) { return fallback; }
};
const toDateObj = v => {
  const d = v ? new Date(v) : new Date();
  return isNaN(d.getTime()) ? new Date() : d;
};
// Strict 'YYYY-MM-DD' for the DATE columns; anything unparseable becomes null.
function toSqlDate(v) {
  const s = normalizeDateString(v);
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
}
const sqlDateObj = s => new Date(`${s}T00:00:00Z`);

// ------------------------------------------------------------------ row mappers
const METRIC_SELECT = `
  SELECT m.*, CONVERT(char(10), m.last_data_date, 23) AS last_data_date_str,
         t.target_value, t.target_display, t.min_threshold
  FROM dbo.px_metrics m
  LEFT JOIN dbo.px_metric_targets t ON t.metric_id = m.metric_id`;

function rowToMetric(r) {
  const m = {
    metric_id: r.metric_id,
    journey_id: r.journey_id,
    checkpoint_id: r.checkpoint_id,
    metric_name: r.metric_name,
    metric_type: r.metric_type,
    scale_type: r.scale_type,
    source_of_data: r.source_of_data,
    experience_owner: r.experience_owner,
    target_value: r.target_value === null || r.target_value === undefined ? 0 : r.target_value,
    target_display: r.target_display === null || r.target_display === undefined ? '' : r.target_display,
    min_threshold: r.min_threshold === null || r.min_threshold === undefined ? 75 : r.min_threshold,
    raw_value: r.raw_value,
    normalized_score: r.normalized_score,
    weight: r.weight,
    is_indicative: !!r.is_indicative,
    is_employee_metric: !!r.is_employee_metric,
    target_audience: r.target_audience,
    underlying_questions: parseJson(r.underlying_questions, []),
    update_frequency: r.update_frequency,
    requires_manual_upload: !!r.requires_manual_upload,
    upload_deadline_day: r.upload_deadline_day,
    upload_deadline_month: r.upload_deadline_month,
    pic_name: r.pic_name,
    pic_email: r.pic_email,
    unit: r.unit === null || r.unit === undefined ? defaultUnitForScale(r.scale_type) : r.unit,
    survey_source: r.survey_source || null,
    metric_weight: r.weight
  };
  if (r.last_data_date_str) m.last_data_date = r.last_data_date_str;
  if (r.notes !== null && r.notes !== undefined) m.notes = r.notes;
  return m;
}

function rowToEvent(r) {
  return {
    event_id: r.event_id,
    event_name: r.event_name,
    program_category: r.program_category,
    event_date: r.event_date,
    event_type: r.event_type,
    location: r.location,
    target_participants: r.target_participants,
    pre_event_code: r.pre_event_code,
    post_event_code: r.post_event_code,
    is_attendance_open: !!r.is_attendance_open,
    is_feedback_open: !!r.is_feedback_open,
    created_by: r.created_by
  };
}

const rowToAttendance = r => ({
  attendance_id: r.attendance_id,
  event_id: r.event_id,
  nip: r.nip,
  employee_name: r.employee_name,
  cimb_email: r.cimb_email,
  directorate: r.directorate,
  division: r.division,
  attendance_timestamp: iso(r.attendance_timestamp)
});

const rowToFeedback = r => ({
  response_id: r.response_id,
  event_id: r.event_id,
  nip: r.nip,
  ratings: parseJson(r.ratings_json, {}),
  verbatim: r.verbatim,
  submitted_at: iso(r.submitted_at)
});

function rowToMedia(r) {
  const m = {
    media_id: r.media_id,
    event_id: r.event_id,
    file_name: r.file_name,
    file_path: r.file_path,
    file_type: r.file_type,
    caption: r.caption,
    ai_generated_description: r.ai_generated_description,
    highlight_order: r.highlight_order,
    created_at: iso(r.created_at)
  };
  // Transcript fields exist only on videos that went through the transcription pipeline.
  if (r.transcript_status !== null && r.transcript_status !== undefined) m.transcript_status = r.transcript_status;
  if (r.transcript_error !== null && r.transcript_error !== undefined) m.transcript_error = r.transcript_error;
  if (r.transcript !== null && r.transcript !== undefined) m.transcript = r.transcript;
  if (r.transcript_segments !== null && r.transcript_segments !== undefined) m.transcript_segments = parseJson(r.transcript_segments, []);
  if (r.transcript_language !== null && r.transcript_language !== undefined) m.transcript_language = r.transcript_language;
  if (r.duration_seconds !== null && r.duration_seconds !== undefined) m.duration_seconds = r.duration_seconds;
  // AI summary of the transcript (v2.28.0); absent until a summary was requested.
  if (r.summary_status !== null && r.summary_status !== undefined) {
    m.summary_status = r.summary_status;
    m.summary = r.summary === null || r.summary === undefined ? '' : r.summary;
    m.summary_points = parseJson(r.summary_points, []);
    m.summary_source = r.summary_source || null;
    m.summary_model = r.summary_model || null;
    m.summary_language = r.summary_language || null;
    m.summary_generated_at = r.summary_generated_at ? iso(r.summary_generated_at) : null;
    m.summary_error = r.summary_error || '';
  }
  return m;
}

const rowToUpload = r => ({
  upload_id: r.upload_id,
  metric_id: r.metric_id,
  file_name: r.file_name,
  total_rows: r.total_rows,
  valid_rows: r.valid_rows,
  invalid_rows: r.invalid_rows,
  calculated_avg_score: r.calculated_avg_score,
  uploaded_by: r.uploaded_by,
  uploaded_at: iso(r.uploaded_at)
});

const rowToQuestion = r => {
  const q = {
    question_id: r.question_id,
    question_text: r.question_text,
    question_type: r.question_type,
    display_order: r.display_order,
    is_default: !!r.is_default
  };
  const extra = parseJson(r.extra_json, null);
  return extra ? { ...extra, ...q } : q;
};

const QUESTION_KEYS = ['question_id', 'question_text', 'question_type', 'display_order', 'is_default'];
function questionParams(q, index) {
  const extra = {};
  Object.keys(q || {}).forEach(k => { if (!QUESTION_KEYS.includes(k)) extra[k] = q[k]; });
  return {
    question_id: parseInt(q.question_id !== undefined ? q.question_id : index + 1, 10),
    question_text: T.max(q.question_text === undefined || q.question_text === null ? '' : String(q.question_text)),
    question_type: String(q.question_type || 'RATING_5'),
    display_order: parseInt(q.display_order !== undefined ? q.display_order : index + 1, 10),
    is_default: !!q.is_default,
    extra_json: Object.keys(extra).length ? T.max(JSON.stringify(extra)) : null
  };
}

// Survey responses are stored normalized (respondent_type + respondent_* + org_unit_*). The
// rest of the app (calculationEngine, alertEngine, evidence CSV ...) still reads the legacy
// per-population field names, so this one mapper re-derives them.
const RESPONSE_SELECT = `
  SELECT response_id, upload_id, metric_id, respondent_type, respondent_id, respondent_name,
         respondent_email, org_unit_1, org_unit_2, ratings_json, rating_score, verbatim_feedback,
         CONVERT(char(10), survey_date, 23) AS survey_date, source, created_at
  FROM dbo.px_survey_uploaded_responses`;

function rowToResponse(r) {
  const out = {
    response_id: r.response_id,
    upload_id: r.upload_id,
    metric_id: r.metric_id,
    nip: r.respondent_id,
    employee_name: r.respondent_name,
    cimb_email: r.respondent_email,
    email: r.respondent_email,
    directorate: r.org_unit_1,
    division: r.org_unit_2,
    ratings: parseJson(r.ratings_json, {}),
    rating_score: r.rating_score,
    verbatim_feedback: r.verbatim_feedback,
    survey_date: r.survey_date,
    source: r.source,
    created_at: iso(r.created_at)
  };
  if (r.respondent_type === 'CAMPUS_STUDENT') {
    out.participant_id = r.respondent_id;
    out.participant_name = r.respondent_name;
    out.university = r.org_unit_1;
    out.major = r.org_unit_2;
  } else if (r.respondent_type === 'JOB_CANDIDATE') {
    out.candidate_id = r.respondent_id;
    out.candidate_name = r.respondent_name;
    out.applied_position = r.org_unit_1;
    out.recruitment_channel = r.org_unit_2;
  }
  return out;
}

// Accepts a response in ANY of the legacy shapes (the CSV importer and seed data use
// nip/participant_id/candidate_id aliases) and returns the normalized column values.
function normalizeResponse(r) {
  const metricId = parseInt(r.metric_id, 10);
  let type = 'EMPLOYEE';
  if (metricId === 2 || r.participant_id || r.university) type = 'CAMPUS_STUDENT';
  else if (metricId === 5 || r.candidate_id || r.applied_position) type = 'JOB_CANDIDATE';

  const respondentId = r.nip ? r.nip.toString().trim() : (r.participant_id || r.candidate_id || '');
  const email = r.cimb_email ? String(r.cimb_email).trim().toLowerCase() : (r.email || '');
  const surveyDate = toSqlDate(r.survey_date) || toSqlDate(new Date().toISOString());
  return {
    upload_id: r.upload_id,
    metric_id: metricId,
    respondent_type: type,
    respondent_id: String(respondentId),
    respondent_name: r.employee_name ? r.employee_name.trim() : (r.participant_name || r.candidate_name || 'CIMB Employee'),
    respondent_email: String(email),
    org_unit_1: r.directorate ? r.directorate.trim() : (r.university || r.applied_position || 'General'),
    org_unit_2: r.division ? r.division.trim() : (r.major || r.recruitment_channel || 'General'),
    ratings_json: JSON.stringify(r.ratings || {}),
    rating_score: r.rating_score === undefined || r.rating_score === null || r.rating_score === '' ? null : parseFloat(r.rating_score),
    verbatim_feedback: r.verbatim_feedback ? String(r.verbatim_feedback).trim() : '',
    survey_date: surveyDate,
    source: r.source || 'MANUAL_UPLOAD',
    created_at: toDateObj(r.created_at)
  };
}

// Bulk-inserts normalized responses (thousands of rows in one round trip, in the given order -
// response_id is assigned in that order). `uploadId` overrides each row's own upload_id when set.
async function bulkInsertResponses(tx, uploadId, rows) {
  if (!rows.length) return;
  const table = new sql.Table('dbo.px_survey_uploaded_responses');
  table.create = false;
  table.columns.add('upload_id', sql.NVarChar(64), { nullable: false });
  table.columns.add('metric_id', sql.Int, { nullable: false });
  table.columns.add('respondent_type', sql.VarChar(20), { nullable: false });
  table.columns.add('respondent_id', sql.NVarChar(100), { nullable: false });
  table.columns.add('respondent_name', sql.NVarChar(200), { nullable: false });
  table.columns.add('respondent_email', sql.NVarChar(200), { nullable: false });
  table.columns.add('org_unit_1', sql.NVarChar(200), { nullable: false });
  table.columns.add('org_unit_2', sql.NVarChar(200), { nullable: false });
  table.columns.add('ratings_json', sql.NVarChar(sql.MAX), { nullable: false });
  table.columns.add('rating_score', sql.Float, { nullable: true });
  table.columns.add('verbatim_feedback', sql.NVarChar(sql.MAX), { nullable: false });
  table.columns.add('survey_date', sql.Date, { nullable: false });
  table.columns.add('source', sql.VarChar(40), { nullable: false });
  table.columns.add('created_at', sql.DateTime2(3), { nullable: false });
  rows.forEach(n => table.rows.add(
    uploadId || n.upload_id || 'unknown-upload', n.metric_id, n.respondent_type, n.respondent_id, n.respondent_name, n.respondent_email,
    n.org_unit_1, n.org_unit_2, n.ratings_json, n.rating_score, n.verbatim_feedback,
    sqlDateObj(n.survey_date), n.source, n.created_at
  ));
  await new sql.Request(tx).bulk(table);
}

// ------------------------------------------------------------------ survey question catalogue (px_survey_questions)
const SQ_FIELDS = ['key', 'label', 'text', 'type', 'mandatory', 'dimension', 'visible_based_on', 'required_based_on',
  'percent_favorable', 'percent_neutral', 'percent_unfavorable'];
const numOrNull = v => (v === undefined || v === null || v === '' || !Number.isFinite(parseFloat(v)) ? null : parseFloat(v));
const textOrNull = v => (v === undefined || v === null ? null : String(v));

function rowToSurveyQuestion(r) {
  const q = { key: r.question_key, label: r.label, text: r.question_text, type: r.question_type, mandatory: !!r.mandatory };
  if (r.dimension !== null) q.dimension = r.dimension;
  if (r.visible_based_on !== null) q.visible_based_on = r.visible_based_on;
  if (r.required_based_on !== null) q.required_based_on = r.required_based_on;
  if (r.percent_favorable !== null) q.percent_favorable = r.percent_favorable;
  if (r.percent_neutral !== null) q.percent_neutral = r.percent_neutral;
  if (r.percent_unfavorable !== null) q.percent_unfavorable = r.percent_unfavorable;
  const extra = parseJson(r.extra_json, null);
  return extra ? { ...extra, ...q } : q;
}

// Replaces the whole question set of one metric.
async function replaceSurveyQuestions(tx, metric_id, questions, customized) {
  await run('DELETE FROM dbo.px_survey_questions WHERE metric_id = @metric_id', { metric_id }, tx);
  const seen = new Set();
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i] || {};
    let key = String(q.key || `q${i + 1}`);
    while (seen.has(key)) key += '_';                         // (metric_id, question_key) is unique
    seen.add(key);
    const extra = {};
    Object.keys(q).forEach(k => { if (!SQ_FIELDS.includes(k)) extra[k] = q[k]; });
    await run(`INSERT INTO dbo.px_survey_questions (metric_id, display_order, question_key, label, question_text, question_type,
                 mandatory, dimension, visible_based_on, required_based_on, percent_favorable, percent_neutral, percent_unfavorable,
                 extra_json, is_customized)
               VALUES (@metric_id, @display_order, @question_key, @label, @question_text, @question_type, @mandatory, @dimension,
                 @visible_based_on, @required_based_on, @pf, @pn, @pu, @extra_json, @is_customized)`, {
      metric_id, display_order: i + 1, question_key: key, label: q.label === undefined || q.label === null ? '' : String(q.label),
      question_text: T.max(q.text === undefined || q.text === null ? '' : String(q.text)),
      question_type: String(q.type || 'SCALE_1_5'), mandatory: !!q.mandatory,
      dimension: textOrNull(q.dimension), visible_based_on: textOrNull(q.visible_based_on), required_based_on: textOrNull(q.required_based_on),
      pf: numOrNull(q.percent_favorable), pn: numOrNull(q.percent_neutral), pu: numOrNull(q.percent_unfavorable),
      extra_json: Object.keys(extra).length ? T.max(JSON.stringify(extra)) : null, is_customized: !!customized
    }, tx);
  }
}

// Code-defined starting set (metricQuestionService) - used ONLY to seed the table and for the
// explicit admin "Reset to default" action; every read goes to px_survey_questions.
function defaultQuestionsFor(metric_id) {
  const { DEFAULT_METRIC_QUESTIONS, getGenericQuestions } = require('../services/metricQuestionService');
  return DEFAULT_METRIC_QUESTIONS[metric_id] || getGenericQuestions();
}

// Gives every SURVEY metric that has no question rows yet its default set (idempotent).
async function seedSurveyQuestions(tx) {
  const missing = await run(`SELECT m.metric_id FROM dbo.px_metrics m
                             WHERE m.metric_type = 'SURVEY' AND NOT EXISTS (SELECT 1 FROM dbo.px_survey_questions q WHERE q.metric_id = m.metric_id)
                             ORDER BY m.metric_id`, {}, tx);
  for (const { metric_id } of missing) await replaceSurveyQuestions(tx, metric_id, defaultQuestionsFor(metric_id), false);
  return missing.length;
}

// Adds any directorate / division of the seed directory that is missing (never removes or renames
// anything an admin changed). Keeps the directory in step with the units respondents belong to.
async function topUpDirectory() {
  const have = await run(`SELECT d.directorate_name, v.division_name FROM dbo.px_directorates d
                          LEFT JOIN dbo.px_divisions v ON v.directorate_id = d.directorate_id`);
  const dirs = new Set(have.map(r => r.directorate_name));
  const pairs = new Set(have.filter(r => r.division_name !== null).map(r => r.directorate_name + '|' + r.division_name));
  const todo = [];
  for (const d of seed.initialDirectorates) {
    for (const div of d.divisions) if (!pairs.has(d.directorate_name + '|' + div)) todo.push([d.directorate_name, div]);
    if (!dirs.has(d.directorate_name) && !d.divisions.length) todo.push([d.directorate_name, null]);
  }
  if (!todo.length) return;
  await inTransaction(async tx => {
    for (const [name, division_name] of todo) {
      await run(`IF NOT EXISTS (SELECT 1 FROM dbo.px_directorates WHERE directorate_name = @name) INSERT INTO dbo.px_directorates (directorate_name) VALUES (@name)`, { name }, tx);
      if (division_name) {
        await run(`INSERT INTO dbo.px_divisions (directorate_id, division_name)
                   SELECT directorate_id, @division_name FROM dbo.px_directorates WHERE directorate_name = @name`, { name, division_name }, tx);
      }
    }
  });
  console.log(`[sqlStorage] Added ${todo.length} missing directory entries.`);
}

// Fills px_metrics.unit where it is still NULL (a database created before v2.25.0): the seed's unit for
// the seed metrics, otherwise the default of the metric's scale. Never touches a unit that is already set,
// so an admin's edit survives every restart.
async function topUpMetricUnits() {
  const rows = await run('SELECT metric_id, scale_type FROM dbo.px_metrics WHERE unit IS NULL');
  if (!rows.length) return;
  await inTransaction(async tx => {
    for (const r of rows) {
      await run('UPDATE dbo.px_metrics SET unit = @unit WHERE metric_id = @id AND unit IS NULL',
        { id: r.metric_id, unit: initialUnitFor({ metric_id: r.metric_id, scale_type: r.scale_type }) }, tx);
    }
  });
  console.log(`[sqlStorage] Filled the display unit of ${rows.length} metrics.`);
}

// Fills px_metrics.survey_source where it is still NULL on a SURVEY metric (a database created before v2.29.0):
// source_of_data mentioning ESS -> 'ESS', any other SURVEY -> 'SYSTEM'. A value that is already set (an admin's
// edit) is never touched, and OUTCOME metrics stay NULL.
async function topUpSurveySource() {
  const rows = await run(`SELECT metric_id, metric_type, source_of_data FROM dbo.px_metrics WHERE survey_source IS NULL AND metric_type = 'SURVEY'`);
  if (!rows.length) return;
  await inTransaction(async tx => {
    for (const r of rows) {
      await run(`UPDATE dbo.px_metrics SET survey_source = @src WHERE metric_id = @id AND survey_source IS NULL`,
        { id: r.metric_id, src: inferSurveySource(r) }, tx);
    }
  });
  console.log(`[sqlStorage] Filled the survey source of ${rows.length} SURVEY metrics.`);
}

// An ESS metric is always uploaded manually (ESS cannot be pulled from a system). Turns requires_manual_upload on
// for any ESS metric where it is off; the admin routes refuse to turn it off again, so after the first boot that
// needed it this finds nothing. Returns the ids it changed (logged so the change is traceable).
async function enforceEssManualUpload() {
  const rows = await run(`SELECT metric_id FROM dbo.px_metrics WHERE survey_source = 'ESS' AND requires_manual_upload = 0 ORDER BY metric_id`);
  if (!rows.length) return;
  await run(`UPDATE dbo.px_metrics SET requires_manual_upload = 1 WHERE survey_source = 'ESS' AND requires_manual_upload = 0`);
  console.log(`[sqlStorage] ESS metrics are always uploaded manually: requires_manual_upload turned on for metric(s) ${rows.map(r => r.metric_id).join(', ')}.`);
}

// ------------------------------------------------------------------ login accounts (px_users)
const rowToUser = r => ({
  user_id: r.user_id,
  username: r.username,
  full_name: r.full_name,
  email: r.email,
  password_hash: r.password_hash,
  role: r.role,
  scopes: [],             // filled by withScopes() from px_user_scopes
  is_active: !!r.is_active,
  must_change_password: !!r.must_change_password,
  failed_attempts: r.failed_attempts,
  locked_until: iso(r.locked_until),
  created_at: iso(r.created_at),
  last_login_at: iso(r.last_login_at)
});

// Scopes live in px_user_scopes (division NULL = every division of the directorate).
async function withScopes(users, tx) {
  if (!users.length) return users;
  const rows = await run('SELECT user_id, directorate, division FROM dbo.px_user_scopes ORDER BY scope_id', {}, tx);
  const byUser = new Map();
  rows.forEach(r => {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
    byUser.get(r.user_id).push({ directorate: r.directorate, divisions: r.division === null ? null : [r.division] });
  });
  users.forEach(u => { u.scopes = normalizeScopes(byUser.get(u.user_id) || []); });
  return users;
}

async function writeUserScopes(tx, user_id, scopes) {
  await run('DELETE FROM dbo.px_user_scopes WHERE user_id = @id', { id: user_id }, tx);
  for (const s of normalizeScopes(scopes)) {
    const divs = s.divisions === null ? [null] : s.divisions;
    for (const division of divs) {
      await run('INSERT INTO dbo.px_user_scopes (user_id, directorate, division) VALUES (@id, @directorate, @division)',
        { id: user_id, directorate: s.directorate, division }, tx);
    }
  }
}

// v2.26.0 accounts had ONE directorate + ONE division in px_users. Turn them into scope rows (division
// empty = all divisions). Only users without any scope row are touched, so it is safe on every boot.
async function migrateLegacyUserScopes() {
  await run(`INSERT INTO dbo.px_user_scopes (user_id, directorate, division)
                         SELECT u.user_id, u.directorate, NULLIF(LTRIM(RTRIM(u.division)), N'')
                         FROM dbo.px_users u
                         WHERE u.role = N'USER' AND u.directorate IS NOT NULL AND LTRIM(RTRIM(u.directorate)) <> N''
                           AND NOT EXISTS (SELECT 1 FROM dbo.px_user_scopes s WHERE s.user_id = u.user_id)`);
}

// v2.31.0: renames the 8 old demo directorates to the bank's 12 real ones everywhere a directorate
// name is stored (mapping in directorateMigration.js). Runs at boot before any top-up; only rows that
// still carry an old name are touched, so a second run changes 0 rows. Returns the rows changed per table.
const BIN = 'COLLATE Latin1_General_100_BIN2';
async function migrateDirectorates() {
  const counts = { directorates_removed: 0, divisions_moved: 0, survey_responses: 0, attendances: 0, user_scopes: 0, users: 0, app_settings: 0, operational_records: 0 };
  await inTransaction(async tx => {
    // Directory: rebuilt in seed order with every existing division re-parented.
    const dirRows = await run(`SELECT d.directorate_id, d.directorate_name, v.division_name FROM dbo.px_directorates d
                               LEFT JOIN dbo.px_divisions v ON v.directorate_id = d.directorate_id ORDER BY d.directorate_id, v.division_id`, {}, tx);
    const current = [];
    dirRows.forEach(r => {
      let d = current.find(x => x.id === r.directorate_id);
      if (!d) { d = { id: r.directorate_id, directorate_name: r.directorate_name, divisions: [] }; current.push(d); }
      if (r.division_name !== null) d.divisions.push(r.division_name);
    });
    const plan = planDirectory(current, seed.initialDirectorates);
    if (plan) {
      await run('DELETE FROM dbo.px_divisions; DELETE FROM dbo.px_directorates;', {}, tx);
      for (const d of plan.directorates) await insertDirectorate(tx, d);
      counts.directorates_removed = plan.removed;
      counts.divisions_moved = plan.moved;
    }

    // Columns holding (directorate, division): renamed per distinct exact pair.
    const renamePairs = async (table, dirCol, divCol, where) => {
      const pairs = await run(`SELECT ${dirCol} ${BIN} AS dir, ${divCol ? `${divCol} ${BIN}` : 'NULL'} AS div, COUNT(*) AS n
                               FROM dbo.${table} WHERE ${dirCol} IS NOT NULL ${where ? `AND ${where}` : ''}
                               GROUP BY ${dirCol} ${BIN}${divCol ? `, ${divCol} ${BIN}` : ''}`, {}, tx);
      let changed = 0;
      for (const p of pairs) {
        const to = renamedDirectorate(p.dir, p.div);
        if (!to) continue;
        await run(`UPDATE dbo.${table} SET ${dirCol} = @to WHERE ${dirCol} ${BIN} = @dir
                   ${divCol ? (p.div === null ? `AND ${divCol} IS NULL` : `AND ${divCol} ${BIN} = @div`) : ''} ${where ? `AND ${where}` : ''}`,
          { to, dir: p.dir, div: p.div }, tx);
        changed += p.n;
      }
      return changed;
    };
    // Only EMPLOYEE rows: campus / candidate rows keep a university / applied position in org_unit_1.
    counts.survey_responses = await renamePairs('px_survey_uploaded_responses', 'org_unit_1', 'org_unit_2', "respondent_type = 'EMPLOYEE'");
    counts.attendances = await renamePairs('px_attendances', 'directorate', 'division');
    counts.users = await renamePairs('px_users', 'directorate', 'division');          // legacy v2.26.0 columns
    counts.operational_records = await renamePairs('px_recruitment_sla_by_unit', 'unit', null);

    // Login scopes: rewritten per user whose scope list changes.
    const scopeRows = await run('SELECT user_id, directorate, division FROM dbo.px_user_scopes ORDER BY scope_id', {}, tx);
    const byUser = new Map();
    scopeRows.forEach(r => {
      if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
      byUser.get(r.user_id).push({ directorate: r.directorate, divisions: r.division === null ? null : [r.division] });
    });
    for (const [user_id, list] of byUser) {
      const next = migrateScopes(list);
      if (!next) continue;
      await writeUserScopes(tx, user_id, next);
      counts.user_scopes += list.length;
    }

    // Settings whose value lists directorates (event_manager_directorates).
    for (const k of DIRECTORATE_SETTING_KEYS) {
      const rows = await run('SELECT setting_value FROM dbo.px_app_settings WHERE setting_key = @k', { k }, tx);
      if (!rows.length) continue;
      const next = migrateDirectorateOptions(parseJson(rows[0].setting_value, null));
      if (!next) continue;
      await run('UPDATE dbo.px_app_settings SET setting_value = @v, updated_at = SYSUTCDATETIME() WHERE setting_key = @k', { k, v: T.max(JSON.stringify(next)) }, tx);
      counts.app_settings++;
    }
  });
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total) console.log(`[sqlStorage] Directorate master migrated to the 12 real directorates: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(', ')}.`);
  return counts;
}

// ------------------------------------------------------------------ app settings (px_app_settings)
// Inserts any default setting that is not in the table yet (never overwrites an admin's value).
async function seedAppSettings(tx) {
  for (const [key, def] of Object.entries(seed.initialAppSettings || {})) {
    await run(`IF NOT EXISTS (SELECT 1 FROM dbo.px_app_settings WHERE setting_key = @key)
                 INSERT INTO dbo.px_app_settings (setting_key, setting_value, description) VALUES (@key, @value, @description)`,
      { key, value: T.max(JSON.stringify(def.value)), description: def.description || '' }, tx);
  }
}

// v2.30.0: the default option labels became English. Replaces a label ONLY when it is still exactly the old
// Indonesian default (seed.LEGACY_OPTION_LABELS), so an admin's own edit is never overwritten; values never change.
async function topUpOptionLabels() {
  for (const key of Object.keys(seed.LEGACY_OPTION_LABELS || {})) {
    const rows = await run('SELECT setting_value FROM dbo.px_app_settings WHERE setting_key = @key', { key });
    if (!rows.length) continue;
    const next = seed.upgradeLegacyOptionLabels(key, parseJson(rows[0].setting_value, null));
    if (!next) continue;
    await run('UPDATE dbo.px_app_settings SET setting_value = @value, updated_at = SYSUTCDATETIME() WHERE setting_key = @key',
      { key, value: T.max(JSON.stringify(next)) });
    console.log(`[sqlStorage] Setting '${key}': Indonesian default option labels replaced with the English ones.`);
  }
}

// ------------------------------------------------------------------ upload reminder log (px_reminder_log)
const rowToReminderLog = r => ({
  log_id: r.log_id,
  metric_id: r.metric_id,
  expected_period: r.expected_period,
  sent_on: r.sent_on,
  attempted_at: iso(r.attempted_at),
  status: r.status,
  pic_email: r.pic_email,
  error_message: r.error_message
});
const REMINDER_LOG_SELECT = `SELECT log_id, metric_id, expected_period, CONVERT(char(10), sent_on, 23) AS sent_on, attempted_at,
                              status, pic_email, error_message FROM dbo.px_reminder_log`;

// ------------------------------------------------------------------ e-mail sender settings (px_email_settings)
const rowToEmailSettings = r => ({
  enabled: !!r.enabled,
  provider: r.provider,
  smtp_host: r.smtp_host,
  smtp_port: r.smtp_port,
  smtp_secure: !!r.smtp_secure,
  smtp_user: r.smtp_user,
  smtp_password_enc: r.smtp_password_enc,
  from_name: r.from_name,
  from_email: r.from_email,
  updated_at: iso(r.updated_at)
});

async function upsertEmailSettings(tx, s) {
  await run(`MERGE dbo.px_email_settings AS t USING (SELECT 1 AS setting_id) AS src ON t.setting_id = src.setting_id
             WHEN MATCHED THEN UPDATE SET enabled = @enabled, provider = @provider, smtp_host = @smtp_host, smtp_port = @smtp_port,
               smtp_secure = @smtp_secure, smtp_user = @smtp_user, smtp_password_enc = @smtp_password_enc, from_name = @from_name,
               from_email = @from_email, updated_at = SYSUTCDATETIME()
             WHEN NOT MATCHED THEN INSERT (setting_id, enabled, provider, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_password_enc, from_name, from_email)
               VALUES (1, @enabled, @provider, @smtp_host, @smtp_port, @smtp_secure, @smtp_user, @smtp_password_enc, @from_name, @from_email);`, {
    enabled: !!s.enabled, provider: s.provider || 'GMAIL', smtp_host: s.smtp_host || '', smtp_port: parseInt(s.smtp_port || 465, 10),
    smtp_secure: s.smtp_secure !== false, smtp_user: s.smtp_user || '', smtp_password_enc: T.max(s.smtp_password_enc || ''),
    from_name: s.from_name || '', from_email: s.from_email || ''
  }, tx);
}

// Creates the single settings row (defaults, no account) when it does not exist yet.
async function seedEmailSettings(tx) {
  const rows = await run('SELECT COUNT(*) AS c FROM dbo.px_email_settings', {}, tx);
  if (rows[0].c === 0) await upsertEmailSettings(tx, seed.initialEmailSettings);
}

// ------------------------------------------------------------------ parameter writers
// Shared by importStore() and resetParametersToDefault().
async function insertJourney(tx, j) {
  await run(`INSERT INTO dbo.px_journeys (journey_id, journey_code, journey_name, tagline, color, icon, display_order)
             VALUES (@journey_id, @journey_code, @journey_name, @tagline, @color, @icon, @display_order)`, {
    journey_id: j.journey_id, journey_code: j.journey_code, journey_name: j.journey_name,
    tagline: j.tagline || '', color: j.color || '#ED1C24', icon: j.icon || 'Users',
    display_order: parseInt(j.display_order || 0, 10)
  }, tx);
}

async function insertCheckpoint(tx, c) {
  await run(`INSERT INTO dbo.px_checkpoints (checkpoint_id, journey_id, checkpoint_name, experience_owner)
             VALUES (@checkpoint_id, @journey_id, @checkpoint_name, @experience_owner)`, {
    checkpoint_id: c.checkpoint_id, journey_id: c.journey_id, checkpoint_name: c.checkpoint_name,
    experience_owner: c.experience_owner || 'People Experience Team'
  }, tx);
}

// Satuan yang disimpan untuk sebuah metrik: yang sudah diisi, kalau tidak nilai awal metrik seed
// (id sama), kalau tidak default per jenis skala. Dipakai saat import store.json lama (tanpa satuan).
function initialUnitFor(m) {
  if (typeof m.unit === 'string' && m.unit.trim()) return m.unit.trim().slice(0, 30);
  const seeded = seed.initialMetrics.find(sm => sm.metric_id === m.metric_id);
  return (seeded && seeded.unit) || defaultUnitForScale(m.scale_type);
}

function metricParams(m) {
  return {
    metric_id: m.metric_id,
    journey_id: m.journey_id,
    checkpoint_id: m.checkpoint_id,
    metric_name: m.metric_name,
    metric_type: m.metric_type,
    scale_type: m.scale_type,
    source_of_data: m.source_of_data || '',
    experience_owner: m.experience_owner || '',
    raw_value: Number.isFinite(parseFloat(m.raw_value)) ? parseFloat(m.raw_value) : 0,
    normalized_score: Number.isFinite(parseFloat(m.normalized_score)) ? parseFloat(m.normalized_score) : 0,
    weight: Number.isFinite(parseFloat(m.weight)) ? parseFloat(m.weight) : 1,
    is_indicative: !!m.is_indicative,
    is_employee_metric: m.is_employee_metric === undefined ? true : !!m.is_employee_metric,
    target_audience: m.target_audience || 'EMPLOYEE',
    underlying_questions: T.max(JSON.stringify(Array.isArray(m.underlying_questions) ? m.underlying_questions : [])),
    update_frequency: m.update_frequency || 'MONTHLY',
    requires_manual_upload: !!m.requires_manual_upload || m.survey_source === 'ESS',
    upload_deadline_day: parseInt(m.upload_deadline_day !== undefined ? m.upload_deadline_day : 25, 10),
    upload_deadline_month: parseInt(m.upload_deadline_month !== undefined ? m.upload_deadline_month : 11, 10),
    pic_name: m.pic_name || '',
    pic_email: m.pic_email || '',
    last_data_date: toSqlDate(m.last_data_date) ? T.date(toSqlDate(m.last_data_date)) : null,
    unit: initialUnitFor(m),
    survey_source: resolveSurveySource({ metricType: m.metric_type, current: m.survey_source, fallback: inferSurveySource(m) }),
    notes: m.notes === undefined || m.notes === null ? null : T.max(String(m.notes))
  };
}

const METRIC_COLUMNS = ['metric_id', 'journey_id', 'checkpoint_id', 'metric_name', 'metric_type', 'scale_type',
  'source_of_data', 'experience_owner', 'raw_value', 'normalized_score', 'weight', 'is_indicative',
  'is_employee_metric', 'target_audience', 'underlying_questions', 'update_frequency', 'requires_manual_upload',
  'upload_deadline_day', 'upload_deadline_month', 'pic_name', 'pic_email', 'last_data_date', 'notes', 'unit', 'survey_source'];

async function insertMetric(tx, m) {
  await run(`INSERT INTO dbo.px_metrics (${METRIC_COLUMNS.join(', ')})
             VALUES (${METRIC_COLUMNS.map(c => '@' + c).join(', ')})`, metricParams(m), tx);
}

async function updateMetricRow(tx, m) {
  const sets = METRIC_COLUMNS.filter(c => c !== 'metric_id').map(c => `${c} = @${c}`).join(', ');
  await run(`UPDATE dbo.px_metrics SET ${sets} WHERE metric_id = @metric_id`, metricParams(m), tx);
}

async function upsertTarget(tx, metric_id, target) {
  await run(`MERGE dbo.px_metric_targets AS t
             USING (SELECT @metric_id AS metric_id) AS s ON t.metric_id = s.metric_id
             WHEN MATCHED THEN UPDATE SET target_value = @target_value, target_display = @target_display, min_threshold = @min_threshold
             WHEN NOT MATCHED THEN INSERT (metric_id, target_value, target_display, min_threshold)
               VALUES (@metric_id, @target_value, @target_display, @min_threshold);`, {
    metric_id,
    target_value: parseFloat(target.target_value),
    target_display: target.target_display === undefined || target.target_display === null ? '' : String(target.target_display),
    min_threshold: parseFloat(target.min_threshold)
  }, tx);
}

async function insertDirectorate(tx, d) {
  const name = d.directorate_name || d.name;
  const rows = await run(`INSERT INTO dbo.px_directorates (directorate_name) OUTPUT INSERTED.directorate_id VALUES (@name)`, { name }, tx);
  const id = rows[0].directorate_id;
  const divisions = [...new Set(d.divisions || d.sub_directorates || [])];
  for (const division_name of divisions) {
    await run(`INSERT INTO dbo.px_divisions (directorate_id, division_name) VALUES (@id, @division_name)`, { id, division_name }, tx);
  }
}

async function clearParameters(tx) {
  await run(`DELETE FROM dbo.px_metric_targets;
             DELETE FROM dbo.px_survey_questions;
             DELETE FROM dbo.px_metrics;
             DELETE FROM dbo.px_checkpoints;
             DELETE FROM dbo.px_journeys;
             DELETE FROM dbo.px_divisions;
             DELETE FROM dbo.px_directorates;`, {}, tx);
}

async function insertDefaultParameters(tx) {
  for (const j of seed.initialJourneys) await insertJourney(tx, j);
  for (const c of seed.initialCheckpoints) await insertCheckpoint(tx, c);
  for (const m of seed.initialMetrics) {
    await insertMetric(tx, m);
    await upsertTarget(tx, m.metric_id, { target_value: m.target_value, target_display: m.target_display, min_threshold: m.min_threshold });
  }
  for (const d of seed.initialDirectorates) await insertDirectorate(tx, d);
  await seedSurveyQuestions(tx);
}

// ------------------------------------------------------------------ operational record tables
const OPERATIONAL_TABLES = [
  { table: 'px_recruitment_sla_by_unit', key: 'unit', cols: ['unit', 'target_headcount', 'fulfilled', 'sla_achievement', 'status'] },
  { table: 'px_approval_stage_compliance', key: 'stage', cols: ['stage', 'avg_sla_hours', 'sla_target_hours', 'compliance'] },
  { table: 'px_hiring_channel_mix', key: 'channel', cols: ['channel', 'hires_count', 'percentage', 'quality_score'] },
  { table: 'px_recognition_categories', key: 'category', cols: ['category', 'recipient_count', 'points_awarded', 'source'] },
  { table: 'px_attrition_by_tenure', key: 'tenure_bracket', cols: ['tenure_bracket', 'attrition_count', 'rate', 'benchmark'] }
];

// ------------------------------------------------------------------ whole-store import
// Loads a store.json-shaped object into the (empty) tables in ONE transaction. Used by
// migrate.js (current data) and by init() (fresh seed data for a brand-new database).
async function importStore(store, log = () => {}) {
  const counts = {};
  await inTransaction(async tx => {
    for (const j of store.journeys || []) await insertJourney(tx, j);
    counts.journeys = (store.journeys || []).length;
    for (const c of store.checkpoints || []) await insertCheckpoint(tx, c);
    counts.checkpoints = (store.checkpoints || []).length;

    const targets = store.metricTargets || {};
    for (const m of store.metrics || []) {
      await insertMetric(tx, m);
      const t = targets[m.metric_id] || { target_value: m.target_value, target_display: m.target_display, min_threshold: m.min_threshold };
      await upsertTarget(tx, m.metric_id, t);
    }
    counts.metrics = (store.metrics || []).length;

    for (const d of store.directorates || []) await insertDirectorate(tx, d);
    counts.directorates = (store.directorates || []).length;

    for (const a of store.actionLibrary || []) {
      await run(`INSERT INTO dbo.px_action_library (metric_id, checkpoint_id, gap_condition, recommended_action, suggested_initiatives)
                 VALUES (@metric_id, @checkpoint_id, @gap_condition, @recommended_action, @suggested_initiatives)`, {
        metric_id: a.metric_id, checkpoint_id: a.checkpoint_id === undefined ? null : a.checkpoint_id,
        gap_condition: a.gap_condition || '', recommended_action: T.max(a.recommended_action || ''),
        suggested_initiatives: T.max(a.suggested_initiatives || '')
      }, tx);
    }
    counts.action_library = (store.actionLibrary || []).length;

    for (let i = 0; i < (store.masterSurveyQuestions || []).length; i++) {
      await run(`INSERT INTO dbo.px_master_survey_questions (question_id, question_text, question_type, display_order, is_default, extra_json)
                 VALUES (@question_id, @question_text, @question_type, @display_order, @is_default, @extra_json)`,
        questionParams(store.masterSurveyQuestions[i], i), tx);
    }
    counts.master_questions = (store.masterSurveyQuestions || []).length;

    const eventIds = new Set();
    for (const e of store.events || []) {
      await run(`INSERT INTO dbo.px_events (event_id, event_name, program_category, event_date, event_type, location,
                   target_participants, pre_event_code, post_event_code, is_attendance_open, is_feedback_open, created_by)
                 VALUES (@event_id, @event_name, @program_category, @event_date, @event_type, @location,
                   @target_participants, @pre_event_code, @post_event_code, @is_attendance_open, @is_feedback_open, @created_by)`, {
        event_id: e.event_id, event_name: e.event_name, program_category: e.program_category || 'Perspektif',
        event_date: String(e.event_date || new Date().toISOString()), event_type: e.event_type || 'HYBRID',
        location: e.location || '', target_participants: parseInt(e.target_participants || 0, 10),
        pre_event_code: e.pre_event_code, post_event_code: e.post_event_code,
        is_attendance_open: e.is_attendance_open !== false, is_feedback_open: e.is_feedback_open !== false,
        created_by: e.created_by || 'HR PX Team'
      }, tx);
      eventIds.add(e.event_id);
    }
    counts.events = eventIds.size;

    let eq = 0;
    for (const [event_id, questions] of Object.entries(store.eventQuestions || {})) {
      if (!eventIds.has(event_id)) continue;
      for (let i = 0; i < questions.length; i++) {
        await run(`INSERT INTO dbo.px_event_questions (event_id, question_id, question_text, question_type, display_order, is_default, extra_json)
                   VALUES (@event_id, @question_id, @question_text, @question_type, @display_order, @is_default, @extra_json)`,
          { event_id, ...questionParams(questions[i], i) }, tx);
        eq++;
      }
    }
    counts.event_questions = eq;

    let att = 0;
    for (const a of store.attendances || []) {
      if (!eventIds.has(a.event_id)) { log(`  skipped attendance ${a.attendance_id}: unknown event ${a.event_id}`); continue; }
      // IDENTITY_INSERT is switched on/off inside the same batch (it can be scoped to one batch).
      await run(`SET IDENTITY_INSERT dbo.px_attendances ON;
                 INSERT INTO dbo.px_attendances (attendance_id, event_id, nip, employee_name, cimb_email, directorate, division, attendance_timestamp)
                 VALUES (@attendance_id, @event_id, @nip, @employee_name, @cimb_email, @directorate, @division, @ts);
                 SET IDENTITY_INSERT dbo.px_attendances OFF;`, {
        attendance_id: a.attendance_id, event_id: a.event_id, nip: String(a.nip), employee_name: a.employee_name,
        cimb_email: a.cimb_email, directorate: a.directorate || 'General', division: a.division || 'General',
        ts: toDateObj(a.attendance_timestamp)
      }, tx);
      att++;
    }
    counts.attendances = att;

    let fb = 0;
    for (const f of store.feedbackResponses || []) {
      if (!eventIds.has(f.event_id)) { log(`  skipped feedback ${f.response_id}: unknown event ${f.event_id}`); continue; }
      await run(`SET IDENTITY_INSERT dbo.px_feedback_responses ON;
                 INSERT INTO dbo.px_feedback_responses (response_id, event_id, nip, ratings_json, verbatim, submitted_at)
                 VALUES (@response_id, @event_id, @nip, @ratings_json, @verbatim, @ts);
                 SET IDENTITY_INSERT dbo.px_feedback_responses OFF;`, {
        response_id: f.response_id, event_id: f.event_id, nip: String(f.nip),
        ratings_json: T.max(JSON.stringify(f.ratings || {})), verbatim: T.max(f.verbatim || ''), ts: toDateObj(f.submitted_at)
      }, tx);
      fb++;
    }
    counts.feedback_responses = fb;

    let media = 0;
    for (const m of store.media || []) {
      if (!eventIds.has(m.event_id)) { log(`  skipped media ${m.media_id}: unknown event ${m.event_id}`); continue; }
      await run(`INSERT INTO dbo.px_media (media_id, event_id, file_name, file_path, file_type, caption, ai_generated_description,
                   highlight_order, created_at, transcript_status, transcript_error, transcript, transcript_segments,
                   transcript_language, duration_seconds, summary, summary_points, summary_status, summary_source, summary_model,
                   summary_language, summary_generated_at, summary_error)
                 VALUES (@media_id, @event_id, @file_name, @file_path, @file_type, @caption, @ai, @highlight_order, @created_at,
                   @transcript_status, @transcript_error, @transcript, @transcript_segments, @transcript_language, @duration_seconds,
                   @summary, @summary_points, @summary_status, @summary_source, @summary_model, @summary_language, @summary_generated_at, @summary_error)`, {
        summary: m.summary === undefined || m.summary === null ? null : T.max(m.summary),
        summary_points: m.summary_points === undefined ? null : T.max(JSON.stringify(m.summary_points)),
        summary_status: m.summary_status || null, summary_source: m.summary_source || null, summary_model: m.summary_model || null,
        summary_language: m.summary_language || null, summary_generated_at: m.summary_generated_at ? toDateObj(m.summary_generated_at) : null,
        summary_error: m.summary_error ? String(m.summary_error).slice(0, 500) : null,
        media_id: m.media_id, event_id: m.event_id, file_name: m.file_name, file_path: m.file_path,
        file_type: m.file_type || 'IMAGE', caption: T.max(m.caption || ''), ai: T.max(m.ai_generated_description || ''),
        highlight_order: parseInt(m.highlight_order || 1, 10), created_at: toDateObj(m.created_at),
        transcript_status: m.transcript_status === undefined ? null : m.transcript_status,
        transcript_error: m.transcript_error === undefined ? null : T.max(m.transcript_error),
        transcript: m.transcript === undefined ? null : T.max(m.transcript),
        transcript_segments: m.transcript_segments === undefined ? null : T.max(JSON.stringify(m.transcript_segments)),
        transcript_language: m.transcript_language === undefined ? null : m.transcript_language,
        duration_seconds: m.duration_seconds === undefined ? null : m.duration_seconds
      }, tx);
      media++;
    }
    counts.media = media;

    // surveyUploads is newest-first in the JSON store; insert oldest-first so upload_seq grows with time.
    const uploads = [...(store.surveyUploads || [])].reverse();
    for (const u of uploads) {
      await run(`INSERT INTO dbo.px_survey_uploads (upload_id, metric_id, file_name, total_rows, valid_rows, invalid_rows, calculated_avg_score, uploaded_by, uploaded_at)
                 VALUES (@upload_id, @metric_id, @file_name, @total_rows, @valid_rows, @invalid_rows, @avg, @uploaded_by, @uploaded_at)`, {
        upload_id: u.upload_id, metric_id: Number.isInteger(u.metric_id) ? u.metric_id : null, file_name: u.file_name || '',
        total_rows: u.total_rows || 0, valid_rows: u.valid_rows || 0, invalid_rows: u.invalid_rows || 0,
        avg: u.calculated_avg_score === undefined ? null : u.calculated_avg_score,
        uploaded_by: u.uploaded_by || 'HR Admin', uploaded_at: toDateObj(u.uploaded_at)
      }, tx);
    }
    counts.survey_uploads = uploads.length;

    // One bulk insert in the original row order (each row keeps its own upload_id), so
    // response_id order == the JSON array order and "latest response" semantics are unchanged.
    const responseRows = (store.surveyUploadedResponses || []).map(normalizeResponse);
    await bulkInsertResponses(tx, null, responseRows);
    counts.survey_responses = responseRows.length;

    // ESS result summaries (v2.32.0)
    for (const r of store.essResults || []) await insertEssResult(tx, r.upload_id, r);
    counts.ess_results = (store.essResults || []).length;
    // a store.json from before v2.32.0 still holds per-respondent ESS rows: same one-time cleanup as the upgrade boot
    if (!Array.isArray(store.essResults)) {
      const cleaned = await cleanupEssRespondentRows(tx);
      counts.survey_responses -= cleaned.responses;
      counts.survey_uploads -= cleaned.uploads;
      log(`  ESS now uses uploaded summaries: ${cleaned.responses} per-respondent ESS rows and ${cleaned.uploads} empty upload batches were not kept.`);
    }

    // Admin-customised sets from the JSON store are kept as customised; every other SURVEY metric
    // gets the default set (seedSurveyQuestions).
    for (const [metric_id, questions] of Object.entries(store.customSurveyQuestions || {})) {
      if (Array.isArray(questions) && questions.length) await replaceSurveyQuestions(tx, parseInt(metric_id, 10), questions, true);
    }
    counts.custom_survey_questions = Object.keys(store.customSurveyQuestions || {}).length;
    for (const l of store.reminderLog || []) {
      await run(`INSERT INTO dbo.px_reminder_log (metric_id, expected_period, sent_on, attempted_at, status, pic_email, error_message)
                 VALUES (@metric_id, @period, @sent_on, @at, @status, @pic_email, @error)`, {
        metric_id: l.metric_id, period: l.expected_period, sent_on: T.date(l.sent_on), at: toDateObj(l.attempted_at),
        status: l.status, pic_email: l.pic_email || '', error: l.error_message || null
      }, tx);
    }
    for (const [key, def] of Object.entries(store.appSettings || {})) {
      await run('INSERT INTO dbo.px_app_settings (setting_key, setting_value, description) VALUES (@key, @value, @description)',
        { key, value: T.max(JSON.stringify(def.value)), description: def.description || '' }, tx);
    }
    await seedAppSettings(tx);
    if (store.emailSettings) await upsertEmailSettings(tx, store.emailSettings);
    await seedEmailSettings(tx);
    await seedSurveyQuestions(tx);
    counts.survey_questions = (await run('SELECT COUNT(*) AS c FROM dbo.px_survey_questions', {}, tx))[0].c;

    for (const metric_id of store.acknowledgedAlerts || []) {
      await run(`INSERT INTO dbo.px_acknowledged_alerts (metric_id) VALUES (@metric_id)`, { metric_id: parseInt(metric_id, 10) }, tx);
    }
    counts.acknowledged_alerts = (store.acknowledgedAlerts || []).length;

    let ops = 0;
    for (const [metric_id, records] of Object.entries(store.operationalRecords || {})) {
      for (const rec of records || []) {
        const def = OPERATIONAL_TABLES.find(d => rec[d.key] !== undefined);
        if (!def) { log(`  skipped operational record for metric ${metric_id}: unrecognised shape`); continue; }
        const params = { metric_id: parseInt(metric_id, 10) };
        def.cols.forEach(c => { params[c] = rec[c]; });
        await run(`INSERT INTO dbo.${def.table} (metric_id, ${def.cols.join(', ')}) VALUES (@metric_id, ${def.cols.map(c => '@' + c).join(', ')})`, params, tx);
        ops++;
      }
    }
    counts.operational_records = ops;
  });
  return counts;
}

// ------------------------------------------------------------------ schema + seeding
async function applySchema() {
  const text = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const batches = text.split(/^\s*GO\s*$/gim).map(b => b.trim()).filter(Boolean);
  const pool = await getPool();
  for (const batch of batches) await pool.request().batch(batch);
}

// A brand-new database gets the standard seed/demo dataset (same as a first-ever JSON boot).
async function seedIfEmpty() {
  const rows = await run('SELECT (SELECT COUNT(*) FROM dbo.px_journeys) AS j, (SELECT COUNT(*) FROM dbo.px_metrics) AS m');
  if (rows[0].j === 0 && rows[0].m === 0) {
    console.log('[sqlStorage] Empty database - loading the standard seed data ...');
    const counts = await importStore(buildInitialStore());
    console.log('[sqlStorage] Seeded:', JSON.stringify(counts));
  }
}

// The demo dataset is generated up to the current calendar month. As months pass, add the
// newly generated seed rows (never touching real/uploaded responses) - same rule as the JSON store.
async function topUpSeedResponses() {
  const seedRows = seed.initialSurveyUploadedResponses || [];
  if (!seedRows.length) return;
  const existing = await run(`SELECT metric_id, CONVERT(char(10), survey_date, 23) AS d, respondent_id
                              FROM dbo.px_survey_uploaded_responses WHERE upload_id = @u`, { u: 'seed-batch-2026' });
  const have = new Set(existing.map(r => `${r.metric_id}|${r.d}|${r.respondent_id}`));
  const missing = seedRows.map(normalizeResponse).filter(n => !have.has(`${n.metric_id}|${n.survey_date}|${n.respondent_id}`));
  if (!missing.length) return;
  await inTransaction(async tx => {
    await run(`IF NOT EXISTS (SELECT 1 FROM dbo.px_survey_uploads WHERE upload_id = @u)
                 INSERT INTO dbo.px_survey_uploads (upload_id, metric_id, file_name, total_rows, valid_rows, invalid_rows, calculated_avg_score, uploaded_by)
                 VALUES (@u, NULL, N'Master_Survey_Baseline_Q1_2026.csv', @n, @n, 0, 4.5, N'System Scheduler (Air-Gapped)')`,
      { u: 'seed-batch-2026', n: seedRows.length }, tx);
    await bulkInsertResponses(tx, 'seed-batch-2026', missing);
  });
  console.log(`[sqlStorage] Added ${missing.length} newly generated seed survey responses.`);
}

// ------------------------------------------------------------------ ESS result summaries (px_ess_results, v2.32.0)
const rowToEssResult = r => ({
  ess_result_id: r.ess_result_id,
  upload_id: r.upload_id,
  metric_id: r.metric_id,
  survey_year: r.survey_year,
  survey_month: r.survey_month,
  org_level: r.org_level,
  directorate: r.directorate,
  participation: r.participation,
  index_score: Number(r.index_score),
  questions: parseJson(r.questions_json, []),
  created_at: iso(r.created_at)
});

async function insertEssResult(tx, uploadId, r) {
  await run(`INSERT INTO dbo.px_ess_results (upload_id, metric_id, survey_year, survey_month, org_level, directorate, participation, index_score, questions_json${r.created_at ? ', created_at' : ''})
             VALUES (@upload_id, @metric_id, @y, @m, @lvl, @dir, @part, @idx, @q${r.created_at ? ', @created_at' : ''})`, {
    upload_id: uploadId, metric_id: parseInt(r.metric_id, 10), y: parseInt(r.survey_year, 10), m: parseInt(r.survey_month, 10),
    lvl: r.org_level, dir: r.org_level === 'BANKWIDE' ? null : r.directorate, part: parseInt(r.participation, 10) || 0,
    idx: Number(r.index_score), q: T.max(JSON.stringify(r.questions || [])), ...(r.created_at ? { created_at: toDateObj(r.created_at) } : {})
  }, tx);
}

async function essMetricIds(tx) {
  return (await run('SELECT metric_id, metric_type, survey_source, source_of_data FROM dbo.px_metrics', {}, tx))
    .filter(m => m.metric_type === 'SURVEY' && isEssMetric(m)).map(m => m.metric_id);
}

// One-time upgrade step (the boot that creates px_ess_results): ESS metrics no longer have per-respondent rows, so
// the old ones (seed + old CSV test uploads) are deleted, together with the upload batches that are empty afterwards.
// SYSTEM survey data is never touched. Returns the counts (logged).
async function cleanupEssRespondentRows(outerTx) {
  const work = async tx => {
    const ids = (await essMetricIds(tx)).map(id => parseInt(id, 10)).filter(Number.isInteger);
    if (!ids.length) return { responses: 0, uploads: 0 };
    const rows = await run(`SELECT DISTINCT upload_id INTO #ess_up FROM dbo.px_survey_uploaded_responses WHERE metric_id IN (${ids.join(', ')});
      DELETE FROM dbo.px_survey_uploaded_responses WHERE metric_id IN (${ids.join(', ')});
      DECLARE @r INT = @@ROWCOUNT;
      DELETE u FROM dbo.px_survey_uploads u WHERE u.upload_id IN (SELECT upload_id FROM #ess_up)
        AND NOT EXISTS (SELECT 1 FROM dbo.px_survey_uploaded_responses x WHERE x.upload_id = u.upload_id);
      DECLARE @u INT = @@ROWCOUNT;
      DROP TABLE #ess_up;
      SELECT @r AS responses, @u AS uploads;`, {}, tx);
    return rows[0] || { responses: 0, uploads: 0 };
  };
  return outerTx ? work(outerTx) : inTransaction(work);
}

// Demo ESS summaries (seed), per (metric, period) (v2.37.0): a seed period is only added when that ESS metric has no
// result for that period yet, so an upload of the same period is never overwritten. Returns the seed upload ids added.
async function topUpEssSeed() {
  const seedRows = seed.initialEssResults || [];
  if (!seedRows.length) return [];
  const ess = new Set(await essMetricIds());
  const periodKey = r => `${r.metric_id}|${parseInt(r.survey_year, 10)}-${parseInt(r.survey_month, 10)}`;
  const have = new Set((await run('SELECT DISTINCT metric_id, survey_year, survey_month FROM dbo.px_ess_results')).map(periodKey));
  const todo = [...new Set(seedRows.filter(r => ess.has(r.metric_id) && !have.has(periodKey(r))).map(r => r.upload_id))];
  if (!todo.length) return [];
  await inTransaction(async tx => {
    for (const uploadId of todo) {
      const up = (seed.initialEssUploads || []).find(u => u.upload_id === uploadId);
      if (up) {
        await run(`IF NOT EXISTS (SELECT 1 FROM dbo.px_survey_uploads WHERE upload_id = @upload_id)
                     INSERT INTO dbo.px_survey_uploads (upload_id, metric_id, file_name, total_rows, valid_rows, invalid_rows, calculated_avg_score, uploaded_by, uploaded_at)
                     VALUES (@upload_id, @metric_id, @file_name, @total_rows, @valid_rows, @invalid_rows, @avg, @uploaded_by, @uploaded_at)`, {
          upload_id: up.upload_id, metric_id: up.metric_id, file_name: up.file_name, total_rows: up.total_rows, valid_rows: up.valid_rows,
          invalid_rows: up.invalid_rows, avg: up.calculated_avg_score, uploaded_by: up.uploaded_by, uploaded_at: toDateObj(up.uploaded_at)
        }, tx);
      }
      for (const r of seedRows.filter(x => x.upload_id === uploadId)) await insertEssResult(tx, r.upload_id, r);
    }
  });
  return todo;
}

// ------------------------------------------------------------------ response filter -> SQL
function nextMonthStart(year, monthNum) {
  return monthNum === 12 ? `${year + 1}-01-01` : `${year}-${String(monthNum + 1).padStart(2, '0')}-01`;
}

function buildResponseFilter(filterOptions, params) {
  const parsed = parseFilterOptions(filterOptions);
  if (!parsed) return [];
  const { mode, year, month, directorate, subDirectorate, endMonth, scopes } = parsed;
  const where = [];

  if (mode === 'MTD') {
    const y = parseInt(year, 10);
    const m = parseInt(month, 10);
    if (!/^\d{4}$/.test(year) || !(m >= 1 && m <= 12)) where.push('1 = 0'); // matches nothing, like the JSON prefix test
    else {
      params.f_start = T.date(`${y}-${String(m).padStart(2, '0')}-01`);
      params.f_end = T.date(nextMonthStart(y, m));
      where.push('survey_date >= @f_start AND survey_date < @f_end');
    }
  } else if (mode === 'YTD' && year) {
    if (!/^\d{4}$/.test(year)) where.push('1 = 0');
    else {
      const y = parseInt(year, 10);
      params.f_start = T.date(`${y}-01-01`);
      // endMonth is always set for a valid year (parseFilterOptions caps it by the clock); 0 = a future year
      const em = endMonth ? parseInt(endMonth, 10) : 12;
      if (!(em >= 1 && em <= 12)) where.push('1 = 0');
      else {
        params.f_end = T.date(nextMonthStart(y, em));
        where.push('survey_date >= @f_start AND survey_date < @f_end');
      }
    }
  }
  if (directorate && directorate !== 'ALL') { params.f_dir = directorate; where.push('org_unit_1 = @f_dir'); }
  if (subDirectorate && subDirectorate !== 'ALL') { params.f_sub = subDirectorate; where.push('org_unit_2 = @f_sub'); }
  if (scopes) {
    // Union scope: (dir1 AND division IN (...)) OR (dir2) OR ...; an empty list matches nothing.
    const parts = scopes.map((s, i) => {
      params[`f_sd${i}`] = s.directorate;
      if (s.divisions === null) return `org_unit_1 = @f_sd${i}`;
      const names = s.divisions.map((d, j) => { params[`f_sv${i}_${j}`] = d; return `@f_sv${i}_${j}`; });
      return `(org_unit_1 = @f_sd${i} AND org_unit_2 IN (${names.join(', ')}))`;
    });
    where.push(parts.length ? `(${parts.join(' OR ')})` : '1 = 0');
  }
  return where;
}

async function selectResponses(extraWhere, params, filterOptions) {
  const where = [...extraWhere, ...buildResponseFilter(filterOptions, params)];
  const rows = await run(`${RESPONSE_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY response_id`, params);
  return rows.map(rowToResponse);
}

// ------------------------------------------------------------------ the storage API
const storage = {
  // ---- lifecycle / health
  async init() {
    await getPool();
    // v2.32.0: the boot that creates px_ess_results is the upgrade boot (one-time ESS per-respondent cleanup below)
    const essUpgrade = !(await run("SELECT OBJECT_ID(N'dbo.px_ess_results', N'U') AS id"))[0].id;
    await applySchema();
    await seedIfEmpty();
    await migrateDirectorates();     // v2.31.0: old demo directorate names -> the 12 real ones (before any top-up)
    await inTransaction(async tx => { await seedSurveyQuestions(tx); await seedAppSettings(tx); await seedEmailSettings(tx); });
    await topUpOptionLabels();
    await topUpDirectory();
    await topUpMetricUnits();
    await topUpSurveySource();
    await enforceEssManualUpload();
    if (essUpgrade) {
      const cleaned = await cleanupEssRespondentRows();
      console.log(`[sqlStorage] ESS now uses uploaded summaries: deleted ${cleaned.responses} per-respondent ESS rows and ${cleaned.uploads} upload batches left empty.`);
    }
    await migrateLegacyUserScopes();
    // Demo survey responses for newly elapsed months. Set SEED_DEMO_DATA=false on a real
    // production database so no synthetic responses are ever generated.
    if (String(process.env.SEED_DEMO_DATA || 'true').toLowerCase() !== 'false') {
      await topUpSeedResponses();
      const seededEss = await topUpEssSeed();
      if (seededEss.length) console.log(`[sqlStorage] Seeded demo ESS summaries: ${seededEss.join(', ')}.`);
    }
    const info = await this.health();
    console.log(`[sqlStorage] Connected to ${info.server} / ${info.database} (${info.edition})`);
  },
  async health() {
    const rows = await run(`SELECT @@SERVERNAME AS server, DB_NAME() AS db,
                                   CONVERT(nvarchar(200), SERVERPROPERTY('Edition')) AS edition,
                                   CONVERT(nvarchar(50), SERVERPROPERTY('ProductVersion')) AS version,
                                   (SELECT COUNT(*) FROM dbo.px_metrics) AS metrics,
                                   (SELECT COUNT(*) FROM dbo.px_survey_uploaded_responses) AS responses,
                                   (SELECT COUNT(*) FROM dbo.px_events) AS events,
                                   (SELECT COUNT(*) FROM dbo.px_media) AS media`);
    const r = rows[0];
    return {
      connected: true, server: r.server, database: r.db, edition: r.edition, version: r.version,
      tables: { metrics: r.metrics, survey_responses: r.responses, events: r.events, media: r.media }
    };
  },
  async close() {
    if (poolPromise) { const pool = await poolPromise; poolPromise = null; await pool.close(); }
  },
  importStore,
  applySchema,
  migrateDirectorates,
  seedSurveyQuestions: () => inTransaction(tx => seedSurveyQuestions(tx)),
  // Drops every px_* table (children first). Used only by migrate.js --reset.
  async dropAllTables() {
    const tables = ['px_recruitment_sla_by_unit', 'px_approval_stage_compliance', 'px_hiring_channel_mix',
      'px_recognition_categories', 'px_attrition_by_tenure', 'px_acknowledged_alerts', 'px_ess_results', 'px_survey_uploaded_responses',
      'px_survey_uploads', 'px_media', 'px_feedback_responses', 'px_attendances', 'px_event_questions', 'px_events',
      'px_reminder_log', 'px_email_settings', 'px_app_settings', 'px_survey_questions', 'px_custom_survey_questions', 'px_master_survey_questions', 'px_divisions', 'px_directorates', 'px_action_library',
      'px_metric_targets', 'px_metrics', 'px_checkpoints', 'px_journeys'];
    for (const t of tables) await run(`IF OBJECT_ID(N'dbo.${t}', N'U') IS NOT NULL DROP TABLE dbo.${t}`);
  },

  // ---- survey upload reminders
  // Is there ANY survey response for this metric dated in [startDate, endDate)? (YYYY-MM-DD strings)
  async hasSurveyDataInPeriod(metric_id, startDate, endDate) {
    const rows = await run(`SELECT TOP 1 1 AS x FROM dbo.px_survey_uploaded_responses
                            WHERE metric_id = @metric_id AND survey_date >= @start AND survey_date < @end
                            UNION ALL
                            SELECT TOP 1 1 FROM dbo.px_ess_results   -- an ESS summary (v2.32.0) is dated on the 1st of its month
                            WHERE metric_id = @metric_id AND DATEFROMPARTS(survey_year, survey_month, 1) >= @start
                              AND DATEFROMPARTS(survey_year, survey_month, 1) < @end`,
      { metric_id: parseInt(metric_id, 10), start: T.date(startDate), end: T.date(endDate) });
    return rows.length > 0;
  },
  async getReminderLog(limit = 50) {
    const rows = await run(`${REMINDER_LOG_SELECT.replace('SELECT', 'SELECT TOP (@limit)')} ORDER BY log_id DESC`, { limit: parseInt(limit, 10) });
    return rows.map(rowToReminderLog);
  },
  async getReminderLogFor(metric_id, expected_period) {
    const rows = await run(`${REMINDER_LOG_SELECT} WHERE metric_id = @metric_id AND expected_period = @period ORDER BY log_id`,
      { metric_id: parseInt(metric_id, 10), period: String(expected_period) });
    return rows.map(rowToReminderLog);
  },
  async addReminderLog(entry) {
    const rows = await run(`INSERT INTO dbo.px_reminder_log (metric_id, expected_period, sent_on, status, pic_email, error_message)
                            OUTPUT INSERTED.log_id VALUES (@metric_id, @period, @sent_on, @status, @pic_email, @error)`, {
      metric_id: parseInt(entry.metric_id, 10), period: String(entry.expected_period), sent_on: T.date(entry.sent_on),
      status: entry.status, pic_email: entry.pic_email || '', error: entry.error_message ? String(entry.error_message).slice(0, 500) : null
    });
    return { log_id: rows[0].log_id, ...entry };
  },

  // ---- reminder e-mail sender settings
  async getEmailSettings() {
    const rows = await run('SELECT * FROM dbo.px_email_settings WHERE setting_id = 1');
    return rows[0] ? rowToEmailSettings(rows[0]) : { ...seed.initialEmailSettings };
  },
  async saveEmailSettings(settings) {
    await inTransaction(tx => upsertEmailSettings(tx, settings));
    return this.getEmailSettings();
  },

  // ---- app settings
  async getSettings() {
    const out = {};
    (await run('SELECT setting_key, setting_value FROM dbo.px_app_settings ORDER BY setting_key')).forEach(r => { out[r.setting_key] = parseJson(r.setting_value, null); });
    return out;
  },
  async setSetting(key, value) {
    const rows = await run(`UPDATE dbo.px_app_settings SET setting_value = @value, updated_at = SYSUTCDATETIME()
                            OUTPUT INSERTED.setting_key WHERE setting_key = @key`, { key: String(key), value: T.max(JSON.stringify(value)) });
    if (!rows.length) throw new Error(`Setting "${key}" not found.`);
    return value;
  },

  // ---- login accounts, sessions, audit trail (px_users / px_sessions / px_audit_log)
  migrateLegacyUserScopes,
  topUpSurveySource,      // exposed for the regression suite (boot top-up of px_metrics.survey_source)
  enforceEssManualUpload, // idem (ESS => requires_manual_upload)
  async countUsers() {
    return (await run('SELECT COUNT(*) AS c FROM dbo.px_users'))[0].c;
  },
  async listUsers() {
    return withScopes((await run('SELECT * FROM dbo.px_users ORDER BY user_id')).map(rowToUser));
  },
  async getUserById(user_id) {
    const rows = await run('SELECT * FROM dbo.px_users WHERE user_id = @id', { id: parseInt(user_id, 10) });
    return rows[0] ? (await withScopes([rowToUser(rows[0])]))[0] : null;
  },
  async getUserByUsername(username) {
    const rows = await run('SELECT * FROM dbo.px_users WHERE username = @username', { username: String(username) });
    return rows[0] ? (await withScopes([rowToUser(rows[0])]))[0] : null;
  },
  async createUser(u) {
    try {
      return await inTransaction(async tx => {
        const rows = await run(`INSERT INTO dbo.px_users (username, full_name, email, password_hash, role, is_active, must_change_password)
                                OUTPUT INSERTED.* VALUES (@username, @full_name, @email, @password_hash, @role, @is_active, @mcp)`, {
          username: u.username, full_name: u.full_name, email: u.email || '', password_hash: u.password_hash, role: u.role,
          is_active: u.is_active === undefined ? true : !!u.is_active, mcp: u.must_change_password === undefined ? true : !!u.must_change_password
        }, tx);
        await writeUserScopes(tx, rows[0].user_id, u.scopes);
        return (await withScopes([rowToUser(rows[0])], tx))[0];
      });
    } catch (err) {
      if (isUniqueViolation(err)) { const e = new Error(`Username "${u.username}" is already taken.`); e.code = 'DUPLICATE_USER'; throw e; }
      throw err;
    }
  },
  async updateUser(user_id, patch) {
    const cols = { full_name: 'full_name', email: 'email', password_hash: 'password_hash', role: 'role',
      is_active: 'is_active', must_change_password: 'must_change_password', failed_attempts: 'failed_attempts', locked_until: 'locked_until', last_login_at: 'last_login_at' };
    const sets = [];
    const params = { id: parseInt(user_id, 10) };
    for (const [field, col] of Object.entries(cols)) {
      if (patch[field] === undefined) continue;
      sets.push(`${col} = @${field}`);
      const v = patch[field];
      params[field] = (field === 'locked_until' || field === 'last_login_at') ? (v ? new Date(v) : null) : v;
    }
    // patch.scopes replaces the whole scope list (together with any other field, in one transaction)
    if (patch.scopes === undefined) {
      if (!sets.length) return this.getUserById(user_id);
      const rows = await run(`UPDATE dbo.px_users SET ${sets.join(', ')} OUTPUT INSERTED.* WHERE user_id = @id`, params);
      return rows[0] ? (await withScopes([rowToUser(rows[0])]))[0] : null;
    }
    return inTransaction(async tx => {
      const rows = sets.length
        ? await run(`UPDATE dbo.px_users SET ${sets.join(', ')} OUTPUT INSERTED.* WHERE user_id = @id`, params, tx)
        : await run('SELECT * FROM dbo.px_users WHERE user_id = @id', { id: params.id }, tx);
      if (!rows[0]) return null;
      await writeUserScopes(tx, params.id, patch.scopes);
      return (await withScopes([rowToUser(rows[0])], tx))[0];
    });
  },
  async deleteUser(user_id) {
    const id = parseInt(user_id, 10);
    const before = await this.getUserById(id);
    const rows = await run('DELETE FROM dbo.px_users OUTPUT DELETED.* WHERE user_id = @id', { id });
    return rows[0] ? { ...rowToUser(rows[0]), scopes: before ? before.scopes : [] } : null;
  },
  async createSession({ token_hash, user_id, expires_at }) {
    await run('INSERT INTO dbo.px_sessions (token_hash, user_id, expires_at) VALUES (@token_hash, @user_id, @expires_at)',
      { token_hash, user_id: parseInt(user_id, 10), expires_at: new Date(expires_at) });
  },
  async getSession(token_hash) {
    const rows = await run('SELECT token_hash, user_id, expires_at FROM dbo.px_sessions WHERE token_hash = @token_hash', { token_hash });
    return rows[0] ? { token_hash: rows[0].token_hash, user_id: rows[0].user_id, expires_at: iso(rows[0].expires_at) } : null;
  },
  async deleteSession(token_hash) {
    await run('DELETE FROM dbo.px_sessions WHERE token_hash = @token_hash', { token_hash });
  },
  async deleteSessionsForUser(user_id, exceptTokenHash) {
    await run('DELETE FROM dbo.px_sessions WHERE user_id = @id AND (@except IS NULL OR token_hash <> @except)',
      { id: parseInt(user_id, 10), except: exceptTokenHash || null });
  },
  async purgeExpiredSessions() {
    await run('DELETE FROM dbo.px_sessions WHERE expires_at < SYSUTCDATETIME()');
  },
  async addAuditLog(e) {
    await run('INSERT INTO dbo.px_audit_log (user_id, username, action, target, ip) VALUES (@user_id, @username, @action, @target, @ip)', {
      user_id: e.user_id === undefined ? null : e.user_id, username: e.username || null, action: String(e.action).slice(0, 50),
      target: e.target ? String(e.target).slice(0, 200) : null, ip: e.ip ? String(e.ip).slice(0, 64) : null
    });
  },
  async getAuditLog(limit = 200) {
    const rows = await run('SELECT TOP (@limit) * FROM dbo.px_audit_log ORDER BY audit_id DESC', { limit: Math.max(1, Math.min(parseInt(limit, 10) || 200, 1000)) });
    return rows.map(r => ({ audit_id: Number(r.audit_id), occurred_at: iso(r.occurred_at), user_id: r.user_id, username: r.username, action: r.action, target: r.target, ip: r.ip }));
  },

  // ---- journeys
  async getJourneys() {
    return run('SELECT * FROM dbo.px_journeys ORDER BY journey_id');
  },
  async getJourneyById(journey_id) {
    const rows = await run('SELECT * FROM dbo.px_journeys WHERE journey_id = @id', { id: parseInt(journey_id, 10) });
    return rows[0];
  },
  async addJourney(journeyData) {
    return inTransaction(async tx => {
      const maxId = (await run('SELECT ISNULL(MAX(journey_id), 0) AS m FROM dbo.px_journeys WITH (UPDLOCK, HOLDLOCK)', {}, tx))[0].m;
      const j = {
        journey_id: maxId + 1,
        journey_code: (journeyData.journey_code || `JOURNEY_${maxId + 1}`).toUpperCase().trim(),
        journey_name: journeyData.journey_name ? journeyData.journey_name.trim() : `Journey ${maxId + 1}`,
        tagline: journeyData.tagline ? journeyData.tagline.trim() : '',
        color: journeyData.color || '#ED1C24',
        icon: journeyData.icon || 'Users',
        display_order: parseInt(journeyData.display_order || maxId + 1)
      };
      await insertJourney(tx, j);
      return j;
    });
  },
  async updateJourney(journey_id, journeyData) {
    const id = parseInt(journey_id, 10);
    const current = await this.getJourneyById(id);
    if (!current) throw new Error(`Journey #${id} not found.`);
    const next = {
      ...current,
      journey_code: journeyData.journey_code ? journeyData.journey_code.toUpperCase().trim() : current.journey_code,
      journey_name: journeyData.journey_name ? journeyData.journey_name.trim() : current.journey_name,
      tagline: journeyData.tagline !== undefined ? journeyData.tagline.trim() : current.tagline,
      color: journeyData.color || current.color,
      icon: journeyData.icon || current.icon,
      display_order: journeyData.display_order !== undefined ? parseInt(journeyData.display_order) : current.display_order
    };
    await run(`UPDATE dbo.px_journeys SET journey_code = @journey_code, journey_name = @journey_name, tagline = @tagline,
               color = @color, icon = @icon, display_order = @display_order WHERE journey_id = @journey_id`, next);
    return next;
  },
  async deleteJourney(journey_id) {
    const id = parseInt(journey_id, 10);
    const current = await this.getJourneyById(id);
    if (!current) throw new Error(`Journey #${id} not found.`);
    await run('DELETE FROM dbo.px_journeys WHERE journey_id = @id', { id });
    return current;
  },

  // ---- checkpoints
  async getCheckpoints() {
    return run('SELECT * FROM dbo.px_checkpoints ORDER BY checkpoint_id');
  },
  async getCheckpointById(checkpoint_id) {
    const rows = await run('SELECT * FROM dbo.px_checkpoints WHERE checkpoint_id = @id', { id: parseInt(checkpoint_id, 10) });
    return rows[0];
  },
  async addCheckpoint(cpData) {
    return inTransaction(async tx => {
      const maxId = (await run('SELECT ISNULL(MAX(checkpoint_id), 0) AS m FROM dbo.px_checkpoints WITH (UPDLOCK, HOLDLOCK)', {}, tx))[0].m;
      const cp = {
        checkpoint_id: maxId + 1,
        journey_id: parseInt(cpData.journey_id || 1),
        checkpoint_name: cpData.checkpoint_name ? cpData.checkpoint_name.trim() : `Checkpoint ${maxId + 1}`,
        experience_owner: cpData.experience_owner ? cpData.experience_owner.trim() : 'People Experience Team'
      };
      await insertCheckpoint(tx, cp);
      return cp;
    });
  },
  async updateCheckpoint(checkpoint_id, cpData) {
    const id = parseInt(checkpoint_id, 10);
    const current = await this.getCheckpointById(id);
    if (!current) throw new Error(`Checkpoint #${id} not found.`);
    const next = {
      ...current,
      journey_id: cpData.journey_id !== undefined ? parseInt(cpData.journey_id) : current.journey_id,
      checkpoint_name: cpData.checkpoint_name ? cpData.checkpoint_name.trim() : current.checkpoint_name,
      experience_owner: cpData.experience_owner ? cpData.experience_owner.trim() : current.experience_owner
    };
    await run(`UPDATE dbo.px_checkpoints SET journey_id = @journey_id, checkpoint_name = @checkpoint_name,
               experience_owner = @experience_owner WHERE checkpoint_id = @checkpoint_id`, next);
    return next;
  },
  async deleteCheckpoint(checkpoint_id) {
    const id = parseInt(checkpoint_id, 10);
    const current = await this.getCheckpointById(id);
    if (!current) throw new Error(`Checkpoint #${id} not found.`);
    await run('DELETE FROM dbo.px_checkpoints WHERE checkpoint_id = @id', { id });
    return current;
  },

  // ---- metrics
  async getMetrics() {
    return (await run(`${METRIC_SELECT} ORDER BY m.metric_id`)).map(rowToMetric);
  },
  async getMetricById(metric_id) {
    const rows = await run(`${METRIC_SELECT} WHERE m.metric_id = @id`, { id: parseInt(metric_id, 10) });
    return rows[0] ? rowToMetric(rows[0]) : undefined;
  },
  // Per-metric operational drilldown rows for OUTCOME metrics backed by an internal HR breakdown
  // table (recruitment SLA by unit, approval stages, hiring channel mix, recognition, attrition).
  async getOperationalRecords(metric_id) {
    const id = parseInt(metric_id, 10);
    for (const def of OPERATIONAL_TABLES) {
      const rows = await run(`SELECT ${def.cols.join(', ')} FROM dbo.${def.table} WHERE metric_id = @id ORDER BY record_id`, { id });
      if (rows.length) return rows;
    }
    return [];
  },
  // All drilldown rows keyed by metric id - used by exportToJson.js (rollback path).
  async getAllOperationalRecords() {
    const out = {};
    for (const def of OPERATIONAL_TABLES) {
      const rows = await run(`SELECT metric_id, ${def.cols.join(', ')} FROM dbo.${def.table} ORDER BY record_id`);
      rows.forEach(r => {
        const { metric_id, ...rec } = r;
        (out[metric_id] = out[metric_id] || []).push(rec);
      });
    }
    return out;
  },
  async addMetric(metricData) {
    return inTransaction(async tx => {
      const maxId = (await run('SELECT ISNULL(MAX(metric_id), 0) AS m FROM dbo.px_metrics WITH (UPDLOCK, HOLDLOCK)', {}, tx))[0].m;
      const newId = maxId + 1;
      const isEmployee = metricData.is_employee_metric !== undefined ? Boolean(metricData.is_employee_metric) : true;
      const surveySource = resolveSurveySource({ requested: metricData.survey_source, metricType: (metricData.metric_type || 'SURVEY').toUpperCase() });
      const metric = {
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
      await insertMetric(tx, metric);
      await upsertTarget(tx, newId, metric);
      if (metric.metric_type === 'SURVEY') await replaceSurveyQuestions(tx, newId, defaultQuestionsFor(newId), false);
      return { ...metric, metric_weight: metric.weight };
    });
  },
  async updateMetric(metric_id, metricData) {
    const id = parseInt(metric_id, 10);
    const current = await this.getMetricById(id);
    if (!current) throw new Error(`Metric #${id} not found.`);

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
      metric_type: resolvedMetricType,
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
      update_frequency: metricData.update_frequency ? String(metricData.update_frequency).toUpperCase() : (current.update_frequency || 'MONTHLY'),
      survey_source: surveySource,
      requires_manual_upload: resolveRequiresManualUpload({
        surveySource, requested: metricData.requires_manual_upload, current: current.requires_manual_upload, defaultValue: defaultRequiresManualUpload
      }),
      upload_deadline_day: metricData.upload_deadline_day !== undefined && metricData.upload_deadline_day !== ''
        ? parseInt(metricData.upload_deadline_day) : (current.upload_deadline_day !== undefined ? current.upload_deadline_day : 25),
      upload_deadline_month: metricData.upload_deadline_month !== undefined && metricData.upload_deadline_month !== ''
        ? parseInt(metricData.upload_deadline_month) : (current.upload_deadline_month !== undefined ? current.upload_deadline_month : 11),
      pic_name: metricData.pic_name !== undefined ? String(metricData.pic_name).trim() : (current.pic_name || current.experience_owner || ''),
      pic_email: metricData.pic_email !== undefined ? String(metricData.pic_email).trim() : (current.pic_email || ''),
      last_data_date: metricData.last_data_date !== undefined ? String(metricData.last_data_date).trim() : current.last_data_date,
      unit: metricData.unit !== undefined ? parseUnit(metricData.unit) : current.unit
    };

    await inTransaction(async tx => {
      await updateMetricRow(tx, updated);
      await upsertTarget(tx, id, updated);
    });
    return updated;
  },
  async deleteMetric(metric_id) {
    const id = parseInt(metric_id, 10);
    const current = await this.getMetricById(id);
    if (!current) throw new Error(`Metric #${id} not found.`);
    await inTransaction(async tx => {
      await run(`DELETE FROM dbo.px_metric_targets WHERE metric_id = @id; DELETE FROM dbo.px_survey_questions WHERE metric_id = @id; DELETE FROM dbo.px_reminder_log WHERE metric_id = @id;
        DELETE FROM dbo.px_survey_uploaded_responses WHERE metric_id = @id;
        DELETE FROM dbo.px_ess_results WHERE metric_id = @id;
        DELETE FROM dbo.px_survey_uploads WHERE metric_id = @id;
        DELETE FROM dbo.px_metrics WHERE metric_id = @id;`, { id }, tx);
    });
    return current;
  },
  async resetParametersToDefault() {
    await inTransaction(async tx => {
      await clearParameters(tx);
      await insertDefaultParameters(tx);
    });
    return {
      journeys: await this.getJourneys(),
      checkpoints: await this.getCheckpoints(),
      metrics: await this.getMetrics()
    };
  },

  async getDirectorates() {
    const rows = await run(`SELECT d.directorate_id, d.directorate_name, v.division_name
                            FROM dbo.px_directorates d
                            LEFT JOIN dbo.px_divisions v ON v.directorate_id = d.directorate_id
                            ORDER BY d.directorate_id, v.division_id`);
    const byId = new Map();
    rows.forEach(r => {
      if (!byId.has(r.directorate_id)) byId.set(r.directorate_id, { name: r.directorate_name, divisions: [] });
      if (r.division_name !== null) byId.get(r.directorate_id).divisions.push(r.division_name);
    });
    return [...byId.values()].map(d => ({
      directorate_name: d.name,
      name: d.name,
      divisions: d.divisions,
      sub_directorates: d.divisions
    }));
  },

  async updateMetricScore(metric_id, raw_value, normalized_score, notes = '') {
    const id = parseInt(metric_id, 10);
    const rows = await run(`UPDATE dbo.px_metrics SET raw_value = @raw, normalized_score = @norm,
                              notes = CASE WHEN @notes <> N'' THEN @notes ELSE notes END
                            OUTPUT INSERTED.metric_id WHERE metric_id = @id`,
      { id, raw: parseFloat(raw_value), norm: parseFloat(normalized_score), notes: T.max(notes || '') });
    return rows.length ? this.getMetricById(id) : null;
  },
  async updateMetricWeights(weightUpdates) {
    await inTransaction(async tx => {
      for (const { metric_id, weight } of weightUpdates) {
        await run('UPDATE dbo.px_metrics SET weight = @w WHERE metric_id = @id', { id: parseInt(metric_id, 10), w: parseFloat(weight) }, tx);
      }
    });
    return this.getMetrics();
  },

  // ---- events
  async getEvents() {
    return (await run('SELECT * FROM dbo.px_events ORDER BY event_seq')).map(rowToEvent);
  },
  async getEventById(event_id) {
    const rows = await run('SELECT * FROM dbo.px_events WHERE event_id = @id', { id: String(event_id) });
    return rows[0] ? rowToEvent(rows[0]) : undefined;
  },
  async getEventByPreCode(pre_event_code) {
    const rows = await run('SELECT TOP 1 * FROM dbo.px_events WHERE UPPER(pre_event_code) = UPPER(@c) ORDER BY event_seq', { c: String(pre_event_code) });
    return rows[0] ? rowToEvent(rows[0]) : undefined;
  },
  async getEventByPostCode(post_event_code) {
    const rows = await run('SELECT TOP 1 * FROM dbo.px_events WHERE UPPER(post_event_code) = UPPER(@c) ORDER BY event_seq', { c: String(post_event_code) });
    return rows[0] ? rowToEvent(rows[0]) : undefined;
  },
  async createEvent(eventData) {
    const e = {
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
    await inTransaction(async tx => {
      await run(`INSERT INTO dbo.px_events (event_id, event_name, program_category, event_date, event_type, location,
                   target_participants, pre_event_code, post_event_code, is_attendance_open, is_feedback_open, created_by)
                 VALUES (@event_id, @event_name, @program_category, @event_date, @event_type, @location,
                   @target_participants, @pre_event_code, @post_event_code, @is_attendance_open, @is_feedback_open, @created_by)`,
        { ...e, is_attendance_open: !!e.is_attendance_open, is_feedback_open: !!e.is_feedback_open, event_date: String(e.event_date) }, tx);
      // Clone the master questions for this event (or use the ones supplied).
      const questions = eventData.questions && eventData.questions.length > 0
        ? eventData.questions
        : await this.getMasterQuestions();
      for (let i = 0; i < questions.length; i++) {
        await run(`INSERT INTO dbo.px_event_questions (event_id, question_id, question_text, question_type, display_order, is_default, extra_json)
                   VALUES (@event_id, @question_id, @question_text, @question_type, @display_order, @is_default, @extra_json)`,
          { event_id: e.event_id, ...questionParams(questions[i], i) }, tx);
      }
    });
    return e;
  },
  async deleteEvent(event_id) {
    const removed = await this.getEventById(event_id);
    if (!removed) throw new Error(`Event "${event_id}" not found.`);
    // Attendances, feedback, questions and media rows go with it (ON DELETE CASCADE).
    await run('DELETE FROM dbo.px_events WHERE event_id = @id', { id: String(event_id) });
    return removed;
  },

  // ---- attendance
  async getAttendances() {
    return (await run('SELECT * FROM dbo.px_attendances ORDER BY attendance_id')).map(rowToAttendance);
  },
  async getAllAttendances() {
    return this.getAttendances();
  },
  async getAttendancesByEvent(event_id) {
    return (await run('SELECT * FROM dbo.px_attendances WHERE event_id = @id ORDER BY attendance_id', { id: String(event_id) })).map(rowToAttendance);
  },
  async addAttendance(attendanceData) {
    const p = {
      event_id: attendanceData.event_id,
      nip: attendanceData.nip.trim(),
      employee_name: attendanceData.employee_name.trim(),
      cimb_email: attendanceData.cimb_email.trim().toLowerCase(),
      directorate: attendanceData.directorate || 'General',
      division: attendanceData.division || 'General'
    };
    try {
      const rows = await run(`INSERT INTO dbo.px_attendances (event_id, nip, employee_name, cimb_email, directorate, division)
                              OUTPUT INSERTED.* VALUES (@event_id, @nip, @employee_name, @cimb_email, @directorate, @division)`, p);
      return rowToAttendance(rows[0]);
    } catch (err) {
      if (isUniqueViolation(err)) throw new Error(`NIP ${attendanceData.nip} has already checked in to this event.`);
      throw err;
    }
  },
  async deleteAttendance(event_id, nip) {
    const rows = await run('DELETE FROM dbo.px_attendances OUTPUT DELETED.* WHERE event_id = @event_id AND nip = @nip', { event_id: String(event_id), nip: String(nip) });
    if (!rows.length) throw new Error(`Attendance record of NIP ${nip} in event "${event_id}" not found.`);
    return rowToAttendance(rows[0]);
  },

  // ---- event questions & feedback
  async getMasterQuestions() {
    return (await run('SELECT * FROM dbo.px_master_survey_questions ORDER BY row_id')).map(rowToQuestion);
  },
  async updateMasterQuestions(questions) {
    await inTransaction(async tx => {
      await run('DELETE FROM dbo.px_master_survey_questions', {}, tx);
      for (let i = 0; i < questions.length; i++) {
        await run(`INSERT INTO dbo.px_master_survey_questions (question_id, question_text, question_type, display_order, is_default, extra_json)
                   VALUES (@question_id, @question_text, @question_type, @display_order, @is_default, @extra_json)`, questionParams(questions[i], i), tx);
      }
    });
    return this.getMasterQuestions();
  },
  async getEventQuestions(event_id) {
    const rows = await run('SELECT * FROM dbo.px_event_questions WHERE event_id = @id ORDER BY row_id', { id: String(event_id) });
    return rows.length ? rows.map(rowToQuestion) : this.getMasterQuestions();
  },
  async saveEventQuestions(event_id, questions) {
    if (!(await this.getEventById(event_id))) throw new Error(`Event "${event_id}" not found.`);
    await inTransaction(async tx => {
      await run('DELETE FROM dbo.px_event_questions WHERE event_id = @id', { id: String(event_id) }, tx);
      for (let i = 0; i < questions.length; i++) {
        await run(`INSERT INTO dbo.px_event_questions (event_id, question_id, question_text, question_type, display_order, is_default, extra_json)
                   VALUES (@event_id, @question_id, @question_text, @question_type, @display_order, @is_default, @extra_json)`,
          { event_id: String(event_id), ...questionParams(questions[i], i) }, tx);
      }
    });
    return this.getEventQuestions(event_id);
  },
  async getFeedbackByEvent(event_id) {
    return (await run('SELECT * FROM dbo.px_feedback_responses WHERE event_id = @id ORDER BY response_id', { id: String(event_id) })).map(rowToFeedback);
  },
  async addFeedbackResponse(feedbackData) {
    try {
      const rows = await run(`INSERT INTO dbo.px_feedback_responses (event_id, nip, ratings_json, verbatim)
                              OUTPUT INSERTED.* VALUES (@event_id, @nip, @ratings, @verbatim)`, {
        event_id: feedbackData.event_id, nip: feedbackData.nip.trim(),
        ratings: T.max(JSON.stringify(feedbackData.ratings || {})), verbatim: T.max(feedbackData.verbatim || '')
      });
      return rowToFeedback(rows[0]);
    } catch (err) {
      if (isUniqueViolation(err)) throw new Error(`NIP ${feedbackData.nip} has already filled in the evaluation questionnaire for this event.`);
      throw err;
    }
  },
  async deleteFeedbackResponse(event_id, nip) {
    const rows = await run('DELETE FROM dbo.px_feedback_responses OUTPUT DELETED.* WHERE event_id = @event_id AND nip = @nip', { event_id: String(event_id), nip: String(nip) });
    if (!rows.length) throw new Error(`Feedback of NIP ${nip} in event "${event_id}" not found.`);
    return rowToFeedback(rows[0]);
  },

  // ---- media gallery (files on disk, path + metadata + transcript here)
  async getMediaByEvent(event_id) {
    return (await run('SELECT * FROM dbo.px_media WHERE event_id = @id ORDER BY media_seq', { id: String(event_id) })).map(rowToMedia);
  },
  async getAllMedia() {
    return (await run('SELECT * FROM dbo.px_media ORDER BY media_seq')).map(rowToMedia);
  },
  async getMediaById(media_id) {
    const rows = await run('SELECT * FROM dbo.px_media WHERE media_id = @id', { id: String(media_id) });
    return rows[0] ? rowToMedia(rows[0]) : null;
  },
  async addMedia(mediaItem) {
    const count = (await run('SELECT COUNT(*) AS c FROM dbo.px_media'))[0].c;
    const rows = await run(`INSERT INTO dbo.px_media (media_id, event_id, file_name, file_path, file_type, caption,
                              ai_generated_description, highlight_order, transcript_status)
                            OUTPUT INSERTED.* VALUES (@media_id, @event_id, @file_name, @file_path, @file_type, @caption,
                              @ai, @highlight_order, @transcript_status)`, {
      media_id: mediaItem.media_id || `med-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      event_id: mediaItem.event_id,
      file_name: mediaItem.file_name,
      file_path: mediaItem.file_path,
      file_type: mediaItem.file_type || 'IMAGE',
      caption: T.max(mediaItem.caption || ''),
      ai: T.max(mediaItem.ai_generated_description || ''),
      highlight_order: mediaItem.highlight_order || count + 1,
      transcript_status: mediaItem.transcript_status || null
    });
    return rowToMedia(rows[0]);
  },
  // Whitelisted partial update - used by the background transcription job to record progress. file_path is only changed
  // by mediaFileService (renaming a finished video to its original upload name).
  async updateMedia(media_id, patch) {
    const sets = [];
    const params = { id: String(media_id) };
    const setIf = (key, column, convert) => {
      if (patch[key] !== undefined) { sets.push(`${column} = @${key}`); params[key] = convert ? convert(patch[key]) : patch[key]; }
    };
    setIf('caption', 'caption', T.max);
    setIf('file_path', 'file_path', v => String(v));
    setIf('ai_generated_description', 'ai_generated_description', T.max);
    setIf('transcript', 'transcript', v => T.max(v === null ? null : String(v)));
    setIf('transcript_segments', 'transcript_segments', v => T.max(v === null ? null : JSON.stringify(v)));
    setIf('transcript_status', 'transcript_status');
    setIf('transcript_error', 'transcript_error', v => T.max(v === null ? null : String(v)));
    setIf('transcript_language', 'transcript_language');
    setIf('duration_seconds', 'duration_seconds');
    // AI summary (v2.28.0)
    setIf('summary', 'summary', v => T.max(v === null ? null : String(v)));
    setIf('summary_points', 'summary_points', v => T.max(v === null ? null : JSON.stringify(v)));
    setIf('summary_status', 'summary_status');
    setIf('summary_source', 'summary_source');
    setIf('summary_model', 'summary_model');
    setIf('summary_language', 'summary_language');
    setIf('summary_generated_at', 'summary_generated_at', v => (v ? new Date(v) : null));
    setIf('summary_error', 'summary_error', v => (v === null ? null : String(v).slice(0, 500)));
    if (!sets.length) return this.getMediaById(media_id);
    const rows = await run(`UPDATE dbo.px_media SET ${sets.join(', ')} OUTPUT INSERTED.* WHERE media_id = @id`, params);
    return rows[0] ? rowToMedia(rows[0]) : null;
  },
  // Returns the removed record (so the caller can delete its file from disk), or null.
  async deleteMedia(media_id) {
    const rows = await run('DELETE FROM dbo.px_media OUTPUT DELETED.* WHERE media_id = @id', { id: String(media_id) });
    return rows[0] ? rowToMedia(rows[0]) : null;
  },

  // ---- action library & alerts
  async getActionLibrary() {
    return run('SELECT metric_id, checkpoint_id, gap_condition, recommended_action, suggested_initiatives FROM dbo.px_action_library ORDER BY action_id');
  },
  async updateActionLibrary(items) {
    await inTransaction(async tx => {
      await run('DELETE FROM dbo.px_action_library', {}, tx);
      for (const a of items) {
        await run(`INSERT INTO dbo.px_action_library (metric_id, checkpoint_id, gap_condition, recommended_action, suggested_initiatives)
                   VALUES (@metric_id, @checkpoint_id, @gap_condition, @recommended_action, @suggested_initiatives)`, {
          metric_id: parseInt(a.metric_id, 10), checkpoint_id: a.checkpoint_id === undefined || a.checkpoint_id === null ? null : parseInt(a.checkpoint_id, 10),
          gap_condition: a.gap_condition || '', recommended_action: T.max(a.recommended_action || ''),
          suggested_initiatives: T.max(a.suggested_initiatives || '')
        }, tx);
      }
    });
    return this.getActionLibrary();
  },
  async getAcknowledgedAlerts() {
    return (await run('SELECT metric_id FROM dbo.px_acknowledged_alerts ORDER BY acknowledged_at, metric_id')).map(r => r.metric_id);
  },
  async acknowledgeAlert(metric_id) {
    await run(`IF NOT EXISTS (SELECT 1 FROM dbo.px_acknowledged_alerts WHERE metric_id = @id)
                 INSERT INTO dbo.px_acknowledged_alerts (metric_id) VALUES (@id)`, { id: parseInt(metric_id, 10) });
    return true;
  },
  async resetAcknowledgedAlerts() {
    await run('DELETE FROM dbo.px_acknowledged_alerts');
    return true;
  },

  // ---- manual survey uploads & responses
  async getSurveyUploads() {
    return (await run('SELECT * FROM dbo.px_survey_uploads ORDER BY upload_seq DESC')).map(rowToUpload);
  },
  async getUploadedResponsesByMetric(metric_id) {
    return selectResponses(['metric_id = @metric_id'], { metric_id: parseInt(metric_id, 10) });
  },
  async getAllUploadedVerbatims() {
    const rows = await run(`SELECT metric_id, respondent_id, verbatim_feedback, CONVERT(char(10), survey_date, 23) AS d
                            FROM dbo.px_survey_uploaded_responses
                            WHERE LEN(LTRIM(RTRIM(verbatim_feedback))) > 3 ORDER BY response_id`);
    return rows.map(r => ({ metric_id: r.metric_id, nip: r.respondent_id, verbatim: r.verbatim_feedback, date: r.d }));
  },
  async saveSurveyUploadBatch(batchData, responses = []) {
    const record = {
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
    await inTransaction(async tx => {
      await run(`INSERT INTO dbo.px_survey_uploads (upload_id, metric_id, file_name, total_rows, valid_rows, invalid_rows, calculated_avg_score, uploaded_by, uploaded_at)
                 VALUES (@upload_id, @metric_id, @file_name, @total_rows, @valid_rows, @invalid_rows, @calculated_avg_score, @uploaded_by, @uploaded_at)`,
        { ...record, uploaded_at: new Date(record.uploaded_at) }, tx);
      await bulkInsertResponses(tx, record.upload_id, responses.map(normalizeResponse));
    });
    return record;
  },

  // ---- ESS result summaries (v2.32.0)
  // Every ESS result row of one metric (or of all metrics when metric_id is null/undefined), optionally one period.
  async getEssResults(metric_id, { year, month } = {}) {
    const where = [];
    const params = {};
    if (metric_id !== null && metric_id !== undefined) { where.push('metric_id = @metric_id'); params.metric_id = parseInt(metric_id, 10); }
    if (year) { where.push('survey_year = @y'); params.y = parseInt(year, 10); }
    if (month) { where.push('survey_month = @m'); params.m = parseInt(month, 10); }
    const rows = await run(`SELECT * FROM dbo.px_ess_results ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY metric_id, survey_year, survey_month, ess_result_id`, params);
    return rows.map(rowToEssResult);
  },
  // Latest (year, month) with an ESS result of this metric on or before endYear-endMonth; null when there is none.
  async getLatestEssPeriod(metric_id, endYear, endMonth) {
    const rows = await run(`SELECT TOP 1 survey_year, survey_month FROM dbo.px_ess_results
                            WHERE metric_id = @id AND survey_year * 100 + survey_month <= @k ORDER BY survey_year DESC, survey_month DESC`,
      { id: parseInt(metric_id, 10), k: parseInt(endYear, 10) * 100 + parseInt(endMonth || 12, 10) });
    return rows[0] ? { year: rows[0].survey_year, month: rows[0].survey_month } : null;
  },
  // Stores one ESS summary upload: the upload record (history) + its rows, REPLACING the rows of the same metric and
  // period, all in one transaction. Returns { record, replaced_rows }.
  async saveEssResultUpload(meta, rows) {
    const record = {
      upload_id: meta.upload_id || `ess-${Date.now()}`,
      metric_id: parseInt(meta.metric_id, 10),
      file_name: meta.file_name,
      total_rows: meta.total_rows,
      valid_rows: meta.valid_rows,
      invalid_rows: meta.invalid_rows || 0,
      calculated_avg_score: meta.calculated_avg_score,
      uploaded_by: meta.uploaded_by || 'HR Admin',
      uploaded_at: new Date().toISOString()
    };
    const replaced = await inTransaction(async tx => {
      await run(`INSERT INTO dbo.px_survey_uploads (upload_id, metric_id, file_name, total_rows, valid_rows, invalid_rows, calculated_avg_score, uploaded_by, uploaded_at)
                 VALUES (@upload_id, @metric_id, @file_name, @total_rows, @valid_rows, @invalid_rows, @calculated_avg_score, @uploaded_by, @uploaded_at)`,
        { ...record, uploaded_at: new Date(record.uploaded_at) }, tx);
      const del = await run(`DELETE FROM dbo.px_ess_results WHERE metric_id = @id AND survey_year = @y AND survey_month = @m; SELECT @@ROWCOUNT AS n;`,
        { id: record.metric_id, y: parseInt(meta.survey_year, 10), m: parseInt(meta.survey_month, 10) }, tx);
      for (const r of rows) await insertEssResult(tx, record.upload_id, { ...r, metric_id: record.metric_id, survey_year: meta.survey_year, survey_month: meta.survey_month });
      return del[0] ? del[0].n : 0;
    });
    return { record, replaced_rows: replaced };
  },
  async deleteEssResultsForMetric(metric_id) {
    const rows = await run('DELETE FROM dbo.px_ess_results WHERE metric_id = @id; SELECT @@ROWCOUNT AS n;', { id: parseInt(metric_id, 10) });
    return rows[0] ? rows[0].n : 0;
  },

  // ---- target & threshold admin settings
  async getMetricTargets() {
    const rows = await run('SELECT metric_id, target_value, target_display, min_threshold FROM dbo.px_metric_targets ORDER BY metric_id');
    const out = {};
    rows.forEach(r => { out[r.metric_id] = { target_value: r.target_value, target_display: r.target_display, min_threshold: r.min_threshold }; });
    return out;
  },
  async getMetricTargetById(metric_id) {
    const rows = await run('SELECT target_value, target_display, min_threshold FROM dbo.px_metric_targets WHERE metric_id = @id', { id: parseInt(metric_id, 10) });
    return rows[0] ? { target_value: rows[0].target_value, target_display: rows[0].target_display, min_threshold: rows[0].min_threshold } : null;
  },
  async saveMetricTargets(newTargets) {
    await inTransaction(async tx => {
      if (Array.isArray(newTargets)) {
        for (const t of newTargets) {
          await upsertTarget(tx, parseInt(t.metric_id, 10), {
            target_value: t.target_value,
            target_display: t.target_display ? t.target_display.trim() : `Target: ${t.target_value}`,
            min_threshold: t.min_threshold
          });
        }
      } else if (newTargets && typeof newTargets === 'object') {
        for (const key of Object.keys(newTargets)) {
          const t = newTargets[key];
          await upsertTarget(tx, parseInt(key, 10), {
            target_value: t.target_value,
            target_display: t.target_display || `Target: ${t.target_value}`,
            min_threshold: t.min_threshold
          });
        }
      }
    });
    return this.getMetricTargets();
  },
  async resetMetricTargets() {
    await inTransaction(async tx => {
      for (const m of seed.initialMetrics) {
        // Only metrics that still exist (a deleted metric must not get a dangling target row).
        const exists = await run('SELECT 1 AS x FROM dbo.px_metrics WHERE metric_id = @id', { id: m.metric_id }, tx);
        if (exists.length) await upsertTarget(tx, m.metric_id, { target_value: m.target_value, target_display: m.target_display, min_threshold: m.min_threshold });
      }
    });
    return this.getMetricTargets();
  },

  // ---- survey questions admin settings (rows of px_survey_questions)
  async _questionRows(where, params) {
    return run(`SELECT * FROM dbo.px_survey_questions ${where || ''} ORDER BY metric_id, display_order`, params || {});
  },
  async getSurveyQuestions(metric_id) {
    const id = parseInt(metric_id, 10);
    const rows = await this._questionRows('WHERE metric_id = @id', { id });
    if (rows.length) return rows.map(rowToSurveyQuestion);
    // Only a metric with NO rows at all (e.g. a non-survey metric id) falls back to the generic question.
    return require('../services/metricQuestionService').getGenericQuestions();
  },
  async getAllSurveyQuestions() {
    const out = {};
    (await this._questionRows()).forEach(r => { (out[r.metric_id] = out[r.metric_id] || []).push(rowToSurveyQuestion(r)); });
    return out;
  },
  // Question sets an admin has edited (used by the JSON export / rollback path).
  async _customizedQuestions() {
    const out = {};
    (await this._questionRows('WHERE is_customized = 1')).forEach(r => { (out[r.metric_id] = out[r.metric_id] || []).push(rowToSurveyQuestion(r)); });
    return out;
  },
  async saveSurveyQuestions(metric_id, questions) {
    const id = parseInt(metric_id, 10);
    if (!Array.isArray(questions)) throw new Error('The questions must be an array.');
    await inTransaction(tx => replaceSurveyQuestions(tx, id, questions, true));
    return this.getSurveyQuestions(id);
  },
  async resetSurveyQuestions(metric_id) {
    const id = parseInt(metric_id, 10);
    await inTransaction(tx => replaceSurveyQuestions(tx, id, defaultQuestionsFor(id), false));
    return this.getSurveyQuestions(id);
  },

  // Distinct years that actually have survey response data (always including the current year).
  async getAvailableSurveyYears() {
    const rows = await run('SELECT DISTINCT YEAR(survey_date) AS y FROM dbo.px_survey_uploaded_responses UNION SELECT DISTINCT survey_year FROM dbo.px_ess_results');
    const years = new Set(rows.map(r => String(r.y)));
    years.add(CURRENT_YEAR);
    return Array.from(years).sort();
  },

  // ---- period & directorate filtered responses (filtering happens in SQL)
  async getResponsesByMetricAndPeriod(metric_id, filterOptions = 'YTD') {
    return selectResponses(['metric_id = @metric_id'], { metric_id: parseInt(metric_id, 10) }, filterOptions);
  },
  async getAllResponsesByPeriod(filterOptions = 'YTD') {
    return selectResponses([], {}, filterOptions);
  }
};

module.exports = storage;
