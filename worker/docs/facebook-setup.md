# Hướng dẫn lấy 4 thông tin Facebook cho chatbot UBND xã Xuân Lãng

> Mở link: https://developers.facebook.com/apps
> Nếu thấy nút **Login** → đăng nhập bằng tài khoản Facebook **quản lý Page của UBND** (không phải tài khoản cá nhân của cán bộ).

Tổng thể có 4 giá trị cần lấy. Bảng bên dưới tóm tắt, phần sau là chi tiết từng bước.

| # | Cần lấy | Lấy ở đâu (trong Meta for Developers) | Bắt buộc? |
|---|----------|--------------------------------------|-----------|
| 1 | **Page ID** | Messenger → Settings → khung **Page Access** bên phải | ✅ Có |
| 2 | **App Secret** | App settings → Basic → **App secret** → bấm **Show** | ⬜ Không (bỏ qua được) |
| 3 | **Page Access Token** | Messenger → Settings → **Access Token** → **Generate token** | ✅ Có |
| 4 | **Verify Token** | **Tự đặt** — không lấy ở đâu cả, bạn tự nghĩ 1 chuỗi | ✅ Có |

> **Chỉ cần 3 giá trị** (Page ID, Token, Verify Token) là bot chạy được. App Secret bỏ trống vẫn OK.

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

**Màn hình Messenger Settings** có 3 cột:

- Cột **trái**: menu (Messenger, App settings, Events...)
- Cột **giữa**: danh sách Page đã kết nối + Access Token
- Cột **phải**: khung **Page Access** hiển thị thông tin Page

**Cách 1 (nhanh nhất):** trong cột **giữa**, phần **2. Tạo mã truy cập** (tiếng Anh: *Access Tokens*),
ngay cạnh tên Page của bạn sẽ hiện **ID Trang** (dãy số) → copy.

**Cách 2 (dự phòng):** vào trang Facebook của Page → **Cài đặt** (Settings) → **Account details** → mục **Page ID**.

**Cách 3 (dùng khi không tìm thấy UI):** dán vào trình duyệt, nhấn Enter — sẽ ra JSON chứa đúng Page ID:

```
https://graph.facebook.com/v26.0/me/accounts?access_token=TOKEN_CUA_BAN
```

> ⚠️ Nếu không thấy Page của UBND trong danh sách, nghĩa là tài khoản đang đăng nhập **không quản lý Page đó**.
> Cần đổi sang đúng tài khoản, hoặc nhờ người có quyền quản trị Page thêm bạn vào.
> Xem mục **B. Không thấy Page của UBND trong danh sách** ở phần dưới.

---

## BƯỚC 4 — Lấy App Secret (giá trị #2) — KHÔNG BẮT BUỘC

> ⚠️ **App Secret là tuỳ chọn.** Bot vẫn chạy bình thường nếu để trống.
> Nó chỉ dùng để xác minh chữ ký webhook (chống giả mạo). Nếu chưa tìm thấy, bỏ qua
> và làm tiếp — khi nào quen thì bổ sung sau.

1. Menu trái → **Cài đặt ứng dụng** (tiếng Anh: *App settings*) → tab **Cơ bản** (Basic)
2. Cuối trang, mục **App secret** → bấm nút **Hiển thị** (Show)
3. Copy chuỗi (dạng `1234567890abcdef...`)

> 📌 Menu trái phải **cuộn xuống hết** mới thấy "Cài đặt ứng dụng" — nó nằm ở cuối menu.
>
> 📌 Nếu không thấy mục **App secret** ở tab Cơ bản: bạn đang mở **cài đặt của một sản phẩm khác**
> (ví dụ "Cài đặt Messenger"), không phải cài đặt của app. Hãy chắc chắn chọn
> **"Cài đặt ứng dụng"** ở menu trái, rồi tab **Cơ bản**.

---

## BƯỚC 5 — Tạo Page Access Token (giá trị #3)

Vẫn ở trang **Messenger → Cài đặt API Messenger**, cột giữa, mục **2. Tạo mã truy cập**:

1. Bấm **Thêm hoặc xóa Trang** (tiếng Anh: *Add or Remove Pages*) hoặc **Kết nối** (Connect)
2. Một cửa sổ Facebook mở ra → đăng nhập (nếu cần) → chọn **đúng Page của UBND**
3. **Quan trọng:** đảm bảo cột trái của Page đó hiện **"Quản lý và truy cập cuộc trò chuyện Trang trong Messenger" = Có**
   (tiếng Anh: *Manage and access Page conversations in Messenger* = Yes)
   — nếu là Không thì bật lên, nếu không sẽ không nhận được tin nhắn
