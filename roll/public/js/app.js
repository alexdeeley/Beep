import { Net } from './net.js';
import * as snd from './sound.js';
import { initInvertToggle } from './a11y.js';
import {
  MIN_PLAYERS, MAX_PLAYERS, MAX_NAME, DICE_COUNT, MAX_ROLLS, TOTAL_TURNS,
  CATEGORIES, PLAYER_COLORS,
} from './shared.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const store = {
  get(key, area = localStorage) { try { return JSON.parse(area.getItem(key)); } catch { return null; } },
  set(key, val, area = localStorage) { try { area.setItem(key, JSON.stringify(val)); } catch {} },
  del(key, area = localStorage) { try { area.removeItem(key); } catch {} },
};

const rid = () => Math.random().toString(36).slice(2, 10);
const newPid = () => (crypto.randomUUID ? crypto.randomUUID() : rid() + rid());

const S = { net: null, code: null, pid: null, st: null, screen: null, everOpen: false, connTimer: 0, flashTimer: 0 };

const SCREENS = ['home', 'create', 'join', 'lobby', 'game', 'over'];
function show(name) {
  S.screen = name;
  for (const s of SCREENS) $('scr-' + s).hidden = s !== name;
}

// Wake the audio context on the very first tap anywhere - required by every
// mobile browser before any sound can play, and harmless to call repeatedly.
document.addEventListener('pointerdown', () => snd.unlockAudio(), { capture: true });

function refreshMute() {
  const m = snd.isMuted();
  const btn = $('btn-mute');
  btn.setAttribute('aria-pressed', m ? 'true' : 'false');
  btn.setAttribute('aria-label', m ? 'Unmute sounds' : 'Mute sounds');
  btn.innerHTML = `<svg><use href="#${m ? 'i-mute' : 'i-sound'}"/></svg>`;
}
$('btn-mute').addEventListener('click', () => { snd.setMuted(!snd.isMuted()); refreshMute(); snd.play('tap'); });
refreshMute();

initInvertToggle($('btn-a11y-home'), $('btn-a11y-hud'));

// ── Home ──────────────────────────────────────────────────────

document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { snd.play('tap'); show(b.dataset.go); }));
$('btn-create').addEventListener('click', () => { snd.play('tap'); show('create'); history.replaceState(null, '', '/create'); });
$('btn-join').addEventListener('click', () => { snd.play('tap'); show('join'); history.replaceState(null, '', '/join'); });
$('btn-help').addEventListener('click', () => { snd.play('tap'); $('ov-help').hidden = false; });
$('btn-help-close').addEventListener('click', () => { snd.play('tap'); $('ov-help').hidden = true; });

function refreshRejoin() {
  const last = store.get('roll.last');
  const btn = $('btn-rejoin');
  if (last?.code && last?.pid) {
    btn.hidden = false;
    btn.textContent = `Rejoin game ${last.code}`;
    btn.onclick = () => { snd.play('tap'); enter(last.code, last.pid, last.name); };
  } else {
    btn.hidden = true;
  }
}
refreshRejoin();

// ── Create ────────────────────────────────────────────────────

let chosenColor = null;
function buildSwatches() {
  const box = $('swatches-c');
  box.replaceChildren();
  PLAYER_COLORS.forEach((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.style.background = c;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', 'Player color');
    b.setAttribute('aria-checked', chosenColor === c ? 'true' : 'false');
    b.addEventListener('click', () => { snd.play('tap'); chosenColor = chosenColor === c ? null : c; buildSwatches(); });
    box.append(b);
  });
}
buildSwatches();

$('in-name-c').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-create-go').click(); });
$('btn-create-go').addEventListener('click', async () => {
  const name = $('in-name-c').value.trim();
  if (!name) { $('create-err').textContent = 'Please enter your name.'; return; }
  $('create-err').textContent = '';
  $('btn-create-go').disabled = true;
  try {
    const res = await fetch('/api/rooms', { method: 'POST' });
    const data = await res.json();
    if (!data.code) throw new Error('no code');
    enter(data.code, newPid(), name, chosenColor);
  } catch {
    $('create-err').textContent = "Couldn't create a game right now. Try again.";
    $('btn-create-go').disabled = false;
  }
});

// ── Join ──────────────────────────────────────────────────────

