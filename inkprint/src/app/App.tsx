import { useEffect } from 'react';
import { Announcer, DialogHost, Loading } from '../components/ui';
import { Done } from '../screens/Done';
import { Export } from '../screens/Export';
import { Preview } from '../screens/Preview';
import { Projects } from '../screens/Projects';
import { Review } from '../screens/Review';
import { Settings } from '../screens/Settings';
import { Setup } from '../screens/Setup';
import { Studio } from '../screens/Studio';
import { Welcome } from '../screens/Welcome';
import { ProjectProvider } from './ProjectContext';
import { useRoute } from './router';

const TITLES: Record<string, string> = {
  welcome: 'Inkprint: your handwriting, your font',
  new: 'New font · Inkprint',
  projects: 'Your fonts · Inkprint',
  draw: 'Draw · Inkprint',
  review: 'Review · Inkprint',
  preview: 'Preview · Inkprint',
  export: 'Download · Inkprint',
  settings: 'Settings · Inkprint',
  done: 'Finished · Inkprint',
};

export function App() {
  const route = useRoute();
  useEffect(() => {
    document.title = TITLES[route.name] ?? 'Inkprint';
    window.scrollTo(0, 0);
  }, [route.name]);

  let body;
  if (route.name === 'welcome') body = <Welcome />;
  else if (route.name === 'new') body = <Setup />;
  else if (route.name === 'projects') body = <Projects />;
  else {
    body = (
      <ProjectProvider
        id={route.id}
        fallback={(s) =>
          s === 'loading' ? (
            <Loading text="Opening your font…" />
          ) : (
            <main className="page narrow">
              <h1>{s === 'missing' ? 'Project not found' : 'Could not open the project'}</h1>
              <p>{s === 'missing' ? 'It may have been deleted, or it was made in a different browser.' : s}</p>
              <a className="btn btn-primary" href="#/projects">Your fonts</a>
            </main>
          )
        }
      >
        {route.name === 'draw' && <Studio key={route.id} id={route.id} char={route.char} queue={route.queue} />}
        {route.name === 'review' && <Review id={route.id} />}
        {route.name === 'preview' && <Preview id={route.id} />}
        {route.name === 'export' && <Export id={route.id} />}
        {route.name === 'settings' && <Settings />}
        {route.name === 'done' && <Done id={route.id} />}
      </ProjectProvider>
    );
  }
  return (
    <>
      <a className="skip-link" href="#main" onClick={(e) => {
          e.preventDefault();
          const m = document.querySelector<HTMLElement>('main');
          m?.setAttribute('tabindex', '-1');
          m?.focus();
        }}>
        Skip to content
      </a>
      {body}
      <Announcer />
      <DialogHost />
    </>
  );
}
