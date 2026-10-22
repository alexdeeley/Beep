/**
 * The open project, held in memory and written to IndexedDB in the
 * background. UI code subscribes to it (useSyncExternalStore); every change
 * bumps `version`. Saves are debounced but flushed when the page is hidden or
 * closed, so nothing drawn is lost on refresh.
 */
import { buildInventory, type InventoryEntry } from '../../data/character-sets';
import { NO_ADJUST, type Contour, type GlyphRecord, type GlyphStatus, type Stroke } from '../../types/glyph';
import { DEFAULT_GHOST, PREVIOUS_GHOST_OPACITY, type Project } from '../../types/project';
import { recordContours } from '../font-generation/build-font';
import { outlineKey } from '../glyph-processing/process';
import { putGlyphs, putProject } from './db';

export type SaveState = 'saved' | 'pending' | 'saving' | 'error';

interface History {
  undo: Stroke[][];
  redo: Stroke[][];
}

const SAVE_DELAY = 350;
const HISTORY_LIMIT = 200;

export class ProjectStore {
  project: Project;
  glyphs = new Map<string, GlyphRecord>();
  inventory: InventoryEntry[];
  version = 0;
  saveState: SaveState = 'saved';
  saveError: string | null = null;

  private listeners = new Set<() => void>();
  private dirtyProject = false;
  private dirtyGlyphs = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> | null = null;
  private history = new Map<string, History>();
  private outlineCache = new Map<string, { key: string; contours: Contour[] }>();

