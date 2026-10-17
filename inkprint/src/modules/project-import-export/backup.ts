/**
 * Project backups: a JSON file holding everything needed to keep editing a
 * font (settings and the original pen strokes). It is not a font file.
 * The format is documented in docs/PROJECT_FORMAT.md.
 */
import { CHAR_GROUPS } from '../../data/character-sets';
import { DEFAULT_LAYOUT, DEFAULT_METRICS, DEFAULT_STROKE } from '../../types/font-metrics';
import { NO_ADJUST, type GlyphRecord, type GlyphStatus, type Stroke } from '../../types/glyph';
import { DEFAULT_GHOST, type Project } from '../../types/project';
import { newProject } from '../storage/project-factory';

export const BACKUP_FORMAT = 'inkprint-project';
export const BACKUP_VERSION = 1;

export interface BackupGlyph {
  char: string;
  codePoint: string;
  status: GlyphStatus;
  adjust: GlyphRecord['adjust'];
  updatedAt: number;
  strokes: Stroke[];
}

export interface ProjectBackup {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  exportedAt: string;
  project: Project;
  glyphs: BackupGlyph[];
}

export class BackupError extends Error {}

export function createBackup(project: Project, records: GlyphRecord[], now = new Date()): ProjectBackup {
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    project,
    glyphs: records
      .filter((r) => r.strokes.length > 0 || r.status !== 'empty')
      .map((r) => ({
        char: r.char,
        codePoint: 'U+' + r.char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0'),
        status: r.status,
        adjust: r.adjust,
        updatedAt: r.updatedAt,
        strokes: r.strokes.map((s) => ({ pen: s.pen, points: s.points.map((v) => Math.round(v * 100) / 100) })),
      })),
  };
}

export function backupFileName(project: Project, now = new Date()): string {
  const stem = project.name.trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'inkprint';
  return `${stem}.inkprint-${now.toISOString().slice(0, 10)}.json`;
}

const STATUSES: GlyphStatus[] = ['empty', 'in-progress', 'complete', 'needs-revision'];
const num = (v: unknown, fallback: number, min = -1e6, max = 1e6) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const str = (v: unknown, fallback: string, max = 500) => (typeof v === 'string' ? v.slice(0, max) : fallback);

/** Reads and checks a backup file. Unknown or missing settings fall back to defaults. */
export function parseBackup(text: string): { project: Project; records: GlyphRecord[] } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackupError('This file is not valid JSON, so it is not an Inkprint backup.');
  }
  const d = data as Partial<ProjectBackup>;
  if (!d || typeof d !== 'object' || d.format !== BACKUP_FORMAT) throw new BackupError('This file is not an Inkprint project backup.');
  if (typeof d.formatVersion !== 'number' || d.formatVersion > BACKUP_VERSION)
    throw new BackupError('This backup was made by a newer version of Inkprint. Update the app and try again.');
  const p = (d.project ?? {}) as Partial<Project>;
  const base = newProject();
  const groupIds = new Set(CHAR_GROUPS.map((g) => g.id));
  const project: Project = {
    ...base,
    id: str(p.id, base.id, 100) || base.id,
    name: str(p.name, base.name, 120) || base.name,
    familyName: str(p.familyName, base.familyName, 63) || base.familyName,
    designer: str(p.designer, ''),
    copyright: str(p.copyright, base.copyright),
    version: str(p.version, base.version, 20),
    style: (['natural', 'print', 'cursive', 'block', 'experimental'] as const).includes(p.style as never) ? p.style! : base.style,
    groups: Array.isArray(p.groups) ? p.groups.filter((g) => groupIds.has(g)) : base.groups,
    customChars: str(p.customChars, '', 2000),
    metrics: {
      capHeight: num(p.metrics?.capHeight, DEFAULT_METRICS.capHeight, 300, 950),
      xHeight: num(p.metrics?.xHeight, DEFAULT_METRICS.xHeight, 200, 900),
      ascender: num(p.metrics?.ascender, DEFAULT_METRICS.ascender, 300, 950),
      descender: num(p.metrics?.descender, DEFAULT_METRICS.descender, -300, -50),
    },
    stroke: {
      size: num(p.stroke?.size, DEFAULT_STROKE.size, 8, 160),
      thinning: num(p.stroke?.thinning, DEFAULT_STROKE.thinning, 0, 0.95),
      smoothing: num(p.stroke?.smoothing, DEFAULT_STROKE.smoothing, 0, 1),
      streamline: num(p.stroke?.streamline, DEFAULT_STROKE.streamline, 0, 1),
    },
    layout: {
      glyphScale: num(p.layout?.glyphScale, DEFAULT_LAYOUT.glyphScale, 0.3, 2),
      baselineShift: num(p.layout?.baselineShift, DEFAULT_LAYOUT.baselineShift, -300, 300),
      sidebearing: num(p.layout?.sidebearing, DEFAULT_LAYOUT.sidebearing, -100, 300),
      spaceWidth: num(p.layout?.spaceWidth, DEFAULT_LAYOUT.spaceWidth, 50, 1000),
      tracking: num(p.layout?.tracking, DEFAULT_LAYOUT.tracking, -200, 400),
    },
    ghost: { ...DEFAULT_GHOST, ...(typeof p.ghost === 'object' ? p.ghost : {}) },
    canvasTheme: p.canvasTheme === 'dark' ? 'dark' : 'light',
    showGuides: p.showGuides !== false,
    exportFormat: p.exportFormat === 'otf' ? 'otf' : 'ttf',
    lastChar: typeof p.lastChar === 'string' ? p.lastChar : null,
    createdAt: num(p.createdAt, base.createdAt, 0, 1e15),
    updatedAt: Date.now(),
  };
  if (!Array.isArray(d.glyphs)) throw new BackupError('The backup has no glyph list.');
  const records: GlyphRecord[] = [];
  const seen = new Set<string>();
  for (const g of d.glyphs as Partial<BackupGlyph>[]) {
    if (!g || typeof g.char !== 'string' || Array.from(g.char).length !== 1 || seen.has(g.char)) continue;
    seen.add(g.char);
    const strokes: Stroke[] = [];
    for (const s of Array.isArray(g.strokes) ? g.strokes : []) {
      if (!s || !Array.isArray(s.points) || s.points.length < 3 || s.points.length % 3) continue;
      if (!s.points.every((v) => typeof v === 'number' && Number.isFinite(v))) continue;
      strokes.push({ pen: !!s.pen, points: s.points.slice() });
    }
    const a = (g.adjust ?? {}) as Partial<GlyphRecord['adjust']>;
    records.push({
      projectId: project.id,
      char: g.char,
      strokes,
      status: STATUSES.includes(g.status as GlyphStatus) ? (g.status as GlyphStatus) : strokes.length ? 'in-progress' : 'empty',
      adjust: {
        scale: num(a.scale, NO_ADJUST.scale, 0.3, 3),
        offsetY: num(a.offsetY, 0, -500, 500),
        lsb: num(a.lsb, 0, -300, 300),
        rsb: num(a.rsb, 0, -300, 300),
      },
      updatedAt: num(g.updatedAt, Date.now(), 0, 1e15),
    });
  }
  return { project, records };
}
