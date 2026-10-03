// The whole game, as one deterministic simulation.
//
// This is the only place that decides anything: who serves, where the ball is,
// what it hit, who gets the points, when a rally or level or match is over.
// The server runs it at a fixed 60 Hz and tells the browsers what happened;
// browsers only ever send "my paddle should be here" and a few button presses.
// It has no clocks, no network and no randomness of its own (a seeded
// generator is passed in), so tests can drive it step by step.

import {
  W, H, DT, PADDLE, BALL, LOSE_MARGIN, SCORE, TIMING, MATCH, POWERUP,
} from './constants.ts';
import { makeLevel, placeBlock, isRequired } from './levels.ts';
import type {
  Ball, Block, GameEvent, Phase, PlayerNo, PowerType, PowerUp, Seat,
} from './types.ts';

export interface PaddleState {
  x: number;
  target: number;
  wide: number;      // seconds of each effect left
  magnet: number;
  shield: number;
}

export interface Fx { pierce: number; slow: number; fast: number; chaos: number }

const other = (p: PlayerNo): PlayerNo => (p === 1 ? 2 : 1);
const seatOf = (p: number): Seat => (p === 1 ? 0 : 1);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

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

const POWER_WEIGHTS: [PowerType, number][] = [
  ['wide', 3], ['multi', 2], ['pierce', 2], ['slow', 1.5], ['fast', 1.5], ['shield', 2], ['magnet', 1.5], ['chaos', 1],
];

const ACTIVE: Phase[] = ['COUNTDOWN', 'SERVE', 'PLAYING', 'RALLY_END', 'LEVEL_CLEAR'];
const LIVE: Phase[] = ['COUNTDOWN', 'SERVE', 'PLAYING', 'RALLY_END'];   // the wall and paddles keep moving

export class Match {
  phase: Phase = 'WAITING_FOR_PLAYER';
  phaseTime = 0;            // seconds in this phase so far
  phaseLeft = 0;            // timed phases: seconds to go
  tick = 0;

  level = 1;
  rows = 4;
  blocks: Block[] = [];
  time = 0;                 // seconds into this level (moving blocks swing by it)
  levelSerial = 0;          // counts every wall that has been built, so the server knows when to resend it

  rally = 1;
  servePlayer: PlayerNo = 1;
  rallyHits = 0;
  lastHit: 0 | PlayerNo = 0;          // who touched the ball last (credit for blocks)
  lastKiller: 0 | PlayerNo = 0;       // who broke the latest required block
  rallyLoser: 0 | PlayerNo = 0;
  levelWinner: 0 | PlayerNo = 0;
  matchWinner: 0 | PlayerNo = 0;

  score: [number, number] = [0, 0];
  combo: [number, number] = [0, 0];
  levelWins: [number, number] = [0, 0];
  rallyWins: [number, number] = [0, 0];

  paddles: [PaddleState, PaddleState] = [
    { x: W / 2, target: W / 2, wide: 0, magnet: 0, shield: 0 },
    { x: W / 2, target: W / 2, wide: 0, magnet: 0, shield: 0 },
  ];
  balls: Ball[] = [];
  powerups: PowerUp[] = [];
  fx: Fx = { pierce: 0, slow: 0, fast: 0, chaos: 0 };

  ready: [boolean, boolean] = [false, false];
  rematch: [boolean, boolean] = [false, false];
  connected: [boolean, boolean] = [false, false];
  speedSetting = 1;

  events: GameEvent[] = [];
  changed = new Set<number>();        // blocks whose health changed since the last snapshot

  private rng: () => number;
  private nextBallId = 1;
  private nextPowerId = 1;
  private resumeAfter: Phase = 'COUNTDOWN';   // what the match was doing when someone dropped out

  constructor(seed = 1) {
    this.rng = mulberry32(seed);
    this.loadLevel(1);
  }

  // ── Lobby and match flow ───────────────────────────────────

  private set(phase: Phase, seconds = 0): void {
    this.phase = phase;
    this.phaseTime = 0;
    this.phaseLeft = seconds;
  }

