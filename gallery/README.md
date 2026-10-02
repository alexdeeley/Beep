# Gallery

Type a seed, get a piece of generative art. The same seed always makes the same
art - on any device, any day - so a seed is a shareable address for a picture
(`gallery.deeley.org/#velvet orchard 12`).

It is a small static site: no server, no accounts, no dependencies.

```
npm run dev            # http://localhost:8788
npm test               # generator checks (Node, no browser)
npm run test:browser   # the page in a real browser (needs Playwright + Chromium)
node dev/sheet.mjs     # a contact sheet of every style, to look at
npm run deploy         # wrangler: static assets on gallery.deeley.org
```

## How a piece is made

`createPiece(seed)` (in `public/js/art/index.js`) is the whole generator:

```js
const piece = createPiece('my seed');
piece.title      // "Violet Meander"
piece.medium     // "Flow field"
piece.aspect     // width / height - each piece has its own shape
piece.draw(ctx, widthPx, heightPx, seconds);   // paint it, `seconds` into its life
```

From the seed it chooses a **style** (ten so far), a **shape**, a **palette**
(a mood - vivid, pastel, dusk, earth, neon, mono, ink - plus a hue scheme and
a background) and a **title**, then the style's own parameters. Every choice
uses its own stream of random numbers (`fork(seed, 'palette')`, ...), so
changing how one part works never reshuffles another.

The art is **dynamic**: `draw` is a function of time. Flow fields paint
themselves in over ten seconds and then shimmer, rings turn, tiles flip a
quarter turn, soft light drifts, ridges scroll. `draw(..., t)` for large `t`
is the finished picture, which is what Save exports.

Styles (`public/js/art/styles/`): flow field, orbital rings, tiled geometry,
soft light, point network, layered ridges, radial symmetry, Truchet arcs,
ridgeline, spirograph. A style is `{ id, medium, words, aspects?, make }`
where `make({ rng, pal, noise, A })` does its random choices once and returns
`(ctx, A, t) => void`, drawing in "unit height" space (the canvas is `A` wide
and 1 tall, whatever its pixel size). Adding a style = one file plus one line
in `index.js`.

## Toward the museum

The plan is an endless voxel walkthrough museum, with this generator as the
art. Nothing here needs to change to get there - `createPiece` touches only the
canvas it is handed, so it can paint a texture as easily as a web page:

- **The world is a function of a seed too.** A museum seed picks everything:
  the layout of a region (rooms, turns, big open halls, labyrinths of walls) is
  derived from hashes of grid coordinates (`hash01(x, y, salt)` in `rng.js` is
  made for this), so any place can be generated on demand with no map stored,
  and the museum is infinite and the same for everyone.
- **Every wall slot is a seed.** `createPiece(`${worldSeed}:${x},${z}:${slot}`)`
  gives that spot's artwork; pieces are drawn to textures when you come near
  and dropped when you leave. A piece's `aspect` says which frame fits it.
- **Voxel look.** The same piece can be drawn at, say, 48 px high and shown
  with nearest-neighbour sampling, or turned into a relief of cubes - the draw
  function doesn't care how big the canvas is.
- **Dynamic.** Pieces keep animating when `t` is advanced per frame, so the
  walls of the museum are alive; distant ones can be frozen at their finished
  state to save time.
- **Tech.** Three.js (instanced boxes for the walls, a canvas texture per
  frame) in a module next to `public/js/art/`, reusing it unchanged.

## Notes

- Seeds are case-sensitive; extra spaces are ignored (`normalizeSeed`).
- `prefers-reduced-motion` shows the finished, still picture.
- Keep randomness inside `makeRng`/`fork` and never use `Math.random()` in
  `public/js/art/` - that would break "same seed, same art". (The page itself
  uses it once, only to suggest a random seed.)
