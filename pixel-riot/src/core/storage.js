// Namespaced persistent storage over localStorage with an in-memory fallback
// (private browsing, quota errors, Node tests). All values are JSON.

import { STORAGE_PREFIX } from '../config.js';

function makeBackend() {
  try {
    const ls = globalThis.localStorage;
    const k = STORAGE_PREFIX + '__probe';
    ls.setItem(k, '1'); ls.removeItem(k);
    return ls;
  } catch {
    const mem = new Map();
    return {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
      removeItem: (k) => mem.delete(k),
      _memory: true,
    };
  }
}

export class Storage {
  constructor(backend = makeBackend(), prefix = STORAGE_PREFIX) {
    this.backend = backend; this.prefix = prefix;
    this.persistent = !backend._memory;
    this.lastError = null;
  }
  get(key, fallback = null) {
    try {
      const raw = this.backend.getItem(this.prefix + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) { this.lastError = e; return fallback; }
  }
  set(key, value) {
    try { this.backend.setItem(this.prefix + key, JSON.stringify(value)); return true; }
    catch (e) { this.lastError = e; return false; }
  }
  remove(key) { try { this.backend.removeItem(this.prefix + key); } catch (e) { this.lastError = e; } }
}

// Typed-array <-> base64 helpers for compact artwork persistence.
export function bytesToBase64(u8) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return btoa(s);
}
export function base64ToBytes(b64) {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}
