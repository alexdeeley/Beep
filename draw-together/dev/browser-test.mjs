// Two real browsers play a round against the local server.
//   PLAYWRIGHT_BROWSERS_PATH=... node dev/browser-test.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import(process.env.PW || 'playwright');
const PORT = Number(process.env.PORT || 8797), URL0 = `http://localhost:${PORT}/`;
const OUT = process.env.SHOTS || '/tmp/shots';
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  ✓ ' + l); } else { fail++; console.log('  ✗ ' + l); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Whole-word match, so a short secret word ("Cat") isn't "found" inside ordinary protocol text ("categories").
const leaks = (text, w) => new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(text);

const srv = spawn('node', [path.join(ROOT, 'dev/local-server.mjs')], { env: { ...process.env, PORT: String(PORT), AUTO_UNLOCK_MS: '4000' }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => srv.stdout.once('data', r));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
async function player(name, opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|net::ERR_FAILED/.test(m.text())) errors.push(name + ': ' + m.text()); });
  page.on('requestfailed', (r) => { if (!/fonts\.(googleapis|gstatic)|api\.qrserver\.com/.test(r.url())) errors.push(name + ': failed ' + r.url()); });
  page.frames_ = [];
  page.on('websocket', (ws) => ws.on('framereceived', (f) => page.frames_.push(String(f.payload))));
  await page.route(/fonts\.(googleapis|gstatic)|api\.qrserver\.com/, (r) => r.abort());
  await page.goto(URL0);
  return { ctx, page };
}

// Alex on an iPad-ish landscape tablet, Maisie on an iPhone.
const A = await player('Alex', { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2 });
const M = await player('Maisie', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });

await A.page.screenshot({ path: `${OUT}/01-home-tablet.png` });
await M.page.screenshot({ path: `${OUT}/01-home-phone.png` });

// music starts the moment there's any interaction, even on the home screen -
// deliberately not gated on being in a game (an ambient audio landmark from
// the very first screen, not just a gameplay effect).
await A.page.click('#in-name');
await sleep(150);
ok(await A.page.evaluate(() => window.__dt.music.isPlaying()), 'background music starts on the home screen, before any game');

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
await M.page.waitForFunction(() => document.querySelector('.game')?.classList.contains('sketching'));   // the guesser's board is a scratchpad while the drawer picks
await A.page.screenshot({ path: `${OUT}/05-your-word-tablet.png` });
await M.page.screenshot({ path: `${OUT}/05-waiting-phone.png` });
// word choices: 5 cycling options; running past the 5th pulls a fresh batch
const word0 = await A.page.evaluate(() => window.__dt.S.st.word.w);
await A.page.click('#btn-swap');
await sleep(80);
const word1 = await A.page.evaluate(() => window.__dt.S.st.word.w);
ok(word1 !== word0, 'trying another word shows a different one');
ok((await A.page.evaluate(() => window.__dt.S.st.choiceIdx)) === 1, 'choice index advances');
ok((await A.page.locator('.choice-dots .dot.on').count()) === 1, 'exactly one dot marks the current choice');
for (let i = 0; i < 3; i++) { await A.page.click('#btn-swap'); await sleep(80); }
ok((await A.page.evaluate(() => window.__dt.S.st.choiceIdx)) === 4, 'cycling reaches the last choice in the batch');
await A.page.click('#btn-swap'); // past the 5th choice
await sleep(80);
ok((await A.page.evaluate(() => window.__dt.S.st.choiceIdx)) === 0, 'cycling past the last choice starts a fresh batch (index resets to 0)');
const wordAfterFreshBatch = await A.page.evaluate(() => window.__dt.S.st.word.w);
ok(wordAfterFreshBatch !== word0, 'the fresh batch is genuinely new, never looping back to a word already shown this round');

const word = await A.page.evaluate(() => window.__dt.S.st.word.w);
await A.page.click('#btn-ready');
await M.page.waitForFunction(() => window.__dt.S.st.phase === 'drawing');
await sleep(200);

const inkCount = (page, sel = '.board-host .sheet canvas:not(.ghost)') => page.evaluate((sel) => {
  let n = 0;
  for (const cv of document.querySelectorAll(sel)) {
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    for (let i = 3; i < d.length; i += 16) if (d[i] > 40) n++;
  }
  return n;
}, sel);

