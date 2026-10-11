// server/services/transcribeService.js
// Audio/video -> text via the local faster-whisper API ("Video Extractor", POST /transcribe).
// 100% on-premise: the API runs on this machine and is handed a LOCAL FILE PATH, so the
// uploaded video never leaves the server. Transcription of a long video can take minutes on
// CPU, so callers must treat it as a background job (see queueMediaTranscription).
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const storage = require('../db/storage');

const API_URL = (process.env.TRANSCRIBE_API_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
const DEFAULT_LANGUAGE = process.env.TRANSCRIBE_LANGUAGE || 'id';
// Whisper on CPU is slow and the first request also downloads/loads the model — be generous.
const TIMEOUT_MS = parseInt(process.env.TRANSCRIBE_TIMEOUT_MS || String(30 * 60 * 1000), 10);
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const DESCRIPTION_EXCERPT_CHARS = 280;

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
        reject(new Error(typeof detail === 'string' ? detail : JSON.stringify(detail)));
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Transkrip melebihi batas waktu ${Math.round(timeoutMs / 60000)} menit`)));
    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') {
        return reject(new Error(`Layanan transkrip tidak aktif di ${API_URL}. Jalankan API Video Extractor lalu coba lagi.`));
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

function excerpt(text) {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  return clean.length > DESCRIPTION_EXCERPT_CHARS ? `${clean.slice(0, DESCRIPTION_EXCERPT_CHARS).trimEnd()}…` : clean;
}

// Resolves a stored `/uploads/<file>` web path to an absolute path, refusing anything that
// would escape the uploads folder.
function resolveUploadPath(filePath) {
  if (!filePath || !filePath.startsWith('/uploads/')) return null;
  const abs = path.resolve(UPLOADS_DIR, path.basename(filePath));
  return abs.startsWith(UPLOADS_DIR + path.sep) ? abs : null;
}

const inFlight = new Set();

// Fire-and-forget: marks the media PROCESSING, runs the transcription, then stores the
// result (DONE) or the failure reason (FAILED). The UI polls the event detail for the status.
async function queueMediaTranscription(media_id) {
  if (inFlight.has(media_id)) return false;
  const media = await storage.getMediaById(media_id);
  if (!media) return false;

  inFlight.add(media_id);
  await storage.updateMedia(media_id, { transcript_status: 'PROCESSING', transcript_error: '' });

  (async () => {
    try {
      const abs = resolveUploadPath(media.file_path);
      if (!abs || !fs.existsSync(abs)) throw new Error('File video tidak ditemukan di server');

      const result = await transcribeLocalFile(abs);
      const text = (result.text || '').trim();
      await storage.updateMedia(media_id, {
        transcript_status: 'DONE',
        transcript_error: '',
        transcript: text,
        transcript_segments: Array.isArray(result.segments) ? result.segments : [],
        transcript_language: result.language || DEFAULT_LANGUAGE,
        duration_seconds: result.duration || null,
        ai_generated_description: text ? `Transkrip otomatis: ${excerpt(text)}` : 'Tidak ada ucapan yang terdeteksi pada video ini.'
      });
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
  transcribeLocalFile,
  queueMediaTranscription,
  resumeInterruptedTranscriptions,
  resolveUploadPath,
  UPLOADS_DIR
};
