// server/services/transcribeService.js
// Audio/video -> text via the local faster-whisper API ("Video Extractor", POST /transcribe).
// 100% on-premise: the API runs on this machine and is handed a LOCAL FILE PATH, so the
// uploaded video never leaves the server. Transcription of a long video can take minutes on
// CPU, so callers must treat it as a background job (see queueMediaTranscription).
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const storage = require('../db/storage');
const { queueMediaSummary } = require('./mediaSummaryService');
const { UPLOADS_DIR, resolveUploadPath, runExclusive, finalizeMediaFileName, sanitizeVideoFileName } = require('./mediaFileService');

const API_URL = (process.env.TRANSCRIBE_API_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
const DEFAULT_LANGUAGE = process.env.TRANSCRIBE_LANGUAGE || 'id';
// Whisper on CPU is slow and the first request also downloads/loads the model — be generous:
// limit 120 minutes (override: TRANSCRIBE_TIMEOUT_MS). It is the idle limit of the HTTP socket, and the
// Video Extractor sends nothing until the transcript is complete, so it is also the total limit.
const DEFAULT_TIMEOUT_MS = 120 * 60 * 1000;
const TIMEOUT_MS = parseInt(process.env.TRANSCRIBE_TIMEOUT_MS || String(DEFAULT_TIMEOUT_MS), 10);
const DESCRIPTION_EXCERPT_CHARS = 280;

// The Video Extractor shows the `source` path it is given in its monitoring page and its API has no "display name" field.
// So the file is handed over through a HARD LINK whose name is the name the video was uploaded with (no copy, no extra
// disk space), one throw-away folder per job, deliberately OUTSIDE server/uploads (that folder is served statically).
const TMP_DIR = path.join(__dirname, '..', 'tmp-transcribe');
const FAST_FAILURE_MS = 15 * 1000;   // a failure this quick with the link path may be the link's fault -> one retry with the real path
const MAX_LINK_PATH_CHARS = 250;     // stay below the classic Windows MAX_PATH (260) that the Extractor may be subject to

// Node's global fetch (undici) aborts if response headers take >5 min, which a long
// transcription can exceed — so talk to the API with the core http module instead.
function postJson(urlString, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const payload = Buffer.from(JSON.stringify(body), 'utf8');
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(raw); } catch (e) { /* non-JSON error body */ }
        if (res.statusCode >= 200 && res.statusCode < 300 && json) return resolve(json);
        const detail = (json && (json.detail || json.error)) || raw.slice(0, 200) || `HTTP ${res.statusCode}`;
        const failure = new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
        failure.statusCode = res.statusCode;
        reject(failure);
      });
    });
    req.setTimeout(timeoutMs, () => {
      const timeout = new Error(`The transcript exceeded the ${Math.round(timeoutMs / 60000)} minutes limit`);
      timeout.isTimeout = true;
      req.destroy(timeout);
    });
    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') {
        const down = new Error(`The transcript service is not running at ${API_URL}. Start the Video Extractor API and try again.`);
        down.isUnreachable = true;
        return reject(down);
      }
      reject(err);
    });
    req.write(payload);
    req.end();
  });
}

async function transcribeLocalFile(absolutePath, language = DEFAULT_LANGUAGE) {
  return postJson(`${API_URL}/transcribe`, {
    // The API accepts a local path in `source`; forward slashes work on Windows too.
    source: absolutePath.replace(/\\/g, '/'),
    language
  }, TIMEOUT_MS);
}

// Is the transcribe API answering at all? Any HTTP response (even 404) counts as "up"; a refused
// connection or a timeout means the Video Extractor is not running.
function isTranscribeApiReachable(timeoutMs = 3000) {
  return new Promise(resolve => {
    let done = false;
    const finish = ok => { if (!done) { done = true; resolve(ok); } };
    try {
      const url = new URL(API_URL);
      const client = url.protocol === 'https:' ? https : http;
      const req = client.request(url, { method: 'GET' }, res => { res.resume(); finish(true); });
      req.setTimeout(timeoutMs, () => { req.destroy(); finish(false); });
      req.on('error', () => finish(false));
      req.end();
    } catch (_) {
      finish(false);
    }
  });
}

const unreachableMessage = () => `The transcript service is not running at ${API_URL}. Start the Video Extractor API and try again.`;

