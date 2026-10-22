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

## 3. Skema (`server/db/schema.sql` — 41 tabel sejak v2.55.0, prefix `px_`)

| Kelompok | Tabel | Catatan |
| :--- | :--- | :--- |
| Parameter | `px_journeys`, `px_checkpoints`, `px_metrics` (kolom `unit` = satuan nilai aktual, v2.25.0; kolom `survey_source` = sumber survei SYSTEM/ESS, v2.29.0), `px_metric_targets` | Target hanya ada di `px_metric_targets` (JSON menggandakannya di metric). Bobot hanya di `px_metrics.weight` — **tabel `weights` dihapus** (duplikat murni). Sengaja **tanpa FK** antar-tiga tabel ini (admin boleh menghapus journey tanpa menyentuh metric — sama seperti perilaku JSON). |
| Referensi | `px_directorates`, `px_divisions`, `px_directorate_aliases`, `px_division_aliases` (v2.51.0), `px_action_library` | Direktorat/divisi memakai surrogate key + `UNIQUE` nama. Former name direktorat/divisi (nama lama -> nama saat ini) di tabel alias, dirujuk per nama (§24). |
| Pertanyaan | `px_master_survey_questions`, `px_event_questions`, `px_survey_questions` | Pertanyaan event = salinan (snapshot) per event. **`px_survey_questions`** = set pertanyaan setiap metric SURVEY (1 baris/pertanyaan, kolom `is_customized`); di-seed sekali dari template kode, setelahnya dibaca hanya dari SQL (v2.22.1). |
| Reminder | `px_reminder_log` | Catatan tiap email reminder upload survei ke PIC (metrik, periode yang kosong, tanggal, SENT/FAILED) — dasar pencegah duplikat & pengulangan. Ikut terhapus bersama metriknya. |
| Email | `px_email_settings` | 1 baris: akun pengirim reminder ke PIC (menu "Email Settings"; sebelum v2.30.0 bernama "Setting Email"). Password dienkripsi AES-256-GCM (`server/services/secretBox.js`); kunci `SETTINGS_ENCRYPTION_KEY` ada di `.env` dan harus ikut dibackup. |
| Pengaturan | `px_app_settings` | Nilai yang ditampilkan di UI dan dikelola admin (JSON): `px_index_target` (garis target chart), `px_index_weights` (bobot Survey/Outcome PX Index, v2.48.0), `event_program_categories`, `event_types`, serta katalog pilihan `metric_types`, `scale_types`, `target_audiences`, `update_frequencies`, `question_types` (hanya label yang boleh diubah). API: `GET /api/settings`, `PUT /api/admin/settings/:key`. |
| Signature Event | `px_events`, `px_attendances`, `px_feedback_responses`, `px_media` | `UNIQUE(event_id, nip)` pada absensi & feedback (NIP tetap kunci utama responden). FK `ON DELETE CASCADE` ke `px_events`. **`px_media.file_path`** = path file di disk (mis. `/uploads/media-….mp4`) + `caption`, `ai_generated_description`, `transcript`, `transcript_segments` (JSON), `transcript_status`, `duration_seconds`, serta (v2.28.0) 8 kolom AI Summary `summary_*` (lihat §13) dan (v2.60.0) `summary_topics`, `summary_topic_stats` (lihat §30). |
| Survei | `px_survey_uploads`, `px_survey_uploaded_responses`, `px_acknowledged_alerts` | Responden **dinormalisasi** (lihat bawah). Index `(metric_id, survey_date)` dan `(org_unit_1, org_unit_2)`. Sejak v2.50.0 `px_survey_uploads.questions_snapshot_json` menyimpan set pertanyaan upload (§23). |
| Ringkasan ESS (v2.32.0) | `px_ess_results` | Data metrik ESS: satu baris per unit org (Bankwide / direktorat) per metrik dan periode, dari file ringkasan `.xlsx` yang diunggah. Batch upload-nya tetap di `px_survey_uploads`. Lihat §17. |
| Exit Interview (v2.38.0) | `px_exit_interviews`, `px_exit_interview_uploads` | Satu baris per exit karyawan dari file "Termination Report" `.xlsx` + direktorat/divisi; `UNIQUE (nik, effective_date)` (upload ulang = update). Berisi **data per karyawan** (NIK, nama, jawaban terbuka). Tidak dipakai perhitungan skor. Lihat §18. |
| Login (v2.26.0) | `px_users`, `px_sessions`, `px_audit_log` | `px_users`: `username` UNIQUE (NIP/nama login), `password_hash` (scrypt, tidak pernah dikembalikan API), `role` CHECK `ADMIN`/`USER`, `directorate`/`division` (nama, NULL untuk Admin), `is_active`, `must_change_password`, `failed_attempts`, `locked_until`, `last_login_at`, `menu_access` (v2.49.0; JSON, NULL = default). `px_sessions`: PK `token_hash` (**SHA-256 token cookie**, bukan token-nya), `expires_at`, FK ke user `ON DELETE CASCADE`. `px_audit_log`: waktu, user, `action`, `target`, `ip` — tanpa secret. Dibuat idempoten saat boot/`applySchema()`. |
| Cakupan User (v2.27.0) | `px_user_scopes` | `user_id` FK ke `px_users` `ON DELETE CASCADE`, `directorate`, `division` (**NULL = semua divisi** direktorat itu), `UNIQUE(user_id, directorate, division)`. Kolom `px_users.directorate`/`division` (v2.26.0) **legacy: tidak ditulis/dipakai lagi**. Dibuat idempoten saat boot. |
| Drilldown OUTCOME | `px_recruitment_sla_by_unit`, `px_approval_stage_compliance`, `px_hiring_channel_mix`, `px_recognition_categories`, `px_attrition_by_tenure` | Menggantikan objek `operationalRecords` (5 bentuk kolom berbeda dalam satu objek). Sejak v2.52.0 `px_recruitment_sla_by_unit` tidak lagi berisi baris metrik 1 (dihapus saat boot). |
| Social media metrik 1 (v2.52.0) | `px_social_media_stats`, `px_social_media_uploads` | Drilldown metrik 1: satu baris per platform (Instagram/LinkedIn/TikTok) per bulan, `UNIQUE (platform, stat_year, stat_month)`; riwayat batch upload `.xlsx` / integrasi. Tidak dipakai perhitungan skor. Lihat §25. |
| Nilai bulanan OUTCOME (v2.54.0) | `px_outcome_values`, `px_outcome_uploads` | Satu nilai bankwide per metrik OUTCOME (kecuali 11) per bulan, `UNIQUE (metric_id, stat_year, stat_month)`; riwayat batch upload `.xlsx` Admin. Kolom terkait: `px_metrics.score_tiers` (tier skor, JSON). Lihat §27. |
| Integrasi (v2.52.0, **dihapus di v2.53.0**, §26) | `px_integration_tokens` | Token integrasi untuk sistem internal lain: hanya `token_hash` (SHA-256), `scope` `SOCIAL_MEDIA_INGEST`. Seperti tabel login: tidak dihapus `migrate --reset`, tidak ikut `db:export`. Lihat §25. |

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


