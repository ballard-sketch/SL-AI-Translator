// 客户端自己生成的通知：上线/下线、进入/离开区域、正在输入……
// 这些不是人说的话，不需要翻译。日志里可能是 "Bob Smith: is online"，
// 也可能整句都在正文里 "Bob Smith is Offline."，两种都只看正文就能认出来

// 允许句首带一个名字（最多 64 个字符），句尾带句号/感叹号。
// 名字不能是代词/冠词开头，避免把 "my boyfriend is offline" 这种人话当成通知
const NOT_NAME = String.raw`(?!(?:i|you|u|he|she|we|they|my|your|his|her|our|their|it|its|the|a|an|this|that|who|everyone|someone|somebody|nobody|everybody|all|me)\b)`;
const NAME = String.raw`(?:${NOT_NAME}.{1,64}?\s+)?`;
const END = String.raw`\s*[.!。！]*$`;

const PATTERNS = [
  // 上线 / 下线（各语言客户端）
  new RegExp(`^${NAME}(?:is|has gone|went|has come|came|is now)\\s+(?:now\\s+)?(?:online|offline)${END}`, 'i'),
  new RegExp(`^${NAME}(?:has\\s+)?(?:logged|signed)\\s+(?:in|on|off|out)${END}`, 'i'),
  new RegExp(`^${NAME}(?:ist|est|está|esta|è|is)\\s+(?:jetzt\\s+)?(?:online|offline|en ligne|hors ligne|conectad[oa]|desconectad[oa])${END}`, 'i'),
  // 进入 / 离开区域、聊天范围、雷达
  new RegExp(`^${NAME}(?:has\\s+)?(?:entered|left|exited)\\s+(?:the\\s+)?(?:region|sim|parcel|chat range|draw distance|radar range|shout range|whisper range|area)${END}`, 'i'),
  new RegExp(`^${NAME}(?:has\\s+(?:arrived|departed|left)|teleported (?:in|out|away))${END}`, 'i'),
  new RegExp(`^${NAME}is typing(?:\\.\\.\\.|…)?${END}`, 'i'),
  // 中文客户端
  new RegExp(`^${NAME}?\\s*(?:已|已经|已經)?(?:上线|下线|离线|上線|下線|離線)(?:了)?${END}`),
  new RegExp(`^${NAME}?\\s*(?:已|已经|已經)?(?:进入|離開|离开|進入)(?:了)?(?:该|該|此)?(?:区域|區域|地区|地區|范围|範圍|聊天范围|聊天範圍|地块|地塊)${END}`),
  // 日文客户端
  new RegExp(`(?:オンライン|オフライン)(?:になりました|です)?${END}`),
];

/**
 * 是否是客户端生成的系统通知
 * @param {string} sender
 * @param {string} text
 */
export function isSystemNotice(sender, text) {
  const t = (text || '').trim();
  if (!t || t.length > 120) return false;
  // "Bob: is online" 的正文本身就匹配；"Firestorm: Bob is online." 靠句首可选的名字匹配
  return PATTERNS.some(re => re.test(t));
}
