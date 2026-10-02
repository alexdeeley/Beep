// The generator. One function turns a seed into a Piece; a Piece knows its
// title, its shape and how to draw itself at any size and at any moment.
//
//   const piece = createPiece('my seed');
//   piece.draw(ctx, widthPx, heightPx, seconds);
//
// It touches nothing but the canvas it is given, so the same code can paint a
// framed picture on a web page now and a wall texture in a 3D museum later.

import { makeRng, fork, normalizeSeed } from './rng.js';
import { makeNoise } from './noise.js';
import { makePalette } from './palette.js';
import { makeTitle } from './names.js';
import flow from './styles/flow.js';
import rings from './styles/rings.js';
import bauhaus from './styles/bauhaus.js';
import blobs from './styles/blobs.js';
import constellation from './styles/constellation.js';
import landscape from './styles/landscape.js';
import kaleido from './styles/kaleido.js';
import truchet from './styles/truchet.js';
import ridges from './styles/ridges.js';
import spiro from './styles/spiro.js';

export const STYLES = [flow, rings, bauhaus, blobs, constellation, landscape, kaleido, truchet, ridges, spiro];
export { normalizeSeed };

// Width / height, and how likely, unless a style prefers its own.
const ASPECTS = [[1, 3], [4 / 3, 2.5], [3 / 4, 2], [3 / 2, 2.5], [2 / 3, 1.5], [5 / 4, 1.5], [16 / 9, 1]];

// How long a piece takes to finish "painting itself", in seconds.
export const SETTLE_SECONDS = 10;

let grainTile = null;
function grain() {
  if (grainTile || typeof document === 'undefined') return grainTile;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const img = g.createImageData(128, 128);
  const r = makeRng('grain');
  for (let i = 0; i < img.data.length; i += 4) {
    const v = r.float() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  grainTile = c;
  return c;
}

export function createPiece(seedText) {
  const seed = normalizeSeed(seedText);
  const pick = fork(seed, 'meta');
  const style = pick.pick(STYLES);
  const aspect = pick.weighted(style.aspects || ASPECTS);
  const pal = makePalette(fork(seed, 'palette'));
  const title = makeTitle(fork(seed, 'title'), pal, style.words);
  const number = 1000 + Math.floor(fork(seed, 'number').float() * 9000);
  // The style's own parameters (the costly part) are worked out the first time
  // the piece is drawn, so asking about a piece's title and shape stays cheap -
  // a museum can know about thousands of pieces and only paint the near ones.
  let paint = null;

  return {
    seed, title, number, aspect,
    style: style.id,
    medium: style.medium,
    mood: pal.mood,
    dark: pal.dark,
    // Paint the piece `t` seconds into its life onto a canvas context that is
    // w x h pixels. Pass the piece's own aspect (w / h ≈ piece.aspect).
    draw(ctx, w, h, t = 0) {
      ctx.save();
      ctx.scale(h, h);
      if (!paint) paint = style.make({ rng: fork(seed, 'style'), pal, noise: makeNoise(fork(seed, 'noise')), A: aspect });
      paint(ctx, w / h, t);
      ctx.restore();
      // A whisper of paper grain on top, in pixel space.
      const tile = grain();
      if (tile) {
        ctx.save();
        ctx.globalAlpha = pal.dark ? 0.07 : 0.05;
        ctx.globalCompositeOperation = 'overlay';
        ctx.fillStyle = ctx.createPattern(tile, 'repeat');
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }
    },
  };
}
