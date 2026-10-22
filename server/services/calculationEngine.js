// server/services/calculationEngine.js
const storage = require('../db/storage');
const { getQuestionsForMetric } = require('./metricQuestionService');
const { isEssMetric } = require('../db/surveySource');
const { selectEssResult, essOrgFor, essOriginalFilePath } = require('./essSummaryService');
const { periodWindow } = require('../db/filterUtils');
const { isSocialMediaMetric, hasSocialMediaDrilldown, getSocialMediaDrilldown } = require('./socialMediaService');
const { readTierConfig, tieredScore } = require('../db/scoreTiers');
const { isOutcomeUploadMetric, evidenceTypeOf, selectOutcomeValue, loadLastUpdateContext, lastUpdateFor, aggregationOf } = require('./outcomeValueService');
const { isDataNotAvailable, DATA_NOT_AVAILABLE_REASON } = require('../db/dataStatus');
const { partsByMetric, compositeValue } = require('./metricPartsService');
const { displayNumberMap, loadDisplayNumbers } = require('../db/metricNumbers');

// Default year for YTD/unparseable period requests, derived from the real server clock
// instead of a hardcoded literal — this dataset happens to be seeded for 2026 (today's real
// year while this app is in active use), so this resolves to '2026' today and will track
// forward automatically rather than silently freezing on a past year.
const CURRENT_YEAR = String(new Date().getFullYear());

// Real "today" as YYYY-MM-DD, used as the last-resort fallback when a metric/response has no
// real date at all (e.g. a brand-new metric created via Admin with no survey/ingestion history
// yet) — instead of a frozen calendar literal that would otherwise display as a permanently
// stale "last updated" date once that specific day has passed.
function todayDateString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// PX Index weights (v2.48.0): px_app_settings.px_index_weights = { survey, outcome }, whole percentages that add up to
// 100 (Admin Parameters -> Index Weights). One calculation can run calculatePEIndex dozens of times (trend months,
// directorates), so the setting is cached for PX_WEIGHTS_CACHE_MS; PUT /api/admin/settings clears the cache of this
// process at once (another backend on the same database picks the new value up within PX_WEIGHTS_CACHE_MS).
// The fallback is only used when the stored value is missing/invalid (the seed writes 70/30 once).
const FALLBACK_PX_WEIGHTS = { survey: 70, outcome: 30 };
const PX_WEIGHTS_CACHE_MS = 30 * 1000;
let pxWeightsCache = { value: null, at: 0 };

// null when valid, else the reason (shared with the settings route)
function pxWeightsError(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'The value must be { survey, outcome }.';
  const { survey, outcome } = value;
  if (![survey, outcome].every(n => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 100)) {
    return 'Survey and Outcome weights must be whole numbers between 0 and 100.';
  }
  if (survey + outcome !== 100) return 'Survey and Outcome weights must add up to 100.';
  return null;
}

async function getPxWeights() {
  if (pxWeightsCache.value && Date.now() - pxWeightsCache.at < PX_WEIGHTS_CACHE_MS) return pxWeightsCache.value;
  const stored = (await storage.getSettings()).px_index_weights;
  const value = pxWeightsError(stored) ? { ...FALLBACK_PX_WEIGHTS } : { survey: stored.survey, outcome: stored.outcome };
  pxWeightsCache = { value, at: Date.now() };
  return value;
}
function clearPxWeightsCache() { pxWeightsCache = { value: null, at: 0 }; }

/**
 * Normalizes raw metric value into 0-100 scale based on scale type.
 */
function normalizeScore(metric, rawValue = null) {
  const value = rawValue !== null ? parseFloat(rawValue) : parseFloat(metric.raw_value || 0);
  const target = parseFloat(metric.target_value || 100);

  // v2.54.0: a tier-scored metric (score_tiers set) is scored by its tiers, whatever its scale; tiers not configured yet ->
  // null (N/A, left out of the index)
  const tierCfg = readTierConfig(metric.score_tiers);
  if (tierCfg) return tierCfg.bounds ? tieredScore(value, tierCfg.bounds).percent : null;

  switch (metric.scale_type) {
    case 'RATING_5':
      // Scale 1-5 to 0-100%
      return Math.min(Math.max((value / 5.0) * 100, 0), 100);

    case 'QUOTA_COUNT':
      // % Achievement towards quota target
      if (target <= 0) return 100;
      return Math.min(Math.max((value / target) * 100, 0), 100);


    case 'PERCENTAGE':
    case 'NUMERIC':
    default:
      return Math.min(Math.max(value, 0), 100);
  }
}

/**
 * Converts a metric's target_value into the same normalized 0-100 scale as
 * normalizeScore()'s output, so status thresholds can compare apples to apples.
 * Without this, a RATING_5 metric's raw target (e.g. 4.00 on a 1-5 scale) was being
 * compared directly against a 0-100 normalized score — a target of "4" is virtually
 * never exceeded by a 0-100 value, so the WARNING band silently never triggered for
 * any RATING_5/QUOTA_COUNT metric (only CRITICAL vs HEALTHY was reachable).
 */
function normalizeTarget(metric, targetConfig) {
  return normalizeScore({ ...metric, ...targetConfig }, parseFloat(targetConfig.target_value || 0));
}

/**
 * v2.54.0: how a tier-scored value was scored, for the UI ("6,400 -> tier 4 -> 4.27 / 5 = 85.33%"); null for a metric that is
 * not tier-scored, whose tiers are not configured, or without a value.
 */
function tierInfo(metric, rawValue) {
  const cfg = readTierConfig(metric.score_tiers);
  if (!cfg || !cfg.bounds || rawValue === null || rawValue === undefined) return null;
  const tiers = cfg.bounds;
  const t = tieredScore(rawValue, tiers);
  return {
    value: parseFloat(parseFloat(rawValue).toFixed(4)),
    tier: t.tier,
    lower_bound: t.lower_bound,
    score: parseFloat(t.score.toFixed(2)),
    score_uncapped: parseFloat(t.score_uncapped.toFixed(4)),
    percent: parseFloat(t.percent.toFixed(2)),
    capped: t.score_uncapped > 5,
    unit: cfg.unit,
    bounds: tiers
  };
}

// v2.54.0: the extra fields of an OUTCOME metric - which evidence it offers, whether the Admin can upload monthly values,
// and (when it has stored months) the month the period is scored with.
// v2.55.0: outcome_aggregation LATEST | AVERAGE (AVERAGE: the average of the months in the window, e.g. "Average of 7 months
// (Mar-Sep 2026)"; the Admin uploads one year as a row of months).
function outcomeFields(m, { basis = null, pick = null } = {}) {
  if (m.metric_type !== 'OUTCOME') return {};
  return {
    evidence_type: evidenceTypeOf(m),
    outcome_upload: isOutcomeUploadMetric(m),
    ...(isOutcomeUploadMetric(m) ? {
      value_basis: basis,                                    // 'MONTHLY_VALUES' (uploaded months) | 'STATIC_SNAPSHOT' (raw_value)
      outcome_aggregation: aggregationOf(m),
      outcome_period: pick ? pick.period : null,
      outcome_period_label: pick ? pick.period_label : null,
      outcome_value_source: pick ? pick.row.source : null,
      outcome_months_count: pick ? pick.months : null,
      outcome_average_label: pick ? pick.average_label : null
    } : {})
  };
}

/**
 * Syncs event live participation & satisfaction scores into Metric 11 & Metric 12.
 */
async function syncLiveEventMetrics() {
  const events = await storage.getEvents();
  if (!events || events.length === 0) return;

  let totalAttendees = 0;
  let totalRatingSum = 0;
  let totalRatingCount = 0;

  // Per-event reads are independent, so fetch them together (matters for the SQL backend,
  // where each read is a round trip).
  const perEvent = await Promise.all(events.map(async event => ({
    atts: (await storage.getAttendancesByEvent(event.event_id)) || [],
    feedbacks: (await storage.getFeedbackByEvent(event.event_id)) || []
  })));

  perEvent.forEach(({ atts, feedbacks }) => {
    totalAttendees += atts.length;

    feedbacks.forEach(f => {
      if (f.ratings) {
        Object.values(f.ratings).forEach(val => {
          if (val && typeof val === 'number') {
            totalRatingSum += val;
            totalRatingCount += 1;
          }
        });
      }
    });
  });

  if (totalAttendees > 0) {
    const avgAttendance = totalAttendees / events.length;
    // Denominator is Metric 11's own admin-configurable target (Admin Parameters →
    // Target Nilai), not a frozen literal — so editing the target there immediately changes
    // how live event attendance is normalized, instead of silently comparing against a stale
    // hardcoded quota.
    const metric11Target = (await storage.getMetricTargetById(11)) || (await storage.getMetricById(11));
    const quotaTarget = parseFloat((metric11Target && metric11Target.target_value) || 500);
    const normScore = quotaTarget > 0 ? Math.min((avgAttendance / quotaTarget) * 100, 100) : 0;
    await storage.updateMetricScore(11, avgAttendance, normScore, 'Calculated from live event registrations');
  }

  // v2.55.0: metric 12 is scored from its uploaded summary (composite part) - the event feedback no longer overwrites it
  const metric12Summary = (await storage.getMetricParts(12)).length > 0;
  if (totalRatingCount > 0 && !metric12Summary) {
    const avgRating = totalRatingSum / totalRatingCount;
    const normScore = (avgRating / 5.0) * 100;
    await storage.updateMetricScore(12, avgRating.toFixed(2), normScore.toFixed(2), 'Calculated from live event evaluations');
  }
}

function normalizeDateString(dateVal) {
  if (!dateVal) return null;
  const str = String(dateVal).trim();
  if (!str || str === '-' || str === 'null' || str === 'undefined') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    const p1 = parseInt(slashMatch[1], 10);
    const p2 = parseInt(slashMatch[2], 10);
    const year = slashMatch[3];
    let month, day;
    if (p1 > 12) {
      day = String(p1).padStart(2, '0');
      month = String(p2).padStart(2, '0');
    } else {
      month = String(p1).padStart(2, '0');
      day = String(p2).padStart(2, '0');
    }
    return `${year}-${month}-${day}`;
  }
  const dashMatch = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (dashMatch) {
    const p1 = parseInt(dashMatch[1], 10);
    const p2 = parseInt(dashMatch[2], 10);
    const year = dashMatch[3];
    let month, day;
    if (p1 > 12) {
      day = String(p1).padStart(2, '0');
      month = String(p2).padStart(2, '0');
    } else if (p2 > 12) {
      month = String(p1).padStart(2, '0');
      day = String(p2).padStart(2, '0');
    } else {
      day = String(p1).padStart(2, '0');
      month = String(p2).padStart(2, '0');
    }
    return `${year}-${month}-${day}`;
  }
  try {
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) {
      const y = parsed.getFullYear();
      const m = String(parsed.getMonth() + 1).padStart(2, '0');
      const d = String(parsed.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  } catch (e) {}
  return str;
}

