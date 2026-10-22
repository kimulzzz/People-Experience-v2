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
  - `Percentage (0–100%)` (sejak v2.50.0): nilai persen 0-100. Untuk metrik **ESS** tipe ini wajib: dropdown tipe terkunci dan server selalu menyimpan Percentage.
- **Metrik ESS - urutan = kolom Excel (sejak v2.50.0)**: pertanyaan metrik ESS di Manage Questions menentukan kolom pertanyaan file ringkasan ESS **menurut urutan**: pertanyaan 1 = kolom G, pertanyaan 2 = kolom H, pertanyaan 3 = kolom I, dst. Susun pertanyaan dengan urutan dan jumlah yang sama persis dengan kolom file ESS; teks header di file tidak dipakai. Teks di Manage Questions adalah teks yang tampil di web dan di template.
- **Menambah Pertanyaan Baru**: Klik tombol **"+ Tambah Butir Pertanyaan"** di bagian bawah daftar.
- **Mengubah Urutan Kolom**: Gunakan tombol panah **Naik (↑)** atau **Turun (↓)** untuk menyesuaikan urutan kolom pada CSV.
- **Menghapus Pertanyaan**: Klik ikon tong sampah merah pada butir pertanyaan yang ingin dihapus.

### Langkah 4: Menyimpan Konfigurasi / Reset
- Klik tombol **"Simpan Perubahan Template"** untuk menerapkan konfigurasi.
- Jika ingin mengembalikan ke format baku awal CIMB Niaga, klik tombol **"Reset ke Template Standar"**.

### Apa yang terjadi bila pertanyaan diubah (sejak v2.50.0)
- **Template** dan **tampilan web** langsung memakai pertanyaan baru.
- **Data lama tidak diubah**: setiap upload (CSV System maupun ringkasan ESS) sejak v2.50.0 menyimpan set pertanyaan yang dipakai saat itu. Di detail metrik, data yang diunggah dengan teks lain ditandai catatan kuning "Questions changed since this result was uploaded", dan di bawah pertanyaan yang berubah tampil "At upload: <teks lama>".
- **Evidence**: bila data periode itu berasal dari lebih dari satu versi pertanyaan, unduhan Evidence berupa **`.zip`** berisi satu CSV per versi (dengan teks pertanyaan saat data dikirim) + `README.txt` yang menjelaskan tiap versi. Satu versi = satu CSV seperti biasa.
- Upload dari sebelum v2.50.0 tidak punya catatan pertanyaan: data CSV System lama diekspor dengan pertanyaan saat ini (ditandai di README), hasil ESS lama dengan teks header file aslinya.
- Untuk ESS, mengubah **jumlah** pertanyaan membuat file dengan jumlah kolom lama ditolak; unduh template terbaru.

---

## 📥 3. Panduan Download Template & Upload Data Survei CSV

> Panduan CSV di bawah hanya untuk metrik survei **System**. Metrik **ESS** sejak v2.32.0 diunggah sebagai ringkasan Excel `.xlsx` - lihat bagian "Upload Ringkasan Hasil ESS (.xlsx) (v2.32.0)" di akhir dokumen ini.

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
  - Untuk tipe `PERCENTAGE` (sejak v2.50.0): Masukkan angka `0` hingga `100` (misal: `92`, `92%` atau `92,5`); di luar rentang itu baris ditolak.
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
4. Sejak v2.50.0: bila pertanyaan metrik diubah di antara upload, berkasnya berupa **`.zip`** (satu CSV per versi pertanyaan + `README.txt`), lihat §2 "Apa yang terjadi bila pertanyaan diubah". Nama berkas ditentukan server.

---

## 🎤 5. Panduan Manajemen Signature Events & Ekspor PPT

> Sejak v2.49.0 tab **Signature Program Events** hanya tampil untuk Admin dan User yang diberi menu itu (lihat "Akses Menu per User (v2.49.0)" di akhir dokumen).

### Langkah 1: Membuat Event Baru
1. Masuk ke tab **"Signature Programs"**.
2. Klik tombol **"+ Buat Event Signature Baru"**.
3. Masukkan Judul Event (misal: *CIMB Perspektif 2026 Q1*), Tanggal Pelaksanaan, Kuota Peserta, dan Lokasi/Platform.

### Langkah 2: Membagikan QR Code / Link Peserta
- **QR Absensi Pra-Event**: Klik tombol QR Absensi untuk menampilkan kode QR di layar proyektor atau membagikan URL `http://.../checkin/:event_id` kepada peserta.
- **QR Evaluasi Pasca-Event**: Di akhir sesi, tampilkan QR Evaluasi agar peserta mengisi rating pembicara, materi, dan kepuasan event.
- **Dokumentasi Foto/Video & Transkrip AI**: Di bagian *Photo Gallery & Event Documentation* klik **Upload Photo / Video** (foto JPG/PNG/GIF/WEBP/BMP/AVIF atau video MP4/MOV/WEBM/MKV/AVI dan sejenisnya, maks. 200 MB; SVG dan HEIC ditolak - lihat "Nama File Video & Format Unggahan Media" di bawah). Foto dan video langsung bisa dilihat/diputar di kartu (atau diperbesar lewat tombol *Perbesar*). Untuk video, sistem otomatis membuat **transkrip teks Bahasa Indonesia** lewat API transkrip lokal — prosesnya bisa beberapa menit (kartu menampilkan "sedang diproses" dan terisi sendiri). Buka *Full AI transcript* (dulu "Transkrip AI lengkap") untuk membaca teks lengkap dan per segmen; klik sebuah baris untuk memutar video dari bagian itu. Jika gagal (mis. API transkrip belum dijalankan), klik **Try again** (dulu "Coba lagi") setelah API aktif di `http://127.0.0.1:8000`. Setelah transkrip selesai, video **baru** otomatis mendapat **AI Summary** (lihat bagian "AI Summary Video" di bawah).

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
> Langkah di bawah (tombol "Atur Bobot", slider) tidak sesuai UI saat ini. Sejak v2.48.0 bobot konsolidasi Survey/Outcome diubah di **Admin Parameters -> Journey Parameters -> PX Index Weights** (lihat bagian "Bobot PX Index & PX Index per Direktorat (v2.48.0)" di akhir dokumen).

1. Klik tombol **"Atur Bobot"** pada navbar atas.
2. Geser slider bobot konsolidasi (default: **70% Survey / 30% Outcome**).
3. Sesuaikan bobot proporsi untuk masing-masing 5 Journey jika diperlukan.
4. Klik **"Simpan Pengaturan Bobot"**.

---

## 🔄 7. Panduan Frekuensi Update Data & Pengingat Upload Survei

Setiap metrik memiliki parameter **"Update Data Berkala"** yang menentukan seberapa sering data
metrik tersebut perlu diperbarui, serta (khusus metrik Survey) pengaturan pengingat email ke PIC
yang bertanggung jawab meng-upload data secara manual.

### 7.1 Frekuensi Update Data (*Data Update Frequency*)
Buka **Admin Parameters → Metric Parameters → Edit** pada metrik yang dituju, lalu pada bagian
*"Update Data Berkala & Pengingat Upload Survei"* pilih salah satu pada dropdown **Data Update Frequency**:

| Pilihan | Kapan Dipakai |
| :--- | :--- |
| **Monthly (Periodic Update Every Month)** (dulu Bulanan) | Metrik yang datanya perlu di-upload/diperbarui setiap bulan (default untuk sebagian besar metrik). |
| **Annual (One Upload for the Full Year)** (dulu Tahunan) | Metrik yang cukup diupload sekali dan dipakai untuk kalkulasi sepanjang tahun — contoh default: 11 metrik **ESS (Employee Sentiment Survey)**. |

**Periode baca**: di v2.36.0 pilihan ini sempat menentukan periode filter MTD (Annual = Januari s.d. bulan terpilih). **Sejak v2.37.0 tidak lagi**: filter MTD selalu membaca hanya bulan terpilih untuk semua metrik Survey System (metrik ESS sejak v2.50.0: hasil ESS terakhir sampai periode yang dilihat, lihat bagian ESS di bawah), jadi mengubah pilihan ini tidak mengubah nilai metrik; pilihan ini hanya dipakai pengingat e-mail (§7.2). Metrik tanpa data di periode terpilih tampil "No Data" dan tidak ikut indeks (lihat `docs/01` §4).

### 7.2 Pengingat Upload Survei Manual (Reminder Email PIC)
Khusus metrik bertipe **Survey**, tersedia toggle **"This survey is still uploaded manually by the PIC (enable email reminders)"**.
Sejak v2.29.0 toggle ini **hanya mengatur pengingat e-mail**; semua metrik Survey tetap bisa diunggah manual (lihat bagian *Survey Source* di bawah).
Jika diaktifkan:
1. Isi **Nama PIC Upload** dan **Email PIC (Tujuan Reminder)**.
2. Tentukan **Upload Deadline Date** — tanggal (1–28) setiap bulan untuk metrik Monthly, atau
   bulan + tanggal untuk metrik Annual (default: 25 November).
3. Sistem otomatis mendeteksi jika data belum diupload untuk siklus berjalan (bulan ini, atau
   tahun ini untuk metrik Tahunan), dan menandai status:
   - **Segera Jatuh Tempo (DUE_SOON)** — ≤5 hari sebelum batas waktu.
   - **Terlambat (OVERDUE)** — sudah melewati batas waktu.
4. Metrik yang berstatus DUE_SOON/OVERDUE muncul otomatis sebagai **banner kuning** di atas
   tabel Metric Parameters, lengkap dengan tombol **"Send Reminders Now"** untuk mengirim
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

