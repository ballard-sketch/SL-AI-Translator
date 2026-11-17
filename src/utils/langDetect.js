// 粗略判断一条消息是不是已经是用户的接收语言，是的话就不调接口
// 原则：拿不准就返回 false（照常翻译）。多花一次请求，总比漏翻一条好

// ── 语言名 -> 代码 ────────────────────────────────────────────────
// 接收语言是用户手填的，可能是英文名、本地名、中文名或代码
const LANG_ALIASES = {
  zh: ['chinese', 'simplified chinese', 'traditional chinese', 'mandarin', 'zh', 'zh-cn', 'zh-tw', 'zh-hans', 'zh-hant', '中文', '简体中文', '繁体中文', '繁體中文', '汉语', '漢語', '普通话'],
  ja: ['japanese', 'ja', 'jp', '日本語', '日语', '日文'],
  ko: ['korean', 'ko', 'kr', '한국어', '韩语', '韩文'],
  en: ['english', 'en', 'en-us', 'en-gb', '英语', '英文'],
  id: ['indonesian', 'bahasa indonesia', 'bahasa', 'id', 'in', 'malay', 'bahasa melayu', 'melayu', 'ms', '印尼语', '印度尼西亚语', '马来语'],
  es: ['spanish', 'español', 'espanol', 'castellano', 'es', '西班牙语'],
  pt: ['portuguese', 'português', 'portugues', 'brazilian portuguese', 'pt', 'pt-br', '葡萄牙语'],
  fr: ['french', 'français', 'francais', 'fr', '法语'],
  de: ['german', 'deutsch', 'de', '德语'],
  it: ['italian', 'italiano', 'it', '意大利语'],
  nl: ['dutch', 'nederlands', 'nl', '荷兰语'],
  tr: ['turkish', 'türkçe', 'turkce', 'tr', '土耳其语'],
  pl: ['polish', 'polski', 'pl', '波兰语'],
  vi: ['vietnamese', 'tiếng việt', 'tieng viet', 'vi', '越南语'],
  tl: ['filipino', 'tagalog', 'tl', 'fil', '菲律宾语', '他加禄语'],
  ru: ['russian', 'русский', 'ru', '俄语'],
  uk: ['ukrainian', 'українська', 'uk', 'ua', '乌克兰语'],
  th: ['thai', 'ไทย', 'th', '泰语'],
  ar: ['arabic', 'العربية', 'ar', '阿拉伯语'],
  he: ['hebrew', 'עברית', 'he', '希伯来语'],
  el: ['greek', 'ελληνικά', 'el', '希腊语'],
  hi: ['hindi', 'हिन्दी', 'hi', '印地语'],
};

const ALIAS_TO_CODE = (() => {
  const m = new Map();
  for (const [code, names] of Object.entries(LANG_ALIASES)) names.forEach(n => m.set(n, code));
  return m;
})();

/** "Indonesian" / "印尼语" / "id" -> 'id'；认不出返回 null */
export function resolveLang(name) {
  const n = (name || '').trim().toLowerCase();
  if (!n) return null;
  if (ALIAS_TO_CODE.has(n)) return ALIAS_TO_CODE.get(n);
  // "Simplified Chinese (简体)"、"English (US)" 这类：逐个别名做包含匹配，长的优先
  let best = null;
  let bestLen = 2; // 两个字母的代码不做包含匹配，避免 "it" 命中 "british"
  for (const [alias, code] of ALIAS_TO_CODE) {
    if (alias.length > bestLen && n.includes(alias)) { best = code; bestLen = alias.length; }
  }
  return best;
}

// 下拉框里的常用语言：value 直接写进提示词，所以用英文名
export const LANG_OPTIONS = [
  { value: 'Simplified Chinese',  label: '简体中文 Simplified Chinese' },
  { value: 'Traditional Chinese', label: '繁體中文 Traditional Chinese' },
  { value: 'English',             label: 'English' },
  { value: 'Indonesian',          label: 'Bahasa Indonesia' },
  { value: 'Malay',               label: 'Bahasa Melayu' },
  { value: 'Filipino',            label: 'Filipino' },
  { value: 'Vietnamese',          label: 'Tiếng Việt' },
  { value: 'Thai',                label: 'ไทย Thai' },
  { value: 'Japanese',            label: '日本語 Japanese' },
  { value: 'Korean',              label: '한국어 Korean' },
  { value: 'Spanish',             label: 'Español' },
  { value: 'Portuguese',          label: 'Português' },
  { value: 'French',              label: 'Français' },
  { value: 'German',              label: 'Deutsch' },
  { value: 'Italian',             label: 'Italiano' },
  { value: 'Dutch',               label: 'Nederlands' },
  { value: 'Polish',              label: 'Polski' },
  { value: 'Turkish',             label: 'Türkçe' },
  { value: 'Russian',             label: 'Русский' },
  { value: 'Ukrainian',           label: 'Українська' },
  { value: 'Arabic',              label: 'العربية Arabic' },
  { value: 'Hebrew',              label: 'עברית Hebrew' },
  { value: 'Greek',               label: 'Ελληνικά' },
  { value: 'Hindi',               label: 'हिन्दी Hindi' },
];

