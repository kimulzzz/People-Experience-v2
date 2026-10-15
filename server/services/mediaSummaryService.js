// server/services/mediaSummaryService.js
// AI Summary of an uploaded Signature Program event VIDEO, made from its transcript by the local Gemma model
// (Ollama). Product rule: this is the ONLY thing the model is used for, and it runs only
//   - right after the transcript of a NEWLY uploaded video is DONE (transcribeService), and
//   - when an event manager presses "Buat ulang ringkasan" (POST /api/media/:id/summarize).
// It never runs on a page load, when an event is opened, at boot for old videos, for photos, PPT or a timer.
//
// A 4B model likes to invent details, so nothing it writes is trusted blindly:
//   * the summary is written in the language of the transcript (id -> Indonesian, en -> English ...);
//   * numbers, capitalised names and (id/en) content words in the answer must be traceable to the transcript;
//   * a rejected answer is retried ONCE with the offending words named; if that fails too, a deterministic
//     extractive summary (sentences taken from the transcript, nothing invented) is stored instead and
//     labelled summary_source = 'RULE' ('Otomatis (aturan)') versus 'AI';
//   * a transcript that is empty/too short is not sent to the model at all (summary_status = 'INSUFFICIENT');
//   * a long transcript is summarised part by part, then combined.
// Jobs run one at a time on the shared AI queue; Ollama being off never blocks the upload or the transcript.
const storage = require('../db/storage');
const aiQueue = require('./aiQueue');
const { queryLocalOllama, DEFAULT_LLM_MODEL } = require('./localAiService');

const MIN_WORDS = 20;            // fewer words than this: "transcript not sufficient", the model is not called
const CHUNK_CHARS = 5000;        // safe for a 4096-token context together with the instructions
const MAX_CHUNKS = 12;           // longer than this (about 60,000 characters): rule-based summary instead
const MAX_POINTS = 5;
const MIN_POINTS = 2;

// Whisper language code -> the language the summary is written in. Unknown codes fall back to Indonesian.
const LANGUAGES = {
  id: 'Bahasa Indonesia', en: 'English', ms: 'Bahasa Melayu', jv: 'Basa Jawa', su: 'Basa Sunda', zh: 'Chinese', ja: 'Japanese',
  ko: 'Korean', ar: 'Arabic', nl: 'Dutch', fr: 'French', de: 'German', es: 'Spanish', pt: 'Portuguese', th: 'Thai', vi: 'Vietnamese', hi: 'Hindi'
};

function summaryLanguageFor(transcriptLanguage) {
  const code = String(transcriptLanguage || '').toLowerCase().split(/[-_]/)[0];
  return LANGUAGES[code] ? code : 'id';
}

const wordCount = text => (String(text || '').match(/\S+/g) || []).length;
const isTranscriptSufficient = text => wordCount(text) >= MIN_WORDS;

// ------------------------------------------------------------------ prompts
function buildPrompt(text, lang, feedback) {
  if (lang === 'id') {
    return `Ringkas transkrip berikut dalam Bahasa Indonesia (ikuti bahasa transkrip).

Format jawaban PERSIS seperti ini, tanpa teks lain:
RINGKASAN: <2 sampai 4 kalimat>
POIN:
- <poin 1>
- <poin 2>
- <poin 3>
(3 sampai 5 poin; setiap poin satu kalimat pendek)

Aturan keras:
- Pakai kata-kata dan istilah yang sama dengan transkrip sedekat mungkin. Jangan memakai kata, istilah, atau gagasan baru yang tidak diucapkan.
- Dilarang menambah angka, nama, tanggal, tempat, jabatan, penyebab, atau kesimpulan sendiri.
- Jangan menulis kata "transkrip" atau "video"; jangan membuka dengan "Pembicara menceritakan".
- Tulis dari sudut pandang orang ketiga ("ia") bila isinya cerita pribadi.${feedback ? `\n\nPERBAIKAN: jawaban Anda sebelumnya ditolak karena ${feedback}. Tulis ulang, patuhi aturan di atas, dan JANGAN memakai kata/angka yang disebut itu.` : ''}

Transkrip:
"""
${text}
"""`;
  }
  return `Summarize the transcript below in ${LANGUAGES[lang]} (the language of the transcript).

Answer in EXACTLY this format, no other text:
SUMMARY: <2 to 4 sentences>
POINTS:
- <point 1>
- <point 2>
- <point 3>
(3 to 5 points; each point one short sentence)

Hard rules:
- Use the same words and terms as the transcript as closely as possible. Do not introduce words, terms or ideas that were not said.
- Never add numbers, names, dates, places, job titles, causes or conclusions of your own.
- Do not use the words "transcript" or "video"; do not open with "The speaker describes".
- Write in the third person when the content is a personal story.${feedback ? `\n\nFIX: your previous answer was rejected because ${feedback}. Rewrite it, follow the rules above and do NOT use the words/numbers mentioned.` : ''}

Transcript:
"""
${text}
"""`;
}

