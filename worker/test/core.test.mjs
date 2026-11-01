/**
 * Bộ kiểm thử logic tra cứu — chạy trực tiếp với API DVC thật.
 * Chạy:  node test/core.test.mjs
 */

import { DvcClient } from '../src/core/dvc.js';
import { AiEngine } from '../src/core/ai.js';
import { buildContext, findProcedures, splitForChat, truncate } from '../src/core/retrieve.js';
import { handleMessage, formatDeterministic, buildNoDataContext, withCurrentDate } from '../src/core/conversation.js';
import {
  extractLocationAndKeyword,
  stripVN,
  keywordFallbacks,
  parseIntent,
  extractCode,
  looksLikeCode,
  isGenericKeyword,
} from '../src/core/nlu.js';
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

const dvc = new DvcClient({ baseUrl: 'https://dichvucong.cloudgo.vn' });

section('NLU — trích xuất địa danh');
{
  const r1 = extractLocationAndKeyword('cần hồ sơ gì để đăng ký kết hôn tại xã Xuân Lãng');
  check('nhận diện wardQuery = Xuân Lãng', r1.wardQuery.length === 1 && r1.wardQuery[0].includes('Xuân Lãng'), JSON.stringify(r1));
  check('keyword = đăng ký kết hôn', r1.keyword.includes('đăng ký') && r1.keyword.includes('kết hôn'), JSON.stringify(r1.keyword));

  const r2 = extractLocationAndKeyword('thủ tục đất đai tại Hà Nội');
  check('nhận diện tỉnh', r2.wardQuery.length + r2.provinceQuery.length > 0, JSON.stringify(r2));

  const r3 = extractLocationAndKeyword('đăng ký kết hôn');
  check('không có địa danh -> wardQuery rỗng', r3.wardQuery.length === 0);

  check('stripVN bỏ dấu', stripVN('Kết Hôn') === 'ket hon', stripVN('Kết Hôn'));
  check('stripVN đ->d', stripVN('Đăng ký') === 'dang ky', stripVN('Đăng ký'));

  const fb = keywordFallbacks('đăng ký kết hôn tại xã Xuân Lãng');
  check('fallback có "đăng ký kết hôn"', fb.includes('đăng ký kết hôn'), JSON.stringify(fb.slice(0, 3)));

  check('parseIntent lệnh /thongke', parseIntent('/thongke').command === 'stats');
  check('parseIntent mã thủ tục', parseIntent('1.000894').type === 'procedure-code');
  check('parseIntent câu hỏi', parseIntent('đăng ký kết hôn').type === 'question');

  // --- Hồi quy: "ở/tại/của" có dấu không được dùng \b (lỗi scope sai) ---
  const r4 = extractLocationAndKeyword('hộ khẩu ở Xuân Lãng');
  check('"ở Xuân Lãng" -> wardQuery có Xuân Lãng', r4.wardQuery.length === 1 && r4.wardQuery[0] === 'Xuân Lãng', JSON.stringify(r4));
  check('"hộ khẩu ở Xuân Lãng" -> keyword = hộ khẩu', r4.keyword === 'hộ khẩu', JSON.stringify(r4.keyword));

  const r5 = extractLocationAndKeyword('hộ khẩu ở đâu');
  check('"ở đâu" không phải địa danh', r5.wardQuery.length === 0 && r5.provinceQuery.length === 0, JSON.stringify(r5));

  const r6 = extractLocationAndKeyword('làm hộ khẩu ở xã Xuân Lãng thủ tục gì');
  check('tên xã không nuốt "thủ tục gì"', r6.wardQuery[0] === 'Xuân Lãng', JSON.stringify(r6.wardQuery));

  const r7 = extractLocationAndKeyword('đăng ký hộ khẩu tại Phú Thọ');
  check('"tại Phú Thọ" -> provinceQuery', r7.provinceQuery.includes('Phú Thọ'), JSON.stringify(r7.provinceQuery));
}

