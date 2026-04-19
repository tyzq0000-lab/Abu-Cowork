/**
 * Project Migration Utility
 *
 * Scans existing conversations for common workspacePaths and suggests
 * grouping them into projects. Used for the one-time migration banner
 * when the Projects feature is first introduced.
 */

import { useChatStore } from '@/stores/chatStore';
import { useProjectStore } from '@/stores/projectStore';
import { getBaseName } from '@/utils/pathUtils';

export interface MigrationGroup {
  workspacePath: string;
  folderName: string;
  conversationIds: string[];
}

/**
 * Scan all conversations without a projectId and group them by workspacePath.
 * Returns only groups with 2+ conversations (single conversation is not worth a project).
 */
export function suggestProjectGroupings(): MigrationGroup[] {
  const conversationIndex = useChatStore.getState().conversationIndex;
  const groups = new Map<string, string[]>();

  for (const conv of Object.values(conversationIndex)) {
    if (conv.workspacePath && !conv.projectId && !conv.scheduledTaskId && !conv.triggerId) {
      const path = conv.workspacePath;
      if (!groups.has(path)) groups.set(path, []);
      groups.get(path)!.push(conv.id);
    }
  }

  // Filter: only paths not already bound to a project, with 2+ conversations
  const result: MigrationGroup[] = [];
  for (const [path, ids] of groups) {
    if (ids.length < 2) continue;
    if (useProjectStore.getState().getProjectByWorkspace(path)) continue;
    result.push({
      workspacePath: path,
      folderName: getBaseName(path),
      conversationIds: ids,
    });
  }

  // Sort by conversation count desc
  result.sort((a, b) => b.conversationIds.length - a.conversationIds.length);
  return result;
}

/**
 * Create projects from migration groups and assign conversations.
 */
export function applyMigration(groups: MigrationGroup[]): void {
  const createProject = useProjectStore.getState().createProject;
  const setConversationProject = useChatStore.getState().setConversationProject;

  for (const group of groups) {
    const projectId = createProject({
      name: group.folderName,
      workspacePath: group.workspacePath,
    });

    for (const convId of group.conversationIds) {
      setConversationProject(convId, projectId);
    }
  }
}

/**
 * Boot-time backfill: sweep every indexed conversation without a projectId
 * and auto-associate it with the project whose workspacePath matches.
 *
 * Why this exists:
 *   - `createConversation` auto-associates NEW conversations via workspace
 *     lookup (see chatStore).
 *   - `CreateProjectDialog` backfills conversations that happen to match
 *     at the moment a project is created.
 *   - But conversations created BEFORE the matching project existed (the
 *     common "I chatted here a week ago, then made a project for this
 *     folder today" flow) fall through both hooks and stay in 最近. This
 *     function is the third hook that plugs that gap on every app start.
 *
 * Idempotent: only touches `!projectId` entries, and only when a project
 * matches. Runs again on the next boot with zero effect if nothing has
 * changed. Skips scheduled/trigger conversations by design — those are
 * system-owned and don't belong to a user-facing project (mirrors the
 * filter used in `suggestProjectGroupings`).
 *
 * IM conversations are intentionally NOT skipped: if an IM channel
 * happens to bind to a workspace that's also a project, the semantic is
 * identical to any other workspace-bound conv, and letting it fall
 * through into the project's conv list lets users actually find it.
 * Same rule as createConversation's auto-associate path.
 *
 * Performance: N lookups + N in-memory mutations + 1 debounced disk
 * flush (scheduleIndexFlush coalesces).
 *
 * Returns the number of conversations that were backfilled — useful for
 * logging and tests.
 */
export function backfillProjectIds(): number {
  const conversationIndex = useChatStore.getState().conversationIndex;
  const setConversationProject = useChatStore.getState().setConversationProject;
  const getProjectByWorkspace = useProjectStore.getState().getProjectByWorkspace;

  let backfilled = 0;
  for (const conv of Object.values(conversationIndex)) {
    if (conv.projectId) continue;
    if (!conv.workspacePath) continue;
    if (conv.scheduledTaskId) continue;
    if (conv.triggerId) continue;
    const project = getProjectByWorkspace(conv.workspacePath);
    if (!project) continue;
    setConversationProject(conv.id, project.id);
    backfilled++;
  }
  return backfilled;
}
