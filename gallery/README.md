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
mazes and halls whose walls are hung with the same generated art.

**There is exactly one museum, and it is the same for everyone.** It is built
from a single fixed seed (`MUSEUM_SEED` in `world.js`); nothing about it
depends on who you are, when you visit, or a random number. Every wall, door,
painting and title is a pure function of position, so any spot is always
exactly as it was, for everyone, on any device. And it never ends: go far
enough in any direction and you are somewhere nobody has been. What *is* yours
is where you are - the address bar carries it (`museum.html#x,z,turn`), so a
strange corner you find can be sent to anyone, who lands in exactly that spot.
`dev/world-tests.mjs` holds fingerprints of the real museum's floor plan and
art (near and very far from the start) and fails if a code change would
reshuffle it. Change them only on purpose: doing so re-rolls the museum for
everybody.

- **Walk:** W A S D / arrows, Shift to run, mouse to look (click to start).
  On a phone: drag the left half to walk, the right half to look.
  **E** (or tap the label) opens the picture you are facing in the gallery.
  **M** map, **Q** chunky / sharp look, **Esc** menu (copy a link to where you
  are, or go back to the entrance).
- **The floor plan is a function of position** (`js/museum/world.js`, pure and
  tested in Node; it uses only integer hashing and plain arithmetic, so every
  browser computes the identical plan). Blocks make cells of 4x4 (3x3 of floor), cells make regions
  of 10x10, and each region is one of four kinds - a **maze** of art walls, a run
  of **rooms**, a big open **hall** with columns and free-standing walls, or a
  long **winding** gallery. A region only decides which of its cell walls are
  open; wall blocks, pillars and paintings follow from that. Every region is
  connected inside and every region border has a doorway, so everywhere is
  reachable, forever, with no map stored. The home hall has a wall ahead of you
  carrying the museum's own piece.
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
  finished state. A painting's seed is `${MUSEUM_SEED}|${cell}:${wall}${side}` - the same seed you can type into the gallery page to see it large.
- **Streaming** (`main.js`): the 3x3 regions around you are built (one a frame)
  and the rest dropped as you walk, and paintings come and go with distance.
- Three.js is vendored in `js/vendor/` (no CDN, no build step).

### Ideas for later

**Path-dependent places.** The museum is the same for everyone, but one way to
make where you end up depend on how you got there - while staying identical for
everyone who takes the same route - is doorways whose destination hashes the
sequence of doors you have gone through (a deterministic, non-Euclidean
museum), so only that exact route reaches that permutation. Not built yet.

Rooms with their own themes of art (all one style, or a retrospective of one
seed's neighbours), plazas with sculptures built from the voxel shapes, stairs
and upper floors, sound that changes by region, and a visitors' book for strange places people
have found.

## Notes

- In the gallery page seeds are case-sensitive and extra spaces are ignored (`normalizeSeed`); everyone who arrives without a link starts on the same piece, "the museum".
- `prefers-reduced-motion` shows the finished, still picture.
- Keep randomness inside `makeRng`/`fork` and never use `Math.random()` in
  `public/js/art/` - that would break "same seed, same art". (The page itself
  uses it once, only to suggest a random seed.)
