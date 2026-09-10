# Panduan Download Template & Upload Data Survei Manual (CSV)
**CIMB Niaga People Experience Framework**

---

## 📌 Ringkasan Fitur
Modul **Survey Data Center** memungkinkan tim HR untuk mengunduh template format CSV standar dan mengunggah data hasil survei (baik survei periodik, survei onboarding, exit interview, maupun employee sentiment survey) secara massal. Sistem secara otomatis memvalidasi data, menghitung rata-rata skor, dan memperbarui **PE Index** secara real-time tanpa perlu entri manual satu per satu.

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
| **`directorate`** | Opsional | String | `Information Technology` | Nama direktorat tempat karyawan bertugas. |
| **`division`** | Opsional | String | `Application Development` | Nama divisi atau unit kerja. |
| **`metric_id`** | **Wajib** | Integer | `8` | ID Metrik survei (1–27) yang diukur. |
| **`metric_name`** | Opsional | String | `New Joiner Onboarding Journey` | Nama deskriptif metrik. |
| **`rating_score`** | **Wajib** | Desimal | `4.85` | Nilai skor survei. Skala 1.0–5.0 untuk metrik rating bintang, atau 0–100 untuk metrik persentase. |
| **`verbatim_feedback`** | Opsional | Text | `Materi sangat aplikatif!` | Komentar, masukan, atau kritik dari karyawan (otomatis memperkaya insight AI). |
| **`survey_date`** | Opsional | Date (YYYY-MM-DD) | `2026-03-20` | Tanggal pengisian survei oleh karyawan. |

---

## 🎯 Daftar 20 Metrik Survei dalam Sistem

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
2. Pilih metrik spesifik yang ingin diisi (misal: *#8 - Onboarding Journey 30/60/90 Days*) atau pilih **Master Template** untuk mengisi semua 20 metrik sekaligus.
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

## 🔒 Keamanan & Air-Gapped Compliance
- Seluruh pemrosesan file CSV berjalan 100% di server lokal (On-Premise).
- Tidak ada data NIP atau data karyawan yang dikirim ke cloud pihak ketiga.
