export type PlayerNo = 1 | 2;
export type Seat = 0 | 1;                  // index into per-player arrays: seat = player - 1

export type Phase =
  | 'WAITING_FOR_PLAYER'
  | 'READY'
  | 'COUNTDOWN'
  | 'SERVE'
  | 'PLAYING'
  | 'RALLY_END'
  | 'LEVEL_CLEAR'
  | 'MATCH_WON'
  | 'REMATCH'
  | 'DISCONNECTED';

// n normal · a armored · x explosive · s splitter · g regenerating
// m moving · i indestructible · p power block
export type BlockType = 'n' | 'a' | 'x' | 's' | 'g' | 'm' | 'i' | 'p';

export interface Block {
  c: number;             // column
  r: number;             // row within this level's wall
  type: BlockType;
  hp: number;
  max: number;
  alive: boolean;
  amp: number;           // moving blocks: how far they swing, units
  period: number;        // ... and how long a swing takes, seconds
  ph: number;            // ... and where in the swing they start, radians
  regen: number;         // regenerating blocks: seconds until the next point of health
  x: number;             // current rectangle of the solid part
  y: number;
  w: number;
  h: number;
}

export interface Ball {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  attached: boolean;     // sitting on a paddle, waiting to be served
  held: 0 | PlayerNo;    // ... and whose paddle that is
  inside: number[];      // piercing: blocks it is passing through right now
}

export type PowerType = 'wide' | 'multi' | 'pierce' | 'slow' | 'fast' | 'shield' | 'magnet' | 'chaos';

export interface PowerUp {
  id: number;
  x: number;
  y: number;
  dir: 1 | -1;           // falls toward the player who earned it (+1 down, -1 up)
  type: PowerType;
}

// Things that happened this tick, for sounds and sparks. Compact tuples.
export type GameEvent =
  | ['pd', number, number, number]            // paddle hit: player, x, y
  | ['wl', number, number]                    // side wall hit: x, y
  | ['bh', number]                            // block hit (not destroyed): index
  | ['bd', number, number, number, number]    // block destroyed: index, player, combo, points
  | ['ex', number, number]                    // explosion: x, y
  | ['sv', number]                            // served: player
  | ['lose', number]                          // rally lost: player
  | ['pu', number, string]                    // power-up caught: player, type
  | ['cb', number, number]                    // combo milestone: player, combo
  | ['lc', number]                            // level cleared: winner
  | ['mw', number]                            // match won: winner
  | ['sh', number]                            // shield saved a ball: player
  | ['sp', number, number];                   // splitter: x, y
