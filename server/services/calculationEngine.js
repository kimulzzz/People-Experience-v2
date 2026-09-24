// server/services/calculationEngine.js
const storage = require('../db/storage');
const { getQuestionsForMetric } = require('./metricQuestionService');

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

/**
 * Normalizes raw metric value into 0-100 scale based on scale type.
 */
function normalizeScore(metric, rawValue = null) {
  const value = rawValue !== null ? parseFloat(rawValue) : parseFloat(metric.raw_value || 0);
  const target = parseFloat(metric.target_value || 100);

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
 * Syncs event live participation & satisfaction scores into Metric 11 & Metric 12.
 */
function syncLiveEventMetrics() {
  const events = storage.getEvents();
  if (!events || events.length === 0) return;

  let totalAttendees = 0;
  let totalRatingSum = 0;
  let totalRatingCount = 0;

  events.forEach(event => {
    const atts = storage.getAttendancesByEvent(event.event_id);
    totalAttendees += atts.length;

    const feedbacks = storage.getFeedbackByEvent(event.event_id);
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
    const metric11Target = storage.getMetricTargetById(11) || storage.getMetricById(11);
    const quotaTarget = parseFloat((metric11Target && metric11Target.target_value) || 500);
    const normScore = quotaTarget > 0 ? Math.min((avgAttendance / quotaTarget) * 100, 100) : 0;
    storage.updateMetricScore(11, avgAttendance, normScore, 'Calculated from live event registrations');
  }

  if (totalRatingCount > 0) {
    const avgRating = totalRatingSum / totalRatingCount;
    const normScore = (avgRating / 5.0) * 100;
    storage.updateMetricScore(12, avgRating.toFixed(2), normScore.toFixed(2), 'Calculated from live event evaluations');
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

const MONTH_NAMES_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
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
function computeMonthlyTrends(filterOptions = {}) {
  const directorate = filterOptions.directorate || 'ALL';
  const subDirectorate = filterOptions.sub_directorate || filterOptions.subDirectorate || 'ALL';
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

  return pairs.map(({ year, month }) => {
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
      ? { mode: 'MTD', year: yearStr, month: monthNum, directorate, sub_directorate: subDirectorate }
      : { mode: 'YTD', year: yearStr, endMonth: monthNum, directorate, sub_directorate: subDirectorate };
    const periodResult = calculatePEIndex(periodFilter, { skipTrends: true });

    const responseCount = periodResult.metrics
      .filter(mt => mt.metric_type === 'SURVEY' && !mt.is_disabled)
      .reduce((sum, mt) => sum + (mt.sample_size || 0), 0);

    return {
      month_code: code,
      month_name: MONTH_NAMES_ID[idx],
      year: yearStr,
      has_actual_data: responseCount > 0,
      response_count: responseCount,
      survey_index: periodResult.survey_index,
      outcome_index: periodResult.outcome_index,
      px_index: periodResult.px_index,
      pe_index: periodResult.px_index // backward compatibility
    };
  });
}

/**
 * Calculates full PX Index consolidation based on active filter options:
 * - Mode: 'YTD' (default) -> Aggregates data for the selected year
 * - Mode: 'MTD' -> Filters data specific to selected year and month
 * - Directorate / Sub-Directorate: When selected, non-employee metrics (#1-#5) are disabled
 *   and excluded from journey & bankwide PX calculations.
 */
function calculatePEIndex(filterInput = 'YTD', options = {}) {
  syncLiveEventMetrics();

  let mode = 'YTD';
  let year = CURRENT_YEAR;
  let month = '01';
  let directorate = 'ALL';
  let subDirectorate = 'ALL';
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
  }

  const isDirectorateFiltered = directorate && directorate !== 'ALL';
  const queryFilter = { mode, year, month, directorate, sub_directorate: subDirectorate, period: periodString, endMonth };

  const metrics = storage.getMetrics();
  const journeys = storage.getJourneys();
  const checkpoints = storage.getCheckpoints();
  const targets = storage.getMetricTargets();

  // 1. Enrich each metric with normalized score, status, and period/directorate data
  const enrichedMetrics = metrics.map(m => {
    const targetConfig = (targets && targets[m.metric_id]) 
      || (Array.isArray(targets) ? targets.find(t => t.metric_id === m.metric_id) : null) 
      || {
        target_value: m.target_value,
        target_display: m.target_display,
        min_threshold: m.min_threshold
      };

    // Determine if this metric should be disabled in the current directorate scope
    const isEmployeeMetric = m.is_employee_metric !== undefined ? m.is_employee_metric : true;
    const isDisabled = isDirectorateFiltered && !isEmployeeMetric;
    const disabledReason = isDisabled ? 'Bankwide External / Non-Employee Metric (Exempted from Directorate Calculation)' : null;

    let rawVal = parseFloat(m.raw_value || 0);
    let sampleSize = null;
    let lastSurveyDate = null;

    if (m.metric_type === 'SURVEY') {
      const responses = storage.getResponsesByMetricAndPeriod(m.metric_id, queryFilter);
      sampleSize = responses.length;

      if (responses.length > 0) {
        const sum = responses.reduce((acc, r) => acc + (parseFloat(r.rating_score) || 0), 0);
        rawVal = sum / responses.length;
        const lastResp = responses[responses.length - 1];
        const rawDate = lastResp.survey_date || lastResp.created_at;
        lastSurveyDate = normalizeDateString(rawDate) || todayDateString();
      } else {
        lastSurveyDate = normalizeDateString(m.last_survey_date) || todayDateString();
      }
    } else {
      // OUTCOME METRICS — last ingestion date is a real database field (`last_data_date`,
      // seeded by OUTCOME_INGESTION_DATES in seedData.js, admin-editable via
      // PUT /api/admin/metrics/:id), not a hardcoded lookup in business logic.
      const rawDate = m.last_data_date || m.last_survey_date || todayDateString();
      lastSurveyDate = normalizeDateString(rawDate) || todayDateString();
    }

    const normScore = normalizeScore({ ...m, ...targetConfig }, rawVal);
    const minThreshold = parseFloat(targetConfig.min_threshold || 75);
    const normalizedTarget = normalizeTarget(m, targetConfig);

    let status = 'HEALTHY';
    if (normScore < minThreshold) {
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
      experience_owner: m.experience_owner,
      target_value: targetConfig.target_value,
      target_value_normalized: parseFloat(normalizedTarget.toFixed(2)),
      target_display: targetConfig.target_display,
      min_threshold: targetConfig.min_threshold,
      raw_value: parseFloat(rawVal.toFixed(2)),
      normalized_score: parseFloat(normScore.toFixed(2)),
      weight,
      status,
      sample_size: sampleSize,
      last_survey_date: lastSurveyDate,
      gap: parseFloat((normalizedTarget - normScore).toFixed(2)),
      is_employee_metric: isEmployeeMetric,
      target_audience: m.target_audience || (isEmployeeMetric ? 'EMPLOYEE' : 'EXTERNAL_MARKET'),
      is_disabled: isDisabled,
      disabled_reason: disabledReason
    };
  });

  // 2. Separate Active Survey vs Outcome metrics (Excluding Disabled non-employee metrics when directorate is selected)
  const activeMetrics = enrichedMetrics.filter(m => !m.is_disabled);
  const activeSurveyMetrics = activeMetrics.filter(m => m.metric_type === 'SURVEY');
  const activeOutcomeMetrics = activeMetrics.filter(m => m.metric_type === 'OUTCOME');

  // 3. Survey Index (calculated exclusively from active survey metrics)
  const totalSurveyWeight = activeSurveyMetrics.reduce((sum, m) => sum + m.weight, 0);
  const weightedSurveySum = activeSurveyMetrics.reduce((sum, m) => sum + (m.normalized_score * m.weight), 0);
  const surveyIndex = totalSurveyWeight > 0 ? weightedSurveySum / totalSurveyWeight : 0;

  // 4. Outcome Index (calculated exclusively from active outcome metrics)
  const totalOutcomeWeight = activeOutcomeMetrics.reduce((sum, m) => sum + m.weight, 0);
  const weightedOutcomeSum = activeOutcomeMetrics.reduce((sum, m) => sum + (m.normalized_score * m.weight), 0);
  const outcomeIndex = totalOutcomeWeight > 0 ? weightedOutcomeSum / totalOutcomeWeight : 0;

  // 5. Consolidated PX Index: 70% Survey + 30% Outcomes (adaptive if only survey or outcome available)
  let pxIndex = 0;
  if (totalSurveyWeight > 0 && totalOutcomeWeight > 0) {
    pxIndex = (0.70 * surveyIndex) + (0.30 * outcomeIndex);
  } else if (totalSurveyWeight > 0) {
    pxIndex = surveyIndex;
  } else if (totalOutcomeWeight > 0) {
    pxIndex = outcomeIndex;
  }

  // 6. Rollup by Journey
  const journeySummaries = journeys.map(j => {
    const jMetrics = enrichedMetrics.filter(m => m.journey_id === j.journey_id);
    const jActiveMetrics = jMetrics.filter(m => !m.is_disabled);
    const jSurvey = jActiveMetrics.filter(m => m.metric_type === 'SURVEY');
    const jOutcome = jActiveMetrics.filter(m => m.metric_type === 'OUTCOME');

    const sWeight = jSurvey.reduce((s, m) => s + m.weight, 0);
    const sScore = sWeight > 0 ? jSurvey.reduce((s, m) => s + (m.normalized_score * m.weight), 0) / sWeight : null;

    const oWeight = jOutcome.reduce((s, m) => s + m.weight, 0);
    const oScore = oWeight > 0 ? jOutcome.reduce((s, m) => s + (m.normalized_score * m.weight), 0) / oWeight : null;

    let jOverallScore = 0;
    if (sScore !== null && oScore !== null) {
      jOverallScore = (0.70 * sScore) + (0.30 * oScore);
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
      overall_score: parseFloat(jOverallScore.toFixed(2)),
      metrics_count: jMetrics.length,
      active_metrics_count: jActiveMetrics.length,
      disabled_metrics_count: disabledCount,
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
    const cpActiveMetrics = cpMetrics.filter(m => !m.is_disabled);
    const totalWeight = cpActiveMetrics.reduce((s, m) => s + m.weight, 0);
    const cpScore = totalWeight > 0 ? cpActiveMetrics.reduce((s, m) => s + (m.normalized_score * m.weight), 0) / totalWeight : 0;

    return {
      checkpoint_id: cp.checkpoint_id,
      journey_id: cp.journey_id,
      checkpoint_name: cp.checkpoint_name,
      experience_owner: cp.experience_owner,
      score: parseFloat(cpScore.toFixed(2)),
      metrics_count: cpMetrics.length,
      active_metrics_count: cpActiveMetrics.length,
      metrics: cpMetrics
    };
  });

  // computeMonthlyTrends() itself calls calculatePEIndex() once per month (with
  // skipTrends: true) to guarantee the trend chart's numbers are computed via the exact
  // same per-metric weighted-normalization logic as this scorecard. Skip re-computing
  // trends on those 12 inner calls, or this would recurse indefinitely.
  const monthlyTrends = options.skipTrends ? [] : computeMonthlyTrends(queryFilter);

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
      is_directorate_filtered: isDirectorateFiltered
    },
    px_index: parseFloat(pxIndex.toFixed(2)),
    pe_index: parseFloat(pxIndex.toFixed(2)), // backward compatibility
    survey_index: parseFloat(surveyIndex.toFixed(2)),
    outcome_index: parseFloat(outcomeIndex.toFixed(2)),
    weights_formula: '70% Survey + 30% Outcomes (Normalized across active metrics)',
    total_metrics: enrichedMetrics.length,
    active_metrics_count: activeMetrics.length,
    disabled_metrics_count: enrichedMetrics.length - activeMetrics.length,
    survey_metrics_count: activeSurveyMetrics.length,
    outcome_metrics_count: activeOutcomeMetrics.length,
    monthly_trends: monthlyTrends,
    available_years: storage.getAvailableSurveyYears(),
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
function getMetricDetail(metricId, filterInput = 'YTD') {
  const id = parseInt(metricId);
  const metrics = storage.getMetrics();
  const metric = metrics.find(m => m.metric_id === id);
  if (!metric) return null;

  let mode = 'YTD';
  let year = CURRENT_YEAR;
  let month = '01';
  let directorate = 'ALL';
  let subDirectorate = 'ALL';
  let periodString = 'YTD';

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
  }

  const isDirectorateFiltered = directorate && directorate !== 'ALL';
  const queryFilter = { mode, year, month, directorate, sub_directorate: subDirectorate, period: periodString };

  const isEmployeeMetric = metric.is_employee_metric !== undefined ? metric.is_employee_metric : true;
  const isDisabled = isDirectorateFiltered && !isEmployeeMetric;
  const disabledReason = isDisabled ? 'Bankwide External / Non-Employee Metric (Exempted from Directorate Calculation)' : null;

  const targetConfig = storage.getMetricTargetById(id) || {
    target_value: metric.target_value,
    target_display: metric.target_display,
    min_threshold: metric.min_threshold
  };

  const journeys = storage.getJourneys();
  const checkpoints = storage.getCheckpoints();
  const journey = journeys.find(j => j.journey_id === metric.journey_id);
  const checkpoint = checkpoints.find(c => c.checkpoint_id === metric.checkpoint_id);

  const isSurvey = metric.metric_type === 'SURVEY';
  const isEss = (metric.source_of_data || '').toUpperCase().includes('ESS');

  if (!isSurvey) {
    // Outcome metric: Internal HR system data
    let operationalRecords = [];
    if (id === 11) {
      // Live event attendance registrations from PXCWB
      const attendances = storage.getAttendances();
      const events = storage.getEvents();
      operationalRecords = attendances.map(a => {
        const ev = events.find(e => e.event_id === a.event_id);
        return {
          nip: a.nip,
          employee_name: a.employee_name,
          cimb_email: a.cimb_email,
          directorate: a.directorate,
          division: a.division,
          event_title: ev ? ev.title : 'Signature Program Event',
          registered_at: a.checkin_time || a.created_at
        };
      });
    } else {
      // Operational drilldown table for this OUTCOME metric (recruitment SLA by unit, approval
      // stage compliance, hiring channel mix, recognition categories, attrition by tenure) —
      // sourced from the database (server/data/store.json via storage.getOperationalRecords()),
      // not frozen inline here. Metrics without a seeded breakdown table simply return [].
      operationalRecords = storage.getOperationalRecords(id);
    }

    const rawVal = parseFloat(metric.raw_value || 0);
    const normalizedScore = normalizeScore({ ...metric, ...targetConfig }, rawVal);
    const normalizedTargetOutcome = normalizeTarget(metric, targetConfig);

    return {
      metric: {
        metric_id: id,
        metric_name: metric.metric_name,
        metric_type: 'OUTCOME',
        scale_type: metric.scale_type,
        experience_owner: metric.experience_owner,
        source_of_data: metric.source_of_data,
        journey_name: journey?.journey_name || '',
        checkpoint_name: checkpoint?.checkpoint_name || '',
        target_value: targetConfig.target_value,
        target_value_normalized: parseFloat(normalizedTargetOutcome.toFixed(2)),
        target_display: targetConfig.target_display,
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
      journey_name: journey?.journey_name || '',
      journey_color: journey?.color || '#ED1C24',
      checkpoint_name: checkpoint?.checkpoint_name || '',
      target_value: targetConfig.target_value,
      target_value_normalized: parseFloat(normalizedTargetOutcome.toFixed(2)),
      target_display: targetConfig.target_display,
      min_threshold: targetConfig.min_threshold,
      current_raw_value: rawVal,
      normalized_score: parseFloat(normalizedScore.toFixed(2)),
      status: normalizedScore < targetConfig.min_threshold ? 'CRITICAL' : (normalizedScore < normalizedTargetOutcome ? 'WARNING' : 'HEALTHY'),
      period: periodString,
      filter_options: queryFilter,
      total_respondents: null,
      questions: [],
      questions_breakdown: [],
      responses: [],
      operational_records: operationalRecords
    };
  }

  // Survey metric logic
  const questions = storage.getSurveyQuestions(id);
  const responses = storage.getResponsesByMetricAndPeriod(id, queryFilter);

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
            employee_name: r.participant_name || r.candidate_name || r.employee_name || 'Responden',
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
        description: 'Data ESS merupakan rangkuman skor kepuasan (% Favorable) dari butir-butir pertanyaan survei sentimen karyawan tahunan.'
      };
    }
  }

  // Real response count from the database — no fabricated population placeholder. A metric
  // with genuinely zero responses reports 0, not an invented "typical ESS sample size".
  const totalRespondents = responses.length;
  
  let overallAvg = responses.length > 0 
    ? responses.reduce((acc, r) => acc + (parseFloat(r.rating_score) || 0), 0) / responses.length
    : parseFloat(metric.raw_value || 0);

  if (isEss && responses.length === 0 && essSummary) {
    overallAvg = essSummary.summary_score;
  }

  const normalizedOverall = isEss && responses.length === 0 && essSummary
    ? essSummary.summary_score
    : normalizeScore({ ...metric, ...targetConfig }, overallAvg);
  const normalizedTargetSurvey = normalizeTarget(metric, targetConfig);

  return {
    metric: {
      metric_id: id,
      metric_name: metric.metric_name,
      metric_type: 'SURVEY',
      scale_type: metric.scale_type,
      experience_owner: metric.experience_owner,
      source_of_data: metric.source_of_data,
      journey_name: journey?.journey_name || '',
      checkpoint_name: checkpoint?.checkpoint_name || '',
      target_value: targetConfig.target_value,
      target_value_normalized: parseFloat(normalizedTargetSurvey.toFixed(2)),
      target_display: targetConfig.target_display,
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
    journey_name: journey?.journey_name || '',
    journey_color: journey?.color || '#ED1C24',
    checkpoint_name: checkpoint?.checkpoint_name || '',
    target_value: targetConfig.target_value,
    target_value_normalized: parseFloat(normalizedTargetSurvey.toFixed(2)),
    target_display: targetConfig.target_display,
    min_threshold: targetConfig.min_threshold,
    current_raw_value: parseFloat(overallAvg.toFixed(2)),
    normalized_score: parseFloat(normalizedOverall.toFixed(2)),
    status: normalizedOverall < targetConfig.min_threshold ? 'CRITICAL' : (normalizedOverall < normalizedTargetSurvey ? 'WARNING' : 'HEALTHY'),
    period: periodString,
    filter_options: queryFilter,
    total_respondents: totalRespondents,
    questions: questionBreakdown,
    questions_breakdown: questionBreakdown,
    // Most-recent-first, capped at 100 for payload size — sorting before capping matters:
    // as seeded response volume has grown (2025 + extended 2026 monthly data), a metric can
    // now have well over 100 responses in a single period, and a plain insertion-order slice
    // would silently hide any freshly-uploaded response that happens to land past index 100.
    responses: [...responses]
      .sort((a, b) => (b.survey_date || b.created_at || '').localeCompare(a.survey_date || a.created_at || ''))
      .slice(0, 100)
  };
}

module.exports = {
  normalizeScore,
  normalizeTarget,
  calculatePEIndex,
  getMetricDetail,
  computeMonthlyTrends,
  getLastCompleteMonth,
  syncLiveEventMetrics
};
