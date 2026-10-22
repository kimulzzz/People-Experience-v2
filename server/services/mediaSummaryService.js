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
//   map    - every part of about TOPIC_PART_CHARS -> 1-3 topics with 1-3 points. An unreadable or empty answer is asked again
//            ONCE (another seed + "this part certainly contains a discussion"); still empty -> that part is skipped (counted);
//   reduce - one call merges the topics of all parts into 4-8 topics in meeting order + an overall summary of 3-5 sentences.
// Nothing is trusted blindly: every point and topic title is checked against the WHOLE transcript with the rules of the short
// summary (numbers, names/acronyms, meta phrases, markup, words that are not in the transcript). A point that fails is DROPPED,
// not the whole summary; a topic left without points is dropped. The overall summary must pass validateAnswer; it gets one
// retry naming the problem. Still failing, fewer than TOPIC_MIN_FINAL topics left, or fewer than TOPIC_MIN_MAPPED topics from
// the map step -> null, and the job continues on the older part-by-part path (which can end in the rule-based summary).
const TOPIC_PART_CHARS = 6000;
const TOPIC_MAX_PARTS = 20;          // more parts (about 120,000 characters): the older path, which goes rule-based above MAX_CHUNKS
const TOPIC_MIN_MAPPED = 2;          // fewer topics from all parts together: the older path
const TOPIC_MIN_FINAL = 2;           // fewer topics left after the fact check: the older path
const TOPIC_PART_LIMITS = { topics: 3, points: 3 };
const TOPIC_FINAL_LIMITS = { topics: 8, points: 4 };
const TOPIC_MAP_OPTIONS = { numCtx: 8192, numPredict: 500 };
const TOPIC_MERGE_PREDICT = 1400;
const TOPIC_SEEDS = [41, 42];        // first answer / the one retry (map part and merge)

const usesTopicMode = transcript => String(transcript || '').trim().length > CHUNK_CHARS;

