# Changelog

All notable changes. Extensions and AI contributors: add an entry for every change
(see `LLM_EXTENSION_PROTOCOL.md` §3 and §5).

## [0.1.0] — 2026-10-24 — Initial foundation (API 1.0.0)

### Added
- **Core:** event bus with wildcard + scoped subscriptions and error isolation; generic
  validated registries; plugin manager (manifest validation, API-major compatibility,
  dependency ordering, lifecycle, rollback, quarantine after 5 runtime errors,
  enable/disable); scoped public API (`core/api.js`); shared clock with clamped dt, beat
  tracking and a bounded scheduler; schema-driven persistent settings; storage with memory
  fallback; undo history; performance monitor with adaptive quality + resolution.
- **Input:** single Pointer Events pipeline (mouse/touch/pen, coalesced events, ≤ 10
  pointers, synthetic injection); recognizers for press/release, tap, double tap, rhythm
  (tempo estimate), drag with gap-free cell paths, swipe, reversal, circle, long press
  (charge/release), multitouch (pinch, rotate, spread, squeeze, count); stable event schema.
- **Grid:** typed-array cell model (persistent paint/shape/ink + transient channels),
  short-axis resolutions 16/32/64/128 + adaptive, square or stretched cells, area
  resampling on resize; universal energy field with 4 behaviours (diffuse, still, drift,
  pulse) and dirty-region updates; spatial queries; symmetry helpers.
- **Visuals:** Canvas 2D renderer (trails, scene shake/zoom, fast paths, additive overlay
  pass); compositor with documented conflict rules; 25 shapes; 13 palettes with smooth
  transitions and a harmony-constrained generator; 17 patterns with two-layer blending;
  22 effects (tap burst, ripple field, colour cascade, directional sweep, cell explosion,
  mirror field, rotating matrix, recursive bloom, energy trail, flash grid, moiré shift,
  oscillator bands, cellular pulse, checkerboard warp, particle scatter, infinite
  corridor, harmonic grid, glitch blocks, spiral draw, symmetry explosion, charge field,
  radial expansion); bounded effect scheduler with keyed instances; chain-reaction
  framework; shared particle pool.
- **Audio:** Web Audio engine (gesture unlock, limiter, master ceiling, space send with
  delay + reverb, quantized scheduling on the audio clock); voice manager (≤ 24, fade
  stealing); 20 generators (sine, triangle, square, saw, FM, pad, charge drone, kick,
  snare, closed/open hat, click, noise burst, filtered noise, pluck, bell, metal, rising/
  falling sweeps, grain cloud); 18 named sounds; 9 audio mappings; scales, root, free
  pitch, tap tempo; gesture looper (1/2/4 bars).
- **Interaction:** data-driven router (rules, conditions, throttles, `$` bindings, keyed
  effects, sustain/release, energy, tempo, emit, `include`, `global`); 6 effect sets (RIOT,
  FLOW, BLOOM, GLITCH, PULSE, MIRROR) + shared base rules.
- **Presets:** versioned schema with data-only validation; 15 built-in presets; user
  presets (save, rename, duplicate, delete, export/import JSON); compositions (instrument +
  artwork) export/import; session + artwork persistence; randomizer with 4 strengths and
  9 lockable sections.
- **UI:** minimal top/bottom bars (dim while playing), bottom-sheet settings with 11 core
  panels, toasts, diagnostics overlay, hidden-controls mode, large controls, keyboard
  shortcuts, OS reduced-motion detection, reduced flashing/motion.
- **Extensions:** 14 working examples covering all 16 extension categories; marked
  EXTENSION ZONES at every registration point.
- **Delivery:** zero-dependency static server, service worker (offline after first
  visit), web manifest.
- **Tests:** 70 Node tests + Playwright browser smoke test (29 checks).
- **Docs:** README, ARCHITECTURE, EXTENSION_GUIDE, LLM_EXTENSION_PROTOCOL, TESTING, this file.

### Known limitations
- Not yet verified on physical iPhone/iPad hardware (see TESTING.md manual checklist).
- Canvas 2D only; DENSE grids on phones are slow — use AUTO. A WebGL renderer is the
  intended next backend.
- AudioWorklet is not used (all synthesis uses standard nodes); granular synthesis is a
  bounded grain cloud, not sample-based.
- Undo covers artwork, not instrument/preset changes.
- Pressure only affects trails/bursts when the hardware reports it (pen, some touch).
