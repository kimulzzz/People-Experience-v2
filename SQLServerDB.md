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

Tabel aplikasi berawalan `px_` (38 tabel sejak v2.54.0). Yang paling sering dilihat: `px_metrics`, `px_metric_targets`, `px_survey_uploaded_responses`, `px_events`, `px_attendances`, `px_feedback_responses`, `px_media` (kolom `file_path` + `transcript`).

> Jangan mengubah data langsung lewat SSMS tanpa alasan kuat — validasi dan perhitungan skor berjalan di aplikasi.

---

## 5. Foto & Video

File foto/video Signature Event **tidak disimpan di database**. File tetap di disk (`server/uploads/`, disajikan di `/uploads/...`). Tabel `px_media` hanya menyimpan **path** (`file_path`), nama file, caption, deskripsi/transkrip AI, status transkrip, durasi, dan (v2.28.0) AI Summary transkrip video (kolom `summary_*`, lihat §12). Menghapus media lewat aplikasi menghapus baris + file fisiknya.

---

## 6. Backup & Restore

| Kebutuhan | Cara |
| :--- | :--- |
| Backup database (`.bak`) | di SSMS: klik kanan database → Tasks → Back Up; atau T-SQL: `BACKUP DATABASE PeopleExperiencePX TO DISK = N'D:\backup\px.bak' WITH INIT, COMPRESSION;` (jalankan sebagai Windows admin) |
| Restore | `RESTORE DATABASE PeopleExperiencePX FROM DISK = N'D:\backup\px.bak' WITH REPLACE;` (hentikan aplikasi dulu) |
| Salinan format JSON | `npm run db:export` → `server/data/store.from-sql.json` (tidak menimpa apa pun) |
| Backup file foto/video | salin folder `server/uploads/` (tidak ikut backup database) |
| Backup file asli ESS & Exit Interview | salin folder `server/data/ess-uploads/` dan `server/data/exit-uploads/` (tidak ikut backup database; berisi data per karyawan, simpan di lokasi internal) |

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
| Direktorat & divisi (filter Header, form check-in) | `px_directorates`, `px_divisions` (+ former name: `px_directorate_aliases`, `px_division_aliases`) | sejak v2.51.0 lewat Admin Parameters -> Directorates (rename/merge ikut mengubah semua data, lihat §23); entri seed yang hilang hanya ditambahkan saat start selama `directory_admin_managed` belum `true` |
| Jadwal reminder otomatis (jam kirim, ulangi tiap N hari) | `px_app_settings` (`reminder_send_hour`, `reminder_repeat_days`) | menu **Email Settings** |
| Riwayat email reminder yang terkirim | `px_reminder_log` | otomatis; ditampilkan di menu Email Settings |
| Akun pengirim email reminder PIC (password terenkripsi) | `px_email_settings` | menu **Email Settings** di Header |
| Daftar pilihan Admin Parameters & Survey Questions (tipe metrik, skala, responden, frekuensi, tipe pertanyaan) | `px_app_settings` | `PUT /api/admin/settings/:key` (hanya label) |
| Satuan nilai aktual tiap metrik (`px_metrics.unit`) | `px_metrics` | Admin Parameters → field "Actual Value Unit" |
| Sumber survei tiap metrik SURVEY (`px_metrics.survey_source`: `SYSTEM` / `ESS`) | `px_metrics` | Admin Parameters → dropdown "Survey Source" |
| Hasil ESS per metrik, periode dan unit org (v2.32.0) | `px_ess_results` (+ batch di `px_survey_uploads`) | Upload ringkasan `.xlsx` di Explore Metrics / detail metrik (Admin atau PIC); file asli di `server/data/ess-uploads/` |
| Data exit karyawan untuk dashboard Exit Interview (v2.38.0) | `px_exit_interviews` (+ batch di `px_exit_interview_uploads`) | Upload `.xlsx` di tab Exit Interview (Admin); file asli di `server/data/exit-uploads/` |
| Kata kunci pengelompokan Exit Interview (`exit_interview_k_factors`, `_m_themes`, `_n_themes`, `_company_aliases`, `_none_answers`) | `px_app_settings` | `PUT /api/admin/settings/:key` (list `{value, label}`; belum ada UI) |
| Parameter journey/checkpoint/metric/target/bobot | `px_journeys`, `px_checkpoints`, `px_metrics`, `px_metric_targets` | menu Admin Parameters |

