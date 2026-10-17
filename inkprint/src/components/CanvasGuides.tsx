import { memo } from 'react';
import { CANVAS_BASELINE, CANVAS_WIDTH, type FontMetrics } from '../types/font-metrics';

/** Horizontal guide lines: baseline (strongest), cap height and x-height, then ascender and descender. */
export const CanvasGuides = memo(function CanvasGuides({ metrics, color }: { metrics: FontMetrics; color: string }) {
  const y = (h: number) => CANVAS_BASELINE - h;
  const lines: { h: number; label: string; dash?: string; width: number; opacity: number }[] = [
    { h: metrics.ascender, label: 'ascender', dash: '4 14', width: 2, opacity: 0.35 },
    { h: metrics.capHeight, label: 'cap height', dash: '18 12', width: 2.5, opacity: 0.55 },
    { h: metrics.xHeight, label: 'x-height', dash: '18 12', width: 2.5, opacity: 0.55 },
    { h: 0, label: 'baseline', width: 4, opacity: 0.85 },
    { h: metrics.descender, label: 'descender', dash: '4 14', width: 2, opacity: 0.35 },
  ];
  return (
    <g aria-hidden="true" className="guides">
      {lines.map((l) => (
        <g key={l.label} opacity={l.opacity}>
          <line x1={0} x2={CANVAS_WIDTH} y1={y(l.h)} y2={y(l.h)} stroke={color} strokeWidth={l.width} strokeDasharray={l.dash} vectorEffect="non-scaling-stroke" />
          <text x={14} y={y(l.h) - 10} fill={color} fontSize={26} fontFamily="system-ui, sans-serif" letterSpacing={1}>
            {l.label.toUpperCase()}
          </text>
        </g>
      ))}
    </g>
  );
});
