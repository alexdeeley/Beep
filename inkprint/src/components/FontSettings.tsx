import { useDeferredValue, useMemo, useState } from 'react';
import { setPrefs, usePrefs } from '../app/prefs';
import { useStore } from '../app/ProjectContext';
import { CHAR_GROUPS, CHARSET_PRESETS, isDrawable, splitChars } from '../data/character-sets';
import { defaultCopyright } from '../modules/font-generation/build-font';
import { STYLE_STROKES } from '../modules/storage/project-factory';
import { DEFAULT_LAYOUT, DEFAULT_METRICS, DEFAULT_STROKE } from '../types/font-metrics';
import type { HandwritingStyle, Project } from '../types/project';
import { announce, Slider, TextField } from './ui';
import { WordSample } from './WordSample';

const STYLES: { v: HandwritingStyle; label: string }[] = [
  { v: 'natural', label: 'Natural' },
  { v: 'print', label: 'Print' },
  { v: 'cursive', label: 'Cursive (letters drawn separately)' },
  { v: 'block', label: 'Block lettering' },
  { v: 'experimental', label: 'Experimental' },
];

type Shape = Pick<Project, 'metrics' | 'stroke' | 'layout'>;

export function FontSettings() {
  const store = useStore();
  const { project } = store;
  const prefs = usePrefs();
  const [draft, setDraft] = useState<Shape>({ metrics: project.metrics, stroke: project.stroke, layout: project.layout });
  const deferred = useDeferredValue(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify({ metrics: project.metrics, stroke: project.stroke, layout: project.layout });

  const sample = useMemo(() => {
    const prefer = Array.from('HamburgefontsivHO');
    const drawn = prefer.filter((c) => store.glyph(c).strokes.length > 0);
    const pool = drawn.length >= 4 ? drawn : store.inventory.map((e) => e.char).filter((c) => store.glyph(c).strokes.length > 0);
    return [...new Set(pool)].slice(0, 9).map((c) => store.glyph(c));
  }, [store, store.version]);

  const set = <K extends keyof Shape>(k: K, patch: Partial<Shape[K]>) => setDraft((d) => ({ ...d, [k]: { ...d[k], ...patch } }));
  const apply = () => {
    store.updateProject(draft);
    announce('Settings applied. Your original strokes are unchanged.');
  };

  const [custom, setCustom] = useState(project.customChars);
  const toggleGroup = (g: string, on: boolean) => store.updateProject((p) => ({ groups: on ? CHAR_GROUPS.map((x) => x.id).filter((id) => id === g || p.groups.includes(id)) : p.groups.filter((x) => x !== g) }));

  return (
    <div className="settings">
      <section className="settings-section" aria-labelledby="s-details">
        <h2 id="s-details">Font details</h2>
        <TextField label="Font family name" value={project.familyName} maxLength={63} onChange={(v) => store.updateProject({ familyName: v })} hint="The name you will pick in Word, Pages or Photoshop." />
        <TextField label="Project name" value={project.name} maxLength={120} onChange={(v) => store.updateProject({ name: v })} hint="Only used in Inkprint's project list." />
        <TextField label="Designer (optional)" value={project.designer} maxLength={120} onChange={(v) => store.updateProject({ designer: v })} />
        <TextField label="Copyright notice" value={project.copyright} maxLength={300} onChange={(v) => store.updateProject({ copyright: v })} />
        <button className="link" onClick={() => store.updateProject({ copyright: defaultCopyright(project) })}>Use the default notice</button>
        <TextField label="Version" value={project.version} maxLength={10} onChange={(v) => store.updateProject({ version: v })} hint="For example 1.000, then 1.001 for the next export. Raising it helps apps notice an update." />
        <div className="field">
          <label htmlFor="style-select">Handwriting style</label>
          <select
            id="style-select"
            value={project.style}
            onChange={(e) => {
              const style = e.target.value as HandwritingStyle;
              store.updateProject({ style });
              setDraft((d) => ({ ...d, stroke: { ...DEFAULT_STROKE, ...STYLE_STROKES[style] } }));
              announce('Suggested pen settings for this style are ready below. Apply them to use them.');
            }}
          >
            {STYLES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
          </select>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="s-chars">
        <h2 id="s-chars">Character set</h2>
        <div className="toolbar">
          {CHARSET_PRESETS.map((p) => (
            <button key={p.id} className="chip" aria-pressed={JSON.stringify(p.groups) === JSON.stringify(project.groups)} onClick={() => store.updateProject({ groups: p.groups })}>
              {p.label}
            </button>
          ))}
        </div>
        <fieldset className="checks-col">
          <legend className="visually-hidden">Groups</legend>
          {CHAR_GROUPS.map((g) => (
            <label key={g.id} className="check">
              <input type="checkbox" checked={project.groups.includes(g.id)} onChange={(e) => toggleGroup(g.id, e.target.checked)} />
              {g.label} <span className="hint">({g.chars.length}: {g.chars.slice(0, 8).join(' ')}{g.chars.length > 8 ? ' …' : ''})</span>
            </label>
          ))}
        </fieldset>
        <div className="field">
          <label htmlFor="custom-chars">Extra characters</label>
          <input id="custom-chars" type="text" value={custom} onChange={(e) => setCustom(e.target.value)} onBlur={() => store.updateProject({ customChars: splitChars(custom).filter(isDrawable).join('') })} placeholder="e.g. ŁłŠšΩ★♥" />
          <p className="hint">Type or paste any characters to add them to the set. Removing a group never deletes your drawings; they just leave the font until you add the group back.</p>
        </div>
        <p>{store.inventory.length} characters to draw, plus the space.</p>
      </section>

      <section className="settings-section" aria-labelledby="s-shape">
        <h2 id="s-shape">Shape, size and spacing</h2>
        <p className="hint">These settings change how your strokes become the font. Your original strokes are always kept, so every change can be undone or reset.</p>
        {sample.length > 0 ? (
          <div className="before-after" aria-live="polite">
            <WordSample project={project} records={sample} label="Before" />
            <WordSample project={{ ...project, ...deferred }} records={sample} label={dirty ? 'After' : 'After (no changes yet)'} />
          </div>
        ) : (
          <p className="hint">Draw a few letters to see a before-and-after preview here.</p>
        )}

        <h3>Pen</h3>
        <Slider label="Weight (stroke thickness)" value={draft.stroke.size} min={12} max={120} step={1} onChange={(v) => set('stroke', { size: v })} />
        <Slider label="Pressure effect" value={draft.stroke.thinning} min={0} max={0.9} step={0.05} onChange={(v) => set('stroke', { thinning: v })} format={(v) => `${Math.round(v * 100)}%`} hint="How much a lighter touch (or a faster stroke) thins the line." />
        <Slider label="Stroke smoothing" value={draft.stroke.streamline} min={0} max={0.9} step={0.05} onChange={(v) => set('stroke', { streamline: v })} format={(v) => `${Math.round(v * 100)}%`} hint="Irons out wobble. High values also soften corners." />
        <Slider label="Outline softness" value={draft.stroke.smoothing} min={0} max={1} step={0.05} onChange={(v) => set('stroke', { smoothing: v })} format={(v) => `${Math.round(v * 100)}%`} />

        <h3>Placement</h3>
        <Slider label="Glyph scale" value={draft.layout.glyphScale} min={0.5} max={1.5} step={0.01} onChange={(v) => set('layout', { glyphScale: v })} format={(v) => `${Math.round(v * 100)}%`} />
        <Slider label="Baseline adjustment" value={draft.layout.baselineShift} min={-150} max={150} step={2} onChange={(v) => set('layout', { baselineShift: v })} hint="Moves every glyph up or down." />

        <h3>Spacing</h3>
        <Slider label="Space around each letter" value={draft.layout.sidebearing} min={0} max={200} step={2} onChange={(v) => set('layout', { sidebearing: v })} hint="Horizontal positioning: the default left and right sidebearing." />
        <Slider label="Letter spacing (tracking)" value={draft.layout.tracking} min={-80} max={200} step={2} onChange={(v) => set('layout', { tracking: v })} />
        <Slider label="Word space" value={draft.layout.spaceWidth} min={100} max={800} step={5} onChange={(v) => set('layout', { spaceWidth: v })} />

        <h3>Proportions</h3>
        <p className="hint">Where the guide lines sit on the canvas and the heights recorded in the font. Changing them does not move strokes you have already drawn.</p>
        <Slider label="Cap height" value={draft.metrics.capHeight} min={450} max={850} step={5} onChange={(v) => set('metrics', { capHeight: v })} />
        <Slider label="x-height" value={draft.metrics.xHeight} min={250} max={650} step={5} onChange={(v) => set('metrics', { xHeight: v })} />
        <Slider label="Ascender height" value={draft.metrics.ascender} min={450} max={900} step={5} onChange={(v) => set('metrics', { ascender: v })} />
        <Slider label="Descender depth" value={draft.metrics.descender} min={-300} max={-80} step={5} onChange={(v) => set('metrics', { descender: v })} />

        <div className="sticky-actions">
          <button className="btn btn-primary" disabled={!dirty} onClick={apply}>Apply changes</button>
          <button className="btn btn-secondary" disabled={!dirty} onClick={() => setDraft({ metrics: project.metrics, stroke: project.stroke, layout: project.layout })}>Discard</button>
          <button className="btn btn-secondary" onClick={() => setDraft({ metrics: { ...DEFAULT_METRICS }, stroke: { ...DEFAULT_STROKE, ...STYLE_STROKES[project.style] }, layout: { ...DEFAULT_LAYOUT } })}>Reset to defaults</button>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="s-display">
        <h2 id="s-display">Display on this device</h2>
        <fieldset className="segmented">
          <legend>Text size</legend>
          {([1, 1.15, 1.3] as const).map((s) => (
            <label key={s}><input type="radio" name="textscale" checked={prefs.textScale === s} onChange={() => setPrefs({ textScale: s })} /> {s === 1 ? 'Standard' : s === 1.15 ? 'Large' : 'Larger'}</label>
          ))}
        </fieldset>
        <label className="check"><input type="checkbox" checked={prefs.highContrast} onChange={(e) => setPrefs({ highContrast: e.target.checked })} /> Maximum contrast (pure black and white, thicker outlines)</label>
        <label className="check"><input type="checkbox" checked={project.canvasTheme === 'dark'} onChange={(e) => store.updateProject({ canvasTheme: e.target.checked ? 'dark' : 'light' })} /> Dark drawing canvas</label>
      </section>
    </div>
  );
}
