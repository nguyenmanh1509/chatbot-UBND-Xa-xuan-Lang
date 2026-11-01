# Chatbot hỗ trợ tra cứu thủ tục hành chính — UBND xã Xuân Lãng, Phú Thọ

Chatbot tra cứu thủ tục hành chính cho **xã Xuân Lãng, tỉnh Phú Thọ**, chạy hoàn toàn trên **Cloudflare Free Tier** (Workers + D1 + KV + Workers AI).

| | |
|---|---|
| **Trang chatbot** | https://ubnd-xuanlang-bot.nguyenmanh15092003.workers.dev/ |
| **Trang quản trị** | https://ubnd-xuanlang-bot.nguyenmanh15092003.workers.dev/admin |
| **Đăng nhập quản trị** | `admin` / `UBNDXuanLang@2026` (đổi ngay trong tab "Tài khoản") |
| **Webhook Messenger** | `https://ubnd-xuanlang-bot.nguyenmanh15092003.workers.dev/webhook/facebook` |
| **Webhook Zalo OA** | `https://ubnd-xuanlang-bot.nguyenmanh15092003.workers.dev/webhook/zalo-oa` |
| **Dữ liệu** | 3.544 thủ tục áp dụng tại xã, đồng bộ tự động 2 lần/ngày |

---

## 1. Các yêu cầu đã hiện thực

| # | Yêu cầu | Hiện thực |
|---|----------|-----------|
| 1 | **Cục bộ hóa xã Xuân Lãng** | Tiêu đề widget/admin: *"Chatbot hỗ trợ tra cứu thủ tục hành chính"*. Lời chào bắt đầu bằng *"Em chào anh/chị! 👋"*, kèm câu *"…của UBND xã Xuân Lãng, tỉnh Phú Thọ"* và 8 nút bấm nhanh. Mã xã `H44.195`. |
| 2 | **Trang quản trị** | 7 tab: Kênh kết nối (Messenger/Zalo Bot/Zalo OA), AI & Dữ liệu, Thủ tục của xã, Câu chào, Tài khoản, Thử nghiệm, Thống kê. Import **toàn bộ** thủ tục của xã, **gán chuyên viên** (theo từng thủ tục hoặc **hàng loạt theo lĩnh vực**). Khi người dân hỏi, bot trả đúng format: *"Anh/chị hãy đến gặp đồng chí [Tên] tại bàn số [Số], số điện thoại [SĐT] tại Trung tâm Phục vụ hành chính công xã Xuân Lãng."* |
| 3 | **Cloudflare Free** | Workers (Free), D1 (5 GB miễn phí), KV, Workers AI (10.000 neuron/ngày). Không tốn đồng nào. |
| 4 | **AI miễn phí cho câu ngoài lề** | `@cf/meta/llama-3.1-8b-instruct` qua binding Workers AI — không cần API key trả phí. Câu hỏi thời gian ("hôm nay ngày mấy", "mấy giờ rồi") được nhận diện riêng và trả lời chính xác theo giờ Việt Nam (UTC+7). |
| 5 | **Tóm tắt + link DVC** | Không dump nguyên văn bản. Mỗi thủ tục trả: tên, mã, mức độ xã thực hiện, tóm tắt 1–2 câu, đồng chí phụ trách, link nộp trực tuyến và link Cổng DVC Quốc gia `dichvucong.gov.vn`. |
| 6 | **Tự động hoá** | Deploy, test, tự debug, cron đồng bộ dữ liệu hằng ngày. |

---

## 2. Kiến trúc

```
Người dân ──> Web widget / Messenger / Zalo OA
                 │
                 ▼
        Cloudflare Worker (src/index.js)
                 │
      ┌──────────┴───────────┐
      ▼                      ▼
  Tầng A (D1)          Tầng B (D1 index xã)      Tầng C (DVC Gateway)
  Thủ tục đã gán        Tìm theo bigram +          Realtime dữ liệu
  chuyên viên           từ đồng nghĩa              + tra theo mã
      │                      │
      └──────────┬───────────┘
                 ▼
        Workers AI (llama-3.1-8b-instruct)   ← câu ngoài lề, câu hỏi mở
```

