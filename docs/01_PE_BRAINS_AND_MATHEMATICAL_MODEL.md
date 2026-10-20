# 01. People Experience Brains & Mathematical Model
**CIMB Niaga People Experience (PX) Framework**

---

## 🧠 1. Filosofi & Fondasi Konseptual

Pengalaman Karyawan (*People Experience / PX*) di PT Bank CIMB Niaga Tbk dibangun berdasarkan visi *"Kejar Mimpi"*, yang menempatkan karyawan sebagai aset utama yang menjalani perjalanan holistik sepanjang masa baktinya di bank.

Sistem People Experience dirancang sebagai **"Measurement & Action Engine"** yang tidak hanya menghitung skor kepuasan secara pasif, melainkan menghubungkan persepsi karyawan (*Survey Sentiment*) dengan data transaksional operasional (*HR Outcomes*) untuk menghasilkan rekomendasi inisiatif perbaikan secara otomatis.

```
       ┌────────────────────────────────────────────────────────┐
       │             CIMB NIAGA PEOPLE EXPERIENCE               │
       │                   INTEGRATED INDEX                     │
       └───────────────────────────┬────────────────────────────┘
                                   │
                  ┌────────────────┴────────────────┐
                  ▼                                 ▼
       ┌─────────────────────┐           ┌─────────────────────┐
       │   SURVEY INDEX      │           │    OUTCOME INDEX    │
       │   Bobot: 70%*       │           │   Bobot: 30%*       │
       │  (Persepsi & Rasa)  │           │   (Data Fakta HR)   │
       └──────────┬──────────┘           └──────────┬──────────┘
                  │                                 │
                  └────────────────┬────────────────┘
                                   │
                                   ▼
        ┌──────────────────────────────────────────────────────┐
        │                 5 EMPLOYEE JOURNEYS                  │
        │      Arrival • Connect • Belong • Contribute • Depart│
        └──────────────────────────────────────────────────────┘
```

\* Bobot default. Sejak v2.48.0 bobot diatur Admin (setting `px_index_weights`), lihat §3.1.

---

## 🗺️ 2. Arsitektur 5 Employee Journeys & 17 Checkpoints

Framework ini memetakan seluruh siklus kerja karyawan ke dalam **5 Tahapan Utama (Journeys)**, yang dipecah menjadi **17 Titik Sentuh Kritis (Checkpoints)** dan diukur melalui **27 Metrik Terstandarisasi**:

```mermaid
graph TD
    subgraph J1["1. ARRIVAL (Kandidat s/d Hari Pertama)"]
        CP1["CP 1.1: Employer Branding & Campus Outreach"]
        CP2["CP 1.2: Selection & Interview Process"]
        CP3["CP 1.3: Offering & Pre-boarding Engagement"]
        CP4["CP 1.4: Day 1 Onboarding & Welcome Experience"]
    end

    subgraph J2["2. CONNECT (Orientasi & Adaptasi Peran)"]
        CP5["CP 2.1: 30-60-90 Days Onboarding Journey"]
        CP6["CP 2.2: Direct Supervisor Support & Buddy System"]
        CP7["CP 2.3: Internal Career Transition (Rotation/Transfer)"]
    end

    subgraph J3["3. BELONG (Budaya, Keterlibatan & Kesejahteraan)"]
        CP8["CP 3.1: Signature Programs (Perspektif, D&I, EVD)"]
        CP9["CP 3.2: Arjuna Peer & Leader Recognition"]
        CP10["CP 3.3: Employee Wellbeing (Fisik, Mental, Finansial)"]
        CP11["CP 3.4: Psychological Safety & Voice"]
        CP12["CP 3.5: Leadership Connection & Communication"]
    end

    subgraph J4["4. CONTRIBUTE (Kinerja, Pembelajaran & Pengembangan)"]
        CP13["CP 4.1: Learning, Upskilling & Growth Journey"]
        CP14["CP 4.2: Mentoring & Coaching Culture"]
        CP15["CP 4.3: Performance & Career Dialogue"]
        CP16["CP 4.4: Meaningful Purpose & High Potential Retention"]
    end

    subgraph J5["5. DEPART (Transisi Akhir & Alumni)"]
        CP17["CP 5.1: Offboarding, Exit Experience & Attrition"]
    end
```