  // Called whenever someone connects or leaves.
  setConnected(p: PlayerNo, on: boolean): void {
    this.connected[seatOf(p)] = on;
    const both = this.connected[0] && this.connected[1];
    if (on) {
      if (this.phase === 'DISCONNECTED' && both) {
        // Back together. A rally that was in the air is void (same server, fresh
        // count-in); one that had already ended, or a level that had just been
        // cleared, still counts and moves on as it would have.
        if (this.resumeAfter === 'LEVEL_CLEAR') {
          this.afterLevelClear();
          if ((this.phase as Phase) === 'SERVE') this.enterCountdown();
        } else {
          if (this.resumeAfter === 'RALLY_END') { this.rally++; this.servePlayer = other(this.servePlayer); }
          this.enterCountdown();
        }
      } else if (this.phase === 'WAITING_FOR_PLAYER' && both) {
        this.ready = [false, false];
        this.set('READY');
      }
      return;
    }
    this.ready[seatOf(p)] = false;
    this.rematch[seatOf(p)] = false;
    if (ACTIVE.includes(this.phase)) {
      this.resumeAfter = this.phase;
      this.set('DISCONNECTED', TIMING.disconnectGrace);
      this.balls = [];
      this.powerups = [];
    } else if (this.phase !== 'DISCONNECTED') {
      this.resetToWaiting();
    }
  }

  // The player who stayed gives up waiting (or decides to wait a while longer).
  abandon(): void { if (this.phase === 'DISCONNECTED') this.resetToWaiting(); }
  waitMore(): void { if (this.phase === 'DISCONNECTED') this.phaseLeft = Math.min(this.phaseLeft + TIMING.disconnectGrace, 120); }

  private resetToWaiting(): void {
    this.resetMatch();
    this.ready = [false, false];
    this.rematch = [false, false];
    this.set(this.connected[0] && this.connected[1] ? 'READY' : 'WAITING_FOR_PLAYER');
  }

  setSpeed(p: PlayerNo, speed: number): boolean {
    if (p !== 1 || (this.phase !== 'READY' && this.phase !== 'WAITING_FOR_PLAYER')) return false;
    if (!MATCH.speeds.includes(speed)) return false;
    this.speedSetting = speed;
    return true;
  }

  pressReady(p: PlayerNo): boolean {
    if (this.phase !== 'READY') return false;
    this.ready[seatOf(p)] = true;
    if (this.ready[0] && this.ready[1]) { this.ready = [false, false]; this.resetMatch(); this.enterCountdown(); }
    return true;
  }

  pressRematch(p: PlayerNo): boolean {
    if (this.phase !== 'MATCH_WON' && this.phase !== 'REMATCH') return false;
    this.rematch[seatOf(p)] = true;
    if (this.rematch[0] && this.rematch[1]) {
      this.rematch = [false, false];
      this.resetMatch();
      this.enterCountdown();
    } else {
      this.phase = 'REMATCH';
    }
    return true;
  }

  returnToLobby(_p: PlayerNo): boolean {
    if (this.phase !== 'MATCH_WON' && this.phase !== 'REMATCH') return false;
    this.rematch = [false, false];
    this.ready = [false, false];
    this.resetMatch();
    this.set(this.connected[0] && this.connected[1] ? 'READY' : 'WAITING_FOR_PLAYER');
    return true;
  }

  // Only the serving player may launch, and only during SERVE.
  pressServe(p: PlayerNo): boolean {
    if (this.phase !== 'SERVE' || p !== this.servePlayer) return false;
    const ball = this.balls[0];
    if (!ball || !ball.attached) return false;
    this.launch(ball);
    return true;
  }

  private resetMatch(): void {
    this.score = [0, 0];
    this.combo = [0, 0];
    this.levelWins = [0, 0];
    this.rallyWins = [0, 0];
    this.rally = 1;
    this.servePlayer = 1;
    this.matchWinner = 0;
    this.levelWinner = 0;
    this.rallyLoser = 0;
    this.loadLevel(1);
    this.clearField();
    for (const pd of this.paddles) { pd.wide = pd.magnet = pd.shield = 0; }
  }

