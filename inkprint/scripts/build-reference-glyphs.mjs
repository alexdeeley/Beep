// Builds src/data/reference-glyphs.json: the faint "ghost" shapes shown behind
// the drawing canvas. They come from Inter Regular (SIL Open Font License,
// https://rsms.me/inter), scaled so its cap height matches Inkprint's default
// cap height of 700 units, baseline at 0, y up.
//
// The ghosts are only a drawing guide: they are never copied into the user's
// font. Characters outside this file fall back to the system font on screen.
//
//   node scripts/build-reference-glyphs.mjs [path/to/Inter-Regular.otf]
import { readFileSync, writeFileSync } from 'node:fs';
import opentype from 'opentype.js';

const src = process.argv[2] ?? '/usr/share/fonts/opentype/inter/Inter-Regular.otf';
const buf = readFileSync(src);
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const CAP = 700;
const scale = CAP / font.tables.os2.sCapHeight;

const ranges = [
  [0x21, 0x7e], [0xa1, 0x17f], [0x2010, 0x2027], [0x2030, 0x203a], [0x20ac, 0x20ac], [0x2122, 0x2122],
];
const r = (n) => Math.round(n * scale);
const glyphs = {};
for (const [a, b] of ranges) {
  for (let cp = a; cp <= b; cp++) {
    const ch = String.fromCodePoint(cp);
    const g = font.charToGlyph(ch);
    if (!g || g.index === 0) continue;
    let d = '';
    for (const c of g.path.commands) {
      if (c.type === 'M' || c.type === 'L') d += `${c.type}${r(c.x)} ${r(c.y)}`;
      else if (c.type === 'Q') d += `Q${r(c.x1)} ${r(c.y1)} ${r(c.x)} ${r(c.y)}`;
      else if (c.type === 'C') d += `C${r(c.x1)} ${r(c.y1)} ${r(c.x2)} ${r(c.y2)} ${r(c.x)} ${r(c.y)}`;
      else if (c.type === 'Z') d += 'Z';
    }
    if (!d) continue;
    const bb = g.getBoundingBox();
    glyphs[ch] = { d, w: r(g.advanceWidth), b: [r(bb.x1), r(bb.y1), r(bb.x2), r(bb.y2)] };
  }
}
const out = {
  source: 'Inter Regular (SIL Open Font License 1.1), outlines scaled to cap height 700; guide only, never exported',
  capHeight: CAP,
  glyphs,
};
writeFileSync(new URL('../src/data/reference-glyphs.json', import.meta.url), JSON.stringify(out));
console.log(`${Object.keys(glyphs).length} reference glyphs written`);
