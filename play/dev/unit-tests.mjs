// Automated checks.
//   Part 1: each of the 5 game rule modules, in isolation, with a forced
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
import * as bigBlast from '../src/games/big-blast.js';
import * as hotPotato from '../src/games/hot-potato.js';
import * as colorPanic from '../src/games/color-panic.js';
import * as rope from '../src/games/rope.js';
import * as wobblyTower from '../src/games/wobbly-tower.js';
import { MAX_PLAYERS, MIN_PLAYERS, PLAYER_COLORS, GAME_REGISTRY } from '../public/js/shared.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8799;
let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + label); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seq = (...vals) => { let i = 0; return () => vals[Math.min(i++, vals.length - 1)]; };

// ── Part 1a: Big Blast ──────────────────────────────────────

{
  const s = bigBlast.createState([1, 2], seq(0.5)); // floor(0.5*6) = 3
  ok(s.dangerousIndex === 3, 'big-blast: dangerousIndex derives from the injected rand, not Math.random');
  ok(s.seats.length === 2 && s.phase === 'choosing', 'big-blast: fresh state is 2 seats, choosing');
  ok(!('dangerousIndex' in bigBlast.view(s)), 'big-blast: view() strips the secret dangerous index');

  bigBlast.handleAction(s, 2, { index: 0 }); // not seat 1's turn to act as seat 2
  ok(s.phase === 'choosing' && s.buttons[0] == null, 'big-blast: acting out of turn is rejected');

  bigBlast.handleAction(s, 1, { index: 1 }); // a safe pick
  ok(s.phase === 'reveal' && s.buttons[1] === 'safe' && s.lastPick.result === 'safe', 'big-blast: a safe pick enters reveal');
  bigBlast.tick(s, s.revealAt + 1);
  ok(s.phase === 'choosing' && s.turnIdx === 1, 'big-blast: turn advances to the next seat after a safe reveal');

  bigBlast.handleAction(s, 2, { index: 3 }); // the dangerous button
  ok(s.lastPick.result === 'danger', 'big-blast: picking the dangerous index is recorded as danger');
  bigBlast.tick(s, s.revealAt + 1);
  ok(s.phase === 'done' && s.seats.length === 1 && s.seats[0] === 1, 'big-blast: the game ends once one seat remains');
  const r = bigBlast.getResult(s);
  ok(r.tiers[0][0] === 1 && r.tiers[1][0] === 2, 'big-blast: winner ranks above the seat that was blasted');
  ok(bigBlast.nextAlarmAt(s) === null, 'big-blast: no pending alarm once done');
}

// ── Part 1b: Hot Potato ──────────────────────────────────────

{
  const s = hotPotato.createState([1, 2, 3], seq(0)); // shortest possible fuse
  ok(s.holder === 1 && s.expiresAt === s.startedAt + 8000, 'hot-potato: fuse floors at MIN_FUSE_MS with rand()=0');

  hotPotato.handleAction(s, 2, { target: 3 }); // not the holder
  ok(s.holder === 1, 'hot-potato: only the current holder can pass it');
  hotPotato.handleAction(s, 1, { target: 1 }); // can't pass to yourself
  ok(s.holder === 1, 'hot-potato: cannot pass to yourself');
  hotPotato.handleAction(s, 1, { target: 2 });
  ok(s.holder === 2, 'hot-potato: a valid pass moves the holder');

  hotPotato.tick(s, s.expiresAt + 1, seq(0));
  ok(s.phase === 'boom' && s.boomAt != null, 'hot-potato: expiring the fuse enters boom');
  hotPotato.tick(s, s.boomAt + 1, seq(0));
  ok(s.phase === 'holding' && !s.seats.includes(2) && s.holder === 1, 'hot-potato: the holder at boom time is eliminated; survivors get a fresh bomb');
  ok(hotPotato.isOver(s) === false, 'hot-potato: not over with 2 seats left');

  hotPotato.tick(s, s.expiresAt + 1, seq(0));
  hotPotato.tick(s, s.boomAt + 1, seq(0));
  ok(hotPotato.isOver(s) === true, 'hot-potato: over once one seat remains');
  const r = hotPotato.getResult(s);
  ok(r.tiers.length === 3 && r.tiers[0][0] === s.seats[0], 'hot-potato: elimination order reverses into ranked tiers');
}

