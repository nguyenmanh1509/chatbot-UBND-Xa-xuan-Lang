-- Cột phụ trợ tìm kiếm: tên thủ tục bỏ dấu.
--
-- VÌ SAO CẦN: người dân gõ "ho khau" (không dấu) rất thường xuyên, còn tên
-- thủ tục trong Cổng DVC luôn có dấu ("hộ khẩu"). SQLite không có hàm
-- unaccent sẵn, nên phải lưu sẵn một bản bỏ dấu để tìm kiếm LIKE.
--
-- Giá trị được app tự động ghi khi insert/update (hàm stripAccents trong
-- src/core/procedures.js). Cột này KHÔNG dùng để hiển thị.

ALTER TABLE procedures ADD COLUMN name_noaccent TEXT;

-- Backfill cho các dòng đã có sẵn (nếu có).
UPDATE procedures
SET name_noaccent = lower(name_noaccent)
WHERE name_noaccent IS NULL;

CREATE INDEX IF NOT EXISTS idx_procedures_name_noaccent ON procedures(name_noaccent);
