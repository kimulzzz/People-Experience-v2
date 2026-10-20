# 02. Data Dictionary & 27 Metrics Catalog
**CIMB Niaga People Experience (PE) Framework**

---

## 📊 1. Klasifikasi Fundamental: Metrik Outcome vs Metrik Survey

Dalam framework People Experience CIMB Niaga, seluruh 27 metrik dibagi secara tegas ke dalam dua kategori dengan karakteristik data yang berbeda:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        27 METRIK PEOPLE EXPERIENCE FRAMEWORK                           │
├───────────────────────────────────────────┬────────────────────────────────────────────┤
│         7 METRIK TIPE OUTCOME             │          20 METRIK TIPE SURVEY             │
│        (Data Transaksional HR)            │         (Data Respon Kuesioner)            │
├───────────────────────────────────────────┼────────────────────────────────────────────┤
│ • Diperoleh dari data HR internal CIMB    │ • Diperoleh dari survei karyawan           │
│   (Workday, Arjuna HRIS, LMS, Registrasi) │   (Kuesioner ESS, Onboarding, Evaluasi)    │
│ • Bersifat obyektif & faktual             │ • Bersifat persepsional / sentimen         │
│ • TIDAK MEMILIKI Total Koresponden        │ • MEMILIKI Total Koresponden               │
│ • Menampilkan Log & Parameter Transaksi   │ • Menampilkan Breakdown Butir Pertanyaan   │
│ • Tidak memerlukan impor/template survei  │ • Mendukung Template CSV & Impor Respon    │
│ • Bobot Konsolidasi: 30%                  │ • Bobot Konsolidasi: 70%                   │
└───────────────────────────────────────────┴────────────────────────────────────────────┘
```

---

## 📑 2. Katalog Lengkap 27 Metrik People Experience

| ID | Journey | Checkpoint | Nama Metrik | Tipe Metrik | Sumber Data | PIC / Owner | Skala | Target | Ambang Min |
| :-: | :--- | :--- | :--- | :---: | :--- | :--- | :---: | :---: | :---: |
| **1** | Arrival | CP 1.1 Outreach | % SLA of candidate fulfillment | **OUTCOME** | Workday / HRIS | Talent Acquisition | % | $\ge 85\%$ | $75\%$ |
| **2** | Arrival | CP 1.1 Outreach | CIMB Niaga Goes to Campus — event rating | **SURVEY** | Event Survey | Employer Branding | 1–5 | $> 4.00$ | $75\%$ |
| **3** | Arrival | CP 1.2 Selection | Candidate offering lead time (TAT H-14) | **OUTCOME** | Workday / TA Logs | Talent Acquisition | % | $\ge 90\%$ | $80\%$ |
| **4** | Arrival | CP 1.2 Selection | Channel effectiveness success ratio | **OUTCOME** | Sourcing Data | Talent Acquisition | % | $\ge 80\%$ | $70\%$ |
| **5** | Arrival | CP 1.2 Selection | Candidate experience survey score | **SURVEY** | Candidate Survey | Talent Acquisition | 1–5 | $> 4.20$ | $75\%$ |
| **6** | Arrival | CP 1.3 Offering | Pre-boarding engagement index | **SURVEY** | Preboarding Form | PXCWB | 1–5 | $> 4.00$ | $75\%$ |
| **7** | Arrival | CP 1.4 Day 1 | Day 1 Onboarding satisfaction index | **SURVEY** | Day 1 Survey | PXCWB / IT / Ops | 1–5 / Y-N | $> 4.50$ | $80\%$ |
| **8** | Connect | CP 2.1 Journey | Onboarding 30/60/90 satisfaction index | **SURVEY** | Milestone Survey | HRBP & Unit Head | 1–5 | $> 4.00$ | $75\%$ |
| **9** | Connect | CP 2.2 Support | Direct supervisor support & role clarity | **SURVEY** | Pulse Survey | People Development | 1–5 | $> 4.00$ | $75\%$ |
| **10** | Connect | CP 2.3 Transition| Internal career transition experience | **SURVEY** | Transition Survey | Talent Management | 1–5 | $> 4.00$ | $75\%$ |
| **11** | Belong | CP 3.1 Signature | Signature program attendance / participation | **OUTCOME** | Event Registration | PXCWB | % | $\ge 85\%$ | $70\%$ |
| **12** | Belong | CP 3.1 Signature | Signature program event satisfaction index | **SURVEY** | Post-Event Survey | PXCWB | 1–5 | $> 4.25$ | $80\%$ |
| **13** | Belong | CP 3.2 Arjuna | Arjuna recognition experience & sentiment | **SURVEY** | Arjuna Survey | Culture & Engagement| 1–5 | $> 4.00$ | $75\%$ |
| **14** | Belong | CP 3.2 Arjuna | Total penerima reward recognition Arjuna | **OUTCOME** | Arjuna HRIS Logs | Culture & Engagement| Count | $\ge 500$ | $75\%$ |
| **15** | Belong | CP 3.3 Wellbeing | Employee wellbeing index (Fisik, Mental, Fin)| **SURVEY** | Annual PE Survey | Health & Wellbeing | 1–5 | $> 4.00$ | $75\%$ |
| **16** | Belong | CP 3.4 Safety | Psychological safety index | **SURVEY** | Annual PE Survey | HR Strategy | 1–5 | $> 4.00$ | $75\%$ |
| **17** | Belong | CP 3.5 Leadership| Leadership connection & communication index | **SURVEY** | Pulse Survey | Internal Comms | 1–5 | $> 4.00$ | $75\%$ |
| **18** | Contribute | CP 4.1 Growth | Learning & growth experience (LMS/Training) | **SURVEY** | LMS Post-Training | CIMB Niaga Academy | 1–5 | $> 4.20$ | $75\%$ |
| **19** | Contribute | CP 4.1 Growth | Training effectiveness (Kirkpatrick L1-L3) | **SURVEY** | Evaluation Survey | CIMB Niaga Academy | 1–5 | $> 4.00$ | $75\%$ |
| **20** | Contribute | CP 4.2 Mentoring| Mentoring & coaching effectiveness | **SURVEY** | Mentoring Survey | People Development | 1–5 | $> 4.00$ | $75\%$ |
| **21** | Contribute | CP 4.3 Dialogue | Performance & career dialogue experience | **SURVEY** | Mid/Year-End Survey| Performance Mgt | 1–5 | $> 4.00$ | $75\%$ |
| **22** | Contribute | CP 4.4 Purpose | Meaningful contribution & purpose index | **SURVEY** | Culture Survey | HR Strategy | 1–5 | $> 4.00$ | $75\%$ |
| **23** | Contribute | CP 4.4 Purpose | Talent retention & high-potential experience| **SURVEY** | Talent Survey | Talent Management | 1–5 | $> 4.20$ | $80\%$ |
| **24** | Depart | CP 5.1 Exit | Offboarding process & experience index | **SURVEY** | Exit Interview | Employee Relations | 1–5 | $> 4.00$ | $75\%$ |
| **25** | Depart | CP 5.1 Exit | Early attrition rate (< 1 year tenure) | **OUTCOME** | HRIS Turnover Data| HR Operations | % | $< 8.0\%$ | $75\%$ |
| **26** | Depart | CP 5.1 Exit | Exit reason positive sentiment score | **SURVEY** | Exit Sentiment | Employee Relations | 1–5 | $> 3.80$ | $70\%$ |
| **27** | Depart | CP 5.1 Exit | Alumni advocacy & employer net sentiment | **SURVEY** | Alumni Survey | Employer Branding | 1–5 | $> 4.00$ | $75\%$ |

---

## 📋 3. Kamus Data Rinci: 7 Metrik Outcome (Data HR Internal)

Setiap metrik Outcome tidak merepresentasikan kuesioner individual, melainkan **agregat kinerja operasional sistem perbankan internal**:

### 1. Metrik #1: % SLA of Candidate Fulfillment
- **Pengukuran**: Persentase pemenuhan lowongan pekerjaan sesuai dengan batas waktu *Service Level Agreement* (SLA) rekrutmen.
- **Logika Nilai**: $\frac{\text{Jumlah Posisi Terpenuhi Tepat Waktu}}{\text{Total Posisi Dibuka}} \times 100\%$.
- **Tabel Log**: Mencatat rincian SLA per unit (seed sejak v2.31.0: Operations, Technology, Analytics & AI; Consumer & EBB; Risk Management; Corporate Banking & Markets; Operations & Support).

### 2. Metrik #3: Candidate Offering Lead Time (TAT H-14)
- **Pengukuran**: Persentase penerbitan surat penawaran kerja (*Offering Letter*) yang diselesaikan minimal 14 hari sebelum tanggal mulai bekerja.
- **Logika Nilai**: $\frac{\text{Offering Letter } \ge H-14}{\text{Total Offering Terbit}} \times 100\%$.

### 3. Metrik #4: Channel Effectiveness Success Ratio
- **Pengukuran**: Efisiensi saluran rekrutmen (Karier Website CIMB, Employee Referral, LinkedIn, Campus Hiring).
- **Logika Nilai**: Rasio konversi kandidat lolos probation per saluran rekrutmen.

### 4. Metrik #11: Signature Program Attendance / Participation
- **Pengukuran**: Tingkat kehadiran peserta terverifikasi pada program unggulan (*Perspektif, D&I, Young CIMBian, EVD*).
- **Logika Nilai**: $\frac{\text{Peserta Hadir Absensi QR}}{\text{Target Kuota / Undangan}} \times 100\%$.
- **Integrasi**: Terhubung langsung dengan modul **Signature Events** (`/api/events`).

### 5. Metrik #14: Total Penerima Reward Recognition Arjuna
- **Pengukuran**: Jumlah karyawan yang menerima pengakuan dan reward pada platform apresiasi internal *Arjuna*.
- **Logika Nilai**: Normalisasi terhadap target kuota tahunan 500 penerima per tahun.

### 6. Metrik #25: Early Attrition Rate (< 1 Year Tenure)
- **Pengukuran**: Tingkat *turnover* sukarela karyawan baru dengan masa kerja di bawah 1 tahun.
- **Logika Nilai**: Skor invers (semakin rendah persentase turnover, semakin tinggi skor indeks PE).
- **Formula Normalisasi**: $\text{Normalized Score} = \max\left(0, 100 - \left(\frac{\text{Turnover Rate}}{10\%} \times 100\right)\right)$.

---

## 📝 4. Spesifikasi Resmi Pertanyaan Survei

### 4.1 Spesifikasi 15 Butir Pertanyaan Metrik #7 (Day 1 Onboarding)

Metrik #7 memiliki susunan pertanyaan baku gabungan antara skala likert dan verifikasi fasilitas kerja biner:

| No | Key Kolom | Label Singkat | Teks Lengkap Pertanyaan | Tipe Pertanyaan | Mandatory | Bobot Nilai |
| :-: | :--- | :--- | :--- | :---: | :---: | :---: |
| **Q1** | `q1_recruitment_process` | Kepuasan Proses Rekrutmen | Saya puas dengan proses rekrutmen saya secara keseluruhan, mulai dari komunikasi dengan Recruiter sampai dengan penandatanganan perjanjian kerja | `SCALE_1_5` | Ya | $\frac{V}{5} \times 100$ |
| **Q2** | `q2_interview_biz_unit` | Wawancara Unit Bisnis | Saya puas dengan pengalaman wawancara saya dengan Unit Bisnis. | `SCALE_1_5` | Ya | $\frac{V}{5} \times 100$ |
| **Q3** | `q3_day1_overall_exp` | Pengalaman Hari Pertama | Saya puas dengan pengalaman hari pertama saya bekerja secara keseluruhan. | `SCALE_1_5` | Ya | $\frac{V}{5} \times 100$ |
| **Q4** | `q4_welcome_kit_interest` | Ketertarikan Welcome Kit | Saya tertarik terhadap informasi, konten, dan item di dalam Welcome Kit CIMBian Starter Pack. | `SCALE_1_5` | Ya | $\frac{V}{5} \times 100$ |
| **Q5** | `q5_meet_greet_satisfaction` | Kepuasan Meet & Greet | Saya merasa puas dengan pengalaman saya selama mengikuti sesi Meet & Greet di CIMB Niaga | `SCALE_1_5` | Ya | $\frac{V}{5} \times 100$ |
| **Q6** | `q6_welcoming_email` | Welcoming Email | Saya menerima Welcoming Email melalui email pribadi sebelum tanggal bergabung. | `YES_NO` | Ya | Ya=100, Tdk=0 |
| **Q7** | `q7_contacted_by_ds_buddy` | Kontak Pra-Day 1 | Saya dihubungi oleh atasan langsung atau buddy saya (melalui telepon, WhatsApp, atau email) sebelum hari pertama bekerja. | `YES_NO` | Ya | Ya=100, Tdk=0 |
| **Q8** | `q8_welcomed_by_ds` | Disambut Atasan Langsung | Saya disambut oleh atasan langsung saya pada hari pertama bekerja di CIMB Niaga. | `YES_NO` | Ya | Ya=100, Tdk=0 |
| **Q9** | `q9_welcomed_by_buddy` | Disambut Buddy | Saya disambut oleh buddy saya pada hari pertama bekerja di CIMB Niaga. | `YES_NO` | Ya | Ya=100, Tdk=0 |
| **Q10** | `q10_welcome_kit_goodie_bag` | Welcome Kit Goodie Bag | Saya menerima Welcome Kit CIMBian Starter Pack (Goodie Bag) pada hari pertama bekerja. | `YES_NO` | Ya | Ya=100, Tdk=0 |
| **Q11** | `q11_id_card_received` | Penerimaan ID Card | Saya menerima ID Card bersamaan dengan Welcome Kit CIMBian Starter Pack. | `YES_NO` | Ya | Ya=100, Tdk=0 |
| **Q12** | `q12_laptop_received` | PC / Laptop Kerja | Saya menerima PC/Laptop sebagai perlengkapan kerja pada hari pertama bekerja. | `YES_NO` | Ya | Ya=100, Tdk=0 |
| **Q13** | `q13_sms_credentials` | SMS User ID & Password | Saya menerima sms notifikasi perihal User ID dan password login PC/Laptop sebelum hari pertama bekerja. | `YES_NO` | Ya | Ya=100, Tdk=0 |
| **Q14** | `q14_system_activation_support` | Aktivasi Akses Sistem | Saya didampingi oleh atasan langsung/buddy selama proses aktivasi LAN/VPN/Email atau akses ke sistem lain yang dibutuhkan pada hari pertama bekerja. | `YES_NO` | Ya | Ya=100, Tdk=0 |
| **Q15** | `q15_system_access_ready` | Kesiapan Sistem Hari 1 | Saya sudah dapat menggunakan User ID, LAN/VPN/Email, dan akses sistem lainnya pada hari pertama bekerja. | `YES_NO` | Ya | Ya=100, Tdk=0 |

---

### 4.2 Spesifikasi 11 Metrik Survei Bersumber dari ESS (Employee Sentiment Survey)

Untuk metrik yang bersumber dari ESS, data disajikan dalam format **Spreadsheet Skor Pertanyaan (% Favorable, % Neutral, % Unfavorable)**.

> **Sejak v2.32.0** data metrik ESS adalah **ringkasan hasil ESS yang diunggah (.xlsx)**, bukan jawaban per responden (lihat §5.3). Ringkasan hanya memuat % favorable per pertanyaan; % Neutral / % Unfavorable tidak tersedia (`null`). Kolom % Neut / % Unfav di tabel di bawah adalah angka referensi lama. Nilai seed saat ini: periode November 2025, index Bankwide metrik 9 = 92,00 (nilai file user), metrik lain = `raw_value` seed metrik (dummy).

> **Sejak v2.50.0** semua pertanyaan 11 metrik ESS bertipe **`PERCENTAGE`** (0-100%; tipe pertanyaan ke-5, label "Percentage (0–100%)" di setting `question_types`). Boot mengubah pertanyaan ESS yang belum `PERCENTAGE`, route simpan pertanyaan memaksa `PERCENTAGE` untuk metrik ESS, dan dropdown tipe di Manage Questions terkunci untuk ESS. Pertanyaan yang tampil di web dan template ESS = pertanyaan di Manage Questions (urut tampilan); kolom pertanyaan file ESS dipetakan menurut posisi (§5.3). Hasil ESS dipakai *carry-forward* (`docs/01` §4). Kuartal dummy 2026 (v2.37.0) dihapus; data ESS saat ini hanya periode November 2025.

| ID | Nama Metrik ESS | Dimensi ESS | Jml Soal | % Fav Total | % Neut Total | % Unfav Total |
| :-: | :--- | :--- | :---: | :---: | :---: | :---: |
| **9** | Role Clarity & DS Support Score Index | Employee Commitment | 3 | 92.3% | 7.0% | 0.7% |
| **13** | Pride & Work Environment Index | Pride & Work Environment | 4 | 91.3% | 7.5% | 1.3% |
| **15** | Manager Recognition Index | Recognition & Appreciation | 3 | 89.3% | 9.3% | 1.3% |
| **16** | Wellbeing Index | Employee Wellbeing | 3 | 87.0% | 10.0% | 3.0% |
| **17** | Psychological Safety Index | Psychological Safety & Risk Mindset | 4 | 94.5% | 4.3% | 1.3% |
| **18** | Leadership Connection Score | Agility & Decision Making | 6 | 88.5% | 10.0% | 1.5% |
| **21** | Career Growth & Learning Index | Career Growth & Learning | 3 | 90.7% | 8.3% | 1.0% |
| **22** | Capability & Enablement Index | Capability & Enablement | 3 | 87.7% | 10.7% | 1.7% |
| **24** | Performance Feedback Quality Index | Performance Feedback & Development | 3 | 90.3% | 8.7% | 1.0% |
| **25** | Meaningful Contribution Index | Purpose & Meaningful Contribution | 3 | 90.7% | 7.7% | 1.7% |
| **27** | Intent to Stay Index | Employee Commitment | 3 | 80.0% | 15.0% | 5.0% |

---

---

## 🗂️ 5. Kamus Kolom Berkas Impor CSV & Ekspor Evidence

### 5.1 Berkas Template CSV Standar
Header berkas CSV yang diunduh dari sistem berformat:
```csv
nip,employee_name,cimb_email,directorate,division,metric_id,metric_name,q1_...,q2_...,...,verbatim_feedback,survey_date
```

| Nama Kolom | Status | Tipe | Contoh Nilai | Keterangan & Validasi |
| :--- | :---: | :---: | :--- | :--- |
| **`nip`** | **Mandatory** | String | `8801245` | NIP Karyawan (kunci unik responden, wajib diisi). |
| **`employee_name`** | Opsional | String | `Budi Setiawan` | Nama lengkap koresponden. |
| **`cimb_email`** | Opsional | String | `budi.setiawan@cimbniaga.co.id` | Alamat email resmi. |
| **`directorate`** | Opsional | String | `Operations, Technology, Analytics & AI` | Direktorat tempat bertugas (salah satu dari 12 direktorat riil sejak v2.31.0; nama berkoma diapit tanda kutip ganda di CSV). |
| **`division`** | Opsional | String | `Core Banking Dev` | Unit kerja spesifik. |
| **`metric_id`** | **Mandatory** | Integer | `7` | ID Metrik survei (1-27). |
| **`metric_name`** | Opsional | String | `Day 1 Onboarding Satisfaction Index` | Nama metrik deskriptif. |
| **`q1_...` s/d `qN_...`** | **Sesuai Tipe** | Desimal/Teks | `5.0` atau `"Ya"` | Nilai jawaban per butir pertanyaan. Tipe `PERCENTAGE` (sejak v2.50.0): 0-100, akhiran `%` dan koma desimal diterima (`92`, `92%`, `92,5`); di luar 0-100 atau bukan angka -> baris ditolak. |
| **`verbatim_feedback`**| Opsional | Teks | `Fasilitas sangat siap!` | Saran, apresiasi, atau kritik terbuka. |
| **`survey_date`** | Opsional | YYYY-MM-DD | `2026-03-25` | Tanggal pelaksanaan survei. |

### 5.2 Berkas Ekspor Audit Evidence (`/api/surveys/evidence`)
Menghasilkan berkas CSV berstandar UTF-8 BOM yang memuat kolom audit:
`Tanggal_Survei_Dilakukan, NIP, Nama_Karyawan, Email_CIMB, Direktorat, Divisi, ID_Metrik, Nama_Metrik, [Kolom Pertanyaan Q1..QN], Rata_Rata_Skor, Indeks_Normalisasi_Persen, Komentar_Verbatim_Feedback, Sumber_Data`

Untuk metrik ESS (sejak v2.32.0) evidence berisi baris ringkasan tersimpan semua periode (`Evidence_ESS_Summary_Metric_<id>.csv`, parameter `period` diabaikan):
`Directorate, Level, Year, Month, Participation, Index_%, [<teks pertanyaan> (%) ...], Metric_ID, Metric_Name, Upload_ID, File_Name, Uploaded_By, Uploaded_At`. PIC hanya mendapat baris direktorat dalam cakupannya (tanpa baris Bankwide).

**Versi set pertanyaan (sejak v2.50.0)**: setiap baris diekspor dengan pertanyaan yang tersimpan bersama upload-nya (snapshot `px_survey_uploads.questions_snapshot_json`; baris ESS: snapshot per pertanyaan di `questions_json`). Batch SYSTEM dari sebelum v2.50.0 tidak punya snapshot dan memakai konfigurasi Manage Questions saat ini (`CURRENT_CONFIG`); baris ESS lama memakai teks header file-nya (`FILE_HEADER`). Bila baris yang diekspor berasal dari satu versi set pertanyaan -> satu CSV seperti sebelumnya; lebih dari satu -> berkas **`.zip`** berisi satu CSV per versi (`<nama dasar>_v<n>_<YYYY-MM-DD>_to_<YYYY-MM-DD>.csv`, satu tanggal bila awal = akhir; versi 1 = tertua; nama `.zip` = `<nama dasar>.zip`, mis. `Evidence_Survey_Metric_8_2026.zip` / `Evidence_ESS_Summary_Metric_9.zip`) + `README.txt` (tanggal upload, jumlah baris, sumber, dan daftar pertanyaan tiap versi). Header kolom pertanyaan CSV SYSTEM tetap `<key>_<label>` (perubahan teks hanya terlihat di README); header CSV ESS memuat teks pertanyaan. Export semua metrik (`metric_id=ALL`) tidak berubah (selalu satu CSV).

### 5.3 Berkas Ringkasan ESS (.xlsx) dan Tabel `px_ess_results` (sejak v2.32.0)

Satu file = satu metrik ESS dan satu periode; aturan lengkap ada di `docs/SURVEY_IMPORT_GUIDE.md`.

| Kolom file | Field tersimpan | Tipe | Keterangan |
| :---: | :--- | :--- | :--- |
| A Directorate | `org_level`, `directorate` | `BANKWIDE` / `DIRECTORATE`, nama direktorat | Baris "PT Bank CIMB Niaga ..." atau Level `Bankwide` -> `BANKWIDE` dengan `directorate` NULL; selain itu nama direktorat master. |
| B Level | (validasi saja) | teks | `Bankwide` / `Directorate` / kosong. |
| C Year, D Month | `survey_year`, `survey_month` | integer | Sama untuk semua baris. |
| E Participation | `participation` | integer >= 0 | Dipakai sebagai `sample_size` / `total_respondents`. |
| F <nama index> | `index_score` | desimal 0-100 | Skor metrik; pecahan 0-1 dikali 100. |
| G.. <pertanyaan> | `questions` (`questions_json`) | JSON | Sejak v2.50.0 kolom dipetakan **menurut posisi** ke pertanyaan Manage Questions (G = pertanyaan 1, H = pertanyaan 2, ...); jumlah kolom bernilai harus sama dengan jumlah pertanyaan terkonfigurasi. Disimpan per pertanyaan `{ key, label, text, type, order, file_label, score }` (snapshot pertanyaan saat upload; `file_label` = teks header file, hanya untuk audit; `score` 0-100 atau `null`). Baris dari sebelum v2.50.0: `[{label, score}]` dengan `label` = teks header file, dibaca menurut posisi. |
| - | `upload_id`, `metric_id`, `created_at` | - | `upload_id` = batch di `px_survey_uploads` (riwayat; sejak v2.50.0 dengan `questions_snapshot_json`). |

### 5.4 Berkas Exit Interview "Termination Report" (.xlsx) dan Tabel `px_exit_interviews` (sejak v2.38.0)

Satu file = satu atau beberapa bulan exit karyawan (satu baris per exit), diunggah Admin di tab **Exit Interview** (`POST /api/exit-interview/upload`, lihat `docs/04` "Catatan v2.38.0"). Template: `GET /api/exit-interview/template` (`Template_Exit_Interview.xlsx`: baris 1 judul, baris 2 nama kolom, baris 3 contoh yang harus dihapus). Data ini **tidak** masuk skor metrik 26 (Exit Survey) maupun PX Index; hanya untuk dashboard Exit Interview.

**Layout yang dibaca** (`exitInterviewService.validateExitSheet`): baris header = baris pertama (dari 30 baris teratas) yang berisi sel `NIK`. Mulai kolom NIK diambil 33 kolom standar berurutan (A..AG pada template); kolom A-G dicek namanya, kolom H..AG diambil menurut posisi (teks pertanyaan boleh berubah). Kolom `Directorate`/`Direktorat` dan `Division`/`Divisi`/`Sub Directorate` dikenali dari namanya di posisi mana pun (template: AH dan AI) dan tidak ikut dihitung sebagai kolom standar.

| Kolom | Isi (header template) | Field tersimpan | Validasi / normalisasi | Dipakai di |
| :---: | :--- | :--- | :--- | :--- |
| A | NIK | `nik` | wajib, maks 50 karakter; NIK + tanggal tidak boleh ganda dalam satu file | kunci upsert `(nik, effective_date)` |
| B | EMP NAME | `employee_name` | maks 200 | export saja |
| C | Effective Resignation Date | `effective_date` | wajib; serial Excel, `YYYY-MM-DD`, `dd/mm/yyyy`, `dd-mm-yyyy`, `dd.mm.yyyy`; 2000-2100 | filter periode YTD/MTD |
| D | LEAVING REASON | `leaving_reason` | huruf besar, spasi/strip -> `_` | `NORMAL_RESIGNATION` = voluntary |
| E | LEAVING REASON DETAIL | `leaving_reason_detail` | sama dengan D | Kartu 1; `MOVE_COMPANY`/`BETTER_OFFER` = mover |
| F | Grade | `grade` | maks 20 | export saja |
| G | SCORE FACTOR | `score_factor` | maks 20 | export saja |
| H | pindah ke perusahaan bank/non-bank | `destination_industry` | maks 500 | Kartu 2 (Financial = "Perbankan / Asuransi / Keuangan Lainnya"), Kartu 3 |
| I | nama perusahaan baru | `new_company`, `new_company_std` | maks 500; `new_company_std` = nama standar dari alias saat impor | Kartu 3 (distandarkan ulang saat dibaca) |
| J | posisi di perusahaan baru | `new_position` | maks 500 | export saja |
| K | komponen kompensasi/benefit yang lebih menarik (multi) | `pull_factors` | maks 4000; opsi dipisah `\|` | Kartu 4 |
| L | komponen yang perlu ditingkatkan (bukan pindah) | `improve_factors` | maks 4000 | export saja |
| M | apa yang ditawarkan perusahaan baru (multi) | `new_company_offers` | maks 4000 | Slide 2 A |
| N | faktor internal lain (multi) | `internal_factors` | maks 4000 | Slide 2 B |
| O..AC | 15 pernyataan karier | `career_scores` (`career_scores_json`) | bilangan bulat 1-6 atau `-`/kosong; NULL bila tidak ada yang diisi | Kartu 5, pembagian negatif/positif Slide 2 B |
| AD | CIMB Niaga Alumni Network | `alumni_network` | `Yes`/`Ya`/`Y` atau `No`/`Tidak`/`N`; `-`/kosong = NULL | export saja |
| AE | persetujuan Kebijakan Privasi | `privacy_consent` | sama dengan AD | export saja |
| AF | merekomendasikan Bank CIMB Niaga | `recommend` | sama dengan AD | Kartu 6 |
| AG | saran atau masukan | `suggestions` | maks 4000 | export saja |
| AH | Directorate | `directorate` | **wajib**; harus ada di master direktorat (tidak peka huruf besar/spasi) | filter direktorat, cakupan USER |
| AI | Division | `division` | opsional; harus divisi dari direktorat baris itu | filter divisi |
| - | - | `upload_id`, `source`, `created_at`, `updated_at` | `source` = `UPLOAD` / `TEMPLATE_IMPORT` / `SEED_DUMMY` | riwayat, export |

Teks `-` atau kosong disimpan sebagai NULL. Satu kesalahan di baris mana pun menolak seluruh file (`errors: [{ row_number, column, reason }]`), tidak ada yang tersimpan. Jawaban yang dianggap "tidak menjawab" (mis. `tidak ada`, `n/a`, `confidential`, `tidak pindah...`) diatur di setting `exit_interview_none_answers`.

**Ekspor CSV Admin** (`GET /api/exit-interview/export`, `Exit_Interview_<YYYY-MM>.csv` atau `Exit_Interview_YTD_<tahun>.csv`, UTF-8 BOM, formula-escape):
`NIK, Employee_Name, Effective_Resignation_Date, Leaving_Reason, Leaving_Reason_Detail, Grade, Score_Factor, Directorate, Division, Destination_Industry, New_Company, New_Company_Standardized, New_Position, Pull_Factors, Improve_Factors, New_Company_Offers, Internal_Factors, Career_S1..Career_S15, Career_Mean, Alumni_Network, Privacy_Consent, Recommend, Suggestions, Source, Upload_ID, Created_At, Updated_At`. Berisi data per karyawan: simpan hanya di lokasi internal.
