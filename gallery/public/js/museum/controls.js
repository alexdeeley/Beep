// Walking: keyboard and mouse (pointer lock) on a computer, a floating
// thumb-stick and drag-to-look on a phone or tablet.

export class Controls {
  constructor(dom, hooks) {
    this.dom = dom;
    this.hooks = hooks;
    this.keys = new Set();
    this.yaw = 0; this.pitch = 0;
    this.moveX = 0; this.moveY = 0;   // touch stick, -1..1 (x right, y forward)
    this.touch = false;
    this.locked = false;
    this.stick = null; this.look = null;

    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      const k = e.code;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'].includes(k)) { this.keys.add(k); e.preventDefault(); }
      if (k === 'KeyE') hooks.interact?.();
      if (k === 'KeyM') hooks.toggleMap?.();
      if (k === 'KeyQ') hooks.toggleQuality?.();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === dom;
      hooks.lockChange?.(this.locked);
    });
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.turn(e.movementX * 0.0022, e.movementY * 0.0022);
    });

    // touch
    dom.addEventListener('touchstart', (e) => {
      this.touch = true;
      for (const t of e.changedTouches) {
        const left = t.clientX < innerWidth * 0.5;
        if (left && !this.stick) this.stick = { id: t.identifier, x: t.clientX, y: t.clientY };
        else if (!left && !this.look) this.look = { id: t.identifier, x: t.clientX, y: t.clientY };
      }
      hooks.touchStart?.();
      e.preventDefault();
    }, { passive: false });
    dom.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (this.stick && t.identifier === this.stick.id) {
          const dx = (t.clientX - this.stick.x) / 55, dy = (t.clientY - this.stick.y) / 55;
          const len = Math.hypot(dx, dy) || 1, m = Math.min(1, len);
          this.moveX = (dx / len) * m; this.moveY = (-dy / len) * m;
          hooks.stickMove?.(this.stick, t);
        } else if (this.look && t.identifier === this.look.id) {
          this.turn((t.clientX - this.look.x) * 0.0055, (t.clientY - this.look.y) * 0.0055);
          this.look.x = t.clientX; this.look.y = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (this.stick && t.identifier === this.stick.id) { this.stick = null; this.moveX = this.moveY = 0; hooks.stickEnd?.(); }
        if (this.look && t.identifier === this.look.id) this.look = null;
      }
    };
    dom.addEventListener('touchend', end);
    dom.addEventListener('touchcancel', end);
  }

  turn(dyaw, dpitch) {
    this.yaw -= dyaw;
    this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch - dpitch));
  }

  // Desired movement in the walker's own frame: x right, y forward; and run?
  intent() {
    let x = this.moveX, y = this.moveY;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
    if (k.has('KeyD')) x += 1;
    if (k.has('KeyA')) x -= 1;
    if (k.has('ArrowLeft')) this.turn(-0.035, 0);
    if (k.has('ArrowRight')) this.turn(0.035, 0);
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y, run: k.has('ShiftLeft') || k.has('ShiftRight') || Math.hypot(this.moveX, this.moveY) > 0.92 };
  }
}
