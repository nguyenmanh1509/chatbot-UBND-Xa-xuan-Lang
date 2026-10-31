#!/bin/bash
# Áp cấu hình kênh Facebook vào Worker production qua Admin API.
#
# Dùng:
#   FB_PAGE_ID=... FB_TOKEN=... FB_APP_SECRET=... FB_VERIFY_TOKEN=... \
#   ADMIN_PASSWORD='...' ./scripts/apply-facebook.sh
#
# Script chỉ gửi các biến được đặt, nên có thể áp từng phần một.
#
# Lưu ý: dùng curl chứ không dùng python urllib — Cloudflare Browser
# Integrity Check chặn User-Agent "Python-urllib" (HTTP 403 code 1010).

set -euo pipefail

WORKER_URL="${WORKER_URL:-https://ubnd-xuanlang-bot.nguyenmanh15092003.workers.dev}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"

if [ -z "$ADMIN_PASSWORD" ]; then
  echo "❌ Thiếu ADMIN_PASSWORD. Đặt bằng:  ADMIN_PASSWORD='...' $0" >&2
  exit 1
fi

if [ -z "${FB_PAGE_ID:-}${FB_TOKEN:-}${FB_APP_SECRET:-}${FB_VERIFY_TOKEN:-}" ]; then
  echo "❌ Không có biến nào được đặt (FB_PAGE_ID / FB_TOKEN / FB_APP_SECRET / FB_VERIFY_TOKEN)." >&2
  exit 1
fi

# --- 1. Gom JSON payload ---
PAYLOAD=$(python3 - <<'PYEOF'
import json, os

fb = {}
mapping = {
    "pageId": "FB_PAGE_ID",
    "pageAccessToken": "FB_TOKEN",
    "appSecret": "FB_APP_SECRET",
    "verifyToken": "FB_VERIFY_TOKEN",
}
for field, env_name in mapping.items():
    val = os.environ.get(env_name, "").strip()
    if val:
        fb[field] = val

# Chỉ bật kênh khi đủ Page ID + Token + Verify Token
if all(os.environ.get(v, "").strip() for v in ("FB_PAGE_ID", "FB_TOKEN", "FB_VERIFY_TOKEN")):
    fb["enabled"] = True

print(json.dumps({"config": {"channels": {"facebook": fb}}}))
PYEOF
)

echo "=== Lưu cấu hình ==="
curl -s --max-time 30 -X POST \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $ADMIN_PASSWORD" \
  "$WORKER_URL/api/admin/config" \
  -d "$PAYLOAD" \
  | python3 -c "
import sys, json
j = json.load(sys.stdin)
if not j.get('ok'):
    print('❌ Lỗi lưu:', j.get('error')); raise SystemExit(1)
print('✅ Đã lưu:', ', '.join(j['config']['channels']['facebook'].keys()))
for ch, st in (j.get('status') or {}).items():
    if isinstance(st, dict):
        mark = 'OK' if st.get('configured') else 'CHƯA ĐỦ'
        extra = f\"  thiếu={st.get('missing')}\" if st.get('missing') else ''
        print(f'   {ch}: {mark}{extra}')
"

# --- 2. Kiểm tra kết nối tới Page qua Graph API ---
echo
echo "=== Kiểm tra kết nối Facebook ==="
curl -s --max-time 25 -X POST -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $ADMIN_PASSWORD" \
  "$WORKER_URL/api/admin/test" -d '{"channel":"facebook"}' \
  | python3 -c "
import sys, json
j = json.load(sys.stdin)
r = (j.get('results') or {}).get('facebook') or {}
print(('✅ ' + r['detail']) if r.get('ok') else ('❌ ' + str(r.get('error'))))
"

# --- 3. Kiểm tra webhook challenge (giống cách Meta gọi) ---
if [ -n "${FB_VERIFY_TOKEN:-}" ]; then
  echo
  echo "=== Kiểm tra webhook challenge ==="
  CODE=$(curl -s -o /tmp/_fb_challenge.txt -w "%{http_code}" --max-time 20 \
    "$WORKER_URL/webhook/facebook?hub.mode=subscribe&hub.verify_token=$FB_VERIFY_TOKEN&hub.challenge=testchal_12345")
  if [ "$CODE" = "200" ] && grep -q "testchal_12345" /tmp/_fb_challenge.txt; then
    echo "✅ Webhook challenge hoạt động (HTTP 200, trả đúng challenge)"
    echo "   → Bạn có thể điền URL này vào Meta và bấm 'Xác minh và lưu'"
  else
    echo "❌ Webhook challenge lỗi (HTTP $CODE): $(head -c 120 /tmp/_fb_challenge.txt)"
  fi
fi

echo
echo "=== Health ==="
curl -s --max-time 20 "$WORKER_URL/api/health" | head -c 400
echo
echo
echo "=== URL để điền vào Meta (Webhooks → Callback URL) ==="
echo "$WORKER_URL/webhook/facebook"
