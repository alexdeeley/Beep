// THE BIG BLAST — client renderer. Six unlabeled devices; one is
// dangerous. The server already knows the true result of a pick the
// instant it lands (state.buttons[i]), but we deliberately withhold
// showing it to the player for a beat, synced to the server's own
// `revealAt` timestamp, so the suspense is real even though the data
// isn't secret for long. See DECISIONS.md.

import { seatInfo, avatar, shakeScreen, burstParticles, rafLoop } from './_util.js';

export function mount(el, ctx) {
  el.innerHTML = `
    <div class="bb-wrap">
      <p class="game-banner" id="bb-banner"></p>
      <div class="bb-grid" id="bb-grid" role="group" aria-label="Six buttons, one is dangerous"></div>
      <p class="bb-hint">One of these is dangerous. Nobody knows which - until someone finds out.</p>
      <div class="alive-row" id="bb-alive"></div>
    </div>`;
  const grid = el.querySelector('#bb-grid');
  const banner = el.querySelector('#bb-banner');
  const aliveRow = el.querySelector('#bb-alive');
  const buttons = [];
  for (let i = 0; i < 6; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'bb-btn';
    b.innerHTML = '<span class="bb-face"></span>';
    b.setAttribute('aria-label', `Button ${i + 1}`);
    b.addEventListener('click', () => onPick(i));
    grid.append(b);
    buttons.push(b);
  }

  const revealedIndices = new Set();
  let animatingIndex = -1;
  let stopReveal = null;
  let myTurn = false;
  let alive = true;

  function onPick(i) {
    if (!myTurn || buttons[i].disabled) return;
    ctx.send({ index: i });
    ctx.sound.play('tap');
  }

  function paintButton(i, state) {
    const b = buttons[i];
    const val = state.buttons[i];
    b.classList.remove('safe', 'danger', 'pending', 'empty');
    if (val == null) {
      b.classList.add('empty');
      b.disabled = !myTurn || state.phase === 'reveal';
    } else if (revealedIndices.has(i)) {
      b.classList.add(val);
      b.disabled = true;
      b.querySelector('.bb-face').textContent = val === 'danger' ? '💥' : '✓';
    } else {
      b.classList.add('pending');
      b.disabled = true;
      b.querySelector('.bb-face').textContent = '';
    }
  }

  function startReveal(state, index) {
    animatingIndex = index;
    const btn = buttons[index];
    btn.classList.add('tension');
    let lastTick = 0;
    stopReveal = rafLoop(() => {
      const remain = state.revealAt - ctx.now();
      if (Math.floor(remain / 220) !== lastTick) { lastTick = Math.floor(remain / 220); ctx.sound.play('tension', 1 - Math.max(0, remain) / 900); }
      if (remain <= 0) finishReveal(state, index);
    }, () => alive && animatingIndex === index);
  }

  function finishReveal(state, index) {
    stopReveal?.(); stopReveal = null;
    animatingIndex = -1;
    buttons[index].classList.remove('tension');
    revealedIndices.add(index);
    const val = state.buttons[index];
    paintButton(index, state);
    if (val === 'danger') {
      shakeScreen(el, ctx.reducedMotion);
      burstParticles(buttons[index], { color: '#ff3d5a', reducedMotion: ctx.reducedMotion });
      ctx.sound.play('explosion');
      setTimeout(() => ctx.sound.play('eliminated'), 350);
      const eliminatedSeat = state.lastPick.seat;
      banner.textContent = eliminatedSeat === ctx.you ? '💥 BOOM! You’re out.' : `💥 BOOM! ${seatInfo(ctx.players, eliminatedSeat).name} is out.`;
      banner.classList.add('danger-flash');
    } else {
      ctx.sound.play('safe');
      banner.textContent = 'SAFE!';
    }
    renderAlive(state);
  }

  function renderAlive(state) {
    aliveRow.replaceChildren();
    ctx.players.forEach((p) => {
      const inGame = state.seats.includes(p.seat);
      aliveRow.append(avatar(ctx.players, p.seat, inGame ? '' : 'out'));
    });
  }

  function update(state) {
    myTurn = state.seats[state.turnIdx] === ctx.you && state.phase === 'choosing';
    if (state.phase !== 'reveal') {
      banner.classList.remove('danger-flash');
      banner.classList.toggle('mine', myTurn);
      banner.textContent = myTurn ? 'YOUR TURN — PICK A BUTTON' : `${seatInfo(ctx.players, state.seats[state.turnIdx]).name} is choosing…`;
    }
    for (let i = 0; i < 6; i++) paintButton(i, state);
    renderAlive(state);

    if (state.phase === 'reveal' && state.lastPick && animatingIndex !== state.lastPick.index && !revealedIndices.has(state.lastPick.index)) {
      startReveal(state, state.lastPick.index);
    }
  }

  return {
    update,
    destroy() { alive = false; stopReveal?.(); },
  };
}
