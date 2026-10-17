import { memo } from 'react';
import { charName, groupLabel } from '../data/character-sets';
import type { ProjectStore } from '../modules/storage/project-store';
import type { Contour, GlyphStatus } from '../types/glyph';
import { GlyphShape } from './GlyphShape';
import { STATUS_MARK, STATUS_TEXT } from './ui';

export type GridFilter = 'all' | 'unfinished' | 'needs-revision' | 'complete';

const Tile = memo(function Tile({ char, status, contours, href }: { char: string; status: GlyphStatus; contours: Contour[]; href: string }) {
  return (
    <li>
      <a className={`tile st-${status}`} href={href} aria-label={`${charName(char)}: ${STATUS_TEXT[status]}. Open in the drawing studio.`}>
        <span className="tile-char" aria-hidden="true">{char}</span>
        {contours.length > 0 ? <GlyphShape contours={contours} className="tile-glyph" /> : <span className="tile-missing" aria-hidden="true">{char}</span>}
        <span className="tile-status" aria-hidden="true">
          {STATUS_MARK[status]} {STATUS_TEXT[status]}
        </span>
      </a>
    </li>
  );
});

/** Every character as a tile showing its actual drawn glyph and its status. */
export function CharacterGrid({ store, filter }: { store: ProjectStore; filter: GridFilter }) {
  const groups = [...new Set(store.inventory.map((e) => e.groupId))];
  const keep = (s: GlyphStatus) =>
    filter === 'all' || (filter === 'complete' ? s === 'complete' : filter === 'needs-revision' ? s === 'needs-revision' : s !== 'complete');
  const id = encodeURIComponent(store.project.id);
  let shown = 0;
  const sections = groups.map((g) => {
    const entries = store.inventory.filter((e) => e.groupId === g && keep(store.status(e.char)));
    shown += entries.length;
    if (!entries.length) return null;
    return (
      <section key={g} className="grid-section" aria-labelledby={`grp-${g}`}>
        <h2 id={`grp-${g}`}>{groupLabel(g)}</h2>
        <ul className="char-grid">
          {entries.map(({ char }) => (
            <Tile key={char} char={char} status={store.status(char)} contours={store.contours(char)} href={`#/p/${id}/draw/${encodeURIComponent(char)}`} />
          ))}
        </ul>
      </section>
    );
  });
  return shown ? <>{sections}</> : <p className="empty-note">No characters match this filter.</p>;
}
