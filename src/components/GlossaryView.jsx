// src/components/GlossaryView.jsx
import React, { useState, useMemo } from 'react';
import {
  Search,
  BookMarked,
  Compass,
  Wrench,
  UserPlus,
  Users,
  HeartHandshake,
  TrendingUp,
  LogOut,
  X
} from 'lucide-react';

// Sourced from docs/People_Experience_Glossary_Full_Text.xlsx — 44 official PX Framework terms,
// grouped into the same 5 Employee Journeys used everywhere else in this app (Dashboard journey
// cards, Explore Metrics filters), plus a "Framework & Konsep Inti" group for cross-cutting
// concepts and a "Tools & Sistem" group for internal CIMB systems referenced by the glossary.
const GLOSSARY_TERMS = [
  // --- Framework & Konsep Inti ---
  { term: 'People Experience (PX)', def: 'Keseluruhan pengalaman karyawan di CIMB Niaga sepanjang employee lifecycle, mulai dari tahap menarik kandidat hingga karyawan meninggalkan organisasi. PX terdiri dari 5 journey yang membentuk momen-momen bermakna.', category: 'FRAMEWORK' },
  { term: 'People Experience Framework', def: 'Kerangka yang memetakan employee journey secara end-to-end ke dalam journey dan experience Check Point, lengkap dengan metrik dan Experience Owner.', category: 'FRAMEWORK' },
  { term: 'People Experience Index (PE Index)', def: 'Skor keseluruhan People Experience yang menggabungkan seluruh metrik dengan rumus 70% Survey Results + 30% Outcomes.', category: 'FRAMEWORK' },
  { term: 'Journey', def: 'Tahapan dalam perjalanan karyawan: Arrival, Connect, Belong, Contribute, dan Depart. Setiap journey memiliki experience intent dan beberapa Experience Check Point.', category: 'FRAMEWORK' },
  { term: 'Journey Score', def: 'Skor gabungan metrik dalam satu journey, yang terdiri dari skor Survey dan skor Outcome pada journey tersebut.', category: 'FRAMEWORK' },
  { term: 'Experience Check Point', def: 'Momen kunci dalam employee journey yang pengalamannya diukur melalui metrik. PX Framework memiliki 17 Experience Check Point.', category: 'FRAMEWORK' },
  { term: 'Experience Owner', def: 'Pihak yang ditunjuk dan bertanggung jawab (accountable) atas pengalaman karyawan pada suatu Experience Check Point, termasuk menyediakan data untuk metriknya.', category: 'FRAMEWORK' },
  { term: 'Metric', def: 'Ukuran yang dipakai untuk menilai pengalaman pada setiap Experience Check Point. PX Framework menggunakan 27 metrik.', category: 'FRAMEWORK' },
  { term: 'Target', def: 'Nilai yang ingin dicapai oleh suatu metrik, misalnya > 4,00 / 5, > 85%, atau minimal 500 peserta.', category: 'FRAMEWORK' },
  { term: 'Survey Results', def: 'Hasil pengukuran yang bersumber dari survei internal dan ESS. Metrik jenis ini ditandai Type: Survey dan berbobot 70% dalam PE Index.', category: 'FRAMEWORK' },
  { term: 'Outcomes', def: 'Hasil terukur dari metrik yang sudah ada, seperti partisipasi Signature Program atau jumlah karyawan yang menerima recognition. Ditandai Type: Outcome dan berbobot 30% dalam PE Index.', category: 'FRAMEWORK' },
  { term: 'Assess Current State', def: 'Tahap ke-4 pengembangan People Experience: mengumpulkan existing score, menghitung skor metrik dan journey, lalu mengidentifikasi area yang kuat dan yang masih memiliki gap.', category: 'FRAMEWORK' },
  { term: 'Library Inisiatif & Intervensi', def: 'Kumpulan inisiatif dan intervensi yang menjadi rujukan untuk mendorong perbaikan People Experience secara berkelanjutan.', category: 'FRAMEWORK' },
  { term: 'PX Dashboard & Insight', def: 'Dashboard yang menampilkan hasil pengukuran dan insight People Experience.', category: 'FRAMEWORK' },

  // --- Tools & Sistem ---
  { term: 'Arjuna', def: 'Aplikasi Internal CIMB Niaga untuk menunjang kinerja karyawan.', category: 'TOOLS' },
  { term: 'ESS (Employee Sentiment Survey)', def: 'Survei sentimen karyawan yang mengukur feedback karyawan kepada Perusahaan melalui beberapa tema.', category: 'TOOLS' },
  { term: 'LoG+', def: 'Learning on the Go+ yang merupakan aplikasi pembelajaran CIMB Niaga.', category: 'TOOLS' },

  // --- Arrival ---
  { term: 'Arrival', def: 'Journey ke-1 dalam People Experience. Bertujuan menarik dan meng-onboard yang tepat dengan lancar, sehingga tercipta kesan pertama yang kuat dan positif.', category: 'ARRIVAL' },
  { term: 'Apply & Selection', def: 'Pengalaman kandidat saat melamar dan mengikuti seleksi, termasuk kejelasan dan ketepatan waktu undangan interview serta profesionalisme proses interview.', category: 'ARRIVAL' },
  { term: 'Employer Branding & Attraction', def: 'Daya tarik CIMB Niaga di mata calon kandidat. Diukur dari pertumbuhan follower, reach, dan engagement career website & media sosial, serta evaluasi CIMB Niaga Goes to Campus.', category: 'ARRIVAL' },
  { term: 'CIMB Niaga Goes to Campus', def: 'Event employer branding di kampus yang hasil evaluasi/rating-nya menjadi metrik pada Check Point Employer Branding & Attraction.', category: 'ARRIVAL' },

  // --- Connect ---
  { term: 'Connect', def: 'Journey ke-2 dalam People Experience. Bertujuan membangun kepercayaan dan keselarasan sejak awal melalui kejelasan peran, ekspektasi, dan koneksi dengan tim.', category: 'CONNECT' },
  { term: 'Pre-boarding', def: 'Pengalaman calon karyawan sebelum Day 1: menerima komunikasi sambutan dan informasi bergabung, dihubungi DS / Teman Baru, dan mendapat jadwal Meet & Greet.', category: 'CONNECT' },
  { term: 'Meet & Greet', def: 'Pertemuan untuk new joiner yang dijadwalkan dan dikomunikasikan sebelum Day 1, lalu dinilai kepuasannya pada Day 1 Onboarding.', category: 'CONNECT' },
  { term: 'Day 1 Onboarding', def: 'Pengalaman karyawan baru di hari pertama, meliputi Meet & Greet, kesiapan tempat kerja (laptop, user ID, email, ID card, welcome kit), sambutan Direct Supervisor, dan LoG+.', category: 'CONNECT' },
  { term: 'Onboarding Experience', def: 'Pengalaman karyawan baru selama masa onboarding (30/60/90), terutama kejelasan peran & ekspektasi serta dukungan dari Direct Supervisor dan Teman Baru.', category: 'CONNECT' },
  { term: 'Internal Transition Experience', def: 'Pengalaman karyawan saat menjalani transisi internal, meliputi kejelasan peran & ekspektasi serta dukungan dari Direct Supervisor dan buddy.', category: 'CONNECT' },
  { term: 'Direct Supervisor (DS)', def: 'Atasan langsung karyawan. Sambutan dan dukungan DS diukur mulai dari Pre-boarding, Day 1, masa onboarding, hingga transisi internal.', category: 'CONNECT' },
  { term: 'Teman Baru', def: 'Pendamping karyawan baru yang dapat menghubungi new joiner sebelum Day 1. Dukungannya diukur dalam Onboarding (30/60/90) Satisfaction Index.', category: 'CONNECT' },

  // --- Belong ---
  { term: 'Belong', def: 'Journey ke-3 dalam People Experience. Bertujuan menumbuhkan koneksi emosional, inklusi, psychological safety, dan rasa memiliki (sense of belonging) yang kuat.', category: 'BELONG' },
  { term: 'Culture & Engagement', def: 'Keterlibatan karyawan dalam budaya organisasi. Diukur dari partisipasi dan kepuasan Signature Program, serta rasa bangga terhadap CIMB dan lingkungan kerjanya.', category: 'BELONG' },
  { term: 'Signature Program', def: 'Rangkaian program pada Check Point Culture & Engagement, yaitu Perspektif, D&I, Young, dan EVD. Diukur dari tingkat partisipasi dan kepuasan peserta.', category: 'BELONG' },
  { term: 'Recognition & Appreciation', def: 'Pengalaman karyawan dalam menerima pengakuan atas pekerjaannya, baik melalui Recognition Module di Arjuna maupun dari atasan langsung.', category: 'BELONG' },
  { term: 'Psychological Safety', def: 'Rasa aman karyawan untuk menyampaikan ide atau saran meski ada perbedaan pendapat, serta untuk mengeskalasi isu di luar tanggung jawab langsungnya.', category: 'BELONG' },
  { term: 'Wellbeing', def: 'Persepsi karyawan bahwa CIMB peduli pada kesejahteraannya, dan bahwa ia dapat mengelola pekerjaan dengan work-life balance yang sehat.', category: 'BELONG' },
  { term: 'Leadership Connection', def: 'Keterhubungan karyawan dengan pemimpin, yaitu sejauh mana pemimpin membantu karyawan memahami perubahan di CIMB dan berupaya meminta masukan, ide, serta pendapat karyawan.', category: 'BELONG' },

  // --- Contribute ---
  { term: 'Contribute', def: 'Journey ke-4 dalam People Experience. Bertujuan memampukan karyawan untuk berkinerja, bertumbuh, dan menciptakan dampak yang bermakna.', category: 'CONTRIBUTE' },
  { term: 'Learning & Growth Experience', def: 'Pengalaman karyawan dalam belajar dan bertumbuh, meliputi kepuasan terhadap learning mandatory dan non-mandatory, kesempatan untuk terus belajar, serta kapabilitas dan kewenangan dalam mengambil keputusan.', category: 'CONTRIBUTE' },
  { term: 'Mentoring & Coaching', def: 'Pengalaman karyawan sebagai mentee atau coachee, yang diukur dari tingkat kepuasan mereka.', category: 'CONTRIBUTE' },
  { term: 'Performance & Career Development', def: 'Pengalaman karyawan dalam menerima feedback dari atasan langsung yang membantu meningkatkan kinerjanya.', category: 'CONTRIBUTE' },
  { term: 'Purpose & Meaningful Contribution', def: 'Perasaan karyawan bahwa pekerjaannya memberikan rasa pencapaian pribadi (personal accomplishment).', category: 'CONTRIBUTE' },

  // --- Depart ---
  { term: 'Depart', def: 'Journey ke-5 dalam People Experience. Bertujuan memastikan pengalaman keluar (exit) yang lancar, penuh hormat, dan positif.', category: 'DEPART' },
  { term: 'Resignation Experience', def: 'Pengalaman karyawan saat mengundurkan diri, yaitu kejelasan proses dan persyaratan pengunduran diri serta kemudahan dalam mengajukannya.', category: 'DEPART' },
  { term: 'Intent to Stay', def: 'Keinginan karyawan untuk tetap bertahan di CIMB, meskipun ditawari peran dan paket kompensasi yang setara di perusahaan lain.', category: 'DEPART' }
];

