// server/db/directoryNames.js
// v2.51.0: the directorate master is managed by the Admin (Admin Parameters -> Directorates): add, rename, delete and
// merge directorates; add, rename and delete divisions. A directorate / division NAME (not an id) is copied into many
// tables, so every change cascades by name. Shared by sqlStorage + jsonStorage + the import services so the rules can
// never drift between the two backends:
//  - name validation (trimmed, single spaces, at most NAME_MAX_LENGTH = the NVARCHAR(200) of every column a name is
//    copied into, reserved filter / report values refused, unique case-insensitive)
//  - the name resolver: a name from an import / seed row -> the CURRENT directorate (its own name, a former name kept
//    as an alias at a rename / merge, or the v2.51.0 seed rename knowledge below), chains included
//  - the rewrites of login scopes, directorate option lists and ESS rows for a rename / merge / division rename
//  - the usage summary (how much data references each directorate / division) for the Admin list and the delete rule
const { normalizeScopes } = require('./scopeUtils');

const NAME_MAX_LENGTH = 200;
// Names are compared and stored in Unicode NFC (so "Café" typed as e + combining accent equals the precomposed one) with
// every run of white space - incl. non-breaking / ideographic / other odd spaces - turned into ONE ordinary space.
const cleanName = v => (typeof v === 'string' ? v.normalize('NFC').replace(/\s+/g, ' ').trim() : '');
const nameKey = v => cleanName(v).toLowerCase();

// Values the code uses as filter / report sentinels: "ALL" (no filter), "General" (default org unit of a row without
// one), "Bankwide" / "PT Bank CIMB Niaga ..." (the ESS / Exit Interview bankwide row), "-" (an empty division cell).
const RESERVED_DIRECTORATE_NAMES = ['ALL', 'Bankwide', 'General', '-'];
const RESERVED_DIVISION_NAMES = ['ALL', 'General', '-'];
const BANKWIDE_PATTERN = /^pt\.?\s*bank\s+cimb\s+niaga/i;

// v2.51.0 renames of the seed directory (fresh installs use the new names). An existing database keeps its names until
// the Admin renames them in the menu; until then the resolver maps either spelling to whichever one the database has, so
// seed rows / import files with the other spelling still land on the right directorate.
const SEED_DIRECTORATE_RENAMES = [
  { from: 'Sharia Banking', to: 'Syariah Banking' },
  { from: 'Special Asset', to: 'SLC ASG Satyaguna Langgeng Capital' },
  { from: 'SLC', to: 'SLC ASG Satyaguna Langgeng Capital' },   // the user chose the full name (2026-10-21); 'SLC' stays a recognised spelling
  { from: 'Strategy, Finance & SPAPM', to: 'Strategy & Finance' },
  { from: 'Treasury & Capital Market', to: 'Treasury & Financial Institutions' }
];

// The newest seed spelling of a name (follows SEED_DIRECTORATE_RENAMES), e.g. 'Special Asset' -> 'SLC ASG Satyaguna Langgeng Capital'.
function currentSeedName(name) {
  let out = name;
  const seen = new Set();
  for (;;) {
    const r = SEED_DIRECTORATE_RENAMES.find(x => nameKey(x.from) === nameKey(out));
    if (!r || seen.has(nameKey(r.to))) return out;
    seen.add(nameKey(r.to));
    out = r.to;
  }
}

// Is `name` the same seed directorate as `seedName` (same name, or linked by a seed rename either way)?
function seedNamesMatch(seedName, name) {
  return nameKey(currentSeedName(seedName)) === nameKey(currentSeedName(name));
}

// v2.51.0: every list of directorates is alphabetical (locale-aware, case-insensitive - "SLC ..." before "Syariah ..."), and
// the divisions of each directorate too; the master's ids / insertion order are not shown anywhere. Ties keep their order.
const compareNames = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' });
// [{ directorate_name | name, divisions | sub_directorates }] -> a new, sorted list (entries copied, divisions sorted copies)
function sortDirectory(list) {
  return (list || []).map(d => {
    const divisions = [...(d.divisions || d.sub_directorates || [])].sort(compareNames);
    return { ...d, divisions, ...(d.sub_directorates ? { sub_directorates: divisions } : {}) };
  }).sort((a, b) => compareNames(a.directorate_name || a.name, b.directorate_name || b.name));
}

