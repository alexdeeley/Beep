// COLOR PANIC — client renderer. A target color is named; tap it before
// the (shrinking) deadline. `decoyCount` is a purely cosmetic difficulty
// cue from the server - a few fake flashes before the real target settles,
// eating into the same real deadline everyone shares, never extending it.

import { seatInfo, avatar, shakeScreen, rafLoop } from './_util.js';

const SWATCH = { red: '#ff3d5a', white: '#f4f4f4', black: '#1a1a1a', yellow: '#ffd43b' };
const LABEL = { red: 'RED', white: 'WHITE', black: 'BLACK', yellow: 'YELLOW' };
const COLORS = Object.keys(SWATCH);
const DECOY_FLASH_MS = 110;

export function mount(el, ctx) {
  el.innerHTML = `
    <div class="cp-wrap">
      <p class="game-banner" id="cp-banner"></p>
      <div class="cp-target" id="cp-target">?</div>
      <div class="cp-bar-track"><div class="cp-bar" id="cp-bar"></div></div>
      <div class="cp-grid" id="cp-grid" role="group" aria-label="Tap the target color"></div>
      <div class="alive-row" id="cp-alive"></div>
    </div>`;
  const banner = el.querySelector('#cp-banner');
  const targetEl = el.querySelector('#cp-target');
  const bar = el.querySelector('#cp-bar');
  const grid = el.querySelector('#cp-grid');
  const aliveRow = el.querySelector('#cp-alive');

  const buttons = {};
  COLORS.forEach((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cp-btn';
    b.style.background = SWATCH[c];
    b.style.color = c === 'white' || c === 'yellow' ? '#111' : '#fff';
    b.textContent = LABEL[c];
    b.addEventListener('click', () => onPick(c));
    grid.append(b);
    buttons[c] = b;
  });

  let cur = null;
  let alive = true;
  let lastPromptAt = -1;
  let prevSeats = [];
  let prevTarget = null;
  let prevPicks = {};
  let revealing = false;
  let decoyTimer = 0;

  function onPick(color) {
    if (!cur || cur.phase !== 'prompt' || revealing) return;
    if (!cur.seats.includes(ctx.you) || cur.picks[ctx.you] != null) return;
    ctx.send({ color });
    ctx.sound.play('tap');
    paintPicked(color);
  }

  function paintPicked(color) {
    COLORS.forEach((c) => buttons[c].classList.toggle('picked', c === color));
  }

  function setButtonsEnabled(enabled) {
    COLORS.forEach((c) => { buttons[c].disabled = !enabled; });
  }

  function renderAlive(state) {
    aliveRow.replaceChildren();
    ctx.players.forEach((p) => aliveRow.append(avatar(ctx.players, p.seat, state.seats.includes(p.seat) ? '' : 'out')));
  }

  function showEliminationFeedback(state) {
    const iWasIn = prevSeats.includes(ctx.you);
    const iAmIn = state.seats.includes(ctx.you);
    if (iWasIn && !iAmIn) {
      ctx.sound.play('wrong');
      shakeScreen(el, ctx.reducedMotion);
      banner.textContent = prevPicks[ctx.you] == null ? "TOO SLOW — YOU'RE OUT" : "WRONG COLOR — YOU'RE OUT";
    } else if (iWasIn && iAmIn && prevPicks[ctx.you] === prevTarget) {
      ctx.sound.play('correct');
    }
  }

  function runDecoysThenReveal(state) {
    clearTimeout(decoyTimer);
    revealing = state.decoyCount > 0;
    setButtonsEnabled(false);
    targetEl.className = 'cp-target';
    let flashesLeft = state.decoyCount;
    const flash = () => {
      if (!alive) return;
      if (flashesLeft > 0) {
        const decoy = COLORS[Math.floor(Math.random() * COLORS.length)];
        targetEl.textContent = LABEL[decoy];
        targetEl.style.color = SWATCH[decoy];
        targetEl.classList.add('flash');
        flashesLeft -= 1;
        decoyTimer = setTimeout(flash, DECOY_FLASH_MS);
      } else {
        targetEl.textContent = LABEL[state.target];
        targetEl.style.color = SWATCH[state.target];
        targetEl.classList.remove('flash');
        targetEl.classList.add('settled');
        revealing = false;
        setButtonsEnabled(state.seats.includes(ctx.you) && state.phase === 'prompt');
      }
    };
    flash();
  }

  function paint() {
    if (!cur) return;
    const state = cur;
    const remain = Math.max(0, state.deadlineAt - ctx.now());
    const total = Math.max(1, state.deadlineAt - state.promptAt);
    bar.style.width = `${Math.max(0, (remain / total) * 100)}%`;
    bar.classList.toggle('critical', remain < total * 0.3);
  }
  const stop = rafLoop(paint, () => alive);

  function update(state) {
    const inGame = state.seats.includes(ctx.you);
    const isNewRound = state.promptAt !== lastPromptAt;
    if (isNewRound) {
      showEliminationFeedback(state);
      lastPromptAt = state.promptAt;
      runDecoysThenReveal(state);
      COLORS.forEach((c) => buttons[c].classList.remove('picked'));
      banner.textContent = inGame ? 'TAP THE TARGET COLOR!' : 'watching…';
      banner.classList.toggle('mine', inGame);
    }
    setButtonsEnabled(inGame && state.phase === 'prompt' && !revealing && state.picks[ctx.you] == null);
    if (state.picks[ctx.you] != null) paintPicked(state.picks[ctx.you]);
    renderAlive(state);

    prevSeats = state.seats.slice();
    prevTarget = state.target;
    prevPicks = { ...state.picks };
    cur = state;
  }

  return {
    update,
    destroy() { alive = false; stop(); clearTimeout(decoyTimer); },
  };
}
