// src/utils/formatMetricValue.js
// Nilai aktual (raw) sebuah metrik + satuannya. Satuan ("%", "/ 5", "pax", "orang/tahun", ...)
// berasal dari database (px_metrics.unit, diedit admin di Parameter Admin) — tidak ada lagi
// asumsi "selain RATING_5 pasti persen". Kalau satuan belum ada, angka ditampilkan apa adanya.
export function formatMetricValue(rawValue, unit, scaleType) {
  if (rawValue === null || rawValue === undefined || rawValue === '') return '-';
  const num = Number(rawValue);
  // Hitungan bulat (QUOTA_COUNT) diberi pemisah ribuan ala Indonesia: 4330 -> "4.330" (nilai pecahan tetap apa adanya).
  const text = scaleType === 'QUOTA_COUNT' && Number.isInteger(num) ? num.toLocaleString('id-ID') : String(rawValue);
  const u = typeof unit === 'string' ? unit.trim() : '';
  if (!u) return text;
  return u === '%' ? `${text}%` : `${text} ${u}`;
}

// Hanya untuk mengisi awal kolom "Satuan" saat admin memilih skala di form metrik baru
// (admin tetap bebas mengubahnya). Server memakai default yang sama bila satuan tidak dikirim.
export function defaultUnitForScale(scaleType) {
  if (scaleType === 'RATING_5') return '/ 5';
  if (scaleType === 'QUOTA_COUNT') return 'pax';
  return '%';
}