4. **Tiếp theo** → chọn quyền, tick:
   - ✅ `pages_messaging`
   - ✅ `pages_show_list`
   - ✅ `pages_manage_metadata`
   - ✅ `pages_read_engagement`
5. **Tiếp theo** → **Hoàn tất** (Done)
6. Quay lại trang Messenger Settings, mục **2. Tạo mã truy cập** sẽ hiện token của Page vừa thêm
   → bấm **Sao chép** (Copy), hoặc bấm **Tạo mã** (Generate Token) nếu chưa có

Token có dạng `EAAabc...` rất dài.

> ⚠️ **Token này có hạn** (thường ~60 ngày, có bản chỉ sống 1–2 giờ). Hết hạn thì quay lại đúng chỗ này bấm **Tạo mã** lại rồi gửi tôi token mới.
>
> **Token không hết hạn (nên dùng cho production):** tạo **System User** trong Business Manager → gán app với quyền **Quản lý ứng dụng** (Manage App) → lấy token từ System User đó và chọn thời hạn **Never**. Cách này nên làm sau khi mọi thứ chạy ổn định.

### Cách kiểm tra token có dùng được không

Dán vào trình duyệt, nhấn Enter:

```
https://graph.facebook.com/v26.0/me?access_token=TOKEN_CUA_BAN
```

Nếu nhận được:
```json
{"name":"UBND xã Xuân Lãng","id":"123456789012345"}
```
→ token hợp lệ ✅

Nếu nhận `{"error":{"message":"Invalid OAuth access token"...}}` → token sai/hết hạn ❌

**Xem quyền của token:** https://developers.facebook.com/tools/debug/accesstoken/

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

Vẫn ở **Messenger → Cài đặt API Messenger**, cuộn lên mục **1. Đặt cấu hình webhook**
(tiếng Anh: *Set up Webhooks*):

| Ô trên Meta (tiếng Việt) | Ô trên Meta (tiếng Anh) | Điền gì |
|---------------------------|-------------------------|---------|
| **URL gọi lại** | Callback URL | `https://ubnd-xuanlang-bot.nguyenmanh15092003.workers.dev/webhook/facebook` |
| **Xác minh mã** | Verify Token | chuỗi bạn tự đặt ở bước 6 |

→ Bấm **Xác minh và lưu** (Verify and Save)
→ Meta hiện **"Success"** nếu đúng

> ⚠️ Mục webhook có thể đang trống (mới tạo app) — đó là bình thường, điền vào rồi bấm.
>
> 📌 **ID ứng dụng** (ví dụ `1278081518169863`) là **App ID** — dùng cho OAuth/Web Login,
> **không phải Page ID**. Đừng điền nhầm vào ô Page ID.

**Nếu bấm "Xác minh và lưu" báo lỗi:**
1. **URL gọi lại** phải gõ đúng từng ký tự — copy từ Admin panel (bấm vào ô màu xám để copy),
   không thêm dấu `/` ở cuối, không thiếu `https://`
2. **Xác minh mã** phải **giống hệt** chuỗi đã đặt trong Admin panel
3. Kiểm tra bằng cách mở tab Ẩn danh (Incognito), dán URL vào — phải trả về HTTP 200

Tiếp theo ở mục **Đăng ký các trường** (Subscribe Fields):
→ Tick **CẢ 3** mục rồi bấm **Đăng ký** (Subscribe):

| Trường | Bắt sự kiện nào |
|--------|-----------------|
| `messages` | Tin nhắn thường của người dân |
| `messaging_postbacks` | Nút "Bắt đầu" (Get Started) — bot chào ngay |
| `messaging_optins` | Người dân bấm nút "Nhắn tin" từ m.me / Chat Plugin / website |

> ⚠️ Thiếu `messaging_postbacks` hoặc `messaging_optins` là nguyên nhân phổ biến nhất
> khiến **người dân bấm "Nhắn tin" mà bot im lặng** — vì lúc đó Meta gửi sự kiện
> postback/optin, không phải tin nhắn.

---

## BƯỚC 7b — Cài nút "Bắt đầu" + câu hỏi gợi ý cho Page (GIỜ CHÀO NGAY)

Khi người dân bấm nút **"Nhắn tin"** trên trang Facebook của UBND, Meta mở cửa sổ
Messenger. Nếu Page **chưa có** cấu hình bên dưới, cửa sổ đó **trống trơn** →
người dân tưởng bot chết, không ai nhắn được.

Cần cài 2 thứ trong **Meta Business Suite → Inbox → Messenger**:

1. **Greeting / "Bắt đầu" (Get Started)**: Meta gửi postback `GET_STARTED` về webhook
   → bot tự động gửi lời chào + nút bấm nhanh.
2. **Ice breakers** (câu hỏi gợi ý): hiện ngay trên màn hình mở chat, người dân
   bấm 1 cái là gửi tin luôn.

