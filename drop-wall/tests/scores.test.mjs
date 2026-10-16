import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_ENTRIES, cleanKey, cleanName, cleanScore, insert, lowerIsBetter, qualifies } from '../src/scores.js';

test('keys: only the game\'s own mode keys are accepted', () => {
  assert.equal(cleanKey('classic:seven:standard:10:classic'), 'classic:seven:standard:10:classic');
  assert.equal(cleanKey('daily:2026-10-16'), 'daily:2026-10-16');
  assert.equal(cleanKey('endurance:target:seven:classic'), 'endurance:target:seven:classic');
  assert.equal(cleanKey('party:x'), null);
  assert.equal(cleanKey('classic:<script>'), null);
  assert.equal(cleanKey('classic:' + 'a'.repeat(80)), null);
  assert.equal(cleanKey(42), null);
});

test('names: trimmed, upper-cased, printable, at most 14 characters, never empty', () => {
  assert.equal(cleanName('  maisie  '), 'MAISIE');
  assert.equal(cleanName('a\u0000b​c'), 'ABC');
  assert.equal(cleanName('abcdefghijklmnopqrstuvwxyz'), 'ABCDEFGHIJKLMN');
  assert.equal(cleanName(''), 'ANON');
  assert.equal(cleanName(null), 'ANON');
});

test('scores: whole numbers in range; fewest-balls boards count balls', () => {
  assert.equal(cleanScore('classic:x', 12345), 12345);
  assert.equal(cleanScore('classic:x', '12345'), 12345);
  assert.equal(cleanScore('classic:x', 1.5), null);
  assert.equal(cleanScore('classic:x', -1), null);
  assert.equal(cleanScore('classic:x', 1e10), null);
  assert.equal(lowerIsBetter('endurance:target:seven:classic'), true);
  assert.equal(cleanScore('endurance:target:seven:classic', 0), null, 'zero balls is impossible');
  assert.equal(cleanScore('endurance:target:seven:classic', 17), 17);
});

test('a board stays sorted, capped at 25, ties keep the earlier entry on top', () => {
  const key = 'classic:x';
  let entries = [];
  const scores = [500, 900, 100, 900, 700];
  const ranks = scores.map((s, i) => { const r = insert(entries, key, { name: 'P' + i, score: s, t: i }); entries = r.entries; return r.rank; });
  assert.deepEqual(ranks, [1, 1, 3, 2, 3]);
  assert.deepEqual(entries.map((e) => e.name), ['P1', 'P3', 'P4', 'P0', 'P2']);
  for (let i = 0; i < 40; i++) entries = insert(entries, key, { name: 'X', score: 1000 + i, t: 0 }).entries;
  assert.equal(entries.length, MAX_ENTRIES);
  assert.equal(entries[0].score, 1039);
  assert.equal(qualifies(entries, key, 1000), false, 'below the board');
  assert.equal(insert(entries, key, { name: 'LOW', score: 5, t: 0 }).rank, 0);
  assert.equal(qualifies(entries, key, 1016), true);
});

test('fewest-balls boards sort the other way', () => {
  const key = 'endurance:target:seven:classic';
  let entries = [];
  for (const s of [30, 12, 20]) entries = insert(entries, key, { name: 'N' + s, score: s, t: 0 }).entries;
  assert.deepEqual(entries.map((e) => e.score), [12, 20, 30]);
  assert.equal(insert(entries, key, { name: 'BEST', score: 9, t: 0 }).rank, 1);
});
