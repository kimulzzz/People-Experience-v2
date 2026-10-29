// server/services/mediaSummaryService.js
// AI Summary of an uploaded Signature Program event VIDEO, made from its transcript by the local Gemma model
// (Ollama). Product rule: this is the ONLY thing the model is used for, and it runs only
//   - right after the transcript of a NEWLY uploaded video is DONE (transcribeService), and
//   - when an event manager presses "Regenerate summary" (POST /api/media/:id/summarize).
// It never runs on a page load, when an event is opened, at boot for old videos, for photos, PPT or a timer.
//
// A 4B model likes to invent details, so nothing it writes is trusted blindly:
//   * the summary is written in the language of the transcript (id -> Indonesian, en -> English ...);
//   * numbers, capitalised names and (id/en) content words in the answer must be traceable to the transcript;
//   * a rejected answer is retried ONCE with the offending words named; if that fails too, a deterministic
//     extractive summary (sentences taken from the transcript, nothing invented) is stored instead and
//     labelled summary_source = 'RULE' ('Automatic (rule-based)') versus 'AI';
//   * a transcript that is empty/too short is not sent to the model at all (summary_status = 'INSUFFICIENT');
//   * a long transcript (more than CHUNK_CHARS) is summarised BY TOPIC (v2.60.0, see "topic mode" below); when that does not
//     give a usable result it is summarised part by part, then combined (the older path).
// Jobs run one at a time on the shared AI queue; Ollama being off never blocks the upload or the transcript.
const storage = require('../db/storage');
const aiQueue = require('./aiQueue');
const { finalizeMediaFileName } = require('./mediaFileService');
const { queryLocalOllama, isSoftGenerationError, DEFAULT_LLM_MODEL, OLLAMA_TIMEOUT_MS, DEFAULT_AI_TIMEOUT_MS } = require('./localAiService');

const MIN_WORDS = 20;            // fewer words than this: "transcript not sufficient", the model is not called
const CHUNK_CHARS = 5000;        // safe for a 4096-token context together with the instructions
const MAX_CHUNKS = 12;           // longer than this (about 60,000 characters): rule-based summary instead
// Total time limit of ONE summary job (all parts + the retry together): 120 minutes (override: SUMMARY_JOB_TIMEOUT_MS).
// Each Ollama call is limited by OLLAMA_TIMEOUT_MS and by what is left of this budget.
const SUMMARY_JOB_TIMEOUT_MS = parseInt(process.env.SUMMARY_JOB_TIMEOUT_MS || String(DEFAULT_AI_TIMEOUT_MS), 10);
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
- Tulis dari sudut pandang orang ketiga ("ia") bila isinya cerita pribadi.${feedback ? `\n\nPERBAIKAN: jawaban Anda sebelumnya ditolak karena ${feedback}. Tulis ulang, patuhi aturan di atas, dan JANGAN memakai kata/angka yang disebut itu. Pakai hanya kata yang benar-benar ada di transkrip (bila ragu, salin frasanya dari transkrip) dan tulis lebih ringkas: 2 sampai 3 kalimat dan 3 poin pendek.` : ''}

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
- Write in the third person when the content is a personal story.${feedback ? `\n\nFIX: your previous answer was rejected because ${feedback}. Rewrite it, follow the rules above and do NOT use the words/numbers mentioned. Use only words that really occur in the transcript (when in doubt, copy the phrase from it) and be shorter: 2 to 3 sentences and 3 short points.` : ''}

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

// Splits a long transcript at sentence ends (or spaces) into parts of at most `size` characters (default CHUNK_CHARS).
function splitTranscript(text, size = CHUNK_CHARS) {
  const parts = [];
  let rest = String(text || '').trim();
  while (rest.length > size) {
    const window = rest.slice(0, size);
    let cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '));
    if (cut < size / 2) cut = window.lastIndexOf(' ');
    if (cut < size / 2) cut = size - 1;
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
// Words that carry no fact of their own (function words, light verbs, "the speaker tells ..." phrasing, frequency/degree
// adverbs), matched as the exact word.
const NEUTRAL = {
  id: new Set(['tersebut', 'kemudian', 'akhirnya', 'awalnya', 'bahwa', 'dengan', 'sebuah', 'seseorang', 'menceritakan', 'membahas', 'menjelaskan', 'menyampaikan',
    'pembicara', 'berbicara', 'tentang', 'mengenai', 'dalam', 'hidupnya', 'sehingga', 'namun', 'serta', 'setelah', 'sebelum', 'ketika', 'dapat', 'akan', 'mulai',
    'juga', 'yang', 'dari', 'untuk', 'pada', 'karena', 'agar', 'oleh', 'antara', 'terhadap', 'melalui', 'selama', 'sampai', 'orang', 'tidak', 'sebagai', 'adalah',
    'sebelumnya', 'sangat', 'terutama', 'sebenarnya', 'sesungguhnya', 'sedikit', 'banyak', 'sering', 'selalu', 'hanya', 'masih', 'sudah', 'telah',
    // v2.30.3: more connectives, auxiliaries, pronouns, degree/frequency words and reporting verbs
    'seringkali', 'sangatlah', 'kadang', 'kadangkala', 'biasanya', 'mungkin', 'harus', 'perlu', 'semua', 'setiap', 'beberapa', 'lainnya', 'tertentu', 'secara',
    'umumnya', 'khususnya', 'misalnya', 'seperti', 'selain', 'supaya', 'walaupun', 'meskipun', 'apabila', 'bahkan', 'maupun', 'ataupun', 'tetapi', 'yaitu',
    'yakni', 'ialah', 'merupakan', 'menjadi', 'melakukan', 'terdapat', 'berada', 'berbagai', 'lebih', 'paling', 'cukup', 'kurang', 'hampir', 'sekitar',
    'selanjutnya', 'berikutnya', 'seluruh', 'menyebutkan', 'menyatakan', 'mengatakan', 'bercerita', 'mengungkapkan', 'menegaskan', 'menekankan',
    'menggambarkan', 'menunjukkan', 'dijelaskan', 'disampaikan', 'diceritakan', 'narator', 'penulis', 'dirinya', 'mereka', 'sendiri', 'bersama',
    // v2.60.0: the neutral opener the topic summary repair writes ("Pembahasan mencakup ...")
    'mencakup']),
  en: new Set(['speaker', 'about', 'which', 'their', 'there', 'where', 'while', 'after', 'before', 'being', 'because', 'through', 'during', 'between', 'describes',
    'explains', 'discusses', 'mentions', 'person', 'also', 'these', 'those', 'other', 'would', 'could', 'should',
    // v2.30.3
    'narrator', 'states', 'notes', 'highlights', 'emphasizes', 'shares', 'tells', 'another', 'several', 'various', 'overall', 'generally', 'often', 'sometimes',
    'usually', 'really', 'however', 'therefore', 'although', 'though', 'whether', 'around', 'within', 'without', 'against', 'among', 'under', 'since', 'until',
    'every', 'something', 'everyone', 'people',
    'covers'])
};
// Reporting verbs, recognised in any inflected form ("dijelaskan", "pembahasan", "explained"). Only roots that never carry a fact on their own:
// a general function-word list matched by stem would swallow real content words ("dapat" -> "pendapatan").
const NEUTRAL_ROOTS = {
  id: new Set(['jelas', 'cerita', 'sampaikan', 'bahas', 'ungkap']),
  en: new Set(['explain', 'discuss', 'mention', 'describe', 'share', 'highlight', 'emphasize'])
};
// Words that are only function words in each language, used to detect a summary written in the wrong language.
const LANG_MARKERS = {
  id: new Set(['yang', 'dan', 'di', 'ke', 'dari', 'untuk', 'dengan', 'ini', 'itu', 'tidak', 'pada', 'adalah', 'akan', 'ia', 'dalam', 'agar', 'karena']),
  en: new Set(['the', 'and', 'of', 'to', 'in', 'is', 'that', 'for', 'with', 'on', 'it', 'as', 'was', 'are', 'he', 'she', 'they'])
};

// Light stemming (v2.30.3): "dampaknya" ~ "dampak", "berpartisipasi" ~ "partisipasi", "merasa" ~ "terasa", "learned" ~ "learn".
// Every plausible stem of a word is produced (an affix can hide a changed first letter: meny+adari -> sadar, men+ulis -> tulis,
// ter+asa -> rasa) and two words match when they share a stem. A stem has at least STEM_MIN letters, so 'ada', 'ini' ...
// never create a match by accident. Two stems also match when the shorter one (5+ letters) is the beginning of the other and
// the other is at most 4 letters longer ("sosial" ~ "sosialisasi", "bahas" ~ "bahasa").
const STEM_MIN = 4;
const ID_PREFIXES = [ // [prefix, letters the root may have lost because of that prefix]
  ['memper', ['']], ['member', ['']], ['pember', ['']], ['diper', ['']], ['menge', ['']], ['pemer', ['']],
  ['meny', ['s']], ['peny', ['s']], ['meng', ['', 'k']], ['peng', ['', 'k']], ['mem', ['', 'p']], ['pem', ['', 'p']], ['men', ['', 't']], ['pen', ['', 't']],
  ['ter', ['', 'r']], ['ber', ['']], ['per', ['']], ['be', ['']], ['te', ['']], ['me', ['']], ['pe', ['']], ['di', ['']], ['ke', ['']], ['se', ['']]
];
const ID_CLITICS = ['nya', 'ku', 'mu', 'lah', 'kah', 'pun'];
const ID_SUFFIXES = ['kan', 'an', 'i'];
const EN_SUFFIXES = [['ing', ''], ['ing', 'e'], ['ed', ''], ['ed', 'e'], ['ies', 'y'], ['es', ''], ['ly', ''], ['ers', ''], ['er', ''], ['ments', ''], ['ment', ''], ['ions', ''], ['ion', ''], ['ness', ''], ['s', '']];

function idStems(word) {
  const prefixed = new Set([word]);
  let frontier = [word];
  for (let depth = 0; depth < 2; depth++) { // memper+hati+kan: a prefix can sit behind another prefix
    const next = [];
    for (const w of frontier) {
      for (const [prefix, extras] of ID_PREFIXES) {
        if (!w.startsWith(prefix)) continue;
        const rest = w.slice(prefix.length);
        for (const extra of extras) {
          const cand = extra + rest;
          if (cand.length >= STEM_MIN && !prefixed.has(cand)) { prefixed.add(cand); next.push(cand); }
        }
      }
    }
    frontier = next;
  }
  const out = new Set(prefixed);
  prefixed.forEach(b => {
    const bases = [b];
    ID_CLITICS.forEach(c => { if (b.endsWith(c) && b.length - c.length >= STEM_MIN) bases.push(b.slice(0, -c.length)); });
    bases.forEach(x => {
      out.add(x);
      ID_SUFFIXES.forEach(s => { if (x.endsWith(s) && x.length - s.length >= STEM_MIN) out.add(x.slice(0, -s.length)); });
    });
  });
  return out;
}

function enStems(word) {
  const out = new Set([word]);
  EN_SUFFIXES.forEach(([suffix, add]) => {
    if (!word.endsWith(suffix) || word.length - suffix.length < STEM_MIN - 1) return;
    const base = word.slice(0, -suffix.length);
    [base + add, base.replace(/([^aeiou])\1$/, '$1') + add].forEach(c => { if (c.length >= STEM_MIN) out.add(c); }); // "planned" -> "plan"
  });
  return out;
}

const stemsOf = (word, lang) => (lang === 'en' ? enStems(word) : idStems(word));

const wordsOf = text => String(text || '').toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);

// Every stem found in the transcript, plus a first-5-letters bucket for the "beginning of" rule.
function buildSourceIndex(transcript, lang) {
  const stemSet = new Set();
  const buckets = new Map();
  new Set(wordsOf(transcript)).forEach(w => stemsOf(w, lang).forEach(s => {
    if (stemSet.has(s)) return;
    stemSet.add(s);
    if (s.length >= 5) {
      const key = s.slice(0, 5);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(s);
    }
  }));
  return { stemSet, buckets };
}

function isInSource(word, lang, index) {
  for (const s of stemsOf(word, lang)) {
    if (index.stemSet.has(s)) return true;
    if (s.length < 5) continue;
    for (const t of index.buckets.get(s.slice(0, 5)) || []) {
      const [shorter, longer] = s.length <= t.length ? [s, t] : [t, s];
      if (longer.startsWith(shorter) && longer.length - shorter.length <= 4) return true;
    }
  }
  return false;
}

// Content words (5+ letters) of `output` that cannot be traced to the transcript (exact or by stem). `sourceIndex` = an index
// of the same transcript built earlier (checking many topic points against one long transcript).
function novelWords(output, transcript, lang, sourceIndex) {
  if (lang !== 'id' && lang !== 'en') return { total: 0, novel: [] };
  const neutral = NEUTRAL[lang];
  const source = String(transcript || '').toLowerCase();
  const index = sourceIndex || buildSourceIndex(transcript, lang);
  // Hyphenated words (reduplications such as "sia-sia" / "menyia-nyiakan") are skipped: they cannot be stemmed reliably.
  const words = String(output || '').toLowerCase().split(/[^\p{L}-]+/u).map(w => w.replace(/^-+|-+$/g, '')).filter(w => w.length >= 5 && !w.includes('-'))
    .filter(w => !neutral.has(w) && ![...stemsOf(w, lang)].some(s => NEUTRAL_ROOTS[lang].has(s)));
  const novel = words.filter(w => !source.includes(w) && !isInSource(w, lang, index));
  return { total: words.length, novel: [...new Set(novel)] };
}

// Limits for content words the transcript does not contain (after stemming). A paraphrase has a few of them, an invented
// story has many: reject on NOVEL_LIMITS.min words AND a share above `ratio` of the summary's content words, or on `max`
// words in any case. A long (chunked) transcript has a wide vocabulary and its combined summary is longer: more room.
const NOVEL_LIMITS = { min: 5, ratio: 0.30, max: 12, longRatio: 0.35, longMax: 18 };
function tooManyNovelWords(novelCount, total, transcript) {
  const isLong = String(transcript || '').length > CHUNK_CHARS;
  const ratio = isLong ? NOVEL_LIMITS.longRatio : NOVEL_LIMITS.ratio;
  const max = isLong ? NOVEL_LIMITS.longMax : NOVEL_LIMITS.max;
  return novelCount >= max || (novelCount >= NOVEL_LIMITS.min && novelCount / Math.max(total, 1) > ratio);
}

const normNumber = token => token.replace(/[.,]+$/, '').replace(/[.,]/g, '');
const digitTokens = text => new Set((String(text).match(/\d[\d.,]*/g) || []).map(normNumber).filter(Boolean)); // "1.000" = "1000", "70-30" = 70 + 30

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

  if (/<\/?[a-z!][^>]*>/i.test(text)) return 'memuat tag HTML/markup';

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
  if (tooManyNovelWords(novel.length, total, transcript)) return `memuat kata yang tidak ada di transkrip: ${novel.slice(0, 12).join(', ')}`;
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
  if (/not found/i.test(msg) && /model/i.test(msg)) return `Model ${DEFAULT_LLM_MODEL} is not installed in Ollama (run: ollama pull ${DEFAULT_LLM_MODEL}).`;
  return msg.slice(0, 480);
}

