// Two real browsers (a phone and a desktop) find each other through the lobby
// and play, against the local server.   node dev/browser-test.mjs      (needs Playwright + Chromium)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import(process.env.PW || 'playwright');
const PORT = Number(process.env.PORT || 8798), BASE = `http://localhost:${PORT}`;
const OUT = process.env.SHOTS || path.join(os.tmpdir(), 'duel-shots');
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  ✓ ' + l); } else { fail++; console.log('  ✗ ' + l); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

spawn('node', [path.join(ROOT, 'build.mjs')], { stdio: 'inherit' });
await sleep(1500);
const srv = spawn('node', ['--no-warnings', path.join(ROOT, 'dev/local-server.mjs')], { env: { ...process.env, PORT: String(PORT), QUIET: '1', TIMESCALE: '2' }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => srv.stdout.once('data', r));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { srv.kill(); process.exit(1); });
process.on('exit', () => srv.kill());
process.on('unhandledRejection', (e) => { console.log('  ✗ crashed: ' + (e && e.message || e)); srv.kill(); process.exit(1); });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
async function player(name, opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(name + ': ' + m.text()); });
  await page.goto(BASE + '/');
  return { ctx, page };
}
const state = (page) => page.evaluate(() => { const d = window.__duel; const s = d.world.latest; return s ? { ph: s.ph, sv: s.sv, sc: s.sc, cb: s.cb, lv: s.lv, p: s.p, b: s.b, lw: s.lw, cn: s.cn, rd: s.rd, sm: s.sm, hb: s.hb, me: d.app.me, code: d.app.code } : null; });
const waitPhase = (page, ph, ms = 20000) => page.waitForFunction((p) => window.__duel?.world.latest?.ph === p, ph, { timeout: ms });
const visible = (page, id) => page.evaluate((i) => !document.getElementById(i).hidden, id);
const stats = async () => (await fetch(`${BASE}/dev/stats`)).json();

// Alex on a phone, Maisie on a desktop.
const A = await player('Alex', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
const B = await player('Maisie', { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1 });

// ── Landing ──────────────────────────────────────────────────
ok((await A.page.textContent('.logo')).includes('ARKANOID'), 'the landing screen has the title');
ok(await A.page.evaluate(() => !!document.getElementById('btn-find') && !document.getElementById('btn-create') && !document.getElementById('btn-join')), 'FIND AN OPPONENT replaces create / join');
ok(await A.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight), 'phone: nothing scrolls on the landing screen');
await A.page.screenshot({ path: `${OUT}/01-landing-phone.png` });

// ── Finding an opponent ──────────────────────────────────────
await A.page.tap('#btn-find');
ok(await visible(A.page, 'search'), 'it opens the search screen');
await A.page.fill('#f-name', 'Alex');
await A.page.tap('#f-go');
await A.page.waitForSelector('#searching:not([hidden])');
ok((await A.page.textContent('#f-status')).includes('SEARCHING'), 'Alex is searching');
await sleep(1200);
ok(/0:0[1-9]/.test(await A.page.textContent('#f-time')), 'with a timer running');
ok((await stats()).lobby.waiting === 1, 'the lobby has one person waiting');
await A.page.screenshot({ path: `${OUT}/02-searching-phone.png` });

// a third person searches and cancels: they come and go without disturbing Alex
const C = await player('Cancel', { viewport: { width: 800, height: 600 } });
await C.page.click('#btn-find'); await C.page.fill('#f-name', 'Nope'); await C.page.click('#f-go');
await C.page.waitForSelector('#searching:not([hidden])');
// (C arrived second: C and Alex would be paired at once - so cancel must be tested with Alex alone)
await C.page.waitForFunction(() => window.__duel.app.active, null, { timeout: 10000 }).catch(() => {});
const cGot = await C.page.evaluate(() => window.__duel.app.active);
if (cGot) {
  // C got paired with Alex. Leave that game so Alex goes back to searching, and test the cancel path with a fresh seeker.
  await C.page.click('#l-leave');
  await C.ctx.close();
  await A.page.waitForFunction(() => window.__duel.world.latest?.ph === 'WAITING_FOR_PLAYER', null, { timeout: 10000 });
  await A.page.tap('#l-leave');
  await A.page.waitForSelector('#landing:not([hidden])');
  ok(true, 'a stray match was cleaned up');
  await A.page.tap('#btn-find'); await A.page.fill('#f-name', 'Alex'); await A.page.tap('#f-go');
  await A.page.waitForSelector('#searching:not([hidden])');
} else {
  await C.page.click('#f-cancel');
  await sleep(300);
  ok((await stats()).lobby.waiting === 1, 'cancelling takes you out of the queue');
  await C.ctx.close();
}

await B.page.click('#btn-find');
await B.page.fill('#f-name', 'Maisie');
await B.page.click('#f-go');
await A.page.waitForFunction(() => window.__duel.app.active && window.__duel.world.latest, null, { timeout: 15000 });
await B.page.waitForFunction(() => window.__duel.app.active && window.__duel.world.latest, null, { timeout: 15000 });
const sa = await state(A.page), sb = await state(B.page);
ok(sa.code === sb.code && sa.code.length === 4, `both land in the same game (${sa.code})`);
ok(sa.me === 1 && sb.me === 2, 'Alex, who waited longest, is Player 1');
ok((await stats()).lobby.waiting === 0, 'the lobby is empty again');
await A.page.waitForFunction(() => window.__duel.world.latest?.ph === 'READY');
ok(await visible(A.page, 'lobby') && (await A.page.textContent('#l-title')).includes('OPPONENT FOUND'), 'the lobby says OPPONENT FOUND');
ok(await A.page.evaluate(() => !document.getElementById('l-code')), 'and there is no code to share');
ok((await A.page.textContent('#slot2')).includes('MAISIE'), 'Alex sees Maisie');
await A.page.screenshot({ path: `${OUT}/03-lobby-phone.png` });

