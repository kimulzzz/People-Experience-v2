# 04. Backend API & Services Specification
**CIMB Niaga People Experience (PE) Framework**

---

## ⚡ 1. Arsitektur Backend Server (`server/server.js`)

Backend dibangun menggunakan **Node.js dan Express.js** sebagai REST API Server ringan berkinerja tinggi, dilengkapi middleware *CORS*, *Body Parser (JSON & URL-Encoded)*, serta sistem error handling terpusat.

```
📁 server/
├── 📄 server.js                           # Entry Point, Express Routes & HTTP Server
├── 📁 services/                           # Lapisan Logika Bisnis (Core Business Logic)
│   ├── 📄 calculationEngine.js            # Engine Kalkulasi PE Index, Bobot 70/30 & Tren
│   ├── 📄 metricQuestionService.js        # Service Bank Soal, Enum Tipe & Default Template
│   ├── 📄 surveyTemplateService.js        # Generator Berkas Template CSV Dinamis
│   ├── 📄 surveyImportService.js          # Parser Impor Respon CSV & Normalisasi Data
│   ├── 📄 surveyEvidenceService.js        # Generator Berkas Audit Trail Evidence CSV
│   ├── 📄 pptExportService.js             # Generator Corporate Deck PowerPoint (.pptx)
│   ├── 📄 alertEngine.js                  # Pemetaan Metrik Defisit ke Inisiatif Aksi + Narasi (rule-based sejak v2.28.0)
│   ├── 📄 localAiService.js               # Klien Local Ollama (hanya scope EVENT_VIDEO_SUMMARY) + narasi Alert/Event Summary rule-based
│   ├── 📄 mediaSummaryService.js          # AI Summary transkrip video (Gemma), validator, fallback aturan (v2.28.0)
│   ├── 📄 aiQueue.js                      # Antrian tunggal job AI lokal (satu per satu, tanpa duplikat)
│   └── 📄 reminderService.js              # Deteksi & Pengiriman Email Reminder Upload Survei Manual
└── 📁 db/                                 # Lapisan Akses & Persistensi Data
    ├── 📄 storage.js                      # Transactional In-Memory + File Store Adapter
    └── 📄 seedData.js                     # Inisialisasi Data Awal 27 Metrik & Transaksi
```

---

## 🔌 2. Katalog Lengkap REST API Endpoints

### 2.1 Modul Sistem & Kesehatan
| Method | Endpoint | Deskripsi | Parameter Query |
| :---: | :--- | :--- | :--- |
| `GET` | `/api/health` | Status online server dan identitas sistem. Tanpa login hanya `status`/`system`/`version`; dengan login juga status Ollama dan detail database (sejak v2.26.0). Sejak v2.28.0 Ollama hanya dicek bila login + `?check_ai=1` (hanya mendaftar model); tanpa itu `local_ai.ollama_status` = `not checked (add ?check_ai=1)`, dan `local_ai.model` menampilkan model aktif | `-` |

---

