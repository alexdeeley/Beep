import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, INTRO, MODES, difficultyFrom, distractors, introducedLetters } from '../public/js/game.js';
import { Stats } from '../public/js/stats.js';
import { ALPHABET, DIGITS, NUMBER_SIGN, dotsFor, isDigit, isLetter } from '../public/js/braille.js';

class MemStorage { constructor() { this.m = new Map(); } getItem(k) { return this.m.has(k) ? this.m.get(k) : null; } setItem(k, v) { this.m.set(k, String(v)); } }
const seeded = (seed = 7) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const fresh = () => new Stats(new MemStorage());

test('every mode is described', () => {
  for (const m of ['letters', 'numbers', 'mixed', 'review', 'touch']) assert.ok(MODES[m].name && MODES[m].blurb, m);
});

test('letters: starts with a few letters and grows as they are settled', () => {
  const stats = fresh();
  assert.deepEqual(introducedLetters(stats), ALPHABET.slice(0, INTRO.start));
  // two right answers for each of the first six unlocks the next three
  for (const l of ALPHABET.slice(0, 6)) for (let i = 0; i < 2; i++) stats.record({ char: l, correct: true });
  assert.equal(introducedLetters(stats).length, INTRO.start + INTRO.step);
  // getting the new ones badly wrong keeps the pool where it is
  for (const l of ALPHABET.slice(6, 9)) for (let i = 0; i < 2; i++) stats.record({ char: l, correct: false });
  assert.equal(introducedLetters(stats).length, 9, 'accuracy over the group is under the bar');
  const g = new Game({ mode: 'letters', stats, rng: seeded(), sessionLength: 40 });
  let q, grew = false;
  while ((q = g.next())) {
    const unlocked = introducedLetters(stats);
    assert.ok(unlocked.includes(q.answer), `only unlocked letters are asked (${q.answer} with ${unlocked.length} unlocked)`);
    if (unlocked.length > 9) grew = true;
    g.answer(q.answer);
  }
  assert.ok(grew, 'answering well during the round unlocks more letters');
});

test('a question has three distinct choices, one of them the answer, and the right cells', () => {
  const g = new Game({ mode: 'letters', stats: fresh(), rng: seeded(3), sessionLength: 50 });
  let q;
  while ((q = g.next())) {
    assert.equal(q.choices.length, 3);
    assert.equal(new Set(q.choices).size, 3, 'choices are distinct');
    assert.ok(q.choices.includes(q.answer));
    assert.ok(q.choices.every(isLetter));
    assert.deepEqual(q.cells, [dotsFor(q.answer)]);
    assert.equal(q.kind, 'letter');
    assert.equal(q.prompt, 'Which letter is this?');
    g.answer(q.answer, 1000);
  }
  assert.equal(g.n, 50);
  assert.ok(g.done);
});

test('numbers: every question shows the number sign first and offers digits', () => {
  const g = new Game({ mode: 'numbers', stats: fresh(), rng: seeded(5), sessionLength: 30 });
  const seen = new Set();
  let q;
  while ((q = g.next())) {
    assert.equal(q.kind, 'digit');
    assert.deepEqual(q.cells[0], NUMBER_SIGN, 'number sign first');
    assert.deepEqual(q.cells[1], dotsFor(q.answer));
    assert.ok(q.choices.every(isDigit));
    seen.add(q.answer);
    g.answer(q.choices.find((c) => c !== q.answer));   // all wrong, to see the pool stays complete
  }
  assert.ok(seen.size >= 8, `most digits came up in 30 questions (${seen.size})`);
});

test('numbers in context: one number sign, a cell per digit, near-miss choices', () => {
  const g = new Game({ mode: 'numbers', stats: fresh(), rng: seeded(11), sessionLength: 20, context: true });
  let q;
  while ((q = g.next())) {
    assert.equal(q.kind, 'number');
    assert.ok(/^[1-9][0-9]{1,2}$/.test(q.answer), q.answer);
    assert.equal(q.cells.length, q.answer.length + 1);
    assert.deepEqual(q.cells[0], NUMBER_SIGN);
    assert.equal(new Set(q.choices).size, 3);
    for (const c of q.choices) assert.equal(c.length, q.answer.length, 'same number of digits');
    g.answer(q.answer, 500);
  }
});

test('mixed: both kinds come up and each question says which', () => {
  const g = new Game({ mode: 'mixed', stats: fresh(), rng: seeded(2), sessionLength: 60 });
  const kinds = new Set();
  let q;
  while ((q = g.next())) {
    kinds.add(q.kind);
    if (q.kind === 'digit') { assert.deepEqual(q.cells[0], NUMBER_SIGN); assert.ok(q.choices.every(isDigit)); assert.match(q.prompt, /number/); }
    else { assert.equal(q.cells.length, 1); assert.ok(q.choices.every(isLetter)); assert.match(q.prompt, /letter/); }
    g.answer(q.answer);
  }
  assert.deepEqual([...kinds].sort(), ['digit', 'letter']);
});

