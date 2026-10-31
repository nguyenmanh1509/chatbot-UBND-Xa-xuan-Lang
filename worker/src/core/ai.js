/**
 * Lớp AI: Gemini (miễn phí) với tool-calling, fallback Cloudflare Workers AI.
 * Thiết kế: AI chỉ được phép dựa trên ngữ cảnh DVC trả về -> không bịa thông tin hành chính.
 */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const CF_AI_BASE = 'https://api.cloudflare.com/client/v4/accounts';

/**
 * Model Workers AI dùng làm fallback.
 *
 * Ưu tiên các model llama vì chạy ổn định và có quota generous hơn.
 * Đổi qua biến môi trường CF_AI_MODEL nếu muốn thử model khác.
 */
const CF_AI_MODEL = '@cf/meta/llama-3.1-8b-instruct-fp8-fast';

const DEFAULT_SYSTEM_PROMPT = `Bạn là trợ lý tra cứu thủ tục hành chính của UBND xã Xuân Lãng, tỉnh Phú Thọ.

NGUYÊN TẮC BẮT BUỘC:
1. Chỉ trả lời dựa trên dữ liệu được cung cấp trong phần "DỮ LIỆU TRA CỨU". Tuyệt đối không tự bịa thủ tục, mã, hồ sơ, phí hoặc thời gian xử lý.
2. Nếu dữ liệu không đủ để trả lời, nói rõ: "Em chưa có đủ thông tin trong hệ thống để trả lời chính xác. Anh/chị vui lòng liên hệ trực tiếp UBND xã Xuân Lãng."
3. Trả lời bằng tiếng Việt, xưng "em", gọi người dùng "anh/chị". Giọng điệu lịch sự, thân thiện, không quá dài dòng.
4. Nêu mã thủ tục và cơ quan thực hiện khi có trong dữ liệu.
5. Nếu có "Link nộp trực tuyến", luôn kèm link đó ở cuối câu trả lời.
6. Không dùng emoji quá nhiều. Không cần xin lỗi hay chào lại mỗi lần.
7. Nếu người dùng hỏi về thủ tục không liên quan đến hành chính, hãy hướng dẫn về việc tra cứu thủ tục hành chính.`;

export class AiEngine {
  /**
   * @param {object} opts
   * @param {string} opts.geminiApiKey - API key Gemini (miễn phí). Rỗng => bỏ qua Gemini.
   * @param {string} opts.accountId    - Cloudflare account id (cho Workers AI fallback)
   * @param {string} opts.cfAiToken    - Cloudflare API token (cho Workers AI fallback)
   * @param {string} opts.systemPrompt - Prompt hệ thống (admin có thể sửa)
   */
  constructor(opts = {}) {
    this.geminiApiKey = opts.geminiApiKey || '';
    this.accountId = opts.accountId || '';
    this.cfAiToken = opts.cfAiToken || '';
    this.systemPrompt = opts.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    this.model = opts.model || 'gemini-3.8-flash';
    // Binding AI của Cloudflare Worker (env.AI) — cách dùng MIỄN PHÍ,
    // không cần tạo API token thủ công. Ưu tiên cao nhất sau Gemini.
    this.aiBinding = opts.aiBinding || null;
  }

  get hasGemini() {
    return Boolean(this.geminiApiKey);
  }

  get hasCfAi() {
    return Boolean(this.aiBinding) || Boolean(this.accountId && this.cfAiToken);
  }

  /**
   * Gọi Workers AI qua binding `env.AI` (không cần token).
   * Đây là cách khuyến nghị: token Cloudflare trong code là rủi ro bảo mật.
   */
  async askCfAiBinding(question, context, { history = [] } = {}) {
    if (!this.aiBinding) return null;
    const contents = [];
    for (const h of history.slice(-6)) {
      contents.push({
        role: h.role === 'bot' ? 'assistant' : 'user',
        content: h.text,
      });
    }
    contents.push({
      role: 'user',
      content: `DỮ LIỆU TRA CỨU:\n${context || '(Không có dữ liệu)'}\n\nCÂU HỎI CỦA NGƯỜI DÙNG:\n${question}`,
    });

    try {
      const res = await this.aiBinding.run(CF_AI_MODEL, {
        messages: [
          { role: 'system', content: this.systemPrompt },
          ...contents,
        ],
        max_tokens: 700,
        temperature: 0.2,
      });
      const txt = (res?.response || res?.result?.response || '').trim();
      return txt || null;
    } catch (_) {
      return null;
    }
  }

  /** Gọi Gemini. Trả về string hoặc null nếu lỗi/hết quota. */
  async askGemini(question, context, { history = [] } = {}) {
    if (!this.hasGemini) return null;

    const parts = [
      { text: `DỮ LIỆU TRA CỨU:\n${context || '(Không có dữ liệu)'}\n\nCÂU HỎI CỦA NGƯỜI DÙNG:\n${question}` },
    ];

    const contents = [];
    for (const h of history.slice(-6)) {
      contents.push({
        role: h.role === 'bot' ? 'model' : 'user',
        parts: [{ text: h.text }],
      });
    }
    contents.push({ role: 'user', parts });

    const body = {
      system_instruction: { parts: [{ text: this.systemPrompt }] },
      contents,
      generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
    };

    try {
      const res = await fetch(`${GEMINI_BASE}/${this.model}:generateContent?key=${this.geminiApiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        // 429 = hết quota, 403 = model bị chặn -> thử model khác rồi fallback
        if (res.status === 429 || res.status === 403 || res.status === 404) return null;
        return null;
      }
      const j = await res.json();
      const txt = (j.candidates?.[0]?.content?.parts || [])
        .map((p) => p.text || '')
        .join('')
        .trim();
      return txt || null;
    } catch (_) {
      return null;
    }
  }

  /** Fallback: Cloudflare Workers AI (Llama) qua REST API + token thủ công. */
  async askCfAi(question, context) {
    if (!this.accountId || !this.cfAiToken) return null;
    const prompt = `${this.systemPrompt}\n\nDỮ LIỆU TRA CỨU:\n${context || '(Không có dữ liệu)'}\n\nCÂU HỎI:\n${question}`;

    try {
      const res = await fetch(
        `${CF_AI_BASE}/${this.accountId}/ai/run/${CF_AI_MODEL}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.cfAiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messages: [
              { role: 'system', content: this.systemPrompt },
              { role: 'user', content: prompt },
            ],
            max_tokens: 700,
            temperature: 0.2,
          }),
        }
      );
      if (!res.ok) return null;
      const j = await res.json();
      const txt = (j.result?.response || j.response || '').trim();
      return txt || null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Hỏi AI. Thứ tự: Gemini -> Workers AI (binding) -> Workers AI (REST) -> null.
   *
   * Ưu tiên binding vì không cần token và hoạt động sẵn trên tài khoản Free.
   */
  async ask(question, context, opts = {}) {
    const g = await this.askGemini(question, context, opts);
    if (g) return { text: g, engine: 'gemini' };

    const b = await this.askCfAiBinding(question, context, opts);
    if (b) return { text: b, engine: 'workers-ai' };

    const c = await this.askCfAi(question, context);
    if (c) return { text: c, engine: 'workers-ai' };

    return { text: null, engine: 'none' };
  }
}

export { DEFAULT_SYSTEM_PROMPT };
