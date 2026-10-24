// EXAMPLE EXTENSION — a mathematical / generative SYSTEM: three bodies trace rhodonea
// (rose) curves, depositing energy along their paths, like slow-moving pens.
// Off by default; toggle ROSE ORBITS in its settings panel.

export default {
  manifest: {
    id: 'ex.orbits', name: 'Rose Orbits System (example)', version: '1.0.0', type: 'system', apiVersion: '1.0.0',
    description: 'Bodies trace rose curves and leave energy.', capabilities: ['visual'], performance: { cost: 'low' },
    configSchema: { enabled: { type: 'bool', default: false, label: 'ROSE ORBITS' } }, defaults: { enabled: false },
  },
  register(api) {
    const ns = api.settings.define({ enabled: { type: 'bool', default: false, label: 'ROSE ORBITS' }, k: { type: 'number', default: 5, min: 2, max: 9, step: 1, label: 'PETALS' } });
    const on = () => api.settings.get(`${ns}.enabled`);
    const k = () => api.settings.get(`${ns}.k`);
    const pos = (n, t) => { const th = t * (0.23 + n * 0.07) + n * 2.1; const r = 0.42 * Math.cos(k() * th); return [0.5 + r * Math.cos(th), 0.5 + r * Math.sin(th)]; };
    // ============================================================
    // EXTENSION ZONE: MATHEMATICAL / GENERATIVE SYSTEMS (example)
    // PURPOSE: Per-frame simulations that act on the grid (attractors, automata, orbits).
    // CONTRACT: { id, update(dt, ctx), draw?(g, ctx) } — ctx is the EffectContext
    //           (grid, energy, comp, particles, palettes, clock, rng, space, chain).
    // SAFETY: Bounded work per frame; a system that throws is unregistered automatically.
    // INTEGRATION: api.systems.register(def)
    // ============================================================
    api.systems.register({
      id: 'ex.orbits', name: 'ROSE ORBITS',
      update(dt, ctx) {
        if (!on()) return;
        const g = ctx.grid, t = ctx.clock.time;
        for (let n = 0; n < 3; n++) {
          const [x, y] = pos(n, t);
          ctx.energy.inject(x * g.cols, y * g.rows, 0.9 * dt * 10, 1.1);
        }
      },
      draw(gfx, ctx) {
        if (!on()) return;
        const t = ctx.clock.time;
        for (let n = 0; n < 3; n++) { const [x, y] = pos(n, t); gfx.shape('ring', x, y, 0.02, { t: n / 3, b: 1, alpha: 0.9 }); }
      },
    });
    api.ui.panels.register({
      id: 'ex.orbits-panel', title: 'ROSE ORBITS (EXAMPLE)', order: 96,
      render(c, a) {
        const b = document.createElement('button'); b.className = 'pr-btn pr-toggle';
        const sync = () => { b.textContent = `ROSE ORBITS: ${on() ? 'ON' : 'OFF'}`; b.setAttribute('aria-pressed', String(on())); };
        b.onclick = () => { a.settings.set(`${ns}.enabled`, !on()); sync(); };
        const s = document.createElement('input'); s.type = 'range'; s.min = 2; s.max = 9; s.step = 1; s.value = k(); s.oninput = () => a.settings.set(`${ns}.k`, +s.value);
        sync(); c.append(b, s);
      },
    });
  },
};
