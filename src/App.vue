<script setup>
import { ref, watch, onMounted, onBeforeUnmount, nextTick, computed } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { saveWindowState, restoreStateCurrent } from '@tauri-apps/plugin-window-state';
import { TauriBridge } from './services/TauriBridge';
import { LLMService, TONES } from './services/LLMService';
import { UpdateService } from './services/UpdateService';
import { API_DEFAULTS } from './utils/constants';
import { looksLikeTarget, resolveLang, LANG_OPTIONS } from './utils/langDetect';
import {
  Sparkles, Activity, Play, Minus, X,
  Settings, MessageSquareDot, Send, KeyRound,
  FolderOpen, User, ChevronDown, Pin, PinOff, BookText,
  Bell, BellOff, Copy, HelpCircle, RotateCw, Languages, Bot, UserX, UserCheck
} from 'lucide-vue-next';

// ── 常量 ──────────────────────────────────────────────────────────
const TAB_CHAT = 'chat';
const TAB_SETTINGS = 'settings';
const PUBLIC_CHAT_FILES = ['chat.txt', 'conversation.log'];
// SL 单条聊天消息上限（字节）
const SL_MSG_BYTE_LIMIT = 1023;
// 发送方向可选的目标语言，'auto' = 按对方最近消息自动判断

// ── 窗口控制 ──────────────────────────────────────────────────────
const win = getCurrentWindow();
const handleDrag     = () => win.startDragging();
const handleMinimize = () => win.minimize();
// 关闭 = 隐藏到系统托盘，从托盘右键「退出」才真正结束
const handleClose = async () => {
  try { await saveWindowState(63); } catch (e) {}
  win.hide();
};

const isPinned = ref(false);
const togglePin = async () => {
  isPinned.value = !isPinned.value;
  await invoke('toggle_topmost', { pin: isPinned.value });
};

// ── 页面状态 ──────────────────────────────────────────────────────
const activeTab  = ref(TAB_CHAT);
const isListening = ref(false);

// ── 设置表单 ──────────────────────────────────────────────────────
const settings = ref({
  logDir:     '',
  account:    '',
  apiKey:     '',
  baseUrl:    API_DEFAULTS.BASE_URL,
  model:      API_DEFAULTS.MODEL,
  recvLang:   'Simplified Chinese',
  contextCount: 5,
  translateGroup: false,
  uiLang:     'zh-CN',
  blacklist:  [],
  lslPublicUrl: '',
  lslEnabled: false,
  viewerType: 'firestorm',  // 'firestorm' | 'official' | 'custom'
  bgOpacity: 0.75,          // 窗口背景透明度
  nearbyWhitelistEnabled: false, // 附近频道白名单开关
  nearbyWhitelist: [],           // 白名单用户名数组（附近频道）
  keywordBlocklist: [],          // 关键词屏蔽数组（含此词不翻译）
  noTranslate: [],               // 不用翻译的人：消息照常显示，但不自动调接口
  sendTone: 'natural',           // 新频道默认语气
  backTranslate: true,           // 发送翻译时附带回译
  glossary: [],                  // 术语表：每行 "词" 或 "A = B"
  hotkey: 'Ctrl+Alt+T',          // 全局快捷键，空串 = 关闭
});
const accountList = ref([]);
const errorMessage = ref('');
const apiKeyBarDismissed = ref(false);

// ── 内置语言包 ────────────────────────────────────────────────────
const I18N_BUNDLES = {
  'zh-CN': {
    appTitle: "AI.SLtalk", listeningInfo: "工作中", startListening: "启动翻译",
    viewHistory: "查看历史记录", settingTitle: "设置",
    folderLog: "日志目录", browseLabel: "浏览",
    slAccount: "SL 账号", slAccountDropTip: "-- 选择账号文件夹 --",
    slAccountNoDirHint: "请先填写日志目录，软件会自动扫描账号列表。",
    apiKeyLabel: "API Key", baseUrlLabel: "Base URL", modelLabel: "模型",
    recvLangConfig: "将其发来的消息，翻译为：",
    ctxCountSetting: "翻译参考上文的条数（默认 5 条，填 0 关闭）",
    groupCb: "开启群聊同步及翻译 (带有 group 字样的频道)", uiLangLabel: "软件界面语言",
    saveBtn: "保存设置", apiKeyFloatTip: "填写 API Key 才能翻译：",
    nearbyTab: "附近", tutorialTitle: "使用教程", stopListeningTitle: "停止翻译引擎",
    testApiBtn: "测试 API", testApiTesting: "测试中...",
    testApiNoKey: "请先填写 API Key",
    testApiConnecting: "正在连接 API...",
    testApiSuccess: "测试通过，API 连接正常。",
    testApiFail: "测试失败：没有收到响应，请检查 Base URL 和模型名。",
    muteChanTip: "免打扰 (停止翻译此频道)",
    mutedOverlay: "已对该频道静音（不再翻译），点击上方 Tab 中的铃铛图标可取消静音。",
    engineStartFail: "引擎启动失败: ",
    settingsIncomplete: "请先填写正确的日志目录，并在下拉框中选择你的 SL 账号！\n如果下拉列表为空，请检查日志目录是否正确。",
    pinTitle: "全局置顶", unpinTitle: "取消置顶",
    minimizeTitle: "最小化", closeTitle: "关闭",
    updateAvailable: "发现新版本：v{v}", updateBtn: "前往下载",
    copyOriginal: "复制原文", copyTranslation: "复制译文", suggestReply: "AI 建议回复",
    retranslate: "重新翻译",
    copyResult: "复制", clearResult: "清除", closeLabel: "关闭", copied: "已复制",
    refreshAccounts: "刷新账号列表",
    viewerLabel: "客户端",
    viewerFirestorm: "Firestorm Viewer",
    viewerOfficial: "官方客户端 (Official)",
    viewerCustom: "自定义目录",
    logDirCustomHint: "请手动填写日志目录路径",
    windowOpacityLabel: "窗口透明度",
    nearbyWhitelistLabel: "附近频道白名单",
    nearbyWhitelistCb: "启用附近白名单（仅翻译白名单内用户的消息，私聊不受影响）",
    nearbyWhitelistPlc: "每行一个用户名，可从Profile复制过来",
    keywordBlocklistLabel: "关键词屏蔽（消息含以下词时不翻译）",
    noTranslateLabel: "不用翻译的人（消息照常显示，不自动翻译，节省 Token）",
    noTranslatePlc: "每行一个名字，例如：\nAlice Resident\nbob.smith",
    noTranslateAdd: "不再自动翻译此人",
    noTranslateRemove: "恢复自动翻译此人",
    noTranslateTag: "不翻译",
    keywordBlocklistPlc: "每行一个关键词，例如：\nis offline\n離開該區域",
    secTranslation: "翻译参数",
    secFilter: "过滤规则",
    secAppearance: "界面外观",
    // 底部输入栏
    modeTranslate: "翻译", modeAsk: "问 AI",
    composerPlc: "输入你想说的话，回车译成对方语言并复制；Shift+回车换行",
    askPlc: "问 AI：解释、润色、分析上下文…（Shift+回车换行）",
    toneLabel: "语气", sendLangLabel: "译成",
    langAuto: "自动（跟随对方）",
    langOther: "其他（手动填写）…",
    recvLangCustomPlc: "语言名，例如 Swahili / Tiếng Việt",
    recvLangUnknown: "无法识别这个语言名：消息照常翻译，但已经是该语言的消息也会调用接口。",
    enterHint: "Enter 发送 · Shift+Enter 换行",
    backLabel: "意思",
    regenerate: "换一种说法",
    thinking: "生成中…",
    overLimit: "超出 SL 单条上限（{n}/{max} 字节），发送时会被截断",
    errNoKey: "请先在设置中填写 API Key",
    errTimeout: "请求超时（30 秒无响应）",
    errPrefix: "请求失败：",
    backTranslateCb: "翻译我的话时附带回译（显示译文的大意，方便核对）",
    defaultToneLabel: "新频道的默认语气",
    tone_natural: "自然", tone_casual: "随意", tone_friendly: "友好", tone_polite: "礼貌",
    tone_flirty: "调情", tone_rp: "角色扮演", tone_brief: "简短",
    glossaryLabel: "术语表（人名、地名等固定译法，收发两个方向都生效）",
    glossaryPlc: "每行一条：\nCinna = 辛娜      固定互译\nka2s               保持原样不翻译",
    hotkeyLabel: "全局快捷键（唤出窗口并聚焦输入框）",
    hotkeyPlc: "点击后按下组合键",
    hotkeyRecording: "请按下组合键…（Esc 取消）",
    hotkeyClear: "关闭快捷键",
    hotkeyNeedModifier: "需要包含 Ctrl / Alt / Shift 之一（F1-F12 除外）",
    hotkeyFail: "快捷键注册失败，可能已被其他程序占用：",
    hotkeyOff: "未设置",
  },
  'en-US': {
    appTitle: "AI.SLtalk", listeningInfo: "Active", startListening: "Start Translator",
    viewHistory: "View History", settingTitle: "Settings",
    folderLog: "Log Directory", browseLabel: "Browse",
    slAccount: "SL Account", slAccountDropTip: "-- Select account folder --",
    slAccountNoDirHint: "Please set the log directory first.",
    apiKeyLabel: "API Key", baseUrlLabel: "Base URL", modelLabel: "Model",
    recvLangConfig: "Translate incoming messages to:",
    ctxCountSetting: "Context lines for translation (0 = disabled):",
    groupCb: "Enable group chat translation (files containing 'group')", uiLangLabel: "UI Language",
    saveBtn: "Save Settings", apiKeyFloatTip: "Enter API Key to enable translation:",
    nearbyTab: "Nearby", tutorialTitle: "Tutorial", stopListeningTitle: "Stop Translator Engine",
    testApiBtn: "Test API", testApiTesting: "Testing...",
    testApiNoKey: "Please fill in the API Key first",
    testApiConnecting: "Connecting to API...",
    testApiSuccess: "Test passed. API connection is working.",
    testApiFail: "Test failed: no response received. Check the Base URL and model name.",
    muteChanTip: "Mute (stop translating this channel)",
    mutedOverlay: "This channel is muted. Click the bell icon above to unmute.",
    engineStartFail: "Engine failed to start: ",
    settingsIncomplete: "Please set the log directory and select your SL account first.\nIf the dropdown is empty, check that the log directory path is correct.",
    pinTitle: "Always on Top", unpinTitle: "Unpin",
    minimizeTitle: "Minimize", closeTitle: "Close",
    updateAvailable: "New version available: v{v}", updateBtn: "Download",
    copyOriginal: "Copy original", copyTranslation: "Copy translation", suggestReply: "Suggest replies",
    retranslate: "Translate again",
    copyResult: "Copy", clearResult: "Clear", closeLabel: "Close", copied: "Copied",
    refreshAccounts: "Refresh account list",
    viewerLabel: "Viewer",
    viewerFirestorm: "Firestorm Viewer",
    viewerOfficial: "Official Second Life Viewer",
    viewerCustom: "Custom directory",
    logDirCustomHint: "Enter the log directory path manually",
    windowOpacityLabel: "Window Opacity",
    nearbyWhitelistLabel: "Nearby Chat Whitelist",
    nearbyWhitelistCb: "Enable whitelist for Nearby Chat (only translate whitelisted users; IMs unaffected)",
    nearbyWhitelistPlc: "One username per line, copy from Profile",
    keywordBlocklistLabel: "Keyword Blocklist (skip translation if message contains any keyword)",
    noTranslateLabel: "People who don't need translation (shown as usual, never auto-translated, saves tokens)",
    noTranslatePlc: "One name per line, e.g.:\nAlice Resident\nbob.smith",
    noTranslateAdd: "Stop auto-translating this person",
    noTranslateRemove: "Auto-translate this person again",
    noTranslateTag: "no translation",
    keywordBlocklistPlc: "One keyword per line, e.g.:\nis offline\n離開該區域",
    secTranslation: "Translation",
    secFilter: "Filters",
    secAppearance: "Appearance",
    modeTranslate: "Translate", modeAsk: "Ask AI",
    composerPlc: "Type what you want to say. Enter translates and copies; Shift+Enter for a new line",
    askPlc: "Ask AI: explain, polish, read the context... (Shift+Enter for a new line)",
    toneLabel: "Tone", sendLangLabel: "To",
    langAuto: "Auto (match them)",
    langOther: "Other (type it)…",
    recvLangCustomPlc: "Language name, e.g. Swahili / Tiếng Việt",
    recvLangUnknown: "Language not recognized: messages are still translated, but ones already in this language will also call the API.",
    enterHint: "Enter to send · Shift+Enter for a new line",
    backLabel: "Means",
    regenerate: "Rephrase",
    thinking: "Generating...",
    overLimit: "Over the SL message limit ({n}/{max} bytes); it will be cut off",
    errNoKey: "Set your API Key in Settings first",
    errTimeout: "Request timed out (no response for 30 s)",
    errPrefix: "Request failed: ",
    backTranslateCb: "Show a back-translation of my outgoing messages to check the meaning",
    defaultToneLabel: "Default tone for new channels",
    tone_natural: "Natural", tone_casual: "Casual", tone_friendly: "Friendly", tone_polite: "Polite",
    tone_flirty: "Flirty", tone_rp: "Roleplay", tone_brief: "Brief",
    glossaryLabel: "Glossary (fixed renderings for names and places, applied both ways)",
    glossaryPlc: "One entry per line:\nCinna = 辛娜      fixed in both directions\nka2s               keep as is, never translate",
    hotkeyLabel: "Global hotkey (bring up the window and focus the input)",
    hotkeyPlc: "Click, then press a key combination",
    hotkeyRecording: "Press a key combination... (Esc to cancel)",
    hotkeyClear: "Disable hotkey",
    hotkeyNeedModifier: "Must include Ctrl, Alt or Shift (except F1-F12)",
    hotkeyFail: "Could not register the hotkey; another program may be using it: ",
    hotkeyOff: "Not set",
  }
};

