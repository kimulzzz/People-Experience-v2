import React, { useState, useEffect, useRef } from 'react';
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
  Video,
  X,
  Maximize2,
  Loader2,
  RefreshCw,
  AlertCircle
} from 'lucide-react';

function formatTimestamp(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// Full-screen viewer so an uploaded photo can be seen large / a video played large.
function MediaLightbox({ media, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isVideo = media.file_type === 'VIDEO';
  return (
    <div className="fixed inset-0 z-[80] bg-black/85 flex items-center justify-center p-4" onClick={onClose}>
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 bg-white/15 hover:bg-white/30 text-white rounded-full transition"
        title="Tutup (Esc)"
      >
        <X className="w-5 h-5" />
      </button>
      <div className="max-w-5xl w-full" onClick={(e) => e.stopPropagation()}>
        {isVideo ? (
          <video src={media.file_path} controls autoPlay className="w-full max-h-[80vh] bg-black rounded-lg" />
        ) : (
          <img src={media.file_path} alt={media.caption || media.file_name} className="max-h-[80vh] mx-auto object-contain rounded-lg" />
        )}
        <div className="mt-3 flex items-center justify-between gap-4 text-white">
          <p className="text-sm font-semibold line-clamp-2">{media.caption || media.file_name}</p>
          <a
            href={media.file_path}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-xs font-bold underline underline-offset-2 text-white/80 hover:text-white flex items-center space-x-1"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Buka di tab baru</span>
          </a>
        </div>
      </div>
    </div>
  );
}

// One gallery item: viewable photo / playable video, plus (videos only) the AI transcript.
function MediaCard({ med, onDelete, onOpen, onRetryTranscript, retrying = false, retryNotice = null }) {
  const videoRef = useRef(null);
  const [broken, setBroken] = useState(false);
  const isVideo = med.file_type === 'VIDEO';

  const openLarge = () => {
    if (videoRef.current) videoRef.current.pause();
    onOpen(med);
  };

  const seekTo = (seconds) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = seconds;
    videoRef.current.play().catch(() => {});
  };

  return (
    <div className="bg-white border border-white/40 rounded-xl p-3 space-y-2 relative group">
      <div className="w-full aspect-video bg-gray-200 rounded-lg flex items-center justify-center overflow-hidden relative">
        {broken ? (
          <div className="text-center text-gray-500 p-2">
            {isVideo ? <Video className="w-8 h-8 mx-auto text-gray-400" /> : <ImageIcon className="w-8 h-8 mx-auto text-gray-400" />}
            <span className="text-[10px] font-bold block mt-1 truncate max-w-[160px]">{med.file_name}</span>
            <span className="text-[9.5px] block text-gray-400">File tidak tersedia di server</span>
          </div>
        ) : isVideo ? (
          <video
            ref={videoRef}
            src={`${med.file_path}#t=0.1`}
            controls
            preload="metadata"
            onError={() => setBroken(true)}
            className="w-full h-full object-contain bg-black"
          />
        ) : (
          <img
            src={med.file_path}
            alt={med.caption || med.file_name}
            loading="lazy"
            onClick={openLarge}
            onError={() => setBroken(true)}
            className="w-full h-full object-cover cursor-zoom-in"
          />
        )}

        {!broken && (
          <button
            onClick={openLarge}
            className="absolute top-2 left-2 p-1 bg-black/55 hover:bg-black/75 text-white rounded-md opacity-0 group-hover:opacity-100 transition"
            title={isVideo ? 'Putar di layar besar' : 'Lihat ukuran penuh'}
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Delete overlay */}
        <button
          onClick={() => onDelete(med.media_id)}
          className="absolute top-2 right-2 p-1 bg-red-600 text-white rounded-md opacity-0 group-hover:opacity-100 transition shadow-xs"
          title="Delete"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      <p className="text-[11px] font-bold text-gray-800 line-clamp-2">
        {med.caption}
      </p>

      {isVideo && med.transcript_status === 'PROCESSING' && (
        <div className="bg-gray-50 rounded p-2 text-[10px] text-gray-600 border border-gray-100 flex items-center space-x-1.5">
          <Loader2 className="w-3 h-3 animate-spin shrink-0" style={{ color: 'var(--theme-base)' }} />
          <span>Transkrip AI sedang diproses… bisa memakan beberapa menit, halaman ini akan terisi otomatis.</span>
        </div>
      )}

      {isVideo && med.transcript_status === 'FAILED' && (
        <div className="bg-red-50 rounded p-2 text-[10px] text-red-700 border border-red-100 space-y-1">
          <div className="flex items-start space-x-1.5">
            <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
            <span>Transkrip AI gagal: {med.transcript_error || 'alasan tidak diketahui'}</span>
          </div>
          <button
            onClick={() => onRetryTranscript(med.media_id)}
            disabled={retrying}
            className="inline-flex items-center space-x-1 px-2 py-0.5 bg-white border border-red-200 rounded font-bold hover:bg-red-100 transition disabled:opacity-60 disabled:cursor-wait"
          >
            <RefreshCw className={`w-3 h-3 ${retrying ? 'animate-spin' : ''}`} />
            <span>{retrying ? 'Memproses ulang…' : 'Coba lagi'}</span>
          </button>
          {retryNotice && (
            <p className="text-[9.5px] text-red-600 font-semibold">
              Dicoba ulang pukul {retryNotice.at}: {retryNotice.text}
            </p>
          )}
        </div>
      )}

      {med.ai_generated_description && (
        <div className="bg-gray-50 rounded p-2 text-[10px] text-gray-600 border border-gray-100 space-y-1">
          <div className="flex items-center space-x-1 font-bold text-[var(--theme-base)]">
            <Sparkles className="w-3 h-3" />
            <span>AI Description:</span>
          </div>
          <p className="line-clamp-2 italic">
            "{med.ai_generated_description}"
          </p>
        </div>
      )}

      {isVideo && med.transcript_status === 'DONE' && med.transcript && (
        <details className="bg-gray-50 rounded border border-gray-100 text-[10px] text-gray-600">
          <summary className="cursor-pointer select-none p-2 font-bold text-[var(--theme-base)] flex items-center space-x-1">
            <FileText className="w-3 h-3 inline" />
            <span>
              Transkrip AI lengkap
              {med.duration_seconds ? ` • ${formatTimestamp(med.duration_seconds)}` : ''}
              {med.transcript_language ? ` • ${med.transcript_language.toUpperCase()}` : ''}
            </span>
          </summary>
          <div className="px-2 pb-2 max-h-56 overflow-y-auto space-y-1.5">
            {/* Full transcript = the API's `text` field */}
            <div className="font-bold text-gray-500 uppercase tracking-wide text-[9px]">Teks lengkap</div>
            <p className="whitespace-pre-line text-gray-700 leading-snug">{med.transcript}</p>
            {Array.isArray(med.transcript_segments) && med.transcript_segments.length > 0 && (
              <div className="font-bold text-gray-500 uppercase tracking-wide text-[9px] pt-1">Per segmen (klik untuk memutar dari bagian ini)</div>
            )}
            {Array.isArray(med.transcript_segments) && med.transcript_segments.length > 0 && (
              med.transcript_segments.map((seg, i) => (
                <button
                  key={i}
                  onClick={() => seekTo(seg.start)}
                  className="w-full text-left flex items-start space-x-1.5 hover:bg-white rounded px-1 py-0.5 transition"
                  title="Putar video dari bagian ini"
                >
                  <span className="font-mono font-bold text-gray-400 shrink-0">{formatTimestamp(seg.start)}</span>
                  <span>{seg.text}</span>
                </button>
              ))
            )}
          </div>
        </details>
      )}
    </div>
  );
}

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
  const [lightboxMedia, setLightboxMedia] = useState(null);

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

  // Video transcripts finish in the background (minutes, on CPU) — while any are still
  // processing, quietly re-fetch the event so the transcript appears without a manual refresh.
  const hasProcessingTranscript = !!eventDetail?.media?.some(m => m.transcript_status === 'PROCESSING');
  useEffect(() => {
    if (!hasProcessingTranscript || !selectedEvent?.event_id) return undefined;
    const eventId = selectedEvent.event_id;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/events/${eventId}`);
        if (res.ok) setEventDetail(await res.json());
      } catch (err) {
        console.error('Transcript status refresh failed:', err);
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [hasProcessingTranscript, selectedEvent?.event_id]);

  const handleMediaUpload = async (e) => {
    const input = e.target;
    const file = input.files[0];
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
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || `Upload gagal (HTTP ${res.status}).`);
      }
    } catch (err) {
      console.error('Media upload error:', err);
      alert('Upload gagal: ' + err.message);
    } finally {
      setUploadingMedia(false);
      // Allow picking the same file again after a failed/finished upload.
      input.value = '';
    }
  };

  // "Coba lagi" for a failed transcript. Gives visible feedback on every click: the button spins,
  // a started job is shown as "sedang diproses" immediately (taken from the server's reply, not a
  // refetch that could already see a second failure), and a refusal — e.g. the Video Extractor
  // is not running — is shown on the card together with the time of the attempt.
  const [retryingIds, setRetryingIds] = useState({});
  const [retryNotices, setRetryNotices] = useState({});
  const handleRetryTranscript = async (mediaId) => {
    const started = Date.now();
    const nowLabel = () => new Date().toLocaleTimeString('id-ID');
    setRetryingIds(prev => ({ ...prev, [mediaId]: true }));
    setRetryNotices(prev => ({ ...prev, [mediaId]: null }));
    try {
      const res = await fetch(`/api/media/${mediaId}/transcribe`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRetryNotices(prev => ({ ...prev, [mediaId]: { at: nowLabel(), text: data.error || `Gagal memulai transkrip (HTTP ${res.status}).` } }));
      } else if (data.media) {
        setEventDetail(prev => (prev ? { ...prev, media: (prev.media || []).map(m => (m.media_id === mediaId ? data.media : m)) } : prev));
      }
    } catch (err) {
      setRetryNotices(prev => ({ ...prev, [mediaId]: { at: nowLabel(), text: 'Gagal memulai transkrip: ' + err.message } }));
    } finally {
      // keep the spinner visible long enough to be noticed
      const wait = Math.max(0, 700 - (Date.now() - started));
      setTimeout(() => setRetryingIds(prev => ({ ...prev, [mediaId]: false })), wait);
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
    <div className="bg-gradient-to-br from-[var(--theme-deep)] via-[var(--theme-strong)] to-[var(--theme-base)] rounded-2xl p-5 sm:p-6 shadow-xl space-y-6">

      {/* Top Header Bar */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-5 border-b border-white/15">
        <div>
          <div className="flex items-center space-x-2">
            <Calendar className="w-5 h-5 text-white" />
            <h3 className="text-base font-extrabold text-white">
              Signature Programs Event Management & PPT Generator
            </h3>
          </div>
          <p className="text-xs text-red-100">
            Manage Perspektif, D&I, Young, & EVD programs. Generate pre-event attendance QR codes, post-event evaluation surveys, and export automated reports to PowerPoint.
          </p>
        </div>

        <button
          onClick={onOpenCreateEventModal}
          className="px-4 py-2 bg-[var(--theme-base)] hover:bg-[var(--theme-hover)] text-white rounded-lg text-xs font-bold transition flex items-center space-x-2 shadow-sm border border-white/30"
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
            <span className="text-xs font-bold text-red-100 uppercase">Signature Event List</span>
            <span className="text-xs font-semibold text-red-100">{events?.length || 0} Events</span>
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
                      ? 'bg-white border-white shadow-lg'
                      : 'bg-white/85 border-white/40 hover:bg-white'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-700">
                      {ev.program_category}
                    </span>
                    <span className="text-[10px] font-bold text-[var(--theme-base)]">
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
            <div className="space-y-6">

              {/* Event Header Banner */}
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-5 border-b border-white/15">
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-white text-[var(--theme-dark)]">
                      {selectedEvent.program_category}
                    </span>
                    <span className="text-xs text-red-100 font-medium">
                      {new Date(selectedEvent.event_date).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                    </span>
                  </div>

                  <h2 className="text-lg font-extrabold text-white">
                    {selectedEvent.event_name}
                  </h2>

                  <div className="flex items-center space-x-4 text-xs text-red-100 pt-1">
                    <span className="flex items-center space-x-1">
                      <MapPin className="w-3.5 h-3.5 text-red-200" />
                      <span>{selectedEvent.location}</span>
                    </span>
                    <span className="flex items-center space-x-1">
                      <Clock className="w-3.5 h-3.5 text-red-200" />
                      <span>Format {selectedEvent.event_type}</span>
                    </span>
                  </div>
                </div>

                {/* Generate PPT Button */}
                <button
                  onClick={handleGeneratePpt}
                  disabled={generatingPpt}
                  className="px-4 py-2.5 bg-gradient-to-r from-[#231F20] to-[#3B3637] hover:from-[#3B3637] hover:to-[#4A4445] text-white rounded-xl text-xs font-bold transition flex items-center space-x-2 shadow-md"
                >
                  <Download className="w-4 h-4" />
                  <span>{generatingPpt ? 'Generating PPT Slides...' : 'Download PPTX Report'}</span>
                </button>
              </div>

              {/* Quick Links & QR Distribution Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                
                {/* Pra-Event Link Card */}
                <div className="bg-blue-600 border border-blue-400 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white flex items-center space-x-1.5">
                      <CheckCircle className="w-4 h-4 text-white" />
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

                  <p className="text-[11px] text-blue-50 font-medium">
                    Share this link during registration/attendance before the event begins.
                  </p>

                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => onOpenPublicCheckIn(selectedEvent.pre_event_code)}
                      className="flex-1 py-1.5 bg-blue-800 hover:bg-blue-900 text-white rounded-lg text-xs font-bold transition text-center"
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
                <div className="bg-emerald-600 border border-emerald-400 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white flex items-center space-x-1.5">
                      <Star className="w-4 h-4 text-white fill-white" />
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

                  <p className="text-[11px] text-emerald-50 font-medium">
                    Share at the end of the event to gather satisfaction ratings & verbatim feedback.
                  </p>

                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => onOpenPublicSurvey(selectedEvent.post_event_code)}
                      className="flex-1 py-1.5 bg-emerald-800 hover:bg-emerald-900 text-white rounded-lg text-xs font-bold transition text-center"
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
                    <ImageIcon className="w-4 h-4 text-white" />
                    <h4 className="text-sm font-extrabold text-white">
                      Photo Gallery & Event Documentation
                    </h4>
                  </div>

                  <label className="px-3 py-1.5 bg-white/90 hover:bg-white text-[var(--theme-dark)] rounded-lg text-xs font-bold transition cursor-pointer flex items-center space-x-1.5">
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

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
                  {eventDetail?.media?.map((med) => (
                    <MediaCard
                      key={med.media_id}
                      med={med}
                      onDelete={handleDeleteMedia}
                      onOpen={setLightboxMedia}
                      onRetryTranscript={handleRetryTranscript}
                      retrying={!!retryingIds[med.media_id]}
                      retryNotice={retryNotices[med.media_id] || null}
                    />
                  ))}

                  {(!eventDetail?.media || eventDetail.media.length === 0) && (
                    <div className="col-span-3 py-8 text-center bg-white/10 border border-dashed border-white/30 rounded-xl text-xs text-red-100">
                      No photos or videos uploaded yet. Click "Upload Photo / Video" above.
                    </div>
                  )}
                </div>
              </div>

              {/* Attendee List & Verbatim Responses */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <MessageSquare className="w-4 h-4 text-white" />
                    <h4 className="text-sm font-extrabold text-white">
                      Verbatim Feedback & Suggestions ({eventDetail?.feedbacks?.length || 0})
                    </h4>
                  </div>
                </div>

                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {eventDetail?.feedbacks?.map((fb) => (
                    <div key={fb.response_id} className="p-3 bg-white border border-white/40 rounded-xl text-xs space-y-1">
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
                    <div className="py-4 text-center text-xs text-red-100">
                      No feedback submitted yet.
                    </div>
                  )}
                </div>
              </div>

            </div>
          ) : (
            <div className="bg-white/10 border border-white/20 rounded-xl p-12 text-center text-red-100 text-xs">
              Select an event from the left panel.
            </div>
          )}
        </div>

      </div>

      {lightboxMedia && (
        <MediaLightbox media={lightboxMedia} onClose={() => setLightboxMedia(null)} />
      )}

    </div>
  );
}