1. Buka **Admin Parameters** di Header → tab **Email Settings** (sejak v2.41.0; sebelumnya tombol sendiri di Header).
2. **Gmail (sementara/uji coba)**: pilih provider *Gmail*, isi alamat Gmail, lalu isi **App Password** — bukan password akun biasa. Cara: akun Google → Keamanan → aktifkan *Verifikasi 2 Langkah* → *Sandi aplikasi* → buat satu → salin 16 karakternya ke kolom password.
3. **SMTP internal (target akhir, sesuai kebijakan on-premise)**: pilih provider *SMTP Server*, isi host, port, TLS, akun, dan password dari tim infrastruktur.
4. Centang **Aktifkan**, klik **Simpan**, lalu **Send Test Email** (default ke email pengirim sendiri) dan periksa kotak masuk.
5. Setelah aktif, reminder ke PIC (pengecekan harian otomatis + tombol *Send Reminders Now* di Admin Parameters) memakai akun ini. Password tersimpan terenkripsi di database dan tidak pernah ditampilkan kembali.

---

## ⏰ Cara Kerja Reminder Otomatis Upload Survei (v2.24.0)

1. Di **Admin Parameters → Edit Metrik (SURVEY)**: aktifkan *upload manual*, isi **Upload Deadline Date** (mis. 10), **Nama PIC** dan **Email PIC**.
2. Di **Email Settings**: isi akun pengirim & aktifkan; atur *jam mulai kirim* (default 08:00) dan *ulangi setiap N hari* (default 1; 0 = hanya sekali).
3. Setiap hari, mulai tanggal batas, sistem memeriksa tabel survei metrik itu: **adakah data bertanggal survei di bulan SEBELUMNYA?** Contoh: tanggal batas 10, hari ini 10 Oktober → cari data September. Bila **tidak ada**, PIC otomatis diemail ("data survei September 2026 belum ada"); bila ada, tidak ada email.
4. Email diulang sesuai pengaturan sampai data periode itu terunggah. Tidak ada email ganda pada hari yang sama meski server di-restart; bila server mati pada tanggal batas, email dikirim begitu server hidup kembali.
5. Pantau di **Email Settings → Sent Reminder History** dan panel peringatan di Admin Parameters; tombol **Send Reminders Now** mengirim manual ke semua PIC yang masih pending.

> Metrik **Tahunan** diingatkan pada tanggal+bulan batas tahun itu bila belum ada data bertanggal tahun tersebut. Data bulan berjalan tidak dihitung untuk metrik bulanan.

---

## 🔐 Login, Akun & Manage Users (v2.26.0; menu bernama "Kelola User" sebelum v2.30.0)

**Membuat Admin pertama** (sekali, setelah instalasi / pada database baru):
1. Di folder proyek jalankan `npm run auth:create-admin` (opsi: `-- --username 8801923 --name "Nama" --email nama@...`; default username `admin`).
2. Catat **password sementara** yang tampil di konsol — hanya muncul sekali. Tidak ada password bawaan di kode/repo; namun bila env `DEFAULT_INITIAL_PASSWORD` di `.env` terisi (opsional, v2.27.2), password awal standar itulah yang dipakai (tidak dicetak di konsol) dan tetap wajib diganti saat login pertama. Login dengan akun itu; aplikasi langsung meminta ganti password (min 10 karakter, ada huruf dan angka).
3. Lupa password Admin / semua Admin terkunci: `npm run auth:create-admin -- --username <akun> --reset-password`.

**Manage Users** (Admin Parameters → tab Manage Users sejak v2.41.0; sebelumnya tombol Header; hanya Admin):
- **Tambah user**: isi username/NIP, nama, email (opsional), role. Role **User** wajib memiliki minimal satu cakupan data (lihat bawah); role **Admin** tidak terikat cakupan. Setelah disimpan, **password sementara tampil sekali** — salin dan sampaikan ke yang bersangkutan; saat login pertama ia wajib menggantinya. Bila `DEFAULT_INITIAL_PASSWORD` terisi, yang tampil adalah password awal standar dengan catatan "Password awal standar — wajib diganti saat login pertama". **Risiko**: sebelum pemilik akun login pertama, siapa pun yang tahu password awal itu dapat masuk ke akun tersebut — minta ganti segera. Password pengganti tetap harus lolos kebijakan dan tidak boleh sama dengan password awal.
- **Reset password**: password sementara baru (sekali tampil; password awal standar bila env terisi). Reset juga **membuka kunci akun** dan mengeluarkan semua sesi user itu.
- **Kunci akun**: 5 kali salah password berturut-turut mengunci akun 15 menit; Admin dapat membukanya lewat reset password. Batas dapat diubah di setting `login_max_attempts` / `login_lockout_minutes`.
- **Nonaktifkan / ganti role**: mematikan sesi user tersebut. Anda tidak bisa menonaktifkan/menurunkan akun sendiri atau Admin aktif terakhir. Tombol hapus akun belum tersedia di UI — gunakan nonaktifkan.
- **Riwayat**: panel audit menampilkan login berhasil/gagal/terkunci, logout, dan perubahan akun (tanpa password).

**Hak akses User**: melihat data direktoratnya (metrik non-karyawan tampil sebagai angka bankwide read-only), tanpa data per responden, tanpa menu admin/upload; Signature Event hanya baca kecuali User dari direktorat pengelola event (setting `event_manager_directorates`, default Human Resources — belum ada menu UI untuk mengubahnya). **Sejak v2.49.0 tidak berlaku untuk event**: Signature Program Events hanya untuk Admin dan User yang diberi menu itu di **Menu Access**; `event_manager_directorates` tidak dipakai lagi. Cakupan data diatur seperti di bawah (sejak v2.27.0 divisi ikut menyaring data).

**Mengatur cakupan data User** (v2.27.0, di form tambah/ubah user):
1. Pilih role **User**, lalu di "Cakupan Data" pilih direktorat dari dropdown "+ Tambah direktorat ke cakupan". Ulangi untuk direktorat lain (satu User boleh banyak direktorat).
2. Untuk tiap direktorat pilih **Semua divisi** atau **Divisi tertentu** lalu centang divisi yang boleh dilihat. Hapus direktorat dengan ikon tempat sampah.
   - **Sejak v2.53.1** langkah ini tidak ada lagi: cakupan User cukup memilih direktorat (seluruh direktorat). Akun lama yang masih dibatasi divisi diberi catatan "old division limit" dan menjadi seluruh direktorat saat disimpan ulang.
3. Simpan. Perubahan berlaku pada request User berikutnya — User tidak perlu login ulang. Perubahan tercatat di riwayat audit sebagai `USER_SCOPE_CHANGE`.

Yang dilihat User: pilihan filter "Semua cakupan saya" menampilkan **data gabungan** seluruh cakupan (sampel digabung, bukan rata-rata dari rata-rata). Skor, trend, detail metrik dan alert dibatasi ke cakupan; metrik non-karyawan/OUTCOME tetap tampil sebagai angka bankwide read-only. Sampai v2.48.0 User yang cakupannya memuat direktorat pengelola event (setting `event_manager_directorates`, default Human Resources) dapat mengelola Signature Event; sejak v2.49.0 hak itu diberikan per user lewat **Menu Access**. Mengubah role ke Admin menghapus cakupan; menurunkan ke User wajib mengisi cakupan.

**Deployment**: sebaiknya di belakang reverse proxy HTTPS on-premise dengan `TRUST_PROXY` di `.env` (cookie sesi menjadi `Secure`). Sesi berlaku 8 jam (`session_hours`).

## 🧑‍💼 Menjadikan Akun User sebagai PIC Metrik (v2.27.1)

1. Buat akun **User** di **Manage Users** dan **isi emailnya** (opsional di form, tetapi wajib agar akun bisa menjadi PIC).
2. Buka **Admin Parameters** → metrik SURVEY (sejak v2.29.0 metrik SURVEY mana pun, tidak harus ber-toggle upload manual) → isi **Email PIC** dengan email akun tadi (huruf besar/kecil tidak berpengaruh). Penetapan PIC tetap lewat sini; tidak ada pengaturan PIC di Manage Users. Bila tidak ada akun aktif ber-email itu, muncul peringatan "PIC belum punya akun login".
3. Berlaku **langsung** pada request berikutnya — tanpa login ulang. Mengubah Email PIC, email akun, atau menonaktifkan akun mencabut/memberi hak dengan cara yang sama. Manage Users menampilkan "PIC metrik" tiap akun.

Yang bisa dilakukan PIC, hanya untuk metrik miliknya: unduh template, **upload CSV** (metrik ditentukan dari form; kolom `metric_id` di CSV diabaikan), lihat riwayat upload, unduh evidence, dan lihat identitas responden. Untuk metrik karyawan, identitas/evidence hanya responden dalam **cakupan direktorat/divisi akun PIC**. Hasil upload PIC tidak menampilkan PE Index bankwide. Setiap upload tercatat di riwayat audit (`SURVEY_UPLOAD`) dan di riwayat batch sebagai `Nama (username)`. Reminder email tetap ke Email PIC.

Perhatian (belum diputuskan): importer belum menolak NIP kembar dalam satu CSV atau antar-batch, dan PIC dapat mengunggah baris di luar cakupannya (tersimpan, terlihat oleh Admin, tidak oleh PIC); tanggal survei tidak valid disimpan sebagai hari ini.

---

## 🗂️ Survey Source (System / ESS) & Upload Manual untuk Semua Survei (v2.29.0)

**Mengatur Survey Source** - Admin Parameters -> Metric Parameters -> Edit / Tambah metrik **SURVEY** -> dropdown **Survey Source**:

