import { Board, replay, drawPatternSwatch } from './board.js';
import { Net } from './net.js';
import * as snd from './sound.js';
import { initInvertToggle } from './a11y.js';
import {
  TOOLS, SIZE_NAMES, PALETTE, CATEGORIES, TIMER_OPTIONS, ROUND_OPTIONS, MAX_POINTS_PER_MSG,
  PLAYER_COLORS, WORD_CHOICES, REACTIONS,
} from './shared.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const newPid = () => (crypto.randomUUID ? crypto.randomUUID() : rid() + rid());
const store = {
  get(k, s = localStorage) { try { return JSON.parse(s.getItem(k)); } catch { return null; } },
  set(k, v, s = localStorage) { try { s.setItem(k, JSON.stringify(v)); } catch {} },
  del(k, s = localStorage) { try { s.removeItem(k); } catch {} },
};

const S = {
  net: null,
  code: null,
  pid: null,
  st: null,
  clockOffset: 0,
  tool: 'pen',
  sizeIdx: { pen: 1, marker: 1, crayon: 1, dots: 1, rainbow: 1, pixel: 1, fill: 0, eraser: 0, neon: 1, spray: 1, stars: 1, hearts: 1 },
  color: '#000000',
  stroke: null,
  lastPen: 0,
  lastTickSec: null,
  replayStop: null,
  confirmYes: null,
  everOpen: false,
  trayMode: null,   // 'game' | 'studio': which tool set the tray was built for
  scribbleCount: 0, // how many pen-movement sound ticks played (test hook)
};

// ── Viewport (iOS keyboard, safe areas) ─────────────────────

function fitViewport() {
  const vv = window.visualViewport;
  const h = vv ? vv.height : window.innerHeight;
  document.documentElement.style.setProperty('--app-h', h + 'px');
  document.getElementById('app').style.top = (vv ? vv.offsetTop : 0) + 'px';
}
fitViewport();
window.visualViewport?.addEventListener('resize', fitViewport);
window.visualViewport?.addEventListener('scroll', fitViewport);
window.addEventListener('resize', fitViewport);
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
document.addEventListener('pointerdown', () => { snd.unlockAudio(); }, { capture: true });
document.addEventListener('keydown', () => { snd.unlockAudio(); }, { capture: true });

// A clear tap sound on any button/chip/swatch press, anywhere in the app -
// this is an accessibility game, so every interaction gets audible
// confirmation, not just the ones that already had a bespoke sound.
document.addEventListener('click', (e) => {
  if (e.target.closest('.btn, .chip, .swatch')) snd.play('tap');
}, { capture: true });

// ── Screens ─────────────────────────────────────────────────

const SCREENS = ['home', 'join', 'lobby', 'game', 'over'];
function show(name) {
  for (const s of SCREENS) $('scr-' + s).hidden = s !== name;
  S.screen = name;
  if (name !== 'game') { $('ov-choose').hidden = true; $('ov-reveal').hidden = true; }
}
document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => show(b.dataset.go)));

// ── Logo ────────────────────────────────────────────────────

(function logo() {
  const colors = ['#ff5fb0', '#3d7bff', '#1fcf8f', '#ff8a00', '#8a3ffc', '#16c6e8', '#e8202a'];
  let k = 0;
  $('logo').innerHTML = ['Draw', 'Together'].map((w) =>
    `<span class="w" aria-hidden="true">${[...w].map((ch) => {
      const c = colors[k % colors.length];
      const r = ((k * 37) % 9) - 4;
      const y = ((k * 53) % 7) - 3;
      k++;
      return `<span class="ch" style="--c:${c};--r:${r}deg;--y:${y}px">${ch}</span>`;
    }).join('')}</span>`).join('');
})();

// ── Home & join ─────────────────────────────────────────────

const nameIn = $('in-name'), nameIn2 = $('in-name2'), codeIn = $('in-code');
nameIn.value = nameIn2.value = localStorage.getItem('dt.name') || '';
for (const el of [nameIn, nameIn2]) {
  el.addEventListener('input', () => {
    const v = el.value;
    (el === nameIn ? nameIn2 : nameIn).value = v;
    try { localStorage.setItem('dt.name', v.trim()); } catch {}
  });
}
const myName = () => nameIn.value.trim().slice(0, 14);

function needName(errEl, input) {
  if (myName()) return false;
  errEl.textContent = 'Type your name first!';
  input.focus();
  input.classList.remove('shake'); void input.offsetWidth; input.classList.add('shake');
  return true;
}

function refreshRejoin() {
  const last = store.get('dt.last');
  const b = $('btn-rejoin');
  if (last && Date.now() - last.t < 6 * 3600e3) {
    b.hidden = false;
    b.textContent = `Rejoin game ${last.code}`;
  } else b.hidden = true;
}

$('btn-rejoin').addEventListener('click', () => {
  const last = store.get('dt.last');
  if (last) enter(last.code, last.pid);
});

async function createRoom(btn, studio) {
  $('home-err').textContent = '';
  if (needName($('home-err'), nameIn)) return;
  const b = btn;
  b.disabled = true;
  try {
    const res = await fetch('/api/rooms', { method: 'POST' });
    const data = await res.json();
    if (!res.ok || !data.code) throw new Error();
    S.wantStudio = studio;   // switch the new room's lobby to the studio once we're in it
    enter(data.code, newPid());
  } catch {
    $('home-err').textContent = "We couldn't start a game. Check your internet and try again.";
  } finally { b.disabled = false; }
}
$('btn-create').addEventListener('click', () => createRoom($('btn-create'), false));
$('btn-studio').addEventListener('click', () => createRoom($('btn-studio'), true));

$('btn-join').addEventListener('click', () => {
  $('home-err').textContent = '';
  $('join-err').textContent = '';
  show('join');
  setTimeout(() => codeIn.focus(), 50);
});

codeIn.addEventListener('input', () => {
  codeIn.value = codeIn.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  $('join-err').textContent = '';
});
codeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join-go').click(); });
nameIn2.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join-go').click(); });

$('btn-join-go').addEventListener('click', async () => {
  const err = $('join-err');
  err.textContent = '';
  const code = codeIn.value.trim().toUpperCase();
  if (code.length < 4) { err.textContent = 'The code has 4 or 5 letters and numbers.'; codeIn.focus(); return; }
  if (needName(err, nameIn2)) return;
  const b = $('btn-join-go');
  b.disabled = true;
  try {
    const res = await fetch('/api/rooms/' + encodeURIComponent(code));
    const data = await res.json();
    if (!data.exists) { err.textContent = "We couldn't find that game. Check the code and try again."; return; }
    const last = store.get('dt.last');
    const pid = last && last.code === code ? last.pid : newPid();
    if (data.full && !(last && last.code === code)) { err.textContent = 'That game is already full.'; return; }
    enter(code, pid);
  } catch {
    err.textContent = "We couldn't reach the game. Check your internet and try again.";
  } finally { b.disabled = false; }
});

// ── Connecting to a room ────────────────────────────────────

