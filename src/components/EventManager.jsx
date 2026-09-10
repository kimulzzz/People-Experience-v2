import React, { useState } from 'react';
import { 
  Plus, 
  Calendar, 
  MapPin, 
  Users, 
  Star, 
  QrCode, 
  Share2, 
  FileText, 
  Download, 
  Upload, 
  Image as ImageIcon, 
  Trash2, 
  Sparkles, 
  CheckCircle, 
  ExternalLink,
  MessageSquare,
  Copy,
  Clock,
  Video
} from 'lucide-react';

export default function EventManager({ 
  events, 
  onRefreshEvents,
  onOpenCreateEventModal,
  onOpenQrModal,
  onOpenPublicCheckIn,
  onOpenPublicSurvey
}) {
  const [selectedEventId, setSelectedEventId] = useState(events?.[0]?.event_id || null);
  const [eventDetail, setEventDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [generatingPpt, setGeneratingPpt] = useState(false);
  const [pptDownloadUrl, setPptDownloadUrl] = useState(null);

  const selectedEvent = events?.find(e => e.event_id === selectedEventId) || events?.[0];

  // Fetch Event Deep Details
  React.useEffect(() => {
    if (selectedEvent?.event_id) {
      fetchEventDetail(selectedEvent.event_id);
    }
  }, [selectedEvent?.event_id]);

  const fetchEventDetail = async (eventId) => {
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/events/${eventId}`);
      if (res.ok) {
        const data = await res.json();
        setEventDetail(data);
      }
    } catch (err) {
      console.error('Failed to load event detail:', err);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleMediaUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !selectedEvent) return;

    setUploadingMedia(true);
    const formData = new FormData();
    formData.append('mediaFile', file);
    formData.append('caption', `Documentation ${file.name}`);
    formData.append('file_type', file.type.startsWith('video') ? 'VIDEO' : 'IMAGE');

    try {
      const res = await fetch(`/api/events/${selectedEvent.event_id}/media`, {
        method: 'POST',
        body: formData
      });
      if (res.ok) {
        fetchEventDetail(selectedEvent.event_id);
      }
    } catch (err) {
      console.error('Media upload error:', err);
    } finally {
      setUploadingMedia(false);
    }
  };

  const handleDeleteMedia = async (mediaId) => {
    if (!confirm('Delete this media item?')) return;
    try {
      const res = await fetch(`/api/media/${mediaId}`, { method: 'DELETE' });
      if (res.ok && selectedEvent) {
        fetchEventDetail(selectedEvent.event_id);
      }
    } catch (err) {
      console.error('Delete media error:', err);
    }
  };

  const handleGeneratePpt = async () => {
    if (!selectedEvent) return;
    setGeneratingPpt(true);
    setPptDownloadUrl(null);
    try {
      const res = await fetch(`/api/events/${selectedEvent.event_id}/generate-ppt`, {
        method: 'POST'
      });
      const data = await res.json();
      if (data.success) {
        setPptDownloadUrl(data.download_url);
        // Trigger direct browser download
        const a = document.createElement('a');
        a.href = data.download_url;
        a.download = data.fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } catch (err) {
      alert('Failed to generate PPT: ' + err.message);
    } finally {
      setGeneratingPpt(false);
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Top Header Bar */}
      <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <Calendar className="w-5 h-5 text-[#ED1C24]" />
            <h3 className="text-base font-extrabold text-[#231F20]">
              Signature Programs Event Management & PPT Generator
            </h3>
          </div>
          <p className="text-xs text-gray-500">
            Manage Perspektif, D&I, Young, & EVD programs. Generate pre-event attendance QR codes, post-event evaluation surveys, and export automated reports to PowerPoint.
          </p>
        </div>

        <button
          onClick={onOpenCreateEventModal}
          className="px-4 py-2 bg-[#ED1C24] hover:bg-[#D91B23] text-white rounded-lg text-xs font-bold transition flex items-center space-x-2 shadow-sm"
        >
          <Plus className="w-4 h-4" />
          <span>Create New Signature Event</span>
        </button>
      </div>

      {/* Main Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Event List (4 cols) */}
        <div className="lg:col-span-4 space-y-3">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-bold text-gray-500 uppercase">Signature Event List</span>
            <span className="text-xs font-semibold text-gray-400">{events?.length || 0} Events</span>
          </div>

          <div className="space-y-3">
            {events?.map((ev) => {
              const isSelected = selectedEvent?.event_id === ev.event_id;
              return (
                <div
                  key={ev.event_id}
                  onClick={() => setSelectedEventId(ev.event_id)}
                  className={`p-4 rounded-xl border transition cursor-pointer ${
                    isSelected
                      ? 'bg-red-50/50 border-[#ED1C24] shadow-xs'
                      : 'bg-white border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-700">
                      {ev.program_category}
                    </span>
                    <span className="text-[10px] font-bold text-[#ED1C24]">
                      {ev.event_type}
                    </span>
                  </div>

                  <h4 className="text-xs font-bold text-[#231F20] mt-2 line-clamp-2">
                    {ev.event_name}
                  </h4>

                  <div className="mt-3 flex items-center justify-between text-[11px] text-gray-500 pt-2 border-t border-gray-100">
                    <div className="flex items-center space-x-1">
                      <Users className="w-3.5 h-3.5 text-gray-400" />
                      <span className="font-semibold text-gray-700">{ev.total_attendees || 0}</span>
                      <span>/ {ev.target_participants} pax</span>
                    </div>

                    <div className="flex items-center space-x-1">
                      <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                      <span className="font-bold text-gray-800">{ev.average_rating || '0.00'}</span>
                      <span className="text-gray-400">/ 5.0</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Selected Event Active Workspace (8 cols) */}
        <div className="lg:col-span-8 space-y-6">
          {selectedEvent ? (
            <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-xs space-y-6">
              
              {/* Event Header Banner */}
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-5 border-b border-gray-100">
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#ED1C24] text-white">
                      {selectedEvent.program_category}
                    </span>
                    <span className="text-xs text-gray-500 font-medium">
                      {new Date(selectedEvent.event_date).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                    </span>
                  </div>

                  <h2 className="text-lg font-extrabold text-[#231F20]">
                    {selectedEvent.event_name}
                  </h2>

                  <div className="flex items-center space-x-4 text-xs text-gray-500 pt-1">
                    <span className="flex items-center space-x-1">
                      <MapPin className="w-3.5 h-3.5 text-gray-400" />
                      <span>{selectedEvent.location}</span>
                    </span>
                    <span className="flex items-center space-x-1">
                      <Clock className="w-3.5 h-3.5 text-gray-400" />
                      <span>Format {selectedEvent.event_type}</span>
                    </span>
                  </div>
                </div>

                {/* Generate PPT Button */}
                <button
                  onClick={handleGeneratePpt}
                  disabled={generatingPpt}
                  className="px-4 py-2.5 bg-gradient-to-r from-[#231F20] to-[#3B3637] hover:from-[#ED1C24] hover:to-[#D91B23] text-white rounded-xl text-xs font-bold transition flex items-center space-x-2 shadow-md"
                >
                  <Download className="w-4 h-4" />
                  <span>{generatingPpt ? 'Generating PPT Slides...' : 'Download PPTX Report'}</span>
                </button>
              </div>

              {/* Quick Links & QR Distribution Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                
                {/* Pra-Event Link Card */}
                <div className="bg-blue-50/60 border border-blue-200 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-blue-900 flex items-center space-x-1.5">
                      <CheckCircle className="w-4 h-4 text-blue-600" />
                      <span>Attendance Link (Pre-Event)</span>
                    </span>
                    <button
                      onClick={() => onOpenQrModal(selectedEvent.pre_event_code, 'PRE-EVENT ATTENDANCE', selectedEvent.event_name)}
                      className="p-1.5 bg-white text-blue-700 rounded-lg border border-blue-200 hover:bg-blue-100 transition"
                      title="View QR Code"
                    >
                      <QrCode className="w-4 h-4" />
                    </button>
                  </div>

                  <p className="text-[11px] text-blue-800 font-medium">
                    Share this link during registration/attendance before the event begins.
                  </p>

                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => onOpenPublicCheckIn(selectedEvent.pre_event_code)}
                      className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition text-center"
                    >
                      Open Check-in Form
                    </button>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(`${window.location.origin}?checkin=${selectedEvent.pre_event_code}`);
                        alert('Attendance link copied to clipboard!');
                      }}
                      className="p-1.5 bg-white border border-blue-300 text-blue-700 rounded-lg hover:bg-blue-50 transition"
                      title="Copy Link"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Post-Event Survey Card */}
                <div className="bg-emerald-50/60 border border-emerald-200 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-900 flex items-center space-x-1.5">
                      <Star className="w-4 h-4 text-emerald-600 fill-emerald-600" />
                      <span>Evaluation Survey (Post-Event)</span>
                    </span>
                    <button
                      onClick={() => onOpenQrModal(selectedEvent.post_event_code, 'EVENT SATISFACTION EVALUATION', selectedEvent.event_name)}
                      className="p-1.5 bg-white text-emerald-700 rounded-lg border border-emerald-200 hover:bg-emerald-100 transition"
                      title="View QR Code"
                    >
                      <QrCode className="w-4 h-4" />
                    </button>
                  </div>

                  <p className="text-[11px] text-emerald-800 font-medium">
                    Share at the end of the event to gather satisfaction ratings & verbatim feedback.
                  </p>

                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => onOpenPublicSurvey(selectedEvent.post_event_code)}
                      className="flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition text-center"
                    >
                      Open Evaluation Form
                    </button>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(`${window.location.origin}?survey=${selectedEvent.post_event_code}`);
                        alert('Evaluation link copied to clipboard!');
                      }}
                      className="p-1.5 bg-white border border-emerald-300 text-emerald-700 rounded-lg hover:bg-emerald-50 transition"
                      title="Copy Link"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>

              </div>

              {/* Media Gallery Section */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <ImageIcon className="w-4 h-4 text-[#ED1C24]" />
                    <h4 className="text-sm font-extrabold text-[#231F20]">
                      Photo Gallery & Event Documentation
                    </h4>
                  </div>

                  <label className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-bold transition cursor-pointer flex items-center space-x-1.5">
                    <Upload className="w-3.5 h-3.5" />
                    <span>{uploadingMedia ? 'Uploading...' : 'Upload Photo / Video'}</span>
                    <input
                      type="file"
                      accept="image/*,video/*"
                      onChange={handleMediaUpload}
                      className="hidden"
                      disabled={uploadingMedia}
                    />
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {eventDetail?.media?.map((med) => (
                    <div key={med.media_id} className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2 relative group">
                      <div className="w-full h-28 bg-gray-200 rounded-lg flex items-center justify-center overflow-hidden relative">
                        {med.file_type === 'VIDEO' ? (
                          <div className="text-center text-gray-500">
                            <Video className="w-8 h-8 mx-auto text-gray-400" />
                            <span className="text-[10px] font-bold block mt-1">Video Recording</span>
                          </div>
                        ) : (
                          <div className="text-center text-gray-500 p-2">
                            <ImageIcon className="w-8 h-8 mx-auto text-gray-400" />
                            <span className="text-[10px] font-bold block mt-1 truncate max-w-[140px]">{med.file_name}</span>
                          </div>
                        )}

                        {/* Delete overlay */}
                        <button
                          onClick={() => handleDeleteMedia(med.media_id)}
                          className="absolute top-2 right-2 p-1 bg-red-600 text-white rounded-md opacity-0 group-hover:opacity-100 transition shadow-xs"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <p className="text-[11px] font-bold text-gray-800 line-clamp-2">
                        {med.caption}
                      </p>

                      <div className="bg-white rounded p-2 text-[10px] text-gray-600 border border-gray-100 space-y-1">
                        <div className="flex items-center space-x-1 font-bold text-[#ED1C24]">
                          <Sparkles className="w-3 h-3" />
                          <span>AI Description:</span>
                        </div>
                        <p className="line-clamp-2 italic">
                          "{med.ai_generated_description}"
                        </p>
                      </div>
                    </div>
                  ))}

                  {(!eventDetail?.media || eventDetail.media.length === 0) && (
                    <div className="col-span-3 py-8 text-center bg-gray-50 border border-dashed border-gray-300 rounded-xl text-xs text-gray-400">
                      No photos or videos uploaded yet. Click "Upload Photo / Video" above.
                    </div>
                  )}
                </div>
              </div>

              {/* Attendee List & Verbatim Responses */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <MessageSquare className="w-4 h-4 text-[#ED1C24]" />
                    <h4 className="text-sm font-extrabold text-[#231F20]">
                      Verbatim Feedback & Suggestions ({eventDetail?.feedbacks?.length || 0})
                    </h4>
                  </div>
                </div>

                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {eventDetail?.feedbacks?.map((fb) => (
                    <div key={fb.response_id} className="p-3 bg-gray-50 rounded-xl border border-gray-200 text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-gray-700">NIP: {fb.nip}</span>
                        <span className="text-[10px] text-gray-400">
                          {new Date(fb.submitted_at).toLocaleDateString('en-US', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-gray-700 italic">"{fb.verbatim}"</p>
                    </div>
                  ))}
                  {(!eventDetail?.feedbacks || eventDetail.feedbacks.length === 0) && (
                    <div className="py-4 text-center text-xs text-gray-400">
                      No feedback submitted yet.
                    </div>
                  )}
                </div>
              </div>

            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400 text-xs">
              Select an event from the left panel.
            </div>
          )}
        </div>

      </div>

    </div>
  );
}