> **Perhatian:** `node server/db/migrate.js --reset` menghapus semua tabel `px_*` termasuk `px_email_settings` — pengaturan email harus diisi ulang setelahnya.

---

## 11. Akun Login (v2.26.0)

| Hal | Keterangan |
| :--- | :--- |
| Tabel | `px_users` (akun; `password_hash` = scrypt), `px_sessions` (hanya **hash SHA-256** token cookie), `px_audit_log` (jejak login & kelola user, tanpa secret) |
| Cakupan User (v2.27.0) | `px_user_scopes` (cakupan data per User: `directorate`, `division` NULL = semua divisi; FK `ON DELETE CASCADE` ke `px_users`). Kolom `px_users.directorate`/`division` legacy, tidak dipakai lagi; dimigrasikan otomatis saat boot (`migrateLegacyUserScopes`, idempoten). Ikut dibackup bersama akun; tidak dihapus oleh `migrate --reset` |
| Setting (`px_app_settings`) | `session_hours` (8), `login_max_attempts` (5), `login_lockout_minutes` (15), `login_rate_limit_per_minute` (20), `event_manager_directorates` (Human Resources; sejak v2.49.0 tidak memberi hak, diganti `px_users.menu_access`, lihat §21) |
| `node server/db/migrate.js --reset` | **Tidak menghapus** tiga tabel di atas — akun bertahan |
| `npm run db:export` / import | **Tidak memuat** akun |
| Backend JSON | akun di `server/data/auth.json` (git-ignored), terpisah dari akun di SQL |
| Admin pertama | `npm run auth:create-admin` (password acak dicetak sekali di konsol) |
| Backup | akun ikut backup `.bak` database; berisi hash password — simpan seperti data rahasia |

---

## 12. AI Summary Video (v2.28.0)

- `px_media` mendapat 8 kolom nullable: `summary`, `summary_points` (JSON), `summary_status` (`PROCESSING|DONE|FAILED|INSUFFICIENT`), `summary_source` (`AI|RULE`), `summary_model`, `summary_language`, `summary_generated_at`, `summary_error`. Ditambahkan otomatis saat server start (`schema.sql`, per kolom `IF COL_LENGTH ... IS NULL`), aman diulang. Database ini sudah memiliki 7 kolom sisa percobaan v2.26.0 (menurut laporan; tidak dicek langsung) — tidak menimbulkan masalah.
- Isi kolom dibuat oleh model lokal Gemma (Ollama, on-premise) atau fallback aturan; tidak ada setting database baru. Setting Ollama ada di `.env` (`OLLAMA_MODEL`, `OLLAMA_HOST`, `OLLAMA_TIMEOUT_MS`, `AI_QUEUE_MAX`) — lihat `docs/06`.
- Backup `.bak` ikut memuat ringkasan. `node server/db/migrate.js --reset` memuat ulang dari `store.json`, sehingga ringkasan dan transkrip video yang hanya ada di SQL ikut hilang (lihat catatan video user di `CLAUDE.md` v2.24.1).

---

## 13. Sumber Survei Metrik (v2.29.0)

