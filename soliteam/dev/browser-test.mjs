// Two real browsers (a phone and a desktop) at the same table, against the
// local server.   node dev/browser-test.mjs      (needs Playwright + Chromium)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import(process.env.PW || 'playwright');
const PORT = Number(process.env.PORT || 8799), BASE = `http://localhost:${PORT}`;
const OUT = process.env.SHOTS || path.join(os.tmpdir(), 'soliteam-shots');
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  ✓ ' + l); } else { fail++; console.log('  ✗ ' + l); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stateFile = path.join(os.tmpdir(), `soliteam-test-${process.pid}.json`);

spawn('node', [path.join(ROOT, 'build.mjs')], { stdio: 'inherit' });
await sleep(1500);
const srv = spawn('node', ['--no-warnings', path.join(ROOT, 'dev/local-server.mjs')], { env: { ...process.env, PORT: String(PORT), QUIET: '1', TIMESCALE: '4', STATE_FILE: stateFile }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => srv.stdout.once('data', r));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
async function visitor(name, opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404|sw\.js/.test(m.text())) errors.push(name + ': ' + m.text()); });
  await page.goto(BASE + '/');
  await page.waitForFunction(() => window.__soliteam?.state, null, { timeout: 15000 });
  return { ctx, page };
}
const st = (page) => page.evaluate(() => { const S = window.__soliteam; return { seq: S.seq, game: S.game, players: S.players, waste: S.state.waste.length, stock: S.state.stock.length, resetting: S.resetting, found: S.state.found.map((f) => f.length), tab: S.state.tab.map((c) => [c.down.length, c.up.length]) }; });
const feed = (page) => page.evaluate(() => [...document.querySelectorAll('#feed p')].map((p) => p.textContent));
const tapCard = (page, id, isTouch) => isTouch ? page.tap(`.card[data-id="${id}"]`) : page.click(`.card[data-id="${id}"]`);

