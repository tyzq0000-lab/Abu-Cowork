/**
 * Project Migration Utility
 *
 * Boot-time backfill: associates legacy conversations (created before a
 * matching project existed) with the project whose workspacePath matches.
 */

import { useChatStore } from '@/stores/chatStore';
import { useProjectStore } from '@/stores/projectStore';

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
 * system-owned and don't belong to a user-facing project.
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
