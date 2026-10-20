import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, Users, Plus, Save, KeyRound, Loader2, AlertCircle, CheckCircle2, Copy, Lock, History, Trash2 } from 'lucide-react';

// "Manage Users" (Admin only): accounts that may log in. Directorate / division choices come from the
// directory in SQL Server (/api/directorates). Passwords are never shown except the one-time
// temporary password after creating an account or resetting a password.
// A USER's data scope = any number of directorates; for each one "all divisions" or a ticked subset
// (form shape { directorate, all, divisions[] } <-> API shape { directorate, divisions: null | [..] }).
const EMPTY_FORM = { username: '', full_name: '', email: '', role: 'USER', scopes: [] };

const scopesToForm = (scopes) => (scopes || []).map(s => ({ directorate: s.directorate, all: s.divisions === null, divisions: s.divisions || [] }));
const scopesToApi = (rows) => rows.map(r => ({ directorate: r.directorate, divisions: r.all ? null : r.divisions }));

// One-line summary of a scope list for the user table.
const ScopeSummary = ({ scopes }) => (
  <div className="space-y-0.5">
    {(scopes || []).map(s => (
      <div key={s.directorate}>
        <span className="font-semibold text-gray-800">{s.directorate}</span>
        <span className="text-[10px] text-gray-500"> {s.divisions === null ? '(all divisions)' : `(${s.divisions.length} ${s.divisions.length === 1 ? 'division' : 'divisions'}: ${s.divisions.join(', ')})`}</span>
      </div>
    ))}
  </div>
);

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('en-US') : '-');

