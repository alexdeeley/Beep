import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '../app/ProjectContext';
import { navigate } from '../app/router';
import { CharacterPicker, GroupTabs } from '../components/CharacterNavigation';
import { CharacterProgress } from '../components/CharacterProgress';
import { ContextStrip } from '../components/ContextStrip';
import { DrawingCanvas } from '../components/DrawingCanvas';
import { ProjectBar } from '../components/ProjectBar';
import { announce, confirmAction, Slider, StatusTag } from '../components/ui';
import { baseLetter, charName, codePointLabel, groupLabel } from '../data/character-sets';
import type { Stroke } from '../types/glyph';
import { DEFAULT_GHOST } from '../types/project';

type Panel = null | 'ghost' | 'pen' | 'fit';

export function Studio({ id, char: routeChar, queue }: { id: string; char: string | null; queue: 'all' | 'unfinished' }) {
  const store = useStore();
  const { project, inventory } = store;
  const fallbackChar = (project.lastChar && inventory.some((e) => e.char === project.lastChar) ? project.lastChar : inventory[0]?.char) ?? null;
  const char = routeChar ?? fallbackChar;
  const index = inventory.findIndex((e) => e.char === char);
  const [panel, setPanel] = useState<Panel>(null);
  const [picker, setPicker] = useState(false);

  useEffect(() => {
    if (char && char !== project.lastChar && index >= 0) store.updateProject({ lastChar: char });
  }, [char, index, project.lastChar, store]);

  const go = useCallback((c: string, replace = false) => navigate({ name: 'draw', id, char: c, queue }, replace), [id, queue]);

  const glyph = char ? store.glyph(char) : null;
  const strokes = glyph?.strokes ?? [];
  const status = char ? store.status(char) : 'empty';

  const nextChar = useCallback(
    (from: number): string | null => {
      if (queue === 'unfinished') {
        for (let k = 1; k <= inventory.length; k++) {
          const e = inventory[(from + k) % inventory.length];
          if (e.char !== char && store.status(e.char) !== 'complete') return e.char;
        }
        return null;
      }
      return inventory[from + 1]?.char ?? null;
    },
    [inventory, queue, char, store],
  );

  const onNext = useCallback(() => {
    if (!char) return;
    if (strokes.length > 0 && (status === 'in-progress' || status === 'empty')) store.setStatus(char, 'complete');
    const n = nextChar(index);
    if (n) go(n);
    else navigate({ name: 'done', id });
  }, [char, strokes.length, status, store, nextChar, index, go, id]);

  const onBack = useCallback(() => {
    if (index > 0) go(inventory[index - 1].char);
  }, [index, inventory, go]);

  const onSkip = useCallback(() => {
    const n = nextChar(index);
    if (n) { go(n); announce(`Skipped ${charName(char!)}. It stays unfinished.`); }
    else navigate({ name: 'done', id });
  }, [nextChar, index, go, char, id]);

  const onUndo = useCallback(() => { if (char && store.canUndo(char)) { store.undo(char); announce('Undid the last change'); } }, [char, store]);
  const onRedo = useCallback(() => { if (char && store.canRedo(char)) { store.redo(char); announce('Redid the change'); } }, [char, store]);

  const onClear = useCallback(async () => {
    if (!char || strokes.length === 0) return;
    if (status === 'complete' || strokes.length >= 4) {
      const ok = await confirmAction(`Clear ${char}?`, `This removes all ${strokes.length} strokes of ${charName(char)}. Undo can bring them back while you stay in this session.`, 'Clear drawing', true);
      if (!ok) return;
    }
    store.setStrokes(char, []);
    announce(`Cleared ${charName(char)}. Undo brings it back.`);
  }, [char, strokes.length, status, store]);

  const onStroke = useCallback((s: Stroke) => { if (char) store.addStroke(char, s); }, [char, store]);

  // Keyboard: arrows move, Cmd/Ctrl+Z undo, Shift+Cmd/Ctrl+Z or Ctrl+Y redo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, dialog[open]')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) onRedo(); else onUndo(); }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); onRedo(); }
      else if (!mod && e.key === 'ArrowRight') { e.preventDefault(); onNext(); }
      else if (!mod && e.key === 'ArrowLeft') { e.preventDefault(); onBack(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onUndo, onRedo, onNext, onBack]);

  const base = char ? baseLetter(char) : null;
  const baseStrokes = base ? store.glyph(base).strokes : [];
  const onCopyBase = async () => {
    if (!char || !base) return;
    if (strokes.length && !(await confirmAction(`Replace ${char} with ${base}?`, `Your drawing of ${char} is replaced by a copy of ${base}; then add the accent. Undo brings it back.`, `Copy ${base}`))) return;
    store.setStrokes(char, baseStrokes.map((s) => ({ ...s, points: s.points.slice() })));
    announce(`Copied ${base}. Now add the accent.`);
  };

  const ghost = project.ghost;
  const setGhost = (patch: Partial<typeof ghost>) => store.updateProject((p) => ({ ghost: { ...p.ghost, ...patch } }));
  const setPen = (patch: Partial<typeof project.stroke>) => store.updateProject((p) => ({ stroke: { ...p.stroke, ...patch } }));
  const adjust = glyph?.adjust;

  const label = useMemo(() => (char ? `Drawing canvas for ${charName(char)}. ${strokes.length} strokes.` : 'Drawing canvas'), [char, strokes.length]);

  if (!inventory.length) {
    return (
      <>
        <ProjectBar current="draw" />
        <main className="page narrow">
          <h1>No characters to draw</h1>
          <p>This project's character set is empty. Choose some character groups in Settings.</p>
          <a className="btn btn-primary" href={`#/p/${encodeURIComponent(id)}/settings`}>Open settings</a>
        </main>
      </>
    );
  }
  if (!char || index < 0) {
    return (
      <>
        <ProjectBar current="draw" />
        <main className="page narrow">
          <h1>“{routeChar}” is not in this font’s character set</h1>
          <p>Add it as a custom character in Settings, or go back to the first character.</p>
          <button className="btn btn-primary" onClick={() => go(inventory[0].char, true)}>Go to {inventory[0].char}</button>
        </main>
      </>
    );
  }

  const groupId = inventory[index].groupId;
  return (
    <>
      <ProjectBar current="draw" />
      <main className="studio" aria-label={`Drawing studio: ${charName(char)}`}>
        <section className="studio-head">
          <div className="current-char">
            <p className="eyebrow">CURRENT CHARACTER</p>
            <div className="current-row">
              <span className="current-glyph" aria-hidden="true">{char}</span>
              <div>
                <h1 className="current-name">{charName(char)}</h1>
                <p className="current-meta">{groupLabel(groupId)} · {codePointLabel(char)}</p>
                <StatusTag status={status} />
                {queue === 'unfinished' && <p className="queue-note">Going through unfinished characters · <a href={`#/p/${encodeURIComponent(id)}/draw/${encodeURIComponent(char)}`}>show all</a></p>}
              </div>
            </div>
          </div>
          <CharacterProgress store={store} index={index} />
        </section>

        <GroupTabs store={store} current={char} onJump={(c) => go(c)} />

        <div className="canvas-wrap">
            <DrawingCanvas
              char={char}
              strokes={strokes}
              style={project.stroke}
              metrics={project.metrics}
              ghost={ghost}
              showGuides={project.showGuides}
              theme={project.canvasTheme}
              label={label}
              onStroke={onStroke}
            />
        </div>

        <div className="studio-side">
            <div className="main-controls" role="toolbar" aria-label="Drawing controls">
              <button className="btn btn-secondary" onClick={onBack} disabled={index === 0} aria-keyshortcuts="ArrowLeft">
                <span aria-hidden="true">←</span> BACK
              </button>
              <button className="btn btn-secondary" onClick={onUndo} disabled={!store.canUndo(char)} aria-keyshortcuts="Control+Z Meta+Z">UNDO</button>
              <button className="btn btn-secondary" onClick={onRedo} disabled={!store.canRedo(char)} aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z">REDO</button>
              <button className="btn btn-secondary" onClick={onClear} disabled={strokes.length === 0}>CLEAR</button>
              <button className="btn btn-primary btn-next" onClick={onNext} aria-keyshortcuts="ArrowRight">
                NEXT <span aria-hidden="true">→</span>
              </button>
            </div>

            <div className="secondary-controls">
              <button className="chip" aria-pressed={status === 'complete'} disabled={strokes.length === 0} onClick={() => store.setStatus(char, status === 'complete' ? 'in-progress' : 'complete')}>
                <span aria-hidden="true">●</span> Complete
              </button>
              <button className="chip" aria-pressed={status === 'needs-revision'} onClick={() => store.setStatus(char, status === 'needs-revision' ? (strokes.length ? 'in-progress' : 'empty') : 'needs-revision')}>
                <span aria-hidden="true">⚑</span> Needs revision
              </button>
              <button className="chip" onClick={onSkip}>Skip for now</button>
              <button className="chip" onClick={() => setPicker(true)}>Jump to…</button>
              <button
                className="chip"
                onClick={() => {
                  const n = inventory.find((e, i) => i > index && store.status(e.char) !== 'complete') ?? inventory.find((e) => e.char !== char && store.status(e.char) !== 'complete');
                  if (n) navigate({ name: 'draw', id, char: n.char, queue: 'unfinished' });
                  else announce('Every character is complete.');
                }}
              >
                Next unfinished
              </button>
              {base && baseStrokes.length > 0 && (
                <button className="chip" onClick={onCopyBase}>Start from {base}</button>
              )}
            </div>

            <div className="panel-toggles" role="group" aria-label="Options">
              <button className="chip" aria-pressed={ghost.visible} onClick={() => setGhost({ visible: !ghost.visible })}>
                Guide letter {ghost.visible ? 'on' : 'off'}
              </button>
              <button className="chip" aria-expanded={panel === 'ghost'} onClick={() => setPanel(panel === 'ghost' ? null : 'ghost')}>Canvas</button>
              <button className="chip" aria-expanded={panel === 'pen'} onClick={() => setPanel(panel === 'pen' ? null : 'pen')}>Pen</button>
              <button className="chip" aria-expanded={panel === 'fit'} onClick={() => setPanel(panel === 'fit' ? null : 'fit')}>Fit &amp; spacing</button>
            </div>

            {panel === 'ghost' && (
              <section className="panel" aria-label="Canvas options">
                <fieldset className="segmented">
                  <legend>Behind your drawing</legend>
                  <label><input type="radio" name="ghostmode" checked={ghost.visible} onChange={() => setGhost({ visible: true })} /> Reference shape</label>
                  <label><input type="radio" name="ghostmode" checked={!ghost.visible} onChange={() => setGhost({ visible: false })} /> Blank canvas</label>
                </fieldset>
                <Slider label="Guide opacity" value={ghost.opacity} min={0.05} max={0.6} step={0.01} onChange={(v) => setGhost({ opacity: v })} format={(v) => `${Math.round(v * 100)}%`} />
                <Slider label="Guide size" value={ghost.scale} min={0.6} max={1.4} step={0.01} onChange={(v) => setGhost({ scale: v })} format={(v) => `${Math.round(v * 100)}%`} />
                <Slider label="Guide position" value={ghost.offsetY} min={-200} max={200} step={5} onChange={(v) => setGhost({ offsetY: v })} format={(v) => (v === 0 ? 'on baseline' : `${v > 0 ? '+' : ''}${v}`)} />
                <button className="btn btn-secondary" onClick={() => setGhost({ ...DEFAULT_GHOST, visible: ghost.visible })}>Reset guide</button>
                <label className="check"><input type="checkbox" checked={project.showGuides} onChange={(e) => store.updateProject({ showGuides: e.target.checked })} /> Show guide lines</label>
                <label className="check"><input type="checkbox" checked={project.canvasTheme === 'dark'} onChange={(e) => store.updateProject({ canvasTheme: e.target.checked ? 'dark' : 'light' })} /> Dark canvas</label>
              </section>
            )}

            {panel === 'pen' && (
              <section className="panel" aria-label="Pen">
                <p className="hint">These change how every stroke is drawn, for the whole font. Your original strokes are kept, so you can change them back any time.</p>
                <Slider label="Thickness" value={project.stroke.size} min={12} max={120} step={1} onChange={(v) => setPen({ size: v })} />
                <Slider label="Pressure effect" value={project.stroke.thinning} min={0} max={0.9} step={0.05} onChange={(v) => setPen({ thinning: v })} format={(v) => `${Math.round(v * 100)}%`} />
                <Slider label="Smoothing" value={project.stroke.streamline} min={0} max={0.9} step={0.05} onChange={(v) => setPen({ streamline: v })} format={(v) => `${Math.round(v * 100)}%`} />
              </section>
            )}

            {panel === 'fit' && adjust && (
              <section className="panel" aria-label="Fit and spacing for this character">
                <Slider label={`Size of ${char}`} value={adjust.scale} min={0.5} max={1.5} step={0.01} onChange={(v) => store.setAdjust(char, { scale: v })} format={(v) => `${Math.round(v * 100)}%`} />
                <Slider label="Move up / down" value={adjust.offsetY} min={-200} max={200} step={2} onChange={(v) => store.setAdjust(char, { offsetY: v })} />
                <Slider label="Space on the left" value={adjust.lsb} min={-100} max={200} step={2} onChange={(v) => store.setAdjust(char, { lsb: v })} />
                <Slider label="Space on the right" value={adjust.rsb} min={-100} max={200} step={2} onChange={(v) => store.setAdjust(char, { rsb: v })} />
                <button className="btn btn-secondary" onClick={() => store.setAdjust(char, { scale: 1, offsetY: 0, lsb: 0, rsb: 0 })}>Reset this character</button>
              </section>
            )}

            <ContextStrip store={store} char={char} version={store.version} />
          </div>
      </main>
      <CharacterPicker store={store} open={picker} current={char} onClose={() => setPicker(false)} onPick={(c) => { setPicker(false); go(c); }} />
    </>
  );
}