## 24. Pembaruan v2.51.0 - Tabel Former Name Direktorat/Divisi, Setting `directory_admin_managed` & Snapshot Konfigurasi

**Tabel baru** (dibuat idempoten saat boot, `IF OBJECT_ID(...) IS NULL` di `schema.sql`, tanpa ALTER tabel lama). Jumlah tabel 32 -> **34**.

| Tabel | Kolom | Kunci |
| :--- | :--- | :--- |
| `px_directorate_aliases` | `alias_id INT IDENTITY` PK, `alias_name NVARCHAR(200) NOT NULL` (nama lama), `directorate_name NVARCHAR(200) NOT NULL` (nama saat ini), `created_at DATETIME2(3)` default `SYSUTCDATETIME()` | `UQ_px_directorate_aliases_name (alias_name)` |
| `px_division_aliases` | `alias_id INT IDENTITY` PK, `directorate_name NVARCHAR(200) NOT NULL` (direktorat saat ini), `alias_name NVARCHAR(200) NOT NULL` (nama divisi lama), `division_name NVARCHAR(200) NOT NULL` (nama divisi saat ini), `created_at` | `UQ_px_division_aliases (directorate_name, alias_name)` |

Dirujuk **per nama** (seperti data lain yang menyalin nama direktorat), tanpa FK. Diisi oleh rename/merge (nama lama -> nama saat ini; alias lama ikut dipindah sehingga rantai selalu satu langkah) dan oleh former name manual di Admin Parameters -> Directorates; dihapus bersama direktoratnya. Dibaca resolver impor (`server/db/directoryNames.js`). Backend JSON: `directorateAliases` / `divisionAliases` di `store.json` (`initialStore.js`). Ikut `npm run db:export` dan import `migrate.js` (hitungan verifikasi `directorate_aliases`, `division_aliases`); `migrate --reset` (`dropAllTables`) menghapus keduanya.

