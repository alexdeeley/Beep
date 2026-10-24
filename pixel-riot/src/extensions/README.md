# src/extensions

- `registry.js` — THE list of optional extensions loaded at startup (add one import + one entry).
- `manifest-schema.js` — manifest format, `EXTENSION_TYPES`, validation, API compatibility.
- `examples/` — one working example for every extension category:

| Category | Example |
|---|---|
| Visual effect + gesture-to-effect mapping | `lissajous-effect.js` |
| Shape | `hexagon-shape.js` |
| Pattern | `plasma-pattern.js` |
| Palette | `sunset-palette.js` |
| Sound generator + sound + audio mapping | `wobble-sound.js` |
| Gesture recognizer (+ global rule set) | `zigzag-gesture.js` |
| Energy behaviour | `gravity-energy.js` |
| Preset | `example-preset.js` |
| UI panel | `stats-panel.js` |
| Rendering backend | `dot-matrix-renderer.js` |
| Mathematical / generative system | `orbit-system.js` |
| Performance optimization | `frame-budget.js` |
| Accessibility | `colour-safe.js` |
| Experimental | `autoplay.js` |

Put new extensions in their own folder (`src/extensions/<name>/index.js`). Read
`EXTENSION_GUIDE.md` and `LLM_EXTENSION_PROTOCOL.md` first.
