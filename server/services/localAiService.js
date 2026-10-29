// server/services/localAiService.js
/**
 * Local AI Service - 100% On-Premise (No 3rd-party Cloud APIs)
 * Talks to the local Ollama runtime (model gemma3:4b) for the event video summaries only; every other text is rule-based.
 */

const http = require('http');
const https = require('https');

const OLLAMA_HOST = (process.env.OLLAMA_HOST || 'http://localhost:11434').replace(/\/+$/, '');
const DEFAULT_LLM_MODEL = process.env.OLLAMA_MODEL || 'gemma3:4b';
// One generation may take a long time on this CPU-only server: limit 120 minutes (override: OLLAMA_TIMEOUT_MS).
const DEFAULT_AI_TIMEOUT_MS = 120 * 60 * 1000;
const OLLAMA_TIMEOUT_MS = parseInt(process.env.OLLAMA_TIMEOUT_MS || String(DEFAULT_AI_TIMEOUT_MS), 10);

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
        const err = new Error(`Ollama: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
        err.status = res.statusCode;
        err.ollamaError = typeof detail === 'string' ? detail : JSON.stringify(detail);
        reject(err);
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Ollama did not answer within the ${Math.round(timeoutMs / 60000)} minutes limit`)));
    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') return reject(new Error(`Ollama is not running at ${OLLAMA_HOST}`));
      reject(err);
    });
    req.write(payload);
    req.end();
  });
}

// PRODUCT RULE (fixed by the owner): the local model (Gemma) may run for exactly one thing for now -
//  EVENT_VIDEO_SUMMARY: the summary of a NEWLY uploaded Signature Program event VIDEO once its transcript is DONE
//  (plus the explicit "Regenerate summary" button of an event manager).
// Page loads, opening an event, boot back-fill, photos, PPT, dashboard, alerts and timers never call it.
// This is the single guard: queryLocalOllama refuses any call that does not name an allowed scope with a
// matching subject (a VIDEO that has a transcript), so no other code path can reach the model.
const AI_SCOPES = ['EVENT_VIDEO_SUMMARY'];
function assertAiAllowed(scope, subject) {
  if (!AI_SCOPES.includes(scope)) throw new Error(`Local AI call refused: scope "${scope}" is not allowed (only ${AI_SCOPES.join(' / ')}).`);
  if (!(subject && subject.file_type === 'VIDEO' && subject.transcript)) throw new Error('Local AI call refused: the AI summary is only for event videos that already have a transcript, not photos or other data.');
}

/**
 * One (non-streaming) generation on the local Ollama model. Throws with a readable reason
 * (offline, model missing, timeout, HTTP error, empty answer); callers decide on their own fallback.
 */
async function queryLocalOllama(prompt, { model = DEFAULT_LLM_MODEL, timeoutMs = OLLAMA_TIMEOUT_MS, temperature = 0.1, seed, format, numCtx, numPredict, repeatPenalty, repeatLastN, details = false, scope, subject } = {}) {
  assertAiAllowed(scope, subject);
  const body = { model, prompt, stream: false, options: { temperature } };
  if (seed !== undefined) body.options.seed = seed; // fixed seed: the same transcript gives the same wording
  // v2.60.0 (topic summary of a long video): JSON-only answer, a context window that fits the input, an output cap.
  // v2.60.3: `format` is a JSON schema object there (Ollama structured outputs), passed on unchanged.
  if (format) body.format = format;
  if (numCtx) body.options.num_ctx = numCtx;
  if (numPredict) body.options.num_predict = numPredict;
  // v2.60.0: repetition guard for a retry after the model looped on the same tokens
  if (repeatPenalty) body.options.repeat_penalty = repeatPenalty;
  if (repeatLastN) body.options.repeat_last_n = repeatLastN;
  const data = await postJson(`${OLLAMA_HOST}/api/generate`, body, timeoutMs);
  const text = typeof data.response === 'string' ? data.response.trim() : '';
  if (!text) {
    const err = new Error('Ollama returned an empty answer');
    err.soft = true;
    throw err;
  }
  // details: also why the generation stopped (done_reason "stop" / "length" ...) - used to explain an unusable answer in the log
  return details ? { text, doneReason: data.done_reason || null, evalCount: data.eval_count ?? null } : text;
}

