// What the browsers and the table say to each other. Browsers only ever
// ask for a move; the table decides.

import type { Move, Place, State } from './solitaire.ts';

export type ClientMsg =
  | { t: 'hello' }
  | Move                                    // { t: 'draw' } or { t: 'move', from, n, to }
  | { t: 'ping'; c: number };

export type ResetStage = 'over' | 'nomoves' | 'will' | 'shuffle' | 'begin';

export interface Snapshot {
  state: State;
  game: number;          // which game this is, since the beginning of SOLITEAM
  moves: number;         // every move ever made, across every game
  seq: number;           // goes up by one per change; clients ignore anything older than what they have
  players: number;       // people connected right now
  resetting: boolean;
}

export type ServerMsg =
  | ({ t: 'state' } & Snapshot)                                                                  // the whole table: on arrival, and after every change
  | { t: 'moved'; seq: number; mine: boolean; cards: number[]; move: Move; flipped: number | null }   // what just happened, so it can be animated
  | { t: 'event'; text: string; kind: 'move' | 'note' | 'deadpan' | 'presence' }
  | { t: 'players'; n: number }
  | { t: 'reset'; stage: ResetStage; game: number; won: boolean }
  | { t: 'pong'; c: number }
  | { t: 'err'; say: string };

export const MAX_MESSAGE_BYTES = 512;
export const MAX_MESSAGES_PER_SECOND = 20;

const isInt = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;

function place(v: any): Place | null {
  if (!v || typeof v !== 'object') return null;
  if (v.p === 'w') return { p: 'w' };
  if (v.p === 'f' && isInt(v.i, 0, 3)) return { p: 'f', i: v.i };
  if (v.p === 't' && isInt(v.i, 0, 6)) return { p: 't', i: v.i };
  return null;
}

// Anything that is not exactly a well-formed message becomes null.
export function parseClient(raw: unknown): ClientMsg | null {
  if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_BYTES) return null;
  let m: any;
  try { m = JSON.parse(raw); } catch { return null; }
  if (!m || typeof m !== 'object') return null;
  switch (m.t) {
    case 'hello': return { t: 'hello' };
    case 'ping': return Number.isFinite(m.c) ? { t: 'ping', c: m.c } : null;
    case 'draw': return { t: 'draw' };
    case 'move': {
      const from = place(m.from), to = place(m.to);
      if (!from || !to || !isInt(m.n, 1, 13)) return null;
      return { t: 'move', from, n: m.n, to };
    }
    default: return null;
  }
}
