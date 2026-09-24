# 03. System Architecture & Data Flow
**CIMB Niaga People Experience (PE) Framework**

---

## 🏛️ 1. Arsitektur Sistem (High-Level Architecture)

Sistem People Experience CIMB Niaga dirancang dengan arsitektur **Modern Single-Page Application (SPA) terintegrasi dengan RESTful Micro-Services Backend** yang beroperasi secara mandiri (*standalone on-premise*) tanpa ketergantungan pada layanan cloud pihak ketiga:

```mermaid
graph TB
    subgraph ClientLayer["🖥️ CLIENT LAYER (Frontend SPA)"]
        UI_Dash["Dashboard & Visual Analytics<br/>(Radar, 12-Month Trends, Scorecards)"]
        UI_Calc["Metrics Explorer & Action Buttons<br/>(Template, Evidence, Upload, Detail)"]
        UI_Modal["Interactive Modals<br/>(Question Breakdown, Admin Template, Targets)"]
        UI_Event["Signature Events Management<br/>(QR Code, Check-in, Feedback, PPT)"]
        UI_Public["Mobile Public Forms<br/>(QR Absensi & Post-Event Survey)"]
    end

    subgraph APILayer["⚡ API GATEWAY & CONTROLLERS (Node.js Express)"]
        Router["Express REST API Router (/api/*)"]
        AuthMiddleware["Security, Header Parser & CORS Handler"]
    end

    subgraph ServiceLayer["⚙️ BUSINESS LOGIC & SERVICE ENGINES"]
        Engine_Calc["Calculation Engine<br/>(PE Index, Periods, MoM Trends, Normalizer)"]
        Engine_Question["Metric Question Service<br/>(4 Question Types, Default Banks, Reorder)"]
        Engine_Template["Survey Template Service<br/>(Dynamic CSV Compiler with Hints)"]
        Engine_Import["Survey Import Service<br/>(Multi-Type Parser, 100/0 Biner, Validator)"]
        Engine_Evidence["Survey Evidence Service<br/>(UTF-8 BOM CSV Audit Trail)"]
        Engine_PPT["PowerPoint Export Service<br/>(PPTXgenJS Corporate Report Deck)"]
        Engine_Alert["Alert & Deficit Engine<br/>(Action Library Mapper)"]
    end

    subgraph StorageLayer["💾 PERSISTENCE & DATA STORE"]
        JSON_Store["Transactional JSON Store<br/>(data/store.json & In-Memory Cache)"]
        File_Export["Export Artifacts Generator<br/>(.CSV & .PPTX Output)"]
    end

    %% Flow Connections
    ClientLayer <-->|HTTP JSON / REST APIs| APILayer
    APILayer --> AuthMiddleware
    AuthMiddleware --> Router
    Router --> ServiceLayer
    ServiceLayer <--> StorageLayer
```

---

## 🔄 2. Data Flow Diagram (DFD)

### 2.1 DFD Level 0: Context Diagram

```mermaid
graph LR
    UserAdmin["👤 HR Admin / Executive"]
    UserEmp["📱 Karyawan / Peserta"]
    System["📦 CIMB Niaga People Experience System"]
    
    UserAdmin -->|"1. Konfigurasi Pertanyaan & Template<br/>2. Setting Target & Bobot<br/>3. Unggah Berkas CSV Survei<br/>4. Buat Signature Event"| System
    UserEmp -->|"1. Absensi QR Pra-Event<br/>2. Isi Kuesioner Evaluasi Event"| System

    System -->|"1. Live PE Index Dashboard & Tren<br/>2. Download Template & Evidence CSV<br/>3. Download Executive PPT Report<br/>4. Rekomendasi Action Library"| UserAdmin
    System -->|"1. Konfirmasi Kehadiran Sukses<br/>2. Feedback Tersimpan"| UserEmp
```

---

### 2.2 DFD Level 1: Dekomposisi Proses Utama

