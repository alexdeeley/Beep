// Stable, unguessable ids: 16 url-safe characters. Never reused.
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
export function newId(prefix = ''): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return prefix ? `${prefix}_${s}` : s;
}
export const now = (): string => new Date().toISOString();
