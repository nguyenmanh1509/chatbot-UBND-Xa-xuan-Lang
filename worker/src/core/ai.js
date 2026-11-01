/**
 * Lớp AI: Gemini (miễn phí) với tool-calling, fallback Cloudflare Workers AI.
 * Thiết kế: AI chỉ được phép dựa trên ngữ cảnh DVC trả về -> không bịa thông tin hành chính.
 */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const CF_AI_BASE = 'https://api.cloudflare.com/client/v4/accounts';

/**
 * Danh sách model Gemini, thử theo thứ tự.
 *
 * VÌ SAO CẦN DANH SÁCH: tên model Gemini thay đổi theo thời gian và mỗi tài khoản
 * được cấp quyền cho model khác nhau. Trước đây code dùng cứng "gemini-3.8-flash"
 * — model này KHÔNG tồn tại -> API trả 404 -> admin thấy "AI không phản hồi"
 * dù API key hoàn toàn đúng. Giờ thử lần lượt các model hợp lệ.
 *
 * Model nào còn sống (tính đến 2026): gemini-2.5-flash, gemini-2.0-flash,
 * gemini-flash-latest, gemini-2.5-flash-lite.
 */
const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-flash-latest',
  'gemini-2.5-flash-lite',
];

/** Model Gemini mặc định khi admin chưa chỉ định. */
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

/**
 * Model Workers AI dùng làm fallback.
 *
 * Ưu tiên các model llama vì chạy ổn định và có quota generous hơn.
 * Nếu model chính lỗi (hết quota / không còn tồn tại), thử các model dự phòng.
 */
const CF_AI_MODELS = [
  '@cf/meta/llama-3.1-8b-instruct-fp8-fast',
  '@cf/meta/llama-3.1-8b-instruct',
  '@cf/meta/llama-3.2-3b-instruct',
];

/** Model Workers AI chính (dùng trong thông báo lỗi). */
const CF_AI_MODEL = CF_AI_MODELS[0];

const DEFAULT_SYSTEM_PROMPT = `Bạn là trợ lý tra cứu thủ tục hành chính của UBND xã Xuân Lãng, tỉnh Phú Thọ.
NGUYÊN TẮC BẮT BUỘC:
1. Chỉ trả lời dựa trên dữ liệu được cung cấp trong phần "DỮ LIỆU TRA CỨU". Tuyệt đối không tự bịa thủ tục, mã, hồ sơ, phí hoặc thời gian xử lý.
2. Nếu dữ liệu không đủ để trả lời, nói rõ: "Em chưa có đủ thông tin trong hệ thống để trả lời chính xác. Anh/chị vui lòng liên hệ trực tiếp UBND xã Xuân Lãng."
3. Trả lời bằng tiếng Việt, xưng "em", gọi người dùng "anh/chị". Giọng điệu lịch sự, thân thiện, không quá dài dòng.
4. Nêu mã thủ tục và cơ quan thực hiện khi có trong dữ liệu.
5. Nếu có "Link nộp trực tuyến", luôn kèm link đó ở cuối câu trả lời.
5b. LUÔN kèm link thủ tục trên Cổng DVC Quốc gia (trường "Trên Cổng DVC Quốc gia") ở cuối câu trả lời, dạng link trần để người dân bấm được.
5c. Câu trả lời phải TÓM TẮT, không dán nguyên văn thủ tục: nêu rõ (1) hồ sơ cần chuẩn bị, (2) trình tự các bước, (3) thời gian xử lý, (4) lệ phí, (5) kết quả đầu ra, (6) cơ quan tiếp nhận.
6. Không dùng emoji quá nhiều. Không cần xin lỗi hay chào lại mỗi lần.
7. Nếu người dùng hỏi về thủ tục không liên quan đến hành chính, hãy hướng dẫn về việc tra cứu thủ tục hành chính.
8. Khi phần "THÔNG TIN THỜI GIAN HIỆN TẠI" có trong dữ liệu, hãy dùng đúng thông tin đó để trả lời các câu hỏi về ngày tháng, thời gian ("hôm nay là ngày mấy", "thứ mấy", "mấy giờ rồi"). Tuyệt đối không tự đoán ngày tháng.
9. Nếu câu hỏi ngoài phạm vi hành chính (thời tiết, tin tức, ...) và không có dữ liệu để trả lời, hãy nói ngắn gọn rằng em chỉ hỗ trợ tra cứu thủ tục hành chính, rồi hướng dẫn người dùng về việc tra cứu.
10. Khi dữ liệu có "Đồng chí phụ trách", "Bàn số", "Số điện thoại" của thủ tục riêng của xã, hãy luôn nêu kèm và mời người dân đến gặp trực tiếp tại Trung tâm Phục vụ hành chính công xã Xuân Lãng.`;

