/**
 * Quản lý đăng nhập admin — tài khoản, mật khẩu, phiên đăng nhập.
 *
 * BẢO MẬT:
 *   - Mật khẩu KHÔNG lưu dạng rõ. Lưu PBKDF2-HMAC-SHA256 hash + salt ngẫu nhiên.
 *   - Phiên đăng nhập là cookie HttpOnly ký HMAC-SHA256 -> kẻ đánh cắp
 *     cookie cũng không dùng được (và không đọc được bằng JavaScript).
 *   - So sánh chuỗi bằng hàm constant-time để chống timing attack.
 *
 * VÌ SAO CẦN:
 * Trước đây admin panel dùng Bearer token = mật khẩu thô, và JS giữ
 * token trong bộ nhớ -> mỗi lần mở trang phải nhập lại. Nay dùng
 * tài khoản + cookie phiên 30 ngày.
 */

const SESSION_COOKIE = 'xl_admin_session';
const SESSION_TTL_SECONDS = 30 * 24 * 3600; // 30 ngày
const PBKDF2_ITERATIONS = 100000;

/* ----------------------------- tiện ích ----------------------------- */

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

/** So sánh 2 chuỗi constant-time (tránh rò rỉ qua thời gian). */
export function timingSafeEqual(a, b) {
  const sa = String(a || '');
  const sb = String(b || '');
  if (sa.length !== sb.length) return false;
  let diff = 0;
  for (let i = 0; i < sa.length; i++) diff |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
  return diff === 0;
}

/** Sinh salt ngẫu nhiên (16 byte -> 32 ký tự hex). */
export function makeSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/** Hash mật khẩu bằng PBKDF2-HMAC-SHA256. */
export async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(password || '')),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromHex(salt), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    256
  );
  return toHex(bits);
}

/** Kiểm tra mật khẩu có khớp hash không. */
export async function verifyPassword(password, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  const h = await hashPassword(password, salt);
  return timingSafeEqual(h, expectedHash);
}

/* --------------------------- phiên đăng nhập --------------------------- */

/** Khóa ký cookie: dùng ADMIN_PASSWORD làm bí mật. */
async function sessionKey(env) {
  const secret = env.ADMIN_PASSWORD || env.SESSION_SECRET || 'xuanlang-default-secret';
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

/**
 * Tạo token phiên: base64url(payload).base64url(HMAC).
 * payload = { u: username, exp: hết hạn (giây) }
 */
export async function createSessionToken(env, username, ttlSeconds = SESSION_TTL_SECONDS) {
  const payload = { u: username, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const body = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const key = await sessionKey(env);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return `${body}.${toHex(sig)}`;
}

/** Kiểm tra token phiên có hợp lệ không. Trả về username hoặc null. */
export async function verifySessionToken(env, token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  try {
    const key = await sessionKey(env);
    const expected = toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
    if (!timingSafeEqual(expected, sig)) return null;
    const payload = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')));
    if (!payload?.u) return null;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.u;
  } catch (_) {
    return null;
  }
}

/** Đọc cookie phiên từ request. */
export function readSessionCookie(request) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === SESSION_COOKIE) return decodeURIComponent(v.join('='));
  }
  return null;
}

