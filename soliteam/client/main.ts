// SOLITEAM - the browser side.
//
// This file draws THE GAME and sends what you would like to do. It never
// decides that a move happened: a card only settles somewhere once the
// table says so. It uses the rules only to show where a card could go.

import { apply, cardName, cardText, isLegal, isRed, rankOf, suitOf, RANKS, SUITS } from '../shared/solitaire.ts';
import type { Move, Place, State } from '../shared/solitaire.ts';
import type { ServerMsg, ResetStage } from '../shared/protocol.ts';

declare const __WS_URL__: string;
const WSBASE = (typeof __WS_URL__ === 'string' && __WS_URL__) || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const tableEl = $('table'), slotsEl = $('slots'), cardsEl = $('cards'), ghostEl = $('ghost'), feedEl = $('feed'), liveEl = $('live');
const curtain = $('curtain'), curtainText = $('curtain-text'), curtainSub = $('curtain-sub');

// ── What we know ─────────────────────────────────────────────

let state: State | null = null;
let seq = -1;
let game = 0, moves = 0, players = 0;
let resetting = false;
let selected: { from: Place; n: number } | null = null;
let ws: WebSocket | null = null;
let backoff = 500;
let sinceEvent = Date.now();

// ── Geometry ─────────────────────────────────────────────────
// Seven columns across whatever width there is; cards as big as that allows.

interface Geo { w: number; h: number; g: number; x: number[]; topY: number; tabY: number; dDown: number; dUp: number; stock: [number, number]; waste: [number, number]; found: [number, number][] }
let geo: Geo = layout();

function layout(): Geo {
  const W = tableEl.clientWidth || window.innerWidth;
  const g = Math.max(4, Math.round(W * 0.012));
  const w = Math.min(Math.floor((W - 8 * g) / 7), 124);
  const h = Math.round(w * 1.42);
  const left = Math.floor((W - (7 * w + 6 * g)) / 2);
  const x = Array.from({ length: 7 }, (_, i) => left + i * (w + g));
  const topY = g * 2;
  const tabY = topY + h + g * 3;
  document.documentElement.style.setProperty('--card-w', `${w}px`);
  document.documentElement.style.setProperty('--card-h', `${h}px`);
  return { w, h, g, x, topY, tabY, dDown: Math.max(6, Math.round(w * 0.17)), dUp: Math.max(16, Math.round(w * 0.42)), stock: [x[0], topY], waste: [x[1], topY], found: [3, 4, 5, 6].map((i) => [x[i], topY] as [number, number]) };
}

// ── The pieces on the table ──────────────────────────────────

const cardEls: HTMLButtonElement[] = [];
const slotEls: { stock: HTMLButtonElement; found: HTMLButtonElement[]; col: HTMLButtonElement[] } = { stock: null as any, found: [], col: [] };

function makeSlots(): void {
  const mk = (cls: string, label: string) => { const b = document.createElement('button'); b.type = 'button'; b.className = `slot ${cls}`; b.setAttribute('aria-label', label); slotsEl.appendChild(b); return b; };
  slotEls.stock = mk('stock', 'The stock. Turn over the next card.');
  slotEls.stock.addEventListener('click', () => send({ t: 'draw' }));
  for (let i = 0; i < 4; i++) {
    const b = mk(`found${isRed(i * 13) ? ' red' : ''}`, `Foundation for ${['clubs', 'diamonds', 'hearts', 'spades'][i]}`);
    b.dataset.suit = SUITS[i];
    b.addEventListener('click', () => onTarget({ p: 'f', i }));
    slotEls.found.push(b);
  }
  for (let i = 0; i < 7; i++) {
    const b = mk('col', `Empty column ${i + 1}. Only a king can go here.`);
    b.addEventListener('click', () => onTarget({ p: 't', i }));
    slotEls.col.push(b);
  }
}

function makeCards(): void {
  for (let c = 0; c < 52; c++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `card${isRed(c) ? ' red' : ''}${rankOf(c) === 10 ? ' ten' : ''}`;
    b.dataset.id = String(c);
    const r = RANKS[rankOf(c) - 1], s = SUITS[suitOf(c)];
    b.innerHTML = `<span class="tl">${r}<b>${s}</b></span><span class="pip">${s}</span><span class="br">${r}<b>${s}</b></span>`;
    b.addEventListener('click', () => onCard(c));
    b.addEventListener('dblclick', () => onDouble(c));
    b.addEventListener('pointerdown', (e) => onPointerDown(e, c));
    cardsEl.appendChild(b);
    cardEls.push(b);
  }
}