function enter(code, pid) {
  leaveNet();
  S.code = code; S.pid = pid; S.st = null; S.everOpen = false;
  store.set('dt.session', { code, pid }, sessionStorage);
  store.set('dt.last', { code, pid, t: Date.now() });
  history.replaceState(null, '', '#' + code);
  S.net = new Net({
    code, playerId: pid, name: myName(),
    onMessage, onStatus,
  });
  clearTimeout(S.connTimer);
  S.connTimer = setTimeout(() => { if (!S.st) $('ov-conn').hidden = false; }, 4000);
}

function leaveNet() {
  if (S.net) S.net.stop();
  S.net = null;
  S.stroke = null;
}

function goHome(message = '', forget = false) {
  leaveNet();
  S.st = null;
  store.del('dt.session', sessionStorage);
  if (forget) store.del('dt.last');
  history.replaceState(null, '', location.pathname);
  $('ov-conn').hidden = true;
  $('ov-confirm').hidden = true;
  $('banner').hidden = true;
  refreshRejoin();
  show('home');
  $('home-err').textContent = message;
}

function onStatus(s) {
  if (s === 'open') {
    S.everOpen = true;
    clearTimeout(S.connTimer);
    $('ov-conn').hidden = true;
    return;
  }
  if (s === 'lost') {
    if (S.stroke) { S.board.end(S.stroke.id); S.stroke = null; }
    S.doodle = null;
    if (S.everOpen) $('ov-conn').hidden = false;
    return;
  }
  if (s === 'notfound') {
    goHome("We couldn't find that game. Check the code and try again.", true);
    return;
  }
  if (s === 'full') {
    goHome('That game is already full.', false);
    return;
  }
  if (s === 'replaced') {
    goHome('This game was opened on another screen.', false);
  }
}

$('btn-conn-home').addEventListener('click', () => goHome());

// A guesser hears these as someone else's pen moves live, so drawing is
// audible as it happens, not just visible - throttled so a burst of
// strokePoints messages reads as a scribbling texture, not a buzz.
let lastScribbleAt = 0;
function scribbleTick() {
  const now = performance.now();
  if (now - lastScribbleAt < 130) return;
  lastScribbleAt = now;
  snd.play('scribble');
  S.scribbleCount++;
}

function onMessage(m) {
  switch (m.type) {
    case 'state': applyState(m); break;
    case 'board': S.board.load(m.ops, m.active); updateUndo(); break;
    case 'strokeStart': S.board.begin(m); scribbleTick(); break;
    case 'strokePoints': S.board.add(m.id, m.pts); scribbleTick(); break;
    case 'strokeEnd': S.board.end(m.id); updateUndo(); break;
    case 'studioOp':
      if (S.board.pending.has(m.op.id)) S.board.confirm(m.op.id); else S.board.remoteOp(m.op);
      updateUndo();
      break;
    case 'undo': S.board.confirm(m.id); S.board.undo(m.id); updateUndo(); break;
    case 'clear': S.board.clear(m.id); updateUndo(); break;
    case 'guess': addBubble(m.guess); snd.play(m.guess.verdict === 'close' ? 'close' : 'nope'); break;
    case 'doodleStart': addGhost(m.id, m.seat, m.pts); break;
    case 'doodlePoints': addGhostPoints(m.id, m.pts); break;
    case 'doodleEnd': endGhost(m.id); break;
    case 'react': addReactionBubble(m.seat, m.i); snd.play('pop'); break;
    case 'event':
      if (m.kind === 'joined') { snd.play('join'); }
      if (m.kind === 'back') { snd.play('join'); }
      if (m.kind === 'left') { flashBanner(`${m.name} left the game.`); }
      if (m.kind === 'saved') { snd.play('pop'); flashBanner(`${m.name} saved the drawing to the gallery 🖼️`); }
      if (m.kind === 'autoUnlock') { S.autoUnlockedAt = performance.now(); snd.play('ding'); flashBanner('🔔 Ding! Time is up - everyone can guess now'); }
      break;
  }
}

// ── State → screens ─────────────────────────────────────────

const player = (seat) => S.st?.players.find((p) => p.seat === seat);
const nameOf = (seat) => player(seat)?.name || 'Your buddy';
const colorOf = (seat) => {
  const i = S.st ? S.st.players.findIndex((p) => p.seat === seat) : 0;
  return PLAYER_COLORS[Math.max(0, i) % PLAYER_COLORS.length];
};
const amDrawer = () => S.st && S.st.you === S.st.drawerSeat;

function applyState(st) {
  const prev = S.st;
  S.st = st;
  S.clockOffset = st.serverNow - Date.now();
  const phaseChanged = !prev || prev.phase !== st.phase || prev.round !== st.round;

  if (phaseChanged) {
    if (st.phase === 'choosing') snd.play('start');
    if (st.phase === 'reveal' && prev) snd.play(st.result?.reason === 'correct' ? 'win' : 'timeup');
    if (st.phase === 'over' && prev) snd.play('over');
    if (st.phase === 'reveal' && st.result?.reason === 'correct' && prev) confetti();
    if (prev && prev.players.length < st.players.length && st.phase === 'lobby') snd.play('join');
    // running under it forever; the next round starting brings it back.
  }
  // Guessing opening mid-round (lockGuesses) doesn't change phase or round,
  // so it needs its own transition check alongside the one above.
  if (prev?.phase === 'drawing' && st.phase === 'drawing' && prev.guessesLocked && !st.guessesLocked) {
    if (!(S.autoUnlockedAt && performance.now() - S.autoUnlockedAt < 2000)) snd.play('start');   // the bell already said it
  }

  if (S.wantStudio && st.phase === 'lobby' && st.you === st.host) {
    S.wantStudio = false;
    if (st.settings.mode !== 'studio') sendSettings({ mode: 'studio' });
  }

  if (st.phase === 'lobby') { show('lobby'); renderLobby(); }
  else if (st.phase === 'over') { show('over'); renderOver(); }
  else { if (S.screen !== 'game') show('game'); renderGame(prev, phaseChanged); }

  renderAwayBanner();
}

function renderAwayBanner() {
  const st = S.st;
  const b = $('banner');
  if (!st || st.phase === 'lobby') { if (!b.dataset.flash) b.hidden = true; return; }
  const away = st.players.filter((p) => !p.connected && p.seat !== st.you);
  if (away.length) {
    b.hidden = false;
    b.dataset.away = '1';
    const who = away.length === 1
      ? away[0].name
      : away.length === 2
        ? `${away[0].name} and ${away[1].name}`
        : `${away[0].name} and ${away.length - 1} others`;
    b.textContent = `${who} disconnected. Waiting for ${away.length === 1 ? 'them' : 'everyone'} to come back…`;
  } else if (b.dataset.away) {
    delete b.dataset.away;
    if (!b.dataset.flash) b.hidden = true;
  }
}

function flashBanner(text) {
  const b = $('banner');
  b.hidden = false;
  b.textContent = text;
  b.dataset.flash = '1';
  clearTimeout(S.flashTimer);
  S.flashTimer = setTimeout(() => { delete b.dataset.flash; b.hidden = true; renderAwayBanner(); }, 3500);
}

