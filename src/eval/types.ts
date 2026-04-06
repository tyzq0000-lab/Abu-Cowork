/**
 * Agent Eval Framework — Type Definitions
 *
 * Defines the data structures for Abu's multi-layer evaluation system:
 * - L2: Tool selection evaluation (single-turn LLM, no tool execution)
 * - L3: End-to-end task completion (multi-turn with sandbox execution)
 * - L4: Output quality judging (LLM-as-Judge)
 */

import type { ModelCapability } from '@/types/provider';

// ─── Eval Target (Provider × Model) ───

export interface EvalTarget {
  providerId: string;
  modelId: string;
  /** Display name, e.g. "Claude Sonnet 4" */
  label: string;
}

// ─── L2: Tool Selection Cases ───

export type ToolSelectionCategory =
  | 'file-ops'
  | 'search'
  | 'command'
  | 'multi-step'
  | 'skill'
  | 'memory'
  | 'web'
  | 'knowledge'
  | 'delegate';

export interface ToolSelectionCase {
  id: string;
  category: ToolSelectionCategory;
  /** User input message */
  input: string;
  /** Multi-turn context messages */
  contextMessages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  expected: {
    /** Tools that MUST be called */
    requiredTools: string[];
    /** Tools that MUST NOT be called */
    forbiddenTools?: string[];
    /** Partial parameter matching (contains semantics) */
    toolParams?: Record<string, Record<string, unknown>>;
    /** Extra tool calls that are acceptable but not required */
    optionalTools?: string[];
  };
  difficulty: 'easy' | 'medium' | 'hard';
  /** Skip this case if model lacks these capabilities */
  requiredCapabilities?: ModelCapability[];
}

// ─── L3: End-to-End Cases ───

export interface E2ECase {
  id: string;
  category: string;
  /** User task description */
  input: string;
  /** Sandbox environment setup */
  setup: {
    files?: Record<string, string>;
    dirs?: string[];
  };
  /** Success criteria */
  assertions: Assertion[];
  /** Timeout in seconds (default 60) */
  timeoutSeconds?: number;
  /** Max agent turns (default 10) */
  maxTurns?: number;
  difficulty: 'easy' | 'medium' | 'hard';
  requiredCapabilities?: ModelCapability[];
}

export type Assertion =
  | { type: 'file_exists'; path: string }
  | { type: 'file_not_exists'; path: string }
  | { type: 'file_contains'; path: string; content: string }
  | { type: 'file_not_contains'; path: string; content: string }
  | { type: 'file_matches'; path: string; regex: string }
  | { type: 'output_contains'; content: string }
  | { type: 'output_not_contains'; content: string }
  | { type: 'tool_was_called'; toolName: string; minTimes?: number; maxTimes?: number }
  | { type: 'tool_not_called'; toolName: string }
  | { type: 'turns_within'; max: number }
  | { type: 'tokens_within'; maxInput?: number; maxOutput?: number };

// ─── Results ───

export interface CaseResult {
  caseId: string;
  target: EvalTarget;
  passed: boolean;
  toolsCalled: string[];
  details: {
    missingTools: string[];
    forbiddenToolsCalled: string[];
    paramMismatches: string[];
  };
  latencyMs: number;
  tokenUsage: { input: number; output: number };
  thinking?: string;
  error?: string;
}

// ─── Aggregated Report ───

export interface CategoryStats {
  pass: number;
  total: number;
}

export interface TargetSummary {
  passRate: number;
  passCount: number;
  failCount: number;
  avgLatencyMs: number;
  totalTokens: { input: number; output: number };
}

export interface EvalReport {
  metadata: {
    timestamp: string;
    targets: EvalTarget[];
    dataset: string;
    totalCases: number;
  };
  summary: {
    byTarget: Record<string, TargetSummary>;
    byCategory: Record<string, Record<string, CategoryStats>>;
    byDifficulty: Record<string, Record<string, CategoryStats>>;
  };
  results: CaseResult[];
}

// ─── L4: Judge Scores ───

export interface JudgeScore {
  completion: number;
  toolUsage: number;
  quality: number;
  safety: number;
  overall: number;
  reason: string;
}