  constructor(project: Project, records: GlyphRecord[]) {
    this.project = upgradeProject(project);
    if (this.project !== project) this.dirtyProject = true;
    for (const r of records) this.glyphs.set(r.char, r);
    this.inventory = buildInventory(project.groups, project.customChars);
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = () => this.version;

  private emit() {
    this.version++;
    this.listeners.forEach((fn) => fn());
  }

  glyph(char: string): GlyphRecord {
    return (
      this.glyphs.get(char) ?? { projectId: this.project.id, char, strokes: [], status: 'empty', adjust: { ...NO_ADJUST }, updatedAt: 0 }
    );
  }

  /** Font outline of a glyph (font units, before horizontal placement), cached. */
  contours(char: string): Contour[] {
    const rec = this.glyphs.get(char);
    if (!rec || rec.strokes.length === 0) return [];
    const key = outlineKey(rec.updatedAt, { stroke: this.project.stroke, layout: this.project.layout, adjust: rec.adjust });
    const hit = this.outlineCache.get(char);
    if (hit && hit.key === key) return hit.contours;
    const contours = recordContours(this.project, rec);
    this.outlineCache.set(char, { key, contours });
    return contours;
  }

  updateProject(patch: Partial<Project> | ((p: Project) => Partial<Project>)) {
    const next = typeof patch === 'function' ? patch(this.project) : patch;
    this.project = { ...this.project, ...next, updatedAt: Date.now() };
    if ('groups' in next || 'customChars' in next) this.inventory = buildInventory(this.project.groups, this.project.customChars);
    this.dirtyProject = true;
    this.schedule();
    this.emit();
  }

  private writeGlyph(char: string, change: Partial<GlyphRecord>) {
    const prev = this.glyph(char);
    const rec: GlyphRecord = { ...prev, ...change, projectId: this.project.id, char, updatedAt: Date.now() };
    if (rec.updatedAt <= prev.updatedAt) rec.updatedAt = prev.updatedAt + 1;
    this.glyphs.set(char, rec);
    this.dirtyGlyphs.add(char);
    this.schedule();
    this.emit();
  }

  private hist(char: string): History {
    let h = this.history.get(char);
    if (!h) this.history.set(char, (h = { undo: [], redo: [] }));
    return h;
  }

  /** Replaces a glyph's strokes as one undoable step. */
  setStrokes(char: string, strokes: Stroke[]) {
    const prev = this.glyph(char);
    const h = this.hist(char);
    h.undo.push(prev.strokes);
    if (h.undo.length > HISTORY_LIMIT) h.undo.shift();
    h.redo = [];
    let status: GlyphStatus = prev.status;
    if (strokes.length === 0 && status !== 'needs-revision') status = 'empty';
    else if (strokes.length > 0 && status === 'empty') status = 'in-progress';
    this.writeGlyph(char, { strokes, status });
  }

  addStroke(char: string, stroke: Stroke) {
    this.setStrokes(char, [...this.glyph(char).strokes, stroke]);
  }

  canUndo(char: string) { return (this.history.get(char)?.undo.length ?? 0) > 0; }
  canRedo(char: string) { return (this.history.get(char)?.redo.length ?? 0) > 0; }

  undo(char: string) {
    const h = this.history.get(char);
    const prevStrokes = h?.undo.pop();
    if (!h || !prevStrokes) return;
    h.redo.push(this.glyph(char).strokes);
    this.applyHistory(char, prevStrokes);
  }

  redo(char: string) {
    const h = this.history.get(char);
    const next = h?.redo.pop();
    if (!h || !next) return;
    h.undo.push(this.glyph(char).strokes);
    this.applyHistory(char, next);
  }

  private applyHistory(char: string, strokes: Stroke[]) {
    const prev = this.glyph(char);
    let status = prev.status;
    if (strokes.length === 0 && status !== 'needs-revision') status = 'empty';
    else if (strokes.length > 0 && status === 'empty') status = 'in-progress';
    this.writeGlyph(char, { strokes, status });
  }

  setStatus(char: string, status: GlyphStatus) {
    this.writeGlyph(char, { status });
  }

  setAdjust(char: string, adjust: Partial<GlyphRecord['adjust']>) {
    this.writeGlyph(char, { adjust: { ...this.glyph(char).adjust, ...adjust } });
  }

  private schedule() {
    if (this.saveState !== 'saving') this.saveState = 'pending';
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), SAVE_DELAY);
  }

  /** Writes everything pending now. Safe to call repeatedly. */
  async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.saving) await this.saving;
    if (!this.dirtyProject && this.dirtyGlyphs.size === 0) return;
    const project = this.dirtyProject ? this.project : null;
    const chars = [...this.dirtyGlyphs];
    this.dirtyProject = false;
    this.dirtyGlyphs.clear();
    const records = chars.map((c) => {
      const rec = this.glyph(c);
      // Persist the processed outline alongside the original strokes.
      const contours = this.contours(c);
      const key = outlineKey(rec.updatedAt, { stroke: this.project.stroke, layout: this.project.layout, adjust: rec.adjust });
      return { ...rec, outline: rec.strokes.length ? { key, contours } : undefined };
    });
    this.saveState = 'saving';
    this.emit();
    this.saving = (async () => {
      try {
        if (project) await putProject(project);
        await putGlyphs(records);
        this.saveError = null;
        this.saveState = this.dirtyProject || this.dirtyGlyphs.size ? 'pending' : 'saved';
      } catch (e) {
        // Put the work back so the next attempt includes it.
        if (project) this.dirtyProject = true;
        chars.forEach((c) => this.dirtyGlyphs.add(c));
        this.saveState = 'error';
        this.saveError = (e as Error).message || 'Could not save to this device.';
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.flush(), 3000);
      } finally {
        this.saving = null;
        this.emit();
      }
    })();
    await this.saving;
  }

  /** Counts per status over the project's character set. */
  counts() {
    let complete = 0, inProgress = 0, revision = 0, empty = 0;
    for (const { char } of this.inventory) {
      const r = this.glyphs.get(char);
      const s = !r ? 'empty' : r.strokes.length === 0 && r.status !== 'needs-revision' ? 'empty' : r.status;
      if (s === 'complete') complete++;
      else if (s === 'in-progress') inProgress++;
      else if (s === 'needs-revision') revision++;
      else empty++;
    }
    return { complete, inProgress, revision, empty, total: this.inventory.length, drawn: complete + inProgress + revision };
  }

  /** The status shown for a character (a glyph without strokes is never "complete"). */
  status(char: string): GlyphStatus {
    const r = this.glyphs.get(char);
    if (!r) return 'empty';
    if (r.strokes.length === 0 && r.status !== 'needs-revision') return 'empty';
    return r.status;
  }

  records(): GlyphRecord[] {
    return [...this.glyphs.values()];
  }
}

/** Settings whose defaults changed: bring a stored project up to date, untouched if nothing applies. */
export function upgradeProject(p: Project): Project {
  if (Math.abs(p.ghost.opacity - PREVIOUS_GHOST_OPACITY) < 1e-6) return { ...p, ghost: { ...p.ghost, opacity: DEFAULT_GHOST.opacity } };
  return p;
}
