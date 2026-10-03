import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, cardName, cardText, clone, deal, isLegal, isStuck, isWon, legalMoves, mulberry32, productiveMoves, rankOf, suitOf } from '../shared/solitaire.ts';
import type { Move, Place, State } from '../shared/solitaire.ts';

// A hand-built table: C = clubs 0-12, D = diamonds 13-25, H = hearts 26-38, S = spades 39-51
const C = (r: number) => r - 1, D = (r: number) => 13 + r - 1, H = (r: number) => 26 + r - 1, S = (r: number) => 39 + r - 1;
function table(partial: Partial<State>): State {
  return {
    stock: [], waste: [], found: [[], [], [], []],
    tab: Array.from({ length: 7 }, () => ({ down: [], up: [] })),
    passes: 0, ...partial,
  };
}
const mv = (from: Place, n: number, to: Place): Move => ({ t: 'move', from, n, to });

test('cards: suit, rank, colour and names', () => {
  assert.equal(suitOf(0), 0); assert.equal(rankOf(0), 1); assert.equal(cardName(0), 'ace of clubs'); assert.equal(cardText(0), 'A♣');
  assert.equal(cardName(51), 'king of spades'); assert.equal(cardText(S(10)), '10♠'); assert.equal(cardText(H(12)), 'Q♥');
});

test('a deal is a real Klondike deal: 28 on the table, 24 in the stock, one face up per column', () => {
  const s = deal(mulberry32(1));
  assert.equal(s.stock.length, 24);
  assert.equal(s.waste.length, 0);
  s.tab.forEach((col, i) => { assert.equal(col.down.length, i); assert.equal(col.up.length, 1); });
  const all = [...s.stock, ...s.tab.flatMap((c) => [...c.down, ...c.up])].sort((a, b) => a - b);
  assert.deepEqual(all, Array.from({ length: 52 }, (_, i) => i), 'every card exactly once');
});

test('different seeds give different deals; the same seed gives the same deal', () => {
  assert.deepEqual(deal(mulberry32(7)), deal(mulberry32(7)));
  assert.notDeepEqual(deal(mulberry32(7)), deal(mulberry32(8)));
});

test('draw turns one card from the stock to the waste, then turns the waste back over', () => {
  let s = table({ stock: [C(5), D(9), S(2)] });
  s = apply(s, { t: 'draw' })!.state; assert.deepEqual(s.waste, [S(2)]);
  s = apply(s, { t: 'draw' })!.state; s = apply(s, { t: 'draw' })!.state;
  assert.deepEqual(s.waste, [S(2), D(9), C(5)]); assert.equal(s.stock.length, 0);
  s = apply(s, { t: 'draw' })!.state;
  assert.deepEqual(s.stock, [C(5), D(9), S(2)], 'same order as before'); assert.equal(s.waste.length, 0); assert.equal(s.passes, 1);
  assert.equal(isLegal(table({}), { t: 'draw' }), false, 'nothing to draw');
});

test('building down in alternating colours, and only kings into empty columns', () => {
  const s = table({ tab: [{ down: [], up: [S(8)] }, { down: [], up: [H(7)] }, { down: [], up: [C(7)] }, { down: [], up: [] }, { down: [], up: [D(13)] }, { down: [], up: [] }, { down: [], up: [] }] });
  assert.equal(isLegal(s, mv({ p: 't', i: 1 }, 1, { p: 't', i: 0 })), true, 'red 7 on black 8');
  assert.equal(isLegal(s, mv({ p: 't', i: 2 }, 1, { p: 't', i: 0 })), false, 'black 7 on black 8');
  assert.equal(isLegal(s, mv({ p: 't', i: 0 }, 1, { p: 't', i: 1 })), false, '8 on 7');
  assert.equal(isLegal(s, mv({ p: 't', i: 1 }, 1, { p: 't', i: 3 })), false, 'only a king into an empty column');
  assert.equal(isLegal(s, mv({ p: 't', i: 4 }, 1, { p: 't', i: 3 })), true, 'a king into an empty column');
  assert.equal(isLegal(s, mv({ p: 't', i: 0 }, 1, { p: 't', i: 0 })), false, 'not onto itself');
  assert.equal(isLegal(s, mv({ p: 't', i: 0 }, 2, { p: 't', i: 3 })), false, 'cannot pick up more than is there');
  assert.equal(isLegal(s, mv({ p: 't', i: 0 }, 0, { p: 't', i: 3 })), false);
});

