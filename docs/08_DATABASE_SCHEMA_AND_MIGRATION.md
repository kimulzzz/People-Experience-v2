# 08 — Database Microsoft SQL Server: Skema, Migrasi & Rollback

> Berlaku sejak **v2.22.0** (2026-10-11). Seluruh data dashboard kini dapat dibaca dari / ditulis ke **Microsoft SQL Server** lokal. **Foto & video Signature Event tetap berupa file di disk** (`server/uploads/`); database hanya menyimpan **path**, metadata, dan transkrip AI-nya.

---

## 1. Ringkasan Arsitektur

```
 React (Vite :3000) ──/api──▶ Express (:5000) ──▶ server/db/storage.js  (dispatcher)
                                                      │  STORAGE_BACKEND=sql  → sqlStorage.js  → Microsoft SQL Server (PeopleExperiencePX)
                                                      │  STORAGE_BACKEND=json → jsonStorage.js → server/data/store.json   (default / rollback)
```

- `server/db/storage.js` hanya memilih backend berdasarkan `STORAGE_BACKEND` (`sql` | `json`, default `json`). Semua pemanggil (`server.js` + 8 service) memakai **`await storage.x()`** — kontraknya identik di kedua backend, sehingga backend dapat ditukar tanpa mengubah kode lain.
- `sqlStorage.js` **tidak menyimpan cache** — setiap pembacaan adalah query ke SQL Server (parameterized, via `mssql`); penulisan multi-tabel memakai transaksi; pelanggaran `UNIQUE` diterjemahkan menjadi pesan error Indonesia yang sama seperti backend JSON.
- `filterUtils.js` berisi parser filter periode/direktorat (`YTD`, `MTD`, `endMonth`, direktorat, sub-direktorat) yang **dipakai bersama** kedua backend agar aturannya tidak bisa menyimpang.
- Saat server menyala dengan `STORAGE_BACKEND=sql`: membuka connection pool → menjalankan `schema.sql` (idempoten) → mengisi seed bila database kosong → menambah bulan seed baru bila kalender maju. Bila SQL Server tidak dapat dihubungi, server **berhenti dengan pesan jelas** (tidak diam-diam jatuh ke JSON, agar data tidak terpecah dua).
- `GET /api/health` → `database` kini melaporkan kondisi **nyata** backend (untuk SQL: query langsung — nama server, database, edisi, versi, jumlah baris tabel kunci).

---

## 2. Instalasi SQL Server (sekali saja)

Dijalankan lewat **PowerShell as Administrator** (UAC akan muncul sekali):

```powershell
powershell -ExecutionPolicy Bypass -File "scripts\sqlserver\Setup-SqlServer.ps1"
```

Script `scripts/sqlserver/Setup-SqlServer.ps1` (idempoten, log di `scripts/sqlserver/setup.log`):

1. Memasang **SQL Server Express** via `winget` (installer resmi Microsoft) bila belum ada instance.
   *Catatan versi:* tautan installer **SQL Server 2022 Express** sudah mati (HTTP 404 pada manifest winget dan fwlink lama kini mengarah ke 2025), sehingga yang terpasang adalah edisi Express terbaru gratis (**2025**, instance `SQLEXPRESS`). Aplikasi hanya memakai T-SQL standar, jadi versi tidak berpengaruh.