  private loadLevel(level: number): void {
    this.level = level;
    this.levelSerial++;
    const lv = makeLevel(level);
    this.rows = lv.rows;
    this.blocks = lv.blocks;
    this.time = 0;
    this.changed.clear();
  }

  private clearField(): void {
    this.balls = [];
    this.powerups = [];
    this.fx = { pierce: 0, slow: 0, fast: 0, chaos: 0 };
    this.lastHit = 0;
    this.rallyHits = 0;
  }

  private enterCountdown(): void {
    this.clearField();
    this.set('COUNTDOWN', TIMING.countdown + TIMING.go);
    this.placeServeBall();
  }

  private enterServe(): void {
    this.clearField();
    for (const pd of this.paddles) { pd.wide = pd.magnet = pd.shield = 0; }   // temporary effects end with the rally
    this.set('SERVE');
    this.placeServeBall();
  }

  private placeServeBall(): void {
    const p = this.servePlayer;
    const pd = this.paddles[seatOf(p)];
    this.balls = [{
      id: this.nextBallId++, x: pd.x, y: this.serveY(p), vx: 0, vy: 0, attached: true, inside: [],
    }];
  }

  private serveY(p: PlayerNo): number {
    return p === 1 ? PADDLE.y1 - PADDLE.h / 2 - BALL.r - 1 : PADDLE.y2 + PADDLE.h / 2 + BALL.r + 1;
  }

  // The serve fans out from where the paddle stands: from the right-hand side
  // it heads left across the court, from the left it heads right, and from the
  // middle it goes straight at the wall. Deliberate, never random.
  private launch(ball: Ball): void {
    const p = this.servePlayer;
    const speed = this.targetSpeed();
    const a = clamp(-(ball.x - W / 2) / (W / 2), -1, 1) * BALL.serveAngle;
    ball.attached = false;
    ball.vx = Math.sin(a) * speed;
    ball.vy = (p === 1 ? -1 : 1) * Math.cos(a) * speed;
    this.lastHit = p;
    this.set('PLAYING');
    this.events.push(['sv', p]);
  }

  // ── Input ──────────────────────────────────────────────────

  paddleWidth(seat: Seat): number {
    return this.paddles[seat].wide > 0 ? PADDLE.wideW : PADDLE.w;
  }

  // Where the player would like their paddle. The server decides how fast it
  // actually gets there.
  setTarget(p: PlayerNo, x: number): void {
    if (!Number.isFinite(x)) return;
    const seat = seatOf(p);
    const half = this.paddleWidth(seat) / 2;
    this.paddles[seat].target = clamp(x, half, W - half);
  }

  // ── The simulation ─────────────────────────────────────────

  targetSpeed(): number {
    const rally = Math.min(BALL.maxRallyMul, 1 + BALL.rallyStep * this.rallyHits);
    const lvl = Math.min(BALL.maxLevelMul, 1 + BALL.levelStep * (this.level - 1));
    const fx = this.fx.fast > 0 ? 1.3 : this.fx.slow > 0 ? 0.7 : 1;
    return BALL.base * rally * lvl * fx * this.speedSetting;
  }

  step(dt = DT): void {
    this.tick++;
    this.phaseTime += dt;

    if (this.phase === 'DISCONNECTED') {
      this.phaseLeft -= dt;
      if (this.phaseLeft <= 0) this.resetToWaiting();
      return;
    }
    // Paddles always follow their targets, so you can warm up in the lobby.
    for (const seat of [0, 1] as Seat[]) this.movePaddle(seat, dt);

    if (!LIVE.includes(this.phase) && this.phase !== 'LEVEL_CLEAR') return;

    this.time += dt;
    this.updateBlocks(dt);

    switch (this.phase) {
      case 'COUNTDOWN':
        this.followServe();
        this.phaseLeft -= dt;
        if (this.phaseLeft <= 0) this.enterServe();
        break;
      case 'SERVE':
        this.followServe();
        if (this.phaseTime >= TIMING.autoServe) this.pressServe(this.servePlayer);   // an idle server is helped along
        break;
      case 'PLAYING':
        this.updateEffects(dt);
        this.stepBalls(dt);
        this.stepPowerups(dt);
        this.checkEnd();
        break;
      case 'RALLY_END':
        this.phaseLeft -= dt;
        if (this.phaseLeft <= 0) {
          this.rally++;
          this.servePlayer = other(this.servePlayer);   // serve alternates; the winner of the rally gets no say
          this.enterServe();
        }
        break;
      case 'LEVEL_CLEAR':
        this.phaseLeft -= dt;
        if (this.phaseLeft <= 0) this.afterLevelClear();
        break;
      default:
        break;
    }
  }