// ── Lobby ───────────────────────────────────────────────────

function renderLobby() {
  const st = S.st;
  const isHost = st.you === st.host;
  $('lobby-code').textContent = st.code;
  const studio = st.settings.mode === 'studio';
  const two = st.players.length >= 2;
  const host = player(st.host);
  $('lobby-status').textContent = studio
    ? (isHost ? 'Open the studio whenever you like - friends can hop in any time with the code!'
      : `Waiting for ${host?.name || 'the host'} to open the studio…`)
    : !two
      ? 'Waiting for your drawing buddy…'
      : isHost ? 'Ready when you are!' : `Waiting for ${host?.name || 'the host'} to start…`;

  const slots = [];
  st.players.forEach((p) => {
    slots.push(`<li><span class="dot" style="--pc:${colorOf(p.seat)}"></span>${esc(p.name)}
      <span class="who">${p.seat === st.you ? 'you' : p.connected ? '' : 'away'}</span></li>`);
  });
  if (!two) slots.push('<li class="empty">Tell them the code above ✏️</li>');
  $('lobby-players').innerHTML = slots.join('');

  renderSettings(isHost);
  $('btn-start').hidden = !(isHost && (two || studio));
  $('btn-start').textContent = studio ? 'Open the studio 🎨' : 'Start game';
}

function chip(label, pressed, onClick, disabled) {
  const b = document.createElement('button');
  b.className = 'chip';
  b.type = 'button';
  b.textContent = label;
  b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
  b.disabled = disabled;
  b.addEventListener('click', onClick);
  return b;
}

function sendSettings(patch) {
  S.net?.send({ type: 'settings', settings: { ...S.st.settings, ...patch } });
}

function renderSettings(isHost) {
  const s = S.st.settings;
  $('settings').classList.toggle('readonly', !isHost);
  $('settings').classList.toggle('studio', s.mode === 'studio');
  const md = $('set-mode'); md.replaceChildren();
  for (const [id, label] of [['game', 'Guessing game'], ['studio', 'Free-draw studio 🎨']]) {
    md.append(chip(label, s.mode === id, () => sendSettings({ mode: id }), !isHost));
  }
  const sh = $('set-shape'); sh.replaceChildren();
  for (const [id, label] of [['square', 'Square'], ['wide', 'Wide'], ['tall', 'Tall']]) {
    sh.append(chip(label, s.shape === id, () => sendSettings({ shape: id }), !isHost));
  }
  const cats = $('set-cats'); cats.replaceChildren();
  for (const c of CATEGORIES) {
    const on = s.categories.includes(c.id);
    cats.append(chip(`${c.emoji} ${c.label}`, on, () => {
      let next;
      if (c.id === 'everything') next = ['everything'];
      else {
        const cur = s.categories.filter((x) => x !== 'everything');
        next = on ? cur.filter((x) => x !== c.id) : [...cur, c.id];
        if (!next.length) next = ['everything'];
      }
      sendSettings({ categories: next });
    }, !isHost));
  }
  const diff = $('set-diff'); diff.replaceChildren();
  for (const [id, label] of [['easy', 'Easy'], ['mixed', 'Mixed'], ['silly', 'Silly'], ['hard', 'Hard 🔥'], ['chaos', 'Chaos 🌀']]) {
    diff.append(chip(label, s.difficulty === id, () => sendSettings({ difficulty: id }), !isHost));
  }
  const tm = $('set-timer'); tm.replaceChildren();
  for (const t of TIMER_OPTIONS) {
    tm.append(chip(t ? `${t}s` : 'No timer', s.timer === t, () => sendSettings({ timer: t }), !isHost));
  }
  const lk = $('set-lock'); lk.replaceChildren();
  for (const [v, label] of [[false, 'Right away'], [true, 'Let the drawer finish first']]) {
    lk.append(chip(label, !!s.lockGuesses === v, () => sendSettings({ lockGuesses: v }), !isHost));
  }
  const em = $('set-emoji'); em.replaceChildren();
  for (const [v, label] of [[false, 'Off'], [true, 'On (drawer only) 🖍️']]) {
    em.append(chip(label, !!s.emojiGuide === v, () => sendSettings({ emojiGuide: v }), !isHost));
  }
  const rd = $('set-rounds'); rd.replaceChildren();
  for (const r of ROUND_OPTIONS) {
    rd.append(chip(String(r), s.rounds === r, () => sendSettings({ rounds: r }), !isHost));
  }
}

$('btn-start').addEventListener('click', () => S.net?.send({ type: 'start' }));
$('btn-lobby-leave').addEventListener('click', () => confirmBox('Leave this game?', leaveGame));

function leaveGame() {
  S.net?.send({ type: 'leave' });
  setTimeout(() => goHome('', true), 120);
}

// ── Game ────────────────────────────────────────────────────

const gameEl = $('scr-game');
S.board = new Board($('board-host'), {
  onLayout: () => { ghostCanvas.width = S.board.base.width; ghostCanvas.height = S.board.base.height; sketchCanvas.width = S.board.base.width; sketchCanvas.height = S.board.base.height; drawSketch(); },
});

// ── Emoji tracing guide (opt-in lobby setting) ────────────────
//
// A faint outline of the word's own emoji, for the drawer to trace over -
// nothing to keep secret here that isn't already secret: `st.word` (the
// only place `.e` comes from) is already only ever sent to the drawer's
// own socket (see game-room.js's view()), so a guesser's client simply
// never has an emoji to show. Sits *below* the real ink (first child of
// `.sheet`, drawn before `.base`/`.live`), like tracing paper, so drawn-over
// areas cover the guide instead of the guide sitting on top of the art.
const traceEl = document.createElement('div');
traceEl.className = 'layer trace';
traceEl.setAttribute('aria-hidden', 'true');
traceEl.hidden = true;
S.board.sheet.prepend(traceEl);

// ── Ghost doodles: guessers gesturing on the drawing ─────────
//
// Never touches S.board's ops - not a real stroke, never persisted, never
// undoable, never in the gallery. Lives on its own canvas layered on top of
// the real drawing (see `.layer.ghost` in styles.css), faded and driven
// entirely by relayed server messages (see onMessage below) rather than
// drawn locally first, so every viewer - including the person doodling -
// sees the exact same thing at the exact same time.
const ghostCanvas = document.createElement('canvas');
ghostCanvas.className = 'layer ghost';
ghostCanvas.setAttribute('aria-hidden', 'true');
S.board.sheet.append(ghostCanvas);
const gctx = ghostCanvas.getContext('2d');

