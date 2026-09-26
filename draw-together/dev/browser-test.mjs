// Two real browsers play a round against the local server.
//   PLAYWRIGHT_BROWSERS_PATH=... node dev/browser-test.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import(process.env.PW || 'playwright');
const PORT = 8797, URL0 = `http://localhost:${PORT}/`;
const OUT = process.env.SHOTS || '/tmp/shots';
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  ✓ ' + l); } else { fail++; console.log('  ✗ ' + l); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = spawn('node', [path.join(ROOT, 'dev/local-server.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => srv.stdout.once('data', r));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
async function player(name, opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|net::ERR_FAILED/.test(m.text())) errors.push(name + ': ' + m.text()); });
  page.on('requestfailed', (r) => { if (!/fonts\.(googleapis|gstatic)/.test(r.url())) errors.push(name + ': failed ' + r.url()); });
  page.frames_ = [];
  page.on('websocket', (ws) => ws.on('framereceived', (f) => page.frames_.push(String(f.payload))));
  await page.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  await page.goto(URL0);
  return { ctx, page };
}

// Alex on an iPad-ish landscape tablet, Maisie on an iPhone.
const A = await player('Alex', { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2 });
const M = await player('Maisie', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });

await A.page.screenshot({ path: `${OUT}/01-home-tablet.png` });
await M.page.screenshot({ path: `${OUT}/01-home-phone.png` });

await A.page.fill('#in-name', 'Alex');
await A.page.click('#btn-create');
await A.page.waitForSelector('#scr-lobby:not([hidden])');
const code = (await A.page.textContent('#lobby-code')).trim();
ok(/^[A-Z]{3,4}[2-9]$/.test(code), 'room created: ' + code);
await A.page.screenshot({ path: `${OUT}/02-lobby-waiting.png` });

// wrong code first
await M.page.fill('#in-name', 'Maisie');
await M.page.click('#btn-join');
await M.page.fill('#in-code', 'NOPE9');
await M.page.click('#btn-join-go');
await M.page.waitForFunction(() => document.querySelector('#join-err').textContent.length > 0);
ok((await M.page.textContent('#join-err')).includes("couldn't find"), 'friendly unknown-code message');
await M.page.screenshot({ path: `${OUT}/03-join-error-phone.png` });
await M.page.fill('#in-code', code.toLowerCase());
await M.page.click('#btn-join-go');
await M.page.waitForSelector('#scr-lobby:not([hidden])');
await A.page.waitForSelector('#btn-start:not([hidden])');
await M.page.screenshot({ path: `${OUT}/04-lobby-guest-phone.png`, fullPage: true });
await A.page.screenshot({ path: `${OUT}/04-lobby-host-tablet.png` });

// Round 1: Alex draws on the tablet
await A.page.click('#btn-start');
await A.page.waitForSelector('#ov-choose:not([hidden]) #btn-ready');
await M.page.waitForSelector('#ov-choose:not([hidden])');
await A.page.screenshot({ path: `${OUT}/05-your-word-tablet.png` });
await M.page.screenshot({ path: `${OUT}/05-waiting-phone.png` });
const word = await A.page.evaluate(() => window.__dt.S.st.word.w);
await A.page.click('#btn-ready');
await M.page.waitForFunction(() => window.__dt.S.st.phase === 'drawing');
await sleep(200);

const inkCount = (page, sel = '.board-host .sheet canvas') => page.evaluate((sel) => {
  let n = 0;
  for (const cv of document.querySelectorAll(sel)) {
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    for (let i = 3; i < d.length; i += 16) if (d[i] > 40) n++;
  }
  return n;
}, sel);

const box = await A.page.locator('.board-host .sheet').boundingBox();
const P = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];

// draw a cat face with the pen, but check Maisie's screen BEFORE lifting the pen
await A.page.mouse.move(...P(0.3, 0.3));
await A.page.mouse.down();
for (let i = 0; i <= 40; i++) {
  const a = (i / 40) * Math.PI * 2;
  await A.page.mouse.move(...P(0.5 + Math.cos(a) * 0.2, 0.55 + Math.sin(a) * 0.25), { steps: 1 });
  if (i === 20) {
    await sleep(120);
    const live = await inkCount(M.page);
    ok(live > 50, `live stroke visible on the other device mid-stroke (${live} ink samples)`);
  }
}
await A.page.mouse.up();
await sleep(150);

