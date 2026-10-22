// server/db/partQuestions.js
// v2.57.0: the configured QUESTIONS of a composite summary part (px_metric_parts.questions_json / store.json metricParts[].questions),
// set by the Admin in Admin Parameters -> Summary Questions. Shared by both storage backends and metricPartsService.
//   questions = [{ key, text, type }] in column order; type SCALE (a number on the part's scale: 1-5, or 0-100 for a PERCENT part)
//               | TEXT (a free-text answer, e.g. "What makes you interested in joining CIMB Niaga?" - never scored).
//   null      = not configured (a part inserted without it): the upload keeps the v2.55.0 behaviour (question columns read from the
//               file as they are, no count check). The boot top-up configures every part once from its stored files.
// Kinds of part:
//   QUESTIONS     - question columns after the score (E): mapped BY POSITION to the configured questions (like ESS, v2.50.0)
//   EVENT_BLOCKS  - metric 12: one block per event = the event score column (its header = the event name, data from the file) + the
//                   configured per-event questions; the block size is 1 + the number of configured questions
//   SCORE_TABLE   - metrics 19 / 20: a combined score table without question columns (nothing to configure)
const QUESTION_TYPES = ['SCALE', 'TEXT'];
const MAX_QUESTION_TEXT = 500;
const MAX_QUESTIONS = 60;
const KEY_RE = /^[A-Za-z0-9_-]{1,40}$/;

const isScoreTablePart = part => !!(part && part.template && part.template.score_column);
const isEventPart = part => !isScoreTablePart(part) && !!(part && part.template && Array.isArray(part.template.event_labels) && part.template.event_labels.length);
const partKind = part => (isScoreTablePart(part) ? 'SCORE_TABLE' : (isEventPart(part) ? 'EVENT_BLOCKS' : 'QUESTIONS'));
const cleanText = t => String(t === null || t === undefined ? '' : t).replace(/\s+/g, ' ').trim();

// The question headers of one event block: the labels after the first event column up to the next event column
function firstEventBlock(labels, eventLabels) {
  const events = new Set(eventLabels || []);
  const start = labels.findIndex(l => events.has(l));
  if (start < 0) return labels.slice();
  const out = [];
  for (let i = start + 1; i < labels.length && !events.has(labels[i]); i++) out.push(labels[i]);
  return out;
}

/**
 * The configuration a part gets ONCE (boot top-up, only where it is not set): the question headers of its LATEST upload (the file the
 * Admin really uses), else of its seeded template, else none (Welcome Session / Infrastructure & Application: the Admin adds them).
 * A question is TEXT when the seed template says so (template.question_types) or when the stored rows of that upload hold only text
 * answers for it (e.g. "Suitable role"); otherwise SCALE. Keys q1, q2 ... in column order.
 *   latestUpload: { columns } | null; latestRows: the stored result rows of that upload (questions [{ label, value, is_event }])
 */
function seedQuestions(part, latestUpload = null, latestRows = []) {
  if (isScoreTablePart(part)) return [];
  const tpl = (part && part.template) || {};
  const cols = latestUpload && latestUpload.columns && Array.isArray(latestUpload.columns.question_labels) ? latestUpload.columns : null;
  const fromUpload = !!cols;
  const labels = fromUpload ? cols.question_labels : (Array.isArray(tpl.question_labels) ? tpl.question_labels : []);
  const eventLabels = fromUpload ? (cols.event_labels || []) : (tpl.event_labels || []);
  const block = isEventPart(part) || eventLabels.length ? firstEventBlock(labels, eventLabels) : labels.slice();
  const tplTypes = Array.isArray(tpl.question_types) ? tpl.question_types : [];
  const tplLabels = Array.isArray(tpl.question_labels) ? tpl.question_labels : [];
  return block.map((label, i) => {
    let type = 'SCALE';
    const tplAt = tplLabels.indexOf(label);
    if (tplAt >= 0 && String(tplTypes[tplAt] || '').toUpperCase() === 'TEXT') type = 'TEXT';
    else if (!fromUpload && String(tplTypes[i] || '').toUpperCase() === 'TEXT') type = 'TEXT';
    if (fromUpload && !eventLabels.length) {
      const values = (latestRows || []).map(r => ((r.questions || [])[i] || {}).value).filter(v => v !== null && v !== undefined && v !== '');
      if (values.length && values.every(v => typeof v === 'string')) type = 'TEXT';
    }
    return { key: `q${i + 1}`, text: cleanText(label).slice(0, MAX_QUESTION_TEXT) || `Question ${i + 1}`, type };
  });
}

