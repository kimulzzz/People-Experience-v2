import React, { useState, useEffect } from 'react';
import { Star, CheckCircle2, AlertCircle, ArrowLeft, Send } from 'lucide-react';
import CimbLogo from './CimbLogo';

export default function PublicFeedbackForm({ eventCode, onBackToAdmin }) {
  const [eventData, setEventData] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const [nip, setNip] = useState('');
  const [ratings, setRatings] = useState({});
  const [verbatim, setVerbatim] = useState('');

  useEffect(() => {
    fetch(`/api/events/by-code/${eventCode}`)
      .then(res => {
        if (!res.ok) throw new Error('Event code not found');
        return res.json();
      })
      .then(data => {
        setEventData(data.event);
        setQuestions(data.questions || []);

        // Initialize ratings with 5 stars default
        const initialRatings = {};
        (data.questions || []).forEach(q => {
          if (q.question_type === 'RATING_5') {
            initialRatings[q.question_id] = 5;
          }
        });
        setRatings(initialRatings);
      })
      .catch(err => {
        setErrorMsg(err.message);
      })
      .finally(() => setLoading(false));
  }, [eventCode]);

  const handleRatingChange = (qId, starVal) => {
    setRatings(prev => ({
      ...prev,
      [qId]: starVal
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');

    try {
      const res = await fetch(`/api/events/${eventData.event_id}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nip,
          ratings,
          verbatim
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit evaluation');
      setSubmitted(true);
    } catch (err) {
      setErrorMsg(err.message);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] flex items-center justify-center p-4">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#ED1C24]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex flex-col justify-between p-4 sm:p-6 font-['Plus_Jakarta_Sans',sans-serif]">
      
      {/* Top Brand Bar */}
      <div className="max-w-xl w-full mx-auto flex items-center justify-between pb-4">
        <div className="flex items-center space-x-2">
          <CimbLogo className="h-7" />
          <span className="text-[10px] text-gray-500 font-bold border-l pl-2 border-gray-300">
            PX EVALUATION
          </span>
        </div>
        
        {onBackToAdmin && (
          <button
            onClick={onBackToAdmin}
            className="text-xs font-bold text-gray-500 hover:text-gray-800 flex items-center space-x-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Admin</span>
          </button>
        )}
      </div>

      {/* Main Container */}
      <div className="max-w-xl w-full mx-auto bg-white rounded-2xl border border-gray-200 shadow-lg p-6 sm:p-8 space-y-6">
        
        {submitted ? (
          <div className="text-center space-y-4 py-8">
            <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-xs">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <div>
              <h3 className="text-lg font-extrabold text-[#231F20]">Evaluation Submitted Successfully!</h3>
              <p className="text-xs text-gray-600 mt-1">
                Thank you for your valuable rating and feedback for <strong>{eventData?.event_name}</strong>.
              </p>
            </div>
            <div className="pt-4 border-t border-gray-100">
              <p className="text-[11px] text-gray-400">
                Your feedback empowers continuous enhancement of People Experience across CIMB Niaga.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            
            {/* Header */}
            <div className="space-y-1">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 uppercase tracking-wider">
                Post-Event Satisfaction Evaluation
              </span>
              <h2 className="text-base font-extrabold text-[#231F20] leading-snug">
                {eventData?.event_name}
              </h2>
              <p className="text-xs text-gray-500">
                Please take 1 minute to provide your ratings and constructive suggestions.
              </p>
            </div>

            {errorMsg && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-[#ED1C24] flex items-center space-x-2 font-medium">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5 text-xs font-medium">
              
              {/* NIP Validation */}
              <div className="space-y-1 bg-gray-50 p-3.5 rounded-xl border border-gray-200">
                <label className="text-gray-700 font-bold block">
                  Employee NIP <span className="text-[#ED1C24]">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Enter your Employee ID / NIP (e.g. 8801923)"
                  value={nip}
                  onChange={(e) => setNip(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#ED1C24] text-xs font-semibold"
                />
                <span className="text-[10px] text-gray-400">
                  Used to verify 1 unique respondent response per event.
                </span>
              </div>

              {/* Dynamic Questions */}
              <div className="space-y-4 pt-2">
                {questions.map((q, idx) => {
                  if (q.question_type === 'RATING_5') {
                    const currentRating = ratings[q.question_id] || 5;
                    return (
                      <div key={q.question_id} className="p-4 bg-gray-50/70 rounded-xl border border-gray-200 space-y-2">
                        <label className="text-gray-800 font-bold block text-xs leading-snug">
                          {idx + 1}. {q.question_text}
                        </label>
                        
                        {/* Interactive Stars */}
                        <div className="flex items-center space-x-2 pt-1">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <button
                              key={star}
                              type="button"
                              onClick={() => handleRatingChange(q.question_id, star)}
                              className="p-1 focus:outline-hidden hover:scale-110 transition"
                            >
                              <Star
                                className={`w-7 h-7 ${
                                  star <= currentRating
                                    ? 'text-amber-400 fill-amber-400'
                                    : 'text-gray-300'
                                }`}
                              />
                            </button>
                          ))}
                          <span className="ml-2 font-extrabold text-sm text-gray-700">
                            {currentRating} / 5
                          </span>
                        </div>
                      </div>
                    );
                  }

                  if (q.question_type === 'TEXT_VERBATIM') {
                    return (
                      <div key={q.question_id} className="space-y-1">
                        <label className="text-gray-800 font-bold block text-xs">
                          {idx + 1}. {q.question_text}
                        </label>
                        <textarea
                          rows="3"
                          placeholder="Share your impressions, takeaways, or improvement suggestions..."
                          value={verbatim}
                          onChange={(e) => setVerbatim(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#ED1C24] text-xs"
                        />
                      </div>
                    );
                  }

                  return null;
                })}
              </div>

              <button
                type="submit"
                className="w-full py-3 bg-[#ED1C24] hover:bg-[#D91B23] text-white rounded-xl font-bold text-xs shadow-md transition flex items-center justify-center space-x-2"
              >
                <Send className="w-4 h-4" />
                <span>Submit Evaluation Feedback</span>
              </button>

            </form>

          </div>
        )}

      </div>

      {/* Footer */}
      <div className="text-center text-[10px] text-gray-400 pt-4">
        CIMB Niaga People Experience (PX) • Kejar Mimpi
      </div>

    </div>
  );
}
