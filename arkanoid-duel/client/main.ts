// ARKANOID // DUEL - the browser side.
//
// This file only connects things: the screens, the network, the renderer, the
// input and the sound. Nothing here decides anything about the match; it shows
// what the server says and sends the player's paddle position and button
// presses.

import { MATCH, PADDLE, W } from '../shared/constants.ts';
import { Net } from './net.ts';
import type { Session } from './net.ts';
import { INTERP_MS, World } from './world.ts';
import type { Snap } from './world.ts';
import { Renderer } from './render.ts';
import { Input } from './input.ts';
import { GameAudio } from './audio.ts';
import type { ServerMsg } from '../shared/protocol.ts';

declare const __API_URL__: string;
declare const __WS_URL__: string;

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

// ── Settings (kept on this device) ───────────────────────────

interface Settings { music: boolean; sfx: boolean; vib: boolean; hc: boolean; flip: boolean; net: boolean }
const DEFAULTS: Settings = { music: true, sfx: true, vib: true, hc: false, flip: false, net: true };
const settings: Settings = (() => {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem('duel.settings') || '{}') as Partial<Settings>) }; } catch { return { ...DEFAULTS }; }
})();
const saveSettings = () => { try { localStorage.setItem('duel.settings', JSON.stringify(settings)); } catch { /* private mode */ } };

// ── Who am I (per browser tab, so two tabs can play each other) ──

const rand = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
const pid = (() => {
  try { let p = sessionStorage.getItem('duel.pid'); if (!p) { p = rand(24); sessionStorage.setItem('duel.pid', p); } return p; } catch { return rand(24); }
})();
const loadSession = (): Session | null => { try { const s = JSON.parse(sessionStorage.getItem('duel.session') || 'null'); return s && s.code ? { ...s, pid } : null; } catch { return null; } };
const saveSession = (s: Session | null) => { try { if (s) sessionStorage.setItem('duel.session', JSON.stringify({ code: s.code, pass: s.pass, name: s.name })); else sessionStorage.removeItem('duel.session'); } catch { /* private mode */ } };

// ── Parts ────────────────────────────────────────────────────

const API = (typeof __API_URL__ === 'string' && __API_URL__) || '';
const WSBASE = (typeof __WS_URL__ === 'string' && __WS_URL__) || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;

const world = new World();
const net = new Net((code) => `${WSBASE}/api/rooms/${code}/ws`);
const canvas = $<HTMLCanvasElement>('game');
const renderer = new Renderer(canvas);
const audio = new GameAudio();
audio.getServerNow = () => net.serverNow();

const app = {
  me: 0 as 0 | 1 | 2,
  names: ['', ''] as [string, string],
  code: '',
  pass: '',
  active: false,           // in a game (as opposed to the landing screens)
  speed: 1,
  localX: W / 2,
  lastSent: -1,
  lastSentAt: 0,
  matchSoundDone: false,
  hadOpen: false,
};

const input = new Input(canvas, {
  toArena: (sx, sy) => renderer.toArena(sx, sy),
  flipped: () => renderer.opts.flip,
  onTarget: () => {},
  onServe: () => {
    const s = world.latest;
    if (s && s.ph === 'SERVE' && s.sv === app.me) net.send({ t: 'serve' });
  },
});

// ── Screens ──────────────────────────────────────────────────

const SCREENS = ['landing', 'create', 'join', 'lobby', 'end', 'disc'] as const;
type ScreenId = (typeof SCREENS)[number] | null;
let screen: ScreenId = 'landing';
function show(id: ScreenId): void {
  screen = id;
  for (const s of SCREENS) $(s).hidden = s !== id;
  input.enabled = app.active && id === null;
  $('gear').hidden = !app.active;
}

function banner(text: string, ok = false, ms = 0): void {
  const b = $('banner');
  b.textContent = text;
  b.classList.toggle('ok', ok);
  b.classList.toggle('on', !!text);
  if (ms) { clearTimeout((banner as unknown as { t?: number }).t); (banner as unknown as { t?: number }).t = window.setTimeout(() => b.classList.remove('on'), ms); }
}

