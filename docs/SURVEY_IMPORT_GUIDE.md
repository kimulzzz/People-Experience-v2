# Panduan Download Template & Upload Data Survei Manual (CSV)
**CIMB Niaga People Experience Framework**

---

## 📌 Ringkasan Fitur
Modul **Survey Data Center** memungkinkan tim HR untuk mengunduh template format CSV standar dan mengunggah data hasil survei (baik survei periodik, survei onboarding, exit interview, maupun employee sentiment survey) secara massal. Sistem secara otomatis memvalidasi data, menghitung rata-rata skor, dan memperbarui **PE Index** secara real-time tanpa perlu entri manual satu per satu.

> **Sejak v2.32.0 metrik ESS tidak lagi menerima CSV.** Metrik dengan Survey Source **ESS Template** (saat ini 9, 13, 15, 16, 17, 18, 21, 22, 24, 25, 27) hanya menerima **ringkasan hasil ESS dalam Excel (.xlsx)** - lihat bagian [Hasil ESS: Upload Ringkasan Excel](#-hasil-ess-upload-ringkasan-excel-xlsx-sejak-v2320) di bawah. CSV hanya untuk metrik survei **System**.

---

## 📋 Kamus Data & Spesifikasi Kolom Template CSV

File template berformat standard CSV (UTF-8) dengan baris header sebagai berikut:

```csv
nip,employee_name,cimb_email,directorate,division,metric_id,metric_name,rating_score,verbatim_feedback,survey_date
```

| Nama Kolom | Wajib / Opsional | Tipe Data | Contoh Nilai | Deskripsi & Aturan Validasi |
| :--- | :---: | :---: | :--- | :--- |
| **`nip`** | **Wajib** | String | `8801245` | Nomor Induk Pegawai responden (4–15 karakter alfanumerik). Tidak boleh kosong. |
| **`employee_name`** | Opsional | String | `Dimas Setiawan` | Nama lengkap karyawan responden. |
| **`cimb_email`** | Opsional | Email | `dimas.setiawan@cimbniaga.co.id` | Alamat email resmi CIMB Niaga. |
| **`directorate`** | Opsional | String | `Operations, Technology, Analytics & AI` | Nama direktorat tempat karyawan bertugas (salah satu dari 12 direktorat riil sejak v2.31.0). Nama yang mengandung koma wajib diapit tanda kutip ganda di CSV, mis. `"Strategy, Finance & SPAPM"`. |
| **`division`** | Opsional | String | `Application Development` | Nama divisi atau unit kerja. |
| **`metric_id`** | **Wajib** | Integer | `8` | ID Metrik survei (1–27) yang diukur. |
| **`metric_name`** | Opsional | String | `New Joiner Onboarding Journey` | Nama deskriptif metrik. |
| **`rating_score`** | **Wajib** | Desimal | `4.85` | Nilai skor survei. Skala 1.0–5.0 untuk metrik rating bintang, atau 0–100 untuk metrik persentase. |
| **`verbatim_feedback`** | Opsional | Text | `Materi sangat aplikatif!` | Komentar, masukan, atau kritik dari karyawan (otomatis memperkaya insight AI). |
| **`survey_date`** | Opsional | Date (YYYY-MM-DD) | `2026-03-20` | Tanggal pengisian survei oleh karyawan. |

---

## 🎯 Daftar 20 Metrik Survei dalam Sistem

> Tabel ini daftar lama (nama dan skala bisa sudah berbeda dari data saat ini; nama terkini ada di Admin Parameters / Explore Metrics). Metrik ESS di antaranya tidak lagi diisi lewat CSV sejak v2.32.0.

| ID | Nama Metrik | Journey | Skala Input | Target Minimum |
| :---: | :--- | :---: | :---: | :---: |
| **2** | CIMB Niaga Goes to Campus — event evaluation / rating | Arrival | `1.0 - 5.0` | > 4.00 / 5 |
| **4** | Candidate experience - Selection Stage | Arrival | `1.0 - 5.0` | > 4.00 / 5 |
| **5** | Candidate experience - Offering Stage | Arrival | `1.0 - 5.0` | > 4.00 / 5 |
| **6** | Candidate experience - Pre-boarding Stage | Arrival | `1.0 - 5.0` | > 4.00 / 5 |
| **7** | New Joiner Experience — Day 1 Onboarding | Arrival | `1.0 - 5.0` | > 4.00 / 5 |
| **8** | New Joiner Experience — Onboarding Journey (30, 60, 90 Days) | Connect | `1.0 - 5.0` | > 4.00 / 5 |
| **9** | New Joiner Experience — Direct Supervisor Support & Role Clarity | Connect | `1.0 - 5.0` | > 4.00 / 5 |
| **10** | Internal Transition Experience (Promotion, Rotation, Transfer) | Connect | `1.0 - 5.0` | > 4.00 / 5 |
| **12** | Signature Program event satisfaction (Perspektif, D&I, Young, EVD) | Belong | `1.0 - 5.0` | > 4.00 / 5 |
| **13** | Arjuna Recognition Experience & Sentiment | Belong | `1.0 - 5.0` | > 4.00 / 5 |
| **15** | Employee Wellbeing Index (Physical, Mental, Financial) | Belong | `1.0 - 5.0` | > 4.00 / 5 |
| **16** | Psychological Safety Index | Belong | `1.0 - 5.0` | > 4.00 / 5 |
| **17** | Leadership Connection & Communication Index | Belong | `1.0 - 5.0` | > 4.00 / 5 |
| **18** | Learning & Growth Experience (Training, e-Learning, Workshop) | Contribute | `1.0 - 5.0` | > 4.00 / 5 |
| **20** | Mentoring & Coaching Experience | Contribute | `1.0 - 5.0` | > 4.00 / 5 |
| **21** | Performance & Career Dialogue Experience | Contribute | `1.0 - 5.0` | > 4.00 / 5 |
| **22** | Meaningful Contribution & Purpose Index | Contribute | `1.0 - 5.0` | > 4.00 / 5 |
| **23** | Talent Retention & High Potential Experience | Contribute | `1.0 - 5.0` | > 4.00 / 5 |
| **24** | Resignation / Exit Experience | Depart | `1.0 - 5.0` | > 4.00 / 5 |
| **25** | Exit Reasons / Positive Sentiment Index | Depart | `1.0 - 5.0` | > 4.00 / 5 |

---

## 🛠️ Langkah-Langkah Menggunakan Fitur

### 1. Mengunduh Template CSV
1. Klik tombol **"Import Survei (CSV)"** di bar navigasi atas atau tombol download template di baris metrik tab **Simulator & Kalkulator**.
2. Pilih metrik spesifik yang ingin diisi (misal: *#8 - Onboarding Journey 30/60/90 Days*) atau pilih **Master Template** untuk mengisi semua metrik survei **System** sekaligus (sejak v2.32.0 metrik ESS tidak ada di template master; baris CSV ber-`metric_id` ESS ditolak per baris).
3. Klik **"Download Template CSV"**. File template `.csv` otomatis tersimpan ke komputer Anda dengan baris contoh yang sudah terisi.

### 2. Mengisi Data di Microsoft Excel / Google Sheets
1. Buka file CSV di Excel / text editor.
2. Masukkan data respon survei karyawan.
3. Pastikan kolom `nip`, `metric_id`, dan `rating_score` terisi dan sesuai skala (misal nilai rating antara 1.0 hingga 5.0).
4. Simpan kembali file dalam format **CSV (Comma Delimited) (*.csv)**.

### 3. Mengunggah File & Menghitung Ulang Skor
1. Buka kembali modal **Survey Data Center**, pilih tab **"2. Upload Data Survei"**.
2. Seret file CSV Anda ke area upload atau klik untuk memilih file dari komputer.
3. Klik tombol **"Proses CSV & Hitung Ulang PE Index"**.
4. Sistem akan:
   - Memvalidasi setiap baris data (menampilkan baris valid vs baris bermasalah).
   - Menghitung nilai rata-rata respon baru untuk metrik terkait.
   - Mengonversi nilai ke persentase normalisasi ($avg / 5.0 \times 100\%$).
   - Menghitung ulang **Survey Index (70%)** dan skor akhir **PE Index**.
   - Memasukkan feedback verbatim ke ringkasan *Action Recommendation AI*.

---

## 📊 Hasil ESS: Upload Ringkasan Excel (.xlsx) (sejak v2.32.0)

Metrik ESS diisi dari **ringkasan hasil survei**, bukan jawaban per responden. Satu file = satu metrik dan satu periode. Contoh file nyata: `docs/ESS 2025 Result_Role Clarity & DS Support.xlsx` (metrik 9, Role Clarity & DS Support Score Index).

### Tata letak (sheet pertama, baris 1 = header)

| Kolom | Header baris 1 | Isi per baris | Aturan |
| :---: | :--- | :--- | :--- |
| **A** | `Directorate` (atau `Direktorat`) | Nama unit | Baris yang diawali "PT Bank CIMB Niaga" (mis. `PT Bank CIMB Niaga Tbk`) = baris **Bankwide**. Baris lain harus nama direktorat dari master (12 direktorat sejak v2.31.0); spasi ganda dan huruf besar/kecil tidak berpengaruh. Divisi tidak didukung. |
| **B** | `Level` | `Bankwide` / `Directorate` / kosong | Nilai lain ditolak. Perhatian: baris ber-Level `Bankwide` diperlakukan sebagai baris Bankwide apa pun isi kolom A. |
| **C** | `Year` (atau `Tahun`) | mis. `2025` | Bilangan bulat 2000-2100. |
| **D** | `Month` (atau `Bulan`) | mis. `November` | Nama bulan Inggris/Indonesia, singkatan 3 huruf, atau angka 1-12. |
| **E** | `Participation` (atau `Partisipasi`) | mis. `7756` | Bilangan bulat >= 0. |
| **F** | nama index (bebas, wajib diisi) | mis. `0.92` atau `92` | **Skor metrik.** Pecahan 0-1 dikali 100; nilai > 1 s.d. 100 dianggap persen; teks `"92%"` dibaca sebagai persen. Nilai `1` = 100%. |
| **G, H, ...** | teks pertanyaan | skor per pertanyaan | Opsional, format sama dengan F; sel kosong = tanpa skor. Pertanyaan dicocokkan ke pertanyaan yang dikonfigurasi lewat **teks**; bila teksnya berbeda, detail metrik menampilkannya sebagai "Question N". |

Contoh (nilai dari file user):

| Directorate | Level | Year | Month | Participation | Role Clarity & DS Support Index | ... |
| :--- | :--- | :---: | :--- | :---: | :---: | :--- |
| PT Bank CIMB Niaga Tbk | Bankwide | 2025 | November | 7756 | 0.92 | ... |
| Business Banking | Directorate | 2025 | November | 449 | 0.91 | ... |

### Aturan file
- **Baris Bankwide** dianjurkan. Bila tidak ada, nilai Bankwide dihitung dari baris direktorat (rata-rata berbobot partisipasi).
- **Semua baris harus periode yang sama** (Year + Month).
- **Unggah ulang** metrik + periode yang sama **mengganti** seluruh baris periode itu; upload lama tetap tercatat di riwayat.
- **Satu error = file ditolak seluruhnya** (HTTP 400), semua error ditampilkan beserta baris dan kolomnya, dan tidak ada yang disimpan.
- Hanya **`.xlsx`**. CSV dan format lama `.xls` ditolak untuk metrik ESS; file `.xlsx` ke metrik System juga ditolak. Formula tidak dihitung ulang: yang dibaca adalah nilai tersimpan Excel, jadi file harus disimpan di Excel sebelum diunggah.

### Daftar validasi (alasan penolakan)
- Header A-E tidak sesuai, atau header F kosong.
- Direktorat tidak ada di master; direktorat atau baris Bankwide muncul lebih dari sekali.
- Level selain `Bankwide` / `Directorate` / kosong.
- Year bukan 2000-2100; Month tidak dikenali; Year/Month berbeda antar baris.
- Participation bukan bilangan bulat >= 0.
- Skor F kosong; skor bukan angka atau di luar 0-100; sel error Excel (mis. `#DIV/0!`); sel formula tanpa nilai tersimpan.
- Kolom berisi nilai tetapi tanpa teks pertanyaan di baris 1.
- Sheet tanpa baris data; file bukan workbook `.xlsx` (walau berakhiran `.xlsx`).

### Langkah
1. Di Explore Metrics atau detail metrik ESS, klik **Template (.xlsx)** (file `Template_ESS_Metric_<id>.xlsx`: header lengkap dengan nama index dan pertanyaan aktif, baris Bankwide dan satu baris per direktorat master, nilai kosong).
2. Isi Year, Month, Participation, index (F) dan skor pertanyaan, lalu simpan sebagai **Excel Workbook (*.xlsx)**. Hapus baris direktorat yang tidak punya data: baris yang hanya berisi nama + Level ditolak (Year/Month/Participation/F kosong).
3. Klik **Upload** pada metrik itu, pilih file `.xlsx`, lalu **Process ESS Summary & Recalculate PX Index**. Hasil: periode, jumlah baris, index Bankwide, dan keterangan bila upload periode yang sama diganti.

### Cara skor dipakai
- Dashboard/Explore Metrics memakai hasil ESS **terakhir yang periodenya <= akhir periode yang dilihat**, termasuk dari tahun sebelumnya (mis. YTD 2026 memakai hasil November 2025 sampai ada hasil 2026).
- Tanpa filter direktorat = baris Bankwide; filter direktorat = baris direktorat itu; filter divisi = baris direktorat induknya; akun User dengan beberapa direktorat = rata-rata berbobot partisipasi dari direktorat dalam cakupannya.
- Ukuran sampel = Participation. Ringkasan ESS hanya memuat % favorable; neutral/unfavorable tidak tersedia.

---

## 🔒 Keamanan & Air-Gapped Compliance
- Seluruh pemrosesan file CSV berjalan 100% di server lokal (On-Premise).
- Tidak ada data NIP atau data karyawan yang dikirim ke cloud pihak ketiga.
