import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, Calendar, MapPin, Users, HelpCircle } from 'lucide-react';

export default function CreateEventModal({ isOpen, onClose, onCreateEvent }) {
  const [formData, setFormData] = useState({
    event_name: '',
    program_category: 'Perspektif',
    event_date: new Date().toISOString().slice(0, 16),
    event_type: 'HYBRID',
    location: 'Auditorium Menara CIMB Niaga',
    target_participants: 500,
    pre_event_code: '',
    post_event_code: ''
  });

  const [masterQuestions, setMasterQuestions] = useState([]);
  const [eventQuestions, setEventQuestions] = useState([]);
  const [newQuestionText, setNewQuestionText] = useState('');
  const [newQuestionType, setNewQuestionType] = useState('RATING_5');

  useEffect(() => {
    if (isOpen) {
      // Fetch master default questions
      fetch('/api/questions/master')
        .then(res => res.json())
        .then(data => {
          setMasterQuestions(data);
          setEventQuestions(data.map(q => ({ ...q })));
        });

      const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
      setFormData(prev => ({
        ...prev,
        pre_event_code: `EVENT-${randomSuffix}`,
        post_event_code: `EVAL-${randomSuffix}`
      }));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleAddCustomQuestion = () => {
    if (!newQuestionText.trim()) return;
    setEventQuestions(prev => [
      ...prev,
      {
        question_id: `custom-${Date.now()}`,
        question_text: newQuestionText.trim(),
        question_type: newQuestionType,
        display_order: prev.length + 1,
        is_default: false
      }
    ]);
    setNewQuestionText('');
  };

  const handleRemoveQuestion = (idx) => {
    setEventQuestions(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onCreateEvent({
      ...formData,
      questions: eventQuestions
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-5 my-8">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-4 border-b border-gray-100">
          <div>
            <span className="text-[10px] font-bold text-[#ED1C24] uppercase tracking-wider">Signature Program Module</span>
            <h3 className="text-lg font-extrabold text-[#231F20]">Create New Signature Event</h3>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs font-medium">
          
          {/* Event Name */}
          <div className="space-y-1">
            <label className="text-gray-700 font-bold">Event / Program Name</label>
            <input
              type="text"
              required
              value={formData.event_name}
              onChange={(e) => setFormData({ ...formData, event_name: e.target.value })}
              placeholder="e.g. Perspektif: Agile Leadership & High Performance Team"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#ED1C24] text-xs font-semibold"
            />
          </div>

          {/* Category & Format */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-gray-700 font-bold">Program Category</label>
              <select
                value={formData.program_category}
                onChange={(e) => setFormData({ ...formData, program_category: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#ED1C24] text-xs font-semibold"
              >
                <option value="Perspektif">Perspektif</option>
                <option value="D&I">D&I (Diversity & Inclusion)</option>
                <option value="Young">Young CIMB</option>
                <option value="EVD">EVD (Employee Value & Development)</option>
                <option value="Special Program">Special Program</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-gray-700 font-bold">Execution Format</label>
              <select
                value={formData.event_type}
                onChange={(e) => setFormData({ ...formData, event_type: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#ED1C24] text-xs font-semibold"
              >
                <option value="HYBRID">Hybrid (Onsite + Online)</option>
                <option value="OFFLINE">Offline / In-Person</option>
                <option value="ONLINE">Online Streaming (Zoom / Teams)</option>
              </select>
            </div>
          </div>

          {/* Date, Location, Target Pax */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-gray-700 font-bold">Event Schedule</label>
              <input
                type="datetime-local"
                required
                value={formData.event_date}
                onChange={(e) => setFormData({ ...formData, event_date: e.target.value })}
                className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#ED1C24] text-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="text-gray-700 font-bold">Location / Venue</label>
              <input
                type="text"
                required
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#ED1C24] text-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="text-gray-700 font-bold">Target Participants (Pax)</label>
              <input
                type="number"
                min="10"
                required
                value={formData.target_participants}
                onChange={(e) => setFormData({ ...formData, target_participants: parseInt(e.target.value) || 500 })}
                className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#ED1C24] text-xs font-bold"
              />
            </div>
          </div>

          {/* Unique URL Codes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <div className="space-y-1 bg-gray-50 p-2.5 rounded-lg border border-gray-200">
              <label className="text-gray-600 font-bold text-[11px]">Pre-Event Attendance Code</label>
              <input
                type="text"
                value={formData.pre_event_code}
                onChange={(e) => setFormData({ ...formData, pre_event_code: e.target.value.toUpperCase() })}
                className="w-full px-2 py-1 bg-white border border-gray-300 rounded font-mono font-bold text-[#ED1C24] text-xs"
              />
            </div>

            <div className="space-y-1 bg-gray-50 p-2.5 rounded-lg border border-gray-200">
              <label className="text-gray-600 font-bold text-[11px]">Post-Event Evaluation Code</label>
              <input
                type="text"
                value={formData.post_event_code}
                onChange={(e) => setFormData({ ...formData, post_event_code: e.target.value.toUpperCase() })}
                className="w-full px-2 py-1 bg-white border border-gray-300 rounded font-mono font-bold text-emerald-700 text-xs"
              />
            </div>
          </div>

          {/* Custom Survey Questions Editor */}
          <div className="space-y-2 pt-3 border-t border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-extrabold text-gray-800 text-xs">
                  Post-Event Evaluation Questionnaire Questions ({eventQuestions.length})
                </span>
                <p className="text-[10px] text-gray-400">
                  Default questions loaded from master template. Customizations here apply to this event only.
                </p>
              </div>
            </div>

            {/* Questions List */}
            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
              {eventQuestions.map((q, idx) => (
                <div key={idx} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg border border-gray-200 text-[11px]">
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-gray-400">{idx + 1}.</span>
                    <span className="text-gray-700 font-medium">{q.question_text}</span>
                    <span className="text-[9px] px-1.5 py-0.2 bg-gray-200 rounded text-gray-600 font-bold uppercase">
                      {q.question_type}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveQuestion(idx)}
                    className="text-red-500 hover:text-red-700 p-1"
                    title="Delete Question"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {/* Add Custom Question Input */}
            <div className="flex items-center space-x-2 pt-1">
              <input
                type="text"
                value={newQuestionText}
                onChange={(e) => setNewQuestionText(e.target.value)}
                placeholder="Add custom question for this event..."
                className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-xs"
              />
              <select
                value={newQuestionType}
                onChange={(e) => setNewQuestionType(e.target.value)}
                className="px-2 py-1.5 border border-gray-300 rounded-lg text-xs font-semibold"
              >
                <option value="RATING_5">Scale Rating (1-5)</option>
                <option value="TEXT_VERBATIM">Verbatim Text</option>
              </select>
              <button
                type="button"
                onClick={handleAddCustomQuestion}
                className="px-3 py-1.5 bg-gray-800 hover:bg-black text-white rounded-lg text-xs font-bold transition flex items-center space-x-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add</span>
              </button>
            </div>
          </div>

          {/* Modal Footer Actions */}
          <div className="flex justify-end space-x-2 pt-4 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-bold text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-[#ED1C24] hover:bg-[#D91B23] text-white rounded-lg font-bold text-xs shadow-sm"
            >
              Save & Create Event
            </button>
          </div>

        </form>

      </div>
    </div>
  );
}
