// Automated checks.
//   Part 1: the pure scoring engine (no server at all).
//   Part 2: exact game-state scenarios via an in-process Durable Object
//     harness (deterministic - dice are forced directly on the room object,
//     since production has no wire-level "force a roll" backdoor).
//   Part 3: the real wire protocol against a real spawned local server,
//     played adaptively since real dice are genuinely random.
//
//   node dev/unit-tests.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  rollDie, rollDice, scoreCategory, isCategory, newCategories, isComplete,
  upperTotal, upperBonus, lowerTotal, grandTotal, CATEGORY_IDS, UPPER_IDS, LOWER_IDS,
  DICE_COUNT, MAX_ROLLS, UPPER_BONUS_THRESHOLD, UPPER_BONUS,
} from '../src/scoring.js';
import { makeHolder, FakeSocket } from './emulate.mjs';
import { RollRoom } from '../src/roll-room.js';
import { MAX_PLAYERS, TOTAL_TURNS, PLAYER_COLORS } from '../public/js/shared.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8798;
let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + label); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Part 1: scoring engine ──────────────────────────────────

ok(CATEGORY_IDS.length === 13, `13 categories (got ${CATEGORY_IDS.length})`);
ok(UPPER_IDS.length === 6 && LOWER_IDS.length === 7, 'upper/lower split is 6 + 7');

ok(scoreCategory('ones', [1, 1, 3, 4, 5]) === 2, 'ones: sum of matching 1s');
ok(scoreCategory('sixes', [6, 6, 6, 2, 3]) === 18, 'sixes: sum of matching 6s');
ok(scoreCategory('twos', [1, 3, 4, 5, 6]) === 0, 'twos: 0 when none match');

ok(scoreCategory('threeKind', [4, 4, 4, 2, 1]) === 15, 'three of a kind: sum of all dice');
ok(scoreCategory('threeKind', [4, 4, 4, 4, 1]) === 17, 'three of a kind also qualifies on four-of-a-kind dice');
ok(scoreCategory('threeKind', [1, 2, 3, 4, 5]) === 0, 'three of a kind: 0 when nothing matches three times');

ok(scoreCategory('fourKind', [5, 5, 5, 5, 2]) === 22, 'four of a kind: sum of all dice');
ok(scoreCategory('fourKind', [5, 5, 5, 2, 2]) === 0, 'four of a kind: 0 on a full house, not four matching');

ok(scoreCategory('fullHouse', [3, 3, 3, 6, 6]) === 25, 'full house: 3+2 scores 25');
ok(scoreCategory('fullHouse', [2, 2, 2, 2, 2]) === 0, 'full house: five of a kind does NOT count (no joker rule - see DECISIONS.md)');
ok(scoreCategory('fullHouse', [1, 2, 3, 4, 5]) === 0, 'full house: 0 with no pair+triple');

ok(scoreCategory('smallStraight', [1, 2, 3, 4, 6]) === 30, 'small straight: 1-2-3-4 run');
ok(scoreCategory('smallStraight', [2, 3, 4, 5, 5]) === 30, 'small straight: 2-3-4-5 run, duplicate ignored');
ok(scoreCategory('smallStraight', [3, 4, 5, 6, 1]) === 30, 'small straight: 3-4-5-6 run');
ok(scoreCategory('smallStraight', [1, 1, 2, 4, 6]) === 0, 'small straight: 0 with no 4-run');

ok(scoreCategory('largeStraight', [1, 2, 3, 4, 5]) === 40, 'large straight: 1-2-3-4-5');
ok(scoreCategory('largeStraight', [2, 3, 4, 5, 6]) === 40, 'large straight: 2-3-4-5-6');
ok(scoreCategory('largeStraight', [1, 2, 3, 4, 4]) === 0, 'large straight: 0 with a duplicate instead of a 5th value');

