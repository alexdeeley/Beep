// The page in a real browser.   node dev/browser-test.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import(process.env.PW || 'playwright');
const PORT = 8790, URL0 = `http://localhost:${PORT}/`;
const OUT = process.env.SHOTS || '/tmp/gallery-shots';
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  ✓ ' + l); } else { fail++; console.log('  ✗ ' + l); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = spawn('node', [path.join(ROOT, 'dev/serve.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => srv.stdout.once('data', r));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
async function open(opts = {}, url = URL0) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => document.getElementById('title').textContent.trim().length > 0);
  return { ctx, page };
}
// How many different colours the artwork canvas holds (a blank one has ~1).
const colours = (page) => page.evaluate(() => {
  const c = document.getElementById('art');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const seen = new Set();
  for (let i = 0; i < d.length; i += 4 * 97) seen.add((d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4));
  return seen.size;
});
const snap = (page) => page.evaluate(() => document.getElementById('art').toDataURL());
const text = (page, id) => page.textContent('#' + id);

// ── Desktop ──────────────────────────────────────────────────
{
  const { page } = await open({ viewport: { width: 1280, height: 800 } });
  ok((await text(page, 'title')).length > 3, 'a piece appears on load, with a title');
  const first = await page.inputValue('#seed');
  ok(first.length > 0 && (await page.url()).includes('#'), 'a first seed is chosen and shown in the box and the address');
  await sleep(2500);
  ok((await colours(page)) > 6, 'the artwork is actually drawn');
  await page.screenshot({ path: `${OUT}/desktop-1.png` });

  await page.fill('#seed', 'maisie');
  await page.press('#seed', 'Enter');
  await page.waitForFunction(() => document.getElementById('seedtext').textContent === 'maisie');
  const t1 = await text(page, 'title'), med1 = await text(page, 'medium');
  ok(page.url().endsWith('#maisie'), 'typing a seed puts it in the address (so it can be shared)');
  await sleep(1500);
  const shot1 = await snap(page);

  await page.fill('#seed', 'something else entirely');
  await page.press('#seed', 'Enter');
  await page.waitForFunction(() => document.getElementById('seedtext').textContent === 'something else entirely');
  ok((await text(page, 'title')) !== t1 || (await text(page, 'medium')) !== med1, 'a different seed gives a different piece');

  await page.fill('#seed', '  maisie  ');
  await page.press('#seed', 'Enter');
  await page.waitForFunction(() => document.getElementById('seedtext').textContent === 'maisie');
  ok((await text(page, 'title')) === t1 && (await text(page, 'medium')) === med1, 'the same seed brings back the same piece (spaces ignored)');

  // a fresh visit to the shared link shows the same thing
  const { page: p2 } = await open({ viewport: { width: 1000, height: 700 } }, URL0 + '#maisie');
  ok((await text(p2, 'title')) === t1 && (await p2.inputValue('#seed')) === 'maisie', 'opening a shared link shows the same piece');
  await p2.close();

  await page.click('#shuffle');
  await page.waitForFunction((s) => document.getElementById('seedtext').textContent !== s, 'maisie');
  ok((await page.inputValue('#seed')) !== 'maisie', 'the dice button picks a new seed');

  // empty seed does nothing
  const before = await text(page, 'seedtext');
  await page.fill('#seed', '   ');
  await page.press('#seed', 'Enter');
  await sleep(500);
  ok((await text(page, 'seedtext')) === before, 'an empty seed is ignored');

  // browser back goes to the previous piece
  await page.goBack();
  await page.waitForFunction((s) => document.getElementById('seedtext').textContent !== s, before);
  ok(true, 'the back button steps back through pieces');

  // the art moves
  await page.fill('#seed', 'tides');
  await page.press('#seed', 'Enter');
  await page.waitForFunction(() => document.getElementById('seedtext').textContent === 'tides');
  await sleep(1200);
  const a = await snap(page);
  await sleep(1500);
  const b = await snap(page);
  ok(a !== b, 'the art is alive - it changes over time');

  // saving
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#save')]);
  const file = path.join(OUT, dl.suggestedFilename());
  await dl.saveAs(file);
  const size = fs.statSync(file).size;
  ok(/\.png$/.test(dl.suggestedFilename()) && size > 20000, `saving downloads a big PNG (${dl.suggestedFilename()}, ${Math.round(size / 1024)} KB)`);

  // layout: everything on screen, no scrollbars
  const lay = await page.evaluate(() => {
    const r = (id) => document.getElementById(id).getBoundingClientRect();
    const art = r('art'), form = r('seedform'), plaque = r('plaque');
    return { art, form, plaque, vw: innerWidth, vh: innerHeight, sx: document.documentElement.scrollWidth, sy: document.documentElement.scrollHeight };
  });
  ok(lay.sx <= lay.vw && lay.sy <= lay.vh, 'the page never scrolls');
  ok(lay.art.bottom <= lay.plaque.top + 1 && lay.plaque.bottom <= lay.form.top + 1, 'artwork, label and seed box sit one above the other without overlap');
  await page.screenshot({ path: `${OUT}/desktop-2.png` });
}