// ── Scratchpad: guessers doodle for themselves while the drawer picks ──
//
// Local only: nothing is sent, nothing is saved, and it is wiped the moment
// the round starts (see renderGame). Its own layer above the real ink.
const sketchCanvas = document.createElement('canvas');
sketchCanvas.className = 'layer sketch';
sketchCanvas.setAttribute('aria-hidden', 'true');
S.board.sheet.append(sketchCanvas);
const sctx = sketchCanvas.getContext('2d');
const sketchNote = document.createElement('div');
sketchNote.className = 'sketch-note';
sketchNote.hidden = true;
sketchNote.innerHTML = '<span>✏️ Scratchpad - just for you, gone when the round starts</span><button class="btn small ghost" id="btn-sketch-clear" type="button">Clear</button>';
S.board.sheet.append(sketchNote);
sketchNote.querySelector('#btn-sketch-clear').addEventListener('click', () => { clearSketch(); snd.play('pop'); });
const sketchStrokes = [];   // [{ pts }] in board coordinates
function drawSketch() {
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.clearRect(0, 0, sketchCanvas.width, sketchCanvas.height);
  sctx.save();
  sctx.setTransform(S.board.scale, 0, 0, S.board.scale, 0, 0);
  sctx.strokeStyle = sctx.fillStyle = colorOf(S.st?.you ?? 0);
  sctx.lineCap = 'round'; sctx.lineJoin = 'round'; sctx.lineWidth = 14;
  for (const st of sketchStrokes) {
    const p = S.board.unitPoints(st.pts);
    const n = p.length / 2;
    if (n === 1) { sctx.beginPath(); sctx.arc(p[0], p[1], 7, 0, Math.PI * 2); sctx.fill(); continue; }
    sctx.beginPath(); sctx.moveTo(p[0], p[1]);
    for (let i = 1; i < n; i++) sctx.lineTo(p[i * 2], p[i * 2 + 1]);
    sctx.stroke();
  }
  sctx.restore();
}
function clearSketch() {
  sketchStrokes.length = 0;
  S.sketch = null;
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.clearRect(0, 0, sketchCanvas.width, sketchCanvas.height);
}
const hasSketch = () => sketchStrokes.length > 0;

const ghosts = new Map(); // stroke id -> { seat, pts, ended, lastAt, endAt }
const GHOST_LINGER_MS = 10000; // how long a finished mark hangs around before fading
const GHOST_FADE_MS = 300;     // fade-out duration once it starts vanishing
const GHOST_STALL_MS = 1500;   // auto-end a mark that never got an explicit end (dropped message, disconnect)
const GHOST_ALPHA = 0.6;       // always fainter than real ink, so it can't compete with it
let ghostRaf = 0;

function addGhost(id, seat, pts) {
  ghosts.set(id, { seat, pts: pts.slice(), ended: false, lastAt: performance.now(), endAt: 0 });
  if (!ghostRaf) ghostRaf = requestAnimationFrame(tickGhosts);
}
function addGhostPoints(id, pts) {
  const g = ghosts.get(id);
  if (!g) return;
  for (const v of pts) g.pts.push(v);
  g.lastAt = performance.now();
}
function endGhost(id) {
  const g = ghosts.get(id);
  if (!g || g.ended) return;
  g.ended = true;
  g.endAt = performance.now();
}
function clearGhosts() {
  ghosts.clear();
  gctx.clearRect(0, 0, ghostCanvas.width, ghostCanvas.height);
}
function tickGhosts() {
  gctx.setTransform(1, 0, 0, 1, 0, 0);
  gctx.clearRect(0, 0, ghostCanvas.width, ghostCanvas.height);
  const now = performance.now();
  for (const [id, g] of ghosts) {
    if (!g.ended && now - g.lastAt > GHOST_STALL_MS) { g.ended = true; g.endAt = now; }
    let alpha = 1;
    if (g.ended) {
      const age = now - g.endAt;
      if (age > GHOST_LINGER_MS + GHOST_FADE_MS) { ghosts.delete(id); continue; }
      if (age > GHOST_LINGER_MS) alpha = 1 - (age - GHOST_LINGER_MS) / GHOST_FADE_MS;
    }
    drawGhostStroke(g, alpha);
  }
  if (ghosts.size) requestAnimationFrame(tickGhosts);
  else ghostRaf = 0;
}
function drawGhostStroke(g, alpha) {
  const p = S.board.unitPoints(g.pts);
  const n = p.length / 2;
  if (!n) return;
  gctx.save();
  gctx.setTransform(S.board.scale, 0, 0, S.board.scale, 0, 0);
  gctx.globalAlpha = alpha * GHOST_ALPHA;
  gctx.strokeStyle = gctx.fillStyle = colorOf(g.seat);
  gctx.lineCap = 'round';
  gctx.lineJoin = 'round';
  gctx.lineWidth = 16;
  if (n === 1) {
    gctx.beginPath(); gctx.arc(p[0], p[1], 8, 0, Math.PI * 2); gctx.fill();
  } else {
    gctx.beginPath();
    gctx.moveTo(p[0], p[1]);
    for (let i = 1; i < n; i++) gctx.lineTo(p[i * 2], p[i * 2 + 1]);
    gctx.stroke();
  }
  gctx.restore();
}

// Shrink the HUD text until it fits in two lines, never cutting the word off.
function fitHud(el) {
  if (!el) return;
  el.style.fontSize = '';
  requestAnimationFrame(() => {
    const lh = parseFloat(getComputedStyle(el).lineHeight) || el.offsetHeight;
    let size = 1, guard = 12;
    while (guard-- > 0 && (el.scrollWidth > el.clientWidth + 1 || el.offsetHeight > lh * 2.2)) {
      size -= 0.07;
      el.style.fontSize = size + 'em';
    }
  });
}

// The studio screen: the same board and tray as the game, but everyone is a
// drawer, so there is no word, timer, guess box or turn to show.
function renderStudio() {
  const st = S.st;
  syncTrayMode('studio');
  gameEl.classList.add('drawer', 'studio');
  gameEl.classList.remove('guesser', 'blocked');
  $('tray').hidden = false;
  $('guessbar').hidden = true;
  $('word-hint').hidden = true;
  $('ov-choose').hidden = true;
  $('ov-reveal').hidden = true;
  $('reactions').hidden = true;
  traceEl.hidden = true;
  $('btn-save').hidden = false;
  $('btn-hud-gallery').hidden = false;
  $('hud-round').innerHTML = 'Studio<b>🎨</b>';
  $('hud-round').setAttribute('aria-label', 'Free-draw studio');
  const main = $('hud-main');
  const here = st.players.filter((p) => p.connected).map((p) => p.name);
  main.innerHTML = `<span class="who">${esc(here.join(' · '))}</span>`;
  fitHud(main.querySelector('.who'));
  const t = $('hud-timer'); t.textContent = ''; t.className = 'hud-timer';
  S.board.setAspect(st.aspect);
  updateUndo();
}

function syncTrayMode(mode) {
  if (S.trayMode === mode) return;
  S.trayMode = mode;
  if (mode === 'game' && TOOLS[S.tool].studio) S.tool = 'pen';
  buildTray();
}