/**
 * Validates an Admin's question list for a part. input: [{ key?, text, type? }]. Returns { questions } or { error } (400).
 * Text required (max 500), type SCALE | TEXT (default SCALE), keys optional (a new question gets the next free q<n>) but unique and
 * [A-Za-z0-9_-]{1,40}; at most 60 questions; a SCORE_TABLE part has no question columns.
 */
function normalizeQuestions(input, part) {
  if (isScoreTablePart(part)) return { error: 'This template has no question columns (a combined score table) - there is nothing to configure.' };
  if (!Array.isArray(input)) return { error: 'questions must be a list of { text, type }.' };
  if (input.length > MAX_QUESTIONS) return { error: `At most ${MAX_QUESTIONS} questions per part.` };
  const keys = new Set();
  const out = [];
  for (let i = 0; i < input.length; i++) {
    const q = input[i];
    if (!q || typeof q !== 'object' || Array.isArray(q)) return { error: `Question ${i + 1} must be an object { text, type }.` };
    const text = cleanText(q.text);
    if (!text) return { error: `Question ${i + 1}: the question text cannot be empty.` };
    if (text.length > MAX_QUESTION_TEXT) return { error: `Question ${i + 1}: the question text is longer than ${MAX_QUESTION_TEXT} characters.` };
    const type = q.type === undefined || q.type === null || q.type === '' ? 'SCALE' : String(q.type).toUpperCase();
    if (!QUESTION_TYPES.includes(type)) return { error: `Question ${i + 1}: type must be SCALE or TEXT (found "${String(q.type).slice(0, 20)}").` };
    let key = q.key === undefined || q.key === null ? '' : String(q.key).trim();
    if (key) {
      if (!KEY_RE.test(key)) return { error: `Question ${i + 1}: the key "${key.slice(0, 40)}" may only hold letters, digits, "_" and "-" (max 40).` };
      if (keys.has(key.toLowerCase())) return { error: `Question ${i + 1}: the key "${key}" is used twice - every question needs its own key.` };
    }
    keys.add(key.toLowerCase());
    out.push({ key, text, type });
  }
  // keys for the new questions: the next free q<n>
  let n = 0;
  out.forEach(q => {
    if (q.key) return;
    do { n++; } while (keys.has(`q${n}`));
    q.key = `q${n}`;
    keys.add(q.key);
  });
  return { questions: out };
}

// The identity of a question set = its texts in order (rows stored before v2.57.0 carry no type) - two uploads with the same key
// used the same questions
const questionSetKey = questions => JSON.stringify((questions || []).map(q => cleanText(q.text)));

// A short description of what changed (audit PART_QUESTIONS_UPDATE): "3 -> 4 questions; added q4; removed q2; text q1; type q3; order"
function describeChanges(before, after) {
  const b = before || [];
  const a = after || [];
  const byKey = new Map(b.map(q => [q.key, q]));
  const aKeys = new Set(a.map(q => q.key));
  const parts = [`${b.length} -> ${a.length} question${a.length === 1 ? '' : 's'}`];
  const added = a.filter(q => !byKey.has(q.key)).map(q => q.key);
  const removed = b.filter(q => !aKeys.has(q.key)).map(q => q.key);
  const text = a.filter(q => byKey.has(q.key) && cleanText(byKey.get(q.key).text) !== q.text).map(q => q.key);
  const type = a.filter(q => byKey.has(q.key) && (byKey.get(q.key).type || 'SCALE') !== q.type).map(q => q.key);
  const kept = a.filter(q => byKey.has(q.key)).map(q => q.key);
  const keptBefore = b.filter(q => aKeys.has(q.key)).map(q => q.key);
  if (added.length) parts.push(`added ${added.join(',')}`);
  if (removed.length) parts.push(`removed ${removed.join(',')}`);
  if (text.length) parts.push(`text ${text.join(',')}`);
  if (type.length) parts.push(`type ${type.join(',')}`);
  if (kept.join('|') !== keptBefore.join('|')) parts.push('reordered');
  if (parts.length === 1) parts.push(b.length === 0 && a.length === 0 && before === null ? 'configured' : 'no change');
  return parts.join('; ');
}

module.exports = {
  QUESTION_TYPES,
  MAX_QUESTION_TEXT,
  MAX_QUESTIONS,
  isScoreTablePart,
  isEventPart,
  partKind,
  firstEventBlock,
  seedQuestions,
  normalizeQuestions,
  questionSetKey,
  describeChanges
};