// Quick reactions: visible to everyone, gone in about a second, no free text.
ok(await A.page.isVisible('#reactions'), 'reaction buttons are visible while drawing');
await M.page.click('#reactions .btn >> nth=0');
await A.page.waitForSelector('.bubble.reaction');
ok(await A.page.isVisible('.bubble.reaction'), "a guesser's reaction appears on the drawer's screen");
await sleep(1100);
ok(!(await A.page.isVisible('.bubble.reaction')), 'the reaction bubble is gone about a second later');

// Ghost doodles: a guesser can gesture on the drawing without touching the
// real board, and the mark itself fades away on its own.
const ghostInk = (page) => page.evaluate(() => {
  const cv = document.querySelector('.board-host .sheet canvas.ghost');
  if (!cv) return 0;
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 16) if (d[i] > 0) n++;
  return n;
});
const realInkBeforeDoodle = await inkCount(A.page);
const gbox = await M.page.locator('.board-host .sheet').boundingBox();
await M.page.mouse.move(gbox.x + gbox.width * 0.2, gbox.y + gbox.height * 0.2);
await M.page.mouse.down();
await M.page.mouse.move(gbox.x + gbox.width * 0.4, gbox.y + gbox.height * 0.4, { steps: 6 });
await M.page.mouse.up();
await sleep(150);
ok((await ghostInk(A.page)) > 0, "a guesser's doodle appears on the drawer's screen");
ok((await inkCount(A.page)) === realInkBeforeDoodle, "the real drawing is untouched by the guesser's doodle");
await sleep(1200);
ok((await ghostInk(A.page)) > 0, 'the doodle is still visible well under its ten-second lifetime');
await sleep(9300);
ok((await ghostInk(A.page)) === 0, 'the doodle fades away and clears itself on its own after about ten seconds');

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
    const ticks = await M.page.evaluate(() => window.__dt.S.scribbleCount);
    ok(ticks > 0, `guesser hears pen-movement sound while watching the stroke (${ticks} ticks)`);
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

// invert-colors accessibility toggle: the page chrome inverts, but the
// drawn ink itself must stay pixel-identical (the artist's actual color).
const inkPixel = () => A.page.evaluate(() => {
  for (const cv of document.querySelectorAll('.board-host .sheet canvas')) {
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 40) return [d[i - 3], d[i - 2], d[i - 1], d[i]];
  }
  return null;
});
const inkBeforeInvert = await inkPixel();
await A.page.click('#btn-a11y-hud');
ok(await A.page.evaluate(() => document.documentElement.classList.contains('a11y-invert')), 'invert-colors toggle applies the class');
await sleep(150);
ok(JSON.stringify(await inkPixel()) === JSON.stringify(inkBeforeInvert), 'drawn ink pixel unchanged with invert-colors on');
await A.page.click('#btn-a11y-hud'); // back off, so the rest of the test runs against the normal theme
await sleep(150);

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

// pixel brush and fill tool: both devices must show the same picture, and
// both are ordinary undoable ops
{
  const nOps = () => A.page.evaluate(() => window.__dt.S.board.ops.length);
  const opsBefore = await nOps();
  const inkBeforePix = await inkCount(M.page);
  await stroke(A.page, [[0.05, 0.3], [0.2, 0.34]], 'pixel', 'Black', 1);
  await sleep(200);
  ok((await nOps()) === opsBefore + 1, 'pixel stroke adds one op');
  ok((await inkCount(M.page)) > inkBeforePix, 'pixel stroke appears on the guesser\'s screen');
  ok(await A.page.isVisible('#sizes .blob.sq'), 'pixel sizes show square swatches');

  const inkBeforeFill = await inkCount(M.page);
  await stroke(A.page, [[0.5, 0.45]], 'fill', 'Pink');
  await sleep(500);
  ok((await nOps()) === opsBefore + 2, 'fill adds one op');
  ok(await A.page.isVisible('.fill-hint'), 'fill tool shows its hint instead of sizes');
  const inkAfterFill = await inkCount(M.page);
  ok(inkAfterFill > inkBeforeFill + 500, `fill paints the enclosed shape on the guesser's screen (${inkBeforeFill} → ${inkAfterFill})`);
  const dFill = diff(await snapshot(A.page), await snapshot(M.page));
  ok(dFill < 6, `drawer and guesser agree after a fill (mean diff ${dFill.toFixed(2)})`);
  await A.page.screenshot({ path: `${OUT}/06b-fill-tablet.png` });
  await M.page.screenshot({ path: `${OUT}/06b-fill-phone.png` });

  // an eraser stroke across the fill removes paint from it
  await stroke(A.page, [[0.35, 0.45], [0.65, 0.45]], 'eraser', null, 1);
  await sleep(300);
  ok((await inkCount(M.page)) < inkAfterFill, 'eraser removes paint from a filled area');
  await A.page.click('#btn-undo'); await sleep(250);

  await A.page.click('#btn-undo'); await sleep(400); // undo the fill
  const inkUndoFill = await inkCount(M.page);
  ok(inkUndoFill < inkAfterFill - 500, 'undo removes the fill on both devices');
  await A.page.click('#btn-undo'); await sleep(250); // undo the pixel stroke
  ok((await nOps()) === opsBefore, 'pixel and fill undo cleanly back to the earlier drawing');
  ok(diff(await snapshot(A.page), await snapshot(M.page)) < 6, 'both devices agree after undoing them');
}

