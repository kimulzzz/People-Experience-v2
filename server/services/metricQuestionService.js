// server/services/metricQuestionService.js

/**
 * Question Types supported by CIMB Niaga PX Measurement Engine:
 * 1. SCALE_1_5: Rating 1.0 to 5.0 (normalized to 20% - 100%)
 * 2. SCALE_1_10: Rating 1.0 to 10.0 (normalized to 10% - 100%)
 * 3. YES_NO: Binary response (Ya = 100%, Tidak = 0%)
 * 4. FREE_TEXT: Qualitative verbatim feedback (non-scorable, excluded from numeric index average)
 */
const QUESTION_TYPES = {
  SCALE_1_5: 'SCALE_1_5',
  SCALE_1_10: 'SCALE_1_10',
  YES_NO: 'YES_NO',
  FREE_TEXT: 'FREE_TEXT'
};

const QUESTION_TYPE_LABELS = {
  SCALE_1_5: 'Skala 1 - 5 (Rating 1.0 s/d 5.0)',
  SCALE_1_10: 'Skala 1 - 10 (Rating 1.0 s/d 10.0)',
  YES_NO: 'Jawaban Ya / Tidak (Skor 100 / 0)',
  FREE_TEXT: 'Jawaban Free Text (Kualitatif / Komentar)'
};

/**
 * Default structured question templates for all 20 survey metrics in CIMB Niaga PX Framework.
 * For ESS metrics, questions and dimensions are aligned with official Employee Sentiment Survey items.
 */
