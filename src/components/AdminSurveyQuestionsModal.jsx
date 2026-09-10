// src/components/AdminSurveyQuestionsModal.jsx
import React, { useState, useEffect } from 'react';
import { 
  X, 
  HelpCircle, 
  Plus, 
  Trash2, 
  Save, 
  RotateCcw, 
  Download, 
  CheckCircle2, 
  AlertCircle, 
  FileSpreadsheet, 
  ArrowUp, 
  ArrowDown,
  Sparkles,
  Layers,
  Check,
  ListOrdered
} from 'lucide-react';

const QUESTION_TYPES = [
  { value: 'SCALE_1_5', label: '1. Scale 1 - 5 (Rating 1.0 to 5.0)', desc: 'Score rating 1 to 5, normalized as (score/5)*100' },
  { value: 'SCALE_1_10', label: '2. Scale 1 - 10 (Rating 1.0 to 10.0)', desc: 'Score rating 1 to 10, normalized as (score/10)*100' },
  { value: 'YES_NO', label: '3. Yes / No Binary (Score 100 / 0)', desc: 'Binary choice: Yes = 100%, No = 0%' },
  { value: 'FREE_TEXT', label: '4. Free Text Response (Qualitative / Feedback)', desc: 'Open text feedback without numeric scale' }
];

