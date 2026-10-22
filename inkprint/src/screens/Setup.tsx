import { useState } from 'react';
import { navigate } from '../app/router';
import { TextField } from '../components/ui';
import { CHAR_GROUPS, CHARSET_PRESETS, buildInventory, isDrawable, splitChars } from '../data/character-sets';
import { putProject, requestPersistence } from '../modules/storage/db';
import { newProject } from '../modules/storage/project-factory';
import type { HandwritingStyle } from '../types/project';

let pendingName = '';
/** The name typed on the welcome screen, carried into setup. */
export function setPendingName(n: string) { pendingName = n; }

const STYLES: { v: HandwritingStyle; label: string; hint: string }[] = [
  { v: 'natural', label: 'Natural', hint: 'However you normally write' },
  { v: 'print', label: 'Print', hint: 'Separate, upright letters' },
  { v: 'cursive', label: 'Cursive', hint: 'Joined-up look, each letter drawn on its own' },
  { v: 'block', label: 'Block', hint: 'Bold capitals and heavy strokes' },
  { v: 'experimental', label: 'Experimental', hint: 'Anything goes' },
];

export function Setup() {
  const [family, setFamily] = useState(pendingName || 'Inkprint Personal');
  const [designer, setDesigner] = useState('');
  const [style, setStyle] = useState<HandwritingStyle>('natural');
  const [preset, setPreset] = useState<string>('basic');
  const [groups, setGroups] = useState<string[]>(CHARSET_PRESETS[0].groups);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = buildInventory(groups, custom).length;

  const start = async () => {
    setBusy(true);
    try {
      const p = newProject({ familyName: family, designer, style, groups, customChars: splitChars(custom).filter(isDrawable).join('') });
      await putProject(p);
      void requestPersistence();
      const first = buildInventory(p.groups, p.customChars)[0]?.char ?? null;
      navigate({ name: 'draw', id: p.id, char: first, queue: 'all' }, true);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="page narrow setup">
      <p className="eyebrow"><a href="#/">INKPRINT</a></p>
      <h1>Set up your font</h1>
      <p className="lede">The defaults are fine: you can start drawing right away and change any of this later in Settings.</p>
      <form onSubmit={(e) => { e.preventDefault(); void start(); }}>
        <TextField label="Font family name" value={family} onChange={setFamily} maxLength={63} hint="How the font will be listed in your apps." />
        <TextField label="Your name (optional)" value={designer} onChange={setDesigner} maxLength={120} hint="Written into the font as its designer." />

        <fieldset className="choice-grid">
          <legend>Handwriting style</legend>
          {STYLES.map((s) => (
            <label key={s.v} className="choice">
              <input type="radio" name="style" checked={style === s.v} onChange={() => setStyle(s.v)} />
              <span><strong>{s.label}</strong><span className="hint">{s.hint}</span></span>
            </label>
          ))}
        </fieldset>
        {style === 'cursive' && <p className="hint">Each letter is drawn on its own. Letters will sit side by side rather than join up; draw entry and exit strokes to the baseline for a connected feel.</p>}

        <fieldset className="choice-grid">
          <legend>Character set</legend>
          {CHARSET_PRESETS.map((p) => (
            <label key={p.id} className="choice">
              <input type="radio" name="preset" checked={preset === p.id} onChange={() => { setPreset(p.id); setGroups(p.groups); }} />
              <span><strong>{p.label}</strong><span className="hint">{p.description} · {buildInventory(p.groups, '').length} characters</span></span>
            </label>
          ))}
          <label className="choice">
            <input type="radio" name="preset" checked={preset === 'custom'} onChange={() => setPreset('custom')} />
            <span><strong>Custom</strong><span className="hint">Pick groups and add your own characters</span></span>
          </label>
        </fieldset>
        {preset === 'custom' && (
          <div className="panel">
            {CHAR_GROUPS.map((g) => (
              <label key={g.id} className="check">
                <input type="checkbox" checked={groups.includes(g.id)} onChange={(e) => setGroups(e.target.checked ? CHAR_GROUPS.map((x) => x.id).filter((id) => id === g.id || groups.includes(id)) : groups.filter((x) => x !== g.id))} />
                {g.label}
              </label>
            ))}
            <TextField label="Extra characters" value={custom} onChange={setCustom} placeholder="e.g. ŁłŠš★♥" />
          </div>
        )}
        <p><strong>{count}</strong> characters to draw. Draw them over as many sessions as you like; your progress saves automatically.</p>
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="toolbar">
          <button className="btn btn-primary btn-huge" type="submit" disabled={busy || count === 0}>START DRAWING</button>
          <a className="btn btn-secondary" href="#/">Back</a>
        </div>
      </form>
    </main>
  );
}
