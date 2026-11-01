#!/usr/bin/env node
/**
 * Cấu hình Messenger cho Page: nút "Bắt đầu" (Get Started) + câu hỏi gợi ý
 * (ice breakers).
 *
 * VÌ SAO CẦN SCRIPT NÀY:
 * Khi người dân bấm nút "Nhắn tin" (Message) trên trang Facebook của UBND,
 * Meta mở cửa sổ Messenger. Nếu Page CHƯA có "Get Started" button, cửa sổ
 * đó trống trơn -> người dân thấy bot "chết" và không ai nhắn được.
 *
 * Cấu hình ở đây tạo ra:
 *   - Nút "Bắt đầu" (Get Started) -> Meta gửi postback `GET_STARTED` về
 *     webhook -> bot tự gửi lời chào + nút bấm nhanh.
 *   - Ice breakers -> hiện ngay trên màn hình mở chat, bấm là gửi tin
 *     luôn (mỗi lượt trả lời đều có nút bấm nhanh).
 *
 * CÁCH DÙNG:
 *   node scripts/facebook-greeting.mjs
 *
 * Mặc định lấy PAGE_ACCESS_TOKEN + PAGE_ID từ `.env` / `.dev.vars`.
 * Ghi đè bằng:
 *   node scripts/facebook-greeting.mjs --token "EAA..." --page-id 123
 *
 * LƯU Ý: Page Access Token (token tạo ở Messenger → Settings → Generate token)
 * là ĐỦ để cài 2 mục này. Nếu Meta báo lỗi quyền, dùng USER TOKEN của tài
 * khoản quản trị Page (token này chỉ dùng 1 lần để cài, xong thu hồi được).
 */

import { readFileSync } from 'fs';

const GRAPH = 'https://graph.facebook.com/v26.0';

function readEnvFiles() {
  const env = {};
  for (const f of ['.env', '.dev.vars']) {
    let raw;
    try {
      raw = readFileSync(f, 'utf8');
    } catch (_) {
      continue;
    }
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2];
    }
  }
  return env;
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
}

async function post(path, body, token) {
  const url = `${GRAPH}${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, j: await res.json() };
}

const env = readEnvFiles();
const PAGE_ID = arg('page-id') || env.FB_PAGE_ID;
const TOKEN = arg('token') || env.FB_PAGE_ACCESS_TOKEN;

if (!PAGE_ID) {
  console.error('❌ Thiếu Page ID. Truyền --page-id <id> hoặc đặt FB_PAGE_ID trong .env');
  process.exit(1);
}
if (!TOKEN) {
  console.error('❌ Thiếu token. Truyền --token <token> hoặc đặt FB_PAGE_ACCESS_TOKEN trong .env');
  process.exit(1);
}

console.log(`Page: ${PAGE_ID}`);

// 1) Nút "Bắt đầu" -> postback GET_STARTED -> bot chào ngay.
const getStarted = await post(
  `/${PAGE_ID}/messenger_profile`,
  { get_started: { payload: 'GET_STARTED' } },
  TOKEN
);
console.log('\n[get_started]', JSON.stringify(getStarted.j));

// 2) Ice breakers: câu hỏi gợi ý hiện ngay trên màn hình mở chat.
const iceBreakers = await post(
  `/${PAGE_ID}/messenger_profile`,
  {
    ice_breakers: [
      { question: 'Hộ khẩu', payload: 'Hộ khẩu' },
      { question: 'Đăng ký kết hôn', payload: 'Đăng ký kết hôn' },
      { question: 'Chứng nhận sinh trẻ', payload: 'Chứng nhận sinh trẻ' },
      { question: 'Đăng ký xe máy', payload: 'Đăng ký xe máy' },
    ],
  },
  TOKEN
);
console.log('[ice_breakers]', JSON.stringify(iceBreakers.j));

if (getStarted.ok && iceBreakers.ok) {
  console.log('\n✅ Đã cài nút "Bắt đầu" + câu hỏi gợi ý cho Page.');
  console.log('   Thử lại: mở trang Page → bấm "Nhắn tin" → phải thấy nút "Bắt đầu"');
  console.log('   và 4 câu gợi ý.');
  console.log('');
  console.log('ℹ️  LỜI CHÀO MỞ CHAT: Meta KHÔNG cho cài bằng API nữa.');
  console.log('   (messenger_profile đã bỏ hỗ trợ tham số `greeting` từ 2024.)');
  console.log('   Muốn hiện lời chào khi mở chat, set tay tại:');
  console.log('   Meta Business Suite → Inbox → Messenger → Greeting');
  console.log('');
  console.log('   Nhưng KHÔNG BẮT BUỘC: bot đã tự chào ở tin nhắn đầu tiên của');
  console.log('   mỗi người dùng (xem worker/src/core/conversation.js).');
} else {
  console.error('\n❌ Cài đặt chưa thành công.');
  console.error('   Nếu báo "User does not have sufficient administrative permission",');
  console.error('   dùng USER TOKEN của tài khoản quản trị Page:');
  console.error('   node scripts/facebook-greeting.mjs --token "<user token>"');
  process.exit(1);
}
