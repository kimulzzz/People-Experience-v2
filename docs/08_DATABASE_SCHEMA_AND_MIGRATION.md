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

## 3. Skema (`server/db/schema.sql` — 32 tabel sejak v2.38.0, prefix `px_`)

| Kelompok | Tabel | Catatan |
| :--- | :--- | :--- |
| Parameter | `px_journeys`, `px_checkpoints`, `px_metrics` (kolom `unit` = satuan nilai aktual, v2.25.0; kolom `survey_source` = sumber survei SYSTEM/ESS, v2.29.0), `px_metric_targets` | Target hanya ada di `px_metric_targets` (JSON menggandakannya di metric). Bobot hanya di `px_metrics.weight` — **tabel `weights` dihapus** (duplikat murni). Sengaja **tanpa FK** antar-tiga tabel ini (admin boleh menghapus journey tanpa menyentuh metric — sama seperti perilaku JSON). |
| Referensi | `px_directorates`, `px_divisions`, `px_action_library` | Direktorat/divisi memakai surrogate key + `UNIQUE` nama. |
| Pertanyaan | `px_master_survey_questions`, `px_event_questions`, `px_survey_questions` | Pertanyaan event = salinan (snapshot) per event. **`px_survey_questions`** = set pertanyaan setiap metric SURVEY (1 baris/pertanyaan, kolom `is_customized`); di-seed sekali dari template kode, setelahnya dibaca hanya dari SQL (v2.22.1). |
| Reminder | `px_reminder_log` | Catatan tiap email reminder upload survei ke PIC (metrik, periode yang kosong, tanggal, SENT/FAILED) — dasar pencegah duplikat & pengulangan. Ikut terhapus bersama metriknya. |
| Email | `px_email_settings` | 1 baris: akun pengirim reminder ke PIC (menu "Email Settings"; sebelum v2.30.0 bernama "Setting Email"). Password dienkripsi AES-256-GCM (`server/services/secretBox.js`); kunci `SETTINGS_ENCRYPTION_KEY` ada di `.env` dan harus ikut dibackup. |
| Pengaturan | `px_app_settings` | Nilai yang ditampilkan di UI dan dikelola admin (JSON): `px_index_target` (garis target chart), `px_index_weights` (bobot Survey/Outcome PX Index, v2.48.0), `event_program_categories`, `event_types`, serta katalog pilihan `metric_types`, `scale_types`, `target_audiences`, `update_frequencies`, `question_types` (hanya label yang boleh diubah). API: `GET /api/settings`, `PUT /api/admin/settings/:key`. |
| Signature Event | `px_events`, `px_attendances`, `px_feedback_responses`, `px_media` | `UNIQUE(event_id, nip)` pada absensi & feedback (NIP tetap kunci utama responden). FK `ON DELETE CASCADE` ke `px_events`. **`px_media.file_path`** = path file di disk (mis. `/uploads/media-….mp4`) + `caption`, `ai_generated_description`, `transcript`, `transcript_segments` (JSON), `transcript_status`, `duration_seconds`, serta (v2.28.0) 8 kolom AI Summary `summary_*` (lihat §13). |
| Survei | `px_survey_uploads`, `px_survey_uploaded_responses`, `px_acknowledged_alerts` | Responden **dinormalisasi** (lihat bawah). Index `(metric_id, survey_date)` dan `(org_unit_1, org_unit_2)`. Sejak v2.50.0 `px_survey_uploads.questions_snapshot_json` menyimpan set pertanyaan upload (§23). |
| Ringkasan ESS (v2.32.0) | `px_ess_results` | Data metrik ESS: satu baris per unit org (Bankwide / direktorat) per metrik dan periode, dari file ringkasan `.xlsx` yang diunggah. Batch upload-nya tetap di `px_survey_uploads`. Lihat §17. |
| Exit Interview (v2.38.0) | `px_exit_interviews`, `px_exit_interview_uploads` | Satu baris per exit karyawan dari file "Termination Report" `.xlsx` + direktorat/divisi; `UNIQUE (nik, effective_date)` (upload ulang = update). Berisi **data per karyawan** (NIK, nama, jawaban terbuka). Tidak dipakai perhitungan skor. Lihat §18. |
| Login (v2.26.0) | `px_users`, `px_sessions`, `px_audit_log` | `px_users`: `username` UNIQUE (NIP/nama login), `password_hash` (scrypt, tidak pernah dikembalikan API), `role` CHECK `ADMIN`/`USER`, `directorate`/`division` (nama, NULL untuk Admin), `is_active`, `must_change_password`, `failed_attempts`, `locked_until`, `last_login_at`, `menu_access` (v2.49.0; JSON, NULL = default). `px_sessions`: PK `token_hash` (**SHA-256 token cookie**, bukan token-nya), `expires_at`, FK ke user `ON DELETE CASCADE`. `px_audit_log`: waktu, user, `action`, `target`, `ip` — tanpa secret. Dibuat idempoten saat boot/`applySchema()`. |
| Cakupan User (v2.27.0) | `px_user_scopes` | `user_id` FK ke `px_users` `ON DELETE CASCADE`, `directorate`, `division` (**NULL = semua divisi** direktorat itu), `UNIQUE(user_id, directorate, division)`. Kolom `px_users.directorate`/`division` (v2.26.0) **legacy: tidak ditulis/dipakai lagi**. Dibuat idempoten saat boot. |
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

