// EXAMPLE EXTENSION — an alternative rendering backend: every cell is an LED dot whose
// radius follows brightness (ignores per-cell shapes). Pick it in GRID & PERFORMANCE >
// RENDERER. It reuses the Canvas 2D renderer for the overlay pass by wrapping it.
//
// ============================================================
// EXTENSION ZONE: RENDERING BACKENDS (example)
// PURPOSE: Register alternative renderers (Canvas 2D variants, WebGL, WebGPU).
// CONTRACT: src/rendering/renderer-interface.js — init/resize/render/createOverlay/dispose,
//           optional supported() and snapshot().
// SAFETY: render() must not allocate per cell; throwing makes the app fall back to canvas2d.
// INTEGRATION: api.renderers.register(def); users choose it in settings.
// ============================================================

export default {
  manifest: { id: 'ex.dot-matrix', name: 'Dot Matrix Renderer (example)', version: '1.0.0', type: 'renderer', apiVersion: '1.0.0', description: 'Renders cells as LED dots.', dependencies: ['core.renderers'] },
  register(api) {
    const base = api.renderers.list().find((r) => r.id === 'canvas2d');
    let canvas, ctx, W = 1, H = 1, DPR = 1;
    api.renderers.register({
      id: 'ex.dot-matrix', name: 'DOT MATRIX', description: 'Round LED dots sized by brightness.',
      supported: () => typeof document !== 'undefined',
      init(cv, svc) { canvas = cv; base.init(cv, svc); ctx = canvas.getContext('2d'); },
      resize(w, h, dpr) { W = w; H = h; DPR = dpr; base.resize(w, h, dpr); },   // base keeps the overlay API sized
      createOverlay() { return base.createOverlay(); },
      render(f) {
        const g = f.grid, c = f.comp, pal = f.palette; const cw = W / g.cols, ch = H / g.rows; const r0 = Math.min(cw, ch) * 0.48;
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1 - Math.min(0.8, f.settings.trails);
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
        let n = 0;
        for (let i = 0; i < g.count; i++) {
          let b = (g.base[i] * f.look.patternGain + g.energy[i] * 0.85 + g.ink[i] * 0.7 + c.bright[i] + Math.max(g.flash[i], c.flash[i]) * (f.settings.reducedFlash ? 0.25 : 1)) * f.settings.intensity;
          if (b < 0.04) continue; if (b > 1) b = 1;
          const x = (i % g.cols + 0.5) * cw, y = (((i / g.cols) | 0) + 0.5) * ch;
          const t = g.paint[i] >= 0 ? g.paint[i] : g.base[i] * pal.spread + f.look.hueBias;
          ctx.fillStyle = pal.style(t + c.hue[i], b);
          ctx.beginPath(); ctx.arc(x, y, Math.max(0.6, r0 * Math.sqrt(b)), 0, Math.PI * 2); ctx.fill(); n++;
        }
        // Overlays (effect draw callbacks) use the canvas2d overlay API — same canvas context.
        ctx.globalCompositeOperation = 'lighter';
        const ov = base.createOverlay();
        for (const draw of f.overlays) { try { draw(ov); } catch (e) { f.onOverlayError?.(e); } }
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
        return { cellsDrawn: n };
      },
      snapshot() { return new Promise((res) => canvas.toBlob(res, 'image/png')); },
      dispose() {},
    });
  },
};
