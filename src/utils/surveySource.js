// src/utils/surveySource.js
// Sumber survei sebuah metrik SURVEY (px_metrics.survey_source): SYSTEM = data dari sistem/form lain,
// ESS = Employee Sentiment Survey (template ESS, selalu di-upload manual). OUTCOME tidak punya sumber survei.
export const SURVEY_SOURCE_OPTIONS = [
  { value: 'SYSTEM', label: 'System' },
  { value: 'ESS', label: 'ESS Template' }
];

export function surveySourceLabel(value) {
  const opt = SURVEY_SOURCE_OPTIONS.find(o => o.value === value);
  return opt ? opt.label : '';
}

// Tailwind classes for the small badge (ESS = indigo, System = slate).
export function surveySourceBadgeClass(value) {
  return value === 'ESS'
    ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
    : 'bg-slate-100 text-slate-600 border border-slate-200';
}