// ── 按文字体系判断的语言 ──────────────────────────────────────────
const SCRIPT_RE = {
  han: /\p{Script=Han}/gu,
  kana: /[\p{Script=Hiragana}\p{Script=Katakana}]/gu,
  hangul: /\p{Script=Hangul}/gu,
  cyrillic: /\p{Script=Cyrillic}/gu,
  thai: /\p{Script=Thai}/gu,
  arabic: /\p{Script=Arabic}/gu,
  hebrew: /\p{Script=Hebrew}/gu,
  greek: /\p{Script=Greek}/gu,
  devanagari: /\p{Script=Devanagari}/gu,
  latin: /\p{Script=Latin}/gu,
};
const LETTER_RE = /\p{L}/gu;
const count = (text, re) => (text.match(re) || []).length;

// 非拉丁文字的语言：该文字占字母的六成以上即视为目标语言
const SCRIPT_LANGS = {
  zh: (c) => c.kana === 0 && c.han / c.letters >= 0.6,
  ja: (c) => c.kana > 0 && (c.han + c.kana) / c.letters >= 0.6,
  ko: (c) => c.hangul / c.letters >= 0.6,
  th: (c) => c.thai / c.letters >= 0.6,
  ar: (c) => c.arabic / c.letters >= 0.6,
  he: (c) => c.hebrew / c.letters >= 0.6,
  el: (c) => c.greek / c.letters >= 0.6,
  hi: (c) => c.devanagari / c.letters >= 0.6,
  // 俄语和乌克兰语共用西里尔字母，靠特有字母区分
  ru: (c, t) => c.cyrillic / c.letters >= 0.6 && !/[іїєґ]/i.test(t),
  uk: (c, t) => c.cyrillic / c.letters >= 0.6 && /[іїєґ]/i.test(t),
};