---

## 📐 3. Formula Matematika & Model Komputasi

### 3.1 Formula Utama: Konsolidasi PE Index Nasional

Indeks People Experience CIMB Niaga dikalkulasi menggunakan prinsip pembobotan gabungan antara instrumen kualitatif (*Survey*) dan fakta transaksional internal (*Outcome*):

$$\mathbf{PE\ Index} = \left( W_{\text{survey}} \times \mathbf{Index}_{\text{survey}} \right) + \left( W_{\text{outcome}} \times \mathbf{Index}_{\text{outcome}} \right)$$

Dimana secara default:
$$W_{\text{survey}} = 0.70 \quad (70\%), \qquad W_{\text{outcome}} = 0.30 \quad (30\%)$$

$$PE\ Index = 0.70 \times Index_{\text{survey}} + 0.30 \times Index_{\text{outcome}}$$

**Bobot dapat diubah (sejak v2.48.0)**: $W_{\text{survey}}$ dan $W_{\text{outcome}}$ dibaca dari setting `px_app_settings.px_index_weights` (seed `{ "survey": 70, "outcome": 30 }`). Admin mengubahnya di **Admin Parameters -> Journey Parameters -> PX Index Weights** (`PUT /api/admin/settings/px_index_weights`): bilangan bulat 0-100 yang berjumlah 100, selain itu ditolak (400). Bobot yang sama dipakai untuk PX Index dan skor journey (§3.6). Angka 0.70 / 0.30 di dokumen ini adalah nilai default. Engine membaca setting lewat `getPxWeights()` (cache 30 detik per proses); bila nilai tersimpan hilang atau tidak valid dipakai 70/30. `GET /api/metrics/calculate` mengirim bobot yang dipakai sebagai `px_weights` dan `weights_formula`.

**Komponen tanpa data (sejak v2.36.0)**: indeks komponen yang tidak punya satu pun metrik berdata dalam periode terpilih bernilai `null`; bobot Survey/Outcome tidak dipaksakan. `GET /api/metrics/calculate` mengirim `px_index_basis`:

| `px_index_basis` | Kondisi | PX Index |
| :--- | :--- | :--- |
| `BOTH` | Survey Index dan Outcome Index berdata | $W_{\text{survey}} \times Index_{\text{survey}} + W_{\text{outcome}} \times Index_{\text{outcome}}$ (default 0.70 / 0.30) |
| `SURVEY_ONLY` | Tidak ada metrik Outcome aktif | = Survey Index |
| `OUTCOME_ONLY` | Tidak ada metrik survei berdata (mis. tahun depan) | = Outcome Index |
| `NONE` | Keduanya kosong | `null` |

---

### 3.2 Normalisasi Skor Level Pertanyaan (4 Tipe Pertanyaan)

Sistem mendukung 4 tipe input pertanyaan pada kuesioner survei. Setiap tipe dinormalisasi ke skala seragam **$0.0\% - 100.0\%$**:

#### 1. Skala 1 s/d 5 (`SCALE_1_5`)
Rating likert 5 skala.
$$\text{Normalized Score}_i = \left( \frac{V_i}{5.0} \right) \times 100\%$$
*Contoh*: Nilai $4.85 \rightarrow \left(\frac{4.85}{5}\right) \times 100 = 97.0\%$.

#### 2. Skala 1 s/d 10 (`SCALE_1_10`)
Rating kepuasan 10 poin (NPS / CSAT).
$$\text{Normalized Score}_i = \left( \frac{V_i}{10.0} \right) \times 100\%$$
*Contoh*: Nilai $8.50 \rightarrow \left(\frac{8.50}{10}\right) \times 100 = 85.0\%$.

