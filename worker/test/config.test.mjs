/**
 * Test quản lý cấu hình — mask secret, merge, trạng thái kênh.
 * Chạy:  node test/config.test.mjs
 */

import {
  defaultConfig,
  mergeConfig,
  mergeIncoming,
  redactConfig,
  mergeSecretFields,
  channelStatus,
} from '../src/core/config.js';

let pass = 0;
let fail = 0;

function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✔ ${name}`); }
  else { fail++; console.log(`  ✖ ${name} ${extra}`); }
}

function section(t) { console.log(`\n=== ${t} ===`); }

section('Cấu hình mặc định');
{
  const c = defaultConfig();
  check('có 3 kênh', Object.keys(c.channels).length === 3, Object.keys(c.channels).join(','));
  check('mã xã mặc định', c.defaultWardCode === 'H44.195');
  check('kênh mặc định đều tắt', !c.channels.facebook.enabled && !c.channels.zaloBot.enabled && !c.channels.zaloOa.enabled);
  check('có system prompt rỗng (dùng mặc định)', c.ai.systemPrompt === '');
}

section('Merge config');
{
  const saved = { siteName: 'Tên riêng', channels: { facebook: { pageId: '123' } } };
  const m = mergeConfig(saved);
  check('giữ giá trị đã lưu', m.siteName === 'Tên riêng');
  check('giữ pageId đã lưu', m.channels.facebook.pageId === '123');
  check('bổ sung field mới từ mặc định', m.channels.zaloBot.secretToken === '', m.channels.zaloBot.secretToken);
  check('không mất cấu trúc', !!m.ai && !!m.dvc);
}

section('Merge partial — KHÔNG được reset trường đã lưu');
{
  // Tình huống thật: admin đã bật kênh Facebook, sau đó chỉ đổi appSecret
  const saved = defaultConfig();
  saved.channels.facebook.enabled = true;
  saved.channels.facebook.pageId = '111';
  saved.channels.facebook.verifyToken = 'vt';
  saved.channels.facebook.pageAccessToken = 'tok';
  saved.siteName = 'Tên gốc';

  // Admin gửi partial: chỉ appSecret
  const out = mergeSecretFields({ channels: { facebook: { appSecret: 'secret-new' } } }, saved);
  check('giữ enabled=true', out.channels.facebook.enabled === true, String(out.channels.facebook.enabled));
  check('giữ pageId', out.channels.facebook.pageId === '111');
  check('giữ verifyToken', out.channels.facebook.verifyToken === 'vt');
  check('giữ pageAccessToken', out.channels.facebook.pageAccessToken === 'tok');
  check('giữ siteName', out.siteName === 'Tên gốc');
  check('nhận appSecret mới', out.channels.facebook.appSecret === 'secret-new');
  check('các kênh khác không đổi', out.channels.zaloBot.enabled === false);

  // Admin bật kênh mới qua partial
  const out2 = mergeSecretFields({ channels: { zaloBot: { enabled: true, botToken: 'bt' } } }, saved);
  check('bật được kênh mới', out2.channels.zaloBot.enabled === true);
  check('kênh cũ không bị tắt', out2.channels.facebook.enabled === true);

  // Admin tắt kênh -> phải tắt thật
  const out3 = mergeSecretFields({ channels: { facebook: { enabled: false } } }, saved);
  check('tắt kênh được', out3.channels.facebook.enabled === false);
  check('tắt kênh không xóa pageId', out3.channels.facebook.pageId === '111');
}

section('Mask secret (không lộ ra client)');
{
  const c = defaultConfig();
  c.ai.geminiApiKey = 'AIzaSecret123';
  c.channels.facebook.pageAccessToken = 'EAAsecret';
  c.channels.zaloBot.botToken = 'botsecret';
  c.channels.zaloOa.accessToken = 'oasecret';
  c.dvc.apiKey = 'tenantkey';

  const r = redactConfig(c);
  check('Gemini key được che', r.ai.geminiApiKey === '••••••', r.ai.geminiApiKey);
  check('FB token được che', r.channels.facebook.pageAccessToken === '••••••');
  check('Zalo Bot token được che', r.channels.zaloBot.botToken === '••••••');
  check('Zalo OA token được che', r.channels.zaloOa.accessToken === '••••••');
  check('DVC key được che', r.dvc.apiKey === '••••••');
  check('có cờ __has_*', r.ai.__has_geminiApiKey === true);
  check('field công khai không bị che', r.channels.facebook.pageId === '');
  check('không còn giá trị gốc trong JSON', !JSON.stringify(r).includes('AIzaSecret123'));
  check('không lộ EAAsecret', !JSON.stringify(r).includes('EAAsecret'));
}

section('Merge secret (giữ token cũ khi admin không nhập lại)');
{
  const saved = defaultConfig();
  saved.ai.geminiApiKey = 'AIzaSecret123';
  saved.channels.facebook.pageAccessToken = 'EAAsecret';
  saved.channels.zaloBot.botToken = 'botsecret';
  saved.channels.zaloOa.accessToken = 'oasecret';
  saved.channels.zaloOa.refreshToken = 'refreshsecret';
  saved.channels.zaloOa.secretKey = 'secretkey';
  saved.dvc.apiKey = 'tenantkey';

  // Admin mở form -> nhận về masked -> bấm Lưu mà không đụng vào ô token
  const masked = redactConfig(saved);
  const out = mergeSecretFields(masked, saved);
  check('giữ Gemini key', out.ai.geminiApiKey === 'AIzaSecret123', out.ai.geminiApiKey);
  check('giữ FB token', out.channels.facebook.pageAccessToken === 'EAAsecret');
  check('giữ Zalo Bot token', out.channels.zaloBot.botToken === 'botsecret');
  check('giữ Zalo OA access token', out.channels.zaloOa.accessToken === 'oasecret');
  check('giữ Zalo OA refresh token', out.channels.zaloOa.refreshToken === 'refreshsecret');
  check('giữ Zalo OA secret key', out.channels.zaloOa.secretKey === 'secretkey');
  check('giữ DVC key', out.dvc.apiKey === 'tenantkey');
  check('dọn cờ __has_*', out.ai.__has_geminiApiKey === undefined);

  // Admin nhập token MỚI -> phải ghi đè được
  const changed = JSON.parse(JSON.stringify(masked));
  changed.channels.facebook.pageAccessToken = 'EAAnew';
  const out2 = mergeSecretFields(changed, saved);
  check('token mới ghi đè được', out2.channels.facebook.pageAccessToken === 'EAAnew', out2.channels.facebook.pageAccessToken);

  // Admin xóa trắng ô -> xóa luôn token
  const cleared = JSON.parse(JSON.stringify(masked));
  cleared.channels.zaloBot.botToken = '';
  const out3 = mergeSecretFields(cleared, saved);
  check('xóa trắng -> xóa token', out3.channels.zaloBot.botToken === '', out3.channels.zaloBot.botToken);

  // Trường chưa từng có giá trị -> vẫn an toàn
  const empty = defaultConfig();
  const out4 = mergeSecretFields(redactConfig(empty), empty);
  check('chưa có secret nào -> không lỗi', out4.channels.zaloBot.botToken === '');
}

section('Trạng thái kênh');
{
  const c = defaultConfig();
  let st = channelStatus(c);
  check('FB chưa cấu hình', st.facebook.configured === false);
  check('FB báo thiếu field', st.facebook.missing.length === 3, JSON.stringify(st.facebook.missing));
  check('Zalo Bot chưa cấu hình', st.zaloBot.configured === false);
  check('Zalo OA chưa cấu hình', st.zaloOa.configured === false);

  c.channels.facebook.enabled = true;
  c.channels.facebook.pageId = '111';
  c.channels.facebook.pageAccessToken = 'tok';
  c.channels.facebook.verifyToken = 'vt';
  st = channelStatus(c);
  check('FB đủ -> configured', st.facebook.configured === true);
  check('FB không còn thiếu', st.facebook.missing.length === 0);

  // Bật nhưng thiếu token -> vẫn chưa configured
  c.channels.zaloBot.enabled = true;
  st = channelStatus(c);
  check('Zalo Bot bật nhưng thiếu token -> chưa configured', st.zaloBot.configured === false);
}

console.log(`\n${'='.repeat(46)}`);
console.log(`KẾT QUẢ: ${pass} đạt, ${fail} lỗi`);
console.log('='.repeat(46));
process.exit(fail ? 1 : 0);
