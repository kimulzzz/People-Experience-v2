// server/services/surveyImportService.js
const storage = require('../db/storage');
const { calculatePEIndex } = require('./calculationEngine');
const { getQuestionsForMetric } = require('./metricQuestionService');

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
 * Robust CSV parser handling delimiters (comma/semicolon) and quoted multiline strings.
 */
function parseCsvContent(content) {
  const lines = [];
  let currentLine = [];
  let currentField = '';
  let insideQuotes = false;

  // Normalize line breaks
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Detect delimiter from header line (comma or semicolon)
  const firstLine = normalized.split('\n')[0] || '';
  const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    const nextChar = normalized[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentField += '"';
        i++; // skip escaped quote
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === delimiter && !insideQuotes) {
      currentLine.push(currentField.trim());
      currentField = '';
    } else if (char === '\n' && !insideQuotes) {
      currentLine.push(currentField.trim());
      if (currentLine.some(f => f.length > 0)) {
        lines.push(currentLine);
      }
      currentLine = [];
      currentField = '';
    } else {
      currentField += char;
    }
  }

  // Flush remaining
  if (currentField.length > 0 || currentLine.length > 0) {
    currentLine.push(currentField.trim());
    if (currentLine.some(f => f.length > 0)) {
      lines.push(currentLine);
    }
  }

  return lines;
}

/**
 * Validates and processes survey CSV upload with support for question-level columns.
 */