const round2 = v => (v === null || v === undefined ? null : parseFloat(v.toFixed(2)));

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

/**
 * Determines the last COMPLETE calendar month (1-based, e.g. 8 = August) for a given target
 * year, relative to the real server clock. A month in progress isn't final yet, so it (and
 * anything after it) is never eligible to appear on the Performance Trend chart:
 * - Target year in the past → the whole year (12) already happened.
 * - Target year in the future → nothing has happened yet (0 — no valid months).
 * - Target year = this year → up through last month (this month is still in progress).
 */
function getLastCompleteMonth(targetYear) {
  const today = new Date();
  const todayYear = today.getFullYear();
  const y = parseInt(targetYear, 10);
  if (y < todayYear) return 12;
  if (y > todayYear) return 0;
  return today.getMonth(); // 0-based getMonth() == 1-based number of the PREVIOUS month
}

/**
 * Clamps a (year, month) pair so it never points at the current in-progress month or any
 * future month — walking backward a year at a time if the whole requested year hasn't
 * happened yet (e.g. requesting 2027 today resolves to December of the last real year).
 */
function clampToCompleteMonth(year, month) {
  let y = parseInt(year, 10);
  let m = parseInt(month, 10);
  if (!Number.isFinite(y)) y = parseInt(CURRENT_YEAR, 10);
  if (!Number.isFinite(m)) m = 1;

  let lastComplete = getLastCompleteMonth(y);
  // Walk backward through fully-future years until we land on one with at least one
  // complete month (guards against pathological input like year 3000).
  let guard = 0;
  while (lastComplete < 1 && guard < 50) {
    y -= 1;
    lastComplete = getLastCompleteMonth(y);
    guard += 1;
  }
  m = Math.min(Math.max(m, 1), lastComplete || 12);
  return { year: y, month: m };
}

/**
 * Builds an inclusive, chronologically-ordered list of {year, month} pairs from a start
 * point through an end point — the backbone of cross-year Performance Trend ranges (e.g.
 * November 2025 s/d Februari 2026). Capped at 240 months (20 years) as a sanity guard
 * against runaway input.
 */
function buildMonthRange(startYear, startMonth, endYear, endMonth) {
  const pairs = [];
  let y = startYear;
  let m = startMonth;
  let guard = 0;
  while ((y < endYear || (y === endYear && m <= endMonth)) && guard < 240) {
    pairs.push({ year: y, month: m });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    guard += 1;
  }
  return pairs;
}

/**
 * Computes a Performance Trend progression across a caller-chosen date range — which CAN
 * span multiple years (e.g. November 2025 s/d Februari 2026) — never including the current
 * in-progress month or any future month, since that data isn't final yet.
 *
 * `filterOptions.mode` controls the shape of each point, mirroring the Dashboard's YTD/MTD
 * toggle:
 * - `'YTD'` (default): each point is the CUMULATIVE Year-to-Date average from January of
 *   ITS OWN year through that month — a running progression that resets every January 1st
 *   (standard YTD reporting convention), converging toward that year's final YTD figure.
 *   A cross-year range therefore shows each year's own YTD curve back-to-back, not one
 *   running total spanning both years (which wouldn't be a meaningful "YTD" any more).
 * - `'MTD'`: each point is that SINGLE month's own standalone average — pure month-to-month
 *   movement, independent of any other month, so a cross-year range here is trivial.
 *
 * Range params (1-based month strings/numbers, e.g. "01".."12"):
 * - `filterOptions.year` / `filterOptions.startMonth` — default start (year defaults to the
 *   real current year, startMonth defaults to January of that year).
 * - `filterOptions.endYear` / `filterOptions.endMonth` — default end (defaults to the last
 *   complete month of `filterOptions.year`). `endYear`/`endMonth` are ALWAYS clamped so the
 *   range can never reach an in-progress or future month, however far it's requested to go.
 * - `filterOptions.startYear` overrides the start year independently of `filterOptions.year`
 *   (which remains the scorecard's own primary year) — this is what enables a genuinely
 *   cross-year range from the chart's period-range filter.
 */
async function computeMonthlyTrends(filterOptions = {}) {
  const directorate = filterOptions.directorate || 'ALL';
  const subDirectorate = filterOptions.sub_directorate || filterOptions.subDirectorate || 'ALL';
  const scopes = Array.isArray(filterOptions.scopes) ? filterOptions.scopes : null; // union data scope of a USER
  const trendMode = (filterOptions.mode || 'YTD').toUpperCase() === 'MTD' ? 'MTD' : 'YTD';

  // Default year for whichever endpoint isn't explicitly given — the real current year, NOT
  // a hardcoded '2026', so this keeps working correctly once the calendar moves past 2026.
  const defaultYear = filterOptions.year ? parseInt(filterOptions.year, 10) : parseInt(CURRENT_YEAR, 10);

  const rawStartYear = filterOptions.startYear ? parseInt(filterOptions.startYear, 10) : defaultYear;
  const rawStartMonth = filterOptions.startMonth ? parseInt(filterOptions.startMonth, 10) : 1;
  const rawEndYear = filterOptions.endYear ? parseInt(filterOptions.endYear, 10) : defaultYear;
  const rawEndMonth = filterOptions.endMonth ? parseInt(filterOptions.endMonth, 10)
    : getLastCompleteMonth(rawEndYear);

  let start = clampToCompleteMonth(rawStartYear, rawStartMonth);
  let end = clampToCompleteMonth(rawEndYear, rawEndMonth);

  // Reconcile an inverted range (start after end) by swapping, rather than erroring —
  // callers (including bad/negative-test input) always get a sane, non-crashing response.
  const startKey = start.year * 100 + start.month;
  const endKey = end.year * 100 + end.month;
  if (startKey > endKey) { const tmp = start; start = end; end = tmp; }

  const pairs = buildMonthRange(start.year, start.month, end.year, end.month);

  // Live-event metrics (11 & 12) are synced once here; the per-month calls below skip it.
  await syncLiveEventMetrics();

  // Months are independent of each other, so they are computed together (Promise.all keeps
  // the original month order in its result).
  return Promise.all(pairs.map(async ({ year, month }) => {
    const idx = month - 1; // 0-based, for month-name lookup
    const monthNum = String(month).padStart(2, '0');
    const yearStr = String(year);
    const code = `${yearStr}-${monthNum}`;

    // Delegate to calculatePEIndex so every trend point uses the EXACT same per-metric,
    // weighted, scale-aware normalization as the main scorecard — this is what keeps the
    // chart consistent with the "CIMB Niaga PX Index" number shown above it (previously this
    // used a simplistic pooled raw-average across all responses regardless of metric scale
    // type, which could diverge sharply, e.g. ~59% on the chart vs ~83% YTD scorecard for the
    // same period). For YTD mode, `endMonth` bounds the cumulative window to Jan..month of
    // THIS point's own `year` — never spilling over into a prior/next year's data.
    const periodFilter = trendMode === 'MTD'
      ? { mode: 'MTD', year: yearStr, month: monthNum, directorate, sub_directorate: subDirectorate, scopes }
      : { mode: 'YTD', year: yearStr, endMonth: monthNum, directorate, sub_directorate: subDirectorate, scopes };
    const periodResult = await calculatePEIndex(periodFilter, { skipTrends: true });

    const responseCount = periodResult.metrics
      .filter(mt => mt.metric_type === 'SURVEY' && !mt.is_disabled)
      .reduce((sum, mt) => sum + (mt.sample_size || 0), 0);

    return {
      month_code: code,
      month_name: MONTH_NAMES[idx],
      year: yearStr,
      has_actual_data: responseCount > 0,
      response_count: responseCount,
      // A month without any survey data is a gap in the chart (null), not an Outcome-only PX value (v2.36.0):
      // the Outcome Index is a flat snapshot, so plotting it alone would look like a sudden drop.
      survey_index: periodResult.survey_index,
      outcome_index: periodResult.outcome_index,
      px_index: periodResult.survey_index === null ? null : periodResult.px_index,
      pe_index: periodResult.survey_index === null ? null : periodResult.px_index // backward compatibility
    };
  }));
}

/**
 * Calculates full PX Index consolidation based on active filter options:
 * - Mode: 'YTD' (default) -> Aggregates data for the selected year
 * - Mode: 'MTD' -> Filters data specific to selected year and month
 * - Directorate / Sub-Directorate: When selected, the employee metrics are read for that unit and the
 *   non-employee metrics (#1-#5 ...) at their bankwide value (both count in the index, v2.48.0).
 */
/**
 * The directorate whose ESS row applies to a filter: the filter's directorate, or - for a division filter without a
 * directorate - the division's parent directorate ('__NONE__' when the division is unknown, i.e. no ESS data).
 * Scopes (USER) are handled by essOrgFor itself.
 */
// The window of an ESS metric (v2.50.0): the selected window, with basis LATEST_RESULT (the latest ESS result on or before
// its end is used, see essSummaryService.selectEssResult).
const essWindow = mp => ({ ...(periodWindow(mp) || { from: null, to: null }), basis: 'LATEST_RESULT' });
// The window of an OUTCOME metric with uploaded monthly values (v2.54.0): the latest stored month inside it (MTD = that month)
// basis: MONTH (MTD) | LATEST_MONTH (YTD, LATEST metrics) | AVERAGE_OF_MONTHS (YTD, AVERAGE metrics, v2.55.0)
const outcomeWindow = (mp, aggregation = 'LATEST') => ({ ...(periodWindow(mp) || { from: null, to: null }),
  basis: String(mp.mode).toUpperCase() === 'MTD' ? 'MONTH' : (aggregation === 'AVERAGE' ? 'AVERAGE_OF_MONTHS' : 'LATEST_MONTH') });

async function essDirectorateFor(directorate, subDirectorate, scopes) {
  if (scopes || (directorate && directorate !== 'ALL') || !subDirectorate || subDirectorate === 'ALL') return directorate;
  const parent = (await storage.getDirectorates()).find(d => (d.divisions || []).includes(subDirectorate));
  return parent ? parent.directorate_name : '__NONE__';
}

