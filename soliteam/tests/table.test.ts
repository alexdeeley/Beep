import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Table, RESET_STAGES, HOUSEKEEPING_AFTER_MS } from '../server/table.ts';
import type { Client, Conn, Saved } from '../server/table.ts';
import { deal, legalMoves, mulberry32 } from '../shared/solitaire.ts';
import type { State } from '../shared/solitaire.ts';

class FakeConn implements Conn {
  sent: any[] = [];
  closed: { code?: number } | null = null;
  send(d: string) { this.sent.push(JSON.parse(d)); }
  close(code?: number) { this.closed = { code }; }
  of(t: string) { return this.sent.filter((m) => m.t === t); }
  last(t: string) { return this.of(t).at(-1); }
  events() { return this.of('event').map((e) => e.text); }
}

// An in-memory "storage" so we can see what gets saved and reload from it.
function store(initial: Saved | null = null) {
  const box = { saved: initial, writes: 0 };
  return { box, load: async () => box.saved, save: async (s: Saved) => { box.saved = s; box.writes++; } };
}

async function makeTable(opts: { saved?: Saved | null; seed?: number; clock?: { t: number } } = {}) {
  const clock = opts.clock ?? { t: 1_700_000_000_000 };
  const st = store(opts.saved ?? null);
  const table = new Table({ ...st, now: () => clock.t, random: mulberry32(opts.seed ?? 1), timescale: 1000 });
  await table.whenReady();
  return { table, clock, box: st.box };
}
async function join(table: Table) {
  const conn = new FakeConn();
  const client = await table.attach(conn);
  return { conn, client };
}
const say = (table: Table, c: Client, m: object) => table.receive(c, JSON.stringify(m));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('a fresh table deals game 1 and saves it; the first visitor gets the whole table', async () => {
  const { table, box } = await makeTable();
  assert.equal(table.game, 1);
  assert.equal(box.writes, 1, 'the deal was saved');
  const a = await join(table);
  const s = a.conn.last('state');
  assert.equal(s.game, 1); assert.equal(s.moves, 0); assert.equal(s.players, 1); assert.equal(s.resetting, false);
  assert.equal(s.state.stock.length, 24);
  table.dispose();
});

test('a saved table is picked up where it was left, counters and all', async () => {
  const state = deal(mulberry32(42));
  const { table } = await makeTable({ saved: { state, game: 8_492_103, moves: 4_823_019, seq: 77, startedAt: 0, lastMoveAt: 0 } });
  const a = await join(table);
  const s = a.conn.last('state');
  assert.equal(s.game, 8_492_103); assert.equal(s.moves, 4_823_019); assert.equal(s.seq, 77);
  assert.deepEqual(s.state, state);
  table.dispose();
});

test('a legal move changes the table for everyone; the mover is told it was theirs', async () => {
  const { table, box } = await makeTable();
  const a = await join(table), b = await join(table);
  await say(table, a.client, { t: 'draw' });
  const sa = a.conn.last('state'), sb = b.conn.last('state');
  assert.equal(sa.state.waste.length, 1); assert.deepEqual(sa.state, sb.state);
  assert.equal(sa.moves, 1); assert.equal(sa.seq, 1);
  assert.equal(a.conn.last('moved').mine, true);
  assert.equal(b.conn.last('moved').mine, false);
  assert.ok(b.conn.events().includes('SOMEONE DREW FROM THE STOCK.'), 'the other person is told');
  assert.ok(!a.conn.events().includes('SOMEONE DREW FROM THE STOCK.'), 'the mover is not told about themselves');
  await table.flush();
  assert.equal(box.saved!.moves, 1, 'saved');
  table.dispose();
});

test('an illegal move is ignored, the table is unchanged, and the sender is re-sent the truth', async () => {
  const { table } = await makeTable();
  const a = await join(table), b = await join(table);
  const before = JSON.stringify(a.conn.last('state').state);
  const nb = b.conn.sent.length;
  await say(table, a.client, { t: 'move', from: { p: 'w' }, n: 1, to: { p: 't', i: 0 } });      // empty waste
  await say(table, a.client, { t: 'move', from: { p: 't', i: 0 }, n: 1, to: { p: 't', i: 0 } });
  await say(table, a.client, { t: 'move', from: { p: 't', i: 9 }, n: 1, to: { p: 't', i: 0 } });
  await table.receive(a.client, 'garbage'); await say(table, a.client, { t: 'move' });
  assert.equal(JSON.stringify(a.conn.last('state').state), before);
  assert.equal(table.moves, 0);
  assert.equal(b.conn.sent.length, nb, 'nobody else heard a thing');
  table.dispose();
});

test('two people grab the same card: the first wins, the second is checked against the new table', async () => {
  const { table } = await makeTable({ seed: 4 });
  const a = await join(table), b = await join(table);
  // find a tableau-to-tableau move in the deal
  const m = legalMoves(table.state).find((x) => x.t === 'move' && x.from.p === 't' && x.to.p === 't')!;
  assert.ok(m, 'this seed has a column move');
  await Promise.all([say(table, a.client, m), say(table, b.client, m)]);
  assert.equal(table.moves, 1, 'applied exactly once');
  assert.equal(a.conn.of('moved').length + b.conn.of('moved').length, 2, 'one move, told to both');
  table.dispose();
});

test('people are counted, and told when someone arrives or leaves', async () => {
  const { table } = await makeTable();
  const a = await join(table);
  assert.equal(a.conn.last('players').n, 1);
  const b = await join(table);
  assert.equal(a.conn.last('players').n, 2); assert.equal(b.conn.last('players').n, 2);
  assert.ok(a.conn.events().includes('SOMEONE HAS ARRIVED.'));
  table.detach(b.client);
  assert.equal(a.conn.last('players').n, 1);
  assert.ok(a.conn.events().includes('SOMEONE HAS LEFT. THE GAME CONTINUES.'));
  table.dispose();
});

