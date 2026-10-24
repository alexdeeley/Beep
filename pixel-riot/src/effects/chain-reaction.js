// Chain-reaction framework: bounded, scheduled neighbour activation.
//
//   chain.start({ gx, gy, level = 1, params, onActivate(gx, gy, level, depth, chain), onStage(stage) })
//
// params (all optional; defaults come from the active instrument's `chain` section):
//   radius       neighbour radius in cells (1 = 8-neighbourhood)       1..4
//   delay        seconds between stages                                 0.01..0.5
//   decay        level multiplier per stage                             0.3..0.98
//   maxDepth     stage limit (hard-capped by LIMITS.maxChainStages)     1..24
//   probability  base chance a neighbour activates                      0..1
//   bias         [dx, dy] preferred direction (unit vector or [0,0])
//   biasStrength 0..1 how strongly the direction is favoured
//   symmetry     'none' | 'h' | 'v' | 'quad' | 'radial4' | 'radial8' (mirror activations)
//   colorInherit 0..1 how much activated cells take the origin colour
//   soundInherit 0..1 chance each stage emits 'chain:stage' with sound=true
//
// No recursion: every stage is a clock job; each chain keeps a visited bitmap; global
// concurrency is capped (oldest chain is stopped) and so is the per-stage frontier.

import { LIMITS } from '../config.js';
import { mirrorPoints } from '../grid/spatial-query.js';

export const CHAIN_DEFAULTS = {
  radius: 1, delay: 0.06, decay: 0.82, maxDepth: 9, probability: 0.55,
  bias: [0, 0], biasStrength: 0, symmetry: 'none', colorInherit: 0.4, soundInherit: 0.35,
};

export class ChainReactions {
  constructor({ grid, clock, events, rng, getDefaults = () => CHAIN_DEFAULTS, maxChains = 14, maxFrontier = 220 }) {
    this.grid = grid; this.clock = clock; this.events = events; this.rng = rng;
    this.getDefaults = getDefaults;
    this.maxChains = maxChains; this.maxFrontier = maxFrontier;
    this.chains = [];
    this._id = 0;
    this.activations = 0;
  }

  get active() { return this.chains.length; }

  start(opts) {
    const g = this.grid;
    const p = { ...CHAIN_DEFAULTS, ...this.getDefaults(), ...(opts.params || {}) };
    p.maxDepth = Math.min(LIMITS.maxChainStages, Math.max(1, p.maxDepth | 0));
    while (this.chains.length >= this.maxChains) this.stop(this.chains[0]);
    const chain = {
      id: ++this._id, p, visited: new Uint8Array(g.count), cols: g.cols, rows: g.rows,
      depth: 0, level: opts.level ?? 1, onActivate: opts.onActivate, onStage: opts.onStage,
      origin: { gx: opts.gx | 0, gy: opts.gy | 0 }, job: null, stopped: false, owner: opts.owner || 'core',
      t0: opts.colorT ?? null,
    };
    const seeds = p.symmetry && p.symmetry !== 'none' ? mirrorPoints(g, chain.origin.gx, chain.origin.gy, p.symmetry) : [[chain.origin.gx, chain.origin.gy]];
    const frontier = [];
    for (const [x, y] of seeds) { const i = y * g.cols + x; if (!chain.visited[i]) { chain.visited[i] = 1; frontier.push(i); } }
    this.chains.push(chain);
    this._stage(chain, frontier);
    return chain;
  }

  stop(chain) {
    if (!chain || chain.stopped) return;
    chain.stopped = true;
    this.clock.cancel(chain.job);
    this.chains = this.chains.filter((c) => c !== chain);
  }
  stopAll() { for (const c of [...this.chains]) this.stop(c); }

  _stage(chain, frontier) {
    const g = this.grid;
    if (chain.stopped) return;
    if (g.cols !== chain.cols || g.rows !== chain.rows) { this.stop(chain); return; }  // grid resized
    const p = chain.p;
    // Activate this frontier.
    for (const i of frontier) {
      const gx = i % g.cols, gy = (i / g.cols) | 0;
      this.activations++;
      try { chain.onActivate?.(gx, gy, chain.level, chain.depth, chain); }
      catch (err) { this.events?.emit('app:error', { error: err, source: `chain onActivate (${chain.owner})` }); this.stop(chain); return; }
    }
    this.events?.emit('chain:stage', {
      chainId: chain.id, depth: chain.depth, count: frontier.length, level: chain.level,
      gx: chain.origin.gx, gy: chain.origin.gy, x: (chain.origin.gx + 0.5) / g.cols, y: (chain.origin.gy + 0.5) / g.rows,
      sound: this.rng.chance(p.soundInherit),
    });
    chain.onStage?.(chain.depth, frontier.length);
    chain.depth++;
    chain.level *= p.decay;
    if (chain.depth >= p.maxDepth || chain.level < 0.04 || !frontier.length) { this.stop(chain); return; }
    // Build next frontier.
    const next = [];
    const R = Math.max(1, Math.min(4, p.radius | 0));
    const [bx, by] = p.bias || [0, 0];
    const bm = Math.hypot(bx, by) || 1;
    for (const i of frontier) {
      const gx = i % g.cols, gy = (i / g.cols) | 0;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        if (!dx && !dy) continue;
        const x = gx + dx, y = gy + dy;
        if (x < 0 || y < 0 || x >= g.cols || y >= g.rows) continue;
        const j = y * g.cols + x;
        if (chain.visited[j]) continue;
        let prob = p.probability * (0.6 + 0.4 * chain.level) / Math.hypot(dx, dy);
        if (p.biasStrength > 0) prob *= 1 + p.biasStrength * 1.6 * ((dx * bx + dy * by) / (bm * Math.hypot(dx, dy)));
        if (this.rng.next() < prob) {
          chain.visited[j] = 1;
          next.push(j);
          if (next.length >= this.maxFrontier) break;
        }
      }
      if (next.length >= this.maxFrontier) break;
    }
    chain.job = this.clock.after(p.delay, () => this._stage(chain, next), chain.owner);
    if (!chain.job) this.stop(chain);   // scheduler saturated: stop gracefully
  }
}