---

## 12. Pembaruan v2.27.0 — Cakupan Data User

- Tabel baru `px_user_scopes` (total 29). Cakupan User = baris-baris tabel ini; `division` NULL = semua divisi. Kolom `px_users.directorate`/`division` tidak dipakai lagi (dibiarkan agar upgrade/rollback aman).
- **Migrasi otomatis saat boot**: `sqlStorage.migrateLegacyUserScopes()` mengubah akun v2.26.0 (User dengan `directorate`, divisi kosong = semua divisi) menjadi baris cakupan. Hanya menyentuh User yang belum punya baris cakupan, jadi aman dijalankan tiap boot dan tidak menimpa pengaturan Admin; Admin tidak mendapat cakupan. Backend JSON memakai `legacyUserScopes()` saat `auth.json` dimuat.
- `node server/db/migrate.js --reset` tetap **tidak** menghapus akun maupun `px_user_scopes` (dropAllTables tidak memuat tabel login). Perlakukan `px_user_scopes` sebagai bagian backup akun.

---

## 13. Pembaruan v2.28.0 — Kolom AI Summary pada `px_media`

- Delapan kolom baru (semua `NULL`): `summary` (`NVARCHAR(MAX)`), `summary_points` (`NVARCHAR(MAX)`, array JSON), `summary_status` (`VARCHAR(20)`: `PROCESSING|DONE|FAILED|INSUFFICIENT`), `summary_source` (`VARCHAR(10)`: `AI|RULE`), `summary_model` (`VARCHAR(60)`), `summary_language` (`VARCHAR(10)`), `summary_generated_at` (`DATETIME2(3)`), `summary_error` (`NVARCHAR(500)`). Jumlah tabel tetap 29.
- Ditambahkan di `schema.sql` per kolom dengan `IF COL_LENGTH(N'dbo.px_media', N'<kolom>') IS NULL ALTER TABLE ... ADD ...`, sehingga aman diulang dan aman pada database yang sudah memiliki sebagian kolom — database pengguna sudah punya 7 kolom `summary_*` sisa percobaan v2.26.0 (menurut laporan developer/QC; tidak diperiksa langsung oleh penulis dokumen ini).
- `sqlStorage.rowToMedia` hanya mengisi field `summary_*` bila `summary_status` tidak NULL; `updateMedia` menerima kedelapan field; `importStore` (`db:migrate`) ikut memuatnya. Backend JSON menyimpannya di record media `store.json` (whitelist `updateMedia`).
- Rollback ke JSON tidak memerlukan langkah khusus.

---

## 14. Pembaruan v2.29.0 - Kolom `px_metrics.survey_source`

- Satu kolom baru: `survey_source VARCHAR(10) NULL` dengan `CHECK` bernama `CK_px_metrics_survey_source` (`survey_source IN ('SYSTEM', 'ESS')`; `NULL` lolos `CHECK`). Hanya bermakna untuk metrik SURVEY; OUTCOME = `NULL`. Jumlah tabel tetap 29.
- `schema.sql`: kolom (beserta `CHECK`) ada di `CREATE TABLE` dan ditambahkan pada database lama lewat `IF COL_LENGTH(N'dbo.px_metrics', N'survey_source') IS NULL ALTER TABLE ... ADD ...` - aman diulang.
- **Top-up saat boot** (`sqlStorage.init()`, berurutan setelah `topUpMetricUnits()`): `topUpSurveySource()` mengisi HANYA baris SURVEY ber-`survey_source IS NULL` (`source_of_data` memuat "ESS" -> `ESS`, selain itu `SYSTEM`; klausa `AND survey_source IS NULL` di `UPDATE` menjaga nilai admin); lalu `enforceEssManualUpload()` menyalakan `requires_manual_upload` pada metrik ESS yang mati (dicatat di log). Keduanya idempoten dan tidak mengubah OUTCOME.
- `metricParams()` ikut menulis `survey_source` (dan memaksa `requires_manual_upload = 1` untuk ESS) pada `INSERT` / `importStore` (`db:migrate`); `rowToMetric` membaca `NULL` sebagai `null`.
- **Backend JSON / rollback**: `jsonStorage.getStore()` mengisi `survey_source` yang kosong pada metrik SURVEY di `store.json` yang dimuat (nilai seed atau inferensi dari `source_of_data`), menyalakan flag ESS yang mati, dan memberi `null` pada OUTCOME. Rollback ke JSON tidak memerlukan langkah khusus. Backfill JSON belum punya tes otomatis.
- Contoh pemeriksaan: `SELECT metric_id, survey_source, requires_manual_upload FROM dbo.px_metrics WHERE metric_type = 'SURVEY' ORDER BY metric_id;` (data saat ini: ESS = 9, 13, 15, 16, 17, 18, 21, 22, 24, 25, 27).

