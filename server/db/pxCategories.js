// server/db/pxCategories.js
// PX Index categories (v2.63.0): the label shown next to the PX Index on the Dashboard, by score range. Stored in
// px_app_settings.px_index_categories = [{ label, min, color }], highest range first; a category covers min <= score < the min of
// the one above it (the first one up to 100), the last one starts at 0. Edited in Admin Parameters -> Journey Parameters.
const MAX_CATEGORIES = 10;
const MAX_LABEL = 40;
const COLOR_RE = /^#[0-9a-f]{6}$/i;

const DEFAULT_PX_CATEGORIES = [
  { label: 'Exceptional', min: 85, color: '#15803D' },
  { label: 'Strong', min: 75, color: '#0F766E' },
  { label: 'Moderate', min: 65, color: '#A16207' },
  { label: 'Needs Improvement', min: 50, color: '#C2410C' },
  { label: 'Critical', min: 0, color: '#B91C1C' }
];

// null when valid, else the reason (400)
function pxCategoriesError(value) {
  if (!Array.isArray(value)) return 'The value must be a list of { label, min, color }.';
  if (value.length < 2 || value.length > MAX_CATEGORIES) return `Use 2 to ${MAX_CATEGORIES} categories.`;
  const labels = new Set();
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (!c || typeof c !== 'object' || Array.isArray(c)) return `Category ${i + 1} must be { label, min, color }.`;
    const label = typeof c.label === 'string' ? c.label.trim() : '';
    if (!label || label.length > MAX_LABEL) return `Category ${i + 1}: the label is required (max ${MAX_LABEL} characters).`;
    if (labels.has(label.toLowerCase())) return `The label "${label}" is used more than once.`;
    labels.add(label.toLowerCase());
    if (typeof c.min !== 'number' || !Number.isFinite(c.min) || c.min < 0 || c.min >= 100) return `"${label}": the lower limit must be a number from 0 to less than 100.`;
    if (Math.round(c.min * 100) / 100 !== c.min) return `"${label}": the lower limit can have at most 2 decimals.`;
    if (i > 0 && c.min >= value[i - 1].min) return `"${label}": the lower limits must go down from one category to the next (${c.min} is not below ${value[i - 1].min}).`;
    if (typeof c.color !== 'string' || !COLOR_RE.test(c.color)) return `"${label}": the color must look like #15803D.`;
  }
  if (value[value.length - 1].min !== 0) return 'The last category must start at 0, so that every score has a category.';
  return null;
}

// The list as it is stored (trimmed labels, upper-case colors, no other fields)
const normalizePxCategories = value => value.map(c => ({ label: c.label.trim(), min: c.min, color: c.color.toUpperCase() }));

// The category of a score, or null without a score: { label, color, min, max (exclusive; 100 inclusive for the first), range_label }
function pxCategoryFor(score, categories) {
  if (score === null || score === undefined || !Number.isFinite(score)) return null;
  const list = pxCategoriesError(categories) ? DEFAULT_PX_CATEGORIES : categories;
  const i = list.findIndex(c => score >= c.min);
  if (i < 0) return null;
  const c = list[i];
  const max = i === 0 ? 100 : list[i - 1].min;
  return { label: c.label, color: c.color, min: c.min, max, range_label: i === 0 ? `>= ${c.min} - 100` : (c.min === 0 ? `< ${max}` : `>= ${c.min} - < ${max}`) };
}

module.exports = { DEFAULT_PX_CATEGORIES, MAX_CATEGORIES, pxCategoriesError, normalizePxCategories, pxCategoryFor };
