/**
 * Truy xuất ngữ cảnh từ DVC + định dạng câu trả lời dạng text cho kênh chat.
 * Kết quả trả về luôn có `sources` để AI dẫn nguồn và để admin hiển thị.
 */

import { stripVN, extractLocationAndKeyword, keywordFallbacks } from './nlu.js';

const MAX_TEXT = 2000; // giới hạn ký tự mỗi tin (Zalo sendMessage & Messenger đều 2000)

/** Rút gọn chuỗi về tối đa n ký tự, cắt tại ranh giới từ. */
export function truncate(s, n = MAX_TEXT) {
  const str = String(s || '');
  if (str.length <= n) return str;
  const cut = str.slice(0, n - 3);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > n * 0.6 ? cut.slice(0, lastSpace) : cut) + '...';
}

/** Chia câu trả lời dài thành nhiều tin nhỏ, không ngắt quá giữa từ. */
export function splitForChat(text, limit = MAX_TEXT) {
  const str = String(text || '').trim();
  if (!str) return [];
  if (str.length <= limit) return [str];

  const chunks = [];
  let rest = str;
  while (rest.length > limit) {
    // Cắt tại ranh giới dòng, rồi tới ranh giới từ
    let cut = rest.lastIndexOf('\n', limit);
    if (cut < limit * 0.5) cut = rest.lastIndexOf(' ', limit);
    if (cut < limit * 0.3) cut = limit;
    chunks.push(rest.slice(0, cut).trim());
    // Giữ lại khoảng trắng bị cắt để nối lại khớp nguyên văn
    rest = rest.slice(cut).replace(/^\s+/, '');
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/** Tìm phường/xã khớp tên trong câu hỏi. Ưu tiên kết quả khớp chính xác nhất. */
export async function resolveWard(dvc, parts) {
  const wards = [];
  for (const name of parts) {
    try {
      const items = await dvc.searchWards(name, { limit: 10 });
      const n = stripVN(name);
      // Khớp chính xác tên trước, sau đó mới tới khớp chứa
      const exact = items.filter((it) => stripVN(it.ward_name || it.name || '') === n);
      const partial = items.filter(
        (it) => stripVN(it.ward_name || it.name || '').includes(n)
      );
      const hits = exact.length ? exact : partial;
      if (hits.length) wards.push(hits[0]);
    } catch (_) { /* bỏ qua lỗi từng nhánh */ }
  }
  return wards;
}

/** Tìm tỉnh khớp tên trong câu hỏi. */
export async function resolveProvince(dvc, parts) {
  const provinces = [];
  for (const name of parts) {
    try {
      const items = await dvc.searchProvinces(name, { limit: 5 });
      const hits = items.filter((it) =>
        stripVN(it.name || it.province_name || '').includes(stripVN(name))
      );
      if (hits.length) provinces.push(hits[0]);
    } catch (_) { /* bỏ qua */ }
  }
  return provinces;
}

/**
 * Tìm thủ tục theo câu hỏi tự nhiên.
 * Ưu tiên lọc theo xã (chính xác nhất), không có địa danh thì search toàn quốc.
 */
export async function findProcedures(dvc, rawText, { limit = 6 } = {}) {
  const { wardQuery, provinceQuery, keyword } = extractLocationAndKeyword(rawText);

  // 1) Có địa danh -> lọc theo xã (server-side filter trong phạm vi xã)
  if (wardQuery.length) {
    const wards = await resolveWard(dvc, wardQuery);
    const ward = wards[0];
    if (ward) {
      const kw = keyword || '';
      // Thử từ khoá chính, rồi bỏ dần từ cuối nếu không ra kết quả
      const cands = kw ? keywordFallbacks(kw) : [''];
      for (const cand of cands) {
        const r = await dvc.searchWardProcedures(ward.code, cand, { limit });
        if (r.items.length) {
          return {
            scope: 'ward',
            ward,
            keyword: cand,
            total: r.total,
            items: r.items,
            sources: [
              {
                label: `Thủ tục áp dụng tại ${ward.name || ward.ward_name}`,
                url: ward.portal_url || 'https://dichvucong.gov.vn',
              },
            ],
          };
        }
      }
    }
  }

  // 2) Có tỉnh -> lọc theo tỉnh
  if (provinceQuery.length) {
    const provinces = await resolveProvince(dvc, provinceQuery);
    const prov = provinces[0];
    if (prov) {
      const kw = keyword || rawText;
      for (const cand of keywordFallbacks(kw)) {
        const r = await dvc.searchProcedures(cand, { limit });
        if (r.items.length) {
          return {
            scope: 'province',
            province: prov,
            keyword: cand,
            total: r.total,
            items: r.items,
            sources: [
              {
                label: `Thủ tục áp dụng tại ${prov.name || prov.province_name}`,
                url: 'https://dichvucong.gov.vn',
              },
            ],
          };
        }
      }
    }
  }

  // 3) Không có địa danh -> search toàn quốc, fallback bỏ dần từ cuối
  for (const cand of keywordFallbacks(keyword || rawText)) {
    const r = await dvc.searchProcedures(cand, { limit });
    if (r.items.length) {
      return {
        scope: 'national',
        keyword: cand,
        total: r.total,
        items: r.items,
        sources: [{ label: 'Cổng Dịch vụ công Quốc gia', url: 'https://dichvucong.gov.vn' }],
      };
    }
  }

  return { scope: 'none', keyword, total: 0, items: [], sources: [] };
}

/** Đơn vị thời gian xử lý (API trả về mã tiếng Anh). */
export const TIME_UNITS = {
  DAY: 'ngày',
  HOUR: 'giờ',
  WORKING_DAY: 'ngày làm việc',
  MONTH: 'tháng',
  YEAR: 'năm',
  MINUTE: 'phút',
  OTHER: '',
};

/** Định dạng thời gian xử lý kèm đơn vị, an toàn khi unit lạ. */
export function formatProcessingTime(value, unit) {
  if (value === undefined || value === null || value === '') return '';
  const u = TIME_UNITS[unit];
  if (u === undefined) return `${value} ${unit || ''}`.trim();
  if (u === '') return String(value); // OTHER: giữ nguyên số
  return `${value} ${u}`;
}

/** Rút gọn thông tin thủ tục thành text cho AI. */
export function procedureToContext(item) {
  const lines = [];
  const name = item.name || item.title || '';
  const code = item.code || item.code_notation || '';
  if (name) lines.push(`Tên: ${name}`);
  if (code) lines.push(`Mã: ${code}`);
  if (item.issuing_agency) lines.push(`Cơ quan ban hành: ${item.issuing_agency}`);
  if (item.processing_time) {
    lines.push(`Thời gian xử lý: ${formatProcessingTime(item.processing_time, item.processing_time_unit)}`);
  }
  if (item.case_code) lines.push(`Mã trường hợp: ${item.case_code}`);
  if (item.level) lines.push(`Cấp thực hiện: ${item.level}`);
  if (item.category_name) lines.push(`Lĩnh vực: ${item.category_name}`);
  if (item.description) lines.push(`Mô tả: ${item.description}`);
  if (item.citizen_url) lines.push(`Link nộp trực tuyến: ${item.citizen_url}`);
  if (item.portal_url) lines.push(`Trên Cổng DVC Quốc gia: ${item.portal_url}`);
  return lines.join('\n');
}

/** Rút gọn chi tiết thủ tục (hồ sơ, phí, trình tự) thành text cho AI. */
export function detailToContext(d) {
  const lines = [];
  lines.push(`Tên: ${d.name || ''}`);
  lines.push(`Mã: ${d.code || ''}`);
  if (d.issuing_agency) lines.push(`Cơ quan ban hành: ${d.issuing_agency}`);

  const auth = (d.departments_authority || []).map((x) => x.name).filter(Boolean);
  if (auth.length) lines.push(`Cơ quan tiếp nhận & giải quyết: ${auth.join('; ')}`);

  if (d.processing_time) {
    lines.push(`Thời gian xử lý: ${formatProcessingTime(d.processing_time, d.processing_time_unit)}`);
  }

  const comps = (d.components || [])
    .map((c) => (c.name || '').replace(/^-\s*/, '').trim())
    .filter((n) => n && n.length > 4);
  if (comps.length) lines.push(`Thành phần hồ sơ: ${comps.join('; ')}`);

  const fees = (d.fees || [])
    .map((f) => `${f.description || ''} ${f.value ?? ''} ${f.currencyId || 'VND'}`.trim())
    .filter(Boolean);
  if (fees.length) lines.push(`Lệ phí: ${fees.join('; ')}`);

  const results = (d.results || []).map((r) => r.name).filter(Boolean);
  if (results.length) lines.push(`Kết quả thực hiện: ${results.join('; ')}`);

  const steps = (d.steps || [])
    .map((s) => (s.description || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (steps.length) {
    const brief = steps.map((s) => (s.length > 300 ? s.slice(0, 300) + '…' : s)).join(' | ');
    lines.push(`Trình tự thực hiện: ${brief}`);
  }

  // Điều kiện thực hiện (rút gọn)
  const conditions = (d.requirements_conditions || [])
    .map((c) => (c.name || c.description || '').replace(/\s+/g, ' ').trim())
    .filter((n) => n && n.length > 10);
  if (conditions.length) {
    lines.push(
      `Điều kiện thực hiện: ${conditions.map((c) => (c.length > 200 ? c.slice(0, 200) + '…' : c)).join('; ')}`
    );
  }

  const legal = (d.legal_basis || []).map((l) => l.name).filter(Boolean);
  if (legal.length) lines.push(`Căn cứ pháp lý: ${legal.join('; ')}`);

  const links = (d.submission_links || []).filter((l) => l.url);
  if (links.length) {
    lines.push('Link nộp trực tuyến tại địa bàn:');
    for (const l of links) lines.push(`- ${l.label || l.url}: ${l.url}`);
  }
  if (d.portal_url) lines.push(`Trên Cổng DVC Quốc gia: ${d.portal_url}`);

  return lines.join('\n');
}

/**
 * Tìm nội dung tra cứu đầy đủ cho một câu hỏi.
 * Trả về { kind, text, data, sources } — text là ngữ cảnh đưa cho AI.
 */
export async function buildContext(dvc, rawText, { defaultWardCode } = {}) {
  const trimmed = String(rawText || '').trim();

  // Lệnh tra cứu danh mục
  if (/^\/(danhmuc|canquan|tinhthanh|nhom|thongke)/i.test(trimmed)) {
    const cmd = trimmed.split(/\s+/)[0].toLowerCase();
    if (cmd === '/canquan') {
      const items = await dvc.listAgencies();
      const text = items.map((a) => `- ${a.name} (${a.count ?? '?'} thủ tục)`).join('\n');
      return { kind: 'agencies', text, data: items, sources: [] };
    }
    if (cmd === '/tinhthanh') {
      const items = await dvc.searchProvinces('', { limit: 40 });
      const list = items.length ? items : await dvc.request('/provinces');
      const arr = Array.isArray(list) ? list : (list.items || []);
      const text = arr.map((p) => `- ${p.name || p.province_name || ''}`).join('\n');
      return { kind: 'provinces', text, data: arr, sources: [] };
    }
    if (cmd === '/nhom') {
      const items = await dvc.listServiceGroups();
      const text = items.map((g) => `- ${g.name}`).join('\n');
      return { kind: 'service-groups', text, data: items, sources: [] };
    }
    if (cmd === '/thongke') {
      const s = await dvc.stats();
      return { kind: 'stats', text: JSON.stringify(s, null, 2), data: s, sources: [] };
    }
    const kw = trimmed.slice(cmd.length).trim();
    const r = await dvc.listCategories(kw);
    const text = r.items.map((c) => `- ${c.name} (${c.code})`).join('\n');
    return { kind: 'categories', text, data: r.items, sources: [] };
  }

  // Mã thủ tục -> chi tiết
  if (/^\d+\.\d+$/.test(trimmed)) {
    const d = await dvc.getProcedure(trimmed);
    return {
      kind: 'detail',
      text: detailToContext(d),
      data: d,
      sources: d.portal_url ? [{ label: 'Cổng DVC Quốc gia', url: d.portal_url }] : [],
    };
  }

  // Câu hỏi tự nhiên -> tìm thủ tục
  const found = await findProcedures(dvc, trimmed, { limit: 6 });

  // Nếu chỉ có 1 kết quả và khớp chính xác -> lấy luôn chi tiết
  if (found.items.length === 1 && found.items[0].code) {
    try {
      const item = found.items[0];
      const d = await dvc.getProcedure(item.code);
      const links = (d.submission_links || []).filter((l) => l.url);
      const sources = links.length
        ? links.map((l) => ({ label: l.label || 'Nộp trực tuyến', url: l.url }))
        : item.citizen_url
        ? [{ label: 'Nộp trực tuyến tại địa bàn', url: item.citizen_url }]
        : d.portal_url
        ? [{ label: 'Cổng DVC Quốc gia', url: d.portal_url }]
        : [];
      // Gắn link nộp trực tuyến từ danh sách vào dữ liệu detail
      if (item.citizen_url && !d.citizen_url) d.citizen_url = item.citizen_url;
      return { kind: 'detail', text: detailToContext(d), data: d, sources, scope: found.scope };
    } catch (_) { /* rơi xuống trả danh sách */ }
  }

  const text = found.items.map((i) => procedureToContext(i)).join('\n\n');
  return {
    kind: 'results',
    text,
    data: found.items,
    total: found.total,
    scope: found.scope,
    sources: found.sources,
  };
}
