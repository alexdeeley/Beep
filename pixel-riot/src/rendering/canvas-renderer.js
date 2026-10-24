// Canvas 2D renderer backend (the default). See renderer-interface.js for the contract.
//
// Per frame:
//   1. background (full clear, or translucent overdraw when TRAILS > 0 for echo trails)
//   2. cell pass   — one shape per lit cell from grid state + compositor modulations
//   3. overlay pass (additive 'lighter') — particles and effect draw() callbacks
//
// Hot-loop rules: no allocation, cached palette style strings, fast fillRect path for
// unrotated square-ish shapes, setTransform only for rotated cells.

const TAU = Math.PI * 2;

export function createCanvasRenderer() {
  let canvas, ctx, services;
  let W = 1, H = 1, DPR = 1;
  let cellW = 1, cellH = 1, unit = 1;
  let gridRef = null;

  const overlay = {
    width: 1, height: 1, unit: 1, cols: 1, rows: 1,
    color: (t, b = 1) => services.palettes.style(t, b),
    _style(o) {
      const a = o.alpha ?? 1;
      ctx.globalAlpha = a < 0 ? 0 : a > 1 ? 1 : a;
      const col = o.color || services.palettes.style(o.t ?? 0, o.b ?? 1);
      ctx.fillStyle = col; ctx.strokeStyle = col;
    },
    shape(id, x, y, size, o = {}) {
      const def = services.shapes.get(id) || services.shapes.get('square');
      const s = size * unit; if (s < 0.4) return;
      this._style(o);
      const px = x * W, py = y * H;
      const so = { fill: !o.stroke, stroke: !!o.stroke || def.strokeOnly, lineWidth: o.lineWidth ? o.lineWidth * unit : 0, phase: o.phase || 0 };
      if (o.rot) {
        const c = Math.cos(o.rot), sn = Math.sin(o.rot);
        ctx.setTransform(c * DPR, sn * DPR, -sn * DPR, c * DPR, px * DPR, py * DPR);
        def.draw(ctx, 0, 0, s, so);
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      } else def.draw(ctx, px, py, s, so);
    },
    line(x0, y0, x1, y1, o = {}) {
      this._style(o);
      ctx.lineWidth = Math.max(0.5, (o.width ?? 0.004) * unit);
      ctx.beginPath(); ctx.moveTo(x0 * W, y0 * H); ctx.lineTo(x1 * W, y1 * H); ctx.stroke();
    },
    ring(x, y, r, o = {}) {
      const rp = r * unit; if (rp < 0.5) return;
      this._style(o);
      ctx.lineWidth = Math.max(0.5, (o.width ?? 0.006) * unit);
      ctx.beginPath(); ctx.arc(x * W, y * H, rp, 0, TAU); ctx.stroke();
    },
    cell(gx, gy, o = {}) {
      const sc = o.scale ?? 0.9;
      this.shape(o.shape || 'square', (gx + 0.5) * cellW / W, (gy + 0.5) * cellH / H, (Math.min(cellW, cellH) * sc) / unit, o);
    },
  };

  return {
    id: 'canvas2d', name: 'CANVAS 2D', description: 'Default Canvas 2D renderer.',
    supported: () => typeof document !== 'undefined' && !!document.createElement('canvas').getContext,
    init(cv, svc) {
      canvas = cv; services = svc;
      ctx = canvas.getContext('2d', { alpha: false, desynchronized: true }) || canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D is not available');
    },
    resize(w, h, dpr) {
      W = w; H = h; DPR = dpr;
      canvas.width = Math.max(1, Math.round(w * dpr)); canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = services.palettes.background; ctx.fillRect(0, 0, w, h);
      unit = Math.min(w, h);
      Object.assign(overlay, { width: w, height: h, unit });
    },
    createOverlay: () => overlay,

    render(f) {
      const { grid: g, comp, palette: pal, shapeSet, particles, look, settings: st } = f;
      gridRef = g;
      cellW = W / g.cols; cellH = H / g.rows;
      overlay.cols = g.cols; overlay.rows = g.rows;
      const cellPx = Math.min(cellW, cellH);
      const motion = st.reducedMotion ? 0.3 : 1;
      const flashK = st.reducedFlash ? 0.25 : 1;
      const I = st.intensity;
      const G = comp.global;

      // 1. Background / trails.
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      const trails = st.reducedMotion ? Math.min(st.trails, 0.3) : st.trails;
      ctx.globalAlpha = trails > 0 ? 1 - trails : 1;
      ctx.fillStyle = pal.background;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;

      // Scene transform (shake / zoom / rotation from global effects).
      const zoom = 1 + Math.max(-0.3, Math.min(0.5, G.zoom)) * motion;
      const shx = Math.max(-30, Math.min(30, G.shakeX)) * motion, shy = Math.max(-30, Math.min(30, G.shakeY)) * motion;
      const srot = G.rot * motion;
      const cr = Math.cos(srot) * zoom, sr = Math.sin(srot) * zoom;
      const cx = W / 2, cy = H / 2;
      // base = translate(cx+sh) * rotate/zoom * translate(-cx)
      const ba = cr * DPR, bb = sr * DPR, bc = -sr * DPR, bd = cr * DPR;
      const be = (cx + shx - (cr * cx - sr * cy)) * DPR, bf = (cy + shy - (sr * cx + cr * cy)) * DPR;
      ctx.setTransform(ba, bb, bc, bd, be, bf);
      const sceneRotated = srot !== 0 || zoom !== 1;

      // 2. Cell pass.
      const n = g.cols;
      const base = g.base, energy = g.energy, ink = g.ink, paint = g.paint, shp = g.shape, flash = g.flash, phase = g.phase;
      const cB = comp.bright, cS = comp.scale, cR = comp.rot, cX = comp.ox, cY = comp.oy, cH = comp.hue, cF = comp.flash, cW = comp.colorW, cT = comp.colorT;
      const pg = look.patternGain, cellScale = look.cellScale * look.gap, spread = pal.spread, hueBias = look.hueBias + G.hue;
      const nShapes = shapeSet.length;
      const mode = f.shapeMode;
      const so = { fill: true, stroke: false, lineWidth: 0, phase: 0 };
      const gB = G.bright, inv = Math.max(0, Math.min(1, G.invert * flashK));
      const rotCells = look.rotateCells * motion;
      let drawn = 0;
      for (let i = 0; i < g.count; i++) {
        const bv = base[i];
        const e = energy[i];
        let b = bv * pg + e * 0.85 + ink[i] * 0.7 + cB[i] + gB;
        const fl = Math.max(flash[i], cF[i]) * flashK;
        b = (b + fl) * I;
        if (inv > 0) b = b + (1 - 2 * b) * inv;
        if (b < 0.035) continue;
        if (b > 1.6) b = 1.6;
        const gx = i % n, gy = (i / n) | 0;
        let t = paint[i] >= 0 ? paint[i] : bv * spread + hueBias + gx * 0.004;
        t += cH[i] + e * 0.06;
        if (cW[i] > 0) t = t + (cT[i] - t) * cW[i];
        let sc = cellScale * (0.5 + 0.5 * Math.min(1, bv * 1.3 + e * 0.9 + ink[i] * 0.4)) + cS[i] * I;
        if (sc < 0.06) continue;
        if (sc > 1.5) sc = 1.5;
        const s = cellPx * sc;
        let px = (gx + 0.5) * cellW, py = (gy + 0.5) * cellH;
        const ox = cX[i], oy = cY[i];
        if (ox !== 0 || oy !== 0) {
          px += Math.max(-1.5, Math.min(1.5, ox)) * cellW * motion;
          py += Math.max(-1.5, Math.min(1.5, oy)) * cellH * motion;
        }
        // Shape choice: painted shape > mode rule.
        let si;
        if (shp[i] !== 255) si = shp[i] % nShapes;
        else if (mode === 'band') si = Math.min(nShapes - 1, (bv * nShapes) | 0);
        else if (mode === 'energy') si = Math.min(nShapes - 1, (Math.min(1, e * 0.8) * nShapes) | 0);
        else if (mode === 'hash') si = ((gx * 73856093) ^ (gy * 19349663)) % nShapes;
        else si = 0;
        if (si < 0) si = -si;
        const def = shapeSet[si];
        const style = pal.style(t, b > 1 ? 1 : b);
        ctx.fillStyle = style;
        const rot = cR[i] * motion + (rotCells ? phase[i] * rotCells : 0);
        so.phase = phase[i] + e;
        if (def.strokeOnly) { ctx.strokeStyle = style; so.stroke = true; so.lineWidth = Math.max(1, s * 0.16); } else { so.stroke = false; so.lineWidth = 0; }
        if (rot > 0.01 || rot < -0.01) {
          const c = Math.cos(rot), sn = Math.sin(rot);
          // compose scene transform with local rotation
          ctx.setTransform(
            (ba * c + bc * sn), (bb * c + bd * sn), (-ba * sn + bc * c), (-bb * sn + bd * c),
            ba * px + bc * py + be, bb * px + bd * py + bf,
          );
          def.draw(ctx, 0, 0, s, so);
          ctx.setTransform(ba, bb, bc, bd, be, bf);
        } else {
          def.draw(ctx, px, py, s, so);
        }
        drawn++;
      }

      // 3. Overlay pass (additive).
      ctx.globalCompositeOperation = 'lighter';
      if (!sceneRotated) ctx.setTransform(DPR, 0, 0, DPR, shx * DPR, shy * DPR);
      // Particles.
      const P = particles;
      if (P.count) {
        for (let i = 0; i < P.capacity; i++) {
          if (!P.active[i]) continue;
          const lf = P.life[i] / P.max[i];
          const sz = Math.max(1, P.size[i] * unit * (0.4 + 0.6 * lf));
          ctx.globalAlpha = Math.min(1, lf * 1.4);
          ctx.fillStyle = pal.style(P.t[i], 0.6 + 0.4 * lf);
          const x = P.x[i] * W, y = P.y[i] * H;
          if (P.shape[i] === 1) {
            ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = Math.max(1, sz * 0.5);
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - P.vx[i] * unit * 0.05, y - P.vy[i] * unit * 0.05); ctx.stroke();
          } else if (P.shape[i] === 2) {
            ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.arc(x, y, sz, 0, TAU); ctx.stroke();
          } else ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
        }
      }
      // Effect overlays.
      for (const draw of f.overlays) {
        ctx.globalAlpha = 1;
        try { draw(overlay); }
        catch (err) { f.onOverlayError?.(err, draw); }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      return { cellsDrawn: drawn };
    },

    snapshot() {
      return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
    },
    dispose() { ctx = null; canvas = null; gridRef = null; },
  };
}