---

## 15. Pembaruan v2.30.0 - Label Katalog Opsi di `px_app_settings` Menjadi Inggris

Tidak ada perubahan skema (jumlah tabel tetap 29, tidak ada kolom baru). Yang berubah adalah **isi** baris `px_app_settings` untuk empat katalog pilihan: `metric_types`, `scale_types`, `target_audiences`, `update_frequencies` - label tampilannya kini Inggris (mis. `MONTHLY` = "Monthly (Periodic Update Every Month)", `ONE_TIME_ANNUAL` = "Annual (One Upload for the Full Year)").

- **Top-up saat boot** (`sqlStorage.init()` memanggil `topUpOptionLabels()`): untuk tiap key di `seedData.LEGACY_OPTION_LABELS`, `upgradeLegacyOptionLabels(key, nilaiSekarang)` mengganti label **hanya bila masih persis sama** dengan default Indonesia lama (mis. `'Bulanan (Update Berkala Tiap Bulan)'`); bila ada yang berubah, baris di-`UPDATE`. Label hasil edit admin (walau hanya beda satu spasi), `value` setiap opsi, dan katalog lain (`event_types`, `question_types`, dst.) tidak disentuh. Aman diulang: pada jalan kedua tidak ada yang cocok sehingga tidak ada `UPDATE`.
- **Database baru / `migrate --reset`**: seed default (`initialAppSettings`) sudah berlabel Inggris, jadi top-up tidak melakukan apa pun.
- **Backend JSON / rollback**: blok setara di `jsonStorage.js` (saat memuat `store.json`) menjalankan `upgradeLegacyOptionLabels()` untuk key yang sama dengan aturan yang sama. Rollback ke JSON tidak memerlukan langkah khusus.
- **Tidak diubah**: kolom `description` di `px_app_settings` (teks internal, masih Indonesia), isi pertanyaan survei, nama metrik/direktorat/program, dan data Action Library.
- Contoh pemeriksaan: `SELECT setting_key, setting_value FROM dbo.px_app_settings WHERE setting_key IN ('metric_types','scale_types','target_audiences','update_frequencies');`
- Diverifikasi oleh Modul 40 (`docs/07` §23): katalog yang disajikan database tidak lagi berlabel Indonesia dengan `value` utuh, dan fungsi murni `upgradeLegacyOptionLabels` tidak menimpa edit admin. **Tidak ada tes otomatis yang memanggil `topUpOptionLabels()` / `init()` terhadap baris SQL berlabel lama**; jalur boot itu sendiri tidak diuji terpisah.

---

## 16. Pembaruan v2.31.0 - Master 12 Direktorat Riil (Migrasi Nama Direktorat)

Tidak ada perubahan skema (jumlah tabel tetap 29, tidak ada kolom baru). Yang berubah adalah **isi**: 8 direktorat demo diganti 12 direktorat riil bank dari file ESS 2025 (`docs/ESS 2025 Result_Role Clarity & DS Support.xlsx`; baris "PT Bank CIMB Niaga Tbk" = Bankwide, bukan direktorat). Tabel pemetaan lengkap ada di `CHANGELOG.md` [2.31.0]; logikanya di `server/db/directorateMigration.js` (pengecualian divisi dulu, lalu default direktorat; trim + case-insensitive; nama divisi tidak berubah, hanya dipindah induk).

