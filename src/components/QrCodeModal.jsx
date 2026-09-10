import React, { useState, useEffect } from 'react';
import { X, QrCode, Copy, ExternalLink, Download } from 'lucide-react';

export default function QrCodeModal({ isOpen, onClose, code, title, eventName, isSurvey = false }) {
  const [qrUrl, setQrUrl] = useState('');
  const [loading, setLoading] = useState(false);

  const fullUrl = `${window.location.origin}${isSurvey ? `?survey=${code}` : `?checkin=${code}`}`;

  useEffect(() => {
    if (isOpen && code) {
      setLoading(true);
      fetch(`/api/qrcode?text=${encodeURIComponent(fullUrl)}`)
        .then(res => res.json())
        .then(data => {
          setQrUrl(data.qr_data_url);
        })
        .catch(err => console.error(err))
        .finally(() => setLoading(false));
    }
  }, [isOpen, code, fullUrl]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl space-y-4 text-center">
        
        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-[#ED1C24] uppercase tracking-wider">{title}</span>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div>
          <h3 className="text-base font-extrabold text-[#231F20]">{eventName}</h3>
          <p className="text-xs text-gray-400 mt-0.5">Scan this QR Code with your smartphone camera</p>
        </div>

        {/* QR Code Container */}
        <div className="p-4 bg-gray-50 rounded-2xl border border-gray-200 inline-block mx-auto">
          {loading ? (
            <div className="w-48 h-48 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#ED1C24]" />
            </div>
          ) : qrUrl ? (
            <img src={qrUrl} alt="QR Code" className="w-48 h-48 object-contain rounded-lg shadow-xs" />
          ) : (
            <div className="w-48 h-48 flex items-center justify-center text-xs text-gray-400">
              Failed to load QR code
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="space-y-2 pt-2">
          <button
            onClick={() => {
              navigator.clipboard.writeText(fullUrl);
              alert('Link copied to clipboard!');
            }}
            className="w-full py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-bold transition flex items-center justify-center space-x-1.5"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>Copy Access Link</span>
          </button>

          <a
            href={fullUrl}
            target="_blank"
            rel="noreferrer"
            className="w-full py-2 bg-[#ED1C24] hover:bg-[#D91B23] text-white rounded-lg text-xs font-bold transition flex items-center justify-center space-x-1.5 shadow-xs"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Open Form in New Tab</span>
          </a>
        </div>

      </div>
    </div>
  );
}
