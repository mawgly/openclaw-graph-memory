# Система памяти для Clawdbot

**Версия:** 2.2
**Дата обновления:** 2026-01-31

---

## Обзор

Память хранится в **Graphiti Knowledge Graph**. Это граф знаний с сущностями, связями и временными метками.

| Компонент | Назначение |
|-----------|------------|
| Graphiti + FalkorDB | Хранение сущностей, связей, фактов |
| graphiti-memory plugin | Автоматический injection контекста в промпт |
| qmd | Fallback-поиск по транскриптам сессий |

```
┌────────────────────────────────────────────────────────────────┐
│                       CLAWDBOT                                 │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │            graphiti-memory plugin (auto-inject)          │ │
│  │  • before_agent_start → inject context from Graphiti     │ │
│  │  • message_received → save user message                  │ │
│  │  • message_sent → save assistant response                │ │
│  └──────────────────────────────────────────────────────────┘ │
│                              ↕                                 │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │                    GRAPHITI MCP                          │  │
│  │  • search_nodes — поиск сущностей                       │  │
│  │  • add_memory — добавление эпизода                      │  │
│  │  • search_memory_facts — поиск фактов                   │  │
│  │  • get_episodes — чтение сохранённых сессий             │  │
│  └─────────────────────────────────────────────────────────┘  │
│                              ↕                                 │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │                     FALKORDB                             │  │
│  │              (Graph Database, Redis-based)               │  │
│  └─────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

---

## Установка

### 1. FalkorDB + Graphiti MCP (Docker)

```bash
mkdir -p ~/Desktop/BetaVibe/graphiti
cd ~/Desktop/BetaVibe/graphiti

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

### 2. Автозапуск (macOS launchd)

```bash
cat > ~/Library/LaunchAgents/com.graphiti.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.graphiti</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/docker</string>
        <string>compose</string>
        <string>-f</string>
        <string>/Users/YOUR_USER/Desktop/BetaVibe/graphiti/docker-compose.yml</string>
        <string>up</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
EOF

sed -i '' "s/YOUR_USER/$(whoami)/" ~/Library/LaunchAgents/com.graphiti.plist
launchctl load ~/Library/LaunchAgents/com.graphiti.plist
```

### 3. mcporter (CLI для Graphiti)

```bash
npm install -g mcporter
mcporter add graphiti --url http://localhost:8000/mcp/
mcporter call graphiti.get_status
```

### 4. qmd (fallback-поиск по транскриптам)

```bash
bun install -g qmd
qmd collection add ~/clawd/memory --name memory --mask "**/*.md"
qmd status
```

---

## graphiti-memory плагин

**Путь:** `~/.clawdbot/extensions/graphiti-memory/`

### Манифест (clawdbot.plugin.json)

```json
{
  "id": "graphiti-memory",
  "name": "Graphiti Auto-Memory",
  "version": "2.0.0",
  "description": "Automatic memory injection using Graphiti knowledge graph",
  "configSchema": {
    "properties": {
      "enabled": { "type": "boolean", "default": true },
      "searchLimit": { "type": "number", "default": 10 },
      "autoExtract": { "type": "boolean", "default": true },
      "groupId": { "type": "string", "default": "main" }
    }
  }
}
```

### Код (index.ts)