  private movePaddle(seat: Seat, dt: number): void {
    const pd = this.paddles[seat];
    const half = this.paddleWidth(seat) / 2;
    pd.target = clamp(pd.target, half, W - half);
    const d = pd.target - pd.x;
    const m = PADDLE.maxSpeed * dt;
    pd.x = Math.abs(d) <= m ? pd.target : pd.x + Math.sign(d) * m;
    pd.x = clamp(pd.x, half, W - half);
  }

  private followServe(): void {
    const b = this.balls[0];
    if (!b || !b.attached) return;
    b.x = this.paddles[seatOf(this.servePlayer)].x;
    b.y = this.serveY(this.servePlayer);
  }

  private updateEffects(dt: number): void {
    for (const k of ['pierce', 'slow', 'fast', 'chaos'] as const) this.fx[k] = Math.max(0, this.fx[k] - dt);
    for (const pd of this.paddles) {
      pd.wide = Math.max(0, pd.wide - dt);
      pd.magnet = Math.max(0, pd.magnet - dt);
      pd.shield = Math.max(0, pd.shield - dt);
    }
  }

  private updateBlocks(dt: number): void {
    for (let i = 0; i < this.blocks.length; i++) {
      const b = this.blocks[i];
      if (!b.alive) continue;
      if (b.type === 'm') placeBlock(b, this.rows, this.time);
      if (b.type === 'g' && b.hp < b.max) {
        b.regen -= dt;
        if (b.regen <= 0) { b.hp++; b.regen = 6; this.changed.add(i); }
      }
    }
  }

  private stepBalls(dt: number): void {
    const speed = this.targetSpeed();
    for (const ball of [...this.balls]) {
      if (ball.attached) continue;
      // Ease toward the speed the rally has earned (also eases slow / fast effects).
      const cur = Math.hypot(ball.vx, ball.vy) || speed;
      const next = cur + (speed - cur) * Math.min(1, dt * 6);
      const k = next / cur;
      ball.vx *= k; ball.vy *= k;
      this.keepSteep(ball);

      const steps = Math.max(1, Math.ceil((next * dt) / BALL.maxSubstep));
      const h = dt / steps;
      for (let s = 0; s < steps; s++) {
        ball.x += ball.vx * h;
        ball.y += ball.vy * h;
        this.hitWalls(ball);
        this.hitBlocks(ball);
        this.hitPaddles(ball);
        this.hitShields(ball);
        if (this.lostBall(ball)) break;
      }
    }
  }

  private hitWalls(ball: Ball): void {
    if (ball.x < BALL.r) { ball.x = BALL.r; ball.vx = Math.abs(ball.vx); this.events.push(['wl', ball.x, ball.y]); this.keepSteep(ball); }
    else if (ball.x > W - BALL.r) { ball.x = W - BALL.r; ball.vx = -Math.abs(ball.vx); this.events.push(['wl', ball.x, ball.y]); this.keepSteep(ball); }
  }

  // The ball may never go (nearly) flat: that is how rallies get stuck.
  private keepSteep(ball: Ball): void {
    const sp = Math.hypot(ball.vx, ball.vy);
    if (!sp) return;
    const min = BALL.minVyFrac * sp;
    if (Math.abs(ball.vy) < min) {
      const sign = ball.vy !== 0 ? Math.sign(ball.vy) : (this.servePlayer === 1 ? -1 : 1);
      ball.vy = sign * min;
      ball.vx = Math.sign(ball.vx || 1) * Math.sqrt(Math.max(0, sp * sp - ball.vy * ball.vy));
    }
  }

