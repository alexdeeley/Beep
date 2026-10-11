// Presentation: screens, rendering, and wiring the game to the page.
// Everything the player sees and touches lives here; the rules live in
// game.js, the facts in braille.js, the memory in stats.js.

import { ALPHABET, DIGITS, NUMBER_SIGN, cellsFor, displayName, dotsLabel, isDigit, spokenName, toUnicode, dotsFor } from './braille.js';
import { Game, MODES, introducedLetters } from './game.js';
import { Stats } from './stats.js';
import { Feedback, Settings, canVibrate } from './audio.js';
import { liveRegion, reducedMotion, keyHandler, focusFirst } from './a11y.js';

const $ = (id) => document.getElementById(id);
const announce = liveRegion();
const settings = new Settings(window.localStorage);
const stats = new Stats(window.localStorage);
const fx = new Feedback(settings);

const S = {
  screen: 'home',
  game: null, mode: 'letters', context: false,
  q: null, qStart: 0, locked: false,
  paused: false, pausedAt: 0, pausedMs: 0,
  nextTimer: 0, pendingNext: false,
  sessionStart: 0,
};

// ── Braille cells as SVG ───────────────────────────────────────────────
// Raised dots are big solid discs; empty positions are small hollow rings,
// so the difference is in shape and size as well as colour.
export function cellSvg(dots, { sign = false, numbers = false } = {}) {
  const set = new Set(dots);
  const pos = { 1: [34, 36], 2: [34, 80], 3: [34, 124], 4: [86, 36], 5: [86, 80], 6: [86, 124] };
  let out = `<svg class="cell${sign ? ' sign' : ''}" viewBox="0 0 120 160" aria-hidden="true" focusable="false"><rect class="frame" x="4" y="4" width="112" height="152" rx="18"/>`;
  for (const d of [1, 2, 3, 4, 5, 6]) {
    const [x, y] = pos[d];
    out += set.has(d) ? `<circle class="raised" cx="${x}" cy="${y}" r="17"/>` : `<circle class="empty" cx="${x}" cy="${y}" r="7"/>`;
    if (numbers) out += `<text class="no" x="${x + (d <= 3 ? -27 : 20)}" y="${y + 5}">${d}</text>`;
  }
  return out + '</svg>';
}

function cellsHtml(cells, opts = {}) {
  return cells.map((c, i) => cellSvg(c, { sign: opts.signFirst && i === 0 })).join('');
}

// How a screen reader hears a set of cells. Never says the answer.
function cellsLabel(cells, { signFirst = false } = {}) {
  return cells.map((c, i) => {
    if (signFirst && i === 0) return 'number sign';
    return `cell with ${dotsLabel(c)}`;
  }).join(', then ');
}

// ── Screens ────────────────────────────────────────────────────────────
const SCREENS = ['home', 'play', 'summary', 'stats', 'settings', 'help'];
function show(name) {
  for (const s of SCREENS) $('scr-' + s).hidden = s !== name;
  S.screen = name;
  window.scrollTo(0, 0);
  if (name === 'home') renderHome();
  if (name === 'stats') renderStats();
  if (name === 'settings') renderSettings();
  if (name === 'help') renderHelp();
  focusFirst($('scr-' + name));
}

