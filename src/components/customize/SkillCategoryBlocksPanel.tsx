/**
 * SkillCategoryBlocksPanel — manage "don't propose this kind" blocks.
 *
 * When a user clicks "这类别再提议" on a skill proposal card, we write
 * a feedback memory so future system prompts stop proposing similar
 * skills. Prior to Task #45 this was a one-way door — misclicks were
 * unrecoverable without editing memdir files by hand.
 *
 * This panel scans workspace feedback memories, filters to the
 * category-block pattern (see core/skill/categoryBlocks.ts), and lets
 * the user revoke blocks via `deleteMemory`. Hidden entirely when the
 * workspace has no blocks, so the Toolbox UI stays unchanged for
 * users who never hit this path.
 */

import { useCallback, useEffect, useState } from 'react';
import { Ban } from 'lucide-react';
import { useI18n, format } from '@/i18n';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useToastStore } from '@/stores/toastStore';
import { scanMemoryFiles } from '@/core/memdir/scan';
import { deleteMemory } from '@/core/memdir/write';
import {
  isCategoryBlock,
  parseCategoryBlock,
  type CategoryBlockEntry,
} from '@/core/skill/categoryBlocks';

export default function SkillCategoryBlocksPanel() {
  const { t } = useI18n();
  const workspacePath = useWorkspaceStore((s) => s.currentPath);
  const addToast = useToastStore((s) => s.addToast);

  const [blocks, setBlocks] = useState<CategoryBlockEntry[]>([]);

  const loadBlocks = useCallback(async () => {
    if (!workspacePath) {
      setBlocks([]);
      return;
    }
    try {
      const headers = await scanMemoryFiles(workspacePath);
      const entries = headers
        .filter(isCategoryBlock)
        .map(parseCategoryBlock)
        .filter((e): e is CategoryBlockEntry => e !== null)
        .sort((a, b) => b.createdAt - a.createdAt);
      setBlocks(entries);
    } catch {
      // scan failure just means we render nothing — a silent empty
      // list is better than a broken panel here.
      setBlocks([]);
    }
  }, [workspacePath]);

  useEffect(() => {
    void loadBlocks();
  }, [loadBlocks]);

  const handleUnblock = async (entry: CategoryBlockEntry) => {
    try {
      await deleteMemory(entry.filename, workspacePath);
      // Optimistic remove from the list — the memdir write is atomic
      // and already succeeded, so a follow-up scan would just confirm.
      setBlocks((prev) => prev.filter((b) => b.filename !== entry.filename));
    } catch (err) {
      addToast({
        type: 'error',
        title: t.toolbox.categoryBlocksUnblockError,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  if (blocks.length === 0) return null;

  return (
    <div className="mx-4 my-3 rounded-xl border border-[var(--abu-border)] bg-[var(--abu-bg-elevated)] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--abu-border)]">
        <div className="flex items-center gap-2">
          <Ban className="h-3.5 w-3.5 text-[var(--abu-text-muted)]" />
          <span className="text-xs font-semibold text-[var(--abu-text-primary)]">
            {t.toolbox.categoryBlocksTitle}
          </span>
          <span className="text-[11px] text-[var(--abu-text-muted)]">
            {format(t.toolbox.categoryBlocksCount, { count: String(blocks.length) })}
          </span>
        </div>
      </div>
      <div className="px-3 py-1.5 text-[11px] text-[var(--abu-text-muted)] border-b border-[var(--abu-border-subtle)]">
        {t.toolbox.categoryBlocksHint}
      </div>
      <div className="max-h-48 overflow-y-auto overlay-scroll">
        {blocks.map((entry) => (
          <div
            key={entry.filename}
            className="flex items-center gap-2 px-3 py-2 border-b border-[var(--abu-border-subtle)] last:border-b-0 hover:bg-[var(--abu-bg-active)] transition-colors"
          >
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-[var(--abu-text-primary)] truncate">
                {entry.skillName}
              </div>
              {entry.description && (
                <div className="text-[10px] text-[var(--abu-text-muted)] mt-0.5 line-clamp-1">
                  {entry.description}
                </div>
              )}
            </div>
            <button
              onClick={() => handleUnblock(entry)}
              className="px-2 py-1 rounded-md text-[11px] text-[var(--abu-text-tertiary)] hover:text-[var(--abu-text-primary)] hover:bg-[var(--abu-bg-muted)] transition-colors shrink-0"
            >
              {t.toolbox.categoryBlocksUnblock}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
