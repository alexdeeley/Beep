# Gallery

Type a seed, get a piece of generative art. The same seed always makes the same
art - on any device, any day - so a seed is a shareable address for a picture
(`gallery.deeley.org/#velvet orchard 12`).

It is a small static site: no server, no accounts, no dependencies.

```
npm run dev            # http://localhost:8788
npm test               # generator checks (Node, no browser)
npm run test:browser   # the pages in a real browser (needs Playwright + Chromium)
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

## The museum

`museum.html` is a first-person walk through an endless building of rooms,
mazes and halls whose walls are hung with the same generated art. Same museum
seed, same museum - the link carries it (`museum.html#my seed`).

- **Walk:** W A S D / arrows, Shift to run, mouse to look (click to start).
  On a phone: drag the left half to walk, the right half to look.
  **E** (or tap the label) opens the picture you are facing in the gallery.
  **M** map, **Q** chunky / sharp look, **Esc** menu (where you can change the
  museum seed).
- **The floor plan is a function of the seed** (`js/museum/world.js`, pure and
  tested in Node). Blocks make cells of 4x4 (3x3 of floor), cells make regions
  of 10x10, and each region is one of four kinds - a **maze** of art walls, a run
  of **rooms**, a big open **hall** with columns and free-standing walls, or a
  long **winding** gallery. A region only decides which of its cell walls are
  open; wall blocks, pillars and paintings follow from that. Every region is
  connected inside and every region border has a doorway, so everywhere is
  reachable, forever, with no map stored. The home hall has a wall ahead of you
  carrying your own seed's piece.
- **Voxel look** (`mesh.js`): each region is one mesh of unit cubes - walls
  stacked from blocks, checkered floors, ceiling lamps - flat-coloured with a
  little variation per block and with the lamps' light baked into the vertex
  colours, so drawing is cheap. The "chunky" look renders at ~500 px tall and
  scales up with hard pixels.
- **Paintings** (`paintings.js`) hang on both faces of every closed wall
  strip. Each is a flat panel until you are near; then it gets a small texture,
  and a big one up close, drawn by the same `createPiece(...).draw(...)` as the
  gallery page (frame and mat included). The nearest few in front of you are
  redrawn live, so the walls near you move; further ones are frozen at their
  finished state. A painting's seed is `${museumSeed}|${cell}:${wall}${side}`.
- **Streaming** (`main.js`): the 3x3 regions around you are built (one a frame)
  and the rest dropped as you walk, and paintings come and go with distance.
- Three.js is vendored in `js/vendor/` (no CDN, no build step).

### Ideas for later

Rooms with their own themes of art (all one style, or a retrospective of one
seed's neighbours), plazas with sculptures built from the voxel shapes, stairs
and upper floors, a name plate you can edit for your own corner, sound that
changes by region, and a way to hang a chosen seed on the home hall's walls.

## Notes

- Seeds are case-sensitive; extra spaces are ignored (`normalizeSeed`).
- `prefers-reduced-motion` shows the finished, still picture.
- Keep randomness inside `makeRng`/`fork` and never use `Math.random()` in
  `public/js/art/` - that would break "same seed, same art". (The page itself
  uses it once, only to suggest a random seed.)