- `px_metrics` mendapat kolom `survey_source VARCHAR(10) NULL` dengan `CHECK` `CK_px_metrics_survey_source` (`'SYSTEM'` atau `'ESS'`; `NULL` untuk metrik OUTCOME). Ditambahkan otomatis saat server start (`schema.sql`, guard `COL_LENGTH`); tidak ada setting `.env` atau `px_app_settings` baru.
- Saat start, kolom yang masih `NULL` pada metrik SURVEY diisi sekali (teks `source_of_data` memuat "ESS" -> `ESS`, selain itu `SYSTEM`); nilai yang sudah ada (hasil edit admin) tidak pernah ditimpa. Metrik ESS selalu `requires_manual_upload = 1` (dinyalakan saat start bila mati).
- Pemeriksaan: `SELECT metric_id, survey_source, requires_manual_upload FROM dbo.px_metrics WHERE metric_type = 'SURVEY' ORDER BY metric_id;`. Backup `.bak` ikut memuat kolom ini; `node server/db/migrate.js --reset` memuat ulang dari `store.json` (JSON mengisi kolomnya sendiri saat dimuat).
- Rollback ke JSON tidak memerlukan langkah khusus.

## 14. Label Katalog Opsi Inggris (v2.30.0)

- Tidak ada perubahan skema. Label empat katalog di `px_app_settings` (`metric_types`, `scale_types`, `target_audiences`, `update_frequencies`) diganti ke Inggris saat server start (`topUpOptionLabels()`), **hanya** untuk label yang masih persis default Indonesia lama; hasil edit admin dan `value` tidak pernah ditimpa. Aman diulang. Rollback ke JSON tidak memerlukan langkah khusus.
- Pemeriksaan: `SELECT setting_key, setting_value FROM dbo.px_app_settings WHERE setting_key IN ('metric_types','scale_types','target_audiences','update_frequencies');`
- Batas waktu 120 menit (transkrip, Gemma, upload) diatur di `.env` (`TRANSCRIBE_TIMEOUT_MS`, `OLLAMA_TIMEOUT_MS`, `SUMMARY_JOB_TIMEOUT_MS`, `REQUEST_TIMEOUT_MS`; semua opsional) - tidak ada hubungannya dengan koneksi database.

## 15. Master 12 Direktorat Riil (v2.31.0)

- Tidak ada perubahan skema. `px_directorates`/`px_divisions` kini berisi 12 direktorat riil bank (daftar dan pemetaan di `docs/08` §16). Nama demo lama di data di-rename otomatis saat server start (`migrateDirectorates()`, satu transaksi, aman diulang); log hanya muncul bila ada perubahan: `Directorate master migrated to the 12 real directorates: ...`.
- Ikut di-rename: baris survei EMPLOYEE (`org_unit_1`), `px_attendances`, `px_users` (kolom legacy), `px_user_scopes`, `px_recruitment_sla_by_unit.unit`, setting `event_manager_directorates`. Tidak di-rename: `px_audit_log`.
- Data yang diunggah belakangan dengan nama demo lama ikut di-rename pada start berikutnya.
- `node server/db/migrate.js --reset` memuat `store.json` (masih bernama lama) lalu langsung menjalankan rename yang sama. Agar `store.json` ikut bernama baru: `npm run db:export -- --replace` (server dihentikan dulu).
- Tidak ada migrasi balik; nama lama hanya kembali lewat restore backup `.bak` dari sebelum v2.31.0.
- Pemeriksaan: `SELECT directorate_name FROM dbo.px_directorates ORDER BY directorate_id;`

## 16. Ringkasan ESS (v2.32.0)

