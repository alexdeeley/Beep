import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALPHABET, DIGITS, DIGIT_LETTER, LETTERS, NUMBER_SIGN, cellsFor, cellsForNumber, dotsFor, dotsLabel, fromUnicode, hamming, toUnicode } from '../public/js/braille.js';

// The standard reference: Unicode's Braille Patterns block encodes dot
// numbers directly in the code point, and these are the Unicode characters
// for the English Braille alphabet a-z (U+2801 BRAILLE PATTERN DOTS-1 is
// "a", and so on) and the number sign (U+283C, DOTS-3456).
const REFERENCE = '⠁⠃⠉⠙⠑⠋⠛⠓⠊⠚⠅⠇⠍⠝⠕⠏⠟⠗⠎⠞⠥⠧⠺⠭⠽⠵';

test('every letter matches the Unicode Braille reference', () => {
  assert.equal(REFERENCE.length, 26);
  ALPHABET.forEach((l, i) => {
    assert.equal(toUnicode(LETTERS[l]), REFERENCE[i], `letter ${l}`);
    assert.deepEqual(fromUnicode(REFERENCE[i]), LETTERS[l], `letter ${l} dots`);
  });
});

test('the number sign is dots 3-4-5-6 (U+283C)', () => {
  assert.deepEqual(NUMBER_SIGN, [3, 4, 5, 6]);
  assert.equal(toUnicode(NUMBER_SIGN), '⠼');
});

test('digits 1-9 and 0 reuse the cells for a-j, after the number sign', () => {
  const expect = { 1: 'a', 2: 'b', 3: 'c', 4: 'd', 5: 'e', 6: 'f', 7: 'g', 8: 'h', 9: 'i', 0: 'j' };
  for (const d of DIGITS) {
    assert.equal(DIGIT_LETTER[d], expect[d]);
    assert.deepEqual(dotsFor(d), LETTERS[expect[d]], `digit ${d}`);
    assert.deepEqual(cellsFor(d), [NUMBER_SIGN, LETTERS[expect[d]]], `digit ${d} is written with a number sign first`);
  }
  assert.deepEqual(cellsFor('a'), [LETTERS.a], 'a letter is one cell');
  assert.deepEqual(cellsForNumber('120'), [NUMBER_SIGN, LETTERS.a, LETTERS.b, LETTERS.j], 'one number sign for the whole number');
});

test('dots are sorted and unique, all 26 letters are distinct cells', () => {
  const seen = new Set();
  for (const l of ALPHABET) {
    const d = LETTERS[l];
    assert.deepEqual(d, [...new Set(d)].sort((a, b) => a - b), l);
    assert.ok(d.every((x) => x >= 1 && x <= 6), l);
    const u = toUnicode(d);
    assert.ok(!seen.has(u), `${l} duplicates another letter`);
    seen.add(u);
  }
});

test('k-t are a-j with dot 3 added; u, v, x, y, z add dots 3 and 6', () => {
  const first = ALPHABET.slice(0, 10), second = ALPHABET.slice(10, 20);
  second.forEach((l, i) => assert.deepEqual(LETTERS[l], [...LETTERS[first[i]], 3].sort((a, b) => a - b), l));
  for (const [l, base] of [['u', 'a'], ['v', 'b'], ['x', 'c'], ['y', 'd'], ['z', 'e']]) {
    assert.deepEqual(LETTERS[l], [...LETTERS[base], 3, 6].sort((a, b) => a - b), l);
  }
  assert.deepEqual(LETTERS.w, [2, 4, 5, 6], 'w is the odd one out');
});

test('helpers: hamming distance and spoken dot labels', () => {
  assert.equal(hamming(LETTERS.a, LETTERS.b), 1);
  assert.equal(hamming(LETTERS.a, LETTERS.a), 0);
  assert.equal(hamming(LETTERS.a, LETTERS.q), 4);
  assert.equal(dotsLabel([1]), 'dot 1 raised');
  assert.equal(dotsLabel([1, 3, 5]), 'dots 1, 3 and 5 raised');
  assert.equal(dotsLabel([]), 'no dots raised');
  assert.throws(() => dotsFor('?'));
});