// One Gemma call of the summary job; `deadline` = the end of the whole job's time budget (SUMMARY_JOB_TIMEOUT_MS).
async function askModel(prompt, media, deadline, options = {}) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error(`The AI summary exceeded the ${Math.round(SUMMARY_JOB_TIMEOUT_MS / 60000)} minutes limit`);
  return queryLocalOllama(prompt, { temperature: 0.1, seed: 41, ...options, scope: 'EVENT_VIDEO_SUMMARY', subject: media, timeoutMs: Math.min(OLLAMA_TIMEOUT_MS, remaining) });
}

// v2.60.0: Ollama can abort ONE generation ("prediction aborted, token repeat limit reached" when the model loops on the same
// tokens) or return nothing. That is not "Ollama down": the answer counts as unusable (null) and the caller's one retry runs,
// with REPEAT_GUARD added. Hard problems (not running, connection reset, timeout, model missing) still throw -> rule-based.
const ABORTED_REASON = 'jawaban terputus karena model mengulang kata yang sama; tulis lebih ringkas';
async function askModelOrNull(prompt, media, deadline, options, stats) {
  try {
    return await askModel(prompt, media, deadline, options);
  } catch (err) {
    if (!isSoftGenerationError(err)) throw err;
    console.warn(`AI summary for ${media.media_id}: one answer was aborted by Ollama (${err.message}) - treated as unusable`);
    if (stats) stats.aborted_answers++;
    return null;
  }
}
// An answer the topic mode could not use: why the generation stopped and its first/last 150 characters (never more of the text).
function logUnusableAnswer(media, label, res) {
  const t = String((res && res.text) || '');
  console.warn(`AI topic summary for ${media.media_id}: ${label} answer not usable (done_reason=${(res && res.doneReason) || '?'}, eval_count=${res && res.evalCount !== null && res.evalCount !== undefined ? res.evalCount : '?'}, ${t.length} chars) start="${t.slice(0, 150)}" end="${t.slice(-150)}"`);
}
// Repetition guard of every retry (the first attempts keep the settings that worked in the spike).
const REPEAT_GUARD = { repeatPenalty: 1.15, repeatLastN: 128 };
// First answer / the one retry of the (older) text-format summary.
const attemptOptions = attempt => (attempt === 1 ? { temperature: 0.1, seed: 41 } : { temperature: 0.2, seed: 42, ...REPEAT_GUARD });
const abortedTwiceError = () => new Error('Ollama aborted the AI answer twice (the model kept repeating itself); the automatic (rule-based) summary is shown.');

// Model answer that passed the validator, or throws (Ollama problems or a twice-rejected answer).
async function summarizeWithAi(media, lang, deadline = Date.now() + SUMMARY_JOB_TIMEOUT_MS) {
  const transcript = media.transcript;
  const parts = splitTranscript(transcript);
  if (parts.length > MAX_CHUNKS) throw new Error('The transcript is too long for the AI summary; the automatic (rule-based) summary is shown.');
  let partSummaries = null;
  if (parts.length > 1) {
    partSummaries = [];
    for (let i = 0; i < parts.length; i++) {
      const prompt = buildPartPrompt(parts[i], lang, i + 1, parts.length);
      const text = (await askModelOrNull(prompt, media, deadline, attemptOptions(1))) ?? (await askModelOrNull(prompt, media, deadline, attemptOptions(2)));
      if (text === null) throw abortedTwiceError();
      partSummaries.push(cleanLine(text));
    }
  }
  let feedback = '';
  let reason = 'jawaban tidak sesuai format';
  let aborted = 0;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const prompt = partSummaries ? buildCombinePrompt(partSummaries, lang, feedback) : buildPrompt(transcript, lang, feedback);
    const raw = await askModelOrNull(prompt, media, deadline, attemptOptions(attempt));
    if (raw === null) aborted++;
    const answer = parseModelAnswer(raw);
    reason = raw === null ? ABORTED_REASON : answer ? validateAnswer(answer, transcript, lang) : 'jawaban tidak sesuai format RINGKASAN/POIN';
    if (!reason) return answer;
    feedback = reason;
  }
  if (aborted === 2) throw abortedTwiceError();
  console.warn(`AI summary for ${media.media_id} rejected by the validator: ${reason}`);
  throw new Error('The AI summary was rejected by the validator; the automatic (rule-based) summary is shown.');
}

// ------------------------------------------------------------------ topic mode (v2.60.0): long transcripts
// "Summary of the part summaries" dropped most of the middle topics of a long meeting. A transcript longer than CHUNK_CHARS
// is therefore summarised BY TOPIC (map / reduce, JSON answers):
//   map    - every part of about TOPIC_PART_CHARS -> 1-3 topics with 1-3 points (v2.60.3: 2-4 topics x 2-3 points for a part of 2,000+
//            characters). An unreadable or empty answer is asked again
//            ONCE (another seed + "this part certainly contains a discussion"); still empty -> that part is skipped (counted);
//   reduce - one call merges the topics of all parts into 4-8 topics in meeting order + an overall summary of 3-5 sentences.
// Nothing is trusted blindly: every point and topic title is checked against the WHOLE transcript with the rules of the short
// summary (numbers, names/acronyms, meta phrases, markup, words that are not in the transcript). A point that fails is DROPPED,
// not the whole summary; a topic left without points is dropped. The overall summary must pass validateAnswer; it gets one
// retry naming the problem. Still failing, fewer than TOPIC_MIN_FINAL topics left, or fewer than TOPIC_MIN_MAPPED topics from
// the map step -> null, and the job continues on the older part-by-part path (which can end in the rule-based summary).
// v2.60.1 (see "agendas of a meeting, blocks of many topics" below): a meeting with 2+ agendas is mapped and merged per agenda;
// more than TOPIC_BLOCK_THRESHOLD map topics (or a single merge without a usable attempt) are merged in blocks.
// v2.60.3 (see "structured outputs" and "protect step" below): every topic-mode call sends a JSON SCHEMA as `format`, a map part of
// TOPIC_SHORT_PART_CHARS or more asks for 2-4 topics with 2-3 points, and map points with a number/decision that a merge lost are put back.
const TOPIC_PART_CHARS = 6000;
const TOPIC_MAX_PARTS = 20;          // more parts (about 120,000 characters): the older path, which goes rule-based above MAX_CHUNKS
const TOPIC_MIN_MAPPED = 2;          // fewer topics from all parts together: the older path
const TOPIC_MIN_FINAL = 2;           // fewer topics left after the fact check: the older path
const TOPIC_PART_LIMITS = { topics: 4, points: 3 };
const TOPIC_FINAL_LIMITS = { topics: 8, points: 4 };
const TOPIC_MAP_OPTIONS = { numCtx: 8192, numPredict: 700 };
const TOPIC_MERGE_PREDICT = 1400;
const TOPIC_SEEDS = [41, 42];        // first answer / the one retry (map part and merge)
const TOPIC_SHORT_PART_CHARS = 2000; // a shorter map part (the tail of a transcript) asks for 1-3 topics, a longer one for 2-4

const usesTopicMode = transcript => String(transcript || '').trim().length > CHUNK_CHARS;
const mapTopicRange = text => (String(text || '').length >= TOPIC_SHORT_PART_CHARS ? { min: 2, max: 4, minPoints: 2 } : { min: 1, max: 3, minPoints: 1 });

