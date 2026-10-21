import React, { useState, useEffect, useCallback } from 'react';
import { Building2, Plus, Edit3, Trash2, GitMerge, Save, Loader2, AlertCircle, CheckCircle2, ChevronDown, ChevronRight, X, History } from 'lucide-react';

// "Directorates" tab of Admin Parameters (v2.51.0, Admin only - the server answers 403 to a User). The directorate master
// with its divisions and how much data references each of them (GET /api/admin/directorates). Add / rename / delete /
// merge directorates and add / rename / delete divisions; a rename or merge changes the name in every table that holds it
// (one transaction on the server) and keeps the former name, which imports keep recognising. Delete is only possible
// when nothing references the directorate / division - otherwise the server answers 409 with the counts and this tab
// offers a merge instead. Renames and merges are confirmed first (rows that change; for a merge the server's preview incl.
// every account whose scope changes). onDirectoryChanged(change) lets the app refresh its directorate lists without a reload.
// Former / alternative names can also be added by hand (e.g. the spelling an ESS file uses) and removed again, for a
// directorate and for a division; imports map them to the directorate / division.

const USAGE_LABELS = {
  survey_responses: 'Survey responses (employee)',
  ess_results: 'ESS results',
  ess_results_pooled: 'ESS results pooled into the target',
  exit_interviews: 'Exit interviews',
  attendances: 'Event attendances',
  user_scopes: 'User data scopes',
  users: 'Legacy user fields',
  operational_records: 'Recruitment SLA rows',
  settings: 'Settings'
};
const usageText = (usage) => Object.entries(usage || {}).filter(([, n]) => n > 0).map(([k, n]) => `${USAGE_LABELS[k] || k}: ${n.toLocaleString('en-US')}`);
const usageTotal = (usage) => Object.values(usage || {}).reduce((a, b) => a + b, 0);
const nameKey = (v) => String(v || '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
const plural = (n, word) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;
const scopeText = (scopes) => (scopes || []).map(s => `${s.directorate}${s.divisions === null ? ' (all divisions)' : ` [${s.divisions.join(', ')}]`}`).join('; ') || '(no scope)';

export default function DirectoryManager({ onDirectoryChanged }) {
  const [list, setList] = useState([]);
  const [maxLength, setMaxLength] = useState(200);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);          // { type, text, details?, mergeId? }
  const [expanded, setExpanded] = useState({});           // directorate_id -> true
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', divisions: '' });
  const [editing, setEditing] = useState(null);           // { kind: 'directorate' | 'division' | 'new-division', id, division?, value }
  const [mergeFor, setMergeFor] = useState(null);         // { id, target_id }
  const [confirm, setConfirm] = useState(null);           // { title, text, lines?, action, label, danger }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/directorates');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to load the directorates.');
      setList(Array.isArray(data.directorates) ? data.directorates : []);
      if (data.max_length) setMaxLength(data.max_length);
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const call = async (url, method, body) => {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Request failed.');
      err.status = res.status;
      err.references = data.references;
      err.divisions_with_data = data.divisions_with_data;
      err.requires_confirmation = data.requires_confirmation === true;
      err.orphan_references = data.orphan_references;
      throw err;
    }
    return data;
  };
  // the division is sent in the body / query string, never in the URL path ("." / ".." would be resolved away)
  const divisionsUrl = (d, division) => `/api/admin/directorates/${d.directorate_id}/divisions${division === undefined ? '' : `?${new URLSearchParams({ division })}`}`;

  // runs one change, shows the result, reloads the list and tells the app (Header / scope pickers refresh)
  // opts.mergeIdOn409: a refused directorate delete offers "Merge into another directorate" for that directorate
  // opts.adopt: the same change again with confirm_adopt (asked when the new name is already carried by unlinked data)
  const run = async (work, successText, change, opts = {}) => {
    setBusy(true);
    setMessage(null);
    let nextConfirm = null;
    try {
      const out = await work();
      const details = out && out.counts ? usageText(out.counts) : [];
      setMessage({ type: 'success', text: typeof successText === 'function' ? successText(out) : successText, details });
      setEditing(null);
      setMergeFor(null);
      await load();
      if (onDirectoryChanged) onDirectoryChanged(typeof change === 'function' ? change(out) : change);
      return out;
    } catch (err) {
      if (err.status === 409 && err.requires_confirmation && opts.adopt) {
        nextConfirm = {
          title: 'Adopt existing data?',
          text: `${err.message} These rows will then belong to this directorate (ESS results of the same period are pooled):`,
          lines: usageText(err.orphan_references),
          label: 'Adopt and save',
          action: opts.adopt
        };
        return null;
      }
      setMessage({
        type: 'error',
        text: err.message,
        details: err.references ? usageText(err.references) : [],
        mergeId: err.status === 409 ? (opts.mergeIdOn409 || null) : null
      });
      return null;
    } finally {
      setBusy(false);
      setConfirm(nextConfirm);
    }
  };

  // a name that is a former name of ANOTHER directorate is handed over to this one (imports map it here from now on)
  const formerOwner = (name, selfId) => list.find(d => d.directorate_id !== selfId && (d.former_names || []).some(f => nameKey(f) === nameKey(name)));
  const formerNameNote = (name, selfId) => {
    const owner = formerOwner(name, selfId);
    return owner ? ` Note: "${name.trim()}" is a former name of "${owner.name}"; imports that still use it land in "${owner.name}" today and will land here instead.` : '';
  };

  const createDirectorate = (name, divisions, confirmAdopt = false) => run(
    () => call('/api/admin/directorates', 'POST', { name, divisions, ...(confirmAdopt ? { confirm_adopt: true } : {}) }),
    out => `Directorate "${out.directorate.name}" added${divisions.length ? ` with ${divisions.length} division${divisions.length === 1 ? '' : 's'}` : ''}${out.adopted_orphans ? ' (existing data adopted)' : ''}.`,
    out => ({ type: 'create', name: out.directorate.name }),
    { adopt: () => createDirectorate(name, divisions, true) }
  ).then(out => { if (out) { setShowAdd(false); setAddForm({ name: '', divisions: '' }); } return out; });

  const handleCreate = (e) => {
    e.preventDefault();
    const divisions = addForm.divisions.split('\n').map(x => x.trim()).filter(Boolean);
    const note = formerNameNote(addForm.name, null);
    if (!note) return createDirectorate(addForm.name, divisions);
    setConfirm({ title: 'Former name of another directorate', text: note.trim(), label: 'Continue', action: () => createDirectorate(addForm.name, divisions) });
  };

  const renameDirectorate = (d, name, confirmAdopt = false) => run(
    () => call(`/api/admin/directorates/${d.directorate_id}`, 'PUT', { name, ...(confirmAdopt ? { confirm_adopt: true } : {}) }),
    out => (out.changed ? `Renamed "${out.from}" to "${out.to}" everywhere.` : 'The name is unchanged.'),
    out => (out.changed ? { type: 'rename', from: out.from, to: out.to } : null),
    { adopt: () => renameDirectorate(d, name, true) }
  );

  // every rename is confirmed first, with the rows it will update (the usage counts of the list)
  const saveEdit = (e) => {
    e.preventDefault();
    const d = list.find(x => x.directorate_id === editing.id);
    if (!d) return;
    const value = editing.value;
    if (editing.kind === 'directorate') {
      if (nameKey(value) === nameKey(d.name) && value.trim() === d.name) { setEditing(null); return; }
      const rows = usageText(d.usage);
      setConfirm({
        title: 'Rename directorate',
        text: `Rename "${d.name}" to "${value.trim()}"? ${rows.length ? `${plural(usageTotal(d.usage), 'row')} that carr${usageTotal(d.usage) === 1 ? 'ies' : 'y'} the name ${usageTotal(d.usage) === 1 ? 'is' : 'are'} updated in one go:` : 'No data carries this name yet.'}`
          + ` "${d.name}" stays recognised as a former name for imports.${formerNameNote(value, d.directorate_id)}`,
        lines: rows,
        label: 'Rename',
        action: () => renameDirectorate(d, value)
      });
    } else if (editing.kind === 'division') {
      const v = d.divisions.find(x => x.name === editing.division);
      const rows = usageText(v && v.usage);
      setConfirm({
        title: 'Rename division',
        text: `Rename division "${editing.division}" of ${d.name} to "${value.trim()}"? ${rows.length ? `${plural(usageTotal(v.usage), 'row')} that carr${usageTotal(v.usage) === 1 ? 'ies' : 'y'} the name ${usageTotal(v.usage) === 1 ? 'is' : 'are'} updated in one go:` : 'No data carries this division yet.'}`,
        lines: rows,
        label: 'Rename',
        action: () => run(
          () => call(divisionsUrl(d), 'PUT', { division: editing.division, name: value }),
          out => (out.changed ? `Division "${out.from}" of ${out.directorate} renamed to "${out.to}" everywhere.` : 'The name is unchanged.'),
          out => (out.changed ? { type: 'rename-division', directorate: out.directorate, from: out.from, to: out.to } : null)
        )
      });
    } else if (editing.kind === 'alias') {
      addAlias(d, value);
    } else if (editing.kind === 'division-alias') {
      if (!editing.division) { setMessage({ type: 'error', text: 'Choose the division the former name belongs to.' }); return; }
      addDivisionAlias(d, editing.division, value);
    } else if (editing.kind === 'new-division') {
      run(
        () => call(divisionsUrl(d), 'POST', { name: value }),
        out => `Division "${out.division}" added to ${out.directorate}.`,
        { type: 'create-division' }
      );
    }
  };

  // former / alternative names added by hand; rows that already carry the name are adopted only after a confirmation
  const addAlias = (d, name, confirmAdopt = false) => run(
    () => call(`/api/admin/directorates/${d.directorate_id}/aliases`, 'POST', { name, ...(confirmAdopt ? { confirm_adopt: true } : {}) }),
    out => `"${out.alias}" is now recognised as a former name of "${out.directorate}"${out.adopted_orphans ? ' (existing data adopted)' : ''}.`,
    out => ({ type: 'alias', directorate: out.directorate, alias: out.alias }),
    { adopt: () => addAlias(d, name, true) }
  );
  const addDivisionAlias = (d, division, name, confirmAdopt = false) => run(
    () => call(`/api/admin/directorates/${d.directorate_id}/divisions/aliases`, 'POST', { division, name, ...(confirmAdopt ? { confirm_adopt: true } : {}) }),
    out => `"${out.alias}" is now recognised as a former name of division "${out.division}" (${out.directorate})${out.adopted_orphans ? ' (existing data adopted)' : ''}.`,
    out => ({ type: 'division-alias', directorate: out.directorate, division: out.division, alias: out.alias }),
    { adopt: () => addDivisionAlias(d, division, name, true) }
  );
  const askRemoveAlias = (d, alias) => setConfirm({
    title: 'Remove former name',
    text: `Stop recognising "${alias}" as a former name of "${d.name}"? Data is not changed. From then on "${alias}" is no longer mapped to "${d.name}": ESS and Exit Interview uploads that use it are refused (unknown directorate), while a survey CSV or an event check-in stores it as it is - as data not linked to any directorate.`,
    label: 'Remove',
    danger: true,
    action: () => run(
      () => call(`/api/admin/directorates/${d.directorate_id}/aliases?${new URLSearchParams({ name: alias })}`, 'DELETE'),
      out => `"${out.alias}" is no longer a former name of "${out.directorate}".`,
      { type: 'alias-remove', directorate: d.name, alias }
    )
  });
  const askRemoveDivisionAlias = (d, a) => setConfirm({
    title: 'Remove former division name',
    text: `Stop recognising "${a.alias_name}" as a former name of division "${a.division_name}" (${d.name})? Data is not changed.`,
    label: 'Remove',
    danger: true,
    action: () => run(
      () => call(`/api/admin/directorates/${d.directorate_id}/divisions/aliases?${new URLSearchParams({ name: a.alias_name })}`, 'DELETE'),
      out => `"${out.alias}" is no longer a former name of division "${out.division}".`,
      { type: 'division-alias-remove', directorate: d.name, alias: a.alias_name }
    )
  });

  const askDelete = (d) => setConfirm({
    title: 'Delete directorate',
    text: `Delete "${d.name}"${d.divisions.length ? ` and its ${d.divisions.length} division${d.divisions.length === 1 ? '' : 's'}` : ''}? This is only possible when no data references it. Its former names are forgotten.`,
    label: 'Delete',
    danger: true,
    action: () => run(
      () => call(`/api/admin/directorates/${d.directorate_id}`, 'DELETE'),
      out => `Directorate "${out.deleted}" deleted.`,
      { type: 'delete', name: d.name },
      { mergeIdOn409: d.directorate_id }
    )
  });

  const askDeleteDivision = (d, v) => setConfirm({
    title: 'Delete division',
    text: `Delete division "${v.name}" of ${d.name}? This is only possible when no data references it.`,
    label: 'Delete',
    danger: true,
    action: () => run(
      () => call(divisionsUrl(d, v.name), 'DELETE'),
      out => `Division "${out.deleted}" of ${out.directorate} deleted.`,
      { type: 'delete-division', directorate: d.name, name: v.name }
    )
  });

  // the merge is confirmed with the server's preview: rows that move, pooled ESS periods, divisions and every login
  // whose data scope changes (an "all divisions" scope of the source becomes "all divisions" of the target)
  const askMerge = async () => {
    const src = list.find(x => x.directorate_id === mergeFor.id);
    const tgt = list.find(x => String(x.directorate_id) === String(mergeFor.target_id));
    if (!src || !tgt) return;
    setBusy(true);
    let p;
    try {
      p = await call(`/api/admin/directorates/${src.directorate_id}/merge-preview?${new URLSearchParams({ target_id: String(tgt.directorate_id) })}`, 'GET');
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
      return;
    } finally {
      setBusy(false);
    }
    const widened = p.accounts.filter(a => a.widened);
    const lines = [
      ...usageText(p.rows).map(t => `Moves ${t}`),
      ...(p.ess_results_pooled ? [`${p.ess_results_pooled} ESS result(s) of a period both have are pooled (participation-weighted)`] : []),
      ...(p.divisions_moved.length ? [`Divisions moved: ${p.divisions_moved.join(', ')}`] : []),
      ...(p.divisions_merged.length ? [`Divisions merged: ${p.divisions_merged.map(m => `${m.from} → ${m.into}`).join(', ')}`] : []),
      ...p.accounts.map(a => `${a.username} (${a.full_name}): ${scopeText(a.before)} → ${scopeText(a.after)}${a.widened ? ` — will now see ALL of "${p.to}"` : ''}`)
    ];
    setConfirm({
      title: 'Merge directorates',
      text: `Move all data and divisions of "${p.from}" into "${p.to}" and remove "${p.from}"? "${p.from}" stays recognised as a former name of "${p.to}". `
        + (p.accounts.length ? `${p.accounts.length} account(s) change their data scope${widened.length ? `; ${widened.length} of them had all of "${p.from}" and will now see ALL of "${p.to}" - review them in Manage Users afterwards` : ''}.` : 'No account has "' + p.from + '" in its data scope.')
        + ' This cannot be undone with one click.',
      lines,
      label: 'Merge',
      danger: true,
      action: () => run(
        () => call(`/api/admin/directorates/${src.directorate_id}/merge`, 'POST', { target_id: tgt.directorate_id }),
        out => `"${out.from}" merged into "${out.to}" (${out.divisions_moved} division${out.divisions_moved === 1 ? '' : 's'} moved, ${out.divisions_merged} merged${out.scope_changes && out.scope_changes.length ? `, ${out.scope_changes.length} account scope(s) updated` : ''}).`,
        out => ({ type: 'merge', from: out.from, to: out.to })
      )
    });
  };

  const inputCls = 'w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-[var(--theme-base)] focus:outline-none';
  const iconBtn = 'p-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-100 text-gray-600 disabled:opacity-50';

  return (
    <div className="bg-white rounded-2xl border border-gray-200 w-full p-6 space-y-4">
      <div className="flex items-center justify-between pb-4 border-b border-gray-100">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-lg bg-[var(--theme-tint-100)] flex items-center justify-center">
            <Building2 className="w-5 h-5 text-[var(--theme-base)]" />
          </div>
          <div>
            <h3 className="text-base font-bold text-gray-900">Directorates</h3>
            <p className="text-[11px] text-gray-500">The directorate master used by the filters, user scopes, imports and check-in &bull; a rename or merge changes the name in all data and keeps the former name recognised for imports</p>
          </div>
        </div>
        <button onClick={() => { setShowAdd(v => !v); setMessage(null); }} className="px-3 py-1.5 text-xs font-bold text-white bg-[var(--theme-base)] hover:bg-[var(--theme-hover)] rounded-lg flex items-center space-x-1.5">
          <Plus className="w-3.5 h-3.5" /><span>Add Directorate</span>
        </button>
      </div>

      {message && (
        <div className={`flex items-start space-x-2 p-3 rounded-lg text-xs font-medium border ${message.type === 'error' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
          {message.type === 'error' ? <AlertCircle className="w-4 h-4 shrink-0" /> : <CheckCircle2 className="w-4 h-4 shrink-0" />}
          <div className="space-y-1">
            <div>{message.text}</div>
            {message.details && message.details.length > 0 && <div className="text-[11px] font-normal">{message.details.join(' • ')}</div>}
            {message.mergeId && (
              <button onClick={() => { setMergeFor({ id: message.mergeId, target_id: '' }); setMessage(null); }} className="mt-1 px-3 py-1.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg inline-flex items-center space-x-1.5">
                <GitMerge className="w-3.5 h-3.5" /><span>Merge into another directorate</span>
              </button>
            )}
          </div>
        </div>
      )}

      {showAdd && (
        <form onSubmit={handleCreate} className="p-4 bg-gray-50 border border-gray-200 rounded-xl grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="md:col-span-2 font-bold text-gray-800">Add New Directorate</div>
          <label className="space-y-1"><span className="font-bold text-gray-600">Directorate name</span>
            <input className={inputCls} value={addForm.name} maxLength={maxLength} onChange={e => setAddForm({ ...addForm, name: e.target.value })} required />
          </label>
          <label className="space-y-1"><span className="font-bold text-gray-600">Divisions <span className="font-normal text-gray-400">(optional, one per line)</span></span>
            <textarea className={`${inputCls} h-20`} value={addForm.divisions} onChange={e => setAddForm({ ...addForm, divisions: e.target.value })} />
          </label>
          <div className="md:col-span-2 flex justify-end space-x-2">
            <button type="button" onClick={() => setShowAdd(false)} className="px-3 py-1.5 font-bold text-gray-700 bg-white border border-gray-300 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button type="submit" disabled={busy} className="px-3 py-1.5 font-bold text-white bg-[var(--theme-base)] hover:bg-[var(--theme-hover)] rounded-lg flex items-center space-x-1.5 disabled:opacity-60">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}<span>Save</span>
            </button>
          </div>
        </form>
      )}

      {loading && list.length === 0 && <div className="text-xs text-gray-500 flex items-center space-x-2"><Loader2 className="w-4 h-4 animate-spin" /><span>Loading ...</span></div>}

      <div className="space-y-2">
        {list.map(d => {
          const open = !!expanded[d.directorate_id];
          const isEditing = editing && editing.id === d.directorate_id;
          return (
            <div key={d.directorate_id} className="border border-gray-200 rounded-xl">
              <div className="flex flex-wrap items-center gap-2 px-4 py-3">
                <button onClick={() => setExpanded(x => ({ ...x, [d.directorate_id]: !open }))} className="p-1 text-gray-500 hover:text-gray-800" aria-label={open ? 'Collapse' : 'Expand'}>
                  {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
                {isEditing && editing.kind === 'directorate' ? (
                  <form onSubmit={saveEdit} className="flex-1 flex items-center gap-2 min-w-[240px]">
                    <input autoFocus className={inputCls} value={editing.value} maxLength={maxLength} onChange={e => setEditing({ ...editing, value: e.target.value })} />
                    <button type="submit" disabled={busy} className="px-3 py-1.5 text-xs font-bold text-white bg-[var(--theme-base)] hover:bg-[var(--theme-hover)] rounded-lg disabled:opacity-60">Rename</button>
                    <button type="button" onClick={() => setEditing(null)} className={iconBtn} aria-label="Cancel"><X className="w-3.5 h-3.5" /></button>
                  </form>
                ) : (
                  <div className="flex-1 min-w-[200px]">
                    <div className="text-sm font-bold text-gray-900">{d.name}</div>
                    <div className="text-[11px] text-gray-500">
                      {d.divisions.length} division{d.divisions.length === 1 ? '' : 's'} &bull; {d.total_references > 0 ? plural(d.total_references, 'data reference') : 'no data yet'}
                      {(d.former_names || []).length > 0 && <span className="ml-1 inline-flex items-center"><History className="w-3 h-3 mr-0.5" />formerly {d.former_names.join(', ')}</span>}
                    </div>
                  </div>
                )}
                {!isEditing && (
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => { setEditing({ kind: 'directorate', id: d.directorate_id, value: d.name }); setMessage(null); }} className={iconBtn} title="Rename"><Edit3 className="w-3.5 h-3.5" /></button>
                    <button onClick={() => { setMergeFor({ id: d.directorate_id, target_id: '' }); setMessage(null); }} className={iconBtn} title="Merge into another directorate"><GitMerge className="w-3.5 h-3.5" /></button>
                    <button onClick={() => askDelete(d)} className={`${iconBtn} text-red-600`} title={d.total_references > 0 ? 'Still referenced by data - merge it instead' : 'Delete'}><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                )}
              </div>

              {mergeFor && mergeFor.id === d.directorate_id && (
                <div className="mx-4 mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs flex flex-wrap items-center gap-2">
                  <GitMerge className="w-4 h-4 text-amber-700" />
                  <span className="font-bold text-amber-900">Merge "{d.name}" into</span>
                  <select className="px-2 py-1.5 text-xs border border-gray-300 rounded-lg" value={mergeFor.target_id} onChange={e => setMergeFor({ ...mergeFor, target_id: e.target.value })}>
                    <option value="">Choose a directorate ...</option>
                    {list.filter(x => x.directorate_id !== d.directorate_id).map(x => <option key={x.directorate_id} value={x.directorate_id}>{x.name}</option>)}
                  </select>
                  <button onClick={askMerge} disabled={!mergeFor.target_id || busy} className="px-3 py-1.5 font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-50">Merge ...</button>
                  <button onClick={() => setMergeFor(null)} className="px-2 py-1.5 font-bold text-gray-600 hover:text-gray-900">Cancel</button>
                </div>
              )}

              {open && (
                <div className="px-4 pb-4 space-y-3 text-xs">
                  <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                    <div className="font-bold text-gray-700 mb-1">Data that references this directorate</div>
                    {usageText(d.usage).length ? (
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-gray-600">{usageText(d.usage).map(t => <span key={t}>{t}</span>)}</div>
                    ) : <div className="text-gray-500">None - this directorate can be deleted.</div>}
                  </div>
                  <div className="p-3 bg-white border border-gray-200 rounded-lg space-y-2">
                    <div>
                      <div className="font-bold text-gray-700">Former / alternative names</div>
                      <div className="text-[11px] text-gray-500">Names that imports (ESS, Exit Interview, survey CSV, check-in) map to this directorate - past renames and spellings used in uploaded files.</div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(d.former_names || []).length === 0 && <span className="text-gray-400">None yet.</span>}
                      {(d.former_names || []).map(f => (
                        <span key={f} className="inline-flex items-center pl-2 pr-1 py-0.5 bg-gray-100 border border-gray-200 rounded-full text-gray-700">
                          {f}
                          <button onClick={() => askRemoveAlias(d, f)} disabled={busy} className="ml-1 p-0.5 rounded-full hover:bg-gray-200 text-gray-500 hover:text-red-600" title="Remove this former name" aria-label={`Remove ${f}`}><X className="w-3 h-3" /></button>
                        </span>
                      ))}
                    </div>
                    {isEditing && editing.kind === 'alias' ? (
                      <form onSubmit={saveEdit} className="flex items-center gap-2">
                        <input autoFocus placeholder="Former or alternative name" className={inputCls} value={editing.value} maxLength={maxLength} onChange={e => setEditing({ ...editing, value: e.target.value })} />
                        <button type="submit" disabled={busy} className="px-3 py-1.5 font-bold text-white bg-[var(--theme-base)] hover:bg-[var(--theme-hover)] rounded-lg disabled:opacity-60 whitespace-nowrap">Add</button>
                        <button type="button" onClick={() => setEditing(null)} className={iconBtn} aria-label="Cancel"><X className="w-3.5 h-3.5" /></button>
                      </form>
                    ) : (
                      <button onClick={() => { setEditing({ kind: 'alias', id: d.directorate_id, value: '' }); setMessage(null); }} className="px-3 py-1.5 font-bold text-[var(--theme-base)] bg-white border border-gray-300 hover:bg-gray-50 rounded-lg flex items-center space-x-1.5">
                        <Plus className="w-3.5 h-3.5" /><span>Add former / alternative name</span>
                      </button>
                    )}
                    {d.divisions.length > 0 && (
                      <div className="pt-2 border-t border-gray-100 space-y-2">
                        <div className="font-bold text-gray-700">Former / alternative division names</div>
                        <div className="flex flex-wrap gap-1.5">
                          {(d.former_division_names || []).length === 0 && <span className="text-gray-400">None yet.</span>}
                          {(d.former_division_names || []).map(a => (
                            <span key={a.alias_name} className="inline-flex items-center pl-2 pr-1 py-0.5 bg-gray-100 border border-gray-200 rounded-full text-gray-700">
                              {a.alias_name} → {a.division_name}
                              <button onClick={() => askRemoveDivisionAlias(d, a)} disabled={busy} className="ml-1 p-0.5 rounded-full hover:bg-gray-200 text-gray-500 hover:text-red-600" title="Remove this former division name" aria-label={`Remove ${a.alias_name}`}><X className="w-3 h-3" /></button>
                            </span>
                          ))}
                        </div>
                        {isEditing && editing.kind === 'division-alias' ? (
                          <form onSubmit={saveEdit} className="flex flex-wrap items-center gap-2">
                            <select className="px-2 py-2 text-xs border border-gray-300 rounded-lg" value={editing.division} onChange={e => setEditing({ ...editing, division: e.target.value })}>
                              <option value="">Division ...</option>
                              {d.divisions.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
                            </select>
                            <input autoFocus placeholder="Former or alternative division name" className={`${inputCls} flex-1 min-w-[180px] w-auto`} value={editing.value} maxLength={maxLength} onChange={e => setEditing({ ...editing, value: e.target.value })} />
                            <button type="submit" disabled={busy} className="px-3 py-1.5 font-bold text-white bg-[var(--theme-base)] hover:bg-[var(--theme-hover)] rounded-lg disabled:opacity-60 whitespace-nowrap">Add</button>
                            <button type="button" onClick={() => setEditing(null)} className={iconBtn} aria-label="Cancel"><X className="w-3.5 h-3.5" /></button>
                          </form>
                        ) : (
                          <button onClick={() => { setEditing({ kind: 'division-alias', id: d.directorate_id, division: '', value: '' }); setMessage(null); }} className="px-3 py-1.5 font-bold text-[var(--theme-base)] bg-white border border-gray-300 hover:bg-gray-50 rounded-lg flex items-center space-x-1.5">
                            <Plus className="w-3.5 h-3.5" /><span>Add former / alternative division name</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <table className="w-full text-left">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wide text-gray-500 border-b border-gray-200">
                        <th className="py-1.5 pr-2">Division</th><th className="py-1.5 pr-2">Data references</th><th className="py-1.5 w-24 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.divisions.length === 0 && <tr><td colSpan={3} className="py-2 text-gray-500">No divisions.</td></tr>}
                      {d.divisions.map(v => {
                        const editingThis = isEditing && editing.kind === 'division' && editing.division === v.name;
                        return (
                          <tr key={v.name} className="border-b border-gray-100 last:border-0">
                            <td className="py-1.5 pr-2">
                              {editingThis ? (
                                <form onSubmit={saveEdit} className="flex items-center gap-2">
                                  <input autoFocus className={inputCls} value={editing.value} maxLength={maxLength} onChange={e => setEditing({ ...editing, value: e.target.value })} />
                                  <button type="submit" disabled={busy} className="px-2.5 py-1.5 font-bold text-white bg-[var(--theme-base)] hover:bg-[var(--theme-hover)] rounded-lg disabled:opacity-60">Rename</button>
                                  <button type="button" onClick={() => setEditing(null)} className={iconBtn} aria-label="Cancel"><X className="w-3.5 h-3.5" /></button>
                                </form>
                              ) : <span className="font-semibold text-gray-800">{v.name}</span>}
                            </td>
                            <td className="py-1.5 pr-2 text-gray-600">{usageText(v.usage).join(' • ') || '—'}</td>
                            <td className="py-1.5 text-right whitespace-nowrap">
                              {!editingThis && (
                                <>
                                  <button onClick={() => { setEditing({ kind: 'division', id: d.directorate_id, division: v.name, value: v.name }); setMessage(null); }} className={`${iconBtn} mr-1`} title="Rename division"><Edit3 className="w-3.5 h-3.5" /></button>
                                  <button onClick={() => askDeleteDivision(d, v)} className={`${iconBtn} text-red-600`} title={v.total_references > 0 ? 'Still referenced by data' : 'Delete division'}><Trash2 className="w-3.5 h-3.5" /></button>
                                </>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {isEditing && editing.kind === 'new-division' ? (
                    <form onSubmit={saveEdit} className="flex items-center gap-2">
                      <input autoFocus placeholder="New division name" className={inputCls} value={editing.value} maxLength={maxLength} onChange={e => setEditing({ ...editing, value: e.target.value })} />
                      <button type="submit" disabled={busy} className="px-3 py-1.5 font-bold text-white bg-[var(--theme-base)] hover:bg-[var(--theme-hover)] rounded-lg disabled:opacity-60 whitespace-nowrap">Add</button>
                      <button type="button" onClick={() => setEditing(null)} className={iconBtn} aria-label="Cancel"><X className="w-3.5 h-3.5" /></button>
                    </form>
                  ) : (
                    <button onClick={() => { setEditing({ kind: 'new-division', id: d.directorate_id, value: '' }); setMessage(null); }} className="px-3 py-1.5 font-bold text-[var(--theme-base)] bg-white border border-gray-300 hover:bg-gray-50 rounded-lg flex items-center space-x-1.5">
                      <Plus className="w-3.5 h-3.5" /><span>Add Division</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {confirm && (
        <div className="fixed inset-0 z-60 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-2xl border border-gray-300">
            <div className={`flex items-center space-x-3 mb-3 ${confirm.danger ? 'text-red-600' : 'text-amber-600'}`}>
              <AlertCircle className="w-6 h-6 shrink-0" />
              <h3 className="text-base font-bold text-gray-900">{confirm.title}</h3>
            </div>
            <p className={`text-xs text-gray-600 leading-relaxed ${confirm.lines && confirm.lines.length ? 'mb-2' : 'mb-5'}`}>{confirm.text}</p>
            {confirm.lines && confirm.lines.length > 0 && (
              <ul className="mb-5 max-h-56 overflow-y-auto list-disc pl-5 space-y-0.5 text-[11px] text-gray-700">
                {confirm.lines.map((l, i) => <li key={i}>{l}</li>)}
              </ul>
            )}
            <div className="flex justify-end space-x-2">
              <button onClick={() => setConfirm(null)} disabled={busy} className="px-4 py-2 text-xs font-bold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg">Cancel</button>
              <button onClick={confirm.action} disabled={busy} className={`px-4 py-2 text-xs font-bold text-white rounded-lg flex items-center space-x-1.5 ${confirm.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'}`}>
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}<span>{confirm.label}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