**Setting baru** `directory_admin_managed` (`px_app_settings`, seed `false`): diset `true` oleh perubahan pertama lewat API direktori; sejak itu `topUpDirectory()` saat boot tidak menambah apa pun. Tidak bisa diubah lewat `PUT /api/admin/settings` (400). Sebelum `true`, top-up mencari nama seed lewat resolver (former name + `SEED_DIRECTORATE_RENAMES`), jadi database yang masih memakai ejaan lama tidak mendapat duplikat ejaan baru.

**Data yang menyalin nama direktorat** (diubah dalam satu transaksi oleh rename/merge): `px_survey_uploaded_responses.org_unit_1`/`org_unit_2` (hanya `respondent_type = 'EMPLOYEE'`), `px_ess_results.directorate` (`org_level = 'DIRECTORATE'`; baris metrik+periode yang bentrok saat merge digabung berbobot partisipasi), `px_exit_interviews.directorate`/`division`, `px_attendances.directorate`/`division`, `px_user_scopes`, `px_users.directorate`/`division` (legacy), `px_recruitment_sla_by_unit.unit`, setting `event_manager_directorates`. Tidak diubah: `px_audit_log`.

**Seed**: `initialDirectorates` memakai Syariah Banking, SLC ASG Satyaguna Langgeng Capital ("SLC" dan "Special Asset" dikenali sebagai ejaan seed lama), Strategy & Finance, Treasury & Financial Institutions (hanya untuk database baru; database yang ada tidak pernah di-rename oleh boot). Database utama di-rename lewat menu pada 2026-10-21 (nama lengkap "SLC ASG Satyaguna Langgeng Capital"); hasil di bawah. **"Reset Default"** (`resetParametersToDefault`) tidak lagi menghapus/mengisi ulang `px_directorates`/`px_divisions`. Tabel pemetaan migrasi v2.31.0 (§16) kini memetakan target lama ke nama saat ini (`opts.mapTarget`).

**Snapshot konfigurasi** (`sqlStorage.snapshotConfiguration` / `restoreConfiguration`, dipakai config guard regression suite, `docs/07` §40): baris mentah 12 tabel `px_journeys`, `px_checkpoints`, `px_metrics`, `px_metric_targets`, `px_survey_questions`, `px_master_survey_questions`, `px_action_library`, `px_app_settings`, `px_directorates`, `px_divisions`, `px_directorate_aliases`, `px_division_aliases`. Restore: hanya untuk server+database yang sama dengan snapshot; metrik yang tidak ada di snapshot dihapus dengan cascade hapus metrik; tabel yang berbeda dihapus dan diisi ulang dalam satu transaksi (id tetap, `IDENTITY_INSERT`). File snapshot suite: `server/data/backups/regression-config-snapshot.json` (gitignored; berisi konfigurasi termasuk e-mail PIC, tanpa password).

**Database utama setelah perubahan 2026-10-21** (dibaca penulis): 12 direktorat (Business Banking; Compliance, Corporate Affairs & Legal; Consumer & EBB; Corporate Assurance; Human Resources; Network & Digital Banking; Operations, Technology, Analytics & AI; Risk Management; Syariah Banking; SLC ASG Satyaguna Langgeng Capital; Strategy & Finance; Treasury & Financial Institutions), 6 former name direktorat (Sharia Banking, Special Asset, "Strategy, Finance & SPAPM", Treasury & Capital Market, SLC, Consumer & Emerging Business Banking), 0 former name divisi, `directory_admin_managed` = true.

