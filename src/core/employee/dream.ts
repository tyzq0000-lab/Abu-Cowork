import { exists, readTextFile } from '@tauri-apps/plugin-fs';

import { useChatStore } from '@/stores/chatStore';
import type { Message, SubagentDefinition } from '@/types';
import { atomicWrite } from '@/utils/atomicFs';
import { ensureParentDir, joinPath } from '@/utils/pathUtils';
import { resolveEmployeeMemoryPath } from '../agent/employeeMemory';
import { loadMessages } from '../session/conversationStorage';
import {
  buildMemoryTranscript,
  extractMemoriesFromConversation,
  type MemoryExtractionResult,
} from '../memdir/extractor';
import { getMemoryDir } from '../memdir/paths';

const DREAM_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_TRANSCRIPT_CHARS = 30_000;

interface DreamState {
  schemaVersion: 1;
  lastRunAt: number;
}
export interface EmployeeDreamRunResult {
  status: 'completed' | 'disabled' | 'not-due' | 'no-history';
  extraction?: MemoryExtractionResult;
}

const activeRuns = new Map<string, Promise<EmployeeDreamRunResult>>();

async function statePath(memoryPath: string): Promise<string> {
  return joinPath(await getMemoryDir(memoryPath), 'dream-state.json');
}

async function readState(memoryPath: string): Promise<DreamState | null> {
  const path = await statePath(memoryPath);
  if (!(await exists(path))) return null;
  try {
    const value = JSON.parse(await readTextFile(path)) as Partial<DreamState>;
    return value.schemaVersion === 1 && typeof value.lastRunAt === 'number'
      ? value as DreamState
      : null;
  } catch {
    return null;
  }
}

async function writeState(memoryPath: string, lastRunAt: number): Promise<void> {
  const path = await statePath(memoryPath);
  await ensureParentDir(path);
  await atomicWrite(path, JSON.stringify({ schemaVersion: 1, lastRunAt } satisfies DreamState));
}

function historicalMessages(
  messages: readonly Message[],
  isCurrent: boolean,
  force: boolean,
): readonly Message[] {
  if (force || !isCurrent) return messages;
  return messages.length > 20 ? messages.slice(0, -20) : [];
}

async function buildDreamTranscript(input: {
  agent: SubagentDefinition;
  conversationId: string;
  workspacePath: string | null;
  memoryPath: string;
  maxSessions: number;
  force: boolean;
}): Promise<string> {
  const store = useChatStore.getState();
  const indexed = Object.values(store.conversationIndex)
    .filter((meta) => meta.agentName === input.agent.name)
    .filter((meta) => resolveEmployeeMemoryPath(
      input.agent,
      meta.workspacePath ?? null,
      meta.id,
    ) === input.memoryPath)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  if (!indexed.some((meta) => meta.id === input.conversationId)) {
    const current = store.conversations[input.conversationId];
    if (current) {
      indexed.unshift({
        id: current.id,
        title: current.title,
        createdAt: current.createdAt,
        updatedAt: current.updatedAt,
        messageCount: current.messages.length,
        workspacePath: input.workspacePath,
        agentName: input.agent.name,
      });
    }
  }

  const sections: string[] = [];
  for (const meta of indexed.slice(0, input.maxSessions)) {
    const loaded = store.conversations[meta.id]?.messages ?? await loadMessages(meta.id);
    const messages = historicalMessages(loaded, meta.id === input.conversationId, input.force);
    if (messages.length < 4) continue;
    const transcript = buildMemoryTranscript(messages);
    if (transcript.length < 50) continue;
    sections.push(`### ${meta.title || '未命名会话'} · ${new Date(meta.updatedAt).toISOString().slice(0, 10)}\n${transcript}`);
  }
  return sections.join('\n\n').slice(0, MAX_TRANSCRIPT_CHARS);
}

export async function runEmployeeDream(input: {
  agent: SubagentDefinition;
  conversationId: string;
  workspacePath: string | null;
  force?: boolean;
}): Promise<EmployeeDreamRunResult> {
  const { agent, conversationId, workspacePath } = input;
  const force = input.force === true;
  if (agent.source !== 'employee'
    || !agent.dream?.enabled
    || !agent.memoryAutoCapture?.length
    || (agent.memory ?? 'session') === 'session') {
    return { status: 'disabled' };
  }
  if (!force && agent.dream.schedule !== 'daily') return { status: 'disabled' };

  const memoryPath = resolveEmployeeMemoryPath(agent, workspacePath, conversationId);
  if (!memoryPath) return { status: 'disabled' };
  const running = activeRuns.get(memoryPath);
  if (running) return running;

  const run = (async (): Promise<EmployeeDreamRunResult> => {
    const now = Date.now();
    if (!force) {
      const state = await readState(memoryPath);
      if (state && now - state.lastRunAt < DREAM_INTERVAL_MS) return { status: 'not-due' };
    }

    const transcript = await buildDreamTranscript({
      agent,
      conversationId,
      workspacePath,
      memoryPath,
      maxSessions: agent.dream!.sessionScan.maxSessions,
      force,
    });
    if (!transcript) return { status: 'no-history' };

    const extraction = await extractMemoriesFromConversation(conversationId, workspacePath, {
      memoryPath,
      allowedCaptures: agent.memoryAutoCapture,
      writeMode: agent.memoryWrites ?? 'approval',
      agentName: agent.name,
      mode: 'dream',
      transcript,
    });
    await writeState(memoryPath, now);
    return { status: 'completed', extraction };
  })().finally(() => activeRuns.delete(memoryPath));

  activeRuns.set(memoryPath, run);
  return run;
}
