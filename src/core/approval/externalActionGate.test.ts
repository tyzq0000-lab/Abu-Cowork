import { describe, expect, it } from 'vitest';
import { classifyExternalAction } from './externalActionGate';

describe('classifyExternalAction', () => {
  it('allows read-only HTTP requests and gates HTTP writes', () => {
    expect(classifyExternalAction('http_fetch', {
      url: 'https://api.example.com/messages?token=secret',
    })).toBeNull();

    const approval = classifyExternalAction('http_fetch', {
      method: 'POST',
      url: 'https://api.example.com/messages?token=secret',
      body: '{"text":"hello"}',
    });
    expect(approval).toMatchObject({
      kind: 'send',
      detail: 'POST https://api.example.com/messages',
      toolName: 'http_fetch',
    });
    expect(approval?.reviewPayload).toContain('hello');
  });

  it('distinguishes payment and publish operations', () => {
    expect(classifyExternalAction('billing__create_payment', { amount: 100 })).toMatchObject({ kind: 'payment' });
    expect(classifyExternalAction('social__publish_post', { text: 'hello' })).toMatchObject({ kind: 'publish' });
    expect(classifyExternalAction('run_command', { command: 'git push origin main' })).toMatchObject({ kind: 'publish' });
  });

  it('does not gate harmless local commands', () => {
    expect(classifyExternalAction('run_command', { command: 'git status --short' })).toBeNull();
  });

  it('fails closed for unknown mutating MCP tools but allows obvious reads', () => {
    expect(classifyExternalAction('crm__list_contacts', {})).toBeNull();
    expect(classifyExternalAction('crm__list_posts', {})).toBeNull();
    expect(classifyExternalAction('crm__calculate_score', {})).toBeNull();
    expect(classifyExternalAction('crm__archive_contact', { id: 'c1' })).toMatchObject({ kind: 'send' });
    expect(classifyExternalAction('crm__get_and_send_message', { id: 'c1' })).toMatchObject({ kind: 'send' });
  });

  it('recognizes implicit curl writes', () => {
    expect(classifyExternalAction('run_command', {
      command: 'curl https://api.example.com/messages --json "{\\"text\\":\\"hi\\"}"',
    })).toMatchObject({ kind: 'send' });
  });

  it('gates browser commits without blocking observation or text entry', () => {
    expect(classifyExternalAction('abu-browser-bridge__snapshot', {})).toBeNull();
    expect(classifyExternalAction('abu-browser-bridge__fill', { text: 'draft' })).toBeNull();
    expect(classifyExternalAction('abu-browser-bridge__click', { locator: { text: '发布' } })).toMatchObject({ kind: 'publish' });
    expect(classifyExternalAction('playwright__browser_press_key', { key: 'Enter' })).toMatchObject({ kind: 'send' });
  });

  it('gates desktop clicks and submit keys', () => {
    expect(classifyExternalAction('computer', { action: 'get_app_state' })).toBeNull();
    expect(classifyExternalAction('computer', { action: 'type', element_id: 8, text: 'draft' })).toBeNull();
    expect(classifyExternalAction('computer', { action: 'click', element_id: 9 })).toMatchObject({ kind: 'send' });
    expect(classifyExternalAction('computer', { action: 'key', key: 'Return' })).toMatchObject({ kind: 'send' });
  });
});
