// WOBBLY TOWER — client renderer. Turn-based block placement; the server
// is the only one that ever "simulates" the physics (an instability score
// plus a weighted collapse roll - see src/games/wobbly-tower.js), so every
// client just plays back the same authoritative outcome. The one thing we
// add locally is a beat between a block landing and the tower actually
// toppling, so a collapse reads as a moment rather than a instant cut.

import { seatInfo, avatar, shakeScreen, burstParticles, rafLoop } from './_util.js';

const TOPPLE_DELAY_LOCAL_MS = 900; // mirrors WOBBLY_COLLAPSE_MS server-side (state.collapseAt)

export function mount(el, ctx) {
  el.innerHTML = `
    <div class="wt-wrap">
      <p class="game-banner" id="wt-banner"></p>
      <div class="wt-stage">
        <div class="wt-tower" id="wt-tower"></div>
      </div>
      <div class="wt-controls" id="wt-controls">
        <input type="range" id="wt-slider" min="-100" max="100" value="0" aria-label="Block placement offset">
        <button type="button" class="wt-drop-btn" id="wt-drop">DROP BLOCK</button>
      </div>
      <div class="alive-row" id="wt-alive"></div>
    </div>`;
  const banner = el.querySelector('#wt-banner');
  const tower = el.querySelector('#wt-tower');
  const controls = el.querySelector('#wt-controls');
  const slider = el.querySelector('#wt-slider');
  const dropBtn = el.querySelector('#wt-drop');
  const aliveRow = el.querySelector('#wt-alive');

  let cur = null;
  let alive = true;
  let lastBlocksPlaced = -1;
  let toppling = false;

  dropBtn.addEventListener('click', () => {
    if (!cur || cur.phase !== 'placing' || cur.seats[cur.turnIdx] !== ctx.you) return;
    ctx.send({ offset: Number(slider.value) });
    ctx.sound.play('tap');
    slider.value = 0;
  });

  function renderAlive(state) {
    aliveRow.replaceChildren();
    ctx.players.forEach((p) => aliveRow.append(avatar(ctx.players, p.seat, state.seats.includes(p.seat) ? '' : 'out')));
  }

  function rebuildBlocks(state) {
    tower.replaceChildren();
    const n = Math.min(state.blocksPlaced, 24);
    for (let i = 0; i < n; i++) {
      const b = document.createElement('div');
      b.className = 'wt-block';
      const jitter = Math.sin(i * 2.3) * 12;
      b.style.setProperty('--off', `${jitter}px`);
      b.style.bottom = `${i * 18}px`;
      tower.append(b);
    }
  }

  function dropNewBlock(state) {
    rebuildBlocks(state);
    const top = tower.lastElementChild;
    if (top && !ctx.reducedMotion) {
      top.style.setProperty('--off', `${state.lastPlacement.offset * 0.6}px`);
      top.classList.add('dropping');
    }
    ctx.sound.play('tap');
  }

  function paint() {
    if (!cur) return;
    const state = cur;
    const wobble = Math.min(1, state.instability / 100);
    tower.style.setProperty('--wobble', String(wobble));
    tower.classList.toggle('critical', wobble > 0.7);

    if (state.phase === 'collapsing' && !toppling) {
      const remain = state.collapseAt - ctx.now();
      if (remain <= 0) topple(state);
    }
  }
  const stop = rafLoop(paint, () => alive);

  function topple(state) {
    toppling = true;
    tower.classList.add('toppled');
    shakeScreen(el, ctx.reducedMotion);
    burstParticles(tower, { color: '#ffd43b', reducedMotion: ctx.reducedMotion });
    ctx.sound.play('explosion');
    setTimeout(() => ctx.sound.play('eliminated'), 300);
    const who = seatInfo(ctx.players, state.collapsedBy);
    banner.textContent = state.collapsedBy === ctx.you ? 'YOU BROUGHT IT DOWN!' : `${who.name} brought it down!`;
  }

  function update(state) {
    const myTurn = state.phase === 'placing' && state.seats[state.turnIdx] === ctx.you;
    controls.hidden = !myTurn;

    if (state.blocksPlaced !== lastBlocksPlaced) {
      lastBlocksPlaced = state.blocksPlaced;
      dropNewBlock(state);
    }

    if (state.phase === 'placing') {
      toppling = false;
      tower.classList.remove('toppled');
      banner.classList.toggle('mine', myTurn);
      banner.textContent = myTurn ? 'YOUR TURN — PLACE A BLOCK' : `${seatInfo(ctx.players, state.seats[state.turnIdx]).name} is placing…`;
    }
    renderAlive(state);
    cur = state;
  }

  return {
    update,
    destroy() { alive = false; stop(); },
  };
}
