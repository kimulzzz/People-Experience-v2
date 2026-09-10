# 07. Testing & Quality Assurance
**CIMB Niaga People Experience (PX) Framework**

---

## 🧪 1. Strategi & Standar Pengujian Kualitas

Untuk menjamin akurasi komputasi finansial/HR perbankan, kepatuhan arsitektur, dan stabilitas operasional, sistem People Experience menerapkan **Automated Regression Testing Suite** yang mencakup seluruh lapisan komputasi mulai dari parsing file, validasi tipe data, normalisasi skor multi-tipe, hingga generasi berkas ekspor```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│              CIMB NIAGA PEOPLE EXPERIENCE - REGRESSION TEST SUITE                      │
├──────────────────────────┬─────────────────────────────┬───────────────────────────────┤
│    12 MODUL PENGUJIAN    │     36 AUTOMATED TESTS      │       100% PASS RATE          │
└──────────────────────────┴─────────────────────────────┴───────────────────────────────┘
```

---

## 📋 2. Rincian 12 Modul & 36 Skenario Pengujian

### 📦 Modul 1: Calculation Engine & Period Filtering (3 Test Cases)
1. **System Health Endpoint**: Memvalidasi status online server dan identitas sistem (`GET /api/health`).
2. **Formula PX Index YTD (Default)**: Memverifikasi kebenaran matematis formula $\text{PX Index} = 0.70 \times \text{Survey} + 0.30 \times \text{Outcome}$, serta menghitung 27 metrik, 17 checkpoint, dan 5 journey.
3. **Monthly Period Filtering**: Memverifikasi isolasi filter bulan spesifik (`2026-01` vs `2026-02`).

### 📦 Modul 2: Monthly Trends & Progression Engine (1 Test Case)
4. **12-Month Progression Series**: Memvalidasi endpoint `/api/metrics/trends` mengembalikan data lengkap 12 bulan dengan nilai PX Index, Survey Index, dan Outcome Index.

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
14. **Event Attendance & Feedback**: Menguji pencatatan absensi peserta dan submit evaluasi event.
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

================================================================
📊 REGRESSION TEST SUMMARY: 36/36 Tests Passed (0 Failed)
================================================================
```

---

### 3.2 Menjalankan Production Build Frontend
Untuk memverifikasi keutuhan kode frontend dan build bundle Vite:

```bash
npm run build
```

*Output yang diharapkan*: `built in X.XXs` dengan status 0 error.
