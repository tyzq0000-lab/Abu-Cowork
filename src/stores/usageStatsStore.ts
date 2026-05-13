import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

const MAX_DAYS = 90;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface UsageEntry {
  skill: string | null;
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface DailyRecord {
  date: string; // YYYY-MM-DD
  entries: UsageEntry[];
}

export interface ConversationUsage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

interface RecordTurnParams {
  sessionId: string;
  model: string;
  skill: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

interface UsageStatsState {
  records: DailyRecord[];
  conversationTotals: Record<string, ConversationUsage>;
}

interface UsageStatsActions {
  recordTurn: (params: RecordTurnParams) => void;
  clearConversationUsage: (sessionId: string) => void;
  getRecord: (date: string) => DailyRecord | undefined;
  getRecentRecords: (days: number) => DailyRecord[];
  getConversationUsage: (sessionId: string) => ConversationUsage | undefined;
}

type UsageStatsStore = UsageStatsState & UsageStatsActions;

export const useUsageStatsStore = create<UsageStatsStore>()(
  persist(
    immer((set, get) => ({
      records: [],
      conversationTotals: {},

      recordTurn: ({ sessionId, model, skill, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens }) => {
        if (inputTokens === 0 && outputTokens === 0) return;
        const date = today();
        set((state) => {
          // --- Daily aggregation ---
          let dayRecord = state.records.find((r) => r.date === date);
          if (!dayRecord) {
            state.records.push({ date, entries: [] });
            dayRecord = state.records[state.records.length - 1];
          }

          let entry = dayRecord.entries.find(
            (e) => e.skill === skill && e.model === model,
          );
          if (!entry) {
            dayRecord.entries.push({
              skill,
              model,
              requests: 0,
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheCreationTokens: 0,
            });
            entry = dayRecord.entries[dayRecord.entries.length - 1];
          }

          entry.requests += 1;
          entry.inputTokens += inputTokens;
          entry.outputTokens += outputTokens;
          entry.cacheReadTokens += cacheReadTokens;
          entry.cacheCreationTokens += cacheCreationTokens;

          // Keep only the most recent MAX_DAYS
          if (state.records.length > MAX_DAYS) {
            state.records.sort((a, b) => a.date.localeCompare(b.date));
            state.records.splice(0, state.records.length - MAX_DAYS);
          }

          // --- Per-conversation total ---
          const conv = state.conversationTotals[sessionId] ?? {
            requests: 0,
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
          };
          state.conversationTotals[sessionId] = {
            requests: conv.requests + 1,
            inputTokens: conv.inputTokens + inputTokens,
            outputTokens: conv.outputTokens + outputTokens,
            cacheReadTokens: conv.cacheReadTokens + cacheReadTokens,
            cacheCreationTokens: conv.cacheCreationTokens + cacheCreationTokens,
          };
        });
      },

      clearConversationUsage: (sessionId) => {
        set((state) => {
          delete state.conversationTotals[sessionId];
        });
      },

      getRecord: (date) => get().records.find((r) => r.date === date),

      getRecentRecords: (days) => {
        const sorted = get().records.slice().sort((a, b) => a.date.localeCompare(b.date));
        return sorted.slice(-days);
      },

      getConversationUsage: (sessionId) => get().conversationTotals[sessionId],
    })),
    {
      name: 'abu-usage-stats',
      version: 2,
      migrate: (persisted, version) => {
        const state = persisted as Record<string, unknown>;
        if (version < 2) {
          state.conversationTotals = {};
        }
        return state;
      },
    },
  ),
);
