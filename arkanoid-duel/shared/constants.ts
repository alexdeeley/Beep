// Every tunable number of the game, in one place. Logical units: the arena is
// W x H (1000 x 1600), y grows downward, Player 1 is at the bottom and
// Player 2 at the top. Rendering scales this to any screen.

export const W = 1000;
export const H = 1600;

// The server simulates at a fixed 60 Hz whatever the browsers' frame rates are,
// and tells the clients about it 30 times a second.
export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;
export const SNAPSHOT_EVERY = 2;

export const PADDLE = {
  w: 170,
  wideW: 280,
  h: 26,
  y1: H - 96,            // centre line of Player 1's paddle (bottom)
  y2: 96,                // ... and Player 2's (top)
  maxSpeed: 2400,        // how fast a paddle can chase its target, units / second
  edge: 36,              // gap between a paddle and the side wall
} as const;

export const BALL = {
  r: 14,
  base: 600,             // speed at the start of a rally, units / second
  rallyStep: 0.05,       // each paddle hit speeds the ball up by this much...
  maxRallyMul: 1.6,      // ...up to this
  levelStep: 0.04,       // each level is a little faster
  maxLevelMul: 1.3,
  maxAngle: (62 * Math.PI) / 180,   // from vertical, at the very edge of a paddle
  minVyFrac: 0.28,       // the ball is never allowed to go flatter than this
  serveAngle: (34 * Math.PI) / 180, // the serve fans out this far from vertical
  maxSubstep: 7,         // the ball never moves further than this in one collision step
  maxBalls: 8,
} as const;

// Falling over this line, past the paddle, loses the rally.
export const LOSE_MARGIN = 22;

export const WALL = {
  cols: 16,
  maxRows: 8,
  bw: 60,                // a block's cell
  bh: 50,
  inset: 2,              // the solid part of a cell is this much smaller on every side
  left: (W - 16 * 60) / 2,
  centerY: H / 2,
} as const;

export const SCORE = { block: 100 } as const;

export const TIMING = {
  countdown: 3.0,        // 3, 2, 1 ...
  go: 0.6,               // ... GO
  rallyEnd: 0.9,
  levelClear: 2.8,
  autoServe: 20,         // an idle server hands the ball over after this long
  disconnectGrace: 25,   // how long a match waits for someone to come back
  serverIdleClose: 60,   // an empty room is thrown away after this long
} as const;

export const MATCH = {
  levelsToWin: 3,
  speeds: [0.8, 1, 1.25] as readonly number[],   // adjustable game speed
} as const;

export const POWERUP = {
  fall: 260,             // units / second
  r: 22,
  dropChance: 0.08,      // any ordinary block may drop one
  durations: { wide: 9, magnet: 9, shield: 10, pierce: 5, slow: 7, fast: 7, chaos: 8 },
} as const;

export const NET = {
  maxMessageBytes: 2048,
  maxMessagesPerSecond: 140,
  helloTimeoutMs: 6000,
  passAttempts: 5,
  passLockMs: 60000,
  maxPass: 24,
  minPass: 3,
  maxName: 12,
} as const;
