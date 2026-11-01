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
  asArray,
} from './retrieve.js';
import { parseIntent, stripVN } from './nlu.js';
import { searchLocalProcedures, localProcedureToReply, localProcedureToText, normalizeDesk, normalizeOfficer, getProcedureByCode } from './procedures.js';
import { searchWardIndex, STRONG_SCORE, cleanSummary, isTimeQuestion } from './ward-search.js';

/** Tạo engine từ config. */
export function makeEngines(cfg, env = {}) {
  const dvc = new DvcClient(cfg.dvc);
  const ai = new AiEngine({
    geminiApiKey: cfg.ai.geminiApiKey,
    accountId: cfg.ai.cfAccountId,
    cfAiToken: cfg.ai.cfApiToken,
    model: cfg.ai.geminiModel,
    provider: cfg.ai.provider,
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
 * @param {object} deps.db       - D1 binding (thủ tục riêng của xã). Tuỳ chọn.
 * @param {string} deps.text      - nội dung người dùng
 * @param {object} deps.channel   - { id, name, greeting, aiEnabled }
 * @param {Array}  deps.history   - [{ role, text }]
 * @returns {Promise<{messages: string[], meta: object}>}
 */
export async function handleMessage({ dvc, ai, cfg, db = null, text, channel, history = [] }) {
  const input = String(text || '').trim();
  const meta = { engine: 'none', scope: null, kind: null, error: null };

  if (!input) {
    return { messages: [cfg.greeting], meta };
  }

  const intent = parseIntent(input);

  // Lời chào ("hi", "chào", "bắt đầu") -> chào lại + hướng dẫn.
  //
  // VÌ SAO CẦN: nếu không xử lý riêng, bot đi tìm thủ tục với từ "hi"
  // -> không ra kết quả -> trả "chưa tìm thấy thủ tục". Người dùng mới
  // mở chatbot thấy ngay thông báo lỗi, rất kém chuyên nghiệp.
  if (intent.type === 'greeting') {
    // Ưu tiên lời chào riêng của kênh (admin tự chỉnh trong trang quản trị),
    // nếu không có thì dùng lời chào chung của hệ thống.
    const greeting = channel?.greeting?.trim() || cfg.greeting;
    return {
      messages: [greeting],
      // Gợi ý nút bấm nhanh cho người dùng mới bắt đầu.
      quickReplies: buildGreetingQuickReplies(),
      meta,
    };
  }

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
    // ---------------------------------------------------------------
    //  THỦ TỤC RIÊNG CỦA XÃ (D1) — tra cứu TRƯỚC DVC.
    //
    // VÌ SAO trước: thủ tục do UBND xã khai báo là thông tin nội bộ
    // (đồng chí phụ trách, bàn số, số điện thoại) mà Cổng DVC Quốc gia
    // không có. Nếu tra DVC trước sẽ ra kết quả chung chung hoặc không
    // có kết quả -> người dân không biết hỏi ai.
    //
    // 3 tầng, từ mạnh -> yếu:
    //   A. Thủ tục đã GÁN chuyên viên + khớp mạnh -> trả ngay kèm
    //      bàn số / SĐT / tên đồng chí (đúng yêu cầu #2).
    //   B. Index D1 của xã (bigram + từ đồng nghĩa) -> trả danh sách
    //      thủ tục CÓ ÁP DỤNG TẠI XÃ kèm mức độ + link DVC.
    //   C. Cổng DVC Quốc gia (gateway) -> dữ liệu toàn quốc, dùng khi
    //      index xã không có kết quả (bản mới nhất chưa kịp import).
    // ---------------------------------------------------------------
    if (db && !intent.code) {
      const local = await searchLocalProcedures(db, input, { limit: 3 });
      const best = local[0];

      // CHỈ dùng thủ tục của xã khi câu hỏi khớp MẠNH:
      //   - trùng chính xác tên/mã/từ khoá admin khai báo, HOẶC
      //   - Dice >= 0.75 (câu hỏi gần như trùng tên thủ tục).
      //
      // VÌ SAO: câu hỏi chung ("hộ khẩu", "đăng ký kết hôn") phải tra
      // Cổng DVC Quốc gia để người dân thấy ĐẦY ĐỦ danh sách. Nếu để
      // thủ tục của xã cướp mất câu hỏi chung thì người dân sẽ bị giới
      // hạn trong 1 thủ tục duy nhất -> thiếu thông tin.
      const strongMatch = best && (best.exact || best.dice >= 0.75);

      if (strongMatch) {
        const p = best.procedure;
        meta.kind = 'local';
        meta.scope = 'ward-local';
        meta.localProcedureId = p.id;

        // Trả về bản tất định (có đủ bàn số, số điện thoại) để người
        // dân thấy chính xác, không phụ thuộc AI có "diễn giải" mất thông tin.
        return {
          messages: splitForChat(
            localProcedureToReply(p, { officeName: cfg.officeName })
          ),
          meta,
        };
      }

      // ---- Tầng B: index D1 của xã ----
      // Câu hỏi về thời gian -> bỏ qua (để AI trả lời, yêu cầu #4).
      const timeQ = isTimeQuestion(input);
      const wardHits = timeQ ? [] : await searchWardIndex(db, input, { limit: 6 });
      const wardTop = wardHits[0];
      if (wardTop && wardTop.score >= STRONG_SCORE) {
        meta.kind = 'ward-index';
        meta.scope = 'ward';
        meta.wardHits = wardHits.length;

        const lines = [];
        lines.push(
          `Tại xã Xuân Lãng, em tìm thấy ${wardHits.length} thủ tục liên quan:` +
            (wardHits.length === 1 ? '' : '')
        );
        for (const h of wardHits) {
          const r = h.row;
          lines.push('');
          lines.push(`• *${r.name}*`);
          if (r.code) lines.push(`  Mã: ${r.code}`);
          if (r.level) {
            const lv = { FULL: 'xã thực hiện toàn bộ', PARTIAL: 'xã thực hiện một phần', ALL: 'có liên quan' }[r.level];
            if (lv) lines.push(`  Mức độ: ${lv}`);
          }
          if (r.summary) {
            const s = cleanSummary(r.summary);
            if (s) lines.push(`  ${s}`);
          }
          if (r.officer) {
            const bits = [];
            if (r.desk) bits.push(`bàn số ${normalizeDesk(r.desk)}`);
            if (r.phone) bits.push(`SĐT ${r.phone}`);
            lines.push(
              `  👤 Đồng chí phụ trách: ${normalizeOfficer(r.officer)}` + (bits.length ? ` (${bits.join(', ')})` : '')
            );
          }
          if (r.citizen_url) lines.push(`  Nộp trực tuyến: ${r.citizen_url}`);
          else if (r.portal_url) lines.push(`  ${r.portal_url}`);
        }
        lines.push('');
        lines.push(
          'Anh/chị nhắn lại mã thủ tục (vd: 1.000894) để em tra cứu chi tiết đầy đủ ạ.'
        );
        return {
          messages: splitForChat(lines.join('\n')),
          quickReplies: wardHits
            .map((h) => ({ title: h.row.code || h.row.name.slice(0, 20), payload: h.row.code || h.row.name }))
            .filter((x) => x.payload)
            .slice(0, 13),
          meta,
        };
      }
    }

    // Lấy ngữ cảnh từ DVC
    const ctx = await buildContext(dvc, input, {
      defaultWardCode: cfg.defaultWardCode,
      // Câu hỏi về thời gian -> KHÔNG tra Cổng DVC, để AI trả lời
      // (yêu cầu #4: câu ngoài lề phải do AI xử lý).
      skipLookup: isTimeQuestion(input),
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

    // Bật AI: trả lời tự nhiên dựa trên ngữ cảnh
    const aiOn = channel?.aiEnabled !== false && cfg.ai.provider !== 'none';

    // Không có thủ tục nào khớp -> VẪN gọi AI với ngữ cảnh rỗng.
    //
    // VÌ SAO: trước đây code trả thẳng fallbackMessage ở đây, nên câu hỏi
    // ngoài phạm vi thủ tục (vd "hôm nay là ngày mấy", "thời tiết hôm nay")
    // bị chặn trước khi tới AI -> người dùng thấy "chưa tìm thấy thủ tục
    // phù hợp" dù AI hoạt động rất tốt. AI sẽ tự trả lời hoặc hướng dẫn
    // về đúng phạm vi bot theo system prompt.
    if (!ctx.text || !ctx.text.trim()) {
      if (aiOn) {
        const r = await ai.ask(input, buildNoDataContext(), { history });
        if (r.text) {
          meta.engine = r.engine;
          meta.kind = ctx.kind;
          return { messages: splitForChat(r.text.trim()), meta };
        }
      }
      // AI lỗi -> trả fallback tất định (luôn hoạt động)
      return { messages: [cfg.fallbackMessage], meta };
    }

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
      // Gắn thêm thông tin ngày tháng hiện tại vào ngữ cảnh để AI trả lời
      // được câu hỏi kiểu "hồ sơ này còn hạn đến khi nào?" / "hôm nay là thứ mấy?"
      //
      // Khi người dân gõ MÃ thủ tục, tra D1 theo mã để gắn thêm thông tin
      // NỘI BỘ của xã (đồng chí phụ trách, bàn số, SĐT) — Cổng DVC không có.
      let aiCtx = withCurrentDate(ctx.text);
      if (intent.code && db) {
        const localByCode = await getProcedureByCode(db, intent.code);
        if (localByCode && localByCode.officer) {
          aiCtx +=
            '\n\nTHÔNG TIN TIẾP NHẬN TẠI XÃ XUÂN LÃNG:\n' +
            localProcedureToText(localByCode) +
            `\n(Nhắc anh/chị: đến gặp đồng chí ${normalizeOfficer(localByCode.officer)}` +
            (localByCode.desk ? ` tại bàn số ${normalizeDesk(localByCode.desk)}` : '') +
            (localByCode.phone ? `, số điện thoại ${localByCode.phone}` : '') +
            ` tại ${cfg.officeName || 'Trung tâm Phục vụ hành chính công xã Xuân Lãng'}.)`;
        }
      }
      const r = await ai.ask(input, aiCtx, { history });
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
 * Ngữ cảnh cho trường hợp KHÔNG có thủ tục nào khớp.
 *
 * VÌ SAO CẦN: model AI không biết "hôm nay" là ngày nào — ngày trong
 * thế giới thật không nằm trong dữ liệu huấn luyện. Nếu không đưa ngày
 * hiện tại vào, câu hỏi "hôm nay là ngày mấy" sẽ bị AI trả lời sai
 * hoặc bịa đặt.
 *
 * Ngày lấy theo giờ Việt Nam (UTC+7) vì bot phục vụ người dân xã Xuân Lãng.
 */
export function buildNoDataContext(now = new Date()) {
  const d = vnDateParts(now);
  return (
    `DỮ LIỆU TRA CỨU:\n(Không có thủ tục nào khớp câu hỏi này)\n\n` +
    currentDateBlock(d) +
    `\nCÂU HỎI CỦA NGƯỜI DÙNG:\n(hãy trả lời dựa trên thông tin ngày tháng ở trên ` +
    `và chuyên môn của bạn; nếu câu hỏi ngoài phạm vi thủ tục hành chính thì ` +
    `hướng dẫn người dùng về việc tra cứu thủ tục hành chính)`
  );
}

/** Tách phần ngày tháng giờ VN ra khỏi Date. */
function vnDateParts(now = new Date()) {
  // Giờ Việt Nam = UTC + 7
  const vn = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const days = [
    'Chủ Nhật',
    'Thứ Hai',
    'Thứ Ba',
    'Thứ Tư',
    'Thứ Năm',
    'Thứ Sáu',
    'Thứ Bảy',
  ];
  return {
    dow: days[vn.getUTCDay()],
    d: vn.getUTCDate(),
    m: vn.getUTCMonth() + 1,
    y: vn.getUTCFullYear(),
    hh: String(vn.getUTCHours()).padStart(2, '0'),
    mm: String(vn.getUTCMinutes()).padStart(2, '0'),
  };
}

/** Khối text mô tả thời gian hiện tại (tiếng Việt). */
function currentDateBlock(d) {
  return (
    `THÔNG TIN THỜI GIAN HIỆN TẠI (giờ Việt Nam, UTC+7):\n` +
    `Hôm nay là ${d.dow}, ngày ${d.d}/${d.m}/${d.y}. Thời gian hiện tại: ${d.hh}:${d.mm}.`
  );
}

/**
 * Gắn thông tin ngày tháng hiện tại vào ngữ cảnh thủ tục.
 * Giúp AI trả lời được câu hỏi về thời gian (hạn chót, "hôm nay là thứ mấy").
 */
export function withCurrentDate(ctxText, now = new Date()) {
  const d = vnDateParts(now);
  return `${ctxText}\n\n${currentDateBlock(d)}`;
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

    const auth = asArray(d.departments_authority).map((x) => x.name).filter(Boolean);
    if (auth.length) lines.push(`Cơ quan tiếp nhận: ${auth.join('; ')}`);

    if (d.processing_time) {
      lines.push(`Thời gian xử lý: ${formatProcessingTime(d.processing_time, d.processing_time_unit)}`);
    }

    const comps = asArray(d.components)
      .map((c) => (c.name || c.description || '').replace(/^-\s*/, '').trim())
      .filter((n) => n && n.length > 4);
    if (comps.length) {
      lines.push('');
      lines.push('*Thành phần hồ sơ:*');
      for (const c of comps.slice(0, 12)) lines.push(`- ${c}`);
    }

    const results = asArray(d.results).map((r) => r.name).filter(Boolean);
    if (results.length) {
      lines.push('');
      lines.push(`*Kết quả:* ${results.join('; ')}`);
    }

    // Trình tự thực hiện (rút gọn) — giúp người dân hình dung quy trình.
    const steps = asArray(d.steps)
      .map((s) => (s.description || s.name || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    if (steps.length) {
      lines.push('');
      lines.push('*Trình tự:*');
      steps.slice(0, 6).forEach((s, i) => {
        const brief = s.length > 220 ? s.slice(0, 220) + '…' : s;
        lines.push(`${i + 1}. ${brief}`);
      });
    }

    // Link — luôn kèm link thủ tục trên Cổng DVC Quốc gia (yêu cầu #5).
    lines.push('');
    if (ctx.sources?.length) {
      for (const s of ctx.sources) lines.push(`🔗 ${s.label || 'Xem thêm'}: ${s.url}`);
    } else if (d.portal_url) {
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

/**
 * Nút bấm nhanh gợi ý khi người dùng mở chatbot / gửi lời chào.
 *
 * Payload = từ khoá tra cứu. Khi bấm, Messenger gửi payload -> bot tìm
 * thủ tục theo từ khoá đó -> trả danh sách kèm nút bấm mã thủ tục.
 *
 * Chọn các thủ tục phổ biến nhất ở xã (hộ khẩu, kết hôn, CMND, chứng
 * thư, đất đai, sinh con...).
 */
export function buildGreetingQuickReplies() {
  return [
    { title: 'Hộ khẩu', payload: 'hộ khẩu' },
    { title: 'Kết hôn', payload: 'kết hôn' },
    { title: 'Chứng minh nhân dân', payload: 'chứng minh nhân dân' },
    { title: 'Chứng thư', payload: 'chứng thư' },
    { title: 'Sinh con', payload: 'sinh con' },
    { title: 'Đất đai', payload: 'đất đai' },
    { title: 'Bảo hiểm xã hội', payload: 'bảo hiểm xã hội' },
  ];
}

/** Kiểm tra câu hỏi có liên quan tới thủ tục hành chính không (lọc rác). */
export function isRelevant(text) {
  const t = stripVN(text);
  return /(thu tuc|ho so|giay to|chung nhan|dang ky|cap |giai the|do an|chuyen |lam ho so)/.test(t);
}
