import { useState } from 'react';
import { useStore } from '../app/ProjectContext';
import { navigate } from '../app/router';
import { CharacterGrid, type GridFilter } from '../components/CharacterGrid';
import { ProjectBar } from '../components/ProjectBar';
import { announce } from '../components/ui';

export function Review({ id }: { id: string }) {
  const store = useStore();
  const [filter, setFilter] = useState<GridFilter>('all');
  const c = store.counts();
  const firstUnfinished = store.inventory.find((e) => store.status(e.char) !== 'complete');
  const firstRevision = store.inventory.find((e) => store.status(e.char) === 'needs-revision');
  const filters: { v: GridFilter; label: string }[] = [
    { v: 'all', label: `All (${c.total})` },
    { v: 'unfinished', label: `Unfinished (${c.total - c.complete})` },
    { v: 'needs-revision', label: `Needs revision (${c.revision})` },
    { v: 'complete', label: `Complete (${c.complete})` },
  ];
  return (
    <>
      <ProjectBar current="review" />
      <main className="page">
        <div className="page-head">
          <h1>Review your typeface</h1>
          <p className="lede">
            {c.complete} of {c.total} characters complete. Tap any character to redraw it; nothing else changes.
          </p>
        </div>
        <div className="toolbar">
          <button
            className="btn btn-primary"
            disabled={!firstUnfinished}
            onClick={() => firstUnfinished ? navigate({ name: 'draw', id, char: firstUnfinished.char, queue: 'unfinished' }) : announce('Everything is complete.')}
          >
            Draw unfinished characters
          </button>
          {firstRevision && (
            <button className="btn btn-secondary" onClick={() => navigate({ name: 'draw', id, char: firstRevision.char, queue: 'unfinished' })}>
              Revise flagged characters
            </button>
          )}
          <a className="btn btn-secondary" href={`#/p/${encodeURIComponent(id)}/preview`}>Preview font</a>
        </div>
        <fieldset className="filter-bar">
          <legend className="visually-hidden">Show</legend>
          {filters.map((f) => (
            <label key={f.v} className="chip-radio">
              <input type="radio" name="filter" value={f.v} checked={filter === f.v} onChange={() => setFilter(f.v)} />
              <span>{f.label}</span>
            </label>
          ))}
        </fieldset>
        <CharacterGrid store={store} filter={filter} />
      </main>
    </>
  );
}
