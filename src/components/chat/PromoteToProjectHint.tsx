/**
 * PromoteToProjectHint — a light one-line hint rendered under the welcome
 * ChatInput when the user has bound a workspace that isn't yet part of
 * any project. Offers a low-friction "升格为项目" shortcut that opens
 * CreateProjectDialog pre-filled with the current folder, or a "忽略"
 * that persists a per-workspace dismissal (see projectHintStore).
 *
 * Visibility gates (all must hold):
 *   - workspacePath is non-empty
 *   - no existing project binds this workspacePath
 *   - user hasn't dismissed this workspacePath before
 *
 * Not shown in chat variant or when a workspace is missing.
 */

import { useState } from 'react';
import { Lightbulb } from 'lucide-react';
import { useProjectStore } from '@/stores/projectStore';
import { useProjectHintStore } from '@/stores/projectHintStore';
import { getBaseName } from '@/utils/pathUtils';
import { useI18n, format } from '@/i18n';
import CreateProjectDialog from '@/components/common/CreateProjectDialog';

interface PromoteToProjectHintProps {
  workspacePath: string | null;
}

export default function PromoteToProjectHint({ workspacePath }: PromoteToProjectHintProps) {
  const { t } = useI18n();
  const [dialogOpen, setDialogOpen] = useState(false);

  const existingProject = useProjectStore((s) =>
    workspacePath ? s.getProjectByWorkspace(workspacePath) : undefined,
  );
  const isDismissed = useProjectHintStore((s) =>
    workspacePath ? s.dismissedWorkspaces.includes(workspacePath) : false,
  );
  const dismiss = useProjectHintStore((s) => s.dismiss);

  if (!workspacePath) return null;
  if (existingProject) return null;
  if (isDismissed) return null;

  const folderName = getBaseName(workspacePath);

  return (
    <>
      <div className="flex items-center gap-2 px-1 pt-2 text-[12px] text-[var(--abu-text-muted)]">
        <Lightbulb className="h-3.5 w-3.5 shrink-0 text-[var(--abu-clay)]" />
        <span className="flex-1 truncate">
          {format(t.project.hintPromote, { name: folderName })}
        </span>
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="text-[var(--abu-clay)] hover:text-[var(--abu-clay-hover)] font-medium px-1"
        >
          {t.project.hintPromoteAction}
        </button>
        <button
          type="button"
          onClick={() => dismiss(workspacePath)}
          className="text-[var(--abu-text-muted)] hover:text-[var(--abu-text-primary)] px-1"
        >
          {t.project.hintPromoteDismiss}
        </button>
      </div>

      <CreateProjectDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        presetMode="existing-folder"
        presetFolder={workspacePath}
        presetName={folderName}
      />
    </>
  );
}
