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
| `GET` | `/api/metrics/calculate` | Mengkalkulasi skor PE Index konsolidasi, skor journey, checkpoint, dan rincian 27 metrik (mendukung mode YTD/MTD & filter Direktorat). Tahun default diambil dari jam server saat ini (bukan lagi dibekukan ke `2026`). Response menyertakan `available_years` (daftar tahun yang benar-benar punya data survei di database, dipakai untuk mengisi dropdown Tahun di Header secara dinamis). Sejak v2.15.0, setiap metrik menyertakan `target_value_normalized` — `target_value` (yang tersimpan dalam skala asli metrik, mis. `4.00` untuk RATING_5) dikonversi ke skala 0-100 yang sama dengan `normalized_score`/`min_threshold` via `normalizeTarget()`, dan status HEALTHY/WARNING/CRITICAL kini dihitung dari perbandingan yang sudah senormalisasi ini (sebelumnya WARNING nyaris tidak pernah tercapai untuk metrik RATING_5/QUOTA_COUNT karena target mentah dibandingkan langsung dengan skor 0-100) | `mode=YTD\|MTD`, `year` (default: tahun berjalan), `month=01..12`, `endMonth` (opsional, mode YTD saja — batasi kumulatif s/d akhir bulan tertentu; sejak v2.36.0 tidak pernah melewati bulan berjalan, lihat "Catatan v2.36.0"), `directorate=...`, `sub_directorate=...` |
| `GET` | `/api/metrics/trends` | Mengambil deret waktu Performance Trend, **bisa lintas tahun** (mis. November 2025 s/d Februari 2026) via `startYear`/`startMonth`/`endYear`/`endMonth` — tidak lagi dibekukan ke satu tahun atau ke 2026. `mode=YTD` (default) → tiap titik adalah rata-rata kumulatif Januari **tahunnya sendiri** s/d bulan tersebut (reset tiap 1 Januari, konvensi YTD standar — rentang lintas tahun menampilkan kurva YTD tiap tahun berurutan, bukan satu akumulasi menerus); `mode=MTD` → tiap titik berdiri sendiri (trivial lintas tahun). **Hanya bulan yang benar-benar lengkap yang dikembalikan** — bulan berjalan dan seterusnya **tidak muncul sama sekali** di array `trends`. `endYear`/`endMonth` selalu di-clamp ke bulan lengkap terakhir di tahun manapun yang diminta, sekalipun user meminta rentang jauh ke masa depan. Response menyertakan `year`, `last_complete_month`, dan `available_years` (daftar tahun yang benar-benar punya data di database, dari `storage.getAvailableSurveyYears()`) agar frontend tahu batas rentang & opsi tahun yang valid. Setiap titik trend menyertakan field `year` dan dihitung via `calculatePEIndex()` (metode normalisasi + bobot per-metrik yang **identik** dengan scorecard utama `/api/metrics/calculate`) | `mode` (`YTD`\|`MTD`), `year`, `startYear`, `startMonth`, `endYear`, `endMonth`, `directorate`, `sub_directorate` |
| `GET` | `/api/metrics/:metric_id/detail`| Mengambil rincian drilldown metrik (question breakdown, responses table / HR operational logs). Untuk metrik OUTCOME, field `operational_records` (breakdown SLA/channel/recognition per unit) sejak v2.16.0 dibaca dari database (`storage.getOperationalRecords(metric_id)`, sumber: `seedData.js`'s `initialOperationalRecords`), bukan lagi array statis inline di `calculationEngine.js` — metrik tanpa tabel breakdown seeded mengembalikan `[]`. `total_respondents` selalu berupa hitungan respons asli dari database (bisa `0`), tidak lagi memakai placeholder fiktif untuk metrik ESS tanpa data | `period=YTD` atau `mode=YTD\|MTD&year=2026&month=01` |
| `GET` | `/api/metrics/by-directorate` | (v2.48.0) PX Index per direktorat untuk periode terpilih. Admin: semua direktorat master (12); User: hanya direktorat cakupannya (`?directorate` diabaikan). Tiap baris = `calculate?directorate=<nama>` untuk user itu; urut PX tertinggi, tanpa data terakhir. Rincian: "Catatan v2.48.0" | `mode=YTD\|MTD`, `year`, `month` |
| `GET` | `/api/directorates` | Mengambil daftar 7 Direktorat CIMB Niaga beserta Sub-Direktorat / Divisi terkait | `-` |

---

### 2.3 Modul Manajemen Survei (Template, Upload & Evidence)
| Method | Endpoint | Deskripsi | Parameter / Payload |
| :---: | :--- | :--- | :--- |
| `GET` | `/api/surveys/template` | Mengunduh berkas template CSV survei spesifik (karyawan / non-karyawan) atau master all-surveys. Metrik ESS (v2.32.0): `Template_ESS_Metric_<id>.xlsx`; master `ALL` hanya metrik SYSTEM | `metric_id=2` (Campus), `metric_id=5` (Candidate), atau `metric_id=ALL` |
| `POST` | `/api/surveys/upload` | Mengunggah dan memproses berkas CSV respon survei; metrik ESS hanya ringkasan `.xlsx` (v2.32.0) | Body: `{ csvText, fileName, metric_id }` atau multipart field `file` / `csvFile` + `metric_id` |
| `GET` | `/api/surveys/evidence` | Mengunduh berkas CSV audit trail data respon koresponden; metrik ESS = baris ringkasan tersimpan (v2.32.0) | `metric_id=2`, `metric_id=5`, `metric_id=ALL`, `period=YTD` |
| `GET` | `/api/surveys/ess-file/:upload_id` | Mengunduh file ringkasan ESS asli satu upload (v2.32.0; Admin atau PIC metrik itu) | Path: `upload_id` |

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

> Sejak v2.49.0 semua endpoint di tabel ini butuh login dengan menu `events` (Admin selalu boleh), kecuali `POST /api/events/:event_id/attendance`, `POST /api/events/:event_id/feedback` dan `GET /api/events/by-code/:code` yang tetap publik. Lihat "Catatan v2.49.0".

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
| `POST` | `/api/events/:event_id/media` | Upload foto/video dokumentasi (`multipart/form-data`, field `mediaFile`). MIME **dan** ekstensi terakhir nama file harus sama-sama lolos allowlist dan sekelompok (gambar `jpg jpeg png gif webp bmp avif`; video `mp4 m4v mov webm mkv avi ogv mpg mpeg 3gp wmv flv`), selain itu **415** tanpa menyimpan apa pun (SVG dan HEIC/HEIF ditolak; sejak v2.30.1, lihat "Catatan v2.30.1"), batas ukuran = setting `media_upload_max_mb` (default 1024 MB sejak v2.59.0; env `MEDIA_MAX_MB` hanya fallback), lebih dari itu **413** `{ error, max_mb }` (lihat "Catatan v2.59.0"). Tipe ditentukan dari MIME file. Video dijawab langsung dengan `transcript_status: "PROCESSING"` lalu ditranskrip di background | Path: `event_id`; Form: `mediaFile`, `caption` |
| `POST` | `/api/media/:media_id/transcribe` | (Ulang) memulai transkrip AI untuk video — dipakai tombol "Coba lagi". **202** diterima, **400** bila bukan video, **404** bila media tak ada, **409** bila sedang diproses | Path: `media_id` |
| `POST` | `/api/media/:media_id/summarize` | (Ulang) membuat **AI Summary** transkrip video (tombol "Buat / Buat ulang ringkasan"; pengelola event saja). **202** + record media berstatus `PROCESSING`; **400** bukan video; **404** media tak ada; **409** transkrip belum `DONE` atau ringkasan sedang diproses/antri; **403** non-pengelola; **401** tanpa login | Path: `media_id` |
| `DELETE` | `/api/media/:media_id` | Menghapus record media **beserta file fisiknya** di `server/uploads` (sejak v2.30.1 respons baru dikirim setelah file terhapus, dan yang dihapus adalah file yang sedang ditunjuk record - nama baru bila video sudah di-rename) | Path: `media_id` |
| `POST` | `/api/events/:event_id/generate-ppt` | Menghasilkan dan menyajikan berkas presentasi PowerPoint (.pptx) | Path: `event_id` |

> **Transkrip AI video (sejak v2.21.0)**: `server/services/transcribeService.js` memanggil API audio/video-to-text lokal (faster-whisper, default `http://127.0.0.1:8000`, `POST /transcribe` dengan body `{"source": "<path file di server>", "language": "id"}`) — **path lokal** file yang diupload dikirim, sehingga video tidak keluar dari mesin (patuh aturan 100% on-premise). Sejak v2.30.2 path itu adalah hard link bernama asli di `server/tmp-transcribe/<media_id>/` (lihat "Catatan v2.30.2"). Bahasa default `id` (`TRANSCRIBE_LANGUAGE`). Karena Whisper di CPU bisa memakan menit, hasilnya disimpan ke record media: `transcript_status` (`PROCESSING`/`DONE`/`FAILED`), `transcript` (teks lengkap), `transcript_segments` (`[{start, end, text}]`), `transcript_language`, `duration_seconds`, `transcript_error`, dan `ai_generated_description` diisi cuplikan transkrip. Job yang terputus karena restart server otomatis dilanjutkan saat boot. Konfigurasi di `.env`: `TRANSCRIBE_API_URL`, `TRANSCRIBE_LANGUAGE`, `TRANSCRIBE_TIMEOUT_MS`, `MEDIA_MAX_MB` (sejak v2.59.0 hanya fallback batas unggahan; lihat `.env.example`).

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

## 📧 Catatan v2.23.0 — Setting Email Reminder (menu di UI kini bernama **Email Settings** sejak v2.30.0)

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
| `PUT` | `/api/admin/users/:id` | ADMIN | Ubah `full_name`, `email`, `is_active`, `role`/`scopes`, `menu_access` (v2.49.0) (atau bentuk lama `directorate`/`division`). Tidak bisa menonaktifkan/menurunkan diri sendiri atau Admin aktif terakhir (400); nonaktif/ganti role mematikan sesi user itu |
| `POST` | `/api/admin/users/:id/reset-password` | ADMIN | Password sementara baru (acak, atau password awal standar bila env `DEFAULT_INITIAL_PASSWORD` terisi; respons memuat `is_default_password`; tampil sekali), membuka kunci akun, mematikan sesi; tidak untuk akun sendiri |
| `DELETE` | `/api/admin/users/:id` | ADMIN | Hapus akun (bukan diri sendiri / Admin aktif terakhir). Belum ada tombol di UI |
| `GET` | `/api/admin/audit-log` | ADMIN | `?limit=` (default 200, maks 1000), terbaru dulu |

Aturan password baru: 10-128 karakter, mengandung huruf dan angka, tidak sama dengan username, berbeda dari password lama, dan (v2.27.2) tidak sama dengan password awal standar bila env `DEFAULT_INITIAL_PASSWORD` terisi (`400`). Password awal itu sendiri (buatan sistem) dikecualikan dari aturan ini dan tidak dicatat di audit log.

### Rute → aturan akses (USER vs ADMIN)
| Rute | USER | ADMIN |
| :--- | :--- | :--- |
| `GET /api/metrics/calculate`, `/api/metrics/trends` | hanya cakupannya (v2.27.0: kosong/`ALL` → semua cakupan saya; direktorat/divisi di luar cakupan → 403). `calculate`: metrik non-karyawan = agregat bankwide read-only, `excluded_from_index` (sejak v2.48.0: nilai bankwide yang ikut dihitung, `is_bankwide_value`, sama untuk Admin) | semua |
| `GET /api/metrics/by-directorate` (v2.48.0) | hanya direktorat cakupannya; `?directorate` diabaikan | semua direktorat master |
| `GET /api/metrics/:id/detail` | idem; payload di-`redactRespondent()` + `respondent_data_hidden: true` | lengkap |
| `GET /api/surveys/evidence`, `GET /api/surveys/responses/:metric_id` | 403, kecuali PIC metrik itu (v2.27.1, lihat tabel di bawah) | ya |
| `GET /api/surveys/metrics`, `/template`, `/history`; `POST /api/surveys/upload` | 403, kecuali PIC (v2.27.1) | ya |
| `POST /api/metrics/score`, `/api/metrics/weights`, `/api/alerts/acknowledge`, `/api/action-library`, `/api/questions/master` | 403 | ya |
| `GET /api/alerts`, `/api/action-library`, `/api/questions/master`, `/api/settings`, `/api/directorates` | ya (v2.27.0: `/api/alerts` dihitung dari data dalam cakupan; sejak v2.49.0 `/api/action-library` butuh menu `action_library` dan `/api/questions/master` butuh menu `events`) | ya |
| `/api/admin/*` (parameter, journeys, metrics, targets, survey-questions, upload-reminders, email-settings, settings, users, audit-log) | 403 | ya |
| `GET /api/events`, `/api/events/:id` | ya, tanpa kode akses; absensi/feedback per orang disamarkan (**tidak berlaku sejak v2.49.0**: tanpa menu `events` 403, dengan menu data lengkap) | lengkap |
| `POST/DELETE` event, hapus absensi/feedback, media, transkrip, `generate-ppt`, `GET /api/reports/download/:file`, `/exports/*` | hanya bila direktoratnya ada di setting `event_manager_directorates` (default Human Resources); selain itu 403 (**digantikan v2.49.0**: menu `events`) | ya |
| `/uploads/*` | ya (sejak v2.49.0: menu `events`) | ya |

Setting baru (`px_app_settings`, ubah lewat `PUT /api/admin/settings/:key`; angka divalidasi rentang): `session_hours` (8; 1-72), `login_max_attempts` (5; 3-20), `login_lockout_minutes` (15; 1-1440), `login_rate_limit_per_minute` (20; 5-200), `event_manager_directorates` (daftar `{ value, label }`, default Human Resources; sejak v2.49.0 tidak memberi hak apa pun).

Respons 403 tambahan: `PASSWORD_CHANGE_REQUIRED` (akun belum ganti password sementara) dan penolakan `Origin` lintas-host pada request tulis. Service baru: `authService.js`, `rateLimiter.js`; storage: `getUser*/createUser/updateUser/deleteUser`, `createSession/getSession/deleteSession[sForUser]/purgeExpiredSessions`, `addAuditLog/getAuditLog` di `sqlStorage.js` dan `jsonStorage.js`.

## 🎯 Catatan v2.27.0 — Cakupan Data User (scopes)

**Bentuk `scopes`** (di `GET|POST /api/admin/users`, `PUT /api/admin/users/:id`, `GET /api/auth/me`): `[{ "directorate": "<nama>", "divisions": null | ["<divisi>", ...] }]`. `null` (atau `[]` pada input) = semua divisi direktorat itu. Respons selalu dinormalisasi: satu entri per direktorat, divisi digabung, "semua" menyerap subset. Objek user tetap memuat `directorate`/`division` tunggal untuk klien lama (terisi hanya bila cakupan tepat satu direktorat; `division` hanya bila tepat satu divisi).

**Validasi (400)**: User tanpa `scopes`/kosong, `scopes` bukan array, entri tanpa direktorat, direktorat atau divisi tak ada di direktori, divisi bukan milik direktoratnya, `divisions` bukan array string, Admin dengan cakupan tidak kosong, bentuk lama tanpa `division`. Menurunkan Admin → User tanpa `scopes` ditolak; mengubah ke Admin mengosongkan cakupan. Permintaan ditolak tidak mengubah apa pun. `PUT` ke id tak ada → 404. Perubahan cakupan dicatat sebagai `USER_SCOPE_CHANGE` di `px_audit_log` (kolom `target` dipotong ±190 karakter).

**Aturan rute yang berubah untuk USER** (Admin tidak dibatasi):

| Rute | Perilaku v2.27.0 |
| :--- | :--- |
| `GET /api/metrics/calculate`, `/trends`, `/:id/detail` | `?directorate&sub_directorate` diselesaikan oleh `resolveScope()`; kosong/`ALL` = gabungan seluruh cakupan (di-pool, sampel = jumlah sampel); satu direktorat dari cakupan = angka sama dengan tampilan Admin untuk direktorat itu; di luar cakupan → 403. `calculate` menambah `filter_options.scopes` dan `is_directorate_filtered` |
| `GET /api/alerts` | Menerima `?directorate&sub_directorate`; skor dan komentar verbatim dihitung dari responden dalam cakupan saja; di luar cakupan → 403. Tiap alert punya `is_bankwide_readonly` (true untuk metrik non-karyawan/OUTCOME: nilai bankwide read-only) |
| `GET /api/events`, `/api/events/:id` | Non-pengelola hanya melihat absensi dan feedback peserta dalam cakupan; `total_attendees` di daftar mengikuti. Admin melihat semua (**tidak berlaku sejak v2.49.0**: tanpa menu `events` 403) |
| Rute tulis event, media, transkrip, PPT | Pengelola event = Admin, atau User yang cakupannya memuat direktorat di setting `event_manager_directorates` (`permissions.can_manage_events`) (**digantikan v2.49.0**: menu `events`) |

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

Sejak v2.60.0 ditambah `summary_topics` dan `summary_topic_stats` untuk ringkasan per topik video panjang (lihat "Catatan v2.60.0").

**Service**

- `mediaSummaryService.js`: `queueMediaSummary(media_id)` (hanya video dengan `transcript_status = DONE`; mengembalikan `queued`/`insufficient`/`duplicate`/`skipped`), `resumeInterruptedSummaries()` (dipanggil `server.js` saat boot; hanya yang `PROCESSING`), `summarizeWithAi`, `validateAnswer`, `numberMentions`, `novelWords`, `tooManyNovelWords`, `NOVEL_LIMITS` (sejak v2.30.3), `splitTranscript`, `parseModelAnswer`, `ruleBasedSummary`.
- Konstanta: `MIN_WORDS = 20`, `CHUNK_CHARS = 5000`, `MAX_CHUNKS = 12`, poin 2-5. Format keluaran model: teks `RINGKASAN:` + `POIN:` (bukan JSON).
- Validator menolak: angka atau kata bilangan/kata satuan frekuensi yang tidak ada di transkrip, nama/akronim berkapital yang tidak ada di transkrip, bahasa salah (id/en), frasa meta, tag HTML/markup (sejak v2.30.3), dan kata isi baru yang tidak ada di transkrip setelah pencocokan stem (sejak v2.30.3: >= 5 kata dan > 30% kata isi, atau >= 12 kata; transkrip > 5000 karakter: > 35% atau >= 18; sebelumnya >= 3 kata dan > 20%; hanya untuk bahasa id/en; lihat "Catatan v2.30.3"). Ditolak -> satu retry dengan alasan; gagal lagi, Ollama mati/timeout/model belum terpasang, atau transkrip > 12 bagian -> `RULE` dengan `summary_error`. Antrian penuh -> `RULE` langsung.
- `aiQueue.js`: satu job berjalan pada satu waktu; `enqueue(key, run)` -> `queued`/`duplicate`/`full`; batas antrian `AI_QUEUE_MAX` (default 50).
- `localAiService.js`: `queryLocalOllama(prompt, { scope, subject, ... })` memanggil `POST {OLLAMA_HOST}/api/generate` memakai modul `http` inti (bukan `fetch`, agar tidak terkena batas header 5 menit); timeout `OLLAMA_TIMEOUT_MS` (default 7.200.000 ms = 120 menit sejak v2.30.0; dulu 300000). `generateAlertNarrative` dan `generateEventSummary` kini rule-based.
- `transcribeService.js`: memicu `queueMediaSummary` setelah transkrip `DONE` (kegagalan memulai ringkasan tidak mengubah transkrip yang sudah selesai); memulai transkrip ulang mengosongkan semua field `summary_*`.
- `pptGenerator.js`: slide media (3 slot) memprioritaskan video ber-ringkasan `DONE`; teks "Ringkasan AI/otomatis: ..." dipotong di batas kata (300 karakter), dibaca dari database.
- `server.js`: `PX_DISABLE_SCHEDULERS=1` melewati `startReminderScheduler()` (hanya untuk backend kedua milik suite).

**Env (opsional)**: `OLLAMA_HOST` (default `http://localhost:11434`), `OLLAMA_MODEL` (default `gemma3:4b`), `OLLAMA_TIMEOUT_MS`, `SUMMARY_JOB_TIMEOUT_MS` (sejak v2.30.0), `AI_QUEUE_MAX`.

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

---

## Catatan v2.30.0 - Pesan Backend Inggris & Batas Waktu 120 Menit

Perubahan kontrak API terbatas pada **teks**, bukan struktur: nama field, kode status, enum, dan nilai internal (`MONTHLY`, `ONE_TIME_ANNUAL`, `PROCESSING`, dst.) tidak berubah. Klien yang mencocokkan string pesan lama (Indonesia) harus disesuaikan.

| Area | Perubahan |
| :--- | :--- |
| Pesan `error` / `message` | Seluruh respons error dan pesan validasi (login/password, 401/403/404, validasi form, upload) berbahasa Inggris. Sekitar 215 pesan menurut developer (tidak dihitung ulang). Contoh: `Username/NIP must be 3-50 characters ...` (`authService.js`), `Password is too long.` (`emailSettingsService.js`). |
| `month_name` (`/api/metrics/trends`, `monthly_trends` pada `/api/metrics/calculate`) | Nama bulan Inggris: `January` ... `December` (`calculationEngine.js`); `month_code` (`YYYY-MM`) tidak berubah. Sumbu grafik memakai singkatan yang diturunkan di klien dari `month_code` (`src/utils/months.js`). |
| `expected_period_label` (`/api/admin/upload-reminders`) | Periode yang kosong memakai nama bulan Inggris, mis. `September 2026`; reminder tahunan: `year 2026` (dulu `tahun 2026`). Isi e-mail pengingat ke PIC **tetap berbahasa Indonesia** (hanya nama bulan di dalamnya yang Inggris). |
| Narasi alert & event summary | Rule-based, kini kalimat Inggris (`alertEngine.js`, `localAiService.js`). |
| Alasan baris CSV ditolak (`surveyImportService.js`) | Inggris. Header CSV evidence dan template **tetap Indonesia**. |
| Ringkasan video (`mediaSummaryService.js`) | Ringkasan `RULE` dan `INSUFFICIENT` serta `summary_error` berbahasa Inggris (mis. `The transcript is not long enough to summarize (fewer than 20 words).`, `The AI queue is full; press "Regenerate summary" later.`). Alasan penolakan validator (Indonesia, juga dipakai sebagai umpan balik ke Gemma pada percobaan kedua) **hanya ditulis ke console server**; `summary_error` berisi kalimat umum: `The AI summary was rejected by the validator; the automatic (rule-based) summary is shown.` Prompt dan validator Gemma tetap Indonesia. |
| Slide PPT (`pptGenerator.js`) | Teks slide Inggris; label media `[ Documentation #N ]`; slide 5 memangkas awalan `Documentation ` / `Dokumentasi ` pada caption media lama. |
| Caption media baru (`POST /api/events/:id/media`) | Default caption `Documentation <nama event>` (dulu `Dokumentasi ...`). |
| Label opsi `GET /api/settings` | `metric_types`, `scale_types`, `target_audiences`, `update_frequencies` berlabel Inggris. Top-up saat boot (SQL: `topUpOptionLabels()`; JSON: blok di `jsonStorage.js`) hanya mengganti label yang masih **persis** default Indonesia lama (`seedData.LEGACY_OPTION_LABELS` + `upgradeLegacyOptionLabels()`); `value` dan hasil edit admin tidak ditimpa. |

**Batas waktu (env opsional, default 7.200.000 ms = 120 menit)**

| Env | Dulu | Sekarang | Dipakai oleh |
| :--- | :--- | :--- | :--- |
| `TRANSCRIBE_TIMEOUT_MS` | 1.800.000 | 7.200.000 | `transcribeService.js` - batas idle socket HTTP satu permintaan transkrip (diekspor `DEFAULT_TIMEOUT_MS`, `TIMEOUT_MS`) |
| `OLLAMA_TIMEOUT_MS` | 300.000 | 7.200.000 | `localAiService.queryLocalOllama()` - satu panggilan Gemma (diekspor `DEFAULT_AI_TIMEOUT_MS`, `OLLAMA_TIMEOUT_MS`) |
| `SUMMARY_JOB_TIMEOUT_MS` | (baru) | 7.200.000 | `mediaSummaryService.js` - deadline bersama **seluruh** satu job ringkasan (semua chunk + retry); tiap panggilan Gemma dibatasi `min(OLLAMA_TIMEOUT_MS, sisa anggaran)`; habis -> error `The AI summary exceeded the 120 minutes limit` -> fallback `RULE` |
| `REQUEST_TIMEOUT_MS` | (baru) | 7.200.000 | `server.js`: `httpServer.requestTimeout`. Default bawaan Node (5 menit untuk menerima SATU request utuh) memotong upload video besar di koneksi lambat. `headersTimeout`/`keepAliveTimeout` tidak diubah |

`.env` user tidak meng-override keempatnya, jadi default 120 menit berlaku. `.env.example` memuat contoh dan komentarnya.

**Tidak berubah**: kolom CSV, isi e-mail pengingat, nama metrik/journey/direktorat/program, data Action Library, dan seluruh logika skor/status.

---

## Catatan v2.30.1 - Nama File Video Sesuai Unggahan & Allowlist Unggahan Media

**Filter unggahan (`POST /api/events/:event_id/media`, `server.js` `mediaUpload.fileFilter`)**: MIME dari klien **dan** ekstensi terakhir nama file harus sama-sama lolos allowlist dan sekelompok (gambar atau video). Selain itu **415** dan tidak ada file/record yang tersimpan.

| Kelompok | Ekstensi yang diterima | Catatan |
| :--- | :--- | :--- |
| Gambar (MIME `image/*` kecuali SVG) | `jpg jpeg png gif webp bmp avif` | SVG ditolak (bisa membawa script); HEIC/HEIF ditolak (browser tidak menampilkannya) |
| Video (MIME `video/*`) | `VIDEO_EXTENSIONS` di `mediaFileService.js`: `mp4 m4v mov webm mkv avi ogv mpg mpeg 3gp wmv flv` | Hanya ekstensi **terakhir** yang dihitung: `a.html.mp4` diterima dan berakhir `.mp4`; `evil.html`/`clip.exe` yang dikirim sebagai `video/mp4` ditolak |

Nama file sementara di disk (`media-<timestamp>-<rand>.<ext>`) hanya membawa ekstensi yang aman (`safeExtension`); nama asli (dengan perbaikan mojibake latin1->UTF-8 bila hasilnya pasti valid) disimpan di `px_media.file_name`.

**Header `/uploads/*`** (login tetap wajib, tanpa sesi 401): semua file mendapat `X-Content-Type-Options: nosniff` dan `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; media-src 'self'; img-src 'self'; sandbox`; file yang ekstensinya di luar allowlist (data lama) juga mendapat `Content-Disposition: attachment` sehingga hanya bisa diunduh. Video/gambar allowlist tidak diberi `attachment`, jadi pemutaran dan range request (206) normal.

**Rename file video (`server/services/mediaFileService.js`)**

| Aspek | Perilaku |
| :--- | :--- |
| Kapan | `finalizeMediaFileName(media_id)` dipanggil di ujung job transkripsi (`transcribeService.js`) dan job ringkasan (`mediaSummaryService.js`, juga cabang `INSUFFICIENT` dan antrean penuh). Rename hanya jika `file_type = VIDEO` dan keadaan final: `transcript_status = FAILED`, atau `transcript_status = DONE` dengan `summary_status` `DONE` (AI atau RULE) / `FAILED` / `INSUFFICIENT` |
| Tidak pernah | Saat transkrip/ringkasan `PROCESSING` atau antri: dicek di database **dan** di memori (`isTranscribeInFlight`, `isSummaryInFlight`; `queueMediaTranscription` menandai `inFlight` sebelum `await` pertama). Tidak pernah dari `GET` event/dashboard atau saat boot biasa |
| Video lama | Tidak di-rename otomatis. Baru berganti nama setelah job eksplisit selesai (Regenerate summary, Try again) atau boot-resume job `PROCESSING` yang selesai |
| Hasil | File di `server/uploads` bernama sesuai `px_media.file_name`; `px_media.file_path` = `/uploads/` + `encodeURIComponent(nama)` (path maks 480 karakter dihitung, kolom 500) |
| Aturan nama | `sanitizeVideoFileName`: hanya basename (tanpa direktori/`..`); buang `<>:"\|?*`, karakter kontrol dan bidi; pangkas titik/spasi di ujung dan awal; stem maks 150 karakter; nama reservasi Windows (`CON`, `NUL`, `COM1` ...) diawali `_`. Nama akhir selalu berekstensi video dikenal: bila ekstensi nama asli bukan video, ekstensi nama sementara ditambahkan (`clip.exe` -> `clip.exe.mp4`); tanpa ekstensi video sama sekali atau stem kosong, nama acak dipertahankan |
| Tabrakan | Tidak pernah menimpa: ` (1)`, ` (2)` ... sampai 999; case-insensitive (Windows), juga terhadap nama yang dipakai record lain walau filenya tidak ada |
| Kegagalan | `EBUSY`/`EPERM`/`EACCES` dicoba ulang sekali setelah 500 ms; selanjutnya hanya `console.warn`, record tidak berubah, job tidak gagal. Rename dilakukan **sebelum** update database; bila update gagal, nama dikembalikan; bila record terhapus saat itu, file hasil rename dihapus |
| Konkurensi | Rename, update record, dan delete memakai satu antrean `runExclusive` |

Perubahan terkait: `updateMedia` (`sqlStorage.js`, `jsonStorage.js`) kini menerima `file_path` di whitelist-nya; `resolveUploadPath` (dipindah ke `mediaFileService.js`, tetap diekspor `transcribeService.js`) men-decode URL dan menolak apa pun di luar `server/uploads`; **`DELETE /api/media/:media_id` kini menunggu** penghapusan file (`deleteMediaAndFile`) dan selalu menghapus file yang sedang ditunjuk record (nama baru bila sudah di-rename).

**Env baru (opsional)**: `PX_DISABLE_RESUME=1` mematikan `resumeInterruptedTranscriptions`/`resumeInterruptedSummaries` saat boot. Hanya untuk backend kedua yang berbagi database dengan backend yang sedang memproses video (dipakai suite tes); jangan di-set pada backend utama.

**Tidak berubah / belum**: monitoring dan entri di Video Extractor (`:8000`) tidak ikut berganti nama oleh rename final ini; nama asli di monitoring ditangani terpisah sejak v2.30.2 (lihat bawah) tanpa field `display_name`. Skema database tidak berubah.

---

## Catatan v2.30.2 - Nama File Asli untuk Video Extractor (Hard Link)

**Masalah**: monitoring Video Extractor menampilkan basename `source` yang dikirim, yaitu nama acak `media-<ts>-<rand>.mp4`. API Extractor ('Video/Audio to Text v1.1': `POST /transcribe {source, language}`, `/transcribe/upload`, `/batch`, `/jobs`, `/summarize`) tidak punya field nama tampilan; kontraknya tidak diubah.

**Alur di `transcribeService.queueMediaTranscription`** (hanya `transcribeService.js` dan satu pemanggilan di `server.js` yang berubah)

| Langkah | Perilaku |
| :--- | :--- |
| 1. Link | `createNamedLink`: membuat `<TMP_DIR>/<media_id>/<stem><ext>` lewat `fs.promises.link` (hard link ke file di `server/uploads`, tanpa salinan). `TMP_DIR` = `server/tmp-transcribe` (di luar `server/uploads`, tanpa route, `.gitignore`). Nama = `sanitizeVideoFileName(media.file_name, ...)` (aturan sama dengan rename v2.30.1); stem dipendekkan agar seluruh path <= 250 karakter (`MAX_LINK_PATH_CHARS`). Nama folder dari `media_id` disanitasi (`[^A-Za-z0-9._-]` -> `_`) dan harus tetap di bawah `TMP_DIR`. Folder sisa percobaan sebelumnya untuk media yang sama dihapus dulu |
| 2. Kirim | `source` = path link. Bila link gagal (`EXDEV`/`EPERM`/`ENOENT`/lainnya) atau nama ditolak sanitizer: kirim path acak lama dan `console.warn` |
| 3. Retry | Satu kali dengan path acak, HANYA bila ada link, kegagalan terjadi < 15 dtk (`FAST_FAILURE_MS`), dan `looksLikeUnreadableFile(err)`: `statusCode` 404/422/500, atau pesan cocok "not found / no such file / cannot|could not open|read|find / does not exist / unreadable / invalid data|file|source|path / errno 2" |
| Tanpa retry | Timeout (`isTimeout`), Extractor mati (`isUnreachable`: connection refused), connection reset, error lain, dan kegagalan setelah 15 dtk. Error pada percobaan kedua dilempar apa adanya |
| 4. Bersih | `finally`: `removeTmpEntry(folder)` segera setelah panggilan (sebelum hasil disimpan dan sebelum `finalizeMediaFileName`). Hanya menghapus nama link; file asli aman. Gagal menghapus (mis. file terpakai) hanya `console.warn` dan tidak menggagalkan job |
| Boot | `cleanupTranscribeTempDirs()` dipanggil di `server.js` sebelum `resumeInterruptedTranscriptions`/`resumeInterruptedSummaries` (juga bila `PX_DISABLE_RESUME=1`): hapus semua entri `TMP_DIR` (folder maupun file lepas) kecuali folder media berstatus `PROCESSING` atau yang sedang `inFlight`; job yang di-resume membuat link baru |
| Hapus media | `DELETE /api/media/:id` saat `PROCESSING`: folder dibersihkan oleh `finally` saat job berakhir |

**Ekspor baru** `transcribeService`: `cleanupTranscribeTempDirs`, `TMP_DIR`. `postJson` memberi error properti `statusCode`, `isTimeout`, `isUnreachable`. Tidak ada endpoint, tabel, kolom, atau env baru; `/api/health` `version` = `2.30.2`.

**Batasan**: hard link mensyaratkan `server/uploads` dan `server/tmp-transcribe` berada di **volume NTFS yang sama** (bila tidak: path acak); entri Extractor yang sudah ada tidak berubah; perilaku Extractor asli terhadap path berisi `[ ] ( ) é` belum diuji; kasus "file in use" saat menghapus link tidak disimulasikan; tampilan monitoring Extractor asli belum diverifikasi (menunggu uji user).


---

## Catatan v2.30.3 - Validator AI Summary: Stem & Ambang Baru

**Masalah**: ringkasan Gemma pada video "Tentang WAKTU" (transkrip 411 karakter) ditolak validator dan jatuh ke `RULE`. Percobaan 1 memang mengarang isi (15 dari 46 kata isi tidak ada di transkrip); percobaan 2 hanya 3 dari 42 kata baru. Kata berimbuhan dan kata netral yang belum terdaftar juga dihitung "baru" oleh aturan lama (>= 3 kata dan > 20%). Detail: `CHANGELOG.md` [2.30.3].

**Pemeriksaan kata baru di `validateAnswer` (`mediaSummaryService.js`)**

| Aspek | Perilaku sejak v2.30.3 |
| :--- | :--- |
| Pencocokan | Berbasis **stem** (`stemsOf`, `buildSourceIndex`, `isInSource`). Indonesia: awalan me-/mem-/men-/meng-/meny-/memper-/ber-/ter-/per-/pe-/di-/ke-/se- (sampai 2 lapis, varian nasal dan r-drop), akhiran -kan/-an/-i, klitik -nya/-ku/-mu/-lah/-kah/-pun. Inggris: -s/-es/-ed/-ing/-ly/-er/-ion/-ment (konsonan ganda, e-bisu). |
| Panjang stem | Minimal `STEM_MIN = 4` huruf, jadi stem 3 huruf (`ada`, `ini`) tidak pernah menciptakan kecocokan. Stem 5+ huruf yang merupakan awalan stem lain (selisih maks. 4 huruf) juga cocok (`sosial` ~ `sosialisasi`). |
| Kata netral | `NEUTRAL` (id/en) dicocokkan **kata persis**; hanya `NEUTRAL_ROOTS` (id: jelas, cerita, sampaikan, bahas, ungkap; en: explain, discuss, mention, describe, share, highlight, emphasize) yang dicocokkan lewat stem. |
| Ambang tolak | `NOVEL_LIMITS = { min: 5, ratio: 0.30, max: 12, longRatio: 0.35, longMax: 18 }`. `tooManyNovelWords(novelCount, total, transcript)` menolak bila kata baru >= 12, atau >= 5 **dan** > 30% kata isi. Transkrip > `CHUNK_CHARS` (5000 karakter): >= 18, atau >= 5 dan > 35%. Lama: >= 3 dan > 20%. |
| Tag HTML | Jawaban yang memuat tag/markup ditolak: `memuat tag HTML/markup`. |
| Tidak berubah | Angka dan kata bilangan (bentuk berimbuhan seperti "keenam" tidak diselamatkan oleh "enam"), nama/akronim berkapital, bahasa salah, frasa meta, ringkasan < 40 karakter, format `RINGKASAN:`/`POIN:`. |

**Retry**: pesan penolakan menyebut sampai 12 kata (`novel.slice(0, 12)`, dulu 8). Kedua prompt (id/en) ditambah instruksi retry: pakai hanya kata yang benar-benar ada di transkrip (salin frasa bila ragu) dan tulis lebih pendek (2-3 kalimat, 3 poin pendek). Jumlah panggilan Gemma tidak berubah: 1 per bagian + 1 gabungan untuk transkrip panjang; retry maksimal 1.

**Transkrip panjang (tidak berubah)**: `validateAnswer` untuk jawaban gabungan selalu membandingkan dengan transkrip **penuh**; ringkasan parsial per bagian tidak divalidasi sendiri.

**Ekspor modul**: ditambah `summarizeWithAi`, `tooManyNovelWords`, `NOVEL_LIMITS`. Tidak ada endpoint, setting, tabel, atau env baru; `/api/health` `version` = `2.30.3`.

**Batasan**: distorsi makna halus (penafian, nuansa) tetap bisa lolos; sinonim non-imbuhan (perlahan vs pelan) tidak dicocokkan; Gemma 4B masih bisa mengarang pada teks sangat pendek (hasil: `RULE`). Pengujian: `docs/07` §26 (Modul 43).

---

## Catatan v2.32.0 - Ringkasan ESS (.xlsx) Menggantikan Data ESS per Responden

**Ringkasan**: metrik SURVEY dengan `survey_source = 'ESS'` (cek `isEssMetric`, `server/db/surveySource.js`) tidak lagi memakai baris per responden. Datanya adalah ringkasan hasil ESS yang diunggah sebagai `.xlsx` (satu baris per unit org per periode), disimpan di `px_ess_results` / `essResults`. Format file dan validasi: `docs/SURVEY_IMPORT_GUIDE.md`; kamus kolom: `docs/02` §5.3; tabel: `docs/08` §17. Detail: `CHANGELOG.md` [2.32.0].

**Endpoint**

| Endpoint | Perilaku untuk metrik ESS | Akses |
| :--- | :--- | :--- |
| `POST /api/surveys/upload` | Field file `file` atau `csvFile` (multer `upload.fields`; file di field lain langsung dihapus). Hanya `.xlsx`: tanpa file (mis. `csvText`) -> **400**; `.csv`/`.xls`/ekstensi lain -> **415**; workbook tidak valid atau satu baris salah -> **400** `{ error, errors: [{ row_number, column, reason }] }`, tidak ada yang disimpan. Sukses -> 200 `{ is_ess_summary: true, upload_id, period, period_label, index_label, question_labels, rows_imported, has_bankwide_row, bankwide_index, replaced_previous, replaced_rows, ... }` tanpa field `calculation`. `.xlsx` ke metrik SYSTEM atau tanpa metrik -> **400**. File (jenis apa pun) ke `metric_id` numerik yang tidak ada -> **404** (jalur `csvText` tetap menolak per baris). Audit `SURVEY_UPLOAD` dengan target `ESS summary metric <id>; period <YYYY-MM>; <n> rows[ (replaced)]; batch <upload_id>`; `uploaded_by` = `Nama (username)`. | Admin, PIC metrik (aturan v2.27.1/v2.29.0) |
| `GET /api/surveys/template?metric_id=<ESS>` | `Template_ESS_Metric_<id>.xlsx`: header `Directorate, Level, Year, Month, Participation, <nama metrik tanpa " (ESS)">, <teks pertanyaan aktif non-FREE_TEXT>`, baris `PT Bank CIMB Niaga Tbk / Bankwide`, satu baris per direktorat master, nilai kosong. Template master `ALL` (CSV) tidak lagi memuat metrik ESS. | sama dengan template CSV |
| `GET /api/surveys/evidence?metric_id=<ESS>` | `Evidence_ESS_Summary_Metric_<id>.csv` (`generateEssEvidenceCsv`): semua periode, `period` diabaikan, kolom upload (file, pengunggah, waktu), formula-escape seperti evidence CSV. PIC: hanya baris direktorat dalam `respondentScopeFor`, tanpa Bankwide. | Admin, PIC |
| `GET /api/surveys/ess-file/:upload_id` (baru) | Mengirim file asli `server/data/ess-uploads/<upload_id>.xlsx` dengan nama file upload. Upload tidak dikenal atau tanpa `metric_id` -> 404; upload seed / file tidak ada di disk -> 404; id dibatasi `[A-Za-z0-9._-]{1,64}`. | Admin, PIC metrik upload itu; lainnya 403 |
| `DELETE /api/admin/metrics/:id` | Kaskade juga menghapus `px_ess_results` metrik itu; route menghapus file asli setiap upload metrik itu. | Admin |

`processSurveyCsv` (CSV) menolak per baris setiap baris yang `metric_id`-nya metrik ESS ("upload its ESS summary Excel file (.xlsx) instead of CSV rows"); baris lain dalam CSV yang sama tetap diproses.

**Perbaikan**: file sementara multer kini dibaca sekali lalu dihapus **sinkron** sebelum respons apa pun (sebelumnya di `finally`, bisa masih ada saat respons diterima - flake Modul 36).

**`essSummaryService.js` (baru)**

| Fungsi | Fungsi |
| :--- | :--- |
| `readFirstSheet(buffer)` | Membaca sheet pertama `.xlsx` lewat `jszip` (shared strings, inline string, angka, boolean, error); formula tidak dievaluasi, dipakai nilai cache; formula tanpa nilai ditandai. |
| `validateEssSheet(rows, directorates)` | Validasi layout + master direktorat; mengembalikan `{ errors, rows, period, index_label, question_labels }`. |
| `parseScore(cell)` | 0-1 -> x100; > 1 s.d. 100 -> persen; teks berakhiran `%` -> persen; lainnya error. |
| `importEssSummary(buffer, fileName, metric, { uploadedBy })` | Validasi -> simpan file asli -> `storage.saveEssResultUpload` (file dihapus lagi bila simpan gagal). `calculated_avg_score` = index Bankwide (atau gabungan baris direktorat). |
| `selectEssResult(results, metricId, period, org)` | Aturan periode dan level org (di bawah). |
| `essOrgFor({ directorate, scopes, bankwide })` | Filter engine -> `{ directorates: null | [nama] }`. |
| `poolRows(rows)` | Rata-rata berbobot partisipasi (rata-rata biasa bila total partisipasi 0); skor pertanyaan digabung per label. |
| `generateEssTemplateXlsx`, `buildXlsx`, `generateEssEvidenceCsv`, `essOriginalFilePath` | Template, penulis `.xlsx` minimal, evidence, path file asli. |

**Aturan skor di `calculationEngine.js`**

| Aspek | Aturan |
| :--- | :--- |
| Periode (*carry-forward*, **diganti v2.36.0**: periode ketat, lihat "Catatan v2.36.0"; **berlaku lagi sejak v2.50.0** dengan batas YTD = bulan akhir YTD yang dibatasi jam server, lihat "Catatan v2.50.0") | Batas akhir: YTD tahun Y = Y-12 (atau `endMonth` bila ada, mis. titik tren YTD); MTD Y-M = Y-M. Dipakai hasil dengan (tahun, bulan) terbesar yang <= batas itu, dari tahun mana pun. |
| Level org | Tanpa filter direktorat: baris `BANKWIDE` (bila tidak ada: gabungan baris direktorat). Filter direktorat: baris direktorat itu. Filter divisi tanpa direktorat: baris direktorat induk divisi (`essDirectorateFor`; divisi tak dikenal -> tanpa data). Akun USER dengan `scopes`: gabungan berbobot partisipasi baris direktorat dalam cakupan (tiap direktorat sekali), tidak pernah baris Bankwide. |
| Nilai metrik | `raw_value` = `index`, `sample_size` = `participation`, `last_survey_date` = `YYYY-MM`; tambahan `ess_period`, `ess_period_label`, `ess_level`. Normalisasi/status seperti metrik `PERCENTAGE` lain. |
| Tanpa hasil (**diganti v2.36.0**: `NO_DATA`, skor `null`) | `raw_value` statis metrik, `sample_size` 0, `last_survey_date` = `last_survey_date` metrik atau hari ini. |
| Tren | `response_count` per titik ikut menjumlah partisipasi ESS (lewat `sample_size`). Carry-forward ke bulan/tahun berikutnya berlaku sampai v2.35.0; sejak v2.36.0 hanya dalam tahun hasil itu. |
| Detail (`getMetricDetail` -> `buildEssDetail`) | `is_ess_summary: true`, `ess_summary` (`summary_score` = index, `percent_neutral`/`percent_unfavorable` = `null`, `participation`, `period_label`), `questions_breakdown` bertipe `ESS_PERCENT` (`percent_favorable` = skor file), `ess_results_by_directorate` (Admin/tanpa scope: semua baris, Bankwide dulu; USER: hanya direktorat dalam cakupan; `is_selected`), `ess_upload`, `ess_division_filtered`, `total_respondents` = partisipasi, `responses: []`. Pertanyaan file dicocokkan ke pertanyaan terkonfigurasi lewat teks yang dinormalisasi (huruf kecil, non-alfanumerik jadi spasi); tidak cocok -> `key` `ess_q<N>`, label "Question N" (**diganti v2.50.0**: pertanyaan = Manage Questions, skor dipetakan menurut posisi, tipe `PERCENTAGE`; lihat "Catatan v2.50.0"). Bila metrik ESS tidak punya hasil, detail jatuh ke jalur survei lama (placeholder `ess_summary`). |

**Storage (kedua backend, kontrak sama)**: `getEssResults(metric_id|null, { year, month })`, `getLatestEssPeriod(metric_id, endYear, endMonth)`, `saveEssResultUpload(meta, rows)` (insert ke `px_survey_uploads` + hapus baris metrik/periode yang sama + insert baris baru, satu transaksi; mengembalikan `{ record, replaced_rows }`), `deleteEssResultsForMetric(metric_id)`. `getLatestEssPeriod` dan `deleteEssResultsForMetric` belum dipanggil kode lain. `hasSurveyDataInPeriod` kini juga benar bila ada hasil ESS bertanggal tanggal 1 bulannya dalam rentang (pengingat e-mail), `getAvailableSurveyYears` ikut memuat `survey_year` ESS.

**Tidak berubah**: tidak ada env aplikasi atau setting baru; `/api/health` `version` = `2.32.0`. Pengujian: `docs/07` §28 (Modul 45).

---

## Catatan v2.36.0 - Jendela Periode YTD/MTD & Status NO_DATA

**Ringkasan**: YTD tahun berjalan kini berhenti di akhir bulan berjalan (jam server); periode baca tiap metrik SURVEY ditentukan `update_frequency` (**diganti v2.37.0**: MTD selalu satu bulan, lihat "Catatan v2.37.0"); ESS tidak lagi *carry-forward* lintas tahun; metrik SURVEY tanpa data di jendelanya menjadi `NO_DATA` (skor `null`) dan keluar dari indeks, rollup dan alert. Model lengkap: `docs/01` §3.1, §3.7, §4, §5. Detail dan angka sebelum/sesudah: `CHANGELOG.md` [2.36.0]. Tidak ada endpoint, tabel, setting, atau env baru; `/api/health` `version` = `2.36.0`.

**Fungsi baru di `server/db/filterUtils.js`**

| Fungsi | Perilaku |
| :--- | :--- |
| `ytdEndMonth(year, endMonth)` | Bulan akhir jendela YTD: bulan berjalan untuk tahun berjalan, 12 untuk tahun lalu, 0 (jendela kosong) untuk tahun depan, `NaN` untuk tahun tidak valid. `endMonth` 1-12 dipertahankan tetapi dibatasi ke nilai itu. |
| `effectiveMetricPeriod(metric, { mode, year, month, endMonth })` (**dihapus v2.37.0**) | Metrik `update_frequency = 'ONE_TIME_ANNUAL'` pada MTD -> `{ mode: 'YTD', endMonth: month }`; selain itu periode tidak diubah. |
| `periodWindow({ mode, year, month, endMonth })` | `{ from, to, basis }`: MTD -> `MONTH` (tanggal 1 s.d. akhir bulan), YTD -> `YEAR_TO_MONTH` (1 Jan s.d. akhir bulan batas; tahun depan `from`/`to` `null`). `null` untuk tahun/bulan tidak valid. |

`parseFilterOptions` mode YTD kini selalu mengisi `endMonth` dengan `ytdEndMonth` (`'00'` = tahun depan). `sqlStorage.buildResponseFilter`: jendela kosong atau tahun bukan 4 digit -> `1 = 0`. `jsonStorage.applyResponseFilters`: `endMonth === '00'` -> tidak ada baris. `essSummaryService.selectEssResult` memakai jendela yang sama (MTD = tepat Y-M; YTD = hasil terbaru tahun Y dengan bulan <= batas), menggantikan aturan carry-forward di "Catatan v2.32.0".

**Field response `GET /api/metrics/calculate` (juga setiap titik `GET /api/metrics/trends` lewat `calculatePEIndex()`)**

| Field | Sejak v2.36.0 |
| :--- | :--- |
| `px_index`, `pe_index` | `null` bila `px_index_basis = 'NONE'` |
| `px_index_basis` (baru) | `'BOTH'` (0.70 Survey + 0.30 Outcome) / `'SURVEY_ONLY'` / `'OUTCOME_ONLY'` / `'NONE'` |
| `survey_index`, `outcome_index` | `null` bila tidak ada metrik aktif berdata (dulu 0) |
| `no_data_metrics_count` (baru) | Jumlah metrik aktif (tidak `is_disabled` / `excluded_from_index`) berstatus `NO_DATA` |
| `active_metrics_count`, `survey_metrics_count`, `outcome_metrics_count` | Hanya metrik aktif yang berdata |
| `disabled_metrics_count` | Metrik `is_disabled` atau `excluded_from_index` (dulu `total_metrics - active_metrics_count`, sehingga metrik `NO_DATA` tidak terhitung di sini) |
| `metrics[].status` | Tambahan nilai `'NO_DATA'` |
| `metrics[].has_data` (baru) | `false` untuk metrik SURVEY tanpa data di jendelanya; OUTCOME selalu `true` |
| `metrics[].raw_value`, `normalized_score`, `gap` | `null` bila `has_data = false` (tidak ada fallback `raw_value` statis); `sample_size` 0 |
| `metrics[].update_frequency` (baru) | `update_frequency` metrik (default `'MONTHLY'`) |
| `metrics[].period_window` (baru) | `periodWindow()` periode efektif metrik SURVEY; OUTCOME `null` |
| `journeys[].overall_score` | `null` bila tidak ada metrik berdata (dulu 0); baru `has_data`, `no_data_count` |
| `checkpoints[].score` | `null` bila tidak ada metrik berdata (dulu 0); baru `has_data` |

**Trend (`computeMonthlyTrends`)**: titik dengan `survey_index = null` mengirim `px_index` dan `pe_index` `null` (celah), bukan Outcome saja.

**Detail (`GET /api/metrics/:metric_id/detail`)**: metrik SURVEY memakai periode efektif yang sama dengan scorecard (`effectiveMetricPeriod`; sejak v2.37.0 periode terpilih apa adanya). Field baru: `update_frequency` dan `period_window` pada detail SURVEY (jalur survei dan detail ESS dengan hasil), `has_data` hanya pada jalur survei (termasuk ESS tanpa hasil). Detail OUTCOME tidak berubah dan tidak mengirim field ini. Tanpa data (metrik ESS tanpa hasil di jendela, atau survei tanpa baris): `status: 'NO_DATA'`, `has_data: false`, `current_raw_value` dan `normalized_score` `null`, `total_respondents` 0; `questions_breakdown[]` non-`FREE_TEXT` mendapat `avg_score`/`normalized_score` (dan `percent_yes` bila ada) `null` - skor default/terkonfigurasi tidak dipakai lagi; placeholder `ess_summary` metrik ESS mendapat `summary_score` dan `percent_*` `null`.

**Lainnya**: `alertEngine.getAlertsAndRecommendations` melewati metrik `has_data === false` (tanpa itu `null < min_threshold` bernilai benar sehingga metrik tanpa data muncul sebagai CRITICAL). `surveyImportService.processSurveyCsv`: `affected_metrics[].normalized_score` = `null` (dulu 0) bila metrik `NO_DATA` di jendela YTD saat ini.

**Metrik khusus**: 2/5/7/12 memakai aturan survei bulanan biasa (2 dan 5 tetap exempted pada filter direktorat). Metrik 12 hanya dari baris surveinya; sinkron feedback event masih menulis `px_metrics.raw_value` lewat `storage.updateMetricScore(12, ...)`, tetapi scorecard dan detail tidak lagi memakainya sebagai fallback. Metrik 11 (OUTCOME, kuota event live) tidak berubah.

Pengujian: `docs/07` §30 (Modul 46).

---

## Catatan v2.37.0 - Periode MTD = Bulan Template ESS & Seed ESS 2026

**Ringkasan**: `effectiveMetricPeriod` dihapus dari `server/db/filterUtils.js` (ekspor kini `CURRENT_YEAR`, `ytdEndMonth`, `periodWindow`, `parseFilterOptions`, `normalizeDateString`, `todayDateString`). `calculatePEIndex()` dan `getMetricDetail()` membaca setiap metrik SURVEY pada periode terpilih apa adanya: MTD Y-M -> hanya bulan itu, `period_window.basis` selalu `MONTH` (`YEAR_TO_MONTH` kini hanya untuk YTD); ESS lewat `selectEssResult` (tidak berubah) = hanya hasil dengan `survey_year`/`survey_month` = Y-M (**diganti v2.50.0**: carry-forward, `basis` `LATEST_RESULT`; dummy 2026 dihapus - lihat "Catatan v2.50.0"). `update_frequency` tetap dikirim di `metrics[]` dan detail, tetapi kembali hanya dipakai pengingat e-mail. Pernyataan "Catatan v2.36.0" tentang metrik `ONE_TIME_ANNUAL` pada MTD tidak berlaku lagi. Tidak ada endpoint, tabel, setting, atau env baru; `/api/health` `version` = `2.37.0`.

**Seed ESS**: `seedData.generateInitialEssResults()` juga membuat periode dummy `ESS_SEED_DUMMY_PERIODS` (2026-03, 2026-06, 2026-09; 429 baris + 33 batch). `sqlStorage.topUpEssSeed()` / `jsonStorage.topUpStoreEssSeed()` kini menyisipkan per (metrik, periode) yang belum punya baris dan mengembalikan daftar `upload_id` yang ditambahkan. Rincian: `docs/08` §17, `CHANGELOG.md` [2.37.0].

Pengujian: `docs/07` §31 (Modul 46).

---

## Catatan v2.60.0 - AI Summary per topik untuk video panjang

**Masalah**: AI Summary video panjang (contoh: "HR Projects Update", transkrip 25.411 karakter) terlalu pendek dan kehilangan topik di tengah, karena transkrip > 5.000 karakter diringkas per potongan lalu digabung menjadi format tetap 2-4 kalimat + 3-5 poin. Detail dan hasil uji nyata: `CHANGELOG.md` [2.60.0].

**Alur `runSummaryJob` (`mediaSummaryService.js`)**: satu batas waktu job (`SUMMARY_JOB_TIMEOUT_MS`) untuk semua langkah. `usesTopicMode(transcript)` = panjang transkrip (trim) > `CHUNK_CHARS` (5000) -> `summarizeByTopics()`; hasil `null` -> `summarizeWithAi()` (jalur lama per potongan, tetap bisa berakhir `RULE`). Transkrip <= 5000 karakter langsung ke `summarizeWithAi()` (satu panggilan, prompt `RINGKASAN:`/`POIN:` lama).

| Langkah | Perilaku |
| :--- | :--- |
| Map | `splitTranscript(transcript, TOPIC_PART_CHARS)` = bagian maks. 6000 karakter dipotong di akhir kalimat; > `TOPIC_MAX_PARTS` (20) -> `null`. Per bagian: `buildTopicPartPrompt` (JSON `{"topik":[{"judul","poin"}]}`), opsi `format: 'json'`, temperature 0.1, seed 41, `num_ctx` 8192, `num_predict` 500 -> `normalizeTopics` maks. 3 topik x 3 poin (`TOPIC_PART_LIMITS`). Tidak terbaca/kosong -> satu retry (seed 42, `REPEAT_GUARD`, kalimat "PASTI berisi pembahasan, jangan kosong"); tetap kosong -> bagian dilewati (`skipped_parts`). Poin bagian langsung dicek fakta (judul bagian tidak dicek; judul final dicek saat merge). Total topik < `TOPIC_MIN_MAPPED` (2) -> `null` |
| Merge | `buildTopicMergePrompt` -> JSON `{"ringkasan","topik"}`: 4-8 topik x 1-4 poin (`TOPIC_FINAL_LIMITS`), `ringkasan` 3-5 kalimat; `num_predict` 1400, `num_ctx` dari `contextFor(prompt)` (8192/16384/32768). Maks. 2 percobaan (seed 41 lalu 42 + `REPEAT_GUARD` + `PERBAIKAN: ...`) |
| Cek fakta | `buildCheckContext` (sekali per job) + `fragmentProblem`: frasa meta, tag HTML, angka/kata bilangan yang tidak ada, nama/akronim tak dikenal (akronim (2-8 huruf kapital/angka, minimal satu huruf) harus kata utuh transkrip, juga dengan akhiran nya/ku/mu/lah/kah/pun/an/kan/s; token dipecah di "/"; pada judul hanya kata setelah sapaan `pak`/`bu`/`bapak`/`ibu`/`mas`/`mbak`/`sdr`/`sdri`/`mr`/`mrs`/`ms`/`dr`/`prof`), kata isi baru (`novelWords` + `tooManyNovelWords`, hanya poin). `checkTopics` membuang poin gagal + poin pengisi (`isFillerPoint`), topik tanpa poin / judul gagal dibuang. `removeDuplicatePoints` (`isDuplicatePoint`: tumpang tindih stem >= 0,8 dari yang lebih pendek atau Jaccard >= 0,6, min. 2 kata isi; polaritas negasi harus sama) |
| `ringkasan` | `repairSummary`: pembuka meta ("Rekaman/Video/Transkrip/Rapat/Pertemuan/Diskusi/Podcast/Percakapan/Wawancara ini membahas ...", en "This recording/video/... discusses ...") -> "Pembahasan (juga) mencakup ..." / "The discussion (also) covers ..."; masih gagal -> kalimat dengan frasa meta atau kata acara terlarang dibuang (sisa >= 40 karakter, lolos `validateAnswer`). Kata rapat/pertemuan/meeting hanya boleh bila transkrip atau `file_name` memuatnya |
| Keep-best | Topik >= 2 dan `ringkasan` lolos -> selesai. Selain itu percobaan dengan topik terbanyak (>= 2) disimpan; setelah 2 percobaan: topik terbaik + `ringkasan` cadangan yang lolos, atau `summaryFromTitles` ("Pembahasan mencakup <t1>, <t2>, dan <tN>."); tidak ada percobaan dengan >= 2 topik valid -> `null` |

**Soft error Ollama (`localAiService.js`)**: `postJson` kini menyertakan `err.status` dan `err.ollamaError`; jawaban kosong melempar error dengan `err.soft = true`. `isSoftGenerationError(err)` = `soft` atau pesan cocok `/token repeat limit|prediction aborted|repeat(ed|ing)? tokens?/i`. `askModelOrNull` mengubah soft error menjadi `null` (jawaban tak terpakai, `aborted_answers`++) sehingga retry yang sudah ada berjalan; hard error tetap dilempar -> `RULE`. Berlaku juga di jalur lama: ringkasan per potongan kini satu retry pada soft error; dua kali dihentikan -> "Ollama aborted the AI answer twice (the model kept repeating itself); the automatic (rule-based) summary is shown.". Retry jalur pendek = temperature 0.2, seed 42 + `REPEAT_GUARD` (sebelumnya tanpa guard). `queryLocalOllama` opsi baru: `format`, `numCtx` (`num_ctx`), `numPredict` (`num_predict`), `repeatPenalty`, `repeatLastN`, `details` (`{ text, doneReason, evalCount }`). Jawaban yang tak terpakai di mode topik dicatat di log server (`done_reason`, `eval_count`, panjang, 150 karakter awal/akhir).

**Field media** (sama di SQL dan JSON; dikirim apa adanya oleh `GET /api/events/:id`):

| Field | Isi |
| :--- | :--- |
| `summary_topics` | `[{ title, points: [...] }]` untuk ringkasan AI bertopik; `null` untuk ringkasan standar, `RULE`, `INSUFFICIENT`, atau sebelum ringkasan ada |
| `summary_topic_stats` | `{ parts, retried_parts, skipped_parts, dropped_points, dropped_topics, merge_attempts, aborted_answers, filler_points, duplicate_points, summary_repaired, summary_sentences_removed, summary_from_titles }`; `null` bila `summary_topics` null. Tidak ditampilkan di UI |
| `summary` / `summary_points` | Mode topik: `summary` = `ringkasan`, `summary_points` = "<judul>: <poin pertama>" per topik (pembaca lama dan PPT tetap jalan) |

Setiap penulisan ringkasan (`runSummaryJob`, `INSUFFICIENT`, antrian penuh) mengisi kedua field (Regenerate menghapus topik lama); `queueMediaTranscription` (`transcribeService.js`) mengosongkannya saat transkrip baru dimulai. `pptGenerator.js` tidak berubah (memakai `summary`). Tidak ada endpoint, setting, atau env baru; gating Gemma tidak berubah (video baru setelah transkrip `DONE` atau `POST /api/media/:id/summarize`). `/api/health` `version` = `2.60.0`.

**Ekspor modul baru**: `summarizeByTopics`, `usesTopicMode`, `buildTopicPartPrompt`, `buildTopicMergePrompt`, `parseJsonAnswer`, `normalizeTopics`, `buildCheckContext`, `fragmentProblem`, `checkTopics`, `isFillerPoint`, `isDuplicatePoint`, `removeDuplicatePoints`, `repairSummary`, `summaryFromTitles`, `contextFor`, `TOPIC_PART_CHARS`, `TOPIC_MAX_PARTS`, `TOPIC_PART_LIMITS`, `TOPIC_FINAL_LIMITS`, `REPEAT_GUARD`; `localAiService.isSoftGenerationError`.

**Batasan**: Gemma 4B bisa berputar pada transkrip sangat panjang/podcast (52.282 karakter: jalur lama, AI tanpa topik, 17 mnt); `ringkasan` bisa mengulang "Pembahasan mencakup"; distorsi makna halus tidak terdeteksi; ringkasan tersimpan tidak diproses ulang otomatis (tombol Regenerate di UI hanya untuk ringkasan kosong/`FAILED`/`RULE`; ringkasan AI lama lewat `POST /api/media/:id/summarize`). Skema: `docs/08` §30. Pengujian: `docs/07` §50 (Modul 65).

---

## Catatan v2.59.0 - Batas unggahan foto/video sebagai setting Admin (`media_upload_max_mb`)

| Endpoint | Akses | Perilaku |
| :--- | :--- | :--- |
| `PUT /api/admin/settings/media_upload_max_mb` | Admin (USER 403, tanpa sesi 401) | Body `{ value }`, bilangan bulat 1-4096 (MB per file); selain itu 400 "Max photo/video upload size (MB) must be a whole number between 1 and 4096."; audit `SETTINGS_CHANGE` `media_upload_max_mb: <lama> -> <baru>`; mengosongkan cache batas |
| `GET /api/settings` | Login | Memuat `media_upload_max_mb` (dibaca `EventManager.jsx` dan Admin Parameters) |
| `POST /api/events/:id/media` | Event manager | Batas = setting, dibaca per request; > batas -> 413 `{ error: "The file exceeds the <n> MB (<g> GB) limit.", max_mb }` |

- **`server/server.js`**: `getMediaMaxMb()` (cache 30 dtk, `clearMediaMaxMbCache()` dipanggil saat PUT), `mediaUploaderFor(mb)` (satu instance multer per nilai, `fileFilter` allowlist v2.30.1 tidak berubah), `mediaLimitLabel(mb)` ("1024 MB (1 GB)" / "500 MB"); rentang di `NUMERIC_SETTINGS`. Urutan sumber: setting valid -> env `MEDIA_MAX_MB` valid -> 1024.
- **Seed/boot**: `initialAppSettings.media_upload_max_mb` = 1024; top-up setting yang sudah ada (`sqlStorage` / `jsonStorage`) hanya menambah bila belum ada. Tidak ada tabel, kolom, atau endpoint baru.
- **Timeout**: `REQUEST_TIMEOUT_MS` backend (default 120 mnt) tetap; `vite.config.mjs` mendapat plugin `px-long-uploads` yang menyetel `requestTimeout` server dev/preview Vite ke nilai yang sama (bawaan Node 5 mnt memotong unggahan besar lewat proxy).
- Pengujian: `docs/07` §49 (Modul 64).

---

## Catatan v2.58.0 - Nomor tampilan metrik (`display_no`)

`metric_id` tetap kunci backend (route, storage, kolom CSV `metric_id`, nama file unduhan, target audit). Field baru `display_no` = nomor yang ditampilkan UI: posisi 1-based semua metrik yang ada, diurutkan `journey_id` lalu `metric_id` (`px_journeys.display_order` tidak dipakai). Metrik dihapus -> nomor sesudahnya maju (tanpa celah); metrik baru (id max + 1) -> nomor terakhir journey-nya, journey sesudahnya +1.

- **`server/db/metricNumbers.js`** (baru): `displayNumberMap(metrics, journeys)` -> `Map(metric_id -> display_no)` (journey tak dikenal di akhir); `loadDisplayNumbers(storage)` membaca metrik + journey dari backend aktif; `withDisplayNo(list, numbers)` menyalin objek ber-`metric_id` dan menambah `display_no` (`null` bila metrik sudah tidak ada).
- **Dikirim oleh**: `GET /api/metrics/calculate` (metrik + rollup journey, `calculationEngine.calculatePEIndex`), `GET /api/metrics/:id/detail`, `GET /api/alerts` (`alertEngine`), `GET /api/admin/parameters`, `GET /api/surveys/metrics`, `GET /api/admin/part-questions` (diurutkan menurut `display_no`), `GET /api/admin/upload-reminders` (+ `history`), `GET /api/admin/users` (`pic_metrics[]`, `authService`), hasil upload survei `affected_metrics[]` (`surveyImportService`).
- Tidak ada endpoint, tabel, setting, atau env baru. Pengujian: `docs/07` §48 (Modul 63).

---

## Catatan v2.57.0 - Summary Questions (pertanyaan template ringkasan)

**Endpoint baru (Admin saja; USER 403, tanpa login 401)**:

| Endpoint | Respons / aturan |
| :--- | :--- |
| `GET /api/admin/part-questions` | `{ metrics: [{ metric_id, metric_name, parts: [...] }], question_types: ['SCALE','TEXT'], max_text: 500, max_questions: 60 }`. Per bagian: `part_key`, `part_name`, `sort_order`, `scale`, `kind` (`QUESTIONS` \| `EVENT_BLOCKS` \| `SCORE_TABLE`), `configured`, `questions`, `event_labels` (metrik 12: dari upload terakhir, else template), `uploads_count`, `latest_upload { upload_id, file_name, uploaded_at, question_texts }`, `differs_from_latest_upload` |
| `PUT /api/admin/part-questions/:metric_id/:part_key` | Body `{ questions: [{ key?, text, type? }] }` mengganti seluruh daftar (`partQuestions.normalizeQuestions`): teks wajib maks. 500, `type` `SCALE`\|`TEXT` (default `SCALE`), kunci opsional `[A-Za-z0-9_-]{1,40}` unik (baru = `q<n>` bebas berikutnya), maks. 60; bagian `SCORE_TABLE` 400. Bagian tidak dikenal / metrik tanpa bagian 404. Respons `{ success, metric_id, changes, part }`. Audit `PART_QUESTIONS_UPDATE` dengan ringkasan `describeChanges` |

`GET /api/admin/metric-parts/:metric_id` kini juga mengirim `kind` dan `questions` per bagian.

**Modul `server/db/partQuestions.js` (baru)**: `partKind`, `isEventPart`, `isScoreTablePart`, `firstEventBlock`, `seedQuestions` (top-up boot), `normalizeQuestions`, `questionSetKey` (identitas set = teks berurutan), `describeChanges`. Storage (dua backend): `setMetricPartQuestions(metric_id, part_key, questions)`, `topUpPartQuestions()`; `getMetricParts()` mengembalikan `questions` (`null` = belum dikonfigurasi).

**`metricPartsService.js`**: bila `part.questions` berupa list, `mapConfiguredColumns` memetakan kolom pertanyaan file **berdasarkan posisi** (jumlah harus sama; metrik 12: blok event = kolom skor event + N pertanyaan, header biru di awal blok), `SCALE` = angka pada skala atau "-", `TEXT` = teks bebas (tidak dinilai); setiap jawaban menyimpan `key`, `label` (teks terkonfigurasi), `file_label`, `type`; upload menyimpan `columns.questions_snapshot`. Template memakai teks terkonfigurasi. `partEvidenceTable` menomori set pertanyaan (Set 1 = tertua) dan, bila periode berisi lebih dari satu set, memakai tata letak panjang dengan `Question_Set` plus `note`; `metricHistoryService` meneruskan catatan itu sebagai `notes` di `GET /api/metrics/:id/history`. `part.questions` `null` = perilaku v2.55.0.

Pengujian: `docs/07` §47 (Modul 62).

---

## Catatan v2.56.0 - History metrik (`GET /api/metrics/:id/history`)

| Endpoint | Respons / aturan |
| :--- | :--- |
| `GET /api/metrics/:id/history` | Login wajib (401). Periode: `?period=YTD\|YYYY\|YYYY-MM\|ALL` (seperti evidence) atau `?mode=&year=&month=` (seperti detail; `MTD` -> `YYYY-MM`, lainnya `YYYY`, default tahun berjalan). `?directorate=` / `?sub_directorate=` hanya untuk cek cakupan USER (di luar cakupan 403). id bukan angka 400, metrik tidak ada 404, periode salah 400. Respons `{ metric_id, kind, period, columns: [{ key, label, hidden? }], rows, total, identity_hidden, scope_limited, reason }`, baris terbaru dulu. |

**Service**: `metricHistoryService.js` (baru): `buildMetricHistory`, `historyKindOf`, `mergeTables`. Baris dibangun oleh fungsi yang sama dengan file evidence: `outcomeValueService.outcomeEvidenceTable`, `metricPartsService.partEvidenceTable`, `essSummaryService.essEvidenceTables`, `surveyEvidenceService.generateSurveyEvidence(id, period, { tablesOnly: true })` (builder membuat tabel dulu, lalu CSV). Kunci kolom = header CSV evidence; `Metric_ID`, `Metric_Name`, `Upload_ID`, `File_SHA256`, `Updated_At` diberi `hidden: true`. Header yang berulang dalam satu tabel diberi akhiran " (2)".

**`kind`** (urutan pengecekan): `NOT_AVAILABLE` (`data_status` `NOT_AVAILABLE`; tanpa baris, `reason` diisi) -> `PARTS` (metrik punya `px_metric_parts`) -> `ESS` / `SURVEY_RESPONSES` (SURVEY) -> `EVENT_ATTENDANCE` (metrik 11) -> `OUTCOME_VALUES` (OUTCOME upload dengan baris `px_outcome_values`) -> `OPERATIONAL` (records operasional `getMetricDetail`).

**Akses** (route): identitas hanya bila `auth.canSeeRespondentData` (Admin; PIC metrik SURVEY), selain itu kolom identitas dibuang (`identity_hidden`). Admin dan metrik non-karyawan: `scopes = null` (semua baris, tidak dipersempit `?directorate=`). Non-Admin pada metrik karyawan: baris cakupan sendiri (`scope_limited`); `PARTS`: hanya baris Level `Directorate` direktorat sendiri (tanpa Bankwide); `ESS`: `essEvidenceTables({ scopes })`; `EVENT_ATTENDANCE`: `rowInScopes`. Endpoint evidence tidak berubah (Admin/PIC saja).

Pengujian: `docs/07` §46 (Modul 61).

---

## Catatan v2.55.0 - Rata-rata Bulan (metrik 1, 3), Metrik Ringkasan per Bagian & Saklar Data N/A

**Endpoint baru (Admin saja; USER 403, tanpa login 401)**:

| Endpoint | Respons / aturan |
| :--- | :--- |
| `GET /api/admin/metric-parts/:metric_id` | `{ metric_id, metric_name, parts: [{ part_key, part_name, sort_order, scale, uploads }] }`; id bukan angka 400, metrik tak ada / tanpa bagian 404 |
| `GET /api/admin/metric-parts/:metric_id/:part_key/template` | `.xlsx` (sheet "Pivot"): A-D Directorate/Level/Year/Month, E skor, kolom pertanyaan, Jumlah Responden, Periode; bagian tak dikenal 404 |
| `POST /api/admin/metric-parts/:metric_id/:part_key/upload` | multipart `file`; bukan `.xlsx`/MIME Excel 415; > 5 MB 413; file tidak valid 400 (semua error baris+kolom, tidak ada yang tersimpan); sukses = `rows_imported`, `replaced_rows`, `periods`, `upload_id`; audit `METRIC_PART_UPLOAD`. File diproses di memori dan **tidak disimpan** |
| `GET /api/admin/metric-parts/:metric_id/:part_key/evidence?period=` | CSV baris tersimpan (`ALL` default, `YTD`, `YYYY`, `YYYY-MM`; lainnya 400), `nosniff` |

**Endpoint yang berubah** (metrik `outcome_aggregation = AVERAGE`, yaitu 1 dan 3): `GET /api/admin/outcome-values/:metric_id/template?year=` (default tahun berjalan; tata letak baris bulan); `POST /api/admin/outcome-values/:metric_id/upload` butuh field `year` (2000..tahun berjalan) dan mengganti semua bulan tahun itu. Evidence menambah baris "Average" per tahun.

**Field baru** di `GET /api/metrics/calculate` / `GET /api/metrics/:id/detail` / `GET /api/admin/parameters`: `outcome_aggregation`, `outcome_months_count`, `outcome_average_label`, `period_window.basis` `AVERAGE_OF_MONTHS` (metrik `AVERAGE` di YTD dan metrik ringkasan), `data_status`, `data_not_available`, `metric_parts` + `parts_with_data`, `data_upload: 'PART_SUMMARY'`, detail `parts` / `composite` / `operational_records_hidden`. Admin metric create/edit menerima `outcome_aggregation` (`LATEST`|`AVERAGE`, OUTCOME saja; nilai lain 400) dan `data_status` atau boolean `data_not_available` (nilai lain 400).

**Service**: `metricPartsService.js` baru (parser, `compositeValue`, template, evidence); `outcomeValueService.js` (parser baris bulan, `parseUploadYear`, template tahunan); `socialMediaService.SOCIAL_MEDIA_DRILLDOWN_ENABLED = false` (drilldown metrik 1 dorman); `calculationEngine.syncLiveEventMetrics` tidak lagi menimpa metrik 12. `xlsxUtils.readFirstSheet` mendapat opsi `preferSheet`, `refuseSheet`, `withFill`. Storage (SQL dan JSON): `getMetricParts`, `getMetricPartResults`, `getMetricPartUploads`, `saveMetricPartUpload`. Rumus: `docs/01` §3.10.

## Catatan v2.54.2 - Nilai manual sementara per metrik (metrik 11)

Setting baru `metric_manual_overrides` di `px_app_settings` (JSON per `metric_id`: `value`, `score` 0-100, `note`, `bankwide_only` default `true`). `calculationEngine.loadManualOverrides()` / `manualOverrideFor()` dibaca `calculatePEIndex` (dan semua pemanggilnya: trend, by-directorate, alerts) serta detail metrik: nilai = `value`, normalized score = `score`; `bankwide_only` + filter direktorat / cakupan User -> `NO_DATA` + `not_applicable: true`. Field baru `manual_override` (`{ value, score, note, bankwide_only }` atau `null`) di `GET /api/metrics/calculate` dan `GET /api/metrics/:id/detail`. Tidak ada endpoint baru; setting diubah langsung di database (sementara untuk presentasi direksi 2026-10-22: metrik 11 = 714 pax / 87%). Hapus key metrik untuk kembali ke perhitungan live.

## Catatan v2.54.0 - Skor Bertingkat (`score_tiers`) & Nilai Bulanan Metrik OUTCOME

**Ringkasan**: metrik 1, 2, 3, 14 dinilai per tier (`px_metrics.score_tiers`; rumus `docs/01` §3.9); tier belum diatur = N/A (di luar indeks). Metrik OUTCOME (kecuali 11) menerima satu nilai bankwide per bulan lewat upload `.xlsx` Admin; setiap metrik mendapat "Last update". `/api/health` `version` = `2.54.0`. Tidak ada env/setting baru.

| Endpoint (Admin saja; USER 403, tanpa login 401) | Keterangan |
| :--- | :--- |
| `GET /api/admin/outcome-values/:metric_id/template` | `.xlsx` `Template_Outcome_Metric_<id>.xlsx`: judul metrik + unit, header Year \| Month \| Value \| Notes, satu baris bulan lengkap terakhir (nilai kosong) |
| `POST /api/admin/outcome-values/:metric_id/upload` | multipart field `file`, `.xlsx` + MIME Excel (lainnya 415), maks. 5 MB (413), tanpa file 400; validasi utuh -> 400 `{ error, errors: [{ row_number, column, reason }] }`, tidak ada yang disimpan; sukses -> `upload_id`, `rows_imported`, `inserted_rows`, `updated_rows`, `periods`, `period_labels`; audit `OUTCOME_UPLOAD`; `uploaded_by` = `Name (username)` |
| `GET /api/admin/outcome-values/:metric_id/uploads` | riwayat batch metrik (terbaru dulu) + `has_original_file` |
| `GET /api/admin/outcome-values/uploads/:upload_id/file` | file asli dari `server/data/outcome-uploads/<upload_id>.xlsx` (nosniff); tidak ada -> 404 |
| `GET /api/admin/outcome-evidence/:metric_id?period=&kind=` | CSV; `period` = `ALL` (default) \| `YTD` \| `YYYY` \| `YYYY-MM` (lainnya 400). `OUTCOME_VALUES`: bulan tersimpan + `Used_In_Score` (YES = bulan yang dipakai skor periode itu); metrik 1 `kind=social_media`: baris social media; metrik 11: absensi event (NIP, nama, e-mail, direktorat). Escape formula seperti evidence lain |

`:metric_id` bukan angka -> 400, tidak ada -> 404; template/upload/uploads untuk metrik SURVEY atau metrik 11 -> 400; evidence untuk metrik SURVEY -> 400 (pakai `/api/surveys/evidence`).

**Aturan skor OUTCOME** (`calculatePEIndex` dan `getMetricDetail`, sama di trend dan PX Index per direktorat): metrik dengan baris `px_outcome_values` -> YTD = bulan tersimpan terakhir di jendela (`periodWindow`), MTD = bulan itu, tidak ada -> `NO_DATA`; tanpa baris sama sekali -> `raw_value` statis (`value_basis: STATIC_SNAPSHOT`). Nilai tetap bankwide di bawah filter direktorat (aturan v2.48.0).

**Field baru** (`/api/metrics/calculate` per metrik dan `/api/metrics/:id/detail`):

| Field | Isi |
| :--- | :--- |
| `score_tiers` | `{ unit, bounds }` atau `null` (tidak bertier) |
| `tier_info` | `{ value, tier, lower_bound, score, score_uncapped, percent, capped, unit, bounds }` atau `null` |
| `not_applicable` | `true` bila tier belum diatur (status `NO_DATA`) |
| `evidence_type` | OUTCOME: `OUTCOME_VALUES` / `EVENT_ATTENDANCE` (metrik 11) |
| `outcome_upload` | OUTCOME selain metrik 11 = `true` |
| `value_basis` | `MONTHLY_VALUES` \| `STATIC_SNAPSHOT` |
| `outcome_period`, `outcome_period_label`, `outcome_value_source` | bulan yang dipakai skor (`YYYY-MM`, "September 2026", `UPLOAD`/`SEED`) |
| `last_update_period`, `last_update_label` | periode data terakhir (periode mana pun): SURVEY SYSTEM = tanggal survei terbaru, ESS = hasil terbaru, metrik 11 = absensi terbaru, OUTCOME = bulan tersimpan terbaru, metrik 1 tanpa nilai bulanan = bulan social media terbaru, lainnya `last_data_date` |

`target_value_normalized` bisa `null` (metrik N/A) di calculate, detail dan `/api/admin/parameters`. `period_window.basis` OUTCOME dengan nilai bulanan = `LATEST_MONTH` (YTD) / `MONTH` (MTD).

**Admin metrik**: `POST`/`PUT /api/admin/metrics` menerima `score_tiers` (objek atau JSON; validasi `parseTierConfig`: 4 batas positif naik ketat, `op` `>=`/`>`, `unit` `percent`/`number`; salah -> 400). `score_tiers` tidak dikirim atau `null` = konfigurasi tersimpan dipertahankan (tier tidak dimatikan lewat API).

**Storage** (kedua backend): `getOutcomeValues(metricId?)`, `getOutcomeUploads(metricId?)`, `saveOutcomeValues(meta, rows)` (upsert dalam satu transaksi), `getLatestSurveyDates()`, `getLatestSocialMediaPeriod()`; `deleteMetric` ikut menghapus nilai + riwayat (route menghapus file asli). Boot: `topUpScoreTiers()` (SQL) / langkah yang sama saat `store.json` dimuat - konfigurasi seed sekali, hanya bila `score_tiers` masih kosong.

---

## Catatan v2.53.0 - Fitur Integrasi Token Dihapus

**Ringkasan**: seluruh fitur integrasi v2.52.0 dihapus (aplikasi on-premise tanpa internet; permintaan user). Data social media metrik 1 kini hanya masuk lewat upload `.xlsx` Admin (endpoint `/api/admin/social-media/*` tidak berubah). `/api/health` `version` = `2.53.0`. Tidak ada env baru. Pengujian: `docs/07` §42.

| Dihapus | Perilaku URL lama sejak v2.53.0 |
| :--- | :--- |
| `POST /api/integrations/social-media` (+ entri `PUBLIC_ROUTES`, validasi JSON ingest, rate limiter ingest) | 401 tanpa login (juga dengan header Bearer); 404 dengan sesi Admin/USER |
| `GET`/`POST /api/admin/integration-tokens`, `POST /api/admin/integration-tokens/:id/revoke`, `DELETE /api/admin/integration-tokens/:id` | 404 Admin, 403 USER, 401 tanpa login |

**Storage**: method token dihapus dari `sqlStorage.js` dan `jsonStorage.js`. Baru `dropRetiredIntegrationTokens()` (SQL saja; dipanggil saat boot setelah `applySchema()` dan di `migrate.js`): tabel tidak ada -> `ABSENT`; ada dan kosong -> `DROP`; berisi -> dibiarkan + peringatan log. JSON: `integrationTokens` kosong dihapus dari `auth.json` saat dimuat; berisi -> dibiarkan + peringatan. Riwayat upload (`GET /api/admin/social-media/uploads`) masih bisa memuat batch lama `source: 'INTEGRATION'` bila ada; tidak ada yang membuat batch baru dengan sumber itu.

---

## Catatan v2.52.0 - Data Social Media Metrik 1, Upload Excel & Token Integrasi

**Ringkasan**: metrik 1 "Career website & social media follower, reach & engagement growth" (OUTCOME, bankwide) kini memakai statistik bulanan Instagram, LinkedIn dan TikTok (followers, reach, engagement) sebagai drilldown, bukan lagi 5 baris SLA rekrutmen (dihapus saat boot, metrik 1 saja). Data masuk lewat upload `.xlsx` Admin atau injeksi JSON dari sistem internal lain dengan token integrasi (**injeksi, token, tabel `px_integration_tokens` dan semua endpoint `integration*` di bawah dihapus di v2.53.0** - lihat "Catatan v2.53.0"). **Skor tetap `raw_value` Admin** - baris social media belum dipakai perhitungan; `last_data_date` tidak diubah. Service baru `server/services/socialMediaService.js` (`SOCIAL_MEDIA_METRIC_ID = 1`, `isSocialMediaMetric` = metrik 1 bertipe OUTCOME). Tabel baru `px_social_media_stats`, `px_social_media_uploads`, `px_integration_tokens` (`docs/08` §25). Tidak ada env baru. `/api/health` `version` = `2.52.0`. Pengujian: `docs/07` §41 (Modul 55).

**Endpoint baru**

| Endpoint | Akses | Body / query | Respons sukses | Audit |
| :--- | :--- | :--- | :--- | :--- |
| `GET /api/admin/social-media/template` | Admin | - | `Template_Social_Media_Metric_1.xlsx`: header Platform \| Year \| Month \| Followers \| Reach \| Engagement + satu baris per platform untuk bulan lengkap terakhir (angka kosong) | - |
| `POST /api/admin/social-media/upload` | Admin | multipart `file` (`.xlsx`, maks. 5 MB) | `{ success, upload_id, source: 'UPLOAD', rows_imported, inserted_rows, updated_rows, replaced_seed_rows, periods, period_labels, errors: [], message, file_name }` | `SOCIAL_MEDIA_UPLOAD` |
| `GET /api/admin/social-media/uploads` | Admin | - | riwayat batch UPLOAD dan INTEGRATION (terbaru dulu) + `has_original_file` | - |
| `GET /api/admin/social-media/file/:upload_id` | Admin | - | file `.xlsx` asli upload itu; 404 bila tidak ada (mis. batch INTEGRATION) | - |
| `GET /api/admin/integration-tokens` | Admin | - | `{ tokens: [{ token_id, name, token_hint, scope, created_by, created_at, last_used_at, revoked_at, revoked_by, is_test }], endpoint, max_rows: 500, rate_limit_per_minute: 30 }` - tanpa hash | - |
| `POST /api/admin/integration-tokens` | Admin | `{ name }` | 201 `{ token, record, message }` - `token` hanya di respons ini | `INTEGRATION_TOKEN_CREATE` |
| `POST /api/admin/integration-tokens/:id/revoke` | Admin | - | `{ success, record }`; cabut kedua kali tidak mengubah apa pun (tanpa audit kedua) | `INTEGRATION_TOKEN_REVOKE` |
| `DELETE /api/admin/integration-tokens/:id` | Admin | - | `{ success }`; hanya token yang sudah dicabut | `INTEGRATION_TOKEN_DELETE` |
| `POST /api/integrations/social-media` | Token integrasi atau sesi Admin | `{ "rows": [...] }` (JSON, 1-500 baris) | sama seperti upload, `source: 'INTEGRATION'` | `SOCIAL_MEDIA_INGEST` |

Route `/api/admin/*` di atas: USER 403, tanpa sesi 401 (`requireRole('ADMIN')`). `POST /api/integrations/social-media` terdaftar di `PUBLIC_ROUTES` (`authService.js`) agar bisa dipanggil tanpa sesi, tetapi route itu sendiri mewajibkan token sah atau sesi Admin.

**Kode error**

| Status | Kapan |
| :--- | :--- |
| 400 | Upload: tidak ada file, file bukan workbook yang terbaca, tidak ada baris header / kolom wajib hilang / tidak ada baris data, atau error per baris. Ingest: body bukan `{ rows: [...] }`, `rows` kosong atau > 500, error per baris. Token: nama kosong / > 100 karakter / karakter kontrol; id bukan angka (revoke/delete). Bentuk: `{ success: false, error, errors: [{ row_number, column, reason }] }` - upload: `column` = huruf kolom Excel; ingest: `row_number` = posisi di array (1 = `rows[0]`), `column` = nama field |
| 401 | Ingest tanpa header dan tanpa sesi (`code: AUTH_REQUIRED`), atau token salah bentuk / tidak dikenal / dicabut (`code: INVALID_TOKEN`); keduanya dengan `WWW-Authenticate: Bearer` |
| 403 | Ingest dengan sesi USER (atau Admin yang wajib ganti password); request dengan header `Origin` host lain (pemeriksaan global `crossOriginWrite`; request tanpa `Origin`, mis. curl, tidak terpengaruh) |
| 404 | Token / file upload tidak ada |
| 409 | Nama token aktif sudah dipakai; hapus token yang masih aktif |
| 413 | File upload > 5 MB |
| 415 | Ekstensi bukan `.xlsx` atau MIME bukan Excel/zip/octet-stream (CSV dan `.xls` ditolak) |
| 429 | > 30 request/menit per token atau per sesi Admin, atau > 20 cek token gagal/menit dari satu IP (lalu juga token yang benar ditolak sampai jendela lewat); dengan `Retry-After` (detik) |

**Validasi baris** (sama untuk Excel dan JSON, atomik - satu error = tidak ada yang disimpan): `platform` Instagram/LinkedIn/TikTok, alias `ig`, `insta`, `tt`, huruf besar/kecil, spasi, titik, tanda hubung dan garis bawah diabaikan ("Linked In" = LinkedIn); `year` 4 digit 2000-2100; `month` angka 1-12 atau nama bulan Inggris/Indonesia/singkatan (`parseMonth` dari `essSummaryService`); `followers`/`reach`/`engagement` bilangan bulat 0..2.000.000.000 (teks boleh memakai spasi/koma pemisah ribuan; negatif, desimal, kosong, bukan angka, rumus tanpa nilai tersimpan ditolak); platform+bulan ganda dalam satu file/request ditolak. Excel: baris header = baris pertama (dari 10 baris teratas) yang berisi sel "Platform"; urutan kolom bebas; nama kolom alternatif `tahun`, `bulan`, `follower`/`pengikut`, `jangkauan`, `engagements`/`interaksi`.

**Penyimpanan** (`storage.saveSocialMediaStats(meta, rows)`, satu transaksi): (1) hapus semua baris `SEED` di setiap bulan batch (ketiga platform); (2) per baris `MERGE` pada `(platform, stat_year, stat_month)` -> update atau insert dengan `source` batch; (3) catat batch di `px_social_media_uploads`. Top-up seed saat boot (`topUpSocialMediaSeed`, hanya bila `SEED_DEMO_DATA` bukan `false`): menambah baris dummy (`generateSocialMediaSeed`, Januari-September 2026, 27 baris fiktif deterministik) hanya untuk (platform, bulan) yang belum ada dan bulan tanpa baris asli.

**Token integrasi**: `pxi_` + 64 karakter hex (32 byte acak). Disimpan hanya `token_hash` (SHA-256) dan `token_hint` (12 karakter pertama + "…"); token tidak pernah dikembalikan lagi dan tidak ditulis ke log; audit hanya memuat id, nama dan `token_hint`. `scope` hanya `SOCIAL_MEDIA_INGEST`: header `Authorization` hanya dibaca oleh route ingest; di route lain token diabaikan (401 tanpa sesi). `last_used_at` diperbarui setiap pemakaian sah. Token buatan akun tes (`is_test_account`) = `is_test` (audit-nya disembunyikan seperti akun tes). Rate limiter di memori proses (`createRateLimiter`, reset saat restart).

**Contoh panggilan** (ganti `<server>` dan `<token>`):

```
curl -X POST "http://<server>:5000/api/integrations/social-media" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"rows":[{"platform":"Instagram","year":2026,"month":9,"followers":211100,"reach":548319,"engagement":19505}]}'
```

**Detail metrik 1** (`GET /api/metrics/1/detail`, juga USER): `operational_records` = baris per platform per bulan dalam jendela periode (`periodWindow`: YTD = Januari..bulan akhir YTD, MTD = bulan itu; tahun depan = jendela `null`, tanpa baris), field `platform`, `year`, `month`, `period`, `period_label`, `followers`, `previous_followers`, `follower_growth_pct` (vs bulan kalender sebelumnya platform yang sama; `null` bila tidak ada atau 0), `reach`, `engagement`, `engagement_rate_pct` (engagement / reach x 100; `null` bila reach 0), `source`, `is_dummy`. Objek tambahan `social_media { platforms, window, period_totals, latest_period, latest_period_label }`; `period_totals` = satu baris "semua platform" per bulan dengan >= 2 platform (jumlah; growth hanya bila semua platform punya bulan sebelumnya). `latest_period` = bulan terbaru yang tersimpan (sumber apa pun). Filter `directorate`/`sub_directorate` tidak berpengaruh (bankwide). `data_upload: 'SOCIAL_MEDIA'` ada pada metrik 1 di `metrics[]` `/api/metrics/calculate` dan di detail; skor, status dan `current_raw_value` tidak berubah.

**Export / migrasi**: `exportToJson.js` menulis `socialMediaStats` dan `socialMediaUploads` (tanpa token); `migrate.js` mengimpornya (`social_media_stats`, `social_media_uploads` di hitungan verifikasi); `dropAllTables()` (`--reset`) menghapus kedua tabel social media tetapi tidak `px_integration_tokens`. Token tidak termasuk `CONFIG_TABLES` snapshot konfigurasi.

---

## Catatan v2.51.0 - Admin Direktorat, `has_own_data`, Audit Parameter & Snapshot Konfigurasi

**Ringkasan**: (1) master direktorat dikelola Admin (Admin Parameters -> Directorates): tambah/rename/hapus/merge direktorat, tambah/rename/hapus divisi, *former name* manual; rename/merge ikut mengubah nama di semua data; (2) `GET /api/metrics/by-directorate` mengirim `has_own_data`; (3) perubahan parameter Admin masuk Audit Trail; (4) `storage.snapshotConfiguration()` / `restoreConfiguration()` untuk config guard suite; (5) template pertanyaan default 11 metrik ESS = file template ESS. Tabel baru `px_directorate_aliases`, `px_division_aliases` dan setting `directory_admin_managed` (`docs/08` §24). Tidak ada env baru. `/api/health` `version` = `2.51.0`. Pengujian: `docs/07` §40 (Modul 53, 54).

**Endpoint baru** (semua di bawah `/api/admin` = Admin saja; User 403, tanpa sesi 401). Divisi selalu disebut di body / query string, tidak pernah di path URL.

| Endpoint | Body / query | Respons sukses | Audit |
| :--- | :--- | :--- | :--- |
| `GET /api/admin/directorates` | - | `{ directorates: [{ directorate_id, name, usage, total_references, divisions: [{ name, usage, total_references }], former_names, former_division_names }], managed, max_length: 200, reserved_directorate_names, reserved_division_names }` | - |
| `POST /api/admin/directorates` | `{ name, divisions?: [..], confirm_adopt? }` | 201 `{ directorate, released_alias_of, adopted_orphans }` | `DIRECTORATE_CREATE` |
| `PUT /api/admin/directorates/:id` | `{ name, confirm_adopt? }` | `{ changed, from, to, counts, released_alias_of, adopted_orphans }`; nama sama persis = `changed: false` | `DIRECTORATE_RENAME` (bila berubah) |
| `DELETE /api/admin/directorates/:id` | - | `{ deleted, divisions, former_names_removed }` | `DIRECTORATE_DELETE` |
| `GET /api/admin/directorates/:id/merge-preview?target_id=` | - | `{ from, to, rows, total_references, ess_results_pooled, divisions_moved, divisions_merged: [{ from, into }], accounts: [{ user_id, username, before, after, widened, ... }] }` (baca saja) | - |
| `POST /api/admin/directorates/:id/merge` | `{ target_id }` | `{ from, to, divisions_moved, divisions_merged, counts, scope_changes }` | `DIRECTORATE_MERGE` + satu `USER_SCOPE_CHANGE` per akun yang cakupannya berubah |
| `POST /api/admin/directorates/:id/divisions` | `{ name }` | 201 `{ directorate, division }` | `DIVISION_CREATE` |
| `PUT /api/admin/directorates/:id/divisions` | `{ division, name }` | `{ changed, directorate, from, to, counts }` | `DIVISION_RENAME` (bila berubah) |
| `DELETE /api/admin/directorates/:id/divisions?division=` | (atau `division` di body) | `{ directorate, deleted }` | `DIVISION_DELETE` |
| `POST /api/admin/directorates/:id/aliases` | `{ name, confirm_adopt? }` | 201 `{ directorate, alias, adopted_orphans, counts }` | `DIRECTORATE_ALIAS_ADD` |
| `DELETE /api/admin/directorates/:id/aliases?name=` | (atau `name` di body) | `{ directorate, alias }` | `DIRECTORATE_ALIAS_REMOVE` |
| `POST /api/admin/directorates/:id/divisions/aliases` | `{ division, name, confirm_adopt? }` | 201 `{ directorate, division, alias, adopted_orphans, counts }` | `DIVISION_ALIAS_ADD` |
| `DELETE /api/admin/directorates/:id/divisions/aliases?name=` | (atau `name` di body) | `{ directorate, division, alias }` | `DIVISION_ALIAS_REMOVE` |

`usage` / `counts` per sumber: `survey_responses` (baris EMPLOYEE), `ess_results` (baris direktorat; `ess_results_pooled` = yang digabung), `exit_interviews`, `attendances`, `user_scopes` (jumlah akun), `users` (kolom legacy), `operational_records` (`px_recruitment_sla_by_unit.unit`), `settings` (`event_manager_directorates`). Divisi: `survey_responses`, `exit_interviews`, `attendances`, `user_scopes`, `users`.

**Kode error**

| Status | Kapan |
| :--- | :--- |
| 400 | Nama tidak valid (lihat aturan), `divisions` bukan list, `division`/`name` wajib tidak ada, `target_id` kosong, merge ke diri sendiri, *former name* = nama direktorat/divisi aktif |
| 404 | Id tidak dikenal atau bukan bilangan bulat positif persis (`dirNames.parseDirectoryId`: `" 853"`, `"853 "`, `"0853"`, `"+853"`, `"853.0"` -> 404), divisi / former name tidak ada |
| 409 | Masih dirujuk data saat hapus (`references` per sumber, `divisions_with_data`); nama sudah jadi former name (di direktorat ini atau lain); orphan perlu konfirmasi (`requires_confirmation: true`, `orphan_references`); bentrok perubahan paralel / UNIQUE ("That name is already in use ..."); deadlock dicoba ulang sekali, kedua kalinya 409 |
| 500 | Error database lain: dicatat di log server, klien hanya menerima "The directory change failed on the server; nothing was changed. ..." |

**Aturan nama** (`server/db/directoryNames.js`, dipakai kedua backend dan service impor): `cleanName` = Unicode NFC + setiap rangkaian spasi (termasuk non-breaking / ideografik) jadi satu spasi + trim; ditolak bila kosong, berisi karakter format tak terlihat (`\p{Cf}`) atau kontrol, hanya titik, lebih dari `NAME_MAX_LENGTH` = 200, sama dengan nilai cadangan (`RESERVED_DIRECTORATE_NAMES` = `ALL`, `Bankwide`, `General`, `-`; divisi: `ALL`, `General`, `-`), direktorat diawali "PT Bank CIMB Niaga" (`BANKWIDE_PATTERN`), atau sudah dipakai (tanpa membedakan huruf besar/kecil; rename ke ejaan lain dari nama sendiri boleh). Rename yang hanya mengubah huruf besar/kecil mengubah ejaan di semua data tanpa menambah former name.

**Cascade** (`cascadeDirectorate`, satu transaksi): `px_survey_uploaded_responses.org_unit_1` (hanya `respondent_type = 'EMPLOYEE'`), `px_ess_results.directorate` (`org_level = 'DIRECTORATE'`; bila tujuan sudah punya baris metrik+periode yang sama -> `poolEssResults`: index dan skor pertanyaan berbobot partisipasi, partisipasi dijumlah), `px_exit_interviews.directorate`, `px_attendances.directorate`, `px_users.directorate` (legacy), `px_recruitment_sla_by_unit.unit`, `px_user_scopes` (ditulis ulang per akun), setting `event_manager_directorates`. Rename divisi: kolom divisi tabel yang sama (`org_unit_2`, `division`) + cakupan divisi. Tidak diubah: `px_audit_log`, file upload asli, CSV evidence. Former name: nama lama -> nama saat ini, alias lama ikut dipindah ke nama baru (rantai selalu satu langkah); nama yang dipakai lagi oleh direktorat baru dilepas dari alias (`released_alias_of`). Hapus direktorat menghapus divisinya (FK cascade) dan former name-nya. Merge: divisi bernama sama (tanpa membedakan huruf) digabung ke ejaan tujuan, divisi lain dipindah; cakupan "semua divisi" sumber menjadi "semua divisi" tujuan (`widened: true` di pratinjau), daftar divisi tetap daftar itu.

**Orphan**: create / rename / former name ke nama yang sudah dibawa baris data tapi bukan direktorat master -> 409 `requires_confirmation` (tidak ada yang berubah); `confirm_adopt: true` -> baris itu diadopsi dan ditulis ulang ke ejaan master direktorat dan divisinya (`adoptOrphanSpelling`).

**Resolver nama lama** (`buildResolver` / `loadResolver(storage)`): nama saat ini, former name (huruf/spasi bebas), former name divisi, dan pengetahuan rename seed `SEED_DIRECTORATE_RENAMES` dua arah (database yang belum di-rename tetap cocok dengan ejaan baru seed dan sebaliknya). Dipakai: `essSummaryService` (kolom A), `exitInterviewService` (direktorat + divisi), `surveyImportService` (respons EMPLOYEE; metrik 2 dan 5 tidak), `POST /api/events/:id/attendance` (check-in publik), top-up seed, dan `migrateDirectorates()` v2.31.0 (`opts.mapTarget` / `opts.isCurrent`: target lama dipetakan ke nama saat ini, nama yang masih ada di master tidak pernah dianggap nama demo lama).

**`directory_admin_managed`** (`px_app_settings`, seed `false`): diset `true` oleh setiap perubahan lewat endpoint di atas (`markDirectoryManaged`); sejak itu `topUpDirectory()` tidak menambah apa pun. `PUT /api/admin/settings/directory_admin_managed` -> 400. "Reset Default" (`POST /api/admin/parameters/reset`) tidak lagi menghapus / mengisi ulang `px_directorates` / `px_divisions`.

**`GET /api/directorates`**: setiap entri kini juga memuat `directorate_id` (selain `directorate_name`, `name`, `divisions`, `sub_directorates`).

**`GET /api/metrics/by-directorate`**: field baru `has_own_data` = ada metrik SURVEY berdata yang bukan nilai bankwide (baris SYSTEM atau hasil ESS direktorat itu). `false` -> `px_index`, `survey_index`, `outcome_index` `null`, `px_index_basis` `NONE`, `critical_count`/`warning_count` 0. Server tetap mengurutkan PX tertinggi dulu (null di bawah); UI mengurutkan abjad. **Urutan daftar direktori (putaran akhir v2.51.0)**: `GET /api/directorates`, `GET /api/admin/directorates`, `GET /api/admin/parameters` dan template ESS mengirim direktorat dan divisinya urut abjad (`localeCompare`, `sensitivity: 'base'`; template ESS: baris Bankwide pertama). Storage baru `compareConfiguration(snap)` (read-only, `{ differing_tables, extra_metrics, missing_metrics }`) dipakai suite untuk snapshot sisa; `restoreConfiguration` satu transaksi + `removed_ess_files` (`docs/05` "Catatan v2.51.0"). `GET /api/metrics/calculate?directorate=` tidak berubah.

**Audit parameter (baru)**

| Endpoint | Aksi | Isi `target` |
| :--- | :--- | :--- |
| `POST /api/admin/metrics` | `METRIC_CREATE` | `#<id> "<nama>" (<tipe> / <survey_source>)` |
| `PUT /api/admin/metrics/:id` | `METRIC_UPDATE` | `#<id>: <field> <lama> -> <baru>; ...` (tanpa `metric_weight`, `target_value_normalized`; nilai dipotong 60 karakter) |
| `POST /api/metrics/weights` | `METRIC_UPDATE` | `#<id> weight <lama> -> <baru>; ...` |
| `DELETE /api/admin/metrics/:id` | `METRIC_DELETE` | `#<id> "<nama>" (with its survey data, ESS results and uploads)` |
| `POST`/`PUT`/`DELETE /api/admin/journeys[/:id]` | `JOURNEY_CREATE`/`UPDATE`/`DELETE` | sama (field lama -> baru untuk update) |
| `POST /api/admin/parameters/reset` | `PARAMETERS_RESET` | jumlah journey / checkpoint / metrik |
| `POST /api/admin/targets`, `/targets/reset` | `METRIC_TARGETS_UPDATE` / `METRIC_TARGETS_RESET` | per metrik field lama -> baru / jumlah metrik |
| `POST /api/admin/survey-questions/:metric_id[/reset]` | `SURVEY_QUESTIONS_UPDATE` / `SURVEY_QUESTIONS_RESET` | jumlah pertanyaan lama -> baru, key yang berubah / ditambah / dihapus, "order changed" |
| `PUT /api/admin/email-settings` | `SETTINGS_CHANGE` | `email_settings: <field> <lama> -> <baru>; ...` dari nilai publik; password hanya "password replaced" / "password cleared" |

Teks dipotong `auth.audit` di batas 190 karakter. Penolakan (403/400/404) tidak menulis audit. Tidak diaudit: action library, master questions (`POST /api/questions/master`), `/api/metrics/score`; tidak ada route checkpoint.

**Snapshot konfigurasi (storage, untuk config guard suite)**: `snapshotConfiguration()` -> `{ kind: 'px-config-snapshot', version: 1, backend, server, database, taken_at, tables }` (SQL: baris mentah 12 tabel `CONFIG_TABLES` = `px_journeys`, `px_checkpoints`, `px_metrics`, `px_metric_targets`, `px_survey_questions`, `px_master_survey_questions`, `px_action_library`, `px_app_settings`, `px_directorates`, `px_divisions`, `px_directorate_aliases`, `px_division_aliases`; JSON: key `CONFIG_KEYS` yang setara). `restoreConfiguration(snap)`: menolak snapshot backend/server/database lain; menghapus metrik yang tidak ada di snapshot beserta datanya (cascade hapus metrik); dalam satu transaksi menulis ulang hanya tabel yang berbeda (id dipertahankan, `IDENTITY_INSERT`); mengembalikan `{ removed_metrics, restored_tables }`. Tidak ada endpoint untuk ini.

**Template pertanyaan ESS**: `metricQuestionService.DEFAULT_METRIC_QUESTIONS` untuk metrik 9, 13, 15, 16, 17, 18, 21, 22, 24, 25, 27 = kolom pertanyaan file `(ESS 2025 Result) <metrik>.xlsx` (metrik 9: `ESS 2025 Result_Role Clarity & DS Support.xlsx`), urut kolom, tipe `PERCENTAGE`, key `q<n>_<slug>`. Dipakai seed dan `POST /api/admin/survey-questions/:metric_id/reset`; pertanyaan yang sudah tersimpan tidak diubah otomatis. Daftar teks: `docs/06` bagian "Pertanyaan template ESS (v2.51.0)".

---

## Catatan v2.50.0 - Pertanyaan ESS dari Manage Questions, Tipe PERCENTAGE, ESS Carry-Forward & Snapshot Pertanyaan

**Ringkasan**: (1) pertanyaan ESS di template dan web = pertanyaan Manage Questions, kolom file dipetakan menurut posisi; (2) tipe pertanyaan baru `PERCENTAGE` (semua pertanyaan ESS); (3) nilai ESS = hasil terakhir pada/sebelum akhir periode (*carry-forward*, menggantikan aturan bulan-template v2.37.0); (4) setiap upload menyimpan set pertanyaannya, dan detail/evidence memakai teks yang berlaku saat data dikirim. Tidak ada endpoint atau env baru; kolom baru `px_survey_uploads.questions_snapshot_json` (`docs/08` §23); opsi baru `PERCENTAGE` di setting `question_types`. `/api/health` `version` = `2.50.0`. Angka sebelum/sesudah: `CHANGELOG.md` [2.50.0]. Pengujian: `docs/07` §39 (Modul 52).

**Aturan**

| Aspek | Perilaku |
| :--- | :--- |
| Pertanyaan ESS | `essSummaryService.configuredEssQuestions(metricId)` = pertanyaan metrik yang bukan `FREE_TEXT`, urut tampilan Manage Questions. Dipakai template (`generateEssTemplateXlsx`), validasi upload dan detail (`buildEssDetail`). |
| Pemetaan kolom file ESS | Kolom G = pertanyaan 1, H = pertanyaan 2, dst. Teks header file tidak dipakai untuk pemetaan maupun tampilan; disimpan sebagai `file_label`. Hasil lama (`[{label, score}]`) dipetakan menurut posisi saat dibaca, tanpa migrasi. `poolRows` menggabungkan skor pertanyaan per posisi (dulu per label). |
| Jumlah kolom | Kolom pertanyaan = G s.d. kolom terakhir yang berisi nilai di baris data mana pun. Tidak sama dengan jumlah pertanyaan terkonfigurasi -> error `row_number` 1, kolom `G-<huruf>` (atau `G`), pesan "The file has N question column(s) with values (G-X), but M question(s) are configured for this metric in Manage Questions. Column G must hold question 1, H question 2, and so on - download the current template." -> seluruh file 400, tidak ada yang tersimpan. Error lama "Column X has a value but no question text in row 1" dihapus. |
| Periode ESS | `essPeriodEndKey(period)`: MTD Y-M -> Y-M (`null` bila bulan itu setelah bulan berjalan); YTD Y -> Y-`ytdEndMonth` (`null` untuk tahun depan). `selectEssResult` memakai hasil dengan (tahun, bulan) terbesar yang <= batas itu, dari tahun mana pun; `null` -> `NO_DATA`. `carried_forward` = MTD: bulan hasil != bulan terpilih; YTD: tahun hasil != tahun terpilih. Metrik SYSTEM tidak berubah. |
| `PERCENTAGE` | `QUESTION_TYPES.PERCENTAGE` (`metricQuestionService.js`), label "Percentage (0–100%)". Default kode 11 metrik ESS kini `PERCENTAGE`. CSV SYSTEM (`processSurveyCsv`): nilai 0-100, akhiran `%` dan koma desimal diterima, dipakai apa adanya; bukan angka atau di luar 0-100 -> baris ditolak; kosong boleh bila pertanyaan tidak wajib. Template CSV: petunjuk `[<label>: Persentase 0-100]`, contoh 92 / 88 / 85. Detail survei: `max` 100, `avg_score` = rata-rata 0-100, `normalized_score` = `avg_score`. |
| Snapshot | `metricQuestionService.snapshotQuestions(questions)` -> `[{ key, label, text, type, order }]`. CSV SYSTEM: `questions_snapshot = { "<metric_id>": [...] }` untuk setiap metrik di batch; ESS: `{ "<metric_id>": [...] }` di upload + `{ key, label, text, type, order, file_label, score }` per pertanyaan di setiap baris `px_ess_results`. Data dari sebelum v2.50.0 tidak di-backfill (`questions_snapshot` `null`). Template selalu memakai konfigurasi saat ini. |

**Endpoint yang berubah**

| Endpoint | Perubahan |
| :--- | :--- |
| `POST /api/surveys/upload` (ESS `.xlsx`) | Validasi jumlah kolom di atas. Respons: `question_labels` = teks terkonfigurasi, baru `file_question_labels` = header file per posisi (`null` bila kosong). Upload menyimpan `questions_snapshot`. |
| `POST /api/surveys/upload` (CSV SYSTEM) | Validasi `PERCENTAGE`; batch menyimpan `questions_snapshot`. |
| `GET /api/surveys/template` | ESS: header = pertanyaan terkonfigurasi (sudah begitu; kini juga sumber tampilan web). CSV: petunjuk `PERCENTAGE`. |
| `GET /api/surveys/evidence?metric_id=<id>` | `generateSurveyEvidence` / `generateEssEvidence` (dulu `generateSurveyEvidenceCsv` / `generateEssEvidenceCsv`) mengembalikan `{ kind: 'csv', content }` atau `{ kind: 'zip', buffer, fileName }`. Baris dikelompokkan per versi set pertanyaan (`evidenceVersions.groupByQuestionSet`, identitas = urutan + key + label + teks + tipe). Satu versi -> CSV seperti sebelumnya (`text/csv`, nama file lama). Lebih dari satu -> `application/zip`, `<nama dasar>.zip` (mis. `Evidence_Survey_Metric_8_2026.zip`, `Evidence_ESS_Summary_Metric_9.zip`) berisi satu CSV per versi (`<nama dasar>_v<n>_<dari>_to_<sampai>.csv`, versi 1 = tertua) + `README.txt`. Sumber versi: `SNAPSHOT`, `FILE_HEADER` (baris ESS lama: teks header file), `CURRENT_CONFIG` (batch SYSTEM lama: konfigurasi saat ini). Header CSV SYSTEM tetap `<key>_<label>`; CSV ESS memakai teks pertanyaan. `metric_id=ALL` selalu satu CSV. Aturan akses/PIC tidak berubah. |
| `GET /api/surveys/history` | Setiap batch memuat `questions_snapshot` (`null` untuk upload lama). |
| `POST /api/admin/survey-questions/:metric_id` | Metrik ESS: setiap pertanyaan disimpan bertipe `PERCENTAGE` apa pun yang dikirim. |
| `GET /api/settings` | `question_types` memuat `{ value: 'PERCENTAGE', label: 'Percentage (0–100%)' }`. |
| `GET /api/metrics/calculate` (dan titik `/trends`) | Metrik ESS: `period_window = { from, to, basis: 'LATEST_RESULT' }` (from/to = jendela yang dipilih), field baru `ess_carried_forward`. |
| `GET /api/metrics/:id/detail` | Field baru di bawah. |

**Field detail baru / berubah**

| Field | Jalur | Arti |
| :--- | :--- | :--- |
| `ess_carried_forward` | detail ESS (juga `metrics[]` calculate) | `true` bila hasil yang dipakai sebelum periode terpilih |
| `ess_summary.description` | detail ESS | ditambah " (latest available)" bila carried |
| `question_text_source` | detail ESS | `SNAPSHOT` (hasil menyimpan set pertanyaannya) / `CURRENT_CONFIG` (hasil sebelum v2.50.0) |
| `questions_changed_since_upload` | detail survei dan ESS | Survei: ada upload dari respons periode itu yang snapshot-nya berbeda teks, jumlah pertanyaan atau key (`previousQuestionTexts`). ESS: hasil punya snapshot dan jumlah atau teks berbeda. Upload tanpa snapshot tidak pernah memicu flag ini |
| `questions_breakdown[].original_texts`, `.text_changed` | detail survei dan ESS | teks lama (berbeda dari teks saat ini, setelah normalisasi) per key; `text_changed` = ada teks lama |
| `questions_breakdown[].original_text`, `.file_label` | detail ESS | teks snapshot (`null` tanpa snapshot); header file |
| `questions_breakdown[].type` | detail ESS | `PERCENTAGE` (dulu `ESS_PERCENT`); `key`/`label`/`dimension`/visible/required dari Manage Questions |
| `ess_results_by_directorate[].questions[].label` | detail ESS | teks terkonfigurasi menurut posisi (tidak dipakai UI sejak v2.34.0) |

**Boot (`storage.init`)**: SQL menjalankan `topUpOptionLabels` -> `topUpAddedOptions` (baru, menambahkan opsi `ADDED_OPTION_VALUES` = `PERCENTAGE` ke `question_types` bila belum ada; label lain tidak disentuh) -> `topUpDirectory` -> `topUpMetricUnits` -> `topUpSurveySource` -> `enforceEssManualUpload` -> `enforceEssPercentageQuestions` (baru, `UPDATE` pertanyaan metrik ESS yang belum `PERCENTAGE`; database utama: 38 baris pada boot pertama) -> `cleanupRemovedEssDummySeed` (baru, lihat `docs/08` §23). JSON: langkah yang sama saat `store.json` dimuat. Metrik ESS baru (SQL `createMetric`) mendapat pertanyaan default bertipe `PERCENTAGE`; di JSON tidak (tampil `SCALE_1_5` sampai pertanyaannya disimpan).

**Storage (kedua backend)**: `getSurveyUploads()` mengirim `questions_snapshot` (objek atau `null`); `saveSurveyUploadBatch(batchData, ...)` dan `saveEssResultUpload(meta, rows)` menerima `questions_snapshot`; import `store.json` (`migrate.js`) dan `npm run db:export` ikut membawanya.

**`server/services/evidenceVersions.js` (baru)**: `questionSetSignature`, `groupByQuestionSet(items, versionOf)`, `buildVersionedZip({ baseName, title, versions })` (pakai `jszip`), `SOURCE_NOTES`.

---

## Catatan v2.49.0 - Akses Menu per User (`menu_access`)

**Kontrak** (`server/db/menuAccess.js`, dipakai `sqlStorage.js`, `jsonStorage.js`, `authService.js`)

| Aspek | Perilaku |
| :--- | :--- |
| Key | `dashboard`, `explore`, `exit_interview`, `action_library`, `events`, `about` (`MENU_KEYS`) |
| Default USER | semua `true` kecuali `events` (`DEFAULT_USER_MENU_ACCESS`); berlaku juga untuk USER yang sudah ada (kolom NULL) |
| ADMIN | selalu semua `true` (`effectiveMenuAccess()` mengabaikan nilai tersimpan) |
| Simpan | SQL `px_users.menu_access NVARCHAR(400) NULL` berisi JSON; backend JSON field `menu_access` di `auth.json`; `null` = default. Key tak dikenal / nilai bukan boolean di data tersimpan diabaikan saat dibaca |
| Respons | setiap objek user (`POST /api/auth/login`, `GET /api/auth/me`, `GET /api/admin/users`, respons `POST`/`PUT /api/admin/users`) memuat `menu_access` = map lengkap 6 key. `permissions.can_manage_events` = `hasMenu(user, 'events')` |
| Input | `POST /api/admin/users` dan `PUT /api/admin/users/:id` menerima `menu_access` parsial: key yang dikirim harus salah satu key di atas dengan nilai `true`/`false`; key yang tidak dikirim tetap; `null` = kembali ke default. Bukan objek, array, key tak dikenal, nilai bukan boolean -> 400, tidak ada yang tersimpan. ADMIN: `false` apa pun -> 400; semua `true` diterima dan diabaikan. USER tidak bisa mengubah menu (`/api/admin/*` -> 403); tanpa sesi 401 |
| Audit | `USER_CREATE` (USER: `...; menus: dashboard, explore, ...`), `USER_UPDATE` (field `menu_access` disebut) + `USER_MENU_ACCESS_CHANGE` bila ada yang berubah, target mis. `<username>: events:off->on`. Ditandai `is_test` bila akun tes terlibat |
| Berlaku | akun dibaca ulang dari database setiap request -> perubahan berlaku pada request berikutnya, tanpa mematikan sesi |

**Gerbang** `authService.requireMenu(key)`: tanpa sesi 401 `AUTH_REQUIRED`; ADMIN lolos; USER tanpa menu -> **403** `{ error: "Your account has no access to the <label menu, mis. Signature Program Events> menu. Contact an Admin.", code: "MENU_ACCESS_DENIED", menu: "<key>" }`. `requireEventManager` = `requireMenu('events')`.

| Menu | Yang digate di server |
| :--- | :--- |
| `events` | `GET`/`POST /api/events`, `GET`/`DELETE /api/events/:id`, `POST /api/events/:id/questions`, `DELETE /api/events/:id/attendance/:nip`, `DELETE /api/events/:id/feedback/:nip`, `POST /api/events/:id/media`, `POST /api/media/:id/transcribe`, `POST /api/media/:id/summarize`, `DELETE /api/media/:id`, `POST /api/events/:id/generate-ppt`, `GET /api/reports/download/:fileName`, `GET /api/questions/master` (baru digate; `POST` tetap Admin saja), `GET /api/qrcode` (baru digate), static `/uploads/*` (baru digate; folder ini hanya berisi media event) dan `/exports/*` |
| `exit_interview` | semua `/api/exit-interview/*` (`app.use`); `template`, `upload`, `uploads`, `export` tetap Admin saja |
| `action_library` | `GET /api/action-library` |
| `dashboard`, `explore`, `about` | tidak ada (UI saja): `/api/metrics/calculate`, `/trends`, `/:id/detail`, `/by-directorate` dan `/api/alerts` tetap menjawab user login dalam cakupannya. `/api/alerts` sengaja tidak digate karena dipakai Dashboard |

Tetap publik (tanpa login, tanpa menu): `GET /api/events/by-code/:code`, `POST /api/events/:id/attendance`, `POST /api/events/:id/feedback` (form check-in/feedback QR), di samping `GET /api/health`, `POST /api/auth/login`, `GET /api/directorates` (`PUBLIC_ROUTES` tidak berubah).

**Hak event berubah**: USER dengan `events` = pengelola event lama (lihat + kelola). `GET /api/events` dan `GET /api/events/:id` kini selalu mengirim data lengkap (`pre_event_code`/`post_event_code`, absensi/feedback semua peserta dengan identitas); helper `eventRowsForViewer` dan `hideEventCodes` dihapus. Tanpa `events` -> 403 di semua rute event, termasuk baca. `isEventManager(user)` = `hasMenu(user, 'events')`; `getAuthSettings()` tidak lagi membaca `event_manager_directorates`. Pernyataan di "Catatan v2.26.0" dan "Catatan v2.27.0" tentang tampilan event baca-saja dan pengelola event per direktorat tidak berlaku lagi.

**Upgrade**: `migrateEventManagerMenuAccess({ onlyUserIds })` (SQL: sekali pada boot yang menambah kolom; JSON: logika sama saat `auth.json` dimuat, untuk akun tanpa field `menu_access`; fungsi diekspos di kedua storage untuk tes): USER dengan `menu_access` NULL yang cakupannya memuat direktorat di `event_manager_directorates` mendapat `{ ...default, events: true }`; yang lain tetap NULL. Mengembalikan jumlah akun yang diubah; idempoten; pilihan eksplisit tidak ditimpa. Log `[sqlStorage] Menu access: N User account(s) ...`. Database utama: 0 akun.

`/api/health` `version` = `2.49.0`. Tidak ada endpoint, tabel, setting, atau env baru. Pengujian: `docs/07` §38 (Modul 51).

## Catatan v2.48.0 - Bobot PX Index, PX Index per Direktorat & Metrik Non-Karyawan Bernilai Bankwide

**Setting `px_index_weights`** (`px_app_settings`; seed `{ "survey": 70, "outcome": 30 }`, disisipkan sekali bila key belum ada - SQL `seedAppSettings()`, JSON backfill dari `initialAppSettings` saat load; tidak pernah menimpa nilai admin)

| Aspek | Perilaku |
| :--- | :--- |
| Ubah | `PUT /api/admin/settings/px_index_weights`, body `{ "value": { "survey": 60, "outcome": 40 } }`; Admin saja (User 403, tanpa sesi 401). Respons `{ key, value }` |
| Validasi | `pxWeightsError()` (`calculationEngine.js`, dipakai route): objek `{ survey, outcome }`, keduanya bilangan bulat 0-100, jumlah 100; selain itu 400 dan setting tidak berubah |
| Audit | `SETTINGS_CHANGE`, target mis. `px_index_weights: 70/30 -> 60/40` |
| Baca | `getPxWeights()`: cache 30 detik per proses (`PX_WEIGHTS_CACHE_MS`); PUT memanggil `clearPxWeightsCache()` di proses itu; backend lain pada database yang sama memakai nilai baru dalam <= 30 detik. Nilai tersimpan hilang/tidak valid -> 70/30 |
| Dipakai | PX Index (`px_index_basis = BOTH`: bobot Survey x Survey Index + bobot Outcome x Outcome Index) dan skor journey; `SURVEY_ONLY` / `OUTCOME_ONLY` / `NONE` tidak berubah. Bobot per metrik (`weight`, `POST /api/metrics/weights`) tidak terkait |
| UI | Dibaca dari `GET /api/settings` (`px_index_weights`) dan dari `px_weights` di respons kalkulasi |

**Field respons baru / berubah**

| Endpoint | Field | Isi |
| :--- | :--- | :--- |
| `GET /api/metrics/calculate` | `px_weights` | `{ survey, outcome }` yang dipakai kalkulasi ini |
| | `weights_formula` | dinamis, mis. `70% Survey + 30% Outcomes (Normalized across active metrics)` |
| | `bankwide_value_metrics_count` | jumlah metrik `is_bankwide_value` |
| | `metrics[].is_bankwide_value` | `true` = metrik non-karyawan dibaca pada nilai bankwide karena filter direktorat/divisi/cakupan aktif (`docs/01` §6.1) |
| | `metrics[].is_disabled`, `excluded_from_index`, `disabled_reason` | tetap dikirim untuk kompatibilitas, selalu `false` / `false` / `null`; `disabled_metrics_count` karenanya 0 |
| `GET /api/metrics/:id/detail` | `px_weights`, `is_bankwide_value` | metrik non-karyawan di bawah filter: `getMetricDetail()` mereset filter ke bankwide (`is_bankwide_value: true`, jumlah responden = bankwide). Override khusus User di route ini (sampai v2.47.0) dihapus |
| `GET /api/alerts` | `is_bankwide_readonly` | kini dari `is_bankwide_value` metrik; komentar verbatim metrik itu diambil bankwide |

Opsi `bankwideReadOnly` dihapus dari `calculatePEIndex()` dan `getAlertsAndRecommendations()` serta pemanggilnya di `/api/metrics/calculate` dan `/api/alerts`; Admin dan User mendapat aturan yang sama.

**`GET /api/metrics/by-directorate`** (butuh login; tanpa sesi 401)

- Query: `mode=YTD|MTD` (default YTD), `year` (4 digit, default tahun berjalan), `month` (1-12, default `01`, dipakai untuk MTD). Periode dibentuk sama seperti `/api/metrics/calculate`.
- Daftar: Admin = semua direktorat master (`storage.getDirectorates()`, 12); User = direktorat dalam `scopes`-nya (`normalizeScopes`). `?directorate` tidak dibaca, jadi direktorat di luar cakupan tidak pernah dihitung.
- Per direktorat: `auth.resolveScope(user, nama, 'ALL')` lalu `calculatePEIndex({ ...periode, directorate, sub_directorate, scopes }, { skipTrends: true })`; `syncLiveEventMetrics()` dipanggil sekali di awal. Hasil = `GET /api/metrics/calculate?directorate=<nama>` untuk user itu (User dengan sebagian divisi: hanya divisi itu).
- Respons: `{ mode, year, month (null untuk YTD), px_weights, directorates: [...] }`; tiap entri: `directorate`, `divisions` (User dengan subset divisi: daftar divisinya; selain itu `null`), `px_index`, `survey_index`, `outcome_index`, `px_index_basis`, `active_metrics_count`, `no_data_metrics_count`, `critical_count`, `warning_count`, `px_weights`.
- Urutan: PX Index tertinggi dulu, `px_index` `null` paling bawah, seri -> nama direktorat. Waktu ~140-160 ms (laporan developer). Error -> 500 `Failed to calculate the PX Index by directorate`.

`/api/health` `version` = `2.48.0`. Tidak ada tabel, kolom, atau env baru. Pengujian: `docs/07` §37 (Modul 50).

## Catatan v2.44.0 - Auto sign-out saat idle

Setting `session_idle_timeout_minutes` (1-120, default 5; `NUMERIC_SETTINGS`). `px_sessions.last_activity_at` diperbarui HANYA oleh login dan `POST /api/auth/activity` (butuh sesi; juga saat wajib ganti password). Sesi idle -> dihapus + audit `LOGOUT_IDLE` + `401 { reason: 'IDLE_TIMEOUT', code: 'AUTH_REQUIRED', idle_timeout_minutes }`. `idle_timeout_minutes` ada di respons login, `/api/auth/me`, change-password. Logout menerima `{ reason: 'IDLE_TIMEOUT' }`. `PUT /api/admin/settings/:key` mengaudit `SETTINGS_CHANGE` untuk semua key. Storage: `createSession({..., last_activity_at})`, `getSession` mengembalikan `last_activity_at`, `setSessionActivity(token_hash, at)`, `deleteSession` mengembalikan boolean.

## Catatan v2.43.0 - Penandaan entri tes di Audit Trail

`px_users.is_test_account` (hanya bisa diisi kode server lewat `storage.createUser({..., is_test_account: true})`; akun buatan API mewarisi flag admin pembuatnya; tidak bisa diubah lewat API) dan `px_audit_log.is_test` (diisi `authService.audit()` bila akun pelaku atau akun yang dikenai aksi - opsi `subject` - adalah akun tes; tidak pernah dari input request; login gagal username tak dikenal tidak ditandai). `GET /api/admin/audit-log` default mengecualikan `is_test`, `?include_test=1` menyertakannya, setiap baris membawa `is_test`, limit setelah filter. `markHistoricalTestAudit()` (sekali saat upgrade, idempoten; aturan nama `server/db/testAccounts.js`).

## Catatan v2.39.0 - Headline slide 1 Exit Interview

`GET /api/exit-interview/summary` kini juga mengirim `overview_headline` (string) dari `exitInterviewService.buildOverviewHeadline(reasons, pullFactors)`: alasan teratas kartu 1 ("dominate(s) exits" bila >= 40% record voluntary, selain itu "lead(s) exits"; alasan kedua disebut bila selisih <= 5 pp) + faktor teratas kartu 4 tanpa "Other" (>= 40% -> "is the main attraction", selain itu "is the most cited attraction"; tanpa faktor -> klausa dihilangkan); tanpa data -> "No voluntary exit records in this period". Konstanta di service (`REASON_PHRASES`, `PULL_PHRASES`, `HEADLINE_DOMINANT_PCT`, `HEADLINE_RUNNER_UP_PP`). Headline slide 2 (`headline`) kini dari `buildThemesHeadline` (keluaran sama). Tidak ada endpoint/setting/tabel baru.

## Catatan v2.38.0 - Dashboard Exit Interview

**Ringkasan**: dashboard baru "mengapa karyawan resign" dari file HR "Termination Report" `.xlsx` (satu baris per exit) + kolom Directorate/Division. Logika di `server/services/exitInterviewService.js`; tabel `px_exit_interviews` dan `px_exit_interview_uploads` (`docs/08` §18); kamus kolom `docs/02` §5.4; panduan Admin `docs/06`. Pengelompokan jawaban berbasis aturan kata kunci dari `px_app_settings`, **tanpa AI** (on-premise). Data ini tidak dipakai `calculationEngine`/`alertEngine` (skor metrik 26 dan PX Index tidak berubah). `/api/health` `version` = `2.38.0`; tidak ada env baru.

**Endpoint** (semua butuh login; `ADMIN_ONLY` = selain Admin 403)

| Endpoint | Akses | Parameter / perilaku |
| :--- | :--- | :--- |
| `GET /api/exit-interview/summary` | semua login (sejak v2.49.0: dengan menu `exit_interview`) | `mode=YTD\|MTD` (default YTD), `year` (default tahun berjalan, harus 4 digit), `month` (1-12, wajib untuk MTD), `directorate`, `sub_directorate`. Cakupan lewat `auth.scopeFilter` (USER: direktorat di luar cakupan -> 403; tanpa filter = gabungan cakupannya). Bulan/tahun tidak valid -> 400. Respons: `period` (`label`, `from`, `to`, `last_data_month`, `last_data_label`), `scope.label`, `subtitle`, `counts` (`total_records`, `voluntary_records`, `movers`), `reasons`, `industry`, `top_financial`, `pull_factors`, `career`, `recommend`, `themes_open`, `themes_internal`, `headline`. Hanya agregat: tanpa NIK, nama, atau teks jawaban. Non-Admin: `top_financial` hanya memuat nama dari daftar alias (`unlisted_names_hidden: true`). |
| `GET /api/exit-interview/template` | Admin | `Template_Exit_Interview.xlsx` (sheet "Termination Report": judul, 33 kolom standar + `Directorate`, `Division`, satu baris contoh yang lolos validator). |
| `POST /api/exit-interview/upload` | Admin | `multipart/form-data` field `file`, multer memory storage (tidak pernah ke `/uploads`), maks 20 MB (lebih -> 413). Tanpa file -> 400; ekstensi selain `.xlsx` -> **400** (beda dengan ESS yang 415); workbook rusak atau satu baris salah -> 400 `{ error, errors: [{ row_number, column, reason }] }`, tidak ada yang tersimpan. Sukses -> 200 `{ success, upload_id, file_name, source, rows_imported, inserted_rows, updated_rows, removed_dummy_rows, period_from, period_to, months, message }`. Audit `EXIT_INTERVIEW_UPLOAD` (target: jumlah baris, bulan, batch; tanpa data karyawan). `uploaded_by` = `Nama (username)`. |
| `GET /api/exit-interview/uploads` | Admin | Riwayat batch terbaru dulu (`upload_id`, `file_name`, `source`, `total_rows`, `inserted_rows`, `updated_rows`, `removed_dummy_rows`, `period_from`, `period_to`, `uploaded_by`, `uploaded_at`). |
| `GET /api/exit-interview/export` | Admin | Parameter sama dengan summary; CSV semua baris dalam periode + filter org (`Exit_Interview_<YYYY-MM>.csv` / `Exit_Interview_YTD_<tahun>.csv`), UTF-8 BOM, sel teks berawalan `= + - @` tab/CR diberi `'` (kecuali angka bertanda). Kolom: `docs/02` §5.4. |

**Periode** (`resolveExitPeriod`): jendela sama dengan scorecard (`filterUtils.periodWindow`) pada `effective_date`: YTD tahun berjalan = 1 Januari s.d. akhir bulan berjalan (jam server), tahun lalu = setahun penuh, tahun depan = kosong; MTD = tepat bulan itu. Label mis. `January - October 2026` atau `September 2026`.

**Aturan agregat** (`summarizeExitInterviews`, fungsi murni). Voluntary = `leaving_reason = NORMAL_RESIGNATION`; mover = voluntary dengan `leaving_reason_detail` `MOVE_COMPANY` atau `BETTER_OFFER`.

| Bagian | Basis | Aturan |
| :--- | :--- | :--- |
| `reasons` (kartu 1, kolom E) | voluntary | `MOVE_COMPANY` + `BETTER_OFFER` = "Move company"; kode lain jadi teks ("Own business"); kosong = "Not specified". |
| `industry` (kartu 2, H) | mover yang menjawab H | Financial bila H (dinormalisasi) = "Perbankan / Asuransi / Keuangan Lainnya", selain itu Non-financial. |
| `top_financial` (kartu 3, I) | mover Financial | `standardizeCompany`: alias dengan kata kunci terpanjang yang cocok, selain itu nama apa adanya (spasi dirapikan); 10 teratas; `named` = jumlah yang menyebut nama. |
| `pull_factors` (kartu 4, K) | semua mover | Jawaban dipecah per `\|`; tiap bagian dicocokkan ke `exit_interview_k_factors` (bisa beberapa grup), tidak cocok = Other; jumlah record per opsi; `kpi` = % Compensation. |
| `career` (kartu 5, O..AC) | mover dengan minimal satu skor | Rata-rata per orang, `careerBucket` = pembulatan half-up ke 1..6; `average` (2 desimal), `average_pct` = average/6; `negative` = bucket 1-3, `positive` = 4-6. |
| `recommend` (kartu 6, AF) | mover yang menjawab Yes/No | Yes vs No. |
| `themes_open` (A, M) | mover yang menjawab M | Tema dari `exit_interview_m_themes`, karyawan unik per tema. |
| `themes_internal` (B, N) | mover negatif vs positif (kartu 5) | Tema dari `exit_interview_n_themes`; per tema `negative`/`positive` `{count, pct}` dan `gap_pp`. |
| `headline` | - | "Movers highlight <dua tema A teratas>[; <tema B dengan gap_pp positif terbesar> is the clearest satisfaction gap]". |

Pencocokan kata kunci (`normalizeAnswer`/`hasKeyword`): huruf kecil, setiap rangkaian non huruf/angka jadi satu spasi, kata kunci harus cocok di **awal sebuah kata** (`fleksib` cocok dengan "fleksibilitas", `bri` tidak cocok dengan "fabric"). Jawaban kosong, `-`, atau yang ada di `exit_interview_none_answers` (sama persis; akhiran `*` = diawali frasa itu) dianggap tidak menjawab. Aturan dibaca dari database pada setiap request (`loadRules`; fallback seed hanya bila key hilang), jadi perubahan setting langsung berlaku untuk semua kartu. `new_company_std` yang tersimpan hanya dipakai ekspor.

**Setting baru** (`px_app_settings`, di-seed sekali bila key belum ada, tidak pernah menimpa; ubah lewat `PUT /api/admin/settings/:key` dengan list `{value, label}` tidak kosong; belum ada UI; tidak termasuk setting "hanya label")

| Key | Isi |
| :--- | :--- |
| `exit_interview_k_factors` | kata kunci kolom K -> Compensation / Position / Job / Reputation |
| `exit_interview_m_themes` | kata kunci kolom M -> 6 tema (Compensation & benefits, Higher position, Better-fit job, Company reputation, Location / commute, Family & personal) |
| `exit_interview_n_themes` | kata kunci kolom N -> 7 tema (Career progression & certainty, Compensation & recognition, Leadership, fairness & voice, Work environment & culture, Learning & development, Processes, tools & facilities, Workload, targets & role fit) |
| `exit_interview_company_aliases` | 36 alias nama perusahaan -> nama legal standar |
| `exit_interview_none_answers` | 18 frasa "tidak menjawab" / "tidak pindah" |

**Validasi & impor** (`validateExitSheet`, `importExitInterviews`): layout dan aturan per kolom di `docs/02` §5.4. Atomik: error apa pun -> tidak ada yang disimpan. Sukses: file asli ditulis ke `server/data/exit-uploads/<upload_id>.xlsx` (`upload_id` = `exit-<ts>-<acak>`), lalu `storage.saveExitInterviewUpload(meta, rows)` dalam satu transaksi: hapus baris `SEED_DUMMY` di bulan-bulan yang ada di file, lalu upsert per `(nik, effective_date)` (SQL: `MERGE` dengan `HOLDLOCK`, NIK dibandingkan menurut collation database - tidak peka huruf besar/kecil menurut laporan developer, collation tidak diperiksa penulis; JSON: NIK lowercase), lalu catat batch. Gagal simpan -> file asli dihapus lagi. Opsi khusus skrip impor template: `assignOrgUnit(rowNumber)` (direktorat bila file tanpa kolom Directorate) dan `surrogateNik` (NIK + `-<nomor baris>`). `exitOriginalFilePath(upload_id)` ada tetapi belum dipakai route mana pun (file asli belum bisa diunduh lewat API).

**Storage (kedua backend, kontrak sama)**: `getExitInterviews({ from, to })`, `getExitInterviewMonthCounts()`, `getExitInterviewUploads()`, `saveExitInterviewUpload(meta, rows)` -> `{ record, inserted, updated, removed_dummy }`, `topUpExitInterviewSeed()` (boot, dan dipakai tes). Boot top-up hanya bila `SEED_DEMO_DATA` bukan `false`: bulan `EXIT_SEED_MONTHS` (Jan-Sep 2026) yang belum punya baris sama sekali mendapat baris `seed.generateExitInterviewDummy()` + batch `seed-exit-<YYYY-MM>` (`uploaded_by` "Seed (dummy)"). Bulan yang sudah punya baris apa pun tidak disentuh.

**`server/services/xlsxUtils.js` (baru)**: `readFirstSheet`, `buildXlsx`, `colLetter`, `colIndex`, `decodeXml`, `xmlEsc` dipindah dari `essSummaryService.js` (tabel "Catatan v2.32.0" di atas masih menyebut fungsi itu di sana; `essSummaryService` tetap mengekspor `readFirstSheet` dan `buildXlsx` sehingga pemanggil lama tidak berubah).

**Skrip**: `npm run exit:import-template -- "<path .xlsx>"` (`scripts/import-exit-template.js`): menjalankan `storage.init()`, lalu impor dengan `source: 'TEMPLATE_IMPORT'`, direktorat/divisi dummy deterministik (`seed.exitDummyOrgUnit`) dan NIK pengganti; mencatat audit `EXIT_INTERVIEW_UPLOAD` dengan username `script:import-exit-template`. Dijalankan ulang = baris yang sama di-update (NIK pengganti sama).

Pengujian: `docs/07` §32 (Modul 47).
