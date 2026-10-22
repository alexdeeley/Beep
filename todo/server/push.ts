// Web Push from a Worker, with nothing but WebCrypto: VAPID (RFC 8292)
// signs a short JWT with the installation's own P-256 key, and the message
// body is encrypted for the subscriber per RFC 8291 / RFC 8188
// (aes128gcm). The VAPID key pair is generated once and kept in settings.
import type { SqlDriver } from './driver.ts';
import { getSetting, setSetting } from './db.ts';

const enc = new TextEncoder();
export const b64u = (b: ArrayBuffer | Uint8Array): string => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64u = (s: string): Uint8Array => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
// WebCrypto wants plain ArrayBuffers: copy a view into one.
export const ab = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
const concat = (...parts: Uint8Array[]): Uint8Array => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

export interface Vapid { publicKey: string; privateJwk: JsonWebKey; publicJwk: JsonWebKey }

export async function ensureVapid(db: SqlDriver): Promise<Vapid> {
  const stored = getSetting(db, 'vapid');
  if (stored) return JSON.parse(stored) as Vapid;
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const privateJwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const publicJwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
  const raw = await crypto.subtle.exportKey('raw', kp.publicKey);
  const v: Vapid = { publicKey: b64u(raw), privateJwk, publicJwk };
  setSetting(db, 'vapid', JSON.stringify(v));
  return v;
}

async function vapidHeaders(vapid: Vapid, endpoint: string, subject: string): Promise<Record<string, string>> {
  const aud = new URL(endpoint).origin;
  const header = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', vapid.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`));   // WebCrypto gives the raw r||s form JWS wants
  return { Authorization: `vapid t=${header}.${claims}.${b64u(sig)}, k=${vapid.publicKey}` };
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ab(ikm), 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: ab(salt), info: ab(info) }, key, length * 8));
}

// RFC 8291: encrypt `text` for a subscriber (their p256dh public key and auth secret).
export async function encryptPayload(p256dh: string, auth: string, text: string): Promise<Uint8Array> {
  const uaPub = unb64u(p256dh), authSecret = unb64u(auth);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const localPub = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', ab(uaPub), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPub, localPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const plain = concat(enc.encode(text), new Uint8Array([2]));     // padding delimiter: last record
  const aes = await crypto.subtle.importKey('raw', ab(cek), 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ab(nonce) }, aes, ab(plain)));
  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096);
  const header = concat(salt, rs, new Uint8Array([localPub.length]), localPub);
  return concat(header, cipher);
}

export interface PushSub { endpoint: string; p256dh: string; auth: string }
export interface PushResult { ok: boolean; status: number; gone: boolean; error?: string }

export async function sendPush(sub: PushSub, payload: string, vapid: Vapid, subject: string, ttlSec = 24 * 3600, fetcher: typeof fetch = fetch): Promise<PushResult> {
  try {
    const body = await encryptPayload(sub.p256dh, sub.auth, payload);
    const res = await fetcher(sub.endpoint, {
      method: 'POST',
      headers: { ...(await vapidHeaders(vapid, sub.endpoint, subject)), 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'aes128gcm', TTL: String(ttlSec), Urgency: 'high' },
      body: ab(body),
    });
    return { ok: res.status >= 200 && res.status < 300, status: res.status, gone: res.status === 404 || res.status === 410 };
  } catch (e) {
    return { ok: false, status: 0, gone: false, error: (e as Error).message };
  }
}
