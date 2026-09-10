import React, { useState, useEffect } from 'react';
import { CheckCircle2, UserCheck, AlertCircle, ArrowLeft } from 'lucide-react';
import CimbLogo from './CimbLogo';

export default function PublicCheckInForm({ eventCode, onBackToAdmin }) {
  const [eventData, setEventData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const [formData, setFormData] = useState({
    nip: '',
    employee_name: '',
    cimb_email: '',
    directorate: 'Information Technology',
    division: 'Core Banking Solution'
  });

  useEffect(() => {
    fetch(`/api/events/by-code/${eventCode}`)
      .then(res => {
        if (!res.ok) throw new Error('Event code not found');
        return res.json();
      })
      .then(data => {
        setEventData(data.event);
      })
      .catch(err => {
        setErrorMsg(err.message);
      })
      .finally(() => setLoading(false));
  }, [eventCode]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');

    try {
      const res = await fetch(`/api/events/${eventData.event_id}/attendance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit attendance');
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
      <div className="max-w-md w-full mx-auto flex items-center justify-between pb-4">
        <div className="flex items-center space-x-2">
          <CimbLogo className="h-7" />
          <span className="text-[10px] text-gray-500 font-bold border-l pl-2 border-gray-300">
            PX CHECK-IN
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
      <div className="max-w-md w-full mx-auto bg-white rounded-2xl border border-gray-200 shadow-lg p-6 sm:p-8 space-y-6">
        
        {submitted ? (
          <div className="text-center space-y-4 py-8">
            <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-xs">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <div>
              <h3 className="text-lg font-extrabold text-[#231F20]">Check-In Successful!</h3>
              <p className="text-xs text-gray-500 mt-1">
                Thank you, <strong>{formData.employee_name}</strong> (NIP: {formData.nip}). Your attendance for <strong>{eventData?.event_name}</strong> has been recorded.
              </p>
            </div>
            <div className="pt-4 border-t border-gray-100">
              <p className="text-[11px] text-gray-400">
                Please enjoy the event and participate actively!
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            
            {/* Event Header */}
            <div className="space-y-1">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-[#ED1C24] uppercase tracking-wider">
                Pre-Event Attendance Check-In
              </span>
              <h2 className="text-base font-extrabold text-[#231F20] leading-snug">
                {eventData?.event_name}
              </h2>
              <p className="text-xs text-gray-500">
                Format: <strong className="text-gray-700">{eventData?.event_type}</strong> | Location: <strong className="text-gray-700">{eventData?.location}</strong>
              </p>
            </div>

            {errorMsg && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-[#ED1C24] flex items-center space-x-2 font-medium">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-3.5 text-xs font-medium">
              
              <div className="space-y-1">
                <label className="text-gray-700 font-bold">Employee NIP <span className="text-[#ED1C24]">*</span></label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 8801923"
                  value={formData.nip}
                  onChange={(e) => setFormData({ ...formData, nip: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#ED1C24] text-xs font-semibold"
                />
              </div>

              <div className="space-y-1">
                <label className="text-gray-700 font-bold">Employee Full Name <span className="text-[#ED1C24]">*</span></label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ahmad Fauzi"
                  value={formData.employee_name}
                  onChange={(e) => setFormData({ ...formData, employee_name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#ED1C24] text-xs font-semibold"
                />
              </div>

              <div className="space-y-1">
                <label className="text-gray-700 font-bold">CIMB Niaga Email <span className="text-[#ED1C24]">*</span></label>
                <input
                  type="email"
                  required
                  placeholder="e.g. ahmad.fauzi@cimbniaga.co.id"
                  value={formData.cimb_email}
                  onChange={(e) => setFormData({ ...formData, cimb_email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#ED1C24] text-xs font-semibold"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-gray-700 font-bold">Directorate</label>
                  <input
                    type="text"
                    required
                    value={formData.directorate}
                    onChange={(e) => setFormData({ ...formData, directorate: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-xl text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-gray-700 font-bold">Division / Unit</label>
                  <input
                    type="text"
                    required
                    value={formData.division}
                    onChange={(e) => setFormData({ ...formData, division: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-xl text-xs"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-[#ED1C24] hover:bg-[#D91B23] text-white rounded-xl font-bold text-xs shadow-md transition pt-3"
              >
                Submit Attendance Check-In
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
