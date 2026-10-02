// The museum in a real browser (software WebGL).   node dev/museum-test.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import(process.env.PW || 'playwright');
const PORT = 8789, URL0 = `http://localhost:${PORT}/museum.html`;
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
async function open(opts = {}, hash = '#test museum') {
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
  ok((await page.inputValue('#seed')) === 'test museum' && page.url().endsWith('#test%20museum'), 'the museum seed is in the box and the address');

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
  ok(cap.on && cap.title.length > 3 && cap.seed === 'test museum', `facing the entrance wall names the founder's piece (“${cap.title}”)`);
  ok((await page.evaluate(() => window.museum.stats().textures)) >= 1, 'nearby paintings get real textures');

  // Press E: it opens that seed in the gallery.
  const [popup] = await Promise.all([page.context().waitForEvent('page'), page.keyboard.press('KeyE')]);
  await popup.waitForLoadState();
  ok(popup.url().includes('#test%20museum') && !popup.url().includes('museum.html'), 'E opens the picture’s seed in the gallery page');
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

  // A new seed is a new museum.
  await page.click('#menu');          // ☰ brings the start card (and its seed box) back
  ok(await page.isVisible('#seed') && !(await page.evaluate(() => document.getElementById('overlay').classList.contains('hidden'))), 'the menu button brings the card back');
  const before = await page.evaluate(() => { const w = window.museum.world; let n = 0; for (let x = 0; x < 80; x++) for (let z = 0; z < 80; z++) if (w.solid(x, z)) n++; return n; });
  await page.fill('#seed', 'a different museum');
  await page.press('#seed', 'Enter');
  await page.waitForFunction(() => window.museum.world.seed === 'a different museum');
  const after = await page.evaluate(() => { const w = window.museum.world; let n = 0; for (let x = 0; x < 80; x++) for (let z = 0; z < 80; z++) if (w.solid(x, z)) n++; return { n, p: { ...window.museum.player } }; });
  ok(after.n !== before, 'a different seed builds a different museum');
  ok(Math.abs(after.p.x - 22.5) < 0.01 && Math.abs(after.p.z - 26.5) < 0.01, '... and puts you back at its entrance');
  ok(page.url().endsWith('#a%20different%20museum'), '... and updates the shareable address');

  // The look toggle.
  await page.click('#quality');
  ok((await page.textContent('#quality')).includes('sharp') && !(await page.evaluate(() => document.getElementById('view').classList.contains('chunky'))), 'the look button switches between chunky and sharp');
}

// ── A shared link opens the same museum ──────────────────────
{
  const { page, ctx } = await open({ viewport: { width: 800, height: 500 } }, '#test museum');
  const sig = await page.evaluate(() => { const w = window.museum.world; let s = ''; for (let x = 0; x < 60; x++) s += w.solid(x, 21) ? 1 : 0; return s; });
  const { page: p2 } = await open({ viewport: { width: 800, height: 500 } }, '#test museum');
  const sig2 = await p2.evaluate(() => { const w = window.museum.world; let s = ''; for (let x = 0; x < 60; x++) s += w.solid(x, 21) ? 1 : 0; return s; });
  ok(sig === sig2 && sig.includes('1'), 'two visitors with the same link get the same walls');
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