- Tabel baru `px_ess_results` (dibuat otomatis saat server start, `schema.sql`): satu baris per unit org (Bankwide `directorate` NULL, atau direktorat) per metrik ESS dan periode; `index_score` dan skor pertanyaan dalam persen 0-100. Kunci unik `UQ_px_ess_results (metric_id, survey_year, survey_month, org_level, directorate)`. Rincian kolom: `docs/08` §17. Jumlah tabel kini 30.
- **Pembersihan sekali**: pada start pertama yang membuat tabel ini, semua baris ESS per responden di `px_survey_uploaded_responses` dan batch upload yang menjadi kosong dihapus (database utama: 2.568 baris, 60 batch; laporan developer). Log: `ESS now uses uploaded summaries: deleted ...`. Tidak berjalan lagi pada start berikutnya.
- **Seed demo**: ringkasan November 2025 (143 baris, `uploaded_by` "Seed (dummy)"); v2.37.0-v2.49.x juga dummy fiktif 2026-03, 2026-06, 2026-09 (429 baris + 33 batch `seed-ess-<metric>-2026-MM`) - **dihapus otomatis sejak v2.50.0**, lihat §22. Disisipkan saat start per (metrik, periode) yang belum punya baris, jadi upload asli tidak ditimpa; tetapi periode seed yang semua barisnya dihapus akan disisipkan lagi pada start berikutnya. Dimatikan dengan `SEED_DEMO_DATA=false`. Pemeriksaan dummy: `SELECT COUNT(*) FROM dbo.px_ess_results WHERE upload_id LIKE 'seed-ess-%-2026-%';` (sejak v2.50.0: 0; v2.37.0-v2.49.x: 429).
- **Backup**: file asli unggahan ada di `server/data/ess-uploads/` (bukan di database). Backup `.bak` **tidak** memuatnya - salin folder ini bersama backup database bila file asli perlu disimpan untuk audit.
- `node server/db/migrate.js --reset` memuat ulang dari `store.json` yang belum berisi hasil ESS: hasil ESS yang diunggah hilang (diganti seed demo), sementara file aslinya tetap tertinggal di `server/data/ess-uploads/`. Ekspor dulu (`npm run db:export`) bila perlu.
- Rollback ke JSON tidak memerlukan langkah khusus (JSON menjalankan pembersihan dan seed yang sama saat `store.json` dimuat).
- Pemeriksaan: `SELECT metric_id, survey_year, survey_month, COUNT(*) AS n FROM dbo.px_ess_results GROUP BY metric_id, survey_year, survey_month ORDER BY 1, 2, 3;`

## 17. Exit Interview (v2.38.0)

- Tabel baru `px_exit_interviews` (satu baris per exit karyawan, `UNIQUE (nik, effective_date)`, index `effective_date` dan `(directorate, division)`) dan `px_exit_interview_uploads` (riwayat batch). Dibuat otomatis saat server start. Rincian kolom: `docs/08` §18. Jumlah tabel kini 32.
- **Data sensitif**: tabel ini menyimpan NIK, nama, dan jawaban terbuka karyawan yang keluar. API hanya memberi Admin akses ke baris per karyawan (export CSV); User hanya menerima agregat.
- **Data saat ini (laporan developer)**: Jan-Agu 2026 dummy (`source = 'SEED_DUMMY'`, 1.613 baris); Sep 2026 = 205 baris dari file asli `docs/Template Report Exit Interview.xlsx` (`source = 'TEMPLATE_IMPORT'`, direktorat/divisi dummy, NIK pengganti `<NIK>-<nomor baris>`). File asli itu dan folder `server/data/exit-uploads/` ada di `.gitignore` - data asli hanya ada di database lokal dan folder itu.
- **Seed dummy**: saat start (bila `SEED_DEMO_DATA` bukan `false`) bulan Jan-Sep 2026 yang belum punya baris exit sama sekali diisi dummy (log `Seeded demo Exit Interview rows for: ...`). Upload atau impor data asli satu bulan menghapus dummy bulan itu.
- **Backup**: `.bak` memuat kedua tabel. Salinan file upload ada di `server/data/exit-uploads/` (tidak ikut `.bak`).
- **Ekspor JSON**: `npm run db:export` (dan `-- --replace`) ikut menulis semua baris exit, termasuk data asli, ke `store.from-sql.json` / `store.json` - **jangan commit** file hasil ekspor seperti itu.
- `node server/db/migrate.js --reset` menghapus kedua tabel; `store.json` di repo tidak berisi data exit, jadi data asli hilang dan diganti dummy saat start berikutnya. Impor ulang: `npm run exit:import-template -- "docs/Template Report Exit Interview.xlsx"`.
- Pemeriksaan: `SELECT FORMAT(effective_date, 'yyyy-MM') AS ym, source, COUNT(*) AS n FROM dbo.px_exit_interviews GROUP BY FORMAT(effective_date, 'yyyy-MM'), source ORDER BY ym, source;`

