// SOLITEAM - the rules of Klondike, as a pure, deterministic module.
//
// The server runs this to decide what is legal, the tests run it to check
// that, and the browser runs it only to show you where a card could go.
// Nothing in here touches a clock, the network or the page.
//
// Cards are numbers 0..51:  suit = card / 13  (0 ♣  1 ♦  2 ♥  3 ♠)
//                           rank = card % 13 + 1  (1 = ace ... 13 = king)
// Draw one at a time, unlimited passes through the stock - the kind of
// Solitaire that strangers can reasonably finish together.

export type Card = number;
export const SUITS = ['♣', '♦', '♥', '♠'] as const;
export const SUIT_NAMES = ['clubs', 'diamonds', 'hearts', 'spades'] as const;
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
export const RANK_NAMES = ['ace', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'jack', 'queen', 'king'] as const;

export const suitOf = (c: Card): number => Math.floor(c / 13);
export const rankOf = (c: Card): number => (c % 13) + 1;
export const isRed = (c: Card): boolean => suitOf(c) === 1 || suitOf(c) === 2;
export const cardName = (c: Card): string => `${RANK_NAMES[rankOf(c) - 1]} of ${SUIT_NAMES[suitOf(c)]}`;
export const cardText = (c: Card): string => `${RANKS[rankOf(c) - 1]}${SUITS[suitOf(c)]}`;

export interface Column { down: Card[]; up: Card[] }          // up: deepest first, top of the column last
export interface State {
  stock: Card[];                   // face down; the last one is the next to draw
  waste: Card[];                   // face up; the last one is the one you can play
  found: [Card[], Card[], Card[], Card[]];   // by suit
  tab: Column[];                   // seven columns
  passes: number;                  // how many times the stock has been turned over
}

export type Place = { p: 'w' } | { p: 'f'; i: number } | { p: 't'; i: number };
export type Move =
  | { t: 'draw' }                                  // turn one card from the stock (or turn the waste back over)
  | { t: 'move'; from: Place; n: number; to: Place };   // n: how many cards from the top of `from` (1 unless from a column)

// ── Dealing ──────────────────────────────────────────────────

export function deal(random: () => number): State {
  const deck: Card[] = [];
  for (let c = 0; c < 52; c++) deck.push(c);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const tab: Column[] = [];
  for (let col = 0; col < 7; col++) {
    const down: Card[] = [];
    for (let k = 0; k < col; k++) down.push(deck.pop()!);
    tab.push({ down, up: [deck.pop()!] });
  }
  return { stock: deck, waste: [], found: [[], [], [], []], tab, passes: 0 };
}

export function clone(s: State): State {
  return {
    stock: [...s.stock], waste: [...s.waste],
    found: [[...s.found[0]], [...s.found[1]], [...s.found[2]], [...s.found[3]]],
    tab: s.tab.map((c) => ({ down: [...c.down], up: [...c.up] })),
    passes: s.passes,
  };
}

// ── Looking ──────────────────────────────────────────────────

export const isWon = (s: State): boolean => s.found.every((f) => f.length === 13);
export const topOf = (pile: Card[]): Card | undefined => pile[pile.length - 1];

// Can `card` sit on top of column `col`?
function fitsColumn(card: Card, col: Column): boolean {
  const top = topOf(col.up);
  if (top === undefined) return col.down.length === 0 && rankOf(card) === 13;
  return rankOf(top) === rankOf(card) + 1 && isRed(top) !== isRed(card);
}
function fitsFoundation(card: Card, found: Card[]): boolean {
  return found.length === rankOf(card) - 1 && (found.length === 0 || suitOf(found[0]) === suitOf(card));
}

// The cards a move would pick up, or null if there is nothing there.
function pickUp(s: State, from: Place, n: number): Card[] | null {
  if (n < 1) return null;
  if (from.p === 'w') return n === 1 && s.waste.length ? [s.waste[s.waste.length - 1]] : null;
  if (from.p === 'f') { const f = s.found[from.i]; return f && n === 1 && f.length ? [f[f.length - 1]] : null; }
  const col = s.tab[from.i];
  if (!col || n > col.up.length) return null;
  return col.up.slice(col.up.length - n);
}

export function isLegal(s: State, m: Move): boolean {
  if (m.t === 'draw') return s.stock.length > 0 || s.waste.length > 0;
  const { from, to, n } = m;
  if (!Number.isInteger(n)) return false;
  const run = pickUp(s, from, n);
  if (!run) return false;
  if (to.p === 'w') return false;
  if (to.p === 'f') {
    if (n !== 1 || from.p === 'f') return false;
    const f = s.found[to.i];
    return !!f && suitOf(run[0]) === to.i && fitsFoundation(run[0], f);
  }
  const col = s.tab[to.i];
  if (!col) return false;
  if (from.p === 't' && from.i === to.i) return false;
  return fitsColumn(run[0], col);
}