/** Tạo header Set-Cookie cho phiên đăng nhập. */
export function sessionCookieHeader(token, { secure = true } = {}) {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/** Header xoá cookie (đăng xuất). */
export function clearSessionCookieHeader({ secure = true } = {}) {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/* -------------------------- truy cập D1 -------------------------- */

/**
 * Lấy tài khoản theo username.
 * Trả về null nếu không tồn tại hoặc đã bị vô hiệu hoá.
 */
export async function getUser(db, username) {
  if (!db) return null;
  const res = await db
    .prepare('SELECT * FROM admin_users WHERE username = ? LIMIT 1')
    .bind(String(username || '').trim())
    .first();
  if (!res || !res.active) return null;
  return res;
}

/** Danh sách tài khoản (không kèm hash) — dùng cho admin panel. */
export async function listUsers(db) {
  if (!db) return [];
  const res = await db
    .prepare(
      `SELECT id, username, display_name, role, is_default, active, last_login_at, created_at
       FROM admin_users ORDER BY id ASC`
    )
    .all();
  return res?.results || [];
}

/**
 * Đăng nhập: kiểm tra username + mật khẩu.
 * Trả về { ok: true, user } hoặc { ok: false, error }.
 */
export async function login(db, username, password) {
  const u = String(username || '').trim();
  const p = String(password || '');
  if (!u || !p) return { ok: false, error: 'Vui lòng nhập tài khoản và mật khẩu' };

  const user = await getUser(db, u);
  if (!user) return { ok: false, error: 'Tài khoản hoặc mật khẩu không đúng' };

  const good = await verifyPassword(p, user.salt, user.password_hash);
  if (!good) return { ok: false, error: 'Tài khoản hoặc mật khẩu không đúng' };

  try {
    await db
      .prepare("UPDATE admin_users SET last_login_at = datetime('now') WHERE id = ?")
      .bind(user.id)
      .run();
  } catch (_) { /* không ghi được cũng không sao */ }

  return { ok: true, user };
}

/**
 * Tạo mới tài khoản (mật khẩu được hash trước khi lưu).
 */
export async function createUser(db, { username, password, displayName = '', role = 'admin' }) {
  const u = String(username || '').trim();
  if (!u) return { ok: false, error: 'Thiếu tên tài khoản' };
  if (String(password || '').length < 6) return { ok: false, error: 'Mật khẩu phải có ít nhất 6 ký tự' };

  if (await getUser(db, u)) return { ok: false, error: `Tài khoản "${u}" đã tồn tại` };

  const salt = makeSalt();
  const hash = await hashPassword(password, salt);
  try {
    await db
      .prepare(
        `INSERT INTO admin_users (username, display_name, password_hash, salt, role, is_default)
         VALUES (?, ?, ?, ?, ?, 0)`
      )
      .bind(u, displayName || '', hash, salt, role || 'admin')
      .run();
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
  return { ok: true, username: u };
}

/** Đổi mật khẩu của một tài khoản. */
export async function changePassword(db, username, newPassword) {
  if (String(newPassword || '').length < 6) return { ok: false, error: 'Mật khẩu phải có ít nhất 6 ký tự' };
  const user = await getUser(db, username);
  if (!user) return { ok: false, error: 'Không tìm thấy tài khoản' };

  const salt = makeSalt();
  const hash = await hashPassword(newPassword, salt);
  await db
    .prepare("UPDATE admin_users SET password_hash = ?, salt = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(hash, salt, user.id)
    .run();
  return { ok: true };
}

/**
 * Tạo tài khoản dự phòng từ ADMIN_PASSWORD nếu chưa có tài khoản nào.
 *
 * VÌ SAO CẦN:
 * Nếu chỉ dùng tài khoản trong D1 mà DB bị xoá nhầm -> mất quyền truy cập
 * hoàn toàn. Giữ lại ADMIN_PASSWORD làm "chìa khoá dự phòng" để luôn có
 * đường vào.
 */
export async function ensureDefaultUser(db, env) {
  if (!db) return null;
  const existing = await listUsers(db);
  if (existing.length) return existing[0];

  const pwd = env.ADMIN_PASSWORD || '';
  if (!pwd) return null;
  const salt = makeSalt();
  const hash = await hashPassword(pwd, salt);
  try {
    await db
      .prepare(
        `INSERT INTO admin_users (username, display_name, password_hash, salt, role, is_default)
         VALUES (?, ?, ?, ?, 'admin', 1)`
      )
      .bind('admin', 'Quản trị viên', hash, salt)
      .run();
  } catch (_) { /* đã tồn tại -> không sao */ }
  return { username: 'admin' };
}

export { SESSION_COOKIE, SESSION_TTL_SECONDS };
