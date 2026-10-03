// Moving the paddle and serving, with a finger, a mouse or a keyboard.
//
// Input never moves anything by itself: it works out where the player would
// like their paddle (in arena units) and where they have tapped, and hands
// those over. The server decides what actually happens.

import { PADDLE, W } from '../shared/constants.ts';

export interface InputHooks {
  toArena: (sx: number, sy: number) => [number, number];
  flipped: () => boolean;
  onTarget: (x: number) => void;
  onServe: () => void;
}

const KEYS_LEFT = ['KeyA', 'ArrowLeft', 'KeyJ'];
const KEYS_RIGHT = ['KeyD', 'ArrowRight', 'KeyL'];
const KEYS_SERVE = ['Space', 'Enter', 'ArrowUp', 'KeyW'];

export class Input {
  enabled = false;
  touch = false;
  target = W / 2;
  private held = new Set<string>();
  private drag: { id: number; startX: number; startY: number; paddle: number; t: number; moved: number } | null = null;
  private hooks: InputHooks;
  private last = 0;

  constructor(el: HTMLElement, hooks: InputHooks) {
    this.hooks = hooks;
    const opts = { passive: false } as const;

    el.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      if (e.pointerType === 'touch' || e.pointerType === 'pen') this.touch = true;
      try { el.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      this.drag = { id: e.pointerId, startX: e.clientX, startY: e.clientY, paddle: this.target, t: performance.now(), moved: 0 };
      // a mouse follows the pointer directly; a finger drags the paddle relative to where it was
      if (e.pointerType === 'mouse') this.setFromPointer(e.clientX);
      e.preventDefault();
    }, opts);

    el.addEventListener('pointermove', (e) => {
      if (!this.enabled) return;
      if (e.pointerType === 'mouse') { this.setFromPointer(e.clientX); return; }
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      d.moved = Math.max(d.moved, Math.hypot(e.clientX - d.startX, e.clientY - d.startY));
      const [ax0] = this.hooks.toArena(d.startX, 0), [ax1] = this.hooks.toArena(e.clientX, 0);
      this.set(d.paddle + (ax1 - ax0) * 1.35);
      e.preventDefault();
    }, opts);

    const end = (e: PointerEvent) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      this.drag = null;
      // a quick touch that barely moved is a tap: serve
      if (this.enabled && d.moved < 14 && performance.now() - d.t < 450) this.hooks.onServe();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', () => { this.drag = null; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('touchstart', (e) => { if (this.enabled) e.preventDefault(); }, opts);
    el.addEventListener('touchmove', (e) => { if (this.enabled) e.preventDefault(); }, opts);

    window.addEventListener('keydown', (e) => {
      if (!this.enabled || e.repeat && KEYS_SERVE.includes(e.code)) return;
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (KEYS_LEFT.includes(e.code) || KEYS_RIGHT.includes(e.code)) { this.held.add(e.code); e.preventDefault(); }
      else if (KEYS_SERVE.includes(e.code)) { this.hooks.onServe(); e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());
  }

  private setFromPointer(clientX: number): void {
    this.set(this.hooks.toArena(clientX, 0)[0]);
  }

  private set(x: number): void {
    this.target = Math.max(PADDLE.w / 2, Math.min(W - PADDLE.w / 2, x));
    this.hooks.onTarget(this.target);
  }

  // Held keys slide the target along, a little each frame.
  update(now: number): void {
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0.016;
    this.last = now;
    if (!this.enabled || this.held.size === 0) return;
    let dir = 0;
    if (KEYS_LEFT.some((k) => this.held.has(k))) dir -= 1;
    if (KEYS_RIGHT.some((k) => this.held.has(k))) dir += 1;
    if (!dir) return;
    if (this.hooks.flipped()) dir = -dir;          // "left" on screen stays left when the picture is turned round
    this.set(this.target + dir * 1500 * dt);
  }

  // Start from where the paddle already is (e.g. after the match begins or the picture is flipped).
  sync(x: number): void { this.target = x; }
}