- **Kapan berjalan**: `sqlStorage.init()` memanggil `migrateDirectorates()` tepat setelah `seedIfEmpty()` dan sebelum seed/top-up lain (`topUpDirectory()`, `topUpMetricUnits()`, `topUpSurveySource()` dst.). `server/db/migrate.js` (termasuk `--reset`) memanggilnya setelah memuat `store.json`, karena `store.json` lama masih bernama lama. Seluruhnya dalam **satu transaksi**.
- **Idempoten tanpa flag**: hanya baris yang masih bernama lama yang diubah; jalan kedua = 0 baris. Akibatnya data yang diunggah belakangan dengan nama demo lama ikut di-rename pada start berikutnya. Log (hanya bila ada perubahan): `[sqlStorage] Directorate master migrated to the 12 real directorates: directorates_removed=..., divisions_moved=..., ...`.

| Tabel | Kolom | Aturan |
| :--- | :--- | :--- |
| `px_directorates`, `px_divisions` | seluruh isi | dihapus lalu diisi ulang dalam urutan seed (`initialDirectorates`); divisi lama dipindah ke induk baru; direktorat yang bukan nama lama dan bukan seed dipertahankan beserta divisinya |
| `px_survey_uploaded_responses` | `org_unit_1` | hanya `respondent_type = 'EMPLOYEE'` (per pasangan `org_unit_1` + `org_unit_2`); baris mahasiswa/kandidat tidak disentuh |
| `px_attendances` | `directorate` | per pasangan `directorate` + `division` |
| `px_users` | `directorate` | kolom legacy v2.26.0 |
| `px_recruitment_sla_by_unit` | `unit` | default direktorat |
| `px_user_scopes` | `directorate`, `division` | ditulis ulang per user; "semua divisi" (`division` NULL) pada direktorat lama -> "semua divisi" direktorat default baru + satu baris per divisi pengecualian, sehingga akses tetap sama |
| `px_app_settings` | `event_manager_directorates` | nilai opsi di-rename; label yang sama dengan nama lama ikut berganti |

- **Sengaja tidak diubah**: `px_audit_log`, CSV evidence historis, nama file upload.
- **Hasil di database utama** (laporan developer): `directorates_removed=6, divisions_moved=28, survey_responses=3640, attendances=3, user_scopes=0, users=0, app_settings=0, operational_records=2`; jumlah baris EMPLOYEE tetap 4.920.
- **Backend JSON / rollback ke JSON**: `jsonStorage.js` menjalankan rename yang sama saat `store.json` dimuat (lalu disimpan) dan saat `auth.json` dimuat, jadi rollback ke `STORAGE_BACKEND=json` tidak memerlukan langkah khusus. `server/data/store.json` di repo masih bernama lama sampai `npm run db:export -- --replace` (server dihentikan dulu).
- **Tidak ada migrasi balik**: kembali ke nama demo lama hanya lewat restore backup `.bak` dari sebelum v2.31.0.
- Contoh pemeriksaan: `SELECT directorate_name FROM dbo.px_directorates ORDER BY directorate_id;` dan `SELECT org_unit_1, COUNT(*) AS n FROM dbo.px_survey_uploaded_responses WHERE respondent_type = 'EMPLOYEE' GROUP BY org_unit_1 ORDER BY org_unit_1;`
- Diverifikasi oleh Modul 44 (`docs/07` §27).

---

## 17. Pembaruan v2.32.0 - Tabel `px_ess_results` (Ringkasan ESS) & Pembersihan Data ESS per Responden

Metrik SURVEY ber-`survey_source = 'ESS'` kini diisi dari ringkasan hasil ESS `.xlsx` (format: `docs/SURVEY_IMPORT_GUIDE.md`; API: `docs/04` "Catatan v2.32.0"). Jumlah tabel 29 -> **30**.

| Kolom | Tipe | Aturan |
| :--- | :--- | :--- |
| `ess_result_id` | `INT IDENTITY` | PK `PK_px_ess_results` |
| `upload_id` | `NVARCHAR(64) NOT NULL` | batch di `px_survey_uploads` (`ess-<ts>-<acak>` untuk upload, `seed-ess-<metric>-<YYYY-MM>` untuk seed: 2025-11, sejak v2.37.0 juga 2026-03/06/09); tanpa FK |
| `metric_id` | `INT NOT NULL` | tanpa FK (sama seperti tabel survei lain) |
| `survey_year`, `survey_month` | `SMALLINT`, `TINYINT` | `CK_px_ess_month`: bulan 1-12 |
| `org_level` | `VARCHAR(12)` | `CK_px_ess_level`: `BANKWIDE` / `DIRECTORATE` |
| `directorate` | `NVARCHAR(200) NULL` | `CK_px_ess_dir`: NULL untuk `BANKWIDE`, wajib untuk `DIRECTORATE` |
| `participation` | `INT` | `CK_px_ess_part`: >= 0 |
| `index_score` | `DECIMAL(7,4)` | `CK_px_ess_index`: 0-100 |
| `questions_json` | `NVARCHAR(MAX)` | default `[]`; sampai v2.49.x `[{ "label": <teks pertanyaan di file>, "score": <0-100 atau null> }]`; sejak v2.50.0 per posisi pertanyaan `{ "key", "label", "text", "type", "order", "file_label", "score" }` (snapshot Manage Questions saat upload + header file), lihat §23 |
| `created_at` | `DATETIME2(3)` | default `SYSUTCDATETIME()` |

