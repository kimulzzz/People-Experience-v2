# SQLServerDB.md — Pengaturan Microsoft SQL Server (PX Dashboard)

Dokumen ini adalah **ringkasan setting & operasional database SQL Server** untuk aplikasi People Experience (PX).
Detail skema tabel, proses migrasi, dan rollback ada di [`docs/08_DATABASE_SCHEMA_AND_MIGRATION.md`](docs/08_DATABASE_SCHEMA_AND_MIGRATION.md).

> **Password tidak ditulis di dokumen ini.** Password ada di file `.env` (baris `DB_PASSWORD`), file itu di-*gitignore* dan tidak boleh di-commit.

---

## 1. Identitas Server & Database

| Item | Nilai |
| :--- | :--- |
| Produk | Microsoft SQL Server **Express** (gratis, sah untuk produksi) |
| Versi terpasang | 17.0.1000.7 (SQL Server 2025 Express) — installer 2022 Express sudah tidak tersedia dari Microsoft |
| Nama instance | `SQLEXPRESS` → nama server penuh `DESKTOP-04SQPFF\SQLEXPRESS` |
| Windows service | `MSSQL$SQLEXPRESS` (start type: Automatic / Delayed Start) |
| Alamat koneksi | `localhost,1433` (TCP/IP aktif, port statis 1433) |
| Database aplikasi | `PeopleExperiencePX` |
| Mode autentikasi | Mixed Mode (SQL Authentication + Windows Authentication) |
| Login aplikasi | `px_app` — hanya `db_owner` di `PeopleExperiencePX` (tanpa hak server) |
| Login `sa` | **Disabled** (tidak pernah diberi password) |
| Login Windows | akun administrator PC (`DESKTOP-04SQPFF\Lenovo`) tetap bisa masuk sebagai sysadmin |
| Batas edisi Express | 10 GB per database, 1 socket CPU, 1 GB buffer pool |
| Lokasi file data | folder instance default: `C:\Program Files\Microsoft SQL Server\MSSQL17.SQLEXPRESS\MSSQL\DATA\` |

---

## 2. Setting Aplikasi (`.env`)

Template ada di `.env.example`. Nilai aktual ditulis otomatis oleh `scripts/sqlserver/Setup-SqlServer.ps1`.

| Variabel | Nilai | Keterangan |
| :--- | :--- | :--- |
| `STORAGE_BACKEND` | `sql` | `sql` = SQL Server, `json` = file `server/data/store.json` (jalur rollback) |
| `DB_SERVER` | `localhost` | |
| `DB_PORT` | `1433` | |
| `DB_NAME` | `PeopleExperiencePX` | |
| `DB_USER` | `px_app` | |
| `DB_PASSWORD` | *(lihat `.env`)* | acak 31 karakter, dibuat oleh script setup |
| `DB_ENCRYPT` | `false` | koneksi lokal pada mesin yang sama |
| `DB_TRUST_SERVER_CERTIFICATE` | `true` | |
| `SETTINGS_ENCRYPTION_KEY` | *(otomatis, lihat `.env`)* | kunci AES-256 yang mengenkripsi password email di tabel `px_email_settings`; **simpan bersama backup database** — tanpa kunci ini password tidak bisa didekripsi |
| `SEED_DEMO_DATA` | `true` | `false` = jangan buat respons survei demo untuk bulan baru (pakai di produksi) |

Pilihan backend dibaca saat server menyala — **ubah `.env` lalu restart** (`npm run dev`).

---

## 3. Instalasi / Pemasangan Ulang

Jalankan **PowerShell as Administrator** (UAC akan muncul sekali):

```powershell
powershell -ExecutionPolicy Bypass -File "scripts\sqlserver\Setup-SqlServer.ps1"
```

Script ini idempoten (aman diulang) dan mencatat ke `scripts/sqlserver/setup.log`. Urutannya: pasang SQL Server Express via `winget` → aktifkan Mixed Mode + TCP 1433 → buat database & login `px_app` memakai Windows Authentication (tanpa `sa`) → tulis `DB_*` ke `.env`. `STORAGE_BACKEND` tidak diubah oleh script.

Setelah database kosong siap, isi dengan data:

```bash
npm run db:migrate                 # muat server/data/store.json ke SQL Server
node server/db/migrate.js --reset  # HAPUS semua tabel px_* lalu muat ulang (kembali ke data bersih)
```

Lalu set `STORAGE_BACKEND=sql` di `.env` dan restart server.

---

## 4. Cara Mengakses Database

| Alat | Langkah |
| :--- | :--- |
| **SSMS** (belum terpasang) | `winget install --id Microsoft.SQLServerManagementStudio.22 -e` → Server `localhost,1433` → SQL Server Authentication → login `px_app` + password dari `.env` |
| **Windows Authentication** | di SSMS pilih *Windows Authentication* (akun Windows administrator) — akses penuh ke seluruh server |
| **Cek dari aplikasi** | `http://localhost:5000/api/health` → bagian `database` (server, edisi, jumlah baris tabel kunci) |

