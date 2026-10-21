// server/db/scoreTiers.js
// Tiered score (v2.54.0), shared by both storage backends (validation of the stored configuration) and the calculation
// engine (the score). A metric is tier-scored when px_metrics.score_tiers holds a configuration (NULL = scored by its scale
// as before); its scale_type stays its native scale (a RATING_5 survey keeps its 1-5 answers):
//   { "unit": "percent" | "number", "bounds": [ { "min": 4000, "op": ">=" }, ... 4 entries ] | null }
// bounds = the lower boundary of tiers 2, 3, 4 and 5; op says whether the boundary itself already belongs to the higher
// tier (">=") or not (">"). bounds null = tiers not configured yet: the metric's value is N/A and it is left out of the
// index. unit only says how the values / bounds are shown and entered (a % metric stores percent numbers: 0.66 = 0.66%).
// A value gets the score of its tier, scaled within the tier by value / lower boundary of the tier:
//   tier 1: value / boundary 1 x 1 (no lower boundary: proportional to the tier-2 boundary)
//   tier t: value / boundary t-1 x t (t = 2..5)
//   percentage = score / 5 x 100, capped to 0..100 (e.g. 6400 -> tier 4 -> 6400 / 6000 x 4 = 4.27 -> 85.33%)

const TIER_UNITS = ['percent', 'number'];
const TIER_OPS = ['>=', '>'];
const TIER_BOUND_COUNT = 4;
const BOUNDS_ERROR = 'The tier boundaries must be 4 strictly increasing positive numbers (the lower boundary of tiers 2, 3, 4 and 5), each with the operator >= or >.';

const toNumber = v => (typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v.trim().replace(/%$/, '')) : NaN));

/**
 * A tier configuration sent by an Admin or read from the database: an object { unit, bounds } (or its JSON text). A plain
 * array of 4 numbers is read as unit "number" with ">=" boundaries. Returns the clean { unit, bounds } (bounds null = not
 * configured), null when nothing was given, or throws an Error (the admin routes answer 400).
 */
function parseTierConfig(value) {
  if (value === undefined || value === null || value === '') return null;
  let cfg = value;
  if (typeof cfg === 'string') {
    try { cfg = JSON.parse(cfg); } catch (_) { throw new Error('The tier configuration is not valid JSON.'); }
  }
  if (Array.isArray(cfg)) cfg = { unit: 'number', bounds: cfg.map(min => ({ min, op: '>=' })) };
  if (!cfg || typeof cfg !== 'object') throw new Error('The tier configuration must be { unit, bounds }.');
  const unit = cfg.unit === undefined || cfg.unit === null || cfg.unit === '' ? 'number' : String(cfg.unit).toLowerCase();
  if (!TIER_UNITS.includes(unit)) throw new Error('The tier unit must be "percent" or "number".');
  if (cfg.bounds === undefined || cfg.bounds === null) return { unit, bounds: null };
  if (!Array.isArray(cfg.bounds) || cfg.bounds.length !== TIER_BOUND_COUNT) throw new Error(BOUNDS_ERROR);
  const bounds = cfg.bounds.map(b => {
    const min = toNumber(b && typeof b === 'object' ? b.min : b);
    const op = b && typeof b === 'object' && b.op !== undefined ? String(b.op).trim() : '>=';
    if (!Number.isFinite(min) || min <= 0 || !TIER_OPS.includes(op)) throw new Error(BOUNDS_ERROR);
    return { min, op };
  });
  if (bounds.some((b, i) => i > 0 && b.min <= bounds[i - 1].min)) throw new Error(BOUNDS_ERROR);
  return { unit, bounds };
}

// The stored configuration as an object, or null (not tier-scored / unreadable) - never throws (reading the database).
function readTierConfig(stored) {
  try { return parseTierConfig(stored); } catch (_) { return null; }
}

// The configuration to store when a metric is created / edited: the requested one (validated, an Error on bad input), or the
// stored one when nothing (undefined / null) was sent - tiered scoring is switched on per metric by the seed / boot, not off.
function resolveTierConfig(requested, current) {
  if (requested === undefined || requested === null) return readTierConfig(current);
  return parseTierConfig(requested);
}

// true when the value reaches boundary b
const reaches = (v, b) => (b.op === '>' ? v > b.min : v >= b.min);

/**
 * Score of a value for configured boundaries: { tier (1-5), lower_bound (null for tier 1), score (0-5, capped),
 * score_uncapped, percent (0-100) }.
 */
function tieredScore(value, bounds) {
  const v = Math.max(parseFloat(value) || 0, 0);
  let tier = 1;
  bounds.forEach((b, i) => { if (reaches(v, b)) tier = i + 2; });
  const lowerBound = tier === 1 ? null : bounds[tier - 2].min;
  const scoreUncapped = tier === 1 ? v / bounds[0].min : (v / lowerBound) * tier;
  return {
    tier,
    lower_bound: lowerBound,
    score: Math.min(Math.max(scoreUncapped, 0), 5),
    score_uncapped: scoreUncapped,
    percent: Math.min(Math.max((scoreUncapped / 5) * 100, 0), 100)
  };
}

module.exports = { TIER_UNITS, TIER_OPS, TIER_BOUND_COUNT, parseTierConfig, readTierConfig, resolveTierConfig, tieredScore };