test('a flood of messages is cut off', async () => {
  const { table } = await makeTable();
  const a = await join(table);
  for (let i = 0; i < 150; i++) await say(table, a.client, { t: 'ping', c: i });
  assert.ok(a.conn.of('pong').length <= 21, 'rate limited');
  assert.equal(a.conn.closed?.code, 4429);
  table.dispose();
});

// A table that is one move from stuck: black 8 alone, nothing fits anything, stock useless.
function nearlyStuck(): State {
  const C = (r: number) => r - 1, S = (r: number) => 39 + r - 1, H = (r: number) => 26 + r - 1, D = (r: number) => 13 + r - 1;
  return {
    stock: [C(3), S(5)], waste: [H(11)],
    found: [[], [], [], []],
    tab: [{ down: [D(9)], up: [S(8)] }, { down: [], up: [C(10)] }, { down: [], up: [] }, { down: [], up: [] }, { down: [], up: [] }, { down: [], up: [] }, { down: [], up: [] }],
    passes: 0,
  };
}

test('when the last productive move is made and nothing is left, the game resets itself, stage by stage, and the game number goes up', async () => {
  const saved: Saved = { state: nearlyStuck(), game: 5, moves: 100, seq: 9, startedAt: 0, lastMoveAt: 0 };
  const { table } = await makeTable({ saved });
  const a = await join(table), b = await join(table);
  // the only progress: 8♠ onto nothing? No - 8♠ moves nowhere. Draw is legal but not progress... actually this table is already stuck;
  // tick() notices on its own.
  table.tick();
  assert.equal(table.isResetting, true);
  assert.equal(a.conn.last('reset').stage, 'over');
  await sleep(RESET_STAGES.reduce((n, [, ms]) => n + ms, 0) / 1000 + 60);
  const stages = a.conn.of('reset').map((r) => r.stage);
  assert.deepEqual(stages, ['over', 'nomoves', 'will', 'shuffle', 'begin']);
  assert.equal(table.isResetting, false);
  assert.equal(table.game, 6, 'game number went up');
  assert.equal(table.moves, 100, 'the move total is kept across resets');
  const s = b.conn.last('state');
  assert.equal(s.game, 6); assert.equal(s.state.stock.length, 24); assert.equal(s.resetting, false);
  table.dispose();
});

test('moves are refused while the game is resetting', async () => {
  const { table } = await makeTable({ saved: { state: nearlyStuck(), game: 1, moves: 0, seq: 0, startedAt: 0, lastMoveAt: 0 } });
  const a = await join(table);
  table.tick();
  await say(table, a.client, { t: 'draw' });
  assert.ok(a.conn.events().includes('PLEASE WAIT. THE GAME IS RESETTING.'));
  assert.equal(table.moves, 0);
  table.dispose();
});

test('winning resets too, with won = true', async () => {
  const C = (r: number) => r - 1, D = (r: number) => 13 + r - 1, H = (r: number) => 26 + r - 1, S = (r: number) => 39 + r - 1;
  const full = (f: (r: number) => number, n: number) => Array.from({ length: n }, (_, i) => f(i + 1));
  const state: State = { stock: [], waste: [S(13)], found: [full(C, 13), full(D, 13), full(H, 13), full(S, 12)], tab: Array.from({ length: 7 }, () => ({ down: [], up: [] })), passes: 0 };
  const { table } = await makeTable({ saved: { state, game: 3, moves: 0, seq: 0, startedAt: 0, lastMoveAt: 0 } });
  const a = await join(table);
  await say(table, a.client, { t: 'move', from: { p: 'w' }, n: 1, to: { p: 'f', i: 3 } });
  assert.ok(a.conn.events().some((e) => e.includes('COMPLETED THE SPADES')));
  assert.equal(a.conn.last('reset').won, true);
  assert.equal(table.isResetting, true);
  table.dispose();
});

test('housekeeping: after a long silence the system puts ONE obvious card home, and says so', async () => {
  const C = (r: number) => r - 1;
  const state = deal(mulberry32(9));
  // put an ace on top of column 0 so there is something obvious to do
  state.tab[0].up = [C(1)];
  const clock = { t: 1_700_000_000_000 };
  const { table } = await makeTable({ saved: { state, game: 1, moves: 0, seq: 0, startedAt: clock.t, lastMoveAt: clock.t }, clock });
  const a = await join(table);
  table.tick();
  assert.equal(table.moves, 0, 'not yet');
  clock.t += HOUSEKEEPING_AFTER_MS + 1000;
  table.tick();
  assert.equal(table.moves, 1);
  assert.deepEqual(table.state.found[0], [C(1)]);
  assert.ok(a.conn.events().some((e) => e.startsWith('NOBODY WAS LOOKING.')));
  clock.t += 1000; table.tick();
  assert.equal(table.moves, 1, 'only one card, and not again for a long while');
  table.dispose();
});

test('a counter offset is only ever added to what people see, never stored', async () => {
  const st = store(null);
  const table = new Table({ ...st, now: () => 0, random: mulberry32(1), gameOffset: 8_000_000, moveOffset: 4_000_000 });
  await table.whenReady();
  const a = await join(table);
  assert.equal(a.conn.last('state').game, 8_000_001);
  await say(table, a.client, { t: 'draw' });
  assert.equal(a.conn.last('state').moves, 4_000_001);
  await table.flush();
  assert.equal(st.box.saved!.game, 1); assert.equal(st.box.saved!.moves, 1);
  table.dispose();
});
