// src/components/TrendChart.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { fetchWithRetry } from '../utils/fetchWithRetry';
import {
  TrendingUp,
  Calendar,
  Sparkles,
  Award,
  BarChart2,
  Layers,
  ArrowUpRight,
  Info,
  Filter,
  RotateCcw
} from 'lucide-react';

import { MONTH_NAMES, monthName, monthShort } from '../utils/months';

// Mirrors calculationEngine.js's getLastCompleteMonth() so the range-picker dropdowns can
// populate instantly (no network round-trip) — the server is still the authority and clamps
// the actual query regardless, this is purely for a responsive UI.
function clientLastCompleteMonth(year) {
  const today = new Date();
  const y = parseInt(year, 10);
  if (y < today.getFullYear()) return 12;
  if (y > today.getFullYear()) return 0;
  return today.getMonth(); // 0-based getMonth() == 1-based number of the PREVIOUS month
}

export default function TrendChart({
  selectedPeriod,
  onSelectPeriod,
  ytdPeIndex,
  trendMode = 'YTD',
  directorate = 'ALL',
  subDirectorate = 'ALL',
  year
}) {
  const [hoveredMonth, setHoveredMonth] = useState(null);
  const [trendData, setTrendData] = useState([]);
  const [lastCompleteMonthByYear, setLastCompleteMonthByYear] = useState({}); // { '2025': '12', '2026': '08' }
  const [availableYears, setAvailableYears] = useState([]); // e.g. ['2025', '2026'], from the database
  const [pxTarget, setPxTarget] = useState(null); // PX Index target (%) — px_app_settings.px_index_target
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  // Period-range filter — start/end each carry their OWN year, so the range can genuinely
  // cross a year boundary (e.g. November 2025 to February 2026). null = not yet initialized
  // from the server's default range.
  const [rangeStartYear, setRangeStartYear] = useState(null);
  const [rangeStartMonth, setRangeStartMonth] = useState(null);
  const [rangeEndYear, setRangeEndYear] = useState(null);
  const [rangeEndMonth, setRangeEndMonth] = useState(null);

  const isMtd = trendMode === 'MTD';

  const fetchTrend = useCallback(async (range) => {
    setLoading(true);
    setErrorMsg('');
    try {
      const params = new URLSearchParams({
        mode: trendMode,
        directorate,
        sub_directorate: subDirectorate
      });
      if (year) params.set('year', year);
      if (range?.startYear) params.set('startYear', range.startYear);
      if (range?.startMonth) params.set('startMonth', range.startMonth);
      if (range?.endYear) params.set('endYear', range.endYear);
      if (range?.endMonth) params.set('endMonth', range.endMonth);

      const res = await fetchWithRetry(`/api/metrics/trends?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load trend data');
      const data = await res.json();

      setTrendData(data.trends || []);
      setAvailableYears(data.available_years || []);
      if (typeof data.px_index_target === 'number') setPxTarget(data.px_index_target);
      setLastCompleteMonthByYear(prev => ({ ...prev, [data.year]: data.last_complete_month }));

      // Initialize the range selectors to the server's default range on first load /
      // whenever mode-directorate-year context changes (but not while the user is actively
      // narrowing the range themselves — that's handled by explicit onChange calls instead).
      if (!range?.startYear) setRangeStartYear(data.year);
      if (!range?.startMonth) setRangeStartMonth('01');
      if (!range?.endYear) setRangeEndYear(data.year);
      if (!range?.endMonth) setRangeEndMonth(data.last_complete_month);
    } catch (err) {
      console.error('Failed to fetch trend data:', err);
      setErrorMsg('Failed to load trend data. Check the server connection and try again.');
      setTrendData([]);
    } finally {
      setLoading(false);
    }
  }, [trendMode, directorate, subDirectorate, year]);

  // Re-fetch the FULL default range whenever the Dashboard's mode/directorate/year context
  // changes (a genuinely new context resets any manual period-range narrowing).
  useEffect(() => {
    setRangeStartYear(null);
    setRangeStartMonth(null);
    setRangeEndYear(null);
    setRangeEndMonth(null);
    fetchTrend(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trendMode, directorate, subDirectorate, year]);

  const handleRangeChange = (next) => {
    const range = {
      startYear: next.startYear ?? rangeStartYear,
      startMonth: next.startMonth ?? rangeStartMonth,
      endYear: next.endYear ?? rangeEndYear,
      endMonth: next.endMonth ?? rangeEndMonth
    };
    setRangeStartYear(range.startYear);
    setRangeStartMonth(range.startMonth);
    setRangeEndYear(range.endYear);
    setRangeEndMonth(range.endMonth);
    fetchTrend(range);
  };

  const handleResetRange = () => {
    fetchTrend(null);
  };

  const isRangeNarrowed = trendData.length > 0 && (
    rangeStartYear !== trendData[0].year || rangeStartMonth !== trendData[0].month_code.slice(5) ||
    rangeEndYear !== trendData[trendData.length - 1].year || rangeEndMonth !== trendData[trendData.length - 1].month_code.slice(5)
  );

  // Whether the currently displayed series spans more than one calendar year — used to
  // disambiguate x-axis labels (e.g. "Jan'25" vs "Jan'26") when it does.
  const spansMultipleYears = new Set(trendData.map(t => t.year)).size > 1;

  if (loading && trendData.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-xs flex items-center justify-center min-h-[200px]">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#ED1C24]" />
      </div>
    );
  }

  if (!trendData || trendData.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-xs text-center text-xs text-gray-400">
        {errorMsg || 'No complete months are available to display for this period yet.'}
      </div>
    );
  }

  // Full percentage scale from 0% to 100% to ensure no metric line is ever cut off
  const minVal = 0;
  const maxVal = 100;
  const chartHeight = 220; // px
  const chartWidth = 760; // svg units
  const paddingTop = 20;
  const paddingBottom = 35;
  const paddingLeft = 45;
  const paddingRight = 20;
  const plotWidth = chartWidth - paddingLeft - paddingRight;
  const plotHeight = chartHeight - paddingTop - paddingBottom;

  const getX = (index) => trendData.length > 1
    ? paddingLeft + (index * plotWidth) / (trendData.length - 1)
    : paddingLeft + plotWidth / 2;
  const getY = (val) => {
    const clamped = Math.max(minVal, Math.min(maxVal, val));
    return paddingTop + (1 - (clamped - minVal) / (maxVal - minVal)) * plotHeight;
  };

  // Generate SVG path points
  const pePoints = trendData.map((d, i) => `${getX(i)},${getY(d.px_index !== undefined ? d.px_index : d.pe_index)}`).join(' ');
  const surveyPoints = trendData.map((d, i) => `${getX(i)},${getY(d.survey_index)}`).join(' ');
  const outcomePoints = trendData.map((d, i) => `${getX(i)},${getY(d.outcome_index)}`).join(' ');

  const activeHover = hoveredMonth !== null ? trendData[hoveredMonth] : null;

  const chartTitle = trendData.length === 0
    ? 'People Experience (PX) Performance Trend'
    : spansMultipleYears
      ? `People Experience (PX) Performance Trend ${trendData[0].year}–${trendData[trendData.length - 1].year}`
      : `People Experience (PX) Performance Trend ${trendData[0].year}`;

  return (
    <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-xs space-y-4">
      {/* Chart Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-100">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-red-50 text-[#ED1C24] flex items-center justify-center font-bold">
            <TrendingUp className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="text-base font-extrabold text-[#231F20]">
                {chartTitle}
              </h3>
              <span className="text-[10px] font-bold px-2 py-0.5 bg-red-100 text-[#ED1C24] rounded-full">
                {isMtd ? 'Monthly Movement (MTD)' : 'Cumulative YTD'}
              </span>
            </div>
            <p className="text-xs text-gray-500">
              {isMtd
                ? 'Standalone monthly score movement (MTD) — each point is purely the data of that month, with no accumulation from previous months'
                : 'Cumulative Year-to-Date progression — each point is the running average from January up to that month'} (PX Index 100%, Survey 70%, Outcome 30% — Scale 0% – 100%). Only fully completed months are shown.
            </p>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-4 text-xs font-semibold">
          <div className="flex items-center space-x-1.5">
            <span className="w-3 h-3 rounded-full bg-[#ED1C24]" />
            <span className="text-gray-900 font-bold">PX Index (100%)</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="w-3 h-3 rounded-full bg-[#16C0B7]" />
            <span className="text-[#0D9488] font-bold">Survey (70%)</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="w-3 h-3 rounded-full bg-[#2563EB]" />
            <span className="text-[#2563EB] font-bold">Outcome (30%)</span>
          </div>
          {pxTarget !== null && (
            <div className="flex items-center space-x-1.5 border-l pl-3 border-gray-200">
              <span className="w-3 h-0.5 border-t-2 border-dashed border-[#780000]" />
              <span className="text-[#780000] font-bold">Target ({pxTarget.toFixed(1)}%)</span>
            </div>
          )}
        </div>
      </div>

      {/* Period Range Filter — start and end each carry their own Year + Month, so the
          range can genuinely cross a year boundary (e.g. November 2025 to February 2026) */}
      <div className="flex flex-wrap items-center gap-2.5 p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs">
        <div className="flex items-center space-x-1.5 text-gray-500 font-bold shrink-0">
          <Filter className="w-3.5 h-3.5 text-[#ED1C24]" />
          <span>Period Range:</span>
        </div>

        {/* Start Year + Month */}
        <div className="flex items-center space-x-1">
          <select
            value={rangeStartYear || year}
            onChange={(e) => {
              const newStartYear = e.target.value;
              const maxMonth = clientLastCompleteMonth(newStartYear);
              const newStartMonth = Math.min(parseInt(rangeStartMonth || '1', 10), maxMonth || 12);
              handleRangeChange({ startYear: newStartYear, startMonth: String(newStartMonth).padStart(2, '0') });
            }}
            className="px-2 py-1.5 bg-white border border-gray-300 rounded-lg font-semibold focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            {(availableYears.length > 0 ? availableYears : [year]).map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <select
            value={rangeStartMonth || '01'}
            onChange={(e) => handleRangeChange({ startMonth: e.target.value })}
            className="px-2 py-1.5 bg-white border border-gray-300 rounded-lg font-semibold focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            {Array.from({ length: Math.max(clientLastCompleteMonth(rangeStartYear || year), 1) }, (_, i) => String(i + 1).padStart(2, '0')).map(m => (
              <option key={m} value={m}>{MONTH_NAMES[parseInt(m, 10) - 1]}</option>
            ))}
          </select>
        </div>

        <span className="text-gray-400 font-bold">to</span>

        {/* End Year + Month */}
        <div className="flex items-center space-x-1">
          <select
            value={rangeEndYear || year}
            onChange={(e) => {
              const newEndYear = e.target.value;
              const maxMonth = clientLastCompleteMonth(newEndYear) || 12;
              const newEndMonth = Math.min(parseInt(rangeEndMonth || String(maxMonth), 10), maxMonth);
              handleRangeChange({ endYear: newEndYear, endMonth: String(newEndMonth).padStart(2, '0') });
            }}
            className="px-2 py-1.5 bg-white border border-gray-300 rounded-lg font-semibold focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            {(availableYears.length > 0 ? availableYears : [year]).map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <select
            value={rangeEndMonth || ''}
            onChange={(e) => handleRangeChange({ endMonth: e.target.value })}
            className="px-2 py-1.5 bg-white border border-gray-300 rounded-lg font-semibold focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            {Array.from({ length: Math.max(clientLastCompleteMonth(rangeEndYear || year), 1) }, (_, i) => String(i + 1).padStart(2, '0')).map(m => (
              <option key={m} value={m}>{MONTH_NAMES[parseInt(m, 10) - 1]}</option>
            ))}
          </select>
        </div>

        {isRangeNarrowed && (
          <button
            onClick={handleResetRange}
            className="inline-flex items-center space-x-1 px-2.5 py-1.5 text-[#ED1C24] hover:bg-red-50 border border-red-200 rounded-lg font-bold transition"
            title="Restore the default range (start of year up to the last complete month before this month)"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset</span>
          </button>
        )}

        {loading && (
          <span className="text-gray-400 italic">Loading...</span>
        )}

        <span className="text-gray-400 ml-auto">
          Range can span years (e.g. Nov {year ? parseInt(year, 10) - 1 : ''} to Feb {year})
        </span>
      </div>

      {/* SVG Chart Container */}
      <div className="relative overflow-x-auto">
        <div className="min-w-[700px]">
          <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-56 overflow-visible">
            {/* Grid Horizontal Lines (0-100% every 20%, plus the PX Index target from the database) */}
            {Array.from(new Set([0, 20, 40, 60, 80, 100, ...(pxTarget !== null ? [pxTarget] : [])])).sort((a, b) => a - b).map(val => {
              const yPos = getY(val);
              const isTarget = pxTarget !== null && val === pxTarget;
              const isBase = val === 0;

              return (
                <g key={val}>
                  <line
                    x1={paddingLeft - 5}
                    y1={yPos}
                    x2={chartWidth - paddingRight}
                    y2={yPos}
                    stroke={isTarget ? '#780000' : (isBase ? '#D1D5DB' : '#F3F4F6')}
                    strokeDasharray={isTarget ? '4 4' : undefined}
                    strokeWidth={isTarget ? '1.5' : (isBase ? '1.2' : '1')}
                    opacity={isTarget ? 0.85 : 1}
                  />
                  <text
                    x={paddingLeft - 10}
                    y={yPos + 3.5}
                    fontSize="9.5"
                    fill={isTarget ? '#780000' : '#6B7280'}
                    fontWeight={isTarget ? 'bold' : '500'}
                    textAnchor="end"
                  >
                    {`${Number.isInteger(val) ? val : val.toFixed(1)}%`}
                  </text>
                </g>
              );
            })}

            {/* Outcome Trend Line (Royal Blue #2563EB - Highly Distinct) */}
            <polyline
              fill="none"
              stroke="#2563EB"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={outcomePoints}
            />

            {/* Survey Trend Line (Digital Teal #16C0B7) */}
            <polyline
              fill="none"
              stroke="#16C0B7"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={surveyPoints}
            />

            {/* PX Index Trend Line (Corporate Primary Red #ED1C24 Highlighted) */}
            <polyline
              fill="none"
              stroke="#ED1C24"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={pePoints}
            />

            {/* Monthly Data Points & Interactive Hover Circles */}
            {trendData.map((d, i) => {
              const cx = getX(i);
              const val = d.px_index !== undefined ? d.px_index : d.pe_index;
              const cy = getY(val);
              const isSelected = selectedPeriod === d.month_code;
              const isHovered = hoveredMonth === i;

              return (
                <g
                  key={d.month_code}
                  className="cursor-pointer transition-all"
                  onMouseEnter={() => setHoveredMonth(i)}
                  onMouseLeave={() => setHoveredMonth(null)}
                  onClick={() => onSelectPeriod && onSelectPeriod(d.month_code)}
                >
                  {/* Vertical Guide on Hover/Selected */}
                  {(isHovered || isSelected) && (
                    <line
                      x1={cx}
                      y1={paddingTop - 5}
                      x2={cx}
                      y2={chartHeight - paddingBottom + 5}
                      stroke="#9CA3AF"
                      strokeWidth="1.5"
                      strokeDasharray="2 2"
                      opacity="0.8"
                    />
                  )}

                  {/* Survey Point (Teal) */}
                  <circle
                    cx={cx}
                    cy={getY(d.survey_index)}
                    r="3.5"
                    fill="#16C0B7"
                    stroke="#FFFFFF"
                    strokeWidth="1.5"
                  />

                  {/* Outcome Point (Royal Blue) */}
                  <circle
                    cx={cx}
                    cy={getY(d.outcome_index)}
                    r="3.5"
                    fill="#2563EB"
                    stroke="#FFFFFF"
                    strokeWidth="1.5"
                  />

                  {/* PX Index Main Point (Red — pale if this complete month simply had zero
                      responses uploaded yet, still real data, just empty) */}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={isSelected ? 6.5 : (isHovered ? 6 : 4.5)}
                    fill={d.has_actual_data ? '#ED1C24' : '#FCA5A5'}
                    stroke="#FFFFFF"
                    strokeWidth="2"
                  />

                  {/* Month Label */}
                  <text
                    x={cx}
                    y={chartHeight - 12}
                    fontSize="10.5"
                    fontWeight={isSelected ? 'bold' : '600'}
                    fill={isSelected ? '#ED1C24' : '#4B5563'}
                    textAnchor="middle"
                  >
                    {spansMultipleYears ? `${monthShort(d.month_code.slice(5))} '${d.year.slice(2)}` : monthShort(d.month_code.slice(5))}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* Interactive Tooltip Card / Summary Box */}
      <div className="bg-gray-50 rounded-xl p-3.5 border border-gray-200/80 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center font-bold text-gray-700">
            <Calendar className="w-4 h-4 text-[#ED1C24]" />
          </div>
          <div>
            <span className="text-gray-500 font-medium">
              {activeHover ? `Period Detail (${monthName(activeHover.month_code.slice(5))} ${activeHover.year}):` : 'Active Period Summary:'}
            </span>
            <div className="font-extrabold text-[#231F20] text-sm">
              {activeHover
                ? `${monthName(activeHover.month_code.slice(5))} ${activeHover.year} (PX Index: ${activeHover.px_index || activeHover.pe_index}%)`
                : (selectedPeriod === 'YTD' ? `Year-to-Date ${year} (PX Index: ${ytdPeIndex || '-'}%)` : `Month ${selectedPeriod.includes('-') ? `${monthName(selectedPeriod.split('-')[1])} ${selectedPeriod.split('-')[0]}` : selectedPeriod}`)}
            </div>
          </div>
        </div>

        {/* Breakdown Values */}
        <div className="flex items-center space-x-4">
          <div className="text-center sm:text-right">
            <div className="text-[10px] text-gray-500 uppercase font-bold">Survey (70%)</div>
            <div className="font-black text-[#0D9488] text-sm">
              {activeHover ? `${activeHover.survey_index}%` : '-'}
            </div>
          </div>
          <div className="text-center sm:text-right border-l pl-3 border-gray-200">
            <div className="text-[10px] text-gray-500 uppercase font-bold">Outcome (30%)</div>
            <div className="font-black text-[#2563EB] text-sm">
              {activeHover ? `${activeHover.outcome_index}%` : '-'}
            </div>
          </div>
          <div className="text-center sm:text-right border-l pl-3 border-gray-200">
            <div className="text-[10px] text-gray-500 uppercase font-bold">Survey Responses</div>
            <div className="font-black text-gray-800 text-sm">
              {activeHover ? `${activeHover.response_count} responses` : '-'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
