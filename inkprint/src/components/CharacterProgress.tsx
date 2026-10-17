import type { ProjectStore } from '../modules/storage/project-store';

export function CharacterProgress({ store, index }: { store: ProjectStore; index: number }) {
  const c = store.counts();
  const pct = c.total ? Math.round((c.complete / c.total) * 100) : 0;
  return (
    <div className="progress">
      <p className="progress-count">
        CHARACTER <strong>{index + 1}</strong> OF {c.total}
      </p>
      <div className="progress-bar" role="progressbar" aria-label="Characters complete" aria-valuemin={0} aria-valuemax={c.total} aria-valuenow={c.complete} aria-valuetext={`${c.complete} of ${c.total} complete`}>
        <div style={{ width: `${pct}%` }} />
      </div>
      <p className="progress-detail hint">
        {c.complete} complete · {c.inProgress} in progress · {c.revision} to revise · {c.empty} not started
      </p>
    </div>
  );
}