  private hitBlocks(ball: Ball): void {
    const pierce = this.fx.pierce > 0;
    const r = BALL.r;
    if (pierce) {
      // Pass through breakable blocks, damaging each once per pass; solid ones still bounce.
      const now: number[] = [];
      let bounceAt = -1, bounceD = Infinity;
      for (let i = 0; i < this.blocks.length; i++) {
        const b = this.blocks[i];
        if (!b.alive) continue;
        const d = circleRectDistance(ball.x, ball.y, b);
        if (d >= r) continue;
        if (b.type === 'i') { if (d < bounceD) { bounceD = d; bounceAt = i; } continue; }
        now.push(i);
        if (!ball.inside.includes(i)) this.damage(i, this.lastHit, ball);
      }
      ball.inside = now;
      if (bounceAt >= 0) this.bounce(ball, this.blocks[bounceAt]);
      return;
    }
    ball.inside = [];
    let hit = -1, best = Infinity;
    for (let i = 0; i < this.blocks.length; i++) {
      const b = this.blocks[i];
      if (!b.alive) continue;
      const d = circleRectDistance(ball.x, ball.y, b);
      if (d < r && d < best) { best = d; hit = i; }
    }
    if (hit < 0) return;
    const b = this.blocks[hit];
    this.bounce(ball, b);
    if (b.type !== 'i') this.damage(hit, this.lastHit, ball);
    else this.events.push(['bh', hit]);
  }

  // Reflect off a block along the way the ball is actually pressed out of it.
  private bounce(ball: Ball, b: Block): void {
    const cx = clamp(ball.x, b.x, b.x + b.w), cy = clamp(ball.y, b.y, b.y + b.h);
    let nx = ball.x - cx, ny = ball.y - cy;
    let d = Math.hypot(nx, ny);
    let pen: number;
    if (d > 1e-6) { nx /= d; ny /= d; pen = BALL.r - d; }
    else {
      // The centre is inside the block: leave by the nearest face.
      const dl = ball.x - b.x, dr = b.x + b.w - ball.x, dt = ball.y - b.y, db = b.y + b.h - ball.y;
      const m = Math.min(dl, dr, dt, db);
      nx = 0; ny = 0;
      if (m === dl) nx = -1; else if (m === dr) nx = 1; else if (m === dt) ny = -1; else ny = 1;
      pen = BALL.r + m;
      d = 0;
    }
    ball.x += nx * pen;
    ball.y += ny * pen;
    const vn = ball.vx * nx + ball.vy * ny;
    if (vn < 0) { ball.vx -= 2 * vn * nx; ball.vy -= 2 * vn * ny; }
    this.keepSteep(ball);
  }

  private hitPaddles(ball: Ball): void {
    const r = BALL.r;
    // Player 1, at the bottom: the ball must be coming down onto the top face.
    {
      const pd = this.paddles[0], half = this.paddleWidth(0) / 2;
      const top = PADDLE.y1 - PADDLE.h / 2;
      if (ball.vy > 0 && ball.y <= PADDLE.y1 && ball.y + r >= top && Math.abs(ball.x - pd.x) <= half + r * 0.6) {
        ball.y = top - r;
        this.paddleHit(ball, 1, pd, half);
      }
    }
    // Player 2, at the top.
    {
      const pd = this.paddles[1], half = this.paddleWidth(1) / 2;
      const bottom = PADDLE.y2 + PADDLE.h / 2;
      if (ball.vy < 0 && ball.y >= PADDLE.y2 && ball.y - r <= bottom && Math.abs(ball.x - pd.x) <= half + r * 0.6) {
        ball.y = bottom + r;
        this.paddleHit(ball, 2, pd, half);
      }
    }
  }

  // Where on the paddle the ball lands sets the angle it leaves at: the paddle is an aiming device.
  private paddleHit(ball: Ball, p: PlayerNo, pd: PaddleState, half: number): void {
    const rel = clamp((ball.x - pd.x) / half, -1, 1);
    let angle = rel * BALL.maxAngle * (pd.magnet > 0 ? 1.3 : 1);
    if (this.fx.chaos > 0) angle += (this.rng() - 0.5) * 0.7;
    angle = clamp(angle, -1.2, 1.2);
    this.rallyHits++;
    const speed = this.targetSpeed();
    ball.vx = Math.sin(angle) * speed;
    ball.vy = (p === 1 ? -1 : 1) * Math.cos(angle) * speed;
    ball.inside = [];
    this.lastHit = p;
    this.events.push(['pd', p, ball.x, ball.y]);
  }

