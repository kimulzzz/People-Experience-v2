// server/services/xlsxUtils.js
// Minimal .xlsx reader + writer shared by the ESS summary upload (essSummaryService.js, v2.32.0) and the Exit Interview
// upload (exitInterviewService.js, v2.38.0). No formula is ever evaluated: Excel's cached values are used. No dependency
// besides jszip.
const path = require('path');
const JSZip = require('jszip');

// ------------------------------------------------------------------ minimal .xlsx reader
function decodeXml(text) {
  return String(text || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
const attrOf = (attrs, name) => {
  const m = String(attrs || '').match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return m ? decodeXml(m[1]) : null;
};
// All <t> texts of a shared/inline string (rich text runs concatenated, phonetic hints dropped).
const textRuns = xml => {
  const body = String(xml || '').replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  const out = [];
  body.replace(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g, (_, t) => { out.push(decodeXml(t || '')); return ''; });
  return out.join('');
};
const colIndex = ref => {
  const letters = String(ref || '').match(/^[A-Z]+/i);
  if (!letters) return -1;
  return letters[0].toUpperCase().split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
};
const colLetter = idx => {
  let s = '';
  let n = idx + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

/**
 * Reads the FIRST worksheet of an .xlsx buffer into rows of cells.
 * Returns [{ row_number, cells: [{ value, type: 'string'|'number'|'boolean'|'error'|'empty', formulaWithoutValue }] }].
 * Throws an Error with a user-facing message when the bytes are not an .xlsx workbook.
 */
// options (v2.55.0): preferSheet = a sheet name read instead of the first sheet when the workbook has it (case-insensitive);
// refuseSheet = a RegExp - when the sheet that would be read is named like it, nothing is read (Error). Only the chosen
// sheet's cells are parsed. withFill = every cell also gets `fill`: its solid fill colour ('FF0070C0', 'theme:5') or null.
async function readFirstSheet(buffer, { preferSheet = null, refuseSheet = null, withFill = false } = {}) {
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (_) {
    throw new Error('The file is not a valid Excel .xlsx workbook. Save it in Excel as "Excel Workbook (*.xlsx)" and upload it again.');
  }
  const read = async name => (zip.file(name) ? zip.file(name).async('string') : null);
  const workbook = await read('xl/workbook.xml');
  if (!workbook) throw new Error('The file is not a valid Excel .xlsx workbook (no workbook part found).');

  // first <sheet> -> its relationship target
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const sheets = [...workbook.matchAll(/<sheet\b([^>]*?)\/?>/g)];
  const preferred = preferSheet ? sheets.find(m => String(attrOf(m[1], 'name') || '').trim().toLowerCase() === String(preferSheet).toLowerCase()) : null;
  const firstSheet = preferred || sheets[0] || null;
  if (firstSheet && refuseSheet && refuseSheet.test(String(attrOf(firstSheet[1], 'name') || ''))) {
    throw new Error(`The sheet "${attrOf(firstSheet[1], 'name')}" is not read. Put the summary in a sheet named "${preferSheet || 'Pivot'}" (the first sheet).`);
  }
  const rels = await read('xl/_rels/workbook.xml.rels');
  if (firstSheet && rels) {
    const rid = attrOf(firstSheet[1], 'r:id');
    const rel = [...rels.matchAll(/<Relationship\b([^>]*?)\/?>/g)].map(m => m[1]).find(a => attrOf(a, 'Id') === rid);
    const target = rel ? attrOf(rel, 'Target') : null;
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : path.posix.normalize(`xl/${target}`);
  }
  const sheet = await read(sheetPath);
  if (!sheet) throw new Error('The workbook has no readable worksheet.');

  // v2.55.0: cell style index -> fill colour (styles.xml: cellXfs[s].fillId -> fills[fillId] solid fgColor)
  let fillOfStyle = [];
  if (withFill) {
    const styles = (await read('xl/styles.xml')) || '';
    const fillsXml = (styles.match(/<fills\b[^>]*>([\s\S]*?)<\/fills>/) || [])[1] || '';
    const fills = [...fillsXml.matchAll(/<fill\b[^>]*>([\s\S]*?)<\/fill>/g)].map(m => {
      if (!/patternType="solid"/.test(m[1])) return null;
      const fg = m[1].match(/<fgColor\b([^>]*?)\/?>/);
      if (!fg) return null;
      const rgb = attrOf(fg[1], 'rgb');
      const theme = attrOf(fg[1], 'theme');
      return rgb ? rgb.toUpperCase() : (theme !== null ? `theme:${theme}` : null);
    });
    const xfsXml = (styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/) || [])[1] || '';
    fillOfStyle = [...xfsXml.matchAll(/<xf\b([^>]*?)(?:\/>|>)/g)].map(m => {
      const id = parseInt(attrOf(m[1], 'fillId'), 10);
      return Number.isFinite(id) ? (fills[id] || null) : null;
    });
  }

  const shared = [];
  const sst = await read('xl/sharedStrings.xml');
  if (sst) sst.replace(/<si\b[^>]*>([\s\S]*?)<\/si>/g, (_, si) => { shared.push(textRuns(si)); return ''; });

  const rows = [];
  let nextRow = 1;
  const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  let rm;
  while ((rm = rowRe.exec(sheet))) {
    const rAttr = parseInt(attrOf(rm[1], 'r'), 10);
    const rowNumber = Number.isFinite(rAttr) ? rAttr : nextRow;
    nextRow = rowNumber + 1;
    const cells = [];
    let nextCol = 0;
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    while ((cm = cellRe.exec(rm[2] || ''))) {
      const ref = attrOf(cm[1], 'r');
      const idx = ref ? colIndex(ref) : nextCol;
      nextCol = idx + 1;
      const t = attrOf(cm[1], 't');
      const inner = cm[2] || '';
      const vMatch = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
      const hasFormula = /<f\b/.test(inner);
      const raw = vMatch ? decodeXml(vMatch[1]) : null;
      let cell = { value: null, type: 'empty', formulaWithoutValue: false };
      if (t === 'inlineStr') {
        const isMatch = inner.match(/<is\b[^>]*>([\s\S]*?)<\/is>/);
        cell = { value: textRuns(isMatch ? isMatch[1] : ''), type: 'string' };
      } else if (raw === null) {
        cell.formulaWithoutValue = hasFormula;
      } else if (t === 's') {
        cell = { value: shared[parseInt(raw, 10)] !== undefined ? shared[parseInt(raw, 10)] : '', type: 'string' };
      } else if (t === 'str') {
        cell = { value: raw, type: 'string' };
      } else if (t === 'b') {
        cell = { value: raw === '1', type: 'boolean' };
      } else if (t === 'e') {
        cell = { value: raw, type: 'error' };
      } else {
        const num = Number(raw);
        cell = Number.isFinite(num) ? { value: num, type: 'number' } : { value: raw, type: 'string' };
      }
      if (cell.type === 'string' && !String(cell.value).trim()) cell = { value: null, type: 'empty', formulaWithoutValue: false };
      if (withFill) { const s = parseInt(attrOf(cm[1], 's'), 10); cell.fill = Number.isFinite(s) ? (fillOfStyle[s] || null) : null; }
      if (idx >= 0) cells[idx] = cell;
    }
    rows.push({ row_number: rowNumber, cells });
  }
  return rows;
}

const xmlEsc = s => String(s === null || s === undefined ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// merges (v2.55.0): optional merged ranges, e.g. ['B1:M1']
function buildXlsx(rows, { sheetName = 'Dimensions', colWidths = [], headerRow = 0, merges = [] } = {}) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + '</Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '</Relationships>');
  zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `<sheets><sheet name="${xmlEsc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    + '</Relationships>');
  // style 0 = normal, 1 = bold + wrapped (header row, by default row 1)
  zip.file('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
    + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs>'
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
    + '</styleSheet>');
  const cols = colWidths.length
    ? `<cols>${colWidths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const sheetRows = rows.map((cells, ri) => {
    const r = ri + 1;
    const body = cells.map((v, ci) => {
      if (v === null || v === undefined || v === '') return '';
      const ref = `${colLetter(ci)}${r}`;
      const style = ri === headerRow ? ' s="1"' : '';
      if (typeof v === 'number') return `<c r="${ref}"${style}><v>${v}</v></c>`;
      return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
    }).join('');
    return `<row r="${r}">${body}</row>`;
  }).join('');
  zip.file('xl/worksheets/sheet1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `${cols}<sheetData>${sheetRows}</sheetData>`
    + (merges.length ? `<mergeCells count="${merges.length}">${merges.map(r => `<mergeCell ref="${xmlEsc(r)}"/>`).join('')}</mergeCells>` : '')
    + '</worksheet>');
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { decodeXml, colIndex, colLetter, readFirstSheet, xmlEsc, buildXlsx };