2. Mengaktifkan **Mixed Mode** (SQL Authentication) dan mengunci **TCP/IP di port 1433**, lalu restart service.
3. Dengan identitas Windows administrator (*Integrated Security* — **tanpa password `sa`**) membuat database `PeopleExperiencePX` dan login khusus **`px_app`** yang hanya `db_owner` di database itu (bukan sysadmin, bukan `sa`).
4. Menulis `DB_SERVER`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` (acak 31 karakter), `DB_ENCRYPT`, `DB_TRUST_SERVER_CERTIFICATE` ke `.env` (git-ignored). `STORAGE_BACKEND` **tidak** disentuh.

> Edisi: Standard berlisensi berbayar dan tidak punya unduhan gratis, sehingga disepakati memakai **Express** (gratis, sah untuk produksi; batas 10 GB/database, 1 CPU socket, 1 GB buffer — jauh di atas kebutuhan aplikasi ini).

---

## 3. Skema (`server/db/schema.sql` — 28 tabel, prefix `px_`)

| Kelompok | Tabel | Catatan |
| :--- | :--- | :--- |
| Parameter | `px_journeys`, `px_checkpoints`, `px_metrics` (kolom `unit` = satuan nilai aktual, v2.25.0), `px_metric_targets` | Target hanya ada di `px_metric_targets` (JSON menggandakannya di metric). Bobot hanya di `px_metrics.weight` — **tabel `weights` dihapus** (duplikat murni). Sengaja **tanpa FK** antar-tiga tabel ini (admin boleh menghapus journey tanpa menyentuh metric — sama seperti perilaku JSON). |
| Referensi | `px_directorates`, `px_divisions`, `px_action_library` | Direktorat/divisi memakai surrogate key + `UNIQUE` nama. |
| Pertanyaan | `px_master_survey_questions`, `px_event_questions`, `px_survey_questions` | Pertanyaan event = salinan (snapshot) per event. **`px_survey_questions`** = set pertanyaan setiap metric SURVEY (1 baris/pertanyaan, kolom `is_customized`); di-seed sekali dari template kode, setelahnya dibaca hanya dari SQL (v2.22.1). |
| Reminder | `px_reminder_log` | Catatan tiap email reminder upload survei ke PIC (metrik, periode yang kosong, tanggal, SENT/FAILED) — dasar pencegah duplikat & pengulangan. Ikut terhapus bersama metriknya. |
| Email | `px_email_settings` | 1 baris: akun pengirim reminder ke PIC (menu "Setting Email"). Password dienkripsi AES-256-GCM (`server/services/secretBox.js`); kunci `SETTINGS_ENCRYPTION_KEY` ada di `.env` dan harus ikut dibackup. |
| Pengaturan | `px_app_settings` | Nilai yang ditampilkan di UI dan dikelola admin (JSON): `px_index_target` (garis target chart), `event_program_categories`, `event_types`, serta katalog pilihan `metric_types`, `scale_types`, `target_audiences`, `update_frequencies`, `question_types` (hanya label yang boleh diubah). API: `GET /api/settings`, `PUT /api/admin/settings/:key`. |
| Signature Event | `px_events`, `px_attendances`, `px_feedback_responses`, `px_media` | `UNIQUE(event_id, nip)` pada absensi & feedback (NIP tetap kunci utama responden). FK `ON DELETE CASCADE` ke `px_events`. **`px_media.file_path`** = path file di disk (mis. `/uploads/media-….mp4`) + `caption`, `ai_generated_description`, `transcript`, `transcript_segments` (JSON), `transcript_status`, `duration_seconds`. |
| Survei | `px_survey_uploads`, `px_survey_uploaded_responses`, `px_acknowledged_alerts` | Responden **dinormalisasi** (lihat bawah). Index `(metric_id, survey_date)` dan `(org_unit_1, org_unit_2)`. |
| Login (v2.26.0) | `px_users`, `px_sessions`, `px_audit_log` | `px_users`: `username` UNIQUE (NIP/nama login), `password_hash` (scrypt, tidak pernah dikembalikan API), `role` CHECK `ADMIN`/`USER`, `directorate`/`division` (nama, NULL untuk Admin), `is_active`, `must_change_password`, `failed_attempts`, `locked_until`, `last_login_at`. `px_sessions`: PK `token_hash` (**SHA-256 token cookie**, bukan token-nya), `expires_at`, FK ke user `ON DELETE CASCADE`. `px_audit_log`: waktu, user, `action`, `target`, `ip` — tanpa secret. Dibuat idempoten saat boot/`applySchema()`. |
| Drilldown OUTCOME | `px_recruitment_sla_by_unit`, `px_approval_stage_compliance`, `px_hiring_channel_mix`, `px_recognition_categories`, `px_attrition_by_tenure` | Menggantikan objek `operationalRecords` (5 bentuk kolom berbeda dalam satu objek). |

**Normalisasi responden** (`px_survey_uploaded_responses`): alias `nip` / `participant_id` / `candidate_id` (dan `directorate`/`university`/`applied_position`, `division`/`major`/`recruitment_channel`) diringkas menjadi `respondent_type` (`EMPLOYEE` | `CAMPUS_STUDENT` | `JOB_CANDIDATE`) + `respondent_id/name/email` + `org_unit_1/org_unit_2`. `sqlStorage.js › rowToResponse()` menurunkan kembali nama-nama field lama untuk `calculationEngine`, `alertEngine`, evidence CSV, dst. — sehingga tidak ada kode lain yang berubah.

Tipe data: tanggal survei = `DATE`; timestamp sistem = `DATETIME2(3)` (UTC); `event_date` disimpan apa adanya dari form (`NVARCHAR(40)`); `ratings`/`underlying_questions`/segmen transkrip = JSON di `NVARCHAR(MAX)`.

---

## 4. Memindahkan Data JSON → SQL Server (`server/db/migrate.js`)

```bash
npm run db:migrate                    # buat skema + muat store.json (menolak bila DB sudah berisi data)
node server/db/migrate.js --reset     # HAPUS semua tabel px_* lalu muat ulang dari store.json
node server/db/migrate.js --file X    # migrasi dari file store lain (mis. backup)
```

- **Hanya membaca** `store.json` — file JSON tidak pernah diubah, tetap menjadi fallback yang valid.
- Satu transaksi; mencetak tabel perbandingan **JSON vs SQL** per kelompok data (terverifikasi seluruhnya `OK`: 5 journey, 17 checkpoint, 27 metric, 7 direktorat, 2 event, 5 absensi, 3 feedback, 4 media, 16 upload, **5.040 respons survei**, 18 record operasional).
- Urutan baris respons dipertahankan (penting: "respons terakhir" dipakai untuk `last_survey_date`). Baris yatim (event sudah tidak ada) dilewati dan dilaporkan.
- ID absensi/feedback dipertahankan; `response_id` survei dinomori ulang berurutan.

Mengaktifkan: set `STORAGE_BACKEND=sql` di `.env`, lalu restart (`npm run dev`).

---

## 5. Rollback ke Versi Sebelum SQL Server

Tiga lapis, dari yang paling ringan:

| # | Situasi | Langkah |
| :-: | :--- | :--- |
| 1 | SQL Server bermasalah, data JSON lama masih cukup | Ubah `.env` → `STORAGE_BACKEND=json` (atau hapus barisnya), restart. Selesai — `store.json` tidak pernah disentuh oleh mode SQL. |
| 2 | SQL Server bermasalah **tetapi ada edit baru yang harus dibawa** | (server dihentikan) `npm run db:export -- --replace` → membuat backup `store.json` ke `server/data/backups/` lalu menimpa `store.json` dengan seluruh isi SQL; lalu `STORAGE_BACKEND=json` + restart. Tanpa `--replace`, hasil ekspor ditulis ke `server/data/store.from-sql.json` (aman, tidak menimpa apa pun). Teruji: hasil ekspor yang dilayani backend JSON memberi output API **identik 58/58 endpoint** dengan SQL. |
| 3 | Kembali ke **kode** sebelum migrasi | `git checkout pre-sqlserver-v2.21.0` (tag dibuat sebelum pekerjaan ini; sudah di-push). Backup data: `server/data/backups/store.pre-sqlserver-2026-10-11.json` (lokal, git-ignored). |

SQL Server sendiri dapat dihentikan tanpa efek pada mode JSON: `Stop-Service 'MSSQL$SQLEXPRESS'`.

---

## 6. Operasional

| Kebutuhan | Cara |
| :--- | :--- |
| Cek koneksi & jumlah baris | `GET http://localhost:5000/api/health` → `database` |
| Reset database ke data awal bersih | `node server/db/migrate.js --reset` |
| Backup database | `BACKUP DATABASE PeopleExperiencePX TO DISK = N'D:\backup\px.bak'` (jalankan sebagai Windows admin / sysadmin) atau `npm run db:export` |
| Masuk manual ke database | SSMS / Azure Data Studio → server `localhost,1433`, login `px_app` (password: `DB_PASSWORD` di `.env`) |
| Service | `Get-Service 'MSSQL$SQLEXPRESS'` — sudah *Automatic (Delayed Start)* sehingga hidup otomatis setelah restart PC |