  // A shield is a barrier just behind the paddle that bounces the ball back.
  private hitShields(ball: Ball): void {
    const y1 = PADDLE.y1 + PADDLE.h / 2 + 14, y2 = PADDLE.y2 - PADDLE.h / 2 - 14;
    if (this.paddles[0].shield > 0 && ball.vy > 0 && ball.y + BALL.r >= y1) {
      ball.y = y1 - BALL.r; ball.vy = -Math.abs(ball.vy); this.events.push(['sh', 1]);
    } else if (this.paddles[1].shield > 0 && ball.vy < 0 && ball.y - BALL.r <= y2) {
      ball.y = y2 + BALL.r; ball.vy = Math.abs(ball.vy); this.events.push(['sh', 2]);
    }
  }

  // Past a paddle and off the edge: that ball is gone.
  private lostBall(ball: Ball): boolean {
    let loser: PlayerNo | 0 = 0;
    if (ball.y > H - LOSE_MARGIN) loser = 1;
    else if (ball.y < LOSE_MARGIN) loser = 2;
    if (!loser) return false;
    this.balls = this.balls.filter((b) => b !== ball);
    if (this.balls.length === 0) this.rallyLoser = loser;
    return true;
  }

  // ── Blocks, scoring, power-ups ─────────────────────────────

  private damage(i: number, credit: 0 | PlayerNo, ball?: Ball): void {
    const b = this.blocks[i];
    if (!b.alive || b.type === 'i') return;
    b.hp--;
    this.changed.add(i);
    if (b.type === 'g') b.regen = 6;
    if (b.hp > 0) { this.events.push(['bh', i]); return; }
    this.destroy(i, credit, ball);
  }

  private destroy(i: number, credit: 0 | PlayerNo, ball?: Ball): void {
    const b = this.blocks[i];
    b.alive = false;
    b.hp = 0;
    this.changed.add(i);
    let points = 0;
    if (credit) {
      const seat = seatOf(credit);
      this.combo[seat]++;
      points = SCORE.block * this.combo[seat];
      this.score[seat] += points;
      if ([5, 10, 15, 20, 30, 40, 50].includes(this.combo[seat])) this.events.push(['cb', credit, this.combo[seat]]);
      if (isRequired(b)) this.lastKiller = credit;
    }
    this.events.push(['bd', i, credit, credit ? this.combo[seatOf(credit)] : 0, points]);
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;

    if (b.type === 'x') {
      this.events.push(['ex', cx, cy]);
      for (let j = 0; j < this.blocks.length; j++) {
        const n = this.blocks[j];
        if (j !== i && n.alive && Math.abs(n.c - b.c) <= 1 && Math.abs(n.r - b.r) <= 1) this.damage(j, credit, ball);
      }
    }
    if (b.type === 's' && ball) {
      this.events.push(['sp', cx, cy]);
      this.spawnBalls(ball, [-0.45, 0.45]);
    }
    if (credit && (b.type === 'p' || this.rng() < POWERUP.dropChance)) this.dropPowerup(cx, cy, credit);
  }

  // New balls leave from an existing one, fanned out either side of its path.
  private spawnBalls(from: Ball, angles: number[]): void {
    for (const a of angles) {
      if (this.balls.length >= BALL.maxBalls) return;
      const c = Math.cos(a), s = Math.sin(a);
      this.balls.push({
        id: this.nextBallId++, x: from.x, y: from.y, attached: false, inside: [],
        vx: from.vx * c - from.vy * s, vy: from.vx * s + from.vy * c,
      });
      this.keepSteep(this.balls[this.balls.length - 1]);
    }
  }

