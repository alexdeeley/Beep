// The computer opponent.
//
// It plays exactly like a person: it moves a paddle target and presses
// READY, SERVE and REMATCH. It never touches the ball or the score. It only
// looks at what a player could see (where the balls are and where they are
// heading), reacts a little late, aims with some error, and can only move its
// paddle so fast. Easier levels are slower, sloppier and more distractible.
//
// It runs on the server, inside the same fixed-step loop as the match, so a
// game against the computer is as fair and as tamper-proof as one between
// two people. It is deterministic for a given seed, which keeps tests exact.

import { BALL, H, PADDLE, W } from './constants.ts';
import { isRequired } from './levels.ts';
import { circleRectDistance, mulberry32 } from './sim.ts';
import type { Match } from './sim.ts';
import type { PlayerNo } from './types.ts';

export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];
export const isDifficulty = (v: unknown): v is Difficulty => typeof v === 'string' && (DIFFICULTIES as readonly string[]).includes(v);

interface Profile {
  react: number;        // seconds between looks at the ball
  err: number;          // how far off it aims, in arena units (random, per ball)
  speed: number;        // fastest the paddle target may move, units per second
  aim: number;          // 0..1: how often it works out a shot at the wall instead of just returning the ball
  chase: boolean;       // goes after falling power-ups when it is safe to
  think: [number, number];   // seconds it takes over READY / SERVE / REMATCH
}

const PROFILES: Record<Difficulty, Profile> = {
  easy:   { react: 0.38, err: 190, speed: 440,  aim: 0,    chase: false, think: [1.2, 2.6] },
  normal: { react: 0.15, err: 45,  speed: 1100, aim: 0.75, chase: true,  think: [0.7, 1.6] },
  hard:   { react: 0.07, err: 14,  speed: 1900, aim: 0.95, chase: true,  think: [0.4, 1.0] },
};

// A ball's x after bouncing off the side walls for as long as it takes to get there.
function fold(x: number): number {
  const lo = BALL.r, span = W - 2 * BALL.r;
  let u = (x - lo) % (2 * span);
  if (u < 0) u += 2 * span;
  return lo + (u <= span ? u : 2 * span - u);
}

export class Ai {
  readonly match: Match;
  readonly player: PlayerNo;
  readonly difficulty: Difficulty;
  private p: Profile;
  private rng: () => number;
  private clock = 0;
  private lastPhase = '';
  private actAt = 0;
  private nextLook = 0;
  private aim = W / 2;                 // where it is holding its paddle target now
  private want = W / 2;                // where it would like to be
  private threat = '';                 // which ball, going which way, it has already judged
  private miss = 0;                    // its error for that ball
  private edge = 0;                    // which part of the paddle it means to hit with, -1 (left) to 1 (right)

  constructor(match: Match, player: PlayerNo, difficulty: Difficulty, seed = 1) {
    this.match = match;
    this.player = player;
    this.difficulty = difficulty;
    this.p = PROFILES[difficulty];
    this.rng = mulberry32(seed ^ 0x9e3779b9);
    this.aim = this.want = match.paddles[player - 1].x;
  }

  private between(a: number, b: number): number { return a + (b - a) * this.rng(); }

  update(dt: number): void {
    this.clock += dt;
    this.press();
    if (this.clock >= this.nextLook) {
      this.nextLook = this.clock + this.p.react * this.between(0.8, 1.2);
      this.look();
    }
    // Slide toward where it wants to be, no faster than its profile allows.
    const d = this.want - this.aim, step = this.p.speed * dt;
    this.aim += Math.abs(d) <= step ? d : Math.sign(d) * step;
    this.match.setTarget(this.player, this.aim);
  }

  // Buttons: it takes a moment to think before each one, like a person would.
  private press(): void {
    const m = this.match, seat = this.player - 1;
    if (m.phase !== this.lastPhase) {
      this.lastPhase = m.phase;
      this.actAt = this.clock + this.between(this.p.think[0], this.p.think[1]);
      if (m.phase === 'SERVE') this.want = this.between(W * 0.25, W * 0.75);
    }
    if (this.clock < this.actAt) return;
    switch (m.phase) {
      case 'READY': if (!m.ready[seat]) m.pressReady(this.player); break;
      case 'SERVE': if (m.servePlayer === this.player) m.pressServe(this.player); break;
      case 'MATCH_WON': case 'REMATCH': if (!m.rematch[seat]) m.pressRematch(this.player); break;
      default: break;
    }
  }

