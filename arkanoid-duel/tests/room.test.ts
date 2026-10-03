import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../server/room.ts';
import type { Client, Conn } from '../server/room.ts';
import { hashPass } from '../shared/protocol.ts';
import { NET, TIMING } from '../shared/constants.ts';

const CODE = 'Q7K9';
const PASS = 'maple 42';

class FakeConn implements Conn {
  sent: any[] = [];
  closed: { code?: number; reason?: string } | null = null;
  send(d: string) { this.sent.push(JSON.parse(d)); }
  close(code?: number, reason?: string) { this.closed = { code, reason }; }
  of(t: string) { return this.sent.filter((m) => m.t === t); }
  last(t: string) { return this.of(t).at(-1); }
}

async function makeRoom(clock = { t: 1_000_000 }) {
  const room = new Room({ code: CODE, passHash: await hashPass(CODE, PASS), creatorPid: 'creator-pid-1', now: () => clock.t });
  return { room, clock };
}

async function join(room: Room, pid: string, pass = PASS, name = 'X') {
  const conn = new FakeConn();
  const client = room.attach(conn);
  await room.receive(client, JSON.stringify({ t: 'hello', code: CODE, pass, pid, name }));
  return { conn, client };
}
const say = (room: Room, c: Client, m: object) => room.receive(c, JSON.stringify(m));
const advance = (room: Room, clock: { t: number }, seconds: number) => {
  const end = clock.t + seconds * 1000;
  while (clock.t < end) { clock.t += 1000 / 60; room.pump(clock.t); }
};

test('the creator is Player 1; the next to join is Player 2; a third is turned away', async () => {
  const { room } = await makeRoom();
  const a = await join(room, 'creator-pid-1', PASS, 'Alex');
  assert.equal(a.conn.last('welcome').you, 1);
  const b = await join(room, 'friend-pid-0001', PASS, 'Maisie');
  assert.equal(b.conn.last('welcome').you, 2);
  assert.deepEqual(b.conn.last('welcome').names, ['Alex', 'Maisie']);
  const c = await join(room, 'stranger-pid-001');
  assert.equal(c.conn.last('err').code, 'full');
  assert.equal(c.conn.closed?.reason, 'full');
  assert.equal(room.match.phase, 'READY');
  room.dispose();
});

test('even if a friend arrives first, the creator still gets Player 1', async () => {
  const { room } = await makeRoom();
  const b = await join(room, 'friend-pid-0001');
  assert.equal(b.conn.last('welcome').you, 2);
  const a = await join(room, 'creator-pid-1');
  assert.equal(a.conn.last('welcome').you, 1);
  room.dispose();
});

test('a wrong passcode is refused, tells you how many tries are left, and nobody gets in', async () => {
  const { room } = await makeRoom();
  const x = await join(room, 'creator-pid-1', 'wrong');
  assert.equal(x.conn.last('err').code, 'bad_passcode');
  assert.equal(x.conn.last('err').left, NET.passAttempts - 1);
  assert.equal(room.seated, 0);
  const y = await join(room, 'creator-pid-1', PASS);
  assert.equal(y.conn.last('welcome').you, 1, 'the right one still works');
  room.dispose();
});

test('guessing is locked out after a few wrong passcodes, even for the right one, then it lifts', async () => {
  const { room, clock } = await makeRoom();
  for (let i = 0; i < NET.passAttempts; i++) await join(room, 'guesser-pid-' + String(i).padStart(4, '0'), 'nope' + i);
  const locked = await join(room, 'creator-pid-1', PASS);
  assert.equal(locked.conn.last('err').code, 'locked');
  assert.ok(locked.conn.last('err').retry > 0);
  clock.t += NET.passLockMs + 1000;
  const ok = await join(room, 'creator-pid-1', PASS);
  assert.equal(ok.conn.last('welcome').you, 1);
  room.dispose();
});

test('nothing but hello is listened to before the passcode has been accepted', async () => {
  const { room } = await makeRoom();
  const conn = new FakeConn();
  const client = room.attach(conn);
  await say(room, client, { t: 'ready' });
  await say(room, client, { t: 'in', x: 100 });
  assert.equal(room.seated, 0);
  assert.equal(conn.sent.length, 0);
  room.detach(client);
  room.dispose();
});

