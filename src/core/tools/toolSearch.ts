/**
 * ToolSearch — deferred tool loading system.
 *
 * Core tools are always sent with full schema to the LLM.
 * Deferred tools (MCP, rarely-used builtins) only expose name + description.
 * The LLM can call `tool_search` to retrieve full schemas on demand.
 *
 * Once a deferred tool's schema is fetched, it's promoted to "session core"
 * for the rest of the conversation (no repeated search needed).
 */

import type { ToolDefinition } from '../../types';
import { CORE_TOOL_NAMES } from './toolPrefetch';

/** Tools promoted to core for this session after being searched */
const sessionPromotedTools = new Set<string>();

/**
 * Reset session promotions (call on new conversation or session start)
 */
export function resetSessionPromotions(): void {
  sessionPromotedTools.clear();
}

/**
 * Promote a tool to session-core so it's included in full schema for subsequent turns.
 */
export function promoteToolToSession(toolName: string): void {
  sessionPromotedTools.add(toolName);
}

/**
 * Check if a tool is promoted for this session.
 */
export function isSessionPromoted(toolName: string): boolean {
  return sessionPromotedTools.has(toolName);
}

/**
 * Classify tools into core (full schema) and deferred (name + description only).
 *
 * A tool is "core" if:
 * - It's in CORE_TOOL_NAMES (always loaded)
 * - It was prefetched for this turn (keyword match)
 * - It was promoted during this session (previously searched)
 *
 * @param allTools - All resolved tools for this turn
 * @param prefetchedNames - Tool names prefetched via keyword matching
 * @returns { coreTools, deferredTools }
 */
export function classifyTools(
  allTools: ToolDefinition[],
  prefetchedNames: Set<string>,
): { coreTools: ToolDefinition[]; deferredTools: ToolDefinition[] } {
  const coreTools: ToolDefinition[] = [];
  const deferredTools: ToolDefinition[] = [];

  for (const tool of allTools) {
    if (
      CORE_TOOL_NAMES.has(tool.name) ||
      prefetchedNames.has(tool.name) ||
      sessionPromotedTools.has(tool.name)
    ) {
      coreTools.push(tool);
    } else {
      deferredTools.push(tool);
    }
  }

  return { coreTools, deferredTools };
}

/**
 * Search deferred tools by query string (fuzzy matching on name + description).
 *
 * @param query - Search query (keywords or tool name fragment)
 * @param allTools - Full tool definitions to search through
 * @param maxResults - Max number of results (default 5)
 * @returns Matched tool definitions with full schema
 */
export function searchTools(
  query: string,
  allTools: ToolDefinition[],
  maxResults: number = 5,
): ToolDefinition[] {
  if (!query.trim()) return [];

  const lowerQuery = query.toLowerCase();
  const queryTerms = lowerQuery.split(/\s+/).filter(Boolean);

  // Score each tool by relevance
  const scored = allTools.map(tool => {
    const name = tool.name.toLowerCase();
    const desc = tool.description.toLowerCase();
    let score = 0;

    // Exact name match — highest priority
    if (name === lowerQuery) {
      score += 100;
    }

    // Name contains query
    if (name.includes(lowerQuery)) {
      score += 50;
    }

    // Term matching
    for (const term of queryTerms) {
      if (name.includes(term)) score += 20;
      if (desc.includes(term)) score += 5;
    }

    // Name starts with a query term
    for (const term of queryTerms) {
      if (name.startsWith(term)) score += 10;
    }

    return { tool, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(s => s.tool);
}

/**
 * Build a compact summary of deferred tools for the system prompt.
 * Format: "- tool_name — description (first line)"
 */
export function buildDeferredToolsSummary(deferredTools: ToolDefinition[]): string {
  if (deferredTools.length === 0) return '';

  const lines = deferredTools.map(t => {
    // Take first sentence or first 80 chars of description
    const desc = t.description.split(/[。\n]/)[0].slice(0, 80);
    return `- ${t.name} — ${desc}`;
  });

  return `## 延迟加载工具\n以下工具可用，但需要先通过 tool_search 获取完整参数后才能调用：\n${lines.join('\n')}`;
}
