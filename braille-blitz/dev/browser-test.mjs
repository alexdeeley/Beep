// End-to-end check in a real browser: plays the game the way a person
// would, on phone, tablet and desktop sizes, and screenshots as it goes.
// Run: node dev/browser-test.mjs  (needs Playwright + Chromium on the machine)
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8851);
const OUT = process.env.OUT || path.join(ROOT, 'dev', 'shots');
fs.mkdirSync(OUT, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT || '/home/user/Beep/node_modules/playwright/index.mjs');

const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', path.join(ROOT, 'public')], { stdio: 'ignore' });
const stop = () => { try { srv.kill(); } catch { /* gone */ } };
process.on('exit', stop); process.on('SIGTERM', stop);
await new Promise((r) => setTimeout(r, 800));

let passed = 0, failed = 0;
const ok = (cond, what) => { if (cond) { passed++; console.log('  ✓', what); } else { failed++; console.log('  ✗', what); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = `http://127.0.0.1:${PORT}/`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
async function open({ viewport = { width: 390, height: 844 }, mobile = true, storage = null, reduced = false } = {}) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (storage) await page.addInitScript((s) => { for (const [k, v] of Object.entries(s)) if (!localStorage.getItem(k)) localStorage.setItem(k, v); }, storage);   // seed once; reloads keep what the page saved
  await page.goto(URL);
  await page.waitForSelector('#scr-home:not([hidden])');
  return { page, ctx, errors };
}
const q = (page) => page.evaluate(() => window.__bb.question());
const display = (c) => (/[0-9]/.test(c) ? c : c.toUpperCase());
async function answerRight(page) {
  const cur = await q(page);
  const i = cur.choices.indexOf(cur.answer);
  await page.click(`#answers button[data-i="${i}"]`);
  return cur;
}
async function waitNext(page, n) {
  await page.waitForFunction((n) => { const s = window.__bb.S; return (s.q && s.q.n > n) || !document.getElementById('scr-summary').hidden; }, n, { timeout: 8000 });
}

console.log('Home, rendering, every letter and digit');
{
  const { page, errors } = await open({ storage: { 'braille-blitz.settings.v1': JSON.stringify({ sound: true, vibrate: true, mute: false, speak: true, session: 10 }) } });
  ok((await page.locator('#modes button').count()) === 6, 'five modes plus Numbers in context on the home screen');
  ok(await page.evaluate(() => getComputedStyle(document.body).backgroundColor === 'rgb(0, 0, 0)' && getComputedStyle(document.body).color === 'rgb(255, 255, 255)'), 'black background, white text');
  ok(await page.evaluate(() => /Helvetica|Arial|Liberation/.test(getComputedStyle(document.body).fontFamily) && Number(getComputedStyle(document.body).fontWeight) >= 700), 'bold Helvetica-style font');
  await page.screenshot({ path: `${OUT}/01-home-phone.png`, fullPage: true });
  // every character draws the right dots, and the label never gives the answer away
  const check = await page.evaluate(async () => {
    const B = await import('./js/braille.js');
    const out = [];
    for (const c of [...B.ALPHABET, ...B.DIGITS]) {
      const dots = B.dotsFor(c);
      const html = window.__bb.cellSvg(dots);
      const raised = (html.match(/class="raised"/g) || []).length, empty = (html.match(/class="empty"/g) || []).length;
      out.push({ c, okDots: raised === dots.length && empty === 6 - dots.length, unicode: B.toUnicode(dots) });
    }
    return out;
  });
  ok(check.length === 36 && check.every((x) => x.okDots), 'all 26 letters and 10 digits render with the right raised and empty positions');
  ok(check.slice(0, 26).map((x) => x.unicode).join('') === '⠁⠃⠉⠙⠑⠋⠛⠓⠊⠚⠅⠇⠍⠝⠕⠏⠟⠗⠎⠞⠥⠧⠺⠭⠽⠵', 'and they are the standard Unicode Braille letters');

  console.log('Letters: a full round, right and wrong, double taps, keyboard');
  await page.click('#modes button[data-mode="letters"]');
  await page.waitForSelector('#scr-play:not([hidden])');
  let cur = await q(page);
  ok(cur.n === 1 && cur.total === 10, 'question 1 of 10');
  ok((await page.locator('#answers button').count()) === 3, 'three answer buttons');
  const boxes = await page.locator('#answers button').evaluateAll((bs) => bs.map((b) => b.getBoundingClientRect()));
  ok(boxes.every((b) => b.height >= 64 && b.width >= 64), `answer buttons are at least 64px (smallest ${Math.round(Math.min(...boxes.map((b) => Math.min(b.width, b.height))))}px)`);
  const label = await page.getAttribute('#cells', 'aria-label');
  ok(/Braille: cell with dot/.test(label) && !new RegExp('letter ' + cur.answer.toUpperCase()).test(label), `the cell is described by its dots, not its answer ("${label}")`);
  ok(await page.evaluate(() => { const svg = document.querySelector('#cells svg'); return svg.querySelectorAll('.raised').length === window.__bb.question().cells[0].length; }), 'the cell on screen has the right number of raised dots');
  await page.screenshot({ path: `${OUT}/02-letters-phone.png` });
  // right
  await answerRight(page);
  ok(/Correct!/.test(await page.textContent('#feedback')), 'a right answer says Correct');
  ok((await page.locator('#answers button.right').count()) === 1, 'and the right button is highlighted');
  await page.screenshot({ path: `${OUT}/03-correct-phone.png` });
  await waitNext(page, 1);
  // wrong + double tap
  cur = await q(page);
  const wrongI = cur.choices.findIndex((c) => c !== cur.answer);
  const before = await page.evaluate(() => window.__bb.stats.summary().total);
  await page.click(`#answers button[data-i="${wrongI}"]`);
  const fb = await page.textContent('#feedback');
  ok(/Not quite/.test(fb) && fb.includes(`it was ${display(cur.answer)}`), `a wrong answer reveals the right one ("${fb.trim()}")`);
  ok((await page.locator('#answers button.wrong').count()) === 1 && (await page.locator('#answers button.right').count()) === 1, 'wrong choice and right answer both marked');
  await page.screenshot({ path: `${OUT}/04-wrong-phone.png` });
  const rightI = cur.choices.indexOf(cur.answer);
  await page.click(`#answers button[data-i="${rightI}"]`, { force: true });
  const after = await page.evaluate(() => window.__bb.stats.summary().total);
  ok(after === before + 1, 'a second tap on the same question is ignored');
  await waitNext(page, 2);
  // keyboard: "2" picks the second answer
  cur = await q(page);
  await page.keyboard.press('2');
  await page.waitForFunction(() => document.getElementById('feedback').textContent.length > 0);
  ok(await page.evaluate(() => window.__bb.S.locked), 'pressing 2 answers the question');
  await waitNext(page, 3);
  // pause and resume
  await page.keyboard.press('p');
  ok(!(await page.evaluate(() => document.getElementById('pause-overlay').hidden)), 'P pauses');
  await page.screenshot({ path: `${OUT}/05-paused-phone.png` });
  await page.click('#btn-resume');
  ok(await page.evaluate(() => document.getElementById('pause-overlay').hidden && !window.__bb.S.paused), 'Resume continues');
  // finish the round
  for (let i = 0; i < 12; i++) {
    if (!(await page.evaluate(() => document.getElementById('scr-summary').hidden))) break;
    const c = await q(page); await answerRight(page); await waitNext(page, c.n);
  }
  await page.waitForSelector('#scr-summary:not([hidden])');
  ok(true, 'the round ends on a summary');
  const tiles = await page.textContent('#sum-tiles');
  ok(/9 \/ 10/.test(tiles) && /90%/.test(tiles), `summary shows 9 of 10 and 90% (${tiles.replace(/\s+/g, ' ').trim()})`);
  await page.screenshot({ path: `${OUT}/06-summary-phone.png` });

  console.log('Statistics persist across a reload');
  await page.reload(); await page.waitForSelector('#scr-home:not([hidden])');
  const sm = await page.evaluate(() => window.__bb.stats.summary());
  ok(sm.total === 10 && sm.correct === 9 && sm.longest >= 7 && sm.sessions === 1, `after reload: ${sm.total} answered, ${sm.correct} right, longest streak ${sm.longest}, ${sm.sessions} session`);
  ok(sm.timeMs > 0, 'practice time was recorded');
  await page.click('#btn-stats');
  await page.waitForSelector('#scr-stats:not([hidden])');
  ok((await page.locator('#grid-letters .char').count()) === 26 && (await page.locator('#grid-digits .char').count()) === 10, 'stats screen has a tile for every letter and digit');
  ok((await page.locator('#missed li').count()) >= 1 && !/Nothing missed/.test(await page.textContent('#missed')), 'most-missed lists the one we got wrong');
  ok((await page.locator('#recent span').count()) === 10, 'recent strip shows the last answers');
  await page.screenshot({ path: `${OUT}/07-stats-phone.png`, fullPage: true });
  await page.click('#btn-reset');
  ok(!(await page.evaluate(() => document.getElementById('reset-overlay').hidden)), 'reset asks for confirmation');
  await page.click('#btn-reset-no');
  ok((await page.evaluate(() => window.__bb.stats.summary().total)) === 10, 'declining keeps the statistics');
  await page.click('#btn-reset'); await page.click('#btn-reset-yes');
  ok((await page.evaluate(() => window.__bb.stats.summary().total)) === 0 && (await page.evaluate(() => JSON.parse(localStorage.getItem('braille-blitz.stats.v1')).total)) === 0, 'confirming resets, in memory and in storage');
  await page.click('#btn-stats-back');

  console.log('Settings: sound and vibration toggles, master mute');
  await page.click('#btn-settings');
  await page.waitForSelector('#scr-settings:not([hidden])');
  ok((await page.getAttribute('.switch[data-k="sound"]', 'aria-checked')) === 'true', 'sound starts on');
  await page.click('.switch[data-k="sound"]');
  ok((await page.getAttribute('.switch[data-k="sound"]', 'aria-checked')) === 'false', 'sound toggles off');
  ok(await page.evaluate(() => !window.__bb.settings.get('sound') && !window.__bb.settings.soundOn), 'and the game will not play sounds');
  const vibRow = await page.getAttribute('.switch[data-k="vibrate"]', 'disabled');
  const canVib = await page.evaluate(() => typeof navigator.vibrate === 'function');
  ok(canVib ? vibRow === null : vibRow !== null, canVib ? 'vibration toggle is available here' : 'vibration toggle is disabled where the browser has no Vibration API');
  await page.click('#btn-mute');
  ok((await page.getAttribute('#btn-mute', 'aria-pressed')) === 'true' && (await page.evaluate(() => !window.__bb.settings.vibrateOn)), 'master mute silences everything');
  await page.screenshot({ path: `${OUT}/08-settings-phone.png`, fullPage: true });
  await page.reload(); await page.waitForSelector('#scr-home:not([hidden])');
  ok(await page.evaluate(() => !window.__bb.settings.get('sound') && window.__bb.settings.get('mute')), 'settings persist across a reload');
  await page.click('#btn-mute');     // unmute again for the rest

  console.log('Numbers: number sign first, digits as answers; numbers in context');
  await page.click('#modes button[data-mode="numbers"]:not([data-context])');
  await page.waitForSelector('#scr-play:not([hidden])');
  cur = await q(page);
  ok(cur.cells.length === 2 && (await page.locator('#cells svg').count()) === 2, 'two cells on screen');
  ok(await page.evaluate(() => { const s = document.querySelectorAll('#cells svg')[0]; const r = [...s.querySelectorAll('.raised')].map((c) => c.getAttribute('cy') + c.getAttribute('cx')); return r.length === 4; }), 'the first is the number sign with four raised dots');
  ok(/number sign, then cell with/.test(await page.getAttribute('#cells', 'aria-label')), 'described to screen readers as "number sign, then cell"');
  ok(/Which number/.test(await page.textContent('#prompt')) && /Number sign/.test(await page.textContent('#instruction')), 'the prompt asks for a number and explains the number sign');
  ok(cur.choices.every((c) => /^[0-9]$/.test(c)), 'answers are digits');
  await page.screenshot({ path: `${OUT}/09-numbers-phone.png` });
  const seenDigits = new Set();
  for (let i = 0; i < 10; i++) { const c = await q(page); seenDigits.add(c.answer); await answerRight(page); await waitNext(page, c.n); }
  await page.waitForSelector('#scr-summary:not([hidden])');
  ok(seenDigits.size >= 5, `a round of numbers covered ${seenDigits.size} different digits`);
  await page.click('#btn-sum-home');
  await page.click('#modes button[data-context]');
  await page.waitForSelector('#scr-play:not([hidden])');
  cur = await q(page);
  ok(cur.kind === 'number' && cur.answer.length >= 2 && (await page.locator('#cells svg').count()) === cur.answer.length + 1, `numbers in context: "${cur.answer}" shown as one sign and ${cur.answer.length} cells`);
  await page.screenshot({ path: `${OUT}/10-context-phone.png` });
  await page.click('#btn-quit');

  console.log('Mixed, Practice by Touch, Review');
  await page.click('#modes button[data-mode="mixed"]');
  await page.waitForSelector('#scr-play:not([hidden])');
  const kinds = new Set();
  for (let i = 0; i < 10; i++) { const c = await q(page); kinds.add(c.kind); ok(/Which (letter|number)/.test(await page.textContent('#prompt')), `mixed question ${c.n} says what it wants (${c.kind})`); await answerRight(page); await waitNext(page, c.n); }
  ok(kinds.size === 2, 'a mixed round had both letters and numbers');
  await page.waitForSelector('#scr-summary:not([hidden])');
  await page.click('#btn-sum-home');
  await page.click('#modes button[data-mode="touch"]');
  await page.waitForSelector('#scr-play:not([hidden])');
  cur = await q(page);
  ok(cur.reverse && /^Find the (letter|number)/.test(await page.textContent('#prompt')), `touch mode names the character ("${(await page.textContent('#prompt')).trim()}")`);
  ok((await page.locator('#answers button.reverse svg').count()) >= 3, 'the answers are Braille cells');
  const aria = await page.getAttribute('#answers button[data-i="0"]', 'aria-label');
  ok(/Answer 1: .*dot/.test(aria), `each cell answer is described by its dots ("${aria}")`);
  await page.screenshot({ path: `${OUT}/11-touch-phone.png` });
  await answerRight(page);
  ok(/Correct/.test(await page.textContent('#feedback')), 'picking the right cell is correct');
  await page.click('#btn-quit');
  // make some mistakes, then review only those
  await page.evaluate(() => { for (const k of ['q', 'z', '7']) window.__bb.stats.record({ char: k, correct: false }); });
  await page.click('#modes button[data-mode="review"]');
  await page.waitForSelector('#scr-play:not([hidden])');
  const reviewed = new Set();
  for (let i = 0; i < 6; i++) { const c = await q(page); reviewed.add(c.answer); await answerRight(page); await waitNext(page, c.n); }
  ok([...reviewed].every((c) => ['q', 'z', '7'].includes(c)), `review only asks the missed characters (${[...reviewed].join(' ')})`);
  await page.click('#btn-restart');
  ok((await q(page)).n === 1, 'Restart begins a fresh round');
  await page.click('#btn-quit');
  ok(errors.length === 0, errors.length ? 'page errors: ' + errors.join(' | ') : 'no page errors on the phone');
  await page.context().close();
}

console.log('Layouts: landscape phone, tablet, desktop, reduced motion');
for (const [name, viewport, mobile, reduced] of [['phone-landscape', { width: 844, height: 390 }, true, false], ['tablet', { width: 820, height: 1180 }, true, false], ['desktop', { width: 1280, height: 800 }, false, true]]) {
  const { page, errors } = await open({ viewport, mobile, reduced });
  await page.click('#modes button[data-mode="letters"]');
  await page.waitForSelector('#scr-play:not([hidden])');
  const boxes = await page.locator('#answers button').evaluateAll((bs) => bs.map((b) => b.getBoundingClientRect()));
  const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  const cell = await page.locator('#cells svg').first().boundingBox();
  ok(boxes.length === 3 && boxes.every((b) => b.height >= 64 && b.width >= 64) && !over, `${name}: three big answers (${Math.round(Math.min(...boxes.map((b) => b.height)))}px tall), no sideways scroll`);
  ok(cell.width >= 80, `${name}: the cell is big (${Math.round(cell.width)}px wide)`);
  if (name === 'phone-landscape') ok(cell.y + cell.height <= viewport.height && boxes.every((b) => b.y + b.height <= viewport.height + 1), 'phone-landscape: cell and all three answers fit on one screen');
  if (reduced) ok(await page.evaluate(() => window.__bb.reducedMotion()), 'desktop: reduced-motion preference is seen and honoured');
  await page.screenshot({ path: `${OUT}/12-${name}.png` });
  ok(errors.length === 0, `${name}: no page errors`);
  await page.context().close();
}

console.log('Help explains the number sign');
{
  const { page } = await open({ viewport: { width: 820, height: 1180 } });
  await page.click('#btn-help');
  await page.waitForSelector('#scr-help:not([hidden])');
  const help = await page.textContent('#scr-help');
  ok(/number sign/i.test(help) && /3-4-5-6/.test(help) && /A is 1/.test(help), 'help covers the number sign and the A-J reuse');
  ok((await page.locator('#help-cell svg .no').count()) === 6, 'the help cell shows the six dot numbers');
  await page.screenshot({ path: `${OUT}/13-help-tablet.png`, fullPage: true });
  await page.context().close();
}

await browser.close();
stop();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
