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
      provider: 'gemini', // gemini | workers-ai | none
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

/** Đọc cấu hình từ KV. */
export async function loadConfig(env) {
  if (!env.CONFIG) return defaultConfig();
  try {
    const raw = await env.CONFIG.get(CONFIG_KEY, 'json');
    return mergeConfig(raw);
  } catch (_) {
    return defaultConfig();
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
