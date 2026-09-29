// THE LAST STRAND — an original luck game (no existing game's IP of any
// kind). A heavy weight hangs from several rope strands; players take
// turns cutting one strand at a time. Every cut frays the rope a little
// more - instability rises, and the server rolls an escalating chance
// that THIS cut is the one that brings the whole thing down. Whoever
// cuts the fatal strand is eliminated and the rope resets fresh for
// whoever's left, until one player remains.
//
// Unlike The Big Blast (a single fixed secret index), there is nothing
// hidden here at all: the danger is a genuine live roll against rising
// odds, not a secret a client could try to infer or leak - view() is the
// identity function, same as Hot Potato/Color Panic/Rope before it.
//
// Every game module in this folder shares one shape (see DECISIONS.md):
//   createState(seats, rand)                      -> state
//   handleAction(state, seat, action, now, rand)   -> mutates state
//   tick(state, now, rand)                         -> mutates state (time-driven progress)
//   isOver(state)                                  -> bool
//   getResult(state)                                -> { tiers: [[seat,...], ...], note }
//   view(state)                                     -> state with anything secret stripped
//   nextAlarmAt(state)                              -> timestamp | null

const STRANDS = 8;                  // strands on a fresh rope
const COLLAPSE_DELAY_MS = 900;      // dramatic pause before the weight actually drops
const INSTABILITY_BASE = 14;        // instability added per cut, before jitter
const INSTABILITY_JITTER = 10;
const COLLAPSE_EXPONENT = 1.5;      // how sharply collapse chance ramps up with instability
const COLLAPSE_CAP = 0.97;          // never quite a certainty until the literal last strand

function freshRope(state) {
  state.strandsTotal = STRANDS;
  state.cutMask = new Array(STRANDS).fill(false);
  state.instability = 0;
  state.phase = 'cutting'; // 'cutting' | 'collapsing' | 'done'
  state.lastCut = null;    // { seat, index } - for the client's snip animation
  state.collapseAt = null;
  state.collapsedBy = null;
  return state;
}

export function createState(seats) {
  return freshRope({ seats: seats.slice(), turnIdx: 0, eliminationOrder: [] });
}

export function handleAction(state, seat, action, now, rand) {
  if (state.phase !== 'cutting') return;
  if (state.seats[state.turnIdx] !== seat) return;
  const i = Number(action.index);
  if (!Number.isInteger(i) || i < 0 || i >= state.strandsTotal || state.cutMask[i]) return;

  state.cutMask[i] = true;
  state.lastCut = { seat, index: i };
  const remaining = state.cutMask.filter((c) => !c).length;

  if (remaining === 0) {
    // Nothing left holding it up - this cut brings it down for certain.
    state.phase = 'collapsing';
    state.collapsedBy = seat;
    state.collapseAt = now + COLLAPSE_DELAY_MS;
    return;
  }

  state.instability = Math.min(100, state.instability + INSTABILITY_BASE + rand() * INSTABILITY_JITTER);
  const collapseChance = Math.min(COLLAPSE_CAP, (state.instability / 100) ** COLLAPSE_EXPONENT);
  if (rand() < collapseChance) {
    state.phase = 'collapsing';
    state.collapsedBy = seat;
    state.collapseAt = now + COLLAPSE_DELAY_MS;
  } else {
    state.turnIdx = (state.turnIdx + 1) % state.seats.length;
  }
}

export function tick(state, now) {
  if (state.phase !== 'collapsing' || state.collapseAt == null || now < state.collapseAt) return;
  state.eliminationOrder.push([state.collapsedBy]);
  state.seats = state.seats.filter((s) => s !== state.collapsedBy);
  if (state.turnIdx >= state.seats.length) state.turnIdx = 0;
  if (state.seats.length <= 1) {
    state.phase = 'done';
    return;
  }
  freshRope(state);
}

export function isOver(state) { return state.phase === 'done'; }

export function getResult(state) {
  const tiers = [state.seats.slice()];
  for (let i = state.eliminationOrder.length - 1; i >= 0; i--) tiers.push(state.eliminationOrder[i]);
  return { tiers, note: 'brought the rope down' };
}

// Nothing secret - the odds are real, not a hidden fact about the world.
export function view(state) { return state; }

export function nextAlarmAt(state) {
  return state.phase === 'collapsing' ? state.collapseAt : null;
}
