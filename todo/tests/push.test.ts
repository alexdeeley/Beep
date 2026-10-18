import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { NodeDriver } from '../server/node-driver.ts';
import { migrate } from '../server/db.ts';
import { ensureVapid, encryptPayload, sendPush, b64u, unb64u } from '../server/push.ts';

const subtle = webcrypto.subtle;
const enc = new TextEncoder(), dec = new TextDecoder();
const concat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) { const k = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']); return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, length * 8)); }

// A browser's side of RFC 8291: generate the subscription keys, then
// decrypt what the server produced, following the RFC step by step.
async function subscriber() {
  const kp = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = new Uint8Array(await subtle.exportKey('raw', kp.publicKey));
  const auth = webcrypto.getRandomValues(new Uint8Array(16));
  const decrypt = async (body: Uint8Array) => {
    const salt = body.slice(0, 16), rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0), idlen = body[20], asPub = body.slice(21, 21 + idlen), cipher = body.slice(21 + idlen);
    assert.equal(rs, 4096); assert.equal(idlen, 65);
    const asKey = await subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: asKey }, kp.privateKey, 256));
    const ikm = await hkdf(auth, shared, concat(enc.encode('WebPush: info\0'), pub, asPub), 32);
    const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
    const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
    const key = await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
    const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, cipher));
    assert.equal(plain[plain.length - 1], 2, 'last record delimiter');
    return dec.decode(plain.slice(0, -1));
  };
  return { p256dh: b64u(pub), auth: b64u(auth), decrypt };
}

test('a push payload encrypted for a subscriber decrypts on their side (RFC 8291 aes128gcm)', async () => {
  const s = await subscriber();
  const msg = JSON.stringify({ title: 'Ring Mum', body: 'Due today', url: '/task/abc' });
  const body = await encryptPayload(s.p256dh, s.auth, msg);
  assert.equal(await s.decrypt(body), msg);
  assert.ok(!dec.decode(body).includes('Ring Mum'), 'the title is not visible in the ciphertext');
  const again = await encryptPayload(s.p256dh, s.auth, msg);
  assert.notDeepEqual(Array.from(again.slice(0, 16)), Array.from(body.slice(0, 16)), 'a fresh salt every time');
});

test('the VAPID key pair is made once, kept, and signs a JWT the push service can verify', async () => {
  const db = new NodeDriver(':memory:'); migrate(db);
  const v1 = await ensureVapid(db), v2 = await ensureVapid(db);
  assert.equal(v1.publicKey, v2.publicKey);
  assert.equal(unb64u(v1.publicKey).length, 65, 'uncompressed P-256 point');
  const s = await subscriber();
  let captured: Request | null = null;
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => { captured = new Request(String(url), init); return new Response('', { status: 201 }); }) as typeof fetch;
  const r = await sendPush({ endpoint: 'https://push.example.com/send/xyz', ...s }, 'hello', v1, 'mailto:me@example.com', 3600, fetcher);
  assert.equal(r.ok, true);
  const req = captured! as Request;
  const authz = req.headers.get('authorization')!;
  const m = authz.match(/^vapid t=([^,]+), k=(.+)$/)!;
  assert.ok(m, authz); assert.equal(m[2], v1.publicKey);
  const [h, c, sig] = m[1].split('.');
  const header = JSON.parse(dec.decode(unb64u(h))), claims = JSON.parse(dec.decode(unb64u(c)));
  assert.deepEqual(header, { typ: 'JWT', alg: 'ES256' });
  assert.equal(claims.aud, 'https://push.example.com'); assert.equal(claims.sub, 'mailto:me@example.com'); assert.ok(claims.exp > Date.now() / 1000 && claims.exp < Date.now() / 1000 + 24 * 3600);
  const pub = await subtle.importKey('jwk', v1.publicJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.equal(await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, unb64u(sig), enc.encode(`${h}.${c}`)), true, 'signature verifies with the public key the header advertises');
  assert.equal(req.headers.get('content-encoding'), 'aes128gcm'); assert.equal(req.headers.get('ttl'), '3600'); assert.equal(req.headers.get('urgency'), 'high');
  const gone = await sendPush({ endpoint: 'https://push.example.com/send/xyz', ...s }, 'hello', v1, 'mailto:me@example.com', 3600, (async () => new Response('', { status: 410 })) as typeof fetch);
  assert.equal(gone.gone, true);
});
