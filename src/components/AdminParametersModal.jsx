// src/components/AdminParametersModal.jsx
import React, { useState, useEffect } from 'react';
import { 
  X, 
  Settings2, 
  Layers, 
  Sliders, 
  Plus, 
  Edit3, 
  Trash2, 
  RotateCcw, 
  Save, 
  Check, 
  AlertCircle,
  HelpCircle,
  Filter,
  UserCheck,
  Users2,
  Sparkles
} from 'lucide-react';

export default function AdminParametersModal({ isOpen, onClose, onParametersUpdated }) {
  const [activeTab, setActiveTab] = useState('metrics'); // 'journeys' | 'metrics'
  const [loading, setLoading] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Data states
  const [journeys, setJourneys] = useState([]);
  const [checkpoints, setCheckpoints] = useState([]);
  const [metrics, setMetrics] = useState([]);
  
  // Filter state for metrics table
  const [selectedJourneyFilter, setSelectedJourneyFilter] = useState('ALL');
  const [selectedAudienceFilter, setSelectedAudienceFilter] = useState('ALL');

  // Form states for Journey CRUD
  const [editingJourney, setEditingJourney] = useState(null); // null or journey object
  const [isAddingJourney, setIsAddingJourney] = useState(false);
  const [journeyFormData, setJourneyFormData] = useState({
    journey_code: '',
    journey_name: '',
    tagline: '',
    color: '#ED1C24',
    icon: 'Layers'
  });

  // Form states for Metric CRUD
  const [editingMetric, setEditingMetric] = useState(null); // null or metric object
  const [isAddingMetric, setIsAddingMetric] = useState(false);
  const [metricFormData, setMetricFormData] = useState({
    metric_name: '',
    journey_id: 1,
    checkpoint_id: 1,
    metric_type: 'SURVEY',
    scale_type: 'RATING_5',
    source_of_data: 'Manual Survey',
    experience_owner: 'HC Talent Acquisition',
    weight: 1.0,
    target_value: 4.5,
    target_display: '4.50 / 5.0',
    min_threshold: 4.0,
    is_employee_metric: true,
    target_audience: 'EMPLOYEE'
  });

  // Reset confirmation modal state
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchParameters();
    }
  }, [isOpen]);

  const fetchParameters = async () => {
    setLoading(true);
    setErrorMessage('');
    try {
      const res = await fetch('/api/admin/parameters');
      if (!res.ok) throw new Error('Gagal mengambil parameter');
      const data = await res.json();
      setJourneys(data.journeys || []);
      setCheckpoints(data.checkpoints || []);
      setMetrics(data.metrics || []);
    } catch (err) {
      setErrorMessage(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ----------------------------------------------------
  // JOURNEY ACTIONS
  // ----------------------------------------------------
  const handleOpenAddJourney = () => {
    setJourneyFormData({
      journey_code: `J${journeys.length + 1}`,
      journey_name: '',
      tagline: '',
      color: '#ED1C24',
      icon: 'Layers'
    });
    setIsAddingJourney(true);
    setEditingJourney(null);
  };

  const handleOpenEditJourney = (j) => {
    setJourneyFormData({
      journey_code: j.journey_code,
      journey_name: j.journey_name,
      tagline: j.tagline || '',
      color: j.color || '#ED1C24',
      icon: j.icon || 'Layers'
    });
    setEditingJourney(j);
    setIsAddingJourney(false);
  };

  const handleSaveJourney = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMessage('');
    try {
      let res;
      if (editingJourney) {
        res = await fetch(`/api/admin/journeys/${editingJourney.journey_id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(journeyFormData)
        });
      } else {
        res = await fetch('/api/admin/journeys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(journeyFormData)
        });
      }

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Gagal menyimpan Journey');

      setSaveSuccess(`Journey "${journeyFormData.journey_name}" berhasil disimpan!`);
      setTimeout(() => setSaveSuccess(''), 3500);
      setEditingJourney(null);
      setIsAddingJourney(false);
      await fetchParameters();
      if (onParametersUpdated) onParametersUpdated();
    } catch (err) {
      setErrorMessage(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteJourney = async (journeyId, journeyName) => {
    if (!window.confirm(`Apakah Anda yakin ingin menghapus Journey "${journeyName}"?`)) return;
    setLoading(true);
    setErrorMessage('');
    try {
      const res = await fetch(`/api/admin/journeys/${journeyId}`, { method: 'DELETE' });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Gagal menghapus Journey');

      setSaveSuccess(`Journey "${journeyName}" berhasil dihapus.`);
      setTimeout(() => setSaveSuccess(''), 3500);
      await fetchParameters();
      if (onParametersUpdated) onParametersUpdated();
    } catch (err) {
      setErrorMessage(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ----------------------------------------------------
  // METRIC ACTIONS
  // ----------------------------------------------------
  const handleOpenAddMetric = () => {
    setMetricFormData({
      metric_name: '',
      journey_id: journeys[0]?.journey_id || 1,
      checkpoint_id: checkpoints[0]?.checkpoint_id || 1,
      metric_type: 'SURVEY',
      scale_type: 'RATING_5',
      source_of_data: 'Manual Survey',
      experience_owner: 'HC Talent Acquisition',
      weight: 1.0,
      target_value: 4.5,
      target_display: '4.50 / 5.0',
      min_threshold: 4.0,
      is_employee_metric: true,
      target_audience: 'EMPLOYEE'
    });
    setIsAddingMetric(true);
    setEditingMetric(null);
  };

  const handleOpenEditMetric = (m) => {
    setMetricFormData({
      metric_name: m.metric_name,
      journey_id: m.journey_id,
      checkpoint_id: m.checkpoint_id,
      metric_type: m.metric_type,
      scale_type: m.scale_type,
      source_of_data: m.source_of_data || '',
      experience_owner: m.experience_owner || '',
      weight: m.weight !== undefined ? m.weight : 1.0,
      target_value: m.target_value !== undefined ? m.target_value : 4.5,
      target_display: m.target_display || '',
      min_threshold: m.min_threshold !== undefined ? m.min_threshold : 4.0,
      is_employee_metric: m.is_employee_metric !== undefined ? m.is_employee_metric : true,
      target_audience: m.target_audience || (m.is_employee_metric ? 'EMPLOYEE' : 'EXTERNAL_MARKET')
    });
    setEditingMetric(m);
    setIsAddingMetric(false);
  };

  const handleSaveMetric = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMessage('');
    try {
      let res;
      if (editingMetric) {
        res = await fetch(`/api/admin/metrics/${editingMetric.metric_id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(metricFormData)
        });
      } else {
        res = await fetch('/api/admin/metrics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(metricFormData)
        });
      }

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Gagal menyimpan Metric');

      setSaveSuccess(`Metric "${metricFormData.metric_name}" berhasil disimpan!`);
      setTimeout(() => setSaveSuccess(''), 3500);
      setEditingMetric(null);
      setIsAddingMetric(false);
      await fetchParameters();
      if (onParametersUpdated) onParametersUpdated();
    } catch (err) {
      setErrorMessage(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteMetric = async (metricId, metricName) => {
    if (!window.confirm(`Apakah Anda yakin ingin menghapus Metric #${metricId} - "${metricName}"?`)) return;
    setLoading(true);
    setErrorMessage('');
    try {
      const res = await fetch(`/api/admin/metrics/${metricId}`, { method: 'DELETE' });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Gagal menghapus Metric');

      setSaveSuccess(`Metric #${metricId} berhasil dihapus.`);
      setTimeout(() => setSaveSuccess(''), 3500);
      await fetchParameters();
      if (onParametersUpdated) onParametersUpdated();
    } catch (err) {
      setErrorMessage(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ----------------------------------------------------
  // RESET ALL PARAMETERS TO DEFAULT
  // ----------------------------------------------------
  const handleResetParameters = async () => {
    setLoading(true);
    setErrorMessage('');
    try {
      const res = await fetch('/api/admin/parameters/reset', { method: 'POST' });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Gagal reset parameter');

      setSaveSuccess('Parameter Journey, Checkpoint, dan Metric berhasil direset ke standar bawaan!');
      setTimeout(() => setSaveSuccess(''), 3500);
      setShowResetConfirm(false);
      setEditingJourney(null);
      setIsAddingJourney(false);
      setEditingMetric(null);
      setIsAddingMetric(false);
      await fetchParameters();
      if (onParametersUpdated) onParametersUpdated();
    } catch (err) {
      setErrorMessage(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  // Filtered metrics
  const filteredMetrics = metrics.filter(m => {
    if (selectedJourneyFilter !== 'ALL' && m.journey_id !== parseInt(selectedJourneyFilter)) {
      return false;
    }
    if (selectedAudienceFilter === 'EMPLOYEE' && !m.is_employee_metric) {
      return false;
    }
    if (selectedAudienceFilter === 'NON_EMPLOYEE' && m.is_employee_metric) {
      return false;
    }
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl shadow-2xl max-w-6xl w-full max-h-[92vh] flex flex-col overflow-hidden border border-gray-200">
        
        {/* Modal Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 text-white flex items-center justify-between border-b border-gray-700">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-red-600 rounded-xl shadow-inner">
              <Settings2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
                  Parameter Management: Journey & Metrics
                </h2>
                <span className="text-[10px] bg-red-500/30 text-red-300 font-bold px-2 py-0.5 rounded-full border border-red-500/40">
                  Admin Panel
                </span>
              </div>
              <p className="text-xs text-gray-400">
                Konfigurasi master parameter tahapan Journey, metrik kepuasan, bobot, threshold, dan klasifikasi responden.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowResetConfirm(true)}
              className="px-3 py-1.5 text-xs font-semibold text-amber-300 bg-amber-950/60 hover:bg-amber-900 border border-amber-600/50 rounded-lg flex items-center space-x-1.5 transition"
              title="Reset ke parameter default CIMB Niaga"
            >
              <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">Reset Default</span>
            </button>

            <button 
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Notifications */}
        {saveSuccess && (
          <div className="px-6 py-2.5 bg-emerald-50 border-b border-emerald-200 text-emerald-800 text-xs font-bold flex items-center space-x-2 animate-in slide-in-from-top-1">
            <Check className="w-4 h-4 text-emerald-600" />
            <span>{saveSuccess}</span>
          </div>
        )}
        {errorMessage && (
          <div className="px-6 py-2.5 bg-red-50 border-b border-red-200 text-red-800 text-xs font-bold flex items-center space-x-2 animate-in slide-in-from-top-1">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Modal Navigation Tabs */}
        <div className="px-6 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
          <div className="flex space-x-4">
            <button
              onClick={() => { setActiveTab('metrics'); setIsAddingMetric(false); setEditingMetric(null); }}
              className={`py-3 text-xs sm:text-sm font-bold border-b-2 flex items-center space-x-2 transition ${
                activeTab === 'metrics'
                  ? 'border-[#ED1C24] text-[#ED1C24]'
                  : 'border-transparent text-gray-500 hover:text-gray-900'
              }`}
            >
              <Sliders className="w-4 h-4" />
              <span>Parameter Metric ({metrics.length})</span>
            </button>

            <button
              onClick={() => { setActiveTab('journeys'); setIsAddingJourney(false); setEditingJourney(null); }}
              className={`py-3 text-xs sm:text-sm font-bold border-b-2 flex items-center space-x-2 transition ${
                activeTab === 'journeys'
                  ? 'border-[#ED1C24] text-[#ED1C24]'
                  : 'border-transparent text-gray-500 hover:text-gray-900'
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>Parameter Journey ({journeys.length})</span>
            </button>
          </div>

          <div className="py-2">
            {activeTab === 'journeys' && !isAddingJourney && !editingJourney && (
              <button
                onClick={handleOpenAddJourney}
                className="px-3 py-1.5 text-xs font-bold text-white bg-[#ED1C24] hover:bg-[#D91B23] rounded-lg flex items-center space-x-1.5 shadow-sm transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Tambah Journey</span>
              </button>
            )}

            {activeTab === 'metrics' && !isAddingMetric && !editingMetric && (
              <button
                onClick={handleOpenAddMetric}
                className="px-3 py-1.5 text-xs font-bold text-white bg-[#ED1C24] hover:bg-[#D91B23] rounded-lg flex items-center space-x-1.5 shadow-sm transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Tambah Metric</span>
              </button>
            )}
          </div>
        </div>

        {/* Modal Body Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">

          {/* ============================================================ */}
          {/* TAB 1: PARAMETER JOURNEY                                      */}
          {/* ============================================================ */}
          {activeTab === 'journeys' && (
            <div>
              {/* Journey Form (Add or Edit) */}
              {(isAddingJourney || editingJourney) && (
                <div className="mb-6 p-5 bg-gray-50 border border-gray-300 rounded-xl shadow-xs animate-in fade-in">
                  <div className="flex items-center justify-between pb-3 mb-4 border-b border-gray-200">
                    <h3 className="text-sm font-bold text-gray-900 flex items-center space-x-2">
                      <Sparkles className="w-4 h-4 text-[#ED1C24]" />
                      <span>{editingJourney ? `Edit Journey: ${editingJourney.journey_name}` : 'Tambah Journey Baru'}</span>
                    </h3>
                    <button
                      onClick={() => { setIsAddingJourney(false); setEditingJourney(null); }}
                      className="text-xs text-gray-500 hover:text-gray-800 font-semibold"
                    >
                      Batal
                    </button>
                  </div>

                  <form onSubmit={handleSaveJourney} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">Kode Journey</label>
                      <input
                        type="text"
                        required
                        value={journeyFormData.journey_code}
                        onChange={(e) => setJourneyFormData({ ...journeyFormData, journey_code: e.target.value })}
                        placeholder="Contoh: J1"
                        className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 font-mono"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-xs font-bold text-gray-700 mb-1">Nama Journey</label>
                      <input
                        type="text"
                        required
                        value={journeyFormData.journey_name}
                        onChange={(e) => setJourneyFormData({ ...journeyFormData, journey_name: e.target.value })}
                        placeholder="Contoh: Join Us & Onboarding"
                        className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">Warna Aksen</label>
                      <div className="flex items-center space-x-2">
                        <input
                          type="color"
                          value={journeyFormData.color}
                          onChange={(e) => setJourneyFormData({ ...journeyFormData, color: e.target.value })}
                          className="w-8 h-8 p-0 border-0 rounded cursor-pointer"
                        />
                        <input
                          type="text"
                          value={journeyFormData.color}
                          onChange={(e) => setJourneyFormData({ ...journeyFormData, color: e.target.value })}
                          className="flex-1 px-3 py-1.5 text-xs font-mono border border-gray-300 rounded-lg uppercase"
                        />
                      </div>
                    </div>

                    <div className="sm:col-span-3">
                      <label className="block text-xs font-bold text-gray-700 mb-1">Tagline / Deskripsi Singkat</label>
                      <input
                        type="text"
                        value={journeyFormData.tagline}
                        onChange={(e) => setJourneyFormData({ ...journeyFormData, tagline: e.target.value })}
                        placeholder="Contoh: Pengalaman pelamar dan karyawan baru"
                        className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500"
                      />
                    </div>

                    <div className="flex items-end">
                      <button
                        type="submit"
                        disabled={loading}
                        className="w-full px-4 py-2 text-xs font-bold text-white bg-[#ED1C24] hover:bg-[#D91B23] rounded-lg flex items-center justify-center space-x-1.5 shadow transition"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>{editingJourney ? 'Update Journey' : 'Simpan Journey'}</span>
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Journey Cards List */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {journeys.map(j => {
                  const jMetricsCount = metrics.filter(m => m.journey_id === j.journey_id).length;
                  return (
                    <div 
                      key={j.journey_id}
                      className="p-4 bg-white border border-gray-200 rounded-xl shadow-xs hover:shadow-md transition flex flex-col justify-between relative overflow-hidden"
                    >
                      <div className="absolute top-0 left-0 w-2 h-full" style={{ backgroundColor: j.color || '#ED1C24' }} />
                      
                      <div className="pl-2">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] font-black font-mono px-2 py-0.5 rounded-md bg-gray-100 text-gray-800">
                            {j.journey_code}
                          </span>
                          <span className="text-[11px] font-bold text-gray-500">
                            {jMetricsCount} Metrik
                          </span>
                        </div>
                        <h4 className="text-sm font-bold text-gray-900 mb-1">
                          {j.journey_name}
                        </h4>
                        <p className="text-xs text-gray-500 line-clamp-2 mb-3">
                          {j.tagline || 'Tidak ada deskripsi'}
                        </p>
                      </div>

                      <div className="pl-2 pt-3 border-t border-gray-100 flex items-center justify-between">
                        <div className="flex items-center space-x-1.5">
                          <div className="w-3.5 h-3.5 rounded-full border border-gray-300" style={{ backgroundColor: j.color || '#ED1C24' }} />
                          <span className="text-[11px] font-mono text-gray-500">{j.color}</span>
                        </div>

                        <div className="flex items-center space-x-1">
                          <button
                            onClick={() => handleOpenEditJourney(j)}
                            className="p-1.5 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
                            title="Edit Journey"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteJourney(j.journey_id, j.journey_name)}
                            className="p-1.5 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                            title="Hapus Journey"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* TAB 2: PARAMETER METRIC                                       */}
          {/* ============================================================ */}
          {activeTab === 'metrics' && (
            <div>
              {/* Metric Form (Add or Edit) */}
              {(isAddingMetric || editingMetric) && (
                <div className="mb-6 p-5 bg-gray-50 border border-gray-300 rounded-xl shadow-xs animate-in fade-in">
                  <div className="flex items-center justify-between pb-3 mb-4 border-b border-gray-200">
                    <h3 className="text-sm font-bold text-gray-900 flex items-center space-x-2">
                      <Sparkles className="w-4 h-4 text-[#ED1C24]" />
                      <span>{editingMetric ? `Edit Metric #${editingMetric.metric_id}: ${editingMetric.metric_name}` : 'Tambah Metric Baru'}</span>
                    </h3>
                    <button
                      onClick={() => { setIsAddingMetric(false); setEditingMetric(null); }}
                      className="text-xs text-gray-500 hover:text-gray-800 font-semibold"
                    >
                      Batal
                    </button>
                  </div>

                  <form onSubmit={handleSaveMetric} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-bold text-gray-700 mb-1">Nama Metrik</label>
                      <input
                        type="text"
                        required
                        value={metricFormData.metric_name}
                        onChange={(e) => setMetricFormData({ ...metricFormData, metric_name: e.target.value })}
                        placeholder="Contoh: Candidate Experience Survey Score"
                        className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 font-medium"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">Tahapan Journey</label>
                      <select
                        value={metricFormData.journey_id}
                        onChange={(e) => setMetricFormData({ ...metricFormData, journey_id: parseInt(e.target.value) })}
                        className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500"
                      >
                        {journeys.map(j => (
                          <option key={j.journey_id} value={j.journey_id}>
                            {j.journey_code} - {j.journey_name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">Tipe Metrik</label>
                      <select
                        value={metricFormData.metric_type}
                        onChange={(e) => setMetricFormData({ ...metricFormData, metric_type: e.target.value })}
                        className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 font-semibold"
                      >
                        <option value="SURVEY">SURVEY (Koresponden Respon)</option>
                        <option value="OUTCOME">OUTCOME (Operational HR Data)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">Skala Penilaian</label>
                      <select
                        value={metricFormData.scale_type}
                        onChange={(e) => setMetricFormData({ ...metricFormData, scale_type: e.target.value })}
                        className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500"
                      >
                        <option value="RATING_5">Rating Skala 1.0 - 5.0</option>
                        <option value="PERCENTAGE">Persentase (0 - 100%)</option>
                        <option value="QUOTA_COUNT">Quota Count / Numerik</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">Bobot Metrik (Weight)</label>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="10"
                        required
                        value={metricFormData.weight}
                        onChange={(e) => setMetricFormData({ ...metricFormData, weight: parseFloat(e.target.value) || 0 })}
                        className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 font-mono font-bold"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">Target Nilai</label>
                      <input
                        type="number"
                        step="0.01"
                        required
                        value={metricFormData.target_value}
                        onChange={(e) => setMetricFormData({ ...metricFormData, target_value: parseFloat(e.target.value) || 0 })}
                        className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 font-mono font-bold"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">Min Threshold (Batas Kritis)</label>
                      <input
                        type="number"
                        step="0.01"
                        required
                        value={metricFormData.min_threshold}
                        onChange={(e) => setMetricFormData({ ...metricFormData, min_threshold: parseFloat(e.target.value) || 0 })}
                        className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 font-mono font-bold"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">Target Display Text</label>
                      <input
                        type="text"
                        value={metricFormData.target_display}
                        onChange={(e) => setMetricFormData({ ...metricFormData, target_display: e.target.value })}
                        placeholder="Contoh: 4.50 / 5.0 atau > 90%"
                        className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">Experience Owner</label>
                      <input
                        type="text"
                        value={metricFormData.experience_owner}
                        onChange={(e) => setMetricFormData({ ...metricFormData, experience_owner: e.target.value })}
                        placeholder="Contoh: HC Talent Acquisition"
                        className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500"
                      />
                    </div>

                    {/* Responden / Audience Settings */}
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">Target Audience</label>
                      <select
                        value={metricFormData.target_audience}
                        onChange={(e) => {
                          const val = e.target.value;
                          setMetricFormData({ 
                            ...metricFormData, 
                            target_audience: val,
                            is_employee_metric: val === 'EMPLOYEE'
                          });
                        }}
                        className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 font-semibold"
                      >
                        <option value="EMPLOYEE">Karyawan Internal CIMB Niaga</option>
                        <option value="CAMPUS_STUDENTS">Mahasiswa Kampus (CIMB Goes to Campus)</option>
                        <option value="JOB_APPLICANTS">Kandidat Pelamar Kerja (Candidate Exp)</option>
                        <option value="EXTERNAL_MARKET">Eksternal Market / Public</option>
                      </select>
                    </div>

                    <div className="flex items-center pt-5">
                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={metricFormData.is_employee_metric}
                          onChange={(e) => setMetricFormData({ ...metricFormData, is_employee_metric: e.target.checked })}
                          className="w-4 h-4 text-red-600 rounded focus:ring-red-500 border-gray-300"
                        />
                        <span className="text-xs font-bold text-gray-800">
                          Data Terkait Karyawan (Aktif saat filter Direktorat dipilih)
                        </span>
                      </label>
                    </div>

                    <div className="sm:col-span-2 lg:col-span-4 flex justify-end space-x-2 pt-2 border-t border-gray-200">
                      <button
                        type="button"
                        onClick={() => { setIsAddingMetric(false); setEditingMetric(null); }}
                        className="px-4 py-2 text-xs font-bold text-gray-700 bg-gray-200 hover:bg-gray-300 rounded-lg transition"
                      >
                        Batal
                      </button>
                      <button
                        type="submit"
                        disabled={loading}
                        className="px-5 py-2 text-xs font-bold text-white bg-[#ED1C24] hover:bg-[#D91B23] rounded-lg flex items-center space-x-1.5 shadow transition"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>{editingMetric ? 'Update Parameter Metrik' : 'Simpan Metrik'}</span>
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Metric Filters Header */}
              <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center space-x-1.5 text-xs text-gray-500">
                    <Filter className="w-3.5 h-3.5 text-gray-600" />
                    <span className="font-bold">Filter Journey:</span>
                  </div>
                  <select
                    value={selectedJourneyFilter}
                    onChange={(e) => setSelectedJourneyFilter(e.target.value)}
                    className="px-2.5 py-1 text-xs font-semibold bg-white border border-gray-300 rounded-lg focus:outline-none"
                  >
                    <option value="ALL">Semua Journey ({metrics.length})</option>
                    {journeys.map(j => (
                      <option key={j.journey_id} value={j.journey_id}>
                        {j.journey_code} - {j.journey_name}
                      </option>
                    ))}
                  </select>

                  <div className="flex items-center space-x-1.5 text-xs text-gray-500 pl-2 border-l border-gray-300">
                    <Users2 className="w-3.5 h-3.5 text-gray-600" />
                    <span className="font-bold">Filter Responden:</span>
                  </div>
                  <select
                    value={selectedAudienceFilter}
                    onChange={(e) => setSelectedAudienceFilter(e.target.value)}
                    className="px-2.5 py-1 text-xs font-semibold bg-white border border-gray-300 rounded-lg focus:outline-none"
                  >
                    <option value="ALL">Semua Responden ({metrics.length})</option>
                    <option value="EMPLOYEE">Karyawan Internal ({metrics.filter(m => m.is_employee_metric).length})</option>
                    <option value="NON_EMPLOYEE">Non-Karyawan / Eksternal ({metrics.filter(m => !m.is_employee_metric).length})</option>
                  </select>
                </div>

                <div className="text-xs font-semibold text-gray-500">
                  Menampilkan <span className="text-gray-900 font-bold">{filteredMetrics.length}</span> dari {metrics.length} metrik
                </div>
              </div>

              {/* Metrics Table */}
              <div className="overflow-x-auto border border-gray-200 rounded-xl shadow-xs">
                <table className="min-w-full divide-y divide-gray-200 text-left text-xs">
                  <thead className="bg-gray-100/80 font-bold text-gray-700">
                    <tr>
                      <th className="py-2.5 px-3 w-12 text-center">ID</th>
                      <th className="py-2.5 px-3">Nama Metrik</th>
                      <th className="py-2.5 px-3">Journey</th>
                      <th className="py-2.5 px-3 text-center">Tipe</th>
                      <th className="py-2.5 px-3 text-center">Responden</th>
                      <th className="py-2.5 px-3 text-center">Bobot</th>
                      <th className="py-2.5 px-3 text-center">Target</th>
                      <th className="py-2.5 px-3 text-center">Threshold</th>
                      <th className="py-2.5 px-3 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {filteredMetrics.map(m => {
                      const journey = journeys.find(j => j.journey_id === m.journey_id);
                      return (
                        <tr key={m.metric_id} className="hover:bg-gray-50/80 transition">
                          <td className="py-2.5 px-3 text-center font-mono font-black text-gray-700 bg-gray-50/50">
                            #{m.metric_id}
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="font-bold text-gray-900">{m.metric_name}</div>
                            <div className="text-[11px] text-gray-500">{m.experience_owner} • {m.scale_type}</div>
                          </td>
                          <td className="py-2.5 px-3">
                            <span 
                              className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold text-white"
                              style={{ backgroundColor: journey?.color || '#ED1C24' }}
                            >
                              {journey?.journey_code || `J${m.journey_id}`}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                              m.metric_type === 'SURVEY' 
                                ? 'bg-blue-100 text-blue-800 border border-blue-200' 
                                : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                            }`}>
                              {m.metric_type}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            {m.is_employee_metric ? (
                              <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-50 text-green-700 border border-green-200">
                                <UserCheck className="w-3 h-3" />
                                <span>Karyawan</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                                <Users2 className="w-3 h-3" />
                                <span>Non-Karyawan</span>
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-center font-mono font-bold text-gray-900">
                            {m.weight !== undefined ? m.weight.toFixed(1) : '1.0'}
                          </td>
                          <td className="py-2.5 px-3 text-center font-mono font-bold text-gray-700">
                            {m.target_value}
                          </td>
                          <td className="py-2.5 px-3 text-center font-mono font-bold text-rose-700">
                            {m.min_threshold}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <div className="flex items-center justify-end space-x-1">
                              <button
                                onClick={() => handleOpenEditMetric(m)}
                                className="p-1.5 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
                                title="Edit Parameter Metric"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeleteMetric(m.metric_id, m.metric_name)}
                                className="p-1.5 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                                title="Hapus Metric"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between text-xs text-gray-500">
          <div className="flex items-center space-x-2">
            <HelpCircle className="w-4 h-4 text-gray-400" />
            <span>Perubahan parameter metrik, bobot, dan threshold otomatis tersinkronisasi ke penghitungan PE Index.</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-gray-700 bg-white border border-gray-300 hover:bg-gray-100 rounded-lg shadow-2xs transition"
          >
            Tutup
          </button>
        </div>

      </div>

      {/* Reset Confirmation Sub-Modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-60 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl border border-gray-300 animate-in zoom-in-95">
            <div className="flex items-center space-x-3 text-amber-600 mb-3">
              <AlertCircle className="w-6 h-6 shrink-0" />
              <h3 className="text-base font-bold text-gray-900">Konfirmasi Reset Parameter</h3>
            </div>
            <p className="text-xs text-gray-600 mb-5 leading-relaxed">
              Tindakan ini akan mengembalikan seluruh parameter **6 Journey, Checkpoints, 27 Metrik bawaan, Bobot, Threshold, dan Klasifikasi Responden Non-Karyawan** ke konfigurasi awal bawaan CIMB Niaga. Metrik kustom yang baru ditambahkan akan terhapus. Lanjutkan?
            </p>
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="px-4 py-2 text-xs font-bold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
              >
                Batal
              </button>
              <button
                onClick={handleResetParameters}
                disabled={loading}
                className="px-4 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg flex items-center space-x-1.5 shadow transition"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Ya, Reset ke Default</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
