import React, { useState, useEffect } from 'react';
import { 
  X, 
  Download, 
  Upload, 
  FileSpreadsheet, 
  CheckCircle2, 
  AlertCircle, 
  Layers, 
  History, 
  Sparkles,
  ArrowRight,
  RefreshCw,
  HelpCircle,
  FileText
} from 'lucide-react';
import { useAuth } from '../utils/AuthContext';
import { isEssSurveyMetric, surveyTemplateFileName } from '../utils/surveySource';

export default function SurveyImportModal({ 
  isOpen, 
  onClose, 
  preSelectedMetricId = null,
  onImportSuccess 
}) {
  const { isAdmin } = useAuth(); // a PIC (non-Admin) only sees and uploads to their own metrics: the server lists only those
  const [activeTab, setActiveTab] = useState('template'); // 'template' | 'upload' | 'history'
  const [surveyMetrics, setSurveyMetrics] = useState([]);
  const [selectedMetricId, setSelectedMetricId] = useState(preSelectedMetricId ? preSelectedMetricId.toString() : 'ALL');
  
  // Upload State
  const [file, setFile] = useState(null);
  const [csvTextPreview, setCsvTextPreview] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [historyList, setHistoryList] = useState([]);

  useEffect(() => {
    if (isOpen) {
      // Fetch list of survey metrics
      fetch('/api/surveys/metrics')
        .then(res => res.json())
        .then(data => {
          const list = Array.isArray(data) ? data : [];
          setSurveyMetrics(list);
          // no 'ALL' for a PIC: start on the pre-selected metric, else their first one
          if (!isAdmin && !preSelectedMetricId && list.length) setSelectedMetricId(String(list[0].metric_id));
        })
        .catch(err => console.error(err));

      // Fetch upload history
      fetch('/api/surveys/history')
        .then(res => res.json())
        .then(data => setHistoryList(Array.isArray(data) ? data : []))
        .catch(err => console.error(err));

      if (preSelectedMetricId) {
        setSelectedMetricId(preSelectedMetricId.toString());
        setActiveTab('upload');
      } else {
        setSelectedMetricId('ALL');
      }

      setFile(null);
      setUploadResult(null);
      setErrorMessage('');
    }
  }, [isOpen, preSelectedMetricId]);

  if (!isOpen) return null;

  const selectedMetricObj = surveyMetrics.find(m => m.metric_id === parseInt(selectedMetricId));
  // ESS metric (v2.32.0): the ESS summary .xlsx (one row per org unit) instead of per-respondent CSV rows
  const isEss = isEssSurveyMetric(selectedMetricObj);

  const handleDownloadTemplate = () => {
    const url = `/api/surveys/template?metric_id=${selectedMetricId}`;
    const filename = selectedMetricId === 'ALL'
      ? 'Template_Survey_Master_All_Metrics.csv'
      : surveyTemplateFileName(selectedMetricId, isEss);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleFileChange = (e) => {
    const selected = e.target.files[0];
    if (selected) {
      setFile(selected);
      setUploadResult(null);
      setErrorMessage('');
      setCsvTextPreview('');
      // an .xlsx is binary: never read it as text (the file itself is sent)
      if (/\.xlsx$/i.test(selected.name)) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        setCsvTextPreview(event.target.result);
      };
      reader.readAsText(selected);
    }
  };

  const handleUploadSubmit = async () => {
    if (!file && !csvTextPreview) {
      setErrorMessage(isEss ? 'Please select the ESS summary Excel file (.xlsx) first.' : 'Please select a CSV file first.');
      return;
    }
    if (isEss && (!file || !/\.xlsx$/i.test(file.name))) {
      setErrorMessage('ESS metrics accept only the ESS summary Excel file (.xlsx).');
      return;
    }

    setIsProcessing(true);
    setErrorMessage('');
    setUploadResult(null);

    const formData = new FormData();
    if (file) {
      formData.append('csvFile', file);
    } else {
      formData.append('csvText', csvTextPreview);
      formData.append('fileName', 'manual_survey.csv');
    }

    if (selectedMetricId !== 'ALL') {
      formData.append('metric_id', selectedMetricId);
    }

    try {
      const res = await fetch('/api/surveys/upload', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (!res.ok) {
        // an ESS file is refused as a whole: show every error with its row
        if (Array.isArray(data.errors) && data.errors.length) setUploadResult({ ...data, refused: true });
        throw new Error(data.error || 'Failed to process the file');
      }
      
      setUploadResult(data);
      if (onImportSuccess) {
        onImportSuccess(data);
      }
    } catch (err) {
      setErrorMessage(err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-3xl w-full p-6 shadow-2xl space-y-5 my-8">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-gray-100">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 bg-red-100 text-[#ED1C24] rounded-lg flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-[#231F20]">
                Survey Data Center: Template & Bulk CSV Upload
              </h3>
              <p className="text-[11px] text-gray-500 font-medium">
                Download standard CSV templates & upload respondent survey data for automated PX Index calculation.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex space-x-2 bg-gray-100 p-1 rounded-xl text-xs font-bold">
          <button
            onClick={() => setActiveTab('template')}
            className={`flex-1 py-2 rounded-lg flex items-center justify-center space-x-1.5 transition ${
              activeTab === 'template' ? 'bg-white text-[#ED1C24] shadow-xs' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Download className="w-3.5 h-3.5" />
            <span>1. Download CSV Template</span>
          </button>

          <button
            onClick={() => setActiveTab('upload')}
            className={`flex-1 py-2 rounded-lg flex items-center justify-center space-x-1.5 transition ${
              activeTab === 'upload' ? 'bg-[#ED1C24] text-white shadow-xs' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>2. Upload Survey Data</span>
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`py-2 px-4 rounded-lg flex items-center justify-center space-x-1.5 transition ${
              activeTab === 'history' ? 'bg-white text-[#231F20] shadow-xs' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>History ({historyList.length})</span>
          </button>
        </div>

        {/* TAB 1: DOWNLOAD TEMPLATE */}
        {activeTab === 'template' && (
          <div className="space-y-4 text-xs">
            <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 space-y-3">
              <label className="text-gray-700 font-bold block">
                Select Survey Metric:
              </label>
              
              <select
                value={selectedMetricId}
                onChange={(e) => setSelectedMetricId(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-xs font-semibold focus:ring-2 focus:ring-[#ED1C24]"
              >
                {isAdmin && <option value="ALL">🌟 Master Template: All {surveyMetrics.length} Survey Metrics (Complete)</option>}
                {surveyMetrics.map(m => (
                  <option key={m.metric_id} value={m.metric_id}>
                    {m.metric_id} - {m.metric_name} ({m.scale_type})
                  </option>
                ))}
              </select>

              {selectedMetricObj && (
                <div className="bg-white p-3 rounded-lg border border-gray-200 space-y-1 text-[11px] text-gray-600">
                  <div className="flex items-center justify-between font-bold text-gray-800">
                    <span>Target: {selectedMetricObj.target_display}</span>
                    <span>PIC: {selectedMetricObj.experience_owner}</span>
                  </div>
                  <p className="text-gray-500 italic">
                    Data Source: {selectedMetricObj.source_of_data}
                  </p>
                </div>
              )}
            </div>

            {/* Field Specifications */}
            {isEss ? (
              <div className="border border-indigo-200 rounded-xl p-4 bg-white space-y-2">
                <span className="font-bold text-gray-800 block text-xs">
                  ESS Summary Template (.xlsx) Column Specifications:
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
                  <div className="bg-gray-50 p-2 rounded border border-gray-100">
                    <strong className="text-[#ED1C24]">A. Directorate</strong> (Required)
                    <span className="text-gray-500 block">"PT Bank CIMB Niaga Tbk" = Bankwide row; other rows = a directorate of the master</span>
                  </div>
                  <div className="bg-gray-50 p-2 rounded border border-gray-100">
                    <strong className="text-gray-700">B. Level</strong>
                    <span className="text-gray-500 block">Bankwide or Directorate</span>
                  </div>
                  <div className="bg-gray-50 p-2 rounded border border-gray-100">
                    <strong className="text-[#ED1C24]">C. Year / D. Month</strong> (Required)
                    <span className="text-gray-500 block">Same period on every row (e.g. 2025 / November)</span>
                  </div>
                  <div className="bg-gray-50 p-2 rounded border border-gray-100">
                    <strong className="text-[#ED1C24]">E. Participation</strong> (Required)
                    <span className="text-gray-500 block">Number of participants (whole number)</span>
                  </div>
                  <div className="bg-gray-50 p-2 rounded border border-gray-100">
                    <strong className="text-[#ED1C24]">F. Index score</strong> (Required)
                    <span className="text-gray-500 block">The metric score: fraction 0-1 (0.92) or percentage (92)</span>
                  </div>
                  <div className="bg-gray-50 p-2 rounded border border-gray-100">
                    <strong className="text-gray-700">G.. Questions</strong> (Optional)
                    <span className="text-gray-500 block">One column per question (header = question text), same score format</span>
                  </div>
                </div>
                <p className="text-[10px] text-gray-500">
                  One file = one period. Uploading the same period again replaces it. Any invalid row rejects the whole file.
                </p>
              </div>
            ) : (
            <div className="border border-gray-200 rounded-xl p-4 bg-white space-y-2">
              <span className="font-bold text-gray-800 block text-xs">
                CSV Template Column Specifications:
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
                <div className="bg-gray-50 p-2 rounded border border-gray-100">
                  <strong className="text-[#ED1C24]">nip</strong> (Required)
                  <span className="text-gray-500 block">Employee ID / NIP</span>
                </div>
                <div className="bg-gray-50 p-2 rounded border border-gray-100">
                  <strong className="text-gray-700">employee_name</strong>
                  <span className="text-gray-500 block">Full Name</span>
                </div>
                <div className="bg-gray-50 p-2 rounded border border-gray-100">
                  <strong className="text-gray-700">cimb_email</strong>
                  <span className="text-gray-500 block">CIMB Email Address</span>
                </div>
                <div className="bg-gray-50 p-2 rounded border border-gray-100">
                  <strong className="text-[#ED1C24]">metric_id</strong> (Required)
                  <span className="text-gray-500 block">Metric ID (1 - 27)</span>
                </div>
                <div className="bg-gray-50 p-2 rounded border border-gray-100">
                  <strong className="text-[#ED1C24]">rating_score</strong> (Required)
                  <span className="text-gray-500 block">Scale 1.0 - 5.0 or 0-100%</span>
                </div>
                <div className="bg-gray-50 p-2 rounded border border-gray-100">
                  <strong className="text-gray-700">verbatim_feedback</strong>
                  <span className="text-gray-500 block">Comments / Feedback</span>
                </div>
              </div>
              {selectedMetricId === 'ALL' && (
                <p className="text-[10px] text-gray-500">ESS metrics are not part of the master CSV: each ESS metric takes its own ESS summary Excel (.xlsx) template.</p>
              )}
            </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                onClick={handleDownloadTemplate}
                className="px-5 py-2.5 bg-[#ED1C24] hover:bg-[#D91B23] text-white rounded-xl text-xs font-bold transition flex items-center space-x-2 shadow-sm"
              >
                <Download className="w-4 h-4" />
                <span>Download {isEss ? 'ESS Template (.xlsx)' : 'CSV Template'} ({selectedMetricId === 'ALL' ? 'Master Template' : `Metric ${selectedMetricId}`})</span>
              </button>
            </div>
          </div>
        )}

        {/* TAB 2: UPLOAD DATA */}
        {activeTab === 'upload' && (
          <div className="space-y-4 text-xs font-medium">
            
            {/* Target Metric Selector (Optional Override) */}
            <div className="flex items-center space-x-3 bg-gray-50 p-3 rounded-xl border border-gray-200">
              <label className="text-gray-700 font-bold whitespace-nowrap">
                Target Metric:
              </label>
              <select
                value={selectedMetricId}
                onChange={(e) => setSelectedMetricId(e.target.value)}
                className="flex-1 px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs font-semibold focus:ring-2 focus:ring-[#ED1C24]"
              >
                {isAdmin && <option value="ALL">Auto-detect from `metric_id` column inside CSV</option>}
                {surveyMetrics.map(m => (
                  <option key={m.metric_id} value={m.metric_id}>
                    {m.metric_id} - {m.metric_name} ({m.scale_type})
                  </option>
                ))}
              </select>
            </div>

            {/* Drag & Drop / File Input Box */}
            <div className="border-2 border-dashed border-gray-300 hover:border-[#ED1C24] bg-gray-50/50 rounded-2xl p-6 text-center space-y-3 transition">
              <Upload className="w-8 h-8 text-gray-400 mx-auto" />
              <div>
                <label className="text-xs font-bold text-[#ED1C24] hover:underline cursor-pointer">
                  <span>{isEss ? 'Click to select the ESS summary file (.xlsx)' : 'Click to select CSV file'}</span>
                  <input
                    key={isEss ? 'xlsx' : 'csv'}
                    type="file"
                    accept={isEss ? '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : '.csv,text/csv'}
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>
                {!isEss && <span className="text-gray-500"> or drag and drop CSV here</span>}
              </div>
              <p className="text-[10px] text-gray-400">
                {isEss
                  ? 'ESS metrics take only the ESS summary Excel workbook (.xlsx): first sheet, row 1 = header, a Bankwide row and one row per directorate. Max 50MB.'
                  : 'Supported format: Standard UTF-8 CSV (comma or semicolon). Max 50MB.'}
              </p>
              {file && (
                <div className="inline-flex items-center space-x-2 px-3 py-1 bg-white border border-emerald-300 text-emerald-800 rounded-full text-xs font-bold shadow-2xs">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>{file.name} ({(file.size / 1024).toFixed(1)} KB)</span>
                </div>
              )}
            </div>

            {errorMessage && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-[#ED1C24] flex items-center space-x-2 font-medium">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* ESS summary: refused file (every error with its row) */}
            {uploadResult && uploadResult.refused && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-2">
                <span className="text-[11px] font-bold text-red-800 block">Errors ({uploadResult.errors.length}) - nothing was stored:</span>
                <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                  {uploadResult.errors.map((er, i) => (
                    <div key={i} className="bg-white p-2 rounded border border-red-100 text-[11px] text-gray-700">
                      {er.row_number ? <strong className="text-red-700">Row {er.row_number}{er.column ? `, column ${er.column}` : ''}: </strong> : null}
                      {er.reason}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ESS summary: success report */}
            {uploadResult && uploadResult.is_ess_summary && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center space-x-2 text-emerald-900 font-extrabold text-sm">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  <span>ESS summary imported: {uploadResult.period_label}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="bg-white p-2 rounded-lg border border-emerald-100 text-center">
                    <span className="text-[10px] text-gray-400 block font-bold">Period</span>
                    <strong className="text-gray-800 text-sm">{uploadResult.period_label}</strong>
                  </div>
                  <div className="bg-white p-2 rounded-lg border border-emerald-100 text-center">
                    <span className="text-[10px] text-emerald-600 block font-bold">Rows Imported</span>
                    <strong className="text-emerald-700 text-sm">{uploadResult.rows_imported}</strong>
                  </div>
                  <div className="bg-white p-2 rounded-lg border border-emerald-100 text-center">
                    <span className="text-[10px] text-gray-400 block font-bold">Bankwide Index</span>
                    <strong className="text-[#ED1C24] text-sm">{uploadResult.bankwide_index}%</strong>
                  </div>
                </div>
                {uploadResult.replaced_previous && (
                  <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
                    The previous upload of {uploadResult.period_label} was replaced (it stays in the upload history).
                  </p>
                )}
              </div>
            )}

            {/* Upload Success Report */}
            {uploadResult && !uploadResult.refused && !uploadResult.is_ess_summary && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center space-x-2 text-emerald-900 font-extrabold text-sm">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  <span>{uploadResult.calculation || uploadResult.updated_pe_index !== undefined ? 'Upload Successful & PX Index Recalculated!' : 'Upload successful!'}</span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="bg-white p-2 rounded-lg border border-emerald-100 text-center">
                    <span className="text-[10px] text-gray-400 block font-bold">Total Rows</span>
                    <strong className="text-gray-800 text-sm">{uploadResult.total_rows}</strong>
                  </div>
                  <div className="bg-white p-2 rounded-lg border border-emerald-100 text-center">
                    <span className="text-[10px] text-emerald-600 block font-bold">Valid Rows</span>
                    <strong className="text-emerald-700 text-sm">{uploadResult.valid_rows}</strong>
                  </div>
                  <div className="bg-white p-2 rounded-lg border border-emerald-100 text-center">
                    <span className="text-[10px] text-red-500 block font-bold">Invalid Rows</span>
                    <strong className="text-red-600 text-sm">{uploadResult.invalid_rows}</strong>
                  </div>
                </div>

                {/* Affected Metrics Summary */}
                {uploadResult.affected_metrics && uploadResult.affected_metrics.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <span className="text-[11px] font-bold text-gray-700 block">
                      Updated Metrics:
                    </span>
                    <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                      {uploadResult.affected_metrics.map(af => (
                        <div key={af.metric_id} className="flex items-center justify-between bg-white p-2 rounded border border-gray-200 text-[11px]">
                          <div>
                            <span className="font-bold text-gray-800">{af.metric_id} - {af.metric_name}</span>
                            <span className="text-gray-400 block">{af.respondent_count} respondents</span>
                          </div>
                          <div className="text-right">
                            {af.normalized_score !== null && af.normalized_score !== undefined && <span className="font-black text-[#ED1C24] text-xs">{af.normalized_score}%</span>}
                            <span className="text-[10px] text-gray-400 block">Raw: {af.calculated_raw_avg}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-bold text-xs"
              >
                Close
              </button>
              <button
                type="button"
                disabled={isProcessing || (!file && !csvTextPreview) || (!isAdmin && selectedMetricId === 'ALL')}
                onClick={handleUploadSubmit}
                className="px-5 py-2.5 bg-[#ED1C24] hover:bg-[#D91B23] text-white rounded-xl font-bold text-xs shadow-sm flex items-center space-x-2 disabled:opacity-50"
              >
                <Sparkles className="w-4 h-4" />
                <span>{isProcessing ? 'Validating & Recalculating...' : (isEss ? 'Process ESS Summary & Recalculate PX Index' : 'Process CSV & Recalculate PX Index')}</span>
              </button>
            </div>

          </div>
        )}

        {/* TAB 3: UPLOAD HISTORY */}
        {activeTab === 'history' && (
          <div className="space-y-3 text-xs">
            <span className="font-bold text-gray-700 block">
              Survey Upload Audit Logs ({historyList.length})
            </span>

            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {historyList.map((h, idx) => (
                <div key={idx} className="bg-gray-50 p-3 rounded-xl border border-gray-200 flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="flex items-center space-x-2">
                      <FileText className="w-3.5 h-3.5 text-gray-500" />
                      <strong className="text-gray-800">{h.file_name}</strong>
                    </div>
                    <div className="text-[11px] text-gray-500">
                      Processed at {new Date(h.uploaded_at).toLocaleString('en-US')} by {h.uploaded_by}
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-bold text-[10px]">
                      {h.valid_rows} {/^(ess|seed-ess)-/.test(h.upload_id || '') ? 'Summary Rows' : 'Valid Responses'}
                    </span>
                    <span className="text-[10px] text-gray-400 block mt-0.5">
                      Average Score: {h.calculated_avg_score}
                    </span>
                  </div>
                </div>
              ))}

              {historyList.length === 0 && (
                <div className="py-8 text-center text-gray-400 text-xs">
                  No survey uploads recorded yet.
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
