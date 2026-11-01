-- Thêm cột `name_pad` = tên không dấu, có khoảng trắng bao quanh.
--
-- VÌ SAO CẦN: SQL LIKE '%dai%' khớp SUBSTRING, nên câu hỏi "giấy chứng
-- nhận đất đai" khớp cả "đại lý", "xét tuyển", "thay đổi"... -> kéo về
-- hàng trăm thủ tục không liên quan. Với ' name_pad ' nối khoảng trắng,
-- LIKE '% dat dai %' chỉ khớp đúng CỤM TỪ.
--
-- Giá trị NULL cho dòng cũ -> dùng COALESCE khi đọc (tương thích ngược).
ALTER TABLE procedures ADD COLUMN name_pad TEXT;

UPDATE procedures
SET name_pad = ' ' || LOWER(COALESCE(name_noaccent, name)) || ' '
WHERE name_pad IS NULL;

CREATE INDEX IF NOT EXISTS idx_procedures_name_pad ON procedures(name_pad);
