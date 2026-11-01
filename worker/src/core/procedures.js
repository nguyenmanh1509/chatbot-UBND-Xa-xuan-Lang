/**
 * Thủ tục riêng do UBND xã Xuân Lãng tự khai báo (lưu trong D1).
 *
 * Mỗi thủ tục có các trường TUỲ CHỌN:
 *   officer (đồng chí phụ trách), desk (bàn số), phone (số điện thoại),
 *   office_hours (giờ làm việc), description, docs_url, portal_url...
 *
 * QUY TẮC HIỂN THỊ:
 *   Trường rỗng / NULL -> KHÔNG in ra dòng đó. Không bao giờ in
 *   "Đồng chí phụ trách: không có" hay để dấu chấm trống.
 */

/** Các trường được phép ghi (dùng để lọc input, chống SQL injection). */
export const PROCEDURE_FIELDS = [
  'name',
  'code',
  'officer',
  'desk',
  'phone',
  'office_hours',
  'keywords',
  'description',
  'docs_url',
  'portal_url',
  'sort_order',
  'active',
];

/** Trường bắt buộc phải có. */
const REQUIRED_FIELDS = ['name'];

/**
 * Chuẩn hóa dữ liệu đầu vào từ admin panel.
 * - Bỏ khoảng trắng thừa
 * - Chuỗi rỗng -> null (để D1 lưu NULL = không có giá trị)
 * - Chỉ giữ các trường hợp lệ
 *
 * @param {object} input
 * @param {object} opts
 * @param {boolean} opts.partial - true cho UPDATE (cho phép bỏ qua trường
 *   bắt buộc vì tên đã có sẵn trong DB); false cho INSERT.
 */
export function sanitizeProcedure(input = {}, { partial = false } = {}) {
  const out = {};
  for (const f of PROCEDURE_FIELDS) {
    if (!(f in input)) continue;
    const v = input[f];
    if (v === undefined || v === null) {
      out[f] = null;
    } else if (f === 'active' || f === 'sort_order') {
      out[f] = f === 'sort_order' ? Number(v) || 0 : v ? 1 : 0;
    } else {
      const s = String(v).trim();
      out[f] = s === '' ? null : s;
    }
  }
  if (!partial) {
    for (const f of REQUIRED_FIELDS) {
      if (!out[f]) return { error: `Thiếu trường bắt buộc: ${f}` };
    }
  }
  return { data: out };
}

