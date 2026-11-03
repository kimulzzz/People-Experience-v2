// server/db/dialects/mssql.js
// Microsoft SQL Server dialect of the SQL storage (STORAGE_BACKEND=sql, `mssql` driver). sqlStorage.js holds the one shared
// code path; everything that differs between SQL Server and PostgreSQL (driver, placeholders, transactions, bulk insert,
// catalog checks and the few SQL constructs that are spelled differently) lives here and in pg.js with the same contract.
// SQL text keeps named parameters (@name) - this driver binds them natively.
const fs = require('fs');
const path = require('path');
const sql = require('mssql');

const name = 'sql';
const label = 'MS SQL Server';

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

async function close() {
  if (poolPromise) { const pool = await poolPromise; poolPromise = null; await pool.close(); }
}

// Server + database the configuration snapshot belongs to (sqlStorage.snapshotConfiguration / checkConfigSnapshot).
function identity() {
  const cfg = connectionConfig();
  return { server: cfg.server, database: cfg.database };
}

// ------------------------------------------------------------------ typed parameters & query runner
// typed(kind, v): a parameter whose type inference is not enough (kind: date | max | decimal_18_4 | decimal_18_8 | int).
const TYPES = {
  date: () => sql.VarChar(10),                 // 'YYYY-MM-DD' -> implicit DATE conversion
  max: () => sql.NVarChar(sql.MAX),
  decimal_18_4: () => sql.Decimal(18, 4),
  decimal_18_8: () => sql.Decimal(18, 8),
  int: () => sql.Int
};
const typed = (kind, v) => ({ __t: TYPES[kind](), v });

function bindParams(request, params) {
  for (const [k, v] of Object.entries(params || {})) {
    if (v && typeof v === 'object' && v.__t) request.input(k, v.__t, v.v);
    else if (v === null || v === undefined) request.input(k, sql.NVarChar(sql.MAX), null);
    else if (typeof v === 'boolean') request.input(k, sql.Bit, v);
    else if (typeof v === 'number') request.input(k, Number.isInteger(v) ? sql.Int : sql.Float, v);
    else if (v instanceof Date) request.input(k, sql.DateTime2(3), v);
    else request.input(k, sql.NVarChar(sql.MAX), String(v));
  }
  return request;
}

// Runs a parameterized query on the pool, or inside a transaction when `tx` is given. -> { rows }
// (rows changed: use rowCount() - the driver's rowsAffected is 0 on a server whose `user options` set NOCOUNT ON)
async function query(text, params, tx) {
  const request = tx ? new sql.Request(tx) : (await getPool()).request();
  bindParams(request, params);
  const result = await request.query(text);
  return { rows: result.recordset || [] };
}

