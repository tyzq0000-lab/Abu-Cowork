import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, X, Search, Trash2, Pencil, Download, FolderInput, FolderClosed, ChevronRight, Minus, Undo2,
} from 'lucide-react';
import { SHARE_EXT } from '@/core/branding';
import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useProjectStore } from '@/stores/projectStore';
import { useNoticeBadgeStore } from '@/stores/noticeBadgeStore';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { isMacOS } from '@/utils/platform';
import { getPlatformShortLabel } from '@/core/im/platformLabels';
import type { ConversationStatus } from '@/types';
import { Button } from '@/components/ui/button';
import ShareExportDialog from '@/components/share/ShareExportDialog';
import ImportedBadge from '@/components/sidebar/ImportedBadge';
import {
  DEFAULT_AGENT_KEY,
  conversationContactKey,
  isPlainConversation,
} from '@/utils/contacts';
import { useContactDisplay } from '@/hooks/useContactDisplay';

function StatusIndicator({ status, onComplete }: { status: ConversationStatus; onComplete: () => void }) {
  useEffect(() => {
    if (status === 'completed') {
      const timer = setTimeout(onComplete, 3000);
      return () => clearTimeout(timer);
    }
    if (status === 'error') {
      const timer = setTimeout(onComplete, 10_000);
      return () => clearTimeout(timer);
    }
  }, [status, onComplete]);

  if (status === 'running') return <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />;
  if (status === 'completed') return <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />;
  if (status === 'error') return <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />;
  return null;
}

function IMPlatformDot({ platform }: { platform: string }) {
  return (
    <span
      className="shrink-0 h-4 w-4 rounded text-[8px] font-bold leading-4 text-center bg-[var(--abu-clay-bg-15)] text-[var(--abu-clay)]"
      title={platform}
    >
      {getPlatformShortLabel(platform)}
    </span>
  );
}

/**
 * Right-side conversation-history drawer (locked IM design). Lists the selected
 * contact's plain conversations and carries the full "recents" toolkit relocated
 * from the sidebar: search, inline rename, delete + undo, export, move-to-project,
 * and status indicators. Picking a conversation or creating a new one closes the
 * drawer; management actions (rename/delete/export) keep it open.
 */
