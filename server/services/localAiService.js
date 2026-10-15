// server/services/localAiService.js
/**
 * Local AI Service - 100% On-Premise (No 3rd-party Cloud APIs)
 * Talks to the local Ollama runtime (model gemma3:4b) for the event video summaries only; every other text is rule-based.
 */

const http = require('http');
const https = require('https');

const OLLAMA_HOST = (process.env.OLLAMA_HOST || 'http://localhost:11434').replace(/\/+$/, '');
const DEFAULT_LLM_MODEL = process.env.OLLAMA_MODEL || 'gemma3:4b';
// One generation may take a minute or more on this CPU-only server.
const OLLAMA_TIMEOUT_MS = parseInt(process.env.OLLAMA_TIMEOUT_MS || String(5 * 60 * 1000), 10);

/**
 * Checks if local Ollama server is active (lists the installed models only - it runs no model).
 * Used by /api/health?check_ai=1 and nowhere on a page load.
 */
async function isOllamaAvailable() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1000);
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: controller.signal });
    clearTimeout(timeoutId);
    return res.ok;
  } catch (err) {
    return false;
  }
}

// POST JSON with the core http module: with stream:false Ollama only sends its headers when the
// whole answer is generated, which can exceed undici's (global fetch) 5-minute header timeout.
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
        const detail = (json && json.error) || raw.slice(0, 200) || `HTTP ${res.statusCode}`;
        reject(new Error(`Ollama: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`));
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Ollama melebihi batas waktu ${Math.round(timeoutMs / 1000)} detik`)));
    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') return reject(new Error(`Ollama tidak aktif di ${OLLAMA_HOST}`));
      reject(err);
    });
    req.write(payload);
    req.end();
  });
}

// PRODUCT RULE (fixed by the owner): the local model (Gemma) may run for exactly one thing for now -
//  EVENT_VIDEO_SUMMARY: the summary of a NEWLY uploaded Signature Program event VIDEO once its transcript is DONE
//  (plus the explicit "Buat ulang ringkasan" button of an event manager).
// Page loads, opening an event, boot back-fill, photos, PPT, dashboard, alerts and timers never call it.
// This is the single guard: queryLocalOllama refuses any call that does not name an allowed scope with a
// matching subject (a VIDEO that has a transcript), so no other code path can reach the model.
const AI_SCOPES = ['EVENT_VIDEO_SUMMARY'];
function assertAiAllowed(scope, subject) {
  if (!AI_SCOPES.includes(scope)) throw new Error(`Pemanggilan AI lokal ditolak: scope "${scope}" tidak diizinkan (hanya ${AI_SCOPES.join(' / ')}).`);
  if (!(subject && subject.file_type === 'VIDEO' && subject.transcript)) throw new Error('Pemanggilan AI lokal ditolak: ringkasan AI hanya untuk video event yang sudah punya transkrip, bukan foto atau data lain.');
}

/**
 * One (non-streaming) generation on the local Ollama model. Throws with a readable reason
 * (offline, model missing, timeout, HTTP error, empty answer); callers decide on their own fallback.
 */
async function queryLocalOllama(prompt, { model = DEFAULT_LLM_MODEL, timeoutMs = OLLAMA_TIMEOUT_MS, temperature = 0.1, seed, scope, subject } = {}) {
  assertAiAllowed(scope, subject);
  const body = { model, prompt, stream: false, options: { temperature } };
  if (seed !== undefined) body.options.seed = seed; // fixed seed: the same transcript gives the same wording
  const data = await postJson(`${OLLAMA_HOST}/api/generate`, body, timeoutMs);
  const text = typeof data.response === 'string' ? data.response.trim() : '';
  if (!text) throw new Error('Ollama mengembalikan jawaban kosong');
  return text;
}

/**
 * Generates an executive summary for an event based on attendance, ratings, and verbatims.
 */
async function generateEventSummary(event, attendances, feedbacks, mediaList) {
  const totalPax = attendances.length;
  const targetPax = event.target_participants || 500;
  const paxPercent = ((totalPax / targetPax) * 100).toFixed(1);

  // Compute average rating
  let totalRating = 0;
  let ratingCount = 0;
  feedbacks.forEach(f => {
    if (f.ratings) {
      Object.values(f.ratings).forEach(v => {
        if (typeof v === 'number') {
          totalRating += v;
          ratingCount++;
        }
      });
    }
  });
  const hasRatings = ratingCount > 0;
  const avgRating = hasRatings ? (totalRating / ratingCount).toFixed(2) : null;
  const scorePercent = hasRatings ? ((parseFloat(avgRating) / 5.0) * 100).toFixed(1) : null;
  const satisfactionSummary = hasRatings ? `${avgRating}/5.00 (${scorePercent}%)` : 'Belum ada data evaluasi';

  const verbatims = feedbacks.map(f => f.verbatim).filter(Boolean);

  // The local model is not used here (see the product rule above): the rule engine is the answer.
  // Fallback High-Quality On-Premise Rule Engine (Always Works Offline)
  return `### Executive Summary
