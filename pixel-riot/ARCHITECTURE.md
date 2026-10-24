# PIXEL RIOT — Architecture

Plain ES modules, no build step, no dependencies. API version: `1.0.0` (`src/config.js`).

## 1. The big picture

```
                       ┌──────────────────────────── EVENT BUS (core/event-bus.js) ─────────────────────────────┐
                       │  pointer:*   gesture:*   chain:stage   clock:beat/step   settings:changed   preset:applied │
                       └───────▲──────────────▲───────────────────▲───────────────────▲──────────────────▲─────────┘
 Pointer Events                │              │                   │                   │                  │
 (canvas only)                 │              │                   │                   │                  │
     │                         │              │                   │                   │                  │
┌────▼─────────────┐   ┌───────┴────────┐  ┌──┴─────────────────┐ │                   │                  │
│ PointerManager   │──▶│ Gesture        │  │ InteractionRouter  │ │                   │                  │
│ input/pointer-   │   │ RecognizerHost │  │ (profiles = DATA)  │─┼──▶ EffectManager ──┼─▶ Compositor ────┼──┐
│ manager.js       │   │ + recognizers  │  │ interaction/       │ │    (scheduler,     │   (per-frame     │  │
│ one listener set │   │ (registry)     │  │ router.js          │ │     caps, keys)    │    modulations)  │  │
└──────────────────┘   └────────────────┘  └──┬──────┬──────────┘ │        │           │                  │  │
                                               │      │            │        ▼           │                  │  │
                                               │      │            │   Grid + Energy ◀──┴── Patterns ◀──────┘  │
                                               │      │            │   (typed arrays)       Palettes            │
                                               │      ▼            │        │                                   ▼
                                               │   AudioEngine ◀───┘        └──────────────▶ Renderer (registry) ─▶ canvas
                                               │   voices, generators,                       canvas2d | dot-matrix | yours
                                               │   sounds, mappings
                                               ▼
                                          energy / tempo / emit actions
```

**Input recognition, cell-state changes, effect scheduling, rendering and sound are separate
modules.** Recognizers only *describe* gestures. The router decides what a gesture *means*
by reading an interaction profile (pure data). Effects only write into the compositor and
the grid. The renderer only reads. The audio engine only receives mapped parameters.

Everything extensible lives in a `Registry` (`core/registry.js`). Built-ins are registered
through the same plugin mechanism extensions use (`core/builtin-packs.js`,
`effects/builtins/index.js`, `audio/builtins.js`, `ui/panels.js`).

## 2. Boot sequence (`src/app.js`)

1. Construct services: bus, storage, settings, rng, clock, perf monitor, grid, mapper,
   palettes, shapes, patterns, compositor, particles, energy, chain reactions, effects,
   recognizer host, pointer manager, audio, router, looper, presets, history.
2. `PluginManager.add()` every core pack + every entry of `src/extensions/registry.js`;
   `startAll()` validates manifests, resolves dependencies (topological order), and runs
   each plugin's `register → init → activate` with a **scoped API**.
3. Choose the renderer (saved choice or `canvas2d`), restore the last instrument preset and
   the artwork, size the grid, start the `requestAnimationFrame` loop.

## 3. State ownership

| State | Owner | Persistence |
|---|---|---|
| User preferences (volume, a11y, resolution, quality, tempo...) | `core/settings.js` | localStorage `settings` |
| Instrument configuration (palette, patterns, shapes, effect set, ambient effects, energy behaviour, chain tuning) | `presets/preset-manager.js` → `current` | localStorage `presets.current`; user presets in `presets.user` |
| Artwork (per-cell `paint`, `shape`, `ink`) | `grid/grid-model.js` | localStorage `art` (base64 typed arrays, debounced) |
| Simulation (energy, flash, phase, velocity, memory, effects, particles, chains, scheduled jobs) | grid transient channels + managers | never persisted |
| Undo history (artwork snapshots, one per user action) | `core/history.js` | memory only, ≤ 24 snapshots / 12 MB |
| Extension enable flags + config | `core/plugin-manager.js` | `extensions.disabled`, `ext.<id>.config` |

