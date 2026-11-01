/**
 * Import thủ tục áp dụng tại xã từ Cổng DVC Quốc gia vào D1.
 *
 * YÊU CẦU NGƯỜI DÙNG: "vào mục thủ tục hành chính của xã Xuân Lãng,
 * lấy all thủ tục của xã, sau đó gán thủ tục cho các chuyên viên phù hợp".
 *
 * DỮ LIỆU ĐẾN TỪ ĐÂU: gateway `dichvucong.cloudgo.vn` -> endpoint
 *   GET /api/wards/{wardCode}?page=N&size=100
 * trả về danh sách thủ tục áp dụng tại xã (mỗi thủ tục có `level`:
 * FULL = xã làm toàn bộ, PARTIAL = xã làm một phần, ALL = có liên quan).
 *
 * VÌ SAO KHÔNG GỌI TRỰC TIẾP dichvucong.gov.vn: trang đó có WAF chặn
 * request không giống trình duyệt, và không có endpoint lọc theo xã.
 * Gateway đã làm sẵn phần đó và trả kèm `portal_url` (link thủ tục
 * trên dichvucong.gov.vn) -> đáp ứng yêu cầu "có luôn link thủ tục".
 */

/** Số trang lấy mỗi lần gọi gateway (gateway chặn size > 100). */
const PAGE_SIZE = 100;

/** Số trang tối đa trong một lần import (giới hạn thời gian Worker). */
const MAX_PAGES_PER_RUN = 40;

/**
 * Tóm tắt ngắn gọn một thủ tục từ dữ liệu gateway.
 *
 * Mục đích: câu trả lời cho người dân phải ngắn gọn, đúng nguyên tắc
 * "nói đủ ý nhưng không dồn chữ". Lấy phần mô tả đầu tiên (nếu có) và
 * cắt bớt, bỏ qua ký tự thừa do API sinh ra.
 */
export function summariseProcedure(item) {
  const desc = String(item?.description || '').trim();
  if (!desc) return '';
  // API hay trả về mô tả dài kèm ký tự định dạng ("\t", "+", "-").
  const cleaned = desc
    .replace(/[\t\r]+/g, ' ')
    .replace(/^\s*[+*-]\s*/gm, '')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (cleaned.length <= 220) return cleaned;
  const cut = cleaned.slice(0, 220);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 120 ? cut.slice(0, lastSpace) : cut) + '…';
}

/**
 * Lấy một trang thủ tục của xã từ gateway.
 *
 * @param {DvcClient} dvc
 * @param {string} wardCode  - ví dụ 'H44.195'
 * @param {number} page      - bắt đầu từ 1
 */
export async function fetchWardPage(dvc, wardCode, page = 1) {
  const d = await dvc.request(`/wards/${encodeURIComponent(wardCode)}`, {
    page,
    size: PAGE_SIZE,
  });
  const p = d?.procedures || { total: 0, items: [] };
  return { total: p.total ?? 0, page: p.page ?? page, items: p.items || [] };
}

/**
 * Import thủ tục của xã vào D1.
 *
 * @param {object} opts
 * @param {DvcClient} opts.dvc
 * @param {object} opts.db      - D1 binding
 * @param {string} opts.wardCode
 * @param {number} opts.startPage - trang bắt đầu (cho phép import tiếp)
 * @param {number} opts.maxPages
 * @param {Function} opts.importFn - hàm importProcedures từ procedures.js
 * @returns {Promise<{ok, imported, pages, nextPage, done, total}>}
 */
export async function importWardProcedures({
  dvc,
  db,
  wardCode,
  startPage = 1,
  maxPages = MAX_PAGES_PER_RUN,
  importFn,
}) {
  if (!dvc || !db || !importFn) {
    return { ok: false, error: 'Thiếu tham số dvc/db/importFn' };
  }

  let page = Math.max(1, Number(startPage) || 1);
  let total = 0;
  let imported = 0;
  let pages = 0;

  while (pages < maxPages) {
    let res;
    try {
      res = await fetchWardPage(dvc, wardCode, page);
    } catch (err) {
      return {
        ok: false,
        error: `Không tải được trang ${page}: ${String(err?.message || err)}`,
        imported,
        pages,
        nextPage: page,
        total,
      };
    }

    const items = res.items || [];
    total = res.total || total;
    if (!items.length) {
      return { ok: true, imported, pages, nextPage: null, done: true, total };
    }

    const payload = items.map((it) => ({
      name: it.name || '',
      code: it.code || '',
      dvc_id: it.procedure_id || '',
      // Mã trường hợp hành chính — một procedure_id có thể có nhiều case.
      // Bỏ trống khi gateway không trả về.
      case_code: it.case_code || '',
      level: it.level || '',
      category: it.category_name || '',
      agency: it.issuing_agency || '',
      citizen_url: it.citizen_url || '',
      portal_url: it.portal_url || '',
      summary: summariseProcedure(it),
    }));

    const r = await importFn(db, payload);
    imported += r.imported || 0;

    pages += 1;
    const done = items.length < PAGE_SIZE || page * PAGE_SIZE >= total;
    if (done) {
      return { ok: true, imported, pages, nextPage: null, done: true, total };
    }
    page += 1;
  }

  return {
    ok: true,
    imported,
    pages,
    nextPage: page,
    done: false,
    total,
  };
}
