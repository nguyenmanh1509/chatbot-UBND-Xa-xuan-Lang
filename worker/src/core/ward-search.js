/**
 * Tìm kiếm thủ tục trên D1 (index nội bộ của xã) — bộ não tra cứu.
 *
 * VÌ SAO KHÔNG DÙNG full-text của Cổng DVC:
 * Gateway `dichvucong.cloudgo.vn` tìm theo chuỗi rời (không phân tích từ),
 * nên "hộ khẩu" khớp với "nhập khẩu", "cửa khẩu" và trả về danh sách
 * vô nghĩa (đo thực tế: "hộ khẩu" -> 6 thủ tục toàn về xuất nhập khẩu).
 *
 * Bộ tìm kiếm này dùng 3 lớp:
 *   1) BIGRAM  -> "ho khau" phải xuất hiện liền nhau trong tên.
 *   2) TỪ ĐỒNG NGHĨA -> "hộ khẩu" ~ "sổ hộ khẩu", "căn cước", "CMND".
 *   3) ĐỘ ƯU TIÊN -> thủ tục xã làm TOÀN BỘ (level=FULL) đứng đầu,
 *      sau đó PARTIAL, cuối cùng ALL (chỉ liên quan).
 *
 * Nhờ vậy câu "cấp hộ khẩu" trả về đúng "Cấp thẻ Căn cước" thay vì
 * "cấp giấy phép nhập khẩu".
 */

