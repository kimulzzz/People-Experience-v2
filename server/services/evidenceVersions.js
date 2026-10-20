// server/services/evidenceVersions.js
// Question-set versions of survey evidence (v2.50.0). Every upload stores the question set that was in use
// (px_survey_uploads.questions_snapshot_json, ESS: per result row), so an evidence export never relabels old rows with
// today's question texts. When the exported rows span more than one question-set version, the download is a .zip with
// one CSV per version plus a README.txt; with one version it stays the single CSV of before.
const JSZip = require('jszip');

// Identity of a question set: order, key, label, text and type of every question.
function questionSetSignature(questions) {
  return JSON.stringify((questions || []).map(q => [q.key || null, q.label || null, q.text || q.label || null, q.type || null]));
}

const dateOnly = v => (v ? String(v).slice(0, 10) : '');
const safeName = s => String(s).replace(/[^A-Za-z0-9._-]+/g, '_');

/**
 * Groups items into question-set versions, oldest first.
 *   items      : rows to export
 *   versionOf  : item -> { questions, source, uploaded_at }  (source: 'SNAPSHOT' | 'FILE_HEADER' | 'CURRENT_CONFIG')
 * Returns [{ signature, questions, sources: Set, items: [...], from, to }].
 */
function groupByQuestionSet(items, versionOf) {
  const map = new Map();
  items.forEach(item => {
    const v = versionOf(item);
    const sig = questionSetSignature(v.questions);
    if (!map.has(sig)) map.set(sig, { signature: sig, questions: v.questions, sources: new Set(), items: [], from: null, to: null });
    const g = map.get(sig);
    g.items.push(item);
    g.sources.add(v.source);
    const d = dateOnly(v.uploaded_at);
    if (d && (!g.from || d < g.from)) g.from = d;
    if (d && (!g.to || d > g.to)) g.to = d;
  });
  return [...map.values()].sort((a, b) => String(a.from || '').localeCompare(String(b.from || '')));
}

const SOURCE_NOTES = {
  SNAPSHOT: 'question set stored with the upload',
  FILE_HEADER: 'question text = header of the uploaded ESS file (upload from before v2.50.0, no stored question set)',
  CURRENT_CONFIG: 'no question set stored with the upload (before v2.50.0): the current Manage Questions configuration is used'
};

/**
 * Builds the .zip of a multi-version export.
 *   baseName : file name without extension, e.g. "Evidence_Survey_Metric_8_2026"
 *   title    : first README line
 *   versions : [{ csv, questions, sources, items, from, to }] (oldest first)
 * Returns { buffer, fileName }.
 */
async function buildVersionedZip({ baseName, title, versions }) {
  const zip = new JSZip();
  const lines = [
    title,
    '',
    `The exported rows were collected with ${versions.length} different question sets (the questions were changed in Manage Questions`,
    'between uploads). Each CSV holds the rows of ONE question set, with the question texts that were in use when that data was',
    'submitted. Version 1 is the oldest.',
    ''
  ];
  versions.forEach((v, i) => {
    const range = v.from ? (v.from === v.to ? v.from : `${v.from}_to_${v.to}`) : 'unknown_date';
    const fileName = `${safeName(baseName)}_v${i + 1}_${safeName(range)}.csv`;
    zip.file(fileName, v.csv);
    lines.push(`Version ${i + 1}: ${fileName}`);
    lines.push(`  Uploaded: ${v.from ? (v.from === v.to ? v.from : `${v.from} to ${v.to}`) : 'unknown'}; rows: ${v.items.length}`);
    [...v.sources].forEach(s => lines.push(`  Source: ${SOURCE_NOTES[s] || s}`));
    lines.push('  Questions:');
    (v.questions || []).forEach((q, qi) => lines.push(`    ${qi + 1}. ${[q.key, q.label].filter(Boolean).join(' / ')}${q.type ? ` [${q.type}]` : ''}: ${q.text || q.label || ''}`));
    lines.push('');
  });
  zip.file('README.txt', lines.join('\r\n'));
  return { buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), fileName: `${safeName(baseName)}.zip` };
}

module.exports = { questionSetSignature, groupByQuestionSet, buildVersionedZip, SOURCE_NOTES };