function renderGame(prev, phaseChanged) {
  const st = S.st;
  if (st.phase === 'studio') { renderStudio(); return; }
  syncTrayMode('game');
  gameEl.classList.remove('studio');
  $('btn-save').hidden = true;
  $('btn-hud-gallery').hidden = true;
  const drawer = amDrawer();
  gameEl.classList.toggle('drawer', drawer);
  gameEl.classList.toggle('guesser', !drawer);
  gameEl.classList.toggle('blocked', !(drawer && st.phase === 'drawing'));
  const sketching = st.phase === 'choosing' && !drawer;
  gameEl.classList.toggle('sketching', sketching);
  sketchNote.hidden = !sketching;
  if (phaseChanged && !sketching) clearSketch();
  $('tray').hidden = !drawer;
  $('guessbar').hidden = drawer;

  $('hud-round').innerHTML = `Round<b>${st.round}</b>`;
  $('hud-round').setAttribute('aria-label', `Round ${st.round} of ${st.rounds}`);
  const main = $('hud-main');
  const waitingToGuess = st.phase === 'drawing' && st.guessesLocked;
  if (drawer && st.word) {
    main.innerHTML = `<span class="lbl">Draw:</span><span class="word">${esc(st.word.w)} ${st.word.e}</span>` +
      (waitingToGuess ? `<button class="btn small green" id="btn-unlock" type="button">Let people guess <span id="unlock-left" class="unlock-left"></span></button>` : '');
    fitHud(main.querySelector('.word'));
    $('btn-unlock')?.addEventListener('click', () => { snd.play('pop'); S.net?.send({ type: 'unlock' }); });
  } else if (!drawer && st.phase === 'choosing') {
    main.innerHTML = `<span class="lbl">Doodle while you wait!</span><span class="who">${esc(nameOf(st.drawerSeat))} is picking a word…</span>`;
    fitHud(main.querySelector('.who'));
  } else if (!drawer) {
    main.innerHTML = waitingToGuess
      ? `<span class="lbl">Hang tight!</span><span class="who">${esc(nameOf(st.drawerSeat))} is finishing up… <span id="unlock-left" class="unlock-left"></span></span>`
      : `<span class="lbl">Guess it!</span><span class="who">${esc(nameOf(st.drawerSeat))} is drawing…</span>`;
    fitHud(main.querySelector('.who'));
  } else {
    main.innerHTML = '';
  }

  const hint = $('word-hint');
  if (!drawer && st.phase === 'drawing' && st.wordShape) {
    hint.hidden = false;
    const words = st.wordShape.length === 1 ? '1 word' : `${st.wordShape.length} words`;
    hint.innerHTML = st.wordShape.map((n) => `<span class="wlen">${n}</span>`).join('<span class="gap"></span>');
    hint.setAttribute('aria-label', `${words}: ${st.wordShape.join(', ')} letters`);
  } else {
    hint.hidden = true;
    hint.innerHTML = '';
  }

  // Emoji tracing guide: drawer only, only while actually drawing (see
  // traceEl's creation above for why nothing here needs to check secrecy -
  // st.word is already null for anyone but the drawer).
  const showTrace = drawer && st.phase === 'drawing' && st.settings?.emojiGuide && !!st.word?.e;
  traceEl.hidden = !showTrace;
  traceEl.textContent = showTrace ? st.word.e : '';

  // Board shape: the drawer's screen decides it when they press Ready.
  if (st.phase === 'choosing' && drawer) {
    requestAnimationFrame(() => S.board.setAspect(hostAspect()));
  } else if (st.phase !== 'choosing') {
    S.board.setAspect(st.aspect);
  }

  // Word card / waiting card
  const ch = $('ov-choose');
  if (st.phase === 'choosing') {
    ch.hidden = false;
    if (drawer) {
      const dots = Array.from({ length: WORD_CHOICES }, (_, i) =>
        `<span class="dot${i === st.choiceIdx ? ' on' : ''}"></span>`).join('');
      $('choose-body').innerHTML = `
        <p>Round ${st.round} · Your word is…</p>
        <div class="big-emoji" aria-hidden="true">${st.word.e}</div>
        <h2 class="big-word">${esc(st.word.w)}</h2>
        <button class="btn big green" id="btn-ready">Ready?</button>
        <button class="btn small ghost" id="btn-swap">Try another word</button>
        <div class="choice-dots" aria-hidden="true">${dots}</div>`;
      $('btn-ready').addEventListener('click', () => {
        S.net?.send({ type: 'ready', aspect: hostAspect() });
      });
      $('btn-swap').addEventListener('click', () => { snd.play('pop'); S.net?.send({ type: 'swap' }); });
    } else {
      ch.hidden = true;        // guessers get the board as a scratchpad instead of a card over it
    }
  } else ch.hidden = true;

  // Round results
  if (st.phase === 'reveal') renderReveal(phaseChanged);
  else { $('ov-reveal').hidden = true; S.replayStop?.(); S.replayStop = null; }

  if (phaseChanged && st.phase !== 'drawing') {
    $('feed').replaceChildren();
    $('in-guess').value = '';
    clearGhosts();
  }
  $('reactions').hidden = st.phase !== 'drawing';
  const justUnlocked = prev?.guessesLocked && !waitingToGuess && st.phase === 'drawing';
  if ((phaseChanged && st.phase === 'drawing' && !drawer && !waitingToGuess) || (justUnlocked && !drawer)) {
    // Focus the answer box without popping the keyboard over a phone screen.
    if (window.matchMedia('(pointer: fine)').matches) $('in-guess').focus();
  }
  $('in-guess').disabled = st.phase !== 'drawing' || waitingToGuess;
  $('in-guess').placeholder = waitingToGuess ? 'Wait for it…' : 'Your guess';
  $('btn-guess').disabled = st.phase !== 'drawing' || waitingToGuess;
  $('btn-giveup').disabled = st.phase !== 'drawing' || waitingToGuess;
  updateTimer();
  updateUndo();
}

function hostAspect() {
  const r = $('board-host').getBoundingClientRect();
  return r.width > 10 && r.height > 10 ? r.width / r.height : 1;
}

// ── Timer ───────────────────────────────────────────────────

function updateTimer() {
  const st = S.st;
  const el = $('hud-timer');
  if (!st || st.phase !== 'drawing' || !st.settings.timer) {
    el.textContent = ''; el.className = 'hud-timer'; S.lastTickSec = null; return;
  }
  const t = st.timer;
  if (!t.running) {
    el.textContent = '⏸';
    el.className = 'hud-timer paused';
    el.setAttribute('aria-label', 'Timer paused');
    return;
  }
  const left = Math.max(0, t.endsAt - (Date.now() + S.clockOffset));
  const sec = Math.ceil(left / 1000);
  el.textContent = sec;
  el.className = 'hud-timer' + (sec <= 10 ? ' low' : '');
  el.setAttribute('aria-label', `${sec} seconds left`);
  if (sec <= 10 && sec >= 1 && S.lastTickSec !== sec) snd.play('tick');
  S.lastTickSec = sec;
}
setInterval(updateTimer, 200);

// Guessing opens by itself a minute after the drawer starts (see the
// server's autoUnlockMs): show everyone how long that is.
function updateUnlockLeft() {
  const el = $('unlock-left');
  if (!el) return;
  const at = S.st?.unlockAt;
  if (!at) { el.textContent = ''; return; }
  const s = Math.max(0, Math.ceil((at - Date.now()) / 1000));
  el.textContent = `(${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')})`;
}
setInterval(updateUnlockLeft, 250);

