// src/App.jsx
import React, { useState, useEffect, useRef } from 'react';
import Header from './components/Header';
import Dashboard from './components/Dashboard';
import Calculator from './components/Calculator';
import EventManager from './components/EventManager';
import ActionLibraryView from './components/ActionLibraryView';
import CreateEventModal from './components/CreateEventModal';
import WeightsModal from './components/WeightsModal';
import QrCodeModal from './components/QrCodeModal';
import SurveyImportModal from './components/SurveyImportModal';
import MetricDetailModal from './components/MetricDetailModal';
import AdminSettingsModal from './components/AdminSettingsModal';
import AdminSurveyQuestionsModal from './components/AdminSurveyQuestionsModal';
import AdminParametersModal from './components/AdminParametersModal';
import PublicCheckInForm from './components/PublicCheckInForm';
import PublicFeedbackForm from './components/PublicFeedbackForm';
import GlossaryView from './components/GlossaryView';
import { LoginPage, ChangePasswordScreen } from './components/AuthScreens';
import IdleSessionGuard, { broadcastIdleSignOut, IDLE_TIMEOUT_CHANGED_EVENT } from './components/IdleSessionGuard';
import { AuthContext, useAuth } from './utils/AuthContext';
import { UNAUTHORIZED_EVENT } from './utils/apiClient';
import { fetchWithRetry } from './utils/fetchWithRetry';
import { getPublicCodes, isPublicRoute } from './utils/publicRoute';
import { allowedTabs, effectiveMenuAccess } from './utils/menuAccess';
// Loaded on first use (it brings Recharts) so the main bundle does not grow (v2.38.0).
const ExitInterviewDashboard = React.lazy(() => import('./components/ExitInterviewDashboard'));

// Derived from the real browser clock (not a frozen literal) so the Dashboard's default year
// tracks forward automatically instead of silently staying on a past year — this mirrors the
// backend's CURRENT_YEAR constant in server/services/calculationEngine.js.
const CURRENT_YEAR = String(new Date().getFullYear());

// Login gate: nothing of the app is shown (or fetched) until there is a valid session. A USER's data
// filters only offer their own data scope (Header) AND the server enforces it.
function AuthGate({ children }) {
  const [state, setState] = useState({ status: 'loading', session: null });
  const [notice, setNotice] = useState('');
  // v2.44.0: auto sign-out after N minutes without activity (setting session_idle_timeout_minutes, from the server)
  const [idleMinutes, setIdleMinutes] = useState(null);
  const idleMinutesRef = useRef(null);
  const statusRef = useRef('loading');
  const setAuth = (status, session = null) => {
    statusRef.current = status;
    if (session && session.idle_timeout_minutes) { idleMinutesRef.current = session.idle_timeout_minutes; setIdleMinutes(session.idle_timeout_minutes); }
    setState({ status, session });
  };
  const updateIdleMinutes = (n) => { if (n && n !== idleMinutesRef.current) { idleMinutesRef.current = n; setIdleMinutes(n); } };
  const idleNotice = (n) => `You were signed out after ${n} minute${n === 1 ? '' : 's'} of inactivity.`;

  // Idle time is up (this tab's timer, or another tab of this browser signed out): end the session on the server
  // (only the tab that timed out calls it) and return to the login page with the reason.
  const signOutIdle = async (minutes, { callServer }) => {
    if (statusRef.current !== 'authed') return;
    statusRef.current = 'anon';
    if (callServer) {
      try {
        await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'IDLE_TIMEOUT' }) });
      } catch (_) { /* the server ends the idle session by itself anyway */ }
    }
    setNotice(idleNotice(minutes || idleMinutesRef.current));
    setAuth('anon');
  };

  useEffect(() => {
    let alive = true;
    fetchWithRetry('/api/auth/me')
      .then(async (res) => {
        if (!alive) return;
        if (res.ok) setAuth('authed', await res.json()); else setAuth('anon');
      })
      .catch(() => { if (alive) setAuth('anon'); });
    const onUnauthorized = (e) => {
      const detail = (e && e.detail) || {};
      if (detail.reason === 'IDLE_TIMEOUT') { // also right at page load, e.g. after sleep / hibernate
        if (statusRef.current === 'authed') broadcastIdleSignOut();
        setNotice(idleNotice(detail.idle_timeout_minutes || idleMinutesRef.current || 5));
      } else if (statusRef.current === 'authed') {
        setNotice('Your session has expired. Please sign in again.');
      }
      setAuth('anon');
    };
    const onIdleChanged = (e) => updateIdleMinutes(Number(e.detail));
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    window.addEventListener(IDLE_TIMEOUT_CHANGED_EVENT, onIdleChanged);
    return () => {
      alive = false;
      window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
      window.removeEventListener(IDLE_TIMEOUT_CHANGED_EVENT, onIdleChanged);
    };
  }, []);

  const logout = async () => {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch (_) { /* session is dropped client-side anyway */ }
    setNotice('');
    setAuth('anon');
  };

  if (state.status === 'loading') {
    return <div className="min-h-screen flex items-center justify-center bg-[#F8F9FA] text-sm text-gray-500">Loading...</div>;
  }
  if (state.status === 'anon') {
    return <LoginPage notice={notice} onLoggedIn={(session) => { setNotice(''); setAuth('authed', session); }} />;
  }
  const { user, permissions } = state.session;
  const idleGuard = idleMinutes ? <IdleSessionGuard key={user.user_id} timeoutMinutes={idleMinutes} onIdle={signOutIdle} onTimeoutChange={updateIdleMinutes} /> : null;
  if (user.must_change_password) {
    return <>{idleGuard}<ChangePasswordScreen user={user} onChanged={(session) => setAuth('authed', session)} onLogout={logout} /></>;
  }
  return (
    <AuthContext.Provider
      key={user.user_id}
      value={{ user, isAdmin: !!permissions.is_admin, canManageEvents: !!permissions.can_manage_events, menuAccess: user.menu_access || null, logout }}
    >
      {idleGuard}
      {children}
    </AuthContext.Provider>
  );
}

