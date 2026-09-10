// server/services/surveyEvidenceService.js
const storage = require('../db/storage');

function normalizeDateString(dateVal) {
  if (!dateVal) return null;
  const str = String(dateVal).trim();
  if (!str || str === '-' || str === 'null' || str === 'undefined') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    const p1 = parseInt(slashMatch[1], 10);
    const p2 = parseInt(slashMatch[2], 10);
    const year = slashMatch[3];
    let month, day;
    if (p1 > 12) {
      day = String(p1).padStart(2, '0');
      month = String(p2).padStart(2, '0');
    } else {
      month = String(p1).padStart(2, '0');
      day = String(p2).padStart(2, '0');
    }
    return `${year}-${month}-${day}`;
  }
  const dashMatch = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (dashMatch) {
    const p1 = parseInt(dashMatch[1], 10);
    const p2 = parseInt(dashMatch[2], 10);
    const year = dashMatch[3];
    let month, day;
    if (p1 > 12) {
      day = String(p1).padStart(2, '0');
      month = String(p2).padStart(2, '0');
    } else if (p2 > 12) {
      month = String(p1).padStart(2, '0');
      day = String(p2).padStart(2, '0');
    } else {
      day = String(p1).padStart(2, '0');
      month = String(p2).padStart(2, '0');
    }
    return `${year}-${month}-${day}`;
  }
  try {
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) {
      const y = parsed.getFullYear();
      const m = String(parsed.getMonth() + 1).padStart(2, '0');
      const d = String(parsed.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  } catch (e) {}
  return str;
}

/**
 * Generates an Audit Evidence CSV file containing full respondent submissions,
 * question-level scores, survey dates, and verbatim feedback for a given metric and period.
 */
function generateSurveyEvidenceCsv(metric_id, period = 'YTD') {
  const metrics = storage.getMetrics();
  
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
      throw new Error(`Metric with ID ${metric_id} tidak ditemukan.`);
    }

    const questions = storage.getSurveyQuestions(targetMetric.metric_id);
    const responses = storage.getResponsesByMetricAndPeriod(targetMetric.metric_id, period);
    const isScale5 = targetMetric.scale_type === 'RATING_5';
    const mId = targetMetric.metric_id;

    let idHeader = 'NIP';
    let nameHeader = 'Nama_Karyawan';
    let emailHeader = 'Email_CIMB_Niaga';
    let dirHeader = 'Direktorat';
    let divHeader = 'Divisi';

    if (mId === 2) {
      idHeader = 'ID_Peserta';
      nameHeader = 'Nama_Peserta';
      emailHeader = 'Email_Peserta';
      dirHeader = 'Universitas_Institusi';
      divHeader = 'Jurusan_Program_Studi';
    } else if (mId === 5) {
      idHeader = 'ID_Kandidat';
      nameHeader = 'Nama_Kandidat';
      emailHeader = 'Email_Kandidat';
      dirHeader = 'Posisi_Dilamar';
      divHeader = 'Saluran_Rekrutmen';
    }

    // Headers with descriptive question headers
    const headers = [
      idHeader,
      nameHeader,
      emailHeader,
      dirHeader,
      divHeader,
      'Tanggal_Survei_Dilakukan',
      'Metric_ID',
      'Nama_Metrik',
      ...questions.map(q => `${q.key}_${q.label.replace(/\s+/g, '_')}`),
      'Rata_Rata_Skor',
      'Skala_Penilaian',
      'Komentar_Verbatim_Feedback',
      'Sumber_Data_Survei'
    ];

    const rows = [];
    rows.push(headers.join(','));

    responses.forEach(r => {
      const qScores = questions.map(q => {
        if (r.ratings && r.ratings[q.key] !== undefined) {
          return r.ratings[q.key];
        }
        return r.rating_score || (isScale5 ? 4.0 : 80);
      });

      const identifier = r.participant_id || r.candidate_id || r.nip || '-';
      const name = r.participant_name || r.candidate_name || r.employee_name || 'Responden';
      const email = r.email || r.cimb_email || '-';
      const dirVal = r.university || r.applied_position || r.directorate || 'General';
      const divVal = r.major || r.recruitment_channel || r.division || 'General';

      rows.push([
        escapeCsv(identifier),
        escapeCsv(name),
        escapeCsv(email),
        escapeCsv(dirVal),
        escapeCsv(divVal),
        escapeCsv(normalizeDateString(r.survey_date || r.created_at) || '-'),
        escapeCsv(targetMetric.metric_id),
        escapeCsv(targetMetric.metric_name),
        ...qScores.map(escapeCsv),
        escapeCsv(r.rating_score || (isScale5 ? 4.0 : 80)),
        escapeCsv(isScale5 ? 'Skala 1.0 - 5.0' : 'Skala 0 - 100%'),
        escapeCsv(r.verbatim_feedback || '-'),
        escapeCsv(r.source || 'CIMB Niaga PE Survey System')
      ].join(','));
    });

    // Return with UTF-8 BOM for Excel compatibility
    return '\uFEFF' + rows.join('\r\n');

  } else {
    // Evidence for ALL Survey Metrics
    const surveyMetrics = metrics.filter(m => m.metric_type === 'SURVEY');
    const allResponses = storage.getAllResponsesByPeriod(period);

    const headers = [
      'NIP_or_ID',
      'Nama_Responden',
      'Email_Responden',
      'Direktorat_or_Institusi',
      'Divisi_or_Jurusan_or_Saluran',
      'Tanggal_Survei_Dilakukan',
      'Metric_ID',
      'Nama_Metrik',
      'Skor_Respon',
      'Skala_Penilaian',
      'Komentar_Verbatim_Feedback',
      'Sumber_Data'
    ];

    const rows = [];
    rows.push(headers.join(','));

    allResponses.forEach(r => {
      const metricObj = surveyMetrics.find(m => m.metric_id === r.metric_id);
      const isScale5 = metricObj?.scale_type === 'RATING_5';

      const identifier = r.participant_id || r.candidate_id || r.nip || '-';
      const name = r.participant_name || r.candidate_name || r.employee_name || 'Responden';
      const email = r.email || r.cimb_email || '-';
      const dirVal = r.university || r.applied_position || r.directorate || 'General';
      const divVal = r.major || r.recruitment_channel || r.division || 'General';

      rows.push([
        escapeCsv(identifier),
        escapeCsv(name),
        escapeCsv(email),
        escapeCsv(dirVal),
        escapeCsv(divVal),
        escapeCsv(normalizeDateString(r.survey_date || r.created_at) || '-'),
        escapeCsv(r.metric_id),
        escapeCsv(metricObj?.metric_name || `Metric #${r.metric_id}`),
        escapeCsv(r.rating_score),
        escapeCsv(isScale5 ? 'Skala 1.0 - 5.0' : 'Skala 0 - 100%'),
        escapeCsv(r.verbatim_feedback || '-'),
        escapeCsv(r.source || 'CIMB Niaga PE Survey System')
      ].join(','));
    });

    return '\uFEFF' + rows.join('\r\n');
  }
}

module.exports = {
  generateSurveyEvidenceCsv
};