// Same journey palette used across Dashboard.jsx / Calculator.jsx journey cards & filter chips
// (docs/05_FRONTEND_UI_AND_COMPONENT_HIERARCHY.md §4 CIMB Brand Digital Guidelines).
const CATEGORIES = [
  { id: 'FRAMEWORK', label: 'Framework & Konsep Inti', color: '#780000', icon: Compass },
  { id: 'TOOLS', label: 'Tools & Sistem', color: '#2563EB', icon: Wrench },
  { id: 'ARRIVAL', label: 'Arrival', color: '#FF8000', icon: UserPlus },
  { id: 'CONNECT', label: 'Connect', color: '#F7901E', icon: Users },
  { id: 'BELONG', label: 'Belong', color: '#6716C4', icon: HeartHandshake },
  { id: 'CONTRIBUTE', label: 'Contribute', color: '#16C0B7', icon: TrendingUp },
  { id: 'DEPART', label: 'Depart', color: '#C1009D', icon: LogOut }
];

export default function GlossaryView() {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('ALL');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return GLOSSARY_TERMS.filter(t => {
      if (activeCategory !== 'ALL' && t.category !== activeCategory) return false;
      if (!q) return true;
      return t.term.toLowerCase().includes(q) || t.def.toLowerCase().includes(q);
    });
  }, [search, activeCategory]);

  const grouped = useMemo(() => {
    return CATEGORIES
      .map(cat => ({ ...cat, terms: filtered.filter(t => t.category === cat.id) }))
      .filter(cat => cat.terms.length > 0);
  }, [filtered]);

  return (
    <div className="space-y-5">
      {/* Top Banner */}
      <div className="bg-white rounded-2xl p-5 md:p-6 border border-gray-200 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-red-50 text-[#ED1C24] flex items-center justify-center font-bold">
              <BookMarked className="w-4 h-4" />
            </div>
            <h3 className="text-base font-extrabold text-[#231F20]">
              People Experience Glossary
            </h3>
            <span className="text-[10px] font-bold px-2 py-0.5 bg-red-100 text-[#ED1C24] rounded-full">
              {GLOSSARY_TERMS.length} Istilah
            </span>
          </div>
          <p className="text-xs text-gray-500 max-w-2xl">
            Kamus istilah resmi framework People Experience (PX) CIMB Niaga — mulai dari konsep inti PE Index hingga istilah di setiap tahapan employee journey (Arrival, Connect, Belong, Contribute, Depart).
          </p>
        </div>
      </div>

      {/* Search + Category Filter Bar */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-gray-200 shadow-2xs">
        {/* Search Box */}
        <div className="relative w-full lg:w-72 shrink-0">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Cari istilah atau definisi..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-8 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#ED1C24]"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Category Filters */}
        <div className="flex items-center space-x-1.5 overflow-x-auto py-1">
          <button
            onClick={() => setActiveCategory('ALL')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition shrink-0 ${
              activeCategory === 'ALL'
                ? 'bg-[#231F20] text-white shadow-2xs'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            Semua ({GLOSSARY_TERMS.length})
          </button>
          {CATEGORIES.map(cat => {
            const count = GLOSSARY_TERMS.filter(t => t.category === cat.id).length;
            return (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition flex items-center space-x-1.5 shrink-0 ${
                  activeCategory === cat.id ? 'text-white shadow-2xs' : 'text-gray-600 hover:bg-gray-100'
                }`}
                style={activeCategory === cat.id ? { backgroundColor: cat.color } : {}}
              >
                <span>{cat.label}</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                  activeCategory === cat.id ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-700'
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Term Groups */}
      {grouped.map(cat => {
        const Icon = cat.icon;
        return (
          <div key={cat.id} className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
            <div className="flex items-center space-x-2.5 px-5 py-3.5 border-b border-gray-100">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0"
                style={{ backgroundColor: cat.color }}
              >
                <Icon className="w-4 h-4" />
              </div>
              <h4 className="text-sm font-extrabold text-[#231F20]">{cat.label}</h4>
              <span className="text-[10px] font-bold px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full">
                {cat.terms.length} istilah
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-4">
              {cat.terms.map(t => (
                <div
                  key={t.term}
                  className="p-3.5 rounded-xl bg-gray-50 border border-gray-100 hover:border-gray-300 hover:bg-white hover:shadow-2xs transition"
                >
                  <div className="text-sm font-bold text-[#231F20] mb-1">{t.term}</div>
                  <div className="text-xs text-gray-600 leading-relaxed">{t.def}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {grouped.length === 0 && (
        <div className="bg-white rounded-2xl p-12 border border-gray-200 shadow-xs flex flex-col items-center justify-center text-center space-y-2">
          <Search className="w-8 h-8 text-gray-300" />
          <p className="text-sm font-bold text-gray-500">Tidak ada istilah yang cocok</p>
          <p className="text-xs text-gray-400">Coba kata kunci lain atau reset filter kategori.</p>
        </div>
      )}
    </div>
  );
}