const i18n = ref({ ...I18N_BUNDLES['zh-CN'] });
const updateAvailable = ref(false);
const updateInfo = ref(null);

const applyUiLang = async () => {
  const lang = settings.value.uiLang;
  if (lang === 'custom') {
    // 自定义语言包可能是旧版本导出的，先用中文补齐缺失的新键
    Object.assign(i18n.value, I18N_BUNDLES['zh-CN']);
    try {
      const custom = await invoke('load_custom_i18n');
      if (custom) Object.assign(i18n.value, JSON.parse(custom));
    } catch(e) {}
  } else {
    const bundle = I18N_BUNDLES[lang] || I18N_BUNDLES['zh-CN'];
    Object.assign(i18n.value, bundle);
  }
};

// 把 LLMService 返回的失败结果转成界面文案；取消的请求返回空串
const describeError = (res) => {
  if (res.aborted) return '';
  if (res.error === 'NO_API_KEY') return i18n.value.errNoKey;
  if (res.timedOut) return i18n.value.errTimeout;
  return i18n.value.errPrefix + res.error;
};

// 只要有路径和账号就能开监听，apiKey 可以后填
const settingsValid = computed(() =>
  Boolean(settings.value.logDir) &&
  Boolean(settings.value.account)
);

// ── 进行中的请求：统一登记，关闭/清除时可取消 ──────────────────
const inflight = new Map();
const startRequest = (key) => {
  inflight.get(key)?.abort();
  const controller = new AbortController();
  inflight.set(key, controller);
  return controller;
};
const finishRequest = (key, controller) => {
  if (inflight.get(key) === controller) inflight.delete(key);
};
const cancelRequest = (key) => {
  inflight.get(key)?.abort();
  inflight.delete(key);
};

// ── 聊天状态 ──────────────────────────────────────────────────────
let msgSeq = 0;
const newMsgId = () => `${Date.now().toString(36)}-${(msgSeq++).toString(36)}`;
// 旧存档里的消息没有 id，退回到 time+sender
const msgKey = (msg) => msg.id || `${msg.time}|${msg.sender}`;

const chatTabs = ref([
  {
    id: 'chat.txt',
    title: 'nearby',
    messages: [
      {
        id: newMsgId(),
        time: new Date().toLocaleTimeString(),
        sender: 'System',
        text: 'AI SLtalk translation core initialized.',
        translated: 'AI SLtalk 翻译引擎已就绪。'
      }
    ],
    hasUnread: false
  }
]);
const activeChatTabId = ref('chat.txt');
const tabRenderLimits = ref({});
const CHAT_RENDER_LIMIT = 20;

const activeChatTab = computed(() => chatTabs.value.find(t => t.id === activeChatTabId.value));

const activeTabMessages = computed(() => {
  const tab = activeChatTab.value;
  if (!tab) return [];
  // 如果当前数量超过限制，则截断；否则全部显示
  const limit = tabRenderLimits.value[activeChatTabId.value] || CHAT_RENDER_LIMIT;
  return tab.messages.slice(-limit);
});

let isPaginating = false;
const handleChatScroll = async (e) => {
  if (e.target.scrollTop <= 5 && !isPaginating) {
    const tabId = activeChatTabId.value;
    const tab = chatTabs.value.find(t => t.id === tabId);
    if (!tab) return;

    const limit = tabRenderLimits.value[tabId] || CHAT_RENDER_LIMIT;
    if (limit < tab.messages.length) {
      isPaginating = true;
      const oldHeight = e.target.scrollHeight;
      const oldScrollTop = e.target.scrollTop;

      // 每次滚动到顶多加载 20 条
      tabRenderLimits.value[tabId] = limit + 20;

      await nextTick();
      // 计算加入新节点后的高度差并恢复滚动位置
      e.target.scrollTop = e.target.scrollHeight - oldHeight + oldScrollTop;

      // 释放锁，允许下次上拉触发
      setTimeout(() => { isPaginating = false; }, 50);
    }
  }
};

const visibleTabs = computed(() => {
  let tabs = chatTabs.value.filter(t => !t.hidden);
  if (!settings.value.translateGroup) {
    tabs = tabs.filter(t => !t.id.toLowerCase().includes('group'));
  }
  return tabs;
});

const persistState = () => {
  const clone = chatTabs.value.map(t => ({
    ...t,
    // 保存最近 100 条防止 JSON 爆满内存；翻译中的临时状态不落盘
    messages: t.messages.slice(-100).map(({ pending, ...m }) => m)
  }));
  invoke('save_ui_state', { account: settings.value.account || '', state: JSON.stringify(clone) }).catch(console.error);
};

