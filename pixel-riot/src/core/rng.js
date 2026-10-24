// Seedable PRNG (mulberry32) plus weighted-choice helpers used by the randomizer
// and by effects that want reproducible variation.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed = (Math.random() * 2 ** 32) >>> 0) { this.reseed(seed); }
  reseed(seed) { this.seed = seed >>> 0; this._r = mulberry32(this.seed); }
  next() { return this._r(); }
  range(a, b) { return a + (b - a) * this._r(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  chance(p) { return this._r() < p; }
  pick(arr) { return arr[Math.floor(this._r() * arr.length)]; }
  // items: [{ value, weight }] or [[value, weight]]
  weighted(items) {
    const norm = items.map((it) => (Array.isArray(it) ? { value: it[0], weight: it[1] } : it));
    const total = norm.reduce((s, it) => s + Math.max(0, it.weight), 0);
    let r = this._r() * total;
    for (const it of norm) { r -= Math.max(0, it.weight); if (r <= 0) return it.value; }
    return norm[norm.length - 1].value;
  }
  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this._r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
