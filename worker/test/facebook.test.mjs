/**
 * Test adapter Facebook Messenger — xác thực chữ ký, challenge, trích xuất sự kiện.
 * Chạy:  node test/facebook.test.mjs
 */

import { computeSignatureForTest, verifySignature, handleChallenge, extractMessages } from '../src/channels/facebook.js';

let pass = 0;
let fail = 0;

function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✔ ${name}`); }
  else { fail++; console.log(`  ✖ ${name} ${extra}`); }
}

function section(t) { console.log(`\n=== ${t} ===`); }

const APP_SECRET = 'test-app-secret-123';

section('Chữ ký HMAC-SHA256');
{
  const body = JSON.stringify({ object: 'page', entry: [] });
  const sig = await computeSignatureForTest(body, APP_SECRET);
  check('định dạng sha256=...', sig.startsWith('sha256='), sig);
  check('chiều dài hợp lệ (64 hex)', /^sha256=[0-9a-f]{64}$/.test(sig), sig);

  const ok = await verifySignature(body, sig, APP_SECRET);
  check('chữ ký đúng -> hợp lệ', ok === true);

  const bad = await verifySignature(body, 'sha256=' + '0'.repeat(64), APP_SECRET);
  check('chữ ký sai -> từ chối', bad === false);

  const tampered = await verifySignature(body + 'x', sig, APP_SECRET);
  check('body bị sửa -> từ chối', tampered === false);

  const noSecret = await verifySignature(body, sig, '');
  check('không có appSecret -> bỏ qua kiểm tra', noSecret === true);

  const noHeader = await verifySignature(body, null, APP_SECRET);
  check('thiếu header -> từ chối', noHeader === false);
}

section('Meta webhook challenge (GET)');
{
  const mk = (q) => new URL('https://example.workers.dev/webhook/facebook' + q);

  const good = handleChallenge(mk('?hub.mode=subscribe&hub.verify_token=demo-token&hub.challenge=12345'), 'demo-token');
  check('token đúng -> trả 200 challenge', good.status === 200, String(good.status));

  const wrongToken = handleChallenge(mk('?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345'), 'demo-token');
  check('token sai -> 403', wrongToken.status === 403, String(wrongToken.status));

  const wrongMode = handleChallenge(mk('?hub.mode=unsubscribe&hub.verify_token=demo-token&hub.challenge=1'), 'demo-token');
  check('mode sai -> 403', wrongMode.status === 403, String(wrongMode.status));
}

section('Trích xuất sự kiện message');
{
  const payload = {
    object: 'page',
    entry: [
      {
        messaging: [
          { sender: { id: 'USER1' }, message: { mid: 'm1', text: 'đăng ký kết hôn' } },
          { sender: { id: 'USER2' }, message: { mid: 'm2', text: 'cấp hộ khẩu' } },
        ],
      },
    ],
  };
  const msgs = extractMessages(payload);
  check('lấy đủ 2 tin', msgs.length === 2, String(msgs.length));
  check('giữ senderId', msgs[0].senderId === 'USER1');
  check('giữ nội dung', msgs[1].text === 'cấp hộ khẩu');
  check('không phải echo', msgs.every((m) => !m.isEcho));

  const echoPayload = {
    object: 'page',
    entry: [{ messaging: [{ sender: { id: 'PAGE' }, message: { mid: 'm3', text: 'x', is_echo: true } }] }],
  };
  const em = extractMessages(echoPayload);
  check('nhận diện echo', em[0].isEcho === true);

  const empty = extractMessages({ object: 'page', entry: [] });
  check('payload rỗng -> không có tin', empty.length === 0);

  const attachmentOnly = extractMessages({
    object: 'page',
    entry: [{ messaging: [{ sender: { id: 'U' }, message: { mid: 'm', attachments: [] } }] }],
  });
  check('tin chỉ có ảnh -> bỏ qua', attachmentOnly.length === 0);
}

console.log(`\n${'='.repeat(46)}`);
console.log(`KẾT QUẢ: ${pass} đạt, ${fail} lỗi`);
console.log('='.repeat(46));
process.exit(fail ? 1 : 0);