const closeTab = (tabId) => {
  const tab = chatTabs.value.find(t => t.id === tabId);
  if (tab) tab.hidden = true;
  if (activeChatTabId.value === tabId) {
    activeChatTabId.value = 'chat.txt';
  }
  persistState();
};

const tabBarRef = ref(null);
const handleTabScroll = (e) => {
  if (tabBarRef.value) {
    // 将鼠标垂直滚动(deltaY)转换为横向滚动，实现标准鼠标顺畅切换
    tabBarRef.value.scrollLeft += e.deltaY;
  }
};

// 复制提示：短暂显示在底栏上方
const copiedHint = ref(false);
let copiedTimer = null;
const copyContent = async (text) => {
  if (!text) return;
  try {
    await TauriBridge.copyToClipboard(text);
  } catch (_) {
    try { await navigator.clipboard.writeText(text); } catch (e) { return; }
  }
  copiedHint.value = true;
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => { copiedHint.value = false; }, 1200);
};

const switchTab = (tabId) => {
  activeChatTabId.value = tabId;
  const tab = chatTabs.value.find(t => t.id === tabId);
  if (tab) tab.hasUnread = false;
  // 切换 Tab 时强制滚到底部
  scrollToBottom(false, true);
};

// ── 自己 / 对方判断 ────────────────────────────────────────────
// 账号文件夹名形如 "first_last" 或 "username_resident"；日志里的发送者可能是
// "First Last"、"username"、"Display Name (first.last)" 等形式
const selfNames = computed(() => {
  const acc = (settings.value.account || '').trim().toLowerCase();
  if (!acc) return [];
  const names = new Set([acc, acc.replace(/_/g, ' '), acc.replace(/_/g, '.')]);
  const parts = acc.split('_');
  if (parts.length === 2 && parts[1] === 'resident') names.add(parts[0]);
  return [...names];
});
const isMySelf = (sender) => {
  const s = (sender || '').trim().toLowerCase();
  if (s === 'you' || s === 'me') return true;
  return selfNames.value.some(n => s === n || s.includes(`(${n})`));
};

// 翻译参考上文：同频道前 N 条（不含当前这条）
const getHistoryContext = (tab, beforeMsg) => {
  const count = settings.value.contextCount;
  if (!tab || !count) return [];
  let end = tab.messages.length;
  if (beforeMsg) {
    const idx = tab.messages.indexOf(beforeMsg);
    if (idx !== -1) end = idx;
  }
  return tab.messages
    .slice(Math.max(0, end - count), end)
    .filter(m => m.sender !== 'System' && m.text)
    .map(m => ({ sender: m.sender, text: m.text }));
};

// 获取对方发出的原文消息，不包括自己发出的，用于推断对方语言和说话风格
const getOtherRawMessages = (tab) => {
  if (!tab) return [];
  return tab.messages
    .filter(m => m.text && m.sender !== 'System' && !isMySelf(m.sender))
    .slice(-5)
    .map(m => m.text);
};

const chatScrollRef = ref(null);

// ── 黑名单管理 ───────────────────────────────────────────────
const isTargetBlacklisted = (targetId) => {
  return settings.value.blacklist.some(n => n.toLowerCase() === targetId.toLowerCase());
};

// ── 白名单 / 关键词屏蔽：用 computed v-model 避免回车换行被拦截 ──
const nearbyWhitelistRaw = computed({
  get: () => settings.value.nearbyWhitelist.join('\n'),
  set: (v) => { settings.value.nearbyWhitelist = v.split('\n'); }
});
const keywordBlocklistRaw = computed({
  get: () => settings.value.keywordBlocklist.join('\n'),
  set: (v) => { settings.value.keywordBlocklist = v.split('\n'); }
});
const glossaryRaw = computed({
  get: () => settings.value.glossary.join('\n'),
  set: (v) => { settings.value.glossary = v.split('\n'); }
});

// 接收语言：常用语言下拉选择，列表外的可手动填写
const RECV_CUSTOM = '__custom';
const recvCustomMode = ref(false);
const recvLangChoice = computed({
  get: () => (recvCustomMode.value || !LANG_OPTIONS.some(o => o.value === settings.value.recvLang))
    ? RECV_CUSTOM : settings.value.recvLang,
  set: (v) => {
    if (v === RECV_CUSTOM) { recvCustomMode.value = true; return; }
    recvCustomMode.value = false;
    settings.value.recvLang = v;
  }
});
const recvLangUnknown = computed(() => !!settings.value.recvLang && !resolveLang(settings.value.recvLang));

const noTranslateRaw = computed({
  get: () => settings.value.noTranslate.join('\n'),
  set: (v) => { settings.value.noTranslate = v.split('\n'); }
});

// ── 不用翻译的人 ──────────────────────────────────────────────
// 日志里的发送者可能是 "Alice Resident"、"alice"、"Display Name (bob.smith)" 等形式；
// 名单里填显示名、用户名（点或空格都行）都能匹配
const normName = (x) => (x || '').trim().toLowerCase().replace(/\./g, ' ').replace(/\s+resident$/, '').replace(/\s+/g, ' ');
const senderNameKeys = (sender) => {
  const raw = (sender || '').trim();
  const keys = new Set([normName(raw)]);
  const m = raw.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  let username = '';
  if (m) {
    if (m[1]) keys.add(normName(m[1]));
    keys.add(normName(m[2]));
    username = m[2].trim();
  }
  keys.delete('');
  return { keys, username };
};
const isNoTranslate = (sender) => {
  const { keys } = senderNameKeys(sender);
  return (settings.value.noTranslate || []).some(n => { const k = normName(n); return k && keys.has(k); });
};
const toggleNoTranslate = (sender) => {
  const { keys, username } = senderNameKeys(sender);
  const list = settings.value.noTranslate || [];
  if (isNoTranslate(sender)) {
    settings.value.noTranslate = list.filter(n => !keys.has(normName(n)));
  } else {
    // 优先记用户名，显示名改了也还能认出来
    settings.value.noTranslate = [...list.filter(n => n.trim()), username || (sender || '').trim()];
  }
};

// 所有大模型请求共用的配置
const llmConfig = (extra = {}) => ({
  apiKey:   settings.value.apiKey,
  baseUrl:  settings.value.baseUrl,
  model:    settings.value.model,
  glossary: settings.value.glossary,
  ...extra,
});

// ── 全局快捷键 ────────────────────────────────────────────────
const hotkeyRecording = ref(false);
const hotkeyError = ref('');

const applyHotkey = async () => {
  hotkeyError.value = '';
  try {
    await invoke('set_global_shortcut', { accelerator: settings.value.hotkey || '' });
  } catch (e) {
    hotkeyError.value = i18n.value.hotkeyFail + e;
  }
};

// KeyboardEvent.code -> global-hotkey 认识的按键名
const hotkeyKeyName = (code) => {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  return code;
};
const MODIFIER_CODES = ['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight'];

const recordHotkey = (e) => {
  if (!hotkeyRecording.value) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.code === 'Escape') { hotkeyRecording.value = false; return; }
  if (MODIFIER_CODES.includes(e.code)) return; // 等主键
  const mods = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  const isFn = /^F([1-9]|1[0-2])$/.test(e.code);
  if (!mods.length && !isFn) {
    hotkeyError.value = i18n.value.hotkeyNeedModifier;
    return;
  }
  settings.value.hotkey = [...mods, hotkeyKeyName(e.code)].join('+');
  hotkeyRecording.value = false;
  saveSettings();
  applyHotkey();
};

const clearHotkey = () => {
  settings.value.hotkey = '';
  hotkeyRecording.value = false;
  saveSettings();
  applyHotkey();
};

const toggleBlacklist = (targetId) => {
  if (isTargetBlacklisted(targetId)) {
    settings.value.blacklist = settings.value.blacklist.filter(n => n.toLowerCase() !== targetId.toLowerCase());
  } else {
    settings.value.blacklist.push(targetId);
  }
  saveSettings();
};

// ── 设置面板手风琴折叠 ───────────────────────────────────────
const openSections = ref(new Set(['connection']));
const toggleSection = (key) => {
  if (openSections.value.has(key)) {
    openSections.value.delete(key);
  } else {
    openSections.value.add(key);
  }
  openSections.value = new Set(openSections.value); // 触发响应式
};

// 监听并应用背景透明度
watch(() => settings.value.bgOpacity, (alpha) => {
  document.documentElement.style.setProperty('--bg-opacity', alpha);
}, { immediate: true });

// ── 翻译对方消息 ──────────────────────────────────────────────
const translateMessage = async (tab, msg) => {
  const key = `msg:${msgKey(msg)}`;
  const controller = startRequest(key);
  msg.translated = '';
  msg.error = '';
  msg.pending = true;

  const res = await LLMService.translateIncoming(
    msg.text,
    getHistoryContext(tab, msg),
    (chunk) => { msg.translated += chunk; },
    llmConfig({ targetLang: settings.value.recvLang }),
    { signal: controller.signal }
  );
  finishRequest(key, controller);
  msg.pending = false;
  if (!res.ok) msg.error = describeError(res);
  return res;
};