## 18. Audit Trail: entri tes (v2.43.0)

`px_users.is_test_account` dan `px_audit_log.is_test` (BIT, default 0). Baris audit akun tes disembunyikan dari Audit Trail (default API/UI), tidak dihapus. Admin sementara yang dibuat skrip verifikasi harus `is_test_account: true`.

## 19. Auto sign-out (v2.44.0)

`px_sessions.last_activity_at` + setting `session_idle_timeout_minutes` (default 5, 1-120). Sesi yang idle melewati batas dihapus saat request berikutnya.

## 20. Bobot PX Index (v2.48.0)

Setting `px_index_weights` di `px_app_settings` (default `{"survey":70,"outcome":30}`; bilangan bulat 0-100, jumlah 100). Diubah Admin di Admin Parameters -> Journey Parameters -> PX Index Weights; perubahan tercatat `SETTINGS_CHANGE` di `px_audit_log`. Ikut `.bak` bersama tabel lain. Cek: `SELECT setting_value FROM dbo.px_app_settings WHERE setting_key = 'px_index_weights';`

## 21. Akses Menu per User (v2.49.0)

Kolom `px_users.menu_access` (`NVARCHAR(400) NULL`, JSON berisi 6 menu `true`/`false`; NULL = default: semua menu kecuali Signature Program Events; Admin selalu semua menu). Ditambahkan otomatis saat server start. Upgrade sekali pada start yang menambah kolom: User lama yang cakupannya memuat direktorat di `event_manager_directorates` mendapat menu `events` (database utama: 0 akun). Setting `event_manager_directorates` tetap ada tetapi tidak memberi hak lagi. Tetap 32 tabel; ikut `.bak`; tidak dihapus oleh `migrate --reset` (akun bertahan). Diubah Admin di Admin Parameters -> Manage Users -> Menu Access, tercatat `USER_MENU_ACCESS_CHANGE` di `px_audit_log`. Cek: `SELECT username, role, menu_access FROM dbo.px_users;`

## 22. Snapshot Pertanyaan & Pertanyaan ESS Percentage (v2.50.0)

- Kolom baru `px_survey_uploads.questions_snapshot_json` (`NVARCHAR(MAX) NULL`, ditambahkan otomatis saat server start): set pertanyaan (key, label, teks, tipe, urutan) yang dipakai setiap upload CSV System / ESS sejak v2.50.0, supaya riwayat dan evidence tetap memakai teks pertanyaan saat data dikirim. NULL = upload lama (tidak di-backfill). Baris `px_ess_results` dari upload baru menyimpan snapshot per pertanyaan di `questions_json`. Tetap 32 tabel; ikut `.bak`, `npm run db:export` dan import `migrate.js`. Rincian: `docs/08` §23.
- **Setiap start**: opsi `PERCENTAGE` ditambahkan ke setting `question_types` bila belum ada; pertanyaan metrik ESS yang belum bertipe `PERCENTAGE` diubah ke `PERCENTAGE` (database utama: 38 baris pada start pertama; perubahan langsung di database ke tipe lain akan dikembalikan).
- **Sekali**: upload seed dummy ESS 2026-03/06/09 (`seed-ess-<metric>-2026-MM`, `uploaded_by` "Seed (dummy)") dan barisnya dihapus (database utama: 33 upload, 429 baris). Upload Admin tidak disentuh. Data ESS kini hanya November 2025 (143 baris) sampai hasil asli diunggah; Dashboard memakai hasil terakhir itu untuk periode sesudahnya (carry-forward).
- Pemeriksaan: `SELECT COUNT(*) AS with_snapshot FROM dbo.px_survey_uploads WHERE questions_snapshot_json IS NOT NULL;` dan `SELECT question_type, COUNT(*) FROM dbo.px_survey_questions q JOIN dbo.px_metrics m ON m.metric_id = q.metric_id WHERE m.survey_source = 'ESS' GROUP BY question_type;` (hanya `PERCENTAGE`).


