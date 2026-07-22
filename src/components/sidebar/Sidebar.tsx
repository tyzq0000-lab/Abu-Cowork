import { useEffect, useCallback, useState, useRef, useSyncExternalStore } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useNoticeBadgeStore } from '@/stores/noticeBadgeStore';
import { useI18n } from '@/i18n';
import { ClipboardCheck, Workflow, Wrench, Settings, Upload, HelpCircle } from 'lucide-react';
import GuideModal from '@/components/common/GuideModal';
import ProfileEditModal from '@/components/common/ProfileEditModal';
import { cn } from '@/lib/utils';
import ProjectsSection from '@/components/sidebar/ProjectsSection';
import ContactList from '@/components/sidebar/ContactList';
import { ScrollArea } from '@/components/ui/scroll-area';
import { DEFAULT_AGENT_KEY, conversationContactKey, isPlainConversation } from '@/utils/contacts';
import DefaultUserAvatar from '@/components/common/DefaultUserAvatar';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { isMacOS } from '@/utils/platform';
import { getReviewQueueSnapshot, subscribeToReviewQueue } from '@/core/approval/reviewQueue';
import { usePlatformAccountStore } from '@/stores/platformAccountStore';

function maskedPhone(phone: string): string {
  return phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
}

export default function Sidebar() {
  const conversationIndex = useChatStore((s) => s.conversationIndex);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const startNewConversation = useChatStore((s) => s.startNewConversation);
  const switchConversation = useChatStore((s) => s.switchConversation);
  const importConversation = useChatStore((s) => s.importConversation);
  const pendingAgentName = useChatStore((s) => s.pendingAgentName);
  const setPendingAgent = useChatStore((s) => s.setPendingAgent);
  const openToolbox = useSettingsStore((s) => s.openToolbox);
  const openAutomation = useSettingsStore((s) => s.openAutomation);
  const openSystemSettings = useSettingsStore((s) => s.openSystemSettings);
  const viewMode = useSettingsStore((s) => s.viewMode);
  const setViewMode = useSettingsStore((s) => s.setViewMode);
  const updateInfo = useSettingsStore((s) => s.updateInfo);
  const clearBadge = useNoticeBadgeStore((s) => s.clear);
  const { t } = useI18n();
  const reviewQueue = useSyncExternalStore(
    subscribeToReviewQueue,
    getReviewQueueSnapshot,
    getReviewQueueSnapshot,
  );
  const pendingReviewCount = reviewQueue.proposals.filter((proposal) => proposal.status === 'draft').length;

  // Guide modal state — auto-open on first launch only
  const setGuideShown = useSettingsStore((s) => s.setGuideShown);
  const [guideOpen, setGuideOpen] = useState(false);
  const guideCheckedRef = useRef(false);

  useEffect(() => {
    if (guideCheckedRef.current) return;
    // Wait for persist rehydration — guideShown stays false (default) until rehydrated
    const unsub = useSettingsStore.persist.onFinishHydration(() => {
      guideCheckedRef.current = true;
      if (!useSettingsStore.getState().guideShown) {
        setGuideOpen(true);
      }
    });
    // If already hydrated (e.g. hot reload), check immediately
    if (useSettingsStore.persist.hasHydrated()) {
      guideCheckedRef.current = true;
      if (!useSettingsStore.getState().guideShown) {
        setGuideOpen(true);
      }
    }
    return unsub;
  }, []);

  // Profile edit modal state
  const [profileOpen, setProfileOpen] = useState(false);
  const userNickname = useSettingsStore((s) => s.userNickname);
  const userAvatar = useSettingsStore((s) => s.userAvatar);
  const accountUser = usePlatformAccountStore((s) => s.user);
  const accountStatus = usePlatformAccountStore((s) => s.status);

  // IM 化: the "current contact" highlights the ContactList. Derived from the
  // active conversation's binding, falling back to the pending agent (set when a
  // contact is picked but no message sent yet), then the default 扶摇 assistant.
  const activeMeta = activeConversationId ? conversationIndex[activeConversationId] : null;

  // Picking a contact: jump to its most-recent conversation, or — if it has none
  // — start a fresh conversation with the pending agent bound (so the welcome
  // banner shows the persona and handleSend stamps agentName on first message).
  const handlePickContact = useCallback((agentKey: string) => {
    const recent = Object.values(useChatStore.getState().conversationIndex)
      .filter((c) => isPlainConversation(c) && conversationContactKey(c) === agentKey)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (recent) {
      switchConversation(recent.id);
      clearBadge(recent.id);
    } else {
      startNewConversation();
    }
    // Always sync pendingAgentName to the picked contact so the sidebar
    // highlight and ChatView welcome banner reflect the correct agent
    // immediately — even when switchConversation's async load hasn't settled yet.
    setPendingAgent(agentKey === DEFAULT_AGENT_KEY ? null : agentKey);
    setViewMode('chat');
  }, [switchConversation, clearBadge, startNewConversation, setPendingAgent, setViewMode]);

  const handleImport = async () => {
    try {
      const filePath = await openDialog({
        filters: [{ name: 'JSON', extensions: ['json'] }],
        multiple: false,
      });
      if (filePath) {
        const json = await readTextFile(filePath as string);
        importConversation(json);
      }
    } catch (err) {
      console.error('Import failed:', err);
    }
  };

  return (
    <div className="flex flex-col h-full w-[260px] bg-[var(--abu-bg-subtle)] border-r border-[var(--abu-border)]">
      {/* Drag region — covers the title bar area above sidebar content */}
      <div
        data-tauri-drag-region
        className={isMacOS() ? 'h-11 shrink-0' : 'h-8 shrink-0'}
      />

      {/* Scrollable middle section: contacts + projects */}
      <ScrollArea className="flex-1 min-h-0">
        {/* Digital-employee contacts (IM 化) */}
        <div className="px-4 pt-2 pb-0">
          <div className="px-2 py-1.5 text-[13px] font-medium text-[var(--abu-text-muted)]">
            {t.sidebar.contacts}
          </div>
        </div>
        <ContactList
          selectedAgentName={activeMeta?.agentName || pendingAgentName}
          onPick={handlePickContact}
        />

        {/* Projects Section */}
        <ProjectsSection />
      </ScrollArea>

      {/* User Section */}
      <div className="px-5 py-4 shrink-0">
        <div className="flex items-center gap-2.5">
          {/* User avatar + nickname (clickable to edit) */}
          <button
            onClick={() => setProfileOpen(true)}
            className="w-8 h-8 rounded-full overflow-hidden shrink-0 hover:ring-2 hover:ring-[var(--abu-clay-40)] transition-shadow"
            title={t.sidebar.editProfile}
          >
            {userAvatar ? (
              <img src={userAvatar} alt="Avatar" className="w-full h-full object-cover" />
            ) : (
              <DefaultUserAvatar />
            )}
          </button>
          <button
            onClick={() => openSystemSettings('account')}
            className="flex-1 min-w-0 text-left"
            title={t.account.title}
          >
            <div
              className={cn(
                'text-[13px] font-semibold truncate',
                accountUser || userNickname
                  ? 'text-[var(--abu-text-primary)]'
                  : 'text-[var(--abu-text-tertiary)]'
              )}
            >
              {accountUser?.name || (accountUser ? maskedPhone(accountUser.phone) : userNickname || t.sidebar.defaultNickname)}
            </div>
            <div className="truncate text-[11px] text-[var(--abu-text-muted)]">
              {accountUser ? maskedPhone(accountUser.phone) : accountStatus === 'authorizing' ? t.account.signingIn : t.account.signIn}
            </div>
          </button>
          {/* Import session */}
          <button
            onClick={handleImport}
            className="btn-ghost p-1.5 text-[var(--abu-text-tertiary)] hover:text-[var(--abu-text-primary)] hover:bg-[var(--abu-bg-hover)] rounded-md"
            title={t.sidebar.importSession}
          >
            <Upload className="h-3.5 w-3.5" />
          </button>
          {/* Review Queue */}
          <button
            onClick={() => setViewMode('review')}
            className={cn(
              'btn-ghost relative p-1.5 rounded-md',
              viewMode === 'review'
                ? 'text-[var(--abu-clay)] bg-[var(--abu-bg-active)]'
                : 'text-[var(--abu-text-tertiary)] hover:text-[var(--abu-text-primary)] hover:bg-[var(--abu-bg-hover)]'
            )}
            title={t.reviewQueue.title}
          >
            <ClipboardCheck className="h-3.5 w-3.5" />
            {pendingReviewCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white">
                {pendingReviewCount > 99 ? '99+' : pendingReviewCount}
              </span>
            )}
          </button>
          {/* Toolbox (entry relocated from top nav → next to settings) */}
          <button
            onClick={() => openToolbox()}
            className={cn(
              'btn-ghost p-1.5 rounded-md',
              viewMode === 'toolbox'
                ? 'text-[var(--abu-clay)] bg-[var(--abu-bg-active)]'
                : 'text-[var(--abu-text-tertiary)] hover:text-[var(--abu-text-primary)] hover:bg-[var(--abu-bg-hover)]'
            )}
            title={t.sidebar.toolbox}
          >
            <Wrench className="h-3.5 w-3.5" />
          </button>
          {/* Automation (entry relocated from top nav → next to settings) */}
          <button
            onClick={() => openAutomation()}
            className={cn(
              'btn-ghost p-1.5 rounded-md',
              viewMode === 'automation'
                ? 'text-[var(--abu-clay)] bg-[var(--abu-bg-active)]'
                : 'text-[var(--abu-text-tertiary)] hover:text-[var(--abu-text-primary)] hover:bg-[var(--abu-bg-hover)]'
            )}
            title={t.sidebar.automation}
          >
            <Workflow className="h-3.5 w-3.5" />
          </button>
          {/* Settings */}
          <button
            onClick={() => openSystemSettings(updateInfo ? 'about' : undefined)}
            className={cn(
              'btn-ghost p-1.5 rounded-md relative',
              viewMode === 'settings'
                ? 'text-[var(--abu-clay)] bg-[var(--abu-bg-active)]'
                : 'text-[var(--abu-text-tertiary)] hover:text-[var(--abu-text-primary)] hover:bg-[var(--abu-bg-hover)]'
            )}
          >
            <Settings className="h-3.5 w-3.5" />
            {updateInfo && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500" />
            )}
          </button>
          {/* Help */}
          <button
            onClick={() => setGuideOpen(true)}
            className="btn-ghost p-1.5 text-[var(--abu-text-tertiary)] hover:text-[var(--abu-text-primary)] hover:bg-[var(--abu-bg-hover)] rounded-md"
            title={t.sidebar.help}
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Guide modal */}
      <GuideModal
        open={guideOpen}
        onClose={() => { setGuideOpen(false); setGuideShown(true); }}
        onNavigateToAIServices={() => {
          useSettingsStore.getState().openSystemSettings('ai-services');
        }}
      />

      {/* Profile edit modal */}
      <ProfileEditModal open={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  );
}
