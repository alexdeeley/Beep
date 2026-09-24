import { Board, replay } from './board.js';
import { Net } from './net.js';
import * as snd from './sound.js';
import {
  TOOLS, SIZE_NAMES, PALETTE, CATEGORIES, TIMER_OPTIONS, ROUND_OPTIONS, MAX_POINTS_PER_MSG,
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
  sizeIdx: { pen: 1, marker: 1, crayon: 1, dots: 1, rainbow: 1, eraser: 0 },
  color: '#000000',
  stroke: null,
  lastPen: 0,
  lastTickSec: null,
  replayStop: null,
  confirmYes: null,
  everOpen: false,
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
document.addEventListener('pointerdown', () => snd.unlockAudio(), { capture: true });
document.addEventListener('keydown', () => snd.unlockAudio(), { capture: true });

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

$('btn-create').addEventListener('click', async () => {
  $('home-err').textContent = '';
  if (needName($('home-err'), nameIn)) return;
  const b = $('btn-create');
  b.disabled = true;
  try {
    const res = await fetch('/api/rooms', { method: 'POST' });
    const data = await res.json();
    if (!res.ok || !data.code) throw new Error();
    enter(data.code, newPid());
  } catch {
    $('home-err').textContent = "We couldn't start a game. Check your internet and try again.";
  } finally { b.disabled = false; }
});

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
    if (data.full && !(last && last.code === code)) { err.textContent = 'That game already has two players.'; return; }
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
    if (S.everOpen) $('ov-conn').hidden = false;
    return;
  }
  if (s === 'notfound') {
    goHome("We couldn't find that game. Check the code and try again.", true);
    return;
  }
  if (s === 'full') {
    goHome('That game already has two players.', false);
    return;
  }
  if (s === 'replaced') {
    goHome('This game was opened on another screen.', false);
  }
}

$('btn-conn-home').addEventListener('click', () => goHome());

function onMessage(m) {
  switch (m.type) {
    case 'state': applyState(m); break;
    case 'board': S.board.load(m.ops, m.active); updateUndo(); break;
    case 'strokeStart': S.board.begin(m); break;
    case 'strokePoints': S.board.add(m.id, m.pts); break;
    case 'strokeEnd': S.board.end(m.id); updateUndo(); break;
    case 'undo': S.board.undo(m.id); updateUndo(); break;
    case 'clear': S.board.clear(m.id); updateUndo(); break;
    case 'guess': addBubble(m.guess); snd.play(m.guess.verdict === 'close' ? 'close' : 'nope'); break;
    case 'event':
      if (m.kind === 'joined') { snd.play('join'); }
      if (m.kind === 'back') { snd.play('join'); }
      if (m.kind === 'left') { flashBanner(`${m.name} left the game.`); }
      break;
  }
}

// ── State → screens ─────────────────────────────────────────

