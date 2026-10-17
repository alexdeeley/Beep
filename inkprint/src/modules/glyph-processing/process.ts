import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping';
import { CANVAS_BASELINE, type FontLayout, type StrokeStyle } from '../../types/font-metrics';
import type { Contour, GlyphAdjust, LaidOutGlyph, Point, ProcessedOutline, Stroke } from '../../types/glyph';
import { contoursBBox, polygonToContour } from './contour';
import { roundRing, signedArea, simplifyRing } from './geometry';
import { strokeOutline } from './stroke-outline';

/** Simplification tolerance in font units: well under a pixel at any normal text size. */
const SIMPLIFY_TOLERANCE = 0.9;
/** Rings smaller than this (square font units) are specks and are dropped. */
const MIN_RING_AREA = 6;

export interface OutlineInputs {
  strokes: Stroke[];
  stroke: StrokeStyle;
  layout: Pick<FontLayout, 'glyphScale' | 'baselineShift'>;
  adjust: Pick<GlyphAdjust, 'scale' | 'offsetY'>;
}

export function outlineKey(updatedAt: number, inp: Omit<OutlineInputs, 'strokes'>): string {
  const s = inp.stroke;
  return [updatedAt, s.size, s.thinning, s.smoothing, s.streamline, inp.layout.glyphScale, inp.layout.baselineShift, inp.adjust.scale, inp.adjust.offsetY].join('|');
}

/** Merges all stroke outlines of a glyph into non-overlapping polygons (nonzero fill), in canvas units. */
export function unionStrokes(strokes: Stroke[], style: StrokeStyle): MultiPolygon {
  const polys: Polygon[] = [];
  for (const s of strokes) {
    const ring = strokeOutline(s, style);
    if (ring.length >= 3) polys.push([ring.map(([x, y]) => [x, y] as [number, number])]);
  }
  if (polys.length === 0) return [];
  try {
    return polygonClipping.union(polys[0], ...polys.slice(1));
  } catch {
    // The boolean engine can fail on pathological input. Overlapping outlines
    // still fill correctly under the nonzero rule, so fall back to them as-is.
    return polys;
  }
}

/**
 * Converts a glyph's strokes to font outlines: union, flip to font units
 * (y up, baseline 0), scale and shift, simplify, round and orient
 * (outer contours clockwise, holes counter-clockwise, as TrueType expects).
 * Horizontal placement happens later, in layoutGlyph.
 */
export function strokesToContours(inp: OutlineInputs): Contour[] {
  const mp = unionStrokes(inp.strokes, inp.stroke);
  const scale = inp.layout.glyphScale * inp.adjust.scale;
  const shift = inp.layout.baselineShift + inp.adjust.offsetY;
  const contours: Contour[] = [];
  for (const poly of mp) {
    poly.forEach((rawRing, ringIndex) => {
      let ring: Point[] = rawRing.map(([x, y]) => [x * scale, (CANVAS_BASELINE - y) * scale + shift]);
      const first = ring[0], last = ring[ring.length - 1];
      if (ring.length > 1 && first[0] === last[0] && first[1] === last[1]) ring = ring.slice(0, -1);
      ring = roundRing(simplifyRing(ring, SIMPLIFY_TOLERANCE));
      if (ring.length < 3) return;
      const area = signedArea(ring);
      if (Math.abs(area) < MIN_RING_AREA) return;
      const isHole = ringIndex > 0;
      // Clockwise (negative area, y up) for outer rings; counter-clockwise for holes.
      if ((isHole && area < 0) || (!isHole && area > 0)) ring.reverse();
      contours.push(polygonToContour(ring));
    });
  }
  return contours;
}

export function processGlyph(inp: OutlineInputs, updatedAt: number): ProcessedOutline {
  return { key: outlineKey(updatedAt, inp), contours: strokesToContours(inp) };
}

/**
 * Places a glyph horizontally: its ink starts at the left sidebearing and its
 * advance is ink width + both sidebearings + tracking. Widths therefore follow
 * the drawing: an I comes out narrower than an M.
 */
export function layoutGlyph(
  char: string,
  contours: Contour[],
  layout: Pick<FontLayout, 'sidebearing' | 'tracking'>,
  adjust: Pick<GlyphAdjust, 'lsb' | 'rsb'>,
): LaidOutGlyph {
  const codePoint = char.codePointAt(0)!;
  const bbox = contoursBBox(contours);
  if (!bbox) return { char, codePoint, contours: [], advanceWidth: 0, bbox: null };
  const lsb = Math.round(layout.sidebearing + adjust.lsb);
  const rsb = Math.round(layout.sidebearing + adjust.rsb);
  const dx = lsb - bbox.xMin;
  const placed = contours.map((c) => c.map((p) => ({ ...p, x: p.x + dx })));
  const width = bbox.xMax - bbox.xMin;
  const advanceWidth = Math.max(1, Math.round(width + lsb + rsb + layout.tracking));
  return {
    char,
    codePoint,
    contours: placed,
    advanceWidth,
    bbox: { xMin: lsb, yMin: bbox.yMin, xMax: lsb + width, yMax: bbox.yMax },
  };
}
