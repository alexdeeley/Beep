import { Net } from './net.js';
import * as snd from './sound.js';
import { initInvertToggle, reducedMotion } from './a11y.js';
import {
  MIN_PLAYERS, MAX_PLAYERS, MAX_NAME, PLAYER_COLORS, GAME_REGISTRY, gameById,
} from './shared.js';
import { GAME_RENDERERS } from './games/index.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const store = {
  get(key, area = localStorage) { try { return JSON.parse(area.getItem(key)); } catch { return null; } },
  set(key, val, area = localStorage) { try { area.setItem(key, JSON.stringify(val)); } catch {} },
  del(key, area = localStorage) { try { area.removeItem(key); } catch {} },
};

const rid = () => Math.random().toString(36).slice(2, 10);
const newPid = () => (crypto.randomUUID ? crypto.randomUUID() : rid() + rid());

// S.clockOffset lets every screen show countdowns against the *server's*
// clock (serverNow, sent with every state message) rather than trusting the
// device's own clock, which can be skewed or just drift during a long tab
// visibility pause - see DECISIONS.md.
const S = {
  net: null, code: null, pid: null, st: null, screen: null, everOpen: false,
  connTimer: 0, flashTimer: 0, clockOffset: 0, activeGameId: null, activeRenderer: null,
};
const nowMs = () => Date.now() + S.clockOffset;

const SCREENS = ['home', 'create', 'join', 'room', 'leaderboard'];
function show(name) {
  S.screen = name;
  for (const s of SCREENS) $('scr-' + s).hidden = s !== name;
}

const ROOM_PANELS = ['lobby', 'intro', 'playing', 'result', 'matchover'];
function showRoomPanel(name) {
  for (const p of ROOM_PANELS) $('panel-' + p).hidden = p !== name;
}

// Wake the audio context on the very first tap anywhere - required by every
// mobile browser before any sound can play, and harmless to call repeatedly.
document.addEventListener('pointerdown', () => snd.unlockAudio(), { capture: true });

function refreshMute() {
  const m = snd.isMuted();
  for (const id of ['btn-mute-home', 'btn-mute-hud']) {
    const btn = $(id);
    if (!btn) continue;
    btn.setAttribute('aria-pressed', m ? 'true' : 'false');
    btn.setAttribute('aria-label', m ? 'Unmute sounds' : 'Mute sounds');
    btn.innerHTML = `<svg width="18" height="18"><use href="#${m ? 'i-mute' : 'i-sound'}"/></svg>`;
  }
}
document.querySelectorAll('.btn-mute').forEach((b) => b.addEventListener('click', () => {
  snd.setMuted(!snd.isMuted()); refreshMute(); snd.play('tap');
}));
refreshMute();
initInvertToggle($('btn-a11y-home'), $('btn-a11y-hud'));

// ── Local stats (personal history only - never a global leaderboard) ───

function loadStats() { return store.get('play.stats') || { games: 0, wins: 0, players: [] }; }
function recordMatchResult(won, otherNames) {
  const s = loadStats();
  s.games += 1;
  if (won) s.wins += 1;
  for (const n of otherNames) if (n && !s.players.includes(n)) s.players.push(n);
  store.set('play.stats', s);
}
function renderStats() {
  const s = loadStats();
  $('stat-games').textContent = s.games;
  $('stat-players').textContent = s.players.length;
  $('stat-wins').textContent = s.wins;
}
renderStats();

// ── Home ─────────────────────────────────────────────────────────

document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { snd.play('tap'); show(b.dataset.go); }));
$('btn-create').addEventListener('click', () => { snd.play('tap'); show('create'); history.replaceState(null, '', '/create'); });
$('btn-join').addEventListener('click', () => { snd.play('tap'); show('join'); history.replaceState(null, '', '/join'); });

// ── High scores (shared across every game - see DECISIONS.md) ─────

function renderLeaderboardList(entries, listId) {
  const box = $(listId);
  box.replaceChildren();
  if (!entries || entries.length === 0) {
    box.innerHTML = '<p class="lb-empty">No high scores yet — be the first!</p>';
    return;
  }
  entries.forEach((e, i) => {
    const row = document.createElement('div');
    row.className = 'lb-row' + (i < 3 ? ' lb-top3' : '');
    row.innerHTML = `<span class="lb-rank">${i + 1}</span><span class="lb-name">${esc(e.name)}</span><span class="lb-score">${e.score}</span>`;
    box.append(row);
  });
}