// reconnect: reload Maisie's page mid-round
await M.page.reload();
await M.page.waitForFunction(() => window.__dt.S.st?.phase === 'drawing');
await sleep(400);
const sM2 = await snapshot(M.page);
ok(diff(sA, sM2) < 6, 'drawing reconstructed after reload');
ok(await M.page.evaluate(() => window.__dt.S.st.players.length === 2), 'no duplicate after reconnect');

// guessing
ok(M.page.frames_.every((f) => !leaks(f, word)), 'secret word never reached the guesser');
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
await sleep(400); // let the pause-on-'over' fade finish
ok(!(await M.page.evaluate(() => window.__dt.music.isPlaying())), 'music pauses on game over (just the chime plays)');

// ── Gallery: the personal filter + remixing another player's drawing ──
{
  const meSeat = await A.page.evaluate(() => window.__dt.S.st.you);
  const meName = await A.page.evaluate(() => window.__dt.S.st.players.find((p) => p.seat === window.__dt.S.st.you)?.name);
  const galleryUrl = `${URL0}gallery.html?code=${code}&you=${meSeat}&name=${encodeURIComponent(meName || '')}`;
  const G = await player('GalleryViewer', { viewport: { width: 900, height: 900 } });
  await G.page.goto(galleryUrl);
  await G.page.waitForSelector('.gcard');
  const totalCards = await G.page.locator('.gcard').count();
  const preCheck = await (await fetch(`${URL0}api/rooms/${code}/gallery`)).json();
  ok(totalCards > 0 && totalCards === preCheck.entries.length, `gallery page shows all ${totalCards} finished drawings (matches server truth)`);
  ok(await G.page.isVisible('#g-filter'), 'the Mine/All filter appears once a "you" seat is known');

  await G.page.click('#btn-filter-mine');
  await sleep(150);
  const mineCards = await G.page.locator('.gcard').count();
  ok(mineCards > 0 && mineCards < totalCards, `"My drawings" filters down to ${mineCards} of ${totalCards}`);

  await G.page.click('#btn-filter-all');
  await sleep(150);
  ok((await G.page.locator('.gcard').count()) === totalCards, 'switching back to All restores every drawing');

  const galleryData = await (await fetch(`${URL0}api/rooms/${code}/gallery`)).json();
  const firstDrawer = galleryData.entries[0].drawerName;

  await G.page.locator('.gcard').nth(0).locator('a', { hasText: 'Add to this drawing' }).click();
  await G.page.waitForSelector('#r-stage:not([hidden])');
  await sleep(300); // the base drawing loads on the next animation frame
  const stageBox = await G.page.locator('#board-host').boundingBox();
  await G.page.mouse.move(stageBox.x + stageBox.width * 0.3, stageBox.y + stageBox.height * 0.3);
  await G.page.mouse.down();
  await G.page.mouse.move(stageBox.x + stageBox.width * 0.6, stageBox.y + stageBox.height * 0.6, { steps: 6 });
  await G.page.mouse.up();
  ok(!(await G.page.isDisabled('#btn-undo')), 'drawing a stroke on top of the loaded drawing enables Undo');

  await G.page.fill('#in-name', 'Remix Tester');
  await G.page.click('#btn-save');
  await G.page.waitForSelector('.gcard');
  const afterCards = await G.page.locator('.gcard').count();
  ok(afterCards === totalCards + 1, `gallery grows by one entry after saving a remix (now ${afterCards})`);
  const lastWho = await G.page.locator('.gcard').last().locator('.who').textContent();
  ok(lastWho.includes('Remix Tester') && lastWho.includes(firstDrawer), `newest card attributes the remix correctly: "${lastWho}"`);

  const galleryAfter = await (await fetch(`${URL0}api/rooms/${code}/gallery`)).json();
  ok(JSON.stringify(galleryAfter.entries[0].ops) === JSON.stringify(galleryData.entries[0].ops), 'the original drawing that was remixed is completely unchanged');

  await G.ctx.close();
}

