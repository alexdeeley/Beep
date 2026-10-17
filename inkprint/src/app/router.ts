import { useEffect, useState } from 'react';

/**
 * A tiny hash router, so every screen has a URL that survives a refresh and
 * the app works from any static host (and offline) without server rewrites.
 *
 *   #/                         welcome
 *   #/new                      font setup
 *   #/projects                 project manager
 *   #/p/<id>/draw/<char>       drawing studio   (?queue=unfinished)
 *   #/p/<id>/review            review grid
 *   #/p/<id>/preview           font preview
 *   #/p/<id>/export            export
 *   #/p/<id>/settings          font settings
 *   #/p/<id>/done              end of the character set
 */
export type Route =
  | { name: 'welcome' }
  | { name: 'new' }
  | { name: 'projects' }
  | { name: 'draw'; id: string; char: string | null; queue: 'all' | 'unfinished' }
  | { name: 'review' | 'preview' | 'export' | 'settings' | 'done'; id: string };

export function parseHash(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean).map((s) => {
    try { return decodeURIComponent(s); } catch { return s; }
  });
  const q = new URLSearchParams(query);
  if (parts[0] === 'new') return { name: 'new' };
  if (parts[0] === 'projects') return { name: 'projects' };
  if (parts[0] === 'p' && parts[1]) {
    const id = parts[1];
    const view = parts[2] ?? 'draw';
    if (view === 'draw') return { name: 'draw', id, char: parts[3] ?? null, queue: q.get('queue') === 'unfinished' ? 'unfinished' : 'all' };
    if (['review', 'preview', 'export', 'settings', 'done'].includes(view)) return { name: view as 'review', id };
  }
  return { name: 'welcome' };
}

export function href(route: Route): string {
  switch (route.name) {
    case 'welcome': return '#/';
    case 'new': return '#/new';
    case 'projects': return '#/projects';
    case 'draw': {
      const base = `#/p/${encodeURIComponent(route.id)}/draw${route.char ? '/' + encodeURIComponent(route.char) : ''}`;
      return route.queue === 'unfinished' ? `${base}?queue=unfinished` : base;
    }
    default: return `#/p/${encodeURIComponent(route.id)}/${route.name}`;
  }
}

export function navigate(route: Route, replace = false) {
  const h = href(route);
  if (replace) history.replaceState(null, '', h);
  else history.pushState(null, '', h);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(location.hash));
    window.addEventListener('hashchange', on);
    window.addEventListener('popstate', on);
    return () => {
      window.removeEventListener('hashchange', on);
      window.removeEventListener('popstate', on);
    };
  }, []);
  return route;
}
