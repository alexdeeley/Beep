import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NodeDriver } from '../server/db/node-driver.ts';
import { buildServices, handle } from '../server/api.ts';
import { LIST_TEMPLATES, listTemplate, templateAttributes } from '../server/domain/list-templates.ts';
import { FakeProvider, draftPrompt, draftSchema } from '../server/services/ai.ts';
import type { AiProvider, DraftRequest, RawDraft } from '../server/services/ai.ts';
import { MEDIA_TYPES } from '../server/domain/media-types.ts';

const app = (ai: AiProvider | null, editKey?: string) => {
  const svc = buildServices(new NodeDriver(':memory:'), 'test', { ai });
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, ip = '9.9.9.9') => {
    const res = await handle(new Request('http://x/api' + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), svc, { editKey, ip });
    return { status: res.status, body: await res.json() as Record<string, unknown> & { error?: string } };
  };
  return { svc, call };
};

test('templates: every template maps to a real media type and gathers real attributes', () => {
  assert.ok(LIST_TEMPLATES.length >= 8);
  for (const t of LIST_TEMPLATES) {
    const mt = MEDIA_TYPES.find((m) => m.id === t.type);
    assert.ok(mt, `${t.id} -> ${t.type}`);
    const defs = templateAttributes(t);
    assert.equal(defs.length, t.attributeKeys.length, `${t.id}: every attribute key resolves`);
    assert.ok(t.columns.some((c) => c.key === 'name') && t.columns.some((c) => c.key === 'year') && t.columns.some((c) => c.key === 'popularity'), `${t.id} lays out name, year and popularity`);
    for (const c of t.columns) if (!['name', 'year', 'why', 'description'].includes(c.key)) assert.ok(mt!.attributes.some((a) => a.key === c.key), `${t.id} column ${c.key} is an attribute of ${t.type}`);
  }
  // every media type carries the shared context attributes
  for (const m of MEDIA_TYPES) for (const k of ['creator', 'genres', 'popularity']) assert.ok(m.attributes.some((a) => a.key === k), `${m.id} has ${k}`);
});

test('the gatherer prompt and schema follow the template', () => {
  const albums = listTemplate('albums')!;
  const p = draftPrompt({ topic: 'Beatles albums', template: albums, templates: LIST_TEMPLATES, count: 15, guidance: 'UK releases only' });
  assert.match(p.system, /albums: Albums/); assert.doesNotMatch(p.system, /films: Films/, 'a chosen template is the only one offered');
  assert.match(p.user, /Topic: Beatles albums/); assert.match(p.user, /Up to 15 items/); assert.match(p.user, /UK releases only/);
  const auto = draftPrompt({ topic: 'x', template: null, templates: LIST_TEMPLATES, count: 5, guidance: '' });
  assert.match(auto.system, /films: Films/); assert.match(auto.user, /Choose the template/);
  const schema = draftSchema(['albums', 'films']) as { properties: { template: { enum: string[] }; items: { items: { required: string[] } } } };
  assert.deepEqual(schema.properties.template.enum, ['albums', 'films']);
  assert.ok(schema.properties.items.items.required.includes('popularity'));
});