#### 3. Biner Ya / Tidak (`YES_NO`)
Jawaban biner berbasis kepatuhan/keberadaan fasilitas.
$$\text{Score}(V_i) = \begin{cases} 100\%, & \text{jika } V_i \in \{\text{'Ya'}, \text{'Y'}, \text{'True'}, \text{'1'}\} \\ 0\%, & \text{jika } V_i \in \{\text{'Tidak'}, \text{'T'}, \text{'False'}, \text{'0'}\} \end{cases}$$
Persentase ketercapaian butir soal $k$ dari $N$ responden:
$$\% \text{Ya}_k = \left( \frac{N_{\text{Ya}}}{N_{\text{Ya}} + N_{\text{Tidak}}} \right) \times 100\%$$

#### 4. Free Text / Kualitatif (`FREE_TEXT`)
Komentar dan saran teks bebas.
- **Sifat Komputasi**: *Non-scorable* (dikecualikan dari penyebut nilai rerata numerik responden agar tidak mendistorsi bobot matematis).
- **Output**: Disimpan sebagai feed verbatim kualitatif untuk analisis sentimen dan referensi AI Action Library.

---

### 3.3 Agregasi Skor Responden Individual

Untuk seorang koresponden $r$ yang mengisi instrumen dengan $K$ butir pertanyaan yang bernilai numerik/scorable ($K_{\text{scorable}} \subseteq K$):

$$\text{Respondent Score}_r = \frac{1}{|K_{\text{scorable}}|} \sum_{k \in K_{\text{scorable}}} \text{Normalized Score}_{r, k}$$

---

### 3.4 Agregasi Skor Metrik ($M_m$)

Skor agregat metrik $m$ diperoleh dari rerata seluruh respon valid yang masuk dalam periode berjalan:

$$\mathbf{Metric\ Normalized\ Score}_m = \frac{1}{N_m} \sum_{r=1}^{N_m} \text{Respondent Score}_r$$

Untuk metrik tipe **Outcome** yang berbasis data persentase langsung (misal: % SLA Fulfilment, % Early Attrition):
$$\mathbf{Metric\ Normalized\ Score}_m = \text{Achieved Percentage} \ (\%)$$

---

### 3.5 Agregasi Skor Checkpoint ($CP_c$)

Setiap checkpoint $c$ menaungi $M_c$ metrik:

$$\mathbf{Checkpoint\ Score}_c = \frac{1}{M_c} \sum_{m=1}^{M_c} \mathbf{Metric\ Normalized\ Score}_m$$

---

### 3.6 Agregasi Skor Journey ($J_j$)

Skor suatu Journey $j$ diperoleh dari rata-rata terbobot atau rata-rata sederhana dari seluruh metrik di dalamnya:

$$\mathbf{Journey\ Score}_j = \sum_{m \in J_j} \left( w_m \times \mathbf{Metric\ Normalized\ Score}_m \right)$$

Dimana $\sum_{m \in J_j} w_m = 1.0$ (secara default bobot terdistribusi merata / *equal weights* antar metrik dalam journey tersebut, kecuali disesuaikan oleh Admin pada menu Bobot Journey).

---

### 3.7 Agregasi Indeks Survei & Indeks Outcome

$$\mathbf{Index}_{\text{survey}} = \frac{1}{|M_{\text{survey}}|} \sum_{m \in M_{\text{survey}}} \mathbf{Metric\ Normalized\ Score}_m$$

$$\mathbf{Index}_{\text{outcome}} = \frac{1}{|M_{\text{outcome}}|} \sum_{m \in M_{\text{outcome}}} \mathbf{Metric\ Normalized\ Score}_m$$

Dimana:
- $|M_{\text{survey}}| = 20$ metrik.
- $|M_{\text{outcome}}| = 7$ metrik.

**Implementasi (`calculatePEIndex()`, sejak v2.36.0)**: kedua rerata di atas adalah rerata berbobot (`weight` per metrik, default 1.0) dan hanya mencakup metrik aktif yang **punya data di jendela periode** (jumlahnya tidak selalu 20/7). Metrik SURVEY tanpa data (`NO_DATA`, §4) tidak masuk pembilang maupun penyebut. Sejak v2.48.0 tidak ada lagi metrik yang dikecualikan filter direktorat: metrik non-karyawan dihitung pada nilai bankwide (§6.1; `is_disabled` / `excluded_from_index` selalu `false`). Aturan yang sama berlaku untuk skor checkpoint (§3.5, rerata berbobot semua metrik berdata) dan journey (§3.6, bobot Survey/Outcome yang sama dengan PX Index per journey, atau satu komponen saja bila komponen lain kosong). Journey/checkpoint tanpa metrik berdata bernilai `null` dengan `has_data: false`.

