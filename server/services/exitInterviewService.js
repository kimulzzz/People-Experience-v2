// server/services/exitInterviewService.js
// Exit Interview dashboard (v2.38.0): why employees resign. Data = the HR "Termination Report" .xlsx (one row per exit:
// NIK, name, effective resignation date, leaving reason + detail, grade, score factor and the exit questionnaire H..AG)
// plus a Directorate (and optional Division) column, uploaded by an Admin. This file holds the validation + import, the
// rule-based grouping of the answers (keyword tables from px_app_settings - no AI, everything stays on-premise), the
// dashboard aggregates, the .xlsx template and the CSV export. A USER only ever receives aggregates.
const fs = require('fs');
const path = require('path');
const storage = require('../db/storage');
const { periodWindow, CURRENT_YEAR } = require('../db/filterUtils');
const { rowInScopes } = require('../db/scopeUtils');
const { buildResolver } = require('../db/directoryNames');
const { initialAppSettings } = require('../db/seedData');
const { colLetter, readFirstSheet, buildXlsx } = require('./xlsxUtils');

// Original uploaded files are kept for the audit trail OUTSIDE server/uploads (which is served to every login).
const EXIT_UPLOAD_DIR = path.join(__dirname, '..', 'data', 'exit-uploads');

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// The 33 columns of the Termination Report, in file order (A..AG). The first seven are checked by name; the
// questionnaire columns are taken by position (their long question texts may be reworded).
const CAREER_STATEMENTS = [
  'Saya puas dengan karir saya selama bekerja di Bank CIMB Niaga',
  'Saya memiliki kesempatan yang adil di unit kerja saya untuk mendapatkan promosi berdasarkan kinerja',
  'Saya merasa difasilitasi dengan program pelatihan yang membantu pengembangan pribadi dan professional saya',
  'Saya dan rekan kerja lainnya diperlakukan secara adil oleh Atasan',
  'Saya mendapatkan perhatian atas kondisi personal dan kesejahteraan dari Atasan',
  'Saya dilibatkan oleh Atasan dalam pembuatan keputusan',
  'Atasan di unit kerja saya mendorong terciptanya kerjasama yang saling mendukung antar rekan kerja',
  'Penghargaan yang saya terima setara dengan kontribusi yang saya berikan',
  'Apresiasi yang diberikan di unit kerja saya mendorong kompetisi yang sehat antar rekan kerja',
  'Prosedur kerja yang ada membantu saya mengerjakan pekerjaan dengan lebih efisien',
  'Workload pekerjaan yang saya lakukan selama satu tahun terakhir dapat saya kelola dengan baik',
  'Saya nyaman bekerja dengan rekan-rekan di unit kerja saya',
  'Terdapat budaya saling bantu, percaya dan keterbukaan di unit kerja',
  'Goals, objective, dan standar kerja unit kerja saya tersampaikan dengan jelas',
  'Saya memiliki akses untuk mendapatkan informasi terkini mengenai issue yang muncul di unit kerja saya.'
];
const TEMPLATE_COLUMNS = [
  { key: 'nik', title: 'NIK', names: ['nik'] },
  { key: 'employee_name', title: 'EMP NAME', names: ['emp name', 'employee name', 'nama karyawan', 'nama'] },
  { key: 'effective_date', title: 'Effective Resignation Date', names: ['effective resignation date', 'effective date'] },
  { key: 'leaving_reason', title: 'LEAVING REASON', names: ['leaving reason'] },
  { key: 'leaving_reason_detail', title: 'LEAVING REASON DETAIL', names: ['leaving reason detail'] },
  { key: 'grade', title: 'Grade', names: ['grade'] },
  { key: 'score_factor', title: 'SCORE FACTOR', names: ['score factor'] },
  { key: 'destination_industry', title: 'Apakah Bapak/Ibu pindah ke Perusahaan bank/non-bank? Apabila berhenti karena pindah ke Perusahaan non-bank, mohon disebutkan nama bidang Perusahaannya' },
  { key: 'new_company', title: 'Sebutkan nama Perusahaan baru ?' },
  { key: 'new_position', title: 'Sebutkan nama posisi di Perusahaan baru ?' },
  { key: 'pull_factors', title: 'Apabila Anda berhenti karena pindah ke perusahaan lain, sebutkan komponen kompensasi dan benefit yang lebih menarik dari dari yang ditawarkan oleh CIMB Niaga? (Jawaban bisa lebih dari satu)' },
  { key: 'improve_factors', title: 'Apabila Anda berhenti karena bukan pindah ke perushaan lain, komponen atau benefit apa saja yang perlu ditingkatkan oleh CIMB Niaga? (Jawaban bisa lebih dari satu)' },
  { key: 'new_company_offers', title: 'Apabila Anda berhenti karena pindah ke perusahaan lain, sebutkan apa yang ditawarkan perusahaan tersebut yang tidak ditawarkan oleh CIMB Niaga? (Jawaban bisa lebih dari satu)' },
  { key: 'internal_factors', title: 'Selain alasan utama di atas, faktor internal apa yang memengaruhi keputusan Anda meninggalkan CIMB Niaga? (Harus diisi)' },
  ...CAREER_STATEMENTS.map((title, i) => ({ key: `score_${i + 1}`, title, score: i })),
  { key: 'alumni_network', title: 'Apakah Bapak/Ibu bersedia untuk bergabung ke dalam CIMB Niaga Alumni Network*?', yesNo: true },
  { key: 'privacy_consent', title: 'Saya telah membaca dan menyetujui Kebijakan Privasi dari CIMB Niaga', yesNo: true },
  { key: 'recommend', title: 'Apakah anda akan merekomendasikan Bank CIMB Niaga kepada orang lain?', yesNo: true },
  { key: 'suggestions', title: 'Berikan Saran atau Masukkan untuk Bank CIMB Niaga' }
];
const DIRECTORATE_HEADERS = ['directorate', 'direktorat'];
const DIVISION_HEADERS = ['division', 'divisi', 'sub directorate', 'sub-directorate', 'sub_directorate'];
const TEXT_LIMITS = { nik: 50, employee_name: 200, leaving_reason: 100, leaving_reason_detail: 100, grade: 20, score_factor: 20,
  destination_industry: 500, new_company: 500, new_position: 500 };
