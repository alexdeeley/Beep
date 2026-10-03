import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { allowCreate, originAllowed, randomCode } from '../server/worker.ts';
import { cleanCode, hashPass, parseClient, sameHash, validCode, validPass } from '../shared/protocol.ts';

// A stand-in for the Durable Object namespace that just records what it is asked.
function fakeEnv(opts: { exists?: boolean } = {}) {
  const calls: { path: string; body?: any }[] = [];
  const env: any = {
    ENVIRONMENT: 'production',
    ROOMS: {
      idFromName: (n: string) => n,
      get: () => ({
        async fetch(input: any, init?: any) {
          const u = new URL(input instanceof Request ? input.url : input);
          calls.push({ path: u.pathname, body: init?.body ? JSON.parse(init.body) : undefined });
          if (u.pathname === '/init') return Response.json({ ok: true });
          if (u.pathname === '/exists') return Response.json({ exists: opts.exists ?? true, full: false });
          if (u.pathname === '/ws') return new Response('ws reached', { status: 200 });
          return new Response('?', { status: 404 });
        },
      }),
    },
  };
  return { env, calls };
}
const req = (path: string, init: RequestInit = {}) => new Request('https://duel.example.com' + path, init);

test('health check', async () => {
  const { env } = fakeEnv();
  const res = await worker.fetch(req('/health'), env);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, service: 'arkanoid-duel' });
});

test('creating a game needs a valid passcode and a player id, and stores only a hash', async () => {
  const { env, calls } = fakeEnv();
  const post = (body: unknown) => worker.fetch(req('/api/rooms', { method: 'POST', body: JSON.stringify(body), headers: { 'cf-connecting-ip': '9.9.9.' + Math.floor(Math.random() * 250) } }), env);
  assert.equal((await post({ pass: 'ab', pid: 'creator-pid-0001' })).status, 400, 'too short');
  assert.equal((await post({ pass: 'x'.repeat(40), pid: 'creator-pid-0001' })).status, 400, 'too long');
  assert.equal((await post({ pass: 'rosebud', pid: 'x' })).status, 400, 'bad player id');
  assert.equal((await post({ pass: 'rosebud' })).status, 400);
  const bad = await worker.fetch(req('/api/rooms', { method: 'POST', body: 'not json' }), env);
  assert.equal(bad.status, 400);
  const ok = await post({ pass: 'rosebud', pid: 'creator-pid-0001' });
  assert.equal(ok.status, 200);
  const { code } = await ok.json() as { code: string };
  assert.ok(validCode(code));
  const init = calls.find((c) => c.path === '/init')!.body;
  assert.equal(init.code, code);
  assert.equal(init.pid, 'creator-pid-0001');
  assert.equal(init.passHash, await hashPass(code, 'rosebud'));
  assert.ok(!JSON.stringify(init).includes('rosebud'), 'the passcode itself is never sent on or stored');
});

test('creating games is rate limited per sender', () => {
  const ip = 'rate-test-ip';
  const t = 1_000_000;
  for (let i = 0; i < 20; i++) assert.equal(allowCreate(ip, t + i, 20, 600000), true);
  assert.equal(allowCreate(ip, t + 30, 20, 600000), false);
  assert.equal(allowCreate(ip, t + 600001 + 30, 20, 600000), true, 'and recovers');
  assert.equal(allowCreate('someone-else', t, 20, 600000), true);
});

test('room codes are four easy characters', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 400; i++) { const c = randomCode(); assert.match(c, /^[2-9A-HJ-NP-Z]{4}$/); seen.add(c); }
  assert.ok(seen.size > 380, 'well spread');
  assert.equal(cleanCode(' q7k9! '), 'Q7K9');
  assert.equal(validCode('Q7K9'), true);
  assert.equal(validCode('Q7K'), false);
  assert.equal(validCode('Q7K0'), false, 'no zeros');
});