**Rollback**: kode lama tidak membaca kedua tabel dan setting itu (boleh dibiarkan). Kode lama akan menambahkan lagi direktorat seed lamanya saat boot bila namanya tidak ada (mis. "Sharia Banking" di samping "Syariah Banking"), karena top-up lama tidak mengenal former name - tidak diuji.

Cek:

```sql
SELECT alias_name, directorate_name, created_at FROM dbo.px_directorate_aliases ORDER BY alias_id;
SELECT directorate_name, alias_name, division_name FROM dbo.px_division_aliases ORDER BY alias_id;
SELECT setting_value FROM dbo.px_app_settings WHERE setting_key = 'directory_admin_managed';
```

Diverifikasi oleh Modul 53 dan 54 (`docs/07` §40).

## 25. Pembaruan v2.52.0 - Tabel Social Media Metrik 1 & Token Integrasi

**Tabel baru** (dibuat idempoten saat boot, `IF OBJECT_ID(...) IS NULL` di `schema.sql`, tanpa ALTER tabel lama). Jumlah tabel 34 -> **37** (v2.53.0: `px_integration_tokens` dihapus -> 36, §26). API: `docs/04` "Catatan v2.52.0".

| Tabel | Kolom | Kunci / constraint |
| :--- | :--- | :--- |
| `px_social_media_stats` | `stat_id INT IDENTITY` PK, `platform NVARCHAR(20)`, `stat_year INT`, `stat_month INT`, `followers INT`, `reach INT`, `engagement INT`, `source VARCHAR(20)`, `upload_id NVARCHAR(64) NULL` (NULL untuk SEED), `created_at DATETIME2(3)` default `SYSUTCDATETIME()`, `updated_at DATETIME2(3) NULL` | `CHECK` platform `Instagram`/`LinkedIn`/`TikTok`, tahun 2000-2100, bulan 1-12, ketiga angka `>= 0`, source `UPLOAD`/`INTEGRATION`/`SEED`; `UQ_px_sm_platform_period (platform, stat_year, stat_month)` |
| `px_social_media_uploads` | `upload_id NVARCHAR(64)` PK (`sm-<ts>-<acak>`), `source VARCHAR(20)` (`UPLOAD`/`INTEGRATION`), `file_name NVARCHAR(260) NULL` (UPLOAD saja), `uploaded_by NVARCHAR(200)` ("Nama (username)", "... via API" untuk sesi Admin, atau "Integration: <nama token>"), `total_rows`, `inserted_rows`, `updated_rows`, `replaced_seed_rows` (INT default 0), `period_from`/`period_to CHAR(7) NULL` ('YYYY-MM'), `uploaded_at DATETIME2(3)` | PK; `CHECK` source |
| `px_integration_tokens` | `token_id INT IDENTITY` PK, `name NVARCHAR(100)`, `token_hash CHAR(64)` (SHA-256 hex), `token_hint NVARCHAR(20)`, `scope VARCHAR(40)`, `created_by NVARCHAR(200)`, `created_at DATETIME2(3)`, `last_used_at`, `revoked_at` (`DATETIME2(3) NULL`), `revoked_by NVARCHAR(200) NULL`, `is_test BIT` default 0 | `UQ_px_int_tokens_hash (token_hash)`; `CHECK` scope = `SOCIAL_MEDIA_INGEST` |

Tanpa FK (`upload_id` dirujuk per nilai, seperti tabel survei lain). Token itu sendiri tidak pernah disimpan.

**Aturan data** (`saveSocialMediaStats`, satu transaksi): baris `SEED` semua bulan dalam batch dihapus (ketiga platform), lalu `MERGE ... WITH (HOLDLOCK)` per (platform, tahun, bulan): ada -> `UPDATE` angka, `source`, `upload_id`, `updated_at`; belum -> `INSERT`; lalu satu baris `px_social_media_uploads`. File asli upload: `server/data/social-uploads/<upload_id>.xlsx` (gitignored, **tidak** ikut `.bak`).

**Boot**: (1) `removeMetric1SlaRows()` setiap start - `DELETE FROM dbo.px_recruitment_sla_by_unit WHERE metric_id = 1` (idempoten; log "Metric 1 is social media data: removed n old recruitment-SLA row(s)"); seed `initialOperationalRecords[1]` dihapus. (2) Bila `SEED_DEMO_DATA` bukan `false`: `topUpSocialMediaSeed()` menyisipkan baris dummy fiktif Januari-September 2026 (`generateSocialMediaSeed`, 27 baris, deterministik) untuk (platform, bulan) yang belum ada, kecuali bulan yang sudah punya baris `UPLOAD`/`INTEGRATION`.

