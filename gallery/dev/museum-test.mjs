// The museum in a real browser (software WebGL).   node dev/museum-test.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import(process.env.PW || 'playwright');
const PORT = 8789, URL0 = `http://localhost:${PORT}/`;
const OUT = process.env.SHOTS || '/tmp/museum-shots';
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  ✓ ' + l); } else { fail++; console.log('  ✗ ' + l); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = spawn('node', [path.join(ROOT, 'dev/serve.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => srv.stdout.once('data', r));
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
async function open(opts = {}, hash = '') {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL0 + hash);
  await page.waitForFunction(() => window.museum && window.museum.stats().regions >= 9, null, { timeout: 40000 });
  return { ctx, page };
}

// ── Desktop ──────────────────────────────────────────────────
{
  const { page } = await open({ viewport: { width: 640, height: 400 } });
  const st = await page.evaluate(() => window.museum.stats());
  ok(st.regions === 9 && st.paintings > 100, `the museum opens: ${st.regions} regions, ${st.paintings} paintings hung nearby`);
  ok(st.calls < 400, `drawing stays cheap (${st.calls} draw calls)`);
  ok(!(await page.evaluate(() => document.getElementById('overlay').classList.contains('hidden'))) && (await page.textContent('#enter')).includes('walk'), 'a start card with a way in is shown first');
  ok((await page.evaluate(() => window.museum.world.seed)) === 'the museum' && !(await page.$('#seed')), 'there is one museum - no seed to choose');

  await page.evaluate(() => window.museum.enter());
  ok(await page.evaluate(() => document.getElementById('overlay').classList.contains('hidden')), 'starting hides the card');
  const p0 = await page.evaluate(() => ({ ...window.museum.player }));
  ok(Math.abs(p0.x - 22.5) < 0.01 && Math.abs(p0.z - 26.5) < 0.01, 'you start in the home hall');

  // Walk forward into the entrance wall: you move, then stop at the wall.
  // (The page is paused and stepped by hand, so this doesn't depend on how
  // fast software WebGL happens to draw.)
  await page.evaluate(() => window.museum.pause(true));
  await page.keyboard.down('KeyW');
  await page.evaluate(() => window.museum.step(0.5));
  const mid = await page.evaluate(() => window.museum.player.z);
  ok(mid < 25.2 && mid > 24.3, `holding W walks forward at walking pace (z ${p0.z} → ${mid.toFixed(2)})`);
  await page.evaluate(() => window.museum.step(4));
  await page.keyboard.up('KeyW');
  const end = await page.evaluate(() => ({ z: window.museum.player.z, solid: window.museum.world.solid(Math.floor(window.museum.player.x), Math.floor(window.museum.player.z)) }));
  ok(end.z > 21.25 && end.z < 21.4 && !end.solid, `walking into a wall stops you at it (z ${end.z.toFixed(2)}, wall face at 21)`);

  // The picture in front of you is named.
  await page.evaluate(() => window.museum.step(1));
  const cap = await page.evaluate(() => ({ on: document.getElementById('caption').classList.contains('on'), title: document.getElementById('c-title').textContent, seed: document.getElementById('c-seed').textContent }));
  ok(cap.on && cap.title.length > 3 && cap.seed === 'the museum', `facing the entrance wall names the founder's piece (“${cap.title}”)`);
  ok((await page.evaluate(() => window.museum.stats().textures)) >= 1, 'nearby paintings get real textures');

  // Press E: it opens that seed in the gallery.
  const [popup] = await Promise.all([page.context().waitForEvent('page'), page.keyboard.press('KeyE')]);
  await popup.waitForLoadState();
  ok(popup.url().includes('/art#the%20museum'), 'E opens the picture’s seed in the art viewer');
  await popup.close();

  // Turning around, the caption goes away.
  await page.evaluate(() => { window.museum.controls.yaw = Math.PI; window.museum.step(0.5); });
  ok(!(await page.evaluate(() => document.getElementById('caption').classList.contains('on'))), 'looking away hides the label');

  // Mouse-look sensibility: moving the pointer turns the view.
  const yaw0 = await page.evaluate(() => window.museum.controls.yaw);
  await page.evaluate(() => window.museum.controls.turn(100 * 0.0022, 0));
  ok((await page.evaluate(() => window.museum.controls.yaw)) < yaw0, 'moving the mouse right turns right');

  await page.evaluate(() => { window.museum.teleport(22.5, 26.5, 0); window.museum.step(3); window.museum.render(); });
  await sleep(1500);
  await page.screenshot({ path: `${OUT}/desktop.png`, timeout: 120000 });

  // Far away: the museum streams in around you and lets go of what you left.
  await page.evaluate(() => { window.museum.teleport(40 * 57 + 22.5, -40 * 31 + 22.5, 0.5); window.museum.step(1); });
  const far = await page.evaluate(() => ({ s: window.museum.stats(), solid: window.museum.world.solid(Math.floor(window.museum.player.x), Math.floor(window.museum.player.z)) }));
  ok(far.s.regions === 9 && far.s.paintings > 50 && !far.solid, `teleporting far away: still ${far.s.regions} regions loaded, ${far.s.paintings} paintings, standing in open space`);

  // Where you are is shareable; the museum itself is the same for everyone.
  await page.evaluate(() => { window.museum.teleport(40 * 57 + 22.5, -40 * 31 + 22.5, 1); window.museum.step(0.2); });
  await sleep(1200);
  const link = await page.evaluate(() => window.museum.locationHash());
  ok(/^#\d+\.\d+,-\d+\.\d+,\d+$/.test(link), `the address can carry your place (${link})`);
  const wallsHere = await page.evaluate(() => { const w = window.museum.world, p = window.museum.player; let s = ''; for (let x = -10; x < 10; x++) for (let z = -10; z < 10; z++) s += w.solid(Math.floor(p.x) + x, Math.floor(p.z) + z) ? 1 : 0; return s; });
  const { page: friend, ctx: fctx } = await open({ viewport: { width: 640, height: 400 } }, link);
  const there = await friend.evaluate(() => ({ ...window.museum.player, s: (() => { const w = window.museum.world, p = window.museum.player; let s = ''; for (let x = -10; x < 10; x++) for (let z = -10; z < 10; z++) s += w.solid(Math.floor(p.x) + x, Math.floor(p.z) + z) ? 1 : 0; return s; })() }));
  ok(Math.abs(there.x - (40 * 57 + 22.5)) < 0.2 && Math.abs(there.z - (-40 * 31 + 22.5)) < 0.2, 'a friend opening the link lands in the same spot');
  ok(there.s === wallsHere, '... and sees exactly the same walls there');
  await fctx.close();
  await page.click('#menu');
  await page.click('#home');
  const home = await page.evaluate(() => ({ ...window.museum.player }));
  ok(Math.abs(home.x - 22.5) < 0.01 && Math.abs(home.z - 26.5) < 0.01, 'the menu can take you back to the entrance');

  // ── The visitor's book ──────────────────────────────────────
  await page.click('#enter');
  await page.waitForFunction(() => !document.getElementById('overlay') || document.getElementById('overlay').classList.contains('hidden'));
  await page.evaluate(() => { window.museum.pause(true); window.museum.teleport(40 * 4 + 2.5, 6 * 4 + 2.5, 0); window.museum.step(0.3); });
  ok(await page.isVisible('#signbtn'), 'there is a visitor’s book button on screen');
  await page.keyboard.press('KeyB');       // while the mouse is captured, B opens the book
  await page.waitForFunction(() => window.museum.bookIsOpen());
  ok(await page.evaluate(() => window.museum.bookIsOpen()) && await page.isVisible('#bp-msg'), 'it opens a note panel');
  ok((await page.textContent('#bp-where')).includes('blocks from the entrance'), '... that says where you are');
  await page.fill('#bp-name', 'Tester');
  await page.fill('#bp-msg', 'see www.spam.example for deals');
  await page.click('#bp-send');
  await page.waitForFunction(() => document.getElementById('bp-err').textContent.length > 0);
  ok((await page.textContent('#bp-err')).includes('links'), 'a note with a link is refused, with the reason shown');
  await page.fill('#bp-msg', 'The blue wall is my favourite.');
  await page.press('#bp-msg', 'Control+Enter').catch(() => {});
  await page.click('#bp-send');
  await page.waitForFunction(() => !window.museum.bookIsOpen(), null, { timeout: 15000 });
  ok(await page.evaluate(() => document.getElementById('toast').classList.contains('on')), 'signing closes the panel and says thanks');
  ok(await page.evaluate(() => window.museum.signs.items.size >= 1), 'your sign stands where you wrote it');

  // Walk away a little and look back at it: its note is shown.
  await page.evaluate(() => { const m = window.museum; m.player.x = 40 * 4 + 2.5; m.player.z = 6 * 4 + 2.5 + 2.2; m.controls.yaw = 0; m.step(1); });
  const read = await page.evaluate(() => ({ on: document.getElementById('caption').classList.contains('note'), title: document.getElementById('c-title').textContent, line: document.getElementById('c-line').textContent }));
  ok(read.on && read.title === 'Tester' && read.line.includes('The blue wall is my favourite.'), `looking at the sign shows who wrote it and what (“${read.line}”)`);
  await page.screenshot({ path: `${OUT}/sign.png`, timeout: 120000 });

  // Another visitor, in another browser, finds it there - and on the board.
  const { page: other, ctx: octx } = await open({ viewport: { width: 640, height: 400 } }, '#162.5,26.5,0');
  await other.waitForFunction(() => window.museum.notes().length >= 1, null, { timeout: 15000 });
  ok(await other.evaluate(() => window.museum.signs.items.size >= 1 && window.museum.notes()[0].name === 'Tester'), 'another visitor finds the same note standing at that spot');
  await other.waitForFunction(() => !document.getElementById('explorers').hidden, null, { timeout: 15000 });
  ok((await other.textContent('#explorers-list')).includes('Tester'), 'the farthest-explorers board lists who has been that far');
  await other.click('#explorers-list button');
  const visited = await other.evaluate(() => ({ x: window.museum.player.x, z: window.museum.player.z }));
  ok(Math.abs(visited.x - 162.5) < 1 && Math.abs(visited.z - 26.5) < 1.5, '“Go there” takes you to where they signed');
  await octx.close();

  // The look toggle.
  await page.click('#quality');
  ok((await page.textContent('#quality')).includes('sharp') && !(await page.evaluate(() => document.getElementById('view').classList.contains('chunky'))), 'the look button switches between chunky and sharp');
}

// ── A shared link opens the same museum ──────────────────────
{
  const { page, ctx } = await open({ viewport: { width: 800, height: 500 } });
  const sig = await page.evaluate(() => { const w = window.museum.world; let s = ''; for (let x = 0; x < 60; x++) s += w.solid(x, 21) ? 1 : 0; return s; });
  const { page: p2 } = await open({ viewport: { width: 800, height: 500 } });
  const sig2 = await p2.evaluate(() => { const w = window.museum.world; let s = ''; for (let x = 0; x < 60; x++) s += w.solid(x, 21) ? 1 : 0; return s; });
  ok(sig === sig2 && sig.includes('1'), 'two visitors get exactly the same walls');
  await ctx.close();
}

// ── Phone ────────────────────────────────────────────────────
{
  const { page } = await open({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  ok(!(await page.isHidden('#help-touch')) && (await page.textContent('#enter')).includes('Start'), 'phone: the card explains touch controls');
  const lay = await page.evaluate(() => { const c = document.querySelector('.card').getBoundingClientRect(); return { l: c.left, r: c.right, vw: innerWidth, sx: document.documentElement.scrollWidth }; });
  ok(lay.l >= 0 && lay.r <= lay.vw && lay.sx <= lay.vw, 'phone: the start card fits the screen');
  await page.screenshot({ path: `${OUT}/phone-card.png`, timeout: 120000 });
  await page.tap('#enter');
  await sleep(400);
  await page.tap('#signbtn');
  ok(await page.evaluate(() => window.museum.bookIsOpen()) && await page.isVisible('#bp-msg'), 'phone: the book button opens the note panel');
  await page.screenshot({ path: `${OUT}/phone-book.png`, timeout: 120000 });
  await page.tap('#bp-cancel');
  ok(!(await page.evaluate(() => window.museum.bookIsOpen())), 'phone: Cancel closes it');
  ok(await page.evaluate(() => document.getElementById('overlay').classList.contains('hidden')), 'phone: tapping Start begins');
  await page.evaluate(() => { window.museum.pause(true); window.museum.step(3); window.museum.render(); });
  await sleep(1500);
  await page.screenshot({ path: `${OUT}/phone-walk.png`, timeout: 120000 });
}

ok(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close();
srv.kill();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
