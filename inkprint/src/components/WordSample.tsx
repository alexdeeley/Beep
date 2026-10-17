import { memo } from 'react';
import { recordContours } from '../modules/font-generation/build-font';
import { contoursToSvgPath } from '../modules/glyph-processing/contour';
import { layoutGlyph } from '../modules/glyph-processing/process';
import type { GlyphRecord } from '../types/glyph';
import type { Project } from '../types/project';

/** Drawn glyphs set side by side with the given settings: used for before/after comparisons. */
export const WordSample = memo(function WordSample({ project, records, label }: { project: Project; records: GlyphRecord[]; label: string }) {
  let x = 0;
  const paths = records.map((r) => {
    const laid = layoutGlyph(r.char, recordContours(project, r), project.layout, r.adjust);
    const left = x;
    x += laid.advanceWidth;
    return laid.bbox ? <path key={r.char} d={contoursToSvgPath(laid.contours)} transform={`translate(${left} 0)`} /> : null;
  });
  const m = project.metrics;
  const top = Math.max(m.ascender, m.capHeight) + 150;
  const bottom = m.descender - 80;
  return (
    <figure className="word-sample">
      <figcaption>{label}</figcaption>
      <svg viewBox={`-30 ${-top} ${Math.max(x, 600) + 60} ${top - bottom}`} role="img" aria-label={`${label}: ${records.map((r) => r.char).join('')}`}>
        {[0, m.xHeight, m.capHeight].map((h) => (
          <line key={h} x1={-30} x2={x + 30} y1={-h} y2={-h} className={h === 0 ? 'ctx-line' : 'ctx-line faint'} vectorEffect="non-scaling-stroke" />
        ))}
        <g className="ink">{paths}</g>
      </svg>
    </figure>
  );
});
