import { ExportPanel } from '../components/ExportPanel';
import { ProjectBar } from '../components/ProjectBar';

export function Export({ id }: { id: string }) {
  return (
    <>
      <ProjectBar current="export" />
      <main className="page">
        <div className="page-head">
          <h1>Download your font</h1>
          <p className="lede">A real font file, built and checked on this device. Your handwriting never leaves it.</p>
        </div>
        <ExportPanel id={id} />
      </main>
    </>
  );
}
