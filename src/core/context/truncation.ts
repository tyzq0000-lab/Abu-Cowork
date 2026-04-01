/**
 * Tool Result Truncation — intelligent truncation by tool type
 *
 * Prevents context window overflow by truncating long tool results
 * while preserving the most useful information.
 */

import { TOOL_NAMES } from '../tools/toolNames';

interface TruncationRule {
  headLines: number;
  tailLines: number;
  maxChars: number;
}

const TRUNCATION_RULES: Record<string, TruncationRule> = {
  [TOOL_NAMES.READ_FILE]: { headLines: 150, tailLines: 20, maxChars: 15000 },
  [TOOL_NAMES.LIST_DIRECTORY]: { headLines: 100, tailLines: 0, maxChars: 8000 },
  [TOOL_NAMES.RUN_COMMAND]: { headLines: 150, tailLines: 30, maxChars: 15000 },
  [TOOL_NAMES.SEARCH_FILES]: { headLines: 50, tailLines: 0, maxChars: 8000 },
  [TOOL_NAMES.FIND_FILES]: { headLines: 100, tailLines: 0, maxChars: 8000 },
  [TOOL_NAMES.WEB_SEARCH]: { headLines: 0, tailLines: 0, maxChars: 8000 },
};

const DEFAULT_RULE: TruncationRule = { headLines: 0, tailLines: 0, maxChars: 3500 };

/**
 * Scale factor for truncation limits based on context pressure.
 * Returns a multiplier (0.0–1.0) that shrinks the truncation budget
 * when context is tight.
 *
 * @param contextUsagePercent - 0-100, how full the context window is
 */
export function getContextPressureScale(contextUsagePercent?: number): number {
  if (contextUsagePercent === undefined) return 1.0;
  if (contextUsagePercent < 50) return 1.0;  // plenty of room
  if (contextUsagePercent < 70) return 0.7;  // moderate pressure
  if (contextUsagePercent < 85) return 0.4;  // high pressure
  return 0.25;                                // critical — aggressive truncation
}

/**
 * Truncate a tool result based on the tool type.
 *
 * @param toolName - Name of the tool that produced the result
 * @param result - Raw result string
 * @param contextUsagePercent - Optional context usage (0-100). When provided,
 *   truncation limits are scaled down under context pressure, keeping more room
 *   for conversation history.
 */
export function truncateToolResult(toolName: string, result: string, contextUsagePercent?: number): string {
  if (!result) return result;

  const baseRule = TRUNCATION_RULES[toolName] || DEFAULT_RULE;
  const scale = getContextPressureScale(contextUsagePercent);

  // Apply context pressure scaling
  const rule: TruncationRule = scale < 1.0
    ? {
      headLines: Math.max(20, Math.floor(baseRule.headLines * scale)),
      tailLines: Math.max(5, Math.floor(baseRule.tailLines * scale)),
      maxChars: Math.max(1500, Math.floor(baseRule.maxChars * scale)),
    }
    : baseRule;

  // If within char limit, no truncation needed
  if (result.length <= rule.maxChars) return result;

  // Line-based truncation for tools with line rules
  if (rule.headLines > 0) {
    const lines = result.split('\n');
    if (lines.length > rule.headLines + rule.tailLines + 1) {
      const head = lines.slice(0, rule.headLines);
      const tail = rule.tailLines > 0 ? lines.slice(-rule.tailLines) : [];
      const omitted = lines.length - rule.headLines - rule.tailLines;
      const truncated = [
        ...head,
        `\n[... ${omitted} lines omitted ...]\n`,
        ...tail,
      ].join('\n');

      // Further trim if still too long
      if (truncated.length > rule.maxChars) {
        return charTruncate(truncated, rule.maxChars);
      }
      return truncated;
    }
  }

  // Character-based truncation (default fallback)
  return charTruncate(result, rule.maxChars);
}

/**
 * Character-level truncation preserving head and tail
 */
function charTruncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  const tailChars = Math.min(500, Math.floor(maxChars * 0.15));
  const headChars = maxChars - tailChars - 50; // 50 chars for omission message

  const head = text.slice(0, headChars);
  const tail = text.slice(-tailChars);
  const omitted = text.length - headChars - tailChars;

  return `${head}\n\n[... ${omitted} characters omitted ...]\n\n${tail}`;
}
