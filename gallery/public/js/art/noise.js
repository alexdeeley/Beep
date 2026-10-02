// Smooth 2D gradient noise (Perlin), shuffled by a seeded rng so every piece
// gets its own landscape of it.

export function makeNoise(rng) {
  const perm = new Uint8Array(512);
  const base = rng.shuffle(Array.from({ length: 256 }, (_, i) => i));
  for (let i = 0; i < 512; i++) perm[i] = base[i & 255];
  const ang = Array.from({ length: 256 }, () => rng.float() * Math.PI * 2);
  const gx = ang.map(Math.cos), gy = ang.map(Math.sin);
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

  // -1..1
  const noise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const g = (ix, iy, dx, dy) => {
      const h = perm[perm[(X + ix) & 255] + ((Y + iy) & 255)];
      return gx[h] * dx + gy[h] * dy;
    };
    const u = fade(xf), v = fade(yf);
    const a = g(0, 0, xf, yf), b = g(1, 0, xf - 1, yf);
    const c = g(0, 1, xf, yf - 1), d = g(1, 1, xf - 1, yf - 1);
    return (a + u * (b - a) + v * (c + u * (d - c) - (a + u * (b - a)))) * 1.4;
  };

  // Layered noise: big shapes plus finer and finer detail.
  noise.fbm = (x, y, octaves = 4, gain = 0.5) => {
    let sum = 0, amp = 1, norm = 0, f = 1;
    for (let i = 0; i < octaves; i++) {
      sum += noise(x * f, y * f) * amp;
      norm += amp; amp *= gain; f *= 2;
    }
    return sum / norm;
  };
  return noise;
}