| Pilihan | Arti |
| :--- | :--- |
| **System** (default untuk metrik baru) | Data berasal dari sistem atau form lain (mis. form evaluasi event, sistem rekrutmen). |
| **ESS Template** | Employee Sentiment Survey: data diunggah dari template ESS. Menampilkan ringkasan dimensi ESS di detail metrik. |

Metrik OUTCOME tidak punya Survey Source (dropdown tidak muncul). Pilihan tampil sebagai badge **ESS Template** / **System** di Explore Metrics, sebagai kolom di tabel Metric Parameters, dan sebagai chip "Survey Source" di detail metrik. Data saat ini: ESS = metrik 9, 13, 15, 16, 17, 18, 21, 22, 24, 25, 27; System = 2, 5, 6, 7, 8, 10, 12, 23, 26. Mengubahnya tidak mengubah skor.

**ESS selalu diunggah manual**: pada metrik ESS checkbox "Survei ini masih diupload manual oleh PIC" otomatis tercentang dan terkunci; server menolak (400) permintaan yang mematikannya. Jadi metrik ESS selalu ikut pengingat e-mail PIC.

**Semua metrik Survey bisa diunggah manual**: tombol **Template**, **Evidence** dan **Upload** muncul untuk setiap metrik Survey bagi Admin dan bagi PIC-nya (akun User yang e-mailnya sama dengan **Email PIC** metrik itu) - tanpa perlu toggle upload manual. Berguna bila sistem sumber bermasalah dan data harus dimasukkan lewat CSV. Akun User yang bukan PIC metrik itu tetap ditolak (403); metrik Outcome tidak bisa diunggah. Toggle upload manual kini hanya menentukan apakah **e-mail pengingat** dikirim ke PIC (aturan pengingat v2.24.0 tidak berubah).

**Tombol di layar sempit**: tombol Template / Upload di menu **Survey Templates** dan tombol Survey Data Operations di detail metrik turun ke baris berikutnya bila ruang tidak cukup.

**Galeri media event**: ringkasan **AI Summary** video bisa dilipat dengan mengklik judulnya (default terbuka); blok "AI Description" kini hanya untuk foto; nama file media tidak lagi diawali "Documentation ".

Catatan / belum diperbaiki: importer Admin yang menerima `metric_id` form non-numerik memakai metrik Survey pertama; NIP kembar belum ditolak importer.

---

## 🤖 AI Summary Video & Instalasi Ollama + Gemma (v2.28.0)

### Cara kerja
- Setiap video **baru** yang transkripnya selesai otomatis diringkas oleh model lokal **Gemma 3 4B** (Ollama di mesin yang sama; tidak ada data keluar). Kartu video menampilkan blok **AI Summary**: ringkasan, poin utama, dan label sumber.
- **Label sumber**: `AI • gemma3:4b` = jawaban model yang lolos pemeriksaan otomatis; **Automatic (rule-based)** = model gagal/mati atau jawabannya ditolak pemeriksaan (angka, nama, atau bahasa tidak sesuai transkrip), sehingga sistem menampilkan kalimat yang diambil langsung dari transkrip. Ringkasan AI **dibuat otomatis — selalu periksa kembali dengan transkrip**; pemeriksaan otomatis tidak menjamin ketepatan makna (nuansa dan penafian bisa keliru).
- Transkrip kurang dari 20 kata tidak diringkas ("Transkrip belum cukup").
- Pembuatan bisa sekitar satu menit atau lebih (CPU); kartu terisi sendiri.
- **Tombol "Generate summary" / "Regenerate summary"** (dulu "Buat / Buat ulang ringkasan") (hanya Admin/pengelola event): muncul bila video belum punya ringkasan, ringkasan gagal, atau hasilnya "Automatic (rule-based)" (mis. setelah Ollama dinyalakan). Ringkasan AI yang sudah jadi tidak punya tombol. Bila sedang diproses/antri, sistem menolak dengan pesan 409.
- Video lama (diunggah sebelum v2.28.0) **tidak** diringkas otomatis; tekan tombol bila perlu. Gemma tidak dipanggil saat membuka halaman, dashboard, alerts, foto, atau PPT; PPT hanya menampilkan ringkasan yang sudah tersimpan.
- Ollama mati tidak menghalangi upload maupun transkrip.

### Kenapa ringkasan bisa jatuh ke "Automatic (rule-based)" (v2.30.3)
- **Arti**: Gemma sudah dipanggil, tetapi jawabannya tidak lolos pemeriksaan otomatis (setelah satu kali coba ulang), atau Ollama mati/timeout. Yang tampil adalah kalimat yang diambil langsung dari transkrip - aman, hanya kurang rapi. Pesan di kartu: *"The AI summary was rejected by the validator; the automatic (rule-based) summary is shown."*
- **Penyebab paling umum**: model 4B "menghias" transkrip yang **sangat pendek** (contoh kasusnya: 59 kata) dengan gagasan yang tidak diucapkan (mis. "dampak negatif", "masa depan"), atau memasukkan angka, nama, atau bahasa yang tidak ada di transkrip. Penolakan seperti ini benar, bukan kesalahan sistem. Sejak v2.30.3, kata yang hanya berbeda imbuhan dari kata di transkrip (mis. "dampaknya" untuk "dampak") tidak lagi dianggap baru, sehingga lebih sedikit ringkasan yang ditolak tanpa alasan.
- **Cara memperbaiki**: klik **Regenerate summary** pada kartu video (hanya Admin/pengelola event). Satu kali regenerate = 1-2 panggilan Gemma, sekitar 11 detik per panggilan di CPU mesin ini; hasilnya deterministik (seed tetap), jadi mengulang berkali-kali pada video yang sama biasanya memberi hasil sama.
- **Ekspektasi kualitas**: untuk transkrip sangat pendek, model mungkin tetap gagal dan hasilnya tetap **Automatic (rule-based)** - itu normal. Ringkasan berlabel `AI` tetap perlu dicek dengan transkrip: pemeriksaan otomatis tidak menangkap distorsi makna halus atau penafian.
- Setelah memperbarui ke v2.30.3, **restart backend** agar validator baru dipakai; ringkasan yang sudah tersimpan tidak berubah sampai Anda menekan Regenerate.

### Memasang Ollama + Gemma (sekali per mesin)
```powershell
winget install Ollama.Ollama
ollama pull gemma3:4b
```
Lalu di `.env` (tidak dikomit): `OLLAMA_MODEL=gemma3:4b`. Opsional: `OLLAMA_HOST` (default `http://localhost:11434`), `OLLAMA_TIMEOUT_MS` (default 7200000 = 120 menit sejak v2.30.0; dulu 300000), `SUMMARY_JOB_TIMEOUT_MS` (default 7200000; batas total satu job ringkasan), `AI_QUEUE_MAX` (default 50). Restart backend. Cek status: `GET /api/health?check_ai=1` (login) -> `local_ai.ollama_status`. Model diunduh sekali dari registri Ollama saat `ollama pull` (satu-satunya akses internet; setelahnya semuanya berjalan lokal) — pada jaringan tertutup, pasang model dari sumber internal sesuai kebijakan TI.

---

## 🌐 Bahasa UI, Tema & Batas Waktu Proses (v2.30.0)

**Bahasa antarmuka**: seluruh menu, tombol, dan pesan di aplikasi kini berbahasa Inggris. Panduan ini memakai nama menu **di layar** (Inggris); nama lama ditulis di sebelahnya bila perlu.

| Nama lama | Nama di layar sekarang |
| :--- | :--- |
| Parameter Admin | **Admin Parameters** |
| Setting Email, Kirim Email Test | **Email Settings**, **Send Test Email** |
| Kelola User | **Manage Users** |
| Tema | **Theme** |
| Batas Tanggal Upload | **Upload Deadline Date** |
| Frekuensi Update Data: Bulanan / Tahunan | **Data Update Frequency**: **Monthly** / **Annual** |
| Kirim Reminder Sekarang | **Send Reminders Now** |
| Keluar | **Sign out** (pojok kanan atas) |

Yang **sengaja tetap Indonesia**: isi 44 istilah di tab About, nama metrik / journey / direktorat / divisi / program, pertanyaan survei, header kolom CSV evidence, isi e-mail pengingat ke PIC, dan data seperti Action Library.

**Memilih tema**: klik **Theme** di Header lalu pilih salah satu dari 5 warna: **Crimson**, **Royal Blue**, **Teal**, **Violet**, **Tangerine**. Pilihan hanya tersimpan di browser Anda (tidak di server) dan pilihan lama tetap berlaku karena hanya nama tampilan yang berubah.

**Filter bulan**: dropdown bulan hanya berisi nama bulan (January ... December) tanpa angka; label periode bulanan berbentuk "Month-to-Date (MTD) March 2026".

**Tombol Target di Explore Metrics dihapus**: untuk metrik Outcome, target dan threshold diubah lewat **Admin Parameters** di Header (bukan tombol di baris metrik); baris Outcome kini hanya punya **View Data**.

**Batas waktu proses panjang (120 menit)**: transkrip video, pembuatan AI Summary oleh Gemma (satu job penuh, termasuk video panjang yang dipecah beberapa bagian dan satu percobaan ulang), dan penerimaan satu upload video oleh server kini masing-masing diberi batas 120 menit. Sebelumnya transkrip 30 menit, satu panggilan Gemma 5 menit, dan upload dipotong Node pada 5 menit. Bila video sangat besar atau komputer sangat lambat, tidak perlu mengubah apa pun; untuk mengubah batas, isi di `.env` (dalam milidetik; hapus baris atau kosongkan untuk kembali ke default):

