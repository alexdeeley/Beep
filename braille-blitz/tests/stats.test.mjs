import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Stats, MASTERY, STORAGE_KEY } from '../public/js/stats.js';

class MemStorage { constructor() { this.m = new Map(); } getItem(k) { return this.m.has(k) ? this.m.get(k) : null; } setItem(k, v) { this.m.set(k, String(v)); } }

test('answers are counted, streaks tracked, and everything survives a reload', () => {
  const store = new MemStorage();
  const s = new Stats(store);
  s.record({ char: 'a', correct: true, ms: 1200 });
  s.record({ char: 'b', correct: true, ms: 900 });
  s.record({ char: 'c', correct: false, ms: 3000 });
  s.record({ char: 'a', correct: true, ms: 800 });
  s.addTime(65000);
  const again = new Stats(store);
  const sm = again.summary();
  assert.equal(sm.total, 4); assert.equal(sm.correct, 3);
  assert.equal(sm.streak, 1); assert.equal(sm.longest, 2);
  assert.equal(sm.timeMs, 65000);
  assert.equal(again.char('a').attempts, 2);
  assert.equal(again.char('c').correct, 0);
  assert.deepEqual(again.mostMissed(['a', 'b', 'c']), [{ key: 'c', misses: 1, attempts: 1 }]);
  assert.ok(store.getItem(STORAGE_KEY).length > 10, 'stored as JSON');
});

test('mastery: at least 5 right in total and 90% over the last 10', () => {
  const s = new Stats(new MemStorage());
  for (let i = 0; i < 4; i++) s.record({ char: 'r', correct: true });
  assert.equal(s.isMastered('r'), false, 'four right is not enough');
  s.record({ char: 'r', correct: true });
  assert.equal(s.isMastered('r'), true, 'five right, all correct');
  s.record({ char: 'r', correct: false });
  s.record({ char: 'r', correct: false });
  assert.equal(s.isMastered('r'), false, '5 of 7 lately is under 90%');
  for (let i = 0; i < 10; i++) s.record({ char: 'r', correct: true });
  assert.equal(s.isMastered('r'), true, 'the window is the last 10, so old misses roll off');
  assert.equal(s.level('r'), 'mastered');
  assert.equal(s.level('q'), 'new');
  assert.equal(MASTERY.window, 10);
});

test('weak characters are those missed and not yet mastered', () => {
  const s = new Stats(new MemStorage());
  s.record({ char: 'a', correct: false });
  s.record({ char: 'b', correct: true });
  for (let i = 0; i < 6; i++) s.record({ char: 'c', correct: true });
  s.record({ char: 'c', correct: false });
  for (let i = 0; i < 4; i++) s.record({ char: 'c', correct: true });
  assert.deepEqual(s.weakChars(['a', 'b', 'c']), ['a'], 'c was missed once but is mastered again');
  assert.equal(s.missRate('a'), 1);
  assert.equal(s.missRate('b'), 0);
  assert.equal(s.missRate('z'), 0, 'never seen');
});

test('reset wipes everything, including what is stored', () => {
  const store = new MemStorage();
  const s = new Stats(store);
  s.record({ char: 'a', correct: true });
  s.reset();
  assert.equal(s.summary().total, 0);
  assert.equal(new Stats(store).summary().total, 0);
});

test('corrupt storage is ignored, not fatal', () => {
  const store = new MemStorage();
  store.setItem(STORAGE_KEY, '{not json');
  const s = new Stats(store);
  assert.equal(s.summary().total, 0);
  const s2 = new Stats(null);
  s2.record({ char: 'a', correct: true });
  assert.equal(s2.summary().total, 1, 'works with no storage at all');
});