test('missed characters come up more often', () => {
  const stats = fresh();
  for (let i = 0; i < 6; i++) { stats.record({ char: 'b', correct: false }); }
  for (const l of ['a', 'c', 'd', 'e', 'f']) for (let i = 0; i < 6; i++) stats.record({ char: l, correct: true });
  const g = new Game({ mode: 'letters', stats, rng: seeded(9), sessionLength: 30 });
  const count = {};
  let q;
  while ((q = g.next())) { count[q.answer] = (count[q.answer] || 0) + 1; g.answer(q.answer); }
  assert.ok((count.b || 0) > (count.a || 0) * 1.5, `b (${count.b}) asked far more than a mastered letter (${count.a})`);
});

test('review: only missed characters, nothing to do when there are none', () => {
  const stats = fresh();
  const empty = new Game({ mode: 'review', stats, rng: seeded() });
  assert.equal(empty.next(), null);
  assert.equal(empty.exhausted, true);
  stats.record({ char: 'x', correct: false });
  stats.record({ char: '7', correct: false });
  stats.record({ char: 'a', correct: true });
  const g = new Game({ mode: 'review', stats, rng: seeded(4), sessionLength: 30 });
  let q, asked = new Set();
  while ((q = g.next())) { asked.add(q.answer); assert.ok(['x', '7'].includes(q.answer), q.answer); g.answer(q.answer); }
  assert.deepEqual([...asked].sort(), ['7', 'x']);
  // once both are mastered, review has nothing left
  assert.equal(stats.isMastered('x'), true);
  const after = new Game({ mode: 'review', stats, rng: seeded() });
  assert.equal(after.next(), null);
});

test('practice by touch: the prompt names the character, the choices are cells', () => {
  const g = new Game({ mode: 'touch', stats: fresh(), rng: seeded(6), sessionLength: 30 });
  let q;
  while ((q = g.next())) {
    assert.equal(q.reverse, true);
    assert.equal(q.choiceCells.length, 3);
    if (q.kind === 'digit') { assert.match(q.prompt, /Find the number \d/); q.choiceCells.forEach((cc) => assert.deepEqual(cc[0], NUMBER_SIGN)); }
    else { assert.match(q.prompt, /Find the letter [A-Z]/); q.choiceCells.forEach((cc) => assert.equal(cc.length, 1)); }
    const i = q.choices.indexOf(q.answer);
    assert.deepEqual(q.choiceCells[i], q.kind === 'digit' ? [NUMBER_SIGN, dotsFor(q.answer)] : [dotsFor(q.answer)]);
    g.answer(q.answer);
  }
});

test('answering: right and wrong are reported, streaks and milestones, a second tap is ignored', () => {
  const stats = fresh();
  const g = new Game({ mode: 'letters', stats, rng: seeded(8), sessionLength: 12 });
  let res, milestones = [];
  for (let i = 0; i < 5; i++) { const q = g.next(); res = g.answer(q.answer, 700); if (res.milestone) milestones.push(res.milestone); }
  assert.equal(res.correct, true); assert.equal(res.streak, 5);
  assert.deepEqual(milestones, [5]);
  const q = g.next();
  const wrong = q.choices.find((c) => c !== q.answer);
  res = g.answer(wrong, 2000);
  assert.equal(res.correct, false); assert.equal(res.answer, q.answer); assert.equal(res.choice, wrong); assert.equal(res.streak, 0);
  assert.equal(g.answer(q.answer), null, 'the question is already answered');
  assert.equal(stats.char(q.answer).attempts, stats.char(q.answer).correct + 1, 'recorded once as a miss');
  while (!g.done) { const qq = g.next(); res = g.answer(qq.answer, 500); }
  assert.equal(res.done, true);
  assert.equal(g.next(), null);
  assert.equal(stats.summary().sessions, 1);
  assert.equal(res.session.answered, 12);
});

test('distractors prefer lookalikes when the setting is hard', () => {
  const rng = seeded(1);
  let close = 0;
  for (let i = 0; i < 200; i++) {
    const w = distractors('r', ALPHABET, 1, rng);
    assert.equal(w.length, 2); assert.ok(!w.includes('r')); assert.notEqual(w[0], w[1]);
    if (w.every((c) => Math.abs(dotsFor(c).length - dotsFor('r').length) <= 1)) close++;
  }
  assert.ok(close > 150, 'hard distractors are mostly similar shapes');
  const s = fresh();
  assert.equal(difficultyFrom(s), 0.3, 'gentle at first');
  for (let i = 0; i < 20; i++) s.record({ char: 'a', correct: true });
  assert.equal(difficultyFrom(s), 1, 'full difficulty after a perfect run');
});