| Variabel `.env` | Default | Mengatur |
| :--- | :--- | :--- |
| `TRANSCRIBE_TIMEOUT_MS` | 7200000 | menunggu satu transkrip dari API lokal |
| `OLLAMA_TIMEOUT_MS` | 7200000 | satu panggilan Gemma |
| `SUMMARY_JOB_TIMEOUT_MS` | 7200000 | total waktu satu job ringkasan (semua bagian + percobaan ulang) |
| `REQUEST_TIMEOUT_MS` | 7200000 | menerima SATU permintaan upload utuh |

Setelah mengubah `.env`, restart backend. Bila batas ringkasan habis, kartu video menampilkan ringkasan **Automatic (rule-based)**; Admin dapat menekan **Regenerate summary**.

**Form check-in / feedback via QR**: pada v2.27.0 s.d. v2.29.0 halaman `?checkin=` dan `?survey=` gagal terbuka bagi peserta yang belum login (error `reading 'scopes'`). Sudah diperbaiki di v2.30.0; bila ada event yang berjalan pada rentang itu, absensi/feedback peserta perlu dikumpulkan ulang. Satu hal yang diketahui: tautan `?survey=` untuk event yang masih pre-event menampilkan form feedback tanpa pertanyaan.

---

## Nama File Video & Format Unggahan Media (v2.30.1)

**Format yang diterima** (Upload Photo / Video, maks. 200 MB): foto **JPG, JPEG, PNG, GIF, WEBP, BMP, AVIF**; video **MP4, M4V, MOV, WEBM, MKV, AVI, OGV, MPG, MPEG, 3GP, WMV, FLV**. Format lain ditolak dengan pesan "Unsupported file format" dan tidak ada yang tersimpan, termasuk **SVG** (bisa membawa script) dan **HEIC/HEIF** (foto iPhone - browser tidak bisa menampilkannya; ubah dulu ke JPG). Jenis file (gambar/video) dan ekstensinya harus cocok: file `.html`, `.exe`, atau `.js` ditolak walau dikirim sebagai video, dan video dengan ekstensi gambar (atau sebaliknya) juga ditolak.

**Nama file video berubah setelah proses selesai**: segera setelah diunggah, file video di `server/uploads` bernama acak (`media-<angka>-<acak>.mp4`) supaya dua unggahan bernama sama tidak bertabrakan selagi diproses. Setelah transkrip dan AI Summary selesai (atau transkrip gagal), sistem otomatis mengganti nama file menjadi **nama file yang Anda unggah**; kartu video menyegarkan dirinya sendiri beberapa detik kemudian. Hal yang perlu diketahui:
- Selama proses berjalan (status "processing") nama tidak diganti, agar Video Extractor dan Gemma tidak kehilangan file.
- Karakter yang tidak boleh dipakai Windows (`< > : " | ? *`) dibuang dari nama; nama dipotong bila terlalu panjang (150 karakter); bila sudah ada file bernama sama, ditambahkan ` (1)`, ` (2)` dan seterusnya - file lain tidak pernah tertimpa.
- Bila penggantian nama gagal (file terkunci, izin ditolak), video tetap bisa diputar dengan nama acak dan hanya muncul peringatan di console server.
- Video yang diunggah **sebelum v2.30.1** tidak diganti namanya otomatis. Namanya berubah hanya bila Anda menekan **Regenerate summary** atau **Try again** pada video itu dan prosesnya selesai.
- Daftar/monitoring di layanan Video Extractor tetap menampilkan nama acak untuk video yang sudah pernah dikirim ke sana sebelum diganti namanya (sejak v2.30.2 video **baru** tampil dengan nama asli, lihat bagian berikut).
- Hapus video lewat tombol hapus di kartu: file dengan nama barunya ikut terhapus dari `server/uploads`.

## Nama File Asli di Monitoring Video Extractor (v2.30.2)

**Perubahan yang terlihat**: pada video yang diunggah setelah v2.30.2 (setelah backend di-restart), menu monitoring Video Extractor seharusnya menampilkan **nama file yang Anda unggah**, bukan lagi `media-<angka>-<acak>.mp4`. Sistem melakukannya dengan membuat `hard link` sementara (bukan salinan, tidak memakan ruang disk) di `server/tmp-transcribe/<id media>/` yang dihapus otomatis begitu Extractor selesai; file asli di `server/uploads` tidak disentuh.

**Cara memeriksa** (belum diverifikasi oleh penulis dokumen; menunggu uji dengan video pendek asli): unggah video pendek di Signature Program Events, buka monitoring Video Extractor selagi status "processing", dan cek nama yang tampil.

**Yang perlu diketahui**
- Entri yang sudah tercatat di Extractor sebelum versi ini tetap bernama acak.
- Folder `server/tmp-transcribe` normalnya kosong; hanya berisi folder selama transkrip berjalan. Sisa (mis. server mati mendadak) dibersihkan otomatis saat backend dinyalakan. Aman dihapus manual saat tidak ada video berstatus "processing".
- Hard link hanya bisa dibuat bila `server/uploads` dan `server/tmp-transcribe` ada di **drive/volume NTFS yang sama** (default: ya, keduanya di folder `server`). Bila tidak bisa, sistem otomatis memakai nama acak seperti sebelumnya; transkrip tetap berjalan dan hanya muncul peringatan di console server.
- Bila Extractor menolak path bernama asli dengan error cepat "file tidak ditemukan/tidak terbaca", sistem mencoba **sekali** lagi dengan nama acak. Bila Extractor mati atau timeout, tidak ada percobaan ulang (gunakan **Try again** setelah Extractor aktif).
- Bila nama file mengandung karakter khusus (`[ ] ( ) é`) dan monitoring tetap menampilkan nama acak, laporkan: perilaku Extractor asli terhadap karakter itu belum diuji.

---

## 📊 Upload Ringkasan Hasil ESS (.xlsx) (v2.32.0)

**Siapa**: Admin, atau PIC metrik ESS (akun User yang e-mailnya sama dengan Email PIC metrik itu). Metrik ESS saat ini: 9, 13, 15, 16, 17, 18, 21, 22, 24, 25, 27 (badge **ESS Template** di Explore Metrics).

**Yang diunggah**: ringkasan hasil ESS satu periode untuk satu metrik, bukan jawaban per responden: satu baris **Bankwide** (`PT Bank CIMB Niaga Tbk`) dan satu baris per direktorat. Contoh: `docs/ESS 2025 Result_Role Clarity & DS Support.xlsx`. Format kolom dan daftar validasi lengkap: `docs/SURVEY_IMPORT_GUIDE.md` bagian "Hasil ESS".

**Langkah**
1. Explore Metrics -> baris metrik ESS -> **Template** (atau dari detail metrik / menu Survey Templates -> "Download ESS Template (.xlsx)"). File `Template_ESS_Metric_<id>.xlsx` sudah berisi header (nama index + pertanyaan aktif) dan nama Bankwide + 12 direktorat.
2. Isi kolom C Year, D Month (sama untuk semua baris), E Participation, F skor index (mis. `0.92` atau `92`) dan skor pertanyaan di kolom G dst. **Sejak v2.50.0** kolom G = pertanyaan 1 di Manage Questions, H = pertanyaan 2, dst. (menurut posisi, bukan teks header), dan jumlah kolom pertanyaan yang berisi nilai harus sama dengan jumlah pertanyaan metrik itu di Manage Questions; bila tidak, file ditolak dengan pesan mis. "The file has 3 question columns with values (G-I), but 2 questions are configured for this metric in Manage Questions...". Baris direktorat tanpa data harus dihapus (baris yang hanya berisi nama + Level akan ditolak karena Year/Month/Participation/F kosong). Simpan sebagai **Excel Workbook (*.xlsx)**.
3. Klik **Upload** pada metrik itu -> pilih file `.xlsx` -> **Process ESS Summary & Recalculate PX Index**.
4. Hasil sukses menampilkan periode, jumlah baris, dan index Bankwide. Bila periode itu sudah pernah diunggah, datanya **diganti** (upload lama tetap ada di riwayat).
5. Bila ditolak, tidak ada yang tersimpan; perbaiki semua baris yang disebut di daftar error lalu unggah ulang.

**Yang perlu diketahui**
- CSV dan `.xls` tidak diterima untuk metrik ESS; template CSV master (`ALL`) tidak lagi memuat metrik ESS.
- Skor yang dipakai Dashboard adalah hasil ESS **terakhir sampai periode yang dilihat**, termasuk dari tahun sebelumnya (berlaku lagi sejak v2.50.0; v2.36.0-v2.49.x memakai periode ketat). ESS hanya sekali setahun (November), jadi YTD 2026 dan MTD Januari-Oktober 2026 memakai hasil November 2025 sampai hasil 2026 diunggah; detail metrik menampilkan "ESS result November 2025 (latest available)". Periode sebelum hasil pertama (mis. MTD Oktober 2025) dan bulan/tahun yang belum dimulai tampil "No Data".
- **Pertanyaan yang tampil** (Spreadsheet View dan Card View) = pertanyaan di Manage Questions, bukan teks header file (sejak v2.50.0). Teks header file hanya disimpan untuk audit.
- Filter direktorat memakai baris direktorat itu; filter divisi memakai baris direktorat induknya (detail metrik menampilkan catatan "ESS is reported at directorate level").
- Jumlah sampel = Participation. Ringkasan ESS hanya berisi % favorable; % neutral / % unfavorable tampil "—".
- **Evidence** metrik ESS = CSV baris ringkasan tersimpan semua periode beserta nama file dan pengunggahnya. PIC hanya mendapat direktorat dalam cakupannya (tanpa baris Bankwide). Sejak v2.50.0 bisa berupa `.zip` (satu CSV per versi pertanyaan) bila pertanyaan diubah di antara upload.
- **Original File** di detail metrik mengunduh file asli yang diunggah (Admin atau PIC metrik itu). File asli disimpan di server di `server/data/ess-uploads/` (tidak bisa dibuka lewat `/uploads`); data seed tidak punya file asli. Folder ini tidak ikut backup database - backup terpisah (lihat `SQLServerDB.md` §16).
- Menghapus metrik ESS di Admin Parameters ikut menghapus hasil ESS dan file aslinya.
- Data ESS per responden lama dihapus sekali saat upgrade ke v2.32.0. Data saat ini (November 2025) adalah seed: metrik 9 = nilai file user, metrik ESS lain **dummy** - ganti dengan mengunggah hasil asli. Dummy kuartal 2026 (Maret/Juni/September, v2.37.0) dihapus otomatis saat start pertama v2.50.0 (hanya upload seed "Seed (dummy)"; upload Admin tidak disentuh).
- **Perlu dicek: metrik 9 (Role Clarity & DS Support)**: pertanyaan metrik 9 di Manage Questions tidak sama urutannya dengan file asli `docs/ESS 2025 Result_Role Clarity & DS Support.xlsx` (kolom G dan H tertukar, kolom I pertanyaan lain). Karena kolom dipetakan menurut posisi, skor kolom G (96) kini tampil di bawah pertanyaan 1 "Employees clearly understand what is expected of them.". Susun ulang/ubah pertanyaan metrik 9 di Manage Questions agar urutan dan teksnya sama dengan file.

