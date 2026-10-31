/**
 * Adapter Facebook Messenger Platform.
 *
 * Luồng:
 *   1. Meta GET /webhook?hub.challenge=...  -> trả hub.challenge để xác minh
 *   2. Meta POST /webhook                 -> sự kiện messages, verify X-Hub-Signature-256
 *   3. Gửi trả lời: POST /v26.0/{PAGE_ID}/messages?access_token=...
 *
 * Ghi chú chi phí: gửi tin trong cửa sổ 24h sau khi người dùng nhắn là MIỄN PHÍ.
 */

const API_VERSION = 'v26.0';

/** So sánh chuỗi hằng số thời gian (tránh timing attack). */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Tính X-Hub-Signature-256 (HMAC-SHA256 trên raw body). */
export async function computeSignature(rawBody, appSecret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  return 'sha256=' + [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Bản export để test. */
export const computeSignatureForTest = computeSignature;

/** Xác thực chữ ký webhook. Trả về true nếu hợp lệ (hoặc không bắt buộc nếu chưa đặt appSecret). */
export async function verifySignature(rawBody, header, appSecret) {
  if (!appSecret) return true; // admin chưa cấu hình appSecret -> bỏ qua (chỉ nên dùng cho test)
  if (!header) return false;
  const expected = await computeSignature(rawBody, appSecret);
  return timingSafeEqual(expected, header);
}

/** Xử lý GET challenge của Meta. */
export function handleChallenge(url, verifyToken) {
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  if (mode === 'subscribe' && token && token === verifyToken && challenge) {
    return new Response(challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
  return new Response('Forbidden', { status: 403 });
}

/**
 * Gửi tin nhắn qua Graph API.
 *
 * `quickReplies` (tuỳ chọn): danh sách nút bấm được hiện dưới tin nhắn.
 * Messenger GIỚI HẠN 13 quick reply, tiêu đề tối đa 20 ký tự.
 *
 * LƯU Ý về định dạng: ô text của Messenger hiển thị TEXT THUẦN.
 * Thẻ HTML (<b>, <a href>) sẽ bị lộ nguyên ra màn hình -> KHÔNG dùng.
 * Muốn link bấm được thì để URL TRẦN, Messenger tự nhận diện (giống
 * số điện thoại). Quick replies là cách DUY NHẤT để mã thủ tục bấm được.
 */
export async function sendMessage(cfg, { recipientId, text, quickReplies = [] }) {
  const url = `https://graph.facebook.com/${API_VERSION}/${cfg.pageId}/messages?access_token=${encodeURIComponent(
    cfg.pageAccessToken
  )}`;

  const message = { text };
  if (Array.isArray(quickReplies) && quickReplies.length) {
    // Giới hạn theo Messenger: tối đa 13 quick reply.
    message.quick_replies = quickReplies.slice(0, 13).map((q) => ({
      content_type: 'text',
      title: String(q.title || '').slice(0, 20),
      payload: String(q.payload || q.title || '').slice(0, 1000),
    }));
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message,
      messaging_type: 'RESPONSE',
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Facebook send failed (${res.status}): ${body}`);
  }
  return res.json();
}

/**
 * Gửi nhiều tin (khi câu trả lời dài) — giới hạn 2000 ký tự/tin.
 *
 * `quickReplies` chỉ gắn vào tin ĐẦU TIÊN (Messenger chỉ hiển thị nút
 * bấm dưới tin mới nhất, nên gắn vào tin cuối cũng không hiện).
 */
export async function sendMessages(cfg, recipientId, messages, quickReplies = []) {
  const sent = [];
  let first = true;
  for (const m of messages) {
    if (!m || !m.trim()) continue;
    await sendMessage(cfg, {
      recipientId,
      text: m,
      quickReplies: first ? quickReplies : [],
    });
    sent.push(m);
    first = false;
    // Nghỉ nhẹ giữa các tin để không chạm rate limit
    if (messages.length > 1) await new Promise((r) => setTimeout(r, 300));
  }
  return sent;
}

/** Trích xuất sự kiện message từ payload webhook. */
export function extractMessages(payload) {
  const out = [];
  for (const entry of payload.entry || []) {
    for (const messaging of entry.messaging || []) {
      if (messaging.message?.text) {
        out.push({
          senderId: messaging.sender?.id,
          text: messaging.message.text,
          messageId: messaging.message.mid,
          isEcho: Boolean(messaging.message.is_echo),
          // Người dùng bấm quick reply -> Messenger gửi payload (mã thủ tục)
          // kèm text hiển thị. Ưu tiên payload vì đó là mã chính xác.
          quickReplyPayload: messaging.message.quick_reply?.payload || null,
        });
      }
    }
  }
  return out;
}
