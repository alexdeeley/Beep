// End-to-end acceptance test in real Chromium (Playwright).
//
//   npm run test:browser            (builds, then runs this against `vite preview`)
//   SHOTS=/tmp/shots node dev/browser-test.mjs   screenshots go to dev/shots by default
//
// Covers: touch drawing on an emulated iPhone without page scrolling, stylus
// (pen) pressure, undo / redo / clear, navigation without losing work,
// persistence across reload, the full basic Latin alphabet, the live preview
// using the generated font, missing-glyph markers, a real .ttf download that
// is parsed back and checked, OTF export, and backup → delete → restore.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';
import opentype from 'opentype.js';

const here = dirname(fileURLToPath(import.meta.url));
const SHOTS = process.env.SHOTS ?? join(here, 'shots');
const OUT = process.env.OUT ?? SHOTS;
mkdirSync(SHOTS, { recursive: true });
const PORT = 4317;
const BASE = `http://localhost:${PORT}/`;
const ref = JSON.parse(readFileSync(join(here, '../src/data/reference-glyphs.json'), 'utf8')).glyphs;

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log(`  ✓ ${msg}`);
  else { failures++; console.log(`  ✗ ${msg}`); }
};

/** Reference outline → strokes in canvas units (a stand-in for someone's handwriting). */
function strokesFor(ch) {
  const toks = ref[ch].d.match(/[MLQCZ]|-?\d+(?:\.\d+)?/g);
  const subs = []; let cur = []; let i = 0, x = 0, y = 0;
  const n = () => Number(toks[i++]);
  const add = (px, py) => {
    const last = cur[cur.length - 1];
    if (last) { const d = Math.hypot(px - last[0], py - last[1]); const k = Math.max(1, Math.floor(d / 14)); for (let s = 1; s <= k; s++) cur.push([last[0] + ((px - last[0]) * s) / k, last[1] + ((py - last[1]) * s) / k]); }
    else cur.push([px, py]);
  };
  while (i < toks.length) {
    const c = toks[i++];
    if (c === 'M') { if (cur.length) subs.push(cur); cur = []; x = n(); y = n(); add(x, y); }
    else if (c === 'L') { x = n(); y = n(); add(x, y); }
    else if (c === 'Q') { const x1 = n(), y1 = n(), x2 = n(), y2 = n(); for (let s = 1; s <= 5; s++) { const t = s / 5, u = 1 - t; add(u*u*x + 2*u*t*x1 + t*t*x2, u*u*y + 2*u*t*y1 + t*t*y2); } x = x2; y = y2; }
    else if (c === 'C') { const x1 = n(), y1 = n(), x2 = n(), y2 = n(), x3 = n(), y3 = n(); for (let s = 1; s <= 6; s++) { const t = s / 6, u = 1 - t; add(u*u*u*x + 3*u*u*t*x1 + 3*u*t*t*x2 + t*t*t*x3, u*u*u*y + 3*u*u*t*y1 + 3*u*t*t*y2 + t*t*t*y3); } x = x3; y = y3; }
    else if (c === 'Z') { if (cur.length) { add(cur[0][0], cur[0][1]); subs.push(cur); cur = []; } }
  }
  if (cur.length) subs.push(cur);
  const cx = (ref[ch].b[0] + ref[ch].b[2]) / 2;
  return subs.map((s) => s.map(([px, py]) => [500 + (px - cx), 950 - py]));
}

async function canvasBox(page) {
  const c = page.locator('[data-testid=canvas]');
  await c.scrollIntoViewIfNeeded();
  return c.boundingBox();
}
const toClient = (b, [x, y]) => [b.x + (x / 1000) * b.width, b.y + (y / 1250) * b.height];

async function drawMouse(page, strokes) {
  const b = await canvasBox(page);
  for (const s of strokes) {
    const [x0, y0] = toClient(b, s[0]);
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    for (const p of s.slice(1)) { const [x, y] = toClient(b, p); await page.mouse.move(x, y); }
    await page.mouse.up();
  }
}

async function drawTouch(page, cdp, strokes) {
  const b = await canvasBox(page);
  for (const s of strokes) {
    const pts = s.map((p) => toClient(b, p));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1] }] });
    for (const [x, y] of pts.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
}