Tabel aplikasi berawalan `px_` (24 tabel). Yang paling sering dilihat: `px_metrics`, `px_metric_targets`, `px_survey_uploaded_responses`, `px_events`, `px_attendances`, `px_feedback_responses`, `px_media` (kolom `file_path` + `transcript`).

> Jangan mengubah data langsung lewat SSMS tanpa alasan kuat — validasi dan perhitungan skor berjalan di aplikasi.

---

## 5. Foto & Video

File foto/video Signature Event **tidak disimpan di database**. File tetap di disk (`server/uploads/`, disajikan di `/uploads/...`). Tabel `px_media` hanya menyimpan **path** (`file_path`), nama file, caption, deskripsi/transkrip AI, status transkrip, dan durasi. Menghapus media lewat aplikasi menghapus baris + file fisiknya.

---

## 6. Backup & Restore

| Kebutuhan | Cara |
| :--- | :--- |
| Backup database (`.bak`) | di SSMS: klik kanan database → Tasks → Back Up; atau T-SQL: `BACKUP DATABASE PeopleExperiencePX TO DISK = N'D:\backup\px.bak' WITH INIT, COMPRESSION;` (jalankan sebagai Windows admin) |
| Restore | `RESTORE DATABASE PeopleExperiencePX FROM DISK = N'D:\backup\px.bak' WITH REPLACE;` (hentikan aplikasi dulu) |
| Salinan format JSON | `npm run db:export` → `server/data/store.from-sql.json` (tidak menimpa apa pun) |
| Backup file foto/video | salin folder `server/uploads/` (tidak ikut backup database) |

---

## 7. Rollback ke Mode JSON

1. **Cepat:** `.env` → `STORAGE_BACKEND=json`, restart. Memakai `store.json` seperti saat migrasi.
2. **Bawa edit terbaru dari SQL:** hentikan server → `npm run db:export -- --replace` (otomatis backup `store.json` ke `server/data/backups/`) → `STORAGE_BACKEND=json` → restart.
3. **Kode versi sebelum SQL Server:** `git checkout pre-sqlserver-v2.21.0`.

---

## 8. Troubleshooting

| Gejala | Penyebab umum | Solusi |
| :--- | :--- | :--- |
| Server aplikasi berhenti saat start: *"Storage backend failed to start"* | Service SQL Server mati / password salah / port berubah | `Get-Service 'MSSQL$SQLEXPRESS'` → `Start-Service 'MSSQL$SQLEXPRESS'`; cek `DB_*` di `.env`. Darurat: `STORAGE_BACKEND=json` |
| `Login failed for user 'px_app'` | password di `.env` tidak sama dengan login | jalankan ulang `Setup-SqlServer.ps1` (menyinkronkan keduanya) |
| `Failed to connect ... 1433` | TCP/IP mati atau port berubah | jalankan ulang script setup (mengunci port 1433 + restart service) |
| Data uji menumpuk setelah regression test | test menulis ke backend aktif | `node server/db/migrate.js --reset` |
| `/api/health` menunjukkan `MS SQL Server (ERROR)` | koneksi putus saat berjalan | periksa service, lalu restart aplikasi |

---

## 9. Keamanan (batasan 100% on-premise)

- Seluruh data tetap di PC ini; tidak ada koneksi ke layanan cloud.
- Aplikasi memakai login `px_app` (tanpa hak server); `sa` disabled; kredensial hanya di `.env`.
- TCP 1433 aktif pada instance. Script setup **tidak** membuat aturan firewall; pastikan Windows Firewall tidak membuka port 1433 ke jaringan luar bila PC terhubung ke jaringan.
- NIP tetap kunci unik responden (`UNIQUE(event_id, nip)` pada absensi & feedback).

---

## 10. Data yang Dikelola dari Database (bukan kode)

| Data | Tabel | Cara mengubah |
| :--- | :--- | :--- |
| Pertanyaan survei tiap metric | `px_survey_questions` | menu Survey Templates / Question Settings (tombol "Reset" mengembalikan template default) |
| Target PX Index (garis chart), opsi kategori & format event | `px_app_settings` | `PUT /api/admin/settings/:key` (mis. `{"value": 90}`) atau langsung di tabel |
| Direktorat & divisi (filter Header, form check-in) | `px_directorates`, `px_divisions` | langsung di tabel; entri seed yang hilang ditambahkan otomatis saat server start |
| Akun pengirim email reminder PIC (password terenkripsi) | `px_email_settings` | menu **Setting Email** di Header |
| Daftar pilihan Parameter Admin & Survey Questions (tipe metrik, skala, responden, frekuensi, tipe pertanyaan) | `px_app_settings` | `PUT /api/admin/settings/:key` (hanya label) |
| Parameter journey/checkpoint/metric/target/bobot | `px_journeys`, `px_checkpoints`, `px_metrics`, `px_metric_targets` | menu Parameter Admin |

> **Perhatian:** `node server/db/migrate.js --reset` menghapus semua tabel `px_*` termasuk `px_email_settings` — pengaturan email harus diisi ulang setelahnya.
