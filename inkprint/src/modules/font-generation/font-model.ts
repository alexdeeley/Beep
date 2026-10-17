import type { Contour } from '../../types/glyph';

/** Everything a font writer needs, independent of the output format. */
export interface FontModel {
  names: FontNames;
  unitsPerEm: number;
  /** Vertical metrics (font units; descender negative). */
  vertical: {
    ascender: number;
    descender: number;
    lineGap: number;
    capHeight: number;
    xHeight: number;
  };
  /** Glyph order: index 0 must be .notdef. */
  glyphs: ModelGlyph[];
  created: Date;
}

export interface ModelGlyph {
  name: string;
  /** Code points mapped to this glyph (empty for .notdef). */
  unicodes: number[];
  advanceWidth: number;
  /** Font units, y up, TrueType orientation (outer contours clockwise). */
  contours: Contour[];
}

export interface FontNames {
  family: string;
  subfamily: string;
  fullName: string;
  postScriptName: string;
  uniqueId: string;
  /** "Version 1.000" */
  version: string;
  /** Numeric revision for head.fontRevision, e.g. 1.0 */
  revision: number;
  designer: string;
  copyright: string;
  description: string;
}

/** A PostScript-safe name: printable ASCII without spaces or []{}()<>/%, at most 63 characters. */
export function postScriptSafe(s: string): string {
  const ascii = s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x21-\x7e]/g, '')
    .replace(/[[\](){}<>/%]/g, '');
  return ascii.slice(0, 63);
}

/** File-name stem such as "MyHandwriting" for "My Handwriting". */
export function fileStem(family: string): string {
  const stem = postScriptSafe(
    family
      .split(/\s+/)
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ''))
      .join(''),
  ).replace(/[^A-Za-z0-9_-]/g, '');
  return stem || 'InkprintFont';
}

/** "1.2" or "1.200" → 1.2; anything unparsable → 1. */
export function parseRevision(version: string): number {
  const m = /(\d+)(?:\.(\d+))?/.exec(version);
  if (!m) return 1;
  const v = Number(`${m[1]}.${m[2] ?? '0'}`);
  return Number.isFinite(v) && v > 0 && v < 32768 ? v : 1;
}

export function formatVersion(revision: number): string {
  return `Version ${revision.toFixed(3)}`;
}

/** The .notdef glyph: an empty box, the conventional "missing character" shape. */
export function notdefGlyph(capHeight: number): ModelGlyph {
  const w = Math.round(capHeight * 0.72);
  const x0 = 60, x1 = 60 + w, y0 = 0, y1 = capHeight, t = 40;
  const outer = [[x0, y0], [x0, y1], [x1, y1], [x1, y0]]; // clockwise in y-up
  const inner = [[x0 + t, y0 + t], [x1 - t, y0 + t], [x1 - t, y1 - t], [x0 + t, y1 - t]]; // counter-clockwise
  return {
    name: '.notdef',
    unicodes: [],
    advanceWidth: w + 120,
    contours: [outer, inner].map((r) => r.map(([x, y]) => ({ x, y, on: true }))),
  };
}

export function glyphName(cp: number): string {
  if (cp >= 0x21 && cp <= 0x7e && /[A-Za-z0-9]/.test(String.fromCharCode(cp))) return String.fromCharCode(cp);
  return cp <= 0xffff ? `uni${cp.toString(16).toUpperCase().padStart(4, '0')}` : `u${cp.toString(16).toUpperCase()}`;
}