await M.page.click('#btn-again');
await A.page.waitForFunction(() => window.__dt.S.st.phase === 'choosing' && window.__dt.S.st.round === 1);
ok(true, 'play again');
await sleep(400); // let the resume-on-next-round fade finish
ok(await M.page.evaluate(() => window.__dt.music.isPlaying()), 'music resumes once the next round starts');

// lockGuesses: the drawer can hold guessing back until they say they're ready
{
  const L = await player('Lee', { viewport: { width: 1000, height: 800 } });
  const K = await player('Kai', { viewport: { width: 390, height: 844 } });
  await L.page.fill('#in-name', 'Lee');
  await L.page.click('#btn-create');
  await L.page.waitForSelector('#scr-lobby:not([hidden])');
  const lockCode = (await L.page.textContent('#lobby-code')).trim();
  await L.page.click('#set-lock button:text("Let the drawer finish first")');
  await K.page.fill('#in-name', 'Kai');
  await K.page.click('#btn-join');
  await K.page.fill('#in-code', lockCode);
  await K.page.click('#btn-join-go');
  await L.page.waitForSelector('#btn-start:not([hidden])');
  await L.page.click('#btn-start');
  await L.page.waitForSelector('#ov-choose:not([hidden]) #btn-ready');
  const drawerIsLee = await L.page.evaluate(() => window.__dt.S.st.you === window.__dt.S.st.drawerSeat);
  const Dr = drawerIsLee ? L : K, Gu = drawerIsLee ? K : L;
  await Dr.page.click('#btn-ready');
  await Gu.page.waitForFunction(() => window.__dt.S.st.phase === 'drawing');
  await sleep(150);
  ok(await Gu.page.evaluate(() => window.__dt.S.st.guessesLocked === true), 'guessing starts locked when the setting is on');
  ok(await Gu.page.evaluate(() => document.getElementById('in-guess').disabled), 'guess box disabled while locked');
  ok(await Dr.page.isVisible('#btn-unlock'), 'drawer sees a "Let people guess" button');
  await Dr.page.click('#btn-unlock');
  await Gu.page.waitForFunction(() => window.__dt.S.st.guessesLocked === false);
  ok(!(await Gu.page.evaluate(() => document.getElementById('in-guess').disabled)), 'guess box enabled once the drawer unlocks it');
  const lockWord = await Dr.page.evaluate(() => window.__dt.S.st.word.w);
  await Gu.page.fill('#in-guess', lockWord);
  await Gu.page.click('#btn-guess');
  await Gu.page.waitForSelector('#ov-reveal:not([hidden])');
  ok(true, 'guessing works normally once the drawer unlocks it');
}