// ── Home ───────────────────────────────────────────────────────────────
function renderHome() {
  const modes = $('modes');
  const intro = introducedLetters(stats);
  const weak = stats.weakChars([...ALPHABET, ...DIGITS]);
  const counts = {
    letters: `${intro.length} of 26 letters unlocked`,
    numbers: `${DIGITS.filter((d) => stats.isMastered(d)).length} of 10 mastered`,
    mixed: `${[...ALPHABET, ...DIGITS].filter((k) => stats.isMastered(k)).length} of 36 mastered`,
    review: weak.length ? `${weak.length} to review: ${weak.slice(0, 8).map(displayName).join(' ')}${weak.length > 8 ? ' …' : ''}` : 'nothing to review right now',
    touch: 'hear a name, find its cell',
  };
  modes.innerHTML = Object.entries(MODES).map(([id, m]) => `
    <button class="btn mode-btn" data-mode="${id}" ${id === 'review' && !weak.length ? 'aria-describedby="path-note"' : ''}>
      <span class="mode-name">${m.name}</span>
      <span class="mode-blurb">${m.blurb}</span>
      <span class="mode-count">${counts[id]}</span>
    </button>`).join('') + `
    <button class="btn mode-btn sub" data-mode="numbers" data-context="1">
      <span class="mode-name">Numbers in context</span>
      <span class="mode-blurb">Advanced: read two- and three-digit numbers after one number sign.</span>
    </button>`;
  modes.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => startGame(b.dataset.mode, { context: !!b.dataset.context })));

  // The path: five stages, read from the statistics. Never a gate.
  const mastered = (keys) => keys.filter((k) => stats.isMastered(k)).length;
  const mixedAcc = stats.summary().modes.mixed;
  const avgMs = stats.recentAverageMs(20);
  const stages = [
    { t: 'Learn a few letters', s: `${mastered(ALPHABET.slice(0, 6))} of the first 6 mastered`, done: mastered(ALPHABET.slice(0, 6)) >= 5 },
    { t: 'The whole alphabet', s: `${mastered(ALPHABET)} of 26 mastered`, done: mastered(ALPHABET) >= 22 },
    { t: 'Numbers', s: `${mastered(DIGITS)} of 10 mastered`, done: mastered(DIGITS) >= 9 },
    { t: 'Letters and numbers together', s: mixedAcc ? `${mixedAcc.total} mixed answers, ${Math.round((mixedAcc.correct / mixedAcc.total) * 100)}% right` : 'try Mixed Practice', done: !!mixedAcc && mixedAcc.total >= 40 && mixedAcc.correct / mixedAcc.total >= 0.85 },
    { t: 'Weak spots and speed', s: weak.length ? `${weak.length} characters still to review` : avgMs ? `about ${(avgMs / 1000).toFixed(1)} s per answer lately` : 'keep going', done: !weak.length && avgMs != null && avgMs < 2500 && mastered(ALPHABET) >= 22 },
  ];
  const now = stages.findIndex((x) => !x.done);
  $('path').innerHTML = stages.map((x, i) => `<li class="${x.done ? 'done' : i === now ? 'now' : ''}"><span class="stage-no" aria-hidden="true">${x.done ? '✓' : i + 1}</span><span class="stage-text">Stage ${i + 1}: ${x.t}<span class="stage-sub">${x.done ? 'Done. ' : ''}${x.s}</span></span></li>`).join('');
}

// ── Play ───────────────────────────────────────────────────────────────
function startGame(mode, { context = false } = {}) {
  fx.unlock();
  S.mode = mode; S.context = context;
  S.game = new Game({ mode, stats, sessionLength: settings.get('session'), context });
  S.sessionStart = performance.now();
  S.paused = false; S.pausedMs = 0; S.pendingNext = false;
  clearTimeout(S.nextTimer);
  $('hud-mode').textContent = context ? 'Numbers in context' : MODES[mode].name;
  $('progress').setAttribute('aria-valuemax', String(S.game.total));
  $('pause-overlay').hidden = true;
  const fill = $('prog-fill'); fill.style.transition = 'none'; fill.style.width = '0%'; void fill.offsetWidth; fill.style.transition = '';   // a new round starts empty, with no slide down from the last one
  show('play');
  if (mode === 'numbers') announce('Numbers. In Braille a number sign, dots 3 4 5 6, comes before the digits. The digits use the same cells as the letters A to J.');
  nextQuestion();
}