---

### 3.8 Model Agregasi Skor Butir Pertanyaan ESS (Employee Sentiment Survey)

Untuk 11 metrik survei yang bersumber dari **ESS (Employee Sentiment Survey)**, skor metrik dihitung dari rata-rata persentase respon positif (*% Favorable*) butir-butir pertanyaan dalam dimensi terkait:

$$\mathbf{ESS\ Dimension\ Score}_d = \frac{1}{|Q_d|} \sum_{q \in Q_d} \text{\% Favorable}_q$$

$$\mathbf{Metric\ Normalized\ Score}_{m \in \text{ESS}} = \mathbf{ESS\ Dimension\ Score}_{d(m)}$$

Dimana:
- $Q_d$ adalah himpunan pertanyaan berbobot dalam dimensi $d$.
- $\text{\% Favorable}_q + \text{\% Neutral}_q + \text{\% Unfavorable}_q = 100\%$.
- Setiap pertanyaan memiliki metadata aturan keterlihatan (*visible based on*) dan kewajiban pengisian (*required based on*).

---

## ⏳ 4. Model Agregasi Waktu: Period Filter (YTD vs MTD)

Aturan sejak v2.36.0; periode MTD per metrik diubah di v2.37.0. Jendela periode dihitung di `server/db/filterUtils.js` (`ytdEndMonth`, `periodWindow`, `parseFilterOptions`) dan dipakai kedua backend storage (`sqlStorage.buildResponseFilter`, `jsonStorage.applyResponseFilters`), sehingga SQL Server dan JSON membaca baris yang sama.

1. **Year-to-Date (YTD) - default**:
   - Tahun berjalan (jam server): 1 Januari s.d. **akhir bulan berjalan**. Contoh: 19 Okt 2026 -> 2026-01-01 s.d. 2026-10-31. Baris bertanggal setelah bulan ini tidak ikut.
   - Tahun lalu: setahun penuh (Januari-Desember). Tahun depan: jendela kosong (semua metrik SURVEY `NO_DATA`).
   - `endMonth` eksplisit (titik Performance Trend mode YTD) dipakai, tetapi tidak pernah melewati batas di atas.

2. **Month-to-Date (MTD, `YYYY-MM`)**:
   - $D_{\text{filter}} = \{d \in D \mid \text{Format}(d.\text{date}, \text{'YYYY-MM'}) = \text{SelectedMonth}\}$ - hanya bulan itu, untuk **setiap** metrik SURVEY (sejak v2.37.0 juga metrik Annual dan ESS); `period_window.basis` selalu `MONTH`.

3. **Periode per metrik** (sejak v2.37.0 tidak lagi ditentukan `update_frequency`, yang kembali hanya untuk pengingat e-mail):

   | Jenis metrik | YTD tahun Y | MTD Y-M |
   | :--- | :--- | :--- |
   | SURVEY SYSTEM (Monthly maupun Annual) | Januari s.d. batas YTD | Hanya bulan M |
   | ESS (ringkasan `.xlsx`, `selectEssResult`) | Hasil terbaru tahun Y yang bulannya di dalam jendela | Hanya hasil yang Year + Month template-nya = Y-M; selain itu `NO_DATA` |
   | OUTCOME | Snapshot saat ini, tanpa filter periode | Sama |

   Tidak ada *carry-forward* (aturan v2.32.0 dihapus). Aturan v2.36.0 "metrik Annual pada MTD Y-M = Januari s.d. M" (`effectiveMetricPeriod`) dihapus di v2.37.0. Contoh dengan hasil ESS 2025-11 (file asli) + dummy 2026-03/06/09 (v2.37.0): metrik 9 = 92 pada MTD 2025-11 dan YTD 2025; `NO_DATA` pada MTD 2025-10, MTD 2025-12, MTD 2026-01 dan MTD 2026-10; MTD 2026-03 / 2026-06 / 2026-09 = hasil kuartal itu (MTD 2026-06 = 91.8); YTD 2026 (per 19 Okt 2026) = hasil 2026-09 (93.7). Response menyertakan `period_window = { from, to, basis }` per metrik SURVEY (`MONTH` untuk MTD, `YEAR_TO_MONTH` untuk YTD; OUTCOME `null`).