function processSurveyCsv(csvText, fileName = 'survey_upload.csv', targetMetricId = null) {
  const rawLines = parseCsvContent(csvText);
  if (rawLines.length < 2) {
    throw new Error('File CSV kosong atau tidak memiliki baris data.');
  }

  const rawHeaders = rawLines[0];
  const normalizedHeaders = rawHeaders.map(h => h.toLowerCase().trim().replace(/[\s-]+/g, '_'));
  
  // Filter out instruction comments (lines where first field starts with '#')
  const dataRows = rawLines.slice(1).filter(r => r.length > 0 && !r[0].startsWith('#'));

  // Header column index mapper (Exact match first, then strict token matching)
  const getColIndex = (names) => {
    const exactIdx = normalizedHeaders.findIndex(h => names.includes(h));
    if (exactIdx !== -1) return exactIdx;
    return normalizedHeaders.findIndex(h => names.some(n => h === n || h.startsWith(`${n}_`) || h.endsWith(`_${n}`)));
  };

  const colNip = getColIndex(['nip', 'nik', 'employee_id', 'employeeid', 'participant_id', 'candidate_id', 'id_peserta', 'id_kandidat', 'id']);
  const colName = getColIndex(['employee_name', 'name', 'nama', 'participant_name', 'candidate_name', 'nama_peserta', 'nama_kandidat']);
  const colEmail = getColIndex(['cimb_email', 'email', 'mail']);
  const colDir = getColIndex(['directorate', 'direktorat', 'university', 'universitas', 'institusi', 'applied_position', 'posisi']);
  const colDiv = getColIndex(['division', 'divisi', 'unit', 'major', 'jurusan', 'program_studi', 'recruitment_channel', 'channel', 'saluran_rekrutmen']);
  const colMetric = getColIndex(['metric_id', 'metricid', 'id_metrik']);
  const colVerbatim = getColIndex(['verbatim_feedback', 'verbatim', 'feedback', 'komentar', 'saran', 'comment']);
  const colDate = getColIndex(['survey_date', 'date', 'tanggal', 'surveydate', 'tgl_survei']);
  const colSingleScore = getColIndex(['rating_score', 'rating', 'score', 'nilai', 'skor']);

  // Find all question columns (e.g. q1_..., q2_..., etc.)
  const questionColIndices = [];
  normalizedHeaders.forEach((h, idx) => {
    if (/^q[0-9]+/.test(h)) {
      questionColIndices.push({ index: idx, key: rawHeaders[idx].trim() });
    }
  });

  if (colSingleScore === -1 && questionColIndices.length === 0) {
    throw new Error('Kolom nilai rating (atau kolom pertanyaan q1, q2, ...) tidak ditemukan dalam header CSV.');
  }

  const allMetrics = storage.getMetrics();
  const surveyMetrics = allMetrics.filter(m => m.metric_type === 'SURVEY');

  const validRows = [];
  const invalidRows = [];

  dataRows.forEach((row, rowIndex) => {
    const rowNum = rowIndex + 2;
    const nip = colNip !== -1 && row[colNip] ? row[colNip].trim() : '';

    // Determine Metric ID
    let metricId = targetMetricId ? parseInt(targetMetricId) : null;
    if (!metricId && colMetric !== -1 && row[colMetric]) {
      metricId = parseInt(row[colMetric]);
    }
    if (!metricId && targetMetricId) {
      metricId = parseInt(targetMetricId);
    }
    if (!metricId && surveyMetrics.length > 0) {
      metricId = targetMetricId ? parseInt(targetMetricId) : surveyMetrics[0].metric_id;
    }

    const metricObj = surveyMetrics.find(m => m.metric_id === metricId);

    // Validation 1: Identifier mandatory
    if (!nip) {
      const idLabel = metricId === 2 ? 'ID Peserta' : (metricId === 5 ? 'ID Kandidat' : 'NIP');
      invalidRows.push({
        row_number: rowNum,
        nip: '-',
        reason: `${idLabel} wajib diisi dan tidak boleh kosong`
      });
      return;
    }

    // Validation 2: Metric must exist and be of type SURVEY
    if (!metricObj) {
      invalidRows.push({
        row_number: rowNum,
        nip,
        reason: `Metric ID ${metricId || 'N/A'} tidak valid atau bukan metrik bertipe SURVEY`
      });
      return;
    }

    const isScale5 = metricObj.scale_type === 'RATING_5';
    const activeQuestions = storage.getSurveyQuestions(metricId);
    const ratingsMap = {};
    let scorableNormalizedSum = 0;
    let scorableCount = 0;
    let scoreValidationError = null;

    if (questionColIndices.length > 0) {
      // Parse scores from question columns matching active questions
      questionColIndices.forEach(qCol => {
        const rawVal = row[qCol.index] ? row[qCol.index].trim() : '';
        let matchingQ = activeQuestions.find(q => 
          q.key.toLowerCase() === qCol.key.toLowerCase() ||
          q.key.toLowerCase() === qCol.key.toLowerCase().replace(/[\s-]+/g, '_')
        );

        // Fallback: match by question sequence number (e.g. q1_..., q2_..., etc.)
        if (!matchingQ) {
          const matchNum = qCol.key.match(/^q([0-9]+)/i);
          if (matchNum) {
            const qNum = parseInt(matchNum[1], 10);
            if (qNum >= 1 && qNum <= activeQuestions.length) {
              matchingQ = activeQuestions[qNum - 1];
            }
          }
        }

        const qType = matchingQ ? matchingQ.type : (isScale5 ? 'SCALE_1_5' : 'SCALE_1_10');

        if (qType === 'FREE_TEXT') {
          ratingsMap[qCol.key] = rawVal;
          return;
        }

        if (qType === 'YES_NO') {
          const lower = rawVal.toLowerCase();
          const parsedNum = parseFloat(rawVal);
          if (['ya', 'y', '1', '4', '5', 'true', 'yes', 'benar'].includes(lower) || (!isNaN(parsedNum) && parsedNum >= 3.5)) {
            ratingsMap[qCol.key] = 'Ya';
            scorableNormalizedSum += 100.0;
            scorableCount += 1;
          } else if (['tidak', 't', '0', 'false', 'no', 'salah'].includes(lower) || (!isNaN(parsedNum) && parsedNum < 3.5)) {
            ratingsMap[qCol.key] = 'Tidak';
            scorableNormalizedSum += 0.0;
            scorableCount += 1;
          } else if (rawVal === '' && matchingQ && !matchingQ.mandatory) {
            // Optional empty
          } else {
            scoreValidationError = `Nilai untuk pertanyaan '${qCol.key}' harus 'Ya' atau 'Tidak' (${rawVal})`;
          }
          return;
        }

        if (qType === 'SCALE_1_10') {
          const numVal = parseFloat(rawVal.replace(/,/g, '.'));
          if (isNaN(numVal)) {
            scoreValidationError = `Nilai untuk pertanyaan '${qCol.key}' tidak valid (${rawVal})`;
            return;
          }
          if (numVal < 1.0 || numVal > 10.0) {
            scoreValidationError = `Nilai pertanyaan '${qCol.key}' (${numVal}) di luar rentang 1.0 - 10.0`;
            return;
          }
          ratingsMap[qCol.key] = numVal;
          scorableNormalizedSum += (numVal / 10.0) * 100.0;
          scorableCount += 1;
          return;
        }

        // Default: SCALE_1_5
        const numVal = parseFloat(rawVal.replace(/,/g, '.'));
        if (isNaN(numVal)) {
          scoreValidationError = `Nilai untuk pertanyaan '${qCol.key}' tidak valid (${rawVal})`;
          return;
        }
        if (numVal < 1.0 || numVal > 5.0) {
          scoreValidationError = `Nilai pertanyaan '${qCol.key}' (${numVal}) di luar rentang 1.0 - 5.0`;
          return;
        }
        ratingsMap[qCol.key] = numVal;
        scorableNormalizedSum += (numVal / 5.0) * 100.0;
        scorableCount += 1;
      });

    } else if (colSingleScore !== -1) {
      // Single rating column
      const rawVal = row[colSingleScore] ? row[colSingleScore].replace(/,/g, '.').trim() : '';
      const numVal = parseFloat(rawVal);

      if (isNaN(numVal)) {
        scoreValidationError = `Nilai rating tidak valid (${rawVal})`;
      } else if (isScale5 && (numVal < 1.0 || numVal > 5.0)) {
        scoreValidationError = `Nilai rating (${numVal}) di luar rentang 1.0 - 5.0`;
      } else if (!isScale5 && (numVal < 0 || numVal > 100)) {
        scoreValidationError = `Nilai persentase (${numVal}) di luar rentang 0 - 100%`;
      } else {
        const defaultQs = activeQuestions;
        const qKey = defaultQs[0] ? defaultQs[0].key : 'q1_overall';
        ratingsMap[qKey] = numVal;
        const normalized = isScale5 ? (numVal / 5) * 100 : numVal;
        scorableNormalizedSum = normalized;
        scorableCount = 1;
      }
    }

    if (scoreValidationError || (scorableCount === 0 && questionColIndices.length === 0)) {
      invalidRows.push({
        row_number: rowNum,
        nip,
        reason: scoreValidationError || 'Tidak ada nilai pertanyaan yang valid'
      });
      return;
    }

    const normalizedAverage = scorableCount > 0 ? (scorableNormalizedSum / scorableCount) : 0;
    const calculatedAvg = isScale5 
      ? Math.round(((normalizedAverage / 100) * 5) * 100) / 100
      : Math.round(normalizedAverage * 100) / 100;

    const isMetric2 = metricId === 2;
    const isMetric5 = metricId === 5;
    const defaultName = isMetric2 ? 'Peserta Campus' : (isMetric5 ? 'Kandidat Pelamar' : 'Karyawan CIMB');
    const defaultEmail = isMetric2 ? `${nip.toLowerCase()}@campus.ac.id` : (isMetric5 ? `${nip.toLowerCase()}@candidate.mail` : `${nip}@cimbniaga.co.id`);
    const defaultDir = isMetric2 ? 'Universitas Indonesia' : (isMetric5 ? 'Digital Banking Specialist' : 'General');
    const defaultDiv = isMetric2 ? 'Teknik Informatika' : (isMetric5 ? 'LinkedIn Talent Solutions' : 'General');

    const empName = colName !== -1 && row[colName] ? row[colName].trim() : defaultName;
    const empEmail = colEmail !== -1 && row[colEmail] ? row[colEmail].trim().toLowerCase() : defaultEmail;
    const dirVal = colDir !== -1 && row[colDir] ? row[colDir].trim() : defaultDir;
    const divVal = colDiv !== -1 && row[colDiv] ? row[colDiv].trim() : defaultDiv;

    validRows.push({
      row_number: rowNum,
      metric_id: metricId,
      metric_name: metricObj.metric_name,
      nip,
      participant_id: isMetric2 ? nip : undefined,
      candidate_id: isMetric5 ? nip : undefined,
      employee_name: empName,
      participant_name: isMetric2 ? empName : undefined,
      candidate_name: isMetric5 ? empName : undefined,
      cimb_email: empEmail,
      email: empEmail,
      directorate: dirVal,
      university: isMetric2 ? dirVal : undefined,
      applied_position: isMetric5 ? dirVal : undefined,
      division: divVal,
      major: isMetric2 ? divVal : undefined,
      recruitment_channel: isMetric5 ? divVal : undefined,
      ratings: ratingsMap,
      rating_score: calculatedAvg,
      verbatim_feedback: colVerbatim !== -1 && row[colVerbatim] ? row[colVerbatim].trim() : '',
      survey_date: normalizeDateString(colDate !== -1 && row[colDate] ? row[colDate].trim() : new Date().toISOString().slice(0, 10)) || new Date().toISOString().slice(0, 10),
      source: isMetric2 ? 'CAMPUS_SURVEY' : (isMetric5 ? 'CANDIDATE_SURVEY' : 'CSV_UPLOAD')
    });
  });

  if (validRows.length === 0) {
    return {
      success: false,
      message: 'Tidak ada baris data yang valid untuk diimpor.',
      total_rows: dataRows.length,
      valid_rows_count: 0,
      invalid_rows_count: invalidRows.length,
      invalid_rows: invalidRows
    };
  }

  // Calculate batch average
  const batchScoreSum = validRows.reduce((acc, r) => acc + r.rating_score, 0);
  const batchAvgScore = parseFloat((batchScoreSum / validRows.length).toFixed(2));

  // Save to persistence
  const uploadRecord = storage.saveSurveyUploadBatch({
    metric_id: targetMetricId ? parseInt(targetMetricId) : null,
    file_name: fileName,
    total_rows: dataRows.length,
    valid_rows: validRows.length,
    invalid_rows: invalidRows.length,
    calculated_avg_score: batchAvgScore,
    uploaded_by: 'HR Admin'
  }, validRows);

  // Trigger recalculation of PE Index
  const updatedPE = calculatePEIndex('YTD');

  // Compute affected metrics summary
  const affectedMetricIds = [...new Set(validRows.map(r => r.metric_id))];
  const affectedMetrics = affectedMetricIds.map(mid => {
    const mRows = validRows.filter(r => r.metric_id === mid);
    const mAvg = mRows.reduce((acc, r) => acc + r.rating_score, 0) / mRows.length;
    const metricObj = updatedPE.metrics.find(m => m.metric_id === mid);
    return {
      metric_id: mid,
      metric_name: metricObj?.metric_name || `Metric #${mid}`,
      calculated_raw_avg: parseFloat(mAvg.toFixed(2)),
      normalized_score: metricObj?.normalized_score || 0
    };
  });

  const matchedMetric = targetMetricId ? allMetrics.find(m => m.metric_id === parseInt(targetMetricId)) : null;

  return {
    success: true,
    upload_id: uploadRecord.upload_id,
    file_name: fileName,
    target_audience: matchedMetric?.target_audience || 'INTERNAL_EMPLOYEES',
    total_rows: dataRows.length,
    valid_rows: validRows.length,
    valid_rows_count: validRows.length,
    invalid_rows: invalidRows.length,
    invalid_rows_count: invalidRows.length,
    errors: invalidRows,
    affected_metrics: affectedMetrics,
    calculated_avg_score: batchAvgScore,
    calculation: updatedPE,
    updated_pe_index: updatedPE.pe_index,
    updated_survey_index: updatedPE.survey_index,
    message: `Berhasil mengimpor ${validRows.length} respon survei. PE Index terbarui.`
  };
}

module.exports = {
  parseCsvContent,
  processSurveyCsv
};
