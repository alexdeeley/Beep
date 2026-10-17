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

export const DEFAULT_GHOST: GhostSettings = { visible: true, opacity: 0.18, scale: 1, offsetY: 0 };

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