`UQ_px_ess_results (metric_id, survey_year, survey_month, org_level, directorate)`: satu baris Bankwide (SQL Server mengizinkan satu NULL per kunci) dan satu baris per direktorat per periode. Unggah ulang metrik + periode yang sama menghapus baris lama dan menulis yang baru dalam **satu transaksi** bersama record `px_survey_uploads` baru (`saveEssResultUpload`); record upload lama tetap. Hapus metrik ikut menghapus `px_ess_results`-nya. JSON: array `essResults` dengan field yang sama (`questions` alih-alih `questions_json`).

**File asli**: `server/data/ess-uploads/<upload_id>.xlsx` (bukan di database, tidak disajikan `/uploads`, di `.gitignore`). Hanya ditulis setelah validasi lolos; dihapus bila penyimpanan DB gagal dan saat metriknya dihapus.

**Pembersihan sekali (upgrade)**

| Backend | Kapan | Yang dihapus |
| :--- | :--- | :--- |
| SQL | Boot yang **membuat** `px_ess_results` (dicek sebelum `applySchema()`), setelah `enforceEssManualUpload()` | `cleanupEssRespondentRows()`: semua baris `px_survey_uploaded_responses` milik metrik ESS (dibaca dari `px_metrics`), lalu batch `px_survey_uploads` yang menjadi kosong. Log: `ESS now uses uploaded summaries: deleted <n> per-respondent ESS rows and <m> upload batches left empty.` |
| SQL (`migrate.js` / import `store.json`) | `store.json` tanpa `essResults` | pembersihan yang sama di dalam transaksi import |
| JSON | `store.json` dimuat tanpa `essResults` | `cleanupStoreEssRespondentRows()`, lalu `essResults = []` dan disimpan |

Data SYSTEM tidak disentuh. Hasil database utama (laporan developer): **2.568** baris dan **60** batch kosong dihapus; `seed-batch-2026` tetap (masih berisi baris SYSTEM). JSON (cek developer pada salinan): 2.511 baris. Metrik yang **belakangan** diubah SYSTEM -> ESS tidak dibersihkan lagi: baris per respondennya tetap ada tetapi diabaikan perhitungan.

**Seed demo** (diubah v2.37.0; **dummy 2026 dihapus di v2.50.0**, lihat §23 - kalimat tentang periode dummy di bawah tidak berlaku lagi): setiap boot (bila `SEED_DEMO_DATA` bukan `false`) `topUpEssSeed()` / `topUpStoreEssSeed()` menambahkan per **(metrik, periode)** 13 baris + satu record `px_survey_uploads` (`uploaded_by` "Seed (dummy)") **hanya** bila metrik ESS itu belum punya baris untuk periode tersebut (sampai v2.36.0: hanya bila metrik belum punya hasil sama sekali). Periode seed: 2025-11 (metrik 9 = file asli user) + dummy 2026-03, 2026-06, 2026-09 (`ESS_SEED_DUMMY_PERIODS`, data fiktif). Total seed: 13 x 11 x 4 = 572 baris, 44 batch. Database yang sudah berisi 2025-11 mendapat 429 baris + 33 batch kuartal 2026 pada boot pertama v2.37.0. Upload periode yang sama tidak pernah ditimpa; **efek samping**: bila semua baris satu periode seed dihapus, boot berikutnya menyisipkannya lagi (hentikan dengan `SEED_DEMO_DATA=false`). `created_at` baris seed: SQL = waktu insert, store JSON baru = `uploaded_at` batch-nya. Seed per responden tidak lagi dibuat untuk metrik ESS.

**Ekspor / rollback**: `npm run db:export` membawa `essResults`; `server/db/migrate.js` mengimpornya (`ess_results` di hitungan verifikasi). `server/data/store.json` di repo saat ini belum punya `essResults`, jadi rollback ke JSON atau `migrate --reset` menjalankan pembersihan di atas lalu seed demo; hasil ESS asli yang belum diekspor tidak ikut. `dropAllTables()` (`--reset`) kini juga menghapus `px_ess_results`. Tidak ada migrasi balik ke data per responden.

Pemeriksaan:

