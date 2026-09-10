import React from 'react';
import { 
  TrendingUp, 
  AlertTriangle, 
  CheckCircle2, 
  ChevronRight, 
  Sparkles, 
  ArrowUpRight, 
  Award,
  Users,
  HeartHandshake,
  UserPlus,
  LogOut,
  Layers,
  HelpCircle,
  ExternalLink,
  Calendar,
  Eye
} from 'lucide-react';
import TrendChart from './TrendChart';

const journeyIcons = {
  ARRIVAL: UserPlus,
  CONNECT: Users,
  BELONG: HeartHandshake,
  CONTRIBUTE: TrendingUp,
  DEPART: LogOut
};

export default function Dashboard({ 
  calculationData, 
  alertsData, 
  selectedPeriod = 'YTD',
  filterOptions = { mode: 'YTD', year: '2026', month: '01', directorate: 'ALL', sub_directorate: 'ALL' },
  onSelectPeriod,
  onSelectJourney, 
  onSelectMetric,
  onAcknowledgeAlert,
  onNavigateToSimulator,
  onNavigateToEvents
}) {
  if (!calculationData) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#ED1C24]" />
      </div>
    );
  }

  const { px_index, pe_index, survey_index, outcome_index, journeys, metrics, monthly_trends } = calculationData;
  const currentPxIndex = px_index !== undefined ? px_index : (pe_index || 0);
  const criticalAlerts = alertsData?.alerts?.filter(a => a.severity === 'CRITICAL') || [];
  const warningAlerts = alertsData?.alerts?.filter(a => a.severity === 'WARNING') || [];

  const mode = filterOptions?.mode || 'YTD';
  const year = filterOptions?.year || '2026';
  const month = filterOptions?.month || '01';
  const directorate = filterOptions?.directorate || 'ALL';
  const subDirectorate = filterOptions?.sub_directorate || 'ALL';
  const isBankwide = directorate === 'ALL';

  const periodLabel = mode === 'YTD' ? `Year-to-Date (YTD) ${year}` : `Month-to-Date (MTD) ${year}-${month}`;

  return (
    <div className="space-y-6">
      
      {/* 1. HERO BANNER: PX INDEX CONSOLIDATION */}
      <div className="bg-gradient-to-r from-[#231F20] via-[#2D2A2B] to-[#1A1819] rounded-2xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden">
        {/* Subtle background glow */}
        <div className="absolute -right-10 -bottom-10 w-72 h-72 bg-[#ED1C24] opacity-20 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          
          {/* Main PX Index Score */}
          <div className="lg:col-span-5 space-y-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="inline-flex items-center space-x-1.5 px-3 py-1 bg-red-500/20 text-red-300 border border-red-500/30 rounded-full text-xs font-semibold">
                <Award className="w-3.5 h-3.5 text-[#ED1C24]" />
                <span>CIMB Niaga PX Index • {periodLabel}</span>
              </div>
              {!isBankwide && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  {directorate} {subDirectorate !== 'ALL' ? `• ${subDirectorate}` : ''}
                </span>
              )}
            </div>
            
            <div className="flex items-baseline space-x-3">
              <span className="text-6xl sm:text-7xl font-extrabold tracking-tight text-white">
                {currentPxIndex.toFixed(2)}
              </span>
              <span className="text-2xl font-bold text-red-400">/ 100</span>
            </div>

            <p className="text-sm text-gray-300 font-medium">
              Formula: <strong className="text-white">70% Survey Results</strong> ({survey_index.toFixed(2)}%) + <strong className="text-white">30% Outcome (HR Data)</strong> ({outcome_index.toFixed(2)}%)
            </p>

            <div className="pt-2 flex flex-wrap gap-2">
              <button
                onClick={onNavigateToSimulator}
                className="px-4 py-2 bg-[#ED1C24] hover:bg-[#D91B23] text-white rounded-lg text-xs font-bold transition flex items-center space-x-2 shadow-md shadow-red-900/30"
              >
                <span>Simulate & Edit Metrics</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={onNavigateToEvents}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-bold transition flex items-center space-x-2 border border-white/20"
              >
                <span>Manage Signature Programs</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Survey vs Outcome Breakdown Cards */}
          <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
            
            {/* Survey Score Card */}
            <div className="bg-white/10 backdrop-blur-md rounded-xl p-5 border border-[#16C0B7]/30 space-y-3">
              <div className="flex justify-between items-start">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-[#16C0B7]">Weight 70% • Survey Responses</span>
                  <h4 className="text-base font-bold text-white">Survey Results</h4>
                </div>
                <span className="px-2 py-0.5 bg-[#16C0B7]/20 text-[#16C0B7] border border-[#16C0B7]/40 rounded text-[11px] font-semibold">
                  20 Metrics
                </span>
              </div>

              <div className="flex items-baseline space-x-2">
                <span className="text-3xl font-extrabold text-white">{survey_index.toFixed(2)}</span>
                <span className="text-xs text-gray-400">%</span>
              </div>

              <div className="w-full bg-black/40 rounded-full h-2 overflow-hidden">
                <div 
                  className="bg-[#16C0B7] h-2 rounded-full transition-all duration-500 shadow-sm" 
                  style={{ width: `${Math.min(survey_index, 100)}%` }}
                />
              </div>
              <p className="text-[11px] text-gray-300">
                Calculated from multiple survey instruments (ESS, Onboarding, Arjuna Survey, Event Evaluations) via automated feeds and CSV uploads.
              </p>
            </div>

            {/* Outcome Score Card */}
            <div className="bg-white/10 backdrop-blur-md rounded-xl p-5 border border-blue-500/30 space-y-3">
              <div className="flex justify-between items-start">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-blue-400">Weight 30% • Internal HR Data</span>
                  <h4 className="text-base font-bold text-white">Outcome Metrics</h4>
                </div>
                <span className="px-2 py-0.5 bg-blue-500/20 text-blue-300 border border-blue-500/40 rounded text-[11px] font-semibold">
                  7 Metrics
                </span>
              </div>

              <div className="flex items-baseline space-x-2">
                <span className="text-3xl font-extrabold text-white">{outcome_index.toFixed(2)}</span>
                <span className="text-xs text-gray-400">%</span>
              </div>

              <div className="w-full bg-black/40 rounded-full h-2 overflow-hidden">
                <div 
                  className="bg-[#2563EB] h-2 rounded-full transition-all duration-500 shadow-sm" 
                  style={{ width: `${Math.min(outcome_index, 100)}%` }}
                />
              </div>
              <p className="text-[11px] text-gray-300">
                Ingested from CIMB internal HR data feeds (Recruitment SLAs, Arjuna Recognition, Program Attendance, Retention & Turnover).
              </p>
            </div>

          </div>

        </div>
      </div>

      {/* 2. MONTHLY TREND & PROGRESSION CHART */}
      <TrendChart
        trendData={monthly_trends}
        selectedPeriod={selectedPeriod}
        onSelectPeriod={onSelectPeriod}
        ytdPeIndex={currentPxIndex}
      />

      {/* 3. ACTIVE ALERTS & ACTION RECOMMENDATIONS (SLIDE 10 FRAMEWORK) */}
      {(criticalAlerts.length > 0 || warningAlerts.length > 0) && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-5 h-5 text-[#ED1C24]" />
              <h3 className="text-base font-extrabold text-[#231F20]">
                Score Deficit Alerts & Action Plans (PX Framework)
              </h3>
            </div>
            <span className="text-xs text-gray-500 font-medium">
              Automatically generated from the <strong className="text-[#231F20]">Action Library</strong> and survey feedback analytics
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[...criticalAlerts, ...warningAlerts].map((alert) => (
              <div
                key={alert.alert_id}
                className={`rounded-xl p-4 sm:p-5 border transition shadow-xs ${
                  alert.severity === 'CRITICAL'
                    ? 'bg-red-50/70 border-red-200'
                    : 'bg-amber-50/70 border-amber-200'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${
                        alert.severity === 'CRITICAL' 
                          ? 'bg-[#ED1C24] text-white' 
                          : 'bg-amber-500 text-white'
                      }`}>
                        {alert.severity === 'CRITICAL' ? 'CRITICAL DEFICIT' : 'WARNING GAP'}
                      </span>
                      <span className="text-xs font-bold text-gray-600">
                        Journey: {alert.journey_name}
                      </span>
                    </div>
                    <h4 
                      onClick={() => onSelectMetric && onSelectMetric(alert.metric_id)}
                      className="text-sm font-bold text-[#231F20] hover:text-[#ED1C24] cursor-pointer flex items-center space-x-1"
                    >
                      <span>{alert.metric_name}</span>
                      <Eye className="w-3.5 h-3.5 opacity-60" />
                    </h4>
                  </div>

                  <div className="text-right">
                    <span className="text-lg font-black text-[#ED1C24]">
                      {alert.current_score}%
                    </span>
                    <p className="text-[10px] text-gray-500 font-medium">
                      Target: {alert.target_display}
                    </p>
                  </div>
                </div>

                {/* AI & Library Recommendation */}
                <div className="mt-3 bg-white/80 rounded-lg p-3 border border-gray-200/80 space-y-2 text-xs">
                  <div className="flex items-center space-x-1.5 text-[#231F20] font-bold">
                    <Sparkles className="w-3.5 h-3.5 text-[#ED1C24]" />
                    <span>Recommended Immediate Action ({alert.experience_owner}):</span>
                  </div>
                  <p className="text-gray-700 leading-relaxed font-medium">
                    {alert.recommended_action}
                  </p>
                  {alert.suggested_initiatives && (
                    <div className="text-[11px] text-gray-600 bg-gray-50 rounded p-2 border border-gray-100 whitespace-pre-line font-mono">
                      {alert.suggested_initiatives}
                    </div>
                  )}
                </div>

                {/* Footer status */}
                <div className="mt-3 flex items-center justify-between text-[11px] text-gray-500">
                  <span>Data Source: <strong>{alert.source_of_data}</strong></span>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => onSelectMetric && onSelectMetric(alert.metric_id)}
                      className="px-2.5 py-1 text-xs font-semibold bg-white hover:bg-gray-100 text-[#ED1C24] border border-red-200 rounded shadow-2xs transition flex items-center space-x-1"
                    >
                      <Eye className="w-3 h-3" />
                      <span>View Metric Detail</span>
                    </button>
                    <button
                      onClick={() => onAcknowledgeAlert(alert.metric_id)}
                      className="px-2.5 py-1 text-xs font-semibold bg-white hover:bg-gray-100 text-gray-700 border border-gray-300 rounded shadow-2xs transition"
                    >
                      Acknowledge
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. THE 5 JOURNEYS BREAKDOWN CARDS */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-extrabold text-[#231F20]">
              5 Employee Experience Journeys (17 Check Points • 27 PX Metrics)
            </h3>
            <p className="text-xs text-gray-500">
              Click a Journey card to filter checkpoints, or click a metric to inspect detailed questions and survey responses
            </p>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 bg-red-100 text-[#ED1C24] rounded-md">
            Period: {periodLabel}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {journeys.map((j) => {
            const Icon = journeyIcons[j.journey_code] || Users;
            return (
              <div
                key={j.journey_id}
                className="bg-white rounded-xl p-5 border border-gray-200 hover:border-gray-300 hover:shadow-md transition flex flex-col justify-between group space-y-4"
              >
                {/* Header */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div 
                      onClick={() => onSelectJourney(j.journey_id)}
                      className="flex items-center space-x-2 cursor-pointer"
                    >
                      <div 
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold"
                        style={{ backgroundColor: j.color }}
                      >
                        <Icon className="w-4 h-4" />
                      </div>
                      <div>
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                          Journey #{j.journey_id}
                        </span>
                        <h4 className="text-base font-extrabold text-[#231F20] group-hover:text-[#ED1C24] transition">
                          {j.journey_name}
                        </h4>
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="text-2xl font-black text-[#231F20]">
                        {j.overall_score !== null && j.overall_score !== undefined ? j.overall_score.toFixed(1) : 'Exempted'}
                      </span>
                      {j.overall_score !== null && j.overall_score !== undefined && (
                        <span className="text-xs text-gray-400 font-bold">%</span>
                      )}
                    </div>
                  </div>

                  <p className="text-xs text-gray-500 line-clamp-2">
                    {j.tagline}
                  </p>
                </div>

                {/* Progress Bar */}
                <div className="space-y-1">
                  <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                    <div 
                      className="h-2 rounded-full transition-all duration-500" 
                      style={{ 
                        width: `${Math.min(j.overall_score || 0, 100)}%`,
                        backgroundColor: j.overall_score === null ? '#9CA3AF' : j.color 
                      }}
                    />
                  </div>
                </div>

                {/* Sub-scores: Survey vs Outcome */}
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-100 text-xs">
                  <div className="bg-gray-50 rounded-lg p-2">
                    <span className="text-[10px] text-gray-400 block font-semibold">Survey ({j.survey_count})</span>
                    <span className="font-bold text-gray-800">
                      {j.survey_score !== null ? `${j.survey_score}%` : 'N/A'}
                    </span>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-2">
                    <span className="text-[10px] text-gray-400 block font-semibold">Outcome ({j.outcome_count})</span>
                    <span className="font-bold text-gray-800">
                      {j.outcome_score !== null ? `${j.outcome_score}%` : 'N/A'}
                    </span>
                  </div>
                </div>

                {/* Metrics Mini-Pills with Click-to-Drilldown */}
                <div className="space-y-1 pt-1">
                  <span className="text-[10px] font-bold text-gray-400 uppercase">Metrics ({j.metrics?.length || 0}):</span>
                  <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                    {j.metrics?.map(m => {
                      const isDisabled = m.is_disabled === true;
                      return (
                        <button
                          key={m.metric_id}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!isDisabled && onSelectMetric) onSelectMetric(m.metric_id);
                          }}
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border transition flex items-center space-x-1 ${
                            isDisabled ? 'bg-gray-100 text-gray-400 border-gray-200 opacity-60 cursor-not-allowed' :
                            m.status === 'CRITICAL' ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100' :
                            m.status === 'WARNING' ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100' :
                            'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                          }`}
                          title={
                            isDisabled 
                              ? `Metrik #${m.metric_id} (${m.metric_name}) dinonaktifkan di filter Direktorat (Bankwide External).`
                              : `Click to view survey details and questions for ${m.metric_name}`
                          }
                        >
                          <span className={`truncate max-w-[120px] ${isDisabled ? 'line-through' : ''}`}>#{m.metric_id} {m.metric_name}</span>
                          <span className="font-bold">{isDisabled ? '(Exempted)' : `(${m.normalized_score}%)`}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Footer Details */}
                <div 
                  onClick={() => onSelectJourney(j.journey_id)}
                  className="flex items-center justify-between text-xs pt-1 text-gray-500 cursor-pointer"
                >
                  <span>{j.metrics_count} Metrics</span>
                  <div className="flex items-center space-x-1 font-semibold text-[#ED1C24] group-hover:translate-x-0.5 transition">
                    <span>Explore Journey</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}
