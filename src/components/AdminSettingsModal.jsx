// src/components/AdminSettingsModal.jsx
import React, { useState, useEffect } from 'react';
import { 
  X, 
  Settings2, 
  Save, 
  RotateCcw, 
  CheckCircle2, 
  AlertTriangle, 
  SlidersHorizontal,
  Layers,
  Sparkles,
  HelpCircle
} from 'lucide-react';

export default function AdminSettingsModal({ 
  isOpen, 
  onClose, 
  calculationData, 
  onSaveSuccess 
}) {
  const [activeJourneyTab, setActiveJourneyTab] = useState('ALL');
  const [editableTargets, setEditableTargets] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState(null);

  useEffect(() => {
    if (calculationData?.metrics) {
      const initialMap = {};
      calculationData.metrics.forEach(m => {
        initialMap[m.metric_id] = {
          target_value: m.target_value,
          target_display: m.target_display || '',
          min_threshold: m.min_threshold
        };
      });
      setEditableTargets(initialMap);
    }
  }, [calculationData, isOpen]);

  if (!isOpen) return null;

  const metrics = calculationData?.metrics || [];
  const journeys = calculationData?.journeys || [];

  const filteredMetrics = activeJourneyTab === 'ALL'
    ? metrics
    : metrics.filter(m => m.journey_id === parseInt(activeJourneyTab));

  const handleChange = (metricId, field, value) => {
    setEditableTargets(prev => ({
      ...prev,
      [metricId]: {
        ...prev[metricId],
        [field]: value
      }
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage(null);
    try {
      const payload = Object.keys(editableTargets).map(id => ({
        metric_id: parseInt(id),
        target_value: parseFloat(editableTargets[id].target_value),
        target_display: editableTargets[id].target_display,
        min_threshold: parseFloat(editableTargets[id].min_threshold)
      }));

      const res = await fetch('/api/admin/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targets: payload })
      });

      if (res.ok) {
        setSaveMessage({ type: 'success', text: 'Targets & Thresholds saved and applied to all PX calculations!' });
        if (onSaveSuccess) onSaveSuccess();
        setTimeout(() => setSaveMessage(null), 3500);
      } else {
        const err = await res.json();
        setSaveMessage({ type: 'error', text: err.error || 'Failed to save targets' });
      }
    } catch (err) {
      setSaveMessage({ type: 'error', text: err.message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm('Are you sure you want to reset all targets and minimum thresholds to default values?')) {
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch('/api/admin/targets/reset', { method: 'POST' });
      if (res.ok) {
        setSaveMessage({ type: 'success', text: 'Targets successfully reset to default values.' });
        if (onSaveSuccess) onSaveSuccess();
        setTimeout(() => setSaveMessage(null), 3000);
      }
    } catch (err) {
      setSaveMessage({ type: 'error', text: err.message });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-5xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-gray-200 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Top Corporate Red Accent */}
        <div className="h-1.5 bg-gradient-to-r from-[#ED1C24] via-[#D91B23] to-[#800D12]" />

        {/* Modal Header */}
        <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-gray-50/60">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-red-100 text-[#ED1C24] flex items-center justify-center font-bold">
              <Settings2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-lg font-extrabold text-[#231F20]">
                  Admin Settings: Metric Targets & Thresholds
                </h2>
                <span className="px-2 py-0.5 bg-red-100 text-[#ED1C24] text-[10px] font-bold rounded-full">
                  Admin Master
                </span>
              </div>
              <p className="text-xs text-gray-500">
                Modify performance target values, display strings, and minimum alert thresholds across all metrics.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-200 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Journey Filter Tabs */}
        <div className="px-5 pt-3 pb-2 border-b border-gray-200 bg-white flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setActiveJourneyTab('ALL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              activeJourneyTab === 'ALL'
                ? 'bg-[#231F20] text-white shadow-xs'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            All Journeys ({metrics.length})
          </button>
          {journeys.map(j => (
            <button
              key={j.journey_id}
              onClick={() => setActiveJourneyTab(j.journey_id.toString())}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center space-x-1.5 ${
                activeJourneyTab === j.journey_id.toString()
                  ? 'text-white shadow-xs'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              style={activeJourneyTab === j.journey_id.toString() ? { backgroundColor: j.color } : {}}
            >
              <span>{j.journey_name}</span>
              <span className="text-[10px] opacity-80">({j.metrics_count})</span>
            </button>
          ))}
        </div>

        {/* Save Message Notification */}
        {saveMessage && (
          <div className={`mx-5 mt-3 p-3 rounded-xl text-xs font-bold flex items-center space-x-2 border ${
            saveMessage.type === 'success' 
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
              : 'bg-red-50 text-red-800 border-red-200'
          }`}>
            {saveMessage.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            <span>{saveMessage.text}</span>
          </div>
        )}

        {/* Modal Body: Metrics Table */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="border border-gray-200 rounded-xl overflow-x-auto shadow-xs">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-100/90 text-gray-700 font-bold uppercase tracking-wider border-b border-gray-200">
                <tr>
                  <th className="py-3 px-3 w-12 text-center">ID</th>
                  <th className="py-3 px-3 min-w-[240px]">Metric Name & PIC</th>
                  <th className="py-3 px-3 w-28 text-center">Type & Scale</th>
                  <th className="py-3 px-3 w-36">Target Value (Num)</th>
                  <th className="py-3 px-3 w-44">Target Display</th>
                  <th className="py-3 px-3 w-36">Min Threshold (%)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredMetrics.map(m => {
                  const targetState = editableTargets[m.metric_id] || {
                    target_value: m.target_value,
                    target_display: m.target_display,
                    min_threshold: m.min_threshold
                  };

                  return (
                    <tr key={m.metric_id} className="hover:bg-gray-50/70 transition">
                      <td className="py-3 px-3 text-center font-bold text-gray-500">
                        #{m.metric_id}
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-bold text-gray-900 leading-snug">
                          {m.metric_name}
                        </div>
                        <div className="text-[10px] text-gray-500 mt-0.5">
                          Owner: <span className="font-medium text-gray-700">{m.experience_owner}</span> • Source: {m.source_of_data}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          m.metric_type === 'SURVEY' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                        }`}>
                          {m.metric_type}
                        </span>
                        <div className="text-[10px] text-gray-400 mt-0.5">{m.scale_type}</div>
                      </td>
                      <td className="py-3 px-3">
                        <input
                          type="number"
                          step="0.01"
                          value={targetState.target_value}
                          onChange={(e) => handleChange(m.metric_id, 'target_value', e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs font-bold text-gray-900 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#ED1C24]"
                        />
                      </td>
                      <td className="py-3 px-3">
                        <input
                          type="text"
                          value={targetState.target_display}
                          onChange={(e) => handleChange(m.metric_id, 'target_display', e.target.value)}
                          placeholder="e.g. > 4.00 / 5"
                          className="w-full px-2.5 py-1.5 text-xs text-gray-900 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#ED1C24]"
                        />
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex items-center space-x-1">
                          <input
                            type="number"
                            step="1"
                            min="0"
                            max="100"
                            value={targetState.min_threshold}
                            onChange={(e) => handleChange(m.metric_id, 'min_threshold', e.target.value)}
                            className="w-full px-2.5 py-1.5 text-xs font-bold text-gray-900 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#ED1C24]"
                          />
                          <span className="text-xs text-gray-500 font-bold">%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
          <button
            onClick={handleReset}
            disabled={isSaving}
            className="px-3.5 py-2 text-xs font-bold text-gray-600 hover:text-red-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-100 flex items-center space-x-1.5 transition"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset to Default</span>
          </button>

          <div className="flex items-center space-x-2">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-xl text-xs font-bold transition"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-5 py-2 bg-[#ED1C24] hover:bg-[#D91B23] text-white rounded-xl text-xs font-bold flex items-center space-x-1.5 transition shadow-xs disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>{isSaving ? 'Saving...' : 'Save Target Changes'}</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
