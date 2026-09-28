import { API_DEFAULTS } from '../utils/constants';

// 发送方向可选语气。key 存进设置，label 在 App.vue 的 i18n 里
export const TONES = ['natural', 'casual', 'friendly', 'polite', 'flirty', 'rp', 'brief'];

const TONE_GUIDE = {
    natural:  'Natural, everyday chat. Sound like a real person typing, not a textbook.',
    casual:   'Very casual and relaxed, like texting a close friend. Contractions, light slang and lowercase are fine where a native speaker would use them.',
    friendly: 'Warm, upbeat and friendly. Approachable, a little enthusiastic, never stiff.',
    polite:   'Polite and respectful, suitable for someone you just met or a shop owner. Still conversational, not bureaucratic.',
    flirty:   'Playful and flirty, charming and a bit teasing. Keep it tasteful unless the original is explicit.',
    rp:       'Roleplay voice. Match the immersive, descriptive style of the scene. Keep *actions* or /me emotes as actions in the target language.',
    brief:    'Short and punchy. Say it in as few words as a native speaker naturally would.',
};

// 回译分隔符：模型先输出译文，再输出这一行，再输出回译
const BACK_SEP = '<<<BACK>>>';

// 一行 SSE 超过这么久没有新数据就判定超时
const IDLE_TIMEOUT_MS = 30000;

export class LLMService {
    /** 把用户填的 /v1 之类的地址补全为 /chat/completions */
    static _endpoint(baseUrl) {
        let url = baseUrl || API_DEFAULTS.BASE_URL;
        if (!url.includes('/chat/completions')) {
            url = url.replace(/\/+$/, '') + '/chat/completions';
        }
        return url;
    }

    /**
     * 翻译对方发来的消息
     * @param {string} text
     * @param {Array<{sender:string,text:string}>} history - 同频道上文
     * @param {Function} onChunk
     * @param {Object} config - { apiKey, baseUrl, model, targetLang }
     * @param {Object} opts - { signal }
     */
    static async translateIncoming(text, history, onChunk, config, opts = {}) {
        const targetLang = config.targetLang || 'English';
        const context = history.length
            ? `\n\nRecent conversation in this channel (for context only, do not translate it):\n${history.map(m => `${m.sender}: ${m.text}`).join('\n')}`
            : '';
        const system = `You translate Second Life chat messages into ${targetLang}.
Translate the meaning the way a native ${targetLang} speaker would say it in a chat, not word by word.
Understand SL slang and abbreviations (TP, LM, sim, rez, IM, L$, AFK, brb, ty, np, etc.) and render them naturally.
Keep the sender's tone: casual stays casual, roleplay stays roleplay, emotes stay emotes.
Keep line breaks. Keep names, URLs and SLURLs unchanged.
If the message is already in ${targetLang}, output it unchanged.
Output only the translation, no notes, no quotes.${context}`;

        return LLMService._doStream(
            [{ role: 'system', content: system }, { role: 'user', content: text }],
            config, onChunk, { signal: opts.signal, temperature: 0.3 }
        );
    }

    /**
     * 把"我想说的话"译成对方语言，可带回译
     * @param {string} text - 我输入的母语
     * @param {Object} params
     *   otherMessages: string[] 对方最近几条原文（推断语言和说话风格）
     *   tone:          TONES 之一
     *   targetLang:    'auto' 或具体语言
     *   myLang:        回译用的语言（我的母语）
     *   withBack:      是否输出回译
     * @param {Function} onUpdate - ({ translation, back }) => {}，每次收到字符都会以当前累计全文回调
     * @param {Object} config - { apiKey, baseUrl, model }
     * @param {Object} opts - { signal }
     */
    static async translateOutgoing(text, params, onUpdate, config, opts = {}) {
        const { otherMessages = [], tone = 'natural', targetLang = 'auto', myLang = 'Simplified Chinese', withBack = true } = params;

        const langRule = targetLang && targetLang !== 'auto'
            ? `Write the message in ${targetLang}.`
            : `Write the message in the language the other person uses in their recent messages below. If there are none or it is unclear, use English.`;
        const others = otherMessages.length
            ? `\n\nThe other person's recent messages (match their language, register and slang):\n${otherMessages.map(m => `- ${m}`).join('\n')}`
            : '';
        const backRule = withBack
            ? `\n\nAfter the message, output a line containing exactly ${BACK_SEP} and then a short literal back-translation of what you wrote into ${myLang}, so the user can check the meaning.`
            : '';

        const system = `You help a Second Life user reply in chat. The user writes what they want to say in their own language; you write the message they will paste into SL.
${langRule}
Tone: ${TONE_GUIDE[tone] || TONE_GUIDE.natural}
Convey the intent and feeling, not the literal words. Use the idioms, sentence length and punctuation a native speaker would use in online chat. Avoid stiff, translated-sounding phrasing.
Keep names, URLs, SLURLs and emoticons as they are. Keep the user's line breaks.
Do not add greetings, facts or questions the user did not express.
Output only the message itself, no quotes, no explanations.${others}${backRule}`;

        let full = '';
        const result = await LLMService._doStream(
            [{ role: 'system', content: system }, { role: 'user', content: text }],
            config,
            (chunk) => {
                full += chunk;
                onUpdate(LLMService._splitBack(full));
            },
            { signal: opts.signal, temperature: 0.7 }
        );
        return { ...result, ...LLMService._splitBack(full) };
    }

    static _splitBack(full) {
        const idx = full.indexOf(BACK_SEP);
        if (idx === -1) {
            // 分隔符可能正写到一半，隐藏末尾的不完整前缀，避免闪一下
            const partial = full.lastIndexOf('<<<');
            const translation = partial !== -1 && BACK_SEP.startsWith(full.slice(partial)) ? full.slice(0, partial) : full;
            return { translation: translation.trim(), back: '' };
        }
        return { translation: full.slice(0, idx).trim(), back: full.slice(idx + BACK_SEP.length).trim() };
    }

