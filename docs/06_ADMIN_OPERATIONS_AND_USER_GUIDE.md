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
- **Dokumentasi Foto/Video & Transkrip AI**: Di bagian *Photo Gallery & Event Documentation* klik **Upload Photo / Video** (foto JPG/PNG/GIF/WEBP atau video MP4/MOV/WEBM, maks. 200 MB). Foto dan video langsung bisa dilihat/diputar di kartu (atau diperbesar lewat tombol *Perbesar*). Untuk video, sistem otomatis membuat **transkrip teks Bahasa Indonesia** lewat API transkrip lokal — prosesnya bisa beberapa menit (kartu menampilkan "sedang diproses" dan terisi sendiri). Buka *Transkrip AI lengkap* untuk membaca per segmen; klik sebuah baris untuk memutar video dari bagian itu. Jika gagal (mis. API transkrip belum dijalankan), klik **Coba lagi** setelah API aktif di `http://127.0.0.1:8000`. Setelah transkrip selesai, video **baru** otomatis mendapat **AI Summary** (lihat bagian "AI Summary Video" di bawah).

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

---

## 📧 Mengatur Email Pengirim Reminder PIC (v2.23.0)

1. Klik **Setting Email** di Header.
2. **Gmail (sementara/uji coba)**: pilih provider *Gmail*, isi alamat Gmail, lalu isi **App Password** — bukan password akun biasa. Cara: akun Google → Keamanan → aktifkan *Verifikasi 2 Langkah* → *Sandi aplikasi* → buat satu → salin 16 karakternya ke kolom password.
3. **SMTP internal (target akhir, sesuai kebijakan on-premise)**: pilih provider *SMTP Server*, isi host, port, TLS, akun, dan password dari tim infrastruktur.
4. Centang **Aktifkan**, klik **Simpan**, lalu **Kirim Email Test** (default ke email pengirim sendiri) dan periksa kotak masuk.
5. Setelah aktif, reminder ke PIC (pengecekan harian otomatis + tombol *Kirim Reminder* di Parameter Admin) memakai akun ini. Password tersimpan terenkripsi di database dan tidak pernah ditampilkan kembali.

---

## ⏰ Cara Kerja Reminder Otomatis Upload Survei (v2.24.0)

1. Di **Parameter Admin → Edit Metrik (SURVEY)**: aktifkan *upload manual*, isi **Batas Tanggal Upload** (mis. 10), **Nama PIC** dan **Email PIC**.
2. Di **Setting Email**: isi akun pengirim & aktifkan; atur *jam mulai kirim* (default 08:00) dan *ulangi setiap N hari* (default 1; 0 = hanya sekali).
3. Setiap hari, mulai tanggal batas, sistem memeriksa tabel survei metrik itu: **adakah data bertanggal survei di bulan SEBELUMNYA?** Contoh: tanggal batas 10, hari ini 10 Oktober → cari data September. Bila **tidak ada**, PIC otomatis diemail ("data survei September 2026 belum ada"); bila ada, tidak ada email.
4. Email diulang sesuai pengaturan sampai data periode itu terunggah. Tidak ada email ganda pada hari yang sama meski server di-restart; bila server mati pada tanggal batas, email dikirim begitu server hidup kembali.
5. Pantau di **Setting Email → Riwayat Reminder Terkirim** dan panel peringatan di Parameter Admin; tombol **Kirim Reminder Sekarang** mengirim manual ke semua PIC yang masih pending.

> Metrik **Tahunan** diingatkan pada tanggal+bulan batas tahun itu bila belum ada data bertanggal tahun tersebut. Data bulan berjalan tidak dihitung untuk metrik bulanan.

---

## 🔐 Login, Akun & Kelola User (v2.26.0)

**Membuat Admin pertama** (sekali, setelah instalasi / pada database baru):
1. Di folder proyek jalankan `npm run auth:create-admin` (opsi: `-- --username 8801923 --name "Nama" --email nama@...`; default username `admin`).
2. Catat **password sementara** yang tampil di konsol — hanya muncul sekali. Tidak ada password bawaan di kode/repo; namun bila env `DEFAULT_INITIAL_PASSWORD` di `.env` terisi (opsional, v2.27.2), password awal standar itulah yang dipakai (tidak dicetak di konsol) dan tetap wajib diganti saat login pertama. Login dengan akun itu; aplikasi langsung meminta ganti password (min 10 karakter, ada huruf dan angka).
3. Lupa password Admin / semua Admin terkunci: `npm run auth:create-admin -- --username <akun> --reset-password`.

