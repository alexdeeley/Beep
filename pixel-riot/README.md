# PIXEL RIOT

A modular, multitouch generative art and sound instrument for the browser. The whole
screen is a logical grid of cells; every touch, drag, hold, twist and multi-finger gesture
fires several visual effects and procedural sounds at once. No accounts, no server logic,
no dependencies.

To rename it, change `APP_NAME` in `src/config.js` (title, UI label and storage keys follow).

## Run it

ES modules cannot load from `file://`, so serve the folder over HTTP:

```bash
npm start            # node serve.mjs 8080  ->  http://localhost:8080
npm run start:lan    # also prints a LAN address for an iPhone/iPad on the same Wi-Fi
```

Any static server works (`python3 -m http.server`, GitHub Pages, Cloudflare Pages…). Node 18+
is only needed for the bundled server and the tests. After the first online visit a service
worker caches the app so it keeps working offline. Add `?nosw` to the URL to skip it while
developing.

## Play

Touch anywhere. The canvas is the instrument; the UI dims while you play.

| Gesture | Default (RIOT effect set) |
|---|---|
| Tap | burst + click + ripple (sound fires on touch-down, no delay) |
| Double tap | cell explosion + chain reaction + percussive burst |
| Drag | energy trail + persistent ink + plucked notes (pitch from x, tone from y) |
| Fast swipe | directional sweep + pitch glide + colour cascade that repaints cells |
| Reverse a drag | reversed wave + glitch + falling sweep |
| Draw a circle | spiral + grain cloud |
| Hold | energy charges with a rising tone; lift to release a shockwave |
| Two-finger spread | radial expansion + chord |
| Two-finger pinch in | infinite corridor |
| Two-finger twist | rotating block matrix + pitch bend |
| Three+ fingers | symmetry explosion |
| Steady taps | rhythm: scanners, harmonic grid pulse; sets tempo in musical mode |
| Zigzag (example extension) | glitch storm, in every effect set |

Every pointer runs its own chain, so five fingers can do five different things at once.

### Controls

Top: **PAUSE/PLAY** (freezes ambient animation; your gestures still play), **UNDO**,
**CLEAR** (artwork, undoable), **SOUND ON/OFF**, **MENU**.
Bottom (one tap each): **PALETTE**, **PATTERN**, **EFFECT** (effect set), **RANDOM**,
**SAVE**; plus tempo −/+/TAP when musical mode is on.

MENU opens a bottom sheet: PLAY (intensity, trails, effect set, symmetry) · PRESETS ·
LOOK (palette, two pattern layers + blend, shapes, block size, hue, spin) · RANDOMIZE
(4 strengths + locks) · CHAIN REACTIONS · SOUND & MUSIC (volume, space, musical mode,
tempo + tap tempo, quantize, subdivision, scale, root, free pitch, gesture looper) · GRID &
PERFORMANCE · ACCESSIBILITY · SAVE & DATA · EXTENSIONS · HOW TO PLAY, plus panels added by
extensions.

Keyboard: `M` menu, `P`/Space pause, `U` or Ctrl/Cmd+Z undo, `R` randomize, `E` next effect
set, `C` next palette, `S` sound.

### Saving

- The current instrument, your settings and the artwork (painted cells) are saved
  automatically in the browser and restored next visit.
- **SAVE** (or PRESETS > SAVE CURRENT) stores the instrument as a named preset. Presets
  can be renamed, copied, deleted, exported and imported as JSON.
- SAVE & DATA: **SNAPSHOT PNG**, **EXPORT/IMPORT COMPOSITION** (instrument + artwork JSON).
- CLEAR ARTWORK, RESET SIMULATION and RESTORE DEFAULT SETTINGS are separate and never
  touch each other's data. Built-in presets cannot be deleted.

## Extend it

Read `ARCHITECTURE.md`, then `EXTENSION_GUIDE.md`. AI assistants must follow
`LLM_EXTENSION_PROTOCOL.md`. Every extension point is marked in the code with an
`EXTENSION ZONE` comment and has a working example in `src/extensions/examples/`.

## Test it

```bash
npm test               # 70 Node tests (core, input, effects, audio, integration, extensions)
npm run test:browser   # headless Chromium smoke test with real mouse + multitouch events
```

See `TESTING.md` for what is automated and the manual device checklist.

## Files

```
index.html  styles.css  sw.js  manifest.webmanifest  serve.mjs  package.json
src/main.js            browser entry
src/app.js             service wiring + frame loop (no feature logic)
src/config.js          name, API version, resolutions, hard limits
src/core/              event bus, registry, plugin manager, public API, clock, settings, storage, history, perf
src/input/             pointer manager, gesture recognizer host, built-in recognizers, coordinate mapping
src/grid/              typed-array cell grid, energy field, spatial queries
src/rendering/         renderer contract, Canvas 2D renderer, compositor, shapes, particles
src/effects/           effect contract, scheduler, chain reactions, 22 built-in effects
src/patterns/          pattern engine + 17 patterns
src/color/             palette engine + 13 palettes
src/audio/             audio engine, voices, 20 generators, 18 sounds, 9 mappings, music helpers
src/interaction/       router (gesture -> actions), effect-set profiles, gesture looper
src/presets/           preset schema/validation, 15 presets, manager, randomizer
src/ui/                controls, panels, widgets, accessibility
src/extensions/        manifest schema, extension list, 14 example extensions
src/tests/             Node tests + browser smoke test
```