ok(scoreCategory('yahtzee', [6, 6, 6, 6, 6]) === 50, 'yahtzee: five matching scores 50');
ok(scoreCategory('yahtzee', [6, 6, 6, 6, 1]) === 0, 'yahtzee: 0 on four matching');

ok(scoreCategory('chance', [1, 2, 3, 4, 5]) === 15, 'chance: always the sum');
ok(scoreCategory('chance', [6, 6, 6, 6, 6]) === 30, 'chance: sum even on a yahtzee');

ok(scoreCategory('ones', [1, 1]) === 0, 'malformed dice (wrong length) scores 0, never throws');
ok(!isCategory('notacategory'), 'unknown id is not a category');
ok(isCategory('yahtzee'), 'known id is a category');

{
  const c = newCategories();
  ok(CATEGORY_IDS.every((id) => c[id] === null), 'a fresh scorecard has every category null (unfilled)');
  ok(!isComplete(c), 'a fresh scorecard is not complete');
  c.ones = 0; // a legitimate scratch - must count as filled, not "empty"
  ok(c.ones === 0 && !isComplete(c), 'a scored 0 is filled, distinct from null');
  for (const id of CATEGORY_IDS) c[id] = 0;
  ok(isComplete(c), 'complete once every category (even at 0) is non-null');
}

{
  const c = newCategories();
  c.ones = 3; c.twos = 6; c.threes = 9; c.fours = 12; c.fives = 15; c.sixes = 18; // 63 exactly
  ok(upperTotal(c) === 63, 'upper total sums the six upper categories');
  ok(upperBonus(c) === UPPER_BONUS, `bonus awarded right at the ${UPPER_BONUS_THRESHOLD} threshold`);
  c.sixes = 12; // now 57, below threshold
  ok(upperBonus(c) === 0, 'no bonus just below the threshold');
  c.chance = 20; c.yahtzee = 50;
  ok(lowerTotal(c) === 70, 'lower total sums only the lower categories');
  ok(grandTotal(c) === upperTotal(c) + upperBonus(c) + lowerTotal(c), 'grand total = upper + bonus + lower');
}

{
  // rollDie/rollDice: injectable rand for determinism, real crypto source by default
  ok(rollDie(() => 0) === 1, 'rand=0 gives face 1');
  ok(rollDie(() => 0.999) === 6, 'rand near 1 gives face 6');
  const dice = rollDice(5);
  ok(dice.length === DICE_COUNT && dice.every((d) => d >= 1 && d <= 6), 'rollDice(5) with the real source gives 5 faces in 1..6');
  const many = Array.from({ length: 300 }, () => rollDie());
  ok(new Set(many).size === 6, 'the real random source eventually produces every face (300 rolls)');
}

// ── Part 2: exact scenarios via an in-process room ──────────

async function newTable(code) {
  const h = makeHolder(RollRoom);
  await h.ctx.ready;
  await h.instance.fetch(new Request('https://room/init', { method: 'POST', body: JSON.stringify({ code }) }));
  return h;
}
async function join(h, pid, name) {
  const ws = new FakeSocket();
  h.instance.acceptSocket(ws);
  await h.instance.webSocketMessage(ws, JSON.stringify({ type: 'hello', playerId: pid, name }));
  return ws;
}
async function send(h, ws, msg) { await h.instance.webSocketMessage(ws, JSON.stringify(msg)); }
const room = (h) => h.instance.room;
const meOf = (h, seat) => room(h).players.find((p) => p.seat === seat);
const setDice = (h, values) => { room(h).dice = values.slice(); };
const turnSeat = (h) => room(h).turnOrder[room(h).turnIdx];

