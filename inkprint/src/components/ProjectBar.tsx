import { href, type Route } from '../app/router';
import { useStore } from '../app/ProjectContext';

const TABS: { name: Route['name']; label: string }[] = [
  { name: 'draw', label: 'Draw' },
  { name: 'review', label: 'Review' },
  { name: 'preview', label: 'Preview' },
  { name: 'export', label: 'Export' },
  { name: 'settings', label: 'Settings' },
];

/** The top bar on every project screen: home, project name, save state and the five sections. */
export function ProjectBar({ current }: { current: Route['name'] }) {
  const store = useStore();
  const { project } = store;
  const save =
    store.saveState === 'error' ? `Not saved: ${store.saveError ?? 'storage error'}` : store.saveState === 'saved' ? 'Saved on this device' : 'Saving…';
  return (
    <header className="project-bar">
      <div className="project-bar-row">
        <a className="brand" href="#/" aria-label="Inkprint home">INKPRINT</a>
        <a className="project-name" href="#/projects" title="All projects">{project.name}</a>
        <span className={`save-state save-${store.saveState}`} role={store.saveState === 'error' ? 'alert' : undefined}>
          <span aria-hidden="true">{store.saveState === 'saved' ? '✓' : store.saveState === 'error' ? '!' : '…'}</span>
          <span className="save-text">{save}</span>
        </span>
      </div>
      <nav aria-label="Project sections">
        <ul className="tabs">
          {TABS.map((t) => (
            <li key={t.name}>
              <a
                href={t.name === 'draw' ? href({ name: 'draw', id: project.id, char: project.lastChar, queue: 'all' }) : href({ name: t.name, id: project.id } as Route)}
                aria-current={current === t.name ? 'page' : undefined}
              >
                {t.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