> **Update 2026-10-20:** pertanyaan metrik 9 sudah disamakan dengan file Excel (Q1 contributes, Q2 expectations, Q3 feedback) - lihat CHANGELOG [2.50.0].

> **Update 2026-10-21 (v2.51.0):** pertanyaan default ke-11 metrik ESS kini = file template ESS (lihat "Pertanyaan template ESS (v2.51.0)" di akhir dokumen) dan Manage Questions database utama di-reset ke template itu (metrik 9: key `q1_role_contribution`, `q2_role_expectation`, `q3_manager_feedback`). Hasil ESS 2025 asli untuk metrik 13, 15, 16, 17, 18, 21, 22, 24, 25, 27 diunggah untuk November 2025 (13 baris per metrik), menggantikan dummy; metrik 9 tetap data seed (= nilai file asli). Kolom A boleh memakai nama lama/alternatif direktorat yang terdaftar sebagai former name (mis. "Consumer & Emerging Business Banking", "Sharia Banking").
- **Pengingat e-mail**: metrik ESS bersifat tahunan dengan batas 25 November; mulai 25 November 2026 PIC akan menerima pengingat bila hasil ESS 2026 belum diunggah. Hasil ESS dianggap data bulan periodenya.

---

## Dashboard Exit Interview (v2.38.0)

**Siapa**: semua akun dengan menu **Exit Interview** (default aktif untuk User; Menu Access sejak v2.49.0) bisa membuka tab **Exit Interview** di Header. Admin melihat data bankwide dan mendapat toolbar data (template, upload, export, riwayat). User hanya melihat **agregat** direktorat dalam cakupannya (direktorat lain ditolak); tidak ada NIK, nama, atau jawaban terbuka yang dikirim ke User. Dari detail metrik 26 (Exit Survey) tombol **Open Exit Interview Dashboard** membuka tab yang sama.

**Filter**: memakai filter Header. YTD = Januari s.d. bulan berjalan tahun itu, MTD = satu bulan; periode dihitung dari **Effective Resignation Date**. Filter Directorate memakai kolom Directorate di file (filter Sub-Dir dihapus dari web sejak v2.52.2; kolom Division tetap disimpan).

**Mengunggah data (Admin)**
1. Tab Exit Interview -> **Download Template (.xlsx)**. Baris 1 = judul, baris 2 = nama kolom (format "Termination Report" HR, kolom A..AG) + kolom **Directorate** dan **Division**, baris 3 = contoh (hapus sebelum upload).
2. Isi satu baris per karyawan yang keluar. Kolom **Directorate wajib** dan harus nama direktorat master (sama dengan filter Header); Division boleh kosong, tetapi bila diisi harus divisi dari direktorat itu. Tanggal: tanggal Excel, `YYYY-MM-DD` atau `dd/mm/yyyy`. Skor pernyataan karier 1-6 atau `-`. Ya/Tidak: `Yes`/`No` (juga `Ya`/`Tidak`). Rincian semua kolom: `docs/02` §5.4.
3. **Upload (.xlsx)** -> pilih file -> **Upload**. Hanya `.xlsx`, maks 20 MB; CSV dan `.xls` ditolak.
4. Bila ditolak, tidak ada satu baris pun yang tersimpan; tabel Row / Column / Problem menunjukkan semua baris yang harus diperbaiki. Perbaiki lalu unggah ulang file utuh.
5. Bila sukses, pesan menyebut jumlah baris baru, baris yang di-update, dan baris dummy yang diganti. Riwayat ada di **Upload history**.

**Aturan yang perlu diketahui**
- **Unggah ulang = update**: baris dengan NIK dan Effective Resignation Date yang sama dengan data tersimpan **diperbarui** (bukan digandakan); NIK yang sama dengan tanggal lain dianggap exit lain. NIK + tanggal yang muncul dua kali dalam satu file ditolak.
- **Data asli menggantikan dummy per bulan**: bulan Januari-September 2026 berisi data dummy sampai ada data asli. Begitu satu bulan diunggah (atau diimpor), **semua** baris dummy bulan itu dihapus dan diganti isi file. Bulan yang sudah punya baris tidak pernah diisi dummy lagi saat server start. Untuk database produksi, set `SEED_DEMO_DATA=false` sebelum start pertama agar dummy tidak pernah dibuat.
- Belum ada tombol hapus upload atau baris exit; koreksi dilakukan dengan mengunggah ulang baris yang sama (update).
- **Export CSV (current filter)** mengunduh semua baris per karyawan untuk periode + filter yang sedang aktif (termasuk nama dan jawaban terbuka). Simpan hanya di lokasi internal.
- Pengelompokan jawaban (faktor penarik, tema A/B, nama perusahaan standar, jawaban "tidak menjawab") memakai daftar kata kunci di setting `exit_interview_*` (`docs/04` "Catatan v2.38.0"). Belum ada layar untuk mengubahnya; Admin dapat memakai `PUT /api/admin/settings/<key>`. Perubahan langsung berlaku di dashboard.
- **Ukuran grup kecil**: belum ada batas minimum jumlah orang. User yang memfilter satu divisi dengan sedikit exit bisa mengenali individu dari angka kecil - perhatikan ini saat memberi cakupan divisi.

**Impor file September asli (lokal saja)**
- File asli `docs/Template Report Exit Interview.xlsx` berisi data per karyawan; file ini ada di `.gitignore` dan **tidak boleh** di-commit (repo tersambung ke GitHub). File ini tidak punya kolom Directorate dan NIK-nya tersamar.
- Impor ke SQL Server lokal: `npm run exit:import-template -- "<path ke file .xlsx>"`, mis. `npm run exit:import-template -- "docs/Template Report Exit Interview.xlsx"`. Skrip memberi setiap baris direktorat/divisi **dummy** (tetap sama setiap kali dijalankan) dan NIK pengganti `<NIK>-<nomor baris>`, menyimpan dengan sumber "Template import", dan mengganti dummy bulan itu. Menjalankan ulang meng-update baris yang sama. Output terakhir `IMPORT_OK`; bila ditolak, error per baris dicetak dan tidak ada yang tersimpan.
- Salinan file setiap upload/impor disimpan di `server/data/exit-uploads/` (di `.gitignore`, tidak bisa dibuka lewat browser).
- **Jangan commit ekspor yang berisi baris asli**: `npm run db:export` (apalagi `-- --replace`, yang menulis ke `server/data/store.json`) ikut membawa semua baris exit interview, termasuk hasil impor template. File CSV hasil **Export CSV** juga jangan dimasukkan ke repo.
- Setelah `node server/db/migrate.js --reset` (memuat `store.json` tanpa data exit) data asli hilang dan server mengisi dummy lagi saat start; jalankan ulang skrip impor bila perlu.


### Audit Trail tanpa entri tes (v2.43.0)

Admin Parameters -> Manage Users -> **Audit Trail** default tidak menampilkan aktivitas akun regression test / verifikasi (akun bertanda `is_test_account`). Centang **Show test-run entries** untuk melihatnya (badge abu-abu TEST). Data tidak dihapus. Login gagal dengan username yang tidak terdaftar selalu tampil. Skrip yang membuat admin sementara harus memakai `is_test_account: true`.


### Auto sign-out saat tidak ada aktivitas (v2.44.0)

Admin Parameters -> Manage Users -> **Session security**: isi "Auto sign-out after [N] minutes of inactivity" (1-120, default 5) lalu Save. Berlaku untuk semua user dalam ~30 detik. User mendapat peringatan 60 detik sebelum keluar dan bisa klik **Stay signed in**. Polling otomatis (status video, grafik) tidak dihitung aktivitas, jadi dashboard yang dibiarkan terbuka tetap keluar. Kejadian tercatat di Audit Trail sebagai `LOGOUT_IDLE`; perubahan setting sebagai `SETTINGS_CHANGE`.


### Bobot PX Index & PX Index per Direktorat (v2.48.0)

**Mengubah bobot Survey / Outcome (Admin)**