// ------------------------------------------------------------------ v2.60.3: structured outputs (JSON schema as `format`)
// With format 'json' Gemma often wrote the right content but broke the JSON structure ('"}] , [": ...') and then looped on
// '0} 0} 0}' until num_predict or Ollama's token repeat limit, so the part counted as empty - on the most decision-dense part of
// a meeting too. Ollama's structured outputs take a JSON SCHEMA as `format` and only let the model write text that fits it. The
// keys follow the prompt's language (the English prompts, with English keys, serve every language except Indonesian);
// minItems / maxItems fix the topic and point counts per call type. parseJsonAnswer / normalizeTopics stay as a second line of defence.
const SCHEMA_KEYS = {
  id: { topics: 'topik', title: 'judul', points: 'poin', summary: 'ringkasan', detect: 'agenda_baru', name: 'nama', quote: 'kutipan', groups: 'agenda', start: 'mulai' },
  en: { topics: 'topics', title: 'title', points: 'points', summary: 'summary', detect: 'new_agendas', name: 'name', quote: 'quote', groups: 'agendas', start: 'start' }
};
const schemaKeys = lang => (lang === 'id' ? SCHEMA_KEYS.id : SCHEMA_KEYS.en);
const objectSchema = properties => ({ type: 'object', properties, required: Object.keys(properties) });
const STRING_SCHEMA = { type: 'string' };

// { topik|topics: [{ judul|title, poin|points }] } (+ ringkasan|summary first when withSummary), minPoints..maxPoints points per topic.
function topicSchema(lang, { minTopics, maxTopics, minPoints = 1, maxPoints, withSummary = false }) {
  const k = schemaKeys(lang);
  const topic = objectSchema({ [k.title]: STRING_SCHEMA, [k.points]: { type: 'array', minItems: minPoints, maxItems: maxPoints, items: STRING_SCHEMA } });
  return objectSchema({ ...(withSummary ? { [k.summary]: STRING_SCHEMA } : {}), [k.topics]: { type: 'array', minItems: minTopics, maxItems: maxTopics, items: topic } });
}
// Map part: 2-4 topics with 2-3 points each for a part of TOPIC_SHORT_PART_CHARS or more, 1-3 topics with 1-3 points for a shorter
// one. The 2-point minimum: with 1 allowed, Gemma answered the most decision-dense part of a real meeting with 4 topics x 1 point (the
// numbers and decisions were left out); with 2 required it wrote 3 x 3 (map coverage of the manual minutes 57% -> 82%).
function mapSchema(text, lang) {
  const range = mapTopicRange(text);
  return topicSchema(lang, { minTopics: range.min, maxTopics: range.max, minPoints: range.minPoints, maxPoints: TOPIC_PART_LIMITS.points });
}
// Agenda detect / group: the shapes of their prompts, no counts (an empty list = no new agenda in this part).
const agendaDetectSchema = lang => {
  const k = schemaKeys(lang);
  return objectSchema({ [k.detect]: { type: 'array', items: objectSchema({ [k.name]: STRING_SCHEMA, [k.quote]: STRING_SCHEMA }) } });
};
const agendaGroupSchema = lang => {
  const k = schemaKeys(lang);
  return objectSchema({ [k.groups]: { type: 'array', items: objectSchema({ [k.name]: STRING_SCHEMA, [k.start]: { type: 'integer' } }) } });
};

function buildTopicPartPrompt(text, lang, index, total, insist = false) {
  const range = mapTopicRange(text);
  if (lang === 'id') {
    return `Anda meringkas isi sebuah rekaman dalam Bahasa Indonesia. Berikut bagian ${index} dari ${total} transkrip rekaman tersebut (bisa rapat, diskusi, wawancara, podcast, atau video edukasi; hasil speech-to-text, bisa ada salah ketik).

Tugas: ambil TOPIK-TOPIK yang dibahas di bagian ini (${range.min} sampai ${range.max} topik). Untuk setiap topik tulis 1 sampai 3 poin singkat tentang isi yang dibahas. Keputusan, tindak lanjut, dan target waktu ditulis HANYA bila benar-benar diucapkan.${insist ? '\nBagian ini PASTI berisi pembahasan, jangan kosong: tulis minimal 1 topik dengan 1 poin.' : ''}
Aturan:
- Hanya isi yang benar-benar diucapkan. Dilarang menambah angka, tanggal, nama, atau kesimpulan yang tidak ada di transkrip.
- Jangan pernah menulis poin bahwa sesuatu tidak disebutkan, tidak ada, atau belum diputuskan (misalnya "tidak ada target waktu").
- Jangan menyebut jenis acaranya (rapat, podcast, video) kecuali transkrip sendiri menyebutnya.
- Abaikan basa-basi (salam, cek kamera/suara).
- Setiap poin satu kalimat, maksimal 25 kata. Judul topik 2 sampai 6 kata.
- Jawab HANYA JSON: {"topik":[{"judul":"...","poin":["...","..."]}]}

Transkrip:
"""
${text}
"""`;
  }
  return `You summarize the content of a recording in ${LANGUAGES[lang]}. Below is part ${index} of ${total} of its transcript (it may be a meeting, discussion, interview, podcast or educational video; speech-to-text, may contain typos).

Task: list the TOPICS discussed in this part (${range.min} to ${range.max} topics). For each topic write 1 to 3 short points about what was discussed. Write decisions, follow-ups and deadlines ONLY when they were really said.${insist ? '\nThis part DEFINITELY contains a discussion, do not answer empty: write at least 1 topic with 1 point.' : ''}
Rules:
- Only what was really said. Never add numbers, dates, names or conclusions that are not in the transcript.
- Never write a point saying that something was not mentioned, does not exist or was not decided (e.g. "no deadline was mentioned").
- Do not name the type of event (meeting, podcast, video) unless the transcript itself does.
- Skip small talk (greetings, camera/sound checks).
- Each point one sentence, at most 25 words. Topic title 2 to 6 words.
- Answer ONLY JSON: {"topics":[{"title":"...","points":["...","..."]}]}

Transcript:
"""
${text}
"""`;
}

// `group` (v2.60.1): null = the whole recording (one merge, 4-8 topics); { kind: 'agenda', name } = one agenda of a meeting
// (2-5 topics, a 1-2 sentence summary naming the agenda); { kind: 'block' } = one run of consecutive parts (2-4 topics).
function buildTopicMergePrompt(partTopics, lang, feedback, group = null) {
  const agenda = !!group && group.kind === 'agenda';
  if (lang === 'id') {
    const list = partTopics.map((t, k) => `${k + 1}. [bagian ${t.part}] ${t.title}: ${t.points.join(' | ')}`).join('\n');
    const source = !group ? 'dari beberapa bagian satu rekaman yang sama' : agenda ? `dari agenda "${group.name}" dalam sebuah rekaman` : 'dari satu potongan berurutan sebuah rekaman';
    const count = !group ? '4 sampai 8' : agenda ? '2 sampai 5' : '2 sampai 4';
    const summary = !group ? 'Tulis "ringkasan" umum 3 sampai 5 kalimat tentang keseluruhan isi.'
      : agenda ? `Tulis "ringkasan" 1 sampai 2 kalimat tentang agenda ini; kalimat pertama menyebut "${group.name}".` : 'Tulis "ringkasan" 1 sampai 2 kalimat tentang isi potongan ini.';
    return `Berikut daftar topik dan poin hasil ekstraksi ${source} (Bahasa Indonesia):
${list}

Tugas:
1. Gabungkan topik yang sama atau sangat mirip menjadi satu. Hasilkan ${count} topik akhir, urut sesuai jalannya rekaman.
2. Untuk setiap topik akhir tulis 1 sampai 4 poin singkat (satu kalimat, maksimal 25 kata) tentang isinya; keputusan, tindak lanjut, dan target waktu hanya bila ada di daftar. Jangan mengulang poin yang sama atau yang maknanya sama, juga di topik lain.
3. ${summary} Mulai langsung dengan pokok bahasannya sendiri, JANGAN PERNAH membuka dengan "Rekaman ini", "Video ini", "Transkrip ini", "Rapat ini", "Pertemuan ini", "Diskusi ini", atau "Podcast ini"; jangan menyebut jenis acaranya ("dalam rapat", "video ini") kecuali daftar di atas menyebutnya.
Aturan: hanya pakai informasi dari daftar di atas; dilarang menambah angka, tanggal, nama, atau kesimpulan baru; jangan pernah menulis poin bahwa sesuatu tidak disebutkan, tidak ada, atau belum diputuskan.${feedback ? `\n\nPERBAIKAN: jawaban Anda sebelumnya ditolak karena ${feedback}. Tulis ulang, JANGAN memakai kata/angka/nama yang disebut itu, dan pakai hanya kata yang benar-benar ada di daftar.` : ''}
Jawab HANYA JSON: {"ringkasan":"...","topik":[{"judul":"...","poin":["..."]}]}`;
  }
  const list = partTopics.map((t, k) => `${k + 1}. [part ${t.part}] ${t.title}: ${t.points.join(' | ')}`).join('\n');
  const source = !group ? 'from the parts of one and the same recording' : agenda ? `from the agenda "${group.name}" of a recording` : 'from one run of consecutive parts of a recording';
  const count = !group ? '4 to 8' : agenda ? '2 to 5' : '2 to 4';
  const summary = !group ? 'Write an overall "summary" of 3 to 5 sentences about the whole content.'
    : agenda ? `Write a "summary" of 1 to 2 sentences about this agenda; the first sentence names "${group.name}".` : 'Write a "summary" of 1 to 2 sentences about the content of this run.';
  return `Below are the topics and points extracted ${source} (${LANGUAGES[lang]}):
${list}

Task:
1. Merge topics that are the same or very similar. Give ${count} final topics, in the order of the recording.
2. For each final topic write 1 to 4 short points (one sentence, at most 25 words) about its content; decisions, follow-ups and deadlines only when they are in the list. Do not repeat a point or one with the same meaning, also not in another topic.
3. ${summary} Start with the subject itself, NEVER with "This recording", "This video", "This transcript", "This meeting", "This discussion" or "This podcast"; do not name the type of event ("in the meeting", "this video") unless the list above does.
Rules: use only information from the list above; never add new numbers, dates, names or conclusions; never write a point saying that something was not mentioned, does not exist or was not decided. Write in ${LANGUAGES[lang]}.${feedback ? `\n\nFIX: your previous answer was rejected because ${feedback}. Rewrite it, do NOT use the words/numbers/names mentioned, and use only words that really occur in the list.` : ''}
Answer ONLY JSON: {"summary":"...","topics":[{"title":"...","points":["..."]}]}`;
}

// The model's JSON answer (also when wrapped in a ``` block or with text around it), or null.
function parseJsonAnswer(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(raw); } catch (_) { /* text around the object */ }
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch (_) { /* not JSON */ } }
  return null;
}

const fieldOf = (obj, keys) => {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) if (obj[k] !== undefined) return obj[k];
  return undefined;
};
const textOf = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string').join(' ') : typeof v === 'string' ? v : '');

// [{ judul|title, poin|points }] -> [{ title, points }] with clean text, at most `limits` topics/points; topics without a title
// or without points are left out.
function normalizeTopics(list, limits) {
  if (!Array.isArray(list)) return [];
  return list.filter(t => t && typeof t === 'object').map(t => {
    const points = fieldOf(t, ['poin', 'points', 'point']);
    return {
      title: trimTo(cleanLine(textOf(fieldOf(t, ['judul', 'title', 'topik', 'topic']))).replace(/[.:]+$/, ''), 90),
      points: (Array.isArray(points) ? points : [points]).filter(p => typeof p === 'string').map(cleanLine)
        .filter(p => p.length >= 8).map(p => trimTo(p, 300)).slice(0, limits.points)
    };
  }).filter(t => t.title && t.points.length).slice(0, limits.topics);
}

