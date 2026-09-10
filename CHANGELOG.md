# Changelog - CIMB Niaga People Experience Integrated System

Semua perubahan dan pembaruan versi pada sistem People Experience (PX) Management & Scoring System dicatat di dalam dokumen ini mengikuti standar [Semantic Versioning](https://semver.org/).

---

## [2.9.0] - 2026-09-03

### 🎓 Non-Employee Correspondents Template & Ingestion (Metric #2 & Metric #5) (Added & Enhanced)
- **Dukungan Koresponden Non-Karyawan untuk 2 Metrik Survei Eksternal**:
  - **Metric #2 (`CIMB Niaga Goes to Campus - event evaluation / rating`)**:
    - Header template CSV dan ingestion disesuaikan khusus untuk mahasiswa/peserta kampus: `participant_id`, `participant_name`, `email`, `university`, `major`, `survey_date`, `q1`–`q5`, `verbatim_feedback`.
  - **Metric #5 (`Candidate Experience Survey Score`)**:
    - Header template CSV dan ingestion disesuaikan khusus untuk pelamar kerja/kandidat rekrutmen: `candidate_id`, `candidate_name`, `email`, `applied_position`, `recruitment_channel`, `survey_date`, `q1`–`q5`, `verbatim_feedback`.
- **Integrasi Penuh Layanan Backend (`surveyTemplateService.js`, `surveyImportService.js`, `surveyEvidenceService.js`, `storage.js`)**:
  - Download template dinamis berlabel `# MANDATORY, Nama, Email, Universitas/Posisi, Jurusan/Saluran, YYYY-MM-DD`.
  - Import CSV dengan parsing pintar dan isolasi field non-karyawan.
  - Export evidence CSV audit trail yang memuat detail identitas mahasiswa/kandidat.
- **Tampilan Dinamis Respondent Drilldown (`MetricDetailModal.jsx`)**:
  - Kolom tabel respon kuesioner menyesuaikan secara otomatis: menampilkan kolom *ID Peserta / Mahasiswa*, *Universitas*, dan *Jurusan* untuk Metric #2; serta *ID Kandidat*, *Posisi yang Dilamar*, dan *Saluran Rekrutmen* untuk Metric #5.

---

### 📅 Separated Period Filter (Year & Month) & View Modes (YTD vs MTD) (Added & Enhanced)
- **Pemisahan Dropdown Tahun dan Bulan di Header (`Header.jsx`)**:
  - Dropdown **Tahun** (misal: `2026`, `2025`) dan Dropdown **Bulan** (Januari s/d Desember) kini berdiri sendiri secara terpisah untuk mempermudah navigasi data.
- **Mode Tampilan Ganda (YTD vs MTD Toggle)**:
  - **Year to Date (YTD)**: Mengkalkulasikan seluruh data tahun berjalan secara agregat kumulatif.
  - **Month to Date (MTD)**: Mengkalkulasikan data khusus pada bulan yang dipilih pada dropdown periode.
  - **Disable Dinamis**: Ketika mode tampilan YTD aktif, dropdown pilihan bulan dinonaktifkan secara otomatis (disabled) dengan tampilan transparan dan tooltip informatif.
- **Dukungan Backend Terstandarisasi (`calculationEngine.js`, `storage.js`, `server.js`)**:
  - Parsing query parameter `mode=YTD|MTD`, `year=2026`, `month=01..12` secara independen tanpa menimpa format ISO tanggal.

---

### 🏛️ Directorate & Sub-Directorate Filter with Dynamic Metric Exclusion (Added & Enhanced)
- **Filter Direktorat dan Sub-Direktorat Bankwide (`Header.jsx`, `Dashboard.jsx`, `Calculator.jsx`)**:
  - Menghadirkan pilihan 7 Direktorat Bank CIMB Niaga lengkap dengan Sub-Direktorat / Divisi terkait:
    1. *Information Technology* (Core Banking, Digital Banking, Enterprise Architecture, dll.)
    2. *Consumer Banking* (Branch Banking, Wealth Management, Consumer Lending, dll.)
    3. *Commercial & Corporate Banking* (Corporate Banking, Commercial Banking SME, Transaction Banking, dll.)
    4. *Risk Management* (Enterprise Risk, Credit Risk, Market & Operational Risk, dll.)
    5. *Human Resources* (PXCWB, Talent Acquisition, HRBP, TLD, Reward, Exit IR, dll.)
    6. *Finance & Operations* (Financial Planning, Treasury Operations, Central Operations, dll.)
    7. *Internal Audit & Legal* (Internal Audit, Legal Counsel, Corporate Secretarial, dll.)
  - Nilai default adalah **"All" (Bankwide)**.
- **Eksklusi Metrik Non-Karyawan & Normalisasi Bobot Dinamis (`calculationEngine.js`)**:
  - Metrik diberi penanda `is_employee_metric` (True untuk metrik internal karyawan #6–#27, False untuk metrik eksternal/non-karyawan #1–#5).
  - Ketika filter Direktorat/Sub-Direktorat dipilih, seluruh metrik non-karyawan (#1 s/d #5) ditandai `is_disabled: true`, ditampilkan dengan **warna abu-abu (muted grey)**, tidak dapat diklik (*unclickable* / `cursor-not-allowed`), dan **dieksklusikan dari perhitungan agregat Journey & Total People Experience Index**.
  - Bobot metrik yang aktif (*active weights*) dinormalisasi ulang secara otomatis ke basis 100%.

---

### ⚙️ Unified Admin Parameter Management (Journey & Metric CRUD with Weights & Thresholds) (Added)
- **Modal Terpadu Pengaturan Parameter (`AdminParametersModal.jsx`)**:
  - Menyatukan manajemen Journey, Metrik, Bobot (*Weights*), Target, dan Ambang Batas (*Min Thresholds*) ke dalam satu antarmuka admin yang komprehensif.
  - **Tab Journeys**: Tambah, edit kode, nama, tagline, warna, ikon, dan urutan tampilan journey.
  - **Tab Metrics**: Tambah dan edit metrik secara lengkap (nama, tipe, skala, target value, target display, min threshold, bobot, penanda metrik karyawan `is_employee_metric`, target audience, dan butir pertanyaan).
  - **Aksi Cepat Reset ke Standar Korporat**: Tombol *Reset ke Default* untuk mengembalikan seluruh konfigurasi metrik dan journey ke standar bankwide.
- **REST API Endpoints Terintegrasi (`server.js`, `storage.js`)**:
  - `GET /api/admin/parameters`
  - `POST /api/admin/journeys`, `PUT /api/admin/journeys/:id`, `DELETE /api/admin/journeys/:id`
  - `POST /api/admin/metrics`, `PUT /api/admin/metrics/:id`, `DELETE /api/admin/metrics/:id`
  - `POST /api/admin/parameters/reset`

---

### 🧪 Automated Regression Testing & Quality Assurance
- **16 Modules & 48 Automated Tests Passed (100% Pass Rate)**:
  - Pengujian mencakup perhitungan PE Index, tren bulanan, drilldown detail, template kuesioner, import CSV, ekspor bukti audit, target & ambang batas, rekomendasi AI alert, registrasi event, separasi outcome vs survey, kuesioner ESS 11 dimensi, normalisasi tanggal ISO, koresponden non-karyawan, filter periode YTD/MTD, filter direktorat, dan manajemen CRUD parameter admin.
- **Frontend Production Build**: `npm run build` sukses 100% tanpa error.

---

## [2.8.6] - 2026-09-01

### 📅 Corporate Standard Date Normalization (YYYY-MM-DD Standardization) (Fixed & Enhanced)
- **Automatic Multi-Format Date Parsing & Normalization Engine (`normalizeDateString`)**:
  - Mengimplementasikan modul normalisasi tanggal terpusat di seluruh backend (`storage.js`, `calculationEngine.js`, `surveyImportService.js`, `surveyEvidenceService.js`) dan frontend (`Calculator.jsx`, `MetricDetailModal.jsx`).
  - Secara cerdas mendeteksi dan mengonversi semua variasi format tanggal input/upload (seperti format US Excel `M/D/YYYY` contoh: `3/31/2026`, format Indonesia `DD/MM/YYYY`, `DD-MM-YYYY`, `YYYY/MM/DD`, maupun ISO string) menjadi format standar korporat ISO `YYYY-MM-DD` (`2026-03-31`).
- **Pembersihan & Sanitasi Data Tersimpan (`store.json`)**:
  - Mengaudit dan menyelaraskan seluruh data histori survei dan tanggapan di `store.json` (termasuk `response_id: 415` yang sebelumnya tersimpan dengan format non-standar `3/31/2026` telah disanitasi menjadi `2026-03-31`).
- **Konsistensi Visual & Tampilan Tanggal pada Seluruh Komponen UI**:
  - **Calculator Table (`Calculator.jsx`)**: Kolom *Date / Last Sync* menjamin seluruh tanggal survei maupun data operasional outcome ditampilkan seragam dan rapi dalam format `YYYY-MM-DD`.
  - **Metric Detail Modal (`MetricDetailModal.jsx`)**: Tampilan *Latest Survey Date* dan riwayat tabel respon individual kuesioner kini menampilkan tanggal dengan format standar `YYYY-MM-DD`.
  - **Audit Evidence CSV Export (`surveyEvidenceService.js`)**: File CSV bukti audit yang diunduh mencatat kolom `Tanggal_Survei_Dilakukan` dengan format ISO `YYYY-MM-DD`.
- **Pengujian Regresi Otomatis (Module 12)**:
  - Menambahkan Module 12 pada `tests/regressionTest.js` untuk memverifikasi validitas format `YYYY-MM-DD` pada seluruh metrik terhitung dan pengetesan live upload CSV dengan format `3/31/2026` yang terkonversi otomatis menjadi `2026-03-31`.
  - Hasil Pengujian: **36/36 Automated Regression Tests Passed (100% Pass Rate)**.

---

## [2.8.5] - 2026-09-01

### 📈 Full 0% – 100% Percentage Scale & Color Differentiation for PX Index vs Outcome (Enhanced & Fixed)
- **Full Y-Axis Scale from 0% to 100% on Trend Chart (`TrendChart.jsx`)**:
  - Mengubah batas sumbu Y grafik performa tren 2026 dari skala terbatas sebelumnya (yang menyebabkan garis terpotong di bawah grafik saat skor rendah) menjadi **skala penuh 0% sampai 100%**.
  - Menghadirkan garis grid horizontal terstruktur pada `[0%, 20%, 40%, 60%, 80%, 85% Target, 100%]` dengan batas bawah kokoh di 0%, sehingga seluruh pergerakan garis metrik (PX Index, Survey, Outcome) terlihat jelas dan tidak pernah terpotong.
  - Memperluas area grafik dengan `chartHeight = 220px` dan padding proporsional agar grafik tampak lapang dan nyaman dipandang.
- **Diferensiasi Warna Kontras Tinggi untuk PX Index vs Outcome vs Survey**:
  - **PX Index (Consolidated 100%)**: Diberi warna **Corporate Primary Red** (`#ED1C24` / `#FF0000`) dengan ketebalan garis 3.5px, dot merah berbingkai putih, dan teks tebal.
  - **Outcome Metrics (30%)**: Diberi warna **Royal Blue / Corporate Cobalt** (`#2563EB`) dengan ketebalan 2.5px, dot biru, dan teks biru untuk membedakannya secara tegas dan jelas dari warna merah PX Index.
  - **Survey Results (70%)**: Diberi warna **Digital Teal** (`#16C0B7` / `#0D9488`) dengan ketebalan 2.5px dan dot teal.
  - **Target Benchmark**: Diberi garis putus-putus **Deep Maroon** (`#780000`) di 85.0%.
- **Harmonisasi Kartu Scorecard Dashboard (`Dashboard.jsx`)**:
  - Menyelaraskan kartu skor *Outcome Metrics (30%)* di Dashboard banner dengan border `border-blue-500/30`, badge `bg-blue-500/20 text-blue-300`, teks `text-blue-400`, dan progress bar biru `bg-[#2563EB]`.
- **Verifikasi Kualitas & Regresi**:
  - `npm run build`: Build sukses 100% tanpa error.
  - `tests/regressionTest.js`: 34/34 Automated Tests Passed (100% Pass Rate).

---

## [2.8.4] - 2026-09-01

### 🌟 ESS (Employee Sentiment Survey) Question Summary Scores & Spreadsheet View (Added & Enhanced)
- **11 ESS Survey Metrics Integration with Contextual Questions & Dimensions**:
  - Mengintegrasikan seluruh 11 metrik survei yang bersumber dari data ESS (Employee Sentiment Survey) dengan butir pertanyaan kontekstual dan dimensi resmi perbankan CIMB:
    1. `Role Clarity & DS Support Score Index` (Metric #9) — Dimensi: *Employee Commitment* (3 questions)
    2. `Pride & Work Environment Index` (Metric #13) — Dimensi: *Pride & Work Environment* (4 questions)
    3. `Manager Recognition Index` (Metric #15) — Dimensi: *Recognition & Appreciation* (3 questions)
    4. `Wellbeing Index` (Metric #16) — Dimensi: *Employee Wellbeing* (3 questions)
    5. `Psychological Safety Index` (Metric #17) — Dimensi: *Psychological Safety & Risk Mindset* (4 questions)
    6. `Leadership Connection Score` (Metric #18) — Dimensi: *Agility & Decision Making* (6 questions)
    7. `Career Growth & Learning Index` (Metric #21) — Dimensi: *Career Growth & Learning* (3 questions)
    8. `Capability & Enablement Index` (Metric #22) — Dimensi: *Capability & Enablement* (3 questions)
    9. `Performance Feedback Quality Index` (Metric #24) — Dimensi: *Performance Feedback & Development* (3 questions)
    10. `Meaningful Contribution Index` (Metric #25) — Dimensi: *Purpose & Meaningful Contribution* (3 questions)
    11. `Intent to Stay Index` (Metric #27) — Dimensi: *Employee Commitment* (3 questions)
- **Pixel-Perfect Excel/Spreadsheet Table View in Metric Detail Drilldown Modal**:
  - Menghadirkan tampilan tabel spreadsheet persis seperti format ekspor Excel ESS resmi:
    - **Header Ungu Korporat** (`#563175` / `#663A8B`): Grup kolom *"Scored question"* (*Dimension*, *Question*, *Question is visible based on*, *Question is required based on*) dan kolom metrik sentimen (*% Favorable*, *% Neutral*, *% Unfavorable*).
    - **Baris Total Dimensi (Bold Summary Row)**: Menampilkan kalkulasi agregat kepuasan karyawan per dimensi.
    - **View Mode Switcher**: Memungkinkan pengguna beralih antara *Spreadsheet View (Excel Table)* dan *Card View (Progress Bars)* secara mulus.
- **ESS Survey (70%) Badge di Tabel 27 Metrik Kalkulator**:
  - Menambahkan pill badge khusus `ESS SURVEY (70%)` berpalet ungu lembut di tabel utama [`Calculator.jsx`](file:///d:/Mul/Project/Anti%20Gravity/People%20Experience/src/components/Calculator.jsx) untuk memudahkan identifikasi 11 metrik sentimen tahunan.
- **Ekspansi Modul Regression Testing (34/34 Tests Passed - 100%)**:
  - Menambahkan pengujian otomatis komprehensif di [`tests/regressionTest.js`](file:///d:/Mul/Project/Anti%20Gravity/People%20Experience/tests/regressionTest.js) (Module 11) untuk memvalidasi dimensi, kalkulasi persentase favorable, jumlah butir pertanyaan, dan visibilitas pada seluruh 11 metrik ESS.

---

## [2.8.3] - 2026-09-01

### 🌟 High-Definition Official CIMB Niaga Emblem & Typography Update (Changed)
- **Integrasi Logo Resmi Terbaru dari User Asset (`media_1788236452675.png`)**:
  - Mengganti aset logo `public/cimb-niaga-logo.png` dengan logo resmi CIMB Niaga terbaru dengan ikon lencana kotak merah bergradien dan tipografi burgundy (*CIMB NIAGA*) berlatar putih bersih.
  - Memperbarui komponen [`CimbLogo.jsx`](file:///d:/Mul/Project/Anti%20Gravity/People%20Experience/src/components/CimbLogo.jsx) dengan penyesuaian ukuran proporsional responsif (`h-9 sm:h-10 max-w-[220px]`).
  - Menyelaraskan seluruh dokumentasi Markdown (`docs/05_FRONTEND_UI_AND_COMPONENT_HIERARCHY.md`, `docs/README.md`, `docs/07_TESTING_AND_QUALITY_ASSURANCE.md`, `walkthrough.md`) dengan penamaan baku **PX** (People Experience) dan verifikasi 27/27 Regression Tests Passed.

---

## [2.8.2] - 2026-09-01

### 🌟 Official Company Digital Color Palette Integration (Added & Changed)
- **Harmonisasi Palet Warna Resmi Perusahaan (CIMB Brand Digital Guidelines)**:
  - Mengimplementasikan seluruh palet warna resmi perusahaan dari pedoman identitas digital ke dalam arsitektur UI sistem PX:
    - **Primary Colours**:
      - `Primary Red` (`R255 G0 B0` / `#FF0000`): Warna brand utama, PX Consolidated Index, tombol CTA krusial, indikator aktif.
      - `Deep Maroon` (`R120 G0 B0` / `#780000`): Garis batas aksen eksekutif, target threshold line, bayangan gradien header.
      - `Cool Gray` (`R167 G169 B172` / `#A7A9AC`): Border gridlines tabel, teks metadata sekunder, pemisah konten.
    - **Secondary Colours (Charts, Illustrations, Icons)**:
      - `Pure White` (`R255 G255 B255` / `#FFFFFF`): Latar belakang kartu kontras tinggi, permukaan widget.
      - `Coral Red` (`R245 G87 B85` / `#F55755`): Kartu skor Outcome Metrics (30%), garis tren metrik operasional HR.
      - `Blush Pink` (`R248 G177 B176` / `#F8B1B0`): Efek hover halus, penanda data proyeksi / benchmark.
    - **Web Colours (Tertiary - Digital Platform ONLY)**:
      - `Amber Orange` (`R247 G144 B30` / `#F7901E`): Journey 2 (Connect / Onboard) & Watchlist alert cards.
      - `Digital Teal` (`R22 G192 B183` / `#16C0B7`): Survey Index (70%), Journey 4 (Contribute / Work), Download Template pills.
      - `Magenta` (`R193 G0 B157` / `#C1009D`): Journey 5 (Depart / Exit) & Status verifikasi akhir.
      - `Royal Purple` (`R103 G22 B196` / `#6716C4`): Journey 3 (Belong / Culture), Total Sample counter, Evidence export pills.
      - `Bright Orange` (`R255 G128 B0` / `#FF8000`): Journey 1 (Arrival / Hire) & Tombol Upload Survey.
  - **Pembaruan Berkas & Komponen**:
    - [`src/index.css`](file:///d:/Mul/Project/Anti%20Gravity/People%20Experience/src/index.css): Deklarasi variabel CSS `:root` untuk semua palet warna resmi.
    - [`src/components/Header.jsx`](file:///d:/Mul/Project/Anti%20Gravity/People%20Experience/src/components/Header.jsx): Top accent gradient bar `#FF0000` via `#F55755` to `#780000`.
    - [`src/components/Dashboard.jsx`](file:///d:/Mul/Project/Anti%20Gravity/People%20Experience/src/components/Dashboard.jsx): Scorecard Survey (Digital Teal) & Outcome (Coral Red).
    - [`src/components/TrendChart.jsx`](file:///d:/Mul/Project/Anti%20Gravity/People%20Experience/src/components/TrendChart.jsx): Garis tren 12 bulan PX Index (`#FF0000`), Survey (`#16C0B7`), Outcome (`#F55755`), dan Target (`#780000`).
    - [`src/components/Calculator.jsx`](file:///d:/Mul/Project/Anti%20Gravity/People%20Experience/src/components/Calculator.jsx): Tab filter journey dan highlight status dengan palet resmi.
    - [`server/db/seedData.js`](file:///d:/Mul/Project/Anti%20Gravity/People%20Experience/server/db/seedData.js) & `server/data/store.json`: Pembaruan warna 5 tahapan employee journey.
- **Interactive Generative UI Palette Showcase Widget**:
  - Dibuat berkas interaktif [`cimb_palette_showcase.html`](file:///C:/Users/mh02174X/.gemini/antigravity/brain/f68ece52-fc47-4f3e-a3ea-c02cfaead37d/cimb_palette_showcase.html) untuk visualisasi langsung swatch RGB/Hex dan integrasinya pada web PX.

---

## [2.8.1] - 2026-09-01

### 🌟 Official CIMB Niaga Logo Asset Integration (Changed & Improved)
- **Integrasi Logo Resmi Beresolusi Tinggi (Official Brand Asset)**:
  - Mengintegrasikan logo resmi CIMB Niaga dari tautan yang ditentukan (*Download Free PNG 1600x992*) ke dalam sistem melalui komponen [`CimbLogo.jsx`](file:///d:/Mul/Project/Anti%20Gravity/People%20Experience/src/components/CimbLogo.jsx) dan berkas statis `public/cimb-niaga-logo.png`.
  - Mengimplementasikan mekanisme *triple-redundant fallback*:
    1. Berkas lokal statis `public/cimb-niaga-logo.png` (performa instan tanpa beban jaringan luar).
    2. Tautan eksternal langsung `https://1.bp.blogspot.com/-xWjQErvF_k4/YTBiJ78HTGI/AAAAAAAAARY/RsPergEAVGsC9VqIVBD2GYkdeGkgic2ZgCLcBGAsYHQ/s0/CIMB%2BNiaga%2BLogo%2B-%2BDownload%2BFree%2BPNG.png`.
    3. SVG vektor murni (*resilient geometric fallback*).
  - Mengaplikasikan logo resmi pada:
    - Navbar Header Utama ([`Header.jsx`](file:///d:/Mul/Project/Anti%20Gravity/People%20Experience/src/components/Header.jsx)).
    - Formulir Presensi Pra-Event ([`PublicCheckInForm.jsx`](file:///d:/Mul/Project/Anti%20Gravity/People%20Experience/src/components/PublicCheckInForm.jsx)).
    - Formulir Evaluasi Post-Event ([`PublicFeedbackForm.jsx`](file:///d:/Mul/Project/Anti%20Gravity/People%20Experience/src/components/PublicFeedbackForm.jsx)).
    - Favicon & metadata browser ([`index.html`](file:///d:/Mul/Project/Anti%20Gravity/People%20Experience/index.html)).

---

## [2.8.0] - 2026-09-01

### 🌟 Outcome Metrics Ingestion Date & Full English Internationalization (Changed & Improved)
- **Outcome Metrics Last Ingestion / Entry Date Display (`Calculator.jsx`, `calculationEngine.js`)**:
  - Diperbarui agar seluruh metrik, baik kategori **Survey** (sumber CSV/ESS) maupun **Outcome** (sumber HRIS/Scheduler feeds seperti SLA Rekrutmen, Turnover Rate, Employee Referral Hire, Internal Movement Ratio, Signature Program Attendance, Exit Interview Fulfillment), menampilkan tanggal riil data terakhir masuk (`last_survey_date`, misal: `2026-03-24`) pada badge kolom *Status / Last Entry Date*.
  - Menghilangkan placeholder teks statis dan memastikan transparansi audit trail untuk data scheduler/transaksional HR.
- **100% English Language Translation Across Entire Application (Full Localization)**:
  - Mengubah seluruh teks antarmuka, label tabel, navigasi, modal, formulir, status badges, tooltip, dan pesan alert ke dalam **Bahasa Inggris (English)** standar korporat secara komprehensif:
    - **Header & Navigation (`Header.jsx`)**: Tab switcher (*Executive Dashboard, PX Index Calculator, Signature Events, Action Library*), Period selector (*Year-to-Date 2026, Monthly Periods Jan - Dec 2026*), Action toolbar (*Survey Templates, Set Targets, Adjust Weights, Bulk Survey CSV*).
    - **Dashboard Summary View (`Dashboard.jsx`)**: Executive hero title, overall scorecards (*PX Index, Survey Index 70%, Outcome Index 30%, Total Response Sample*), Journey Cards (*Hire, Onboard, Work, Move, Exit*), Deficit alerts banner, Top performers, and Priority gap interventions.
    - **PX Index Calculator Table (`Calculator.jsx`)**: Column headers (*Metric Name & Owner, Journey Checkpoint, Type & Data Source, Target, Min Threshold, Raw Result, Weight, Normalized Score, Contribution, Status / Last Ingestion Date, Actions & Docs*), Density toggles (*Fit Screen, Wide View*), Horizontal quick scroll controls (*Scroll Left, Scroll Right*), and Filter bar.
    - **Metric Detail & ESS Modal (`MetricDetailModal.jsx`)**: Deep-dive analytics, ESS dimension sentiment breakdown (*Favorable, Neutral, Unfavorable*), Survey questions breakdown table, Respondent demographics, and Historical audit logs.
    - **Admin Question Templates (`AdminSurveyQuestionsModal.jsx`)**: Question types (*Scale 1 - 5, Scale 1 - 10, Yes / No Binary [Score 100 / 0], Free Text Response*), Add/Edit/Delete actions, Question ordering, CSV Template download preview, and Validation alerts.
    - **Admin Target Settings (`AdminSettingsModal.jsx`) & Dynamic Weights (`WeightsModal.jsx`)**: Editable target values, minimum thresholds, journey filters, equal weight reset controls, and toast confirmation alerts.
    - **Survey Import & Data Center (`SurveyImportModal.jsx`)**: Tab controls (*1. Download CSV Template, 2. Upload Survey Data, History*), Column specifications, Dropzone, and Live recalculation status reports.
    - **Signature Events & PPT Generator (`EventManager.jsx`, `CreateEventModal.jsx`, `QrCodeModal.jsx`)**: Event creation modal, Execution formats (*Hybrid, Offline, Online*), Pre-event attendance check-in, Post-event evaluation questionnaires, Photo/video documentation gallery, AI descriptions, and Automated PowerPoint export.
    - **Public Registration & Evaluation Forms (`PublicCheckInForm.jsx`, `PublicFeedbackForm.jsx`)**: Check-in forms, Rating inputs, Verbatim textareas, and Submission success feedback.
    - **Action Library & Fallback Error Boundary (`ActionLibraryView.jsx`, `ErrorBoundary.jsx`, `TrendChart.jsx`)**: Intervention action cards, Structured initiatives, Crash boundary fallback, and Interactive monthly performance trend charts.
- **Automated Regression Suite Verification (`tests/regressionTest.js`)**:
  - Seluruh 11 modul pengujian regresi mencakup 27 test cases berhasil dieksekusi dengan status **100% Pass** (27/27 tests passed).

---

## [2.7.1] - 2026-09-01

### 🌟 Peningkatan UX: Freeze / Sticky Action Column & Horizontal Scroll Navigator (Improved & Added)
- **Freeze / Sticky Right Action Column (`Calculator.jsx`)**:
  - Mengimplementasikan kolom `Aksi & Dokumen` yang terkunci/terfiksasi secara *sticky* di sisi kanan tabel (`sticky right-0`).
  - Pengguna **tidak perlu lagi melakukan scroll horizontal ke dasar halaman** hanya untuk mengklik tombol `Template`, `Evidence`, `Upload`, atau `Detail`. Seluruh tombol aksi selalu tampil melayang (*floating anchored*) di posisi terdepan dengan bayangan elevasi (*elevation shadow*) dan latar responsif.
- **Navigasi Scroll Horizontal Cepat (Quick Scroll Controls)**:
  - Menyediakan tombol pemandu arah `Geser Kiri (←)` dan `Geser Kanan (→)` langsung pada toolbar tabel di atas tanpa perlu menggulir ke scrollbar browser di dasar halaman.
  - Indikator status otomatis mendeteksi batas geser tabel secara dinamis.
- **Fitur Density View Switcher ("Fit Layar" vs "Luas")**:
  - Opsi mode tampilan **Fit Layar (`fit`)**: Merampingkan padding dan lebar kolom sehingga seluruh 27 metrik tabel pas secara proporsional dalam layar desktop/laptop standar tanpa perlu scroll horizontal sama sekali.
  - Opsi mode tampilan **Luas (`wide`)**: Tampilan lapang untuk layar monitor resolusi tinggi atau ultra-wide.
- **Sticky Table Header & Row Drilldown Preview**:
  - Header tabel tetap terkunci di bagian atas saat menggulir 27 baris metrik (`sticky top-0`).
  - Baris metrik memiliki efek hover halus dan dapat langsung diklik pada titik mana pun untuk membuka detail tanpa harus mengklik tombol khusus.

---

## [2.7.0] - 2026-09-01

### 🌟 Standardisasi PX (People Experience) & Logo Resmi CIMB Niaga (Changed & Added)
- **Standardisasi Singkatan Resmi PX (People Experience)**:
  - Mengubah seluruh singkatan *People Experience* dari **PE** menjadi **PX** di seluruh antarmuka web, navigasi header, kartu scorecards, visualisasi diagram tren performa, formula indeks, respons API (`px_index`), pesan notifikasi, dan dokumentasi sistem.
  - Tetap menyediakan alias backwards-compatible `pe_index` pada endpoint backend `/api/metrics/calculate` dan `/api/metrics/trends`.
- **Integrasi Logo Resmi CIMB Niaga (`CimbLogo.jsx`)**:
  - Mengimplementasikan logo korporat resmi CIMB Niaga dengan lambang chevron merah khas (*corporate emblem*) dan tipografi presisi (*CIMB NIAGA*), menggantikan ikon generic sebelumnya.
  - Menyertakan fallback visual SVG vektor beresolusi tinggi untuk keandalan tampilan offline maupun online.

### 🌟 Integrasi Data ESS (Employee Sentiment Survey) & Rangkuman Dimensi (Added & Aligned)
- **Penyelarasan Dimensi & Butir Pertanyaan ESS**:
  - Mengintegrasikan butir pertanyaan resmi instrumen ESS beserta dimensi sentimen:
    1. **Agility & Decision Making** (Rerata Favorable: 88.4%, 5 Pertanyaan: *Equipped to handle changes*, *Decisions made without undue delay*, *Adapts to external environment*, *Implements better ways*, *Changes & adapts to stay competitive*).
    2. **Career Growth & Learning** (Rerata Favorable: 90.7%, 3 Pertanyaan: *Opportunity to learn & grow*, *Right skills to deliver strategy*, *Capability to achieve goals*).
    3. **Employee Commitment** (Rerata Favorable: 85.5% - 92.3%, Pertanyaan: *Stay at CIMB*, *Pride in company*, *Role expectation*, *Manager recognition*, *Manager support*).
    4. **Escalation & Risk Mindset** (Rerata Favorable: 96.0%, 3 Pertanyaan: *Escalate issues outside resp*, *Escalating ensures root cause addressed*, *Know when issue is serious*).
- **Dedicated ESS Dimension Summary Card (`MetricDetailModal.jsx`)**:
  - Menampilkan panel kartu sentimen korporat yang memuat *Overall Favorable Score*, rincian badge sentimen (*% Favorable, % Neutral, % Unfavorable*), dan diagram batang horizontal bersusun (*Stacked Sentiment Bar*) berwarna hijau-amber-merah.
  - Setiap butir pertanyaan ESS dilengkapi visualisasi distribusi sentimen karyawan yang presisi.

### 🧪 Quality Assurance & Regression Suite (Testing)
- **Automated Regression Suite (`tests/regressionTest.js`)**:
  - Penambahan **Module 11: ESS (Employee Sentiment Survey) Dimensions & Summary Scores**:
    - Validasi struktur dimensi dan skor ringkasan pada Metrik #18 (Agility & Decision Making: 88.4%), Metrik #21 (Career Growth & Learning: 90.7%), Metrik #9 (Employee Commitment), dan Metrik #17 (Escalation & Risk Mindset: 96.0%).
    - Validasi perhitungan `px_index` (70% Survey + 30% Outcome).
  - **Hasil Pengujian**: 27/27 Test Cases Passed (100% Pass Rate).

---

## [2.6.0] - 2026-08-31

### 🌟 Fitur Baru: Menu Admin Setting Pertanyaan & Template Survei Multi-Tipe (Added)
- **Menu Admin "Template Survei" (`AdminSurveyQuestionsModal.jsx`)**:
  - Menyediakan panel administrasi visual interaktif untuk mengelola butir pertanyaan, bobot/skala nilai, dan format template survei untuk seluruh 20 metrik survei.
  - Akses langsung via tombol *"Template Survei"* di top navbar (Header) dan tombol shortcut *"Atur Pertanyaan Survei (Admin)"* di modal rincian metrik.
  - Fitur pengelolaan:
    1. **Pilihan Metrik Survei**: Dropdown selector untuk berpindah antar metrik survei.
    2. **Editor Butir Pertanyaan**: Edit Label Singkat, Teks Lengkap Pertanyaan, Tipe Jawaban, dan Status Mandatory.
    3. **Reordering & Susunan**: Tombol *Move Up / Move Down* untuk mengubah urutan butir pertanyaan.
    4. **Tambah & Hapus Pertanyaan**: Fleksibilitas menambah butir pertanyaan baru atau menghapus pertanyaan yang tidak diperlukan.
    5. **Live CSV Header Preview**: Menampilkan secara real-time baris header CSV dan baris contoh data yang akan di-generate.
    6. **Download CSV Template Langsung**: Mengunduh berkas template survei yang langsung sinkron dengan konfigurasi aktif.
    7. **Reset ke Template Standar**: Tombol reset untuk mengembalikan pertanyaan ke default baku CIMB Niaga.
- **Dukungan 4 Tipe Pertanyaan & Format Skoring**:
  1. `SCALE_1_5`: Skala 1 - 5 (Rating numerik 1.0 - 5.0, dinormalisasi `(val/5)*100`).
  2. `SCALE_1_10`: Skala 1 - 10 (Rating numerik 1.0 - 10.0, dinormalisasi `(val/10)*100`).
  3. `YES_NO`: Jawaban Ya / Tidak (Skor biner: `Ya` = 100%, `Tidak` = 0%).
  4. `FREE_TEXT`: Jawaban Bebas / Komentar Kualitatif (non-scorable, dikecualikan dari perhitungan rerata indeks numerik, ditampilkan sebagai verbatim insight).
- **Template Resmi Metrik #7 (Day 1 Onboarding Satisfaction Index)**:
  - Dikonfigurasi dengan 15 butir pertanyaan lengkap sesuai arahan:
    - Q1: *Kepuasan Proses Rekrutmen* (Skala 1-5)
    - Q2: *Pengalaman Wawancara Unit Bisnis* (Skala 1-5)
    - Q3: *Pengalaman Hari Pertama Bekerja Keseluruhan* (Skala 1-5)
    - Q4: *Ketertarikan Welcome Kit CIMBian Starter Pack* (Skala 1-5)
    - Q5: *Kepuasan Sesi Meet & Greet CIMB Niaga* (Skala 1-5)
    - Q6: *Penerimaan Welcoming Email* (Ya/Tidak)
    - Q7: *Dihubungi Atasan Langsung/Buddy Pra-Day 1* (Ya/Tidak)
    - Q8: *Disambut Atasan Langsung Hari Pertama* (Ya/Tidak)
    - Q9: *Disambut Buddy Hari Pertama* (Ya/Tidak)
    - Q10: *Penerimaan Welcome Kit CIMBian Starter Pack (Goodie Bag)* (Ya/Tidak)
    - Q11: *Penerimaan ID Card* (Ya/Tidak)
    - Q12: *Penerimaan PC/Laptop Hari Pertama* (Ya/Tidak)
    - Q13: *SMS Kredensial User ID & Password* (Ya/Tidak)
    - Q14: *Pendampingan Aktivasi LAN/VPN/Email* (Ya/Tidak)
    - Q15: *Kelancaran Akses Sistem Hari Pertama* (Ya/Tidak)
- **Engine Template CSV Dinamis (`surveyTemplateService.js`)**:
  - Format instruction header dan baris sample otomatis disesuaikan dengan tipe pertanyaan (angka `5.0`, angka `9.5`, string `"Ya"`, atau teks komentar).
- **Engine Parser Impor CSV Cerdas (`surveyImportService.js`)**:
  - Menerima variasi input jawaban Ya/Tidak (`"Ya"`, `"Y"`, `"1"`, `"True"`, `"Yes"`, `"Tidak"`, `"T"`, `"0"`, `"False"`, `"No"`).
  - Normalisasi nilai otomatis ke skor 100 atau 0.
  - Pencocokan nama kolom fleksibel berdasarkan key maupun urutan urutan (`q1`, `q2`, dst.).
- **Visualisasi Question Breakdown Multi-Tipe (`MetricDetailModal.jsx`)**:
  - Untuk `YES_NO`: Menampilkan persentase `% Ya`, badge Ya vs Tidak dengan jumlah responden, dan progress bar.
  - Untuk `SCALE_1_5` & `SCALE_1_10`: Menampilkan rerata numerik, badge skala, dan progress bar indeks.
  - Untuk `FREE_TEXT`: Menampilkan counter respon kualitatif dan kartu sampel komentar karyawan.

### 🧪 Quality Assurance & Regression Suite (Testing)
- **Automated Regression Suite (`tests/regressionTest.js`)**:
  - Penambahan **Module 10: Admin Survey Questions & Multi-Type Questions Engine**:
    - Pengujian API endpoint Admin (`GET/POST /api/admin/survey-questions`).
    - Validasi struktur 15 butir pertanyaan resmi Metrik #7 (Q1-Q5 Skala 1-5, Q6-Q15 Ya/Tidak).
    - Validasi generasi template CSV 15 pertanyaan dan petunjuk format nilai.
    - Validasi upload respon campuran Skala 1-5 & Ya/Tidak (kalkulasi biner 100/0).
    - Validasi fitur update kustom dan tombol reset ke default.
  - **Hasil Pengujian**: 23/23 Test Cases Passed (100% Pass Rate).

---

### 🌟 Peningkatan UX: Keterangan & Label Interaktif Tombol Aksi (Added & Improved)
- **Label & Pill Button Eksplisit pada Setiap Baris Metrik (`Calculator.jsx`)**:
  - Mengganti icon-button polos yang tidak memiliki teks dengan **Pill Buttons Berlabel Lengkap & Berwarna Khusus**:
    1. 📥 **Template (`bg-emerald-50 text-emerald-700`)**: Tombol *"Template"* dengan ikon download dan tooltip: *"Download Template CSV Format Standar Pertanyaan"*.
    2. 📑 **Evidence (`bg-purple-50 text-purple-700`)**: Tombol *"Evidence"* dengan ikon file dan tooltip: *"Download Dokumen Bukti & Data Respon Koresponden"*.
    3. 📤 **Upload (`bg-blue-50 text-blue-700`)**: Tombol *"Upload"* dengan ikon spreadsheet dan tooltip: *"Unggah File CSV Respon Baru"*.
    4. 👁️ **Detail (`bg-rose-50 text-rose-700`)**: Tombol *"Detail"* dengan ikon mata dan tooltip: *"Buka Detail Butir Pertanyaan, Rata-rata Skor & List Koresponden"*.
    5. 👁️ **Lihat Detail & Log HR (`bg-blue-50 text-blue-700`)**: Tombol khusus untuk metrik tipe Outcome.
- **Banner Petunjuk / Legend Tombol Aksi di Atas Tabel (`Calculator.jsx`)**:
  - Menyediakan strip banner pemandu **"Keterangan Tombol Aksi"** yang menjelaskan secara visual fungsi ke-4 tombol aksi (Template, Evidence, Upload, Detail) sehingga pengguna langsung memahami tujuan masing-masing tombol sebelum mengkliknya.
- **Penyempurnaan Tombol Aksi Cepat pada Modal Rincian (`MetricDetailModal.jsx`)**:
  - Memperjelas tombol aksi dengan judul dan sub-caption:
    - **Unduh Template** (*Format CSV Standar*)
    - **Unduh Evidence** (*Bukti Respon Karyawan*)
    - **Upload Survei** (*Impor Berkas CSV*)

### 🧪 Quality Assurance & Regression Suite (Testing)
- **Automated Regression Suite (`tests/regressionTest.js`)**:
  - Menjalankan 18 automated test suite mencakup seluruh modul perhitungan, period filtering, template generator, import parser, evidence downloader, admin settings, dan separation of outcomes vs surveys.
  - **Hasil Pengujian**: 18/18 Test Cases Passed (100% Pass Rate).

---

## [2.4.0] - 2026-08-31

### 🌟 Refaktor & Pemisahan Konseptual: Metric Outcome vs Metric Survey (Added & Refactored)
- **Definisi & Perlakuan Metrik Tipe OUTCOME (Data HR Internal CIMB)**:
  - Metrik Outcome (7 metrik operasional: SLA Rekrutmen, Leadtime TAT H-14, SLA Approval Workday, Rasio Sukses Kanal Rekrutmen, Partisipasi Signature Program, Total Penerima Rekognisi Arjuna, dan Early Attrition Rate) **didefinisikan secara tegas sebagai Data HR Internal**, bukan instrumen survei kuesioner.
  - **Penghapusan "Total Responden" pada Metrik Outcome**:
    - Kolom Sampel/Responden pada tabel *Metrics Explorer* (`Calculator.jsx`) kini menampilkan badge resmi **`Data Internal HR`** dan **`Sistem Bank`** (tanpa embel-embel jumlah responden survei).
    - Pada `MetricDetailModal.jsx`, summary card disesuaikan menampilkan **`Sistem Sumber Data HR`** (misal: *Arjuna HRIS, PXCWB Registration, LMS*) dan **`Experience Owner`** (misal: *Talent Acquisition, PXCWB, HRBP*).
    - Tombol aksi survei (*Download Template*, *Download Evidence*, dan *Upload CSV Respon*) disembunyikan untuk metrik Outcome.
  - **Tab Rincian Parameter & Log Transaksi HR Sistem CIMB**:
    - Tab 1: **Parameter & Indikator Capaian HR Internal** (menampilkan spesifikasi pengukuran, unit penanggung jawab, skala nilai, dan target direksi).
    - Tab 2: **Log & Data Transaksi Internal CIMB** (menampilkan data absensi peserta terverifikasi untuk Program Event #11, serta rincian breakdown capaian SLA / segmen per departemen untuk Outcome #1, #2, #3, #4, #14, #25).
- **Metrik Tipe SURVEY (Respon Survei Karyawan)**:
  - Tetap mempertahankan **Total Koresponden**, **Tanggal Survei Dilakukan**, chip pill rating per butir pertanyaan (`Q1`, `Q2`, `Q3`, dst.), **List Koresponden & Isi Survei**, **Download Evidence (CSV)**, serta **Template CSV & Upload Respon**.
- **Penyelarasan Tampilan Dashboard**:
  - Kartu skor konsolidasi menyajikan penjelasan sumber data yang jelas:
    - **Survey Results (70%)**: *"Didapat dari berbagai instrumen survei (ESS, Onboarding, Arjuna Survey, Evaluasi Event) baik otomatis maupun upload berkas."*
    - **Outcome Metrics (30%)**: *"Didapat dari data internal HR CIMB (SLA Rekrutmen, Arjuna Recognition, Kehadiran Program Event, Retensi & Turnover)."*

### 🧪 Quality Assurance & Regression Suite (Testing)
- **Automated Regression Suite (`tests/regressionTest.js`)**:
  - Penambahan **Module 9: Outcome vs Survey Metrics Separation & Validation**:
    - Validasi bahwa seluruh metrik Outcome mengembalikan `total_respondents: null`, `is_survey: false`, `is_outcome: true`, dan memuat `operational_records`.
    - Validasi bahwa metrik Survey mengembalikan `total_respondents > 0`, `is_survey: true`, dan memuat `questions_breakdown`.
  - **Hasil Pengujian**: 18/18 Test Cases Passed (100% Pass Rate).

---

## [2.3.0] - 2026-08-31

### 🌟 Fitur Baru: Sub-Menu List Koresponden, Isi Survei & Download Evidence (Added)
- **Sub-Menu "List Koresponden & Isi Survei" pada Parameter Survei**:
  - Tampilan tab interaktif (`MetricDetailModal.jsx`) yang menyajikan daftar lengkap seluruh koresponden yang mengisi survei untuk metrik terkait.
  - Setiap baris koresponden memuat informasi komprehensif:
    1. **Tanggal Survei Dilakukan**: Tanggal pelaksanaan survei ditampilkan dengan badge kalender yang jelas (`YYYY-MM-DD`).
    2. **Identitas Koresponden**: NIP, Nama Karyawan, dan Email resmi CIMB Niaga.
    3. **Unit Kerja**: Direktorat dan Divisi penugasan karyawan.
    4. **Isi Jawaban per Pertanyaan**: Menampilkan pill / chip skor individual untuk setiap butir pertanyaan (`Q1`, `Q2`, `Q3`, `Q4`, dst.) dengan warna indikator pencapaian dan tooltip teks pertanyaan lengkap.
    5. **Rata-rata Skor Koresponden**: Rerata nilai yang diberikan oleh koresponden.
    6. **Komentar / Verbatim Feedback**: Kutipan pesan, apresiasi, atau saran perbaikan yang ditulis oleh karyawan.
    7. **Sumber Data**: Keterangan asal data (`SEED_SURVEY`, `MANUAL_UPLOAD`, dsb.).
  - **Modal Rincian Individual (Drawer Detail)**: Mengklik baris koresponden membuka tampilan popup rincian penuh teks pertanyaan dan nilai jawaban satu per satu.
- **Fitur Download Data Evidence Survei (.CSV)**:
  - Tombol **"Download Evidence (CSV)"** yang terintegrasi di toolbar tab koresponden, di kotak *Aksi Cepat Data*, dan di tabel *Metrics Explorer* (`Calculator.jsx`).
  - Menghasilkan berkas CSV Audit Trail (`/api/surveys/evidence?metric_id={id}&period={period}`) berformat UTF-8 BOM yang memuat seluruh kolom identitas, tanggal survei, jawaban detail tiap pertanyaan, rata-rata skor, dan verbatim feedback untuk keperluan validasi / audit HR.
  - Opsi download Master Evidence untuk seluruh metrik survei sekaligus.

### 🧪 Quality Assurance & Testing (Testing)
- **Automated Regression Suite (`tests/regressionTest.js`)**:
  - Penambahan Module 5b: Pengujian otomatis download evidence CSV per metrik spesifik dan master evidence all-metrics.
  - **Hasil Pengujian**: 15/15 Test Cases Passed (100% Pass Rate).

---

## [2.2.1] - 2026-08-31

### 🛠️ Perbaikan & Penyesuaian UI (Fixed & Improved)
- **Perbaikan Duplikasi Header Template CSV**: Header kolom hanya dicetak tepat 1 kali di Baris 1.
- **Penataan Letak Tombol Download Template CSV per Metrik**: Tombol download template diletakkan secara kontekstual di tiap baris metrik tabel Metrics Explorer dan modal detail.

---

## [2.2.0] - 2026-08-31

### 🌟 Fitur Baru (Added)
- **Period Filter (Bulanan & Default Year-to-Date 2026)**.
- **Grafik Tren Bulanan Interaktif (Monthly Trend Series - 12 Bulan)**.
- **Metric Drilldown Detail & Question-Level Score Breakdown**.
- **Question-Based CSV Template & Parser Generator**.
- **Kalkulasi Murni Berbasis Data Survei**.
- **Menu Admin Pengaturan Target & Ambang Batas**.

---

## [2.1.0] - 2026-08-31

### 🌟 Fitur Baru (Added)
- **Modul Survey Data Center (Template & Bulk CSV Upload)**
- **Automated Regression Testing Suite**

---

## [2.0.0] - 2026-08-31

### 🌟 Rilis Awal (Initial Release)
- **PE Index Calculation Engine**: Agregasi 5 Journey, 17 Check Points, 27 Metrics.
- **Event Signature Programs Manager**: Absensi pra-event & survei evaluasi post-event.
- **PowerPoint (.pptx) Auto-Generator**: Slide presentasi korporat CIMB Niaga dengan narasi foto.
- **Alert & Action Library**: Deteksi metrik defisit di bawah ambang batas.