async function drawPen(page, cdp, strokes) {
  const b = await canvasBox(page);
  for (const s of strokes) {
    const pts = s.map((p) => toClient(b, p));
    const ev = (type, [x, y], i) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'pen', force: 0.2 + 0.7 * Math.abs(Math.sin(i / 6)) });
    await ev('mousePressed', pts[0], 0);
    for (let i = 1; i < pts.length; i++) await ev('mouseMoved', pts[i], i);
    await ev('mouseReleased', pts[pts.length - 1], pts.length);
  }
}

const strokeCount = (page) => page.locator('[data-testid=strokes] path').count();
const currentChar = (page) => page.locator('[data-testid=canvas]').getAttribute('data-char');

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: join(here, '..'), stdio: 'pipe' });
for (let i = 0; ; i++) {
  try { if ((await fetch(BASE)).ok) break; } catch { /* not up yet */ }
  if (i > 100) throw new Error('preview server did not start (run `npm run build` first)');
  await new Promise((r) => setTimeout(r, 200));
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  /* ---------------- iPhone: touch ---------------- */
  console.log('iPhone (touch)');
  const phone = await browser.newContext({ ...devices['iPhone 13'], acceptDownloads: true });
  const page = await phone.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const cdp = await phone.newCDPSession(page);
  await page.goto(BASE);
  await page.screenshot({ path: join(SHOTS, 'phone-welcome.png'), fullPage: true });
  await page.getByLabel('Name your font').fill('Test Hand');
  await page.getByRole('button', { name: 'CREATE MY FONT' }).click();
  await page.getByLabel('Your name (optional)').fill('Tess Ter');
  await page.screenshot({ path: join(SHOTS, 'phone-setup.png'), fullPage: true });
  await page.getByRole('button', { name: 'START DRAWING' }).click();
  await page.waitForSelector('[data-testid=canvas]');
  check((await currentChar(page)) === 'A', 'studio opens on A');
  const fits = async (pg) => pg.evaluate(() => { const r = document.querySelector('[data-testid=canvas]').getBoundingClientRect(); return r.bottom <= innerHeight + 1 && r.height > 250; });
  check(await fits(page), 'the whole canvas fits on the iPhone screen');
  await page.waitForSelector('[data-testid=ghost]');
  check(true, 'ghost template is shown');

  await canvasBox(page);
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await drawTouch(page, cdp, strokesFor('A'));
  const scrollAfter = await page.evaluate(() => window.scrollY);
  const nA = await strokeCount(page);
  check(nA === strokesFor('A').length, `capital A drawn with touch (${nA} strokes)`);
  check(scrollBefore === scrollAfter, 'drawing did not scroll the page');
  const order = await page.evaluate(() => {
    const g = document.querySelector('[data-testid=strokes]');
    const gh = document.querySelector('[data-testid=ghost]');
    return !!(g && gh && (gh.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  check(order, 'drawing is layered over the ghost template');
  await page.screenshot({ path: join(SHOTS, 'phone-studio-A.png'), fullPage: true });

  await page.getByRole('button', { name: 'UNDO' }).click();
  check((await strokeCount(page)) === nA - 1, 'undo removes the last stroke');
  await page.getByRole('button', { name: 'REDO' }).click();
  check((await strokeCount(page)) === nA, 'redo restores it');
  await page.getByRole('button', { name: 'CLEAR' }).click();
  if (await page.locator('dialog[open]').count()) await page.getByRole('button', { name: 'Clear drawing' }).click();
  check((await strokeCount(page)) === 0, 'clear empties the glyph');
  await page.getByRole('button', { name: 'UNDO' }).click();
  check((await strokeCount(page)) === nA, 'undo brings a cleared glyph back');

  await page.getByRole('button', { name: /NEXT/ }).click();
  check((await currentChar(page)) === 'B', 'NEXT moves to B');
  await drawPen(page, cdp, strokesFor('B'));
  const nB = await strokeCount(page);
  check(nB === strokesFor('B').length, `B drawn with a pressure-sensitive pen (${nB} of ${strokesFor('B').length} strokes)`);
  await page.getByRole('button', { name: /BACK/ }).click();
  check((await currentChar(page)) === 'A' && (await strokeCount(page)) === nA, 'BACK returns to A with its drawing intact');
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForSelector('[data-testid=canvas]');
  check((await currentChar(page)) === 'A' && (await strokeCount(page)) === nA, 'drawings survive a browser refresh');
  await page.getByRole('button', { name: /NEXT/ }).click();
  check((await strokeCount(page)) === strokesFor('B').length, 'B survived the refresh too');
  await phone.close();

  /* ---------------- iPad: finish the alphabet with a mouse (fast) ---------------- */
  console.log('iPad (draw the alphabet)');
  const pad = await browser.newContext({ ...devices['iPad Pro 11 landscape'], hasTouch: false, isMobile: false, acceptDownloads: true });
  const p2 = await pad.newPage();
  p2.on('pageerror', (e) => errors.push(e.message));
  await p2.goto(BASE);
  // IndexedDB is per-context, so restore the phone's project through a fresh one here.
  await p2.getByRole('button', { name: 'CREATE MY FONT' }).click();
  await p2.getByLabel('Font family name').fill('Test Hand');
  await p2.getByRole('button', { name: 'START DRAWING' }).click();
  await p2.waitForSelector('[data-testid=canvas]');
  check(await fits(p2), 'the whole canvas fits on the iPad screen');
  const letters = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,!?'];
  for (const ch of letters) {
    await p2.goto(`${BASE}${(await p2.evaluate(() => location.hash)).replace(/\/draw.*/, '')}/draw/${encodeURIComponent(ch)}`.replace(`${BASE}#`, `${BASE}#`));
    await p2.waitForFunction((c) => document.querySelector('[data-testid=canvas]')?.getAttribute('data-char') === c, ch);
    await drawMouse(p2, strokesFor(ch));
    await p2.getByRole('button', { name: /NEXT/ }).click();
  }
  await p2.goto(`${BASE}${(await p2.evaluate(() => location.hash)).replace(/\/draw.*/, '/draw/g')}`);
  await p2.waitForSelector('[data-testid=canvas]');
  await p2.screenshot({ path: join(SHOTS, 'ipad-studio.png') });
  const projectHash = (await p2.evaluate(() => location.hash)).replace(/\/draw.*/, '');

  await p2.goto(`${BASE}${projectHash}/review`);
  await p2.waitForSelector('.tile');
  const complete = await p2.locator('.tile.st-complete').count();
  check(complete >= 52, `basic Latin alphabet complete in review (${complete} tiles complete)`);
  await p2.screenshot({ path: join(SHOTS, 'ipad-review.png'), fullPage: true });

  await p2.goto(`${BASE}${projectHash}/preview`);
  await p2.waitForSelector('[data-testid=preview-text]');
  await p2.waitForFunction(() => /real generated font/.test(document.querySelector('.lede')?.textContent ?? ''));
  const fam = await p2.evaluate(() => getComputedStyle(document.querySelector('[data-testid=preview-text]')).fontFamily);
  const loaded = await p2.evaluate((f) => document.fonts.check(`40px ${f.split(',')[0]}`), fam);
  check(/InkprintPreview/.test(fam) && loaded, `preview uses the generated font (${fam.split(',')[0]})`);
  const widths = await p2.evaluate((f) => {
    const c = document.createElement('canvas').getContext('2d');
    c.font = `100px ${f.split(',')[0]}, serif`; const a = c.measureText('Hamburgefonstiv').width;
    c.font = '100px serif'; const b = c.measureText('Hamburgefonstiv').width;
    return [a, b];
  }, fam);
  check(Math.abs(widths[0] - widths[1]) > 5, `generated font has its own metrics (${widths[0].toFixed(0)} vs ${widths[1].toFixed(0)} px)`);
  await p2.getByLabel('Type anything').fill('Café — naïve');
  await p2.waitForTimeout(200);
  const missingMarks = await p2.locator('.missing-glyph').allTextContents();
  check(missingMarks.some((t) => t.includes('é')), `missing characters are marked (${missingMarks.map((t) => t.replace(/\(missing: |\)/g, '')).join(' ')})`);
  await p2.getByLabel('Type anything').fill('The quick brown fox jumps over the lazy dog. Hello, world!');
  await p2.waitForTimeout(300);
  await p2.screenshot({ path: join(SHOTS, 'ipad-preview.png'), fullPage: true });

  await p2.goto(`${BASE}${projectHash}/export`);
  await p2.waitForFunction(() => !document.querySelector('.btn-huge')?.disabled);
  await p2.screenshot({ path: join(SHOTS, 'ipad-export.png'), fullPage: true });
  const [dl] = await Promise.all([p2.waitForEvent('download'), p2.getByRole('button', { name: 'DOWNLOAD MY FONT' }).click()]);
  const ttfPath = join(OUT, dl.suggestedFilename());
  await dl.saveAs(ttfPath);
  check(dl.suggestedFilename() === 'TestHand-Regular.ttf', `downloaded ${dl.suggestedFilename()}`);
  const bytes = readFileSync(ttfPath);
  const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  check(font.outlinesFormat === 'truetype', 'download is a TrueType (glyf) font');
  const mapped = letters.filter((c) => font.charToGlyph(c).index > 0 && font.charToGlyph(c).path.commands.length > 0);
  check(mapped.length === letters.length, `all ${letters.length} drawn characters are mapped to outlines${mapped.length < letters.length ? ' (missing ' + letters.filter((c) => !mapped.includes(c)).join(' ') + ')' : ''}`);
  check(font.names.fontFamily.en === 'Test Hand', 'family name is written into the font');
  await p2.getByText('Download again').waitFor();
  check(true, 'export offers “download again”');

  await p2.getByLabel(/OpenType CFF/).check();
  await p2.waitForFunction(() => /\.otf/.test(document.querySelector('.stats')?.textContent ?? '') && !document.querySelector('.btn-huge')?.disabled);
  const [dl2] = await Promise.all([p2.waitForEvent('download'), p2.getByRole('button', { name: 'DOWNLOAD MY FONT' }).click()]);
  await dl2.saveAs(join(OUT, dl2.suggestedFilename()));
  check(dl2.suggestedFilename() === 'TestHand-Regular.otf' && readFileSync(join(OUT, dl2.suggestedFilename())).subarray(0, 4).toString() === 'OTTO', 'OTF export is a CFF OpenType file');

  const [bk] = await Promise.all([p2.waitForEvent('download'), p2.getByRole('button', { name: /Project backup/ }).click()]);
  const backupPath = join(OUT, 'backup.json');
  await bk.saveAs(backupPath);
  const backup = JSON.parse(readFileSync(backupPath, 'utf8'));
  check(backup.format === 'inkprint-project' && backup.glyphs.length >= letters.length, `backup holds ${backup.glyphs.length} glyphs with strokes`);

  await p2.goto(`${BASE}#/projects`);
  await p2.getByRole('button', { name: 'Delete' }).first().click();
  await p2.getByRole('button', { name: 'Delete project' }).click();
  await p2.waitForFunction(() => document.querySelectorAll('.project-row').length === 0);
  check(true, 'project deleted after confirmation');
  await p2.locator('input[type=file]').setInputFiles(backupPath);
  await p2.waitForSelector('.project-row');
  check(/Test Hand/.test(await p2.locator('.project-row').first().textContent()), 'backup restored into the project list');
  await p2.getByRole('button', { name: 'Open' }).first().click();
  await p2.waitForSelector('[data-testid=canvas]');
  await p2.goto(`${BASE}${(await p2.evaluate(() => location.hash)).replace(/\/draw.*/, '')}/review`);
  await p2.waitForSelector('.tile');
  check((await p2.locator('.tile.st-complete').count()) === complete, 'restored project has every glyph back');
  // Importing the same backup again offers a copy instead of overwriting silently.
  await p2.goto(`${BASE}#/projects`);
  await p2.locator('input[type=file]').setInputFiles(backupPath);
  await p2.getByRole('button', { name: 'Import as a copy' }).click();
  await p2.waitForFunction(() => document.querySelectorAll('.project-row').length === 2);
  check(true, 're-import warns and imports as a copy');
  await p2.screenshot({ path: join(SHOTS, 'ipad-projects.png'), fullPage: true });

  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await pad.close();
} finally {
  await browser.close();
  server.kill();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll browser checks passed');
process.exit(failures ? 1 : 0);