// v2.54.2: a TEMPORARY manual value for a metric (user request 2026-10-22: Signature Program Events is not in use yet, metric 11 is
// shown to the Board with a fixed value). Stored in the database, not in code: setting `metric_manual_overrides` =
// { "<metric_id>": { value, score (0-100), note, bankwide_only (default true) } }. Remove the key (or the setting) to go back to
// the live calculation. bankwide_only: under a directorate filter / USER scope the metric is N/A (not counted) - the value is bankwide.
async function loadManualOverrides() {
  try {
    const stored = (await storage.getSettings()).metric_manual_overrides;
    const obj = typeof stored === 'string' ? JSON.parse(stored) : stored;
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  } catch (_) {
    return {};
  }
}
function manualOverrideFor(overrides, metricId) {
  const o = overrides && overrides[String(metricId)];
  if (!o || typeof o !== 'object') return null;
  const value = Number(o.value);
  const score = Number(o.score);
  if (!Number.isFinite(value) || !Number.isFinite(score)) return null;
  const targetScore = o.target_score === undefined || o.target_score === null ? null : Number(o.target_score); // optional target in % (status)
  return { value, score: Math.min(Math.max(score, 0), 100), note: String(o.note || 'Manual value'), bankwide_only: o.bankwide_only !== false,
    target_score: Number.isFinite(targetScore) ? Math.min(Math.max(targetScore, 0), 100) : null };
}

