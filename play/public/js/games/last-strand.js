// THE LAST STRAND — client renderer. A weight hangs from 8 strands;
// players take turns cutting one. There's nothing hidden to withhold
// here (see src/games/last-strand.js's view()) - the server has already
// rolled the real odds by the time this state arrives - so the only
// suspense this renderer adds is timed against the server's own
// `collapseAt`, exactly like every other reveal pause in this app.

import { seatInfo, avatar, shakeScreen, burstParticles, rafLoop } from './_util.js';

export function mount(el, ctx) {
  el.innerHTML = `
    <div class="ls-wrap">
      <p class="game-banner" id="ls-banner"></p>
      <div class="ls-stage" id="ls-stage">
        <div class="ls-beam"></div>
        <div class="ls-strands" id="ls-strands"></div>
        <div class="ls-weight" id="ls-weight"><span class="ls-weight-glow"></span></div>
      </div>
      <p class="ls-hint">Every cut frays the rope a little more. Nobody knows which cut brings it down - not even the server, until it happens.</p>
      <div class="alive-row" id="ls-alive"></div>
    </div>`;
  const banner = el.querySelector('#ls-banner');
  const stage = el.querySelector('#ls-stage');
  const strandsBox = el.querySelector('#ls-strands');
  const weight = el.querySelector('#ls-weight');
  const aliveRow = el.querySelector('#ls-alive');

  const STRANDS = 8;
  const strandEls = [];
  for (let i = 0; i < STRANDS; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ls-strand';
    const angle = -17 + (34 / (STRANDS - 1)) * i;
    b.style.setProperty('--angle', `${angle}deg`);
    b.setAttribute('aria-label', `Strand ${i + 1}`);
    b.addEventListener('click', () => onCut(i));
    strandsBox.append(b);
    strandEls.push(b);
  }

  let cur = null;
  let alive = true;
  let myTurn = false;
  let lastCutKey = '';
  let collapseHandled = false;
  let lastInstability = 0;

  function onCut(i) {
    if (!myTurn || strandEls[i].disabled) return;
    ctx.send({ index: i });
    ctx.sound.play('tap');
  }

  function paintStrands(state) {
    for (let i = 0; i < STRANDS; i++) {
      const b = strandEls[i];
      const cut = state.cutMask[i];
      b.classList.toggle('cut', cut);
      b.disabled = cut || !myTurn || state.phase !== 'cutting';
    }
  }

  function renderAlive(state) {
    aliveRow.replaceChildren();
    ctx.players.forEach((p) => aliveRow.append(avatar(ctx.players, p.seat, state.seats.includes(p.seat) ? '' : 'out')));
  }

  function paint() {
    if (!cur) return;
    const state = cur;
    const tension = Math.min(1, state.instability / 100);
    stage.style.setProperty('--tension', String(tension));
    stage.classList.toggle('ls-critical', tension > 0.7);

    if (state.phase === 'collapsing' && !collapseHandled) {
      const remain = state.collapseAt - ctx.now();
      if (remain <= 0) startCollapse(state);
    }
  }
  const stop = rafLoop(paint, () => alive);

  function startCollapse(state) {
    collapseHandled = true;
    weight.classList.add('ls-falling');
    shakeScreen(el, ctx.reducedMotion);
    burstParticles(weight, { color: '#ff6a3d', reducedMotion: ctx.reducedMotion });
    ctx.sound.play('explosion');
    setTimeout(() => ctx.sound.play('eliminated'), 300);
    const who = seatInfo(ctx.players, state.collapsedBy);
    banner.textContent = state.collapsedBy === ctx.you ? 'YOU BROUGHT IT DOWN!' : `${who.name} brought it down!`;
    banner.classList.add('ls-danger-flash');
  }

  function update(state) {
    myTurn = state.phase === 'cutting' && state.seats[state.turnIdx] === ctx.you;

    // A fresh rope (instability dropped back to zero) means the last
    // collapse fully resolved and a new sub-round just began.
    if (state.instability < lastInstability) {
      collapseHandled = false;
      weight.classList.remove('ls-falling');
      banner.classList.remove('ls-danger-flash');
    }
    lastInstability = state.instability;

    if (state.phase === 'cutting') {
      banner.classList.toggle('mine', myTurn);
      banner.textContent = myTurn ? 'YOUR TURN — CUT A STRAND' : `${seatInfo(ctx.players, state.seats[state.turnIdx]).name} is cutting…`;
    }

    const cutKey = state.lastCut ? `${state.lastCut.seat}:${state.lastCut.index}` : '';
    if (cutKey && cutKey !== lastCutKey) {
      lastCutKey = cutKey;
      ctx.sound.play('snap');
      const cutEl = strandEls[state.lastCut.index];
      cutEl?.classList.add('ls-just-cut');
      setTimeout(() => cutEl?.classList.remove('ls-just-cut'), 400);
    }

    paintStrands(state);
    renderAlive(state);
    cur = state;
    paint();
  }

  return {
    update,
    destroy() { alive = false; stop(); },
  };
}