test('a run moves together, and uncovers the card beneath it', () => {
  const s = table({ tab: [{ down: [D(2)], up: [S(9), H(8), C(7)] }, { down: [], up: [D(10)] }, { down: [], up: [] }, { down: [], up: [] }, { down: [], up: [] }, { down: [], up: [] }, { down: [], up: [] }] });
  const r = apply(s, mv({ p: 't', i: 0 }, 3, { p: 't', i: 1 }))!;
  assert.deepEqual(r.state.tab[1].up, [D(10), S(9), H(8), C(7)]);
  assert.deepEqual(r.state.tab[0].up, [D(2)], 'the face-down card turned over');
  assert.equal(r.state.tab[0].down.length, 0);
  assert.equal(r.flipped, D(2));
  assert.deepEqual(r.moved, [S(9), H(8), C(7)]);
  assert.equal(isLegal(s, mv({ p: 't', i: 0 }, 2, { p: 't', i: 1 })), false, 'a partial run must still fit');
});

test('foundations take aces up in suit, one card at a time, and give cards back', () => {
  let s = table({ waste: [H(1)], tab: [{ down: [], up: [H(2)] }, { down: [], up: [C(1)] }, { down: [], up: [H(3)] }, { down: [], up: [] }, { down: [], up: [] }, { down: [], up: [] }, { down: [], up: [] }] });
  assert.equal(isLegal(s, mv({ p: 'w' }, 1, { p: 'f', i: 2 })), true, 'ace of hearts to the hearts foundation');
  assert.equal(isLegal(s, mv({ p: 'w' }, 1, { p: 'f', i: 0 })), false, '...not the clubs foundation');
  assert.equal(isLegal(s, mv({ p: 't', i: 0 }, 1, { p: 'f', i: 2 })), false, 'two before the ace');
  s = apply(s, mv({ p: 'w' }, 1, { p: 'f', i: 2 }))!.state;
  s = apply(s, mv({ p: 't', i: 0 }, 1, { p: 'f', i: 2 }))!.state;
  assert.deepEqual(s.found[2], [H(1), H(2)]);
  assert.equal(isLegal(s, mv({ p: 't', i: 2 }, 1, { p: 'f', i: 2 })), true);
  assert.equal(isLegal(s, mv({ p: 'f', i: 2 }, 1, { p: 'f', i: 0 })), false, 'foundation to foundation is never allowed');
  assert.equal(isLegal(s, mv({ p: 'f', i: 2 }, 1, { p: 't', i: 1 })), false, 'red 2 cannot go on a black ace');
  s.tab[3].up = [S(3)];
  assert.equal(isLegal(s, mv({ p: 'f', i: 2 }, 1, { p: 't', i: 3 })), true, 'but a card can come back down onto the table');
});

test('the game is won when every foundation has thirteen cards', () => {
  const s = table({ found: [Array.from({ length: 13 }, (_, i) => C(i + 1)), Array.from({ length: 13 }, (_, i) => D(i + 1)), Array.from({ length: 13 }, (_, i) => H(i + 1)), Array.from({ length: 13 }, (_, i) => S(i + 1))] });
  assert.equal(isWon(s), true);
  assert.equal(isStuck(s), false, 'a won game is not stuck');
  const r = apply(table({ waste: [S(13)], found: [[], [], [], Array.from({ length: 12 }, (_, i) => S(i + 1))] }), mv({ p: 'w' }, 1, { p: 'f', i: 3 }))!;
  assert.equal(r.completedSuit, 3);
});

test('stuck: nothing anywhere can make progress', () => {
  // Black 8 on the table, red 8 and black 9 nowhere, stock full of cards that fit nothing
  const s = table({
    stock: [C(3), S(5), H(11)],
    tab: [{ down: [D(1)], up: [S(8)] }, { down: [], up: [C(10)] }, { down: [], up: [] }, { down: [], up: [] }, { down: [], up: [] }, { down: [], up: [] }, { down: [], up: [] }],
  });
  assert.deepEqual(productiveMoves(s), []);
  assert.equal(isStuck(s), true);
});

