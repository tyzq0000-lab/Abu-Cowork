import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from '@tauri-apps/plugin-fs';
import type { Message } from '../../types';
import { resolveFileSource } from '../session/outputSnapshots';
import { rehydrateForSend } from './imageRehydration';

vi.mock('../session/outputSnapshots', () => ({ resolveFileSource: vi.fn() }));

const strippedMessage: Message = {
  id: 'image-message',
  role: 'user',
  timestamp: 1,
  content: [{
    type: 'image',
    source: { type: 'base64', media_type: 'image/png', data: '' },
    filePath: '/workspace/image.png',
  }],
};

describe('rehydrateForSend', () => {
  beforeEach(() => vi.clearAllMocks());

  it('restores stripped image data from disk for vision models', async () => {
    vi.mocked(resolveFileSource).mockResolvedValue({
      status: 'available',
      path: '/workspace/image.png',
      isFromSnapshot: false,
    });
    vi.mocked(readFile).mockResolvedValue(Uint8Array.from([104, 105]));

    const result = await rehydrateForSend([strippedMessage], {
      vision: true,
      conversationId: 'conversation-1',
      workspacePath: '/workspace',
    });

    expect(result[0].content).toEqual([{
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'aGk=' },
      filePath: '/workspace/image.png',
    }]);
  });

  it('replaces an unrecoverable image instead of sending empty base64', async () => {
    vi.mocked(resolveFileSource).mockResolvedValue({
      status: 'missing',
      originalPath: '/workspace/image.png',
    });

    const result = await rehydrateForSend([strippedMessage], {
      vision: true,
      conversationId: 'conversation-1',
      workspacePath: '/workspace',
    });

    expect(result[0].content).toEqual([{
      type: 'text',
      text: '[Attached image could not be loaded: image.png]',
    }]);
  });
});
