// Two bots play a real match over real WebSockets against the local server
// (the same Worker and Room code as production), running faster than real time.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

process.env.PORT = '0';
process.env.QUIET = '1';
process.env.TIMESCALE = '24';
const { server, rooms } = await import('../dev/local-server.mjs');
const { Bot, createGame } = await import('../dev/bot.mjs');

let base = '';
before(async () => {
  if (!server.listening) await once(server, 'listening');
  base = `http://localhost:${(server.address() as { port: number }).port}`;
});
after(() => { for (const r of rooms.values()) r.dispose(); server.close(); server.closeAllConnections?.(); });

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, ms: number, label: string) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + label);
    await wait(25);
  }
}

test('health check and room creation', async () => {
  assert.deepEqual(await (await fetch(base + '/health')).json(), { ok: true, service: 'arkanoid-duel' });
  const bad = await createGame(base, 'x', 'creator-pid-aaaa');
  assert.equal(bad.status, 400, 'a passcode must be 3 to 24 characters');
  const ok = await createGame(base, 'rosebud', 'creator-pid-aaaa');
  assert.equal(ok.status, 200);
  assert.match(ok.body.code, /^[2-9A-HJ-NP-Z]{4}$/);
  const info = await (await fetch(`${base}/api/rooms/${ok.body.code}`)).json();
  assert.deepEqual(info, { exists: true, full: false });
  assert.equal((await fetch(`${base}/api/rooms/ZZZZ`)).status === 200, true);
  assert.equal((await (await fetch(`${base}/api/rooms/ZZZZ`)).json()).exists, false);
});

test('a wrong passcode never gets in; the right one does; a third player is refused', async () => {
  const { body } = await createGame(base, 'rosebud', 'creator-pid-bbbb');
  const bad = new Bot({ base, code: body.code, pass: 'guess', pid: 'intruder-pid-0001' });
  const r = await bad.connect();
  assert.equal(r.ok, false);
  assert.equal(r.err?.code, 'bad_passcode');
  const a = new Bot({ base, code: body.code, pass: 'rosebud', pid: 'creator-pid-bbbb', name: 'A' });
  const b = new Bot({ base, code: body.code, pass: 'rosebud', pid: 'friend-pid-bbbb01', name: 'B' });
  assert.deepEqual(await a.connect(), { ok: true, you: 1 });
  assert.deepEqual(await b.connect(), { ok: true, you: 2 });
  const c = new Bot({ base, code: body.code, pass: 'rosebud', pid: 'third-pid-bbbb0001' });
  assert.equal((await c.connect()).err?.code, 'full');
  a.close(); b.close();
});

test('a game that does not exist says so', async () => {
  const bot = new Bot({ base, code: 'ZZZ9', pass: 'whatever', pid: 'nobody-pid-000001' });
  const r = await bot.connect().catch((e) => ({ ok: false, error: e }));
  assert.equal(r.ok, false);
});

test('a whole match: serve, rally, break blocks, score, alternate serves, clear levels, win, rematch', async () => {
  const { body } = await createGame(base, 'rosebud', 'creator-pid-cccc');
  const mk = (pid: string, name: string, skill: number, seed: number) => new Bot({ base, code: body.code, pass: 'rosebud', pid, name, skill, rematch: true, seed });
  const a = mk('creator-pid-cccc', 'Alex', 0.55, 1);
  const b = mk('friend-pid-cccc01', 'Maisie', 0.5, 2);
  await a.connect(); await b.connect();

  await until(() => a.snap?.ph === 'MATCH_WON' || b.snap?.ph === 'MATCH_WON', 150_000, 'the match to be won');
  const s = a.snap!;
  assert.ok(s.mw === 1 || s.mw === 2, 'there is a winner');
  assert.equal(Math.max(...s.lw), 3, 'the winner took three levels');
  assert.ok(s.sc[0] > 0 && s.sc[1] > 0, `both scored (${s.sc})`);

  // the story both players saw is the same, and includes every stage
  const story = (bot: InstanceType<typeof Bot>) => bot.phases.join(' ');
  for (const bot of [a, b]) {
    for (const ph of ['COUNTDOWN', 'SERVE', 'PLAYING', 'RALLY_END', 'LEVEL_CLEAR', 'MATCH_WON']) assert.ok(story(bot).includes(ph), `${bot.name} saw ${ph}`);
  }
  // serves alternated: the player who served in each successive rally flips
  const serves = a.events.filter((e: any[]) => e[0] === 'sv').map((e: any[]) => e[1]);
  assert.ok(serves.length >= 6, `${serves.length} serves`);
  assert.equal(serves[0], 1, 'player 1 served first');
  for (let i = 1; i < serves.length; i++) assert.notEqual(serves[i], serves[i - 1], `serve ${i + 1} alternated`);
  // blocks were destroyed, with credit
  const kills = a.events.filter((e: any[]) => e[0] === 'bd');
  assert.ok(kills.length > 100, `${kills.length} blocks broken over the match`);
  assert.ok(kills.some((e: any[]) => e[1] === 1) && kills.some((e: any[]) => e[1] === 2), 'both players got credit');
  assert.ok(kills.some((e: any[]) => e[3] >= 3), 'combos built up');
  assert.ok(a.events.some((e: any[]) => e[0] === 'lose'), 'rallies were lost');
  assert.deepEqual(b.snap!.sc, a.snap!.sc, 'both see the same score');

  // rematch: both bots ask, everything resets and a new match begins
  await until(() => a.snap!.ph !== 'MATCH_WON' && a.snap!.ph !== 'REMATCH', 8000, 'the rematch to start');
  assert.equal(a.snap!.lv >= 1 && a.snap!.lw[0] <= 1 && a.snap!.lw[1] <= 1, true, 'a fresh match: no level wins carried over');
  assert.ok(a.snap!.lv <= 2, 'back at the start');
  assert.ok(a.phases.filter((p: string) => p === 'COUNTDOWN').length >= 2, 'a new countdown');
  a.close(); b.close();
});

test('if a player drops, the other is told, and the same player can come back', async () => {
  const { body } = await createGame(base, 'rosebud', 'creator-pid-dddd');
  const a = new Bot({ base, code: body.code, pass: 'rosebud', pid: 'creator-pid-dddd', name: 'A' });
  const b = new Bot({ base, code: body.code, pass: 'rosebud', pid: 'friend-pid-dddd01', name: 'B' });
  await a.connect(); await b.connect();
  await until(() => a.snap?.ph === 'PLAYING', 20000, 'play to begin');
  b.close();
  await until(() => a.snap?.ph === 'DISCONNECTED', 5000, 'the drop to be noticed');
  assert.equal(a.snap!.cn[1], false);
  const b2 = new Bot({ base, code: body.code, pass: 'rosebud', pid: 'friend-pid-dddd01', name: 'B' });
  assert.deepEqual(await b2.connect(), { ok: true, you: 2 });
  await until(() => a.snap?.ph === 'COUNTDOWN' || a.snap?.ph === 'SERVE', 5000, 'the match to resume');
  a.close(); b2.close();
});
