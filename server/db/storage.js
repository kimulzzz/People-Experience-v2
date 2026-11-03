// server/db/storage.js
// Storage dispatcher. Every caller does `require('../db/storage')` and treats every method as
// async (`await storage.x()`), so the backend can be swapped without touching them:
//   STORAGE_BACKEND=json (default) -> jsonStorage.js  (server/data/store.json)
//   STORAGE_BACKEND=sql            -> sqlStorage.js   (Microsoft SQL Server, see docs/08)
//   STORAGE_BACKEND=pg             -> sqlStorage.js   (PostgreSQL, same code through dialects/pg.js - v2.61.0, UAT hosting)
// Rollback = set STORAGE_BACKEND=json (or unset it) and restart.
const requested = String(process.env.STORAGE_BACKEND || 'json').toLowerCase();
const backend = ['sql', 'pg'].includes(requested) ? requested : 'json';

if (backend === 'json') {
  module.exports = require('./jsonStorage');
} else {
  module.exports = require('./sqlStorage');   // the dialect (SQL Server / PostgreSQL) follows STORAGE_BACKEND
}
module.exports.backend = backend;