async function loadLeaderboardPage() {
  const box = $('leaderboard-list');
  box.innerHTML = '<p class="lb-empty">Loading…</p>';
  try {
    const res = await fetch('/api/leaderboard');
    const { entries } = await res.json();
    renderLeaderboardList(entries, 'leaderboard-list');
  } catch {
    box.innerHTML = '<p class="lb-empty">Could not load the high scores right now.</p>';
  }
}

function goLeaderboard() {
  snd.play('tap');
  history.pushState(null, '', '/leaderboard');
  show('leaderboard');
  loadLeaderboardPage();
}
$('btn-leaderboard-home').addEventListener('click', goLeaderboard);
$('btn-leaderboard-back').addEventListener('click', () => { snd.play('tap'); history.replaceState(null, '', '/'); show('home'); });

function refreshRejoin() {
  const last = store.get('play.last');
  const btn = $('btn-rejoin');
  if (last?.code && last?.pid) {
    btn.hidden = false;
    btn.textContent = `Rejoin game ${last.code}`;
    btn.onclick = () => { snd.play('tap'); enter(last.code, last.pid, last.name, last.color); };
  } else {
    btn.hidden = true;
  }
}
refreshRejoin();

// ── Create ───────────────────────────────────────────────────────

let chosenColor = store.get('play.color') || null;
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
$('in-name-c').value = store.get('play.name') || '';

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
    store.set('play.name', name);
    store.set('play.color', chosenColor);
    enter(data.code, newPid(), name, chosenColor);
  } catch {
    $('create-err').textContent = "Couldn't create a game right now. Try again.";
    $('btn-create-go').disabled = false;
  }
});

// ── Join ─────────────────────────────────────────────────────────

$('in-name-j').value = store.get('play.name') || '';
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
    if (!data.exists) $('join-err').textContent = "We couldn't find that game. Check the code.";
    else if (data.started) $('join-err').textContent = 'That game has already started.';
    else if (data.full) $('join-err').textContent = 'That game is already full.';
    else {
      const sess = store.get('play.session', sessionStorage);
      const pid = (sess && sess.code === code) ? sess.pid : newPid();
      store.set('play.name', name);
      enter(code, pid, name, store.get('play.color') || null);
      return;
    }
  } catch {
    $('join-err').textContent = 'Connection problem. Try again.';
  }
  $('btn-join-go').disabled = false;
});

// ── Connecting ───────────────────────────────────────────────────

function enter(code, pid, name, color) {
  S.net?.stop();
  destroyActiveRenderer();
  S.code = code; S.pid = pid; S.everOpen = false; S.st = null;
  store.set('play.session', { code, pid, name }, sessionStorage);
  store.set('play.last', { code, pid, name, color, t: Date.now() });
  history.replaceState(null, '', '/room/' + code);
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
  destroyActiveRenderer();
  if (forget) store.del('play.session', sessionStorage);
  history.replaceState(null, '', '/');
  $('ov-conn').hidden = true;
  $('ov-confirm').hidden = true;
  $('banner').hidden = true;
  $('btn-create-go').disabled = false;
  $('btn-join-go').disabled = false;
  refreshRejoin();
  renderStats();
  show('home');
  if (message) flashBanner(message);
}
$('btn-conn-home').addEventListener('click', () => goHome());

