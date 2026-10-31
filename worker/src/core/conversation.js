/**
 * Bộ xử lý hội thoại dùng chung cho mọi kênh (web / Facebook / Zalo Bot / Zalo OA).
 * Trả về danh sách tin nhắn text để kênh gửi đi.
 */

import { DvcClient } from './dvc.js';
import { AiEngine, DEFAULT_SYSTEM_PROMPT } from './ai.js';
import {
  buildContext,
  splitForChat,
  truncate,
  formatProcessingTime,
} from './retrieve.js';
import { parseIntent, stripVN } from './nlu.js';

/** Tạo engine từ config. */
export function makeEngines(cfg, env = {}) {
  const dvc = new DvcClient(cfg.dvc);
  const ai = new AiEngine({
    geminiApiKey: cfg.ai.geminiApiKey,
    accountId: cfg.ai.cfAccountId,
    cfAiToken: cfg.ai.cfApiToken,
    model: cfg.ai.geminiModel,
    systemPrompt: cfg.ai.systemPrompt || DEFAULT_SYSTEM_PROMPT,
    // Binding Workers AI — dùng được miễn phí, không cần API token.
    aiBinding: env.AI || null,
  });
  return { dvc, ai };
}

/** Danh sách câu hỏi gợi ý (quick replies) cho kênh chat. */
export function quickReplies(cfg) {
  return [
    'Đăng ký kết hôn cần hồ sơ gì?',
    'Cấp hộ khẩu tại xã Xuân Lãng',
    'Đăng ký xe máy',
    'Bổ sung hộ khẩu',
    'Cấp chứng nhận sinh trẻ',
  ];
}

/**
 * Xử lý 1 tin nhắn của người dùng.
 *
 * @param {object} deps
 * @param {DvcClient} deps.dvc
 * @param {AiEngine} deps.ai
 * @param {object} deps.cfg
 * @param {string} deps.text      - nội dung người dùng
 * @param {object} deps.channel   - { id, name, greeting, aiEnabled }
 * @param {Array}  deps.history   - [{ role, text }]
 * @returns {Promise<{messages: string[], meta: object}>}
 */
export async function handleMessage({ dvc, ai, cfg, text, channel, history = [] }) {
  const input = String(text || '').trim();
  const meta = { engine: 'none', scope: null, kind: null, error: null };

  if (!input) {
    return { messages: [cfg.greeting], meta };
  }

  const intent = parseIntent(input);
  // Lệnh trợ giúp
  if (intent.type === 'command' && intent.command === 'help') {
    return {
      messages: [
        'Em có thể giúp anh/chị:\n' +
          '• Tra cứu thủ tục theo tên hoặc câu tự nhiên\n' +
          '• Hỏi về hồ sơ, thời gian xử lý, lệ phí\n' +
          '• Tìm thủ tục áp dụng tại một xã/phường cụ thể\n\n' +
          'Anh/chị cứ hỏi tự nhiên, ví dụ: "cần hồ sơ gì để đăng ký kết hôn tại xã Xuân Lãng?"',
      ],
      meta,
    };
  }

  // Phường mặc định của hệ thống
  if (intent.type === 'command' && intent.command === 'my-ward') {
    return {
      messages: [
        `Phường/xã phục vụ hiện tại: ${cfg.defaultWardName} (mã ${cfg.defaultWardCode}).`,
      ],
      meta,
    };
  }

  try {
    // Lấy ngữ cảnh từ DVC
    const ctx = await buildContext(dvc, input, {
      defaultWardCode: cfg.defaultWardCode,
    });
    meta.kind = ctx.kind;
    meta.scope = ctx.scope || null;

    // Người dùng gõ mã thủ tục nhưng mã không tồn tại -> báo rõ, KHÔNG
    // im lặng tìm thủ tục khác (đó là lỗi gây khó chịu nhất).
    if (ctx.kind === 'notfound') {
      return {
        messages: [
          `Em chưa tìm thấy thủ tục nào có mã "${ctx.missingCode}".\n\n` +
            'Anh/chị kiểm tra lại mã (ví dụ: 1.000894) hoặc nhắn lại tên thủ tục để em tra cứu giúp ạ.',
        ],
        meta,
      };
    }

    // Không có dữ liệu -> trả fallback tất định
    if (!ctx.text || !ctx.text.trim()) {
      return { messages: [cfg.fallbackMessage], meta };
    }

    // Bật AI: trả lời tự nhiên dựa trên ngữ cảnh
    const aiOn = channel?.aiEnabled !== false && cfg.ai.provider !== 'none';

    // Danh sách nhiều thủ tục -> LUÔN hiển thị dạng có mã + link.
    // Không để AI viết lại danh sách vì AI hay làm mờ/bỏ mã, và người dùng
    // cần mã để tra cứu cụ thể.
    if (ctx.kind === 'results') {
      return {
        messages: splitForChat(formatDeterministic(ctx, cfg)),
        // Nút bấm nhanh: bấm mã thủ tục -> Messenger gửi payload -> bot tra chi tiết.
        quickReplies: buildQuickReplies(ctx),
        meta,
      };
    }

    if (aiOn) {
      const r = await ai.ask(input, ctx.text, { history });
      if (r.text) {
        meta.engine = r.engine;
        let out = r.text.trim();
        // Gắn link nộp trực tuyến nếu có và chưa có trong câu trả lời
        const links = (ctx.sources || []).filter((s) => s.url && /^https?:/.test(s.url));
        if (links.length && !/https?:\/\//.test(out)) {
          out += '\n\n' + links.map((l) => `🔗 ${l.label || 'Nộp trực tuyến'}: ${l.url}`).join('\n');
        }
        return { messages: splitForChat(out), meta };
      }
    }

    // Không có AI -> trả kết quả dạng text có cấu trúc (luôn hoạt động)
    return { messages: splitForChat(formatDeterministic(ctx, cfg)), meta };
  } catch (err) {
    meta.error = String(err?.message || err);
    return { messages: [cfg.errorMessage], meta };
  }
}

