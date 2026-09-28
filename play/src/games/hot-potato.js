// HOT POTATO — a single bomb passed between players against a hidden
// countdown. The total fuse length is randomized per round (8-15s) so it
// can never be memorized; whoever holds it when it goes off is out. If
// more than 2 players started, the survivors get a fresh bomb and keep
// going until one remains.

const MIN_FUSE_MS = 8000;
const MAX_FUSE_MS = 15000;
const BOOM_ANIMATION_MS = 700; // pause on the explosion before resolving

function randomFuse(rand) {
  return MIN_FUSE_MS + Math.floor(rand() * (MAX_FUSE_MS - MIN_FUSE_MS));
}

export function createState(seats, rand) {
  const now = Date.now();
  return {
    seats: seats.slice(),
    holder: seats[0],
    startedAt: now,
    expiresAt: now + randomFuse(rand),
    phase: 'holding', // 'holding' | 'boom' | 'done'
    boomAt: null,
    eliminationOrder: [],
  };
}

export function handleAction(state, seat, action) {
  if (state.phase !== 'holding') return;
  if (state.holder !== seat) return;
  const target = Number(action.target);
  if (target === seat || !state.seats.includes(target)) return;
  state.holder = target;
}

export function tick(state, now, rand) {
  if (state.phase === 'holding' && now >= state.expiresAt) {
    state.phase = 'boom';
    state.boomAt = now + BOOM_ANIMATION_MS;
    return;
  }
  if (state.phase === 'boom' && now >= state.boomAt) {
    state.eliminationOrder.push([state.holder]);
    state.seats = state.seats.filter((s) => s !== state.holder);
    state.boomAt = null;
    if (state.seats.length <= 1) {
      state.phase = 'done';
    } else {
      state.holder = state.seats[0];
      state.expiresAt = now + randomFuse(rand);
      state.phase = 'holding';
    }
  }
}

export function isOver(state) { return state.phase === 'done'; }

export function getResult(state) {
  const tiers = [state.seats.slice()];
  for (let i = state.eliminationOrder.length - 1; i >= 0; i--) tiers.push(state.eliminationOrder[i]);
  return { tiers, note: 'was holding it' };
}

export function view(state) { return state; } // nothing hidden - the bomb is for everyone to see

export function nextAlarmAt(state) {
  if (state.phase === 'holding') return state.expiresAt;
  if (state.phase === 'boom') return state.boomAt;
  return null;
}