{
  const h = await newTable('TEST01');
  const A = await join(h, 'alex-000001', 'Alex');
  const M = await join(h, 'maisie-000001', 'Maisie');
  ok(room(h).players.length === 2, 'both players joined the lobby');
  ok(room(h).status === 'lobby', 'room starts in the lobby');

  await send(h, A, { type: 'start' }); // not host? Alex IS host (first joiner)
  ok(room(h).status === 'playing', 'host can start with 2 players');
  ok(room(h).turnOrder.length === 2 && room(h).turnIdx === 0, 'turn order set, first player up');

  const drawerSeat = turnSeat(h);
  const drawerWs = drawerSeat === 1 ? A : M;
  const otherWs = drawerSeat === 1 ? M : A;

  await send(h, otherWs, { type: 'roll' });
  ok(room(h).rollsUsed === 0, 'only the current turn player can roll');

  await send(h, drawerWs, { type: 'roll' });
  ok(room(h).rollsUsed === 1, 'the current player rolling works');
  ok(room(h).dice.every((d) => d >= 1 && d <= 6), 'a real roll fills all 5 dice with real faces');

  await send(h, drawerWs, { type: 'hold', i: 0 });
  ok(room(h).held[0] === true, 'holding a die marks it held');
  const heldValue = room(h).dice[0];
  await send(h, drawerWs, { type: 'roll' });
  ok(room(h).rollsUsed === 2 && room(h).dice[0] === heldValue, 'a held die keeps its value through the next roll');
  await send(h, drawerWs, { type: 'hold', i: 0 });
  ok(room(h).held[0] === false, 'tapping a held die again releases it');

  await send(h, drawerWs, { type: 'roll' });
  ok(room(h).rollsUsed === 3, 'third roll used');
  await send(h, drawerWs, { type: 'roll' });
  ok(room(h).rollsUsed === 3, 'a 4th roll attempt is rejected - max 3 per turn');

  setDice(h, [2, 2, 2, 5, 5]);
  const me = meOf(h, drawerSeat);
  await send(h, otherWs, { type: 'score', id: 'fullHouse' });
  ok(me.categories.fullHouse == null, 'only the current turn player can score');

  await send(h, drawerWs, { type: 'score', id: 'notacategory' });
  ok(me.categories.notacategory === undefined, 'an unknown category id is rejected');

  await send(h, drawerWs, { type: 'score', id: 'fullHouse' });
  ok(me.categories.fullHouse === 25, 'scoring full house with a real 3+2 gives 25');
  ok(room(h).turnsTaken === 1, 'turn count advances after scoring');
  ok(turnSeat(h) !== drawerSeat, 'turn passes to the other player');
  ok(room(h).rollsUsed === 0 && room(h).dice.every((d) => d === 0), 'dice and roll count reset for the next turn');

  await send(h, drawerWs, { type: 'score', id: 'fullHouse' });
  ok(room(h).turnsTaken === 1, 'scoring an already-filled category does nothing');

  const nextWs = turnSeat(h) === 1 ? A : M;
  await send(h, nextWs, { type: 'score', id: 'chance' });
  ok(room(h).turnsTaken === 1, 'scoring before any roll this turn is rejected (must roll at least once)');
}

// Every category, cross-checked against the pure scoring function.
{
  const h = await newTable('TEST02');
  const A = await join(h, 'alex-000002', 'Alex');
  const M = await join(h, 'maisie-000002', 'Maisie');
  await send(h, A, { type: 'start' });
  const cases = [
    ['ones', [1, 1, 1, 4, 5]], ['twos', [2, 2, 3, 4, 5]], ['threes', [3, 3, 3, 3, 5]],
    ['fours', [4, 1, 2, 3, 5]], ['fives', [5, 5, 5, 5, 5]], ['sixes', [6, 1, 1, 1, 1]],
    ['threeKind', [2, 2, 2, 3, 4]], ['fourKind', [6, 6, 6, 6, 3]], ['fullHouse', [1, 1, 4, 4, 4]],
    ['smallStraight', [4, 5, 6, 3, 3]], ['largeStraight', [2, 3, 4, 5, 6]], ['yahtzee', [3, 3, 3, 3, 3]],
    ['chance', [1, 3, 3, 5, 6]],
  ];
  for (const [id, dice] of cases) {
    ok(turnSeat(h) === 1, `it's Alex's turn before scoring ${id}`);
    await send(h, A, { type: 'roll' });
    setDice(h, dice);
    await send(h, A, { type: 'score', id });
    const expected = scoreCategory(id, dice);
    ok(meOf(h, 1).categories[id] === expected, `server score for ${id} matches the pure function (${expected})`);
    // Maisie takes a filler turn (scratching whatever's first free) so it's Alex's turn again next iteration.
    await send(h, M, { type: 'roll' });
    const mCat = CATEGORY_IDS.find((c) => meOf(h, 2).categories[c] == null);
    await send(h, M, { type: 'score', id: mCat });
  }
}