**Kelola User** (menu Header, hanya Admin):
- **Tambah user**: isi username/NIP, nama, email (opsional), role. Role **User** wajib memiliki minimal satu cakupan data (lihat bawah); role **Admin** tidak terikat cakupan. Setelah disimpan, **password sementara tampil sekali** — salin dan sampaikan ke yang bersangkutan; saat login pertama ia wajib menggantinya. Bila `DEFAULT_INITIAL_PASSWORD` terisi, yang tampil adalah password awal standar dengan catatan "Password awal standar — wajib diganti saat login pertama". **Risiko**: sebelum pemilik akun login pertama, siapa pun yang tahu password awal itu dapat masuk ke akun tersebut — minta ganti segera. Password pengganti tetap harus lolos kebijakan dan tidak boleh sama dengan password awal.
- **Reset password**: password sementara baru (sekali tampil; password awal standar bila env terisi). Reset juga **membuka kunci akun** dan mengeluarkan semua sesi user itu.
- **Kunci akun**: 5 kali salah password berturut-turut mengunci akun 15 menit; Admin dapat membukanya lewat reset password. Batas dapat diubah di setting `login_max_attempts` / `login_lockout_minutes`.
- **Nonaktifkan / ganti role**: mematikan sesi user tersebut. Anda tidak bisa menonaktifkan/menurunkan akun sendiri atau Admin aktif terakhir. Tombol hapus akun belum tersedia di UI — gunakan nonaktifkan.
- **Riwayat**: panel audit menampilkan login berhasil/gagal/terkunci, logout, dan perubahan akun (tanpa password).

**Hak akses User**: melihat data direktoratnya (metrik non-karyawan tampil sebagai angka bankwide read-only), tanpa data per responden, tanpa menu admin/upload; Signature Event hanya baca kecuali User dari direktorat pengelola event (setting `event_manager_directorates`, default Human Resources — belum ada menu UI untuk mengubahnya). Cakupan data diatur seperti di bawah (sejak v2.27.0 divisi ikut menyaring data).

**Mengatur cakupan data User** (v2.27.0, di form tambah/ubah user):
1. Pilih role **User**, lalu di "Cakupan Data" pilih direktorat dari dropdown "+ Tambah direktorat ke cakupan". Ulangi untuk direktorat lain (satu User boleh banyak direktorat).
2. Untuk tiap direktorat pilih **Semua divisi** atau **Divisi tertentu** lalu centang divisi yang boleh dilihat. Hapus direktorat dengan ikon tempat sampah.
3. Simpan. Perubahan berlaku pada request User berikutnya — User tidak perlu login ulang. Perubahan tercatat di riwayat audit sebagai `USER_SCOPE_CHANGE`.

Yang dilihat User: pilihan filter "Semua cakupan saya" menampilkan **data gabungan** seluruh cakupan (sampel digabung, bukan rata-rata dari rata-rata). Skor, trend, detail metrik, alert, dan absensi/feedback event dibatasi ke cakupan; metrik non-karyawan/OUTCOME tetap tampil sebagai angka bankwide read-only. User yang cakupannya memuat direktorat pengelola event (setting `event_manager_directorates`, default Human Resources) dapat mengelola Signature Event. Mengubah role ke Admin menghapus cakupan; menurunkan ke User wajib mengisi cakupan.

**Deployment**: sebaiknya di belakang reverse proxy HTTPS on-premise dengan `TRUST_PROXY` di `.env` (cookie sesi menjadi `Secure`). Sesi berlaku 8 jam (`session_hours`).

## 🧑‍💼 Menjadikan Akun User sebagai PIC Metrik (v2.27.1)

