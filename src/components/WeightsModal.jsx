import React, { useState } from 'react';
import { X, SlidersHorizontal, RotateCcw, Save } from 'lucide-react';

export default function WeightsModal({ isOpen, onClose, metrics, onSaveWeights }) {
  const [weights, setWeights] = useState({});
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (metrics) {
      const initial = {};
      metrics.forEach(m => {
        initial[m.metric_id] = m.weight !== undefined ? m.weight : 1.0;
      });
      setWeights(initial);
    }
  }, [metrics, isOpen]);

  if (!isOpen) return null;

  const handleWeightChange = (metricId, val) => {
    setWeights(prev => ({
      ...prev,
      [metricId]: parseFloat(val) || 0
    }));
  };

  const handleResetEqual = () => {
    const equalWeights = {};
    metrics.forEach(m => {
      equalWeights[m.metric_id] = 1.0;
    });
    setWeights(equalWeights);
  };

  const handleSave = async () => {
    setSaving(true);
    const payload = Object.entries(weights).map(([metric_id, weight]) => ({
      metric_id: parseInt(metric_id),
      weight: parseFloat(weight)
    }));
    try {
      await onSaveWeights(payload);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-3xl w-full p-6 shadow-2xl space-y-5 my-8">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-gray-100">
          <div className="flex items-center space-x-2">
            <SlidersHorizontal className="w-5 h-5 text-[#ED1C24]" />
            <div>
              <h3 className="text-base font-extrabold text-[#231F20]">
                Metric Weights Configuration (Dynamic Weights)
              </h3>
              <p className="text-[11px] text-gray-500">
                Adjust the relative weight proportion of each metric in Survey & Outcome aggregations.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Action Button */}
        <div className="flex justify-between items-center bg-gray-50 p-3 rounded-xl border border-gray-200 text-xs">
          <span className="text-gray-600 font-medium">
            Current Default: <strong>Equal Weight (1.0x per metric)</strong>
          </span>
          <button
            onClick={handleResetEqual}
            className="px-3 py-1 bg-white hover:bg-gray-100 text-gray-700 border border-gray-300 rounded-lg font-bold flex items-center space-x-1"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Equal</span>
          </button>
        </div>

        {/* Weights List */}
        <div className="space-y-2 max-h-96 overflow-y-auto pr-2 text-xs">
          {metrics?.map((m) => (
            <div key={m.metric_id} className="flex items-center justify-between p-2.5 bg-white hover:bg-gray-50 rounded-lg border border-gray-200">
              <div className="max-w-md">
                <span className="text-[10px] font-bold text-gray-400 uppercase">
                  #{m.metric_id} • {m.metric_type}
                </span>
                <p className="font-bold text-gray-800 leading-snug">{m.metric_name}</p>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="number"
                  min="0.1"
                  max="10.0"
                  step="0.1"
                  value={weights[m.metric_id] !== undefined ? weights[m.metric_id] : 1.0}
                  onChange={(e) => handleWeightChange(m.metric_id, e.target.value)}
                  className="w-16 px-2 py-1 text-xs border border-gray-300 rounded-md font-bold text-center text-[#ED1C24] focus:ring-2 focus:ring-[#ED1C24]"
                />
                <span className="text-gray-400 font-bold text-[10px]">x</span>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex justify-end space-x-2 pt-3 border-t border-gray-100">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-bold text-xs"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 bg-[#ED1C24] hover:bg-[#D91B23] text-white rounded-lg font-bold text-xs flex items-center space-x-1.5 shadow-sm"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? 'Saving...' : 'Apply New Weights'}</span>
          </button>
        </div>

      </div>
    </div>
  );
}
