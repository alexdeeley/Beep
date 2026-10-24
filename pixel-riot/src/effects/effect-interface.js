// Visual effect contract (API 1.x).
//
//   {
//     id: 'acme.my-effect',            // unique
//     name: 'MY EFFECT', description: '...',
//     kind: 'local' | 'global',        // global = ambient/persistent scene effect (bounded count)
//     life: 1.2,                       // default lifetime in seconds (local effects; capped at
//                                      // LIMITS.maxEffectLifetime). Global effects live until cancelled.
//     priority: 0,                     // -10..10; higher survives eviction & wins colour overrides
//     maxInstances: 24,                // per-effect cap; oldest is cancelled when exceeded
//     defaults: { radius: 4 },         // params; merged with mapping/preset params
//     schema: { radius: { type: 'number', min: 1, max: 20 } },  // for UI/validation (optional)
//
//     spawn(inst, ctx)                 // REQUIRED. one-time setup. inst.state is yours.
//     update(inst, dt, ctx) -> bool?   // REQUIRED. write modulations; return false to end early
//     draw?(inst, g, ctx)              // optional overlay drawing (g = renderer OverlayAPI)
//     retrigger?(inst, params, ctx)    // optional: keyed instance received new params
//     cancel?(inst, ctx)               // optional cleanup when cancelled/expired
//   }
//
// inst = { uid, effectId, owner, key, params, age, life, t (0..1 progress), priority,
//          x, y (normalized origin), fx, fy (fractional cell), gx, gy, event, intensity, state }
//
// ctx (EffectContext) = {
//   grid, energy, comp, particles, palettes, shapes, clock, rng,
//   space: { forRadius, forRing, forLine, forNeighbors, mirrorPoints },
//   chain,                              // chain-reaction service (chain-reaction.js)
//   spawn(effectId, params, opts),      // spawn a secondary effect
//   emit(type, payload),                // publish on the event bus
//   look: { symmetry, ... },            // current instrument look (read-only)
//   a11y: { reducedMotion, reducedFlash },
//   intensity                           // global intensity 0.1..1.5
// }
//
// Effects must: be bounded in time (or kind:'global'), never allocate per cell per frame,
// write only through ctx.comp / ctx.grid / ctx.energy / ctx.particles, and never touch the
// DOM, audio or input.

import { need } from '../core/registry.js';

export function validateEffect(d) {
  const e = [];
  need.fn(d, 'spawn', e); need.fn(d, 'update', e);
  need.optFn(d, 'draw', e); need.optFn(d, 'retrigger', e); need.optFn(d, 'cancel', e);
  if (d.kind !== undefined && d.kind !== 'local' && d.kind !== 'global') e.push('kind must be "local" or "global"');
  if (d.life !== undefined && !(d.life > 0)) e.push('life must be > 0');
  if (d.defaults !== undefined && (typeof d.defaults !== 'object' || d.defaults === null)) e.push('defaults must be an object');
  return e;
}
