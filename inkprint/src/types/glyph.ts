/** A point in font units (y up) or canvas units (y down); the context says which. */
export type Point = [number, number];

/**
 * A point of a font outline. On-curve points are passed through; an off-curve
 * point is a quadratic control point, and two off-curve points in a row imply
 * an on-curve point halfway between them (exactly as TrueType's glyf table
 * stores outlines).
 */
export interface CPoint {
  x: number;
  y: number;
  on: boolean;
}

/** A closed outline in font units (y up). Outer contours run clockwise, holes counter-clockwise. */
export type Contour = CPoint[];

/**
 * One pen stroke, as captured. `points` is flat: x, y, pressure, x, y, pressure, ...
 * in canvas units, pressure 0..1. `pen` is true when the hardware reported real
 * pressure (a stylus); otherwise pressure is simulated from speed.
 */
export interface Stroke {
  points: number[];
  pen: boolean;
}

export type GlyphStatus = 'empty' | 'in-progress' | 'complete' | 'needs-revision';

/** Per-glyph corrections, all relative to the font-wide layout. */
export interface GlyphAdjust {
  scale: number;
  offsetY: number;
  /** Added to the default left / right sidebearing. */
  lsb: number;
  rsb: number;
}

export const NO_ADJUST: GlyphAdjust = { scale: 1, offsetY: 0, lsb: 0, rsb: 0 };

export interface ProcessedOutline {
  /** Hash of the inputs that produced it, so stale outlines are recomputed. */
  key: string;
  contours: Contour[];
}

export interface GlyphRecord {
  projectId: string;
  char: string;
  strokes: Stroke[];
  status: GlyphStatus;
  adjust: GlyphAdjust;
  updatedAt: number;
  /** Cached font outline (font units, before horizontal placement). */
  outline?: ProcessedOutline;
}

/** A glyph ready for the font: contours in font units, already placed at its left sidebearing. */
export interface LaidOutGlyph {
  char: string;
  codePoint: number;
  contours: Contour[];
  advanceWidth: number;
  bbox: { xMin: number; yMin: number; xMax: number; yMax: number } | null;
}