/**
 * Gemini trả HTTP 400 cho CẢ 2 trường hợp: API key sai và tên model sai.
 * Phải đọc body lỗi để phân biệt, nếu không sẽ báo nhầm.
 */
function isGeminiModelMissing(bodyText) {
  return /not found for api version|is not found|models\/\S+ is not supported|model .*not found/i.test(
    String(bodyText || '')
  );
}

/**
 * Chuyển lỗi AI thành thông báo dễ hiểu cho admin.
 *
 * VÌ SAO CẦN: trước đây mọi lỗi (hết quota, sai model, sai key, mạng)
 * đều bị nuốt thành "AI không phản hồi" -> admin không biết phải sửa gì.
 */
export function describeAiError(err, { model = '', provider = '' } = {}) {
  const raw = String(err?.message || err || '');
  const status = err?.status || err?.code;
  const where = model ? ` (model "${model}"${provider ? `, provider ${provider}` : ''})` : '';

  // Chưa đăng nhập Cloudflare — hay gặp khi chạy `wrangler dev` cục bộ
  // với binding Workers AI. Local dev gọi AI qua API Cloudflare nên cần token.
  if (/not logged in|unauthorized|invalid access token/i.test(raw)) {
    return (
      'Chưa đăng nhập Cloudflare nên không gọi được Workers AI. ' +
      'Chạy `npx wrangler login` trong thư mục worker rồi thử lại. ' +
      'Nếu đang chạy production thì hãy kiểm tra binding [ai] trong wrangler.toml. ' +
      `Chi tiết: ${raw}`
    );
  }

  // Quota hết (429) — cả Workers AI lẫn Gemini đều trả 429 khi hết hạn mức.
  if (status === 429 || /quota|rate.?limit|too many requests|resource_exhausted/i.test(raw)) {
    return (
      `Hết quota AI (429)${where}. ` +
      (provider === 'gemini'
        ? 'Gemini miễn phí có hạn mức requests/phút và RPD. Hãy chờ vài phút hoặc dùng Workers AI. '
        : 'Gói Cloudflare Free có 10.000 neuron/ngày — mỗi câu hỏi tốn ~25 neuron, tức khoảng 300-400 câu/ngày. ') +
      `Chi tiết: ${raw}`
    );
  }
  // Gemini: API key không hợp lệ (HTTP 400 nhưng body nói rõ).
  if (/api key not valid|API_KEY_INVALID/i.test(raw)) {
    return (
      `API key Gemini không hợp lệ${where}. ` +
      'Lấy key mới tại aistudio.google.com/apikey, rồi dán vào ô "Gemini API Key" và bấm "Lưu". ' +
      `Chi tiết: ${raw}`
    );
  }
  // Model Gemini không tồn tại (HTTP 400 nhưng body nói rõ).
  if (isGeminiModelMissing(raw)) {
    return (
      `Model Gemini không tồn tại${where}. ` +
      `Model hợp lệ hiện tại: ${GEMINI_MODELS.join(', ')}. ` +
      'Hãy sửa ô "Gemini Model" trong Admin panel. ' +
      `Chi tiết: ${raw}`
    );
  }
  // Model không tồn tại (Workers AI trả 404).
  if (status === 404 || /no such model|unknown model/i.test(raw)) {
    return (
      `Model không tồn tại${where}. ` +
      (provider === 'gemini'
        ? `Model hợp lệ hiện tại: ${GEMINI_MODELS.join(', ')}. `
        : `Kiểm tra tại Dashboard → AI → Models. `) +
      `Chi tiết: ${raw}`
    );
  }
  // Bị từ chối (403) — thường do chưa bật AI hoặc thiếu billing
  if (status === 403 || /forbidden|permission|not authorized|denied/i.test(raw)) {
    return (
      `Bị từ chối (403)${where}. ` +
      (provider === 'gemini'
        ? 'API key Gemini không hợp lệ hoặc API chưa được bật. Kiểm tra tại aistudio.google.com/apikey. '
        : 'Thường do tài khoản Cloudflare chưa bật Workers AI hoặc chưa có billing. ') +
      `Chi tiết: ${raw}`
    );
  }
  if (status === 400) {
    return `Yê cầu không hợp lệ (400)${where}. Chi tiết: ${raw}`;
  }
  if (raw) return `Lỗi AI${where}: ${raw}`;
  return 'AI không phản hồi (không rõ nguyên nhân)';
}

