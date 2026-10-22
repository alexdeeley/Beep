import { memo } from 'react';
import { contoursBBox, contoursToSvgPath } from '../modules/glyph-processing/contour';
import type { Contour } from '../types/glyph';

const TOP = 920;
const BOTTOM = -300;

/** A processed glyph outline (what the font will contain), centred in a square. */
export const GlyphShape = memo(function GlyphShape({ contours, className, title }: { contours: Contour[]; className?: string; title?: string }) {
  const bb = contoursBBox(contours);
  const size = TOP - BOTTOM;
  const cx = bb ? (bb.xMin + bb.xMax) / 2 : 500;
  return (
    <svg className={className} viewBox={`${cx - size / 2} ${-TOP} ${size} ${size}`} aria-hidden={title ? undefined : true} role={title ? 'img' : undefined} aria-label={title}>
      <line x1={cx - size} x2={cx + size} y1={0} y2={0} className="glyph-baseline" vectorEffect="non-scaling-stroke" />
      {bb && <path d={contoursToSvgPath(contours)} className="glyph-ink" />}
    </svg>
  );
});