export default function ConversationHistoryDrawer({
  contactKey,
  open,
  onClose,
}: {
  contactKey: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const conversationIndex = useChatStore((s) => s.conversationIndex);
  const conversations = useChatStore((s) => s.conversations);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const switchConversation = useChatStore((s) => s.switchConversation);
  const startNewConversation = useChatStore((s) => s.startNewConversation);
  const setPendingAgent = useChatStore((s) => s.setPendingAgent);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const renameConversation = useChatStore((s) => s.renameConversation);
  const clearCompletedStatus = useChatStore((s) => s.clearCompletedStatus);
  const exportConversation = useChatStore((s) => s.exportConversation);
  const importConversation = useChatStore((s) => s.importConversation);
  const loadConversation = useChatStore((s) => s.loadConversation);
  const setViewMode = useSettingsStore((s) => s.setViewMode);
  const clearBadge = useNoticeBadgeStore((s) => s.clear);
  const projectsMap = useProjectStore((s) => s.projects);
  const contact = useContactDisplay(contactKey);

  const key = contactKey || DEFAULT_AGENT_KEY;

  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [shareConvId, setShareConvId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; convId: string } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const moveSubmenuRef = useRef<HTMLDivElement>(null);
  const [showMoveSubmenu, setShowMoveSubmenu] = useState(false);
  const [moveSubmenuStyle, setMoveSubmenuStyle] = useState<React.CSSProperties>({});
  const [pendingDelete, setPendingDelete] = useState<{ id: string; data: string } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Close context menu on any outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handle = () => { setContextMenu(null); setShowMoveSubmenu(false); };
    document.addEventListener('click', handle);
    return () => document.removeEventListener('click', handle);
  }, [contextMenu]);

  // Clamp context menu inside viewport once its real size is known.
  useLayoutEffect(() => {
    if (!contextMenu) return;
    const el = contextMenuRef.current;
    if (!el) return;
    const margin = 8;
    const rect = el.getBoundingClientRect();
    const overflowX = rect.right - (window.innerWidth - margin);
    const overflowY = rect.bottom - (window.innerHeight - margin);
    if (overflowX <= 0 && overflowY <= 0) return;
    setContextMenu((prev) => prev && {
      ...prev,
      x: Math.max(margin, prev.x - Math.max(0, overflowX)),
      y: Math.max(margin, prev.y - Math.max(0, overflowY)),
    });
  }, [contextMenu]);

  // Position the "move to project" submenu, flipping up when space is tight.
  useLayoutEffect(() => {
    if (!showMoveSubmenu) { setMoveSubmenuStyle({}); return; }
    const el = moveSubmenuRef.current;
    const trigger = el?.parentElement;
    if (!el || !trigger) return;
    const margin = 8;
    const triggerRect = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - triggerRect.top - margin;
    const spaceAbove = triggerRect.bottom - margin;
    const flipUp = el.scrollHeight > spaceBelow && spaceAbove > spaceBelow;
    const maxH = Math.max(120, flipUp ? spaceAbove : spaceBelow);
    setMoveSubmenuStyle(flipUp ? { bottom: 0, top: 'auto', maxHeight: `${maxH}px` } : { top: 0, maxHeight: `${maxH}px` });
  }, [showMoveSubmenu]);

  const convs = useMemo(
    () =>
      Object.values(conversationIndex)
        .filter((c) => isPlainConversation(c) && conversationContactKey(c) === key)
        .filter((c) => !searchQuery || c.title.toLowerCase().includes(searchQuery.toLowerCase()))
        .sort((a, b) => b.createdAt - a.createdAt),
    [conversationIndex, key, searchQuery],
  );

  const handleNew = () => {
    startNewConversation();
    setPendingAgent(key === DEFAULT_AGENT_KEY ? null : key);
    setViewMode('chat');
    onClose();
  };

  const handlePick = (id: string) => {
    const status = conversations[id]?.status ?? 'idle';
    switchConversation(id);
    clearBadge(id);
    if (status === 'error') clearCompletedStatus(id);
    setViewMode('chat');
    onClose();
  };

  const handleDelete = async (e: React.MouseEvent, convId: string) => {
    e.stopPropagation();
    await loadConversation(convId);
    const json = exportConversation(convId);
    deleteConversation(convId);
    if (json) {
      clearTimeout(undoTimerRef.current);
      setPendingDelete({ id: convId, data: json });
      undoTimerRef.current = setTimeout(() => setPendingDelete(null), 5000);
    }
  };

  const handleUndoDelete = () => {
    if (pendingDelete) {
      importConversation(pendingDelete.data);
      clearTimeout(undoTimerRef.current);
      setPendingDelete(null);
    }
  };

  const handleExport = async (convId: string) => {
    await loadConversation(convId);
    setShareConvId(convId);
    setContextMenu(null);
  };

  if (!open) return null;

  return (
    <>
      {/* Scrim */}
      <div className="fixed inset-0 z-[55] bg-black/20 animate-in fade-in duration-200" onClick={onClose} />

      {/* Panel */}
      <aside
        className={cn(
          'fixed inset-y-0 right-0 z-[60] w-80 flex flex-col bg-[var(--abu-bg-base)] border-l border-[var(--abu-border)] shadow-2xl animate-in slide-in-from-right duration-200',
          isMacOS() ? 'pt-11' : 'pt-8',
        )}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-[var(--abu-border)]">
          <div className="min-w-0 text-[14px] font-semibold text-[var(--abu-text-primary)] truncate">
            {t.sidebar.conversationHistory}
            <span className="text-[var(--abu-text-tertiary)] font-normal"> · {contact.name}</span>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-1 rounded-md text-[var(--abu-text-tertiary)] hover:text-[var(--abu-text-primary)] hover:bg-[var(--abu-bg-hover)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* New conversation (pinned top) */}
        <button
          onClick={handleNew}
          className="shrink-0 mx-3 mt-3 flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] font-medium text-[var(--abu-clay)] hover:bg-[var(--abu-clay-bg)] transition-colors"
        >
          <Plus className="h-4 w-4" />
          {t.sidebar.newConversation}
        </button>

        {/* Search */}
        <div className="shrink-0 px-3 pt-2 pb-1">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--abu-text-muted)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setSearchQuery(''); }}
              placeholder={t.sidebar.searchPlaceholder}
              className="w-full h-7 pl-8 pr-7 rounded-md text-xs bg-[var(--abu-bg-muted)] border border-[var(--abu-border-subtle)] focus:border-[var(--abu-clay-40)] focus:outline-none text-[var(--abu-text-primary)] placeholder:text-[var(--abu-text-muted)]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--abu-text-muted)] hover:text-[var(--abu-text-primary)]"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* Conversation list */}
        <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 space-y-0.5">
          {convs.length === 0 ? (
            <p className="px-3 py-2 text-[13px] text-[var(--abu-text-tertiary)]">{t.sidebar.noSessionsYet}</p>
          ) : (
            convs.map((conv) => {
              const convStatus = conversations[conv.id]?.status ?? 'idle';
              const isCurrent = conv.id === activeConversationId;
              return (
                <div
                  key={conv.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handlePick(conv.id)}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, convId: conv.id }); }}
                  className={cn(
                    'group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-colors w-full text-left',
                    isCurrent ? 'bg-[var(--abu-clay-bg)]' : 'hover:bg-[var(--abu-bg-hover)]',
                  )}
                >
                  {conv.imPlatform && <IMPlatformDot platform={conv.imPlatform} />}
                  {conv.importedFrom && <ImportedBadge importedAt={conv.importedFrom.importedAt} />}
                  {editingId === conv.id ? (
                    <input
                      autoFocus
                      defaultValue={conv.title}
                      className="flex-1 text-[13px] bg-transparent border-b border-[var(--abu-clay)] outline-none min-w-0"
                      onClick={(e) => e.stopPropagation()}
                      onBlur={(e) => {
                        const val = e.target.value.trim();
                        if (val && val !== conv.title) renameConversation(conv.id, val);
                        setEditingId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                    />
                  ) : (
                    <span className="flex-1 truncate text-[13px] text-[var(--abu-text-primary)]">
                      {conv.title.replace(/\[Attachment:\s*`[^`]*`\]\s*/g, '').trim() || conv.title}
                    </span>
                  )}
                  <StatusIndicator status={convStatus} onComplete={() => clearCompletedStatus(conv.id)} />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => handleDelete(e, conv.id)}
                    className="h-5 w-5 opacity-0 group-hover:opacity-100 text-[var(--abu-text-tertiary)] hover:text-red-500 hover:bg-transparent shrink-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-[70] bg-white rounded-lg shadow-lg border border-[var(--abu-border)] py-1 min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => { setEditingId(contextMenu.convId); setContextMenu(null); }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-[var(--abu-text-secondary)] hover:bg-[var(--abu-bg-active)]"
          >
            <Pencil className="h-3.5 w-3.5" />
            {t.sidebar.renameConversation}
          </button>
          <button
            onClick={() => handleExport(contextMenu.convId)}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-[var(--abu-text-secondary)] hover:bg-[var(--abu-bg-active)]"
          >
            <Download className="h-3.5 w-3.5" />
            {t.sidebar.exportConversation}
          </button>
          {(() => {
            const activeProjects = Object.values(projectsMap).filter((p) => !p.archived);
            if (activeProjects.length === 0) return null;
            const convMeta = conversationIndex[contextMenu.convId];
            return (
              <div className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowMoveSubmenu(!showMoveSubmenu); }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-[var(--abu-text-secondary)] hover:bg-[var(--abu-bg-active)]"
                >
                  <FolderInput className="h-3.5 w-3.5" />
                  <span className="flex-1 text-left">{t.project.moveToProject}</span>
                  <ChevronRight className="h-3 w-3" />
                </button>
                {showMoveSubmenu && (
                  <div
                    ref={moveSubmenuRef}
                    style={moveSubmenuStyle}
                    className="absolute right-full mr-1 bg-white rounded-lg shadow-lg border border-[var(--abu-border)] py-1 min-w-[140px] overflow-y-auto overscroll-contain z-10"
                  >
                    {activeProjects.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          useChatStore.getState().setConversationProject(contextMenu.convId, p.id);
                          setContextMenu(null);
                          setShowMoveSubmenu(false);
                        }}
                        className={cn(
                          'flex items-center gap-2 w-full px-3 py-1.5 text-[13px] hover:bg-[var(--abu-bg-active)]',
                          convMeta?.projectId === p.id ? 'text-[var(--abu-clay)]' : 'text-[var(--abu-text-secondary)]',
                        )}
                      >
                        <FolderClosed className="h-3.5 w-3.5" strokeWidth={1.5} />
                        <span className="truncate">{p.name}</span>
                      </button>
                    ))}
                    {convMeta?.projectId && (
                      <>
                        <div className="my-1 border-t border-[var(--abu-border)]" />
                        <button
                          onClick={() => {
                            useChatStore.getState().setConversationProject(contextMenu.convId, undefined);
                            setContextMenu(null);
                            setShowMoveSubmenu(false);
                          }}
                          className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-[var(--abu-text-tertiary)] hover:bg-[var(--abu-bg-active)]"
                        >
                          <Minus className="h-3.5 w-3.5" />
                          {t.project.removeFromProject}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
          <button
            onClick={(e) => { handleDelete(e, contextMenu.convId); setContextMenu(null); }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-red-500 hover:bg-[var(--abu-bg-active)]"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t.sidebar.deleteConversation}
          </button>
        </div>
      )}

      {/* Share export preview */}
      {shareConvId && (
        <ShareExportDialog
          convId={shareConvId}
          defaultFilename={`conversation-${conversationIndex[shareConvId]?.title || shareConvId}${SHARE_EXT}`}
          onClose={() => setShareConvId(null)}
        />
      )}

      {/* Undo delete toast */}
      {pendingDelete && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-3 px-4 py-2.5 bg-[var(--abu-text-primary)] text-white rounded-xl shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200" role="alert" aria-live="assertive">
          <span className="text-sm">{t.sidebar.conversationDeleted}</span>
          <button
            onClick={handleUndoDelete}
            className="flex items-center gap-1 text-sm font-medium text-[var(--abu-clay)] hover:text-[var(--abu-clay)] transition-colors"
          >
            <Undo2 className="h-3.5 w-3.5" />
            {t.sidebar.undo}
          </button>
        </div>
      )}
    </>
  );
}