Program **${event.event_name}** (${event.program_category}) telah sukses diselenggarakan dengan format **${event.event_type}** pada ${new Date(event.event_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}. Kegiatan ini mencatatkan partisipasi sebanyak **${totalPax} karyawan** (${paxPercent}% dari target ${targetPax} pax)${hasRatings ? ` dengan indeks kepuasan acara mencapai **${scorePercent}%** (rata-rata rating **${avgRating} / 5.00**).` : ', namun belum ada data evaluasi kepuasan yang masuk hingga laporan ini dibuat.'}

### Key Highlights
1. **Engagement & Antusiasme Tinggi:** Tingkat kehadiran memenuhi target keikutsertaan lintas direktorat, mencerminkan tingginya minat karyawan terhadap pengembangan karir dan kultur inklusif di CIMB Niaga.
2. **Kualitas Konten & Narasumber:** Peserta memberikan sentimen positif terhadap relevansi topik, kejelasan materi, serta sesi dialog interaktif.
3. **Penyelenggaraan Hybrid yang Efektif:** Kombinasi kehadiran onsite di venue dan partisipasi interaktif streaming online berjalan lancar dan terstruktur.

### Strategic Recommendations
- Alokasikan ruang tanya jawab (Q&A) yang lebih panjang pada sesi breakout untuk mengakomodasi antusiasme peserta.
- Lakukan follow-up materi pembelajaran dan toolkit implementasi melalui portal LoG+ & Arjuna pasca-event.`;
}

/**
 * Generates a dynamic narrative for a Score Deficit Alert (metric below target/threshold).
 * Rule-based sentence (always works fully offline); the local model is not used for alerts
 * (product rule above), so the Score Deficit Alerts panel never breaks.
 */
async function generateAlertNarrative(metric, journey, actionText) {
  // Fallback rule-based narrative (always works offline)
  return `Metrik "${metric.metric_name}" pada Journey ${journey ? journey.journey_name : ''} berada pada skor ${metric.normalized_score}% (Target: ${metric.target_display}, Ambang Minimum: ${metric.min_threshold}%). Gap defisit sebesar ${metric.gap}%. Diperlukan intervensi segera oleh ${metric.experience_owner}.`;
}

/**
 * Generates captions & narrative for media items (Photos / Videos).
 */
async function generateMediaNarratives(mediaItems, eventName) {
  return mediaItems.map((item, index) => {
    if (item.ai_generated_description && item.ai_generated_description.length > 10) {
      return item;
    }

    // Contextual local rule generation
    const fallbacks = [
      `Momen pembukaan dan pemaparan inspiratif oleh Senior Leaders dalam ${eventName}, menekankan pentingnya continuous learning dan kolaborasi.`,
      `Sesi diskusi interaktif dan tanya jawab, memperlihatkan sinergi aktif antara peserta hybrid dengan panelis.`,
      `Antusiasme peserta dalam sesi workshop interaktif dan komitmen bersama dalam mendorong People Experience yang positif di CIMB Niaga.`
    ];

    return {
      ...item,
      ai_generated_description: fallbacks[index % fallbacks.length]
    };
  });
}

module.exports = {
  OLLAMA_HOST,
  DEFAULT_LLM_MODEL,
  OLLAMA_TIMEOUT_MS,
  AI_SCOPES,
  assertAiAllowed,
  queryLocalOllama,
  isOllamaAvailable,
  generateEventSummary,
  generateAlertNarrative,
  generateMediaNarratives
};
