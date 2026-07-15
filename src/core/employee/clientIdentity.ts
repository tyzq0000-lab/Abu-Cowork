import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
} from '@tauri-apps/plugin-fs';

const ID_PATH = 'platform/client-id.txt';
const ID_DIR = 'platform';

export function isValidClientId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function createClientId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Stable, non-secret installation identity persisted through Tauri plugin-fs. */
export async function getOrCreateClientId(): Promise<string> {
  if (await exists(ID_PATH, { baseDir: BaseDirectory.AppData })) {
    const stored = (await readTextFile(ID_PATH, { baseDir: BaseDirectory.AppData })).trim();
    if (isValidClientId(stored)) return stored;
  }

  const clientId = createClientId();
  await mkdir(ID_DIR, { baseDir: BaseDirectory.AppData, recursive: true });
  await writeTextFile(ID_PATH, clientId, { baseDir: BaseDirectory.AppData });
  return clientId;
}
