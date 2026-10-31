/**
 * Định dạng nội dung tin nhắn theo từng kênh.
 *
 * Bối cảnh: cùng một nội dung được gửi tới Web / Facebook / Zalo, mỗi kênh
 * hiển thị khác nhau:
 *   - Web (chat.html): hỗ trợ Markdown cơ bản -> HTML <a>, <strong>
 *   - Facebook Messenger: hỗ trợ <a href>, <b>, <i>, <br> (KHÔNG hỗ trợ Markdown)
 *   - Zalo Bot / OA: nên dùng text thuần (URL tự động bấm được)
 *
 * Vì vậy nội dung trung gian luôn viết bằng Markdown rút gọn:
 *   *đậm*          -> in đậm
 *   [nhãn](url)    -> liên kết
 * rồi hàm ở đây chuyển sang định dạng đúng cho từng kênh.
 */

/** Chuyển Markdown rút gọn -> text thuần (bỏ ký hiệu, giữ nội dung). */
export function toPlain(text) {
  return String(text || '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1');
}

/** Chuyển sang HTML cho web widget. */
export function toHtml(text) {
  const escaped = String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return escaped
    // Liên kết [nhãn](url) -> <a>
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    // In đậm *đậm* -> <strong>
    .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
    // Xuống dòng -> <br>
    .replace(/\n/g, '<br>');
}

/**
 * Chuyển sang định dạng Messenger.
 *
 * Messenger chỉ hỗ trợ một tập thẻ HTML hạn chế: <a>, <b>, <i>, <br>...
 * Markdown `*đậm*` sẽ hiện ra nguyên dấu sao nên phải bỏ.
 */
export function toMessenger(text) {
  return String(text || '')
    // Liên kết [nhãn](url) -> <a href="url">nhãn</a>
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
    // In đậm *đậm* -> <b>đậm</b>
    .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
    // Gạch chân _gạch_ -> <i>gạch</i>
    .replace(/_([^_\n]+)_/g, '<i>$1</i>');
}

/**
 * Render nội dung theo kênh.
 * @param {string} text - nội dung Markdown rút gọn
 * @param {string} channel - 'web' | 'facebook' | 'zalo-bot' | 'zalo-oa' | ...
 */
export function renderForChannel(text, channel) {
  if (channel === 'facebook') return toMessenger(text);
  if (channel === 'web') return toHtml(text);
  // Zalo Bot nhận parse_mode=markdown -> giữ nguyên Markdown (hỗ trợ *đậm* và [link](url))
  if (channel === 'zalo-bot') return String(text || '').trim();
  // Zalo OA dùng text thuần -> bỏ ký hiệu Markdown, giữ URL để bấm được
  return toPlain(text);
}

/**
 * Tìm vị trí các liên kết trong text để web widget gắn sự kiện bấm.
 * Trả về [{ label, url }].
 */
export function extractLinks(text) {
  const out = [];
  const re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    out.push({ label: m[1], url: m[2] });
  }
  return out;
}
