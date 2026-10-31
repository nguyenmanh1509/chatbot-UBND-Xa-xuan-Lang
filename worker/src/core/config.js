/**
 * Quản lý cấu hình — lưu trong KV, admin sửa qua giao diện web.
 * Nhờ vậy thêm/sửa kênh (Facebook, Zalo OA, Zalo Bot) không phải đụng vào code hay deploy lại.
 */

export const CONFIG_KEY = 'config:v1';

/** Cấu hình mặc định — dùng khi chưa có gì trong KV. */
export function defaultConfig() {
  return {
    siteName: 'Trợ lý tra cứu thủ tục hành chính UBND xã Xuân Lãng',
    greeting:
      'Xin chào! Em là trợ lý tra cứu thủ tục hành chính của UBND xã Xuân Lãng, tỉnh Phú Thọ.\n' +
      'Anh/chị có thể hỏi em bằng câu tự nhiên, ví dụ: "cần hồ sơ gì để đăng ký kết hôn tại xã Xuân Lãng?"',
    fallbackMessage:
      'Em chưa tìm thấy thủ tục phù hợp. Anh/chị vui lòng liên hệ trực tiếp UBND xã Xuân Lãng để được hỗ trợ.',
    errorMessage: 'Xin lỗi, hệ thống đang bận. Anh/chị vui lòng thử lại sau ít phút.',
    defaultWardCode: 'H44.195',
    defaultWardName: 'Xã Xuân Lãng',

    dvc: {
      baseUrl: 'https://dichvucong.cloudgo.vn',
      apiKey: '', // tenant key -> bật submission_links riêng của xã
    },

    ai: {
      provider: 'workers-ai', // workers-ai | gemini | none
      geminiApiKey: '',
      geminiModel: 'gemini-3.8-flash',
      cfAccountId: '',
      cfApiToken: '',
      systemPrompt: '', // rỗng => dùng prompt mặc định
    },

    channels: {
      facebook: {
        enabled: false,
        pageId: '',
        pageAccessToken: '',
        verifyToken: '',
        appSecret: '',
        greeting: '',
        // auto-reply trong 24h window
        aiEnabled: true,
      },
      zaloBot: {
        enabled: false,
        botToken: '',
        secretToken: '',
        greeting: '',
        aiEnabled: true,
      },
      zaloOa: {
        enabled: false,
        oaId: '',
        accessToken: '',
        refreshToken: '',
        secretKey: '',
        appId: '',
        greeting: '',
        aiEnabled: true,
      },
    },
  };
}

/**
 * Merge cấu hình đã lưu (ưu tiên giá trị đã lưu) với mặc định (để thêm field mới không vỡ).
 */
export function mergeConfig(saved) {
  const base = defaultConfig();
  if (!saved) return base;
  return {
    ...base,
    ...saved,
    dvc: { ...base.dvc, ...(saved.dvc || {}) },
    ai: { ...base.ai, ...(saved.ai || {}) },
    channels: {
      facebook: { ...base.channels.facebook, ...((saved.channels || {}).facebook || {}) },
      zaloBot: { ...base.channels.zaloBot, ...((saved.channels || {}).zaloBot || {}) },
      zaloOa: { ...base.channels.zaloOa, ...((saved.channels || {}).zaloOa || {}) },
    },
  };
}

/**
 * Gộp "phần admin vừa gửi" vào "cấu hình đang lưu".
 *
 * Thứ tự ưu tiên (từ thấp đến cao):
 *   1. mặc định
 *   2. cấu hình đang lưu
 *   3. phần admin vừa gửi
 *
 * Quan trọng: nếu admin gửi partial (vd chỉ đổi appSecret),
 * các trường khác (như enabled) phải GIỮ NGUYÊN giá trị đang lưu,
 * không được reset về mặc định.
 */
