// server/services/surveyEvidenceService.js
const storage = require('../db/storage');
const { rowInScopes } = require('../db/scopeUtils');
const { snapshotQuestions } = require('./metricQuestionService');
const { groupByQuestionSet, buildVersionedZip } = require('./evidenceVersions');

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
 * Generates the Audit Evidence of full respondent submissions, question-level scores, survey dates, and verbatim
 * feedback for a given metric and period.
 * v2.50.0: every response is exported with the question set stored with ITS upload (px_survey_uploads.questions_snapshot;
 * uploads from before v2.50.0 have none and use the current Manage Questions configuration). One question-set version
 * -> { kind: 'csv', content } (the CSV of before); several -> { kind: 'zip', buffer, fileName } with one CSV per
 * version + README.txt. The all-metrics export has no per-question columns and is always one CSV.
 * v2.56.0: options.tablesOnly (one metric) -> { kind: 'tables', versions: [{ headers, rows (raw values), sortKeys, identity }] },
 * the same rows the CSV holds (History tab of the metric detail).
 */
async function generateSurveyEvidence(metric_id, period = 'YTD', options = {}) {
  const metrics = await storage.getMetrics();
  
  // CSV injection guard: a text cell starting with = + - @ (or tab/CR) would run as a formula when the file is
  // opened in Excel, so it gets a leading apostrophe. Plain numbers (e.g. a negative score) are left untouched.
  const escapeCsv = (val) => {
    if (val === null || val === undefined) return '';
    let str = val.toString();
    if (typeof val === 'string' && str !== '-' && /^[=+\-@\t\r]/.test(str) && !/^[+-]?\d+([.,]\d+)?$/.test(str)) str = `'${str}`;
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  if (metric_id && metric_id !== 'ALL') {
    const targetMetric = metrics.find(m => m.metric_id === parseInt(metric_id));
    if (!targetMetric) {
      throw new Error(`Metric with ID ${metric_id} not found.`);
    }

    const questions = await storage.getSurveyQuestions(targetMetric.metric_id);
    let responses = await storage.getResponsesByMetricAndPeriod(targetMetric.metric_id, period);
    // A PIC's file only holds respondents of the PIC's own data scope (options.scopes, null = everybody).
    if (options.scopes) responses = responses.filter(r => rowInScopes(options.scopes, r.directorate || r.university || r.applied_position || '', r.division || r.major || r.recruitment_channel || ''));
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

    const uploads = new Map((await storage.getSurveyUploads()).map(u => [u.upload_id, u]));
    const versions = groupByQuestionSet(responses, r => {
      const u = uploads.get(r.upload_id);
      const snap = u && u.questions_snapshot ? (u.questions_snapshot[mId] || u.questions_snapshot[String(mId)]) : null;
      return Array.isArray(snap)
        ? { questions: snap, source: 'SNAPSHOT', uploaded_at: u.uploaded_at }
        : { questions: snapshotQuestions(questions), source: 'CURRENT_CONFIG', uploaded_at: (u && u.uploaded_at) || r.created_at };
    });

    // v2.56.0: the TABLE first (raw values) - the CSV below and the History tab of the metric detail are both built from it
    const tableOf = (questions, responses) => {
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
        ...questions.map(q => `${q.key}_${String(q.label || '').replace(/\s+/g, '_')}`),
        'Rata_Rata_Skor',
        'Skala_Penilaian',
        'Komentar_Verbatim_Feedback',
        'Sumber_Data_Survei'
      ];

      const rows = responses.map(r => {
        const qScores = questions.map(q => {
          if (r.ratings && r.ratings[q.key] !== undefined) {
            return r.ratings[q.key];
          }
          return r.rating_score || (isScale5 ? 4.0 : 80);
        });

        const identifier = r.participant_id || r.candidate_id || r.nip || '-';
        const name = r.participant_name || r.candidate_name || r.employee_name || 'Respondent';
        const email = r.email || r.cimb_email || '-';
        const dirVal = r.university || r.applied_position || r.directorate || 'General';
        const divVal = r.major || r.recruitment_channel || r.division || 'General';

        return [
          identifier,
          name,
          email,
          dirVal,
          divVal,
          normalizeDateString(r.survey_date || r.created_at) || '-',
          targetMetric.metric_id,
          targetMetric.metric_name,
          ...qScores,
          r.rating_score || (isScale5 ? 4.0 : 80),
          isScale5 ? 'Skala 1.0 - 5.0' : 'Skala 0 - 100%',
          r.verbatim_feedback || '-',
          r.source || 'CIMB Niaga PE Survey System'
        ];
      });
      const sortKeys = responses.map(r => String(normalizeDateString(r.survey_date || r.created_at) || ''));
      return { headers, rows, sortKeys, identity: [idHeader, nameHeader, emailHeader] };
    };
    // Return with UTF-8 BOM for Excel compatibility (the header line is not escaped, as before)
    const csvOf = t => '\uFEFF' + [t.headers.join(','), ...t.rows.map(r => r.map(escapeCsv).join(','))].join('\r\n');

    const tables = versions.length
      ? versions.map(v => ({ ...v, ...tableOf(v.questions, v.items) }))
      : [{ questions, items: [], ...tableOf(questions, []) }];
    if (options.tablesOnly) return { kind: 'tables', versions: tables };
    if (tables.length <= 1) return { kind: 'csv', content: csvOf(tables[0]) };
    const zip = await buildVersionedZip({
      baseName: `Evidence_Survey_Metric_${mId}_${period}`,
      title: `Survey evidence - metric ${mId} ${targetMetric.metric_name}, period ${period}`,
      versions: tables.map(v => ({ ...v, csv: csvOf(v) }))
    });
    return { kind: 'zip', ...zip };

  } else {
    // Evidence for ALL Survey Metrics
    const surveyMetrics = metrics.filter(m => m.metric_type === 'SURVEY');
    const allResponses = await storage.getAllResponsesByPeriod(period);

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
      const name = r.participant_name || r.candidate_name || r.employee_name || 'Respondent';
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

    return { kind: 'csv', content: '\uFEFF' + rows.join('\r\n') };
  }
}

module.exports = {
  generateSurveyEvidence
};