// ── Drawing tools ───────────────────────────────────────────

const ICON = {
  pen: 'i-pen', marker: 'i-marker', crayon: 'i-crayon', dots: 'i-dots', rainbow: 'i-rainbow',
  pixel: 'i-pixel', fill: 'i-fill', eraser: 'i-eraser',
  neon: 'i-neon', spray: 'i-spray', stars: 'i-stars', hearts: 'i-hearts',
};
// The studio tray: all twelve tools, brushes first, in rows of four.
const STUDIO_ORDER = ['pen', 'marker', 'neon', 'crayon', 'spray', 'dots', 'stars', 'hearts', 'rainbow', 'pixel', 'fill', 'eraser'];

function buildTray() {
  const tools = $('tools');
  tools.replaceChildren();
  const ids = S.trayMode === 'studio' ? STUDIO_ORDER : Object.keys(TOOLS).filter((id) => !TOOLS[id].studio);
  for (const id of ids) {
    const t = TOOLS[id];
    const b = document.createElement('button');
    b.className = 'btn tool';
    b.type = 'button';
    b.dataset.tool = id;
    b.setAttribute('aria-label', t.label);
    b.innerHTML = `<svg aria-hidden="true"><use href="#${ICON[id]}"/></svg><span>${t.label}</span>`;
    b.addEventListener('click', () => { S.tool = id; renderTray(); });
    tools.append(b);
  }
  const colors = $('colors');
  colors.replaceChildren();
  for (const c of PALETTE) {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', c.name);
    b.dataset.color = c.hex;
    b.style.setProperty('--sw', c.hex);
    b.style.setProperty('--tick', ['White', 'Yellow', 'Cyan', 'Pink', 'Orange', 'Gray', 'Green'].includes(c.name) ? '#000' : '#fff');
    b.addEventListener('click', () => {
      S.color = c.hex;
      if (S.tool === 'eraser') S.tool = 'pen';
      renderTray();
    });
    colors.append(b);
  }
  renderTray();
}

function renderTray() {
  document.querySelectorAll('#tools .tool').forEach((b) =>
    b.setAttribute('aria-pressed', b.dataset.tool === S.tool ? 'true' : 'false'));
  $('tools').style.color = S.color === '#ffffff' ? '#ffffff' : S.color;
  document.querySelectorAll('#colors .swatch').forEach((b) =>
    b.setAttribute('aria-checked', S.tool !== 'eraser' && b.dataset.color === S.color ? 'true' : 'false'));
  $('tray').classList.toggle('erasing', S.tool === 'eraser');

  const sizes = $('sizes');
  sizes.replaceChildren();
  sizes.classList.toggle('patterns', S.tool === 'fill');
  if (S.tool === 'fill' && S.trayMode !== 'studio') {
    // No brush size to choose - say what the tool does instead.
    const hint = document.createElement('p');
    hint.className = 'fill-hint';
    hint.textContent = 'Tap inside a shape to fill it';
    sizes.append(hint);
    return;
  }
  const list = TOOLS[S.tool].sizes;
  list.forEach((sz, i) => {
    const b = document.createElement('button');
    b.className = 'btn';
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', S.sizeIdx[S.tool] === i ? 'true' : 'false');
    b.setAttribute('aria-label', SIZE_NAMES[S.tool][i]);
    if (S.tool === 'fill') {
      // In the studio a fill's "size" is its pattern.
      const cv = document.createElement('canvas');
      drawPatternSwatch(cv, sz, S.color === '#ffffff' ? '#bbbbbb' : S.color);
      cv.style.boxShadow = '0 0 0 2.5px #000';
      b.append(cv);
    } else {
      const px = [10, 18, 28][list.length === 2 ? i * 2 : i];
      const bg = S.tool === 'eraser' ? '#fff' : S.color === '#ffffff' ? '#fff' : S.color;
      b.innerHTML = `<span class="blob${S.tool === 'pixel' ? ' sq' : ''}" style="width:${px}px;height:${px}px;background:${bg};box-shadow:0 0 0 2.5px #000"></span>`;
    }
    b.addEventListener('click', () => { S.sizeIdx[S.tool] = i; renderTray(); });
    sizes.append(b);
  });
}

function updateUndo() {
  const st = S.st;
  const studio = st?.phase === 'studio';
  const canAct = studio || (st?.phase === 'drawing' && amDrawer());
  // In the studio you undo your own strokes only, so check for one of yours.
  const anything = studio ? S.board.ops.some((o) => o.seat === st.you) : S.board.ops.length > 0;
  $('btn-undo').disabled = !canAct || !anything;
  $('btn-clear').disabled = !canAct || !S.board.hasInk();
  $('btn-save').disabled = !studio || !S.board.hasInk();
}

$('btn-undo').addEventListener('click', () => {
  if (S.stroke) return;
  S.net?.send({ type: 'undo' });
});
$('btn-clear').addEventListener('click', () => {
  const studio = S.st?.phase === 'studio';
  confirmBox(studio ? 'Clear the canvas for everyone?' : 'Clear drawing?', () => S.net?.send({ type: 'clear', id: rid() }));
});
$('btn-save').addEventListener('click', () => S.net?.send({ type: 'save' }));

buildTray();

// ── Pointer input (finger, Apple Pencil, stylus, mouse) ─────

const sheet = S.board.sheet;
const canDraw = () => S.net?.isOpen && ((S.st?.phase === 'drawing' && amDrawer()) || S.st?.phase === 'studio');
// Anyone who ISN'T the drawer can doodle instead - a separate, ephemeral
// mark (see the ghost-doodle block above), never the real drawing.
const canDoodle = () => S.st?.phase === 'drawing' && !amDrawer() && S.net?.isOpen;
// ...and while the drawer is still choosing, a private scratchpad.
const canSketch = () => S.st?.phase === 'choosing' && !amDrawer();
const MIN_STEP = 10; // in 0..10000 board coordinates

