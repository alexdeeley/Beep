// COLOR PANIC — a target color is named; everyone taps a color; anyone who
// taps wrong (or doesn't tap in time) is out. The response window shrinks
// every round, and `decoyCount` tells the client how many fake flashes to
// show before the real target (a purely cosmetic difficulty cue - the
// server never needs to know what a client actually rendered).

export const COLORS = ['red', 'white', 'black', 'yellow'];

function roundDeadlineMs(round) {
  return Math.max(650, 2200 - (round - 1) * 250);
}

function startRound(state, rand) {
  state.round += 1;
  state.target = COLORS[Math.floor(rand() * COLORS.length)];
  state.picks = {};
  state.promptAt = Date.now();
  state.deadlineAt = state.promptAt + roundDeadlineMs(state.round);
  state.decoyCount = state.round >= 5 ? 2 : state.round >= 3 ? 1 : 0;
  state.phase = 'prompt';
  return state;
}

export function createState(seats, rand) {
  return startRound({ seats: seats.slice(), round: 0, eliminationOrder: [] }, rand);
}

export function handleAction(state, seat, action) {
  if (state.phase !== 'prompt') return;
  if (!state.seats.includes(seat) || state.picks[seat] != null) return;
  if (!COLORS.includes(action.color)) return;
  state.picks[seat] = action.color;
}

export function tick(state, now, rand) {
  if (state.phase !== 'prompt') return;
  const allAnswered = state.seats.every((s) => state.picks[s] != null);
  if (!allAnswered && now < state.deadlineAt) return;

  const right = state.seats.filter((s) => state.picks[s] === state.target);
  const wrong = state.seats.filter((s) => state.picks[s] !== state.target);
  if (right.length === 0) {
    // Nobody got it - a reprieve rather than wiping the whole field at once.
    startRound(state, rand);
    return;
  }
  state.eliminationOrder.push(wrong);
  state.seats = right;
  if (state.seats.length <= 1) state.phase = 'done';
  else startRound(state, rand);
}

export function isOver(state) { return state.phase === 'done'; }

export function getResult(state) {
  const tiers = [state.seats.slice()];
  for (let i = state.eliminationOrder.length - 1; i >= 0; i--) {
    if (state.eliminationOrder[i].length) tiers.push(state.eliminationOrder[i]);
  }
  return { tiers, note: 'panicked' };
}

export function view(state) { return state; }

export function nextAlarmAt(state) {
  return state.phase === 'prompt' ? state.deadlineAt : null;
}
