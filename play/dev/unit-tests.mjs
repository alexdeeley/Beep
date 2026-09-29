// Automated checks.
//   Part 1: the one game rule module, in isolation, with a forced
//     (non-random) `rand` function passed directly - no server involved.
//   Part 2: the MatchRoom Durable Object's protocol via an in-process
//     harness (deterministic scenarios forced directly onto room/gameState,
//     since production has no wire-level "force an outcome" backdoor).
//   Part 3: the real wire protocol against a real spawned local server.
//
//   node dev/unit-tests.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeHolder, FakeSocket } from './emulate.mjs';
import { MatchRoom } from '../src/match-room.js';
import { Leaderboard } from '../src/leaderboard.js';
import { GAMES, pickNextGame } from '../src/games/index.js';
import * as lastStrand from '../src/games/last-strand.js';
import { MAX_PLAYERS, MIN_PLAYERS, PLAYER_COLORS, GAME_REGISTRY } from '../public/js/shared.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8799;
let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + label); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seq = (...vals) => { let i = 0; return () => vals[Math.min(i++, vals.length - 1)]; };

// ── Part 1: The Last Strand ──────────────────────────────────

{
  const s = lastStrand.createState([1, 2]);
  ok(s.strandsTotal === 8 && s.cutMask.every((c) => !c), 'last-strand: a fresh rope has 8 uncut strands');
  ok(s.phase === 'cutting' && s.turnIdx === 0 && s.instability === 0, 'last-strand: fresh state starts cutting, seat 0’s turn, no tension yet');
  ok(lastStrand.view(s) === s, 'last-strand: view() is the identity - nothing here is ever secret');

  lastStrand.handleAction(s, 2, { index: 0 }, Date.now(), seq(0.99)); // not seat 1's turn
  ok(s.cutMask.every((c) => !c), 'last-strand: acting out of turn is rejected');

  lastStrand.handleAction(s, 1, { index: 0 }, Date.now(), seq(0.99)); // rand()=0.99 always misses the collapse roll
  ok(s.cutMask[0] === true && s.lastCut.seat === 1 && s.lastCut.index === 0, 'last-strand: a valid cut marks the strand and records who cut it');
  ok(s.instability > 0, 'last-strand: instability rises after a cut');
  ok(s.phase === 'cutting' && s.turnIdx === 1, 'last-strand: a cut that doesn’t collapse just passes the turn');

  lastStrand.handleAction(s, 1, { index: 0 }, Date.now(), seq(0.99)); // seat 1's turn, but strand 0 already cut
  ok(s.turnIdx === 1, 'last-strand: cutting an already-cut strand is rejected');

  // Force near-certain collapse and confirm an unlucky roll brings it down.
  const s2 = lastStrand.createState([1, 2, 3]);
  s2.instability = 95;
  lastStrand.handleAction(s2, 1, { index: 0 }, Date.now(), seq(0)); // rand()=0 always beats the collapse chance
  ok(s2.phase === 'collapsing' && s2.collapsedBy === 1 && s2.collapseAt != null, 'last-strand: high instability plus an unlucky roll collapses the rope');
  lastStrand.tick(s2, s2.collapseAt - 1); // not yet due
  ok(s2.phase === 'collapsing', 'last-strand: tick() before collapseAt does nothing yet');
  lastStrand.tick(s2, s2.collapseAt + 1);
  ok(!s2.seats.includes(1) && s2.seats.length === 2, 'last-strand: the cutter is eliminated once the collapse resolves');
  ok(s2.phase === 'cutting' && s2.strandsTotal === 8 && s2.cutMask.every((c) => !c) && s2.instability === 0, 'last-strand: survivors get a brand new rope, fully reset');
  ok(lastStrand.isOver(s2) === false, 'last-strand: not over with 2 seats left');

  // Cutting the literal last remaining strand is a guaranteed collapse,
  // regardless of how the dice would otherwise land.
  const s3 = lastStrand.createState([1, 2]);
  s3.cutMask = new Array(8).fill(true);
  s3.cutMask[7] = false; // exactly one strand left
  lastStrand.handleAction(s3, 1, { index: 7 }, Date.now(), seq(0.9999)); // would never collapse under the normal formula
  ok(s3.phase === 'collapsing' && s3.collapsedBy === 1, 'last-strand: cutting the final strand always brings it down');

  // Run a full 3-player game to a champion and check the result shape.
  const s4 = lastStrand.createState([1, 2, 3]);
  s4.instability = 95;
  lastStrand.handleAction(s4, 1, { index: 0 }, Date.now(), seq(0)); // seat 1 collapses it
  lastStrand.tick(s4, s4.collapseAt + 1);
  ok(s4.seats.length === 2 && !s4.seats.includes(1), 'last-strand: seat 1 eliminated first');
  s4.instability = 95;
  lastStrand.handleAction(s4, s4.seats[s4.turnIdx], { index: 0 }, Date.now(), seq(0)); // whoever's turn it is collapses it
  const secondOut = s4.collapsedBy;
  lastStrand.tick(s4, s4.collapseAt + 1);
  ok(lastStrand.isOver(s4), 'last-strand: over once one seat remains');
  const r = lastStrand.getResult(s4);
  ok(r.tiers[0][0] === s4.seats[0], 'last-strand: the sole survivor is tier 0 (the champion)');
  ok(r.tiers[1][0] === secondOut, 'last-strand: the more-recently-eliminated seat ranks above the earliest one');
  ok(r.tiers[2][0] === 1, 'last-strand: the first seat eliminated ranks last');
  ok(r.note === 'brought the rope down', 'last-strand: getResult carries the expected note');
  ok(lastStrand.nextAlarmAt(s4) === null, 'last-strand: no pending alarm once done');
  ok(lastStrand.nextAlarmAt(s2) === null, 'last-strand: no pending alarm mid-cutting either');
}