### Cách cài nhanh bằng script

```bash
cd worker
node scripts/facebook-greeting.mjs --user-token "EAA..."
```

> ⚠️ `--user-token` phải là **USER TOKEN** (token đăng nhập tài khoản quản trị Page),
> **không phải** Page Access Token. Meta yêu cầu tài khoản có quyền admin Page
> mới cho cài `get_started` / `ice_breakers`.
> Lấy token ở **Meta for Developers → Messenger → Settings → Generate token**.
> Token này chỉ dùng 1 lần để cài, xong có thể thu hồi.

### Cách cài bằng giao diện

Meta Business Suite → **Inbox** → mục **Messenger** → **Tự động**:
- **Greeting** (Lời chào): bật, gõ lời chào, chọn nút bấm → **Đăng ký** (Start Chat).
- **Trả lời tức thì** (Instant replies): tạo câu trả lời tự động với từ khóa
  `bắt đầu`, `start`, `chào`, `hello` → trả lời lời chào.

---

## BƯỚC 8 — Publish Page + chuyển app sang Chế độ Chính thức (bắt buộc)

### 8a. Publish Page

Webhook chỉ hoạt động khi Page ở trạng thái **Published**:

1. Vào trang Facebook của Page
2. **Cài đặt** → **General** (Chung)
3. Mục **Page Visibility** → chọn **Published**
4. Bấm **Publish Page**

> Nếu Page của UBND chưa muốn công khai, bạn vẫn có thể test: chỉ cần bạn (hoặc một tài khoản quản trị Page) nhắn vào Messenger của Page là bot sẽ trả lời.

### 8b. Chuyển app sang Chế độ Chính thức (Live)

Trên cùng của App Dashboard sẽ thấy:

```
Chế độ của ứng dụng:  [ Phát triển ]   ← công tắc đang ở trạng thái Tắt
```

| Chế độ | Ai nhắn được với bot |
|--------|---------------------|
| **Phát triển** (Development) | Chỉ người có vai trò trong app: quản trị viên / nhà phát triển / người kiểm thử. Người ngoài nhắn vào **không có gì trả lời**. |
| **Chính thức** (Live) | **Mọi người** nhắn vào Page đều được bot trả lời. |

**Để phục vụ người dân:** gạt công tắc sang **Chính thức** (Live).

> Với bot chỉ dùng 3 quyền cơ bản (`pages_messaging`, `pages_show_list`, `pages_manage_metadata`),
> Meta thường cho chuyển Live ngay mà không cần App Review.
> Nếu Meta yêu cầu App Review, làm theo hướng dẫn ở menu trái **Xét duyệt ứng dụng** (App Review).

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

## Không tìm thấy gì cả? — Đọc mục này

### A. Không thấy nút "Messenger" trong menu trái

→ Bạn **chưa Add product**. Quay lại trang chủ App Dashboard → cuộn xuống **Add products to your app** → ô **Messenger** → **Set up**.

### B. Không thấy Page của UBND trong danh sách

→ **Nguyên nhân #1: tài khoản đăng nhập không quản lý Page đó.**

Cách kiểm tra nhanh: mở trực tiếp `https://www.facebook.com/your-page-username/settings`
- Nếu bị báo lỗi / không có quyền → bạn sai tài khoản.
- Nếu vào được → bạn đúng tài khoản, xem tiếp mục C.

Cách khắc phục:
- **Đổi tài khoản**: bấm avatar góc trên bên phải trong Meta for Developers → **Switch accounts** → chọn đúng tài khoản quản lý Page.
- **Nhờ thêm quyền**: vào Page → **Cài đặt** → **Quyền quản lý** (Page access) → thêm tài khoản của bạn với vai trò **Admin** (hoặc ít nhất **Content** + truy cập Messenger).
- **Chưa có Page?** Nếu UBND chưa tạo Page: vào trang cá nhân → **Tạo Trang** (Create Page) → đặt tên "UBND xã Xuân Lãng" → chọn danh mục "Chính phủ & Cộng đồng" → tạo.

### C. Thấy Page nhưng nút "Generate Token" bị mờ / không hiện

→ App chưa có quyền truy cập Page. Bấm **Add or Remove Pages** trước, chọn Page, thực hiện flow cấp quyền → quay lại sẽ có nút Generate Token.

### D. Không thấy mục "App Secret"

→ Bạn đang ở đúng tab **Cơ bản** chưa? **App Secret** nằm ở cuối trong, phần **Settings** → *Show*.

→ Nếu vẫn không thấy: bạn đang xem **cài đặt của sản phẩm** (Messenger) chứ không phải
**cài đặt của app**. Menu trái phải chọn đúng **"Cài đặt ứng dụng"** (App settings), tab **Cơ bản**.

