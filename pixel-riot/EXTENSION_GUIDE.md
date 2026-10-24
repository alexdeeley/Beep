# PIXEL RIOT — Extension Guide (API 1.x)

Extensions are plain ES modules that export a **plugin**: a manifest plus lifecycle
functions that receive a scoped `api`. Everything a plugin registers, subscribes to,
schedules or times is removed automatically when it is disabled, fails or is removed.
Every code sample below is taken from (or mirrors) a working example in
`src/extensions/examples/` and is covered by `src/tests/extensions.test.js`.

## 1. Rules of the road

**You may add:** `src/extensions/<your-name>/…` (preferred) or new files in
`src/extensions/examples/`, new tests in `src/tests/`, and one import + one array entry in
`src/extensions/registry.js`.

**Avoid modifying:** `src/app.js`, `src/core/*`, `src/input/pointer-manager.js`,
`src/input/gesture-recognizer.js`, `src/effects/effect-manager.js`,
`src/rendering/canvas-renderer.js`, `src/audio/audio-engine.js`,
`src/interaction/router.js`, `src/presets/preset-schema.js`. These are the stable core.
If you truly need a core change, follow §11 of `LLM_EXTENSION_PROTOCOL.md`.

**Do not** attach DOM/pointer listeners for input, touch another plugin's state, write to
`localStorage` directly, fetch remote code, or put feature logic in `app.js`.

## 2. Plugin skeleton

```js
// src/extensions/acme-sparkle/index.js
export default {
  manifest: {
    id: 'acme.sparkle',                 // unique; lowercase; use your own namespace
    name: 'Sparkle', version: '1.0.0',
    description: 'Adds a sparkle effect and maps it to long presses.',
    type: 'effect',                     // see EXTENSION_TYPES in manifest-schema.js
    apiVersion: '1.0.0',                // major must equal the app's API major
    dependencies: ['core.effects'],     // optional: plugins that must be active first
    defaults: { density: 12 },          // optional config defaults (merged with saved config)
    configSchema: { density: { type: 'number', min: 1, max: 40, default: 12, label: 'DENSITY' } },
    events: { subscribes: ['gesture:hold:release'], emits: [] },   // documentation
    capabilities: ['visual'], performance: { cost: 'low' },
  },
  register(api) { /* registry entries: api.effects.register(...), api.shapes.register(...) */ },
  init(api, config) { /* one-time setup with merged config */ },
  activate(api) { /* subscribe to events, start timers (api.timers / api.clock.after) */ },
  deactivate(api) { /* optional: the manager already removes subs/timers/registrations */ },
  dispose(api) { /* optional: release anything else */ },
};
```

Register it:

```js
// src/extensions/registry.js
import sparkle from './acme-sparkle/index.js';
export const EXTENSIONS = [ /* …existing… */, sparkle ];
```

Lifecycle: `register → init → activate → (respond to events) → deactivate → dispose`.
Any stage that throws marks the plugin **failed**, rolls back its registrations and is
shown in SETTINGS > EXTENSIONS. Five runtime errors (in your event handlers, effects,
recognizers or systems) quarantine it.

## 3. The public API (scoped per plugin)