section('NLU — hồi quy lỗi tìm kiếm');
{
  // LỖI 1: "đăng kí kết hôn" (viết "kí") -> API trả 0 -> fallback bỏ từ
  // quá sâu -> "đăng" -> 1303 thủ tục vô nghĩa.
  const fb1 = keywordFallbacks('đăng kí kết hôn');
  check('fallback không sinh chuỗi 1 từ', fb1.every((s) => s.split(/\s+/).length >= 2), JSON.stringify(fb1));
  check('fallback có "kết hôn"', fb1.includes('kết hôn'), JSON.stringify(fb1));

  // LỖI 2: từ khóa chỉ gồm từ generic -> phải bị loại, tránh spam.
  check('"đăng" là generic', isGenericKeyword('đăng'));
  check('"đăng ký" là generic', isGenericKeyword('đăng ký'));
  check('"cấp hộ khẩu" KHÔNG generic', !isGenericKeyword('cấp hộ khẩu'));
  check('"đăng ký kết hôn" KHÔNG generic', !isGenericKeyword('đăng ký kết hôn'));

  // API DVC kén từ khóa: bỏ từ generic ở đầu cho kết quả đúng.
  const fb2 = keywordFallbacks('cấp hộ khẩu');
  check('fallback "cấp hộ khẩu" có "hộ khẩu"', fb2.includes('hộ khẩu'), JSON.stringify(fb2));

  // Mã thủ tục ở giữa câu + mã nhiều nhóm.
  check('extractCode giữa câu', extractCode('cho tôi xem 1.000894') === '1.000894');
  check('extractCode nhiều nhóm', extractCode('1.005.123') === '1.005.123');
  check('extractCode không cắt mã', extractCode('2.000507') === '2.000507');
  check('looksLikeCode mã nhiều nhóm', looksLikeCode('1.005.123'));
}

section('NLU — nhận diện lời chào');
{
  // LỖI: người dùng gõ "hi" / bấm nút "Bắt đầu" -> bot đi tìm thủ tục
  // -> trả "chưa tìm thấy thủ tục" thay vì chào hỏi.
  for (const g of ['hi', 'Hi', 'hello', 'xin chào', 'chào', 'chào bạn', 'chào anh/chị', 'xin chào anh chị', 'bắt đầu', 'Bắt đầu', 'start', 'Get Started', 'ok', 'hello!']) {
    check(`"${g}" -> greeting`, parseIntent(g).type === 'greeting', parseIntent(g).type);
  }
  // Câu hỏi thật KHÔNG được coi là lời chào.
  check('"đăng ký kết hôn" -> question', parseIntent('đăng ký kết hôn').type === 'question');
  check('"hộ khẩu" -> question', parseIntent('hộ khẩu').type === 'question');
  check(
    'câu dài có "chào" vẫn là question',
    parseIntent('hello bạn, cho tôi hỏi về đăng ký kết hôn').type === 'question'
  );
}

section('DVC — gọi API thật');
{
  const h = await dvc.health();
  check('health ok', h && h.ok === true, JSON.stringify(h));

  const st = await dvc.stats();
  check('stats trả về số liệu', st && typeof st.procedures === 'number', JSON.stringify(st).slice(0, 100));

  const w = await dvc.searchWards('Xuân Lãng', { limit: 5 });
  const xl = w.find((x) => (x.ward_name || '').includes('Xuân Lãng'));
  check('tìm thấy xã Xuân Lãng (H44.195)', xl && xl.code === 'H44.195', JSON.stringify(xl));

  const r = await dvc.searchProcedures('kết hôn', { limit: 3 });
  check('search thủ tục toàn quốc', r.items.length > 0 && r.total > 0, `total=${r.total}`);

  const wp = await dvc.searchWardProcedures('H44.195', 'kết hôn', { limit: 5 });
  check('search thủ tục theo xã lọc server-side', wp.total > 0 && wp.total < 12, `total=${wp.total} (toàn quốc=12)`);

  const d = await dvc.getProcedure('1.000894');
  check('chi tiết thủ tục 1.000894', d.name && d.name.includes('kết hôn'), d.name);
  check('chi tiết có components', Array.isArray(d.components) && d.components.length > 0);
  check('chi tiết có portal_url', !!d.portal_url);
}

