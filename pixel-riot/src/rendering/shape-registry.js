// Shape registry and the 25 built-in shapes.
//
// Shape contract (API 1.x):
//   {
//     id, name,
//     draw(c, x, y, s, o)   // c: Canvas2D path context; (x, y) centre in px; s: size in px
//                           // o: { fill: bool, stroke: bool, lineWidth, phase, rot, energy }
//                           // fillStyle/strokeStyle/globalAlpha are already set by the renderer.
//                           // Rotation is applied by the renderer's transform, so draw unrotated.
//     fast?: bool           // true if the shape is an axis-aligned rect (renderer may batch it)
//     strokeOnly?: bool     // shape is drawn with stroke() (ring, arc, line...)
//   }
// A new compatible shape needs no renderer change: register it and add its id to a
// preset's `shapes` list.

import { Registry, need } from '../core/registry.js';

const TAU = Math.PI * 2;
const lw = (s, o) => Math.max(1, o.lineWidth || s * 0.16);
const paint = (c, o) => { if (o.stroke) c.stroke(); else c.fill(); };

export function createShapeRegistry(events) {
  return new Registry('shapes', { events, validate: (d) => { const e = []; need.fn(d, 'draw', e); return e; } });
}

// ============================================================
// EXTENSION ZONE: GEOMETRIC SHAPES
// PURPOSE: Additional cell shapes.
// CONTRACT: Shape contract at the top of this file: draw(c, x, y, s, o), unrotated, centred.
// SAFETY: Called for thousands of cells per frame: no allocation, never set colours.
// INTEGRATION: api.shapes.register(def); list the id in a preset’s `shapes`. Example: src/extensions/examples/hexagon-shape.js
// ============================================================
export const BUILTIN_SHAPES = [
  { id: 'square', name: 'SQUARE', fast: true, draw(c, x, y, s, o) { const h = s / 2; if (o.stroke) { c.lineWidth = lw(s, o); c.strokeRect(x - h, y - h, s, s); } else c.fillRect(x - h, y - h, s, s); } },
  { id: 'rect', name: 'RECTANGLE', draw(c, x, y, s) { c.fillRect(x - s / 2, y - s * 0.3, s, s * 0.6); } },
  { id: 'circle', name: 'CIRCLE', draw(c, x, y, s, o) { c.beginPath(); c.arc(x, y, s / 2, 0, TAU); paint(c, o); } },
  { id: 'ring', name: 'RING', strokeOnly: true, draw(c, x, y, s, o) { c.lineWidth = lw(s, o); c.beginPath(); c.arc(x, y, s / 2 - c.lineWidth / 2, 0, TAU); c.stroke(); } },
  { id: 'diamond', name: 'DIAMOND', draw(c, x, y, s, o) { const h = s / 2; c.beginPath(); c.moveTo(x, y - h); c.lineTo(x + h, y); c.lineTo(x, y + h); c.lineTo(x - h, y); c.closePath(); paint(c, o); } },
  { id: 'triangle', name: 'TRIANGLE', draw(c, x, y, s, o) { const h = s / 2; c.beginPath(); c.moveTo(x, y - h); c.lineTo(x + h, y + h * 0.8); c.lineTo(x - h, y + h * 0.8); c.closePath(); paint(c, o); } },
  { id: 'hbar', name: 'H BAR', draw(c, x, y, s) { c.fillRect(x - s / 2, y - s * 0.14, s, s * 0.28); } },
  { id: 'vbar', name: 'V BAR', draw(c, x, y, s) { c.fillRect(x - s * 0.14, y - s / 2, s * 0.28, s); } },
  { id: 'cross', name: 'CROSS', strokeOnly: true, draw(c, x, y, s, o) { const h = s * 0.42; c.lineWidth = lw(s, o) * 1.2; c.beginPath(); c.moveTo(x - h, y - h); c.lineTo(x + h, y + h); c.moveTo(x + h, y - h); c.lineTo(x - h, y + h); c.stroke(); } },
  { id: 'plus', name: 'PLUS', draw(c, x, y, s) { const t = s * 0.26; c.fillRect(x - s / 2, y - t / 2, s, t); c.fillRect(x - t / 2, y - s / 2, t, s); } },
  { id: 'chevron', name: 'CHEVRON', strokeOnly: true, draw(c, x, y, s, o) { const h = s * 0.4; c.lineWidth = lw(s, o) * 1.3; c.beginPath(); c.moveTo(x - h, y - h * 0.6); c.lineTo(x, y + h * 0.5); c.lineTo(x + h, y - h * 0.6); c.stroke(); } },
  { id: 'arc', name: 'ARC', strokeOnly: true, draw(c, x, y, s, o) { c.lineWidth = lw(s, o) * 1.2; c.beginPath(); c.arc(x - s / 2, y + s / 2, s * 0.8, -Math.PI / 2, 0); c.stroke(); } },
  { id: 'quarter', name: 'QUARTER', draw(c, x, y, s, o) { const h = s / 2; c.beginPath(); c.moveTo(x - h, y + h); c.arc(x - h, y + h, s, -Math.PI / 2, 0); c.closePath(); paint(c, o); } },
  { id: 'concentric', name: 'CONCENTRIC', strokeOnly: true, draw(c, x, y, s, o) { c.lineWidth = Math.max(1, s * 0.08); c.beginPath(); for (let k = 1; k <= 3; k++) { c.moveTo(x + s * 0.16 * k, y); c.arc(x, y, s * 0.16 * k, 0, TAU); } c.stroke(); } },
  { id: 'checker', name: 'CHECKER', draw(c, x, y, s) { const h = s / 2; c.fillRect(x - h, y - h, h, h); c.fillRect(x, y, h, h); } },
  { id: 'split', name: 'SPLIT', draw(c, x, y, s, o) { const h = s / 2; c.beginPath(); c.moveTo(x - h, y - h); c.lineTo(x + h, y - h); c.lineTo(x - h, y + h); c.closePath(); paint(c, o); } },
  { id: 'nested', name: 'NESTED', draw(c, x, y, s, o) { const h = s / 2; c.lineWidth = Math.max(1, s * 0.1); c.strokeRect(x - h + c.lineWidth / 2, y - h + c.lineWidth / 2, s - c.lineWidth, s - c.lineWidth); c.fillRect(x - s * 0.18, y - s * 0.18, s * 0.36, s * 0.36); } },
  { id: 'cluster', name: 'PIXEL CLUSTER', draw(c, x, y, s, o) { const q = s / 4; const ph = ((o.phase || 0) * 7) | 0; for (let k = 0; k < 16; k++) if (((k * 7 + ph) % 5) < 2 || k === 5 || k === 10) c.fillRect(x - s / 2 + (k % 4) * q, y - s / 2 + ((k / 4) | 0) * q, q * 0.9, q * 0.9); } },
  { id: 'starburst', name: 'STARBURST', strokeOnly: true, draw(c, x, y, s, o) { c.lineWidth = Math.max(1, s * 0.1); c.beginPath(); for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; const r0 = k % 2 ? s * 0.12 : 0; c.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0); c.lineTo(x + Math.cos(a) * s * (k % 2 ? 0.34 : 0.5), y + Math.sin(a) * s * (k % 2 ? 0.34 : 0.5)); } c.stroke(); } },
  { id: 'arrow', name: 'ARROW', draw(c, x, y, s, o) { const h = s / 2; c.beginPath(); c.moveTo(x + h, y); c.lineTo(x - h * 0.1, y - h * 0.8); c.lineTo(x - h * 0.1, y - h * 0.3); c.lineTo(x - h, y - h * 0.3); c.lineTo(x - h, y + h * 0.3); c.lineTo(x - h * 0.1, y + h * 0.3); c.lineTo(x - h * 0.1, y + h * 0.8); c.closePath(); paint(c, o); } },
  { id: 'line', name: 'LINE', strokeOnly: true, draw(c, x, y, s, o) { c.lineWidth = lw(s, o); c.beginPath(); c.moveTo(x - s / 2, y + s / 2); c.lineTo(x + s / 2, y - s / 2); c.stroke(); } },
  { id: 'particle', name: 'PARTICLE', fast: true, draw(c, x, y, s) { const h = Math.max(1, s * 0.22); c.fillRect(x - h / 2, y - h / 2, h, h); } },
  { id: 'hollow', name: 'HOLLOW SQUARE', strokeOnly: true, draw(c, x, y, s, o) { c.lineWidth = lw(s, o); const h = s / 2 - c.lineWidth / 2; c.strokeRect(x - h, y - h, h * 2, h * 2); } },
  { id: 'stripes', name: 'STRIPES', draw(c, x, y, s) { const n = 3; const w = s / (n * 2); for (let k = 0; k < n; k++) c.fillRect(x - s / 2 + k * w * 2 + w / 2, y - s / 2, w, s); } },
  { id: 'polygon', name: 'POLYGON', draw(c, x, y, s, o) { const n = 3 + (Math.abs(((o.phase || 0) * 1.7) | 0) % 5); const r = s / 2; c.beginPath(); for (let k = 0; k < n; k++) { const a = (k / n) * TAU - Math.PI / 2; const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; if (k) c.lineTo(px, py); else c.moveTo(px, py); } c.closePath(); paint(c, o); } },
];
