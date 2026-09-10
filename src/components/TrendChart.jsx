// src/components/TrendChart.jsx
import React, { useState } from 'react';
import { 
  TrendingUp, 
  Calendar, 
  Sparkles, 
  Award, 
  BarChart2, 
  Layers,
  ArrowUpRight,
  Info
} from 'lucide-react';

export default function TrendChart({ 
  trendData = [], 
  selectedPeriod, 
  onSelectPeriod, 
  ytdPeIndex 
}) {
  const [hoveredMonth, setHoveredMonth] = useState(null);

  if (!trendData || trendData.length === 0) {
    return null;
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

  const getX = (index) => paddingLeft + (index * plotWidth) / (trendData.length - 1);
  const getY = (val) => {
    const clamped = Math.max(minVal, Math.min(maxVal, val));
    return paddingTop + (1 - (clamped - minVal) / (maxVal - minVal)) * plotHeight;
  };

  // Generate SVG path points
  const pePoints = trendData.map((d, i) => `${getX(i)},${getY(d.px_index !== undefined ? d.px_index : d.pe_index)}`).join(' ');
  const surveyPoints = trendData.map((d, i) => `${getX(i)},${getY(d.survey_index)}`).join(' ');
  const outcomePoints = trendData.map((d, i) => `${getX(i)},${getY(d.outcome_index)}`).join(' ');

  const activeHover = hoveredMonth !== null ? trendData[hoveredMonth] : null;

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
                People Experience (PX) Performance Trend 2026
              </h3>
              <span className="text-[10px] font-bold px-2 py-0.5 bg-red-100 text-[#ED1C24] rounded-full">
                Monthly & YTD
              </span>
            </div>
            <p className="text-xs text-gray-500">
              Progression of PX Index, Survey Index (70%), and Outcome Index (30%) across 2026 (Full 0% – 100% Scale)
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
          <div className="flex items-center space-x-1.5 border-l pl-3 border-gray-200">
            <span className="w-3 h-0.5 border-t-2 border-dashed border-[#780000]" />
            <span className="text-[#780000] font-bold">Target (85.0%)</span>
          </div>
        </div>
      </div>

      {/* SVG Chart Container */}
      <div className="relative overflow-x-auto">
        <div className="min-w-[700px]">
          <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-56 overflow-visible">
            {/* Grid Horizontal Lines (0%, 20%, 40%, 60%, 80%, 85% Target, 100%) */}
            {[0, 20, 40, 60, 80, 85, 100].map(val => {
              const yPos = getY(val);
              const isTarget = val === 85;
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
                    {isTarget ? '85%' : `${val}%`}
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

                  {/* PX Index Main Point (Red) */}
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
                    {d.month_name.slice(0, 3)}
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
              {activeHover ? `Period Detail (${activeHover.month_name} 2026):` : 'Active Period Summary:'}
            </span>
            <div className="font-extrabold text-[#231F20] text-sm">
              {activeHover 
                ? `${activeHover.month_name} 2026 (PX Index: ${activeHover.px_index || activeHover.pe_index}%)`
                : (selectedPeriod === 'YTD' ? `Year-to-Date 2026 (PX Index: ${ytdPeIndex || '-'}%)` : `Month ${selectedPeriod}`)}
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

