import { memo } from 'react';
import { contoursToSvgPath } from '../modules/glyph-processing/contour';
import { layoutGlyph } from '../modules/glyph-processing/process';
import type { ProjectStore } from '../modules/storage/project-store';

function neighbours(char: string): [string, string] {
  if (/\p{Lu}/u.test(char)) return ['H', 'O'];
  if (/\p{Ll}/u.test(char)) return ['n', 'o'];
  if (/\p{N}/u.test(char)) return ['1', '0'];
  return ['n', 'H'];
}

/**
 * The current glyph between two neighbours, placed with its real outline,
 * sidebearings and advance width, so spacing and height problems show up
 * while drawing. Undrawn neighbours appear as outlined boxes.
 */
export const ContextStrip = memo(function ContextStrip({ store, char }: { store: ProjectStore; char: string; version: number }) {
  const [a, b] = neighbours(char);
  const seq = [a, char, b, char, a];
  const { layout, metrics } = store.project;
  let x = 0;
  const parts = seq.map((c, i) => {
    const contours = store.contours(c);
    const laid = layoutGlyph(c, contours, layout, store.glyph(c).adjust);
    const left = x;
    if (laid.bbox) {
      x += laid.advanceWidth;
      return <path key={i} d={contoursToSvgPath(laid.contours)} transform={`translate(${left} 0)`} className={c === char ? 'ctx-current' : 'ctx-other'} />;
    }
    const w = Math.round(metrics.capHeight * 0.55);
    x += w + 2 * layout.sidebearing;
    const h = /\p{Ll}/u.test(c) ? metrics.xHeight : metrics.capHeight;
    return <rect key={i} x={left + layout.sidebearing} y={-h} width={w} height={h} className="ctx-missing" vectorEffect="non-scaling-stroke" />;
  });
  const top = Math.max(metrics.ascender, metrics.capHeight) + 120;
  const bottom = metrics.descender - 60;
  return (
    <figure className="context-strip">
      <svg viewBox={`-40 ${-top} ${Math.max(x, 400) + 80} ${top - bottom}`} role="img" aria-label={`Spacing preview: ${seq.join('')}`}>
        <line x1={-40} x2={x + 40} y1={0} y2={0} className="ctx-line" vectorEffect="non-scaling-stroke" />
        <line x1={-40} x2={x + 40} y1={-metrics.xHeight} y2={-metrics.xHeight} className="ctx-line faint" vectorEffect="non-scaling-stroke" />
        <line x1={-40} x2={x + 40} y1={-metrics.capHeight} y2={-metrics.capHeight} className="ctx-line faint" vectorEffect="non-scaling-stroke" />
        {parts}
      </svg>
      <figcaption>In context, with font spacing</figcaption>
    </figure>
  );
});