  private dropPowerup(x: number, y: number, to: PlayerNo): void {
    let total = 0;
    for (const [, w] of POWER_WEIGHTS) total += w;
    let r = this.rng() * total, type: PowerType = 'wide';
    for (const [t, w] of POWER_WEIGHTS) { r -= w; if (r <= 0) { type = t; break; } }
    // It falls toward whoever earned it, so the opponent can't just steal it.
    this.powerups.push({ id: this.nextPowerId++, x, y, dir: to === 1 ? 1 : -1, type });
  }

  private stepPowerups(dt: number): void {
    for (const u of [...this.powerups]) {
      u.y += u.dir * POWERUP.fall * dt;
      const p: PlayerNo = u.dir === 1 ? 1 : 2;
      const seat = seatOf(p);
      const py = p === 1 ? PADDLE.y1 : PADDLE.y2;
      const half = this.paddleWidth(seat) / 2;
      if (Math.abs(u.y - py) <= PADDLE.h / 2 + POWERUP.r && Math.abs(u.x - this.paddles[seat].x) <= half + POWERUP.r * 0.5) {
        this.applyPower(u.type, p);
        this.powerups = this.powerups.filter((q) => q !== u);
      } else if (u.y > H + 40 || u.y < -40) {
        this.powerups = this.powerups.filter((q) => q !== u);
      }
    }
  }

  applyPower(type: PowerType, p: PlayerNo): void {
    const seat = seatOf(p);
    const d = POWERUP.durations;
    this.events.push(['pu', p, type]);
    switch (type) {
      case 'wide': this.paddles[seat].wide = d.wide; break;
      case 'magnet': this.paddles[seat].magnet = d.magnet; break;
      case 'shield': this.paddles[seat].shield = d.shield; break;
      case 'pierce': this.fx.pierce = d.pierce; break;
      case 'slow': this.fx.slow = d.slow; this.fx.fast = 0; break;
      case 'fast': this.fx.fast = d.fast; this.fx.slow = 0; break;
      case 'chaos': this.fx.chaos = d.chaos; break;
      case 'multi':
        for (const b of [...this.balls]) if (!b.attached) this.spawnBalls(b, [-0.5, 0.5]);
        break;
      default: break;
    }
  }

  // ── Rally, level and match endings ─────────────────────────

  private checkEnd(): void {
    const left = this.blocks.some((b) => b.alive && isRequired(b));
    if (!left) { this.endLevel(); return; }          // a cleared wall beats any loose ball
    if (this.balls.length === 0) this.endRally();
  }

  private endRally(): void {
    const loser = (this.rallyLoser || 1) as PlayerNo;
    this.combo[seatOf(loser)] = 0;                   // missing costs you your combo
    this.rallyWins[seatOf(other(loser))]++;
    this.powerups = [];
    this.events.push(['lose', loser]);
    this.set('RALLY_END', TIMING.rallyEnd);
  }

  private endLevel(): void {
    const w = (this.lastKiller || this.lastHit || 1) as PlayerNo;
    this.levelWinner = w;
    this.levelWins[seatOf(w)]++;
    this.balls = [];
    this.powerups = [];
    this.events.push(['lc', w]);
    this.set('LEVEL_CLEAR', TIMING.levelClear);
  }

  private afterLevelClear(): void {
    const w = this.levelWinner as PlayerNo;
    if (this.levelWins[seatOf(w)] >= MATCH.levelsToWin) {
      this.matchWinner = w;
      this.rematch = [false, false];
      this.set('MATCH_WON');
      this.events.push(['mw', w]);
      return;
    }
    this.loadLevel(this.level + 1);
    this.rally++;
    this.servePlayer = other(this.servePlayer);
    this.enterServe();
  }

  // ── What the browsers are told ─────────────────────────────

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  // A full description of the wall as it stands (sent on joining and each new level).
  levelMessage(): LevelMessage {
    return {
      level: this.level,
      rows: this.rows,
      blocks: this.blocks.map((b): LevelMessage['blocks'][number] => [b.c, b.r, b.type, b.hp, b.max, b.alive ? 1 : 0, b.amp, b.period, b.ph]),
    };
  }