export default function AdminSurveyQuestionsModal({
  isOpen,
  onClose,
  initialMetricId = 7,
  calculationData,
  onSaveSuccess
}) {
  const [surveyMetrics, setSurveyMetrics] = useState([]);
  const [selectedMetricId, setSelectedMetricId] = useState(initialMetricId || 7);
  const [questions, setQuestions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [alertMessage, setAlertMessage] = useState(null);
  const [showPreview, setShowPreview] = useState(false);

  // Load survey metrics and initial questions
  useEffect(() => {
    if (isOpen) {
      fetchSurveyMetrics();
      if (initialMetricId) {
        setSelectedMetricId(initialMetricId);
      }
    }
  }, [isOpen, initialMetricId]);

  useEffect(() => {
    if (isOpen && selectedMetricId) {
      loadMetricQuestions(selectedMetricId);
    }
  }, [selectedMetricId, isOpen]);

  const fetchSurveyMetrics = async () => {
    try {
      const res = await fetch('/api/surveys/metrics');
      if (res.ok) {
        const data = await res.json();
        setSurveyMetrics(data);
      }
    } catch (err) {
      console.error('Error loading survey metrics:', err);
    }
  };

  const loadMetricQuestions = async (mId) => {
    setIsLoading(true);
    setAlertMessage(null);
    try {
      const res = await fetch(`/api/admin/survey-questions/${mId}`);
      if (res.ok) {
        const data = await res.json();
        setQuestions(data.questions || []);
      }
    } catch (err) {
      setAlertMessage({ type: 'error', text: 'Failed to load questions: ' + err.message });
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  const currentMetric = surveyMetrics.find(m => m.metric_id === parseInt(selectedMetricId)) || 
    calculationData?.metrics?.find(m => m.metric_id === parseInt(selectedMetricId));

  const handleQuestionChange = (index, field, value) => {
    setQuestions(prev => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        [field]: value
      };
      // Auto update key if label changes and key looks default
      if (field === 'label' && (!updated[index].key || updated[index].key.startsWith('q'))) {
        const cleanKey = 'q' + (index + 1) + '_' + value.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 20);
        updated[index].key = cleanKey;
      }
      return updated;
    });
  };

  const handleAddQuestion = () => {
    const nextIdx = questions.length + 1;
    const newQ = {
      key: `q${nextIdx}_item`,
      label: `New Question ${nextIdx}`,
      text: 'Enter the full question prompt here...',
      type: 'SCALE_1_5',
      mandatory: true
    };
    setQuestions([...questions, newQ]);
  };

  const handleDeleteQuestion = (index) => {
    if (questions.length <= 1) {
      alert('The survey template must contain at least 1 question.');
      return;
    }
    if (window.confirm(`Delete question '${questions[index].label}'?`)) {
      setQuestions(questions.filter((_, i) => i !== index));
    }
  };

  const handleMove = (index, direction) => {
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= questions.length) return;
    const updated = [...questions];
    const temp = updated[index];
    updated[index] = updated[targetIdx];
    updated[targetIdx] = temp;
    setQuestions(updated);
  };

  const handleSave = async () => {
    // Validation: make sure all questions have label and text
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.label || !q.label.trim()) {
        setAlertMessage({ type: 'error', text: `Question #${i + 1} label cannot be empty.` });
        return;
      }
      if (!q.text || !q.text.trim()) {
        setAlertMessage({ type: 'error', text: `Question #${i + 1} prompt cannot be empty.` });
        return;
      }
    }

    setIsSaving(true);
    setAlertMessage(null);
    try {
      const res = await fetch(`/api/admin/survey-questions/${selectedMetricId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions })
      });

      if (res.ok) {
        setAlertMessage({ type: 'success', text: `Question template for metric '${currentMetric?.metric_name || selectedMetricId}' saved and active!` });
        if (onSaveSuccess) onSaveSuccess();
        setTimeout(() => setAlertMessage(null), 4000);
      } else {
        const err = await res.json();
        setAlertMessage({ type: 'error', text: err.error || 'Failed to save questions' });
      }
    } catch (err) {
      setAlertMessage({ type: 'error', text: err.message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm(`Reset question template for '${currentMetric?.metric_name}' to system default?`)) {
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch(`/api/admin/survey-questions/${selectedMetricId}/reset`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setQuestions(data.questions || []);
        setAlertMessage({ type: 'success', text: 'Template successfully reset to system default!' });
        if (onSaveSuccess) onSaveSuccess();
        setTimeout(() => setAlertMessage(null), 3500);
      }
    } catch (err) {
      setAlertMessage({ type: 'error', text: err.message });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden border border-slate-100">
        
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-red-700 via-red-600 to-rose-700 text-white px-6 py-4.5 flex items-center justify-between shadow-md">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-white/15 rounded-xl backdrop-blur-md border border-white/20">
              <HelpCircle className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white tracking-tight">
                  Survey Question & Template Management
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-400 text-amber-950 uppercase tracking-wider">
                  ADMIN ONLY
                </span>
              </div>
              <p className="text-xs text-red-100 mt-0.5">
                Customize question items, scale types, and CSV import structures per survey metric
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 rounded-xl text-white/80 hover:text-white hover:bg-white/15 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Metric Selector Bar */}
        <div className="bg-slate-50 border-b border-slate-200 px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-[280px]">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-red-600" />
              Select Survey Metric:
            </label>
            <select
              value={selectedMetricId}
              onChange={(e) => setSelectedMetricId(parseInt(e.target.value))}
              className="flex-1 bg-white border border-slate-300 rounded-xl px-3.5 py-2 text-sm font-semibold text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
            >
              {surveyMetrics.map(m => (
                <option key={m.metric_id} value={m.metric_id}>
                  #{m.metric_id} — {m.metric_name} ({m.experience_owner || 'HR'})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <a
              href={`/api/surveys/template?metric_id=${selectedMetricId}`}
              download
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-colors shadow-sm"
              title="Download CSV Template with active questions"
            >
              <Download className="w-3.5 h-3.5" />
              Download CSV Template
            </a>
            <button
              onClick={() => setShowPreview(!showPreview)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 transition-colors shadow-sm"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-blue-600" />
              {showPreview ? 'Hide Columns' : 'Preview Columns'}
            </button>
          </div>
        </div>

        {/* Alert notification banner */}
        {alertMessage && (
          <div className={`mx-6 mt-4 p-3.5 rounded-xl border flex items-center gap-3 animate-fade-in ${
            alertMessage.type === 'success' 
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
              : 'bg-red-50 border-red-200 text-red-800'
          }`}>
            {alertMessage.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
            )}
            <p className="text-xs font-semibold">{alertMessage.text}</p>
          </div>
        )}

        {/* Template Column Structure Preview */}
        {showPreview && (
          <div className="mx-6 mt-3 p-4 bg-slate-900 text-slate-200 rounded-xl text-xs space-y-2 animate-fade-in">
            <div className="flex items-center justify-between">
              <span className="font-bold text-white flex items-center gap-1.5">
                <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                Standard CSV Header Preview for Metric #{selectedMetricId}:
              </span>
              <span className="text-[11px] text-slate-400">{questions.length} Active Questions</span>
            </div>
            <div className="overflow-x-auto font-mono text-[11px] bg-slate-950 p-3 rounded-lg border border-slate-800 text-emerald-300">
              nip, employee_name, cimb_email, directorate, division, survey_date, {questions.map(q => q.key).join(', ')}, verbatim_feedback
            </div>
          </div>
        )}

        {/* Modal Body: Question List */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {isLoading ? (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-red-600 mb-2"></div>
              <p className="text-xs text-slate-500">Loading question configuration...</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between pb-1 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <ListOrdered className="w-4 h-4 text-red-600" />
                  <h3 className="text-sm font-bold text-slate-800">
                    Survey Questions List ({questions.length} Items)
                  </h3>
                  {selectedMetricId === 7 && (
                    <span className="text-[10px] bg-rose-50 text-rose-700 px-2 py-0.5 rounded-full font-bold border border-rose-200">
                      Standard Day 1 Onboarding Template
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleAddQuestion}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-colors shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Question
                </button>
              </div>

              {questions.length === 0 ? (
                <div className="text-center py-10 bg-slate-50 rounded-2xl border border-dashed border-slate-300">
                  <p className="text-xs text-slate-500 font-medium">No questions defined for this metric yet.</p>
                  <button
                    onClick={handleAddQuestion}
                    className="mt-2 px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-bold"
                  >
                    Add First Question
                  </button>
                </div>
              ) : (
                <div className="space-y-3.5">
                  {questions.map((q, idx) => (
                    <div 
                      key={idx}
                      className="p-4 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition-all shadow-xs space-y-3"
                    >
                      {/* Row 1: Number, Label, Type, Actions */}
                      <div className="flex flex-wrap items-center justify-between gap-2.5">
                        <div className="flex items-center gap-2.5 flex-1 min-w-[240px]">
                          <span className="w-6 h-6 rounded-full bg-red-50 text-red-700 text-xs font-black flex items-center justify-center flex-shrink-0 border border-red-100">
                            {idx + 1}
                          </span>
                          <input
                            type="text"
                            value={q.label || ''}
                            onChange={(e) => handleQuestionChange(idx, 'label', e.target.value)}
                            placeholder="Short Label (e.g. Recruitment Process Satisfaction)"
                            className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-800 focus:bg-white focus:ring-1 focus:ring-red-500"
                          />
                        </div>

                        {/* Question Type Selector */}
                        <div className="flex items-center gap-2">
                          <select
                            value={q.type || 'SCALE_1_5'}
                            onChange={(e) => handleQuestionChange(idx, 'type', e.target.value)}
                            className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-700 focus:bg-white focus:ring-1 focus:ring-red-500"
                          >
                            {QUESTION_TYPES.map(t => (
                              <option key={t.value} value={t.value}>{t.label}</option>
                            ))}
                          </select>

                          {/* Move up / down / delete */}
                          <div className="flex items-center gap-1 border-l border-slate-200 pl-2">
                            <button
                              type="button"
                              onClick={() => handleMove(idx, 'up')}
                              disabled={idx === 0}
                              className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30 rounded hover:bg-slate-100"
                              title="Move Up"
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMove(idx, 'down')}
                              disabled={idx === questions.length - 1}
                              className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30 rounded hover:bg-slate-100"
                              title="Move Down"
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteQuestion(idx)}
                              className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                              title="Delete Question"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Row 2: Full Question Text */}
                      <div>
                        <textarea
                          rows={2}
                          value={q.text || ''}
                          onChange={(e) => handleQuestionChange(idx, 'text', e.target.value)}
                          placeholder="Enter the full question prompt for respondents..."
                          className="w-full bg-slate-50/50 border border-slate-200 rounded-lg p-2.5 text-xs text-slate-700 focus:bg-white focus:ring-1 focus:ring-red-500"
                        />
                      </div>

                      {/* Row 3: Meta Key & Type Indicator */}
                      <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-50">
                        <div className="flex items-center gap-3">
                          <span>CSV Column Key: <code className="font-mono text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded font-semibold">{q.key}</code></span>
                          <label className="flex items-center gap-1 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={q.mandatory !== false}
                              onChange={(e) => handleQuestionChange(idx, 'mandatory', e.target.checked)}
                              className="rounded text-red-600 focus:ring-red-500 w-3.5 h-3.5"
                            />
                            <span>Required</span>
                          </label>
                        </div>
                        <span className="font-medium text-slate-600">
                          {QUESTION_TYPES.find(t => t.value === (q.type || 'SCALE_1_5'))?.desc}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="bg-slate-50 border-t border-slate-200 px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleReset}
            disabled={isSaving}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-slate-600 hover:text-red-700 hover:bg-red-50 rounded-xl border border-slate-300 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset to Default
          </button>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="inline-flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 text-white rounded-xl text-xs font-bold shadow-md hover:shadow-lg transition-all disabled:opacity-50"
            >
              {isSaving ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save Question Template
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