Keamanan (sesuai batasan *100% on-premise*): seluruh data tetap di mesin ini; login aplikasi `px_app` hanya `db_owner` di `PeopleExperiencePX` (tanpa hak server); `sa` berstatus **disabled** (tidak pernah diberi password — terverifikasi lewat `sys.server_principals`); kredensial hanya di `.env` (git-ignored). TCP/IP port 1433 diaktifkan pada instance — untuk PC yang terhubung jaringan, pastikan Windows Firewall tidak membuka port 1433 ke luar (default Windows memblokir inbound tanpa aturan eksplisit; script ini tidak membuat aturan firewall).

---

## 7. Pengujian

`node tests/regressionTest.js` (99 test; Modul 28 baru memeriksa backend aktif) lulus **99/99 di backend SQL (2× berturut-turut)** dan di backend JSON. Selain itu perbandingan otomatis dua backend yang berjalan berdampingan terhadap data identik: **58/58 endpoint GET menghasilkan JSON identik** (dashboard YTD/MTD/2025/filter direktorat, trend lintas tahun, 27 drilldown metric, parameter, event, evidence CSV, alerts). Lihat juga `docs/07` §11.

---

## 8. Pembaruan v2.22.1 — Audit Sumber Data

Hasil audit `auditor` (semua data dashboard harus dari SQL Server) dan perbaikannya ada di `CHANGELOG.md` **[2.22.1]**. Ringkasnya: katalog pertanyaan survei dipindah ke `px_survey_questions`; target PX Index & opsi dropdown event ke `px_app_settings`; 16 unit organisasi yang dipakai responden ditambahkan ke `px_directorates`/`px_divisions` (dijalankan otomatis saat boot, tidak pernah menghapus/mengubah entri admin); set `SEED_DEMO_DATA=false` di produksi agar respons survei demo tidak dibuat untuk bulan baru. Database v2.22.0 yang sudah ada otomatis ter-upgrade saat server dinyalakan (tabel lama `px_custom_survey_questions` dihapus).

