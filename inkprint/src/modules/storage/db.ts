/**
 * IndexedDB persistence. Two object stores:
 *   projects: Project, keyed by id
 *   glyphs:   GlyphRecord, keyed by [projectId, char], indexed by projectId
 * Everything stays in this browser; nothing is uploaded.
 */
import type { GlyphRecord } from '../../types/glyph';
import type { Project } from '../../types/project';

const DB_NAME = 'inkprint';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
}

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('This browser has no IndexedDB, so work cannot be saved.')); return; }
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('glyphs')) {
        const g = db.createObjectStore('glyphs', { keyPath: ['projectId', 'char'] });
        g.createIndex('byProject', 'projectId');
      }
    };
    open.onsuccess = () => {
      const db = open.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    open.onerror = () => { dbPromise = null; reject(open.error); };
    open.onblocked = () => reject(new Error('Inkprint is open in another tab with an older version. Close it and reload.'));
  });
  return dbPromise;
}

export async function listProjects(): Promise<Project[]> {
  const db = await openDb();
  const all = await req(db.transaction('projects').objectStore('projects').getAll() as IDBRequest<Project[]>);
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id: string): Promise<Project | undefined> {
  const db = await openDb();
  return req(db.transaction('projects').objectStore('projects').get(id) as IDBRequest<Project | undefined>);
}

export async function putProject(p: Project): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('projects', 'readwrite');
  tx.objectStore('projects').put(p);
  await txDone(tx);
}

export async function getGlyphs(projectId: string): Promise<GlyphRecord[]> {
  const db = await openDb();
  const idx = db.transaction('glyphs').objectStore('glyphs').index('byProject');
  return req(idx.getAll(IDBKeyRange.only(projectId)) as IDBRequest<GlyphRecord[]>);
}

export async function putGlyphs(records: GlyphRecord[]): Promise<void> {
  if (!records.length) return;
  const db = await openDb();
  const tx = db.transaction('glyphs', 'readwrite');
  const store = tx.objectStore('glyphs');
  for (const r of records) store.put(r);
  await txDone(tx);
}

export async function deleteGlyph(projectId: string, char: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('glyphs', 'readwrite');
  tx.objectStore('glyphs').delete([projectId, char]);
  await txDone(tx);
}

/** Replaces a whole project (metadata and every glyph) in one transaction. */
export async function replaceProject(p: Project, records: GlyphRecord[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['projects', 'glyphs'], 'readwrite');
  const glyphs = tx.objectStore('glyphs');
  const keys = await req(glyphs.index('byProject').getAllKeys(IDBKeyRange.only(p.id)));
  for (const k of keys) glyphs.delete(k);
  tx.objectStore('projects').put(p);
  for (const r of records) glyphs.put({ ...r, projectId: p.id });
  await txDone(tx);
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['projects', 'glyphs'], 'readwrite');
  const glyphs = tx.objectStore('glyphs');
  const keys = await req(glyphs.index('byProject').getAllKeys(IDBKeyRange.only(id)));
  for (const k of keys) glyphs.delete(k);
  tx.objectStore('projects').delete(id);
  await txDone(tx);
}

/** Asks the browser not to evict our data under storage pressure (best effort). */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