### 2.2 Modul Kalkulasi & Analitik Metrik
| Method | Endpoint | Deskripsi | Parameter Query / Body |
| :---: | :--- | :--- | :--- |
| `GET` | `/api/metrics/calculate` | Mengkalkulasi skor PE Index konsolidasi, skor journey, checkpoint, dan rincian 27 metrik (mendukung mode YTD/MTD & filter Direktorat). Tahun default diambil dari jam server saat ini (bukan lagi dibekukan ke `2026`). Response menyertakan `available_years` (daftar tahun yang benar-benar punya data survei di database, dipakai untuk mengisi dropdown Tahun di Header secara dinamis). Sejak v2.15.0, setiap metrik menyertakan `target_value_normalized` — `target_value` (yang tersimpan dalam skala asli metrik, mis. `4.00` untuk RATING_5) dikonversi ke skala 0-100 yang sama dengan `normalized_score`/`min_threshold` via `normalizeTarget()`, dan status HEALTHY/WARNING/CRITICAL kini dihitung dari perbandingan yang sudah senormalisasi ini (sebelumnya WARNING nyaris tidak pernah tercapai untuk metrik RATING_5/QUOTA_COUNT karena target mentah dibandingkan langsung dengan skor 0-100) | `mode=YTD\|MTD`, `year` (default: tahun berjalan), `month=01..12`, `endMonth` (opsional, mode YTD saja — batasi kumulatif s/d akhir bulan tertentu), `directorate=...`, `sub_directorate=...` |
| `GET` | `/api/metrics/trends` | Mengambil deret waktu Performance Trend, **bisa lintas tahun** (mis. November 2025 s/d Februari 2026) via `startYear`/`startMonth`/`endYear`/`endMonth` — tidak lagi dibekukan ke satu tahun atau ke 2026. `mode=YTD` (default) → tiap titik adalah rata-rata kumulatif Januari **tahunnya sendiri** s/d bulan tersebut (reset tiap 1 Januari, konvensi YTD standar — rentang lintas tahun menampilkan kurva YTD tiap tahun berurutan, bukan satu akumulasi menerus); `mode=MTD` → tiap titik berdiri sendiri (trivial lintas tahun). **Hanya bulan yang benar-benar lengkap yang dikembalikan** — bulan berjalan dan seterusnya **tidak muncul sama sekali** di array `trends`. `endYear`/`endMonth` selalu di-clamp ke bulan lengkap terakhir di tahun manapun yang diminta, sekalipun user meminta rentang jauh ke masa depan. Response menyertakan `year`, `last_complete_month`, dan `available_years` (daftar tahun yang benar-benar punya data di database, dari `storage.getAvailableSurveyYears()`) agar frontend tahu batas rentang & opsi tahun yang valid. Setiap titik trend menyertakan field `year` dan dihitung via `calculatePEIndex()` (metode normalisasi + bobot per-metrik yang **identik** dengan scorecard utama `/api/metrics/calculate`) | `mode` (`YTD`\|`MTD`), `year`, `startYear`, `startMonth`, `endYear`, `endMonth`, `directorate`, `sub_directorate` |
| `GET` | `/api/metrics/:metric_id/detail`| Mengambil rincian drilldown metrik (question breakdown, responses table / HR operational logs). Untuk metrik OUTCOME, field `operational_records` (breakdown SLA/channel/recognition per unit) sejak v2.16.0 dibaca dari database (`storage.getOperationalRecords(metric_id)`, sumber: `seedData.js`'s `initialOperationalRecords`), bukan lagi array statis inline di `calculationEngine.js` — metrik tanpa tabel breakdown seeded mengembalikan `[]`. `total_respondents` selalu berupa hitungan respons asli dari database (bisa `0`), tidak lagi memakai placeholder fiktif untuk metrik ESS tanpa data | `period=YTD` atau `mode=YTD\|MTD&year=2026&month=01` |
| `GET` | `/api/directorates` | Mengambil daftar 7 Direktorat CIMB Niaga beserta Sub-Direktorat / Divisi terkait | `-` |

---

### 2.3 Modul Manajemen Survei (Template, Upload & Evidence)
| Method | Endpoint | Deskripsi | Parameter / Payload |
| :---: | :--- | :--- | :--- |
| `GET` | `/api/surveys/template` | Mengunduh berkas template CSV survei spesifik (karyawan / non-karyawan) atau master all-surveys | `metric_id=2` (Campus), `metric_id=5` (Candidate), atau `metric_id=ALL` |
| `POST` | `/api/surveys/upload` | Mengunggah dan memproses berkas CSV respon survei | Body: `{ csvText, fileName, metric_id }` |
| `GET` | `/api/surveys/evidence` | Mengunduh berkas CSV audit trail data respon koresponden | `metric_id=2`, `metric_id=5`, `metric_id=ALL`, `period=YTD` |

---

### 2.4 Modul Admin: Parameter Terpadu Journeys & Metrics (CRUD, Bobot & Thresholds) (v2.9.0)
| Method | Endpoint | Deskripsi | Parameter / Payload |
| :---: | :--- | :--- | :--- |
| `GET` | `/api/admin/parameters` | Mengambil konfigurasi lengkap Journeys, Checkpoints, dan 27 Metrik. Sejak v2.15.0, setiap metrik disertai `target_value_normalized` (target dikonversi ke skala 0-100 yang sama dengan `min_threshold`, via `normalizeTarget()`) sehingga Admin Parameter UI bisa menampilkan Target dan Threshold dalam satuan yang sebanding, bukan skala asli metrik (mis. 1-5) vs persen. | `-` |
| `POST` | `/api/admin/journeys` | Menambahkan journey baru | Body: `{ journey_code, journey_name, tagline, color, icon, display_order }` |
| `PUT` | `/api/admin/journeys/:id` | Memperbarui parameter journey | Body: `{ journey_name, tagline, color, icon, display_order }` |
| `DELETE`| `/api/admin/journeys/:id`| Menghapus journey | Path: `id` |
| `POST` | `/api/admin/metrics` | Menambahkan parameter metrik baru | Body: `{ journey_id, checkpoint_id, metric_name, metric_type, scale_type, target_value, min_threshold, metric_weight, is_employee_metric, target_audience, survey_source }` (`survey_source` lihat catatan v2.29.0) |
| `PUT` | `/api/admin/metrics/:id` | Memperbarui parameter metrik, target, threshold, dan bobot | Body: `{ metric_name, target_value, min_threshold, metric_weight, is_employee_metric, target_audience, survey_source, ... }` |
| `DELETE`| `/api/admin/metrics/:id` | Menghapus parameter metrik | Path: `id` |
| `POST` | `/api/admin/parameters/reset` | Mereset seluruh parameter journeys dan metrics ke default korporat | `-` |

---

### 2.5 Modul Admin: Pengaturan Template & Butir Pertanyaan
| Method | Endpoint | Deskripsi | Parameter / Payload |
| :---: | :--- | :--- | :--- |
| `GET` | `/api/admin/survey-questions` | Mengambil daftar 20 metrik survei beserta konfigurasi butir pertanyaan aktif | `-` |
| `GET` | `/api/admin/survey-questions/:metric_id` | Mengambil konfigurasi pertanyaan untuk satu metrik tertentu | Path: `metric_id` |
| `POST` | `/api/admin/survey-questions/:metric_id` | Menyimpan perubahan butir pertanyaan kustom (label, teks, tipe, urutan) | Body: `{ questions: [...] }` |
| `POST` | `/api/admin/survey-questions/:metric_id/reset` | Mereset konfigurasi pertanyaan metrik kembali ke default baku CIMB | Path: `metric_id` |

---

### 2.6 Modul Signature Program Events & PPT Export
| Method | Endpoint | Deskripsi | Parameter / Payload |
| :---: | :--- | :--- | :--- |
| `GET` | `/api/events` | Mengambil daftar seluruh event program signature | `-` |
| `POST` | `/api/events` | Membuat event program signature baru | Body: `{ event_id, name, date, quota, ... }` |
| `GET` | `/api/events/:event_id` | Mengambil detail event, log absensi, dan skor feedback | Path: `event_id` |
| `POST` | `/api/events/:event_id/attendance` | Mencatat absensi kehadiran peserta via QR Code / Form | Body: `{ nip, employee_name, cimb_email, ... }` |
| `POST` | `/api/events/:event_id/feedback` | Menyimpan respon kuesioner evaluasi pasca-event | Body: `{ nip, ratings: {...}, verbatim }` |
| `DELETE` | `/api/events/:event_id` | Menghapus event beserta seluruh absensi, feedback, dan pertanyaan kustom terkait | Path: `event_id` |
| `DELETE` | `/api/events/:event_id/attendance/:nip` | Menghapus satu catatan absensi berdasarkan NIP (mis. untuk membersihkan data uji) | Path: `event_id`, `nip` |
| `DELETE` | `/api/events/:event_id/feedback/:nip` | Menghapus satu respon feedback berdasarkan NIP (mis. untuk membersihkan data uji) | Path: `event_id`, `nip` |
| `POST` | `/api/events/:event_id/media` | Upload foto/video dokumentasi (`multipart/form-data`, field `mediaFile`). Hanya `image/*` & `video/*` (selain itu **415**), batas `MEDIA_MAX_MB` (default 200 MB, lebih dari itu **413**). Tipe ditentukan dari MIME file. Video dijawab langsung dengan `transcript_status: "PROCESSING"` lalu ditranskrip di background | Path: `event_id`; Form: `mediaFile`, `caption` |
| `POST` | `/api/media/:media_id/transcribe` | (Ulang) memulai transkrip AI untuk video — dipakai tombol "Coba lagi". **202** diterima, **400** bila bukan video, **404** bila media tak ada, **409** bila sedang diproses | Path: `media_id` |
| `POST` | `/api/media/:media_id/summarize` | (Ulang) membuat **AI Summary** transkrip video (tombol "Buat / Buat ulang ringkasan"; pengelola event saja). **202** + record media berstatus `PROCESSING`; **400** bukan video; **404** media tak ada; **409** transkrip belum `DONE` atau ringkasan sedang diproses/antri; **403** non-pengelola; **401** tanpa login | Path: `media_id` |
| `DELETE` | `/api/media/:media_id` | Menghapus record media **beserta file fisiknya** di `server/uploads` | Path: `media_id` |
| `POST` | `/api/events/:event_id/generate-ppt` | Menghasilkan dan menyajikan berkas presentasi PowerPoint (.pptx) | Path: `event_id` |

> **Transkrip AI video (sejak v2.21.0)**: `server/services/transcribeService.js` memanggil API audio/video-to-text lokal (faster-whisper, default `http://127.0.0.1:8000`, `POST /transcribe` dengan body `{"source": "<path file di server>", "language": "id"}`) — **path lokal** file yang diupload dikirim, sehingga video tidak keluar dari mesin (patuh aturan 100% on-premise). Bahasa default `id` (`TRANSCRIBE_LANGUAGE`). Karena Whisper di CPU bisa memakan menit, hasilnya disimpan ke record media: `transcript_status` (`PROCESSING`/`DONE`/`FAILED`), `transcript` (teks lengkap), `transcript_segments` (`[{start, end, text}]`), `transcript_language`, `duration_seconds`, `transcript_error`, dan `ai_generated_description` diisi cuplikan transkrip. Job yang terputus karena restart server otomatis dilanjutkan saat boot. Konfigurasi di `.env`: `TRANSCRIBE_API_URL`, `TRANSCRIBE_LANGUAGE`, `TRANSCRIBE_TIMEOUT_MS`, `MEDIA_MAX_MB` (lihat `.env.example`).

> **Ukuran slide PPT (sejak v2.20.1)**: `server/services/pptGenerator.js` memakai `pptx.layout = 'LAYOUT_WIDE'` (13.33" × 7.5"). Seluruh koordinat konten (judul, kartu, tabel, footer) dirancang pada kanvas tersebut — sebelumnya memakai `LAYOUT_16x9` (10" × 5.625") sehingga konten setiap slide melebihi batas slide. Tambahan elemen baru harus tetap berada dalam 13.33" × 7.5".

---

### 2.7 Modul Peringatan Kinerja & Rekomendasi Aksi
| Method | Endpoint | Deskripsi | Parameter Query |
| :---: | :--- | :--- | :--- |
| `GET` | `/api/alerts` | Mengambil daftar metrik yang mengalami defisit kinerja beserta rekomendasi inisiatif AI/HR. Setiap alert memuat `narrative_summary` — narasi 1 paragraf yang sejak v2.28.0 **murni rule-based** (`alertEngine.js` → `localAiService.generateAlertNarrative()`, tidak lagi memanggil Ollama; sebelumnya dicoba via Ollama sejak v2.10.0), sehingga endpoint ini tidak bergantung pada Ollama. | `-` |

---

### 2.8 Modul Pengingat Upload Survei (Survey Upload Reminders)
| Method | Endpoint | Deskripsi | Parameter Query |
| :---: | :--- | :--- | :--- |
| `GET` | `/api/admin/upload-reminders` | Mengambil daftar metrik SURVEY yang memerlukan reminder (`requires_manual_upload: true`) dan belum diupload untuk siklus berjalan — status `DUE_SOON` (≤5 hari sebelum `upload_deadline_day`/`upload_deadline_month`) atau `OVERDUE` (lewat batas waktu) | `-` |
| `POST` | `/api/admin/upload-reminders/send` | Mengirim email reminder ke seluruh `pic_email` yang tercantum pada daftar pending reminder, via SMTP on-premise (`reminderService.js` + `nodemailer`). Jika `SMTP_HOST` belum dikonfigurasi, reminder tetap dihitung dan dicatat di log server (`email_status: "LOGGED_ONLY"`) tanpa membuat request gagal | `-` |

Server juga menjalankan pengecekan reminder otomatis setiap 24 jam (mulai ±15 detik setelah
backend boot) tanpa perlu dipicu manual — lihat `server.js` bagian `app.listen(...)`.

---

## 💻 3. Contoh Request & Response Schema

### Contoh Request: Update Pertanyaan Survei (`POST /api/admin/survey-questions/7`)
```json
{
  "questions": [
    {
      "key": "q1_recruitment_process",
      "label": "Kepuasan Proses Rekrutmen",
      "text": "Saya puas dengan proses rekrutmen saya secara keseluruhan, mulai dari komunikasi dengan Recruiter sampai dengan penandatanganan perjanjian kerja",
      "type": "SCALE_1_5",
      "mandatory": true
    },
    {
      "key": "q6_welcoming_email",
      "label": "Penerimaan Welcoming Email",
      "text": "Saya menerima Welcoming Email melalui email pribadi sebelum tanggal bergabung.",
      "type": "YES_NO",
      "mandatory": true
    }
  ]
}
```

### Contoh Response: Kalkulasi PE Index (`GET /api/metrics/calculate?period=2026-03`)
```json
{
  "success": true,
  "period": "2026-03",
  "period_label": "Maret 2026",
  "pe_index": 86.42,
  "survey_index": 85.80,
  "outcome_index": 87.88,
  "weights": {
    "survey_weight": 0.70,
    "outcome_weight": 0.30
  },
  "journeys": [
    { "journey_id": "arrival", "name": "Arrival", "score": 88.50, "metric_count": 7 },
    { "journey_id": "connect", "name": "Connect", "score": 84.10, "metric_count": 3 },
    { "journey_id": "belong", "name": "Belong", "score": 87.30, "metric_count": 7 },
    { "journey_id": "contribute", "name": "Contribute", "score": 86.20, "metric_count": 6 },
    { "journey_id": "depart", "name": "Depart", "score": 83.90, "metric_count": 4 }
  ],
  "metrics": [
    {
      "metric_id": 7,
      "metric_name": "Day 1 Onboarding satisfaction index",
      "metric_type": "SURVEY",
      "raw_average": 4.85,
      "normalized_score": 97.00,
      "target_value": 4.50,
      "min_threshold": 80.00,
      "status": "ON_TARGET",
      "total_respondents": 48
    }
  ]
}
```

---

## 🗄️ Catatan v2.22.0 — Storage Layer Kini Async & Dua Backend

- `server/db/storage.js` = dispatcher (`STORAGE_BACKEND=json|sql`) → `jsonStorage.js` atau `sqlStorage.js`. **Semua method storage adalah async** (`await storage.getMetrics()` dst.); begitu pula `calculatePEIndex()`, `getMetricDetail()`, `computeMonthlyTrends()`, `generateSurveyCsvTemplate()`, `generateSurveyEvidenceCsv()`, `processSurveyCsv()`, `getPendingUploadReminders()`, `queueMediaTranscription()`, `resumeInterruptedTranscriptions()`. Semua route handler di `server.js` kini `async`. Server baru mulai `listen` setelah `storage.init()` (no-op untuk JSON; untuk SQL: connect + skema + seed) dan berhenti dengan pesan jelas bila SQL Server tak terjangkau.
- `GET /api/health` → field `database`: `{ mode, backend: 'json'|'sql', ... }`; untuk SQL ditambah `server`, `database`, `edisi`, `version`, `tables` (jumlah baris live). `version` = `2.22.0`.
- Method tambahan khusus SQL: `init()`, `health()`, `close()`, `importStore()`, `applySchema()`, `dropAllTables()`, `getAllOperationalRecords()`. Utilitas bersama kedua backend: `server/db/filterUtils.js` (`parseFilterOptions`, `normalizeDateString`), `server/db/initialStore.js` (dataset awal).
- Script: `npm run db:migrate` (`server/db/migrate.js`), `npm run db:export` (`server/db/exportToJson.js`). Detail di `docs/08`.

---

## ⚙️ Catatan v2.22.1 — Endpoint Pengaturan & Sumber Data

- **`GET /api/settings`** → `{ px_index_target, event_program_categories, event_types }` dari `px_app_settings`. **`PUT /api/admin/settings/:key`** body `{ value }`: `px_index_target` harus angka 0–100; daftar opsi harus array `{ value, label }` tidak kosong; key tidak dikenal → 404. `GET /api/metrics/trends` kini menyertakan `px_index_target`.
- **Pertanyaan survei** (`/api/admin/survey-questions[...]`) kini dibaca/ditulis ke `px_survey_questions` (SQL) — `POST` dan `POST .../reset` mengembalikan **404** bila metric tidak ada. Template kode (`metricQuestionService.js`) hanya dipakai untuk seed awal dan aksi Reset.
- Storage method baru: `getSettings()`, `setSetting(key, value)` (kedua backend); khusus SQL `seedSurveyQuestions()`, `_customizedQuestions()`.
- Perbaikan logika: alert WARNING membandingkan terhadap `target_value_normalized`; drilldown Metric 11 memakai `event_name` & `attendance_timestamp`.

---

## 📧 Catatan v2.23.0 — Setting Email Reminder

- **`GET /api/admin/email-settings`** → `{ enabled, provider, smtp_host, smtp_port, smtp_secure, smtp_user, from_name, from_email, has_password, updated_at, env_fallback_available }` — **tidak pernah** memuat password.
- **`PUT /api/admin/email-settings`** body: field di atas + `smtp_password` (opsional; kosong = pertahankan yang tersimpan) + `clear_password`. Provider `GMAIL` mengunci host/port ke smtp.gmail.com:465; `SMTP` memakai host/port/secure yang dikirim. Validasi → 400 (provider, port 1–65535, format email, mengaktifkan tanpa host/akun/password).
- **`POST /api/admin/email-settings/test`** body `{ to }` (default: email pengirim) → 200 `{ sent: true, to, accepted }` atau 502 `{ sent: false, error }` dengan penjelasan (mis. Gmail menolak password biasa); alamat tujuan tidak valid → 400.
- `POST /api/admin/upload-reminders/send` kini memakai pengirim dari database (`sender_source`: `database` | `env` | `none`). Storage baru: `getEmailSettings()`, `saveEmailSettings()`. Service baru: `emailSettingsService.js`, `secretBox.js` (AES-256-GCM).
- `PUT /api/admin/settings/:key` untuk `metric_types`, `scale_types`, `target_audiences`, `update_frequencies`, `question_types`: hanya label yang boleh berubah.

---

## ⏰ Catatan v2.24.0 — Reminder Upload Survei Otomatis

- **Aturan**: metrik SURVEY ber-flag `requires_manual_upload`; pada/sesudah `upload_deadline_day` bulan M, bila **tidak ada** baris di `px_survey_uploaded_responses` untuk metrik itu dengan `survey_date` di bulan M‑1 (`storage.hasSurveyDataInPeriod(metric_id, start, endExclusive)`) → email ke `pic_email`. Tahunan: dari tanggal batas tahun itu bila belum ada data tahun tsb. Sebelum tanggal batas tidak ada reminder.
- **Scheduler**: `startReminderScheduler()` (dipanggil saat server listen) — siklus ±20 dtk setelah boot lalu tiap 30 menit; mulai kirim pada jam `reminder_send_hour` (default 8). Dedupe/ulang via `px_reminder_log` (`getReminderLog`, `getReminderLogFor`, `addReminderLog`) dan setting `reminder_repeat_days` (default 1; 0 = sekali). Gagal kirim maks 3×/hari; bila pengirim belum dikonfigurasi, tidak dicatat sebagai terkirim.
- **`GET /api/admin/upload-reminders`** → `{ total_reminders, overdue_count, due_today_count, reminders[{ metric_id, metric_name, pic_name, pic_email, deadline, expected_period, expected_period_label, days_overdue, status: DUE_TODAY|OVERDUE }], history[] }`.
- **`POST /api/admin/upload-reminders/send`** body (semua opsional): `reference_date` ('YYYY-MM-DD', simulasi hari lain; format salah → 400), `dry_run` (tidak kirim/catat; hasil `WOULD_SEND`/`SKIPPED`), `automatic` (jalankan seperti scheduler: dedupe + interval; tanpa ini = "kirim sekarang" untuk semua yang pending), `metric_id` (batasi satu metrik). Hasil per metrik: `email_status` ∈ SENT | FAILED | SKIPPED (+`skip_reason`) | SKIPPED_NO_EMAIL | LOGGED_ONLY | WOULD_SEND.
- `PUT /api/admin/settings/reminder_send_hour` (bilangan bulat 0–23) dan `reminder_repeat_days` (0–31); di luar rentang / bukan bilangan bulat → 400.
- **Penghapusan metrik** (`DELETE /api/admin/metrics/:id`) kini juga menghapus respons survei, riwayat upload, pertanyaan, dan log reminder metrik itu.

---

## 🎞️ Catatan v2.24.1 — Transkrip Video

- `POST /api/media/:id/transcribe` ("Coba lagi"): 404 media tak ada; 400 bukan video; 409 masih PROCESSING; **503** bila API transkrip tidak aktif (status media tidak diubah); 202 `{ media }` dengan `transcript_status: PROCESSING` bila pekerjaan dimulai.
- Hasil transkrip: `transcript` = field `text` respons API (di-trim; bila tidak ada `text` → gabungan teks segmen), `transcript_segments` = array `segments` apa adanya (`start`, `end`, `text`), `transcript_language`, `duration_seconds`, `ai_generated_description` = kutipan awal `text`.

---

## 🏷️ Catatan v2.25.0 — Satuan Nilai Aktual Metrik (`unit`)

- Field **`unit`** (teks, mis. `orang/tahun`, `pax`, `/ 5`, `%`) ada di tiap metrik pada `GET /api/metrics/calculate`, `GET /api/metrics/:id/detail` (di level atas dan `metric.unit`), dan `GET /api/admin/parameters`.
- `POST`/`PUT /api/admin/metrics` menerima `unit`: wajib, di-trim, 1–30 karakter, kosong/terlalu panjang → **400** ("Satuan nilai tidak boleh kosong." / "Satuan nilai maksimal 30 karakter."). `PUT` tanpa `unit` mempertahankan nilai lama; `POST` tanpa `unit` memakai default skala (`RATING_5` → `/ 5`, `QUOTA_COUNT` → `pax`, lainnya `%`). Hanya label tampilan — tidak memengaruhi skor/status.

---

## 🔐 Catatan v2.26.0 — Login, Role & Aturan Akses

**Rute publik (tanpa login)** — selebihnya `/api/*` → 401 `{ code: 'AUTH_REQUIRED' }`:

| Method | Endpoint | Catatan |
| :---: | :--- | :--- |
| `GET` | `/api/health` | tanpa login: status + versi saja |
| `POST` | `/api/auth/login` | rate limit per IP |
| `GET` | `/api/directorates` | dropdown form publik |
| `GET` | `/api/events/by-code/:code` | tidak mengembalikan kode akses partner |
| `POST` | `/api/events/:id/attendance`, `/api/events/:id/feedback` | check-in & feedback peserta |

### 2.9 Modul Autentikasi & Manajemen User
| Method | Endpoint | Akses | Deskripsi |
| :---: | :--- | :---: | :--- |
| `POST` | `/api/auth/login` | publik | Body `{ username, password }` → set cookie `px_session`; balas `{ user, permissions: { is_admin, can_manage_events } }`. Salah/tidak dikenal/nonaktif/terkunci → 401 pesan generik; kosong → 400; terlalu banyak gagal → 429 + `Retry-After` |
| `POST` | `/api/auth/logout` | login | Hapus sesi di server + cookie |
| `GET` | `/api/auth/me` | login | User (termasuk `scopes`) + permissions saat ini |
| `POST` | `/api/auth/change-password` | login | `{ current_password, new_password }`; aturan password di bawah; sesi lain milik user itu dimatikan |
| `GET` | `/api/admin/users` | ADMIN | Daftar akun (tanpa `password_hash`) |
| `POST` | `/api/admin/users` | ADMIN | `{ username, full_name, email?, role, scopes }` (v2.27.0; bentuk lama `directorate` + `division` masih diterima) → 201 `{ user, temporary_password, is_default_password }` (tampil sekali; v2.27.2: bila env `DEFAULT_INITIAL_PASSWORD` terisi, `temporary_password` = password awal standar itu dan `is_default_password: true`, selain itu acak dan `false`). Username 3-50 karakter `[A-Za-z0-9._-]`; USER wajib minimal satu cakupan, direktorat/divisi harus ada di direktori database; ADMIN tidak terikat direktorat; duplikat → 409 |
| `PUT` | `/api/admin/users/:id` | ADMIN | Ubah `full_name`, `email`, `is_active`, `role`/`scopes` (atau bentuk lama `directorate`/`division`). Tidak bisa menonaktifkan/menurunkan diri sendiri atau Admin aktif terakhir (400); nonaktif/ganti role mematikan sesi user itu |
| `POST` | `/api/admin/users/:id/reset-password` | ADMIN | Password sementara baru (acak, atau password awal standar bila env `DEFAULT_INITIAL_PASSWORD` terisi; respons memuat `is_default_password`; tampil sekali), membuka kunci akun, mematikan sesi; tidak untuk akun sendiri |
| `DELETE` | `/api/admin/users/:id` | ADMIN | Hapus akun (bukan diri sendiri / Admin aktif terakhir). Belum ada tombol di UI |
| `GET` | `/api/admin/audit-log` | ADMIN | `?limit=` (default 200, maks 1000), terbaru dulu |

Aturan password baru: 10-128 karakter, mengandung huruf dan angka, tidak sama dengan username, berbeda dari password lama, dan (v2.27.2) tidak sama dengan password awal standar bila env `DEFAULT_INITIAL_PASSWORD` terisi (`400`). Password awal itu sendiri (buatan sistem) dikecualikan dari aturan ini dan tidak dicatat di audit log.

### Rute → aturan akses (USER vs ADMIN)
| Rute | USER | ADMIN |
| :--- | :--- | :--- |
| `GET /api/metrics/calculate`, `/api/metrics/trends` | hanya cakupannya (v2.27.0: kosong/`ALL` → semua cakupan saya; direktorat/divisi di luar cakupan → 403). `calculate`: metrik non-karyawan = agregat bankwide read-only, `excluded_from_index` | semua |
| `GET /api/metrics/:id/detail` | idem; payload di-`redactRespondent()` + `respondent_data_hidden: true` | lengkap |
| `GET /api/surveys/evidence`, `GET /api/surveys/responses/:metric_id` | 403, kecuali PIC metrik itu (v2.27.1, lihat tabel di bawah) | ya |
| `GET /api/surveys/metrics`, `/template`, `/history`; `POST /api/surveys/upload` | 403, kecuali PIC (v2.27.1) | ya |
| `POST /api/metrics/score`, `/api/metrics/weights`, `/api/alerts/acknowledge`, `/api/action-library`, `/api/questions/master` | 403 | ya |
| `GET /api/alerts`, `/api/action-library`, `/api/questions/master`, `/api/settings`, `/api/directorates` | ya (v2.27.0: `/api/alerts` dihitung dari data dalam cakupan) | ya |
| `/api/admin/*` (parameter, journeys, metrics, targets, survey-questions, upload-reminders, email-settings, settings, users, audit-log) | 403 | ya |
| `GET /api/events`, `/api/events/:id` | ya, tanpa kode akses; absensi/feedback per orang disamarkan | lengkap |
| `POST/DELETE` event, hapus absensi/feedback, media, transkrip, `generate-ppt`, `GET /api/reports/download/:file`, `/exports/*` | hanya bila direktoratnya ada di setting `event_manager_directorates` (default Human Resources); selain itu 403 | ya |
| `/uploads/*` | ya | ya |

Setting baru (`px_app_settings`, ubah lewat `PUT /api/admin/settings/:key`; angka divalidasi rentang): `session_hours` (8; 1-72), `login_max_attempts` (5; 3-20), `login_lockout_minutes` (15; 1-1440), `login_rate_limit_per_minute` (20; 5-200), `event_manager_directorates` (daftar `{ value, label }`, default Human Resources).

Respons 403 tambahan: `PASSWORD_CHANGE_REQUIRED` (akun belum ganti password sementara) dan penolakan `Origin` lintas-host pada request tulis. Service baru: `authService.js`, `rateLimiter.js`; storage: `getUser*/createUser/updateUser/deleteUser`, `createSession/getSession/deleteSession[sForUser]/purgeExpiredSessions`, `addAuditLog/getAuditLog` di `sqlStorage.js` dan `jsonStorage.js`.

## 🎯 Catatan v2.27.0 — Cakupan Data User (scopes)

**Bentuk `scopes`** (di `GET|POST /api/admin/users`, `PUT /api/admin/users/:id`, `GET /api/auth/me`): `[{ "directorate": "<nama>", "divisions": null | ["<divisi>", ...] }]`. `null` (atau `[]` pada input) = semua divisi direktorat itu. Respons selalu dinormalisasi: satu entri per direktorat, divisi digabung, "semua" menyerap subset. Objek user tetap memuat `directorate`/`division` tunggal untuk klien lama (terisi hanya bila cakupan tepat satu direktorat; `division` hanya bila tepat satu divisi).

**Validasi (400)**: User tanpa `scopes`/kosong, `scopes` bukan array, entri tanpa direktorat, direktorat atau divisi tak ada di direktori, divisi bukan milik direktoratnya, `divisions` bukan array string, Admin dengan cakupan tidak kosong, bentuk lama tanpa `division`. Menurunkan Admin → User tanpa `scopes` ditolak; mengubah ke Admin mengosongkan cakupan. Permintaan ditolak tidak mengubah apa pun. `PUT` ke id tak ada → 404. Perubahan cakupan dicatat sebagai `USER_SCOPE_CHANGE` di `px_audit_log` (kolom `target` dipotong ±190 karakter).

**Aturan rute yang berubah untuk USER** (Admin tidak dibatasi):

| Rute | Perilaku v2.27.0 |
| :--- | :--- |
| `GET /api/metrics/calculate`, `/trends`, `/:id/detail` | `?directorate&sub_directorate` diselesaikan oleh `resolveScope()`; kosong/`ALL` = gabungan seluruh cakupan (di-pool, sampel = jumlah sampel); satu direktorat dari cakupan = angka sama dengan tampilan Admin untuk direktorat itu; di luar cakupan → 403. `calculate` menambah `filter_options.scopes` dan `is_directorate_filtered` |
| `GET /api/alerts` | Menerima `?directorate&sub_directorate`; skor dan komentar verbatim dihitung dari responden dalam cakupan saja; di luar cakupan → 403. Tiap alert punya `is_bankwide_readonly` (true untuk metrik non-karyawan/OUTCOME: nilai bankwide read-only) |
| `GET /api/events`, `/api/events/:id` | Non-pengelola hanya melihat absensi dan feedback peserta dalam cakupan; `total_attendees` di daftar mengikuti. Admin melihat semua |
| Rute tulis event, media, transkrip, PPT | Pengelola event = Admin, atau User yang cakupannya memuat direktorat di setting `event_manager_directorates` (`permissions.can_manage_events`) |

Catatan: User dengan "semua divisi" yang meminta `sub_directorate` tak dikenal mendapat 200 dengan data kosong (bukan 403), tanpa kebocoran. Kode: `server/db/scopeUtils.js` (`normalizeScopes`, `scopeAllows`, `rowInScopes`, `legacyUserScopes`), `authService.js` (`resolveScope`, `isInScope`, `scopeFilter`, `describeScopes`), `filterUtils.js` dan `calculationEngine.js` (filter gabungan), `alertEngine.js` (parameter `scope`), storage SQL/JSON (`createUser`/`updateUser`/`getUser*` memuat `scopes`).

## 🧑‍💼 Catatan v2.27.1 — PIC Metrik Terhubung ke Akun

Akun `USER` aktif = PIC metrik M bila emailnya == `pic_email` M (case-insensitive, `trim`; M harus SURVEY; sejak v2.29.0 flag `requires_manual_upload` tidak lagi disyaratkan, lihat catatan v2.29.0 di bawah). Penetapan tetap di Parameter Admin; hak dibaca dari DB tiap request. Helper di `authService.js`: `picMetrics`, `picMetricIds`, `getPicMetric`, `isPicOfMetric`, `canSeeRespondentData` (async), `requirePicMetric`, `respondentScopeFor`, `rowsForViewer`. Admin tidak dianggap PIC (selalu lolos).

| Rute | Admin | PIC (metrik miliknya) | PIC (metrik lain / `ALL` / kosong) | User non-PIC |
| :--- | :--- | :--- | :--- | :--- |
| `GET /api/surveys/metrics` | semua metrik SURVEY | hanya metrik miliknya | — | 403 |
| `GET /api/surveys/template?metric_id=` | semua, termasuk `ALL` | ya | metrik lain 403; `ALL`/kosong/tidak valid 400 | 403 |
| `POST /api/surveys/upload` (`metric_id` dari form) | semua, termasuk `ALL`/auto-detect | ya; `metric_id` di dalam CSV diabaikan | metrik lain 403; `ALL`/kosong 400 | 403 |
| `GET /api/surveys/history` | semua batch | batch metrik miliknya | — | 403 |
| `GET /api/surveys/evidence` | semua / `ALL` | CSV hanya responden dalam cakupan akun | metrik lain 403 | 403 |
| `GET /api/surveys/responses/:metric_id` | semua baris | baris dalam cakupan akun | metrik lain 403 | 403 |
| `GET /api/metrics/:id/detail` | identitas lengkap | identitas hanya untuk metrik PIC (data sudah dalam cakupan) | tersamar, `respondent_data_hidden: true` | tersamar |

Perubahan perilaku:
- **Field baru**: `can_upload` (boolean, dihitung server) pada tiap metrik di `GET /api/metrics/calculate` dan pada `GET /api/metrics/:id/detail` — true untuk metrik SURVEY bila Admin/PIC-nya; `active_account_emails` di `GET /api/admin/parameters` (email akun aktif, huruf kecil, untuk peringatan "PIC belum punya akun"); `pic_metrics` (read-only) per akun di `GET /api/admin/users`.
- **Upload**: `uploaded_by` = `Nama (username)` (maks 200 karakter; dulu "HR Admin") lewat `options.uploadedBy` pada `processSurveyCsv()`; audit **`SURVEY_UPLOAD`** (`metrik <id>; <n> baris valid, <m> ditolak; batch <id>`, tanpa data responden) hanya bila impor berhasil; respons untuk non-Admin **tanpa** `calculation`/`updated_pe_index`/`updated_survey_index`, dan `affected_metrics[].normalized_score = null`. File CSV sementara di `server/uploads/` dihapus (blok `finally`).
- **Evidence**: `generateSurveyEvidenceCsv(metric_id, period, { scopes })` menyaring responden ke cakupan PIC; `escapeCsv` memberi apostrof di depan teks berawalan `= + - @` / tab / CR (angka biasa tidak diubah).
- **Validasi id & error**: `evidence` dan `responses/:metric_id` untuk Admin dengan id tidak valid → 400, tidak ada → 404 (dulu 500). Handler error JSON terakhir: upload melewati batas 50 MB → 413 `Ukuran file CSV melebihi batas 50 MB.`; body JSON rusak → 400 JSON; tidak ada lagi halaman HTML/stack trace.
- **Reminder**: tetap ke `pic_email` (tidak diubah).

Tidak diubah / belum diputuskan: importer tidak menolak NIP kembar (dalam satu CSV atau antar-batch; juga untuk Admin); tanggal survei tidak valid disimpan sebagai hari ini; PIC dapat mengunggah baris di luar cakupannya; unduh template/evidence tidak diaudit.

---

## 🤖 Catatan v2.28.0 — AI Summary Video (Gemma 3 4B Lokal)

**Field baru pada record media** (sama di SQL `px_media` dan JSON; hadir hanya setelah ringkasan pernah diminta):

| Field | Isi |
| :--- | :--- |
| `summary` | Ringkasan 2-4 kalimat |
| `summary_points` | Array 2-5 poin utama |
| `summary_status` | `PROCESSING` / `DONE` / `FAILED` / `INSUFFICIENT` (kosong = belum ada) |
| `summary_source` | `AI` (lolos validator) atau `RULE` (fallback ekstraktif) |
| `summary_model` | Model yang dipakai (mis. `gemma3:4b`), hanya untuk sumber `AI` |
| `summary_language` | Mengikuti `transcript_language`; kode tak dikenal -> `id` |
| `summary_generated_at`, `summary_error` | Waktu dibuat; alasan fallback/gagal (teks Indonesia, maks. 500 karakter) |

**Service**

- `mediaSummaryService.js`: `queueMediaSummary(media_id)` (hanya video dengan `transcript_status = DONE`; mengembalikan `queued`/`insufficient`/`duplicate`/`skipped`), `resumeInterruptedSummaries()` (dipanggil `server.js` saat boot; hanya yang `PROCESSING`), `validateAnswer`, `numberMentions`, `novelWords`, `splitTranscript`, `parseModelAnswer`, `ruleBasedSummary`.
- Konstanta: `MIN_WORDS = 20`, `CHUNK_CHARS = 5000`, `MAX_CHUNKS = 12`, poin 2-5. Format keluaran model: teks `RINGKASAN:` + `POIN:` (bukan JSON).
- Validator menolak: angka atau kata bilangan/kata satuan frekuensi yang tidak ada di transkrip, nama/akronim berkapital yang tidak ada di transkrip, bahasa salah (id/en), frasa meta, dan kata isi baru (>= 3 kata dan > 20% kata isi; hanya untuk bahasa id/en). Ditolak -> satu retry dengan alasan; gagal lagi, Ollama mati/timeout/model belum terpasang, atau transkrip > 12 bagian -> `RULE` dengan `summary_error`. Antrian penuh -> `RULE` langsung.
- `aiQueue.js`: satu job berjalan pada satu waktu; `enqueue(key, run)` -> `queued`/`duplicate`/`full`; batas antrian `AI_QUEUE_MAX` (default 50).
- `localAiService.js`: `queryLocalOllama(prompt, { scope, subject, ... })` memanggil `POST {OLLAMA_HOST}/api/generate` memakai modul `http` inti (bukan `fetch`, agar tidak terkena batas header 5 menit); timeout `OLLAMA_TIMEOUT_MS` (default 300000). `generateAlertNarrative` dan `generateEventSummary` kini rule-based.
- `transcribeService.js`: memicu `queueMediaSummary` setelah transkrip `DONE` (kegagalan memulai ringkasan tidak mengubah transkrip yang sudah selesai); memulai transkrip ulang mengosongkan semua field `summary_*`.
- `pptGenerator.js`: slide media (3 slot) memprioritaskan video ber-ringkasan `DONE`; teks "Ringkasan AI/otomatis: ..." dipotong di batas kata (300 karakter), dibaca dari database.
- `server.js`: `PX_DISABLE_SCHEDULERS=1` melewati `startReminderScheduler()` (hanya untuk backend kedua milik suite).

**Env (opsional)**: `OLLAMA_HOST` (default `http://localhost:11434`), `OLLAMA_MODEL` (default `gemma3:4b`), `OLLAMA_TIMEOUT_MS`, `AI_QUEUE_MAX`.

**Tidak dicakup**: analisis metrik WARNING/CRITICAL oleh Gemma (langkah berikutnya); validator tidak menjamin ketepatan makna (lihat `CHANGELOG.md` [2.28.0]).

---

## Catatan v2.29.0 - Survey Source (SYSTEM / ESS) & Upload Manual untuk Semua Survei

**Field `survey_source`** (`SYSTEM` | `ESS` | `null`) ada di tiap metrik pada `GET /api/metrics/calculate`, `GET /api/metrics/:id/detail` (level atas dan `metric.survey_source`) dan `GET /api/admin/parameters`. Metrik OUTCOME selalu `null`. Kolom database dan top-up boot: `docs/08` §14.

**Validasi `POST` / `PUT /api/admin/metrics`** (`server/db/surveySource.js`, dipakai kedua storage; `server.js` mengubah `Error` menjadi 400):

| Masukan | Hasil |
| :--- | :--- |
| `survey_source` bukan teks (`5`, `true`, `["ESS"]`, `{...}`) atau teks selain `SYSTEM`/`ESS` | **400** `Survey Source must be one of: SYSTEM, ESS.` - juga untuk metrik OUTCOME; permintaan `PUT` yang ditolak tidak mengubah apa pun |
| Huruf kecil / spasi tepi (`ess`, ` system `) | Diterima (di-`trim` dan dibesarkan) |
| SURVEY tanpa `survey_source` | `POST` -> `SYSTEM`; `PUT` mempertahankan nilai lama (fallback: inferensi dari `source_of_data`) |
| OUTCOME (atau SURVEY diubah menjadi OUTCOME) | Dipaksa `null`; OUTCOME diubah kembali ke SURVEY mendapat sumber lagi |
| Metrik ESS + `requires_manual_upload: false` (`POST` atau `PUT`) | **400** `ESS data is always uploaded manually: requires_manual_upload cannot be turned off for an ESS metric.` |
| Menjadikan metrik ESS tanpa menyebut `requires_manual_upload` | Flag otomatis `true` |
| Metrik SYSTEM | Flag mengikuti pilihan admin (boleh `false`) |

`PUT /api/admin/metrics/<id tidak ada>` tetap menjawab **400** (bukan 404) - perilaku lama, belum diubah.

**Deteksi ESS**: `calculationEngine.getMetricDetail()` memakai `isEssMetric()` - kolom `survey_source` menentukan; teks `source_of_data` memuat "ESS" hanya fallback bila kolom `null`. Hanya memengaruhi `is_ess` / `ess_summary`; skor, status dan angka metrik tidak berubah (snapshot 27 metrik sebelum/sesudah: hanya field baru).

**Upload manual semua metrik SURVEY**: `authService.isPicMetric(m)` = `m.metric_type === 'SURVEY'` (dulu juga `requires_manual_upload`). Efek pada tabel rute v2.27.1: PIC (akun USER ber-e-mail = `pic_email`) kini berhak atas Template / Upload / Evidence / `responses` / riwayat untuk **setiap** metrik SURVEY miliknya; `can_upload` bernilai true untuk setiap metrik SURVEY bila Admin atau PIC-nya; `GET /api/surveys/metrics` memuat semua metrik SURVEY untuk Admin. Tidak berubah: non-PIC dan PIC metrik lain -> 403; metrik OUTCOME dan id tidak dikenal ditolak (Admin pun); `metric_id` dari form menang atas kolom `metric_id` di CSV; audit `SURVEY_UPLOAD`; cakupan data PIC.

**`requires_manual_upload`** kini hanya berarti "kirim e-mail pengingat PIC" (`reminderService.js` tidak berubah; di data saat ini 20 metrik, semua ESS selalu termasuk). Metrik SURVEY tanpa flag tidak pernah diingatkan walau `pic_email` terisi dan batas tanggal terlewati.

**Tidak diubah / diketahui**: importer Admin dengan `metric_id` form non-numerik jatuh ke metrik SURVEY pertama (`surveyImportService.js`); NIP kembar belum ditolak importer; `last_survey_date` kosong di detail metrik ditampilkan UI sebagai hari ini.

