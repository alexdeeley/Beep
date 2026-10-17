import { useEffect, useState } from 'react';

export interface ReferenceGlyph {
  /** SVG path, font units, y up, baseline 0, cap height 700. */
  d: string;
  w: number;
  b: [number, number, number, number];
}

export interface ReferenceSet {
  capHeight: number;
  glyphs: Record<string, ReferenceGlyph>;
}

let cache: ReferenceSet | null = null;
let pending: Promise<ReferenceSet> | null = null;

/** The ghost outlines (Inter Regular), loaded on first use as a separate chunk. */
export function loadReferenceGlyphs(): Promise<ReferenceSet> {
  if (cache) return Promise.resolve(cache);
  pending ??= import('./reference-glyphs.json').then((m) => (cache = (m.default ?? m) as unknown as ReferenceSet));
  return pending;
}

export function useReferenceGlyphs(): ReferenceSet | null {
  const [set, setSet] = useState(cache);
  useEffect(() => {
    if (!set) loadReferenceGlyphs().then(setSet).catch(() => {});
  }, [set]);
  return set;
}
