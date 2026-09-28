// HOT POTATO — client renderer. A glowing bomb passed between players by
// tapping who gets it next. The fuse length is a server secret (randomized
// 8-15s per round - see src/games/hot-potato.js); the client only ever
// shows time remaining against the server's own `expiresAt` timestamp, so
// there's nothing here for a player to memorize round to round.

import { seatInfo, avatar, shakeScreen, burstParticles, rafLoop } from './_util.js';

export function mount(el, ctx) {
  el.innerHTML = `
    <div class="hp-wrap">
      <p class="game-banner" id="hp-banner"></p>
      <div class="hp-bomb-zone">
        <div class="hp-bomb" id="hp-bomb">💣</div>
      </div>
      <div class="hp-targets" id="hp-targets" role="group" aria-label="Pass the bomb to"></div>
      <div class="alive-row" id="hp-alive"></div>
    </div>`;
  const banner = el.querySelector('#hp-banner');
  const bomb = el.querySelector('#hp-bomb');
  const targets = el.querySelector('#hp-targets');
  const aliveRow = el.querySelector('#hp-alive');

  let cur = null;
  let alive = true;
  let lastPhase = '';
  let lastTickBucket = -1;

  function renderTargets(state) {
    targets.replaceChildren();
    const iHold = state.holder === ctx.you && state.phase === 'holding';
    if (!iHold) return;
    state.seats.filter((s) => s !== ctx.you).forEach((seat) => {
      const p = seatInfo(ctx.players, seat);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'hp-target';
      b.style.setProperty('--c', p.color);
      b.innerHTML = `<span class="g-avatar" style="background:${p.color}">${p.name[0]?.toUpperCase() || '?'}</span><span>${p.name}</span>`;
      b.addEventListener('click', () => { ctx.send({ target: seat }); ctx.sound.play('tap'); });
      targets.append(b);
    });
  }

  function renderAlive(state) {
    aliveRow.replaceChildren();
    ctx.players.forEach((p) => {
      const inGame = state.seats.includes(p.seat);
      aliveRow.append(avatar(ctx.players, p.seat, inGame ? '' : 'out'));
    });
  }

  function paint() {
    const state = cur;
    if (!state) return;
    const holder = seatInfo(ctx.players, state.holder);

    if (state.phase === 'holding') {
      const remain = Math.max(0, state.expiresAt - ctx.now());
      const t = Math.min(1, remain / 6000); // visual intensity ramp, last ~6s
      bomb.style.setProperty('--intensity', String(1 - t));
      bomb.classList.toggle('critical', remain < 2000);
      bomb.style.background = holder.color;
      const bucket = remain < 2500 ? Math.floor(remain / 150) : Math.floor(remain / 500);
      if (bucket !== lastTickBucket && remain > 0) { lastTickBucket = bucket; ctx.sound.play('tick'); }
      banner.textContent = state.holder === ctx.you ? "IT'S YOURS — PASS IT!" : `${holder.name} is holding it…`;
      banner.classList.toggle('mine', state.holder === ctx.you);
    }

    if (state.phase !== lastPhase) {
      if (state.phase === 'boom') {
        bomb.classList.add('boom');
        shakeScreen(el, ctx.reducedMotion);
        burstParticles(bomb, { color: '#ffb020', reducedMotion: ctx.reducedMotion });
        ctx.sound.play('explosion');
        setTimeout(() => ctx.sound.play('eliminated'), 350);
        banner.textContent = state.holder === ctx.you ? '💥 IT WENT OFF!' : `💥 ${holder.name} was holding it!`;
        renderTargets(state);
      } else if (state.phase === 'holding') {
        bomb.classList.remove('boom');
        renderTargets(state);
      }
      lastPhase = state.phase;
    }
  }

  const stop = rafLoop(paint, () => alive);

  function update(state) {
    cur = state;
    renderTargets(state);
    renderAlive(state);
    paint();
  }

  return {
    update,
    destroy() { alive = false; stop(); },
  };
}