/** Chuyển row của D1 -> object thuần (tên field camelCase). */
export function rowToProcedure(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name || '',
    code: row.code || '',
    officer: row.officer || '',
    desk: row.desk || '',
    phone: row.phone || '',
    office_hours: row.office_hours || '',
    keywords: row.keywords || '',
    description: row.description || '',
    docs_url: row.docs_url || '',
    portal_url: row.portal_url || '',
    sort_order: row.sort_order ?? 0,
    active: !!row.active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Lấy danh sách thủ tục của xã. */
export async function listProcedures(db, { onlyActive = false } = {}) {
  if (!db) return [];
  const sql = onlyActive
    ? 'SELECT * FROM procedures WHERE active = 1 ORDER BY sort_order ASC, id ASC'
    : 'SELECT * FROM procedures ORDER BY sort_order ASC, id ASC';
  const res = await db.prepare(sql).all();
  return (res?.results || []).map(rowToProcedure);
}

/** Lấy một thủ tục theo id. */
export async function getProcedureById(db, id) {
  if (!db) return null;
  const res = await db.prepare('SELECT * FROM procedures WHERE id = ? LIMIT 1').bind(Number(id)).first();
  return rowToProcedure(res);
}

/** Thêm thủ tục mới. */
export async function insertProcedure(db, input) {
  const { data, error } = sanitizeProcedure(input);
  if (error) return { ok: false, error };

  const cols = PROCEDURE_FIELDS.filter((f) => f in data);
  const vals = cols.map((f) => data[f]);
  try {
    const res = await db
      .prepare(
        `INSERT INTO procedures (${cols.join(', ')})
         VALUES (${cols.map(() => '?').join(', ')})`
      )
      .bind(...vals)
      .run();
    return { ok: true, id: res?.meta?.last_row_id };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

/** Cập nhật thủ tục. */
export async function updateProcedure(db, id, input) {
  // partial = true: chỉ cập nhật trường được gửi lên, không đòi tên.
  const { data, error } = sanitizeProcedure(input, { partial: true });
  if (error) return { ok: false, error };

  const cols = PROCEDURE_FIELDS.filter((f) => f in data);
  if (!cols.length) return { ok: false, error: 'Không có gì để cập nhật' };

  // Không cho đặt tên rỗng (trường bắt buộc) — nếu gửi name='' thì báo lỗi
  // thay vì để thủ tục mất tên.
  if ('name' in data && !data.name) {
    return { ok: false, error: 'Tên thủ tục không được để trống' };
  }

  try {
    await db
      .prepare(
        `UPDATE procedures SET ${cols.map((c) => `${c} = ?`).join(', ')},
         updated_at = datetime('now')
         WHERE id = ?`
      )
      .bind(...cols.map((c) => data[c]), Number(id))
      .run();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

/** Xoá thủ tục. */
export async function deleteProcedure(db, id) {
  try {
    await db.prepare('DELETE FROM procedures WHERE id = ?').bind(Number(id)).run();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

/** Bỏ dấu tiếng Việt + chuẩn hóa để so khớp. */
function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Dice coefficient giữa 2 chuỗi từ (theo tập từ).
 *  = 2|A∩B| / (|A|+|B|)   -> 0..1
 *
 * VÌ SAO DÙNG Dice thay vì "bao nhiêu % từ trong câu hỏi khớp":
 * Câu hỏi "hộ khẩu" khớp 100% từ của thủ tục "Cấp giấy xác nhận tình
 * trạng hộ khẩu" nhưng thực ra người dân đang hỏi về MỌI thủ tục hộ
 * khẩu trên Cổng DVC, không phải riêng thủ tục của xã. Dice đo được
 * cả chiều ngược nên phân biệt được 2 trường hợp này.
 */
function diceCoefficient(aWords, bWords) {
  if (!aWords.length || !bWords.length) return 0;
  const setA = new Set(aWords);
  const setB = new Set(bWords);
  let inter = 0;
  for (const w of setA) if (setB.has(w)) inter++;
  return (2 * inter) / (setA.size + setB.size);
}

/**
 * Tìm thủ tục của xã theo từ khoá.
 *
 * Dùng để bot trả lời câu hỏi của người dân về thủ tục RIÊNG của xã
 * (ví dụ "thủ tục ABC do đồng chí ... bàn số ... số điện thoại ...").
 *
 * TRẢ VỀ: mảng { procedure, score, dice, exact } — sắp xếp giảm dần.
 */
export async function searchLocalProcedures(db, query, { limit = 5 } = {}) {
  if (!db) return [];
  const q = String(query || '').trim();
  if (!q) return [];

  const all = await listProcedures(db, { onlyActive: true });
  const nq = norm(q);
  const qWords = nq.split(' ').filter((w) => w.length >= 2);

  const scored = [];
  for (const p of all) {
    const nameN = norm(p.name);
    const codeN = norm(p.code);
    const kwN = norm(p.keywords);
    const hay = norm([p.name, p.code, p.keywords].filter(Boolean).join(' '));
    if (!hay) continue;

    const matched = qWords.filter((w) => hay.includes(w)).length;
    if (matched === 0 && !hay.includes(nq)) continue;

    const nameWords = nameN.split(' ').filter((w) => w.length >= 2);
    const dice = diceCoefficient(qWords, nameWords);

    let score = 0;
    let exact = false;

    // 1. Trùng chính xác tên hoặc mã -> chắc chắn là thủ tục này.
    if (nameN === nq || (codeN && codeN === nq)) {
      score += 200;
      exact = true;
    }

    // 2. Trùng chính xác một từ khoá do admin khai báo -> admin đã nói
    //    rõ "khi người dân hỏi cụm này thì trả thủ tục này".
    if (kwN) {
      const kwList = kwN.split(',').map((s) => s.trim()).filter(Boolean);
      if (kwList.some((k) => k === nq)) {
        score += 120;
        exact = true;
      }
    }

    // 3. Tên thủ tục chứa trọn câu hỏi.
    if (nameN && nameN.includes(nq)) score += 60;

    // 4. Độ tương đồng từ (Dice) — thang điểm chính.
    score += Math.round(dice * 60);

    scored.push({ procedure: p, score, dice, exact });
  }

  scored.sort((a, b) => b.score - a.score || a.procedure.sort_order - b.procedure.sort_order);
  return scored.slice(0, limit);
}

/**
 * Định dạng thủ tục của xã thành text cho AI.
 * BỎ QUA các trường rỗng — chỉ in dòng có nội dung thật.
 */
export function localProcedureToText(p) {
  if (!p) return '';
  const lines = [];
  lines.push(`Tên: ${p.name || ''}`);
  if (p.code) lines.push(`Mã thủ tục: ${p.code}`);
  if (p.description) lines.push(`Mô tả: ${p.description}`);
  if (p.officer) lines.push(`Đồng chí phụ trách: ${p.officer}`);
  if (p.desk) lines.push(`Bàn số: ${p.desk}`);
  if (p.phone) lines.push(`Số điện thoại: ${p.phone}`);
  if (p.office_hours) lines.push(`Giờ làm việc: ${p.office_hours}`);
  if (p.keywords) lines.push(`Từ khóa: ${p.keywords}`);
  if (p.docs_url) lines.push(`Tài liệu/hướng dẫn: ${p.docs_url}`);
  if (p.portal_url) lines.push(`Trên Cổng DVC Quốc gia: ${p.portal_url}`);
  return lines.join('\n');
}

/**
 * Định dạng thủ tục của xã cho người dùng đọc (bản tất định, không AI).
 * Cũng bỏ qua mọi trường rỗng.
 */
export function localProcedureToReply(p) {
  if (!p) return '';
  const lines = [];
  lines.push(`*${p.name || 'Thủ tục'}*`);
  if (p.code) lines.push(`Mã: ${p.code}`);
  if (p.description) {
    lines.push('');
    lines.push(p.description);
  }
  const info = [];
  if (p.officer) info.push(`Đồng chí phụ trách: ${p.officer}`);
  if (p.desk) info.push(`Bàn số: ${p.desk}`);
  if (p.phone) info.push(`Số điện thoại: ${p.phone}`);
  if (p.office_hours) info.push(`Giờ làm việc: ${p.office_hours}`);
  if (info.length) {
    lines.push('');
    for (const i of info) lines.push(`• ${i}`);
  }
  const links = [];
  if (p.docs_url) links.push(`📄 Hướng dẫn: ${p.docs_url}`);
  if (p.portal_url) links.push(`🔗 Cổng DVC Quốc gia: ${p.portal_url}`);
  if (links.length) {
    lines.push('');
    for (const l of links) lines.push(l);
  }
  return lines.join('\n');
}