// Guessing opens by itself (with a bell) when the drawer never presses the
// button; a private scratchpad for guessers while the drawer picks; the grid.
{
  const P = await player('Pat', { viewport: { width: 1000, height: 800 } });
  const Q = await player('Quinn', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await P.page.fill('#in-name', 'Pat');
  await P.page.click('#btn-create');
  await P.page.waitForSelector('#scr-lobby:not([hidden])');
  const autoCode = (await P.page.textContent('#lobby-code')).trim();
  await P.page.click('#set-lock button:text("Let the drawer finish first")');
  await Q.page.fill('#in-name', 'Quinn');
  await Q.page.click('#btn-join');
  await Q.page.fill('#in-code', autoCode);
  await Q.page.click('#btn-join-go');
  await P.page.waitForSelector('#btn-start:not([hidden])');
  await P.page.click('#btn-start');
  await P.page.waitForFunction(() => window.__dt.S.st?.phase === 'choosing');
  await Q.page.waitForFunction(() => window.__dt.S.st?.phase === 'choosing');
  const drawerIsPat = await P.page.evaluate(() => window.__dt.S.st.you === window.__dt.S.st.drawerSeat);
  const aDr = drawerIsPat ? P : Q, aGu = drawerIsPat ? Q : P;

  // scratchpad while the drawer is choosing
  ok(await aGu.page.evaluate(() => document.getElementById('ov-choose').hidden && document.querySelector('.game').classList.contains('sketching')), 'guesser gets the board as a scratchpad, not a card over it, while the drawer picks');
  ok((await aGu.page.textContent('#hud-main')).includes('Doodle while you wait'), 'and is invited to doodle');
  const sheet = await aGu.page.locator('.sheet').boundingBox();
  const touch = aGu === Q;
  const cx = sheet.x + sheet.width * 0.4, cy = sheet.y + sheet.height * 0.4;
  await aGu.page.mouse.move(cx, cy); await aGu.page.mouse.down(); await aGu.page.mouse.move(cx + 60, cy + 40, { steps: 6 }); await aGu.page.mouse.move(cx + 120, cy + 10, { steps: 6 }); await aGu.page.mouse.up();
  void touch;
  ok(await aGu.page.evaluate(() => window.__dt.hasSketch()), 'the guesser can doodle on it');
  ok(await aGu.page.evaluate(() => { const c = document.querySelector('.layer.sketch'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i]) return true; return false; }), 'and the doodle is actually on the scratchpad layer');
  ok(await aDr.page.evaluate(() => !window.__dt.hasSketch()), 'nothing of it reaches the drawer');

  // the round starts: the doodle is gone, and the clock to auto-open is shown
  await aDr.page.click('#btn-ready');
  await aGu.page.waitForFunction(() => window.__dt.S.st.phase === 'drawing');
  await sleep(200);
  ok(await aGu.page.evaluate(() => !window.__dt.hasSketch() && !document.querySelector('.game').classList.contains('sketching')), 'the scratchpad is wiped the moment the round starts');
  ok(await aGu.page.evaluate(() => window.__dt.S.st.guessesLocked === true && typeof window.__dt.S.st.unlockAt === 'number'), 'guessing is locked, with a time it will open by itself');
  await sleep(400);
  ok(/\(\d:\d\d\)/.test(await aGu.page.textContent('#hud-main')), `the guesser sees the countdown (${(await aGu.page.textContent('#hud-main')).trim().replace(/\s+/g, ' ')})`);
  ok(/\(\d:\d\d\)/.test(await aDr.page.textContent('#btn-unlock')), 'and so does the drawer, on the button');

  // the drawer never presses it: guessing opens anyway, and both hear the bell
  await aGu.page.waitForFunction(() => window.__dt.S.st.guessesLocked === false, null, { timeout: 15000 });
  ok(true, 'guessing opened by itself without the drawer pressing anything');
  await sleep(200);
  ok(await aGu.page.evaluate(() => !!window.__dt.S.autoUnlockedAt) && await aDr.page.evaluate(() => !!window.__dt.S.autoUnlockedAt), 'both screens got the bell event');
  ok(!(await aGu.page.evaluate(() => document.getElementById('in-guess').disabled)), 'and the guesser can guess');
  ok(await aGu.page.evaluate(() => !document.getElementById('banner').hidden && /Ding/.test(document.getElementById('banner').textContent)), 'with a banner saying so');

  // the grid
  ok(await aDr.page.evaluate(() => !document.querySelector('.game').classList.contains('grid')), 'the grid is off to begin with');
  await aDr.page.click('#btn-grid');
  ok(await aDr.page.evaluate(() => document.querySelector('.game').classList.contains('grid') && document.getElementById('btn-grid').getAttribute('aria-pressed') === 'true' && localStorage.getItem('dt.grid') === '1'), 'the grid button overlays a grid and remembers it');
  await aDr.page.screenshot({ path: `${OUT}/grid-drawer.png` });
  await aDr.page.click('#btn-grid');
  ok(await aDr.page.evaluate(() => !document.querySelector('.game').classList.contains('grid')), 'and toggles it off again');
  await P.ctx.close(); await Q.ctx.close();
}

