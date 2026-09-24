# 06. Admin Operations & User Guide
**CIMB Niaga People Experience (PE) Framework**

---

## 🎯 1. Pendahuluan & Peran Pengguna (User Roles)

Sistem People Experience melayani dua kelompok peran utama:

1. **HR Executive & System Administrator**:
   - Memonitor pergerakan PE Index, tren bulanan, dan skor journey.
   - Mengatur konfigurasi butir pertanyaan dan format template survei.
   - Menyesuaikan target nilai, ambang batas minimum, dan bobot penilaian.
   - Mengunggah berkas respon survei massal dan mengunduh berkas audit evidence.
   - Mengelola Signature Program Events dan menghasilkan deck presentasi PowerPoint (.pptx).
2. **Karyawan & Peserta Event**:
   - Melakukan absensi kehadiran mandiri pra-event melalui scan QR Code atau link mobile.
   - Mengisi kuesioner evaluasi kepuasan pasca-event secara real-time.

---

## 📝 2. Panduan Mengelola Template Pertanyaan Survei (Admin)

### Langkah 1: Membuka Menu Pengaturan Template
1. Klik tombol **"Template Survei"** pada navbar atas (*Header*), ATAU
2. Klik tombol shortcut **"Atur Pertanyaan Survei (Admin)"** yang terdapat di dalam modal rincian metrik manapun.

