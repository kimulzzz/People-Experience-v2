# 07. Testing & Quality Assurance
**CIMB Niaga People Experience (PX) Framework**

---

## 🧪 1. Strategi & Standar Pengujian Kualitas

Untuk menjamin akurasi komputasi finansial/HR perbankan, kepatuhan arsitektur, dan stabilitas operasional, sistem People Experience menerapkan **Automated Regression Testing Suite** yang mencakup seluruh lapisan komputasi mulai dari parsing file, validasi tipe data, normalisasi skor multi-tipe, hingga generasi berkas ekspor```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│              CIMB NIAGA PEOPLE EXPERIENCE - REGRESSION TEST SUITE                      │
├──────────────────────────┬─────────────────────────────┬───────────────────────────────┤
│    26 MODUL PENGUJIAN    │     88 AUTOMATED TESTS      │       100% PASS RATE          │
└──────────────────────────┴─────────────────────────────┴───────────────────────────────┘
```

---

## 📋 2. Rincian 26 Modul & 88 Skenario Pengujian

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

================================================================
📊 REGRESSION TEST SUMMARY: 88/88 Tests Passed (0 Failed)
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