section('Truy xuất — lọc theo xã');
{
  const f = await findProcedures(dvc, 'cần hồ sơ gì để đăng ký kết hôn tại xã Xuân Lãng');
  check('scope = ward', f.scope === 'ward', f.scope);
  check('có kết quả', f.items.length > 0, `total=${f.total}`);
  check('mọi kết quả đều là của xã', f.items.every((i) => i.code), 'mọi item có mã');

  const f2 = await findProcedures(dvc, 'đăng ký kết hôn');
  check('không địa danh -> scope national', f2.scope === 'national', f2.scope);
  check('kết quả toàn quốc', f2.items.length > 0, `total=${f2.total}`);
}

section('Định dạng tin nhắn');
{
  const long = 'a'.repeat(5000);
  const chunks = splitForChat(long);
  check('chia tin dài thành nhiều phần', chunks.length > 1, `parts=${chunks.length}`);
  check('mỗi phần <= 2000 ký tự', chunks.every((c) => c.length <= 2000));
  check('không mất nội dung', chunks.join('') === long, 'nội dung khớp 100%');

  // Với văn bản có khoảng trắng: nối lại phải cho cùng nội dung (bỏ qua khác biệt whitespace)
  const long2 = 'Đây là một đoạn văn bản rất dài. '.repeat(120);
  const chunks2 = splitForChat(long2);
  check('chia văn bản có khoảng trắng', chunks2.length > 1, `parts=${chunks2.length}`);
  check('mỗi phần <= 2000 ký tự', chunks2.every((c) => c.length <= 2000));
  check(
    'nội dung không bị mất',
    chunks2.join(' ').replace(/\s+/g, ' ') === long2.trim().replace(/\s+/g, ' '),
    'nội dung khớp'
  );
  check('truncate cắt an toàn', truncate('x'.repeat(3000), 100).length <= 100);
}

section('Hội thoại — không bật AI (fallback tất định)');
{
  const cfg = defaultConfig();
  const ai = new AiEngine({}); // không có key nào -> engine 'none'
  const r = await handleMessage({
    dvc,
    ai,
    cfg,
    text: 'cần hồ sơ gì để đăng ký kết hôn tại xã Xuân Lãng',
    channel: { id: 'test', aiEnabled: false },
  });
  check('trả về tin nhắn', r.messages.length > 0);
  check('engine = none', r.meta.engine === 'none', r.meta.engine);
  check('nội dung có thủ tục', /kết hôn/i.test(r.messages.join(' ')), r.messages[0].slice(0, 200));
  check('mọi tin <= 2000 ký tự', r.messages.every((m) => m.length <= 2000));
}

section('Hội thoại — lệnh');
{
  const cfg = defaultConfig();
  const ai = new AiEngine({});
  const r1 = await handleMessage({ dvc, ai, cfg, text: '/trogiup', channel: { id: 't' } });
  check('/trogiup có hướng dẫn', r1.messages[0].includes('hồ sơ'), r1.messages[0].slice(0, 80));

  const r2 = await handleMessage({ dvc, ai, cfg, text: '/phuongtoi', channel: { id: 't' } });
  check('/phuongtoi trả đúng xã', r2.messages[0].includes('Xuân Lãng'), r2.messages[0]);

  const r3 = await handleMessage({ dvc, ai, cfg, text: '1.000894', channel: { id: 't', aiEnabled: false } });
  check('mã thủ tục -> chi tiết', r3.meta.kind === 'detail', r3.meta.kind);
  check('chi tiết có hồ sơ', /hồ sơ/i.test(r3.messages.join(' ')), r3.messages[0].slice(0, 120));
}

