-- Thủ tục riêng do UBND xã Xuân Lãng tự khai báo.
--
-- Mỗi thủ tục có:
--   name         : tên thủ tục (bắt buộc)
--   officer      : đồng chí phụ trách (CÓ THỂ để trống)
--   desk         : bàn số (CÓ THỂ để trống)
--   phone        : số điện thoại (CÓ THỂ để trống)
--   office_hours : giờ làm việc (CÓ THỂ để trống)
--   code         : mã thủ tục trên Cổng DVC Quốc gia (để liên kết dữ liệu gốc)
--   keywords     : từ khoá để bot tìm thủ tục này khi người dân hỏi
--   description  : mô tả thêm (CÓ THỂ để trống)
--   docs_url     : link tài liệu/hướng dẫn (CÓ THỂ để trống)
--   portal_url   : link Cổng DVC Quốc gia (CÓ THỂ để trống)
--   active       : còn hiệu lực hay không
--
-- Các cột "CÓ THỂ để trống" đều NULL được, khi hiển thị ra bot sẽ bỏ qua
-- dòng đó (không in ra "không có" hay dấu chấm trống).

CREATE TABLE IF NOT EXISTS procedures (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  code          TEXT,
  officer       TEXT,
  desk          TEXT,
  phone         TEXT,
  office_hours  TEXT,
  keywords      TEXT,
  description   TEXT,
  docs_url      TEXT,
  portal_url    TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Tra cứu nhanh theo tên/mã thủ tục
CREATE INDEX IF NOT EXISTS idx_procedures_name ON procedures(name);
CREATE INDEX IF NOT EXISTS idx_procedures_code ON procedures(code);
CREATE INDEX IF NOT EXISTS idx_procedures_active ON procedures(active);