sheet.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'pen') S.lastPen = performance.now();
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  // Palm rejection: ignore touches right after the pencil was used.
  if (e.pointerType === 'touch' && performance.now() - S.lastPen < 1500) return;
  if (canDraw() && !S.stroke) {
    e.preventDefault();
    try { sheet.setPointerCapture(e.pointerId); } catch {}
    const [x, y] = S.board.toBoard(e.clientX, e.clientY);
    const tool = S.tool;
    const size = TOOLS[tool].sizes[S.sizeIdx[tool]];
    const color = tool === 'eraser' ? '#ffffff' : S.color;
    const id = rid();
    if (tool === 'fill') {
      // A fill is just the tap: start and finish it together, nothing to drag.
      S.board.begin({ id, tool, color, size, pts: [x, y] });
      S.board.end(id);
      S.net.send({ type: 'strokeStart', id, tool, color, size, pts: [x, y] });
      S.net.send({ type: 'strokeEnd', id });
      if (S.st.phase === 'studio') S.board.markPending(id, { seat: S.st.you });
      updateUndo();
      return;
    }
    S.stroke = { id, pointerId: e.pointerId, lx: x, ly: y, pending: [], raf: 0 };
    S.board.begin({ id, tool, color, size, pts: [x, y] });
    S.net.send({ type: 'strokeStart', id, tool, color, size, pts: [x, y] });
  } else if (canDoodle() && !S.doodle) {
    e.preventDefault();
    try { sheet.setPointerCapture(e.pointerId); } catch {}
    const [x, y] = S.board.toBoard(e.clientX, e.clientY);
    const id = rid();
    S.doodle = { id, pointerId: e.pointerId, lx: x, ly: y, pending: [], raf: 0 };
    S.net.send({ type: 'doodleStart', id, pts: [x, y] });
  } else if (canSketch() && !S.sketch) {
    e.preventDefault();
    try { sheet.setPointerCapture(e.pointerId); } catch {}
    const [x, y] = S.board.toBoard(e.clientX, e.clientY);
    const st = { pts: [x, y] };
    sketchStrokes.push(st);
    S.sketch = { pointerId: e.pointerId, lx: x, ly: y, st };
    drawSketch();
  }
});
sheet.addEventListener('pointermove', (e) => {
  const k = S.sketch;
  if (!k || e.pointerId !== k.pointerId) return;
  e.preventDefault();
  const [x, y] = S.board.toBoard(e.clientX, e.clientY);
  if (Math.abs(x - k.lx) + Math.abs(y - k.ly) < MIN_STEP) return;
  k.lx = x; k.ly = y;
  k.st.pts.push(x, y);
  drawSketch();
});
for (const ev of ['pointerup', 'pointercancel']) sheet.addEventListener(ev, (e) => { if (S.sketch && e.pointerId === S.sketch.pointerId) S.sketch = null; });

sheet.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'pen') S.lastPen = performance.now();
  const s = S.stroke, d = S.doodle;
  const active = (s && e.pointerId === s.pointerId) ? s : (d && e.pointerId === d.pointerId) ? d : null;
  if (!active) return;
  e.preventDefault();
  let evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
  if (!evs.length) evs = [e];
  const add = [];
  for (const ev of evs) {
    const [x, y] = S.board.toBoard(ev.clientX, ev.clientY);
    if (Math.abs(x - active.lx) + Math.abs(y - active.ly) < MIN_STEP) continue;
    active.lx = x; active.ly = y;
    add.push(x, y);
  }
  if (!add.length) return;
  if (active === s) S.board.add(s.id, add);
  active.pending.push(...add);
  if (!active.raf) active.raf = requestAnimationFrame(() => flush(active));
});

function flush(s) {
  s.raf = 0;
  const type = s === S.stroke ? 'strokePoints' : 'doodlePoints';
  while (s.pending.length) {
    const chunk = s.pending.splice(0, MAX_POINTS_PER_MSG * 2);
    S.net?.send({ type, id: s.id, pts: chunk });
  }
}

function endStroke(e) {
  const s = S.stroke;
  if (s && (!e || e.pointerId === s.pointerId)) {
    if (e && e.type === 'pointerup') {
      const [x, y] = S.board.toBoard(e.clientX, e.clientY);
      if (x !== s.lx || y !== s.ly) { S.board.add(s.id, [x, y]); s.pending.push(x, y); }
    }
    cancelAnimationFrame(s.raf);
    flush(s);
    S.board.end(s.id);
    S.net?.send({ type: 'strokeEnd', id: s.id });
    if (S.st?.phase === 'studio') S.board.markPending(s.id, { seat: S.st.you });
    S.stroke = null;
    updateUndo();
    return;
  }
  const d = S.doodle;
  if (d && (!e || e.pointerId === d.pointerId)) {
    if (e && e.type === 'pointerup') {
      const [x, y] = S.board.toBoard(e.clientX, e.clientY);
      if (x !== d.lx || y !== d.ly) d.pending.push(x, y);
    }
    cancelAnimationFrame(d.raf);
    flush(d);
    S.net?.send({ type: 'doodleEnd', id: d.id });
    S.doodle = null;
  }
}
sheet.addEventListener('pointerup', endStroke);
sheet.addEventListener('pointercancel', endStroke);
sheet.addEventListener('lostpointercapture', endStroke);
// Stop iOS from scrolling / magnifying while drawing
sheet.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
sheet.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
sheet.addEventListener('contextmenu', (e) => e.preventDefault());

// ── Guessing ────────────────────────────────────────────────

$('guessbar').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('in-guess');
  const text = input.value.trim();
  if (!text || S.st?.phase !== 'drawing') return;
  S.net?.send({ type: 'guess', text });
  input.value = '';
});
$('btn-giveup').addEventListener('click', () => {
  confirmBox('Show the answer?', () => S.net?.send({ type: 'giveup' }));
});

function addBubble(g) {
  const feed = $('feed');
  const el = document.createElement('div');
  el.className = 'bubble' + (g.verdict === 'close' ? ' close' : '');
  const verdict = g.verdict === 'close' ? 'So close!' : g.verdict === 'correct' ? 'Yes!' : 'Nope!';
  el.innerHTML = `<span class="who" style="--pc:${colorOf(g.seat)}">${esc(nameOf(g.seat))}</span>${esc(g.text)}<span class="v">${verdict}</span>`;
  feed.append(el);
  while (feed.children.length > 3) feed.firstChild.remove();
  setTimeout(() => el.classList.add('fade'), 3200);
  setTimeout(() => el.remove(), 3900);
}

// ── Quick reactions ──────────────────────────────────────────

function buildReactions() {
  const box = $('reactions');
  REACTIONS.forEach((r, i) => {
    const b = document.createElement('button');
    b.className = 'btn';
    b.type = 'button';
    b.textContent = r.emoji;
    b.setAttribute('aria-label', r.text);
    b.addEventListener('click', () => sendReaction(i));
    box.append(b);
  });
}
buildReactions();

let lastReactAt = 0;
function sendReaction(i) {
  if (S.st?.phase !== 'drawing') return;
  const now = performance.now();
  if (now - lastReactAt < 550) return; // matches the server's own cooldown
  lastReactAt = now;
  S.net?.send({ type: 'react', i });
}

function addReactionBubble(seat, i) {
  const r = REACTIONS[i];
  if (!r) return;
  const feed = $('feed');
  const el = document.createElement('div');
  el.className = 'bubble reaction';
  el.innerHTML = `<span class="who" style="--pc:${colorOf(seat)}">${esc(nameOf(seat))}</span>${r.emoji} ${esc(r.text)}`;
  feed.append(el);
  while (feed.children.length > 3) feed.firstChild.remove();
  setTimeout(() => el.classList.add('fade'), 700);
  setTimeout(() => el.remove(), 950);
}

// ── Round results ───────────────────────────────────────────

let replayBoard = null;

