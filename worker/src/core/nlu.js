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

/** Câu hỏi có phải mã thủ tục không (vd "1.000894"). */
export function looksLikeCode(text) {
  return /^\d+\.\d+$/.test(String(text || '').trim());
}

/**
 * Tìm mã thủ tục xuất hiện ở BẤT KỲ vị trí nào trong câu.
 *
 * VÌ SAO CẦN:
 * Người dùng thường gõ kèm lời giới thiệu, ví dụ:
 *   "cho tôi xem 1.000894", "mã 1.000894 đó", "1.000894."
 * Regex ^\d+\.\d+$ trước đây chỉ khớp khi câu CHỈ CÓ mã -> rơi xuống
 * tìm kiếm tự do và ra thủ tục khác. Hàm này bắt mã ở giữa câu.
 */
export function extractCode(text) {
  const m = String(text || '').match(/\b(\d{1,3}\.\d{3,8})\b/);
  return m ? m[1] : null;
}

/**
 * Chuỗi fallback khi search đầy đủ không ra kết quả: bỏ dần từ cuối.
 * "đăng ký kết hôn tại xã Xuân Lãng" -> "đăng ký kết hôn"
 */
export function keywordFallbacks(text) {
  const tokens = String(text || '').trim().split(/\s+/).filter(Boolean);
  const out = [];
  // Thử cả 2 dạng viết "đăng ký" <-> "đăng kí"
  const variants = [tokens];
  const swapped = tokens.map((t) =>
    t.toLowerCase() === 'đăng ký' ? 'đăng kí' : t.toLowerCase() === 'đăng kí' ? 'đăng ký' : t
  );
  if (swapped.join(' ') !== tokens.join(' ')) variants.push(swapped);

  for (const variant of variants) {
    for (let i = variant.length; i >= 1; i--) {
      const cand = variant.slice(0, i).join(' ').trim();
      if (cand) out.push(cand);
    }
  }
  return [...new Set(out)];
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
  return { type: 'question', text: t };
}
