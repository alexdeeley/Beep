import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { originAllowed } from '../server/worker.ts';
import { parseClient } from '../shared/protocol.ts';

function fakeEnv() {
  const calls: string[] = [];
  const env: any = {
    ENVIRONMENT: 'production',
    TABLE: {
      idFromName: (n: string) => n,
      get: (id: string) => ({
        async fetch(input: any) {
          const u = new URL(input instanceof Request ? input.url : input);
          calls.push(`${id}:${u.pathname}`);
          if (u.pathname === '/table') return Response.json({ game: 1, moves: 0 });
          if (u.pathname === '/ws') return new Response('ws reached', { status: 200 });
          return new Response('?', { status: 404 });
        },
      }),
    },
  };
  return { env, calls };
}
const req = (path: string, init: RequestInit = {}) => new Request('https://soliteam.example.com' + path, init);

test('health check', async () => {
  const res = await worker.fetch(req('/health'), fakeEnv().env);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, service: 'soliteam' });
});

test('there is exactly one table, and everything goes to it', async () => {
  const { env, calls } = fakeEnv();
  assert.equal((await worker.fetch(req('/api/table'), env)).status, 200);
  assert.equal((await worker.fetch(req('/api/ws', { headers: { Upgrade: 'websocket' } }), env)).status, 200);
  assert.deepEqual(calls, ['the-game:/table', 'the-game:/ws']);
});

test('the game socket is only for our own pages', async () => {
  const { env } = fakeEnv();
  const res = await worker.fetch(req('/api/ws', { headers: { Upgrade: 'websocket', Origin: 'https://evil.example' } }), env);
  assert.equal(res.status, 403);
  assert.equal(originAllowed('https://soliteam.example.com', 'soliteam.example.com', env), true);
  assert.equal(originAllowed(null, 'soliteam.example.com', env), true, 'non-browser clients send no origin');
  assert.equal(originAllowed('http://localhost:8787', 'soliteam.example.com', env), false, 'not in production');
  assert.equal(originAllowed('http://localhost:8787', 'soliteam.example.com', { ENVIRONMENT: 'development' }), true);
  assert.equal(originAllowed('https://deeley.org', 'soliteam.example.com', { ALLOWED_ORIGINS: 'https://deeley.org' }), true);
});

test('unknown paths are not found', async () => {
  const { env } = fakeEnv();
  assert.equal((await worker.fetch(req('/api/nope'), env)).status, 404);
  assert.equal((await worker.fetch(req('/whatever'), env)).status, 404);
});

test('messages from browsers are checked to the letter', () => {
  assert.deepEqual(parseClient(JSON.stringify({ t: 'draw' })), { t: 'draw' });
  assert.deepEqual(parseClient(JSON.stringify({ t: 'move', from: { p: 't', i: 2 }, n: 3, to: { p: 't', i: 5 } })), { t: 'move', from: { p: 't', i: 2 }, n: 3, to: { p: 't', i: 5 } });
  assert.deepEqual(parseClient(JSON.stringify({ t: 'move', from: { p: 'w' }, n: 1, to: { p: 'f', i: 3 } })), { t: 'move', from: { p: 'w' }, n: 1, to: { p: 'f', i: 3 } });
  assert.equal(parseClient(JSON.stringify({ t: 'move', from: { p: 't', i: 7 }, n: 1, to: { p: 't', i: 0 } })), null, 'no column 7');
  assert.equal(parseClient(JSON.stringify({ t: 'move', from: { p: 't', i: 0 }, n: 0, to: { p: 't', i: 1 } })), null);
  assert.equal(parseClient(JSON.stringify({ t: 'move', from: { p: 't', i: 0 }, n: 1.5, to: { p: 't', i: 1 } })), null);
  assert.equal(parseClient(JSON.stringify({ t: 'move', from: { p: 'x' }, n: 1, to: { p: 't', i: 1 } })), null);
  assert.equal(parseClient(JSON.stringify({ t: 'reset' })), null, 'there is no such thing');
  assert.equal(parseClient(JSON.stringify({ t: 'newgame' })), null);
  assert.equal(parseClient('not json'), null);
  assert.equal(parseClient('x'.repeat(600)), null);
  assert.equal(parseClient(42), null);
});
