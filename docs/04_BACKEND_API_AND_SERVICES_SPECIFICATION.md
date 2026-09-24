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
│   ├── 📄 alertEngine.js                  # Pemetaan Metrik Defisit ke Inisiatif Aksi + Narasi AI
│   ├── 📄 localAiService.js               # Integrasi Local Ollama (Narasi Alert & Event Summary) + Fallback Rule-Based
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
| `GET` | `/api/health` | Status online server dan identitas sistem | `-` |

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
| `POST` | `/api/admin/metrics` | Menambahkan parameter metrik baru | Body: `{ journey_id, checkpoint_id, metric_name, metric_type, scale_type, target_value, min_threshold, metric_weight, is_employee_metric, target_audience }` |
| `PUT` | `/api/admin/metrics/:id` | Memperbarui parameter metrik, target, threshold, dan bobot | Body: `{ metric_name, target_value, min_threshold, metric_weight, is_employee_metric, target_audience, ... }` |
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
| `POST` | `/api/events/:event_id/generate-ppt` | Menghasilkan dan menyajikan berkas presentasi PowerPoint (.pptx) | Path: `event_id` |

---

### 2.7 Modul Peringatan Kinerja & Rekomendasi Aksi
| Method | Endpoint | Deskripsi | Parameter Query |
| :---: | :--- | :--- | :--- |
| `GET` | `/api/alerts` | Mengambil daftar metrik yang mengalami defisit kinerja beserta rekomendasi inisiatif AI/HR. Setiap alert memuat `narrative_summary` — narasi 1 paragraf yang dihasilkan dinamis via **local Ollama** (`alertEngine.js` → `localAiService.generateAlertNarrative()`); otomatis fallback ke kalimat rule-based deterministik jika Ollama offline, sehingga endpoint ini tidak pernah gagal. | `-` |

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
