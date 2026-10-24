// Core settings-sheet panels. Every panel is a registry entry with the UI panel contract:
//
//   { id, title, order, description?, render(container, api) -> cleanup?() }
//
// Panels only use the public api (settings, presets, palettes, commands...). They are
// rendered when the sheet opens and cleaned up when it closes.

import { el, button, toggle, slider, segmented, row, note, download, pickFile } from './widgets.js';
import { API_VERSION } from '../config.js';
import { NOTE_NAMES } from '../audio/music.js';
import { RANDOM_SECTIONS } from '../presets/randomizer.js';

const cur = (api) => api.presets.current();

function sToggle(api, key, label) { return toggle(label, () => api.settings.get(key), (v) => api.settings.set(key, v)); }
function sSlider(api, key, label, range, fmt) { return slider(label, range, () => api.settings.get(key), (v) => api.settings.set(key, v), fmt); }
function sSeg(api, key, label, options) { return segmented(label, options.map((o) => (typeof o === 'object' ? o : { value: o, label: String(o).toUpperCase() })), () => api.settings.get(key), (v) => api.settings.set(key, v)); }

// ============================================================
// EXTENSION ZONE: USER INTERFACE PANELS
// PURPOSE: Sections of the settings sheet.
// CONTRACT: { id, title, order, render(container, api) -> cleanup? } using the public api only.
// SAFETY: Return a cleanup for timers/subscriptions; never touch the canvas or internals.
// INTEGRATION: api.ui.panels.register(def). Example: src/extensions/examples/stats-panel.js
// ============================================================
export const CORE_PANELS = [
  {
    id: 'core.play', title: 'PLAY', order: 10,
    render(c, api) {
      const p = cur(api);
      c.append(
        sSlider(api, 'visual.intensity', 'INTENSITY', { min: 0.1, max: 1.5, step: 0.01 }),
        sSlider(api, 'visual.trails', 'TRAILS', { min: 0, max: 0.92, step: 0.01 }),
        sToggle(api, 'visual.animate', 'AMBIENT ANIMATION'),
        segmented('EFFECT SET', api.interactions.list().filter((x) => x.cycle).map((x) => ({ value: x.id, label: x.name })), () => cur(api)?.interaction, (v) => api.presets.patch({ interaction: v })),
        note(api.interactions.list().find((x) => x.id === p?.interaction)?.description || ''),
        segmented('SYMMETRY', ['none', 'h', 'v', 'quad', 'radial4', 'radial8'].map((v) => ({ value: v, label: v.toUpperCase() })), () => cur(api)?.look.symmetry, (v) => api.presets.patch({ look: { symmetry: v } })),
      );
    },
  },
  {
    id: 'core.presets', title: 'PRESETS', order: 20,
    render(c, api) {
      const list = el('div', { class: 'pr-list' });
      const draw = () => {
        list.textContent = '';
        const src = api.commands.currentPresetSource();
        for (const p of api.presets.list()) {
          const loadBtn = button((p.id === src ? '● ' : '') + p.name, () => { api.presets.load(p.id); draw(); }, { cls: 'pr-grow' + (p.id === src ? ' is-on' : '') });
          const actions = [loadBtn, button('COPY', () => { api.commands.duplicatePreset(p.id); draw(); }, { cls: 'pr-small' })];
          if (!p.builtin) {
            actions.push(button('RENAME', () => { const n = prompt('NEW NAME', p.name); if (n) { api.commands.renamePreset(p.id, n); draw(); } }, { cls: 'pr-small' }));
            actions.push(button('DELETE', () => { if (confirm(`DELETE "${p.name}"? Built-in presets and your artwork are not affected.`)) { api.commands.deletePreset(p.id); draw(); } }, { cls: 'pr-small pr-danger' }));
          }
          actions.push(button('EXPORT', () => download(`${p.id}.json`, api.commands.exportPreset(p.id)), { cls: 'pr-small' }));
          list.append(row(actions, 'pr-preset-row'));
        }
      };
      draw();
      c.append(
        row([
          button('SAVE CURRENT', () => { const n = prompt('PRESET NAME', ''); const p = api.commands.saveCurrentPreset(n || undefined); if (p) { api.ui.toast(`SAVED: ${p.name}`); draw(); } }),
          button('IMPORT JSON', async () => { const t = await pickFile(); if (!t) return; const r = api.commands.importPreset(t); api.ui.toast(r.ok ? `IMPORTED: ${r.value.name}${r.warnings.length ? ` (${r.warnings.length} WARNINGS)` : ''}` : `IMPORT FAILED: ${r.errors[0]}`); draw(); }),
        ]),
        list,
      );
    },
  },
  {
    id: 'core.look', title: 'LOOK', order: 30,
    render(c, api) {
      const p = () => cur(api);
      const patterns = api.patterns.list();
      c.append(
        segmented('PALETTE', api.palettes.list().map((x) => ({ value: x.id, label: x.name })), () => p()?.palette, (v) => api.presets.patch({ palette: v }), { cls: 'pr-wrap' }),
        segmented('PATTERN A', patterns.map((x) => ({ value: x.id, label: x.name })), () => p()?.pattern.a.id, (v) => api.presets.patch({ pattern: { ...p().pattern, a: { id: v, params: {} } } }), { cls: 'pr-wrap' }),
        segmented('PATTERN B', [{ value: null, label: 'NONE' }, ...patterns.map((x) => ({ value: x.id, label: x.name }))], () => p()?.pattern.b?.id ?? null, (v) => api.presets.patch({ pattern: { ...p().pattern, b: v ? { id: v, params: {} } : null } }), { cls: 'pr-wrap' }),
        segmented('BLEND', ['mix', 'add', 'multiply', 'max', 'difference', 'xor'].map((v) => ({ value: v, label: v.toUpperCase() })), () => p()?.pattern.blend, (v) => api.presets.patch({ pattern: { ...p().pattern, blend: v } })),
        slider('BLEND AMOUNT', { min: 0, max: 1, step: 0.01 }, () => p()?.pattern.mix ?? 0.5, (v) => api.presets.patch({ pattern: { ...p().pattern, mix: v } })),
        slider('PATTERN SPEED', { min: 0, max: 3, step: 0.01 }, () => p()?.pattern.speed ?? 1, (v) => api.presets.patch({ pattern: { ...p().pattern, speed: v } })),
        slider('PATTERN LEVEL', { min: 0, max: 1.2, step: 0.01 }, () => p()?.look.patternGain ?? 0.4, (v) => api.presets.patch({ look: { patternGain: v } })),
        slider('BLOCK SIZE', { min: 0.3, max: 1.3, step: 0.01 }, () => p()?.look.cellScale ?? 0.9, (v) => api.presets.patch({ look: { cellScale: v } })),
        slider('HUE SHIFT', { min: -1, max: 1, step: 0.01 }, () => p()?.look.hueBias ?? 0, (v) => api.presets.patch({ look: { hueBias: v } })),
        slider('CELL SPIN', { min: 0, max: 1, step: 0.01 }, () => p()?.look.rotateCells ?? 0, (v) => api.presets.patch({ look: { rotateCells: v } })),
        segmented('SHAPES (MULTI)', api.shapes.list().map((x) => ({ value: x.id, label: x.name })), () => p()?.shapes || [], (v) => {
          const s = new Set(p().shapes); if (s.has(v)) { if (s.size > 1) s.delete(v); } else if (s.size < 8) s.add(v);
          api.presets.patch({ shapes: [...s] });
        }, { cls: 'pr-wrap' }),
        segmented('SHAPE RULE', [{ value: 'band', label: 'BY PATTERN' }, { value: 'energy', label: 'BY ENERGY' }, { value: 'hash', label: 'SCATTERED' }, { value: 'uniform', label: 'FIRST ONLY' }], () => p()?.shapeMode, (v) => api.presets.patch({ shapeMode: v })),
      );
    },
  },
  {
    id: 'core.random', title: 'RANDOMIZE', order: 40,
    render(c, api) {
      const locks = (this._locks ||= new Set());
      c.append(
        row([1, 2, 3, 4].map((n) => button(['SUBTLE', 'NOTICEABLE', 'MAJOR', 'EXPERIMENTAL'][n - 1], () => { api.commands.randomize(n, locks); api.ui.toast(`RANDOMIZED: ${cur(api).name}`); }))),
        segmented('LOCK (KEEP UNCHANGED)', RANDOM_SECTIONS.map((s) => ({ value: s, label: s.toUpperCase() })), () => [...locks], (v) => { if (locks.has(v)) locks.delete(v); else locks.add(v); }, { cls: 'pr-wrap' }),
      );
    },
  },
  {
    id: 'core.chain', title: 'CHAIN REACTIONS', order: 50,
    render(c, api) {
      const ch = () => cur(api)?.chain || {};
      const set = (k) => (v) => api.presets.patch({ chain: { [k]: v } });
      c.append(
        slider('RADIUS', { min: 1, max: 4, step: 1 }, () => ch().radius, set('radius')),
        slider('DELAY (S)', { min: 0.01, max: 0.5, step: 0.01 }, () => ch().delay, set('delay')),
        slider('DECAY', { min: 0.3, max: 0.98, step: 0.01 }, () => ch().decay, set('decay')),
        slider('MAX LENGTH', { min: 1, max: 24, step: 1 }, () => ch().maxDepth, set('maxDepth')),
        slider('PROBABILITY', { min: 0, max: 1, step: 0.01 }, () => ch().probability, set('probability')),
        slider('DIRECTION BIAS', { min: 0, max: 1, step: 0.01 }, () => ch().biasStrength, set('biasStrength')),
        segmented('BIAS DIRECTION', [{ value: 'r', label: 'RIGHT' }, { value: 'l', label: 'LEFT' }, { value: 'd', label: 'DOWN' }, { value: 'u', label: 'UP' }],
          () => { const [x, y] = ch().bias || [0, 0]; return x > 0.5 ? 'r' : x < -0.5 ? 'l' : y > 0.5 ? 'd' : y < -0.5 ? 'u' : null; },
          (v) => api.presets.patch({ chain: { bias: { r: [1, 0], l: [-1, 0], d: [0, 1], u: [0, -1] }[v], biasStrength: Math.max(0.4, ch().biasStrength) } })),
        segmented('SYMMETRY', ['none', 'h', 'v', 'quad', 'radial4', 'radial8'].map((v) => ({ value: v, label: v.toUpperCase() })), () => ch().symmetry, set('symmetry')),
        slider('COLOUR INHERITANCE', { min: 0, max: 1, step: 0.01 }, () => ch().colorInherit, set('colorInherit')),
        slider('SOUND INHERITANCE', { min: 0, max: 1, step: 0.01 }, () => ch().soundInherit, set('soundInherit')),
        note('DOUBLE-TAP (RIOT) OR ANY TOUCH (PULSE) STARTS A CHAIN.'),
      );
    },
  },
  {
    id: 'core.sound', title: 'SOUND & MUSIC', order: 60,
    render(c, api) {
      const looperState = el('span', { class: 'pr-note', text: `LOOPER: ${api.commands.looper.state.toUpperCase()}` });
      const off = api.events.on('looper:state', (e) => { looperState.textContent = `LOOPER: ${e.state.toUpperCase()}${e.empty ? ' (NOTHING RECORDED)' : ''}`; });
      const st = el('p', { class: 'pr-note', text: `AUDIO: ${api.audio.state.toUpperCase()}` });
      const off2 = api.events.on('audio:state', (e) => { st.textContent = `AUDIO: ${e.state.toUpperCase()}`; });
      c.append(
        st,
        sToggle(api, 'audio.enabled', 'SOUND'),
        sSlider(api, 'audio.volume', 'VOLUME', { min: 0, max: 1, step: 0.01 }),
        sSlider(api, 'audio.space', 'SPACE (ECHO + REVERB)', { min: 0, max: 1, step: 0.01 }),
        sToggle(api, 'music.enabled', 'MUSICAL MODE'),
        row([sSlider(api, 'music.tempo', 'TEMPO', { min: 40, max: 220, step: 1 }), button('TAP TEMPO', () => { const b = api.commands.tapTempo(); if (b) api.ui.toast(`TEMPO ${b}`); })]),
        sToggle(api, 'music.quantize', 'QUANTIZE TIME'),
        sSeg(api, 'music.subdivision', 'SUBDIVISION', [1, 2, 3, 4, 6, 8].map((v) => ({ value: v, label: `1/${v}` }))),
        sSeg(api, 'music.scale', 'SCALE', ['pentatonic-major', 'pentatonic-minor', 'major', 'minor', 'dorian', 'lydian', 'whole-tone', 'chromatic']),
        segmented('ROOT', NOTE_NAMES.map((n, i) => ({ value: i, label: n })), () => api.settings.get('music.root'), (v) => api.settings.set('music.root', v)),
        sToggle(api, 'music.freePitch', 'FREE (UNQUANTIZED) PITCH'),
        el('div', { class: 'pr-field-label', text: 'GESTURE LOOPER' }),
        row([1, 2, 4].map((b) => button(`RECORD ${b} BAR${b > 1 ? 'S' : ''}`, () => { api.commands.looper.record(b); })).concat([button('STOP LOOP', () => api.commands.looper.stop())])),
        looperState,
        note('THE LOOPER RECORDS YOUR GESTURES FOR N BARS AT THE CURRENT TEMPO AND REPLAYS THEM AS A LOOP.'),
      );
      return () => { off(); off2(); };
    },
  },
  {
    id: 'core.performance', title: 'GRID & PERFORMANCE', order: 70,
    render(c, api) {
      c.append(
        sSeg(api, 'grid.resolution', 'GRID RESOLUTION', [{ value: 'coarse', label: '16' }, { value: 'standard', label: '32' }, { value: 'detailed', label: '64' }, { value: 'dense', label: '128' }, { value: 'adaptive', label: 'AUTO' }]),
        sSeg(api, 'grid.cellAspect', 'CELLS', [{ value: 'square', label: 'SQUARE' }, { value: 'stretch', label: 'N × N STRETCH' }]),
        sSeg(api, 'perf.quality', 'QUALITY', ['auto', 'high', 'medium', 'low']),
        segmented('RENDERER', api.renderers.list().map((r) => ({ value: r.id, label: r.name })), () => api.renderers.active(), (v) => api.renderers.setActive(v)),
        sToggle(api, 'perf.diagnostics', 'DIAGNOSTICS OVERLAY'),
        note(`GRID ${api.grid.cols} × ${api.grid.rows} = ${api.grid.count} CELLS`),
      );
    },
  },
  {
    id: 'core.a11y', title: 'ACCESSIBILITY', order: 80,
    render(c, api) {
      c.append(
        sToggle(api, 'a11y.reducedFlash', 'REDUCED FLASHING'),
        sToggle(api, 'a11y.reducedMotion', 'REDUCED MOTION'),
        sToggle(api, 'a11y.largeUI', 'LARGE CONTROLS'),
        sToggle(api, 'ui.hidden', 'HIDE CONTROLS (CLEAN SCREEN)'),
        note('REDUCED FLASHING SOFTENS EVERY FLASH, SCANNER AND STROBE. REDUCED MOTION DAMPS SHAKE, DISPLACEMENT, ROTATION AND TRAILS. HIDDEN CONTROLS LEAVE ONE SMALL DOT IN THE CORNER TO BRING THEM BACK.'),
      );
    },
  },
  {
    id: 'core.data', title: 'SAVE & DATA', order: 90,
    render(c, api) {
      c.append(
        row([
          button('SNAPSHOT PNG', async () => { const b = await api.commands.snapshotPNG(); if (b) download(`pixel-riot-${Date.now()}.png`, b); else api.ui.toast('SNAPSHOT NOT AVAILABLE'); }),
          button('EXPORT COMPOSITION', () => download(`pixel-riot-composition-${Date.now()}.json`, api.commands.exportComposition())),
          button('IMPORT COMPOSITION', async () => { const t = await pickFile(); if (!t) return; const r = api.commands.importComposition(t); api.ui.toast(r.ok ? 'COMPOSITION LOADED' : `IMPORT FAILED: ${r.errors[0]}`); }),
        ]),
        row([
          button('CLEAR ARTWORK', () => { api.commands.clearArtwork(); api.ui.toast('ARTWORK CLEARED (UNDO AVAILABLE)'); }),
          button('RESET SIMULATION', () => { api.commands.resetSimulation(); api.ui.toast('SIMULATION RESET'); }),
          button('RESTORE DEFAULT SETTINGS', () => { if (confirm('RESTORE DEFAULT SETTINGS? Presets and artwork are kept.')) { api.commands.restoreDefaults(); api.ui.toast('DEFAULT SETTINGS RESTORED'); } }, { cls: 'pr-danger' }),
        ]),
        note('CLEAR ARTWORK removes painted cells (undoable). RESET SIMULATION stops effects, energy, chains and loops but keeps artwork. RESTORE DEFAULT SETTINGS resets preferences only. Presets are deleted individually in PRESETS.'),
      );
    },
  },
  {
    id: 'core.extensions', title: 'EXTENSIONS', order: 100,
    render(c, api) {
      const list = el('div', { class: 'pr-list' });
      const draw = () => {
        list.textContent = '';
        for (const p of api.commands.plugins.list()) {
          const status = `${p.status.toUpperCase()}${p.core ? ' · CORE' : ''}`;
          const kids = [el('div', { class: 'pr-grow' }, [el('strong', { text: p.name }), el('div', { class: 'pr-note', text: `${p.id} · ${p.type} · v${p.version} · ${status}` }), ...p.errors.slice(-2).map((e) => el('div', { class: 'pr-err', text: e }))])];
          if (!p.core) kids.push(toggle('ENABLED', () => !p.disabled && p.status !== 'failed', (on) => { api.commands.plugins.setEnabled(p.id, on); setTimeout(draw, 0); }));
          list.append(row(kids, 'pr-plugin-row'));
        }
      };
      draw();
      c.append(note(`API ${API_VERSION}. Extensions are listed in src/extensions/registry.js.`), list);
    },
  },
  {
    id: 'core.help', title: 'HOW TO PLAY', order: 200,
    render(c) {
      const items = [
        ['TAP', 'burst + click + ripple'], ['DOUBLE TAP', 'explosion + chain reaction'], ['SWIPE', 'trail; fast release = sweep + colour cascade'],
        ['REVERSE A DRAG', 'reversed wave'], ['DRAW A CIRCLE', 'spiral'], ['HOLD', 'charge energy + rising tone; lift to release'],
        ['TWO-FINGER SPREAD', 'radial expansion + chord'], ['TWO-FINGER PINCH IN', 'corridor'], ['TWO-FINGER TWIST', 'rotating blocks + pitch bend'],
        ['THREE FINGERS', 'symmetry explosion'], ['STEADY TAPS', 'rhythm: scanners + pulse (sets tempo in musical mode)'],
      ];
      c.append(el('dl', { class: 'pr-help' }, items.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })])));
      c.append(note('EFFECT changes what each gesture does. Behaviour per effect set is listed in PLAY.'));
    },
  },
];

export default {
  manifest: { id: 'core.ui', name: 'Core UI Panels', version: '1.0.0', type: 'pack', core: true, apiVersion: API_VERSION, description: `${CORE_PANELS.length} settings panels`, capabilities: ['ui'] },
  register(api) { for (const p of CORE_PANELS) api.ui.panels.register(p); },
};