const LONG_TEXT_LIMIT = 4000;

// Logic-driving values of the exit form (domain constants, not admin data).
const VOLUNTARY_REASON = 'NORMAL_RESIGNATION';
const MOVER_DETAILS = ['MOVE_COMPANY', 'BETTER_OFFER'];
const FINANCIAL_INDUSTRY_OPTION = 'Perbankan / Asuransi / Keuangan Lainnya';
const CAREER_LABELS = ['Strongly disagree', 'Disagree', 'Slightly disagree', 'Slightly agree', 'Agree', 'Strongly agree'];
const PULL_FACTOR_ORDER = ['Compensation', 'Position', 'Job', 'Reputation', 'Other'];
const OTHER = 'Other';
const RULE_SETTING_KEYS = {
  kFactors: 'exit_interview_k_factors',
  mThemes: 'exit_interview_m_themes',
  nThemes: 'exit_interview_n_themes',
  aliases: 'exit_interview_company_aliases',
  noneAnswers: 'exit_interview_none_answers'
};

const round1 = v => Math.round(v * 10) / 10;
const pct = (n, base) => (base > 0 ? round1((n / base) * 100) : 0);
const monthLabel = ym => `${MONTH_NAMES[parseInt(ym.slice(5, 7), 10) - 1]} ${ym.slice(0, 4)}`;