function buildPartPrompt(text, lang, index, total) {
  return lang === 'id'
    ? `Ini bagian ${index} dari ${total} sebuah transkrip panjang. Ringkas bagian ini dalam 2 sampai 3 kalimat Bahasa Indonesia. Pakai kata-kata yang sama dengan transkrip; dilarang menambah angka, nama, tanggal, atau kesimpulan yang tidak diucapkan. Tulis hanya ringkasannya.\n\nTranskrip:\n"""\n${text}\n"""`
    : `This is part ${index} of ${total} of a long transcript. Summarize this part in 2 to 3 sentences in ${LANGUAGES[lang]}. Use the same words as the transcript; never add numbers, names, dates or conclusions that were not said. Write only the summary.\n\nTranscript:\n"""\n${text}\n"""`;
}

function buildCombinePrompt(parts, lang, feedback) {
  const joined = parts.map((s, i) => `${i + 1}. ${s}`).join('\n');
  const base = buildPrompt(joined, lang, feedback);
  return lang === 'id'
    ? base.replace('Ringkas transkrip berikut', 'Berikut ringkasan per bagian dari satu transkrip panjang, berurutan. Gabungkan').replace('Transkrip:', 'Ringkasan per bagian:')
    : base.replace('Summarize the transcript below', 'Below are, in order, the part summaries of one long transcript. Combine them').replace('Transcript:', 'Part summaries:');
}

