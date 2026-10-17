// The media-type registry: the one place that knows which kinds of thing
// the catalog holds and which typed attributes each kind carries. Adding a
// media type is adding an entry here - no schema change, no new page.
//
// Attributes are stored per entity in entity_attributes, JSON-encoded, and
// validated against this registry on the way in. People (directors, authors,
// producers, actors, designers...) are one type, `person`, whose roles are
// expressed by relationships to the works they made.

export type AttributeKind = 'text' | 'number' | 'year' | 'date' | 'list' | 'url';

export interface AttributeDef { key: string; label: string; kind: AttributeKind; help?: string }

export interface MediaType {
  id: string;
  label: string;
  plural: string;
  group: 'music' | 'film' | 'books' | 'games' | 'other';
  isPerson?: boolean;
  isWork?: boolean;            // something you can consume (album, film, book, game, track, podcast, artwork)
  attributes: AttributeDef[];
}

const year: AttributeDef = { key: 'year', label: 'Year', kind: 'year' };
const country: AttributeDef = { key: 'country', label: 'Country', kind: 'text' };

// Context every kind of thing can carry, so that lists built from a topic
// ("Beatles albums", "Studio Ghibli films") have the same shape whatever the
// type: who made it, what it is like, and how widely known it is.
// `popularity` is a 0-100 estimate, never shown as an objective measure.
export const CONTEXT_ATTRIBUTES: AttributeDef[] = [
  { key: 'creator', label: 'By', kind: 'text', help: 'artist, director, author, studio…' },
  { key: 'genres', label: 'Genres', kind: 'list' },
  { key: 'popularity', label: 'Popularity', kind: 'number', help: '0-100 estimate of how widely known it is' },
];

export const MEDIA_TYPES: MediaType[] = [
  // music
  { id: 'artist', label: 'Artist', plural: 'Artists', group: 'music', attributes: [{ key: 'origin', label: 'Origin', kind: 'text' }, { key: 'active_years', label: 'Active years', kind: 'text', help: 'e.g. 1978-1983' }, { key: 'members', label: 'Members', kind: 'list' }] },
  { id: 'album', label: 'Album', plural: 'Albums', group: 'music', isWork: true, attributes: [year, { key: 'format', label: 'Format', kind: 'text', help: 'LP, EP, single, mixtape…' }, { key: 'tracks', label: 'Tracks', kind: 'list' }, { key: 'length_min', label: 'Length (minutes)', kind: 'number' }] },
  { id: 'track', label: 'Track', plural: 'Tracks', group: 'music', isWork: true, attributes: [year, { key: 'length_sec', label: 'Length (seconds)', kind: 'number' }] },
  { id: 'record_label', label: 'Record label', plural: 'Record labels', group: 'music', attributes: [{ key: 'founded', label: 'Founded', kind: 'year' }, country] },
  { id: 'music_scene', label: 'Scene or movement', plural: 'Scenes and movements', group: 'music', attributes: [{ key: 'place', label: 'Place', kind: 'text' }, { key: 'period', label: 'Period', kind: 'text' }] },
  // film and television
  { id: 'film', label: 'Film', plural: 'Films', group: 'film', isWork: true, attributes: [year, { key: 'runtime_min', label: 'Runtime (minutes)', kind: 'number' }, country, { key: 'language', label: 'Language', kind: 'text' }] },
  { id: 'tv_series', label: 'TV series', plural: 'TV series', group: 'film', isWork: true, attributes: [{ key: 'years', label: 'Years', kind: 'text', help: 'e.g. 1990-1991' }, { key: 'seasons', label: 'Seasons', kind: 'number' }, country] },
  { id: 'film_movement', label: 'Film movement', plural: 'Film movements', group: 'film', attributes: [{ key: 'place', label: 'Place', kind: 'text' }, { key: 'period', label: 'Period', kind: 'text' }] },
  // books
  { id: 'book', label: 'Book', plural: 'Books', group: 'books', isWork: true, attributes: [year, { key: 'original_language', label: 'Original language', kind: 'text' }, { key: 'pages', label: 'Pages', kind: 'number' }] },
  { id: 'publisher', label: 'Publisher', plural: 'Publishers', group: 'books', attributes: [{ key: 'founded', label: 'Founded', kind: 'year' }, country] },
  { id: 'literary_movement', label: 'Literary movement', plural: 'Literary movements', group: 'books', attributes: [{ key: 'period', label: 'Period', kind: 'text' }] },
  // games
  { id: 'game', label: 'Video game', plural: 'Video games', group: 'games', isWork: true, attributes: [year, { key: 'platforms', label: 'Platforms', kind: 'list' }] },
  { id: 'game_studio', label: 'Game studio', plural: 'Game studios', group: 'games', attributes: [{ key: 'founded', label: 'Founded', kind: 'year' }, country] },
  // other
  { id: 'person', label: 'Person', plural: 'People', group: 'other', isPerson: true, attributes: [{ key: 'born', label: 'Born', kind: 'year' }, { key: 'died', label: 'Died', kind: 'year' }, { key: 'roles', label: 'Roles', kind: 'list', help: 'director, producer, author, composer…' }] },
  { id: 'podcast', label: 'Podcast', plural: 'Podcasts', group: 'other', isWork: true, attributes: [{ key: 'years', label: 'Years', kind: 'text' }, { key: 'website', label: 'Website', kind: 'url' }] },
  { id: 'artwork', label: 'Artwork', plural: 'Artworks', group: 'other', isWork: true, attributes: [year, { key: 'medium', label: 'Medium', kind: 'text' }, { key: 'location', label: 'Location', kind: 'text' }] },
  { id: 'art_movement', label: 'Art movement', plural: 'Art movements', group: 'other', attributes: [{ key: 'period', label: 'Period', kind: 'text' }, { key: 'place', label: 'Place', kind: 'text' }] },
  { id: 'event', label: 'Event or exhibition', plural: 'Events and exhibitions', group: 'other', attributes: [{ key: 'date', label: 'Date', kind: 'date' }, { key: 'place', label: 'Place', kind: 'text' }] },
];

