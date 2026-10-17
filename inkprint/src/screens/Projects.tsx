import { ProjectManager } from '../components/ProjectManager';

export function Projects() {
  return (
    <main className="page narrow">
      <p className="eyebrow"><a href="#/">INKPRINT</a></p>
      <h1>Your fonts</h1>
      <ProjectManager />
    </main>
  );
}