// ── Part 1f: game selection ─────────────────────────────────────
// Uses fake multi-entry registries throughout, deliberately decoupled from
// how many real games GAME_REGISTRY happens to contain right now.

{
  const fakeRegistry = [
    { id: 'a', category: 'luck', minPlayers: 2, maxPlayers: 4 },
    { id: 'b', category: 'reaction', minPlayers: 2, maxPlayers: 4 },
  ];
  const g1 = pickNextGame(fakeRegistry, 2, ['luck'], seq(0));
  ok(g1.category !== 'luck', 'pickNextGame: avoids repeating the last category when an alternative exists');
  const g2 = pickNextGame(fakeRegistry, 2, [], seq(0));
  ok(g2 === fakeRegistry[0], 'pickNextGame: with no history, rand()=0 picks the first compatible entry');
  const g3 = pickNextGame([{ id: 'x', category: 'luck', minPlayers: 2, maxPlayers: 2 }], 2, ['luck'], seq(0));
  ok(g3.id === 'x', 'pickNextGame: falls back to a same-category game when no alternative is compatible');
  ok(GAME_REGISTRY.length === 1 && GAME_REGISTRY[0].id === 'last-strand', 'GAME_REGISTRY: pared down to just The Last Strand for launch');
}

// ── Part 1g: the shared Leaderboard Durable Object ─────────────

async function lbFetch(instance, path, opts) {
  return instance.fetch(new Request('https://leaderboard/' + path, opts));
}

