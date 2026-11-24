// src/components/PxCategoriesCard.jsx
// Admin Parameters -> Journey Parameters: the PX Index categories (v2.63.0), px_app_settings.px_index_categories
// = [{ label, min, color }], highest range first. A category reaches up to the lower limit of the one above it; the last one
// always starts at 0. The server validates again (400 otherwise).
import React, { useState, useEffect } from 'react';
import { Award, Plus, Save, Trash2 } from 'lucide-react';

const MAX_CATEGORIES = 10;
const NEW_COLOR = '#475569';
const toRows = list => list.map(c => ({ label: c.label, min: String(c.min), color: c.color }));
const sameList = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export default function PxCategoriesCard({ initial, onSaved, onError }) {
  const [rows, setRows] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (Array.isArray(initial)) setRows(toRows(initial));
  }, [initial]);

  if (!Array.isArray(initial)) return null;

  const value = rows.map((r, i) => ({ label: r.label.trim(), min: i === rows.length - 1 ? 0 : (r.min === '' ? NaN : Number(r.min)), color: r.color.toUpperCase() }));
  const problem = (() => {
    for (let i = 0; i < value.length; i++) {
      const v = value[i];
      if (!v.label) return `Category ${i + 1}: enter a label.`;
      if (!Number.isFinite(v.min) || v.min < 0 || v.min >= 100) return `"${v.label}": the lower limit must be a number from 0 to less than 100.`;
      if (i > 0 && v.min >= value[i - 1].min) return `"${v.label}": the lower limit must be below ${value[i - 1].min}.`;
      if (value.findIndex(x => x.label.toLowerCase() === v.label.toLowerCase()) !== i) return `The label "${v.label}" is used more than once.`;
    }
    return null;
  })();
  const changed = !sameList(value, initial.map(c => ({ label: c.label, min: c.min, color: c.color.toUpperCase() })));

  const setRow = (i, patch) => setRows(prev => prev.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const removeRow = i => setRows(prev => prev.filter((_, k) => k !== i));
  const addRow = () => setRows(prev => [...prev.slice(0, -1), { label: '', min: '', color: NEW_COLOR }, prev[prev.length - 1]]);
  const rangeText = i => {
    const v = value[i];
    if (!Number.isFinite(v.min)) return '—';
    if (i === 0) return `≥ ${v.min} – 100`;
    const above = value[i - 1].min;
    if (!Number.isFinite(above)) return `≥ ${v.min}`;
    return v.min === 0 ? `< ${above}` : `≥ ${v.min} – < ${above}`;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/settings/px_index_categories', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to save the PX Index categories');
      onSaved(data.value);
    } catch (err) {
      onError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const inputClass = 'px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--theme-base)] disabled:bg-gray-100 disabled:text-gray-400';

  return (
    <div className="mb-6 p-5 bg-white border border-white rounded-xl shadow-lg">
      <div className="flex flex-col md:flex-row md:items-end gap-4">
        <div className="flex-1">
          <h3 className="text-sm font-bold text-gray-900 flex items-center space-x-2">
            <Award className="w-4 h-4 text-[var(--theme-base)]" />
            <span>PX Index Categories</span>
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            Label shown next to the PX Index on the Dashboard. Each category starts at its lower limit and ends just below the
            lower limit of the category above it; the last one always starts at 0.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={addRow}
            disabled={rows.length >= MAX_CATEGORIES || saving}
            className="px-3 py-2 text-xs font-bold text-gray-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg flex items-center space-x-1.5 transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Category</span>
          </button>
          <button
            onClick={handleSave}
            disabled={!!problem || !changed || saving}
            className="px-3 py-2 text-xs font-bold text-white bg-[var(--theme-base)] hover:bg-[var(--theme-hover)] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg flex items-center space-x-1.5 shadow-sm transition"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? 'Saving...' : 'Save Categories'}</span>
          </button>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input type="color" value={r.color} onChange={e => setRow(i, { color: e.target.value })} aria-label={`Color of category ${i + 1}`}
              className="w-9 h-9 p-0.5 border border-gray-300 rounded-lg cursor-pointer" />
            <input type="text" maxLength={40} value={r.label} onChange={e => setRow(i, { label: e.target.value })} placeholder="Label"
              aria-label={`Label of category ${i + 1}`} className={`${inputClass} flex-1 min-w-[140px]`} />
            <input type="number" min="0" max="99.99" step="0.01" value={i === rows.length - 1 ? '0' : r.min} disabled={i === rows.length - 1}
              onChange={e => setRow(i, { min: e.target.value })} aria-label={`Lower limit of category ${i + 1}`} className={`${inputClass} w-24`} />
            <span className="w-28 text-xs font-bold text-gray-500">{rangeText(i)}</span>
            <button onClick={() => removeRow(i)} disabled={rows.length <= 2 || saving} title="Remove this category"
              className="p-2 text-red-600 hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg transition">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
      {problem && <p className="text-[11px] text-red-600 font-semibold mt-2">{problem}</p>}
    </div>
  );
}
