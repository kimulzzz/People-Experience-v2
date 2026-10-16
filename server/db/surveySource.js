// server/db/surveySource.js
// Survey source of a SURVEY metric (px_metrics.survey_source, v2.29.0):
//   SYSTEM = data comes from another system / form (Arjuna, event evaluation forms, ...),
//   ESS    = Employee Sentiment Survey, always uploaded manually from the ESS template.
// Only meaningful for metric_type SURVEY; OUTCOME metrics always have NULL.
// Shared by sqlStorage.js, jsonStorage.js and calculationEngine.js so the rules are identical.

const SURVEY_SOURCES = ['SYSTEM', 'ESS'];

const isSurveyType = metricType => String(metricType || '').toUpperCase() === 'SURVEY';

// Old way of recognising ESS: the text "ESS" inside source_of_data. Used ONLY to fill a missing
// survey_source (boot top-up / import of an old store.json) and as a fallback when the column is empty.
const textLooksLikeEss = m => String((m && m.source_of_data) || '').toUpperCase().includes('ESS');

// Value to store for a SURVEY metric that has none yet.
function inferSurveySource(m) {
  if (!m || !isSurveyType(m.metric_type)) return null;
  return textLooksLikeEss(m) ? 'ESS' : 'SYSTEM';
}

// True when the metric is an ESS metric: the column decides; the text is only a fallback when the column is empty.
function isEssMetric(m) {
  if (!m) return false;
  if (m.survey_source === 'ESS') return true;
  if (m.survey_source === 'SYSTEM') return false;
  return textLooksLikeEss(m);
}

// Validates a value sent by an admin. Returns 'SYSTEM' | 'ESS', or null when nothing was sent (undefined / null / '').
// Anything else throws (the admin routes turn the Error into HTTP 400).
function parseSurveySource(value) {
  if (value === undefined || value === null || value === '') return null;
  const text = typeof value === 'string' ? value.trim().toUpperCase() : '';   // only text is accepted (not 5, ['ESS'], {})
  if (!SURVEY_SOURCES.includes(text)) throw new Error(`Survey Source must be one of: ${SURVEY_SOURCES.join(', ')}.`);
  return text;
}

// The survey_source to store. `requested` = what the admin sent (may be undefined), `current` = what the metric has now,
// `fallback` = used when a SURVEY metric has neither. OUTCOME metrics always get null.
function resolveSurveySource({ requested, metricType, current, fallback = 'SYSTEM' }) {
  const parsed = parseSurveySource(requested);     // validated even for OUTCOME, so a typo is never silently ignored
  if (!isSurveyType(metricType)) return null;
  return parsed || (SURVEY_SOURCES.includes(current) ? current : fallback);
}

// ESS data can only be uploaded by hand (it cannot be pulled from a system), so an ESS metric is always
// "requires_manual_upload". Explicitly asking for false on an ESS metric is an error; every other metric
// keeps the admin's choice (default = the old rule: SURVEY metrics need a manual upload).
function resolveRequiresManualUpload({ surveySource, requested, current, defaultValue }) {
  if (surveySource === 'ESS') {
    if (requested !== undefined && !Boolean(requested)) throw new Error('ESS data is always uploaded manually: requires_manual_upload cannot be turned off for an ESS metric.');
    return true;
  }
  if (requested !== undefined) return Boolean(requested);
  return current !== undefined ? Boolean(current) : defaultValue;
}

module.exports = { SURVEY_SOURCES, inferSurveySource, isEssMetric, parseSurveySource, resolveSurveySource, resolveRequiresManualUpload };
