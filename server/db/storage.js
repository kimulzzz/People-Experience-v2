// server/db/storage.js
// Storage dispatcher. Every caller does `require('../db/storage')` and treats every method as
// async (`await storage.x()`), so the backend can be swapped without touching them:
//   STORAGE_BACKEND=json (default) -> jsonStorage.js  (server/data/store.json)
//   STORAGE_BACKEND=sql            -> sqlStorage.js   (Microsoft SQL Server, see docs/08)
// Rollback = set STORAGE_BACKEND=json (or unset it) and restart.
const backend = String(process.env.STORAGE_BACKEND || 'json').toLowerCase();

if (backend === 'sql') {
  module.exports = require('./sqlStorage');
} else {
  module.exports = require('./jsonStorage');
}
module.exports.backend = backend === 'sql' ? 'sql' : 'json';
