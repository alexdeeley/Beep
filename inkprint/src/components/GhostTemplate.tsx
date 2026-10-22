import { memo } from 'react';
import { useReferenceGlyphs } from '../data/reference-glyphs';
import { CANVAS_BASELINE, CANVAS_WIDTH, type FontMetrics } from '../types/font-metrics';
import type { GhostSettings } from '../types/project';

/**
 * The faint reference character behind the canvas. It is drawn from the
 * reference outlines (or the system font for characters they lack) and is
 * purely a guide: it is never part of the user's glyph or font.
 */
export const GhostTemplate = memo(function GhostTemplate({ char, ghost, metrics, color }: { char: string; ghost: GhostSettings; metrics: FontMetrics; color: string }) {
  const ref = useReferenceGlyphs();
  if (!ghost.visible) return null;
  const glyph = ref?.glyphs[char];
  const s = ghost.scale * (metrics.capHeight / (ref?.capHeight ?? 700));
  const baseY = CANVAS_BASELINE - ghost.offsetY;
  if (glyph) {
    const cx = (glyph.b[0] + glyph.b[2]) / 2;
    const tx = CANVAS_WIDTH / 2 - cx * s;
    return (
      <path
        d={glyph.d}
        transform={`translate(${tx} ${baseY}) scale(${s} ${-s})`}
        fill={color}
        opacity={ghost.opacity}
        aria-hidden="true"
        data-testid="ghost"
      />
    );
  }
  if (!ref) return null;
  // Characters without a reference outline: the system font, cap height matched approximately.
  return (
    <text
      x={CANVAS_WIDTH / 2}
      y={baseY}
      textAnchor="middle"
      fontSize={(metrics.capHeight / 0.7) * ghost.scale}
      fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif"
      fill={color}
      opacity={ghost.opacity}
      aria-hidden="true"
      data-testid="ghost"
    >
      {char}
    </text>
  );
});
