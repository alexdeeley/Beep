import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NodeDriver } from '../server/db/node-driver.ts';
import { buildServices } from '../server/api.ts';
import { migrate, MIGRATIONS } from '../server/db/migrations.ts';
import { DuplicateError } from '../server/services/catalog.ts';
import { ValidationError } from '../server/domain/validate.ts';
import { MEDIA_TYPES, RELATIONSHIP_TYPES } from '../server/domain/media-types.ts';

const fresh = () => buildServices(new NodeDriver(':memory:'));

test('migrations apply once and are recorded', () => {
  const db = new NodeDriver(':memory:');
  assert.equal(migrate(db), MIGRATIONS[MIGRATIONS.length - 1].version);
  assert.equal(migrate(db), MIGRATIONS[MIGRATIONS.length - 1].version, 'second run is a no-op');
  assert.equal(db.query('SELECT COUNT(*) AS n FROM schema_migrations')[0].n, MIGRATIONS.length);
});

test('the registry: every media type has a label and valid attributes; relationship types have inverses', () => {
  const ids = new Set<string>();
  for (const t of MEDIA_TYPES) { assert.ok(t.label && t.plural && !ids.has(t.id), t.id); ids.add(t.id); for (const a of t.attributes) assert.ok(['text', 'number', 'year', 'date', 'list', 'url'].includes(a.kind)); }
  for (const r of RELATIONSHIP_TYPES) assert.ok(r.label && r.inverse && (r.kind === 'factual' || r.kind === 'editorial'), r.id);
});

test('entities: create, read, update, delete, with typed attributes, aliases, external ids and sources', () => {
  const { catalog } = fresh();
  const e = catalog.create({ type: 'album', name: 'Unknown Pleasures', year: 1979, description: 'Debut.', aliases: ['UP'], attributes: { format: 'LP', tracks: 'Disorder, Day of the Lords' }, externalIds: [{ provider: 'musicbrainz', value: 'abc-123' }], sources: [{ url: 'https://example.org/up', label: 'liner notes' }] });
  assert.match(e.id, /^ent_/);
  assert.deepEqual(e.attributes, { format: 'LP', tracks: ['Disorder', 'Day of the Lords'] }, 'a list attribute is parsed from a comma-separated string');
  assert.deepEqual(e.aliases, ['UP']);
  assert.equal(e.sources[0].label, 'liner notes');
  const again = catalog.get(e.id);
  assert.equal(again.name, 'Unknown Pleasures');
  const upd = catalog.update(e.id, { attributes: { format: 'LP (remaster)' } } as never);
  assert.equal(upd.attributes.format, 'LP (remaster)');
  assert.equal(upd.aliases[0], 'UP', 'untouched fields stay');
  catalog.remove(e.id);
  assert.throws(() => catalog.get(e.id), /no such entity/);
});

test('validation: unknown types and attributes, bad years and urls are refused with a readable message', () => {
  const { catalog } = fresh();
  assert.throws(() => catalog.create({ type: 'hologram', name: 'x' } as never), ValidationError);
  assert.throws(() => catalog.create({ type: 'film', name: 'x', attributes: { tracks: 'a' } } as never), (e: Error) => e instanceof ValidationError && /not an attribute of Film/.test(e.message));
  assert.throws(() => catalog.create({ type: 'film', name: 'x', year: 'soon' } as never), /whole year/);
  assert.throws(() => catalog.create({ type: 'film', name: 'x', sources: [{ url: 'not a url' }] } as never), /full web address/);
  assert.throws(() => catalog.create({ type: 'film', name: '' } as never), /name is required/);
});

test('missing metadata never crashes: an entity with nothing but a name and type reads back cleanly', () => {
  const { catalog, rels } = fresh();
  const e = catalog.create({ type: 'person', name: 'Someone' });
  assert.equal(e.year, null); assert.equal(e.description, ''); assert.deepEqual(e.attributes, {}); assert.deepEqual(e.sources, []);
  assert.deepEqual(rels.forEntity(e.id), []);
});