test('cleaning a raw draft: types values, drops junk, matches the catalog, keeps order', () => {
  const { svc } = app(new FakeProvider());
  const existing = svc.catalog.create({ type: 'album', name: 'Revolver', year: 1966 });
  svc.catalog.create({ type: 'film', name: 'Help!', year: 1965 });
  const raw: RawDraft = {
    template: 'albums', title: ' Beatles ', description: 'd', caveats: ['check years', ''],
    items: [
      { name: 'Please Please Me', year: 1963, description: 'debut', why: 'first', popularity: 72.4, uncertain: false, aliases: ['PPM', 'please please me'], attributes: [{ key: 'creator', value: 'The Beatles' }, { key: 'genres', value: 'rock, pop' }, { key: 'length_min', value: 'thirty-two' }, { key: 'runtime_min', value: '90' }] },
      { name: 'Revolver', year: 1966, description: '', why: '', popularity: 150, uncertain: true, aliases: [], attributes: [] },
      { name: 'Help!', year: 1965, description: '', why: '', popularity: -3, uncertain: false, aliases: [], attributes: [] },
      { name: 'revolver', year: 1966, description: 'dupe', why: '', popularity: 1, uncertain: false, aliases: [], attributes: [] },
      { name: '', year: null, description: '', why: '', popularity: null, uncertain: false, aliases: [], attributes: [] },
      { name: 'Bad Year', year: 99999, description: '', why: '', popularity: null, uncertain: false, aliases: [], attributes: [] },
    ],
  };
  const d = svc.lists.clean(raw, { topic: 'Beatles albums', template: null, count: 10 });
  assert.equal(d.template, 'albums'); assert.equal(d.type, 'album'); assert.equal(d.title, 'Beatles');
  assert.deepEqual(d.caveats, ['check years']);
  assert.deepEqual(d.items.map((i) => i.name), ['Please Please Me', 'Revolver', 'Help!', 'Bad Year']);
  assert.equal(d.rejected.length, 3, 'the nameless item, the repeat and the impossible year are reported'); assert.match(d.rejected.join(' '), /listed twice/); assert.match(d.rejected.join(' '), /year .99999. ignored/);
  const ppm = d.items[0];
  assert.equal(ppm.attributes.popularity, 72); assert.equal(ppm.attributes.creator, 'The Beatles'); assert.deepEqual(ppm.attributes.genres, ['rock', 'pop']);
  assert.equal(ppm.attributes.length_min, undefined); assert.ok(ppm.dropped.some((x) => /Length/.test(x)), 'a non-numeric length is dropped and reported');
  assert.ok(ppm.dropped.some((x) => /runtime_min/.test(x)), 'an attribute from another type is dropped and reported');
  assert.deepEqual(ppm.aliases, ['PPM'], 'aliases drop the name itself');
  assert.equal(ppm.action, 'new'); assert.equal(ppm.match, null);
  const rev = d.items[1];
  assert.equal(rev.attributes.popularity, 100); assert.equal(rev.uncertain, true);
  assert.equal(rev.match?.entity.id, existing.id); assert.equal(rev.match?.strength, 'exact'); assert.equal(rev.action, 'existing', 'an exact match defaults to linking the existing entity');
  const help = d.items[2];
  assert.equal(help.attributes.popularity, 0);
  assert.equal(help.match?.strength, 'strong'); assert.equal(help.action, 'new', 'a same-name film is only a hint for an album');
  assert.equal(d.items[3].year, null, 'an impossible year becomes unknown');
  const capped = svc.lists.clean(raw, { topic: 't', template: listTemplate('albums')!, count: 2 });
  assert.equal(capped.items.length, 2); assert.ok(capped.rejected.some((x) => /over the 2/.test(x)));
});