// A directorate id from a URL or a request body: a positive whole number (number) or its exact digit string - no blanks,
// signs, leading zeros or decimals (" 853" or "853 " must never address directorate 853). Anything else -> null.
function parseDirectoryId(v) {
  if (typeof v === 'number') return Number.isSafeInteger(v) && v > 0 ? v : null;
  if (typeof v === 'string' && /^[1-9]\d{0,9}$/.test(v)) return parseInt(v, 10);
  return null;
}

// ------------------------------------------------------------------ validation
function checkName(raw, kind, reserved) {
  if (typeof raw !== 'string' || !cleanName(raw)) return { error: `The ${kind} name is required.` };
  // invisible format characters (zero-width space / joiner, BOM, bidi controls ...) would make two names look identical
  if (/\p{Cf}/u.test(raw.normalize('NFC'))) return { error: `The ${kind} name contains invisible characters (zero-width, byte-order or text-direction marks).` };
  const name = cleanName(raw);
  if (/[\u0000-\u001f\u007f]/.test(name)) return { error: `The ${kind} name contains control characters.` };
  // "." / ".." would be resolved away as path segments in a URL
  if (/^\.+$/.test(name)) return { error: `A ${kind} name cannot consist of dots only.` };
  if (name.length > NAME_MAX_LENGTH) return { error: `The ${kind} name may be at most ${NAME_MAX_LENGTH} characters (it has ${name.length}).` };
  if (reserved.some(r => nameKey(r) === nameKey(name))) return { error: `"${name}" is a reserved value and cannot be used as a ${kind} name.` };
  return { name };
}

// directory: [{ directorate_name, divisions }]; self = the current name of the directorate being renamed (it may keep
// its own name in another letter case). Returns { name } or { error }.
function validateDirectorateName(raw, directory, self = null) {
  const v = checkName(raw, 'directorate', RESERVED_DIRECTORATE_NAMES);
  if (v.error) return v;
  if (BANKWIDE_PATTERN.test(v.name)) return { error: 'A directorate name may not start with "PT Bank CIMB Niaga" (that row is the Bankwide result in the ESS / Exit Interview files).' };
  const clash = (directory || []).find(d => nameKey(d.directorate_name || d.name) === nameKey(v.name) && nameKey(d.directorate_name || d.name) !== nameKey(self));
  if (clash) return { error: `A directorate named "${clash.directorate_name || clash.name}" already exists.` };
  return v;
}

// divisions: the division names of the directorate; self = the division being renamed.
function validateDivisionName(raw, divisions, self = null) {
  const v = checkName(raw, 'division', RESERVED_DIVISION_NAMES);
  if (v.error) return v;
  const clash = (divisions || []).find(d => nameKey(d) === nameKey(v.name) && nameKey(d) !== nameKey(self));
  if (clash) return { error: `This directorate already has a division named "${clash}".` };
  return v;
}

// A former / alternative name the Admin adds by hand (v2.51.0, e.g. "Consumer & Emerging Business Banking" for "Consumer &
// EBB" as the ESS files spell it): the same name rules as a directorate name, never a live directorate (400) and never a
// former name that is already recorded (409 - of this directorate or of another one). Returns { name } or { error, status }.
function validateDirectorateAlias(raw, directory, aliases, selfName) {
  const v = validateDirectorateName(raw, directory);
  if (v.error) return { error: v.error.replace(/^A directorate named (".*") already exists\.$/, 'A former name may not be the name of a directorate ($1 is one).'), status: 400 };
  const taken = ((aliases && aliases.directorates) || []).find(a => nameKey(a.alias_name) === nameKey(v.name));
  if (taken) {
    return nameKey(taken.directorate_name) === nameKey(selfName)
      ? { error: `"${taken.alias_name}" is already a former name of "${taken.directorate_name}".`, status: 409 }
      : { error: `"${taken.alias_name}" is already a former name of another directorate ("${taken.directorate_name}"). Remove it there first.`, status: 409 };
  }
  return v;
}

// The same for a division of directorate `dirName`: never one of its live divisions (400), never a former division name it
// already has (409).
function validateDivisionAlias(raw, dirName, divisions, aliases) {
  const v = validateDivisionName(raw, divisions);
  if (v.error) return { error: v.error.replace(/^This directorate already has a division named (".*")\.$/, 'A former division name may not be the name of a division of this directorate ($1 is one).'), status: 400 };
  const taken = ((aliases && aliases.divisions) || []).find(a => nameKey(a.directorate_name) === nameKey(dirName) && nameKey(a.alias_name) === nameKey(v.name));
  if (taken) return { error: `"${taken.alias_name}" is already a former division name in ${taken.directorate_name} (of "${taken.division_name}").`, status: 409 };
  return v;
}

