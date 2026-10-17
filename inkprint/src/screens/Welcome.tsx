import { useEffect, useState } from 'react';
import { navigate } from '../app/router';
import { listProjects } from '../modules/storage/db';
import type { Project } from '../types/project';
import { TextField } from '../components/ui';
import { setPendingName } from './Setup';

export function Welcome() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [name, setName] = useState('Inkprint Personal');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    listProjects().then(setProjects).catch((e) => { setProjects([]); setError((e as Error).message); });
  }, []);
  const latest = projects?.[0];
  return (
    <main className="welcome">
      <p className="brand-mark">INKPRINT</p>
      <p className="tagline">YOUR HANDWRITING. YOUR FONT.</p>
      <h1 className="hero">MAKE A FONT OF YOUR HANDWRITING.</h1>
      <p className="lede">Draw your letters. Build your alphabet. Download a font that’s entirely yours.</p>

      <form
        className="welcome-form"
        onSubmit={(e) => {
          e.preventDefault();
          setPendingName(name);
          navigate({ name: 'new' });
        }}
      >
        <TextField label="Name your font" value={name} onChange={setName} maxLength={63} name="fontname" />
        <button className="btn btn-primary btn-huge" type="submit">CREATE MY FONT</button>
      </form>

      {latest && (
        <div className="continue">
          <button className="btn btn-secondary btn-huge" onClick={() => navigate({ name: 'draw', id: latest.id, char: latest.lastChar, queue: 'all' })}>
            CONTINUE MY FONT
          </button>
          <p className="hint">
            {latest.name}
            {projects!.length > 1 && <> · <a href="#/projects">all {projects!.length} projects</a></>}
          </p>
        </div>
      )}
      {projects && !latest && <p className="hint"><a href="#/projects">Restore a project from a backup</a></p>}
      {error && <p className="error-text" role="alert">Saving is unavailable in this browser: {error}</p>}

      <ol className="how">
        <li><strong>Draw</strong> each character once, on a big canvas, with a faint guide behind it if you want one.</li>
        <li><strong>Watch</strong> your typeface come together and preview it in real sentences.</li>
        <li><strong>Download</strong> a real .ttf or .otf font and install it like any other.</li>
      </ol>
      <p className="hint fineprint">
        Everything stays on this device and saves as you draw, so you can stop and come back any time. No account, no uploads.
      </p>
    </main>
  );
}
