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

export default function SurveyImportModal({ 
  isOpen, 
  onClose, 
  preSelectedMetricId = null,
  onImportSuccess 
}) {
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
        .then(data => setSurveyMetrics(data))
        .catch(err => console.error(err));

      // Fetch upload history
      fetch('/api/surveys/history')
        .then(res => res.json())
        .then(data => setHistoryList(data))
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

  const handleDownloadTemplate = () => {
    const url = `/api/surveys/template?metric_id=${selectedMetricId}`;
    const filename = selectedMetricId === 'ALL'
      ? 'Template_Survey_Master_All_Metrics.csv'
      : `Template_Survey_Metric_${selectedMetricId}.csv`;

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

      const reader = new FileReader();
      reader.onload = (event) => {
        setCsvTextPreview(event.target.result);
      };
      reader.readAsText(selected);
    }
  };

  const handleUploadSubmit = async () => {
    if (!file && !csvTextPreview) {
      setErrorMessage('Please select a CSV file first.');
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
      if (!res.ok) throw new Error(data.error || 'Failed to process CSV file');
      
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

  const selectedMetricObj = surveyMetrics.find(m => m.metric_id === parseInt(selectedMetricId));

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
                <option value="ALL">🌟 Master Template: All 20 Survey Metrics (Complete)</option>
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
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={handleDownloadTemplate}
                className="px-5 py-2.5 bg-[#ED1C24] hover:bg-[#D91B23] text-white rounded-xl text-xs font-bold transition flex items-center space-x-2 shadow-sm"
              >
                <Download className="w-4 h-4" />
                <span>Download CSV Template ({selectedMetricId === 'ALL' ? 'Master Template' : `Metric ${selectedMetricId}`})</span>
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
                <option value="ALL">Auto-detect from `metric_id` column inside CSV</option>
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
                  <span>Click to select CSV file</span>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>
                <span className="text-gray-500"> or drag and drop CSV here</span>
              </div>
              <p className="text-[10px] text-gray-400">
                Supported format: Standard UTF-8 CSV (comma or semicolon). Max 50MB.
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

            {/* Upload Success Report */}
            {uploadResult && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center space-x-2 text-emerald-900 font-extrabold text-sm">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  <span>Upload Successful & PX Index Recalculated!</span>
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
                            <span className="font-black text-[#ED1C24] text-xs">{af.normalized_score}%</span>
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
                disabled={isProcessing || (!file && !csvTextPreview)}
                onClick={handleUploadSubmit}
                className="px-5 py-2.5 bg-[#ED1C24] hover:bg-[#D91B23] text-white rounded-xl font-bold text-xs shadow-sm flex items-center space-x-2 disabled:opacity-50"
              >
                <Sparkles className="w-4 h-4" />
                <span>{isProcessing ? 'Validating & Recalculating...' : 'Process CSV & Recalculate PX Index'}</span>
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
                      {h.valid_rows} Valid Responses
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