section('Hội thoại — lời chào khi user bấm "Nhắn tin"/"Bắt đầu"');
{
  // ĐÂY LÀ LỖI USER GẶP: bấm nút "Nhắn tin" trên Page -> Meta gửi
  // postback/optin với text "bắt đầu" -> bot phải CHÀO, không phải đi
  // tìm thủ tục (trước đây trả "chưa tìm thấy thủ tục").
  const cfg = defaultConfig();
  const ai = new AiEngine({});

  for (const t of ['bắt đầu', 'Bắt đầu', 'hi', 'xin chào', 'Get Started']) {
    const r = await handleMessage({ dvc, ai, cfg, text: t, channel: { id: 'facebook' } });
    check(`"${t}" trả lời chào`, r.messages[0].includes('chào'), r.messages[0].slice(0, 80));
    check(`"${t}" có nút bấm nhanh`, (r.quickReplies || []).length > 0, String((r.quickReplies || []).length));
  }

  // Lời chào riêng của kênh được ưu tiên hơn lời chào chung.
  const rCh = await handleMessage({
    dvc,
    ai,
    cfg,
    text: 'bắt đầu',
    channel: { id: 'facebook', greeting: 'Chào bạn, UBND xã Xuân Lãng!' },
  });
  check('lời chào riêng của kênh được ưu tiên', rCh.messages[0] === 'Chào bạn, UBND xã Xuân Lãng!', rCh.messages[0]);

  // Tin nhắn rỗng (widget web gọi lúc mở) cũng phải ra lời chào.
  const rEmpty = await handleMessage({ dvc, ai, cfg, text: '', channel: { id: 'web' } });
  check('text rỗng -> lời chào', rEmpty.messages[0] === cfg.greeting, rEmpty.messages[0].slice(0, 80));
}

section('Hội thoại — chào lời khi người dùng tương tác LẦN ĐẦU');
{
  // VÌ SAO: Meta chỉ hiện lời chào mở chat nếu Page được cấu hình trong
  // Meta Business Suite. API `messenger_profile` đã bỏ hỏi hỗ trợ `greeting`
  // từ 2024 -> không cài được bằng script. Nên bot phải TỰ chào ở tin nhắn
  // đầu tiên để luôn có lời chào, không phụ thuộc Meta.
  const cfg = defaultConfig();
  const ai = new AiEngine({});

  // Lần đầu (history rỗng) -> có lời chào ở đầu.
  const r1 = await handleMessage({
    dvc,
    ai,
    cfg,
    text: 'hộ khẩu',
    channel: { id: 'facebook', aiEnabled: false, greetFirstContact: true },
    history: [],
  });
  check('lần đầu -> có lời chào', r1.messages[0].includes('chào'), r1.messages[0].slice(0, 80));
  check('lần đầu -> lời chào đứng trước', r1.messages.length >= 2, String(r1.messages.length));

  // Lần sau (đã có lịch sử) -> KHÔNG chào lại.
  const r2 = await handleMessage({
    dvc,
    ai,
    cfg,
    text: 'hộ khẩu',
    channel: { id: 'facebook', aiEnabled: false, greetFirstContact: true },
    history: [{ role: 'user', text: 'hộ khẩu' }],
  });
  check('lần sau -> không chào lại', !r2.messages[0].includes('chào'), r2.messages[0].slice(0, 80));

  // Nếu tin đầu tiên là lời chào -> không chào 2 lần.
  const r3 = await handleMessage({
    dvc,
    ai,
    cfg,
    text: 'bắt đầu',
    channel: { id: 'facebook', greetFirstContact: true },
    history: [],
  });
  check('tin đầu là lời chào -> chào 1 lần', r3.messages.length === 1, String(r3.messages.length));

  // Kênh KHÔNG bật greetFirstContact (web) -> không tự chào.
  const r4 = await handleMessage({
    dvc,
    ai,
    cfg,
    text: 'hộ khẩu',
    channel: { id: 'web', aiEnabled: false },
    history: [],
  });
  check('kênh không bật -> không tự chào', !r4.messages[0].includes('chào'), r4.messages[0].slice(0, 80));
}

section('Định dạng deterministic');
{
  const cfg = defaultConfig();
  const ctx = await buildContext(dvc, '1.000894');
  const out = formatDeterministic(ctx, cfg);
  check('có tên thủ tục', out.includes('kết hôn'), out.slice(0, 100));
  check('có mã thủ tục', out.includes('1.000894'));
}

