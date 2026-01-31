#!/bin/bash
# Context Monitor for Clawdbot
# Alerts via Telegram when context usage exceeds threshold

# Configuration (edit these or use environment variables)
THRESHOLD="${CONTEXT_THRESHOLD:-80}"
TELEGRAM_TOKEN="${TELEGRAM_BOT_TOKEN:-your_bot_token_here}"
CHAT_ID="${TELEGRAM_CHAT_ID:-your_chat_id_here}"
LOG="${HOME}/.clawdbot/logs/context-monitor.log"

# Ensure PATH includes clawdbot
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

# Create log directory if needed
mkdir -p "$(dirname "$LOG")"

echo "$(date): Running context monitor..." >> "$LOG"

# Get context usage percentage from clawdbot
PERCENT=$(clawdbot status --json 2>/dev/null | grep -o '"percentUsed": [0-9]*' | head -1 | grep -o '[0-9]*')

echo "$(date): Context usage: ${PERCENT}%" >> "$LOG"

# Exit if we couldn't get the percentage
if [ -z "$PERCENT" ]; then
  echo "$(date): Could not get context percentage, exiting" >> "$LOG"
  exit 0
fi

# Alert if over threshold
if [ "$PERCENT" -ge "$THRESHOLD" ]; then
  MESSAGE="⚠️ Clawdbot Context Alert: ${PERCENT}% — session reload recommended"
  
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage" \
    -d "chat_id=${CHAT_ID}" \
    -d "text=${MESSAGE}" \
    > /dev/null
    
  echo "$(date): Alert sent! (${PERCENT}% >= ${THRESHOLD}%)" >> "$LOG"
fi
