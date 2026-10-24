// EXAMPLE EXTENSION — experimental: GHOST HANDS autoplay. Plays the instrument by itself
// with synthetic taps, swipes, circles and holds (through the real gesture pipeline), so
// it can run as an attract mode or a hands-free recording. Off by default.

export default {
  manifest: {
    id: 'ex.autoplay', name: 'Ghost Hands Autoplay (experimental example)', version: '0.1.0', type: 'experimental', apiVersion: '1.0.0',
    description: 'Plays the instrument with synthetic gestures.', capabilities: ['input'],
  },
  register(api) {
    // ============================================================
    // EXTENSION ZONE: EXPERIMENTAL FEATURES (example)
    // PURPOSE: Try ideas without touching the core.
    // CONTRACT: Any public API; mark the manifest type 'experimental' and default to OFF.
    // SAFETY: Must be removable via SETTINGS > EXTENSIONS with no residue (use api.timers,
    //         api.clock.after and api.events so cleanup is automatic).
    // INTEGRATION: Add to src/extensions/registry.js.
    // ============================================================
    const ns = api.settings.define({ enabled: { type: 'bool', default: false, label: 'GHOST HANDS' } });
    const ID = 20000; let busy = false;
    const r = api.rng;
    const path = (pts, dur, then) => {
      busy = true; const [x0, y0] = pts(0);
      api.input.inject.down(ID, x0, y0);
      const steps = Math.max(2, Math.round(dur * 60));
      for (let k = 1; k <= steps; k++) api.clock.after((k / steps) * dur, () => { const [x, y] = pts(k / steps); api.input.inject.move(ID, x, y); });
      api.clock.after(dur + 0.01, () => { api.input.inject.up(ID); busy = false; then?.(); });
    };
    const moves = [
      () => { const x = r.range(0.15, 0.85), y = r.range(0.15, 0.85); path(() => [x, y], 0.08); },          // tap
      () => { const a = r.range(0, 6.28), x = r.range(0.2, 0.8), y = r.range(0.2, 0.8); path((u) => [x + Math.cos(a) * u * 0.5, y + Math.sin(a) * u * 0.5], 0.25); }, // swipe
      () => { const x = r.range(0.3, 0.7), y = r.range(0.3, 0.7); path((u) => [x + Math.cos(u * 7) * 0.12, y + Math.sin(u * 7) * 0.12], 1.1); },               // circle
      () => { const x = r.range(0.2, 0.8), y = r.range(0.2, 0.8); path(() => [x, y], 1.4); },                // hold
    ];
    api.timers.setInterval(() => {
      if (!api.settings.get(`${ns}.enabled`) || busy) return;
      r.weighted([[moves[0], 5], [moves[1], 3], [moves[2], 1], [moves[3], 1]])();
    }, 700);
    api.ui.panels.register({
      id: 'ex.autoplay-panel', title: 'GHOST HANDS (EXPERIMENTAL)', order: 97,
      render(c, a) {
        const b = document.createElement('button'); b.className = 'pr-btn pr-toggle';
        const on = () => a.settings.get(`${ns}.enabled`);
        const sync = () => { b.textContent = `GHOST HANDS: ${on() ? 'ON' : 'OFF'}`; b.setAttribute('aria-pressed', String(on())); };
        b.onclick = () => { a.settings.set(`${ns}.enabled`, !on()); sync(); };
        sync(); c.append(b);
      },
    });
  },
};