test('a room code that is not this room is not found', async () => {
  const { room } = await makeRoom();
  const conn = new FakeConn();
  const client = room.attach(conn);
  await room.receive(client, JSON.stringify({ t: 'hello', code: 'ZZZZ', pass: PASS, pid: 'creator-pid-1', name: 'a' }));
  assert.equal(conn.last('err').code, 'not_found');
  room.dispose();
});

test('malformed and oversized messages are ignored, not crashed on', async () => {
  const { room } = await makeRoom();
  const a = await join(room, 'creator-pid-1');
  for (const junk of ['', '{', 'null', '[]', '{"t":5}', '{"t":"in","x":"far"}', '{"t":"in","x":null}', '{"t":"nope"}', 'x'.repeat(5000), '{"t":"speed"}']) {
    await room.receive(a.client, junk);
  }
  await room.receive(a.client, 12345);
  assert.equal(room.seated, 1);
  assert.ok(room.droppedMessages >= 8);
  room.dispose();
});

test('a flood of messages is cut off', async () => {
  const { room } = await makeRoom();
  const a = await join(room, 'creator-pid-1');
  for (let i = 0; i < NET.maxMessagesPerSecond * 5 + 10; i++) await say(room, a.client, { t: 'in', x: 500 });
  assert.equal(a.conn.closed?.reason, 'rate');
  room.dispose();
});

test('ready up, share a countdown, and only the serving player can launch (over the wire)', async () => {
  const { room, clock } = await makeRoom();
  const a = await join(room, 'creator-pid-1', PASS, 'A');
  const b = await join(room, 'friend-pid-0001', PASS, 'B');
  await say(room, a.client, { t: 'ready' });
  assert.equal(room.match.phase, 'READY');
  await say(room, b.client, { t: 'ready' });
  assert.equal(room.match.phase, 'COUNTDOWN');
  await say(room, a.client, { t: 'serve' });
  assert.equal(room.match.phase, 'COUNTDOWN', 'serve during the countdown is rejected');
  advance(room, clock, TIMING.countdown + TIMING.go + 0.2);
  assert.equal(room.match.phase, 'SERVE');
  await say(room, b.client, { t: 'serve' });
  assert.equal(room.match.phase, 'SERVE', 'the receiving player cannot serve');
  await say(room, a.client, { t: 'serve' });
  assert.equal(room.match.phase, 'PLAYING');
  await say(room, a.client, { t: 'serve' });
  await say(room, b.client, { t: 'serve' });
  assert.equal(room.match.phase, 'PLAYING');
  advance(room, clock, 0.2);
  // both clients saw the same story, in the same order
  const phases = (c: FakeConn) => c.of('s').map((m) => m.ph).filter((p, i, arr) => i === 0 || p !== arr[i - 1]);
  assert.deepEqual(phases(a.conn).slice(-3), ['COUNTDOWN', 'SERVE', 'PLAYING']);
  assert.deepEqual(phases(a.conn).slice(-3), phases(b.conn).slice(-3), 'both clients saw the same story');
  room.dispose();
});

test('paddle input from each player moves only their own paddle', async () => {
  const { room, clock } = await makeRoom();
  const a = await join(room, 'creator-pid-1');
  const b = await join(room, 'friend-pid-0001');
  await say(room, a.client, { t: 'in', x: 200 });
  await say(room, b.client, { t: 'in', x: 800 });
  advance(room, clock, 1);
  const s = a.conn.last('s');
  assert.ok(Math.abs(s.p[0] - 200) < 1 && Math.abs(s.p[1] - 800) < 1, `paddles at ${s.p}`);
  room.dispose();
});

test('snapshots arrive at 30 per second and level data is sent when the wall changes', async () => {
  const { room, clock } = await makeRoom();
  const a = await join(room, 'creator-pid-1');
  await join(room, 'friend-pid-0001');
  const n0 = a.conn.of('s').length;
  advance(room, clock, 2);
  const n = a.conn.of('s').length - n0;
  assert.ok(n >= 58 && n <= 62, `${n} snapshots in 2 s`);
  assert.equal(a.conn.last('level').level, 1);
  assert.equal(a.conn.last('level').blocks.length, 64);
  room.dispose();
});

