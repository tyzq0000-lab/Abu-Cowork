/**
 * Convert a Uint8Array to a base64 string without spreading all bytes at once.
 * The naive `btoa(String.fromCharCode(...bytes))` throws RangeError for arrays
 * larger than ~64 KB because it exceeds the maximum call-stack argument limit.
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Decode a base64 string into a Uint8Array. Inverse of {@link uint8ArrayToBase64}.
 * Throws if the input isn't valid base64 — callers must guard.
 */
export function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
