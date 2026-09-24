import React from 'react';
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
  BookMarked
} from 'lucide-react';
import CimbLogo from './CimbLogo';

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
  onOpenSurveyQuestionsModal
}) {
  const months = [
    { value: '01', label: '01 - Januari' },
    { value: '02', label: '02 - Februari' },
    { value: '03', label: '03 - Maret' },
    { value: '04', label: '04 - April' },
    { value: '05', label: '05 - Mei' },
    { value: '06', label: '06 - Juni' },
    { value: '07', label: '07 - Juli' },
    { value: '08', label: '08 - Agustus' },
    { value: '09', label: '09 - September' },
    { value: '10', label: '10 - Oktober' },
    { value: '11', label: '11 - November' },
    { value: '12', label: '12 - Desember' }
  ];

  // Years the database actually has survey data for (from `/api/metrics/calculate`'s
  // `available_years`, sourced from `storage.getAvailableSurveyYears()`) — falls back to just
  // the currently-selected year until that first response arrives, instead of a hardcoded list.
  const years = availableYears && availableYears.length > 0
    ? [...availableYears].sort((a, b) => b.localeCompare(a))
    : [filterOptions.year || CURRENT_YEAR];

  // Current selected directorate object
  const currentDirectorateObj = directoratesList.find(d => d.id === filterOptions.directorate);
  const availableSubDirectorates = currentDirectorateObj ? currentDirectorateObj.divisions : [];

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
      <div className="h-1.5 bg-gradient-to-r from-[#ED1C24] via-[#D91B23] to-[#800D12]" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Main Header Top Row */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between py-2.5 gap-3 border-b border-gray-100">
          
          {/* Logo & Brand Title */}
          <div className="flex items-center space-x-3 sm:space-x-4 shrink-0">
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

          {/* Filter Bar Controls & Quick Actions */}
          <div className="flex flex-wrap items-center gap-2">

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
                title="Year-to-Date: Mengkalkulasikan data tahun berjalan"
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
                title="Month-to-Date: Mengkalkulasikan data di bulan yang dipilih"
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
                title={filterOptions.mode === 'YTD' ? 'Filter bulan dinonaktifkan pada mode YTD' : 'Pilih Bulan'}
              >
                {filterOptions.mode === 'YTD' ? (
                  <option value="01">Semua Bulan (YTD)</option>
                ) : (
                  months.map(m => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))
                )}
              </select>
            </div>

            {/* 4. Filter Direktorat */}
            <div className="flex items-center space-x-1 px-2.5 py-1 bg-gray-50 border border-gray-300 rounded-lg shadow-2xs max-w-[200px] sm:max-w-none">
              <Building2 className="w-3.5 h-3.5 text-[#ED1C24] shrink-0" />
              <select
                value={filterOptions.directorate}
                onChange={(e) => handleDirectorateChange(e.target.value)}
                className="text-xs font-bold text-gray-900 bg-transparent focus:outline-none cursor-pointer truncate"
                title="Pilih Direktorat (Default: All Bankwide)"
              >
                <option value="ALL">Direktorat: All (Bankwide)</option>
                {directoratesList.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            {/* 5. Filter Sub Direktorat (Divisi) */}
            <div className={`flex items-center space-x-1 px-2.5 py-1 border rounded-lg shadow-2xs transition max-w-[180px] sm:max-w-none ${
              filterOptions.directorate === 'ALL'
                ? 'bg-gray-100 border-gray-200 text-gray-400 opacity-60 cursor-not-allowed'
                : 'bg-gray-50 border-gray-300 text-gray-900'
            }`}>
              <GitBranch className="w-3.5 h-3.5 text-gray-500 shrink-0" />
              <select
                value={filterOptions.sub_directorate}
                disabled={filterOptions.directorate === 'ALL'}
                onChange={(e) => handleSubDirectorateChange(e.target.value)}
                className={`text-xs font-bold bg-transparent focus:outline-none truncate ${
                  filterOptions.directorate === 'ALL' ? 'cursor-not-allowed text-gray-400' : 'cursor-pointer text-gray-900'
                }`}
                title={filterOptions.directorate === 'ALL' ? 'Pilih Direktorat terlebih dahulu' : 'Pilih Sub-Direktorat (Divisi)'}
              >
                <option value="ALL">Sub-Dir: All</option>
                {availableSubDirectorates.map(div => (
                  <option key={div} value={div}>{div}</option>
                ))}
              </select>
            </div>

            {/* Admin Menu: Parameter Journey & Metric */}
            <button
              onClick={onOpenAdminParametersModal}
              className="px-2.5 py-1 text-xs font-bold text-gray-800 bg-white hover:bg-gray-100 border border-gray-300 rounded-lg flex items-center space-x-1.5 transition shadow-2xs"
              title="Admin Menu: Kelola Parameter Journey & Metric (Bobot, Target, Threshold)"
            >
              <Sliders className="w-3.5 h-3.5 text-[#ED1C24]" />
              <span className="hidden sm:inline">Parameter Admin</span>
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

            {alertCount > 0 && (
              <button
                onClick={() => setActiveTab('alerts')}
                className="px-2.5 py-1 text-xs font-bold bg-red-50 text-[#ED1C24] border border-red-200 hover:bg-red-100 rounded-lg flex items-center space-x-1.5 transition animate-pulse-subtle shadow-2xs"
              >
                <Bell className="w-3.5 h-3.5" />
                <span>{alertCount} Deficits</span>
              </button>
            )}

          </div>

        </div>

        {/* Navigation Tabs */}
        <div className="flex space-x-1 overflow-x-auto py-1">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`px-4 py-2 text-xs font-semibold rounded-md flex items-center space-x-2 transition ${
              activeTab === 'dashboard'
                ? 'bg-red-50 text-[#ED1C24] font-bold'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            <span>Dashboard & Trends</span>
          </button>

          <button
            onClick={() => setActiveTab('calculator')}
            className={`px-4 py-2 text-xs font-semibold rounded-md flex items-center space-x-2 transition ${
              activeTab === 'calculator'
                ? 'bg-red-50 text-[#ED1C24] font-bold'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Explore Metrics (PX Metrics)</span>
          </button>

          <button
            onClick={() => setActiveTab('events')}
            className={`px-4 py-2 text-xs font-semibold rounded-md flex items-center space-x-2 transition ${
              activeTab === 'events'
                ? 'bg-red-50 text-[#ED1C24] font-bold'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            <Calendar className="w-4 h-4" />
            <span>Signature Program Events</span>
          </button>

          <button
            onClick={() => setActiveTab('alerts')}
            className={`px-4 py-2 text-xs font-semibold rounded-md flex items-center space-x-2 transition ${
              activeTab === 'alerts'
                ? 'bg-red-50 text-[#ED1C24] font-bold'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span>Action Library & AI Alerts</span>
          </button>

          <button
            onClick={() => setActiveTab('glossary')}
            className={`px-4 py-2 text-xs font-semibold rounded-md flex items-center space-x-2 transition ${
              activeTab === 'glossary'
                ? 'bg-red-50 text-[#ED1C24] font-bold'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            <BookMarked className="w-4 h-4" />
            <span>Glossary</span>
          </button>
        </div>

      </div>
    </header>
  );
}

