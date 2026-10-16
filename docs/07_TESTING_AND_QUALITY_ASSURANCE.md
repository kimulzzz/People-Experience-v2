# 07. Testing & Quality Assurance
**CIMB Niaga People Experience (PX) Framework**

---

## 🧪 1. Strategi & Standar Pengujian Kualitas

Untuk menjamin akurasi komputasi finansial/HR perbankan, kepatuhan arsitektur, dan stabilitas operasional, sistem People Experience menerapkan **Automated Regression Testing Suite** yang mencakup seluruh lapisan komputasi mulai dari parsing file, validasi tipe data, normalisasi skor multi-tipe, hingga generasi berkas ekspor```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│              CIMB NIAGA PEOPLE EXPERIENCE - REGRESSION TEST SUITE                      │
├──────────────────────────┬─────────────────────────────┬───────────────────────────────┤
│    41 MODUL PENGUJIAN    │     251 AUTOMATED TESTS     │       100% PASS RATE          │
└──────────────────────────┴─────────────────────────────┴───────────────────────────────┘
```

---

## 📋 2. Rincian 27 Modul & 94 Skenario Pengujian

### 📦 Modul 1: Calculation Engine & Period Filtering (3 Test Cases)
1. **System Health Endpoint**: Memvalidasi status online server dan identitas sistem (`GET /api/health`).
2. **Formula PX Index YTD (Default)**: Memverifikasi kebenaran matematis formula $\text{PX Index} = 0.70 \times \text{Survey} + 0.30 \times \text{Outcome}$, serta menghitung 27 metrik, 17 checkpoint, dan 5 journey.
3. **Monthly Period Filtering**: Memverifikasi isolasi filter bulan spesifik (`2026-01` vs `2026-02`).

### 📦 Modul 2: Monthly Trends & Progression Engine (1 Test Case)
4. **Progression Series Hanya Bulan Lengkap**: Memvalidasi endpoint `/api/metrics/trends` mengembalikan tepat `last_complete_month` titik data (Januari s/d bulan lengkap terakhir — bukan selalu 12 bulan) dengan nilai PX Index, Survey Index, dan Outcome Index.

### 📦 Modul 3: Metric Question Drilldown & Respondent Analysis (1 Test Case)
5. **Drilldown Detail Metrik #8**: Memverifikasi breakdown butir pertanyaan, teks soal, rata-rata skor per pertanyaan, dan rekaman data koresponden.

### 📦 Modul 4: Question-Based Survey Template Generator (2 Test Cases)
6. **Dynamic Template Specific Metric**: Menguji unduhan berkas template CSV dengan header kolom dinamis sesuai tipe pertanyaan metrik terkait.
7. **Master All-Surveys Template**: Menguji generasi berkas template master untuk seluruh 20 metrik survei.

### 📦 Modul 5: Question-Based Survey CSV Import & Live Recalculation (1 Test Case)
8. **Bulk CSV Upload & Live Recalc**: Menguji impor berkas CSV multi-baris, validasi NIP, dan memastikan skor ter-update secara otomatis.

### 📦 Modul 5b: Survey Evidence Export & Audit Trail (2 Test Cases)
9. **Single Metric Evidence Export**: Memverifikasi format CSV berstempel tanggal, NIP, kolom butir soal, dan komentar verbatim.
10. **Master Evidence Export**: Memverifikasi unduhan master bukti audit untuk seluruh metrik survei sekaligus.

### 📦 Modul 6: Admin Target & Ambang Batas Settings (2 Test Cases)
11. **Admin Fetch Targets**: Memverifikasi ketersediaan konfigurasi target untuk 27 metrik.
12. **Admin Update Targets**: Menguji pembaruan nilai target dan ambang batas toleransi (`POST /api/admin/targets`) serta memverifikasi dampaknya pada engine kalkulasi.

### 📦 Modul 7: Alert Engine & Verbatim Action Recommendations (1 Test Case)
13. **Deficit Alert to Action Library Mapping**: Memverifikasi deteksi metrik di bawah target dan pemetaannya ke pustaka aksi rekomendasi solusi.

### 📦 Modul 8: Signature Program Events & PowerPoint Export (2 Test Cases)
14. **Event Attendance & Feedback**: Menguji pencatatan absensi peserta dan submit evaluasi event ke event nyata `ev-perspektif-2024-q1`. Sejak v2.14.1, dibungkus `try/finally` yang menghapus kembali absensi & feedback yang dibuat (via `DELETE /api/events/:id/attendance/:nip` dan `DELETE /api/events/:id/feedback/:nip`) sehingga test ini **idempoten** — tidak lagi meninggalkan data "Test Participant" palsu di menu Signature Program Event setiap kali suite dijalankan.
15. **PowerPoint Corporate Deck Generation**: Memvalidasi kompilasi otomatis file presentasi `.pptx` siap pakai.

### 📦 Modul 9: Outcome vs Survey Metrics Separation & Validation (3 Test Cases)
16. **Outcome Metric #11 Validation**: Memverifikasi metrik Kehadiran Event adalah data HR Internal dengan `total_respondents: null`.
17. **Outcome Metric #1 Validation**: Memverifikasi metrik SLA Rekrutmen memuat log operasional departemen.
18. **Survey Metric #5 Validation**: Memverifikasi metrik survei murni memiliki `total_respondents > 0` dan `questions_breakdown`.

### 📦 Modul 10: Admin Survey Questions & Multi-Type Questions Engine (5 Test Cases)
19. **Admin Fetch Survey Questions**: Mengambil daftar pertanyaan untuk 20 metrik survei.
20. **Metric #7 15-Questions Structure**: Memverifikasi struktur resmi 15 pertanyaan Metrik #7 (Q1–Q5 bertipe `SCALE_1_5` dan Q6–Q15 bertipe `YES_NO`).
21. **Metric #7 CSV Template Generator**: Memverifikasi template CSV memuat ke-15 kolom pertanyaan dan petunjuk format nilai.
22. **Mixed Multi-Type CSV Upload**: Menguji impor respon campuran Skala 1-5 dan Ya/Tidak (dengan konversi Ya = 100, Tidak = 0).
23. **Admin Custom Question Update & Reset**: Menguji pengeditan butir soal kustom dan tombol reset kembali ke 15 pertanyaan standar.

### 📦 Modul 11: ESS Dimensions & Summary Scores for All 11 Metrics (11 Test Cases)
24. **ESS Metric #9 (Role Clarity & DS Support Score Index)**: Dimensi *Employee Commitment*, 3 questions, `visible_based_on: Always`, `required_based_on: Always`.
25. **ESS Metric #13 (Pride & Work Environment Index)**: Dimensi *Pride & Work Environment*, 4 questions.
26. **ESS Metric #15 (Manager Recognition Index)**: Dimensi *Recognition & Appreciation*, 3 questions.
27. **ESS Metric #16 (Wellbeing Index)**: Dimensi *Employee Wellbeing*, 3 questions.
28. **ESS Metric #17 (Psychological Safety Index)**: Dimensi *Psychological Safety & Risk Mindset*, 4 questions.
29. **ESS Metric #18 (Leadership Connection Score)**: Dimensi *Agility & Decision Making*, 6 questions.
30. **ESS Metric #21 (Career Growth & Learning Index)**: Dimensi *Career Growth & Learning*, 3 questions.
31. **ESS Metric #22 (Capability & Enablement Index)**: Dimensi *Capability & Enablement*, 3 questions.
32. **ESS Metric #24 (Performance Feedback Quality Index)**: Dimensi *Performance Feedback & Development*, 3 questions.
33. **ESS Metric #25 (Meaningful Contribution Index)**: Dimensi *Purpose & Meaningful Contribution*, 3 questions.
34. **ESS Metric #27 (Intent to Stay Index)**: Dimensi *Employee Commitment*, 3 questions.

### 📦 Modul 12: Date Normalization & Canonical ISO YYYY-MM-DD Format (2 Test Cases)
35. **Standardized ISO Dates in Calculated Metrics**: Memvalidasi seluruh tanggal metrik (`last_survey_date`, `last_data_date`) mematuhi format ISO standar `YYYY-MM-DD`.
36. **Auto-Normalization on CSV Ingestion**: Memverifikasi parsing dan konversi otomatis tanggal input non-standar (misalnya `M/D/YYYY` seperti `3/31/2026`) menjadi format baku `2026-03-31`.

### 📦 Modul 13: Non-Employee Correspondents Template, Ingestion & Evidence (4 Test Cases)
37. **Metric #2 Template Headers**: Memverifikasi template CSV CIMB Goes to Campus memuat kolom khusus mahasiswa non-karyawan.
38. **Metric #5 Template Headers**: Memverifikasi template CSV Candidate Experience memuat kolom khusus kandidat pelamar.
39. **Metric #2 Non-Employee Upload**: Menguji impor data survei mahasiswa kampus dan parsing field non-karyawan.
40. **Metric #5 Non-Employee Upload**: Menguji impor data survei kandidat pelamar dan parsing field non-karyawan.

### 📦 Modul 14: Period Separation (Year & Month) & View Modes YTD vs MTD (2 Test Cases)
41. **Kalkulasi Mode YTD**: Memverifikasi perhitungan PE Index dengan `mode=YTD, year=2026`.
42. **Kalkulasi Mode MTD**: Memverifikasi perhitungan PE Index dengan `mode=MTD, year=2026, month=02`.

