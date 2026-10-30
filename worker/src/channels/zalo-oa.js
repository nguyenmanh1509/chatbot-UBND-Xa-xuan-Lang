/**
 * Adapter Zalo OA OpenAPI.
 *
 * LƯU Ý QUAN TRỌNG: OpenAPI chỉ khả dụng với OA dùng gói "Tăng trưởng" hoặc "Toàn diện".
 * Gói Cơ bản (miễn phí) KHÔNG có OpenAPI.
 *
 * Webhook: POST với header "X-ZEvent-Signature: mac=sha256(appId + data + timeStamp + OAsecretKey)"
 * Gửi tin: POST https://openapi.zalo.me/v2.0/oa/message với recipient.message_id (từ webhook)
 *          -> tối đa 8 lệnh phản hồi trong 48h; lệnh thứ 9 trở đi bị tính phí.
 */

const ZALO_API = 'https://openapi.zalo.me/v2.0/oa';

/** Tính chữ ký webhook của Zalo. */
export async function computeSignature(appId, data, timestamp, secretKey) {
  const raw = appId + data + timestamp + secretKey;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return 'mac=' + [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Xác thực chữ ký webhook. */
export async function verifySignature(header, appId, data, timestamp, secretKey) {
  if (!secretKey) return true;
  if (!header) return false;
  const expected = await computeSignature(appId, data, timestamp, secretKey);
  return header === expected;
}

/** Trích xuất sự kiện người dùng gửi tin nhắn. */
export function extractMessages(payload) {
  const out = [];
  const name = payload?.event_name || '';
  const isUserText = name === 'user_send_text' || name === 'anonymous_send_text';
  if (isUserText && payload?.message?.text) {
    out.push({
      senderId: payload.sender?.id,
      chatId: payload.message?.conversation_id || payload.sender?.id,
      text: payload.message.text,
      messageId: payload.message.msg_id,
      // OA reply API cần message_id của tin nhắn gốc
      replyMessageId: payload.message.msg_id,
      userId: payload.user_id_by_app,
    });
  }
  return out;
}

/**
 * Gửi tin trả lời (reply) — dùng message_id của tin nhắn gốc để nằm trong khung 48h miễn phí.
 */
export async function sendMessage(cfg, { messageId, text }) {
  const res = await fetch(`${ZALO_API}/message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      access_token: cfg.accessToken,
    },
    body: JSON.stringify({
      recipient: { message_id: messageId },
      message: { text },
    }),
  });
  const body = await res.json();
  if (!res.ok || body.error !== 0) {
    throw new Error(`Zalo OA send failed: ${JSON.stringify(body).slice(0, 300)}`);
  }
  return body;
}

/** Gửi nhiều tin (mỗi tin <= 2000 ký tự, tối đa 8 lệnh phản hồi/48h). */
export async function sendMessages(cfg, messageId, messages) {
  const sent = [];
  for (const m of messages) {
    if (!m || !m.trim()) continue;
    await sendMessage(cfg, { messageId, text: m });
    sent.push(m);
    if (messages.length > 1) await new Promise((r) => setTimeout(r, 400));
  }
  return sent;
}

/** Gửi tin chủ động (tính phí nếu ngoài 48h) — dùng để gửi thông báo. */
export async function sendProactive(cfg, { userId, text }) {
  const res = await fetch(`${ZALO_API}/message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      access_token: cfg.accessToken,
    },
    body: JSON.stringify({
      recipient: { user_id: userId },
      message: { text },
    }),
  });
  return res.json();
}

/**
 * Làm mới access token bằng refresh token.
 * Bắt buộc phải có tác vụ định kỳ, nếu không "thứ Hai chatbot chết".
 */
export async function refreshAccessToken(cfg) {
  const url =
    'https://oauth.zaloapp.com/v4/oauth/access_token' +
    `?refresh_token=${encodeURIComponent(cfg.refreshToken)}` +
    `&secret_key=${encodeURIComponent(cfg.secretKey)}` +
    '&grant_type=refresh_token';

  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) throw new Error(`refresh failed (${res.status}): ${await res.text()}`);
  return res.json();
}
