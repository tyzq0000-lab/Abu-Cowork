import { useDiscoveryStore } from '@/stores/discoveryStore';
import { useI18n } from '@/i18n';
import { DEFAULT_AGENT_KEY } from '@/utils/contacts';

export interface ContactDisplay {
  /** Registry key (agentName). 'abu' = default 扶摇 assistant. */
  key: string;
  name: string;
  avatar: string;
  profession: string;
  isDefault: boolean;
}

/**
 * Resolve a digital-employee contact's display fields (name / avatar / profession)
 * from the same source as the sidebar ContactList (`discoveryStore.agents`), so the
 * chat header and conversation-history drawer stay in sync with the rail. A null /
 * 'abu' key resolves to the default 扶摇 assistant.
 */
export function useContactDisplay(agentKey: string | null): ContactDisplay {
  const { t, locale } = useI18n();
  const agents = useDiscoveryStore((s) => s.agents);

  const key = agentKey || DEFAULT_AGENT_KEY;
  if (key === DEFAULT_AGENT_KEY) {
    return {
      key,
      name: t.common.appName,
      avatar: '🍮',
      profession: t.sidebar.defaultAssistant,
      isDefault: true,
    };
  }

  const a = agents.find((x) => x.name === key);
  return {
    key,
    name: a?.displayNames?.[locale] ?? a?.name ?? key,
    avatar: a?.avatar ?? '🤖',
    profession: a?.descriptions?.[locale] ?? a?.description ?? '',
    isDefault: false,
  };
}
