/**
 * Tauri API shims for running eval outside of Tauri (plain Node.js / tsx).
 *
 * Must be imported BEFORE any code that depends on Tauri APIs.
 * Forces all network calls to use Node.js native fetch instead of Tauri IPC.
 */

// Shim window minimally (stores check typeof window !== 'undefined')
if (typeof globalThis.window === 'undefined') {
  // @ts-expect-error — intentional minimal shim
  globalThis.window = {};
}

// Shim localStorage (Zustand persist middleware needs it)
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    get length() { return store.size; },
    key: (index: number) => [...store.keys()][index] ?? null,
  } as Storage;
}

export {};
