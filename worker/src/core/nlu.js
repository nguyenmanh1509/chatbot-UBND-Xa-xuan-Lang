/**
 * Xử lý câu hỏi tiếng Việt — trích xuất địa danh + từ khóa.
 * Chuyển từ index.html sang dùng chung cho web / Zalo / Facebook.
 */

/**
 * Thay thế chuỗi trong văn bản tiếng Việt, dùng ranh giới từ KHÔNG dựa vào \b.
 *
 * LÝ DO: trong JS regex, \b chỉ coi ký tự [A-Za-z0-9_] là "từ".
 * Tiếng Việt có dấu (ì, ã, ơ, ư, đ, ă...) không thuộc nhóm đó, nên \b
 * sẽ KHÔNG khớp ranh giới quanh các từ như "cần", "gì", "để", "xã"...
 * -> stopword không bao giờ được loại bỏ.
 *
 * Cách đúng: dùng ranh giới dựa trên khoảng trắng (^ | $) thay vì \b.
 */
export function vnReplace(text, pattern, replacement) {
  const re = new RegExp('(^|\\s)(?:' + pattern + ')(?=\\s|$)', 'gi');
  return String(text || '').replace(re, (m, pre) => pre + ' ');
}

/** Bỏ dấu + lower-case để so khớp tiếng Việt có/không dấu. */
export function stripVN(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd');
}

/**
 * Tách câu tự nhiên thành { wardQuery, provinceQuery, keyword }.
 * Nhận diện các cụm địa danh đi kèm từ khóa "xã/phường/tỉnh..." hoặc dạng "tại X".
 */
export function extractLocationAndKeyword(text) {
  // Từ định danh / câu hỏi — KHÔNG phải tên địa danh.
  const QUESTION_WORDS = [
    'đâu', 'nào', 'gì', 'thế nào', 'ra sao', 'sao', 'bao nhiêu',
    'mấy', 'gì vậy', 'thế', 'nữa', 'vậy', 'kì', 'ki',
  ];

  // Nhóm 1: địa danh có tiền tố hành chính rõ ràng (xã, phường, tỉnh...)
  // Ranh giới kết thúc tên địa danh: dấu phẩy, giới từ, hoặc bắt đầu phần
  // "nội dung thủ tục" (thủ tục/hồ sơ/làm/cần...) — tránh nuốt cả câu.
  const NAME_END =
    '(?=,|\\s+tại\\s|\\s+ở\\s|\\s+của\\s|\\s+là\\s|\\s+thủ\\s*tục|\\s+hồ\\s*sơ|\\s+giấy\\s*tờ|\\s+làm\\s|\\s+cần\\s|$)';
  const wardMarkers = [
    new RegExp(
      '(?:xã|phường|thị\\s*trấn|quận|huyện|thị\\s*xã)\\s+([A-ZÀ-Ỹ][A-Za-zÀ-ỹĐđ\\s]+?)' + NAME_END,
      'gi'
    ),
  ];
  const provinceMarkers = [
    new RegExp(
      '(?:tỉnh|thành\\s*phố|tp\\.?)\\s+([A-ZÀ-Ỹ][A-Za-zÀ-ỹĐđ\\s]+?)' + NAME_END,
      'gi'
    ),
  ];

  const wardQuery = [];
  const provinceQuery = [];
  let workText = String(text || '');

  for (const re of provinceMarkers) {
    workText = workText.replace(re, (m, name) => {
      const clean = name.trim();
      if (clean.length >= 2) provinceQuery.push(clean);
      return ' ';
    });
  }

  for (const re of wardMarkers) {
    workText = workText.replace(re, (m, name) => {
      const clean = name.trim();
      if (clean.length >= 2) wardQuery.push(clean);
      return ' ';
    });
  }

  // Bỏ các cụm "tại/ở/của + tên riêng viết hoá" còn sót (vd "tại Xuân Lãng").
  // Đưa vào cả hai danh sách để thử nhánh xã trước, rồi tới tỉnh.
  // Dùng (^|\s) thay vì \b: "ở"/"tại"/"của" có dấu nên \b không khớp ranh giới.
  workText = workText.replace(
    /(^|\s)(?:tại|ở|của)\s+([A-ZÀ-Ỹ][A-Za-zÀ-ỹĐđ]+(?:\s+[A-ZÀ-Ỹ][A-Za-zÀ-ỹĐđ]+)*)/g,
    (m, pre, name) => {
      const clean = name.trim();
      const n = stripVN(clean);
      const known = [...wardQuery, ...provinceQuery].some((p) => {
        const sp = stripVN(p);
        return sp.includes(n) || n.includes(sp);
      });
      // Loại từ định danh ("ở đâu" -> không phải địa danh)
      const isQuestion = QUESTION_WORDS.some((w) => n === stripVN(w));
      if (clean.length >= 2 && !known && !isQuestion) {
        wardQuery.push(clean);
        provinceQuery.push(clean);
      }
      return pre + ' ';
    }
  );

  // Loại stop-words đầu câu + từ nối (dùng vnReplace: \b không nhận tiếng Việt có dấu)
  workText = vnReplace(
    workText,
    'thủ\\s*tục|hồ\\s*sơ|giấy\\s*tờ|thông\\s*tin|về|cách|làm\\s*thế\\s*nào|tại|ở|của|với|cho|là|thì|mà|như|nhé|ạ|giúp|em|anh|chị|bạn|xin\\s*hỏi|cho\\s*mình|cho\\s*tôi|cần|gì|để|muốn|những|các|một|được|ra|vào|bao\\s*nhiêu|thủ\\s*tục\\s*nào|nào',
    ' '
  );

  const keyword = workText.replace(/\s+/g, ' ').trim();
  return { wardQuery, provinceQuery, keyword };
}

