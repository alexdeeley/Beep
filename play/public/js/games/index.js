// The client-side counterpart to src/games/index.js: game id -> its
// renderer module. Each module exports mount(el, ctx) -> { update, destroy }
// (see any file in this folder for the shape). Adding game #6 means adding
// one entry here and one renderer file - see DECISIONS.md.

import * as bigBlast from './big-blast.js';
import * as hotPotato from './hot-potato.js';
import * as colorPanic from './color-panic.js';
import * as rope from './rope.js';
import * as wobblyTower from './wobbly-tower.js';

export const GAME_RENDERERS = {
  'big-blast': bigBlast,
  'hot-potato': hotPotato,
  'color-panic': colorPanic,
  rope,
  'wobbly-tower': wobblyTower,
};
