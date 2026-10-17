import type { FontLayout, FontMetrics, StrokeStyle } from './font-metrics';

export type HandwritingStyle = 'natural' | 'print' | 'cursive' | 'block' | 'experimental';

export interface GhostSettings {
  visible: boolean;
  /** 0.05..0.6 */
  opacity: number;
  /** Size multiplier around the baseline centre, 0.6..1.4. */
  scale: number;
  /** Vertical nudge in font units. */
  offsetY: number;
}

// Guide-letter opacity: 36% reads clearly for tracing without competing with
// the ink. Projects saved with the earlier 18% default are raised to this
// when they open (see modules/storage/project-store.ts); a value someone set
// on purpose is left alone.
export const PREVIOUS_GHOST_OPACITY = 0.18;
export const DEFAULT_GHOST: GhostSettings = { visible: true, opacity: 0.36, scale: 1, offsetY: 0 };

export type ExportFormat = 'ttf' | 'otf';

export interface Project {
  id: string;
  /** What the project is called in the project list. */
  name: string;
  /** The font family name written into the font. */
  familyName: string;
  designer: string;
  copyright: string;
  /** "1.000" style version written into the font. */
  version: string;
  style: HandwritingStyle;
  /** Character group ids (see data/character-sets). */
  groups: string[];
  /** Extra characters the user added, in drawing order. */
  customChars: string;
  metrics: FontMetrics;
  stroke: StrokeStyle;
  layout: FontLayout;
  ghost: GhostSettings;
  canvasTheme: 'light' | 'dark';
  showGuides: boolean;
  exportFormat: ExportFormat;
  /** The character the user was last working on. */
  lastChar: string | null;
  createdAt: number;
  updatedAt: number;
}
