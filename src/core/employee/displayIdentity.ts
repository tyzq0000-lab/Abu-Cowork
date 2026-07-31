import type { SubagentMetadata } from '@/types';
import type { EmployeeDeploymentRecord } from '@/stores/employeeDeploymentStore';

/** Mirrors the (unexported) AgentLocale union used by SubagentMetadata's i18n maps. */
export type IdentityLocale = 'zh-CN' | 'en-US';

export interface ResolvedEmployeeIdentity {
  name: string;
  avatar: string;
  profession: string;
}

/**
 * Platform-minted identity for an agent, if this machine deployed it from the
 * uprow platform. Matched on agentName because that is the identity key the
 * platform itself supplies at install time.
 */
export function findPlatformIdentity(
  deployments: Record<string, EmployeeDeploymentRecord>,
  agentName: string,
): EmployeeDeploymentRecord | undefined {
  return Object.values(deployments).find(
    (record) => record.agentName === agentName
      && (record.platformDisplayName || record.platformProfession || record.platformAvatar),
  );
}

/**
 * One resolver for every surface that shows a digital employee (sidebar rail,
 * chat header, history drawer), so they can never disagree about who someone is.
 *
 * Two rules, both deliberate:
 *
 * 1. **Platform identity wins over package identity.** An employee hired on the
 *    platform must appear here under the name and face the enterprise minted —
 *    「小野同学」, not the package author's 「增长运营官」. A package installed
 *    outside the platform carries none of these fields and keeps its own
 *    identity untouched, so this stays a generic mechanism rather than a
 *    per-package special case.
 *
 * 2. **The subtitle is the job title, not the blurb.** It previously read
 *    `descriptions`/`description`, which is the package's marketing sentence —
 *    a paragraph crammed into one line under the name. `profession` is the
 *    field that actually means "job title" (see the comment on SubagentMetadata),
 *    was already parsed out of the manifest, and was simply never rendered here.
 *    Description remains the fallback for packages that declare no profession.
 */
export function resolveEmployeeIdentity(
  agent: SubagentMetadata | undefined,
  agentName: string,
  deployments: Record<string, EmployeeDeploymentRecord>,
  locale: IdentityLocale,
  fallbackAvatar = '🤖',
): ResolvedEmployeeIdentity {
  const platform = findPlatformIdentity(deployments, agentName);
  return {
    name: platform?.platformDisplayName
      ?? agent?.displayNames?.[locale]
      ?? agent?.name
      ?? agentName,
    avatar: platform?.platformAvatar ?? agent?.avatar ?? fallbackAvatar,
    profession: platform?.platformProfession
      ?? agent?.professionI18n?.[locale]
      ?? agent?.profession
      ?? agent?.descriptions?.[locale]
      ?? agent?.description
      ?? '',
  };
}
