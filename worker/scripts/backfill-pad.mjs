/**
 * Backfill cột `category_pad` (lĩnh vực không dấu, có khoảng trắng bao quanh).
 *
 * VÌ SAO CẦN: SQLite không có hàm unaccent tiếng Việt. Ta dựng chuỗi
 * REPLACE lồng nhau trong SQL để bỏ dấu ngay trong DB, rồi bọc khoảng
 * trắng đầu-cuối. Sau đó SQL LIKE '% dat dai %' khớp đúng CỤM TỪ
 * (không còn khớp substring "dai" trong "đại lý").
 *
 * Dùng: node scripts/backfill-pad.mjs
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

/** Cặp (ký tự có dấu, ký tự thay thế) — đầy đủ bảng chữ cái tiếng Việt. */
const MAP = [
  ['đ', 'd'], ['Đ', 'D'],
  // Nguyên âm có dấu riêng (â, ă, ê, ô, ơ, ư) — BẮT BUỘC có, nếu thiếu
  // "hạt nhân" sẽ thành "hât nhan" và so khớp sai.
  ['â', 'a'], ['ă', 'a'], ['ê', 'e'], ['ô', 'o'], ['ơ', 'o'], ['ư', 'u'],
  ['Â', 'A'], ['Ă', 'A'], ['Ê', 'E'], ['Ô', 'O'], ['Ơ', 'O'], ['Ư', 'U'],
  ['à', 'a'], ['á', 'a'], ['ả', 'a'], ['ã', 'a'], ['ạ', 'a'],
  ['ằ', 'a'], ['ắ', 'a'], ['ẳ', 'a'], ['ẵ', 'a'], ['ặ', 'a'],
  ['ầ', 'a'], ['ấ', 'a'], ['ẩ', 'a'], ['ẫ', 'a'], ['ậ', 'a'],
  ['è', 'e'], ['é', 'e'], ['ẻ', 'e'], ['ẽ', 'e'], ['ẹ', 'e'],
  ['ề', 'e'], ['ế', 'e'], ['ể', 'e'], ['ễ', 'e'], ['ệ', 'e'],
  ['ì', 'i'], ['í', 'i'], ['ỉ', 'i'], ['ĩ', 'i'], ['ị', 'i'],
  ['ò', 'o'], ['ó', 'o'], ['ỏ', 'o'], ['õ', 'o'], ['ọ', 'o'],
  ['ồ', 'o'], ['ố', 'o'], ['ổ', 'o'], ['ỗ', 'o'], ['ộ', 'o'],
  ['ờ', 'o'], ['ớ', 'o'], ['ở', 'o'], ['ỡ', 'o'], ['ợ', 'o'],
  ['ù', 'u'], ['ú', 'u'], ['ủ', 'u'], ['ũ', 'u'], ['ụ', 'u'],
  ['ừ', 'u'], ['ứ', 'u'], ['ử', 'u'], ['ữ', 'u'], ['ự', 'u'],
  ['ỳ', 'y'], ['ý', 'y'], ['ỷ', 'y'], ['ỹ', 'y'], ['ỵ', 'y'],
];

/** Dựng biểu thức SQL bỏ dấu (REPLACE lồng nhau). */
function deaccentSql(expr) {
  let out = expr;
  for (const [from, to] of MAP) {
    out = `REPLACE(${out}, '${from}', '${to}')`;
  }
  return out;
}

const sql = `
UPDATE procedures
SET category_pad = ' ' || TRIM(${deaccentSql("LOWER(COALESCE(category, ''))")}) || ' ';
`;

// Ghi SQL ra file tạm rồi dùng --file (tránh vấn đề escape của shell).
writeFileSync('/tmp/backfill-category-pad.sql', sql);

execSync(
  'npx wrangler d1 execute ubnd_xuanlang_procs --remote --file /tmp/backfill-category-pad.sql',
  { encoding: 'utf8', stdio: 'pipe' }
);

// Kiểm tra kết quả
const check = execSync(
  'npx wrangler d1 execute ubnd_xuanlang_procs --remote --command "SELECT category, category_pad FROM procedures WHERE category_pad IS NOT NULL LIMIT 5" --json',
  { encoding: 'utf8' }
);
console.log('Mẫu sau khi backfill:');
for (const r of JSON.parse(check)[0].results) {
  console.log(`  ${r.category}  ->  ${r.category_pad}`);
}
