// The client-side counterpart to src/games/index.js: game id -> its
// renderer module. Each module exports mount(el, ctx) -> { update, destroy }
// (see any file in this folder for the shape). Adding game #6 means adding
// one entry here and one renderer file - see DECISIONS.md.

import * as lastStrand from './last-strand.js';

export const GAME_RENDERERS = {
  'last-strand': lastStrand,
};
