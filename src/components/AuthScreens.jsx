import React, { useState } from 'react';
import { Lock, User, KeyRound, AlertCircle, Loader2, LogOut } from 'lucide-react';
import CimbLogo from './CimbLogo';

// Shared full-screen frame for the login / forced password change screens, in the app's red theme
// (the user's chosen accent colour is applied through the --theme-* variables).
function AuthFrame({ title, subtitle, children }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[var(--theme-deep)] via-[var(--theme-mid)] to-[var(--theme-base)] px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="h-1.5 bg-gradient-to-r from-[var(--theme-base)] via-[var(--theme-hover)] to-[var(--theme-edge)]" />
        <div className="p-7 space-y-5">
          <div className="flex items-center space-x-3">
            <CimbLogo className="h-8" />
            <div className="border-l border-gray-300 pl-3">
              <div className="font-extrabold text-sm text-[#231F20]">People Experience</div>
              <div className="text-[10px] text-gray-500 font-medium uppercase tracking-wide">Kejar Mimpi &bull; PX System</div>
            </div>
          </div>
          <div>
            <h1 className="text-lg font-extrabold text-[#231F20]">{title}</h1>
            <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
          </div>
          {children}
          <p className="text-[10px] text-gray-400 text-center pt-1">Internal HR Confidential System &bull; 100% On-Premise</p>
        </div>
      </div>
    </div>
  );
}

function Field({ label, icon: Icon, type = 'text', value, onChange, autoComplete, autoFocus, hint }) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold text-gray-600 uppercase">{label}</span>
      <div className="mt-1 relative">
        <Icon className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          className="w-full pl-9 pr-3 py-2.5 text-sm bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--theme-base)] focus:bg-white"
        />
      </div>
      {hint && <span className="text-[10px] text-gray-400">{hint}</span>}
    </label>
  );
}

function ErrorBox({ message }) {
  if (!message) return null;
  return (
    <div className="flex items-start space-x-2 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 font-medium" role="alert">
      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
      <span>{message}</span>
    </div>
  );
}

const submitClass = 'w-full py-2.5 bg-gradient-to-r from-[var(--theme-deep)] to-[var(--theme-base)] hover:opacity-90 text-white rounded-lg text-sm font-bold transition flex items-center justify-center space-x-2 disabled:opacity-60';

export function LoginPage({ onLoggedIn, notice }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) { setError('Username and password are required.'); return; }
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'Login failed. Please try again.'); setPassword(''); return; }
      setPassword('');
      onLoggedIn(data);
    } catch (_) {
      setError('Unable to connect to the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame title="Sign In" subtitle="Use the PX account issued by your Admin.">
      <form onSubmit={submit} className="space-y-4">
        {notice && !error && <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 font-medium">{notice}</div>}
        <ErrorBox message={error} />
        <Field label="Username / NIP" icon={User} value={username} onChange={setUsername} autoComplete="username" autoFocus />
        <Field label="Password" icon={Lock} type="password" value={password} onChange={setPassword} autoComplete="current-password" />
        <button type="submit" disabled={busy} className={submitClass}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
          <span>{busy ? 'Checking...' : 'Sign In'}</span>
        </button>
      </form>
    </AuthFrame>
  );
}

// Shown right after login while the account still has a temporary (Admin-issued) password.
export function ChangePasswordScreen({ user, onChanged, onLogout }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (next !== confirm) { setError('The new password confirmation does not match.'); return; }
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: current, new_password: next })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'Failed to change the password.'); return; }
      onChanged(data);
    } catch (_) {
      setError('Unable to connect to the server.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame title="Change Password" subtitle={`Hello ${user.full_name}. The temporary password issued by your Admin must be changed before you continue.`}>
      <form onSubmit={submit} className="space-y-4">
        <ErrorBox message={error} />
        <Field label="Current Password (temporary)" icon={Lock} type="password" value={current} onChange={setCurrent} autoComplete="current-password" autoFocus />
        <Field label="New Password" icon={KeyRound} type="password" value={next} onChange={setNext} autoComplete="new-password" hint="At least 10 characters, containing letters and digits." />
        <Field label="Repeat New Password" icon={KeyRound} type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        <button type="submit" disabled={busy} className={submitClass}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
          <span>{busy ? 'Saving...' : 'Save New Password'}</span>
        </button>
        <button type="button" onClick={onLogout} className="w-full py-2 text-xs font-bold text-gray-500 hover:text-gray-800 flex items-center justify-center space-x-1.5">
          <LogOut className="w-3.5 h-3.5" />
          <span>Sign Out</span>
        </button>
      </form>
    </AuthFrame>
  );
}