### Ba tầng tra cứu

1. **Tầng A — Thủ tục đã gán chuyên viên (D1)**: khớp chính xác tên/mã/từ khóa khai báo, hoặc Dice ≥ 0,75. Trả bản **tất định** có đủ bàn số, số điện thoại (không để AI "diễn giải" mất thông tin).
2. **Tầng B — Index toàn xã (D1)**: tìm bằng **bigram** (`"ho khau"` phải nằm liền nhau trong tên) + **từ đồng nghĩa** (`"hộ khẩu" ~ "căn cước"`, `"chứng thư" ~ "chứng thực"`), có cột đệm `name_pad`/`category_pad` để tránh trùng chuỗi con (`"đai"` khớp `"đại lý"`), và ưu tiên mức độ xã thực hiện `FULL > PARTIAL > ALL`.
3. **Tầng C — Cổng DVC (`dichvucong.cloudgo.vn`)**: dữ liệu thời gian thực và tra cứu chi tiết theo mã.

### Vì sao không dùng full-text của Cổng DVC

Gateway DVC tìm theo chuỗi rời (không phân tích từ): `"hộ khẩu"` khớp `"nhập khẩu"`, `"cửa khẩu"` → trả về 6 thủ tục toàn về xuất nhập khẩu. Vì vậy phần lớn tra cứu chạy trên D1, DVC chỉ làm lưới dự phòng.

---

## 3. Dữ liệu thời gian thực

| Nguồn | Cơ chế | Tần suất |
|-------|---------|----------|
| Thủ tục từ Cổng DVC | `importWardProcedures()` — upsert không phá dữ liệu đã gán | Cron `0 20 * * *` (20h) + `0 8 * * *` (8h) |
| Token Zalo OA | Tự refresh access token | Cùng cron |
| Tra cứu trực tiếp | Tầng C gọi gateway DVC lúc người dân hỏi | Theo yêu cầu |

Có thể chạy tay để đồng bộ ngay:

```bash
cd worker
curl -X POST "https://ubnd-xuanlang-bot.nguyenmanh15092003.workers.dev/api/admin/import-now" \
  -H "Content-Type: application/json" -b cookie.txt
```

---

## 4. Trang quản trị

### 4.1 Cấu hình Messenger (ảnh 1)

Tab **Kênh kết nối → Facebook Messenger**:

| Trường | Giá trị |
|---------|---------|
| Bật kênh | ✅ |
| Page ID | `1341702435690802` |
| Page Access Token | *(đã điền sẵn, có thể xem trong tab)* |
| Verify Token | `xuanlang_verify_2026` |
| App Secret | *(đã điền sẵn)* |