for (const t of MEDIA_TYPES) for (const a of CONTEXT_ATTRIBUTES) if (!t.attributes.some((x) => x.key === a.key)) t.attributes.push(a);

export const mediaType = (id: string): MediaType | undefined => MEDIA_TYPES.find((t) => t.id === id);

// Relationship types. `inverse` is how the same edge reads from the other
// end; `kind` is the default claim type (a producer credit is factual, "shares
// an aesthetic" is editorial unless a source says otherwise).
export interface RelationshipType { id: string; label: string; inverse: string; kind: 'factual' | 'editorial' }

export const RELATIONSHIP_TYPES: RelationshipType[] = [
  { id: 'influenced_by', label: 'influenced by', inverse: 'influenced', kind: 'editorial' },
  { id: 'collaborated_with', label: 'collaborated with', inverse: 'collaborated with', kind: 'factual' },
  { id: 'produced_by', label: 'produced by', inverse: 'produced', kind: 'factual' },
  { id: 'directed_by', label: 'directed by', inverse: 'directed', kind: 'factual' },
  { id: 'written_by', label: 'written by', inverse: 'wrote', kind: 'factual' },
  { id: 'composed_by', label: 'music by', inverse: 'composed music for', kind: 'factual' },
  { id: 'performed_by', label: 'performed by', inverse: 'performed', kind: 'factual' },
  { id: 'starring', label: 'starring', inverse: 'appeared in', kind: 'factual' },
  { id: 'member_of', label: 'member of', inverse: 'has member', kind: 'factual' },
  { id: 'part_of_scene', label: 'part of the scene', inverse: 'scene includes', kind: 'factual' },
  { id: 'released_by', label: 'released by', inverse: 'released', kind: 'factual' },
  { id: 'published_by', label: 'published by', inverse: 'published', kind: 'factual' },
  { id: 'developed_by', label: 'developed by', inverse: 'developed', kind: 'factual' },
  { id: 'adapted_from', label: 'adapted from', inverse: 'adapted as', kind: 'factual' },
  { id: 'inspired_by', label: 'inspired by', inverse: 'inspired', kind: 'editorial' },
  { id: 'shares_aesthetic', label: 'shares an aesthetic with', inverse: 'shares an aesthetic with', kind: 'editorial' },
  { id: 'similar_to', label: 'similar to', inverse: 'similar to', kind: 'editorial' },
  { id: 'companion_to', label: 'a companion to', inverse: 'a companion to', kind: 'editorial' },
  { id: 'compared_with', label: 'often compared with', inverse: 'often compared with', kind: 'editorial' },
  { id: 'shares_theme', label: 'shares a theme with', inverse: 'shares a theme with', kind: 'editorial' },
];

export const relationshipType = (id: string): RelationshipType | undefined => RELATIONSHIP_TYPES.find((t) => t.id === id);