// Where every card sits, for the state we have.
interface Pos { x: number; y: number; z: number; up: boolean; where: Place | { p: 's' }; label: string; playable: boolean; n: number }
function positions(s: State): Pos[] {
  const out: Pos[] = new Array(52);
  s.stock.forEach((c, i) => { out[c] = { x: geo.stock[0], y: geo.stock[1], z: i + 1, up: false, where: { p: 's' }, label: i === s.stock.length - 1 ? 'The stock. Turn over the next card.' : 'A face-down card in the stock.', playable: i === s.stock.length - 1, n: 1 }; });
  s.waste.forEach((c, i) => { const top = i === s.waste.length - 1; out[c] = { x: geo.waste[0], y: geo.waste[1], z: i + 1, up: true, where: { p: 'w' }, label: `${cardName(c)}, ${top ? 'on the waste, ready to play' : 'in the waste'}`, playable: top, n: 1 }; });
  s.found.forEach((f, fi) => f.forEach((c, i) => { const top = i === f.length - 1; out[c] = { x: geo.found[fi][0], y: geo.found[fi][1], z: i + 1, up: true, where: { p: 'f', i: fi }, label: `${cardName(c)}, on its foundation`, playable: top, n: 1 }; }));
  s.tab.forEach((col, ci) => {
    let y = geo.tabY, z = 1;
    col.down.forEach((c) => { out[c] = { x: geo.x[ci], y, z: z++, up: false, where: { p: 't', i: ci }, label: `A face-down card in column ${ci + 1}`, playable: false, n: 1 }; y += geo.dDown; });
    col.up.forEach((c, i) => {
      const n = col.up.length - i;
      out[c] = { x: geo.x[ci], y, z: z++, up: true, where: { p: 't', i: ci }, label: `${cardName(c)}, column ${ci + 1}${n > 1 ? `, with ${n - 1} card${n > 2 ? 's' : ''} on top` : ', top of the column'}`, playable: true, n };
      y += geo.dUp;
    });
  });
  return out;
}

let pos: Pos[] = [];
let dealStagger = false;

function render(): void {
  if (!state) return;
  const s = state;
  pos = positions(s);
  // the table's height: as tall as its tallest column
  let bottom = geo.tabY + geo.h;
  for (const col of s.tab) bottom = Math.max(bottom, geo.tabY + col.down.length * geo.dDown + Math.max(0, col.up.length - 1) * geo.dUp + geo.h);
  tableEl.style.height = `${bottom + geo.g * 3}px`;

  // slots
  const put = (el: HTMLElement, x: number, y: number) => { el.style.transform = `translate3d(${x}px, ${y}px, 0)`; };
  put(slotEls.stock, geo.stock[0], geo.stock[1]);
  slotEls.stock.setAttribute('aria-label', s.stock.length ? `The stock, ${s.stock.length} cards. Turn over the next card.` : 'The stock is empty. Turn the waste back over.');
  slotEls.found.forEach((b, i) => { put(b, geo.found[i][0], geo.found[i][1]); b.setAttribute('aria-label', `Foundation for ${['clubs', 'diamonds', 'hearts', 'spades'][i]}: ${s.found[i].length ? cardName(s.found[i][s.found[i].length - 1]) + ' on top' : 'empty'}`); });
  slotEls.col.forEach((b, i) => { put(b, geo.x[i], geo.tabY); b.hidden = s.tab[i].down.length + s.tab[i].up.length > 0; });

  // cards
  let dealIndex = 0;
  for (let c = 0; c < 52; c++) {
    const p = pos[c], el = cardEls[c];
    if (!p) { el.hidden = true; continue; }          // a card that is nowhere (never in a real deal; keeps a test table from crashing the page)
    el.hidden = false;
    el.classList.toggle('down', !p.up);
    el.classList.toggle('stock-top', p.where.p === 's' && p.playable);
    el.style.zIndex = String(p.z + (p.where.p === 't' ? 10 : 0));
    el.setAttribute('aria-label', p.label);
    el.tabIndex = p.playable ? 0 : -1;
    if (dealStagger) { el.classList.add('deal'); el.style.transitionDelay = `${(p.where.p === 't' ? 60 + dealIndex++ * 28 : 0)}ms`; }
    else { el.classList.remove('deal'); el.style.transitionDelay = ''; }
    el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
  }
  dealStagger = false;
  paintSelection();
}