test('drafting through the API needs a provider, a topic and the edit key; then commit builds the list', async () => {
  const off = app(null);
  const none = await off.call('POST', '/lists/draft', { topic: 'Beatles albums' });
  assert.equal(none.status, 503); assert.match(none.body.error!, /ANTHROPIC_API_KEY/);
  assert.equal(((await off.call('GET', '/lists/templates')).body.ai as { configured: boolean }).configured, false);
  assert.equal(((await off.call('GET', '/status')).body.ai as { configured: boolean }).configured, false);

  const { svc, call } = app(new FakeProvider(), 'k');
  assert.equal((await call('POST', '/lists/draft', { topic: 'Beatles albums' })).status, 401, 'locked: drafts need the key, so strangers cannot spend the AI budget');
  const K = { 'x-edit-key': 'k' };
  assert.equal((await call('POST', '/lists/draft', { topic: '' }, K)).status, 400);
  assert.equal((await call('POST', '/lists/draft', { topic: 'x', template: 'nope' }, K)).status, 400);
  const tpl = await call('GET', '/lists/templates');
  assert.ok((tpl.body.templates as unknown[]).length >= 8); assert.equal((tpl.body.ai as { provider: string }).provider, 'fake');

  // something already in the library gets linked, not doubled
  const rubber = svc.catalog.create({ type: 'album', name: 'Rubber Soul', year: 1965 });
  const draft = await call('POST', '/lists/draft', { topic: 'Beatles albums', count: 5 }, K);
  assert.equal(draft.status, 200);
  const d = draft.body as unknown as { template: string; type: string; items: { name: string; action: string; match: { entity: { id: string } } | null; attributes: Record<string, unknown>; why: string; year: number }[]; generatedBy: string; rejected: string[] };
  assert.equal(d.template, 'albums'); assert.equal(d.type, 'album'); assert.equal(d.items.length, 5); assert.equal(d.generatedBy, 'ai:fake/fake-1');
  assert.ok(d.rejected.some((x) => /Abbey Road/.test(x)), 'the sixth item is reported as over the count');
  const rs = d.items.find((i) => i.name === 'Rubber Soul')!;
  assert.equal(rs.action, 'existing'); assert.equal(rs.match!.entity.id, rubber.id);
  assert.equal(d.items[0].attributes.creator, 'The Beatles'); assert.equal(d.items[0].attributes.popularity, 72);

  // the reviewer skips one, renames one, keeps the link, then commits
  const items = d.items.map((i) => ({ action: i.action, existingId: i.match?.entity.id, name: i.name, year: i.year, description: '', why: i.why, aliases: [], attributes: i.attributes }));
  items[4].action = 'skip';
  items[0].name = 'Please Please Me (UK)';
  const commit = await call('POST', '/lists/commit', { topic: 'Beatles albums', template: 'albums', title: 'Beatles studio albums', description: 'In order of release.', visibility: 'unlisted', generatedBy: d.generatedBy, items }, K);
  assert.equal(commit.status, 201);
  const c = commit.body as unknown as { collection: { id: string; template: string; topic: string; generatedBy: string; visibility: string; itemCount: number }; items: { entity: { name: string; id: string; attributes: Record<string, unknown> }; note: string }[]; created: number; linked: number; skipped: number };
  assert.equal(c.created, 3); assert.equal(c.linked, 1); assert.equal(c.skipped, 1);
  assert.equal(c.collection.template, 'albums'); assert.equal(c.collection.topic, 'Beatles albums'); assert.equal(c.collection.generatedBy, 'ai:fake/fake-1'); assert.equal(c.collection.visibility, 'unlisted'); assert.equal(c.collection.itemCount, 4);
  assert.deepEqual(c.items.map((i) => i.entity.name), ['Please Please Me (UK)', 'Rubber Soul', 'Revolver', "Sgt. Pepper's Lonely Hearts Club Band"]);
  assert.equal(c.items[1].entity.id, rubber.id, 'the existing entity is the one in the list');
  assert.equal(c.items[0].entity.attributes.creator, 'The Beatles', 'items carry their attributes for the list layout');
  assert.equal(c.items[0].note, 'Where it starts: beat-group energy and Merseyside covers.', 'the why line becomes the item note');
  const e = svc.catalog.get(c.items[0].entity.id);
  assert.equal(e.origin, 'provider:fake'); assert.equal(e.year, 1963); assert.equal(e.attributes.format, 'LP');
  assert.equal(svc.catalog.count(), 4, 'only three new entities plus the pre-existing one');
  // the saved collection reads back with its template through the normal route
  const got = await call('GET', `/collections/${c.collection.id}`);
  assert.equal((got.body as { template: string }).template, 'albums');
  assert.equal(((got.body as { items: { entity: { attributes: Record<string, unknown> } }[] }).items)[0].entity.attributes.popularity, 72);

  // committing the same draft again links everything instead of doubling
  const again = await call('POST', '/lists/commit', { topic: 'Beatles albums', template: 'albums', title: 'Again', items: items.filter((i) => i.action !== 'skip').map((i) => ({ ...i, action: 'new', existingId: undefined })) }, K);
  assert.equal(again.status, 201); assert.equal((again.body as { created: number }).created, 0); assert.equal(svc.catalog.count(), 4);
  // bad commits are refused whole
  assert.equal((await call('POST', '/lists/commit', { template: 'albums', title: '', items: [] }, K)).status, 400);
  assert.equal((await call('POST', '/lists/commit', { template: 'albums', title: 't', items: [{ action: 'existing', existingId: 'ent_missing' }] }, K)).status, 404);
  assert.equal(svc.cols.list().length, 2, 'a failed commit leaves no half-made collection');
});

test('a provider failure is reported, never written, and AI drafts are rate-limited', async () => {
  const failing: AiProvider = { id: 'broken', model: 'x', draftList: async (_r: DraftRequest) => { throw new Error('boom'); } };
  const { svc, call } = app(failing);
  const r = await call('POST', '/lists/draft', { topic: 'anything' });
  assert.equal(r.status, 500); assert.equal(svc.cols.list().length, 0); assert.equal(svc.catalog.count(), 0);
  const fake = app(new FakeProvider());
  let last = 0;
  for (let i = 0; i < 7; i++) last = (await fake.call('POST', '/lists/draft', { topic: 'Beatles albums' }, {}, '5.5.5.5')).status;
  assert.equal(last, 429, 'the seventh draft in a minute from one address is refused');
  assert.equal((await fake.call('POST', '/lists/draft', { topic: 'Beatles albums' }, {}, '6.6.6.6')).status, 200, 'another address is unaffected');
});