const retranslate = async (msg) => {
  const tab = activeChatTab.value;
  if (!tab) return;
  await translateMessage(tab, msg);
  persistState();
};

onMounted(async () => {
  // 恢复窗口状态并显示
  try {
    await restoreStateCurrent(63); // 63 = StateFlags.ALL
    await win.show();
  } catch (e) {
    console.error('State restore error:', e);
    await win.show(); // Fallback
  }

  // 监听移动/缩放时保存（加抖动限制，防止拖拽卡死）
  let saveTimer = null;
  const debouncedSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveWindowState(63).catch(() => {});
    }, 500);
  };
  win.onMoved(debouncedSave);
  win.onResized(debouncedSave);

  window.addEventListener('keydown', handleGlobalKeydown);

  // 读取持久化设置（兼容旧版单 key 格式，自动迁移）
  const legacySaved = localStorage.getItem('sl-translator-settings');
  const globalSaved  = localStorage.getItem(GLOBAL_SETTINGS_KEY);

  if (legacySaved && !globalSaved) {
    // 迁移旧格式
    try {
      const parsed = JSON.parse(legacySaved);
      if (parsed.targetLang && !parsed.recvLang) { parsed.recvLang = parsed.targetLang; }
      Object.assign(settings.value, parsed);
      // 写入新格式
      saveSettings();
      localStorage.removeItem('sl-translator-settings');
    } catch (_) {}
  } else if (globalSaved) {
    // 新格式：先加载全局
    try { Object.assign(settings.value, JSON.parse(globalSaved)); } catch (_) {}
    // 再加载上次选中账号的账号级设置
    if (settings.value.account) {
      try {
        const acctSaved = localStorage.getItem(accountSettingsKey(settings.value.account));
        if (acctSaved) Object.assign(settings.value, JSON.parse(acctSaved));
      } catch (_) {}
    }
  }

  settingsLoaded = true;

  // 启动时应用已保存的界面语言
  await applyUiLang();
  await applyHotkey();

  // 如果没有保存的路径，自动解析 %APPDATA%\Firestorm_x64 的真实路径
  if (!settings.value.logDir) {
    try {
      const defaultDir = await invoke('get_default_log_dir');
      if (defaultDir) {
        settings.value.logDir = defaultDir;
      }
    } catch (_) {}
  }

  // 有路径就自动扫描账号列表
  if (settings.value.logDir) {
    await refreshAccounts();
  }

  // 自动开启同步逻辑（当存在合法设置时）
  if (settingsValid.value) {
    toggleListening();
  }

  // 加载上一次保留的 UI VDOM 会话状态
  try {
    const savedState = await invoke('load_ui_state', { account: settings.value.account || '' });
    if (savedState) {
      chatTabs.value = JSON.parse(savedState);
    }
  } catch(e) {}

  let lastMsgHash = '';
  let lastMsgTime = 0;

  // 侦听后端日志推送
  await TauriBridge.onLogUpdate(async (payload) => {
    const source = payload.source || 'chat.txt';
    const msgContext = payload.msg;

    if (!msgContext?.includes(': ')) return;
    const colonIdx = msgContext.indexOf(': ');
    const sender   = msgContext.slice(0, colonIdx);
    const text     = msgContext.slice(colonIdx + 2);

    // 基础去重（防止 Firestorm 多文件记录同一个消息）
    const msgHash = `${source}||${sender}||${text}`;
    const now = Date.now();
    if (msgHash === lastMsgHash && (now - lastMsgTime) < 2000) {
      return;
    }
    lastMsgHash = msgHash;
    lastMsgTime = now;

    const isSystemMessage = sender.toLowerCase() === 'second life';
    const isGroupFile = source.toLowerCase().includes('group');
    const skipGroupMessage = isGroupFile && !settings.value.translateGroup;

    // 系统上下线提示：直接丢弃，不渲染不翻译
    if (isSystemMessage) return;

    // 如果未开启群聊翻译，且这是个群组日志：直接丢弃，不建 Tab 不渲染
    if (skipGroupMessage) return;

    // 定位或创建 Tab
    let tabInfo = chatTabs.value.find(t => t.id === source);
    if (!tabInfo) {
      let title = source.replace(/\.txt$/i, '').replace(/\.log$/i, '');
      if (PUBLIC_CHAT_FILES.includes(source.toLowerCase())) {
        title = 'nearby';
      }
      chatTabs.value.push({ id: source, title, messages: [], hasUnread: true });
      tabInfo = chatTabs.value[chatTabs.value.length - 1];
    } else {
      tabInfo.hidden = false;
    }

    // 标红点
    if (activeChatTabId.value !== source) {
      tabInfo.hasUnread = true;
    }

    tabInfo.messages.push({ id: newMsgId(), time: new Date().toLocaleTimeString(), sender, text, translated: '' });
    const reactiveItem = tabInfo.messages[tabInfo.messages.length - 1];

    persistState();
    // 仅当用户本来就在底部时才自动跟随新消息
    if (activeChatTabId.value === source) scrollToBottom(true, false);

    // 自己发的、黑名单用户或频道：渲染上屏但不翻译
    const isBlacklisted = settings.value.blacklist.some(
      name => name.trim().toLowerCase() === sender.toLowerCase() ||
              name.trim().toLowerCase() === source.toLowerCase() ||
              name.trim().toLowerCase() === tabInfo.title.toLowerCase()
    );
    if (isMySelf(sender) || isBlacklisted) return;

    // 不用翻译的人：照常显示，不调接口（需要时可点气泡上的"重新翻译"手动翻）
    if (isNoTranslate(sender)) return;

    // 附近频道白名单过滤（私聊不受影响）
    const isNearbyChan = PUBLIC_CHAT_FILES.includes(source.toLowerCase());
    if (isNearbyChan && settings.value.nearbyWhitelistEnabled) {
      const wl = settings.value.nearbyWhitelist;
      const senderLower = sender.toLowerCase();
      // 白名单匹配：用户名完全匹配 OR 括号格式 "Display (username)" 中的任一部分匹配
      const inWhitelist = wl.some(name => {
        const n = name.trim().toLowerCase();
        if (!n) return false;
        return senderLower === n || senderLower.includes(n);
      });
      if (!inWhitelist) return;
    }

    // 关键词屏蔽：消息原文中包含屏蔽词则不翻译
    const kbl = settings.value.keywordBlocklist;
    const textLower = text.toLowerCase();
    const hasBlockedKeyword = kbl.some(kw => {
      const k = kw.trim().toLowerCase();
      return k && textLower.includes(k);
    });
    if (hasBlockedKeyword) return;

    // 已经是目标语言：不调用接口
    if (looksLikeTarget(text, settings.value.recvLang)) return;

    const res = await translateMessage(tabInfo, reactiveItem);
    // 被取消（例如切换了账号）：不再写历史和存档
    if (res.aborted) return;

    // 翻译完成后若用户仍在底部则跟随滚动
    if (activeChatTabId.value === source) scrollToBottom(true, false);

    // 公屏频道不存档，仅私聊保存
    if (!isNearbyChan && reactiveItem.translated.trim()) {
      invoke('append_translation_history', {
        account: settings.value.account || '',
        source,
        timestamp: reactiveItem.time,
        sender,
        text,
        translated: reactiveItem.translated
      }).catch(e => console.error("保存历史记录失败", e));
    }
    persistState();
  });

  // 侦听全局快捷键
  // 窗口已由 Rust 端唤出，这里负责回到聊天页并聚焦输入框
  await TauriBridge.onShortcutTrigger(async () => {
    if (activeTab.value === TAB_SETTINGS && !hotkeyRecording.value) activeTab.value = TAB_CHAT;
    await nextTick();
    composerRef.value?.focus();
  });

  // 检查更新
  UpdateService.checkUpdate().then(info => {
    if (info && info.hasUpdate) {
      updateAvailable.value = true;
      updateInfo.value = info;
    }
  });
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleGlobalKeydown);
  inflight.forEach(c => c.abort());
});

watch([activeTab, isListening], ([newTab, newListening]) => {
  if (newTab === TAB_CHAT && newListening) {
    // 切回聊天页强制滚底
    scrollToBottom(false, true);
  }
});

// ── 设置操作 ──────────────────────────────────────────────────────
// 全局设置键（API Key、模型等共享配置）
const GLOBAL_SETTINGS_KEY = 'sl-translator-global';
// 账号级设置键（黑名单、接收语言等随账号变化）
const accountSettingsKey = (account) => `sl-settings-${account}`;
// 全局字段清单
const GLOBAL_FIELDS = ['logDir', 'account', 'apiKey', 'baseUrl', 'model', 'uiLang', 'contextCount', 'translateGroup', 'viewerType', 'bgOpacity', 'nearbyWhitelistEnabled', 'sendTone', 'backTranslate', 'hotkey'];

const saveSettings = () => {
  const global = {};
  GLOBAL_FIELDS.forEach(k => { global[k] = settings.value[k]; });
  localStorage.setItem(GLOBAL_SETTINGS_KEY, JSON.stringify(global));

  if (settings.value.account) {
    const perAccount = {
      account:            settings.value.account,
      recvLang:           settings.value.recvLang,
      blacklist:          settings.value.blacklist,
      nearbyWhitelist:    settings.value.nearbyWhitelist,
      keywordBlocklist:   settings.value.keywordBlocklist,
      glossary:           settings.value.glossary,
      noTranslate:        settings.value.noTranslate,
    };
    localStorage.setItem(accountSettingsKey(settings.value.account), JSON.stringify(perAccount));
  }
};

