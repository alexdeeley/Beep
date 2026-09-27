// Shared by the browser AND the Cloudflare Worker / Durable Object.
// Keep this file dependency-free.

export const MAX_SEATS = 7;          // a real blackjack table's usual limit
export const MAX_NAME = 14;
export const STARTING_CHIPS = 1000;
export const MIN_BET = 10;
export const MAX_BET = 500;
export const CHIP_PRESETS = [10, 25, 50, 100, 500];

export const BETTING_SECONDS = 20;   // per hand, to place a bet
export const TURN_SECONDS = 20;      // per decision, once it's your turn
export const REVEAL_MS = 4500;       // how long results stay on screen

export const NUM_DECKS = 6;

// One color per seat, in join order - reused for the seat ring, the name
// tag, and that player's cards' back-of-card accent.
export const SEAT_COLORS = [
  '#3d7bff', // blue
  '#ff5fb0', // pink
  '#ff8a00', // orange
  '#1fb84a', // green
  '#8a3ffc', // purple
  '#16c6e8', // cyan
  '#e8202a', // red
];

export const SUIT_RED = new Set(['♥', '♦']);