```mermaid
flowchart TD
    subgraph P1["Proses 1.0: Real-time PE Calculation"]
        D1[("Database Store")] -->|Ambil Respon & Target| P1_Calc[Kalkulasi Normalisasi 70/30]
        P1_Calc -->|Period Filter: YTD / YYYY-MM| P1_Out[JSON Skor Konsolidasi, Radar & Tren]
    end

    subgraph P2["Proses 2.0: Dynamic CSV Template & Question Builder"]
        Admin_Req[Request Template Metrik] --> P2_Gen[Baca Konfigurasi 4 Tipe Pertanyaan]
        P2_Gen --> P2_Compile[Kompilasi Header & Sample Row]
        P2_Compile -->|Stream CSV| Admin_DL[Unduh File Template .csv]
    end

    subgraph P3["Proses 3.0: Survey CSV Bulk Import Engine"]
        Upload_File[File CSV Diunggah] --> P3_Parse[Parser Delimiter & Sanitizer]
        P3_Parse --> P3_Val[Validasi NIP, Metric ID & Tipe Jawaban]
        P3_Val -->|Valid| P3_Save[Simpan Respon ke Store & Kalkulasi Ulang]
        P3_Val -->|Invalid| P3_Err[Laporan Baris Gagal & Alasan Error]
    end

    subgraph P4["Proses 4.0: Event Management & PPT Generator"]
        Event_Form[Peserta Submit Rating Event] --> P4_Store[Catat Skor Evaluasi]
        P4_Store --> P4_PPT[PPTXgenJS Compile Slides & Charts]
        P4_PPT --> PPT_File[Unduh Executive Report .pptx]
    end
```

---

## 🔄 3. Siklus Hidup Data Survei (Survey Data Lifecycle)

```
   ┌──────────────────────┐
   │ 1. KONFIGURASI ADMIN │ ──> Admin menyusun butir soal & tipe jawaban di Admin Modal
   └──────────┬───────────┘
              │
              ▼
   ┌──────────────────────┐
   │ 2. GENERATE TEMPLATE │ ──> Sistem menghasilkan berkas CSV dengan header pertanyaan spesifik
   └──────────┬───────────┘
              │
              ▼
   ┌──────────────────────┐
   │ 3. PENGISIAN DATA    │ ──> HR mendistribusikan / mengisi CSV respon karyawan
   └──────────┬───────────┘
              │
              ▼
   ┌──────────────────────┐
   │ 4. VALIDASI & IMPORT │ ──> Parser memverifikasi NIP, normalisasi Ya/Tidak (100/0) & skala
   └──────────┬───────────┘
              │
              ▼
   ┌──────────────────────┐
   │ 5. REKALKULASI INDEX │ ──> PE Index, radar chart, skor journey, dan tren bulanan ter-update
   └──────────┬───────────┘
              │
              ▼
   ┌──────────────────────┐
   │ 6. AUDIT EVIDENCE    │ ──> Tim HR dapat mengekspor berkas audit CSV berstempel tanggal
   └──────────────────────┘
```

---

## 🔒 4. Keamanan, Kepatuhan On-Premise & Integritas Data

1. **Zero External Dependency (On-Premise Ready)**:
   - Seluruh backend berjalan di lingkungan intranet Bank tanpa memerlukan koneksi internet aktif atau layanan cloud SaaS.
2. **Validasi Karyawan Berbasis NIP**:
   - NIP diverifikasi pada setiap baris data survei maupun absensi event untuk memastikan tidak terjadi duplikasi respon dari karyawan yang sama dalam satu periode penilaian.
3. **Standar Berkas CSV UTF-8 BOM**:
   - Berkas CSV ekspor (baik template maupun evidence) menggunakan encoding UTF-8 dengan Byte Order Mark (`\uFEFF`) guna memastikan kompatibilitas sempurna saat dibuka di Microsoft Excel versi desktop perbankan tanpa merusak karakter khusus atau format kolom.
4. **Resiliency & Fallback Column Matching**:
   - Parser impor survei dilengkapi algoritma *fuzzy header matching* yang tetap mengenali kolom pertanyaan baik berdasarkan nama *key* unik (`q1_recruitment_process`) maupun urutan nomor urut (`q1`, `q2`, `q3`, dst.).
5. **Sub Agent "Auditor" — Audit Data Dummy/Hardcode (`.claude/agents/auditor.md`)**:
   - Persona *read-only* untuk memeriksa codebase secara berkala dan mendeteksi nilai yang dibekukan (hardcoded) dalam logika bisnis (`server/services/*.js`) yang seharusnya bersumber dari database (`server/db/storage.js` / `store.json`), parameter admin yang dapat diedit, atau jam server real-time — dibedakan secara eksplisit dari `server/db/seedData.js` yang memang sengaja berisi data seed/demo statis (bukan bug). Jalankan lewat Agent tool dengan membaca instruksi di `.claude/agents/auditor.md` sebagai brief. Temuan pertama (2026-09-18, lihat `CHANGELOG.md` **[2.12.0]**): peta tanggal ingestion Outcome yang hardcoded di kode dipindah menjadi field database `last_data_date`, tahun `'2026'` yang dibekukan di banyak tempat diganti turunan jam server, dan agregasi verbatim alert yang hanya mengambil dari 1 event ID hardcoded diperluas ke seluruh event di database.
