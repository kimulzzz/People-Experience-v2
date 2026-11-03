// server/db/dialects/index.js
// The SQL dialect of the database storage (sqlStorage.js): STORAGE_BACKEND=pg -> PostgreSQL (pg.js), anything else ->
// Microsoft SQL Server (mssql.js). Both export the same contract, so sqlStorage.js is written once for both.
const backend = String(process.env.STORAGE_BACKEND || '').toLowerCase();

module.exports = backend === 'pg' ? require('./pg') : require('./mssql');
