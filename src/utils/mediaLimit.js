// Signature Program Events photo/video upload limit (v2.59.0): px_app_settings.media_upload_max_mb, MB per file.
// Same range and label as the server (server/server.js NUMERIC_SETTINGS / mediaLimitLabel).
export const MEDIA_MAX_MB_RANGE = { min: 1, max: 4096 };

// "1024 MB (1 GB)" / "500 MB"
export function mediaLimitLabel(mb) {
  return mb >= 1024 ? `${mb} MB (${Number((mb / 1024).toFixed(2))} GB)` : `${mb} MB`;
}
