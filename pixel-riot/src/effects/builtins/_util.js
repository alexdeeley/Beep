// Small helpers shared by the built-in effects (not part of the public API contract,
// but extensions may import them).

export const TAU = Math.PI * 2;
export const ease = {
  out: (t) => 1 - (1 - t) * (1 - t),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  // Damped spring settling from 1 to 0 with overshoot.
  spring: (t, k = 9, z = 0.32) => Math.exp(-z * k * t) * Math.cos(k * t),
  bell: (t) => Math.sin(Math.PI * Math.min(1, Math.max(0, t))),
};

// Palette position for a gesture at (x, y): drifts with time so the instrument evolves.
export function brushT(ctx, inst) {
  if (inst.params.t != null) return inst.params.t;
  return inst.x * 0.35 + inst.y * 0.12 + ctx.clock.time * 0.012;
}

// Unit direction of the triggering gesture (falls back to params.angle or right).
export function gestureDir(inst) {
  const e = inst.event;
  let a = inst.params.angle;
  if (a == null && e && e.speed > 0.05) a = e.direction;
  if (a == null) a = 0;
  if (inst.params.reverse) a += Math.PI;
  return [Math.cos(a), Math.sin(a), a];
}

export const flashK = (ctx) => (ctx.a11y.reducedFlash ? 0.3 : 1);
export const motionK = (ctx) => (ctx.a11y.reducedMotion ? 0.35 : 1);