**Backend JSON**: `socialMediaStats` (field `year`/`month`, bukan `stat_year`/`stat_month`) dan `socialMediaUploads` di `store.json`; token di `server/data/auth.json` (`integrationTokens`, gitignored) seperti akun. Baris SLA metrik 1 (`operationalRecords[1]`) dihapus saat `store.json` dimuat.

**Ekspor / migrasi / reset**: `exportToJson.js` membawa `socialMediaStats` dan `socialMediaUploads` (log `social media rows <n>`), **tanpa token**; `migrate.js` mengimpornya (`social_media_stats`, `social_media_uploads` di hitungan verifikasi). `dropAllTables()` (`--reset`) menghapus kedua tabel social media tetapi **tidak** `px_integration_tokens` (seperti tabel login). Token juga **tidak** termasuk `CONFIG_TABLES` snapshot konfigurasi suite (§24). Setelah `--reset` data social media asli hilang kecuali `store.json` sudah diekspor ulang; dummy diisi lagi saat start.

**Rollback**: kode lama tidak membaca ketiga tabel (boleh dibiarkan). Baris SLA metrik 1 yang sudah dihapus hanya kembali dari backup; perilaku kode lama tanpa baris itu tidak diuji.

Cek:

```sql
SELECT platform, stat_year, stat_month, followers, reach, engagement, source FROM dbo.px_social_media_stats ORDER BY stat_year, stat_month, platform;
SELECT upload_id, source, file_name, uploaded_by, total_rows, inserted_rows, updated_rows, replaced_seed_rows, period_from, period_to, uploaded_at FROM dbo.px_social_media_uploads ORDER BY uploaded_at DESC;
SELECT token_id, name, token_hint, scope, created_at, last_used_at, revoked_at FROM dbo.px_integration_tokens;
SELECT COUNT(*) AS sla_rows_metric_1 FROM dbo.px_recruitment_sla_by_unit WHERE metric_id = 1;  -- harus 0
```

Diverifikasi oleh Modul 55 (`docs/07` §41).

## 26. Pembaruan v2.53.0 - `px_integration_tokens` Dihapus

Fitur integrasi token v2.52.0 dihapus (`docs/04` "Catatan v2.53.0"). `px_integration_tokens` dihapus dari `schema.sql` -> **36 tabel**. Database yang sudah punya tabel itu dibersihkan oleh `dropRetiredIntegrationTokens()` (`sqlStorage.js`) saat boot (setelah `applySchema()`) dan di `migrate.js`:

```sql
IF OBJECT_ID(N'dbo.px_integration_tokens', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.px_integration_tokens) DROP TABLE dbo.px_integration_tokens
```

Hanya dijatuhkan bila **kosong** (di database utama 0 baris); bila berisi, tabel dibiarkan dengan peringatan log (hapus manual setelah dicek). Idempoten. `CHECK` `source` di `px_social_media_stats` / `px_social_media_uploads` tetap mengizinkan `'INTEGRATION'` (tanpa ALTER); tidak ada kode yang menulis nilai itu lagi. JSON: `integrationTokens` kosong dihapus dari `server/data/auth.json` saat dimuat. **Rollback** ke v2.52.x: kode lama membuat ulang tabel kosong saat boot (`IF OBJECT_ID(...) IS NULL`); token lama tidak kembali. Query cek token di §25 tidak berlaku lagi. Diverifikasi oleh Modul 55 (`docs/07` §42).

## 27. Pembaruan v2.54.0 - Kolom `px_metrics.score_tiers`, Tabel Nilai Bulanan OUTCOME

