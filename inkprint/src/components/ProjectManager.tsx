import { useCallback, useEffect, useRef, useState } from 'react';
import { forgetOpenProject } from '../app/ProjectContext';
import { navigate } from '../app/router';
import { buildInventory } from '../data/character-sets';
import { BackupError, backupFileName, createBackup, parseBackup } from '../modules/project-import-export/backup';
import { downloadBlob } from '../modules/project-import-export/download';
import { deleteProject, getGlyphs, getProject, listProjects, putProject, replaceProject } from '../modules/storage/db';
import { newId } from '../modules/storage/project-factory';
import type { Project } from '../types/project';
import { announce, choose, confirmAction } from './ui';

interface Row {
  project: Project;
  drawn: number;
  total: number;
}

export function ProjectManager() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const projects = await listProjects();
      const out: Row[] = [];
      for (const p of projects) {
        const glyphs = await getGlyphs(p.id);
        const inv = new Set(buildInventory(p.groups, p.customChars).map((e) => e.char));
        out.push({ project: p, drawn: glyphs.filter((g) => g.strokes.length && inv.has(g.char)).length, total: inv.size });
      }
      setRows(out);
    } catch (e) {
      setError((e as Error).message);
      setRows([]);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const rename = async (p: Project) => {
    const name = renameValue.trim();
    setRenaming(null);
    if (!name || name === p.name) return;
    forgetOpenProject(p.id);
    await putProject({ ...p, name, updatedAt: Date.now() });
    announce(`Renamed to ${name}`);
    void load();
  };

  const duplicate = async (p: Project) => {
    const glyphs = await getGlyphs(p.id);
    const copy: Project = { ...p, id: newId(), name: `${p.name} copy`, createdAt: Date.now(), updatedAt: Date.now() };
    await replaceProject(copy, glyphs.map((g) => ({ ...g, projectId: copy.id })));
    announce(`Duplicated as ${copy.name}`);
    void load();
  };

  const remove = async (p: Project) => {
    const ok = await confirmAction(`Delete “${p.name}”?`, 'Every drawing in this project is removed from this device. Download a backup first if you might want it again.', 'Delete project', true);
    if (!ok) return;
    forgetOpenProject(p.id);
    await deleteProject(p.id);
    announce(`Deleted ${p.name}`);
    void load();
  };

  const backup = async (p: Project) => {
    const glyphs = await getGlyphs(p.id);
    downloadBlob(new Blob([JSON.stringify(createBackup(p, glyphs))], { type: 'application/json' }), backupFileName(p));
  };

  const importFile = async (file: File) => {
    try {
      const { project, records } = parseBackup(await file.text());
      const existing = await getProject(project.id);
      let target = project;
      if (existing) {
        const choice = await choose(
          'This project is already here',
          <>
            <p>“{existing.name}” on this device has the same project ID as the backup. Replacing it overwrites its drawings with the ones in the backup.</p>
          </>,
          [
            { label: 'Import as a copy', value: 'copy', kind: 'primary' },
            { label: 'Replace existing', value: 'replace', kind: 'danger' },
            { label: 'Cancel', value: 'cancel', kind: 'secondary' },
          ],
        );
        if (choice === 'copy') target = { ...project, id: newId(), name: `${project.name} (imported)` };
        else if (choice !== 'replace') return;
      }
      forgetOpenProject(target.id);
      await replaceProject(target, records.map((r) => ({ ...r, projectId: target.id })));
      announce(`Imported ${target.name} with ${records.filter((r) => r.strokes.length).length} drawn characters`);
      void load();
    } catch (e) {
      const msg = e instanceof BackupError ? e.message : `Could not import: ${(e as Error).message}`;
      setError(msg);
      announce(msg);
    }
  };

  return (
    <div className="projects">
      <div className="toolbar">
        <a className="btn btn-primary" href="#/new">New font</a>
        <button className="btn btn-secondary" onClick={() => fileRef.current?.click()}>Import a backup…</button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void importFile(f);
          }}
        />
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
      {rows === null ? (
        <p role="status">Loading projects…</p>
      ) : rows.length === 0 ? (
        <p>No projects on this device yet.</p>
      ) : (
        <ul className="project-list">
          {rows.map(({ project: p, drawn, total }) => (
            <li key={p.id} className="project-row">
              <div className="project-info">
                {renaming === p.id ? (
                  <form onSubmit={(e) => { e.preventDefault(); void rename(p); }} className="rename-form">
                    <label className="visually-hidden" htmlFor={`rn-${p.id}`}>New project name</label>
                    <input id={`rn-${p.id}`} value={renameValue} autoFocus onChange={(e) => setRenameValue(e.target.value)} maxLength={120} />
                    <button className="btn btn-primary" type="submit">Save</button>
                    <button className="btn btn-secondary" type="button" onClick={() => setRenaming(null)}>Cancel</button>
                  </form>
                ) : (
                  <h2>{p.name}</h2>
                )}
                <p className="hint">
                  Font: {p.familyName} · {drawn} of {total} drawn · edited {new Date(p.updatedAt).toLocaleString()}
                </p>
              </div>
              <div className="project-actions">
                <button className="btn btn-primary" onClick={() => navigate({ name: 'draw', id: p.id, char: p.lastChar, queue: 'all' })}>Open</button>
                <button className="btn btn-secondary" onClick={() => { setRenaming(p.id); setRenameValue(p.name); }}>Rename</button>
                <button className="btn btn-secondary" onClick={() => void duplicate(p)}>Duplicate</button>
                <button className="btn btn-secondary" onClick={() => void backup(p)}>Back up</button>
                <button className="btn btn-danger" onClick={() => void remove(p)}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="hint">
        Projects live in this browser’s storage on this device. A backup file (JSON) holds every original stroke, so you can move a project to another device or keep it safe. The format is documented in the project’s README.
      </p>
    </div>
  );
}
