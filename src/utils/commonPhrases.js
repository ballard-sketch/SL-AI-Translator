// 常用语：整条消息只由这些短语组成时不翻译（打招呼、笑、谢谢、拜拜……谁都看得懂）
// 只看"整条消息"，所以 "lol" 在名单里不会影响 "lol where are you from?" 的翻译

export const DEFAULT_COMMON_PHRASES = [
  // 打招呼
  'hi', 'hello', 'hey', 'heya', 'hiya', 'hai', 'yo', 'sup', 'howdy', 'welcome', 'welcome back', 'wb',
  'good morning', 'morning', 'gm', 'good evening', 'good night', 'night', 'nite', 'gn', 'nn',
  // 道别
  'bye', 'bye bye', 'byebye', 'bb', 'cya', 'see you', 'see ya', 'see you later', 'later', 'take care', 'tc',
  'brb', 'afk', 'back', 're', 'bbl', 'gtg', 'g2g', 'ttyl',
  // 谢谢 / 不客气
  'ty', 'thx', 'thanks', 'thank you', 'thank u', 'tysm', 'tyvm', 'np', 'no problem', 'yw', 'you\'re welcome', 'welcome',
  // 应答
  'ok', 'okay', 'oki', 'okie', 'k', 'kk', 'yes', 'yeah', 'yep', 'yup', 'ya', 'no', 'nope', 'nah', 'sure', 'cool', 'nice', 'great',
  'me too', 'same', 'true', 'right', 'sorry', 'sry', 'oops', 'hmm', 'hm', 'uh', 'um', 'oh', 'ah', 'aw', 'aww',
  // 笑 / 感叹
  'lol', 'lmao', 'lmfao', 'rofl', 'haha', 'hehe', 'hihi', 'xd', 'omg', 'wow', 'yay', 'woot', 'wtf',
  // SL 常见
  'hugs', 'hug', 'kiss', 'kisses', 'xoxo', 'ty for the tp', 'tp', 'lm',
];

// 去掉标点、表情和多余空格，并把连写的同一字母压成一个（hiii -> hi，looool -> lol）
const squash = (s) => s.replace(/(\p{L})\1+/gu, '$1');
const normalize = (s) => squash(
  (s || '')
    .toLowerCase()
    .replace(/<3+/g, ' ')                         // <3 爱心
    .replace(/[’`]/g, '\'')
    .replace(/[^\p{L}\p{N}'\s]/gu, ' ')
    .replace(/(^|\s)\p{N}+(?=\s|$)/gu, ' ')       // 单独的数字谁都看得懂，不参与判断
    .replace(/\s+/g, ' ')
    .trim()
);

// 哈哈类的笑声，长短不一：haha、hahahaha、hehehe、wkwkwk、xdxd
const LAUGH_RE = /^(?:(?:ha|he|hi|ho|ja|je|wk|xd)+h?|l+o+l+|l+m+a+o+)$/;

let cacheKey = null;
let cacheSet = null;
const phraseSet = (list) => {
  if (list !== cacheKey) {
    cacheKey = list;
    cacheSet = new Set((list || []).map(normalize).filter(Boolean));
  }
  return cacheSet;
};

/**
 * 整条消息是否只由常用语组成（可以是几个连在一起，如 "hi ty" "ok bye lol"）
 * @param {string} text
 * @param {string[]} list - 用户的常用语名单
 */
export function isCommonPhrase(text, list) {
  const norm = normalize(text);
  if (!norm) return false; // 纯表情/数字由别处处理
  const set = phraseSet(list);
  if (!set.size) return false;

  const words = norm.split(' ');
  if (words.length > 8) return false; // 长消息不可能只是寒暄

  // 按词切分：ok[i] = 前 i 个词能否完全由名单里的短语拼出来
  const ok = [true];
  for (let i = 1; i <= words.length; i++) {
    ok[i] = false;
    for (let j = Math.max(0, i - 4); j < i && !ok[i]; j++) {
      if (!ok[j]) continue;
      const piece = words.slice(j, i).join(' ');
      ok[i] = set.has(piece) || (i - j === 1 && LAUGH_RE.test(piece));
    }
  }
  return ok[words.length];
}
