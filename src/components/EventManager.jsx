import { useAuth } from '../utils/AuthContext';
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
  AlertCircle,
  ChevronDown
} from 'lucide-react';
import { mediaLimitLabel } from '../utils/mediaLimit';

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
        title="Close (Esc)"
      >
        <X className="w-5 h-5" />
      </button>
      <div className="max-w-5xl w-full" onClick={(e) => e.stopPropagation()}>
        {isVideo ? (
          <video src={media.file_path} controls autoPlay className="w-full max-h-[80vh] bg-black rounded-lg" />
        ) : (
          <img src={media.file_path} alt={captionText(media) || media.file_name} className="max-h-[80vh] mx-auto object-contain rounded-lg" />
        )}
        <div className="mt-3 flex items-center justify-between gap-4 text-white">
          <p className="text-sm font-semibold line-clamp-2">{captionText(media) || media.file_name}</p>
          <a
            href={media.file_path}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-xs font-bold underline underline-offset-2 text-white/80 hover:text-white flex items-center space-x-1"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Open in new tab</span>
          </a>
        </div>
      </div>
    </div>
  );
}

// One gallery item: viewable photo / playable video, plus (videos only) the AI transcript.
function MediaCard({ med, onDelete, onOpen, onRetryTranscript, retrying = false, retryNotice = null, onSummarize, summarizing = false, summaryNotice = null, canManage = false }) {
  const videoRef = useRef(null);
  const [broken, setBroken] = useState(false);
  const isVideo = med.file_type === 'VIDEO';

  // A finished video is renamed on the server and its file_path changes; an error raised for the old path (404 in the
  // window between the rename and the refetch) must not stick. A seed photo whose file never existed keeps its path, so
  // it stays "not available" without reloading in a loop.
  useEffect(() => { setBroken(false); }, [med.file_path]);

  const openLarge = () => {
    if (videoRef.current) videoRef.current.pause();
    onOpen(med);
  };

  const seekTo = (seconds) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = seconds;
    videoRef.current.play().catch(() => {});
  };

  // Topic summary of a long video (v2.60.0); older and short summaries have no topics and render as before.
  const hasTopics = Array.isArray(med.summary_topics) && med.summary_topics.length > 0;
  // v2.60.1: a meeting with several agendas has `agenda` on its topics -> grouped under the agenda names, in recording order.
  const agendaGroups = hasTopics && med.summary_topics.some(t => t && t.agenda)
    ? med.summary_topics.reduce((groups, topic) => {
      const last = groups[groups.length - 1];
      if (last && last.name === (topic.agenda || '')) last.topics.push(topic);
      else groups.push({ name: topic.agenda || '', topics: [topic] });
      return groups;
    }, [])
    : null;
  const renderTopics = topics => (
    <ol className="space-y-1">
      {topics.map((topic, i) => (
        <li key={i}>
          <p className="font-semibold text-gray-800 leading-snug">{i + 1}. {topic.title}</p>
          <ul className="list-disc pl-6 space-y-0.5 leading-snug">
            {(topic.points || []).map((pt, j) => <li key={j}>{pt}</li>)}
          </ul>
        </li>
      ))}
    </ol>
  );

  return (
    <div className="bg-white border border-white/40 rounded-xl p-3 space-y-2 relative group">
      <div className="w-full aspect-video bg-gray-200 rounded-lg flex items-center justify-center overflow-hidden relative">
        {broken ? (
          <div className="text-center text-gray-500 p-2">
            {isVideo ? <Video className="w-8 h-8 mx-auto text-gray-400" /> : <ImageIcon className="w-8 h-8 mx-auto text-gray-400" />}
            <span className="text-[10px] font-bold block mt-1 truncate max-w-[160px]">{med.file_name}</span>
            <span className="text-[9.5px] block text-gray-400">File not available on the server</span>
          </div>
        ) : isVideo ? (
          <video
            key={med.file_path}
            ref={videoRef}
            src={`${med.file_path}#t=0.1`}
            controls
            preload="metadata"
            onError={() => setBroken(true)}
            className="w-full h-full object-contain bg-black"
          />
        ) : (
          <img
            key={med.file_path}
            src={med.file_path}
            alt={captionText(med) || med.file_name}
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
            title={isVideo ? 'Play full screen' : 'View full size'}
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Delete overlay (event managers only) */}
        {canManage && (
          <button
            onClick={() => onDelete(med.media_id)}
            className="absolute top-2 right-2 p-1 bg-red-600 text-white rounded-md opacity-0 group-hover:opacity-100 transition shadow-xs"
            title="Delete"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <p className="text-[11px] font-bold text-gray-800 line-clamp-2">
        {captionText(med)}
      </p>

      {isVideo && med.transcript_status === 'PROCESSING' && (
        <div className="bg-gray-50 rounded p-2 text-[10px] text-gray-600 border border-gray-100 flex items-center space-x-1.5">
          <Loader2 className="w-3 h-3 animate-spin shrink-0" style={{ color: 'var(--theme-base)' }} />
          <span>AI transcript is being processed… this can take a few minutes; this page will fill in automatically.</span>
        </div>
      )}

      {isVideo && med.transcript_status === 'FAILED' && (
        <div className="bg-red-50 rounded p-2 text-[10px] text-red-700 border border-red-100 space-y-1">
          <div className="flex items-start space-x-1.5">
            <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
            <span>AI transcript failed: {med.transcript_error || 'unknown reason'}</span>
          </div>
          {canManage && <button
            onClick={() => onRetryTranscript(med.media_id)}
            disabled={retrying}
            className="inline-flex items-center space-x-1 px-2 py-0.5 bg-white border border-red-200 rounded font-bold hover:bg-red-100 transition disabled:opacity-60 disabled:cursor-wait"
          >
            <RefreshCw className={`w-3 h-3 ${retrying ? 'animate-spin' : ''}`} />
            <span>{retrying ? 'Reprocessing…' : 'Try again'}</span>
          </button>}
          {retryNotice && (
            <p className="text-[9.5px] text-red-600 font-semibold">
              Retried at {retryNotice.at}: {retryNotice.text}
            </p>
          )}
        </div>
      )}

      {!isVideo && med.ai_generated_description && (
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
        <details open className="group bg-white rounded border border-[var(--theme-base)]/25 text-[10px] text-gray-700">
          <summary className="cursor-pointer select-none p-2 flex items-center justify-between gap-2">
            <div className="flex items-center space-x-1 font-bold text-[var(--theme-base)]">
              <Sparkles className="w-3 h-3" />
              <span>AI Summary</span>
            </div>
            <div className="flex items-center space-x-1.5">
              {med.summary_status === 'DONE' && (
                <span className={`px-1.5 py-0.5 rounded font-bold text-[9px] ${med.summary_source === 'AI' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
                  {med.summary_source === 'AI' ? 'AI' : 'Automatic (rule-based)'}
                </span>
              )}
              <ChevronDown className="w-3 h-3 text-gray-400 transition-transform group-open:rotate-180" />
            </div>
          </summary>
          <div className="px-2 pb-2 space-y-1.5">

          {med.summary_status === 'PROCESSING' && (
            <div className="flex items-center space-x-1.5 text-gray-600">
              <Loader2 className="w-3 h-3 animate-spin shrink-0" style={{ color: 'var(--theme-base)' }} />
              <span>AI summary is being generated… this can take a minute or more; this page will fill in automatically.</span>
            </div>
          )}

          {med.summary_status === 'DONE' && (
            <>
              <p className="leading-snug text-gray-800">{med.summary}</p>
              {hasTopics ? (
                // v2.60.0: a long video is summarized by topic (numbered titles, their points below)
                <div className="space-y-1">
                  <p className="font-bold text-gray-700">Topics discussed</p>
                  {agendaGroups ? (
                    <div className="space-y-2">
                      {agendaGroups.map((group, g) => (
                        <div key={g} className="space-y-1">
                          {group.name && (
                            <p className="font-bold text-[var(--theme-base)] border-l-2 border-[var(--theme-base)] pl-1.5 leading-snug">{group.name}</p>
                          )}
                          {renderTopics(group.topics)}
                        </div>
                      ))}
                    </div>
                  ) : renderTopics(med.summary_topics)}
                </div>
              ) : Array.isArray(med.summary_points) && med.summary_points.length > 0 && (
                <ul className="list-disc pl-4 space-y-0.5 leading-snug">
                  {med.summary_points.map((pt, i) => <li key={i}>{pt}</li>)}
                </ul>
              )}
              {/* v2.60.0: only the generation date and time below the summary (no model name, language or notes) */}
              {med.summary_generated_at && (
                <p className="text-[9px] text-gray-400">Generated {new Date(med.summary_generated_at).toLocaleString('en-US')}</p>
              )}
              {med.summary_source !== 'AI' && med.summary_error && (
                <p className="text-[9.5px] text-amber-700">{med.summary_error}</p>
              )}
            </>
          )}

          {med.summary_status === 'FAILED' && (
            <div className="flex items-start space-x-1.5 text-red-700">
              <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
              <span>AI summary failed: {med.summary_error || 'unknown reason'}</span>
            </div>
          )}

          {med.summary_status === 'INSUFFICIENT' && (
            <p className="text-gray-500 italic">{med.summary_error || 'The transcript is not long enough to summarize.'}</p>
          )}

          {!med.summary_status && (
            <p className="text-gray-500 italic">No summary yet for this video.</p>
          )}

          {/* v2.60.1: also for AI summaries, so an event manager can re-run a video from the web */}
          {canManage && med.summary_status !== 'PROCESSING' && med.summary_status !== 'INSUFFICIENT' && (
            <button
              onClick={() => onSummarize(med.media_id)}
              disabled={summarizing}
              title="Runs the local AI summary of this video again; a long video can take several minutes"
              className="inline-flex items-center space-x-1 px-2 py-0.5 bg-gray-50 border border-gray-200 rounded font-bold text-gray-700 hover:bg-gray-100 transition disabled:opacity-60 disabled:cursor-wait"
            >
              <RefreshCw className={`w-3 h-3 ${summarizing ? 'animate-spin' : ''}`} />
              <span>{summarizing ? 'Processing…' : (med.summary_status ? 'Regenerate summary' : 'Generate summary')}</span>
            </button>
          )}
          {summaryNotice && (
            <p className="text-[9.5px] text-red-600 font-semibold">Attempted at {summaryNotice.at}: {summaryNotice.text}</p>
          )}
          </div>
        </details>
      )}

      {isVideo && med.transcript_status === 'DONE' && med.transcript && (
        <details className="group bg-gray-50 rounded border border-gray-100 text-[10px] text-gray-600">
          <summary className="cursor-pointer select-none p-2 font-bold text-[var(--theme-base)] flex items-center justify-between gap-2">
            <span className="flex items-center space-x-1">
              <FileText className="w-3 h-3 inline" />
              <span>
                Full AI transcript
                {med.duration_seconds ? ` • ${formatTimestamp(med.duration_seconds)}` : ''}
                {med.transcript_language ? ` • ${med.transcript_language.toUpperCase()}` : ''}
              </span>
            </span>
            <ChevronDown className="w-3 h-3 text-gray-400 transition-transform group-open:rotate-180" />
          </summary>
          <div className="px-2 pb-2 max-h-56 overflow-y-auto space-y-1.5">
            {/* Full transcript = the API's `text` field */}
            <div className="font-bold text-gray-500 uppercase tracking-wide text-[9px]">Full text</div>
            <p className="whitespace-pre-line text-gray-700 leading-snug">{med.transcript}</p>
            {Array.isArray(med.transcript_segments) && med.transcript_segments.length > 0 && (
              <div className="font-bold text-gray-500 uppercase tracking-wide text-[9px] pt-1">Per segment (click to play from this part)</div>
            )}
            {Array.isArray(med.transcript_segments) && med.transcript_segments.length > 0 && (
              med.transcript_segments.map((seg, i) => (
                <button
                  key={i}
                  onClick={() => seekTo(seg.start)}
                  className="w-full text-left flex items-start space-x-1.5 hover:bg-white rounded px-1 py-0.5 transition"
                  title="Play the video from this part"
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

// Older uploads were saved with a "Documentation " prefix in front of the file name; show just the file name.
const captionText = (m) => String(m?.caption || '').replace(/^Documentation\s+/i, '');

export default function EventManager({
  events, 
  onRefreshEvents,
  onOpenCreateEventModal,
  onOpenQrModal,
  onOpenPublicCheckIn,
  onOpenPublicSurvey
}) {
  const { canManageEvents } = useAuth(); // creating / changing events, media, transcripts and PPT: Admin + event-manager directorate
  const [selectedEventId, setSelectedEventId] = useState(events?.[0]?.event_id || null);
  const [eventDetail, setEventDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [mediaMaxMb, setMediaMaxMb] = useState(null); // Admin setting media_upload_max_mb (v2.59.0); the server enforces it
  const [generatingPpt, setGeneratingPpt] = useState(false);
  const [pptDownloadUrl, setPptDownloadUrl] = useState(null);
  const [lightboxMedia, setLightboxMedia] = useState(null);

  const selectedEvent = events?.find(e => e.event_id === selectedEventId) || events?.[0];

  useEffect(() => {
    fetch('/api/settings')
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (data && Number.isInteger(data.media_upload_max_mb)) setMediaMaxMb(data.media_upload_max_mb); })
      .catch(err => console.error('Failed to load the upload limit:', err));
  }, []);

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

  // Video transcripts and AI summaries finish in the background (minutes, on CPU) — while any are still
  // processing, quietly re-fetch the event so the transcript appears without a manual refresh.
  const hasProcessingTranscript = !!eventDetail?.media?.some(m => m.transcript_status === 'PROCESSING' || m.summary_status === 'PROCESSING');
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

  // When the last video job ends, the server renames the video file to its original upload name a moment later (the
  // file_path changes). The poll above has stopped by then, so fetch once more to pick up the new file_path.
  const wasProcessing = useRef(false);
  useEffect(() => {
    if (hasProcessingTranscript) { wasProcessing.current = true; return undefined; }
    if (!wasProcessing.current || !selectedEvent?.event_id) return undefined;
    wasProcessing.current = false;
    const eventId = selectedEvent.event_id;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/events/${eventId}`);
        if (res.ok) setEventDetail(await res.json());
      } catch (err) {
        console.error('Video file name refresh failed:', err);
      }
    }, 2500);
    return () => clearTimeout(timer);
  }, [hasProcessingTranscript, selectedEvent?.event_id]);

  const handleMediaUpload = async (e) => {
    const input = e.target;
    const file = input.files[0];
    if (!file || !selectedEvent) return;
    // Checked here first so a too-large video is not sent for minutes only to be refused (the server checks again).
    if (mediaMaxMb && file.size > mediaMaxMb * 1024 * 1024) {
      alert(`The file exceeds the ${mediaLimitLabel(mediaMaxMb)} limit (this file is ${(file.size / (1024 * 1024)).toFixed(1)} MB).`);
      input.value = '';
      return;
    }

    setUploadingMedia(true);
    const formData = new FormData();
    formData.append('mediaFile', file);
    formData.append('caption', file.name);
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
        alert(data.error || `Upload failed (HTTP ${res.status}).`);
      }
    } catch (err) {
      console.error('Media upload error:', err);
      alert('Upload failed: ' + err.message);
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
    const nowLabel = () => new Date().toLocaleTimeString('en-US');
    setRetryingIds(prev => ({ ...prev, [mediaId]: true }));
    setRetryNotices(prev => ({ ...prev, [mediaId]: null }));
    try {
      const res = await fetch(`/api/media/${mediaId}/transcribe`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRetryNotices(prev => ({ ...prev, [mediaId]: { at: nowLabel(), text: data.error || `Failed to start the transcript (HTTP ${res.status}).` } }));
      } else if (data.media) {
        setEventDetail(prev => (prev ? { ...prev, media: (prev.media || []).map(m => (m.media_id === mediaId ? data.media : m)) } : prev));
      }
    } catch (err) {
      setRetryNotices(prev => ({ ...prev, [mediaId]: { at: nowLabel(), text: 'Failed to start the transcript: ' + err.message } }));
    } finally {
      // keep the spinner visible long enough to be noticed
      const wait = Math.max(0, 700 - (Date.now() - started));
      setTimeout(() => setRetryingIds(prev => ({ ...prev, [mediaId]: false })), wait);
    }
  };

  // "Buat ulang ringkasan" (event managers): the server answers 202 with the video in its PROCESSING state.
  const [summarizingIds, setSummarizingIds] = useState({});
  const [summaryNotices, setSummaryNotices] = useState({});
  const handleSummarize = async (mediaId) => {
    const started = Date.now();
    setSummarizingIds(prev => ({ ...prev, [mediaId]: true }));
    setSummaryNotices(prev => ({ ...prev, [mediaId]: null }));
    try {
      const res = await fetch(`/api/media/${mediaId}/summarize`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSummaryNotices(prev => ({ ...prev, [mediaId]: { at: new Date().toLocaleTimeString('en-US'), text: data.error || `Failed to start the summary (HTTP ${res.status}).` } }));
      } else if (data.media) {
        setEventDetail(prev => (prev ? { ...prev, media: (prev.media || []).map(m => (m.media_id === mediaId ? data.media : m)) } : prev));
      }
    } catch (err) {
      setSummaryNotices(prev => ({ ...prev, [mediaId]: { at: new Date().toLocaleTimeString('en-US'), text: 'Failed to start the summary: ' + err.message } }));
    } finally {
      const wait = Math.max(0, 700 - (Date.now() - started));
      setTimeout(() => setSummarizingIds(prev => ({ ...prev, [mediaId]: false })), wait);
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

        {canManageEvents && (
          <button
            onClick={onOpenCreateEventModal}
            className="px-4 py-2 bg-[var(--theme-base)] hover:bg-[var(--theme-hover)] text-white rounded-lg text-xs font-bold transition flex items-center space-x-2 shadow-sm border border-white/30"
          >
            <Plus className="w-4 h-4" />
            <span>Create New Signature Event</span>
          </button>
        )}
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
                {canManageEvents && <button
                  onClick={handleGeneratePpt}
                  disabled={generatingPpt}
                  className="px-4 py-2.5 bg-gradient-to-r from-[#231F20] to-[#3B3637] hover:from-[#3B3637] hover:to-[#4A4445] text-white rounded-xl text-xs font-bold transition flex items-center space-x-2 shadow-md"
                >
                  <Download className="w-4 h-4" />
                  <span>{generatingPpt ? 'Generating PPT Slides...' : 'Download PPTX Report'}</span>
                </button>}
              </div>

              {/* Quick Links & QR Distribution Cards (the access codes are only sent to event managers) */}
              {canManageEvents && <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                
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

              </div>}

              {/* Media Gallery Section */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <ImageIcon className="w-4 h-4 text-white" />
                    <h4 className="text-sm font-extrabold text-white">
                      Photo Gallery & Event Documentation
                    </h4>
                  </div>

                  {canManageEvents && <div className="flex items-center space-x-2">
                  {mediaMaxMb && <span className="text-[11px] font-semibold text-white/80">Max {mediaLimitLabel(mediaMaxMb)} per file</span>}
                  <label className="px-3 py-1.5 bg-white/90 hover:bg-white text-[var(--theme-dark)] rounded-lg text-xs font-bold transition cursor-pointer flex items-center space-x-1.5">
                    <Upload className="w-3.5 h-3.5" />
                    <span>{uploadingMedia ? 'Uploading...' : 'Upload Photo / Video'}</span>
                    <input
                      type="file"
                      accept=".jpg,.jpeg,.png,.gif,.webp,.bmp,.avif,.mp4,.m4v,.mov,.webm,.mkv,.avi,.ogv,.mpg,.mpeg,.3gp,.wmv,.flv"
                      onChange={handleMediaUpload}
                      className="hidden"
                      disabled={uploadingMedia}
                    />
                  </label>
                  </div>}
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
                      onSummarize={handleSummarize}
                      summarizing={!!summarizingIds[med.media_id]}
                      summaryNotice={summaryNotices[med.media_id] || null}
                      canManage={canManageEvents}
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
                        <span className="font-bold text-gray-700">{fb.nip ? `NIP: ${fb.nip}` : 'Anonymous respondent'}</span>
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
        <MediaLightbox media={eventDetail?.media?.find(m => m.media_id === lightboxMedia.media_id) || lightboxMedia} onClose={() => setLightboxMedia(null)} />
      )}

    </div>
  );
}