export default function App() {
  // The public check-in / feedback forms (?checkin= / ?survey=) never need a login.
  if (isPublicRoute()) return <AppContent />;
  return <AuthGate><AppContent /></AuthGate>;
}

function AppContent() {
  const { user, isAdmin, menuAccess, logout } = useAuth();
  const [activeTab, setActiveTab] = useState('dashboard');
  // Menu access (v2.49.0): only the menus this account may open are shown, and a tab that is not allowed is never
  // rendered - not even when set programmatically (a button, a stale state); the first allowed menu is shown instead.
  const access = effectiveMenuAccess(isAdmin, menuAccess);
  const tabs = allowedTabs(isAdmin, menuAccess);
  const shownTab = tabs.includes(activeTab) ? activeTab : (tabs[0] || null);
  const openTab = (tab) => { if (tabs.includes(tab)) setActiveTab(tab); };
  const [calculationData, setCalculationData] = useState(null);
  const [alertsData, setAlertsData] = useState(null);
  const [eventsData, setEventsData] = useState([]);
  const [healthStatus, setHealthStatus] = useState(null);
  const [actionLibrary, setActionLibrary] = useState([]);
  const [directoratesList, setDirectoratesList] = useState([]);

  // Active Filter Options: Mode (YTD / MTD), Year, Month, Directorate, Sub-Directorate
  const [filterOptions, setFilterOptions] = useState({
    mode: 'YTD',
    year: CURRENT_YEAR,
    month: '01',
    // 'ALL' = the whole bank for an Admin, "all my scope" (union of the account's scopes) for a User -
    // the server decides; a User choosing something outside the scope gets a 403.
    directorate: 'ALL',
    sub_directorate: 'ALL'
  });

  // Filter state for Calculator
  const [selectedJourneyFilter, setSelectedJourneyFilter] = useState('ALL');

  // Modals state
  const [isCreateEventOpen, setIsCreateEventOpen] = useState(false);
  const [isWeightsModalOpen, setIsWeightsModalOpen] = useState(false);
  const [isSurveyImportOpen, setIsSurveyImportOpen] = useState(false);
  const [isAdminSettingsOpen, setIsAdminSettingsOpen] = useState(false);
  const [isAdminSurveyQuestionsOpen, setIsAdminSurveyQuestionsOpen] = useState(false);
  const [isAdminParametersOpen, setIsAdminParametersOpen] = useState(false);
  const [selectedMetricDetailId, setSelectedMetricDetailId] = useState(null);
  const [preSelectedSurveyMetricId, setPreSelectedSurveyMetricId] = useState(null);
  const [preSelectedQuestionMetricId, setPreSelectedQuestionMetricId] = useState(null);
  const [qrModalConfig, setQrModalConfig] = useState({ isOpen: false, code: '', title: '', eventName: '', isSurvey: false });

  // Public Form URL parameters (e.g. ?checkin=CODE or ?survey=CODE)
  // Initialised synchronously from the URL (not in an effect): on a public page the first render must already
  // return the public form, otherwise the authenticated Header would render with user === null and crash.
  const [publicCheckinCode, setPublicCheckinCode] = useState(() => getPublicCodes().checkin);
  const [publicSurveyCode, setPublicSurveyCode] = useState(() => getPublicCodes().survey);

  // Directorates list: fetched on mount and again after a change in Admin Parameters -> Directorates (v2.51.0)
  const refreshDirectorates = () => fetchWithRetry('/api/directorates')
    .then(res => res.json())
    .then(data => {
      if (Array.isArray(data)) setDirectoratesList(data);
    })
    .catch(err => console.error('Error fetching directorates:', err));

  useEffect(() => {
    refreshDirectorates();
  }, []);

  // After a directory change: new lists for the Header filter, and the filter follows a renamed / merged directorate or
  // division (a deleted one falls back to all); the dashboard (incl. the PX-by-directorate panel) reloads.
  const handleDirectoryChanged = (change) => {
    refreshDirectorates();
    const f = filterOptions;
    let next = f;
    if (change && (change.type === 'rename' || change.type === 'merge') && f.directorate === change.from) next = { ...f, directorate: change.to };
    else if (change && change.type === 'delete' && f.directorate === change.name) next = { ...f, directorate: 'ALL', sub_directorate: 'ALL' };
    else if (change && change.type === 'rename-division' && f.directorate === change.directorate && f.sub_directorate === change.from) next = { ...f, sub_directorate: change.to };
    else if (change && change.type === 'delete-division' && f.directorate === change.directorate && f.sub_directorate === change.name) next = { ...f, sub_directorate: 'ALL' };
    if (next !== f) setFilterOptions(next);
    else if (user) fetchAllData(f);
  };

  useEffect(() => {
    if (user) fetchAllData(filterOptions); // public forms (no login) have no dashboard data to load
  }, [filterOptions]);

  useEffect(() => {
    if (shownTab && shownTab !== activeTab) setActiveTab(shownTab);
  }, [shownTab, activeTab]);

  const fetchAllData = async (filters = filterOptions) => {
    try {
      const { mode, year, month, directorate, sub_directorate } = filters;
      const queryParams = new URLSearchParams({
        mode: mode || 'YTD',
        year: year || CURRENT_YEAR,
        month: month || '01',
        directorate: directorate || 'ALL',
        sub_directorate: sub_directorate || 'ALL'
      }).toString();

      const [calcRes, alertsRes, eventsRes, healthRes, actionRes] = await Promise.all([
        fetchWithRetry(`/api/metrics/calculate?${queryParams}`),
        // A User's alerts follow the same data scope / filter as the scorecard (the server limits them anyway)
        // Admin and User alike follow the Header directorate / sub-directorate filter (v2.49.1; Admin used to get bankwide alerts always)
        fetchWithRetry(`/api/alerts?${new URLSearchParams({ directorate: directorate || 'ALL', sub_directorate: sub_directorate || 'ALL' })}`),
        // menus this account may not open are not fetched at all (the server would answer 403)
        access.events ? fetchWithRetry('/api/events') : null,
        fetchWithRetry('/api/health'),
        access.action_library ? fetchWithRetry('/api/action-library') : null
      ]);

      if (calcRes.ok) setCalculationData(await calcRes.json());
      if (alertsRes.ok) setAlertsData(await alertsRes.json());
      if (eventsRes && eventsRes.ok) setEventsData(await eventsRes.json());
      if (healthRes.ok) setHealthStatus(await healthRes.json());
      if (actionRes && actionRes.ok) setActionLibrary(await actionRes.json());
    } catch (err) {
      console.error('Error loading dashboard data:', err);
    }
  };

  const handleFilterChange = (newFilters) => {
    setFilterOptions(newFilters);
  };

  const handleOpenMetricDetail = (metricId) => {
    setSelectedMetricDetailId(metricId);
  };

  const handleSaveWeights = async (weights) => {
    try {
      const res = await fetch('/api/metrics/weights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weights })
      });
      if (res.ok) {
        fetchAllData(filterOptions);
      }
    } catch (err) {
      alert('Failed to update weights: ' + err.message);
    }
  };

  const handleCreateEvent = async (eventPayload) => {
    try {
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eventPayload)
      });
      if (res.ok) {
        fetchAllData(filterOptions);
        openTab('events');
      }
    } catch (err) {
      alert('Failed to create event: ' + err.message);
    }
  };

  const handleAcknowledgeAlert = async (metricId) => {
    try {
      const res = await fetch('/api/alerts/acknowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metric_id: metricId })
      });
      if (res.ok) {
        fetchAllData(filterOptions);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleOpenQrModal = (code, title, eventName) => {
    const isSurvey = title.includes('EVALUASI') || title.includes('SURVEY') || title.includes('FEEDBACK');
    setQrModalConfig({
      isOpen: true,
      code,
      title,
      eventName,
      isSurvey
    });
  };

  // If public direct check-in form URL is accessed
  if (publicCheckinCode) {
    return (
      <PublicCheckInForm
        eventCode={publicCheckinCode}
        onBackToAdmin={!user ? undefined : () => {
          setPublicCheckinCode(null);
          window.history.pushState({}, '', window.location.pathname);
        }}
      />
    );
  }

  // If public direct evaluation survey URL is accessed
  if (publicSurveyCode) {
    return (
      <PublicFeedbackForm
        eventCode={publicSurveyCode}
        onBackToAdmin={!user ? undefined : () => {
          setPublicSurveyCode(null);
          window.history.pushState({}, '', window.location.pathname);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex flex-col text-[#231F20]">
      
      {/* Top Header */}
      <Header
        activeTab={shownTab}
        setActiveTab={openTab}
        allowedTabs={tabs}
        alertCount={alertsData?.total_alerts || 0}
        healthStatus={healthStatus}
        filterOptions={filterOptions}
        onFilterChange={handleFilterChange}
        directoratesList={directoratesList}
        availableYears={calculationData?.available_years}
        onOpenWeightsModal={() => setIsWeightsModalOpen(true)}
        onOpenSurveyImportModal={() => {
          setPreSelectedSurveyMetricId(null);
          setIsSurveyImportOpen(true);
        }}
        onOpenAdminSettingsModal={() => setIsAdminSettingsOpen(true)}
        onOpenSurveyQuestionsModal={() => {
          setPreSelectedQuestionMetricId(7);
          setIsAdminSurveyQuestionsOpen(true);
        }}
        onOpenAdminParametersModal={() => setIsAdminParametersOpen(true)}
      />

      {/* Main App Body */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        
        {!shownTab && (
          <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-sm text-gray-600">
            Your account has no menu access yet. Contact an Admin.
          </div>
        )}

        {shownTab === 'dashboard' && (
          <Dashboard
            calculationData={calculationData}
            alertsData={alertsData}
            selectedPeriod={filterOptions.mode === 'YTD' ? 'YTD' : `${filterOptions.year}-${filterOptions.month}`}
            filterOptions={filterOptions}
            onSelectPeriod={(p) => {
              if (p === 'YTD') {
                setFilterOptions(prev => ({ ...prev, mode: 'YTD' }));
              } else if (p.includes('-')) {
                const [y, m] = p.split('-');
                setFilterOptions(prev => ({ ...prev, mode: 'MTD', year: y, month: m }));
              }
            }}
            onSelectDirectorate={(name) => {
              // "PX Index by Directorate": same as choosing it in the Header filter (whole web follows)
              setFilterOptions(prev => ({ ...prev, directorate: name, sub_directorate: 'ALL' }));
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            onSelectJourney={access.explore ? (journeyId) => {
              setSelectedJourneyFilter(journeyId.toString());
              openTab('calculator');
            } : undefined}
            onSelectMetric={handleOpenMetricDetail}
            onAcknowledgeAlert={isAdmin ? handleAcknowledgeAlert : undefined}
            onNavigateToSimulator={access.explore ? () => openTab('calculator') : undefined}
            onNavigateToEvents={access.events ? () => openTab('events') : undefined}
          />
        )}

        {shownTab === 'calculator' && (
          <Calculator
            calculationData={calculationData}
            selectedJourneyFilter={selectedJourneyFilter}
            setSelectedJourneyFilter={setSelectedJourneyFilter}
            onSelectMetric={handleOpenMetricDetail}
            onOpenSurveyImport={(metricId) => {
              setPreSelectedSurveyMetricId(metricId);
              setIsSurveyImportOpen(true);
            }}
          />
        )}

        {shownTab === 'events' && (
          <EventManager
            events={eventsData}
            onRefreshEvents={() => fetchAllData(filterOptions)}
            onOpenCreateEventModal={() => setIsCreateEventOpen(true)}
            onOpenQrModal={handleOpenQrModal}
            onOpenPublicCheckIn={(code) => setPublicCheckinCode(code)}
            onOpenPublicSurvey={(code) => setPublicSurveyCode(code)}
          />
        )}

        {shownTab === 'alerts' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-extrabold text-[#231F20]">
                  All Metric Deficit Alerts & Action Plans ({alertsData?.alerts?.length || 0})
                </h3>
                <p className="text-xs text-gray-500">
                  Framework Slide 10 • Automatically triggers intervention recommendations when metrics fall below thresholds
                </p>
              </div>
              {access.dashboard && (
                <button
                  onClick={() => openTab('dashboard')}
                  className="text-xs font-bold text-[var(--theme-base)] hover:underline"
                >
                  &larr; Back to Dashboard
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4">
              {alertsData?.alerts?.map((alert) => (
                <div key={alert.alert_id} className="bg-gradient-to-br from-[var(--theme-deep)] via-[var(--theme-mid)] to-[var(--theme-base)] rounded-xl p-5 shadow-xs space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${
                        alert.severity === 'CRITICAL' ? 'bg-white text-[var(--theme-dark)]' : 'bg-amber-400 text-amber-950'
                      }`}>
                        {alert.severity}
                      </span>
                      <h4
                        onClick={() => handleOpenMetricDetail(alert.metric_id)}
                        className="text-sm font-extrabold text-white mt-1.5 hover:text-red-100 cursor-pointer"
                      >
                        {alert.metric_name}
                      </h4>
                      <p className="text-xs text-red-100">Journey: {alert.journey_name} • PIC: {alert.experience_owner}</p>
                    </div>
                    <div className="text-right">
                      <span className="text-xl font-black text-white">{alert.current_score}%</span>
                      <span className="text-xs text-red-100 block">Target: {alert.target_display}</span>
                    </div>
                  </div>

                  <div className="bg-white rounded-lg p-3 text-xs space-y-2">
                    <p className="text-gray-700 font-medium leading-relaxed">
                      <strong>AI Recommendation & Action Library:</strong> {alert.recommended_action}
                    </p>
                    {alert.suggested_initiatives && (
                      <div className="text-[11px] text-gray-600 font-mono whitespace-pre-line bg-gray-50 p-2.5 rounded border border-gray-200">
                        {alert.suggested_initiatives}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-xs pt-1 text-red-100 border-t border-white/20">
                    <span>Data Source: <strong className="text-white">{alert.source_of_data}</strong></span>
                    <button
                      onClick={() => handleOpenMetricDetail(alert.metric_id)}
                      className="px-3 py-1.5 bg-white text-[var(--theme-dark)] hover:bg-[var(--theme-tint-50)] rounded-lg text-xs font-bold transition"
                    >
                      View Survey Details & Questions &rarr;
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {shownTab === 'exit-interview' && (
          <React.Suspense fallback={<div className="flex items-center justify-center min-h-[300px]"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#ED1C24]" /></div>}>
            <ExitInterviewDashboard filterOptions={filterOptions} />
          </React.Suspense>
        )}

        {shownTab === 'glossary' && <GlossaryView />}

      </main>

      {/* Global Modals */}
      <MetricDetailModal
        isOpen={Boolean(selectedMetricDetailId)}
        metricId={selectedMetricDetailId}
        filterOptions={filterOptions}
        onClose={() => setSelectedMetricDetailId(null)}
        onOpenSurveyUpload={(metricId) => {
          setSelectedMetricDetailId(null);
          setPreSelectedSurveyMetricId(metricId);
          setIsSurveyImportOpen(true);
        }}
        onOpenExitInterview={access.exit_interview ? () => {
          setSelectedMetricDetailId(null);
          openTab('exit-interview');
        } : undefined}
        onOpenSurveyQuestionSettings={isAdmin ? (metricId) => {
          setSelectedMetricDetailId(null);
          setPreSelectedQuestionMetricId(metricId);
          setIsAdminSurveyQuestionsOpen(true);
        } : undefined}
      />

      <AdminParametersModal
        isOpen={isAdminParametersOpen}
        onClose={() => setIsAdminParametersOpen(false)}
        onParametersUpdated={() => fetchAllData(filterOptions)}
        onDirectoryChanged={handleDirectoryChanged}
        currentUserId={user?.user_id}
      />

      <AdminSettingsModal
        isOpen={isAdminSettingsOpen}
        onClose={() => setIsAdminSettingsOpen(false)}
        calculationData={calculationData}
        onSaveSuccess={() => fetchAllData(filterOptions)}
      />

      <AdminSurveyQuestionsModal
        isOpen={isAdminSurveyQuestionsOpen}
        onClose={() => setIsAdminSurveyQuestionsOpen(false)}
        initialMetricId={preSelectedQuestionMetricId || 7}
        calculationData={calculationData}
        onSaveSuccess={() => fetchAllData(filterOptions)}
      />

      <CreateEventModal
        isOpen={isCreateEventOpen}
        onClose={() => setIsCreateEventOpen(false)}
        onCreateEvent={handleCreateEvent}
      />

      <WeightsModal
        isOpen={isWeightsModalOpen}
        onClose={() => setIsWeightsModalOpen(false)}
        metrics={calculationData?.metrics}
        onSaveWeights={handleSaveWeights}
      />

      <QrCodeModal
        isOpen={qrModalConfig.isOpen}
        onClose={() => setQrModalConfig({ ...qrModalConfig, isOpen: false })}
        code={qrModalConfig.code}
        title={qrModalConfig.title}
        eventName={qrModalConfig.eventName}
        isSurvey={qrModalConfig.isSurvey}
      />

      <SurveyImportModal
        isOpen={isSurveyImportOpen}
        onClose={() => setIsSurveyImportOpen(false)}
        preSelectedMetricId={preSelectedSurveyMetricId}
        onImportSuccess={() => fetchAllData(filterOptions)}
      />

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 py-4 text-center text-xs text-gray-400">
        <div className="max-w-[1600px] mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          {/* v2.52.2: version from /api/health (never hardcoded here); the "Internal HR Confidential System" tagline was removed */}
          <span>
            &copy; {new Date().getFullYear()} PT Bank CIMB Niaga Tbk. People Experience Framework.
            {healthStatus?.version && <span className="ml-1.5 font-semibold text-gray-500">v{healthStatus.version}</span>}
          </span>
        </div>
      </footer>

    </div>
  );
}
