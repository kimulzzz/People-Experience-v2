# CIMB Niaga People Experience (PX) Integrated System
## 📚 Dokumentasi Lengkap Sistem & Arsitektur (End-to-End Documentation)

Selamat datang di repositori dokumentasi teknis, fungsional, dan operasional untuk **CIMB Niaga People Experience (PX) Integrated System**. Sistem ini dirancang khusus untuk mengukur, menganalisis, memonitor, dan meningkatkan pengalaman karyawan (*employee journey*) di lingkungan PT Bank CIMB Niaga Tbk secara kuantitatif dan kualitatif berdasarkan framework *"Kejar Mimpi"*.

---

## 🧭 Struktur Dokumentasi

Dokumentasi ini disusun secara sistematis mulai dari fondasi konsep (*Brains & Mathematical Model*), katalog data, arsitektur sistem, backend services, frontend UI hierarchy, manual operasional, hingga quality assurance regression suite.

```
📁 docs/
├── 📄 README.md                                  # [Index] Master Panduan & Peta Dokumentasi
├── 📄 01_PE_BRAINS_AND_MATHEMATICAL_MODEL.md      # [Brains] Konsep, Filosofi, 5 Journey & Rumus Matematika
├── 📄 02_DATA_DICTIONARY_AND_METRICS_CATALOG.md  # [Kamus Data] 27 Metrik, 4 Tipe Pertanyaan & Bank Soal
├── 📄 03_SYSTEM_ARCHITECTURE_AND_DATA_FLOW.md    # [Arsitektur] Diagram Sistem, Aliran Data & Keamanan
├── 📄 04_BACKEND_API_AND_SERVICES_SPECIFICATION.md# [Backend] Spesifikasi REST API, Service Engines & Storage
├── 📄 05_FRONTEND_UI_AND_COMPONENT_HIERARCHY.md  # [Frontend] Hirarki React Components, State & Desain UI
├── 📄 06_ADMIN_OPERATIONS_AND_USER_GUIDE.md      # [Panduan User] Manual Operasional HR & Konfigurasi Admin
├── 📄 07_TESTING_AND_QUALITY_ASSURANCE.md        # [QA & Testing] Regression Test Suite (27/27 Test Cases)
└── 📄 SURVEY_IMPORT_GUIDE.md                     # [Panduan Impor] Tata Cara Pengisian & Impor CSV Survei
```

---

## 📑 Ringkasan Dokumen

| No | Dokumen | Fokus Utama | Target Pembaca |
| :---: | :--- | :--- | :--- |
| **01** | [**Brains & Mathematical Model**](./01_PE_BRAINS_AND_MATHEMATICAL_MODEL.md) | Fondasi 5 Employee Journey, 17 Checkpoint, 27 Metrik, Bobot Konsolidasi ($70\%\ \text{Survey} + 30\%\ \text{Outcome}$), Normalisasi 4 Tipe Pertanyaan, dan Ambang Batas Alert. | Executive HR, Data Scientist, System Architect |
| **02** | [**Data Dictionary & Metrics Catalog**](./02_DATA_DICTIONARY_AND_METRICS_CATALOG.md) | Spesifikasi lengkap 7 Metrik Outcome (Data HR Internal) vs 20 Metrik Survey, Kamus Kolom CSV, 4 Tipe Skala, dan 15 Butir Pertanyaan Baku Metrik #7. | HR Business Partner, System Admin, Data Analyst |
| **03** | [**System Architecture & Data Flow**](./03_SYSTEM_ARCHITECTURE_AND_DATA_FLOW.md) | Diagram arsitektur client-server, Data Flow Diagrams (DFD Level 0 & 1), siklus hidup data survei, kepatuhan on-premise, dan keamanan data NIP. | Solution Architect, DevOps, Security Auditor |
| **04** | [**Backend API & Services Specification**](./04_BACKEND_API_AND_SERVICES_SPECIFICATION.md) | Endpoint REST API Express.js, Service Engines (`calculationEngine`, `surveyImportService`, `surveyTemplateService`, `surveyEvidenceService`, `pptExportService`), dan Storage Layer. | Backend Developer, Integrator, DevOps |
| **05** | [**Frontend UI & Component Hierarchy**](./05_FRONTEND_UI_AND_COMPONENT_HIERARCHY.md) | Struktur pohon komponen React 19, Tailwind CSS styling, State management, Modal orchestration, dan Public mobile check-in/feedback forms. | Frontend Developer, UI/UX Designer |
| **06** | [**Admin Operations & User Guide**](./06_ADMIN_OPERATIONS_AND_USER_GUIDE.md) | Panduan langkah demi langkah: Setting Template Survei Admin, Download CSV Template & Evidence, Upload Berkas Survei, Manajemen Signature Events, dan Generate PPT Report. | Super Admin HR, PIC Program, Operasional HR |
| **07** | [**Testing & Quality Assurance**](./07_TESTING_AND_QUALITY_ASSURANCE.md) | Dokumentasi 11 Modul Regression Test Suite, 34 skenario pengujian otomatis, petunjuk eksekusi test runner, dan verifikasi build Vite. | QA Engineer, Lead Developer, HR Auditor |

---

## 🚀 Ringkasan Teknologi Sistem

- **Frontend Core**: React 19, Vite, Tailwind CSS v4, Lucide React Icons.
- **Backend Core**: Node.js, Express.js REST API, Multi-format CSV Engine.
- **Storage Layer**: Local JSON transactional store (`data/store.json`) dengan sinkronisasi memori real-time (100% On-Premise compliant, tanpa dependensi cloud pihak ketiga).
- **Automation & Reporting**: PPTXgenJS (Otomasi PowerPoint Corporate Deck), UTF-8 BOM CSV Generator, Dynamic Question Header Compiler.
- **Testing Engine**: Native Node.js Assertion Regression Runner (34/34 Test Cases Passing, 100% Pass Rate).

---

## 🏛️ Prinsip Kepatuhan & Keamanan Data CIMB Niaga

1. **100% On-Premise Compliant**: Seluruh komputasi skor dan penyimpanan database berjalan di dalam infrastruktur internal tanpa mengekspos data ke server eksternal.
2. **Mandatory NIP Validation**: NIP karyawan diverifikasi sebagai *primary key* unik untuk mencegah manipulasi data survei atau duplikasi kehadiran.
3. **Audit Trail Evidence**: Setiap hasil survei memiliki berkas *Evidence Log* berformat `.csv` yang mencatat tanggal pengisian, identitas koresponden, jawaban per butir soal, dan komentar verbatim untuk keperluan audit internal.

---

*Hak Cipta © 2026 PT Bank CIMB Niaga Tbk. People Experience Framework. All Rights Reserved.*
