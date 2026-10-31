# Hướng dẫn lấy 4 thông tin Facebook cho chatbot UBND xã Xuân Lãng

> Mở link: https://developers.facebook.com/apps
> Nếu thấy nút **Login** → đăng nhập bằng tài khoản Facebook **quản lý Page của UBND** (không phải tài khoản cá nhân của cán bộ).

Tổng thể có 4 giá trị cần lấy. Bảng bên dưới tóm tắt, phần sau là chi tiết từng bước.

| # | Cần lấy | Lấy ở đâu (trong Meta for Developers) |
|---|----------|---------------------------------------|
| 1 | **Page ID** | Messenger → Settings → khung **Page Access** bên phải |
| 2 | **App Secret** | App settings → Basic → **App secret** → bấm **Show** |
| 3 | **Page Access Token** | Messenger → Settings → **Access Token** → **Generate token** |
| 4 | **Verify Token** | **Tự đặt** — không lấy ở đâu cả, bạn tự nghĩ 1 chuỗi |

---

## BƯỚC 1 — Tạo App (làm 1 lần)

1. Vào https://developers.facebook.com/apps
2. Bấm nút **Create app** (góc trên bên phải)
3. Chọn loại app: **Business**
4. Điền:
   - **App Name**: `UBND Xuân Lãng Chatbot`
   - **App Contact Email**: email của UBND
   - **Business Account**: chọn hoặc tạo business account của UBND
5. Bấm **Create app**

> Sau bước này bạn ở trong **App Dashboard**.

---

## BƯỚC 2 — Thêm sản phẩm Messenger

1. Trong App Dashboard, cuộn xuống mục **Add products to your app**
2. Tìm ô **Messenger** → bấm **Set up**
3. Bạn được chuyển sang trang **Messenger Settings**

