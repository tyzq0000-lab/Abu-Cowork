/**
 * ImportedBadge — small download icon pinned before a conversation title
 * in the sidebar, signaling that the conversation came from a `.abu.json`
 * share bundle someone else exported. The recipient can still continue
 * chatting; the badge only communicates provenance.
 *
 * Rendered conditionally by the caller based on `ConversationMeta.importedFrom`.
 */

import { Download } from 'lucide-react';
import { useI18n, format } from '@/i18n';

interface ImportedBadgeProps {
  importedAt?: number;
}

export default function ImportedBadge({ importedAt }: ImportedBadgeProps) {
  const { t } = useI18n();
  const dateLabel = importedAt ? new Date(importedAt).toLocaleDateString() : null;
  const title = dateLabel
    ? format(t.share.importedBadgeWithDate, { date: dateLabel })
    : t.share.importedBadge;
  return (
    <span
      className="shrink-0 h-4 w-4 flex items-center justify-center rounded text-[var(--abu-clay)]"
      title={title}
      aria-label={title}
    >
      <Download className="h-3 w-3" strokeWidth={1.75} />
    </span>
  );
}