// v2.60.0: a failure of ONE generation - Ollama aborted it because the model looped on repeated tokens ("prediction aborted,
// token repeat limit reached") or the answer was empty. Another attempt can succeed, so callers treat it like an unusable answer
// (their one retry). Everything else - not running / connection reset / timeout / model missing / other HTTP errors - is hard.
const SOFT_GENERATION_RE = /token repeat limit|prediction aborted|repeat(ed|ing)? tokens?/i;
function isSoftGenerationError(err) {
  return !!(err && (err.soft || (err.ollamaError && SOFT_GENERATION_RE.test(err.ollamaError))));
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
  const satisfactionSummary = hasRatings ? `${avgRating}/5.00 (${scorePercent}%)` : 'No evaluation data yet';

  const verbatims = feedbacks.map(f => f.verbatim).filter(Boolean);

  // The local model is not used here (see the product rule above): the rule engine is the answer.
  // Fallback High-Quality On-Premise Rule Engine (Always Works Offline)
  return `### Executive Summary
The program **${event.event_name}** (${event.program_category}) was held successfully in **${event.event_type}** format on ${new Date(event.event_date).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })}. The event recorded **${totalPax} employees** attending (${paxPercent}% of the ${targetPax} pax target)${hasRatings ? ` with an event satisfaction index of **${scorePercent}%** (average rating **${avgRating} / 5.00**).` : ', but no satisfaction evaluation data had come in by the time this report was created.'}

### Key Highlights
1. **High Engagement & Enthusiasm:** Attendance met the cross-directorate participation target, reflecting strong employee interest in career development and an inclusive culture at CIMB Niaga.
2. **Content & Speaker Quality:** Participants gave positive sentiment on topic relevance, clarity of the material, and the interactive dialogue sessions.
3. **Effective Hybrid Delivery:** The combination of onsite attendance at the venue and interactive online streaming participation ran smoothly and in an orderly way.

### Strategic Recommendations
- Allocate a longer Q&A slot in breakout sessions to accommodate participant enthusiasm.
- Follow up with learning materials and an implementation toolkit through the LoG+ & Arjuna portals after the event.`;
}

/**
 * Generates a dynamic narrative for a Score Deficit Alert (metric below target/threshold).
 * Rule-based sentence (always works fully offline); the local model is not used for alerts
 * (product rule above), so the Score Deficit Alerts panel never breaks.
 */
async function generateAlertNarrative(metric, journey, actionText) {
  // Fallback rule-based narrative (always works offline)
  return `Metric "${metric.metric_name}" in the ${journey ? journey.journey_name : ''} Journey is at a score of ${metric.normalized_score}% (Target: ${metric.target_display}, Minimum Threshold: ${metric.min_threshold}%). The deficit gap is ${metric.gap}%. Immediate intervention by ${metric.experience_owner} is required.`;
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
      `Opening moment and inspiring talk by Senior Leaders at ${eventName}, stressing the importance of continuous learning and collaboration.`,
      `Interactive discussion and Q&A session, showing active synergy between the hybrid participants and the panelists.`,
      `Participant enthusiasm in the interactive workshop session and a shared commitment to driving a positive People Experience at CIMB Niaga.`
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
  DEFAULT_AI_TIMEOUT_MS,
  OLLAMA_TIMEOUT_MS,
  AI_SCOPES,
  assertAiAllowed,
  queryLocalOllama,
  isSoftGenerationError,
  isOllamaAvailable,
  generateEventSummary,
  generateAlertNarrative,
  generateMediaNarratives
};