/** Từ khóa truy vấn thủ tục: bỏ dấu, bỏ số thứ tự đầu câu. */
export function normalizeKeyword(kw) {
  return stripVN(kw)
    .replace(/\b\d+\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Câu hỏi có phải mã thủ tục không (vd "1.000894" hoặc "1.005.123"). */
export function looksLikeCode(text) {
  return /^\d{1,3}(?:\.\d{3,6}){1,3}$/.test(String(text || '').trim());
}

/**
 * Tìm mã thủ tục xuất hiện ở BẤT KỲ vị trí nào trong câu.
 *
 * VÌ SAO CẦN:
 * Người dùng thường gõ kèm lời giới thiệu, ví dụ:
 *   "cho tôi xem 1.000894", "mã 1.000894 đó", "1.000894."
 * Regex ^\d+\.\d+$ trước đây chỉ khớp khi câu CHỈ CÓ mã -> rơi xuống
 * tìm kiếm tự do và ra thủ tục khác. Hàm này bắt mã ở giữa câu.
 *
 * Định dạng mã thủ tục thực tế: "1.000894" hoặc "1.005.123" (nhóm số
 * phân tách bằng dấu chấm). Regex phải giữ trọn vẹn cả chuỗi, nếu không
 * "1.005.123" sẽ bị cắt còn "1.005" -> tra nhầm thủ tục khác.
 */
export function extractCode(text) {
  const m = String(text || '').match(/\b(\d{1,3}(?:\.\d{3,6}){1,3})\b/);
  return m ? m[1] : null;
}

/**
 * Chuỗi fallback khi search đầy đủ không ra kết quả: bỏ dần từ cuối.
 * "đăng ký kết hôn tại xã Xuân Lãng" -> "đăng ký kết hôn"
 *
 * VÌ SAO CẦN GIỚI HẠN ĐỘ DÀI TỐI THIỂU:
 * Ví dụ người dùng gõ "đăng kí kết hôn" (viết "kí" thay "ký"):
 *   - "đăng kí kết hôn" -> API trả 0 kết quả
 *   - bỏ từ cuối: "đăng kí kết" -> 0, "đăng kí" -> 0
 *   - bỏ tiếp: "đăng" -> 1303 kết quả (quá rộng, sai hoàn toàn)
 *
 * Nếu không giới hạn, bot trả 1303 thủ tục vô nghĩa thay vì báo "không
 * tìm thấy". Vì vậy chỉ chấp nhận chuỗi fallback có TỪ ÍT NHẤT 2 từ,
 * và loại bỏ các từ quá chung chung ("đăng", "cấp", "làm", "thủ tục"...).
 */
export function keywordFallbacks(text) {
  const tokens = String(text || '').trim().split(/\s+/).filter(Boolean);
  const out = [];

  // Thử cả 2 dạng viết "đăng ký" <-> "đăng kí", "cấp" <-> "cấp mới"...
  const variants = [tokens];
  const swap = (t) => {
    const s = t.toLowerCase();
    if (s === 'đăng ký') return 'đăng kí';
    if (s === 'đăng kí') return 'đăng ký';
    return t;
  };
  const swapped = tokens.map(swap);
  if (swapped.join(' ') !== tokens.join(' ')) variants.push(swapped);

  for (const variant of variants) {
    // Bỏ các từ generic ở ĐẦU câu.
    //
    // VÌ SAO: API DVC rất kén từ khóa. Đo được:
    //   "cấp hộ khẩu"  -> 0 kết quả
    //   "hộ khẩu"      -> 7 kết quả  (đúng ý!)
    //   "đăng ký kết hôn" -> 8, "kết hôn" -> 12
    // Tức là từ "cấp"/"đăng ký" ở đầu chỉ gây nhiễu. Bỏ chúng đi sẽ ra
    // đúng kết quả mong muốn.
    const stripped = stripLeadingGeneric(variant);

    // THỨ TỰ QUAN TRỌNG:
    // 1) chuỗi gốc đầy đủ      -> "cấp hộ khẩu" (API trả 0)
    // 2) chuỗi đã bỏ generic    -> "hộ khẩu"     (API trả 7, ĐÚNG Ý)
    // 3) rồi mới bỏ dần từ cuối -> "cấp hộ"     (API trả 63, quá rộng)
    //
    // Nếu bỏ dần từ cuối TRƯỚC khi bỏ từ generic, ta dừng ở "cấp hộ" và
    // nhận 63 thủ tục vô nghĩa thay vì 7 thủ tục đúng.
    const bases = [variant, stripped];
    for (const base of bases) {
      const cand = base.join(' ').trim();
      if (cand) out.push(cand);
    }
    for (const base of bases) {
      for (let i = base.length - 1; i >= 2; i--) {
        const cand = base.slice(0, i).join(' ').trim();
        if (cand) out.push(cand);
      }
    }
  }
  return [...new Set(out)];
}

/**
 * Bỏ các từ generic ở đầu chuỗi (vd "đăng ký", "cấp", "làm", "thủ tục").
 * Giữ nguyên phần còn lại nếu còn đủ từ có nghĩa.
 */
export function stripLeadingGeneric(tokens) {
  const out = [...tokens];
  while (out.length > 2) {
    const first = stripVN(out[0]);
    const second = stripVN(out[1] || '');
    // "đăng ký"/"đăng kí" -> bỏ cả cụm 2 từ
    if (first === 'dang' && (second === 'ky' || second === 'ki')) {
      out.splice(0, 2);
      continue;
    }
    // "thủ tục" -> bỏ cả cụm 2 từ
    if (first === 'thu' && second === 'tuc') {
      out.splice(0, 2);
      continue;
    }
    if (GENERIC_SINGLE.has(first)) {
      out.shift();
      continue;
    }
    break;
  }
  return out;
}

/**
 * Từ quá chung chung — dùng một mình sẽ trả về hàng nghìn thủ tục vô nghĩa.
 * Chỉ dùng khi kèm thêm từ khác (ví dụ "cấp hộ khẩu" -> "cấp" là OK).
 */
export const GENERIC_KEYWORDS = new Set([
  'đăng', 'dang', 'cấp', 'cap', 'làm', 'lam', 'thủ', 'tục', 'thu', 'tuc',
  'hồ', 'sơ', 'ho', 'so', 'giấy', 'tờ', 'giay', 'to', 'thông', 'tin',
  'ký', 'ký', 'ky', 'ki',
]);

/** Từ generic đơn lẻ có thể bỏ ở đầu chuỗi tìm kiếm. */
const GENERIC_SINGLE = new Set([
  'dang', 'cap', 'lam', 'thu', 'ho', 'so', 'giay', 'to',
]);

/**
 * Chuỗi tìm kiếm có quá chung chung không?
 *
 * Một chuỗi chỉ gồm các từ generic ("đăng", "cấp", "thủ tục"...) sẽ
 * trả về hàng nghìn thủ tục không liên quan. Còn "cấp hộ khẩu" thì có
 * từ cụ thể nên vẫn OK.
 *
 * LƯU Ý: so khớp theo TỪ, không theo cụm. Vì vậy "đăng ký" (2 từ, cả 2
 * đều generic) vẫn bị coi là generic -> tránh trả về 1120 thủ tục.
 */
export function isGenericKeyword(text) {
  const tokens = stripVN(String(text || '')).split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  // Cần ÍT NHẤT 1 từ không generic thì mới dùng làm từ khoá tìm kiếm.
  return tokens.every((t) => GENERIC_KEYWORDS.has(t));
}

/**
 * Các lời chào / lệnh bắt đầu mà người dùng hay gõ (hoặc bấm nút
 * "Bắt đầu" / "Get Started" của Messenger).
 *
 * VÌ SAO CẦN:
 * Nếu không nhận diện, bot coi "hi" là câu hỏi tra cứu thủ tục -> tìm
 * không ra -> trả "chưa tìm thấy thủ tục". Người dùng mới mở chatbot
 * thấy ngay thông báo lỗi thay vì lời chào hướng dẫn.
 */
const GREETING_PATTERNS = [
  // Lời chào cơ bản (so khớp cả bản có dấu và bản đã bỏ dấu)
  /^(hi|hello|hey|hiya|yo|ok|okay|good\s*(morning|afternoon|evening|day)|goodmorning|goodafternoon)$/i,
  /^(chao|chao ban|chao a|chao chi|chao anh|chao em|chao co|chao ong|chao ba|chao mo|chao anh chi|xin chao|chao anh\/chi|xin chao anh chi)$/i,
  // "Bắt đầu" - nút Get Started của Messenger
  /^(bat dau|batdau|start|get started|go|begin|khai bao)$/i,
];

/**
 * Câu hỏi có phải lời chào không?
 *
 * CHỈ nhận diện khi câu NGẮN (vài từ). Câu dài kiểu "chào bạn, cho tôi
 * hỏi về đăng ký kết hôn" là câu hỏi thật, không phải lời chào.
 */
export function isGreeting(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (t.split(/\s+/).length > 5) return false;
  const plain = t.replace(/[!?.]+$/g, '').trim();
  // Bỏ dấu để so khớp: "chào" -> "chao", "xin chào" -> "xin chao".
  const noAccent = stripVN(plain);
  return GREETING_PATTERNS.some((re) => re.test(plain) || re.test(noAccent));
}

/** Tách câu hỏi thành các thông tin có cấu trúc (cho AI). */
export function parseIntent(text) {
  const t = String(text || '').trim();
  const lower = stripVN(t);

  const commands = {
    '/danhmuc': 'categories',
    '/canquan': 'agencies',
    '/tinhthanh': 'provinces',
    '/nhom': 'service-groups',
    '/timphuong': 'search-wards',
    '/phuong': 'ward-detail',
    '/phuongtoi': 'my-ward',
    '/thongke': 'stats',
    '/trogiup': 'help',
    '/chitiet': 'detail',
  };
  const cmdKey = lower.split(/\s+/)[0];
  if (cmdKey.startsWith('/') && commands[cmdKey]) {
    return { type: 'command', command: commands[cmdKey], arg: t.slice(cmdKey.length).trim() };
  }
  if (looksLikeCode(t)) {
    return { type: 'procedure-code', code: t.trim() };
  }
  // Lời chào -> trả lời chào, KHÔNG đi tìm thủ tục.
  if (isGreeting(t)) {
    return { type: 'greeting' };
  }
  return { type: 'question', text: t };
}
