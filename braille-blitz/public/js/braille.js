// Braille data: standard English (unified) six-dot Braille.
//
// Dots are numbered down the left column 1-2-3 and down the right column
// 4-5-6. A pattern is a sorted list of raised dot numbers. Letters a-z are
// the standard literary alphabet. Digits reuse the cells for a-j and are
// marked by the number sign (dots 3-4-5-6) placed before them - so "1" is
// number sign + the "a" cell, and "0" is number sign + the "j" cell.
//
// Pure data and helpers: no DOM, usable from Node tests.

export const LETTERS = Object.freeze({
  a: [1], b: [1, 2], c: [1, 4], d: [1, 4, 5], e: [1, 5],
  f: [1, 2, 4], g: [1, 2, 4, 5], h: [1, 2, 5], i: [2, 4], j: [2, 4, 5],
  k: [1, 3], l: [1, 2, 3], m: [1, 3, 4], n: [1, 3, 4, 5], o: [1, 3, 5],
  p: [1, 2, 3, 4], q: [1, 2, 3, 4, 5], r: [1, 2, 3, 5], s: [2, 3, 4], t: [2, 3, 4, 5],
  u: [1, 3, 6], v: [1, 2, 3, 6], w: [2, 4, 5, 6], x: [1, 3, 4, 6], y: [1, 3, 4, 5, 6], z: [1, 3, 5, 6],
});

export const NUMBER_SIGN = Object.freeze([3, 4, 5, 6]);

// Digit -> the letter whose cell it shares.
export const DIGIT_LETTER = Object.freeze({
  1: 'a', 2: 'b', 3: 'c', 4: 'd', 5: 'e', 6: 'f', 7: 'g', 8: 'h', 9: 'i', 0: 'j',
});

export const ALPHABET = Object.freeze('abcdefghijklmnopqrstuvwxyz'.split(''));
export const DIGITS = Object.freeze(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']);

export const isLetter = (c) => typeof c === 'string' && c.length === 1 && c >= 'a' && c <= 'z';
export const isDigit = (c) => typeof c === 'string' && c.length === 1 && c >= '0' && c <= '9';
export const kindOf = (c) => (isDigit(c) ? 'digit' : 'letter');

// The dots for one character: a letter's cell, or a digit's (shared) cell.
export function dotsFor(c) {
  if (isLetter(c)) return LETTERS[c];
  if (isDigit(c)) return LETTERS[DIGIT_LETTER[c]];
  throw new Error('not a Braille character: ' + c);
}

// The cells needed to write a character in literary Braille: a letter is one
// cell; a digit is the number sign followed by its cell.
export function cellsFor(c) {
  return isDigit(c) ? [NUMBER_SIGN, dotsFor(c)] : [dotsFor(c)];
}

// A whole number ("42") is one number sign followed by a cell per digit.
export function cellsForNumber(str) {
  return [NUMBER_SIGN, ...String(str).split('').map((d) => dotsFor(d))];
}

// Bitmask with dot n -> bit n-1, which is exactly how Unicode numbers the
// Braille Patterns block (U+2800 + mask). That makes Unicode a handy
// independent reference for the tables above.
export const mask = (dots) => dots.reduce((m, d) => m | (1 << (d - 1)), 0);
export const toUnicode = (dots) => String.fromCodePoint(0x2800 + mask(dots));
export const fromUnicode = (ch) => {
  const m = ch.codePointAt(0) - 0x2800;
  return [1, 2, 3, 4, 5, 6].filter((d) => m & (1 << (d - 1)));
};

// How many dot positions differ - a 1 means "easy to confuse".
export const hamming = (a, b) => {
  const x = mask(a) ^ mask(b);
  let n = 0;
  for (let i = 0; i < 6; i++) if (x & (1 << i)) n++;
  return n;
};

export const displayName = (c) => (isDigit(c) ? c : c.toUpperCase());
export const spokenName = (c) => (isDigit(c) ? `the number ${c}` : `the letter ${c.toUpperCase()}`);

// "dots 1, 3 and 5" - how a cell is described out loud.
export function dotsLabel(dots) {
  if (!dots.length) return 'no dots raised';
  if (dots.length === 1) return `dot ${dots[0]} raised`;
  return `dots ${dots.slice(0, -1).join(', ')} and ${dots[dots.length - 1]} raised`;
}

// Letters as introduced to a learner. a-j first (they double as the digits),
// then k-t (the same shapes with dot 3 added), then u-z.
export const LEARNING_ORDER = ALPHABET;
