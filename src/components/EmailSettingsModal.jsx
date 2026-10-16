import React, { useState, useEffect } from 'react';
import { X, Mail, Send, Save, ShieldAlert, CheckCircle2, AlertCircle, Loader2, KeyRound, Trash2 } from 'lucide-react';

// "Email Settings": the sender account used for the Survey Upload Reminder emails to PICs.
// Everything is stored in SQL Server (px_email_settings). The password is write-only: it is
// stored encrypted and the API never sends it back — this form only shows whether one is set.
const EMPTY_FORM = {
  enabled: false,
  provider: 'GMAIL',
  smtp_host: '',
  smtp_port: 587,
  smtp_secure: false,
  smtp_user: '',
  smtp_password: '',
  from_name: '',
  from_email: ''
};

export default function EmailSettingsModal({ isOpen, onClose }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [hasPassword, setHasPassword] = useState(false);
  const [passwordReadable, setPasswordReadable] = useState(true);
  const [clearPassword, setClearPassword] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [envFallback, setEnvFallback] = useState(false);
  const [pics, setPics] = useState([]);
  const [recipient, setRecipient] = useState('SELF');
  const [customRecipient, setCustomRecipient] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState(null); // { type: 'success' | 'error', text }
  const [testResult, setTestResult] = useState(null);
  // Automatic reminder schedule (px_app_settings) + the log of what was actually emailed.
  const [schedule, setSchedule] = useState({ reminder_send_hour: 8, reminder_repeat_days: 1 });
  const [history, setHistory] = useState([]);

  useEffect(() => {
    if (!isOpen) return;
    setMessage(null);
    setTestResult(null);
    setClearPassword(false);
    setLoading(true);
    Promise.all([
      fetch('/api/admin/email-settings').then(r => r.json()),
      fetch('/api/admin/parameters').then(r => r.json()),
      fetch('/api/settings').then(r => r.json()),
      fetch('/api/admin/upload-reminders').then(r => r.json())
    ])
      .then(([s, params, appSettings, reminders]) => {
        setSchedule({
          reminder_send_hour: appSettings.reminder_send_hour ?? 8,
          reminder_repeat_days: appSettings.reminder_repeat_days ?? 1
        });
        setHistory(reminders.history || []);
        setForm({
          enabled: !!s.enabled,
          provider: s.provider || 'GMAIL',
          smtp_host: s.smtp_host || '',
          smtp_port: s.smtp_port || 587,
          smtp_secure: !!s.smtp_secure,
          smtp_user: s.smtp_user || '',
          smtp_password: '',
          from_name: s.from_name || '',
          from_email: s.from_email || ''
        });
        setHasPassword(!!s.has_password);
        setPasswordReadable(s.password_readable !== false);
        setUpdatedAt(s.updated_at);
        setEnvFallback(!!s.env_fallback_available);
        // PICs that actually receive reminders: manual-upload metrics with a PIC e-mail.
        const seen = new Map();
        (params.metrics || [])
          .filter(m => m.requires_manual_upload && m.pic_email)
          .forEach(m => { if (!seen.has(m.pic_email)) seen.set(m.pic_email, m.pic_name || m.pic_email); });
        setPics([...seen.entries()].map(([email, name]) => ({ email, name })));
      })
      .catch(() => setMessage({ type: 'error', text: 'Failed to load the email settings.' }))
      .finally(() => setLoading(false));
  }, [isOpen]);

  if (!isOpen) return null;

  const isGmail = form.provider === 'GMAIL';
  const set = (patch) => setForm(prev => ({ ...prev, ...patch }));

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const body = { ...form, clear_password: clearPassword };
      if (!form.smtp_password) delete body.smtp_password; // blank = keep the stored password
      const res = await fetch('/api/admin/email-settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      setHasPassword(!!data.has_password);
      setPasswordReadable(data.password_readable !== false);
      setUpdatedAt(data.updated_at);
      setClearPassword(false);
      set({ smtp_password: '' });
      for (const key of ['reminder_send_hour', 'reminder_repeat_days']) {
        const r = await fetch(`/api/admin/settings/${key}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: Number(schedule[key]) })
        });
        if (!r.ok) throw new Error((await r.json()).error || 'Failed to save the reminder schedule');
      }
      setMessage({ type: 'success', text: 'Email settings & reminder schedule saved to the database.' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const to = recipient === 'SELF' ? undefined : (recipient === 'CUSTOM' ? customRecipient.trim() : recipient);
      const res = await fetch('/api/admin/email-settings/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to })
      });
      setTestResult(await res.json());
    } catch (err) {
      setTestResult({ sent: false, error: err.message });
    } finally {
      setTesting(false);
    }
  };

  const inputCls = 'w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-[var(--theme-base)] focus:outline-none';

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-5 my-8">

        <div className="flex items-center justify-between pb-4 border-b border-gray-100">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-[var(--theme-tint-100)] flex items-center justify-center">
              <Mail className="w-5 h-5 text-[var(--theme-base)]" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">Reminder Email Settings</h3>
              <p className="text-[11px] text-gray-500">Sender account for the manual survey upload reminder emails to PICs</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-500 text-xs"><Loader2 className="w-4 h-4 animate-spin mr-2" />Loading…</div>
        ) : (
          <form onSubmit={handleSave} className="space-y-4 text-xs">

            {isGmail && (
              <div className="flex items-start space-x-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800">
                <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="font-bold">Gmail = third-party cloud service (temporary)</p>
                  <p>
                    The PX system is designed to be 100% on-premise. Use Gmail for testing only, then switch to the
                    internal CIMB Niaga <b>SMTP</b> server. Gmail <b>does not accept a regular account password</b>: enable
                    2-Step Verification, then create an <b>App Password</b> (16 characters) in your
                    Google account and enter that App Password in the password field below.
                  </p>
                </div>
              </div>
            )}

            <label className="flex items-center space-x-2 cursor-pointer">
              <input type="checkbox" checked={form.enabled} onChange={e => set({ enabled: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300" />
              <span className="font-bold text-gray-800">Enable sending reminder emails</span>
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-gray-700 mb-1">Provider</label>
                <select value={form.provider} onChange={e => set({ provider: e.target.value })} className={inputCls}>
                  <option value="GMAIL">Gmail (smtp.gmail.com — temporary)</option>
                  <option value="SMTP">SMTP Server (internal / on-premise)</option>
                </select>
              </div>
              <div>
                <label className="block font-bold text-gray-700 mb-1">{isGmail ? 'Email Gmail' : 'Username'}</label>
                <input type="text" value={form.smtp_user} onChange={e => set({ smtp_user: e.target.value })}
                  placeholder={isGmail ? 'name@gmail.com' : 'SMTP username'} autoComplete="off" className={inputCls} />
              </div>

              {!isGmail && (
                <>
                  <div>
                    <label className="block font-bold text-gray-700 mb-1">SMTP Host</label>
                    <input type="text" value={form.smtp_host} onChange={e => set({ smtp_host: e.target.value })}
                      placeholder="smtp.internal.cimbniaga.co.id" className={inputCls} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-bold text-gray-700 mb-1">Port</label>
                      <input type="number" value={form.smtp_port} onChange={e => set({ smtp_port: e.target.value })} className={inputCls} />
                    </div>
                    <label className="flex items-end pb-2 space-x-2 cursor-pointer">
                      <input type="checkbox" checked={form.smtp_secure} onChange={e => set({ smtp_secure: e.target.checked })}
                        className="w-4 h-4 rounded border-gray-300" />
                      <span className="font-bold text-gray-700">Direct SSL/TLS</span>
                    </label>
                  </div>
                </>
              )}

              <div className="sm:col-span-2">
                <label className="block font-bold text-gray-700 mb-1 flex items-center space-x-1.5">
                  <KeyRound className="w-3.5 h-3.5" /><span>{isGmail ? 'App Password' : 'Password'}</span>
                </label>
                <input
                  type="password"
                  value={form.smtp_password}
                  onChange={e => { set({ smtp_password: e.target.value }); setClearPassword(false); }}
                  placeholder={hasPassword && !clearPassword ? '•••••••• saved (leave blank to keep unchanged)' : 'No password saved yet'}
                  autoComplete="new-password"
                  className={inputCls}
                />
                <div className="flex items-center justify-between mt-1 text-[10.5px] text-gray-500">
                  <span>Stored encrypted (AES-256) in the database; never shown again.</span>
                  {hasPassword && (
                    <button type="button" onClick={() => { setClearPassword(true); set({ smtp_password: '' }); }}
                      className="inline-flex items-center space-x-1 text-red-600 hover:underline">
                      <Trash2 className="w-3 h-3" /><span>Delete saved password</span>
                    </button>
                  )}
                </div>
                {hasPassword && !passwordReadable && (
                  <p className="text-[10.5px] text-red-600 mt-1 font-bold">
                    The saved password cannot be read (the encryption key changed). Re-enter the password and click Save.
                  </p>
                )}
                {clearPassword && <p className="text-[10.5px] text-red-600 mt-1">The password will be deleted when you click Save.</p>}
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">Sender Name</label>
                <input type="text" value={form.from_name} onChange={e => set({ from_name: e.target.value })}
                  placeholder="People Experience CIMB Niaga" className={inputCls} />
              </div>
              <div>
                <label className="block font-bold text-gray-700 mb-1">Sender Email (optional)</label>
                <input type="text" value={form.from_email} onChange={e => set({ from_email: e.target.value })}
                  placeholder="blank = same as the account" className={inputCls} />
              </div>
            </div>

            {/* Automatic reminder schedule */}
            <div className="border-t border-gray-100 pt-4 space-y-3">
              <div>
                <h4 className="font-bold text-gray-800">Automatic Reminder Schedule</h4>
                <p className="text-[11px] text-gray-500">
                  On each metric's <b>Upload Deadline Date</b> (Admin Parameters), if there is no survey data dated in the previous month
                  (e.g. on 10 October → September data), the PIC is emailed automatically.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Start sending at hour (0–23)</label>
                  <input type="number" min="0" max="23" value={schedule.reminder_send_hour}
                    onChange={e => setSchedule(prev => ({ ...prev, reminder_send_hour: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Repeat every (days)</label>
                  <input type="number" min="0" max="31" value={schedule.reminder_repeat_days}
                    onChange={e => setSchedule(prev => ({ ...prev, reminder_repeat_days: e.target.value }))} className={inputCls} />
                  <p className="text-[10.5px] text-gray-400 mt-1">0 = only once on the deadline date; 1 = every day until the data is uploaded.</p>
                </div>
              </div>
            </div>

            {envFallback && !form.enabled && (
              <p className="text-[11px] text-gray-500">Email is disabled in the database — the system uses the legacy SMTP configuration from the <code>.env</code> file as a fallback.</p>
            )}

            {message && (
              <div className={`flex items-start space-x-2 p-3 rounded-lg border ${message.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                {message.type === 'success' ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />}
                <span>{message.text}</span>
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <span className="text-[10.5px] text-gray-400">{updatedAt ? `Last saved: ${new Date(updatedAt).toLocaleString('en-US')}` : 'Never saved'}</span>
              <button type="submit" disabled={saving}
                className="px-4 py-2 rounded-lg bg-[var(--theme-base)] hover:bg-[var(--theme-strong)] text-white font-bold flex items-center space-x-1.5 disabled:opacity-60">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                <span>Save</span>
              </button>
            </div>

            {/* What was actually emailed */}
            <div className="border-t border-gray-100 pt-4 space-y-2">
              <h4 className="font-bold text-gray-800">Sent Reminder History</h4>
              {history.length === 0 ? (
                <p className="text-[11px] text-gray-500">No reminders have been sent yet.</p>
              ) : (
                <ul className="text-[11px] text-gray-700 space-y-1 max-h-32 overflow-y-auto">
                  {history.map(h => (
                    <li key={h.log_id} className="flex justify-between gap-2">
                      <span>{h.sent_on} — metric #{h.metric_id}, data {h.expected_period} → {h.pic_email}</span>
                      <span className={h.status === 'SENT' ? 'text-emerald-600 font-bold' : 'text-red-600 font-bold'}>{h.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Test e-mail */}
            <div className="border-t border-gray-100 pt-4 space-y-3">
              <div>
                <h4 className="font-bold text-gray-800">Send Test Email</h4>
                <p className="text-[11px] text-gray-500">Save the settings first. Sends a single test email — not a real reminder.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <select value={recipient} onChange={e => setRecipient(e.target.value)} className={inputCls}>
                  <option value="SELF">To the sender's own email (safe, recommended)</option>
                  {pics.map(p => <option key={p.email} value={p.email}>PIC: {p.name} — {p.email}</option>)}
                  <option value="CUSTOM">Another address…</option>
                </select>
                {recipient === 'CUSTOM' && (
                  <input type="email" value={customRecipient} onChange={e => setCustomRecipient(e.target.value)}
                    placeholder="address@email.com" className={inputCls} />
                )}
              </div>
              <button type="button" onClick={handleTest} disabled={testing || (recipient === 'CUSTOM' && !customRecipient.trim())}
                className="px-4 py-2 rounded-lg bg-white border border-gray-300 hover:bg-gray-50 text-gray-800 font-bold flex items-center space-x-1.5 disabled:opacity-60">
                {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                <span>Send Test Email</span>
              </button>
              {testResult && (
                <div className={`flex items-start space-x-2 p-3 rounded-lg border ${testResult.sent ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                  {testResult.sent ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />}
                  <span>{testResult.sent ? `Test email sent to ${testResult.to}.` : testResult.error}</span>
                </div>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