// 设置改动后自动保存（防抖），不再依赖手动点"保存"
let settingsLoaded = false;
let autoSaveTimer = null;
watch(settings, () => {
  if (!settingsLoaded) return;
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(saveSettings, 400);
}, { deep: true });

// 切换账号时加载该账号的专属设置
const loadAccountSettings = () => {
  if (!settings.value.account) return;
  try {
    const saved = localStorage.getItem(accountSettingsKey(settings.value.account));
    if (saved) {
      const parsed = JSON.parse(saved);
      // 只覆盖账号级字段，不影响 API Key 等全局字段
      settings.value.recvLang          = parsed.recvLang          ?? settings.value.recvLang;
      settings.value.blacklist          = parsed.blacklist          ?? [];
      settings.value.nearbyWhitelist    = parsed.nearbyWhitelist    ?? [];
      settings.value.keywordBlocklist   = parsed.keywordBlocklist   ?? [];
      settings.value.glossary           = parsed.glossary           ?? [];
      settings.value.noTranslate        = parsed.noTranslate        ?? [];
    } else {
      // 新账号：重置账号级字段为默认值
      settings.value.blacklist        = [];
      settings.value.nearbyWhitelist  = [];
      settings.value.keywordBlocklist = [];
      settings.value.glossary         = [];
      settings.value.noTranslate      = [];
    }
  } catch (_) {}
};

const defaultChatTabs = () => [
  { id: 'chat.txt', title: 'nearby', messages: [], hasUnread: false }
];

// 切换账号：换账号级设置、换聊天记录，正在监听时改为监听新账号的目录
const onAccountChange = async () => {
  clearTimeout(autoSaveTimer);
  loadAccountSettings();
  saveSettings();

  // 旧账号的请求作废，避免结果写进新账号的界面
  inflight.forEach(c => c.abort());
  aiReplyMap.value = {};
  closeComposer();
  closeAiChat();

  let tabs = defaultChatTabs();
  try {
    const saved = await invoke('load_ui_state', { account: settings.value.account || '' });
    if (saved) tabs = JSON.parse(saved);
  } catch (_) {}
  chatTabs.value = tabs;
  tabRenderLimits.value = {};
  if (!chatTabs.value.some(t => t.id === activeChatTabId.value && !t.hidden)) {
    activeChatTabId.value = chatTabs.value[0]?.id || 'chat.txt';
  }

  if (isListening.value) {
    try { await TauriBridge.stopLogWatcher(); } catch (e) { console.error(e); }
    isListening.value = false;
    await toggleListening();
  }
};

const browseLogDir = async () => {
  // 调用后端 open_dialog 指令
  try {
    const dir = await invoke('open_folder_dialog');
    if (dir) {
      settings.value.logDir = dir;
      await refreshAccounts();
    }
  } catch (e) {
    alert('打开文件夹失败，请手动粘贴路径。\n' + e);
  }
};

const refreshAccounts = async () => {
  if (!settings.value.logDir) return;
  try {
    accountList.value = await invoke('list_accounts', { logDir: settings.value.logDir });
  } catch (e) {
    accountList.value = [];
  }
};

// 切换客户端：自动填充日志目录并重新扫描账号
const selectViewer = async (viewerType) => {
  settings.value.viewerType = viewerType;
  if (viewerType === 'custom') return;  // 自定义时不覆盖路径
  try {
    const dir = await invoke('get_viewer_log_dir', { viewer: viewerType });
    if (dir) {
      settings.value.logDir = dir;
      await refreshAccounts();
    }
  } catch (e) {
    console.error('获取客户端路径失败:', e);
  }
};

// ── 监听控制 ──────────────────────────────────────────────────────
const testApiStatus = ref('idle');
const testApiMessage = ref('');

const testApiConnection = async () => {
  if (!settings.value.apiKey) {
    testApiStatus.value = 'error';
    testApiMessage.value = i18n.value.testApiNoKey;
    return;
  }

  testApiStatus.value = 'testing';
  testApiMessage.value = i18n.value.testApiConnecting;
  saveSettings();

  const res = await LLMService.translateIncoming('Hello, nice to meet you', [], () => {},
    llmConfig({ targetLang: settings.value.recvLang || 'English', glossary: [] }));

  if (!res.ok) {
    testApiStatus.value = 'error';
    testApiMessage.value = describeError(res);
  } else if (res.text.trim().length > 0) {
    testApiStatus.value = 'success';
    testApiMessage.value = i18n.value.testApiSuccess;
  } else {
    testApiStatus.value = 'error';
    testApiMessage.value = i18n.value.testApiFail;
  }
};

const toggleListening = async () => {
  errorMessage.value = '';

  if (isListening.value) {
    try {
      await TauriBridge.stopLogWatcher();
      isListening.value = false;
    } catch (e) {
      console.error(e);
    }
    return;
  }

  if (!settings.value.logDir || !settings.value.account) {
    activeTab.value = TAB_SETTINGS;
    errorMessage.value = i18n.value.settingsIncomplete;
    return;
  }
  saveSettings();
  try {
    const watchPath = `${settings.value.logDir}\\${settings.value.account}`;
    await TauriBridge.startLogWatcher(watchPath);
    isListening.value = true;
    activeTab.value   = TAB_CHAT;
  } catch (e) {
    errorMessage.value = i18n.value.engineStartFail + e;
  }
};

// ── 底部输入栏：翻译我的话 / 问 AI ─────────────────────────────
const composerMode = ref('translate');   // 'translate' | 'ask'
const composerInput = ref('');
const composerRef = ref(null);
// 翻译模式的结果
const composer = ref({ visible: false, loading: false, source: '', translation: '', back: '', error: '' });
// 问 AI 模式的结果
const aiChat = ref({ visible: false, loading: false, result: '', error: '' });

// 语气和目标语言按频道记忆
const activeTone = computed({
  get: () => activeChatTab.value?.tone || settings.value.sendTone || 'natural',
  set: (v) => { if (activeChatTab.value) { activeChatTab.value.tone = v; persistState(); } }
});
const activeSendLang = computed({
  get: () => activeChatTab.value?.sendLang || 'auto',
  set: (v) => { if (activeChatTab.value) { activeChatTab.value.sendLang = v; persistState(); } }
});

const utf8Bytes = (s) => new TextEncoder().encode(s).length;
const composerBytes = computed(() => utf8Bytes(composer.value.translation || ''));
const composerOverLimit = computed(() => composerBytes.value > SL_MSG_BYTE_LIMIT);

const runTranslate = async (text) => {
  const tab = activeChatTab.value;
  const controller = startRequest('composer');
  composer.value = { visible: true, loading: true, source: text, translation: '', back: '', error: '' };

  const res = await LLMService.translateOutgoing(
    text,
    {
      otherMessages: getOtherRawMessages(tab),
      tone:          activeTone.value,
      targetLang:    activeSendLang.value,
      myLang:        settings.value.recvLang || 'Simplified Chinese',
      withBack:      settings.value.backTranslate,
    },
    ({ translation, back }) => {
      if (controller.signal.aborted) return;
      composer.value.translation = translation;
      composer.value.back = back;
    },
    llmConfig(),
    { signal: controller.signal }
  );
  finishRequest('composer', controller);
  // 请求已被新的请求或关闭操作取消：界面状态归后来者管
  if (res.aborted) return;

  composer.value.loading = false;
  composer.value.translation = res.translation;
  composer.value.back = res.back;
  if (!res.ok) {
    composer.value.error = describeError(res);
    return;
  }

  if (res.translation) {
    await copyContent(res.translation);
    invoke('append_translation_history', {
      account: settings.value.account || '',
      source: activeChatTabId.value,
      timestamp: new Date().toLocaleTimeString(),
      sender: settings.value.account || 'Me',
      text,
      translated: res.translation
    }).catch(e => console.error("保存历史记录失败", e));
  }
};

const runAsk = async (prompt) => {
  const tab = activeChatTab.value;
  const controller = startRequest('ask');
  aiChat.value = { visible: true, loading: true, result: '', error: '' };

  const res = await LLMService.chatStream(
    prompt,
    tab ? tab.messages.slice(-8) : [],
    (chunk) => { if (!controller.signal.aborted) aiChat.value.result += chunk; },
    llmConfig(),
    { signal: controller.signal }
  );
  finishRequest('ask', controller);
  if (res.aborted) return;
  aiChat.value.loading = false;
  if (!res.ok) aiChat.value.error = describeError(res);
};

const submitComposer = () => {
  const text = composerInput.value.trim();
  if (!text) return;
  composerInput.value = '';
  if (composerMode.value === 'translate') runTranslate(text);
  else runAsk(text);
};

