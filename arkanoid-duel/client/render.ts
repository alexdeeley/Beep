// Drawing the arena on a canvas.
//
// The arena is a fixed 1000 x 1600 space; this scales it to fit any screen and
// draws everything in that space. Nothing here decides anything about the
// game: it only draws what the server last said, blended between snapshots.

import { BALL, H, PADDLE, TIMING, W } from '../shared/constants.ts';
import type { GameEvent, PowerType } from '../shared/types.ts';
import type { CBlock, Interp, Snap, World } from './world.ts';

export interface ViewOptions {
  flip: boolean;        // turn the picture round so you are at the bottom
  contrast: boolean;    // high-contrast: plain colours, strong outlines, no glow
}

export interface HudInfo {
  me: 0 | 1 | 2;
  names: [string, string];
  touch: boolean;
  phase: string;
  cur: Snap | null;
  serverNow: number;
  renderT: number;
}

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number }
interface Ring { x: number; y: number; r: number; max: number; life: number; color: string }
interface Floater { text: string; x: number; y: number; life: number; max: number; color: string; size: number }

const P1 = '#19e6ff';
const P2 = '#ff3fd8';
const GOLD = '#ffe14d';

const POWER_STYLE: Record<PowerType, { glyph: string; color: string }> = {
  wide: { glyph: 'W', color: '#4dff88' },
  multi: { glyph: '×3', color: '#ffe14d' },
  pierce: { glyph: '➤', color: '#ff6a3d' },
  slow: { glyph: 'S', color: '#6aa8ff' },
  fast: { glyph: 'F', color: '#ff4d6d' },
  shield: { glyph: '▬', color: '#19e6ff' },
  magnet: { glyph: 'M', color: '#d27bff' },
  chaos: { glyph: '?', color: '#ffffff' },
};