const A = await visitor('Phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
const B = await visitor('Desk', { viewport: { width: 1280, height: 860 } });

// ── Arrival ──────────────────────────────────────────────────
ok((await A.page.textContent('h1')) === 'SOLITEAM', 'the title');
ok((await A.page.textContent('.tag')).includes('NEVER ENDS'), 'and the tagline');
ok(/#\d{11}/.test(await A.page.textContent('#game')), `the game number (${await A.page.textContent('#game')})`);
await A.page.waitForFunction(() => window.__soliteam.players === 2);
ok((await A.page.textContent('#players')) === '2 PEOPLE', 'two people are playing this game');
ok((await A.page.evaluate(() => document.querySelectorAll('.card').length)) === 52, '52 cards on the table');
ok(await A.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'phone: nothing overflows sideways');
ok(await A.page.evaluate(() => { const r = document.querySelector('.card').getBoundingClientRect(); return r.width >= 44 && r.height >= 60; }), 'phone: cards are at least 44px wide');
ok(await A.page.evaluate(() => document.querySelector('#status').textContent === 'LIVE'), 'the connection says LIVE');
await A.page.screenshot({ path: `${OUT}/01-phone-arrival.png` });
await B.page.screenshot({ path: `${OUT}/02-desktop-arrival.png` });
ok((await feed(B.page)).includes('SOMEONE HAS ARRIVED.'), 'the desktop was told someone arrived');

// ── Drawing ──────────────────────────────────────────────────
const s0 = await st(A.page);
await A.page.tap('.card.stock-top');
await A.page.waitForFunction((seq) => window.__soliteam.seq > seq, s0.seq);
await B.page.waitForFunction((seq) => window.__soliteam.seq > seq, s0.seq);
ok((await st(A.page)).waste === 1 && (await st(B.page)).waste === 1, 'tapping the stock turns a card for everyone');
ok((await feed(B.page)).some((t) => t.includes('DREW FROM THE STOCK')), 'the desktop is told someone drew');
ok(!(await feed(A.page)).some((t) => t.includes('DREW FROM THE STOCK')), 'the phone is not told about itself');
ok(await B.page.evaluate(() => !!document.querySelector('.card.other')), 'the moved card is marked as someone else\'s on the desktop');

// ── A column move, by tap-then-tap on the phone ─────────────
const move = await A.page.evaluate(() => {
  const S = window.__soliteam; const s = S.state;
  for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) { if (i === j) continue; const m = { t: 'move', from: { p: 't', i }, n: 1, to: { p: 't', i: j } }; if (S.apply(s, m)) return { i, j, card: s.tab[i].up[s.tab[i].up.length - 1], target: s.tab[j].up[s.tab[j].up.length - 1] }; }
  return null;
});
if (move) {
  const before = await st(A.page);
  await tapCard(A.page, move.card, true);
  ok(await A.page.evaluate(() => !!window.__soliteam.selected), 'tapping a card selects it');
  ok(await A.page.evaluate((c) => document.querySelector(`.card[data-id="${c}"]`).classList.contains('sel'), move.card), 'and it is highlighted');
  await tapCard(A.page, move.target, true);
  await B.page.waitForFunction((seq) => window.__soliteam.seq > seq, before.seq);
  const after = await st(B.page);
  ok(after.tab[move.j][1] === before.tab[move.j][1] + 1, `tapping the destination moves ${await A.page.evaluate((c) => window.__soliteam.cardText(c), move.card)} - and the desktop sees it`);
  ok(await A.page.evaluate(() => !window.__soliteam.selected), 'the selection clears');
  ok(await B.page.evaluate(() => document.querySelector('#ghost').classList.contains('on')), 'a SOMEONE label floats over it on the desktop');
  await B.page.screenshot({ path: `${OUT}/03-desktop-someone-moved.png` });
} else ok(true, '(no simple column move in this deal - skipped)');

// ── An illegal move does nothing ────────────────────────────
{
  const before = await st(B.page);
  const bad = await B.page.evaluate(() => { const s = window.__soliteam.state; const top = s.tab[0].up.at(-1); for (let j = 1; j < 7; j++) { const t = s.tab[j].up.at(-1); if (t !== undefined && !window.__soliteam.apply(s, { t: 'move', from: { p: 't', i: 0 }, n: 1, to: { p: 't', i: j } })) return { card: top, target: t }; } return null; });
  if (bad) {
    await B.page.click(`.card[data-id="${bad.card}"]`);
    await B.page.click(`.card[data-id="${bad.target}"]`);
    await sleep(400);
    ok((await st(B.page)).seq === before.seq, 'tapping an impossible destination changes nothing');
  }
  // and a forged message is ignored by the server
  await B.page.evaluate(() => window.__soliteam.send({ t: 'move', from: { p: 'w' }, n: 1, to: { p: 't', i: 0 } }));
  await sleep(400);
  ok((await st(A.page)).seq === before.seq, 'a forged impossible move is ignored by the table');
}

// ── Keyboard ─────────────────────────────────────────────────
await B.page.focus('.card.stock-top');
const s1 = await st(B.page);
await B.page.keyboard.press('Enter');
await A.page.waitForFunction((seq) => window.__soliteam.seq > seq, s1.seq);
ok((await st(A.page)).seq > s1.seq, 'the stock can be worked with the keyboard');
ok(await B.page.evaluate(() => [...document.querySelectorAll('.card')].every((c) => c.getAttribute('aria-label').length > 3)), 'every card has a label for screen readers');

// ── Reload: you walk back into the same game ───────────────
const g0 = await st(A.page);
await A.page.reload();
await A.page.waitForFunction(() => window.__soliteam?.state, null, { timeout: 15000 });
const g1 = await st(A.page);
ok(g1.game === g0.game && JSON.stringify(g1.tab) === JSON.stringify(g0.tab), 'reloading drops you back into the same game, as it is');

// ── The reset ceremony ──────────────────────────────────────
// Swap in a stuck table (a dev-only door) and watch the machine reset itself.
const C = (r) => r - 1, S = (r) => 39 + r - 1, H = (r) => 26 + r - 1, D = (r) => 13 + r - 1;
const stuck = { state: { stock: [C(3), S(5)], waste: [H(11)], found: [[], [], [], []], tab: [{ down: [D(9)], up: [S(8)] }, { down: [], up: [C(10)] }, { down: [], up: [] }, { down: [], up: [] }, { down: [], up: [] }, { down: [], up: [] }, { down: [], up: [] }], passes: 0 }, game: g1.game, moves: 123, seq: g1.seq, startedAt: 0, lastMoveAt: 0 };
await fetch(`${BASE}/dev/set`, { method: 'POST', body: JSON.stringify(stuck) });
await A.page.waitForFunction(() => !document.getElementById('curtain').hidden, null, { timeout: 10000 });
const seen = new Set();
const t0 = Date.now();
while (Date.now() - t0 < 12000) { seen.add(await A.page.textContent('#curtain-text')); if ((await st(A.page)).game > g1.game && document !== undefined) { /* keep sampling a moment */ } if (seen.size >= 5) break; await sleep(60); }
await A.page.waitForFunction((g) => window.__soliteam.game > g, g1.game, { timeout: 15000 });
ok(seen.has('GAME OVER'), 'GAME OVER');
ok(seen.has('THERE ARE NO MORE MOVES.'), 'THERE ARE NO MORE MOVES.');
ok(seen.has('THE GAME WILL NOW RESET ITSELF.'), 'THE GAME WILL NOW RESET ITSELF.');
ok([...seen].some((t) => t.startsWith('RESETTING')), 'RESETTING HUMANITY’S SOLITAIRE…');
const g2 = await st(B.page);
ok(g2.game === g1.game + 1, `a new game begins, number ${g2.game}`);
ok(g2.stock === 24 && g2.tab.every(([d, u], i) => d === i && u === 1), 'freshly dealt');
ok(await A.page.evaluate(() => (document.getElementById('moves').textContent || '').replace(/\D/g, '') === '123'), 'the move total carries across the reset');
await sleep(800);
await A.page.screenshot({ path: `${OUT}/04-phone-new-game.png` });
ok((await feed(B.page)).some((t) => t.includes('HAS BEGUN')), 'and the feed says so');

ok(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close();
srv.kill();
try { fs.unlinkSync(stateFile); } catch { /* fine */ }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
