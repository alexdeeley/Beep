// List templates: the "stylesheet" for lists built from a topic.
//
// Type a topic ("Beatles albums", "Studio Ghibli films", "Booker Prize
// winners") and a template says what every item on that kind of list
// should carry (year released, who made it, how popular it is, the typed
// attributes of its media type) and how the list is laid out: which
// columns, in what order, and how each is drawn. The same template drives
// the AI gathering prompt, the review table, and the saved collection page,
// so adding a kind of list is adding an entry here.
//
// Every item's context comes from the entity itself: `year` and the common
// CONTEXT_ATTRIBUTES (creator, genres, popularity) plus the media type's own
// attributes. Nothing is stored twice.

import { MEDIA_TYPES, mediaType } from './media-types.ts';
import type { AttributeDef } from './media-types.ts';

// How a column is drawn. `bar` is a 0-100 estimate drawn as a bar; `pills`
// is a short list; `text` is plain; `year` right-aligned digits.
export type ColumnStyle = 'text' | 'year' | 'number' | 'bar' | 'pills' | 'long';

export interface ListColumn {
  key: string;                    // 'name' | 'year' | 'why' | an attribute key
  label: string;
  style: ColumnStyle;
  table?: boolean;                // shown in the compact table (default true); false = only in the row's detail
}

export interface ListTemplate {
  id: string;                     // e.g. 'albums'
  label: string;                  // 'Albums'
  type: string;                   // the media type its items become
  example: string;                // a topic that fits, shown as a placeholder
  gather: string;                 // what to look for, in words, for the gatherer
  columns: ListColumn[];          // the layout
  attributeKeys: string[];        // which of the type's attributes the gatherer fills
}

const NAME: ListColumn = { key: 'name', label: 'Title', style: 'text' };
const YEAR: ListColumn = { key: 'year', label: 'Year', style: 'year' };
const BY: ListColumn = { key: 'creator', label: 'By', style: 'text' };
const POP: ListColumn = { key: 'popularity', label: 'Popularity', style: 'bar' };
const GENRES: ListColumn = { key: 'genres', label: 'Genres', style: 'pills' };
const WHY: ListColumn = { key: 'why', label: 'Why it is here', style: 'long', table: false };
const ABOUT: ListColumn = { key: 'description', label: 'About', style: 'long', table: false };

const attr = (type: string, key: string, style: ColumnStyle = 'text', table = true): ListColumn => {
  const def = mediaType(type)?.attributes.find((a) => a.key === key);
  if (!def) throw new Error(`list template: ${type} has no attribute ${key}`);
  return { key, label: def.label, style, table };
};

const common = (type: string, extra: ListColumn[], withBy = true): ListColumn[] => [NAME, YEAR, ...(withBy ? [BY] : []), ...extra, POP, GENRES, ABOUT, WHY].filter((c, i, arr) => arr.findIndex((x) => x.key === c.key) === i).filter((c) => c.key === 'name' || c.key === 'year' || c.key === 'why' || c.key === 'description' || mediaType(type)?.attributes.some((a) => a.key === c.key));

export const LIST_TEMPLATES: ListTemplate[] = [
  { id: 'albums', label: 'Albums', type: 'album', example: 'Beatles albums', gather: 'studio albums first, then live albums and notable compilations; the year of first release; the artist; the format; running time in minutes',
    columns: common('album', [attr('album', 'format'), attr('album', 'length_min', 'number', false)]), attributeKeys: ['creator', 'genres', 'popularity', 'format', 'length_min'] },
  { id: 'tracks', label: 'Songs', type: 'track', example: 'Songs written by Burt Bacharach', gather: 'the year of first release; the performing artist; the length in seconds if known',
    columns: common('track', [attr('track', 'length_sec', 'number', false)]), attributeKeys: ['creator', 'genres', 'popularity', 'length_sec'] },
  { id: 'artists', label: 'Artists and bands', type: 'artist', example: 'Manchester bands of the 1980s', gather: 'where they are from; the years they were active; members for a band; the year they formed or debuted as the year',
    columns: common('artist', [attr('artist', 'origin'), attr('artist', 'active_years')], false), attributeKeys: ['genres', 'popularity', 'origin', 'active_years', 'members'] },
  { id: 'films', label: 'Films', type: 'film', example: 'Studio Ghibli films', gather: 'the year of release; the director; runtime in minutes; country and original language',
    columns: common('film', [attr('film', 'runtime_min', 'number', false), attr('film', 'country', 'text', false)]), attributeKeys: ['creator', 'genres', 'popularity', 'runtime_min', 'country', 'language'] },
  { id: 'tv', label: 'TV series', type: 'tv_series', example: 'HBO dramas', gather: 'the years it ran; the creator or showrunner; the number of seasons; the country; the year it began as the year',
    columns: common('tv_series', [attr('tv_series', 'years'), attr('tv_series', 'seasons', 'number', false)]), attributeKeys: ['creator', 'genres', 'popularity', 'years', 'seasons', 'country'] },
  { id: 'books', label: 'Books', type: 'book', example: 'Booker Prize winners', gather: 'the year of first publication; the author; the original language; the page count of a standard edition',
    columns: common('book', [attr('book', 'original_language', 'text', false), attr('book', 'pages', 'number', false)]), attributeKeys: ['creator', 'genres', 'popularity', 'original_language', 'pages'] },
  { id: 'games', label: 'Video games', type: 'game', example: 'Nintendo 64 games', gather: 'the year of first release; the developer; the platforms it shipped on',
    columns: common('game', [attr('game', 'platforms', 'pills')]), attributeKeys: ['creator', 'genres', 'popularity', 'platforms'] },
  { id: 'people', label: 'People', type: 'person', example: 'French New Wave directors', gather: 'birth and death years; their roles; their birth year as the year; what they are known for in the description',
    columns: common('person', [attr('person', 'born', 'year'), attr('person', 'died', 'year'), attr('person', 'roles', 'pills')], false), attributeKeys: ['genres', 'popularity', 'born', 'died', 'roles'] },
  { id: 'podcasts', label: 'Podcasts', type: 'podcast', example: 'History podcasts', gather: 'the years it has run; the host or producer; the year it began as the year',
    columns: common('podcast', [attr('podcast', 'years')]), attributeKeys: ['creator', 'genres', 'popularity', 'years'] },
  { id: 'artworks', label: 'Artworks', type: 'artwork', example: 'Paintings by Vermeer', gather: 'the year it was made; the artist; the medium; where it hangs now',
    columns: common('artwork', [attr('artwork', 'medium'), attr('artwork', 'location', 'text', false)]), attributeKeys: ['creator', 'genres', 'popularity', 'medium', 'location'] },
];

export const listTemplate = (id: string): ListTemplate | undefined => LIST_TEMPLATES.find((t) => t.id === id);
export const templateForType = (type: string): ListTemplate | undefined => LIST_TEMPLATES.find((t) => t.type === type);

// A plain collection (no template) still gets a sensible layout.
export const GENERIC_COLUMNS: ListColumn[] = [NAME, YEAR, BY, POP, GENRES, ABOUT, WHY];

// Attribute definitions a template gathers, resolved against the registry.
export function templateAttributes(t: ListTemplate): AttributeDef[] {
  const mt = mediaType(t.type);
  return t.attributeKeys.map((k) => mt?.attributes.find((a) => a.key === k)).filter((a): a is AttributeDef => !!a);
}

// Sanity: every template's type exists (fails fast at startup, not at use).
for (const t of LIST_TEMPLATES) if (!MEDIA_TYPES.some((m) => m.id === t.type)) throw new Error(`list template ${t.id}: unknown type ${t.type}`);
