// server/db/migrate.js
// One-time migration of the JSON file store (server/data/store.json) into Microsoft SQL Server.
//
//   node server/db/migrate.js            create the schema and load store.json (refuses if the
//                                        database already contains data)
//   node server/db/migrate.js --reset    DROP all px_* tables first, then recreate and reload
//   node server/db/migrate.js --file X   migrate a different store file (e.g. a backup)
//
// It only READS store.json - the JSON store is never modified, so it remains a valid fallback.
// Prerequisite: SQL Server installed + provisioned (scripts/sqlserver/Setup-SqlServer.ps1),
// which writes the DB_* settings this script reads from .env.
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const fs = require('fs');
const path = require('path');
const storage = require('./sqlStorage');

const args = process.argv.slice(2);
const reset = args.includes('--reset');
const fileArg = args.indexOf('--file');
const storeFile = fileArg !== -1 ? path.resolve(args[fileArg + 1]) : path.join(__dirname, '..', 'data', 'store.json');

const jsonCounts = s => ({
  journeys: (s.journeys || []).length,
  checkpoints: (s.checkpoints || []).length,
  metrics: (s.metrics || []).length,
  directorates: (s.directorates || []).length,
  directorate_aliases: (s.directorateAliases || []).length,
  division_aliases: (s.divisionAliases || []).length,
  action_library: (s.actionLibrary || []).length,
  master_questions: (s.masterSurveyQuestions || []).length,
  events: (s.events || []).length,
  attendances: (s.attendances || []).length,
  feedback_responses: (s.feedbackResponses || []).length,
  media: (s.media || []).length,
  survey_uploads: (s.surveyUploads || []).length,
  survey_responses: (s.surveyUploadedResponses || []).length,
  ess_results: (s.essResults || []).length,
  exit_interviews: (s.exitInterviews || []).length,
  exit_interview_uploads: (s.exitInterviewUploads || []).length,
  social_media_stats: (s.socialMediaStats || []).length,
  social_media_uploads: (s.socialMediaUploads || []).length,
  custom_survey_questions: Object.keys(s.customSurveyQuestions || {}).length,
  acknowledged_alerts: (s.acknowledgedAlerts || []).length,
  operational_records: Object.values(s.operationalRecords || {}).reduce((n, a) => n + (a || []).length, 0)
});

async function main() {
  if (!fs.existsSync(storeFile)) throw new Error(`Store file not found: ${storeFile}`);
  const store = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
  console.log(`Source: ${storeFile}`);

  // getPool() is lazy; applySchema() connects. init() is NOT used here: it would seed an empty
  // database with demo data before our real data is loaded.
  if (reset) {
    await storage.applySchema(); // make sure the connection works before dropping anything
    console.log('--reset: dropping all px_* tables ...');
    await storage.dropAllTables();
  }
  await storage.applySchema();

  const before = await storage.health();
  const existing = before.tables.metrics + before.tables.survey_responses + before.tables.events;
  if (existing > 0) {
    throw new Error('The database already contains data. Re-run with --reset to wipe and reload it from the JSON store.');
  }
  console.log(`Connected: ${before.server} / ${before.database} (${before.edition} ${before.version})`);

  console.log('Loading data ...');
  const loaded = await storage.importStore(store, msg => console.log(msg));

  const expected = jsonCounts(store);
  let mismatches = 0;
  console.log('\nTable                      JSON store   SQL Server');
  for (const key of Object.keys(expected)) {
    const ok = expected[key] === loaded[key];
    if (!ok) mismatches++;
    console.log(`${(ok ? 'OK  ' : 'DIFF') + ' ' + key.padEnd(22)} ${String(expected[key]).padStart(10)} ${String(loaded[key]).padStart(12)}`);
  }
  const after = await storage.health();
  console.log(`\nVerified in SQL Server: ${JSON.stringify(after.tables)}`);
  if (mismatches) console.log(`\n${mismatches} table(s) differ - rows listed as "skipped" above were orphans (event no longer exists).`);
  // v2.31.0: an older store.json still holds the demo directorate names - rename them right away
  // (the server would otherwise do it on its next boot).
  await storage.migrateDirectorates();
  console.log('\nMIGRATE_OK. Next: set STORAGE_BACKEND=sql in .env and restart the server.');
}

main()
  .then(() => storage.close())
  .catch(async err => {
    console.error('\nMIGRATE_FAILED:', err.message);
    try { await storage.close(); } catch (_) { /* ignore */ }
    process.exit(1);
  });