1. Buka **Admin Parameters** -> tab **Journey Parameters**.
2. Di kartu **PX Index Weights** isi **Survey (%)** atau **Outcome (%)**. Kolom lainnya terisi otomatis dengan sisanya (jumlah selalu 100). Hanya bilangan bulat 0-100.
3. Klik **Save Weights**. Dashboard, Performance Trend, Explore Metrics, detail metrik dan tab About memakai bobot baru; perubahan tercatat di Audit Trail sebagai `SETTINGS_CHANGE` (mis. `px_index_weights: 70/30 -> 60/40`).

Catatan: bobot berlaku untuk PX Index dan skor journey (default 70/30). Bila dalam suatu periode Survey atau Outcome tidak punya data, PX Index = komponen yang ada saja. Backend lain yang memakai database yang sama mengikuti dalam +-30 detik.

**PX Index by Directorate (Dashboard)**

- Di bawah panel PX Index ada **PX Index by Directorate**; klik judulnya untuk membuka. Periode sama dengan filter Header (YTD/MTD, tahun, bulan).
- Admin melihat semua direktorat master (12 saat ini; bisa diubah di tab Directorates sejak v2.51.0); User hanya direktorat dalam cakupannya (User dengan sebagian divisi melihat angka divisi itu saja, tertulis "Your divisions: ...").
- Urutan (sejak v2.51.0): abjad nama direktorat, tanpa nomor/peringkat di kiri (dihapus di v2.52.1). Direktorat tanpa data sendiri (mis. direktorat baru) tampil tanpa angka PX. (v2.48.0-v2.50.0: PX tertinggi dulu.)
- Klik satu direktorat = memilihnya di filter Direktorat Header, seluruh web mengikuti. Kembali ke bankwide lewat filter Header.

**Metrik non-karyawan di filter direktorat**

- Metrik #1-#5 (career website, Goes to Campus, rasio sukses universitas/kanal, candidate experience) tidak punya data per direktorat. Sejak v2.48.0, di filter direktorat/divisi (Admin dan User) metrik itu tampil dan **ikut dihitung** dengan nilai bankwide-nya: badge **Bankwide Value** di Explore Metrics, tag **Bankwide** di kartu journey. Dulu metrik ini dikecualikan ("EXEMPTED"), jadi PX Index direktorat berbeda dari angka v2.47.0, dan Outcome Index direktorat kini sama dengan Outcome bankwide.
- Keterbatasan lama: bagi Admin, bagian Score Deficit Alerts di Dashboard tetap bankwide walau filter direktorat dipilih.
- Metrik di kartu journey diurutkan Critical, Warning, On Target (skor tertinggi dulu), lalu No Data.

### Akses Menu per User (v2.49.0)

Setiap akun **User** punya daftar menu yang boleh dibuka; **Admin** selalu bisa membuka semua menu (tidak bisa dibatasi).

| Menu (urutan di Header) | Default User (baru dan lama) | Dijaga server |
| :--- | :---: | :--- |
| Dashboard & Trends | aktif | tidak (hanya disembunyikan) |
| Explore Metrics | aktif | tidak (hanya disembunyikan) |
| Exit Interview | aktif | ya (`/api/exit-interview/*`) |
| Action Library & AI Alerts | aktif | ya (`GET /api/action-library`) |
| Signature Program Events | **mati** | ya (semua API event, foto/video, PPT, QR) |
| About | aktif | tidak (hanya disembunyikan) |

**Memberi akses Signature Program Events (mis. user HR Strategy)**
1. Buka **Admin Parameters** -> tab **Manage Users**.
2. Klik **Edit** pada user, atau **Add User** untuk akun baru. Role harus **User**.
3. Di blok **Menu Access** centang **Signature Program Events** (hapus centang menu lain bila perlu), lalu klik **Save** / **Create Account**.
4. Berlaku pada klik/request berikutnya user itu, tanpa login ulang. Daftar user menampilkan ringkasan "Menus: all", "Menus: all except ..." atau "Menus: none". Perubahan tercatat di Audit Trail sebagai `USER_MENU_ACCESS_CHANGE` (mis. `<username>: events:off->on`).

**Yang perlu diketahui**
- Akses Signature Program Events = hak event penuh: melihat semua event termasuk NIP/nama/e-mail peserta dan kode akses check-in/feedback, membuat/menghapus event, mengunggah media, transkrip, ringkasan AI dan PPT. Berikan hanya kepada user HR Strategy. User tanpa menu ini tidak bisa membuka event sama sekali (sebelum v2.49.0 masih bisa melihat versi baca-saja).
- Form publik check-in/feedback lewat QR tetap bisa dipakai peserta tanpa login.
- Setting lama `event_manager_directorates` (direktorat pengelola event, default Human Resources) tidak memberi hak apa pun lagi. Saat upgrade, User yang dulu menjadi pengelola event lewat setting itu otomatis mendapat menu Signature Program Events (database utama: 0 akun, karena hanya ada akun admin).
- Mematikan Dashboard, Explore Metrics atau About hanya menyembunyikan menunya; angka skor tetap bisa diambil lewat API oleh user login dalam cakupannya. Jangan memakainya sebagai batas kerahasiaan data.
- User yang semua menunya dimatikan melihat pesan "Your account has no menu access yet. Contact an Admin."


### Mengelola Direktorat & Divisi (v2.51.0)

**Siapa**: Admin. Menu: **Admin Parameters** -> tab **Directorates**. Master direktorat ini dipakai filter Header, cakupan User, impor (ESS, Exit Interview, CSV survei) dan form check-in.

**Mengganti nama direktorat**
1. Klik ikon Rename pada direktorat, ketik nama baru, **Save**.
2. Dialog menyebut berapa baris data yang membawa nama itu; klik **Rename**. Nama berubah sekaligus di data survei karyawan, hasil ESS, Exit Interview, absensi event, cakupan User, unit SLA rekrutmen dan setting `event_manager_directorates` (satu transaksi). Audit Trail, file upload asli dan CSV evidence lama **tidak** diubah.
3. Nama lama otomatis menjadi **former name**: file ESS/Exit Interview/CSV dan check-in yang masih memakai nama lama tetap masuk ke direktorat ini.
4. Filter Header yang sedang memilih direktorat itu ikut pindah ke nama baru.

**Menambah direktorat / divisi**: **Add Directorate** (nama + divisi opsional, satu per baris) atau **Add Division** di bawah daftar divisi. Divisi juga bisa di-rename (data dan cakupan divisi ikut) dan dihapus.

**Menghapus & menggabungkan (merge)**
- Hapus direktorat/divisi hanya bisa bila tidak ada data yang merujuk. Bila masih ada, muncul pesan dengan jumlah data per sumber dan tombol **Merge into another directorate**.
- **Merge**: pilih direktorat tujuan -> **Merge ...**. Dialog pratinjau menampilkan data yang pindah dan setiap akun yang cakupannya berubah. Semua data dan divisi pindah ke tujuan (divisi bernama sama digabung), hasil ESS periode yang sama digabung (rata-rata berbobot partisipasi), lalu direktorat asal dihapus dan namanya menjadi former name tujuan.
- **Perhatian cakupan User**: akun yang punya "semua divisi" direktorat asal setelah merge mendapat **semua divisi direktorat tujuan** (melihat lebih banyak data dari sebelumnya; ditandai "will now see ALL of ..." di dialog). Tinjau akun itu di Manage Users setelah merge. Setiap perubahan cakupan tercatat `USER_SCOPE_CHANGE`.

**Former name manual**: ketik di input "Former or alternative name" pada direktorat (atau pilih divisi untuk former name divisi) lalu simpan. Contoh yang sudah dipasang: "Consumer & Emerging Business Banking" -> Consumer & EBB (ejaan di file ESS), "SLC" -> SLC ASG Satyaguna Langgeng Capital. Menghapus former name tidak mengubah data, tetapi impor yang masih memakai nama itu akan ditolak sebagai direktorat tak dikenal.

**Aturan nama**: maks. 200 karakter; spasi ganda/aneh dirapikan; tidak boleh kosong, hanya titik, berisi karakter tak terlihat, `ALL`, `Bankwide`, `General`, `-`, atau diawali "PT Bank CIMB Niaga" (baris Bankwide file ESS/Exit Interview); tidak boleh sama dengan direktorat lain (huruf besar/kecil tidak dibedakan). Bila nama sudah dibawa data yang tidak terhubung ke direktorat mana pun, muncul dialog **Adopt existing data?**; setelah dikonfirmasi data itu ikut direktorat ini dan ditulis dengan ejaan master.

**Yang perlu diketahui**
- Perubahan pertama di tab ini membuat setting `directory_admin_managed` = true: sejak itu server tidak lagi menambahkan direktorat/divisi seed saat start (yang di-rename, di-merge atau dihapus tidak muncul kembali). Setting ini tidak bisa diubah lewat API setting.
- **Reset Default** Admin Parameters tidak lagi mereset daftar direktorat.
- Instalasi baru (seed) memakai nama Syariah Banking, **SLC**, Strategy & Finance, Treasury & Financial Institutions; database utama memakai nama lengkap "SLC ASG Satyaguna Langgeng Capital" (di-rename lewat menu ini).
- Semua perubahan tercatat di Audit Trail: `DIRECTORATE_CREATE`/`RENAME`/`DELETE`/`MERGE`, `DIVISION_CREATE`/`RENAME`/`DELETE`, `DIRECTORATE_ALIAS_ADD`/`REMOVE`, `DIVISION_ALIAS_ADD`/`REMOVE`.

### Pertanyaan template ESS (v2.51.0)