async function calculatePEIndex(filterInput = 'YTD', options = {}) {
  // The per-month inner calls from computeMonthlyTrends() skip this (it syncs once up front).
  if (!options.skipTrends) await syncLiveEventMetrics();

  let mode = 'YTD';
  let year = CURRENT_YEAR;
  let month = '01';
  let directorate = 'ALL';
  let subDirectorate = 'ALL';
  let scopes = null; // union data scope [{ directorate, divisions }] of a USER; null = no scope restriction
  let periodString = 'YTD';
  let endMonth = null;

  if (typeof filterInput === 'string') {
    periodString = filterInput.trim();
    if (periodString === 'YTD' || periodString === 'ALL') {
      mode = 'YTD';
      year = CURRENT_YEAR;
    } else if (/^\d{4}-\d{2}$/.test(periodString)) {
      mode = 'MTD';
      const parts = periodString.split('-');
      year = parts[0];
      month = parts[1];
    } else if (/^\d{4}$/.test(periodString)) {
      mode = 'YTD';
      year = periodString;
    } else {
      mode = 'YTD';
      year = CURRENT_YEAR;
    }
  } else if (typeof filterInput === 'object' && filterInput !== null) {
    mode = filterInput.mode || (filterInput.period && /^\d{4}-\d{2}$/.test(filterInput.period) ? 'MTD' : 'YTD');
    year = filterInput.year ? String(filterInput.year) : (filterInput.period && /^\d{4}/.test(filterInput.period) ? filterInput.period.slice(0, 4) : CURRENT_YEAR);
    month = filterInput.month ? String(filterInput.month).padStart(2, '0') : (filterInput.period && filterInput.period.length >= 7 && /^\d{4}-\d{2}/.test(filterInput.period) ? filterInput.period.slice(5, 7) : '01');
    directorate = filterInput.directorate || 'ALL';
    subDirectorate = filterInput.sub_directorate || filterInput.subDirectorate || 'ALL';
    periodString = filterInput.period || (mode === 'MTD' ? `${year}-${month}` : (mode === 'YTD' ? 'YTD' : `${year}`));
    // Optional upper bound month for a "cumulative YTD as of end of this month" snapshot
    // (used internally by computeMonthlyTrends — not exposed on the main scorecard).
    endMonth = filterInput.endMonth ? String(filterInput.endMonth).padStart(2, '0') : null;
    if (Array.isArray(filterInput.scopes)) scopes = filterInput.scopes;
  }

  // A scoped read (USER) is always a "directorate view", exactly as for an Admin who filters one directorate. The union scope pools the responses of ALL scoped
  // directorates/divisions into the SAME per-metric mean -> normalize -> weight pipeline as the scorecard
  // (no average of averages), so a scope covering one whole directorate equals the Admin's directorate filter.
  const isDirectorateFiltered = (directorate && directorate !== 'ALL') || !!scopes;
  const queryFilter = { mode, year, month, directorate, sub_directorate: subDirectorate, period: periodString, endMonth, scopes };

  const [metrics, journeys, checkpoints, targets, essResults, pxWeights, outcomeRows, metricParts, partResults] = await Promise.all([
    storage.getMetrics(),
    storage.getJourneys(),
    storage.getCheckpoints(),
    storage.getMetricTargets(),
    storage.getEssResults(null), // ESS summaries (v2.32.0): small table, read once per calculation
    getPxWeights(),
    storage.getOutcomeValues(),  // monthly OUTCOME values (v2.54.0): small table, read once per calculation
    storage.getMetricParts(),    // composite summary metrics (v2.55.0): parts + their summary rows, read once per calculation
    storage.getMetricPartResults()
  ]);
  const partsMap = partsByMetric(metricParts);
  const manualOverrides = await loadManualOverrides(); // v2.54.2
  // "Last update" of every metric (v2.54.0) - only for the scorecard itself, not for its per-month / per-directorate inner calls
  const lastUpdateCtx = options.skipTrends ? null : await loadLastUpdateContext({ essResults, outcomeRows });
  const wSurvey = pxWeights.survey / 100;
  const wOutcome = pxWeights.outcome / 100;
  // ESS is reported per directorate: a division filter reads its parent directorate's row.
  const essDirectorate = await essDirectorateFor(directorate, subDirectorate, scopes);

  // 1. Enrich each metric with normalized score, status, and period/directorate data
  const enrichedMetrics = await Promise.all(metrics.map(async m => {
    const targetConfig = (targets && targets[m.metric_id]) 
      || (Array.isArray(targets) ? targets.find(t => t.metric_id === m.metric_id) : null) 
      || {
        target_value: m.target_value,
        target_display: m.target_display,
        min_threshold: m.min_threshold
      };

    const isEmployeeMetric = m.is_employee_metric !== undefined ? m.is_employee_metric : true;
    // v2.48.0: under a directorate/division filter (Admin or USER) a non-employee metric (campus, candidates, ...),
    // which has no directorate data, is read at its BANKWIDE value and counts in the index like any other metric
    // (is_bankwide_value marks it so the UI shows it as bankwide, not as directorate data). Before v2.48.0 it was
    // exempted (Admin) or excluded from the index (USER).
    const isBankwideValue = isDirectorateFiltered && !isEmployeeMetric;

    let rawVal = parseFloat(m.raw_value || 0);
    let sampleSize = null;
    let lastSurveyDate = null;
    // v2.36.0: a SURVEY metric only has a value when it has data INSIDE the selected window; without it the metric
    // is NO_DATA (no static raw_value fallback) and stays out of every index, rollup and alert. OUTCOME metrics are
    // current snapshots and always have a value - unless they have uploaded monthly values (v2.54.0, see below).
    let hasData = true;
    let outcomeBasis = null;
    let outcomePick = null;
    const isEss = m.metric_type === 'SURVEY' && isEssMetric(m);
    let essResult = null;
    let composite = null; // v2.55.0: composite summary metric (metric 7, metric 5)
    const metricPartList = partsMap.get(m.metric_id) || [];
    // The period this metric is read for (v2.37.0): exactly the selected period for every SYSTEM survey metric - MTD =
    // that month only; update_frequency does not change the period (reminders only). ESS: see selectEssResult (v2.50.0).
    const mp = { mode, year, month, endMonth };
    const metricFilter = { ...queryFilter, mode: mp.mode, endMonth: mp.endMonth };

    if (isEss) {
      // ESS metric (v2.32.0): the uploaded ESS summary, not per-respondent rows. v2.50.0: the latest result on or
      // before the period's end, from any earlier year (ESS runs once a year - carry-forward); sample size = participation.
      essResult = selectEssResult(essResults, m.metric_id, mp,
        essOrgFor({ directorate: essDirectorate, scopes, bankwide: isBankwideValue }));
      if (essResult) {
        rawVal = essResult.index;
        sampleSize = essResult.participation;
        lastSurveyDate = essResult.period;
      } else {
        hasData = false;
        sampleSize = 0;
      }
    } else if (metricPartList.length && (m.metric_type !== 'OUTCOME' || partResults.some(r => r.metric_id === m.metric_id))) {
      // (an OUTCOME metric - 19, 20 - keeps its static raw_value until its first summary upload)
      // v2.55.0: composite summary metric - the average of its parts (each: the average of its months in the window); the
      // org rule of ESS (a division filter reads its directorate, a USER scope its directorates, a non-employee metric bankwide)
      composite = compositeValue(metricPartList, partResults.filter(r => r.metric_id === m.metric_id), mp,
        essOrgFor({ directorate: essDirectorate, scopes, bankwide: isBankwideValue }));
      sampleSize = composite.respondents;
      if (composite.value === null) hasData = false;
      else {
        rawVal = composite.value;
        lastSurveyDate = `${composite.last_period}-01`;
      }
    } else if (m.metric_type === 'SURVEY') {
      const responses = await storage.getResponsesByMetricAndPeriod(m.metric_id, isBankwideValue ? { ...metricFilter, directorate: 'ALL', sub_directorate: 'ALL', scopes: null } : metricFilter);
      sampleSize = responses.length;

      if (responses.length > 0) {
        const sum = responses.reduce((acc, r) => acc + (parseFloat(r.rating_score) || 0), 0);
        rawVal = sum / responses.length;
        const lastResp = responses[responses.length - 1];
        const rawDate = lastResp.survey_date || lastResp.created_at;
        lastSurveyDate = normalizeDateString(rawDate) || todayDateString();
      } else {
        hasData = false;
      }
    } else {
      // OUTCOME METRICS — last ingestion date is a real database field (`last_data_date`,
      // seeded by OUTCOME_INGESTION_DATES in seedData.js, admin-editable via
      // PUT /api/admin/metrics/:id), not a hardcoded lookup in business logic.
      const rawDate = m.last_data_date || m.last_survey_date || todayDateString();
      lastSurveyDate = normalizeDateString(rawDate) || todayDateString();
      // v2.54.0: a metric with uploaded monthly values takes the latest stored month inside the window (MTD = that month);
      // none inside the window -> NO_DATA. Without any stored month the static raw_value above stays (bankwide either way).
      // v2.55.0: an AVERAGE metric takes the average of the stored months inside the window instead.
      if (isOutcomeUploadMetric(m)) {
        const own = outcomeRows.filter(r => r.metric_id === m.metric_id);
        outcomeBasis = own.length ? 'MONTHLY_VALUES' : 'STATIC_SNAPSHOT';
        if (own.length) {
          outcomePick = selectOutcomeValue(own, mp, aggregationOf(m));
          if (outcomePick) {
            rawVal = outcomePick.value;
            lastSurveyDate = `${outcomePick.period}-01`;
          } else {
            hasData = false;
          }
        }
      }
    }

    // v2.54.0: a tier-scored metric whose tiers are not configured yet has no value (N/A): out of every index, rollup and alert
    const tierCfg = readTierConfig(m.score_tiers);
    let notApplicable = !!tierCfg && !tierCfg.bounds;
    if (notApplicable) hasData = false;

    // v2.54.2: temporary manual value (bankwide only: N/A under a directorate filter / USER scope)
    const manual = manualOverrideFor(manualOverrides, m.metric_id);
    let notApplicableReason = notApplicable ? 'Score tiers not configured yet' : null;
    if (manual) {
      if (manual.bankwide_only && isDirectorateFiltered) {
        hasData = false;
        notApplicable = true;
        notApplicableReason = 'Bankwide-only value - N/A under a directorate filter';
      } else {
        hasData = true;
        rawVal = manual.value;
      }
    }
    // v2.55.0: Admin switch "Real data not available yet" - N/A whatever is stored (the stored data is kept)
    const dataNotAvailable = isDataNotAvailable(m);
    if (dataNotAvailable) {
      hasData = false;
      notApplicable = true;
      notApplicableReason = DATA_NOT_AVAILABLE_REASON;
      sampleSize = 0;
    }

    const normScore = hasData ? (manual && !dataNotAvailable ? manual.score : normalizeScore({ ...m, ...targetConfig }, rawVal)) : null;
    const minThreshold = parseFloat(targetConfig.min_threshold || 75);
    // v2.54.2: a manual entry may carry its own target in % (e.g. metric 11: 87% >= 80% = on target)
    const normalizedTarget = manual && manual.target_score !== null ? manual.target_score : normalizeTarget(m, targetConfig);

    let status = 'HEALTHY';
    if (!hasData) {
      status = 'NO_DATA';
    } else if (normScore < minThreshold) {
      status = 'CRITICAL';
    } else if (normScore < normalizedTarget) {
      status = 'WARNING';
    }

    const weight = m.weight !== undefined ? m.weight : 1.0;

    return {
      metric_id: m.metric_id,
      journey_id: m.journey_id,
      checkpoint_id: m.checkpoint_id,
      metric_name: m.metric_name,
      metric_type: m.metric_type,
      scale_type: m.scale_type,
      source_of_data: m.source_of_data,
      survey_source: m.survey_source || null,
      experience_owner: m.experience_owner,
      target_value: targetConfig.target_value,
      target_value_normalized: round2(normalizedTarget),
      target_display: targetConfig.target_display,
      min_threshold: targetConfig.min_threshold,
      raw_value: hasData ? parseFloat(rawVal.toFixed(2)) : null,
      unit: m.unit,
      normalized_score: hasData ? parseFloat(normScore.toFixed(2)) : null,
      manual_override: manual ? { value: manual.value, score: manual.score, note: manual.note, bankwide_only: manual.bankwide_only } : null,
      weight,
      status,
      has_data: hasData,
      update_frequency: m.update_frequency || 'MONTHLY',
      // the dates this SURVEY metric was read for (OUTCOME = current snapshot, no window)
      // ESS (v2.50.0): basis LATEST_RESULT - the result of ess_period is used for the whole selected window
      // OUTCOME with uploaded months (v2.54.0): basis LATEST_MONTH (YTD) / MONTH (MTD)
      period_window: composite ? { ...(periodWindow(mp) || { from: null, to: null }), basis: 'AVERAGE_OF_MONTHS' }
        : m.metric_type === 'SURVEY' ? (isEss ? essWindow(mp) : periodWindow(mp))
        : (outcomeBasis === 'MONTHLY_VALUES' ? outcomeWindow(mp, aggregationOf(m)) : null),
      sample_size: sampleSize,
      last_survey_date: lastSurveyDate,
      gap: hasData ? parseFloat((normalizedTarget - normScore).toFixed(2)) : null,
      is_employee_metric: isEmployeeMetric,
      target_audience: m.target_audience || (isEmployeeMetric ? 'EMPLOYEE' : 'EXTERNAL_MARKET'),
      // kept for API compatibility: nothing is exempted or excluded any more (v2.48.0)
      is_disabled: false,
      excluded_from_index: false,
      disabled_reason: null,
      is_bankwide_value: isBankwideValue,
      // v2.52.0: metric 1 takes social media statistics (Admin .xlsx upload) - the UI offers Template + Upload
      // (switched off since v2.55.0: socialMediaService.SOCIAL_MEDIA_DRILLDOWN_ENABLED)
      ...(hasSocialMediaDrilldown(m) ? { data_upload: 'SOCIAL_MEDIA' } : {}),
      ...outcomeFields(m, { basis: outcomeBasis, pick: outcomePick }),
      score_tiers: tierCfg,
      not_applicable: notApplicable, // tiers not configured yet: value N/A (status NO_DATA, out of the index)
      not_applicable_reason: notApplicable ? notApplicableReason : null,
      data_not_available: dataNotAvailable, // v2.55.0: Admin switch "Real data not available yet"
      tier_info: hasData ? tierInfo(m, rawVal) : null,
      ...(lastUpdateCtx ? lastUpdateFor(m, lastUpdateCtx) : {}),
      // v2.55.0: composite summary metric - its parts (value 1-5 / score %, N/A when a part has no month with a value)
      ...(metricPartList.length ? {
        data_upload: 'PART_SUMMARY',
        metric_parts: (composite ? composite.parts : metricPartList).map(p => ({ part_key: p.part_key, part_name: p.part_name,
          value: p.value === undefined || dataNotAvailable ? null : p.value, score: p.score === undefined || dataNotAvailable ? null : p.score,
          has_data: !!p.has_data && !dataNotAvailable, months_count: dataNotAvailable ? 0 : (p.months_count || 0), months_label: dataNotAvailable ? null : (p.months_label || null) })),
        parts_with_data: composite && !dataNotAvailable ? composite.parts_with_data : 0
      } : {}),
      ...(isEss ? {
        ess_period: essResult ? essResult.period : null,
        ess_period_label: essResult ? essResult.period_label : null,
        ess_carried_forward: essResult ? essResult.carried_forward : null,
        ess_level: essResult ? essResult.level : null
      } : {})
    };
  }));
  // v2.58.0: the number the UI shows (position in journey order, no gaps) - metric_id stays the key
  const displayNumbers = displayNumberMap(metrics, journeys);
  enrichedMetrics.forEach(m => { m.display_no = displayNumbers.get(m.metric_id) ?? null; });

  // 2. Separate Active Survey vs Outcome metrics (Excluding Disabled non-employee metrics when directorate is selected,
  // and - v2.36.0 - NO_DATA survey metrics, which have no value in this window)
  const activeMetrics = enrichedMetrics.filter(m => !m.is_disabled && !m.excluded_from_index && m.has_data);
  const noDataMetrics = enrichedMetrics.filter(m => !m.is_disabled && !m.excluded_from_index && !m.has_data);
  const activeSurveyMetrics = activeMetrics.filter(m => m.metric_type === 'SURVEY');
  const activeOutcomeMetrics = activeMetrics.filter(m => m.metric_type === 'OUTCOME');

  // 3. Survey Index (weighted mean over the active survey metrics WITH data; null when none has data)
  const totalSurveyWeight = activeSurveyMetrics.reduce((sum, m) => sum + m.weight, 0);
  const weightedSurveySum = activeSurveyMetrics.reduce((sum, m) => sum + (m.normalized_score * m.weight), 0);
  const surveyIndex = totalSurveyWeight > 0 ? weightedSurveySum / totalSurveyWeight : null;

  // 4. Outcome Index (calculated exclusively from active outcome metrics; null when there are none)
  const totalOutcomeWeight = activeOutcomeMetrics.reduce((sum, m) => sum + m.weight, 0);
  const weightedOutcomeSum = activeOutcomeMetrics.reduce((sum, m) => sum + (m.normalized_score * m.weight), 0);
  const outcomeIndex = totalOutcomeWeight > 0 ? weightedOutcomeSum / totalOutcomeWeight : null;

  // 5. Consolidated PX Index: Survey weight x Survey + Outcome weight x Outcomes (px_index_weights, default 70/30);
  // when one component has no data the other one alone
  // (px_index_basis says which), null when neither has data.
  let pxIndex = null;
  let pxIndexBasis = 'NONE';
  if (surveyIndex !== null && outcomeIndex !== null) {
    pxIndex = (wSurvey * surveyIndex) + (wOutcome * outcomeIndex);
    pxIndexBasis = 'BOTH';
  } else if (surveyIndex !== null) {
    pxIndex = surveyIndex;
    pxIndexBasis = 'SURVEY_ONLY';
  } else if (outcomeIndex !== null) {
    pxIndex = outcomeIndex;
    pxIndexBasis = 'OUTCOME_ONLY';
  }

  // 6. Rollup by Journey
  const journeySummaries = journeys.map(j => {
    const jMetrics = enrichedMetrics.filter(m => m.journey_id === j.journey_id);
    const jActiveMetrics = jMetrics.filter(m => !m.is_disabled && !m.excluded_from_index && m.has_data);
    const jSurvey = jActiveMetrics.filter(m => m.metric_type === 'SURVEY');
    const jOutcome = jActiveMetrics.filter(m => m.metric_type === 'OUTCOME');

    const sWeight = jSurvey.reduce((s, m) => s + m.weight, 0);
    const sScore = sWeight > 0 ? jSurvey.reduce((s, m) => s + (m.normalized_score * m.weight), 0) / sWeight : null;

    const oWeight = jOutcome.reduce((s, m) => s + m.weight, 0);
    const oScore = oWeight > 0 ? jOutcome.reduce((s, m) => s + (m.normalized_score * m.weight), 0) / oWeight : null;

    let jOverallScore = null; // null = no metric of this journey has data in the window
    if (sScore !== null && oScore !== null) {
      jOverallScore = (wSurvey * sScore) + (wOutcome * oScore);
    } else if (sScore !== null) {
      jOverallScore = sScore;
    } else if (oScore !== null) {
      jOverallScore = oScore;
    }

    const criticalCount = jActiveMetrics.filter(m => m.status === 'CRITICAL').length;
    const warningCount = jActiveMetrics.filter(m => m.status === 'WARNING').length;
    const disabledCount = jMetrics.filter(m => m.is_disabled).length;

    return {
      journey_id: j.journey_id,
      journey_code: j.journey_code,
      journey_name: j.journey_name,
      tagline: j.tagline,
      color: j.color,
      icon: j.icon,
      survey_score: sScore !== null ? parseFloat(sScore.toFixed(2)) : null,
      outcome_score: oScore !== null ? parseFloat(oScore.toFixed(2)) : null,
      overall_score: round2(jOverallScore),
      has_data: jOverallScore !== null,
      metrics_count: jMetrics.length,
      active_metrics_count: jActiveMetrics.length,
      disabled_metrics_count: disabledCount,
      no_data_count: jMetrics.filter(m => !m.is_disabled && !m.excluded_from_index && !m.has_data).length,
      survey_count: jSurvey.length,
      outcome_count: jOutcome.length,
      critical_count: criticalCount,
      warning_count: warningCount,
      metrics: jMetrics
    };
  });

  // 7. Rollup by Checkpoint
  const checkpointSummaries = checkpoints.map(cp => {
    const cpMetrics = enrichedMetrics.filter(m => m.checkpoint_id === cp.checkpoint_id);
    const cpActiveMetrics = cpMetrics.filter(m => !m.is_disabled && !m.excluded_from_index && m.has_data);
    const totalWeight = cpActiveMetrics.reduce((s, m) => s + m.weight, 0);
    const cpScore = totalWeight > 0 ? cpActiveMetrics.reduce((s, m) => s + (m.normalized_score * m.weight), 0) / totalWeight : null;

    return {
      checkpoint_id: cp.checkpoint_id,
      journey_id: cp.journey_id,
      checkpoint_name: cp.checkpoint_name,
      experience_owner: cp.experience_owner,
      score: round2(cpScore),
      has_data: cpScore !== null,
      metrics_count: cpMetrics.length,
      active_metrics_count: cpActiveMetrics.length,
      metrics: cpMetrics
    };
  });

  // computeMonthlyTrends() itself calls calculatePEIndex() once per month (with
  // skipTrends: true) to guarantee the trend chart's numbers are computed via the exact
  // same per-metric weighted-normalization logic as this scorecard. Skip re-computing
  // trends on those 12 inner calls, or this would recurse indefinitely.
  const monthlyTrends = options.skipTrends ? [] : await computeMonthlyTrends(queryFilter);

  return {
    period: periodString,
    mode,
    year,
    month,
    directorate,
    sub_directorate: subDirectorate,
    filter_options: {
      mode,
      year,
      month,
      directorate,
      sub_directorate: subDirectorate,
      is_directorate_filtered: isDirectorateFiltered,
      scopes
    },
    px_index: round2(pxIndex),
    pe_index: round2(pxIndex), // backward compatibility
    px_index_basis: pxIndexBasis, // 'BOTH' | 'SURVEY_ONLY' | 'OUTCOME_ONLY' | 'NONE' (v2.36.0)
    survey_index: round2(surveyIndex),
    outcome_index: round2(outcomeIndex),
    weights_formula: `${pxWeights.survey}% Survey + ${pxWeights.outcome}% Outcomes (Normalized across active metrics)`,
    px_weights: { survey: pxWeights.survey, outcome: pxWeights.outcome }, // v2.48.0: Admin-editable (px_index_weights)
    total_metrics: enrichedMetrics.length,
    active_metrics_count: activeMetrics.length,
    disabled_metrics_count: enrichedMetrics.filter(m => m.is_disabled || m.excluded_from_index).length,
    bankwide_value_metrics_count: enrichedMetrics.filter(m => m.is_bankwide_value).length,
    no_data_metrics_count: noDataMetrics.length,
    survey_metrics_count: activeSurveyMetrics.length,
    outcome_metrics_count: activeOutcomeMetrics.length,
    monthly_trends: monthlyTrends,
    available_years: await storage.getAvailableSurveyYears(),
    journeys: journeySummaries,
    checkpoints: checkpointSummaries,
    metrics: enrichedMetrics
  };
}

