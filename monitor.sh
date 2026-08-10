#!/usr/bin/env bash
set -o pipefail

# Public health check; Vercel is the only user-facing origin.
URL="https://arcoxdex.vercel.app/health"
LOG_DIR="/home/ubuntu/arc-dex-api/logs"
LOG_FILE="$LOG_DIR/monitor.log"
ALERT_FILE="$LOG_DIR/monitor.alert"
MAX_LOG_LINES=1000

mkdir -p "$LOG_DIR"

ALERT_TELEGRAM_BOT_TOKEN=""
ALERT_TELEGRAM_CHAT_ID=""
ALERT_WEBHOOK_URL=""

if [ -f /home/ubuntu/arc-dex-api/.monitor.env ]; then
  source /home/ubuntu/arc-dex-api/.monitor.env
fi

RESPONSE=""
HTTP_CODE=""
RESTARTED="false"
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

CURL_OUTPUT=$(curl -sS --max-time 10 -w "\n%{http_code}" "$URL" 2>&1)
CURL_EXIT=$?

if [ $CURL_EXIT -eq 0 ]; then
  HTTP_CODE=$(echo "$CURL_OUTPUT" | tail -n1)
  RESPONSE=$(echo "$CURL_OUTPUT" | sed '$d')
fi

send_alert() {
  local message="$1"
  if [ -n "$ALERT_TELEGRAM_BOT_TOKEN" ] && [ -n "$ALERT_TELEGRAM_CHAT_ID" ]; then
    curl -sS -X POST "https://api.telegram.org/bot$ALERT_TELEGRAM_BOT_TOKEN/sendMessage" \
      -d "chat_id=$ALERT_TELEGRAM_CHAT_ID" \
      -d "text=$message" >/dev/null 2>&1 &
  fi
  if [ -n "$ALERT_WEBHOOK_URL" ]; then
    curl -sS -X POST -H "Content-Type: application/json" \
      -d "{\"text\":\"$message\"}" "$ALERT_WEBHOOK_URL" >/dev/null 2>&1 &
  fi
}

if [ "$CURL_EXIT" -ne 0 ] || [ "$HTTP_CODE" != "200" ] || [[ "$RESPONSE" != *"\"ok\":true"* ]]; then
  STATUS="DOWN"
  echo "[$NOW] FAIL: curl_exit=$CURL_EXIT http_code=$HTTP_CODE response=${RESPONSE:0:200}" >> "$LOG_FILE"

  if [ -f "$ALERT_FILE" ]; then
    LAST_ALERT=$(cat "$ALERT_FILE" 2>/dev/null || echo 0)
  else
    LAST_ALERT=0
  fi
  NOW_EPOCH=$(date +%s)
  if [ $((NOW_EPOCH - LAST_ALERT)) -gt 3600 ]; then
    send_alert "arc-dex-api appears DOWN: $URL (curl_exit=$CURL_EXIT http_code=$HTTP_CODE)"
    echo "$NOW_EPOCH" > "$ALERT_FILE"
  fi

  if command -v systemctl >/dev/null 2>&1; then
    sudo systemctl restart arc-dex-api >/dev/null 2>&1 || true
    RESTARTED="true"
  fi
else
  STATUS="UP"
  echo "[$NOW] OK: $RESPONSE" >> "$LOG_FILE"
fi

if [ -f "$LOG_FILE" ]; then
  LINES=$(wc -l < "$LOG_FILE" 2>/dev/null || echo 0)
  if [ "$LINES" -gt "$MAX_LOG_LINES" ]; then
    tail -n "$MAX_LOG_LINES" "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
  fi
fi