4. **Status `NO_DATA`**: metrik SURVEY tanpa data di jendelanya -> `has_data: false`, `raw_value` / `normalized_score` / `gap` = `null`, `sample_size` = 0. Tidak ada fallback ke `raw_value` statis (juga untuk metrik 12, yang `raw_value`-nya masih ditulis sinkron feedback event). Metrik ini tidak ikut Survey Index, rollup journey/checkpoint (§3.7) dan alert (§5). Metrik OUTCOME tidak pernah `NO_DATA`.

5. **Performance Trend (`computeMonthlyTrends`)**:
   - Hanya bulan yang sudah lengkap (s.d. bulan lengkap terakhir); mode YTD = kumulatif Januari tahun titik itu s.d. bulan titik, mode MTD = per bulan. Setiap titik dihitung dengan `calculatePEIndex()` yang sama dengan scorecard, jadi aturan 1-4 berlaku per titik.
   - Titik tanpa data survei: `survey_index` dan `px_index` = `null` (celah di grafik), bukan PX dari Outcome saja.

---

## 🚨 5. Alert & Deficit Detection Engine

Sistem mengimplementasikan deteksi anomali kinerja secara real-time untuk setiap metrik $m$:

```
      Normalized Score (%)
               │
      100% ────┼───────────────────────────
               │  🟢 EXCELLENT / ON TARGET
       80% ────┼─────────────────────────── [Target Batas Aman: >= 80%]
               │  🟡 WARNING / WATCHLIST
       75% ────┼─────────────────────────── [Ambang Toleransi / Min Threshold: 75%]
               │  🔴 CRITICAL DEFICIT
        0% ────┴───────────────────────────
```

### Logika Klasifikasi Status:
1. **On Target (Hijau)**: $\text{Normalized Score}_m \ge \text{Target Value}$ (Default $\ge 80.0\%$).
2. **Warning / Needs Attention (Kuning)**: $\text{Min Threshold} \le \text{Normalized Score}_m < \text{Target Value}$ ($75.0\% \le \text{Score} < 80.0\%$).
3. **Critical Deficit (Merah)**: $\text{Normalized Score}_m < \text{Min Threshold}$ ($< 75.0\%$).
   - Memicu pembuatan entri pada **Pusat Peringatan & Defisit Kinerja PE** (`/api/alerts`).
   - Otomatis menghubungkan metrik yang defisit ke **Action Library** untuk memunculkan inisiatif perbaikan berbasis AI dan SOP internal CIMB Niaga.
4. **No Data (abu-abu, sejak v2.36.0)**: metrik SURVEY tanpa data di periode terpilih (`status: 'NO_DATA'`, skor `null`). Tidak dibandingkan dengan target/threshold dan tidak pernah memicu alert (`alertEngine.js` melewati metrik dengan `has_data === false`).

---

## 🏛️ 6. Filter Direktorat & Metrik Non-Karyawan

### 6.1 Aturan sejak v2.48.0: metrik non-karyawan dihitung pada nilai bankwide

Permintaan user (2026-10-20): nilai sebuah direktorat = metrik direktorat itu + metrik yang hanya ada bankwide. Berlaku untuk setiap filter direktorat/divisi (Admin) dan setiap cakupan User (`scopes`), di `calculatePEIndex()`, `getMetricDetail()`, `alertEngine.js` dan `GET /api/metrics/by-directorate`:

