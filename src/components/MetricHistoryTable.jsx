import React, { useState, useEffect } from 'react';
import { Search, ChevronLeft, ChevronRight, Lock } from 'lucide-react';

// History tab of the metric detail (v2.56.0, formerly "Internal Transaction Records"): the rows behind the metric's
// Evidence download for the selected period, from GET /api/metrics/:id/history (built by the same server functions as the
// evidence CSV). Newest first (server order), search over every column, PAGE_SIZE rows per page.
const PAGE_SIZE = 50;

const KIND_TEXT = {
  OUTCOME_VALUES: 'Monthly values stored for this metric',
  PARTS: 'Uploaded summary rows of every part',
  ESS: 'Uploaded ESS summary results (every period - the score uses the latest result up to the end of the period)',
  EVENT_ATTENDANCE: 'Signature Program event attendances',
  SURVEY_RESPONSES: 'Survey responses',
  OPERATIONAL: 'Operational records'
};

// ISO timestamps (Uploaded At, Attendance Timestamp) read as local date + time; everything else as stored
const formatCell = v => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  return String(v);
};

export default function MetricHistoryTable({ history, loading, error, periodLabel, isAdmin, accent = 'red' }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  useEffect(() => { setQuery(''); setPage(0); }, [history]);

  if (loading) return <div className="py-10 text-center text-xs text-gray-400">Loading history...</div>;
  if (error) {
    return (
      <div className="py-10 text-center text-xs text-gray-500 flex flex-col items-center gap-2">
        <Lock className="w-5 h-5 text-gray-400" />
        <span>{error}</span>
      </div>
    );
  }
  if (!history) return null;
  if (history.kind === 'NOT_AVAILABLE') {
    return (
      <div className="py-10 text-center text-xs text-gray-500">
        <span className="px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 text-[10px] font-bold mr-1.5">N/A</span>
        {history.reason || 'Real data not available yet'} - no history is shown for this metric.
      </div>
    );
  }

  const columns = (history.columns || []).filter(c => !c.hidden);
  const q = query.trim().toLowerCase();
  const rows = q
    ? history.rows.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(q)))
    : history.rows;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const shown = rows.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);
  const ring = accent === 'blue' ? 'focus:ring-blue-500' : 'focus:ring-[#ED1C24]';
  const isUsed = (c, v) => c.key === 'Used_In_Score' && v === 'YES';

  return (
    <div className="space-y-3">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
        <div className="text-xs text-gray-500 font-medium space-y-0.5">
          <div>{KIND_TEXT[history.kind] || 'Records'}{history.kind === 'ESS' ? '' : ` in ${periodLabel}`} - the same rows as the Evidence download, newest first.</div>
          <div className="text-[10.5px] text-gray-400">
            {history.scope_limited ? 'Only the rows of your own directorates are shown.' : (isAdmin ? 'All directorates (the Evidence download is not narrowed by the directorate filter).' : '')}
            {history.identity_hidden && ['SURVEY_RESPONSES', 'EVENT_ATTENDANCE', 'OPERATIONAL'].includes(history.kind) ? ' Personal identity columns are hidden for your account.' : ''}
          </div>
        </div>
        <div className="relative w-full md:w-64 shrink-0">
          <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search history..."
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(0); }}
            className={`w-full pl-8 pr-3 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 ${ring}`}
          />
        </div>
      </div>

      {/* v2.57.0: a summary part whose questions changed within the period (Summary Questions) */}
      {(history.notes || []).map((n, i) => (
        <div key={i} className="px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-900 font-medium">
          Question set changed: {n}
        </div>
      ))}

      <div className="border border-gray-200 rounded-xl overflow-x-auto shadow-2xs">
        <table className="w-full text-left text-xs">
          <thead className="bg-gray-100 text-gray-700 font-bold uppercase text-[10.5px] border-b border-gray-200">
            <tr>{columns.map(c => <th key={c.key} className="py-2 px-3 whitespace-nowrap">{c.label}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {shown.length === 0 ? (
              <tr>
                <td colSpan={Math.max(columns.length, 1)} className="text-center py-8 text-gray-400">
                  {history.rows.length === 0 ? `No data in ${history.kind === 'ESS' ? 'the stored ESS results' : periodLabel}.` : 'No rows match the search.'}
                </td>
              </tr>
            ) : shown.map((r, i) => {
              const isAverage = r.Period === 'Average';
              return (
                <tr key={current * PAGE_SIZE + i} className={isAverage ? 'bg-blue-50/50 font-bold' : 'hover:bg-gray-50'}>
                  {columns.map(c => (
                    <td key={c.key} className="py-2 px-3 text-gray-700 whitespace-nowrap max-w-[320px] truncate" title={String(r[c.key] ?? '')}>
                      {isUsed(c, r[c.key])
                        ? <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">YES</span>
                        : formatCell(r[c.key])}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-[11px] text-gray-500">
        <span>
          {rows.length === 0 ? 'Showing 0' : `Showing ${current * PAGE_SIZE + 1}-${current * PAGE_SIZE + shown.length} of ${rows.length}`}
          {q && rows.length !== history.total ? ` (filtered from ${history.total})` : ''}
        </span>
        {pages > 1 && (
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(current - 1)} disabled={current === 0} className="p-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-100" title="Newer rows">
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span>Page {current + 1} / {pages}</span>
            <button onClick={() => setPage(current + 1)} disabled={current >= pages - 1} className="p-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-100" title="Older rows">
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
