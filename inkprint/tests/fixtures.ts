import reference from '../src/data/reference-glyphs.json';
import { CANVAS_BASELINE } from '../src/types/font-metrics';
import type { GlyphRecord, Stroke } from '../src/types/glyph';
import { NO_ADJUST } from '../src/types/glyph';
import type { Project } from '../src/types/project';
import { newProject } from '../src/modules/storage/project-factory';

type Ref = { d: string; w: number; b: number[] };
const glyphs = (reference as { glyphs: Record<string, Ref> }).glyphs;

/** Flattens the simple SVG paths in reference-glyphs.json (M, L, Q, C, Z; absolute). */
export function flattenPath(d: string, steps = 6): [number, number][][] {
  const tokens = d.match(/[MLQCZ]|-?\d+(?:\.\d+)?/g) ?? [];
  const subpaths: [number, number][][] = [];
  let cur: [number, number][] = [];
  let i = 0;
  let x = 0, y = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const c = tokens[i++];
    if (c === 'M') { if (cur.length) subpaths.push(cur); x = num(); y = num(); cur = [[x, y]]; }
    else if (c === 'L') { x = num(); y = num(); cur.push([x, y]); }
    else if (c === 'Q') {
      const x1 = num(), y1 = num(), x2 = num(), y2 = num();
      for (let s = 1; s <= steps; s++) { const t = s / steps, u = 1 - t; cur.push([u * u * x + 2 * u * t * x1 + t * t * x2, u * u * y + 2 * u * t * y1 + t * t * y2]); }
      x = x2; y = y2;
    } else if (c === 'C') {
      const x1 = num(), y1 = num(), x2 = num(), y2 = num(), x3 = num(), y3 = num();
      for (let s = 1; s <= steps; s++) {
        const t = s / steps, u = 1 - t;
        cur.push([u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3]);
      }
      x = x3; y = y3;
    } else if (c === 'Z') { if (cur.length) { cur.push(cur[0]); subpaths.push(cur); cur = []; } }
  }
  if (cur.length) subpaths.push(cur);
  return subpaths;
}

/** Pointer input arrives every few units; long straight edges get the same density. */
function densify(pts: [number, number][], step: number): [number, number][] {
  const out: [number, number][] = [];
  pts.forEach((p, i) => {
    if (i > 0) {
      const q = pts[i - 1];
      const n = Math.floor(Math.hypot(p[0] - q[0], p[1] - q[1]) / step);
      for (let k = 1; k < n; k++) out.push([q[0] + ((p[0] - q[0]) * k) / n, q[1] + ((p[1] - q[1]) * k) / n]);
    }
    out.push(p);
  });
  return out;
}

/** "Handwriting" for tests: traces the reference glyph's outline with the pen. */
export function tracedStrokes(ch: string): Stroke[] {
  const ref = glyphs[ch];
  if (!ref) throw new Error(`no reference for ${ch}`);
  return flattenPath(ref.d).map((sub) => ({
    pen: false,
    points: densify(sub, 10).flatMap(([x, y]) => [x + 250, CANVAS_BASELINE - y, 0.5]),
  }));
}

export function testProject(over: Partial<Project> = {}): Project {
  return { ...newProject({ familyName: 'Test Hand', designer: 'Tess Ter' }), id: 'test-project-0001', ...over };
}

export function record(projectId: string, ch: string, strokes = tracedStrokes(ch)): GlyphRecord {
  return { projectId, char: ch, strokes, status: 'complete', adjust: { ...NO_ADJUST }, updatedAt: 1 };
}
