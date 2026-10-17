import { buildInventory } from '../../data/character-sets';
import { DEFAULT_LAYOUT, UNITS_PER_EM } from '../../types/font-metrics';
import { NO_ADJUST, type GlyphRecord } from '../../types/glyph';
import type { Project } from '../../types/project';
import { layoutGlyph, outlineKey, strokesToContours } from '../glyph-processing/process';
import { fileStem, formatVersion, glyphName, notdefGlyph, parseRevision, type FontModel, type ModelGlyph } from './font-model';

export interface BuildReport {
  model: FontModel;
  /** Characters with a drawing that made it into the font. */
  included: string[];
  /** Characters in the project's set that have no drawing yet. */
  missing: string[];
  /** Drawn characters that produced no usable outline. */
  empty: string[];
  /** Included glyphs not yet marked complete. */
  unfinished: string[];
}

export function defaultCopyright(project: Pick<Project, 'designer' | 'familyName'>, year = new Date().getFullYear()): string {
  const who = project.designer.trim() || 'the designer';
  return `Copyright (c) ${year} ${who}. Drawn by hand with Inkprint.`;
}

export function fontFamilyName(project: Pick<Project, 'familyName'>): string {
  return project.familyName.trim().replace(/\s+/g, ' ').slice(0, 63) || 'Inkprint Personal';
}

/** The outline for a glyph record, from its cache when the cache is still valid. */
export function recordContours(project: Project, rec: GlyphRecord) {
  const adjust = rec.adjust ?? NO_ADJUST;
  const inputs = { stroke: project.stroke, layout: project.layout, adjust };
  const key = outlineKey(rec.updatedAt, inputs);
  if (rec.outline && rec.outline.key === key) return rec.outline.contours;
  return strokesToContours({ ...inputs, strokes: rec.strokes });
}

export function verticalMetrics(project: Project, yMax: number, yMin: number) {
  const m = project.metrics;
  const ascender = Math.round(Math.max(m.ascender, m.capHeight, yMax * 0.9) + 60);
  const descender = Math.round(Math.min(m.descender, yMin * 0.9) - 40);
  const lineGap = Math.max(0, Math.round(UNITS_PER_EM * 1.2 - (ascender - descender)));
  return { ascender, descender, lineGap, capHeight: Math.round(m.capHeight), xHeight: Math.round(m.xHeight) };
}

/** Collects every drawn glyph of the project into a format-independent font model. */
export function buildFontModel(project: Project, records: GlyphRecord[], created = new Date()): BuildReport {
  const layout = { ...DEFAULT_LAYOUT, ...project.layout };
  const byChar = new Map(records.map((r) => [r.char, r]));
  const inventory = buildInventory(project.groups, project.customChars);
  const included: string[] = [];
  const missing: string[] = [];
  const empty: string[] = [];
  const unfinished: string[] = [];
  const drawn: ModelGlyph[] = [];
  let yMax = 0, yMin = 0;

  for (const { char } of inventory) {
    const rec = byChar.get(char);
    if (!rec || rec.strokes.length === 0) { missing.push(char); continue; }
    const laid = layoutGlyph(char, recordContours(project, rec), layout, rec.adjust ?? NO_ADJUST);
    if (!laid.bbox) { empty.push(char); continue; }
    yMax = Math.max(yMax, laid.bbox.yMax);
    yMin = Math.min(yMin, laid.bbox.yMin);
    included.push(char);
    if (rec.status !== 'complete') unfinished.push(char);
    drawn.push({ name: glyphName(laid.codePoint), unicodes: [laid.codePoint], advanceWidth: laid.advanceWidth, contours: laid.contours });
  }
  drawn.sort((a, b) => a.unicodes[0] - b.unicodes[0]);
  // Glyph names must be unique.
  const names = new Set(['.notdef', 'space']);
  for (const g of drawn) {
    let n = g.name, i = 1;
    while (names.has(n)) n = `${g.name}.${i++}`;
    g.name = n;
    names.add(n);
  }

  const family = fontFamilyName(project);
  const ps = `${fileStem(family)}-Regular`;
  const revision = parseRevision(project.version);
  const space: ModelGlyph = { name: 'space', unicodes: [0x20, 0xa0], advanceWidth: Math.max(0, Math.round(layout.spaceWidth + layout.tracking)), contours: [] };
  const model: FontModel = {
    names: {
      family,
      subfamily: 'Regular',
      fullName: `${family} Regular`,
      postScriptName: ps,
      uniqueId: `${revision.toFixed(3)};NONE;${ps};${project.id.slice(0, 8)}`,
      version: formatVersion(revision),
      revision,
      designer: project.designer.trim(),
      copyright: project.copyright.trim() || defaultCopyright(project, created.getFullYear()),
      description: 'A handwriting font drawn character by character with Inkprint.',
    },
    unitsPerEm: UNITS_PER_EM,
    vertical: verticalMetrics(project, yMax, yMin),
    glyphs: [notdefGlyph(project.metrics.capHeight), space, ...drawn],
    created,
  };
  return { model, included, missing, empty, unfinished };
}

export function fontFileName(project: Pick<Project, 'familyName'>, format: 'ttf' | 'otf'): string {
  return `${fileStem(fontFamilyName(project))}-Regular.${format}`;
}