| Service | Signatures |
|---|---|
| `api.meta` | `{ name, version, apiVersion, pluginId }` |
| `api.events` | `on(type, fn) → off`, `once`, `off`, `emit(type, payload)`; wildcard `'gesture:*'` |
| `api.clock` | `time`, `dt`, `frame`, `tempo`, `beatPosition()`, `beatPhase()`, `secondsPerBeat()`, `after(sec, fn) → job`, `cancel(job)`, `setTempo(bpm)` |
| `api.input` | `pointers()`, `recognizers.register(def)`, `inject.down(id, x, y)`, `inject.move(id, x, y)`, `inject.up(id)` |
| `api.grid` | `cols`, `rows`, `count`, `index(gx, gy)`, `inBounds(gx, gy)`, `view()` → GridModel (hot path: read/write channels, never replace arrays) |
| `api.energy` | `inject(fx, fy, amount, radius)`, `injectLine(x0, y0, x1, y1, amount, radius)`, `at(gx, gy)`, `behaviors.register(def)`, `setBehavior(id)`, `params` |
| `api.effects` | `register(def)`, `list()`, `spawn(id, params, { x, y, event, key })`, `cancel(inst)`, `count()`, `active()` |
| `api.shapes` | `register(def)`, `get(id)`, `list()` |
| `api.patterns` | `register(def)`, `list()`, `set('a' \| 'b', id, params)` |
| `api.palettes` | `register(def)`, `list()`, `setActive(id)`, `style(t, b)`, `rgb(t)` |
| `api.audio` | `generators.register`, `sounds.register`, `mappings.register`, `play(soundId, mapResult, { when, quantize })`, `map(mappingId, ev)`, `sustain(soundId, m, key)`, `update(key, m)`, `release(key, sec)`, `state`, `voices`, `music.{SCALES, NOTE_NAMES, degreeToMidi, midiToFreq, normToMidi}` |
| `api.interactions` | `register(profile)`, `list()`, `setProfile(id)`, `active()`, `handle(type, ev)` |
| `api.presets` | `register(preset)`, `list()`, `load(id)`, `current()`, `patch(changes)` |
| `api.settings` | `get(key)`, `set(key, v)`, `subscribe(key, fn)`, `define(schema) → namespace` (keys become `ext.<pluginId>.<key>`) |
| `api.performance` | `stats()`, `quality()`, `addOptimizer(fn(stats, monitor))` |
| `api.renderers` | `register(def)`, `setActive(id)`, `active()`, `list()` |
| `api.systems` | `register({ id, update(dt, ctx), draw?(g, ctx) })` |
| `api.particles` | `emit(opts)`, `burst(x, y, n, opts)` |
| `api.ui` | `panels.register(def)`, `panels.list()`, `toast(text)` |
| `api.commands` | user commands: `undo`, `clearArtwork`, `resetSimulation`, `restoreDefaults`, `randomize(strength, locks)`, `cycle(section, dir)`, `tapTempo`, `snapshotPNG`, `exportComposition`, `importComposition`, preset CRUD, `looper.{record, stop, state}`, `plugins.{list, setEnabled}`, `diagnostics` |
| `api.rng` | seeded: `next()`, `range(a, b)`, `int(a, b)`, `chance(p)`, `pick(arr)`, `weighted([[v, w]])`, `shuffle(arr)` |
| `api.timers` | `setTimeout(fn, ms)`, `setInterval(fn, ms)`, `clear(handle)` — auto-cleared |
| `api.config`, `api.saveConfig(partial)` | your merged config / persist changes |

Coordinates everywhere are **normalized 0..1**; sizes and speeds are **units** (1 = short
side of the canvas). Gesture event fields are documented in `src/input/gesture-events.js`.

## 4. One section per extension category

### 4.1 Visual effect — `src/effects/effect-interface.js`
```js
api.effects.register({
  id: 'acme.sparkle', name: 'SPARKLE', kind: 'local', life: 1.2, priority: 0, maxInstances: 12,
  defaults: { radius: 4 },
  spawn(inst, ctx) { inst.state.t0 = ctx.clock.time * 0.02; ctx.energy.inject(inst.fx, inst.fy, 0.8, 2); },
  update(inst, dt, ctx) {                      // write MODULATIONS, never pixels
    ctx.space.forRadius(ctx.grid, inst.fx, inst.fy, inst.params.radius * inst.t, (i) => {
      ctx.comp.add('bright', i, 0.5 * (1 - inst.t));
      ctx.comp.max('flash', i, ctx.a11y.reducedFlash ? 0.1 : 0.4);
    });
  },
  draw(inst, g) { g.ring(inst.x, inst.y, 0.1 * inst.t, { t: inst.state.t0, b: 1, alpha: 1 - inst.t }); },
});
```
Rules: bounded `life` (or `kind: 'global'` for ambient), no per-cell allocation per frame,
respect `ctx.a11y.reducedFlash/reducedMotion`, persistent artwork only through
`grid.paint/shape/ink`. Compositor rules: additive channels, max flash, priority colour
(ARCHITECTURE §6). Example: `examples/lissajous-effect.js`.