/**
 * Returns in-depth drilldown details for a specific metric:
 * - Questions breakdown with average score per question
 * - Total respondent count
 * - List of all survey responses with verbatim comments
 * - ESS sentiment summary and dimension statistics if source is ESS
 */
async function getMetricDetail(metricId, filterInput = 'YTD') {
  const detail = await buildMetricDetail(metricId, filterInput);
  if (!detail) return detail;
  // v2.54.0: the latest data period of the metric (bankwide, any window) - "Last update: <Month Year>"
  const metric = (await storage.getMetrics()).find(m => m.metric_id === detail.metric_id);
  const out = { ...detail, ...lastUpdateFor(metric, await loadLastUpdateContext()), display_no: (await loadDisplayNumbers(storage)).get(detail.metric_id) ?? null };
  // v2.55.0: an OUTCOME composite metric (19, 20) before its first summary upload: static value, but the summary upload is offered
  if (!out.data_upload && (await storage.getMetricParts(metric.metric_id)).length) {
    Object.assign(out, { data_upload: 'PART_SUMMARY', outcome_upload: false, evidence_type: null, parts: [], composite: null });
  }
  if (!isDataNotAvailable(metric)) {
    return { ...out, not_applicable_reason: out.not_applicable ? (out.manual_override ? 'Bankwide-only value - N/A under a directorate filter' : 'Score tiers not configured yet') : null, data_not_available: false };
  }
  // v2.55.0: "Real data not available yet" - N/A, and no stored row is shown (records, responses, question scores, parts)
  return {
    ...out,
    has_data: false,
    not_applicable: true,
    not_applicable_reason: DATA_NOT_AVAILABLE_REASON,
    data_not_available: true,
    status: 'NO_DATA',
    current_raw_value: null,
    normalized_score: null,
    tier_info: null,
    total_respondents: out.is_survey ? 0 : out.total_respondents,
    questions: [],
    questions_breakdown: [],
    responses: [],
    operational_records: [],
    ...(out.ess_summary ? { ess_summary: null } : {}),
    ...(out.parts ? { parts: [], composite: null } : {})
  };
}

