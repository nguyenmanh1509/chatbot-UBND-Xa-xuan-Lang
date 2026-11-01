#!/usr/bin/env bash
#
# Deploy trang tĩnh (widget chatbot) lên Cloudflare Pages.
#
# VÌ SAO CẦN SCRIPT NÀY:
# Cloudflare Pages dùng cơ chế "direct upload" (không nối Git) -> phải
# đẩy thủ công từng lần. Script này gom đúng bộ file cần deploy rồi
# đẩy lên project `xuanlang`.
#
# CÁCH DÙNG:
#   ./scripts/deploy-pages.sh
#
# Kết quả: https://xuanlang.pages.dev
#
# LƯU Ý:
#   - `chat.html` + `embed.js` đang live là bản riêng (widget bọc iframe
#     trỏ về GitHub Pages). Script giữ nguyên bản live này để không phá
#     các website đang nhúng.
#   - `index.html` là widget đầy đủ, chạy độc lập.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="xuanlang"
BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT

cd "$ROOT"

echo "→ Gom file tĩnh vào $BUILD"

# --- Widget đầy đủ (chạy độc lập) ---
cp index.html "$BUILD/"

# --- Bản live hiện tại: chat.html (wrapper) + embed.js ---
# Lấy từ xuanlang.pages.dev để giữ nguyên hành vi đang dùng.
for f in chat.html embed.js; do
  if curl -fsSL "https://${PROJECT}.pages.dev/${f}" -o "$BUILD/${f}" 2>/dev/null; then
    echo "  ✓ giữ bản live: ${f}"
  else
    echo "  ! không lấy được ${f} từ Pages — dùng bản trong repo"
    [ -f "embed-host/${f}" ] && cp "embed-host/${f}" "$BUILD/" || true
  fi
done

# --- Các file nhúng khác ---
cp embed.html "$BUILD/" 2>/dev/null || true
cp embed-host/widget.html "$BUILD/" 2>/dev/null || true

# --- Headers: cho phép nhúng iframe (bắt buộc cho widget) ---
cp _headers "$BUILD/"

echo "→ Nội dung deploy:"
ls -la "$BUILD"

echo "→ Đẩy lên Cloudflare Pages (project: $PROJECT)"
npx wrangler pages deploy "$BUILD" --project-name "$PROJECT" --branch main --commit-dirty=true

echo ""
echo "✅ Xong: https://${PROJECT}.pages.dev"
