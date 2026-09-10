// src/components/Calculator.jsx
import React, { useState, useRef, useEffect } from 'react';
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
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  MousePointerClick,
  Sparkles
} from 'lucide-react';

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

export default function Calculator({ 
  calculationData, 
  selectedJourneyFilter = 'ALL', 
  setSelectedJourneyFilter,
  onSelectMetric,
  onOpenSurveyImport,
  onOpenAdminSettings
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL'); // ALL, SURVEY, OUTCOME
  const [tableDensity, setTableDensity] = useState('fit'); // 'fit' (Fit to Screen) or 'wide' (Expanded)
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const tableContainerRef = useRef(null);

  if (!calculationData) return null;

  const { metrics, journeys, checkpoints, pe_index, survey_index, outcome_index, period } = calculationData;

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
      const matchSource = m.source_of_data?.toLowerCase().includes(q);
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
  const periodLabel = period === 'YTD' ? 'Year-to-Date 2026' : `Month ${period}`;

  return (
    <div className="space-y-5">
      
      {/* Top Banner: Metrics Performance & Pure Data Calculation */}
      <div className="bg-white rounded-2xl p-5 md:p-6 border border-gray-200 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-red-50 text-[#ED1C24] flex items-center justify-center font-bold">
              <Layers className="w-4 h-4" />
            </div>
            <h3 className="text-base font-extrabold text-[#231F20]">
              Explore 27 People Experience Metrics
            </h3>
            <span className="text-[10px] font-bold px-2 py-0.5 bg-red-100 text-[#ED1C24] rounded-full">
              Pure Survey & HR Calculation
            </span>
          </div>
          <p className="text-xs text-gray-500 max-w-2xl">
            Metric values are calculated directly from employee survey responses (1-5 scale, 1-10 scale, and percentages) and actual HR system data feeds. Click any metric row to view question details, itemized averages, and respondent response records.
          </p>
        </div>

        {/* Live Index Snapshot */}
        <div className="flex items-center space-x-3 bg-gray-50 px-4 py-3 rounded-xl border border-gray-200 shrink-0">
          <div className="text-right">
            <span className="text-[10px] uppercase font-bold text-gray-400 block">PX Index ({periodLabel})</span>
            <span className="text-2xl font-black text-[#FF0000]">{(calculationData.px_index ?? pe_index).toFixed(2)}%</span>
          </div>
          <div className="h-8 w-px bg-gray-200" />
          <div className="text-xs space-y-0.5">
            <div><span className="text-gray-400 font-medium">Survey (70%):</span> <strong className="text-[#16C0B7]">{survey_index.toFixed(2)}%</strong></div>
            <div><span className="text-gray-400 font-medium">Outcome (30%):</span> <strong className="text-[#F55755]">{outcome_index.toFixed(2)}%</strong></div>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-gray-200 shadow-2xs">
        
        {/* Search Box */}
        <div className="relative w-full lg:w-72">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search metric, PIC, data source..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#ED1C24]"
          />
        </div>

        {/* Journey Filters */}
        <div className="flex items-center space-x-1.5 overflow-x-auto py-1">
          <button
            onClick={() => setSelectedJourneyFilter('ALL')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition shrink-0 ${
              selectedJourneyFilter === 'ALL'
                ? 'bg-[#231F20] text-white shadow-2xs'
                : 'text-gray-600 hover:bg-gray-100'
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
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
              style={selectedJourneyFilter === j.journey_id.toString() ? { backgroundColor: j.color } : {}}
            >
              <span>{j.journey_name}</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                selectedJourneyFilter === j.journey_id.toString() ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-700'
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
              typeFilter === 'ALL' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            All Types
          </button>
          <button
            onClick={() => setTypeFilter('SURVEY')}
            className={`px-3 py-1.5 text-xs rounded-lg font-bold transition ${
              typeFilter === 'SURVEY' ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
            }`}
          >
            Survey (20)
          </button>
          <button
            onClick={() => setTypeFilter('OUTCOME')}
            className={`px-3 py-1.5 text-xs rounded-lg font-bold transition ${
              typeFilter === 'OUTCOME' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
            }`}
          >
            Outcome (7)
          </button>
        </div>

      </div>

      {/* Action Buttons Guide & Quick Scroll Control Bar */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 flex flex-col md:flex-row md:items-center justify-between gap-2.5 text-xs">
        
        {/* Left: Legend */}
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <div className="flex items-center space-x-1.5 text-slate-800 font-bold shrink-0 mr-1">
            <HelpCircle className="w-3.5 h-3.5 text-[#ED1C24]" />
            <span>Action Guide:</span>
          </div>
          <div className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold text-[10.5px]">
            <Download className="w-3 h-3 text-emerald-600 shrink-0" />
            <span><strong>Template:</strong> CSV Format</span>
          </div>
          <div className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-purple-50 text-purple-800 border border-purple-200 font-semibold text-[10.5px]">
            <FileText className="w-3 h-3 text-purple-600 shrink-0" />
            <span><strong>Evidence:</strong> Audit Trail</span>
          </div>
          <div className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-blue-50 text-blue-800 border border-blue-200 font-semibold text-[10.5px]">
            <FileSpreadsheet className="w-3 h-3 text-blue-600 shrink-0" />
            <span><strong>Upload:</strong> Import CSV</span>
          </div>
          <div className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-red-50 text-red-800 border border-red-200 font-semibold text-[10.5px]">
            <Eye className="w-3 h-3 text-[#ED1C24] shrink-0" />
            <span><strong>Detail:</strong> Metric Drilldown</span>
          </div>
        </div>

        {/* Right: Table View & Quick Scroll Controls */}
        <div className="flex items-center justify-between md:justify-end space-x-2 shrink-0 border-t md:border-t-0 pt-2 md:pt-0 border-slate-200">
          
          {/* Density Toggle */}
          <div className="inline-flex items-center bg-white border border-gray-200 rounded-lg p-0.5 text-[11px]">
            <button
              onClick={() => setTableDensity('fit')}
              className={`px-2 py-1 rounded-md font-bold transition flex items-center space-x-1 ${
                isFit ? 'bg-red-50 text-[#ED1C24] shadow-2xs' : 'text-gray-500 hover:text-gray-800'
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
          <div className="inline-flex items-center space-x-1 bg-white border border-gray-200 rounded-lg p-0.5">
            <button
              onClick={handleScrollLeft}
              disabled={!canScrollLeft}
              className={`p-1 rounded-md transition ${
                canScrollLeft 
                  ? 'text-gray-700 hover:bg-gray-100 hover:text-[#ED1C24]' 
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
                  ? 'text-gray-700 hover:bg-gray-100 hover:text-[#ED1C24]' 
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
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
        
        {/* Table scroll wrapper with scroll listeners */}
        <div 
          ref={tableContainerRef}
          onScroll={checkScrollState}
          className="overflow-x-auto relative max-h-[75vh] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 hover:scrollbar-thumb-gray-400"
        >
          <table className={`w-full text-left border-collapse ${isFit ? 'text-[11.5px]' : 'text-xs'}`}>
            
            {/* Sticky Table Header */}
            <thead className="sticky top-0 z-20 shadow-xs">
              <tr className="bg-gray-100 text-[10.5px] font-extrabold text-gray-700 uppercase tracking-wider border-b border-gray-200">
                <th className={`py-3 ${isFit ? 'px-2.5 w-10' : 'px-3.5 w-12'} text-center bg-gray-100`}>#</th>
                <th className={`py-3 ${isFit ? 'px-2.5 min-w-[210px] max-w-[270px]' : 'px-3.5 min-w-[260px]'} bg-gray-100`}>
                  Check Point & Metric
                </th>
                <th className={`py-3 ${isFit ? 'px-2.5 w-28' : 'px-3.5 w-36'} bg-gray-100`}>Type & PIC</th>
                <th className={`py-3 ${isFit ? 'px-2 text-center w-24' : 'px-3.5 text-center w-32'} bg-gray-100`}>Sample / Source</th>
                <th className={`py-3 ${isFit ? 'px-2 text-center w-24' : 'px-3.5 text-center w-28'} bg-gray-100`}>Date / Last Sync</th>
                <th className={`py-3 ${isFit ? 'px-2 text-right w-24' : 'px-3.5 text-right w-28'} bg-gray-100`}>Actual Value</th>
                <th className={`py-3 ${isFit ? 'px-2.5 min-w-[120px] w-32' : 'px-3.5 min-w-[150px]'} bg-gray-100`}>Index Score (Target)</th>
                <th className={`py-3 ${isFit ? 'px-2 text-center w-24' : 'px-3.5 text-center w-28'} bg-gray-100`}>Status</th>
                
                {/* STICKY RIGHT COLUMN HEADER (FREEZE COLUMN) */}
                <th className={`py-3 ${isFit ? 'px-3 w-[260px]' : 'px-3.5 w-[300px]'} text-right sticky right-0 bg-gray-100/95 backdrop-blur-xs z-30 shadow-[-8px_0_12px_-4px_rgba(0,0,0,0.12)] border-l border-gray-200`}>
                  <div className="flex items-center justify-end space-x-1.5">
                    <span>Actions & Evidence</span>
                    <span className="text-[9px] bg-red-100 text-[#ED1C24] px-1.5 py-0.2 rounded font-bold uppercase">
                      Fixed
                    </span>
                  </div>
                </th>
              </tr>
            </thead>

            {/* Table Body */}
            <tbody className="divide-y divide-gray-100 font-medium text-gray-700">
              {filteredMetrics.length === 0 ? (
                <tr>
                  <td colSpan="9" className="text-center py-12 text-gray-400 font-medium">
                    No metrics found matching the search and filter criteria.
                  </td>
                </tr>
              ) : (
                filteredMetrics.map((m) => {
                  const cp = checkpoints.find(c => c.checkpoint_id === m.checkpoint_id);
                  const j = journeys.find(jn => jn.journey_id === m.journey_id);
                  const isSurvey = m.metric_type === 'SURVEY';
                  const rawDate = m.last_survey_date || (isSurvey ? '2026-03-20' : '2026-03-24');
                  const displayDate = normalizeDateString(rawDate) || rawDate;

                  const isDisabled = m.is_disabled === true;

                  return (
                    <tr 
                      key={m.metric_id}
                      onClick={() => !isDisabled && onSelectMetric && onSelectMetric(m.metric_id)}
                      className={`transition ${
                        isDisabled 
                          ? 'bg-gray-100/80 text-gray-400 opacity-60 cursor-not-allowed select-none' 
                          : 'hover:bg-red-50/50 cursor-pointer group'
                      }`}
                      title={
                        isDisabled 
                          ? `Metrik #${m.metric_id} (${m.metric_name}) dinonaktifkan untuk perhitungan Direktorat karena merupakan metrik non-karyawan / bankwide eksternal.`
                          : `Click to view full drilldown for metric #${m.metric_id} (${m.metric_name})`
                      }
                    >
                      {/* ID */}
                      <td className={`py-3 ${isFit ? 'px-2.5' : 'px-3.5'} text-center font-bold ${isDisabled ? 'text-gray-400' : 'text-gray-400 group-hover:text-[#ED1C24]'}`}>
                        #{m.metric_id}
                      </td>

                      {/* Name & Checkpoint */}
                      <td className={`py-3 ${isFit ? 'px-2.5' : 'px-3.5'}`}>
                        <div className="flex items-center space-x-1 text-[9.5px] font-bold text-gray-400 uppercase tracking-tight">
                          <span 
                            className="w-2 h-2 rounded-full shrink-0" 
                            style={{ backgroundColor: isDisabled ? '#9CA3AF' : (j?.color || '#ED1C24') }} 
                          />
                          <span className="truncate max-w-[190px]">{j?.journey_name} • CP: {cp?.checkpoint_name}</span>
                        </div>
                        <div className={`font-extrabold ${isDisabled ? 'text-gray-500 line-through decoration-gray-400' : 'text-[#231F20] group-hover:text-[#ED1C24]'} transition ${isFit ? 'text-xs' : 'text-sm'} leading-snug mt-0.5 line-clamp-2`}>
                          {m.metric_name}
                        </div>
                        <div className="flex items-center gap-1 mt-0.5">
                          {isDisabled && (
                            <span className="inline-block px-1.5 py-0.2 rounded text-[9px] font-bold bg-gray-200 text-gray-600">
                              Bankwide Only (Non-Karyawan)
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
                          const isEss = isSurvey && (m.source_of_data || '').toUpperCase().includes('ESS');
                          return (
                            <span className={`inline-block px-1.5 py-0.5 rounded text-[9.5px] font-bold ${
                              isDisabled ? 'bg-gray-200 text-gray-600' :
                              isEss ? 'bg-purple-50 text-purple-800 border border-purple-200' :
                              isSurvey ? 'bg-amber-50 text-amber-800 border border-amber-200' : 
                              'bg-blue-50 text-blue-800 border border-blue-200'
                            }`}>
                              {isEss ? 'ESS SURVEY' : isSurvey ? 'SURVEY' : 'OUTCOME'}
                            </span>
                          );
                        })()}
                        <div className="text-[10.5px] font-bold text-gray-800 mt-0.5 truncate max-w-[110px]" title={m.experience_owner}>
                          {m.experience_owner}
                        </div>
                      </td>

                      {/* Sample Size for Survey vs Data HR Internal badge for Outcome */}
                      <td className={`py-3 ${isFit ? 'px-2' : 'px-3.5'} text-center`}>
                        {isDisabled ? (
                          <span className="text-[10px] font-mono text-gray-400">-</span>
                        ) : isSurvey ? (
                          <>
                            <div className="font-black text-gray-900 text-xs">
                              {m.sample_size || 0}
                            </div>
                            <span className="text-[9.5px] text-gray-400 block leading-tight">respondents</span>
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
                        ) : (
                          <>
                            <div className="text-xs font-black text-gray-900">
                              {m.scale_type === 'RATING_5' ? `${m.raw_value} / 5` : (m.metric_id === 11 ? `${m.raw_value} pax` : `${m.raw_value}%`)}
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
                        ) : (
                          <>
                            <div className="flex items-baseline justify-between mb-0.5">
                              <span className="font-black text-[#ED1C24] text-xs">
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
                      <td className={`py-2.5 ${isFit ? 'px-2.5' : 'px-3.5'} text-right whitespace-nowrap sticky right-0 ${isDisabled ? 'bg-gray-100/95' : 'bg-white group-hover:bg-red-50/80'} transition-colors z-10 shadow-[-8px_0_12px_-4px_rgba(0,0,0,0.1)] border-l border-gray-100`}>
                        <div className="flex items-center justify-end space-x-1">
                          {isDisabled ? (
                            <span className="text-[10px] font-semibold text-gray-400 italic px-2 py-1">
                              Exempted from Directorate
                            </span>
                          ) : isSurvey ? (
                            <>
                              {/* 1. Download Template */}
                              <a
                                href={`/api/surveys/template?metric_id=${m.metric_id}`}
                                download={`Template_Survey_Metric_${m.metric_id}.csv`}
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center space-x-1 px-2 py-1 text-[10.5px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 hover:text-emerald-900 border border-emerald-200 rounded-md transition shadow-2xs"
                                title={`Download CSV Template format with standard questions for ${m.metric_name}`}
                              >
                                <Download className="w-3 h-3 text-emerald-600 shrink-0" />
                                <span>Template</span>
                              </a>

                              {/* 2. Download Evidence */}
                              <a
                                href={`/api/surveys/evidence?metric_id=${m.metric_id}&period=${period || 'YTD'}`}
                                download={`Evidence_Survey_Metric_${m.metric_id}_${period || 'YTD'}.csv`}
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center space-x-1 px-2 py-1 text-[10.5px] font-bold text-purple-700 bg-purple-50 hover:bg-purple-100 hover:text-purple-900 border border-purple-200 rounded-md transition shadow-2xs"
                                title={`Download Survey Evidence and Respondent Records for ${m.metric_name}`}
                              >
                                <FileText className="w-3 h-3 text-purple-600 shrink-0" />
                                <span>Evidence</span>
                              </a>

                              {/* 3. Upload Survey CSV */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (onOpenSurveyImport) onOpenSurveyImport(m.metric_id);
                                }}
                                className="inline-flex items-center space-x-1 px-2 py-1 text-[10.5px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 hover:text-blue-900 border border-blue-200 rounded-md transition shadow-2xs"
                                title={`Import New CSV Survey Responses for ${m.metric_name}`}
                              >
                                <FileSpreadsheet className="w-3 h-3 text-blue-600 shrink-0" />
                                <span>Upload</span>
                              </button>

                              {/* 4. View Detail */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (onSelectMetric) onSelectMetric(m.metric_id);
                                }}
                                className="inline-flex items-center space-x-1 px-2 py-1 text-[10.5px] font-bold text-red-700 bg-red-50 hover:bg-red-100 hover:text-red-900 border border-red-200 rounded-md transition shadow-2xs"
                                title={`Drilldown details and analytics for ${m.metric_name}`}
                              >
                                <Eye className="w-3 h-3 text-[#ED1C24] shrink-0" />
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
                                className="inline-flex items-center space-x-1 px-2.5 py-1 text-[10.5px] font-bold text-gray-700 bg-gray-100 hover:bg-gray-200 hover:text-gray-900 border border-gray-200 rounded-md transition shadow-2xs"
                                title={`View Data & Specs for Outcome Metric #${m.metric_id}`}
                              >
                                <Database className="w-3 h-3 text-gray-600 shrink-0" />
                                <span>View Data</span>
                              </button>

                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (onOpenAdminSettings) onOpenAdminSettings();
                                }}
                                className="inline-flex items-center space-x-1 px-2 py-1 text-[10.5px] font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 hover:text-amber-900 border border-amber-200 rounded-md transition shadow-2xs"
                                title={`Configure Target and Threshold for ${m.metric_name}`}
                              >
                                <SlidersHorizontal className="w-3 h-3 text-amber-600 shrink-0" />
                                <span>Target</span>
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
        <div className="bg-gray-50/90 border-t border-gray-200 px-4 py-2.5 flex flex-col sm:flex-row items-center justify-between text-[11px] text-gray-500 gap-2">
          <div className="flex items-center space-x-1.5">
            <MousePointerClick className="w-3.5 h-3.5 text-[#ED1C24]" />
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