function leaveGame() {
  S.net?.send({ type: 'leave' });
  store.del('play.session', sessionStorage);
  setTimeout(() => goHome('', true), 120);
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

// ── Messages ─────────────────────────────────────────────────────

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

// ── State → screens ──────────────────────────────────────────────

const player = (seat) => S.st?.players.find((p) => p.seat === seat);
const nameOf = (seat) => player(seat)?.name || 'Someone';
function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

function destroyActiveRenderer() {
  S.activeRenderer?.destroy?.();
  S.activeRenderer = null;
  S.activeGameId = null;
  $('game-mount').replaceChildren();
}

function applyState(st) {
  const prev = S.st;
  S.clockOffset = st.serverNow - Date.now();
  S.st = st;

  if (S.screen !== 'room') show('room');
  $('hud-code').textContent = st.code;

  if (st.status === 'lobby') {
    destroyActiveRenderer();
    showRoomPanel('lobby');
    $('room-hud').hidden = true;
    renderLobby();
    return;
  }

  $('room-hud').hidden = false;
  $('hud-round').textContent = `ROUND ${st.round} / ${st.matchLength}`;
  renderPlayerStrip();

  if (st.status === 'intro') {
    destroyActiveRenderer();
    if (prev?.status !== 'intro') snd.play('transition');
    showRoomPanel('intro');
    renderIntro();
    return;
  }

  if (st.status === 'playing') {
    showRoomPanel('playing');
    mountActiveGame();
    S.activeRenderer?.update(st.gameState, nowMs());
    return;
  }

  if (st.status === 'result') {
    destroyActiveRenderer();
    if (prev?.status !== 'result') snd.play('score');
    showRoomPanel('result');
    renderResult();
    return;
  }

  if (st.status === 'matchover') {
    if (prev?.status !== 'matchover') {
      const won = (st.finalWinners || []).includes(st.you);
      snd.play(won ? 'victory' : 'transition');
      const others = st.players.filter((p) => p.seat !== st.you).map((p) => p.name);
      recordMatchResult(won, others);
      renderStats();
    }
    showRoomPanel('matchover');
    renderMatchover();
  }
}

// ── Lobby ────────────────────────────────────────────────────────

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
      <span class="ready-pill${p.ready ? ' on' : ''}">${p.ready ? 'READY' : 'NOT READY'}</span>
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
  const me = player(st.you);
  $('lobby-status').textContent = !enough
    ? 'Waiting for more players to join…'
    : me?.ready ? 'Waiting for everyone to be ready…' : 'Hit ready when you are!';
  const btn = $('btn-ready');
  btn.classList.toggle('on', !!me?.ready);
  btn.textContent = me?.ready ? "I'M READY ✓" : "I'M READY";
}
$('btn-ready').addEventListener('click', () => {
  snd.play('tap');
  const me = player(S.st.you);
  S.net?.send({ type: 'ready', ready: !me?.ready });
});
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
    navigator.share({ title: 'Play', text: `Join my game! Code: ${S.st.code}`, url: `${location.origin}/room/${S.st.code}` }).catch(() => {});
  });
}

// ── Player strip (persistent scoreboard, shown intro/playing/result) ──

function renderPlayerStrip() {
  const st = S.st;
  const strip = $('player-strip');
  strip.replaceChildren();
  const order = [...st.players].sort((a, b) => b.score - a.score);
  order.forEach((p) => {
    const el = document.createElement('div');
    el.className = 'strip-item' + (p.seat === st.you ? ' you' : '');
    el.innerHTML = `
      <span class="avatar" style="background:${p.color}">${initials(p.name)}</span>
      <span class="sinfo">
        <span class="sname${p.connected ? '' : ' away'}">${esc(p.name)}${!p.connected ? ' (away)' : ''}</span>
        <span class="stotal">${p.score}</span>
      </span>`;
    strip.append(el);
  });
}

// ── Intro ("NEXT GAME" beat) ─────────────────────────────────────

function renderIntro() {
  const st = S.st;
  const g = gameById(st.currentGameId);
  $('intro-game-name').textContent = g?.name || '???';
  $('intro-round').textContent = `GAME ${st.round}`;
  tickIntroCountdown();
}
let introRaf = 0;
function tickIntroCountdown() {
  cancelAnimationFrame(introRaf);
  const step = () => {
    if (S.st?.status !== 'intro' || S.st.deadlineAt == null) return;
    const remain = Math.max(0, S.st.deadlineAt - nowMs());
    $('intro-count').textContent = remain <= 0 ? 'GO!' : String(Math.ceil(remain / 1000));
    if (remain > 0) introRaf = requestAnimationFrame(step);
  };
  step();
}

// ── Active mini-game mount ────────────────────────────────────────