### 4.2 Shape — `src/rendering/shape-registry.js`
`{ id, name, draw(c, x, y, s, o), strokeOnly? }` — build a path centred at (x, y), size s,
unrotated; `c.fill()` (or `c.stroke()` when `o.stroke`). Never set colours. Example:
`examples/hexagon-shape.js`. Use it by listing the id in a preset's `shapes`.

### 4.3 Pattern — `src/patterns/pattern-registry.js`
`{ id, name, params?, init?(ctx) → state, fill(out, ctx) }`, write 0..1 per cell.
`ctx = { cols, rows, count, t, dt, params, state, aspect, memory, energy, rng }`.
Example: `examples/plasma-pattern.js`.

### 4.4 Palette — `src/color/palette-registry.js`
`{ id, name, stops: ['#hex', …] | generate(rng), cycle?, spread?, white?, discrete? }`.
Example: `examples/sunset-palette.js`.

### 4.5 Sound generator + sound — `src/audio/generators/common.js`, `src/audio/sound-registry.js`
Generator: `{ id, params: { name: { min, default, max } }, create(ac, out, when, p, shared) → { end, stop(t), set?, release?, dispose? } }`.
Envelope your own output; params arrive clamped. Sound: `{ id, layers: [{ gen, params?, octave?, semis?, degree?, gain?, pitch?, delay? }], sustain? }`.
Example: `examples/wobble-sound.js`.

### 4.6 Gesture recognizer — `src/input/gesture-recognizer.js`
`{ id, emits: ['zigzag'], down?(p, ctx), move?(p, ctx), up?(p, ctx, cancelled), frame?(dt, ctx), reset?() }`.
Keep per-pointer state in `p.data[yourId]`; publish with `ctx.emit('zigzag', p, extra)` →
`'gesture:zigzag'`. Describe, never act. Example: `examples/zigzag-gesture.js`.

### 4.7 Gesture-to-effect mapping (interaction profile) — `src/interaction/router.js`
```js
api.interactions.register({
  id: 'acme.sparkle-set', name: 'SPARKLE', cycle: true, include: ['core.base'],
  rules: [
    { on: 'press', do: [{ effect: 'acme.sparkle' }, { sound: 'ping', map: 'position-pitch' }] },
    { on: 'drag', throttle: 0.08, do: [{ effect: 'energy-trail' }, { sound: 'pluck', map: 'velocity-glide', gain: 0.5 }] },
    { on: 'hold:charge', do: [{ effect: 'charge-field', key: 'gesture', params: { level: '$level' } }] },
  ],
});
```
`global: true` merges a rule set into every effect set (used by the zigzag example).
`when` supports `minSpeed, maxSpeed, minPointers, maxPointers, pointerType, region, fields, chance`.

### 4.8 Audio mapping — `src/audio/audio-mapping.js`
`{ id, map(ev, ctx) → { degree | midi, gain, pan, cutoff, …any generator param } }`;
`ctx.normToDegree(n, octaves)`, `ctx.normToMidi`, `ctx.energyAt(x, y)`, `ctx.paintAt(x, y)`.

### 4.9 Energy behaviour — `src/grid/energy-field.js`
`{ id, update(field, dt, params) }`; work inside `field.region`, grow it if energy can
leave. Select via a preset's `energy.behavior`. Example: `examples/gravity-energy.js`.

### 4.10 Preset — `src/presets/preset-schema.js`
Data only (format `pixel-riot-preset`, version 1). Validated on registration; unknown ids
fall back with warnings. Declare the extensions it uses as dependencies.
Example: `examples/example-preset.js`.