function renderReveal(fresh) {
  const st = S.st;
  const r = st.result;
  if (!r) return;
  const ov = $('ov-reveal');
  const wasHidden = ov.hidden;
  ov.hidden = false;
  let head;
  if (r.reason === 'correct') {
    head = `<div class="confetti-line" aria-hidden="true">🎉🎉🎉</div>
      <h2>${esc(nameOf(r.winnerSeat))} got it!</h2>
      <div class="big-word">${esc(r.word)} ${r.emoji}</div>
      <div class="pts">+${r.points} points</div>`;
  } else {
    head = `<h2>${r.reason === 'timeout' ? "Time's up!" : 'The answer was…'}</h2>
      <p>${r.reason === 'timeout' ? 'It was…' : ''}</p>
      <div class="big-word">${esc(r.word)} ${r.emoji}</div>`;
  }
  $('reveal-head').innerHTML = head;
  $('reveal-scores').innerHTML = scoreCards();
  $('btn-next').textContent = st.round >= st.rounds ? 'See the scores' : 'Next round';

  if (!replayBoard) replayBoard = new Board($('replay-host'));
  replayBoard.setAspect(st.aspect);
  const hasInk = S.board.hasInk();
  $('btn-replay').hidden = !hasInk;
  if (fresh || wasHidden) {
    S.replayStop?.();
    replayBoard.reset();
    const ops = S.board.ops.slice();
    if (hasInk) {
      setTimeout(() => {
        replayBoard.layout();
        S.replayStop = replay(replayBoard, ops, 3000);
      }, 450);
    }
  }
}

$('btn-replay').addEventListener('click', () => {
  S.replayStop?.();
  S.replayStop = replay(replayBoard, S.board.ops.slice(), 3000);
});
$('btn-next').addEventListener('click', () => S.net?.send({ type: 'next' }));

function scoreCards() {
  return S.st.players.map((p) => `
    <div class="score" style="--pc:${colorOf(p.seat)}">
      <div class="n">${esc(p.name)}</div>
      <div class="v">${p.score}</div>
    </div>`).join('');
}

// ── Game over ───────────────────────────────────────────────

function renderOver() {
  const st = S.st;
  const n = st.drawings;
  $('over-cheer').textContent = `Amazing drawing! You made ${n} drawing${n === 1 ? '' : 's'} together!`;
  $('over-scores').innerHTML = scoreCards();
}
$('btn-again').addEventListener('click', () => S.net?.send({ type: 'again' }));
$('btn-newgame').addEventListener('click', () => S.net?.send({ type: 'lobby' }));
function openGallery() {
  const me = S.st.players.find((p) => p.seat === S.st.you);
  const params = new URLSearchParams({ code: S.st.code, you: S.st.you });
  if (me?.name) params.set('name', me.name);
  window.open(`gallery.html?${params}`, '_blank', 'noopener');
}
$('btn-gallery').addEventListener('click', openGallery);
$('btn-hud-gallery').addEventListener('click', openGallery);

// ── Header buttons ──────────────────────────────────────────

function renderMute() {
  const m = snd.isMuted();
  $('btn-mute').innerHTML = `<svg aria-hidden="true"><use href="#${m ? 'i-mute' : 'i-sound'}"/></svg>`;
  $('btn-mute').setAttribute('aria-label', m ? 'Turn sounds on' : 'Turn sounds off');
  $('btn-mute').setAttribute('aria-pressed', m ? 'true' : 'false');
}
$('btn-mute').addEventListener('click', () => { snd.setMuted(!snd.isMuted()); renderMute(); });

// Grid: square guide-lines over the sheet, for drawing to proportion. A CSS
// overlay only - never part of the drawing, never in the gallery. Remembered.
function setGrid(on) {
  gameEl.classList.toggle('grid', on);
  $('btn-grid').setAttribute('aria-pressed', String(on));
  $('btn-grid').setAttribute('aria-label', on ? 'Hide the grid' : 'Show a grid over the drawing');
  try { localStorage.setItem('dt.grid', on ? '1' : '0'); } catch {}
}
$('btn-grid').addEventListener('click', () => setGrid(!gameEl.classList.contains('grid')));
try { if (localStorage.getItem('dt.grid') === '1') setGrid(true); } catch {}
renderMute();
$('btn-quit').addEventListener('click', () => confirmBox('Leave the game?', leaveGame));
initInvertToggle($('btn-a11y-home'), $('btn-a11y-hud'));

// ── Confirm dialog ──────────────────────────────────────────

function confirmBox(question, onYes) {
  $('confirm-q').textContent = question;
  S.confirmYes = onYes;
  $('ov-confirm').hidden = false;
  $('btn-no').focus();
}
$('btn-yes').addEventListener('click', () => { $('ov-confirm').hidden = true; const f = S.confirmYes; S.confirmYes = null; f?.(); });
$('btn-no').addEventListener('click', () => { $('ov-confirm').hidden = true; S.confirmYes = null; });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('ov-confirm').hidden) $('btn-no').click();
});

// ── Confetti ────────────────────────────────────────────────

function confetti() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cv = $('fx');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
  const c = cv.getContext('2d');
  const cols = PALETTE.filter((p) => p.name !== 'White' && p.name !== 'Gray').map((p) => p.hex);
  const parts = Array.from({ length: 90 }, (_, i) => ({
    x: innerWidth / 2, y: innerHeight * 0.45,
    vx: (Math.random() - 0.5) * 16, vy: -6 - Math.random() * 12,
    r: 5 + Math.random() * 8, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
    col: cols[i % cols.length], shape: i % 3,
  }));
  const t0 = performance.now();
  const frame = (now) => {
    const t = now - t0;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.45; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.vx *= 0.99;
      c.save(); c.translate(p.x, p.y); c.rotate(p.rot);
      c.fillStyle = p.col; c.strokeStyle = '#000'; c.lineWidth = 2;
      c.beginPath();
      if (p.shape === 0) c.arc(0, 0, p.r, 0, Math.PI * 2);
      else if (p.shape === 1) c.rect(-p.r, -p.r / 2, p.r * 2, p.r);
      else star(c, p.r);
      c.fill(); c.stroke(); c.restore();
    }
    if (t < 1800) requestAnimationFrame(frame);
    else c.clearRect(0, 0, innerWidth, innerHeight);
  };
  requestAnimationFrame(frame);
}
function star(c, r) {
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r;
    i ? c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : c.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  c.closePath();
}

// ── Boot ────────────────────────────────────────────────────

(function boot() {
  const hash = location.hash.replace('#', '').toUpperCase();
  const sess = store.get('dt.session', sessionStorage);
  refreshRejoin();
  if (sess && (!hash || sess.code === hash)) { show('home'); enter(sess.code, sess.pid); return; }
  if (/^[A-Z]{3,4}[2-9]$/.test(hash)) {
    codeIn.value = hash;
    show('join');
    return;
  }
  show('home');
})();

// For automated tests only: read-only peek at local state.
window.__dt = { S, hasSketch, clearSketch };

window.addEventListener('resize', () => document.querySelectorAll('#hud-main .word, #hud-main .who').forEach(fitHud));
