import type { Message, MessageContent } from '../../types';
import { uint8ArrayToBase64 } from '../../utils/base64';
import { getBaseName } from '../../utils/pathUtils';
import { createLogger } from '../logging/logger';
import { resolveFileSource } from '../session/outputSnapshots';

const logger = createLogger('imageRehydration');

export type ImageBase64Cache = Map<string, string | null>;

async function readImageAsBase64(
  conversationId: string | undefined,
  filePath: string,
  workspacePath: string | null,
  cache?: ImageBase64Cache,
): Promise<string | null> {
  if (cache?.has(filePath)) return cache.get(filePath) ?? null;
  let result: string | null = null;
  try {
    const resolved = await resolveFileSource(conversationId, filePath, workspacePath);
    if (resolved.status === 'available') {
      const { readFile } = await import('@tauri-apps/plugin-fs');
      result = uint8ArrayToBase64(await readFile(resolved.path));
    }
  } catch (error) {
    logger.warn('image rehydrate failed', { filePath, error: String(error) });
  }
  cache?.set(filePath, result);
  return result;
}

export async function rehydrateImageData(
  messages: Message[],
  conversationId: string | undefined,
  workspacePath: string | null,
  cache?: ImageBase64Cache,
): Promise<Message[]> {
  const needsWork = messages.some(
    (message) => Array.isArray(message.content)
      && message.content.some((block) => block.type === 'image' && !block.source.data && !!block.filePath),
  );
  if (!needsWork) return messages;

  return Promise.all(messages.map(async (message) => {
    if (!Array.isArray(message.content)) return message;
    let changed = false;
    const content = await Promise.all(message.content.map(async (block): Promise<MessageContent> => {
      if (block.type !== 'image' || block.source.data || !block.filePath) return block;
      changed = true;
      const data = await readImageAsBase64(conversationId, block.filePath, workspacePath, cache);
      return data
        ? { ...block, source: { ...block.source, data } }
        : {
            type: 'text',
            text: `[Attached image could not be loaded: ${getBaseName(block.filePath)}]`,
          };
    }));
    return changed ? { ...message, content } : message;
  }));
}

export function rehydrateForSend(
  messages: Message[],
  options: {
    vision: boolean;
    conversationId: string | undefined;
    workspacePath: string | null;
    cache?: ImageBase64Cache;
  },
): Promise<Message[]> {
  if (!options.vision) return Promise.resolve(messages);
  return rehydrateImageData(
    messages,
    options.conversationId,
    options.workspacePath,
    options.cache,
  );
}