async function buildMetricDetail(metricId, filterInput = 'YTD') {
  const id = parseInt(metricId);
  const metrics = await storage.getMetrics();
  const metric = metrics.find(m => m.metric_id === id);
  if (!metric) return null;

  let mode = 'YTD';
  let year = CURRENT_YEAR;
  let month = '01';
  let directorate = 'ALL';
  let subDirectorate = 'ALL';
  let scopes = null; // union data scope of a USER (see calculatePEIndex)
  let periodString = 'YTD';
  let endMonth = null;

  if (typeof filterInput === 'string') {
    periodString = filterInput.trim();
    if (periodString === 'YTD' || periodString === 'ALL') {
      mode = 'YTD';
      year = CURRENT_YEAR;
    } else if (/^\d{4}-\d{2}$/.test(periodString)) {
      mode = 'MTD';
      const parts = periodString.split('-');
      year = parts[0];
      month = parts[1];
    } else if (/^\d{4}$/.test(periodString)) {
      mode = 'YTD';
      year = periodString;
    } else {
      mode = 'YTD';
      year = CURRENT_YEAR;
    }
  } else if (typeof filterInput === 'object' && filterInput !== null) {
    mode = filterInput.mode || (filterInput.period && /^\d{4}-\d{2}$/.test(filterInput.period) ? 'MTD' : 'YTD');
    year = filterInput.year ? String(filterInput.year) : (filterInput.period && /^\d{4}/.test(filterInput.period) ? filterInput.period.slice(0, 4) : CURRENT_YEAR);
    month = filterInput.month ? String(filterInput.month).padStart(2, '0') : (filterInput.period && filterInput.period.length >= 7 && /^\d{4}-\d{2}/.test(filterInput.period) ? filterInput.period.slice(5, 7) : '01');
    directorate = filterInput.directorate || 'ALL';
    subDirectorate = filterInput.sub_directorate || filterInput.subDirectorate || 'ALL';
    periodString = filterInput.period || (mode === 'MTD' ? `${year}-${month}` : `${year}`);
    if (Array.isArray(filterInput.scopes)) scopes = filterInput.scopes;
    if (filterInput.endMonth) endMonth = String(filterInput.endMonth).padStart(2, '0');
  }

  const isDirectorateFiltered = (directorate && directorate !== 'ALL') || !!scopes;
  const isEmployeeMetric = metric.is_employee_metric !== undefined ? metric.is_employee_metric : true;
  // v2.48.0: a non-employee metric (campus, candidates, ...) has no directorate data - under a directorate/division
  // filter it is read at its bankwide value (same rule as calculatePEIndex), never "exempted".
  const isBankwideValue = isDirectorateFiltered && !isEmployeeMetric;
  if (isBankwideValue) { directorate = 'ALL'; subDirectorate = 'ALL'; scopes = null; }
  const queryFilter = { mode, year, month, directorate, sub_directorate: subDirectorate, period: periodString, scopes };

  const isDisabled = false;
  const disabledReason = null;

  const targetConfig = (await storage.getMetricTargetById(id)) || {
    target_value: metric.target_value,
    target_display: metric.target_display,
    min_threshold: metric.min_threshold
  };

  const journeys = await storage.getJourneys();
  const checkpoints = await storage.getCheckpoints();
  const journey = journeys.find(j => j.journey_id === metric.journey_id);
  const checkpoint = checkpoints.find(c => c.checkpoint_id === metric.checkpoint_id);

  const isSurvey = metric.metric_type === 'SURVEY';
  // ESS is decided by the metric's survey_source (v2.29.0); the old text test is only a fallback when it is empty.
  const isEss = isSurvey && isEssMetric(metric);
  // v2.37.0: the period this metric is read for = exactly the selected period (MTD = that month), same as the scorecard
  const mp = { mode, year, month, endMonth };
  const metricFilter = { ...queryFilter, mode: mp.mode, endMonth: mp.endMonth };
  const windowInfo = { update_frequency: metric.update_frequency || 'MONTHLY', period_window: isSurvey ? (isEss ? essWindow(mp) : periodWindow(mp)) : null,
    is_bankwide_value: isBankwideValue, px_weights: await getPxWeights() };

  // v2.55.0: composite summary metric (7, 5, 12, 19, 20): per part the months used + value, the metric = average of the parts.
  // An OUTCOME metric (19, 20) keeps its static raw_value until its first summary upload.
  const detailParts = await storage.getMetricParts(id);
  const detailPartRows = detailParts.length ? await storage.getMetricPartResults(id) : [];
  if (detailParts.length && (isSurvey || detailPartRows.length)) {
    const essDirectorateC = await essDirectorateFor(directorate, subDirectorate, scopes);
    const comp = compositeValue(detailParts, detailPartRows, mp,
      essOrgFor({ directorate: essDirectorateC, scopes, bankwide: isBankwideValue }));
    const uploads = await storage.getMetricPartUploads(id);
    const hasData = comp.value !== null;
    const normalized = hasData ? normalizeScore({ ...metric, ...targetConfig }, comp.value) : null;
    const normalizedTarget = normalizeTarget(metric, targetConfig);
    return {
      ...windowInfo,
      period_window: { ...(periodWindow(mp) || { from: null, to: null }), basis: 'AVERAGE_OF_MONTHS' },
      metric: { metric_id: id, metric_name: metric.metric_name, metric_type: metric.metric_type, scale_type: metric.scale_type, unit: metric.unit,
        target_value: targetConfig.target_value, target_value_normalized: round2(normalizedTarget), target_display: targetConfig.target_display, min_threshold: targetConfig.min_threshold },
      metric_id: id,
      metric_name: metric.metric_name,
      metric_type: metric.metric_type,
      is_survey: isSurvey,
      is_outcome: !isSurvey,
      is_ess: false,
      evidence_type: null,   // OUTCOME composite (19, 20): no monthly-value upload / evidence - the summary parts instead
      outcome_upload: false,
      operational_records: [],
      is_employee_metric: isEmployeeMetric,
      target_audience: metric.target_audience || (isEmployeeMetric ? 'EMPLOYEE' : 'EXTERNAL_MARKET'),
      is_disabled: isDisabled,
      disabled_reason: disabledReason,
      scale_type: metric.scale_type,
      experience_owner: metric.experience_owner,
      source_of_data: metric.source_of_data,
      survey_source: metric.survey_source || null,
      journey_name: journey?.journey_name || '',
      journey_color: journey?.color || '#ED1C24',
      checkpoint_name: checkpoint?.checkpoint_name || '',
      target_value: targetConfig.target_value,
      target_value_normalized: round2(normalizedTarget),
      target_display: targetConfig.target_display,
      min_threshold: targetConfig.min_threshold,
      current_raw_value: hasData ? parseFloat(comp.value.toFixed(4)) : null,
      unit: metric.unit,
      normalized_score: hasData ? parseFloat(normalized.toFixed(2)) : null,
      has_data: hasData,
      score_tiers: null,
      not_applicable: false,
      tier_info: null,
      status: !hasData ? 'NO_DATA' : (normalized < targetConfig.min_threshold ? 'CRITICAL' : (normalized < normalizedTarget ? 'WARNING' : 'HEALTHY')),
      period: periodString,
      filter_options: queryFilter,
      total_respondents: comp.respondents,
      last_survey_date: comp.last_period ? `${comp.last_period}-01` : null,
      data_upload: 'PART_SUMMARY',
      composite: { value: hasData ? parseFloat(comp.value.toFixed(4)) : null, parts_with_data: comp.parts_with_data, parts_total: detailParts.length },
      parts: comp.parts.map(p => {
        const u = uploads.find(x => x.part_key === p.part_key);
        return { ...p, last_upload: u ? { file_name: u.file_name, uploaded_at: u.uploaded_at, uploaded_by: u.uploaded_by, periods: u.periods } : null };
      }),
      // the per-respondent survey rows / questions of this metric are not used for its score any more (kept, not shown)
      questions: [],
      questions_breakdown: [],
      responses: []
    };
  }

  if (!isSurvey) {
    // Outcome metric: Internal HR system data
    let operationalRecords = [];
    let socialMedia = null;
    let recordsHidden = false;
    if (isSocialMediaMetric(metric) && !hasSocialMediaDrilldown(metric)) {
      // v2.55.0 (user request): metric 1's social media drilldown is switched off for now - no Internal Transaction Records tab
      recordsHidden = true;
    } else if (hasSocialMediaDrilldown(metric)) {
      // v2.52.0: social media statistics per platform per month of the selected period (bankwide - no directorate filter);
      // the score below stays the Admin's raw_value
      socialMedia = await getSocialMediaDrilldown({ mode, year, month });
      operationalRecords = socialMedia.rows;
    } else if (id === 11) {
      // Live event attendance registrations from PXCWB
      const attendances = await storage.getAttendances();
      const events = await storage.getEvents();
      operationalRecords = attendances.map(a => {
        const ev = events.find(e => e.event_id === a.event_id);
        return {
          nip: a.nip,
          employee_name: a.employee_name,
          cimb_email: a.cimb_email,
          directorate: a.directorate,
          division: a.division,
          event_title: ev ? ev.event_name : 'Signature Program Event',
          registered_at: a.attendance_timestamp
        };
      });
    } else {
      // Operational drilldown table for this OUTCOME metric (recruitment SLA by unit, approval
      // stage compliance, hiring channel mix, recognition categories, attrition by tenure) —
      // sourced from the database (server/data/store.json via storage.getOperationalRecords()),
      // not frozen inline here. Metrics without a seeded breakdown table simply return [].
      operationalRecords = await storage.getOperationalRecords(id);
    }

    // v2.54.0: uploaded monthly values (same rule as calculatePEIndex): latest stored month inside the window (v2.55.0: AVERAGE
    // metrics the average of the months inside the window), none -> NO_DATA
    let rawVal = parseFloat(metric.raw_value || 0);
    let hasData = true;
    let basis = null;
    let pick = null;
    if (isOutcomeUploadMetric(metric)) {
      const own = await storage.getOutcomeValues(id);
      basis = own.length ? 'MONTHLY_VALUES' : 'STATIC_SNAPSHOT';
      if (own.length) {
        pick = selectOutcomeValue(own, mp, aggregationOf(metric));
        if (pick) rawVal = pick.value; else hasData = false;
      }
    }
    const tierCfg = readTierConfig(metric.score_tiers);
    if (tierCfg && !tierCfg.bounds) hasData = false; // v2.54.0: tiers not configured -> N/A
    // v2.54.2: temporary manual value (same rule as calculatePEIndex)
    const manual = manualOverrideFor(await loadManualOverrides(), id);
    if (manual) {
      if (manual.bankwide_only && isDirectorateFiltered) hasData = false;
      else { hasData = true; rawVal = manual.value; }
    }
    const normalizedScore = hasData ? (manual ? manual.score : normalizeScore({ ...metric, ...targetConfig }, rawVal)) : null;
    const normalizedTargetOutcome = manual && manual.target_score !== null ? manual.target_score : normalizeTarget(metric, targetConfig);

    return {
      metric: {
        metric_id: id,
        metric_name: metric.metric_name,
        metric_type: 'OUTCOME',
        scale_type: metric.scale_type,
        experience_owner: metric.experience_owner,
        source_of_data: metric.source_of_data,
        survey_source: metric.survey_source || null,
        journey_name: journey?.journey_name || '',
        checkpoint_name: checkpoint?.checkpoint_name || '',
        target_value: targetConfig.target_value,
        target_value_normalized: round2(normalizedTargetOutcome),
        target_display: targetConfig.target_display,
        unit: metric.unit,
        min_threshold: targetConfig.min_threshold,
        is_employee_metric: isEmployeeMetric,
        target_audience: metric.target_audience || (isEmployeeMetric ? 'EMPLOYEE' : 'EXTERNAL_MARKET')
      },
      metric_id: id,
      metric_name: metric.metric_name,
      metric_type: 'OUTCOME',
      is_survey: false,
      is_outcome: true,
      is_ess: false,
      is_employee_metric: isEmployeeMetric,
      target_audience: metric.target_audience || (isEmployeeMetric ? 'EMPLOYEE' : 'EXTERNAL_MARKET'),
      is_disabled: isDisabled,
      disabled_reason: disabledReason,
      scale_type: metric.scale_type,
      experience_owner: metric.experience_owner,
      source_of_data: metric.source_of_data,
      survey_source: metric.survey_source || null,
      journey_name: journey?.journey_name || '',
      journey_color: journey?.color || '#ED1C24',
      checkpoint_name: checkpoint?.checkpoint_name || '',
      target_value: targetConfig.target_value,
      target_value_normalized: round2(normalizedTargetOutcome),
      target_display: targetConfig.target_display,
      min_threshold: targetConfig.min_threshold,
      current_raw_value: hasData ? parseFloat(Number(rawVal).toFixed(4)) : null,
      unit: metric.unit,
      normalized_score: hasData ? parseFloat(normalizedScore.toFixed(2)) : null,
      manual_override: manual ? { value: manual.value, score: manual.score, note: manual.note, bankwide_only: manual.bankwide_only } : null,
      has_data: hasData,
      status: !hasData ? 'NO_DATA' : (normalizedScore < targetConfig.min_threshold ? 'CRITICAL' : (normalizedScore < normalizedTargetOutcome ? 'WARNING' : 'HEALTHY')),
      update_frequency: metric.update_frequency || 'MONTHLY',
      period_window: basis === 'MONTHLY_VALUES' ? outcomeWindow(mp, aggregationOf(metric)) : null,
      is_bankwide_value: isBankwideValue,
      ...outcomeFields(metric, { basis, pick }),
      score_tiers: tierCfg,
      not_applicable: (!!tierCfg && !tierCfg.bounds) || !!(manual && manual.bankwide_only && isDirectorateFiltered),
      tier_info: hasData ? tierInfo(metric, rawVal) : null,
      period: periodString,
      filter_options: queryFilter,
      total_respondents: null,
      questions: [],
      questions_breakdown: [],
      responses: [],
      operational_records: operationalRecords,
      operational_records_hidden: recordsHidden, // v2.55.0: true = the UI shows no Internal Transaction Records tab (metric 1)
      ...(socialMedia ? {
        data_upload: 'SOCIAL_MEDIA',
        social_media: {
          platforms: socialMedia.platforms,
          window: socialMedia.window,
          period_totals: socialMedia.period_totals,
          latest_period: socialMedia.latest_period,
          latest_period_label: socialMedia.latest_period_label
        }
      } : {})
    };
  }

  // ESS metric with an uploaded ESS summary for this period (v2.32.0)
  if (isEss) {
    const essDirectorate = await essDirectorateFor(directorate, subDirectorate, scopes);
    const essResult = selectEssResult(await storage.getEssResults(id), id, mp,
      essOrgFor({ directorate: essDirectorate, scopes }));
    if (essResult) {
      return { ...windowInfo, ...await buildEssDetail({ id, metric, targetConfig, journey, checkpoint, isEmployeeMetric, isDisabled, disabledReason,
        periodString, queryFilter, essResult, scopes, subDirectorate, essDirectorate }) };
    }
  }

  // Survey metric logic
  const questions = await storage.getSurveyQuestions(id);
  const responses = await storage.getResponsesByMetricAndPeriod(id, metricFilter);
  // v2.50.0: question texts stored with the uploads of these responses that differ from today's Manage Questions text
  const previousTexts = await previousQuestionTexts(id, questions, responses);

  const questionBreakdown = questions.map(q => {
    const qType = q.type || 'SCALE_1_5';
    const fav = q.percent_favorable !== undefined ? q.percent_favorable : null;
    const neut = q.percent_neutral !== undefined ? q.percent_neutral : null;
    const unfav = q.percent_unfavorable !== undefined ? q.percent_unfavorable : null;

    if (qType === 'FREE_TEXT') {
      const textResponses = [];
      responses.forEach(r => {
        if (r.ratings && r.ratings[q.key] && typeof r.ratings[q.key] === 'string' && r.ratings[q.key].trim()) {
          textResponses.push({
            employee_name: r.participant_name || r.candidate_name || r.employee_name || 'Respondent',
            division: r.major || r.recruitment_channel || r.division || 'General',
            survey_date: r.survey_date || r.created_at,
            text: r.ratings[q.key].trim()
          });
        }
      });
      return {
        key: q.key,
        label: q.label,
        text: q.text,
        type: 'FREE_TEXT',
        dimension: q.dimension || null,
        avg_score: null,
        normalized_score: null,
        response_count: textResponses.length,
        verbatim_samples: textResponses.slice(0, 5)
      };
    }

    if (qType === 'YES_NO') {
      let yaCount = 0;
      let tidakCount = 0;

      responses.forEach(r => {
        if (r.ratings && r.ratings[q.key] !== undefined) {
          const val = r.ratings[q.key];
          const str = String(val).toLowerCase().trim();
          if (['ya', '1', '100', 'true', 'yes', 'benar'].includes(str) || val === 100 || val === 1) {
            yaCount += 1;
          } else if (['tidak', '0', 'false', 'no', 'salah'].includes(str) || val === 0) {
            tidakCount += 1;
          }
        }
      });

      const totalAnswered = yaCount + tidakCount;
      const percentYa = totalAnswered > 0 ? (yaCount / totalAnswered) * 100 : (fav !== null ? fav : 90.0);

      return {
        key: q.key,
        label: q.label,
        text: q.text,
        type: 'YES_NO',
        dimension: q.dimension || null,
        avg_score: Math.round(percentYa * 10) / 10,
        normalized_score: Math.round(percentYa * 10) / 10,
        yes_count: yaCount,
        no_count: tidakCount,
        response_count: totalAnswered,
        percent_yes: Math.round(percentYa * 10) / 10,
        percent_favorable: fav,
        percent_neutral: neut,
        percent_unfavorable: unfav
      };
    }

    if (qType === 'PERCENTAGE') {
      // v2.50.0: answer 0-100 (%), used as is
      let sum = 0;
      let count = 0;
      responses.forEach(r => {
        if (r.ratings && r.ratings[q.key] !== undefined) {
          const num = parseFloat(r.ratings[q.key]);
          if (!isNaN(num)) { sum += num; count += 1; }
        }
      });
      const avg = count > 0 ? Math.round((sum / count) * 100) / 100 : null;
      return {
        key: q.key,
        label: q.label,
        text: q.text,
        type: 'PERCENTAGE',
        dimension: q.dimension || null,
        visible_based_on: q.visible_based_on || 'Always',
        required_based_on: q.required_based_on || (q.mandatory ? 'Always' : 'Optional'),
        max: 100,
        avg_score: avg,
        normalized_score: avg === null ? null : parseFloat(avg.toFixed(1)),
        response_count: count,
        percent_favorable: fav,
        percent_neutral: neut,
        percent_unfavorable: unfav
      };
    }

    if (qType === 'SCALE_1_10') {
      let sum = 0;
      let count = 0;
      responses.forEach(r => {
        if (r.ratings && r.ratings[q.key] !== undefined) {
          const num = parseFloat(r.ratings[q.key]);
          if (!isNaN(num)) {
            sum += num;
            count += 1;
          }
        }
      });

      const avg = count > 0 ? Math.round((sum / count) * 100) / 100 : (fav !== null ? (fav / 10) : 9.0);
      const normalized = fav !== null && count === 0 ? fav : (avg / 10.0) * 100;

      return {
        key: q.key,
        label: q.label,
        text: q.text,
        type: 'SCALE_1_10',
        dimension: q.dimension || null,
        visible_based_on: q.visible_based_on || 'Always',
        required_based_on: q.required_based_on || (q.mandatory ? 'Always' : 'Optional'),
        max: 10,
        avg_score: avg,
        normalized_score: parseFloat(normalized.toFixed(1)),
        response_count: count,
        percent_favorable: fav !== null ? fav : Math.round(normalized),
        percent_neutral: neut !== null ? neut : Math.max(0, 100 - Math.round(normalized) - 2),
        percent_unfavorable: unfav !== null ? unfav : 2
      };
    }

    // Default: SCALE_1_5
    let sum = 0;
    let count = 0;
    responses.forEach(r => {
      if (r.ratings && r.ratings[q.key] !== undefined) {
        const num = parseFloat(r.ratings[q.key]);
        if (!isNaN(num)) {
          sum += num;
          count += 1;
        }
      }
    });

    const avg = count > 0 ? Math.round((sum / count) * 100) / 100 : (fav !== null ? (fav / 20) : 4.5);
    const normalized = fav !== null && count === 0 ? fav : (avg / 5.0) * 100;

    return {
      key: q.key,
      label: q.label,
      text: q.text,
      type: 'SCALE_1_5',
      dimension: q.dimension || null,
      visible_based_on: q.visible_based_on || 'Always',
      required_based_on: q.required_based_on || (q.mandatory ? 'Always' : 'Optional'),
      max: 5,
      avg_score: avg,
      normalized_score: parseFloat(normalized.toFixed(1)),
      response_count: count,
      percent_favorable: fav !== null ? fav : Math.round(normalized),
      percent_neutral: neut !== null ? neut : Math.max(0, 100 - Math.round(normalized) - 2),
      percent_unfavorable: unfav !== null ? unfav : 2
    };
  });

  // ESS Summary Calculation
  let essSummary = null;
  if (isEss && questionBreakdown.length > 0) {
    const scorableQuestions = questionBreakdown.filter(q => q.type !== 'FREE_TEXT');
    if (scorableQuestions.length > 0) {
      const favSum = scorableQuestions.reduce((s, q) => s + (q.percent_favorable !== null ? q.percent_favorable : (q.normalized_score || 88)), 0);
      const neutSum = scorableQuestions.reduce((s, q) => s + (q.percent_neutral !== null ? q.percent_neutral : 10), 0);
      const unfavSum = scorableQuestions.reduce((s, q) => s + (q.percent_unfavorable !== null ? q.percent_unfavorable : 2), 0);
      const count = scorableQuestions.length;

      const avgFav = Math.round((favSum / count) * 10) / 10;
      const avgNeut = Math.round((neutSum / count) * 10) / 10;
      const avgUnfav = Math.round((unfavSum / count) * 10) / 10;
      const dimName = questions.find(q => q.dimension)?.dimension || 'Employee Sentiment Survey (ESS)';

      essSummary = {
        dimension_name: dimName,
        summary_score: avgFav,
        percent_favorable: avgFav,
        percent_neutral: avgNeut,
        percent_unfavorable: avgUnfav,
        questions_count: scorableQuestions.length,
        description: 'No ESS summary has been uploaded for this period yet. Upload the ESS summary (.xlsx) to show the index and question scores.'
      };
    }
  }

  // Real response count from the database — no fabricated population placeholder. A metric
  // with genuinely zero responses reports 0, not an invented "typical ESS sample size".
  const totalRespondents = responses.length;

  // v2.36.0: no data in the window (an ESS metric without a result here, or no survey rows) -> NO_DATA with null
  // scores, exactly like the scorecard; no static raw_value / default ESS score fallback.
  // v2.54.0: a tier-scored metric whose tiers are not configured yet is N/A
  const tierCfg = readTierConfig(metric.score_tiers);
  const notApplicable = !!tierCfg && !tierCfg.bounds;
  const hasData = !isEss && !notApplicable && responses.length > 0;
  const overallAvg = hasData
    ? responses.reduce((acc, r) => acc + (parseFloat(r.rating_score) || 0), 0) / responses.length
    : null;
  const normalizedOverall = hasData ? normalizeScore({ ...metric, ...targetConfig }, overallAvg) : null;
  const normalizedTargetSurvey = normalizeTarget(metric, targetConfig);
  if (!hasData) {
    // no answers in the window: the questions carry no score either (no default/configured fallback values)
    questionBreakdown.forEach(q => {
      if (q.type === 'FREE_TEXT') return;
      q.avg_score = null;
      q.normalized_score = null;
      if (q.percent_yes !== undefined) q.percent_yes = null;
    });
  }
  if (essSummary) {
    // the ESS card of a period without an uploaded summary: no score, only the explanation
    essSummary = { ...essSummary, summary_score: null, percent_favorable: null, percent_neutral: null, percent_unfavorable: null };
  }
  questionBreakdown.forEach(q => {
    q.original_texts = previousTexts[q.key] || [];
    q.text_changed = q.original_texts.length > 0;
  });
  const questionsChanged = previousTexts.__setChanged || questionBreakdown.some(q => q.text_changed);

  return {
    metric: {
      metric_id: id,
      metric_name: metric.metric_name,
      metric_type: 'SURVEY',
      scale_type: metric.scale_type,
      experience_owner: metric.experience_owner,
      source_of_data: metric.source_of_data,
      survey_source: metric.survey_source || null,
      journey_name: journey?.journey_name || '',
      checkpoint_name: checkpoint?.checkpoint_name || '',
      target_value: targetConfig.target_value,
      target_value_normalized: round2(normalizedTargetSurvey),
      target_display: targetConfig.target_display,
      unit: metric.unit,
      min_threshold: targetConfig.min_threshold,
      is_employee_metric: isEmployeeMetric,
      target_audience: metric.target_audience || (isEmployeeMetric ? 'EMPLOYEE' : 'EXTERNAL_MARKET')
    },
    metric_id: id,
    metric_name: metric.metric_name,
    metric_type: 'SURVEY',
    is_survey: true,
    is_outcome: false,
    is_ess: isEss,
    ess_summary: essSummary,
    is_employee_metric: isEmployeeMetric,
    target_audience: metric.target_audience || (isEmployeeMetric ? 'EMPLOYEE' : 'EXTERNAL_MARKET'),
    is_disabled: isDisabled,
    disabled_reason: disabledReason,
    scale_type: metric.scale_type,
    experience_owner: metric.experience_owner,
    source_of_data: metric.source_of_data,
    survey_source: metric.survey_source || null,
    journey_name: journey?.journey_name || '',
    journey_color: journey?.color || '#ED1C24',
    checkpoint_name: checkpoint?.checkpoint_name || '',
    target_value: targetConfig.target_value,
    target_value_normalized: round2(normalizedTargetSurvey),
    target_display: targetConfig.target_display,
    min_threshold: targetConfig.min_threshold,
    current_raw_value: hasData ? parseFloat(overallAvg.toFixed(2)) : null,
    unit: metric.unit,
    normalized_score: hasData ? parseFloat(normalizedOverall.toFixed(2)) : null,
    has_data: hasData,
    score_tiers: tierCfg,
    not_applicable: notApplicable,
    tier_info: hasData ? tierInfo(metric, overallAvg) : null,
    ...windowInfo,
    status: !hasData ? 'NO_DATA' : (normalizedOverall < targetConfig.min_threshold ? 'CRITICAL' : (normalizedOverall < normalizedTargetSurvey ? 'WARNING' : 'HEALTHY')),
    period: periodString,
    filter_options: queryFilter,
    total_respondents: totalRespondents,
    questions: questionBreakdown,
    questions_breakdown: questionBreakdown,
    // v2.50.0: some responses were uploaded with other question texts / another question set (see original_texts)
    questions_changed_since_upload: questionsChanged,
    // Most-recent-first, capped at 100 for payload size — sorting before capping matters:
    // as seeded response volume has grown (2025 + extended 2026 monthly data), a metric can
    // now have well over 100 responses in a single period, and a plain insertion-order slice
    // would silently hide any freshly-uploaded response that happens to land past index 100.
    responses: [...responses]
      .sort((a, b) => (b.survey_date || b.created_at || '').localeCompare(a.survey_date || a.created_at || ''))
      .slice(0, 100)
  };
}