// Splits a long transcript at sentence ends (or spaces) into parts of at most CHUNK_CHARS.
function splitTranscript(text) {
  const parts = [];
  let rest = String(text || '').trim();
  while (rest.length > CHUNK_CHARS) {
    const window = rest.slice(0, CHUNK_CHARS);
    let cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '));
    if (cut < CHUNK_CHARS / 2) cut = window.lastIndexOf(' ');
    if (cut < CHUNK_CHARS / 2) cut = CHUNK_CHARS - 1;
    parts.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

// ------------------------------------------------------------------ parsing the model's answer
const POINT_LINE_RE = /^\s*(?:[-*•]|\d+[.)])\s+(.+?)\s*$/;

function cleanLine(text) {
  return String(text || '').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim().replace(/^["“”]+|["“”]+$/g, '');
}

// "RINGKASAN: ... POIN: - ... - ..." (or SUMMARY / POINTS) -> { summary, points } or null when unusable.
function parseModelAnswer(text) {
  const raw = String(text || '').replace(/\r/g, '');
  const head = raw.match(/(ringkasan|summary)\s*:\s*/i);
  const tail = raw.match(/\n\s*(poin(?:\s+utama)?|points?|key points)\s*:\s*/i);
  if (!head || !tail || tail.index < head.index) return null;
  const summary = cleanLine(raw.slice(head.index + head[0].length, tail.index));
  const points = raw.slice(tail.index + tail[0].length).split('\n')
    .map(line => POINT_LINE_RE.exec(line)).filter(Boolean).map(m => cleanLine(m[1])).filter(p => p.length >= 8)
    .slice(0, MAX_POINTS);
  if (!summary || points.length < MIN_POINTS) return null;
  return { summary, points };
}

// ------------------------------------------------------------------ validator (nothing outside the transcript)
const META_RE = /^\s*["“]?(transkrip|video|rekaman|ringkasan|berikut|ini adalah|the (transcript|video|recording)|this (transcript|video|recording)|summary|here is)\b|\b(transkrip|video|rekaman)\s+(ini|tersebut|itu)\b|\bthe (transcript|video|recording)\b/i;
const NEUTRAL = {
  id: new Set(['tersebut', 'kemudian', 'akhirnya', 'awalnya', 'bahwa', 'dengan', 'sebuah', 'seseorang', 'menceritakan', 'membahas', 'menjelaskan', 'menyampaikan',
    'pembicara', 'berbicara', 'tentang', 'mengenai', 'dalam', 'hidupnya', 'sehingga', 'namun', 'serta', 'setelah', 'sebelum', 'ketika', 'dapat', 'akan', 'mulai',
    'juga', 'yang', 'dari', 'untuk', 'pada', 'karena', 'agar', 'oleh', 'antara', 'terhadap', 'melalui', 'selama', 'sampai', 'orang', 'tidak', 'sebagai', 'adalah',
    'sebelumnya', 'sangat', 'terutama', 'sebenarnya', 'sesungguhnya', 'sedikit', 'banyak', 'sering', 'selalu', 'hanya', 'masih', 'sudah', 'telah']),
  en: new Set(['speaker', 'about', 'which', 'their', 'there', 'where', 'while', 'after', 'before', 'being', 'because', 'through', 'during', 'between', 'describes',
    'explains', 'discusses', 'mentions', 'person', 'also', 'these', 'those', 'other', 'would', 'could', 'should'])
};
// Words that are only function words in each language, used to detect a summary written in the wrong language.
const LANG_MARKERS = {
  id: new Set(['yang', 'dan', 'di', 'ke', 'dari', 'untuk', 'dengan', 'ini', 'itu', 'tidak', 'pada', 'adalah', 'akan', 'ia', 'dalam', 'agar', 'karena']),
  en: new Set(['the', 'and', 'of', 'to', 'in', 'is', 'that', 'for', 'with', 'on', 'it', 'as', 'was', 'are', 'he', 'she', 'they'])
};

// Crude stems so "menyadari" ~ "sadar", "merugikan" ~ "kerugian", "learned" ~ "learn".
// Returns every plausible stem (Indonesian prefixes change the first letter: meny+adari -> sadar, men+ulis -> tulis).
function stems(word, lang) {
  const w = word.toLowerCase();
  if (lang === 'en') return new Set([w.replace(/(ing|ed|es|ly|s)$/, ''), w]);
  const bases = new Set([w]);
  const m = /^(meny|meng|mem|men|me|peny|peng|pem|pen|pe|ber|ter|di|ke|se)(.{4,})$/.exec(w);
  if (m) {
    bases.add(m[2]);
    const swap = { meny: 's', peny: 's', meng: 'k', peng: 'k', mem: 'p', pem: 'p', men: 't', pen: 't' }[m[1]];
    if (swap) bases.add(swap + m[2]);
  }
  const out = new Set();
  bases.forEach(b => { out.add(b); out.add(b.replace(/(kan|an|i|nya|lah|kah)$/, '')); });
  return out;
}

const wordsOf = text => String(text || '').toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);

// Content words (5+ letters) of `output` that cannot be traced to the transcript (exact or by stem).
function novelWords(output, transcript, lang) {
  if (lang !== 'id' && lang !== 'en') return { total: 0, novel: [] };
  const neutral = NEUTRAL[lang];
  const source = String(transcript || '').toLowerCase();
  const sourceStems = new Set();
  wordsOf(transcript).forEach(w => stems(w, lang).forEach(s => { if (s.length >= 3) sourceStems.add(s); }));
  // Hyphenated words (reduplications such as "sia-sia" / "menyia-nyiakan") are skipped: they cannot be stemmed reliably.
  const words = String(output || '').toLowerCase().split(/[^\p{L}-]+/u).map(w => w.replace(/^-+|-+$/g, '')).filter(w => w.length >= 5 && !w.includes('-') && !neutral.has(w));
  const novel = words.filter(w => {
    if (source.includes(w)) return false;
    return ![...stems(w, lang)].some(s => s.length >= 3 && sourceStems.has(s));
  });
  return { total: words.length, novel: [...new Set(novel)] };
}

const normNumber = token => token.replace(/[.,]+$/, '').replace(/[.,]/g, '');

// Numbers written as WORDS are facts too ("enam bulan" -> "sepuluh bulan" is an invented number), so they are checked
// like digits: every number word of the summary must also occur in the transcript, as the same word or as the equal digit.
const CARDINALS = {
  0: ['nol', 'kosong', 'zero'], 1: ['satu', 'one'], 2: ['dua', 'two', 'berdua'], 3: ['tiga', 'three', 'bertiga'], 4: ['empat', 'four', 'berempat'],
  5: ['lima', 'five'], 6: ['enam', 'six'], 7: ['tujuh', 'seven'], 8: ['delapan', 'eight'], 9: ['sembilan', 'nine'], 10: ['sepuluh', 'ten'],
  11: ['sebelas', 'eleven'], 12: ['twelve', 'dozen'], 13: ['thirteen'], 14: ['fourteen'], 15: ['fifteen'], 16: ['sixteen'], 17: ['seventeen'],
  18: ['eighteen'], 19: ['nineteen'], 20: ['twenty'], 30: ['thirty'], 40: ['forty'], 50: ['fifty'], 60: ['sixty'], 70: ['seventy'], 80: ['eighty'], 90: ['ninety'],
  100: ['seratus'], 1000: ['seribu'], 1000000: ['sejuta'], 0.5: ['setengah', 'separuh', 'half'], 0.25: ['seperempat', 'quarter']
};
const ORDINALS = {
  1: ['pertama', 'first'], 2: ['kedua', 'second'], 3: ['ketiga', 'third'], 4: ['keempat', 'fourth'], 5: ['kelima', 'fifth'], 6: ['keenam', 'sixth'],
  7: ['ketujuh', 'seventh'], 8: ['kedelapan', 'eighth'], 9: ['kesembilan', 'ninth'], 10: ['kesepuluh', 'tenth']
};
// Scale words and "N kali"-style multipliers: they must be present in the transcript when the summary uses them.
const SCALES = { puluh: 'puluh', belas: 'belas', ratus: 'ratus', ribu: 'ribu', juta: 'juta', miliar: 'miliar', hundred: 'ratus', thousand: 'ribu', million: 'juta', billion: 'miliar', teen: 'belas' };
const MULTIPLIERS = { sekali: 'n:1', once: 'n:1', twice: 'n:2', thrice: 'n:3' };
// Frequencies ("seminggu", "weekly"): checked in the summary; the plain unit nouns in the transcript count as support.
const UNIT_KEYS = { seminggu: 'u:week', weekly: 'u:week', sebulan: 'u:month', monthly: 'u:month', setahun: 'u:year', yearly: 'u:year', annually: 'u:year', sehari: 'u:day', daily: 'u:day' };
const UNIT_NOUNS = { minggu: 'u:week', mingguan: 'u:week', week: 'u:week', weeks: 'u:week', bulan: 'u:month', bulanan: 'u:month', month: 'u:month', months: 'u:month',
  tahun: 'u:year', tahunan: 'u:year', year: 'u:year', years: 'u:year', hari: 'u:day', harian: 'u:day', day: 'u:day', days: 'u:day' };
const NUMBER_WORD_KEY = {};
Object.entries(CARDINALS).forEach(([v, ws]) => ws.forEach(w => { NUMBER_WORD_KEY[w] = `n:${v}`; }));
Object.entries(ORDINALS).forEach(([v, ws]) => ws.forEach(w => { NUMBER_WORD_KEY[w] = `o:${v}`; }));
Object.entries(SCALES).forEach(([w, k]) => { NUMBER_WORD_KEY[w] = `s:${k}`; });
Object.entries(MULTIPLIERS).forEach(([w, k]) => { NUMBER_WORD_KEY[w] = k; });
Object.entries(UNIT_KEYS).forEach(([w, k]) => { NUMBER_WORD_KEY[w] = k; });

const numberKeyOfDigits = token => { const n = normNumber(token); return `n:${/^\d+$/.test(n) ? String(parseInt(n, 10)) : n}`; };
const keyOfWord = w => NUMBER_WORD_KEY[w] || NUMBER_WORD_KEY[w.replace(/an$/, '')] && /^(puluh|ratus|ribu|juta)an$/.test(w) && NUMBER_WORD_KEY[w.replace(/an$/, '')] || null;

// Every number (digits or words) in `text` as { key, label }.
function numberMentions(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/\d[\d.,]*|[\p{L}]+/gu)) {
    const tok = m[0].toLowerCase();
    if (/^\d/.test(tok)) out.push({ key: numberKeyOfDigits(tok), label: normNumber(tok) });
    else { const k = keyOfWord(tok); if (k) out.push({ key: k, label: tok }); }
  }
  return out;
}