$('in-code').addEventListener('input', () => { $('in-code').value = $('in-code').value.toUpperCase(); });
$('in-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('in-name-j').focus(); });
$('in-name-j').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join-go').click(); });

$('btn-join-go').addEventListener('click', async () => {
  const code = $('in-code').value.trim().toUpperCase();
  const name = $('in-name-j').value.trim();
  if (!code) { $('join-err').textContent = 'Enter a game code.'; return; }
  if (!name) { $('join-err').textContent = 'Please enter your name.'; return; }
  $('join-err').textContent = '';
  $('btn-join-go').disabled = true;
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(code)}`);
    const data = await res.json();
    if (!data.exists) $('join-err').textContent = "We couldn't find that game. Check your game code.";
    else if (data.started) $('join-err').textContent = 'That game is already in progress.';
    else if (data.full) $('join-err').textContent = 'That game is already full.';
    else {
      const last = store.get('roll.session', sessionStorage);
      const pid = (last && last.code === code) ? last.pid : newPid();
      enter(code, pid, name, null);
      return;
    }
  } catch {
    $('join-err').textContent = 'Connection problem. Try again.';
  }
  $('btn-join-go').disabled = false;
});

// ── Connecting ────────────────────────────────────────────────

function enter(code, pid, name, color) {
  S.net?.stop();
  S.code = code; S.pid = pid; S.everOpen = false; S.st = null;
  store.set('roll.session', { code, pid, name }, sessionStorage);
  store.set('roll.last', { code, pid, name, t: Date.now() });
  history.replaceState(null, '', '/game/' + code);
  $('conn-msg').textContent = 'Connecting…';
  $('btn-conn-home').hidden = true;
  $('ov-conn').hidden = false;
  $('join-err').textContent = '';
  $('create-err').textContent = '';
  S.net = new Net({ code, playerId: pid, name, color, onMessage, onStatus });
}

function onStatus(s) {
  if (s === 'open') { S.everOpen = true; clearTimeout(S.connTimer); $('ov-conn').hidden = true; $('btn-create-go').disabled = false; $('btn-join-go').disabled = false; return; }
  if (s === 'lost') { if (S.everOpen) { $('conn-msg').textContent = 'Reconnecting…'; $('btn-conn-home').hidden = false; $('ov-conn').hidden = false; } return; }
  if (s === 'notfound') return goHome("We couldn't find that game.", true);
  if (s === 'full') return goHome('That game is already full.', false);
  if (s === 'started') return goHome('That game has already started.', false);
  if (s === 'kicked') return goHome('You were removed from the game.', true);
  if (s === 'replaced') return goHome('This game was opened on another screen.', false);
}

function goHome(message, forget) {
  S.net?.stop(); S.net = null;
  if (forget) store.del('roll.session', sessionStorage);
  history.replaceState(null, '', '/');
  $('ov-conn').hidden = true;
  $('ov-confirm').hidden = true;
  $('banner').hidden = true;
  $('btn-create-go').disabled = false;
  $('btn-join-go').disabled = false;
  refreshRejoin();
  show('home');
  if (message) flashBanner(message);
}

$('btn-conn-home').addEventListener('click', () => goHome());

function leaveGame() {
  S.net?.send({ type: 'leave' });
  store.del('roll.session', sessionStorage);
  setTimeout(() => goHome('', true), 120);
}

// ── Messages ──────────────────────────────────────────────────

function onMessage(m) {
  if (m.type === 'state') { applyState(m); return; }
  if (m.type === 'event') {
    if (m.kind === 'joined') { snd.play('join'); flashBanner(`${m.name} joined the game`); }
    if (m.kind === 'back') flashBanner(`${m.name} is back`);
    if (m.kind === 'left') flashBanner(`${m.name} left the game`);
    if (m.kind === 'kicked') flashBanner(`${m.name} was removed`);
  }
}

function flashBanner(text) {
  const b = $('banner');
  b.hidden = false;
  b.textContent = text;
  clearTimeout(S.flashTimer);
  S.flashTimer = setTimeout(() => { b.hidden = true; }, 3200);
}

function confirmBox(msg, onYes) {
  $('confirm-msg').textContent = msg;
  $('ov-confirm').hidden = false;
  const yes = $('btn-yes'), no = $('btn-no');
  const cleanup = () => { $('ov-confirm').hidden = true; yes.removeEventListener('click', onY); no.removeEventListener('click', onN); };
  const onY = () => { cleanup(); onYes(); };
  const onN = () => { cleanup(); };
  yes.addEventListener('click', onY);
  no.addEventListener('click', onN);
}

// ── State → screens ─────────────────────────────────────────

const player = (seat) => S.st?.players.find((p) => p.seat === seat);
const nameOf = (seat) => player(seat)?.name || 'Someone';
const amCurrentTurn = () => S.st && S.st.turnSeat === S.st.you;
function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

function applyState(st) {
  const prev = S.st;
  S.st = st;

  if (st.status === 'lobby') { show('lobby'); renderLobby(); return; }
  if (st.status === 'finished') {
    if (prev?.status !== 'finished') snd.play('gameover');
    show('over'); renderOver(); return;
  }
  if (S.screen !== 'game') show('game');
  renderGame(prev);
}

// ── Lobby ─────────────────────────────────────────────────────

function renderLobby() {
  const st = S.st;
  const isHost = st.you === st.host;
  $('lobby-code').textContent = st.code;
  const list = $('lobby-players');
  list.replaceChildren();
  st.players.forEach((p) => {
    const li = document.createElement('li');
    li.className = 'player-row';
    const isHostRow = p.seat === st.host;
    li.innerHTML = `
      <span class="avatar" style="background:${p.color}">${initials(p.name)}</span>
      <span class="pname"><span class="n">${esc(p.name)}${p.seat === st.you ? ' (you)' : ''}</span>${isHostRow ? '<span class="host-badge">Host</span>' : ''}${p.connected ? '' : '<span class="away-dot">away</span>'}</span>
      ${isHost && p.seat !== st.you ? `<button type="button" class="btn-kick" data-seat="${p.seat}" aria-label="Remove ${esc(p.name)}"><svg width="16" height="16"><use href="#i-close"/></svg></button>` : ''}`;
    list.append(li);
  });
  list.querySelectorAll('.btn-kick').forEach((b) => b.addEventListener('click', () => {
    const seat = Number(b.dataset.seat);
    const p = st.players.find((x) => x.seat === seat);
    confirmBox(`Remove ${p?.name || 'this player'} from the game?`, () => S.net?.send({ type: 'kick', seat }));
  }));
  $('lobby-count').textContent = `${st.players.length} / ${MAX_PLAYERS} PLAYERS`;
  const enough = st.players.length >= MIN_PLAYERS;
  $('lobby-status').textContent = !enough
    ? 'Waiting for more players…'
    : isHost ? 'Ready when you are!' : 'Waiting for host to start…';
  $('btn-start').hidden = !isHost;
  $('btn-start').disabled = !enough;
}
$('btn-start').addEventListener('click', () => { snd.play('tap'); S.net?.send({ type: 'start' }); });
$('btn-lobby-leave').addEventListener('click', () => confirmBox('Leave this game?', leaveGame));

$('btn-copy').addEventListener('click', async () => {
  snd.play('tap');
  try { await navigator.clipboard.writeText(S.st.code); flashBanner('Game code copied!'); }
  catch { flashBanner(S.st.code); }
});
if (navigator.share) {
  $('btn-share').hidden = false;
  $('btn-share').addEventListener('click', () => {
    snd.play('tap');
    navigator.share({ title: 'Roll', text: `Join my dice game! Code: ${S.st.code}`, url: `${location.origin}/game/${S.st.code}` }).catch(() => {});
  });
}

// ── Game ──────────────────────────────────────────────────────

const PIPS = {
  1: [[2, 2]],
  2: [[1, 1], [3, 3]],
  3: [[1, 1], [2, 2], [3, 3]],
  4: [[1, 1], [3, 1], [1, 3], [3, 3]],
  5: [[1, 1], [3, 1], [2, 2], [1, 3], [3, 3]],
  6: [[1, 1], [1, 2], [1, 3], [3, 1], [3, 2], [3, 3]],
};

let displayDice = [0, 0, 0, 0, 0];
let animTimer = 0;
let animating = false;

function renderGame(prev) {
  const st = S.st;
  $('hud-round').textContent = `Round ${st.round} / ${st.totalRounds}`;
  renderStrip();
  renderTurnBanner();
  renderDiceAnimated(prev);
  renderRollControls();
  renderScorecard();
}

function renderStrip() {
  const st = S.st;
  const strip = $('player-strip');
  strip.replaceChildren();
  st.players.forEach((p) => {
    const el = document.createElement('div');
    el.className = 'strip-item' + (p.seat === st.turnSeat ? ' active' : '');
    el.setAttribute('role', 'listitem');
    el.innerHTML = `
      <span class="avatar" style="background:${p.color}">${initials(p.name)}</span>
      <span class="sinfo">
        <span class="sname${p.connected ? '' : ' away'}">${esc(p.name)}${!p.connected ? ' (away)' : ''}</span>
        <span class="stotal">${p.total}</span>
      </span>`;
    strip.append(el);
  });
}

function renderTurnBanner() {
  const st = S.st;
  const mine = amCurrentTurn();
  const b = $('turn-banner');
  b.classList.toggle('you', mine);
  b.textContent = mine ? 'Your turn!' : `${nameOf(st.turnSeat)}'s turn`;
}

function renderDiceAnimated(prev) {
  const st = S.st;
  clearInterval(animTimer); animTimer = 0;
  const justRolled = prev && prev.status === 'playing' && st.status === 'playing' && prev.rollsUsed < st.rollsUsed;

  if (justRolled && !reduceMotion) {
    displayDice = prev.dice.slice();
    const rerolling = st.held.map((h) => !h);
    animating = true;
    snd.play('roll');
    paintDice(rerolling);
    const startedAt = performance.now();
    animTimer = setInterval(() => {
      for (let i = 0; i < DICE_COUNT; i++) if (rerolling[i]) displayDice[i] = 1 + Math.floor(Math.random() * 6);
      paintDice(rerolling);
      if (performance.now() - startedAt > 420) {
        clearInterval(animTimer); animTimer = 0;
        displayDice = st.dice.slice();
        animating = false;
        paintDice(new Array(DICE_COUNT).fill(false));
        snd.play('land');
      }
    }, 70);
  } else {
    if (justRolled) snd.play('land'); // reduced motion: skip the shake, still confirm audibly
    displayDice = st.dice.slice();
    animating = false;
    paintDice(new Array(DICE_COUNT).fill(false));
  }
}

function paintDice(shakingMask) {
  const st = S.st;
  const box = $('dice');
  box.replaceChildren();
  const canInteract = amCurrentTurn() && st.status === 'playing' && !animating && st.rollsUsed >= 1 && st.rollsUsed < MAX_ROLLS;
  for (let i = 0; i < DICE_COUNT; i++) {
    const face = displayDice[i];
    const held = st.held[i];
    const d = document.createElement('div');
    let cls = 'die';
    if (!face) cls += ' empty';
    if (held) cls += ' held';
    if (shakingMask[i]) cls += ' shaking';
    if (!canInteract) cls += ' disabled';
    d.className = cls;
    (PIPS[face] || []).forEach(([c, r]) => {
      const p = document.createElement('span');
      p.className = 'pip';
      p.style.setProperty('--c', c);
      p.style.setProperty('--r', r);
      d.append(p);
    });
    d.setAttribute('role', 'button');
    d.setAttribute('tabindex', canInteract ? '0' : '-1');
    d.setAttribute('aria-label', face ? `Die ${i + 1}: ${face}${held ? ', held' : ''}` : `Die ${i + 1}, not yet rolled`);
    d.addEventListener('click', () => canInteract && onDieTap(i));
    d.addEventListener('keydown', (e) => { if (canInteract && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onDieTap(i); } });
    box.append(d);
  }
}

function onDieTap(i) {
  snd.play(S.st.held[i] ? 'release' : 'hold');
  S.net?.send({ type: 'hold', i });
}

function renderRollControls() {
  const st = S.st;
  const mine = amCurrentTurn() && st.status === 'playing';
  const btn = $('btn-roll');
  btn.hidden = !mine;
  btn.disabled = !mine || animating || st.rollsUsed >= MAX_ROLLS;
  btn.textContent = st.rollsUsed === 0 ? 'Roll Dice' : 'Roll Again';
  $('roll-count').textContent = st.rollsUsed > 0
    ? `Roll ${st.rollsUsed} of ${MAX_ROLLS}${st.rollsUsed >= MAX_ROLLS ? ' - pick a category!' : ''}`
    : (mine ? 'Tap Roll Dice to begin' : '');
}
$('btn-roll').addEventListener('click', () => {
  if ($('btn-roll').disabled) return;
  snd.play('tap');
  S.net?.send({ type: 'roll' });
});

function renderScorecard() {
  const st = S.st;
  const me = player(st.you);
  const rows = $('score-rows');
  rows.replaceChildren();
  if (!me) return;
  const canScore = amCurrentTurn() && st.status === 'playing' && st.rollsUsed >= 1;
  CATEGORIES.forEach((cat) => {
    const filled = me.categories[cat.id] != null;
    const available = canScore && !filled;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'score-row' + (filled ? ' filled' : '') + (available ? ' available' : '');
    row.disabled = !available;
    const shown = filled ? me.categories[cat.id] : (available ? st.preview[cat.id] : null);
    row.innerHTML = `
      <span><span class="cat-label">${esc(cat.label)}</span><br><span class="cat-hint">${esc(cat.hint)}</span></span>
      <span class="cat-score">${shown != null ? shown : '–'}</span>`;
    if (available) row.addEventListener('click', () => confirmScore(cat));
    rows.append(row);
    if (cat.id === 'sixes') {
      const bonusRow = document.createElement('div');
      bonusRow.className = 'score-row section-total';
      bonusRow.innerHTML = `<span class="cat-label">Upper Total / Bonus</span><span class="cat-score">${me.upperTotal}${me.bonus ? ' + ' + me.bonus : ''}</span>`;
      rows.append(bonusRow);
    }
  });
  $('score-total').textContent = me.total;
}

function confirmScore(cat) {
  const st = S.st;
  const score = st.preview[cat.id];
  confirmBox(`Score ${score} points in ${cat.label}?`, () => {
    S.net?.send({ type: 'score', id: cat.id });
    snd.play(cat.id === 'yahtzee' && score === 50 ? 'yahtzee' : 'score');
  });
}

$('btn-quit').addEventListener('click', () => confirmBox('Leave this game?', leaveGame));

// ── Game over ─────────────────────────────────────────────────

function renderOver() {
  const st = S.st;
  const winners = st.winnerSeats || [];
  const sorted = [...st.players].sort((a, b) => b.total - a.total);
  $('over-winner').textContent = winners.map((seat) => nameOf(seat)).join(' & ') || '—';
  $('over-points').textContent = `${sorted[0]?.total ?? 0} points`;
  const box = $('over-scores');
  box.replaceChildren();
  sorted.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'over-score-row' + (winners.includes(p.seat) ? ' winner' : '');
    row.innerHTML = `
      <span class="n"><span class="avatar" style="background:${p.color};width:30px;height:30px;font-size:.75rem">${initials(p.name)}</span>${esc(p.name)}</span>
      <span class="v">${p.total}</span>`;
    box.append(row);
  });
}
$('btn-again').addEventListener('click', () => { snd.play('tap'); S.net?.send({ type: 'again' }); });
$('btn-return-lobby').addEventListener('click', () => { snd.play('tap'); S.net?.send({ type: 'lobby' }); });
$('btn-new').addEventListener('click', () => { snd.play('tap'); leaveGame(); });

// ── Boot / routing ────────────────────────────────────────────
// Clean routes: / , /create , /join , /game/CODE (see README).

function boot() {
  const m = /^\/game\/([A-Za-z0-9]+)/i.exec(location.pathname);
  const sess = store.get('roll.session', sessionStorage);
  if (m) {
    const code = m[1].toUpperCase();
    if (sess && sess.code === code) { enter(code, sess.pid, sess.name); return; }
    show('join');
    $('in-code').value = code;
    return;
  }
  if (location.pathname === '/create') { show('create'); return; }
  if (location.pathname === '/join') { show('join'); return; }
  if (sess) { enter(sess.code, sess.pid, sess.name); return; }
  show('home');
}
boot();

// Debug hook for the browser test harness (mirrors Draw Together/Blackjack).
window.__roll = { S };
