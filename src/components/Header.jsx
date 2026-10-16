import React, { useState } from 'react';
import {
  BarChart3,
  Calendar,
  Sparkles,
  Bell,
  Layers,
  FileSpreadsheet,
  Sliders,
  Building2,
  GitBranch,
  Clock,
  BookMarked,
  Palette,
  Check,
  Mail,
  Users,
  LogOut,
  UserCircle2
} from 'lucide-react';
import CimbLogo from './CimbLogo';
import { THEME_PRESETS, applyTheme, getSavedThemeId } from '../utils/theme';
import { useAuth } from '../utils/AuthContext';
import { MONTH_NAMES } from '../utils/months';

// Derived from the real browser clock (not a frozen literal) — only used as a last-resort
// fallback when App.jsx hasn't passed filterOptions/availableYears yet.
const CURRENT_YEAR = String(new Date().getFullYear());

export default function Header({
  activeTab, 
  setActiveTab, 
  alertCount, 
  filterOptions = { mode: 'YTD', year: CURRENT_YEAR, month: '01', directorate: 'ALL', sub_directorate: 'ALL' },
  onFilterChange,
  directoratesList = [],
  availableYears,
  onOpenAdminParametersModal,
  onOpenSurveyQuestionsModal,
  onOpenEmailSettingsModal,
  onOpenUserManagementModal
}) {
  const { user, isAdmin, logout } = useAuth();
  // A USER's filters only offer their data scope (one or more directorates, each all or some divisions);
  // "ALL" then means "all my scope". The server enforces the same rule.
  const userScopes = isAdmin ? null : (user?.scopes || []);
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [activeThemeId, setActiveThemeId] = useState(getSavedThemeId());

  const handlePickTheme = (presetId) => {
    applyTheme(presetId);
    setActiveThemeId(presetId);
    setShowThemePicker(false);
  };

  const months = MONTH_NAMES.map((name, i) => ({ value: String(i + 1).padStart(2, '0'), label: name }));

  // Years the database actually has survey data for (from `/api/metrics/calculate`'s
  // `available_years`, sourced from `storage.getAvailableSurveyYears()`) — falls back to just
  // the currently-selected year until that first response arrives, instead of a hardcoded list.
  const years = availableYears && availableYears.length > 0
    ? [...availableYears].sort((a, b) => b.localeCompare(a))
    : [filterOptions.year || CURRENT_YEAR];

  // Directorates / divisions the filters offer: everything for an Admin, only the account's scope for a User
  const selectableDirectorates = userScopes ? directoratesList.filter(d => userScopes.some(s => s.directorate === d.name)) : directoratesList;
  const currentDirectorateObj = directoratesList.find(d => d.name === filterOptions.directorate);
  const currentScope = userScopes ? userScopes.find(s => s.directorate === filterOptions.directorate) : null;
  const availableSubDirectorates = !currentDirectorateObj ? []
    : (currentScope && currentScope.divisions ? currentDirectorateObj.divisions.filter(v => currentScope.divisions.includes(v)) : currentDirectorateObj.divisions);

  const handleModeChange = (newMode) => {
    if (onFilterChange) {
      onFilterChange({
        ...filterOptions,
        mode: newMode
      });
    }
  };

  const handleYearChange = (newYear) => {
    if (onFilterChange) {
      onFilterChange({
        ...filterOptions,
        year: newYear
      });
    }
  };

  const handleMonthChange = (newMonth) => {
    if (onFilterChange) {
      onFilterChange({
        ...filterOptions,
        month: newMonth
      });
    }
  };

  const handleDirectorateChange = (newDirectorate) => {
    if (onFilterChange) {
      onFilterChange({
        ...filterOptions,
        directorate: newDirectorate,
        sub_directorate: 'ALL' // Reset sub-directorate when directorate changes
      });
    }
  };

  const handleSubDirectorateChange = (newSubDirectorate) => {
    if (onFilterChange) {
      onFilterChange({
        ...filterOptions,
        sub_directorate: newSubDirectorate
      });
    }
  };

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-xs">
      {/* Top Corporate Red Accent Bar */}
      <div className="h-1.5 bg-gradient-to-r from-[var(--theme-base)] via-[var(--theme-hover)] to-[var(--theme-edge)]" />

      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
        {/* Main Header Top Row: brand on the left, signed-in user + Sign out in the top-right corner */}
        <div className="flex items-center justify-between pt-2.5 pb-1.5 gap-3">

          {/* Logo & Brand Title */}
          <div className="flex items-center space-x-3 sm:space-x-4 min-w-0">
            <CimbLogo className="h-8" />
            <div className="border-l border-gray-300 pl-3 py-0.5">
              <div className="flex items-center space-x-2">
                <span className="font-extrabold text-sm sm:text-base tracking-tight text-[#231F20]">
                  People Experience
                </span>
                <span className="text-[10px] bg-red-100 text-[#ED1C24] font-black px-2 py-0.5 rounded-full uppercase tracking-wider border border-red-200">
                  PX System
                </span>
              </div>
              <p className="text-[10px] text-gray-500 font-medium tracking-wide uppercase hidden sm:block">
                Kejar Mimpi • PX Measurement Framework
              </p>
            </div>
          </div>

          {/* Logged-in user (name, role) + Sign out: top-right corner. Narrow screens: avatar + icon-only button. */}
          {user && (
            <div className="flex items-center gap-2 shrink-0 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <UserCircle2 className="w-6 h-6 text-gray-400 shrink-0" />
                <div className="leading-tight hidden sm:block max-w-[220px] min-w-0">
                  <div className="text-[11px] font-bold text-gray-900 truncate" title={user.full_name}>
                    {user.username || user.full_name} <span className="text-gray-400">·</span> {isAdmin ? 'Admin' : 'User'}
                  </div>
                  <div className="text-[9px] font-bold text-gray-500 uppercase tracking-wide truncate" title={isAdmin ? user.full_name : (user.scopes || []).map(s => `${s.directorate}${s.divisions ? ` (${s.divisions.join(', ')})` : ''}`).join('; ')}>
                    {isAdmin ? user.full_name : (user.scopes || []).length === 1 ? user.scopes[0].directorate : `${(user.scopes || []).length} directorates`}
                  </div>
                </div>
              </div>
              <button
                onClick={logout}
                className="px-2.5 py-1 text-xs font-bold text-gray-800 bg-white hover:bg-gray-100 border border-gray-300 rounded-lg flex items-center space-x-1.5 transition shadow-2xs shrink-0"
                title="Sign out of the application"
                aria-label="Sign out"
              >
                <LogOut className="w-3.5 h-3.5 text-[#ED1C24]" />
                <span className="hidden sm:inline">Sign out</span>
              </button>
            </div>
          )}
        </div>

        {/* Filter Bar Controls & Quick Actions */}
        <div className="flex flex-wrap items-center lg:justify-end gap-2 pb-2.5 border-b border-gray-100">

            {/* 1. Mode Tampilan (YTD vs MTD) */}
            <div className="flex items-center bg-gray-100 p-0.5 rounded-lg border border-gray-300 shadow-2xs">
              <button
                type="button"
                onClick={() => handleModeChange('YTD')}
                className={`px-2.5 py-1 text-xs font-bold rounded-md transition ${
                  filterOptions.mode === 'YTD'
                    ? 'bg-[#ED1C24] text-white shadow-xs'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
                title="Year-to-Date: Calculates data for the current year"
              >
                YTD
              </button>
              <button
                type="button"
                onClick={() => handleModeChange('MTD')}
                className={`px-2.5 py-1 text-xs font-bold rounded-md transition ${
                  filterOptions.mode === 'MTD'
                    ? 'bg-[#ED1C24] text-white shadow-xs'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
                title="Month-to-Date: Calculates data for the selected month"
              >
                MTD
              </button>
            </div>

            {/* 2. Tahun Dropdown */}
            <div className="flex items-center space-x-1 px-2.5 py-1 bg-gray-50 border border-gray-300 rounded-lg shadow-2xs">
              <Calendar className="w-3.5 h-3.5 text-gray-500" />
              <select
                value={filterOptions.year}
                onChange={(e) => handleYearChange(e.target.value)}
                className="text-xs font-bold text-gray-900 bg-transparent focus:outline-none cursor-pointer"
              >
                {years.map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>

            {/* 3. Bulan Dropdown (Disabled if YTD) */}
            <div className={`flex items-center space-x-1 px-2.5 py-1 border rounded-lg shadow-2xs transition ${
              filterOptions.mode === 'YTD' 
                ? 'bg-gray-100 border-gray-200 text-gray-400 opacity-60 cursor-not-allowed' 
                : 'bg-gray-50 border-gray-300 text-gray-900'
            }`}>
              <Clock className="w-3.5 h-3.5 text-gray-500" />
              <select
                value={filterOptions.month}
                disabled={filterOptions.mode === 'YTD'}
                onChange={(e) => handleMonthChange(e.target.value)}
                className={`text-xs font-bold bg-transparent focus:outline-none ${
                  filterOptions.mode === 'YTD' ? 'cursor-not-allowed text-gray-400' : 'cursor-pointer text-gray-900'
                }`}
                title={filterOptions.mode === 'YTD' ? 'Month filter is disabled in YTD mode' : 'Select Month'}
              >
                {filterOptions.mode === 'YTD' ? (
                  <option value="01">All Months (YTD)</option>
                ) : (
                  months.map(m => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))
                )}
              </select>
            </div>

            {/* 4. Filter Direktorat */}
            <div className="flex items-center space-x-1 px-2.5 py-1 bg-gray-50 border border-gray-300 rounded-lg shadow-2xs min-w-0 max-w-[200px] sm:max-w-none">
              <Building2 className="w-3.5 h-3.5 text-[#ED1C24] shrink-0" />
              <select
                value={filterOptions.directorate}
                onChange={(e) => handleDirectorateChange(e.target.value)}
                className="min-w-0 max-w-full text-xs font-bold text-gray-900 bg-transparent focus:outline-none truncate cursor-pointer"
                title={isAdmin ? 'Select Directorate (Default: All Bankwide)' : 'Select a directorate within your account data scope'}
              >
                <option value="ALL">{isAdmin ? 'Directorate: All (Bankwide)' : 'All my scope'}</option>
                {selectableDirectorates.map(d => (
                  <option key={d.name} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            {/* 5. Filter Sub Direktorat (Divisi) */}
            <div className={`flex items-center space-x-1 px-2.5 py-1 border rounded-lg shadow-2xs transition min-w-0 max-w-[180px] sm:max-w-none ${
              filterOptions.directorate === 'ALL'
                ? 'bg-gray-100 border-gray-200 text-gray-400 opacity-60 cursor-not-allowed'
                : 'bg-gray-50 border-gray-300 text-gray-900'
            }`}>
              <GitBranch className="w-3.5 h-3.5 text-gray-500 shrink-0" />
              <select
                value={filterOptions.sub_directorate}
                disabled={filterOptions.directorate === 'ALL'}
                onChange={(e) => handleSubDirectorateChange(e.target.value)}
                className={`min-w-0 max-w-full text-xs font-bold bg-transparent focus:outline-none truncate ${
                  filterOptions.directorate === 'ALL' ? 'cursor-not-allowed text-gray-400' : 'cursor-pointer text-gray-900'
                }`}
                title={filterOptions.directorate === 'ALL' ? 'Select a Directorate first' : 'Select Sub-Directorate (Division)'}
              >
                <option value="ALL">Sub-Dir: All</option>
                {availableSubDirectorates.map(div => (
                  <option key={div} value={div}>{div}</option>
                ))}
              </select>
            </div>

            {isAdmin && (<>
            {/* Admin Menu: Parameter Journey & Metric */}
            <button
              onClick={onOpenAdminParametersModal}
              className="px-2.5 py-1 text-xs font-bold text-gray-800 bg-white hover:bg-gray-100 border border-gray-300 rounded-lg flex items-center space-x-1.5 transition shadow-2xs"
              title="Admin Menu: Manage Journey & Metric Parameters (Weight, Target, Threshold)"
            >
              <Sliders className="w-3.5 h-3.5 text-[#ED1C24]" />
              <span className="hidden sm:inline">Admin Parameters</span>
            </button>

            {/* Admin Menu: Survey Templates */}
            <button
              onClick={onOpenSurveyQuestionsModal}
              className="px-2.5 py-1 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg flex items-center space-x-1.5 transition shadow-2xs"
              title="Admin Menu: Survey Questions & CSV Template Settings"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-rose-600" />
              <span className="hidden md:inline">Survey Templates</span>
            </button>

            {/* Admin Menu: Setting Email (sender account for the PIC upload reminders) */}
            <button
              onClick={onOpenEmailSettingsModal}
              className="px-2.5 py-1 text-xs font-bold text-gray-800 bg-white hover:bg-gray-100 border border-gray-300 rounded-lg flex items-center space-x-1.5 transition shadow-2xs"
              title="Admin Menu: Email Settings for the sender of survey-upload reminders to PICs"
            >
              <Mail className="w-3.5 h-3.5 text-[#ED1C24]" />
              <span className="hidden md:inline">Email Settings</span>
            </button>

            {/* Admin Menu: Kelola User (login accounts) */}
            <button
              onClick={onOpenUserManagementModal}
              className="px-2.5 py-1 text-xs font-bold text-gray-800 bg-white hover:bg-gray-100 border border-gray-300 rounded-lg flex items-center space-x-1.5 transition shadow-2xs"
              title="Admin Menu: Manage login accounts (add user, reset password, activate/deactivate)"
            >
              <Users className="w-3.5 h-3.5 text-[#ED1C24]" />
              <span className="hidden md:inline">Manage Users</span>
            </button>
            </>)}

            {alertCount > 0 && (
              <button
                onClick={() => setActiveTab('alerts')}
                className="px-2.5 py-1 text-xs font-bold bg-red-50 text-[#ED1C24] border border-red-200 hover:bg-red-100 rounded-lg flex items-center space-x-1.5 transition animate-pulse-subtle shadow-2xs"
              >
                <Bell className="w-3.5 h-3.5" />
                <span>{alertCount} Deficits</span>
              </button>
            )}

            {/* Website Accent Theme Picker — per-browser only (localStorage), see src/utils/theme.js */}
            <div className="relative">
              <button
                onClick={() => setShowThemePicker(v => !v)}
                className="px-2.5 py-1 text-xs font-bold text-gray-800 bg-white hover:bg-gray-100 border border-gray-300 rounded-lg flex items-center space-x-1.5 transition shadow-2xs"
                title="Choose the website accent color (saved in this browser only)"
              >
                <Palette className="w-3.5 h-3.5" style={{ color: 'var(--theme-base)' }} />
                <span className="hidden lg:inline">Theme</span>
              </button>

              {showThemePicker && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowThemePicker(false)} />
                  <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded-xl shadow-lg z-50 p-2 space-y-1">
                    <p className="text-[10px] font-bold text-gray-400 uppercase px-2 pt-1 pb-1.5">
                      Website Theme Color
                    </p>
                    {THEME_PRESETS.map(preset => (
                      <button
                        key={preset.id}
                        onClick={() => handlePickTheme(preset.id)}
                        className={`w-full px-2 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-2 transition ${
                          activeThemeId === preset.id ? 'bg-gray-100' : 'hover:bg-gray-50'
                        }`}
                      >
                        <span
                          className="w-4 h-4 rounded-full border border-gray-300 shrink-0"
                          style={{ backgroundColor: preset.base }}
                        />
                        <span className="flex-1 text-left text-gray-700">{preset.label}</span>
                        {activeThemeId === preset.id && <Check className="w-3.5 h-3.5 text-gray-500" />}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

        </div>

        {/* Navigation Tabs */}
        <div className="flex space-x-1 overflow-x-auto py-1 px-1 my-1 rounded-lg bg-gradient-to-r from-[var(--theme-tint-50)] via-[var(--theme-tint-100)] to-[var(--theme-tint-50)] border border-[var(--theme-tint-100)]">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`px-4 py-2 text-xs font-semibold rounded-md flex items-center space-x-2 transition ${
              activeTab === 'dashboard'
                ? 'bg-white font-bold shadow-sm'
                : 'text-gray-600 hover:text-gray-900 hover:bg-white/60'
            }`}
            style={activeTab === 'dashboard' ? { color: 'var(--theme-base)' } : undefined}
          >
            <BarChart3 className="w-4 h-4" />
            <span>Dashboard & Trends</span>
          </button>

          <button
            onClick={() => setActiveTab('calculator')}
            className={`px-4 py-2 text-xs font-semibold rounded-md flex items-center space-x-2 transition ${
              activeTab === 'calculator'
                ? 'bg-white font-bold shadow-sm'
                : 'text-gray-600 hover:text-gray-900 hover:bg-white/60'
            }`}
            style={activeTab === 'calculator' ? { color: 'var(--theme-base)' } : undefined}
          >
            <Layers className="w-4 h-4" />
            <span>Explore Metrics (PX Metrics)</span>
          </button>

          <button
            onClick={() => setActiveTab('events')}
            className={`px-4 py-2 text-xs font-semibold rounded-md flex items-center space-x-2 transition ${
              activeTab === 'events'
                ? 'bg-white font-bold shadow-sm'
                : 'text-gray-600 hover:text-gray-900 hover:bg-white/60'
            }`}
            style={activeTab === 'events' ? { color: 'var(--theme-base)' } : undefined}
          >
            <Calendar className="w-4 h-4" />
            <span>Signature Program Events</span>
          </button>

          <button
            onClick={() => setActiveTab('alerts')}
            className={`px-4 py-2 text-xs font-semibold rounded-md flex items-center space-x-2 transition ${
              activeTab === 'alerts'
                ? 'bg-white font-bold shadow-sm'
                : 'text-gray-600 hover:text-gray-900 hover:bg-white/60'
            }`}
            style={activeTab === 'alerts' ? { color: 'var(--theme-base)' } : undefined}
          >
            <Sparkles className="w-4 h-4" />
            <span>Action Library & AI Alerts</span>
          </button>

          <button
            onClick={() => setActiveTab('glossary')}
            className={`px-4 py-2 text-xs font-semibold rounded-md flex items-center space-x-2 transition ${
              activeTab === 'glossary'
                ? 'bg-white font-bold shadow-sm'
                : 'text-gray-600 hover:text-gray-900 hover:bg-white/60'
            }`}
            style={activeTab === 'glossary' ? { color: 'var(--theme-base)' } : undefined}
          >
            <BookMarked className="w-4 h-4" />
            <span>About</span>
          </button>
        </div>

      </div>
    </header>
  );
}

