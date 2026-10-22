import { memo, useEffect, useMemo, useRef } from 'react';
import { attachPointerCapture } from '../modules/drawing/pointer-capture';
import { polygonToSvgPath, strokeInputPoints, strokeOutline } from '../modules/glyph-processing/stroke-outline';
import { CANVAS_HEIGHT, CANVAS_WIDTH, type FontMetrics, type StrokeStyle } from '../types/font-metrics';
import type { Stroke } from '../types/glyph';
import type { GhostSettings } from '../types/project';
import { CanvasGuides } from './CanvasGuides';
import { GhostTemplate } from './GhostTemplate';

const pathCache = new WeakMap<Stroke, { key: string; d: string }>();

/** SVG path for a finished stroke; cached per stroke and pen settings. */
export function strokePath(stroke: Stroke, style: StrokeStyle): string {
  const key = `${style.size}|${style.thinning}|${style.smoothing}|${style.streamline}`;
  const hit = pathCache.get(stroke);
  if (hit && hit.key === key) return hit.d;
  const d = polygonToSvgPath(strokeOutline(stroke, style));
  pathCache.set(stroke, { key, d });
  return d;
}

const Strokes = memo(function Strokes({ strokes, style, color }: { strokes: Stroke[]; style: StrokeStyle; color: string }) {
  return (
    <g fill={color} data-testid="strokes">
      {strokes.map((s, i) => (
        <path key={i} d={strokePath(s, style)} />
      ))}
    </g>
  );
});

export interface DrawingCanvasProps {
  char: string;
  strokes: Stroke[];
  style: StrokeStyle;
  metrics: FontMetrics;
  ghost: GhostSettings;
  showGuides: boolean;
  theme: 'light' | 'dark';
  label: string;
  onStroke(stroke: Stroke): void;
}

/**
 * The drawing surface. Coordinates are fixed (1000 × 1250 canvas units) no
 * matter how large it appears, so drawings scale with the screen. The stroke
 * in progress is painted straight into the DOM each frame, without React.
 */
export function DrawingCanvas({ char, strokes, style, metrics, ghost, showGuides, theme, label, onStroke }: DrawingCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const liveRef = useRef<SVGPathElement>(null);
  const styleRef = useRef(style);
  const onStrokeRef = useRef(onStroke);
  styleRef.current = style;
  onStrokeRef.current = onStroke;

  useEffect(() => {
    const el = svgRef.current!;
    return attachPointerCapture(
      el,
      {
        onProgress(points, pen) {
          const live = liveRef.current;
          if (!live) return;
          if (!points.length) { live.setAttribute('d', ''); return; }
          const pts = strokeInputPoints({ points, pen });
          live.setAttribute('d', polygonToSvgPath(strokeOutline(pts, styleRef.current, { pen, complete: false })));
        },
        onComplete(stroke) {
          onStrokeRef.current(stroke);
          // Clear the live path after React has painted the committed stroke.
          requestAnimationFrame(() => liveRef.current?.setAttribute('d', ''));
        },
      },
      () => true,
    );
  }, []);

  const colors = useMemo(
    () =>
      theme === 'dark'
        ? { bg: '#000', ink: '#fff', ghost: '#fff', guide: '#9a9a9a' }
        : { bg: '#fff', ink: '#000', ghost: '#000', guide: '#6b6b6b' },
    [theme],
  );

  return (
    <svg
      ref={svgRef}
      className={`canvas canvas-${theme}`}
      viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
      role="img"
      aria-label={label}
      data-testid="canvas"
      data-char={char}
    >
      <rect width={CANVAS_WIDTH} height={CANVAS_HEIGHT} fill={colors.bg} />
      {showGuides && <CanvasGuides metrics={metrics} color={colors.guide} />}
      <GhostTemplate char={char} ghost={ghost} metrics={metrics} color={colors.ghost} />
      <Strokes strokes={strokes} style={style} color={colors.ink} />
      <path ref={liveRef} fill={colors.ink} data-testid="live-stroke" />
    </svg>
  );
}