// ── Phone ────────────────────────────────────────────────────
{
  const { page } = await open({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true }, URL0 + '#velvet orchard 12');
  await sleep(2000);
  const lay = await page.evaluate(() => {
    const r = (id) => document.getElementById(id).getBoundingClientRect();
    return { art: r('art'), frame: r('frame'), form: r('seedform'), plaque: r('plaque'), vw: innerWidth, vh: innerHeight, sx: document.documentElement.scrollWidth, sy: document.documentElement.scrollHeight, fs: parseFloat(getComputedStyle(document.getElementById('seed')).fontSize) };
  });
  ok(lay.sx <= lay.vw && lay.sy <= lay.vh, 'phone: the page never scrolls');
  ok(lay.frame.left >= 0 && lay.frame.right <= lay.vw, 'phone: the frame fits across the screen');
  ok(lay.fs >= 16, 'phone: the seed box is 16px+ so iOS does not zoom in');
  ok(lay.form.width <= lay.vw - 20 && lay.form.height >= 48, 'phone: the seed bar fits and is easy to tap');
  ok((await colours(page)) > 6, 'phone: the artwork is drawn');
  await page.screenshot({ path: `${OUT}/phone-1.png` });
  await page.fill('#seed', 'kaleidoscope dreams');
  await page.press('#seed', 'Enter');
  await page.waitForFunction(() => document.getElementById('seedtext').textContent === 'kaleidoscope dreams');
  await sleep(1500);
  await page.screenshot({ path: `${OUT}/phone-2.png` });
}

// ── Landscape phone, tiny window, dark mode, reduced motion ──
{
  const { page } = await open({ viewport: { width: 740, height: 360 }, hasTouch: true, isMobile: true, colorScheme: 'dark' }, URL0 + '#night');
  await sleep(1200);
  const lay = await page.evaluate(() => ({ sx: document.documentElement.scrollWidth, sy: document.documentElement.scrollHeight, vw: innerWidth, vh: innerHeight, art: document.getElementById('art').getBoundingClientRect().height }));
  ok(lay.sx <= lay.vw && lay.sy <= lay.vh && lay.art > 100, `short landscape: nothing scrolls and the art keeps room (${Math.round(lay.art)}px tall)`);
  const o = await page.evaluate(() => { const r = (id) => document.getElementById(id).getBoundingClientRect(); return { p: r('plaque'), f: r('seedform'), a: r('art'), m: r('mat') }; });
  ok(o.p.bottom <= o.f.top + 1, 'short landscape: the label is not hidden behind the seed bar');
  ok(Math.abs((o.a.left - o.m.left) - (o.m.right - o.a.right)) <= 1 && Math.abs((o.a.top - o.m.top) - (o.m.bottom - o.a.bottom)) <= 1, 'the mat is an even border all round the artwork');
  await page.screenshot({ path: `${OUT}/landscape-dark.png` });
}
{
  const { page } = await open({ viewport: { width: 900, height: 700 }, reducedMotion: 'reduce' }, URL0 + '#still');
  await sleep(300);
  const a = await snap(page);
  await sleep(1500);
  ok((await snap(page)) === a && (await colours(page)) > 6, 'reduced motion: a finished, still picture');
}

ok(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close();
srv.kill();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