// ------------------------------------------------------------------ resolver
/**
 * directory: [{ directorate_name, divisions }] (the master); aliases: { directorates: [{ alias_name, directorate_name }],
 * divisions: [{ directorate_name, alias_name, division_name }] } (former names, always pointing at a CURRENT name).
 * Returns { directorate(name), division(directorate, division), isCurrent(name) } - both lookups answer the current
 * name (master spelling) or null when the name is unknown.
 */
function buildResolver(directory, aliases) {
  const current = new Map();
  const divisionsOf = new Map();
  (directory || []).forEach(d => {
    const n = d.directorate_name || d.name;
    current.set(nameKey(n), n);
    divisionsOf.set(nameKey(n), new Map((d.divisions || d.sub_directorates || []).map(v => [nameKey(v), v])));
  });
  const dirAlias = new Map(((aliases && aliases.directorates) || []).map(a => [nameKey(a.alias_name), a.directorate_name]));
  const divAlias = new Map(((aliases && aliases.divisions) || []).map(a => [`${nameKey(a.directorate_name)}|${nameKey(a.alias_name)}`, a.division_name]));
  const direct = k => current.get(k) || (dirAlias.has(k) ? current.get(nameKey(dirAlias.get(k))) || null : null);

  function directorate(name) {
    const k = nameKey(name);
    if (!k) return null;
    const hit = direct(k);
    if (hit) return hit;
    // seed rename knowledge: an older seed spelling forward, then a newer one backward (the database may not be renamed yet)
    const seen = new Set([k]);
    const queue = [k];
    while (queue.length) {
      const c = queue.shift();
      for (const r of SEED_DIRECTORATE_RENAMES) {
        const next = nameKey(r.from) === c ? nameKey(r.to) : (nameKey(r.to) === c ? nameKey(r.from) : null);
        if (!next || seen.has(next)) continue;
        const h = direct(next);
        if (h) return h;
        seen.add(next);
        queue.push(next);
      }
    }
    return null;
  }

  function division(directorateName, divisionName) {
    const dir = directorate(directorateName);
    const k = nameKey(divisionName);
    if (!dir || !k) return null;
    const list = divisionsOf.get(nameKey(dir)) || new Map();
    if (list.has(k)) return list.get(k);
    const a = divAlias.get(`${nameKey(dir)}|${k}`);
    return a && list.has(nameKey(a)) ? list.get(nameKey(a)) : null;
  }

  return { directorate, division, isCurrent: name => current.has(nameKey(name)) };
}

// The resolver of the active storage backend (imports / routes): storage.getDirectorates() + storage.getDirectoryAliases().
async function loadResolver(storage) {
  return buildResolver(await storage.getDirectorates(), await storage.getDirectoryAliases());
}

// ------------------------------------------------------------------ rewrites
// A login's scope list after directorate `from` was renamed to `to` (null = unchanged).
function renameScopeDirectorate(scopes, from, to) {
  const before = normalizeScopes(scopes);
  if (!before.some(s => nameKey(s.directorate) === nameKey(from))) return null;
  return normalizeScopes(before.map(s => (nameKey(s.directorate) === nameKey(from) ? { ...s, directorate: to } : s)));
}

// A login's scope list after directorate `source` was merged into `target` (null = unchanged). "All divisions" of the
// source becomes "all divisions" of the target (the account now also reads the target's own data - the merge preview
// lists these accounts); a list of source divisions stays that list under the target (renamed to the target's spelling
// via divisionMap). Never empty, never a placeholder division.
function mergeScopeDirectorate(scopes, source, target, divisionMap = {}) {
  const before = normalizeScopes(scopes);
  if (!before.some(s => nameKey(s.directorate) === nameKey(source))) return null;
  const mapDiv = d => divisionMap[nameKey(d)] || d;
  return normalizeScopes(before.map(s => (nameKey(s.directorate) !== nameKey(source) ? s
    : { directorate: target, divisions: s.divisions === null ? null : s.divisions.map(mapDiv) })));
}

// The accounts a merge of `source` into `target` changes: users = [{ user_id, username, full_name, scopes, is_test_account }].
// widened = the account had ALL divisions of the source and now reads all of the target.
function mergeScopeChanges(users, source, target, divisionMap = {}) {
  const out = [];
  (users || []).forEach(u => {
    const before = normalizeScopes(u.scopes);
    const after = mergeScopeDirectorate(before, source, target, divisionMap);
    if (!after) return;
    const own = before.find(s => nameKey(s.directorate) === nameKey(source));
    out.push({ user_id: u.user_id, username: u.username, full_name: u.full_name, is_test_account: u.is_test_account === true,
      before, after, widened: !!own && own.divisions === null });
  });
  return out;
}

