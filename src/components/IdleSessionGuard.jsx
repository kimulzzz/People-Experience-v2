import React, { useEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';

// Auto sign-out after inactivity (v2.44.0). The server is the real enforcer (session_idle_timeout_minutes, a session
// without activity is ended there too); this guard only makes it visible and keeps an ACTIVE user signed in:
//  * real input (mouse, keyboard, scroll, touch, wheel, the tab becoming visible again) counts as activity - fetches
//    and background polls never do, so an unattended dashboard is signed out like any other;
//  * activity is reported with POST /api/auth/activity at most once per PING_MS (a trailing ping covers the last
//    input), the only request besides login that moves the session's last activity on the server;
//  * a warning appears WARN_MS before the sign-out ("Stay signed in" = activity);
//  * tabs of the same browser share the last activity and the sign-out through localStorage.
const LS_ACTIVITY = 'px_last_activity';
export const LS_IDLE_SIGNOUT = 'px_idle_signout';
// Raised by Manage Users after the Admin saves a new idle time, so this tab's timer follows at once.
export const IDLE_TIMEOUT_CHANGED_EVENT = 'px:idle-timeout-changed';
const PING_MS = 30 * 1000;
const LS_WRITE_MS = 5 * 1000;
const WARN_MS = 60 * 1000;
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'wheel'];

const readShared = () => {
  try { return Number(window.localStorage.getItem(LS_ACTIVITY)) || 0; } catch (_) { return 0; }
};
const writeShared = (key, value) => {
  try { window.localStorage.setItem(key, String(value)); } catch (_) { /* storage blocked: this tab keeps its own timer */ }
};

// Tells the other tabs that this browser's session ended for inactivity.
export const broadcastIdleSignOut = () => writeShared(LS_IDLE_SIGNOUT, Date.now());

export default function IdleSessionGuard({ timeoutMinutes, onIdle, onTimeoutChange }) {
  const [secondsLeft, setSecondsLeft] = useState(null); // null = no warning shown
  const timeoutMsRef = useRef(timeoutMinutes * 60 * 1000);
  const lastActivity = useRef(Date.now());
  const lastWritten = useRef(0);
  const lastPing = useRef(0);
  const pendingPing = useRef(false);
  const warning = useRef(false);
  const done = useRef(false);
  const handlers = useRef({ onIdle, onTimeoutChange });
  handlers.current = { onIdle, onTimeoutChange };
  const stayRef = useRef(null);

  useEffect(() => { timeoutMsRef.current = timeoutMinutes * 60 * 1000; }, [timeoutMinutes]);

  useEffect(() => {
    const ping = async () => {
      lastPing.current = Date.now();
      pendingPing.current = false;
      try {
        const res = await fetch('/api/auth/activity', { method: 'POST' });
        // a 401 (already signed out on the server) is handled app-wide by apiClient's px:unauthorized event
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          if (data.idle_timeout_minutes) handlers.current.onTimeoutChange(data.idle_timeout_minutes);
        }
      } catch (_) { /* offline: the next activity / trailing ping retries */ }
    };

    const markActive = (force = false) => {
      const now = Date.now();
      lastActivity.current = now;
      if (force || now - lastWritten.current >= LS_WRITE_MS) { writeShared(LS_ACTIVITY, now); lastWritten.current = now; }
      if (force || now - lastPing.current >= PING_MS) ping(); else pendingPing.current = true;
    };

    const signOut = () => {
      if (done.current) return;
      done.current = true;
      broadcastIdleSignOut();
      handlers.current.onIdle(Math.round(timeoutMsRef.current / 60000), { callServer: true });
    };

    const tick = () => {
      if (done.current) return;
      const now = Date.now();
      if (lastActivity.current > lastWritten.current && now - lastWritten.current >= LS_WRITE_MS) {
        writeShared(LS_ACTIVITY, lastActivity.current);
        lastWritten.current = now;
      }
      if (pendingPing.current && now - lastPing.current >= PING_MS) ping();
      const timeoutMs = timeoutMsRef.current;
      const idle = now - Math.max(lastActivity.current, readShared());
      if (idle >= timeoutMs) { signOut(); return; }
      const warnMs = Math.min(WARN_MS, timeoutMs / 2);
      if (idle >= timeoutMs - warnMs) {
        warning.current = true;
        setSecondsLeft(Math.max(1, Math.ceil((timeoutMs - idle) / 1000)));
      } else if (warning.current) { // activity in another tab ends the warning here too
        warning.current = false;
        setSecondsLeft(null);
      }
    };

    // while the warning is open only "Stay signed in" counts, so a stray mouse move cannot dismiss it unseen
    const onActivity = () => { if (!warning.current && !done.current) markActive(); };
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      tick(); // after sleep / hibernate the time may already be up
      onActivity();
    };
    const onStorage = (e) => {
      if (e.key === LS_IDLE_SIGNOUT && e.newValue && !done.current) {
        done.current = true;
        handlers.current.onIdle(Math.round(timeoutMsRef.current / 60000), { callServer: false });
      }
    };

    markActive(true); // mount = just signed in or reloaded the page
    ACTIVITY_EVENTS.forEach(ev => window.addEventListener(ev, onActivity, { capture: true, passive: true }));
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('storage', onStorage);
    const timer = window.setInterval(tick, 1000);
    stayRef.current = () => { warning.current = false; setSecondsLeft(null); markActive(true); };
    return () => {
      window.clearInterval(timer);
      ACTIVITY_EVENTS.forEach(ev => window.removeEventListener(ev, onActivity, { capture: true }));
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  if (secondsLeft === null) return null;
  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4" role="alertdialog" aria-modal="true" aria-labelledby="idle-warning-title">
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden">
        <div className="h-1.5 bg-gradient-to-r from-[var(--theme-base)] via-[var(--theme-hover)] to-[var(--theme-edge)]" />
        <div className="p-6 space-y-4 text-center">
          <div className="w-12 h-12 mx-auto rounded-full bg-[var(--theme-tint-100)] flex items-center justify-center">
            <Clock className="w-6 h-6 text-[var(--theme-base)]" />
          </div>
          <div>
            <h2 id="idle-warning-title" className="text-base font-extrabold text-[#231F20]">Are you still there?</h2>
            <p className="text-xs text-gray-600 mt-1">
              You will be signed out in <span className="font-bold text-[var(--theme-base)]">{secondsLeft} second{secondsLeft === 1 ? '' : 's'}</span> due to inactivity.
            </p>
          </div>
          <button
            type="button"
            autoFocus
            onClick={() => stayRef.current && stayRef.current()}
            className="w-full py-2.5 bg-gradient-to-r from-[var(--theme-deep)] to-[var(--theme-base)] hover:opacity-90 text-white rounded-lg text-sm font-bold transition"
          >
            Stay signed in
          </button>
        </div>
      </div>
    </div>
  );
}
