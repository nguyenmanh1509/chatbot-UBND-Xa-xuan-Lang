/**
 * Seed dữ liệu chuyên viên phụ trách MẪU cho xã Xuân Lãng.
 *
 * VÌ SAO CẦN: xã có 3.544 thủ tục — gán tay từng thủ tục không thể làm.
 * Script này gán theo LĨNH VỰC cho các nhóm thủ tục mà xã thực tế
 * tiếp nhận, để chatbot trả lời đúng format:
 *   "Anh/chị hãy đến gặp đồng chí X tại bàn số N, số điện thoại ... "
 *
 * ⚠️ TÊN/ĐIỆN THOẠI Ở ĐÂY LÀ DỮ LIỆU MẪU. Admin PHẢI sửa lại trong
 *    trang quản trị (/admin -> Thủ tục của xã -> Gán hàng loạt theo lĩnh vực)
 *    trước khi đưa vào sử dụng thật.
 *
 * Chạy:  node scripts/seed-officers.mjs
 */

import { execFileSync } from 'node:child_process';

const DB = 'ubnd_xuanlang_procs';

/** Danh sách bàn phụ trách tại Trung tâm Phục vụ HC công xã Xuân Lãng. */
const DESKS = [
  { desk: 'Bàn số 1', phone: '0212 3456 101' },
  { desk: 'Bàn số 2', phone: '0212 3456 102' },
  { desk: 'Bàn số 3', phone: '0212 3456 103' },
  { desk: 'Bàn số 4', phone: '0212 3456 104' },
  { desk: 'Bàn số 5', phone: '0212 3456 105' },
];

/**
 * Ánh xạ lĩnh vực -> đồng chí phụ trách.
 * Gộp nhiều lĩnh vực vào một đồng chí là chấp nhận được ở cấp xã
 * (mỗi đồng chí phụ trách nhiều nhóm thủ tục).
 */
const OFFICERS = [
  {
    officer: 'Đồng chí Nguyễn Văn An',
    categories: ['Hộ tịch', 'Chứng thực', 'Công chứng', 'Giám định tư pháp'],
    desk: 'Bàn số 1',
    phone: '0212 3456 101',
  },
  {
    officer: 'Đồng chí Trần Thị Bình',
    categories: ['Đất đai', 'Môi trường', 'Nông nghiệp'],
    desk: 'Bàn số 2',
    phone: '0212 3456 102',
  },
  {
    officer: 'Đồng chí Lê Văn Cường',
    categories: ['Bảo hiểm xã hội', 'Bảo hiểm', 'Thu BHXH, BHYT, BHTN, BH tai nạn lao động, BNN', 'Lao động, tiền lương và bảo hiểm xã hội', 'Lao động, tiền lương', 'Lao động', 'Thực hiện chính sách BHXH'],
    desk: 'Bàn số 3',
    phone: '0212 3456 103',
  },
  {
    officer: 'Đồng chí Phạm Thị Dung',
    categories: ['Giáo dục mầm non', 'Giáo dục tiểu học', 'Giáo dục trung học', 'Giáo dục thường xuyên', 'Giáo dục và Đào tạo thuộc hệ thống giáo dục quốc dân', 'Giáo dục đại học', 'Giáo dục nghề nghiệp', 'Các cơ sở giáo dục khác', 'Giáo dục nghề nghiệp (G07-LĐ06)'],
    desk: 'Bàn số 4',
    phone: '0212 3456 104',
  },
  {
    officer: 'Đồng chí Vũ Đình Hà',
    categories: ['Đường bộ', 'Hoạt động xây dựng', 'Quản lý chất lượng công trình xây dựng', 'Vật liệu xây dựng', 'An toàn vệ sinh lao động', 'An toàn, vệ sinh lao động', 'Thiết bị y tế'],
    desk: 'Bàn số 5',
    phone: '0212 3456 105',
  },
];

const HOURS = 'Thứ 2-5, 8h00-17h00';

function q(sql) {
  const out = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', DB, '--remote', '--command', sql, '--json'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
  return JSON.parse(out);
}

let total = 0;
for (const o of OFFICERS) {
  for (const cat of o.categories) {
    const sql =
      `UPDATE procedures SET officer = '${o.officer.replace(/'/g, "''")}', ` +
      `desk = '${o.desk}', phone = '${o.phone}', office_hours = '${HOURS}', ` +
      `assigned = 1, updated_at = datetime('now') ` +
      `WHERE active = 1 AND category = '${cat.replace(/'/g, "''")}'`;
    const r = q(sql);
    const n = r?.[0]?.meta?.changes ?? 0;
    total += n;
    console.log(`${String(n).padStart(4)}  ${cat}`);
  }
}

console.log(`\n✔ Đã gán tổng cộng ${total} thủ tục cho ${OFFICERS.length} đồng chí.`);
console.log('⚠️  Hãy sửa tên/SĐT thật trong trang quản trị /admin');
