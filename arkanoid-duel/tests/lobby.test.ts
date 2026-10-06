import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lobby } from '../server/lobby.ts';
import type { LobbyConn, Seeker } from '../server/lobby.ts';
import { hashPass } from '../shared/protocol.ts';

class FakeConn implements LobbyConn {
  sent: any[] = [];
  closed: { code?: number; reason?: string } | null = null;
  send(d: string) { this.sent.push(JSON.parse(d)); }
  close(code?: number, reason?: string) { this.closed = { code, reason }; }
  last(t: string) { return this.sent.filter((m) => m.t === t).at(-1); }
}

function makeLobby(opts: { taken?: Set<string> } = {}) {
  const rooms: { code: string; passHash: string; pid: string }[] = [];
  let n = 0;
  const lobby = new Lobby({
    randomCode: () => ['Q7K9', 'Q7K9', 'A2B3', 'C4D5'][n++ % 4],      // the first code repeats, to test a collision
    createRoom: async (code, passHash, pid) => { if (rooms.some((r) => r.code === code) || opts.taken?.has(code)) return false; rooms.push({ code, passHash, pid }); return true; },
    now: () => 1000,
  });
  return { lobby, rooms };
}
async function seek(lobby: Lobby, pid: string, name = 'X') {
  const conn = new FakeConn();
  const s = lobby.attach(conn);
  await lobby.receive(s, JSON.stringify({ t: 'find', pid, name }));
  return { conn, s };
}

test('one person waits; the second to arrive is matched with them, both get the same game', async () => {
  const { lobby, rooms } = makeLobby();
  const a = await seek(lobby, 'alex-pid-00000001', 'Alex');
  assert.equal(a.conn.last('waiting').n, 1);
  assert.equal(a.conn.last('matched'), undefined);
  const b = await seek(lobby, 'maisie-pid-0000001', 'Maisie');
  const ma = a.conn.last('matched'), mb = b.conn.last('matched');
  assert.ok(ma && mb);
  assert.equal(ma.code, mb.code);
  assert.equal(ma.pass, mb.pass);
  assert.equal(ma.you, 1); assert.equal(mb.you, 2);
  assert.equal(ma.opponent, 'Maisie'); assert.equal(mb.opponent, 'Alex');
  assert.equal(lobby.waiting.length, 0);
  assert.equal(rooms.length, 1);
  assert.equal(rooms[0].pid, 'alex-pid-00000001', 'the one who waited longest is Player 1');
  assert.equal(rooms[0].passHash, await hashPass(ma.code, ma.pass), 'the room was made with the passcode they were given');
  assert.equal(a.conn.closed?.reason, 'matched');
});

test('a taken code is skipped and another tried', async () => {
  const { lobby, rooms } = makeLobby({ taken: new Set(['Q7K9']) });
  await seek(lobby, 'alex-pid-00000001'); const b = await seek(lobby, 'maisie-pid-0000001');
  assert.equal(b.conn.last('matched').code, 'A2B3');
  assert.equal(rooms[0].code, 'A2B3');
});

test('three people: the first two are paired, the third keeps waiting', async () => {
  const { lobby } = makeLobby();
  const a = await seek(lobby, 'a-pid-0000000001'), b = await seek(lobby, 'b-pid-0000000001'), c = await seek(lobby, 'c-pid-0000000001');
  assert.ok(a.conn.last('matched') && b.conn.last('matched'));
  assert.equal(c.conn.last('matched'), undefined);
  assert.equal(lobby.waiting.length, 1);
  const d = await seek(lobby, 'd-pid-0000000001');
  assert.equal(c.conn.last('matched').code, d.conn.last('matched').code);
});

test('you cannot be matched with yourself: a second tab replaces the first', async () => {
  const { lobby } = makeLobby();
  const a1 = await seek(lobby, 'same-pid-00000001');
  const a2 = await seek(lobby, 'same-pid-00000001');
  assert.equal(a1.conn.last('matched'), undefined);
  assert.equal(a1.conn.closed?.reason, 'replaced');
  assert.equal(lobby.waiting.length, 1);
  const b = await seek(lobby, 'other-pid-0000001');
  assert.equal(a2.conn.last('matched').code, b.conn.last('matched').code);
});

test('cancelling or disconnecting takes you out of the queue', async () => {
  const { lobby } = makeLobby();
  const a = await seek(lobby, 'a-pid-0000000001');
  await lobby.receive(a.s, JSON.stringify({ t: 'cancel' }));
  assert.equal(lobby.waiting.length, 0);
  assert.equal(a.conn.closed?.reason, 'cancel');
  const b = await seek(lobby, 'b-pid-0000000001');
  lobby.detach(b.s);
  assert.equal(lobby.waiting.length, 0);
  const c = await seek(lobby, 'c-pid-0000000001');
  assert.equal(c.conn.last('matched'), undefined, 'nobody left to match with');
});

test('nonsense is ignored', async () => {
  const { lobby } = makeLobby();
  const conn = new FakeConn();
  const s: Seeker = lobby.attach(conn);
  await lobby.receive(s, 'not json');
  await lobby.receive(s, JSON.stringify({ t: 'find', pid: 'x' }));
  await lobby.receive(s, JSON.stringify({ t: 'matched', code: 'HACK' }));
  assert.equal(lobby.waiting.length, 0);
  assert.equal(conn.sent.length, 0);
});