const DEFAULT_METRIC_QUESTIONS = {
  // METRIC 2: CIMB Niaga Goes to Campus — event evaluation / rating
  2: [
    { key: 'q1_relevance', label: 'Relevansi Materi', text: 'Relevansi topik dan materi acara Goes to Campus terhadap dunia kerja perbankan', type: 'SCALE_1_5', mandatory: true },
    { key: 'q2_speaker', label: 'Kualitas Pembicara', text: 'Kualitas, keterbukaan, dan kompetensi narasumber CIMB Niaga', type: 'SCALE_1_5', mandatory: true },
    { key: 'q3_interest', label: 'Minat Berkarier', text: 'Ketertarikan untuk bergabung dan berkarier di CIMB Niaga setelah mengikuti event', type: 'SCALE_1_5', mandatory: true },
    { key: 'q4_organization', label: 'Penyelenggaraan Acara', text: 'Kepuasan terhadap fasilitas, waktu, dan interaktivitas penyelenggaraan acara', type: 'SCALE_1_5', mandatory: true },
    { key: 'q5_recommendation', label: 'Rekomendasi Event', text: 'Apakah Anda akan merekomendasikan program Goes to Campus ini kepada rekan/mahasiswa lain?', type: 'YES_NO', mandatory: false }
  ],

  // METRIC 5: Candidate Experience Survey Score
  5: [
    { key: 'q1_invitation', label: 'Kejelasan Undangan', text: 'Kejelasan dan ketepatan waktu undangan proses seleksi (minimal H-2 sebelum wawancara)', type: 'SCALE_1_5', mandatory: true },
    { key: 'q2_professionalism', label: 'Profesionalisme Interview', text: 'Profesionalisme, kesiapan, dan keramahan interviewer selama proses wawancara', type: 'SCALE_1_5', mandatory: true },
    { key: 'q3_role_info', label: 'Informasi Pekerjaan', text: 'Kejelasan informasi mengenai peran, ekspektasi posisi, dan budaya kerja CIMB Niaga', type: 'SCALE_1_5', mandatory: true },
    { key: 'q4_hr_communication', label: 'Responsivitas Tim TA', text: 'Tim Talent Acquisition memberikan respon dan update status seleksi secara tepat waktu', type: 'YES_NO', mandatory: false },
    { key: 'q5_candidate_notes', label: 'Catatan Pengalaman Kandidat', text: 'Saran atau masukan Anda terkait proses seleksi kandidat di CIMB Niaga', type: 'FREE_TEXT', mandatory: false }
  ],

  // METRIC 6: Pre-boarding Engagement Index
  6: [
    { key: 'q1_welcome_info', label: 'Informasi Sambutan', text: 'Informasi sambutan dan panduan persiapan kerja yang diterima sebelum Day 1', type: 'SCALE_1_5', mandatory: true },
    { key: 'q2_supervisor_contact', label: 'Kontak Atasan / Buddy', text: 'Inisiatif komunikasi dari Direct Supervisor / Teman Baru sebelum hari pertama kerja', type: 'YES_NO', mandatory: true },
    { key: 'q3_meet_greet_schedule', label: 'Jadwal Meet & Greet', text: 'Kejelasan jadwal dan instruksi orientasi Meet & Greet sebelum Day 1', type: 'YES_NO', mandatory: true }
  ],

  // METRIC 7: Day 1 Onboarding Satisfaction Index (Exact 15 Questions)
  7: [
    { 
      key: 'q1_recruitment_process', 
      label: 'Kepuasan Proses Rekrutmen', 
      text: 'Saya puas dengan proses rekrutmen saya secara keseluruhan, mulai dari komunikasi dengan Recruiter sampai dengan penandatanganan perjanjian kerja', 
      type: 'SCALE_1_5', 
      mandatory: true 
    },
    { 
      key: 'q2_interview_biz_unit', 
      label: 'Pengalaman Wawancara Unit Bisnis', 
      text: 'Saya puas dengan pengalaman wawancara saya dengan Unit Bisnis.', 
      type: 'SCALE_1_5', 
      mandatory: true 
    },
    { 
      key: 'q3_day1_overall_exp', 
      label: 'Pengalaman Hari Pertama Keseluruhan', 
      text: 'Saya puas dengan pengalaman hari pertama saya bekerja secara keseluruhan.', 
      type: 'SCALE_1_5', 
      mandatory: true 
    },
    { 
      key: 'q4_welcome_kit_interest', 
      label: 'Ketertarikan Welcome Kit', 
      text: 'Saya tertarik terhadap informasi, konten, dan item di dalam Welcome Kit CIMBian Starter Pack.', 
      type: 'SCALE_1_5', 
      mandatory: true 
    },
    { 
      key: 'q5_meet_greet_satisfaction', 
      label: 'Kepuasan Sesi Meet & Greet', 
      text: 'Saya merasa puas dengan pengalaman saya selama mengikuti sesi Meet & Greet di CIMB Niaga', 
      type: 'SCALE_1_5', 
      mandatory: true 
    },
    { 
      key: 'q6_welcoming_email', 
      label: 'Penerimaan Welcoming Email', 
      text: 'Saya menerima Welcoming Email melalui email pribadi sebelum tanggal bergabung.', 
      type: 'YES_NO', 
      mandatory: true 
    },
    { 
      key: 'q7_contacted_by_ds_buddy', 
      label: 'Kontak Pra-Day 1 oleh Atasan/Buddy', 
      text: 'Saya dihubungi oleh atasan langsung atau buddy saya (melalui telepon, WhatsApp, atau email) sebelum hari pertama bekerja.', 
      type: 'YES_NO', 
      mandatory: true 
    },
    { 
      key: 'q8_welcomed_by_ds', 
      label: 'Penyambutan oleh Atasan Langsung', 
      text: 'Saya disambut oleh atasan langsung saya pada hari pertama bekerja di CIMB Niaga.', 
      type: 'YES_NO', 
      mandatory: true 
    },
    { 
      key: 'q9_welcomed_by_buddy', 
      label: 'Penyambutan oleh Buddy', 
      text: 'Saya disambut oleh buddy saya pada hari pertama bekerja di CIMB Niaga.', 
      type: 'YES_NO', 
      mandatory: true 
    },
    { 
      key: 'q10_welcome_kit_goodie_bag', 
      label: 'Penerimaan Welcome Kit Goodie Bag', 
      text: 'Saya menerima Welcome Kit CIMBian Starter Pack (Goodie Bag) pada hari pertama bekerja.', 
      type: 'YES_NO', 
      mandatory: true 
    },
    { 
      key: 'q11_id_card_received', 
      label: 'Penerimaan ID Card', 
      text: 'Saya menerima ID Card bersamaan dengan Welcome Kit CIMBian Starter Pack.', 
      type: 'YES_NO', 
      mandatory: true 
    },
    { 
      key: 'q12_laptop_received', 
      label: 'Penerimaan PC / Laptop Kerja', 
      text: 'Saya menerima PC/Laptop sebagai perlengkapan kerja pada hari pertama bekerja.', 
      type: 'YES_NO', 
      mandatory: true 
    },
    { 
      key: 'q13_sms_credentials', 
      label: 'SMS Kredensial User ID & Password', 
      text: 'Saya menerima sms notifikasi perihal User ID dan password login PC/Laptop sebelum hari pertama bekerja.', 
      type: 'YES_NO', 
      mandatory: true 
    },
    { 
      key: 'q14_system_activation_support', 
      label: 'Pendampingan Aktivasi Akses Sistem', 
      text: 'Saya didampingi oleh atasan langsung/buddy selama proses aktivasi LAN/VPN/Email atau akses ke sistem lain yang dibutuhkan pada hari pertama bekerja.', 
      type: 'YES_NO', 
      mandatory: true 
    },
    { 
      key: 'q15_system_access_ready', 
      label: 'Kelancaran Akses Sistem Hari Pertama', 
      text: 'Saya sudah dapat menggunakan User ID, LAN/VPN/Email, dan akses sistem lainnya pada hari pertama bekerja.', 
      type: 'YES_NO', 
      mandatory: true 
    }
  ],

  // METRIC 8: Onboarding 30/60/90 Satisfaction Index
  8: [
    { key: 'q1_role_clarity', label: 'Kejelasan Peran & Target', text: 'Kejelasan peran, deskripsi tugas, dan target kinerja utama (Role Clarity & Expectation)', type: 'SCALE_1_5', mandatory: true },
    { key: 'q2_supervisor_support', label: 'Bimbingan Atasan Langsung', text: 'Dukungan, bimbingan berkala, dan arahan teknis dari Direct Supervisor', type: 'SCALE_1_5', mandatory: true },
    { key: 'q3_buddy_support', label: 'Dukungan Teman Baru / Buddy', text: 'Bantuan, keramahan, dan inisiatif Teman Baru (Buddy) dalam membantu adaptasi harian', type: 'SCALE_1_5', mandatory: true },
    { key: 'q4_resource_access', label: 'Kecukupan Sumber Daya & Modul', text: 'Kecukupan modul pelatihan, alat kerja, dan dukungan tim dalam menyelesaikan tugas', type: 'SCALE_1_5', mandatory: true },
    { key: 'q5_checkin_conducted', label: 'Pelaksanaan Review 30/60/90', text: 'Apakah sesi check-in formal 30/60/90 hari telah dilakukan bersama atasan langsung Anda?', type: 'YES_NO', mandatory: true }
  ],

  // METRIC 9: Role Clarity & DS Support Score Index (ESS)
  9: [
    { 
      key: 'q1_role_expectation', 
      label: 'Understanding Expectations', 
      text: 'Employees clearly understand what is expected of them.', 
      type: 'SCALE_1_10', 
      mandatory: true,
      dimension: 'Employee Commitment',
      visible_based_on: 'Always',
      required_based_on: 'Always',
      percent_favorable: 90,
      percent_neutral: 9,
      percent_unfavorable: 1
    },
    { 
      key: 'q2_role_contribution', 
      label: 'Purposeful Role Contribution', 
      text: 'I understand how my current job role contributes to a positive impact on customers and society.', 
      type: 'SCALE_1_10', 
      mandatory: true,
      dimension: 'Employee Commitment',
      visible_based_on: 'Always',
      required_based_on: 'Always',
      percent_favorable: 96,
      percent_neutral: 3,
      percent_unfavorable: 1
    },
    { 
      key: 'q3_manager_support', 
      label: 'Manager Support & Enablement', 
      text: 'My immediate manager provides me with the support I need to complete my work.', 
      type: 'SCALE_1_10', 
      mandatory: true,
      dimension: 'Employee Commitment',
      visible_based_on: 'Always',
      required_based_on: 'Always',
      percent_favorable: 91,
      percent_neutral: 8,
      percent_unfavorable: 1
    }
  ],

  // METRIC 10: Internal Mobility / Role Transition Experience Score
  10: [
    { key: 'q1_transition_clarity', label: 'Kejelasan Alur Transisi', text: 'Kejelasan proses transisi, serah terima wewenang, dan ekspektasi pada peran baru', type: 'SCALE_1_5', mandatory: true },
    { key: 'q2_new_manager_support', label: 'Bimbingan Atasan Unit Baru', text: 'Dukungan orientasi dan bimbingan dari Atasan Langsung di unit kerja baru', type: 'SCALE_1_5', mandatory: true },
    { key: 'q3_team_adaptation', label: 'Adaptasi Rekan Kerja Baru', text: 'Keterbukaan dan kerjasama rekan kerja tim baru dalam mendukung kelancaran adaptasi', type: 'SCALE_1_5', mandatory: true },
    { key: 'q4_handover_complete', label: 'Kelengkapan Serah Terima Wewenang', text: 'Apakah seluruh dokumen serah terima (handover) telah selesai ditandatangani sebelum bertugas?', type: 'YES_NO', mandatory: false }
  ],

  // METRIC 12: Signature Program event satisfaction score
  12: [
    { key: 'q1_topic_relevance', label: 'Relevansi Materi', text: 'Relevansi materi dan wawasan program signature terhadap peningkatan performa & karir', type: 'SCALE_1_5', mandatory: true },
    { key: 'q2_speaker_delivery', label: 'Penyampaian Pembicara', text: 'Kualitas, kejelasan penyampaian, dan daya tarik narasumber/pembicara', type: 'SCALE_1_5', mandatory: true },
    { key: 'q3_event_technical', label: 'Fasilitas & Penyelenggaraan', text: 'Kelancaran fasilitas teknis acara (audio-visual, platform streaming, interaktivitas Q&A)', type: 'SCALE_1_5', mandatory: true },
    { key: 'q4_overall_satisfaction', label: 'Kepuasan Menyeluruh', text: 'Secara keseluruhan, saya puas mengikuti Signature Program CIMB Niaga ini', type: 'SCALE_1_5', mandatory: true },
    { key: 'q5_verbatim_impression', label: 'Kesan & Masukan Event', text: 'Tuliskan kesan, topik favorit, atau usulan perbaikan untuk program signature berikutnya', type: 'FREE_TEXT', mandatory: false }
  ],

  // METRIC 13: Pride & Work Environment Index (ESS)
  13: [
    { 
      key: 'q1_company_pride', 
      label: 'Pride to Work in CIMB', 
      text: 'I am proud to work at CIMB.', 
      type: 'SCALE_1_10', 
      mandatory: true,
      dimension: 'Pride & Work Environment',
      visible_based_on: 'Always',
      required_based_on: 'Always',
      percent_favorable: 96,
      percent_neutral: 3,
      percent_unfavorable: 1
    },
    { 
      key: 'q2_work_culture', 
      label: 'Culture & Workplace Attraction', 
      text: 'People want to work here because of the culture and work environment.', 
      type: 'SCALE_1_10', 
      mandatory: true,
      dimension: 'Pride & Work Environment',
      visible_based_on: 'Always',
      required_based_on: 'Always',
      percent_favorable: 86,
      percent_neutral: 12,
      percent_unfavorable: 2
    },
    { 
      key: 'q3_implement_better_ways', 
      label: 'Implement Better Ways of Doing Things', 
      text: 'CIMB consistently implements new and better ways of doing things.', 
      type: 'SCALE_1_10', 
      mandatory: true,
      dimension: 'Pride & Work Environment',
      visible_based_on: 'Always',
      required_based_on: 'Always',
      percent_favorable: 91,
      percent_neutral: 8,
      percent_unfavorable: 1
    },
    { 
      key: 'q4_stay_competitive', 
      label: 'Adapts to Stay Competitive', 
      text: 'CIMB changes and adapts to stay competitive.', 
      type: 'SCALE_1_10', 
      mandatory: true,
      dimension: 'Pride & Work Environment',
      visible_based_on: 'Always',
      required_based_on: 'Always',
      percent_favorable: 92,
      percent_neutral: 7,
      percent_unfavorable: 1
    }
  ],

  // METRIC 15: Manager Recognition Index (ESS)
  15: [
    { 
      key: 'q1_recognition_appreciation', 
      label: 'Manager Recognition & Appreciation', 
      text: 'My immediate manager recognizes me when I do a good job.', 
      type: 'SCALE_1_5', 
      mandatory: true,
      dimension: 'Recognition & Appreciation',
      visible_based_on: 'Always',
      required_based_on: 'Always',
      percent_favorable: 88,
      percent_neutral: 10,
      percent_unfavorable: 2
    },
    { 
      key: 'q2_accountability', 
      label: 'Accountability for Results', 
      text: 'Employees are held accountable for the results they are expected to deliver.', 
      type: 'SCALE_1_5', 
      mandatory: true,
      dimension: 'Recognition & Appreciation',
      visible_based_on: 'Always',
      required_based_on: 'Always',
      percent_favorable: 91,
      percent_neutral: 9,
      percent_unfavorable: 0
    },
    { 
      key: 'q3_valued_contributions', 
      label: 'Valued Contributions & Dedication', 
      text: 'My personal contributions and dedication are recognized and valued by leadership.', 
      type: 'SCALE_1_5', 
      mandatory: true,
      dimension: 'Recognition & Appreciation',
      visible_based_on: 'Always',
      required_based_on: 'Always',
      percent_favorable: 89,
      percent_neutral: 9,
      percent_unfavorable: 2
    }
  ],

  // METRIC 16: Wellbeing Index (ESS)
  16: [
    { 
      key: 'q1_wellbeing_care', 
      label: 'Company Cares for Wellbeing', 
      text: 'CIMB cares about my well-being.', 
      type: 'SCALE_1_5', 
      mandatory: true,
      dimension: 'Employee Wellbeing',
      visible_based_on: 'Always',
      required_based_on: 'Always',
      percent_favorable: 86,
      percent_neutral: 11,
      percent_unfavorable: 3
    },
    { 
      key: 'q2_work_life_balance', 
      label: 'Healthy Work-Life Balance', 
      text: 'I can manage my job responsibilities in a way that enables healthy work-life balance.', 
      type: 'SCALE_1_5', 
      mandatory: true,
      dimension: 'Employee Wellbeing',
      visible_based_on: 'Always',
      required_based_on: 'Always',
      percent_favorable: 87,
      percent_neutral: 10,
      percent_unfavorable: 3
    },
    { 
      key: 'q3_wellness_support', 
      label: 'Holistic Wellness Support', 
      text: 'The bank provides sufficient support, wellness resources, and flexibility to manage workplace stress.', 
      type: 'SCALE_1_5', 
      mandatory: true,
      dimension: 'Employee Wellbeing',
      visible_based_on: 'Always',
      required_based_on: 'Always',
      percent_favorable: 88,
      percent_neutral: 9,
      percent_unfavorable: 3
    }
  ],

  // METRIC 17: Psychological Safety Index (ESS)
  17: [
    { 
      key: 'q1_speak_up_ideas', 
      label: 'Speaking Up with Ideas & Suggestions', 
      text: 'At work, I can speak up with ideas or suggestions, even if others have different opinions.', 
      type: 'SCALE_1_5', 
      mandatory: true,
      dimension: 'Psychological Safety & Risk Mindset',
      visible_based_on: 'Always',
      required_based_on: 'Always',
      percent_favorable: 90,
      percent_neutral: 8,
      percent_unfavorable: 2
    },
    { 
      key: 'q2_escalate_outside_resp', 
      label: 'Escalate Issues Outside Direct Resp', 
      text: 'Colleagues escalate issues even when these are outside their direct responsibilities.', 
      type: 'SCALE_1_5', 
      mandatory: true,
      dimension: 'Psychological Safety & Risk Mindset',
      visible_based_on: 'Always',
      required_based_on: 'Always',
      percent_favorable: 91,
      percent_neutral: 7,
      percent_unfavorable: 2
    },
    { 
      key: 'q3_escalate_root_cause', 
      label: 'Escalating Ensures Root Cause Addressed', 
      text: 'Escalating an issue helps ensure it is investigated and the root cause is addressed.', 
      type: 'SCALE_1_5', 
      mandatory: true,
      dimension: 'Psychological Safety & Risk Mindset',
      visible_based_on: 'Always',
      required_based_on: 'Always',
      percent_favorable: 98,
      percent_neutral: 1,
      percent_unfavorable: 1
    },
    { 
      key: 'q4_know_when_to_escalate', 
      label: 'Know When Issue is Serious', 
      text: 'I know when an issue is serious enough to require me escalating it.', 
      type: 'SCALE_1_5', 
      mandatory: true,
      dimension: 'Psychological Safety & Risk Mindset',
      visible_based_on: 'Always',
      required_based_on: 'Always',
      percent_favorable: 99,
      percent_neutral: 1,
      percent_unfavorable: 0
    }
  ],

  // METRIC 18: Leadership Connection Score (ESS)
  18: [
    { 
      key: 'q1_handle_changes_effective', 
      label: 'Equipped to Handle Changes', 
      text: 'In CIMB, we are well equipped to handle changes effectively.', 
      type: 'SCALE_1_5', 
      mandatory: true,
      dimension: 'Agility & Decision Making',
      visible_based_on: 'Always',
      required_based_on: 'Always',
      percent_favorable: 88,
      percent_neutral: 11,
      percent_unfavorable: 1
    },
    { 
      key: 'q2_decisions_without_delay', 
      label: 'Decisions Made Without Undue Delay', 
      text: 'In CIMB, decisions get made without undue delay.', 
      type: 'SCALE_1_5', 
      mandatory: true,
      dimension: 'Agility & Decision Making',
      visible_based_on: 'Always',
      required_based_on: 'Always',
      percent_favorable: 81,
      percent_neutral: 16,
      percent_unfavorable: 3
    },
    { 
      key: 'q3_adapts_to_external_env', 
      label: 'Adapts to External Environment', 
      text: 'CIMB effectively adapts to changes in its external environment.', 
      type: 'SCALE_1_5', 
      mandatory: true,
      dimension: 'Agility & Decision Making',
      visible_based_on: 'Always',
      required_based_on: 'Always',
      percent_favorable: 90,
      percent_neutral: 9,
      percent_unfavorable: 1
    },
    { 
      key: 'q4_implements_better_ways', 
      label: 'Implements Better Ways of Doing Things', 
      text: 'CIMB consistently implements new and better ways of doing things.', 
      type: 'SCALE_1_5', 
      mandatory: true,
      dimension: 'Agility & Decision Making',
      visible_based_on: 'Always',
      required_based_on: 'Always',
      percent_favorable: 91,
      percent_neutral: 8,
      percent_unfavorable: 1
    },
    { 
      key: 'q5_adapts_to_stay_competitive', 
      label: 'Changes & Adapts to Stay Competitive', 
      text: 'CIMB changes and adapts to stay competitive.', 
      type: 'SCALE_1_5', 
      mandatory: true,
      dimension: 'Agility & Decision Making',
      visible_based_on: 'Always',
      required_based_on: 'Always',
      percent_favorable: 92,
      percent_neutral: 7,
      percent_unfavorable: 1
    },
    { 
      key: 'q6_leaders_navigate_change', 
      label: 'Leaders Help Navigate Changes', 
      text: 'Leaders help us understand and navigate changes happening in CIMB.', 
      type: 'SCALE_1_5', 
      mandatory: true,
      dimension: 'Agility & Decision Making',
      visible_based_on: 'Always',
      required_based_on: 'Always',
      percent_favorable: 89,
      percent_neutral: 9,
      percent_unfavorable: 2
    }
  ],

  // METRIC 19: Learning Effectiveness & Relevance Score
  19: [
    { key: 'q1_training_relevance', label: 'Relevansi Modul Pelatihan', text: 'Materi pelatihan yang disediakan relevan dengan kebutuhan peningkatan kompetensi kerja saya', type: 'SCALE_1_5', mandatory: true },
    { key: 'q2_log_plus_ease', label: 'Kemudahan Akses LoG+', text: 'Platform digital learning LoG+ mudah diakses, interaktif, dan menyediakan materi mutakhir', type: 'SCALE_1_5', mandatory: true },
    { key: 'q3_skills_application', label: 'Aplikasi Keterampilan Nyata', text: 'Saya dapat langsung menerapkan ilmu yang dipelajari pada aktivitas pekerjaan sehari-hari', type: 'SCALE_1_5', mandatory: true }
  ],

  // METRIC 20: Growth & Development Index (LoG+)
  20: [
    { key: 'q1_course_relevance', label: 'Relevansi Kursus Pilihan', text: 'Materi kursus elektif memperluas wawasan dan kapabilitas profesional saya', type: 'SCALE_1_5', mandatory: true },
    { key: 'q2_instructor_quality', label: 'Kualitas Fasilitator', text: 'Keahlian dan daya interaksi instruktur memfasilitasi pemahaman mendalam', type: 'SCALE_1_5', mandatory: true }
  ],

  // METRIC 21: Career Growth & Learning Index (ESS)
  21: [
    { 
      key: 'q1_continual_learn_grow', 
      label: 'Opportunity to Continually Learn & Grow', 
      text: 'I have the opportunity to continually learn and grow.', 
      type: 'SCALE_1_5', 
      mandatory: true,
      dimension: 'Career Growth & Learning',
      visible_based_on: 'Always',
      required_based_on: 'Always',
      percent_favorable: 89,
      percent_neutral: 10,
      percent_unfavorable: 1
    },
    { 
      key: 'q2_right_skills_strategy', 
      label: 'Employees Have Right Skills for Strategy', 
      text: 'CIMB has employees with the right skills to deliver its strategy.', 
      type: 'SCALE_1_5', 
      mandatory: true,
      dimension: 'Career Growth & Learning',
      visible_based_on: 'Always',
      required_based_on: 'Always',
      percent_favorable: 89,
      percent_neutral: 10,
      percent_unfavorable: 1
    },
    { 
      key: 'q3_capability_knowledge_goals', 
      label: 'Capability & Knowledge to Achieve Goals', 
      text: 'CIMB has the capability and knowledge to achieve its goals.', 
      type: 'SCALE_1_5', 
      mandatory: true,
      dimension: 'Career Growth & Learning',
      visible_based_on: 'Always',
      required_based_on: 'Always',
      percent_favorable: 94,
      percent_neutral: 5,
      percent_unfavorable: 1
    }
  ],

  // METRIC 22: Capability & Enablement Index (ESS)
  22: [
    { 
      key: 'q1_authority_to_decide', 
      label: 'Sufficient Authority to Make Decisions', 
      text: 'Employees have sufficient authority to make decisions.', 
      type: 'SCALE_1_5', 
      mandatory: true,
      dimension: 'Capability & Enablement',
      visible_based_on: 'Always',
      required_based_on: 'Always',
      percent_favorable: 84,
      percent_neutral: 14,
      percent_unfavorable: 2
    },
    { 
      key: 'q2_understand_expectations', 
      label: 'Clearly Understand What is Expected', 
      text: 'Employees clearly understand what is expected of them.', 
      type: 'SCALE_1_5', 
      mandatory: true,
      dimension: 'Capability & Enablement',
      visible_based_on: 'Always',
      required_based_on: 'Always',
      percent_favorable: 90,
      percent_neutral: 9,
      percent_unfavorable: 1
    },
    { 
      key: 'q3_enablement_resources', 
      label: 'Tools & Enablement Resources', 
      text: 'Employees have the tools, resources, and enablement to perform their duties effectively.', 
      type: 'SCALE_1_5', 
      mandatory: true,
      dimension: 'Capability & Enablement',
      visible_based_on: 'Always',
      required_based_on: 'Always',
      percent_favorable: 89,
      percent_neutral: 9,
      percent_unfavorable: 2
    }
  ],

  // METRIC 23: Mentoring / Coaching Program Satisfaction Score
  23: [
    { key: 'q1_coach_impact', label: 'Efektivitas Bimbingan Mentor', text: 'Efektivitas bimbingan, arahan strategis, dan transfer knowledge dari Mentor/Coach', type: 'SCALE_1_5', mandatory: true },
    { key: 'q2_confidence_boost', label: 'Peningkatan Kepercayaan Diri', text: 'Dampak nyata sesi mentoring dalam meningkatkan performa kerja dan kepercayaan diri', type: 'SCALE_1_5', mandatory: true },
    { key: 'q3_mentor_routine', label: 'Keteraturan Sesi Mentoring', text: 'Apakah sesi bimbingan mentoring berlangsung rutin minimal 1 kali setiap bulan?', type: 'YES_NO', mandatory: true }
  ],

  // METRIC 24: Performance Feedback Quality Index (ESS)
  24: [
    { 
      key: 'q1_manager_performance_feedback', 
      label: 'Manager Feedback Improves Performance', 
      text: 'My immediate manager gives me feedback that helps me improve my performance.', 
      type: 'SCALE_1_5', 
      mandatory: true,
      dimension: 'Performance Feedback & Development',
      visible_based_on: 'Always',
      required_based_on: 'Always',
      percent_favorable: 91,
      percent_neutral: 8,
      percent_unfavorable: 1
    },
    { 
      key: 'q2_accountability_results', 
      label: 'Accountability for Results', 
      text: 'Employees are held accountable for the results they are expected to deliver.', 
      type: 'SCALE_1_5', 
      mandatory: true,
      dimension: 'Performance Feedback & Development',
      visible_based_on: 'Always',
      required_based_on: 'Always',
      percent_favorable: 91,
      percent_neutral: 9,
      percent_unfavorable: 0
    },
    { 
      key: 'q3_performance_dialogue', 
      label: 'Open Performance & Growth Conversations', 
      text: 'My direct supervisor conducts regular, open performance conversations focused on continuous development.', 
      type: 'SCALE_1_5', 
      mandatory: true,
      dimension: 'Performance Feedback & Development',
      visible_based_on: 'Always',
      required_based_on: 'Always',
      percent_favorable: 89,
      percent_neutral: 9,
      percent_unfavorable: 2
    }
  ],

  // METRIC 25: Meaningful Contribution Index (ESS)
  25: [
    { 
      key: 'q1_personal_accomplishment', 
      label: 'Feeling of Personal Accomplishment', 
      text: 'My work gives me a feeling of personal accomplishment.', 
      type: 'SCALE_1_5', 
      mandatory: true,
      dimension: 'Purpose & Meaningful Contribution',
      visible_based_on: 'Always',
      required_based_on: 'Always',
      percent_favorable: 90,
      percent_neutral: 8,
      percent_unfavorable: 2
    },
    { 
      key: 'q2_contribution_impact', 
      label: 'Impact on Bank Purpose & Strategy', 
      text: 'I understand how my work contributes to the success and purpose of CIMB.', 
      type: 'SCALE_1_5', 
      mandatory: true,
      dimension: 'Purpose & Meaningful Contribution',
      visible_based_on: 'Always',
      required_based_on: 'Always',
      percent_favorable: 94,
      percent_neutral: 5,
      percent_unfavorable: 1
    },
    { 
      key: 'q3_energized_by_work', 
      label: 'Energized by Work Responsibilities', 
      text: 'I feel motivated and energized by the meaningful work I do.', 
      type: 'SCALE_1_5', 
      mandatory: true,
      dimension: 'Purpose & Meaningful Contribution',
      visible_based_on: 'Always',
      required_based_on: 'Always',
      percent_favorable: 88,
      percent_neutral: 10,
      percent_unfavorable: 2
    }
  ],

  // METRIC 26: Exit Interview Experience Score
  26: [
    { key: 'q1_exit_clarity', label: 'Kejelasan Alur Exit', text: 'Saya memahami dengan jelas alur, persyaratan, dan hak saat proses pengunduran diri', type: 'SCALE_1_5', mandatory: true },
    { key: 'q2_handover_ease', label: 'Kemudahan Clearance', text: 'Proses serah terima tugas (handover) dan exit clearance berjalan mudah dan transparan', type: 'SCALE_1_5', mandatory: true },
    { key: 'q3_hr_support', label: 'Dukungan & Keramahan Tim HR', text: 'Komunikasi, keramahan, dan responsivitas tim HR selama proses offboarding memuaskan', type: 'SCALE_1_5', mandatory: true },
    { key: 'q4_exit_reason_sharing', label: 'Catatan Alasan Pengunduran Diri', text: 'Berikan masukan atau faktor utama yang melatarbelakangi keputusan karir Anda', type: 'FREE_TEXT', mandatory: false }
  ],

  // METRIC 27: Intent to Stay Index (ESS)
  27: [
    { 
      key: 'q1_stay_commitment', 
      label: 'Choose to Stay at CIMB', 
      text: 'Even if offered a comparable role and compensation package at another company, I would choose to stay at CIMB.', 
      type: 'SCALE_1_10', 
      mandatory: true,
      dimension: 'Employee Commitment',
      visible_based_on: 'Always',
      required_based_on: 'Always',
      percent_favorable: 77,
      percent_neutral: 18,
      percent_unfavorable: 5
    },
    { 
      key: 'q2_promising_future', 
      label: 'Promising Long-Term Future', 
      text: 'I see a promising long-term future and career growth for myself at CIMB.', 
      type: 'SCALE_1_10', 
      mandatory: true,
      dimension: 'Employee Commitment',
      visible_based_on: 'Always',
      required_based_on: 'Always',
      percent_favorable: 79,
      percent_neutral: 16,
      percent_unfavorable: 5
    },
    { 
      key: 'q3_recommend_company', 
      label: 'Recommend CIMB as Great Employer', 
      text: 'I would recommend CIMB as a great place to work to prospective candidates.', 
      type: 'SCALE_1_10', 
      mandatory: true,
      dimension: 'Employee Commitment',
      visible_based_on: 'Always',
      required_based_on: 'Always',
      percent_favorable: 84,
      percent_neutral: 12,
      percent_unfavorable: 4
    }
  ]
};

/**
 * Returns active survey questions for a specific metric ID.
 * Merges with any persisted custom questions if available.
 */
function getQuestionsForMetric(metricId, customQuestionsMap = null) {
  const id = parseInt(metricId);
  if (customQuestionsMap && customQuestionsMap[id] && Array.isArray(customQuestionsMap[id]) && customQuestionsMap[id].length > 0) {
    return customQuestionsMap[id];
  }
  return DEFAULT_METRIC_QUESTIONS[id] || [
    { key: 'q1_overall', label: 'Nilai Keseluruhan', text: 'Evaluasi parameter metrik secara menyeluruh', type: 'SCALE_1_5', mandatory: true }
  ];
}

function getAllDefaultSurveyQuestions() {
  return DEFAULT_METRIC_QUESTIONS;
}

module.exports = {
  QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  DEFAULT_METRIC_QUESTIONS,
  getQuestionsForMetric,
  getAllDefaultSurveyQuestions
};