// Everything needed to check many titles/points against one transcript, built once per job. `fileName` = the uploaded file
// name, which may also say what the recording is ("... Meeting Recording.mp4").
function buildCheckContext(transcript, lang, fileName = '') {
  const lower = String(transcript || '').toLowerCase();
  return {
    transcript, lang, lower,
    eventWordsAllowed: EVENT_WORD_RE.test(transcript) || EVENT_WORD_RE.test(fileName),
    numbers: supportedNumberKeys(transcript),
    words: new Set(lower.split(/[^\p{L}\d]+/u).filter(Boolean)),
    index: lang === 'id' || lang === 'en' ? buildSourceIndex(transcript, lang) : null
  };
}

// An acronym ("UX", "OJK") must be a whole word of the transcript: "ui" inside "melalui" is not "UI". "UI/UX" counts as the
// two words UI and UX on both sides, and a clitic or suffix written onto the acronym ("SLA-nya", "KPInya", "KPIs") still matches.
const ACRONYM_RE = /^(?=\d*\p{Lu})[\p{Lu}\d]{2,8}$/u;
const ACRONYM_TAILS = ['nya', 'ku', 'mu', 'lah', 'kah', 'pun', 'an', 'kan', 's'];
const acronymInSource = (token, ctx) => {
  const a = token.toLowerCase();
  return ctx.words.has(a) || ACRONYM_TAILS.some(t => ctx.words.has(a + t));
};
// A title is written in Title Case, so a capital there only marks a name right after one of these words ("Pak Budi").
const HONORIFICS = new Set(['pak', 'bu', 'bapak', 'ibu', 'mas', 'mbak', 'sdr', 'sdri', 'mr', 'mrs', 'ms', 'dr', 'prof']);

// Names, places and acronyms of `text` that the transcript does not contain. Tokens are split at "/" too ("UI/UX" = UI + UX).
// An acronym (anywhere, also as first word) must be a whole transcript word. Other capitalised words follow validateAnswer: in a
// point every capitalised word except the first of a sentence must occur in the transcript; in a title only a word right after
// an honorific is checked (the other capitals of a title are just Title Case).
function unknownNames(text, ctx, isTitle) {
  const names = new Set();
  for (const sentence of String(text).split(/[\n]|(?<=[.!?])\s+/)) {
    const tokens = sentence.match(/[\p{L}\d'-]+/gu) || [];
    tokens.forEach((t, i) => {
      if (t.length < 2 || !/^\p{Lu}/u.test(t)) return;
      if (ACRONYM_RE.test(t)) { if (!acronymInSource(t, ctx)) names.add(t); return; }
      if (i === 0 || (isTitle && !HONORIFICS.has(tokens[i - 1].toLowerCase()))) return;
      if (!ctx.lower.includes(t.toLowerCase())) names.add(t);
    });
  }
  return [...names];
}

// null = this title/point may be shown, otherwise the reason it is dropped.
function fragmentProblem(text, ctx, kind = 'point') {
  if (META_RE.test(text)) return 'frasa meta';
  if (/<\/?[a-z!][^>]*>/i.test(text)) return 'tag HTML/markup';
  const badNumbers = [...new Set(numberMentions(text).filter(x => !ctx.numbers.has(x.key)).map(x => x.label))];
  if (badNumbers.length) return `angka yang tidak ada di transkrip: ${badNumbers.join(', ')}`;
  const names = unknownNames(text, ctx, kind === 'title');
  if (names.length) return `nama/istilah yang tidak ada di transkrip: ${names.slice(0, 6).join(', ')}`;
  if (kind === 'point' && ctx.index) {
    const { total, novel } = novelWords(text, ctx.transcript, ctx.lang, ctx.index);
    if (tooManyNovelWords(novel.length, total, ctx.transcript)) return `kata yang tidak ada di transkrip: ${novel.slice(0, 12).join(', ')}`;
  }
  return null;
}

// Review of the first real summaries (v2.60.0): a long video is not always a meeting (documentary, podcast), and Gemma wrote
// filler points ("Target waktu: pemahaman konsep ...", "Tidak ada target waktu yang disebutkan ...") and near-duplicates.
// Words naming the event type: allowed only when the transcript (or the uploaded file name) uses them itself.
const EVENT_WORD_RE = /\b(rapat|pertemuan|meeting)\b/i;
const EVENT_REASON = 'ringkasan menyebut "rapat"/"pertemuan", padahal rekaman ini tidak menyebut dirinya rapat; mulai ringkasan langsung dengan isinya';
// A point that only says something was NOT mentioned / decided, or a "Target waktu:" label without any time in it.
const FILLER_LABEL_RE = /^\s*(target( waktu)?|tenggat( waktu)?|batas waktu|deadline|target date|timeline)\s*:/i;
const TIME_WORD_RE = /\d|\b(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|january|february|march|may|june|july|august|october|december|minggu|pekan|bulan|tahun|hari|kuartal|besok|lusa|week|month|year|day|quarter|today|tomorrow)\b/i;
const FILLER_RES = [
  /\b(tidak|belum)\s+(di)?(sebutkan|sebut|jelaskan|ungkapkan|bahas|singgung)\b/i,
  /\b(tidak|belum)\s+ada\b[^.]*\b(target|tenggat|batas waktu|deadline|keputusan|tindak lanjut|jadwal)\b/i,
  /\b(target|tenggat|batas waktu|deadline|keputusan|tindak lanjut|jadwal)\b[^.]*\b(tidak|belum)\s+(ada|di(tentukan|tetapkan|putuskan|jadwalkan|ambil))\b/i,
  /\b(not|never)\s+(mentioned|specified|stated|discussed|given|decided|set)\b/i,
  /\bno\s+(deadlines?|timelines?|target dates?|decisions?|follow-ups?)\b/i
];
function isFillerPoint(text, ctx) {
  if (FILLER_LABEL_RE.test(text) && !TIME_WORD_RE.test(text.replace(FILLER_LABEL_RE, ''))) return true;
  if (FILLER_RES.some(re => re.test(text))) return true;
  return !ctx.eventWordsAllowed && EVENT_WORD_RE.test(text);
}

// Drops the points (and topics whose title fails) that do not pass the fact check, and filler points:
// { topics, droppedPoints, droppedTopics, fillerPoints }. checkTitles false = the map step (its titles are only input for the
// merge; the final titles are checked there).
function checkTopics(topics, ctx, checkTitles = true) {
  const kept = [];
  let droppedPoints = 0;
  let droppedTopics = 0;
  let fillerPoints = 0;
  for (const t of topics) {
    const titleProblem = checkTitles ? fragmentProblem(t.title, ctx, 'title') : null;
    if (titleProblem) { droppedTopics++; droppedPoints += t.points.length; console.warn(`  topic "${t.title}" dropped: ${titleProblem}`); continue; }
    const points = t.points.filter(p => {
      if (isFillerPoint(p, ctx)) { fillerPoints++; console.warn(`  filler point dropped: ${p}`); return false; }
      const problem = fragmentProblem(p, ctx, 'point');
      if (problem) { droppedPoints++; console.warn(`  point dropped (${problem}): ${p}`); }
      return !problem;
    });
    if (points.length) kept.push({ title: t.title, points });
    else droppedTopics++;
  }
  return { topics: kept, droppedPoints, droppedTopics, fillerPoints };
}

// Near-duplicate points (within a topic and across topics): their content words are compared by stem. "Hindari makan sambil
// bermain HP untuk menjaga fokus" and "Jangan makan sambil bermain HP" are one point; "jangan"/"hindari"/"tidak" are left out of
// the comparison, but a negative and a positive statement ("boleh" vs "tidak boleh") are never merged.
const NEGATION_RE = /\b(tidak|bukan|belum|tanpa|jangan|hindari|hindarilah|dilarang|not|no|never|without|avoid|don't|dont)\b/i;
const DUPLICATE_IGNORE = new Set(['tidak', 'bukan', 'belum', 'tanpa', 'jangan', 'hindari', 'hindarilah', 'dilarang', 'not', 'never', 'without', 'avoid', 'dont', 'ia']);
const DUPLICATE_LIMITS = { containment: 0.8, jaccard: 0.6, minWords: 2 };
function contentStems(text, lang) {
  const neutral = NEUTRAL[lang] || new Set();
  return wordsOf(text).filter(w => w.length >= 2 && !STOPWORDS.has(w) && !neutral.has(w) && !DUPLICATE_IGNORE.has(w))
    .map(w => (lang === 'id' || lang === 'en' ? stemsOf(w, lang) : new Set([w])));
}
function isDuplicatePoint(a, b, lang) {
  if (NEGATION_RE.test(a) !== NEGATION_RE.test(b)) return false;
  // v2.60.3: points with different numbers carry different facts ("Sesi pertama diikuti 46 partisipan" vs a merged "Sesi pertama
  // ... partisipan" without the 46): never merged, so the protect step's number is not dropped again.
  const da = digitTokens(a);
  const db = digitTokens(b);
  if (da.size !== db.size || [...da].some(d => !db.has(d))) return false;
  const A = contentStems(a, lang);
  const B = contentStems(b, lang);
  if (Math.min(A.length, B.length) < DUPLICATE_LIMITS.minWords) return false;
  const [small, big] = A.length <= B.length ? [A, B] : [B, A];
  const overlap = small.filter(s => big.some(t => [...s].some(x => t.has(x)))).length;
  return overlap / small.length >= DUPLICATE_LIMITS.containment || overlap / (A.length + B.length - overlap) >= DUPLICATE_LIMITS.jaccard;
}
// Keeps the more informative point of every near-duplicate pair (more content words, then the longer text): { topics, duplicatePoints, droppedTopics }.
function removeDuplicatePoints(topics, lang) {
  const all = [];
  topics.forEach((t, ti) => t.points.forEach(p => all.push({ ti, p, size: contentStems(p, lang).length, removed: false })));
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length && !all[i].removed; j++) {
      if (all[j].removed || !isDuplicatePoint(all[i].p, all[j].p, lang)) continue;
      const iWins = all[i].size > all[j].size || (all[i].size === all[j].size && all[i].p.length >= all[j].p.length);
      const loser = iWins ? all[j] : all[i];
      loser.removed = true;
      console.warn(`  duplicate point dropped: ${loser.p}`);
    }
  }
  const kept = topics.map((t, ti) => ({ title: t.title, points: all.filter(x => x.ti === ti && !x.removed).map(x => x.p) })).filter(t => t.points.length);
  return { topics: kept, duplicatePoints: all.filter(x => x.removed).length, droppedTopics: topics.length - kept.length };
}

// The overall summary of a topic summary is repaired deterministically before it is judged (no extra Gemma call):
//  1. a sentence that opens with the kind of recording ("Rekaman ini membahas ...", "Rapat ini mencakup ...", "This video discusses
//     ...") gets a neutral opener ("Pembahasan (juga) mencakup ..." / "The discussion (also) covers ...") - also when the recording
//     IS a meeting; validateAnswer rejects "rekaman/video/transkrip ini" as a meta phrase;
//  2. if it still fails, the sentences with a meta phrase or a forbidden event word ("rapat" in a podcast) are left out, as long as
//     at least 40 characters remain and the rest passes validateAnswer.
// { text, repaired, removed } or { reason } (= the summary fails).
// v2.60.3: an agenda / block summary also opened with "Agenda ini / Bagian ini / Potongan ini ..." ("This agenda / section ...").
const META_OPENER_ID_RE = /^(?:dalam\s+)?(?:rekaman|video|transkrip|rapat|pertemuan|diskusi|podcast|percakapan|wawancara|agenda|bagian|potongan)\s+(?:ini|tersebut)\s+(juga\s+)?(?:membahas|berisi|menjelaskan|mengulas|menyoroti|berfokus pada|mencakup|memuat|menekankan)\s+/i;
const META_OPENER_EN_RE = /^(?:in\s+)?(?:this|the)\s+(?:recording|video|transcript|meeting|discussion|podcast|conversation|interview|agenda|section)\s+(also\s+)?(?:discusses|covers|explains|describes|focuses on|highlights|contains|is about|emphasizes)\s+/i;
const sentencesOf = text => String(text).split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
function neutralOpener(sentence) {
  let m = META_OPENER_ID_RE.exec(sentence);
  if (m) return `Pembahasan ${m[1] ? 'juga ' : ''}mencakup ${sentence.slice(m[0].length)}`;
  m = META_OPENER_EN_RE.exec(sentence);
  if (m) return `The discussion ${m[1] ? 'also ' : ''}covers ${sentence.slice(m[0].length)}`;
  return sentence;
}
// v2.60.1: only the first sentence that opens with the neutral opener keeps "Pembahasan mencakup ..." / "The discussion covers
// ..."; later ones read "Pembahasan juga mencakup ..." / "The discussion also covers ..." (a summary joined from several agendas
// or blocks otherwise repeats the same opener). v2.60.3: the FIRST one never says "juga" / "also" (a podcast summary whose first
// block summary had failed started with "Pembahasan juga mencakup ...").
const NEUTRAL_OPENER_RE = /^(pembahasan|the discussion)\s+(juga\s+|also\s+)?(mencakup|covers)\s+/i;
function dedupeOpenerSentences(sentences) {
  let seen = false;
  return sentences.map(sentence => {
    const m = NEUTRAL_OPENER_RE.exec(sentence);
    if (!m) return sentence;
    const repeated = seen;
    seen = true;
    if (repeated === !!m[2]) return sentence; // a later one with "juga", or the first one without it
    const rest = sentence.slice(m[0].length);
    const en = /^the discussion$/i.test(m[1]);
    if (!repeated) return en ? `The discussion covers ${rest}` : `Pembahasan mencakup ${rest}`;
    return en ? `The discussion also covers ${rest}` : `Pembahasan juga mencakup ${rest}`;
  });
}
const dedupeOpeners = text => dedupeOpenerSentences(sentencesOf(text)).join(' ');
function repairSummary(summary, ctx) {
  const problem = text => validateAnswer({ summary: text, points: [] }, ctx.transcript, ctx.lang)
    || (!ctx.eventWordsAllowed && EVENT_WORD_RE.test(text) ? EVENT_REASON : null);
  const sentences = dedupeOpenerSentences(sentencesOf(summary).map(neutralOpener));
  const rewritten = sentences.join(' ');
  const reason = problem(rewritten);
  if (!reason) return { text: rewritten, repaired: rewritten !== summary, removed: 0 };
  const kept = sentences.filter(s => !META_RE.test(s) && (ctx.eventWordsAllowed || !EVENT_WORD_RE.test(s)));
  const text = kept.join(' ');
  if (kept.length < sentences.length && text.length >= 40 && !problem(text)) return { text, repaired: true, removed: sentences.length - kept.length };
  return { reason };
}

// Last resort of a merge whose topics are good but whose overall summary failed twice: one sentence made of the final topic
// titles (already fact-checked). Title Case words become lower case unless the transcript writes them capitalised (names).
function summaryFromTitles(topics, ctx) {
  const writtenCapitalised = w => {
    const word = w.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ''); // "(PX" / "Referral)" -> the word itself
    return word && new RegExp(`(^|[^\\p{L}])${word}([^\\p{L}]|$)`, 'u').test(ctx.transcript);
  };
  const titles = topics.map(t => t.title.split(/\s+/).map(w => (/^\p{Lu}\p{Ll}/u.test(w) && !writtenCapitalised(w) ? w.toLowerCase() : w)).join(' '));
  const and = ctx.lang === 'en' ? 'and' : 'dan';
  const list = titles.length === 1 ? titles[0] : `${titles.slice(0, -1).join(', ')}${titles.length > 2 ? ',' : ''} ${and} ${titles[titles.length - 1]}`;
  return ctx.lang === 'en' ? `The discussion covers ${list}.` : `Pembahasan mencakup ${list}.`;
}

