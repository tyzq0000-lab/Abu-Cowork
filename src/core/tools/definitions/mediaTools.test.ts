import { beforeEach, describe, expect, it, vi } from 'vitest';
import { writeFile } from '@tauri-apps/plugin-fs';
import { generateImageTool } from './mediaTools';
import { getTauriFetch } from '../../llm/tauriFetch';
import { useSettingsStore } from '../../../stores/settingsStore';

vi.mock('../../llm/tauriFetch', () => ({ getTauriFetch: vi.fn() }));

describe('generateImageTool packaged base64 path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const current = useSettingsStore.getState();
    useSettingsStore.setState({
      auxiliaryServices: {
        ...current.auxiliaryServices,
        imageGen: {
          enabled: true,
          apiKey: 'test-key',
          baseUrl: 'https://images.example.test',
          model: 'test-image-model',
        },
      },
    });
  });

  it('decodes b64_json without fetching a CSP-blocked data URL', async () => {
    const apiFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'aGVsbG8=' }],
    }), { status: 200 }));
    vi.mocked(getTauriFetch).mockResolvedValue(apiFetch as unknown as typeof fetch);
    const browserFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Load failed'));

    const result = await generateImageTool.execute({
      prompt: 'test',
      save_path: '/tmp/generated.png',
    });

    expect(result).toContain('/tmp/generated.png');
    expect(browserFetch).not.toHaveBeenCalled();
    expect(vi.mocked(writeFile).mock.calls[0]?.[1]).toEqual(
      Uint8Array.from([104, 101, 108, 108, 111]),
    );
    browserFetch.mockRestore();
  });
});
