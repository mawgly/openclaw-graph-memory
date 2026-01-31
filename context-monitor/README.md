# Context Monitor for Clawdbot

Automatically monitors Clawdbot's context window usage and sends Telegram alerts when it exceeds a threshold.

## Why?

AI agents lose context when the window fills up. This monitor warns you before it happens, so you can save important context and reload the session.

## Features

- 🔔 Telegram alerts when context exceeds threshold (default: 80%)
- ⏰ Runs every 15 seconds via macOS LaunchAgent
- 📝 Logs all checks to `~/.clawdbot/logs/context-monitor.log`
- 🔐 Secrets via environment variables (not hardcoded)

## Installation

### 1. Copy the script

```bash
mkdir -p ~/.clawdbot/scripts
cp context-monitor.sh ~/.clawdbot/scripts/
chmod +x ~/.clawdbot/scripts/context-monitor.sh
```

### 2. Configure the LaunchAgent

Edit `com.clawdbot.context-monitor.plist` and replace:
- `your_bot_token_here` → Your Telegram bot token
- `your_chat_id_here` → Your Telegram chat ID

```bash
# Copy to LaunchAgents
cp com.clawdbot.context-monitor.plist ~/Library/LaunchAgents/

# Replace ${HOME} with actual path
sed -i '' "s|\${HOME}|$HOME|g" ~/Library/LaunchAgents/com.clawdbot.context-monitor.plist
```

### 3. Load the agent

```bash
launchctl load ~/Library/LaunchAgents/com.clawdbot.context-monitor.plist
```

### 4. Verify it's running

```bash
launchctl list | grep context-monitor
tail -f ~/.clawdbot/logs/context-monitor.log
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `CONTEXT_THRESHOLD` | 80 | Alert when context usage >= this % |
| `TELEGRAM_BOT_TOKEN` | - | Your Telegram bot token |
| `TELEGRAM_CHAT_ID` | - | Your Telegram chat ID |

## Getting Telegram credentials

1. Create a bot via [@BotFather](https://t.me/BotFather) → get the token
2. Send a message to your bot
3. Get your chat ID: `curl https://api.telegram.org/bot<TOKEN>/getUpdates`

## Uninstall

```bash
launchctl unload ~/Library/LaunchAgents/com.clawdbot.context-monitor.plist
rm ~/Library/LaunchAgents/com.clawdbot.context-monitor.plist
rm ~/.clawdbot/scripts/context-monitor.sh
```

## Companion: Context Saving

When you get an alert, tell your agent to save context:

```
"Save context before reload"
```

The agent should dump important session state to memory (Graphiti, files, etc.) before you run `/new`.