// Emoji tracing guide: drawer-only, never leaked to the guesser
{
  const E1 = await player('Ellie', { viewport: { width: 1000, height: 800 } });
  const E2 = await player('Evan', { viewport: { width: 390, height: 844 } });
  await E1.page.fill('#in-name', 'Ellie');
  await E1.page.click('#btn-create');
  await E1.page.waitForSelector('#scr-lobby:not([hidden])');
  const emojiCode = (await E1.page.textContent('#lobby-code')).trim();
  await E1.page.click('#set-emoji button:text("On (drawer only) 🖍️")');
  await E2.page.fill('#in-name', 'Evan');
  await E2.page.click('#btn-join');
  await E2.page.fill('#in-code', emojiCode);
  await E2.page.click('#btn-join-go');
  await E1.page.waitForSelector('#btn-start:not([hidden])');
  await E1.page.click('#btn-start');
  await E1.page.waitForSelector('#ov-choose:not([hidden]) #btn-ready');
  const drawerIsEllie = await E1.page.evaluate(() => window.__dt.S.st.you === window.__dt.S.st.drawerSeat);
  const eDr = drawerIsEllie ? E1 : E2, eGu = drawerIsEllie ? E2 : E1;
  await eDr.page.click('#btn-ready');
  await eGu.page.waitForFunction(() => window.__dt.S.st.phase === 'drawing');
  await sleep(150);
  const traceEmoji = await eDr.page.evaluate(() => window.__dt.S.st.word.e);
  ok(await eDr.page.isVisible('.layer.trace'), 'drawer sees the emoji tracing guide layer while drawing');
  ok((await eDr.page.textContent('.layer.trace')) === traceEmoji, "the guide shows the round's actual emoji");
  ok(!(await eGu.page.isVisible('.layer.trace')), "the guesser's tracing guide layer stays hidden - it never learns the emoji");
  ok((await eGu.page.evaluate(() => document.querySelector('.layer.trace')?.textContent || '')) === '', "the guesser's DOM never even holds the emoji text, hidden or not");
}

