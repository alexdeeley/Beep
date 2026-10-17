import { useMemo, useState } from 'react';
import { useStore } from '../app/ProjectContext';
import { useGeneratedFont } from '../app/useGeneratedFont';
import { missingIn, PreviewText } from '../components/FontPreview';
import { ProjectBar } from '../components/ProjectBar';
import { Loading, Slider } from '../components/ui';
import { CHAR_GROUPS, charName } from '../data/character-sets';
import { contoursBBox } from '../modules/glyph-processing/contour';
import { checkConsistency, type Box } from '../modules/quality/consistency';

const PHRASES = ['Hello, world!', 'This is my handwriting.', 'Made entirely by me.', 'Today is a good day.', 'The quick brown fox jumps over the lazy dog.'];
const QUALITY_PARAGRAPH =
  'Sphinx of black quartz, judge my vow. Pack my box with five dozen liquor jugs! How vexingly quick daft zebras jump; the five boxing wizards jump quickly.';

type Mode = 'alphabet' | 'numbers' | 'punctuation' | 'custom' | 'phrases' | 'quality';

export function Preview({ id }: { id: string }) {
  const store = useStore();
  const live = useGeneratedFont(store, store.version);
  const [mode, setMode] = useState<Mode>('custom');
  const [text, setText] = useState('The quick brown fox jumps over the lazy dog.');
  const [size, setSize] = useState(56);
  const [tracking, setTracking] = useState(0);
  const [leading, setLeading] = useState(1.3);
  const [dark, setDark] = useState(false);

  const symbols = [...(CHAR_GROUPS.find((g) => g.id === 'punctuation')!.chars), ...(CHAR_GROUPS.find((g) => g.id === 'symbols')!.chars)].join(' ');
  const samples: Record<Exclude<Mode, 'custom' | 'quality'>, string[]> = {
    alphabet: ['ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ', 'abcdefghijklm', 'nopqrstuvwxyz'],
    numbers: ['0123456789', '24/7 · 3.14 · 1,000'],
    punctuation: [symbols],
    phrases: PHRASES,
  };
  const shownText = mode === 'custom' ? text : mode === 'quality' ? QUALITY_PARAGRAPH : samples[mode].join('\n');
  const missing = live.family ? missingIn(shownText, live.chars) : [];

  const issues = useMemo(() => {
    const boxes = new Map<string, Box>();
    for (const { char } of store.inventory) {
      const bb = contoursBBox(store.contours(char));
      if (bb) boxes.set(char, bb);
    }
    return checkConsistency(boxes, store.project.metrics);
  }, [store, store.version]);

  const textStyle = { fontSize: `${size}px`, letterSpacing: `${tracking}em`, lineHeight: leading };
  const modes: { v: Mode; label: string }[] = [
    { v: 'custom', label: 'Your text' },
    { v: 'phrases', label: 'Phrases' },
    { v: 'alphabet', label: 'Alphabet' },
    { v: 'numbers', label: 'Numbers' },
    { v: 'punctuation', label: 'Punctuation' },
    { v: 'quality', label: 'Quality check' },
  ];

  return (
    <>
      <ProjectBar current="preview" />
      <main className="page">
        <div className="page-head">
          <h1>Preview your font</h1>
          <p className="lede" aria-live="polite">
            {live.status === 'error' ? (
              <span className="error-text">The font could not be built: {live.error}</span>
            ) : live.font ? (
              <>
                Set in the real generated font file ({live.font.fileName}, {Math.round(live.font.bytes.length / 1024)} KB, {live.font.report.included.length} drawn characters), loaded into this page.
                {live.status === 'building' && ' Updating…'}
              </>
            ) : (
              'Building your font…'
            )}
          </p>
        </div>

        <div className="mode-tabs" role="tablist" aria-label="Preview">
          {modes.map((m) => (
            <button key={m.v} role="tab" aria-selected={mode === m.v} className="mode-tab" onClick={() => setMode(m.v)}>{m.label}</button>
          ))}
        </div>

        {mode === 'custom' && (
          <div className="field">
            <label htmlFor="preview-input">Type anything</label>
            <textarea id="preview-input" rows={3} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
          </div>
        )}

        <div className={`specimen ${dark ? 'specimen-dark' : 'specimen-light'}`}>
          {!live.family ? (
            <Loading text={live.status === 'error' ? 'No preview available' : 'Building your font…'} />
          ) : mode === 'phrases' ? (
            PHRASES.map((p) => <PreviewText key={p} text={p} family={live.family!} chars={live.chars} style={textStyle} className="phrase" />)
          ) : (
            <PreviewText text={shownText} family={live.family} chars={live.chars} style={textStyle} />
          )}
        </div>

        {missing.length > 0 && (
          <div className="missing-list" role="note">
            <p>
              <strong>Not drawn yet:</strong> boxed characters above use a placeholder and are not in your font.
            </p>
            <ul className="inline-list">
              {missing.map((c) => (
                <li key={c}><a className="chip" href={`#/p/${encodeURIComponent(id)}/draw/${encodeURIComponent(c)}`} aria-label={`Draw ${charName(c)}`}>{c}</a></li>
              ))}
            </ul>
          </div>
        )}

        <section className="controls-grid" aria-label="Preview settings">
          <Slider label="Size" value={size} min={14} max={200} step={1} onChange={setSize} format={(v) => `${v}px`} />
          <Slider label="Letter spacing" value={tracking} min={-0.1} max={0.5} step={0.01} onChange={setTracking} format={(v) => `${v.toFixed(2)} em`} />
          <Slider label="Line height" value={leading} min={0.8} max={2.5} step={0.05} onChange={setLeading} format={(v) => v.toFixed(2)} />
          <label className="check"><input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} /> Dark background</label>
          <p className="hint">These settings only change this preview, not your font. Spacing that goes into the font lives in Settings.</p>
        </section>

        {mode === 'quality' && (
          <section className="quality" aria-labelledby="quality-h">
            <h2 id="quality-h">Consistency check</h2>
            <p className="hint">Letters that stray from the rest of your own handwriting. Tap one to fix it.</p>
            {issues.length === 0 ? (
              <p>Nothing stands out. Your letters agree on their heights and baseline.</p>
            ) : (
              <ul className="issue-list">
                {issues.map((i, k) => (
                  <li key={k} className={`issue issue-${i.severity}`}>
                    <a href={`#/p/${encodeURIComponent(id)}/draw/${encodeURIComponent(i.char)}`}>
                      <span className="issue-char" aria-hidden="true">{i.char}</span>
                      <span><span className="issue-sev">{i.severity === 'warning' ? '▲ Check' : '△ Notice'}</span> {i.message}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </main>
    </>
  );
}
