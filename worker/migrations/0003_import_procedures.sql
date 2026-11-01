-- Mở rộng bảng `procedures` để hỗ trợ yêu cầu "lấy all thủ tục của xã
-- Xuân Lãng từ Cổng DVC rồi gán thủ tục cho các chuyên viên phù hợp".
--
-- Trước đây bảng chỉ chứa thủ tục do admin TAY khai báo (vài chục dòng).
-- Nay cần lưu được ~3.544 thủ tục áp dụng tại xã (lấy từ gateway DVC),
-- nên thêm:
--
--   dvc_id      : procedure_id của Cổng DVC (UUID) -> dùng làm khoá chống trùng
--   level       : mức độ áp dụng tại xã (FULL / PARTIAL / ALL)
--   category    : lĩnh vực
--   agency      : cơ quan ban hành
--   portal_url  : link thủ tục trên dichvucong.gov.vn
--   citizen_url : link nộp trực tuyến tại địa bàn
--   summary     : tóm tắt thủ tục (dùng cho câu trả lời ngắn)
--   source      : 'manual' (admin tự nhập) | 'dvc' (import từ Cổng DVC)
--   assigned    : 1 = đã gán chuyên viên phụ trách
--
-- UNIQUE(dvc_id) cho phép chạy lại import nhiều lần mà không nhân bản.

ALTER TABLE procedures ADD COLUMN dvc_id      TEXT;
ALTER TABLE procedures ADD COLUMN level       TEXT;
ALTER TABLE procedures ADD COLUMN category    TEXT;
ALTER TABLE procedures ADD COLUMN agency      TEXT;
ALTER TABLE procedures ADD COLUMN citizen_url TEXT;
ALTER TABLE procedures ADD COLUMN summary     TEXT;
ALTER TABLE procedures ADD COLUMN source      TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE procedures ADD COLUMN assigned    INTEGER NOT NULL DEFAULT 0;

-- Chống trùng khi import lại từ Cổng DVC.
CREATE UNIQUE INDEX IF NOT EXISTS idx_procedures_dvc_id ON procedures(dvc_id);

-- Tìm nhanh thủ tục đã gán chuyên viên (bot dùng bảng này để trả lời).
CREATE INDEX IF NOT EXISTS idx_procedures_assigned ON procedures(assigned);

-- Tìm theo mã thủ tục (bot tra cứu chi tiết theo mã người dân gõ).
CREATE INDEX IF NOT EXISTS idx_procedures_code_active ON procedures(code, active);

-- Tìm theo lĩnh vực (admin lọc nhanh khi gán chuyên viên).
CREATE INDEX IF NOT EXISTS idx_procedures_category ON procedures(category);
