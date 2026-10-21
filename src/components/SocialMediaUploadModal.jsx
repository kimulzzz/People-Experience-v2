import React, { useState, useEffect, useCallback } from 'react';
import { X, Share2, Download, Upload, History, CheckCircle2, AlertCircle, FileSpreadsheet, Loader2 } from 'lucide-react';
import { monthName } from '../utils/months';

// Social media data of metric 1 (v2.52.0, Admin only - every route is under /api/admin, the server answers 403 to a User).
// 1. Template (.xlsx: Platform | Year | Month | Followers | Reach | Engagement), 2. Upload (validated as a whole: any error
// -> nothing stored, every error listed with its row and column), 3. History of uploads and integration batches (with the
// original file of an upload). onUploaded() lets the opener reload its data (e.g. the metric detail).

const SOURCE_LABELS = { UPLOAD: 'Excel upload', INTEGRATION: 'Integration' };
const formatDateTime = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const periodText = (code) => (code ? `${monthName(code.slice(5, 7))} ${code.slice(0, 4)}` : '—');

export default function SocialMediaUploadModal({ isOpen, onClose, onUploaded }) {
  const [activeTab, setActiveTab] = useState('upload'); // 'upload' | 'history'
  const [file, setFile] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState(null);           // success body, or { refused: true, error, errors }
  const [errorMessage, setErrorMessage] = useState('');
  const [history, setHistory] = useState([]);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/social-media/uploads');
      if (res.ok) setHistory(await res.json());
    } catch (_) { /* the list just stays empty */ }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setActiveTab('upload');
      setFile(null);
      setResult(null);
      setErrorMessage('');
      loadHistory();
    }
  }, [isOpen, loadHistory]);

  if (!isOpen) return null;

  const handleUpload = async () => {
    if (!file) { setErrorMessage('Please select the social media Excel file (.xlsx) first.'); return; }
    if (!/\.xlsx$/i.test(file.name)) { setErrorMessage('Only the social media Excel file (.xlsx) is accepted.'); return; }
    setIsProcessing(true);
    setErrorMessage('');
    setResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/admin/social-media/upload', { method: 'POST', body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (Array.isArray(data.errors) && data.errors.length) setResult({ ...data, refused: true });
        throw new Error(data.error || 'Failed to process the file.');
      }
      setResult(data);
      setFile(null);
      loadHistory();
      if (onUploaded) onUploaded(data);
    } catch (err) {
      setErrorMessage(err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-3xl w-full p-6 shadow-2xl space-y-5 my-8">

        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-gray-100">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 bg-blue-100 text-blue-700 rounded-lg flex items-center justify-center">
              <Share2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-[#231F20]">Social Media Data: Template & Excel Upload</h3>
              <p className="text-[11px] text-gray-500 font-medium">
                Instagram, LinkedIn and TikTok followers, reach and engagement per month (bankwide). The metric score is still entered in Admin Parameters.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700" title="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex space-x-2 bg-gray-100 p-1 rounded-xl text-xs font-bold">
          <button
            onClick={() => setActiveTab('upload')}
            className={`flex-1 py-2 rounded-lg flex items-center justify-center space-x-1.5 transition ${activeTab === 'upload' ? 'bg-[#ED1C24] text-white shadow-xs' : 'text-gray-600 hover:text-gray-900'}`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload Social Media Data</span>
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`py-2 px-4 rounded-lg flex items-center justify-center space-x-1.5 transition ${activeTab === 'history' ? 'bg-white text-[#231F20] shadow-xs' : 'text-gray-600 hover:text-gray-900'}`}
          >
            <History className="w-3.5 h-3.5" />
            <span>History ({history.length})</span>
          </button>
        </div>

        {activeTab === 'upload' && (
          <div className="space-y-4 text-xs">
            <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-[11px] text-gray-600 space-y-1">
                <div className="font-bold text-gray-800">1. Download the template</div>
                <div>Columns: <strong>Platform | Year | Month | Followers | Reach | Engagement</strong>. One row per platform per month; month as a name (March, Maret, Mar) or 1-12. A month that is uploaded again is updated.</div>
              </div>
              <a
                href="/api/admin/social-media/template"
                download="Template_Social_Media_Metric_1.xlsx"
                className="inline-flex items-center space-x-1 px-3 py-1.5 text-[11px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-md transition shadow-2xs shrink-0"
              >
                <Download className="w-3.5 h-3.5 text-slate-500" />
                <span>Template</span>
              </a>
            </div>

            <div className="border-2 border-dashed border-gray-300 hover:border-[#ED1C24] bg-gray-50/50 rounded-2xl p-6 text-center space-y-3 transition">
              <Upload className="w-8 h-8 text-gray-400 mx-auto" />
              <label className="text-xs font-bold text-[#ED1C24] hover:underline cursor-pointer">
                <span>2. Click to select the social media file (.xlsx)</span>
                <input
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(e) => { setFile(e.target.files && e.target.files[0] ? e.target.files[0] : null); setResult(null); setErrorMessage(''); }}
                  className="hidden"
                />
              </label>
              <p className="text-[10px] text-gray-400">Excel workbook (.xlsx) only, first sheet, row 1 = column names. Max 5 MB. The whole file is refused when any row is invalid.</p>
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

            {result && result.refused && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-2">
                <span className="text-[11px] font-bold text-red-800 block">Errors ({result.errors.length}) - nothing was stored:</span>
                <div className="max-h-48 overflow-y-auto border border-red-100 rounded-lg bg-white">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-red-50 text-red-800 font-bold">
                      <tr><th className="py-1.5 px-2">Row</th><th className="py-1.5 px-2">Column</th><th className="py-1.5 px-2">Problem</th></tr>
                    </thead>
                    <tbody className="divide-y divide-red-50 text-gray-700">
                      {result.errors.map((er, i) => (
                        <tr key={i}>
                          <td className="py-1.5 px-2 font-mono">{er.row_number ?? '—'}</td>
                          <td className="py-1.5 px-2 font-mono">{er.column ?? '—'}</td>
                          <td className="py-1.5 px-2">{er.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {result && result.success && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center space-x-2 text-emerald-900 font-extrabold text-sm">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  <span>Social media data stored</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  {[['Rows', result.rows_imported], ['New', result.inserted_rows], ['Updated', result.updated_rows], ['Dummy rows replaced', result.replaced_seed_rows]].map(([label, value]) => (
                    <div key={label} className="bg-white p-2 rounded-lg border border-emerald-100 text-center">
                      <span className="text-[10px] text-gray-400 block font-bold">{label}</span>
                      <strong className="text-gray-800 text-sm">{value}</strong>
                    </div>
                  ))}
                </div>
                <div className="text-[11px] text-emerald-900">Periods: <strong>{(result.period_labels || []).join(', ')}</strong></div>
              </div>
            )}

            <div className="flex justify-end">
              <button
                onClick={handleUpload}
                disabled={isProcessing || !file}
                className="px-4 py-2 bg-[#ED1C24] hover:bg-red-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center space-x-1.5 transition"
              >
                {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                <span>{isProcessing ? 'Uploading...' : 'Upload'}</span>
              </button>
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="border border-gray-200 rounded-xl overflow-x-auto max-h-96">
            <table className="w-full text-left text-[11px]">
              <thead className="bg-gray-100 text-gray-700 font-bold uppercase tracking-wider border-b border-gray-200">
                <tr>
                  <th className="py-2 px-3">Date</th>
                  <th className="py-2 px-3">Source</th>
                  <th className="py-2 px-3">By</th>
                  <th className="py-2 px-3">Periods</th>
                  <th className="py-2 px-3 text-center">Rows (new / updated)</th>
                  <th className="py-2 px-3">File</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {history.length === 0 ? (
                  <tr><td colSpan="6" className="text-center py-6 text-gray-400">No uploads yet.</td></tr>
                ) : history.map(h => (
                  <tr key={h.upload_id}>
                    <td className="py-2 px-3 whitespace-nowrap">{formatDateTime(h.uploaded_at)}</td>
                    <td className="py-2 px-3">{SOURCE_LABELS[h.source] || h.source}</td>
                    <td className="py-2 px-3">{h.uploaded_by}</td>
                    <td className="py-2 px-3 whitespace-nowrap">{h.period_from === h.period_to ? periodText(h.period_from) : `${periodText(h.period_from)} - ${periodText(h.period_to)}`}</td>
                    <td className="py-2 px-3 text-center">{h.total_rows} ({h.inserted_rows} / {h.updated_rows}){h.replaced_seed_rows ? `, ${h.replaced_seed_rows} dummy replaced` : ''}</td>
                    <td className="py-2 px-3">
                      {h.has_original_file ? (
                        <a href={`/api/admin/social-media/file/${encodeURIComponent(h.upload_id)}`} download={h.file_name} className="inline-flex items-center space-x-1 text-blue-700 hover:underline font-bold">
                          <FileSpreadsheet className="w-3 h-3" />
                          <span className="truncate max-w-[140px]">{h.file_name}</span>
                        </a>
                      ) : <span className="text-gray-400">{h.file_name || '—'}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
