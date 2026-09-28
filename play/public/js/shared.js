// Shared by the browser AND the Cloudflare Worker / Durable Object.
// Keep this file dependency-free.

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
export const MAX_NAME = 14;

export const MATCH_LENGTHS = { quick: 5, standard: 10 };
export const DEFAULT_MATCH_LENGTH = 'quick';

// Points by finishing tier this round (see getResult() in each game module -
// a "tier" is a group of seats tied at that rank, best first). A 2-player
// round is winner-takes-3/loser-gets-0; anything bigger adds a "second
// place" tier worth 1 - see pointsForTier() in match-room.js.
export const POINTS_FIRST = 3;
export const POINTS_SECOND = 1;

// One color per seat, in join order.
export const PLAYER_COLORS = [
  '#ff3d5a', // red
  '#3d7bff', // blue
  '#ffd43b', // yellow
  '#2bd97a', // green
];

// The public catalogue of mini-games. Each entry is metadata only - the
// actual rules live in src/games/<id>.js (server) and
// public/js/games/<id>.js (client renderer). Adding game #6 means adding
// one entry here plus those two files - see DECISIONS.md.
export const GAME_REGISTRY = [
  { id: 'big-blast', name: 'The Big Blast', category: 'luck', minPlayers: 2, maxPlayers: 4 },
  { id: 'hot-potato', name: 'Hot Potato', category: 'timing', minPlayers: 2, maxPlayers: 4 },
  { id: 'color-panic', name: 'Color Panic', category: 'reaction', minPlayers: 2, maxPlayers: 4 },
  { id: 'rope', name: "Don't Touch the Rope", category: 'reaction', minPlayers: 2, maxPlayers: 4 },
  { id: 'wobbly-tower', name: 'Wobbly Tower', category: 'physics', minPlayers: 2, maxPlayers: 4 },
];

export function gameById(id) {
  return GAME_REGISTRY.find((g) => g.id === id) || null;
}
