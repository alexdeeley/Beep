import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NodeDriver } from '../server/db/node-driver.ts';
import { buildServices } from '../server/api.ts';
import { loadSample, removeSample } from '../server/services/sample.ts';

const seeded = () => { const s = buildServices(new NodeDriver(':memory:')); loadSample(s.catalog, s.rels, s.cols); return s; };
const byName = (s: ReturnType<typeof seeded>, name: string) => s.catalog.search(name).items.find((i) => i.name === name)!;

test('sample data loads, is labelled, and can be removed cleanly', () => {
  const s = seeded();
  const st = s.catalog.count();
  assert.ok(st >= 20);
  assert.ok(s.catalog.get(byName(s, 'Closer').id).description.includes('sample entry'));
  assert.equal(s.db.query("SELECT COUNT(*) AS n FROM entities WHERE origin != 'sample'")[0].n, 0);
  assert.equal(removeSample(s.catalog, s.db), st);
  assert.equal(s.catalog.count(), 0); assert.equal(s.rels.count(), 0); assert.equal(s.cols.list().length, 0);
});

test('every recommendation is traceable: strategy, explanation, connection, evidence with relationship ids', () => {
  const s = seeded();
  const recs = s.disc.run('trail', { startId: byName(s, 'Unknown Pleasures').id, limit: 10 });
  assert.ok(recs.length >= 5);
  for (const r of recs) {
    assert.equal(r.strategy, 'trail');
    assert.ok(r.explanation.includes(r.entity.name) && r.explanation.includes('Unknown Pleasures'));
    assert.ok(r.connection.length > 10);
    assert.ok(r.evidence.length >= 1 && r.evidence.every((e) => e.relationshipId && e.text.length > 5));
    for (const e of r.evidence) assert.ok(s.rels.get(e.relationshipId!), 'evidence points at a real relationship');
    assert.ok(r.relevance >= 0 && r.relevance <= 1 && r.novelty >= 0 && r.novelty <= 1 && r.confidence >= 0 && r.confidence <= 1);
  }
  const far = recs.find((r) => r.entity.name === 'Twin Peaks');
  assert.ok(far, 'a trail can cross media: album -> film -> director -> series');
  assert.ok(far!.caveats.some((c) => /editorial/.test(c)), 'and says when a link in it is an opinion rather than a fact');
});

test('strategies behave differently and respect type and exclusions', () => {
  const s = seeded();
  const start = byName(s, 'Unknown Pleasures').id;
  const trail = s.disc.run('trail', { startId: start, limit: 10 }).map((r) => r.entity.name);
  const adjacent = s.disc.run('adjacent', { startId: start, limit: 10 }).map((r) => r.entity.name);
  const random = s.disc.run('random', { seed: 7, limit: 10 }).map((r) => r.entity.name);
  assert.notDeepEqual(trail, adjacent); assert.notDeepEqual(trail, random);
  assert.ok(adjacent.includes('Closer'), 'Closer shares Joy Division, Hannett and Factory with Unknown Pleasures but is not linked to it directly');
  assert.ok(!adjacent.includes('Joy Division'), 'direct neighbours are not "adjacent"');
  const films = s.disc.run('trail', { startId: start, type: 'film', limit: 10 });
  assert.ok(films.length && films.every((r) => r.entity.type === 'film'));
  const without = s.disc.run('adjacent', { startId: start, exclude: [byName(s, 'Closer').id] }).map((r) => r.entity.name);
  assert.ok(!without.includes('Closer'), 'dismissed things stay out');
  assert.deepEqual(s.disc.run('random', { seed: 7, limit: 5 }).map((r) => r.entity.id), s.disc.run('random', { seed: 7, limit: 5 }).map((r) => r.entity.id), 'random is reproducible for a seed');
  assert.ok(s.disc.run('random', { seed: 7 })[0].caveats[0].includes('random'), 'randomness is honest about itself');
  assert.throws(() => s.disc.run('trail', {}), /needs a starting entity/);
});

test('recommendations stay diverse: a trail does not return the same entity twice', () => {
  const s = seeded();
  const ids = s.disc.run('trail', { startId: byName(s, 'Joy Division').id, limit: 50 }).map((r) => r.entity.id);
  assert.equal(new Set(ids).size, ids.length);
});
