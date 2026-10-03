// What the browser knows about the match, built from the server's snapshots.
//
// Snapshots arrive ~30 times a second, a little irregularly. To show smooth
// motion we draw the world slightly in the past (INTERP_MS) and blend between
// the two snapshots either side of that moment. Sounds and sparks fire when
// "render time" reaches the snapshot that carried them, so what you see and
// hear lines up.

import { placeBlock } from '../shared/levels.ts';
import type { GameEvent, Phase, PowerType } from '../shared/types.ts';
import type { LevelMessage, Snapshot } from '../shared/sim.ts';

export const INTERP_MS = 100;

export interface CBlock {
  c: number; r: number; type: string; hp: number; max: number; alive: boolean;
  amp: number; period: number; ph: number;
  x: number; y: number; w: number; h: number;
  flash: number;              // 0..1, a white flash after being hit
}

export interface Snap extends Snapshot { st: number }

export interface Interp {
  p: [number, number];
  pw: [number, number];
  balls: { id: number; x: number; y: number; vx: number; vy: number; attached: boolean }[];
  powerups: { id: number; x: number; y: number; type: PowerType }[];
  time: number;
}

export class World {
  rows = 4;
  blocks: CBlock[] = [];
  level = 1;
  blocksVersion = 0;                 // bumps whenever the static picture of the wall changes
  buffer: Snap[] = [];
  cur: Snap | null = null;           // the newest snapshot render time has reached
  latest: Snap | null = null;        // the newest one received (for things that should not lag)
  names: [string, string] = ['', ''];
  private pendingLevel: LevelMessage | null = null;

  pushLevel(m: LevelMessage): void {
    this.pendingLevel = m;
    // Apply straight away if nothing is in flight, otherwise with the next snapshot.
    if (this.buffer.length === 0) this.applyLevel();
  }

  private applyLevel(): void {
    const m = this.pendingLevel;
    if (!m) return;
    this.pendingLevel = null;
    this.level = m.level;
    this.rows = m.rows;
    this.blocks = m.blocks.map(([c, r, type, hp, max, alive, amp, period, ph]) => {
      const b: CBlock = { c, r, type, hp, max, alive: !!alive, amp, period, ph, x: 0, y: 0, w: 0, h: 0, flash: 0 };
      placeBlock(b as never, m.rows, 0);
      return b;
    });
    this.blocksVersion++;
  }

  push(s: Snap): void {
    this.latest = s;
    this.buffer.push(s);
    if (this.buffer.length > 90) this.buffer.splice(0, this.buffer.length - 90);
  }

  // Move render time forward to T (server milliseconds); returns the events that are now due.
  advance(T: number): GameEvent[] {
    const due: GameEvent[] = [];
    while (this.buffer.length && this.buffer[0].st <= T) {
      const s = this.buffer.shift()!;
      if (this.pendingLevel && s.lv === this.pendingLevel.level) this.applyLevel();
      for (const [i, hp] of s.bt) {
        const b = this.blocks[i];
        if (!b) continue;
        b.alive = hp > 0;
        b.hp = hp;
        this.blocksVersion++;
      }
      for (const e of s.ev) {
        if (e[0] === 'bh') { const b = this.blocks[e[1]]; if (b) b.flash = 1; }
        due.push(e);
      }
      this.cur = s;
    }
    if (!this.cur && this.pendingLevel) this.applyLevel();
    return due;
  }

  // Positions at render time T, blended between the snapshot we have reached and the next.
  interp(T: number): Interp | null {
    const a = this.cur;
    if (!a) return null;
    const b = this.buffer[0];
    const k = b && b.st > a.st ? Math.min(1, Math.max(0, (T - a.st) / (b.st - a.st))) : 0;
    const lerp = (x: number, y: number) => x + (y - x) * k;
    const out: Interp = {
      p: [lerp(a.p[0], b ? b.p[0] : a.p[0]), lerp(a.p[1], b ? b.p[1] : a.p[1])],
      pw: a.pw,
      balls: [],
      powerups: [],
      time: lerp(a.tm, b ? b.tm : a.tm),
    };
    for (const [id, x, y, vx, vy, att] of a.b) {
      const nb = b?.b.find((q) => q[0] === id);
      out.balls.push(nb ? { id, x: lerp(x, nb[1]), y: lerp(y, nb[2]), vx, vy, attached: !!att } : { id, x: x + vx * (T - a.st) / 1000 * (b ? 0 : 1), y: y + vy * (T - a.st) / 1000 * (b ? 0 : 1), vx, vy, attached: !!att });
    }
    for (const [id, x, y, type] of a.u) {
      const nu = b?.u.find((q) => q[0] === id);
      out.powerups.push({ id, x: nu ? lerp(x, nu[1]) : x, y: nu ? lerp(y, nu[2]) : y, type: type as PowerType });
    }
    return out;
  }

  get phase(): Phase | null { return this.latest ? (this.latest.ph as Phase) : null; }

  // Block positions follow the swing clock for moving blocks.
  placeBlocks(time: number): void {
    for (const b of this.blocks) if (b.type === 'm' && b.alive) placeBlock(b as never, this.rows, time);
  }

  reset(): void {
    this.buffer = [];
    this.cur = null;
    this.latest = null;
    this.blocks = [];
    this.pendingLevel = null;
    this.blocksVersion++;
  }
}