/**
 * Định dạng kết quả tra cứu thành text khi không dùng AI.
 * Luôn hoạt động, không phụ thuộc model.
 */
export function formatDeterministic(ctx, cfg) {
  const lines = [];

  if (ctx.kind === 'detail') {
    const d = ctx.data || {};
    lines.push(`*${d.name || 'Chi tiết thủ tục'}* (Mã: ${d.code || '—'})`);
    if (d.issuing_agency) lines.push(`Cơ quan ban hành: ${d.issuing_agency}`);

    const auth = (d.departments_authority || []).map((x) => x.name).filter(Boolean);
    if (auth.length) lines.push(`Cơ quan tiếp nhận: ${auth.join('; ')}`);

    if (d.processing_time) {
      lines.push(`Thời gian xử lý: ${formatProcessingTime(d.processing_time, d.processing_time_unit)}`);
    }

    const comps = (d.components || [])
      .map((c) => (c.name || '').replace(/^-\s*/, '').trim())
      .filter((n) => n && n.length > 4);
    if (comps.length) {
      lines.push('');
      lines.push('*Thành phần hồ sơ:*');
      for (const c of comps.slice(0, 12)) lines.push(`- ${c}`);
    }

    const results = (d.results || []).map((r) => r.name).filter(Boolean);
    if (results.length) {
      lines.push('');
      lines.push(`*Kết quả:* ${results.join('; ')}`);
    }

    if (ctx.sources?.length) {
      lines.push('');
      for (const s of ctx.sources) lines.push(`🔗 ${s.label || 'Xem thêm'}: ${s.url}`);
    } else if (d.portal_url) {
      lines.push('');
      lines.push(`🔗 Cổng DVC Quốc gia: ${d.portal_url}`);
    }
    return lines.join('\n');
  }

  if (ctx.kind === 'results' && ctx.data?.length) {
    const head =
      ctx.scope === 'ward'
        ? `Tìm thấy ${ctx.total} thủ tục áp dụng tại địa bàn:`
        : `Tìm thấy ${ctx.total} thủ tục:`;
    lines.push(`*${head}*`);
    for (const it of ctx.data.slice(0, 8)) {
      lines.push('');
      lines.push(`• *${it.name || '(Không có tên)'}*`);
      // Mã thủ tục nằm ngay cạnh tên để người dùng copy nhanh.
      if (it.code) lines.push(`  Mã: ${it.code}`);
      if (it.issuing_agency) lines.push(`  Cơ quan: ${it.issuing_agency}`);
      // URL TRẦN (không dùng Markdown/HTML) -> Messenger tự nhận diện và
      // cho bấm mở, giống cách số điện thoại trong tin nhắn.
      if (it.portal_url) lines.push(`  ${it.portal_url}`);
      else if (it.citizen_url) lines.push(`  ${it.citizen_url}`);
    }
    lines.push('');
    lines.push(
      'Anh/chị nhắn lại mã thủ tục (vd: 1.000894) để em tra cứu chi tiết đầy đủ ạ.'
    );
    return lines.join('\n');
  }

  // Danh mục / thống kê
  if (ctx.text) return ctx.text;
  return cfg.fallbackMessage;
}

/**
 * Tạo quick replies từ danh sách thủ tục tìm được.
 *
 * Messenger GIỚI HẠN 13 quick reply, tiêu đề tối đa 20 ký tự.
 * Payload = mã thủ tục -> khi người dùng bấm, Messenger gửi payload,
 * bot nhận đúng mã và tra chi tiết (không phải đoán lại từ text).
 */
export function buildQuickReplies(ctx) {
  if (ctx?.kind !== 'results' || !Array.isArray(ctx.data)) return [];
  const out = [];
  for (const it of ctx.data) {
    const code = (it?.code || '').trim();
    if (!code) continue;
    out.push({ title: code, payload: code });
    if (out.length >= 13) break;
  }
  return out;
}

/** Kiểm tra câu hỏi có liên quan tới thủ tục hành chính không (lọc rác). */
export function isRelevant(text) {
  const t = stripVN(text);
  return /(thu tuc|ho so|giay to|chung nhan|dang ky|cap |giai the|do an|chuyen |lam ho so)/.test(t);
}