test('not stuck: a card in the stock can go home, even if it is at the bottom', () => {
  const s = table({ stock: [D(1), S(5), H(11)], tab: [{ down: [], up: [S(8)] }, { down: [], up: [C(10)] }, { down: [], up: [] }, { down: [], up: [] }, { down: [], up: [] }, { down: [], up: [] }, { down: [], up: [] }] });
  assert.equal(isStuck(s), false);
});

test('not stuck: a card in the stock fits a column', () => {
  const s = table({ stock: [H(7), S(5)], tab: [{ down: [], up: [S(8)] }, { down: [], up: [C(10)] }, { down: [], up: [] }, { down: [], up: [] }, { down: [], up: [] }, { down: [], up: [] }, { down: [], up: [] }] });
  assert.equal(isStuck(s), false);
});

test('a king alone in a column, with an empty column beside it, is NOT progress - but a king on a face-down card is', () => {
  const lonely = table({ tab: [{ down: [], up: [S(13)] }, { down: [], up: [] }, { down: [], up: [] }, { down: [], up: [] }, { down: [], up: [] }, { down: [], up: [] }, { down: [], up: [] }], stock: [C(5)] });
  assert.equal(isStuck(lonely), true, 'shuffling a king between empty columns is not progress');
  const covering = clone(lonely); covering.tab[0].down = [D(4)];
  assert.equal(isStuck(covering), false, 'moving it uncovers a card');
});

test('a whole column that is not a king can move to empty its column', () => {
  const s = table({ tab: [{ down: [], up: [H(7)] }, { down: [], up: [S(8)] }, { down: [], up: [] }, { down: [], up: [] }, { down: [], up: [] }, { down: [], up: [] }, { down: [], up: [] }], stock: [C(2)] });
  assert.equal(isStuck(s), false);
});

test('a partial run move counts only when what it uncovers is then useful', () => {
  // column 0: 9♠ 8♥ 7♣ ; column 1: 8♦ (so 7♣ could move onto it). Uncovering 8♥ is useful only if a black 7 is reachable or 8♥ can go home.
  const base = table({ tab: [{ down: [], up: [S(9), H(8), C(7)] }, { down: [], up: [D(8)] }, { down: [], up: [] }, { down: [], up: [] }, { down: [], up: [] }, { down: [], up: [] }, { down: [], up: [] }] });
  const pointless = clone(base); pointless.stock = [D(3)];
  assert.equal(isStuck(pointless), true, 'moving 7♣ across just to move it back is not progress');
  const useful = clone(base); useful.stock = [S(7)];
  assert.equal(isStuck(useful), false, 'moving 7♣ frees 8♥ for the 7♠ in the stock');
});

test('a freshly dealt game is never immediately stuck, over many deals', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const s = deal(mulberry32(seed));
    assert.ok(legalMoves(s).length > 0, `seed ${seed}: there is always at least a draw`);
  }
});

test('every move legalMoves lists is accepted, and apply refuses what is not listed', () => {
  const s = deal(mulberry32(3));
  for (const m of legalMoves(s)) assert.ok(apply(s, m), JSON.stringify(m));
  assert.equal(apply(s, mv({ p: 't', i: 0 }, 1, { p: 't', i: 0 })), null);
  assert.equal(apply(s, mv({ p: 'w' }, 1, { p: 't', i: 0 })), null, 'empty waste');
});

test('apply never changes the state it was given', () => {
  const s = deal(mulberry32(5));
  const before = JSON.stringify(s);
  for (const m of legalMoves(s)) apply(s, m);
  assert.equal(JSON.stringify(s), before);
});

test('a random walk of legal moves keeps every card exactly once and either ends won, stuck, or still going', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const rng = mulberry32(seed * 11);
    let s = deal(rng);
    for (let i = 0; i < 400 && !isWon(s) && !isStuck(s); i++) {
      const moves = legalMoves(s).filter((m) => m.t === 'draw' || m.from.p !== 'f');   // don't undo foundations
      const m = moves[Math.floor(rng() * moves.length)];
      s = apply(s, m)!.state;
      const all = [...s.stock, ...s.waste, ...s.found.flat(), ...s.tab.flatMap((c) => [...c.down, ...c.up])].sort((a, b) => a - b);
      assert.deepEqual(all, Array.from({ length: 52 }, (_, k) => k), `seed ${seed} step ${i}: a card went missing`);
      for (const col of s.tab) assert.ok(col.up.length > 0 || col.down.length === 0, 'a column never has face-down cards under nothing');
    }
  }
});