### 📦 Modul 15: Directorate & Sub-Directorate Filtering & Metric Exclusion (3 Test Cases)
43. **Daftar Direktorat**: Memverifikasi `GET /api/directorates` mengembalikan 7 Direktorat beserta sub-direktoratnya.
44. **Exclusion Filter Direktorat**: Memverifikasi filter Direktorat menonaktifkan metrik non-karyawan (Metrik #1–#5).
45. **Filter Sub-Direktorat**: Memverifikasi kalkulasi dengan filter Sub-Direktorat aktif.

### 📦 Modul 16: Admin Parameters Management — CRUD & Reset (3 Test Cases)
46. **Fetch Parameter Master**: Memverifikasi `GET /api/admin/parameters` mengembalikan journeys, checkpoints, dan metrics.
47. **Update Metric Parameter**: Menguji pembaruan bobot, target, dan threshold via `PUT /api/admin/metrics/:id`.
48. **Reset to Default**: Menguji reset seluruh parameter Journey/Checkpoint/Metric ke konfigurasi bawaan via `POST /api/admin/parameters/reset`.

### 📦 Modul 17: Ollama-Powered Score Deficit Alert Narratives (1 Test Case)
49. **Narrative Summary pada Setiap Alert**: Memverifikasi `GET /api/alerts` mengembalikan `narrative_summary` non-trivial (≥20 karakter) untuk setiap metrik defisit — baik dari local Ollama maupun fallback rule-based.

### 📦 Modul 18: Performance Trend — Pergerakan Bulanan Dinamis, Mode YTD/MTD & Konsistensi Scorecard (3 Test Cases)
50. **Bulan Berjalan/Masa Depan Tidak Pernah Muncul Sama Sekali**: Memverifikasi `GET /api/metrics/trends` mengembalikan tepat `last_complete_month` titik (bukan 12), bulan kalender yang sedang berjalan **tidak ada** di array `trends` sama sekali (bukan cuma `has_actual_data: false`), dan Survey Index bervariasi (tidak flat) — regression guard untuk bug "trend masih sampai Desember padahal diminta stop di bulan sebelumnya" ([2.13.0]). (Outcome Index boleh konstan antar bulan — itu cerminan jujur snapshot data HR, bukan bug; lihat catatan §5 di bawah.)
51. **Trend Chart Konsisten dengan Scorecard Utama**: Memverifikasi titik bulan berjalan pada `GET /api/metrics/trends?mode=YTD` (`survey_index`, `outcome_index`, `px_index`) sama (toleransi ±0.5) dengan angka `GET /api/metrics/calculate?period=YTD` — regression guard untuk bug **[2.11.1]** di mana grafik bisa menunjukkan ~59% sementara scorecard menunjukkan ~83% untuk periode yang sama.
52. **Trend Chart Mengikuti Toggle YTD/MTD**: Memverifikasi `GET /api/metrics/trends?mode=YTD` menghasilkan `response_count` kumulatif (terus bertambah tiap bulan) dan berbeda dari `?mode=MTD` (standalone per bulan) — regression guard agar chart tidak lagi mengabaikan toggle YTD/MTD Dashboard.

### 📦 Modul 19: Parameter Frekuensi Update Data (2 Test Cases)
53. **Validasi Nilai `update_frequency`**: Memverifikasi setiap metrik bernilai `MONTHLY` atau `ONE_TIME_ANNUAL`, dan metrik ESS default ke `ONE_TIME_ANNUAL`.
54. **Update `update_frequency` via Admin**: Menguji perubahan frekuensi update sebuah metrik via `PUT /api/admin/metrics/:id`.

### 📦 Modul 20: Pengingat Upload Survei Manual — PIC, Deadline & Email (3 Test Cases)
55. **Parameter PIC & Deadline pada Metrik Survey**: Memverifikasi `requires_manual_upload`, `upload_deadline_day`, `pic_name`, dan `pic_email` tersedia dan valid.
56. **Daftar Pending Reminder**: Memverifikasi `GET /api/admin/upload-reminders` mengembalikan struktur ringkasan (`total_reminders`, `overdue_count`, `due_soon_count`, `reminders[]`) yang valid.
57. **Pengiriman Reminder Tanpa SMTP Tidak Pernah Gagal**: Memverifikasi `POST /api/admin/upload-reminders/send` selalu mengembalikan `200 OK` dengan `success: true` walau `SMTP_HOST` belum dikonfigurasi (graceful on-premise fallback).

### 📦 Modul 21: Data Integrity Audit Fixes — Positive & Negative Testing (8 Test Cases)
Regression guard untuk 5 temuan sub agent **Auditor** (lihat `CHANGELOG.md` **[2.12.0]**) plus uji
ketahanan endpoint terhadap input tidak valid.

58. **[POSITIVE] `last_data_date` sebagai Field Database**: Memverifikasi metrik OUTCOME menyediakan `last_data_date` valid (format ISO), bukan lagi peta hardcoded di kode.
59. **[POSITIVE] Edit `last_data_date` via Admin Tersimpan & Terpakai**: Menguji `PUT /api/admin/metrics/1` mengubah `last_data_date`, memverifikasi tersimpan, dan memverifikasi `GET /api/metrics/calculate` merefleksikan nilai baru tersebut — regression guard untuk bug turunan (`updateMetric()` belum mem-whitelist field ini) yang ditemukan saat menulis test ini.
60. **[POSITIVE] Alert Agregasi Lintas Event**: Membuat event signature baru via `POST /api/events`, lalu memverifikasi `GET /api/alerts` tetap terhitung normal — regression guard agar verbatim tidak lagi hanya bersumber dari 1 event ID hardcoded. Sejak v2.14.1, event yang dibuat dihapus kembali via `DELETE /api/events/:id` di blok `finally`, sehingga test ini **idempoten** dan tidak lagi meninggalkan event "Regression Test Event (Audit Fix Check)" palsu di menu Signature Program Event.
61. **[POSITIVE] Default Tahun dari Jam Server**: Memverifikasi `GET /api/metrics/calculate` tanpa parameter tahun mengembalikan tahun berjalan sungguhan (`new Date().getFullYear()`), bukan literal `'2026'` yang dibekukan.
62. **[NEGATIVE] Update Metrik Tidak Ada → 400 Bersih**: Memverifikasi `PUT /api/admin/metrics/99999` mengembalikan `400` dengan pesan error, bukan crash 500.
63. **[NEGATIVE] Period String Acak → Fallback Aman**: Memverifikasi `GET /api/metrics/calculate?period=not-a-real-period` tetap `200 OK` dengan fallback ke mode YTD, bukan crash.
64. **[NEGATIVE] Mode Trend Tidak Valid → Fallback YTD**: Memverifikasi `GET /api/metrics/trends?mode=NOT_A_MODE` tetap `200 OK` dan fallback ke `YTD`.
65. **[NEGATIVE] Detail Metrik Tidak Ada → Error Bersih**: Memverifikasi `GET /api/metrics/99999/detail` mengembalikan `400`/`404`, bukan crash 500.

### 📦 Modul 22: Filter Rentang Periode Trend Chart — Positive & Negative Testing (5 Test Cases)
Regression guard untuk fitur filter rentang periode (`startMonth`/`endMonth`) yang ditambahkan
di [2.13.0], termasuk memastikan `endMonth` tidak bisa menjangkau bulan yang belum lengkap.

66. **[POSITIVE] Rentang Kustom Mempersempit Hasil**: Memverifikasi `?startMonth=03&endMonth=06` mengembalikan tepat 4 titik (Maret–Juni), titik pertama/terakhir sesuai.
67. **[POSITIVE] Rentang Satu Bulan**: Memverifikasi `startMonth === endMonth` mengembalikan tepat 1 titik.
68. **[NEGATIVE] `endMonth` Selalu Di-clamp ke Bulan Lengkap Terakhir**: Memverifikasi `?startMonth=01&endMonth=12` tetap hanya mengembalikan sejumlah `last_complete_month` titik — tidak ada titik yang melewati bulan lengkap terakhir, walau diminta sampai Desember.
69. **[NEGATIVE] Rentang Terbalik (start > end) Tidak Crash**: Memverifikasi `?startMonth=06&endMonth=02` tetap `200 OK` dengan hasil yang masuk akal, bukan error.
70. **[NEGATIVE] Parameter Rentang Berisi Teks Acak Tidak Crash**: Memverifikasi `?startMonth=abc&endMonth=xyz` tetap `200 OK` dan mengembalikan array `trends` yang valid (boleh kosong).

### 📦 Modul 23: Data Dummy 2025 & Filter Rentang Lintas Tahun — Positive & Negative Testing (6 Test Cases)
Regression guard untuk data seed 2025 dan kemampuan rentang periode lintas tahun yang
ditambahkan di [2.14.0].

71. **[POSITIVE] 2025 Bersumber dari Database, Bukan Fallback Statis**: Memverifikasi metrik SURVEY tahun 2025 memiliki `sample_size > 0` dan `survey_index` 2025 berbeda dari 2026.
72. **[POSITIVE] Tahun Lampau Penuh Mengembalikan 12 Bulan**: Memverifikasi `?year=2025` mengembalikan `last_complete_month: "12"` dan 12 titik data, semuanya punya `response_count > 0`.
73. **[POSITIVE] `available_years` Mencerminkan Database**: Memverifikasi array `available_years` memuat `"2025"` dan `"2026"`.
74. **[POSITIVE] Rentang Lintas Tahun Terurut Kronologis & YTD Reset di Batas Tahun**: Memverifikasi `?startYear=2025&startMonth=11&endYear=2026&endMonth=02` mengembalikan 4 titik berurutan (`2025-11, 2025-12, 2026-01, 2026-02`), dan `response_count` Januari 2026 lebih kecil dari Desember 2025 (membuktikan kumulatif YTD reset, bukan menumpuk lintas tahun).
75. **[NEGATIVE] Rentang Menjangkau Tahun Jauh di Masa Depan Tetap Di-clamp**: Memverifikasi `?startYear=2025&endYear=2030` tidak crash dan titik terakhir tidak pernah melewati tahun berjalan sungguhan.
76. **[NEGATIVE] Rentang Lintas Tahun Terbalik Tidak Crash**: Memverifikasi `?startYear=2026&startMonth=02&endYear=2025&endMonth=11` (start setelah end) tetap `200 OK` dengan hasil yang direkonsiliasi, bukan error.

### 📦 Modul 24: Penghapusan Event, Absensi & Feedback — Positive & Negative Testing (5 Test Cases)
Regression guard untuk endpoint `DELETE` baru di [2.14.1] yang dipakai untuk membersihkan data
bekas regression testing dari menu Signature Program Event.

77. **[POSITIVE] `DELETE /api/events/:id` Menghapus Event Beserta Data Terkait**: Membuat event baru, menghapusnya via `DELETE /api/events/:id`, lalu memverifikasi `GET /api/events/:id` mengembalikan `404` — event benar-benar hilang, bukan hanya disembunyikan.
78. **[POSITIVE] `DELETE .../attendance/:nip` dan `.../feedback/:nip` Hanya Menghapus Record yang Dituju**: Menambahkan absensi + feedback ke event nyata `ev-perspektif-2024-q1`, menghapus keduanya via endpoint DELETE per-NIP, lalu memverifikasi record tersebut sudah tidak ada di `GET /api/events/:id` tanpa mengganggu record lain.
79. **[NEGATIVE] Hapus Event Tidak Ada → 400 Bersih**: Memverifikasi `DELETE /api/events/does-not-exist-12345` mengembalikan `400` dengan pesan error, bukan crash.
80. **[NEGATIVE] Hapus Absensi Tidak Ada → 400 Bersih**: Memverifikasi `DELETE /api/events/ev-perspektif-2024-q1/attendance/0000000` mengembalikan `400` dengan pesan error.
81. **[NEGATIVE] Hapus Feedback Tidak Ada → 400 Bersih**: Memverifikasi `DELETE /api/events/ev-perspektif-2024-q1/feedback/0000000` mengembalikan `400` dengan pesan error.

### 📦 Modul 25: Konsistensi Satuan Target & Min Threshold (Positive Testing) (4 Test Cases)
Regression guard untuk fix [2.15.0] — Target dan Threshold di menu Admin Parameter memakai satuan
berbeda (Target dalam skala Likert 1-5 mentah, Threshold selalu persen), yang juga membuat status
WARNING nyaris tidak pernah tercapai untuk metrik RATING_5/QUOTA_COUNT.

82. **[POSITIVE] `target_value_normalized` Konversi RATING_5 ke Skala 0-100**: Memverifikasi target metrik #2 (CIMB Niaga Goes to Campus, target 4.00/5) menghasilkan `target_value_normalized` = 80, sama persis dengan `target_value / 5 * 100`.
83. **[POSITIVE] Klasifikasi Status Memakai Target Ternormalisasi**: Untuk seluruh metrik RATING_5/QUOTA_COUNT, memverifikasi status HEALTHY/WARNING/CRITICAL konsisten dengan perbandingan `normalized_score` terhadap `target_value_normalized` (bukan `target_value` mentah) — regression guard langsung untuk bug WARNING-tidak-pernah-muncul.
84. **[POSITIVE] `GET /api/admin/parameters` Mengekspos `target_value_normalized`**: Memverifikasi seluruh 27 metrik memiliki `target_value_normalized` bertipe angka dalam rentang 0-100.
85. **[POSITIVE] `GET /api/metrics/:id/detail` Mengekspos `target_value_normalized`**: Memverifikasi field ini muncul baik untuk metrik SURVEY (metrik #2, hasil 80) maupun OUTCOME (metrik #1).

### 📦 Modul 26: Audit Hardcode Lanjutan — Operational Records, Kuota Live & Jumlah Responden (Positive Testing) (3 Test Cases)
Regression guard untuk temuan sub agent Auditor [2.16.0] — tabel drilldown operasional metrik
OUTCOME, kuota partisipasi Metrik #11, dan jumlah responden ESS yang sebelumnya hardcode.

86. **[POSITIVE] Operational Records Bersumber dari Database**: Memverifikasi `operational_records` metrik #1 (5 unit) dan #14 (3 kategori) sesuai tabel seed di database, dan metrik OUTCOME tanpa tabel seeded (#19) mengembalikan array kosong tanpa crash.
87. **[POSITIVE] Kuota Metrik #11 Memakai Target Admin-Editable**: Mengubah `target_value` Metrik #11 via `PUT /api/admin/metrics/11`, memverifikasi `normalized_score` di `/api/metrics/calculate` benar-benar bergeser mengikuti target baru — regression guard untuk bug kuota hardcode `500`.
88. **[POSITIVE] `total_respondents` Jujur ke Database**: Membuat metrik SURVEY/ESS baru dengan nol respons, memverifikasi `total_respondents` = 0 (bukan placeholder fiktif `1250`).

### 📦 Modul 27: Media Event — Upload, Tampil & Transkrip AI Video (6 Test Cases, sejak v2.21.0)

89. **[POSITIVE] Foto Tersimpan sebagai IMAGE & Bisa Dilihat**: Upload PNG kecil → `file_type=IMAGE`, tanpa `transcript_status` (foto tidak memicu transkrip), dan file disajikan di `file_path` dengan content-type `image/*`.
90. **[POSITIVE] Hapus Media = Hapus File Fisik**: Setelah `DELETE /api/media/:id`, file di `/uploads` tidak lagi dapat diakses (video besar tidak boleh tertinggal yatim).
91. **[POSITIVE] Job Transkrip Video Selalu Selesai**: Upload "video" tidak valid → langsung dibalas `PROCESSING`, lalu dalam ≤60 detik berubah menjadi `DONE`/`FAILED`; `FAILED` wajib membawa `transcript_error` — regression guard agar tidak ada media yang tersangkut `PROCESSING` selamanya, baik API transkrip hidup maupun mati.
92. **[NEGATIVE] File Non-Media Ditolak 415**: Upload `.html` ditolak sehingga tidak pernah dapat disajikan dari `/uploads` (mencegah XSS lewat file unggahan).
93. **[NEGATIVE] Transkrip untuk Foto → 400**: `POST /api/media/:id/transcribe` pada IMAGE tidak memulai transkripsi.
94. **[NEGATIVE] Transkrip untuk Media Tak Ada → 404**: ID tidak dikenal dijawab 404 bersih.

---

## 🚀 3. Cara Menjalankan Pengujian

### 3.1 Menjalankan Regression Suite Otomatis
Pastikan backend server sedang berjalan di port 5000, kemudian jalankan perintah:

```bash
node tests/regressionTest.js
```

### Output Pengujian Sukses:
```text
================================================================
🧪 CIMB NIAGA PEOPLE EXPERIENCE (PX) - REGRESSION TESTING SUITE
================================================================

📦 MODULE 1: Calculation Engine & Period Filtering             -> 3/3 PASS
📦 MODULE 2: Monthly Trends & Progression Engine               -> 1/1 PASS
📦 MODULE 3: Metric Question Drilldown & Respondent Analysis   -> 1/1 PASS
📦 MODULE 4: Question-Based Survey Template Generator          -> 2/2 PASS
📦 MODULE 5: Question-Based Survey CSV Import & Recalculation  -> 1/1 PASS
📦 MODULE 5b: Survey Evidence Export & Audit Trail             -> 2/2 PASS
📦 MODULE 6: Admin Target & Ambang Batas Settings              -> 2/2 PASS
📦 MODULE 7: Alert Engine & Verbatim Action Recommendations    -> 1/1 PASS
📦 MODULE 8: Signature Program Events & PowerPoint Export      -> 2/2 PASS
📦 MODULE 9: Outcome vs Survey Metrics Separation & Validation -> 3/3 PASS
📦 MODULE 10: Admin Survey Questions & Multi-Type Questions    -> 5/5 PASS
📦 MODULE 11: ESS Dimensions & Summary Scores (11 Metrics)     -> 11/11 PASS
📦 MODULE 12: Date Normalization & Canonical ISO Format        -> 2/2 PASS
📦 MODULE 13: Non-Employee Correspondents Template & Evidence  -> 4/4 PASS
📦 MODULE 14: Period Separation (YTD vs MTD)                   -> 2/2 PASS
📦 MODULE 15: Directorate & Sub-Directorate Filtering          -> 3/3 PASS
📦 MODULE 16: Admin Parameters Management (CRUD & Reset)       -> 3/3 PASS
📦 MODULE 17: Ollama-Powered Alert Narratives                  -> 1/1 PASS
📦 MODULE 18: Performance Trend Dynamic Monthly Movement       -> 3/3 PASS
📦 MODULE 19: Periodic Data Update Frequency Parameter         -> 2/2 PASS
📦 MODULE 20: Manual Survey Upload Reminder (PIC & Email)      -> 3/3 PASS
📦 MODULE 21: Data Integrity Audit Fixes (Pos. & Neg. Testing) -> 8/8 PASS
📦 MODULE 22: Trend Chart Period-Range Filter (Pos. & Neg.)    -> 5/5 PASS
📦 MODULE 23: 2025 Seed Data & Cross-Year Range (Pos. & Neg.)  -> 6/6 PASS
📦 MODULE 24: Event/Attendance/Feedback Deletion (Pos. & Neg.) -> 5/5 PASS
📦 MODULE 25: Target & Min Threshold Unit Consistency (Positive) -> 4/4 PASS
📦 MODULE 26: Hardcode Audit Follow-up (Operational/Quota/Resp.) -> 3/3 PASS
📦 MODULE 27: Event Media Upload, Viewing & Video AI Transcript -> 6/6 PASS

================================================================
📊 REGRESSION TEST SUMMARY: 94/94 Tests Passed (0 Failed)
================================================================
```

---

### 3.2 Menjalankan Production Build Frontend
Untuk memverifikasi keutuhan kode frontend dan build bundle Vite:

```bash
npm run build
```

*Output yang diharapkan*: `built in X.XXs` dengan status 0 error.

---

## 🐞 4. Catatan Perbaikan Bug & QA Manual UI (2026-09-18)

Perbaikan berikut bersifat frontend-only (tidak mengubah kontrak API backend), sehingga tidak
tercakup oleh regression suite otomatis di atas dan diverifikasi secara manual via Browser:

1. **Bug Tombol Edit di Parameter Admin ([`AdminParametersModal.jsx`](../src/components/AdminParametersModal.jsx))**
   — *Root cause*: Form Edit/Tambah Journey & Metric dirender di bagian atas body modal yang
   scrollable. Jika pengguna sudah scroll ke bawah tabel (mis. 27 metrik) sebelum mengklik
   *Edit*, form tetap terbuka namun berada di luar area yang terlihat (scroll position tidak
   ikut berubah) — sehingga terlihat seolah tombol tidak merespons pada klik kedua dan
   seterusnya. *Fix*: menambahkan `modalBodyRef` dan auto-scroll (`scrollTo({top:0,
   behavior:'smooth'})`) setiap kali form Edit/Tambah dibuka, untuk Journey maupun Metric.
2. **Penghapusan Awalan "#" pada Penomoran Metrik** — Seluruh tampilan nomor metrik (`#1`, `#2`,
   dst.) di kolom ID, mini-pill Journey, judul modal Edit, dan konfirmasi hapus diubah menjadi
   angka polos (`1`, `2`, dst.) di 8 komponen: `Calculator.jsx`, `Dashboard.jsx`,
   `AdminParametersModal.jsx`, `AdminSettingsModal.jsx`, `AdminSurveyQuestionsModal.jsx`,
   `MetricDetailModal.jsx`, `WeightsModal.jsx`, `SurveyImportModal.jsx`.
3. **Pewarnaan Status pada Metrics Mini-Pills di Dashboard** — Pill metrik dalam kartu Journey
   ("5 Employee Experience Journeys") kini diwarnai sesuai status: **Hijau** (*On Target*),
   **Kuning** (*Warning*), **Merah** (*Critical*) — sebelumnya status *On Target* memakai warna
   abu-abu netral, tidak mencerminkan pencapaian positif secara visual.
4. **Unifikasi Warna Tombol Actions & Evidence di Explore Metrics ([`Calculator.jsx`](../src/components/Calculator.jsx))**
   — Tombol *Template* (sebelumnya hijau), *Evidence* (ungu), *Upload* (biru), *Detail* (merah),
   *View Data* (abu-abu), dan *Target* (kuning) disamakan menjadi satu warna. Iterasi pertama
   (2026-09-18 pagi) memakai **Merah** tema (`#ED1C24`) agar konsisten dengan warna brand, namun
   direvisi pada hari yang sama karena bertabrakan makna dengan warna status *Critical* (juga
   merah) — final: warna **Slate** netral (`bg-slate-100` / `text-slate-700` / `border-slate-200`
   / `hover:bg-slate-200`), *soft, corporate, dan elegant*, sengaja dipisahkan dari palet status
   Hijau/Kuning/Merah agar tidak tertukar makna dengan indikator On Target/Warning/Critical.
5. **Pemisah Nomor & Nama Metrik pada Journey Mini-Pills Dashboard ([`Dashboard.jsx`](../src/components/Dashboard.jsx))**
   — Nomor metrik dan nama metrik pada pill di kartu Journey ("5 Employee Experience Journeys")
   kini dipisahkan tanda hubung (` - `), contoh: `1 - Career Website & Social Media Follower,
   Reach & Engagement Growth`, agar lebih mudah dibaca dibanding sebelumnya yang langsung
   bersambung tanpa pemisah.

**Verifikasi**: `node tests/regressionTest.js` → 48/48 PASS (tidak ada regresi backend, dijalankan
ulang setelah setiap iterasi perubahan tampilan di atas) + QA manual di Browser pane untuk
seluruh perbaikan di atas (screenshot & DOM inspection). Lihat `CHANGELOG.md` entri
**[2.9.1]** dan **[2.9.2]** untuk rincian rilis.

---

## 🚀 5. Catatan Rilis Fitur Besar — v2.10.0 (2026-09-18)

Empat fitur baru berikut ditambahkan pada rilis ini, masing-masing dengan regression test
otomatis baru (Modul 17–20 di atas) dan verifikasi manual di Browser:

1. **Narasi Alert Dinamis via Local Ollama** — `GET /api/alerts` kini menghasilkan
   `narrative_summary` per metrik defisit lewat model Ollama on-premise, dengan fallback
   rule-based deterministik saat Ollama offline (diverifikasi: server berjalan dengan
   `ollama_status: "offline (using local heuristic engine)"` dan alert tetap tampil normal).
2. **Perbaikan Trend Chart Flat April–Desember** — data seed survei kini diperluas otomatis
   hingga bulan kalender berjalan, dan Outcome Index tidak lagi flat. Diverifikasi via
   `GET /api/metrics/trends`: seluruh bulan Januari–September (bulan berjalan saat rilis)
   menunjukkan `has_actual_data: true` dengan nilai `outcome_index` yang bervariasi.
3. **Parameter Frekuensi Update Data** — field `update_frequency` (`MONTHLY` /
   `ONE_TIME_ANNUAL`) ditambahkan ke seluruh 27 metrik; 11 metrik ESS default ke Tahunan.
4. **Pengingat Upload Survei Manual (PIC & Email)** — field `requires_manual_upload`,
   `upload_deadline_day`, `upload_deadline_month`, `pic_name`, `pic_email` ditambahkan;
   endpoint `GET/POST /api/admin/upload-reminders` diverifikasi mengembalikan struktur
   yang valid dan tidak pernah gagal walau SMTP belum dikonfigurasi (`smtp_configured: false`,
   `email_status: "LOGGED_ONLY"`).

**Migrasi data**: Perubahan pada `server/db/storage.js` bersifat non-destruktif — `store.json`
yang sudah ada (termasuk respons survei yang sudah diupload sebelumnya) otomatis di-backfill
dengan field-field baru dan digabung dengan data seed bulan tambahan saat server boot, tanpa
menghapus data yang sudah ada.

**Verifikasi**: `node tests/regressionTest.js` → **55/55 PASS** (0 gagal) + QA manual di Browser
pane untuk keempat fitur (screenshot, DOM inspection, dan simulasi tanggal untuk menguji status
`OVERDUE`/`DUE_SOON` pada reminder). Lihat `CHANGELOG.md` entri **[2.10.0]** untuk rincian rilis.

---

## 🔁 6. Performance Trend — Mode YTD/MTD — v2.11.0 (2026-09-18)

Grafik "People Experience (PX) Performance Trend 2026" sebelumnya mengabaikan toggle YTD/MTD di
Dashboard — pola pergerakannya selalu sama persis apa pun mode yang aktif. Diperbaiki di rilis ini:

- **Mode YTD** (default): tiap titik bulan = rata-rata **kumulatif** Januari s/d bulan tersebut,
  konvergen ke angka scorecard YTD.
- **Mode MTD**: tiap titik bulan **berdiri sendiri**, murni data bulan itu saja.

**Verifikasi**: Regression test (Modul 18, test ke-52) memverifikasi bahwa `response_count`
pada mode YTD terus bertambah (akumulatif, non-decreasing) sepanjang bulan aktual, dan bahwa
deret `survey_index` mode YTD berbeda dari mode MTD (bukan data yang sama dipakai ulang). QA
manual di Browser: toggle YTD/MTD di Dashboard dan verifikasi badge chart berubah ("Cumulative
YTD" ↔ "Monthly Movement (MTD)") beserta bentuk grafiknya. Lihat `CHANGELOG.md` entri **[2.11.0]**.

> ⚠️ Rilis 2.11.0 masih membawa keterbatasan pra-eksisting (nilai `survey_index` trend chart
> berbeda metode dari scorecard) yang sempat dicatat di sini sebagai "belum diperbaiki" — bug
> itu kemudian dilaporkan pengguna dan **sudah diperbaiki tuntas di [2.11.1]**, lihat §7 di bawah.

---

## 🎯 7. Trend Chart Konsisten dengan Scorecard — v2.11.1 (2026-09-18)

Ditemukan (dilaporkan pengguna) bahwa setelah rilis 2.11.0, scorecard PX Index YTD menunjukkan
**83.19%** sementara grafik Performance Trend untuk periode yang sama hanya menunjukkan **~59%an**
— selisih besar yang membingungkan. Root cause: `computeMonthlyTrends()` memakai metode rata-rata
sederhana (pooling `rating_score` mentah lintas metrik tanpa normalisasi per-`scale_type` maupun
bobot `weight`), berbeda total dari `calculatePEIndex()` yang dipakai scorecard utama.

**Fix**: `computeMonthlyTrends()` kini memanggil `calculatePEIndex()` langsung untuk tiap bulan
(parameter baru `endMonth` pada filter YTD membatasi kumulatif sampai akhir bulan tertentu;
opsi internal `{ skipTrends: true }` mencegah rekursi tak terbatas), sehingga metode
perhitungannya **100% identik** dengan scorecard utama untuk periode manapun.

**Verifikasi**: Regression test baru (Modul 18, test ke-51) memverifikasi titik bulan berjalan
pada trend chart sama (toleransi ±0.5) dengan angka scorecard `/api/metrics/calculate?period=YTD`
— `node tests/regressionTest.js` → **57/57 PASS**. QA manual di Browser: scorecard 83.22% dan
level grafik trend kini terlihat sejajar di kisaran 83-85% (sebelumnya grafik jatuh ke ~59%
sementara scorecard tetap di ~83%), untuk mode YTD maupun MTD. Lihat `CHANGELOG.md` entri
**[2.11.1]** untuk rincian teknis lengkap, termasuk penjelasan mengapa Outcome Index tampil
konstan antar bulan (bukan bug — snapshot data HR, bukan time-series bulanan).

---

## 🕵️ 8. Sub Agent Auditor & Perbaikan Data Hardcoded — v2.12.0 (2026-09-18)

Dua permintaan pengguna ditangani di rilis ini:

1. **Dashboard trend berhenti di bulan lengkap terakhir**: Grafik masih menandai bulan
   kalender **berjalan** (September 2026) sebagai data final, padahal bulan tersebut belum
   selesai. `computeMonthlyTrends()` kini menghitung cutoff "aktual" sebagai bulan **sebelum**
   bulan berjalan — lihat `CHANGELOG.md` **[2.12.0]** bagian pertama.
2. **Sub agent "Auditor" (`.claude/agents/auditor.md`)** dijalankan untuk mengaudit seluruh
   `server/services/*.js` dan `server/server.js`, mencari nilai hardcoded yang seharusnya
   bersumber dari database. Auditor melaporkan **5 temuan terkonfirmasi** (peta tanggal
   ingestion Outcome hardcoded, tahun `'2026'` dibekukan di 12+ lokasi, `monthCodes` chart
   dibekukan ke 2026, logika cutoff bulan tidak menangani tahun lain, dan verbatim alert
   hanya dari 1 event ID hardcoded) — semuanya sudah diperbaiki (detail lengkap di
   `CHANGELOG.md` **[2.12.0]**).

**Bug tambahan ditemukan lewat testing, bukan audit**: saat menulis test positif untuk
memverifikasi edit `last_data_date` via Admin benar-benar tersimpan, ternyata
`storage.updateMetric()` belum memasukkan field itu ke whitelist yang disimpan — edit dari UI
Admin diam-diam tidak pernah tersimpan. Ini contoh nyata kenapa **positive testing** (bukan cuma
negative testing) penting: audit statis menemukan *duplikasi sumber kebenaran*, tapi baru
tes end-to-end ("edit lalu baca lagi") yang menemukan *field itu bahkan tidak tersimpan sama
sekali*. Sudah diperbaiki.

**Verifikasi**: `node tests/regressionTest.js` → **65/65 PASS**, termasuk Modul 21 baru (4 test
positif + 4 test negatif). QA manual di Browser: grafik trend menunjukkan 8 titik merah solid
(Januari–Agustus, aktual) diikuti 4 titik pink pudar (September–Desember, forecast) — dikonfirmasi
via inspeksi warna SVG langsung.

> ⚠️ Pengguna melaporkan grafik **masih memuat titik September–Desember** (walau berwarna pudar
> sebagai forecast) setelah rilis ini — permintaannya adalah menghilangkan bulan-bulan tersebut
> **sepenuhnya**, bukan sekadar mewarnainya berbeda. Ditangani tuntas di **[2.13.0]**, lihat §9.

---

## ✂️ 9. Trend Chart Benar-Benar Berhenti di Bulan Lengkap Terakhir + Filter Rentang — v2.13.0 (2026-09-18)

Tindak lanjut dari keluhan pengguna: proyeksi forecast (titik pudar September–Desember) pada
grafik trend **dihapus total** dari `computeMonthlyTrends()` — fungsi kini hanya mengembalikan
titik untuk bulan yang benar-benar lengkap, jadi array hasil untuk hari ini (September 2026)
berisi tepat 8 titik (Januari–Agustus), bukan 12. Ditambahkan pula **filter rentang periode**
(dropdown "Dari Bulan"/"Sampai Bulan" di atas grafik, default Januari s/d bulan lengkap
terakhir), dengan `endMonth` yang selalu di-clamp di server — tidak mungkin dipaksa menjangkau
bulan yang belum selesai, dari frontend maupun lewat panggilan API langsung.

**Verifikasi**: `node tests/regressionTest.js` → **70/70 PASS**, termasuk Modul 22 baru (2 test
positif + 3 test negatif) dan pembaruan 3 test lama (Modul 2 & 18) yang sebelumnya berasumsi
array selalu 12 bulan. QA manual di Browser: dropdown rentang hanya berisi opsi Januari–Agustus
(tidak ada September dst.), mengubah ke "Maret s/d Juni" langsung mempersempit grafik menjadi
4 titik, tombol "Reset" mengembalikan ke default, dan toggle YTD/MTD tetap berfungsi normal
dengan filter rentang aktif.

---

## 🗓️ 10. Data Dummy 2025 & Filter Rentang Lintas Tahun — v2.14.0 (2026-09-18)

Pengguna melaporkan dua hal: (1) data tahun 2025 di dropdown Header masih terasa "hardcode"
(angka sama persis apa pun tahun dipilih), dan (2) filter rentang periode hanya bisa dalam
satu tahun berjalan, seharusnya bisa lintas tahun.

**Root cause #1**: Tidak ada satu pun respons survei berlabel tahun 2025 di `store.json` —
memilih 2025 diam-diam jatuh ke `raw_value` default tiap metrik (identik untuk tahun manapun).
**Fix**: `generateInitialSurveyResponses()` (`seedData.js`) diperluas menghasilkan dataset 2025
penuh 12 bulan, memakai generator & formula variasi yang sama persis dengan 2026, di-merge
non-destruktif ke `store.json` yang sudah ada.

**Root cause #2**: `computeMonthlyTrends()` hanya menerima satu `year` per pemanggilan.
**Fix**: ditulis ulang untuk menerima `startYear`/`startMonth`/`endYear`/`endMonth` terpisah,
membangun daftar bulan kronologis yang boleh melewati batas tahun, dengan mode YTD yang tetap
reset tiap 1 Januari (bukan menumpuk lintas tahun) — sesuai konvensi pelaporan YTD standar.
`endYear`/`endMonth` tetap di-clamp ke bulan lengkap terakhir di server. Dropdown Tahun di
Header (`Header.jsx`) dan di filter rentang (`TrendChart.jsx`) kini sama-sama diisi dari
`available_years` (database), bukan lagi daftar hardcoded.

**Verifikasi**: `node tests/regressionTest.js` → **76/76 PASS**, termasuk Modul 23 baru (4 test
positif + 2 test negatif). QA manual di Browser: memilih 2025 di Header menampilkan PX Index
82.92% (berbeda dari 2026: 83.30%) dengan 12 titik trend penuh; mengatur rentang filter ke
"2025 November s/d 2026 Februari" menghasilkan judul chart "2025–2026" dan label sumbu-X
"Nov '25, Des '25, Jan '26, Feb '26" — dikonfirmasi via inspeksi teks SVG langsung.

---

## [2.14.1] — Data Bekas Regression Testing di Menu Signature Program Event (Fixed)

**Laporan pengguna**: menu **Signature Program Event** menampilkan data bekas regression testing
yang tidak pernah dibersihkan — event palsu "Regression Test Event (Audit Fix Check)" ikut
tampil di daftar event nyata, dan event nyata `ev-perspektif-2024-q1` ikut kena tambahan
absensi & feedback palsu "Test Participant" setiap kali suite dijalankan.

**Root cause #1**: Test Modul 21 membuat event baru via `POST /api/events` di setiap run tanpa
pernah menghapusnya — belum ada endpoint `DELETE /api/events/:id`.
**Root cause #2**: Test Modul 8 melakukan check-in + submit feedback ke event nyata
`ev-perspektif-2024-q1` di setiap run tanpa mekanisme cleanup — belum ada endpoint untuk
menghapus absensi/feedback per NIP.

**Fix**: Endpoint baru `DELETE /api/events/:id`, `DELETE /api/events/:id/attendance/:nip`, dan
`DELETE /api/events/:id/feedback/:nip` ditambahkan di `server.js` (didukung
`storage.deleteEvent()`, `storage.deleteAttendance()`, `storage.deleteFeedbackResponse()`).
Modul 8 dan Modul 21 dibungkus `try/finally` sehingga data yang mereka buat untuk pengujian
**selalu dihapus kembali** di akhir test, apa pun hasil assertion-nya.

**Bug tambahan ditemukan saat verifikasi**: `getMetricDetail()` memotong daftar respons ke 100
teratas berdasarkan urutan penyimpanan, bukan tanggal — begitu volume data seed melebihi 100
respons per metrik, respons yang baru diupload bisa "hilang" dari tampilan Evidence. Diperbaiki
dengan mengurutkan berdasarkan tanggal terbaru dahulu sebelum dipotong ke 100.

**Pembersihan data lama**: 9 event bekas, 27 absensi palsu, 27 feedback palsu, dan ~216 respons
survei bekas upload CSV test dihapus langsung dari `store.json`.

**Test baru — Modul 24**: 5 test case baru (2 positif + 3 negatif) menguji endpoint `DELETE`
baru itu sendiri secara langsung — event/absensi/feedback yang dihapus benar-benar hilang
(`404`/tidak muncul lagi di detail event), dan menghapus ID yang tidak ada mengembalikan `400`
bersih, bukan crash.

**Verifikasi**: `node tests/regressionTest.js` dijalankan **2x berturut-turut** → **81/81 PASS**
setiap kali (76 test sebelumnya + 5 test Modul 24 baru). Jumlah absensi/feedback/event pada
`ev-perspektif-2024-q1` dikonfirmasi tetap stabil (5 absensi, 3 feedback, 0 event bekas test)
sebelum dan sesudah setiap run — membuktikan tidak ada lagi kebocoran data test ke tampilan
pengguna.

---

## [2.15.0] — Satuan Target & Threshold yang Tidak Nyambung di Admin Parameter (Fixed)

**Laporan pengguna**: Di menu **Parameter Admin**, metrik "CIMB Niaga Goes to Campus — event
evaluation / rating" menampilkan Target **4** tapi Threshold **75** — tidak sebanding karena beda
satuan (Target skala Likert 1-5, Threshold persen 0-100).

**Root cause**: bukan cuma masalah tampilan, tapi bug fungsional. `min_threshold` selalu disimpan
dalam persen (0-100) dan dibandingkan terhadap `normalized_score` (0-100) — itu benar. Tapi
`target_value` disimpan dalam **satuan skala asli metrik** (mis. `4.00` untuk RATING_5), dan status
HEALTHY/WARNING/CRITICAL di `calculatePEIndex()` serta `getMetricDetail()` membandingkannya
**langsung** terhadap skor 0-100 tanpa konversi. Akibatnya status **WARNING nyaris tidak pernah
tercapai** untuk metrik RATING_5/QUOTA_COUNT — skor 0-100 nyaris selalu lebih besar dari target
mentah seperti `4`, sehingga metrik cuma bisa lompat dari CRITICAL langsung ke HEALTHY.

**Bug turunan**: field `gap` (dipakai `alertEngine.js` untuk mengurutkan Score Deficit Alerts, dan
dikutip `localAiService.js` dalam narasi "Gap Defisit: X%") dihitung sebagai
`target_value_mentah - normalized_score` — untuk metrik RATING_5 ini menghasilkan angka negatif
tidak masuk akal (mis. `4 - 80 = -76`), berisiko mengacaukan urutan prioritas alert.

**Fix**: fungsi baru `normalizeTarget()` (`calculationEngine.js`) mengonversi `target_value` ke
skala 0-100 yang sama dengan `normalized_score`, memakai logika konversi identik dengan
`normalizeScore()`. Ketiga titik perbandingan status dan perhitungan `gap` kini memakai target
ternormalisasi ini. Field baru `target_value_normalized` ditambahkan ke
`/api/metrics/calculate`, `/api/metrics/:id/detail`, dan `/api/admin/parameters`.
`AdminParametersModal.jsx`'s tabel Target kini menampilkan persentase (mis. **80.0%**) sebagai
nilai utama dengan bentuk asli (`> 4.00/5`) sebagai subteks, sebanding langsung dengan kolom
Threshold (**75%**). Form Edit/Tambah Metrik diberi label satuan eksplisit plus hint hidup
"≈ 80.0% dari skala penuh". Default form Tambah Metrik yang sebelumnya salah satuan
(`min_threshold: 4.0`) diperbaiki menjadi `75.0`.

**Test baru — Modul 25**: 4 test case baru (semua positif) memverifikasi konversi
`target_value_normalized`, klasifikasi status yang konsisten untuk seluruh metrik
RATING_5/QUOTA_COUNT, dan field ini muncul di ketiga endpoint terkait.

**Verifikasi**: `node tests/regressionTest.js` → **85/85 PASS** (81 test sebelumnya + 4 test Modul
25 baru). Dicek manual di Browser: metrik #2 menampilkan Target **80.0%** berdampingan dengan
Threshold **75%**; Score Deficit Alerts tampil dengan gap yang masuk akal dan terurut benar
("Gap defisit sebesar 99.7%" untuk yang paling kritis, "13.4%" untuk yang WARNING).

---

## [2.16.0] — Audit Menyeluruh: Menghapus Sisa Hardcode di Seluruh Web (Fixed)

**Permintaan pengguna**: menjalankan sub agent **Auditor** untuk memeriksa apakah masih ada data
di web yang hardcode, dengan harapan eksplisit semua data berasal dari database.

**7 temuan diperbaiki** (6 dari laporan Auditor + 1 ditemukan saat verifikasi manual):

1. **Tahun default frontend (`App.jsx`, `Header.jsx`, `Dashboard.jsx`)** membekukan `year: '2026'` di `filterOptions`, yang selalu dikirim ke backend — membatalkan manfaat `CURRENT_YEAR` dinamis backend sejak [2.12.0]. Diperbaiki dengan `CURRENT_YEAR = String(new Date().getFullYear())` di ketiga file.
2. **Fallback tanggal beku** (`'2026-03-20'`/`'2026-03-24'`) di `calculationEngine.js`, `Calculator.jsx`, dan `MetricDetailModal.jsx` — diganti dengan tanggal hari ini yang sesungguhnya.
3. **Tabel drilldown operasional 5 metrik OUTCOME** (SLA rekrutmen, approval stage, channel hiring, recognition) hardcode inline di `calculationEngine.js` — dipindahkan ke `seedData.js`/`store.json` via getter baru `storage.getOperationalRecords()`.
4. **Kuota Metrik #11 hardcode `500`** di `syncLiveEventMetrics()`, terpisah dari `target_value` admin-editable-nya — kini membaca target asli dari database.
5. **`total_respondents` ESS memakai placeholder fiktif `1250`** saat data kosong, plus bug ganda di frontend (`|| 1250` menganggap hitungan nyata `0` sebagai falsy) — kini selalu memakai hitungan asli dari database.
6. **(Ditemukan saat verifikasi, di luar laporan Auditor)** `storage.js`'s `applyResponseFilters()` juga membekukan default tahun ke `'2026'` di 4 titik terpisah — diperbaiki dengan konstanta `CURRENT_YEAR` yang sama.

**Direview dan dinilai TIDAK perlu diubah** (bukan bug): `seedData.js`'s dataset demo (memang dirancang statis by design), formula bobot 70/30 Survey/Outcome (konstanta framework terdokumentasi), `REMINDER_LEAD_DAYS = 5` (konstanta kebijakan aplikasi, bukan data metrik), baris contoh CSV template (konten ilustratif untuk admin), dan fallback nilai default per-pertanyaan 90.0/9.0/4.5 (kondisi darurat "benar-benar nol data", bukan data yang menutupi kondisi nyata).

**Test baru — Modul 26**: 3 test case baru memverifikasi operational_records bersumber database, kuota Metrik #11 mengikuti target admin-editable, dan total_respondents jujur ke database (0, bukan 1250).

**Verifikasi**: `node tests/regressionTest.js` dijalankan **2x berturut-turut** → **88/88 PASS**
setiap kali (85 test sebelumnya + 3 test Modul 26 baru), dengan jumlah event tetap stabil di 2
(tidak ada kebocoran data test) di setiap run.

---

## 🗄️ 11. Backend Storage JSON / SQL Server — v2.22.0 (2026-10-11)

**Regression suite: 99 test** (94 sebelumnya + **Modul 28**, 5 test). Dijalankan terhadap **kedua backend**: JSON (default) dan SQL Server (`STORAGE_BACKEND=sql`) — hasil **99/99 PASS** di SQL 2× berturut-turut dan di JSON.

| Modul 28 | Jenis | Yang diuji |
| :--- | :---: | :--- |
| Health melaporkan backend nyata | Positif | `/api/health` → `database.backend` ∈ {json, sql}; mode SQL menyebut server & database |
| Jumlah baris live dari SQL | Positif | (hanya SQL) metrics ≥ 27, respons > 0, events ≥ 1 |
| Media = path, bukan isi file | Positif | semua `file_path` diawali `/uploads/`; tidak ada field konten biner |
| Duplikat NIP ditolak | Negatif | pesan "sudah tercatat" sama di JSON (cek array) dan SQL (constraint `UNIQUE`) |
| Lookup tak ada → 404 | Negatif | event / kode event tak dikenal tidak menghasilkan 500 |

**Verifikasi paritas backend (di luar suite)**: dua server (SQL :5000 dan JSON :5001) dijalankan atas data identik, 58 endpoint GET dibandingkan field-demi-field → **58/58 identik** (setelah memperbaiki satu temuan: migrasi awal mengelompokkan respons per upload sehingga urutan baris berubah dan "respons terakhir" per metric berbeda; kini satu bulk insert berurutan). Jalur rollback juga diuji: ekspor SQL → `store.json` → dilayani backend JSON → **58/58 identik** dengan SQL.

Catatan operasional: regression test menulis data uji (upload CSV) ke database aktif, sama seperti dulu ke `store.json`. Setelah menjalankannya di backend SQL, kembalikan data bersih dengan `node server/db/migrate.js --reset`.

---

## 🕵️ 12. Audit Sumber Data SQL Server — v2.22.1 (2026-10-11)

**Regression suite: 108 test** (99 + **Modul 29**, 9 test), **108/108 PASS** di SQL Server (2× berturut-turut) dan di backend JSON.

| Modul 29 | Jenis | Yang diuji |
| :--- | :---: | :--- |
| Settings dari database | Positif | `GET /api/settings` memuat target PX & opsi dropdown event |
| Target PX tersimpan | Positif | `PUT` target → `/api/metrics/trends.px_index_target` ikut berubah, lalu dipulihkan |
| Settings tidak valid | Negatif | target 150 / "abc" → 400; key tak dikenal → 404; daftar opsi kosong → 400 |
| Pertanyaan tiap metric SURVEY ada di DB | Positif | seluruh metric SURVEY punya set pertanyaan |
| Edit & reset pertanyaan | Positif | simpan perubahan teks → terbaca; reset → kembali ke teks asli |
| Responden terjangkau filter | Positif | setiap direktorat/divisi responden (metric 7/8/9) ada di `/api/directorates` |
| Drilldown Metric 11 | Positif | `event_title` & `registered_at` terisi |
| Alert vs status | Positif | setiap metric WARNING/CRITICAL punya alert |
| Metric tak ada | Negatif | simpan/reset pertanyaan metric 9999 → 404 dan tidak membuat baris yatim |

Paritas backend: 57/58 endpoint GET identik antara SQL dan JSON (selisih satu disengaja: JSON masih menyajikan set pertanyaan kode untuk metric 19/20 yang bukan metric SURVEY).

---

## 📧 13. Setting Email & Katalog Pilihan — v2.23.0 (2026-10-11)

**Regression suite: 116 test** (108 + **Modul 30**, 8 test) → **116/116 PASS** di SQL Server (2×) dan di JSON.

| Modul 30 | Jenis | Yang diuji |
| :--- | :---: | :--- |
| Settings tanpa field password | Positif | respons `GET /api/admin/email-settings` tidak memuat password apa pun |
| Enkripsi | Positif | AES-256-GCM: IV acak (ciphertext berbeda tiap kali), round-trip benar, ciphertext yang diubah tidak bisa didekripsi |
| Jalur lengkap dengan SMTP palsu | Positif | simpan → email test terkirim dengan password terdekripsi yang benar → `upload-reminders/send` memakai pengirim dari database dan jumlah SENT = pesan yang diterima server |
| Belum dikonfigurasi | Positif | test email → 502 "belum dikonfigurasi", bukan crash |
| Validasi | Negatif | provider salah, port 70000, format email, mengaktifkan tanpa password → 400 |
| Penerima test tidak valid | Negatif | → 400 |
| Katalog pilihan dari DB | Positif | 5 katalog (tipe metrik, skala, responden, frekuensi, tipe pertanyaan) |
| Katalog hanya label | Negatif | mengubah/menambah *value* → 400; mengubah label → 200 lalu dipulihkan |

Test jalur lengkap dan "belum dikonfigurasi" **dilewati otomatis** bila sudah ada konfigurasi email sungguhan (agar suite tidak menimpa akun yang diisi admin). Tidak ada email sungguhan yang dikirim oleh test — server SMTP palsu berjalan di dalam proses test.

---

## ⏰ 14. Reminder Upload Survei Otomatis — v2.24.0 (2026-10-11)

**Regression suite: 127 test** (116 + **Modul 31**, 10 test, + 1 test kunci enkripsi di Modul 30) → **127/127 PASS** di SQL Server (2×) dan di JSON. Tanggal disimulasikan dengan `reference_date`; pengiriman diuji dengan server SMTP palsu di dalam test (otomatis dilewati bila sudah ada pengirim email sungguhan).

| Modul 31 | Jenis | Yang diuji |
| :--- | :---: | :--- |
| Tanggal batas | Positif | tgl 9 Okt: tidak ada reminder; tgl 10 Okt: `DUE_TODAY`, periode `2026-09` ("September 2026") |
| Setelah batas | Positif | tgl 14 Okt: `OVERDUE`, `days_overdue = 4`, periode tetap September; Januari → Desember tahun lalu |
| Hanya bulan sebelumnya | Positif | data Oktober saja tidak cukup; data September menghentikan reminder |
| Per metrik | Positif | data September metrik lain tidak dihitung |
| Tahunan | Positif | tgl 24 Nov: tidak ada; tgl 25 Nov: `DUE_TODAY`, periode `2026` |
| Siklus otomatis end-to-end | Positif | terkirim 1× di hari batas → tidak dobel di hari yang sama → tindak lanjut esoknya ("pengingat ke-2") → berhenti bila repeat=0 → berhenti saat data diupload; 2 baris `SENT` di log |
| Hapus metrik | Positif | data survei ikut terhapus; metrik baru dengan ID yang sama tidak mewarisi "data September" |
| Tanpa pengirim email | Positif | status `LOGGED_ONLY`, tidak dicatat sebagai terkirim |
| PIC tanpa email / bukan upload manual | Negatif | `SKIPPED_NO_EMAIL`; metrik non-manual tidak pernah diingatkan |
| Input salah | Negatif | `reference_date` salah format, jam 24 / -1, repeat 1.5 / 99 → 400 |

**Bukti tanpa simulasi**: dengan jam server asli (11 Okt, lewat batas tgl 10) dan SMTP palsu, setelah restart, scheduler mengirim sendiri email "data September 2026 belum ada" ke PIC metrik uji (tercatat `SENT` di `px_reminder_log`).

---

## 🎞️ 15. Transkrip Video — "Coba Lagi" & Teks Lengkap — v2.24.1 (2026-10-11)

**Regression suite: 130 test** (127 + **Modul 32**, 3 test) → **130/130 PASS** di SQL Server dan di JSON. Modul 32 memakai API transkrip palsu (port 8000 atau `TEST_TRANSCRIBE_PORT`) dan **dilewati bila Video Extractor asli sedang berjalan** di port itu. Untuk menjalankannya saat layanan asli hidup: jalankan backend kedua dengan `TRANSCRIBE_API_URL=http://127.0.0.1:8123 PORT=5002`, lalu `TEST_BASE_URL=http://localhost:5002 TEST_TRANSCRIBE_PORT=8123 node tests/regressionTest.js`.

| Modul 32 | Jenis | Yang diuji |
| :--- | :---: | :--- |
| Retry end-to-end | Positif | layanan mati → upload FAILED; retry → **503** "tidak aktif" & status tetap FAILED; layanan hidup → 202 PROCESSING → DONE; `transcript` = `text` API persis; 2 segmen utuh (start/end/text); bahasa & durasi |
| Tanpa `text` | Positif | teks lengkap dirakit dari segmen, segmen tidak berubah |
| Input salah | Negatif | PROCESSING → 409; media tak ada → 404 (foto → 400 di Modul 27) |

---

## 🏷️ 16. Satuan Nilai Aktual Metrik — v2.25.0 (2026-10-13)

**Regression suite: 138 test** (130 + **Modul 33**, 8 test) → **138/138 PASS** di SQL Server (2×) dan JSON. Modul 33: setiap metrik punya `unit` (calculate & admin); #14 bukan `%` dan skor/status tidak berubah; endpoint detail memuat `unit`; default per skala + trim; edit `unit` terlihat di semua endpoint tanpa mengubah skor; `unit` kosong / 31 karakter → 400 (30 karakter diterima); POST `unit` kosong ditolak dan tidak menyimpan metrik; PUT metrik tak ada → 400.

**Bukti tidak ada regresi (di luar suite)**: kode commit sebelumnya (git worktree sementara, port terpisah) vs kode baru, database sama → **58/58 endpoint GET identik** selain field `unit`; teks nilai aktual 27 metrik rumus lama vs `formatMetricValue` → 26 identik, hanya #14 berubah.

---

## 🔐 17. Login, Role & Kontrol Akses — v2.26.0 (2026-10-15)

**Regression suite: 157 test** (138 + **Modul 34**, 19 test) → **157/157 PASS di SQL Server**. Sebelum perbaikan hasil QC suite berisi 153 test: 153/153 di SQL dan JSON; **JSON belum dijalankan ulang pada 157 test**. Karena kini semua `/api` butuh sesi, suite login dulu (cookie disisipkan otomatis ke setiap `fetch`).

| Variabel lingkungan | Fungsi |
| :--- | :--- |
| `TEST_ADMIN_USER` / `TEST_ADMIN_PASSWORD` | Akun Admin yang dipakai suite (buat dengan `npm run auth:create-admin`). **Wajib di backend JSON**; di SQL bila kosong, suite membuat Admin sementara dengan password acak dan menghapusnya di akhir. Jangan menaruh nilainya di repo |
| `TEST_VITE_URL` | Alamat Vite untuk tes proxy (default `http://localhost:3000`); tes dilewati otomatis bila Vite tidak berjalan |

| Modul 34 (19 test) | Jenis | Yang diuji |
| :--- | :---: | :--- |
| Login & sesi | Positif | cookie `httpOnly`+`SameSite=Strict`, `/me` tanpa secret; akun baru wajib ganti password (403 `PASSWORD_CHANGE_REQUIRED`), password lemah ditolak; logout mematikan sesi di server |
| Kredensial salah | Negatif | salah password / user tak dikenal / kosong → pesan generik (tanpa user enumeration), 400 bila kosong; 5× salah mengunci akun walau password benar sesudahnya, reset membuka kunci |
| Tanpa login | Negatif | contoh tiap area → 401, juga `/uploads` dan `/exports`; form publik (direktori, event by code, absensi, feedback) tetap jalan; `/health` tanpa detail database; `Origin` asing pada request tulis → 403 |
| Role | Positif/Negatif | USER 403 di semua `/api/admin/*` dan aksi admin-only; USER hanya direktoratnya (kosong/ALL/miliknya diterima, lain 403 pada calculate/trends/detail) |
| Data responden | Negatif | USER tidak melihat identitas responden (detail, metrik #11, evidence CSV, responses) dan **tidak ada nama responden di seluruh payload** (pemindaian penuh termasuk `verbatim_samples` bersarang, alerts, events); kode akses partner tidak keluar dari lookup publik |
| Signature Event | Positif/Negatif | Admin dan USER direktorat pengelola (dari setting database) boleh menulis; USER lain 403 tetapi bisa membaca |
| Manajemen user | Positif/Negatif | validasi role/direktorat/divisi dari direktori, duplikat, username salah; tidak bisa mengunci diri sendiri; user nonaktif tertutup |
| Audit | Positif | login berhasil/gagal/terkunci, logout, perubahan akun tercatat; tidak ada password di log/respons; username tak dikenal tanpa teks mentah |
| Metrik non-karyawan | Positif | USER melihat #1-#5 sebagai agregat bankwide read-only sama dengan tampilan Admin ALL; indeks direktorat USER = tampilan Admin untuk direktorat itu |
| Proxy Vite | Positif/Negatif | login lewat proxy `:3000` sampai ke handler (401, bukan ditolak sebagai lintas-origin) dan Origin asing tetap 403 — dilewati bila Vite mati |
| Unit | Positif/Negatif | hash scrypt ber-salt dan hanya cocok dengan password benar; helper scope/identitas; rate limiter memblokir lalu kedaluwarsa |

Cakupan yang **tidak** diuji otomatis: tampilan UI per role (diperiksa QC di Browser pane), perilaku di belakang HTTPS/`TRUST_PROXY`, dan rate limit setelah restart (di memori).

---

## 🎯 18. Cakupan Data User Fleksibel — v2.27.0 (2026-10-15)

**Regression suite: 166 test** (157 + **Modul 35**, 9 test) → **166/166 PASS di SQL Server dan di JSON**. QC: LULUS DENGAN CATATAN. Parity SQL vs JSON hanya pada perilaku, **bukan angka** (data `store.json` lama berbeda dari data SQL). Modul 35 mencari sendiri satu direktorat dengan dua divisi yang punya respons (A; divisi X, Y) dan dua direktorat lain berdata (B, C) dari data yang ada.

| Modul 35 (9 test) | Jenis | Yang diuji |
| :--- | :---: | :--- |
| Satu direktorat penuh | Positif | `px_index`/`survey_index`/`outcome_index`, tiap metrik karyawan (skor + sampel), seri trend, dan alert User = tampilan Admin untuk direktorat itu |
| Dua direktorat | Positif | satu agregat gabungan: sampel metrik = A + B, rata-rata = rata-rata terbobot sampel (toleransi 0,02); `filter_options.scopes`; menyempitkan ke B = tampilan Admin B; #1-#5 sama dengan Admin bankwide |
| Subset divisi | Positif/Negatif | data hanya divisi yang diizinkan; divisi/direktorat di luar cakupan → 403 pada calculate, trends, detail, alerts (10 URL); Admin tidak dibatasi |
| Cakupan campuran | Positif | sebagian divisi A + semua B = union; `/me` mengembalikan cakupan efektif |
| Alert dalam cakupan | Negatif | skor alert dihitung dari data dalam cakupan, berbeda dari bankwide; komentar verbatim persis komentar responden dalam cakupan (upload + feedback event) |
| Event & identitas | Positif/Negatif | absensi/feedback non-pengelola mengikuti cakupan, `total_attendees` konsisten; tidak ada nama responden di payload |
| Validasi cakupan | Positif/Negatif | 12 input salah → 400 tanpa menyimpan; penggabungan duplikat; `divisions: []` = semua; bentuk lama `directorate`+`division`; Admin dengan cakupan; update ditolak tidak mengubah apa pun; ADMIN <-> USER |
| Perubahan cakupan | Positif | berlaku langsung pada sesi terbuka (403 lama, 200 baru), `USER_SCOPE_CHANGE` tercatat tanpa password, aturan pengelola event mengikuti cakupan |
| Migrasi & unit | Positif/Negatif | `legacyUserScopes`, `normalizeScopes`, `scopeAllows`, `rowInScopes`, `resolveScope`, `isInScope`; di SQL: baris v2.26.0 dikonversi `migrateLegacyUserScopes()` (idempoten, tidak menimpa, cascade saat hapus akun); bagian SQL dilewati di JSON |

**Tidak diuji / tidak terverifikasi**: tampilan mobile; daftar cakupan panjang yang membuat kolom `target` audit terpotong; User "semua divisi" dengan `sub_directorate` tak dikenal (hasil 200 data kosong, bukan 403 — diketahui).

---

## 🧑‍💼 19. PIC Metrik Terhubung ke Akun — v2.27.1 (2026-10-15)

**Regression suite: 177 test** (166 + **Modul 36**, 11 test) → **177/177 PASS di SQL Server**. Di JSON 174/174 dijalankan **sebelum perbaikan kecil terakhir** dan **belum diulang**. QC: LULUS DENGAN CATATAN.

| Modul 36 (11 test) | Jenis | Yang diuji |
| :--- | :---: | :--- |
| Identitas PIC | Positif | email akun == `pic_email` (beda huruf) → daftar metrik, template, riwayat miliknya; `can_upload` benar di calculate/detail (Admin semua SURVEY; non-PIC tidak pernah) |
| Upload PIC | Positif | teks dan multipart; `uploaded_by` = akun; `SURVEY_UPLOAD` tercatat tanpa data responden; tanpa `calculation`; CSV sementara terhapus; kolom `metric_id` di CSV tidak menulis ke metrik lain |
| Penolakan | Negatif | PIC → 403 untuk metrik lain di template/upload/evidence/responses; non-PIC 403; `ALL`/kosong/malformed tidak membuka apa pun |
| Validasi upload | Negatif | NIP kosong dan rating di luar rentang ditolak per baris; CSV tanpa baris valid tidak menyimpan batch |
| Identitas responden | Positif/Negatif | PIC melihat identitas hanya untuk metrik dan cakupannya sendiri (detail, responses, evidence); metrik lain dan non-PIC tetap tersamar |
| Hak berlaku langsung | Positif/Negatif | ubah `pic_email`/email akun mencabut dan memberi hak tanpa login ulang; akun nonaktif terkunci; Admin tidak terpengaruh |
| Layar Admin | Positif | `active_account_emails` di Parameter Admin dan `pic_metrics` di Kelola User; PIC tidak mendapat layar Admin |
| CSV injection | Negatif | teks berawalan `= + - @` ditulis dengan apostrof di evidence; nilai biasa/angka tidak berubah |
| ID evidence/responses | Negatif | Admin dengan id salah/tak ada → 400/404; evidence master tetap jalan |
| Error JSON | Negatif | upload melebihi batas → 413 JSON; body JSON rusak → 400 JSON, tanpa HTML/stack trace |
| Reminder | Positif | daftar reminder tidak berubah oleh hak PIC (tetap ke `pic_email`, tanpa secret) |

**Tidak diuji / tidak terverifikasi**: NIP kembar (importer tidak menolaknya — celah lama, belum diputuskan), tanggal survei tidak valid, pengiriman email reminder asli, tampilan UI (hanya diperiksa QC di Browser pane), JSON setelah perbaikan terakhir.

---

## 🔑 20. Password Awal Standar — v2.27.2 (2026-10-15)

**Regression suite: 182 test** (177 + **Modul 37**, 5 test). Modul 37 **hanya berjalan di SQL Server** dan di-skip di JSON: ia memasang `registerAuthRoutes` pada app express sementara di proses test (port acak) di atas database yang sama dan mengatur `process.env.DEFAULT_INITIAL_PASSWORD` sendiri dengan nilai acak per run (tidak ada password asli di repo). Akun uji dibersihkan di `finally`. Hasil suite penuh: lihat laporan QC/developer (tidak diverifikasi oleh penulis dokumen ini).

| Modul 37 (5 test) | Jenis | Yang diuji |
| :--- | :---: | :--- |
| Akun baru dengan env terisi | Positif | `temporary_password` = password awal, `is_default_password: true`, `must_change_password`; login berhasil tetapi endpoint lain `403 PASSWORD_CHANGE_REQUIRED`; pengganti lemah ditolak; pengganti kuat diterima dan password awal mati |
| Ganti ke password awal | Negatif | `400` ("awal standar"), password tidak berubah |
| Reset password | Positif | memakai password awal, `must_change_password`, membuka akun yang terkunci (5 gagal) |
| Kebocoran | Negatif | password awal tidak ada di audit log maupun daftar user |
| Env kosong/spasi/tidak ada | Positif | kembali ke password acak yang lolos kebijakan, berbeda tiap kali, `is_default_password: false` |

---

## 🤖 21. AI Summary Video (Gemma) — v2.28.0 (2026-10-15)

**Regression suite: 195 test di SQL Server** (angka dari laporan QC; penulis dokumen ini tidak menjalankan ulang suite); **177 di JSON**, karena Modul 37 dan Modul 38 di-skip di JSON — dari Modul 38 hanya 2 tes validator offline yang berjalan. **Modul 38 = 15 tes** (setelah perbaikan hasil QC). Modul 34: tes lockout diperbaiki agar tidak mengasumsikan password sementara >= 10 karakter. Catatan: hitungan statis baris `runTest` di `tests/regressionTest.js` tidak persis sama dengan 182 + 15; angka resmi di dokumen ini mengikuti laporan QC.

Modul 38 (SQL Server) menjalankan **backend kedua** (`PX_DISABLE_SCHEDULERS=1`) di atas database yang sama dengan **Ollama palsu** (`OLLAMA_HOST`) dan **API transkrip palsu** (`TRANSCRIBE_API_URL`) dalam proses test — suite tidak pernah memanggil Gemma asli. Dua tes pertama (validator) murni offline dan jalan di kedua backend.

| # | Jenis | Yang diuji |
| :-: | :---: | :--- |
| 1 | Negatif | Validator menolak angka/kata bilangan karangan (enam -> sepuluh bulan, dua -> tiga kali, seminggu -> setahun, six -> ten, twice -> three times), termasuk di poin |
| 2 | Positif | Kata bilangan/digit setara yang ada di transkrip diterima; ringkasan Gemma asli yang tersimpan (video user) tidak ditolak berlebihan |
| 3 | Positif | Saat boot hanya ringkasan `PROCESSING` yang dilanjutkan (tepat 1 panggilan); video lama tanpa ringkasan tidak diproses |
| 4 | Positif | Page load, buka event, dashboard, alerts, health, upload foto, PPT: **nol** request ke Ollama |
| 5 | Positif | Video baru: upload dijawab langsung, transkrip `DONE` memicu tepat 1 panggilan; tersimpan sumber `AI`, model, bahasa, waktu |
| 6 | Positif | Video berbahasa Inggris diringkas dalam bahasa Inggris |
| 7 | Negatif | Angka/nama karangan ditolak: 1 retry menyebut fakta yang salah, lalu `RULE`; tidak ada yang dikarang tersimpan |
| 8 | Positif | Jawaban pertama salah, retry bersih dipakai (sumber `AI`, 2 panggilan) |
| 9 | Negatif | Ollama mati (koneksi putus) atau model belum ada: upload dan transkrip tidak terganggu, jatuh ke `RULE` dengan alasan jelas |
| 10 | Positif | Transkrip panjang diringkas per bagian lalu digabung; jawaban akhir dicek terhadap seluruh transkrip |
| 11 | Negatif | Transkrip terlalu pendek: `INSUFFICIENT`, nol panggilan |
| 12 | Positif | Tombol manual: pengelola membuat ringkasan video lama (202 `PROCESSING` -> `DONE`, tepat 1 panggilan) |
| 13 | Negatif | Manual: User non-pengelola 403 (nol panggilan), tanpa login 401, foto 400, tak dikenal 404, transkrip belum `DONE` 409 |
| 14 | Positif | User biasa dapat membaca ringkasan; ringkasan tidak memuat identitas responden |
| 15 | Positif | PPT dibuat dari data tersimpan saja (tetap nol panggilan Ollama) |

**Tidak diuji / keterbatasan**: Video Extractor asli (:8000) tidak diuji end-to-end oleh QC; Gemma asli hanya dicoba satu kali pada video user (±53 dtk); teks di slide PPT tidak diperiksa secara visual (slide media hanya 3 media); distorsi semantik halus dan negasi dapat lolos validator.

---

## 🗂️ 22. Survey Source (SYSTEM / ESS) & Upload Manual Semua Survei - v2.29.0 (2026-10-16)

**Regression suite: 207 test di SQL Server** dan **189 di JSON** (angka dari laporan QC; penulis dokumen ini tidak menjalankan ulang suite). Di JSON, Modul 37 dan 38 di-skip dan bagian top-up boot SQL dari Modul 39 di-skip. QC: LULUS DENGAN CATATAN, 0 bug fungsional. **Modul 39 = 10 tes**; **Modul 36 disesuaikan** (PIC metrik tanpa flag pengingat kini boleh upload: daftar `pic_metrics` / `picMetricIds` memuat metrik itu, `can_upload` true, `/api/surveys/metrics` PIC memuatnya; metrik tersebut dikeluarkan dari daftar yang harus 403). Catatan hitungan: 195 + 10 = 205 dan 177 + 10 = 187, sedangkan hasil QC 207 dan 189 - selisih 2 pada kedua backend belum dijelaskan; hitungan statis `await runTest(` di `tests/regressionTest.js` naik dari 187 ke 197.

| # | Jenis | Yang diuji (Modul 39) |
| :-: | :---: | :--- |
| 1 | Positif | `survey_source` terisi: tepat 11 metrik ESS (9, 13, 15, 16, 17, 18, 21, 22, 24, 25, 27), SURVEY lain `SYSTEM` (2, 5, 6, 7, 8, 10, 12, 23, 26), OUTCOME `null`; ESS ber-`requires_manual_upload`; ada di `calculate`, `detail` (level atas dan `metric`), `admin/parameters`, juga untuk User; `is_ess` / `ess_summary` mengikuti kolom |
| 2 | Negatif | Nilai `FOO`, `SYSTEMS`, `ES S`, `5`, `true`, `["ESS"]`, `{v}` -> 400 pada tambah dan ubah, juga untuk OUTCOME; permintaan yang ditolak tidak mengubah apa pun; `PUT` id 99999 -> 400 |
| 3 | Positif | Huruf kecil / spasi diterima; SURVEY mempertahankan atau mengganti nilai; OUTCOME selalu `null` (ESS yang dikirim diabaikan); SURVEY <-> OUTCOME menghapus / memberi sumber lagi |
| 4 | Negatif | ESS + `requires_manual_upload: false` -> 400 pada tambah, ubah (juga metrik asli 9, yang tidak berubah) dan saat berpindah ke ESS; ESS menyalakan flag; SYSTEM boleh `false`; keluar dari ESS melepas kunci |
| 5 | Positif | ESS dideteksi dari kolom, bukan kata "ESS" di `source_of_data` (kedua arah); mengganti teks tidak membalik; skor, nilai mentah dan status sama berapa pun sumbernya |
| 6 | Positif (SQL saja) | Top-up boot: `survey_source` `NULL` diisi (teks ESS -> `ESS`, lain -> `SYSTEM`), nilai admin tidak ditimpa, OUTCOME tetap `NULL`, ESS ber-flag mati dinyalakan, dijalankan dua kali tidak mengubah apa pun; `CHECK` database menolak `FOO`. Di-skip di JSON (backfill JSON tidak punya tes otomatis) |
| 7 | Positif | Admin mengunggah ke metrik SYSTEM/ESS dengan dan tanpa flag (upload, baris tersimpan, template, evidence, `can_upload`, `total_respondents`); template dan evidence menjawab 200 untuk ke-20 metrik SURVEY asli |
| 8 | Positif / Negatif | PIC metrik SYSTEM tanpa flag dan PIC metrik ESS dapat unggah (audit `SURVEY_UPLOAD`, tanpa `calculation`); non-PIC dan PIC metrik lain 403 di semua rute; OUTCOME 403; mengubah `pic_email` mencabut hak pada request berikutnya |
| 9 | Negatif | Sasaran bukan SURVEY (OUTCOME / id tidak dikenal, lewat form atau kolom CSV `metric_id`) tidak menyimpan baris apa pun; form menang atas kolom CSV |
| 10 | Positif | Pengingat tetap opt-in: metrik tanpa flag tidak pernah diingatkan walau batas lewat; metrik ber-flag dengan batas tanggal 1 masuk daftar; ke-11 ESS ada di himpunan kandidat pengingat |

Tes menghapus metrik ujinya lewat `tempMetricIds36` (metrik beserta datanya) di blok `finally`, lalu mencatat ke log bila masih ada metrik berawalan `REGRESSION PIC|SRC|UP` (hanya log, bukan assertion).

**Tidak diuji / tidak terverifikasi**: tampilan UI (diperiksa QC di Browser pane; mobile tidak); backfill JSON; pengiriman e-mail pengingat asli. **Temuan lama yang belum diperbaiki**: importer dengan `metric_id` form non-numerik jatuh ke metrik SURVEY pertama (rendah-sedang); "Latest Survey Date" modal detail memakai hari ini; `PUT /api/admin/metrics/<tak ada>` -> 400 bukan 404; NIP kembar belum ditolak.

---

## 🌐 23. UI Inggris, Label Opsi DB, Batas 120 Menit & Form Publik - v2.30.0 (2026-10-16)

**Regression suite: 217 test di SQL Server** (angka dari laporan developer, tanpa skip; penulis dokumen ini tidak menjalankan ulang suite). **JSON: 195/195 pada QC sebelum 4 tes Modul 40 terakhir ditambahkan** (Modul 37/38 di-skip di JSON, bagian top-up boot SQL dari Modul 39 di-skip); suite JSON **belum dijalankan ulang** untuk total terbaru, jadi tidak ada angka JSON yang diverifikasi untuk 217. QC pertama: LULUS DENGAN CATATAN; QC lanjutan: LULUS. **Modul 40 = 10 tes** (berjalan di SQL dan JSON); tes lama yang meng-assert teks Indonesia (pesan error, `month_name`, label) disesuaikan ke teks Inggris. Catatan hitungan: hitungan statis `await runTest(` di `tests/regressionTest.js` kini 207, sedangkan hasil developer 217 - selisih 10 yang sama polanya dengan v2.29.0 (statis 197 vs 207 hasil QC) dan belum dijelaskan; angka resmi mengikuti laporan developer/QC.

| # | Jenis | Yang diuji (Modul 40) |
| :-: | :---: | :--- |
| 1 | Positif | Katalog opsi di database (`metric_types`, `scale_types`, `target_audiences`, `update_frequencies`) tidak lagi membawa label default Indonesia; `value` tidak berubah (`SURVEY`/`OUTCOME`, `MONTHLY`/`ONE_TIME_ANNUAL`) |
| 2 | Positif | `upgradeLegacyOptionLabels()` mengganti HANYA label yang persis default Indonesia lama; hasil edit admin (termasuk beda satu spasi) dan seluruh `value` tetap; sudah Inggris -> `null`; katalog di luar daftar (`event_types`) tidak disentuh |
| 3 | Negatif | Input sampah (`null`, `undefined`, teks, angka, `{}`, `[null]`, `[{ value }]` tanpa label) tidak membuat `upgradeLegacyOptionLabels` melempar; key yang tidak dikenal -> `null` |
| 4 | Positif | `month_name` tren = nama bulan Inggris (`January` ... `December`); `month_code` `YYYY-MM` tidak berubah |
| 5 | Negatif | Sembilan respons 4xx (`POST /api/auth/login` kosong; `PUT /api/admin/settings/` dengan nilai tidak valid, key tak dikenal, dan `value` katalog diubah; `POST /api/surveys/upload` kosong; `POST /api/admin/survey-questions/99999`; `POST /api/media/<tak ada>/summarize`; login salah; `GET /api/metrics/calculate` tanpa login) berisi pesan Inggris tanpa kata Indonesia (regex `INDONESIAN` di tes) |
| 6 | Positif | Default batas waktu 120 menit = 7.200.000 ms: `DEFAULT_AI_TIMEOUT_MS`, `DEFAULT_TIMEOUT_MS` (transkrip); `OLLAMA_TIMEOUT_MS`, `TIMEOUT_MS`, `SUMMARY_JOB_TIMEOUT_MS` memakai default bila env tidak di-set (env masih bisa meng-override) |
| 7 | Positif | Mode publik dihitung sinkron dari URL: `getPublicCodes('?checkin=...')`, `getPublicCodes('?survey=...')`, `isPublicRoute()`; `App.jsx` memakai initializer `useState(() => getPublicCodes().checkin / .survey)` dan tidak lagi mengisi kode publik dari efek |
| 8 | Negatif | URL normal / parameter kosong / tidak terkait **bukan** halaman publik (gerbang login tetap berlaku) |
| 9 | Negatif | `Header.jsx` tidak membaca `user.scopes/full_name/username/role` di luar blok `{user && (...)}` dan memakai `user?.scopes` (regresi v2.27.0: crash saat `user` null) |
| 10 | Positif | Teks sisa menjadi Inggris: aturan Username/NIP (`authService.js`), `Password is too long.` (`emailSettingsService.js`), deskripsi ESS (`calculationEngine.js`), label PPT `[ Documentation #`, pemangkasan awalan `Documentation`/`Dokumentasi` di PPT, caption default media bukan Indonesia |

Tes 7-10 membaca kode sumber (`App.jsx`, `Header.jsx`, `pptGenerator.js`, `server.js`) dan mengimpor `publicRoute.js` sebagai modul ES; **bukan** render di browser.

**Harness**: jangan men-set `TEST_ADMIN_USER` / `TEST_ADMIN_PASSWORD` saat menjalankan suite di SQL Server (suite membuat admin sementara sendiri); keduanya hanya untuk backend JSON. Suite tetap mengotori backend aktif (di SQL: `node server/db/migrate.js --reset` - lihat catatan v2.24.1 tentang data video asli).

**Tidak diuji / tidak terverifikasi**: tampilan UI Inggris, header kanan atas, dan select Directorate/Sub-Dir pada lebar <= 500px (diperiksa QC di Browser pane; mobile tidak diuji di perangkat); batas 120 menit sungguhan (tes hanya memeriksa nilai default, tidak menunggu 2 jam); upload video besar lewat koneksi lambat; teks slide PPT secara visual. **Diketahui, belum diperbaiki**: `?survey=` dengan kode event pre-event menampilkan form tanpa pertanyaan (severity rendah); temuan lama v2.29.0 (importer `metric_id` form non-numerik, NIP kembar, dll.) tetap berlaku.

---

## 📁 24. Nama File Video Sesuai Unggahan & Allowlist Unggahan - v2.30.1 (2026-10-16)

**Regression suite: 251 test di SQL Server** (angka dari laporan developer, backend kedua, tanpa skip; penulis dokumen ini tidak menjalankan ulang suite). QC pertama (sebelum perbaikan temuan): **SQL 246/246** (Modul 38, khusus SQL, dijalankan penuh) dan **JSON 204/204**, uji end-to-end rename 38/38 - LULUS DENGAN CATATAN. Perbaikan temuan menambah 5 tes (allowlist, tes statis `MediaCard`, unggahan berbahaya, `a.html.mp4`, header `/uploads`): 246 + 5 = 251. **Suite JSON belum dijalankan ulang setelah perbaikan**, jadi tidak ada angka JSON terverifikasi untuk versi akhir. Verifikasi singkat QC atas perbaikan: LULUS DENGAN CATATAN, tanpa bug baru (filter 415, foto valid 201, header `/uploads`, kartu video dan lightbox, foto seed tanpa file tidak loop).

**Modul 41 = 34 tes di SQL Server, 7 di JSON** (dihitung dari kode: 31 pemanggilan `runTest` = 6 umum + 1 khusus JSON + 24 khusus SQL; pemanggilan dalam loop lima keadaan akhir berjalan 5x, jadi di SQL 6 + (24 + 4) = 34; di JSON 6 + 1 = 7 dan sisanya di-skip dengan pesan karena memakai database langsung dan backend kedua). Angka 251 = 217 (v2.30.0) + 34.

| Kelompok | Jenis | Yang diuji |
| :--- | :---: | :--- |
| Umum (6, SQL & JSON) | Positif | Aturan nama `sanitizeVideoFileName` (basename, karakter ilegal Windows, nama reservasi, titik/spasi, stem 150 karakter, ekstensi dari nama sementara); perbaikan mojibake latin1->UTF-8 (ASCII dan nama yang sudah benar tidak berubah); `resolveUploadPath` men-decode URL dan menolak di luar `server/uploads`; allowlist `mediaKindOfName` (hanya ekstensi terakhir; html/exe/svg/js/tanpa ekstensi = bukan media); tes statis `EventManager.jsx` (`MediaCard` mereset `broken`, `<video>`/`<img>` ber-`key`, input file tanpa `image/*`) |
| Umum | Negatif | Nama tanpa isi layak (kosong, titik saja, hanya karakter ilegal, hanya ekstensi) -> `null`, nama acak dipertahankan |
| JSON saja (1) | Positif | Whitelist `updateMedia` di kedua backend memuat `file_path` (pemeriksaan kode sumber) |
| SQL (5, loop) | Positif | Keadaan akhir `summary DONE (AI)`, `DONE (RULE)`, `INSUFFICIENT`, `FAILED`, dan `transcript FAILED`: file di-rename, `file_path` ter-encode, isi utuh, tersaji 200 |
| SQL | Positif | Idempoten (panggilan kedua tidak mengubah apa pun); tabrakan nama -> ` (1)`, ` (2)` dan dua job bersamaan mendapat nama berbeda; DELETE menghapus file bernama baru |
| SQL | Negatif | Tidak pernah rename saat belum final (transkrip `PROCESSING`, ringkasan `PROCESSING`, ringkasan belum dibuat/video lama, foto, job ringkasan antri/berjalan); nama yang dipakai record lain tidak dipakai ulang (case-insensitive); nama berbahaya (`../../x.mp4`, `a:b?.mp4`, `CON.mp4`, 400 karakter) tetap di dalam `server/uploads`; file hilang di disk -> tanpa error; OS menolak (`EPERM`/`EACCES`) -> hanya warning, `EBUSY` dicoba ulang sekali; update database gagal -> nama dikembalikan |
| SQL, backend kedua (palsu Ollama + Video Extractor) | Positif | `PX_DISABLE_RESUME=1` tidak mengambil alih video yang sedang diproses; `GET`/buka event/list event tidak me-rename video lama; video baru end-to-end: nama sementara bertahan selama proses lalu berganti; nama UTF-8; dua unggahan bernama sama; transkrip terlalu pendek (`INSUFFICIENT`); transkrip `FAILED` lalu "Try again" memakai path baru; Regenerate summary pada video lama; `DELETE /api/media/:id` menghapus file; MP4/JPG normal 201; `a.html.mp4` diterima dan berakhir `.mp4`; header `/uploads` (nosniff, CSP sandbox, `attachment` untuk non-allowlist, range 206, 401 tanpa sesi); cleanup tanpa sisa |
| SQL, backend kedua | Negatif | Unggahan berbahaya -> 415 tanpa file/record: `evil.html`/`clip.exe`/`x.js` sebagai `video/mp4` atau `image/png`, SVG (MIME apa pun), tanpa ekstensi, MIME tidak sama dengan ekstensi, ekstensi ilegal `.m<p4` |

**Harness**: Modul 38 dan 41 mensyaratkan **tidak ada video berstatus `PROCESSING`** di database; jalankan suite SQL **tanpa** `TEST_ADMIN_USER`/`TEST_ADMIN_PASSWORD`. Modul 41 membersihkan sendiri record dan file ber-stamp miliknya (tes terakhir memeriksa tidak ada sisa di `server/uploads`). Hitungan statis `await runTest(` kini 238 vs hasil jalan 251 (selisih 13 = +3 dari loop Modul 41 dikurangi tes khusus JSON, + 10 sisa lama yang belum dijelaskan sejak v2.29.0); angka resmi mengikuti laporan developer/QC.

**Tidak diuji / tidak terverifikasi**: rename pada file yang benar-benar terkunci program lain (hanya simulasi `EBUSY`/`EPERM`); perilaku UI (kartu menyegarkan diri setelah rename) di browser - hanya tes statis kode sumber dan pemeriksaan QC; entri di Video Extractor setelah rename (tidak berubah); kasus unggahan HEIC dari perangkat nyata. Jalankan JSON ulang sebelum merilis bila backend JSON dipakai.
