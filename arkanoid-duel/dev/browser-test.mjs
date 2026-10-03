// Two real browsers (a phone and a desktop) play each other against the local
// server.   node dev/browser-test.mjs      (needs Playwright + Chromium)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import(process.env.PW || 'playwright');
const PORT = 8798, BASE = `http://localhost:${PORT}`;
const OUT = process.env.SHOTS || '/tmp/duel-shots';
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  ✓ ' + l); } else { fail++; console.log('  ✗ ' + l); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

spawn('node', [path.join(ROOT, 'build.mjs')], { stdio: 'inherit' });
await sleep(1500);
const srv = spawn('node', ['--no-warnings', path.join(ROOT, 'dev/local-server.mjs')], { env: { ...process.env, PORT: String(PORT), QUIET: '1', TIMESCALE: '2' }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => srv.stdout.once('data', r));

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
const state = (page) => page.evaluate(() => { const d = window.__duel; const s = d.world.latest; return s ? { ph: s.ph, sv: s.sv, sc: s.sc, cb: s.cb, lv: s.lv, p: s.p, b: s.b, lw: s.lw, cn: s.cn, rd: s.rd, level: d.world.blocks.length, alive: d.world.blocks.filter((b) => b.alive).length, me: d.app.me } : null; });
const waitPhase = (page, ph, ms = 20000) => page.waitForFunction((p) => window.__duel?.world.latest?.ph === p, ph, { timeout: ms });
const visible = (page, id) => page.evaluate((i) => !document.getElementById(i).hidden, id);

// Alex on a phone, Maisie on a desktop.
const A = await player('Alex', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
const B = await player('Maisie', { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1 });

// ── Landing and creating ─────────────────────────────────────
ok((await A.page.textContent('.logo')).includes('ARKANOID'), 'the landing screen has the title');
ok((await A.page.innerText('.tag')).replace(/\s+/g, ' ').includes('TWO PLAYERS. ONE BALL. ONE WALL.'), 'and the tagline');
ok(await A.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight), 'phone: nothing scrolls on the landing screen');
await A.page.screenshot({ path: `${OUT}/01-landing-phone.png` });
await A.page.tap('#btn-create');
ok(await visible(A.page, 'create'), 'CREATE GAME opens the create screen');
const pass0 = await A.page.inputValue('#c-pass');
ok(/^\d{4}$/.test(pass0), `a passcode is suggested (${pass0})`);
await A.page.fill('#c-name', 'Alex');
await A.page.fill('#c-pass', 'maple42');
await A.page.screenshot({ path: `${OUT}/02-create-phone.png` });
await A.page.tap('#c-go');
await A.page.waitForSelector('#lobby:not([hidden])');
const code = (await A.page.textContent('#l-code')).trim();
ok(/^[2-9A-HJ-NP-Z]{4}$/.test(code), `a game code is shown (${code})`);
ok((await A.page.textContent('#l-pass')).includes('•'), 'the passcode is hidden by default...');
await A.page.tap('#l-show');
ok((await A.page.textContent('#l-pass')) === 'maple42', '...and can be shown');
ok((await A.page.textContent('#slot1')).includes('CONNECTED') && (await A.page.textContent('#slot2')).includes('WAITING'), 'the lobby says who is here');
ok(await A.page.evaluate(() => document.getElementById('l-ready').hidden), 'no READY button until there are two players');
await A.page.screenshot({ path: `${OUT}/03-lobby-phone.png` });

// ── Joining: the passcode matters ────────────────────────────
await B.page.click('#btn-join');
await B.page.fill('#j-code', code);
await B.page.fill('#j-pass', 'wrong');
await B.page.fill('#j-name', 'Maisie');
await B.page.click('#j-go');
await B.page.waitForFunction(() => document.getElementById('j-err').textContent.length > 0);
ok((await B.page.textContent('#j-err')).includes('WRONG PASSCODE'), `a wrong passcode is refused: "${await B.page.textContent('#j-err')}"`);
ok(await visible(B.page, 'join'), '...and nobody gets into the lobby');
await B.page.screenshot({ path: `${OUT}/04-wrong-passcode-desktop.png` });
await B.page.fill('#j-pass', 'maple42');
await B.page.click('#j-go');
await B.page.waitForSelector('#lobby:not([hidden])');
await B.page.waitForFunction(() => document.getElementById('slot2').textContent.includes('CONNECTED'));
ok((await B.page.textContent('#slot2')).includes('YOU'), 'the right passcode gets Maisie in as Player 2');
await A.page.waitForFunction(() => document.getElementById('slot2').textContent.includes('CONNECTED'));
ok((await A.page.textContent('#slot2')).includes('MAISIE'), 'Alex sees Maisie arrive, by name');

// a third browser can't get in
const C = await player('Stranger', { viewport: { width: 600, height: 700 } });
await C.page.click('#btn-join'); await C.page.fill('#j-code', code); await C.page.fill('#j-pass', 'maple42'); await C.page.click('#j-go');
await C.page.waitForFunction(() => document.getElementById('j-err').textContent.length > 0);
ok((await C.page.textContent('#j-err')).includes('GAME FULL'), 'a third player gets GAME FULL');
await C.ctx.close();

// ── Ready, countdown, serve ──────────────────────────────────
await A.page.waitForFunction(() => !document.getElementById('l-ready').hidden);
await B.page.waitForFunction(() => !document.getElementById('l-ready').hidden);
await A.page.screenshot({ path: `${OUT}/05-lobby-ready-phone.png` });
await A.page.tap('#l-ready');
await A.page.waitForFunction(() => document.getElementById('l-ready').disabled);
ok((await A.page.textContent('#l-ready')).includes('WAITING'), 'pressing READY shows you are waiting for the opponent');
await B.page.click('#l-ready');
await waitPhase(A.page, 'COUNTDOWN'); await waitPhase(B.page, 'COUNTDOWN');
await A.page.waitForFunction(() => document.getElementById('lobby').hidden);
await B.page.waitForFunction(() => document.getElementById('lobby').hidden);
ok(true, 'both go to the arena');
await sleep(900);
await A.page.screenshot({ path: `${OUT}/06-countdown-phone.png` });
await waitPhase(A.page, 'SERVE'); await waitPhase(B.page, 'SERVE');
const sa = await state(A.page), sb = await state(B.page);
ok(sa.sv === 1 && sb.sv === 1, 'Player 1 serves first, and both screens agree');
ok(sa.level === 64 && sb.level === 64 && sa.alive === 64, 'both see the same 16 x 4 wall');
await A.page.screenshot({ path: `${OUT}/07-serve-phone-p1.png` });
await B.page.screenshot({ path: `${OUT}/07-serve-desktop-p2.png` });

// the receiving player cannot launch
await B.page.mouse.click(600, 400);
await sleep(400);
ok((await state(B.page)).ph === 'SERVE', 'a click from the receiving player does not serve');

// paddle movement syncs: drag on the phone, move the mouse on the desktop
await A.page.evaluate(() => { window.__duel.input.sync(500); });
const box = await A.page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
await A.page.touchscreen.tap(box.w / 2, box.h / 2).catch(() => {});   // (this tap IS the serve; see below)
await sleep(100);
ok((await state(A.page)).ph === 'PLAYING' || (await state(A.page)).ph === 'SERVE', 'tapping the screen as the server launches the ball');
await waitPhase(A.page, 'PLAYING'); await waitPhase(B.page, 'PLAYING');
ok((await state(B.page)).b.length === 1, 'the other screen sees the ball in play');

await B.page.mouse.move(300, 400);
await B.page.mouse.move(900, 400, { steps: 12 });
await sleep(700);
const mv = await state(A.page);
ok(Math.abs(mv.p[1] - (await state(B.page)).p[1]) < 60, `Maisie's paddle moves on Alex's screen too (${Math.round(mv.p[1])})`);
await B.page.keyboard.down('KeyA'); await sleep(500); await B.page.keyboard.up('KeyA');
await A.page.screenshot({ path: `${OUT}/08-playing-phone-p1.png` });
await B.page.screenshot({ path: `${OUT}/08-playing-desktop-p2.png` });

// both screens agree about the ball (same server state), within network + interpolation slack
const ba = (await state(A.page)).b[0], bb = (await state(B.page)).b[0];
ok(!!ba && !!bb && Math.hypot(ba[1] - bb[1], ba[2] - bb[2]) < 260, 'the two screens show the ball in about the same place');

// let it play: someone eventually misses, the serve passes to the other player, blocks break
await B.page.waitForFunction(() => window.__duel.world.latest.ph === 'RALLY_END' || window.__duel.world.latest.ph === 'LEVEL_CLEAR', null, { timeout: 90000 });
ok(true, 'a rally ends');
const afterRally = await state(A.page);
await waitPhase(A.page, 'SERVE', 15000);
const next = await state(A.page);
ok(next.sv !== afterRally.sv, `the serve passes to the other player after a rally (${JSON.stringify({ was: afterRally.sv, now: next.sv })})`);
await B.page.screenshot({ path: `${OUT}/09-p2-serve-desktop.png` });
ok(afterRally.sc !== undefined, 'scores are shown');

// ── Settings ─────────────────────────────────────────────────
await B.page.click('#gear');
ok(await B.page.evaluate(() => !document.getElementById('settings').hidden), 'the settings sheet opens');
await B.page.check('#s-hc'); await B.page.check('#s-flip');
await B.page.screenshot({ path: `${OUT}/10-settings.png` });
await B.page.click('#s-close');
await sleep(300);
ok(await B.page.evaluate(() => document.body.classList.contains('hc') && window.__duel.renderer.opts.flip), 'high contrast and flipped view apply');
await B.page.screenshot({ path: `${OUT}/11-highcontrast-flipped-desktop.png` });
await B.page.click('#gear'); await B.page.uncheck('#s-hc'); await B.page.uncheck('#s-flip'); await B.page.click('#s-close');

// ── Disconnects ──────────────────────────────────────────────
await B.page.reload();               // same tab: keeps its identity, so it slips back in
await A.page.waitForFunction(() => window.__duel.world.latest?.ph === 'DISCONNECTED', null, { timeout: 8000 }).catch(() => {});
await B.page.waitForFunction(() => window.__duel.app.active && window.__duel.world.latest, null, { timeout: 15000 });
ok((await state(B.page)).me === 2, 'reloading puts Maisie straight back in as Player 2');
await A.page.waitForFunction(() => ['COUNTDOWN', 'SERVE', 'PLAYING'].includes(window.__duel.world.latest?.ph) , null, { timeout: 15000 });
ok(true, 'and the match carries on');

await B.ctx.close();                 // really gone
await A.page.waitForFunction(() => window.__duel.world.latest?.ph === 'DISCONNECTED', null, { timeout: 8000 });
await A.page.waitForFunction(() => !document.getElementById('disc').hidden, null, { timeout: 5000 }).catch(() => {});
ok(await visible(A.page, 'disc') && (await A.page.textContent('#disc h2')).includes('OPPONENT DISCONNECTED'), 'Alex is told the opponent disconnected, with WAIT / RETURN TO LOBBY');
await A.page.screenshot({ path: `${OUT}/12-disconnected-phone.png` });
await A.page.tap('#d-leave');
await A.page.waitForFunction(() => window.__duel.world.latest?.ph === 'WAITING_FOR_PLAYER', null, { timeout: 8000 });
ok(await visible(A.page, 'lobby'), 'returning to the lobby frees the seat');

// ── The end screen (shown from a made-up snapshot, to look at it) ──
await A.page.evaluate(() => {
  window.__duel.net.close();           // stop live snapshots overwriting the made-up one
  const w = window.__duel.world; const s = { ...w.latest, ph: 'MATCH_WON', mw: 1, lw: [3, 1], sc: [18400, 12100], rd: [false, false] };
  w.latest = s;
});
await sleep(300);
ok(await visible(A.page, 'end') && (await A.page.textContent('#e-title')).includes('YOU WIN'), 'the end screen says who won');
await A.page.screenshot({ path: `${OUT}/13-end-phone.png` });

ok(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close();
srv.kill();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
