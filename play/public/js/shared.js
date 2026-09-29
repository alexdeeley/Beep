// Shared by the browser AND the Cloudflare Worker / Durable Object.
// Keep this file dependency-free.

// Room capacity ceiling only - whether a room can actually *start* at a
// given player count is per-game (see GAME_REGISTRY / canStartWithCount
// below), since not every game supports solo play.
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
// public/js/games/<id>.js (client renderer). Deliberately pared down to
// one launch game (see DECISIONS.md) - adding game #2 means adding one
// entry here plus those two files. minPlayers: 1 means the game supports
// solo play (a personal-best challenge, not head-to-head) - see
// DECISIONS.md and last-strand.js's getResult().
export const GAME_REGISTRY = [
  { id: 'last-strand', name: 'The Last Strand', category: 'luck', minPlayers: 1, maxPlayers: 4 },
];

export function gameById(id) {
  return GAME_REGISTRY.find((g) => g.id === id) || null;
}

// Whether at least one registered game can actually be played by this many
// players - the room's real "can we start" gate (see match-room.js's
// maybeAutoStart and app.js's lobby render), replacing a flat "always need
// 2" rule now that solo-capable games exist.
export function canStartWithCount(playerCount) {
  return GAME_REGISTRY.some((g) => playerCount >= g.minPlayers && playerCount <= g.maxPlayers);
}
