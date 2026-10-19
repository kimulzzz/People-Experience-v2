// src/components/ExitInterviewDashboard.jsx
// Exit Interview dashboard (v2.38.0): why employees resign - the two slides of the "exit interview dashboard template"
// deck rebuilt as cards. Data = /api/exit-interview/summary for the Header filters (YTD/MTD + year + month on the
// Effective Resignation Date, directorate / sub-directorate). Aggregates only; the Admin also gets template download,
// upload, CSV export and the upload history.
import React, { useEffect, useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import {
  DoorOpen,
  Download,
  Upload,
  FileSpreadsheet,
  History,
  X,
  AlertCircle,
  CheckCircle2,
  Loader2,
  MessageSquareText,
  Users
} from 'lucide-react';
import { useAuth } from '../utils/AuthContext';
import { fetchWithRetry } from '../utils/fetchWithRetry';

const fmt = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-US'));
const fmtPct = (p) => `${Number(p || 0).toFixed(1)}%`;

// Current values of the theme CSS variables (re-read when the Theme picker changes them on <html>), for the SVG pies.
function useThemeVars() {
  const read = () => {
    const css = getComputedStyle(document.documentElement);
    const v = (name, fallback) => (css.getPropertyValue(name) || '').trim() || fallback;
    return { base: v('--theme-base', '#ED1C24'), deep: v('--theme-deep', '#7A0C14'), rowMid: v('--theme-row-mid', '#EAAFA9') };
  };
  const [vars, setVars] = useState(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setVars(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
    return () => obs.disconnect();
  }, []);
  return vars;
}

// The six career-satisfaction buckets, red (disagree) to theme (agree) - status-like scale, deliberately fixed.
const CAREER_COLORS = ['#7F1D1D', '#B91C1C', '#F87171', '#FCA5A5', 'var(--theme-strong)', 'var(--theme-deep)'];

function Card({ number, title, base, children, footnote }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex flex-col min-w-0">
      <div className="flex items-start gap-3 mb-3">
        <span
          className="flex-shrink-0 w-7 h-7 rounded-full text-white text-xs font-black flex items-center justify-center shadow-sm"
          style={{ backgroundColor: 'var(--theme-base)' }}
        >
          {number}
        </span>
        <div className="min-w-0">
          <h4 className="text-sm font-extrabold text-[#231F20] leading-snug">{title}</h4>
          {base && <p className="text-[11px] text-gray-500 mt-0.5">{base}</p>}
        </div>
      </div>
      <div className="flex-1">{children}</div>
      {footnote && <p className="text-[10px] text-gray-400 mt-3 italic">{footnote}</p>}
    </div>
  );
}

const EmptyState = () => (
  <div className="h-full min-h-[120px] flex items-center justify-center text-xs text-gray-400 font-medium">
    No records in this period
  </div>
);