```typescript
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

interface GraphitiMemoryConfig {
  enabled?: boolean;
  searchLimit?: number;
  autoExtract?: boolean;
  groupId?: string;
}

const DEFAULT_CONFIG: Required<GraphitiMemoryConfig> = {
  enabled: true,
  searchLimit: 10,
  autoExtract: true,
  groupId: "main",
};

const SYSTEM_MESSAGES = ["NO_REPLY", "HEARTBEAT_OK", "HEARTBEAT"];

function isSystemMessage(content: unknown): boolean {
  if (typeof content !== "string") return false;
  return SYSTEM_MESSAGES.some(sys => content.trim().startsWith(sys));
}

function extractContent(input: unknown): string {
  if (typeof input === "string") return input;
  if (Array.isArray(input)) {
    return input
      .map(item => item?.text || item?.content || "")
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

async function callGraphiti(method: string, params: Record<string, unknown>): Promise<unknown> {
  const paramsStr = Object.entries(params)
    .map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"').replace(/\n/g, ' ')}"`)
    .join(" ");
  
  try {
    const { stdout } = await execAsync(
      `/opt/homebrew/bin/mcporter call graphiti.${method} ${paramsStr}`,
      { timeout: 30000 }
    );
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

async function searchContext(query: string, limit: number): Promise<string | null> {
  const result = await callGraphiti("search_nodes", { query, limit }) as {
    nodes?: Array<{ name: string; summary: string }>;
  } | null;
  
  if (!result?.nodes?.length) return null;
  
  const lines = result.nodes.map((n, i) => `${i + 1}. **${n.name}**: ${n.summary}`);
  return `## Relevant Memory Context\n${lines.join("\n")}`;
}

async function saveToMemory(role: string, content: string, groupId: string): Promise<void> {
  if (!content?.trim() || isSystemMessage(content)) return;
  
  const date = new Date().toISOString().split("T")[0];
  const name = `${role === "user" ? "Павел" : "Бэта"} ${date}`;
  
  await callGraphiti("add_memory", {
    name,
    episode_body: content.slice(0, 2000),
    source: "text",
    group_id: groupId,
  });
}

export default function register(api: any) {
  const getConfig = () => ({ ...DEFAULT_CONFIG, ...api.config });

  api.on("before_agent_start", async (event: any) => {
    const config = getConfig();
    if (!config.enabled) return;

    const userMessage = extractContent(event.messages?.[0]?.content || "");
    if (!userMessage || isSystemMessage(userMessage)) return;

    const query = userMessage.slice(0, 300).replace(/[^\w\sа-яА-ЯёЁ]/g, " ").trim();
    const context = await searchContext(query, config.searchLimit);
    
    if (context) return { prependContext: context };
  }, { priority: 100 });

  api.on("message_received", async (event: any) => {
    const config = getConfig();
    if (!config.enabled || !config.autoExtract) return;
    await saveToMemory("user", extractContent(event.content), config.groupId);
  }, { priority: 50 });

  api.on("message_sent", async (event: any) => {
    const config = getConfig();
    if (!config.enabled || !config.autoExtract) return;
    await saveToMemory("assistant", extractContent(event.content), config.groupId);
  }, { priority: 50 });
}

export const id = "graphiti-memory";
export const name = "Graphiti Auto-Memory";
```

### Конфигурация Clawdbot

```yaml
# ~/.clawdbot/config.yaml
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

---

## Использование

### Поиск в памяти

```bash
# Поиск сущностей
mcporter call graphiti.search_nodes query="тема"

# Поиск фактов
mcporter call graphiti.search_memory_facts query="тема"

# Чтение последних сессий
mcporter call graphiti.get_episodes max_episodes=3
```

### Сохранение контекста сессии

```bash
mcporter call graphiti.add_memory \
  name="Контекст сессии 2026-01-31" \
  episode_body="Что делали: ... Решения: ... Следующие шаги: ..." \
  source="text"
```

### Fallback через qmd

Если Graphiti не нашёл — искать по транскриптам:
```bash
qmd search "запрос" -c memory
qmd update -c memory  # обновить индекс
```

---

## Настройка агента (AGENTS.md)

При /new агент выполняет:

1. "Привет! Дай секунду — вспомню контекст..."
2. `qmd update -c memory`
3. Поиск в Graphiti:
   ```bash
   mcporter call graphiti.search_nodes query="последняя сессия контекст"
   mcporter call graphiti.get_episodes max_episodes=3
   ```
4. `sessions_list` + `process list`
5. Краткий отчёт + "Чем займёмся?"

---

## Ограничения Graphiti

**Graphiti извлекает сущности, не контекст разговора.**

Пример:
- Сообщение: "Скачаем вложения из Яндекс.Почты через himalaya"
- Graphiti создаёт: ноду "Яндекс.Почта", ноду "himalaya"
- НЕ сохраняет: "скачаем вложения" — это контекст

**Решение:** Для сохранения полного контекста сессии использовать ручное `add_memory` с человекочитаемым текстом.

---

## Диагностика

```bash
docker ps | grep -E "falkor|graphiti"
mcporter call graphiti.get_status
clawdbot plugins list
clawdbot logs | grep graphiti
```

---

## Порты

| Сервис | Порт |
|--------|------|
| FalkorDB | 6379 |
| FalkorDB UI | 3000 |
| Graphiti MCP | 8000 |
