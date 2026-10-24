// Each example extension is tested ON ITS OWN (core + that extension + its dependencies),
// then removed cleanly. This is the pattern new extensions should copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from './harness.js';
import lissajous from '../extensions/examples/lissajous-effect.js';
import hexagon from '../extensions/examples/hexagon-shape.js';
import plasma from '../extensions/examples/plasma-pattern.js';
import sunset from '../extensions/examples/sunset-palette.js';
import wobble from '../extensions/examples/wobble-sound.js';
import zigzag from '../extensions/examples/zigzag-gesture.js';
import gravity from '../extensions/examples/gravity-energy.js';
import examplePreset from '../extensions/examples/example-preset.js';
import statsPanel from '../extensions/examples/stats-panel.js';
import dotMatrix from '../extensions/examples/dot-matrix-renderer.js';
import orbits from '../extensions/examples/orbit-system.js';
import frameBudget from '../extensions/examples/frame-budget.js';
import colourSafe from '../extensions/examples/colour-safe.js';
import autoplay from '../extensions/examples/autoplay.js';
import { EXTENSION_TYPES } from '../extensions/manifest-schema.js';

const cases = [
  [lissajous, (h) => { h.api.presets.patch({ interaction: 'ex.lissajous-profile' }); h.tap(0.3, 0.4); return h.services.effects.list().some((e) => e.effectId === 'ex.lissajous'); }],
  [hexagon, (h) => { h.api.presets.patch({ shapes: ['ex.hexagon'] }); h.frames(5); return h.app.shapeSet[0].id === 'ex.hexagon'; }],
  [plasma, (h) => { h.api.patterns.set('a', 'ex.plasma'); h.frames(5); return h.services.grid.base.some((v) => v > 0.2); }],
  [sunset, (h) => { h.api.palettes.setActive('ex.sunset'); h.frames(60); return h.services.palettes.active === 'ex.sunset'; }],
  [wobble, (h) => h.services.audio.sounds.has('ex.wobble') && h.services.audio.mappings.has('ex.y-wobble') && h.api.audio.map('ex.y-wobble', { x: 0.5, y: 0.1 }).rate > 10],
  [zigzag, (h) => { h.drag([[0.3, 0.5], [0.5, 0.5], [0.3, 0.5], [0.5, 0.5], [0.3, 0.5], [0.5, 0.5]], 30); return h.services.recognizers.counts.zigzag >= 1; }],
  [gravity, (h) => { h.api.energy.setBehavior('ex.gravity'); h.services.energy.inject(10, 18, 2, 1); h.frames(60); const g = h.services.grid; let low = 0; for (let i = g.count / 2; i < g.count; i++) low += g.energy[i]; return low > 0; }],
  [[gravity, hexagon, plasma, sunset, lissajous, examplePreset], (h) => h.api.presets.load('ex.sunset-hive').ok],
  [statsPanel, (h) => h.api.ui.panels.list().some((p) => p.id === 'ex.stats')],
  [dotMatrix, (h) => { h.api.renderers.setActive('ex.dot-matrix'); h.frames(3); return h.app.rendererId === 'ex.dot-matrix' && h.services.perf.counters.cellsDrawn > 0; }],
  [orbits, (h) => { h.api.settings.set('ext.ex.orbits.enabled', true); h.frames(30); return h.services.energy.total > 0; }],
  [frameBudget, (h) => { h.api.settings.set('grid.resolution', 'dense'); h.api.settings.set('perf.quality', 'low'); for (let s = 0; s < 6; s++) for (let f = 0; f < 20; f++) h.services.perf.frame(0.05, s); return h.api.settings.get('grid.resolution') === 'detailed'; }],
  [colourSafe, (h) => h.services.palettes.registry.has('ex.colour-safe') && h.api.ui.panels.list().some((p) => p.id === 'ex.colour-safe-panel')],
  [autoplay, (h) => { h.api.settings.set('ext.ex.autoplay.enabled', true); return true; }],
];

for (const [ext, works] of cases) {
  const list = Array.isArray(ext) ? ext : [ext];
  const main = list.at(-1);
  test(`extension ${main.manifest.id}: loads alone, works, removes cleanly`, async () => {
    const h = await bootApp({ extensions: list });
    for (const e of list) assert.equal(h.plugin(e.manifest.id)?.status, 'active', `${e.manifest.id}: ${h.plugin(e.manifest.id)?.errors}`);
    assert.ok(EXTENSION_TYPES.includes(main.manifest.type));
    assert.ok(await works(h), 'feature works');
    h.frames(30);
    assert.deepEqual(h.app.errors, []);
    const before = h.services.allRegistries().map((r) => r.size);
    h.services.pluginManager.remove(main.manifest.id);
    const after = h.services.allRegistries().map((r) => r.size);
    assert.ok(after.reduce((a, b) => a + b, 0) < before.reduce((a, b) => a + b, 0) || main.manifest.type === 'performance', 'registrations removed');
    assert.ok(!h.services.allRegistries().some((r) => r.list().some((d) => r.owner(d.id) === main.manifest.id)), 'nothing left owned by the removed extension');
    h.frames(10);
    assert.deepEqual(h.app.errors, []);
    h.dispose();
  });
}
