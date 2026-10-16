// server/services/mediaFileService.js
// Physical files of uploaded event media (server/uploads).
//
// A new upload is stored under a random temporary name (media-<timestamp>-<random>.<ext>) so two uploads with the
// same name can never collide while the Video Extractor / Gemma are still working on the file. Once the whole pipeline
// of a VIDEO is finished (transcript + AI summary, or a terminal failure) the file is renamed to the name it was
// uploaded with (px_media.file_name) and px_media.file_path is updated - see finalizeMediaFileName().
//
// Safety rules: the rename never overwrites another file, never runs while the Video Extractor or Gemma may still
// read the file, never leaves the database pointing to a file that does not exist, and a failed rename (missing
// file, permissions, file locked by Windows) only logs a warning - it never fails a job.
const fs = require('fs');
const path = require('path');
const storage = require('../db/storage');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const MAX_STEM_CHARS = 150;
const MAX_SUFFIX = 999;
const MAX_PATH_CHARS = 480;
const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi', '.ogv', '.mpg', '.mpeg', '.3gp', '.wmv', '.flv']);
// Upload allowlist (together with VIDEO_EXTENSIONS). SVG is deliberately NOT here: it is an image type that can carry
// script and would run when opened from /uploads. HEIC/HEIF are left out too (browsers cannot display them).
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif']);
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

// ------------------------------------------------------------------ names
// busboy reads the multipart filename as latin1, so a UTF-8 name ("Rekaman Tim Ünggul.mp4") arrives as mojibake.
// Re-decode only when the result is certainly the intended text (valid UTF-8 that round-trips); plain ASCII and names
// that were already decoded correctly are returned unchanged.
function repairUploadedName(name) {
  const text = String(name || '');
  if (!/[^\x00-\x7f]/.test(text)) return text;
  if ([...text].some(ch => ch.charCodeAt(0) > 0xff)) return text;
  const fixed = Buffer.from(text, 'latin1').toString('utf8');
  if (fixed === text || fixed.includes('�')) return text;
  return Buffer.from(fixed, 'utf8').toString('latin1') === text ? fixed : text;
}

// Extension (".mp4") that is safe to put in a temporary upload name; anything odd is dropped.
function safeExtension(originalName) {
  const ext = path.extname(String(originalName || '')).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : '';
}

// 'IMAGE' / 'VIDEO' when the LAST extension of the upload name is on the allowlist, otherwise null.
function mediaKindOfName(originalName) {
  const ext = safeExtension(originalName);
  if (IMAGE_EXTENSIONS.has(ext)) return 'IMAGE';
  if (VIDEO_EXTENSIONS.has(ext)) return 'VIDEO';
  return null;
}