const hsl = (h: number, s: number, l: number) => `hsl(${h} ${s}% ${l}%)`;

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private cw = 0;
  private ch = 0;
  private s = 1;
  private ox = 0;
  private oy = 0;
  opts: ViewOptions = { flip: false, contrast: false };

  private layer: HTMLCanvasElement | null = null;     // the wall's still pieces, drawn once and reused
  private layerVersion = -1;
  private layerKey = '';
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private floaters: Floater[] = [];
  private trails = new Map<number, { x: number; y: number }[]>();
  private shake = 0;
  private lastFrame = 0;
  private lastLevelSeen = -1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
  }

  // ── Layout and coordinates ───────────────────────────────

  layout(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const vv = window.visualViewport;
    this.cw = Math.round(vv ? vv.width : window.innerWidth);
    this.ch = Math.round(vv ? vv.height : window.innerHeight);
    this.canvas.width = Math.round(this.cw * this.dpr);
    this.canvas.height = Math.round(this.ch * this.dpr);
    this.canvas.style.width = this.cw + 'px';
    this.canvas.style.height = this.ch + 'px';
    this.s = Math.min(this.cw / W, this.ch / H);
    this.ox = (this.cw - W * this.s) / 2;
    this.oy = (this.ch - H * this.s) / 2;
    this.layerVersion = -1;
  }

  // arena units -> CSS pixels on screen (and back)
  toScreen(x: number, y: number): [number, number] {
    return this.opts.flip ? [this.ox + (W - x) * this.s, this.oy + (H - y) * this.s] : [this.ox + x * this.s, this.oy + y * this.s];
  }
  toArena(sx: number, sy: number): [number, number] {
    const ax = (sx - this.ox) / this.s, ay = (sy - this.oy) / this.s;
    return this.opts.flip ? [W - ax, H - ay] : [ax, ay];
  }
  get scale(): number { return this.s; }

  private arenaTransform(c: CanvasRenderingContext2D, dx = 0, dy = 0): void {
    const k = this.dpr * this.s;
    if (this.opts.flip) c.setTransform(-k, 0, 0, -k, this.dpr * (this.ox + W * this.s) + dx * this.dpr, this.dpr * (this.oy + H * this.s) + dy * this.dpr);
    else c.setTransform(k, 0, 0, k, this.dpr * this.ox + dx * this.dpr, this.dpr * this.oy + dy * this.dpr);
  }

  // ── Effects fed by game events ───────────────────────────

  addEvents(events: GameEvent[], me: number, world: World): void {
    for (const e of events) {
      switch (e[0]) {
        case 'pd': this.sparks(e[2], e[3], e[1] === 1 ? P1 : P2, 10, 260); this.shake = Math.max(this.shake, 3); break;
        case 'wl': this.sparks(e[1], e[2], '#9aa4c0', 3, 120); break;
        case 'bd': {
          const b = world.blocks[e[1]];
          if (b) {
            const col = this.blockColor(b, world.rows);
            this.sparks(b.x + b.w / 2, b.y + b.h / 2, col, 16, 340);
            this.rings.push({ x: b.x + b.w / 2, y: b.y + b.h / 2, r: 6, max: 60, life: 1, color: col });
            if (e[2] && e[4]) this.floaters.push({ text: `+${e[4]}`, x: b.x + b.w / 2, y: b.y + b.h / 2, life: 0.8, max: 0.8, color: e[2] === 1 ? P1 : P2, size: 30 });
          }
          this.shake = Math.max(this.shake, 4);
          break;
        }
        case 'ex': this.sparks(e[1], e[2], '#ff8a3d', 36, 520); this.rings.push({ x: e[1], y: e[2], r: 10, max: 190, life: 1, color: '#ff8a3d' }); this.shake = Math.max(this.shake, 14); break;
        case 'sp': this.rings.push({ x: e[1], y: e[2], r: 8, max: 90, life: 1, color: '#4dff88' }); break;
        case 'cb': {
          const mine = e[1] === 1;
          this.floaters.push({ text: `COMBO ×${e[2]}`, x: W / 2, y: mine ? H * 0.64 : H * 0.36, life: 1.3, max: 1.3, color: mine ? P1 : P2, size: e[2] >= 20 ? 120 : e[2] >= 10 ? 96 : 72 });
          this.shake = Math.max(this.shake, e[2] >= 10 ? 12 : 7);
          break;
        }
        case 'pu': this.floaters.push({ text: e[2].toUpperCase(), x: W / 2, y: e[1] === 1 ? H * 0.8 : H * 0.2, life: 1.1, max: 1.1, color: POWER_STYLE[e[2] as PowerType]?.color ?? '#fff', size: 52 }); break;
        case 'lose': this.shake = Math.max(this.shake, 16); this.sparks(W / 2, e[1] === 1 ? H - 30 : 30, e[1] === 1 ? P1 : P2, 30, 500); break;
        case 'lc': this.shake = 12; break;
        case 'sh': this.rings.push({ x: W / 2, y: e[1] === 1 ? PADDLE.y1 + 30 : PADDLE.y2 - 30, r: 20, max: 160, life: 1, color: e[1] === 1 ? P1 : P2 }); break;
        default: break;
      }
    }
    void me;
  }

  private sparks(x: number, y: number, color: string, n: number, speed: number): void {
    for (let i = 0; i < n && this.particles.length < 420; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.25 + Math.random() * 0.75);
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + Math.random() * 0.4, max: 0.9, color, size: 3 + Math.random() * 5 });
    }
  }

  // ── Colours ──────────────────────────────────────────────

  blockColor(b: CBlock, rows: number): string {
    if (this.opts.contrast) {
      return ({ n: '#ffffff', a: '#ffe14d', x: '#ff8a00', s: '#00ff6a', g: '#00ffd5', m: '#ffff00', i: '#8a8a8a', p: '#ffe14d' } as Record<string, string>)[b.type] ?? '#fff';
    }
    switch (b.type) {
      case 'a': return hsl(212, 30, 72);
      case 'x': return hsl(18, 100, 56);
      case 's': return hsl(128, 90, 55);
      case 'g': return hsl(168, 90, 50);
      case 'm': return hsl(52, 100, 58);
      case 'i': return hsl(220, 8, 44);
      case 'p': return hsl(46, 100, 60);
      default: return hsl(320 - 130 * (rows > 1 ? b.r / (rows - 1) : 0.5), 100, 58);   // magenta by P2's end, cyan by P1's
    }
  }

  // One block: colour for its kind, a pattern for its health, cracks for damage, and an icon for what it does.
  private drawBlock(c: CanvasRenderingContext2D, b: CBlock, rows: number, glow: boolean): void {
    const col = this.blockColor(b, rows);
    const { x, y, w, h } = b;
    c.save();
    if (glow && !this.opts.contrast && b.type !== 'i') { c.shadowColor = col; c.shadowBlur = 14; }
    c.fillStyle = b.type === 'i' ? '#2a2e3a' : col;
    c.globalAlpha = b.type === 'i' ? 1 : 0.9;
    roundRect(c, x, y, w, h, 7);
    c.fill();
    c.restore();

    c.save();
    roundRect(c, x, y, w, h, 7);
    c.clip();
    // health pattern: solid = 1 hit left, stripes = 2, cross-hatch = 3 or more
    if (b.type !== 'i') {
      c.strokeStyle = 'rgba(0,0,20,0.5)';
      c.lineWidth = 3;
      if (b.hp >= 2) { for (let k = -h; k < w + h; k += 13) { c.beginPath(); c.moveTo(x + k, y + h); c.lineTo(x + k + h, y); c.stroke(); } }
      if (b.hp >= 3) { for (let k = -h; k < w + h; k += 13) { c.beginPath(); c.moveTo(x + k, y); c.lineTo(x + k + h, y + h); c.stroke(); } }
    } else {
      c.strokeStyle = 'rgba(255,255,255,0.28)';
      c.lineWidth = 4;
      for (let k = -h; k < w + h; k += 11) { c.beginPath(); c.moveTo(x + k, y + h); c.lineTo(x + k + h, y); c.stroke(); }
    }
    // cracks: the more health is gone, the more of them
    const lost = b.max - b.hp;
    if (lost > 0 && b.type !== 'i') {
      c.strokeStyle = 'rgba(0,0,0,0.85)';
      c.lineWidth = 2.2;
      const seed = (b.c * 31 + b.r * 17) % 7;
      for (let k = 0; k < lost; k++) {
        const sx = x + w * (0.25 + 0.5 * (((seed + k * 3) % 5) / 5)), sy = y + 2;
        c.beginPath(); c.moveTo(sx, sy); c.lineTo(sx + 7, y + h * 0.35); c.lineTo(sx - 5, y + h * 0.62); c.lineTo(sx + 6, y + h - 2); c.stroke();
      }
    }
    c.restore();

    // outline: heavier for armour and the immovable
    c.save();
    c.strokeStyle = b.type === 'i' ? '#c9ceda' : b.type === 'a' ? '#ffffff' : 'rgba(255,255,255,0.75)';
    c.lineWidth = b.type === 'a' || b.type === 'i' ? 3.5 : (this.opts.contrast ? 3 : 1.8);
    roundRect(c, x + 1, y + 1, w - 2, h - 2, 6);
    c.stroke();
    c.restore();

    this.drawIcon(c, b);
  }

  private drawIcon(c: CanvasRenderingContext2D, b: CBlock): void {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    c.save();
    c.strokeStyle = '#06080f'; c.fillStyle = '#06080f'; c.lineWidth = 3.2; c.lineCap = 'round';
    switch (b.type) {
      case 'x': for (let k = 0; k < 4; k++) { const a = (k * Math.PI) / 4; c.beginPath(); c.moveTo(cx - Math.cos(a) * 12, cy - Math.sin(a) * 12); c.lineTo(cx + Math.cos(a) * 12, cy + Math.sin(a) * 12); c.stroke(); } break;
      case 's': c.beginPath(); c.arc(cx - 9, cy, 6, 0, 7); c.arc(cx + 9, cy, 6, 0, 7); c.stroke(); break;
      case 'g': c.beginPath(); c.moveTo(cx - 10, cy); c.lineTo(cx + 10, cy); c.moveTo(cx, cy - 10); c.lineTo(cx, cy + 10); c.stroke(); break;
      case 'm': c.beginPath(); c.moveTo(cx - 14, cy); c.lineTo(cx + 14, cy); c.moveTo(cx - 14, cy); c.lineTo(cx - 7, cy - 6); c.moveTo(cx - 14, cy); c.lineTo(cx - 7, cy + 6); c.moveTo(cx + 14, cy); c.lineTo(cx + 7, cy - 6); c.moveTo(cx + 14, cy); c.lineTo(cx + 7, cy + 6); c.stroke(); break;
      case 'p': c.beginPath(); c.moveTo(cx, cy - 12); c.lineTo(cx + 11, cy); c.lineTo(cx, cy + 12); c.lineTo(cx - 11, cy); c.closePath(); c.fill(); break;
      default: break;
    }
    c.restore();
  }

  // ── The frame ────────────────────────────────────────────

  draw(world: World, hud: HudInfo, interp: Interp | null, nowMs: number): void {
    const c = this.ctx;
    const dt = this.lastFrame ? Math.min(0.05, (nowMs - this.lastFrame) / 1000) : 0.016;
    this.lastFrame = nowMs;
    const hc = this.opts.contrast;

    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#000';
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // screen shake
    this.shake = Math.max(0, this.shake - dt * 40);
    const sx = (Math.random() - 0.5) * this.shake, sy = (Math.random() - 0.5) * this.shake;
    this.arenaTransform(c, sx * this.s, sy * this.s);

    this.drawBackdrop(c, hc);

    if (world.level !== this.lastLevelSeen) { this.lastLevelSeen = world.level; this.trails.clear(); }
    if (interp) world.placeBlocks(interp.time);
    this.drawWall(c, world, hc, dt);

    if (interp) {
      this.drawShields(c, hud.cur);
      this.drawPowerups(c, interp, nowMs);
      this.drawBalls(c, interp, hud.cur, dt, hc);
      this.drawPaddles(c, interp, hud);
    }
    this.drawParticles(c, dt);

    // HUD is drawn upright in screen space.
    this.drawHud(c, world, hud, interp);
  }

  private drawBackdrop(c: CanvasRenderingContext2D, hc: boolean): void {
    c.fillStyle = '#03040a';
    c.fillRect(0, 0, W, H);
    c.lineWidth = 2;
    if (!hc) {
      // a quiet grid so movement reads, and a glow along each player's edge
      c.strokeStyle = 'rgba(80,110,200,0.10)';
      for (let y = 100; y < H; y += 100) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
      for (let x = 100; x < W; x += 100) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
      const g1 = c.createLinearGradient(0, H, 0, H - 160); g1.addColorStop(0, 'rgba(25,230,255,0.22)'); g1.addColorStop(1, 'rgba(25,230,255,0)');
      c.fillStyle = g1; c.fillRect(0, H - 160, W, 160);
      const g2 = c.createLinearGradient(0, 0, 0, 160); g2.addColorStop(0, 'rgba(255,63,216,0.22)'); g2.addColorStop(1, 'rgba(255,63,216,0)');
      c.fillStyle = g2; c.fillRect(0, 0, W, 160);
    }
    c.strokeStyle = hc ? '#ffffff' : 'rgba(150,170,230,0.55)';
    c.lineWidth = hc ? 5 : 3;
    c.strokeRect(0, 0, W, H);
  }

  // The wall: still blocks come from a cached picture, moving ones are drawn live.
  private drawWall(c: CanvasRenderingContext2D, world: World, hc: boolean, dt: number): void {
    const key = `${this.s.toFixed(4)}|${this.dpr}|${hc}`;
    if (!this.layer || this.layerVersion !== world.blocksVersion || this.layerKey !== key) {
      const k = this.dpr * this.s;
      const layer = this.layer ?? (this.layer = document.createElement('canvas'));
      layer.width = Math.ceil(W * k); layer.height = Math.ceil(H * k);
      const lc = layer.getContext('2d')!;
      lc.setTransform(k, 0, 0, k, 0, 0);
      lc.clearRect(0, 0, W, H);
      for (const b of world.blocks) if (b.alive && b.type !== 'm') this.drawBlock(lc, b, world.rows, true);
      this.layerVersion = world.blocksVersion;
      this.layerKey = key;
    }
    // draw the cached layer in arena space (undo the transform just for the bitmap)
    c.save();
    c.drawImage(this.layer, 0, 0, W, H);
    c.restore();
    for (const b of world.blocks) {
      if (b.alive && b.type === 'm') this.drawBlock(c, b, world.rows, true);
      if (b.flash > 0 && b.alive) {
        c.fillStyle = `rgba(255,255,255,${(b.flash * 0.8).toFixed(3)})`;
        roundRect(c, b.x, b.y, b.w, b.h, 7); c.fill();
        b.flash = Math.max(0, b.flash - dt / 0.16);
      }
    }
  }

  private drawShields(c: CanvasRenderingContext2D, cur: Snap | null): void {
    if (!cur) return;
    const y1 = PADDLE.y1 + PADDLE.h / 2 + 14, y2 = PADDLE.y2 - PADDLE.h / 2 - 14;
    c.save();
    c.lineWidth = 6; c.setLineDash([26, 12]);
    if (cur.ef[0][2] > 0) { c.strokeStyle = P1; c.shadowColor = P1; c.shadowBlur = this.opts.contrast ? 0 : 16; c.beginPath(); c.moveTo(0, y1); c.lineTo(W, y1); c.stroke(); }
    if (cur.ef[1][2] > 0) { c.strokeStyle = P2; c.shadowColor = P2; c.shadowBlur = this.opts.contrast ? 0 : 16; c.beginPath(); c.moveTo(0, y2); c.lineTo(W, y2); c.stroke(); }
    c.restore();
  }

  private drawPowerups(c: CanvasRenderingContext2D, it: Interp, now: number): void {
    for (const u of it.powerups) {
      const st = POWER_STYLE[u.type];
      const r = 24 + Math.sin(now / 120 + u.id) * 2;
      c.save();
      c.shadowColor = st.color; c.shadowBlur = this.opts.contrast ? 0 : 18;
      c.fillStyle = '#05060c'; c.strokeStyle = st.color; c.lineWidth = 4;
      roundRect(c, u.x - r * 1.25, u.y - r * 0.8, r * 2.5, r * 1.6, r * 0.8); c.fill(); c.stroke();
      c.restore();
      this.canvasText(c, st.glyph, u.x, u.y + 1, 28, st.color);
    }
  }

  private drawBalls(c: CanvasRenderingContext2D, it: Interp, cur: Snap | null, dt: number, hc: boolean): void {
    const pierce = !!cur?.fx[0], chaos = !!cur?.fx[3];
    for (const b of it.balls) {
      const sp = Math.hypot(b.vx, b.vy);
      let tr = this.trails.get(b.id);
      if (!tr) { tr = []; this.trails.set(b.id, tr); }
      if (!b.attached) { tr.push({ x: b.x, y: b.y }); if (tr.length > 18) tr.shift(); } else tr.length = 0;
      // the trail shows direction and speed: longer and brighter the faster it goes
      const heat = Math.min(1, Math.max(0, (sp - BALL.base * 0.8) / (BALL.base * 1.0)));
      for (let i = 1; i < tr.length; i++) {
        const a = i / tr.length;
        c.strokeStyle = pierce ? `rgba(255,120,60,${(a * 0.5 * (0.5 + heat)).toFixed(3)})` : `rgba(180,220,255,${(a * 0.4 * (0.4 + heat)).toFixed(3)})`;
        c.lineWidth = BALL.r * 1.5 * a;
        c.lineCap = 'round';
        c.beginPath(); c.moveTo(tr[i - 1].x, tr[i - 1].y); c.lineTo(tr[i].x, tr[i].y); c.stroke();
      }
      c.save();
      c.shadowColor = pierce ? '#ff6a3d' : '#9fd2ff'; c.shadowBlur = hc ? 0 : 20;
      c.fillStyle = '#ffffff';
      c.beginPath(); c.arc(b.x, b.y, BALL.r, 0, Math.PI * 2); c.fill();
      c.lineWidth = hc ? 5 : 3;
      c.strokeStyle = pierce ? '#ff6a3d' : '#000';
      c.stroke();
      if (chaos) { c.strokeStyle = '#d27bff'; c.setLineDash([4, 5]); c.beginPath(); c.arc(b.x, b.y, BALL.r + 7, 0, Math.PI * 2); c.stroke(); }
      c.restore();
    }
    for (const id of [...this.trails.keys()]) if (!it.balls.some((b) => b.id === id)) { const t = this.trails.get(id)!; t.shift(); if (!t.length) this.trails.delete(id); }
    void dt;
  }

  // Player 1 is a solid cyan bar; Player 2 is a magenta bar with notches cut in it: tell them apart without colour.
  private drawPaddles(c: CanvasRenderingContext2D, it: Interp, hud: HudInfo): void {
    for (const p of [1, 2] as const) {
      const w = it.pw[p - 1];
      const x = it.p[p - 1];
      const y = p === 1 ? PADDLE.y1 : PADDLE.y2;
      const col = p === 1 ? P1 : P2;
      c.save();
      c.shadowColor = col; c.shadowBlur = this.opts.contrast ? 0 : 22;
      c.fillStyle = this.opts.contrast ? (p === 1 ? '#00e5ff' : '#ff00ff') : col;
      roundRect(c, x - w / 2, y - PADDLE.h / 2, w, PADDLE.h, 10); c.fill();
      c.restore();
      if (p === 2) {
        c.fillStyle = '#000';
        for (let k = -w / 2 + 14; k < w / 2 - 8; k += 22) c.fillRect(x + k, y - 3, 9, 6);
      } else {
        c.fillStyle = 'rgba(255,255,255,0.55)';
        c.fillRect(x - w / 2 + 12, y - 2, w - 24, 4);
      }
      c.lineWidth = hud.me === p ? 5 : 2.5; c.strokeStyle = '#ffffff';
      roundRect(c, x - w / 2, y - PADDLE.h / 2, w, PADDLE.h, 10); c.stroke();
    }
  }

  private drawParticles(c: CanvasRenderingContext2D, dt: number): void {
    c.save();
    c.globalCompositeOperation = this.opts.contrast ? 'source-over' : 'lighter';
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy *= 0.96;
      c.globalAlpha = Math.max(0, p.life / p.max);
      c.fillStyle = p.color;
      c.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt * 2.2;
      if (r.life <= 0) { this.rings.splice(i, 1); continue; }
      r.r += (r.max - r.r) * Math.min(1, dt * 9);
      c.globalAlpha = Math.max(0, r.life) * 0.85;
      c.strokeStyle = r.color; c.lineWidth = 4 + 6 * r.life;
      c.beginPath(); c.arc(r.x, r.y, r.r, 0, Math.PI * 2); c.stroke();
    }
    c.restore();
  }

  // ── Text (always upright, even when the picture is turned round) ──

  private canvasText(c: CanvasRenderingContext2D, text: string, ax: number, ay: number, size: number, color: string, align: CanvasTextAlign = 'center', stroke = true, alpha = 1): void {
    const [sx, sy] = this.toScreen(ax, ay);
    c.save();
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.globalAlpha = alpha;
    c.font = `900 ${Math.max(8, size * this.s)}px "Arial Black", Impact, system-ui, sans-serif`;
    c.textBaseline = 'middle';
    c.textAlign = this.opts.flip ? (align === 'left' ? 'right' : align === 'right' ? 'left' : align) : align;
    if (stroke) { c.lineJoin = 'round'; c.lineWidth = Math.max(2, size * this.s * 0.16); c.strokeStyle = 'rgba(0,0,0,0.9)'; c.strokeText(text, sx, sy); }
    c.fillStyle = color;
    c.fillText(text, sx, sy);
    c.restore();
  }

  private outlineText(c: CanvasRenderingContext2D, text: string, ax: number, ay: number, size: number, color: string, alpha: number): void {
    const [sx, sy] = this.toScreen(ax, ay);
    c.save();
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.globalAlpha = alpha;
    c.font = `900 ${size * this.s}px "Arial Black", Impact, system-ui, sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineWidth = Math.max(3, size * this.s * 0.06); c.strokeStyle = color;
    c.strokeText(text, sx, sy);
    c.restore();
  }

  private drawHud(c: CanvasRenderingContext2D, world: World, hud: HudInfo, interp: Interp | null): void {
    const cur = hud.cur;
    const hc = this.opts.contrast;
    for (const p of [2, 1] as const) {
      const top = p === 2;
      const y = top ? 26 : H - 26;
      const col = p === 1 ? P1 : P2;
      const score = cur ? cur.sc[p - 1] : 0;
      const combo = cur ? cur.cb[p - 1] : 0;
      const wins = cur ? cur.lw[p - 1] : 0;
      const name = (hud.names[p - 1] || `PLAYER ${p}`).toUpperCase();
      this.canvasText(c, `${hud.me === p ? '▸ ' : ''}${name}`, 26, y, 26, col, 'left');
      this.canvasText(c, `SCORE ${score.toLocaleString('en-US')}`, 26, y + (top ? 34 : -34), 30, hc ? '#fff' : '#e8f0ff', 'left');
      // level wins as pips: filled = won
      for (let i = 0; i < 3; i++) {
        const [px, py] = [W - 40 - i * 32, y];
        const [sx, sy] = this.toScreen(px, py);
        c.save(); c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        c.beginPath(); c.arc(sx, sy, 11 * this.s, 0, Math.PI * 2);
        c.lineWidth = 3 * this.s; c.strokeStyle = col; c.stroke();
        if (i < wins) { c.fillStyle = col; c.fill(); }
        c.restore();
      }
      if (combo >= 2) this.canvasText(c, `COMBO ×${combo}`, W - 26, y + (top ? 34 : -34), 30, GOLD, 'right');
      // timed effects on this side, shown as a word and a number of seconds left
      const ef = cur?.ef[p - 1];
      if (ef) {
        const chips: string[] = [];
        if (ef[0] > 0) chips.push(`WIDE ${ef[0]}`);
        if (ef[1] > 0) chips.push(`MAGNET ${ef[1]}`);
        if (ef[2] > 0) chips.push(`SHIELD ${ef[2]}`);
        if (chips.length) this.canvasText(c, chips.join('  '), W / 2, y + (top ? 34 : -34), 22, '#ffffff', 'center', true, 0.9);
      }
    }
    // level, and global effects, in the top margin
    if (cur) {
      this.canvasText(c, `LEVEL ${cur.lv}`, W / 2, 26, 28, '#ffffff', 'center', true, 0.9);
      const g: string[] = [];
      if (cur.fx[0]) g.push('PIERCE');
      if (cur.fx[1]) g.push('SLOW');
      if (cur.fx[2]) g.push('FAST');
      if (cur.fx[3]) g.push('CHAOS');
      if (g.length) this.canvasText(c, g.join(' · '), W / 2, 58, 22, '#ffe14d', 'center', true, 0.9);
    }

    this.drawMessages(c, world, hud, interp);

    // floating combo and power-up call-outs
    const dt = 0.016;
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.life -= dt;
      if (f.life <= 0) { this.floaters.splice(i, 1); continue; }
      const a = Math.min(1, f.life / (f.max * 0.4));
      const rise = (1 - f.life / f.max) * 70;
      this.canvasText(c, f.text, f.x, f.y - rise, f.size * (1 + 0.2 * (1 - a)), f.color, 'center', true, a * 0.95);
    }
  }

  private drawMessages(c: CanvasRenderingContext2D, world: World, hud: HudInfo, interp: Interp | null): void {
    const cur = hud.cur;
    if (!cur) return;
    const me = hud.me;
    const mySide = me === 2 ? 0.3 : 0.7;               // the prompt sits between your paddle and the wall
    const remaining = cur.pt - (hud.renderT - cur.st) / 1000;
    switch (cur.ph) {
      case 'COUNTDOWN': {
        const t = remaining - TIMING.go;
        const text = t > 0 ? String(Math.ceil(t)) : 'GO';
        const frac = t > 0 ? t - Math.floor(t) : 1;
        this.outlineText(c, text, W / 2, H / 2, t > 0 ? 420 : 300, '#ffffff', 0.5 + 0.4 * (t > 0 ? frac : 1));
        this.canvasText(c, 'GET READY', W / 2, H * mySide, 54, '#ffffff', 'center', true, 0.9);
        break;
      }
      case 'SERVE':
        if (cur.hb && cur.hb[me - 1]) {
          this.canvasText(c, cur.sm === 'both' ? 'SERVE!' : 'YOUR SERVE', W / 2, H * mySide - 36, 76, '#ffe14d');
          this.canvasText(c, hud.touch ? 'TAP TO SERVE' : 'CLICK OR PRESS SPACE TO SERVE', W / 2, H * mySide + 36, 40, '#ffffff');
        } else {
          this.canvasText(c, 'GET READY', W / 2, H * mySide, 64, '#ffffff', 'center', true, 0.9);
        }
        break;
      case 'PLAYING':
        if (cur.hb && cur.hb[me - 1]) this.canvasText(c, hud.touch ? 'TAP TO SERVE YOUR BALL' : 'PRESS SPACE TO SERVE YOUR BALL', W / 2, H * mySide, 40, '#ffe14d', 'center', true, 0.9);
        break;
      case 'RALLY_END':
        this.canvasText(c, cur.lo === me ? 'MISSED!' : 'POINT!', W / 2, H * mySide, 92, cur.lo === me ? '#ff4d6d' : '#4dff88');
        break;
      case 'LEVEL_CLEAR': {
        this.canvasText(c, 'LEVEL CLEAR', W / 2, H / 2 - 50, 120, '#ffe14d');
        this.canvasText(c, `PLAYER ${cur.lwn} TOOK LEVEL ${cur.lv}`, W / 2, H / 2 + 50, 46, cur.lwn === 1 ? P1 : P2);
        break;
      }
      default: break;
    }
    void world; void interp;
  }
}


function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