{
  const h = makeHolder(Leaderboard);
  await h.ctx.ready;

  const check1 = await (await lbFetch(h.instance, 'check', { method: 'POST', body: JSON.stringify({ score: 5 }) })).json();
  ok(check1.qualifies === true, 'leaderboard: an empty board qualifies any positive score');
  const check0 = await (await lbFetch(h.instance, 'check', { method: 'POST', body: JSON.stringify({ score: 0 }) })).json();
  ok(check0.qualifies === false, 'leaderboard: a score of 0 never qualifies');

  await lbFetch(h.instance, 'submit', { method: 'POST', body: JSON.stringify({ name: 'Alex', score: 9 }) });
  await lbFetch(h.instance, 'submit', { method: 'POST', body: JSON.stringify({ name: 'Maisie', score: 15 }) });
  const top = await (await lbFetch(h.instance, 'top')).json();
  ok(top.entries[0].name === 'Maisie' && top.entries[0].score === 15, 'leaderboard: entries sort highest score first');
  ok(top.entries[1].name === 'Alex', 'leaderboard: a lower score ranks below a higher one');

  const badName = await lbFetch(h.instance, 'submit', { method: 'POST', body: JSON.stringify({ name: '', score: 5 }) });
  ok(badName.status === 400, 'leaderboard: an empty name is rejected');
  const badScore = await lbFetch(h.instance, 'submit', { method: 'POST', body: JSON.stringify({ name: 'X', score: -3 }) });
  ok(badScore.status === 400, 'leaderboard: a negative score is rejected');

  const sanitized = await (await lbFetch(h.instance, 'submit', {
    method: 'POST', body: JSON.stringify({ name: '<script>alert(1)</script> way too long a name', score: 3 }),
  })).json();
  const added = sanitized.entries.find((e) => e.score === 3);
  ok(!!added && !added.name.includes('<') && added.name.length <= 16, 'leaderboard: a submitted name is sanitized and length-capped');

  for (let i = 0; i < 25; i++) {
    await lbFetch(h.instance, 'submit', { method: 'POST', body: JSON.stringify({ name: 'P' + i, score: i + 1 }) });
  }
  const full = await (await lbFetch(h.instance, 'top')).json();
  ok(full.entries.length === 20, 'leaderboard: the board caps at 20 entries even after 28 submissions');

  const lowCheck = await (await lbFetch(h.instance, 'check', { method: 'POST', body: JSON.stringify({ score: 1 }) })).json();
  ok(lowCheck.qualifies === false, 'leaderboard: once full, a score below the current cutoff no longer qualifies');
  const highCheck = await (await lbFetch(h.instance, 'check', { method: 'POST', body: JSON.stringify({ score: 999 }) })).json();
  ok(highCheck.qualifies === true, 'leaderboard: once full, a score above the cutoff still qualifies');

  const rejectedSubmit = await lbFetch(h.instance, 'submit', { method: 'POST', body: JSON.stringify({ name: 'TooLow', score: 1 }) });
  ok(rejectedSubmit.status === 400, 'leaderboard: submit() itself re-checks qualification, not just check()');
}

// ── Part 2: MatchRoom protocol (in-process, forced state) ─────

// Every room gets its own fresh, isolated leaderboard (a real MatchRoom
// would share one global instance across every room - see worker.js - but
// per-test isolation matters more here than that realism).
function makeEnv() {
  const objects = new Map();
  const get = (id) => {
    if (!objects.has(id)) objects.set(id, makeHolder(Leaderboard));
    return objects.get(id);
  };
  return {
    LEADERBOARD: {
      idFromName: (n) => n,
      get: (id) => ({
        fetch: async (input, init) => {
          const h = get(id);
          await h.ctx.ready;
          const req = input instanceof Request ? input : new Request(input, init);
          return h.instance.fetch(req);
        },
      }),
    },
  };
}

async function withRoom(fn) {
  const h = makeHolder(MatchRoom, makeEnv());
  await h.ctx.ready;
  await h.instance.fetch(new Request('https://room/init', { method: 'POST', body: JSON.stringify({ code: 'TEST1' }) }));
  await fn(h);
}

function join(h, ws, pid, name) {
  return h.instance.webSocketMessage(ws, JSON.stringify({ type: 'hello', playerId: pid, name }));
}

await withRoom(async (h) => {
  const wsA = new FakeSocket(), wsB = new FakeSocket();
  h.instance.acceptSocket(wsA); h.instance.acceptSocket(wsB);
  await join(h, wsA, 'pid-a', 'Alice');
  await join(h, wsB, 'pid-b', 'Bob');
  ok(h.instance.room.players.length === 2, 'lobby: two hellos creates two players');
  ok(h.instance.room.players[0].color !== h.instance.room.players[1].color, 'lobby: distinct auto-assigned colors');

  await h.instance.webSocketMessage(wsA, JSON.stringify({ type: 'ready', ready: true }));
  ok(h.instance.room.status === 'lobby', 'lobby: does not auto-start with only one of two ready');
  await h.instance.webSocketMessage(wsB, JSON.stringify({ type: 'ready', ready: true }));
  ok(h.instance.room.status === 'intro', 'lobby: auto-starts the instant everyone is ready (no explicit Start click needed)');
  ok(GAME_REGISTRY.some((g) => g.id === h.instance.room.currentGameId), 'intro: picked a real registered game');
});

