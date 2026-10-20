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

**Periode baca**: di v2.36.0 pilihan ini sempat menentukan periode filter MTD (Annual = Januari s.d. bulan terpilih). **Sejak v2.37.0 tidak lagi**: filter MTD selalu membaca hanya bulan terpilih untuk semua metrik Survey (metrik ESS: hanya hasil yang Month + Year di template-nya sama dengan bulan itu), jadi mengubah pilihan ini tidak mengubah nilai metrik; pilihan ini hanya dipakai pengingat e-mail (§7.2). Metrik tanpa data di periode terpilih tampil "No Data" dan tidak ikut indeks (lihat `docs/01` §4).

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

**Hak akses User**: melihat data direktoratnya (metrik non-karyawan tampil sebagai angka bankwide read-only), tanpa data per responden, tanpa menu admin/upload; Signature Event hanya baca kecuali User dari direktorat pengelola event (setting `event_manager_directorates`, default Human Resources — belum ada menu UI untuk mengubahnya). Cakupan data diatur seperti di bawah (sejak v2.27.0 divisi ikut menyaring data).

**Mengatur cakupan data User** (v2.27.0, di form tambah/ubah user):
1. Pilih role **User**, lalu di "Cakupan Data" pilih direktorat dari dropdown "+ Tambah direktorat ke cakupan". Ulangi untuk direktorat lain (satu User boleh banyak direktorat).
2. Untuk tiap direktorat pilih **Semua divisi** atau **Divisi tertentu** lalu centang divisi yang boleh dilihat. Hapus direktorat dengan ikon tempat sampah.
3. Simpan. Perubahan berlaku pada request User berikutnya — User tidak perlu login ulang. Perubahan tercatat di riwayat audit sebagai `USER_SCOPE_CHANGE`.

Yang dilihat User: pilihan filter "Semua cakupan saya" menampilkan **data gabungan** seluruh cakupan (sampel digabung, bukan rata-rata dari rata-rata). Skor, trend, detail metrik, alert, dan absensi/feedback event dibatasi ke cakupan; metrik non-karyawan/OUTCOME tetap tampil sebagai angka bankwide read-only. User yang cakupannya memuat direktorat pengelola event (setting `event_manager_directorates`, default Human Resources) dapat mengelola Signature Event. Mengubah role ke Admin menghapus cakupan; menurunkan ke User wajib mengisi cakupan.

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
1. Explore Metrics -> baris metrik ESS -> **Template (.xlsx)** (atau dari detail metrik / menu Survey Templates -> "Download ESS Template (.xlsx)"). File `Template_ESS_Metric_<id>.xlsx` sudah berisi header (nama index + pertanyaan aktif) dan nama Bankwide + 12 direktorat.
2. Isi kolom C Year, D Month (sama untuk semua baris), E Participation, F skor index (mis. `0.92` atau `92`) dan skor pertanyaan di kolom G dst. Baris direktorat tanpa data harus dihapus (baris yang hanya berisi nama + Level akan ditolak karena Year/Month/Participation/F kosong). Simpan sebagai **Excel Workbook (*.xlsx)**.
3. Klik **Upload** pada metrik itu -> pilih file `.xlsx` -> **Process ESS Summary & Recalculate PX Index**.
4. Hasil sukses menampilkan periode, jumlah baris, dan index Bankwide. Bila periode itu sudah pernah diunggah, datanya **diganti** (upload lama tetap ada di riwayat).
5. Bila ditolak, tidak ada yang tersimpan; perbaiki semua baris yang disebut di daftar error lalu unggah ulang.

**Yang perlu diketahui**
- CSV dan `.xls` tidak diterima untuk metrik ESS; template CSV master (`ALL`) tidak lagi memuat metrik ESS.
- Skor yang dipakai Dashboard adalah hasil ESS **terakhir sampai periode yang dilihat**, termasuk dari tahun sebelumnya. Contoh: YTD 2026 memakai hasil November 2025 sampai hasil 2026 diunggah.
- Filter direktorat memakai baris direktorat itu; filter divisi memakai baris direktorat induknya (detail metrik menampilkan catatan "ESS is reported at directorate level").
- Jumlah sampel = Participation. Ringkasan ESS hanya berisi % favorable; % neutral / % unfavorable tampil "—".
- **Evidence** metrik ESS = CSV baris ringkasan tersimpan semua periode beserta nama file dan pengunggahnya. PIC hanya mendapat direktorat dalam cakupannya (tanpa baris Bankwide).
- **Original File** di detail metrik mengunduh file asli yang diunggah (Admin atau PIC metrik itu). File asli disimpan di server di `server/data/ess-uploads/` (tidak bisa dibuka lewat `/uploads`); data seed tidak punya file asli. Folder ini tidak ikut backup database - backup terpisah (lihat `SQLServerDB.md` §16).
- Menghapus metrik ESS di Admin Parameters ikut menghapus hasil ESS dan file aslinya.
- Data ESS per responden lama dihapus sekali saat upgrade ke v2.32.0. Data saat ini (November 2025) adalah seed: metrik 9 = nilai file user, metrik ESS lain **dummy** - ganti dengan mengunggah hasil asli.
- **Pengingat e-mail**: metrik ESS bersifat tahunan dengan batas 25 November; mulai 25 November 2026 PIC akan menerima pengingat bila hasil ESS 2026 belum diunggah. Hasil ESS dianggap data bulan periodenya.

---

## Dashboard Exit Interview (v2.38.0)

**Siapa**: semua akun bisa membuka tab **Exit Interview** di Header. Admin melihat data bankwide dan mendapat toolbar data (template, upload, export, riwayat). User hanya melihat **agregat** direktorat dalam cakupannya (direktorat lain ditolak); tidak ada NIK, nama, atau jawaban terbuka yang dikirim ke User. Dari detail metrik 26 (Exit Survey) tombol **Open Exit Interview Dashboard** membuka tab yang sama.

**Filter**: memakai filter Header. YTD = Januari s.d. bulan berjalan tahun itu, MTD = satu bulan; periode dihitung dari **Effective Resignation Date**. Filter Directorate/Sub-Directorate memakai kolom Directorate/Division di file.

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