// ------------------------------------------------------------------ answer normalisation + keyword rules
// lower case, every run of non letters/digits -> one space ("N/A" -> "n a", "Kompensasi & benefit" -> "kompensasi benefit")
const normalizeAnswer = text => String(text === null || text === undefined ? '' : text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
// keyword at the START of a word of the answer ("fleksib" matches "fleksibilitas", "bri" does not match "fabric")
const hasKeyword = (norm, keyword) => {
  const k = normalizeAnswer(keyword);
  return !!k && ` ${norm}`.includes(` ${k}`);
};

// Rules from px_app_settings (falls back to the seed default only when a key is missing from the database).
async function loadRules() {
  const settings = await storage.getSettings();
  const rules = {};
  Object.entries(RULE_SETTING_KEYS).forEach(([name, key]) => {
    const value = Array.isArray(settings[key]) ? settings[key] : ((initialAppSettings[key] || {}).value || []);
    rules[name] = value.filter(o => o && typeof o.value === 'string' && typeof o.label === 'string')
      .map(o => ({ keyword: o.value, label: o.label.trim() }))
      .sort((a, b) => normalizeAnswer(b.keyword).length - normalizeAnswer(a.keyword).length);
  });
  return rules;
}

// "-", blank and the configured "no answer" phrases (exact; "phrase*" = starts with the phrase).
function isNoneAnswer(text, rules) {
  const norm = normalizeAnswer(text);
  if (!norm) return true;
  return rules.noneAnswers.some(({ keyword }) => {
    const raw = String(keyword).trim();
    if (raw.endsWith('*')) {
      const p = normalizeAnswer(raw.slice(0, -1));
      return !!p && (norm === p || norm.startsWith(`${p} `));
    }
    return norm === normalizeAnswer(raw);
  });
}
const isAnswered = (text, rules) => text !== null && text !== undefined && !isNoneAnswer(text, rules);
const splitMulti = text => String(text || '').split('|').map(s => s.trim()).filter(Boolean);

// Groups one multi-select answer hits (a part that matches no keyword and is not a "no answer" counts as Other).
function groupsOf(text, table, rules) {
  const out = new Set();
  splitMulti(text).forEach(part => {
    if (isNoneAnswer(part, rules)) return;
    const norm = normalizeAnswer(part);
    const hits = table.filter(e => hasKeyword(norm, e.keyword)).map(e => e.label);
    if (hits.length) hits.forEach(h => out.add(h)); else out.add(OTHER);
  });
  return out;
}

// Standardized legal name of a new employer: the longest matching alias keyword, else the answer trimmed (spaces collapsed).
function standardizeCompany(name, rules) {
  if (!isAnswered(name, rules)) return null;
  const norm = normalizeAnswer(name);
  const hit = rules.aliases.find(e => hasKeyword(norm, e.keyword));
  return hit ? hit.label : String(name).replace(/\s+/g, ' ').trim();
}
const isKnownCompany = (stdName, rules) => rules.aliases.some(e => e.label === stdName);

const humanizeCode = code => {
  const s = String(code || '').toLowerCase().replace(/_/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Not specified';
};

// ------------------------------------------------------------------ parsing + validation
const cellAt = (row, idx) => (row && idx >= 0 && row.cells[idx]) || { value: null, type: 'empty', formulaWithoutValue: false };
const isBlank = c => !c || (c.type === 'empty' && !c.formulaWithoutValue);
const cellText = c => {
  if (isBlank(c) || c.value === null) return '';
  if (c.type === 'number' && Number.isInteger(c.value)) return String(c.value);
  return String(c.value).replace(/_x000D_/g, '').trim();
};
const canonical = name => String(name || '').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim().toLowerCase();
const headerText = c => canonical(cellText(c)).replace(/[*?:]+$/, '').trim();

function isoDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
// Excel serial (1900 date system) | 'YYYY-MM-DD' | 'dd/mm/yyyy' | 'dd-mm-yyyy' | 'dd.mm.yyyy' -> 'YYYY-MM-DD' | null
function parseDateCell(c) {
  if (c.type === 'number') {
    if (!(c.value >= 1 && c.value < 2958466)) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(c.value) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const text = cellText(c);
  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  if (m) return isoDate(+m[1], +m[2], +m[3]);
  m = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return isoDate(+m[3], +m[2], +m[1]);
  return null;
}
function parseScoreCell(c) {
  const text = cellText(c);
  if (isBlank(c) || text === '' || text === '-') return { value: null };
  const n = c.type === 'number' ? c.value : (/^\d+$/.test(text) ? parseInt(text, 10) : NaN);
  if (!Number.isInteger(n) || n < 1 || n > 6) return { error: `must be a whole number 1-6 or "-" (found "${text}")` };
  return { value: n };
}
function parseYesNo(c) {
  const text = cellText(c);
  if (text === '' || text === '-') return { value: null };
  if (/^(yes|ya|y)$/i.test(text)) return { value: 'Yes' };
  if (/^(no|tidak|n)$/i.test(text)) return { value: 'No' };
  return { error: `must be Yes or No (found "${text.slice(0, 40)}")` };
}
const codeOf = text => (text ? text.toUpperCase().replace(/[\s-]+/g, '_') : null);
const optionalText = (text, limit) => (text === '' || text === '-' ? null : text.slice(0, limit));

/**
 * Validates parsed sheet rows against the Termination Report layout and the directorate master.
 * options.assignOrgUnit(rowNumber) -> { directorate, division } is used when the sheet has no Directorate column
 * (the template import script); options.surrogateNik appends "-<row number>" to every NIK (masked NIKs collide).
 * Returns { errors: [{ row_number, column, reason }], rows }. Nothing is stored here; any error refuses the whole file.
 */
function validateExitSheet(sheetRows, directorates, options = {}) {
  const errors = [];
  const err = (row_number, column, reason) => errors.push({ row_number, column, reason });
  const header = sheetRows.slice(0, 30).find(r => r.cells.some(c => headerText(c) === 'nik'));
  if (!header) {
    err(null, null, 'No header row found: the header row must contain a cell "NIK" (see the template: title in row 1, column names in row 2).');
    return { errors, rows: [] };
  }
  const nikCol = header.cells.findIndex(c => headerText(c) === 'nik');
  let dirCol = -1;
  let divCol = -1;
  const standardCols = [];
  for (let i = nikCol; i < header.cells.length; i++) {
    const h = headerText(cellAt(header, i));
    if (DIRECTORATE_HEADERS.includes(h) && dirCol < 0) { dirCol = i; continue; }
    if (DIVISION_HEADERS.includes(h) && divCol < 0) { divCol = i; continue; }
    if (standardCols.length < TEMPLATE_COLUMNS.length) standardCols.push(i);
  }
  for (let i = 0; i < nikCol; i++) {
    const h = headerText(cellAt(header, i));
    if (DIRECTORATE_HEADERS.includes(h) && dirCol < 0) dirCol = i;
    else if (DIVISION_HEADERS.includes(h) && divCol < 0) divCol = i;
  }
  if (standardCols.length < TEMPLATE_COLUMNS.length) {
    err(header.row_number, null, `The header row has ${standardCols.length} of the ${TEMPLATE_COLUMNS.length} template columns (NIK ... suggestions). Download the template and keep its columns.`);
  }
  TEMPLATE_COLUMNS.forEach((col, i) => {
    if (!col.names || standardCols[i] === undefined) return;
    const h = headerText(cellAt(header, standardCols[i]));
    if (!col.names.includes(h)) err(header.row_number, colLetter(standardCols[i]), `Column ${colLetter(standardCols[i])} must be "${col.title}" (found "${cellText(cellAt(header, standardCols[i])).slice(0, 60)}").`);
  });
  if (dirCol < 0 && typeof options.assignOrgUnit !== 'function') {
    err(header.row_number, null, 'The file needs a "Directorate" column (and optionally "Division"): every exit must belong to a directorate of the master.');
  }
  if (errors.length) return { errors, rows: [] };

  const dirByKey = new Map((directorates || []).map(d => [canonical(d.directorate_name), d]));
  const dataRows = sheetRows.filter(r => r.row_number > header.row_number && !r.cells.every(isBlank));
  if (!dataRows.length) err(null, null, 'The sheet has no data rows below the header row.');

  const out = [];
  const seen = new Map();
  dataRows.forEach(r => {
    const n = r.row_number;
    const before = errors.length;
    const cell = key => cellAt(r, standardCols[TEMPLATE_COLUMNS.findIndex(c => c.key === key)]);
    const letter = key => colLetter(standardCols[TEMPLATE_COLUMNS.findIndex(c => c.key === key)]);
    const row = { row_number: n };

    let nik = cellText(cell('nik'));
    if (!nik || nik === '-') err(n, letter('nik'), 'NIK is empty.');
    else {
      if (options.surrogateNik) nik = `${nik}-${n}`;
      if (nik.length > TEXT_LIMITS.nik) err(n, letter('nik'), `NIK is longer than ${TEXT_LIMITS.nik} characters.`);
    }
    row.nik = nik;
    row.employee_name = cellText(cell('employee_name')).slice(0, TEXT_LIMITS.employee_name);
    const dateCell = cell('effective_date');
    const date = isBlank(dateCell) ? null : parseDateCell(dateCell);
    if (!date) err(n, letter('effective_date'), `Effective Resignation Date must be a date (Excel date, YYYY-MM-DD or dd/mm/yyyy; found "${cellText(dateCell)}").`);
    else if (date < '2000-01-01' || date > '2100-12-31') err(n, letter('effective_date'), `Effective Resignation Date ${date} is outside 2000-2100.`);
    row.effective_date = date;
    row.leaving_reason = codeOf(optionalText(cellText(cell('leaving_reason')), TEXT_LIMITS.leaving_reason));
    row.leaving_reason_detail = codeOf(optionalText(cellText(cell('leaving_reason_detail')), TEXT_LIMITS.leaving_reason_detail));
    row.grade = optionalText(cellText(cell('grade')), TEXT_LIMITS.grade);
    row.score_factor = optionalText(cellText(cell('score_factor')), TEXT_LIMITS.score_factor);
    ['destination_industry', 'new_company', 'new_position'].forEach(k => { row[k] = optionalText(cellText(cell(k)), TEXT_LIMITS[k]); });
    ['pull_factors', 'improve_factors', 'new_company_offers', 'internal_factors', 'suggestions'].forEach(k => { row[k] = optionalText(cellText(cell(k)), LONG_TEXT_LIMIT); });

    const scores = CAREER_STATEMENTS.map((_, i) => {
      const p = parseScoreCell(cell(`score_${i + 1}`));
      if (p.error) err(n, letter(`score_${i + 1}`), `Career statement ${i + 1} ${p.error}.`);
      return p.value === undefined ? null : p.value;
    });
    row.career_scores = scores.some(s => s !== null) ? scores : null;
    TEMPLATE_COLUMNS.filter(c => c.yesNo).forEach(c => {
      const p = parseYesNo(cell(c.key));
      if (p.error) err(n, letter(c.key), `"${c.title.slice(0, 50)}" ${p.error}.`);
      row[c.key] = p.value === undefined ? null : p.value;
    });

    if (dirCol >= 0) {
      const dirText = cellText(cellAt(r, dirCol));
      const divText = divCol >= 0 ? cellText(cellAt(r, divCol)) : '';
      // v2.51.0: a former name (renamed / merged directorate or division, seed rename) maps to the current one
      const resolved = !dirByKey.has(canonical(dirText)) && options.resolver ? options.resolver.directorate(dirText) : null;
      const d = dirByKey.get(canonical(dirText)) || (resolved ? dirByKey.get(canonical(resolved)) : null);
      if (!dirText) err(n, colLetter(dirCol), 'Directorate is empty.');
      else if (!d) err(n, colLetter(dirCol), `Directorate "${dirText.slice(0, 80)}" is not in the directorate master.`);
      else {
        row.directorate = d.directorate_name;
        row.division = null;
        if (divText && divText !== '-') {
          const viaAlias = options.resolver ? options.resolver.division(d.directorate_name, divText) : null;
          const div = (d.divisions || []).find(x => canonical(x) === canonical(divText)) || viaAlias;
          if (!div) err(n, colLetter(divCol), `Division "${divText.slice(0, 80)}" does not belong to directorate ${d.directorate_name}.`);
          else row.division = div;
        }
      }
    } else {
      const org = options.assignOrgUnit(n) || {};
      row.directorate = org.directorate || null;
      row.division = org.division || null;
      if (!row.directorate) err(n, null, 'No directorate could be assigned to this row.');
    }

    if (nik && date) {
      const key = `${nik.toLowerCase()}|${date}`;
      if (seen.has(key)) err(n, letter('nik'), `NIK ${nik} with Effective Resignation Date ${date} appears more than once (rows ${seen.get(key)} and ${n}).`);
      else seen.set(key, n);
    }
    if (errors.length === before) out.push(row);
  });
  return { errors, rows: errors.length ? [] : out };
}

// ------------------------------------------------------------------ import
/**
 * Validates and stores one Termination Report file. Atomic: any invalid row -> nothing stored.
 * options: { uploadedBy, source: 'UPLOAD' | 'TEMPLATE_IMPORT', assignOrgUnit, surrogateNik }
 * Returns { success, status, ... } - status is the HTTP status the route should answer with.
 */
async function importExitInterviews(buffer, fileName, options = {}) {
  let sheetRows;
  try {
    sheetRows = await readFirstSheet(buffer);
  } catch (e) {
    return { success: false, status: 400, error: e.message, errors: [{ row_number: null, column: null, reason: e.message }] };
  }
  const directorates = await storage.getDirectorates();
  const v = validateExitSheet(sheetRows, directorates, { ...options, resolver: buildResolver(directorates, await storage.getDirectoryAliases()) });
  if (v.errors.length) {
    return {
      success: false,
      status: 400,
      error: `The exit interview file was refused (${v.errors.length} error${v.errors.length === 1 ? '' : 's'}); nothing was stored.`,
      errors: v.errors
    };
  }
  const rules = await loadRules();
  const rows = v.rows.map(({ row_number, ...r }) => ({ ...r, new_company_std: standardizeCompany(r.new_company, rules) }));
  const dates = rows.map(r => r.effective_date).sort();
  const uploadId = `exit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const source = options.source === 'TEMPLATE_IMPORT' ? 'TEMPLATE_IMPORT' : 'UPLOAD';

  fs.mkdirSync(EXIT_UPLOAD_DIR, { recursive: true });
  const filePath = path.join(EXIT_UPLOAD_DIR, `${uploadId}.xlsx`);
  fs.writeFileSync(filePath, buffer);
  let saved;
  try {
    saved = await storage.saveExitInterviewUpload({
      upload_id: uploadId,
      file_name: String(fileName || 'exit_interview.xlsx').slice(0, 260),
      source,
      uploaded_by: options.uploadedBy || 'HR Admin',
      period_from: dates[0],
      period_to: dates[dates.length - 1]
    }, rows);
  } catch (e) {
    fs.unlink(filePath, () => {});
    throw e;
  }
  const months = [...new Set(rows.map(r => r.effective_date.slice(0, 7)))].sort();
  return {
    success: true,
    status: 200,
    upload_id: uploadId,
    file_name: fileName,
    source,
    rows_imported: rows.length,
    inserted_rows: saved.inserted,
    updated_rows: saved.updated,
    removed_dummy_rows: saved.removed_dummy,
    period_from: dates[0],
    period_to: dates[dates.length - 1],
    months,
    errors: [],
    message: `${rows.length} exit record${rows.length === 1 ? '' : 's'} imported (${saved.inserted} new, ${saved.updated} updated) for ${months.map(monthLabel).join(', ')}`
      + `${saved.removed_dummy ? `; ${saved.removed_dummy} dummy rows of ${months.length === 1 ? 'that month' : 'those months'} were replaced` : ''}.`
  };
}

function exitOriginalFilePath(uploadId) {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(String(uploadId || ''))) return null;
  const p = path.join(EXIT_UPLOAD_DIR, `${uploadId}.xlsx`);
  return fs.existsSync(p) ? p : null;
}

// ------------------------------------------------------------------ period + org filter
/**
 * Period from the Header filter (same windows as the scorecard, filterUtils.periodWindow): YTD of a year = January ..
 * the clock-capped end month, MTD = exactly that month. Returns { error } for an invalid year / month.
 */
function resolveExitPeriod(query = {}) {
  const mode = String(query.mode || 'YTD').toUpperCase() === 'MTD' ? 'MTD' : 'YTD';
  const year = query.year === undefined || query.year === '' ? CURRENT_YEAR : String(query.year);
  if (!/^\d{4}$/.test(year)) return { error: 'year must be a 4-digit year.' };
  let month = null;
  if (mode === 'MTD') {
    month = parseInt(query.month, 10);
    if (!/^\d{1,2}$/.test(String(query.month || '')) || !(month >= 1 && month <= 12)) return { error: 'month must be 1-12 for MTD.' };
  }
  const w = periodWindow({ mode, year, month });
  const endMonth = w && w.to ? parseInt(w.to.slice(5, 7), 10) : null;
  const label = mode === 'MTD'
    ? `${MONTH_NAMES[month - 1]} ${year}`
    : (endMonth ? `January - ${MONTH_NAMES[endMonth - 1]} ${year}` : `${year} (no elapsed month yet)`);
  return { mode, year: parseInt(year, 10), month, from: w ? w.from : null, to: w ? w.to : null, label };
}

// scope = authService.resolveScope(...) result: { directorate, sub_directorate, scopes }
function filterByOrg(rows, scope) {
  return rows.filter(r => (scope.directorate === 'ALL' || r.directorate === scope.directorate)
    && (scope.sub_directorate === 'ALL' || r.division === scope.sub_directorate)
    && (!scope.scopes || rowInScopes(scope.scopes, r.directorate, r.division)));
}

async function rowsForFilter(period, scope) {
  if (!period.from) return [];
  return filterByOrg(await storage.getExitInterviews({ from: period.from, to: period.to }), scope);
}

// ------------------------------------------------------------------ aggregates
const careerMean = scores => {
  const answered = (scores || []).filter(s => Number.isFinite(s));
  return answered.length ? answered.reduce((a, b) => a + b, 0) / answered.length : null;
};
// round half up to 1..6 (a tiny epsilon guards 4.4999999 from floating point sums)
const careerBucket = mean => Math.min(6, Math.max(1, Math.floor(mean + 0.5 + 1e-9)));
const isVoluntary = r => r.leaving_reason === VOLUNTARY_REASON;
const isMover = r => isVoluntary(r) && MOVER_DETAILS.includes(r.leaving_reason_detail);

const sortItems = items => items.sort((a, b) => (a.label === OTHER) - (b.label === OTHER) || b.count - a.count || a.label.localeCompare(b.label));

// ------------------------------------------------------------------ headlines (rule-based wording from the card numbers, no AI)
const HEADLINE_DOMINANT_PCT = 40; // top share >= 40% -> "dominate(s) exits" / "is the main attraction"
const HEADLINE_RUNNER_UP_PP = 5; // a runner-up within 5 percentage points of the top reason is named too
const EMPTY_OVERVIEW_HEADLINE = 'No voluntary exit records in this period';
// card-1 reason label -> [natural phrase, plural]; any other reason = its own label, singular
const REASON_PHRASES = {
  'Move company': ['Company moves', true],
  'Own business': ['Own-business exits', true],
  Family: ['Family reasons', true],
  Personal: ['Personal reasons', true],
  Study: ['Further study', false],
  Health: ['Health reasons', true],
  'Performance issue': ['Performance issues', true],
  'Not specified': ['Unspecified reasons', true]
};
// card-4 pull factor -> phrase ("Other" never heads the headline)
const PULL_PHRASES = { Compensation: 'compensation', Position: 'a higher position', Job: 'a better-suited job', Reputation: 'company reputation' };

const lowerFirst = s => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const phraseOfReason = label => REASON_PHRASES[label] || [label, false];
// "Family reasons" + "Personal reasons" -> "Family and personal reasons"; "Company moves" + "Family reasons" -> "Company moves and family reasons"
function joinPhrases(a, b) {
  const wa = a.split(' ');
  const wb = b.split(' ');
  if (wa.length > 1 && wb.length > 1 && wa[wa.length - 1] === wb[wb.length - 1]) return `${wa.slice(0, -1).join(' ')} and ${lowerFirst(b)}`;
  return `${a} and ${lowerFirst(b)}`;
}

/**
 * Slide-1 headline (like the deck's "Company moves dominate exits; compensation is the main attraction"). First clause from
 * card 1: the top reason of the voluntary exits, "dominate(s)" at >= 40% of the base else "lead(s)", a runner-up within
 * 5 pp is named with it. Second clause from card 4: the top pull factor of the movers ("Other" excluded), "is the main
 * attraction" at >= 40% of the movers else "is the most cited attraction"; left out when no mover named one.
 * Pure: takes the reasons / pull_factors objects of summarizeExitInterviews.
 */
function buildOverviewHeadline(reasons, pullFactors) {
  const items = (reasons && reasons.items) || [];
  if (!reasons || !reasons.base || !items.length) return EMPTY_OVERVIEW_HEADLINE;
  const [top, second] = items;
  const [topPhrase, topPlural] = phraseOfReason(top.label);
  const withRunnerUp = !!second && ((top.count - second.count) * 100) / reasons.base <= HEADLINE_RUNNER_UP_PP;
  const subject = withRunnerUp ? joinPhrases(topPhrase, phraseOfReason(second.label)[0]) : topPhrase;
  const plural = withRunnerUp || topPlural;
  const dominant = (top.count * 100) / reasons.base >= HEADLINE_DOMINANT_PCT;
  let headline = `${subject} ${dominant ? 'dominate' : 'lead'}${plural ? '' : 's'} exits`;
  const pull = pullFactors && pullFactors.base
    ? (pullFactors.items || []).filter(i => i.label !== OTHER && i.count > 0).sort((a, b) => b.count - a.count)[0] : null;
  if (pull) {
    const share = (pull.count * 100) / pullFactors.base;
    headline += `; ${PULL_PHRASES[pull.label] || lowerFirst(pull.label)} is the ${share >= HEADLINE_DOMINANT_PCT ? 'main' : 'most cited'} attraction`;
  }
  return headline;
}

// Slide-2 headline: the two most named themes of card A and the theme with the widest career gap of card B (null = no answers).
function buildThemesHeadline(themesOpen, themesInternal) {
  const topA = themesOpen.items.filter(i => i.label !== OTHER).slice(0, 2).map(i => i.label.toLowerCase());
  if (!topA.length) return null;
  const gap = themesInternal.negative_base && themesInternal.positive_base
    ? themesInternal.items.filter(i => i.label !== OTHER && i.gap_pp > 0).sort((a, b) => b.gap_pp - a.gap_pp)[0] : null;
  return `Movers highlight ${topA.join(' and ')}${gap ? `; ${gap.label.toLowerCase()} is the clearest satisfaction gap` : ''}`;
}

/**
 * Every card of the dashboard from the rows of one period + org filter (pure: the regression suite recomputes it).
 * options.listUnknownCompanies = false hides new-employer names that are not in the alias table (USER view: a free-text
 * name of one person is not an aggregate).
 */
function summarizeExitInterviews(rows, rules, options = {}) {
  const listUnknown = options.listUnknownCompanies !== false;
  const voluntary = rows.filter(isVoluntary);
  const movers = voluntary.filter(isMover);

  // 1. reasons (column E) of the voluntary exits; MOVE_COMPANY + BETTER_OFFER = Move company
  const reasonCounts = new Map();
  voluntary.forEach(r => {
    const label = MOVER_DETAILS.includes(r.leaving_reason_detail) ? 'Move company' : humanizeCode(r.leaving_reason_detail);
    reasonCounts.set(label, (reasonCounts.get(label) || 0) + 1);
  });
  const reasons = {
    base: voluntary.length,
    items: [...reasonCounts.entries()].map(([label, count]) => ({ label, count, pct: pct(count, voluntary.length) }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    footnote: 'Move company = MOVE_COMPANY + BETTER_OFFER'
  };

  // 2. destination industry (column H) of the movers who answered it
  const industryRows = movers.filter(r => isAnswered(r.destination_industry, rules));
  const isFinancial = r => normalizeAnswer(r.destination_industry) === normalizeAnswer(FINANCIAL_INDUSTRY_OPTION);
  const financialRows = industryRows.filter(isFinancial);
  const industry = {
    base: industryRows.length,
    items: [
      { key: 'FINANCIAL', label: 'Financial', count: financialRows.length, pct: pct(financialRows.length, industryRows.length) },
      { key: 'NON_FINANCIAL', label: 'Non-financial', count: industryRows.length - financialRows.length, pct: pct(industryRows.length - financialRows.length, industryRows.length) }
    ]
  };

  // 3. top 10 financial-sector destinations (column I, standardized names)
  const companyCounts = new Map();
  financialRows.forEach(r => {
    const std = standardizeCompany(r.new_company, rules);
    if (std) companyCounts.set(std, (companyCounts.get(std) || 0) + 1);
  });
  const companyItems = [...companyCounts.entries()].map(([label, count]) => ({ label, count, known: isKnownCompany(label, rules) }))
    .filter(c => listUnknown || c.known)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const topFinancial = {
    base: financialRows.length,
    named: [...companyCounts.values()].reduce((a, b) => a + b, 0),
    items: companyItems.slice(0, 10).map(({ label, count }) => ({ label, count, pct: pct(count, financialRows.length) })),
    unlisted_names_hidden: !listUnknown
  };

  // 4. pull factors (column K) - records per option, base = all movers
  const pullCounts = new Map(PULL_FACTOR_ORDER.map(l => [l, 0]));
  movers.forEach(r => groupsOf(r.pull_factors, rules.kFactors, rules).forEach(g => pullCounts.set(g, (pullCounts.get(g) || 0) + 1)));
  const compensation = pullCounts.get('Compensation') || 0;
  const pullFactors = {
    base: movers.length,
    items: [...pullCounts.entries()].map(([label, count]) => ({ label, count, pct: pct(count, movers.length) }))
      .sort((a, b) => (a.label === OTHER) - (b.label === OTHER) || b.count - a.count),
    kpi: { label: 'Compensation', pct: pct(compensation, movers.length) }
  };

  // 5. career satisfaction (O..AC): respondent mean -> bucket 1..6
  const rated = movers.map(r => ({ r, mean: careerMean(r.career_scores) })).filter(x => x.mean !== null);
  const bucketCounts = [0, 0, 0, 0, 0, 0];
  rated.forEach(x => { x.bucket = careerBucket(x.mean); bucketCounts[x.bucket - 1]++; });
  const average = rated.length ? Math.round((rated.reduce((s, x) => s + x.mean, 0) / rated.length) * 100) / 100 : null;
  const negatives = rated.filter(x => x.bucket <= 3).map(x => x.r);
  const positives = rated.filter(x => x.bucket >= 4).map(x => x.r);
  const career = {
    base: rated.length,
    buckets: CAREER_LABELS.map((label, i) => ({ score: i + 1, label, count: bucketCounts[i], pct: pct(bucketCounts[i], rated.length) })),
    average,
    average_pct: average === null ? null : round1((average / 6) * 100),
    negative: negatives.length,
    positive: positives.length
  };

  // 6. would recommend (column AF)
  const recRows = movers.filter(r => r.recommend === 'Yes' || r.recommend === 'No');
  const yes = recRows.filter(r => r.recommend === 'Yes').length;
  const recommend = {
    base: recRows.length,
    items: [
      { key: 'YES', label: 'Yes', count: yes, pct: pct(yes, recRows.length) },
      { key: 'NO', label: 'No', count: recRows.length - yes, pct: pct(recRows.length - yes, recRows.length) }
    ]
  };

  // A. what the new employer offers (column M) - unique employees per theme
  const mRows = movers.filter(r => splitMulti(r.new_company_offers).some(p => !isNoneAnswer(p, rules)));
  const mCounts = new Map();
  mRows.forEach(r => groupsOf(r.new_company_offers, rules.mThemes, rules).forEach(t => mCounts.set(t, (mCounts.get(t) || 0) + 1)));
  const themesOpen = {
    base: mRows.length,
    items: sortItems([...mCounts.entries()].map(([label, count]) => ({ label, count, pct: pct(count, mRows.length) })))
  };

  // B. internal factors (column N) by career satisfaction: x / N career-negative vs x / N career-positive movers
  const themeTally = group => {
    const m = new Map();
    group.forEach(r => groupsOf(r.internal_factors, rules.nThemes, rules).forEach(t => m.set(t, (m.get(t) || 0) + 1)));
    return m;
  };
  const negT = themeTally(negatives);
  const posT = themeTally(positives);
  const themeNames = [...new Set([...negT.keys(), ...posT.keys()])];
  const themesInternal = {
    negative_base: negatives.length,
    positive_base: positives.length,
    items: themeNames.map(label => {
      const n = negT.get(label) || 0;
      const p = posT.get(label) || 0;
      return {
        label,
        count: n + p,
        negative: { count: n, pct: pct(n, negatives.length) },
        positive: { count: p, pct: pct(p, positives.length) },
        gap_pp: round1(pct(n, negatives.length) - pct(p, positives.length))
      };
    })
  };
  sortItems(themesInternal.items);

  return {
    counts: { total_records: rows.length, voluntary_records: voluntary.length, movers: movers.length },
    reasons,
    industry,
    top_financial: topFinancial,
    pull_factors: pullFactors,
    career,
    recommend,
    themes_open: themesOpen,
    themes_internal: themesInternal,
    overview_headline: buildOverviewHeadline(reasons, pullFactors), // slide 1 (v2.39.0)
    headline: buildThemesHeadline(themesOpen, themesInternal) // slide 2
  };
}

/**
 * The dashboard payload for one request. scope = authService.resolveScope result; isAdmin decides whether unknown
 * new-employer names are listed. Aggregates only - never a NIK, name or verbatim answer.
 */
async function getExitInterviewSummary(period, scope, { isAdmin = false } = {}) {
  const rows = await rowsForFilter(period, scope);
  const rules = await loadRules();
  const summary = summarizeExitInterviews(rows, rules, { listUnknownCompanies: isAdmin });
  const lastYm = rows.reduce((mx, r) => (r.effective_date.slice(0, 7) > mx ? r.effective_date.slice(0, 7) : mx), '');
  const lastLabel = lastYm ? monthLabel(lastYm) : null;
  const n = summary.counts.voluntary_records;
  let scopeLabel;
  if (!scope.scopes) scopeLabel = scope.directorate === 'ALL' ? 'Bankwide' : scope.directorate;
  else scopeLabel = scope.directorate !== 'ALL' ? scope.directorate : `My scope: ${scope.scopes.map(s => s.directorate).join(', ')}`;
  if (scope.sub_directorate !== 'ALL') scopeLabel += ` • ${scope.sub_directorate}`;
  return {
    period: { mode: period.mode, year: period.year, month: period.month, from: period.from, to: period.to, label: period.label,
      last_data_month: lastYm || null, last_data_label: lastLabel },
    scope: { directorate: scope.directorate, sub_directorate: scope.sub_directorate, label: scopeLabel },
    subtitle: rows.length
      ? `${period.label} | ${n.toLocaleString('en-US')} voluntary exit record${n === 1 ? '' : 's'} as of ${lastLabel}`
      : `${period.label} | No exit records in this period`,
    ...summary
  };
}

// ------------------------------------------------------------------ template + export
async function generateExitTemplateXlsx() {
  const directorates = await storage.getDirectorates();
  const d = directorates[0] || { directorate_name: '', divisions: [] };
  const example = ['EXAMPLE-0001', 'Example Employee (delete this row)', '2026-09-30', 'NORMAL_RESIGNATION', 'MOVE_COMPANY', 'U7', '75',
    FINANCIAL_INDUSTRY_OPTION, 'PT Bank Contoh Tbk', 'Relationship Manager',
    'Kompensasi & benefit yang lebih menarik | Jabatan / posisi lebih tinggi', '-', 'Kompensasi & benefit yang lebih menarik',
    'Kurangnya kesempatan karir | Target yang terlalu tinggi', ...[5, 4, 5, 5, 4, 5, 5, 4, 4, 5, 5, 6, 5, 5, 5], 'Yes', 'Yes', 'Yes', '-',
    d.directorate_name, (d.divisions || [])[0] || ''];
  const rows = [
    ['Report Exit Interview - row 2 = column names, data from row 3 (Effective Resignation Date: Excel date, YYYY-MM-DD or dd/mm/yyyy; career statements 1-6 or "-"; Directorate from the directorate master, Division optional)'],
    [...TEMPLATE_COLUMNS.map(c => c.title), 'Directorate', 'Division'],
    example
  ];
  return buildXlsx(rows, { sheetName: 'Termination Report', headerRow: 1, colWidths: [16, 26, 22, 22, 24, 8, 12, 40, 30, 26, 40, 40, 40, 40, ...CAREER_STATEMENTS.map(() => 18), 18, 18, 18, 30, 32, 30] });
}

const escapeCsv = val => {
  if (val === null || val === undefined) return '';
  let str = val.toString();
  if (typeof val === 'string' && str !== '-' && /^[=+\-@\t\r]/.test(str) && !/^[+-]?\d+([.,]\d+)?$/.test(str)) str = `'${str}`;
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) return `"${str.replace(/"/g, '""')}"`;
  return str;
};

// Admin only (the route enforces it): every stored row of the period + org filter, formula-escaped.
async function generateExitExportCsv(period, scope) {
  const rows = await rowsForFilter(period, scope);
  const headers = ['NIK', 'Employee_Name', 'Effective_Resignation_Date', 'Leaving_Reason', 'Leaving_Reason_Detail', 'Grade', 'Score_Factor',
    'Directorate', 'Division', 'Destination_Industry', 'New_Company', 'New_Company_Standardized', 'New_Position', 'Pull_Factors',
    'Improve_Factors', 'New_Company_Offers', 'Internal_Factors', ...CAREER_STATEMENTS.map((_, i) => `Career_S${i + 1}`), 'Career_Mean',
    'Alumni_Network', 'Privacy_Consent', 'Recommend', 'Suggestions', 'Source', 'Upload_ID', 'Created_At', 'Updated_At'];
  const lines = [headers.map(escapeCsv).join(',')];
  rows.forEach(r => {
    const mean = careerMean(r.career_scores);
    lines.push([
      r.nik, r.employee_name, r.effective_date, r.leaving_reason, r.leaving_reason_detail, r.grade, r.score_factor, r.directorate, r.division,
      r.destination_industry, r.new_company, r.new_company_std, r.new_position, r.pull_factors, r.improve_factors, r.new_company_offers,
      r.internal_factors, ...CAREER_STATEMENTS.map((_, i) => (r.career_scores && r.career_scores[i] !== null ? r.career_scores[i] : '')),
      mean === null ? '' : Math.round(mean * 100) / 100, r.alumni_network, r.privacy_consent, r.recommend, r.suggestions, r.source,
      r.upload_id, r.created_at, r.updated_at
    ].map(escapeCsv).join(','));
  });
  return { csv: '﻿' + lines.join('\r\n'), rows: rows.length };
}

module.exports = {
  EXIT_UPLOAD_DIR,
  TEMPLATE_COLUMNS,
  CAREER_STATEMENTS,
  CAREER_LABELS,
  FINANCIAL_INDUSTRY_OPTION,
  normalizeAnswer,
  isNoneAnswer,
  groupsOf,
  standardizeCompany,
  careerBucket,
  loadRules,
  validateExitSheet,
  importExitInterviews,
  exitOriginalFilePath,
  resolveExitPeriod,
  filterByOrg,
  summarizeExitInterviews,
  buildOverviewHeadline,
  buildThemesHeadline,
  getExitInterviewSummary,
  generateExitTemplateXlsx,
  generateExitExportCsv
};
