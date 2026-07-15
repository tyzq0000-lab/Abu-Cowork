import { describe, expect, it } from 'vitest';
import type { ToolDefinition, ToolPolicy } from '@/types';
import {
  filterToolsByPolicy,
  isToolEnabled,
  resolveToolPolicyState,
} from './toolPolicy';

function tool(name: string): ToolDefinition {
  return {
    name,
    description: name,
    inputSchema: { type: 'object', properties: {} },
    execute: async () => 'ok',
  };
}

describe('employee tool policy', () => {
  it('keeps existing packages fully enabled when the policy is omitted', () => {
    expect(isToolEnabled(undefined, 'write_file')).toBe(true);
    expect(isToolEnabled({ overrides: {} }, 'toString')).toBe(true);
  });

  it('applies exact overrides before wildcard overrides', () => {
    const policy: ToolPolicy = {
      overrides: {
        'mcp__github__*': 'disabled',
        mcp__github__search: 'enabled',
      },
    };

    expect(resolveToolPolicyState(policy, 'mcp__github__issues')).toBe('disabled');
    expect(resolveToolPolicyState(policy, 'mcp__github__search')).toBe('enabled');
    expect(resolveToolPolicyState(policy, 'read_file')).toBe('enabled');
  });

  it('uses the most specific wildcard and fails closed on equally specific conflicts', () => {
    const policy: ToolPolicy = {
      overrides: {
        'mcp__*': 'disabled',
        'mcp__github__*': 'enabled',
        'mcp__*__search': 'disabled',
      },
    };

    expect(resolveToolPolicyState(policy, 'mcp__github__search')).toBe('disabled');
    expect(resolveToolPolicyState(policy, 'mcp__slack__search')).toBe('disabled');
  });

  it('supports default deny with explicit enable overrides', () => {
    const policy: ToolPolicy = {
      default: 'disabled',
      overrides: { read_file: 'enabled' },
    };
    const filtered = filterToolsByPolicy(
      [tool('read_file'), tool('write_file'), tool('run_command')],
      policy,
    );

    expect(filtered.map((item) => item.name)).toEqual(['read_file']);
  });
});