Operations are deliberately disjoint: **CLEAR ARTWORK** (grid art, undoable) ≠ **RESET
SIMULATION** (transient state) ≠ **RESTORE DEFAULT SETTINGS** (preferences) ≠ **DELETE
PRESET** (one user preset).

## 4. The grid

`GridModel` is a structure of typed arrays, one slot per cell (no per-cell objects):
`paint, shape, ink` (persistent) and `energy, phase, vx, vy, flash, last, base, memory`
(transient). Resolution is the cell count along the **short** screen axis (16/32/64/128 or
adaptive); the long axis is extended so cells stay square (`grid.cellAspect = 'stretch'`
gives an exact N×N). Resizing or rotating **area-resamples** the artwork so thin strokes
survive. Cells reference shared definitions (palette, shape set, audio mapping) instead
of storing them; a cell's sound is derived from its position/paint by the mapping.

## 5. Frame loop (one `requestAnimationFrame`)

```
realDt → perf.frame → clock.tick (dt clamped to 1/20 s: no backlog after a hidden tab;
                                   runs scheduled jobs; emits clock:beat / clock:step)
       → recognizers.frame (hold charge)
       → patterns.update (every N frames by quality) → palettes.update (transitions, cycling)
       → energy.update (active behaviour, dirty region only) → flash/ink decay
       → comp.beginFrame → effects.update (each instance writes modulations)
       → systems.update → particles.update → renderer.render(frame description)
```

## 6. Compositing and conflict rules

Effects never draw cells. They add modulations to the `Compositor` (`rendering/compositing.js`):

| Channel | Rule |
|---|---|
| `bright`, `scale`, `rot`, `ox`, `oy`, `hue` | **additive**; renderer soft-clamps (bright ≤ 1.6, scale ±0.9, offsets ±1.5 cells) and scales by INTENSITY |
| `flash` | **max** — overlapping flashes never exceed the strongest one |
| colour override | **priority** then weight: `setColor(i, t, weight, priority)` |
| `global` (shake, zoom, rot, invert, hue, bright) | additive per frame, clamped; damped by reduced motion |

So one cell can rotate, flash, change colour and ride a ripple in the same frame.
Reduced flashing scales every flash by 0.25 (and scanners are rate-limited to ≤ 12 Hz).
Reduced motion scales displacement/rotation/shake by 0.3 and caps trails.

## 7. Effects

`EffectManager` (`effects/effect-manager.js`) runs any number of instances of any effect.
Bounds: per-effect `maxInstances`; global cap 160 × quality scale (evicts lowest priority,
oldest first); lifetime ≤ 30 s for local effects; ≤ 6 global/ambient effects. Keyed
instances (`spawn(id, params, { key })`) let continuous gestures retrigger one instance
(hold charge, pinch, twist). An effect that throws is cancelled and reported to its owner
plugin. Contract: `effects/effect-interface.js`.

**Chain reactions** (`effects/chain-reaction.js`): breadth-first stages scheduled on the
clock (no recursion), a visited bitmap per chain, ≤ 14 concurrent chains, ≤ 220 cells per
stage, ≤ 24 stages, ≤ 4000 scheduled jobs total. Tunable per instrument (radius, delay,
decay, length, probability, directional bias, symmetry, colour and sound inheritance).

