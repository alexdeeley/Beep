// EXAMPLE EXTENSION — a settings-sheet UI panel built only on the public API.

export default {
  manifest: { id: 'ex.stats-panel', name: 'Live Stats Panel (example)', version: '1.0.0', type: 'ui', apiVersion: '1.0.0', description: 'Adds a LIVE STATS panel to the settings sheet.', capabilities: ['ui'] },
  register(api) {
    // ============================================================
    // EXTENSION ZONE: USER INTERFACE PANELS (example)
    // PURPOSE: Add sections to the settings sheet.
    // CONTRACT: { id, title, order, render(container, api) -> cleanup? } — use api.* only,
    //           never reach into internals or the canvas.
    // SAFETY: Return a cleanup function for any timer/subscription you create; panels are
    //         rendered when opened and disposed when the sheet closes.
    // INTEGRATION: api.ui.panels.register(def)
    // ============================================================
    api.ui.panels.register({
      id: 'ex.stats', title: 'LIVE STATS', order: 95,
      render(container, a) {
        const pre = document.createElement('pre');
        pre.className = 'pr-note';
        const tick = () => {
          const s = a.performance.stats();
          pre.textContent = `FPS ${s.fps} · EFFECTS ${s.effects} · PARTICLES ${s.particles} · VOICES ${s.voices}\nGESTURE ENERGY CELLS LIT ${s.cellsDrawn} · QUALITY ${s.quality.toUpperCase()}\nEFFECT SET ${a.interactions.active()} · TEMPO ${a.clock.tempo}`;
        };
        tick();
        const h = setInterval(tick, 250);
        container.append(pre);
        return () => clearInterval(h);
      },
    });
  },
};