// Rows changed by ONE INSERT / UPDATE / DELETE: @@ROWCOUNT in the same batch (correct whatever SET NOCOUNT says).
async function rowCount(text, params, tx) {
  const rows = (await query(`${text};\nSELECT @@ROWCOUNT AS n;`, params, tx)).rows;
  return rows.length ? rows[0].n : 0;
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

const errorNumber = err => err && (err.number || (err.originalError && err.originalError.info && err.originalError.info.number));
const isUniqueViolation = err => { const n = errorNumber(err); return n === 2627 || n === 2601; };
const isDeadlock = err => errorNumber(err) === 1205;

// ------------------------------------------------------------------ SQL fragments (same names in pg.js)
const sqlText = {
  now: 'SYSUTCDATETIME()',
  TRUE: '1',
  FALSE: '0',
  top: n => `TOP ${n}`,                         // SELECT ${top(1)} ... / TOP (@limit)
  limit: () => '',                              // ... ORDER BY x ${limit(1)}
  dateStr: expr => `CONVERT(char(10), ${expr}, 23)`,   // DATE -> 'YYYY-MM-DD'
  year: expr => `YEAR(${expr})`,
  month: expr => `MONTH(${expr})`,
  dateFromParts: (y, m, d) => `DATEFROMPARTS(${y}, ${m}, ${d})`,
  len: expr => `LEN(${expr})`,
  bin: expr => `${expr} COLLATE Latin1_General_100_BIN2`,  // exact (case-sensitive) comparison / grouping
  nullText: 'CAST(NULL AS NVARCHAR(200))',
  lockHint: 'WITH (UPDLOCK, HOLDLOCK)',        // table hint: hold an update lock on what is read until the transaction ends
  forUpdate: '',
  outInserted: cols => `OUTPUT ${cols.split(',').map(c => `INSERTED.${c.trim()}`).join(', ')}`,
  outDeleted: cols => `OUTPUT ${cols.split(',').map(c => `DELETED.${c.trim()}`).join(', ')}`,
  returning: () => '',
  quoteId: id => `[${id}]`
};

// pg needs an explicit table lock where SQL Server uses the UPDLOCK/HOLDLOCK hint (SELECT MAX(id) ... before an insert).
async function lockTable() { /* SQL Server: the lockHint on the SELECT does it */ }

// INSERT or UPDATE one row by its key. spec = { table, key: { col: param }, cols: { col: param }, update: { col: expr } (default
// cols), keyCast: { col: { mssql: 'DATE' } } (typed key in USING), holdlock: true -> MERGE ... WITH (HOLDLOCK) (only where the
// statement had that hint before v2.61.0: exit interviews, social media stats), action: true -> rows[0].act = 'INSERT' | 'UPDATE' }.
// Params are named (@x).
function upsert({ table, key, cols, update, keyCast = {}, holdlock = false, action = false }) {
  const keyCols = Object.keys(key);
  const using = keyCols.map(c => `${keyCast[c] ? `CAST(${key[c]} AS ${keyCast[c].mssql})` : key[c]} AS ${c}`).join(', ');
  const on = keyCols.map(c => `t.${c} = s.${c}`).join(' AND ');
  const set = Object.entries(update || cols).map(([c, v]) => `${c} = ${v}`).join(', ');
  const ins = { ...key, ...cols };
  return `MERGE dbo.${table}${holdlock ? ' WITH (HOLDLOCK)' : ''} AS t
            USING (SELECT ${using}) AS s ON ${on}
          WHEN MATCHED THEN UPDATE SET ${set}
          WHEN NOT MATCHED THEN INSERT (${Object.keys(ins).join(', ')}) VALUES (${Object.values(ins).join(', ')})${action ? '\n          OUTPUT $action AS act' : ''};`;
}

// An INSERT that sets an identity column explicitly (import / restore keep the original ids).
async function insertWithIdentity(tx, table, text, params) {
  return query(`SET IDENTITY_INSERT dbo.${table} ON;
                 ${text};
                 SET IDENTITY_INSERT dbo.${table} OFF;`, params, tx);
}
// After explicit-id inserts: SQL Server moves the identity seed on by itself.
async function syncIdentities() { /* nothing to do */ }

// ------------------------------------------------------------------ bulk insert
// columns: [{ name, type: 'nvarchar' | 'varchar' | 'max' | 'int' | 'float' | 'date' | 'datetime', len, nullable }]
// rows: arrays in column order; a 'date' value is 'YYYY-MM-DD'. Rows are inserted in the given order (identity follows it).
function bulkType(c) {
  switch (c.type) {
    case 'nvarchar': return sql.NVarChar(c.len);
    case 'varchar': return sql.VarChar(c.len);
    case 'max': return sql.NVarChar(sql.MAX);
    case 'int': return sql.Int;
    case 'float': return sql.Float;
    case 'date': return sql.Date;
    case 'datetime': return sql.DateTime2(3);
    default: throw new Error(`bulkInsert: unknown column type ${c.type}`);
  }
}
async function bulkInsert(tx, tableName, columns, rows) {
  if (!rows.length) return;
  const table = new sql.Table(`dbo.${tableName}`);
  table.create = false;
  columns.forEach(c => table.columns.add(c.name, bulkType(c), { nullable: !!c.nullable }));
  rows.forEach(r => table.rows.add(...r.map((v, i) => (columns[i].type === 'date' && typeof v === 'string' ? new Date(`${v}T00:00:00Z`) : v))));
  await new sql.Request(tx).bulk(table);
}

// ------------------------------------------------------------------ schema & catalog
async function applySchema() {
  const text = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  const batches = text.split(/^\s*GO\s*$/gim).map(b => b.trim()).filter(Boolean);
  const pool = await getPool();
  for (const batch of batches) await pool.request().batch(batch);
}

async function tableExists(table) {
  return !!(await query(`SELECT OBJECT_ID(N'dbo.${table}', N'U') AS id`)).rows[0].id;
}
async function columnExists(table, column) {
  return (await query(`SELECT COL_LENGTH(N'dbo.${table}', N'${column}') AS c`)).rows[0].c !== null;
}
async function dropTableIfExists(table, { onlyIfEmpty = false } = {}) {
  await query(`IF OBJECT_ID(N'dbo.${table}', N'U') IS NOT NULL${onlyIfEmpty ? ` AND NOT EXISTS (SELECT 1 FROM dbo.${table})` : ''} DROP TABLE dbo.${table}`);
}

// { server, database, edition, version } of the connected server
async function serverInfo() {
  const r = (await query(`SELECT @@SERVERNAME AS server, DB_NAME() AS db,
                                 CONVERT(nvarchar(200), SERVERPROPERTY('Edition')) AS edition,
                                 CONVERT(nvarchar(50), SERVERPROPERTY('ProductVersion')) AS version`)).rows[0];
  return { server: r.server, database: r.db, edition: r.edition, version: r.version };
}

// ------------------------------------------------------------------ configuration snapshot (raw rows of a table)
async function tableColumns(tx, table) {
  return (await query(`SELECT c.name, t.name AS type_name, c.max_length, c.precision, c.scale, c.is_identity
              FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
              WHERE c.object_id = OBJECT_ID(@t) AND c.is_computed = 0 ORDER BY c.column_id`, { t: `dbo.${table}` }, tx)).rows;
}

function configSqlType(c) {
  const len = c.max_length === -1 ? sql.MAX : null;
  switch (c.type_name) {
    case 'int': return sql.Int;
    case 'bigint': return sql.BigInt;
    case 'smallint': return sql.SmallInt;
    case 'tinyint': return sql.TinyInt;
    case 'bit': return sql.Bit;
    case 'float': return sql.Float;
    case 'real': return sql.Real;
    case 'decimal': case 'numeric': return sql.Decimal(c.precision, c.scale);
    case 'date': return sql.Date;
    case 'datetime2': return sql.DateTime2(c.scale);
    case 'datetime': return sql.DateTime;
    case 'varchar': return sql.VarChar(len || c.max_length);
    case 'char': return sql.Char(c.max_length);
    case 'nchar': return sql.NChar(c.max_length / 2);
    default: return sql.NVarChar(len || Math.max(1, c.max_length / 2));
  }
}

// Inserts rows (arrays in the order of `cols`, columns from tableColumns) keeping identity values (IDENTITY_INSERT when the
// table has an identity column).
async function insertRawRows(tx, table, cols, rows, identity) {
  const text = `${identity ? `SET IDENTITY_INSERT dbo.${table} ON; ` : ''}INSERT INTO dbo.${table} (${cols.map(c => `[${c.name}]`).join(', ')})
                    VALUES (${cols.map((c, i) => `@p${i}`).join(', ')});${identity ? ` SET IDENTITY_INSERT dbo.${table} OFF;` : ''}`;
  for (const row of rows) {
    const request = new sql.Request(tx);
    cols.forEach((c, i) => request.input(`p${i}`, configSqlType(c), row[i]));
    await request.query(text);
  }
}

module.exports = {
  name, label, connectionConfig, getPool, close, identity, typed, query, rowCount, inTransaction, isUniqueViolation, isDeadlock,
  sql: sqlText, lockTable, upsert, insertWithIdentity, syncIdentities, bulkInsert, applySchema, tableExists, columnExists,
  dropTableIfExists, serverInfo, tableColumns, insertRawRows
};