export function mergeIncoming(incoming, saved) {
  const base = mergeConfig(saved);
  const inc = incoming || {};
  const deep = (a, b) => {
    const out = { ...a };
    for (const [k, v] of Object.entries(b || {})) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        out[k] = deep(a?.[k] || {}, v);
      } else if (v !== undefined) {
        out[k] = v;
      }
    }
    return out;
  };
  return deep(base, inc);
}

/**
 * Che giấu các trường bí mật khi trả về cho client.
 * Admin UI sẽ hiển thị "••••••" và chỉ ghi đè khi người dùng nhập giá trị mới.
 */
export function redactConfig(cfg) {
  const c = JSON.parse(JSON.stringify(cfg));
  const mask = (obj, fields) => {
    for (const f of fields) {
      const has = Boolean(obj[f]);
      obj[f] = has ? '••••••' : '';
      obj['__has_' + f] = has;
    }
  };
  mask(c.dvc, ['apiKey']);
  mask(c.ai, ['geminiApiKey', 'cfApiToken']);
  mask(c.channels.facebook, ['pageAccessToken', 'appSecret']);
  mask(c.channels.zaloBot, ['botToken', 'secretToken']);
  mask(c.channels.zaloOa, ['accessToken', 'refreshToken', 'secretKey']);
  return c;
}

/**
 * Trường nào đã bị mask thì lấy lại giá trị gốc từ config đã lưu.
 *
 * Quy tắc:
 *   - '••••••'  => admin không sửa ô này -> giữ giá trị cũ
 *   - ''        => admin đã xóa trắng -> xóa hẳn giá trị cũ
 *   - khác      => giá trị mới -> dùng luôn
 *
 * `incoming` có thể là bản partial (admin chỉ gửi phần muốn đổi),
 * nên mọi nhánh đều phải an toàn với undefined.
 */
export function mergeSecretFields(incoming, saved) {
  const out = mergeIncoming(incoming, saved);
  const carry = (dst, src, fields) => {
    for (const f of fields) {
      if (dst[f] === '••••••') {
        dst[f] = src?.[f] ?? '';
      }
      delete dst['__has_' + f];
    }
  };
  carry(out.dvc, saved?.dvc, ['apiKey']);
  carry(out.ai, saved?.ai, ['geminiApiKey', 'cfApiToken']);
  carry(out.channels.facebook, saved?.channels?.facebook, ['pageAccessToken', 'appSecret']);
  carry(out.channels.zaloBot, saved?.channels?.zaloBot, ['botToken', 'secretToken']);
  carry(out.channels.zaloOa, saved?.channels?.zaloOa, ['accessToken', 'refreshToken', 'secretKey']);
  return out;
}

/**
 * Áp giá trị từ biến môi trường (file .env / .dev.vars) vào cấu hình.
 *
 * Mục đích: khi chạy LOCAL (wrangler dev), chỉ cần khai báo trong .dev.vars
 * là dùng được ngay, không phải đăng nhập Admin panel mỗi lần.
 * Trên PRODUCTION, biến môi trường (wrangler secret / vars) được áp trước
 * KV — nên nếu đã cấu hình trong Admin panel thì giá trị đó vẫn được giữ.
 *
 * Thứ tự ưu tiên: giá trị đã lưu trong KV > biến môi trường > mặc định.
 */
