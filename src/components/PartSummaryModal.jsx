import React, { useState, useEffect, useCallback } from 'react';
import { X, Layers, Download, Upload, FileText, History, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { monthName } from '../utils/months';

// Summary parts of a composite metric (v2.55.0, Admin only - every route is under /api/admin): metric 7 = Meet and Greet /
// Welcome Session / Onboarding Survey Day 1 / Infrastructure & Application, metric 5 and 12 = one part. Per part:
// 1. Template (.xlsx in the part's file layout), 2. Evidence (CSV of the stored rows of the selected period), 3. Upload (the
// summary file; validated as a whole - any error -> nothing stored, every error listed with its row and column; the months
// in the file replace the stored months of that part), and the part's upload history.
// metric = { metric_id, metric_name }; period = the Dashboard period ('YTD' | 'YYYY' | 'YYYY-MM').

const formatDateTime = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const periodText = (code) => (code ? `${monthName(code.slice(5, 7))} ${code.slice(0, 4)}` : '—');

export default function PartSummaryModal({ isOpen, metric, period, onClose, onUploaded }) {
  const [parts, setParts] = useState([]);
  const [partKey, setPartKey] = useState('');
  const [file, setFile] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const metricId = metric ? metric.metric_id : null;

  const loadParts = useCallback(async (keepKey) => {
    if (!metricId) return;
    try {
      const res = await fetch(`/api/admin/metric-parts/${metricId}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to load the parts.');
      setParts(data.parts || []);
      setPartKey(prev => (keepKey && prev ? prev : ((data.parts || [])[0] || {}).part_key || ''));
    } catch (err) {
      setErrorMessage(err.message);
    }
  }, [metricId]);

  useEffect(() => {
    if (isOpen) {
      setParts([]);
      setPartKey('');
      setFile(null);
      setResult(null);
      setErrorMessage('');
      loadParts(false);
    }
  }, [isOpen, loadParts]);

  if (!isOpen || !metric) return null;
  const part = parts.find(p => p.part_key === partKey) || null;
  const base = part ? `/api/admin/metric-parts/${metric.metric_id}/${encodeURIComponent(part.part_key)}` : null;

  const handleUpload = async () => {
    if (!part) return;
    if (!file) { setErrorMessage('Please select the summary Excel file (.xlsx) first.'); return; }
    if (!/\.xlsx$/i.test(file.name)) { setErrorMessage('Only the summary Excel file (.xlsx) is accepted.'); return; }
    setIsProcessing(true);
    setErrorMessage('');
    setResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${base}/upload`, { method: 'POST', body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (Array.isArray(data.errors) && data.errors.length) setResult({ ...data, refused: true });
        throw new Error(data.error || 'Failed to process the file.');
      }
      setResult(data);
      setFile(null);
      loadParts(true);
      if (onUploaded) onUploaded(data);
    } catch (err) {
      setErrorMessage(err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const btn = 'inline-flex items-center space-x-1 px-3 py-1.5 text-[11px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-md transition shadow-2xs shrink-0';

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
      <div className="bg-white rounded-2xl max-w-3xl w-full p-6 shadow-2xl space-y-5 my-8">
        <div className="flex items-center justify-between pb-3 border-b border-gray-100">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 bg-blue-100 text-blue-700 rounded-lg flex items-center justify-center">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-[#231F20]">Summary Upload: Metric {metric.metric_id}</h3>
              <p className="text-[11px] text-gray-500 font-medium">
                {metric.metric_name} • per part the average of its months with a value in the period{parts.length > 1 ? '; the metric = the average of the parts with a value (parts without data are N/A)' : ''}.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700" title="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Part selector */}
        <div className="flex flex-wrap gap-2">
          {parts.map(p => (
            <button
              key={p.part_key}
              onClick={() => { setPartKey(p.part_key); setResult(null); setErrorMessage(''); setFile(null); }}
              className={`px-3 py-1.5 rounded-full text-[11px] font-bold border transition ${p.part_key === partKey ? 'bg-[#ED1C24] text-white border-[#ED1C24]' : 'bg-white text-gray-700 border-gray-300 hover:border-[#ED1C24]'}`}
            >
              {p.part_name}{p.uploads.length === 0 ? ' (no data)' : ''}
            </button>
          ))}
        </div>

        {part && (
          <div className="space-y-4 text-xs">
            <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-[11px] text-gray-600 space-y-1">
                <div className="font-bold text-gray-800">{part.part_name}</div>
                <div>
                  Columns: <strong>Directorate | Level | Year | Month | score ({part.scale === 'PERCENT' ? '0-100%' : '1-5'}) | questions | Jumlah Responden | Periode</strong>.
                  Row "CIMB Niaga" / Bankwide + one row per directorate per month; "-" = no value. The months in the file replace the stored months of this part.
                </div>
              </div>
              <div className="flex space-x-2">
                <a href={`${base}/template`} download={`Template_Metric_${metric.metric_id}_${part.part_key}.xlsx`} className={btn}>
                  <Download className="w-3.5 h-3.5 text-slate-500" />
                  <span>Template</span>
                </a>
                <a href={`${base}/evidence?period=${period || 'YTD'}`} download className={btn} title="Evidence (CSV) of the stored rows of the selected period">
                  <FileText className="w-3.5 h-3.5 text-slate-500" />
                  <span>Evidence</span>
                </a>
              </div>
            </div>

            <div className="border-2 border-dashed border-gray-300 hover:border-[#ED1C24] bg-gray-50/50 rounded-2xl p-6 text-center space-y-3 transition">
              <Upload className="w-8 h-8 text-gray-400 mx-auto" />
              <label className="text-xs font-bold text-[#ED1C24] hover:underline cursor-pointer">
                <span>Click to select the {part.part_name} summary file (.xlsx)</span>
                <input
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(e) => { setFile(e.target.files && e.target.files[0] ? e.target.files[0] : null); setResult(null); setErrorMessage(''); }}
                  className="hidden"
                />
              </label>
              <p className="text-[10px] text-gray-400">Excel workbook (.xlsx), the "Pivot" sheet or the first sheet (a "Raw Data" sheet is never read, the file itself is not kept). Max 5 MB.</p>
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
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-2">
                <div className="flex items-center space-x-2 text-emerald-900 font-extrabold text-sm">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  <span>{result.rows_imported} summary rows stored{result.replaced_rows ? ` (${result.replaced_rows} earlier rows replaced)` : ''}</span>
                </div>
                <div className="text-[11px] text-emerald-900">
                  Bankwide: {(result.bankwide_by_month || []).map(b => `${b.period_label} ${b.value === null ? '-' : b.value}`).join(' • ')}
                </div>
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

            <div className="border border-gray-200 rounded-xl overflow-x-auto max-h-64">
              <div className="px-3 py-2 bg-gray-100 text-[11px] font-bold text-gray-700 flex items-center space-x-1.5">
                <History className="w-3.5 h-3.5" />
                <span>History of {part.part_name} ({part.uploads.length})</span>
              </div>
              <table className="w-full text-left text-[11px]">
                <thead className="bg-gray-50 text-gray-600 font-bold">
                  <tr><th className="py-1.5 px-3">Date</th><th className="py-1.5 px-3">By</th><th className="py-1.5 px-3">Months</th><th className="py-1.5 px-3 text-center">Rows</th><th className="py-1.5 px-3">File</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {part.uploads.length === 0 ? (
                    <tr><td colSpan="5" className="text-center py-4 text-gray-400">No uploads yet - this part is N/A (not counted).</td></tr>
                  ) : part.uploads.map(u => (
                    <tr key={u.upload_id}>
                      <td className="py-1.5 px-3 whitespace-nowrap">{formatDateTime(u.uploaded_at)}</td>
                      <td className="py-1.5 px-3">{u.uploaded_by}</td>
                      <td className="py-1.5 px-3">{(u.periods || []).map(periodText).join(', ')}</td>
                      <td className="py-1.5 px-3 text-center">{u.total_rows}</td>
                      <td className="py-1.5 px-3 text-gray-500" title={u.file_sha256 ? `SHA-256 ${u.file_sha256}` : ''}>{u.file_name || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
