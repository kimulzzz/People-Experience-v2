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
import EmailSettingsModal from './components/EmailSettingsModal';
import PublicCheckInForm from './components/PublicCheckInForm';
import PublicFeedbackForm from './components/PublicFeedbackForm';
import GlossaryView from './components/GlossaryView';
import UserManagementModal from './components/UserManagementModal';
import { LoginPage, ChangePasswordScreen } from './components/AuthScreens';
import { AuthContext, useAuth } from './utils/AuthContext';
import { UNAUTHORIZED_EVENT } from './utils/apiClient';
import { fetchWithRetry } from './utils/fetchWithRetry';

// Derived from the real browser clock (not a frozen literal) so the Dashboard's default year
// tracks forward automatically instead of silently staying on a past year — this mirrors the
// backend's CURRENT_YEAR constant in server/services/calculationEngine.js.
const CURRENT_YEAR = String(new Date().getFullYear());

// Login gate: nothing of the app is shown (or fetched) until there is a valid session. A USER's data
// filters only offer their own data scope (Header) AND the server enforces it.
function AuthGate({ children }) {
  const [state, setState] = useState({ status: 'loading', session: null });
  const [notice, setNotice] = useState('');
  const statusRef = useRef('loading');
  const setAuth = (status, session = null) => { statusRef.current = status; setState({ status, session }); };

  useEffect(() => {
    let alive = true;
    fetchWithRetry('/api/auth/me')
      .then(async (res) => {
        if (!alive) return;
        if (res.ok) setAuth('authed', await res.json()); else setAuth('anon');
      })
      .catch(() => { if (alive) setAuth('anon'); });
    const onUnauthorized = () => {
      if (statusRef.current === 'authed') setNotice('Sesi Anda berakhir. Silakan login kembali.');
      setAuth('anon');
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => { alive = false; window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized); };
  }, []);

  const logout = async () => {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch (_) { /* session is dropped client-side anyway */ }
    setNotice('');
    setAuth('anon');
  };

  if (state.status === 'loading') {
    return <div className="min-h-screen flex items-center justify-center bg-[#F8F9FA] text-sm text-gray-500">Memuat...</div>;
  }
  if (state.status === 'anon') {
    return <LoginPage notice={notice} onLoggedIn={(session) => { setNotice(''); setAuth('authed', session); }} />;
  }
  const { user, permissions } = state.session;
  if (user.must_change_password) {
    return <ChangePasswordScreen user={user} onChanged={(session) => setAuth('authed', session)} onLogout={logout} />;
  }
  return (
    <AuthContext.Provider
      key={user.user_id}
      value={{ user, isAdmin: !!permissions.is_admin, canManageEvents: !!permissions.can_manage_events, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export default function App() {
  // The public check-in / feedback forms (?checkin= / ?survey=) never need a login.
  const params = new URLSearchParams(window.location.search);
  if (params.get('checkin') || params.get('survey')) return <AppContent />;
  return <AuthGate><AppContent /></AuthGate>;
}

function AppContent() {
  const { user, isAdmin, logout } = useAuth();
  const [activeTab, setActiveTab] = useState('dashboard');
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
  const [isEmailSettingsOpen, setIsEmailSettingsOpen] = useState(false);
  const [isUserManagementOpen, setIsUserManagementOpen] = useState(false);
  const [selectedMetricDetailId, setSelectedMetricDetailId] = useState(null);
  const [preSelectedSurveyMetricId, setPreSelectedSurveyMetricId] = useState(null);
  const [preSelectedQuestionMetricId, setPreSelectedQuestionMetricId] = useState(null);
  const [qrModalConfig, setQrModalConfig] = useState({ isOpen: false, code: '', title: '', eventName: '', isSurvey: false });

  // Public Form URL parameters (e.g. ?checkin=CODE or ?survey=CODE)
  const [publicCheckinCode, setPublicCheckinCode] = useState(null);
  const [publicSurveyCode, setPublicSurveyCode] = useState(null);

  useEffect(() => {
    // Check URL search parameters
    const params = new URLSearchParams(window.location.search);
    const checkin = params.get('checkin');
    const survey = params.get('survey');

    if (checkin) setPublicCheckinCode(checkin);
    if (survey) setPublicSurveyCode(survey);

    // Fetch directorates list once on mount
    fetchWithRetry('/api/directorates')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setDirectoratesList(data);
      })
      .catch(err => console.error('Error fetching directorates:', err));
  }, []);

  useEffect(() => {
    if (user) fetchAllData(filterOptions); // public forms (no login) have no dashboard data to load
  }, [filterOptions]);

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
        fetchWithRetry(isAdmin ? '/api/alerts' : `/api/alerts?${new URLSearchParams({ directorate: directorate || 'ALL', sub_directorate: sub_directorate || 'ALL' })}`),
        fetchWithRetry('/api/events'),
        fetchWithRetry('/api/health'),
        fetchWithRetry('/api/action-library')
      ]);

      if (calcRes.ok) setCalculationData(await calcRes.json());
      if (alertsRes.ok) setAlertsData(await alertsRes.json());
      if (eventsRes.ok) setEventsData(await eventsRes.json());
      if (healthRes.ok) setHealthStatus(await healthRes.json());
      if (actionRes.ok) setActionLibrary(await actionRes.json());
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
        setActiveTab('events');
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
        activeTab={activeTab}
        setActiveTab={setActiveTab}
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
        onOpenEmailSettingsModal={() => setIsEmailSettingsOpen(true)}
        onOpenUserManagementModal={() => setIsUserManagementOpen(true)}
      />

      {/* Main App Body */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        
        {activeTab === 'dashboard' && (
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
            onSelectJourney={(journeyId) => {
              setSelectedJourneyFilter(journeyId.toString());
              setActiveTab('calculator');
            }}
            onSelectMetric={handleOpenMetricDetail}
            onAcknowledgeAlert={isAdmin ? handleAcknowledgeAlert : undefined}
            onNavigateToSimulator={() => setActiveTab('calculator')}
            onNavigateToEvents={() => setActiveTab('events')}
          />
        )}

        {activeTab === 'calculator' && (
          <Calculator
            calculationData={calculationData}
            selectedJourneyFilter={selectedJourneyFilter}
            setSelectedJourneyFilter={setSelectedJourneyFilter}
            onSelectMetric={handleOpenMetricDetail}
            onOpenSurveyImport={(metricId) => {
              setPreSelectedSurveyMetricId(metricId);
              setIsSurveyImportOpen(true);
            }}
            onOpenAdminSettings={() => setIsAdminParametersOpen(true)}
          />
        )}

        {activeTab === 'events' && (
          <EventManager
            events={eventsData}
            onRefreshEvents={() => fetchAllData(filterOptions)}
            onOpenCreateEventModal={() => setIsCreateEventOpen(true)}
            onOpenQrModal={handleOpenQrModal}
            onOpenPublicCheckIn={(code) => setPublicCheckinCode(code)}
            onOpenPublicSurvey={(code) => setPublicSurveyCode(code)}
          />
        )}

        {activeTab === 'alerts' && (
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
              <button
                onClick={() => setActiveTab('dashboard')}
                className="text-xs font-bold text-[var(--theme-base)] hover:underline"
              >
                &larr; Back to Dashboard
              </button>
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

        {activeTab === 'glossary' && <GlossaryView />}

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
        onOpenSurveyQuestionSettings={isAdmin ? (metricId) => {
          setSelectedMetricDetailId(null);
          setPreSelectedQuestionMetricId(metricId);
          setIsAdminSurveyQuestionsOpen(true);
        } : undefined}
      />

      <EmailSettingsModal
        isOpen={isEmailSettingsOpen}
        onClose={() => setIsEmailSettingsOpen(false)}
      />

      {isAdmin && (
        <UserManagementModal
          isOpen={isUserManagementOpen}
          onClose={() => setIsUserManagementOpen(false)}
          currentUserId={user.user_id}
        />
      )}

      <AdminParametersModal
        isOpen={isAdminParametersOpen}
        onClose={() => setIsAdminParametersOpen(false)}
        onParametersUpdated={() => fetchAllData(filterOptions)}
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
          <span>&copy; {new Date().getFullYear()} PT Bank CIMB Niaga Tbk. People Experience Framework.</span>
          <span className="text-[11px] text-gray-400 font-medium">
            Internal HR Confidential System • 100% On-Premise Compliant
          </span>
        </div>
      </footer>

    </div>
  );
}
