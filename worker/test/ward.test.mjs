/**
 * Kiểm thử tính năng mới: import thủ tục xã, gán chuyên viên, câu mời đến gặp.
 *
 * Chạy:  node test/ward.test.mjs
 *
 * Dùng một DB giả lập (in-memory) để không đụng vào D1 thật.
 */

import {
  sanitizeProcedure,
  rowToProcedure,
  stripAccents,
  localProcedureToReply,
  localProcedureToText,
  searchLocalProcedures,
  PROCEDURE_FIELDS,
} from '../src/core/procedures.js';
import { summariseProcedure, fetchWardPage } from '../src/core/dvc-import.js';
import { defaultConfig } from '../src/core/config.js';

let pass = 0;
let fail = 0;

function check(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ✔ ${name}`);
  } else {
    fail++;
    console.log(`  ✖ ${name} ${extra}`);
  }
}

function section(t) {
  console.log(`\n=== ${t} ===`);
}

/**
 * DB giả lập tối giản cho D1.
 *
 * Chỉ cần hỗ trợ: prepare().bind(...).all() trên câu SELECT có điều kiện
 * WHERE ... LIKE ... AND active = 1. Ta mô phỏng bằng cách lọc trong JS.
 */
function makeFakeDb(rows) {
  return {
    async prepare(sql) {
      const whereMatch = sql.match(/WHERE\s+(.*?)(?:\s+LIMIT|\s+ORDER|$)/is);
      return {
        async all() {
          let out = rows;
          if (whereMatch) {
            const w = whereMatch[1];
            // Trích các điều kiện LIKE ? để lấy mẫu.
            const likes = [...w.matchAll(/(\w+)\s+LIKE\s+\?\s+COLLATE\s+NOCASE/gi)].map((m) =>
              m[1].toLowerCase()
            );
            const needsNoAccent = /name_noaccent\s+LIKE/i.test(w);
            const onlyActive = /active\s*=\s*1/.test(w);
            out = out.filter((r) => {
              if (onlyActive && !r.active) return false;
              for (const col of likes) {
                const val = String(r[col] || '').toLowerCase();
                const na = stripAccents(r[col] || '').toLowerCase();
                if (!val.includes('x') && !na.includes('x')) {
                  // placeholder: dùng logic thật bên dưới
                }
              }
              return true;
            });
          }
          return { results: out };
        },
      };
    },
  };
}

section('Chuẩn hóa dữ liệu');
{
  const { data } = sanitizeProcedure({
    name: '  Cấp giấy xác nhận hộ khẩu  ',
    code: '',
    officer: 'Nguyễn Văn A',
    desk: 'Bàn số 3',
    phone: '0212 345 678',
    active: 1,
    assigned: true,
  });
  check('tên được cắt khoảng trắng thừa', data.name === 'Cấp giấy xác nhận hộ khẩu', JSON.stringify(data));
  check('chuỗi rỗng -> null', data.code === null, JSON.stringify(data));
  check('assigned -> 1', data.assigned === 1, JSON.stringify(data));
  check('office_hours không có thì không có trong data', !('office_hours' in data));

  const { error } = sanitizeProcedure({ code: '1.000894' });
  check('thiếu tên -> báo lỗi', !!error, String(error));

  check('stripAccents bỏ dấu', stripAccents('Hộ khẩu') === 'Ho khau', stripAccents('Hộ khẩu'));
  check('stripAccents đ -> d', stripAccents('đăng ký') === 'dang ky', stripAccents('đăng ký'));
  check('stripAccents Đ -> D', stripAccents('Đăng ký') === 'Dang ky', stripAccents('Đăng ký'));
  check('stripAccents giữ chữ thường', stripAccents('Căn cước') === 'Can cuoc', stripAccents('Căn cước'));
  check('PROCEDURE_FIELDS có case_code', PROCEDURE_FIELDS.includes('case_code'));
  check('PROCEDURE_FIELDS có name_noaccent', PROCEDURE_FIELDS.includes('name_noaccent'));
}

section('rowToProcedure — đủ trường mới');
{
  const p = rowToProcedure({
    id: 1,
    name: 'Cấp lại thẻ căn cước',
    code: '1.014064',
    dvc_id: '019d2bf7-9e0b',
    case_code: '1.014064.01',
    level: 'FULL',
    category: 'Cấp, quản lý căn cước',
    agency: 'Bộ Công an',
    citizen_url: 'https://dichvucong.mst.gov.vn/x',
    portal_url: 'https://dichvucong.gov.vn/thu-tuc-hanh-chinh/019d2bf7-9e0b',
    summary: 'Cấp lại thẻ căn cước khi thẻ bị mất, hỏng.',
    source: 'dvc',
    assigned: 1,
    active: 1,
  });
  check('case_code được đọc', p.case_code === '1.014064.01', p.case_code);
  check('level được đọc', p.level === 'FULL');
  check('category được đọc', p.category === 'Cấp, quản lý căn cước');
  check('summary được đọc', !!p.summary);
  check('assigned -> boolean', p.assigned === true);
  check('source được đọc', p.source === 'dvc');
}

section('Câu trả lời cho người dân (yêu cầu #2)');
{
  const p = {
    name: 'Cấp giấy xác nhận tình trạng hộ khẩu',
    code: '1.001014',
    summary: 'Xác nhận tình trạng hộ khẩu cho công dân.',
    officer: 'Nguyễn Văn A',
    desk: 'Bàn số 3',
    phone: '0212 345 678',
    office_hours: 'Thứ 2-5, 8h-17h',
    citizen_url: 'https://dichvucong.mst.gov.vn/apply',
    portal_url: 'https://dichvucong.gov.vn/thu-tuc-hanh-chinh/abc',
  };
  const out = localProcedureToReply(p, { officeName: 'Trung tâm Phục vụ hành chính công xã Xuân Lãng' });
  check('có tên thủ tục', out.includes('hộ khẩu'), out.slice(0, 120));
  check('có mã thủ tục', out.includes('1.001014'));
  check('có tóm tắt', out.includes('Xác nhận tình trạng hộ khẩu'), out.slice(0, 250));
  check('có đồng chí phụ trách', out.includes('Nguyễn Văn A'));
  check('có bàn số', /Bàn số:\s*3/.test(out), out.slice(0, 250));
  check('có số điện thoại', out.includes('0212 345 678'));
  check('có giờ làm việc', out.includes('8h-17h'));
  check(
    'có câu mời đến gặp đúng định dạng',
    /Anh\/chị hãy đến gặp đồng chí Nguyễn Văn A tại bàn số 3, số điện thoại 0212 345 678 tại Trung tâm Phục vụ hành chính công xã Xuân Lãng\./.test(out),
    out
  );
  check('có link nộp trực tuyến', out.includes('dichvucong.mst.gov.vn'));
  check('có link Cổng DVC Quốc gia', out.includes('dichvucong.gov.vn/thu-tuc-hanh-chinh/abc'));

  // Không có đồng chí -> KHÔNG in câu mời (tránh câu rỗng vô nghĩa).
  const out2 = localProcedureToReply({ name: 'X' }, { officeName: 'Trung tâm' });
  check('không có đồng chí -> không có câu mời', !/hãy đến gặp/.test(out2), out2);

  // Trường trống -> bỏ qua, không in dấu chấm trống.
  const out3 = localProcedureToReply({ name: 'X', officer: '', desk: '', phone: '' });
  check('bỏ qua trường rỗng', !/Đồng chí phụ trách/.test(out3) && !/Bàn số/.test(out3), out3);
}

section('Ngữ cảnh cho AI');
{
  const t = localProcedureToText({
    name: 'Cấp lại thẻ căn cước',
    code: '1.014064',
    summary: 'Cấp lại thẻ căn cước khi bị mất.',
    category: 'Căn cước',
    agency: 'Bộ Công an',
    level: 'FULL',
    officer: 'Nguyễn Văn A',
    desk: 'Bàn số 3',
    phone: '0212 345 678',
    citizen_url: 'https://dichvucong.mst.gov.vn/a',
    portal_url: 'https://dichvucong.gov.vn/thu-tuc-hanh-chinh/x',
  });
  check('có tóm tắt', t.includes('Tóm tắt:'), t);
  check('có lĩnh vực', t.includes('Lĩnh vực: Căn cước'));
  check('có cơ quan', t.includes('Cơ quan ban hành: Bộ Công an'));
  check('có đồng chí', t.includes('Đồng chí phụ trách: Nguyễn Văn A'));
  check('có link DVC', t.includes('Trên Cổng DVC Quốc gia:'));
}

section('Tóm tắt thủ tục (yêu cầu #5)');
{
  const s1 = summariseProcedure({
    description: '  - Bước 1: công dân nộp hồ sơ\t\n+ Cơ quan tiếp nhận kiểm tra hồ sơ trong 03 ngày làm việc.  ',
  });
  check('bỏ ký tự định dạng', !s1.includes('\t') && !s1.includes('+'), JSON.stringify(s1));
  check('giữ nội dung', s1.includes('kiểm tra hồ sơ'), s1);

  const long = 'x'.repeat(500);
  const s2 = summariseProcedure({ description: long });
  check('cắt ngắn khi quá dài', s2.length <= 225, String(s2.length));

  check('mô tả rỗng -> tóm tắt rỗng', summariseProcedure({ description: '' }) === '');
  check('không có description -> tóm tắt rỗng', summariseProcedure({}) === '');
}

section('Cấu hình mặc định (yêu cầu #1)');
{
  const cfg = defaultConfig();
  check('lời chào bắt đầu bằng "Em chào anh/chị"', cfg.greeting.startsWith('Em chào anh/chị'), cfg.greeting.slice(0, 40));
  check('tiêu đề chatbot đúng yêu cầu', cfg.chatTitle === 'Chatbot hỗ trợ tra cứu thủ tục hành chính', cfg.chatTitle);
  check('tên cơ quan có Trung tâm Phục vụ HC', cfg.officeName.includes('Trung tâm Phục vụ hành chính công xã Xuân Lãng'), cfg.officeName);
  check('mã xã mặc định đúng', cfg.defaultWardCode === 'H44.195');
  check('tên xã mặc định đúng', cfg.defaultWardName === 'Xã Xuân Lãng');
}

console.log(`\n${fail === 0 ? '✔ TẤT CẢ ĐẠT' : '✖ CÓ LỖI'}: ${pass} đạt, ${fail} lỗi`);
process.exit(fail === 0 ? 0 : 1);
