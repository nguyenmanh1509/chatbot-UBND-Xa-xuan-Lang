# Trợ lý tra cứu thủ tục hành chính — xã Xuân Lãng

Chatbot web đơn trang (`index.html`) tra cứu thủ tục hành chính cho **xã Xuân Lãng, tỉnh Phú Thọ**, kết nối tới máy chủ dữ liệu công [`dichvucong.cloudgo.vn`](https://dichvucong.cloudgo.vn/#/docs).

## 1. Cách chạy

Vì đây là một file HTML tĩnh, không cần cài đặt gì:

```bash
# Mở trực tiếp trên máy (khuyến nghị dùng Chrome/Edge)
open /Users/nguyenmanh/Desktop/test/index.html

# Hoặc dùng server tĩnh nếu gặp vấn đề CORS
cd /Users/nguyenmanh/Desktop/test
python3 -m http.server 8080
# → mở http://localhost:8080
```

> ⚠️ **Lưu ý về CORS**: API `dichvucong.cloudgo.vn` kiểm tra `Origin` header. Mở file trực tiếp (`file://`) hoặc qua `localhost` đều chạy được nhờ server cho phép các origin phổ biến.

## 2. Tính năng chính

| # | Tính năng | Mô tả |
|---|-----------|--------|
| 1 | **Tra cứu tự nhiên** | Gõ câu tiếng Việt bình thường, ví dụ *"thủ tục đăng ký kết hôn tại xã Xuân Lãng"* — hệ thống tự tách địa bàn và tìm đúng thủ tục áp dụng. |
| 2 | **Tra cứu theo tên** | Gõ tên thủ tục bất kỳ (ví dụ *"đăng ký kết hôn"*) — search toàn quốc. |
| 3 | **Tra cứu theo mã** | Gõ mã thủ tục dạng `1.000894` để xem chi tiết. |
| 4 | **Lọc theo danh mục / cơ quan / tỉnh** | Qua chip hoặc lệnh `/danhmuc`, `/canquan`, `/tinhthanh`. |
| 5 | **Tìm phường/xã + xem procedures áp dụng** | `/timphuong Xuân Lãng` hoặc chip "Thủ tục tại xã Xuân Lãng". |
| 6 | **Tải biểu mẫu** | Trong khung chi tiết thủ tục, bấm "Tải biểu mẫu". |
| 7 | **Thống kê hệ thống** | Chip "Thống kê hệ thống" hoặc `/thongke`. |

## 3. Cách dùng nhanh

### 3.1 Cách 1 — Câu tự nhiên (khuyến nghị)

| Bạn gõ | Hệ thống làm | Bạn nhận |
|--------|--------------|----------|
| `đăng ký kết hôn` | search `q=đăng ký kết hôn` toàn quốc | 8 thủ tục liên quan |
| `thủ tục đăng ký kết hôn tại xã Xuân Lãng` | tách `ward="Xuân Lãng"` + `q="đăng ký kết hôn"` → gọi `/api/procedures?q=…&ward_code=H44.195` | 8 thủ tục kết hôn **áp dụng riêng tại xã Xuân Lãng** |
| `cấp giấy khai sinh ở phường Tân Bình` | tách ward "Tân Bình", gọi procedures có ward_code tương ứng | đúng thủ tục của phường Tân Bình |
| `thủ tục đất đai tại Hà Nội` | tách province "Hà Nội", dùng filter `province_code` | thủ tục đất đai áp dụng tại Hà Nội |

**Các từ khóa địa danh được nhận diện tự động**: `xã`, `phường`, `thị trấn`, `quận`, `huyện`, `thị xã`, `tỉnh`, `thành phố`, `tp`.

### 3.2 Cách 2 — Lệnh nhanh (gõ `/` ở đầu)

| Lệnh | Tác dụng |
|------|---------|
| `/danhmuc [từ khóa]` | Xem/tìm danh mục, lĩnh vực |
| `/canquan` | Danh sách cơ quan ban hành |
| `/tinhthanh` | Danh sách tỉnh/thành |
| `/nhom` | Danh sách nhóm dịch vụ |
| `/timphuong [từ khóa]` | Tìm phường/xã |
| `/phuong <mã>` | Chi tiết một phường/xã |
| `/phuongtoi` | Phường gắn với khóa tenant hiện tại |
| `/thongke` | Thống kê tổng hợp hệ thống |
| `/trogiup` | Hiện lại danh sách lệnh |

### 3.3 Chip tắt nhanh

Dưới ô chat có sẵn các nút tắt: *Kiểm tra kết nối*, *Tìm "đăng ký kết hôn"*, *Thủ tục tại xã Xuân Lãng*, *Kết hôn tại xã Xuân Lãng*, *Danh mục / lĩnh vực*, *Cơ quan ban hành*, *Tỉnh / thành*, *Nhóm dịch vụ*, *Phường của tôi (tenant)*, *Thống kê*, *Trợ giúp*.

## 4. Cách hoạt động bên trong

### 4.1 Pipeline xử lý câu tự nhiên

```
user_input = "thủ tục đăng ký kết hôn tại xã Xuân Lãng"
        │
        ▼
extractLocationAndKeyword()              ← tách địa danh + stopword
        │ { wardQuery: ["Xuân Lãng"], keyword: "đăng ký kết hôn" }
        ▼
resolveLocations(wardQuery)               ← gọi /api/wards?q=X
        │ ward = { code: "H44.195", name: "Xã Xuân Lãng", province: "tỉnh Phú Thọ" }
        ▼
/api/procedures?q=đăng+ký+kết+hôn&ward_code=H44.195      ← server lọc sẵn
        │ total: 8, items: [...]
        ▼
renderSearchResults() → bảng thẻ trong chat
```

### 4.2 Fallback khi query nhiều từ trả 0 kết quả

`searchWithFallback()` gọi `/api/procedures?q=<câu nguyên>` trước. Nếu `items.length === 0`, nó thử lần lượt bỏ từ cuối (vì từ cuối hay là "tại xã Y", "như thế nào"... gây nhiễu full-text search):

```
"đăng ký kết hôn tại xã Xuân Lãng"  → 0 kết quả → bỏ "Xuân Lãng" → ...
"đăng ký kết hôn tại xã"           → 0 kết quả → bỏ "xã"      → ...
"đăng ký kết hôn tại"              → 0 kết quả → bỏ "tại"     → ...
"đăng ký kết hôn"                  → 8 kết quả  ← dùng keyword này
```

## 5. Cấu hình (menu ⚙ *Cài đặt*)

| Trường | Mặc định | Ý nghĩa |
|--------|----------|---------|
| Base URL | `https://dichvucong.cloudgo.vn` | Đổi nếu deploy nội bộ |
| Chế độ gọi API | `gateway` (`/api`) | Có `rest` (`/rest/api`) nếu cần khóa |
| X-API-Key | trống | Chỉ cần khi dùng chế độ `rest` |
| Từ khóa tìm thủ tục | `q` | Tên tham số query cho `/api/procedures` |
| Mã tỉnh/thành | `province_code` | Tên tham số filter tỉnh |
| Mã danh mục | `category_code` | |
| Mã cơ quan ban hành | `agency_code` | |
| Mã nhóm dịch vụ | `service_group_code` | |
| Số kết quả mỗi trang | 5 | Tăng lên nếu muốn xem nhiều hơn |

**Lưu**: cài đặt chỉ lưu trong phiên, không ghi `localStorage`. Reload trang sẽ reset.

## 6. Endpoints API đang dùng

| Method & path | Dùng để |
|---------------|--------|
| `GET /api/health` | kiểm tra kết nối |
| `GET /api/procedures?q=&ward_code=&province_code=&...` | tìm thủ tục (server-side filter `ward_code` / `province_code` rất nhanh) |
| `GET /api/procedures/{code}` | chi tiết một thủ tục |
| `GET /api/procedures/{code}/provinces` | danh sách tỉnh áp dụng |
| `GET /api/procedures/{code}/wards` | danh sách xã/phường áp dụng |
| `GET /api/attachments/{id}/download` | tải biểu mẫu |
| `GET /api/agencies`, `/api/provinces`, `/api/categories`, `/api/service-groups` | danh mục |
| `GET /api/wards?q=` | tìm phường/xã |
| `GET /api/wards/{code}` | chi tiết 1 phường/xã **+ danh sách ~3500 procedures áp dụng** |
| `GET /api/ward` | phường gắn với khóa tenant hiện tại (chỉ khi dùng khóa theo phường) |
| `GET /api/stats` | thống kê |

## 7. Đặc điểm kỹ thuật

- **Không phụ thuộc backend riêng** — toàn bộ logic chạy trong browser, gọi thẳng `dichvucong.cloudgo.vn`.
- **Không dùng localStorage** — cài đặt reset khi reload (để tránh "kẹt" cấu hình sai).
- **Xử lý IME tiếng Việt**: phím Enter khi đang gõ dấu sẽ không gửi câu (tránh gửi 2 lần).
- **So khớp có/không dấu**: dùng `stripVN()` (chuẩn NFD + thay `đ→d`) để khớp "kết hôn" / "ket hon".
- **Server-side filter ưu tiên**: Khi user nêu địa bàn, ưu tiên gửi `ward_code` / `province_code` để server lọc (nhanh hơn nhiều so với tải toàn bộ procedures rồi filter client).

## 8. Khắc phục sự cố

| Triệu chứng | Nguyên nhân & cách xử lý |
|-------------|---------------------------|
| Bấm "Kiểm tra kết nối" → "Không gọi được máy chủ" | Trình duyệt chặn CORS. Thử Chrome/Edge, hoặc chạy qua `python3 -m http.server`. |
| `unauthorized` | Đang ở chế độ `rest` mà thiếu/sai `X-API-Key`. Chuyển về `gateway`. |
| `notfound` (404) | Sai Base URL hoặc endpoint không tồn tại. Kiểm tra lại trong `/api/openapi.json`. |
| Gõ tên xã nhưng không ra | Thử viết hoa chữ cái đầu: `xã Xuân Lãng` (regex yêu cầu `[A-ZÀ-Ỹ]`). |
| Kết quả rỗng dù đúng tên | API đôi khi từ chối full-text quá dài. Thử rút gọn: `kết hôn` thay vì `đăng ký kết hôn tại xã X`. |

## 9. Định hướng phát triển tiếp

- [ ] Lưu cài đặt ra `localStorage` (tuỳ chọn toggle).
- [ ] Lịch sử hội thoại (gọi lại câu cũ bằng phím mũi tên).
- [ ] Tóm tắt nội dung bằng AI (nếu có khóa LLM) để trả lời trực tiếp "Thủ tục X cần hồ sơ gì?" thay vì chỉ liệt kê.
- [ ] Widget nhúng (<iframe>) cho trang ubndxuanlang.gov.vn.
# chatbot-UBND-Xa-xuan-Lang
