// The server-side dispatch table: game id -> its rules module. The
// platform launched with 5 games and was deliberately pared back down to
// one (see DECISIONS.md) to get a single, well-polished game right before
// expanding again. Bringing an old game back or adding a new one means
// adding one entry here, one entry in public/js/shared.js's
// GAME_REGISTRY, one file in this folder, and one client renderer in
// public/js/games/ - see DECISIONS.md and README.md.

import * as lastStrand from './last-strand.js';

export const GAMES = {
  'last-strand': lastStrand,
};

// Picks a random game compatible with the current player count, preferring
// one whose category wasn't just played (never repeating a category twice
// in a row while a same-category alternative exists).
export function pickNextGame(registry, playerCount, recentCategories, rand) {
  const compatible = registry.filter((g) => playerCount >= g.minPlayers && playerCount <= g.maxPlayers);
  const pool = compatible.length ? compatible : registry;
  const lastCategory = recentCategories[recentCategories.length - 1];
  const fresh = pool.filter((g) => g.category !== lastCategory);
  const choices = fresh.length ? fresh : pool;
  return choices[Math.floor(rand() * choices.length)];
}