### Langkah 2: Memilih Metrik Survei
- Gunakan dropdown **"Pilih Metrik Survei"** di bagian atas modal untuk memilih satu dari 20 metrik bertipe *SURVEY* (misal: *Metrik #7: Day 1 Onboarding satisfaction index*).

### Langkah 3: Mengedit / Menambah Pertanyaan
- **Mengedit Pertanyaan**: Ubah *Label Singkat* atau *Teks Lengkap Pertanyaan* langsung pada kartu pertanyaan.
- **Mengubah Tipe Jawaban**: Pilih salah satu dari 4 tipe:
  - `Skala 1 - 5`: Untuk rating likert 1.0 s/d 5.0.
  - `Skala 1 - 10`: Untuk rating kepuasan 1.0 s/d 10.0.
  - `Jawaban Ya / Tidak`: Untuk pertanyaan biner kepatuhan (Ya = 100%, Tidak = 0%).
  - `Jawaban Free Text`: Untuk saran kualitatif terbuka.
- **Menambah Pertanyaan Baru**: Klik tombol **"+ Tambah Butir Pertanyaan"** di bagian bawah daftar.
- **Mengubah Urutan Kolom**: Gunakan tombol panah **Naik (↑)** atau **Turun (↓)** untuk menyesuaikan urutan kolom pada CSV.
- **Menghapus Pertanyaan**: Klik ikon tong sampah merah pada butir pertanyaan yang ingin dihapus.

### Langkah 4: Menyimpan Konfigurasi / Reset
- Klik tombol **"Simpan Perubahan Template"** untuk menerapkan konfigurasi.
- Jika ingin mengembalikan ke format baku awal CIMB Niaga, klik tombol **"Reset ke Template Standar"**.

---

## 📥 3. Panduan Download Template & Upload Data Survei CSV

### Langkah 1: Mengunduh Template CSV
- Pada tabel *Metrics Explorer* (`Calculator.jsx`), cari metrik survei yang dituju dan klik tombol pill hijau **"Template"**.
- Berkas `.csv` yang diunduh akan otomatis memuat header kolom yang sesuai dengan butir pertanyaan aktif beserta baris panduan format nilai.

### Langkah 2: Mengisi Data Respon Karyawan
Buka berkas CSV di Microsoft Excel atau editor teks dan isi baris data:
- **Kolom `nip`**: Wajib diisi dengan NIP karyawan (misal: `8801245`).
- **Kolom Pertanyaan `q1_...` s/d `qN_...`**:
  - Untuk tipe `SCALE_1_5`: Masukkan angka desimal `1.0` hingga `5.0` (misal: `4.8`).
  - Untuk tipe `SCALE_1_10`: Masukkan angka desimal `1.0` hingga `10.0` (misal: `9.0`).
  - Untuk tipe `YES_NO`: Masukkan `"Ya"` atau `"Tidak"` (sistem juga menerima variasi `"Y"`, `"T"`, `"1"`, `"0"`, `"True"`, `"False"`).
  - Untuk tipe `FREE_TEXT`: Masukkan komentar terbuka (misal: *"Proses onboarding sangat memuaskan"*).
- **Kolom `survey_date`**: Isi dengan format `YYYY-MM-DD` (misal: `2026-03-25`).

### Langkah 3: Mengunggah Berkas CSV
1. Klik tombol pill biru **"Upload"** pada baris metrik, atau klik tombol **"Unggah Survei"** di header.
2. Seret (*drag-and-drop*) berkas CSV ke dalam area unggah, atau klik untuk memilih berkas dari komputer.
3. Klik tombol **"Proses & Import CSV"**.
4. Sistem akan memvalidasi data. Jika sukses, skor PE Index dan question breakdown akan otomatis terkalkulasi ulang secara real-time.

---

## 📑 4. Panduan Ekspor Dokumen Evidence Audit

1. Buka tabel *Metrics Explorer* atau modal rincian metrik.
2. Klik tombol pill ungu **"Evidence"**.
3. Sistem akan menghasilkan berkas `.csv` berformat UTF-8 BOM yang memuat rekaman lengkap seluruh jawaban koresponden, NIP, tanggal survei, dan komentar verbatim yang siap diserahkan kepada auditor internal bank.

---

## 🎤 5. Panduan Manajemen Signature Events & Ekspor PPT

### Langkah 1: Membuat Event Baru
1. Masuk ke tab **"Signature Programs"**.
2. Klik tombol **"+ Buat Event Signature Baru"**.
3. Masukkan Judul Event (misal: *CIMB Perspektif 2026 Q1*), Tanggal Pelaksanaan, Kuota Peserta, dan Lokasi/Platform.

### Langkah 2: Membagikan QR Code / Link Peserta
- **QR Absensi Pra-Event**: Klik tombol QR Absensi untuk menampilkan kode QR di layar proyektor atau membagikan URL `http://.../checkin/:event_id` kepada peserta.
- **QR Evaluasi Pasca-Event**: Di akhir sesi, tampilkan QR Evaluasi agar peserta mengisi rating pembicara, materi, dan kepuasan event.

### Langkah 3: Menghasilkan Executive Report PPT (.pptx)
1. Pada kartu event, klik tombol **"Generate Executive PPT"**.
2. Sistem akan secara otomatis mengompilasi data registrasi, metrik kehadiran, distribusi rating kepuasan, dan kutipan verbatim ke dalam slide deck presentasi PowerPoint siap pakai (.pptx).

---

## ⚙️ 6. Panduan Pengaturan Target, Ambang Batas & Bobot

### 6.1 Mengubah Target & Ambang Batas (Threshold)
1. Klik tombol **"Target & Ambang Batas"** pada navbar atas.
2. Ubah *Target Capaian* dan *Ambang Batas Minimum* untuk metrik yang ingin disesuaikan.
3. Klik **"Simpan Target & Ambang"**.

### 6.2 Mengubah Bobot Konsolidasi & Bobot Journey
1. Klik tombol **"Atur Bobot"** pada navbar atas.
2. Geser slider bobot konsolidasi (default: **70% Survey / 30% Outcome**).
3. Sesuaikan bobot proporsi untuk masing-masing 5 Journey jika diperlukan.
4. Klik **"Simpan Pengaturan Bobot"**.

---

## 🔄 7. Panduan Frekuensi Update Data & Pengingat Upload Survei

Setiap metrik memiliki parameter **"Update Data Berkala"** yang menentukan seberapa sering data
metrik tersebut perlu diperbarui, serta (khusus metrik Survey) pengaturan pengingat email ke PIC
yang bertanggung jawab meng-upload data secara manual.

### 7.1 Frekuensi Update Data
Buka **Parameter Admin → Parameter Metric → Edit** pada metrik yang dituju, lalu pada bagian
*"Update Data Berkala & Pengingat Upload Survei"* pilih salah satu:

| Pilihan | Kapan Dipakai |
| :--- | :--- |
| **Bulanan (Update Berkala Tiap Bulan)** | Metrik yang datanya perlu di-upload/diperbarui setiap bulan (default untuk sebagian besar metrik). |
| **Tahunan (Sekali Upload untuk Full Year)** | Metrik yang cukup diupload sekali dan dipakai untuk kalkulasi sepanjang tahun — contoh default: 11 metrik **ESS (Employee Sentiment Survey)**. |

### 7.2 Pengingat Upload Survei Manual (Reminder Email PIC)
Khusus metrik bertipe **Survey**, tersedia toggle **"Survei ini masih diupload manual oleh PIC"**.
Jika diaktifkan:
1. Isi **Nama PIC Upload** dan **Email PIC (Tujuan Reminder)**.
2. Tentukan **Batas Tanggal Upload** — tanggal (1–28) setiap bulan untuk metrik Bulanan, atau
   bulan + tanggal untuk metrik Tahunan (default: 25 November).
3. Sistem otomatis mendeteksi jika data belum diupload untuk siklus berjalan (bulan ini, atau
   tahun ini untuk metrik Tahunan), dan menandai status:
   - **Segera Jatuh Tempo (DUE_SOON)** — ≤5 hari sebelum batas waktu.
   - **Terlambat (OVERDUE)** — sudah melewati batas waktu.
4. Metrik yang berstatus DUE_SOON/OVERDUE muncul otomatis sebagai **banner kuning** di atas
   tabel Parameter Metric, lengkap dengan tombol **"Kirim Reminder Sekarang"** untuk mengirim
   email ke seluruh PIC terkait via SMTP internal perusahaan (dikonfigurasi lewat variabel
   lingkungan `SMTP_HOST`, dsb. — lihat `.env.example`). Server juga otomatis mengecek dan
   mengirim reminder setiap 24 jam tanpa perlu diklik manual.
5. Jika SMTP belum dikonfigurasi di lingkungan on-premise Anda, reminder tetap terhitung dan
   tercatat di log server — email hanya benar-benar terkirim setelah SMTP diaktifkan.

### 7.3 Tanggal Data Terakhir untuk Metrik Outcome
Untuk metrik bertipe **Outcome** (data dari sistem HR internal, bukan survei manual), field
**Tanggal Data Terakhir** (`last_data_date`) menyimpan kapan data terakhir kali ditarik dari
sistem HR sumbernya (SLA Rekrutmen, Arjuna Recognition, dll.). Field ini tersimpan di database
metrik itu sendiri dan dapat diperbarui via `PUT /api/admin/metrics/:id` — sebelumnya nilai ini
sempat "terkunci" di dalam kode program (bukan database), sehingga admin tidak bisa benar-benar
mengubahnya; sudah diperbaiki di v2.12.0 (lihat `CHANGELOG.md`).
