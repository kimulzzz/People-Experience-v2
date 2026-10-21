// src/components/DirectoratePxPanel.jsx
// "PX Index by Directorate" (v2.48.0): collapsible list under the Dashboard hero. Loaded from
// GET /api/metrics/by-directorate only while it is open; the server decides which directorates are listed
// (Admin: all, User: only those in their scope). Clicking a directorate sets the global Header filter.
import React, { useState, useEffect } from 'react';
import { Building2, ChevronDown, ChevronUp, ChevronRight } from 'lucide-react';
import { fetchWithRetry } from '../utils/fetchWithRetry';

const BASIS_NOTE = {
  SURVEY_ONLY: 'Survey only',
  OUTCOME_ONLY: 'Outcome only',
  NONE: 'No data'
};

export default function DirectoratePxPanel({ mode = 'YTD', year, month, selectedDirectorate = 'ALL', refreshKey, onSelectDirectorate }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setErrorMsg('');
    const params = new URLSearchParams({ mode, year: year || '', month: month || '01' });
    fetchWithRetry(`/api/metrics/by-directorate?${params.toString()}`)
      .then(async res => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Failed to load the PX Index by directorate');
        if (!cancelled) setRows(Array.isArray(data.directorates) ? data.directorates : []);
      })
      .catch(err => { if (!cancelled) { setRows([]); setErrorMsg(err.message || 'Failed to load the PX Index by directorate'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, mode, year, month, refreshKey]);

  const fmt = v => (v === null || v === undefined ? '—' : v.toFixed(2));

  // v2.51.0: listed alphabetically by directorate name (locale-aware, case-insensitive); v2.52.1: no rank / row number column
  const sortedRows = [...rows].sort((a, b) => String(a.directorate).localeCompare(String(b.directorate), undefined, { sensitivity: 'base' }));

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-[var(--theme-tint-50)] transition text-left"
        aria-expanded={open}
      >
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-[var(--theme-tint-50)] text-[var(--theme-base)] flex items-center justify-center">
            <Building2 className="w-4.5 h-4.5" />
          </div>
          <div>
            <h3 className="text-sm font-extrabold text-[#231F20]">PX Index by Directorate</h3>
            <p className="text-[11px] text-gray-500">
              Same period as above. Click a directorate to filter the whole dashboard on it.
            </p>
          </div>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
      </button>

      {open && (
        <div className="border-t border-gray-100 px-5 py-3">
          {loading && rows.length === 0 && (
            <div className="flex items-center justify-center py-6">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-[var(--theme-base)]" />
            </div>
          )}
          {errorMsg && <p className="text-xs text-red-600 py-2">{errorMsg}</p>}
          {!loading && !errorMsg && rows.length === 0 && (
            <p className="text-xs text-gray-400 py-2">No directorates in your scope.</p>
          )}
          {rows.length > 0 && (
            <div className={`divide-y divide-gray-100 ${loading ? 'opacity-60' : ''}`}>
              {sortedRows.map(r => {
                const isSelected = selectedDirectorate === r.directorate;
                return (
                  <button
                    key={r.directorate}
                    onClick={() => onSelectDirectorate && onSelectDirectorate(r.directorate)}
                    className={`w-full grid grid-cols-12 items-center gap-3 py-2.5 px-2 text-left rounded-lg transition group ${
                      isSelected ? 'bg-[var(--theme-tint-50)]' : 'hover:bg-gray-50'
                    }`}
                    title={`Filter the dashboard on ${r.directorate}`}
                  >
                    <span className="col-span-6 min-w-0">
                      <span className={`block text-xs font-bold truncate ${isSelected ? 'text-[var(--theme-dark)]' : 'text-[#231F20] group-hover:text-[var(--theme-base)]'}`}>
                        {r.directorate}
                      </span>
                      {Array.isArray(r.divisions) && r.divisions.length > 0 && (
                        <span className="block text-[10px] text-gray-400 truncate">Your divisions: {r.divisions.join(', ')}</span>
                      )}
                    </span>
                    <span className="col-span-3">
                      <span className="block w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                        <span
                          className="block h-1.5 rounded-full bg-[var(--theme-base)]"
                          style={{ width: `${Math.min(r.px_index ?? 0, 100)}%` }}
                        />
                      </span>
                      <span className="block text-[10px] text-gray-500 mt-1">
                        Survey {fmt(r.survey_index)} • Outcome {fmt(r.outcome_index)}
                        {BASIS_NOTE[r.px_index_basis] && <span className="text-amber-600 font-semibold"> • {BASIS_NOTE[r.px_index_basis]}</span>}
                      </span>
                    </span>
                    <span className="col-span-3 flex items-center justify-end space-x-1.5">
                      <span className="text-base font-black text-[#231F20]">{fmt(r.px_index)}</span>
                      {r.px_index !== null && <span className="text-[10px] text-gray-400 font-bold">/ 100</span>}
                      <ChevronRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-[var(--theme-base)]" />
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