// Apply a legal move. Returns the new state and what happened, for the
// activity feed; returns null if the move is not legal.
export interface Applied { state: State; moved: Card[]; flipped: Card | null; completedSuit: number | null; toFoundation: boolean }
export function apply(s: State, m: Move): Applied | null {
  if (!isLegal(s, m)) return null;
  const next = clone(s);
  if (m.t === 'draw') {
    let moved: Card[] = [];
    if (next.stock.length) { const c = next.stock.pop()!; next.waste.push(c); moved = [c]; }
    else { next.stock = next.waste.reverse(); next.waste = []; next.passes++; }
    return { state: next, moved, flipped: null, completedSuit: null, toFoundation: false };
  }
  let run: Card[];
  let flipped: Card | null = null;
  if (m.from.p === 'w') run = [next.waste.pop()!];
  else if (m.from.p === 'f') run = [next.found[m.from.i].pop()!];
  else {
    const col = next.tab[m.from.i];
    run = col.up.splice(col.up.length - m.n, m.n);
    if (col.up.length === 0 && col.down.length) { flipped = col.down.pop()!; col.up.push(flipped); }
  }
  let completedSuit: number | null = null;
  if (m.to.p === 'f') {
    next.found[m.to.i].push(run[0]);
    if (next.found[m.to.i].length === 13) completedSuit = m.to.i;
  } else if (m.to.p === 't') {
    next.tab[m.to.i].up.push(...run);
  }
  return { state: next, moved: run, flipped, completedSuit, toFoundation: m.to.p === 'f' };
}

// ── Is there any point carrying on? ──────────────────────────
//
// A game is stuck when nobody could make progress, however they turned the
// stock. "Progress" is a move that provably gets somewhere:
//   - any card onto a foundation
//   - any stock/waste card onto a column
//   - a whole column onto another, when that uncovers a face-down card or
//     empties the column for something better than a king already at its base
//   - part of a column onto another, when the card that uncovers can then
//     take a stock/waste card or go to a foundation
// Shuffling kings between empty columns, or moving a run back and forth,
// is not progress. With draw-one and unlimited passes every stock and waste
// card is reachable, so they are all treated as available.

export function productiveMoves(s: State): Move[] {
  const out: Move[] = [];
  const reachable = [...s.stock, ...s.waste];

  // to a foundation
  for (let i = 0; i < 7; i++) {
    const top = topOf(s.tab[i].up);
    if (top !== undefined && fitsFoundation(top, s.found[suitOf(top)])) out.push({ t: 'move', from: { p: 't', i }, n: 1, to: { p: 'f', i: suitOf(top) } });
  }
  for (const c of reachable) if (fitsFoundation(c, s.found[suitOf(c)])) out.push({ t: 'move', from: { p: 'w' }, n: 1, to: { p: 'f', i: suitOf(c) } });

  // stock/waste onto a column
  for (const c of reachable) for (let j = 0; j < 7; j++) if (fitsColumn(c, s.tab[j])) out.push({ t: 'move', from: { p: 'w' }, n: 1, to: { p: 't', i: j } });

  // column to column
  for (let i = 0; i < 7; i++) {
    const col = s.tab[i];
    for (let idx = 0; idx < col.up.length; idx++) {
      const n = col.up.length - idx;
      const bottom = col.up[idx];
      for (let j = 0; j < 7; j++) {
        if (j === i || !fitsColumn(bottom, s.tab[j])) continue;
        if (idx === 0) {
          if (col.down.length > 0 || rankOf(bottom) !== 13) out.push({ t: 'move', from: { p: 't', i }, n, to: { p: 't', i: j } });
          continue;
        }
        // a partial move: worth it only if what it uncovers is then useful
        const uncovered = col.up[idx - 1];
        const after: Column = { down: col.down, up: col.up.slice(0, idx) };
        const useful = fitsFoundation(uncovered, s.found[suitOf(uncovered)]) || reachable.some((c) => fitsColumn(c, after));
        if (useful) out.push({ t: 'move', from: { p: 't', i }, n, to: { p: 't', i: j } });
      }
    }
  }
  return out;
}

export const isStuck = (s: State): boolean => !isWon(s) && productiveMoves(s).length === 0;

// Every legal move from here, for the browser's hints and the tests.
export function legalMoves(s: State): Move[] {
  const out: Move[] = [];
  if (isLegal(s, { t: 'draw' })) out.push({ t: 'draw' });
  const froms: { from: Place; n: number }[] = [];
  if (s.waste.length) froms.push({ from: { p: 'w' }, n: 1 });
  for (let i = 0; i < 4; i++) if (s.found[i].length) froms.push({ from: { p: 'f', i }, n: 1 });
  for (let i = 0; i < 7; i++) for (let n = 1; n <= s.tab[i].up.length; n++) froms.push({ from: { p: 't', i }, n });
  for (const { from, n } of froms) {
    for (let i = 0; i < 4; i++) { const m: Move = { t: 'move', from, n, to: { p: 'f', i } }; if (isLegal(s, m)) out.push(m); }
    for (let i = 0; i < 7; i++) { const m: Move = { t: 'move', from, n, to: { p: 't', i } }; if (isLegal(s, m)) out.push(m); }
  }
  return out;
}

// Small, deterministic random for tests.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
