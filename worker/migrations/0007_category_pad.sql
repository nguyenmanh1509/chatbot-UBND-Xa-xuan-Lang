-- Thêm cột `category_pad` = lĩnh vực không dấu, có khoảng trắng bao quanh.
--
-- VÌ SAO CẦN: `category` lưu có dấu ("Đất đai"). SQLite LOWER() không
-- bỏ dấu, nên LIKE '%dat dai%' không khớp. Cột `category_pad` giữ bản
-- không dấu để so khớp cụm từ chính xác, giống `name_pad`.
--
-- Giá trị được điền bởi script scripts/backfill-pad.mjs (vì cần bỏ dấu
-- tiếng Việt — SQLite không có hàm unaccent).
ALTER TABLE procedures ADD COLUMN category_pad TEXT;

CREATE INDEX IF NOT EXISTS idx_procedures_category_pad ON procedures(category_pad);