function applySettings(): void {
  document.body.classList.toggle('hc', settings.hc);
  renderer.opts.flip = settings.flip;
  renderer.opts.contrast = settings.hc;
  audio.apply({ music: settings.music, sfx: settings.sfx, vibrate: settings.vib });
  $('net').hidden = !(settings.net && app.active);
  renderer.layout();
}

// ── Landing, create, join ────────────────────────────────────

function randomPass(): string { return String(1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000)); }

let createSpeed = 1;
function bindSpeed(box: HTMLElement, current: () => number, set: (v: number) => void): void {
  const paint = () => box.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(Number((b as HTMLElement).dataset.v) === current())));
  box.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { audio.tap(); set(Number((b as HTMLElement).dataset.v)); paint(); }));
  paint();
}

$('btn-create').addEventListener('click', () => {
  $<HTMLInputElement>('c-pass').value = randomPass();
  $<HTMLInputElement>('c-name').value = localStorage.getItem('duel.name') || '';
  $('c-err').textContent = '';
  show('create');
});
$('btn-join').addEventListener('click', () => {
  $<HTMLInputElement>('j-name').value = localStorage.getItem('duel.name') || '';
  $('j-err').textContent = '';
  show('join');
});
$('btn-settings').addEventListener('click', () => openSettings());
document.querySelectorAll('.back').forEach((b) => b.addEventListener('click', () => show('landing')));
$('c-rand').addEventListener('click', () => { $<HTMLInputElement>('c-pass').value = randomPass(); });
bindSpeed($('c-speed'), () => createSpeed, (v) => { createSpeed = v; });

const saveName = (n: string) => { try { localStorage.setItem('duel.name', n); } catch { /* private mode */ } };
const cleanName = (n: string) => n.replace(/[<>]/g, '').trim().slice(0, 12);

