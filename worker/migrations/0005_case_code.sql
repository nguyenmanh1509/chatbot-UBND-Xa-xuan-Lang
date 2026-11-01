-- Bổ sung `case_code` (mã trường hợp hành chính) và sửa khoá chống trùng.
--
-- VÌ SAO CẦN: nhiều thủ tục trên Cổng DVC có CÙNG procedure_id nhưng khác
-- case_code (các trường hợp hành chính khác nhau của một thủ tục).
-- Ví dụ procedure_id 019d2bfd-dc54... có 10 dòng, mã thủ tục đều 1.005160
-- nhưng case_code lần lượt là .01, .02, ... .10.
--
-- Nếu khoá chỉ theo dvc_id -> 63 nhóm bị gộp làm 1 -> mất 125 dòng.
-- Khoá đúng là (dvc_id, case_code).

ALTER TABLE procedures ADD COLUMN case_code TEXT;

-- Tạm thời bỏ khoá cũ (dvc_id) để tạo khoá mới.
DROP INDEX IF EXISTS idx_procedures_dvc_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_procedures_dvc_case
  ON procedures(dvc_id, case_code);

-- Lấp các dòng bị thiếu case_code trước đây (import cũ).
UPDATE procedures SET case_code = '' WHERE case_code IS NULL;