function nextQuestion() {
  const g = S.game;
  const q = g.next();
  S.q = q;
  if (!q) {
    if (g.exhausted) {
      show('home');
      announce('Nothing to review: you have no missed characters waiting. Well done.');
      flashHome('Nothing to review right now - every missed character is mastered. Nice work!');
      return;
    }
    return showSummary();
  }
  $('hud-q').textContent = `Question ${q.n} of ${q.total}`;
  renderScore();
  $('progress').setAttribute('aria-valuenow', String(q.n - 1));
  $('prog-fill').style.width = `${((q.n - 1) / q.total) * 100}%`;
  $('prompt').textContent = q.prompt;
  $('instruction').textContent = q.instruction || '';
  const fb = $('feedback'); fb.textContent = ''; fb.className = 'feedback';

  const cells = $('cells');
  const answers = $('answers');
  if (q.reverse) {
    cells.innerHTML = '';
    cells.setAttribute('aria-label', '');
    cells.hidden = true;
    answers.innerHTML = q.choices.map((c, i) => {
      const cc = q.choiceCells[i];
      const signFirst = isDigit(c);
      return `<button class="btn reverse" data-i="${i}" aria-label="Answer ${i + 1}: ${cellsLabel(cc, { signFirst })}"><span class="k" aria-hidden="true">${i + 1}</span><span class="cells${cc.length > 1 ? ' many' : ''}">${cellsHtml(cc, { signFirst })}</span></button>`;
    }).join('');
    fx.speak(q.prompt);
  } else {
    cells.hidden = false;
    const signFirst = q.kind !== 'letter';
    cells.className = 'cells' + (q.cells.length > 2 ? ' many' : '');
    cells.innerHTML = cellsHtml(q.cells, { signFirst });
    cells.setAttribute('aria-label', `Braille: ${cellsLabel(q.cells, { signFirst })}`);
    answers.innerHTML = q.choices.map((c, i) => `<button class="btn" data-i="${i}" aria-label="Answer ${i + 1}: ${q.kind === 'letter' ? 'letter ' + c.toUpperCase() : 'number ' + c}"><span class="k" aria-hidden="true">${i + 1}</span>${displayName(c)}</button>`).join('');
  }
  answers.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => choose(Number(b.dataset.i))));
  announce(`Question ${q.n} of ${q.total}. ${q.prompt}${q.reverse ? '' : ' ' + cellsLabel(q.cells, { signFirst: q.kind !== 'letter' })}. Answers: ${q.choices.map((c, i) => `${i + 1}, ${q.reverse ? cellsLabel(q.choiceCells[i], { signFirst: isDigit(c) }) : displayName(c)}`).join('; ')}.`);
  S.qStart = performance.now(); S.pausedMs = 0;
  S.locked = false;
}

function renderScore() {
  const s = S.game.session;
  $('hud-score').innerHTML = `<span class="ok">${s.correct} right</span> <span class="sep">&middot;</span> <span class="streak">streak ${s.streak}</span>`;
}

function choose(i) {
  if (S.screen !== 'play' || S.locked || S.paused || !S.q) return;
  const q = S.q;
  if (i < 0 || i >= q.choices.length) return;
  S.locked = true;                                   // one answer per question: later taps are ignored
  fx.unlock();
  const ms = performance.now() - S.qStart - S.pausedMs;
  const res = S.game.answer(q.choices[i], ms);
  if (!res) return;
  const btns = [...$('answers').querySelectorAll('button')];
  btns.forEach((b) => { b.disabled = true; });
  const rightIdx = q.choices.indexOf(q.answer);
  btns[rightIdx].classList.add('right');
  const fb = $('feedback');
  const name = q.kind === 'letter' ? q.answer.toUpperCase() : q.answer;
  if (res.correct) {
    fb.textContent = `✓ Correct! ${name}`;
    fb.className = 'feedback good';
    fx.react('correct');
    announce(`Correct. ${name}. Streak ${res.streak}.`);
  } else {
    btns[i].classList.add('wrong');
    const chosen = q.kind === 'letter' ? q.choices[i].toUpperCase() : q.choices[i];
    fb.textContent = `✗ Not quite — it was ${name}`;
    fb.className = 'feedback bad';
    fx.react('wrong');
    announce(`Not quite. You chose ${chosen}. The answer was ${name}.`);
  }
  if (res.milestone) setTimeout(() => { fx.react('milestone'); announce(`${res.milestone} in a row!`); fb.textContent += ` — ${res.milestone} in a row!`; }, 350);
  renderScore();
  $('progress').setAttribute('aria-valuenow', String(q.n));
  $('prog-fill').style.width = `${(q.n / q.total) * 100}%`;
  const delay = res.correct ? (res.milestone ? 1400 : 850) : 1900;
  S.pendingNext = true;
  S.nextTimer = setTimeout(() => { S.pendingNext = false; if (!S.paused) nextQuestion(); }, delay);
}