1. Buat akun **User** di **Kelola User** dan **isi emailnya** (opsional di form, tetapi wajib agar akun bisa menjadi PIC).
2. Buka **Parameter Admin** → metrik SURVEY yang diupload manual → isi **Email PIC** dengan email akun tadi (huruf besar/kecil tidak berpengaruh). Penetapan PIC tetap lewat sini; tidak ada pengaturan PIC di Kelola User. Bila tidak ada akun aktif ber-email itu, muncul peringatan "PIC belum punya akun login".
3. Berlaku **langsung** pada request berikutnya — tanpa login ulang. Mengubah Email PIC, email akun, atau menonaktifkan akun mencabut/memberi hak dengan cara yang sama. Kelola User menampilkan "PIC metrik" tiap akun.

Yang bisa dilakukan PIC, hanya untuk metrik miliknya: unduh template, **upload CSV** (metrik ditentukan dari form; kolom `metric_id` di CSV diabaikan), lihat riwayat upload, unduh evidence, dan lihat identitas responden. Untuk metrik karyawan, identitas/evidence hanya responden dalam **cakupan direktorat/divisi akun PIC**. Hasil upload PIC tidak menampilkan PE Index bankwide. Setiap upload tercatat di riwayat audit (`SURVEY_UPLOAD`) dan di riwayat batch sebagai `Nama (username)`. Reminder email tetap ke Email PIC.

Perhatian (belum diputuskan): importer belum menolak NIP kembar dalam satu CSV atau antar-batch, dan PIC dapat mengunggah baris di luar cakupannya (tersimpan, terlihat oleh Admin, tidak oleh PIC); tanggal survei tidak valid disimpan sebagai hari ini.

---

## 🤖 AI Summary Video & Instalasi Ollama + Gemma (v2.28.0)

### Cara kerja
- Setiap video **baru** yang transkripnya selesai otomatis diringkas oleh model lokal **Gemma 3 4B** (Ollama di mesin yang sama; tidak ada data keluar). Kartu video menampilkan blok **AI Summary**: ringkasan, poin utama, dan label sumber.
- **Label sumber**: `AI • gemma3:4b` = jawaban model yang lolos pemeriksaan otomatis; **Otomatis (aturan)** = model gagal/mati atau jawabannya ditolak pemeriksaan (angka, nama, atau bahasa tidak sesuai transkrip), sehingga sistem menampilkan kalimat yang diambil langsung dari transkrip. Ringkasan AI **dibuat otomatis — selalu periksa kembali dengan transkrip**; pemeriksaan otomatis tidak menjamin ketepatan makna (nuansa dan penafian bisa keliru).
- Transkrip kurang dari 20 kata tidak diringkas ("Transkrip belum cukup").
- Pembuatan bisa sekitar satu menit atau lebih (CPU); kartu terisi sendiri.
- **Tombol "Buat / Buat ulang ringkasan"** (hanya Admin/pengelola event): muncul bila video belum punya ringkasan, ringkasan gagal, atau hasilnya "Otomatis (aturan)" (mis. setelah Ollama dinyalakan). Ringkasan AI yang sudah jadi tidak punya tombol. Bila sedang diproses/antri, sistem menolak dengan pesan 409.
- Video lama (diunggah sebelum v2.28.0) **tidak** diringkas otomatis; tekan tombol bila perlu. Gemma tidak dipanggil saat membuka halaman, dashboard, alerts, foto, atau PPT; PPT hanya menampilkan ringkasan yang sudah tersimpan.
- Ollama mati tidak menghalangi upload maupun transkrip.

### Memasang Ollama + Gemma (sekali per mesin)
```powershell
winget install Ollama.Ollama
ollama pull gemma3:4b
```
Lalu di `.env` (tidak dikomit): `OLLAMA_MODEL=gemma3:4b`. Opsional: `OLLAMA_HOST` (default `http://localhost:11434`), `OLLAMA_TIMEOUT_MS` (default 300000), `AI_QUEUE_MAX` (default 50). Restart backend. Cek status: `GET /api/health?check_ai=1` (login) -> `local_ai.ollama_status`. Model diunduh sekali dari registri Ollama saat `ollama pull` (satu-satunya akses internet; setelahnya semuanya berjalan lokal) — pada jaringan tertutup, pasang model dari sumber internal sesuai kebijakan TI.
