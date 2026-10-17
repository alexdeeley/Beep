import { useState } from 'react';
import { useStore } from '../app/ProjectContext';
import { useGeneratedFont } from '../app/useGeneratedFont';
import { charName } from '../data/character-sets';
import { backupFileName, createBackup } from '../modules/project-import-export/backup';
import { downloadBlob, downloadBytes, shareFile } from '../modules/project-import-export/download';
import { renderSpecimen } from '../modules/project-import-export/specimen';
import { PreviewText } from './FontPreview';
import { announce } from './ui';

function CharList({ chars, id, max = 40 }: { chars: string[]; id: string; max?: number }) {
  return (
    <ul className="inline-list">
      {chars.slice(0, max).map((c) => (
        <li key={c}><a className="chip small" href={`#/p/${encodeURIComponent(id)}/draw/${encodeURIComponent(c)}`} aria-label={`Draw ${charName(c)}`}>{c}</a></li>
      ))}
      {chars.length > max && <li className="hint">and {chars.length - max} more</li>}
    </ul>
  );
}

export function ExportPanel({ id }: { id: string }) {
  const store = useStore();
  const { project } = store;
  const format = project.exportFormat;
  const live = useGeneratedFont(store, store.version, format, 150);
  const [last, setLast] = useState<{ name: string; bytes: Uint8Array; mime: string } | null>(null);
  const font = live.font;
  const errors = font?.validation.issues.filter((i) => i.level === 'error') ?? [];
  const warnings = font?.validation.issues.filter((i) => i.level === 'warning') ?? [];
  const browserOk = live.status !== 'error' && !!live.family;
  const canDownload = !!font && font.validation.ok && browserOk && live.status === 'ready';
  const revision = font ? font.report.unfinished.filter((c) => store.status(c) === 'needs-revision') : [];
  const inProgress = font ? font.report.unfinished.filter((c) => store.status(c) === 'in-progress') : [];

  const download = () => {
    if (!font || !canDownload) return;
    downloadBytes(font.bytes, font.fileName, font.mime);
    setLast({ name: font.fileName, bytes: font.bytes, mime: font.mime });
    announce(`Downloaded ${font.fileName}`);
  };

  return (
    <div className="export">
      <section className="export-summary" aria-labelledby="sum-h">
        <h2 id="sum-h" className="visually-hidden">Summary</h2>
        <dl className="stats">
          <div><dt>Font family</dt><dd>{project.familyName}</dd></div>
          <div><dt>Characters drawn</dt><dd>{font ? font.report.included.length : '…'}</dd></div>
          <div><dt>Still missing</dt><dd>{font ? font.report.missing.length : '…'}</dd></div>
          <div><dt>File</dt><dd>{font ? `${font.fileName} · ${Math.round(font.bytes.length / 1024)} KB` : '…'}</dd></div>
        </dl>
      </section>

      <fieldset className="segmented format-choice">
        <legend>Format</legend>
        <label>
          <input type="radio" name="format" checked={format === 'ttf'} onChange={() => store.updateProject({ exportFormat: 'ttf' })} />
          <span><strong>TrueType (.ttf)</strong> Recommended. Works in Word, Pages, Photoshop, Canva, Windows, macOS and Linux.</span>
        </label>
        <label>
          <input type="radio" name="format" checked={format === 'otf'} onChange={() => store.updateProject({ exportFormat: 'otf' })} />
          <span><strong>OpenType CFF (.otf)</strong> The same letters with PostScript-style outlines, preferred by some design apps.</span>
        </label>
      </fieldset>

      <section className={`specimen specimen-light export-specimen`} aria-label="Specimen in the generated font">
        {live.family ? (
          <>
            <PreviewText text={project.familyName} family={live.family} chars={live.chars} style={{ fontSize: 'clamp(40px, 9vw, 96px)', lineHeight: 1.1 }} />
            <PreviewText text={'ABCDEFGHIJKLMNOPQRSTUVWXYZ\nabcdefghijklmnopqrstuvwxyz 0123456789'} family={live.family} chars={live.chars} style={{ fontSize: 'clamp(22px, 4vw, 40px)', lineHeight: 1.3 }} />
          </>
        ) : (
          <p>{live.status === 'error' ? 'No specimen: the font did not build.' : 'Building your font…'}</p>
        )}
      </section>

      <section className="checks" aria-labelledby="checks-h" aria-live="polite">
        <h2 id="checks-h">Checks</h2>
        <ul className="check-list">
          <li className={font?.validation.ok ? 'ok' : errors.length ? 'bad' : ''}>
            <span aria-hidden="true">{font?.validation.ok ? '✓' : errors.length ? '✕' : '…'}</span>
            {font ? (font.validation.ok ? `Valid ${format === 'ttf' ? 'TrueType' : 'OpenType CFF'} file: tables, checksums, ${font.validation.numGlyphs} glyphs and character mappings verified.` : 'The file failed validation.') : 'Validating…'}
          </li>
          <li className={browserOk && live.status === 'ready' ? 'ok' : live.status === 'error' ? 'bad' : ''}>
            <span aria-hidden="true">{browserOk && live.status === 'ready' ? '✓' : live.status === 'error' ? '✕' : '…'}</span>
            {live.status === 'error' ? `This browser refused the font: ${live.error}` : browserOk ? "Loaded by this browser's own font engine." : 'Loading into the browser…'}
          </li>
          {errors.map((e, i) => (
            <li key={`e${i}`} className="bad"><span aria-hidden="true">✕</span> {e.message}</li>
          ))}
          {warnings.map((w, i) => (
            <li key={`w${i}`} className="warn"><span aria-hidden="true">!</span> {w.message}</li>
          ))}
        </ul>
        {font && font.report.missing.length > 0 && (
          <div className="warn-block">
            <p><span aria-hidden="true">! </span>{font.report.missing.length} characters are not drawn and will not be in the font. Apps will show a fallback font for them.</p>
            <CharList chars={font.report.missing} id={id} />
          </div>
        )}
        {revision.length > 0 && (
          <div className="warn-block">
            <p><span aria-hidden="true">⚑ </span>Flagged for revision but included as drawn:</p>
            <CharList chars={revision} id={id} />
          </div>
        )}
        {inProgress.length > 0 && (
          <div className="warn-block">
            <p><span aria-hidden="true">◐ </span>Not marked complete yet but included as drawn:</p>
            <CharList chars={inProgress} id={id} />
          </div>
        )}
      </section>

      <div className="download-row">
        <button className="btn btn-primary btn-huge" onClick={download} disabled={!canDownload} aria-describedby="dl-note">
          DOWNLOAD MY FONT
        </button>
        <p id="dl-note" className="hint">
          {canDownload ? `Saves ${font!.fileName}. You can keep drawing and export again any time.` : live.status === 'error' || errors.length ? 'Fix the problems above to download.' : 'Preparing…'}
        </p>
        {last && (
          <p className="done-note" role="status">
            <span aria-hidden="true">✓ </span>Downloaded <strong>{last.name}</strong>.{' '}
            <button className="link" onClick={() => downloadBytes(last.bytes, last.name, last.mime)}>Download again</button>
            {' · '}
            <button
              className="link"
              onClick={async () => {
                const r = await shareFile(last.bytes, last.name, last.mime);
                if (r === 'unsupported') announce('Sharing files is not supported in this browser. Use Download instead.');
              }}
            >
              Share…
            </button>
          </p>
        )}
      </div>

      <section className="more-downloads" aria-labelledby="more-h">
        <h2 id="more-h">Also download</h2>
        <div className="toolbar">
          <button
            className="btn btn-secondary"
            onClick={async () => {
              await store.flush();
              const backup = createBackup(store.project, store.records());
              downloadBlob(new Blob([JSON.stringify(backup)], { type: 'application/json' }), backupFileName(store.project));
              announce('Project backup downloaded');
            }}
          >
            Project backup (.json)
          </button>
          <button
            className="btn btn-secondary"
            disabled={!live.family}
            onClick={async () => {
              if (!live.family) return;
              const blob = await renderSpecimen({ family: live.family, title: project.familyName, designer: project.designer, chars: live.chars });
              downloadBlob(blob, `${font?.fileName.replace(/\.(ttf|otf)$/, '') ?? 'specimen'}-specimen.png`);
            }}
          >
            Specimen sheet (.png)
          </button>
        </div>
        <p className="hint">The backup keeps your original strokes so you (or this app on another device) can carry on editing. It is not a font file.</p>
      </section>

      <section className="install-help" aria-labelledby="install-h">
        <h2 id="install-h">Installing your font</h2>
        <dl>
          <dt>Mac</dt>
          <dd>Double-click the downloaded file and choose <em>Install Font</em> in Font Book. It then appears in Pages, Word, Keynote, Photoshop and every other app.</dd>
          <dt>Windows</dt>
          <dd>Right-click the file and choose <em>Install</em> (or <em>Install for all users</em>), then restart the app you want to use it in.</dd>
          <dt>iPhone and iPad</dt>
          <dd>Safari saves the file to the Files app, but iOS only installs fonts through an app that adds them as a font profile (several free font-installer apps do this). After that, the font shows up in Pages, Keynote and other apps that support custom fonts.</dd>
          <dt>Linux</dt>
          <dd>Copy the file into <code>~/.local/share/fonts</code> and run <code>fc-cache -f</code>.</dd>
          <dt>Websites and design tools</dt>
          <dd>Upload the .ttf to Canva, Figma, Cricut Design Space and similar tools, or use it with <code>@font-face</code> on a website.</dd>
        </dl>
        <p className="hint">If you install a newer version of the same font, remove the old one first, and raise the version number in Settings so apps notice the change.</p>
      </section>
    </div>
  );
}