function pause() {
  if (S.screen !== 'play' || S.paused) return;
  S.paused = true; S.pausedAt = performance.now();
  $('pause-overlay').hidden = false;
  focusFirst($('pause-overlay'));
  announce('Paused.');
}
function resume() {
  if (!S.paused) return;
  S.paused = false;
  S.pausedMs += performance.now() - S.pausedAt;
  $('pause-overlay').hidden = true;
  announce('Resumed.');
  if (S.pendingNext) { S.pendingNext = false; clearTimeout(S.nextTimer); nextQuestion(); }
  else { const b = $('answers').querySelector('button:not([disabled])'); if (b) b.focus(); }
}
function endSessionTime() {
  if (S.sessionStart) { stats.addTime(performance.now() - S.sessionStart - (S.paused ? performance.now() - S.pausedAt : 0)); S.sessionStart = 0; }
}
function restart() {
  clearTimeout(S.nextTimer);
  endSessionTime();
  announce('Restarted.');
  startGame(S.mode, { context: S.context });
}
function quit() {
  clearTimeout(S.nextTimer);
  endSessionTime();
  S.paused = false; $('pause-overlay').hidden = true;
  show('home');
}

// ── Summary ────────────────────────────────────────────────────────────
function showSummary() {
  endSessionTime();
  const s = S.game.session;
  const acc = s.answered ? Math.round((s.correct / s.answered) * 100) : 0;
  const avg = s.answered ? (s.ms / s.answered / 1000).toFixed(1) : '0.0';
  $('sum-tiles').innerHTML = [
    ['good', `${s.correct} / ${s.answered}`, 'right'],
    ['accent', `${acc}%`, 'accuracy'],
    ['', `${s.longest}`, 'best streak'],
    ['', `${avg} s`, 'per answer'],
  ].map(([cls, v, l]) => `<div class="tile ${cls}"><span class="v">${v}</span><span class="l">${l}</span></div>`).join('');
  const weak = stats.weakChars([...ALPHABET, ...DIGITS]);
  $('sum-note').textContent = acc === 100 ? 'Perfect round!' : acc >= 80 ? 'Strong round. Keep the rhythm.' : weak.length ? `Worth a review: ${weak.slice(0, 6).map(displayName).join(' ')}` : 'Every mistake you review becomes a strength.';
  $('btn-sum-review').hidden = !weak.length;
  show('summary');
  fx.react('complete');
  announce(`Round complete. ${s.correct} of ${s.answered} right, ${acc} percent. Best streak ${s.longest}.`);
}