// Upper bonus, forced directly (no need to play it out one category at a time).
{
  const h = await newTable('TEST03');
  const A = await join(h, 'alex-000003', 'Alex');
  await join(h, 'maisie-000003', 'Maisie');
  await send(h, A, { type: 'start' });
  const me = meOf(h, 1);
  Object.assign(me.categories, { ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18 });
  ok(upperTotal(me.categories) === 63, 'forced upper categories sum to 63');
  // The view() the server actually sends is what the client trusts - check that, not just the raw scoring.js math.
  const ws2 = new FakeSocket();
  h.instance.acceptSocket(ws2);
  await h.instance.webSocketMessage(ws2, JSON.stringify({ type: 'hello', playerId: 'alex-000003', name: 'Alex' }));
  const st = ws2.lastState();
  const meView = st.players.find((p) => p.seat === 1);
  ok(meView.upperTotal === 63 && meView.bonus === UPPER_BONUS, "the broadcast state includes the player's own upper total and bonus");
}

// Full game to completion + winner (2 players, everyone scratches into
// "chance" every turn so the totals are simply whatever chance sums to).
{
  const h = await newTable('TEST04');
  const A = await join(h, 'alex-000004', 'Alex');
  const M = await join(h, 'maisie-000004', 'Maisie');
  await send(h, A, { type: 'start' });
  let guard = 0;
  while (room(h).status === 'playing' && guard++ < 500) {
    const seat = turnSeat(h);
    const ws = seat === 1 ? A : M;
    const me = meOf(h, seat);
    await send(h, ws, { type: 'roll' });
    const cat = CATEGORY_IDS.find((c) => me.categories[c] == null);
    await send(h, ws, { type: 'score', id: cat });
  }
  ok(room(h).status === 'finished', `game reaches 'finished' after ${TOTAL_TURNS * 2} turns (guard=${guard})`);
  ok(isComplete(meOf(h, 1).categories) && isComplete(meOf(h, 2).categories), 'every player filled all 13 categories');
  const t1 = grandTotal(meOf(h, 1).categories), t2 = grandTotal(meOf(h, 2).categories);
  const expectedWinners = t1 === t2 ? [1, 2] : t1 > t2 ? [1] : [2];
  ok(JSON.stringify(room(h).winnerSeats.slice().sort()) === JSON.stringify(expectedWinners.sort()), `winnerSeats matches the higher total (${t1} vs ${t2})`);

  await send(h, A, { type: 'again' });
  ok(room(h).status === 'playing' && room(h).turnsTaken === 0, "'again' starts a fresh round with the same players");
  ok(!isComplete(meOf(h, 1).categories), "'again' clears every scorecard");

  await send(h, A, { type: 'roll' }); // make sure mid-game state doesn't leak into 'lobby'
  await send(h, A, { type: 'lobby' });
  ok(room(h).status === 'playing', "'lobby' is ignored unless the game has finished");
}

