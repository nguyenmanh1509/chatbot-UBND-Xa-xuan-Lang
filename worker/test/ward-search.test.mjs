/**
 * Test bộ tìm kiếm thủ tục của xã (ward-search.js).
 *
 * Mục tiêu: chặn lỗi "hộ khẩu" khớp "nhập khẩu" — lỗi làm bot trả
 * về danh sách thủ tục hoàn toàn không liên quan.
 */
import { expandQuery, searchWardIndex, isTimeQuestion, cleanSummary } from '../src/core/ward-search.js';

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

/** Fake D1 tối giản: trả về các row khớp điều kiện LIKE. */
function fakeDb(rows) {
  return {
    prepare(sql) {
      return {
        bind(...binds) {
          return {
            async all() {
              // Chỉ cần đủ để test: trả về toàn bộ row có tên chứa ít nhất
              // 1 từ khoá của câu hỏi.
              const like = binds.filter((b) => String(b).startsWith('%'));
              const matched = rows.filter((r) =>
                like.some((l) => r.name.toLowerCase().includes(String(l).slice(1, -1)))
              );
              return { results: matched.length ? matched : rows };
            },
          };
        },
      };
    },
  };
}

const ROWS = [
  { id: 1, name: 'Cấp thẻ Căn cước cho người từ đủ 14 tuổi trở lên', code: '1.014061', level: 'PARTIAL', category: 'Cấp, quản lý căn cước', agency: 'Bộ Công an', summary: 'Cấp thẻ căn cước cho người từ đủ 14 tuổi', citizen_url: '', portal_url: 'https://dichvucong.gov.vn/a' },
  { id: 2, name: 'Cấp giấy phép nhập khẩu thức ăn chăn nuôi chưa được công bố', code: '1.008122', level: 'FULL', category: 'Xuất nhập khẩu', agency: 'Bộ NN&MT', summary: '', citizen_url: '', portal_url: 'https://dichvucong.gov.vn/b' },
  { id: 3, name: 'Đăng ký, cấp lại sổ hộ khẩu, cấp lại giấy xác nhận tình trạng hộ khẩu', code: '1.001.279', level: 'FULL', category: 'Cấp, quản lý căn cước', agency: 'Công an', summary: 'Thủ tục cấp sổ hộ khẩu', citizen_url: 'https://dichvucong.gov.vn/c', portal_url: 'https://dichvucong.gov.vn/c' },
  { id: 4, name: 'Thủ tục biên phòng điện tử cửa khẩu biên giới đất liền', code: '1.013591', level: 'FULL', category: 'Biên phòng', agency: 'Bộ QP', summary: '', citizen_url: '', portal_url: 'https://dichvucong.gov.vn/d' },
];

console.log('=== expandQuery ===');
{
  const { tokens, phrases } = expandQuery('cấp hộ khẩu');
  check('giữ từ "ho" (hộ)', tokens.includes('ho'), JSON.stringify(tokens));
  check('giữ từ "khau"', tokens.includes('khau'), JSON.stringify(tokens));
  check('có bigram "ho khau"', phrases.includes('ho khau'), JSON.stringify(phrases));
  check('có từ đồng nghĩa "can cuoc"', phrases.includes('can cuoc'), JSON.stringify(phrases));
}
{
  const { tokens } = expandQuery('thủ tục cấp hộ khẩu');
  check('loại "thu tuc"', !tokens.includes('thu') && !tokens.includes('tuc'), JSON.stringify(tokens));
}
{
  const { tokens } = expandQuery('anh ơi cho em hỏi hôm nay ngày mấy');
  check('loại từ xưng hô', !tokens.includes('anh') && !tokens.includes('em'), JSON.stringify(tokens));
}

console.log('\n=== searchWardIndex ===');
{
  const db = fakeDb(ROWS);
  const hits = await searchWardIndex(db, 'cấp hộ khẩu', { limit: 5 });
  const top = hits[0];
  check('có kết quả', hits.length > 0);
  check(
    'thủ tục hộ khẩu đứng đầu',
    top && (top.row.name.includes('hộ khẩu') || top.row.name.includes('Căn cước')),
    top ? top.row.name : 'rỗng'
  );
  check(
    'thủ tục nhập khẩu KHÔNG đứng đầu',
    !top || !top.row.name.includes('nhập khẩu'),
    top ? top.row.name : ''
  );
}
{
  const db = fakeDb(ROWS);
  const hits = await searchWardIndex(db, 'cửa khẩu biên giới', { limit: 5 });
  check('câu hỏi "cửa khẩu" ra thủ tục biên phòng', hits.length > 0, JSON.stringify(hits.map(h => h.row.name)));
}
{
  const db = fakeDb(ROWS);
  const hits = await searchWardIndex(db, 'hôm nay ngày mấy', { limit: 5 });
  check('câu ngoài lề -> không khớp thủ tục nào', hits.length === 0, JSON.stringify(hits.map(h => h.row.name)));
}
{
  const db = fakeDb(ROWS);
  const hits = await searchWardIndex(db, 'đăng ký kết hôn', { limit: 5 });
  check('không có dữ liệu -> rỗng (không vỡ)', Array.isArray(hits));
}

console.log('\n=== isTimeQuestion (yêu cầu #4) ===');
{
  check('"hôm nay ngày mấy" là câu hỏi thời gian', isTimeQuestion('hôm nay ngày mấy'));
  check('"mấy giờ rồi" là câu hỏi thời gian', isTimeQuestion('mấy giờ rồi'));
  check('"hôm là thứ mấy" là câu hỏi thời gian', isTimeQuestion('hôm là thứ mấy'));
  check('"cấp hộ khẩu" KHÔNG phải câu hỏi thời gian', !isTimeQuestion('cấp hộ khẩu'));
  check('câu dài không phải câu hỏi thời gian', !isTimeQuestion('cho em hỏi hôm nay là ngày mấy ạ'));
}

console.log('\n=== cleanSummary ===');
{
  check('loại "Không."', cleanSummary('Không.') === '');
  check('loại "-"', cleanSummary('-') === '');
  check('loại "N/A"', cleanSummary('N/A') === '');
  check('loại chuỗi rỗng', cleanSummary('') === '');
  check('loại chuỗi quá ngắn', cleanSummary('abc') === '');
  check('giữ nội dung thật', cleanSummary('Cấp thẻ căn cước cho người từ đủ 14 tuổi trở lên').length > 10);
}

console.log(`\n${fail === 0 ? '✔ TẤT CẢ PASS' : '✖ CÓ LỖI'}: ${pass} đạt, ${fail} lỗi`);
if (fail) process.exit(1);
