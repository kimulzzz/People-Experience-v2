// src/components/MetricDetailModal.jsx
import React, { useState, useEffect } from 'react';
import { 
  X, 
  Layers, 
  Users, 
  Calendar, 
  HelpCircle, 
  Star, 
  Award, 
  TrendingUp, 
  AlertCircle, 
  CheckCircle2, 
  Search, 
  Download, 
  Filter,
  MessageSquare,
  Building2,
  FileSpreadsheet,
  FileText,
  Mail,
  UserCheck,
  Database,
  Server,
  SlidersHorizontal,
  Check,
  Clock,
  ShieldCheck,
  Sparkles,
  Table,
  LayoutGrid
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

// Real "today" as YYYY-MM-DD — last-resort fallback only, since the backend now always sends a
// real last_survey_date/last_data_date. Avoids ever displaying a frozen calendar literal.
function todayDateString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function MetricDetailModal({
  isOpen, 
  onClose, 
  metricId, 
  period = 'YTD',
  onOpenSurveyUpload,
  onOpenSurveyQuestionSettings
}) {
  const [detailData, setDetailData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDirectorate, setSelectedDirectorate] = useState('ALL');
  const [activeTab, setActiveTab] = useState('primary'); // 'primary' | 'secondary'
  const [selectedRespondent, setSelectedRespondent] = useState(null);
  const [essViewMode, setEssViewMode] = useState('table'); // 'table' | 'cards'

  useEffect(() => {
    if (isOpen && metricId) {
      fetchDetail();
    }
  }, [isOpen, metricId, period]);

  const fetchDetail = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/metrics/${metricId}/detail?period=${period}`);
      if (res.ok) {
        const data = await res.json();
        setDetailData(data);
        setActiveTab('primary');
      }
    } catch (err) {
      console.error('Error fetching metric detail:', err);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  const isSurvey = detailData?.metric_type === 'SURVEY';
  const isOutcome = !isSurvey;
  const isEss = detailData?.is_ess || (detailData?.source_of_data || '').toUpperCase().includes('ESS');

  const isCampus = detailData?.metric_id === 2 || detailData?.target_audience === 'CAMPUS_STUDENTS';
  const isCandidate = detailData?.metric_id === 5 || detailData?.target_audience === 'JOB_APPLICANTS';
  const isNonEmployee = isCampus || isCandidate || detailData?.is_employee_metric === false;

  const responses = detailData?.responses || [];
  const directorates = ['ALL', ...new Set(responses.map(r => r.directorate).filter(Boolean))];

  const filteredResponses = responses.filter(r => {
    if (selectedDirectorate !== 'ALL' && r.directorate && r.directorate !== selectedDirectorate) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchNip = (r.nip || r.participant_id || r.candidate_id)?.toLowerCase().includes(q);
      const matchName = (r.employee_name || r.participant_name || r.candidate_name)?.toLowerCase().includes(q);
      const matchEmail = (r.cimb_email || r.email)?.toLowerCase().includes(q);
      const matchOrg = (r.university || r.applied_position || r.major || r.recruitment_channel || r.directorate || r.division)?.toLowerCase().includes(q);
      const matchVerbatim = r.verbatim_feedback?.toLowerCase().includes(q);
      const matchDate = r.survey_date?.toLowerCase().includes(q);
      return matchNip || matchName || matchEmail || matchOrg || matchVerbatim || matchDate;
    }
    return true;
  });

  const operationalRecords = detailData?.operational_records || [];
  const filteredOperationalRecords = operationalRecords.filter(rec => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return JSON.stringify(rec).toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        
        {/* Header Modal */}
        <div className="p-5 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className={`p-2.5 rounded-xl ${isSurvey ? 'bg-red-100/80 text-[#ED1C24]' : 'bg-blue-100/80 text-blue-700'}`}>
              {isSurvey ? <Layers className="w-6 h-6" /> : <Database className="w-6 h-6" />}
            </div>
            <div>
              <div className="flex items-center space-x-2 flex-wrap gap-1">
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-gray-200/80 text-gray-700">
                  Metric {detailData?.metric_id || metricId}
                </span>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-red-50 text-[#ED1C24] border border-red-200/60">
                  {detailData?.journey_name || 'People Experience (PX)'}
                </span>
                <span className="text-[11px] font-semibold text-gray-500">
                  {detailData?.checkpoint_name}
                </span>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md border ${
                  isSurvey 
                    ? 'bg-amber-50 text-amber-800 border-amber-200/60' 
                    : 'bg-blue-50 text-blue-800 border-blue-200/60'
                }`}>
                  {isSurvey ? (isEss ? 'Type: ESS (Employee Sentiment Survey)' : 'Type: Employee Survey') : 'Type: Outcome (Internal HR Data)'}
                </span>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-gray-100 text-gray-700 border border-gray-200">
                  Period: {period === 'YTD' ? 'Year-to-Date 2026' : period}
                </span>
              </div>
              <h2 className="text-xl font-black text-gray-900 mt-1">
                {detailData?.metric_name || 'Metric Details'}
              </h2>
            </div>
          </div>

          <button 
            onClick={onClose}
            className="p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {isLoading ? (
            <div className="py-20 text-center space-y-3">
              <div className="w-8 h-8 border-3 border-[#ED1C24] border-t-transparent rounded-full animate-spin mx-auto" />
              <div className="text-xs text-gray-500 font-medium">Loading metric details and internal data records...</div>
            </div>
          ) : !detailData ? (
            <div className="py-12 text-center text-gray-500 text-sm">
              Metric data not found.
            </div>
          ) : (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                
                {/* CARD 1: ACTUAL VALUE & TARGET */}
                <div className="p-3.5 bg-gray-50 border border-gray-200 rounded-xl">
                  <div className="text-[11px] font-bold text-gray-500 uppercase">Actual Value & Target</div>
                  <div className="flex items-baseline space-x-2 mt-1">
                    <span className="text-2xl font-black text-gray-900">
                      {detailData.scale_type === 'RATING_5' 
                        ? `${detailData.current_raw_value} / 5` 
                        : (detailData.metric_id === 11 ? `${detailData.current_raw_value} pax` : `${detailData.current_raw_value}%`)}
                    </span>
                    <span className="text-xs font-semibold text-gray-500">
                      ({detailData.target_display})
                    </span>
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">
                    Calculated Index Score: <strong className="text-[#ED1C24]">{detailData.normalized_score}%</strong>
                  </div>
                </div>

                {/* CARD 2: THRESHOLD STATUS */}
                <div className="p-3.5 bg-gray-50 border border-gray-200 rounded-xl">
                  <div className="text-[11px] font-bold text-gray-500 uppercase">Threshold Status</div>
                  <div className="mt-1 flex items-center space-x-1.5">
                    <span className={`inline-flex items-center text-xs font-bold px-2.5 py-1 rounded-full ${
                      detailData.status === 'CRITICAL' ? 'bg-red-100 text-red-800' :
                      detailData.status === 'WARNING' ? 'bg-amber-100 text-amber-800' :
                      'bg-emerald-100 text-emerald-800'
                    }`}>
                      {detailData.status === 'CRITICAL' ? <AlertCircle className="w-3.5 h-3.5 mr-1" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
                      <span>{detailData.status === 'CRITICAL' ? 'Critical Deficit' : (detailData.status === 'WARNING' ? 'Warning Zone' : 'On Target')}</span>
                    </span>
                  </div>
                  <div className="text-[10px] text-gray-500 mt-1">
                    Minimum Threshold: <strong>{detailData.min_threshold}%</strong>
                  </div>
                </div>

                {/* CARD 3 & 4: FOR SURVEY vs FOR OUTCOME */}
                {isSurvey ? (
                  <>
                    {/* Survey: Total Respondents */}
                    <div className="p-3.5 bg-gray-50 border border-gray-200 rounded-xl">
                      <div className="text-[11px] font-bold text-gray-500 uppercase">Total Respondents</div>
                      <div className="text-2xl font-black text-gray-900 mt-1">
                        {detailData.total_respondents ?? 0} <span className="text-xs font-normal text-gray-500">respondents</span>
                      </div>
                      <div className="text-[10px] text-gray-500 mt-0.5 flex items-center space-x-1">
                        <Calendar className="w-3 h-3 text-[#ED1C24]" />
                        <span>Latest Survey Date: <strong>{normalizeDateString(detailData.last_survey_date) || todayDateString()}</strong></span>
                      </div>
                    </div>

                    {/* Survey: Quick Actions */}
                    <div className="p-3.5 bg-gray-50 border border-gray-200 rounded-xl">
                      <div className="text-[11px] font-bold text-gray-500 uppercase flex items-center justify-between">
                        <span>Survey Data Operations</span>
                      </div>
                      <div className="mt-2 flex flex-col sm:flex-row gap-1.5">
                        <a
                          href={`/api/surveys/template?metric_id=${detailData.metric_id}`}
                          download={`Template_Survey_Metric_${detailData.metric_id}.csv`}
                          className="flex-1 py-1.5 px-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-bold flex flex-col items-center justify-center space-y-0.5 transition shadow-xs text-center group"
                          title="Download CSV Template with standard question format"
                        >
                          <div className="flex items-center space-x-1">
                            <Download className="w-3.5 h-3.5" />
                            <span>Template</span>
                          </div>
                          <span className="text-[9px] font-normal text-emerald-100">Standard CSV</span>
                        </a>
                        <a
                          href={`/api/surveys/evidence?metric_id=${detailData.metric_id}&period=${period || 'YTD'}`}
                          download={`Evidence_Survey_Metric_${detailData.metric_id}_${period || 'YTD'}.csv`}
                          className="flex-1 py-1.5 px-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-[11px] font-bold flex flex-col items-center justify-center space-y-0.5 transition shadow-xs text-center group"
                          title="Download survey respondent records for audit validation"
                        >
                          <div className="flex items-center space-x-1">
                            <FileText className="w-3.5 h-3.5" />
                            <span>Evidence</span>
                          </div>
                          <span className="text-[9px] font-normal text-purple-100">Audit Trail</span>
                        </a>
                        <button
                          onClick={() => {
                            onClose();
                            if (onOpenSurveyUpload) onOpenSurveyUpload(detailData.metric_id);
                          }}
                          className="flex-1 py-1.5 px-2 bg-[#ED1C24] hover:bg-[#D91B23] text-white rounded-lg text-[11px] font-bold flex flex-col items-center justify-center space-y-0.5 transition shadow-xs text-center group"
                          title="Upload new CSV survey responses"
                        >
                          <div className="flex items-center space-x-1">
                            <FileSpreadsheet className="w-3.5 h-3.5" />
                            <span>Upload</span>
                          </div>
                          <span className="text-[9px] font-normal text-red-100">Import CSV</span>
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Outcome: Source HR System */}
                    <div className="p-3.5 bg-gray-50 border border-gray-200 rounded-xl">
                      <div className="text-[11px] font-bold text-gray-500 uppercase flex items-center space-x-1">
                        <Server className="w-3.5 h-3.5 text-blue-600" />
                        <span>Source HR System</span>
                      </div>
                      <div className="text-base font-black text-gray-900 mt-1 truncate" title={detailData.source_of_data}>
                        {detailData.source_of_data || 'HRIS / Workday'}
                      </div>
                      <div className="text-[10px] text-gray-500 mt-0.5 flex items-center space-x-1">
                        <ShieldCheck className="w-3 h-3 text-emerald-600" />
                        <span>CIMB Internal System Ingestion</span>
                      </div>
                    </div>

                    {/* Outcome: Experience Owner */}
                    <div className="p-3.5 bg-gray-50 border border-gray-200 rounded-xl">
                      <div className="text-[11px] font-bold text-gray-500 uppercase flex items-center space-x-1">
                        <Building2 className="w-3.5 h-3.5 text-indigo-600" />
                        <span>Experience Owner</span>
                      </div>
                      <div className="text-base font-black text-gray-900 mt-1 truncate" title={detailData.experience_owner}>
                        {detailData.experience_owner || 'Human Resources'}
                      </div>
                      <div className="text-[10px] text-gray-500 mt-0.5">
                        Metric Weight: <strong>30% Outcome Index</strong>
                      </div>
                    </div>
                  </>
                )}

              </div>

              {/* DEDICATED ESS SENTIMENT DIMENSION CARD (For ESS Metrics) */}
              {isEss && detailData.ess_summary && (
                <div className="bg-gradient-to-r from-[#1A1819] via-[#231F20] to-[#2D2A2B] text-white rounded-xl p-5 border border-gray-700 shadow-lg space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full bg-red-500/30 text-red-300 border border-red-500/40">
                          ESS Dimension Summary
                        </span>
                        <span className="text-xs text-gray-300 font-medium">Employee Sentiment Survey (CIMB)</span>
                      </div>
                      <h3 className="text-lg font-black text-white mt-1 flex items-center space-x-2">
                        <span>{detailData.ess_summary.dimension_name}</span>
                        <span className="text-xs font-normal text-gray-400">({detailData.ess_summary.questions_count} Associated Questions)</span>
                      </h3>
                    </div>

                    <div className="flex items-center space-x-4 bg-white/10 backdrop-blur-md px-4 py-2 rounded-xl border border-white/15">
                      <div>
                        <div className="text-[10px] text-gray-300 font-bold uppercase tracking-wider">Overall Favorable</div>
                        <div className="text-2xl font-black text-emerald-400">
                          {detailData.ess_summary.summary_score}%
                        </div>
                      </div>
                      <div className="flex flex-col space-y-1 text-[11px] font-bold border-l border-white/20 pl-3">
                        <span className="text-emerald-400 flex items-center space-x-1">
                          <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                          <span>{detailData.ess_summary.percent_favorable}% Favorable</span>
                        </span>
                        <span className="text-amber-300 flex items-center space-x-1">
                          <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
                          <span>{detailData.ess_summary.percent_neutral}% Neutral</span>
                        </span>
                        <span className="text-rose-400 flex items-center space-x-1">
                          <span className="w-2 h-2 rounded-full bg-rose-500 inline-block" />
                          <span>{detailData.ess_summary.percent_unfavorable}% Unfavorable</span>
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Stacked Sentiment Bar */}
                  <div className="space-y-1.5 pt-1">
                    <div className="w-full h-3.5 bg-black/50 rounded-full overflow-hidden flex shadow-inner">
                      <div 
                        style={{ width: `${detailData.ess_summary.percent_favorable}%` }} 
                        className="bg-emerald-500 h-full transition-all duration-500"
                        title={`Favorable: ${detailData.ess_summary.percent_favorable}%`}
                      />
                      <div 
                        style={{ width: `${detailData.ess_summary.percent_neutral}%` }} 
                        className="bg-amber-400 h-full transition-all duration-500"
                        title={`Neutral: ${detailData.ess_summary.percent_neutral}%`}
                      />
                      <div 
                        style={{ width: `${detailData.ess_summary.percent_unfavorable}%` }} 
                        className="bg-rose-500 h-full transition-all duration-500"
                        title={`Unfavorable: ${detailData.ess_summary.percent_unfavorable}%`}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-gray-300 font-medium">
                      <span>✓ Favorable (Satisfied / Positive): {detailData.ess_summary.percent_favorable}%</span>
                      <span>— Neutral: {detailData.ess_summary.percent_neutral}%</span>
                      <span>✕ Unfavorable (Dissatisfied): {detailData.ess_summary.percent_unfavorable}%</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-gray-400 italic pt-1 border-t border-white/10">
                    {detailData.ess_summary.description}
                  </p>
                </div>
              )}

              {/* Navigation Sub-Menu Tabs */}
              <div className="flex border-b border-gray-200">
                {isSurvey ? (
                  <>
                    <button
                      onClick={() => setActiveTab('primary')}
                      className={`pb-2.5 px-4 text-xs font-bold transition flex items-center space-x-2 border-b-2 ${
                        activeTab === 'primary'
                          ? 'border-[#ED1C24] text-[#ED1C24]'
                          : 'border-transparent text-gray-500 hover:text-gray-800'
                      }`}
                    >
                      <HelpCircle className="w-4 h-4" />
                      <span>Question Breakdown & Average Scores ({detailData.questions_breakdown?.length || 0})</span>
                    </button>
                    <button
                      onClick={() => setActiveTab('secondary')}
                      className={`pb-2.5 px-4 text-xs font-bold transition flex items-center space-x-2 border-b-2 ${
                        activeTab === 'secondary'
                          ? 'border-[#ED1C24] text-[#ED1C24]'
                          : 'border-transparent text-gray-500 hover:text-gray-800'
                      }`}
                    >
                      <Users className="w-4 h-4" />
                      <span>Respondent Records & Answers ({detailData.responses?.length || 0})</span>
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => setActiveTab('primary')}
                      className={`pb-2.5 px-4 text-xs font-bold transition flex items-center space-x-2 border-b-2 ${
                        activeTab === 'primary'
                          ? 'border-blue-600 text-blue-600'
                          : 'border-transparent text-gray-500 hover:text-gray-800'
                      }`}
                    >
                      <SlidersHorizontal className="w-4 h-4" />
                      <span>HR Measurement Specifications & Targets</span>
                    </button>
                    <button
                      onClick={() => setActiveTab('secondary')}
                      className={`pb-2.5 px-4 text-xs font-bold transition flex items-center space-x-2 border-b-2 ${
                        activeTab === 'secondary'
                          ? 'border-blue-600 text-blue-600'
                          : 'border-transparent text-gray-500 hover:text-gray-800'
                      }`}
                    >
                      <Database className="w-4 h-4" />
                      <span>Internal Transaction Records ({operationalRecords.length})</span>
                    </button>
                  </>
                )}
              </div>

              {/* TAB 1 FOR SURVEY: QUESTIONS & AVERAGE BREAKDOWN */}
              {isSurvey && activeTab === 'primary' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="text-xs text-gray-500">
                      {isEss 
                        ? 'Spreadsheet of % Favorable, Neutral, and Unfavorable sentiment for each ESS question item:'
                        : 'Detailed respondent average scores for each survey question in this metric:'}
                    </div>

                    <div className="flex items-center space-x-2">
                      {/* ESS View Mode Switcher */}
                      {isEss && (
                        <div className="flex items-center bg-gray-100 p-0.5 rounded-lg border border-gray-200">
                          <button
                            onClick={() => setEssViewMode('table')}
                            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-xs font-bold transition ${
                              essViewMode === 'table'
                                ? 'bg-purple-700 text-white shadow-2xs'
                                : 'text-gray-600 hover:text-gray-900'
                            }`}
                            title="Excel Spreadsheet View"
                          >
                            <Table className="w-3.5 h-3.5" />
                            <span>Spreadsheet View</span>
                          </button>
                          <button
                            onClick={() => setEssViewMode('cards')}
                            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-xs font-bold transition ${
                              essViewMode === 'cards'
                                ? 'bg-[#ED1C24] text-white shadow-2xs'
                                : 'text-gray-600 hover:text-gray-900'
                            }`}
                            title="Visual Card Breakdown"
                          >
                            <LayoutGrid className="w-3.5 h-3.5" />
                            <span>Card View</span>
                          </button>
                        </div>
                      )}

                      {onOpenSurveyQuestionSettings && (
                        <button
                          onClick={() => onOpenSurveyQuestionSettings(detailData.metric_id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1 bg-red-50 hover:bg-red-100 text-[#ED1C24] rounded-lg text-xs font-bold border border-red-200 transition shadow-2xs"
                          title="Configure survey questions and scale types in the Admin menu"
                        >
                          <FileSpreadsheet className="w-3.5 h-3.5" />
                          <span>Manage Questions (Admin)</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* SPREADSHEET TABLE VIEW (EXACT USER EXCEL CAPTURE FORMAT) */}
                  {isEss && essViewMode === 'table' ? (
                    <div className="border border-purple-200/80 rounded-xl overflow-hidden shadow-xs bg-white">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            {/* Top Level Purple Header (Matching Excel Capture) */}
                            <tr className="bg-[#563175] text-white font-black text-xs uppercase tracking-wider">
                              <th colSpan={4} className="py-2.5 px-3 border-r border-purple-400/30">
                                Scored question
                              </th>
                              <th className="py-2.5 px-2 text-center border-r border-purple-400/30 w-28 bg-[#663A8B]">
                                % Favorable
                              </th>
                              <th className="py-2.5 px-2 text-center border-r border-purple-400/30 w-24 bg-[#663A8B]">
                                % Neutral
                              </th>
                              <th className="py-2.5 px-2 text-center w-24 bg-[#663A8B]">
                                % Unfavorable
                              </th>
                            </tr>
                            {/* Sub Header Columns */}
                            <tr className="bg-[#482862] text-purple-100 text-[11px] font-bold border-t border-purple-400/20">
                              <th className="py-2 px-3 w-48 border-r border-purple-400/20">Dimension</th>
                              <th className="py-2 px-3 border-r border-purple-400/20">Question</th>
                              <th className="py-2 px-3 w-36 border-r border-purple-400/20">Question is visible based on</th>
                              <th className="py-2 px-3 w-36 border-r border-purple-400/20">Question is required based on</th>
                              <th className="py-2 px-2 text-center border-r border-purple-400/20 text-purple-200">Fav %</th>
                              <th className="py-2 px-2 text-center border-r border-purple-400/20 text-purple-200">Neut %</th>
                              <th className="py-2 px-2 text-center text-purple-200">Unfav %</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200 bg-white">
                            {/* Grouped by Dimension */}
                            {(() => {
                              const essMap = {};
                              (detailData.questions_breakdown || []).forEach(q => {
                                const dim = q.dimension || detailData.ess_summary?.dimension_name || 'ESS Survey Dimension';
                                if (!essMap[dim]) essMap[dim] = [];
                                essMap[dim].push(q);
                              });

                              return Object.keys(essMap).map((dimName, gIdx) => {
                                const qs = essMap[dimName];
                                const scorable = qs.filter(q => q.type !== 'FREE_TEXT');
                                const totalFav = Math.round(scorable.reduce((s, q) => s + (q.percent_favorable ?? q.normalized_score ?? 88), 0) / (scorable.length || 1));
                                const totalNeut = Math.round(scorable.reduce((s, q) => s + (q.percent_neutral ?? 10), 0) / (scorable.length || 1));
                                const totalUnfav = Math.round(scorable.reduce((s, q) => s + (q.percent_unfavorable ?? 2), 0) / (scorable.length || 1));

                                return (
                                  <React.Fragment key={gIdx}>
                                    {/* Dimension Total Summary Row (Bold like Excel) */}
                                    <tr className="bg-gray-100/95 font-black text-gray-900 border-t-2 border-gray-300">
                                      <td className="py-2 px-3 font-black text-gray-900" colSpan={4}>
                                        {dimName} Total
                                      </td>
                                      <td className="py-2 px-2 text-center font-black text-emerald-800 bg-emerald-50/70 border-r border-gray-200">
                                        {totalFav}
                                      </td>
                                      <td className="py-2 px-2 text-center font-black text-amber-800 bg-amber-50/70 border-r border-gray-200">
                                        {totalNeut}
                                      </td>
                                      <td className="py-2 px-2 text-center font-black text-rose-800 bg-rose-50/70">
                                        {totalUnfav}
                                      </td>
                                    </tr>

                                    {/* Individual Question Rows */}
                                    {qs.map((q, qIdx) => (
                                      <tr key={q.key || qIdx} className="hover:bg-purple-50/30 transition-colors">
                                        <td className="py-2.5 px-3 text-gray-700 font-medium align-top border-r border-gray-200/60">
                                          {q.dimension || dimName}
                                        </td>
                                        <td className="py-2.5 px-3 text-gray-900 font-semibold align-top border-r border-gray-200/60">
                                          <div className="flex items-start gap-1.5">
                                            <span className="text-[10px] font-bold text-gray-400 shrink-0 mt-0.5">Q{qIdx + 1}.</span>
                                            <span className="text-xs">{q.text || q.label}</span>
                                          </div>
                                        </td>
                                        <td className="py-2.5 px-3 text-gray-500 text-[11px] align-top border-r border-gray-200/60">
                                          {q.visible_based_on || 'Always'}
                                        </td>
                                        <td className="py-2.5 px-3 text-gray-500 text-[11px] align-top border-r border-gray-200/60">
                                          {q.required_based_on || (q.mandatory ? 'Always' : 'Optional')}
                                        </td>
                                        <td className="py-2.5 px-2 text-center font-bold text-emerald-600 align-top border-r border-gray-200/60">
                                          {q.percent_favorable !== null && q.percent_favorable !== undefined ? q.percent_favorable : q.normalized_score}
                                        </td>
                                        <td className="py-2.5 px-2 text-center font-medium text-amber-600 align-top border-r border-gray-200/60">
                                          {q.percent_neutral !== null && q.percent_neutral !== undefined ? q.percent_neutral : 8}
                                        </td>
                                        <td className="py-2.5 px-2 text-center font-medium text-rose-600 align-top">
                                          {q.percent_unfavorable !== null && q.percent_unfavorable !== undefined ? q.percent_unfavorable : 1}
                                        </td>
                                      </tr>
                                    ))}
                                  </React.Fragment>
                                );
                              });
                            })()}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    /* CARDS VIEW */
                    <div className="grid grid-cols-1 gap-3">
                      {detailData.questions_breakdown?.map((q, idx) => {
                        const qType = q.type || 'SCALE_1_5';
                        const hasEssBreakdown = q.percent_favorable !== undefined && q.percent_favorable !== null;

                        if (qType === 'FREE_TEXT') {
                          return (
                            <div 
                              key={q.key || idx} 
                              className="p-4 bg-gray-50 rounded-xl border border-gray-200/80 hover:border-gray-300 transition space-y-2.5"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex items-start space-x-2.5">
                                  <span className="w-6 h-6 rounded-md bg-purple-600 text-white flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                                    Q{idx + 1}
                                  </span>
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <h4 className="font-bold text-sm text-gray-900 leading-snug">
                                        {q.label}
                                      </h4>
                                      <span className="text-[10px] font-bold px-2 py-0.5 bg-purple-100 text-purple-800 rounded-full">
                                        Free Text / Qualitative
                                      </span>
                                    </div>
                                    <p className="text-xs text-gray-600 mt-0.5">
                                      {q.text}
                                    </p>
                                  </div>
                                </div>

                                <div className="text-right shrink-0">
                                  <span className="text-xs font-bold px-2.5 py-1 bg-purple-50 text-purple-700 border border-purple-200 rounded-lg">
                                    {q.response_count || 0} Qualitative Responses
                                  </span>
                                </div>
                              </div>

                              {q.verbatim_samples && q.verbatim_samples.length > 0 && (
                                <div className="pt-2 border-t border-gray-200 space-y-1.5">
                                  <div className="text-[10px] font-bold text-gray-500 uppercase">Sample Employee Comments:</div>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {q.verbatim_samples.map((samp, sIdx) => (
                                      <div key={sIdx} className="p-2 bg-white rounded-lg border border-gray-200 text-[11px] text-gray-700 italic">
                                        "{samp.text}"
                                        <div className="text-[9px] text-gray-400 not-italic mt-1 font-semibold">
                                          — {samp.employee_name} ({samp.division})
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        }

                        if (qType === 'YES_NO') {
                          const pct = q.percent_yes || q.normalized_score || 0;
                          const isHigh = pct >= 80;
                          const isWarning = pct >= 70 && pct < 80;

                          return (
                            <div 
                              key={q.key || idx} 
                              className="p-4 bg-gray-50 rounded-xl border border-gray-200/80 hover:border-gray-300 transition space-y-2.5"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex items-start space-x-2.5">
                                  <span className="w-6 h-6 rounded-md bg-blue-600 text-white flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                                    Q{idx + 1}
                                  </span>
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <h4 className="font-bold text-sm text-gray-900 leading-snug">
                                        {q.label}
                                      </h4>
                                      <span className="text-[10px] font-bold px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full">
                                        Yes / No (100 / 0)
                                      </span>
                                    </div>
                                    <p className="text-xs text-gray-600 mt-0.5">
                                      {q.text}
                                    </p>
                                  </div>
                                </div>

                                <div className="text-right shrink-0">
                                  <div className="text-base font-black text-gray-900">
                                    {pct}% Yes
                                  </div>
                                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                    isHigh ? 'bg-emerald-100 text-emerald-800' :
                                    isWarning ? 'bg-amber-100 text-amber-800' :
                                    'bg-red-100 text-red-800'
                                  }`}>
                                    {pct}% Index Score
                                  </span>
                                </div>
                              </div>

                              {/* Progress Bar & Breakdown Counts */}
                              <div className="space-y-1">
                                <div className="w-full bg-gray-200 h-2 rounded-full overflow-hidden">
                                  <div 
                                    className={`h-full rounded-full transition-all duration-500 ${
                                      isHigh ? 'bg-emerald-500' :
                                      isWarning ? 'bg-amber-500' :
                                      'bg-red-500'
                                    }`}
                                    style={{ width: `${Math.min(100, pct)}%` }}
                                  />
                                </div>
                                <div className="flex justify-between text-[10px] text-gray-500 font-medium">
                                  <span className="text-emerald-700 font-bold">✓ Yes: {q.yes_count || 0} respondents</span>
                                  <span>Target: 80%</span>
                                  <span className="text-red-700 font-bold">✕ No: {q.no_count || 0} respondents</span>
                                </div>
                              </div>
                            </div>
                          );
                        }

                        // Numeric Scale: SCALE_1_5 or SCALE_1_10
                        const isScale10 = qType === 'SCALE_1_10';
                        const maxScore = isScale10 ? 10.0 : 5.0;
                        const scoreFormatted = `${(q.avg_score || 0).toFixed(2)} / ${maxScore.toFixed(1)}`;
                        const isHigh = q.normalized_score >= 80;
                        const isWarning = q.normalized_score >= 75 && q.normalized_score < 80;

                        return (
                          <div 
                            key={q.key || idx} 
                            className="p-4 bg-gray-50 rounded-xl border border-gray-200/80 hover:border-gray-300 transition space-y-2.5"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start space-x-2.5">
                                <span className="w-6 h-6 rounded-md bg-[#ED1C24] text-white flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                                  Q{idx + 1}
                                </span>
                                <div>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <h4 className="font-bold text-sm text-gray-900 leading-snug">
                                      {q.label}
                                    </h4>
                                    <span className="text-[10px] font-bold px-2 py-0.5 bg-gray-200 text-gray-800 rounded-full">
                                      {isScale10 ? 'Scale 1 - 10' : 'Scale 1 - 5'}
                                    </span>
                                    {q.dimension && (
                                      <span className="text-[10px] font-semibold px-2 py-0.5 bg-red-50 text-[#ED1C24] border border-red-200 rounded-full">
                                        {q.dimension}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs text-gray-600 mt-0.5">
                                    {q.text}
                                  </p>
                                </div>
                              </div>

                              <div className="text-right shrink-0">
                                <div className="text-base font-black text-gray-900">
                                  {hasEssBreakdown ? `${q.percent_favorable}% Favorable` : scoreFormatted}
                                </div>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                  isHigh ? 'bg-emerald-100 text-emerald-800' :
                                  isWarning ? 'bg-amber-100 text-amber-800' :
                                  'bg-red-100 text-red-800'
                                }`}>
                                  {q.normalized_score}% Index
                                </span>
                              </div>
                            </div>

                            {/* Progress Bar Visualization */}
                            {hasEssBreakdown ? (
                              /* Segmented Sentiment Bar (Favorable / Neutral / Unfavorable) */
                              <div className="space-y-1">
                                <div className="w-full h-2.5 bg-gray-200 rounded-full overflow-hidden flex">
                                  <div 
                                    style={{ width: `${q.percent_favorable}%` }} 
                                    className="bg-emerald-500 h-full transition-all duration-500"
                                    title={`Favorable: ${q.percent_favorable}%`}
                                  />
                                  <div 
                                    style={{ width: `${q.percent_neutral}%` }} 
                                    className="bg-amber-400 h-full transition-all duration-500"
                                    title={`Neutral: ${q.percent_neutral}%`}
                                  />
                                  <div 
                                    style={{ width: `${q.percent_unfavorable}%` }} 
                                    className="bg-rose-500 h-full transition-all duration-500"
                                    title={`Unfavorable: ${q.percent_unfavorable}%`}
                                  />
                                </div>
                                <div className="flex justify-between text-[10px] font-medium">
                                  <span className="text-emerald-700">● {q.percent_favorable}% Favorable</span>
                                  <span className="text-amber-700">● {q.percent_neutral}% Neutral</span>
                                  <span className="text-rose-700">● {q.percent_unfavorable}% Unfavorable</span>
                                </div>
                              </div>
                            ) : (
                              /* Standard Single Progress Bar */
                              <div className="space-y-1">
                                <div className="w-full bg-gray-200 h-2 rounded-full overflow-hidden">
                                  <div 
                                    className={`h-full rounded-full transition-all duration-500 ${
                                      isHigh ? 'bg-emerald-500' :
                                      isWarning ? 'bg-amber-500' :
                                      'bg-red-500'
                                    }`}
                                    style={{ width: `${Math.min(100, q.normalized_score)}%` }}
                                  />
                                </div>
                                <div className="flex justify-between text-[10px] text-gray-400">
                                  <span>0%</span>
                                  <span>Target: 80%</span>
                                  <span>100%</span>
                                </div>
                              </div>
                            )}

                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2 FOR SURVEY: LIST OF RESPONDENTS & SURVEY ANSWERS */}
              {isSurvey && activeTab === 'secondary' && (
                <div className="space-y-4">
                  {/* Search, Filter & Download Evidence Toolbar */}
                  <div className="flex flex-col md:flex-row items-center justify-between gap-3 bg-gray-50 p-3 rounded-xl border border-gray-200">
                    <div className="flex items-center space-x-2.5 w-full md:w-auto flex-1">
                      <div className="relative w-full sm:w-72">
                        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
                        <input
                          type="text"
                          placeholder="Search NIP, name, feedback, date..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#ED1C24]"
                        />
                      </div>

                      <div className="flex items-center space-x-1.5 shrink-0">
                        <Filter className="w-3.5 h-3.5 text-gray-500" />
                        <select
                          value={selectedDirectorate}
                          onChange={(e) => setSelectedDirectorate(e.target.value)}
                          className="text-xs bg-white border border-gray-300 rounded-lg px-2.5 py-1.5 font-medium text-gray-700 focus:outline-none"
                        >
                          {directorates.map(d => (
                            <option key={d} value={d}>
                              {d === 'ALL' ? 'All Directorates' : d}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Download Evidence Button */}
                    <div className="flex items-center space-x-2 shrink-0 w-full md:w-auto justify-end">
                      <a
                        href={`/api/surveys/evidence?metric_id=${detailData.metric_id}&period=${period || 'YTD'}`}
                        download={`Evidence_Survey_Metric_${detailData.metric_id}_${period || 'YTD'}.csv`}
                        className="px-3.5 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-lg text-xs font-bold flex items-center space-x-2 transition shadow-xs whitespace-nowrap"
                        title="Download all survey responses and records for audit trail evidence"
                      >
                        <Download className="w-4 h-4" />
                        <span>Download Evidence ({filteredResponses.length} Records)</span>
                      </a>
                    </div>
                  </div>

                  {/* List of Respondents & Survey Answers Table */}
                  <div className="border border-gray-200 rounded-xl overflow-x-auto shadow-2xs">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-gray-100 text-gray-700 font-bold uppercase tracking-wider border-b border-gray-200">
                        <tr>
                          <th className="py-3 px-3.5 whitespace-nowrap">Survey Date</th>
                          <th className="py-3 px-3.5">
                            {isCampus ? 'Participant (Student ID)' : isCandidate ? 'Candidate (Applicant ID)' : 'Respondent (NIP)'}
                          </th>
                          <th className="py-3 px-3.5">
                            {isCampus ? 'University / Major' : isCandidate ? 'Position / Channel' : 'Unit / Division'}
                          </th>
                          <th className="py-3 px-3.5">Answers per Question</th>
                          <th className="py-3 px-3.5 text-center whitespace-nowrap">Average</th>
                          <th className="py-3 px-3.5">Verbatim Feedback</th>
                          <th className="py-3 px-3.5 text-center">Source</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 font-normal bg-white">
                        {filteredResponses.length === 0 ? (
                          <tr>
                            <td colSpan="7" className="text-center py-10 text-gray-400 font-medium">
                              {isEss 
                                ? 'ESS data represents annual aggregated sentiment scores from thousands of CIMB employees.' 
                                : 'No survey responses match the search and filter criteria.'}
                            </td>
                          </tr>
                        ) : (
                          filteredResponses.map((r, idx) => {
                            const rawDate = r.survey_date || r.created_at;
                            const surveyDate = normalizeDateString(rawDate) || '-';
                            const isScale5 = detailData.scale_type === 'RATING_5';

                            const displayName = isCampus ? (r.participant_name || r.employee_name) : isCandidate ? (r.candidate_name || r.employee_name) : r.employee_name;
                            const displayId = isCampus ? (r.participant_id || r.nip) : isCandidate ? (r.candidate_id || r.nip) : r.nip;
                            const displayEmail = r.email || r.cimb_email;
                            const displayOrg1 = isCampus ? (r.university || '-') : isCandidate ? (r.applied_position || '-') : (r.directorate || 'General');
                            const displayOrg2 = isCampus ? (r.major || '-') : isCandidate ? (r.recruitment_channel || '-') : (r.division || 'CIMB Niaga');

                            return (
                              <tr 
                                key={r.response_id || idx} 
                                onClick={() => setSelectedRespondent(r)}
                                className="hover:bg-red-50/40 transition cursor-pointer group"
                              >
                                <td className="py-3 px-3.5 whitespace-nowrap">
                                  <div className="flex items-center space-x-1.5 font-bold text-gray-800">
                                    <Calendar className="w-3.5 h-3.5 text-[#ED1C24]" />
                                    <span>{surveyDate}</span>
                                  </div>
                                </td>
                                <td className="py-3 px-3.5">
                                  <div className="font-bold text-gray-900">{displayName}</div>
                                  <div className="flex items-center space-x-1.5 text-[10px] text-gray-500 mt-0.5 font-mono">
                                    <span>{displayId}</span>
                                    <span>•</span>
                                    <span className="truncate max-w-[130px]">{displayEmail}</span>
                                  </div>
                                </td>
                                <td className="py-3 px-3.5">
                                  <div className="font-medium text-gray-900">{displayOrg1}</div>
                                  <div className="text-[10px] text-gray-500">{displayOrg2}</div>
                                </td>
                                <td className="py-3 px-3.5">
                                  <div className="flex flex-wrap gap-1 max-w-xs">
                                    {r.ratings && Object.entries(r.ratings).map(([qKey, qVal]) => {
                                      if (typeof qVal === 'string' && qVal.length > 20) return null;
                                      return (
                                        <span 
                                          key={qKey} 
                                          className="px-1.5 py-0.5 bg-gray-100 rounded text-[10px] text-gray-700 font-mono"
                                          title={`${qKey}: ${qVal}`}
                                        >
                                          {qKey.replace('q', 'Q')}: <strong>{String(qVal)}</strong>
                                        </span>
                                      );
                                    })}
                                  </div>
                                </td>
                                <td className="py-3 px-3.5 whitespace-nowrap text-center">
                                  <span className="text-sm font-black text-gray-900">
                                    {isScale5 ? `${r.rating_score || 0}/5` : `${r.rating_score || 0}%`}
                                  </span>
                                </td>
                                <td className="py-3 px-3.5 max-w-xs">
                                  <p className="text-gray-700 line-clamp-2 italic">
                                    {r.verbatim_feedback ? `"${r.verbatim_feedback}"` : <span className="text-gray-400 not-italic">-</span>}
                                  </p>
                                </td>
                                <td className="py-3 px-3.5 whitespace-nowrap text-center">
                                  <span className="text-[10px] font-semibold px-2 py-0.5 bg-gray-100 text-gray-600 rounded-md">
                                    {r.source || 'SURVEY_RECORD'}
                                  </span>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 1 FOR OUTCOME: HR MEASUREMENT SPECIFICATIONS */}
              {isOutcome && activeTab === 'primary' && (
                <div className="space-y-4">
                  <div className="p-4 bg-blue-50/60 border border-blue-200 rounded-xl space-y-2">
                    <div className="flex items-center space-x-2 text-blue-900 font-bold text-sm">
                      <Database className="w-4 h-4 text-blue-600" />
                      <span>Outcome Metric Characteristics (PX Framework)</span>
                    </div>
                    <p className="text-xs text-blue-800 leading-relaxed">
                      This metric represents <strong>Internal CIMB Niaga HR Data</strong> pulled from transactional bank operations (such as Workday, Arjuna, LMS, or PXCWB Registration Records). It is <strong>not a survey questionnaire</strong>, hence does not require total survey respondents, but measures operational process efficiency, SLAs, quota fulfillment, or employee retention.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-3">
                      <h4 className="font-bold text-gray-900 text-xs uppercase tracking-wider">HR Measurement Specifications</h4>
                      <dl className="space-y-2 text-xs">
                        <div className="flex justify-between border-b border-gray-200/70 pb-1.5">
                          <dt className="text-gray-500">Source System:</dt>
                          <dd className="font-bold text-gray-900">{detailData.source_of_data}</dd>
                        </div>
                        <div className="flex justify-between border-b border-gray-200/70 pb-1.5">
                          <dt className="text-gray-500">Experience Owner:</dt>
                          <dd className="font-bold text-gray-900">{detailData.experience_owner}</dd>
                        </div>
                        <div className="flex justify-between border-b border-gray-200/70 pb-1.5">
                          <dt className="text-gray-500">Unit & Value Scale:</dt>
                          <dd className="font-bold text-gray-900">{detailData.scale_type}</dd>
                        </div>
                        <div className="flex justify-between pb-1">
                          <dt className="text-gray-500">Weight Contribution:</dt>
                          <dd className="font-bold text-[#ED1C24]">30% Outcome Index Consolidation</dd>
                        </div>
                      </dl>
                    </div>

                    <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-3">
                      <h4 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Benchmarks & Thresholds</h4>
                      <div className="space-y-2 text-xs">
                        <div className="flex items-center justify-between p-2.5 bg-white rounded-lg border border-gray-200">
                          <span className="text-gray-600">Official Board Target:</span>
                          <span className="font-black text-gray-900">{detailData.target_display}</span>
                        </div>
                        <div className="flex items-center justify-between p-2.5 bg-white rounded-lg border border-gray-200">
                          <span className="text-gray-600">Minimum Threshold:</span>
                          <span className="font-black text-amber-700">{detailData.min_threshold}%</span>
                        </div>
                        <div className="flex items-center justify-between p-2.5 bg-white rounded-lg border border-gray-200">
                          <span className="text-gray-600">Current Performance Status:</span>
                          <span className={`font-black ${detailData.status === 'CRITICAL' ? 'text-red-600' : (detailData.status === 'WARNING' ? 'text-amber-600' : 'text-emerald-600')}`}>
                            {detailData.status} ({detailData.normalized_score}% Index Score)
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2 FOR OUTCOME: TRANSACTION LOGS & OPERATIONAL RECORDS */}
              {isOutcome && activeTab === 'secondary' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-gray-500 font-medium">
                      Operational transaction data records from <strong>{detailData.source_of_data}</strong>:
                    </div>
                    <div className="relative w-64">
                      <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-2.5" />
                      <input
                        type="text"
                        placeholder="Search transaction records..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-8 pr-3 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  {/* Outcome Operational Records Table */}
                  <div className="border border-gray-200 rounded-xl overflow-x-auto shadow-2xs">
                    {detailData.metric_id === 11 ? (
                      /* Live Event Attendance Table */
                      <table className="w-full text-left text-xs">
                        <thead className="bg-gray-100 text-gray-700 font-bold uppercase tracking-wider border-b border-gray-200">
                          <tr>
                            <th className="py-2.5 px-3.5">Registration Time</th>
                            <th className="py-2.5 px-3.5">Employee Participant (NIP)</th>
                            <th className="py-2.5 px-3.5">Directorate & Division</th>
                            <th className="py-2.5 px-3.5">Program Event Title</th>
                            <th className="py-2.5 px-3.5 text-center">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 font-normal bg-white">
                          {filteredOperationalRecords.length === 0 ? (
                            <tr>
                              <td colSpan="5" className="text-center py-8 text-gray-400">
                                No event attendance records found.
                              </td>
                            </tr>
                          ) : (
                            filteredOperationalRecords.map((item, idx) => (
                              <tr key={idx} className="hover:bg-blue-50/30 transition">
                                <td className="py-2.5 px-3.5 font-mono text-gray-600">
                                  {item.registered_at ? new Date(item.registered_at).toLocaleString('en-US') : '-'}
                                </td>
                                <td className="py-2.5 px-3.5">
                                  <div className="font-bold text-gray-900">{item.employee_name}</div>
                                  <div className="text-[10px] text-gray-500 font-mono">{item.nip} • {item.cimb_email}</div>
                                </td>
                                <td className="py-2.5 px-3.5 text-gray-700">
                                  <div>{item.directorate}</div>
                                  <div className="text-[10px] text-gray-400">{item.division}</div>
                                </td>
                                <td className="py-2.5 px-3.5 font-semibold text-gray-800">
                                  {item.event_title}
                                </td>
                                <td className="py-2.5 px-3.5 text-center">
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                                    <Check className="w-3 h-3 mr-0.5" /> Present & Verified
                                  </span>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    ) : (
                      /* Generic Operational SLA / Distribution Table */
                      <table className="w-full text-left text-xs">
                        <thead className="bg-gray-100 text-gray-700 font-bold uppercase tracking-wider border-b border-gray-200">
                          <tr>
                            <th className="py-2.5 px-3.5">No</th>
                            <th className="py-2.5 px-3.5">Segmentation / Unit / Category</th>
                            <th className="py-2.5 px-3.5">Achievement Parameter</th>
                            <th className="py-2.5 px-3.5 text-center">Value / Ratio</th>
                            <th className="py-2.5 px-3.5 text-center">Status / Compliance</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 font-normal bg-white">
                          {filteredOperationalRecords.map((item, idx) => {
                            const title = item.unit || item.channel || item.stream || item.stage || item.category || item.tenure_bracket || `Segment ${idx+1}`;
                            const metricVal = item.sla_achievement || item.percentage || item.compliance || item.rate || item.points_awarded || `${item.fulfilled || item.hires_count || item.recipient_count || item.attrition_count} units`;
                            const statusBadge = item.status || 'Verified (System)';

                            return (
                              <tr key={idx} className="hover:bg-blue-50/30 transition">
                                <td className="py-2.5 px-3.5 font-bold text-gray-400">{idx + 1}</td>
                                <td className="py-2.5 px-3.5 font-bold text-gray-900">{title}</td>
                                <td className="py-2.5 px-3.5 text-gray-600">
                                  {item.target_headcount ? `Target: ${item.target_headcount} | Realization: ${item.fulfilled}` : 
                                   item.quality_score ? `Recruitment Quality Score: ${item.quality_score}` :
                                   item.avg_sla_hours ? `Duration: ${item.avg_sla_hours} hrs (SLA: ${item.sla_target_hours} hrs)` :
                                   item.avg_days ? `Avg Lead Time: ${item.avg_days} days` :
                                   item.benchmark ? `Threshold Benchmark: ${item.benchmark}` : 'Recorded in HR System'}
                                </td>
                                <td className="py-2.5 px-3.5 text-center">
                                  <span className="font-black text-blue-700 px-2 py-0.5 bg-blue-50 rounded-md border border-blue-100">
                                    {metricVal}
                                  </span>
                                </td>
                                <td className="py-2.5 px-3.5 text-center">
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                                    <Check className="w-3 h-3 mr-0.5" /> {statusBadge}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              )}

            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
          <div className="text-xs text-gray-500">
            CIMB Niaga People Experience (PX) Intelligence Center • {isSurvey ? 'Employee Survey Module' : 'Internal HR Data Module'}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-900 text-white rounded-xl text-xs font-bold transition"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
}