// num_ctx for a prompt (about 3 characters per token) plus the answer, in steps of 8192 tokens.
const contextFor = (prompt, numPredict) => {
  const need = Math.ceil(String(prompt).length / 3) + numPredict + 256;
  return need <= 8192 ? 8192 : need <= 16384 ? 16384 : 32768;
};

// ------------------------------------------------------------------ v2.60.1: agendas of a meeting, blocks of many topics
// Two problems of the single merge, both seen on real recordings:
//   * a meeting with several agendas lost a whole agenda (it kept People Experience, Talent Factory was gone);
//   * 29 topics of a 52k-character podcast made Gemma loop ("token repeat limit") in the one merge call, twice.
// Agenda mode (meeting recordings only: ctx.eventWordsAllowed): per part ONE small call names the big agendas that START in it,
// each with a verbatim quote that must be found back in the transcript (nothing invented decides a boundary); one more small call
// groups those candidates into 1-3 agendas. The transcript is cut at the agenda starts, every segment is mapped with the unchanged
// map prompt and every agenda is merged on its own. Block merge (any long video with more than TOPIC_BLOCK_THRESHOLD map topics,
// and the fallback of a single merge without a usable attempt): runs of consecutive parts with at most TOPIC_BLOCK_SIZE topics are
// merged one by one. In both, a map topic whose words are mostly missing from the merged result is put back (coverage guard).
const MAX_AGENDAS = 3;
const AGENDA_MIN_SHARE = 0.15;         // an agenda shorter than this share of the transcript (or starting this close after the previous) joins its neighbour
const AGENDA_DETECT_OPTIONS = { numCtx: 8192, numPredict: 250 };
const AGENDA_GROUP_PREDICT = 200;
const QUOTE_MIN_WORDS = 4;             // a shorter quote cannot place a boundary
const QUOTE_MIN_MATCH = 0.6;           // share of the quote's words found in order in the best window of the transcript
const AGENDA_REFINE_CHARS = 1500;      // how far back the start may move to the announcement of the agenda
const AGENDA_REFINE_NEAR = 60;         // two of the agenda's own words within this many characters = the announcement
const TOPIC_BLOCK_THRESHOLD = 15;      // more map topics than this: merge in blocks instead of one call
const TOPIC_BLOCK_SIZE = 10;           // at most this many map topics per block (a part is never split)
// v2.60.3: 1300 (was 900) - up to 5 topics x 4 points + the summary, the size the schema spike ran with.
const GROUP_MERGE_PREDICT = 1300;
// Final topics/points per answer of one agenda / block (v2.60.3: 4 points, was 3), and the cap up to which the coverage guard
// and the protect step may add topics.
const GROUP_LIMITS = { agenda: { topics: 5, points: 4, cap: 6 }, block: { topics: 4, points: 4, cap: 5 } };
const COVERAGE_MIN = 0.35;

// `current` = the agenda found last in an earlier part ('' = none yet). Part 1 uses the spike's wording; a later part without any
// agenda found so far does not claim to be the first part.
function buildAgendaDetectPrompt(text, lang, index, total, current) {
  if (lang === 'id') {
    const running = current ? `Agenda besar yang sedang berjalan sejak bagian sebelumnya: "${current}".` : index === 1 ? 'Ini bagian pertama.' : 'Belum ada agenda besar yang ditandai di bagian sebelumnya.';
    const ask = current ? '' : index === 1 ? 'Untuk bagian pertama, sebut juga agenda pertama yang dibahas (bila jelas).\n' : 'Sebut juga agenda yang sedang dibahas di bagian ini (bila jelas).\n';
    return `Berikut bagian ${index} dari ${total} transkrip sebuah rekaman (hasil speech-to-text, bisa ada salah ketik).
${running}

Tugas: tentukan apakah di bagian ini pembicara MEMULAI AGENDA BESAR BARU. Agenda besar = proyek, program, atau pokok acara yang berbeda, yang diumumkan pembicara (misalnya "yang pertama ...", "update terkait project ...", "kita mulai untuk ...", "agenda berikutnya ..."), sering ditandai pergantian pembawa materi ("saya kembalikan ke ...").
BUKAN agenda baru: sub-topik dari proyek yang sama (misalnya bagian lain dari dashboard yang sama, parameter, tanya jawab, langkah berikutnya), atau sekadar pembicara berikutnya yang melanjutkan materi yang sama.
Rekaman yang tidak membahas proyek/program (podcast, video edukasi, cerita) biasanya hanya punya SATU agenda.
${ask}Untuk setiap agenda yang dimulai di bagian ini tulis:
- "nama": nama proyek/program 1 sampai 4 kata, memakai kata-kata dari transkrip;
- "kutipan": 5 sampai 12 kata yang disalin PERSIS dari transkrip, tempat agenda itu diumumkan.
Bila tidak ada agenda baru, jawab daftar kosong.
Jawab HANYA JSON: {"agenda_baru":[{"nama":"...","kutipan":"..."}]}

Transkrip:
"""
${text}
"""`;
  }
  const running = current ? `Major agenda running since the previous part: "${current}".` : index === 1 ? 'This is the first part.' : 'No major agenda was marked in the previous parts yet.';
  const ask = current ? '' : index === 1 ? 'For the first part also name the first agenda discussed (when clear).\n' : 'Also name the agenda discussed in this part (when clear).\n';
  return `Below is part ${index} of ${total} of the transcript of a recording (speech-to-text, may contain typos).
${running}

Task: decide whether in this part the speakers START A NEW MAJOR AGENDA. A major agenda = a different project, program or item of the session that a speaker announces (for example "the first one ...", "an update on project ...", "let's start with ...", "next agenda ..."), often marked by a change of presenter ("back to you ...").
NOT a new agenda: a sub-topic of the same project (for example another part of the same dashboard, parameters, questions and answers, next steps), or just the next speaker continuing the same material.
A recording that does not discuss projects/programs (podcast, educational video, story) usually has only ONE agenda.
${ask}For every agenda that starts in this part write:
- "name": the project/program name in 1 to 4 words, using words from the transcript;
- "quote": 5 to 12 words copied EXACTLY from the transcript, where the agenda is announced.
If there is no new agenda, answer an empty list.
Answer ONLY JSON: {"new_agendas":[{"name":"...","quote":"..."}]}

Transcript:
"""
${text}
"""`;
}

function buildAgendaGroupPrompt(candidates, transcriptLength, lang) {
  const at = c => Math.round(100 * c.pos / Math.max(transcriptLength, 1));
  if (lang === 'id') {
    return `Berikut kandidat agenda yang ditandai di sebuah transkrip, berurutan, dengan posisinya (persen dari panjang transkrip) dan kutipan tempat agenda itu diumumkan:
${candidates.map((c, k) => `${k + 1}. "${c.name}" (posisi ${at(c)}%): "${c.quote}"`).join('\n')}

Tugas: banyak kandidat di atas sebenarnya sub-topik dari proyek/program yang sama (misalnya "PX" = singkatan "People Experience"; dashboard, index, memo, parameter dari proyek yang sama). Tentukan AGENDA BESAR yang sebenarnya: proyek atau program yang benar-benar berbeda. Rapat update proyek biasanya punya 1 sampai 3 agenda besar; podcast, video edukasi, atau cerita hanya 1.
Untuk setiap agenda besar tulis "nama" (1 sampai 4 kata, dari nama kandidat) dan "mulai" = nomor kandidat tempat agenda itu dimulai (urut naik; agenda pertama mulai di nomor 1).
Jawab HANYA JSON: {"agenda":[{"nama":"...","mulai":1}]}`;
  }
  return `Below are the agenda candidates marked in a transcript, in order, with their position (percent of the transcript length) and the quote where the agenda was announced:
${candidates.map((c, k) => `${k + 1}. "${c.name}" (position ${at(c)}%): "${c.quote}"`).join('\n')}

Task: many candidates above are really sub-topics of the same project/program (for example an abbreviation of a longer name; dashboard, index, memo, parameters of the same project). Decide the real MAJOR AGENDAS: projects or programs that are really different. A project update meeting usually has 1 to 3 major agendas; a podcast, educational video or story only 1.
For every major agenda write "name" (1 to 4 words, from the candidate names) and "start" = the number of the candidate where that agenda starts (ascending; the first agenda starts at number 1).
Answer ONLY JSON: {"agendas":[{"name":"...","start":1}]}`;
}

