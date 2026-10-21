import React, { useState, useEffect, useCallback } from 'react';
import { KeyRound, Plus, Copy, Ban, Trash2, Loader2, AlertCircle, CheckCircle2, Plug } from 'lucide-react';

// "Integrations" tab of Admin Parameters (v2.52.0, Admin only - the server answers 403 to a User). Integration tokens let
// another INTERNAL system push the social media data of metric 1 to POST /api/integrations/social-media without a user
// session. A token is shown ONCE when it is created (the server keeps only its SHA-256); it works on that one endpoint only.
// Revoke stops it at once; a revoked token can then be deleted from the list.

const formatDateTime = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

export default function IntegrationTokensManager() {
  const [tokens, setTokens] = useState([]);
  const [info, setInfo] = useState({ endpoint: '/api/integrations/social-media', max_rows: 500, rate_limit_per_minute: 30 });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [message, setMessage] = useState(null); // { type: 'error' | 'success', text }
  const [created, setCreated] = useState(null); // { token, record } - shown once
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/integration-tokens');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to load the integration tokens.');
      setTokens(Array.isArray(data.tokens) ? data.tokens : []);
      setInfo({ endpoint: data.endpoint, max_rows: data.max_rows, rate_limit_per_minute: data.rate_limit_per_minute });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const call = async (url, method, body) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Request failed.');
      return data;
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      const data = await call('/api/admin/integration-tokens', 'POST', { name });
      setCreated({ token: data.token, record: data.record });
      setCopied(false);
      setName('');
      load();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  const handleRevoke = async (t) => {
    if (!window.confirm(`Revoke the token "${t.name}"? The system that uses it can no longer send data.`)) return;
    try {
      await call(`/api/admin/integration-tokens/${t.token_id}/revoke`, 'POST');
      setMessage({ type: 'success', text: `Token "${t.name}" revoked.` });
      if (created && created.record.token_id === t.token_id) setCreated(null);
      load();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  const handleDelete = async (t) => {
    if (!window.confirm(`Delete the revoked token "${t.name}" from the list?`)) return;
    try {
      await call(`/api/admin/integration-tokens/${t.token_id}`, 'DELETE');
      setMessage({ type: 'success', text: `Token "${t.name}" deleted.` });
      load();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  const copyToken = async () => {
    try {
      await navigator.clipboard.writeText(created.token);
      setCopied(true);
    } catch (_) {
      setMessage({ type: 'error', text: 'Copy failed - select the token and copy it by hand.' });
    }
  };

  const curlExample = `curl -X POST "${window.location.origin}${info.endpoint}" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"rows":[{"platform":"Instagram","year":2026,"month":9,"followers":211100,"reach":548319,"engagement":19505}]}'`;

  return (
    <div className="space-y-5">
      <div className="p-4 bg-blue-50/70 border border-blue-200 rounded-xl space-y-2 text-xs text-blue-900">
        <div className="flex items-center space-x-2 font-bold text-sm">
          <Plug className="w-4 h-4 text-blue-600" />
          <span>Social media data injection (metric 1)</span>
        </div>
        <p>
          Another internal system sends Instagram, LinkedIn and TikTok statistics with <strong>POST {info.endpoint}</strong> and an integration token in the
          header <code className="px-1 bg-white rounded border border-blue-100">Authorization: Bearer &lt;token&gt;</code>. Up to {info.max_rows} rows per request,
          {' '}{info.rate_limit_per_minute} requests a minute. Rows are validated like the Excel upload (any error: nothing stored) and a month sent again is updated.
          A token works on this endpoint only. The application only receives data - it never connects to a social network.
        </p>
        <pre className="bg-white border border-blue-100 rounded-lg p-2.5 text-[10.5px] text-gray-700 overflow-x-auto whitespace-pre">{curlExample}</pre>
      </div>

      {message && (
        <div className={`p-3 rounded-xl text-xs font-medium flex items-center space-x-2 border ${message.type === 'error' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
          {message.type === 'error' ? <AlertCircle className="w-4 h-4 shrink-0" /> : <CheckCircle2 className="w-4 h-4 shrink-0" />}
          <span>{message.text}</span>
        </div>
      )}

      {created && (
        <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl space-y-2 text-xs">
          <div className="font-bold text-amber-900">Token "{created.record.name}" created - copy it now, it is shown only once.</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-2 py-1.5 bg-white border border-amber-200 rounded-lg font-mono text-[11px] break-all select-all">{created.token}</code>
            <button onClick={copyToken} className="px-3 py-1.5 text-[11px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-md flex items-center space-x-1 shrink-0">
              <Copy className="w-3.5 h-3.5" />
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
          <button onClick={() => setCreated(null)} className="text-[11px] font-bold text-amber-800 hover:underline">I have stored the token - hide it</button>
        </div>
      )}

      <form onSubmit={handleCreate} className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          placeholder="Token name, e.g. Marketing analytics server"
          className="flex-1 px-3 py-2 bg-white border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[var(--theme-base)]"
        />
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="px-3 py-2 text-xs font-bold text-white bg-[var(--theme-base)] hover:bg-[var(--theme-hover)] disabled:opacity-50 rounded-lg flex items-center justify-center space-x-1.5"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          <span>Create Token</span>
        </button>
      </form>

      <div className="border border-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-gray-100 text-gray-700 font-bold uppercase tracking-wider border-b border-gray-200 text-[10.5px]">
            <tr>
              <th className="py-2.5 px-3">Name</th>
              <th className="py-2.5 px-3">Token</th>
              <th className="py-2.5 px-3">Created</th>
              <th className="py-2.5 px-3">Last used</th>
              <th className="py-2.5 px-3">Status</th>
              <th className="py-2.5 px-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {loading ? (
              <tr><td colSpan="6" className="text-center py-6 text-gray-400"><Loader2 className="w-4 h-4 animate-spin inline" /> Loading...</td></tr>
            ) : tokens.length === 0 ? (
              <tr><td colSpan="6" className="text-center py-6 text-gray-400">No integration tokens yet.</td></tr>
            ) : tokens.map(t => (
              <tr key={t.token_id}>
                <td className="py-2.5 px-3 font-bold text-gray-900">
                  <div className="flex items-center space-x-1.5"><KeyRound className="w-3.5 h-3.5 text-gray-400" /><span>{t.name}</span></div>
                </td>
                <td className="py-2.5 px-3 font-mono text-gray-500">{t.token_hint}</td>
                <td className="py-2.5 px-3 text-gray-600">
                  <div>{formatDateTime(t.created_at)}</div>
                  <div className="text-[10px] text-gray-400">{t.created_by}</div>
                </td>
                <td className="py-2.5 px-3 text-gray-600">{formatDateTime(t.last_used_at)}</td>
                <td className="py-2.5 px-3">
                  {t.revoked_at
                    ? <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-200 text-gray-600" title={`Revoked by ${t.revoked_by || '—'}`}>Revoked {formatDateTime(t.revoked_at)}</span>
                    : <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">Active</span>}
                </td>
                <td className="py-2.5 px-3 text-right whitespace-nowrap">
                  {t.revoked_at ? (
                    <button onClick={() => handleDelete(t)} disabled={busy} className="inline-flex items-center space-x-1 px-2 py-1 text-[10.5px] font-bold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-md">
                      <Trash2 className="w-3 h-3" /><span>Delete</span>
                    </button>
                  ) : (
                    <button onClick={() => handleRevoke(t)} disabled={busy} className="inline-flex items-center space-x-1 px-2 py-1 text-[10.5px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-md">
                      <Ban className="w-3 h-3" /><span>Revoke</span>
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