function mountActiveGame() {
  const st = S.st;
  if (S.activeGameId === st.currentGameId && S.activeRenderer) return;
  destroyActiveRenderer();
  const mod = GAME_RENDERERS[st.currentGameId];
  if (!mod) return;
  S.activeGameId = st.currentGameId;
  const ctx = {
    you: st.you,
    players: st.players,
    reducedMotion,
    now: nowMs,
    sound: snd,
    send: (payload) => S.net?.send({ type: 'gameAction', payload }),
  };
  S.activeRenderer = mod.mount($('game-mount'), ctx);
}

// ── Result ("ROUND COMPLETE") ─────────────────────────────────────

function renderResult() {
  const st = S.st;
  const r = st.lastResult;
  if (!r) return;
  const winners = r.tiers[0] || [];
  const g = gameById(r.gameId);
  $('result-game-name').textContent = g?.name || '';
  $('result-winner').textContent = winners.map((s) => nameOf(s)).join(' & ') || '—';
  $('result-note').textContent = winners.length === st.players.length ? 'Everyone survived!' : `Everyone else ${r.note}.`;
  const myPoints = r.points?.[st.you] ?? 0;
  $('result-points').textContent = myPoints > 0 ? `+${myPoints} POINTS` : '+0 POINTS';
  $('result-points').classList.toggle('zero', myPoints <= 0);

  const box = $('result-scores');
  box.replaceChildren();
  [...st.players].sort((a, b) => b.score - a.score).forEach((p) => {
    const row = document.createElement('div');
    const gained = r.points?.[p.seat] ?? 0;
    row.className = 'result-score-row' + (winners.includes(p.seat) ? ' winner' : '');
    row.innerHTML = `
      <span class="n"><span class="avatar" style="background:${p.color}">${initials(p.name)}</span>${esc(p.name)}</span>
      <span class="gain">${gained > 0 ? '+' + gained : ''}</span>
      <span class="v">${p.score}</span>`;
    box.append(row);
  });
}

// ── Match over ─────────────────────────────────────────────────────

function renderMatchover() {
  const st = S.st;
  const winners = st.finalWinners || [];
  const sorted = [...st.players].sort((a, b) => b.score - a.score);
  $('over-winner').textContent = winners.map((s) => nameOf(s)).join(' & ') || '—';
  $('over-points').textContent = `${sorted[0]?.score ?? 0} points`;
  $('over-trophy').classList.toggle('you-won', winners.includes(st.you));
  const box = $('over-scores');
  box.replaceChildren();
  sorted.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'over-score-row' + (winners.includes(p.seat) ? ' winner' : '');
    row.innerHTML = `
      <span class="n"><span class="avatar" style="background:${p.color}">${initials(p.name)}</span>${esc(p.name)}${p.seat === st.you ? ' (you)' : ''}</span>
      <span class="v">${p.score} pts · ${p.wins} won</span>`;
    box.append(row);
  });

  // The server has already decided who qualifies (see refreshLeaderboard()
  // in match-room.js) - the client only ever offers the name field, never
  // decides for itself whether a score is good enough.
  const iQualify = (st.highScoreCandidates || []).includes(st.you);
  $('hs-form').hidden = !iQualify;
  if (iQualify && !$('hs-name-input').value) $('hs-name-input').value = store.get('play.name') || '';
  renderLeaderboardList(st.leaderboardTop, 'over-leaderboard-list');
}
$('btn-again').addEventListener('click', () => { snd.play('tap'); S.net?.send({ type: 'again' }); });
$('btn-over-leave').addEventListener('click', () => confirmBox('Leave this game?', leaveGame));

$('hs-name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-hs-submit').click(); });
$('btn-hs-submit').addEventListener('click', () => {
  const name = $('hs-name-input').value.trim();
  if (!name) return;
  store.set('play.name', name);
  S.net?.send({ type: 'submitHighScore', name });
  snd.play('score');
  $('hs-form').hidden = true; // optimistic - the next state confirms either way
});

// ── Boot / routing ───────────────────────────────────────────────
// Clean routes: / , /create , /join , /room/CODE (see README).

function boot() {
  const m = /^\/room\/([A-Za-z0-9]+)/i.exec(location.pathname);
  const sess = store.get('play.session', sessionStorage);
  if (location.pathname === '/leaderboard') { show('leaderboard'); loadLeaderboardPage(); return; }
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

// Debug hook for the browser test harness (mirrors Draw Together/Blackjack/Roll).
window.__play = { S };