// Every word of the transcript with its character position: [{ w, at }].
const wordPositions = text => [...String(text || '').matchAll(/[\p{L}\d]+/gu)].map(m => ({ w: m[0].toLowerCase(), at: m.index }));

// Character position in the ORIGINAL transcript where `quote` starts: the window of the quote's length with the most words equal
// in place, accepted when at least QUOTE_MIN_MATCH of the quote's words match. null = not found (the candidate is dropped).
// `source` = the transcript or its wordPositions().
function locateQuote(quote, source) {
  const words = Array.isArray(source) ? source : wordPositions(source);
  const q = String(quote || '').toLowerCase().match(/[\p{L}\d]+/gu) || [];
  if (q.length < QUOTE_MIN_WORDS || q.length > words.length) return null;
  let best = 0;
  let at = -1;
  for (let i = 0; i + q.length <= words.length; i++) {
    let hit = 0;
    for (let k = 0; k < q.length; k++) if (words[i + k].w === q[k]) hit++;
    if (hit > best) { best = hit; at = i; if (hit === q.length) break; }
  }
  return at >= 0 && best / q.length >= QUOTE_MIN_MATCH ? words[at].at : null;
}

// The words that name an agenda, folded (lower case, no punctuation) and without generic words: "Update Talent Factory Project"
// and "talent factory" name the same agenda.
const AGENDA_GENERIC = new Set(['project', 'proyek', 'projek', 'program', 'update', 'agenda', 'terkait', 'dengan', 'untuk',
  'the', 'and', 'for', 'with', 'about', 'related']);
const agendaNameWords = name => [...new Set(String(name || '').toLowerCase().split(/[^\p{L}\d]+/u).filter(w => w.length >= 3 && !AGENDA_GENERIC.has(w)))];
function sameAgendaName(a, b) {
  const A = agendaNameWords(a);
  const B = agendaNameWords(b);
  if (!A.length || !B.length) return false;
  const [small, large] = A.length <= B.length ? [A, B] : [B, A];
  return small.every(w => large.includes(w));
}
const agendaName = v => trimTo(cleanLine(textOf(v)).replace(/[.:]+$/, ''), 60);

// The quote can sit a little after the real announcement ("update terkait dengan Project Talent Factory ... ini untuk yang graduate
// talent factory project"): the start moves back, at most AGENDA_REFINE_CHARS, to the earliest place where two of the agenda's own
// words occur within AGENDA_REFINE_NEAR characters. A one-word name keeps the quote position.
function refineAgendaStart(name, pos, transcript) {
  const words = agendaNameWords(name);
  if (words.length < 2) return pos;
  const from = Math.max(0, pos - AGENDA_REFINE_CHARS);
  const win = String(transcript).slice(from, pos + 200).toLowerCase();
  const hits = [];
  words.forEach(w => { for (let i = win.indexOf(w); i >= 0; i = win.indexOf(w, i + 1)) hits.push({ w, i }); });
  hits.sort((a, b) => a.i - b.i);
  const first = hits.find(h => hits.some(o => o.w !== h.w && Math.abs(o.i - h.i) <= AGENDA_REFINE_NEAR));
  return first ? Math.min(pos, from + first.i) : pos;
}

// An agenda shorter than AGENDA_MIN_SHARE of the transcript, or starting less than that after the previous one, joins its
// neighbour (its start is dropped, so its text belongs to the agenda before it). [{ name, pos }] in order -> a new list.
function applyAgendaMinShare(agendas, length) {
  const out = agendas.map(a => ({ ...a }));
  for (let k = out.length - 1; k >= 1; k--) {
    const end = k + 1 < out.length ? out[k + 1].pos : length;
    if ((end - out[k].pos) / length < AGENDA_MIN_SHARE || (out[k].pos - out[k - 1].pos) / length < AGENDA_MIN_SHARE) out.splice(k, 1);
  }
  return out;
}

// The model's grouping ([{ nama|name, mulai|start }]) -> agendas [{ name, pos }] in recording order. The start of an agenda is the
// FIRST candidate with the same name words; the model's candidate number is only a fallback (it was off by one in the spike).
// A name that fails the title check is dropped. The FIRST agenda the model lists starts at 0 (it names the opening agenda: in the
// real meeting a sub-candidate "Bal Experience" sat a little before "People Experience" and must not take its place); at most
// MAX_AGENDAS; then the share guard.
function agendasFromGroups(list, candidates, ctx) {
  if (!Array.isArray(list)) return [];
  const transcript = String(ctx.transcript || '');
  const agendas = list.filter(a => a && typeof a === 'object').map(a => {
    const name = agendaName(fieldOf(a, ['nama', 'name']));
    const start = candidates.find(c => sameAgendaName(c.name, name)) || candidates[Number(fieldOf(a, ['mulai', 'start'])) - 1];
    return { name, start };
  }).filter(a => a.name && a.start && !fragmentProblem(a.name, ctx, 'title'))
    .map((a, k) => ({ name: a.name, pos: k === 0 ? 0 : refineAgendaStart(a.name, a.start.pos, transcript) }))
    .sort((a, b) => a.pos - b.pos)
    .filter((a, k, arr) => k === 0 || a.pos > arr[k - 1].pos)
    .slice(0, MAX_AGENDAS);
  if (agendas.length) agendas[0].pos = 0;
  return applyAgendaMinShare(agendas, transcript.length);
}

// Detect (one call per part) + group (one call, only with 2+ candidates) -> [{ name, pos }]; fewer than 2 = no agenda mode.
async function findAgendas(media, lang, ctx, parts, deadline, stats) {
  const positions = wordPositions(ctx.transcript);
  const candidates = [];
  let current = '';
  for (let i = 0; i < parts.length; i++) {
    stats.detect_calls++;
    // A soft failure (aborted / empty answer) = no candidates for this part; hard errors throw like every other call.
    const raw = await askModelOrNull(buildAgendaDetectPrompt(parts[i], lang, i + 1, parts.length, current), media, deadline,
      { seed: TOPIC_SEEDS[0], format: agendaDetectSchema(lang), ...AGENDA_DETECT_OPTIONS }, stats);
    const list = fieldOf(parseJsonAnswer(raw), ['agenda_baru', 'new_agendas']);
    (Array.isArray(list) ? list : []).forEach(a => {
      const name = agendaName(fieldOf(a, ['nama', 'name']));
      if (!name || fragmentProblem(name, ctx, 'title')) return;
      const quote = cleanLine(textOf(fieldOf(a, ['kutipan', 'quote'])));
      const pos = locateQuote(quote, positions);
      if (pos === null) return;
      candidates.push({ name, quote, pos });
      current = name;
    });
  }
  candidates.sort((a, b) => a.pos - b.pos);
  stats.agenda_candidates = candidates.length;
  if (candidates.length < 2) return [];
  const prompt = buildAgendaGroupPrompt(candidates, ctx.transcript.length, lang);
  const raw = await askModelOrNull(prompt, media, deadline,
    { seed: TOPIC_SEEDS[0], format: agendaGroupSchema(lang), numCtx: contextFor(prompt, AGENDA_GROUP_PREDICT), numPredict: AGENDA_GROUP_PREDICT }, stats);
  return agendasFromGroups(fieldOf(parseJsonAnswer(raw), ['agenda', 'agendas']), candidates, ctx);
}

// Runs of consecutive parts with at most `size` map topics each: the fewest blocks, then the most even sizes (a part is never
// split; a single part with more topics than `size` is a block of its own). [{ part, ... }] in part order -> [[topic, ...], ...].
function topicBlocks(mapped, size = TOPIC_BLOCK_SIZE) {
  const parts = [];
  mapped.forEach(t => {
    const last = parts[parts.length - 1];
    if (last && last.part === t.part) last.items.push(t); else parts.push({ part: t.part, items: [t] });
  });
  const n = parts.length;
  if (!n) return [];
  const prefix = [0];
  parts.forEach(p => prefix.push(prefix[prefix.length - 1] + p.items.length));
  const sizeOf = (a, b) => prefix[b] - prefix[a];
  // cost[b][j] = smallest sum of squared block sizes covering the first j parts with b blocks
  const cost = Array.from({ length: n + 1 }, () => new Array(n + 1).fill(Infinity));
  const from = Array.from({ length: n + 1 }, () => new Array(n + 1).fill(-1));
  cost[0][0] = 0;
  for (let b = 1; b <= n; b++) {
    for (let j = b; j <= n; j++) {
      for (let i = b - 1; i < j; i++) {
        if (cost[b - 1][i] === Infinity || (j - i > 1 && sizeOf(i, j) > size)) continue;
        const c = cost[b - 1][i] + sizeOf(i, j) ** 2;
        if (c < cost[b][j]) { cost[b][j] = c; from[b][j] = i; }
      }
    }
    if (cost[b][n] < Infinity) {
      const blocks = [];
      for (let j = n, k = b; k > 0; j = from[k][j], k--) blocks.unshift(parts.slice(from[k][j], j).flatMap(p => p.items));
      return blocks;
    }
  }
  return [mapped];
}

// Coverage guard: the share of a map topic's word prefixes (first 6 letters of its words of 5+ letters, title and points) that
// occur anywhere in the merged topics. Topics below COVERAGE_MIN are put back as they are (lowest coverage first, title checked)
// while the group has fewer than `cap` topics; then every topic is ordered by the part it comes from (merged topics: the input
// topic sharing the most prefixes), keeping the merge's own order within a part. { topics, restored }.
const prefixesOf = topic => new Set([topic.title, ...topic.points].join(' ').toLowerCase().split(/[^\p{L}\d]+/u).filter(w => w.length >= 5).map(w => w.slice(0, 6)));
function coverageOf(topic, covered) {
  const own = prefixesOf(topic);
  if (!own.size) return 1;
  return [...own].filter(p => covered.has(p)).length / own.size;
}
// The part a merged topic comes from: the input topic sharing the most prefixes with it.
function topicPart(topic, items) {
  const own = prefixesOf(topic);
  let best = { part: Infinity, score: -1 };
  items.forEach(it => {
    const score = [...prefixesOf(it)].filter(p => own.has(p)).length;
    if (score > best.score) best = { part: it.part, score };
  });
  return best.part;
}
function restoreCoverage(topics, items, cap, ctx) {
  const out = topics.map((topic, order) => ({ topic, part: topicPart(topic, items), order }));
  const covered = () => new Set(out.flatMap(o => [...prefixesOf(o.topic)]));
  const low = items.map(it => ({ it, cov: coverageOf(it, covered()) })).filter(x => x.cov < COVERAGE_MIN).sort((a, b) => a.cov - b.cov);
  let restored = 0;
  for (const { it } of low) {
    if (out.length >= cap) break;
    if (coverageOf(it, covered()) >= COVERAGE_MIN || fragmentProblem(it.title, ctx, 'title')) continue; // covered by an earlier one / title fails
    out.push({ topic: { title: it.title, points: [...it.points] }, part: it.part, order: out.length });
    restored++;
  }
  out.sort((a, b) => a.part - b.part || a.order - b.order);
  return { topics: out.map(o => o.topic), restored };
}

