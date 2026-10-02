// Seeded randomness. The same seed text gives the same numbers on every
// device, forever - everything the gallery draws hangs off this.

// Turns any string into a stream of 32-bit integers (xmur3).
function hasher(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

// Seeds are compared as typed, apart from surrounding / repeated spaces.
export function normalizeSeed(text) {
  return String(text ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
}

// A small, fast generator (sfc32) with the helpers art code actually wants.
export function makeRng(seed) {
  const next = hasher(normalizeSeed(seed));
  let a = next(), b = next(), c = next(), d = next();
  const float = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) float(); // let the seed settle in
  const rng = {
    float,
    range: (lo, hi) => lo + float() * (hi - lo),
    int: (lo, hi) => lo + Math.floor(float() * (hi - lo + 1)),   // inclusive
    chance: (p) => float() < p,
    pick: (list) => list[Math.floor(float() * list.length)],
    sign: () => (float() < 0.5 ? -1 : 1),
    // Roughly bell-shaped, in -1..1.
    soft: () => (float() + float() + float() - 1.5) / 1.5,
    // One of several things, some likelier than others: [[item, weight], ...]
    weighted(pairs) {
      let total = 0;
      for (const [, w] of pairs) total += w;
      let r = float() * total;
      for (const [item, w] of pairs) { r -= w; if (r <= 0) return item; }
      return pairs[pairs.length - 1][0];
    },
    shuffle(list) {
      const a2 = list.slice();
      for (let i = a2.length - 1; i > 0; i--) {
        const j = Math.floor(float() * (i + 1));
        [a2[i], a2[j]] = [a2[j], a2[i]];
      }
      return a2;
    },
  };
  return rng;
}

// An independent stream derived from a seed and a label, so adding a new
// random choice to one part of a piece never shifts another part.
export const fork = (seed, label) => makeRng(normalizeSeed(seed) + '\u0000' + label);

// Cheap deterministic hash of a few integers to 0..1 (for per-cell choices).
export function hash01(a, b = 0, c = 0) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