// ── 拉丁文字的语言：靠常用词判断 ─────────────────────────────────
// 只收各语言最常用、且尽量不和别的语言重复的词（含聊天里的常见缩写）
const STOPWORDS = {
  en: 'the a an and or but is are was were am be been it its this that these those i you he she we they me my your his her our their what who where when why how do does did dont don\'t can can\'t cant will would should could not no yes yeah yep have has had just with for from of to in on at about there here there\'s it\'s i\'m im you\'re thats that\'s gonna wanna want know think like really very too so if then than also some any one all more out up go going get got see come thanks thank please sorry good nice cool btw idk imo tbh sure',
  id: 'yang dan di ke dari ini itu aku saya kamu anda dia kita kami mereka tidak gak ga nggak enggak ngga tak bukan ada apa siapa mana kapan kenapa mengapa bagaimana gimana sudah udah belum akan mau bisa juga lagi saja aja sama dengan untuk buat karena kalau kalo tapi atau jadi sangat banget sekali terima kasih makasih maaf selamat pagi siang malam halo hai iya ya yaa sih dong deh kok nih tuh loh lho kan kak bang mas mbak gan sis wkwk wkwkwk yg dgn utk tdk sy km dr krn jg sdh blm bgt aja lg gw gue lu lo nya',
  es: 'el la los las un una unos unas y o pero es son está están estoy era fue ser estar que de del en con por para como más muy también ya no sí si yo tú usted él ella nosotros ellos mi tu su qué quién dónde cuándo por qué cómo hola gracias bueno buenos buenas noches días tengo tiene hay quiero puedo vamos aquí allí eso esto esta este pues jaja jajaja vale',
  pt: 'o a os as um uma e ou mas é são está estão estou era foi ser estar que de do da dos das em no na nos nas com por para como mais muito também já não sim eu você ele ela nós eles meu minha seu sua quem onde quando porque como olá oi obrigado obrigada bom boa noite dia tenho tem quero posso vamos aqui ali isso isto esta este então kkk kkkk né vc pq tb',
  fr: 'le la les un une des et ou mais est sont suis était être avoir que qui de du en dans avec pour par comme plus très aussi déjà ne pas non oui je tu il elle nous vous ils elles mon ma mes ton ta son sa quoi où quand pourquoi comment bonjour salut merci bonsoir c\'est j\'ai je suis il y a ça cette ce cet mdr',
  de: 'der die das ein eine einen und oder aber ist sind bin war sein haben hat habe dass nicht kein ja nein ich du er sie wir ihr mein dein sein was wer wo wann warum wie hallo danke bitte gut auch schon noch sehr mit für von zu auf aus bei nach jetzt hier da es gibt',
  it: 'il lo la gli le un una e o ma è sono sei era essere avere che di del della in con per come più molto anche già non sì io tu lui lei noi voi loro mio mia tuo tua cosa chi dove quando perché ciao grazie buongiorno buonasera bene sto ho hai ha qui questo questa',
  nl: 'de het een en of maar is zijn ben was dat die niet geen ja nee ik jij je hij zij wij jullie mijn jouw wat wie waar wanneer waarom hoe hallo dank bedankt goed ook al nog heel met voor van naar op bij nu hier daar er',
  tr: 've veya ama bir bu şu o ben sen biz siz onlar benim senin değil yok var evet hayır ne kim nerede neden nasıl merhaba selam teşekkürler teşekkür sağol iyi çok da de mi mı mu mü için ile gibi şimdi burada',
  pl: 'i w z na do nie tak jest są być to że jak ale czy co kto gdzie kiedy dlaczego ja ty on ona my wy oni mój moja twój cześć dzięki dziękuję dobrze bardzo też już jeszcze tu tam się',
  vi: 'và hoặc nhưng là có không được của cho với trong này đó tôi bạn anh em chị ông bà chúng mình gì ai đâu khi sao thế nào xin chào cảm ơn rất cũng đã đang sẽ rồi nhé nha ạ',
  tl: 'ang ng sa na at ay mga si ni kay ako ikaw ka siya kami tayo kayo sila ko mo niya hindi oo opo wala may meron ano sino saan kailan bakit paano salamat po lang din rin naman talaga kasi pero',
};

const STOP_SETS = Object.fromEntries(
  Object.entries(STOPWORDS).map(([k, v]) => [k, new Set(v.split(/\s+/))])
);

// 各语言通用、谁都看得懂的聊天词：消息只由这些组成时不必翻译
const NEUTRAL = new Set('ok okay lol lmao haha hehe hihi xd omg wow hi hey yo ty thx np brb afk tp lm sim rez im l$ xoxo bye'.split(' '));

const WORD_RE = /[\p{L}'’]+/gu;

function latinLooksLike(text, code) {
  const words = (text.toLowerCase().replace(/’/g, '\'').match(WORD_RE) || []);
  if (!words.length) return true;
  if (words.every(w => NEUTRAL.has(w))) return true;

  const hits = {};
  for (const lang of Object.keys(STOP_SETS)) {
    hits[lang] = words.reduce((n, w) => n + (STOP_SETS[lang].has(w) ? 1 : 0), 0);
  }
  const mine = hits[code] || 0;
  if (mine === 0) return false;
  const bestOther = Math.max(0, ...Object.entries(hits).filter(([l]) => l !== code).map(([, n]) => n));
  // 必须明显领先其他语言，打平（西语/葡语这类很像的）就照常翻译
  if (mine <= bestOther) return false;
  // 短消息命中一个词就够；长消息要求至少两成是常用词
  return words.length <= 3 || mine / words.length >= 0.2;
}

/**
 * 判断 text 是否已经是 lang 语言（或只有表情/数字/通用聊天词）
 * @param {string} text
 * @param {string} lang - 用户填的接收语言
 */
export function looksLikeTarget(text, lang) {
  const t = text || '';
  const letters = count(t, LETTER_RE);
  if (letters === 0) return true;

  const code = resolveLang(lang);
  if (!code) return false;

  if (SCRIPT_LANGS[code]) {
    const c = { letters };
    for (const [k, re] of Object.entries(SCRIPT_RE)) c[k] = count(t, re);
    return SCRIPT_LANGS[code](c, t);
  }
  if (STOP_SETS[code]) {
    // 拉丁文字语言：先确认主要是拉丁字母
    if (count(t, SCRIPT_RE.latin) / letters < 0.8) return false;
    return latinLooksLike(t, code);
  }
  return false;
}