/** Bỏ dấu + hạ chữ thường. */
function deaccent(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/**
 * Từ dừng — CHỈ loại những từ không mang nghĩa hành chính.
 *
 * KHÔNG loại "ho" (hộ) hay "so" (sổ) vì "hộ khẩu" là cụm phổ biến nhất.
 * Thay vào đó dùng bigram để bắt "ho khau".
 */
const STOP = new Set([
  'anh', 'chi', 'em', 'ban', 'toi', 'minh', 'nha', 'xin', 'hoi', 'giup',
  'giay', 'to', 'nao', 'gi', 'de', 'cho', 'can', 'muon', 'lam', 'the',
  'ra', 'sao', 'bao', 'nhieu', 'co', 'khong', 'voi', 'cua', 'tai', 'o',
  'la', 'thi', 'ma', 'nhu', 'nen', 've', 'nhung', 'cac', 'mot', 'duoc',
  'vao', 'nay', 'do', 'ba', 'ngoai', 'vay', 'ai', 'bay', 'gio', 'nua',
  'khi', 'neu', 'hay', 'va', 'hoac', 'da', 'dang', 'se', 'rat', 'qua',
  'nho', 'nguoi', 'dung', 'giup', 'em',
]);
// "thu tuc" (thủ tục) bị loại theo CỤM chứ không theo từ đơn lẻ,
// vì "thu" còn là một phần của "chung thu" (chứng thư) — loại từ đơn
// lẻ sẽ làm mất thủ tục "Cấp chứng thư".
const STOP_PHRASES = ['thu tuc', 'thu tu chi', 'ho so'];

/**
 * Từ đồng nghĩa: từ khoá người dân hay dùng -> các từ có trong tên
 * thủ tục hành chính.
 *
 * Đây là "bản dịch" từ cách nói của người dân sang cách gọi chính
 * thức trong Cổng DVC — ví dụ dân hỏi "hộ khẩu" nhưng thủ tục tên
 * là "Cấp thẻ Căn cước".
 */
const ALIAS = {
  'ho khau': ['ho khau', 'so ho khau', 'can cuoc', 'chung minh nhan dan', 'cccd', 'the can cuoc'],
  'can cuoc': ['can cuoc', 'cccd', 'chung minh nhan dan', 'ho khau'],
  'chung minh nhan dan': ['chung minh nhan dan', 'cccd', 'can cuoc', 'the can cuoc'],
  'ket hon': ['ket hon', 'dang ky ket hon', 'le ket hon'],
  'chung thu': ['chung thu', 'cap chung thu', 'xac nhan chung thu'],
  'sinh con': ['sinh con', 'giay khai sinh', 'cap giay khai sinh', 'khai sinh'],
  'bao hiem xa hoi': ['bao hiem xa hoi', 'bhxh'],
  'xe may': ['xe may', 'dang ky xe', 'bien so xe', 'cap bien so xe'],
  'o': ['o', 'dau o', 'chung cu'],
  'dat dai': ['dat dai', 'quy hoach dat dai', 'giay chung nhan quy hoach', 'cap quy hoach dat dai', 'cap giay chung nhan quy hoach dat dai', 'dang ky dat dai', 'cap giay chung nhan quyen su dung dat', 'cap giay chung nhan dat'],
  'dat': ['dat', 'dat dai', 'quy hoach dat dai', 'giay chung nhan quy hoach', 'cap quy hoach dat dai', 'cap giay chung nhan quy hoach dat dai', 'cap giay chung nhan quyen su dung dat'],
  'do dat': ['do dat', 'trich lap ban do'],
  'quyet phap': ['quyet phap', 'giao dat', 'thue dat'],
  'dich vu cong': ['dich vu cong', 'dvc'],
};

/**
 * Cụm từ CHUNG CHUNG — khớp thì chỉ cộng điểm nhỏ.
 *
 * VÌ SAO: "chứng nhận", "giấy tờ", "đăng ký" xuất hiện trong HÀNH TRĂM
 * tên thủ tục. Nếu cộng điểm như cụm đặc thì câu "giấy chứng nhận đất
 * đai" sẽ ra "chứng nhận xuất trình giấy tờ tại Bộ Ngoại giao" — hoàn
 * toàn sai.
 */
const WEAK_PHRASES = new Set([
  'chung nhan', 'giay to', 'cap', 'dang ky', 'xac nhan', 'thu tuc',
  'cap giay', 'cap lai', 'sua doi', 'bo sung', 'giai the', 'ho so',
  'nganh', 'linh vuc', 'co quan',
]);

/**
 * Từ đầu YẾU — khi đứng đầu bigram thì bigram đó chung chung.
 *
 * "giấy chứng nhận đất đai" -> bigram "chung nhan" (yếu), "nhan dat" (yếu),
 * "dat dai" (mạnh). Bỏ 2 bigram yếu -> SQL lọc chính xác "dat dai".
 */
const WEAK_PREFIX = new Set([
  'giay', 'chung', 'cap', 'dang', 'xac', 'thu', 'ho', 'hoa', 'sua',
  'bo', 'nhan', 'la', 'tuc', 'mo',
]);

/**
 * Từ CÓ NGHĨA (bỏ từ chung chung) -> dùng để tính độ phủ.
 */
const WEAK_TOKENS = new Set([
  'giay', 'chung', 'nhan', 'cap', 'dang', 'ky', 'la', 'tuc',
  'xac', 'mo', 'bo', 'sua', 'doi', 'them', 'va', 'cua', 'cho', 'theo',
  'trong', 'truoc', 'khac', 'toi', 'voi', 'nhung', 'khi', 'de', 'bi',
  // "so" (sổ) xuất hiện trong "số" của rất nhiều tên thủ tục.
  'so',
  // "ho" (hộ) trùng với "hỗ trợ" -> gây nhiễu nặng. Cụm "hộ khẩu" vẫn
  // được bắt chính xác qua BIGRAM "ho khau".
  'ho',
]);

/**
 * Từ bổ nghĩa — dân KHÔNG hỏi tới nhưng có trong tên thủ tục.
 *
 * VÌ SAO CẦN: câu "cấp hộ khẩu" mà đưa lên đầu là "Cấp lại thẻ căn
 * cước" là sai — dân muốn CẤP MỚI. Tương tự "giấy chứng nhận đất đai"
 * mà ra "Giải quyết tranh chấp đất đai" là hoàn toàn lệch.
 *
 * So khớp theo RÁNH GIỚI TỪ (word boundary) để "lai" trong "cấp lại"
 * không bị nhầm với "lai" trong "hoàng lại".
 */
const NEG_MODIFIERS = [
  ['tranh chap', -150],
  ['hoa giai', -150],
  ['thu hoi', -150],
  ['dinh chinh', -150],
  ['giai the', -120],
  ['xoa ghi', -120],
  ['lai', -90],
  ['doi', -90],
  ['chuyen nghiep', -60],
  ['xuong hang', -80],
  ['trong hanh', -80],
  ['chuyen quyen', -80],
];

/**
 * Hậu tố "(thực hiện tại cấp tỉnh)" / "(thực hiện tại cấp trung ương)".
 *
 * XÃ là nơi tiếp nhận -> thủ tục KHÔNG có hậu tố này mới đúng cho dân.
 */
const NESTED_LEVEL_HINT = /thuc hien tai cap (tinh|trung uong)/;

/**
 * Cụm bổ nghĩa có trong tên nhưng KHÔNG có trong câu hỏi?
 *
 * @param {string} nameN  - tên thủ tục đã bỏ dấu
 * @param {string} queryN - câu hỏi đã bỏ dấu
 */
function hasUnaskedModifier(nameN, queryN) {
  for (const [mod] of NEG_MODIFIERS) {
    const nameHit = new RegExp(`(?:^|[^a-z0-9])${mod}(?:[^a-z0-9]|$)`, 'i').test(nameN);
    if (!nameHit) continue;
    const queryHit = new RegExp(`(?:^|[^a-z0-9])${mod}(?:[^a-z0-9]|$)`, 'i').test(queryN);
    if (!queryHit) return mod;
  }
  return '';
}
// "thu" KHÔNG bị loại vì nó là một phần của "chung thu" (chứng thư) —
// cụm này được bắt qua bigram "chung thu".

/** Trả về mảng các cụm từ cần tìm (bản thân + từ đồng nghĩa). */
export function expandQuery(rawText) {
  let base = deaccent(rawText).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!base) return { tokens: [], phrases: [], keyTokens: [], bigrams: [] };

  // Loại các cụm chung chung TRƯỚC khi tách từ.
  for (const p of STOP_PHRASES) {
    base = base.split(p).join(' ');
  }
  base = base.replace(/\s+/g, ' ').trim();

  const tokens = base.split(' ').filter((t) => t.length >= 2 && !STOP.has(t));
  if (!tokens.length) return { tokens: [], phrases: [], keyTokens: [], bigrams: [] };

  // Bigram: "cap ho khau" -> ["cap ho", "ho khau"]
  // CHỈ giữ bigram có ít nhất 1 từ CÓ NGHĨA, nếu không bigram sẽ toàn
  // từ chung chung ("cap giay", "thu tuc") và kéo về nhiễu.
  //
  // THÊM: bỏ bigram có TỪ ĐẦU yếu ("chung nhan", "nhan dat", "cap giay")
  // vì chúng xuất hiện trong hàng trăm tên thủ tục -> chỉ trừ nhiễu.
  // Ngoại lệ: bigram có sẵn trong ALIAS ("chung thu", "ho khau").
  const bigrams = [];
  for (let i = 0; i + 1 < tokens.length; i++) {
    const a = tokens[i];
    const b = tokens[i + 1];
    if (WEAK_TOKENS.has(a) && WEAK_TOKENS.has(b)) continue;
    if (WEAK_PREFIX.has(a) && !ALIAS[b] && !ALIAS[a + ' ' + b]) continue;
    bigrams.push(a + ' ' + b);
  }

  // Gộp cụm đồng nghĩa
  const phrases = new Set();
  for (const t of tokens) {
    const a = ALIAS[t];
    if (a) for (const x of a) phrases.add(x);
  }
  for (const b of bigrams) {
    const a = ALIAS[b];
    if (a) for (const x of a) phrases.add(x);
  }
  // Cụm trong câu hỏi cũng là phrase để so khớp nguyên văn
  for (const b of bigrams) phrases.add(b);
  if (tokens.length === 1) phrases.add(tokens[0]);
  // Từ CÓ NGHĨA (bỏ từ chung chung) -> dùng để lọc SQL và tính độ phủ.
  const keyTokens = tokens.filter((t) => !WEAK_TOKENS.has(t));

  return { tokens, phrases: [...phrases], keyTokens, bigrams };
}