**Kolom baru** `px_metrics.score_tiers NVARCHAR(400) NULL` (ALTER idempoten via `COL_LENGTH`): JSON `{ "unit": "percent"|"number", "bounds": [{ "min": <angka>, "op": ">="|">" }] x 4 | null }`. `NULL` = dinilai menurut `scale_type`; `bounds: null` = tier belum diatur (N/A). Rumus: `docs/01` §3.9. Diisi sekali saat boot oleh `topUpScoreTiers()` untuk metrik seed 1, 2, 3, 14 **hanya bila masih `NULL`** (edit Admin tidak ditimpa); dalam transaksi yang sama `raw_value`/target hanya diganti bila masih nilai seed lama (`SCORE_TIER_UPGRADES` di `seedData.js`: metrik 14 `raw_value` 4330 -> 6400; target metrik 1 85 -> 2 "2%", metrik 3 80 -> 70 "> 70%"). JSON: langkah yang sama saat `store.json` dimuat.

**Dua tabel baru** (`schema.sql` -> **38 tabel**):

| Tabel | Kolom utama | Catatan |
| :--- | :--- | :--- |
| `px_outcome_uploads` | `upload_id` PK, `metric_id`, `file_name`, `uploaded_by`, `total_rows`, `inserted_rows`, `updated_rows`, `replaced_seed_rows`, `period_from`/`period_to` (`YYYY-MM`), `uploaded_at` | Riwayat batch; file asli `server/data/outcome-uploads/<upload_id>.xlsx` (gitignored, tidak ikut `.bak`) |
| `px_outcome_values` | `value_id` IDENTITY, `metric_id`, `stat_year` (2000-2100), `stat_month` (1-12), `value DECIMAL(18,4)` (`CHECK >= 0`), `notes NVARCHAR(500)`, `source` (`UPLOAD`\|`SEED`), `upload_id`, `created_at`, `updated_at` | `UNIQUE (metric_id, stat_year, stat_month)` = upsert per bulan. Tanpa FK (sama seperti tabel metrik lain). `SEED` disiapkan, belum ada seed nilai bulanan |

JSON: `store.json` `outcomeValues` / `outcomeUploads`. Kedua tabel ikut cascade hapus metrik, import `migrate.js` (hitungan `outcome_values`/`outcome_uploads`), `npm run db:export`, dan `dropAllTables()` (`migrate --reset` menghapus nilai yang diunggah - ekspor dulu bila perlu).

**Data di database utama** (2026-10-21): batch `ov-initial-1-2026-09` (metrik 1, 0.66) dan `ov-initial-3-2026-09` (metrik 3, 75.04), `source` `UPLOAD`, `uploaded_by` "Initial value (user, 2026-10-21)" - dimasukkan langsung, bukan oleh boot; tidak ada di `store.json` sampai `npm run db:export -- --replace`.

Pemeriksaan:

```sql
SELECT metric_id, score_tiers, raw_value FROM dbo.px_metrics WHERE score_tiers IS NOT NULL;
SELECT metric_id, stat_year, stat_month, value, source, upload_id FROM dbo.px_outcome_values ORDER BY metric_id, stat_year, stat_month;
```

Diverifikasi oleh Modul 56 (`docs/07` §43).

## 28. Pembaruan v2.55.0 - Kolom `outcome_aggregation` & `data_status`, Tabel Metrik Ringkasan per Bagian

**Dua kolom baru di `px_metrics`** (ALTER idempoten via `COL_LENGTH`):

| Kolom | Tipe / CHECK | Arti | Isi saat boot |
| :--- | :--- | :--- | :--- |
| `outcome_aggregation` | `VARCHAR(10) NULL`, `LATEST`\|`AVERAGE` | Cara membaca nilai bulanan OUTCOME (`NULL` = `LATEST`; SURVEY selalu `NULL`) | metrik 1 dan 3 = `AVERAGE`, hanya bila masih `NULL` |
| `data_status` | `VARCHAR(20) NULL`, `AVAILABLE`\|`NOT_AVAILABLE` | `NOT_AVAILABLE` = data riil belum ada -> N/A (`NULL` = `AVAILABLE`) | metrik 4, 6, 8, 10, 23, 26 = `NOT_AVAILABLE`, hanya bila masih `NULL` |

Edit Admin tidak pernah ditimpa oleh boot.

**Tiga tabel baru** (`schema.sql` -> **41 tabel**):

