// A title for a piece, like a wall label: a colour word plus a word for what
// the piece does.

const HUES = [
  [0, 'Crimson'], [14, 'Vermilion'], [30, 'Amber'], [46, 'Gold'], [62, 'Citron'], [90, 'Lime'],
  [128, 'Jade'], [158, 'Viridian'], [184, 'Teal'], [204, 'Cerulean'], [226, 'Cobalt'],
  [250, 'Indigo'], [274, 'Violet'], [300, 'Orchid'], [328, 'Magenta'], [346, 'Rose'],
];
const GREYS = ['Ash', 'Slate', 'Ivory', 'Graphite', 'Bone', 'Pewter'];

export function colorWord(pal, rng) {
  if (pal.mood === 'ink') return rng.pick(GREYS);
  let name = HUES[0][1];
  for (const [h, n] of HUES) if (pal.hue >= h) name = n;
  return name;
}

export function makeTitle(rng, pal, styleWords) {
  const word = rng.pick(styleWords);
  const color = colorWord(pal, rng);
  return rng.chance(0.22) ? `The ${color} ${word}` : `${color} ${word}`;
}
