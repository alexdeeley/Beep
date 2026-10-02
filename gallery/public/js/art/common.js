// Small helpers shared by the styles. Every style draws in "unit height"
// space: the canvas is A wide and exactly 1 tall, whatever its pixel size.

export const TAU = Math.PI * 2;
export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);

// The two-colour wash every piece sits on.
export function background(ctx, A, pal, angle = Math.PI / 2) {
  const cx = A / 2, cy = 0.5, r = Math.hypot(A, 1) / 2;
  const dx = Math.cos(angle) * r, dy = Math.sin(angle) * r;
  const g = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  g.addColorStop(0, pal.bg);
  g.addColorStop(1, pal.bg2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, A, 1);
}

// A cell-by-cell animation: each cell sits still, then turns a quarter turn,
// at its own pace. Returns how many quarter turns it has made so far
// (fractional while it is mid-turn).
export function quarterTurns(t, phase, period) {
  const u = t / period + phase;
  const n = Math.floor(u);
  return n + smooth(0.8, 1, u - n);
}
