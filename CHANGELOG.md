# Changelog - CIMB Niaga People Experience Integrated System

Semua perubahan dan pembaruan versi pada sistem People Experience (PX) Management & Scoring System dicatat di dalam dokumen ini mengikuti standar [Semantic Versioning](https://semver.org/).

## [2.38.0] - 2026-10-19

### Dashboard Exit Interview: Alasan Karyawan Resign dari Upload Termination Report (.xlsx) (Added)

- **Permintaan user**: area Exit Survey diberi menu baru "Dashboard Exit Interview" yang menunjukkan mengapa karyawan resign. Tata letak dari `docs/exit interview dashboard template.pptx` (slide 1: 6 kartu; slide 2: A/B), data dari `docs/Template Report Exit Interview.xlsx` (hanya September 2026, tanpa kolom Directorate); periode lain dummy acak (minimal Jan-Sep 2026), tema sama dengan web PX.
- **Keputusan user**: data September asli tetap **lokal** (file di `.gitignore`, hanya diimpor ke SQL Server lokal; repo ada di GitHub); upload `.xlsx` oleh Admin; semua login boleh membuka dashboard sesuai cakupan (USER hanya agregat direktorat miliknya).
- **Aturan kartu (dari user, `server/services/exitInterviewService.js` `summarizeExitInterviews`)**. Voluntary = kolom D `NORMAL_RESIGNATION`; *mover* = voluntary dengan kolom E `MOVE_COMPANY` atau `BETTER_OFFER`.

  | Kartu | Kolom | Basis | Aturan |
  | :--- | :--- | :--- | :--- |
  | 1 Reasons for resignation | E | baris voluntary | `MOVE_COMPANY` + `BETTER_OFFER` = "Move company"; kode lain ditampilkan sebagai teks (`OWN_BUSINESS` -> "Own business") |
  | 2 Destination industry | H | mover yang menjawab H | "Perbankan / Asuransi / Keuangan Lainnya" = Financial, jawaban lain = Non-financial |
  | 3 Top 10 financial-sector destinations | I (dengan H Financial) | mover Financial | nama distandarkan lewat tabel alias (kata kunci terpanjang menang); nama di luar alias dipakai apa adanya |
  | 4 Pull factors | K (multi, pemisah `\|`) | semua mover | Compensation / Position / Job / Reputation / Other, jumlah record per opsi; KPI = % Compensation |
  | 5 Career satisfaction (movers) | O..AC (15 pernyataan, 1-6) | mover dengan minimal satu skor | rata-rata per orang dibulatkan ke 1-6 (half up), plus rata-rata keseluruhan dan % dari 6 |
  | 6 Would you recommend | AF | mover yang menjawab Yes/No | Yes vs No |
  | A (slide 2) | M | mover yang menjawab M | tema dari kata kunci, jumlah karyawan unik per tema (satu orang bisa di beberapa tema) |
  | B (slide 2) | N | mover dengan skor karier | tema dibagi karier-negatif (bucket 1-3) vs karier-positif (4-6), plus selisih pp |

  Judul slide 2 (`headline`) disusun dari data (dua tema A teratas + tema B dengan selisih positif terbesar). Pengelompokan berbasis aturan kata kunci, **tanpa AI**.
- **Tabel baru (kedua backend, dibuat saat boot)**: `px_exit_interviews` (satu baris per exit; `UNIQUE (nik, effective_date)`, index `effective_date` dan `(directorate, division)`, `source` `UPLOAD`/`TEMPLATE_IMPORT`/`SEED_DUMMY`) dan `px_exit_interview_uploads` (riwayat batch). JSON: `exitInterviews`, `exitInterviewUploads`. Ikut `dropAllTables`, `importStore`, `exportToJson.js` dan hitungan `migrate.js`. Jumlah tabel `px_*` 30 -> **32**. Rincian: `docs/08` §18.
- **Endpoint baru**:

  | Endpoint | Akses | Perilaku |
  | :--- | :--- | :--- |
  | `GET /api/exit-interview/summary` | semua login | `mode`, `year`, `month`, `directorate`, `sub_directorate`; USER dibatasi cakupan (direktorat lain 403); hanya agregat, tanpa NIK/nama/teks jawaban; untuk USER kartu 3 hanya memuat nama dari daftar alias |
  | `GET /api/exit-interview/template` | Admin | `Template_Exit_Interview.xlsx` |
  | `POST /api/exit-interview/upload` | Admin | field `file`, hanya `.xlsx`, maks 20 MB; validasi atomik; upsert per NIK + tanggal |
  | `GET /api/exit-interview/uploads` | Admin | riwayat upload |
  | `GET /api/exit-interview/export` | Admin | CSV semua baris filter aktif, formula-escape |

  Bulan/tahun tidak valid -> 400; file bukan `.xlsx` -> 400 (upload ESS memakai 415). Audit `EXIT_INTERVIEW_UPLOAD`. File asli disimpan di `server/data/exit-uploads/<upload_id>.xlsx` (tidak disajikan, di `.gitignore`); `docs/Template Report Exit Interview.xlsx` juga di `.gitignore`.
- **Setting baru di `px_app_settings`** (di-seed sekali bila belum ada, ubah lewat `PUT /api/admin/settings/:key`, belum ada UI): `exit_interview_k_factors`, `exit_interview_m_themes`, `exit_interview_n_themes`, `exit_interview_company_aliases` (36 alias), `exit_interview_none_answers` (akhiran `*` = diawali frasa). Format `{value, label}`; `value` = kata kunci yang cocok di awal sebuah kata jawaban.
- **`server/services/xlsxUtils.js` (baru)**: pembaca/penulis `.xlsx` minimal (`readFirstSheet`, `buildXlsx`, `colLetter`) dipindah dari `essSummaryService.js`, kini dipakai bersama; `essSummaryService` tetap mengekspor `readFirstSheet`/`buildXlsx`.
- **Data di database utama (laporan developer)**: September 2026 = file template asli diimpor (`npm run exit:import-template`, 205 baris, source `TEMPLATE_IMPORT`). NIK di file itu tersamar dan bertabrakan (hanya 20 NIK berbeda), jadi tiap baris diberi NIK pengganti `<NIK>-<nomor baris>`; direktorat/divisi diisi **dummy** deterministik. Impor ini menggantikan 203 baris dummy September. Januari-Agustus 2026 = dummy (`SEED_DUMMY`): 189, 182, 225, 226, 186, 234, 186, 185 = 1.613 baris; total 1.818; ke-12 direktorat ada di setiap bulan dummy. Instalasi baru tanpa impor mendapat dummy September (203) saat boot.
- **Aturan dummy**: boot (bila `SEED_DEMO_DATA` bukan `false`) hanya menambah dummy ke bulan Jan-Sep 2026 yang belum punya baris sama sekali; upload atau impor data asli satu bulan menghapus dummy bulan itu. Dummy dibangkitkan dari distribusi agregat (PRNG ber-seed per bulan), bobot direktorat = partisipasi ESS + 150; jawaban "Other" dummy = tiga frasa pendek karangan; nama perusahaan asuransi/multifinance/non-keuangan dummy berakhiran "(dummy)". Tidak ada baris, nama atau verbatim dari file template di kode.
- **Angka YTD 2026 bankwide (laporan developer)**: "January - October 2026 \| 1,082 voluntary exit records as of September 2026"; 1.818 record, 608 mover. Reasons: Move company 608, Personal 146, Family 138, Own business 126, Study 38, Health 20, Performance issue 6. Industri: Financial 347 (66,6%) / Non-financial 174 (33,4%), basis 521. Top 10: Permata 62, Maybank 58, Danamon 46, OCBC NISP 33, DBS 13, BTN 12, UOB 11, Sinarmas 10, SMBC 10, Mega 8. Pull factors: Compensation 382 (62,8%), Position 151, Job 118, Reputation 46, Other 35. Karier: bucket 1-6 = 10/18/40/146/257/72, rata-rata 4,50/6 (75%), basis 543 (68 negatif / 475 positif). Recommend 509 Yes / 34 No. A: Compensation & benefits 395, Higher position 134, Better-fit job 125, Company reputation 57, Location / commute 19, Family & personal 13, Other 2. MTD 2026-09: 205 record, 121 voluntary, 69 mover, Financial 45 (80,4%).
- **Frontend**: tab Header **Exit Interview**; `src/components/ExitInterviewDashboard.jsx` (di-*lazy load*, chunk sendiri ~350 KB; bundle utama 520 KB) mengikuti filter Header; toolbar Admin: Download Template, Upload (modal dengan tabel error), Export CSV (filter aktif), Upload history. `MetricDetailModal.jsx`: metrik Exit Survey (metrik 26, dikenali dari nama/sumber data) mendapat tombol "Open Exit Interview Dashboard". Data exit interview **tidak** mengubah skor metrik 26 maupun PX Index.
- **Skrip**: `npm run exit:import-template -- "<path .xlsx>"` (`scripts/import-exit-template.js`) untuk impor lokal file asli tanpa kolom Directorate.
- **Tes**: Modul 47 (13 tes, khusus SQL; dilewati di JSON). Suite penuh SQL (backend kedua, `TEST_SKIP_MODULES=8,24,27,32,38,41,42,43`): **228/228 lulus, 0 gagal, 16 dilewati** (laporan developer). JSON: hanya cek in-process terarah. Jumlah data setelah run tidak berubah (ESS 572, upload 205, respons 2.788, user 1). Detail: `docs/07` §32. QC berjalan paralel; hasilnya belum tercatat di sini.
- **Risiko / belum dikerjakan**: belum ada hapus upload/baris exit (selain lewat SQL); belum ada ukuran grup minimum (USER yang memfilter satu divisi bisa mengenali individu dari angka kecil); direktorat data September adalah dummy; `npm run db:export -- --replace` akan menulis baris template asli ke `server/data/store.json` - **jangan commit** ekspor seperti itu; tampilan UI belum diverifikasi developer di browser; file asli upload belum bisa diunduh lewat API. `/api/health` `version` = `2.38.0`. Tidak ada env baru.

- **QC (terarah): LULUS DENGAN CATATAN.** Semua kartu YTD 2026, MTD 2026-09 dan filter Human Resources dihitung ulang langsung dari `px_exit_interviews` dan cocok 100%; payload summary tanpa NIK/nama/saran; USER: direktorat sendiri 200, lainnya 403, endpoint Admin 403; bulan/tahun invalid 400; 8 jenis upload salah ditolak tanpa menyimpan apa pun; upload valid + upload ulang (upsert) di 2031-01 lalu dibersihkan; UI (kartu 1-6, A, B, toolbar Admin, modal upload, riwayat, tombol dari metrik 26, tampilan USER) tanpa NaN/undefined dan tanpa scroll horizontal di 1280px. Diperbaiki setelah QC: `period_to` batch dummy kini hari terakhir bulan (dulu tanggal 1 bulan berikutnya) di kedua backend, 9 record yang ada dikoreksi; `server/data/store.from-sql.json` (output default `npm run db:export`) masuk `.gitignore` karena bisa memuat baris asli. Catatan: kolom D kosong diterima (tidak dihitung voluntary); tidak ada ambang jumlah minimum per kelompok (keputusan produk); record upload `seed-exit-2026-09` tetap di riwayat walau barisnya sudah diganti impor template; file asli upload belum bisa diunduh dari UI.
---

## [2.37.0] - 2026-10-19

### Periode MTD ESS = Bulan Template & Data Dummy ESS 2026 per Kuartal (Changed)

- **Permintaan user**: baris template ESS punya kolom Month dan Year - filter MTD harus memakai periode itu, dan MTD tidak boleh kosong semua.
- **Pemeriksaan (sesi utama)**: pemilihan hasil ESS di engine sudah benar; MTD 2026 kosong karena satu-satunya periode ESS di database adalah 2025-11. Yang tidak sesuai permintaan: aturan v2.36.0 "metrik Annual pada MTD Y-M = Jan s.d. M" membuat hasil ESS 2025-11 ikut terbaca pada MTD 2025-12.
- **Keputusan user**: MTD ESS = tepat bulan template (Year + Month); tambahkan data dummy ESS 2026 per kuartal.
- **Periode baca (`server/db/filterUtils.js`, `calculationEngine.js`)**: `effectiveMetricPeriod` dihapus. `calculatePEIndex()` dan `getMetricDetail()` membaca setiap metrik SURVEY tepat pada periode terpilih: MTD Y-M = hanya bulan itu (`period_window.basis` selalu `MONTH`), juga untuk metrik `ONE_TIME_ANNUAL` dan ESS; ESS hanya terhitung bila (Year, Month) template = Y-M. YTD tidak berubah (Januari s.d. bulan akhir yang dibatasi jam server; ESS = hasil terbaru di jendela). `update_frequency` kembali hanya untuk pengingat e-mail. **Menggantikan** aturan MTD metrik Annual di [2.36.0].
- **Data dummy ESS 2026 (`server/db/seedData.js`)**: `ESS_SEED_DUMMY_PERIODS` = 2026-03, 2026-06, 2026-09. `generateInitialEssResults()` membuat 11 metrik ESS x 13 unit org (Bankwide + 12 direktorat) x 3 periode = 429 baris + 33 batch upload (`seed-ess-<metric>-2026-03` dst., file `ESS 2026-03 Result_<metrik> (dummy).xlsx`, `uploaded_by` "Seed (dummy)", `uploaded_at` hari terakhir bulan itu 10:00Z). Nilai: baris 2025-11 unit org yang sama + drift deterministik +0,3 s.d. +1,0 pp per kuartal, noise ±1,5 pp (clamp 0-100); skor pertanyaan menjaga jaraknya ke index 2025-11 (±1); partisipasi = partisipasi 2025-11 ±3%. Seed 2025-11 tidak berubah (baris metrik 9 tetap sama dengan file asli user). Ini data fiktif.
- **Top-up seed per (metrik, periode)** (`sqlStorage.topUpEssSeed`, `jsonStorage.topUpStoreEssSeed`): satu periode seed hanya disisipkan bila metrik ESS itu belum punya baris untuk periode tersebut dan `SEED_DEMO_DATA` bukan `false` (dulu: hanya bila metrik belum punya hasil sama sekali, sehingga database yang sudah berisi 2025-11 kini mendapat ketiga kuartal 2026 pada boot pertama). Upload admin tidak pernah ditimpa (upload periode yang sama mengganti baris seed lewat `saveEssResultUpload`, lalu top-up melewatinya). **Efek samping**: bila admin menghapus semua baris satu periode seed, boot berikutnya menyisipkan seed periode itu lagi. Log boot: `Seeded demo ESS summaries: <upload_id>, ...`.
- **`server/db/initialStore.js`** (store JSON baru): `created_at` baris ESS = `uploaded_at` batch-nya (dulu selalu `2025-11-30T10:00:00.000Z`). SQL tetap memakai waktu insert (inkonsistensi kecil, tidak diubah).
- **UI (`MetricDetailModal.jsx`)**: catatan "Annual metric: shows the result of ..." dihapus (MTD tidak lagi punya jendela `YEAR_TO_MONTH`).
- **Angka bankwide (Survey / Outcome / PX, dari laporan developer)**:

  | Periode | v2.36.0 | v2.37.0 |
  | :--- | :--- | :--- |
  | YTD 2026 | 87.42 / 75.08 / 83.72 (9/20 metrik survei berdata, 0 ESS) | 89.63 / 75.08 / 85.27 (20/20; ESS dari 2026-09, metrik 9 = 93.7) |
  | MTD 2026-09 | 88.58 / 75.08 / 84.53 (9/20) | 90.16 / 75.08 / 85.63 (20/20) |
  | MTD 2026-06 | tidak dilaporkan | 88.58 / 75.08 / 84.53 (metrik 9 = 91.8) |
  | MTD 2026-03 | tidak dilaporkan | 88.57 / 75.08 / 84.52 |
  | MTD 2026-10 | 89.87 / 75.08 / 85.43 | tidak berubah (0 ESS) |
  | MTD 2025-12 | 86.28 / 75.08 / 82.92 (ESS terbawa dari 2025-11) | 82.63 / 75.08 / 80.36 (9/20, 0 ESS) |
  | MTD 2025-11 | 85.87 / 75.08 / 82.63 | tidak berubah (11 ESS) |
  | YTD 2025 | 86.21 / 75.08 / 82.87 | tidak berubah |

- **Tes**: Modul 46 kini 13 tes di SQL (12 di JSON): tes ESS annual-MTD diganti 3 tes (MTD = bulan template, NO_DATA di luar bulan itu, baris 2025-11 metrik 9 = file asli) + 1 tes khusus SQL (upload periode seed bertahan setelah top-up boot; periode yang dikosongkan mendapat seed lagi); tes metrik SYSTEM Annual ditulis ulang (MTD tetap satu bulan); 2 tes dipindah ke MTD 2025-12. Modul 11, 35 dan 45 tidak berubah. Suite penuh SQL di backend kedua dengan `TEST_SKIP_MODULES=8,24,27,32,38,41,42,43`: **215/215 lulus, 0 gagal, 16 dilewati**. JSON: hanya cek in-process terarah (`store.json` dipulihkan), suite JSON penuh tidak dijalankan. Jumlah data setelah run: ESS 572 baris, 205 upload, 2.788 baris respons, 1 user. Detail: `docs/07` §31.
- **Catatan**: tidak ada endpoint, tabel, setting, atau env baru; `/api/health` `version` = `2.37.0`. Untuk menghentikan data dummy di database riil: `SEED_DEMO_DATA=false` lalu hapus baris `seed-ess-*-2026-*` (tanpa flag itu baris yang dihapus disisipkan lagi saat boot).

- **QC (terarah): LULUS DENGAN CATATAN.** Angka bankwide sesuai; Survey/Outcome/PX dihitung ulang independen cocok di 10 periode x 2 org (Bankwide + Business Banking); ESS API vs `px_ess_results` 0 selisih; semua MTD `basis MONTH`; metrik 9 2025-11 identik; 44 upload `seed-ess-*` (33 untuk 2026); tidak ada NO_DATA di alerts; UI MTD Sep 2026 (ESS tampil), Okt 2026 dan Des 2025 (ESS NO DATA), detail metrik 9 Jun 2026 (91,8, tanpa catatan "Annual metric"). Catatan (rendah): skor per pertanyaan dummy metrik 9 kembar antar periode (2026-06 = 2025-11, 2026-03 = 2026-09); upload ESS asli ke periode yang berisi seed mengganti baris tetapi record `seed-ess-*` tetap di riwayat (lama, tidak diuji); `/api/alerts` tidak mengikuti filter MTD (lama); `month=13/00` dijawab 200 (lama); upload `seed-ess-9-2025-11` (data Excel asli) berlabel "Seed (dummy)".
---

## [2.36.0] - 2026-10-19

### Jendela Periode YTD/MTD Tepat per Metrik & Status NO_DATA (Changed / Fixed)

- **Permintaan user**: pastikan YTD dan MTD benar. YTD = awal tahun s.d. bulan hari ini (19 Okt 2026 -> Jan-Okt 2026, data apa pun yang ada); MTD = hanya hasil survei bulan dan tahun terpilih. Berlaku untuk semua metrik; MTD hanya berlaku bila datanya berperiode bulanan.
- **Pemeriksaan awal (sesi utama)**: metrik survei SYSTEM sudah cocok dengan hitung ulang langsung di SQL untuk 6 periode (0 selisih). Celah yang ditemukan: YTD tahun berjalan tidak dibatasi (seluruh tahun, termasuk baris bertanggal setelah bulan ini); metrik ESS memakai hasil terakhir dari tahun mana pun (*carry-forward*, v2.32.0); metrik SURVEY tanpa data jatuh ke `raw_value` statis.
- **Keputusan user**: ESS/metrik tahunan ketat di dalam jendela (tanpa carry-forward lintas tahun); tanpa data -> `NO_DATA`, tidak ikut indeks; metrik OUTCOME tetap snapshot tanpa filter periode; metrik tahunan pada filter MTD memakai nilai tahunannya (= YTD tahun itu s.d. bulan terpilih).
- **Jendela periode (`server/db/filterUtils.js`)**:
  - `ytdEndMonth(year, endMonth)`: tahun berjalan (jam server) = 1 Jan s.d. akhir bulan ini; tahun lalu = setahun penuh; tahun depan = jendela kosong; tahun tidak valid = `NaN`. `endMonth` eksplisit (titik tren) dipertahankan tetapi tidak pernah melewati batas itu; clamp "bulan lengkap terakhir" di Performance Trend tidak berubah.
  - `parseFilterOptions` kini selalu mengisi `endMonth` mode YTD dengan batas tersebut (`'00'` = tahun depan). `sqlStorage.buildResponseFilter` (`1 = 0` untuk jendela kosong) dan `jsonStorage.applyResponseFilters` menerapkannya.
  - `effectiveMetricPeriod(metric, period)`: periode baca ditentukan `update_frequency` metrik. `MONTHLY` (default) -> MTD = hanya bulan itu. `ONE_TIME_ANNUAL` (semua metrik ESS; juga survei SYSTEM yang diset Annual oleh admin) -> MTD Y-M dibaca sebagai YTD Y s.d. M. `update_frequency` kini ikut menentukan periode baca (sebelumnya hanya pengingat e-mail).
  - `periodWindow(period)` -> `{ from, to, basis: 'MONTH' | 'YEAR_TO_MONTH' }` (tanggal `YYYY-MM-DD`; tahun depan `from`/`to` `null`).
- **ESS (`essSummaryService.selectEssResult`)**: hanya hasil yang (tahun, bulan)-nya di dalam jendela: MTD Y-M -> tepat Y-M; YTD Y -> hasil terbaru tahun Y s.d. bulan akhir jendela. Karena metrik ESS ber-`update_frequency` `ONE_TIME_ANNUAL`, filter MTD Y-M sampai ke fungsi ini sebagai YTD Y s.d. M (`effectiveMetricPeriod`). **Menggantikan** aturan carry-forward v2.32.0. Dengan hanya hasil 2025-11 (data saat ini), metrik 9: MTD 2025-11, MTD 2025-12 dan YTD 2025 = 92; MTD 2025-10, MTD 2026-09 dan YTD 2026 = `NO_DATA`.
- **NO_DATA (`calculationEngine.js`)**: metrik SURVEY tanpa data di jendelanya -> `status: 'NO_DATA'`, `has_data: false`, `raw_value`/`normalized_score`/`gap` `null`, `sample_size` 0. Tidak ikut Survey Index, rollup journey/checkpoint, dan alert (`alertEngine.js` melewati `has_data === false`; tanpa itu `null < min_threshold` bernilai benar dan metrik muncul sebagai CRITICAL). Tidak ada lagi fallback `raw_value` statis untuk metrik SURVEY. Detail metrik tanpa data tidak lagi memberi skor default per pertanyaan (90/9.0/4.5 atau nilai terkonfigurasi, catatan v2.16.0): `avg_score`/`normalized_score`/`percent_yes` = `null`.
- **Indeks**: `survey_index`/`outcome_index` = `null` bila tidak ada metrik berdata; baru `px_index_basis` = `BOTH` (0.7 Survey + 0.3 Outcome) / `SURVEY_ONLY` / `OUTCOME_ONLY` / `NONE` (PX `null`); baru `no_data_metrics_count`. Journey: `overall_score` `null` + `has_data` + `no_data_count`. Checkpoint: `score` `null` + `has_data`. `active_metrics_count`/`survey_metrics_count` hanya menghitung metrik berdata; `disabled_metrics_count` = metrik `is_disabled` atau `excluded_from_index`. Per metrik SURVEY: `update_frequency`, `period_window` (OUTCOME `null`), `has_data` (juga di detail). Titik tren tanpa data survei: `px_index`/`pe_index` `null` (celah di grafik). `surveyImportService` `affected_metrics[].normalized_score` = `null` (dulu 0) bila metrik tanpa data.
- **Metrik khusus**: 2/5/7/12 mengikuti aturan survei bulanan biasa (2 dan 5 tetap exempted pada filter direktorat). Metrik 12 hanya dari baris surveinya; sinkron feedback event live masih menulis `px_metrics.raw_value`, tetapi nilai itu tidak lagi dipakai sebagai fallback. Metrik 11 (OUTCOME, kuota event live) tidak berubah. Metrik OUTCOME: snapshot tanpa filter, nilainya sama untuk periode apa pun, tidak pernah `NO_DATA`.
- **UI**: Dashboard menampilkan "—" untuk indeks `null`, catatan basis PX (mis. "No survey data in this period: the PX Index is based on the Outcome metrics only."), baris "N survey metrics have no data in this period and are left out of the index.", journey "No Data", baris metrik abu-abu "No Data". Explore Metrics (`Calculator.jsx`): nilai/skor/tanggal "—" + badge abu-abu "No Data". `MetricDetailModal.jsx`: "—", badge "No Data", pertanyaan berlabel "No Data", catatan metrik tahunan pada MTD ("Annual metric: shows the result of Jan–Sep 2026"). `TrendChart.jsx`: titik `null` = celah garis, tooltip "—".
- **Angka bankwide (Survey / Outcome / PX, sebelum -> sesudah, dari laporan developer)**:

  | Periode | Sebelum | Sesudah |
  | :--- | :--- | :--- |
  | YTD 2026 | 88.43 / 75.08 / 84.43 (20/20 metrik survei berdata) | 87.42 / 75.08 / 83.72, basis `BOTH` (9/20; 11 ESS `NO_DATA`) |
  | MTD 2026-09 | 88.96 / 75.08 / 84.79 | 88.58 / 75.08 / 84.53 (9/20) |
  | YTD 2025 | 86.21 / 75.08 / 82.87 | tidak berubah (20/20) |
  | MTD 2025-11 | 85.87 / 75.08 / 82.63 | tidak berubah |
  | MTD 2025-12 | 86.28 / 75.08 / 82.92 | tidak berubah |

  Penurunan 2026 hanya karena carry-forward ESS dihapus (belum ada hasil ESS 2026). Pada filter direktorat, Survey Index 2026 kini hanya mencakup metrik SYSTEM.
- **Tes**: Modul 46 baru (10 tes; detail `docs/07` §30). Modul 11, 35 dan 45 disesuaikan (jumlah tes tetap). Suite penuh SQL di backend kedua dengan `TEST_SKIP_MODULES=8,24,27,32,38,41,42,43`: **212/212 lulus, 0 gagal, 16 dilewati**. JSON: hanya cek in-process terarah (`store.json` dipulihkan byte-per-byte sesudahnya), suite JSON penuh tidak dijalankan. Data tes run ini dibersihkan; jumlah kembali: ESS 143 baris, 172 upload, 2.788 baris respons, 1 user.
- **Catatan**: tidak ada endpoint, tabel, setting, atau env baru; `/api/health` `version` = `2.36.0`. Modul 46 sebentar mengubah `update_frequency` metrik 8 ke Annual lalu memulihkannya; karena backend tes berbagi database dengan backend utama (:5000, scheduler aktif), ada risiko kecil pembacaan sementara yang keliru selama tes itu berjalan.

- **QC (terarah): LULUS DENGAN CATATAN.** Angka bankwide, hitung ulang independen (Survey Index = rerata berbobot metrik yang punya data, PX = 0,7S + 0,3O) untuk 9 periode, raw/sample 9 metrik SYSTEM vs SQL langsung, ESS vs `px_ess_results`, tanpa carry-forward, NO_DATA tidak masuk `/api/alerts`, OUTCOME identik di 9 periode, filter direktorat, tahun depan (OUTCOME_ONLY), input invalid tanpa crash, serta UI Dashboard / Explore Metrics / detail metrik 9 / Trend (garis putus, bukan turun ke 0) - semuanya cocok. Diperbaiki setelah QC: "Latest Survey Date" pada detail metrik NO_DATA kini "—" (dulu tanggal hari ini). Keputusan user (2026-10-19): titik Trend memberi PX `null` (garis putus) di bulan tanpa data survei, sedangkan scorecard tetap PX = Outcome (OUTCOME_ONLY) - perbedaan ini disengaja. Catatan QC yang belum dikerjakan (rendah): Trend untuk tahun depan / input invalid masih memberi titik aneh (lama); `mode=XYZ` diterima diam-diam (lama); `/api/alerts` selalu YTD tahun berjalan (tidak mengikuti filter periode).
---

## [2.35.0] - 2026-10-19

- **Laporan user**: badge "Period" di detail metrik selalu "Year-to-Date", juga saat filter Dashboard diubah ke MTD. Diminta: "YTD 2026" untuk filter YTD, nama bulan + tahun untuk filter MTD.
- **Penyebab**: `App.jsx` hanya mengirim `filterOptions` ke `MetricDetailModal`, bukan prop `period`, sehingga `period` selalu jatuh ke default `'YTD'`. Data detail sudah benar (fetch memakai `filterOptions`), hanya label dan tautan Evidence yang memakai `period` basi.
- **Perbaikan (`MetricDetailModal.jsx`)**: periode diturunkan dari `filterOptions` (prop `period` hanya cadangan bila tidak ada filter). Label: YTD -> "YTD 2026" (tahun dari filter), MTD -> "September 2026". Tautan Evidence kini mengikuti filter: `period=2026` (YTD tahun terpilih, dulu selalu `YTD` = tahun berjalan) atau `period=2026-09` (MTD, dulu tetap `YTD`); nama file evidence ikut periode itu.
- **Tes**: tidak ada tes baru (perubahan tampilan). Suite penuh SQL di backend kedua, `TEST_SKIP_MODULES=8,24,27,32,38,41,42,43`: **202/202 lulus, 0 gagal, 16 dilewati**. `vite build` OK. Dicek di browser (admin sementara, sudah dihapus): MTD September -> "Period: September 2026" + evidence `period=2026-09`; YTD -> "Period: YTD 2026" + `period=2026`. Data tes run ini (5 batch) dibersihkan; jumlah data kembali 172 upload / 2.788 baris.

---

## [2.34.0] - 2026-10-19

- **Permintaan user**: tab "ESS Results by Directorate" di detail metrik ESS tidak perlu (tampilan per direktorat cukup lewat filter Header), dan baris rata-rata di tabel pertanyaan cukup bertuliskan "Overall".
- **UI (`MetricDetailModal.jsx`)**: metrik ESS kini hanya punya satu tab ("Question Breakdown & Average Scores"); tab kedua disembunyikan untuk semua metrik ESS (juga "Respondent Records & Answers" pada metrik ESS tanpa ringkasan, karena ESS tidak lagi punya baris responden). Blok tabel per direktorat dihapus. Baris teratas Spreadsheet View: "Overall" (dulu "<nama dimensi> (Index)"). Catatan "ESS is reported at directorate level" saat filter divisi tetap tampil di kartu Participation. Metrik SYSTEM tidak berubah.
- **Backend**: tidak ada perubahan perilaku; field `ess_results_by_directorate` tetap dikirim API (Modul 45) tetapi tidak dipakai UI. Versi 2.34.0.
- **Tes**: tidak ada tes baru (perubahan tampilan). Suite penuh SQL di backend kedua dengan `TEST_SKIP_MODULES=8,24,27,32,38,41,42,43`: **202/202 lulus, 0 gagal, 16 dilewati**. `vite build` OK. Pembersihan setelah suite hanya menghapus 5 batch upload milik run ini (filter waktu mulai run); jumlah data kembali ke 172 upload / 2.788 baris.

---

## [2.33.0] - 2026-10-19

- **Permintaan user**: template ESS terbaru tidak lagi berisi favorable, neutral dan unfavorable, jadi komponen itu dihapus dari tampilan; yang ditampilkan cukup penilaian sesuai template (index kolom F + skor tiap pertanyaan).
- **UI (`MetricDetailModal.jsx`)**:
  - Kartu ESS: label "Overall Favorable", legenda Favorable/Neutral/Unfavorable dan bar sentimen bertumpuk dihapus. Kini "Index Score" (kolom F) + participants + periode, dengan satu bar netral. Metrik ESS tanpa hasil untuk periode itu menampilkan "No ESS summary uploaded for this period" (sebelumnya angka favorable placeholder dari konfigurasi pertanyaan).
  - Spreadsheet View: kolom % Favorable/% Neutral/% Unfavorable, Dimension, "visible/required based on" dihapus. Tabel kini Question | Score dengan baris Index di atas (nilai kolom F, bukan rata-rata hitungan UI).
  - Card View ESS: badge "ESS % Favorable" -> "ESS score", skor tampil sebagai "96%" (bukan "96% Favorable"), bar tiga warna diganti bar tunggal; tanpa ringkasan -> "—" tanpa bar.
  - Tab "ESS Results by Directorate": header "Index"/"Q1..", nilai dengan "%"; keterangan tidak lagi menyebut "% favorable".
- **Backend (`calculationEngine.js`)**: hanya teks `ess_summary.description` (tanpa kata favorable; untuk metrik tanpa ringkasan: ajakan upload). Field API `percent_favorable/neutral/unfavorable` sengaja tetap ada (kompatibilitas, Modul 11/45), hanya tidak ditampilkan.
- **Tes**: tidak ada tes baru (perubahan tampilan). Suite penuh SQL (backend kedua): **202/202 lulus, 0 gagal, 16 dilewati** — modul Signature Program Event (8, 24) dan media (27, 32, 38, 41, 42, 43) di-skip atas permintaan user karena tidak tersentuh. `vite build` OK.
- **Pembersihan data tes**: setelah suite, batch upload milik admin sementara suite ("Regression Suite Admin (rt-suite-…)") dihapus. Filter itu ikut menghapus **80 batch lama** (140 baris CSV fixture Modul 5/12/13 dari run-run sebelumnya, sejak v2.29.x) selain 5 batch run ini. Semuanya data tes, bukan data user, tetapi ikut terhitung di metrik SYSTEM, sehingga Dashboard ALL YTD 2026 bergeser: Survey Index 88,62 -> 88,43, PX Index 84,56 -> 84,43 (Outcome 75,08 tetap). Tidak ada backup untuk baris itu.

---

## [2.32.0] - 2026-10-19

### Hasil ESS Diunggah sebagai Ringkasan Excel (.xlsx) per Direktorat (Changed)
- **Permintaan user**: untuk metrik ESS (Employee Sentiment Survey) cukup ringkasan hasil survei yang diunggah, bukan data per responden. Template = `docs/ESS 2025 Result_Role Clarity & DS Support.xlsx`; skor metrik = kolom F; baris Directorate "PT Bank CIMB Niaga" = Bankwide; berlaku untuk semua metrik ESS. File contoh itu milik metrik "Role Clarity & DS Support Score Index" (metrik 9); metrik ESS lain diisi data dummy. Irisan B dari 2 (irisan A = v2.31.0, master 12 direktorat).
- **Keputusan user**: (1) hanya ringkasan: baris ESS per responden dihapus; (2) *carry-forward*: dipakai hasil terakhir yang periodenya <= akhir periode yang dilihat, boleh dari tahun sebelumnya; (3) filter divisi membaca nilai direktorat induknya (ESS hanya dilaporkan per direktorat); (4) master direktorat sudah diganti di v2.31.0.
- **Format file** (sheet pertama, baris 1 = header): `A Directorate | B Level | C Year | D Month | E Participation | F <nama index> | G.. satu kolom per pertanyaan`. Baris yang kolom A diawali "PT Bank CIMB Niaga" (atau Level = `Bankwide`) = baris Bankwide; baris lain harus direktorat dari master. Skor boleh pecahan 0-1 (dikali 100) atau persen 0-100; teks "79%" dibaca sebagai persen. Satu file = satu periode; unggah ulang metrik + periode yang sama **mengganti** baris periode itu. Rincian aturan: `docs/SURVEY_IMPORT_GUIDE.md`.
- **Validasi atomik**: satu baris salah -> seluruh file ditolak (400) dengan daftar semua error per baris/kolom, tidak ada yang disimpan (file asli juga tidak). Ditolak antara lain: header A-E salah, F kosong, direktorat tidak ada di master, direktorat/Bankwide ganda, Year/Month berbeda antar baris, Level selain kosong/`Bankwide`/`Directorate`, partisipasi bukan bilangan bulat >= 0, skor di luar 0-100, sel formula tanpa nilai tersimpan, sel error Excel, kolom bernilai tanpa teks pertanyaan di baris 1, sheet tanpa baris data, bytes yang bukan `.xlsx`.
- **Implementasi**:
  - Service baru `server/services/essSummaryService.js`: pembaca/penulis `.xlsx` minimal di atas `jszip` (formula tidak pernah dievaluasi, dipakai nilai cache Excel), `validateEssSheet`, `importEssSummary`, `selectEssResult` (aturan periode + level org), `essOrgFor`, `generateEssTemplateXlsx`, `generateEssEvidenceCsv`, `essOriginalFilePath`. `jszip@3.10.1` kini dependensi langsung (`package.json`).
  - Tabel baru `px_ess_results` (SQL) / `essResults` (JSON): satu baris per unit org (Bankwide `directorate` NULL) per metrik dan periode, skor 0-100, `questions_json`. Storage baru di kedua backend: `getEssResults`, `getLatestEssPeriod`, `saveEssResultUpload` (riwayat upload + ganti baris periode dalam satu transaksi), `deleteEssResultsForMetric`; `hasSurveyDataInPeriod` dan `getAvailableSurveyYears` kini ikut membaca hasil ESS (hasil ESS dianggap bertanggal tanggal 1 bulannya). `getLatestEssPeriod` dan `deleteEssResultsForMetric` saat ini tidak dipanggil kode lain (hapus metrik memakai kaskade `deleteMetric`).
  - `calculationEngine.js`: metrik ESS mengambil `index` dan `participation` dari hasil yang terpilih (`raw_value`, `sample_size`; `last_survey_date` = `YYYY-MM`) plus field `ess_period`, `ess_period_label`, `ess_level`. Tanpa hasil -> `raw_value` statis dan `sample_size` 0 (seperti metrik survei tanpa data). Detail metrik (`buildEssDetail`): skor per pertanyaan = % favorable dari file, neutral/unfavorable = `null`, tab hasil per direktorat, info upload. Pertanyaan dicocokkan ke pertanyaan terkonfigurasi lewat **teks** (bukan posisi); tidak cocok -> label "Question N".
  - `POST /api/surveys/upload` menerima field file `file` atau `csvFile`. Untuk metrik ESS: hanya `.xlsx` (CSV teks -> 400; file `.csv`/`.xls` -> 415); `.xlsx` ke metrik SYSTEM -> 400; file ke `metric_id` yang tidak ada -> 404. Audit `SURVEY_UPLOAD` ("ESS summary metric N; period ..."). Baris CSV ber-`metric_id` ESS (template master / auto-detect) ditolak per baris.
  - `GET /api/surveys/template?metric_id=<ESS>` -> `Template_ESS_Metric_<id>.xlsx`; template master `ALL` tidak lagi memuat metrik ESS. `GET /api/surveys/evidence?metric_id=<ESS>` -> `Evidence_ESS_Summary_Metric_<id>.csv` berisi baris ringkasan tersimpan semua periode (`period` diabaikan; PIC hanya direktorat dalam cakupannya, tanpa baris Bankwide).
  - Endpoint baru `GET /api/surveys/ess-file/:upload_id` (Admin atau PIC metrik itu) untuk mengunduh file asli. File asli disimpan di `server/data/ess-uploads/<upload_id>.xlsx` (tidak disajikan lewat `/uploads`, di `.gitignore`); upload seed tidak punya file asli (404). Hapus metrik ikut menghapus hasil ESS dan file aslinya.
- **Migrasi data (sekali)**: pada boot yang membuat `px_ess_results` (JSON: saat `store.json` belum punya `essResults`), semua baris per responden milik metrik ESS dihapus beserta batch upload yang menjadi kosong; data SYSTEM tidak disentuh. Database utama (laporan developer): **2.568** baris ESS per responden dan **60** batch kosong dihapus; `seed-batch-2026` tetap (masih berisi baris SYSTEM). Metrik yang belakangan diubah SYSTEM -> ESS tidak dibersihkan: barisnya tetap ada tetapi diabaikan perhitungan.
- **Seed (dummy)**: 13 baris (Bankwide + 12 direktorat) x 11 metrik ESS = 143 baris periode November 2025 + satu record riwayat per metrik (`uploaded_by` "Seed (dummy)"), hanya untuk metrik ESS yang belum punya hasil sama sekali (`SEED_DEMO_DATA` bukan `false`). Metrik 9 = nilai persis file user; metrik lain memakai angka partisipasi file itu, index Bankwide = `raw_value` seed metrik, tiap direktorat dalam kisaran +-4 poin.
- **UI**: `SurveyImportModal.jsx` (metrik ESS: hanya `.xlsx`, tanpa pratinjau teks, panduan kolom, panel hasil: periode, jumlah baris, index Bankwide, "replaced previous upload", daftar error); tombol "Template (.xlsx)" di Explore Metrics, detail metrik dan Survey Templates; `MetricDetailModal.jsx` (kartu Participation, "ESS Result Period", tab "ESS Results by Directorate", tombol "Original File", catatan filter divisi); Explore Metrics menampilkan "participants" dan periode ESS.
- **Dampak angka** (laporan developer, Dashboard ALL YTD 2026): Survey Index 89,88 -> 88,62; Outcome Index 75,08 tetap; PX Index 85,44 -> 84,56. Metrik 9: 80,52 -> 92,00, sample 7.756.
- **Perbaikan sampingan (Fixed)**: file sementara upload kini dihapus secara sinkron sebelum respons dikirim (sebelumnya bisa masih ada saat tes memeriksa folder; penyebab flake Modul 36).
- **Tes**: Modul 45 baru = **10 tes** (1 khusus SQL). Disesuaikan: Modul 4 (baris template master = jumlah metrik SYSTEM), 11 (ESS dibaca dari ringkasan: periode 2025-11, partisipasi 7756, neutral/unfavorable `null`), 12 (CSV pindah ke metrik 8; CSV yang sama ke metrik 9 -> 400), 39 (CSV ke metrik ESS -> 400; upload ESS/PIC memakai `.xlsx`). Env tes baru `TEST_SKIP_MODULES=27,32,...` / `TEST_SKIP_MEDIA=1`: tes yang dilewati dilaporkan SKIPPED, tidak pernah PASS. Hasil developer: **SQL 209/209, 0 gagal**, modul media 27/32/38/41/42/43 dilewati. JSON: hanya cek in-process terarah (cleanup 2.511 baris, 143 baris seed, 92/7756, 91/449, ganti periode, file invalid tidak menyimpan apa pun, kaskade hapus, reminder); suite JSON penuh **tidak** dijalankan. Detail: `docs/07` §28.
- **QC (terarah, area direktorat v2.31.0 + ESS v2.32.0): LULUS DENGAN CATATAN.** Semua angka, aturan periode/level org, uji negatif (8 jenis xlsx salah + 6 jenis file salah, tidak ada yang tersimpan), scope USER (rata-rata berbobot partisipasi 91,30/578 untuk Business Banking + HR; direktorat lain 403) dan UI cocok. Diperbaiki setelah QC: tombol "Original File" kini hanya tampil bila file asli memang tersimpan (`ess_upload.has_original_file`; sebelumnya muncul untuk data seed dan mengunduh JSON 404); file yang dikirim ke `metric_id` tak dikenal -> 404 (bukan pesan "only for ESS metrics"; jalur CSV-teks tetap menolak per baris seperti Modul 39). Suite penuh setelah perbaikan: **SQL 209/209, 0 gagal**, modul media dilewati. Catatan QC yang belum dikerjakan (rendah): riwayat upload tetap menampilkan batch lama "13 rows" setelah diganti; nilai F antara 1 dan 100 dibaca sebagai persen (mis. 1,5 = 1,5%); periode tanpa ESS memakai `raw_value` statis dan tetap ikut Survey Index; judul modal upload masih "Template & Bulk CSV Upload"; baris Level = Bankwide dianggap Bankwide apa pun isi kolom A.
- **Batasan / belum dikerjakan**: metrik ESS tanpa hasil apa pun masih memakai `ess_summary` placeholder lama di detail metrik; metrik ESS (tahunan, batas 25 November) akan mendapat e-mail pengingat setelah 25 November 2026 bila hasil 2026 belum diunggah; modul media tidak dijalankan ulang; tampilan mobile tidak diuji.
- **Teknis**: versi `/api/health` 2.32.0. Tidak ada env aplikasi atau setting `px_app_settings` baru. `npm run db:export` dan `server/db/migrate.js` ikut membawa `essResults`. Detail: `docs/04` "Catatan v2.32.0", `docs/05`, `docs/06`, `docs/08` §17, `SQLServerDB.md` §16.

---

## [2.31.0] - 2026-10-19

### Master Direktorat Diganti 12 Direktorat Riil Bank + Migrasi Nama Otomatis (Changed)
- **Permintaan user**: hasil ESS (Employee Sentiment Survey) akan diunggah per direktorat memakai daftar direktorat riil bank dari `docs/ESS 2025 Result_Role Clarity & DS Support.xlsx`. User memilih **mengganti** 8 direktorat demo aplikasi dengan 12 direktorat riil: Business Banking; Compliance, Corporate Affairs & Legal; Consumer & EBB; Corporate Assurance; Human Resources; Network & Digital Banking; Operations, Technology, Analytics & AI; Risk Management; Sharia Banking; Special Asset; Strategy, Finance & SPAPM; Treasury & Capital Market. Baris "PT Bank CIMB Niaga Tbk" di file ESS = baris Bankwide, **bukan** direktorat. Rilis ini irisan A dari 2; irisan B (v2.32.0, upload ringkasan ESS `.xlsx`) menyusul.
- **Pemetaan** (`server/db/directorateMigration.js`, `DIRECTORATE_RENAMES`): pengecualian divisi diperiksa dulu, lalu default direktorat; nama dibandingkan setelah trim dan tanpa membedakan huruf besar/kecil. Nama divisi **tidak** berubah, hanya dipindah induknya; tidak ada divisi yang dikarang (Sharia Banking dan Special Asset 0 divisi, Corporate Assurance 1).

| Direktorat lama | Direktorat baru (default) | Pengecualian divisi |
| :--- | :--- | :--- |
| Commercial & Corporate Banking | Business Banking | Investment Banking & Markets -> Treasury & Capital Market |
| Consumer Banking | Consumer & EBB | - |
| Digital Banking | Network & Digital Banking | - |
| Finance & Operations | Strategy, Finance & SPAPM | Treasury Operations -> Treasury & Capital Market; Central Operations & Services -> Operations, Technology, Analytics & AI |
| Human Resources | Human Resources | - |
| Information Technology | Operations, Technology, Analytics & AI | - |
| Internal Audit & Legal | Compliance, Corporate Affairs & Legal | Internal Audit Group -> Corporate Assurance |
| Risk Management | Risk Management | - |

- **Implementasi**:
  - Modul baru `server/db/directorateMigration.js` (`mapDirectorate`, `renamedDirectorate`, `planDirectory`, `migrateScopes`, `migrateDirectorateOptions`, `DIRECTORATE_SETTING_KEYS`), dipakai kedua backend sehingga pemetaannya tidak bisa berbeda.
  - SQL: `migrateDirectorates()` di `sqlStorage.js`, dipanggil di `init()` tepat setelah `seedIfEmpty()` dan sebelum seed/top-up lain (`topUpDirectory()` dst.), dalam **satu transaksi**; juga dipanggil di akhir `server/db/migrate.js` karena `store.json` lama masih memuat nama lama.
  - JSON: `migrateStoreDirectorates()` saat `store.json` dimuat (sebelum top-up direktori, lalu disimpan) dan `migrateAuthDirectorates()` saat `auth.json` dimuat; `storage.migrateDirectorates()` juga tersedia.
  - **Idempoten tanpa flag**: yang dideteksi adalah nama lama; jalan ulang = 0 perubahan. Konsekuensi: data yang diunggah **belakangan** dengan nama demo lama ikut di-rename pada boot berikutnya.
  - Yang di-rename: direktori dibangun ulang dalam urutan seed (direktorat yang bukan nama lama dan bukan seed dipertahankan beserta divisinya); baris survei **EMPLOYEE** saja (`org_unit_1`; baris mahasiswa/kandidat yang memakai kolom itu untuk universitas/posisi tidak disentuh); absensi event; kolom legacy `px_users.directorate`; `px_recruitment_sla_by_unit.unit`; `px_user_scopes` (cakupan "semua divisi" pada direktorat lama -> "semua divisi" direktorat default baru + tiap divisi pengecualian, sehingga akses akun identik); setting `event_manager_directorates`.
  - Log boot (hanya bila ada perubahan): `Directorate master migrated to the 12 real directorates: ...`.
  - **Sengaja tidak di-rename**: `px_audit_log`, CSV evidence historis, nama file upload.
  - Seed (`initialDirectorates`, pool karyawan demo, `respondentOrgUnits`, contoh absensi, unit SLA metrik 1) memakai nama baru; logika pembuatan skor demo tidak berubah. Contoh baris template CSV (`surveyTemplateService.js`) memakai nama baru; nama yang mengandung koma otomatis dikutip (`escapeCsv`).
  - Tidak ada endpoint, setting, tabel, kolom, atau env baru. Versi `/api/health` 2.31.0.
- **Hasil migrasi database utama** (laporan developer): `directorates_removed=6, divisions_moved=28, survey_responses=3640, attendances=3, user_scopes=0, users=0, app_settings=0, operational_records=2`. Baris EMPLOYEE 4.920 sebelum = 4.920 sesudah (Finance & Operations 580 -> Strategy, Finance & SPAPM 280 + Treasury & Capital Market 300; Internal Audit & Legal 540 -> Compliance, Corporate Affairs & Legal 260 + Corporate Assurance 280; lainnya 1:1). Akun admin asli, 3 event, dan 6 record media tetap. Catatan: record video `med-1791719574927-rd10q` (catatan v2.24.1) sudah tidak ada di database **sebelum** migrasi ini.
- **Tes**: Modul 5, 7, 8, 11, 15, 24 memakai nama baru; Modul 15 kini mengharapkan >= 12 direktorat. Helper baru `csvCell()`: Modul 35/36/39 mengutip direktorat/divisi di 23 baris CSV. Modul 44 baru = **6 tes** (2 khusus SQL). Hasil developer: **SQL 278/278, 0 skip** (backend kedua) = 272 + 6. JSON: suite penuh **tidak** dijalankan; cek in-process `jsonStorage` pada salinan cadangan `store.json` lulus 11/11 (`store.json` dipulihkan, hash identik). `vite build` OK. **Belum ada QC terpisah** (dijadwalkan bersama irisan B). Detail: `docs/07` §27, `docs/08` §16.
- **Catatan**: `server/data/store.json` masih memuat nama lama sampai diekspor dengan `npm run db:export -- --replace` (server dihentikan dulu; tanpa `--replace` hasilnya ke `store.from-sql.json`). Entri historis CHANGELOG/dokumen tetap memakai nama lama.

---

## [2.30.3] - 2026-10-16

### Validator AI Summary: Kata Berimbuhan Tidak Lagi Dihitung "Baru" & Ambang Tolak Diperbaiki (Fixed)
- **Laporan user**: kartu video "Tentang WAKTU" (`med-1792147085411-jvp16`; transkrip hanya 411 karakter / 59 kata, **tidak** di-chunk) menampilkan *"The AI summary was rejected by the validator; the automatic (rule-based) summary is shown"* (label **Automatic (rule-based)**).
- **Akar masalah** (diagnosis developer dengan Gemma asli, **satu kali**, lewat skrip terpisah yang tidak menulis ke database). Penyebab utamanya bukan sekadar validator yang terlalu ketat:
  - **Percobaan 1** (10,7 dtk) benar-benar **mengarang isi** ("dampaknya bagi masa depan", "dampak negatif", "kehidupan sosial yang bermakna", "terbuang percuma"): 15 dari 46 kata isi (33%) tidak ada di transkrip. Penolakan validator di sini **benar**; model 4B cenderung menghias teks yang sangat pendek.
  - **Percobaan 2** (retry, 11,1 dtk): hanya 3 dari 42 kata isi (7%) yang baru, lolos.
  - Dugaan awal "validator hanya menolak parafrase/imbuhan" **sebagian keliru**: dari kata-kata di log, hanya sedikit yang luput karena morfologi (mis. merasa~terasa, waktunya~waktuku); sisanya kata netral (mis. seringkali, sangatlah) yang belum ada di daftar netral.
  - Angka di atas dari laporan developer; run asli yang ditolak di layar user tidak dihitung ulang oleh penulis dokumen. Video itu kini berstatus `summary_source = AI` (sudah diregenerasi).
- **Perubahan** (`server/services/mediaSummaryService.js`):
  - **Pencocokan berbasis stem.** Indonesia: awalan me-/mem-/men-/meng-/meny-/memper-/ber-/ter-/per-/pe-/di-/ke-/se- (sampai dua lapis, termasuk varian nasal dan r-drop), akhiran -kan/-an/-i, klitik -nya/-ku/-mu/-lah/-kah/-pun. Inggris: -s/-es/-ed/-ing/-ly/-er/-ion/-ment (dengan konsonan ganda dan e-bisu). Stem minimal 4 huruf; stem 5+ huruf yang merupakan awalan stem lain (selisih maksimal 4 huruf) juga cocok (sosial~sosialisasi).
  - **Daftar kata netral diperluas** (penghubung, kata bantu, kata ganti, kata derajat/frekuensi, kata kerja pelapor). Dicocokkan **kata persis**: versi awal yang mencocokkan lewat stem membuat "pendapatan" lolos sebagai netral lewat "dapat" (tertangkap tes). Hanya himpunan kecil `NEUTRAL_ROOTS` (jelas, cerita, sampaikan, bahas, ungkap + kata kerja pelapor Inggris) yang dicocokkan lewat stem.
  - **Ambang baru** (`NOVEL_LIMITS` / `tooManyNovelWords`): tolak bila kata isi baru >= 5 **dan** > 30% dari kata isi ringkasan, atau >= 12 kata; transkrip > 5000 karakter: > 35% atau >= 18 kata. Sebelumnya: >= 3 kata **dan** > 20%.
  - **Tag HTML/markup ditolak** (`memuat tag HTML/markup`); validator lama menerima `<b>..</b><script>..`.
  - **Umpan balik retry**: menyebut sampai 12 kata yang ditolak (sebelumnya 8), dan kedua prompt retry (id/en) ditambah: pakai hanya kata yang benar-benar ada di transkrip (salin frasa bila ragu) dan tulis lebih pendek (2-3 kalimat, 3 poin pendek). Jumlah panggilan Gemma tidak berubah (1 per bagian + 1 gabungan, retry maksimal 1).
  - **Jalur transkrip panjang (tidak diubah, dicatat)**: `validateAnswer` memeriksa jawaban gabungan terhadap transkrip **penuh**, jadi kata yang hanya ada di ringkasan parsial tidak dianggap ada di sumber; ringkasan parsial sendiri tidak divalidasi (halusinasi parsial yang terulang di tahap gabungan ditolak di sana).
  - Ekspor baru: `summarizeWithAi`, `tooManyNovelWords`, `NOVEL_LIMITS`.
- **Tidak dilonggarkan**: angka/digit dan kata bilangan (bentuk berimbuhan seperti "keenam" tidak diselamatkan oleh "enam"), nama/akronim berkapital, bahasa salah, frasa meta, ringkasan < 40 karakter, dan format `RINGKASAN:`/`POIN:`.
- **Verifikasi (laporan developer)**: ringkasan AI tersimpan pada 3 video user lulus validator lama **dan** baru (jumlah kata baru/kata isi: `guy1o` 0/90 -> 0/81; `rrwc3` yang di-chunk 12/60 = tepat 20% lolos kebetulan -> 9/56; `jvp16` 3/42 -> 1/35). Himpunan uji `tests/helpers/summaryValidatorCases.js`: **positif 10 kasus** (validator lama meloloskan 8, baru 10), **negatif 14 kasus** (lama menolak 13, baru 14; tambahan = HTML). Dua kasus positif adalah parafrase padat **buatan developer**, bukan keluaran Gemma asli.
- **Tes**: Modul 43 baru = **6 tes offline** (dihitung dari kode: 6 pemanggilan `runTest`; tanpa Ollama dan tanpa database, dirancang jalan di SQL dan JSON) + satu asersi tambahan di Modul 38 (prompt retry memuat `benar-benar ada di transkrip`). Hasil developer: **SQL 272/272, 0 skip** (backend kedua) = 266 + 6; hitungan statis `await runTest(` di `tests/regressionTest.js` kini 259 vs hasil jalan 272 (selisih 13, sama dengan v2.30.2). **Tidak ada QC terpisah** untuk rilis ini dan **suite JSON penuh tidak dijalankan**.
- **Batasan**: (1) distorsi makna yang halus tetap bisa lolos - ini trade-off yang diminta; ringkasan bergaya parafrase dengan ~25% kata baru (mis. 10 kata) kini lolos. (2) Sinonim yang bukan imbuhan (perlahan vs pelan) tidak dicocokkan. (3) Gemma bisa mengarang lagi pada teks yang sangat pendek; hasilnya tetap jatuh ke `RULE`. (4) Gemma asli dipakai satu kali untuk diagnosis, bukan di suite. (5) Regenerate pada satu video = 1-2 panggilan Gemma (+-11 dtk per panggilan di CPU mesin ini; `seed` tetap = `40 + percobaan`, jadi deterministik).
- **Teknis**: versi `/api/health` 2.30.3. Tidak ada endpoint, setting, tabel, atau env baru. Backend utama harus di-restart agar validator baru aktif.
- **Temuan sampingan**: file `Tentang WAKTU (Video Narasi) - molypond (1080p, h264).mp4` di `server/uploads` sudah memakai nama asli - rename v2.30.1 terbukti jalan di aplikasi nyata.

---

## [2.30.2] - 2026-10-16

### Nama File Asli Terlihat di Monitoring Video Extractor (Changed)
- **Masalah**: menu monitoring layanan Video Extractor menampilkan nama acak `media-<timestamp>-<rand>.mp4`, karena itulah `source` (path file) yang dikirim `transcribeService.js` ke `POST /transcribe`. API Extractor ('Video/Audio to Text v1.1': `POST /transcribe {source, language}`, `/transcribe/upload`, `/batch`, `/jobs`, `/summarize`) **tidak punya field nama tampilan**, dan kontrak API itu tidak diubah. v2.30.1 hanya me-rename file SETELAH proses selesai, sehingga selama proses (saat monitoring dilihat) nama acak tetap tampil.
- **Solusi**: sebelum memanggil API, `transcribeService.js` membuat **hard link** (`fs.promises.link`, bukan salinan, tanpa ruang disk tambahan) ke file video di `server/tmp-transcribe/<media_id>/<nama asli tersanitasi>` dan mengirim path link itu sebagai `source`; Extractor menerima basename = nama file yang diunggah. Nama dibentuk oleh `sanitizeVideoFileName()` (`mediaFileService.js`, fungsi yang sama dengan rename final v2.30.1), stem dipendekkan bila path > 250 karakter (`MAX_LINK_PATH_CHARS`). Satu job satu folder, jadi dua unggahan bernama sama tidak bertabrakan. Folder berada **di luar `server/uploads`** (tidak di-serve statik, tidak ada route-nya) dan masuk `.gitignore`.
- **Fallback**: bila link gagal (beda volume/bukan NTFS `EXDEV`, `EPERM`, `ENOENT`, atau nama ditolak sanitizer) path acak lama dikirim seperti sebelumnya; hanya `console.warn`.
- **Retry**: bila panggilan dengan path link gagal CEPAT (< 15 detik, `FAST_FAILURE_MS`) dengan error yang tampak seperti file tak terbaca (HTTP 404/422/500, atau pesan "not found" / "No such file" / "cannot open" dan sejenisnya), dilakukan **satu** percobaan ulang dengan path acak sebelum `FAILED`. **Tidak** ada retry pada timeout, Extractor mati (connection refused), connection reset, atau kegagalan yang lebih lambat dari 15 detik. `postJson` kini membawa `statusCode`/`isTimeout`/`isUnreachable` pada error-nya untuk membedakan kasus-kasus itu.
- **Pembersihan**: folder link dihapus di `finally`, segera setelah panggilan ke Extractor selesai (berhasil, gagal, atau timeout) dan SEBELUM transkrip disimpan, sehingga rename final v2.30.1 (`finalizeMediaFileName`) berjalan setelah link hilang. Menghapus link hanya menghapus satu nama; file asli di `server/uploads` tidak tersentuh. `DELETE` media saat `PROCESSING` tidak meninggalkan folder (dibersihkan oleh `finally` saat job berakhir). Saat boot, `cleanupTranscribeTempDirs()` (dipanggil di `server.js` SEBELUM job yang tertunda dilanjutkan, juga bila `PX_DISABLE_RESUME=1`) menghapus semua isi `server/tmp-transcribe` kecuali folder media berstatus `PROCESSING`; job yang di-resume membuat link baru.
- **Teknis**: `transcribeService` mengekspor tambahan `cleanupTranscribeTempDirs` dan `TMP_DIR`. Versi `/api/health` menjadi 2.30.2. Tidak ada endpoint, tabel, kolom, atau env baru. File baru: `tests/helpers/failLinkPreload.js` (dipakai lewat `node --require` hanya pada backend kedua tes, untuk memaksa `fs.promises.link` gagal seperti `EXDEV` selama file bendera tertentu ada).
- **Tes**: Modul 42 baru = **15 tes** (dihitung dari kode: 1 tes statis yang juga jalan di JSON + 14 tes khusus SQL dengan backend kedua dan Video Extractor/Ollama palsu yang merekam `source`; di JSON 14 tes di-skip dengan pesan). Modul 41: 2 asersi `source` disesuaikan (kini basename = nama unggahan dan foldernya bukan `server/uploads`). Hasil developer: **SQL 266/266, 0 skip** (backend kedua) = 251 + 15. Suite JSON **tidak** dijalankan ulang untuk versi ini.
- **Belum terverifikasi / batasan**: (1) **Tidak ada QC terpisah** untuk rilis ini. (2) Tampilan **menu monitoring Video Extractor yang asli BELUM diperiksa** — user akan mengujinya dengan video pendek asli; yang terbukti oleh tes hanya `source` yang diterima Extractor palsu. (3) Hard link butuh `server/uploads` dan `server/tmp-transcribe` di **volume NTFS yang sama**; bila tidak, path acak dipakai. (4) Entri yang sudah tercatat di Extractor sebelum versi ini tetap bernama acak. (5) Perilaku Extractor asli terhadap path ber-karakter `[ ] ( ) é` belum diuji (retry satu kali melindungi). (6) Kasus Windows "file in use" saat menghapus link tidak disimulasikan (hanya peringatan; sisa dibersihkan saat boot). (7) Backend utama harus di-restart agar berlaku. (8) Belum dikerjakan: Activity Log dan log durasi proses; foto HEIC masih ditolak.

---

## [2.30.1] - 2026-10-16

### File Video Diganti Namanya Sesuai Nama Asli Setelah Proses Selesai (Changed)
- **Permintaan**: unggahan video disimpan di `server/uploads` dengan nama acak `media-<timestamp>-<rand>.<ext>` dan nama acak itu terlihat di menu monitoring layanan Video Extractor. Setelah seluruh proses selesai (transkrip sampai AI Summary), file fisik kini **diganti namanya menjadi nama file yang diunggah** (`px_media.file_name`), dan `px_media.file_path` mengikuti (`/uploads/<nama, URL-encoded>`).
- **Kapan**: hanya video, hanya saat pipeline mencapai keadaan akhir: `transcript_status = DONE` dan `summary_status` salah satu dari `DONE` (AI atau RULE) / `FAILED` / `INSUFFICIENT`, atau `transcript_status = FAILED`. Tidak pernah saat transkrip atau ringkasan masih `PROCESSING`/antri (dicek di database **dan** di antrean memori), sehingga Video Extractor/Ollama tidak kehilangan file. Dipanggil dari ujung job transkripsi, ujung job ringkasan (termasuk tombol manual "Regenerate summary" dan job yang dilanjutkan saat boot), serta cabang `INSUFFICIENT`/antrean penuh. `GET` event/dashboard dan boot tidak pernah me-rename; video lama baru di-rename bila user menekan Regenerate summary / Try again padanya dan prosesnya selesai.
- **Keamanan nama**: hanya basename (tanpa direktori/`..`), karakter ilegal Windows `<>:"|?*` dan karakter kontrol/bidi dibuang, titik/spasi di ujung dan awal dipangkas, batas 150 karakter (dan jalur ter-encode muat di kolom 500), nama reservasi Windows (`CON`, `NUL`, `COM1` ...) diawali `_`, nama akhir selalu berekstensi video yang dikenal (bila ekstensi nama asli bukan video, ekstensi nama sementara ditambahkan di belakang; tanpa ekstensi video sama sekali, atau nama kosong/tidak layak, nama acak dipertahankan). Nama asli yang terbaca sebagai latin1 oleh multer (mojibake) dikembalikan ke UTF-8 hanya bila hasilnya pasti valid. Tabrakan nama tidak pernah menimpa file lain: ditambah akhiran ` (1)`, ` (2)` ...; rename, update record, dan DELETE diserialkan lewat satu kunci.
- **Kegagalan tidak fatal**: file hilang, izin ditolak, atau file terkunci (EBUSY dicoba ulang sekali) hanya menulis peringatan di console; record tidak berubah. Rename dilakukan sebelum update database; bila update gagal, rename dibatalkan.
- **Perubahan teknis**: service baru `server/services/mediaFileService.js` (`finalizeMediaFileName`, `deleteMediaAndFile`, `resolveUploadPath` yang kini men-decode URL, `sanitizeVideoFileName`, `repairUploadedName`); `updateMedia` di `sqlStorage.js` dan `jsonStorage.js` kini menerima `file_path`; ekstensi nama sementara upload disaring (`safeExtension`); `DELETE /api/media/:id` menghapus file bernama baru; `EventManager.jsx` mengambil ulang event sekali setelah job terakhir selesai dan lightbox memakai `file_path` terbaru; env opsional `PX_DISABLE_RESUME=1` (hanya untuk backend kedua yang berbagi database dengan backend yang sedang memproses video) mematikan lanjutan job saat boot.

### Perbaikan Temuan QC: Kartu Media Pulih Setelah Rename & Unggahan Dibatasi Allowlist Ekstensi (Fixed / Security)
- **UI (`EventManager.jsx`, `MediaCard`)**: state `broken` ("File not available on the server") kini di-reset oleh `useEffect` yang bergantung pada `med.file_path`, dan elemen `<video>`/`<img>` diberi `key={med.file_path}` sehingga dimuat ulang dari path baru. Sebelumnya, error 404 pada jendela antara rename file dan refetch membuat kartu macet sampai halaman di-reload. Foto seed yang filenya memang tidak ada tetap menampilkan "File not available" (path-nya tidak berubah, jadi tidak ada loop reload). Input file memakai daftar ekstensi eksplisit (bukan `image/*`, yang menawarkan SVG).
- **Keamanan upload (`server.js`, `mediaFileService.js`)**: filter unggahan sebelumnya hanya memeriksa MIME dari klien, sehingga `evil.html`/`clip.exe` yang dikirim sebagai `video/mp4` lolos dan tersimpan/di-rename berekstensi `.html`. Kini **MIME dan ekstensi terakhir harus sama-sama lolos dan sekelompok** (gambar atau video), kalau tidak dijawab **415** dan tidak ada file/record yang tersimpan. Allowlist: gambar `jpg jpeg png gif webp bmp avif`; video = `VIDEO_EXTENSIONS` (`mp4 m4v mov webm mkv avi ogv mpg mpeg 3gp wmv flv`). Ekstensi ganda boleh bila yang terakhir lolos (`a.html.mp4` diterima dan tetap berakhir `.mp4`).
- **Keputusan SVG**: **ditolak** (bisa memuat script; di `server/uploads` tidak ada file `.svg`, jadi tidak ada data lama yang terdampak). HEIC/HEIF tidak dimasukkan (browser tidak bisa menampilkannya), sehingga foto iPhone berformat HEIC kini dijawab **415** dan harus diubah dulu ke JPG/PNG.
- **Rename**: `sanitizeVideoFileName()` mengembalikan `null` (nama acak dipertahankan) bila tidak ada ekstensi video sama sekali; nama akhir tidak pernah berekstensi non-video (`clip.exe` menjadi `clip.exe.mp4`).
- **Pertahanan kedua di `/uploads`**: tetap `X-Content-Type-Options: nosniff`; ditambah `Content-Security-Policy: default-src 'none'; ...; sandbox` pada semua file, dan `Content-Disposition: attachment` untuk file yang ekstensinya di luar allowlist (file lama berekstensi lain hanya bisa diunduh, tidak dieksekusi di browser). Video berekstensi allowlist tidak diberi `attachment`, jadi pemutaran dan range request (206) tidak terpengaruh.
- **Tes**: Modul 41 (`tests/regressionTest.js`, detail di `docs/07` §24) = **34 tes di SQL Server**, 7 di JSON (6 tes umum + satu cek statis whitelist `updateMedia`; sisanya dilewati karena memakai database langsung dan backend kedua dengan Ollama/Video Extractor palsu). Cakupan: aturan nama, allowlist ekstensi (`mediaKindOfName`), tes statis `MediaCard`, rename di semua keadaan akhir, tidak pernah rename saat belum final, tabrakan nama, rollback bila update database gagal, DELETE, `PX_DISABLE_RESUME`, GET read-only, end-to-end video baru, 15 unggahan berbahaya -> 415 tanpa file/record, MP4/JPG normal 201, `a.html.mp4`, header `/uploads` + range 206 + 401 tanpa sesi. Tes lama `odd.m<p4` dan `noext` disesuaikan dengan aturan baru.
- **Verifikasi** (angka dari laporan QC/developer; penulis dokumen tidak menjalankan ulang suite): QC pertama **LULUS DENGAN CATATAN** - SQL 246/246 (Modul 38, khusus SQL, dijalankan penuh), JSON 204/204, uji end-to-end rename lewat API/UI 38/38. Temuan QC di atas diperbaiki developer; setelah itu suite SQL **251/251** di backend kedua, tanpa skip (251 = 217 sebelumnya + 34 tes Modul 41). Suite JSON **tidak dijalankan ulang** setelah perbaikan. Verifikasi singkat QC atas perbaikan: **LULUS DENGAN CATATAN**, tanpa bug baru (filter 415 untuk 12+ kombinasi nama/MIME berbahaya, foto valid 201, header `/uploads` 206/nosniff/CSP, kartu video user dan lightbox memutar, foto seed tanpa file tidak loop, 3 video user utuh). Catatan: satu uji QC sempat memicu Whisper asli sekali dengan file sampah (FAILED, tanpa dampak; Gemma tidak dipanggil).
- **Harness**: Modul 38 dan 41 mensyaratkan tidak ada video berstatus `PROCESSING` di database; jalankan suite SQL tanpa `TEST_ADMIN_USER`/`TEST_ADMIN_PASSWORD`. Hitungan statis `await runTest(` (238) masih berselisih dengan hasil jalan (251): 13 tes, terdiri dari 4 (loop lima keadaan akhir di Modul 41) - 1 (tes khusus JSON yang tidak jalan di SQL) = +3 dari Modul 41 dan 10 sisa lama yang belum dijelaskan (sama dengan v2.29.0/v2.30.0).
- **Celah lama**: unggahan file seperti `evil.html` yang dikirim dengan MIME `video/mp4` sudah bisa lolos **sebelum v2.30.1** (filter sejak v2.21.0 hanya memeriksa MIME); file tersimpan di `server/uploads` dan disajikan oleh `/uploads`. Eksploitasinya membutuhkan login (mengunggah = Admin atau pengelola event; `/uploads` butuh sesi sejak v2.26.0). Diperbaiki di rilis ini (filter allowlist + header `/uploads`); file yang sudah telanjur ada tidak dipindai atau dihapus oleh rilis ini - bila ada yang berekstensi di luar allowlist, kini hanya bisa diunduh.
- **Catatan / batasan**:
  - Entri di layanan Video Extractor (`:8000`) yang sudah tercatat dengan nama acak sebelum rename tidak ikut berubah; monitoring Extractor tidak diubah. Usulan (belum dikerjakan, tergantung API-nya mendukung): mengirim nama asli sebagai field opsional `display_name` ke API transkrip.
  - Rename file terkunci/ditolak OS hanya diuji dengan simulasi (`EBUSY`/`EPERM` pada `fs.promises.rename`), bukan dengan file yang benar-benar dibuka program lain.
  - Foto HEIC/HEIF (mis. dari iPhone) kini ditolak (415) dan harus dikonversi ke JPG/PNG dulu.
  - Activity Log dan log durasi proses belum dikerjakan.

---

## [2.30.0] - 2026-10-16

### UI Seluruhnya Berbahasa Inggris, Filter Bulan Tanpa Angka, Batas Proses 120 Menit, Sign out di Pojok Kanan Atas & Perbaikan Crash Form Publik (Changed / Fixed)
- **Permintaan**: seluruh tampilan aplikasi berbahasa Inggris (nama menu, tombol, judul, pesan), nama tema yang lebih deskriptif, filter bulan hanya berupa nama bulan, batas waktu proses panjang (transkrip, Gemma, upload video) 120 menit, tombol "Target" di Explore Metrics dihapus, info user + Sign out di pojok kanan atas. Pekerjaan UI Inggris/tema/bulan/limit yang sebelumnya ada di branch `wip/v2.29.0-ui-english` **diterapkan ulang dari awal** di versi ini; Activity Log dan log proses/durasi dari branch itu **belum** dibawa.
- **UI Inggris**: semua label/tombol/judul modal/placeholder/tooltip/header tabel/empty state di `src/**` (Header, Dashboard, Explore Metrics, MetricDetail, TrendChart, Admin Parameters, Survey Questions, Email Settings, Manage Users, layar login/ganti password, EventManager termasuk blok AI Summary/Transcript, form publik, About). Nama menu baru: **Manage Users** (dulu Kelola User), **Email Settings** (dulu Setting Email), **Admin Parameters** (dulu Parameter Admin), **Theme** (dulu Tema), **Upload Deadline Date** (dulu Batas Tanggal Upload), **Data Update Frequency** (dulu Frekuensi Update Data), **Monthly** / **Annual** (dulu Bulanan / Tahunan). Judul narasi alert di Dashboard menjadi "Analysis Summary". Nilai internal/enum yang menggerakkan logika (`MONTHLY`, `ONE_TIME_ANNUAL`, `SURVEY`, id tema, dst.) tidak diubah.
- **Sengaja tetap Indonesia**: isi 44 istilah About; nama metrik, journey, direktorat, divisi, dan program; katalog pertanyaan survei; header kolom CSV evidence; template/isi e-mail pengingat PIC (`reminderService.js`; hanya `expected_period_label` dan nama bulan di dalamnya yang kini Inggris); prompt dan validator Gemma (`mediaSummaryService.js`); data di database (mis. Action Library). Teks-teks ini bukan label antarmuka; menerjemahkannya perlu keputusan terpisah.
- **Nama tema**: `Crimson`, `Royal Blue`, `Teal`, `Violet`, `Tangerine` (`src/utils/theme.js`). `id` preset dan kunci `localStorage` tidak berubah, jadi pilihan yang sudah tersimpan di browser tetap berlaku.
- **Filter bulan**: semua dropdown/label bulan menampilkan nama bulan Inggris saja, tanpa angka (nilai internal tetap `01`..`12` yang dikirim ke API); sumbu grafik memakai singkatan Inggris (Jan, Feb, ...); label periode MTD menjadi "Month-to-Date (MTD) March 2026". Helper bersama: `src/utils/months.js` (`MONTH_NAMES`, `MONTH_SHORT`, `monthName()`, `monthShort()`), dipakai `Header`, `Dashboard`, `TrendChart`, `Calculator`, `MetricDetailModal`, `AdminParametersModal`.
- **Label opsi dari database** (`px_app_settings`: `metric_types`, `scale_types`, `target_audiences`, `update_frequencies`) menjadi Inggris. Seed default diganti, dan ada top-up saat boot: `topUpOptionLabels()` di `sqlStorage.js`, serta blok setara saat memuat `store.json` di `jsonStorage.js`, keduanya memakai `LEGACY_OPTION_LABELS` + `upgradeLegacyOptionLabels()` (`seedData.js`). Label diganti **hanya bila masih persis sama dengan default Indonesia lama**; hasil edit admin (walau beda satu spasi) dan `value` tidak pernah ditimpa; katalog di luar daftar (mis. `event_types`) tidak disentuh; dijalankan ulang tidak mengubah apa pun.
- **Pesan backend menjadi Inggris** (sekitar 215 pesan menurut developer; tidak dihitung ulang oleh penulis dokumen): pesan `error`/`message` API dan validasi, login/password, 401/403/404, `transcript_error`/`summary_error`, alasan baris CSV ditolak, `expected_period_label` (mis. "September 2026", "year 2026"), `month_name` pada tren (January ... December), narasi alert dan event summary berbasis aturan, ringkasan `RULE` dan `INSUFFICIENT` (badge UI "Automatic (rule-based)", dulu "Otomatis (aturan)"), dan teks slide PPT. Alasan penolakan validator Gemma kini **hanya ditulis ke console server**; `summary_error` berisi kalimat umum Inggris ("The AI summary was rejected by the validator; the automatic (rule-based) summary is shown.").
- **Batas waktu 120 menit** (semua bisa di-override lewat env; `.env` user tidak meng-override, sehingga default berlaku):

| Env | Dulu | Sekarang | Fungsi |
| :--- | :--- | :--- | :--- |
| `TRANSCRIBE_TIMEOUT_MS` | 1.800.000 (30 mnt) | 7.200.000 | satu transkripsi (`transcribeService.js`, diekspor `DEFAULT_TIMEOUT_MS`/`TIMEOUT_MS`) |
| `OLLAMA_TIMEOUT_MS` | 300.000 (5 mnt) | 7.200.000 | satu panggilan Gemma (`localAiService.js`, diekspor `DEFAULT_AI_TIMEOUT_MS`/`OLLAMA_TIMEOUT_MS`) |
| `SUMMARY_JOB_TIMEOUT_MS` | - (baru) | 7.200.000 | deadline bersama untuk **seluruh** satu job ringkasan: semua chunk + retry (`mediaSummaryService.js`); tiap panggilan Gemma dibatasi sisa anggaran waktu ini |
| `REQUEST_TIMEOUT_MS` | - (baru; sebelumnya default Node 5 mnt) | 7.200.000 | `httpServer.requestTimeout` di `server.js`; default Node 5 menit sebelumnya memotong upload video besar di koneksi lambat |

  Pesan timeout menyebut "120 minutes". `.env.example` diperbarui (komentar dan default `TRANSCRIBE_TIMEOUT_MS=7200000`). `headersTimeout`/`keepAliveTimeout` tidak diubah.
- **Explore Metrics**: tombol "Target" (khusus Admin, baris OUTCOME) dihapus; baris OUTCOME hanya punya "View Data". Pengaturan target/threshold tetap lewat menu **Admin Parameters** di Header.
- **Header**: baris pertama = brand di kiri; di kanan atas "username · Role" + nama (Admin) atau direktorat (User) + tombol **Sign out** (sebelumnya tombol "Keluar" ada di baris filter/aksi). Layar < 640px: avatar + tombol ikon. Fungsi logout tidak berubah. Pada lebar <= 500px select Directorate dan Sub-Dir tidak lagi tumpang tindih (`min-w-0 max-w-full`); desktop tidak berubah.
- **BUG FIX - form publik check-in & feedback crash tanpa login (sejak v2.27.0, commit `55e2187`)**: membuka `/?checkin=CODE` atau `/?survey=CODE` tanpa login memunculkan `TypeError: Cannot read properties of null (reading 'scopes')` di `Header.jsx`. **Dampak: karyawan tidak bisa check-in atau mengisi feedback event lewat QR/link selama v2.27.0 s.d. v2.29.0.** Akar masalah: `App.jsx` mengisi kode publik lewat `useEffect`, sehingga render pertama masih merender `Header` (butuh user login) dengan `user === null`. Kini mode publik dihitung sinkron dari URL (`src/utils/publicRoute.js`: `getPublicCodes()`/`isPublicRoute()`, dipakai sebagai initializer `useState`), jadi render pertama sudah form publik dan komponen ber-auth tidak dirender. Pertahanan kedua: `Header.jsx` memakai `user?.scopes` dan `App.jsx` memakai `user?.user_id`. Hanya dua rute publik yang ada (`?checkin=`, `?survey=`).
- **Teks sisa Inggris**: pesan validasi Username/NIP (`authService.js`), "Password is too long." (`emailSettingsService.js`), deskripsi data ESS di modal detail (`calculationEngine.js`); label slide PPT `[ Documentation #N ]`; caption default media baru `Documentation <event>` (`server.js`); slide 5 PPT memangkas awalan `Documentation `/`Dokumentasi ` pada caption media lama, sama seperti `captionText()` di UI.
- **Tes**: Modul 40 (**10 tes**, jalan di SQL dan JSON): label opsi database tidak lagi default Indonesia dan `value` utuh, top-up hanya mengganti label yang persis default lama (edit admin dan katalog lain tidak disentuh), input sampah tidak melempar, `month_name` Inggris, pesan error umum bebas teks Indonesia, default 120 menit, serta 4 tes mode publik (sinkron dari URL, URL normal bukan publik, `Header` aman saat `user` null, teks Indonesia tersisa hilang). Tes lama yang meng-assert string Indonesia disesuaikan. Hasil: **SQL 217/217** (developer, tanpa skip). **JSON 195/195 pada QC sebelum 4 tes Modul 40 terakhir ditambahkan** (Modul 37/38 di-skip di JSON); JSON **belum dijalankan ulang** untuk total terbaru. QC pertama LULUS DENGAN CATATAN, QC lanjutan LULUS.
- **Diketahui / tidak diubah**: `?survey=` dengan kode event yang masih berstatus pre-event menampilkan form feedback tanpa pertanyaan (severity rendah). Harness tes: jangan men-set `TEST_ADMIN_USER`/`TEST_ADMIN_PASSWORD` saat menjalankan suite di SQL (suite membuat admin sementara sendiri). Activity Log dan log proses/durasi belum dibuat.

---

## [2.29.0] - 2026-10-16

### Sumber Survei SYSTEM / ESS, Upload Manual untuk Semua Survei & Perapian UI (Added / Changed / Fixed)
- **Latar belakang**: metrik SURVEY perlu dibedakan antara data dari sistem/form lain (**SYSTEM**) dan data Employee Sentiment Survey yang diunggah dari template ESS (**ESS**), dan setiap metrik survei harus bisa diunggah manual (mis. saat sistem sumber bermasalah). Sebelumnya status ESS hanya ditebak dari kata "ESS" di teks bebas `source_of_data` (`calculationEngine.js`), tidak bisa diatur admin; dan PIC hanya boleh mengunggah metrik yang ber-flag `requires_manual_upload`.
- **Database - kolom baru `px_metrics.survey_source`** (`VARCHAR(10) NULL`, `CHECK` `CK_px_metrics_survey_source`: `SYSTEM` | `ESS`; hanya bermakna untuk metrik SURVEY, OUTCOME = `NULL`). ALTER idempoten di `schema.sql` (guard `COL_LENGTH`). Top-up saat boot `topUpSurveySource()` (`sqlStorage.js`) HANYA mengisi yang masih `NULL`: SURVEY yang `source_of_data`-nya memuat "ESS" -> `ESS`, SURVEY lain -> `SYSTEM`, OUTCOME tetap `NULL`; nilai hasil edit admin tidak pernah ditimpa. Backend JSON punya backfill setara saat `store.json` dimuat; `seedData.js` mengisinya eksplisit. Logika bersama (validasi, inferensi, deteksi ESS, kunci upload manual) ada di `server/db/surveySource.js` (dipakai `sqlStorage.js`, `jsonStorage.js`, `calculationEngine.js`); `src/utils/surveySource.js` berisi opsi dan label UI. Pada data saat ini: **11 metrik ESS** (9, 13, 15, 16, 17, 18, 21, 22, 24, 25, 27) dan **9 metrik SYSTEM** (2, 5, 6, 7, 8, 10, 12, 23, 26).
- **ESS tidak lagi dikenali dari teks**: `getMetricDetail()` (`is_ess`, `ess_summary`) memakai `survey_source === 'ESS'`; teks `source_of_data` hanya fallback bila kolom masih kosong. Skor 27 metrik tidak berubah: perbandingan snapshot sebelum/sesudah (angka dari laporan QC) menghasilkan 304 selisih, seluruhnya hanya field `survey_source` yang baru.
- **API**: `survey_source` tampil di `GET /api/metrics/calculate`, `GET /api/metrics/:id/detail` (level atas dan `metric.survey_source`) dan `GET /api/admin/parameters`. `POST` / `PUT /api/admin/metrics` menerimanya: nilai selain `SYSTEM`/`ESS` (huruf besar/kecil dan spasi tepi dimaafkan) atau bukan teks -> **400** `Survey Source must be one of: SYSTEM, ESS.`; SURVEY tanpa nilai = `SYSTEM` (`PUT` tanpa nilai mempertahankan yang lama); OUTCOME selalu dipaksa `NULL` (nilai salah tetap ditolak 400, tidak diabaikan diam-diam).
- **Upload manual untuk SEMUA metrik SURVEY**: `authService.isPicMetric` kini `metric_type === 'SURVEY'` (sebelumnya juga mensyaratkan `requires_manual_upload`). Akun USER yang e-mailnya sama dengan `pic_email` sebuah metrik SURVEY (SYSTEM atau ESS, ber-flag atau tidak) boleh Template / Evidence / Upload / daftar responden untuk metrik itu; Admin sejak awal boleh semuanya; non-PIC dan PIC metrik lain tetap 403; metrik OUTCOME / id tidak dikenal tetap ditolak; `metric_id` dari form tetap menang atas kolom `metric_id` di CSV. **Ini mengoreksi definisi PIC di [2.27.1].** `requires_manual_upload` kini hanya menentukan **pengingat e-mail** (tetap 20 metrik di data saat ini; semua ESS selalu ikut) - tidak berubah.
- **ESS selalu upload manual**: `requires_manual_upload` pada metrik ESS dikunci `true`. `POST`/`PUT` yang meminta `false` untuk metrik ESS -> **400** `ESS data is always uploaded manually: ...`; berpindah ke ESS menyalakan flag (dan keluar dari ESS melepas kuncinya, nilai tetap seperti terakhir); `enforceEssManualUpload()` menyalakan kembali flag ESS yang mati saat boot (idempoten, dicatat di log; pada database ini 0 metrik).
- **UI Parameter Admin** (`AdminParametersModal.jsx`, teks Inggris): dropdown **Survey Source** (System / ESS Template; disembunyikan untuk OUTCOME) di form tambah/ubah plus kolom **Survey Source** di tabel; checkbox upload manual terkunci dan dicentang untuk ESS ("ESS data is always uploaded manually, so this is locked on."), untuk SYSTEM keterangannya menjelaskan bahwa flag hanya menyalakan e-mail pengingat; Nama/Email PIC kini tampil untuk semua metrik SURVEY (bukan hanya yang ber-flag); Batas Tanggal Upload tampil bila flag aktif atau ESS. Saat simpan, `survey_source` dikosongkan untuk OUTCOME dan ESS mengirim `requires_manual_upload: true`.
- **UI Explore Metrics** (`Calculator.jsx`): badge **ESS Template** (indigo) / **System** (slate) di baris "Source"; Type tetap hanya SURVEY / OUTCOME; kotak pencarian juga mencocokkan label sumber. Judul "Explore N People Experience Metrics" dan chip filter "Survey (n)" / "Outcome (n)" kini dihitung dari data (`metrics`), bukan angka tetap 27 / 20 / 7.
- **UI detail metrik** (`MetricDetailModal.jsx`): chip **Survey Source: ...**; label Type untuk SURVEY kini selalu "Type: Employee Survey" (varian "ESS (Employee Sentiment Survey)" dihapus); status ESS diambil dari `is_ess` server, bukan dari teks `source_of_data`.
- **UI galeri media event** (`EventManager.jsx`): blok **AI Summary** video kini bisa dilipat (`<details open>`, chevron; default terbuka) seperti "Transkrip AI lengkap"; blok "AI Description" disembunyikan untuk VIDEO (tetap untuk foto); awalan "Documentation " pada nama file media dihapus - unggahan baru menyimpan nama file apa adanya (`caption`), media lama dipangkas saat tampil (`captionText()`; data di database tidak diubah).
- **UI Survey Templates** (`AdminSurveyQuestionsModal.jsx`): dropdown metrik terpotong dan tombol Template / Upload keluar dari bar diperbaiki (commit `900a2be`); kontainer tombol kini `flex-wrap` agar turun baris di layar sempit.
- **Tes**: Modul 39 baru (**10 tes**); Modul 36 disesuaikan (assertion tentang PIC metrik tanpa flag pengingat: kini boleh upload, tampil di `pic_metrics` dan `can_upload: true`). Hasil QC (LULUS DENGAN CATATAN, 0 bug fungsional): **SQL Server 207/207**, **JSON 189/189** (Modul 37 dan 38 di-skip; bagian top-up boot SQL di Modul 39 di-skip). Penjumlahan sederhana 195 + 10 = 205 tidak sama dengan 207 (JSON 177 + 10 = 187 vs 189) - selisih 2 dari cara runner menghitung tidak dijelaskan; angka dicatat sesuai laporan QC. Backfill JSON tidak punya tes otomatis.
- **Tidak diubah / temuan lama yang BELUM diperbaiki** (dilaporkan QC, bukan akibat perubahan ini): (1) importer untuk Admin dengan `metric_id` form non-numerik jatuh ke metrik SURVEY pertama (risiko rendah-sedang); (2) "Latest Survey Date" di modal detail memakai tanggal hari ini bila tidak ada tanggal survei; (3) `PUT /api/admin/metrics/<id tak ada>` menjawab 400, bukan 404; (4) NIP kembar belum ditolak importer (konflik dengan aturan NIP unik; lihat [2.27.1]).
- **Branch `wip/v2.29.0-ui-english`**: berisi pekerjaan yang belum selesai - UI berbahasa Inggris, nama tema, filter bulan, awal log proses / Activity Log / batas 120 menit. Hanya referensi; akan dikerjakan ulang atau dibawa nanti. Tidak termasuk rilis ini.

---

## [2.28.1] - 2026-10-16

### Perapian Tampilan Explore Metrics & Detail Metrik (Changed)
- **Explore Metrics — teks journey kontras**: teks journey di atas nama metrik kini gelap dan tebal (`#231F20`), bukan abu-abu yang tidak terbaca pada tema Merah; penjelasan checkpoint ("• CP: ...") di sampingnya dihapus; titik warna journey diberi tepi putih. Rasio kontras terhadap latar baris untuk 5 tema: 4,6 (Ungu, terendah) sampai 9,4 (Teal).
- **Type hanya SURVEY dan OUTCOME**: badge "ESS SURVEY" dihapus; metrik ESS kini berlabel SURVEY, jenis sumber datanya tetap terlihat di baris "Source".
- **Kolom "Sample / Source" -> "Total Respondents"**: untuk metrik SURVEY menampilkan jumlah responden (nilai yang sama dengan "Total Respondents" di detail metrik); metrik OUTCOME tetap menampilkan badge "HR System".
- **Detail metrik — tombol Survey Data Operations**: Template / Evidence / Upload dikecilkan (tidak lagi keluar dari kartu, otomatis turun baris bila sempit) dan diberi warna slate yang sama dengan tombol "Actions & Evidence" di daftar metrik; subteks "Standard CSV / Audit Trail / Import CSV" dipindah ke tooltip.
- **Hanya frontend** (`Calculator.jsx`, `MetricDetailModal.jsx`); tidak ada perubahan API, database, atau tes. Pekerjaan UI bahasa Inggris & v2.29.0 (log proses/Activity Log) yang belum selesai disimpan di branch `wip/v2.29.0-ui-english`.

---

## [2.28.0] - 2026-10-15

### 🤖 AI Summary Video Signature Program Event — Gemma 3 4B Lokal (Added / Changed)
- **Permintaan**: video yang diunggah di Signature Program Events diberi **AI Summary** dari transkripnya, memakai model **Gemma 3 4B** lokal lewat Ollama (100% on-premise). Aturan produk dari user: Gemma hanya dipakai untuk ini; analisis metrik WARNING/CRITICAL adalah langkah berikutnya (belum dikerjakan).
- **Kapan Gemma dipanggil (hanya dua)**: (1) video **baru** begitu transkripnya `DONE` (`transcribeService.js` memanggil `queueMediaSummary`); (2) tombol manual **Buat / Buat ulang ringkasan** oleh pengelola event (`POST /api/media/:id/summarize`). **Nol panggilan** pada: GET event, dashboard, alerts, `/api/health`, upload foto, generate PPT, dan boot (satu-satunya pengecualian: ringkasan yang sedang `PROCESSING` saat server berhenti dilanjutkan; video lama tanpa ringkasan tidak diproses otomatis). Dijaga di satu titik: `localAiService.assertAiAllowed()` menolak panggilan tanpa scope `EVENT_VIDEO_SUMMARY` dan subjek video bertranskrip.
- **Perubahan perilaku (disengaja)**: narasi Score Deficit Alert (`generateAlertNarrative`) dan Event Summary (`generateEventSummary`) di `localAiService.js` kini **murni berbasis aturan** (sebelumnya mencoba Ollama dulu sejak v2.10.0). `/api/health` tidak lagi menghubungi Ollama kecuali login + `?check_ai=1` (hanya mendaftar model, tidak menjalankan model); tanpa itu `ollama_status` = `not checked (add ?check_ai=1)`.
- **Alur** (`server/services/mediaSummaryService.js`, antrian `aiQueue.js`): transkrip < **20 kata** tidak dikirim ke model (`summary_status = INSUFFICIENT`); transkrip panjang dipecah per **5000 karakter**, tiap bagian diringkas lalu digabung (> **12 bagian** → langsung ringkasan aturan). Jawaban model wajib berformat teks `RINGKASAN:` + `POIN:` (2-5 poin). Bahasa ringkasan mengikuti `transcript_language` (tak dikenal → Indonesia). Job berjalan satu per satu di `aiQueue` (kunci `media:<id>`, tanpa duplikat; batas antrian `AI_QUEUE_MAX`, default 50; bila penuh → ringkasan aturan + pesan). Ollama mati/model belum ada/timeout tidak pernah menggagalkan upload maupun transkrip.
- **Validator** (`validateAnswer`) — keluaran 4B tidak dipercaya begitu saja: angka **dan kata bilangan** (mis. "enam", "dua kali", "seminggu", "six", "twice") harus ada di transkrip (kata atau digit yang setara); nama/akronim berkapital harus ada di transkrip; bahasa harus benar (id/en); frasa meta ("transkrip ini...", "video ini...") ditolak; kata isi (>= 5 huruf) yang tidak terlacak ke transkrip (dengan stem sederhana) ditolak bila >= 3 kata **dan** > 20% kata isi. Ditolak → **retry sekali** dengan alasan disebut di prompt (suhu 0.1 lalu 0.2, seed tetap) → bila tetap ditolak: **fallback ekstraktif** (kalimat diambil dari transkrip, tidak ada yang dikarang) dengan `summary_source = RULE`, label UI **"Otomatis (aturan)"**; hasil lolos validator: `summary_source = AI` + `summary_model`.
- **Database** (`schema.sql`, `sqlStorage.js`, `jsonStorage.js`): 8 kolom baru `px_media`: `summary` (NVARCHAR(MAX)), `summary_points` (JSON), `summary_status` (`PROCESSING|DONE|FAILED|INSUFFICIENT`, NULL = belum ada), `summary_source` (`AI|RULE`), `summary_model`, `summary_language`, `summary_generated_at`, `summary_error`. Ditambahkan per kolom dengan `IF COL_LENGTH(...) IS NULL ALTER TABLE` (aman diulang). Mengulang transkrip (`POST /api/media/:id/transcribe`) mengosongkan ringkasan lama; ringkasan dibuat lagi setelah transkrip baru `DONE`. Backend JSON: delapan field masuk whitelist `updateMedia`.
- **API**: endpoint baru `POST /api/media/:id/summarize` (pengelola event): **202** + record media (`PROCESSING`), **404** media tak ada, **400** bukan video, **409** transkrip belum `DONE` atau ringkasan sedang diproses/antri; non-pengelola **403**, tanpa login **401**. Env baru (opsional): `OLLAMA_TIMEOUT_MS` (default 300000), `AI_QUEUE_MAX`; `OLLAMA_MODEL` default `gemma3:4b`, `OLLAMA_HOST` default `http://localhost:11434`.
- **UI** (`EventManager.jsx`, `MediaCard`): blok **AI Summary** di kartu video bertranskrip — spinner saat `PROCESSING` (polling event 4 dtk yang sudah ada kini juga untuk ringkasan), ringkasan + poin, badge `AI • gemma3:4b` atau `Otomatis (aturan)`, waktu & bahasa, teks "Dibuat otomatis oleh AI — periksa kembali dengan transkrip.", pesan untuk `FAILED`/`INSUFFICIENT`. Tombol **Buat / Buat ulang ringkasan** hanya untuk pengelola dan hanya saat belum ada ringkasan, `FAILED`, atau hasilnya `RULE` (ringkasan `AI` yang sudah jadi tidak punya tombol).
- **PPT** (`pptGenerator.js`): slide dokumentasi media (3 slot) memprioritaskan video yang punya ringkasan `DONE`; teksnya "Ringkasan AI: ..." / "Ringkasan otomatis: ..." (dipotong di batas kata, 300 karakter), dibaca dari database — PPT tidak memanggil Ollama.
- **Lain-lain**: `PX_DISABLE_SCHEDULERS=1` melewati `startReminderScheduler()` (hanya untuk backend kedua yang dijalankan suite); komentar `.env.example` diperbarui.
- **Verifikasi (laporan QC: LULUS DENGAN CATATAN)**: suite SQL Server **195/195**; JSON **177** (Modul 37 dan 38 di-skip di JSON; dari Modul 38 hanya 2 tes validator offline yang berjalan). **Modul 38 = 15 tes** (setelah perbaikan hasil QC) memakai backend kedua dengan Ollama dan API transkrip **palsu** (nol panggilan ke Gemma asli di suite). Tes lockout Modul 34 diperbaiki agar tidak mengasumsikan password sementara >= 10 karakter. Gemma asli dicoba **satu kali** pada video user (±53 detik).
- **Keterbatasan (jujur)**: validator memeriksa fakta (angka, bilangan, nama, bahasa, kata baru) — **distorsi semantik halus** (mis. "hampa" menjadi "mengganggu") dan **negasi** bisa lolos; ambang kata baru sengaja tidak diperketat karena akan menolak ringkasan yang sah. Kata bilangan ambigu ("satu", "sekali") ditolak bila tidak ada di transkrip, sehingga ringkasan yang sah kadang jatuh ke fallback aturan. Teks di slide PPT tidak diperiksa secara visual; slide media hanya memuat 3 media. API transkrip (Video Extractor, :8000) tidak diuji end-to-end oleh QC (memakai API palsu). Penulis dokumen ini tidak menjalankan ulang suite; angka tes disalin dari laporan QC.
- **Catatan database pengguna**: DB user sudah punya 7 kolom `summary_*` sisa percobaan v2.26.0 (menurut laporan; tidak diperiksa langsung oleh penulis dokumen) — itulah alasan guard per kolom.

---

## [2.27.2] - 2026-10-15

### 🔑 Password Awal Standar via Env (Added / Changed)
- **Permintaan**: password sementara acak sulit dibagikan; user meminta password awal standar. Ini trade-off yang diminta user: v2.26.0 sengaja tanpa password default.
- **Cara kerja** (`authService.js`: `getDefaultInitialPassword()`, `makeInitialPassword()`): env opsional **`DEFAULT_INITIAL_PASSWORD`** di `.env` (gitignored; nilainya tidak ada di kode, repo, database, maupun dokumentasi). Bila terisi, dipakai alih-alih password acak untuk: akun baru (`POST /api/admin/users`), `POST /api/admin/users/:id/reset-password`, dan `npm run auth:create-admin` (admin pertama dan `--reset-password`). Env kosong/spasi/tidak ada = perilaku lama (acak). Env dibaca saat dipakai (tanpa cache); `.env` hanya dimuat saat proses start, jadi perubahannya butuh restart server.
- **Tetap berlaku**: `must_change_password = true` (akun wajib mengganti saat login pertama, endpoint lain `403 PASSWORD_CHANGE_REQUIRED`); kunci akun (5 gagal / 15 menit) dan rate limit tidak berubah; reset tetap membuka kunci dan mematikan sesi.
- **Kebijakan password**: password awal (buatan sistem) dikecualikan dari kebijakan, tetapi password pengganti tetap wajib lolos (min 10 karakter + huruf + angka) dan **tidak boleh sama dengan password awal standar** (`400`, "tidak boleh sama dengan password awal standar").
- **API/UI**: respons `POST /api/admin/users` dan `reset-password` tetap memuat `temporary_password` dan kini juga `is_default_password` (boolean). `UserManagementModal.jsx` menampilkan catatan "Password awal standar — wajib diganti saat login pertama" bila `true`. `create-admin.js` tidak mencetak nilainya, hanya menyebut berasal dari `DEFAULT_INITIAL_PASSWORD`. Password awal tidak masuk audit log maupun log server.
- **Risiko**: selama pemilik akun belum login pertama, siapa pun yang tahu password awal standar dapat masuk ke akun itu. Sampaikan hanya ke pemiliknya dan minta ganti segera. Pertimbangkan mengosongkan env setelah onboarding massal selesai.
- **Database**: tidak ada perubahan skema.
- **Verifikasi**: Modul 37 (5 test; total **182**), hanya berjalan di **SQL Server** (di JSON di-skip). Hasil suite penuh tidak diverifikasi oleh penulis dokumen ini; lihat laporan developer/QC.

---

## [2.27.1] - 2026-10-15

### 🧑‍💼 Login Tahap 2b: PIC Metrik Terhubung ke Akun (Added / Changed)
- **Permintaan**: tahap 2b rencana login — PIC metrik survei bisa mengunggah data survei sendiri, melihat data respondennya, dan tidak melihat hal lain. Sebelumnya (v2.26.0/2.27.0) template, upload, riwayat, evidence, dan daftar responden `403` untuk semua non-Admin.
- **Penetapan PIC tidak berubah**: tetap lewat **Parameter Admin** (`pic_name` / `pic_email` metrik SURVEY dengan `requires_manual_upload`). Akun `USER` aktif = PIC metrik M bila **email akun == `pic_email` M** (tanpa beda huruf besar/kecil, di-`trim`). Satu akun boleh PIC banyak metrik. Hak dibaca dari database **tiap request** (`authService.picMetrics()`, tanpa cache), jadi mengubah `pic_email`, email akun, atau menonaktifkan akun berlaku mulai request berikutnya tanpa login ulang. Admin bukan "PIC" (sudah boleh semuanya).
- **Aturan akses** (`authService.js`: `picMetrics`, `picMetricIds`, `getPicMetric`, `isPicOfMetric`, `canSeeRespondentData` — kini async —, `requirePicMetric`, `respondentScopeFor`, `rowsForViewer`):
  - PIC hanya dapat memakai template, upload, riwayat, evidence, dan daftar responden untuk **metrik miliknya**; metrik lain, `ALL`, kosong, atau id tidak valid → 403/400 (lihat `docs/04`). `metric_id` di dalam isi CSV **diabaikan** saat metrik tujuan diberikan form, sehingga PIC tidak bisa menulis ke metrik orang lain.
  - Identitas responden (nama/NIP/email) untuk metrik karyawan hanya baris **dalam cakupan direktorat/divisi akun PIC** (detail metrik, `responses`, evidence CSV). Metrik non-karyawan (kampus, kandidat) bankwide, sama seperti pembacaan User lainnya.
  - Respons upload untuk non-Admin **tanpa** `calculation`, `updated_pe_index`, `updated_survey_index`, dan `normalized_score` di `affected_metrics` = `null` (kalkulasi PE Index bankwide hanya untuk Admin).
  - `POST /api/surveys/upload`: `uploaded_by` kini `Nama (username)` akun yang login (dulu tetap "HR Admin"); aksi audit baru **`SURVEY_UPLOAD`** (metrik, jumlah baris valid/ditolak, id batch — tanpa data responden); file CSV sementara di `server/uploads/` **dihapus** setelah impor (memuat identitas responden).
- **Penguatan yang ikut dikerjakan**: handler error JSON terakhir di `server.js` (upload terlalu besar → `413` JSON, body JSON rusak → `400` JSON, bukan halaman HTML/stack trace); `GET /api/surveys/evidence` dan `/responses/:metric_id` untuk Admin dengan id salah → `400`/`404`; `surveyEvidenceService.escapeCsv` menambah apostrof di depan teks berawalan `= + - @` (guard CSV injection; angka biasa tidak diubah).
- **API tambahan**: `can_upload` per metrik di `GET /api/metrics/calculate` dan pada `GET /api/metrics/:id/detail` (dihitung server); `active_account_emails` di `GET /api/admin/parameters` (Admin); `pic_metrics` (read-only) per akun di `GET /api/admin/users`.
- **Frontend**: tombol Template / Evidence / Upload per metrik di `Calculator.jsx` dan `MetricDetailModal.jsx` tampil bila Admin atau `can_upload`; `SurveyImportModal.jsx` untuk PIC tanpa opsi `ALL` (dimulai di metrik terpilih/metrik pertama miliknya); `AdminParametersModal.jsx` menampilkan peringatan **"PIC belum punya akun login"** bila Email PIC tidak cocok dengan akun aktif mana pun; `UserManagementModal.jsx` menampilkan **PIC metrik** per akun dan menyarankan email diisi.
- **Reminder**: tidak berubah — email tetap dikirim ke `pic_email`.
- **Database**: tidak ada tabel/kolom baru.
- **Verifikasi**: Modul 36 (11 test; total **177**) → **177/177 PASS di SQL Server**. Di JSON 174/174 dijalankan **sebelum perbaikan kecil terakhir**; **JSON belum dijalankan ulang**. QC: **LULUS DENGAN CATATAN**.
- **Keterbatasan yang diketahui — belum diputuskan, tidak diubah**: (1) importer **tidak menolak NIP kembar** dalam satu CSV maupun antar-batch (baris tersimpan sebagai responden terpisah dan memengaruhi skor); celah lama yang berlaku juga untuk Admin dan **bertentangan dengan aturan NIP unik** — menunggu keputusan user; (2) tanggal survei tidak valid diterima dan disimpan sebagai hari ini; (3) PIC bisa mengunggah baris di luar cakupannya (tersimpan dan dilihat Admin, tetapi tidak terlihat oleh PIC); (4) hanya upload yang masuk audit — unduh template/evidence tidak dicatat; (5) email User bersifat opsional (hanya disarankan UI), akun tanpa email tidak bisa jadi PIC; (6) peringatan "PIC belum punya akun" dicek terhadap email akun aktif **apa pun**, termasuk Admin; (7) baris `px_survey_uploads` sisa batch uji (`metric_id` null) tidak ikut terhapus saat metrik dihapus; (8) pengiriman email reminder asli tidak diuji; (9) noise `401` pada `GET /api/settings` di form publik masih ada. Tampilan UI diperiksa QC di Browser pane, bukan oleh test otomatis.
- **Catatan nomor versi**: **2.28.0 tetap dicadangkan untuk fitur AI** di `git stash`.

---

## [2.27.0] - 2026-10-15

### 🎯 Login Tahap 2a: Cakupan Akses User Fleksibel (Added / Changed)
- **Permintaan pengguna**: di v2.26.0 satu User hanya terikat satu direktorat + satu divisi, dan divisi hanya tercatat. Diminta cakupan yang fleksibel: Admin menentukan, per User, direktorat mana saja yang boleh dilihat, dan untuk tiap direktorat apakah **semua divisi** atau **sebagian divisi**.
- **Model cakupan** (`server/db/scopeUtils.js`, baru, dipakai bersama oleh SQL, JSON, `authService` dan engine perhitungan): daftar `[{ directorate, divisions }]`, `divisions: null` (atau `[]` saat input) = semua divisi. Dinormalisasi: satu entri per direktorat, divisi digabung dan tanpa duplikat, "semua" menyerap subset. Bentuk lama `directorate` + `division` pada API masih diterima (menjadi satu cakupan satu divisi; keduanya wajib).
- **Penegakan di server** (`authService.resolveScope` / `isInScope` / `scopeFilter`): `calculate`, `trends`, `:id/detail`, `alerts`, dan event dibatasi. Direktorat kosong/`ALL` = **semua cakupan saya** (gabungan); direktorat/divisi di luar cakupan → 403. **Divisi kini ikut membatasi data** (di v2.26.0 belum). Perubahan cakupan berlaku di **request berikutnya tanpa mematikan sesi**.
- **"Semua cakupan saya" = pooling**: respons semua entri cakupan digabung lalu dihitung lewat pipeline scorecard yang sama (bukan rata-rata dari rata-rata): sampel metrik = jumlah sampel (mis. A + B) dan rata-ratanya terbobot sampel. Memilih satu direktorat dari cakupan memberi angka yang sama dengan tampilan Admin untuk direktorat itu.
- **`/api/alerts`** kini menerima `?directorate&sub_directorate` dan dihitung dari data dalam cakupan (skor dan komentar verbatim hanya dari responden dalam cakupan, termasuk umpan balik event dari peserta dalam cakupan; tidak lagi bankwide untuk User). Tiap alert membawa `is_bankwide_readonly` (metrik non-karyawan/OUTCOME tetap bankwide read-only). `filter_options.scopes` ditambahkan pada `/api/metrics/calculate`.
- **Event**: non-pengelola hanya melihat absensi/feedback peserta dalam cakupan (`total_attendees` di daftar mengikuti). **Pengelola event** = Admin, atau User yang cakupannya memuat salah satu direktorat di setting `event_manager_directorates` (divisi apa pun).
- **API**: `GET|POST /api/admin/users`, `PUT /api/admin/users/:id` dan `GET /api/auth/me` memuat/menerima `scopes`. Validasi: User wajib minimal satu cakupan; Admin tidak boleh membawa cakupan (mengubah ke Admin mengosongkan cakupan; menurunkan ke User wajib mengirim cakupan); direktorat dan divisi harus ada di direktori database dan divisi harus milik direktorat itu; permintaan ditolak tidak menyimpan apa pun. `directorate`/`division` pada objek user kini turunan dari cakupan (hanya terisi bila tunggal).
- **Audit**: aksi baru `USER_SCOPE_CHANGE` (nilai lama → baru) saat cakupan berubah.
- **Database**: tabel baru `px_user_scopes` (`user_id` FK `ON DELETE CASCADE`, `directorate`, `division` NULL = semua divisi, `UNIQUE(user_id, directorate, division)`; total tabel 28 → 29). Kolom `px_users.directorate`/`division` (v2.26.0) **tidak dipakai/ditulis lagi**. Migrasi otomatis saat boot (`sqlStorage.migrateLegacyUserScopes()`, idempoten, hanya untuk User tanpa baris cakupan; divisi kosong = semua divisi; Admin tanpa cakupan). Backend JSON memigrasikan akun di `auth.json` saat dimuat (`legacyUserScopes`).
- **Frontend**: `UserManagementModal.jsx` — editor cakupan per User (tambah direktorat, pilih "Semua divisi" atau "Divisi tertentu" dengan centang, hapus), ringkasan cakupan di tabel; `Header.jsx` — filter direktorat/divisi User hanya menawarkan cakupannya, opsi "Semua cakupan saya", label akun "User - N direktorat".
- **Verifikasi**: Modul 35 (9 test; total **166**) → **166/166 PASS di SQL Server dan di JSON**. QC: **LULUS DENGAN CATATAN**.
- **Batasan yang diketahui (tidak diubah)**: (1) kolom `target` audit dipotong ±190-200 karakter, sehingga nilai cakupan pada `USER_SCOPE_CHANGE` bisa terpotong untuk daftar panjang; (2) User dengan "semua divisi" yang meminta `sub_directorate` yang tidak dikenal mendapat **200 dengan data kosong** (bukan 403) — tanpa kebocoran data; (3) angka SQL vs JSON **tidak dibandingkan** (data `store.json` lama berbeda dari SQL), yang dibandingkan hanya perilaku; (4) tampilan mobile tidak diuji; (5) noise `401` pada `GET /api/settings` di form publik dari v2.26.0 masih ada.
- **Berikutnya (tahap 2b, belum dikerjakan)**: PIC dipetakan ke akun, upload survei oleh PIC, dan data responden dapat dilihat PIC. Nomor **2.28.0 dicadangkan untuk fitur AI** yang disimpan di `git stash`.

---

## [2.26.0] - 2026-10-15

### 🔐 Login Lokal + 2 Role (ADMIN / USER) dan Pembatasan Akses Data (Added)
- **Permintaan pengguna**: aplikasi sebelumnya terbuka tanpa login. Diminta login dengan akun **lokal** (bukan AD/LDAP), dua role (`ADMIN`, `USER`), satu User = satu direktorat + satu divisi, dan User hanya melihat data sesuai direktoratnya.
- **Keputusan desain**: (1) akun lokal di database; (2) divisi User **tersimpan tetapi belum menyaring data** (tahap 2); (3) User melihat data direktoratnya sendiri — **ditegakkan server**, direktorat lain → 403; (4) metrik non-karyawan / OUTCOME (mis. #1-#5): User melihat **agregat bankwide read-only** (`bankwideReadOnly`, `excluded_from_index`) yang **tidak masuk** `px_index`/`survey_index` direktoratnya; (5) data per responden (NIP, nama, email) **disembunyikan dari User** — di tahap 1 hanya Admin (`canSeeRespondentData`), di tahap 2 juga PIC metrik terkait; (6) Signature Event: User **read-only**; tulis/unggah/transkrip/PPT hanya Admin + User dari direktorat di setting `event_manager_directorates` (default `Human Resources`).
- **Autentikasi** (`server/services/authService.js`, baru): password di-hash **scrypt** (salt per user, `timingSafeEqual`); sesi = token acak 32 byte di cookie **`px_session`** (`httpOnly`, `SameSite=Strict`, `Secure` bila HTTPS/`TRUST_PROXY`), **hanya hash SHA-256 token** yang disimpan di `px_sessions`; masa sesi 8 jam. Login gagal: pesan **generik** (tidak membocorkan apakah username ada; waktu proses disamakan dengan hash tiruan), **kunci akun 15 menit setelah 5× gagal**, **rate limit 20 login gagal/menit/IP** (`rateLimiter.js`, di memori → hilang saat restart). Password baru: min 10 karakter, mengandung huruf + angka, tidak sama dengan username, maks 128. Password sementara (12 karakter acak) hanya tampil **sekali** ke Admin; akun baru/reset **wajib ganti password** sebelum bisa memakai fitur lain (403 `PASSWORD_CHANGE_REQUIRED`). Request tulis dengan header `Origin` lintas-host ditolak (403) sebagai lapisan tambahan di atas `SameSite=Strict`.
- **Gerbang akses**: semua `/api/*` butuh sesi kecuali 6 rute publik (`GET /api/health`, `POST /api/auth/login`, `GET /api/directorates`, `GET /api/events/by-code/:code`, `POST /api/events/:id/attendance`, `POST /api/events/:id/feedback`) — persis yang dipakai form check-in/feedback publik. Seluruh `/api/admin/*` hanya ADMIN. `/uploads` dan `/exports` kini wajib login (`/exports` hanya pengelola event). `/api/health` tanpa login hanya status+versi (tanpa detail server database). Lookup publik `events/by-code` tidak lagi mengembalikan kode akses partner.
- **Endpoint baru**: `POST /api/auth/login|logout|change-password`, `GET /api/auth/me`, `GET|POST /api/admin/users`, `PUT|DELETE /api/admin/users/:id`, `POST /api/admin/users/:id/reset-password`, `GET /api/admin/audit-log`. Perlindungan: tidak bisa menonaktifkan/menurunkan/menghapus diri sendiri atau Admin aktif terakhir; menonaktifkan, mengganti role, atau reset password mematikan semua sesi user itu. Detail di `docs/04` (Catatan v2.26.0).
- **Audit trail login** (`px_audit_log`): `LOGIN_SUCCESS`, `LOGIN_FAILED`, `LOGIN_LOCKED`, `LOGIN_BLOCKED_LOCKED`, `LOGOUT`, `PASSWORD_CHANGE[_FAILED]`, `PASSWORD_RESET`, `USER_CREATE|UPDATE|DELETE`. Tidak pernah memuat password; percobaan dengan username tak dikenal dicatat sebagai `(username tidak dikenal)` tanpa teks mentah.
- **Database**: 3 tabel baru `px_users`, `px_sessions`, `px_audit_log` (`schema.sql`, idempoten; total tabel 25 → 28) dan 4 setting angka baru + `event_manager_directorates` di `px_app_settings`. **Akun tidak ikut `migrate --reset`** (`dropAllTables()` tidak menyentuh 3 tabel ini) dan **tidak ikut `db:export`/`importStore`** (tidak ada di `store.json`). Backend JSON menyimpan akun di **`server/data/auth.json`** (git-ignored, terpisah dari `store.json`).
- **Admin pertama**: `npm run auth:create-admin` (`scripts/create-admin.js`) — password acak dicetak sekali di konsol, tidak ada password bawaan di kode (sejak v2.27.2 bisa diganti password awal standar lewat env `DEFAULT_INITIAL_PASSWORD`, opsional); saat boot tanpa akun, server mencetak peringatan.
- **Frontend**: `AuthScreens.jsx` (`LoginPage`, `ChangePasswordScreen`), `UserManagementModal.jsx` (menu **Kelola User**), `utils/AuthContext.jsx`, `utils/apiClient.js` (membungkus `fetch`: cookie selalu dikirim, 401 → kembali ke halaman login). Menu Admin (Parameter Admin, Survey Templates, Setting Email, Kelola User, upload/edit survei, acknowledge alert) hanya tampil untuk Admin; filter direktorat User terkunci ke direktoratnya; kontrol tulis Signature Event hanya untuk pengelola event. Form publik (`?checkin=` / `?survey=`) tetap tanpa login. `vite.config.mjs`: `changeOrigin` **dihapus** dari proxy agar header `Host` asli (`localhost:3000`) sampai ke backend — kalau tidak, pemeriksaan Origin menolak semua request tulis dari browser.
- **Verifikasi**: Modul 34 (19 test; total **157**) → **157/157 PASS di SQL Server**. Sebelum perbaikan hasil QC, suite 153 test: SQL 153/153 dan JSON 153/153; **JSON belum dijalankan ulang pada 157 test setelah perbaikan QC**. QC: **LULUS DENGAN CATATAN** (lihat butir berikut). Tes proxy Vite (`TEST_VITE_URL`) dilewati otomatis bila Vite tidak berjalan.
- **Catatan / batasan yang diketahui (tidak diubah)**: (a) di console form publik muncul noise `401` pada `GET /api/settings` — pemanggilnya belum diketahui, dampaknya kosmetik; (b) rate limit login hanya di memori; (c) belum ada UI untuk mengubah `event_manager_directorates` (ubah lewat `PUT /api/admin/settings/event_manager_directorates`); (d) endpoint `DELETE /api/admin/users/:id` ada tetapi **belum ada tombol hapus** di UI (gunakan nonaktifkan); (e) `GET /api/alerts` tidak difilter per direktorat (bankwide) untuk User; (f) **tahap 2** (belum dikerjakan): PIC → akun, upload oleh PIC, data responden untuk PIC, penyaringan data per divisi.
- **Rekomendasi deployment**: jalankan di belakang reverse proxy **HTTPS** on-premise dan set `TRUST_PROXY` (mis. `1`) agar cookie bertanda `Secure` dan IP klien benar. Nomor versi 2.26.0 sebelumnya sempat dipakai pekerjaan AI yang kini disimpan di `git stash`; fitur AI akan dirilis sebagai versi berikutnya (mis. 2.27.0).

---

## [2.25.0] - 2026-10-13

### 🏷️ Fix: Satuan Nilai Aktual Metrik #14 Salah ("4330%") — Kini Satuan Berasal dari Database (Fixed / Added)
- **Laporan pengguna**: di Explore Metrics, metrik #14 "% employees receiving recognition / year" menampilkan "4330%" dengan target "min 5,000 / yr"; satuannya seharusnya bukan %.
- **Akar masalah**: `Calculator.jsx` (dan `MetricDetailModal.jsx`) memakai rumus yang ditulis langsung di kode: `RATING_5 → "x / 5"`, `metric_id === 11 → "x pax"`, **selain itu otomatis "x%"**. Metrik tidak punya konsep satuan di database. Nilai 4330 adalah jumlah penerima recognition (2.840 + 980 + 510 pada data operasional) terhadap target 5.000 per tahun — hitungan orang, bukan persentase.
- **Perbaikan**: kolom baru **`px_metrics.unit`** (NVARCHAR(30)), dibaca dari database dan dipakai di semua tampilan nilai aktual lewat util `src/utils/formatMetricValue.js` (menggantikan rumus hardcoded). Seed: `/ 5` untuk metrik skala 1–5, `pax` untuk #11, **`orang/tahun` untuk #14**, `%` untuk sisanya. Admin dapat mengubah satuan di Parameter Admin (field "Satuan Nilai Aktual" + pratinjau; wajib, 1–30 karakter; metrik baru terisi otomatis sesuai skala). Database lama ter-upgrade otomatis saat boot (`ALTER TABLE` idempoten + `topUpMetricUnits()` yang hanya mengisi baris `unit IS NULL` — edit admin tidak pernah ditimpa); backend JSON punya backfill setara. Field `unit` ditambahkan ke `/api/metrics/calculate`, `/api/metrics/:id/detail`, dan `/api/admin/parameters`.
- **Cakupan sengaja sempit**: hanya label satuan. Perhitungan skor, normalisasi, threshold, dan status tidak diubah — #14 tetap 86,6% / WARNING.
- **Bukti "tidak menyenggol yang lain"**: (1) kode lama (commit sebelumnya, di git worktree sementara) dan kode baru dijalankan berdampingan atas database yang sama, lalu **58 endpoint GET dibandingkan → 58/58 identik** (satu-satunya selisih: field baru `unit`); (2) teks nilai aktual yang tampil untuk 27 metrik dihitung dengan rumus lama vs fungsi baru → **26 identik, hanya #14 berubah** ("4330%" → "4.330 orang/tahun"). Ketidakkonsistenan yang ditemukan tetapi **tidak diubah**: nama #14 masih memuat "%" padahal datanya hitungan; #1 (NUMERIC) tetap `%`; #11 menampilkan "2.5 pax" melawan target 500; sebagian data operasional tidak cocok dengan nama metriknya (sudah ada sebelumnya).
- **Verifikasi**: Modul 33 (8 test; total **138**) → **138/138 PASS di SQL Server (2×) dan di JSON**; UI diperiksa di Browser pane (baris #14 menampilkan "4.330 orang/tahun", "Tgt: min 5,000 / yr", 86.6%, Warning). Sisa data tes dibersihkan (reset database + rekaman video asli dipulihkan; 5.040 respons, 2 event, 4 media). Versi → **2.25.0**.

---

## [2.24.1] - 2026-10-11

### 🎞️ Fix: Tombol "Coba Lagi" Transkrip Video Tidak Terlihat Bekerja + Teks Lengkap dari `text` (Fixed / Changed)
- **Laporan pengguna**: tombol "Coba lagi" pada transkrip AI yang gagal "tidak berfungsi"; hasil transkrip lengkap harus diambil dari variabel `text` pada respons API, dengan hasil per segmen tetap dipertahankan.
- **Hasil pengecekan tombol**: endpoint `POST /api/media/:id/transcribe` sebenarnya bekerja (status → PROCESSING), tetapi (1) UI langsung me-*refetch* detail event — saat layanan Video Extractor (port 8000) mati, pekerjaan gagal lagi dalam hitungan milidetik sehingga kartu kembali menampilkan **pesan error yang sama persis** dan tampak tidak terjadi apa-apa; (2) tidak ada umpan balik saat klik (tombol tidak berubah, tidak disabled, tidak ada waktu percobaan). Layanan transkrip memang sedang tidak aktif saat screenshot diambil.
- **Perbaikan tombol**: backend memeriksa dulu apakah API transkrip hidup (`isTranscribeApiReachable`) — bila tidak → **503** dengan pesan jelas dan **status tidak diubah** (tidak ada PROCESSING→FAILED palsu). UI: tombol berputar & disabled ("Memproses ulang…") minimal 0,7 dtk; hasil sukses (202) langsung ditampilkan sebagai "sedang diproses" dari balasan server (lalu polling 4 dtk seperti biasa); penolakan ditampilkan pada kartu: "Dicoba ulang pukul HH:MM:SS: …".
- **Teks lengkap dari `text`**: `transcript` = field `text` dari API apa adanya (hanya di-*trim*); `transcript_segments` disimpan utuh (start, end, text). Bila API tidak mengirim `text`, teks dirakit dari gabungan segmen. **UI**: bagian "Transkrip AI lengkap" kini menampilkan blok **TEKS LENGKAP** (dari `text`) diikuti daftar **PER SEGMEN** yang bisa diklik untuk memutar video dari detik tersebut — sebelumnya bila segmen ada, `text` tidak pernah ditampilkan.
- **Verifikasi nyata**: setelah layanan Video Extractor dinyalakan, klik "Coba lagi" di UI memulai transkripsi sungguhan untuk video pengguna: status → DONE, teks lengkap 411 karakter, 4 segmen, durasi 72 dtk, bahasa `id`; kartu menampilkan TEKS LENGKAP + PER SEGMEN. Tes otomatis (Modul 32, 3 test; total **130**): layanan mati → 503 & status tak berubah; layanan hidup → 202 → DONE dengan `transcript` persis `text` API (sengaja berbeda dari gabungan segmen) dan segmen utuh; tanpa `text` → dirakit dari segmen; sedang PROCESSING → 409; media tak ada → 404 (foto → 400 sudah di Modul 27). **130/130 PASS di SQL dan JSON**. Tes memakai API transkrip palsu; bila Video Extractor asli sedang jalan di :8000 tes itu tidak menyamar (dilewati) — jalankan dengan `TEST_BASE_URL`/`TEST_TRANSCRIBE_PORT` untuk backend terpisah (dipakai pada verifikasi ini). Versi → **2.24.1**.

---

## [2.24.0] - 2026-10-11

### ⏰ Reminder Upload Survei ke PIC: Otomatis, Cek Bulan Sebelumnya, Tanpa Duplikat (Fixed / Changed)
- **Permintaan pengguna**: pastikan reminder email ke PIC terkirim otomatis bila sampai tanggal yang ditentukan PIC belum upload data survei bulan terakhir — mis. reminder di tanggal 10, bulan Oktober → tgl 10 Oktober dikirim reminder agar PIC upload survei **September** bila belum ada. Pengecekan cukup: apakah di tabel survei untuk metrik tsb ada data dengan tanggal survei di bulan itu.
- **Hasil pengecekan — logika lama TIDAK sesuai**: (1) yang dicek adalah data bulan **berjalan** (Oktober), bukan bulan sebelumnya; (2) ada peringatan "segera jatuh tempo" 5 hari sebelum tanggal batas yang tidak diminta; (3) pengiriman hanya pewaktu 24 jam sejak server hidup, tanpa catatan apa yang sudah terkirim → bisa terkirim ulang tiap restart, tidak tepat pada tanggalnya; (4) bila email belum dikonfigurasi, reminder hanya tercetak di konsol lalu hilang.
- **Aturan baru** (`reminderService.js`, ditulis ulang): untuk setiap metrik SURVEY ber-flag *upload manual* — **Bulanan**: pada/sesudah tanggal batas bulan M, jika **tidak ada satu pun respons dengan `survey_date` di bulan M‑1** pada metrik itu (`storage.hasSurveyDataInPeriod`, satu query `EXISTS` ke tabel respons survei per metrik), PIC diemail. Januari → mengecek Desember tahun lalu. Sebelum tanggal batas: tidak ada reminder. Data bulan berjalan tidak ikut menghitung. **Tahunan**: dari tanggal batas (bulan+tanggal) tahun itu, jika belum ada data bertanggal tahun tersebut. Status: `DUE_TODAY` (hari batas) / `OVERDUE` (+`days_overdue`). Isi email menyebut periode yang kosong (mis. "September 2026"), batas upload, dan nomor pengingat.
- **Pengiriman otomatis yang andal**: `startReminderScheduler()` — satu siklus ±20 dtk setelah server hidup (menyusul hari yang terlewat saat server mati) lalu tiap 30 menit; mengirim mulai jam `reminder_send_hour` (default 08:00). Setiap pengiriman dicatat di tabel baru **`px_reminder_log`** sehingga: tidak ada duplikat pada hari yang sama (aman terhadap restart), tindak lanjut diulang setiap `reminder_repeat_days` hari (default 1 = harian sampai data diupload; **0 = hanya sekali** pada tanggal batas), gagal kirim dicoba maksimal 3× per hari, dan bila pengirim email belum diset reminder **tidak** dianggap terkirim (otomatis terkirim begitu pengirim dikonfigurasi). Jadwal diatur di menu **Setting Email** (jam kirim, ulangi tiap N hari) + tabel **Riwayat Reminder Terkirim**.
- **API**: `POST /api/admin/upload-reminders/send` menerima `{ reference_date, dry_run, automatic, metric_id }` untuk simulasi tanggal / uji tanpa kirim / menjalankan aturan otomatis (dedupe) / membatasi satu metrik; `GET /api/admin/upload-reminders` kini `due_today_count` (bukan `due_soon_count`) dan `history`. Panel di Parameter Admin & teks bantu "Batas Tanggal Upload" disesuaikan.
- **Bug nyata yang ditemukan lewat pengujian & diperbaiki**: (a) **menghapus metrik tidak menghapus data surveinya** — karena ID metrik baru = max+1, metrik baru bisa "mewarisi" respons metrik lama yang sudah dihapus (di reminder: dianggap sudah upload). Kini hapus metrik ikut menghapus respons, riwayat upload, pertanyaan, dan log reminder-nya (konfirmasi di UI menyebutnya); (b) **kunci enkripsi `SETTINGS_ENCRYPTION_KEY` bisa terbuat berulang** bila proses yang tidak memuat `.env` (mis. regression test) memanggil enkripsi → 9 kunci menumpuk di `.env` dan password email tersimpan jadi tak terbaca setelah restart. `secretBox` kini selalu memakai kunci yang sudah ada (cek env lalu file `.env`); `.env` dibersihkan ke satu kunci; API/UI memberi tahu bila password tersimpan tak terbaca (`password_readable: false` → "isi ulang password").
- **Verifikasi**: Modul 31 (10 test) + 1 test kunci di Modul 30 → **127 test, 127/127 PASS di SQL Server (2×) dan di JSON**, termasuk skenario persis permintaan: tgl 9 Okt tidak ada reminder; tgl 10 Okt → "September 2026" (DUE_TODAY); tgl 14 → OVERDUE 4 hari; data September mengakhiri reminder sedangkan data Oktober saja tidak; email terkirim sekali, tidak dobel di hari yang sama, tindak lanjut esok harinya ("pengingat ke-2"), berhenti saat repeat=0 atau data diupload. **Bukti langsung tanpa simulasi**: dengan jam server asli (11 Okt, setelah batas tgl 10) dan server SMTP palsu, setelah restart scheduler **mengirim sendiri** email ke PIC untuk periode "September 2026" (tercatat `SENT` di `px_reminder_log`). Versi → **2.24.0**.
- **Catatan**: data demo selalu memiliki data bulan sebelumnya (seed digenerate sampai bulan berjalan), sehingga tidak ada reminder otomatis untuk metrik bawaan — reminder muncul untuk metrik yang benar-benar belum diupload. **Email PIC pada data bawaan adalah alamat contoh (`@cimbniaga.co.id`)** — ganti dengan alamat PIC sebenarnya di Parameter Admin sebelum email diaktifkan di menu Setting Email.

---

## [2.23.0] - 2026-10-11

### 📧 Menu "Setting Email" untuk Reminder PIC + Sisa Daftar Pilihan Dipindah ke SQL Server (Added)
- **Permintaan pengguna**: (1) cek semua filter/parameter/survey dan pindahkan yang masih hardcoded ke SQL Server; (2) tambah menu setting email pengirim reminder ke PIC untuk data survei yang di-upload manual, lalu test kirim email memakai Gmail.
- **Menu baru "Setting Email"** (Header, `EmailSettingsModal.jsx`): aktif/nonaktif, provider **Gmail** (smtp.gmail.com:465, sementara) atau **SMTP** internal (host/port/TLS), akun, password, nama & email pengirim, serta **Kirim Email Test** (ke email pengirim sendiri [default], ke salah satu PIC, atau alamat lain). Disimpan di tabel baru **`px_email_settings`** (1 baris). **Password write-only**: disimpan terenkripsi AES-256-GCM (`server/services/secretBox.js`, kunci `SETTINGS_ENCRYPTION_KEY` di `.env`, dibuat otomatis) — tidak pernah dikembalikan oleh API (UI hanya tahu "ada/tidak ada password"); terverifikasi langsung di SQL Server bahwa isi kolom berupa ciphertext `v1:…`.
- **Reminder memakai pengirim dari database**: `reminderService.js` memanggil `buildTransport()` (`emailSettingsService.js`) di setiap pengiriman — perubahan di menu langsung berlaku tanpa restart; konfigurasi `SMTP_*` di `.env` tetap jadi cadangan. Pesan error dijelaskan (mis. Gmail menolak password biasa → perlu App Password). Endpoint: `GET/PUT /api/admin/email-settings`, `POST /api/admin/email-settings/test`.
- **⚠ Catatan kepatuhan**: Gmail adalah layanan cloud pihak ketiga, bertentangan dengan batasan *100% on-premise* proyek ini. Dipakai hanya sementara atas permintaan pengguna (banner peringatan tampil di menu); target akhir = SMTP internal CIMB Niaga. Gmail juga tidak menerima password akun biasa — wajib **App Password** (Verifikasi 2 Langkah aktif).
- **Kredensial Gmail tidak dipakai oleh Claude**: password yang dikirim lewat chat tidak dimasukkan ke aplikasi/file/database; pengguna mengisinya sendiri di menu (dan disarankan mengganti password tersebut karena sudah tampil di chat).
- **Daftar pilihan hardcoded → database** (`px_app_settings`): `metric_types`, `scale_types`, `target_audiences`, `update_frequencies` (Parameter Admin) dan `question_types` (Survey Questions) kini dibaca dari `GET /api/settings`. Karena *value*-nya menggerakkan logika kalkulasi, `PUT /api/admin/settings/:key` untuk kelima key ini hanya mengizinkan perubahan **label** (value tidak boleh ditambah/diubah → 400). Filter Header (direktorat, sub-direktorat, tahun) sudah dari database sejak 2.22.1; nama bulan adalah konstanta kalender.
- **Verifikasi**: Modul 30 (8 test; total **116**) → **116/116 PASS di SQL (2×) dan di JSON**. Salah satunya menjalankan jalur lengkap tanpa akun email sungguhan: server SMTP palsu di dalam test → simpan setting → email test terkirim dengan password terdekripsi yang benar → `/upload-reminders/send` memakai pengirim dari database (`sender_source: database`); test dilewati otomatis bila sudah ada konfigurasi email sungguhan, agar tidak menimpanya. UI diverifikasi di Browser pane. Versi → **2.23.0**.
- **Catatan operasional**: `node server/db/migrate.js --reset` juga mengosongkan pengaturan email (tabel di-drop); ekspor ke JSON (`db:export`) ikut membawa password terenkripsi — kuncinya (`SETTINGS_ENCRYPTION_KEY`) harus disimpan bersama backup.

---

## [2.22.1] - 2026-10-11

### 🕵️ Audit "Semua Data Dashboard dari SQL Server" — Temuan Auditor & Perbaikan (Fixed)
- **Permintaan pengguna**: tim `auditor` memeriksa ulang seluruh web; semua yang tampil di dashboard harus bersumber dari SQL Server — bila belum, langsung dipindahkan. Pengaturan SQL Server juga dibuat dokumen terpisah: **`SQLServerDB.md`** (root project).
- **Hasil audit**: tidak ada kode server yang melewati SQL untuk data operasional (`store.json`/`jsonStorage` hanya terjangkau saat `STORAGE_BACKEND=json`; tidak ada service yang membaca `seedData` saat runtime; `localStorage` hanya menyimpan tema warna). 19 temuan; yang berikut diperbaiki:
  1. **Katalog pertanyaan survei (P1)** — seluruh set pertanyaan 20 metric SURVEY (~730 baris) ternyata hanya hidup di kode (`metricQuestionService.js`), `px_custom_survey_questions` kosong. Kini tabel baru **`px_survey_questions`** (1 baris per pertanyaan: key, label, teks, tipe, mandatory, dimensi ESS, persentase favorable/neutral/unfavorable, `is_customized`) di-*seed* sekali dari template lalu **dibaca hanya dari SQL**. Simpan oleh admin → tersimpan (`is_customized=1`); "Reset ke default" (aksi admin eksplisit) mengembalikan dari template kode; metric SURVEY baru langsung mendapat baris pertanyaannya. Tabel lama `px_custom_survey_questions` dihapus otomatis. Route simpan/reset kini 404 untuk metric yang tidak ada (sebelumnya menulis baris yatim).
  2. **Direktorat/divisi responden tidak ada di katalog (P1)** — direktorat "Digital Banking" dan ~15 divisi (±3.400 respons) hanya berupa teks bebas sehingga **tidak pernah bisa dipilih** di filter Header. 16 unit organisasi tersebut kini masuk `px_directorates`/`px_divisions` (non-destruktif, ditambahkan otomatis saat server menyala bila belum ada; JSON store sama). Catatan: beberapa nama mirip divisi katalog (mis. "Talent Acquisition" vs "Talent Acquisition & Partnership") — bisa dirapikan admin.
  3. **Target 85% pada Performance Trend** (hardcoded di chart) → tabel baru **`px_app_settings`** (`px_index_target`), dikirim lewat `/api/metrics/trends`; garis & legenda mengikuti nilai di database.
  4. **Pilihan kategori & format event** (hardcoded di `CreateEventModal`) → `px_app_settings` (`event_program_categories`, `event_types`), dibaca dari `GET /api/settings`. Endpoint baru `PUT /api/admin/settings/:key` (validasi: target 0–100, daftar opsi tidak kosong).
  5. **Form check-in publik** — Directorate/Division sebelumnya input teks dengan default "Information Technology"/"Core Banking Solution" (peserta yang tidak mengubahnya otomatis tercatat di IT). Kini dropdown bertingkat dari `/api/directorates`, tanpa default.
  6. **Jumlah metric di dashboard** ("20 Metrics"/"7 Metrics") dan opsi "All 20 Survey Metrics" → dari `survey_metrics_count`/`outcome_metrics_count` dan jumlah metric survei di database.
  7. **Ikon journey** di Dashboard kini memakai kolom `px_journeys.icon` (yang bisa diedit admin; sebelumnya diabaikan).
  8. **Flag `SEED_DEMO_DATA`** (`.env`, default `true`): `false` mencegah pembuatan respons survei demo untuk bulan baru pada database produksi.
- **Bug yang ditemukan auditor & diperbaiki**: (a) drilldown Metric 11 membaca field yang salah (`ev.title`, `a.checkin_time`) → "Program Event Title" kosong & "Registration Time" "-"; (b) `alertEngine.js` membandingkan skor ternormalisasi dengan target mentah → metric RATING_5/QUOTA tidak pernah masuk alert WARNING (jenis bug yang sama dengan v2.15.0); (c) dropdown Sub-Direktorat di Header selalu kosong (memakai `d.id` yang tidak ada); (d) drilldown metric mengabaikan tahun/bulan/direktorat yang dipilih (prop `selectedPeriod` tidak pernah dibaca) sehingga bisa berbeda dari scorecard.
- **Sengaja tidak diubah (dilaporkan)**: ID metric yang di-hardcode untuk kasus khusus (2, 5, 7, 11, 12 — terikat pada logika domain; refactor besar berisiko); importer CSV mengisi nilai default bila kolom kosong ("General", "Universitas Indonesia", dst.); 15 batch upload sisa regression-test lama di database (data lama, bukan dibuat migrasi); `/api/events/:id/media` tanpa file membuat placeholder `/uploads/sample.jpg`; `px_action_library` baru mencakup 5 checkpoint (alert lain memakai teks fallback); baris contoh template CSV.
- **Verifikasi**: `tests/regressionTest.js` bertambah **Modul 29** (9 test; total **108**) → **108/108 PASS di SQL Server (2× berturut-turut) dan di JSON**. Perbandingan SQL vs JSON atas 58 endpoint GET: 57 identik; satu-satunya beda disengaja (JSON masih menyajikan set pertanyaan kode untuk metric 19/20 yang bukan metric SURVEY). Upgrade dari database v2.22.0 yang sudah berisi data diuji (seed pertanyaan/pengaturan/direktori otomatis saat boot). Versi → **2.22.1**.

---

## [2.22.0] - 2026-10-11

### 🗄️ Backend Database Microsoft SQL Server (Added)
- **Permintaan pengguna**: install SQL Server di PC lokal, pindahkan seluruh data dashboard ke SQL Server (kecuali foto & video — **path**-nya disimpan di SQL Server), dan siapkan rollback ke versi sebelumnya bila ada kendala.
- **SQL Server terpasang**: SQL Server **Express** (Standard berlisensi berbayar → disepakati Express, gratis & sah produksi). Instance `SQLEXPRESS`, Mixed Mode, TCP 1433, database `PeopleExperiencePX`, login aplikasi khusus `px_app` (`db_owner` database itu saja; `sa` disabled & tidak pernah diberi password). Dipasang oleh `scripts/sqlserver/Setup-SqlServer.ps1`. *Catatan versi:* installer SQL Server 2022 Express sudah tidak tersedia (tautan winget/fwlink 404 / kini mengarah ke 2025), jadi yang terpasang adalah Express 2025 — aplikasi hanya memakai T-SQL standar.
- **Arsitektur dispatcher**: `server/db/storage.js` memilih backend lewat `STORAGE_BACKEND=sql|json` (default `json`). `jsonStorage.js` = isi lama `storage.js` (tidak berubah perilakunya); `sqlStorage.js` baru mengimplementasikan ~70 method yang sama dengan query terparameterisasi (tanpa cache), transaksi untuk penulisan multi-tabel, dan constraint `UNIQUE` untuk NIP (pesan error Indonesia tetap sama). Dulu klaim "terhubung ke SQL Server bila `DB_SERVER` di-set" di dokumentasi hanya label kosmetik di `/api/health`; kini nyata.
- **Refactor async menyeluruh**: seluruh pemanggil storage (`server.js` 55 titik + `calculationEngine`, `alertEngine`, `pptGenerator`, `reminderService`, `surveyEvidenceService`, `surveyImportService`, `surveyTemplateService`, `transcribeService`) memakai `await`. `calculatePEIndex`/`getMetricDetail`/`computeMonthlyTrends` kini async; bulan-bulan trend & query per-metric dijalankan paralel (`Promise.all`), sinkronisasi metrik live-event dilakukan sekali per kalkulasi (bukan per bulan). Refactor ini diuji lebih dulu pada backend JSON (94/94) sebelum SQL disentuh.
- **Skema ternormalisasi 22 tabel** (`server/db/schema.sql`, ditulis ulang total — versi lama adalah draf usang): tabel `weights` dihapus (duplikat), target hanya di `px_metric_targets`, alias responden `nip`/`participant_id`/`candidate_id` diringkas jadi `respondent_type` + kolom kanonik (field lama diturunkan lagi saat dibaca sehingga logika kalkulasi tidak berubah), `operationalRecords` dipecah menjadi 5 tabel khusus. **Media**: `px_media.file_path` menyimpan path file + caption + transkrip AI; file foto/video tetap di `server/uploads/`.
- **Migrasi** `server/db/migrate.js` (`npm run db:migrate`, `--reset`, `--file`): hanya membaca `store.json`, satu transaksi, bulk insert, tabel verifikasi JSON-vs-SQL (semua `OK`; 5.040 respons survei, 4 media termasuk video bertranskrip).
- **Rollback 3 lapis**: (1) `STORAGE_BACKEND=json` + restart; (2) `npm run db:export -- --replace` mengekspor isi SQL kembali ke format `store.json` (dengan backup otomatis) agar edit baru tidak hilang — teruji: output API backend JSON dari hasil ekspor **identik 58/58 endpoint** dengan SQL; (3) `git checkout pre-sqlserver-v2.21.0` (tag sudah di-push) + backup lokal `server/data/backups/store.pre-sqlserver-2026-10-11.json`.
- **Bug installer yang ditemukan & diperbaiki**: `$PSScriptRoot` kosong pada default `param()` di Windows PowerShell 5.1 (script mati sebelum menulis log), dan `go.microsoft.com/fwlink/?linkid=2216019` kini menyajikan SQL Server 2025 (bukan 2022) sehingga unduh media offline gagal (exit -1). Install kini lewat `winget` + konfigurasi registry + provisioning *Integrated Security* (tanpa password `sa`).
- **`/api/health`** kini melaporkan backend aktif yang sebenarnya (`database.backend`; untuk SQL: server, database, edisi, versi, jumlah baris). Versi → **2.22.0**.
- **File baru**: `server/db/{sqlStorage,jsonStorage,filterUtils,initialStore,migrate,exportToJson}.js`, `scripts/sqlserver/Setup-SqlServer.ps1`, `docs/08_DATABASE_SCHEMA_AND_MIGRATION.md`. **Konfigurasi baru** (`.env.example`): `STORAGE_BACKEND`, `DB_SERVER`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_ENCRYPT`, `DB_TRUST_SERVER_CERTIFICATE`.
- **Verifikasi**: `tests/regressionTest.js` bertambah Modul 28 (5 test: backend aktif di health, jumlah baris SQL, media hanya berupa path, duplikat NIP ditolak, lookup tak ada → 404) → **99/99 PASS di SQL (2× berturut-turut) dan di JSON**. Dua server dijalankan berdampingan atas data identik dan 58 endpoint GET dibandingkan (dashboard YTD/MTD/2025/filter direktorat, trend lintas tahun, 27 drilldown metric, parameter, event, evidence CSV, alerts) → **58/58 identik**. Dicek langsung ke database sebagai `px_app`: 22 tabel, path media + transkrip tersimpan, `sa` disabled. Dashboard & menu Signature Program Events diverifikasi di Browser pane.
- **Catatan**: file contoh `sample_*.jpg` untuk 3 media seed tidak ada di disk sejak awal (UI menampilkan "File tidak tersedia di server") — tidak berubah oleh migrasi.

---

## [2.21.0] - 2026-10-11

### 🎞️ Foto/Video Event Bisa Dilihat & Diputar + Transkrip AI Video (Added / Security)
- **Permintaan pengguna**: pada menu Signature Program Events → upload foto/video, file harus bisa dilihat/diputar setelah diupload; dan untuk video, transkrip AI memakai API audio/video-to-text lokal (`POST http://127.0.0.1:8000/transcribe` dengan `{"source": <lokasi file>, "language": "id"}`, bahasa default `id`).
- **Sebelumnya**: galeri hanya menampilkan ikon + nama file (foto/video tidak pernah benar-benar dirender), dan deskripsi AI video tidak ada.
- **Tampil/putar**: foto = thumbnail + lightbox ukuran penuh; video = pemutar bawaan (play/seek/volume/fullscreen, HTTP Range terverifikasi 206) + lightbox. File yang tidak ada di server (data seed contoh) menampilkan placeholder, bukan gambar rusak.
- **Transkrip AI** (`server/services/transcribeService.js`): path **lokal** file yang diupload dikirim ke API transkrip (video tidak keluar dari mesin — patuh 100% on-premise). Karena Whisper di CPU lambat (video uji 72 detik ≈ 60 detik), proses berjalan di background: upload langsung dijawab `PROCESSING`, UI polling tiap 4 detik hanya selama ada yang diproses, lalu menampilkan cuplikan di *AI Description* + transkrip lengkap bertimestamp (klik baris → video lompat ke bagian itu). Gagal → alasan + tombol **Coba lagi** (`POST /api/media/:id/transcribe`). Job yang terputus restart server otomatis dilanjutkan. Memakai modul `http` Node (bukan `fetch`) agar tidak kena batas 5 menit undici.
- **Keamanan (ditemukan saat mengerjakan)**: endpoint upload media sebelumnya menerima **semua** tipe file dan menyajikannya kembali dari `/uploads` (celah stored-XSS lewat `.html`). Kini hanya `image/*` & `video/*` (selain itu 415), lewat instance multer khusus; batas ukuran media dinaikkan ke 200 MB (`MEDIA_MAX_MB`). Menghapus media kini juga menghapus file fisiknya.
- **Konfigurasi baru** (`.env.example`): `TRANSCRIBE_API_URL`, `TRANSCRIBE_LANGUAGE`, `TRANSCRIBE_TIMEOUT_MS`, `MEDIA_MAX_MB`.
- **Verifikasi**: end-to-end di UI dengan video uji (`Tentang WAKTU (Video Narasi)…mp4`) — upload → PROCESSING → terisi otomatis (DONE, `id`, 4 segmen, 01:12), klik segmen memutar video dari detik ke-29 (1920×1080, tanpa error), lightbox video & foto berfungsi. `tests/regressionTest.js` gained Module 27 (6 tests) → **94/94 PASS**. Catatan: `deleteEvent()` masih belum membersihkan media milik event tersebut (kekurangan lama, tidak diubah).

---

## [2.20.1] - 2026-10-11

### 🛠️ Fix: Konten PPT Melebihi Ukuran Slide (Fixed)
- **Laporan pengguna**: pada file hasil download `PX_Report_Perspektif_1791709479200.pptx`, konten di **setiap slide** melebihi batas ukuran slide.
- **Root cause**: `pptGenerator.js` menetapkan `pptx.layout = 'LAYOUT_16x9'` (slide **10" × 5.625"**), padahal seluruh koordinat konten (banner cover 13.33 × 7.5, footer di y=7.0, kartu, tabel, dll.) dirancang untuk kanvas **13.33" × 7.5"**. Dibuktikan dari `presentation.xml` file yang diunduh: `sldSz cx=9144000 cy=5143500` (10 × 5.625 in).
- **Fix**: layout diganti ke `LAYOUT_WIDE` (13.33" × 7.5") — satu baris di `server/services/pptGenerator.js`; tidak ada koordinat yang perlu diubah.
- **Verifikasi**: PPT di-generate ulang, `sldSz` kini 12192000 × 6858000 EMU (13.33 × 7.50 in), dan seluruh shape di 6 slide dipindai terhadap batas slide → **0 shape di luar batas** (sebelumnya mayoritas melewati batas). `node tests/regressionTest.js` → **88/88 PASS**. Catatan: render visual (LibreOffice) tidak tersedia di mesin ini, jadi pengecekan berbasis geometri shape; overflow teks di dalam kotak tidak ikut terdeteksi dan perlu dicek mata di PowerPoint.

---

## [2.20.0] - 2026-10-01

### 🎨 Red-Gradient Mockup Redesign + Per-User Selectable Accent Theme (Added / Improved)
- **Permintaan pengguna**: user menyediakan 7 mockup baru (`mockup/`, masing-masing 2 versi)
  untuk Dashboard & Trends, Employee Experience Journey, Explore Metrics, Perspektif
  (Signature Events), Metric Deficit Alerts, Parameter Management, dan Survey Question &
  Template Management — diminta dianalisis dulu lalu diterapkan ke seluruh tampilan web,
  dengan checkpoint git sebelum mulai supaya mudah di-rollback, dan direview di browser
  sebelum dianggap selesai.
- **Checkpoint**: commit `946e9bc` dibuat sebelum perubahan apapun, mencakup seluruh kerja
  sesi sebelumnya (v2.19.0 + data seed September) sebagai titik rollback aman.
- **Analisis mockup**: pola konsisten di ke-7 layar — permukaan besar (hero scorecard, kartu
  journey, tabel, panel event, modal admin) berubah dari latar putih+aksen merah menjadi
  **gradient merah pekat sebagai latar utama**, struktur/fungsi/label tidak berubah (murni
  reskin visual, bukan redesain struktural).
- **Diterapkan** (commit `650b8b3`) ke `Dashboard.jsx` (hero banner + kartu journey),
  `Calculator.jsx`/Explore Metrics (banner, filter bar, action guide, tabel), `EventManager.jsx`
  (panel Signature Program Events), `App.jsx`'s tab "Action Library & AI Alerts" (bukan
  `ActionLibraryView.jsx` yang ternyata dead code/tidak pernah dirender), `AdminParametersModal.jsx`,
  dan `AdminSurveyQuestionsModal.jsx` — plus gradient pink lembut di nav tab bar `Header.jsx`.
- **Follow-up #1 — lebar tabel** (commit `8e8e698`): user melaporkan tabel Explore Metrics
  butuh scroll kiri-kanan yang membuat gradient per-baris terlihat terpotong. Container utama
  (`App.jsx`, `Header.jsx`) diperlebar dari `max-w-7xl` (1280px) ke `max-w-[1600px]` — tabel
  kini muat penuh tanpa scroll di lebar desktop umum (diverifikasi 1440px & 1700px). Baris
  tabel juga disesuaikan lebih mendekati mockup "3. (V.1) ALL JOURNEY SECTION": gradient
  horizontal kiri-ke-kanan per baris, nomor ID jadi maroon tebal — tanpa mengubah tombol atau
  label apapun sesuai instruksi eksplisit user.
- **Follow-up #2 — tema warna per-user** (commit `c912abb`): user ingin bisa ganti warna tema
  website sesuai selera. Ditambahkan tombol **"Tema"** di header dengan 5 preset (Merah CIMB/
  Biru/Teal/Ungu/Oranye), tersimpan di `localStorage` browser masing-masing (tidak memengaruhi
  user lain, tidak menyentuh database). Semua 13 variabel warna CSS custom property baru
  (`src/index.css` `:root`, prefix `--theme-*`) dipakai di seluruh permukaan yang di-reskin di
  atas, menggantikan hex statis — `src/utils/theme.js` men-derive seluruh 13 role warna
  tersebut dari satu warna dasar preset lewat perhitungan HSL, supaya setiap preset
  mempertahankan hubungan kontras yang sama dengan palet merah aslinya. Sengaja **tidak**
  ikut berubah: warna asli tiap Journey (data domain, bukan chrome web), tombol
  hapus/delete (konvensi universal merah=bahaya), dan banner notifikasi sukses/error.
- **Verifikasi**: `node tests/regressionTest.js` → **88/88 PASS** di setiap tahap (murni
  perubahan CSS/frontend, tidak ada perubahan API/kontrak data). Dicek langsung di Browser
  untuk tiap-tiap 7 halaman/modal dibandingkan dengan mockup-nya, dan tema "Biru" dicoba
  langsung untuk memastikan ke-13 variabel warna konsisten berubah di semua halaman.

---

## [2.19.0] - 2026-09-25

### 🏷️ Rename Tab Glossary → About, Label Dropdown & Fix "Failed to Fetch" (Improved / Fixed)
- **Permintaan pengguna**: (1) nama menu "Glossary" diubah menjadi "About"; (2) pada Parameter Admin → Parameter Metric untuk Survey, opsi dropdown "Batas Tanggal Upload" menghilangkan prefix "Tgl"; (3) investigasi notifikasi "Failed to fetch" yang muncul saat memakai aplikasi.
- **Fix (1)**: label tab navigasi di `Header.jsx` diubah dari "Glossary" menjadi "About" (ikon `BookMarked` dan konten `GlossaryView.jsx` tidak diubah — hanya nama menunya sesuai permintaan).
- **Fix (2)**: `AdminParametersModal.jsx`'s dropdown "Batas Tanggal Upload" sekarang menampilkan angka polos (`1`–`28`) alih-alih `Tgl 1`–`Tgl 28`.
- **Root cause (3)**: `npm run dev` menjalankan backend Express (port 5000) dan frontend Vite (port 3000) secara bersamaan (`concurrently`) tanpa readiness handshake — pada beberapa detik pertama setelah start, backend belum selesai boot. `TrendChart.jsx`'s `fetchTrend()` melakukan `fetch('/api/metrics/trends')` begitu komponen dimuat (bagian dari Dashboard yang tampil pertama kali); saat race ini terjadi, `fetch()` browser gagal total (bukan cuma respons HTTP error) dan melempar `TypeError: Failed to fetch` — pesan mentah ini langsung ditangkap lalu ditampilkan sebagai teks di kartu Performance Trend tanpa retry otomatis, sehingga pengguna tetap melihatnya sampai mengubah filter atau me-refresh manual. `App.jsx`'s fetch awal (`/api/directorates` dan 5 fetch paralel di `fetchAllData`) punya celah race yang sama, meski gagalnya cuma ke console (dashboard tampil kosong/basi, tanpa notif eksplisit).
- **Fix**: `src/utils/fetchWithRetry.js` baru — wrapper tipis di atas `fetch()` yang otomatis retry (hingga 4x, jeda 600ms) saat request gagal total (network error) atau server membalas 502/503/504 (persis gejala race start-up di atas). Dipasang di `TrendChart.jsx`'s `fetchTrend()` dan `App.jsx`'s fetch `/api/directorates` + seluruh 5 fetch di `fetchAllData()`. Pesan error `TrendChart.jsx` juga diganti dari `err.message` mentah menjadi teks Bahasa Indonesia yang jelas ("Gagal memuat data tren. Periksa koneksi ke server dan coba lagi.") untuk kasus retry benar-benar habis (backend memang mati lama).
- **Verifikasi**: `node tests/regressionTest.js` → **88/88 PASS** (perubahan murni frontend, tidak menyentuh kontrak API). Direstart dev server dan dicek langsung di Browser: tab menu kini bertuliskan "About", dropdown Batas Tanggal Upload menampilkan angka polos, dan reload berulang saat window race start-up tidak lagi memunculkan notifikasi "Failed to fetch" di kartu Performance Trend.

---

## [2.18.0] - 2026-09-24

### 📈 Data Dummy 2026 Lebih Banyak & Grafik Trend Lebih Hidup (Improved)
- **Permintaan pengguna**: "buatkan data dummy lebih banyak lagi agar grafik trend people experience bisa lebih bagus lagi grafiknya untuk YTD 2026."
- **Root cause tampilan sebelumnya**: seluruh bulan 2026 memakai base score yang **identik** (statis, tanpa komponen tren) — hanya diberi variasi kecil ±0.12–0.3 pada skala 1-5 yang berulang tiap 5 indeks. Karena PX Index YTD adalah rata-rata kumulatif berjalan, hasilnya nyaris rata: **82.86% – 83.68%** sepanjang Januari–Agustus (rentang <1 poin) — grafik terlihat nyaris datar.
- **Fix — Data lebih banyak**: pool responden diperluas (karyawan 8→16 orang, mahasiswa kampus 4→6, kandidat pelamar 4→6), dan jumlah tanggal survei per bulan ditambah dari 3 menjadi 4 hari — kombinasi ini menaikkan volume respons bulanan dari ±228 menjadi ±240 respons per bulan sekaligus menambah keragaman nama/divisi/direktorat pada data seed.
- **Fix — Tren kenaikan yang masuk akal**: fungsi baru `monthTrendBonusPercent()` di `seedData.js` menambahkan bonus skor bulanan yang **naik bertahap** sepanjang 2026 (0pp di Januari, naik ~0.85pp tiap bulan, ~+9pp menjelang Desember) — merepresentasikan efek program intervensi PXCWB yang berjalan sepanjang tahun. Diterapkan konsisten di seluruh jalur skor (SCALE_1_5, SCALE_1_10, YES_NO). **Khusus berlaku untuk data 2026** — dataset baseline 2025 sengaja tidak disentuh agar perbandingan lintas tahun tetap sebagai baseline yang stabil.
- **Hasil**: PX Index YTD kini menunjukkan kenaikan yang jelas dan realistis — **82.81% (Januari) → 84.82% (Agustus)** — dan mode MTD (bulanan berdiri sendiri) menunjukkan tren yang lebih tegas lagi: **82.81% → 87.04%**. Outcome Index tetap datar di seluruh bulan (`75.11%`) — ini **disengaja**, bukan bug (metrik OUTCOME adalah snapshot HR terkini, bukan deret waktu bulanan, lihat `CHANGELOG.md` **[2.11.1]**).
- **Housekeeping tambahan**: selagi meregenerasi `store.json`, dibersihkan juga ~180 sisa fixture test lama yang menumpuk (`upl-*` CSV upload test dari regression suite Modul 5/10/12/13, dan ~225 record metadata upload uji di `surveyUploads`) yang sebelumnya tidak masuk cakupan pembersihan `[2.14.1]` — tidak berdampak ke tampilan UI manapun, murni pembersihan data.
- **Verifikasi**: `node tests/regressionTest.js` dijalankan **2x berturut-turut** → **88/88 PASS** setiap kali. Dicek langsung di Browser: PX Index YTD 2026 naik dari 83.2% → 85.1% dengan data segar, seluruh 5 Journey menampilkan skor yang lebih beragam (77.3%–93.1%, sebelumnya sempit di rentang 78.8%–90.8%), dan jumlah event/absensi/feedback tetap stabil di baseline (2 event, 5 absensi, 3 feedback) — tidak ada kebocoran data test baru.

---

## [2.17.1] - 2026-09-24

### 🏷️ Status Eksplisit & Nama Metrik Lebih Lega di Kartu Journey Dashboard (Improved)
- **Permintaan pengguna**: pada bagian "5 Employee Experience Journeys (17 Check Points • 27 PX Metrics)", tambahkan status di samping nama tiap metrik, dan perpanjang ruang untuk nama metrik yang sebelumnya terpotong.
- **Sebelumnya**: daftar metrik di tiap kartu Journey (`Dashboard.jsx`) memakai chip kecil yang di-wrap (`flex flex-wrap`), dengan nama metrik dibatasi `max-w-[120px]` dan `truncate` — nama panjang seperti "Career website & social media follower, reach & engagement growth" terpotong jadi "Career website & socia...". Status hanya tersirat lewat warna latar chip (hijau/amber/merah), tanpa label eksplisit.
- **Fix**: Daftar metrik diubah dari chip yang di-wrap menjadi baris penuh bertumpuk (`flex flex-col`), memberi nama metrik jauh lebih banyak ruang horizontal (nama kini tampil utuh, bukan lagi dipotong `...`). Setiap baris kini menampilkan **ikon status eksplisit** (`CheckCircle2` untuk On Target, `AlertTriangle` untuk Warning, `AlertCircle` untuk Critical, `MinusCircle` untuk metrik yang di-exempt filter Direktorat) plus **label teks status** ("ON TARGET"/"WARNING"/"CRITICAL"/"EXEMPTED") di sisi kanan berdampingan dengan skor — mengikuti pola badge status yang sama persis dengan yang sudah dipakai di Explore Metrics (`Calculator.jsx`), sehingga konsisten di seluruh aplikasi. Area scroll kartu Journey diperbesar (`max-h-20` → `max-h-40`) untuk mengakomodasi baris yang kini lebih tinggi.
- **Verifikasi**: `node tests/regressionTest.js` → **88/88 PASS** (perubahan murni UI/frontend, tidak menyentuh backend). Dicek langsung di Browser: seluruh 27 metrik pada 5 kartu Journey menampilkan nama lengkap tanpa terpotong beserta label status (ON TARGET/WARNING/CRITICAL) di sampingnya — termasuk kasus nyata seperti "Signature Program participation rate" (CRITICAL) dan "Exit Survey — resignation experience" (WARNING).

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
