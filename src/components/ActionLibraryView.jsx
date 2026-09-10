import React from 'react';
import { BookOpen, Sparkles, Plus, Layers, CheckCircle } from 'lucide-react';

export default function ActionLibraryView({ actionLibrary, metrics, checkpoints }) {
  return (
    <div className="space-y-6">
      
      {/* Top Banner */}
      <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <BookOpen className="w-5 h-5 text-[#ED1C24]" />
            <h3 className="text-base font-extrabold text-[#231F20]">
              PX Action Library & Best Practice Interventions (Slide 10)
            </h3>
          </div>
          <p className="text-xs text-gray-500">
            Catalog of improvement actions and initiatives automatically triggered by the system when a metric falls into a score deficit.
          </p>
        </div>
      </div>

      {/* Action Library Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {actionLibrary?.map((item, idx) => {
          const metric = metrics?.find(m => m.metric_id === item.metric_id);
          const cp = checkpoints?.find(c => c.checkpoint_id === item.checkpoint_id || (metric && metric.checkpoint_id === c.checkpoint_id));

          return (
            <div key={idx} className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs space-y-3">
              <div className="flex items-start justify-between">
                <span className="px-2.5 py-0.5 rounded text-[10px] font-bold bg-red-50 text-[#ED1C24] border border-red-200">
                  {item.gap_condition}
                </span>
                <span className="text-xs text-gray-400 font-semibold">
                  {cp?.checkpoint_name || 'Checkpoint'}
                </span>
              </div>

              <div>
                <h4 className="text-sm font-bold text-[#231F20]">
                  {metric?.metric_name || 'Related Metric'}
                </h4>
                <p className="text-xs text-gray-600 mt-1 font-medium">
                  {item.recommended_action}
                </p>
              </div>

              {item.suggested_initiatives && (
                <div className="bg-gray-50 rounded-lg p-3 text-xs border border-gray-200 space-y-1">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
                    Structured Initiatives:
                  </span>
                  <div className="text-gray-700 whitespace-pre-line font-medium text-[11px]">
                    {item.suggested_initiatives}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

    </div>
  );
}