function buildTopicPartPrompt(text, lang, index, total, insist = false) {
  if (lang === 'id') {
    return `Anda meringkas isi sebuah rekaman dalam Bahasa Indonesia. Berikut bagian ${index} dari ${total} transkrip rekaman tersebut (bisa rapat, diskusi, wawancara, podcast, atau video edukasi; hasil speech-to-text, bisa ada salah ketik).

Tugas: ambil TOPIK-TOPIK yang dibahas di bagian ini (1 sampai 3 topik). Untuk setiap topik tulis 1 sampai 3 poin singkat tentang isi yang dibahas. Keputusan, tindak lanjut, dan target waktu ditulis HANYA bila benar-benar diucapkan.${insist ? '\nBagian ini PASTI berisi pembahasan, jangan kosong: tulis minimal 1 topik dengan 1 poin.' : ''}
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

Task: list the TOPICS discussed in this part (1 to 3 topics). For each topic write 1 to 3 short points about what was discussed. Write decisions, follow-ups and deadlines ONLY when they were really said.${insist ? '\nThis part DEFINITELY contains a discussion, do not answer empty: write at least 1 topic with 1 point.' : ''}
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

function buildTopicMergePrompt(partTopics, lang, feedback) {
  if (lang === 'id') {
    const list = partTopics.map((t, k) => `${k + 1}. [bagian ${t.part}] ${t.title}: ${t.points.join(' | ')}`).join('\n');
    return `Berikut daftar topik dan poin hasil ekstraksi dari beberapa bagian satu rekaman yang sama (Bahasa Indonesia):
${list}

Tugas:
1. Gabungkan topik yang sama atau sangat mirip menjadi satu. Hasilkan 4 sampai 8 topik akhir, urut sesuai jalannya rekaman.
2. Untuk setiap topik akhir tulis 1 sampai 4 poin singkat (satu kalimat, maksimal 25 kata) tentang isinya; keputusan, tindak lanjut, dan target waktu hanya bila ada di daftar. Jangan mengulang poin yang sama atau yang maknanya sama, juga di topik lain.
3. Tulis "ringkasan" umum 3 sampai 5 kalimat tentang keseluruhan isi. Mulai langsung dengan pokok bahasannya sendiri, JANGAN PERNAH membuka dengan "Rekaman ini", "Video ini", "Transkrip ini", "Rapat ini", "Pertemuan ini", "Diskusi ini", atau "Podcast ini"; jangan menyebut jenis acaranya ("dalam rapat", "video ini") kecuali daftar di atas menyebutnya.
Aturan: hanya pakai informasi dari daftar di atas; dilarang menambah angka, tanggal, nama, atau kesimpulan baru; jangan pernah menulis poin bahwa sesuatu tidak disebutkan, tidak ada, atau belum diputuskan.${feedback ? `\n\nPERBAIKAN: jawaban Anda sebelumnya ditolak karena ${feedback}. Tulis ulang, JANGAN memakai kata/angka/nama yang disebut itu, dan pakai hanya kata yang benar-benar ada di daftar.` : ''}
Jawab HANYA JSON: {"ringkasan":"...","topik":[{"judul":"...","poin":["..."]}]}`;
  }
  const list = partTopics.map((t, k) => `${k + 1}. [part ${t.part}] ${t.title}: ${t.points.join(' | ')}`).join('\n');
  return `Below are the topics and points extracted from the parts of one and the same recording (${LANGUAGES[lang]}):
${list}

Task:
1. Merge topics that are the same or very similar. Give 4 to 8 final topics, in the order of the recording.
2. For each final topic write 1 to 4 short points (one sentence, at most 25 words) about its content; decisions, follow-ups and deadlines only when they are in the list. Do not repeat a point or one with the same meaning, also not in another topic.
3. Write an overall "summary" of 3 to 5 sentences about the whole content. Start with the subject itself, NEVER with "This recording", "This video", "This transcript", "This meeting", "This discussion" or "This podcast"; do not name the type of event ("in the meeting", "this video") unless the list above does.
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
const META_OPENER_ID_RE = /^(?:dalam\s+)?(?:rekaman|video|transkrip|rapat|pertemuan|diskusi|podcast|percakapan|wawancara)\s+(?:ini|tersebut)\s+(juga\s+)?(?:membahas|berisi|menjelaskan|mengulas|menyoroti|berfokus pada|mencakup|memuat|menekankan)\s+/i;
const META_OPENER_EN_RE = /^(?:in\s+)?(?:this|the)\s+(?:recording|video|transcript|meeting|discussion|podcast|conversation|interview)\s+(also\s+)?(?:discusses|covers|explains|describes|focuses on|highlights|contains|is about|emphasizes)\s+/i;
const sentencesOf = text => String(text).split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
function neutralOpener(sentence) {
  let m = META_OPENER_ID_RE.exec(sentence);
  if (m) return `Pembahasan ${m[1] ? 'juga ' : ''}mencakup ${sentence.slice(m[0].length)}`;
  m = META_OPENER_EN_RE.exec(sentence);
  if (m) return `The discussion ${m[1] ? 'also ' : ''}covers ${sentence.slice(m[0].length)}`;
  return sentence;
}
function repairSummary(summary, ctx) {
  const problem = text => validateAnswer({ summary: text, points: [] }, ctx.transcript, ctx.lang)
    || (!ctx.eventWordsAllowed && EVENT_WORD_RE.test(text) ? EVENT_REASON : null);
  const sentences = sentencesOf(summary).map(neutralOpener);
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

// { summary, points, topics, stats } that passed the checks, or null (= continue on the older path). Throws on Ollama
// problems / the job's time limit (-> rule-based summary), like summarizeWithAi.
async function summarizeByTopics(media, lang, deadline) {
  const transcript = media.transcript;
  const parts = splitTranscript(transcript, TOPIC_PART_CHARS);
  if (parts.length > TOPIC_MAX_PARTS) return null;
  const ctx = buildCheckContext(transcript, lang, media.file_name);
  const stats = { parts: parts.length, retried_parts: 0, skipped_parts: 0, dropped_points: 0, dropped_topics: 0, merge_attempts: 0, aborted_answers: 0,
    filler_points: 0, duplicate_points: 0, summary_repaired: 0, summary_sentences_removed: 0, summary_from_titles: 0 };
  const mapped = [];
  for (let i = 0; i < parts.length; i++) {
    let topics = [];
    for (let attempt = 1; attempt <= 2 && !topics.length; attempt++) {
      if (attempt === 2) stats.retried_parts++;
      const res = await askModelOrNull(buildTopicPartPrompt(parts[i], lang, i + 1, parts.length, attempt === 2), media, deadline,
        { seed: TOPIC_SEEDS[attempt - 1], format: 'json', ...TOPIC_MAP_OPTIONS, ...(attempt === 2 ? REPEAT_GUARD : {}), details: true }, stats);
      topics = normalizeTopics(fieldOf(parseJsonAnswer(res && res.text), ['topik', 'topics']), TOPIC_PART_LIMITS);
      if (res && !topics.length) logUnusableAnswer(media, `part ${i + 1}/${parts.length} attempt ${attempt}`, res);
    }
    if (!topics.length) {
      stats.skipped_parts++;
      console.warn(`AI topic summary for ${media.media_id}: part ${i + 1}/${parts.length} gave no topics twice - skipped`);
      continue;
    }
    // Invented points are dropped here already, so they never reach the merge step.
    const checked = checkTopics(topics, ctx, false);
    stats.dropped_points += checked.droppedPoints;
    stats.dropped_topics += checked.droppedTopics;
    stats.filler_points += checked.fillerPoints;
    checked.topics.forEach(t => mapped.push({ part: i + 1, ...t }));
  }
  if (mapped.length < TOPIC_MIN_MAPPED) {
    console.warn(`AI topic summary for ${media.media_id}: only ${mapped.length} topic(s) from ${parts.length} parts - older path`);
    return null;
  }
  const result = (summaryFix, checked, unique, fromTitles = 0) => ({
    summary: summaryFix.text,
    points: unique.topics.map(t => `${t.title}: ${t.points[0]}`), // compatibility: PPT and older readers use summary/summary_points
    topics: unique.topics,
    stats: {
      ...stats,
      dropped_points: stats.dropped_points + checked.droppedPoints,
      dropped_topics: stats.dropped_topics + checked.droppedTopics + unique.droppedTopics,
      filler_points: stats.filler_points + checked.fillerPoints,
      duplicate_points: unique.duplicatePoints,
      summary_repaired: summaryFix.repaired ? 1 : 0,
      summary_sentences_removed: summaryFix.removed,
      summary_from_titles: fromTitles
    }
  });
  // An attempt with good topics but a failing summary is kept (best = most topics), as is a passing summary of an attempt whose
  // topics failed: the merge only hands over to the older path when NO attempt gave TOPIC_MIN_FINAL valid topics.
  let best = null;
  let spareSummary = null;
  let feedback = '';
  let reason = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    stats.merge_attempts = attempt;
    const prompt = buildTopicMergePrompt(mapped, lang, feedback);
    const res = await askModelOrNull(prompt, media, deadline,
      { seed: TOPIC_SEEDS[attempt - 1], format: 'json', numCtx: contextFor(prompt, TOPIC_MERGE_PREDICT), numPredict: TOPIC_MERGE_PREDICT, ...(attempt === 2 ? REPEAT_GUARD : {}), details: true }, stats);
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
  console.warn(`AI topic summary for ${media.media_id} rejected (${reason}) - older path`);
  return null;
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
  summaryFromTitles,
  contextFor,
  TOPIC_PART_CHARS,
  TOPIC_MAX_PARTS,
  TOPIC_PART_LIMITS,
  TOPIC_FINAL_LIMITS,
  REPEAT_GUARD,
  parseModelAnswer,
  validateAnswer,
  novelWords,
  tooManyNovelWords,
  NOVEL_LIMITS,
  numberMentions,
  ruleBasedSummary
};
