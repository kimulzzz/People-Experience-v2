// src/utils/scoreTiers.js
// Tiered score (v2.54.0) - the same rule as server/db/scoreTiers.js, used only for the Admin form (validation + live preview)
// and the tier texts; the server computes every real score. Configuration: { unit: 'percent' | 'number',
// bounds: [{ min, op: '>=' | '>' }] x 4 (lower boundary of tiers 2..5) | null (not configured = N/A) }.

export const TIER_OPS = ['>=', '>'];

// The 4 boundaries as numbers, or null when they are not 4 strictly increasing positive numbers with a valid operator
export function validTierBounds(bounds) {
  if (!Array.isArray(bounds) || bounds.length !== 4) return null;
  const out = bounds.map(b => ({ min: String(b.min).trim() === '' ? NaN : Number(b.min), op: b.op }));
  if (out.some(b => !Number.isFinite(b.min) || b.min <= 0 || !TIER_OPS.includes(b.op))) return null;
  if (out.some((b, i) => i > 0 && b.min <= out[i - 1].min)) return null;
  return out;
}

const reaches = (v, b) => (b.op === '>' ? v > b.min : v >= b.min);

// { tier, score (0-5), percent (0-100) } of a value
export function tieredPercent(value, bounds) {
  const v = Math.max(Number(value) || 0, 0);
  let tier = 1;
  bounds.forEach((b, i) => { if (reaches(v, b)) tier = i + 2; });
  // v2.54.1: linear interpolation between boundaries (same rule as the server) - tier 1 = v / tier-2 boundary,
  // tier t = 2..4 = t + (v - lower) / (next - lower), tier 5 = 5
  const lower = tier === 1 ? null : bounds[tier - 2].min;
  const raw = tier === 1 ? v / bounds[0].min : tier === 5 ? 5 : tier + (v - lower) / (bounds[tier - 1].min - lower);
  return { tier, score: Math.min(Math.max(raw, 0), 5), percent: Math.min(Math.max((raw / 5) * 100, 0), 100) };
}

export const tierValue = (n, unit) => `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 4 })}${unit === 'percent' ? '%' : ''}`;

// The range of every tier, e.g. ["≤ 1%", "> 1% - ≤ 2%", ..., "> 3.5%"]
export function tierRanges(bounds, unit) {
  if (!bounds) return [];
  const lower = b => `${b.op === '>' ? '>' : '≥'} ${tierValue(b.min, unit)}`;
  const upper = b => `${b.op === '>' ? '≤' : '<'} ${tierValue(b.min, unit)}`;
  return [upper(bounds[0]), ...bounds.map((b, i) => (i < bounds.length - 1 ? `${lower(b)} - ${upper(bounds[i + 1])}` : lower(b)))];
}

// "Tier 1: ≤ 1% · Tier 2: > 1% - ≤ 2% · ..."
export function tierBandsText(bounds, unit) {
  return tierRanges(bounds, unit).map((r, i) => `Tier ${i + 1}: ${r}`).join(' · ');
}