```sql
SELECT metric_id, survey_year, survey_month, COUNT(*) AS rows_, SUM(CASE WHEN org_level = 'BANKWIDE' THEN 1 ELSE 0 END) AS bankwide
FROM dbo.px_ess_results GROUP BY metric_id, survey_year, survey_month ORDER BY metric_id, survey_year, survey_month;
```

Diverifikasi oleh Modul 45 (`docs/07` §28).

---

## 18. Pembaruan v2.38.0 - Tabel Exit Interview

Dua tabel baru untuk dashboard Exit Interview (API: `docs/04` "Catatan v2.38.0"; kolom file: `docs/02` §5.4). Dibuat idempoten saat boot (`IF OBJECT_ID(...) IS NULL`, `schema.sql`), tanpa ALTER pada tabel lama. Jumlah tabel 30 -> **32**.

**`px_exit_interview_uploads`** (satu baris per batch): `upload_id` `NVARCHAR(64)` PK (`exit-<ts>-<acak>` untuk upload/impor, `seed-exit-<YYYY-MM>` untuk dummy), `file_name`, `source` (`CK_px_exit_up_src`: `UPLOAD` / `TEMPLATE_IMPORT` / `SEED_DUMMY`), `total_rows`, `inserted_rows`, `updated_rows`, `removed_dummy_rows`, `period_from`/`period_to` (`DATE`), `uploaded_by` (default `HR Admin`), `uploaded_at` (`DATETIME2(3)`, default `SYSUTCDATETIME()`).

**`px_exit_interviews`** (satu baris per exit)

| Kolom | Tipe | Aturan |
| :--- | :--- | :--- |
| `exit_id` | `INT IDENTITY` | PK `PK_px_exit_interviews` |
| `upload_id` | `NVARCHAR(64) NOT NULL` | batch terakhir yang menulis baris ini; tanpa FK |
| `nik`, `effective_date` | `NVARCHAR(50)`, `DATE` | `UQ_px_exit_nik_date (nik, effective_date)`; kunci upsert |
| `employee_name` | `NVARCHAR(200)` | default `''` |
| `leaving_reason`, `leaving_reason_detail` | `NVARCHAR(100) NULL` | kode, mis. `NORMAL_RESIGNATION`, `MOVE_COMPANY` |
| `grade`, `score_factor` | `NVARCHAR(20) NULL` | |
| `directorate`, `division` | `NVARCHAR(200)`, `NVARCHAR(200) NULL` | nama master; index `IX_px_exit_dir (directorate, division)` |
| `destination_industry`, `new_company`, `new_company_std`, `new_position` | `NVARCHAR(500) NULL` | `new_company_std` = nama standar saat impor |
| `pull_factors`, `improve_factors`, `new_company_offers`, `internal_factors`, `suggestions` | `NVARCHAR(MAX) NULL` | kolom K, L, M, N, AG apa adanya (maks 4000 karakter dari service) |
| `career_scores_json` | `NVARCHAR(400) NULL` | JSON 15 skor (1-6 atau `null`); NULL bila tidak ada yang diisi |
| `alumni_network`, `privacy_consent`, `recommend` | `VARCHAR(3) NULL` | CHECK `Yes`/`No` |
| `source` | `VARCHAR(20)` | `CK_px_exit_src`: `UPLOAD` / `TEMPLATE_IMPORT` / `SEED_DUMMY` |
| `created_at`, `updated_at` | `DATETIME2(3)` | `updated_at` diisi saat upsert meng-update |

Index `IX_px_exit_date (effective_date)` untuk filter periode. JSON: array `exitInterviews` (field sama, `career_scores` alih-alih `career_scores_json`) dan `exitInterviewUploads`.

**Penulisan** (`saveExitInterviewUpload`, satu transaksi): hapus baris `SEED_DUMMY` di setiap bulan yang ada di file -> `MERGE ... WITH (HOLDLOCK)` per baris pada `(nik, effective_date)` -> insert batch. NIK dibandingkan menurut collation database (tidak peka huruf besar/kecil menurut laporan developer; collation tidak diperiksa penulis); JSON membandingkan NIK lowercase. File asli disimpan di **`server/data/exit-uploads/<upload_id>.xlsx`** (bukan di database, tidak disajikan `/uploads`, di `.gitignore`); dihapus lagi bila transaksi gagal.