await withRoom(async (h) => {
  // Force straight into a known game so the round-flow can be driven deterministically.
  const wsA = new FakeSocket(), wsB = new FakeSocket();
  h.instance.acceptSocket(wsA); h.instance.acceptSocket(wsB);
  await join(h, wsA, 'pid-a', 'Alice');
  await join(h, wsB, 'pid-b', 'Bob');
  const r = h.instance.room;
  r.status = 'intro';
  r.currentGameId = 'last-strand';
  r.deadlineAt = Date.now() - 5; // already due
  await h.instance.alarm();
  ok(r.status === 'playing' && r.gameState != null, 'alarm: an overdue intro deadline advances straight into play');

  // Force the game to be one action away from ending, then resolve it purely
  // via the alarm (no further client action) - this is the exact scenario
  // that used to get stuck forever before the alarm-broadcast fix.
  r.gameState.seats = [1, 2];
  r.gameState.turnIdx = 0;
  r.gameState.instability = 95; // the next cut is very likely to collapse it
  GAMES['last-strand'].handleAction(r.gameState, 1, { index: 0 }, Date.now(), () => 0); // an unlucky cut
  ok(r.gameState.phase === 'collapsing', 'last-strand: an unlucky cut enters the collapse pause');
  r.gameState.collapseAt = Date.now() - 5; // force the collapse pause to already be over
  await h.instance.alarm();
  ok(r.status === 'result', 'alarm regression: a round that resolves purely on a timer still advances the room to result');
  ok(wsA.lastState()?.status === 'result', 'alarm regression: the resolved state is actually broadcast to clients, not just mutated in memory');
});

await withRoom(async (h) => {
  // 2-player scoring: winner gets POINTS_FIRST, loser gets 0 (no "second place" point).
  const wsA = new FakeSocket(), wsB = new FakeSocket();
  h.instance.acceptSocket(wsA); h.instance.acceptSocket(wsB);
  await join(h, wsA, 'pid-a', 'Alice');
  await join(h, wsB, 'pid-b', 'Bob');
  const r = h.instance.room;
  r.status = 'playing';
  r.currentGameId = 'last-strand';
  r.gameState = { seats: [2], turnIdx: 0, strandsTotal: 8, cutMask: new Array(8).fill(false), instability: 0, phase: 'done', lastCut: null, collapseAt: null, collapsedBy: 1, eliminationOrder: [[1]] };
  h.instance.afterGameUpdate();
  const [pA, pB] = r.players;
  ok(pA.score === 0 && pB.score === 3, '2-player scoring: winner gets 3, loser gets 0 (not a generic "second place" point)');
  ok(pB.wins === 1 && pA.wins === 0, 'scoring: wins increments only for the top tier');
});

await withRoom(async (h) => {
  // 3-player scoring: a "second place" tier worth POINTS_SECOND exists.
  const wsA = new FakeSocket(), wsB = new FakeSocket(), wsC = new FakeSocket();
  h.instance.acceptSocket(wsA); h.instance.acceptSocket(wsB); h.instance.acceptSocket(wsC);
  await join(h, wsA, 'pid-a', 'Alice'); await join(h, wsB, 'pid-b', 'Bob'); await join(h, wsC, 'pid-c', 'Cara');
  const r = h.instance.room;
  r.status = 'playing';
  r.currentGameId = 'last-strand';
  // eliminationOrder is oldest-eliminated-first; seat 1 went out in an
  // earlier round than seat 2, so seat 2's more-recent exit ranks better.
  r.gameState = { seats: [3], turnIdx: 0, strandsTotal: 8, cutMask: new Array(8).fill(false), instability: 0, phase: 'done', lastCut: null, collapseAt: null, collapsedBy: 2, eliminationOrder: [[1], [2]] };
  h.instance.afterGameUpdate();
  const players = r.players;
  ok(players.find((p) => p.seat === 3).score === 3, '3-player scoring: winner gets 3');
  ok(players.find((p) => p.seat === 2).score === 1, '3-player scoring: the more-recently-eliminated tier gets 1 ("second place")');
  ok(players.find((p) => p.seat === 1).score === 0, '3-player scoring: the earliest-eliminated tier gets 0');
});