const normalizeQuestionText = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * v2.50.0: per current question key, the DIFFERENT question texts stored in the question snapshots of the uploads the
 * responses came from (uploads before v2.50.0 have no snapshot and are skipped). __setChanged = some upload used a
 * question set with other keys / another number of questions.
 */
async function previousQuestionTexts(metricId, questions, responses) {
  const out = {};
  const uploadIds = new Set(responses.map(r => r.upload_id).filter(Boolean));
  if (!uploadIds.size) return out;
  const current = new Map(questions.map(q => [q.key, normalizeQuestionText(q.text || q.label)]));
  (await storage.getSurveyUploads()).forEach(u => {
    if (!uploadIds.has(u.upload_id) || !u.questions_snapshot) return;
    const snap = u.questions_snapshot[metricId] || u.questions_snapshot[String(metricId)];
    if (!Array.isArray(snap)) return;
    if (snap.length !== questions.length || snap.some(q => !current.has(q.key))) out.__setChanged = true;
    snap.forEach(q => {
      if (!current.has(q.key) || current.get(q.key) === normalizeQuestionText(q.text || q.label)) return;
      const list = out[q.key] || (out[q.key] = []);
      if (!list.includes(q.text)) list.push(q.text);
    });
  });
  return out;
}

/**
 * Metric detail of an ESS metric from its uploaded ESS summary: the index, participation and per-question % come
 * from the file (neutral / unfavorable are not part of the ESS summary -> null). ess_results_by_directorate lists
 * the rows of that period the viewer may see: everything for an unscoped viewer (Bankwide first), only the scoped
 * directorates for a USER.
 */