**Seed dummy**: setiap boot (bila `SEED_DEMO_DATA` bukan `false`) `topUpExitInterviewSeed()` / `topUpStoreExitSeed()` mengisi bulan Jan-Sep 2026 (`EXIT_SEED_MONTHS`) yang **belum punya baris sama sekali** dengan baris `seedData.generateExitInterviewDummy()` (deterministik, ±15% dari 205 baris per bulan) + batch `seed-exit-<YYYY-MM>` (`uploaded_by` "Seed (dummy)"). Log: `Seeded demo Exit Interview rows for: 2026-01, ...`. Bulan yang punya baris apa pun tidak disentuh, jadi data asli tidak pernah dicampur dummy. Store JSON baru juga langsung diisi dummy.

**Data di database utama** (laporan developer): Jan-Agu 2026 dummy 1.613 baris; Sep 2026 = 205 baris `TEMPLATE_IMPORT` dari file asli (menggantikan 203 baris dummy September; direktorat/divisi dummy, NIK pengganti `<NIK>-<nomor baris>`); total 1.818.

**Ekspor / migrasi / reset**: `exportToJson.js` membawa `exitInterviews` dan `exitInterviewUploads` (log menampilkan `exit interviews <n>`); `migrate.js` mengimpornya (`exit_interviews`, `exit_interview_uploads` di hitungan verifikasi); `dropAllTables()` (`--reset`) menghapus kedua tabel. **Perhatian**: ekspor dari database yang berisi baris `TEMPLATE_IMPORT`/`UPLOAD` memuat data karyawan asli - jangan commit `server/data/store.json` atau `store.from-sql.json` hasil ekspor itu. `server/data/store.json` di repo tidak berisi data exit, jadi `migrate --reset` menghapus data exit asli; server lalu mengisi dummy Jan-Sep 2026 saat start, dan file September harus diimpor ulang (`npm run exit:import-template`).

**Backup**: `.bak` memuat kedua tabel; folder `server/data/exit-uploads/` tidak - salin terpisah bila file asli perlu disimpan.

Pemeriksaan:

```sql
SELECT FORMAT(effective_date, 'yyyy-MM') AS ym, source, COUNT(*) AS n
FROM dbo.px_exit_interviews GROUP BY FORMAT(effective_date, 'yyyy-MM'), source ORDER BY ym, source;
```

Diverifikasi oleh Modul 47 (`docs/07` §32).

## 19. Pembaruan v2.43.0 - Penandaan entri tes audit

Kolom baru `px_users.is_test_account BIT NOT NULL DEFAULT 0` dan `px_audit_log.is_test BIT NOT NULL DEFAULT 0` (ALTER idempoten saat boot). `markHistoricalTestAudit()` berjalan sekali pada boot yang menambah kolom: di DB utama 9.525 baris ditandai, 266 tetap tampil. Tidak ada baris yang dihapus. Cek: `SELECT is_test, COUNT(*) FROM dbo.px_audit_log GROUP BY is_test;`

## 20. Pembaruan v2.44.0 - Aktivitas sesi

Kolom baru `px_sessions.last_activity_at DATETIME2(3) NULL DEFAULT SYSUTCDATETIME()` (ALTER idempoten; NULL dibaca sebagai `created_at`). Setting baru `session_idle_timeout_minutes` di `px_app_settings` (default 5). Tetap 32 tabel.

## 21. Pembaruan v2.48.0 - Setting `px_index_weights`

Setting baru `px_index_weights` di `px_app_settings` (nilai JSON `{"survey":70,"outcome":30}`), disisipkan sekali oleh `seedAppSettings()` bila key belum ada (JSON: backfill dari `initialAppSettings` saat load); tidak pernah menimpa nilai Admin. Diubah lewat `PUT /api/admin/settings/px_index_weights` (bilangan bulat 0-100, jumlah 100). Tidak ada tabel atau kolom baru; tetap 32 tabel. Cek: `SELECT setting_value FROM dbo.px_app_settings WHERE setting_key = 'px_index_weights';`

## 22. Pembaruan v2.49.0 - Kolom `px_users.menu_access`

Kolom baru `px_users.menu_access NVARCHAR(400) NULL` (ALTER idempoten saat boot, guard `COL_LENGTH` di `schema.sql`): JSON `{ "dashboard", "explore", "exit_interview", "action_library", "events", "about": true/false }`; NULL = default (semua kecuali `events`); diabaikan untuk ADMIN. Arti nilai di `server/db/menuAccess.js`. Pada boot yang menambah kolom, `migrateEventManagerMenuAccess()` sekali memberi `events: true` kepada USER yang masih NULL dan cakupannya memuat direktorat di setting `event_manager_directorates` (database utama: 0 akun). Backend JSON: field `menu_access` di `server/data/auth.json`, diisi sekali saat dimuat untuk akun tanpa field itu. Setting `event_manager_directorates` dibiarkan di `px_app_settings` (masih ikut rename direktorat v2.31.0) tetapi tidak memberi hak apa pun lagi. Tidak ada tabel baru; tetap 32 tabel. Akun (termasuk kolom ini) tidak dihapus oleh `migrate --reset` dan tidak ikut `db:export`. Cek: `SELECT username, role, menu_access FROM dbo.px_users;`