test('looking up a game', async () => {
  const { env } = fakeEnv();
  const res = await worker.fetch(req('/api/rooms/Q7K9'), env);
  assert.deepEqual(await res.json(), { exists: true, full: false });
  const bad = await worker.fetch(req('/api/rooms/N0P'), env);
  assert.equal(bad.status, 404);
  const none = fakeEnv({ exists: false });
  assert.deepEqual(await (await worker.fetch(req('/api/rooms/Q7K9'), none.env)).json(), { exists: false, full: false });
});

test('only our own pages may open a game socket', () => {
  const prod = { ENVIRONMENT: 'production' };
  assert.equal(originAllowed('https://duel.example.com', 'duel.example.com', prod), true, 'same site');
  assert.equal(originAllowed('https://evil.example', 'duel.example.com', prod), false, 'another site');
  assert.equal(originAllowed('not a url', 'duel.example.com', prod), false);
  assert.equal(originAllowed(null, 'duel.example.com', prod), true, 'non-browser clients send no origin');
  assert.equal(originAllowed('http://localhost:5173', 'duel.example.com', prod), false, 'localhost is for development only');
  assert.equal(originAllowed('http://localhost:5173', 'duel.example.com', {}), true);
  assert.equal(originAllowed('https://app.example.org', 'duel.example.com', { ...prod, ALLOWED_ORIGINS: 'https://app.example.org' }), true, 'listed origins');
});

test('the socket route checks origin before reaching the game', async () => {
  const { env, calls } = fakeEnv();
  const bad = await worker.fetch(req('/api/rooms/Q7K9/ws', { headers: { Origin: 'https://evil.example', Upgrade: 'websocket' } }), env);
  assert.equal(bad.status, 403);
  assert.equal(calls.length, 0);
  const good = await worker.fetch(req('/api/rooms/Q7K9/ws', { headers: { Origin: 'https://duel.example.com', Upgrade: 'websocket' } }), env);
  assert.equal(good.status, 200);
  assert.equal(calls[0].path, '/ws');
});

test('anything else is a 404', async () => {
  const { env } = fakeEnv();
  assert.equal((await worker.fetch(req('/nothing'), env)).status, 404);
  assert.equal((await worker.fetch(req('/api/nope'), env)).status, 404);
});

test('message parsing is strict', () => {
  assert.equal(parseClient('{"t":"in","x":300}')?.t, 'in');
  assert.deepEqual(parseClient('{"t":"in","x":99999}'), { t: 'in', x: 2000 }, 'wild numbers are clamped');
  assert.equal(parseClient('{"t":"in","x":"300"}'), null);
  assert.equal(parseClient('{"t":"hello","code":"q7k9","pass":"abc","pid":"abcdefgh1","name":"<b>Al</b>"}')?.t, 'hello');
  assert.equal((parseClient('{"t":"hello","code":"q7k9","pass":"abc","pid":"abcdefgh1","name":"<b>Al</b>"}') as any).name, 'bAl/b', 'markup characters are stripped from names');
  assert.equal(parseClient('{"t":"hello","code":"q7k9","pass":"ab","pid":"abcdefgh1"}'), null, 'short passcode');
  assert.equal(parseClient('{"t":"hello","code":"q7k9","pass":"abc","pid":"short"}'), null, 'short player id');
  assert.equal(parseClient('{"t":"serve","extra":1}')?.t, 'serve');
  assert.equal(validPass('abc'), true);
  assert.equal(validPass('a\u0000c'), false);
});

test('passcode hashing is salted per room and compared safely', async () => {
  const a = await hashPass('Q7K9', 'rosebud'), b = await hashPass('Q7K8', 'rosebud');
  assert.notEqual(a, b, 'the same passcode hashes differently in another room');
  assert.equal(sameHash(a, await hashPass('Q7K9', 'rosebud')), true);
  assert.equal(sameHash(a, await hashPass('Q7K9', 'Rosebud')), false, 'case matters');
  assert.equal(sameHash(a, a.slice(1)), false);
});