// ------------------------------------------------------------------ v2.60.3: protect step (after every merge)
// Measured on a real meeting: the map topics held 64-84% of the points of the manual minutes, the merged result only 34-48% -
// the merge "summarised away" numbers, decisions and targets. A map point (already fact-checked by checkTopics in the map step) that
// holds a digit, a month name or a decision / target / progress word is PROTECTED: when less than PROTECT_KEEP of its word prefixes
// (first 6 letters of its words of 4+ letters) occur anywhere in the final topics, or one of its numbers (digits) does not occur there
// (real run: "Sesi pertama diikuti 46 partisipan" kept its words in a merged point, but not the 46), it is put back - into the most similar final topic
// (most prefixes shared with the map title + point) while that topic has fewer than PROTECT_TOPIC_POINTS points, otherwise as a
// topic of its own with the map title (title checked, in recording order, only below the cap). Deterministic, no extra Gemma call.
const PROTECT_RE = /\d|\b(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|january|february|march|june|july|august|october|december|setuju|disetujui|disepakati|target|ditargetkan|tindak\s+lanjut|selesai|complete|completed|minggu\s+(?:ini|depan|lalu)|tahun\s+depan|agreed|approved|decided|targeted|follow[-\s]ups?|finished|(?:this|next|last)\s+week|next\s+year)\b/i; // "may" left out: an English modal verb
const PROTECT_KEEP = 0.6;
const PROTECT_TOPIC_POINTS = 5;
const protectPrefixes = text => new Set(String(text).toLowerCase().split(/[^\p{L}\d]+/u).filter(w => w.length >= 4).map(w => w.slice(0, 6)));
const topicText = t => [t.title, ...t.points].join(' ');
const isProtectedPoint = text => PROTECT_RE.test(String(text || ''));
// topics = the final topics of one merge, items = the map topics it was given ([{ part, title, points }]). { topics, restored }.
function protectPoints(topics, items, cap, ctx) {
  const out = topics.map(t => ({ ...t, points: [...t.points] }));
  let restored = 0;
  for (const it of items) {
    for (const p of it.points) {
      if (!isProtectedPoint(p)) continue;
      const own = protectPrefixes(p);
      const presentText = out.map(topicText).join(' ');
      const present = protectPrefixes(presentText);
      const presentDigits = digitTokens(presentText);
      const wordsKept = !own.size || [...own].filter(x => present.has(x)).length / own.size >= PROTECT_KEEP;
      if (wordsKept && [...digitTokens(p)].every(d => presentDigits.has(d))) continue; // still there
      if (isFillerPoint(p, ctx) || fragmentProblem(p, ctx, 'point')) continue; // never put back what the fact check refuses
      const probe = protectPrefixes(`${it.title} ${p}`);
      let best = -1;
      let bestScore = 0;
      out.forEach((t, k) => {
        const score = [...protectPrefixes(topicText(t))].filter(x => probe.has(x)).length;
        if (score > bestScore) { best = k; bestScore = score; }
      });
      if (best >= 0 && out[best].points.length < PROTECT_TOPIC_POINTS) {
        out[best].points.push(p);
        restored++;
        continue;
      }
      if (out.length >= cap || fragmentProblem(it.title, ctx, 'title')) continue; // the map step did not check its titles
      const at = out.reduce((pos, t, k) => (topicPart(t, items) <= it.part ? k + 1 : pos), 0); // after the last topic of an earlier/same part
      out.splice(at, 0, { title: it.title, points: [p] });
      restored++;
    }
  }
  return { topics: out, restored };
}

const pointCount = topics => topics.reduce((n, t) => n + t.points.length, 0);

// One agenda or block: { kind, name?, items } -> { topics, summary } (summary '' = none passed). Attempt 1 seed 41, attempt 2 seed
// 42 + REPEAT_GUARD; an attempt is accepted with >= min(input topics, 2) topics and >= min(input points, 4) points after the checks.
// The accepted attempt with the most points wins; the first passing summary is kept as a spare. No accepted attempt: the map
// topics themselves (titles checked, deduplicated, capped). Then the coverage guard, then the protect step (v2.60.3: it only adds
// points that are still missing after the coverage guard, so the two never insert the same point), then the duplicate filter.
async function mergeGroup(media, lang, ctx, group, deadline, stats) {
  const { items } = group;
  const limits = GROUP_LIMITS[group.kind];
  const need = { topics: Math.min(items.length, 2), points: Math.min(pointCount(items), 4) };
  const label = group.kind === 'agenda' ? `agenda "${group.name}"` : `block ${group.index}/${group.total}`;
  const format = topicSchema(lang, { minTopics: Math.min(2, items.length), maxTopics: limits.topics, maxPoints: limits.points, withSummary: true });
  let best = null;
  let spare = null;
  for (let attempt = 1; attempt <= 2 && !(best && !best.fix.reason); attempt++) {
    stats.merge_attempts++;
    const prompt = buildTopicMergePrompt(items, lang, '', group);
    const res = await askModelOrNull(prompt, media, deadline,
      { seed: TOPIC_SEEDS[attempt - 1], format, numCtx: contextFor(prompt, GROUP_MERGE_PREDICT), numPredict: GROUP_MERGE_PREDICT, ...(attempt === 2 ? REPEAT_GUARD : {}), details: true }, stats);
    const answer = parseJsonAnswer(res && res.text);
    const rawSummary = cleanLine(textOf(fieldOf(answer, ['ringkasan', 'summary'])));
    const checked = checkTopics(normalizeTopics(fieldOf(answer, ['topik', 'topics']), limits), ctx);
    const unique = removeDuplicatePoints(checked.topics, lang);
    if (res && (!rawSummary || !unique.topics.length)) logUnusableAnswer(media, `${label} merge attempt ${attempt}`, res);
    const fix = rawSummary ? repairSummary(rawSummary, ctx) : { reason: res ? 'no summary' : ABORTED_REASON };
    if (!fix.reason && !spare) spare = fix;
    const points = pointCount(unique.topics);
    if (unique.topics.length >= need.topics && points >= need.points && (!best || points > best.points)) best = { checked, unique, points, fix };
  }
  let topics;
  if (best) {
    topics = best.unique.topics;
    stats.dropped_points += best.checked.droppedPoints;
    stats.dropped_topics += best.checked.droppedTopics + best.unique.droppedTopics;
    stats.filler_points += best.checked.fillerPoints;
    stats.duplicate_points += best.unique.duplicatePoints;
  } else {
    console.warn(`AI topic summary for ${media.media_id}: ${label} gave no acceptable merge - its map topics are used`);
    const checked = checkTopics(items.map(t => ({ title: t.title, points: t.points })), ctx); // the map step did not check titles
    const unique = removeDuplicatePoints(checked.topics, lang);
    topics = unique.topics.slice(0, limits.cap);
    stats.dropped_topics += checked.droppedTopics;
    stats.duplicate_points += unique.duplicatePoints;
  }
  const covered = restoreCoverage(topics, items, limits.cap, ctx);
  stats.coverage_restored += covered.restored;
  const kept = protectPoints(covered.topics, items, limits.cap, ctx);
  stats.protected_points += kept.restored;
  const final = removeDuplicatePoints(kept.topics, lang);
  stats.duplicate_points += final.duplicatePoints;
  const summaryFix = best && !best.fix.reason ? best.fix : spare;
  if (summaryFix) {
    stats.summary_repaired += summaryFix.repaired ? 1 : 0;
    stats.summary_sentences_removed += summaryFix.removed;
  }
  return { topics: final.topics, summary: summaryFix ? summaryFix.text : '' };
}

// Merges the groups one after the other: agenda topics carry `agenda` (the agenda name), block topics do not. The overall summary
// joins the groups' summaries in order (repeated openers -> "juga"). A group whose summary failed twice adds one sentence made of
// its own topic titles (as in the spike - otherwise the overall summary silently skips that agenda); none at all -> all titles.
async function mergeGroups(media, lang, ctx, groups, deadline, stats) {
  const topics = [];
  const sentences = [];
  for (const group of groups) {
    const merged = await mergeGroup(media, lang, ctx, group, deadline, stats);
    merged.topics.forEach(t => topics.push(group.kind === 'agenda' ? { agenda: group.name, title: t.title, points: t.points } : { title: t.title, points: t.points }));
    if (merged.summary) sentences.push(merged.summary);
    else if (merged.topics.length) {
      const fromTitles = summaryFromTitles(merged.topics, ctx);
      if (!fragmentProblem(fromTitles, ctx, 'title')) { sentences.push(fromTitles); stats.summary_from_titles++; }
    }
  }
  if (topics.length < TOPIC_MIN_FINAL) {
    console.warn(`AI topic summary for ${media.media_id}: only ${topics.length} topic(s) after the ${groups[0] ? groups[0].kind : 'group'} merge - older path`);
    return null;
  }
  let summary = dedupeOpeners(sentences.join(' '));
  if (!summary) {
    summary = summaryFromTitles(topics, ctx);
    if (fragmentProblem(summary, ctx, 'title')) return null;
    stats.summary_from_titles++;
  }
  return { summary, points: topics.map(t => `${t.title}: ${t.points[0]}`), topics, stats: { ...stats } };
}

async function mergeInBlocks(media, lang, ctx, mapped, deadline, stats) {
  const blocks = topicBlocks(mapped);
  stats.blocks = blocks.length;
  return mergeGroups(media, lang, ctx, blocks.map((items, k) => ({ kind: 'block', index: k + 1, total: blocks.length, items })), deadline, stats);
}

// Map step: every part -> 1-3 topics (2-4 with 2-3 points for a part of TOPIC_SHORT_PART_CHARS+); an unusable answer is asked again ONCE
// (seed 42 + "PASTI berisi pembahasan" + REPEAT_GUARD), still empty -> the part is skipped. Invented points are dropped here already, so they never reach a merge.
// parts = [{ text, agenda? }] -> [{ part, agenda?, title, points }] (part = 1-based position in `parts`).
async function mapTopicParts(media, lang, ctx, parts, deadline, stats) {
  const mapped = [];
  for (let i = 0; i < parts.length; i++) {
    let topics = [];
    for (let attempt = 1; attempt <= 2 && !topics.length; attempt++) {
      if (attempt === 2) stats.retried_parts++;
      const res = await askModelOrNull(buildTopicPartPrompt(parts[i].text, lang, i + 1, parts.length, attempt === 2), media, deadline,
        { seed: TOPIC_SEEDS[attempt - 1], format: mapSchema(parts[i].text, lang), ...TOPIC_MAP_OPTIONS, ...(attempt === 2 ? REPEAT_GUARD : {}), details: true }, stats);
      topics = normalizeTopics(fieldOf(parseJsonAnswer(res && res.text), ['topik', 'topics']), TOPIC_PART_LIMITS);
      if (res && !topics.length) logUnusableAnswer(media, `part ${i + 1}/${parts.length} attempt ${attempt}`, res);
    }
    if (!topics.length) {
      stats.skipped_parts++;
      console.warn(`AI topic summary for ${media.media_id}: part ${i + 1}/${parts.length} gave no topics twice - skipped`);
      continue;
    }
    const checked = checkTopics(topics, ctx, false);
    stats.dropped_points += checked.droppedPoints;
    stats.dropped_topics += checked.droppedTopics;
    stats.filler_points += checked.fillerPoints;
    checked.topics.forEach(t => mapped.push(parts[i].agenda === undefined ? { part: i + 1, ...t } : { part: i + 1, agenda: parts[i].agenda, ...t }));
  }
  return mapped;
}