Pertanyaan default 11 metrik ESS (seed dan tombol **Reset to default** di Manage Questions) kini sama dengan kolom pertanyaan file template ESS (`docs/Template Survey.zip`, file `(ESS 2025 Result) <metrik>.xlsx`; metrik 9 = `docs/ESS 2025 Result_Role Clarity & DS Support.xlsx`), urut kolom G, H, I, semua bertipe Percentage. Pada 2026-10-21 Manage Questions ke-11 metrik di database utama di-reset ke template ini.

| Metrik | Pertanyaan (urut kolom) |
| :--- | :--- |
| 9 Role Clarity & DS Support | (G) I understand how my current job role contributes to a positive impact on customers and society. (H) Employees clearly understand what is expected of them. (I) My immediate manager gives me feedback that helps me improve my performance. |
| 13 Pride & Work Environment | (G) I am proud to work at CIMB. (H) People want to work here because of the culture and work environment. (I) I feel energized by my work. |
| 15 Manager Recognition | (G) My immediate manager recognizes me when I do a good job. |
| 16 Wellbeing | (G) CIMB cares about my well-being. (H) I can manage my job responsibilities in a way that enables healthy work-life balance. |
| 17 Psychological Safety | (G) At work, I can speak up with ideas or suggestions, even if others have different opinions. (H) Colleagues escalate issues even when these are outside their direct responsibilities. |
| 18 Leadership Connection | (G) Leaders help us understand and navigate changes happening in CIMB. (H) Leaders makes an effort to get input, ideas, and opinions from employees. |
| 21 Career Growth & Learning | (G) I have the opportunity to continually learn and grow. |
| 22 Capability & Enablement | (G) CIMB has employees with the right skills to deliver its strategy. (H) Employees have sufficient authority to make decisions. |
| 24 Performance Feedback Quality | (G) My immediate manager gives me feedback that helps me improve my performance. |
| 25 Meaningful Contribution | (G) My work gives me a feeling of personal accomplishment. |
| 27 Intent to Stay | (G) Even if offered a comparable role and compensation package at another company, I would choose to stay at CIMB. |

Template non-ESS di zip yang sama (Onboarding Day 1 Survey, Mandatory & Non Mandatory Learning) **belum** diterapkan - ditunda user sampai dikonfirmasi dengan penggunanya.

### Regression test tidak lagi mereset konfigurasi Admin & audit parameter (v2.51.0)

- **Masalah lama**: suite regression berjalan di database SQL yang sama dengan aplikasi; tes "Reset parameters to defaults" (Modul 16) dan tes lain mereset journey, checkpoint, metrik dan pertanyaan survei pada setiap run penuh. Itulah sebab nama metrik 8 dan pertanyaan ESS metrik 9 "kembali sendiri" - bukan karena sesi habis.
- **Sejak v2.51.0** suite menyimpan seluruh konfigurasi Admin (journey, checkpoint, metrik, target, pertanyaan survei, master questions, action library, app settings, direktorat + former names) sebelum modul pertama dan mengembalikannya persis setelah Modul 16, di akhir run, dan saat dihentikan (Ctrl+C). Run yang dimatikan paksa dipulihkan oleh run berikutnya dari `server/data/backups/regression-config-snapshot.json`.
- **Jangan mengedit Admin Parameters selama suite berjalan**: edit itu tertimpa saat konfigurasi dikembalikan di akhir run. Pengaman ini hanya untuk backend SQL; di backend JSON backup `server/data/store.json` sendiri sebelum menjalankan suite.
- **Audit**: perubahan metrik (field lama -> baru), journey, reset parameter, target, pertanyaan survei dan Email Settings (tanpa password) kini tercatat di Audit Trail (`METRIC_UPDATE`, `JOURNEY_UPDATE`, `PARAMETERS_RESET`, `METRIC_TARGETS_UPDATE`, `SURVEY_QUESTIONS_UPDATE`, `SETTINGS_CHANGE`, dst.). Action library dan master questions belum diaudit.
- **Perlu dicek**: edit Admin Parameters lain yang dibuat sebelum 2026-10-21 bisa sudah tereset oleh run suite sebelumnya dan saat itu tidak tercatat di audit. Periksa nilai yang pernah Anda ubah (nama/target/PIC metrik, pertanyaan, bobot) dan setel ulang bila perlu.

### Data Social Media Metrik 1 & Token Integrasi (v2.52.0)

> **Sejak v2.53.0 token integrasi dihapus**: tab **Integrations**, endpoint `POST /api/integrations/social-media` dan token tidak ada lagi (aplikasi on-premise tanpa internet). Data social media metrik 1 hanya diisi lewat **Mengunggah Excel** di bawah. Bagian token di bawah hanya riwayat.

Metrik 1 "Career website & social media follower, reach & engagement growth" bersifat **bankwide** (tanpa direktorat). Detailnya (tab **Internal Transaction Records**) menampilkan per platform per bulan: Followers, Follower growth %, Reach, Engagement, Engagement rate %, plus baris **All platforms** per bulan. **Skor metrik 1 tetap nilai yang Anda isi** di Admin Parameters (`raw_value`); data social media belum dipakai untuk menghitung skor.

**Arti kolom** (isi per platform per bulan): **Followers** = jumlah pengikut di akhir bulan; **Reach** = jangkauan selama bulan itu; **Engagement** = jumlah interaksi selama bulan itu. Follower growth % dan Engagement rate % dihitung aplikasi (growth dibanding bulan sebelumnya platform yang sama; rate = engagement / reach).

**Mengunggah Excel**
1. Buka **Explore Metrics** -> baris metrik 1 -> **Template** (atau dari detail metrik 1 -> tab Internal Transaction Records -> **Template**). File `Template_Social_Media_Metric_1.xlsx` berisi kolom Platform | Year | Month | Followers | Reach | Engagement dan satu baris per platform untuk bulan lengkap terakhir.
2. Isi angkanya. Boleh menambah baris untuk bulan lain (satu baris per platform per bulan). Platform: Instagram, LinkedIn, TikTok (IG, Insta, Linked In, TT juga dikenali). Month: nama bulan Inggris/Indonesia (March, Maret, Mar) atau 1-12. Angka bulat tanpa desimal; pemisah ribuan boleh.
3. Klik **Upload** -> pilih file `.xlsx` (maks. 5 MB; CSV dan `.xls` ditolak) -> **Upload**.
4. Bila ada kesalahan, **tidak ada yang disimpan**; daftar Row | Column | Problem menunjukkan sel yang harus diperbaiki. Perbaiki lalu unggah ulang seluruh file.
5. Bila sukses, tampil jumlah baris baru/diperbarui dan bulan yang diisi. Tab **History** menampilkan semua upload dan kiriman integrasi; file asli upload bisa diunduh lagi.

**Data asli menggantikan dummy**: Januari-September 2026 berisi data **fiktif** (badge **Dummy**). Begitu satu bulan diunggah (atau dikirim lewat integrasi), semua baris dummy bulan itu (ketiga platform) dihapus, jadi bulan itu hanya berisi data asli - unggah ketiga platform untuk bulan yang sama. Mengunggah ulang bulan yang sudah ada **memperbarui** angkanya. `SEED_DEMO_DATA=false` mencegah dummy ditambahkan saat server start; baris dummy yang sudah ada tetap sampai bulannya diisi data asli.

**Membuat token integrasi** (sistem internal lain mengirim data otomatis) - *dihapus di v2.53.0*
1. **Admin Parameters** -> tab **Integrations**.
2. Isi nama token (mis. nama sistem pengirim) -> **Create Token**.
3. Token tampil **sekali saja** di kotak kuning. Klik **Copy**, simpan, lalu **I have stored the token - hide it**. Aplikasi hanya menyimpan sidik jari (hash) token; token yang hilang tidak bisa ditampilkan lagi - buat token baru dan cabut yang lama.
4. Tab ini juga menampilkan alamat endpoint dan contoh curl (`Authorization: Bearer <token>`) untuk tim sistem pengirim.

**Menyerahkan token ke tim sistem lain secara aman**
- Kirim token lewat saluran internal yang aman (mis. password manager/vault tim, atau langsung ke admin sistem tersebut), **bukan** lewat e-mail biasa, chat grup, tiket, atau dokumen bersama. Jangan pernah menempelkan token ke dokumentasi, kode, atau screenshot.
- Satu token per sistem pengirim, agar bisa dicabut satu per satu dan Audit Trail menunjukkan siapa yang mengirim (`integration:<nama token>`).
- Minta tim itu menyimpan token di konfigurasi rahasia sistemnya (bukan di repository kode).
- Batas: maks. 500 baris per request dan 30 request per menit per token; token hanya bisa dipakai untuk endpoint data social media ini.

**Mencabut & menghapus token**: klik **Revoke** -> token langsung tidak berlaku (sistem pengirim mendapat 401). Token yang sudah dicabut bisa dihapus dari daftar dengan **Delete** (token aktif tidak bisa dihapus). Cabut segera bila token mungkin bocor, lalu buat token baru. Kolom **Last used** menunjukkan kapan token terakhir dipakai.

**Yang perlu diketahui**
- Aplikasi hanya **menerima** data; tidak pernah mengambil data sendiri dari Instagram, LinkedIn atau TikTok (tetap 100% on-premise). Sistem pengirim harus berada di jaringan internal.
- Upload, kiriman integrasi, pembuatan/pencabutan/penghapusan token tercatat di Audit Trail (`SOCIAL_MEDIA_UPLOAD`, `SOCIAL_MEDIA_INGEST`, `INTEGRATION_TOKEN_CREATE`/`REVOKE`/`DELETE`).
- Hanya Admin yang bisa mengunggah dan mengelola token; User melihat tabel yang sama (tanpa tombol), dan filter direktorat tidak mengubah isinya.
- Upload tidak mengubah tanggal data terakhir (`last_data_date`) metrik 1; ubah sendiri di Admin Parameters bila perlu.
- Token tidak ikut `npm run db:export`; setelah pindah database buat token baru. Menghapus metrik 1 tidak menghapus data social media-nya.