## 23. Pembaruan v2.50.0 - Kolom `px_survey_uploads.questions_snapshot_json`, Pertanyaan ESS PERCENTAGE & Penghapusan Dummy ESS 2026

**Kolom baru** `px_survey_uploads.questions_snapshot_json NVARCHAR(MAX) NULL` (ALTER idempoten di `schema.sql`, guard `COL_LENGTH`): set pertanyaan yang dipakai upload itu, `{ "<metric_id>": [{ "key", "label", "text", "type", "order" }] }` (batch CSV SYSTEM: setiap metrik di batch; upload ESS: metrik itu). NULL = upload dari sebelum v2.50.0 (tidak di-backfill). Baris `px_ess_results` dari upload baru menyimpan snapshot per pertanyaan di `questions_json` (§17). Backend JSON: field `questions_snapshot` di `surveyUploads` (`null` untuk data lama). Dibaca API sebagai `questions_snapshot` (`GET /api/surveys/history`) dan dipakai detail metrik serta evidence (`docs/04` "Catatan v2.50.0"). Ikut `npm run db:export` dan import `migrate.js`. Tetap 32 tabel.

**Langkah boot baru** (SQL, urutan di `storage.init` setelah `enforceEssManualUpload`; JSON: logika sama saat `store.json` dimuat):

| Langkah | Yang dilakukan | Database utama (laporan developer) |
| :--- | :--- | :--- |
| `topUpAddedOptions()` (sebelum `topUpDirectory`) | Menambahkan opsi `PERCENTAGE` "Percentage (0–100%)" ke setting `question_types` bila belum ada (`seedData.ADDED_OPTION_VALUES` / `addMissingOptions`); opsi dan label lain tidak diubah | opsi ditambahkan sekali |
| `enforceEssPercentageQuestions()` | `UPDATE px_survey_questions SET question_type = 'PERCENTAGE'` untuk pertanyaan metrik SURVEY ber-`survey_source = 'ESS'` yang belum `PERCENTAGE`; pertanyaan SYSTEM tidak disentuh. Berjalan setiap boot, jadi perubahan langsung di database ke tipe lain dikembalikan | 38 baris pada boot pertama |
| `cleanupRemovedEssDummySeed()` | Menghapus **hanya** upload `seed-ess-<metric>-2026-03`, `-2026-06`, `-2026-09` ber-`uploaded_by = 'Seed (dummy)'` (`seedData.isRemovedEssDummyUpload`) beserta baris `px_ess_results`-nya, satu transaksi. Upload Admin periode apa pun tidak disentuh; berikutnya tidak menemukan apa-apa | 33 upload, 429 baris |

**Seed**: `ESS_SEED_DUMMY_PERIODS` dihapus dari `seedData.js` (diganti `ESS_REMOVED_DUMMY_PERIODS` untuk pembersihan); seed ESS kini hanya 2025-11 (143 baris, 11 batch). Top-up seed per (metrik, periode) tetap (§17), jadi menghapus semua baris 2025-11 satu metrik menyisipkan seed itu lagi pada boot berikutnya kecuali `SEED_DEMO_DATA=false`. Data setelah suite (laporan developer): ESS 143 baris, 172 upload.

**Rollback**: kode lama tidak membaca kolom `questions_snapshot_json` (boleh dibiarkan). Menurut aturan top-up v2.37.0, kode v2.37.0-v2.49.x akan menyisipkan lagi dummy 2026 saat boot. Perilaku kode lama terhadap pertanyaan bertipe `PERCENTAGE` tidak diuji.

Cek:

```sql
SELECT upload_id, metric_id, uploaded_at, CASE WHEN questions_snapshot_json IS NULL THEN 0 ELSE 1 END AS has_snapshot
FROM dbo.px_survey_uploads ORDER BY uploaded_at DESC;
SELECT COUNT(*) AS dummy_2026 FROM dbo.px_ess_results WHERE upload_id LIKE 'seed-ess-%-2026-%';   -- 0
SELECT q.metric_id, q.question_type, COUNT(*) AS n FROM dbo.px_survey_questions q
JOIN dbo.px_metrics m ON m.metric_id = q.metric_id WHERE m.survey_source = 'ESS' GROUP BY q.metric_id, q.question_type;
```

Diverifikasi oleh Modul 52 (`docs/07` §39).