async function buildEssDetail({ id, metric, targetConfig, journey, checkpoint, isEmployeeMetric, isDisabled, disabledReason,
  periodString, queryFilter, essResult, scopes, subDirectorate, essDirectorate }) {
  // v2.50.0: the questions shown are ALWAYS the ones configured in Manage Questions; the stored scores map to them BY
  // POSITION (stored question i = configured question i). A result uploaded since v2.50.0 carries the snapshot of its
  // questions: when that differs from today's configuration the question shows original_text and the detail says
  // questions_changed_since_upload. A result from before v2.50.0 has only the file's header text (file_label).
  const configured = (await storage.getSurveyQuestions(id)).filter(q => (q.type || 'SCALE_1_5') !== 'FREE_TEXT');
  const stored = essResult.questions || [];
  const hasSnapshot = stored.some(q => q && q.key);
  const breakdown = configured.map((q, i) => {
    const fq = stored[i] || null;
    const score = !fq || fq.score === null || fq.score === undefined ? null : parseFloat(Number(fq.score).toFixed(2));
    const originalText = hasSnapshot && fq ? (fq.text || fq.label || null) : null;
    const textChanged = hasSnapshot && (!fq || normalizeQuestionText(originalText) !== normalizeQuestionText(q.text || q.label));
    return {
      key: q.key,
      label: q.label,
      text: q.text || q.label,
      type: 'PERCENTAGE',
      dimension: q.dimension || null,
      visible_based_on: q.visible_based_on || 'Always',
      required_based_on: q.required_based_on || (q.mandatory === false ? 'Optional' : 'Always'),
      original_text: originalText,
      original_texts: textChanged && originalText ? [originalText] : [],
      text_changed: textChanged,
      file_label: fq ? (fq.file_label !== undefined ? fq.file_label : (hasSnapshot ? null : fq.label || null)) : null,
      avg_score: score,
      normalized_score: score,
      response_count: essResult.participation,
      percent_favorable: score,
      percent_neutral: null,
      percent_unfavorable: null
    };
  });
  const index = parseFloat(Number(essResult.index).toFixed(2));
  const normalizedTarget = normalizeTarget(metric, targetConfig);
  const normalized = normalizeScore({ ...metric, ...targetConfig }, essResult.index);
  const dimName = configured.find(q => q.dimension)?.dimension || metric.metric_name.replace(/\s*\(ESS\)\s*$/i, '');
  const scopedDirs = scopes ? scopes.map(s => s.directorate) : null;
  const byDirectorate = essResult.rows
    .filter(r => (scopedDirs ? r.org_level === 'DIRECTORATE' && scopedDirs.includes(r.directorate) : true))
    .sort((a, b) => (a.org_level === b.org_level ? String(a.directorate).localeCompare(String(b.directorate), undefined, { sensitivity: 'base' }) : (a.org_level === 'BANKWIDE' ? -1 : 1)))
    .map(r => ({
      org_level: r.org_level,
      directorate: r.org_level === 'BANKWIDE' ? 'PT Bank CIMB Niaga Tbk (Bankwide)' : r.directorate,
      participation: r.participation,
      index_score: parseFloat(Number(r.index_score).toFixed(2)),
      questions: (r.questions || []).map((q, i) => ({ label: configured[i] ? (configured[i].text || configured[i].label) : (q.text || q.label), score: q.score === null || q.score === undefined ? null : parseFloat(Number(q.score).toFixed(2)) })),
      is_selected: essResult.level === 'BANKWIDE' ? r.org_level === 'BANKWIDE' : (r.org_level === 'DIRECTORATE' && (scopedDirs ? scopedDirs.includes(r.directorate) : r.directorate === essDirectorate))
    }));
  const uploadId = (essResult.rows[0] || {}).upload_id || null;
  const upload = uploadId ? (await storage.getSurveyUploads()).find(u => u.upload_id === uploadId) : null;
  const meta = {
    metric_id: id,
    metric_name: metric.metric_name,
    metric_type: 'SURVEY',
    scale_type: metric.scale_type,
    experience_owner: metric.experience_owner,
    source_of_data: metric.source_of_data,
    survey_source: metric.survey_source || null,
    journey_name: journey?.journey_name || '',
    checkpoint_name: checkpoint?.checkpoint_name || '',
    target_value: targetConfig.target_value,
    target_value_normalized: round2(normalizedTarget),
    target_display: targetConfig.target_display,
    unit: metric.unit,
    min_threshold: targetConfig.min_threshold,
    is_employee_metric: isEmployeeMetric,
    target_audience: metric.target_audience || (isEmployeeMetric ? 'EMPLOYEE' : 'EXTERNAL_MARKET')
  };
  return {
    metric: meta,
    ...meta,
    is_survey: true,
    is_outcome: false,
    is_ess: true,
    is_ess_summary: true,
    ess_period: essResult.period,
    ess_period_label: essResult.period_label,
    ess_carried_forward: essResult.carried_forward,
    // v2.50.0: SNAPSHOT = the result stores its question set; CURRENT_CONFIG = uploaded before v2.50.0 (shown with today's questions)
    question_text_source: hasSnapshot ? 'SNAPSHOT' : 'CURRENT_CONFIG',
    questions_changed_since_upload: hasSnapshot && (stored.length !== configured.length || breakdown.some(b => b.text_changed)),
    latest_survey_period: essResult.period,
    last_survey_date: essResult.period,
    ess_level: essResult.level,
    ess_division_filtered: !!subDirectorate && subDirectorate !== 'ALL',
    ess_summary: {
      dimension_name: dimName,
      summary_score: index,
      percent_favorable: index,
      percent_neutral: null,
      percent_unfavorable: null,
      questions_count: breakdown.length,
      participation: essResult.participation,
      period: essResult.period,
      period_label: essResult.period_label,
      description: `ESS result ${essResult.period_label}${essResult.carried_forward ? ' (latest available)' : ''} (uploaded ESS summary): the index (column F) and the question scores as stated in the file${essResult.level === 'DIRECTORATE' ? ', at directorate level' : ', bankwide'}.`
    },
    ess_results_by_directorate: byDirectorate,
    ess_upload: upload ? { upload_id: upload.upload_id, file_name: upload.file_name, uploaded_by: upload.uploaded_by, uploaded_at: upload.uploaded_at, has_original_file: !!essOriginalFilePath(upload.upload_id) } : null,
    is_disabled: isDisabled,
    disabled_reason: disabledReason,
    journey_color: journey?.color || '#ED1C24',
    current_raw_value: index,
    normalized_score: parseFloat(normalized.toFixed(2)),
    status: normalized < targetConfig.min_threshold ? 'CRITICAL' : (normalized < normalizedTarget ? 'WARNING' : 'HEALTHY'),
    period: periodString,
    filter_options: queryFilter,
    total_respondents: essResult.participation,
    questions: breakdown,
    questions_breakdown: breakdown,
    responses: []
  };
}

module.exports = {
  tierInfo,
  getPxWeights,
  clearPxWeightsCache,
  pxWeightsError,
  normalizeScore,
  normalizeTarget,
  calculatePEIndex,
  getMetricDetail,
  computeMonthlyTrends,
  getLastCompleteMonth,
  syncLiveEventMetrics
};