### Skor Bertingkat & Nilai Bulanan Metrik OUTCOME (v2.54.0)

**Mengatur tier skor** (saat ini metrik 1, 2, 3, 14)
1. **Admin Parameters** -> tab **Metric Parameters** -> **Edit** pada metrik.
2. Bagian **Score Tiers**: pilih **Unit** (`%` atau Number), isi 4 batas bawah tier 2, 3, 4, 5 (naik, > 0) dan operator `>=` (batas masuk tier atas) atau `>` (batas masih tier bawah). Pratinjau menunjukkan nilai -> tier -> skor / 5 -> % dan persentase target.
3. Centang **N/A (not configured)** bila tier belum diketahui: nilai metrik tampil N/A dan tidak dihitung di PX Index (contoh: metrik 2 Goes to Campus). Hapus centang dan isi batas untuk mengaktifkannya.
4. Simpan. Sejak v2.54.1 skor naik lurus di dalam setiap tier: tier 1 = nilai / batas tier 2; tier 2-4 = nomor tier + bagian jarak menuju batas berikutnya; tier 5 = 5. Skor % = skor / 5 x 100, maksimum 100%. Perhatikan **Min Threshold**: status CRITICAL dihitung terhadap threshold, bukan target (metrik 14: target 60% < threshold 75%; metrik 1: target = threshold 80%) - sesuaikan bila perlu.

**Mengunggah nilai bulanan metrik OUTCOME** (semua OUTCOME kecuali metrik 11, yang dihitung dari absensi event)
1. **Explore Metrics** -> baris metrik -> **Template** (atau dari detail metrik, bar Outcome Data Operations). File: Year | Month | Value | Notes, satu nilai bankwide per bulan; nilai dalam unit metrik (metrik % ditulis angka persen, mis. 0.66).
2. **Upload** -> pilih file `.xlsx` (maks. 5 MB). Satu kesalahan saja = seluruh file ditolak dan semua kesalahan ditampilkan per baris/kolom. Bulan setelah bulan berjalan ditolak; bulan yang sudah ada diperbarui.
3. Riwayat upload dan file asli ada di modal yang sama. Upload tercatat di Audit Trail (`OUTCOME_UPLOAD`).
4. Skor: YTD memakai nilai **bulan terakhir** yang diunggah dalam periode, MTD hanya bulan itu; periode tanpa bulan yang diunggah = No Data. Metrik yang belum pernah diunggah tetap memakai nilai `raw_value` di Admin Parameters. Kolom **Last Update** menunjukkan periode data terakhir setiap metrik.
5. Metrik 1: tombol **Upload** = nilai engagement rate yang dinilai; tombol **Social Media** = data Instagram/LinkedIn/TikTok (drilldown, v2.52.0).

**Evidence** (Admin saja): tombol **Evidence** di Explore Metrics/detail mengunduh CSV untuk periode yang dipilih - metrik OUTCOME: bulan tersimpan dengan kolom `Used_In_Score`; metrik 1 juga baris social media; metrik 11: daftar absensi event dengan identitas peserta (data pribadi - simpan sesuai aturan). File asli upload ada di `server/data/outcome-uploads/` (tidak ikut git maupun `.bak`; salin terpisah). Menghapus metrik ikut menghapus nilai bulanan, riwayat, dan file aslinya.

### Template Ringkasan Metrik & Saklar N/A (v2.55.0)

Template asli user: `docs/Template Survey/`. Format kolom: `docs/SURVEY_IMPORT_GUIDE.md`.

**Metrik 1 dan 3 (satu baris bulan per tahun)**
1. Explore Metrics -> baris metrik -> **Template**, pilih tahun. File: baris bulan Jan..Des, isi "-" untuk bulan tanpa data. Metrik %: tulis `3.87%` / `3.87`, atau sel angka Excel berformat persen.
2. **Upload** -> pilih tahun dan file. Upload tahun itu **mengganti semua bulan tahun itu**. Bulan setelah bulan berjalan yang berisi nilai ditolak.
3. Nilai metrik = rata-rata bulan terisi dalam periode (YTD) atau bulan itu (MTD), lalu dinilai lewat tier. Drilldown social media metrik 1 disembunyikan sementara.

**Metrik 5, 7, 12, 19, 20 (ringkasan per bagian)**
1. Explore Metrics -> baris metrik -> Template / Evidence / Upload (atau dari detail metrik) membuka modal **Summary Upload**; pilih bagian (metrik 7: Meet and Greet Satisfaction, Welcome Session, Onboarding Survey Day 1, Infrastructure & Application).
2. Upload file ringkasan `.xlsx` (maks. 5 MB). Data dibaca dari sheet "Pivot" (atau sheet pertama); sheet "Raw Data" tidak pernah dibaca. Metrik 19 dan 20 memakai file gabungan yang sama (`Mandatory & Non Mandatory Learning_PX.xlsx`) - unggah ke masing-masing metrik.
3. Upload ulang mengganti bulan-bulan yang ada di file untuk bagian itu saja. Satu kesalahan = seluruh file ditolak dengan daftar error.
4. **File asli tidak disimpan** (bisa memuat data pribadi di "Raw Data"): yang tercatat nama file, SHA-256, dan baris ringkasan; simpan file asli sesuai aturan unit. Upload tercatat di Audit Trail (`METRIC_PART_UPLOAD`).
5. Bagian tanpa data = N/A dan tidak dihitung; nilai metrik = rata-rata bagian yang punya data.

**Saklar "Real data not available yet"**: Admin Parameters -> Metric Parameters -> Edit -> centang **Real data not available yet (N/A, excluded from the PX Index)**. Metrik tampil N/A dan tidak dihitung; data tidak dihapus; Evidence tetap bisa diunduh. Saat ini aktif untuk metrik 4, 6, 8, 10, 23, 26 - hapus centang setelah data riil tersedia. Perubahan tercatat (`METRIC_UPDATE`).

### Tab History di detail metrik (v2.56.0)

Tab **History (n)** (dulu "Internal Transaction Records" / "Respondent Records & Answers") ada di detail setiap metrik dan menampilkan baris yang sama dengan file **Evidence** untuk periode yang dipilih (YTD/MTD Dashboard), terbaru dulu, dengan pencarian dan 50 baris per halaman.

| | History (tab) | Evidence (unduhan) |
| :--- | :--- | :--- |
| Siapa | semua yang bisa membuka detail metrik | Admin dan PIC metrik SURVEY |
| Isi | baris evidence; kolom teknis (Metric ID/Name, Upload ID, File SHA256, Updated At) disembunyikan | file CSV/ZIP lengkap |
| Identitas responden/peserta | Admin; PIC metrik SURVEY (cakupan sendiri) | sama |
| Direktorat | Admin: semua (tidak dipersempit filter direktorat Dashboard); USER: metrik karyawan hanya direktorat sendiri (tanpa baris Bankwide) | Admin: semua |

Metrik "Real data not available yet" (4, 6, 8, 10, 23, 26) menampilkan History kosong dengan alasannya; Evidence tetap bisa diunduh. Metrik 1 dan 3 menampilkan nilai per bulan plus baris "Average" per tahun.

### Summary Questions - pertanyaan template ringkasan (v2.57.0)

**Siapa**: Admin. Menu: **Admin Parameters** -> tab **Summary Questions**. Untuk template ringkasan metrik 5, 7 (4 bagian) dan 12; metrik 19/20 tidak punya kolom pertanyaan. Pertanyaan ESS tetap di Manage Questions; template tahunan metrik 1 dan 3 tidak punya pertanyaan.

1. Pilih **Template** (metrik - bagian).
2. Ubah teks, tipe (**Scale** = angka pada skala bagian, 1-5 atau 0-100% untuk metrik 12; **Text answer (not scored)** = jawaban bebas, hanya untuk evidence), urutan, atau tambah/hapus pertanyaan. Urutan = urutan kolom setelah skor (kolom E) di file. Metrik 12: isi pertanyaan **satu** event saja; nama event diambil dari file.
3. **Save Questions** (tercatat di Audit Trail `PART_QUESTIONS_UPDATE`). **Discard** membatalkan perubahan yang belum disimpan.
4. Unduh **Template** baru dari Explore Metrics; kolom pertanyaannya mengikuti konfigurasi.

**Saat upload**: kolom pertanyaan file dibaca berdasarkan posisi (kolom pertama setelah E = pertanyaan 1, dst.), bukan dari teks header. Jumlah kolom harus sama dengan jumlah pertanyaan, kalau tidak file ditolak dengan pesan yang menyebut kedua jumlah. Teks di kolom Scale ditolak (ubah tipenya ke Text bila memang jawaban bebas). Skor bagian tetap dari kolom E. File lama dengan susunan pertanyaan berbeda harus disesuaikan atau pertanyaannya diatur dulu.

**History / Evidence**: data yang sudah diunggah tetap memakai teks pertanyaan saat upload. Bila dalam periode yang dipilih ada lebih dari satu set pertanyaan, tab History menampilkan banner kuning "Question set changed: ..." dan tabel/CSV berubah menjadi satu baris per pertanyaan dengan kolom `Question_Set` (Set 1, Set 2, ...) dan `File_Header`.

Belum diatur saat rilis: Welcome Session dan Infrastructure & Application (metrik 7) belum punya pertanyaan - isi dulu sebelum mengunggah `2. Welcome Session.xlsx` (3 pertanyaan) / `4. Infrastructure & Application.xlsx` (6 pertanyaan).