test('duplicates: same type and name is refused unless allowed; same name in another type is a hint; shared external id is exact', () => {
  const { catalog } = fresh();
  const book = catalog.create({ type: 'book', name: 'Solaris', year: 1961 });
  const dups = catalog.findDuplicates({ type: 'film', name: 'Solaris' });
  assert.equal(dups[0].strength, 'strong', 'a film called Solaris is not the book called Solaris');
  const film = catalog.create({ type: 'film', name: 'Solaris', year: 1972 });
  assert.notEqual(film.id, book.id);
  assert.throws(() => catalog.create({ type: 'film', name: 'solaris' }), DuplicateError, 'case and accents do not make a new thing');
  const forced = catalog.create({ type: 'film', name: 'Solaris', year: 2002 }, { allowDuplicate: true });
  assert.notEqual(forced.id, film.id, 'but a remake can be created when the caller says so');
  assert.equal(catalog.findDuplicates({ type: 'film', name: 'The Solaris' })[0]?.strength, 'possible');
  catalog.update(film.id, { externalIds: [{ provider: 'tmdb', value: '593' }] } as never);
  assert.equal(catalog.findDuplicates({ type: 'album', name: 'Different', externalIds: [{ provider: 'tmdb', value: '593' }] })[0].strength, 'exact');
  assert.throws(() => catalog.create({ type: 'album', name: 'Other', externalIds: [{ provider: 'tmdb', value: '593' }] }, { allowDuplicate: true }), /already belongs/);
});

test('search: by name or alias, prefix first, within a type, paged', () => {
  const { catalog } = fresh();
  catalog.create({ type: 'artist', name: 'New Order' });
  catalog.create({ type: 'artist', name: 'Joy Division', aliases: ['Warsaw'] });
  catalog.create({ type: 'album', name: 'Order of the Day' });
  const r = catalog.search('order');
  assert.deepEqual(r.items.map((i) => i.name), ['Order of the Day', 'New Order'], 'prefix match first');
  assert.equal(catalog.search('order', { type: 'artist' }).items.length, 1);
  assert.equal(catalog.search('warsaw').items[0].name, 'Joy Division', 'aliases are searched');
  assert.equal(catalog.search('', { limit: 2 }).items.length, 2);
  assert.equal(catalog.search('').total, 3);
});

test('relationships: typed, kinded, no duplicates, read from either end with the right label, cascade on delete', () => {
  const { catalog, rels } = fresh();
  const album = catalog.create({ type: 'album', name: 'Closer' }), prod = catalog.create({ type: 'person', name: 'Martin Hannett' });
  const r = rels.create({ fromId: album.id, toId: prod.id, type: 'produced_by', note: '', confidence: null });
  assert.equal(r.kind, 'factual', 'produced_by defaults to a factual claim');
  assert.throws(() => rels.create({ fromId: album.id, toId: prod.id, type: 'produced_by', note: '', confidence: null }), /already exists/);
  assert.equal(rels.forEntity(album.id)[0].label, 'produced by');
  assert.equal(rels.forEntity(prod.id)[0].label, 'produced');
  assert.equal(rels.forEntity(prod.id)[0].other.name, 'Closer');
  const ed = rels.create({ fromId: album.id, toId: prod.id, type: 'shares_aesthetic', note: 'hm', confidence: 0.4 });
  assert.equal(ed.kind, 'editorial');
  catalog.remove(prod.id);
  assert.equal(rels.forEntity(album.id).length, 0, 'edges go with the entity');
});

test('collections and notes: ordered items, reorder keeps everything, notes attach to entities', () => {
  const { catalog, cols } = fresh();
  const a = catalog.create({ type: 'film', name: 'A' }), b = catalog.create({ type: 'film', name: 'B' }), c = catalog.create({ type: 'film', name: 'C' });
  const col = cols.create({ title: 'Night films', visibility: 'private' });
  cols.addItem(col.id, a.id); cols.addItem(col.id, b.id, 'second'); cols.addItem(col.id, c.id);
  assert.throws(() => cols.addItem(col.id, a.id), /already in/);
  assert.deepEqual(cols.items(col.id).map((i) => i.entity.name), ['A', 'B', 'C']);
  assert.deepEqual(cols.reorder(col.id, [c.id]).map((i) => i.entity.name), ['C', 'A', 'B'], 'unlisted items follow in their old order');
  assert.deepEqual(cols.removeItem(col.id, a.id).map((i) => i.position), [1, 2], 'positions are renumbered');
  assert.equal(cols.get(col.id).itemCount, 2);
  assert.equal(cols.containing(c.id)[0].title, 'Night films');
  const n = cols.addNote(b.id, 'saw it twice');
  assert.equal(cols.notesFor(b.id)[0].body, 'saw it twice');
  cols.updateNote(n.id, 'three times');
  assert.equal(cols.notesFor(b.id)[0].body, 'three times');
  catalog.remove(b.id);
  assert.equal(cols.notesFor(b.id).length, 0);
});

test('persistence: data survives a restart of the service layer on the same database file', () => {
  const file = `/tmp/ranker-test-${process.pid}-${Date.now()}.sqlite`;
  const first = buildServices(new NodeDriver(file));
  const e = first.catalog.create({ type: 'game', name: 'Deus Ex', year: 2000 });
  first.db.db.close();
  const second = buildServices(new NodeDriver(file));
  assert.equal(second.catalog.get(e.id).name, 'Deus Ex');
  second.db.db.close();
});