| Tabel | Kolom utama | Catatan |
| :--- | :--- | :--- |
| `px_metric_parts` | `part_id` IDENTITY, `metric_id`, `part_key`, `part_name`, `sort_order`, `template_json` | `UNIQUE (metric_id, part_key)`. Seed sekali per metrik yang belum punya bagian (`initialMetricParts`): 7 (4), 5, 12, 19, 20 |
| `px_metric_part_uploads` | `upload_id` PK, `metric_id`, `part_key`, `file_name`, `file_sha256 CHAR(64)`, `uploaded_by`, `total_rows`, `replaced_rows`, `periods`, `columns_json`, `uploaded_at` | File asli **tidak** disimpan (data pribadi di "Raw Data") |
| `px_metric_part_results` | `result_id` IDENTITY, `metric_id`, `part_key`, `upload_id`, `org_level` (`BANKWIDE`\|`DIRECTORATE`), `directorate`, `stat_year` (2000-2100), `stat_month`, `score DECIMAL(18,8)` (`NULL` = "-"), `respondents` (`NULL` = file tanpa kolom responden), `questions_json`, `period_text` | Index `IX_px_mpr_metric_part_period`. Ikut cascade rename/merge direktorat |

Saat bagian di-seed, metrik 12 diubah sekali (hanya bila masih nilai seed): `scale_type` `RATING_5` -> `PERCENTAGE`, unit "/ 5" -> "%", target 4.00 -> 80 "> 80%" (`METRIC_PART_UPGRADES`). JSON: `store.json` `metricParts` / `metricPartUploads` / `metricPartResults`. Ketiga tabel ikut cascade hapus metrik, import `migrate.js`, `npm run db:export`, dan `dropAllTables()` (`migrate --reset` menghapus ringkasan yang diunggah). `px_metric_parts` **tidak** ikut snapshot config guard suite.

Pemeriksaan:

```sql
SELECT metric_id, outcome_aggregation, data_status FROM dbo.px_metrics WHERE outcome_aggregation IS NOT NULL OR data_status IS NOT NULL;
SELECT metric_id, part_key, part_name, sort_order FROM dbo.px_metric_parts ORDER BY metric_id, sort_order;
SELECT metric_id, part_key, stat_year, stat_month, COUNT(*) AS rows_ FROM dbo.px_metric_part_results GROUP BY metric_id, part_key, stat_year, stat_month ORDER BY 1, 2, 3, 4;
```

Diverifikasi oleh Modul 58-60 (`docs/07` §45).

## 29. Pembaruan v2.57.0 - Kolom `px_metric_parts.questions_json` (Summary Questions)

| Kolom | Tipe | Arti | Isi saat boot |
| :--- | :--- | :--- | :--- |
| `px_metric_parts.questions_json` | `NVARCHAR(MAX) NULL` (ALTER idempoten via `COL_LENGTH`) | Pertanyaan terkonfigurasi bagian, JSON `[{ "key", "text", "type": "SCALE"\|"TEXT" }]` urut kolom; metrik 12 = pertanyaan satu blok event. `NULL` = belum dikonfigurasi (upload memakai perilaku v2.55.0) | `topUpPartQuestions()` mengisi sekali, hanya bila `NULL`: header upload terakhir > template seed > `[]` |

- Tidak ada tabel baru (**41 tabel**). JSON: `store.json` `metricParts[].questions`.
- `px_metric_part_uploads.columns_json` mendapat `questions_snapshot` (set pertanyaan saat upload); `question_labels` tetap header file. Jawaban di `px_metric_part_results.questions_json` kini membawa `key`, `label` (teks terkonfigurasi), `file_label`, `type`.
- `px_metric_parts` masuk `CONFIG_TABLES` (snapshot/restore config guard suite). Ikut `npm run db:export` dan import `migrate.js`; `migrate --reset` mengembalikan ke template seed.

```sql
SELECT metric_id, part_key, part_name, questions_json FROM dbo.px_metric_parts ORDER BY metric_id, sort_order;
SELECT upload_id, metric_id, part_key, JSON_QUERY(columns_json, '$.questions_snapshot') AS questions_snapshot FROM dbo.px_metric_part_uploads ORDER BY uploaded_at DESC;
```

Diverifikasi oleh Modul 62 (`docs/07` §47).

## 30. Pembaruan v2.60.0 - Kolom `px_media.summary_topics` & `summary_topic_stats` (AI Summary per topik)

