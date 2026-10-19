// src/components/Calculator.jsx
import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../utils/AuthContext';
import { surveySourceLabel, surveySourceBadgeClass, surveyTemplateFileName } from '../utils/surveySource';
import { 
  Layers, 
  Search, 
  Filter, 
  Eye, 
  FileSpreadsheet, 
  Download,
  FileText,
  Calendar, 
  Users, 
  Database,
  CheckCircle2, 
  AlertCircle, 
  HelpCircle,
  ArrowRight,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  MousePointerClick,
  Sparkles
} from 'lucide-react';
import { formatMetricValue } from '../utils/formatMetricValue';
import { monthName } from '../utils/months';

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

// Real "today" as YYYY-MM-DD — last-resort fallback only, since the backend now always sends a
// real last_survey_date/last_data_date. Avoids ever displaying a frozen calendar literal.
function todayDateString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function Calculator({
  calculationData, 
  selectedJourneyFilter = 'ALL', 
  setSelectedJourneyFilter,
  onSelectMetric,
  onOpenSurveyImport
}) {
  const { isAdmin } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL'); // ALL, SURVEY, OUTCOME
  const [tableDensity, setTableDensity] = useState('fit'); // 'fit' (Fit to Screen) or 'wide' (Expanded)
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const tableContainerRef = useRef(null);

  if (!calculationData) return null;

  const { metrics, journeys, checkpoints, pe_index, survey_index, outcome_index, period, year } = calculationData;

  // v2.36.0: an index without any metric data in the period is null -> "—"
  const fmtPct = v => (v === null || v === undefined ? '—' : `${v.toFixed(2)}%`);

  // Filtered metrics
  const filteredMetrics = metrics.filter(m => {
    if (selectedJourneyFilter !== 'ALL' && m.journey_id !== parseInt(selectedJourneyFilter)) {
      return false;
    }
    if (typeFilter !== 'ALL' && m.metric_type !== typeFilter) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = m.metric_name.toLowerCase().includes(q);
      const matchOwner = m.experience_owner?.toLowerCase().includes(q);
      const matchSource = m.source_of_data?.toLowerCase().includes(q) || surveySourceLabel(m.survey_source).toLowerCase().includes(q);
      if (!matchName && !matchOwner && !matchSource) return false;
    }
    return true;
  });

  // Check scroll position to update scroll navigation buttons
  const checkScrollState = () => {
    const el = tableContainerRef.current;
    if (el) {
      const { scrollLeft, scrollWidth, clientWidth } = el;
      setCanScrollLeft(scrollLeft > 10);
      setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 10);
    }
  };

  useEffect(() => {
    checkScrollState();
    window.addEventListener('resize', checkScrollState);
    return () => window.removeEventListener('resize', checkScrollState);
  }, [filteredMetrics, tableDensity]);

  const handleScrollLeft = () => {
    if (tableContainerRef.current) {
      tableContainerRef.current.scrollBy({ left: -320, behavior: 'smooth' });
    }
  };

  const handleScrollRight = () => {
    if (tableContainerRef.current) {
      tableContainerRef.current.scrollBy({ left: 320, behavior: 'smooth' });
    }
  };

  const isFit = tableDensity === 'fit';
  const periodLabel = period === 'YTD' ? `Year-to-Date ${year}` : `Month ${/^\d{4}-\d{2}$/.test(String(period)) ? `${monthName(String(period).slice(5))} ${String(period).slice(0, 4)}` : period}`;

  return (
    <div className="space-y-5">
      
      {/* Top Banner: Metrics Performance & Pure Data Calculation */}
      <div className="bg-gradient-to-br from-[var(--theme-deep)] via-[var(--theme-strong)] to-[var(--theme-base)] rounded-2xl p-5 md:p-6 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-white/15 text-white flex items-center justify-center font-bold">
              <Layers className="w-4 h-4" />
            </div>
            <h3 className="text-base font-extrabold text-white">
              Explore {metrics.length} People Experience Metrics
            </h3>
            <span className="text-[10px] font-bold px-2 py-0.5 bg-white/90 text-[var(--theme-dark)] rounded-full">
              Pure Survey & HR Calculation
            </span>
          </div>
          <p className="text-xs text-red-100 max-w-2xl">
            Metric values are calculated directly from employee survey responses (1-5 scale, 1-10 scale, and percentages) and actual HR system data feeds. Click any metric row to view question details, itemized averages, and respondent response records.
          </p>
        </div>

        {/* Live Index Snapshot */}
        <div className="flex items-center space-x-3 bg-white/15 px-4 py-3 rounded-xl border border-white/20 shrink-0">
          <div className="text-right">
            <span className="text-[10px] uppercase font-bold text-red-100 block">PX Index ({periodLabel})</span>
            <span className="text-2xl font-black text-white">{fmtPct(calculationData.px_index !== undefined ? calculationData.px_index : pe_index)}</span>
          </div>
          <div className="h-8 w-px bg-white/20" />
          <div className="text-xs space-y-0.5">
            <div><span className="text-red-100 font-medium">Survey (70%):</span> <strong className="text-white">{fmtPct(survey_index)}</strong></div>
            <div><span className="text-red-100 font-medium">Outcome (30%):</span> <strong className="text-white">{fmtPct(outcome_index)}</strong></div>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 bg-gradient-to-br from-[var(--theme-deep)] to-[var(--theme-base)] p-3.5 rounded-xl shadow-2xs">

        {/* Search Box */}
        <div className="relative w-full lg:w-72">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search metric, PIC, data source..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-white/40 rounded-lg focus:outline-none focus:ring-1 focus:ring-white"
          />
        </div>

        {/* Journey Filters */}
        <div className="flex items-center space-x-1.5 overflow-x-auto py-1">
          <button
            onClick={() => setSelectedJourneyFilter('ALL')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition shrink-0 ${
              selectedJourneyFilter === 'ALL'
                ? 'bg-white text-[var(--theme-dark)] shadow-2xs'
                : 'text-red-50 hover:bg-white/15'
            }`}
          >
            All Journeys ({metrics.length})
          </button>

          {journeys.map(j => (
            <button
              key={j.journey_id}
              onClick={() => setSelectedJourneyFilter(j.journey_id.toString())}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition flex items-center space-x-1.5 shrink-0 ${
                selectedJourneyFilter === j.journey_id.toString()
                  ? 'text-white shadow-2xs'
                  : 'text-red-50 hover:bg-white/15'
              }`}
              style={selectedJourneyFilter === j.journey_id.toString() ? { backgroundColor: j.color } : {}}
            >
              <span>{j.journey_name}</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                selectedJourneyFilter === j.journey_id.toString() ? 'bg-white/20 text-white' : 'bg-black/20 text-red-50'
              }`}>
                {j.metrics_count}
              </span>
            </button>
          ))}
        </div>

        {/* Type Filter */}
        <div className="flex items-center space-x-1 shrink-0">
          <button
            onClick={() => setTypeFilter('ALL')}
            className={`px-3 py-1.5 text-xs rounded-lg font-bold transition ${
              typeFilter === 'ALL' ? 'bg-[#231F20] text-white' : 'bg-white/15 text-red-50 hover:bg-white/25'
            }`}
          >
            All Types
          </button>
          <button
            onClick={() => setTypeFilter('SURVEY')}
            className={`px-3 py-1.5 text-xs rounded-lg font-bold transition ${
              typeFilter === 'SURVEY' ? 'bg-blue-600 text-white' : 'bg-white/90 text-blue-700 hover:bg-white'
            }`}
          >
            Survey ({metrics.filter(m => m.metric_type === 'SURVEY').length})
          </button>
          <button
            onClick={() => setTypeFilter('OUTCOME')}
            className={`px-3 py-1.5 text-xs rounded-lg font-bold transition ${
              typeFilter === 'OUTCOME' ? 'bg-emerald-600 text-white' : 'bg-white/90 text-emerald-700 hover:bg-white'
            }`}
          >
            Outcome ({metrics.filter(m => m.metric_type !== 'SURVEY').length})
          </button>
        </div>

      </div>

      {/* Action Buttons Guide & Quick Scroll Control Bar */}
      <div className="bg-gradient-to-br from-[var(--theme-deep)] to-[var(--theme-base)] rounded-xl px-4 py-2.5 flex flex-col md:flex-row md:items-center justify-between gap-2.5 text-xs">

        {/* Left: Legend */}
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <div className="flex items-center space-x-1.5 text-white font-bold shrink-0 mr-1">
            <HelpCircle className="w-3.5 h-3.5 text-white" />
            <span>Action Guide:</span>
          </div>
          <div className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-white/90 text-slate-700 font-semibold text-[10.5px]">
            <Download className="w-3 h-3 text-slate-500 shrink-0" />
            <span><strong>Template:</strong> CSV Format (ESS: .xlsx summary)</span>
          </div>
          <div className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-white/90 text-slate-700 font-semibold text-[10.5px]">
            <FileText className="w-3 h-3 text-slate-500 shrink-0" />
            <span><strong>Evidence:</strong> Audit Trail</span>
          </div>
          <div className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-white/90 text-slate-700 font-semibold text-[10.5px]">
            <FileSpreadsheet className="w-3 h-3 text-slate-500 shrink-0" />
            <span><strong>Upload:</strong> Import CSV (ESS: .xlsx summary)</span>
          </div>
          <div className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-white/90 text-slate-700 font-semibold text-[10.5px]">
            <Eye className="w-3 h-3 text-slate-500 shrink-0" />
            <span><strong>Detail:</strong> Metric Drilldown</span>
          </div>
        </div>

        {/* Right: Table View & Quick Scroll Controls */}
        <div className="flex items-center justify-between md:justify-end space-x-2 shrink-0 border-t md:border-t-0 pt-2 md:pt-0 border-white/20">

          {/* Density Toggle */}
          <div className="inline-flex items-center bg-white/90 rounded-lg p-0.5 text-[11px]">
            <button
              onClick={() => setTableDensity('fit')}
              className={`px-2 py-1 rounded-md font-bold transition flex items-center space-x-1 ${
                isFit ? 'bg-[var(--theme-tint-50)] text-[var(--theme-base)] shadow-2xs' : 'text-gray-500 hover:text-gray-800'
              }`}
              title="Fit to Screen view (Optimized layout to eliminate horizontal scrolling)"
            >
              <Minimize2 className="w-3 h-3" />
              <span>Fit Screen</span>
            </button>
            <button
              onClick={() => setTableDensity('wide')}
              className={`px-2 py-1 rounded-md font-bold transition flex items-center space-x-1 ${
                !isFit ? 'bg-gray-800 text-white shadow-2xs' : 'text-gray-500 hover:text-gray-800'
              }`}
              title="Expanded Wide view"
            >
              <Maximize2 className="w-3 h-3" />
              <span>Wide</span>
            </button>
          </div>

          {/* Quick Scroll Left / Right Buttons */}
          <div className="inline-flex items-center space-x-1 bg-white/90 rounded-lg p-0.5">
            <button
              onClick={handleScrollLeft}
              disabled={!canScrollLeft}
              className={`p-1 rounded-md transition ${
                canScrollLeft
                  ? 'text-gray-700 hover:bg-gray-100 hover:text-[var(--theme-base)]'
                  : 'text-gray-300 cursor-not-allowed'
              }`}
              title="Scroll table to the left"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-[10px] font-bold text-gray-400 px-1 select-none">
              Scroll
            </span>
            <button
              onClick={handleScrollRight}
              disabled={!canScrollRight}
              className={`p-1 rounded-md transition ${
                canScrollRight
                  ? 'text-gray-700 hover:bg-gray-100 hover:text-[var(--theme-base)]'
                  : 'text-gray-300 cursor-not-allowed'
              }`}
              title="Scroll table to the right"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

        </div>

      </div>

      {/* 27 Metrics Table Container with Sticky Action Column */}
      <div className="bg-gradient-to-br from-[var(--theme-deep)] via-[var(--theme-mid)] to-[var(--theme-base)] rounded-2xl shadow-xs overflow-hidden p-1.5">

        {/* Table scroll wrapper with scroll listeners */}
        <div
          ref={tableContainerRef}
          onScroll={checkScrollState}
          className="overflow-x-auto relative max-h-[75vh] overflow-y-auto rounded-xl scrollbar-thin scrollbar-thumb-gray-300 hover:scrollbar-thumb-gray-400"
        >
          <table className={`w-full text-left border-collapse ${isFit ? 'text-[11.5px]' : 'text-xs'}`}>

            {/* Sticky Table Header */}
            <thead className="sticky top-0 z-20 shadow-xs">
              <tr className="bg-[var(--theme-deep)] text-[10.5px] font-extrabold text-white uppercase tracking-wider border-b border-white/10">
                <th className={`py-3 ${isFit ? 'px-2.5 w-10' : 'px-3.5 w-12'} text-center bg-[var(--theme-deep)]`}>ID</th>
                <th className={`py-3 ${isFit ? 'px-2.5 min-w-[210px] max-w-[270px]' : 'px-3.5 min-w-[260px]'} bg-[var(--theme-deep)]`}>
                  Check Point & Metric
                </th>
                <th className={`py-3 ${isFit ? 'px-2.5 w-28' : 'px-3.5 w-36'} bg-[var(--theme-deep)]`}>Type & PIC</th>
                <th className={`py-3 ${isFit ? 'px-2 text-center w-24' : 'px-3.5 text-center w-32'} bg-[var(--theme-deep)]`}>Total Respondents</th>
                <th className={`py-3 ${isFit ? 'px-2 text-center w-24' : 'px-3.5 text-center w-28'} bg-[var(--theme-deep)]`}>Date / Last Sync</th>
                <th className={`py-3 ${isFit ? 'px-2 text-right w-24' : 'px-3.5 text-right w-28'} bg-[var(--theme-deep)]`}>Actual Value</th>
                <th className={`py-3 ${isFit ? 'px-2.5 min-w-[120px] w-32' : 'px-3.5 min-w-[150px]'} bg-[var(--theme-deep)]`}>Index Score (Target)</th>
                <th className={`py-3 ${isFit ? 'px-2 text-center w-24' : 'px-3.5 text-center w-28'} bg-[var(--theme-deep)]`}>Status</th>

                {/* STICKY RIGHT COLUMN HEADER (FREEZE COLUMN) */}
                <th className={`py-3 ${isFit ? 'px-3 w-[260px]' : 'px-3.5 w-[300px]'} text-right sticky right-0 bg-[var(--theme-deep)] backdrop-blur-xs z-30 shadow-[-8px_0_12px_-4px_rgba(0,0,0,0.3)] border-l border-white/10`}>
                  <div className="flex items-center justify-end space-x-1.5">
                    <span>Actions & Evidence</span>
                    <span className="text-[9px] bg-white/90 text-[var(--theme-dark)] px-1.5 py-0.2 rounded font-bold uppercase">
                      Fixed
                    </span>
                  </div>
                </th>
              </tr>
            </thead>

            {/* Table Body */}
            <tbody className="divide-y divide-white/50 font-medium text-gray-700">
              {filteredMetrics.length === 0 ? (
                <tr>
                  <td colSpan="9" className="text-center py-12 bg-[var(--theme-tint-50)] text-gray-400 font-medium">
                    No metrics found matching the search and filter criteria.
                  </td>
                </tr>
              ) : (
                filteredMetrics.map((m) => {
                  const j = journeys.find(jn => jn.journey_id === m.journey_id);
                  const isSurvey = m.metric_type === 'SURVEY';
                  const rawDate = m.last_survey_date || todayDateString();
                  // ESS metrics (v2.32.0) show the period of the uploaded ESS summary, e.g. "November 2025"
                  const isEssRow = isSurvey && m.survey_source === 'ESS';
                  const isDisabled = m.is_disabled === true;
                  // v2.36.0: a survey metric without data in the selected period (no score, not in the index)
                  const isNoData = !isDisabled && m.status === 'NO_DATA';
                  const displayDate = isNoData ? '—' : ((isEssRow && m.ess_period_label) || normalizeDateString(rawDate) || rawDate);

                  return (
                    <tr
                      key={m.metric_id}
                      onClick={() => !isDisabled && onSelectMetric && onSelectMetric(m.metric_id)}
                      className={`transition ${
                        isDisabled
                          ? 'bg-gray-200/80 text-gray-400 opacity-60 cursor-not-allowed select-none'
                          : 'bg-gradient-to-r from-[var(--theme-row-start)] via-[var(--theme-row-mid)] to-[var(--theme-row-end)] hover:from-[var(--theme-row-start-h)] hover:via-[var(--theme-row-mid-h)] hover:to-[var(--theme-row-end-h)] cursor-pointer group'
                      }`}
                      title={
                        isDisabled
                          ? `Metric ${m.metric_id} (${m.metric_name}) is disabled for Directorate calculations because it is a non-employee / external bankwide metric.`
                          : `Click to view full drilldown for metric ${m.metric_id} (${m.metric_name})`
                      }
                    >
                      {/* ID */}
                      <td className={`py-3 ${isFit ? 'px-2.5' : 'px-3.5'} text-center font-bold ${isDisabled ? 'text-gray-400' : 'text-[var(--theme-deep)] group-hover:text-[var(--theme-base)]'}`}>
                        {m.metric_id}
                      </td>

                      {/* Name & Checkpoint */}
                      <td className={`py-3 ${isFit ? 'px-2.5' : 'px-3.5'}`}>
                        <div className={`flex items-center space-x-1 text-[10px] font-extrabold uppercase tracking-tight ${isDisabled ? 'text-gray-400' : 'text-[#231F20]'}`}>
                          <span 
                            className="w-2 h-2 rounded-full shrink-0 ring-1 ring-white/70" 
                            style={{ backgroundColor: isDisabled ? '#9CA3AF' : (j?.color || 'var(--theme-base)') }} 
                          />
                          <span className="truncate max-w-[190px]">{j?.journey_name}</span>
                        </div>
                        <div className={`font-extrabold ${isDisabled ? 'text-gray-500 line-through decoration-gray-400' : 'text-[#231F20] group-hover:text-[var(--theme-base)]'} transition ${isFit ? 'text-xs' : 'text-sm'} leading-snug mt-0.5 line-clamp-2`}>
                          {m.metric_name}
                        </div>
                        <div className="flex items-center gap-1 mt-0.5">
                          {isDisabled && (
                            <span className="inline-block px-1.5 py-0.2 rounded text-[9px] font-bold bg-gray-200 text-gray-600">
                              Bankwide Only (Non-Employee)
                            </span>
                          )}
                          {isSurvey && m.survey_source && (
                            <span
                              className={`inline-block px-1.5 py-0.2 rounded text-[9px] font-bold shrink-0 ${isDisabled ? 'bg-gray-200 text-gray-600' : surveySourceBadgeClass(m.survey_source)}`}
                              title={m.survey_source === 'ESS' ? 'Employee Sentiment Survey - uploaded manually from the ESS template' : 'Data from another system or form'}
                            >
                              {surveySourceLabel(m.survey_source)}
                            </span>
                          )}
                          <div className="text-[10px] text-gray-500 truncate max-w-[200px]">
                            Source: <span className="font-medium text-gray-700">{m.source_of_data}</span>
                          </div>
                        </div>
                      </td>

                      {/* Type & Owner */}
                      <td className={`py-3 ${isFit ? 'px-2.5' : 'px-3.5'}`}>
                        {(() => {
                          return (
                            <span className={`inline-block px-1.5 py-0.5 rounded text-[9.5px] font-bold ${
                              isDisabled ? 'bg-gray-200 text-gray-600' :
                              isSurvey ? 'bg-amber-50 text-amber-800 border border-amber-200' : 
                              'bg-blue-50 text-blue-800 border border-blue-200'
                            }`}>
                              {isSurvey ? 'SURVEY' : 'OUTCOME'}
                            </span>
                          );
                        })()}
                        <div className="text-[10.5px] font-bold text-gray-800 mt-0.5 truncate max-w-[110px]" title={m.experience_owner}>
                          {m.experience_owner}
                        </div>
                      </td>

                      {/* Total respondents for Survey vs Data HR Internal badge for Outcome */}
                      <td className={`py-3 ${isFit ? 'px-2' : 'px-3.5'} text-center`}>
                        {isDisabled ? (
                          <span className="text-[10px] font-mono text-gray-400">-</span>
                        ) : isSurvey ? (
                          <>
                            <div className="font-black text-gray-900 text-xs">
                              {m.sample_size || 0}
                            </div>
                            <span className="text-[9.5px] text-gray-500 block leading-tight">{isEssRow ? 'participants' : 'respondents'}</span>
                          </>
                        ) : (
                          <div className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-bold text-[9.5px] border border-blue-100">
                            <Database className="w-2.5 h-2.5 text-blue-500 shrink-0" />
                            <span>HR System</span>
                          </div>
                        )}
                      </td>

                      {/* Last Survey / Ingestion Date (Actual Date for both Survey and Outcome) */}
                      <td className={`py-3 ${isFit ? 'px-2' : 'px-3.5'} text-center whitespace-nowrap`}>
                        <span className="text-[10px] font-medium text-gray-700 bg-gray-50 px-1.5 py-0.5 rounded border border-gray-200" title={`Last data entry date: ${displayDate}`}>
                          {displayDate}
                        </span>
                      </td>

                      {/* Actual Raw Value */}
                      <td className={`py-3 ${isFit ? 'px-2' : 'px-3.5'} text-right whitespace-nowrap`}>
                        {isDisabled ? (
                          <span className="text-xs font-bold text-gray-400">N/A</span>
                        ) : isNoData ? (
                          <>
                            <div className="text-xs font-black text-gray-400">—</div>
                            <span className="text-[9.5px] text-gray-400 block leading-tight">Tgt: {m.target_display}</span>
                          </>
                        ) : (
                          <>
                            <div className="text-xs font-black text-gray-900">
                              {formatMetricValue(m.raw_value, m.unit, m.scale_type)}
                            </div>
                            <span className="text-[9.5px] text-gray-400 block leading-tight">Tgt: {m.target_display}</span>
                          </>
                        )}
                      </td>

                      {/* Normalized Score & Progress Bar */}
                      <td className={`py-3 ${isFit ? 'px-2.5' : 'px-3.5'}`}>
                        {isDisabled ? (
                          <div className="text-center py-1 text-[10px] font-bold text-gray-400 bg-gray-200/60 rounded">
                            Exempted (0%)
                          </div>
                        ) : isNoData ? (
                          <div className="text-center py-1 text-[10px] font-bold text-gray-400 bg-gray-100 rounded" title="No survey data in the selected period">
                            —
                          </div>
                        ) : (
                          <>
                            <div className="flex items-baseline justify-between mb-0.5">
                              <span className="font-black text-[var(--theme-base)] text-xs">
                                {m.normalized_score}%
                              </span>
                              <span className="text-[9.5px] text-gray-400 font-semibold">
                                Min: {m.min_threshold}%
                              </span>
                            </div>
                            <div className="w-full bg-gray-200 h-1.5 rounded-full overflow-hidden">
                              <div 
                                className={`h-full rounded-full transition-all duration-500 ${
                                  m.status === 'CRITICAL' ? 'bg-red-500' :
                                  m.status === 'WARNING' ? 'bg-amber-500' :
                                  'bg-emerald-500'
                                }`}
                                style={{ width: `${Math.min(100, m.normalized_score)}%` }}
                              />
                            </div>
                          </>
                        )}
                      </td>

                      {/* Status */}
                      <td className={`py-3 ${isFit ? 'px-2' : 'px-3.5'} text-center`}>
                        {isDisabled ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold bg-gray-200 text-gray-500">
                            Exempted
                          </span>
                        ) : isNoData ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold bg-gray-200 text-gray-500" title="No survey data in the selected period - left out of the index">
                            No Data
                          </span>
                        ) : (
                          <span className={`inline-flex items-center space-x-0.5 px-2 py-0.5 rounded-full text-[9.5px] font-bold ${
                            m.status === 'CRITICAL' ? 'bg-red-100 text-red-700' :
                            m.status === 'WARNING' ? 'bg-amber-100 text-amber-700' :
                            'bg-emerald-100 text-emerald-700'
                          }`}>
                            {m.status === 'CRITICAL' ? <AlertCircle className="w-2.5 h-2.5 mr-0.5" /> : <CheckCircle2 className="w-2.5 h-2.5 mr-0.5" />}
                            <span>{m.status === 'CRITICAL' ? 'Critical' : (m.status === 'WARNING' ? 'Warning' : 'On Target')}</span>
                          </span>
                        )}
                      </td>

                      {/* STICKY RIGHT COLUMN: ACTION BUTTONS (ALWAYS VISIBLE) */}
                      <td className={`py-2.5 ${isFit ? 'px-2.5' : 'px-3.5'} text-right whitespace-nowrap sticky right-0 ${isDisabled ? 'bg-gray-200/95' : 'bg-[var(--theme-row-end)] group-hover:bg-[var(--theme-row-end-h)]'} transition-colors z-10 shadow-[-8px_0_12px_-4px_rgba(0,0,0,0.15)] border-l border-red-200/50`}>
                        <div className="flex items-center justify-end space-x-1">
                          {isDisabled ? (
                            <span className="text-[10px] font-semibold text-gray-400 italic px-2 py-1">
                              Exempted from Directorate
                            </span>
                          ) : isSurvey ? (
                            <>
                              {(isAdmin || m.can_upload) && (<>
                              {/* 1. Download Template (Admin, or the PIC of this metric - m.can_upload comes from the server) */}
                              <a
                                href={`/api/surveys/template?metric_id=${m.metric_id}`}
                                download={surveyTemplateFileName(m.metric_id, isEssRow)}
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center space-x-1 px-2 py-1 text-[10.5px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 hover:text-slate-900 border border-slate-200 rounded-md transition shadow-2xs"
                                title={isEssRow ? `Download the ESS summary template (.xlsx) for ${m.metric_name}` : `Download CSV Template format with standard questions for ${m.metric_name}`}
                              >
                                <Download className="w-3 h-3 text-slate-500 shrink-0" />
                                <span>{isEssRow ? 'Template (.xlsx)' : 'Template'}</span>
                              </a>

                              {/* 2. Download Evidence */}
                              <a
                                href={`/api/surveys/evidence?metric_id=${m.metric_id}&period=${period || 'YTD'}`}
                                download={`Evidence_Survey_Metric_${m.metric_id}_${period || 'YTD'}.csv`}
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center space-x-1 px-2 py-1 text-[10.5px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 hover:text-slate-900 border border-slate-200 rounded-md transition shadow-2xs"
                                title={`Download Survey Evidence and Respondent Records for ${m.metric_name}`}
                              >
                                <FileText className="w-3 h-3 text-slate-500 shrink-0" />
                                <span>Evidence</span>
                              </a>

                              {/* 3. Upload Survey CSV */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (onOpenSurveyImport) onOpenSurveyImport(m.metric_id);
                                }}
                                className="inline-flex items-center space-x-1 px-2 py-1 text-[10.5px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 hover:text-slate-900 border border-slate-200 rounded-md transition shadow-2xs"
                                title={isEssRow ? `Upload the ESS summary (.xlsx) for ${m.metric_name}` : `Import New CSV Survey Responses for ${m.metric_name}`}
                              >
                                <FileSpreadsheet className="w-3 h-3 text-slate-500 shrink-0" />
                                <span>Upload</span>
                              </button>

                              </>)}

                              {/* 4. View Detail */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (onSelectMetric) onSelectMetric(m.metric_id);
                                }}
                                className="inline-flex items-center space-x-1 px-2 py-1 text-[10.5px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 hover:text-slate-900 border border-slate-200 rounded-md transition shadow-2xs"
                                title={`Drilldown details and analytics for ${m.metric_name}`}
                              >
                                <Eye className="w-3 h-3 text-slate-500 shrink-0" />
                                <span>Detail</span>
                              </button>
                            </>
                          ) : (
                            <>
                              {/* Outcome Metric Actions */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (onSelectMetric) onSelectMetric(m.metric_id);
                                }}
                                className="inline-flex items-center space-x-1 px-2.5 py-1 text-[10.5px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 hover:text-slate-900 border border-slate-200 rounded-md transition shadow-2xs"
                                title={`View Data & Specs for Outcome Metric ${m.metric_id}`}
                              >
                                <Database className="w-3 h-3 text-slate-500 shrink-0" />
                                <span>View Data</span>
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Bottom Table Footer Bar with Status and Quick Info */}
        <div className="bg-pink-50/90 rounded-b-xl px-4 py-2.5 flex flex-col sm:flex-row items-center justify-between text-[11px] text-gray-500 gap-2">
          <div className="flex items-center space-x-1.5">
            <MousePointerClick className="w-3.5 h-3.5 text-[var(--theme-base)]" />
            <span>
              Displaying <strong>{filteredMetrics.length}</strong> of {metrics.length} People Experience metrics. Click any row to view full details.
            </span>
          </div>
          <div className="flex items-center space-x-3 text-[10.5px]">
            <span className="flex items-center space-x-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
              <span>On Target (&ge; 75%)</span>
            </span>
            <span className="flex items-center space-x-1">
              <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
              <span>Warning</span>
            </span>
            <span className="flex items-center space-x-1">
              <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
              <span>Critical (&lt; 75%)</span>
            </span>
          </div>
        </div>

      </div>

    </div>
  );
}
