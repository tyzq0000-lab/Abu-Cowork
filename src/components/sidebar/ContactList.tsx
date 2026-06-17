import { useMemo } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { useDiscoveryStore } from '@/stores/discoveryStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useNoticeBadgeStore } from '@/stores/noticeBadgeStore';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import EmployeeAvatar from '@/components/common/EmployeeAvatar';
import { DEFAULT_AGENT_KEY, conversationContactKey, isPlainConversation } from '@/utils/contacts';

interface Contact {
  /** Registry key (agentName). 'abu' = default 扶摇 assistant. */
  key: string;
  name: string;
  avatar: string;
  profession: string;
  isDefault: boolean;
  lastTime: number;
  unread: number;
}

/**
 * IM-style digital-employee contacts rail. 扶摇 (the default assistant) is pinned
 * to the top, followed by builtin personas and installed employee packages,
 * ordered by most-recent activity. Selecting a contact is handled by the parent
 * (Sidebar) via `onPick` — this component is purely presentational + derives the
 * per-contact last-active time and unread badge from the conversation index.
 */
export default function ContactList({
  selectedAgentName,
  onPick,
}: {
  selectedAgentName: string | null;
  onPick: (agentKey: string) => void;
}) {
  const { t, locale } = useI18n();
  const agents = useDiscoveryStore((s) => s.agents);
  const conversationIndex = useChatStore((s) => s.conversationIndex);
  const disabledAgents = useSettingsStore((s) => s.disabledAgents);
  const badgeCounts = useNoticeBadgeStore((s) => s.counts);

  const contacts = useMemo<Contact[]>(() => {
    const disabled = new Set(disabledAgents ?? []);

    // Aggregate per-agent activity from plain conversations.
    const lastTime = new Map<string, number>();
    const unread = new Map<string, number>();
    for (const meta of Object.values(conversationIndex)) {
      if (!isPlainConversation(meta)) continue;
      const key = conversationContactKey(meta);
      lastTime.set(key, Math.max(lastTime.get(key) ?? 0, meta.updatedAt));
      const badge = badgeCounts[meta.id] ?? 0;
      if (badge > 0) unread.set(key, (unread.get(key) ?? 0) + badge);
    }

    const built = agents
      .filter((a) => a.name === DEFAULT_AGENT_KEY || !disabled.has(a.name))
      .map<Contact>((a) => {
        const isDefault = a.name === DEFAULT_AGENT_KEY;
        return {
          key: a.name,
          name: isDefault
            ? t.common.appName
            : a.displayNames?.[locale] ?? a.name,
          avatar: a.avatar ?? (isDefault ? '🍮' : '🤖'),
          profession: isDefault
            ? t.sidebar.defaultAssistant
            : a.descriptions?.[locale] ?? a.description,
          isDefault,
          lastTime: lastTime.get(a.name) ?? 0,
          unread: unread.get(a.name) ?? 0,
        };
      });

    // 扶摇 pinned first; the rest sorted by most-recent activity, then name.
    built.sort((x, y) => {
      if (x.isDefault) return -1;
      if (y.isDefault) return 1;
      if (y.lastTime !== x.lastTime) return y.lastTime - x.lastTime;
      return x.name.localeCompare(y.name);
    });
    return built;
  }, [agents, conversationIndex, disabledAgents, badgeCounts, locale, t]);

  return (
    <div className="px-2 space-y-0.5">
      {contacts.map((c) => {
        const active = (selectedAgentName || DEFAULT_AGENT_KEY) === c.key;
        return (
          <button
            key={c.key}
            onClick={() => onPick(c.key)}
            aria-current={active ? 'true' : undefined}
            className={cn(
              'group flex items-center gap-2.5 w-full px-2 py-2 rounded-lg text-left transition-colors',
              active
                ? 'bg-[var(--abu-bg-active)]'
                : 'hover:bg-[var(--abu-bg-hover)]',
            )}
          >
            <div className="relative shrink-0 w-9 h-9 rounded-[10px] bg-[var(--abu-bg-base)] border border-[var(--abu-border)] flex items-center justify-center text-[19px] select-none overflow-hidden">
              <EmployeeAvatar avatar={c.avatar} name={c.name} />
              {c.unread > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-[var(--abu-clay)] text-white text-[10px] font-medium leading-4 text-center">
                  {c.unread > 99 ? '99+' : c.unread}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[13.5px] font-medium truncate text-[var(--abu-text-primary)]">
                  {c.name}
                </span>
                {c.isDefault && (
                  <span className="shrink-0 text-[10px] text-[var(--abu-clay)] bg-[var(--abu-clay-bg)] rounded px-1 py-px leading-none">
                    {t.sidebar.defaultAssistant}
                  </span>
                )}
              </div>
              <div className="text-[11.5px] text-[var(--abu-text-tertiary)] truncate mt-0.5">
                {c.profession}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
