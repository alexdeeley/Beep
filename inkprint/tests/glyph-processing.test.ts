import { describe, expect, it } from 'vitest';
import { contoursToSvgPath, contourToCommands, polygonToContour, reverseContour } from '../src/modules/glyph-processing/contour';
import { signedArea, simplifyRing } from '../src/modules/glyph-processing/geometry';
import { layoutGlyph, strokesToContours, unionStrokes } from '../src/modules/glyph-processing/process';
import { DEFAULT_LAYOUT, DEFAULT_STROKE } from '../src/types/font-metrics';
import type { Stroke } from '../src/types/glyph';
import { NO_ADJUST } from '../src/types/glyph';
import { tracedStrokes } from './fixtures';

const line = (x0: number, y0: number, x1: number, y1: number, n = 40): Stroke => ({
  pen: false,
  points: Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, 0.5]).flat(),
});
const inputs = (strokes: Stroke[], over = {}) => ({ strokes, stroke: DEFAULT_STROKE, layout: DEFAULT_LAYOUT, adjust: NO_ADJUST, ...over });

describe('glyph processing', () => {
  it('merges overlapping strokes into one outline', () => {
    const plus = [line(300, 600, 700, 600), line(500, 400, 500, 800)];
    // The union may also hold microscopic slivers from the round end caps; they are dropped later.
    expect(unionStrokes(plus, DEFAULT_STROKE).length).toBeGreaterThanOrEqual(1);
    expect(strokesToContours(inputs(plus)).length).toBe(1);
  });

  it('keeps separate strokes separate, and an O keeps its counter as a hole', () => {
    expect(strokesToContours(inputs([line(200, 500, 200, 900), line(600, 500, 600, 900)])).length).toBe(2);
    const o = strokesToContours(inputs(tracedStrokes('O').slice(0, 1)));
    expect(o.length).toBeGreaterThanOrEqual(2);
  });

  it('orients outer contours clockwise and holes counter-clockwise (y up)', () => {
    const cs = strokesToContours(inputs(tracedStrokes('O').slice(0, 1)));
    const areas = cs.map((c) => signedArea(c));
    const outer = areas.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a));
    expect(outer).toBeLessThan(0);
    expect(areas.some((a) => a > 0)).toBe(true);
  });

  it('maps the canvas baseline to y=0 and preserves the drawn height', () => {
    const cs = strokesToContours(inputs([line(500, 950, 500, 250)]));
    const ys = cs.flat().map((p) => p.y);
    expect(Math.min(...ys)).toBeGreaterThan(-40);
    expect(Math.min(...ys)).toBeLessThan(0);
    expect(Math.max(...ys)).toBeGreaterThan(700);
    expect(Math.max(...ys)).toBeLessThan(740);
  });

  it('applies scale and baseline shift non-destructively', () => {
    const strokes = [line(500, 950, 500, 250)];
    const before = JSON.stringify(strokes);
    const cs = strokesToContours(inputs(strokes, { layout: { ...DEFAULT_LAYOUT, glyphScale: 0.5, baselineShift: 100 } }));
    const ys = cs.flat().map((p) => p.y);
    expect(Math.max(...ys)).toBeLessThan(100 + 370);
    expect(Math.min(...ys)).toBeGreaterThan(80);
    expect(JSON.stringify(strokes)).toBe(before);
  });

  it('turns a tap into a dot', () => {
    const cs = strokesToContours(inputs([{ pen: false, points: [500, 900, 0.5] }]));
    expect(cs.length).toBe(1);
    expect(cs[0].length).toBeGreaterThan(3);
  });

  it('places ink at the sidebearing and derives the advance from the drawing', () => {
    const narrow = layoutGlyph('I', strokesToContours(inputs([line(500, 950, 500, 250)])), DEFAULT_LAYOUT, NO_ADJUST);
    const wide = layoutGlyph('M', strokesToContours(inputs([line(200, 950, 800, 250)])), DEFAULT_LAYOUT, NO_ADJUST);
    expect(narrow.bbox!.xMin).toBe(DEFAULT_LAYOUT.sidebearing);
    expect(narrow.advanceWidth).toBeLessThan(wide.advanceWidth);
    const spaced = layoutGlyph('I', narrow.contours, DEFAULT_LAYOUT, { ...NO_ADJUST, rsb: 40 });
    expect(spaced.advanceWidth).toBe(narrow.advanceWidth + 40);
  });

  it('handles rapid, jagged and self-crossing strokes without throwing', () => {
    const zig: Stroke = { pen: true, points: Array.from({ length: 120 }, (_, i) => [300 + (i % 2) * 300, 300 + i * 3, (i % 7) / 7]).flat() };
    const loop: Stroke = { pen: false, points: Array.from({ length: 200 }, (_, i) => [500 + 200 * Math.cos(i / 10), 600 + 200 * Math.sin(i / 7), 0.5]).flat() };
    const cs = strokesToContours(inputs([zig, loop]));
    expect(cs.length).toBeGreaterThan(0);
    for (const c of cs) for (const p of c) { expect(Number.isInteger(p.x)).toBe(true); expect(Number.isInteger(p.y)).toBe(true); }
  });

  it('simplifies without losing the shape', () => {
    const circle = Array.from({ length: 360 }, (_, i) => [Math.cos((i * Math.PI) / 180) * 300, Math.sin((i * Math.PI) / 180) * 300] as [number, number]);
    const s = simplifyRing(circle, 0.9);
    expect(s.length).toBeLessThan(120);
    expect(Math.abs(signedArea(s) - signedArea(circle)) / signedArea(circle)).toBeLessThan(0.01);
  });

  it('builds smooth quadratic contours that start on-curve and reverse cleanly', () => {
    const ring = Array.from({ length: 24 }, (_, i) => [Math.round(Math.cos(i / 3.82) * 200), Math.round(Math.sin(i / 3.82) * 200)] as [number, number]);
    const c = polygonToContour(ring);
    expect(c[0].on).toBe(true);
    expect(c.some((p) => !p.on)).toBe(true);
    const r = reverseContour(c);
    expect(r[0].on).toBe(true);
    expect(contourToCommands(c).at(-1)).toEqual({ type: 'Z' });
    expect(contoursToSvgPath([c])).toMatch(/^M.*Q.*Z$/);
  });
});
