import React, { useState, useEffect, useCallback } from 'react';
import { ListOrdered, Plus, Trash2, ArrowUp, ArrowDown, Save, RotateCcw, Loader2, AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { metricNo } from '../utils/metricNumber';

// "Summary Questions" tab of Admin Parameters (v2.57.0, Admin only - the server answers 403 to a User). The questions of the
// summary templates of the composite metrics (5, 7 = 4 parts, 12, 19, 20 - the files uploaded per part in Explore Metrics):
// GET /api/admin/part-questions, PUT /api/admin/part-questions/:metric_id/:part_key. The template download uses these questions
// as its question columns, and an upload maps the file's question columns BY POSITION to them (the number must match). Metric 12:
// the questions of ONE event block (the event names come from the uploaded file). Metrics 19 / 20 have no question columns.
// Changing the questions never changes stored data: History / Evidence keep the texts each file was uploaded with.

const KIND_TEXT = {
  QUESTIONS: 'Question columns after the score (column E), in this order.',
  EVENT_BLOCKS: 'Every event block of the file = the event score column (its header is the event name, taken from the file) followed by these questions.',
  SCORE_TABLE: 'This template has no question columns (a combined score table) - there is nothing to configure.'
};
const typeLabel = (type, scale) => (type === 'TEXT' ? 'Text answer (not scored)' : (scale === 'PERCENT' ? 'Scale (0-100%)' : 'Scale (1-5)'));

export default function PartQuestionsManager() {
  const [metrics, setMetrics] = useState([]);
  const [maxText, setMaxText] = useState(500);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null); // { type, text }
  const [selected, setSelected] = useState(null); // 'metricId|partKey'
  const [draft, setDraft] = useState([]);

  const load = useCallback(async (keep) => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/part-questions');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to load the summary questions.');
      const list = Array.isArray(data.metrics) ? data.metrics : [];
      setMetrics(list);
      if (data.max_text) setMaxText(data.max_text);
      const first = list[0] && list[0].parts[0] ? `${list[0].metric_id}|${list[0].parts[0].part_key}` : null;
      setSelected(prev => keep || prev || first);
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const [metricId, partKey] = selected ? selected.split('|') : [null, null];
  const metric = metrics.find(m => String(m.metric_id) === metricId) || null;
  const part = metric ? metric.parts.find(p => p.part_key === partKey) || null : null;

  // the editable copy follows the selected part
  useEffect(() => {
    setDraft(part ? part.questions.map(q => ({ ...q })) : []);
  }, [part]);

  const dirty = part ? JSON.stringify(draft.map(q => [q.key || '', q.text, q.type])) !== JSON.stringify(part.questions.map(q => [q.key, q.text, q.type])) : false;

  const choose = (value) => {
    if (dirty && !window.confirm('Discard the unsaved question changes?')) return;
    setMessage(null);
    setSelected(value);
  };
  const change = (i, field, value) => setDraft(d => d.map((q, j) => (j === i ? { ...q, [field]: value } : q)));
  const move = (i, dir) => setDraft(d => {
    const t = i + dir;
    if (t < 0 || t >= d.length) return d;
    const next = d.slice();
    [next[i], next[t]] = [next[t], next[i]];
    return next;
  });
  const remove = (i) => {
    if (!window.confirm(`Remove question ${i + 1}?`)) return;
    setDraft(d => d.filter((_, j) => j !== i));
  };
  const add = () => setDraft(d => [...d, { key: '', text: '', type: 'SCALE' }]);

  const save = async () => {
    const empty = draft.findIndex(q => !String(q.text || '').trim());
    if (empty >= 0) { setMessage({ type: 'error', text: `Question ${empty + 1}: the question text cannot be empty.` }); return; }
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/part-questions/${metricId}/${encodeURIComponent(partKey)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions: draft.map(q => ({ ...(q.key ? { key: q.key } : {}), text: q.text, type: q.type })) })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to save the questions.');
      setMessage({ type: 'success', text: `${part.part_name}: questions saved (${data.changes}). Download the template again before the next upload.` });
      await load(selected);
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl p-4 shadow-sm space-y-1">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
          <ListOrdered className="w-4 h-4 text-[var(--theme-base)]" />
          Summary Template Questions
        </div>
        <p className="text-xs text-slate-500">
          The questions of the summary files uploaded per part in Explore Metrics (Template / Upload). The template download uses them as its
          question columns and an upload maps the file's question columns to them by position, so the number of question columns must match.
          Changing them never changes stored data: History and Evidence keep the question texts each file was uploaded with. ESS questions stay
          in Manage Questions; the yearly templates of metrics 1 and 3 have no questions.
        </p>
      </div>

      {message && (
        <div className={`px-3 py-2 rounded-lg text-xs font-semibold flex items-start gap-2 ${message.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
          {message.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          <span>{message.text}</span>
        </div>
      )}

      {loading && !metrics.length ? (
        <div className="bg-white rounded-xl p-8 text-center text-xs text-slate-500"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Loading...</div>
      ) : (
        <div className="bg-white rounded-xl p-4 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Template</label>
            <select
              value={selected || ''}
              onChange={(e) => choose(e.target.value)}
              className="flex-1 min-w-[260px] bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-[var(--theme-base)]"
            >
              {metrics.map(m => (
                <optgroup key={m.metric_id} label={`${metricNo(m)} - ${m.metric_name}`}>
                  {m.parts.map(p => (
                    <option key={p.part_key} value={`${m.metric_id}|${p.part_key}`}>
                      {metricNo(m)} - {p.part_name} ({p.kind === 'SCORE_TABLE' ? 'no question columns' : `${p.questions.length} question${p.questions.length === 1 ? '' : 's'}`})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {part && (
            <>
              <div className="text-xs text-slate-600 flex items-start gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div>{KIND_TEXT[part.kind]}</div>
                  {part.kind === 'EVENT_BLOCKS' && part.event_labels.length > 0 && (
                    <div className="text-slate-500">Events in the latest file: {part.event_labels.join(', ')}.</div>
                  )}
                  {part.latest_upload ? (
                    <div className="text-slate-500">
                      Latest upload: {part.latest_upload.file_name || part.latest_upload.upload_id} ({String(part.latest_upload.uploaded_at || '').slice(0, 10)})
                      {part.differs_from_latest_upload ? ' - its questions differ from the configuration below; the next upload must follow the configuration.' : ' - same questions as the configuration.'}
                    </div>
                  ) : part.kind !== 'SCORE_TABLE' && <div className="text-slate-500">No file uploaded for this part yet.</div>}
                </div>
              </div>

              {part.kind !== 'SCORE_TABLE' && (
                <>
                  {draft.length === 0 ? (
                    <div className="text-center py-6 text-xs text-slate-500 border border-dashed border-slate-300 rounded-lg">
                      No questions configured - the template has no question columns. Add the questions of this part's file.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {draft.map((q, i) => (
                        <div key={i} className="flex flex-wrap items-start gap-2 p-2.5 rounded-lg border border-slate-200 bg-slate-50/50">
                          <span className="w-6 h-6 mt-1 rounded-full bg-[var(--theme-tint-50)] text-[var(--theme-base)] text-xs font-black flex items-center justify-center shrink-0">{i + 1}</span>
                          <textarea
                            rows={2}
                            value={q.text}
                            maxLength={maxText}
                            onChange={(e) => change(i, 'text', e.target.value)}
                            placeholder="Question text (as in the column header of the file)"
                            className="flex-1 min-w-[260px] bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-[var(--theme-base)]"
                          />
                          <select
                            value={q.type}
                            onChange={(e) => change(i, 'type', e.target.value)}
                            className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-700"
                            title="Scale = a number on the part's scale; Text = a free-text answer (kept as evidence, never scored)"
                          >
                            <option value="SCALE">{typeLabel('SCALE', part.scale)}</option>
                            <option value="TEXT">{typeLabel('TEXT', part.scale)}</option>
                          </select>
                          <div className="flex items-center gap-0.5">
                            <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30" title="Move up"><ArrowUp className="w-3.5 h-3.5" /></button>
                            <button type="button" onClick={() => move(i, 1)} disabled={i === draft.length - 1} className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30" title="Move down"><ArrowDown className="w-3.5 h-3.5" /></button>
                            <button type="button" onClick={() => remove(i)} className="p-1 text-red-500 hover:text-red-700" title="Remove question"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <button type="button" onClick={add} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-[var(--theme-dark)] bg-[var(--theme-tint-50)] hover:bg-[var(--theme-tint-100)] rounded-lg">
                      <Plus className="w-3.5 h-3.5" /> Add Question
                    </button>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => setDraft(part.questions.map(x => ({ ...x })))} disabled={!dirty || saving}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-40">
                        <RotateCcw className="w-3.5 h-3.5" /> Discard
                      </button>
                      <button type="button" onClick={save} disabled={!dirty || saving}
                        className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-white bg-[var(--theme-base)] hover:bg-[var(--theme-hover)] rounded-lg disabled:opacity-40">
                        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save Questions
                      </button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
