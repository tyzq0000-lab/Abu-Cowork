import type { ToolDefinition, ToolPolicy, ToolPolicyState } from '@/types';
import { matchesToolName } from '@/core/skill/toolFilter';

function wildcardSpecificity(pattern: string): number {
  return pattern.replace(/\*/g, '').length;
}

export function resolveToolPolicyState(
  policy: ToolPolicy | undefined,
  toolName: string,
): ToolPolicyState {
  if (!policy) return 'enabled';

  if (Object.prototype.hasOwnProperty.call(policy.overrides, toolName)) {
    return policy.overrides[toolName];
  }

  let resolved = policy.default ?? 'enabled';
  let bestSpecificity = -1;
  for (const [pattern, state] of Object.entries(policy.overrides)) {
    if (!pattern.includes('*') || !matchesToolName(toolName, pattern)) continue;
    const specificity = wildcardSpecificity(pattern);
    if (specificity > bestSpecificity) {
      resolved = state;
      bestSpecificity = specificity;
    } else if (specificity === bestSpecificity && state === 'disabled') {
      // Equal-specificity conflicts fail closed and never depend on JSON key order.
      resolved = 'disabled';
    }
  }
  return resolved;
}

export function isToolEnabled(policy: ToolPolicy | undefined, toolName: string): boolean {
  return resolveToolPolicyState(policy, toolName) === 'enabled';
}

export function filterToolsByPolicy(
  tools: ToolDefinition[],
  policy: ToolPolicy | undefined,
): ToolDefinition[] {
  if (!policy) return tools;
  return tools.filter((tool) => isToolEnabled(policy, tool.name));
}
