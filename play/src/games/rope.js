// DON'T TOUCH THE ROPE — a rope sweeps in on a schedule; sometimes it's low
// (jump over it) and sometimes it's high (stay still - jumping into it
// gets you eliminated). Gaps between passes shrink and jitter as the game
// goes on so the rhythm can't be memorized.

function passGapMs(pass, rand) {
  const base = Math.max(900, 2600 - pass * 180);
  const jitter = (rand() - 0.5) * base * 0.3;
  return Math.round(base + jitter);
}

function startPass(state, rand) {
  state.pass += 1;
  state.requireJump = rand() < 0.75; // low rope is the common case; high rope is the twist
  state.action = {};
  state.impactAt = Date.now() + passGapMs(state.pass, rand);
  state.phase = 'sweeping';
  return state;
}

export function createState(seats, rand) {
  return startPass({ seats: seats.slice(), pass: 0, eliminationOrder: [] }, rand);
}

export function handleAction(state, seat, action) {
  if (state.phase !== 'sweeping') return;
  if (!state.seats.includes(seat) || state.action[seat] != null) return;
  if (action.type !== 'jump') return;
  state.action[seat] = 'jump';
}

export function tick(state, now, rand) {
  if (state.phase !== 'sweeping' || now < state.impactAt) return;
  const touched = state.seats.filter((s) => {
    const jumped = state.action[s] === 'jump';
    return state.requireJump ? !jumped : jumped;
  });
  const safe = state.seats.filter((s) => !touched.includes(s));
  if (safe.length === 0) {
    startPass(state, rand); // everyone got it wrong - reprieve, try again
    return;
  }
  if (touched.length) state.eliminationOrder.push(touched);
  state.seats = safe;
  if (state.seats.length <= 1) state.phase = 'done';
  else startPass(state, rand);
}

export function isOver(state) { return state.phase === 'done'; }

export function getResult(state) {
  const tiers = [state.seats.slice()];
  for (let i = state.eliminationOrder.length - 1; i >= 0; i--) tiers.push(state.eliminationOrder[i]);
  return { tiers, note: 'touched the rope' };
}

export function view(state) { return state; }

export function nextAlarmAt(state) {
  return state.phase === 'sweeping' ? state.impactAt : null;
}
