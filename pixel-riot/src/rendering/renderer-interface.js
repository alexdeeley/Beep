// Renderer backend contract (API 1.x).
//
//   {
//     id, name, description?,
//     supported?(): bool                 // feature detection (e.g. WebGL availability)
//     init(canvas, services): void       // services = { palettes, shapes, events }
//     resize(cssWidth, cssHeight, dpr): void
//     render(frame): { cellsDrawn }      // see FrameDescription below
//     createOverlay(): OverlayAPI        // the drawing API handed to effect.draw()
//     snapshot?(): Promise<Blob>         // PNG of the current frame
//     dispose(): void
//   }
//
// FrameDescription (read-only for renderers):
//   { grid, comp, palette, shapeSet: [shapeDef], shapeMode, particles, overlays: [fn(g)],
//     look: { patternGain, cellScale, gap, hueBias, rotateCells }, settings: { intensity,
//     trails, reducedMotion, reducedFlash }, time, dt }
//
// OverlayAPI — what effects may draw with (normalized 0..1 coordinates, sizes in units
// where 1 unit = short side of the canvas):
//   g.width, g.height, g.unit, g.cols, g.rows
//   g.color(t, b) -> css colour from the active palette (t wraps, b 0..1)
//   g.shape(shapeId, x, y, size, { t, b, color, alpha, rot, stroke, lineWidth })
//   g.line(x0, y0, x1, y1, { t, b, color, alpha, width })
//   g.ring(x, y, radius, { t, b, color, alpha, width })
//   g.cell(gx, gy, { t, b, color, alpha, scale, shape })
//   g.text?(...)  — intentionally NOT provided (the art has no text)

// ============================================================
// EXTENSION ZONE: RENDERING BACKENDS
// PURPOSE: Alternative renderers (Canvas 2D variants, WebGL, WebGPU).
// CONTRACT: Renderer contract above (init/resize/render/createOverlay/dispose).
// SAFETY: A renderer that throws is replaced by canvas2d automatically.
// INTEGRATION: api.renderers.register(def). Example: src/extensions/examples/dot-matrix-renderer.js
// ============================================================
import { need } from '../core/registry.js';

export function validateRenderer(d) {
  const e = [];
  for (const k of ['init', 'resize', 'render', 'createOverlay', 'dispose']) need.fn(d, k, e);
  need.optFn(d, 'supported', e); need.optFn(d, 'snapshot', e);
  return e;
}