const player = (seat) => S.st?.players.find((p) => p.seat === seat);
const nameOf = (seat) => player(seat)?.name || 'Your buddy';
const colorOf = (seat) => {
  const i = S.st ? S.st.players.findIndex((p) => p.seat === seat) : 0;
  return i === 0 ? 'var(--p1)' : i === 1 ? 'var(--p2)' : '#8a3ffc';
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
    b.textContent = `${away[0].name} disconnected. Waiting for them to come back…`;
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
  const two = st.players.length >= 2;
  const host = player(st.host);
  $('lobby-status').textContent = !two
    ? 'Waiting for your drawing buddy…'
    : isHost ? 'Ready when you are!' : `Waiting for ${host?.name || 'the host'} to start…`;

  const slots = [];
  st.players.forEach((p, i) => {
    slots.push(`<li><span class="dot" style="--pc:${i ? 'var(--p2)' : 'var(--p1)'}"></span>${esc(p.name)}
      <span class="who">${p.seat === st.you ? 'you' : p.connected ? '' : 'away'}</span></li>`);
  });
  if (!two) slots.push('<li class="empty">Tell them the code above ✏️</li>');
  $('lobby-players').innerHTML = slots.join('');

  renderSettings(isHost);
  $('btn-start').hidden = !(isHost && two);
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
  for (const [id, label] of [['easy', 'Easy'], ['mixed', 'Mixed'], ['silly', 'Silly']]) {
    diff.append(chip(label, s.difficulty === id, () => sendSettings({ difficulty: id }), !isHost));
  }
  const tm = $('set-timer'); tm.replaceChildren();
  for (const t of TIMER_OPTIONS) {
    tm.append(chip(t ? `${t}s` : 'No timer', s.timer === t, () => sendSettings({ timer: t }), !isHost));
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
S.board = new Board($('board-host'), { onLayout: () => {} });

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

function renderGame(prev, phaseChanged) {
  const st = S.st;
  const drawer = amDrawer();
  gameEl.classList.toggle('drawer', drawer);
  gameEl.classList.toggle('guesser', !drawer);
  gameEl.classList.toggle('blocked', !(drawer && st.phase === 'drawing'));
  $('tray').hidden = !drawer;
  $('guessbar').hidden = drawer;

  $('hud-round').innerHTML = `Round<b>${st.round}</b>`;
  $('hud-round').setAttribute('aria-label', `Round ${st.round} of ${st.rounds}`);
  const main = $('hud-main');
  if (drawer && st.word) {
    main.innerHTML = `<span class="lbl">Draw:</span><span class="word">${esc(st.word.w)} ${st.word.e}</span>`;
    fitHud(main.querySelector('.word'));
  } else if (!drawer) {
    main.innerHTML = `<span class="lbl">Guess it!</span><span class="who">${esc(nameOf(st.drawerSeat))} is drawing…</span>`;
    fitHud(main.querySelector('.who'));
  } else {
    main.innerHTML = '';
  }

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
      $('choose-body').innerHTML = `
        <p>Round ${st.round} · Your word is…</p>
        <div class="big-emoji" aria-hidden="true">${st.word.e}</div>
        <h2 class="big-word">${esc(st.word.w)}</h2>
        <button class="btn big green" id="btn-ready">Ready?</button>
        ${st.swapsLeft > 0 ? `<button class="btn small ghost" id="btn-swap">Another word (${st.swapsLeft})</button>` : ''}`;
      $('btn-ready').addEventListener('click', () => {
        S.net?.send({ type: 'ready', aspect: hostAspect() });
      });
      $('btn-swap')?.addEventListener('click', () => { snd.play('pop'); S.net?.send({ type: 'swap' }); });
    } else {
      $('choose-body').innerHTML = `
        <p>Round ${st.round}</p>
        <div class="pencil-bob" aria-hidden="true">✏️</div>
        <h2>${esc(nameOf(st.drawerSeat))} is getting ready to draw…</h2>
        <p>Get your guessing brain ready!</p>`;
    }
  } else ch.hidden = true;

  // Round results
  if (st.phase === 'reveal') renderReveal(phaseChanged);
  else { $('ov-reveal').hidden = true; S.replayStop?.(); S.replayStop = null; }

  if (phaseChanged && st.phase !== 'drawing') {
    $('feed').replaceChildren();
    $('in-guess').value = '';
  }
  if (phaseChanged && st.phase === 'drawing' && !drawer) {
    // Focus the answer box without popping the keyboard over a phone screen.
    if (window.matchMedia('(pointer: fine)').matches) $('in-guess').focus();
  }
  $('in-guess').disabled = st.phase !== 'drawing';
  $('btn-guess').disabled = st.phase !== 'drawing';
  $('btn-giveup').disabled = st.phase !== 'drawing';
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
  if (sec <= 5 && sec >= 1 && S.lastTickSec !== sec) snd.play('tick');
  S.lastTickSec = sec;
}
setInterval(updateTimer, 200);

// ── Drawing tools ───────────────────────────────────────────

const ICON = { pen: 'i-pen', marker: 'i-marker', crayon: 'i-crayon', dots: 'i-dots', rainbow: 'i-rainbow', eraser: 'i-eraser' };