    /**
     * 针对某条消息给出 2-3 条可直接发送的回复
     * @returns 结果对象，另含 suggestions: [{ reply, meaning }]
     */
    static async suggestReplies(targetMsg, contextMessages, params, onUpdate, config, opts = {}) {
        const { tone = 'natural', myLang = 'Simplified Chinese' } = params;
        const context = contextMessages
            .slice(-8)
            .map(m => `${m.sender}: ${m.text}`)
            .join('\n');

        const system = `You help a Second Life user reply in chat.
Suggest 2 or 3 different replies to the message from ${targetMsg.sender}, written in the language ${targetMsg.sender} uses.
Tone: ${TONE_GUIDE[tone] || TONE_GUIDE.natural}
Each reply must sound like a native speaker typing in chat and be ready to paste as is.
Output one suggestion per line in exactly this format, nothing else:
<reply> ||| <meaning of the reply in ${myLang}>

Recent conversation:
${context}`;

        let full = '';
        const result = await LLMService._doStream(
            [{ role: 'system', content: system }, { role: 'user', content: `Message to reply to: ${targetMsg.text}` }],
            config,
            (chunk) => {
                full += chunk;
                onUpdate(LLMService._parseSuggestions(full), full);
            },
            { signal: opts.signal, temperature: 0.8 }
        );
        return { ...result, suggestions: LLMService._parseSuggestions(full), raw: full };
    }

    static _parseSuggestions(full) {
        return full
            .split('\n')
            .map(l => l.trim().replace(/^(\d+[.)、]|[-*])\s*/, ''))
            .filter(Boolean)
            .map(l => {
                const [reply, meaning = ''] = l.split('|||');
                return { reply: reply.trim().replace(/^["“]|["”]$/g, ''), meaning: meaning.trim() };
            })
            .filter(s => s.reply);
    }

    /**
     * 自由对话（底栏"问 AI"模式）
     * @param {Array} contextMessages - 当前 tab 最近聊天记录 [{sender, text, translated}]
     */
    static async chatStream(userPrompt, contextMessages, onChunk, config, opts = {}) {
        const contextSummary = contextMessages
            .slice(-8)
            .map(m => `${m.sender}: ${m.text}${m.translated && m.translated !== m.text ? ` (translation: ${m.translated})` : ''}`)
            .join('\n');

        const system = `You are a helpful AI assistant for a Second Life user. You have access to the recent conversation history below. Help the user with whatever they ask: translate, polish, suggest replies, explain context, or anything else. Answer in the language the user writes in.

Recent conversation:
${contextSummary}`;

        return LLMService._doStream(
            [{ role: 'system', content: system }, { role: 'user', content: userPrompt }],
            config, onChunk, { signal: opts.signal, temperature: 0.7 }
        );
    }

    /**
     * 通用流式请求
     * @returns {Promise<{ ok: boolean, text: string, error?: string, aborted?: boolean, timedOut?: boolean }>}
     *   调用方通过 opts.signal 取消时 aborted=true；长时间无数据时 timedOut=true
     */
    static async _doStream(messages, config, onChunk, opts = {}) {
        if (!config.apiKey) {
            return { ok: false, text: '', error: 'NO_API_KEY' };
        }

        const controller = new AbortController();
        let timedOut = false;
        let idleTimer = null;
        const armIdle = () => {
            clearTimeout(idleTimer);
            idleTimer = setTimeout(() => { timedOut = true; controller.abort(); }, IDLE_TIMEOUT_MS);
        };
        const onOuterAbort = () => controller.abort();
        if (opts.signal) {
            if (opts.signal.aborted) return { ok: false, text: '', aborted: true };
            opts.signal.addEventListener('abort', onOuterAbort);
        }

        let text = '';
        try {
            armIdle();
            const body = { model: config.model || API_DEFAULTS.MODEL, messages, stream: true };
            if (typeof opts.temperature === 'number') body.temperature = opts.temperature;

            const response = await fetch(LLMService._endpoint(config.baseUrl), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.apiKey}`,
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            });

            if (!response.ok) {
                const errorStr = await response.text();
                throw new Error(`HTTP ${response.status} ${errorStr.slice(0, 300)}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            // 一行 SSE 可能被拆进两个网络包，未以换行结尾的部分留到下一轮拼接
            let pending = '';

            const handleLine = (rawLine) => {
                const line = rawLine.trim();
                if (!line.startsWith('data:')) return;
                const data = line.slice(5).trim();
                if (!data || data === '[DONE]') return;
                try {
                    const json = JSON.parse(data);
                    const delta = json.choices?.[0]?.delta?.content;
                    if (delta) {
                        text += delta;
                        onChunk(delta);
                    }
                } catch (_) {
                    // 非 JSON 的心跳行等，忽略
                }
            };

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                armIdle();
                pending += decoder.decode(value, { stream: true });
                const lines = pending.split('\n');
                pending = lines.pop();
                lines.forEach(handleLine);
            }
            pending += decoder.decode();
            if (pending) handleLine(pending);

            return { ok: true, text };
        } catch (error) {
            if (timedOut) return { ok: false, text, timedOut: true, error: 'TIMEOUT' };
            if (opts.signal?.aborted) return { ok: false, text, aborted: true };
            console.error('LLMService Error:', error);
            return { ok: false, text, error: error.message || String(error) };
        } finally {
            clearTimeout(idleTimer);
            opts.signal?.removeEventListener('abort', onOuterAbort);
        }
    }
}