// Leaving mid-game: turn order and current-turn handling.
{
  const h = await newTable('TEST05');
  const A = await join(h, 'alex-000005', 'Alex');
  const M = await join(h, 'maisie-000005', 'Maisie');
  const J = await join(h, 'jordan-000005', 'Jordan');
  await send(h, A, { type: 'start' });
  ok(room(h).turnOrder.length === 3, 'three players start with a 3-long turn order');
  // Force it to be Maisie's turn (seat 2), then have her leave.
  room(h).turnIdx = room(h).turnOrder.indexOf(2);
  await send(h, M, { type: 'leave' });
  ok(room(h).turnOrder.length === 2 && !room(h).turnOrder.includes(2), 'the departed seat is removed from turn order');
  ok(room(h).rollsUsed === 0, "leaving mid-turn resets the in-progress roll for whoever's turn it was");
  ok(turnSeat(h) === 3 || turnSeat(h) === 1, 'turn moves on to someone still in the game');

  await send(h, A, { type: 'leave' });
  await send(h, J, { type: 'leave' });
  ok(room(h).status === 'lobby' && room(h).players.length === 0, 'the room returns to an empty lobby once everyone leaves');
}

// Kicking (host, lobby-only) and reconnection.
{
  const h = await newTable('TEST06');
  const A = await join(h, 'alex-000006', 'Alex');
  const M = await join(h, 'maisie-000006', 'Maisie');
  await send(h, M, { type: 'kick', seat: 1 });
  ok(room(h).players.length === 2, 'a non-host cannot kick anyone');
  await send(h, A, { type: 'kick', seat: 2 });
  ok(room(h).players.length === 1, 'the host can kick a player from the lobby');

  const M2 = await join(h, 'maisie-000006-b', 'Maisie');
  ok(room(h).players.length === 2 && room(h).players[1].id === 'maisie-000006-b', "rejoining with a fresh token creates a new player (the kicked one is really gone)");

  // Disconnect + reconnect by name reclaims the same seat/scorecard.
  A.readyState = 3; // simulate a dropped socket
  const A2 = await join(h, 'alex-000006-new-token', 'Alex');
  ok(room(h).players.length === 2 && room(h).players[0].id === 'alex-000006-new-token', 'reconnecting with the same name reclaims the disconnected seat');
}

// A brand-new player can't join once the game has started; MAX_PLAYERS caps the lobby.
{
  const h = await newTable('TEST07');
  const A = await join(h, 'alex-000007', 'Alex');
  await join(h, 'maisie-000007', 'Maisie');
  await send(h, A, { type: 'start' });
  const late = new FakeSocket();
  h.instance.acceptSocket(late);
  await h.instance.webSocketMessage(late, JSON.stringify({ type: 'hello', playerId: 'late-0000007', name: 'Late' }));
  const err = JSON.parse(late.sent.find((s) => JSON.parse(s).type === 'error'));
  ok(err.code === 'started', "a brand-new player is rejected with 'started' once the game is under way");
}
{
  const h = await newTable('TEST08');
  for (let i = 0; i < MAX_PLAYERS; i++) await join(h, 'p' + i + '-00000008', 'P' + i);
  ok(room(h).players.length === MAX_PLAYERS, `room fills up to MAX_PLAYERS (${MAX_PLAYERS})`);
  const over = new FakeSocket();
  h.instance.acceptSocket(over);
  await h.instance.webSocketMessage(over, JSON.stringify({ type: 'hello', playerId: 'over-00000008', name: 'Over' }));
  const err = JSON.parse(over.sent.find((s) => JSON.parse(s).type === 'error'));
  ok(err.code === 'full', "a full room rejects a new player with 'full'");
}

// Colors: distinct by default, an explicitly requested color is honored
// unless it's already taken.
{
  const h = await newTable('TEST09');
  await join(h, 'p1-0000009', 'P1');
  await join(h, 'p2-0000009', 'P2');
  const colors = room(h).players.map((p) => p.color);
  ok(new Set(colors).size === 2, 'two players get two distinct default colors');
  const ws3 = new FakeSocket();
  h.instance.acceptSocket(ws3);
  await h.instance.webSocketMessage(ws3, JSON.stringify({ type: 'hello', playerId: 'p3-0000009', name: 'P3', color: colors[0] }));
  ok(room(h).players[2].color !== colors[0], 'requesting an already-taken color falls back to a free one');
  const ws4 = new FakeSocket();
  h.instance.acceptSocket(ws4);
  const freeColor = PLAYER_COLORS.find((c) => !room(h).players.some((p) => p.color === c));
  await h.instance.webSocketMessage(ws4, JSON.stringify({ type: 'hello', playerId: 'p4-0000009', name: 'P4', color: freeColor }));
  ok(room(h).players[3].color === freeColor, 'requesting a free color is honored');
}