**Energy** (`grid/energy-field.js`): a shared scalar field. Taps inject at a point, drags
along a path, holds accumulate, multitouch fields add. The active behaviour (diffuse,
still, drift, pulse, or an extension's) updates only the dirty region.

## 8. Input

`PointerManager` is the only code that listens to raw input (Pointer Events on the canvas,
coalesced events for fast swipes, ≤ 10 pointers, synthetic injection for the looper,
autoplay and tests). It feeds `GestureRecognizerHost`, which runs every registered
recognizer and publishes `gesture:<type>` events with a stable schema
(`input/gesture-events.js`). Coordinates are normalized (0..1); distances and speeds are
in *units* (1 unit = the canvas short side) so gestures mean the same on every screen.

**UI vs canvas:** the UI layer (`#ui`) is `pointer-events: none` except its controls, so
touches start either on a control or on the canvas — never both. The canvas has
`touch-action: none`; iOS pinch-zoom gestures are blocked for the app only.

## 9. Interaction router

`interaction/router.js` maps gesture events to actions using the active **interaction
profile** (an "effect set"). Profiles are JSON-compatible data: `rules: [{ on, when?,
throttle?, do: [actions] }]`, `include` other profiles, `global: true` for always-on rule
sets, `cycle: true` to appear on the EFFECT button. Actions: spawn effect (optionally
keyed), play / sustain / release sound with an audio mapping, inject energy, set tempo
from rhythm, emit an event. `'$field'` strings bind event values into params.

## 10. Audio

```
voice: generator nodes → voice gain → stereo panner ┐
                                                   ├→ bus → compressor/limiter → master (≤ 0.9) → out
                               space send → delay + generated-IR reverb ┘
```

- Context starts only inside a user gesture (`unlock()` from the first `pointer:down`).
- `VoiceManager`: ≤ 24 voices; the oldest one-shot is stolen with a 12 ms fade.
- Every generator declares param ranges; the engine clamps everything before creating nodes.
- Sounds are layered recipes over generators; mappings turn events into
  `{ degree|midi, gain, pan, cutoff, ... }`.
- **Timing:** visuals react on the frame the gesture arrives. Audio is scheduled on the Web
  Audio clock; in musical mode with QUANTIZE on, start times snap to the next subdivision of
  the shared `Clock` tempo, while the harmonic grid and looper use the same clock
  (`clock.beatPosition()` reads the audio clock when audio is running). Neither side waits
  for the other.
- No Web Audio → state `unavailable`, every call is a no-op.

## 11. Rendering

`rendering/canvas-renderer.js` (default): background (or translucent overdraw for TRAILS),
a cell pass (one shape per lit cell, cached palette colour strings, fast `fillRect` path,
`setTransform` only for rotated cells, dark cells skipped), then an additive overlay pass
(particles + effect `draw()` callbacks through the **Overlay API**). Device pixel ratio is
capped at 2. Renderers are a registry (`renderer-interface.js`); a failing renderer falls
back to `canvas2d`.

## 12. Plugins and the public API

`core/plugin-manager.js` + `core/api.js`. Lifecycle `register → init → activate → (respond)
→ deactivate → dispose`. Each plugin receives its own scoped `api`; everything it
registers, subscribes, schedules or times is tagged with its id and removed automatically
when it is disabled, fails or is removed. Manifest validation, API-major compatibility,
dependency resolution (missing/cyclic deps fail cleanly), exception isolation for every
lifecycle stage, and **quarantine after 5 runtime errors** (event handlers, effects,
recognizers, systems). Diagnostics are visible in SETTINGS > EXTENSIONS.

## 13. Performance

Limits live in `config.js` (`LIMITS`, `QUALITY_LEVELS`). `PerformanceMonitor` tracks FPS,
frame time, dropped frames, effects, voices, particles, scheduled jobs, chains, cells
drawn and a workload estimate; with quality AUTO it steps high → medium → low (fewer
particles, smaller effect cap, patterns every other frame) and with grid ADAPTIVE it steps
the resolution. The diagnostics overlay is off by default (GRID & PERFORMANCE).

## 14. Known architectural limits

- Canvas 2D draws every lit cell every frame; DENSE (128 on the short side ≈ 35k cells on a
  phone) is heavy. AUTO resolution keeps phones at 24–64. A WebGL renderer is the natural
  next backend (contract already supports it).
- Shapes are Canvas-2D path functions; a WebGL backend would need its own shape atlas.
- Undo covers artwork, not instrument changes (presets are reversible by reloading them).
