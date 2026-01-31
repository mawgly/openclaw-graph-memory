/**
 * Graphiti Auto-Memory Plugin for Clawdbot
 * 
 * Automatically:
 * 1. Searches Graphiti for relevant context before agent responses
 * 2. Injects found context into the agent's system prompt
 * 3. Sends ALL messages to Graphiti (it extracts what's important)
 * 
 * v2.0 - No filtering, Graphiti LLM decides what to extract
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// Plugin configuration interface
interface GraphitiMemoryConfig {
  enabled?: boolean;
  searchLimit?: number;
  minScore?: number;
  autoExtract?: boolean;
  groupId?: string;
}

// Default configuration
const DEFAULT_CONFIG: Required<GraphitiMemoryConfig> = {
  enabled: true,
  searchLimit: 5,
  minScore: 0.5,
  autoExtract: true,
  groupId: "main",
};

// System messages to skip (not useful for memory)
const SYSTEM_MESSAGES = [
  "NO_REPLY",
  "HEARTBEAT_OK",
  "HEARTBEAT",
];

/**
 * Check if message is system/internal
 */
function isSystemMessage(content: unknown): boolean {
  if (typeof content !== "string") return false;
  const trimmed = content.trim();
  return SYSTEM_MESSAGES.some(sys => 
    trimmed === sys || trimmed.startsWith(sys)
  );
}

/**
 * Extract string content from various message formats
 */
function extractContent(input: unknown): string {
  if (typeof input === "string") return input;
  if (Array.isArray(input)) {
    // Handle array of message objects
    const textParts = input
      .map(item => {
        if (typeof item === "string") return item;
        if (item?.content) return extractContent(item.content);
        if (item?.text) return item.text;
        return "";
      })
      .filter(Boolean);
    return textParts.join(" ");
  }
  if (input && typeof input === "object") {
    const obj = input as Record<string, unknown>;
    if (obj.content) return extractContent(obj.content);
    if (obj.text) return String(obj.text);
  }
  return "";
}

/**
 * Call Graphiti via mcporter CLI
 */
async function callGraphiti(method: string, params: Record<string, unknown>): Promise<unknown> {
  const paramsStr = Object.entries(params)
    .map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"').replace(/\n/g, ' ')}"`)
    .join(" ");
  
  // Use full path and ensure HOME is set for mcporter config
  const mcporterPath = "/opt/homebrew/bin/mcporter";
  const command = `${mcporterPath} call graphiti.${method} ${paramsStr}`;
  
  try {
    const { stdout } = await execAsync(command, { 
      timeout: 30000,
      env: {
        ...process.env,
        HOME: process.env.HOME || "/Users/mawgly",
        PATH: `/opt/homebrew/bin:${process.env.PATH || ""}`,
      },
    });
    return JSON.parse(stdout);
  } catch (error) {
    console.error(`[graphiti-memory] Failed to call ${method}:`, error);
    return null;
  }
}

/**
 * Search Graphiti for relevant context
 */
async function searchContext(query: string, limit: number): Promise<string | null> {
  if (!query?.trim()) return null;
  
  const result = await callGraphiti("search_nodes", { query, limit }) as {
    nodes?: Array<{ name: string; summary: string }>;
  } | null;
  
  if (!result?.nodes?.length) return null;
  
  const contextLines = result.nodes.map((node, i) => 
    `${i + 1}. **${node.name}**: ${node.summary}`
  );
  
  return `## Relevant Memory Context\n${contextLines.join("\n")}`;
}

/**
 * Extract key topics from message for search
 */
function extractSearchQuery(content: string): string {
  // Take first 300 chars, remove special chars
  return content
    .slice(0, 300)
    .replace(/[^\w\sа-яА-ЯёЁ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Save message to Graphiti memory
 * NO FILTERING - Graphiti LLM will extract what's important
 */
async function saveToMemory(
  role: "user" | "assistant",
  content: string,
  groupId: string
): Promise<void> {
  // Only skip truly empty or system messages
  if (!content?.trim()) return;
  if (isSystemMessage(content)) return;
  
  const timestamp = new Date().toISOString();
  const dateStr = timestamp.split("T")[0];
  const timeStr = timestamp.split("T")[1]?.slice(0, 5) || "";
  
  const name = role === "user" 
    ? `Павел ${dateStr} ${timeStr}` 
    : `Бэта ${dateStr} ${timeStr}`;
  
  // Send to Graphiti - it will extract entities/relations via LLM
  await callGraphiti("add_memory", {
    name,
    episode_body: content.slice(0, 2000), // Reasonable limit
    source: "text",
    group_id: groupId,
  });
  
  console.log(`[graphiti-memory] Saved ${role} message to Graphiti`);
}

/**
 * Plugin registration
 */
export default function register(api: any) {
  const getConfig = (): Required<GraphitiMemoryConfig> => {
    const pluginConfig = api.config?.plugins?.entries?.["graphiti-memory"]?.config ?? {};
    return { ...DEFAULT_CONFIG, ...pluginConfig };
  };

  // Before agent starts - inject relevant context
  api.on("before_agent_start", async (event: any, ctx: any) => {
    const config = getConfig();
    if (!config.enabled) return;

    try {
      // Get the user's message to search for context
      const rawMessage = event.messages?.[0]?.content || event.prompt || "";
      const userMessage = extractContent(rawMessage);
      if (!userMessage || isSystemMessage(userMessage)) return;

      const searchQuery = extractSearchQuery(userMessage);
      if (!searchQuery || searchQuery.length < 3) return;

      console.log(`[graphiti-memory] Searching for context: "${searchQuery.slice(0, 50)}..."`);
      
      const context = await searchContext(searchQuery, config.searchLimit);
      if (!context) {
        console.log(`[graphiti-memory] No relevant context found`);
        return;
      }

      console.log(`[graphiti-memory] Injecting context into prompt`);
      
      // Return context to be prepended to the conversation
      return {
        prependContext: context,
      };
    } catch (error) {
      console.error("[graphiti-memory] before_agent_start error:", error);
    }
  }, { priority: 100 });

  // Message received - save ALL user messages (Graphiti extracts what's important)
  api.on("message_received", async (event: any, ctx: any) => {
    const config = getConfig();
    if (!config.enabled || !config.autoExtract) return;

    try {
      const content = extractContent(event.content || "");
      await saveToMemory("user", content, config.groupId);
    } catch (error) {
      console.error("[graphiti-memory] message_received error:", error);
    }
  }, { priority: 50 });

  // Message sent - save ALL assistant responses (Graphiti extracts what's important)
  api.on("message_sent", async (event: any, ctx: any) => {
    const config = getConfig();
    if (!config.enabled || !config.autoExtract) return;

    try {
      const content = extractContent(event.content || "");
      await saveToMemory("assistant", content, config.groupId);
    } catch (error) {
      console.error("[graphiti-memory] message_sent error:", error);
    }
  }, { priority: 50 });

  console.log("[graphiti-memory] Plugin v2.0 registered (no filtering, Graphiti LLM extracts)");
}

export const id = "graphiti-memory";
export const name = "Graphiti Auto-Memory";
