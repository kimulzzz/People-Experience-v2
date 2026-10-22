// src/components/MetricDetailModal.jsx
import { useAuth } from '../utils/AuthContext';
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
  LayoutGrid,
  MinusCircle,
  DoorOpen
} from 'lucide-react';
import { formatMetricValue } from '../utils/formatMetricValue';
import { monthName } from '../utils/months';
import { surveySourceLabel, surveySourceBadgeClass, surveyTemplateFileName } from '../utils/surveySource';
import SocialMediaUploadModal from './SocialMediaUploadModal';
import OutcomeUploadModal from './OutcomeUploadModal';
import PartSummaryModal from './PartSummaryModal';
import MetricHistoryTable from './MetricHistoryTable';
import { tierBandsText, tierValue } from '../utils/scoreTiers';
import { metricNo } from '../utils/metricNumber';

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
  period: periodProp = 'YTD',
  filterOptions = null,
  onOpenSurveyUpload,
  onOpenSurveyQuestionSettings,
  onOpenExitInterview,
  onDataUploaded
}) {
  // The dashboard filter (YTD / MTD + year + month) decides the period; the `period` prop is only a fallback when no
  // filter is passed (App.jsx passes filterOptions only, so the badge used to read Year-to-Date even in MTD mode).
  const period = filterOptions
    ? (filterOptions.mode === 'MTD' && filterOptions.year && filterOptions.month
      ? `${filterOptions.year}-${String(filterOptions.month).padStart(2, '0')}`
      : (filterOptions.year ? String(filterOptions.year) : 'YTD'))
    : periodProp;
  const periodLabel = /^\d{4}-\d{2}$/.test(period)
    ? `${monthName(period.slice(5))} ${period.slice(0, 4)}`
    : `YTD ${/^\d{4}$/.test(period) ? period : ''}`.trim();
  const { isAdmin } = useAuth();
  const [detailData, setDetailData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDirectorate, setSelectedDirectorate] = useState('ALL');
  const [activeTab, setActiveTab] = useState('primary'); // 'primary' | 'secondary'
  const [selectedRespondent, setSelectedRespondent] = useState(null);
  const [essViewMode, setEssViewMode] = useState('table'); // 'table' | 'cards'
  const [isSocialUploadOpen, setIsSocialUploadOpen] = useState(false); // v2.52.0: social media data of metric 1 (Admin)
  const [isOutcomeUploadOpen, setIsOutcomeUploadOpen] = useState(false); // v2.54.0: monthly values of an OUTCOME metric (Admin)
  const [isPartSummaryOpen, setIsPartSummaryOpen] = useState(false); // v2.55.0: summary parts of a composite metric (Admin)
  // v2.56.0: History tab = the rows behind the metric's Evidence download (GET /api/metrics/:id/history)
  const [history, setHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);

  useEffect(() => {
    if (isOpen && metricId) {
      fetchDetail();
    }
  }, [isOpen, metricId, period, filterOptions?.mode, filterOptions?.year, filterOptions?.month, filterOptions?.directorate, filterOptions?.sub_directorate]);

  // keepTab: reload after a social media upload without leaving the records tab
  const fetchDetail = async ({ keepTab = false } = {}) => {
    setIsLoading(true);
    try {
      // Same period + directorate scope as the dashboard scorecard, so the drilldown never disagrees with it.
      const params = new URLSearchParams();
      if (filterOptions) {
        params.set('mode', filterOptions.mode || 'YTD');
        if (filterOptions.year) params.set('year', filterOptions.year);
        if (filterOptions.month) params.set('month', filterOptions.month);
        if (filterOptions.directorate && filterOptions.directorate !== 'ALL') params.set('directorate', filterOptions.directorate);
        if (filterOptions.sub_directorate && filterOptions.sub_directorate !== 'ALL') params.set('sub_directorate', filterOptions.sub_directorate);
      } else {
        params.set('period', period);
      }
      fetchHistory(params);
      const res = await fetch(`/api/metrics/${metricId}/detail?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setDetailData(data);
        if (!keepTab) setActiveTab('primary');
      }
    } catch (err) {
      console.error('Error fetching metric detail:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Same period + directorate parameters as the detail (the server turns them into the evidence period)
  const fetchHistory = async (params) => {
    setHistoryLoading(true);
    setHistoryError(null);
    setHistory(null);
    try {
      const res = await fetch(`/api/metrics/${metricId}/history?${params.toString()}`);
      if (res.ok) setHistory(await res.json());
      else {
        setHistory(null);
        setHistoryError(res.status === 403 ? 'No access to the history of this metric.' : 'The history could not be loaded.');
      }
    } catch (err) {
      setHistory(null);
      setHistoryError('The history could not be loaded.');
    } finally {
      setHistoryLoading(false);
    }
  };

  if (!isOpen) return null;

  const isSurvey = detailData?.metric_type === 'SURVEY';
  const isOutcome = !isSurvey;
  // ESS-ness is decided by the server from the metric's Survey Source (Parameter Admin), not by the source text.
  const isEss = !!detailData?.is_ess;
  // ESS metric read from its uploaded ESS summary (v2.32.0): directorate-level aggregates, no respondent rows,
  // the index (column F) and one score per question, exactly as in the ESS template (no favorable / neutral / unfavorable).
  const isEssSummary = isEss && !!detailData?.is_ess_summary;
  const pct = v => (v === null || v === undefined ? '—' : `${v}%`);
  // v2.36.0: a survey metric without data in the selected period (status NO_DATA, null scores)
  const isNoData = detailData?.status === 'NO_DATA';
  // v2.54.0: a tier-scored metric whose tiers are not configured yet: value N/A (status NO_DATA, not counted in the PX Index)
  const isNotApplicable = isNoData && !!detailData?.not_applicable;
  // v2.55.0: composite summary metric (7, 5, 12): scored from the uploaded part summaries, not from respondent rows
  const isPartSummary = detailData?.data_upload === 'PART_SUMMARY';
  const summaryParts = detailData?.parts || [];
  // v2.56.0 History tab: SYSTEM surveys keep the respondent records of the detail (redacted for non-PIC users); OUTCOME
  // metrics without stored months keep the operational records of the detail; every other kind = the evidence rows
  const usesRespondentHistory = isSurvey && !isEss && !isPartSummary;
  const usesOperationalHistory = isOutcome && !isPartSummary && history?.kind === 'OPERATIONAL' && !detailData?.operational_records_hidden;
  const historyCount = usesRespondentHistory
    ? (detailData?.responses?.length || 0)
    : usesOperationalHistory ? (detailData?.operational_records?.length || 0) : (history ? history.total : (historyLoading ? '…' : 0));

  const isCampus = detailData?.metric_id === 2 || detailData?.target_audience === 'CAMPUS_STUDENTS';
  const isCandidate = detailData?.metric_id === 5 || detailData?.target_audience === 'JOB_APPLICANTS';
  const isNonEmployee = isCampus || isCandidate || detailData?.is_employee_metric === false;

  const responses = detailData?.responses || [];
  const directorates = ['ALL', ...[...new Set(responses.map(r => r.directorate).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))];

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

  // v2.52.0: metric 1 = social media statistics per platform per month (bankwide; Admin Excel upload)
  const isSocialMedia = detailData?.data_upload === 'SOCIAL_MEDIA';
  const socialTotals = detailData?.social_media?.period_totals || [];
  const fmtCount = v => (v === null || v === undefined ? '—' : Number(v).toLocaleString('en-US'));
  const fmtPct = (v, signed = false) => (v === null || v === undefined ? '—' : `${signed && v > 0 ? '+' : ''}${Number(v).toFixed(2)}%`);
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
                  Metric {detailData ? metricNo(detailData) : ''}
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
                  {isSurvey ? 'Type: Employee Survey' : 'Type: Outcome (Internal HR Data)'}
                </span>
                {isSurvey && detailData?.survey_source && (
                  <span
                    className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${surveySourceBadgeClass(detailData.survey_source)}`}
                    title={detailData.survey_source === 'ESS' ? 'Employee Sentiment Survey - uploaded manually from the ESS template' : 'Data from another system or form'}
                  >
                    Survey Source: {surveySourceLabel(detailData.survey_source)}
                  </span>
                )}
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-gray-100 text-gray-700 border border-gray-200">
                  Period: {periodLabel}
                </span>
                {detailData?.last_update_label && (
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-gray-100 text-gray-700 border border-gray-200" title="Latest data period of this metric (any period)">
                    Last update: {detailData.last_update_label}
                  </span>
                )}
              </div>
              <h2 className="text-xl font-black text-gray-900 mt-1">
                {detailData?.metric_name || 'Metric Details'}
              </h2>
              {/* v2.38.0: the exit survey metric links to the Exit Interview dashboard (found by name / data source, not by id) */}
              {onOpenExitInterview && detailData && /exit (survey|interview)/i.test(`${detailData.metric_name || ''} ${detailData.source_of_data || ''}`) && (
                <button
                  onClick={onOpenExitInterview}
                  className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg text-white shadow-sm"
                  style={{ backgroundColor: 'var(--theme-base)' }}
                >
                  <DoorOpen className="w-3.5 h-3.5" /> Open Exit Interview Dashboard
                </button>
              )}
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
              <div className="text-xs text-gray-500 font-medium">Loading metric details and history...</div>
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
                      {isNotApplicable ? 'N/A' : isNoData ? '—' : formatMetricValue(detailData.current_raw_value, detailData.unit, detailData.scale_type)}
                    </span>
                    <span className="text-xs font-semibold text-gray-500">
                      ({detailData.target_display})
                    </span>
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">
                    {isNotApplicable
                      ? <>{detailData.not_applicable_reason || 'Score tiers not configured yet'} - N/A, not counted in the PX Index</>
                      : isNoData
                      ? <>No data in this period - left out of the index</>
                      : <>Calculated Index Score: <strong className="text-[#ED1C24]">{detailData.normalized_score}%</strong></>}
                  </div>
                  {/* v2.54.0: how a Tiered Count value was scored, e.g. 6,400 -> tier 4 -> 4.27 / 5 = 85.33% */}
                  {!isNoData && detailData.tier_info && (
                    <div className="text-[10px] text-gray-500 mt-0.5" title={tierBandsText(detailData.tier_info.bounds, detailData.tier_info.unit)}>
                      {tierValue(detailData.tier_info.value, detailData.tier_info.unit)} → tier {detailData.tier_info.tier} → <strong>{detailData.tier_info.score.toFixed(2)} / 5</strong> = {detailData.tier_info.percent.toFixed(2)}%{detailData.tier_info.capped ? ' (capped)' : ''}
                    </div>
                  )}
                  {isPartSummary && !isNoData && summaryParts.length > 1 && (
                    <div className="text-[10px] text-blue-700 mt-0.5">
                      Average of {detailData.composite?.parts_with_data} of {summaryParts.length} parts (parts without data are N/A, not counted)
                    </div>
                  )}
                  {isOutcome && detailData.value_basis === 'MONTHLY_VALUES' && (
                    <div className="text-[10px] text-blue-700 mt-0.5">
                      {isNoData ? 'No uploaded month in this period'
                        : detailData.outcome_aggregation === 'AVERAGE'
                          ? `${detailData.outcome_average_label}: ${formatMetricValue(detailData.current_raw_value, detailData.unit, detailData.scale_type)}`
                          : `Value of ${detailData.outcome_period_label} (latest uploaded month in the period)`}
                    </div>
                  )}
                </div>

                {/* CARD 2: THRESHOLD STATUS */}
                <div className="p-3.5 bg-gray-50 border border-gray-200 rounded-xl">
                  <div className="text-[11px] font-bold text-gray-500 uppercase">Threshold Status</div>
                  <div className="mt-1 flex items-center space-x-1.5">
                    <span className={`inline-flex items-center text-xs font-bold px-2.5 py-1 rounded-full ${
                      isNoData ? 'bg-gray-200 text-gray-600' :
                      detailData.status === 'CRITICAL' ? 'bg-red-100 text-red-800' :
                      detailData.status === 'WARNING' ? 'bg-amber-100 text-amber-800' :
                      'bg-emerald-100 text-emerald-800'
                    }`}>
                      {isNoData ? <MinusCircle className="w-3.5 h-3.5 mr-1" /> : detailData.status === 'CRITICAL' ? <AlertCircle className="w-3.5 h-3.5 mr-1" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
                      <span>{isNotApplicable ? 'N/A' : isNoData ? 'No Data' : detailData.status === 'CRITICAL' ? 'Critical Deficit' : (detailData.status === 'WARNING' ? 'Warning Zone' : 'On Target')}</span>
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
                      <div className="text-[11px] font-bold text-gray-500 uppercase">{isEssSummary ? 'Participation' : 'Total Respondents'}</div>
                      <div className="text-2xl font-black text-gray-900 mt-1">
                        {detailData.total_respondents ?? 0} <span className="text-xs font-normal text-gray-500">{isEssSummary ? 'participants' : 'respondents'}</span>
                      </div>
                      <div className="text-[10px] text-gray-500 mt-0.5 flex items-center space-x-1">
                        <Calendar className="w-3 h-3 text-[#ED1C24]" />
                        <span>{isEssSummary ? 'ESS Result Period' : 'Latest Survey Date'}: <strong>{isEssSummary ? detailData.ess_period_label : (normalizeDateString(detailData.last_survey_date) || (detailData.has_data === false ? '—' : todayDateString()))}</strong></span>
                      </div>
                      {isEssSummary && detailData.ess_carried_forward && (
                        <div className="text-[10px] text-indigo-700 mt-0.5">ESS result {detailData.ess_period_label} (latest available) - ESS runs once a year</div>
                      )}
                      {isEssSummary && detailData.ess_division_filtered && (
                        <div className="text-[10px] text-indigo-700 mt-0.5">ESS is reported at directorate level</div>
                      )}
                    </div>

                    {/* Survey: Quick Actions (template / evidence / upload = Admin or the PIC of this metric; can_upload comes from the server) */}
                    {isPartSummary && isAdmin && <div className="p-3.5 bg-gray-50 border border-gray-200 rounded-xl">
                      <div className="text-[11px] font-bold text-gray-500 uppercase">Summary Data Operations</div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {[['Template', Download], ['Evidence', FileText], ['Upload', FileSpreadsheet]].map(([label, Icon]) => (
                          <button
                            key={label}
                            onClick={() => setIsPartSummaryOpen(true)}
                            className="inline-flex items-center space-x-1 px-2 py-1 text-[10.5px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 hover:text-slate-900 border border-slate-200 rounded-md transition shadow-2xs"
                            title={`${label} of a summary part (choose the part)`}
                          >
                            <Icon className="w-3 h-3 text-slate-500 shrink-0" />
                            <span>{label}</span>
                          </button>
                        ))}
                      </div>
                    </div>}
                    {!isPartSummary && (isAdmin || detailData.can_upload) && <div className="p-3.5 bg-gray-50 border border-gray-200 rounded-xl">
                      <div className="text-[11px] font-bold text-gray-500 uppercase flex items-center justify-between">
                        <span>Survey Data Operations</span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <a
                          href={`/api/surveys/template?metric_id=${detailData.metric_id}`}
                          download={surveyTemplateFileName(detailData.metric_id, isEss)}
                          className="inline-flex items-center space-x-1 px-2 py-1 text-[10.5px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 hover:text-slate-900 border border-slate-200 rounded-md transition shadow-2xs"
                          title={isEss ? 'Download the ESS summary template (.xlsx)' : 'Download CSV Template with standard question format'}
                        >
                          <Download className="w-3 h-3 text-slate-500 shrink-0" />
                          <span>Template</span>
                        </a>
                        {isEssSummary && detailData.ess_upload?.has_original_file && (
                          <a
                            href={`/api/surveys/ess-file/${encodeURIComponent(detailData.ess_upload.upload_id)}`}
                            download={detailData.ess_upload.file_name}
                            className="inline-flex items-center space-x-1 px-2 py-1 text-[10.5px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 hover:text-slate-900 border border-slate-200 rounded-md transition shadow-2xs"
                            title={`Download the original uploaded ESS file: ${detailData.ess_upload.file_name} (${detailData.ess_upload.uploaded_by})`}
                          >
                            <FileSpreadsheet className="w-3 h-3 text-slate-500 shrink-0" />
                            <span>Original File</span>
                          </a>
                        )}
                        <a
                          href={`/api/surveys/evidence?metric_id=${detailData.metric_id}&period=${period || 'YTD'}`}
                          download /* name from the server: .csv, or .zip when the rows span several question sets (v2.50.0) */
                          className="inline-flex items-center space-x-1 px-2 py-1 text-[10.5px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 hover:text-slate-900 border border-slate-200 rounded-md transition shadow-2xs"
                          title="Download survey respondent records for audit validation"
                        >
                          <FileText className="w-3 h-3 text-slate-500 shrink-0" />
                          <span>Evidence</span>
                        </a>
                        <button
                          onClick={() => {
                            onClose();
                            if (onOpenSurveyUpload) onOpenSurveyUpload(detailData.metric_id);
                          }}
                          className="inline-flex items-center space-x-1 px-2 py-1 text-[10.5px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 hover:text-slate-900 border border-slate-200 rounded-md transition shadow-2xs"
                          title={isEss ? 'Upload the ESS summary (.xlsx)' : 'Upload new CSV survey responses'}
                        >
                          <FileSpreadsheet className="w-3 h-3 text-slate-500 shrink-0" />
                          <span>Upload</span>
                        </button>
                      </div>
                    </div>}
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
                        Metric Weight: <strong>{detailData.px_weights ? `${detailData.px_weights.outcome}% ` : ''}Outcome Index</strong>
                      </div>
                    </div>
                  </>
                )}

              </div>

              {/* v2.54.0: OUTCOME data operations (Admin): Template / Evidence / Upload - monthly values, metric 1 social media,
                  metric 11 event attendance (Evidence only) */}
              {isOutcome && isPartSummary && isAdmin && (
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[11px] font-bold text-gray-500 uppercase">Summary Data Operations{!detailData.parts?.length ? ' (no summary uploaded yet - static value)' : ''}</div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {[['Template', Download], ['Evidence', FileText], ['Upload', FileSpreadsheet]].map(([label, Icon]) => (
                      <button key={label} onClick={() => setIsPartSummaryOpen(true)} className="inline-flex items-center space-x-1 px-2 py-1 text-[10.5px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 hover:text-slate-900 border border-slate-200 rounded-md transition shadow-2xs" title={`${label} of the summary (${detailData.metric_name})`}>
                        <Icon className="w-3 h-3 text-slate-500 shrink-0" />
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {isOutcome && isAdmin && detailData.evidence_type && (
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[11px] font-bold text-gray-500 uppercase">Outcome Data Operations</div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {detailData.outcome_upload && (
                      <a href={`/api/admin/outcome-values/${detailData.metric_id}/template`} download={`Template_Outcome_Metric_${detailData.metric_id}.xlsx`} className="inline-flex items-center space-x-1 px-2 py-1 text-[10.5px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 hover:text-slate-900 border border-slate-200 rounded-md transition shadow-2xs" title="Download the monthly value template (.xlsx)">
                        <Download className="w-3 h-3 text-slate-500 shrink-0" />
                        <span>{isSocialMedia ? 'Value Template' : 'Template'}</span>
                      </a>
                    )}
                    <a href={`/api/admin/outcome-evidence/${detailData.metric_id}?period=${period || 'YTD'}`} download className="inline-flex items-center space-x-1 px-2 py-1 text-[10.5px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 hover:text-slate-900 border border-slate-200 rounded-md transition shadow-2xs" title={`Download the evidence (CSV) for ${periodLabel}`}>
                      <FileText className="w-3 h-3 text-slate-500 shrink-0" />
                      <span>{isSocialMedia ? 'Value Evidence' : 'Evidence'}</span>
                    </a>
                    {detailData.outcome_upload && (
                      <button onClick={() => setIsOutcomeUploadOpen(true)} className="inline-flex items-center space-x-1 px-2 py-1 text-[10.5px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 hover:text-slate-900 border border-slate-200 rounded-md transition shadow-2xs" title="Upload monthly values (.xlsx)">
                        <FileSpreadsheet className="w-3 h-3 text-slate-500 shrink-0" />
                        <span>{isSocialMedia ? 'Value Upload' : 'Upload'}</span>
                      </button>
                    )}
                    {isSocialMedia && (
                      <>
                        <a href="/api/admin/social-media/template" download="Template_Social_Media_Metric_1.xlsx" className="inline-flex items-center space-x-1 px-2 py-1 text-[10.5px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 hover:text-slate-900 border border-slate-200 rounded-md transition shadow-2xs" title="Download the social media template (.xlsx)">
                          <Download className="w-3 h-3 text-slate-500 shrink-0" />
                          <span>Social Media Template</span>
                        </a>
                        <a href={`/api/admin/outcome-evidence/${detailData.metric_id}?period=${period || 'YTD'}&kind=social_media`} download className="inline-flex items-center space-x-1 px-2 py-1 text-[10.5px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 hover:text-slate-900 border border-slate-200 rounded-md transition shadow-2xs" title={`Download the social media rows (CSV) for ${periodLabel}`}>
                          <FileText className="w-3 h-3 text-slate-500 shrink-0" />
                          <span>Social Media Evidence</span>
                        </a>
                        <button onClick={() => setIsSocialUploadOpen(true)} className="inline-flex items-center space-x-1 px-2 py-1 text-[10.5px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 hover:text-slate-900 border border-slate-200 rounded-md transition shadow-2xs" title="Upload Instagram / LinkedIn / TikTok data (.xlsx)">
                          <FileSpreadsheet className="w-3 h-3 text-slate-500 shrink-0" />
                          <span>Social Media Upload</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

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

                    {/* ESS summary template (v2.33.0): only the index (column F) and the question scores - no favorable / neutral / unfavorable split */}
                    {isEssSummary ? (
                      <div className="flex items-center space-x-4 bg-white/10 backdrop-blur-md px-4 py-2 rounded-xl border border-white/15">
                        <div>
                          <div className="text-[10px] text-gray-300 font-bold uppercase tracking-wider">Index Score</div>
                          <div className="text-2xl font-black text-white">
                            {pct(detailData.ess_summary.summary_score)}
                          </div>
                        </div>
                        <div className="flex flex-col space-y-1 text-[11px] font-bold border-l border-white/20 pl-3 text-gray-300">
                          <span>{detailData.ess_summary.participation} participants</span>
                          <span>{detailData.ess_summary.period_label}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-white/10 backdrop-blur-md px-4 py-2 rounded-xl border border-white/15 text-[11px] font-bold text-gray-300">
                        No ESS summary uploaded for this period
                      </div>
                    )}
                  </div>

                  {isEssSummary && (
                    <div className="pt-1">
                      <div className="w-full h-3 bg-black/50 rounded-full overflow-hidden shadow-inner">
                        <div
                          style={{ width: `${Math.min(100, Math.max(0, detailData.ess_summary.summary_score || 0))}%` }}
                          className="bg-white/80 h-full rounded-full transition-all duration-500"
                          title={`Index score: ${pct(detailData.ess_summary.summary_score)}`}
                        />
                      </div>
                    </div>
                  )}
                  <p className="text-[11px] text-gray-400 italic pt-1 border-t border-white/10">
                    {detailData.ess_summary.description}
                  </p>
                </div>
              )}

              {/* Navigation Sub-Menu Tabs */}
              <div className="flex border-b border-gray-200">
                {isSurvey || isPartSummary ? (
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
                      <span>{isPartSummary ? `Summary Parts (${summaryParts.length})` : `Question Breakdown & Average Scores (${detailData.questions_breakdown?.length || 0})`}</span>
                    </button>
                    {/* v2.56.0: every metric has a History tab (SYSTEM surveys: the respondent records, as before) */}
                    <button
                      onClick={() => setActiveTab('secondary')}
                      className={`pb-2.5 px-4 text-xs font-bold transition flex items-center space-x-2 border-b-2 ${
                        activeTab === 'secondary'
                          ? 'border-[#ED1C24] text-[#ED1C24]'
                          : 'border-transparent text-gray-500 hover:text-gray-800'
                      }`}
                    >
                      <Users className="w-4 h-4" />
                      <span>{`History (${historyCount})`}</span>
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
                    {/* v2.56.0: History (formerly Internal Transaction Records) - also for metric 1 (its monthly values) */}
                    <button
                      onClick={() => setActiveTab('secondary')}
                      className={`pb-2.5 px-4 text-xs font-bold transition flex items-center space-x-2 border-b-2 ${
                        activeTab === 'secondary'
                          ? 'border-blue-600 text-blue-600'
                          : 'border-transparent text-gray-500 hover:text-gray-800'
                      }`}
                    >
                      <Database className="w-4 h-4" />
                      <span>{`History (${historyCount})`}</span>
                    </button>
                  </>
                )}
              </div>

              {/* v2.55.0: TAB 1 FOR A COMPOSITE SUMMARY METRIC - per part its value (average of its months), months used, N/A */}
              {isPartSummary && activeTab === 'primary' && (
                <div className="space-y-3">
                  <div className="text-xs text-gray-500">
                    Each part = the average of its months with a value in {periodLabel}{summaryParts.length > 1 ? '; the metric = the average of the parts with a value' : ''}:
                  </div>
                  <div className="border border-gray-200 rounded-xl overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-gray-100 text-gray-700 font-bold uppercase text-[10.5px]">
                        <tr><th className="py-2 px-3">Part</th><th className="py-2 px-3 text-right">Value</th><th className="py-2 px-3 text-right">Score</th><th className="py-2 px-3">Months used</th><th className="py-2 px-3">Last upload</th></tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {summaryParts.length === 0 ? (
                          <tr><td colSpan="5" className="text-center py-6 text-gray-400">{detailData.data_not_available ? 'Real data not available yet.' : 'No summary uploaded yet (the static value is shown).'}</td></tr>
                        ) : summaryParts.map(p => (
                          <React.Fragment key={p.part_key}>
                            <tr>
                              <td className="py-2 px-3 font-bold text-gray-800">{p.part_name}</td>
                              <td className="py-2 px-3 text-right font-mono">{p.has_data ? (p.scale === 'PERCENT' ? `${p.value}%` : `${p.value} / 5`) : <span className="px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 text-[10px] font-bold">N/A</span>}</td>
                              <td className="py-2 px-3 text-right font-mono">{p.has_data ? `${p.score}%` : '—'}</td>
                              <td className="py-2 px-3 text-gray-600">
                                {p.has_data ? `${p.months_count} month${p.months_count === 1 ? '' : 's'} (${p.months_label}): ${p.months.map(m => `${m.period_label.slice(0, 3)} ${m.value}`).join(', ')}` : 'No month with a value in this period - not counted'}
                              </td>
                              <td className="py-2 px-3 text-gray-500 text-[11px]">{p.last_upload ? `${p.last_upload.file_name || '—'} (${new Date(p.last_upload.uploaded_at).toLocaleDateString('en-GB')})` : 'No upload yet'}</td>
                            </tr>
                            {(p.events || []).map(ev => (
                              <tr key={`${p.part_key}-${ev.event}`} className="bg-gray-50/60">
                                <td className="py-1.5 px-3 pl-8 text-gray-600">{ev.event}</td>
                                <td className="py-1.5 px-3 text-right font-mono text-gray-600">{ev.value === null ? 'N/A' : (p.scale === 'PERCENT' ? `${ev.value}%` : ev.value)}</td>
                                <td className="py-1.5 px-3 text-right font-mono text-gray-600">{ev.score === null ? '—' : `${ev.score}%`}</td>
                                <td className="py-1.5 px-3 text-gray-500" colSpan="2">{ev.value === null ? 'No value in this period' : `${ev.months_count} month${ev.months_count === 1 ? '' : 's'}`}</td>
                              </tr>
                            ))}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 1 FOR SURVEY: QUESTIONS & AVERAGE BREAKDOWN */}
              {isSurvey && !isPartSummary && activeTab === 'primary' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="text-xs text-gray-500">
                      {isEss 
                        ? 'ESS index and score of each question, as stated in the uploaded ESS summary:'
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

                  {/* v2.50.0: the questions shown are the current Manage Questions; this result was uploaded with other texts */}
                  {detailData.questions_changed_since_upload && (
                    <div className="flex items-start gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span><strong>Questions changed since this result was uploaded.</strong> The current questions are shown; the text in use at upload is listed under each changed question. The evidence download keeps the original texts.</span>
                    </div>
                  )}

                  {/* SPREADSHEET TABLE VIEW (v2.33.0): same content as the ESS summary template - the index (column F) and one score per question */}
                  {isEss && essViewMode === 'table' ? (
                    <div className="border border-purple-200/80 rounded-xl overflow-hidden shadow-xs bg-white">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-[#563175] text-white font-black text-xs uppercase tracking-wider">
                              <th className="py-2.5 px-3 border-r border-purple-400/30">Question</th>
                              <th className="py-2.5 px-2 text-center w-28 bg-[#663A8B]">Score</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200 bg-white">
                            <tr className="bg-gray-100/95 font-black text-gray-900 border-t-2 border-gray-300">
                              <td className="py-2 px-3 font-black text-gray-900 border-r border-gray-200">
                                Overall
                              </td>
                              <td className="py-2 px-2 text-center font-black text-gray-900">
                                {isEssSummary ? pct(detailData.ess_summary?.summary_score) : '—'}
                              </td>
                            </tr>
                            {(detailData.questions_breakdown || []).filter(q => q.type !== 'FREE_TEXT').map((q, qIdx) => (
                              <tr key={q.key || qIdx} className="hover:bg-purple-50/30 transition-colors">
                                <td className="py-2.5 px-3 text-gray-900 font-semibold align-top border-r border-gray-200/60">
                                  <div className="flex items-start gap-1.5">
                                    <span className="text-[10px] font-bold text-gray-400 shrink-0 mt-0.5">Q{qIdx + 1}.</span>
                                    <span className="text-xs">{q.text || q.label}</span>
                                  </div>
                                  {(q.original_texts || []).length > 0 && (
                                    <div className="ml-6 mt-0.5 text-[10.5px] font-normal italic text-amber-700" title="Question text in use when this data was uploaded">
                                      At upload: {q.original_texts.join(' / ')}
                                    </div>
                                  )}
                                </td>
                                <td className="py-2.5 px-2 text-center font-bold text-gray-800 align-top">
                                  {isEssSummary ? pct(q.normalized_score) : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    /* CARDS VIEW */
                    <div className="grid grid-cols-1 gap-3">
                      {detailData.questions_breakdown?.map((q, idx) => {
                        const qType = q.type || 'SCALE_1_5';
                        // ESS: the question's score from the uploaded summary (none when no summary is uploaded for the period)
                        const essScore = isEssSummary && q.normalized_score !== null && q.normalized_score !== undefined ? q.normalized_score : null;

                        // v2.36.0: no survey data in the selected period -> the question without any score
                        if (isNoData && qType !== 'FREE_TEXT') {
                          return (
                            <div key={q.key || idx} className="p-4 bg-gray-50 rounded-xl border border-gray-200/80 flex items-start justify-between gap-3">
                              <div>
                                <h4 className="font-bold text-sm text-gray-900 leading-snug">{q.label}</h4>
                                <p className="text-xs text-gray-600 mt-0.5">{q.text}</p>
                              </div>
                              <span className="shrink-0 text-[10px] font-bold px-2.5 py-1 bg-gray-200 text-gray-600 rounded-full">No Data</span>
                            </div>
                          );
                        }

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
                                          — {samp.employee_name || 'Anonymous'} ({samp.division})
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

                        // Numeric Scale: SCALE_1_5, SCALE_1_10 or PERCENTAGE (0-100 %, v2.50.0)
                        const isScale10 = qType === 'SCALE_1_10';
                        const isPercent = qType === 'PERCENTAGE';
                        const maxScore = isScale10 ? 10.0 : 5.0;
                        const scoreFormatted = isPercent ? `${(q.avg_score || 0).toFixed(1)}%` : `${(q.avg_score || 0).toFixed(2)} / ${maxScore.toFixed(1)}`;
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
                                      {isEss ? 'ESS score (%)' : (isPercent ? 'Percentage 0 - 100%' : (isScale10 ? 'Scale 1 - 10' : 'Scale 1 - 5'))}
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
                                  {(q.original_texts || []).length > 0 && (
                                    <p className="text-[10.5px] italic text-amber-700 mt-0.5" title="Question text in use when this data was uploaded">
                                      At upload: {q.original_texts.join(' / ')}
                                    </p>
                                  )}
                                </div>
                              </div>

                              <div className="text-right shrink-0">
                                <div className="text-base font-black text-gray-900">
                                  {isEss ? (essScore !== null ? `${essScore}%` : (isEssSummary ? 'No score in the file' : '—')) : scoreFormatted}
                                </div>
                                {!isEss && (
                                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                    isHigh ? 'bg-emerald-100 text-emerald-800' :
                                    isWarning ? 'bg-amber-100 text-amber-800' :
                                    'bg-red-100 text-red-800'
                                  }`}>
                                    {q.normalized_score}% Index
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Progress Bar Visualization (ESS: only when the uploaded summary has a score for this question) */}
                            {(!isEss || essScore !== null) && (
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

              {/* TAB 2 FOR SYSTEM SURVEY: HISTORY = LIST OF RESPONDENTS & SURVEY ANSWERS */}
              {/* v2.56.0: History of every metric except SYSTEM surveys and the old operational records: rows of the Evidence download */}
              {activeTab === 'secondary' && !usesRespondentHistory && !usesOperationalHistory && (
                <MetricHistoryTable
                  history={history}
                  loading={historyLoading}
                  error={historyError}
                  periodLabel={periodLabel}
                  isAdmin={isAdmin}
                  accent={isSurvey ? 'red' : 'blue'}
                />
              )}

              {usesRespondentHistory && activeTab === 'secondary' && detailData.data_not_available && (
                <MetricHistoryTable history={{ kind: 'NOT_AVAILABLE', reason: detailData.not_applicable_reason, rows: [], columns: [] }} periodLabel={periodLabel} />
              )}

              {usesRespondentHistory && !detailData.data_not_available && activeTab === 'secondary' && (
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

                    {/* Download Evidence Button (contains respondent identities: Admin only) */}
                    {isAdmin && <div className="flex items-center space-x-2 shrink-0 w-full md:w-auto justify-end">
                      <a
                        href={`/api/surveys/evidence?metric_id=${detailData.metric_id}&period=${period || 'YTD'}`}
                        download /* name from the server: .csv, or .zip when the rows span several question sets (v2.50.0) */
                        className="px-3.5 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-lg text-xs font-bold flex items-center space-x-2 transition shadow-xs whitespace-nowrap"
                        title="Download all survey responses and records for audit trail evidence"
                      >
                        <Download className="w-4 h-4" />
                        <span>Download Evidence ({filteredResponses.length} Records)</span>
                      </a>
                    </div>}
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
                                  <div className="font-bold text-gray-900">{displayName || <span className="italic font-medium text-gray-400">Identity hidden</span>}</div>
                                  {(displayId || displayEmail) && (
                                    <div className="flex items-center space-x-1.5 text-[10px] text-gray-500 mt-0.5 font-mono">
                                      <span>{displayId}</span>
                                      <span>•</span>
                                      <span className="truncate max-w-[130px]">{displayEmail}</span>
                                    </div>
                                  )}
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
              {isOutcome && !isPartSummary && activeTab === 'primary' && (
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
                          <dd className="font-bold text-[#ED1C24]">{detailData.px_weights ? `${detailData.px_weights.outcome}% ` : ''}Outcome Index Consolidation</dd>
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
                        {detailData.score_tiers && (
                          <div className="p-2.5 bg-white rounded-lg border border-gray-200 space-y-0.5">
                            <div className="flex items-center justify-between">
                              <span className="text-gray-600">Score Tiers ({detailData.score_tiers.unit === 'percent' ? '%' : 'number'}):</span>
                              <span className="font-black text-gray-900">{detailData.score_tiers.bounds ? `Target = ${detailData.target_value_normalized}%` : 'N/A (not configured)'}</span>
                            </div>
                            {detailData.score_tiers.bounds && (
                              <div className="text-[10.5px] text-gray-500">{tierBandsText(detailData.score_tiers.bounds, detailData.score_tiers.unit)}. Score rises in a straight line inside each tier (tier 5 = 100%); Score % = score / 5.</div>
                            )}
                          </div>
                        )}
                        <div className="flex items-center justify-between p-2.5 bg-white rounded-lg border border-gray-200">
                          <span className="text-gray-600">Current Performance Status:</span>
                          <span className={`font-black ${isNoData ? 'text-gray-500' : detailData.status === 'CRITICAL' ? 'text-red-600' : (detailData.status === 'WARNING' ? 'text-amber-600' : 'text-emerald-600')}`}>
                            {isNotApplicable ? `N/A (${(detailData.not_applicable_reason || 'score tiers not configured').toLowerCase()})` : isNoData ? 'NO DATA (no data in this period)' : `${detailData.status} (${detailData.normalized_score}% Index Score)`}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2 FOR OUTCOME WITHOUT STORED MONTHS: HISTORY = THE OPERATIONAL RECORDS OF THE DETAIL */}
              {usesOperationalHistory && activeTab === 'secondary' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    {isSocialMedia ? (
                      <div className="text-xs text-gray-500 font-medium space-y-0.5">
                        <div>Social media statistics (bankwide) from <strong>{detailData.source_of_data}</strong>, {periodLabel}:</div>
                        <div className="text-[10.5px] text-gray-400">
                          Latest data: <strong>{detailData.social_media?.latest_period_label || '—'}</strong> • Follower growth = vs the previous month of the same platform • Engagement rate = engagement / reach
                        </div>
                      </div>
                    ) : (
                    <div className="text-xs text-gray-500 font-medium">
                      Operational transaction data records from <strong>{detailData.source_of_data}</strong>:
                    </div>
                    )}
                    <div className="flex items-center gap-2">
                    {isSocialMedia && isAdmin && (
                      <>
                        <a
                          href="/api/admin/social-media/template"
                          download="Template_Social_Media_Metric_1.xlsx"
                          className="inline-flex items-center space-x-1 px-2 py-1 text-[10.5px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 hover:text-slate-900 border border-slate-200 rounded-md transition shadow-2xs"
                          title="Download the social media template (.xlsx)"
                        >
                          <Download className="w-3 h-3 text-slate-500 shrink-0" />
                          <span>Template</span>
                        </a>
                        <button
                          onClick={() => setIsSocialUploadOpen(true)}
                          className="inline-flex items-center space-x-1 px-2 py-1 text-[10.5px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 hover:text-slate-900 border border-slate-200 rounded-md transition shadow-2xs"
                          title="Upload Instagram / LinkedIn / TikTok data (.xlsx)"
                        >
                          <FileSpreadsheet className="w-3 h-3 text-slate-500 shrink-0" />
                          <span>Upload</span>
                        </button>
                      </>
                    )}
                    <div className="relative w-64">
                      <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-2.5" />
                      <input
                        type="text"
                        placeholder="Search history..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-8 pr-3 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                    </div>
                  </div>

                  {/* Outcome Operational Records Table */}
                  <div className="border border-gray-200 rounded-xl overflow-x-auto shadow-2xs">
                    {isSocialMedia ? (
                      /* Social media statistics per platform per month (v2.52.0) - an "All platforms" line per month while the search is empty */
                      <table className="w-full text-left text-xs">
                        <thead className="bg-gray-100 text-gray-700 font-bold uppercase tracking-wider border-b border-gray-200">
                          <tr>
                            <th className="py-2.5 px-3.5">Platform</th>
                            <th className="py-2.5 px-3.5">Period</th>
                            <th className="py-2.5 px-3.5 text-right">Followers</th>
                            <th className="py-2.5 px-3.5 text-right">Follower growth %</th>
                            <th className="py-2.5 px-3.5 text-right">Reach</th>
                            <th className="py-2.5 px-3.5 text-right">Engagement</th>
                            <th className="py-2.5 px-3.5 text-right">Engagement rate %</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 font-normal bg-white">
                          {filteredOperationalRecords.length === 0 ? (
                            <tr>
                              <td colSpan="7" className="text-center py-8 text-gray-400">
                                {operationalRecords.length === 0 ? 'No social media data for this period' : 'No records match the search.'}
                              </td>
                            </tr>
                          ) : (
                            filteredOperationalRecords.flatMap((item, idx) => {
                              const isLastOfPeriod = idx === filteredOperationalRecords.length - 1 || filteredOperationalRecords[idx + 1].period !== item.period;
                              const total = !searchQuery.trim() && isLastOfPeriod ? socialTotals.find(t => t.period === item.period) : null;
                              const out = [(
                                <tr key={`${item.period}-${item.platform}`} className="hover:bg-blue-50/30 transition">
                                  <td className="py-2.5 px-3.5 font-bold text-gray-900">
                                    {item.platform}
                                    {item.is_dummy && <span className="ml-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-gray-200 text-gray-600" title="Fictional demo data - replaced as soon as real data of this month is uploaded">Dummy</span>}
                                  </td>
                                  <td className="py-2.5 px-3.5 text-gray-700 whitespace-nowrap">{item.period_label}</td>
                                  <td className="py-2.5 px-3.5 text-right font-mono">{fmtCount(item.followers)}</td>
                                  <td className={`py-2.5 px-3.5 text-right font-mono ${item.follower_growth_pct > 0 ? 'text-emerald-700' : item.follower_growth_pct < 0 ? 'text-red-700' : 'text-gray-500'}`}>{fmtPct(item.follower_growth_pct, true)}</td>
                                  <td className="py-2.5 px-3.5 text-right font-mono">{fmtCount(item.reach)}</td>
                                  <td className="py-2.5 px-3.5 text-right font-mono">{fmtCount(item.engagement)}</td>
                                  <td className="py-2.5 px-3.5 text-right font-mono">{fmtPct(item.engagement_rate_pct)}</td>
                                </tr>
                              )];
                              if (total) out.push(
                                <tr key={`${item.period}-total`} className="bg-blue-50/50 font-bold">
                                  <td className="py-2 px-3.5 text-blue-900">All platforms</td>
                                  <td className="py-2 px-3.5 text-blue-900 whitespace-nowrap">{total.period_label}</td>
                                  <td className="py-2 px-3.5 text-right font-mono">{fmtCount(total.followers)}</td>
                                  <td className="py-2 px-3.5 text-right font-mono">{fmtPct(total.follower_growth_pct, true)}</td>
                                  <td className="py-2 px-3.5 text-right font-mono">{fmtCount(total.reach)}</td>
                                  <td className="py-2 px-3.5 text-right font-mono">{fmtCount(total.engagement)}</td>
                                  <td className="py-2 px-3.5 text-right font-mono">{fmtPct(total.engagement_rate_pct)}</td>
                                </tr>
                              );
                              return out;
                            })
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

      {isSocialMedia && isAdmin && (
        <SocialMediaUploadModal
          isOpen={isSocialUploadOpen}
          onClose={() => setIsSocialUploadOpen(false)}
          onUploaded={() => fetchDetail({ keepTab: true })}
        />
      )}
      {isAdmin && isPartSummary && (
        <PartSummaryModal
          isOpen={isPartSummaryOpen}
          metric={detailData}
          period={period || 'YTD'}
          onClose={() => setIsPartSummaryOpen(false)}
          onUploaded={() => { fetchDetail({ keepTab: true }); if (onDataUploaded) onDataUploaded(); }}
        />
      )}
      {isAdmin && detailData?.outcome_upload && (
        <OutcomeUploadModal
          isOpen={isOutcomeUploadOpen}
          metric={detailData}
          onClose={() => setIsOutcomeUploadOpen(false)}
          onUploaded={() => { fetchDetail({ keepTab: true }); if (onDataUploaded) onDataUploaded(); }}
        />
      )}
    </div>
  );
}