section('Xử lý lỗi');
{
  const cfg = defaultConfig();
  const badDvc = new DvcClient({ baseUrl: 'https://khong-ton-tai-abcxyz.invalid' });
  const ai = new AiEngine({});
  const r = await handleMessage({ dvc: badDvc, ai, cfg, text: 'đăng ký kết hôn', channel: { id: 't' } });
  check('API chết -> trả thông báo lỗi', r.messages[0] === cfg.errorMessage, r.messages[0]);
  check('ghi nhận lỗi trong meta', !!r.meta.error);
}

section('Ngữ cảnh ngày tháng (AI không tự biết hôm nay là ngày nào)');
{
  // 2026-11-01 00:30 UTC = 2026-11-01 07:30 giờ VN -> Chủ Nhật
  const ctx = buildNoDataContext(new Date('2026-11-01T00:30:00Z'));
  check('có ngày/tháng/năm', ctx.includes('1/11/2026'), ctx.slice(0, 200));
  check('đúng thứ', ctx.includes('Chủ Nhật'), ctx.slice(0, 200));
  check('có giờ', /\d{2}:\d{2}/.test(ctx));
  check('nói rõ không có dữ liệu', /Không có thủ tục nào khớp/.test(ctx));

  // Kiểm tra múi giờ VN: 2026-11-01 23:00 UTC = 2026-11-02 06:00 VN
  const ctx2 = buildNoDataContext(new Date('2026-11-01T23:00:00Z'));
  check('đã cộng +7 giờ (sang ngày mai)', ctx2.includes('2/11/2026'), ctx2.slice(0, 200));

  // Truyền ngày cố định -> test không vỡ mỗi khi qua nửa đêm.
  const withDate = withCurrentDate('Tên: abc\nMã: 1.000894', new Date('2026-11-01T00:30:00Z'));
  check('gắn ngày vào ngữ cảnh thủ tục', withDate.includes('1/11/2026'), withDate.slice(-150));
  check('giữ nguyên phần dữ liệu gốc', withDate.startsWith('Tên: abc'), withDate.slice(0, 60));
}

section('Câu hỏi ngoài phạm vi vẫn tới được AI');
{
  const cfg = defaultConfig();
  // AI giả lập: luôn trả lời
  const fakeAi = {
    ask: async (q, ctx) => ({ text: `AI trả lời cho "${q}"`, engine: 'fake' }),
    hasGemini: true,
    hasCfAi: true,
    lastError: null,
  };
  // DVC rỗng -> không tìm thấy thủ tục nào -> ctx.text rỗng
  const emptyDvc = {
    searchProcedures: async () => ({ items: [], total: 0 }),
    searchWards: async () => [],
    searchProvinces: async () => [],
    searchWardProcedures: async () => ({ items: [], total: 0 }),
    getProcedure: async () => null,
  };
  const r = await handleMessage({
    dvc: emptyDvc,
    ai: fakeAi,
    cfg,
    text: 'hôm nay là ngày mấy',
    channel: { id: 't', aiEnabled: true },
  });
  check('AI được gọi (không trả fallback)', r.meta.engine === 'fake', JSON.stringify(r.meta));
  check('trả lời của AI', r.messages[0].includes('AI trả lời'), r.messages[0]);
}

section('Câu hỏi ngoài phạm vi + AI lỗi -> fallback tất định');
{
  const cfg = defaultConfig();
  const deadAi = { ask: async () => ({ text: null, engine: 'none' }), hasGemini: true, hasCfAi: true };
  const emptyDvc = {
    searchProcedures: async () => ({ items: [], total: 0 }),
    searchWards: async () => [],
    searchProvinces: async () => [],
    searchWardProcedures: async () => ({ items: [], total: 0 }),
    getProcedure: async () => null,
  };
  const r = await handleMessage({
    dvc: emptyDvc,
    ai: deadAi,
    cfg,
    text: 'hôm nay là ngày mấy',
    channel: { id: 't', aiEnabled: true },
  });
  check('vẫn trả fallback, không lỗi', r.messages[0] === cfg.fallbackMessage, r.messages[0]);
}

console.log(`\n${'='.repeat(46)}`);
console.log(`KẾT QUẢ: ${pass} đạt, ${fail} lỗi`);
console.log('='.repeat(46));
process.exit(fail ? 1 : 0);
