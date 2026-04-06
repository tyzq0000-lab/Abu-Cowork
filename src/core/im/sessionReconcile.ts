/**
 * Session Reconcile — cross-validate IM sessions with conversations after startup.
 *
 * Called once from App.tsx after both imChannelStore and chatStore have rehydrated.
 * Removes sessions pointing to deleted conversations.
 */

import { useIMChannelStore } from '../../stores/imChannelStore';
import { useChatStore } from '../../stores/chatStore';

export function reconcileIMSessions(): void {
  const imStore = useIMChannelStore.getState();
  const conversationIndex = useChatStore.getState().conversationIndex;

  // Clean up active sessions pointing to non-existent conversations
  for (const [key, session] of Object.entries(imStore.sessions)) {
    if (!conversationIndex[session.conversationId]) {
      imStore.removeSession(key);
    }
  }

  // Clean up archived sessions pointing to non-existent conversations
  for (const [key, session] of Object.entries(imStore.archivedSessions)) {
    if (!conversationIndex[session.conversationId]) {
      imStore.removeArchivedSession(key);
    }
  }
}