→ **Không tìm thấy cũng không sao** — App Secret là tuỳ chọn, bot vẫn chạy được. Bỏ qua.

### E. Không tìm thấy menu "App settings"

→ Menu trái phải **cuộn xuống hết** — "App settings" nằm ở **cuối menu trái**, dưới các sản phẩm khác. Đừng nhìn ở giữa.

### F. Trang trắng / lỗi khi mở developers.facebook.com

→ Thử bật VPN hoặc đổi trình duyệt. Meta for Developers đôi khi bị chặn ở một số mạng Việt Nam.

### G. Bấm "Verify and Save" báo lỗi

→ Kiểm tra 3 thứ:
1. **Callback URL** phải gõ tay, copy từ Admin panel (bấm vào ô màu xám để copy)
2. **Verify Token** phải **giống hệt** chuỗi đã đặt trong Admin panel
3. URL phải bắt đầu bằng `https://` và phải truy cập được từ Internet (kiểm tra bằng cách mở Incognito)

---

## Lỗi thường gặp

| Lỗi | Nguyên nhân | Cách sửa |
|-----|-------------|-----------|
| Không thấy Page trong dropdown | Tài khoản đăng nhập không quản lý Page | Đổi tài khoản, hoặc nhờ admin Page thêm bạn |
| `Invalid OAuth access token` | Token sai/hết hạn/nhầm User Token | Generate Token lại, đảm bảo chọn đúng Page |
| `#200` khi Meta verify | Verify Token 2 bên không khớp | So sánh kỹ từng ký tự |
| Webhook không nhận tin | Page chưa Publish, hoặc chưa tick `messages` | Publish Page + Subscribe `messages` |
| `(#200) Page Is Not Available` | Page bị ẩn/xóa hoặc app chưa ở trạng thái Live | Publish Page; app ở Development chỉ nhận từ người có role |
| Bot không nhận tin dù webhook OK | "Manage and access Page conversations" để No | Bật lên Yes trong Messenger Settings |
| Bot trả lời rồi mất sau 24h | Hết cửa sổ 24h của Messenger | Chuẩn bị trước cho tình huống này (xem mục dưới) |

---

## Ghi chú về giới hạn 24 giờ của Messenger

Sau khi người dùng nhắn cho Page, bạn có **24 giờ** để trả lời (miễn phí). Hết 24h thì phải dùng tin nhắn có nhãn quảng cáo (tính phí).

Với chatbot tra cứu thủ tục, người dùng thường hỏi nhiều lượt trong 1 phiên → 24h là đủ.

Nếu cần nhắn lại sau 24h (ví dụ nhắc nhở hồ sơ), có thể dùng **Messenger Marketing Messages** hoặc chuyển sang Zalo OA (có cửa sổ 48h).

---

## Bắt buộc khi chuyển ứng dụng sang chế độ Chính thức (Live)

Meta chỉ cho bật nút "Chuyển sang chính thức" khi app đã có 2 trang web công khai. Bot đã tự tạo sẵn:

| Ô trong App settings → Basic | Điền URL |
|---|---|
| **URL chính sách quyền riêng tư** | `https://ubnd-xuanlang-bot.nguyenmanh15092003.workers.dev/privacy` |
| **URL chỉ dẫn xóa dữ liệu** | `https://ubnd-xuanlang-bot.nguyenmanh15092003.workers.dev/deletion` |

⚠️ **KHÔNG dán URL webhook vào ô chính sách quyền riêng tư.** `/webhook/facebook` là đường dẫn nhận sự kiện (trả về JSON), không phải trang web → Meta báo "link không hợp lệ" và từ chối lưu, kéo theo không bật được chế độ Chính thức.

Ngoài ra, nếu muốn chỉnh cấu hình app bằng API:
**App settings → Advanced → bật "Allow changes to app settings via API"**.

---

## Bật AI cho chatbot (KHÔNG cần mua API key)

Bot dùng **Cloudflare Workers AI** qua binding `AI` của Worker — miễn phí trên gói Free, không cần đăng ký Gemini.

**Cách bật:** Admin panel → tab **AI** → *Cấu hình AI* → chọn **Cloudflare Workers AI** → bấm **Lưu cấu hình** → bấm **Kiểm tra AI**.

Nếu muốn AI trả lời tự nhiên hơn (Gemini thường hiểu tiếng Việt tốt hơn), lấy API key miễn phí tại https://aistudio.google.com/apikey rồi điền vào ô *Gemini API Key* — hệ thống sẽ ưu tiên Gemini, Workers AI làm dự phòng.

**Không bắt buộc**: nếu tắt AI, bot vẫn trả lời đúng bằng dữ liệu DVC (dạng bảng danh sách có mã thủ tục bấm được).

