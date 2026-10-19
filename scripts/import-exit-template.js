// scripts/import-exit-template.js
// One-time import of the REAL "Termination Report" exit interview file (e.g. docs/Template Report Exit Interview.xlsx,
// September 2026) into the LOCAL database (v2.38.0). The file is per-employee data: it is gitignored and its rows are
// never copied into code or seed data. It has no Directorate column, so every row gets a deterministic DUMMY directorate
// (+ division) weighted like the demo rows, and because the NIKs in it are masked and collide (e.g. "3xxxx4") each row gets
// a surrogate NIK "<masked NIK>-<row number>". Rows are stored with source 'TEMPLATE_IMPORT' through the same import
// service as an Admin upload (same validation; the months it covers lose their dummy rows). Running it again updates
// the same rows (same surrogate NIKs) instead of adding new ones.
//
//   npm run exit:import-template -- "docs/Template Report Exit Interview.xlsx"
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const storage = require('../server/db/storage');
const { exitDummyOrgUnit } = require('../server/db/seedData');
const { importExitInterviews } = require('../server/services/exitInterviewService');

async function main() {
  const fileArg = process.argv[2];
  if (!fileArg) throw new Error('Usage: npm run exit:import-template -- "<path to the Termination Report .xlsx>"');
  const filePath = path.resolve(fileArg);
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  if (path.extname(filePath).toLowerCase() !== '.xlsx') throw new Error('The file must be an .xlsx workbook.');

  await storage.init(); // schema + boot top-ups (creates the exit tables on an older database)
  const directorates = await storage.getDirectorates();
  const result = await importExitInterviews(fs.readFileSync(filePath), path.basename(filePath), {
    source: 'TEMPLATE_IMPORT',
    uploadedBy: 'Template import (scripts/import-exit-template.js)',
    surrogateNik: true,
    assignOrgUnit: rowNumber => exitDummyOrgUnit(directorates, rowNumber)
  });
  if (!result.success) {
    console.error(result.error);
    (result.errors || []).slice(0, 50).forEach(e => console.error(`  row ${e.row_number ?? '-'} ${e.column || ''}: ${e.reason}`));
    throw new Error('IMPORT_REFUSED');
  }
  await storage.addAuditLog({ user_id: null, username: 'script:import-exit-template', action: 'EXIT_INTERVIEW_UPLOAD',
    target: `TEMPLATE_IMPORT ${result.rows_imported} rows (${result.inserted_rows} new, ${result.updated_rows} updated, ${result.removed_dummy_rows} dummy replaced); ${result.months.join(' ')}; batch ${result.upload_id}`, ip: null });
  console.log(result.message);
  console.log('Directorates were assigned as DUMMY values and NIKs were made unique as "<NIK>-<row number>".');
  console.log('IMPORT_OK');
}

main()
  .then(() => (typeof storage.close === 'function' ? storage.close() : null))
  .catch(async err => {
    console.error('IMPORT_FAILED:', err.message);
    try { if (typeof storage.close === 'function') await storage.close(); } catch (_) { /* ignore */ }
    process.exit(1);
  });