await withRoom(async (h) => {
  // Reconnection: same playerId resumes their seat and score; a stale socket
  // for that id gets pushed off with 'replaced'.
  const wsA = new FakeSocket();
  h.instance.acceptSocket(wsA);
  await join(h, wsA, 'pid-a', 'Alice');
  h.instance.room.players[0].score = 7;
  const wsA2 = new FakeSocket();
  h.instance.acceptSocket(wsA2);
  await join(h, wsA2, 'pid-a', 'Alice');
  ok(h.instance.room.players.length === 1, 'reconnect: the same playerId does not create a second player');
  ok(h.instance.room.players[0].score === 7, 'reconnect: score is preserved across a reconnect');
  ok(JSON.parse(wsA.sent.at(-1)).code === 'replaced', 'reconnect: the old socket for that id is told it was replaced');

  // Reconnection by name-match while disconnected (new tab, no saved playerId).
  const r = h.instance.room;
  r.players.push({ id: 'ghost-b', seat: 2, name: 'Bob', color: PLAYER_COLORS[1], ready: false, score: 4, wins: 0, gamesPlayed: 0 });
  const wsB = new FakeSocket();
  h.instance.acceptSocket(wsB);
  await join(h, wsB, 'new-device-id', 'Bob');
  ok(r.players.length === 2 && r.players[1].id === 'new-device-id', 'reconnect: a disconnected player is re-claimed by matching name, keeping their seat/score');
});

await withRoom(async (h) => {
  // Kick is host-only and lobby-only.
  const wsA = new FakeSocket(), wsB = new FakeSocket();
  h.instance.acceptSocket(wsA); h.instance.acceptSocket(wsB);
  await join(h, wsA, 'pid-a', 'Alice'); await join(h, wsB, 'pid-b', 'Bob');
  await h.instance.webSocketMessage(wsB, JSON.stringify({ type: 'kick', seat: 1 }));
  ok(h.instance.room.players.length === 2, 'kick: a non-host cannot kick');
  await h.instance.webSocketMessage(wsA, JSON.stringify({ type: 'kick', seat: 2 }));
  ok(h.instance.room.players.length === 1, 'kick: the host can remove another player');
  ok(JSON.parse(wsB.sent.at(-1)).code === 'kicked', 'kick: the removed player is told they were kicked');
});

await withRoom(async (h) => {
  // Leaving mid-round is a generic forfeit: the departed seat is pulled out
  // of whatever field the active game happens to name its live players.
  const wsA = new FakeSocket(), wsB = new FakeSocket(), wsC = new FakeSocket();
  h.instance.acceptSocket(wsA); h.instance.acceptSocket(wsB); h.instance.acceptSocket(wsC);
  await join(h, wsA, 'pid-a', 'Alice'); await join(h, wsB, 'pid-b', 'Bob'); await join(h, wsC, 'pid-c', 'Cara');
  const r = h.instance.room;
  r.status = 'playing';
  r.currentGameId = 'last-strand';
  r.gameState = lastStrand.createState([1, 2, 3]);
  r.gameState.turnIdx = 2; // seat 3's turn
  await h.instance.webSocketMessage(wsB, JSON.stringify({ type: 'leave' }));
  ok(!r.gameState.seats.includes(2), 'leave: the departed seat is removed from the active game state');
  ok(r.gameState.turnIdx === 0, 'leave: a turn index left pointing past the shrunk seat list is clamped back to a valid seat');
});

await withRoom(async (h) => {
  // Reaching the final round's result surfaces high-score candidacy against
  // a fresh (empty) leaderboard - everyone with a positive score qualifies.
  const wsA = new FakeSocket(), wsB = new FakeSocket();
  h.instance.acceptSocket(wsA); h.instance.acceptSocket(wsB);
  await join(h, wsA, 'pid-a', 'Alice');
  await join(h, wsB, 'pid-b', 'Bob');
  const r = h.instance.room;
  r.players[0].score = 12;
  r.players[1].score = 3;
  r.round = r.matchLength;
  r.status = 'result';
  r.deadlineAt = Date.now() - 5;
  await h.instance.advanceAfterResult();
  ok(r.status === 'matchover', 'high score: reaching the final round’s result moves straight to matchover');
  ok(r.highScoreCandidates.includes(1) && r.highScoreCandidates.includes(2), 'high score: both players qualify against a fresh empty leaderboard');
  ok(Array.isArray(r.leaderboardTop), 'high score: the current top list is fetched and stored for display');

  await h.instance.webSocketMessage(wsA, JSON.stringify({ type: 'submitHighScore', name: 'Alex R' }));
  ok(r.players[0].highScoreSubmitted === true, 'high score: a qualifying player’s submission is recorded');
  ok(!r.highScoreCandidates.includes(1), 'high score: a submitted player drops off the pending-candidates list');
  ok(r.leaderboardTop.some((e) => e.name === 'Alex R' && e.score === 12), 'high score: the entry lands on the board with the server-computed score, never a client-supplied one (the message carried no score at all)');

  await h.instance.webSocketMessage(wsA, JSON.stringify({ type: 'submitHighScore', name: 'Someone Else' }));
  ok(!r.leaderboardTop.some((e) => e.name === 'Someone Else'), 'high score: a player who already submitted this match cannot submit again');
});

