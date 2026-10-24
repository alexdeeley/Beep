// EXAMPLE EXTENSION — visual effect + gesture-to-effect mapping.
// Adds a 'lissajous' effect (a glowing Lissajous figure traced over the grid, lighting the
// cells it crosses) and an interaction profile 'lissajous' that maps gestures to it. The
// profile includes 'core.base' so long-press/multitouch keep working, and has cycle:true
// so the EFFECT button reaches it.

const TAU = Math.PI * 2;

const lissajous = {
  id: 'ex.lissajous', name: 'LISSAJOUS', description: 'A Lissajous figure traced from the touch point.',
  kind: 'local', life: 2.4, priority: 1, maxInstances: 4,
  defaults: { a: 3, b: 2, size: 0.28, points: 140 },
  spawn(inst, ctx) {
    // Frequency ratio from position: left = 1:2 ... right = 5:4 (musical intervals).
    const ratios = [[1, 2], [2, 3], [3, 4], [3, 2], [5, 4]];
    const [a, b] = ratios[Math.min(ratios.length - 1, Math.floor(inst.x * ratios.length))];
    inst.state = { a, b, t0: inst.x * 0.4 + ctx.clock.time * 0.01, delta: inst.y * Math.PI };
  },
  _pt(inst, u, g) {
    const s = inst.state, p = inst.params; const grow = Math.min(1, inst.age * 2);
    const r = p.size * grow;
    return [inst.x + (Math.sin(s.a * u + s.delta + inst.age) * r * g.unit) / g.width, inst.y + (Math.sin(s.b * u) * r * g.unit) / g.height];
  },
  update(inst, dt, ctx) {
    const g = ctx.grid; const fade = 1 - inst.t;
    const view = { unit: Math.min(g.cols, g.rows), width: g.cols, height: g.rows };
    for (let k = 0; k < 60; k++) {
      const [x, y] = this._pt(inst, (k / 60) * TAU, view);
      const gx = Math.floor(x * g.cols), gy = Math.floor(y * g.rows);
      if (!g.inBounds(gx, gy)) continue;
      const i = gy * g.cols + gx;
      ctx.comp.add('bright', i, 0.45 * fade);
      ctx.comp.setColor(i, inst.state.t0 + k / 120, fade, 1);
    }
  },
  draw(inst, g) {
    const n = inst.params.points; const fade = 1 - inst.t;
    let [px, py] = this._pt(inst, 0, g);
    for (let k = 1; k <= n; k++) {
      const [x, y] = this._pt(inst, (k / n) * TAU, g);
      g.line(px, py, x, y, { t: inst.state.t0 + k / n * 0.3, b: 1, alpha: fade * 0.8, width: 0.003 });
      px = x; py = y;
    }
  },
};

const profile = {
  id: 'ex.lissajous-profile', name: 'LISSAJOUS', cycle: true, include: ['core.base'],
  description: 'Example extension: taps draw Lissajous figures whose ratio follows x.',
  rules: [
    { on: 'press', do: [{ effect: 'ex.lissajous' }, { sound: 'bell', map: 'position-pitch', gain: 0.7 }] },
    { on: 'drag', do: [{ effect: 'energy-trail' }] },
    { on: 'drag', throttle: 0.25, do: [{ effect: 'ex.lissajous', params: { size: 0.12 } }, { sound: 'pluck', map: 'velocity-glide', gain: 0.5 }] },
    { on: 'swipe', do: [{ effect: 'color-cascade' }, { sound: 'rise', map: 'velocity-glide' }] },
  ],
};

export default {
  manifest: {
    id: 'ex.lissajous', name: 'Lissajous Effect (example)', version: '1.0.0', type: 'effect', apiVersion: '1.0.0',
    description: 'Example visual effect plus an interaction profile that uses it.',
    dependencies: ['core.effects', 'core.interactions'], capabilities: ['visual'], performance: { cost: 'low' },
  },
  register(api) {
    // ============================================================
    // EXTENSION ZONE: CUSTOM VISUAL EFFECTS (example)
    // PURPOSE: Register additional visual effects here.
    // CONTRACT: See EXTENSION_GUIDE.md and src/effects/effect-interface.js.
    // SAFETY: Effects must have bounded lifetimes and support cleanup.
    // INTEGRATION: Register through the public effect registry.
    // ============================================================
    api.effects.register(lissajous);
    // ============================================================
    // EXTENSION ZONE: GESTURE-TO-EFFECT MAPPINGS (example)
    // PURPOSE: Map gestures to effects/sounds with an interaction profile (pure data).
    // CONTRACT: src/interaction/router.js (profile + action format).
    // SAFETY: Profiles cannot run code; unknown effect/sound ids are ignored.
    // INTEGRATION: api.interactions.register(profile); cycle:true adds it to the EFFECT button.
    // ============================================================
    api.interactions.register(profile);
  },
};
