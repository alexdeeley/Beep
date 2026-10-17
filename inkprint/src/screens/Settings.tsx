import { FontSettings } from '../components/FontSettings';
import { ProjectBar } from '../components/ProjectBar';

export function Settings() {
  return (
    <>
      <ProjectBar current="settings" />
      <main className="page narrow">
        <div className="page-head">
          <h1>Font settings</h1>
        </div>
        <FontSettings />
      </main>
    </>
  );
}
