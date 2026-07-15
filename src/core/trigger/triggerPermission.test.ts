import { describe, expect, it } from 'vitest';
import { resolveTriggerCallbacks } from './triggerPermission';
import type { ConfirmationInfo } from '../tools/commandSafety';

const externalAction: ConfirmationInfo = {
  command: 'crm__send_message',
  level: 'danger',
  reason: 'requires approval',
  kind: 'external-action',
  externalActionKind: 'send',
  toolName: 'crm__send_message',
};

describe('resolveTriggerCallbacks', () => {
  it('does not let full triggers approve external actions', async () => {
    const callbacks = resolveTriggerCallbacks({ prompt: 'run', capability: 'full' });

    await expect(callbacks.commandConfirmCallback(externalAction)).resolves.toBe(false);
    await expect(callbacks.commandConfirmCallback({
      command: 'git status',
      level: 'safe',
      reason: '',
    })).resolves.toBe(true);
  });

  it('does not let a custom command whitelist approve external actions', async () => {
    const callbacks = resolveTriggerCallbacks({
      prompt: 'run',
      capability: 'custom',
      permissions: { allowedCommands: ['*'] },
    });

    await expect(callbacks.commandConfirmCallback(externalAction)).resolves.toBe(false);
  });
});