// ── Part 1c: Color Panic ──────────────────────────────────────

{
  const COLORS = colorPanic.COLORS;
  const s = colorPanic.createState([1, 2], seq(0)); // target = COLORS[0]
  ok(s.target === COLORS[0] && s.round === 1 && s.decoyCount === 0, 'color-panic: round 1 has no decoys, target picked by rand');

  colorPanic.handleAction(s, 1, { color: 'not-a-color' });
  ok(s.picks[1] == null, 'color-panic: an invalid color is rejected');
  colorPanic.handleAction(s, 1, { color: s.target });
  colorPanic.handleAction(s, 2, { color: COLORS.find((c) => c !== s.target) });
  colorPanic.tick(s, s.deadlineAt + 1, seq(0));
  ok(s.seats.length === 1 && s.seats[0] === 1, 'color-panic: only the correct picker survives');
  ok(colorPanic.isOver(s), 'color-panic: over once one seat remains');

  const s2 = colorPanic.createState([1, 2], seq(0));
  colorPanic.handleAction(s2, 1, { color: COLORS.find((c) => c !== s2.target) });
  colorPanic.handleAction(s2, 2, { color: COLORS.find((c) => c !== s2.target) });
  const roundBefore = s2.round;
  colorPanic.tick(s2, s2.deadlineAt + 1, seq(0));
  ok(s2.seats.length === 2 && s2.round === roundBefore + 1, 'color-panic: nobody right is a reprieve, not a wipe');

  // decoyCount and the reaction window both ramp up with round via startRound -
  // drive 4 reprieved rounds (nobody answers) to reach round 5 and check both.
  const s3 = colorPanic.createState([1, 2], seq(0));
  const firstDeadlineMs = s3.deadlineAt - s3.promptAt;
  for (let i = 0; i < 4; i++) colorPanic.tick(s3, s3.deadlineAt + 1, seq(0));
  ok(s3.round === 5 && s3.decoyCount === 2, 'color-panic: round 5 introduces 2 decoy flashes');
  ok(s3.deadlineAt - s3.promptAt < firstDeadlineMs, 'color-panic: the reaction window shrinks as rounds go on');
}

// ── Part 1d: Don't Touch the Rope ─────────────────────────────

{
  const s = rope.createState([1, 2], seq(0.9)); // rand()=0.9 -> requireJump = 0.9 < 0.75 is false -> high rope
  ok(s.requireJump === false, 'rope: requireJump derives from the injected rand');

  rope.handleAction(s, 1, { type: 'jump' }); // jumping into a high rope is wrong
  rope.tick(s, s.impactAt + 1, seq(0.9));
  ok(!s.seats.includes(1) && s.seats.includes(2), 'rope: jumping when you should stay still eliminates you');

  const s2 = rope.createState([1, 2], seq(0.1)); // requireJump = true -> low rope, must jump
  rope.handleAction(s2, 1, { type: 'jump' });
  // seat 2 does nothing (stays still) - wrong when requireJump is true
  rope.tick(s2, s2.impactAt + 1, seq(0.1));
  ok(s2.seats.includes(1) && !s2.seats.includes(2), 'rope: staying still when you should jump eliminates you');

  const s3 = rope.createState([1, 2], seq(0.1));
  // neither seat acts - both touch it - a reprieve, not a double elimination
  const passBefore = s3.pass;
  rope.tick(s3, s3.impactAt + 1, seq(0.1));
  ok(s3.seats.length === 2 && s3.pass === passBefore + 1, 'rope: everyone touching it is a reprieve');
}

// ── Part 1e: Wobbly Tower ──────────────────────────────────────