function paintSelection(): void {
  for (const el of cardEls) el.classList.remove('sel');
  for (const b of [...slotEls.found, ...slotEls.col]) b.classList.remove('target');
  if (!selected || !state) return;
  for (const c of runOf(selected)) cardEls[c].classList.add('sel');
  // where could it go?
  for (let i = 0; i < 4; i++) if (isLegal(state, { t: 'move', from: selected.from, n: selected.n, to: { p: 'f', i } })) slotEls.found[i].classList.add('target');
  for (let i = 0; i < 7; i++) if (isLegal(state, { t: 'move', from: selected.from, n: selected.n, to: { p: 't', i } })) { slotEls.col[i].classList.add('target'); const top = state.tab[i].up[state.tab[i].up.length - 1]; if (top !== undefined) cardEls[top].classList.add('lift'); }
}

function runOf(sel: { from: Place; n: number }): number[] {
  if (!state) return [];
  if (sel.from.p === 'w') return state.waste.length ? [state.waste[state.waste.length - 1]] : [];
  if (sel.from.p === 'f') { const f = state.found[sel.from.i]; return f.length ? [f[f.length - 1]] : []; }
  const up = state.tab[sel.from.i].up;
  return up.slice(up.length - sel.n);
}

// ── Doing things ─────────────────────────────────────────────

function send(m: Move): void {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify(m));
}

function select(from: Place, n: number): void {
  selected = { from, n };
  for (const el of cardEls) el.classList.remove('lift');
  paintSelection();
}
function deselect(): void { selected = null; for (const el of cardEls) el.classList.remove('lift'); paintSelection(); }

function tryMove(from: Place, n: number, to: Place): boolean {
  if (!state) return false;
  const m: Move = { t: 'move', from, n, to };
  if (!isLegal(state, m)) return false;
  send(m);
  deselect();
  return true;
}

function onCard(c: number): void {
  if (dragging?.moved) return;                 // a drag just ended on this card
  if (!state || resetting) return;
  const p = pos[c];
  if (p.where.p === 's') { if (p.playable) send({ t: 'draw' }); deselect(); return; }
  if (!p.playable) return;
  if (selected) {
    const same = runOf(selected)[0] === runOf({ from: p.where, n: p.n })[0];
    if (same) { deselect(); return; }
    const to: Place | null = p.where.p === 't' ? { p: 't', i: p.where.i } : p.where.p === 'f' ? { p: 'f', i: p.where.i } : null;
    if (to && tryMove(selected.from, selected.n, to)) return;
  }
  select(p.where, p.n);
}

function onTarget(to: Place): void {
  if (!state || resetting) return;
  if (to.p === 'f' && !selected) return;
  if (selected) { if (!tryMove(selected.from, selected.n, to)) deselect(); }
}

// Double-tap: send this card home if it can go.
function onDouble(c: number): void {
  if (!state || resetting) return;
  const p = pos[c];
  if (!p.playable || p.where.p === 's' || p.where.p === 'f') return;
  if (p.where.p === 't' && p.n !== 1) return;
  tryMove(p.where, 1, { p: 'f', i: suitOf(c) });
}
let lastTap = { c: -1, t: 0 };
cardsEl.addEventListener('pointerup', (e) => {
  const el = (e.target as HTMLElement).closest('.card') as HTMLButtonElement | null;
  if (!el || e.pointerType === 'mouse') return;
  const c = Number(el.dataset.id), t = Date.now();
  if (lastTap.c === c && t - lastTap.t < 350) { onDouble(c); lastTap = { c: -1, t: 0 }; } else lastTap = { c, t };
});

