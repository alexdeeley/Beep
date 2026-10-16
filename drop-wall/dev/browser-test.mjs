// Plays a short round in a real browser against the local server and checks
// the shared high scores end to end. node dev/browser-test.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8881);
const OUT = path.join(ROOT, 'dev', 'shots'); fs.mkdirSync(OUT, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT || '/home/user/Beep/node_modules/playwright/index.mjs');
const srv = spawn('node', [path.join(ROOT, 'dev/local-server.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => srv.stdout.once('data', r));
const stop = () => { try { srv.kill(); } catch { /* gone */ } };
process.on('exit', stop);

let passed = 0, failed = 0;
const ok = (c, what) => { if (c) { passed++; console.log('  ✓', what); } else { failed++; console.log('  ✗', what); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const open = async () => {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`); await page.waitForSelector('#scrStart.show');
  return { page, errors };
};

const A = await open();
console.log('The high scores screen');
await A.page.click('#scoresBtn');
await A.page.waitForSelector('#scrScores.show');
const tabs = await A.page.locator('#scoresTabs button').allTextContents();
ok(tabs.length === 6 && tabs.includes('CLASSIC') && tabs.includes('DAILY') && tabs.includes('REACH 10,000'), `one board per mode: ${tabs.join(', ')}`);
await A.page.waitForFunction(() => /No scores|Could not/.test(document.getElementById('scoresBody').textContent));
ok(/No scores on this board yet/.test(await A.page.textContent('#scoresBody')), 'an empty board says so');
ok(/CLASSIC · 7 LANES · STANDARD VALUES · 10 BALLS · CLASSIC PHYSICS/.test(await A.page.textContent('#scoresLabel')), `the board is named after the exact settings ("${(await A.page.textContent('#scoresLabel')).trim()}")`);
await A.page.click('#scoresTabs button:text("REACH 10,000")');
await A.page.waitForFunction(() => /ENDURANCE · REACH 10,000/.test(document.getElementById('scoresLabel').textContent));
ok(true, 'tabs switch boards');
await A.page.screenshot({ path: `${OUT}/01-scores-empty.png` });
await A.page.click('#scoresDone');
await A.page.waitForSelector('#scrStart.show');

console.log('A short round, then ADD ME');
await A.page.evaluate(() => { window.DropWall.settings().balls = 5; });
await A.page.click('#playBtn');
await A.page.waitForFunction(() => window.DropWall.G.running);
for (let i = 0; i < 80; i++) {
  if (await A.page.evaluate(() => document.getElementById('scrResults').classList.contains('show'))) break;
  await A.page.evaluate(() => window.DropWall.drop());
  await sleep(500);
}
await A.page.waitForSelector('#scrResults.show', { timeout: 30000 });
const score = await A.page.evaluate(() => window.DropWall.G.round.score);
ok(score > 0, `round over with ${score} points`);
await A.page.waitForSelector('#hsForm', { timeout: 10000 });
ok(/THIS MAKES THE HIGH SCORES/.test(await A.page.textContent('#resScores')), 'a qualifying score is offered a place on the board');
await A.page.screenshot({ path: `${OUT}/02-results-offer.png`, fullPage: true });
await A.page.fill('#hsName', 'maisie');
await A.page.click('#hsAdd');
await A.page.waitForFunction(() => /YOU ARE #\d+ ON THE BOARD/.test(document.getElementById('resScores').textContent));
ok(/YOU ARE #1 ON THE BOARD/.test(await A.page.textContent('#resScores')), 'added, and told the rank');
ok((await A.page.locator('#resScores .rank.me .nm').textContent()) === 'MAISIE', 'the name is upper-cased and highlighted on the inline board');
ok(await A.page.evaluate(() => JSON.parse(localStorage.getItem('dropwall.name')) === 'MAISIE'), 'the name is remembered for next time');
await A.page.screenshot({ path: `${OUT}/03-results-added.png`, fullPage: true });

console.log('Everyone sees the same board');
const B = await open();
await B.page.evaluate(() => { window.DropWall.settings().balls = 5; });   // same settings, so the same board
await B.page.click('#scoresBtn');
await B.page.waitForFunction(() => document.querySelector('#scoresBody .rank'));
const row = await B.page.locator('#scoresBody .rank').first();
ok((await row.locator('.nm').textContent()) === 'MAISIE' && (await row.locator('.sc').textContent()).replace(/,/g, '') === String(score), 'another device sees MAISIE on the CLASSIC board with that score');
await B.page.screenshot({ path: `${OUT}/04-scores-shared.png` });
const api = await (await fetch(`http://127.0.0.1:${PORT}/api/scores?key=classic:seven:standard:5:classic`)).json();
ok(api.entries.length === 1 && api.entries[0].name === 'MAISIE', 'the API serves the board (5-ball classic, since that is what was played)');
const bad = await fetch(`http://127.0.0.1:${PORT}/api/scores`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'party:x', name: 'X', score: 1 }) });
ok(bad.status === 400, 'a made-up board key is refused');
ok(A.errors.length === 0 && B.errors.length === 0, A.errors.concat(B.errors).length ? 'page errors: ' + A.errors.concat(B.errors).join(' | ') : 'no page errors');

await browser.close(); stop();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