// A login's scope list after division `from` of directorate `dir` was renamed to `to` (null = unchanged).
function renameScopeDivision(scopes, dir, from, to) {
  const before = normalizeScopes(scopes);
  let changed = false;
  const next = before.map(s => {
    if (nameKey(s.directorate) !== nameKey(dir) || s.divisions === null) return s;
    if (!s.divisions.some(d => nameKey(d) === nameKey(from))) return s;
    changed = true;
    return { ...s, divisions: s.divisions.map(d => (nameKey(d) === nameKey(from) ? to : d)) };
  });
  return changed ? normalizeScopes(next) : null;
}

// A rewritten scope list only when it really differs from the old one (a re-spelling to the same text is no change).
function respelledScopes(before, next) {
  return next && JSON.stringify(next) !== JSON.stringify(normalizeScopes(before)) ? next : null;
}

const optionValue = o => (o && typeof o === 'object' ? o.value : o);

// An option list [{ value, label }] holding directorate names (e.g. event_manager_directorates) after directorate `from`
// became `to` (rename or merge target; a label equal to the old name follows) - null when unchanged. Duplicates dropped.
function renameDirectorateOption(options, from, to) {
  if (!Array.isArray(options) || !options.some(o => nameKey(optionValue(o)) === nameKey(from))) return null;
  const out = [];
  options.forEach(opt => {
    let next = opt;
    if (nameKey(optionValue(opt)) === nameKey(from)) {
      next = opt && typeof opt === 'object' ? { ...opt, value: to, label: nameKey(opt.label) === nameKey(from) ? to : opt.label } : to;
    }
    if (out.some(o => nameKey(optionValue(o)) === nameKey(optionValue(next)))) return;
    out.push(next);
  });
  return out;
}

// How many entries of an option list name this directorate.
const optionMentions = (options, name) => (Array.isArray(options) ? options.filter(o => nameKey(optionValue(o)) === nameKey(name)).length : 0);

// Two ESS result rows of the same metric + period for one directorate (after a merge) -> one row: index and question
// scores weighted by participation (equal weights when no participation is known), participation added up.
function poolEssResults(rows) {
  const totalPart = rows.reduce((s, r) => s + (parseInt(r.participation, 10) || 0), 0);
  const weightOf = r => (totalPart > 0 ? (parseInt(r.participation, 10) || 0) : 1);
  const totalWeight = rows.reduce((s, r) => s + weightOf(r), 0);
  const round4 = v => Math.round(v * 10000) / 10000;
  const index = totalWeight > 0 ? rows.reduce((s, r) => s + Number(r.index_score) * weightOf(r), 0) / totalWeight : 0;
  const count = rows.reduce((mx, r) => Math.max(mx, (r.questions || []).length), 0);
  const questions = Array.from({ length: count }, (_, i) => {
    let sum = 0;
    let w = 0;
    let first = null;
    rows.forEach(r => {
      const q = (r.questions || [])[i];
      if (q && !first) first = q;
      if (q && q.score !== null && q.score !== undefined) { sum += Number(q.score) * weightOf(r); w += weightOf(r); }
    });
    return { ...(first || {}), score: w > 0 ? round4(sum / w) : null };
  });
  return { index_score: round4(index), participation: totalPart, questions };
}

// Seed ESS rows mapped through the resolver before they are inserted: a directorate that no longer resolves is dropped,
// two seed rows that now resolve to the same directorate (a merge) are pooled.
function mapEssSeedRows(rows, resolver) {
  const out = [];
  const byKey = new Map();
  rows.forEach(r => {
    if (r.org_level === 'BANKWIDE') { out.push(r); return; }
    const dir = resolver.directorate(r.directorate);
    if (!dir) return;
    const k = `${r.upload_id}|${r.metric_id}|${r.survey_year}|${r.survey_month}|${nameKey(dir)}`;
    if (!byKey.has(k)) { const e = { ...r, directorate: dir, __rows: [r] }; byKey.set(k, e); out.push(e); } else byKey.get(k).__rows.push(r);
  });
  return out.map(r => {
    if (!r.__rows) return r;
    const { __rows, ...rest } = r;
    return __rows.length === 1 ? rest : { ...rest, ...poolEssResults(__rows) };
  });
}

