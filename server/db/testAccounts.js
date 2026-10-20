// server/db/testAccounts.js
// Test-run accounts and the audit trail (v2.43.0). The regression suite and QC/verification scripts create
// temporary accounts; their activity is still written to the audit trail (nothing is ever deleted) but the
// rows are MARKED (px_audit_log.is_test) so the Audit Trail hides them by default.
//
// Going forward an account is a test account only through px_users.is_test_account, which is set by
// server-side code (storage.createUser({ ..., is_test_account: true })) or inherited from a test admin that
// creates it through the API - never from client input. The name patterns below are used ONLY by the
// one-time marking of audit rows written before v2.43.0, and only for accounts that no longer exist.
const STAMP_MIN = Date.UTC(2026, 0, 1);

// `Date.now().toString(36)` stamp (8 chars) of a plausible moment: 2026-01-01 .. tomorrow.
function isTestStamp(s) {
  if (!/^[0-9a-z]{8}$/.test(s)) return false;
  const t = parseInt(s, 36);
  return t >= STAMP_MIN && t <= Date.now() + 24 * 3600 * 1000;
}

// Username templates used by tests/regressionTest.js (`rt-suite-<stamp>`, `rt37admin<stamp>`, `rt<suffix><stamp>`,
// `rtadm<stamp>`, `rt44-<stamp>` ...) and by QC/verification scripts (`qc-*`, `verify-*`).
function isTestUsernamePattern(username) {
  const n = String(username || '').toLowerCase();
  if (!n) return false;
  if (/^(rt-suite-|qc-|verify-)/.test(n)) return true;
  return /^rt[a-z0-9-]*$/.test(n) && n.length >= 10 && isTestStamp(n.slice(-8));
}

// Account name at the start of an audit `target` ("name (ROLE) scope: ...", "name: fields", "name").
function auditTargetUsername(target) {
  const m = /^([A-Za-z0-9._-]{3,50})(?=$|:| \()/.exec(String(target || ''));
  return m ? m[1] : null;
}

// Should an audit row written before v2.43.0 be marked as test-run? `accounts` = Map(lower-case username ->
// is_test_account) of the accounts that exist now. Rows of an existing non-test account (e.g. `admin`) are never
// marked; failed logins for unknown usernames (no actor, no account name) stay visible.
function isHistoricalTestRow(row, accounts) {
  const actor = row.username ? String(row.username).toLowerCase() : null;
  if (actor && accounts.has(actor)) return accounts.get(actor) === true;
  if (actor && isTestUsernamePattern(actor)) return true;
  const subject = auditTargetUsername(row.target);
  if (!subject) return false;
  const key = subject.toLowerCase();
  return accounts.has(key) ? accounts.get(key) === true : isTestUsernamePattern(key);
}

module.exports = { isTestUsernamePattern, auditTargetUsername, isHistoricalTestRow };
