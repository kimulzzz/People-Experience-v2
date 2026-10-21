// server/db/exportToJson.js
// ROLLBACK helper: exports everything in SQL Server back into the store.json format, so the
// app can fall back to the JSON file store (STORAGE_BACKEND=json) WITHOUT losing any edits that
// were made while SQL Server was the active backend.
//
//   node server/db/exportToJson.js                 writes server/data/store.from-sql.json (safe, nothing replaced)
//   node server/db/exportToJson.js --replace       backs up the current store.json to server/data/backups/
//                                                  and replaces it with the SQL data (use stop-the-server first)
//   node server/db/exportToJson.js --out some.json write to a custom path
//
// Read-only on SQL Server. See docs/08_DATABASE_SCHEMA_AND_MIGRATION.md ("Rollback").
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const fs = require('fs');
const path = require('path');
const storage = require('./sqlStorage');

const args = process.argv.slice(2);
const replace = args.includes('--replace');
const outIdx = args.indexOf('--out');
const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const outFile = outIdx !== -1 ? path.resolve(args[outIdx + 1]) : path.join(DATA_DIR, 'store.from-sql.json');

async function main() {
  const events = await storage.getEvents();
  const metrics = await storage.getMetrics();

  const eventQuestions = {};
  const feedbackResponses = [];
  for (const e of events) {
    eventQuestions[e.event_id] = await storage.getEventQuestions(e.event_id);
    feedbackResponses.push(...(await storage.getFeedbackByEvent(e.event_id)));
  }

  // surveyUploads is newest-first in the JSON store (getSurveyUploads already returns that order).
  // Only admin-customised sets go into the JSON store; defaults come from code there.
  const customSurveyQuestions = await storage._customizedQuestions();

  const store = {
    journeys: await storage.getJourneys(),
    checkpoints: await storage.getCheckpoints(),
    metrics,
    directorates: (await storage.getDirectorates()).map(d => ({ directorate_name: d.directorate_name, divisions: d.divisions })),
    // former directorate / division names (v2.51.0)
    directorateAliases: (await storage.getDirectoryAliases()).directorates,
    divisionAliases: (await storage.getDirectoryAliases()).divisions,
    metricTargets: await storage.getMetricTargets(),
    weights: metrics.map(m => ({ metric_id: m.metric_id, weight: m.weight })),
    actionLibrary: await storage.getActionLibrary(),
    masterSurveyQuestions: await storage.getMasterQuestions(),
    events,
    eventQuestions,
    attendances: await storage.getAttendances(),
    feedbackResponses,
    surveyUploads: await storage.getSurveyUploads(),
    surveyUploadedResponses: await storage.getAllResponsesByPeriod(null),
    essResults: await storage.getEssResults(null), // ESS result summaries (v2.32.0)
    // Exit Interview rows (v2.38.0) incl. TEMPLATE_IMPORT rows = real per-employee data: keep such an export local
    exitInterviews: await storage.getExitInterviews(),
    exitInterviewUploads: (await storage.getExitInterviewUploads()).reverse(),
    // social media statistics of metric 1 (v2.52.0)
    socialMediaStats: await storage.getSocialMediaStats(),
    socialMediaUploads: (await storage.getSocialMediaUploads()).reverse(),
    // monthly values of OUTCOME metrics (v2.54.0)
    outcomeValues: await storage.getOutcomeValues(),
    outcomeUploads: (await storage.getOutcomeUploads()).reverse(),
    // composite summary metrics (v2.55.0): parts, their summary rows and upload history
    metricParts: await storage.getMetricParts(),
    metricPartResults: await storage.getMetricPartResults(),
    metricPartUploads: (await storage.getMetricPartUploads()).reverse(),
    media: await storage.getAllMedia(),
    customSurveyQuestions,
    acknowledgedAlerts: await storage.getAcknowledgedAlerts(),
    operationalRecords: await storage.getAllOperationalRecords(),
    emailSettings: await storage.getEmailSettings(),
    reminderLog: (await storage.getReminderLog(1000000)).reverse(),
    appSettings: Object.fromEntries(Object.entries(await storage.getSettings()).map(([k, value]) => [k, { value }]))
  };

  let target = outFile;
  if (replace) {
    fs.mkdirSync(path.join(DATA_DIR, 'backups'), { recursive: true });
    if (fs.existsSync(STORE_FILE)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backup = path.join(DATA_DIR, 'backups', `store.before-sql-export-${stamp}.json`);
      fs.copyFileSync(STORE_FILE, backup);
      console.log(`Backed up the current store.json -> ${backup}`);
    }
    target = STORE_FILE;
  }
  fs.writeFileSync(target, JSON.stringify(store, null, 2), 'utf8');

  console.log(`Exported -> ${target}`);
  console.log(`  journeys ${store.journeys.length}, metrics ${store.metrics.length}, events ${store.events.length}, ` +
    `attendances ${store.attendances.length}, feedback ${store.feedbackResponses.length}, media ${store.media.length}, ` +
    `survey responses ${store.surveyUploadedResponses.length}, ESS results ${store.essResults.length}, ` +
    `exit interviews ${store.exitInterviews.length}, social media rows ${store.socialMediaStats.length}, outcome values ${store.outcomeValues.length}`);
  console.log(replace
    ? 'EXPORT_OK. Now set STORAGE_BACKEND=json in .env and restart the server.'
    : 'EXPORT_OK. To roll back to the JSON store with this data: rerun with --replace (server stopped), then set STORAGE_BACKEND=json.');
}

main()
  .then(() => storage.close())
  .catch(async err => {
    console.error('EXPORT_FAILED:', err.message);
    try { await storage.close(); } catch (_) { /* ignore */ }
    process.exit(1);
  });
