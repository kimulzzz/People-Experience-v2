// server/services/alertEngine.js
const storage = require('../db/storage');
const { calculatePEIndex } = require('./calculationEngine');
const { generateAlertNarrative } = require('./localAiService');
const { rowInScopes } = require('../db/scopeUtils');

/**
 * Scans metrics and generates actionable alerts with recommendations from Action Library & Survey Verbatims.
 * Narrative text is generated dynamically via local Ollama when available (falls back to a
 * deterministic rule-based sentence when Ollama is offline, so this always works on-premise).
 *
 * `scope` ({ directorate, sub_directorate, scopes, bankwideReadOnly }, see authService.resolveScope) limits
 * everything to a data scope: scores are RE-COMPUTED from the in-scope responses (not just relabelled) and
 * verbatims / event feedback only come from in-scope respondents. No scope (Admin) = bankwide, as before.
 */
async function getAlertsAndRecommendations(scope = {}) {
  const directorate = scope.directorate || 'ALL';
  const subDirectorate = scope.sub_directorate || 'ALL';
  const scopes = scope.scopes || null;
  const isScoped = !!scopes || directorate !== 'ALL' || subDirectorate !== 'ALL';

  const calculation = await calculatePEIndex(
    { mode: 'YTD', directorate, sub_directorate: subDirectorate, scopes },
    { skipTrends: true, bankwideReadOnly: !!scope.bankwideReadOnly });
  const actionLibrary = await storage.getActionLibrary();
  // Aggregate verbatim feedback across ALL signature events in the database, not just one
  // fixed event ID — any new event created via the admin UI (see docs/06) automatically
  // contributes its feedback here too, instead of being silently excluded.
  const allEvents = (await storage.getEvents()) || [];
  const feedbackList = (await Promise.all(allEvents.map(async ev => {
    const list = (await storage.getFeedbackByEvent(ev.event_id)) || [];
    if (!isScoped) return list;
    // Event feedback only carries the NIP: keep it when that attendee (same event) is inside the scope.
    const atts = (await storage.getAttendancesByEvent(ev.event_id)) || [];
    return list.filter(f => atts.some(a => a.nip === f.nip
      && (directorate === 'ALL' || a.directorate === directorate)
      && (subDirectorate === 'ALL' || a.division === subDirectorate)
      && (!scopes || rowInScopes(scopes, a.directorate, a.division))));
  }))).flatMap(list => list || []);
  // Uploaded comments: bankwide for Admin; for a scoped read only those of in-scope respondents (plus the
  // bankwide read-only metrics, which are not directorate data).
  const uploadedVerbatims = isScoped ? null : ((await storage.getAllUploadedVerbatims()) || []);
  const acknowledgedList = (await storage.getAcknowledgedAlerts()) || [];

  const deficientMetrics = calculation.metrics.filter(metric => !metric.is_disabled).filter(metric => {
    const isCritical = metric.normalized_score < metric.min_threshold;
    // Compare against the target on the same 0-100 scale as normalized_score (RATING_5 / QUOTA_COUNT
    // targets are stored in their native scale) — same rule as the metric status in calculatePEIndex().
    const isWarning = metric.normalized_score < (metric.target_value_normalized ?? metric.target_value) && !isCritical;
    return isCritical || isWarning;
  });

  // Narratives are generated in parallel (Ollama call per deficit metric, each with its own
  // offline rule-based fallback inside generateAlertNarrative) to keep response time reasonable.
  const alerts = await Promise.all(deficientMetrics.map(async metric => {
    const isCritical = metric.normalized_score < metric.min_threshold;

    // Find matching action from library
    const matchedAction = actionLibrary.find(
      a => a.metric_id === metric.metric_id || a.checkpoint_id === metric.checkpoint_id
    );

    // Find journey details
    const journey = calculation.journeys.find(j => j.journey_id === metric.journey_id);

    // Extract verbatim feedback insights (combining event feedback + uploaded survey comments)
    const metricUploadedVerbatims = uploadedVerbatims
      ? uploadedVerbatims.filter(u => u.metric_id === metric.metric_id).map(u => u.verbatim)
      : ((await storage.getResponsesByMetricAndPeriod(metric.metric_id, metric.excluded_from_index
        ? { mode: 'ALL' }
        : { mode: 'ALL', directorate, sub_directorate: subDirectorate, scopes })) || [])
        .filter(r => r.verbatim_feedback && r.verbatim_feedback.trim().length > 3)
        .map(r => r.verbatim_feedback);

    const eventVerbatims = feedbackList
      .filter(f => f.verbatim && f.verbatim.length > 5)
      .map(f => f.verbatim);

    const combinedVerbatims = [...metricUploadedVerbatims, ...eventVerbatims];

    // Construct synthesized recommendation narrative
    let actionText = matchedAction ? matchedAction.recommended_action : `Lakukan evaluasi berkala dan koordinasi dengan ${metric.experience_owner} untuk mencapai target ${metric.target_display}.`;
    let initiatives = matchedAction ? matchedAction.suggested_initiatives : '1. Lakukan audit proses pada checkpoint terkait.\n2. Jadwalkan review bulanan bersama PIC.';

    // Dynamic narrative via local Ollama (auto falls back to rule-based sentence if offline)
    const narrative = await generateAlertNarrative(metric, journey, actionText);

    return {
      alert_id: `alt-${metric.metric_id}`,
      metric_id: metric.metric_id,
      metric_name: metric.metric_name,
      journey_id: metric.journey_id,
      journey_name: journey ? journey.journey_name : '',
      journey_color: journey ? journey.color : '#ED1C24',
      experience_owner: metric.experience_owner,
      source_of_data: metric.source_of_data,
      current_score: metric.normalized_score,
      target_value: metric.target_value,
      target_display: metric.target_display,
      min_threshold: metric.min_threshold,
      gap: metric.gap,
      severity: isCritical ? 'CRITICAL' : 'WARNING',
      is_bankwide_readonly: !!metric.excluded_from_index,
      is_acknowledged: acknowledgedList.includes(metric.metric_id),
      recommended_action: actionText,
      suggested_initiatives: initiatives,
      narrative_summary: narrative,
      verbatim_insights: combinedVerbatims.slice(0, 3)
    };
  }));

  // Sort critical first, then by highest gap
  alerts.sort((a, b) => {
    if (a.severity === 'CRITICAL' && b.severity !== 'CRITICAL') return -1;
    if (a.severity !== 'CRITICAL' && b.severity === 'CRITICAL') return 1;
    return b.gap - a.gap;
  });

  return {
    total_alerts: alerts.length,
    critical_count: alerts.filter(a => a.severity === 'CRITICAL').length,
    warning_count: alerts.filter(a => a.severity === 'WARNING').length,
    alerts
  };
}

module.exports = {
  getAlertsAndRecommendations
};