// Horizontal bar list: label, bar (share of the largest value) and "count | %".
function BarList({ items, base, showPct = true }) {
  if (!base || !items || !items.length) return <EmptyState />;
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <div className="space-y-2">
      {items.map((i) => (
        <div key={i.label}>
          <div className="flex items-baseline justify-between gap-2 text-[11px]">
            <span className="font-semibold text-gray-700 break-words">{i.label}</span>
            <span className="font-bold text-[#231F20] whitespace-nowrap">
              {fmt(i.count)}{showPct ? <span className="text-gray-400 font-medium"> | {fmtPct(i.pct)}</span> : null}
            </span>
          </div>
          <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden mt-0.5">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[var(--theme-strong)] to-[var(--theme-base)]"
              style={{ width: `${(i.count / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function TwoSlicePie({ items, base, colors }) {
  if (!base) return <EmptyState />;
  const data = items.map((i) => ({ name: i.label, value: i.count }));
  return (
    <div className="flex flex-col sm:flex-row items-center gap-4">
      <div className="w-40 h-40 flex-shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={38} outerRadius={70} paddingAngle={1} stroke="#fff" isAnimationActive={false}>
              {data.map((d, idx) => <Cell key={d.name} fill={colors[idx % colors.length]} />)}
            </Pie>
            <Tooltip formatter={(v, n) => [fmt(v), n]} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="space-y-2 w-full">
        {items.map((i, idx) => (
          <div key={i.label} className="flex items-center gap-2 text-xs">
            <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: colors[idx % colors.length] }} />
            <span className="font-bold text-[#231F20]">{i.label}</span>
            <span className="text-gray-600">{fmt(i.count)} | {fmtPct(i.pct)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CareerBar({ career }) {
  if (!career.base) return <EmptyState />;
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-black text-[#231F20]">{career.average.toFixed(2)}</span>
        <span className="text-sm font-bold text-gray-500">/ 6 ({Math.round(career.average_pct)}%)</span>
      </div>
      <div className="flex h-7 rounded-lg overflow-hidden border border-gray-100">
        {career.buckets.map((b, idx) => (b.count > 0 ? (
          <div
            key={b.score}
            title={`${b.label}: ${b.count} | ${fmtPct(b.pct)}`}
            className="h-full flex items-center justify-center text-[10px] font-bold text-white"
            style={{ width: `${b.pct}%`, background: CAREER_COLORS[idx] }}
          >
            {b.pct >= 8 ? `${Math.round(b.pct)}%` : ''}
          </div>
        ) : null))}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1.5">
        {career.buckets.map((b, idx) => (
          <div key={b.score} className="flex items-start gap-1.5 text-[11px] leading-tight">
            <span className="w-2.5 h-2.5 rounded-sm mt-0.5 flex-shrink-0" style={{ background: CAREER_COLORS[idx] }} />
            <span>
              <span className="font-semibold text-gray-700">{b.label}</span>
              <br />
              <span className="text-gray-500">{fmt(b.count)} | {fmtPct(b.pct)}</span>
            </span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-gray-400">
        {fmt(career.base)} responses | 1 = Strongly disagree; 6 = Strongly agree
      </p>
    </div>
  );
}

function InternalThemesTable({ data }) {
  if (!data.negative_base && !data.positive_base) return <EmptyState />;
  const cell = (part, base, highlight) => (
    <td className={`px-3 py-2 text-xs whitespace-nowrap ${highlight ? 'font-black text-[var(--theme-dark)]' : 'text-gray-700'}`}>
      {base ? `${part.count}/${base} (${fmtPct(part.pct)})` : '—'}
    </td>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="bg-gradient-to-r from-[var(--theme-tint-100)] to-[var(--theme-tint-50)]">
            <th className="px-3 py-2 text-[11px] font-extrabold text-gray-700">Theme</th>
            <th className="px-3 py-2 text-[11px] font-extrabold text-gray-700">Career-dissatisfied<br /><span className="font-semibold text-gray-500">N = {fmt(data.negative_base)} records</span></th>
            <th className="px-3 py-2 text-[11px] font-extrabold text-gray-700">Career-satisfied<br /><span className="font-semibold text-gray-500">N = {fmt(data.positive_base)} records</span></th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((i) => (
            <tr key={i.label} className="border-t border-gray-100">
              <td className="px-3 py-2 text-xs font-semibold text-[#231F20]">{i.label}</td>
              {cell(i.negative, data.negative_base, i.negative.pct > i.positive.pct)}
              {cell(i.positive, data.positive_base, i.positive.pct > i.negative.pct)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UploadModal({ onClose, onUploaded }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/exit-interview/upload', { method: 'POST', body: fd });
      const body = await res.json().catch(() => ({ error: `Upload failed (HTTP ${res.status}).` }));
      setResult({ ok: res.ok, ...body });
      if (res.ok) onUploaded();
    } catch (err) {
      setResult({ ok: false, error: 'The server could not be reached. Try again.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-base font-black text-[#231F20] flex items-center gap-2">
            <Upload className="w-4 h-4" style={{ color: 'var(--theme-base)' }} /> Upload Exit Interview Data (.xlsx)
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4 overflow-y-auto">
          <p className="text-xs text-gray-600">
            Use the Termination Report layout of the template (header row with <strong>NIK</strong>) plus a <strong>Directorate</strong> column
            (and optionally <strong>Division</strong>). The file is checked as a whole: if any row is invalid, nothing is stored.
            An exit that already exists (same NIK and Effective Resignation Date) is updated; real data of a month replaces that month's dummy rows.
          </p>
          <input
            type="file"
            accept=".xlsx"
            onChange={(e) => { setFile(e.target.files[0] || null); setResult(null); }}
            className="block w-full text-xs text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-[var(--theme-tint-100)] file:text-[var(--theme-dark)]"
          />
          {result && result.ok && (
            <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-xs text-green-800 flex gap-2">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> <span>{result.message}</span>
            </div>
          )}
          {result && !result.ok && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 space-y-2">
              <div className="flex gap-2 font-bold"><AlertCircle className="w-4 h-4 flex-shrink-0" /> {result.error}</div>
              {Array.isArray(result.errors) && result.errors.length > 0 && (
                <div className="max-h-60 overflow-y-auto bg-white rounded-lg border border-red-100">
                  <table className="w-full text-left">
                    <thead><tr className="bg-red-50"><th className="px-2 py-1">Row</th><th className="px-2 py-1">Column</th><th className="px-2 py-1">Problem</th></tr></thead>
                    <tbody>
                      {result.errors.map((e, idx) => (
                        <tr key={idx} className="border-t border-red-50">
                          <td className="px-2 py-1 whitespace-nowrap">{e.row_number ?? '—'}</td>
                          <td className="px-2 py-1">{e.column || '—'}</td>
                          <td className="px-2 py-1">{e.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-xs font-bold rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50">Close</button>
          <button
            onClick={submit}
            disabled={!file || busy}
            className="px-4 py-2 text-xs font-bold rounded-lg text-white disabled:opacity-50 flex items-center gap-1.5"
            style={{ backgroundColor: 'var(--theme-base)' }}
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Upload
          </button>
        </div>
      </div>
    </div>
  );
}

function UploadHistory({ uploads }) {
  if (!uploads) return <div className="text-xs text-gray-400 p-4">Loading…</div>;
  if (!uploads.length) return <div className="text-xs text-gray-400 p-4">No uploads yet.</div>;
  const sourceLabel = { UPLOAD: 'Upload', TEMPLATE_IMPORT: 'Template import', SEED_DUMMY: 'Dummy (seed)' };
  return (
    <div className="overflow-x-auto max-h-72 overflow-y-auto">
      <table className="w-full text-left text-[11px]">
        <thead className="sticky top-0 bg-gray-50">
          <tr>
            {['Uploaded at', 'File', 'Source', 'Rows', 'New', 'Updated', 'Dummy replaced', 'Period', 'By'].map((h) => (
              <th key={h} className="px-3 py-2 font-extrabold text-gray-600 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {uploads.map((u) => (
            <tr key={u.upload_id} className="border-t border-gray-100">
              <td className="px-3 py-1.5 whitespace-nowrap">{u.uploaded_at ? new Date(u.uploaded_at).toLocaleString('en-GB') : '—'}</td>
              <td className="px-3 py-1.5 break-all">{u.file_name}</td>
              <td className="px-3 py-1.5 whitespace-nowrap">{sourceLabel[u.source] || u.source}</td>
              <td className="px-3 py-1.5">{fmt(u.total_rows)}</td>
              <td className="px-3 py-1.5">{fmt(u.inserted_rows)}</td>
              <td className="px-3 py-1.5">{fmt(u.updated_rows)}</td>
              <td className="px-3 py-1.5">{fmt(u.removed_dummy_rows)}</td>
              <td className="px-3 py-1.5 whitespace-nowrap">{u.period_from || '—'} – {u.period_to || '—'}</td>
              <td className="px-3 py-1.5">{u.uploaded_by}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ExitInterviewDashboard({ filterOptions }) {
  const { isAdmin } = useAuth();
  const theme = useThemeVars();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [showUpload, setShowUpload] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [uploads, setUploads] = useState(null);

  const mode = filterOptions?.mode || 'YTD';
  const params = new URLSearchParams({
    mode,
    year: filterOptions?.year || String(new Date().getFullYear()),
    ...(mode === 'MTD' ? { month: filterOptions?.month || '01' } : {}),
    directorate: filterOptions?.directorate || 'ALL',
    sub_directorate: filterOptions?.sub_directorate || 'ALL'
  }).toString();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchWithRetry(`/api/exit-interview/summary?${params}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        if (!cancelled) setData(body);
      })
      .catch((err) => { if (!cancelled) setError(err.message || 'The exit interview data could not be loaded.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [params, reloadKey]);

  useEffect(() => {
    if (!isAdmin || !showHistory) return;
    setUploads(null);
    fetch('/api/exit-interview/uploads').then((r) => (r.ok ? r.json() : [])).then(setUploads).catch(() => setUploads([]));
  }, [isAdmin, showHistory, reloadKey]);

  const pieColors = [theme.base, theme.rowMid];
  const yesNoColors = [theme.deep, '#D1D5DB'];

  return (
    <div className="space-y-6">
      {/* HERO */}
      <div className="bg-gradient-to-br from-[var(--theme-deep)] via-[var(--theme-strong)] to-[var(--theme-base)] rounded-2xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden">
        <div className="absolute -right-10 -bottom-10 w-72 h-72 bg-black/20 opacity-30 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
          <div className="space-y-2 min-w-0">
            <div className="inline-flex items-center space-x-1.5 px-3 py-1 bg-white/90 text-[var(--theme-dark)] rounded-full text-xs font-semibold">
              <DoorOpen className="w-3.5 h-3.5" style={{ color: 'var(--theme-base)' }} />
              <span>Exit Interview • {data?.scope?.label || (isAdmin ? 'Bankwide' : 'My scope')}</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-black tracking-tight">Voluntary Exits | Exit Interview Summary</h2>
            <p className="text-sm text-red-50 font-medium">{data?.subtitle || (loading ? 'Loading…' : '')}</p>
          </div>
          {data && (
            <div className="grid grid-cols-3 gap-3 text-center">
              {[
                ['Voluntary exits', fmt(data.counts.voluntary_records)],
                ['Company moves', fmt(data.counts.movers)],
                ['All exit records', fmt(data.counts.total_records)]
              ].map(([label, value]) => (
                <div key={label} className="bg-white/10 border border-white/20 rounded-xl px-4 py-2">
                  <div className="text-xl font-black">{value}</div>
                  <div className="text-[10px] uppercase tracking-wide text-red-100 font-semibold">{label}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ADMIN TOOLBAR */}
      {isAdmin && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-extrabold text-gray-700 mr-2 flex items-center gap-1.5">
              <FileSpreadsheet className="w-4 h-4" style={{ color: 'var(--theme-base)' }} /> Exit interview data
            </span>
            <a href="/api/exit-interview/template" className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 flex items-center gap-1.5">
              <Download className="w-3.5 h-3.5" /> Download Template (.xlsx)
            </a>
            <button onClick={() => setShowUpload(true)} className="px-3 py-1.5 text-xs font-bold rounded-lg text-white flex items-center gap-1.5" style={{ backgroundColor: 'var(--theme-base)' }}>
              <Upload className="w-3.5 h-3.5" /> Upload (.xlsx)
            </button>
            <a href={`/api/exit-interview/export?${params}`} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 flex items-center gap-1.5">
              <Download className="w-3.5 h-3.5" /> Export CSV (current filter)
            </a>
            <button onClick={() => setShowHistory((v) => !v)} className={`px-3 py-1.5 text-xs font-bold rounded-lg flex items-center gap-1.5 ${showHistory ? 'bg-[var(--theme-tint-100)] text-[var(--theme-dark)]' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
              <History className="w-3.5 h-3.5" /> Upload history
            </button>
          </div>
          {showHistory && <UploadHistory uploads={uploads} />}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 flex gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center min-h-[300px]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#ED1C24]" />
        </div>
      )}

      {data && (
        <div className={`space-y-6 ${loading ? 'opacity-60 transition-opacity' : ''}`}>
          {/* SLIDE 1 */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            <Card number="1" title="Reasons for resignation" base={`Base: ${fmt(data.reasons.base)} voluntary exit records`} footnote={data.reasons.footnote}>
              <BarList items={data.reasons.items} base={data.reasons.base} />
            </Card>
            <Card number="2" title="Destination industry" base={`Base: ${fmt(data.industry.base)} company-move records`}>
              <TwoSlicePie items={data.industry.items} base={data.industry.base} colors={pieColors} />
            </Card>
            <Card
              number="3"
              title="Top 10 financial-sector destinations"
              base={`Base: ${fmt(data.top_financial.base)} financial-sector records | Standardized legal names`}
              footnote={data.top_financial.unlisted_names_hidden ? 'Only institutions of the standard name list are shown.' : null}
            >
              <BarList items={data.top_financial.items} base={data.top_financial.base} showPct={false} />
            </Card>
            <Card number="4" title="Attractions of the new employer (pull factors)" base={`Base: ${fmt(data.pull_factors.base)} company-move records | records per option`}>
              {data.pull_factors.base > 0 && (
                <div className="mb-3 inline-flex items-baseline gap-1.5 px-3 py-1 rounded-lg bg-[var(--theme-tint-50)] border border-[var(--theme-tint-100)]">
                  <span className="text-lg font-black text-[var(--theme-dark)]">{fmtPct(data.pull_factors.kpi.pct)}</span>
                  <span className="text-[11px] font-semibold text-gray-600">selected compensation</span>
                </div>
              )}
              <BarList items={data.pull_factors.items} base={data.pull_factors.base} />
            </Card>
            <Card number="5" title="Career satisfaction (movers)" base={`Base: ${fmt(data.career.base)} company-move records with career ratings`}>
              <CareerBar career={data.career} />
            </Card>
            <Card number="6" title="Would you recommend CIMB Niaga?" base={`Base: ${fmt(data.recommend.base)} company-move records`}>
              <TwoSlicePie items={data.recommend.items} base={data.recommend.base} colors={yesNoColors} />
            </Card>
          </div>

          {/* SLIDE 2 */}
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-extrabold text-[#231F20]">{data.headline || 'What movers say'}</h3>
              <p className="text-xs text-gray-500">
                Base: {fmt(data.counts.movers)} company-move records | {fmt(data.themes_internal.negative_base)} career-negative vs {fmt(data.themes_internal.positive_base)} career-positive records
              </p>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <Card number="A" title="What the new employer offers: how many employees?" base={`Base: ${fmt(data.themes_open.base)} movers who answered | unique employees per theme; one person may appear in several themes`}>
                <BarList items={data.themes_open.items} base={data.themes_open.base} />
              </Card>
              <Card number="B" title="Internal factors by career satisfaction" base="Movers naming each internal factor: career-dissatisfied (mean rating 1-3) vs career-satisfied (4-6)">
                <InternalThemesTable data={data.themes_internal} />
              </Card>
            </div>
            <p className="text-[10px] text-gray-400 flex items-center gap-1.5">
              <MessageSquareText className="w-3 h-3" /> Answers are grouped into themes with the keyword lists in the settings (rule-based, no AI).
              {!isAdmin && <><Users className="w-3 h-3 ml-2" /> Aggregates of your data scope only.</>}
            </p>
          </div>
        </div>
      )}

      {showUpload && (
        <UploadModal onClose={() => setShowUpload(false)} onUploaded={() => setReloadKey((k) => k + 1)} />
      )}
    </div>
  );
}