// ── Part 3: real wire protocol (spawned server, real WebSockets) ────

const srv = spawn('node', [path.join(ROOT, 'dev/local-server.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => srv.stdout.once('data', r));
const base = `http://localhost:${PORT}`;

class Client {
  constructor(code, pid, name) { Object.assign(this, { code, pid, name, msgs: [], raw: [] }); }
  open() {
    return new Promise((res) => {
      this.ws = new WebSocket(`ws://localhost:${PORT}/api/rooms/${this.code}/ws`);
      this.ws.onopen = () => { this.ws.send(JSON.stringify({ type: 'hello', playerId: this.pid, name: this.name })); res(); };
      this.ws.onmessage = (e) => { this.raw.push(e.data); try { const m = JSON.parse(e.data); this.msgs.push(m); if (m.type === 'state') this.st = m; } catch {} };
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  close() { this.ws.close(); }
  of(type) { return this.msgs.filter((m) => m.type === type); }
}

const { code } = await (await fetch(base + '/api/rooms', { method: 'POST' })).json();
ok(/^[A-Z]{3,5}[2-9]$/.test(code), 'room code format ' + code);
ok((await (await fetch(base + '/api/rooms/NOPE9')).json()).exists === false, 'unknown room');

const A = new Client(code, 'alex-00000001', 'Alex');
const M = new Client(code, 'maisie-00000001', 'Maisie');
await A.open(); await sleep(80);
await M.open(); await sleep(120);
ok(A.st.players.length === 2 && M.st.players.length === 2, 'both joined over real sockets');
ok(!JSON.stringify(A.st).includes('maisie-00000001'), 'player tokens are private');

M.send({ type: 'start' }); await sleep(80);
ok(A.st.status === 'lobby', 'a non-host cannot start the game');
A.send({ type: 'start' }); await sleep(80);
ok(A.st.status === 'playing', 'the host starting moves the room to playing');

// Play a full adaptive game over the real wire - dice are genuinely random
// here, so just always score into the first unfilled category.
let guard2 = 0;
while (A.st.status === 'playing' && guard2++ < 400) {
  const seat = A.st.turnSeat;
  const actor = seat === A.st.you ? A : M;
  actor.send({ type: 'roll' }); await sleep(20);
  const me = actor.st.players.find((p) => p.seat === seat);
  const cat = CATEGORY_IDS.find((c) => me.categories[c] == null);
  actor.send({ type: 'score', id: cat }); await sleep(20);
}
ok(A.st.status === 'finished', `a full adaptive game reaches 'finished' over real sockets (guard=${guard2})`);
ok(Array.isArray(A.st.winnerSeats) && A.st.winnerSeats.length >= 1, 'a winner (or tie) is declared');
ok(M.st.status === 'finished', 'both clients agree the game is finished');

// Reconnection: reopen with the same token mid-lobby-after-again.
A.send({ type: 'again' }); await sleep(80);
ok(A.st.status === 'playing' && A.st.round === 1, "'again' starts a fresh round");
M.close(); await sleep(150);
ok(A.st.players.find((p) => p.name === 'Maisie').connected === false, 'disconnect noticed by the other client');
const M2 = new Client(code, 'maisie-00000001', 'Maisie');
await M2.open(); await sleep(120);
ok(M2.st.players.length === 2, 'no duplicate player on reconnect');
ok(A.st.players.find((p) => p.name === 'Maisie').connected === true, 'the other client sees them come back');

A.close(); M2.close();
srv.kill();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
