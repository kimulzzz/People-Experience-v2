// server/services/aiQueue.js
// The ONE queue for every local-AI job (for now: video summaries). Ollama on this
// CPU-only server handles one generation at a time comfortably, so jobs run strictly one after the
// other. A job is identified by a key (e.g. "media:<id>"): a key that is
// already waiting or running is not added twice, and the number of waiting jobs is capped so work
// can never pile up without bound.
const MAX_PENDING = parseInt(process.env.AI_QUEUE_MAX || '50', 10);

const pending = [];          // [{ key, run }]
let running = null;          // key of the job being executed

function has(key) {
  return running === key || pending.some(j => j.key === key);
}

function status() {
  return { running, pending: pending.length, max_pending: MAX_PENDING };
}

async function drain() {
  if (running !== null) return;
  const job = pending.shift();
  if (!job) return;
  running = job.key;
  try {
    await job.run();
  } catch (err) {
    console.error(`[aiQueue] job ${job.key} failed:`, err.message);
  } finally {
    running = null;
    setImmediate(drain);
  }
}

// Adds a job. Returns 'queued', 'duplicate' (already waiting/running) or 'full' (queue at capacity —
// the caller must fall back to its rule-based result instead).
function enqueue(key, run) {
  if (has(key)) return 'duplicate';
  if (pending.length >= MAX_PENDING) return 'full';
  pending.push({ key, run });
  setImmediate(drain);
  return 'queued';
}

module.exports = { enqueue, has, status, MAX_PENDING };