Trên [developers.facebook.com](https://developers.facebook.com) → App → **Messenger → Settings**:
- **Webhook URL**: `https://ubnd-xuanlang-bot.nguyenmanh15092003.workers.dev/webhook/facebook`
- **Verify Token**: `xuanlang_verify_2026`
- **Subscribe**: `messages`, `messaging_postbacks`

### 4.2 Cấu hình Zalo OA (ảnh 2)

Tab **Kênh kết nối → Zalo OA** — nhập OA ID, App ID, Access Token, Refresh Token, OA Secret Key. Webhook: `https://ubnd-xuanlang-bot.nguyenmanh15092003.workers.dev/webhook/zalo-oa`

> Zalo OA cần OA loại *"Cơ quan nhà nước"* để miễn phí. Liên hệ `oa@zalo.me` để được ưu đãi.

### 4.3 Import + gán chuyên viên

Tab **Thủ tục của xã**:

1. **Nút "Import từ Cổng DVC"** — kéo toàn bộ 3.544 thủ tục của xã về D1 (kèm mã, lĩnh vực, mức độ, link DVC).
2. **Gán thủ tục đã chọn** — tick nhiều dòng rồi điền đồng chí / bàn số / SĐT / giờ làm việc.
3. **⚡ Gán hàng loạt theo lĩnh vực** — chọn lĩnh vực (220 lĩnh vực có sẵn) + đồng chí → gán 1 lần cho cả nhóm.

Dữ liệu chuyên viên **mẫu** đã seed sẵn 434 thủ tục cho 5 đồng chí (script `worker/scripts/seed-officers.mjs`). **Phải sửa tên/SĐT thật trong trang quản trị trước khi dùng thật.**

---

## 5. Câu trả lời mẫu

```
*Thủ tục đăng ký kết hôn*
Mã: 1.000894

• Đồng chí phụ trách: Nguyễn Văn An
• Bàn số: 1
• Số điện thoại: 0212 3456 101
• Giờ làm việc: Thứ 2-5, 8h00-17h00

Anh/chị hãy đến gặp đồng chí Nguyễn Văn An tại bàn số 1,
số điện thoại 0212 3456 101 tại Trung tâm Phục vụ hành chính công xã Xuân Lãng.

📝 Nộp trực tuyến: https://dichvucongnganhtuphap.moj.gov.vn/...
🔗 Cổng DVC Quốc gia: https://dichvucong.gov.vn/thu-tuc-hanh-chinh/019d2bfd-...
```

Câu ngoài lề (do Workers AI trả lời):

```
Hôm nay là Chủ Nhật, ngày 1/11/2026, và thời gian hiện tại là 23:29.
```

---

## 6. Phát triển

```bash
cd worker
npm install

# Chạy local (D1 local + Worker)
npx wrangler dev

# Chạy test (không đụng D1 thật)
for t in test/*.test.mjs; do node "$t"; done

# Deploy
npx wrangler deploy
```

### Cấu trúc thư mục

```
worker/
├── src/
│   ├── index.js                 # Worker: route, webhook, API admin
│   ├── core/
│   │   ├── ward-search.js       # Tầng B — tìm kiếm bigram + đồng nghĩa
│   │   ├── conversation.js       # Điều phối 3 tầng + định dạng trả lời
│   │   ├── procedures.js         # CRUD/gán/import thủ tục trong D1
│   │   ├── ai.js                 # Workers AI (llama-3.1-8b-instruct)
│   │   ├── dvc.js / dvc-import.js # Client & bộ nạp Cổng DVC
│   │   ├── nlu.js                # Nhận diện lời chào, mã thủ tục, câu hỏi
│   │   └── retrieve.js           # Dựng ngữ cảnh, tách tin nhắn
│   ├── channels/                 # Messenger, Zalo Bot, Zalo OA
│   └── pages/                    # admin.html, chat.html, privacy, deletion
├── migrations/                   # Lịch sử schema D1
├── scripts/
│   ├── import-ward.mjs           # Nạp thủ tục từ DVC
│   ├── seed-officers.mjs         # Seed chuyên viên mẫu theo lĩnh vực
│   └── backfill-pad.mjs          # Backfill cột đệm name_pad/category_pad
└── test/                         # 297 test, chạy offline
```

---

## 7. Hạn mức Cloudflare Free (đang dùng)

| Tài nguyên | Hạn mức | Đang dùng |
|------------|---------|-----------|
| Workers AI | 10.000 neuron/ngày | Rất thấp (chỉ câu ngoài lề) |
| D1 | 5 GB, 5 triệu đọc/ngày | ~2 MB dữ liệu |
| KV | 100.000 lượt ghi/ngày | ~10 lượt/ngày |
| Cron | 5 trigger | 2 trigger |

Nếu vượt hạn mức AI, bot vẫn hoạt động: hết AI thì trả kết quả tra cứu dạng cấu trúc (tên + mã + link), không sập.

---

## 8. Bảo mật đã áp dụng

- Xác thực webhook Messenger bằng `X-Hub-Signature-256` (HMAC-SHA256 với App Secret).
- Cookie phiên `HttpOnly` + `SameSite=Strict` cho trang quản trị.
- Mật khẩu admin lưu dạng hash PBKDF2 trong D1.
- Token nhạy cảm che ký trong API đọc config (`••••••`).
- `.dev.vars` **không** commit lên git.
- Có trang `/privacy` và `/deletion` để đáp ứng yêu cầu Meta về chính sách dữ liệu.
