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
- **Tabel Log**: Mencatat rincian SLA per Direktorat (IT, Consumer Banking, Commercial, Risk, Finance).

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

Untuk metrik yang bersumber dari ESS, data disajikan dalam format **Spreadsheet Skor Pertanyaan (% Favorable, % Neutral, % Unfavorable)**:

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
| **`directorate`** | Opsional | String | `Information Technology` | Direktorat tempat bertugas. |
| **`division`** | Opsional | String | `Core Banking Dev` | Unit kerja spesifik. |
| **`metric_id`** | **Mandatory** | Integer | `7` | ID Metrik survei (1-27). |
| **`metric_name`** | Opsional | String | `Day 1 Onboarding Satisfaction Index` | Nama metrik deskriptif. |
| **`q1_...` s/d `qN_...`** | **Sesuai Tipe** | Desimal/Teks | `5.0` atau `"Ya"` | Nilai jawaban per butir pertanyaan. |
| **`verbatim_feedback`**| Opsional | Teks | `Fasilitas sangat siap!` | Saran, apresiasi, atau kritik terbuka. |
| **`survey_date`** | Opsional | YYYY-MM-DD | `2026-03-25` | Tanggal pelaksanaan survei. |

### 5.2 Berkas Ekspor Audit Evidence (`/api/surveys/evidence`)
Menghasilkan berkas CSV berstandar UTF-8 BOM yang memuat kolom audit:
`Tanggal_Survei_Dilakukan, NIP, Nama_Karyawan, Email_CIMB, Direktorat, Divisi, ID_Metrik, Nama_Metrik, [Kolom Pertanyaan Q1..QN], Rata_Rata_Skor, Indeks_Normalisasi_Persen, Komentar_Verbatim_Feedback, Sumber_Data`