export class AiEngine {
  /**
   * @param {object} opts
   * @param {string} opts.geminiApiKey - API key Gemini (miễn phí). Rỗng => bỏ qua Gemini.
   * @param {string} opts.accountId    - Cloudflare account id (cho Workers AI fallback)
   * @param {string} opts.cfAiToken    - Cloudflare API token (cho Workers AI fallback)
   * @param {string} opts.systemPrompt - Prompt hệ thống (admin có thể sửa)
   * @param {string} opts.provider     - workers-ai | gemini | none
   */
  constructor(opts = {}) {
    this.geminiApiKey = opts.geminiApiKey || '';
    this.accountId = opts.accountId || '';
    this.cfAiToken = opts.cfAiToken || '';
    this.systemPrompt = opts.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    this.provider = opts.provider || 'workers-ai';
    // Model do admin chỉ định. Nếu rỗng -> dùng danh sách mặc định thử lần lượt.
    const m = String(opts.model || '').trim();
    this.model = m || DEFAULT_GEMINI_MODEL;
    this.customModel = Boolean(m);
    // Binding AI của Cloudflare Worker (env.AI) — cách dùng MIỄN PHÍ,
    // không cần tạo API token thủ công. Ưu tiên cao nhất nếu provider = workers-ai.
    this.aiBinding = opts.aiBinding || null;
    /** Lỗi gần nhất — để admin panel hiển thị nguyên nhân cụ thể. */
    this.lastError = null;
    /** Lỗi theo từng provider: { gemini, 'cf-binding', 'cf-rest' }. */
    this.errors = {};
  }

  get hasGemini() {
    return Boolean(this.geminiApiKey);
  }

  get hasCfAi() {
    return Boolean(this.aiBinding) || Boolean(this.accountId && this.cfAiToken);
  }