| Kolom | Tipe | Arti |
| :--- | :--- | :--- |
| `px_media.summary_topics` | `NVARCHAR(MAX) NULL` | JSON `[{ "title", "points": [...] }]` - topik ringkasan AI video panjang (transkrip > 5.000 karakter). `NULL` = ringkasan standar, `RULE`, `INSUFFICIENT`, atau belum ada ringkasan |
| `px_media.summary_topic_stats` | `NVARCHAR(1000) NULL` | JSON `{ parts, retried_parts, skipped_parts, dropped_points, dropped_topics, merge_attempts, aborted_answers, filler_points, duplicate_points, summary_repaired, summary_sentences_removed, summary_from_titles }` (dipotong di 1000 karakter); `NULL` bila `summary_topics` `NULL` |

- Ditambahkan di `schema.sql` per kolom dengan `IF COL_LENGTH(N'dbo.px_media', N'<kolom>') IS NULL ALTER TABLE ... ADD ...` (idempoten, otomatis saat server start). Tidak ada tabel baru (**41 tabel**). Komentar `schema.sql` untuk `summary_topic_stats` baru menyebut 6 field pertama; isinya 12 field seperti di atas.
- `sqlStorage.rowToMedia` membaca keduanya (JSON, `null` bila kosong) hanya bila `summary_status` tidak `NULL` (sama dengan kolom `summary_*` lain); `updateMedia` menerima keduanya (`null` mengosongkan); `importStore` (`migrate.js`) ikut memuatnya, `npm run db:export` membawanya lewat `getAllMedia()`. Backend JSON: field yang sama di record media `store.json` (whitelist `updateMedia`).
- Isi diatur aplikasi: setiap penulisan ringkasan mengisi kedua kolom (Regenerate menghapus topik lama), transkrip baru mengosongkannya. Jangan diubah langsung di tabel.
- Rollback ke versi sebelumnya / ke JSON tidak memerlukan langkah khusus (kolom tambahan diabaikan kode lama).

```sql
SELECT media_id, file_name, summary_status, summary_source, LEN(summary_topics) AS topics_len, summary_topic_stats
FROM dbo.px_media WHERE summary_topics IS NOT NULL ORDER BY summary_generated_at DESC;
```

Diverifikasi oleh Modul 65 (`docs/07` §50). API: `docs/04` "Catatan v2.60.0".

## 31. Pembaruan v2.60.1 - Isi JSON `summary_topics` & `summary_topic_stats` (tanpa perubahan skema)

Tidak ada tabel, kolom, atau ALTER baru (tetap **41 tabel**); hanya isi JSON kolom v2.60.0 (§30) yang bertambah:

| Kolom | Tambahan isi |
| :--- | :--- |
| `px_media.summary_topics` | Pada mode agenda rapat setiap topik memuat `agenda` (nama agenda): `[{ "agenda", "title", "points": [...] }]`. Topik single merge / merge per blok tetap `{ "title", "points" }` |
| `px_media.summary_topic_stats` | 6 field baru: `agenda_mode` (boolean), `agendas` (daftar nama agenda), `detect_calls`, `agenda_candidates`, `blocks`, `coverage_restored` (total 18 field). Perkiraan penulis: JSON terpanjang sekitar 550 karakter (3 nama agenda x 60 karakter), di bawah batas potong 1000 |

- Ringkasan yang sudah tersimpan tidak diubah sampai Regenerate. Menurut kode, versi lama (rollback ke v2.60.0) membaca kolom yang sama dan mengabaikan field tambahan (tidak diuji).
- Komentar `schema.sql` untuk `summary_topic_stats` masih hanya menyebut 6 field pertama.

```sql
SELECT media_id, file_name,
       JSON_VALUE(summary_topic_stats, '$.agenda_mode') AS agenda_mode,
       JSON_QUERY(summary_topic_stats, '$.agendas') AS agendas,
       JSON_VALUE(summary_topic_stats, '$.blocks') AS blocks
FROM dbo.px_media WHERE summary_topics IS NOT NULL ORDER BY summary_generated_at DESC;
```

Diverifikasi oleh Modul 66 (`docs/07` §51). API: `docs/04` "Catatan v2.60.1".
