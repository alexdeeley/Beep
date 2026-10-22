import { Fragment, type CSSProperties } from 'react';
import { charName } from '../data/character-sets';

/**
 * Text set in the generated font. Characters the font lacks are shown as
 * marked placeholders (in a system font, boxed) instead of silently falling
 * back, so it is always clear which glyphs still need drawing.
 */
export function PreviewText({ text, family, chars, style, className }: { text: string; family: string; chars: Set<string>; style?: CSSProperties; className?: string }) {
  const parts: (string | { missing: string })[] = [];
  let run = '';
  for (const ch of Array.from(text)) {
    if (/\s/.test(ch) || chars.has(ch)) run += ch;
    else {
      if (run) parts.push(run);
      run = '';
      parts.push({ missing: ch });
    }
  }
  if (run) parts.push(run);
  return (
    <div className={`preview-text ${className ?? ''}`} style={{ fontFamily: `"${family}", serif`, ...style }} data-testid="preview-text">
      {parts.map((p, i) =>
        typeof p === 'string' ? (
          <Fragment key={i}>{p}</Fragment>
        ) : (
          <mark key={i} className="missing-glyph" title={`${charName(p.missing)} is not drawn yet`}>
            <span className="visually-hidden">(missing: </span>
            {p.missing}
            <span className="visually-hidden">)</span>
          </mark>
        ),
      )}
    </div>
  );
}

export function missingIn(text: string, chars: Set<string>): string[] {
  return [...new Set(Array.from(text).filter((c) => !/\s/.test(c) && !chars.has(c)))];
}
