#!/bin/zsh
# Script runner cho hệ thống kiểm thử tự động.
# Được launchd gọi định kỳ. Tự bảo đảm Worker local đang chạy trước khi test.

set -u

ROOT="/Users/nguyenmanh/chatbot-UBND-Xa-xuan-Lang/worker"
NVM_BIN="/Users/nguyenmanh/.nvm/versions/node/v22.11.0/bin"
export PATH="$NVM_BIN:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export WRANGLER_HOME="$ROOT/.wrangler"

# Ưu tiên test production (thật) — đổi nếu muốn test local
PROD_URL="https://ubnd-xuanlang-bot.nguyenmanh15092003.workers.dev"
export WORKER_URL="$PROD_URL"
export ADMIN_PASSWORD="UBNDXuanLang@2026"

LOG_DIR="$ROOT/test-results"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/auto-test.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"
}

cd "$ROOT" || { log "LỖI: không cd được vào $ROOT"; exit 1; }

# --- Nếu production không phản hồi -> khởi động Worker local để test ---
WORKER_UP=$(curl -s --max-time 8 -o /dev/null -w "%{http_code}" "$PROD_URL/api/health" 2>/dev/null)

if [ "$WORKER_UP" != "200" ]; then
  log "Production không phản hồi (code=$WORKER_UP) -> chuyển sang test local"

  # Dừng job cũ nếu có
  launchctl remove ubnd-wd-dev 2>/dev/null

  # Tạo script launcher
  cat > /tmp/ubnd-wd-dev.sh << 'LAUNCHER'
#!/bin/zsh
export PATH="/Users/nguyenmanh/.nvm/versions/node/v22.11.0/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd /Users/nguyenmanh/chatbot-UBND-Xa-xuan-Lang/worker
export WRANGLER_HOME=/Users/nguyenmanh/chatbot-UBND-Xa-xuan-Lang/worker/.wrangler
exec /Users/nguyenmanh/.nvm/versions/node/v22.11.0/bin/npx wrangler dev --port 8787 --ip 127.0.0.1
LAUNCHER
  chmod +x /tmp/ubnd-wd-dev.sh

  launchctl submit -l ubnd-wd-dev -- /tmp/ubnd-wd-dev.sh > /dev/null 2>&1

  # Chờ Worker sẵn sàng (tối đa 90 giây)
  for i in $(seq 1 90); do
    sleep 1
    CODE=$(curl -s --max-time 3 -o /dev/null -w "%{http_code}" http://127.0.0.1:8787/api/health 2>/dev/null)
    if [ "$CODE" = "200" ]; then
      log "Worker local đã sẵn sàng sau ${i}s"
      break
    fi
  done

  CODE=$(curl -s --max-time 5 -o /dev/null -w "%{http_code}" http://127.0.0.1:8787/api/health 2>/dev/null)
  if [ "$CODE" != "200" ]; then
    log "LỖI: Worker local không khởi động được (code=$CODE)"
    cat > "$LOG_DIR/latest.json" << EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "total": 1, "pass": 0, "fail": 1,
  "error": "Không khởi động được Worker local",
  "results": [{ "group": "runner", "name": "Worker local khởi động", "ok": false, "detail": "HTTP $CODE" }]
}
EOF
    exit 1
  fi

  export WORKER_URL="http://127.0.0.1:8787"
  export ADMIN_PASSWORD="changeme"
else
  log "Production phản hồi OK (code=$WORKER_UP) -> test production"
fi

# --- Chạy bộ test ---
log "Bắt đầu chạy bộ kiểm thử tự động"
node "$ROOT/test/auto.mjs" >> "$LOG" 2>&1
EXIT=$?

if [ $EXIT -eq 0 ]; then
  log "KẾT QUẢ: TẤT CẢ ĐẠT"
else
  log "KẾT QUẢ: CÓ LỖI (exit=$EXIT) - xem $LOG_DIR/latest.md"
fi

exit $EXIT