  /**
   * Danh sách model Gemini sẽ thử.
   * Nếu admin chỉ định model -> thử model đó trước, rồi mới thử các model mặc định.
   */
  geminiModelCandidates() {
    if (!this.customModel) return GEMINI_MODELS;
    return [this.model, ...GEMINI_MODELS.filter((m) => m !== this.model)];
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

    let lastErr = null;
    for (const model of CF_AI_MODELS) {
      try {
        const res = await this.aiBinding.run(model, {
          messages: [
            { role: 'system', content: this.systemPrompt },
            ...contents,
          ],
          max_tokens: 700,
          temperature: 0.2,
        });
        const txt = (res?.response || res?.result?.response || '').trim();
        if (txt) return txt;
        lastErr = new Error(`Model ${model} trả về nội dung rỗng`);
      } catch (err) {
        lastErr = err;
        // Lỗi quota/403 thì thử model khác cũng vô ích -> dừng luôn.
        const status = err?.status || err?.code;
        if (status === 429 || status === 403) break;
      }
    }
    if (lastErr) this.lastError = describeAiError(lastErr, { model: CF_AI_MODEL, provider: 'workers-ai' });
    return null;
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

    let lastErr = null;
    let triedModel = this.model;

    for (const model of this.geminiModelCandidates()) {
      triedModel = model;
      try {
        const res = await fetch(`${GEMINI_BASE}/${model}:generateContent?key=${this.geminiApiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          const err = { status: res.status, message: detail.slice(0, 400) };
          lastErr = err;

          // Gemini trả 400 cho CẢ key sai LẪN model sai, nên phải đọc nội dung
          // lỗi chứ không chỉ dựa vào status code.
          if (isGeminiModelMissing(detail)) {
            continue; // sai tên model -> thử model tiếp theo
          }
          // Sai API key / hết quota / bị chặn -> dừng, đừng đốt thêm request.
          break;
        }
        const j = await res.json();
        const txt = (j.candidates?.[0]?.content?.parts || [])
          .map((p) => p.text || '')
          .join('')
          .trim();
        if (txt) return txt;
        lastErr = { status: 200, message: `Model ${model} trả về nội dung rỗng` };
      } catch (err) {
        lastErr = err;
        break;
      }
    }

    if (lastErr) {
      this.lastError = describeAiError(lastErr, { model: triedModel, provider: 'gemini' });
    }
    return null;
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
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        this.lastError = describeAiError(
          { status: res.status, message: detail.slice(0, 300) },
          { model: CF_AI_MODEL, provider: 'workers-ai' }
        );
        return null;
      }
      const j = await res.json();
      const txt = (j.result?.response || j.response || '').trim();
      return txt || null;
    } catch (err) {
      this.lastError = describeAiError(err, { model: CF_AI_MODEL, provider: 'workers-ai' });
      return null;
    }
  }

  /**
   * Hỏi AI theo thứ tự ưu tiên đúng với `provider` đã cấu hình.
   *
   *   provider = 'workers-ai': binding AI -> REST CF (token) -> Gemini (dự phòng)
   *   provider = 'gemini'    : Gemini -> binding AI -> REST CF (dự phòng)
   *   provider = 'none'      : không gọi AI
   *
   * Lý do đổi so với bản cũ (luôn gọi Gemini trước): admin chọn Workers AI
   * thì Gemini không được xen vào, tránh tốn quota Gemini vô ích và tránh
   * báo lỗi nhầm khi Gemini hết quota.
   */
  async ask(question, context, opts = {}) {
    this.lastError = null;
    /** Lỗi của từng provider, để admin biết chính xác cái nào hỏng. */
    this.errors = {};

    const providers =
      this.provider === 'gemini'
        ? ['gemini', 'cf-binding', 'cf-rest']
        : this.provider === 'none'
          ? []
          : ['cf-binding', 'cf-rest', 'gemini'];

    for (const p of providers) {
      let res = null;
      if (p === 'gemini') res = await this.askGemini(question, context, opts);
      else if (p === 'cf-binding') res = await this.askCfAiBinding(question, context, opts);
      else res = await this.askCfAi(question, context);

      if (res) {
        this.lastError = this.errors[p] || null;
        return { text: res, engine: p === 'gemini' ? 'gemini' : 'workers-ai' };
      }
      if (this.lastError) this.errors[p] = this.lastError;
    }

    return { text: null, engine: 'none' };
  }
}

export { DEFAULT_SYSTEM_PROMPT, GEMINI_MODELS, DEFAULT_GEMINI_MODEL, CF_AI_MODELS };