// Dragging: pick up a run, follow the pointer, drop it on whatever is under it.
let dragging: { c: number; run: number[]; from: Place; n: number; sx: number; sy: number; ox: number; oy: number; moved: boolean; id: number } | null = null;
function onPointerDown(e: PointerEvent, c: number): void {
  if (!state || resetting || e.button !== 0) return;
  const p = pos[c];
  if (!p.playable || p.where.p === 's') return;
  const run = runOf({ from: p.where, n: p.n });
  dragging = { c, run, from: p.where, n: p.n, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, moved: false, id: e.pointerId };
  (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
}
function onPointerMove(e: PointerEvent): void {
  if (!dragging || e.pointerId !== dragging.id) return;
  const dx = e.clientX - dragging.sx, dy = e.clientY - dragging.sy;
  if (!dragging.moved && Math.hypot(dx, dy) < 7) return;
  if (!dragging.moved) { dragging.moved = true; select(dragging.from, dragging.n); }
  dragging.run.forEach((c, i) => { const el = cardEls[c]; el.classList.add('drag'); el.style.zIndex = String(500 + i); el.style.transform = `translate3d(${dragging!.ox + dx}px, ${dragging!.oy + i * geo.dUp + dy}px, 0)`; });
}
function onPointerUp(e: PointerEvent): void {
  if (!dragging || e.pointerId !== dragging.id) return;
  const d = dragging;
  if (d.moved) {
    for (const c of d.run) cardEls[c].style.pointerEvents = 'none';
    const under = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    for (const c of d.run) cardEls[c].style.pointerEvents = '';
    const to = placeOf(under);
    for (const c of d.run) cardEls[c].classList.remove('drag');
    if (!to || !tryMove(d.from, d.n, to)) { deselect(); render(); }       // snap back
    setTimeout(() => { if (dragging === d) dragging = null; }, 0);
  } else dragging = null;
}
function placeOf(el: HTMLElement | null): Place | null {
  if (!el) return null;
  const card = el.closest('.card') as HTMLButtonElement | null;
  if (card) { const w = pos[Number(card.dataset.id)].where; return w.p === 't' ? { p: 't', i: w.i } : w.p === 'f' ? { p: 'f', i: w.i } : null; }
  const slot = el.closest('.slot') as HTMLButtonElement | null;
  if (slot) { const fi = slotEls.found.indexOf(slot); if (fi >= 0) return { p: 'f', i: fi }; const ci = slotEls.col.indexOf(slot); if (ci >= 0) return { p: 't', i: ci }; }
  return null;
}
window.addEventListener('pointermove', onPointerMove, { passive: true });
window.addEventListener('pointerup', onPointerUp);
window.addEventListener('pointercancel', () => { if (dragging) { dragging = null; deselect(); render(); } });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') deselect(); });

// ── The feed ─────────────────────────────────────────────────

function event(text: string, kind: 'move' | 'note' | 'deadpan' | 'presence'): void {
  sinceEvent = Date.now();
  const p = document.createElement('p');
  p.className = kind; p.textContent = text;
  feedEl.appendChild(p);
  while (feedEl.children.length > 4) feedEl.firstElementChild!.remove();
  liveEl.textContent = text;
  setTimeout(() => p.classList.add('gone'), kind === 'deadpan' ? 11000 : 7000);
  setTimeout(() => p.remove(), kind === 'deadpan' ? 12500 : 8500);
}
const QUIET = ['THE GAME CONTINUES.', 'NOTHING IS HAPPENING. THAT IS ALLOWED.', 'THE CARDS ARE WAITING.', 'YOU ARE NOT IN CHARGE.', 'SOMEONE, SOMEWHERE, IS THINKING.'];
setInterval(() => { if (Date.now() - sinceEvent > 50000 && Math.random() < 0.3) event(QUIET[Math.floor(Math.random() * QUIET.length)], 'deadpan'); }, 20000);

function showGhost(card: number): void {
  const p = pos[card];
  if (!p) return;
  ghostEl.style.transform = `translate3d(${p.x + geo.w / 2 - 38}px, ${p.y - 14}px, 0)`;
  ghostEl.classList.add('on');
  clearTimeout((showGhost as any).t);
  (showGhost as any).t = setTimeout(() => ghostEl.classList.remove('on'), 1600);
}

function bump(id: string, text: string): void {
  const el = $(id);
  if (el.textContent !== text) { el.textContent = text; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
}

// ── The curtain ──────────────────────────────────────────────

const STAGE_TEXT: Record<ResetStage, [string, string]> = {
  over: ['GAME OVER', ''],
  nomoves: ['THERE ARE NO MORE MOVES.', ''],
  will: ['THE GAME WILL NOW RESET ITSELF.', 'NOBODY IS TO BLAME.'],
  shuffle: ['RESETTING HUMANITY’S SOLITAIRE…', ''],
  begin: ['', ''],
};
function onReset(stage: ResetStage, g: number, won: boolean): void {
  resetting = stage !== 'begin';
  deselect();
  if (stage === 'begin') {
    curtainText.textContent = `GAME ${fmtGame(g)} BEGINS`;
    curtainSub.textContent = 'PLEASE DO NOT RUIN IT.';
    curtain.hidden = false;
    setTimeout(() => { curtain.hidden = true; }, 2400);
    event(`GAME ${fmtGame(g)} HAS BEGUN.`, 'note');
    return;
  }
  let [t, sub] = STAGE_TEXT[stage];
  if (won && stage === 'over') { t = 'THE GAME HAS BEEN WON.'; sub = 'HUMANITY DID IT.'; }
  if (won && stage === 'nomoves') { t = 'EVERY CARD IS HOME.'; sub = 'THERE IS NOTHING LEFT TO DO.'; }
  curtainText.textContent = t; curtainSub.textContent = sub;
  curtain.hidden = false;
  if (stage === 'shuffle' && state) {
    // every card flies back to the stock, with a little scatter in the timing
    for (let c = 0; c < 52; c++) { const el = cardEls[c]; el.classList.add('deal'); el.style.transitionDelay = `${Math.floor(Math.random() * 500)}ms`; el.style.transform = `translate3d(${geo.stock[0]}px, ${geo.stock[1]}px, 0)`; el.classList.add('down'); }
    dealStagger = true;                // and the next state deals them out again
  }
}
const fmtGame = (g: number) => `#${String(g).padStart(11, '0')}`;

// ── The network ──────────────────────────────────────────────

function connect(): void {
  const sock = new WebSocket(`${WSBASE}/api/ws`);
  ws = sock;
  sock.onopen = () => { backoff = 500; status('LIVE', true); sock.send(JSON.stringify({ t: 'hello' })); };
  sock.onclose = () => { if (ws !== sock) return; ws = null; status('RECONNECTING…', false); setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 8000); };
  sock.onerror = () => sock.close();
  sock.onmessage = (e) => {
    let m: ServerMsg;
    try { m = JSON.parse(e.data); } catch { return; }
    switch (m.t) {
      case 'state':
        if (m.seq < seq) return;
        seq = m.seq; state = m.state; game = m.game; moves = m.moves; players = m.players; resetting = m.resetting;
        if (selected && runOf(selected).length === 0) selected = null;
        render(); paintMeta();
        break;
      case 'moved':
        if (!m.mine) { setTimeout(() => { for (const c of m.cards) { cardEls[c].classList.add('other'); setTimeout(() => cardEls[c].classList.remove('other'), 1500); } if (m.cards[0] !== undefined) showGhost(m.cards[0]); }, 30); }
        break;
      case 'event': event(m.text, m.kind); break;
      case 'players': players = m.n; paintMeta(); break;
      case 'reset': onReset(m.stage, m.game, m.won); break;
      default: break;
    }
  };
}
function status(text: string, live: boolean): void { const el = $('status'); el.textContent = text; el.classList.toggle('live', live); }
function paintMeta(): void {
  bump('game', fmtGame(game));
  bump('moves', moves.toLocaleString('en-US'));
  bump('players', players === 1 ? '1 PERSON (YOU)' : `${players.toLocaleString('en-US')} PEOPLE`);
}

// ── Go ───────────────────────────────────────────────────────

makeSlots();
makeCards();
window.addEventListener('resize', () => { geo = layout(); render(); });
connect();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});

// for the tests
(window as any).__soliteam = { get state() { return state; }, get seq() { return seq; }, get game() { return game; }, get players() { return players; }, get selected() { return selected; }, get resetting() { return resetting; }, apply, cardText, send, pos: () => pos, cardEls };