// The single merge of v2.60.0 (all map topics in one call, 4-8 topics + a 3-5 sentence summary): result or null.
// v2.60.3: then the protect step (up to TOPIC_FINAL_LIMITS.topics topics) and the duplicate filter.
async function mergeAllTopics(media, lang, ctx, mapped, deadline, stats) {
  const result = (summaryFix, checked, unique, fromTitles = 0) => {
    const kept = protectPoints(unique.topics, mapped, TOPIC_FINAL_LIMITS.topics, ctx);
    const final = removeDuplicatePoints(kept.topics, lang);
    return {
      summary: summaryFix.text,
      points: final.topics.map(t => `${t.title}: ${t.points[0]}`), // compatibility: PPT and older readers use summary/summary_points
      topics: final.topics,
      stats: {
        ...stats,
        dropped_points: stats.dropped_points + checked.droppedPoints,
        dropped_topics: stats.dropped_topics + checked.droppedTopics + unique.droppedTopics + final.droppedTopics,
        filler_points: stats.filler_points + checked.fillerPoints,
        duplicate_points: unique.duplicatePoints + final.duplicatePoints,
        summary_repaired: summaryFix.repaired ? 1 : 0,
        summary_sentences_removed: summaryFix.removed,
        summary_from_titles: fromTitles,
        protected_points: stats.protected_points + kept.restored
      }
    };
  };
  const format = topicSchema(lang, { minTopics: Math.min(4, mapped.length), maxTopics: TOPIC_FINAL_LIMITS.topics, maxPoints: TOPIC_FINAL_LIMITS.points, withSummary: true });
  // An attempt with good topics but a failing summary is kept (best = most topics), as is a passing summary of an attempt whose
  // topics failed: the merge only gives up when NO attempt gave TOPIC_MIN_FINAL valid topics.
  let best = null;
  let spareSummary = null;
  let feedback = '';
  let reason = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    stats.merge_attempts = attempt;
    const prompt = buildTopicMergePrompt(mapped, lang, feedback);
    const res = await askModelOrNull(prompt, media, deadline,
      { seed: TOPIC_SEEDS[attempt - 1], format, numCtx: contextFor(prompt, TOPIC_MERGE_PREDICT), numPredict: TOPIC_MERGE_PREDICT, ...(attempt === 2 ? REPEAT_GUARD : {}), details: true }, stats);
    const answer = parseJsonAnswer(res && res.text);
    const rawSummary = cleanLine(textOf(fieldOf(answer, ['ringkasan', 'summary'])));
    const topics = normalizeTopics(fieldOf(answer, ['topik', 'topics']), TOPIC_FINAL_LIMITS);
    if (res && (!rawSummary || !topics.length)) logUnusableAnswer(media, `merge attempt ${attempt}`, res);
    const checked = checkTopics(topics, ctx);
    const unique = removeDuplicatePoints(checked.topics, lang);
    const topicsOk = unique.topics.length >= TOPIC_MIN_FINAL;
    const summaryFix = rawSummary ? repairSummary(rawSummary, ctx) : { reason: res ? 'jawaban bukan JSON lengkap dengan "ringkasan" dan "topik"' : ABORTED_REASON };
    if (topicsOk && !summaryFix.reason) return result(summaryFix, checked, unique);
    if (!summaryFix.reason && !spareSummary) spareSummary = summaryFix;
    if (topicsOk && (!best || unique.topics.length > best.unique.topics.length)) best = { checked, unique };
    reason = [summaryFix.reason, topicsOk ? '' : `hanya ${unique.topics.length} topik yang lolos pemeriksaan (poinnya memuat angka/nama/kata yang tidak ada di transkrip, atau poin kosong/berulang)`]
      .filter(Boolean).join('; ');
    feedback = reason;
  }
  if (best) {
    if (spareSummary) return result(spareSummary, best.checked, best.unique);
    const text = summaryFromTitles(best.unique.topics, ctx);
    if (!fragmentProblem(text, ctx, 'title')) {
      console.warn(`AI topic summary for ${media.media_id}: overall summary failed twice (${reason}) - built from the topic titles`);
      return result({ text, repaired: false, removed: 0 }, best.checked, best.unique, 1);
    }
  }
  console.warn(`AI topic summary for ${media.media_id}: single merge rejected (${reason})`);
  return null;
}

// { summary, points, topics, stats } that passed the checks, or null (= continue on the older path). Throws on Ollama
// problems / the job's time limit (-> rule-based summary), like summarizeWithAi.
//   meeting (ctx.eventWordsAllowed) with 2+ agendas -> agenda mode (map per agenda segment, merge per agenda);
//   otherwise map all parts -> <= TOPIC_BLOCK_THRESHOLD topics: the single merge, falling back to blocks; more: blocks.
async function summarizeByTopics(media, lang, deadline) {
  const transcript = media.transcript;
  const parts = splitTranscript(transcript, TOPIC_PART_CHARS);
  if (parts.length > TOPIC_MAX_PARTS) return null;
  const ctx = buildCheckContext(transcript, lang, media.file_name);
  const stats = { parts: parts.length, retried_parts: 0, skipped_parts: 0, dropped_points: 0, dropped_topics: 0, merge_attempts: 0, aborted_answers: 0,
    filler_points: 0, duplicate_points: 0, summary_repaired: 0, summary_sentences_removed: 0, summary_from_titles: 0,
    agenda_mode: false, agendas: [], detect_calls: 0, agenda_candidates: 0, blocks: 0, coverage_restored: 0, protected_points: 0 };

  const agendas = ctx.eventWordsAllowed ? await findAgendas(media, lang, ctx, parts, deadline, stats) : [];
  if (agendas.length >= 2) {
    stats.agenda_mode = true;
    stats.agendas = agendas.map(a => a.name);
    // Cut at the agenda starts: no part crosses an agenda.
    const segmentParts = [];
    agendas.forEach((a, k) => {
      const segment = transcript.slice(a.pos, k + 1 < agendas.length ? agendas[k + 1].pos : transcript.length);
      splitTranscript(segment, TOPIC_PART_CHARS).forEach(text => segmentParts.push({ text, agenda: k }));
    });
    stats.parts = segmentParts.length;
    const mapped = await mapTopicParts(media, lang, ctx, segmentParts, deadline, stats);
    if (mapped.length < TOPIC_MIN_MAPPED) {
      console.warn(`AI topic summary for ${media.media_id}: only ${mapped.length} topic(s) from ${segmentParts.length} agenda parts - older path`);
      return null;
    }
    const groups = agendas.map((a, k) => ({ kind: 'agenda', name: a.name, items: mapped.filter(t => t.agenda === k) })).filter(g => g.items.length);
    return mergeGroups(media, lang, ctx, groups, deadline, stats);
  }

  const mapped = await mapTopicParts(media, lang, ctx, parts.map(text => ({ text })), deadline, stats);
  if (mapped.length < TOPIC_MIN_MAPPED) {
    console.warn(`AI topic summary for ${media.media_id}: only ${mapped.length} topic(s) from ${parts.length} parts - older path`);
    return null;
  }
  if (mapped.length <= TOPIC_BLOCK_THRESHOLD) {
    const single = await mergeAllTopics(media, lang, ctx, mapped, deadline, stats);
    if (single) return single;
    console.warn(`AI topic summary for ${media.media_id}: merging in blocks instead`);
  }
  const blocks = await mergeInBlocks(media, lang, ctx, mapped, deadline, stats);
  if (!blocks) console.warn(`AI topic summary for ${media.media_id}: block merge gave no result - older path`);
  return blocks;
}

async function runSummaryJob(media_id) {
  const media = await storage.getMediaById(media_id);
  if (!media || !media.transcript) return;
  const lang = summaryLanguageFor(media.transcript_language);
  const deadline = Date.now() + SUMMARY_JOB_TIMEOUT_MS; // one budget for the whole job, also when topic mode hands over
  let result;
  let source = 'AI';
  let error = '';
  try {
    result = (usesTopicMode(media.transcript) ? await summarizeByTopics(media, lang, deadline) : null) || await summarizeWithAi(media, lang, deadline);
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
    summary_topics: source === 'AI' && result.topics ? result.topics : null, // null = standard summary (also clears old topics)
    summary_topic_stats: source === 'AI' && result.stats ? result.stats : null,
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
      summary: null, summary_points: [], summary_topics: null, summary_topic_stats: null, summary_status: 'INSUFFICIENT', summary_source: null, summary_model: null,
      summary_language: summaryLanguageFor(media.transcript_language), summary_generated_at: new Date().toISOString(),
      summary_error: `The transcript is not long enough to summarize (fewer than ${MIN_WORDS} words).`
    });
    await finalizeMediaFileName(media_id); // final state: the file gets its original name (no-op while the transcript job still runs)
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
    // The summary (or its failure) is the last step of the pipeline: the video file gets its original upload name.
    // This job is still "running" on the queue here, hence ignoreSummaryJob.
    await finalizeMediaFileName(media_id, { ignoreSummaryJob: true });
  });
  if (outcome === 'full') {
    const result = ruleBasedSummary(media.transcript);
    await storage.updateMedia(media_id, {
      summary: result.summary, summary_points: result.points, summary_topics: null, summary_topic_stats: null, summary_status: 'DONE', summary_source: 'RULE', summary_model: null,
      summary_language: summaryLanguageFor(media.transcript_language), summary_generated_at: new Date().toISOString(),
      summary_error: 'The AI queue is full; press "Regenerate summary" later.'
    });
    await finalizeMediaFileName(media_id);
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
  SUMMARY_JOB_TIMEOUT_MS,
  queueMediaSummary,
  resumeInterruptedSummaries,
  isSummaryInFlight,
  summaryLanguageFor,
  isTranscriptSufficient,
  splitTranscript,
  summarizeWithAi,
  summarizeByTopics,
  usesTopicMode,
  buildTopicPartPrompt,
  buildTopicMergePrompt,
  parseJsonAnswer,
  normalizeTopics,
  buildCheckContext,
  fragmentProblem,
  checkTopics,
  isFillerPoint,
  isDuplicatePoint,
  removeDuplicatePoints,
  repairSummary,
  dedupeOpeners,
  summaryFromTitles,
  contextFor,
  TOPIC_PART_CHARS,
  TOPIC_MAX_PARTS,
  TOPIC_PART_LIMITS,
  TOPIC_FINAL_LIMITS,
  // v2.60.1: agenda mode, block merge, coverage guard
  buildAgendaDetectPrompt,
  buildAgendaGroupPrompt,
  wordPositions,
  locateQuote,
  agendaNameWords,
  sameAgendaName,
  refineAgendaStart,
  applyAgendaMinShare,
  agendasFromGroups,
  topicBlocks,
  restoreCoverage,
  // v2.60.3: structured outputs, protect step
  topicSchema,
  mapSchema,
  agendaDetectSchema,
  agendaGroupSchema,
  protectPoints,
  isProtectedPoint,
  TOPIC_SHORT_PART_CHARS,
  PROTECT_KEEP,
  PROTECT_TOPIC_POINTS,
  GROUP_MERGE_PREDICT,
  MAX_AGENDAS,
  AGENDA_MIN_SHARE,
  TOPIC_BLOCK_THRESHOLD,
  TOPIC_BLOCK_SIZE,
  GROUP_LIMITS,
  COVERAGE_MIN,
  REPEAT_GUARD,
  parseModelAnswer,
  validateAnswer,
  novelWords,
  tooManyNovelWords,
  NOVEL_LIMITS,
  numberMentions,
  ruleBasedSummary
};
