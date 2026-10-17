// Development sample data. Every entity is origin "sample" and the
// descriptions say so; this is for seeing the app work, not a catalog of
// facts. It is loaded only on request (POST /api/sample) and can be
// removed in one call. External ids and sources are left empty on purpose
// - we do not invent provenance.

import { CatalogService } from './catalog.ts';
import { RelationshipService } from './relationships.ts';
import { CollectionService } from './collections.ts';

const S = ' (sample entry for trying the app; details unverified)';

export function loadSample(catalog: CatalogService, rels: RelationshipService, cols: CollectionService): { entities: number; relationships: number; collections: number } {
  const ids: Record<string, string> = {};
  const add = (key: string, type: string, name: string, year: number | null, description: string, attributes: Record<string, unknown> = {}, aliases: string[] = []) => {
    const e = catalog.create({ type, name, year, description: description + S, attributes, aliases, origin: 'sample' }, { allowDuplicate: true });
    ids[key] = e.id;
  };
  add('joy', 'artist', 'Joy Division', null, 'Manchester post-punk band, 1976-1980.', { origin: 'Salford, England', active_years: '1976-1980', members: ['Ian Curtis', 'Bernard Sumner', 'Peter Hook', 'Stephen Morris'] });
  add('unknown', 'album', 'Unknown Pleasures', 1979, 'Debut album; spare, cavernous production.', { format: 'LP' });
  add('closer', 'album', 'Closer', 1980, 'Second and final album.', { format: 'LP' });
  add('hannett', 'person', 'Martin Hannett', null, 'Producer known for space, reverb and digital delay.', { roles: ['producer'] });
  add('factory', 'record_label', 'Factory Records', null, 'Manchester independent label.', { founded: 1978, country: 'UK' });
  add('neworder', 'artist', 'New Order', null, 'Formed by the remaining members of Joy Division.', { origin: 'Manchester', active_years: '1980-' });
  add('power', 'album', 'Power, Corruption & Lies', 1983, 'Synth-pop and post-punk; the artwork is a Fantin-Latour.', { format: 'LP' });
  add('saville', 'person', 'Peter Saville', null, 'Graphic designer; the Factory sleeves.', { roles: ['designer'] });
  add('manchester', 'music_scene', 'Manchester post-punk', null, 'The late-70s scene around Factory and the Haçienda.', { place: 'Manchester', period: '1977-1990' });
  add('control', 'film', 'Control', 2007, 'Black-and-white biographical film about Ian Curtis.', { runtime_min: 122, country: 'UK' });
  add('corbijn', 'person', 'Anton Corbijn', null, 'Photographer and director.', { roles: ['director', 'photographer'] });
  add('touching', 'book', 'Touching from a Distance', 1995, 'Deborah Curtis\'s memoir, the basis for the film.', {});
  add('deborah', 'person', 'Deborah Curtis', null, 'Author.', { roles: ['author'] });
  add('24hpp', 'film', '24 Hour Party People', 2002, 'Comedy-drama about Factory Records.', { runtime_min: 117, country: 'UK' });
  add('wire', 'artist', 'Wire', null, 'London art-punk band.', { origin: 'London', active_years: '1976-' });
  add('pinkflag', 'album', 'Pink Flag', 1977, '21 short songs.', { format: 'LP' });
  add('interpol', 'artist', 'Interpol', null, 'New York band often compared with Joy Division.', { origin: 'New York', active_years: '1997-' });
  add('bright', 'album', 'Turn On the Bright Lights', 2002, 'Debut album.', { format: 'LP' });
  add('lynch', 'person', 'David Lynch', null, 'Director.', { roles: ['director'] });
  add('eraserhead', 'film', 'Eraserhead', 1977, 'Industrial dreamscape.', { runtime_min: 89, country: 'US' });
  add('twinpeaks', 'tv_series', 'Twin Peaks', null, 'Mystery series.', { years: '1990-1991', seasons: 2 });
  add('badalamenti', 'person', 'Angelo Badalamenti', null, 'Composer.', { roles: ['composer'] });
  add('neuromancer', 'book', 'Neuromancer', 1984, 'Cyberpunk novel.', { original_language: 'English', pages: 271 });
  add('gibson', 'person', 'William Gibson', null, 'Author.', { roles: ['author'] });
  add('deusex', 'game', 'Deus Ex', 2000, 'Immersive sim in a cyberpunk future.', { platforms: ['PC'] });

  const rel = (from: string, type: string, to: string, note = '', kind?: 'factual' | 'editorial' | 'inferred') => rels.create({ fromId: ids[from], toId: ids[to], type, note, confidence: null, kind });
  rel('unknown', 'performed_by', 'joy'); rel('closer', 'performed_by', 'joy');
  rel('unknown', 'produced_by', 'hannett'); rel('closer', 'produced_by', 'hannett'); rel('power', 'produced_by', 'neworder', 'self-produced');
  rel('unknown', 'released_by', 'factory'); rel('closer', 'released_by', 'factory'); rel('power', 'released_by', 'factory');
  rel('power', 'performed_by', 'neworder');
  rel('joy', 'part_of_scene', 'manchester'); rel('neworder', 'part_of_scene', 'manchester'); rel('factory', 'part_of_scene', 'manchester'); rel('hannett', 'part_of_scene', 'manchester');
  rel('neworder', 'influenced_by', 'joy', 'the same people, a different band', 'factual');
  rel('saville', 'collaborated_with', 'factory', 'designed the sleeves');
  rel('control', 'directed_by', 'corbijn'); rel('control', 'adapted_from', 'touching'); rel('touching', 'written_by', 'deborah');
  rel('24hpp', 'shares_theme', 'control', 'both tell the Factory story');
  rel('interpol', 'compared_with', 'joy', 'the comparison every review made'); rel('bright', 'performed_by', 'interpol');
  rel('pinkflag', 'performed_by', 'wire'); rel('wire', 'shares_aesthetic', 'joy', 'minimal, severe');
  rel('eraserhead', 'directed_by', 'lynch'); rel('twinpeaks', 'directed_by', 'lynch'); rel('twinpeaks', 'composed_by', 'badalamenti');
  rel('eraserhead', 'shares_aesthetic', 'unknown', 'industrial dread, 1977-79', 'editorial');
  rel('neuromancer', 'written_by', 'gibson'); rel('deusex', 'inspired_by', 'neuromancer');

  const c = cols.create({ title: 'Starter trail: Manchester to Lynch', description: 'A sample collection showing how a trail can cross media.' + S, visibility: 'private' });
  for (const k of ['unknown', 'hannett', 'control', 'eraserhead', 'twinpeaks']) cols.addItem(c.id, ids[k]);
  return { entities: Object.keys(ids).length, relationships: rels.count(), collections: 1 };
}

export function removeSample(catalog: CatalogService, db: { query(sql: string, params?: unknown[]): unknown[] }): number {
  const rows = db.query("SELECT id FROM entities WHERE origin = 'sample'") as { id: string }[];
  for (const r of rows) catalog.remove(String(r.id));
  db.query("DELETE FROM collections WHERE description LIKE '%sample entry for trying the app%'");
  return rows.length;
}
