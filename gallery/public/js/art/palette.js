// Colour for a piece: a mood (how bright/saturated/dark), a hue scheme (how
// the hues relate), and a background to sit on.

const SCHEMES = {
  analogous:     [0, 22, 44, -22, -44],
  complementary: [0, 14, 180, 194, 166],
  triad:         [0, 120, 240, 22, 142],
  split:         [0, 150, 210, 22, 172],
  tetrad:        [0, 90, 180, 270, 45],
};

// s = saturation %, l = lightness % ranges for the colours;
// bg = the background's lightness (dark / light), picked per piece.
const MOODS = {
  vivid:  { s: [72, 96], l: [46, 62], bg: { dark: [7, 14], light: [93, 97] }, dark: 0.55 },
  pastel: { s: [42, 72], l: [72, 88], bg: { dark: [16, 24], light: [94, 98] }, dark: 0.18 },
  dusk:   { s: [45, 78], l: [34, 62], bg: { dark: [8, 15], light: [90, 95] }, dark: 0.9 },
  earth:  { s: [26, 52], l: [30, 66], bg: { dark: [9, 15], light: [88, 94] }, dark: 0.35 },
  neon:   { s: [96, 100], l: [54, 66], bg: { dark: [3, 8], light: [3, 8] }, dark: 1 },
  mono:   { s: [14, 60], l: [22, 86], bg: { dark: [8, 14], light: [92, 97] }, dark: 0.5 },
  ink:    { s: [0, 6], l: [8, 70], bg: { dark: [8, 12], light: [93, 97] }, dark: 0.2, accent: true },
};

const MOOD_ODDS = [['vivid', 3], ['pastel', 2], ['dusk', 2], ['earth', 2], ['neon', 2], ['mono', 1.5], ['ink', 1]];

const hsl = (h, s, l, a = 1) =>
  `hsl(${(((h % 360) + 360) % 360).toFixed(1)} ${s.toFixed(1)}% ${l.toFixed(1)}%${a < 1 ? ` / ${a.toFixed(3)}` : ''})`;

export function makePalette(rng) {
  const mood = rng.weighted(MOOD_ODDS);
  const M = MOODS[mood];
  const schemeName = mood === 'mono' ? 'analogous' : rng.pick(Object.keys(SCHEMES));
  const h0 = rng.float() * 360;
  // Dusk lives in the warm-to-violet half of the wheel.
  const baseHue = mood === 'dusk' ? 250 + rng.float() * 140 : mood === 'earth' ? 10 + rng.float() * 40 : h0;
  const offsets = SCHEMES[schemeName];
  const dark = rng.chance(M.dark);

  const list = [];
  const n = 6;
  for (let i = 0; i < n; i++) {
    let h = baseHue + (mood === 'mono' ? rng.soft() * 14 : offsets[i % offsets.length] + rng.soft() * 10);
    if (mood === 'earth' && i % 3 === 2) h = 90 + rng.float() * 50; // a leafy green among the clays
    let s = rng.range(M.s[0], M.s[1]);
    // Spread the lightness across the palette so it always has darks and lights.
    let l = M.l[0] + ((i * 0.618 + rng.float() * 0.25) % 1) * (M.l[1] - M.l[0]);
    if (mood === 'ink') { s = 4; h = 40; if (i === n - 1) { s = 85; l = 48; h = rng.pick([6, 14, 350]); } }
    list.push({ h, s, l });
  }

  const bgRange = dark ? M.bg.dark : M.bg.light;
  const bgL = rng.range(bgRange[0], bgRange[1]);
  const bgH = baseHue + rng.soft() * 20, bgS = mood === 'ink' ? 6 : rng.range(10, 45) * (dark ? 1 : 0.5);
  const bg = hsl(bgH, bgS, bgL);
  const bg2 = hsl(bgH + rng.soft() * 30, bgS, dark ? bgL + rng.range(4, 12) : bgL - rng.range(3, 8));
  const inkL = dark ? 92 : 10;

  return {
    mood, scheme: schemeName, dark, hue: ((baseHue % 360) + 360) % 360,
    list,
    bg, bg2,
    // colour i (wraps around), optionally see-through
    c: (i, a = 1) => { const k = list[((i % n) + n) % n]; return hsl(k.h, k.s, k.l, a); },
    ink: (a = 1) => hsl(bgH, 12, inkL, a),
    // a colour between two palette entries
    mix: (i, j, t, a = 1) => {
      const p = list[((i % n) + n) % n], q = list[((j % n) + n) % n];
      let dh = ((q.h - p.h + 540) % 360) - 180;
      return hsl(p.h + dh * t, p.s + (q.s - p.s) * t, p.l + (q.l - p.l) * t, a);
    },
    n,
  };
}
