// EXAMPLE EXTENSION — a new geometric shape. No renderer change is needed: once
// registered, 'ex.hexagon' can be listed in any preset's `shapes` or picked in LOOK > SHAPES.

export default {
  manifest: { id: 'ex.hexagon', name: 'Hexagon Shape (example)', version: '1.0.0', type: 'shape', apiVersion: '1.0.0', description: 'Adds a hexagon shape.', dependencies: ['core.shapes'] },
  register(api) {
    // ============================================================
    // EXTENSION ZONE: GEOMETRIC SHAPES (example)
    // PURPOSE: Register additional cell shapes.
    // CONTRACT: src/rendering/shape-registry.js — draw(c, x, y, s, o) builds a path centred at
    //           (x, y) of size s and fills (or strokes when o.stroke). Never set colours.
    // SAFETY: No allocation-heavy work; draw is called for thousands of cells per frame.
    // INTEGRATION: api.shapes.register(def)
    // ============================================================
    api.shapes.register({
      id: 'ex.hexagon', name: 'HEXAGON',
      draw(c, x, y, s, o) {
        const r = s / 2; c.beginPath();
        for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + Math.PI / 6; const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; if (k) c.lineTo(px, py); else c.moveTo(px, py); }
        c.closePath();
        if (o.stroke) { c.lineWidth = Math.max(1, o.lineWidth || s * 0.14); c.stroke(); } else c.fill();
      },
    });
  },
};