/**
 * Chạy truy vấn lấy thủ tục ứng viên.
 *
 * Tách riêng để xử lý lỗi D1 (thiếu cột name_pad/category_pad khi
 * migration chưa chạy) -> trả về mảng rỗng thay vì làm sập request.
 */
async function queryRows(db, clause, binds, limit) {
  try {
    const res = await db
      .prepare(
        `SELECT id, name, code, level, category, agency, summary, citizen_url,
                portal_url, dvc_id, case_code, officer, desk, phone, office_hours
         FROM procedures
         WHERE active = 1 AND ${clause}
         LIMIT ${Number(limit) || 200}`
      )
      .bind(...binds)
      .all();
    return res?.results || [];
  } catch (_) {
    return [];
  }
}

/**
 * Tìm thủ tục trong D1.
 *
 * @param {object} db   - D1 binding
 * @param {string} query - câu hỏi của người dân
 * @param {object} opts
 * @param {number} opts.limit - số kết quả trả về
 * @returns {Promise<Array<{row, score, level, phraseHit}>>}
 */
export async function searchWardIndex(db, query, { limit = 6 } = {}) {
  if (!db) return [];
  const { tokens, phrases, keyTokens, bigrams } = expandQuery(query);
  if (!tokens.length) return [];

  // ------------------------------------------------------------------
  //  PHA 1: lọc theo CỤM TỪ (bigram + từ đồng nghĩa) -> độ chính xác cao.
  //
  //  VÌ SAO: "giấy chứng nhận đất đai" phải ra thủ tục có CỤM "dat dai"
  //  trong tên. Nếu lọc theo từ rời ("dat" VÀ "dai") thì "văn phòng đại
  //  diện ... địa điểm" cũng khớp -> kéo về hàng trăm thủ tục sai.
  // ------------------------------------------------------------------
  const strongPhrases = [
    ...bigrams,
    ...phrases.filter((p) => p.includes(' ')),
  ].filter((p, i, arr) => p.length >= 4 && arr.indexOf(p) === i);

  let rows = [];
  if (strongPhrases.length) {
    const ors = [];
    const binds = [];
    for (const p of strongPhrases.slice(0, 10)) {
      ors.push('(name_pad LIKE ? OR category_pad LIKE ?)');
      const like = `% ${p} %`;
      binds.push(like, like);
    }
    rows = await queryRows(db, `(${ors.join(' OR ')})`, binds, 200);
  }

  // ------------------------------------------------------------------
  //  PHA 2 (fallback): lọc theo TỪ CÓ NGHĨA khi pha 1 không ra gì.
  //  Dùng khi người dân hỏi bằng từ đơn lẻ ("sinh con", "chứng thu").
  // ------------------------------------------------------------------
  if (!rows.length) {
    const keys = keyTokens.length ? keyTokens : tokens;
    const where = [];
    const binds = [];
    for (const t of keys.slice(0, 3)) {
      where.push('(name_pad LIKE ? OR category_pad LIKE ?)');
      const like = `% ${t} %`;
      binds.push(like, like);
    }
    if (where.length) {
      rows = await queryRows(db, `(${where.join(' AND ')})`, binds, 200);
    }
  }

  if (!rows.length) return [];

  // 2) Chấm điểm chi tiết trong JS.
  //
  // NGUYÊN TẮC: điểm phản ánh "mức độ đặc thù" của từ khoá.
  //   - Cụm ĐẶC (đồng nghĩa / bigram cụ thể) trong TÊN -> điểm cao.
  //   - Cụm CHUNG CHUNG ("chứng nhận", "cấp") -> điểm thấp.
  //   - Độ phủ tính trên các từ CÓ NGHĨA (bỏ từ chung chung).
  const scored = [];
  for (const row of rows) {
    const nameN = deaccent(row.name);
    const catN = deaccent(row.category || '');
    const baseText = deaccent(query).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
    const nameTokens = nameN.split(/[^a-z0-9]+/).filter(Boolean);
    const nameTokenSet = new Set(nameTokens);

    let score = 0;
    let phraseHit = 0;

    // 2a. Khớp CỤM trong TÊN. Cụm đặc -> 120 điểm, cụm chung -> 15.
    for (const p of phrases) {
      if (p.length < 4) continue;
      if (!nameN.includes(p)) continue;
      phraseHit += 1;
      score += WEAK_PHRASES.has(p) ? 15 : 120;
    }

    // 2b. Khớp cụm trong LĨNH VỰC (vd "Đất đai", "Cấp, quản lý căn cước").
    //     Đây là tín hiệu RẤT mạnh vì lĩnh vực gọi tên đúng nhóm việc.
    for (const p of phrases) {
      if (p.length >= 4 && catN.includes(p)) {
        score += WEAK_PHRASES.has(p) ? 10 : 90;
        phraseHit += 1;
      }
    }

    // 2c. Độ phủ từ khoá CÓ NGHĨA trong tên.
    const keyTokens = tokens.filter((t) => !WEAK_TOKENS.has(t));
    const useTokens = keyTokens.length ? keyTokens : tokens;
    let hit = 0;
    for (const t of useTokens) if (nameTokenSet.has(t)) hit += 1;
    if (hit) {
      const coverage = hit / useTokens.length;
      // Phủ đủ -> thưởng lớn; phủ một phần -> thưởng vừa.
      score += coverage >= 0.99 ? 90 : coverage >= 0.6 ? 55 : 20;
    }

    // 2d. Trùng khớp cả cụm câu hỏi -> chắc chắn đúng.
    if (baseText && nameN.includes(baseText)) score += 200;

    // 2e. Không khớp gì -> bỏ.
    if (score <= 0) continue;

    // 2e1. PHẠT từ bổ nghĩa mà dân không hỏi tới.
    //      "cấp hộ khẩu" không muốn "Cấp LẠI thẻ căn cước".
    const unasked = hasUnaskedModifier(nameN, baseText);
    if (unasked) {
      const penalty = NEG_MODIFIERS.find(([m]) => m === unasked)?.[1] ?? -90;
      score += penalty;
    }

    // 2e2. Thủ tục lồng cấp tỉnh/trung ương -> xã chỉ TIẾP NHẬN.
    if (NESTED_LEVEL_HINT.test(nameN)) score -= 30;

    // 2f. Ưu tiên mức độ thực hiện tại xã.
    const levelBonus = { FULL: 60, PARTIAL: 35, ALL: 10 }[row.level] ?? 0;
    score += levelBonus;

    // 2g. Đã gán chuyên viên -> ưu tiên (thông tin liên hệ hữu ích nhất).
    if (row.officer) score += 20;

    // 2h. Tên NGẮN hơn thường đúng hơn (giảm ưu tiên tên dài dò dẫm).
    //     "Cấp thẻ căn cước" đúng hơn "Cấp thẻ căn cước cho người dưới
    //     14 tuổi (thực hiện tại cấp trung ương)".
    score -= Math.min(20, Math.floor(String(row.name || '').length / 12));

    scored.push({ row, score, level: row.level || '', phraseHit });
  }

  scored.sort((a, b) => b.score - a.score || String(a.row.name).length - String(b.row.name).length);

  // Loại biến thể trùng nhau: "Cấp lại thẻ căn cước (thực hiện tại cấp tỉnh)"
  // và "Cấp lại thẻ căn cước" là CÙNG một thủ tục -> chỉ giữ bản tốt nhất.
  const seen = new Set();
  const unique = [];
  for (const s of scored) {
    const key = s.row.name
      .replace(/\s*\(thực hiện tại [^)]+\)/gi, '')
      .replace(/\s*\(thực hiện tại [^)]+\)/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(s);
    if (unique.length >= limit) break;
  }
  return unique;
}