// ── Statistics ─────────────────────────────────────────────────────────
function fmtTime(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return `${Math.round(ms / 1000)} s`;
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
function charTile(k) {
  const c = stats.char(k);
  const lv = stats.level(k);
  const acc = stats.recentAccuracy(k);
  const weak = lv === 'learning' && c.attempts - c.correct > 0 && acc != null && acc < 0.7;
  const label = `${displayName(k)}: ${c.attempts ? `${c.correct} of ${c.attempts} right` : 'not tried yet'}${acc != null ? `, ${Math.round(acc * 100)} percent lately` : ''}, ${lv}`;
  return `<div class="char ${lv}${weak ? ' weak' : ''}" role="img" aria-label="${label}"><div class="c">${displayName(k)}</div><div class="u">${isDigit(k) ? toUnicode(NUMBER_SIGN) : ''}${toUnicode(dotsFor(k))}</div><div class="bar"><i style="width:${acc == null ? 0 : Math.round(acc * 100)}%"></i></div><div class="lv">${lv === 'new' ? 'new' : lv === 'mastered' ? 'mastered' : `${c.correct}/${c.attempts}`}</div></div>`;
}
function renderStats() {
  const sm = stats.summary();
  const all = [...ALPHABET, ...DIGITS];
  $('stats-tiles').innerHTML = [
    ['', sm.total, 'answered'],
    ['good', sm.accuracy == null ? '–' : `${Math.round(sm.accuracy * 100)}%`, 'accuracy'],
    ['accent', sm.streak, 'current streak'],
    ['', sm.longest, 'longest streak'],
    ['', all.filter((k) => stats.isMastered(k)).length + ' / 36', 'mastered'],
    ['', fmtTime(sm.timeMs), 'practised'],
  ].map(([cls, v, l]) => `<div class="tile ${cls}"><span class="v">${v}</span><span class="l">${l}</span></div>`).join('');
  $('grid-letters').innerHTML = ALPHABET.map(charTile).join('');
  $('grid-digits').innerHTML = DIGITS.map(charTile).join('');
  const missed = stats.mostMissed(all, 6);
  $('missed').innerHTML = missed.length ? missed.map((m) => `<li>${displayName(m.key)}<span class="u">${toUnicode(dotsFor(m.key))}</span> — missed ${m.misses} of ${m.attempts}</li>`).join('') : '<li>Nothing missed yet.</li>';
  const recent = sm.recent.slice(-20);
  $('recent').innerHTML = recent.length ? recent.map((r) => `<span class="${r.c ? 'y' : 'n'}" title="${displayName(r.k)}">${r.c ? '✓' : '✗'}</span>`).join('') : '<span class="legend">No answers yet.</span>';
  $('recent').setAttribute('aria-label', recent.length ? `Last ${recent.length} answers: ${recent.filter((r) => r.c).length} right` : 'No answers yet');
}

// ── Settings ───────────────────────────────────────────────────────────
function renderSettings() {
  const vib = canVibrate();
  const rows = [
    { k: 'sound', name: 'Sound', sub: 'Chime for right, low tone for wrong, a fanfare for milestones.' },
    { k: 'vibrate', name: 'Vibration', sub: vib ? 'A short buzz for right, a double buzz for wrong.' : 'Not available in this browser (iPhone and iPad browsers do not offer it).', off: !vib },
    { k: 'speak', name: 'Read prompts aloud', sub: 'In Practice by Touch, the character name is spoken as well as shown.' },
    { k: 'mute', name: 'Mute everything', sub: 'Silences sound, vibration and speech at once. Text and colour always stay.' },
  ];
  $('settings').innerHTML = rows.map((r) => `
    <div class="setting"><div class="s-text"><span class="s-name" id="set-${r.k}">${r.name}</span><span class="s-sub">${r.sub}</span></div>
    <button class="switch" data-k="${r.k}" role="switch" aria-checked="${settings.get(r.k) && !r.off}" aria-pressed="${settings.get(r.k) && !r.off}" aria-labelledby="set-${r.k}" ${r.off ? 'disabled' : ''}>${settings.get(r.k) && !r.off ? 'On' : 'Off'}</button></div>`).join('') + `
    <div class="setting"><div class="s-text"><span class="s-name" id="set-session">Questions per round</span><span class="s-sub">A round ends with a summary; you can always play another.</span></div>
    <div class="seg" role="group" aria-labelledby="set-session">${[10, 20, 40].map((n) => `<button class="btn small" data-session="${n}" aria-pressed="${settings.get('session') === n}">${n}</button>`).join('')}</div></div>`;
  $('settings').querySelectorAll('.switch').forEach((b) => b.addEventListener('click', () => {
    fx.unlock();
    const k = b.dataset.k; const v = !settings.get(k);
    settings.set(k, v);
    renderSettings(); renderMute();
    if (k === 'sound' && v) fx.play('correct');
    if (k === 'vibrate' && v) fx.buzz('correct');
    announce(`${k === 'mute' ? 'Mute everything' : k} ${v ? 'on' : 'off'}.`);
  }));
  $('settings').querySelectorAll('[data-session]').forEach((b) => b.addEventListener('click', () => { settings.set('session', Number(b.dataset.session)); renderSettings(); }));
}
function renderMute() {
  const m = settings.get('mute');
  $('btn-mute').setAttribute('aria-pressed', String(m));
  $('btn-mute').setAttribute('aria-label', m ? 'Unmute sound and vibration' : 'Mute all sound and vibration');
  $('btn-mute').textContent = m ? '\u{1F507}' : '\u{1F50A}';
}

// ── Help ───────────────────────────────────────────────────────────────
function renderHelp() {
  $('help-cell').innerHTML = cellSvg([1, 2, 3, 5], { numbers: true }).replace('aria-hidden="true"', 'role="img" aria-label="A cell with dots 1, 2, 3 and 5 raised: the letter R. Positions 1, 2, 3 run down the left; 4, 5, 6 down the right."');
  $('help-modes').innerHTML = Object.values(MODES).map((m) => `<li><strong>${m.name}.</strong> ${m.blurb}</li>`).join('') + '<li><strong>Numbers in context.</strong> Two- and three-digit numbers after a single number sign.</li>';
}

function flashHome(text) {
  const p = document.createElement('p');
  p.className = 'tagline'; p.setAttribute('role', 'status'); p.textContent = text;
  $('scr-home').insertBefore(p, $('modes'));
  setTimeout(() => p.remove(), 6000);
}

// ── Wiring ─────────────────────────────────────────────────────────────
$('btn-stats').addEventListener('click', () => show('stats'));
$('btn-settings').addEventListener('click', () => show('settings'));
$('btn-help').addEventListener('click', () => show('help'));
$('btn-stats-back').addEventListener('click', () => show('home'));
$('btn-settings-back').addEventListener('click', () => show('home'));
$('btn-help-back').addEventListener('click', () => show('home'));
$('btn-pause').addEventListener('click', pause);
$('btn-resume').addEventListener('click', resume);
$('btn-pause-quit').addEventListener('click', quit);
$('btn-restart').addEventListener('click', restart);
$('btn-quit').addEventListener('click', quit);
$('btn-again').addEventListener('click', () => startGame(S.mode, { context: S.context }));
$('btn-sum-review').addEventListener('click', () => startGame('review'));
$('btn-sum-home').addEventListener('click', () => show('home'));
$('btn-reset').addEventListener('click', () => { $('reset-overlay').hidden = false; focusFirst($('reset-overlay')); });
$('btn-reset-no').addEventListener('click', () => { $('reset-overlay').hidden = true; $('btn-reset').focus(); });
$('btn-reset-yes').addEventListener('click', () => { stats.reset(); $('reset-overlay').hidden = true; renderStats(); announce('Statistics reset.'); $('stats-h').focus(); });
$('btn-mute').addEventListener('click', () => { fx.unlock(); settings.set('mute', !settings.get('mute')); renderMute(); if (S.screen === 'settings') renderSettings(); announce(settings.get('mute') ? 'Muted.' : 'Unmuted.'); });

document.addEventListener('keydown', keyHandler({
  choose: (i) => { if (S.screen === 'play' && !S.paused) choose(i); },
  pause: () => { if (S.screen !== 'play') return; S.paused ? resume() : pause(); },
  back: () => {
    if (S.screen === 'play') { S.paused ? resume() : pause(); }
    else if (S.screen === 'stats' && !$('reset-overlay').hidden) { $('reset-overlay').hidden = true; }
    else if (S.screen !== 'home') show('home');
  },
  choicesLabels: () => (S.q && !S.q.reverse ? S.q.choices.map(displayName) : []),
}));
document.addEventListener('pointerdown', () => fx.unlock(), { capture: true, passive: true });
document.addEventListener('visibilitychange', () => { if (document.hidden && S.screen === 'play' && !S.paused && !S.locked) pause(); });
window.addEventListener('pagehide', endSessionTime);

renderMute();
show('home');
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

// For automated tests: a read-only peek at state.
window.__bb = { S, stats, settings, cellSvg, reducedMotion, game: () => S.game, question: () => S.q, choose };