// embedded (v2.42.0): rendered as a tab inside Admin Parameters - no overlay, no own close button
export default function UserManagementModal({ isOpen, onClose, currentUserId, embedded = false }) {
  const [users, setUsers] = useState([]);
  const [directory, setDirectory] = useState([]);
  const [audit, setAudit] = useState([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null); // null = creating
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null); // { type, text }
  const [tempPassword, setTempPassword] = useState(null); // { username, password }
  const [showAudit, setShowAudit] = useState(false);
  // v2.43.0: entries of test-run accounts (regression suite / QC) are hidden unless asked for; a ref so load() keeps the choice
  const [includeTestAudit, setIncludeTestAudit] = useState(false);
  const includeTestRef = useRef(false);
  const auditUrl = () => `/api/admin/audit-log?limit=100${includeTestRef.current ? '&include_test=1' : ''}`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [uRes, dRes, aRes] = await Promise.all([
        fetch('/api/admin/users'), fetch('/api/directorates'), fetch(auditUrl())
      ]);
      if (uRes.ok) setUsers(await uRes.json());
      if (dRes.ok) setDirectory(await dRes.json());
      if (aRes.ok) setAudit(await aRes.json());
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to load user data.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setMessage(null);
    setTempPassword(null);
    setShowForm(false);
    load();
  }, [isOpen, load]);

  const toggleTestAudit = async () => {
    includeTestRef.current = !includeTestRef.current;
    setIncludeTestAudit(includeTestRef.current);
    try {
      const res = await fetch(auditUrl());
      if (res.ok) setAudit(await res.json());
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to load the audit trail.' });
    }
  };

  if (!isOpen) return null;

  const divisionsOf = (dirName) => (directory.find(d => d.name === dirName) || { divisions: [] }).divisions;
  const unusedDirectorates = directory.filter(d => !form.scopes.some(r => r.directorate === d.name));
  const setScope = (dirName, patch) => setForm({ ...form, scopes: form.scopes.map(r => (r.directorate === dirName ? { ...r, ...patch } : r)) });
  const addScope = (dirName) => { if (dirName) setForm({ ...form, scopes: [...form.scopes, { directorate: dirName, all: true, divisions: [] }] }); };
  const removeScope = (dirName) => setForm({ ...form, scopes: form.scopes.filter(r => r.directorate !== dirName) });
  const toggleDivision = (row, div) => setScope(row.directorate, { divisions: row.divisions.includes(div) ? row.divisions.filter(v => v !== div) : [...row.divisions, div] });
  const inputCls = 'w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-[var(--theme-base)] focus:outline-none disabled:bg-gray-100 disabled:text-gray-500';

  const openCreate = () => { setEditingId(null); setForm(EMPTY_FORM); setShowForm(true); setMessage(null); };
  const openEdit = (u) => {
    setEditingId(u.user_id);
    setForm({ username: u.username, full_name: u.full_name, email: u.email || '', role: u.role, scopes: scopesToForm(u.scopes) });
    setShowForm(true);
    setMessage(null);
  };

  const call = async (url, method, body) => {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed.');
    return data;
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const payload = { full_name: form.full_name, email: form.email, role: form.role };
      if (form.role === 'USER') {
        if (form.scopes.length === 0) throw new Error('A User must have at least one directorate in their data scope.');
        const empty = form.scopes.find(r => !r.all && r.divisions.length === 0);
        if (empty) throw new Error(`Select at least one division for ${empty.directorate}, or choose "All divisions".`);
        payload.scopes = scopesToApi(form.scopes);
      } else {
        payload.scopes = [];
      }
      if (editingId === null) {
        const data = await call('/api/admin/users', 'POST', { ...payload, username: form.username });
        setTempPassword({ username: data.user.username, password: data.temporary_password, isDefault: !!data.is_default_password });
        setMessage({ type: 'success', text: `Account ${data.user.username} created.` });
      } else {
        await call(`/api/admin/users/${editingId}`, 'PUT', payload);
        setMessage({ type: 'success', text: 'Changes saved.' });
      }
      setShowForm(false);
      await load();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (u) => {
    setMessage(null);
    try {
      await call(`/api/admin/users/${u.user_id}`, 'PUT', { is_active: !u.is_active });
      await load();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  const resetPassword = async (u) => {
    if (!window.confirm(`Reset the password of ${u.username}? The old password will no longer work and this user's login session will be ended.`)) return;
    setMessage(null);
    try {
      const data = await call(`/api/admin/users/${u.user_id}/reset-password`, 'POST');
      setTempPassword({ username: u.username, password: data.temporary_password, isDefault: !!data.is_default_password });
      await load();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  const isLocked = (u) => u.locked_until && new Date(u.locked_until).getTime() > Date.now();

  return (
    <div className={embedded ? '' : 'fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto'}>
      <div className={embedded ? 'bg-white rounded-2xl border border-gray-200 w-full p-6 space-y-4' : 'bg-white rounded-2xl max-w-5xl w-full p-6 shadow-2xl space-y-4 my-8'}>

        <div className="flex items-center justify-between pb-4 border-b border-gray-100">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-[var(--theme-tint-100)] flex items-center justify-center">
              <Users className="w-5 h-5 text-[var(--theme-base)]" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">Manage Users</h3>
              <p className="text-[11px] text-gray-500">Accounts that can sign in to the application &bull; Admin sees everything, User is limited to the data scope you set</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button onClick={() => setShowAudit(v => !v)} className="px-3 py-1.5 text-xs font-bold text-gray-700 bg-white hover:bg-gray-100 border border-gray-300 rounded-lg flex items-center space-x-1.5">
              <History className="w-3.5 h-3.5" /><span>Audit Trail</span>
            </button>
            <button onClick={openCreate} className="px-3 py-1.5 text-xs font-bold text-white bg-[var(--theme-base)] hover:bg-[var(--theme-hover)] rounded-lg flex items-center space-x-1.5">
              <Plus className="w-3.5 h-3.5" /><span>Add User</span>
            </button>
            {!embedded && <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500" aria-label="Close"><X className="w-5 h-5" /></button>}
          </div>
        </div>

        {message && (
          <div className={`flex items-start space-x-2 p-3 rounded-lg text-xs font-medium border ${message.type === 'error' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
            {message.type === 'error' ? <AlertCircle className="w-4 h-4 shrink-0" /> : <CheckCircle2 className="w-4 h-4 shrink-0" />}
            <span>{message.text}</span>
          </div>
        )}

        {tempPassword && (
          <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl text-xs space-y-2">
            <div className="font-bold text-amber-900 flex items-center space-x-1.5"><KeyRound className="w-4 h-4" /><span>Temporary password for {tempPassword.username}</span></div>
            <div className="flex items-center space-x-2">
              <code className="px-3 py-1.5 bg-white border border-amber-300 rounded-lg font-mono text-sm font-bold tracking-wider select-all">{tempPassword.password}</code>
              <button onClick={() => navigator.clipboard && navigator.clipboard.writeText(tempPassword.password)} className="p-1.5 bg-white border border-amber-300 rounded-lg hover:bg-amber-100" title="Copy"><Copy className="w-4 h-4" /></button>
            </div>
            {tempPassword.isDefault && <p className="text-amber-900 font-semibold">Standard initial password — must be changed at first login.</p>}
            <p className="text-amber-800">This password is shown only ONCE. Pass it on to the account owner; they must change it at first login.</p>
            <button onClick={() => setTempPassword(null)} className="text-[11px] font-bold text-amber-900 underline">I have noted it, close</button>
          </div>
        )}

        {showForm && (
          <form onSubmit={handleSave} className="p-4 bg-gray-50 border border-gray-200 rounded-xl grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div className="md:col-span-3 font-bold text-gray-800">{editingId === null ? 'Add New User' : `Edit User: ${form.username}`}</div>
            <label className="space-y-1"><span className="font-bold text-gray-600">Username / NIP</span>
              <input className={inputCls} value={form.username} disabled={editingId !== null} onChange={e => setForm({ ...form, username: e.target.value })} required />
            </label>
            <label className="space-y-1"><span className="font-bold text-gray-600">Full Name</span>
              <input className={inputCls} value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} required />
            </label>
            <label className="space-y-1"><span className="font-bold text-gray-600">Email</span>
              <input className={inputCls} type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
              {form.role === 'USER' && !form.email.trim() && (
                <span className="block text-[10.5px] text-amber-700">Recommended: the account becomes the PIC of a metric when its email matches that metric's PIC Email (Admin Parameters).</span>
              )}
            </label>
            <label className="space-y-1"><span className="font-bold text-gray-600">Role</span>
              <select className={inputCls} value={form.role} onChange={e => setForm({ ...form, role: e.target.value, scopes: e.target.value === 'USER' ? form.scopes : [] })}>
                <option value="USER">User (sees data within their scope)</option>
                <option value="ADMIN">Admin (full access)</option>
              </select>
            </label>
            <div className="md:col-span-3 space-y-2">
              <div className="font-bold text-gray-600">Data Scope {form.role !== 'USER' && <span className="font-normal text-gray-400">(Admin reads all data, no scope)</span>}</div>
              {form.role === 'USER' && (
                <>
                  {form.scopes.length === 0 && <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg">No directorate yet. Add at least one directorate.</div>}
                  {form.scopes.map(row => (
                    <div key={row.directorate} className="p-3 bg-white border border-gray-200 rounded-lg space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-gray-900">{row.directorate}</span>
                        <button type="button" onClick={() => removeScope(row.directorate)} className="p-1 text-red-600 hover:bg-red-50 rounded-md" title="Remove directorate from scope"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                      <div className="flex items-center space-x-4">
                        <label className="flex items-center space-x-1.5 cursor-pointer"><input type="radio" checked={row.all} onChange={() => setScope(row.directorate, { all: true })} /><span>All divisions</span></label>
                        <label className="flex items-center space-x-1.5 cursor-pointer"><input type="radio" checked={!row.all} onChange={() => setScope(row.directorate, { all: false })} /><span>Specific divisions</span></label>
                      </div>
                      {!row.all && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1 max-h-40 overflow-y-auto p-2 bg-gray-50 rounded-md">
                          {divisionsOf(row.directorate).map(v => (
                            <label key={v} className="flex items-center space-x-1.5 cursor-pointer"><input type="checkbox" checked={row.divisions.includes(v)} onChange={() => toggleDivision(row, v)} /><span>{v}</span></label>
                          ))}
                          {divisionsOf(row.directorate).length === 0 && <span className="text-gray-400">This directorate has no divisions yet.</span>}
                        </div>
                      )}
                    </div>
                  ))}
                  <select className={inputCls} value="" onChange={e => addScope(e.target.value)} disabled={unusedDirectorates.length === 0}>
                    <option value="">{unusedDirectorates.length === 0 ? '(all directorates have been added)' : '+ Add directorate to scope ...'}</option>
                    {unusedDirectorates.map(d => <option key={d.name} value={d.name}>{d.name}</option>)}
                  </select>
                </>
              )}
            </div>
            <div className="md:col-span-3 flex items-center justify-end space-x-2">
              <button type="button" onClick={() => setShowForm(false)} className="px-3 py-1.5 font-bold text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button type="submit" disabled={saving} className="px-4 py-1.5 font-bold text-white bg-[var(--theme-base)] hover:bg-[var(--theme-hover)] rounded-lg flex items-center space-x-1.5 disabled:opacity-60">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}<span>{editingId === null ? 'Create Account' : 'Save'}</span>
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-10 text-gray-500 text-xs"><Loader2 className="w-4 h-4 animate-spin mr-2" />Loading...</div>
        ) : (
          <div className="border border-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-500 uppercase text-[10px]">
                <tr>
                  <th className="text-left px-3 py-2">User</th>
                  <th className="text-left px-3 py-2">Role</th>
                  <th className="text-left px-3 py-2">Data Scope</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2">Last Login</th>
                  <th className="text-right px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {users.map(u => (
                  <tr key={u.user_id} className={u.is_active ? '' : 'bg-gray-50 text-gray-400'}>
                    <td className="px-3 py-2"><div className="font-bold text-gray-900">{u.full_name}</div><div className="font-mono text-[10px] text-gray-500">{u.username}{u.email ? ` • ${u.email}` : ''}</div>
                      {(u.pic_metrics || []).length > 0 && (
                        <div className={`text-[10px] mt-0.5 ${u.is_active ? 'text-slate-600' : 'text-gray-400'}`} title="Assigned via the PIC Email in Admin Parameters">
                          <b>Metric PIC:</b> {u.pic_metrics.map(m => `${m.metric_id} - ${m.metric_name}`).join('; ')}{!u.is_active && <span className="italic"> (inactive - not in effect)</span>}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${u.role === 'ADMIN' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'}`}>{u.role}</span></td>
                    <td className="px-3 py-2">{u.role === 'ADMIN' ? <span className="text-gray-400 italic">All (unrestricted)</span> : <ScopeSummary scopes={u.scopes} />}</td>
                    <td className="px-3 py-2 space-y-0.5">
                      <div className={u.is_active ? 'text-emerald-700 font-bold' : 'text-gray-400 font-bold'}>{u.is_active ? 'Active' : 'Inactive'}</div>
                      {isLocked(u) && <div className="text-amber-700 font-bold flex items-center space-x-1"><Lock className="w-3 h-3" /><span>Locked until {fmtDate(u.locked_until)}</span></div>}
                      {u.must_change_password && <div className="text-[10px] text-amber-700">Password not changed yet</div>}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{fmtDate(u.last_login_at)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap space-x-1">
                      <button onClick={() => openEdit(u)} className="px-2 py-1 font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md">Edit</button>
                      {u.user_id !== currentUserId && (
                        <>
                          <button onClick={() => resetPassword(u)} className="px-2 py-1 font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md">Reset Password</button>
                          <button onClick={() => toggleActive(u)} className={`px-2 py-1 font-bold rounded-md ${u.is_active ? 'text-red-700 bg-red-50 hover:bg-red-100' : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'}`}>{u.is_active ? 'Deactivate' : 'Activate'}</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {users.length === 0 && <tr><td colSpan="6" className="text-center py-8 text-gray-400">No users yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {showAudit && (
          <label className="flex items-center space-x-1.5 text-[11px] text-gray-600 w-fit cursor-pointer">
            <input type="checkbox" checked={includeTestAudit} onChange={toggleTestAudit} className="accent-[var(--theme-base)]" />
            <span>Show test-run entries</span>
          </label>
        )}
        {showAudit && (
          <div className="border border-gray-200 rounded-xl overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-[11px]">
              <thead className="bg-gray-50 text-gray-500 uppercase text-[10px] sticky top-0"><tr>
                <th className="text-left px-3 py-1.5">Time</th><th className="text-left px-3 py-1.5">User</th><th className="text-left px-3 py-1.5">Action</th><th className="text-left px-3 py-1.5">Target</th><th className="text-left px-3 py-1.5">IP</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {audit.map(a => (
                  <tr key={a.audit_id}><td className="px-3 py-1 font-mono">{fmtDate(a.occurred_at)}</td><td className="px-3 py-1">{a.username || '-'}{a.is_test && <span className="ml-1.5 px-1 py-px text-[9px] font-bold text-gray-500 bg-gray-100 border border-gray-200 rounded">TEST</span>}</td><td className="px-3 py-1 font-bold">{a.action}</td><td className="px-3 py-1 text-gray-600">{a.target || ''}</td><td className="px-3 py-1 font-mono text-gray-500">{a.ip}</td></tr>
                ))}
                {audit.length === 0 && <tr><td colSpan="5" className="text-center py-4 text-gray-400">No records yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
