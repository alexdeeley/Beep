import { useStore } from '../app/ProjectContext';
import { navigate } from '../app/router';
import { ProjectBar } from '../components/ProjectBar';

export function Done({ id }: { id: string }) {
  const store = useStore();
  const c = store.counts();
  const unfinished = store.inventory.find((e) => store.status(e.char) !== 'complete');
  return (
    <>
      <ProjectBar current="draw" />
      <main className="page narrow done">
        <p className="eyebrow">END OF THE CHARACTER SET</p>
        <h1>{c.complete === c.total ? 'Your alphabet is complete.' : 'You reached the last character.'}</h1>
        <p className="lede">
          {c.complete} of {c.total} characters complete{c.total - c.complete > 0 ? `, ${c.total - c.complete} still to draw or finish` : ''}. You can preview and download your font now, even with gaps.
        </p>
        <div className="stack">
          <a className="btn btn-primary btn-huge" href={`#/p/${encodeURIComponent(id)}/preview`}>PREVIEW MY FONT</a>
          <a className="btn btn-secondary btn-huge" href={`#/p/${encodeURIComponent(id)}/review`}>REVIEW MY TYPEFACE</a>
          {unfinished && (
            <button className="btn btn-secondary btn-huge" onClick={() => navigate({ name: 'draw', id, char: unfinished.char, queue: 'unfinished' })}>
              DRAW UNFINISHED ({c.total - c.complete})
            </button>
          )}
          <a className="btn btn-secondary btn-huge" href={`#/p/${encodeURIComponent(id)}/export`}>DOWNLOAD MY FONT</a>
        </div>
      </main>
    </>
  );
}