  // The compact state sent ~30 times a second. Block health travels as changes only.
  snapshot(): Snapshot {
    const bt: [number, number][] = [];
    for (const i of this.changed) bt.push([i, this.blocks[i].alive ? this.blocks[i].hp : 0]);
    this.changed.clear();
    return {
      tk: this.tick,
      ph: this.phase,
      pt: this.phaseLeft,
      lv: this.level,
      rl: this.rally,
      sv: this.servePlayer,
      lh: this.lastHit,
      sc: this.score,
      cb: this.combo,
      lw: this.levelWins,
      // who has pressed the button the screen is asking for: READY in the lobby, REMATCH at the end
      rd: this.phase === 'MATCH_WON' || this.phase === 'REMATCH' ? this.rematch : this.ready,
      cn: this.connected,
      sp: this.speedSetting,
      tm: Math.round(this.time * 1000) / 1000,
      p: [Math.round(this.paddles[0].x * 10) / 10, Math.round(this.paddles[1].x * 10) / 10],
      pw: [this.paddleWidth(0), this.paddleWidth(1)],
      b: this.balls.map((b): Snapshot['b'][number] => [b.id, round1(b.x), round1(b.y), round1(b.vx), round1(b.vy), b.attached ? 1 : 0]),
      u: this.powerups.map((u): Snapshot['u'][number] => [u.id, round1(u.x), round1(u.y), u.type]),
      fx: [this.fx.pierce > 0 ? 1 : 0, this.fx.slow > 0 ? 1 : 0, this.fx.fast > 0 ? 1 : 0, this.fx.chaos > 0 ? 1 : 0],
      ef: [
        [Math.ceil(this.paddles[0].wide), Math.ceil(this.paddles[0].magnet), Math.ceil(this.paddles[0].shield)],
        [Math.ceil(this.paddles[1].wide), Math.ceil(this.paddles[1].magnet), Math.ceil(this.paddles[1].shield)],
      ],
      bt,
      ev: this.drainEvents(),
      mw: this.matchWinner,
      lwn: this.levelWinner,
      lo: this.rallyLoser,
    };
  }
}


// What goes over the wire. Short names keep the 30-a-second snapshots small.
export interface Snapshot {
  tk: number;                       // tick
  ph: Phase;
  pt: number;                       // seconds left in a timed phase
  lv: number;                       // level
  rl: number;                       // rally number
  sv: PlayerNo;                     // who serves
  lh: 0 | PlayerNo;                 // who touched the ball last
  sc: [number, number];             // scores
  cb: [number, number];             // combos
  lw: [number, number];             // levels won
  rd: [boolean, boolean];           // who has pressed READY (lobby) or REMATCH (end)
  cn: [boolean, boolean];           // who is connected
  sp: number;                       // game speed
  tm: number;                       // seconds into the level (moving blocks swing by it)
  p: [number, number];              // paddle centres
  pw: [number, number];             // paddle widths
  b: [number, number, number, number, number, number][];     // balls: id, x, y, vx, vy, attached
  u: [number, number, number, string][];                     // power-ups: id, x, y, type
  fx: [number, number, number, number];                      // pierce, slow, fast, chaos active
  ef: [[number, number, number], [number, number, number]];  // per player: wide, magnet, shield seconds left
  bt: [number, number][];           // blocks whose health changed: index, hp
  ev: GameEvent[];
  mw: 0 | PlayerNo;                 // match winner
  lwn: 0 | PlayerNo;                // last level winner
  lo: 0 | PlayerNo;                 // who lost the last rally
}

export interface LevelMessage {
  level: number;
  rows: number;
  blocks: [number, number, string, number, number, number, number, number, number][];   // c, r, type, hp, max, alive, amp, period, ph
}

const round1 = (v: number) => Math.round(v * 10) / 10;

// How far a point is from the nearest part of a rectangle (0 if inside).
export function circleRectDistance(px: number, py: number, b: { x: number; y: number; w: number; h: number }): number {
  const cx = clamp(px, b.x, b.x + b.w), cy = clamp(py, b.y, b.y + b.h);
  return Math.hypot(px - cx, py - cy);
}


// Convenience for tests: run for a number of seconds.
export function run(m: Match, seconds: number): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) m.step(DT);
}