// Keys the transcript supports (its own numbers + plain unit nouns).
function supportedNumberKeys(transcript) {
  const keys = new Set(numberMentions(transcript).map(x => x.key));
  for (const m of String(transcript || '').toLowerCase().matchAll(/[\p{L}]+/gu)) if (UNIT_NOUNS[m[0]]) keys.add(UNIT_NOUNS[m[0]]);
  return keys;
}

// null = the answer is acceptable, otherwise the reason (it is fed back into the retry prompt).
function validateAnswer(answer, transcript, lang) {
  const text = [answer.summary, ...answer.points].join('\n');
  if (answer.summary.length < 40) return 'ringkasan terlalu pendek';
  if (META_RE.test(answer.summary) || answer.points.some(p => META_RE.test(p))) return 'membuka/memakai frasa meta seperti "transkrip ini ..." atau "video ini ..."';

  const supported = supportedNumberKeys(transcript);
  const badNumbers = [...new Set(numberMentions(text).filter(x => !supported.has(x.key)).map(x => x.label))];
  if (badNumbers.length) return `memuat angka/bilangan yang tidak ada di transkrip: ${badNumbers.join(', ')}`;

  // Capitalised words (names, places, acronyms) that are not at the start of a sentence/point.
  const lowerTranscript = String(transcript).toLowerCase();
  const names = new Set();
  for (const sentence of text.split(/[\n]|(?<=[.!?])\s+/)) {
    const tokens = sentence.match(/[\p{L}\d'-]+/gu) || [];
    tokens.slice(1).forEach(t => { if (/^\p{Lu}/u.test(t) && t.length > 1 && !lowerTranscript.includes(t.toLowerCase())) names.add(t); });
  }
  if (names.size) return `memuat nama/istilah yang tidak ada di transkrip: ${[...names].slice(0, 6).join(', ')}`;

  const markers = LANG_MARKERS[lang];
  if (markers) {
    const toks = wordsOf(text);
    const own = toks.filter(w => markers.has(w)).length;
    const otherLang = lang === 'id' ? 'en' : 'id';
    const other = toks.filter(w => LANG_MARKERS[otherLang].has(w)).length;
    if (other > own && other >= 3) return `ditulis dalam bahasa yang salah (harus ${LANGUAGES[lang]})`;
  }

  const { total, novel } = novelWords(text, transcript, lang);
  if (novel.length >= 3 && novel.length / Math.max(total, 1) > 0.2) return `memuat kata yang tidak ada di transkrip: ${novel.slice(0, 8).join(', ')}`;
  return null;
}

// ------------------------------------------------------------------ deterministic fallback (extractive, nothing invented)
const STOPWORDS = new Set(['yang', 'dan', 'di', 'ke', 'dari', 'untuk', 'dengan', 'ini', 'itu', 'tidak', 'pada', 'adalah', 'akan', 'dalam', 'agar', 'karena', 'atau', 'saya', 'aku', 'kita', 'kami',
  'the', 'and', 'of', 'to', 'in', 'is', 'that', 'for', 'with', 'on', 'it', 'as', 'was', 'are', 'you', 'this', 'have', 'but', 'not']);

function splitSentences(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return (clean.match(/[^.!?]+(?:[.!?]+|$)/g) || []).map(s => s.trim()).filter(s => s.length >= 12);
}

// Importance of a piece of text = how frequent its content words are in the whole transcript.
function rankPieces(pieces, transcript) {
  const freq = {};
  wordsOf(transcript).filter(w => w.length >= 4 && !STOPWORDS.has(w)).forEach(w => { freq[w] = (freq[w] || 0) + 1; });
  return pieces.map((text, index) => {
    const ws = wordsOf(text).filter(w => w.length >= 4 && !STOPWORDS.has(w));
    return { text, index, score: ws.reduce((a, w) => a + (freq[w] || 0), 0) / Math.sqrt(Math.max(ws.length, 1)) };
  });
}

const trimTo = (text, max) => {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), Math.floor(max / 2))).trimEnd()}…`;
};

function ruleBasedSummary(transcript) {
  const sentences = splitSentences(transcript);
  const pick = (pieces, n) => rankPieces(pieces, transcript).sort((a, b) => b.score - a.score).slice(0, n).sort((a, b) => a.index - b.index).map(p => p.text);
  const summarySentences = sentences.length ? pick(sentences, 3) : [String(transcript).replace(/\s+/g, ' ').trim()];
  // Key points: the most important clauses (split at commas / semicolons), not repeating the summary's own words verbatim.
  const clauses = String(transcript).replace(/\s+/g, ' ').split(/(?<=[.!?;,])\s+/).map(c => c.replace(/[.,;]+$/, '').trim()).filter(c => c.length >= 25);
  const points = pick(clauses.length ? clauses : sentences, MAX_POINTS - 1).map(p => trimTo(p, 160));
  return { summary: trimTo(summarySentences.join(' '), 600), points: points.length ? points : [trimTo(summarySentences[0], 160)] };
}

// ------------------------------------------------------------------ the model run
function friendlyError(err) {
  const msg = String((err && err.message) || err || '');
  if (/not found/i.test(msg) && /model/i.test(msg)) return `Model ${DEFAULT_LLM_MODEL} belum terpasang di Ollama (jalankan: ollama pull ${DEFAULT_LLM_MODEL}).`;
  return msg.slice(0, 480);
}

async function askModel(prompt, attempt, media) {
  return queryLocalOllama(prompt, { scope: 'EVENT_VIDEO_SUMMARY', subject: media, temperature: attempt === 1 ? 0.1 : 0.2, seed: 40 + attempt });
}

// Model answer that passed the validator, or throws (Ollama problems or a twice-rejected answer).
async function summarizeWithAi(media, lang) {
  const transcript = media.transcript;
  const parts = splitTranscript(transcript);
  if (parts.length > MAX_CHUNKS) throw new Error('Transkrip terlalu panjang untuk diringkas AI; ditampilkan ringkasan otomatis (aturan).');
  let partSummaries = null;
  if (parts.length > 1) {
    partSummaries = [];
    for (let i = 0; i < parts.length; i++) {
      partSummaries.push(cleanLine(await askModel(buildPartPrompt(parts[i], lang, i + 1, parts.length), 1, media)));
    }
  }
  let feedback = '';
  let reason = 'jawaban tidak sesuai format';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const prompt = partSummaries ? buildCombinePrompt(partSummaries, lang, feedback) : buildPrompt(transcript, lang, feedback);
    const answer = parseModelAnswer(await askModel(prompt, attempt, media));
    reason = answer ? validateAnswer(answer, transcript, lang) : 'jawaban tidak sesuai format RINGKASAN/POIN';
    if (!reason) return answer;
    feedback = reason;
  }
  throw new Error(`Ringkasan AI ditolak validator (${reason}); ditampilkan ringkasan otomatis (aturan).`);
}

async function runSummaryJob(media_id) {
  const media = await storage.getMediaById(media_id);
  if (!media || !media.transcript) return;
  const lang = summaryLanguageFor(media.transcript_language);
  let result;
  let source = 'AI';
  let error = '';
  try {
    result = await summarizeWithAi(media, lang);
  } catch (err) {
    console.error(`AI summary for ${media_id} fell back to rules:`, err.message);
    result = ruleBasedSummary(media.transcript);
    source = 'RULE';
    error = friendlyError(err);
  }
  if (!(await storage.getMediaById(media_id))) return; // deleted while it was processing
  await storage.updateMedia(media_id, {
    summary: result.summary,
    summary_points: result.points,
    summary_status: 'DONE',
    summary_source: source,
    summary_model: source === 'AI' ? DEFAULT_LLM_MODEL : null,
    summary_language: lang,
    summary_generated_at: new Date().toISOString(),
    summary_error: error
  });
}

const jobKey = media_id => `media:${media_id}`;
const isSummaryInFlight = media_id => aiQueue.has(jobKey(media_id));

// Marks the video PROCESSING and puts the job on the AI queue. Returns 'queued' | 'insufficient' | 'duplicate' | 'skipped'.
// Callers: transcribeService (new video, transcript DONE) and the manual endpoint - nothing else.
async function queueMediaSummary(media_id) {
  const media = await storage.getMediaById(media_id);
  if (!media || media.file_type !== 'VIDEO' || media.transcript_status !== 'DONE') return 'skipped'; // photos are never summarised
  if (isSummaryInFlight(media_id)) return 'duplicate';
  if (!isTranscriptSufficient(media.transcript)) {
    await storage.updateMedia(media_id, {
      summary: null, summary_points: [], summary_status: 'INSUFFICIENT', summary_source: null, summary_model: null,
      summary_language: summaryLanguageFor(media.transcript_language), summary_generated_at: new Date().toISOString(),
      summary_error: `Transkrip belum cukup untuk diringkas (kurang dari ${MIN_WORDS} kata).`
    });
    return 'insufficient';
  }
  await storage.updateMedia(media_id, { summary_status: 'PROCESSING', summary_error: '' });
  const outcome = aiQueue.enqueue(jobKey(media_id), async () => {
    try {
      await runSummaryJob(media_id);
    } catch (err) {
      console.error(`Summary job for ${media_id} failed:`, err.message);
      try {
        if (await storage.getMediaById(media_id)) await storage.updateMedia(media_id, { summary_status: 'FAILED', summary_error: friendlyError(err) });
      } catch (_) { /* storage unavailable */ }
    }
  });
  if (outcome === 'full') {
    const result = ruleBasedSummary(media.transcript);
    await storage.updateMedia(media_id, {
      summary: result.summary, summary_points: result.points, summary_status: 'DONE', summary_source: 'RULE', summary_model: null,
      summary_language: summaryLanguageFor(media.transcript_language), summary_generated_at: new Date().toISOString(),
      summary_error: 'Antrian AI sedang penuh; tekan "Buat ulang ringkasan" nanti.'
    });
  }
  return 'queued';
}

// At boot ONLY jobs that were already running when the server stopped (PROCESSING) continue. Videos that never
// had a summary (uploaded before this feature) are deliberately left alone.
async function resumeInterruptedSummaries() {
  const todo = (await storage.getAllMedia()).filter(m => m.file_type === 'VIDEO' && m.summary_status === 'PROCESSING' && m.transcript);
  for (const m of todo) await queueMediaSummary(m.media_id);
  return todo.length;
}

module.exports = {
  MIN_WORDS,
  queueMediaSummary,
  resumeInterruptedSummaries,
  isSummaryInFlight,
  summaryLanguageFor,
  isTranscriptSufficient,
  splitTranscript,
  parseModelAnswer,
  validateAnswer,
  novelWords,
  numberMentions,
  ruleBasedSummary
};