// Original upload name -> { stem, ext } that is a legal, harmless Windows file name, or null when nothing usable is left.
// `currentName` (the temporary file name) supplies the extension when the original one is not a known video type.
function sanitizeVideoFileName(originalName, currentName) {
  let name = repairUploadedName(originalName).normalize('NFC');
  name = name.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, '');
  name = name.split(/[\\/]/).pop();                  // basename only: no directories, no ".."
  name = name.replace(/[<>:"|?*]/g, '');             // characters Windows does not allow in a file name
  let ext = [name, currentName].map(n => safeExtension(n)).find(e => VIDEO_EXTENSIONS.has(e)) || '';
  let stem = name;
  if (ext && name.toLowerCase().endsWith(ext)) {
    ext = name.slice(name.length - ext.length);      // keep the case the user wrote (".MP4")
    stem = name.slice(0, name.length - ext.length);
  }
  // The final name always ends in a known video extension; without one the random temporary name is kept.
  if (!ext) return null;
  const trim = s => s.replace(/^[\s.]+|[\s.]+$/g, '');
  stem = trim(stem);
  if (!stem) return null;
  let chars = Array.from(stem).slice(0, MAX_STEM_CHARS);
  // px_media.file_path holds the URL-encoded name in 500 characters (room left for a " (999)" suffix).
  while (chars.length && toWebPath(`${chars.join('')} (${MAX_SUFFIX})${ext}`).length > MAX_PATH_CHARS) chars.pop();
  stem = trim(chars.join(''));
  if (!stem) return null;
  if (WINDOWS_RESERVED.test(stem.split('.')[0].trim())) stem = `_${stem}`;
  return { stem, ext };
}

// '/uploads/<name>' (name URL-encoded) -> absolute path inside the uploads folder, or null for anything else.
function resolveUploadPath(filePath) {
  if (!filePath || !String(filePath).startsWith('/uploads/')) return null;
  let rest = String(filePath).slice('/uploads/'.length);
  try { rest = decodeURIComponent(rest); } catch (_) { /* not URL-encoded (legacy value): use as is */ }
  if (rest.includes('\0')) return null;
  const base = path.basename(rest.replace(/\\/g, '/'));
  if (!base || base === '.' || base === '..') return null;
  const abs = path.resolve(UPLOADS_DIR, base);
  return abs.startsWith(UPLOADS_DIR + path.sep) ? abs : null;
}

const toWebPath = fileName => `/uploads/${encodeURIComponent(fileName)}`;

// ------------------------------------------------------------------ one-at-a-time lock
// Renames, record updates and deletes of media files are serialized, so two jobs finishing together can never pick the
// same target name and a delete can never run half-way through a rename.
let chain = Promise.resolve();
function runExclusive(fn) {
  const result = chain.then(fn, fn);
  chain = result.catch(() => {});
  return result;
}

// ------------------------------------------------------------------ the rename
const exists = p => fs.promises.access(p).then(() => true, () => false);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isLockError = err => err && (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES');

async function renameWithRetry(from, to) {
  try {
    await fs.promises.rename(from, to);
  } catch (err) {
    if (!isLockError(err)) throw err;
    await sleep(500);          // a scanner or a player may hold the file for a moment
    await fs.promises.rename(from, to);
  }
}

// Is the file still (or about to be) read by the Video Extractor or Gemma? The services are required lazily
// because they themselves call finalizeMediaFileName (circular import otherwise).
function pipelineIsBusy(media_id, opts) {
  const { isTranscribeInFlight } = require('./transcribeService');
  const { isSummaryInFlight } = require('./mediaSummaryService');
  return (!opts.ignoreSummaryJob && isSummaryInFlight(media_id)) || isTranscribeInFlight(media_id);
}

function isFinalState(media) {
  if (media.transcript_status === 'FAILED') return true;
  return media.transcript_status === 'DONE' && ['DONE', 'FAILED', 'INSUFFICIENT'].includes(media.summary_status);
}

async function pickFreeName(stem, ext, currentAbs, takenByOthers) {
  for (let n = 0; n <= MAX_SUFFIX; n++) {
    const fileName = `${stem}${n ? ` (${n})` : ''}${ext}`;
    const abs = path.join(UPLOADS_DIR, fileName);
    if (abs.toLowerCase() === currentAbs.toLowerCase()) return { fileName, abs };       // already this very file
    if (takenByOthers.has(fileName.toLowerCase())) continue;
    if (!(await exists(abs))) return { fileName, abs };
  }
  return null;
}

async function doFinalize(media_id, opts) {
  const media = await storage.getMediaById(media_id);
  if (!media || media.file_type !== 'VIDEO') return { renamed: false, reason: 'not-a-video' };
  if (!isFinalState(media)) return { renamed: false, reason: 'not-final' };
  if (pipelineIsBusy(media_id, opts)) return { renamed: false, reason: 'busy' };

  const currentAbs = resolveUploadPath(media.file_path);
  if (!currentAbs) return { renamed: false, reason: 'bad-path' };
  if (!(await exists(currentAbs))) {
    console.warn(`Media file of ${media_id} was not renamed: ${path.basename(currentAbs)} is not on the server.`);
    return { renamed: false, reason: 'missing-file' };
  }

  const wanted = sanitizeVideoFileName(media.file_name, path.basename(currentAbs));
  if (!wanted) return { renamed: false, reason: 'no-usable-name' };

  // Names that other records already point to (even if their file is missing) are never reused.
  const takenByOthers = new Set();
  for (const other of await storage.getAllMedia()) {
    if (other.media_id === media_id) continue;
    const abs = resolveUploadPath(other.file_path);
    if (abs) takenByOthers.add(path.basename(abs).toLowerCase());
  }
  const target = await pickFreeName(wanted.stem, wanted.ext, currentAbs, takenByOthers);
  if (!target) return { renamed: false, reason: 'no-free-name' };
  if (path.basename(currentAbs) === target.fileName) return { renamed: false, reason: 'already-named', file_path: media.file_path };

  await renameWithRetry(currentAbs, target.abs);
  let updated = null;
  try {
    updated = await storage.updateMedia(media_id, { file_path: toWebPath(target.fileName) });
  } catch (err) {
    updated = null;
    console.warn(`Media ${media_id}: record update failed after the rename (${err.message}); the file name is restored.`);
  }
  if (updated) return { renamed: true, file_path: updated.file_path };

  // The record was not updated: never leave it pointing to a file that is gone.
  if (await storage.getMediaById(media_id)) {
    try { await fs.promises.rename(target.abs, currentAbs); } catch (err) { console.error(`Media ${media_id}: could not restore ${path.basename(currentAbs)}: ${err.message}`); }
    return { renamed: false, reason: 'db-update-failed' };
  }
  fs.promises.unlink(target.abs).catch(() => {});   // the record was deleted meanwhile: the file goes with it
  return { renamed: false, reason: 'deleted' };
}

// Renames the physical file of a finished VIDEO to its original upload name. Safe to call at any time and any number of
// times: it does nothing unless the pipeline is in a final state and idle. `opts.ignoreSummaryJob` is for the AI summary
// job calling it from its own last step (the job is still "running" on the queue at that point).
// Never throws; resolves to { renamed, reason?, file_path? }.
function finalizeMediaFileName(media_id, opts = {}) {
  return runExclusive(async () => {
    try {
      return await doFinalize(media_id, opts);
    } catch (err) {
      console.warn(`Media file of ${media_id} was not renamed: ${err.message}`);
      return { renamed: false, reason: 'error', error: err.message };
    }
  });
}

// Deletes the record and its file. Runs in the same lock as the rename, so the file removed is always the one the
// record currently points to.
function deleteMediaAndFile(media_id) {
  return runExclusive(async () => {
    const removed = await storage.deleteMedia(media_id);
    const abs = removed && resolveUploadPath(removed.file_path);
    if (abs) await fs.promises.unlink(abs).catch(() => {});
    return removed;
  });
}

module.exports = {
  UPLOADS_DIR,
  repairUploadedName,
  safeExtension,
  mediaKindOfName,
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  sanitizeVideoFileName,
  resolveUploadPath,
  runExclusive,
  finalizeMediaFileName,
  deleteMediaAndFile
};
