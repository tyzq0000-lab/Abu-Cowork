/**
 * SOP store — persisted per-conversation structured-SOP run state.
 *
 * A SOP (sop.json inside a skill directory) is a small node graph the
 * agent must walk through node by node, reporting each node's outcome
 * via the `sop_advance` tool. This store holds the run state so an
 * in-flight SOP survives app restarts (crash resume) and spans multiple
 * agent-loop runs — taskExecutionStore is ephemeral per loop and cannot
 * serve that role.
 *
 * Design constraints (v1):
 * - At most ONE active SOP run per conversation. A new activation is
 *   ignored while a run is 'active'; completed/aborted runs are
 *   replaced. (ponytail: multi-SOP concurrency is speculative)
 * - The full SopDefinition is snapshotted into the run at activation so
 *   resume never depends on re-resolving the skill directory.
 *
 * Pure state layer — all graph validation and advance logic lives in
 * `core/skill/sop.ts`; tool surface in `tools/definitions/sopTools.ts`.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface SopNodeDef {
  /** Stable node id, unique within the SOP */
  id: string;
  /** Short human-readable title shown in prompts */
  title: string;
  /** What the agent must do at this node */
  instruction: string;
  /** Allowed outcome values the agent may report for this node */
  outcomes: string[];
  /**
   * outcome -> next node id. An outcome with no mapping is terminal:
   * reporting it completes the SOP run.
   */
  next?: Record<string, string>;
}

export interface SopDefinition {
  /** SOP display name */
  name: string;
  version?: string;
  /** Entry node id */
  start: string;
  nodes: SopNodeDef[];
}

export interface SopCompletedNode {
  nodeId: string;
  outcome: string;
  /** Short evidence string the agent reported (not raw tool output) */
  evidence: string;
  at: number;
}

export type SopRunStatus = 'active' | 'completed' | 'aborted';

export interface SopRunState {
  /** Skill that carried the sop.json */
  skillName: string;
  /** Definition snapshot taken at activation */
  definition: SopDefinition;
  currentNodeId: string;
  completed: SopCompletedNode[];
  status: SopRunStatus;
  startedAt: number;
  updatedAt: number;
}

interface SopState {
  /** Keyed by conversationId; at most one run per conversation. */
  runs: Record<string, SopRunState>;
}

interface SopActions {
  setRun: (conversationId: string, run: SopRunState) => void;
  clearRun: (conversationId: string) => void;
}

export type SopStore = SopState & SopActions;

export const useSopStore = create<SopStore>()(
  persist(
    (set) => ({
      runs: {},

      setRun: (conversationId, run) => {
        set((state) => ({ runs: { ...state.runs, [conversationId]: run } }));
      },

      clearRun: (conversationId) => {
        set((state) => {
          if (!(conversationId in state.runs)) return state;
          const newRuns = { ...state.runs };
          delete newRuns[conversationId];
          return { runs: newRuns };
        });
      },
    }),
    {
      name: 'abu-sop',
      version: 1,
      partialize: (state) => ({ runs: state.runs }),
    },
  ),
);
