// DON'T TOUCH THE ROPE — client renderer. A rope sweeps in on a shrinking,
// jittered schedule; sometimes it's low (jump it) and sometimes it's high
// (stay put - jumping into it gets you). `requireJump` is known to the
// client the instant the pass starts, but we only use it to pick the
// rope's on-screen height, never to tell the player what to do in words -
// the challenge is reading the sweep, same as the real thing would be.

import { seatInfo, avatar, shakeScreen, rafLoop } from './_util.js';

export function mount(el, ctx) {
  el.innerHTML = `
    <div class="rope-wrap">
      <p class="game-banner" id="rope-banner"></p>
      <div class="rope-lane" id="rope-lane">
        <div class="rope-bar" id="rope-bar"></div>
        <div class="rope-figure" id="rope-figure">🧍</div>
      </div>
      <button type="button" class="rope-jump-btn" id="rope-jump">JUMP</button>
      <div class="alive-row" id="rope-alive"></div>
    </div>`;
  const banner = el.querySelector('#rope-banner');
  const lane = el.querySelector('#rope-lane');
  const bar = el.querySelector('#rope-bar');
  const figure = el.querySelector('#rope-figure');
  const jumpBtn = el.querySelector('#rope-jump');
  const aliveRow = el.querySelector('#rope-alive');

  let cur = null;
  let alive = true;
  let lastPass = -1;
  let prevSeats = [];
  let prevAction = {};
  let prevRequireJump = null;
  let jumping = false;
  let jumpUntil = 0;

  jumpBtn.addEventListener('click', () => {
    if (!cur || cur.phase !== 'sweeping' || !cur.seats.includes(ctx.you)) return;
    if (cur.action[ctx.you] != null) return;
    ctx.send({ type: 'jump' });
    ctx.sound.play('tap');
    jumping = true;
    jumpUntil = ctx.now() + 500;
    figure.classList.add('jumping');
  });

  function renderAlive(state) {
    aliveRow.replaceChildren();
    ctx.players.forEach((p) => aliveRow.append(avatar(ctx.players, p.seat, state.seats.includes(p.seat) ? '' : 'out')));
  }

  function showFeedback(state) {
    const iWasIn = prevSeats.includes(ctx.you);
    const iAmIn = state.seats.includes(ctx.you);
    if (iWasIn && !iAmIn) {
      const jumped = prevAction[ctx.you] === 'jump';
      const shouldHaveJumped = prevRequireJump;
      ctx.sound.play('wrong');
      shakeScreen(el, ctx.reducedMotion);
      banner.textContent = shouldHaveJumped && !jumped ? "TOO LATE — YOU'RE OUT" : "YOU'RE OUT";
    } else if (iWasIn && iAmIn) {
      ctx.sound.play('correct');
    }
  }

  function paint() {
    if (!cur) return;
    const state = cur;
    const remain = state.impactAt - ctx.now();
    const progress = Math.max(0, Math.min(1, 1 - remain / 2400));
    lane.classList.toggle('high', !state.requireJump);
    lane.classList.toggle('low', state.requireJump);
    bar.style.transform = `translateX(${-20 + progress * 140}%)`;
    lane.classList.toggle('imminent', remain < 500 && remain > 0);
    if (remain < 500 && remain > 0) figure.classList.add('brace'); else figure.classList.remove('brace');
    if (jumping && ctx.now() > jumpUntil) { jumping = false; figure.classList.remove('jumping'); }
  }
  const stop = rafLoop(paint, () => alive);

  function update(state) {
    const inGame = state.seats.includes(ctx.you);
    if (state.pass !== lastPass) {
      if (lastPass !== -1) showFeedback(state);
      lastPass = state.pass;
      figure.classList.remove('jumping', 'brace');
      jumpBtn.disabled = !inGame;
      banner.textContent = inGame ? 'WATCH THE ROPE!' : 'watching…';
      banner.classList.toggle('mine', inGame);
    }
    jumpBtn.disabled = !inGame || state.action[ctx.you] != null || state.phase !== 'sweeping';
    renderAlive(state);

    prevSeats = state.seats.slice();
    prevAction = { ...state.action };
    prevRequireJump = state.requireJump;
    cur = state;
  }

  return {
    update,
    destroy() { alive = false; stop(); },
  };
}
