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
  // -- Thủ tục import từ Cổng DVC --
  'dvc_id',
  'level',
  'category',
  'agency',
  'citizen_url',
  'summary',
  'source',
  'assigned',
  // Mã trường hợp hành chính — một procedure_id có thể có nhiều case_code.
  'case_code',
  // Bản bỏ dấu của `name` — app tự sinh, admin không cần nhập.
  'name_noaccent',
  // Bản bỏ dấu + khoảng trắng bao quanh (để so khớp cụm từ chính xác).
  'name_pad',
  'category_pad',
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
    } else if (f === 'assigned') {
      out[f] = v ? 1 : 0;
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
    dvc_id: row.dvc_id || '',
    case_code: row.case_code || '',
    level: row.level || '',
    category: row.category || '',
    agency: row.agency || '',
    citizen_url: row.citizen_url || '',
    summary: row.summary || '',
    source: row.source || 'manual',
    assigned: !!row.assigned,
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

/**
 * Lấy thủ tục theo bộ lọc (dùng cho admin lọc theo trạng thái gán).
 *
 * @param {object} db
 * @param {object} opts
 * @param {string} opts.q      - từ khoá tìm trong tên/mã/lĩnh vực
 * @param {string} opts.filter - 'all' | 'assigned' | 'unassigned'
 * @param {number} opts.limit
 * @param {number} opts.offset
 */
export async function queryProcedures(db, { q = '', filter = 'all', limit = 100, offset = 0 } = {}) {
  if (!db) return { rows: [], total: 0 };
  const where = [];
  const binds = [];

  if (filter === 'assigned') where.push('assigned = 1');
  else if (filter === 'unassigned') where.push('assigned = 0');

  const kw = String(q || '').trim();
  if (kw) {
    // LIKE với %kw% -> khớp cả có dấu lẫn không dấu? Không. Nên dùng
    // "LIKE ... COLLATE NOCASE" cho tiếng Việt có dấu, và thêm biến thể
    // không dấu để người dùng gõ "ho khau" vẫn ra "hộ khẩu".
    const like = `%${kw.replace(/[%_]/g, '')}%`;
    const likeNoAccent = `%${stripAccents(kw).replace(/[%_]/g, '')}%`;
    where.push(
      '(name LIKE ? COLLATE NOCASE OR code LIKE ? COLLATE NOCASE OR category LIKE ? COLLATE NOCASE' +
        ' OR officer LIKE ? COLLATE NOCASE OR name_noaccent LIKE ? COLLATE NOCASE)'
    );
    binds.push(like, like, like, like, likeNoAccent);
  }

  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const totalRes = await db
    .prepare(`SELECT COUNT(*) AS n FROM procedures ${clause}`)
    .bind(...binds)
    .first();
  const total = totalRes?.n ?? 0;

  const res = await db
    .prepare(
      `SELECT * FROM procedures ${clause}
       ORDER BY assigned ASC, sort_order ASC, id ASC
       LIMIT ? OFFSET ?`
    )
    .bind(...binds, Number(limit) || 100, Number(offset) || 0)
    .all();

  return { rows: (res?.results || []).map(rowToProcedure), total };
}

/**
 * Import hàng loạt thủ tục từ Cổng DVC vào D1.
 *
 * Dùng `INSERT ... ON CONFLICT(dvc_id) DO UPDATE` để:
 *   - chạy lại nhiều lần không tạo bản trùng,
 *   - cập nhật tên/mã/link mới nhất,
 *   - **KHÔNG** ghi đè các trường do admin nhập (officer, desk, phone...).
 *
 * VÌ SAO CẦN GIỮ NGUYÊN PHẦN ADMIN: admin đã gán chuyên viên cho thủ tục,
 * nếu import lại xoá mất thì công cốc mất thông tin liên hệ.
 */
export async function importProcedures(db, items) {
  if (!db || !items?.length) return { ok: true, imported: 0, skipped: 0 };

  const cols = [
    'name',
    'code',
    'dvc_id',
    'case_code',
    'level',
    'category',
    'agency',
    'citizen_url',
    'portal_url',
    'summary',
    'source',
    'name_noaccent',
    'name_pad',
    'category_pad',
  ];
  let imported = 0;
  let skipped = 0;

  // D1 giới hạn 100 biến bind cho MỘT câu lệnh.
  // 13 cột -> tối đa 7 dòng/câu (7*13 = 91 <= 100). Chunk 40 sẽ vượt
  // giới hạn và câu lệnh bị từ chối -> phải chia nhỏ.
  const CHUNK = 7;

  // Gom các câu lệnh rồi gửi MỘT lần bằng db.batch() -> nhanh hơn
  // nhiều so với gọi .run() tuần tự (mỗi lần là 1 round-trip).
  const statements = [];
  for (let i = 0; i < items.length; i += CHUNK) {
    const slice = items.slice(i, i + CHUNK);
    const values = [];
    // Mỗi dòng: 13 cột dữ liệu + active=1 + assigned=0 -> 15 giá trị.
    const rowPlaceholders = `(${cols.map(() => '?').join(', ')}, 1, 0)`;
    const placeholders = slice.map(() => rowPlaceholders).join(', ');
    for (const it of slice) {
      const nameNA = stripAccents(it.name || '').toLowerCase();
      const catNA = stripAccents(it.category || '').toLowerCase();
      values.push(
        it.name || '',
        it.code || null,
        it.dvc_id || null,
        it.case_code || '',
        it.level || null,
        it.category || null,
        it.agency || null,
        it.citizen_url || null,
        it.portal_url || null,
        it.summary || null,
        'dvc',
        nameNA,
        // Khoảng trắng bao quanh -> SQL LIKE '% cu phrase %' khớp đúng
        // CỤM TỪ thay vì substring ("dai" trong "đại lý").
        ` ${nameNA} `,
        ` ${catNA} `
      );
    }
    const sql =
      `INSERT INTO procedures (${cols.join(', ')}, active, assigned) ` +
      `VALUES ${placeholders} ` +
      `ON CONFLICT(dvc_id, case_code) DO UPDATE SET ` +
      `name=excluded.name, code=excluded.code, level=excluded.level, ` +
      `category=excluded.category, agency=excluded.agency, ` +
      `citizen_url=excluded.citizen_url, portal_url=excluded.portal_url, ` +
      `summary=COALESCE(procedures.summary, excluded.summary), ` +
      `name_noaccent=excluded.name_noaccent, ` +
      `name_pad=excluded.name_pad, category_pad=excluded.category_pad, ` +
      `updated_at=datetime('now')`;

    statements.push(db.prepare(sql).bind(...values));
  }

  try {
    if (statements.length) await db.batch(statements);
    imported = items.length;
  } catch (err) {
    // Batch thất bại -> thử lại từng câu để biết chính xác câu nào lỗi
    // và vẫn ghi được phần lớn dữ liệu.
    console.error('[import] batch failed, retry từng chunk:', String(err?.message || err));
    for (const st of statements) {
      try {
        await st.run();
        imported += 1;
      } catch (e2) {
        skipped += 1;
        console.error('[import] chunk failed:', String(e2?.message || e2));
      }
    }
  }

  if (skipped) {
    console.error(`[import] ${skipped}/${items.length} bản ghi bị bỏ qua do lỗi SQL`);
  }
  return { ok: true, imported, skipped };
}

/**
 * Gán chuyên viên phụ trách cho nhiều thủ tục cùng lúc.
 *
 * @param {object} db
 * @param {number[]} ids   - danh sách id thủ tục
 * @param {object} data    - { officer, desk, phone, office_hours }
 */
export async function assignOfficer(db, ids, data = {}) {
  if (!db || !ids?.length) return { ok: false, error: 'Không có thủ tục nào được chọn' };

  const sets = [];
  const binds = [];
  for (const f of ['officer', 'desk', 'phone', 'office_hours']) {
    if (!(f in data)) continue;
    const v = data[f];
    sets.push(`${f} = ?`);
    binds.push(v === null || v === undefined || v === '' ? null : String(v).trim());
  }
  if (!sets.length) return { ok: false, error: 'Không có thông tin để gán' };

  // `assigned` = 1 khi đã có ít nhất đồng chí phụ trách.
  sets.push('assigned = CASE WHEN ? IS NOT NULL AND ? != \'\' THEN 1 ELSE assigned END');
  binds.push(data.officer ?? null, data.officer ?? null);

  const placeholders = ids.map(() => '?').join(', ');
  try {
    await db
      .prepare(
        `UPDATE procedures SET ${sets.join(', ')}, updated_at = datetime('now')
         WHERE id IN (${placeholders})`
      )
      .bind(...binds, ...ids.map(Number))
      .run();
    return { ok: true, count: ids.length };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

/**
 * Gán chuyên viên cho HÀNG LOẠT theo bộ lọc (lĩnh vực / mức độ / từ khoá).
 *
 * VÌ SAO CẦN: xã có 3.544 thủ tục — không thể tick từng dòng trong
 * trang quản trị. Trước đây chỉ gán được theo id đã chọn. Nay cho
 * phép chọn "gán cho toàn bộ lĩnh vực Hộ tịch" -> gán 1 lần.
 *
 * @param {object} db
 * @param {object} filter - { category, level, keyword, onlyUnassigned }
 * @param {object} data   - { officer, desk, phone, office_hours }
 */
export async function assignOfficerByFilter(db, filter = {}, data = {}) {
  if (!db) return { ok: false, error: 'Không có DB' };

  const where = ['active = 1'];
  const binds = [];
  const f = filter || {};
  if (f.category) {
    where.push('category = ?');
    binds.push(String(f.category));
  }
  if (f.level) {
    where.push('level = ?');
    binds.push(String(f.level));
  }
  if (f.onlyUnassigned) where.push("(officer IS NULL OR officer = '')");
  if (f.keyword) {
    const k = String(f.keyword).trim();
    where.push('(name_pad LIKE ? OR category_pad LIKE ? OR code LIKE ?)');
    const like = `%${k.toLowerCase()}%`;
    binds.push(like, like, `%${k}%`);
  }
  // Không có điều kiện nào -> chặn để tránh gán nhầm toàn bộ 3.544 thủ tục.
  if (where.length === 1) {
    return { ok: false, error: 'Chọn ít nhất một tiêu chí lọc (lĩnh vực, mức độ hoặc từ khóa)' };
  }

  const sets = [];
  const setBinds = [];
  for (const field of ['officer', 'desk', 'phone', 'office_hours']) {
    if (!(field in data)) continue;
    sets.push(`${field} = ?`);
    setBinds.push(data[field] === null || data[field] === undefined || data[field] === '' ? null : String(data[field]).trim());
  }
  if (!sets.length) return { ok: false, error: 'Không có thông tin để gán' };
  sets.push("assigned = CASE WHEN ? IS NOT NULL AND ? != '' THEN 1 ELSE assigned END");
  setBinds.push(data.officer ?? null, data.officer ?? null);

  try {
    const r = await db
      .prepare(
        `UPDATE procedures SET ${sets.join(', ')}, updated_at = datetime('now')
         WHERE ${where.join(' AND ')}`
      )
      .bind(...setBinds, ...binds)
      .run();
    return { ok: true, count: r?.meta?.changes ?? 0, stats: await procedureStats(db) };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

/**
 * Liệt kê các lĩnh vực có trong DB (kèm số thủ tục) để admin chọn
 * khi gán hàng loạt.
 */
export async function listCategories(db) {
  if (!db) return [];
  try {
    const res = await db
      .prepare(
        `SELECT category AS name, COUNT(*) AS count,
                SUM(CASE WHEN level = 'FULL' THEN 1 ELSE 0 END) AS full_count
         FROM procedures
         WHERE active = 1 AND category IS NOT NULL AND category <> ''
         GROUP BY category
         ORDER BY count DESC`
      )
      .all();
    return res?.results || [];
  } catch (_) {
    return [];
  }
}

/** Thống kê nhanh số thủ tục đã gán / chưa gán. */
export async function procedureStats(db) {
  if (!db) return { total: 0, assigned: 0, unassigned: 0 };
  const res = await db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN assigned = 1 THEN 1 ELSE 0 END) AS assigned
       FROM procedures`
    )
    .first();
  const total = res?.total ?? 0;
  const assigned = res?.assigned ?? 0;
  return { total, assigned, unassigned: total - assigned };
}

/** Lấy một thủ tục theo id. */
export async function getProcedureById(db, id) {
  if (!db) return null;
  const res = await db.prepare('SELECT * FROM procedures WHERE id = ? LIMIT 1').bind(Number(id)).first();
  return rowToProcedure(res);
}

/**
 * Lấy thủ tục theo MÃ thủ tục (vd "1.000894").
 *
 * VÌ SAO CẦN: khi người dân gõ mã, Cổng DVC Quốc gia trả về hồ sơ +
 * trình tự nhưng KHÔNG có thông tin nội bộ của xã (đồng chí phụ trách,
 * bàn số, số điện thoại). Tra D1 trước để gắn thêm thông tin này.
 */
export async function getProcedureByCode(db, code) {
  if (!db || !code) return null;
  const c = String(code).trim();
  try {
    const res = await db
      .prepare(
        `SELECT * FROM procedures
         WHERE code = ? OR code LIKE ?
         ORDER BY CASE WHEN code = ? THEN 0 ELSE 1 END, level = 'FULL' DESC
         LIMIT 1`
      )
      .bind(c, `${c}%`, c)
      .first();
    return rowToProcedure(res);
  } catch (_) {
    return null;
  }
}

/** Thêm thủ tục mới. */
export async function insertProcedure(db, input) {
  const { data, error } = sanitizeProcedure(input);
  if (error) return { ok: false, error };

  // Tự động ghi bản bỏ dấu để tìm kiếm không dấu hoạt động.
  if ('name' in data && data.name) {
    const na = stripAccents(data.name).toLowerCase();
    data.name_noaccent = na;
    data.name_pad = ` ${na} `;
  }
  if ('category' in data && data.category) {
    data.category_pad = ` ${stripAccents(data.category).toLowerCase()} `;
  }

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

  // Đồng bộ bản bỏ dấu khi tên thay đổi.
  if ('name' in data && data.name) {
    const na = stripAccents(data.name).toLowerCase();
    data.name_noaccent = na;
    data.name_pad = ` ${na} `;
  }
  if ('category' in data && data.category) {
    data.category_pad = ` ${stripAccents(data.category).toLowerCase()} `;
  }

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
 * Bỏ dấu tiếng Việt, giữ nguyên chữ hoa/thường và khoảng trắng.
 *
 * Dùng cho cột `name_noaccent` để tìm kiếm "ho khau" ra "Hộ khẩu".
 * `đ`/`Đ` không có dạng phân rã chuẩn trong Unicode nên phải thay thế tay.
 */
export function stripAccents(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
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
 * Từ dừng tiếng Việt — loại khỏi câu hỏi trước khi so khớp.
 *
 * VÌ SAO CẦN: câu hỏi thật của người dân có nhiều từ chung
 * ("cần hồ sơ gì để...", "thủ tục nào...", "làm thế nào"). Nếu giữ
 * chúng, Dice coefficient bị kéo xuống và tên thủ tục khớp thật
 * bị xếp sau những tên "chung chung".
 *
 * CHỈ loại từ chung. Giữ lại các từ mang nghĩa hành chính
 * ("cấp", "đăng ký", "khai", "giấy", "hộ khẩu"...).
 */
const STOPWORDS = new Set([
  'anh', 'chi', 'em', 'ban', 'toi', 'minh', 'nha', 'xin', 'hoi', 'giup',
  'thu', 'tuc', 'ho', 'so', 'giay', 'giay', 'to', 'nao', 'gi', 'de', 'cho',
  'can', 'muon', 'lam', 'the', 'nao', 'ra', 'sao', 'bao', 'nhieu', 'co',
  'khong', 'voi', 'cua', 'tai', 'o', 'la', 'thi', 'ma', 'nhu', 'nen', 've',
  'nhung', 'cac', 'mot', 'duoc', 'vao', 'nha', 'nay', 'do', 'ba', 'ngoai',
  'tuc', 'nao', 'vay', 'thi', 'ai', 'gi', 'bay', 'gio', 'nua', 'khi', 'neu',
  'hay', 'va', 'hoac', 'thi', 'nen', 'da', 'dang', 'se', 'rat', 'qua',
]);

/**
 * Tìm thủ tục của xã theo từ khoá.
 *
 * Dùng để bot trả lời câu hỏi của người dân về thủ tục RIÊNG của xã
 * (ví dụ "thủ tục ABC do đồng chí ... bàn số ... số điện thoại ...").
 *
 * VÌ SAO KHÔNG LOAD TOÀN BẢNG: bảng có ~3.500 thủ tục sau khi import từ
 * Cổng DVC. `SELECT *` mỗi lượt sẽ tốn băng thông và chậm. Thay vào đó
 * dùng SQL lọc trước (LIKE trên name/code/keywords/name_noaccent), rồi
 * mới tính điểm Dice trên tập ứng viên nhỏ.
 *
 * TRẢ VỀ: mảng { procedure, score, dice, exact } — sắp xếp giảm dần.
 */
export async function searchLocalProcedures(db, query, { limit = 5 } = {}) {
  if (!db) return [];
  const q = String(query || '').trim();
  if (!q) return [];

  const nq = norm(q);
  const qWords = nq.split(' ').filter((w) => w.length >= 2 && !STOPWORDS.has(w));

  // 1) Lọc rộng bằng SQL để lấy tập ứng viên nhỏ.
  //    Điều kiện: mọi từ khoá trong câu hỏi phải xuất hiện ở ít nhất
  //    một trong các trường (tên, mã, từ khoá do admin khai báo).
  const binds = [];
  const clauses = [];
  for (const w of qWords.slice(0, 8)) {
    const like = `%${w}%`;
    const likeNa = `%${stripAccents(w).toLowerCase()}%`;
    clauses.push(
      '(name LIKE ? COLLATE NOCASE OR code LIKE ? COLLATE NOCASE' +
        ' OR keywords LIKE ? COLLATE NOCASE OR name_noaccent LIKE ? COLLATE NOCASE)'
    );
    binds.push(like, like, like, likeNa);
  }
  // Câu hỏi ngắn (< 2 từ) -> lấy theo từ khoá admin khai báo.
  if (!clauses.length) {
    clauses.push('(keywords LIKE ? COLLATE NOCASE OR name_noaccent LIKE ? COLLATE NOCASE)');
    binds.push(`%${nq}%`, `%${stripAccents(q).toLowerCase()}%`);
  }

  let candidates;
  try {
    const res = await db
      .prepare(
        `SELECT * FROM procedures
         WHERE active = 1 AND (${clauses.join(' AND ')})
         LIMIT 200`
      )
      .bind(...binds)
      .all();
    candidates = res?.results || [];
  } catch (_) {
    // D1 lỗi (vd thiếu cột name_noaccent) -> fallback về tải toàn bảng.
    const all = await listProcedures(db, { onlyActive: true });
    candidates = all;
  }

  const scored = [];
  for (const row of candidates) {
    const p = rowToProcedure(row);
    if (!p) continue;
    const nameN = norm(p.name);
    const codeN = norm(p.code);
    const kwN = norm(p.keywords);
    const hay = norm([p.name, p.code, p.keywords].filter(Boolean).join(' '));
    if (!hay) continue;

    const matched = qWords.filter((w) => hay.includes(w)).length;
    if (matched === 0 && !hay.includes(nq)) continue;

    const nameWords = nameN.split(' ').filter((w) => w.length >= 2 && !STOPWORDS.has(w));
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
      // 2b. Cụm từ khoá của admin xuất hiện trong câu hỏi (đảo chiều).
      //     Ví dụ admin khai "cấp hộ khẩu, xác nhận hộ khẩu"; người dân
      //     hỏi "thủ tục cấp hộ khẩu cần hồ sơ gì" -> khớp.
      for (const k of kwList) {
        const kn = norm(k);
        if (kn.length >= 4 && nq.includes(kn)) {
          score += 90;
          exact = true;
          break;
        }
      }
    }

    // 3. Tên thủ tục chứa trọn câu hỏi.
    if (nameN && nameN.includes(nq)) score += 60;

    // 3b. MỌI từ khoá trong tên thủ tục đều xuất hiện ở câu hỏi.
    //     Đây là trường hợp người dân hỏi "cấp hộ khẩu" cho thủ tục
    //     tên "Cấp giấy xác nhận tình trạng hộ khẩu" -> Dice thấp vì
    //     câu hỏi ngắn hơn nhiều, nhưng vẫn là đúng thủ tục.
    if (nameWords.length && qWords.length) {
      const allIn = nameWords.every((w) => qWords.includes(w));
      const coverage = qWords.filter((w) => nameWords.includes(w)).length / qWords.length;
      if (allIn && nameWords.length >= 2) {
        score += 70;
        exact = true;
      } else if (coverage >= 0.6) {
        score += 40;
      }
    }

    // 4. Độ tương đồng từ (Dice) — thang điểm chính.
    score += Math.round(dice * 60);

    // 5. Đã gán chuyên viên -> ưu tiên (đây là câu trả lời hữu ích nhất).
    if (p.assigned) score += 25;

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
  if (p.summary && p.summary !== p.description) lines.push(`Tóm tắt: ${p.summary}`);
  if (p.category) lines.push(`Lĩnh vực: ${p.category}`);
  if (p.agency) lines.push(`Cơ quan ban hành: ${p.agency}`);
  if (p.level) lines.push(`Mức độ áp dụng tại xã: ${p.level}`);
  if (p.officer) lines.push(`Đồng chí phụ trách: ${normalizeOfficer(p.officer)}`);
  if (p.desk) lines.push(`Bàn số: ${normalizeDesk(p.desk)}`);
  if (p.phone) lines.push(`Số điện thoại: ${p.phone}`);
  if (p.office_hours) lines.push(`Giờ làm việc: ${p.office_hours}`);
  if (p.keywords) lines.push(`Từ khóa: ${p.keywords}`);
  if (p.citizen_url) lines.push(`Nộp trực tuyến tại địa bàn: ${p.citizen_url}`);
  if (p.docs_url) lines.push(`Tài liệu/hướng dẫn: ${p.docs_url}`);
  if (p.portal_url) lines.push(`Trên Cổng DVC Quốc gia: ${p.portal_url}`);
  return lines.join('\n');
}

/**
 * Chuẩn hoá tên đồng chí: bỏ tiền tố "Đồng chí"/"đồng chí" vì câu trả lời
 * đã tự thêm "đồng chí" -> tránh lặp "đồng chí Đồng chí Nguyễn Văn An".
 *
 * KHÔNG bỏ "Chị"/"Anh" vì đó là cách xưng hô chứ không phải tiền tố thừa:
 * tên lưu trong DB là "Chị B" -> bỏ đi sẽ thành "B" (mất tên).
 */
export function normalizeOfficer(officer) {
  return String(officer || '')
    .replace(/^\s*(đồng\s*chí|anh\s*chí)\s+/i, '')
    .trim();
}

/**
 * Cụm gọi đồng chí phụ trách, dùng trong câu "Anh/chị hãy đến gặp ...".
 * - "Đồng chí Nguyễn Văn An" -> "đồng chí Nguyễn Văn An"
 * - "Chị B"                  -> "chị B"          (không thêm "đồng chí")
 * - "Nguyễn Văn An"          -> "đồng chí Nguyễn Văn An"
 */
export function officerPhrase(officer) {
  const name = normalizeOfficer(officer);
  if (!name) return '';
  const m = name.match(/^(chị|anh)\s+/i);
  if (m) {
    // Hạ chữ cái đầu của cách xưng hô cho vừa câu: "chị B".
    return name.replace(/^(chị|anh)/i, (w) => w.toLowerCase());
  }
  return `đồng chí ${name}`;
}

/**
 * Chuẩn hoá tên bàn: "Bàn số 3" -> "3", "bàn 3" -> "3".
 * Tránh hiển thị kiểu "Bàn số: Bàn số 3".
 */
export function normalizeDesk(desk) {
  const d = String(desk || '').trim();
  if (!d) return '';
  // Bỏ dấu để bắt được cả "Bàn số 3", "bàn so 3", "ban 3".
  const flat = d
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .toLowerCase();
  const m = flat.match(/^ban\s*(?:so\s*)?(\d+)/);
  if (m) return m[1];
  return d;
}

/**
 * Định dạng thủ tục của xã cho người dùng đọc (bản tất định, không AI).
 * Cũng bỏ qua mọi trường rỗng.
 */
export function localProcedureToReply(p, opts = {}) {
  if (!p) return '';
  const office = opts.officeName || '';
  const lines = [];
  lines.push(`*${p.name || 'Thủ tục'}*`);
  if (p.code) lines.push(`Mã: ${p.code}`);
  if (p.description) {
    lines.push('');
    lines.push(p.description);
  }

  // Tóm tắt từ Cổng DVC (khi thủ tục được import từ đó).
  if (p.summary && p.summary !== p.description) {
    lines.push('');
    lines.push(p.summary);
  }

  const info = [];
  if (p.officer) info.push(`Đồng chí phụ trách: ${normalizeOfficer(p.officer)}`);
  if (p.desk) info.push(`Bàn số: ${normalizeDesk(p.desk)}`);
  if (p.phone) info.push(`Số điện thoại: ${p.phone}`);
  if (p.office_hours) info.push(`Giờ làm việc: ${p.office_hours}`);
  if (info.length) {
    lines.push('');
    for (const i of info) lines.push(`• ${i}`);
  }

  // Câu mời đến gặp — đúng như yêu cầu người dân:
  //   "Anh/chị hãy đến gặp đồng chí [Tên] tại bàn [Số bàn],
  //    số điện thoại [SĐT] tại Trung tâm Phục vụ hành chính công xã Xuân Lãng"
  if (p.officer && office) {
    const bits = [];
    if (p.desk) bits.push(`tại bàn số ${normalizeDesk(p.desk)}`);
    if (p.phone) bits.push(`số điện thoại ${p.phone}`);
    lines.push('');
    lines.push(
      `Anh/chị hãy đến gặp ${officerPhrase(p.officer)}` +
        (bits.length ? ` ${bits.join(', ')}` : '') +
        ` tại ${office}.`
    );
  }

  const links = [];
  if (p.citizen_url) links.push(`📝 Nộp trực tuyến: ${p.citizen_url}`);
  if (p.docs_url) links.push(`📄 Hướng dẫn: ${p.docs_url}`);
  if (p.portal_url) links.push(`🔗 Cổng DVC Quốc gia: ${p.portal_url}`);
  if (links.length) {
    lines.push('');
    for (const l of links) lines.push(l);
  }
  return lines.join('\n');
}
