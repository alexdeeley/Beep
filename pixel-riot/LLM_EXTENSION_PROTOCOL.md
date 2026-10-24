# LLM EXTENSION PROTOCOL

> **Extend the application through existing public interfaces whenever possible. Do not
> rewrite the core application merely to add a feature.**

This file is the instruction manual for every AI model (and human) that modifies PIXEL
RIOT. Follow it literally.

## 1. Before you change anything

1. Read `README.md`, `ARCHITECTURE.md`, `EXTENSION_GUIDE.md` and `CHANGELOG.md` in full.
2. Inspect the implementation you will touch: the relevant contract file, the closest
   example in `src/extensions/examples/`, and `src/extensions/registry.js`.
3. Run `npm test` and record the result **before** your change (baseline).
4. Identify the relevant **EXTENSION ZONE** (search the code for `EXTENSION ZONE:`). The
   16 categories: visual effects, shapes, patterns, palettes, sound generators, gesture
   recognizers, gesture-to-effect mappings, audio mappings, energy behaviours, presets, UI
   panels, rendering backends, mathematical/generative systems, performance
   optimizations, accessibility, experimental.
5. If your plan needs anything beyond adding new modules in `src/extensions/…`, a new test
   file and one entry in `src/extensions/registry.js`, **write down the planned changes and
   files first** and explain why the public API is insufficient.

## 2. Rules while working

6. Prefer adding new modules over editing stable core modules (list in EXTENSION_GUIDE §1).
7. Never replace working functionality with mocks, placeholders or stubs.
8. Preserve every existing control, effect, preset, sound, gesture and setting. Do not
   change the behaviour of built-ins; add new ones instead.
9. Use the existing event bus, registries, clock (`api.clock.after`), timers
   (`api.timers`), settings (`api.settings.define`), particle pool and lifecycle. Do not
   add global listeners, your own rAF loops, or direct `localStorage` access.
10. Do not add dependencies unless strictly necessary; if you do, justify it in the report.
11. Namespace every id you register (`<yourname>.*`). Never reuse core ids.
12. Every new configuration option is documented in your module header, in
    `EXTENSION_GUIDE.md` if it is a new pattern, and in `CHANGELOG.md`.
13. Effects must be bounded (lifetime or `kind: 'global'`), respect reduced flashing and
    reduced motion, and avoid per-frame allocation. Sounds must envelope their output.
14. No dead controls: every button you add must do something real.
15. Add meaningful tests: at minimum a harness test that boots core + your extension,
    exercises the feature, asserts `app.errors` is empty and that removal leaves nothing
    behind (copy `src/tests/extensions.test.js`).

## 3. Verify

16. Run `npm test` (must stay green) and, if Chromium/Playwright is available,
    `npm run test:browser`. Fix what you broke.
17. Check that existing functionality still works (the integration suite covers every
    gesture in every effect set).
18. Update `CHANGELOG.md` (feature, files, new options, known limitations) and, if you
    added a new kind of extension point, `EXTENSION_GUIDE.md` and `ARCHITECTURE.md`.

**Never claim a feature works unless you implemented it and ran the checks that show it.**
Say plainly what you could not test (real touch hardware, audio output, device performance).

## 4. Conflicts and core changes

If a request conflicts with an existing contract, stop and explain the conflict, then
propose the smallest compatible solution (usually: a new registry entry, a new profile, a
`global` rule set, or a new optional field with a default).

If a core change is genuinely necessary, document in `CHANGELOG.md`:
- the reason the public API was insufficient,
- affected interfaces and files,
- the migration plan (keep the old behaviour working; bump `API_VERSION` minor for additive
  changes, major only for breaking ones — and then every manifest must be reviewed),
- the regression tests you added.

## 5. Required completion report

Finish every task with this report (fill every heading; write "none" if empty):

```
## Extension completion report
Feature summary:
Files added:
Files modified:
Public APIs used:
New events or configuration:
Tests run and results (before / after):
Performance implications:
Known limitations:
Compatibility notes:
Manual testing still required:
```