### 4.11 UI panel
`{ id, title, order, render(container, api) → cleanup? }` — public API only; return a
cleanup for intervals/subscriptions. Use the widget kit in `src/ui/widgets.js` or plain DOM.
Example: `examples/stats-panel.js`.

### 4.12 Rendering backend — `src/rendering/renderer-interface.js`
`{ id, supported?(), init(canvas, services), resize(w, h, dpr), render(frame) → { cellsDrawn }, createOverlay(), snapshot?(), dispose() }`.
Read the frame description; draw `frame.overlays` with your overlay API. Throwing falls
back to canvas2d. Example: `examples/dot-matrix-renderer.js`.

### 4.13 Mathematical / generative system
`api.systems.register({ id, update(dt, ctx), draw?(g, ctx) })`, ctx = EffectContext.
Default to OFF behind a setting if it changes the art on its own. Example: `examples/orbit-system.js`.

### 4.14 Performance optimization
`api.performance.addOptimizer((stats, monitor) => …)` runs once per second.
Example: `examples/frame-budget.js`.

### 4.15 Accessibility feature
Add settings/panels and behaviours that *add* accessibility; never weaken reduced flashing
or reduced motion. Example: `examples/colour-safe.js`.

### 4.16 Experimental feature
Type `'experimental'`, default OFF, fully removable. Example: `examples/autoplay.js`
(synthetic gestures through `api.input.inject`).

## 5. Configuration options

- Plugin config: `manifest.defaults` + `configSchema`; read `api.config`; persist with `api.saveConfig({...})`.
- User-facing settings: `const ns = api.settings.define({ enabled: { type: 'bool', default: false, label: 'MY THING' } })`
  → read `api.settings.get(\`${ns}.enabled\`)`. Types: `bool | number (min/max/step) | enum (options) | string`.
- Document every option in your module header and in `CHANGELOG.md`.

## 6. Testing

**Independently** (core + only your extension) with the harness — copy a case from
`src/tests/extensions.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from './harness.js';
import sparkle from '../extensions/acme-sparkle/index.js';

test('acme.sparkle works alone and removes cleanly', async () => {
  const h = await bootApp({ extensions: [sparkle] });
  assert.equal(h.plugin('acme.sparkle').status, 'active');
  h.api.presets.patch({ interaction: 'acme.sparkle-set' });
  h.tap(0.5, 0.5); h.frames(90);
  assert.deepEqual(h.app.errors, []);
  h.services.pluginManager.remove('acme.sparkle');
  assert.ok(!h.services.effects.registry.has('acme.sparkle'));
  h.dispose();
});
```

**With the rest of the app:** `npm test` (all suites, including integration with every
listed extension) and `npm run test:browser` (real Chromium, real touch events). Then the
manual device checklist in `TESTING.md` for anything touch, audio or performance related.

## 7. Removing an extension

Delete its import and array entry in `src/extensions/registry.js` and its folder. Nothing
else may reference it (presets that depend on it must declare it as a dependency and are
then skipped automatically). Users can also disable non-core extensions in SETTINGS >
EXTENSIONS; disabling stops dependents too.

## 8. Performance checklist

- No allocation per cell per frame; reuse `inst.state`; prefer `ctx.space.*` iterators.
- Touch only the cells you need (`forRadius`, `forRing`, `forLine`, energy dirty region).
- Throttle continuous gestures in profiles (`throttle: 0.05–0.2`).
- Use the shared particle pool and the clock scheduler; never your own rAF loop.
- Sounds: one-shots end by themselves; sustained voices must be released.
- Check DIAGNOSTICS (FPS, effects, particles, voices, jobs) before and after.

## 9. Compatibility checklist

- Namespace every id (`acme.*`); never reuse or override a core id.
- Declare dependencies; target `apiVersion: '1.0.0'`.
- Don't rely on undocumented internals (anything not in §3 or a contract file).
- Profiles and presets are data: they must survive missing ids (the router ignores
  unknown effects/sounds; presets fall back with warnings).
- Add, don't replace: new effect sets, palettes, sounds — never edit built-in ones.
