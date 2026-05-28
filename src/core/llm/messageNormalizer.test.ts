import { describe, it, expect } from 'vitest';
import { normalizeMessages } from './messageNormalizer';
import type { Message } from '../../types';

function makeMessage(overrides: Partial<Message> & Pick<Message, 'role' | 'content'>): Message {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('messageNormalizer', () => {
  describe('normalizeMessages', () => {
    it('converts simple user + assistant messages', () => {
      const messages: Message[] = [
        makeMessage({ role: 'user', content: 'Hello' }),
        makeMessage({ role: 'assistant', content: 'Hi there' }),
      ];

      const turns = normalizeMessages(messages);

      expect(turns).toHaveLength(2);
      expect(turns[0]).toEqual({ kind: 'user', content: [{ type: 'text', text: 'Hello' }] });
      expect(turns[1]).toMatchObject({ kind: 'assistant', text: 'Hi there', toolCalls: [] });
    });

    it('skips system messages', () => {
      const messages: Message[] = [
        makeMessage({ role: 'system', content: 'System prompt' }),
        makeMessage({ role: 'user', content: 'Hello' }),
      ];

      const turns = normalizeMessages(messages);
      expect(turns).toHaveLength(1);
      expect(turns[0].kind).toBe('user');
    });

    it('preserves thinking content', () => {
      const messages: Message[] = [
        makeMessage({ role: 'user', content: 'Think about this' }),
        makeMessage({ role: 'assistant', content: 'Result', thinking: 'My internal reasoning' }),
      ];

      const turns = normalizeMessages(messages);
      const assistant = turns[1];
      expect(assistant.kind).toBe('assistant');
      if (assistant.kind === 'assistant') {
        expect(assistant.thinking).toBe('My internal reasoning');
      }
    });

    describe('tool call pairing', () => {
      it('normalizes tool calls with results (from toolCallsForContext)', () => {
        const messages: Message[] = [
          makeMessage({ role: 'user', content: 'Read a file' }),
          makeMessage({
            role: 'assistant',
            content: 'Let me read that',
            toolCallsForContext: [
              { name: 'read_file', input: { path: '/tmp/test.txt' }, result: 'file content here' },
            ],
          }),
        ];

        const turns = normalizeMessages(messages);
        const assistant = turns[1];
        expect(assistant.kind).toBe('assistant');
        if (assistant.kind === 'assistant') {
          expect(assistant.toolCalls).toHaveLength(1);
          expect(assistant.toolCalls[0].name).toBe('read_file');
          expect(assistant.toolCalls[0].result).toBe('file content here');
          expect(assistant.toolCalls[0].isError).toBe(false);
          expect(assistant.toolCalls[0].id).toMatch(/^toolu_/);
        }
      });

      it('prefers toolCallsForContext over toolCalls', () => {
        const messages: Message[] = [
          makeMessage({
            role: 'assistant',
            content: '',
            toolCalls: [
              { id: 'tc1', name: 'read_file', input: { path: '/a' }, result: 'old result' },
            ],
            toolCallsForContext: [
              { name: 'read_file', input: { path: '/a' }, result: 'context result' },
            ],
          }),
        ];

        const turns = normalizeMessages(messages);
        if (turns[0].kind === 'assistant') {
          expect(turns[0].toolCalls[0].result).toBe('context result');
        }
      });

      it('★ fixes orphaned tool_use with placeholder result', () => {
        const messages: Message[] = [
          makeMessage({
            role: 'assistant',
            content: 'Calling tool',
            toolCalls: [
              { id: 'tc1', name: 'run_command', input: { command: 'npm test' }, result: undefined, isExecuting: true },
            ],
          }),
        ];

        const turns = normalizeMessages(messages);
        if (turns[0].kind === 'assistant') {
          expect(turns[0].toolCalls).toHaveLength(1);
          expect(turns[0].toolCalls[0].result).toBe('[Tool execution was interrupted]');
          expect(turns[0].toolCalls[0].isError).toBe(true);
        }
      });

      it('★ fixes mixed: some results present, some missing', () => {
        const messages: Message[] = [
          makeMessage({
            role: 'assistant',
            content: '',
            toolCalls: [
              { id: 'tc1', name: 'read_file', input: { path: '/a' }, result: 'content A' },
              { id: 'tc2', name: 'read_file', input: { path: '/b' }, result: undefined, isExecuting: true },
              { id: 'tc3', name: 'read_file', input: { path: '/c' }, result: 'content C' },
            ],
          }),
        ];

        const turns = normalizeMessages(messages);
        if (turns[0].kind === 'assistant') {
          const tcs = turns[0].toolCalls;
          expect(tcs[0].result).toBe('content A');
          expect(tcs[0].isError).toBe(false);
          expect(tcs[1].result).toBe('[Tool execution was interrupted]');
          expect(tcs[1].isError).toBe(true);
          expect(tcs[2].result).toBe('content C');
          expect(tcs[2].isError).toBe(false);
        }
      });

      it('preserves isError flag from original tool call', () => {
        const messages: Message[] = [
          makeMessage({
            role: 'assistant',
            content: '',
            toolCalls: [
              { id: 'tc1', name: 'run_command', input: { command: 'bad' }, result: 'Error: command failed', isError: true },
            ],
          }),
        ];

        const turns = normalizeMessages(messages);
        if (turns[0].kind === 'assistant') {
          expect(turns[0].toolCalls[0].isError).toBe(true);
          expect(turns[0].toolCalls[0].result).toBe('Error: command failed');
        }
      });
    });

    describe('image handling', () => {
      it('extracts images from tool result content', () => {
        const messages: Message[] = [
          makeMessage({
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                id: 'tc1',
                name: 'screenshot',
                input: {},
                result: 'Screenshot taken',
                resultContent: [
                  { type: 'text', text: 'Screenshot taken' },
                  { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc123' } },
                ],
              },
            ],
          }),
        ];

        const turns = normalizeMessages(messages);
        if (turns[0].kind === 'assistant') {
          expect(turns[0].toolCalls[0].resultImages).toHaveLength(1);
          expect(turns[0].toolCalls[0].resultImages[0]).toEqual({
            mediaType: 'image/png',
            data: 'abc123',
          });
        }
      });

      it('strips images when supportsVision is false', () => {
        const messages: Message[] = [
          makeMessage({
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                id: 'tc1',
                name: 'screenshot',
                input: {},
                result: 'Screenshot taken',
                resultContent: [
                  { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc123' } },
                ],
              },
            ],
          }),
        ];

        const turns = normalizeMessages(messages, { supportsVision: false });
        if (turns[0].kind === 'assistant') {
          expect(turns[0].toolCalls[0].resultImages).toHaveLength(0);
        }
      });

      it('converts user image content blocks', () => {
        const messages: Message[] = [
          makeMessage({
            role: 'user',
            content: [
              { type: 'text', text: 'What is this?' },
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'img123' } },
            ],
          }),
        ];

        const turns = normalizeMessages(messages);
        if (turns[0].kind === 'user') {
          expect(turns[0].content).toHaveLength(2);
          expect(turns[0].content[0]).toEqual({ type: 'text', text: 'What is this?' });
          expect(turns[0].content[1]).toEqual({ type: 'image', mediaType: 'image/jpeg', data: 'img123' });
        }
      });

      it('strips user images and adds hint when vision not supported', () => {
        const messages: Message[] = [
          makeMessage({
            role: 'user',
            content: [
              { type: 'text', text: 'Check this' },
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'x' } },
            ],
          }),
        ];

        const turns = normalizeMessages(messages, { supportsVision: false });
        if (turns[0].kind === 'user') {
          expect(turns[0].content).toHaveLength(2);
          expect(turns[0].content[0]).toEqual({ type: 'text', text: 'Check this' });
          expect(turns[0].content[1]).toMatchObject({ type: 'text', text: expect.stringContaining('不支持图片理解') });
        }
      });
    });

    describe('edge cases', () => {
      it('handles empty message list', () => {
        expect(normalizeMessages([])).toEqual([]);
      });

      it('replaces empty ghost assistant message with tombstone', () => {
        const messages: Message[] = [
          makeMessage({ role: 'assistant', content: '' }),
        ];

        const turns = normalizeMessages(messages);
        expect(turns).toHaveLength(1);
        if (turns[0].kind === 'assistant') {
          expect(turns[0].text).toBe('[未收到响应]');
          expect(turns[0].toolCalls).toEqual([]);
        }
      });

      it('replaces ghost assistant between two user messages without consecutive-user violation', () => {
        const messages: Message[] = [
          makeMessage({ role: 'user', content: '整理桌面' }),
          makeMessage({ role: 'assistant', content: '' }),
          makeMessage({ role: 'user', content: '再试一次' }),
        ];

        const turns = normalizeMessages(messages);
        expect(turns).toHaveLength(3);
        expect(turns[0].kind).toBe('user');
        if (turns[1].kind === 'assistant') {
          expect(turns[1].text).toBe('[未收到响应]');
        }
        expect(turns[2].kind).toBe('user');
      });

      it('generates unique IDs per tool call', () => {
        const messages: Message[] = [
          makeMessage({
            role: 'assistant',
            content: '',
            toolCallsForContext: [
              { name: 'tool_a', input: {}, result: 'a' },
              { name: 'tool_b', input: {}, result: 'b' },
            ],
          }),
        ];

        const turns = normalizeMessages(messages);
        if (turns[0].kind === 'assistant') {
          const ids = turns[0].toolCalls.map((tc) => tc.id);
          expect(new Set(ids).size).toBe(2);
        }
      });

      it('handles multi-turn conversation with interleaved tool calls', () => {
        const messages: Message[] = [
          makeMessage({ role: 'user', content: 'Read two files' }),
          makeMessage({
            role: 'assistant',
            content: 'Reading files...',
            toolCalls: [
              { id: 'tc1', name: 'read_file', input: { path: '/a' }, result: 'content A' },
              { id: 'tc2', name: 'read_file', input: { path: '/b' }, result: 'content B' },
            ],
          }),
          makeMessage({ role: 'user', content: 'Now edit file A' }),
          makeMessage({
            role: 'assistant',
            content: 'Editing...',
            toolCalls: [
              { id: 'tc3', name: 'write_file', input: { path: '/a', content: 'new' }, result: 'Done' },
            ],
          }),
        ];

        const turns = normalizeMessages(messages);
        expect(turns).toHaveLength(4);
        expect(turns[0].kind).toBe('user');
        expect(turns[1].kind).toBe('assistant');
        if (turns[1].kind === 'assistant') {
          expect(turns[1].toolCalls).toHaveLength(2);
        }
        expect(turns[2].kind).toBe('user');
        expect(turns[3].kind).toBe('assistant');
        if (turns[3].kind === 'assistant') {
          expect(turns[3].toolCalls).toHaveLength(1);
        }
      });

      it('handles assistant message with only tool calls (no text)', () => {
        const messages: Message[] = [
          makeMessage({ role: 'user', content: 'Do it' }),
          makeMessage({
            role: 'assistant',
            content: [{ type: 'text', text: '' }],
            toolCalls: [
              { id: 'tc1', name: 'run_command', input: { command: 'ls' }, result: 'file.txt' },
            ],
          }),
        ];

        const turns = normalizeMessages(messages);
        if (turns[1].kind === 'assistant') {
          expect(turns[1].text).toBe('');
          expect(turns[1].toolCalls).toHaveLength(1);
        }
      });

      it('handles user message with empty string content', () => {
        const messages: Message[] = [
          makeMessage({ role: 'user', content: '' }),
        ];
        // Empty content should produce no turns
        const turns = normalizeMessages(messages);
        expect(turns).toHaveLength(0);
      });

      it('handles document content in user messages', () => {
        const messages: Message[] = [
          makeMessage({
            role: 'user',
            content: [
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf' as const, data: 'pdf123' } },
            ],
          }),
        ];

        const turns = normalizeMessages(messages);
        if (turns[0].kind === 'user') {
          expect(turns[0].content[0]).toEqual({ type: 'document', mediaType: 'application/pdf', data: 'pdf123' });
        }
      });
    });
  });
});