function buildTray() {
  const tools = $('tools');
  tools.replaceChildren();
  for (const [id, t] of Object.entries(TOOLS)) {
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
  const list = TOOLS[S.tool].sizes;
  list.forEach((sz, i) => {
    const b = document.createElement('button');
    b.className = 'btn';
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', S.sizeIdx[S.tool] === i ? 'true' : 'false');
    b.setAttribute('aria-label', SIZE_NAMES[S.tool][i]);
    const px = [10, 18, 28][list.length === 2 ? i * 2 : i];
    const bg = S.tool === 'eraser' ? '#fff' : S.color === '#ffffff' ? '#fff' : S.color;
    b.innerHTML = `<span class="blob" style="width:${px}px;height:${px}px;background:${bg};box-shadow:0 0 0 2.5px #000"></span>`;
    b.addEventListener('click', () => { S.sizeIdx[S.tool] = i; renderTray(); });
    sizes.append(b);
  });
}

function updateUndo() {
  const canAct = S.st?.phase === 'drawing' && amDrawer();
  $('btn-undo').disabled = !canAct || S.board.ops.length === 0;
  $('btn-clear').disabled = !canAct || !S.board.hasInk();
}

$('btn-undo').addEventListener('click', () => {
  if (S.stroke) return;
  S.net?.send({ type: 'undo' });
});
$('btn-clear').addEventListener('click', () => {
  confirmBox('Clear drawing?', () => S.net?.send({ type: 'clear', id: rid() }));
});

buildTray();

// ── Pointer input (finger, Apple Pencil, stylus, mouse) ─────

const sheet = S.board.sheet;
const canDraw = () => S.st?.phase === 'drawing' && amDrawer() && S.net?.isOpen;
const MIN_STEP = 10; // in 0..10000 board coordinates

sheet.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'pen') S.lastPen = performance.now();
  if (!canDraw() || S.stroke) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  // Palm rejection: ignore touches right after the pencil was used.
  if (e.pointerType === 'touch' && performance.now() - S.lastPen < 1500) return;
  e.preventDefault();
  try { sheet.setPointerCapture(e.pointerId); } catch {}
  const [x, y] = S.board.toBoard(e.clientX, e.clientY);
  const tool = S.tool;
  const size = TOOLS[tool].sizes[S.sizeIdx[tool]];
  const color = tool === 'eraser' ? '#ffffff' : S.color;
  const id = rid();
  S.stroke = { id, pointerId: e.pointerId, lx: x, ly: y, pending: [], raf: 0 };
  S.board.begin({ id, tool, color, size, pts: [x, y] });
  S.net.send({ type: 'strokeStart', id, tool, color, size, pts: [x, y] });
});

sheet.addEventListener('pointermove', (e) => {
  const s = S.stroke;
  if (e.pointerType === 'pen') S.lastPen = performance.now();
  if (!s || e.pointerId !== s.pointerId) return;
  e.preventDefault();
  let evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
  if (!evs.length) evs = [e];
  const add = [];
  for (const ev of evs) {
    const [x, y] = S.board.toBoard(ev.clientX, ev.clientY);
    if (Math.abs(x - s.lx) + Math.abs(y - s.ly) < MIN_STEP) continue;
    s.lx = x; s.ly = y;
    add.push(x, y);
  }
  if (!add.length) return;
  S.board.add(s.id, add);
  s.pending.push(...add);
  if (!s.raf) s.raf = requestAnimationFrame(() => flush(s));
});

function flush(s) {
  s.raf = 0;
  while (s.pending.length) {
    const chunk = s.pending.splice(0, MAX_POINTS_PER_MSG * 2);
    S.net?.send({ type: 'strokePoints', id: s.id, pts: chunk });
  }
}

function endStroke(e) {
  const s = S.stroke;
  if (!s || (e && e.pointerId !== s.pointerId)) return;
  if (e && e.type === 'pointerup') {
    const [x, y] = S.board.toBoard(e.clientX, e.clientY);
    if (x !== s.lx || y !== s.ly) { S.board.add(s.id, [x, y]); s.pending.push(x, y); }
  }
  cancelAnimationFrame(s.raf);
  flush(s);
  S.board.end(s.id);
  S.net?.send({ type: 'strokeEnd', id: s.id });
  S.stroke = null;
  updateUndo();
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
  return S.st.players.map((p, i) => `
    <div class="score" style="--pc:${i ? 'var(--p2)' : 'var(--p1)'}">
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

// ── Header buttons ──────────────────────────────────────────

function renderMute() {
  const m = snd.isMuted();
  $('btn-mute').innerHTML = `<svg aria-hidden="true"><use href="#${m ? 'i-mute' : 'i-sound'}"/></svg>`;
  $('btn-mute').setAttribute('aria-label', m ? 'Turn sounds on' : 'Turn sounds off');
  $('btn-mute').setAttribute('aria-pressed', m ? 'true' : 'false');
}
$('btn-mute').addEventListener('click', () => { snd.setMuted(!snd.isMuted()); renderMute(); });
renderMute();
$('btn-quit').addEventListener('click', () => confirmBox('Leave the game?', leaveGame));

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
window.__dt = { S };

window.addEventListener('resize', () => document.querySelectorAll('#hud-main .word, #hud-main .who').forEach(fitHud));