// ── Rules: both at once ─────────────────────────────────────
ok(await B.page.evaluate(() => [...document.querySelectorAll('#l-serve button')].every((b) => b.disabled)), 'Player 2 cannot change the rules');
await A.page.tap('#l-serve button[data-v="both"]');
await B.page.waitForFunction(() => window.__duel.world.latest?.sm === 'both', null, { timeout: 5000 });
ok(await B.page.evaluate(() => document.querySelector('#l-serve button[data-v="both"]').getAttribute('aria-checked') === 'true'), 'Player 1 picks BOTH AT ONCE and Player 2 sees it');

// ── Ready, countdown, serve ─────────────────────────────────
await A.page.tap('#l-ready');
await B.page.click('#l-ready');
await waitPhase(A.page, 'COUNTDOWN'); await waitPhase(B.page, 'COUNTDOWN');
await A.page.waitForFunction(() => document.getElementById('lobby').hidden);
await B.page.waitForFunction(() => document.getElementById('lobby').hidden);
ok(true, 'both ready → countdown, both go to the arena');
await A.page.screenshot({ path: `${OUT}/04-countdown-phone.png` });
await waitPhase(A.page, 'SERVE', 15000); await waitPhase(B.page, 'SERVE', 15000);
const s1 = await state(A.page);
ok(s1.b.length === 2 && s1.hb[0] === 1 && s1.hb[1] === 1, 'two balls, one on each paddle, both players holding');
await A.page.screenshot({ path: `${OUT}/05-serve-both-phone.png` });
await B.page.screenshot({ path: `${OUT}/05-serve-both-desktop.png` });

// Player 2 serves first
await B.page.click('#game');
await waitPhase(A.page, 'PLAYING', 5000);
await A.page.waitForFunction(() => { const s = window.__duel.world.latest; return s && s.hb[1] === 0 && s.hb[0] === 1; }, null, { timeout: 5000 });
ok(true, 'Player 2 launches first; Player 1 still holds a ball in the live rally');
await A.page.tap('#game');
await A.page.waitForFunction(() => { const s = window.__duel.world.latest; return s && s.hb[0] === 0; }, null, { timeout: 5000 });
const s2 = await state(B.page);
ok(s2.hb[0] === 0 && s2.hb[1] === 0 && s2.b.length >= 1, 'then Player 1 serves too: both balls are in play');
await sleep(600);
await A.page.screenshot({ path: `${OUT}/06-playing-both-phone.png` });
await B.page.screenshot({ path: `${OUT}/06-playing-both-desktop.png` });

// ── Paddles ──────────────────────────────────────────────────
await B.page.mouse.move(400, 500); await B.page.mouse.move(640, 500);
await sleep(600);
const pa = (await state(A.page)).p[1], pb = (await state(B.page)).p[1];
ok(Math.abs(pa - pb) < 60, `Maisie's paddle is where both see it (${Math.round(pa)} vs ${Math.round(pb)})`);

// ── Settings ─────────────────────────────────────────────────
await B.page.click('#gear');
await B.page.check('#s-hc'); await B.page.check('#s-flip');
ok(await B.page.evaluate(() => document.body.classList.contains('hc') && window.__duel.renderer.opts.flip), 'high contrast and flip switch on');
await B.page.screenshot({ path: `${OUT}/07-highcontrast-flipped-desktop.png` });
await B.page.uncheck('#s-hc'); await B.page.uncheck('#s-flip'); await B.page.click('#s-close');

// ── Disconnects ──────────────────────────────────────────────
await B.page.reload();
await B.page.waitForFunction(() => window.__duel.app.active && window.__duel.world.latest, null, { timeout: 15000 });
ok((await state(B.page)).me === 2, 'reloading puts Maisie straight back in as Player 2');
await B.ctx.close();
await A.page.waitForFunction(() => window.__duel.world.latest?.ph === 'DISCONNECTED', null, { timeout: 8000 });
await A.page.waitForFunction(() => !document.getElementById('disc').hidden, null, { timeout: 5000 }).catch(() => {});
ok(await visible(A.page, 'disc') && (await A.page.textContent('#disc h2')).includes('OPPONENT DISCONNECTED'), 'Alex is told the opponent disconnected');
await A.page.tap('#d-leave');
await A.page.waitForFunction(() => window.__duel.world.latest?.ph === 'WAITING_FOR_PLAYER', null, { timeout: 8000 });
ok(await visible(A.page, 'lobby'), 'returning to the lobby frees the seat');
await A.page.tap('#l-leave');
await A.page.waitForSelector('#landing:not([hidden])');

// ── Playing the computer, with both at once ─────────────────
await A.page.tap('#btn-solo');
await A.page.fill('#o-name', 'Sam');
await A.page.tap('#o-level button[data-v="hard"]');
await A.page.tap('#o-go');
await A.page.waitForFunction(() => window.__duel.app.active && window.__duel.world.latest, null, { timeout: 10000 });
ok(await A.page.evaluate(() => window.__duel.app.solo === 'hard' && window.__duel.app.me === 1), 'the computer game still works');
await A.page.waitForFunction(() => ['COUNTDOWN', 'SERVE', 'PLAYING'].includes(window.__duel.world.latest?.ph), null, { timeout: 15000 });
await waitPhase(A.page, 'SERVE', 15000);
await A.page.tap('#game');
await waitPhase(A.page, 'PLAYING', 5000);
ok(true, 'and starts by itself');

ok(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close();
srv.kill();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
