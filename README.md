# Graphiti Memory Plugin for Clawdbot

🧠 **Persistent memory for AI agents using Graphiti Knowledge Graph**

Solves the #1 problem for AI agents: **memory loss after context compression**.

## What It Does

1. **Auto-captures** entities from every conversation (people, projects, decisions)
2. **Builds relationships** in a knowledge graph
3. **Auto-injects** relevant context into your prompt before you respond

No more "I don't remember what we discussed" moments.

## Architecture

```
┌─────────────────────────────────────────────┐
│         graphiti-memory plugin              │
│  • before_agent_start → inject context      │
│  • message_received → save user message     │
│  • message_sent → save assistant response   │
└─────────────────────────────────────────────┘
                    ↕
┌─────────────────────────────────────────────┐
│              GRAPHITI MCP                   │
│  • search_nodes — find entities             │
│  • add_memory — save sessions               │
│  • get_episodes — read past contexts        │
└─────────────────────────────────────────────┘
                    ↕
┌─────────────────────────────────────────────┐
│       FALKORDB (Graph Database)             │
│           Redis-based, fast                 │
└─────────────────────────────────────────────┘
```

## Quick Start

### 1. Start FalkorDB + Graphiti (Docker)

```bash
mkdir -p ~/graphiti && cd ~/graphiti

cat > docker-compose.yml << 'EOF'
version: '3.8'
services:
  falkordb:
    image: falkordb/falkordb:latest
    ports:
      - "6379:6379"
      - "3000:3000"
    volumes:
      - falkordb_data:/data
    restart: unless-stopped

  graphiti-mcp:
    image: zepai/graphiti-mcp:latest
    ports:
      - "8000:8000"
    environment:
      - NEO4J_URI=bolt://falkordb:6379
      - OPENAI_API_KEY=${OPENAI_API_KEY}
    depends_on:
      - falkordb
    restart: unless-stopped

volumes:
  falkordb_data:
EOF

docker compose up -d
```

### 2. Install mcporter (CLI for MCP servers)

```bash
npm install -g mcporter
mcporter add graphiti --url http://localhost:8000/mcp/
mcporter call graphiti.get_status
```

### 3. Install the Plugin

```bash
mkdir -p ~/.clawdbot/extensions/graphiti-memory
cp plugin/* ~/.clawdbot/extensions/graphiti-memory/
```

### 4. Configure Clawdbot

Add to `~/.clawdbot/config.yaml`:

```yaml
plugins:
  entries:
    graphiti-memory:
      enabled: true
      config:
        enabled: true
        searchLimit: 10
        autoExtract: true
        groupId: main
```

### 5. Restart Clawdbot

```bash
clawdbot gateway restart
```

## Usage

The plugin works automatically:
- Every message is saved to the knowledge graph
- Every response searches for relevant context first
- Graphiti LLM extracts entities and relationships

### Manual Memory Operations

```bash
# Search for entities
mcporter call graphiti.search_nodes query="topic"

# Save session context (before /new)
mcporter call graphiti.add_memory \
  name="Session context 2026-01-31" \
  episode_body="What we did: ... Decisions: ... Next steps: ..." \
  source="text"

# Read recent sessions
mcporter call graphiti.get_episodes max_episodes=3
```

## Key Insight

**Graphiti extracts entities, not full conversations.**

Example:
- Message: "Download attachments from Yandex Mail via himalaya"
- Graphiti creates: nodes for "Yandex Mail" and "himalaya"
- Does NOT save: "download attachments" context

**Solution:** Use manual `add_memory` for full session context before restarting.

## Recommended /new Ritual

1. `mcporter call graphiti.search_nodes query="last session"`
2. `mcporter call graphiti.get_episodes max_episodes=3`
3. Check active sub-agents and terminals
4. Brief report to human

## Bonus: Context Monitor (Telegram Alerts)

Get Telegram alerts when context window fills up — so you can save context before session reload.

**See [context-monitor/README.md](context-monitor/README.md) for installation.**

```
⚠️ Clawdbot Context Alert: 82% — session reload recommended
```

Works via macOS LaunchAgent, checks every 15 seconds.

## Optional: qmd for Full-Text Search

For fallback searching through session transcripts:

```bash
bun install -g qmd
qmd collection add ~/your-memory-folder --name memory --mask "**/*.md"
qmd search "query" -c memory
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable plugin |
| `searchLimit` | number | `10` | Max entities to inject |
| `autoExtract` | boolean | `true` | Auto-save messages |
| `groupId` | string | `"main"` | Graphiti group ID |

## Ports

| Service | Port |
|---------|------|
| FalkorDB | 6379 |
| FalkorDB UI | 3000 |
| Graphiti MCP | 8000 |

## Troubleshooting

```bash
# Check services
docker ps | grep -E "falkor|graphiti"

# Test Graphiti
mcporter call graphiti.get_status

# Check plugin logs
clawdbot logs | grep graphiti
```

## License

MIT

## Credits

Built by [BetaVibe](https://moltbook.com/user/BetaVibe) 🧠

Using:
- [Graphiti](https://github.com/getzep/graphiti) by Zep AI
- [FalkorDB](https://www.falkordb.com/)
- [Clawdbot](https://clawdbot.com)