async function stroke(page, pts, tool, colorName, sizeIdx) {
  if (tool) await page.click(`#tools [data-tool="${tool}"]`);
  if (colorName) await page.click(`#colors [aria-label="${colorName}"]`);
  if (sizeIdx !== undefined) await page.click(`#sizes .btn >> nth=${sizeIdx}`);
  const b = await page.locator('.board-host .sheet').boundingBox();
  await page.mouse.move(b.x + b.width * pts[0][0], b.y + b.height * pts[0][1]);
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(b.x + b.width * p[0], b.y + b.height * p[1], { steps: 8 });
  await page.mouse.up();
  await sleep(80);
}
// ears (marker, orange), whiskers (crayon), dots, rainbow
await stroke(A.page, [[0.33, 0.38], [0.36, 0.18], [0.44, 0.31]], 'marker', 'Orange', 2);
await stroke(A.page, [[0.56, 0.31], [0.64, 0.18], [0.67, 0.38]], 'marker');
await stroke(A.page, [[0.2, 0.6], [0.4, 0.62]], 'crayon', 'Brown', 1);
await stroke(A.page, [[0.6, 0.62], [0.8, 0.6]], 'crayon');
await stroke(A.page, [[0.1, 0.1], [0.3, 0.12], [0.5, 0.08], [0.9, 0.12]], 'dots', 'Pink', 2);
await stroke(A.page, [[0.1, 0.9], [0.5, 0.85], [0.9, 0.92]], 'rainbow', null, 2);
await stroke(A.page, [[0.45, 0.62], [0.5, 0.66], [0.55, 0.62]], 'pen', 'Black', 2);
await sleep(300);

// the two pictures should match (compare downscaled images)
const snapshot = (page) => page.evaluate(() => {
  const sheet = document.querySelector('.board-host .sheet');
  const [a, b] = sheet.querySelectorAll('canvas');
  const c = document.createElement('canvas'); c.width = 60; c.height = Math.round(60 * a.height / a.width);
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.drawImage(a, 0, 0, c.width, c.height); x.drawImage(b, 0, 0, c.width, c.height);
  return { w: c.width, h: c.height, d: Array.from(x.getImageData(0, 0, c.width, c.height).data) };
});
const diff = (s1, s2) => {
  if (Math.abs(s1.h - s2.h) > 1) return 999;
  let t = 0, n = 0;
  const h = Math.min(s1.h, s2.h);
  for (let i = 0; i < s1.w * h * 4; i++) { if (i % 4 === 3) continue; t += Math.abs(s1.d[i] - s2.d[i]); n++; }
  return t / n;
};
const sA = await snapshot(A.page), sM = await snapshot(M.page);
const d1 = diff(sA, sM);
ok(d1 < 6, `drawer and guesser pictures match (mean diff ${d1.toFixed(2)}) at different sizes/DPR`);
await A.page.screenshot({ path: `${OUT}/06-drawing-tablet.png` });
await M.page.screenshot({ path: `${OUT}/06-watching-phone.png` });

// eraser live
const before = await inkCount(M.page);
await stroke(A.page, [[0.3, 0.55], [0.7, 0.55], [0.3, 0.6], [0.7, 0.6]], 'eraser', null, 1);
await sleep(200);
const after = await inkCount(M.page);
ok(after < before, `eraser synced (${before} → ${after})`);
// undo brings it back
await A.page.click('#btn-undo'); await sleep(250);
const undone = await inkCount(M.page);
ok(undone > after + 20, `undo synced (${after} → ${undone})`);
// clear with confirm, then undo the clear
await A.page.click('#btn-clear');
await A.page.waitForSelector('#ov-confirm:not([hidden])');
await A.page.screenshot({ path: `${OUT}/07-clear-confirm.png` });
await A.page.click('#btn-yes'); await sleep(250);
ok((await inkCount(M.page)) === 0, 'clear synced');
await A.page.click('#btn-undo'); await sleep(250);
ok((await inkCount(M.page)) > 50, 'clear undone');

// reconnect: reload Maisie's page mid-round
await M.page.reload();
await M.page.waitForFunction(() => window.__dt.S.st?.phase === 'drawing');
await sleep(400);
const sM2 = await snapshot(M.page);
ok(diff(sA, sM2) < 6, 'drawing reconstructed after reload');
ok(await M.page.evaluate(() => window.__dt.S.st.players.length === 2), 'no duplicate after reconnect');

// guessing
ok(M.page.frames_.every((f) => !f.toLowerCase().includes(word.toLowerCase())), 'secret word never reached the guesser');
await M.page.fill('#in-guess', 'banana boat');
await M.page.keyboard.press('Enter');
await M.page.waitForSelector('.bubble');
await M.page.screenshot({ path: `${OUT}/08-wrong-guess-phone.png` });
await sleep(400);
await M.page.fill('#in-guess', word.toLowerCase());
await M.page.click('#btn-guess');
await M.page.waitForSelector('#ov-reveal:not([hidden])');
await A.page.waitForSelector('#ov-reveal:not([hidden])');
await sleep(3800);
await M.page.screenshot({ path: `${OUT}/09-reveal-phone.png` });
await A.page.screenshot({ path: `${OUT}/09-reveal-tablet.png` });
ok((await inkCount(M.page, '#replay-host canvas')) > 50, 'replay drew the picture');
const score = await M.page.evaluate(() => window.__dt.S.st.players.find((p) => p.seat === window.__dt.S.st.you).score);
ok(score >= 3, 'guesser scored ' + score);