## 23. Master Direktorat dikelola Admin & Former Name (v2.51.0)

- Tabel baru `px_directorate_aliases` (former name direktorat -> nama saat ini, `alias_name` unik) dan `px_division_aliases` (per direktorat: nama divisi lama -> nama saat ini, unik `(directorate_name, alias_name)`), dibuat otomatis saat server start. Jumlah tabel kini **34**. Rincian kolom: `docs/08` §24.
- Direktorat/divisi diubah lewat **Admin Parameters -> Directorates** (tambah, rename, hapus, merge, former name), bukan langsung di tabel: rename/merge ikut mengubah nama di semua tabel data dalam satu transaksi dan mencatat former name; edit langsung di `px_directorates` tidak melakukan itu.
- Setting baru `directory_admin_managed` di `px_app_settings`: `true` setelah perubahan pertama di menu itu; sejak itu server tidak menambahkan direktorat/divisi seed saat start. Tidak bisa diubah lewat `PUT /api/admin/settings`.
- **Database utama (2026-10-21)**: 4 direktorat di-rename (Sharia Banking -> Syariah Banking, Special Asset -> SLC ASG Satyaguna Langgeng Capital, "Strategy, Finance & SPAPM" -> Strategy & Finance, Treasury & Capital Market -> Treasury & Financial Institutions) + former name manual "SLC" dan "Consumer & Emerging Business Banking"; `directory_admin_managed` = true. `px_audit_log` tetap memuat nama lama.
- **Regression suite**: sejak v2.51.0 suite menyimpan konfigurasi Admin (12 tabel: journey, checkpoint, metrik, target, pertanyaan, master questions, action library, app settings, direktorat, divisi, dua tabel alias) sebelum run dan mengembalikannya sesudahnya; file sementara `server/data/backups/regression-config-snapshot.json` (gitignored, tanpa password). Jangan mengedit Admin Parameters selama suite berjalan - tertimpa saat restore akhir.
- Ikut `.bak`, `npm run db:export` dan import `migrate.js`; `migrate --reset` menghapus keduanya lalu memuat ulang dari `store.json` - rename dan former name yang dibuat di menu hanya kembali bila `store.json` sudah diekspor ulang (`npm run db:export -- --replace`, server dihentikan dulu).
- Pemeriksaan: `SELECT alias_name, directorate_name FROM dbo.px_directorate_aliases ORDER BY alias_id;` dan `SELECT setting_value FROM dbo.px_app_settings WHERE setting_key = 'directory_admin_managed';`


## 24. Social Media Metrik 1 & Token Integrasi (v2.52.0)

> Sejak v2.53.0 token integrasi, `POST /api/integrations/social-media` dan tabel `px_integration_tokens` dihapus - lihat §25. Data hanya lewat upload Excel.

