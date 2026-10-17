import { useEffect, useRef, useState } from 'react';
import { loadFontInBrowser, type LoadedFont } from '../modules/font-validation/browser-load';
import { generateFont, type GeneratedFont } from '../modules/font-generation';
import type { ProjectStore } from '../modules/storage/project-store';

export interface LiveFont {
  status: 'building' | 'ready' | 'error';
  /** CSS font-family of the generated font, loaded into this page. */
  family: string | null;
  font: GeneratedFont | null;
  /** Characters the font actually contains. */
  chars: Set<string>;
  error: string | null;
}

/**
 * Generates the real font from the project (debounced as the user edits) and
 * loads it into the page with FontFace, so previews show the actual file:
 * its outlines, advance widths and metrics. Old faces are removed.
 */
export function useGeneratedFont(store: ProjectStore, version: number, format: 'ttf' | 'otf' = 'ttf', delay = 250): LiveFont {
  const [state, setState] = useState<LiveFont>({ status: 'building', family: null, font: null, chars: new Set(), error: null });
  const loaded = useRef<LoadedFont | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, status: 'building' }));
    const t = setTimeout(async () => {
      try {
        const font = generateFont(store.project, store.records(), format);
        if (!font.validation.ok) {
          const msg = font.validation.issues.filter((i) => i.level === 'error').map((i) => i.message).join(' ');
          throw new Error(msg || 'The generated font did not pass validation.');
        }
        const face = await loadFontInBrowser(font.bytes);
        if (cancelled) { face.dispose(); return; }
        const old = loaded.current;
        loaded.current = face;
        setState({ status: 'ready', family: face.family, font, chars: new Set(font.report.included), error: null });
        // Let the new face paint before removing the old one (avoids a flash of fallback text).
        if (old) setTimeout(() => old.dispose(), 500);
      } catch (e) {
        if (!cancelled) setState((s) => ({ ...s, status: 'error', error: (e as Error).message }));
      }
    }, delay);
    return () => { cancelled = true; clearTimeout(t); };
  }, [store, version, format, delay]);

  useEffect(() => () => loaded.current?.dispose(), []);
  return state;
}