await withRoom(async (h) => {
  // Pre-fill the shared board so a modest score genuinely doesn't qualify,
  // then confirm the server - not the client - is what decides that.
  const wsA = new FakeSocket();
  h.instance.acceptSocket(wsA);
  await join(h, wsA, 'pid-a', 'Alice');
  const stub = h.instance.leaderboardStub();
  for (let i = 0; i < 20; i++) {
    await stub.fetch('https://leaderboard/submit', { method: 'POST', body: JSON.stringify({ name: 'P' + i, score: 100 + i }) });
  }
  const r = h.instance.room;
  r.players[0].score = 5; // far below the board's current cutoff
  await h.instance.finishMatch();
  ok(!r.highScoreCandidates.includes(1), 'high score: a score below the current cutoff does not qualify');

  await h.instance.webSocketMessage(wsA, JSON.stringify({ type: 'submitHighScore', name: 'Cheater' }));
  const top = await (await stub.fetch('https://leaderboard/top')).json();
  ok(!top.entries.some((e) => e.name === 'Cheater'), 'high score: a non-candidate cannot force a submission through regardless of what the client claims');
});

// ── Part 3: real wire protocol against a real spawned server ────

console.log('\nPart 3: live server...');
const server = spawn('node', ['dev/local-server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('server did not start')), 5000);
  server.stdout.on('data', (d) => { if (d.toString().includes('localhost')) { clearTimeout(t); resolve(); } });
});

async function wsClient(code, pid, name) {
  const ws = new WebSocket(`ws://localhost:${PORT}/api/rooms/${code}/ws`);
  const c = { ws, state: null, seat: null };
  await new Promise((resolve) => {
    ws.addEventListener('open', () => { ws.send(JSON.stringify({ type: 'hello', playerId: pid, name })); });
    ws.addEventListener('message', (e) => {
      if (e.data === 'pong') return;
      const m = JSON.parse(e.data);
      if (m.type === 'state') { c.state = m; c.seat = m.you; resolve(); }
    });
  });
  ws.addEventListener('message', (e) => {
    if (e.data === 'pong') return;
    const m = JSON.parse(e.data);
    if (m.type === 'state') { c.state = m; c.seat = m.you; }
  });
  return c;
}
const send = (c, obj) => c.ws.send(JSON.stringify(obj));
const untilStatus = async (c, status, timeoutMs = 20000) => {
  const start = Date.now();
  while (c.state?.status !== status) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for status=${status}, got ${c.state?.status}`);
    await sleep(50);
  }
};

try {
  const createRes = await fetch(`http://localhost:${PORT}/api/rooms`, { method: 'POST' });
  const { code } = await createRes.json();
  ok(/^[A-Z]+\d$/.test(code), 'worker: created room code matches the expected word+digit shape');

  const existsRes = await fetch(`http://localhost:${PORT}/api/rooms/${code}`);
  const existsData = await existsRes.json();
  ok(existsData.exists === true && existsData.full === false && existsData.started === false, 'worker: /exists reports an open lobby correctly');

  const notFoundRes = await fetch(`http://localhost:${PORT}/api/rooms/NOPE9`);
  ok((await notFoundRes.json()).exists === false, 'worker: an unused code correctly reports not existing');

  const p1 = await wsClient(code, 'pid-p1', 'Alice');
  const p2 = await wsClient(code, 'pid-p2', 'Bob');
  send(p1, { type: 'ready', ready: true });
  send(p2, { type: 'ready', ready: true });
  await untilStatus(p1, 'intro');
  ok(true, 'live: two ready players auto-start a real match over real WebSockets');

  await untilStatus(p1, 'playing', 5000);
  ok(p1.state.gameState != null && p1.state.currentGameId != null, 'live: entering play delivers a real game state and id to both clients');
  ok(p2.state.currentGameId === p1.state.currentGameId, 'live: both clients see the same active game');

  p1.ws.close(); p2.ws.close();
} catch (e) {
  fail++;
  console.log('  ✗ live server test threw: ' + e.message);
}

server.kill();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