- Tabel baru (dibuat otomatis saat server start): `px_social_media_stats` (satu baris per platform Instagram/LinkedIn/TikTok per bulan: followers, reach, engagement, `source` UPLOAD/INTEGRATION/SEED; unik `(platform, stat_year, stat_month)`), `px_social_media_uploads` (riwayat batch upload `.xlsx` dan kiriman integrasi) dan `px_integration_tokens` (token integrasi: hanya hash SHA-256 + petunjuk 12 karakter, nama, pembuat, pemakaian terakhir, dicabut). Jumlah tabel kini **37**. Rincian kolom: `docs/08` §25.
- **Setiap start**: baris SLA rekrutmen metrik 1 di `px_recruitment_sla_by_unit` dihapus (data salah untuk metrik bankwide social media; metrik lain tidak disentuh). Bila `SEED_DEMO_DATA` bukan `false`: dummy fiktif Januari-September 2026 (27 baris) ditambahkan hanya untuk bulan tanpa data asli.
- Data diisi lewat aplikasi (upload Excel Admin atau `POST /api/integrations/social-media` dengan token), bukan langsung di tabel: upload/injeksi menghapus dummy bulan yang disentuh dan mencatat batch serta audit. Skor metrik 1 tetap `raw_value` di `px_metrics`.
- **Token**: dibuat/dicabut di Admin Parameters -> Integrations. Token asli tidak ada di database - backup `.bak` tidak memuat token yang bisa dipakai. Tabel token **tidak** dihapus `migrate --reset` dan **tidak** ikut `npm run db:export` (seperti akun); setelah pindah database buat token baru.
- Ikut `.bak`; dua tabel social media ikut `npm run db:export` dan import `migrate.js`, dan dihapus `migrate --reset` (data asli hilang kecuali `store.json` diekspor ulang dulu). File asli upload ada di `server/data/social-uploads/` (gitignored, tidak ikut `.bak` - salin terpisah bila perlu).
- Pemeriksaan: `SELECT platform, stat_year, stat_month, followers, reach, engagement, source FROM dbo.px_social_media_stats ORDER BY stat_year, stat_month, platform;` dan `SELECT token_id, name, token_hint, created_at, last_used_at, revoked_at FROM dbo.px_integration_tokens;` (sampai v2.52.x)

## 25. Tabel token integrasi dihapus (v2.53.0)

- Fitur integrasi token v2.52.0 dihapus (on-premise, tanpa internet). `px_integration_tokens` tidak lagi ada di `schema.sql`; jumlah tabel kini **36**.
- Saat server start (dan di `npm run db:migrate`) tabel itu di-`DROP` **hanya bila kosong** (database utama: 0 baris); bila berisi, tabel dibiarkan dan log menampilkan peringatan - hapus manual setelah dicek. Aman dijalankan berulang.
- `CHECK` kolom `source` tabel social media masih mengizinkan `INTEGRATION` (tidak perlu migrasi), tetapi data social media kini hanya masuk lewat upload Excel Admin. Query token di §24 tidak berlaku lagi. Rincian: `docs/08` §26.

## 26. Skor bertingkat & nilai bulanan OUTCOME (v2.54.0)

- Kolom baru `px_metrics.score_tiers` (`NVARCHAR(400)`, JSON tier; `NULL` = dinilai menurut skala) dan dua tabel baru `px_outcome_values` (satu nilai bankwide per metrik per bulan, unik `(metric_id, stat_year, stat_month)`) dan `px_outcome_uploads` (riwayat batch). Dibuat otomatis saat server start. Jumlah tabel kini **38**. Rincian: `docs/08` §27.
- Boot mengisi `score_tiers` metrik 1, 2, 3, 14 sekali, hanya bila masih `NULL`; ubah tier lewat Admin Parameters, bukan langsung di tabel (nilai harus JSON valid; yang tidak valid dibaca sebagai "tidak bertier").
- Nilai bulanan diisi lewat upload Excel Admin (Explore Metrics -> Upload), bukan langsung di tabel - upload memvalidasi, mencatat batch dan audit `OUTCOME_UPLOAD`. File asli di `server/data/outcome-uploads/` (gitignored, **tidak** ikut `.bak` - salin terpisah).
- Ikut `.bak`, `npm run db:export` dan import `migrate.js`; dihapus `migrate --reset`. Nilai awal metrik 1 (0.66, September 2026) dan metrik 3 (75.04, September 2026) hanya ada di SQL Server sampai diekspor.
- Pemeriksaan: `SELECT metric_id, stat_year, stat_month, value, source, upload_id FROM dbo.px_outcome_values ORDER BY metric_id, stat_year, stat_month;`
