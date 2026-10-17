import { CHARSET_PRESETS } from '../../data/character-sets';
import { DEFAULT_LAYOUT, DEFAULT_METRICS, DEFAULT_STROKE } from '../../types/font-metrics';
import { DEFAULT_GHOST, type HandwritingStyle, type Project } from '../../types/project';
import { defaultCopyright } from '../font-generation/build-font';

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'p-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Pen defaults that suit each handwriting style; all of them stay adjustable. */
export const STYLE_STROKES: Record<HandwritingStyle, Partial<Project['stroke']>> = {
  natural: {},
  print: { streamline: 0.4, thinning: 0.35 },
  cursive: { thinning: 0.55, smoothing: 0.6 },
  block: { size: 70, thinning: 0.1, streamline: 0.5 },
  experimental: { thinning: 0.7, size: 52 },
};

export function newProject(opts: { familyName?: string; designer?: string; style?: HandwritingStyle; groups?: string[]; customChars?: string } = {}): Project {
  const now = Date.now();
  const familyName = (opts.familyName ?? '').trim() || 'Inkprint Personal';
  const designer = (opts.designer ?? '').trim();
  const style = opts.style ?? 'natural';
  return {
    id: newId(),
    name: familyName,
    familyName,
    designer,
    copyright: defaultCopyright({ designer, familyName }),
    version: '1.000',
    style,
    groups: opts.groups ?? CHARSET_PRESETS[0].groups,
    customChars: opts.customChars ?? '',
    metrics: { ...DEFAULT_METRICS },
    stroke: { ...DEFAULT_STROKE, ...STYLE_STROKES[style] },
    layout: { ...DEFAULT_LAYOUT },
    ghost: { ...DEFAULT_GHOST },
    canvasTheme: 'light',
    showGuides: true,
    exportFormat: 'ttf',
    lastChar: null,
    createdAt: now,
    updatedAt: now,
  };
}