/** Điểm ngưỡng để coi là "khớp tốt". */
export const STRONG_SCORE = 90;

/**
 * Câu hỏi về THỜI GIAN — không phải tra cứu thủ tục.
 *
 * VÌ SAO CẦN: "mấy giờ rồi" / "hôm nay là thứ mấy" là câu hỏi ngoài lề
 * (yêu cầu #4) và phải do AI trả lời. Nếu đưa vào tìm kiếm thủ tục,
 * các từ rời ("giờ", "hôm") sẽ khớp lung tung với tên thủ tục dài ->
 * người dân nhận về danh sách thủ tục vô nghĩa.
 */
const TIME_QUESTION = /^(hôm nay|ngày mấy|thứ mấy|mấy giờ|giờ nào|bao giờ|mấy giờ rồi|hôm là thứ mấy|ngày gì|ngày hôm nay)\b/i;

/** Câu hỏi này có phải hỏi về thời gian không? */
export function isTimeQuestion(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  // Câu ngắn (<= 6 từ) và khớp mẫu thời gian -> hỏi ngoài lề.
  if (t.split(/\s+/).length > 6) return false;
  return TIME_QUESTION.test(t);
}

/**
 * Summary vô nghĩa cần loại bỏ.
 *
 * Gateway hay trả description rác như "Không.", "-", "N/A", "Thông tin
 * đang được cập nhật" -> in ra cho người dân là rất xấu.
 */
export function cleanSummary(summary) {
  const s = String(summary || '').trim();
  if (!s) return '';
  const junk = ['không', 'khong', 'n/a', 'na', '-', '--', 'null', 'undefined', 'chưa có', 'chua co'];
  if (junk.includes(s.toLowerCase().replace(/[.!?]+$/, '').trim())) return '';
  if (s.length < 12) return '';
  return s;
}