  // Work out where to be: under the ball that will reach us first.
  private look(): void {
    const m = this.match, me = this.player;
    const mine = me === 1;
    const face = mine ? PADDLE.y1 - PADDLE.h / 2 - BALL.r : PADDLE.y2 + PADDLE.h / 2 + BALL.r;
    const half = m.paddleWidth((me - 1) as 0 | 1) / 2;

    let best: { id: number; x: number; t: number; dir: number } | null = null;
    for (const b of m.balls) {
      if (b.attached) continue;
      const toward = mine ? b.vy > 0 : b.vy < 0;
      if (!toward) continue;
      const t = (face - b.y) / b.vy;
      if (t < 0) continue;
      if (!best || t < best.t) best = { id: b.id, x: fold(b.x + b.vx * t), t, dir: Math.sign(b.vy) };
    }

    if (best) {
      const key = `${best.id}:${best.dir}`;
      if (key !== this.threat) {
        this.threat = key;
        this.miss = (this.rng() + this.rng() - 1) * this.p.err;
        this.edge = this.chooseEdge(best.x, face);
      }
      this.want = best.x + this.miss - this.edge * half;
      // With time to spare and a falling power-up of ours, fetch it instead of hovering.
      if (this.p.chase && best.t > 1.6) this.fetchPowerup();
      return;
    }

    this.threat = '';
    // Nothing coming at us: drift toward the middle of the action, ready for the return.
    let sum = 0, n = 0;
    for (const b of m.balls) { sum += b.x; n++; }
    const centre = n ? 0.5 * (sum / n) + 0.5 * (W / 2) : W / 2;
    this.want = centre;
    if (this.p.chase) this.fetchPowerup();
  }

  private fetchPowerup(): void {
    const dir = this.player === 1 ? 1 : -1;
    let pick: { x: number; y: number } | null = null;
    for (const u of this.match.powerups) {
      if (u.dir !== dir) continue;
      if (!pick || (dir === 1 ? u.y > pick.y : u.y < pick.y)) pick = u;
    }
    if (pick) this.want = pick.x;
  }

  // Which part of the paddle to hit with. Where the ball lands on the paddle sets
  // its angle, so the paddle is an aiming device: try each spot, follow the ball's
  // path off the walls, and prefer the one that breaks the most useful block (above
  // all the last blocks of a level, which decide who wins it). A weaker computer
  // only sometimes bothers, and otherwise just returns the ball.
  private chooseEdge(hitX: number, face: number): number {
    if (this.rng() >= this.p.aim) return (this.rng() * 2 - 1) * (this.p.aim ? 0.5 : 0.2);
    const m = this.match;
    const dir = this.player === 1 ? -1 : 1;
    const opp = m.paddles[this.player === 1 ? 1 : 0].x;
    const oppFace = this.player === 1 ? PADDLE.y2 : PADDLE.y1;
    const live = m.blocks.filter((b) => b.alive);
    const left = live.filter((b) => isRequired(b)).length;
    let best = 0, bestScore = -Infinity;
    for (let rel = -0.85; rel <= 0.851; rel += 0.17) {
      const a = rel * BALL.maxAngle;
      let vx = Math.sin(a), vy = Math.cos(a) * dir, x = hitX, y = face, score = 0, done = false;
      for (let i = 0; i < 260 && !done; i++) {
        x += vx * 10; y += vy * 10;
        if (x < BALL.r) { x = 2 * BALL.r - x; vx = -vx; } else if (x > W - BALL.r) { x = 2 * (W - BALL.r) - x; vx = -vx; }
        for (const b of live) {
          if (circleRectDistance(x, y, b) >= BALL.r) continue;
          done = true;
          if (b.type === 'i') score = -0.6;
          else {
            score = 1 + (left <= 3 ? 2 : 0) + (b.type === 'x' ? 0.5 : b.type === 'p' ? 0.4 : 0) - (b.hp > 1 ? 0.2 : 0);
          }
          break;
        }
        if (!done && (dir === 1 ? y >= oppFace : y <= oppFace || y <= 0 || y >= H)) {
          done = true;
          score = 0.1 + 0.3 * Math.min(1, Math.abs(x - opp) / (W / 2));      // slipped past: make it a hard return
        }
      }
      score += this.rng() * 0.05;
      if (score > bestScore) { bestScore = score; best = rel; }
    }
    return best;
  }
}
