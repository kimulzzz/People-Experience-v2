// server/services/alertEngine.js
const storage = require('../db/storage');
const { calculatePEIndex } = require('./calculationEngine');
const { generateAlertNarrative } = require('./localAiService');

/**
 * Scans metrics and generates actionable alerts with recommendations from Action Library & Survey Verbatims.
 * Narrative text is generated dynamically via local Ollama when available (falls back to a
 * deterministic rule-based sentence when Ollama is offline, so this always works on-premise).
 */
async function getAlertsAndRecommendations() {
  const calculation = calculatePEIndex();
  const actionLibrary = storage.getActionLibrary();
  // Aggregate verbatim feedback across ALL signature events in the database, not just one
  // fixed event ID — any new event created via the admin UI (see docs/06) automatically
  // contributes its feedback here too, instead of being silently excluded.
  const feedbackList = storage.getEvents()
    .flatMap(ev => storage.getFeedbackByEvent(ev.event_id) || []);
  const uploadedVerbatims = storage.getAllUploadedVerbatims() || [];
  const acknowledgedList = storage.getAcknowledgedAlerts() || [];

  const deficientMetrics = calculation.metrics.filter(metric => {
    const isCritical = metric.normalized_score < metric.min_threshold;
    const isWarning = metric.normalized_score < metric.target_value && !isCritical;
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
      .filter(u => u.metric_id === metric.metric_id)
      .map(u => u.verbatim);

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
