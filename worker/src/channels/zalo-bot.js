/**
 * Adapter Zalo Bot Platform (gói Basic miễn phí).
 *
 * Tạo bot: mở app Zalo -> tìm "Zalo OA Zalo Bot Manager" -> Tạo bot -> nhận Bot Token.
 * Token dạng "12345689:abc-xyz", KHÔNG hết hạn (trừ khi admin tự reset).
 *
 * Webhook: POST /webhook với header "X-Bot-Api-Secret-Token".
 * Gửi tin: POST https://bot-api.zaloplatforms.com/bot${BOT_TOKEN}/sendMessage
 */

const BOT_API = 'https://bot-api.zaloplatforms.com';

/** Xác thực header secret token. */
export function verifySecret(header, expected) {
  if (!expected) return true;
  return header === expected;
}

/** Trích xuất sự kiện message.text.received từ payload webhook. */
export function extractMessages(payload) {
  const out = [];
  if (payload?.event_name === 'message.text.received' && payload?.message?.text) {
    out.push({
      chatId: payload.message.chat?.id,
      senderId: payload.message.from?.id,
      displayName: payload.message.from?.display_name,
      text: payload.message.text,
      messageId: payload.message.message_id,
    });
  }
  return out;
}

/**
 * Gửi tin nhắn.
 * Hỗ trợ markdown (in đậm, list, màu) qua parse_mode.
 */
export async function sendMessage(cfg, { chatId, text, parseMode = 'markdown' }) {
  const url = `${BOT_API}/bot${cfg.botToken}/sendMessage`;
  const body = { chat_id: chatId, text };
  if (parseMode) body.parse_mode = parseMode;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Zalo Bot send failed (${res.status}): ${t}`);
  }
  return res.json();
}

/** Gửi nhiều tin (giới hạn 2000 ký tự/tin). */
export async function sendMessages(cfg, chatId, messages) {
  const sent = [];
  for (const m of messages) {
    if (!m || !m.trim()) continue;
    await sendMessage(cfg, { chatId, text: m });
    sent.push(m);
    if (messages.length > 1) await new Promise((r) => setTimeout(r, 300));
  }
  return sent;
}

/** Đăng ký webhook cho bot (gọi 1 lần khi deploy hoặc đổi URL). */
export async function setWebhook(cfg, url) {
  const res = await fetch(`${BOT_API}/bot${cfg.botToken}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, secret_token: cfg.secretToken }),
  });
  return res.json();
}

/** Kiểm tra webhook đã đăng ký chưa. */
export async function getWebhookInfo(cfg) {
  const res = await fetch(`${BOT_API}/bot${cfg.botToken}/getWebhookInfo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  return res.json();
}
