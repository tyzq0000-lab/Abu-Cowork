import { History } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { useContactDisplay } from '@/hooks/useContactDisplay';
import EmployeeAvatar from '@/components/common/EmployeeAvatar';

/**
 * IM-style chat header: shows the current digital-employee contact (avatar + name
 * + profession) and a button to open the conversation-history drawer for that
 * contact. The contact is derived by the parent (ChatView) from the active
 * conversation's `agentName` or the pending agent binding.
 */
export default function ChatHeader({
  contactKey,
  onOpenHistory,
}: {
  contactKey: string | null;
  onOpenHistory: () => void;
}) {
  const { t } = useI18n();
  const c = useContactDisplay(contactKey);

  return (
    <div className="shrink-0 h-14 flex items-center gap-3 px-5 border-b border-[var(--abu-border)] bg-[var(--abu-bg-base)]">
      <div className="w-9 h-9 rounded-[10px] bg-[var(--abu-bg-subtle)] border border-[var(--abu-border)] flex items-center justify-center text-[19px] select-none shrink-0 overflow-hidden">
        <EmployeeAvatar avatar={c.avatar} name={c.name} />
      </div>
      <div className="min-w-0">
        <div className="text-[14px] font-semibold text-[var(--abu-text-primary)] truncate leading-tight">
          {c.name}
        </div>
        {c.profession && (
          <div className="text-[11px] text-[var(--abu-text-tertiary)] truncate mt-0.5">
            {c.profession}
          </div>
        )}
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onOpenHistory}
        className="ml-auto gap-1.5 shrink-0"
      >
        <History className="h-3.5 w-3.5" />
        {t.sidebar.conversationHistory}
      </Button>
    </div>
  );
}