// Data rows of directorate `dirName` whose division is `division` (not a live division: an alias being added) - counts
// per source, or null when none (usageRows as in orphanUsage; sources without a division never match).
function divisionOrphanUsage(usageRows, dirName, division) {
  const counts = {};
  (usageRows || []).forEach(r => {
    if (r.division === null || r.division === undefined || nameKey(r.directorate) !== nameKey(dirName) || nameKey(r.division) !== nameKey(division)) return;
    counts[r.source] = (counts[r.source] || 0) + r.n;
  });
  return Object.keys(counts).length ? counts : null;
}

// ------------------------------------------------------------------ usage summary
// Data rows that already carry `name` although it is not a directorate of the master (orphans): a create / rename to
// that name would adopt (and for ESS pool) them, so the Admin has to confirm. Counts per source, or null when none.
function orphanUsage(usageRows, name) {
  const counts = {};
  (usageRows || []).forEach(r => {
    if (nameKey(r.directorate) !== nameKey(name)) return;
    counts[r.source] = (counts[r.source] || 0) + r.n;
  });
  return Object.keys(counts).length ? counts : null;
}

const DIRECTORATE_USAGE_KEYS = ['survey_responses', 'ess_results', 'exit_interviews', 'attendances', 'user_scopes', 'users', 'operational_records', 'settings'];
const DIVISION_USAGE_KEYS = ['survey_responses', 'exit_interviews', 'attendances', 'user_scopes', 'users'];
const zero = keys => Object.fromEntries(keys.map(k => [k, 0]));
const sum = o => Object.values(o).reduce((a, b) => a + b, 0);

/**
 * directory: [{ directorate_id, directorate_name, divisions }]; usageRows: [{ source, directorate, division, n }] where
 * source is one of DIRECTORATE_USAGE_KEYS (each backend builds them from its own data; names compared case-insensitively);
 * aliases as in buildResolver. Returns the Admin list: per directorate the usage counts, total, divisions with their own
 * counts and the former names.
 */
function summarizeUsage(directory, usageRows, aliases) {
  const list = (directory || []).map(d => ({
    directorate_id: d.directorate_id,
    name: d.directorate_name || d.name,
    usage: zero(DIRECTORATE_USAGE_KEYS),
    divisions: (d.divisions || []).map(v => ({ name: v, usage: zero(DIVISION_USAGE_KEYS) }))
  }));
  const byKey = new Map(list.map(d => [nameKey(d.name), d]));
  (usageRows || []).forEach(r => {
    const d = byKey.get(nameKey(r.directorate));
    if (!d || !Object.prototype.hasOwnProperty.call(d.usage, r.source)) return;
    d.usage[r.source] += r.n;
    if (r.division === null || r.division === undefined || !DIVISION_USAGE_KEYS.includes(r.source)) return;
    const v = d.divisions.find(x => nameKey(x.name) === nameKey(r.division));
    if (v) v.usage[r.source] += r.n;
  });
  return list.map(d => ({
    ...d,
    total_references: sum(d.usage),
    divisions: d.divisions.map(v => ({ ...v, total_references: sum(v.usage) })),
    former_names: ((aliases && aliases.directorates) || []).filter(a => nameKey(a.directorate_name) === nameKey(d.name)).map(a => a.alias_name),
    former_division_names: ((aliases && aliases.divisions) || []).filter(a => nameKey(a.directorate_name) === nameKey(d.name))
      .map(a => ({ alias_name: a.alias_name, division_name: a.division_name }))
  }));
}

// Error with an HTTP status for the routes (400 validation, 404 unknown, 409 still referenced).
function directoryError(status, message, extra = {}) {
  const err = new Error(message);
  err.status = status;
  Object.assign(err, extra);
  return err;
}

module.exports = {
  NAME_MAX_LENGTH,
  RESERVED_DIRECTORATE_NAMES,
  RESERVED_DIVISION_NAMES,
  SEED_DIRECTORATE_RENAMES,
  DIRECTORATE_USAGE_KEYS,
  DIVISION_USAGE_KEYS,
  cleanName,
  nameKey,
  compareNames,
  sortDirectory,
  parseDirectoryId,
  mergeScopeChanges,
  orphanUsage,
  currentSeedName,
  seedNamesMatch,
  validateDirectorateName,
  validateDivisionName,
  validateDirectorateAlias,
  validateDivisionAlias,
  divisionOrphanUsage,
  respelledScopes,
  buildResolver,
  loadResolver,
  renameScopeDirectorate,
  mergeScopeDirectorate,
  renameScopeDivision,
  renameDirectorateOption,
  optionMentions,
  poolEssResults,
  mapEssSeedRows,
  summarizeUsage,
  directoryError
};
