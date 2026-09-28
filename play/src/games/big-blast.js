// THE BIG BLAST — an original elimination game (no Nintendo IP of any
// kind). Six buttons, one is secretly dangerous. Players take turns
// picking an unclicked button until only one player is left standing.
//
// Every game module in this folder shares one shape (see DECISIONS.md):
//   createState(seats, rand)              -> state
//   handleAction(state, seat, action, now, rand)  -> mutates state
//   tick(state, now, rand)                -> mutates state (time-driven progress)
//   isOver(state)                         -> bool
//   getResult(state)                      -> { tiers: [[seat,...], ...], note }
//   view(state)                           -> state with anything secret stripped
//   nextAlarmAt(state)                    -> timestamp | null
//
// `rand` is always server-supplied (never the client) - see match-room.js.

const REVEAL_DELAY_MS = 900; // the dramatic pause before "SAFE" or "BOOM" appears

export function createState(seats, rand) {
  return {
    seats: seats.slice(),           // turn order of still-alive players
    buttons: new Array(6).fill(null), // null | 'safe' | 'danger', per button index
    dangerousIndex: Math.floor(rand() * 6), // secret - stripped by view()
    turnIdx: 0,
    phase: 'choosing',              // 'choosing' | 'reveal' | 'done'
    lastPick: null,                 // { seat, index, result }
    revealAt: null,
    eliminationOrder: [],           // array of [seat] tiers, most recent last
  };
}

export function handleAction(state, seat, action) {
  if (state.phase !== 'choosing') return;
  if (state.seats[state.turnIdx] !== seat) return;
  const i = Number(action.index);
  if (!Number.isInteger(i) || i < 0 || i > 5 || state.buttons[i] != null) return;
  const isDanger = i === state.dangerousIndex;
  state.buttons[i] = isDanger ? 'danger' : 'safe';
  state.lastPick = { seat, index: i, result: isDanger ? 'danger' : 'safe' };
  state.phase = 'reveal';
  state.revealAt = Date.now() + REVEAL_DELAY_MS;
}

export function tick(state, now) {
  if (state.phase !== 'reveal' || state.revealAt == null || now < state.revealAt) return;
  const { seat, result } = state.lastPick;
  if (result === 'danger') {
    state.eliminationOrder.push([seat]);
    state.seats = state.seats.filter((s) => s !== seat);
    if (state.turnIdx >= state.seats.length) state.turnIdx = 0;
  } else {
    state.turnIdx = (state.turnIdx + 1) % state.seats.length;
  }
  state.revealAt = null;
  state.phase = state.seats.length <= 1 ? 'done' : 'choosing';
}

export function isOver(state) { return state.phase === 'done'; }

export function getResult(state) {
  const tiers = [state.seats.slice()];
  for (let i = state.eliminationOrder.length - 1; i >= 0; i--) tiers.push(state.eliminationOrder[i]);
  return { tiers, note: 'was blasted' };
}

// The only game with anything to hide: which button is dangerous. Every
// button's *result* becomes public the instant it's clicked (state.buttons
// already carries that), so once revealed there's nothing left to protect -
// simplest to just never send the secret index at all.
export function view(state) {
  const { dangerousIndex, ...rest } = state;
  return rest;
}

export function nextAlarmAt(state) {
  return state.phase === 'reveal' ? state.revealAt : null;
}
