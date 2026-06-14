import type { ConversationMeta } from '@/core/session/conversationStorage';

/**
 * IM-style contact helpers — map conversations to their digital-employee contact.
 *
 * Kept separate from the ContactList component so React Fast Refresh stays happy
 * (component files must only export components) and so Sidebar / ChatView can
 * reuse the same grouping logic.
 */

/** Canonical key for the default 扶摇 assistant. */
export const DEFAULT_AGENT_KEY = 'abu';

/** The agent a conversation belongs to. Absent / 'abu' → the default 扶摇. */
export function conversationContactKey(meta: { agentName?: string }): string {
  return meta.agentName || DEFAULT_AGENT_KEY;
}

/**
 * Plain conversations = the IM "recents", excluding project / scheduled / trigger
 * conversations which live in their own sections.
 */
export function isPlainConversation(meta: ConversationMeta): boolean {
  return !meta.scheduledTaskId && !meta.triggerId && !meta.projectId;
}