// Free-draw studio: one shared canvas, everyone draws at once, no guessing
{
  const T1 = await player('Tess', { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2 });
  const T2 = await player('Theo', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  await T1.page.fill('#in-name', 'Tess');
  await T1.page.click('#btn-studio');
  await T1.page.waitForSelector('#scr-lobby:not([hidden])');
  const studioCode = (await T1.page.textContent('#lobby-code')).trim();
  await T1.page.waitForFunction(() => window.__dt.S.st?.settings.mode === 'studio');
  ok(await T1.page.isVisible('#set-shape') && !(await T1.page.isVisible('#set-diff')), 'the studio lobby offers a canvas shape, not words and timers');
  ok(await T1.page.isVisible('#btn-start'), 'a studio can be opened with just the host in it');
  await T1.page.screenshot({ path: `${OUT}/20-studio-lobby.png` });
  await T2.page.fill('#in-name', 'Theo');
  await T2.page.click('#btn-join');
  await T2.page.fill('#in-code', studioCode);
  await T2.page.click('#btn-join-go');
  await T2.page.waitForSelector('#scr-lobby:not([hidden])');
  await T1.page.click('#btn-start');
  await T1.page.waitForFunction(() => window.__dt.S.st?.phase === 'studio');
  await T2.page.waitForFunction(() => window.__dt.S.st?.phase === 'studio');
  await sleep(300);
  for (const [who, P] of [['host', T1], ['friend', T2]]) {
    ok((await P.page.locator('#tools .tool').count()) === 12, `${who} gets the full studio tray (12 tools)`);
    ok(!(await P.page.isVisible('#guessbar')) && !(await P.page.isVisible('#reactions')), `${who} sees no guess box or reactions`);
    ok(await P.page.isVisible('#btn-save') && !(await P.page.evaluate(() => document.getElementById('tray').hidden)), `${who} can draw and save`);
  }

  // concurrent strokes: Tess is mid-stroke while Theo draws and finishes his
  const tb = await T1.page.locator('.board-host .sheet').boundingBox();
  const at = (b, fx, fy) => [b.x + b.width * fx, b.y + b.height * fy];
  await T1.page.click('#tools [data-tool="neon"]');
  await T1.page.click('#colors [aria-label="Blue"]');
  await T1.page.mouse.move(...at(tb, 0.1, 0.5));
  await T1.page.mouse.down();
  await T1.page.mouse.move(...at(tb, 0.3, 0.3), { steps: 6 });
  await stroke(T2.page, [[0.2, 0.8], [0.5, 0.75], [0.8, 0.8]], 'stars', 'Orange', 1);
  await T1.page.mouse.move(...at(tb, 0.6, 0.6), { steps: 6 });
  await T1.page.mouse.move(...at(tb, 0.9, 0.3), { steps: 6 });
  await T1.page.mouse.up();
  await sleep(300);
  ok((await inkCount(T2.page)) > 50 && (await inkCount(T1.page)) > 50, 'strokes drawn at the same time all show up');
  const dS1 = diff(await snapshot(T1.page), await snapshot(T2.page));
  ok(dS1 < 6, `both screens show the same picture after overlapping strokes (mean diff ${dS1.toFixed(2)})`);

  // a patterned fill inside a shape drawn on the phone
  await stroke(T2.page, [[0.35, 0.1], [0.65, 0.1], [0.65, 0.22], [0.35, 0.22], [0.35, 0.1]], 'pen', 'Black', 1);
  await sleep(200);
  const beforeFill = await inkCount(T2.page);
  await T1.page.click('#tools [data-tool="fill"]');
  ok((await T1.page.locator('#sizes .btn').count()) === 6, 'the fill tool offers six patterns in the studio');
  await T1.page.click('#colors [aria-label="Pink"]');
  await T1.page.click('#sizes .btn >> nth=1');
  const fb = await T1.page.locator('.board-host .sheet').boundingBox();
  await T1.page.mouse.click(...at(fb, 0.5, 0.16));
  await sleep(700);
  ok((await inkCount(T2.page)) > beforeFill, 'a striped fill appears on the other screen');
  const dFillS = diff(await snapshot(T1.page), await snapshot(T2.page));
  ok(dFillS < 6, `both screens agree after a patterned fill (mean diff ${dFillS.toFixed(2)})`);
  await T1.page.screenshot({ path: `${OUT}/21-studio-tablet.png` });
  await T2.page.screenshot({ path: `${OUT}/21-studio-phone.png` });

  // each person undoes only their own strokes
  const opsOf = (P) => P.page.evaluate(() => window.__dt.S.board.ops.map((o) => o.id + ':' + o.seat));
  const before = (await opsOf(T1)).length;
  await T2.page.click('#btn-undo'); await sleep(300);
  const afterUndoT1 = await opsOf(T1), afterUndoT2 = await opsOf(T2);
  ok(afterUndoT1.length === before - 1 && afterUndoT2.length === before - 1, 'undo removes one stroke on both screens');
  const theoSeat = await T2.page.evaluate(() => window.__dt.S.st.you);
  ok(afterUndoT1.filter((o) => o.endsWith(':' + theoSeat)).length === 1, "undo took Theo's own newest stroke, nobody else's");
  ok(diff(await snapshot(T1.page), await snapshot(T2.page)) < 6, 'screens still agree after an undo');

  // save to the gallery
  await T1.page.click('#btn-save');
  await T2.page.waitForFunction(() => document.getElementById('banner').textContent.includes('saved the drawing'));
  ok(true, 'saving tells the other artist');
  const gal = await (await fetch(`${URL0}api/rooms/${studioCode}/gallery`)).json();
  ok(gal.entries.length === 1 && gal.entries[0].studio, 'the saved canvas is in the gallery');
  await T1.page.click('#btn-hud-gallery', { trial: true });
  ok(true, 'a gallery button is on hand');
  // clear is for everyone
  await T2.page.click('#btn-clear'); await T2.page.click('#btn-yes'); await sleep(300);
  ok((await inkCount(T1.page)) === 0, 'clearing the canvas clears it for everyone');
}

ok(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close();
srv.kill();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
