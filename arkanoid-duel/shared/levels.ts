// The central wall, level by level. Every formation is mirrored left-to-right
// and top-to-bottom, so neither player faces an easier side. Later levels
// change what the wall *does* (armour, explosions, splitting, moving and
// regenerating blocks, tunnels), not just how fast the ball is.

import { WALL } from './constants.ts';
import type { Block, BlockType } from './types.ts';

interface Spec { type: BlockType; hp?: number }
// c: 0..7 is the left half of the wall; r: 0 is the outer row, counting inward
type Cell = (c: number, r: number, rows: number) => Spec | null;
interface Pattern { rows: number; cell: Cell }

const n = (hp = 1): Spec => ({ type: 'n', hp });

// A small stable hash to 0..1 so a level always comes out the same.
export function h01(a: number, b = 0, c = 0): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const PATTERNS: Record<number, Pattern> = {
  // 1: the plain wall - 16 x 4, one hit each
  1: { rows: 4, cell: () => n(1) },
  // 2: tougher - alternate rows take two hits
  2: { rows: 4, cell: (_c, r) => n(r % 2 === 0 ? 2 : 1) },
  // 3: mixed health, the first explosive and power blocks
  3: {
    rows: 6,
    cell: (c, r, rows) => {
      if ((c === 2 && r === 1) || (c === 5 && r === 2)) return { type: 'p', hp: 1 };
      if ((c === 3 && r === 0) || (c === 4 && r === rows / 2 - 1)) return { type: 'x', hp: 1 };
      return n(1 + Math.floor(h01(c, r, 3) * 3));
    },
  },
  // 4: a diamond with splitters at its heart
  4: {
    rows: 8,
    cell: (c, r) => {
      const dc = 7.5 - c, dr = 3.5 - r;
      if (dc / 7.5 + dr / 3.5 > 1.18) return null;
      if (c === 7 && r === 3) return { type: 's', hp: 1 };
      if ((c === 5 && r === 2) || (c === 3 && r === 1)) return { type: 'p', hp: 1 };
      return n(dc < 3 ? 2 : 1);
    },
  },
  // 5: checkerboard - armour at the edges
  5: {
    rows: 6,
    cell: (c, r) => {
      if ((c + r) % 2 !== 0) return null;
      if (c === 4 && r === 2) return { type: 'p', hp: 1 };
      if (c <= 1) return { type: 'a', hp: 3 };
      return n(2);
    },
  },
  // 6: a cross, with immovable ends and a bomb where the arms meet
  6: {
    rows: 8,
    cell: (c, r) => {
      const bar = c >= 5 || r >= 2;
      if (!bar) return null;
      if (c === 0 && r === 3) return { type: 'i', hp: 99 };
      if (c === 7 && r === 3) return { type: 'x', hp: 1 };
      if (c === 6 && r === 0) return { type: 'p', hp: 1 };
      return n(r === 3 || c === 7 ? 2 : 1);
    },
  },
  // 7: corridors - indestructible walls make lanes, with movers on the outside
  7: {
    rows: 6,
    cell: (c, r) => {
      if (r === 0) return c % 2 === 1 ? { type: 'm', hp: 2 } : null;
      if (c % 3 === 0) return { type: 'i', hp: 99 };
      if (c === 4 && r === 1) return { type: 'p', hp: 1 };
      return n(r === 1 ? 2 : 1);
    },
  },
  // 8: a spiral of rings that heal, with a gap to find the way in
  8: {
    rows: 8,
    cell: (c, r) => {
      const k = Math.min(c, r);
      if (k % 2 !== 0) return null;
      if (k === 0 && c === 3) return null;
      if (k === 0) return { type: 'g', hp: 2 };
      if (k === 2) return { type: c === 4 && r === 2 ? 'p' : 'a', hp: k === 2 ? 3 : 1 };
      return { type: 'x', hp: 1 };
    },
  },
};

// Beyond the hand-made levels: a seeded mix that gets harder as it goes.
function procedural(level: number): Pattern {
  const rows = level % 2 === 0 ? 8 : 6;
  const hard = Math.min(1, (level - 8) / 12);
  return {
    rows,
    cell: (c, r) => {
      const v = h01(c, r, level * 7);
      if (v < 0.16 - hard * 0.04) return null;
      const t = h01(c, r, level * 13);
      if (t < 0.05) return { type: 'p', hp: 1 };
      if (t < 0.10 + hard * 0.05) return { type: 'x', hp: 1 };
      if (t < 0.14 && c > 0 && c < 7) return { type: 's', hp: 1 };
      if (t < 0.22 + hard * 0.1) return { type: 'a', hp: 3 };
      if (t < 0.30 + hard * 0.1) return { type: 'g', hp: 2 };
      if (t < 0.36 && r > 0 && c % 3 === 1) return { type: 'i', hp: 99 };
      return n(1 + Math.floor(h01(c, r, level) * (2 + hard * 2)));
    },
  };
}

export interface Level { rows: number; blocks: Block[] }

// How the solid part of a block at this moment is placed.
export function placeBlock(b: Block, rows: number, time: number): void {
  const top = WALL.centerY - (rows * WALL.bh) / 2;
  const swing = b.type === 'm' ? b.amp * Math.sin((2 * Math.PI * time) / b.period + b.ph) : 0;
  b.x = WALL.left + b.c * WALL.bw + WALL.inset + swing;
  b.y = top + b.r * WALL.bh + WALL.inset;
  b.w = WALL.bw - 2 * WALL.inset;
  b.h = WALL.bh - 2 * WALL.inset;
}

export function makeLevel(level: number): Level {
  const pattern = PATTERNS[level] || procedural(level);
  const { rows } = pattern;
  const half = Math.ceil(rows / 2);
  const blocks: Block[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < WALL.cols; c++) {
      const qc = c < WALL.cols / 2 ? c : WALL.cols - 1 - c;
      const qr = r < half ? r : rows - 1 - r;
      const spec = pattern.cell(qc, qr, rows);
      if (!spec) continue;
      const hp = spec.hp ?? 1;
      const b: Block = {
        c, r, type: spec.type, hp, max: hp, alive: true,
        amp: spec.type === 'm' ? WALL.bw * 0.8 : 0,
        period: 5,
        ph: c >= WALL.cols / 2 ? Math.PI : 0,       // the two halves swing as mirror images
        regen: 0, x: 0, y: 0, w: 0, h: 0,
      };
      placeBlock(b, rows, 0);
      blocks.push(b);
    }
  }
  return { rows, blocks };
}

export const isRequired = (b: Block): boolean => b.type !== 'i';
