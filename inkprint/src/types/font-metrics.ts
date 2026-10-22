/**
 * Geometry shared by the drawing canvas and the font.
 *
 * Every drawing is stored in canvas units. The canvas is 1000 units wide and
 * 1250 tall, and its baseline sits 950 units from the top, so one canvas unit
 * is exactly one font unit (unitsPerEm is 1000): fontY = CANVAS_BASELINE - canvasY.
 * Guides (cap height, x-height, ...) are font-unit heights above the baseline.
 */
export const UNITS_PER_EM = 1000;
export const CANVAS_WIDTH = 1000;
export const CANVAS_HEIGHT = 1250;
export const CANVAS_BASELINE = 950;

export interface FontMetrics {
  /** Height of flat capitals such as H, above the baseline. */
  capHeight: number;
  /** Height of flat lowercase letters such as x. */
  xHeight: number;
  /** Height of lowercase ascenders such as b, d, h, k, l. */
  ascender: number;
  /** Depth of descenders such as g, p, y (a negative number). */
  descender: number;
}

export const DEFAULT_METRICS: FontMetrics = {
  capHeight: 700,
  xHeight: 480,
  ascender: 740,
  descender: -240,
};

/** Pen settings applied to the raw strokes. Changing them never touches the captured points. */
export interface StrokeStyle {
  /** Nib diameter in font units. */
  size: number;
  /** How much pressure (real or simulated) narrows the line, 0..0.9. */
  thinning: number;
  /** Outline softening, 0..1. */
  smoothing: number;
  /** Input steadying, 0..1. Higher removes wobble but rounds corners. */
  streamline: number;
}

export const DEFAULT_STROKE: StrokeStyle = { size: 46, thinning: 0.45, smoothing: 0.5, streamline: 0.35 };

/** Font-wide placement and spacing, applied when glyphs become font outlines. */
export interface FontLayout {
  /** Scale applied to every glyph about the baseline, 0.5..1.5. */
  glyphScale: number;
  /** Moves every glyph up (+) or down (-), in font units. */
  baselineShift: number;
  /** Default space left and right of each glyph's ink, in font units. */
  sidebearing: number;
  /** Advance width of the space character. */
  spaceWidth: number;
  /** Extra advance added to every drawn glyph (tracking baked into the font). */
  tracking: number;
}

export const DEFAULT_LAYOUT: FontLayout = { glyphScale: 1, baselineShift: 0, sidebearing: 50, spaceWidth: 300, tracking: 0 };
