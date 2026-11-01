-- Tài khoản quản trị.
--
-- Mật khẩu KHÔNG lưu dạng rõ — chỉ lưu PBKDF2 hash + salt.
-- (worker/src/core/auth.js xử lý hash/verify)
--
-- `is_default` = 1 nghĩa là tài khoản dự phòng tạo từ ADMIN_PASSWORD.
-- Tài khoản này được giữ lại để không bao giờ bị mất quyền truy cập.

CREATE TABLE IF NOT EXISTS admin_users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  display_name  TEXT,
  password_hash TEXT    NOT NULL,
  salt          TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'admin',  -- admin | editor | viewer
  is_default    INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_admin_users_username ON admin_users(username);