{
  const s = wobblyTower.createState([1, 2]);
  wobblyTower.handleAction(s, 2, { offset: 0 }, Date.now(), seq(0)); // not seat 2's turn (seat 1 goes first)
  ok(s.blocksPlaced === 0, 'wobbly-tower: acting out of turn is rejected');

  wobblyTower.handleAction(s, 1, { offset: 100 }, Date.now(), seq(0, 0.99)); // max risk, but the collapse roll misses
  ok(s.blocksPlaced === 1 && s.phase === 'placing' && s.turnIdx === 1, 'wobbly-tower: a risky-but-lucky placement just passes the turn');
  ok(s.instability > 0, 'wobbly-tower: instability accumulates from off-center placement');

  const s2 = wobblyTower.createState([1, 2]);
  s2.instability = 90; // force near-certain collapse on the next roll
  wobblyTower.handleAction(s2, 1, { offset: 0 }, Date.now(), seq(0)); // rand()=0 always beats the collapse chance
  ok(s2.phase === 'collapsing' && s2.collapsedBy === 1, 'wobbly-tower: high instability plus an unlucky roll collapses the tower');
  wobblyTower.tick(s2, s2.collapseAt + 1);
  ok(wobblyTower.isOver(s2), 'wobbly-tower: over once collapse resolves');
  const r = wobblyTower.getResult(s2);
  ok(r.tiers[0].length === 1 && r.tiers[0][0] === 2 && r.tiers[1][0] === 1, 'wobbly-tower: everyone but the collapser wins the round');
}

// ── Part 1f: game selection ─────────────────────────────────────

{
  const g1 = pickNextGame(GAME_REGISTRY, 2, ['luck'], seq(0));
  ok(g1.category !== 'luck', 'pickNextGame: avoids repeating the last category when an alternative exists');
  const g2 = pickNextGame(GAME_REGISTRY, 2, [], seq(0));
  ok(GAME_REGISTRY[0] === g2, 'pickNextGame: with no history, rand()=0 picks the first compatible entry');
  const g3 = pickNextGame([{ id: 'x', category: 'luck', minPlayers: 2, maxPlayers: 2 }], 2, ['luck'], seq(0));
  ok(g3.id === 'x', 'pickNextGame: falls back to a same-category game when no alternative is compatible');
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
  r.currentGameId = 'big-blast';
  r.deadlineAt = Date.now() - 5; // already due
  await h.instance.alarm();
  ok(r.status === 'playing' && r.gameState != null, 'alarm: an overdue intro deadline advances straight into play');

  // Force the game to be one action away from ending, then resolve it purely
  // via the alarm (no further client action) - this is the exact scenario
  // that used to get stuck forever before the alarm-broadcast fix.
  r.gameState.seats = [1, 2];
  r.gameState.turnIdx = 0;
  r.gameState.buttons = new Array(6).fill(null);
  r.gameState.dangerousIndex = 2;
  r.gameState.phase = 'choosing';
  GAMES['big-blast'].handleAction(r.gameState, 1, { index: 2 }); // picks the dangerous button
  ok(r.gameState.phase === 'reveal', 'big-blast: picking danger enters the reveal pause');
  r.gameState.revealAt = Date.now() - 5; // force the reveal pause to already be over
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
  r.currentGameId = 'hot-potato';
  r.gameState = { seats: [2], holder: 2, phase: 'done', expiresAt: Date.now() + 99999, boomAt: null, eliminationOrder: [[1]] };
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
  r.currentGameId = 'color-panic';
  // eliminationOrder is oldest-eliminated-first; seat 1 went out in an
  // earlier round than seat 2, so seat 2's more-recent exit ranks better.
  r.gameState = { seats: [3], round: 1, target: 'red', picks: {}, promptAt: 0, deadlineAt: 0, decoyCount: 0, phase: 'done', eliminationOrder: [[1], [2]] };
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
  r.currentGameId = 'hot-potato';
  r.gameState = hotPotato.createState([1, 2, 3], seq(0));
  r.gameState.holder = 2;
  await h.instance.webSocketMessage(wsB, JSON.stringify({ type: 'leave' }));
  ok(!r.gameState.seats.includes(2), 'leave: the departed seat is removed from the active game state');
  ok(r.gameState.holder !== 2, 'leave: a holder/turn field pointing at the departed seat is patched to someone still in the game');
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