// 输入法组字时的回车是确认候选/字母，不是发送
const onComposerEnter = (e) => {
  if (e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  submitComposer();
};

const regenerate = () => {
  if (composer.value.source) runTranslate(composer.value.source);
};

const closeComposer = () => {
  cancelRequest('composer');
  composer.value = { visible: false, loading: false, source: '', translation: '', back: '', error: '' };
};
const closeAiChat = () => {
  cancelRequest('ask');
  aiChat.value = { visible: false, loading: false, result: '', error: '' };
};

// ── AI 气泡：建议回复 ──────────────────────────────────────────
const aiReplyMap = ref({});   // { 'tabId:msgKey': { loading, suggestions, raw, error } }
const getAiReplyKey = (tabId, msg) => `${tabId}:${msgKey(msg)}`;

const askHowToReply = async (msg) => {
  const key = getAiReplyKey(activeChatTabId.value, msg);
  if (aiReplyMap.value[key]?.loading) return;

  const tab = activeChatTab.value;
  const controller = startRequest(`reply:${key}`);
  aiReplyMap.value[key] = { loading: true, suggestions: [], raw: '', error: '' };

  const res = await LLMService.suggestReplies(
    msg,
    tab ? tab.messages.slice(-8) : [],
    { tone: activeTone.value, myLang: settings.value.recvLang || 'Simplified Chinese' },
    (suggestions, raw) => {
      const box = aiReplyMap.value[key];
      if (!box || controller.signal.aborted) return;
      box.suggestions = suggestions;
      box.raw = raw;
    },
    llmConfig(),
    { signal: controller.signal }
  );
  finishRequest(`reply:${key}`, controller);

  const box = aiReplyMap.value[key];
  if (!box || res.aborted) return;
  box.loading = false;
  box.suggestions = res.suggestions;
  box.raw = res.raw;
  if (!res.ok) box.error = describeError(res);
};

const closeAiReply = (key) => {
  cancelRequest(`reply:${key}`);
  const next = { ...aiReplyMap.value };
  delete next[key];
  aiReplyMap.value = next;
};

// ── Esc：从最上层开始逐层关闭 ─────────────────────────────────
const handleGlobalKeydown = (e) => {
  if (e.key !== 'Escape') return;
  if (activeTab.value === TAB_SETTINGS) { activeTab.value = TAB_CHAT; return; }
  const replyKeys = Object.keys(aiReplyMap.value);
  if (replyKeys.length) { closeAiReply(replyKeys[replyKeys.length - 1]); return; }
  if (composer.value.visible) { closeComposer(); return; }
  if (aiChat.value.visible) { closeAiChat(); return; }
};

// ── 工具 ──────────────────────────────────────────────────────────
// 判断聊天区是否已经接近底部（距底 <=100px 视为在底部）
const isNearBottom = () => {
  const el = chatScrollRef.value;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight <= 100;
};

// force=true 时无论位置都滚底（切换 Tab、首次加载等场景）
const scrollToBottom = (smooth = false, force = false) => {
  nextTick(() => {
    if (chatScrollRef.value && (force || isNearBottom())) {
      if (smooth) {
        chatScrollRef.value.scrollTo({ top: chatScrollRef.value.scrollHeight, behavior: 'smooth' });
      } else {
        chatScrollRef.value.scrollTop = chatScrollRef.value.scrollHeight;
      }
    }
  });
};

const openHistoryFolder = async () => {
  await invoke('open_history_folder', { account: settings.value.account || '' });
};

const openTutorial = async () => {
  try {
    await openUrl('https://github.com/yarnbyte/AI-SecondLife-Talk/blob/main/README.md');
  } catch (e) {
    console.error('打开教程链接失败:', e);
  }
};
</script>

<template>
  <div class="app-root">

    <div v-if="updateAvailable" class="update-banner">
      <Sparkles :size="12" style="margin-right: 4px;" />
      <span>{{ i18n.updateAvailable.replace('{v}', updateInfo.remoteVersion) }}</span>
      <button class="btn-update" @click="UpdateService.openUpdateUrl(updateInfo.url)">{{ i18n.updateBtn }}</button>
      <button class="btn-update-close" @click="updateAvailable = false"><X :size="10" /></button>
    </div>

    <!-- ── 极光背景装饰 ────────────────────────────────────────── -->
    <div class="aurora-fx"></div>

    <!-- ── 顶栏 ──────────────────────────────────────────────── -->
    <header class="title-bar" @mousedown="handleDrag">
      <div class="brand">
        <Sparkles :size="15" class="brand-icon" />
        <span class="brand-name">{{ i18n.appTitle }}</span>
      </div>

      <div class="title-actions" @mousedown.stop>
        <!-- 同步状态 -->
        <button v-if="isListening" class="badge-listening" @click="toggleListening" style="cursor: pointer;" :title="i18n.stopListeningTitle">
          <Activity :size="12" class="pulse" /> {{ i18n.listeningInfo }}
        </button>
        <button v-else class="btn-start" @click="toggleListening">
          <Play :size="12" /> {{ i18n.startListening }}
        </button>

        <!-- 设置 -->
        <button
          class="ctrl-btn"
          :class="{ active: activeTab === TAB_SETTINGS }"
          :title="i18n.settingTitle"
          @click="activeTab = activeTab === TAB_SETTINGS ? TAB_CHAT : TAB_SETTINGS"
        >
          <Settings :size="14" />
        </button>

        <!-- 置顶 -->
        <button class="ctrl-btn ctrl-pin" :class="{ pinned: isPinned }" :title="isPinned ? i18n.unpinTitle : i18n.pinTitle" @click="togglePin">
          <Pin v-if="!isPinned" :size="14" />
          <PinOff v-else :size="14" />
        </button>

        <!-- 最小化 -->
        <button class="ctrl-btn" :title="i18n.minimizeTitle" @click="handleMinimize">
          <Minus :size="14" />
        </button>

        <!-- 关闭 -->
        <button class="ctrl-btn ctrl-close" :title="i18n.closeTitle" @click="handleClose">
          <X :size="14" />
        </button>
      </div>
    </header>

    <!-- ── 主体区 ──────────────────────────────────────────────── -->
    <div class="main-area">

      <!-- 设置面板 -->
      <Transition name="slide-down">
        <section class="settings-panel" v-if="activeTab === TAB_SETTINGS">

          <div class="settings-head">
            <span>{{ i18n.settingTitle }}</span>
            <button class="icon-btn" :title="i18n.closeLabel + ' (Esc)'" @click="activeTab = TAB_CHAT"><X :size="14" /></button>
          </div>

          <div v-if="errorMessage" class="error-banner">
            <span style="white-space: pre-wrap; flex: 1;">{{ errorMessage }}</span>
            <button class="icon-btn" :title="i18n.closeLabel" @click="errorMessage = ''"><X :size="12" /></button>
          </div>

          <!-- ① 连接 -->
          <div class="acc-group">
            <button class="acc-header" @click="toggleSection('connection')">
              <FolderOpen :size="13" />
              <span>{{ i18n.viewerLabel }} &amp; {{ i18n.slAccount }}</span>
              <span class="acc-arrow" :class="{ open: openSections.has('connection') }">›</span>
            </button>
            <div v-show="openSections.has('connection')" class="acc-body">
              <!-- 客户端 -->
              <div class="form-section">
                <label class="form-label">
                  {{ i18n.viewerLabel }}
                  <button class="help-icon-btn" :title="i18n.tutorialTitle" @click="openTutorial"
                    style="background:none;border:none;cursor:pointer;padding:0 2px;vertical-align:middle;opacity:0.7;color:rgba(255,255,255,0.85);">
                    <HelpCircle :size="13" />
                  </button>
                </label>
                <div class="viewer-selector">
                  <button class="viewer-btn" :class="{ active: settings.viewerType === 'firestorm' }" @click="selectViewer('firestorm')">{{ i18n.viewerFirestorm }}</button>
                  <button class="viewer-btn" :class="{ active: settings.viewerType === 'official' }"   @click="selectViewer('official')">{{ i18n.viewerOfficial }}</button>
                  <button class="viewer-btn" :class="{ active: settings.viewerType === 'custom' }"     @click="selectViewer('custom')">{{ i18n.viewerCustom }}</button>
                </div>
                <div class="input-row" v-if="settings.viewerType === 'custom'" style="margin-top:6px">
                  <input v-model="settings.logDir" class="form-input" :placeholder="i18n.logDirCustomHint" @change="refreshAccounts" />
                  <button class="btn-browse" @click="browseLogDir">{{ i18n.browseLabel }}</button>
                </div>
              </div>
              <!-- 账号 -->
              <div class="form-section" style="margin-bottom:0">
                <label class="form-label"><User :size="13" /> {{ i18n.slAccount }}</label>
                <div class="input-row">
                  <div class="select-wrap" style="flex:1">
                    <select v-model="settings.account" class="form-select" @change="onAccountChange">
                      <option value="" disabled>{{ i18n.slAccountDropTip }}</option>
                      <option v-for="acc in accountList" :key="acc" :value="acc">{{ acc }}</option>
                    </select>
                    <ChevronDown :size="14" class="select-chevron" />
                  </div>
                  <button class="btn-browse" @click="refreshAccounts" :title="i18n.refreshAccounts"><RotateCw :size="12" /></button>
                </div>
                <div class="form-hint" v-if="accountList.length === 0">{{ i18n.slAccountNoDirHint }}</div>
              </div>
            </div>
          </div>

          <!-- ② API 设置 -->
          <div class="acc-group">
            <button class="acc-header" @click="toggleSection('api')">
              <KeyRound :size="13" />
              <span>API</span>
              <span class="acc-arrow" :class="{ open: openSections.has('api') }">›</span>
            </button>
            <div v-show="openSections.has('api')" class="acc-body">
              <div class="form-section">
                <label class="form-label">{{ i18n.apiKeyLabel }}</label>
                <input v-model="settings.apiKey" type="password" class="form-input" placeholder="sk-xxxx..." />
              </div>
              <div class="form-section">
                <label class="form-label">{{ i18n.baseUrlLabel }}</label>
                <input v-model="settings.baseUrl" class="form-input" placeholder="https://api.deepseek.com/v1" />
              </div>
              <div class="form-section" style="margin-bottom:0">
                <label class="form-label">{{ i18n.modelLabel }}</label>
                <div class="input-row">
                  <input v-model="settings.model" class="form-input" placeholder="gpt-4o-mini" />
                  <button class="btn-browse" @click="testApiConnection" :disabled="testApiStatus === 'testing'" style="min-width: 76px;">
                    {{ testApiStatus === 'testing' ? i18n.testApiTesting : i18n.testApiBtn }}
                  </button>
                </div>
                <div v-if="testApiMessage" class="form-hint" :style="{ color: testApiStatus === 'success' ? '#10b981' : (testApiStatus === 'error' ? '#ef4444' : '#fbbf24') }" style="margin-top:6px;">
                  {{ testApiMessage }}
                </div>
              </div>
            </div>
          </div>

          <!-- ③ 翻译参数 -->
          <div class="acc-group">
            <button class="acc-header" @click="toggleSection('translate')">
              <MessageSquareDot :size="13" />
              <span>{{ i18n.secTranslation }}</span>
              <span class="acc-arrow" :class="{ open: openSections.has('translate') }">›</span>
            </button>
            <div v-show="openSections.has('translate')" class="acc-body">
              <div class="form-section">
                <label class="form-label">{{ i18n.recvLangConfig }}</label>
                <div class="select-wrap">
                  <select v-model="recvLangChoice" class="form-select">
                    <option v-for="o in LANG_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
                    <option :value="RECV_CUSTOM">{{ i18n.langOther }}</option>
                  </select>
                  <ChevronDown :size="14" class="select-chevron" />
                </div>
                <input v-if="recvLangChoice === RECV_CUSTOM" v-model.trim="settings.recvLang" class="form-input"
                  style="margin-top:6px" :placeholder="i18n.recvLangCustomPlc" />
                <div v-if="recvLangChoice === RECV_CUSTOM && recvLangUnknown" class="form-hint" style="color:#fbbf24;">{{ i18n.recvLangUnknown }}</div>
              </div>
              <div class="form-section">
                <label class="form-label">{{ i18n.ctxCountSetting }}</label>
                <input v-model.number="settings.contextCount" type="number" class="form-input" placeholder="5" />
              </div>
              <div class="form-section">
                <label class="form-label">{{ i18n.defaultToneLabel }}</label>
                <div class="select-wrap">
                  <select v-model="settings.sendTone" class="form-select">
                    <option v-for="t in TONES" :key="t" :value="t">{{ i18n['tone_' + t] }}</option>
                  </select>
                  <ChevronDown :size="14" class="select-chevron" />
                </div>
              </div>
              <div class="form-section">
                <label class="form-label">{{ i18n.glossaryLabel }}</label>
                <textarea class="form-input"
                  style="resize:vertical;min-height:65px;font-size:12px;line-height:1.5;"
                  v-model="glossaryRaw"
                  :placeholder="i18n.glossaryPlc"
                />
              </div>
              <div class="form-section">
                <label class="form-label" style="text-transform:none;letter-spacing:0;font-weight:500;">
                  <input type="checkbox" v-model="settings.backTranslate" style="vertical-align:middle;margin-right:5px;" />
                  {{ i18n.backTranslateCb }}
                </label>
              </div>
              <div class="form-section" style="margin-bottom:0">
                <label class="form-label" style="text-transform:none;letter-spacing:0;font-weight:500;">
                  <input type="checkbox" v-model="settings.translateGroup" style="vertical-align:middle;margin-right:5px;" />
                  {{ i18n.groupCb }}
                </label>
              </div>
            </div>
          </div>

          <!-- ④ 过滤规则 -->
          <div class="acc-group">
            <button class="acc-header" @click="toggleSection('filter')">
              <BellOff :size="13" />
              <span>{{ i18n.secFilter }}</span>
              <span class="acc-arrow" :class="{ open: openSections.has('filter') }">›</span>
            </button>
            <div v-show="openSections.has('filter')" class="acc-body">
              <div class="form-section">
                <label class="form-label" style="text-transform:none;letter-spacing:0;font-weight:500;">
                  <input type="checkbox" v-model="settings.nearbyWhitelistEnabled" style="vertical-align:middle;margin-right:5px;" />
                  {{ i18n.nearbyWhitelistCb }}
                </label>
                <textarea v-if="settings.nearbyWhitelistEnabled"
                  class="form-input"
                  style="margin-top:6px;resize:vertical;min-height:65px;font-size:12px;line-height:1.5;"
                  v-model="nearbyWhitelistRaw"
                  :placeholder="i18n.nearbyWhitelistPlc"
                />
              </div>
              <div class="form-section">
                <label class="form-label" style="text-transform:none;letter-spacing:0;">{{ i18n.noTranslateLabel }}</label>
                <textarea class="form-input"
                  style="resize:vertical;min-height:55px;font-size:12px;line-height:1.5;"
                  v-model="noTranslateRaw"
                  :placeholder="i18n.noTranslatePlc"
                />
              </div>
              <div class="form-section" style="margin-bottom:0">
                <label class="form-label">{{ i18n.keywordBlocklistLabel }}</label>
                <textarea class="form-input"
                  style="resize:vertical;min-height:55px;font-size:12px;line-height:1.5;"
                  v-model="keywordBlocklistRaw"
                  :placeholder="i18n.keywordBlocklistPlc"
                />
              </div>
            </div>
          </div>

          <!-- ⑤ 界面 -->
          <div class="acc-group">
            <button class="acc-header" @click="toggleSection('appearance')">
              <Settings :size="13" />
              <span>{{ i18n.secAppearance }}</span>
              <span class="acc-arrow" :class="{ open: openSections.has('appearance') }">›</span>
            </button>
            <div v-show="openSections.has('appearance')" class="acc-body">
              <div class="form-section">
                <label class="form-label" style="display:flex;justify-content:space-between;">
                  <span>{{ i18n.windowOpacityLabel }}</span>
                  <span style="opacity:0.7;">{{ Math.round(settings.bgOpacity * 100) }}%</span>
                </label>
                <input type="range" v-model.number="settings.bgOpacity" min="0" max="1" step="0.05"
                  style="width:100%;accent-color:var(--accent);cursor:pointer;" />
              </div>
              <div class="form-section">
                <label class="form-label">{{ i18n.hotkeyLabel }}</label>
                <div class="input-row">
                  <input
                    class="form-input hotkey-input"
                    :class="{ recording: hotkeyRecording }"
                    readonly
                    :value="hotkeyRecording ? i18n.hotkeyRecording : (settings.hotkey || i18n.hotkeyOff)"
                    :placeholder="i18n.hotkeyPlc"
                    @click="hotkeyRecording = true; hotkeyError = ''"
                    @blur="hotkeyRecording = false"
                    @keydown="recordHotkey"
                  />
                  <button class="btn-browse" :title="i18n.hotkeyClear" @click="clearHotkey"><X :size="12" /></button>
                </div>
                <div v-if="hotkeyError" class="form-hint" style="color:#ef4444;">{{ hotkeyError }}</div>
              </div>
              <div class="form-section" style="margin-bottom:0">
                <label class="form-label">{{ i18n.uiLangLabel }}</label>
                <div class="select-wrap">
                  <select v-model="settings.uiLang" class="form-select" @change="applyUiLang">
                    <option value="zh-CN">简体中文</option>
                    <option value="en-US">English</option>
                    <option value="custom">Custom (i18n.json)</option>
                  </select>
                  <ChevronDown :size="14" class="select-chevron" />
                </div>
              </div>
            </div>
          </div>

          <!-- 底部操作 -->
          <div style="display:flex;gap:8px;margin-top:12px;">
            <button class="btn-secondary" @click="openHistoryFolder" :title="i18n.viewHistory">
              <BookText :size="14" />
            </button>
            <button class="btn-secondary" @click="openTutorial" :title="i18n.tutorialTitle">
              <HelpCircle :size="14" />
            </button>
            <button class="btn-save" style="flex:1;" @click="saveSettings">{{ i18n.saveBtn }}</button>
          </div>

        </section>
      </Transition>


      <!-- API Key 快速条（开启监听后若未填会提示，可关闭） -->
      <div class="apikey-bar" v-if="isListening && !settings.apiKey && !apiKeyBarDismissed">
        <KeyRound :size="13" class="apikey-icon" />
        <span class="apikey-hint">{{ i18n.apiKeyFloatTip }}</span>
        <input
          v-model="settings.apiKey"
          type="password"
          class="apikey-input"
          placeholder="sk-xxxx..."
          @change="saveSettings"
        />
        <button class="icon-btn" :title="i18n.closeLabel" @click="apiKeyBarDismissed = true"><X :size="12" /></button>
      </div>

      <!-- 选项卡展示区 -->
      <div class="chat-tab-bar" v-if="activeTab === TAB_CHAT && isListening" ref="tabBarRef" @wheel.prevent="handleTabScroll">
        <div
          v-for="t in visibleTabs"
          :key="t.id"
          class="chat-tab-item"
          :class="{ active: activeChatTabId === t.id, unread: t.hasUnread }"
          @click="switchTab(t.id)">
          <span class="tab-title">{{ PUBLIC_CHAT_FILES.includes(t.id) ? i18n.nearbyTab : t.title }}</span>
          <button class="tab-close tab-ctrl-btn" :title="i18n.muteChanTip" @click.stop="toggleBlacklist(t.id)">
            <BellOff v-if="isTargetBlacklisted(t.id)" :size="10" />
            <Bell v-else :size="10" />
          </button>
          <button class="tab-close" @click.stop="closeTab(t.id)" v-if="!PUBLIC_CHAT_FILES.includes(t.id)"><X :size="10" /></button>
        </div>
      </div>

      <!-- 聊天面板 -->
      <div class="chat-list" ref="chatScrollRef" @scroll="handleChatScroll">
        <div
          v-for="msg in activeTabMessages"
          :key="msgKey(msg)"
          class="message-group"
          :class="{ 'self-msg': isMySelf(msg.sender) }"
        >
          <div class="message-meta">
            <span class="msg-sender">{{ msg.sender }}</span>
            <span class="msg-time">{{ msg.time }}</span>
            <span v-if="msg.sender !== 'System' && !isMySelf(msg.sender) && isNoTranslate(msg.sender)" class="msg-tag">{{ i18n.noTranslateTag }}</span>
          </div>
          <div class="message-bubble group">
            <div class="source-text">{{ msg.text }}</div>
            <div class="translate-text" v-if="msg.translated && msg.translated.trim() !== msg.text.trim()">{{ msg.translated }}</div>
            <div class="msg-error" v-if="msg.error">{{ msg.error }}</div>
            <!-- 气泡操作行 -->
            <div class="bubble-actions">
              <button class="bubble-action-btn" @click="copyContent(msg.text)" :title="i18n.copyOriginal">
                <Copy :size="11" />
              </button>
              <button class="bubble-action-btn" v-if="msg.translated && msg.translated !== msg.text" @click="copyContent(msg.translated)" :title="i18n.copyTranslation">
                <MessageSquareDot :size="11" />
              </button>
              <template v-if="!isMySelf(msg.sender) && msg.sender !== 'System'">
                <button class="bubble-action-btn" :class="{ loading: msg.pending }" @click="retranslate(msg)" :title="i18n.retranslate">
                  <RotateCw :size="11" />
                </button>
                <button
                  class="bubble-action-btn"
                  @click="askHowToReply(msg)"
                  :title="i18n.suggestReply"
                  :class="{ 'loading': aiReplyMap[getAiReplyKey(activeChatTabId, msg)]?.loading }"
                >
                  <Sparkles :size="11" />
                </button>
                <button
                  class="bubble-action-btn"
                  :title="isNoTranslate(msg.sender) ? i18n.noTranslateRemove : i18n.noTranslateAdd"
                  @click="toggleNoTranslate(msg.sender)"
                >
                  <UserCheck v-if="isNoTranslate(msg.sender)" :size="11" />
                  <UserX v-else :size="11" />
                </button>
              </template>
            </div>
          </div>
          <!-- AI 建议回复展开区：关闭按钮始终可用，加载中关闭会取消请求 -->
          <div v-if="aiReplyMap[getAiReplyKey(activeChatTabId, msg)]" class="ai-reply-box">
            <div class="ai-reply-head">
              <span>{{ i18n.suggestReply }}</span>
              <button class="icon-btn" :title="i18n.closeLabel + ' (Esc)'" @click="closeAiReply(getAiReplyKey(activeChatTabId, msg))"><X :size="12" /></button>
            </div>
            <template v-for="box in [aiReplyMap[getAiReplyKey(activeChatTabId, msg)]]" :key="'box'">
              <button
                v-for="(s, si) in box.suggestions"
                :key="si"
                class="suggestion-item"
                :title="i18n.copyResult"
                @click="copyContent(s.reply)"
              >
                <span class="suggestion-reply">{{ s.reply }}</span>
                <span class="suggestion-meaning" v-if="s.meaning">{{ s.meaning }}</span>
              </button>
              <span v-if="box.loading && !box.suggestions.length" class="ai-thinking">{{ i18n.thinking }}</span>
              <span v-if="box.error" class="msg-error">{{ box.error }}</span>
            </template>
          </div>
        </div>
      </div>

      <!-- 底部输入栏 -->
      <div class="ai-chat-panel" v-if="activeTab === TAB_CHAT && isListening">
        <div v-if="copiedHint" class="copied-hint">{{ i18n.copied }}</div>
        <div v-if="isTargetBlacklisted(activeChatTabId)" class="blacklist-overlay-msg">
          {{ i18n.mutedOverlay }}
        </div>
        <template v-else>
          <!-- 翻译结果 -->
          <div v-if="composerMode === 'translate' && composer.visible" class="ai-chat-result">
            <div class="result-source">{{ composer.source }}</div>
            <div class="ai-chat-result-text result-translation">
              <span v-if="composer.loading && !composer.translation" class="ai-thinking">{{ i18n.thinking }}</span>
              <span v-else>{{ composer.translation }}</span>
            </div>
            <div v-if="composer.back" class="result-back"><span class="result-back-label">{{ i18n.backLabel }}</span>{{ composer.back }}</div>
            <div v-if="composerOverLimit" class="msg-error">{{ i18n.overLimit.replace('{n}', composerBytes).replace('{max}', SL_MSG_BYTE_LIMIT) }}</div>
            <div v-if="composer.error" class="msg-error">{{ composer.error }}</div>
            <div class="ai-chat-result-actions">
              <button v-if="composer.translation && !composer.loading" class="bubble-action-btn" @click="copyContent(composer.translation)">
                <Copy :size="11" /> {{ i18n.copyResult }}
              </button>
              <button v-if="!composer.loading" class="bubble-action-btn" @click="regenerate">
                <RotateCw :size="11" /> {{ i18n.regenerate }}
              </button>
              <button class="bubble-action-btn danger" style="margin-left:auto;" :title="i18n.closeLabel + ' (Esc)'" @click="closeComposer">
                <X :size="11" /> {{ i18n.closeLabel }}
              </button>
            </div>
          </div>
          <!-- 问 AI 结果 -->
          <div v-if="composerMode === 'ask' && aiChat.visible" class="ai-chat-result">
            <div class="ai-chat-result-text">
              <span v-if="aiChat.loading && !aiChat.result" class="ai-thinking">{{ i18n.thinking }}</span>
              <span v-else>{{ aiChat.result }}</span>
            </div>
            <div v-if="aiChat.error" class="msg-error">{{ aiChat.error }}</div>
            <div class="ai-chat-result-actions">
              <button v-if="aiChat.result && !aiChat.loading" class="bubble-action-btn" @click="copyContent(aiChat.result)">
                <Copy :size="11" /> {{ i18n.copyResult }}
              </button>
              <button class="bubble-action-btn danger" style="margin-left:auto;" :title="i18n.closeLabel + ' (Esc)'" @click="closeAiChat">
                <X :size="11" /> {{ i18n.clearResult }}
              </button>
            </div>
          </div>
          <!-- 工具行：模式 / 语气 / 目标语言 -->
          <div class="composer-toolbar">
            <div class="mode-switch">
              <button :class="{ active: composerMode === 'translate' }" @click="composerMode = 'translate'">
                <Languages :size="11" /> {{ i18n.modeTranslate }}
              </button>
              <button :class="{ active: composerMode === 'ask' }" @click="composerMode = 'ask'">
                <Bot :size="11" /> {{ i18n.modeAsk }}
              </button>
            </div>
            <template v-if="composerMode === 'translate'">
              <label class="mini-select">
                <span>{{ i18n.toneLabel }}</span>
                <select v-model="activeTone">
                  <option v-for="t in TONES" :key="t" :value="t">{{ i18n['tone_' + t] }}</option>
                </select>
              </label>
              <label class="mini-select">
                <span>{{ i18n.sendLangLabel }}</span>
                <select v-model="activeSendLang">
                  <option value="auto">{{ i18n.langAuto }}</option>
                  <option v-for="o in LANG_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
                </select>
              </label>
            </template>
            <span class="enter-hint">{{ i18n.enterHint }}</span>
          </div>
          <!-- 输入行 -->
          <div class="ai-chat-input-row">
            <textarea
              ref="composerRef"
              class="inline-input ai-chat-textarea"
              v-model="composerInput"
              :placeholder="composerMode === 'translate' ? i18n.composerPlc : i18n.askPlc"
              rows="1"
              :title="i18n.enterHint"
              @keydown.enter.exact="onComposerEnter"
            />
            <button class="btn-send-inline" :title="i18n.enterHint" @click="submitComposer">
              <Send :size="14" />
            </button>
          </div>
        </template>
      </div>

    </div>
  </div>
</template>
