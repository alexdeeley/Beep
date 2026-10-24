// Allocation-free spatial iteration over a GridModel.

// Calls fn(i, gx, gy, dist) for every cell whose centre is within `r` cells of (cx, cy).
// cx/cy may be fractional. Returns the number of cells visited.
export function forRadius(grid, cx, cy, r, fn) {
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(grid.cols - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(grid.rows - 1, Math.ceil(cy + r));
  const r2 = r * r; let n = 0;
  for (let gy = y0; gy <= y1; gy++) {
    const dy = gy + 0.5 - cy;
    for (let gx = x0; gx <= x1; gx++) {
      const dx = gx + 0.5 - cx;
      const d2 = dx * dx + dy * dy;
      if (d2 <= r2) { fn(gy * grid.cols + gx, gx, gy, Math.sqrt(d2)); n++; }
    }
  }
  return n;
}

// Cells on a ring band [r - w/2, r + w/2] around (cx, cy).
export function forRing(grid, cx, cy, r, w, fn) {
  const outer = r + w / 2, inner = Math.max(0, r - w / 2);
  const in2 = inner * inner;
  return forRadius(grid, cx, cy, outer, (i, gx, gy, d) => { if (d * d >= in2) fn(i, gx, gy, d); });
}

// Bresenham line between grid cells; calls fn(i, gx, gy, step). Skips the start cell if skipFirst.
export function forLine(grid, x0, y0, x1, y1, fn, skipFirst = false) {
  x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, step = 0, guard = 0;
  for (;;) {
    if (!(skipFirst && step === 0) && grid.inBounds(x0, y0)) fn(y0 * grid.cols + x0, x0, y0, step);
    if (x0 === x1 && y0 === y1) break;
    if (guard++ > 4096) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
    step++;
  }
}

// 4- or 8-connected neighbours.
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const N8 = [...N4, [1, 1], [-1, 1], [1, -1], [-1, -1]];
export function forNeighbors(grid, gx, gy, fn, eight = true) {
  for (const [dx, dy] of eight ? N8 : N4) {
    const x = gx + dx, y = gy + dy;
    if (x >= 0 && y >= 0 && x < grid.cols && y < grid.rows) fn(y * grid.cols + x, x, y, dx, dy);
  }
}

// Mirror positions for symmetry: returns array of [gx, gy] (unique) for mode
// 'none' | 'h' | 'v' | 'quad' | 'radial4' | 'radial8'.
export function mirrorPoints(grid, gx, gy, mode) {
  const W = grid.cols - 1, H = grid.rows - 1;
  const pts = [[gx, gy]];
  if (mode === 'h' || mode === 'quad' || mode === 'radial4' || mode === 'radial8') pts.push([W - gx, gy]);
  if (mode === 'v' || mode === 'quad' || mode === 'radial4' || mode === 'radial8') pts.push([gx, H - gy]);
  if (mode === 'quad' || mode === 'radial4' || mode === 'radial8') pts.push([W - gx, H - gy]);
  if (mode === 'radial8') {
    // Rotate 90° about the centre in normalized space.
    const cx = W / 2, cy = H / 2;
    const ax = (gx - cx) / (W / 2 || 1), ay = (gy - cy) / (H / 2 || 1);
    for (const [rx, ry] of [[-ay, ax], [ay, -ax], [-ay, -ax], [ay, ax]]) {
      pts.push([Math.round(cx + rx * W / 2), Math.round(cy + ry * H / 2)]);
    }
  }
  const seen = new Set(); const out = [];
  for (const [x, y] of pts) {
    if (x < 0 || y < 0 || x > W || y > H) continue;
    const k = y * grid.cols + x;
    if (!seen.has(k)) { seen.add(k); out.push([x, y]); }
  }
  return out;
}