function excerpt(text) {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  return clean.length > DESCRIPTION_EXCERPT_CHARS ? `${clean.slice(0, DESCRIPTION_EXCERPT_CHARS).trimEnd()}…` : clean;
}

const inFlight = new Set();
const isTranscribeInFlight = media_id => inFlight.has(media_id);

// ------------------------------------------------------------------ named hard link handed to the Video Extractor
const jobDirName = media_id => String(media_id).replace(/[^A-Za-z0-9._-]/g, '_');

// The job's own folder inside TMP_DIR, or null if the id would resolve anywhere else.
function jobDirOf(media_id) {
  const name = jobDirName(media_id);
  if (!name || name === '.' || name === '..') return null;
  const dir = path.resolve(TMP_DIR, name);
  return dir.startsWith(TMP_DIR + path.sep) ? dir : null;
}

// Removes a path under TMP_DIR (a job folder with its link, or a stray entry). Deleting a hard link only removes that
// name: the uploaded file itself is never touched. Never throws.
async function removeTmpEntry(target) {
  const resolved = path.resolve(target);
  if (!resolved.startsWith(TMP_DIR + path.sep)) return;
  try {
    await fs.promises.rm(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
  } catch (err) {
    console.warn(`Could not remove the temporary transcript folder ${path.basename(resolved)}: ${err.message}`);
  }
}

// Creates <TMP_DIR>/<media_id>/<original upload name> as a hard link to the video and returns { dir, source }, or null
// (with a warning) whenever that is not possible - the caller then simply uses the real, randomly named file.
async function createNamedLink(media, abs) {
  const dir = jobDirOf(media.media_id);
  if (!dir) return null;
  try {
    const wanted = sanitizeVideoFileName(media.file_name, path.basename(abs));
    if (!wanted) return null;
    // Keep the whole path short enough for tools limited to 260 characters.
    const room = MAX_LINK_PATH_CHARS - (dir.length + 1) - wanted.ext.length;
    const stem = Array.from(wanted.stem).slice(0, Math.max(room, 0)).join('').replace(/[\s.]+$/g, '');
    if (!stem) return null;
    const linkPath = path.join(dir, `${stem}${wanted.ext}`);
    if (path.dirname(linkPath) !== dir) return null;
    await removeTmpEntry(dir);                       // a leftover of an earlier attempt of this same media
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.link(abs, linkPath);
    return { dir, source: linkPath };
  } catch (err) {
    console.warn(`Transcript for ${media.media_id}: could not make a named link (${err.code || err.message}); the stored file name is used instead.`);
    await removeTmpEntry(dir);
    return null;
  }
}

// Did the Extractor probably fail because it could not open the linked path (as opposed to a real transcription problem)?
function looksLikeUnreadableFile(err) {
  if (!err || err.isTimeout || err.isUnreachable) return false;
  if (err.statusCode === 404 || err.statusCode === 422 || err.statusCode === 500) return true;
  return /not found|no such file|cannot (open|read|find)|could not (open|read|find)|does not exist|unreadable|invalid (data|file|source|path)|errno 2/i.test(String(err.message || ''));
}

// Boot cleanup: folders of jobs that are not running any more (crash, kill, a delete while processing) are removed.
// The folder of a media that is still PROCESSING is kept (it is re-created when that job resumes).
async function cleanupTranscribeTempDirs() {
  let entries;
  try { entries = await fs.promises.readdir(TMP_DIR, { withFileTypes: true }); } catch (_) { return 0; }
  if (!entries.length) return 0;
  const keep = new Set((await storage.getAllMedia()).filter(m => m.transcript_status === 'PROCESSING').map(m => jobDirName(m.media_id)));
  for (const id of inFlight) keep.add(jobDirName(id));
  let removed = 0;
  for (const entry of entries) {
    if (entry.isDirectory() && keep.has(entry.name)) continue;
    await removeTmpEntry(path.join(TMP_DIR, entry.name));
    removed++;
  }
  return removed;
}

// Fire-and-forget: marks the media PROCESSING, runs the transcription, then stores the
// result (DONE) or the failure reason (FAILED). The UI polls the event detail for the status.
async function queueMediaTranscription(media_id) {
  if (inFlight.has(media_id)) return false;
  // Marked in flight BEFORE anything is awaited: from here on the video file may not be renamed (mediaFileService).
  inFlight.add(media_id);
  const media = await storage.getMediaById(media_id);
  if (!media) { inFlight.delete(media_id); return false; }
  // A new transcript makes any earlier AI summary stale: clear it (the summary is made again once this one is DONE).
  await storage.updateMedia(media_id, {
    transcript_status: 'PROCESSING', transcript_error: '',
    summary: null, summary_points: null, summary_status: null, summary_source: null, summary_model: null,
    summary_language: null, summary_generated_at: null, summary_error: null
  });

  (async () => {
    try {
      // Read the path inside the file lock: a rename that was running when the job started has finished by now.
      const current = await runExclusive(() => storage.getMediaById(media_id));
      const abs = resolveUploadPath((current || media).file_path);
      if (!abs || !fs.existsSync(abs)) throw new Error('The video file was not found on the server');

      // Hand the Extractor a hard link that carries the original upload name; the link is removed as soon as the call
      // is over (before the result is stored and before the file is renamed to its final name).
      let result;
      const linked = await createNamedLink(current || media, abs);
      try {
        const started = Date.now();
        try {
          result = await transcribeLocalFile(linked ? linked.source : abs);
        } catch (err) {
          // ONE retry with the real path when the named path failed fast like an unreadable file - never on a timeout
          // or when the service is down.
          if (!(linked && Date.now() - started < FAST_FAILURE_MS && looksLikeUnreadableFile(err))) throw err;
          console.warn(`Transcript for ${media_id}: the named path was refused (${err.message}); retrying once with the stored file name.`);
          result = await transcribeLocalFile(abs);
        }
      } finally {
        if (linked) await removeTmpEntry(linked.dir);
      }
      const segments = Array.isArray(result.segments) ? result.segments : [];
      // The complete transcript is the API's `text` field, exactly as returned (only trimmed).
      // Only if the API sent no `text` at all is it rebuilt from the segments; the per-segment
      // timestamps are always kept as-is.
      let text = typeof result.text === 'string' ? result.text.trim() : '';
      if (!text && segments.length) text = segments.map(s => String(s.text || '').trim()).filter(Boolean).join(' ');
      await storage.updateMedia(media_id, {
        transcript_status: 'DONE',
        transcript_error: '',
        transcript: text,
        transcript_segments: segments,
        transcript_language: result.language || DEFAULT_LANGUAGE,
        duration_seconds: result.duration || null,
        ai_generated_description: text ? `Automatic transcript: ${excerpt(text)}` : 'No speech was detected in this video.'
      });
      // The ONE automatic trigger of the local AI (Gemma): a video's transcript just finished. A failure here must
      // never turn a finished transcript into a failed one.
      try {
        await queueMediaSummary(media_id);
      } catch (sumErr) {
        console.error(`Could not start the AI summary for ${media_id}:`, sumErr.message);
      }
    } catch (err) {
      console.error(`Transcription failed for ${media_id}:`, err.message);
      // Media may have been deleted while it was processing — don't resurrect it.
      try {
        if (await storage.getMediaById(media_id)) {
          await storage.updateMedia(media_id, { transcript_status: 'FAILED', transcript_error: err.message });
        }
      } catch (storeErr) {
        console.error(`Could not record transcription failure for ${media_id}:`, storeErr.message);
      }
    } finally {
      inFlight.delete(media_id);
    }
    // The file is free again: if nothing else is pending (transcript failed, or the summary is already final) it gets
    // its original upload name. While the AI summary is still queued/running this does nothing - that job renames it.
    await finalizeMediaFileName(media_id);
  })();

  return true;
}

// A server restart kills in-flight jobs, which would leave media stuck on PROCESSING forever.
async function resumeInterruptedTranscriptions() {
  (await storage.getAllMedia())
    .filter(m => m.transcript_status === 'PROCESSING')
    .forEach(m => queueMediaTranscription(m.media_id));
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  TIMEOUT_MS,
  transcribeLocalFile,
  isTranscribeApiReachable,
  unreachableMessage,
  queueMediaTranscription,
  resumeInterruptedTranscriptions,
  cleanupTranscribeTempDirs,
  TMP_DIR,
  resolveUploadPath,
  isTranscribeInFlight,
  UPLOADS_DIR
};
