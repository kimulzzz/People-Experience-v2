// server/db/metricUnit.js
// Satuan tampilan nilai aktual sebuah metrik ("%", "/ 5", "pax", "orang/tahun", ...).
// Hanya mempengaruhi TAMPILAN — perhitungan skor/normalisasi/status tidak memakainya.
// Dipakai bersama oleh sqlStorage.js dan jsonStorage.js agar aturannya identik.

const MAX_UNIT_LENGTH = 30;

// Satuan bawaan per jenis skala — dipakai HANYA saat metrik baru dibuat tanpa satuan
// (atau data lama tak punya kolom satuan dan metriknya bukan metrik seed). Nilai awal metrik seed
// ada di seedData.js (field `unit` pada initialMetrics).
function defaultUnitForScale(scaleType) {
  switch (scaleType) {
    case 'RATING_5': return '/ 5';
    case 'QUOTA_COUNT': return 'pax';
    default: return '%';
  }
}

// Memvalidasi satuan yang dikirim admin. Mengembalikan teks yang sudah di-trim atau melempar
// Error (route admin menerjemahkannya menjadi HTTP 400). Satuan tidak boleh kosong:
// tanpa satuan, angka mentah tampil "telanjang" dan ambigu.
function parseUnit(value) {
  const text = String(value === undefined || value === null ? '' : value).trim();
  if (!text) throw new Error('Satuan nilai tidak boleh kosong.');
  if (text.length > MAX_UNIT_LENGTH) throw new Error(`Satuan nilai maksimal ${MAX_UNIT_LENGTH} karakter.`);
  return text;
}

module.exports = { MAX_UNIT_LENGTH, defaultUnitForScale, parseUnit };
