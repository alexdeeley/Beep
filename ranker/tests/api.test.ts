import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NodeDriver } from '../server/db/node-driver.ts';
import { buildServices, handle } from '../server/api.ts';

const app = (editKey?: string) => {
  const svc = buildServices(new NodeDriver(':memory:'));
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await handle(new Request('http://x/api' + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), svc, { editKey, ip: '1.2.3.4' });
    return { status: res.status, body: await res.json() as Record<string, unknown> & { error?: string } };
  };
  return { svc, call };
};

test('the API: create, search, read, relate, collect, note, discover, export', async () => {
  const { call } = app();
  assert.equal((await call('GET', '/health')).body.ok, true);
  const a = await call('POST', '/entities', { type: 'album', name: 'Pink Flag', year: 1977 });
  assert.equal(a.status, 201);
  const w = await call('POST', '/entities', { type: 'artist', name: 'Wire' });
  const dup = await call('POST', '/entities', { type: 'artist', name: 'wire' });
  assert.equal(dup.status, 409); assert.ok((dup.body.duplicate as { entity: { name: string } }).entity.name === 'Wire');
  const bad = await call('POST', '/entities', { type: 'album', name: 'x', attributes: { runtime_min: 3 } });
  assert.equal(bad.status, 400); assert.match(bad.body.error!, /not an attribute/);
  const r = await call('POST', '/relationships', { fromId: a.body.id, toId: w.body.id, type: 'performed_by' });
  assert.equal(r.status, 201);
  const got = await call('GET', `/entities/${a.body.id}`);
  assert.equal((got.body.relationships as unknown[]).length, 1);
  assert.equal((await call('GET', '/entities?q=pink')).body.total, 1);
  const col = await call('POST', '/collections', { title: 'Art punk', visibility: 'unlisted' });
  assert.equal(col.status, 201);
  assert.equal((await call('POST', `/collections/${col.body.id}/items`, { entityId: a.body.id })).status, 201);
  assert.equal(((await call('GET', `/collections/${col.body.id}`)).body.items as unknown[]).length, 1);
  assert.equal((await call('POST', `/entities/${a.body.id}/notes`, { body: 'short songs' })).status, 201);
  const disc = await call('GET', `/discover/trail?start=${a.body.id}`);
  assert.equal(disc.status, 200); assert.equal((disc.body as unknown as unknown[]).length, 1);
  assert.equal((await call('GET', '/discover/trail')).status, 400, 'a trail without a start is a clear 400');
  assert.equal((await call('GET', '/discover/nope')).status, 404);
  const exp = await call('GET', '/export');
  assert.equal(exp.body.format, 'ranker-export');
  assert.equal((exp.body.entities as unknown[]).length, 2);
  assert.equal((await call('GET', '/entities/ent_missing')).status, 404);
  assert.equal((await call('POST', '/entities', undefined)).status, 400, 'a missing body is a 400, not a crash');
});

test('a locked installation refuses changes without the edit key but still reads', async () => {
  const { call } = app('s3cret');
  assert.equal((await call('GET', '/status')).body.locked, true);
  assert.equal((await call('POST', '/entities', { type: 'film', name: 'x' })).status, 401);
  assert.equal((await call('POST', '/entities', { type: 'film', name: 'x' }, { 'x-edit-key': 'wrong' })).status, 401);
  assert.equal((await call('POST', '/entities', { type: 'film', name: 'x' }, { 'x-edit-key': 's3cret' })).status, 201);
  assert.equal((await call('GET', '/entities?q=x')).body.total, 1);
});

test('export and import round-trip: everything comes back, ids preserved, duplicates skipped on a second import', async () => {
  const { svc, call } = app();
  await call('POST', '/sample');
  const exp = (await call('GET', '/export')).body;
  const counts = { e: svc.catalog.count(), r: svc.rels.count(), c: svc.cols.list().length, n: svc.cols.allNotes().length };
  const dry = await call('POST', '/import?dryRun=1', exp);
  assert.equal((dry.body.entities as { added: number }).added, 0, 'a dry run of our own export adds nothing: all there already');
  const other = app();
  const rep = (await other.call('POST', '/import', exp)).body as { entities: { added: number }; relationships: { added: number }; collections: { added: number }; problems: string[] };
  assert.equal(rep.entities.added, counts.e); assert.equal(rep.relationships.added, counts.r); assert.equal(rep.collections.added, counts.c);
  assert.deepEqual(rep.problems, []);
  assert.equal(other.svc.catalog.get((exp.entities as { id: string }[])[0].id).id, (exp.entities as { id: string }[])[0].id, 'ids are preserved');
  const again = (await other.call('POST', '/import', exp)).body as { entities: { added: number; skipped: number } };
  assert.equal(again.entities.added, 0); assert.equal(again.entities.skipped, counts.e);
  assert.equal(other.svc.catalog.count(), counts.e, 'importing twice does not double the catalog');
  const junk = await other.call('POST', '/import', { format: 'other' });
  assert.equal(junk.status, 400);
  const partial = (await other.call('POST', '/import', { format: 'ranker-export', version: 1, entities: [{ id: 'ent_new1', type: 'film', name: 'Brand new' }, { id: 'ent_bad', type: 'nope', name: 'x' }] })).body as { entities: { added: number }; problems: string[] };
  assert.equal(partial.entities.added, 1); assert.equal(partial.problems.length, 1, 'a bad record is reported and the rest still land');
});
