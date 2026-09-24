# Changelog - CIMB Niaga People Experience Integrated System

Semua perubahan dan pembaruan versi pada sistem People Experience (PX) Management & Scoring System dicatat di dalam dokumen ini mengikuti standar [Semantic Versioning](https://semver.org/).

---

## [2.17.0] - 2026-09-24

### 📖 Tab Baru: People Experience Glossary (Added)
- **Permintaan pengguna**: menambahkan tab kamus istilah People Experience, dengan tema visual yang nyambung dengan menu utama, bersumber dari daftar istilah yang sudah disiapkan pengguna di `docs/People_Experience_Glossary_Full_Text.xlsx` (44 istilah, format 2 kolom Istilah/Definisi).
- **Komponen baru `GlossaryView.jsx`**: menampilkan seluruh 44 istilah, dikelompokkan ke dalam 7 kategori — **Framework & Konsep Inti** (14, aksen Deep Maroon `#780000`), **Tools & Sistem** (3, Royal Blue `#2563EB`), dan 5 grup mengikuti Employee Journey yang sudah ada di seluruh aplikasi — **Arrival** (4, Orange `#FF8000`), **Connect** (8, Amber `#F7901E`), **Belong** (7, Purple `#6716C4`), **Contribute** (5, Teal `#16C0B7`), **Depart** (3, Magenta `#C1009D`) — memakai palet warna Journey yang identik dengan kartu Journey di Dashboard & filter di Explore Metrics (`docs/05` §4 CIMB Brand Digital Guidelines), sehingga tab ini terasa senada dengan menu utama, bukan halaman terpisah.
- **Pencarian & filter kategori**: search box mencocokkan nama istilah maupun isi definisi secara real-time; filter chip kategori memakai pola pill-button yang identik dengan filter Journey di Explore Metrics (warna solid saat aktif, badge jumlah istilah).
- **Navigasi**: tab baru "Glossary" (ikon `BookMarked`) ditambahkan ke `Header.jsx` mengikuti pola tab lain (Dashboard & Trends, Explore Metrics, Signature Program Events, Action Library & AI Alerts), dirutekan di `App.jsx` sebagai `activeTab === 'glossary'`.
- **Sepenuhnya frontend/statis** — tidak ada endpoint API baru; data istilah di-embed langsung di komponen (bersumber dari file Excel yang disediakan pengguna) karena kontennya adalah kamus istilah framework yang tidak berubah dari sesi ke sesi, bukan data operasional yang perlu di-CRUD dari database.
- **Verifikasi**: `node tests/regressionTest.js` → **88/88 PASS** (tidak ada perubahan backend). Dicek langsung di Browser: seluruh 44 istilah tampil terkelompok benar, pencarian ("recognition") mencocokkan lintas istilah & definisi dengan tepat, dan warna kategori tampil konsisten dengan Dashboard.

---

## [2.16.0] - 2026-09-22

### 🕵️ Audit Menyeluruh: Menghapus Sisa Hardcode di Seluruh Web (Fixed)
- **Permintaan pengguna**: *"tim auditor tolong bantu cek web nya apakah masih ada yang hardcode? saya sangat mengharapkan semua data yang ada di web diambil dari database tidak ada lagi yang hardcode."* Subagent **Auditor** dijalankan untuk pemindaian menyeluruh baru atas `server/services/*.js`, `server/server.js`, `server/db/storage.js`, dan komponen frontend terkait.
- **Temuan #1-2 — Tahun default frontend membekukan balikan fix backend**: `src/App.jsx`, `src/components/Header.jsx`, dan `src/components/Dashboard.jsx` masih menyimpan default `year: '2026'` pada state/props `filterOptions`, yang selalu dikirim ke backend di setiap request — sehingga **membatalkan** manfaat `CURRENT_YEAR` dinamis yang sudah diperbaiki di backend sejak [2.12.0]. Diperbaiki: ketiga file kini menghitung `CURRENT_YEAR = String(new Date().getFullYear())` dari jam browser, bukan literal beku.
- **Temuan #3-4 — Fallback tanggal "last survey/data date" beku ke kalender tertentu**: `calculationEngine.js` (backend) serta duplikasinya di `Calculator.jsx` dan `MetricDetailModal.jsx` (frontend) memakai `'2026-03-20'`/`'2026-03-24'` sebagai fallback ketika metrik/respons tidak punya tanggal nyata — akan tampil sebagai "tanggal update terakhir" yang beku selamanya begitu tanggal itu terlewat. Diperbaiki: fallback kini memakai tanggal hari ini yang sesungguhnya (`todayDateString()`), konsisten di ketiga file plus migrasi backfill di `storage.js`.
- **Temuan #5 — Tabel drilldown operasional untuk 5 metrik OUTCOME sepenuhnya hardcode inline**: `calculationEngine.js`'s `getMetricDetail()` mengembalikan array statis (breakdown SLA rekrutmen per unit, compliance approval stage, mix channel hiring, kategori recognition) langsung dari kode, tidak pernah bisa diedit admin dan tidak pernah berubah walau data lain berubah. Diperbaiki: data ini dipindahkan ke `seedData.js` sebagai `initialOperationalRecords` (mengikuti pola seed lain), disimpan di `store.json` via getter baru `storage.getOperationalRecords(metric_id)`, dan `calculationEngine.js` kini membacanya dari database alih-alih inline.
- **Temuan #6 — Kuota partisipasi Metrik #11 (Signature Program) hardcode ke `500`**: `syncLiveEventMetrics()` menormalisasi skor kehadiran event terhadap literal `500`, terpisah dari `target_value` Metrik #11 yang sebenarnya admin-editable via Parameter Admin — mengubah target di UI tidak berdampak pada kalkulasi skor live. Diperbaiki: kini membaca `storage.getMetricTargetById(11).target_value` secara langsung.
- **Temuan #7 — `total_respondents` ESS memakai angka fiktif `1250` saat data kosong**: ketika metrik ESS punya nol respons nyata, backend menampilkan "1250 respondents" yang sama sekali tidak berasal dari database, dan frontend punya bug ganda (`|| 1250` juga salah menganggap hitungan nyata `0` sebagai falsy). Diperbaiki: `totalRespondents` kini selalu memakai hitungan asli dari database (`responses.length`, bisa `0`), dan frontend memakai `?? 0` bukan `|| 1250`.
- **Temuan tambahan (ditemukan saat verifikasi manual, di luar cakupan Auditor)**: `storage.js`'s `applyResponseFilters()` ternyata masih membekukan default tahun ke `'2026'` di 4 titik terpisah — bug dari kategori yang sama seperti Temuan #1-2, namun di lapisan filter data, bukan di frontend. Diperbaiki dengan konstanta `CURRENT_YEAR` yang sama seperti `calculationEngine.js`.
- **Direview & dinilai tidak perlu diubah**: `server/db/seedData.js` (dataset demo/seed itu sendiri — memang dirancang statis, bukan bug), formula bobot 70% Survey + 30% Outcome (konstanta framework yang terdokumentasi), `REMINDER_LEAD_DAYS = 5` di `reminderService.js` (konstanta kebijakan aplikasi yang wajar, bukan data metrik), baris contoh tanggal di template CSV unduhan (`surveyTemplateService.js` — konten ilustratif untuk admin, bukan logika kalkulasi), dan fallback nilai default per-pertanyaan (90.0/9.0/4.5, dipakai hanya saat pertanyaan baru benar-benar nol respons DAN admin belum mengisi `percent_favorable` — kondisi darurat yang jarang terjadi, bukan data yang menutupi kondisi nyata).

### 🧪 Regression Testing — Module 26 Baru (Positive Testing)
- **3 test case baru**: memverifikasi tabel `operational_records` metrik OUTCOME (#1, #14) benar-benar bersumber dari database dan metrik OUTCOME tanpa tabel seed (#19) tidak crash; mengubah `target_value` Metrik #11 via Admin API benar-benar mengubah `normalized_score` live-nya (regression guard untuk bug kuota hardcode `500`); dan metrik baru dengan nol respons melaporkan `total_respondents: 0` yang jujur, bukan `1250` fiktif.
- **Verifikasi**: `node tests/regressionTest.js` dijalankan **2x berturut-turut** → **88/88 PASS** setiap kali (85 test sebelumnya + 3 test Modul 26 baru), dengan jumlah event tetap stabil di 2 (tidak ada kebocoran data test) di setiap run.

---

## [2.15.0] - 2026-09-22

### 🎯 Satuan Target & Threshold yang Tidak Nyambung di Admin Parameter (Fixed)
- **Laporan pengguna**: Di menu **Parameter Admin**, metrik "CIMB Niaga Goes to Campus — event evaluation / rating" menampilkan Target **4** tapi Threshold **75** — dua angka tidak sebanding karena beda satuan (Target dalam skala Likert 1-5, Threshold dalam persen 0-100), sehingga terlihat "tidak nyambung".
- **Root cause (bug fungsional, bukan cuma tampilan)**: `min_threshold` SELALU disimpan dalam persen (0-100) dan dibandingkan terhadap `normalized_score` (0-100) — itu benar. Tapi `target_value` disimpan dalam **satuan skala asli metrik** (mis. `4.00` untuk skala RATING_5), dan kode status di `calculatePEIndex()` serta `getMetricDetail()` (`calculationEngine.js`) membandingkannya **langsung** terhadap `normalized_score` (0-100) tanpa konversi. Akibatnya, untuk metrik berskala RATING_5/QUOTA_COUNT, status **WARNING nyaris tidak pernah bisa muncul** — `normalized_score` (tipikal 0-100) nyaris selalu lebih besar dari target mentah seperti `4`, jadi metrik cuma bisa lompat dari CRITICAL langsung ke HEALTHY.
- **Bug turunan yang ikut ditemukan**: Field `gap` (dipakai `alertEngine.js` untuk mengurutkan Score Deficit Alerts dari paling parah, dan dikutip `localAiService.js` dalam narasi "Gap Defisit: X%") dihitung sebagai `target_value_mentah - normalized_score` — untuk metrik RATING_5 ini menghasilkan angka negatif yang tidak masuk akal (mis. `4 - 80 = -76`) dan berpotensi mengacaukan urutan prioritas alert.
- **Fix**: Fungsi baru `normalizeTarget()` (`calculationEngine.js`) mengonversi `target_value` ke skala 0-100 yang sama dengan `normalized_score`, memakai logika konversi yang sama persis dengan `normalizeScore()` (RATING_5: `/5*100`; QUOTA_COUNT: tercapai target = 100%; PERCENTAGE/NUMERIC: dipakai apa adanya). Semua 3 titik perbandingan status (`calculatePEIndex()`, `getMetricDetail()` untuk OUTCOME & SURVEY) dan perhitungan `gap` kini memakai target yang sudah dinormalisasi ini — WARNING kini benar-benar bisa muncul untuk metrik berskala Likert/Quota, dan urutan Score Deficit Alerts menjadi akurat untuk semua tipe skala.
- **Field baru `target_value_normalized`**: ditambahkan ke response `/api/metrics/calculate`, `/api/metrics/:id/detail`, dan `/api/admin/parameters` — nilai target dalam persen (0-100), siap dipakai frontend tanpa perlu menghitung ulang.
- **UI Admin Parameter (`AdminParametersModal.jsx`)**: Kolom tabel "Target" kini menampilkan persentase (mis. **80.0%**) sebagai nilai utama dengan bentuk aslinya (`> 4.00 / 5`) sebagai subteks kecil — langsung sebanding dengan kolom "Threshold" (**75%**) di sebelahnya. Form Edit/Tambah Metrik kini memberi label satuan eksplisit ("Target Nilai (satuan skala asli — 1.0-5.0)" / "Min Threshold (selalu dalam %, 0-100)") plus hint hidup "≈ 80.0% dari skala penuh — nilai inilah yang dibandingkan langsung dengan Min Threshold di bawah" yang otomatis mengikuti perubahan input.
- **Bug default form ikut diperbaiki**: Form "Tambah Metrik Baru" sebelumnya punya default `min_threshold: 4.0` (jelas salah satuan — semestinya persen) — diperbaiki menjadi `75.0`, konsisten dengan konvensi seed data lain.

### 🧪 Regression Testing — Module 25 Baru (Positive Testing)
- **4 test case baru**: memverifikasi `target_value_normalized` untuk metrik RATING_5 sama dengan `target_value/5*100`; status HEALTHY/WARNING/CRITICAL untuk SEMUA metrik RATING_5/QUOTA_COUNT konsisten dengan perbandingan skor-vs-target yang sudah dinormalisasi (regression guard langsung untuk bug WARNING-tidak-pernah-muncul); `GET /api/admin/parameters` mengekspos `target_value_normalized` bernilai 0-100 untuk seluruh 27 metrik; dan `GET /api/metrics/:id/detail` mengekspos field yang sama untuk tipe SURVEY maupun OUTCOME.
- **Verifikasi**: `node tests/regressionTest.js` → **85/85 PASS**. Dicek manual di Browser: metrik #2 kini menampilkan Target **80.0%** (bentuk asli "> 4.00/5" sebagai subteks) berdampingan dengan Threshold **75%**; Score Deficit Alerts tampil dengan gap yang masuk akal (mis. "Gap defisit sebesar 99.7%" dan "13.4%", terurut benar dari paling kritis).

---

## [2.14.1] - 2026-09-18

### 🧹 Data Bekas Regression Testing di Menu Signature Program Event (Fixed)
- **Bug**: Menu **Signature Program Event** menampilkan data bekas regression testing yang tidak pernah dibersihkan — 9 event palsu ("Regression Test Event (Audit Fix Check)") ikut tampil di daftar event nyata, dan setiap kali suite regression dijalankan, event nyata `ev-perspektif-2024-q1` ikut kena tambahan absensi & feedback palsu ("Test Participant") karena tidak ada endpoint untuk menghapusnya kembali.
- **Root cause #1 — Event palsu**: Test Modul 21 (Score Deficit Alert) membuat event baru lewat `POST /api/events` di setiap run tanpa pernah menghapusnya, karena belum ada endpoint `DELETE /api/events/:id`.
- **Root cause #2 — Absensi & feedback palsu**: Test Modul 8 (Event attendance & post-event survey) melakukan check-in + submit feedback ke event nyata `ev-perspektif-2024-q1` di setiap run, tanpa mekanisme cleanup, karena belum ada endpoint untuk menghapus absensi/feedback per NIP.
- **Fix — Endpoint baru**: `DELETE /api/events/:id`, `DELETE /api/events/:id/attendance/:nip`, dan `DELETE /api/events/:id/feedback/:nip` ditambahkan di `server.js`, didukung fungsi `storage.deleteEvent()`, `storage.deleteAttendance()`, `storage.deleteFeedbackResponse()` di `storage.js` (masing-masing menolak dengan error 400 yang jelas jika data tidak ditemukan, bukan crash).
- **Fix — Test kini self-cleaning**: Test Modul 8 dan Modul 21 dibungkus `try/finally` — data yang mereka buat untuk keperluan pengujian **selalu dihapus kembali** di akhir test, apa pun hasil assertion-nya, mengikuti pola yang sama.
- **Pembersihan data lama**: 9 event bekas, 27 absensi palsu, dan 27 feedback palsu yang sudah terlanjur menumpuk di `store.json` dari run-run sebelumnya dihapus langsung. Ditemukan juga ~216 respons survei bekas upload CSV test (Modul 5/10/12/13) yang menumpuk di `surveyUploadedResponses` — turut dibersihkan (tidak berdampak ke tampilan menu manapun, tapi menambah beban penyimpanan tanpa guna).
- **Bug tambahan yang ditemukan & diperbaiki saat verifikasi**: `getMetricDetail()` (`calculationEngine.js`) memotong daftar respons ke 100 teratas **berdasarkan urutan penyimpanan**, bukan tanggal — begitu volume data seed 2025+2026 melebihi 100 respons per metrik, respons yang baru diupload bisa "hilang" dari tampilan Evidence karena kepotong urutan lama. Diperbaiki dengan mengurutkan berdasarkan tanggal terbaru dahulu sebelum dipotong ke 100.
- **Verifikasi**: Regression suite dijalankan 2x berturut-turut (81/81 PASS setiap kali) dan jumlah absensi/feedback/event pada `ev-perspektif-2024-q1` dikonfirmasi **tetap stabil** (5 absensi, 3 feedback, 0 event bekas test) sebelum dan sesudah setiap run — membuktikan tidak ada lagi kebocoran data test ke tampilan pengguna.

### 🧪 Regression Testing — Perbaikan Kebersihan Test (Test Hygiene) + Modul 24 Baru
- Modul 8 & Modul 21 kini membersihkan data yang mereka buat sendiri lewat `try/finally`, bukan meninggalkan jejak di database setiap kali suite dijalankan.
- **Modul 24 baru (5 test case)**: menguji endpoint `DELETE` baru secara langsung (2 positif: data benar-benar terhapus; 3 negatif: ID yang tidak ada mengembalikan 400 bersih, bukan crash).
- Total test naik dari 76 menjadi **81/81 PASS**.

---

## [2.14.0] - 2026-09-18

### 🗓️ Data Dummy 2025 & Filter Rentang Periode Lintas Tahun (Fixed & Added)
- **Bug**: Memilih tahun **2025** di dropdown Header menampilkan angka yang **selalu sama persis** apa pun tahun yang dipilih — karena tidak ada satu pun respons survei berlabel 2025 di database (`store.json`); sistem diam-diam jatuh ke nilai default `raw_value` bawaan tiap metrik (bukan hasil kalkulasi dari data sungguhan), terasa seperti "hardcode" dari sisi pengguna.
- **Fix — Dataset 2025 Penuh (`seedData.js`)**: Generator seed respons survei (`generateInitialSurveyResponses()`) diperluas menghasilkan **12 bulan penuh data 2025** (3 tanggal per bulan, memakai variasi & bobot normalisasi per-metrik yang sama seperti data 2026), di-merge non-destruktif ke `store.json` yang sudah ada saat server boot. Sekarang memilih 2025 menghasilkan `survey_index`/`px_index` yang **genuinely berbeda** dari 2026 (basis: respons sungguhan di database, bukan fallback statis).
- **Filter Rentang Periode Kini Lintas Tahun**: `computeMonthlyTrends()` ditulis ulang total — menerima `startYear`/`startMonth`/`endYear`/`endMonth` dan membangun daftar bulan kronologis yang **boleh melewati batas tahun** (mis. November 2025 s/d Februari 2026). Mode **YTD** tetap mengikuti konvensi pelaporan standar: kumulatif **reset tiap 1 Januari** (bukan menumpuk lintas tahun), sedangkan mode **MTD** trivial lintas tahun karena tiap titik berdiri sendiri. `endYear`/`endMonth` tetap di-clamp ke bulan lengkap terakhir di tahun manapun yang diminta — tidak mungkin menjangkau bulan yang belum selesai.
- **UI Filter Rentang (`TrendChart.jsx`)**: Dropdown "Dari"/"Sampai" kini masing-masing punya pemilih **Tahun + Bulan** independen (bukan cuma Bulan seperti sebelumnya). Opsi tahun diambil dari `available_years` (dikirim backend, bersumber dari data yang benar-benar ada di database). Judul chart otomatis menampilkan rentang tahun (mis. "2025–2026") saat rentang lintas tahun aktif, dan label sumbu-X menampilkan akhiran tahun (mis. "Nov '25", "Jan '26") untuk disambiguasi.
- **Dropdown Tahun di Header Kini Dinamis**: `years` di `Header.jsx` (sebelumnya hardcoded `['2026', '2025']`) sekarang diambil dari `available_years` pada response `/api/metrics/calculate` (bersumber dari `storage.getAvailableSurveyYears()` — memindai tahun-tahun yang benar-benar punya data respons survei), sehingga otomatis bertambah saat data tahun baru ditambahkan di masa depan, tanpa perlu mengubah kode frontend.
- **Backend baru**: `storage.getAvailableSurveyYears()` (daftar tahun terurut dari database + tahun berjalan). `GET /api/metrics/trends` menerima `startYear`/`endYear` dan mengembalikan `available_years`. Setiap titik trend kini menyertakan field `year`.

### 🧪 Regression Testing — Module 23 Baru (Positive & Negative Testing)
- **6 test case baru** memverifikasi: data 2025 benar-benar berbeda dari 2026 (bukan fallback statis), tahun lampau penuh mengembalikan 12 bulan, `available_years` mencakup 2025 & 2026, rentang lintas tahun terurut kronologis dengan YTD reset di batas tahun, rentang menjangkau tahun jauh di masa depan tetap di-clamp, dan rentang lintas tahun terbalik tidak crash.

---

## [2.13.0] - 2026-09-18

### 📉 Trend Chart Tidak Lagi Menampilkan Bulan Depan Sama Sekali (Fixed)
- **Bug**: Setelah [2.12.0], grafik masih memuat 12 titik (Januari–Desember) — bulan September s/d Desember hanya diberi warna lebih pudar (proyeksi forecast), bukan benar-benar dihilangkan. Pengguna ingin grafik **berhenti total** di Agustus.
- **Fix**: `computeMonthlyTrends()` (`calculationEngine.js`) ditulis ulang — proyeksi forecast untuk bulan yang belum selesai **dihapus total**. Fungsi kini hanya mengembalikan titik data untuk bulan yang benar-benar lengkap (`1..lastCompleteMonth`), sehingga array hasil untuk hari ini (September 2026) berisi tepat 8 titik (Januari–Agustus) — bukan 12.
- **Helper baru `getLastCompleteMonth(year)`**: dipakai bersama oleh `computeMonthlyTrends()` dan endpoint `/api/metrics/trends` untuk menentukan "bulan lengkap terakhir" secara konsisten (tahun lampau → 12; tahun depan → 0; tahun berjalan → bulan sebelum bulan ini).

### 🎛️ Filter Rentang Periode pada Trend Chart (Added)
- **UI Baru di `TrendChart.jsx`**: Dua dropdown "Dari Bulan" dan "Sampai Bulan" di atas grafik, default **Januari s/d Agustus** (awal tahun sampai bulan lengkap terakhir sebelum bulan ini). Opsi dropdown otomatis dibatasi hanya sampai bulan lengkap terakhir — tidak mungkin memilih bulan yang belum selesai.
- **Tombol Reset**: muncul otomatis saat rentang diubah dari default, mengembalikan ke Januari–Agustus dengan satu klik.
- **Mengikuti Toggle YTD/MTD**: filter rentang bekerja untuk kedua mode — YTD tetap kumulatif per titik, MTD tetap berdiri sendiri per bulan, hanya rentang bulan yang ditampilkan yang berubah.
- **`TrendChart.jsx` kini fetch mandiri** ke `GET /api/metrics/trends?mode=&directorate=&sub_directorate=&startMonth=&endMonth=` setiap kali mode/direktorat/rentang berubah, alih-alih bergantung pada `monthly_trends` yang disisipkan di response `/api/metrics/calculate` — lebih ringan dan responsif saat filter diubah.
- **Backend**: `GET /api/metrics/trends` menerima `startMonth`/`endMonth` (dan `year`), mengembalikan `year` & `last_complete_month` di response agar frontend tahu batas dropdown yang valid. `endMonth` **selalu di-clamp** ke bulan lengkap terakhir di server — permintaan apa pun yang mencoba menjangkau bulan berjalan/masa depan otomatis dipotong, bukan cuma di frontend.

### 🧪 Regression Testing — Module 22 Baru (Positive & Negative Testing)
- **5 test case baru** memverifikasi narrowing rentang, rentang 1 bulan, clamping `endMonth` ke bulan lengkap terakhir walau diminta Desember, rentang terbalik (start > end) tidak crash, dan parameter rentang berisi teks acak tidak crash.
- **3 test lama diperbarui** (Modul 2 & 18) karena asumsi lama "selalu 12 bulan" tidak berlaku lagi — kini memverifikasi panjang array persis `last_complete_month` dan memverifikasi bulan berjalan **tidak muncul sama sekali** di response (bukan cuma `has_actual_data: false`).

---

## [2.12.0] - 2026-09-18

### 📅 Dashboard Trend Kini Berhenti di Bulan Terakhir yang Sudah Selesai (Fixed)
- **Bug**: Grafik Performance Trend masih menandai bulan berjalan (September 2026) sebagai data "aktual", padahal bulan tersebut belum selesai (data bisa saja masih bertambah sampai akhir bulan) — seharusnya hanya bulan yang sudah lengkap (Januari–Agustus) yang ditampilkan sebagai data final.
- **Fix**: `computeMonthlyTrends()` (`calculationEngine.js`) kini menghitung "bulan lengkap terakhir" sebagai **bulan sebelum bulan kalender berjalan**, bukan bulan berjalan itu sendiri. Titik data bulan berjalan dan seterusnya kini ditampilkan sebagai proyeksi forecast (titik lebih pudar `#FCA5A5` di grafik), bukan data final.

### 🕵️ Sub Agent "Auditor" — Audit Data Dummy/Hardcode & Perbaikan (Added)
- **Sub Agent Baru (`.claude/agents/auditor.md`)**: Persona read-only untuk mengaudit codebase, mendeteksi nilai yang dibekukan (hardcoded) dalam kode bisnis yang seharusnya bersumber dari database (`server/db/storage.js`/`store.json`) atau dari jam server, versus data seed yang memang sengaja statis (`seedData.js`) — dibedakan secara eksplisit agar tidak salah tangkap.
- **5 Temuan Terkonfirmasi & Diperbaiki**:
  1. **`outcomeIngestionDates` hardcoded map** di `calculationEngine.js` (7 tanggal ingestion per metric_id OUTCOME) — dipindah menjadi field database `last_data_date` yang di-seed di `seedData.js` (`OUTCOME_INGESTION_DATES`) dan dapat diedit admin via `PUT /api/admin/metrics/:id`. **Bug tambahan ditemukan saat menulis regression test**: `storage.updateMetric()` belum memasukkan `last_data_date` ke whitelist field yang disimpan — edit dari Admin tidak pernah benar-benar tersimpan. Sudah diperbaiki juga.
  2. **Tahun `'2026'` dibekukan** di 12+ lokasi (`calculationEngine.js`, `server.js`) sebagai default YTD/period tak-valid — diganti konstanta `CURRENT_YEAR` yang diturunkan dari `new Date().getFullYear()`, sehingga default tahun otomatis mengikuti tahun berjalan yang sebenarnya, bukan terkunci ke 2026 selamanya.
  3. **`monthCodes` chart trend dibekukan ke tahun 2026** — kini dibangun dinamis dari tahun target (`filterOptions.year`, default tahun berjalan).
  4. **Logika bulan-lengkap-terakhir tidak menangani tahun selain 2026 dengan benar** — kini membandingkan tahun target vs tahun berjalan sungguhan: tahun lampau → semua 12 bulan dianggap aktual; tahun depan → belum ada yang aktual; tahun berjalan → sampai bulan lengkap terakhir.
  5. **`alertEngine.js` hanya mengambil verbatim dari 1 event ID hardcoded** (`ev-perspektif-2024-q1`) — diganti agregasi dari **seluruh event** via `storage.getEvents()`, sehingga event baru yang dibuat admin ikut berkontribusi ke Score Deficit Alerts.
- **Tidak diflag (sengaja/aman)**: konten `seedData.js` itu sendiri, logika tanggal di `reminderService.js` (sudah dinamis dari jam server), fallback Ollama di `localAiService.js`.

### 🧪 Regression Testing — Positive & Negative Testing (Enhanced)
- **8 test case baru (Modul 21)** memverifikasi kelima temuan audit di atas plus ketahanan endpoint terhadap input tidak valid: ID metrik tidak ada, string periode acak, mode trend tidak valid — semuanya harus mengembalikan error yang rapi (400/404) atau fallback yang aman, bukan crash 500.

---

## [2.11.1] - 2026-09-18

### 🐛 Trend Chart Angka Tidak Konsisten dengan Scorecard YTD (Fixed)
- **Bug**: Setelah rilis [2.11.0], PX Index di scorecard menunjukkan **83.19%** namun grafik "People Experience (PX) Performance Trend" untuk periode yang sama hanya menunjukkan **~59%an** — selisih besar yang membingungkan.
- **Root Cause**: `computeMonthlyTrends()` menghitung `survey_index` dengan merata-ratakan `rating_score` mentah dari SELURUH respons survei secara sekaligus (lintas metrik), tanpa normalisasi per-metrik sesuai `scale_type` (RATING_5/PERCENTAGE/QUOTA_COUNT/NUMERIC) dan tanpa bobot (`weight`) per metrik — metode yang sama sekali berbeda dari `calculatePEIndex()` yang dipakai scorecard utama (normalisasi + rata-rata berbobot per metrik). Akibatnya nilai skala campur-aduk dan jatuh jauh dari angka sebenarnya.
- **Fix**: `computeMonthlyTrends()` kini memanggil `calculatePEIndex()` untuk setiap bulan (dengan opsi internal `skipTrends: true` untuk mencegah rekursi), sehingga **metode perhitungan 100% identik** dengan scorecard utama untuk periode manapun:
  - Mode **YTD**: memanggil `calculatePEIndex({ mode: 'YTD', endMonth: <bulan> })` — parameter `endMonth` baru pada `storage.applyResponseFilters()` membatasi data kumulatif hanya sampai akhir bulan tersebut (Januari s/d bulan target), tanpa mengubah perilaku YTD penuh-tahun yang sudah ada saat `endMonth` tidak diberikan.
  - Mode **MTD**: memanggil `calculatePEIndex({ mode: 'MTD', month: <bulan> })` — sama persis dengan hasil yang dilihat user jika memilih bulan tersebut langsung di toggle MTD Dashboard.
  - `response_count` kini dihitung dari `sample_size` metrik SURVEY aktif (bukan pooling response mentah), konsisten dengan `sample_size` yang ditampilkan di menu Explore Metrics.
- **Verifikasi**: Titik bulan berjalan (September 2026) pada grafik YTD kini persis sama dengan scorecard utama: `survey_index` 86.58% = 86.58%, `outcome_index` 75.29% = 75.29%, `px_index` 83.19% = 83.19%.
- **Catatan**: Outcome Index kini tampil relatif konstan antar bulan pada grafik — ini **bukan bug**, melainkan cerminan jujur dari model data aplikasi: metrik OUTCOME (SLA rekrutmen, kehadiran, dsb.) disimpan sebagai snapshot HR system terkini, bukan sebagai time-series bulanan, sehingga `calculatePEIndex()` memang mengembalikan nilai Outcome yang sama untuk periode manapun — konsisten dengan perilaku scorecard utama yang sudah ada sebelumnya.

---

## [2.11.0] - 2026-09-18

### 📈 Performance Trend Chart — Mengikuti Toggle YTD / MTD Dashboard (Enhanced)
- **Bug Sebelumnya**: Grafik "People Experience (PX) Performance Trend 2026" selalu menampilkan pola pergerakan yang sama persis, tidak peduli toggle **YTD**/**MTD** di Dashboard sedang aktif yang mana — chart hanya menghitung nilai bulanan berdiri sendiri (mirip MTD) tanpa pernah menampilkan progresi kumulatif Year-to-Date.
- **`computeMonthlyTrends()` (`calculationEngine.js`) kini mendukung dua mode**, mengikuti `filterOptions.mode` yang sama dipakai scorecard utama:
  - **YTD (default)**: setiap titik bulan adalah **rata-rata kumulatif berjalan** dari Januari sampai bulan tersebut (`response_count` terus bertambah tiap bulan), konvergen ke angka YTD yang tampil di scorecard utama. Bulan yang belum terjadi (setelah bulan kalender berjalan) melanjutkan nilai kumulatif terakhir dengan proyeksi halus menuju target.
  - **MTD**: setiap titik bulan berdiri sendiri (*standalone*) — murni data bulan itu saja, tanpa akumulasi dari bulan-bulan sebelumnya. Cocok untuk melihat bulan mana yang benar-benar menggerakkan angka.
- **`GET /api/metrics/trends` menerima parameter `?mode=YTD|MTD`** (default `YTD`), dan `App.jsx`/`Dashboard.jsx` otomatis meneruskan mode aktif dari toggle Dashboard ke `monthly_trends` lewat `/api/metrics/calculate`.
- **UI (`TrendChart.jsx`)**: Badge dan deskripsi chart kini dinamis — *"Cumulative YTD"* dengan teks progresi kumulatif saat mode YTD aktif, atau *"Monthly Movement (MTD)"* dengan teks pergerakan bulanan berdiri sendiri saat mode MTD aktif.
- **Keterbatasan yang Diketahui (Belum Diperbaiki)**: Perhitungan `survey_index` pada endpoint trend chart masih memakai rata-rata sederhana `rating_score` lintas metrik tanpa normalisasi bobot per-metrik seperti pada `calculatePEIndex()` — sehingga nilai persentase pada grafik trend dapat berbeda dari angka scorecard utama (keterbatasan pra-eksisting, di luar cakupan perbaikan kali ini).

---

## [2.10.0] - 2026-09-18

### 🤖 Ollama-Powered Score Deficit Alert Narratives (Enhanced)
- **Narasi Dinamis via Local Ollama (`localAiService.js`, `alertEngine.js`)**: Fungsi `generateAlertNarrative()` baru memanggil model Ollama on-premise (`OLLAMA_HOST`/`OLLAMA_MODEL`) untuk menyusun narasi analisis 1 paragraf per alert defisit (menjelaskan gap, dampak, dan urgensi), sama seperti pola yang sudah dipakai untuk Executive Summary event.
- **Fallback Offline Deterministik**: Jika Ollama tidak terjangkau, sistem otomatis kembali ke kalimat rule-based (format lama) tanpa alert pernah gagal — konsisten dengan prinsip 100% on-premise.
- **`GET /api/alerts` kini `async`** dan memproses seluruh metrik defisit secara paralel (`Promise.all`) agar waktu respons tetap wajar.
- **Tampilan Baru "Ringkasan Analisis AI" (`Dashboard.jsx`)**: Kartu Score Deficit Alerts di Dashboard kini menampilkan narasi AI (`narrative_summary`) di atas rekomendasi aksi dari Action Library.

### 📈 Performance Trend Chart — Pergerakan Bulanan Dinamis (Fixed & Enhanced)
- **Perbaikan Bug "Trend Datar April–Desember" (`calculationEngine.js`)**: Skor Outcome Index yang sebelumnya flat 88.0% untuk seluruh bulan setelah Maret kini memakai baseline 12-bulan yang bervariasi realistis.
- **Data Dummy Diperbanyak & Mengikuti Bulan Berjalan (`seedData.js`)**: Rentang tanggal seed respons survei kini diperluas secara otomatis dari April sampai bulan kalender saat ini (dihitung dari tanggal sistem real-time saat server boot), bukan hanya Januari–Maret — sehingga chart Performance Trend selalu menampilkan data aktual hingga bulan terakhir, dan bulan-bulan di masa depan tetap memakai proyeksi forecast.
- **Migrasi Non-Destruktif (`storage.js`)**: `store.json` yang sudah ada digabung (merge) dengan record seed bulan baru tanpa menghapus data respons yang sudah diupload sebelumnya.

### 🔄 Parameter "Frekuensi Update Data" per Metrik (Added)
- **Field Baru pada Setiap Metrik**: `update_frequency` — **Bulanan (Update Berkala Tiap Bulan)** untuk metrik yang datanya diperbarui tiap bulan, atau **Tahunan (Sekali Upload untuk Full Year)** untuk metrik yang cukup diupload sekali (contoh default: 11 metrik ESS / Employee Sentiment Survey).
- **UI Admin (`AdminParametersModal.jsx`)**: Dropdown "Frekuensi Update Data" pada form Tambah/Edit Metric, plus badge "Bulanan"/"Tahunan" berwarna pada kolom baru **Update Data** di tabel Parameter Metric.
- **Migrasi Otomatis (`storage.js`)**: Metrik lama di `store.json` yang belum punya field ini otomatis di-backfill dengan default saat server boot.

### 📧 Pengingat Upload Survei Manual — PIC, Batas Waktu & Email (Added)
- **Parameter Baru per Metrik Survey**: `requires_manual_upload` (survei masih diupload manual oleh PIC), `upload_deadline_day` (tanggal batas upload bulanan, default tgl 25), `upload_deadline_month` (bulan batas waktu untuk metrik Tahunan, default November), `pic_name`, dan `pic_email`.
- **Service Baru `reminderService.js`**: Mendeteksi metrik yang belum diupload untuk siklus berjalan (bulan ini / tahun ini) dan mengklasifikasikan status **DUE_SOON** (≤5 hari sebelum deadline) atau **OVERDUE** (lewat deadline).
- **Endpoint Baru**: `GET /api/admin/upload-reminders` (lihat daftar pending reminder) dan `POST /api/admin/upload-reminders/send` (kirim email reminder ke seluruh PIC terkait).
- **Pengiriman Email On-Premise via SMTP (`nodemailer`)**: Dikonfigurasi lewat env var `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM` (lihat `.env.example` baru). Jika SMTP belum dikonfigurasi, reminder tetap dihitung dan dicatat di log server tanpa membuat aplikasi gagal (graceful fallback, sama seperti pola Ollama).
- **Pengecekan Harian Otomatis (`server.js`)**: Server melakukan pengecekan reminder ±15 detik setelah boot, lalu berulang tiap 24 jam.
- **UI Admin (`AdminParametersModal.jsx`)**: Form Tambah/Edit Metric menampilkan toggle "Survei ini masih diupload manual oleh PIC", input Nama & Email PIC, dan Batas Tanggal Upload. Panel banner kuning baru di atas tabel Parameter Metric menampilkan ringkasan reminder yang OVERDUE/DUE_SOON beserta tombol "Kirim Reminder Sekarang".

---

## [2.9.2] - 2026-09-18

### 🎨 Pemisah Nomor & Nama Metrik pada Journey Mini-Pills Dashboard (Enhanced)
- **Format Tampilan Metrics Mini-Pills di Kartu Journey ("5 Employee Experience Journeys") (`Dashboard.jsx`)**:
  - Nomor metrik dan nama metrik kini dipisahkan dengan tanda hubung (` - `) agar lebih mudah dibaca — contoh: `1 - Career Website & Social Media Follower, Reach & Engagement Growth` (sebelumnya `1 Career Website & Social Media...` tanpa pemisah).

---

## [2.9.1] - 2026-09-18

### 🐛 Admin Parameter Edit Button Fix, Metric Numbering Cleanup & Status-Aware Coloring (Fixed & Enhanced)
- **Bug Fix — Tombol Edit di Parameter Admin Tidak Merespons Setelah Scroll (`AdminParametersModal.jsx`)**:
  - *Root cause*: Form Edit/Tambah Journey & Metric dirender di bagian atas body modal yang scrollable. Jika pengguna sudah scroll ke bawah tabel (27 metrik) sebelum mengklik **Edit**, form tetap terbuka namun berada di luar area yang terlihat — sehingga terkesan tombol tidak merespons pada klik kedua dan seterusnya.
  - *Fix*: Menambahkan `modalBodyRef` dan auto-scroll halus (`scrollTo({ top: 0, behavior: 'smooth' })`) setiap kali form Edit/Tambah dibuka, baik untuk Journey maupun Metric.
- **Penghapusan Awalan "#" pada Penomoran Metrik (Tampilan)**:
  - Seluruh tampilan nomor metrik (`#1`, `#2`, dst.) diubah menjadi angka polos (`1`, `2`, dst.) di kolom ID tabel, mini-pill Journey pada Dashboard, judul modal Edit, dan pesan konfirmasi hapus — mencakup 8 komponen: `Calculator.jsx`, `Dashboard.jsx`, `AdminParametersModal.jsx`, `AdminSettingsModal.jsx`, `AdminSurveyQuestionsModal.jsx`, `MetricDetailModal.jsx`, `WeightsModal.jsx`, `SurveyImportModal.jsx`.
- **Pewarnaan Status pada Metrics Mini-Pills Dashboard (`Dashboard.jsx`)**:
  - Pill metrik dalam kartu Journey ("5 Employee Experience Journeys") kini diwarnai sesuai status pencapaian: **Hijau** (*On Target*), **Kuning** (*Warning*), **Merah** (*Critical*) — sebelumnya status *On Target* memakai warna abu-abu netral yang tidak mencerminkan pencapaian positif secara visual.
- **Penyelarasan Warna Tombol Actions & Evidence di Explore Metrics (`Calculator.jsx`)**:
  - Tombol *Template*, *Evidence*, *Upload*, *Detail* (metrik Survey) serta *View Data* dan *Target* (metrik Outcome) — sebelumnya berwarna campuran (hijau/ungu/biru/abu-abu/kuning) — kini diseragamkan menjadi satu warna netral **Slate/abu-abu kebiruan** (`bg-slate-100` / `text-slate-700` / `border-slate-200`) bernuansa *soft, corporate, dan elegant*, sengaja dipilih berbeda dari palet warna status (Hijau/Kuning/Merah) agar tidak tertukar makna dengan indikator On Target/Warning/Critical.

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