export function applyEnvOverrides(cfg, env) {
  if (!env) return cfg;
  const out = { ...cfg, channels: { ...cfg.channels } };

  // -- Facebook --
  const fb = { ...(out.channels.facebook || {}) };
  if (!fb.pageId && env.FB_PAGE_ID) fb.pageId = env.FB_PAGE_ID;
  if (!fb.pageAccessToken && env.FB_PAGE_ACCESS_TOKEN) fb.pageAccessToken = env.FB_PAGE_ACCESS_TOKEN;
  if (!fb.appSecret && env.FB_APP_SECRET) fb.appSecret = env.FB_APP_SECRET;
  if (!fb.verifyToken && env.FB_VERIFY_TOKEN) fb.verifyToken = env.FB_VERIFY_TOKEN;
  // Chỉ bật kênh tự động khi đủ cả 3 món bắt buộc.
  if (!fb.enabled && fb.pageId && fb.pageAccessToken && fb.verifyToken) fb.enabled = true;
  out.channels.facebook = fb;

  // -- Zalo Bot --
  const zb = { ...(out.channels.zaloBot || {}) };
  if (!zb.botToken && env.ZB_BOT_TOKEN) zb.botToken = env.ZB_BOT_TOKEN;
  if (!zb.secretToken && env.ZB_SECRET_TOKEN) zb.secretToken = env.ZB_SECRET_TOKEN;
  if (!zb.enabled && zb.botToken) zb.enabled = true;
  out.channels.zaloBot = zb;

  // -- Zalo OA --
  const zo = { ...(out.channels.zaloOa || {}) };
  if (!zo.oaId && env.ZO_OA_ID) zo.oaId = env.ZO_OA_ID;
  if (!zo.accessToken && env.ZO_ACCESS_TOKEN) zo.accessToken = env.ZO_ACCESS_TOKEN;
  if (!zo.refreshToken && env.ZO_REFRESH_TOKEN) zo.refreshToken = env.ZO_REFRESH_TOKEN;
  if (!zo.secretKey && env.ZO_SECRET_KEY) zo.secretKey = env.ZO_SECRET_KEY;
  if (!zo.appId && env.ZO_APP_ID) zo.appId = env.ZO_APP_ID;
  if (!zo.enabled && zo.oaId && zo.accessToken && zo.secretKey) zo.enabled = true;
  out.channels.zaloOa = zo;

  // -- AI --
  const ai = { ...(out.ai || {}) };
  if (!ai.geminiApiKey && env.GEMINI_API_KEY) ai.geminiApiKey = env.GEMINI_API_KEY;
  out.ai = ai;

  // -- DVC --
  const dvc = { ...(out.dvc || {}) };
  if (!dvc.apiKey && env.DVC_API_KEY) dvc.apiKey = env.DVC_API_KEY;
  out.dvc = dvc;

  return out;
}

/** Đọc cấu hình từ KV. */
export async function loadConfig(env) {
  if (!env.CONFIG) return applyEnvOverrides(defaultConfig(), env);
  try {
    const raw = await env.CONFIG.get(CONFIG_KEY, 'json');
    return applyEnvOverrides(mergeConfig(raw), env);
  } catch (_) {
    return applyEnvOverrides(defaultConfig(), env);
  }
}

/** Ghi cấu hình vào KV. */
export async function saveConfig(env, cfg) {
  await env.CONFIG.put(CONFIG_KEY, JSON.stringify(cfg));
  return cfg;
}

/**
 * Kiểm tra kênh đã cấu hình đủ chưa.
 * Dùng cho UI báo "Kết nối" / "Chưa cấu hình".
 */
export function channelStatus(cfg) {
  const c = cfg.channels;
  return {
    facebook: {
      configured: Boolean(
        c.facebook.enabled &&
        c.facebook.pageId &&
        c.facebook.pageAccessToken &&
        c.facebook.verifyToken
      ),
      missing: [
        !c.facebook.pageId && 'pageId',
        !c.facebook.pageAccessToken && 'pageAccessToken',
        !c.facebook.verifyToken && 'verifyToken',
      ].filter(Boolean),
    },
    zaloBot: {
      configured: Boolean(c.zaloBot.enabled && c.zaloBot.botToken),
      missing: [!c.zaloBot.botToken && 'botToken'].filter(Boolean),
    },
    zaloOa: {
      configured: Boolean(
        c.zaloOa.enabled &&
        c.zaloOa.oaId &&
        c.zaloOa.accessToken &&
        c.zaloOa.secretKey
      ),
      missing: [
        !c.zaloOa.oaId && 'oaId',
        !c.zaloOa.accessToken && 'accessToken',
        !c.zaloOa.secretKey && 'secretKey',
      ].filter(Boolean),
    },
  };
}