$('form-create').addEventListener('submit', async (e) => {
  e.preventDefault();
  audio.unlock();
  const name = cleanName($<HTMLInputElement>('c-name').value);
  const pass = $<HTMLInputElement>('c-pass').value.trim();
  const err = $('c-err');
  if (pass.length < 3) { err.textContent = 'Pick a passcode of at least 3 characters.'; return; }
  saveName(name);
  $<HTMLButtonElement>('c-go').disabled = true;
  err.textContent = '';
  try {
    const res = await fetch(`${API}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pass, pid }) });
    const body = (await res.json().catch(() => ({}))) as { code?: string; say?: string };
    if (!res.ok || !body.code) { err.textContent = body.say || 'Could not create a game. Try again.'; return; }
    app.speed = createSpeed;
    const r = await enter({ code: body.code, pass, pid, name });
    if (!r.ok) err.textContent = r.say;
  } catch {
    err.textContent = 'SERVER UNAVAILABLE. Check your connection.';
  } finally {
    $<HTMLButtonElement>('c-go').disabled = false;
  }
});

$('form-join').addEventListener('submit', async (e) => {
  e.preventDefault();
  audio.unlock();
  const code = $<HTMLInputElement>('j-code').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const pass = $<HTMLInputElement>('j-pass').value.trim();
  const name = cleanName($<HTMLInputElement>('j-name').value);
  const err = $('j-err');
  if (code.length !== 4) { err.textContent = 'The game code has 4 characters.'; return; }
  if (pass.length < 3) { err.textContent = 'Enter the passcode.'; return; }
  saveName(name);
  $<HTMLButtonElement>('j-go').disabled = true;
  err.textContent = '';
  const r = await enter({ code, pass, pid, name });
  if (!r.ok) err.textContent = r.say;
  $<HTMLButtonElement>('j-go').disabled = false;
});

// Connect to a game; on success we are in it, on failure we say why.
async function enter(s: Session): Promise<{ ok: true } | { ok: false; say: string }> {
  world.reset();
  banner('CONNECTING…');
  const r = await net.connect(s);
  if (!r.ok) {
    banner('');
    const e = r.err;
    const say = e.code === 'bad_passcode' ? `WRONG PASSCODE. ${e.left ?? 0} ${e.left === 1 ? 'TRY' : 'TRIES'} LEFT.`
      : e.code === 'locked' ? `TOO MANY WRONG TRIES. WAIT ${e.retry ?? 60} SECONDS.`
      : e.code === 'full' ? 'GAME FULL'
      : e.code === 'not_found' ? 'NO SUCH GAME. CHECK THE CODE.'
      : e.say.toUpperCase();
    return { ok: false, say };
  }
  banner('');
  app.code = s.code; app.pass = s.pass; app.me = net.you;
  saveSession(s);
  app.active = true;
  app.hadOpen = true;
  app.matchSoundDone = false;
  input.sync(W / 2);
  app.localX = W / 2;
  history.replaceState(null, '', location.pathname);
  show('lobby');
  applySettings();
  if (net.you === 1 && app.speed !== 1) net.send({ t: 'speed', v: app.speed });
  return { ok: true };
}

function leaveGame(message = ''): void {
  net.close();
  saveSession(null);
  app.active = false;
  app.me = 0;
  world.reset();
  audio.setMode('off');
  show('landing');
  applySettings();
  banner(message, false, message ? 5000 : 0);
}

// ── Lobby, end and disconnect screens ────────────────────────

$('l-ready').addEventListener('click', () => { audio.unlock(); audio.tap(); net.send({ t: 'ready' }); });
$('l-leave').addEventListener('click', () => leaveGame());
$('l-show').addEventListener('click', () => {
  const b = $('l-pass'), shown = b.dataset.shown === '1';
  b.dataset.shown = shown ? '0' : '1';
  b.textContent = shown ? '•'.repeat(app.pass.length) : app.pass;
  $('l-show').textContent = shown ? 'SHOW' : 'HIDE';
});
$('l-copy').addEventListener('click', async () => {
  const text = `Join my ARKANOID // DUEL game!\n${location.origin}/?room=${app.code}\nGame code: ${app.code}\nPasscode: ${app.pass}`;
  try { await navigator.clipboard.writeText(text); banner('INVITE COPIED', true, 2200); } catch { window.prompt('Copy this invite:', text); }
});
bindSpeed($('l-speed'), () => world.latest?.sp ?? 1, (v) => net.send({ t: 'speed', v }));

$('e-rematch').addEventListener('click', () => { audio.tap(); net.send({ t: 'rematch' }); });
$('e-lobby').addEventListener('click', () => { audio.tap(); net.send({ t: 'lobby' }); });
$('d-wait').addEventListener('click', () => { audio.tap(); net.send({ t: 'wait' }); });
$('d-leave').addEventListener('click', () => { audio.tap(); net.send({ t: 'leave' }); });

let uiKey = '';
function syncUi(): void {
  const s = world.latest;
  if (!s || !app.active) return;
  const remain = s.ph === 'DISCONNECTED' ? Math.max(0, Math.ceil(s.pt - (net.serverNow() - s.st) / 1000)) : 0;
  const key = [s.ph, s.cn.join(), s.rd.join(), s.sp, app.names.join('|'), app.me, remain, s.mw].join('/');
  if (key === uiKey) return;
  uiKey = key;

  const name = (p: 1 | 2) => (app.names[p - 1] || `PLAYER ${p}`).toUpperCase();
  const lobbyPhase = s.ph === 'WAITING_FOR_PLAYER' || s.ph === 'READY';
  const target: ScreenId = lobbyPhase ? 'lobby' : s.ph === 'MATCH_WON' || s.ph === 'REMATCH' ? 'end' : s.ph === 'DISCONNECTED' ? 'disc' : null;
  if (target !== screen) show(target);

  if (lobbyPhase) {
    $('l-code').textContent = app.code;
    const passEl = $('l-pass');
    if (passEl.dataset.shown !== '1') passEl.textContent = '•'.repeat(app.pass.length);
    for (const p of [1, 2] as const) {
      const li = $(`slot${p}`);
      const here = s.cn[p - 1];
      li.textContent = `${name(p)} ${here ? (s.ph === 'READY' && s.rd[p - 1] ? '· READY ✓' : '· CONNECTED') : '· WAITING…'}${app.me === p ? '  (YOU)' : ''}`;
      li.classList.toggle('off', !here);
    }
    $('l-speed').hidden = false;
    $('l-speed').querySelectorAll('button').forEach((b) => {
      b.setAttribute('aria-checked', String(Number((b as HTMLElement).dataset.v) === s.sp));
      (b as HTMLButtonElement).disabled = app.me !== 1;
    });
    const ready = $<HTMLButtonElement>('l-ready');
    ready.hidden = s.ph !== 'READY';
    ready.disabled = !!s.rd[app.me - 1];
    ready.textContent = s.rd[app.me - 1] ? 'WAITING FOR OPPONENT…' : 'READY';
    $('l-status').textContent = s.ph === 'WAITING_FOR_PLAYER' ? 'SHARE THE CODE AND PASSCODE WITH YOUR OPPONENT' : s.rd[app.me - 1] ? 'GET READY…' : 'BOTH PLAYERS PRESS READY TO BEGIN';
  }
  if (target === 'end') {
    const w = s.mw as 1 | 2;
    $('e-title').textContent = w === app.me ? 'YOU WIN!' : `${name(w)} WINS`;
    $('e-sub').textContent = `LEVELS ${s.lw[0]}–${s.lw[1]}  ·  SCORE ${s.sc[0].toLocaleString('en-US')} – ${s.sc[1].toLocaleString('en-US')}`;
    const asked = !!s.rd[app.me - 1], theyAsked = !!s.rd[2 - app.me];
    const btn = $<HTMLButtonElement>('e-rematch');
    btn.disabled = asked;
    btn.textContent = asked ? 'WAITING FOR OPPONENT…' : theyAsked ? 'REMATCH — THEY ARE READY' : 'REMATCH';
  }
  if (target === 'disc') $('d-sub').textContent = `WAITING FOR THEM TO RECONNECT… ${remain}s`;
  void MATCH;
}

// ── Sound follows the match ──────────────────────────────────

function syncAudio(): void {
  const s = world.latest;
  if (!s) return;
  audio.intensity = Math.max(s.cb[0], s.cb[1]);
  if (s.ph === 'MATCH_WON' || s.ph === 'REMATCH') {
    if (!app.matchSoundDone) { app.matchSoundDone = true; audio.finish(s.mw === app.me); }
    return;
  }
  app.matchSoundDone = false;
  const playing = ['COUNTDOWN', 'SERVE', 'PLAYING', 'RALLY_END', 'LEVEL_CLEAR'].includes(s.ph);
  audio.setMode(playing ? 'game' : 'off');
}

// ── Network messages ─────────────────────────────────────────

net.onMessage = (m: ServerMsg) => {
  switch (m.t) {
    case 'welcome': app.me = m.you; app.names = m.names; world.reset(); uiKey = ''; break;
    case 'level': world.pushLevel(m); break;
    case 's': world.push(m as unknown as Snap); break;
    case 'names': app.names = m.names; uiKey = ''; break;
    case 'err':
      if (m.code === 'replaced') leaveGame('YOU JOINED FROM ANOTHER DEVICE');
      break;
    default: break;
  }
};

net.onState = (st) => {
  if (!app.active && st !== 'failed') return;
  if (st === 'reconnecting') banner('RECONNECTING…');
  else if (st === 'connecting') banner('CONNECTING…');
  else if (st === 'open') { if (app.hadOpen && app.active) banner('CONNECTED', true, 1500); else banner(''); uiKey = ''; }
  else if (st === 'failed' && app.active) leaveGame(net.fatal?.code === 'not_found' ? 'SERVER UNAVAILABLE' : 'CONNECTION LOST');
};

// ── Settings sheet ───────────────────────────────────────────

function openSettings(): void {
  $<HTMLInputElement>('s-music').checked = settings.music;
  $<HTMLInputElement>('s-sfx').checked = settings.sfx;
  $<HTMLInputElement>('s-vib').checked = settings.vib;
  $<HTMLInputElement>('s-hc').checked = settings.hc;
  $<HTMLInputElement>('s-flip').checked = settings.flip;
  $<HTMLInputElement>('s-net').checked = settings.net;
  $('settings').hidden = false;
  input.enabled = false;
}
for (const [id, key] of [['s-music', 'music'], ['s-sfx', 'sfx'], ['s-vib', 'vib'], ['s-hc', 'hc'], ['s-flip', 'flip'], ['s-net', 'net']] as const) {
  $(id).addEventListener('change', (e) => { settings[key] = (e.target as HTMLInputElement).checked; saveSettings(); applySettings(); });
}
$('s-close').addEventListener('click', () => { $('settings').hidden = true; input.enabled = app.active && screen === null; });
$('gear').addEventListener('click', openSettings);

// ── The frame loop ───────────────────────────────────────────

let lastNow = 0;
function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0.016;
  lastNow = now;
  if (!app.active) return;

  const renderT = net.serverNow() - INTERP_MS;
  const due = world.advance(renderT);
  if (due.length) {
    renderer.addEvents(due, app.me, world);
    for (const e of due) audio.event(e, app.me, W);
  }

  // my paddle: draw it where I have asked it to be, chasing at the same speed the server allows
  input.update(now);
  const interp = world.interp(renderT);
  if (interp && app.me) {
    const idx = app.me - 1;
    const half = interp.pw[idx] / 2;
    const tgt = Math.max(half, Math.min(W - half, input.target));
    const step = PADDLE.maxSpeed * dt, d = tgt - app.localX;
    app.localX = Math.abs(d) <= step ? tgt : app.localX + Math.sign(d) * step;
    if (Math.abs(app.localX - interp.p[idx]) > 120 + net.rtt * 3.2) app.localX = interp.p[idx];   // out of step: trust the server
    interp.p[idx] = app.localX;
  }
  if (input.target !== app.lastSent && now - app.lastSentAt > 15) {
    app.lastSent = input.target; app.lastSentAt = now;
    net.send({ t: 'in', x: input.target });
  }

  renderer.draw(world, {
    me: app.me, names: app.names, touch: input.touch || matchMedia('(pointer: coarse)').matches,
    phase: world.phase ?? '', cur: world.cur, serverNow: net.serverNow(), renderT,
  }, interp, now);

  syncUi();
  syncAudio();
  if (settings.net) $('net').textContent = net.state === 'open' ? `${Math.round(net.rtt)} ms · ${net.quality}` : '';
  if (settings.net) $('net').className = `net ${net.state === 'open' ? net.quality : ''}`;
}

// ── Start ────────────────────────────────────────────────────

function boot(): void {
  applySettings();
  window.addEventListener('resize', () => renderer.layout());
  window.visualViewport?.addEventListener('resize', () => renderer.layout());
  window.addEventListener('orientationchange', () => setTimeout(() => renderer.layout(), 150));
  // sound can only start after a tap
  const unlock = () => { audio.unlock(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  requestAnimationFrame(frame);

  // An invite link (?room=Q7K9) goes straight to the join screen.
  const room = new URLSearchParams(location.search).get('room');
  if (room) {
    $<HTMLInputElement>('j-code').value = room.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    $<HTMLInputElement>('j-name').value = localStorage.getItem('duel.name') || '';
    show('join');
  }

  // Reloaded in the middle of a game? Slip back into it.
  const prev = loadSession();
  if (prev) {
    void enter(prev).then((r) => {
      if (!r.ok) { saveSession(null); app.active = false; show(room ? 'join' : 'landing'); banner(r.say, false, 4000); }
    });
  }
}

declare global { interface Window { __duel?: unknown } }
window.__duel = { world, net, renderer, app, input, audio, settings };
boot();