---

## 9. Pembaruan v2.26.0 — Akun Login

- Tiga tabel baru (`px_users`, `px_sessions`, `px_audit_log`) dan setting baru di `px_app_settings`: `session_hours`, `login_max_attempts`, `login_lockout_minutes`, `login_rate_limit_per_minute`, `event_manager_directorates`. Database yang ada ter-upgrade otomatis saat server dinyalakan.
- **`node server/db/migrate.js --reset` TIDAK menghapus akun**: `dropAllTables()` sengaja tidak memuat tiga tabel login, jadi akun, sesi, dan audit login bertahan.
- **`npm run db:export` / `importStore` tidak memuat akun** (bukan bagian `store.json`). Untuk memindahkan akun, gunakan backup database (`.bak`) atau buat ulang dengan `npm run auth:create-admin` + menu Kelola User.
- **Backend JSON** (jalur rollback) menyimpan akun, sesi, dan audit di **`server/data/auth.json`** (di-`.gitignore`, terpisah dari `store.json` yang dikomit). Akun di SQL dan di `auth.json` adalah dua daftar terpisah: setelah rollback ke JSON, buat Admin lagi dengan `npm run auth:create-admin`.
- `auth.json` dan tabel `px_users` memuat hash password — perlakukan seperti data rahasia saat backup.
