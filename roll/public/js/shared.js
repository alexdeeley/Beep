// Shared by the browser AND the Cloudflare Worker / Durable Object.
// Keep this file dependency-free (no scoring math here - that's
// server-only, see src/scoring.js; the client never needs to know how a
// category is scored, only what the server already computed).

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const MAX_NAME = 14;

export const DICE_COUNT = 5;
export const MAX_ROLLS = 3;

export const TOTAL_TURNS = 13; // categories per player = rounds in the game

// Category metadata for the UI. Order matches the printed scorecard.
export const CATEGORIES = [
  { id: 'ones', label: 'Ones', section: 'upper', hint: 'Sum of all 1s' },
  { id: 'twos', label: 'Twos', section: 'upper', hint: 'Sum of all 2s' },
  { id: 'threes', label: 'Threes', section: 'upper', hint: 'Sum of all 3s' },
  { id: 'fours', label: 'Fours', section: 'upper', hint: 'Sum of all 4s' },
  { id: 'fives', label: 'Fives', section: 'upper', hint: 'Sum of all 5s' },
  { id: 'sixes', label: 'Sixes', section: 'upper', hint: 'Sum of all 6s' },
  { id: 'threeKind', label: 'Three of a Kind', section: 'lower', hint: 'Sum of all dice' },
  { id: 'fourKind', label: 'Four of a Kind', section: 'lower', hint: 'Sum of all dice' },
  { id: 'fullHouse', label: 'Full House', section: 'lower', hint: '25 points' },
  { id: 'smallStraight', label: 'Small Straight', section: 'lower', hint: '30 points' },
  { id: 'largeStraight', label: 'Large Straight', section: 'lower', hint: '40 points' },
  { id: 'yahtzee', label: 'Yahtzee', section: 'lower', hint: '50 points' },
  { id: 'chance', label: 'Chance', section: 'lower', hint: 'Sum of all dice' },
];

export const UPPER_BONUS_THRESHOLD = 63;
export const UPPER_BONUS = 35;

// One color per seat, in join order - the avatar ring, name tag, and that
// player's highlight color everywhere else in the UI.
export const PLAYER_COLORS = [
  '#3d7bff', // blue
  '#ff5fb0', // pink
  '#ff8a00', // orange
  '#1fb84a', // green
  '#8a3ffc', // purple
  '#e8202a', // red
];
