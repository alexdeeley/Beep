import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { getGlyphs, getProject } from '../modules/storage/db';
import { ProjectStore } from '../modules/storage/project-store';

const Ctx = createContext<ProjectStore | null>(null);

let openStore: ProjectStore | null = null;

/** Flush the open project when the page is hidden or closed (mobile Safari rarely fires unload). */
if (typeof window !== 'undefined') {
  const flush = () => void openStore?.flush();
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
}

export function ProjectProvider({ id, children, fallback }: { id: string; children: ReactNode; fallback: (state: 'loading' | 'missing' | string) => ReactNode }) {
  const [state, setState] = useState<{ store: ProjectStore | null; status: 'loading' | 'missing' | 'ready' | string }>(() =>
    openStore && openStore.project.id === id ? { store: openStore, status: 'ready' } : { store: null, status: 'loading' },
  );

  useEffect(() => {
    if (openStore && openStore.project.id === id) { setState({ store: openStore, status: 'ready' }); return; }
    let cancelled = false;
    setState({ store: null, status: 'loading' });
    (async () => {
      try {
        if (openStore) await openStore.flush();
        const project = await getProject(id);
        if (!project) { if (!cancelled) setState({ store: null, status: 'missing' }); return; }
        const records = await getGlyphs(id);
        const store = new ProjectStore(project, records);
        openStore = store;
        if (!cancelled) setState({ store, status: 'ready' });
      } catch (e) {
        if (!cancelled) setState({ store: null, status: (e as Error).message || 'Could not open the project.' });
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  if (!state.store) return <>{fallback(state.status)}</>;
  return <Ctx.Provider value={state.store}>{children}</Ctx.Provider>;
}

/** Drop the cached store (after deleting or replacing a project). */
export function forgetOpenProject(id?: string) {
  if (!id || openStore?.project.id === id) openStore = null;
}

export function useStore(): ProjectStore {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside ProjectProvider');
  useSyncExternalStore(s.subscribe, s.getVersion);
  return s;
}

/** The store without subscribing to changes. */
export function useStoreStatic(): ProjectStore {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStoreStatic outside ProjectProvider');
  return s;
}
