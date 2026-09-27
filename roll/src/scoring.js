// ROLL — pure Yahtzee-style scoring engine + dice generation. No knowledge
// of players, turns, or rooms - roll-room.js owns all of that. Deliberately
// does not implement the "Joker" bonus-Yahtzee house rule (extra 100 points
// and forced categories for a second-or-later Yahtzee) - see DECISIONS.md.

export const DICE_COUNT = 5;
export const MAX_ROLLS = 3;

// A single die face, 1-6. `rand` is injectable (tests force exact faces);
// with no `rand`, uses a real cryptographic random source - this is the
// only place dice come from, and it only ever runs on the server.
export function rollDie(rand) {
  if (rand) return 1 + Math.floor(rand() * 6);
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return 1 + (buf[0] % 6);
}

export function rollDice(n = DICE_COUNT, rand) {
  return Array.from({ length: n }, () => rollDie(rand));
}

function counts(dice) {
  const c = [0, 0, 0, 0, 0, 0, 0]; // index 1..6, 0 unused
  for (const d of dice) c[d]++;
  return c;
}

function sum(dice) { return dice.reduce((a, b) => a + b, 0); }

const SMALL_STRAIGHTS = [[1, 2, 3, 4], [2, 3, 4, 5], [3, 4, 5, 6]];

export const UPPER_IDS = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];
export const LOWER_IDS = [
  'threeKind', 'fourKind', 'fullHouse', 'smallStraight', 'largeStraight', 'yahtzee', 'chance',
];
export const CATEGORY_IDS = [...UPPER_IDS, ...LOWER_IDS];

const UPPER_FACE = { ones: 1, twos: 2, threes: 3, fours: 4, fives: 5, sixes: 6 };

// The score a given category *would* get for this dice, whether or not it
// actually qualifies (a non-matching category is a valid "scratch" for 0 -
// standard Yahtzee lets you burn any unused category on a bad roll).
export function scoreCategory(id, dice) {
  if (!Array.isArray(dice) || dice.length !== DICE_COUNT) return 0;
  const c = counts(dice);
  if (id in UPPER_FACE) {
    const face = UPPER_FACE[id];
    return c[face] * face;
  }
  switch (id) {
    case 'threeKind': return c.some((n) => n >= 3) ? sum(dice) : 0;
    case 'fourKind': return c.some((n) => n >= 4) ? sum(dice) : 0;
    case 'fullHouse': return c.includes(3) && c.includes(2) ? 25 : 0;
    case 'smallStraight': {
      const set = new Set(dice);
      return SMALL_STRAIGHTS.some((run) => run.every((v) => set.has(v))) ? 30 : 0;
    }
    case 'largeStraight': {
      const key = [...new Set(dice)].sort((a, b) => a - b).join(',');
      return key === '1,2,3,4,5' || key === '2,3,4,5,6' ? 40 : 0;
    }
    case 'yahtzee': return c.some((n) => n === 5) ? 50 : 0;
    case 'chance': return sum(dice);
    default: return 0;
  }
}

export function isCategory(id) { return CATEGORY_IDS.includes(id); }

// A fresh scorecard: every category unfilled (`null`, distinct from a
// legitimately-scored 0).
export function newCategories() {
  const c = {};
  for (const id of CATEGORY_IDS) c[id] = null;
  return c;
}

export function isComplete(categories) {
  return CATEGORY_IDS.every((id) => categories[id] != null);
}

export const UPPER_BONUS_THRESHOLD = 63;
export const UPPER_BONUS = 35;

export function upperTotal(categories) {
  return UPPER_IDS.reduce((t, id) => t + (categories[id] || 0), 0);
}

export function upperBonus(categories) {
  return upperTotal(categories) >= UPPER_BONUS_THRESHOLD ? UPPER_BONUS : 0;
}

export function lowerTotal(categories) {
  return LOWER_IDS.reduce((t, id) => t + (categories[id] || 0), 0);
}

export function grandTotal(categories) {
  return upperTotal(categories) + upperBonus(categories) + lowerTotal(categories);
}