1. **Metrik karyawan** (`is_employee_metric` true, #6-#27) dibaca dari data unit/cakupan yang difilter (tidak berubah).
2. **Metrik non-karyawan** (`is_employee_metric === false`, #1-#5: Career Website Traffic, Goes to Campus Evaluation, University Success Ratio, Channel Success Ratio, Candidate Experience Score) tidak punya data per direktorat, jadi dibaca pada **nilai bankwide**: SURVEY = respons bankwide (filter direktorat/divisi/cakupan diabaikan, periode tetap), ESS = baris Bankwide, OUTCOME = snapshot bankwide. Metrik ini ditandai `is_bankwide_value: true`.
3. Metrik non-karyawan **ikut dihitung** di Survey Index, Outcome Index, checkpoint, journey dan alert:

   $$PX_{dir} = W_{\text{survey}} \times \overline{S}_{dir} + W_{\text{outcome}} \times \overline{O}$$

   dengan $\overline{S}_{dir}$ = rerata berbobot metrik SURVEY berdata (metrik karyawan direktorat + metrik non-karyawan pada nilai bankwide) dan $\overline{O}$ = rerata berbobot metrik OUTCOME (snapshot bankwide, sehingga Outcome Index di bawah filter = Outcome Index bankwide).
4. Aturan `NO_DATA` (§4) dan `px_index_basis` (§3.1) tidak berubah.
5. `is_disabled` dan `excluded_from_index` tetap ada di payload untuk kompatibilitas tetapi selalu `false` (`disabled_reason` = `null`, `disabled_metrics_count` = 0); `bankwide_value_metrics_count` = jumlah metrik `is_bankwide_value`.

Dampak YTD 2026 (laporan developer, PX / Outcome): Business Banking 83.28 / 70.13 -> 84.83 / 75.08, Human Resources 83.61 / 70.13 -> 85.13 / 75.08, Sharia Banking 84.98 / 70.13 -> 86.30 / 75.08; bankwide tidak berubah (85.27). Sebelum v2.48.0 Admin melihat metrik #1-#5 dikecualikan (§6.2) dan User (sejak v2.26.0) melihatnya sebagai nilai bankwide read-only yang tidak dihitung (`excluded_from_index`).

### 6.2 Aturan lama: eksklusi dinamis (v2.9.0 s/d v2.47.0) - TIDAK BERLAKU LAGI

> Digantikan §6.1 sejak v2.48.0. Teks di bawah hanya catatan sejarah.

Ketika sistem difilter berdasarkan **Direktorat atau Sub-Direktorat** tertentu (bukan *All / Bankwide*), metrik non-karyawan dieksklusikan secara dinamis:

1. **Klasifikasi Metrik**:
   - **Internal Employee Metrics ($M_{\text{emp}}$)**: Metrik #6 s/d #27 (misal: Pre-boarding, Day 1 Onboarding, Onboarding 30/60/90, 11 Dimensi ESS, Training Attendance, Promotion Rate, Turnover Rate, Exit Survey).
   - **External / Non-Employee Metrics ($M_{\text{ext}}$)**: Metrik #1 s/d #5 (Career Website Traffic, Goes to Campus Evaluation, University Success Ratio, Channel Success Ratio, Candidate Experience Score).

2. **Formulasi Normalisasi Bobot Dinamis**:
   Untuk journey $j$ yang memiliki subset metrik aktif $M_{j, \text{active}} \subseteq M_j$ yang relevan dengan karyawan direktorat:
   $$w_{m, \text{normalized}} = \frac{w_m}{\sum_{k \in M_{j, \text{active}}} w_k}$$

   $$\mathbf{Journey\ Score}_j = \sum_{m \in M_{j, \text{active}}} \left( w_{m, \text{normalized}} \times \mathbf{Score}_m \right)$$

   Untuk metrik non-karyawan yang dinonaktifkan:
   - Diberi status `is_disabled = true` dan `disabled_reason = "Non-employee external metric excluded from directorate view"`.
   - Ditampilkan dengan warna abu-abu (*muted grey*) dan tidak dapat diklik (*unclickable*).
   - Seluruh metrik aktif dalam Journey 1 s/d 5 menggulung ke total **People Experience Index** dengan bobot 70% Survey dan 30% Outcome secara proporsional.

