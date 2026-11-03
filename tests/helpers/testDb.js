// tests/helpers/testDb.js
// Direct database access for the regression suite's fixtures (rows the API cannot plant or remove), on the database the
// suite runs against: STORAGE_BACKEND=sql -> SQL Server, pg -> PostgreSQL (v2.61.0). It uses the storage's own dialect runner
// and pool (server/db/dialects), so the SQL here is written once for both: named @params, ONE statement per call, no N''
// literals, booleans as db.sql.TRUE / db.sql.FALSE. Only for SQL backends - call isDbBackend() first.
const isDbBackend = backend => backend === 'sql' || backend === 'pg';

function dialect() {
  return require('../../server/db/dialects');
}

module.exports = {
  isDbBackend,
  // rows of one statement
  query: async (text, params = {}) => (await dialect().query(text, params)).rows,
  // rows changed by one INSERT / UPDATE / DELETE
  rowCount: (text, params = {}) => dialect().rowCount(text, params),
  tableExists: table => dialect().tableExists(table),
  dropTableIfExists: table => dialect().dropTableIfExists(table),
  get sql() { return dialect().sql; },
  get name() { return dialect().name; }
};