> Ở đây chính là nơi lấy **Page ID** (giá trị #1).

---

## BƯỚC 3 — Lấy Page ID (giá trị #1)

**Màn hình Messenger Settings** có 2 cột:

- Cột **giữa**: danh sách "Connect your Page" + Access Token
- Cột **phải**: khung **Page Access** hiển thị:
  ```
  Page ID      123456789012345
  Page Name    UBND xã Xuân Lãng
  ```

**Cách 1 (nhanh):** copy số ở ô **Page ID** trong khung bên phải.

**Cách 2 (dự phòng):** vào trang Facebook của Page → **Cài đặt** (Settings) → **Account details** → mục **Page ID**.

> ⚠️ Nếu khung bên phải trống hoặc không thấy Page của UBND, nghĩa là tài khoản đang đăng nhập **không quản lý Page đó**. Cần đổi sang đúng tài khoản, hoặc nhờ người có quyền quản trị Page thêm bạn vào.

---

## BƯỚC 4 — Lấy App Secret (giá trị #2)

1. Menu trái → **App settings** → tab **Basic**
2. Cuộn xuống mục **App secret** → bấm nút **Show**
3. Copy chuỗi (dạng `1234567890abcdef...`)

> App Secret dùng để xác minh chữ ký webhook — nhờ vậy không ai giả mạo được Page của bạn.

---

## BƯỚC 5 — Tạo Page Access Token (giá trị #3)

Vẫn ở trang **Messenger → Settings**, cột giữa:

1. Tới phần **Access Token**
2. Bấm **Add or Remove Pages** (một số giao diện ghi là **Connect**)
3. Một cửa sổ Facebook mở ra → đăng nhập (nếu cần) → chọn **đúng Page của UBND** → **Next**
4. Ở bước chọn quyền, tick:
   - ✅ `pages_messaging`
   - ✅ `pages_show_list`
   - ✅ `pages_manage_metadata`
5. **Next** → **Done**
6. Quay lại trang Messenger Settings, phần **Access Token** sẽ hiện token của Page vừa thêm
   → bấm **Copy** (hoặc bấm **Generate token** nếu chưa có)

Token có dạng `EAAabc...` rất dài.

> ⚠️ **Token này có hạn** (thường ~60 ngày). Hết hạn thì quay lại đúng chỗ này bấm **Generate token** lại rồi gửi tôi token mới.

---

## BƯỚC 6 — Tự đặt Verify Token (giá trị #4)

Đây **không phải** giá trị lấy từ đâu cả — bạn tự chọn một chuỗi bất kỳ, ví dụ:

```
xuanlang_verify_2026
```

Quy tắc: chỉ dùng chữ cái, số, gạch dưới. Không có dấu cách.

**Quan trọng:** chuỗi này phải **giống hệt** ở 2 nơi:
- Ô **Verify Token** trong Admin panel của chatbot
- Ô **Verify token** khi đăng ký webhook bên Meta

---

## BƯỚC 7 — Đăng ký Webhook (sau khi đã lưu cấu hình)

Vẫn ở **Messenger → Settings**, cuộn xuống mục **Webhooks** → bấm **Edit** (hoặc **Add**):

| Ô trên Meta | Điền gì |
|--------------|---------|
| **Callback URL** | `https://ubnd-xuanlang-bot.nguyenmanh15092003.workers.dev/webhook/facebook` |
| **Verify Token** | chuỗi bạn tự đặt ở bước 6 |

→ Bấm **Verify and Save**
→ Meta hiện **"Success"** nếu đúng

Tiếp theo ở mục **Subscribe Fields**:
→ Tick **`messages`** → bấm **Subscribe**

---

## BƯỚC 8 — Publish Page (bắt buộc)

Webhook chỉ hoạt động khi Page ở trạng thái **Published**:

1. Vào trang Facebook của Page
2. **Cài đặt** → **General** (Chung)
3. Mục **Page Visibility** → chọn **Published**
4. Bấm **Publish Page**

> Nếu Page của UBND chưa muốn công khai, bạn vẫn có thể test: chỉ cần bạn (hoặc một tài khoản quản trị Page) nhắn vào Messenger của Page là bot sẽ trả lời.

---

## BƯỚC 9 — Kiểm thử

1. Trong Admin panel → tick **Bật kênh Facebook** → **Lưu cấu hình**
2. Bấm **Kiểm tra kết nối** → phải báo *"Đã kết nối tới Page: UBND xã Xuân Lãng"*
3. Mở trang Facebook của Page → bấm nút **Messenger** ở góc dưới bên phải
4. Gõ: `hộ khẩu` hoặc `kết hôn tại xã Xuân Lãng`
5. Bot phải trả lời trong vài giây

---

## Checklist nhanh

- [ ] Đã tạo App (loại Business)
- [ ] Đã Add product → Messenger
- [ ] Page ID  → lấy ở khung bên phải Messenger Settings
- [ ] App Secret → App settings → Basic → Show
- [ ] Page Access Token → Access Token → Generate token (tick 3 quyền)
- [ ] Verify Token → tự đặt, ví dụ `xuanlang_verify_2026`
- [ ] Đã đăng ký Webhook + Subscribe field `messages`
- [ ] Page đã Publish

---

## Lỗi thường gặp

| Lỗi | Nguyên nhân | Cách sửa |
|-----|-------------|-----------|
| Không thấy Page trong dropdown | Tài khoản đăng nhập không quản lý Page | Đổi tài khoản, hoặc nhờ admin Page thêm bạn |
| `Invalid OAuth access token` | Token sai/hết hạn/nhầm User Token | Generate token lại, đảm bảo chọn đúng Page |
| `#200` khi Meta verify | Verify Token 2 bên không khớp | So sánh kỹ từng ký tự |
| Webhook không nhận tin | Page chưa Publish, hoặc chưa tick `messages` | Publish Page + Subscribe `messages` |
| `(#200) Page Is Not Available` | Page bị ẩn/xóa hoặc app chưa ở trạng thái Live | Publish Page; app ở Development chỉ nhận từ người có role |