// Round 2: Maisie draws on the phone with touch
await M.page.click('#btn-next');
await M.page.waitForSelector('#ov-choose:not([hidden]) #btn-ready');
await M.page.screenshot({ path: `${OUT}/10-your-word-phone.png` });
await M.page.click('#btn-ready');
await A.page.waitForFunction(() => window.__dt.S.st.phase === 'drawing');
await sleep(250);
await M.page.screenshot({ path: `${OUT}/11-drawer-phone.png` });
const cdp = await M.ctx.newCDPSession(M.page);
const mb = await M.page.locator('.board-host .sheet').boundingBox();
const tp = (fx, fy) => ({ x: mb.x + mb.width * fx, y: mb.y + mb.height * fy, id: 1, radiusX: 4, radiusY: 4, force: 1 });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [tp(0.2, 0.5)] });
for (let i = 1; i <= 30; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [tp(0.2 + i * 0.02, 0.5 + Math.sin(i / 4) * 0.2)] });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(300);
ok((await inkCount(A.page)) > 50, 'finger drawing on phone appears on tablet');
const scrollY = await M.page.evaluate(() => document.scrollingElement.scrollTop + window.scrollY);
ok(scrollY === 0, 'page did not scroll while drawing');
await M.page.screenshot({ path: `${OUT}/12-drawer-phone-ink.png` });
await A.page.screenshot({ path: `${OUT}/12-guesser-tablet.png` });

// disconnect banner + paused timer
await A.page.goto('about:blank');
await sleep(400);
await M.page.screenshot({ path: `${OUT}/13-buddy-away-phone.png` });
ok(await M.page.isVisible('#banner'), 'disconnect banner shown');
ok(await M.page.evaluate(() => window.__dt.S.st.timer.running === false), 'timer paused');
await A.page.goto(URL0 + '#' + code);
await A.page.waitForFunction(() => window.__dt.S.st?.phase === 'drawing');
await sleep(300);
ok(!(await M.page.isVisible('#banner')), 'banner cleared on return');
ok((await inkCount(A.page)) > 50, 'returning player sees current drawing');

// landscape phone drawer layout + portrait tablet guesser
await M.page.setViewportSize({ width: 844, height: 390 });
await sleep(300);
await M.page.screenshot({ path: `${OUT}/14-drawer-phone-landscape.png` });
await A.page.setViewportSize({ width: 820, height: 1180 });
await sleep(300);
await A.page.screenshot({ path: `${OUT}/14-guesser-tablet-portrait.png` });
await M.page.setViewportSize({ width: 390, height: 844 });

A.page.frames_.length = 0;
await A.page.click('#btn-giveup');
await A.page.click('#btn-yes');
await A.page.waitForSelector('#ov-reveal:not([hidden])');
await sleep(600);
await A.page.screenshot({ path: `${OUT}/15-gaveup-tablet.png` });

// finish the game
let lastPhase = '';
for (let i = 0; i < 90; i++) {
  const phase = await A.page.evaluate(() => window.__dt.S.st.phase + ':' + window.__dt.S.st.round).then((x) => x.split(':')[0]);
  lastPhase = await A.page.evaluate(() => window.__dt.S.st.phase + ' r' + window.__dt.S.st.round + '/' + window.__dt.S.st.settings?.rounds);
  if (phase === 'over') break;
  if (phase === 'reveal') { await A.page.click('#btn-next'); await sleep(150); continue; }
  if (phase === 'choosing') {
    const drawer = (await A.page.evaluate(() => window.__dt.S.st.you === window.__dt.S.st.drawerSeat)) ? A : M;
    await drawer.page.click('#btn-ready'); await sleep(150); continue;
  }
  if (phase === 'drawing') {
    const guesser = (await A.page.evaluate(() => window.__dt.S.st.you === window.__dt.S.st.drawerSeat)) ? M : A;
    await guesser.page.click('#btn-giveup'); await guesser.page.click('#btn-yes'); await sleep(200); continue;
  }
}
console.log('    (loop ended at ' + lastPhase + ')');
await M.page.waitForSelector('#scr-over:not([hidden])');
await M.page.screenshot({ path: `${OUT}/16-game-over-phone.png` });
ok(true, 'reached game over');
await M.page.click('#btn-again');
await A.page.waitForFunction(() => window.__dt.S.st.phase === 'choosing' && window.__dt.S.st.round === 1);
ok(true, 'play again');

ok(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close();
srv.kill();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