test('a dropped player gets their seat back; the opponent is told; the match resumes', async () => {
  const { room, clock } = await makeRoom();
  const a = await join(room, 'creator-pid-1');
  const b = await join(room, 'friend-pid-0001');
  await say(room, a.client, { t: 'ready' }); await say(room, b.client, { t: 'ready' });
  advance(room, clock, TIMING.countdown + TIMING.go + 0.2);
  await say(room, a.client, { t: 'serve' });
  advance(room, clock, 0.5);
  room.detach(b.client);
  assert.equal(room.match.phase, 'DISCONNECTED');
  advance(room, clock, 2);
  assert.equal(a.conn.last('s').ph, 'DISCONNECTED');
  assert.equal(a.conn.last('s').cn[1], false);
  // a stranger cannot take the held seat...
  const stranger = await join(room, 'stranger-pid-001');
  assert.equal(stranger.conn.last('err').code, 'full');
  // ...but the same player can
  const b2 = await join(room, 'friend-pid-0001');
  assert.equal(b2.conn.last('welcome').you, 2);
  assert.equal(room.match.phase, 'COUNTDOWN');
  room.dispose();
});

test('joining again from another device replaces the old connection', async () => {
  const { room } = await makeRoom();
  const a = await join(room, 'creator-pid-1');
  const a2 = await join(room, 'creator-pid-1');
  assert.equal(a.conn.last('err').code, 'replaced');
  assert.equal(a2.conn.last('welcome').you, 1);
  assert.equal(room.seated, 1);
  room.dispose();
});

test('if the opponent never returns, the seat is freed for someone new', async () => {
  const { room, clock } = await makeRoom();
  const a = await join(room, 'creator-pid-1');
  const b = await join(room, 'friend-pid-0001');
  await say(room, a.client, { t: 'ready' }); await say(room, b.client, { t: 'ready' });
  advance(room, clock, 1);
  room.detach(b.client);
  advance(room, clock, TIMING.disconnectGrace + 1);
  assert.equal(room.match.phase, 'WAITING_FOR_PLAYER');
  const c = await join(room, 'newcomer-pid-01', PASS, 'New');
  assert.equal(c.conn.last('welcome').you, 2);
  assert.equal(room.match.phase, 'READY');
  room.dispose();
});

test('the waiting player can give up straight away', async () => {
  const { room, clock } = await makeRoom();
  const a = await join(room, 'creator-pid-1');
  const b = await join(room, 'friend-pid-0001');
  await say(room, a.client, { t: 'ready' }); await say(room, b.client, { t: 'ready' });
  advance(room, clock, 1);
  room.detach(b.client);
  await say(room, a.client, { t: 'leave' });
  assert.equal(room.match.phase, 'WAITING_FOR_PLAYER');
  room.dispose();
});

test('an empty room is thrown away after a while', async () => {
  const clock = { t: 1_000_000 };
  let idle = 0;
  const room = new Room({ code: CODE, passHash: await hashPass(CODE, PASS), creatorPid: 'creator-pid-1', now: () => clock.t, onIdle: () => idle++ });
  const a = await join(room, 'creator-pid-1');
  room.detach(a.client);
  advance(room, clock, TIMING.serverIdleClose + 2);
  assert.equal(idle, 1);
  room.dispose();
});

test('ping is answered with the server clock', async () => {
  const { room, clock } = await makeRoom();
  const conn = new FakeConn();
  const client = room.attach(conn);
  await say(room, client, { t: 'ping', c: 12345 });
  assert.deepEqual(conn.last('pong'), { t: 'pong', c: 12345, st: clock.t });
  room.detach(client);
  room.dispose();
});

test('game speed can be chosen by Player 1 before the match', async () => {
  const { room } = await makeRoom();
  const a = await join(room, 'creator-pid-1');
  const b = await join(room, 'friend-pid-0001');
  await say(room, b.client, { t: 'speed', v: 0.8 });
  assert.equal(room.match.speedSetting, 1);
  await say(room, a.client, { t: 'speed', v: 0.8 });
  assert.equal(room.match.speedSetting, 0.8);
  room.dispose();
});
