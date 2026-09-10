// server/services/surveyTemplateService.js
const storage = require('../db/storage');

/**
 * Generates CSV template string for a specific survey metric with question-level columns
 * or a Master all-surveys template.
 */
function generateSurveyCsvTemplate(metric_id = 'ALL') {
  const metrics = storage.getMetrics().filter(m => m.metric_type === 'SURVEY');
  
  const escapeCsv = (val) => {
    if (val === null || val === undefined) return '';
    const str = val.toString();
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  if (metric_id && metric_id !== 'ALL') {
    const targetMetric = metrics.find(m => m.metric_id === parseInt(metric_id));
    if (!targetMetric) {
      throw new Error(`Survey metric with ID ${metric_id} tidak ditemukan.`);
    }

    const questions = storage.getSurveyQuestions(targetMetric.metric_id);
    const mId = targetMetric.metric_id;

    let headers = [];
    let instructions = [];
    let samples = [];

    if (mId === 2) {
      // Metric 2: Campus Students
      headers = [
        'participant_id',
        'participant_name',
        'email',
        'university',
        'major',
        'survey_date',
        ...questions.map(q => q.key),
        'verbatim_feedback'
      ];

      instructions = [
        '# MANDATORY (ID Peserta)',
        'Nama Peserta / Mahasiswa',
        'Email Peserta',
        'Universitas / Institusi',
        'Jurusan / Program Studi',
        'YYYY-MM-DD',
        ...questions.map(q => {
          const type = q.type || 'SCALE_1_5';
          if (type === 'YES_NO') return `[${q.label}: Ya / Tidak]`;
          if (type === 'SCALE_1_10') return `[${q.label}: Skala 1.0-10.0]`;
          if (type === 'FREE_TEXT') return `[${q.label}: Free Text / Komentar]`;
          return `[${q.label}: Skala 1.0-5.0]`;
        }),
        'Komentar / Saran Verbatim'
      ];

      samples = [
        {
          id: 'PESERTA-2026-001',
          name: 'Aditya Pratama',
          email: 'aditya.pratama@ui.ac.id',
          dim1: 'Universitas Indonesia',
          dim2: 'Teknik Informatika',
          date: '2026-03-15',
          verbatim: 'Sesi Goes to Campus sangat informatif dan memberi gambaran karir digital banking modern di CIMB Niaga.'
        },
        {
          id: 'PESERTA-2026-002',
          name: 'Nadia Salsabila',
          email: 'nadia.salsabila@itb.ac.id',
          dim1: 'Institut Teknologi Bandung',
          dim2: 'Manajemen Bisnis',
          date: '2026-03-16',
          verbatim: 'Materi pembicara sangat inspiratif dan sesi interaktif tanya jawab berjalan seru.'
        },
        {
          id: 'PESERTA-2026-003',
          name: 'Rizky Ramadhan',
          email: 'rizky.r@ugm.ac.id',
          dim1: 'Universitas Gadjah Mada',
          dim2: 'Sistem Informasi',
          date: '2026-03-17',
          verbatim: 'Sangat tertarik untuk mendaftar The Complete Banker program setelah ikut acara ini.'
        }
      ];
    } else if (mId === 5) {
      // Metric 5: Job Applicants / Candidates
      headers = [
        'candidate_id',
        'candidate_name',
        'email',
        'applied_position',
        'recruitment_channel',
        'survey_date',
        ...questions.map(q => q.key),
        'verbatim_feedback'
      ];

      instructions = [
        '# MANDATORY (ID Kandidat)',
        'Nama Lengkap Kandidat',
        'Email Kandidat',
        'Posisi yang Dilamar',
        'Saluran Rekrutmen (e.g. LinkedIn, Career Site, Campus Fair)',
        'YYYY-MM-DD',
        ...questions.map(q => {
          const type = q.type || 'SCALE_1_5';
          if (type === 'YES_NO') return `[${q.label}: Ya / Tidak]`;
          if (type === 'SCALE_1_10') return `[${q.label}: Skala 1.0-10.0]`;
          if (type === 'FREE_TEXT') return `[${q.label}: Free Text / Komentar]`;
          return `[${q.label}: Skala 1.0-5.0]`;
        }),
        'Komentar / Saran Verbatim'
      ];

      samples = [
        {
          id: 'CAND-2026-101',
          name: 'Jessica Stephanie',
          email: 'jessica.stephanie@gmail.com',
          dim1: 'Digital Banking Specialist',
          dim2: 'LinkedIn Talent Solutions',
          date: '2026-03-15',
          verbatim: 'Proses rekrutmen sangat profesional, undangan wawancara terjadwal rapi dan interviewer ramah.'
        },
        {
          id: 'CAND-2026-102',
          name: 'Kevin Wijaya',
          email: 'kevin.wijaya@yahoo.com',
          dim1: 'Fullstack Engineer',
          dim2: 'CIMB Career Website',
          date: '2026-03-16',
          verbatim: 'Instruksi tes teknis sangat jelas dan tim HR recruiter selalu update progres.'
        },
        {
          id: 'CAND-2026-103',
          name: 'Tasya Kamila',
          email: 'tasya.kamila@outlook.com',
          dim1: 'Credit Risk Analyst',
          dim2: 'Campus Hiring Fair',
          date: '2026-03-17',
          verbatim: 'Pengalaman wawancara sangat positif dan transparan mengenai jenjang karir.'
        }
      ];
    } else {
      // Default Employee Metrics
      headers = [
        'nip',
        'employee_name',
        'cimb_email',
        'directorate',
        'division',
        'survey_date',
        ...questions.map(q => q.key),
        'verbatim_feedback'
      ];

      instructions = [
        '# MANDATORY',
        'Nama Karyawan',
        'Email CIMB Niaga',
        'Direktorat',
        'Divisi',
        'YYYY-MM-DD',
        ...questions.map(q => {
          const type = q.type || 'SCALE_1_5';
          if (type === 'YES_NO') return `[${q.label}: Ya / Tidak]`;
          if (type === 'SCALE_1_10') return `[${q.label}: Skala 1.0-10.0]`;
          if (type === 'FREE_TEXT') return `[${q.label}: Free Text / Komentar]`;
          return `[${q.label}: Skala 1.0-5.0]`;
        }),
        'Komentar / Saran Verbatim'
      ];

      samples = [
        {
          id: '8801245',
          name: 'Dimas Setiawan',
          email: 'dimas.setiawan@cimbniaga.co.id',
          dim1: 'Information Technology',
          dim2: 'Application Development',
          date: '2026-03-15',
          verbatim: 'Proses dan panduan sangat terstruktur, dukungan rekan kerja dan atasan luar biasa.'
        },
        {
          id: '8802390',
          name: 'Siti Rahmawati',
          email: 'siti.rahmawati@cimbniaga.co.id',
          dim1: 'Consumer Banking',
          dim2: 'Branch Service Excellence',
          date: '2026-03-16',
          verbatim: 'Materi pembekalan komprehensif, fasilitas kerja sudah siap tepat waktu.'
        },
        {
          id: '8803112',
          name: 'Rian Pratama',
          email: 'rian.pratama@cimbniaga.co.id',
          dim1: 'Human Resources',
          dim2: 'People Experience & Culture',
          date: '2026-03-17',
          verbatim: 'Komunikasi transparan dan interaksi dengan mentor memberikan kejelasan tujuan.'
        }
      ];
    }

    const rows = [];
    rows.push(headers.join(','));
    rows.push(instructions.map(escapeCsv).join(','));

    // Generate sample answer according to question type
    const getSampleVal = (q, sampleIndex) => {
      const type = q.type || 'SCALE_1_5';
      if (type === 'YES_NO') {
        return sampleIndex % 2 === 0 ? 'Ya' : 'Ya';
      }
      if (type === 'SCALE_1_10') {
        const vals = [9.5, 9.0, 8.5];
        return vals[sampleIndex % vals.length];
      }
      if (type === 'FREE_TEXT') {
        const vals = [
          'Proses orientasi berjalan sangat baik dan jelas.',
          'Penyambutan dari tim dan rekan kerja sangat ramah.',
          'Fasilitas kerja dan pembekalan materi sangat komprehensif.'
        ];
        return vals[sampleIndex % vals.length];
      }
      // Default SCALE_1_5
      const vals = [5.0, 4.8, 4.5];
      return vals[sampleIndex % vals.length];
    };

    samples.forEach((s, sIdx) => {
      const rowScores = questions.map(q => getSampleVal(q, sIdx));
      rows.push([
        escapeCsv(s.id),
        escapeCsv(s.name),
        escapeCsv(s.email),
        escapeCsv(s.dim1),
        escapeCsv(s.dim2),
        escapeCsv(s.date),
        ...rowScores.map(escapeCsv),
        escapeCsv(s.verbatim)
      ].join(','));
    });

    return rows.join('\r\n');
  } else {
    // Master Template covering all survey metrics
    const headers = [
      'nip',
      'employee_name',
      'cimb_email',
      'directorate',
      'division',
      'metric_id',
      'metric_name',
      'rating_score',
      'verbatim_feedback',
      'survey_date'
    ];

    const rows = [];
    rows.push(headers.join(','));

    metrics.forEach((m, idx) => {
      const isNonEmployee = m.is_employee_metric === false;
      const sampleId = m.metric_id === 2 ? `PESERTA-2026-${100 + idx}` : (m.metric_id === 5 ? `CAND-2026-${100 + idx}` : `880${1000 + idx}`);
      const sampleName = m.metric_id === 2 ? `Mahasiswa UI ${idx + 1}` : (m.metric_id === 5 ? `Kandidat Pelamar ${idx + 1}` : `Karyawan CIMB ${idx + 1}`);
      const sampleEmail = m.metric_id === 2 ? `mahasiswa.${idx + 1}@ui.ac.id` : (m.metric_id === 5 ? `kandidat.${idx + 1}@gmail.com` : `karyawan.${idx + 1}@cimbniaga.co.id`);
      const sampleDir = m.metric_id === 2 ? 'Universitas Indonesia' : (m.metric_id === 5 ? 'Digital Banking Specialist' : 'Human Resources');
      const sampleDiv = m.metric_id === 2 ? 'Teknik Informatika' : (m.metric_id === 5 ? 'LinkedIn Talent Solutions' : 'People Experience & Culture');
      const sampleScore = m.scale_type === 'RATING_5' ? '4.75' : '88';
      const sampleVerbatim = `Respon evaluasi survei untuk metrik ${m.metric_name}`;

      rows.push([
        escapeCsv(sampleId),
        escapeCsv(sampleName),
        escapeCsv(sampleEmail),
        escapeCsv(sampleDir),
        escapeCsv(sampleDiv),
        escapeCsv(m.metric_id),
        escapeCsv(m.metric_name),
        escapeCsv(sampleScore),
        escapeCsv(sampleVerbatim),
        escapeCsv('2026-03-15')
      ].join(','));
    });

    return rows.join('\r\n');
  }
}

module.exports = {
  generateSurveyCsvTemplate
};

