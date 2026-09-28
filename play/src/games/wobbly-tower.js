// WOBBLY TOWER — players take turns placing a block by choosing how
// centered it is (offset -100..100). No real physics engine: instability
// accumulates from how off-center each placement was, and the server rolls
// a collapse chance (weighted by that instability) with its own seeded
// random source, so every client sees the exact same outcome without
// needing to simulate physics locally - see DECISIONS.md.

export function createState(seats) {
  return {
    seats: seats.slice(),
    turnIdx: 0,
    instability: 0,
    blocksPlaced: 0,
    phase: 'placing', // 'placing' | 'collapsing' | 'done'
    collapseAt: null,
    collapsedBy: null,
    lastPlacement: null, // { seat, offset } - for the client's drop animation
  };
}

export function handleAction(state, seat, action, now, rand) {
  if (state.phase !== 'placing') return;
  if (state.seats[state.turnIdx] !== seat) return;
  const offset = Number(action.offset);
  if (!Number.isFinite(offset)) return;
  const clamped = Math.max(-100, Math.min(100, offset));

  const risk = Math.abs(clamped) / 100;
  state.instability = Math.min(100, state.instability + risk * 18 + rand() * 8);
  state.blocksPlaced += 1;
  state.lastPlacement = { seat, offset: clamped };

  const collapseChance = Math.min(0.95, (state.instability / 100) ** 1.6);
  if (rand() < collapseChance) {
    state.phase = 'collapsing';
    state.collapsedBy = seat;
    state.collapseAt = Date.now() + 900;
  } else {
    state.turnIdx = (state.turnIdx + 1) % state.seats.length;
  }
}

export function tick(state, now) {
  if (state.phase === 'collapsing' && now >= state.collapseAt) state.phase = 'done';
}

export function isOver(state) { return state.phase === 'done'; }

export function getResult(state) {
  const winners = state.seats.filter((s) => s !== state.collapsedBy);
  return { tiers: [winners, [state.collapsedBy]], note: 'brought down the tower' };
}

export function view(state) { return state; }

export function nextAlarmAt(state) {
  return state.phase === 'collapsing' ? state.collapseAt : null;
}
