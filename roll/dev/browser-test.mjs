// Two real browsers play a game against the local server.
//   PLAYWRIGHT_BROWSERS_PATH=... node dev/browser-test.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import(process.env.PW || 'playwright');
const PORT = 8796, URL0 = `http://localhost:${PORT}/`;
const OUT = process.env.SHOTS || '/tmp/roll-shots';
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
  await page.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  await page.goto(URL0);
  return { ctx, page };
}

const A = await player('Alex', { viewport: { width: 420, height: 860 } });
const M = await player('Maisie', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

await A.page.screenshot({ path: `${OUT}/01-home.png` });
ok(await A.page.textContent('#logo'), 'home screen shows the logo');

// ── Create ────────────────────────────────────────────────────

await A.page.click('#btn-create');
await A.page.waitForSelector('#scr-create:not([hidden])');
await A.page.fill('#in-name-c', 'Alex');
await A.page.click('#swatches-c .swatch >> nth=0');
await A.page.click('#btn-create-go');
await A.page.waitForSelector('#scr-lobby:not([hidden])');
const code = (await A.page.textContent('#lobby-code')).trim();
ok(/^[A-Z]{3,5}[2-9]$/.test(code), 'room created: ' + code);
ok((await A.page.evaluate(() => location.pathname)) === `/game/${code}`, 'URL updates to /game/CODE');
await A.page.screenshot({ path: `${OUT}/02-lobby-host.png` });

// ── Join ──────────────────────────────────────────────────────

await M.page.click('#btn-join');
await M.page.fill('#in-code', 'NOPE9');
await M.page.fill('#in-name-j', 'Maisie');
await M.page.click('#btn-join-go');
await M.page.waitForFunction(() => document.getElementById('join-err').textContent.length > 0);
ok((await M.page.textContent('#join-err')).includes("couldn't find"), 'friendly unknown-code message');
await M.page.fill('#in-code', code.toLowerCase());
await M.page.click('#btn-join-go');
await M.page.waitForSelector('#scr-lobby:not([hidden])');
await A.page.waitForFunction(() => window.__roll.S.st.players.length === 2);
ok((await A.page.evaluate(() => window.__roll.S.st.players.length)) === 2, 'both players in the lobby');
await M.page.screenshot({ path: `${OUT}/03-lobby-guest.png` });

// Non-host can't start.
await M.page.evaluate(() => window.__roll.S.net.send({ type: 'start' }));
await sleep(150);
ok((await A.page.evaluate(() => window.__roll.S.st.status)) === 'lobby', 'non-host cannot start the game');
ok(await M.page.isHidden('#btn-start'), "guest doesn't even see a Start button");

await A.page.click('#btn-start');
await A.page.waitForSelector('#scr-game:not([hidden])');
await M.page.waitForSelector('#scr-game:not([hidden])');
ok(true, 'host starting moves everyone to the game screen');

// ── Round 1: real UI interaction (roll, hold, roll again, score) ───

const aSeat = await A.page.evaluate(() => window.__roll.S.st.you);
const drawer = (await A.page.evaluate(() => window.__roll.S.st.turnSeat)) === aSeat ? A : M;
const other = drawer === A ? M : A;

await drawer.page.waitForSelector('#btn-roll:not([hidden])');
await drawer.page.click('#btn-roll');
await sleep(700); // let the roll animation settle
const facesAfterRoll1 = await drawer.page.evaluate(() => window.__roll.S.st.dice.slice());
ok(facesAfterRoll1.every((d) => d >= 1 && d <= 6), 'first roll fills all 5 dice');
await drawer.page.screenshot({ path: `${OUT}/04-rolled.png` });
ok((await other.page.evaluate(() => window.__roll.S.st.dice.slice())).join(',') === facesAfterRoll1.join(','), 'the other player sees the exact same dice');

// Regression: right after a roll settles, the button must be usable again
// on its own - not just after some unrelated action (like holding a die)
// happens to force a re-render. Nothing is held yet, so this re-rolls all
// 5 dice - "reroll the same (unheld) dice" with no intervening tap.
ok(!(await drawer.page.isDisabled('#btn-roll')), 'Roll button is enabled again once the roll animation settles, with nothing held');
await drawer.page.click('#btn-roll');
await sleep(700);
ok((await drawer.page.evaluate(() => window.__roll.S.st.rollsUsed)) === 2, 'rolling again immediately (nothing held) works right after the previous roll');

await drawer.page.click('#dice .die >> nth=0');
await sleep(100);
ok(await drawer.page.evaluate(() => window.__roll.S.st.held[0]) === true, 'tapping a die holds it');
ok(await drawer.page.locator('#dice .die').first().evaluate((el) => el.classList.contains('held')), 'held die gets the "held" visual class');
const heldValue = await drawer.page.evaluate(() => window.__roll.S.st.dice[0]);

ok(!(await drawer.page.isDisabled('#btn-roll')), 'Roll button is still enabled after holding a die');
await drawer.page.click('#btn-roll');
await sleep(700);
ok((await drawer.page.evaluate(() => window.__roll.S.st.dice[0])) === heldValue, 'the held die keeps its value through a third roll');
ok((await drawer.page.evaluate(() => window.__roll.S.st.rollsUsed)) === 3, 'roll count is now 3 (the maximum)');
ok((await drawer.page.textContent('#roll-count')).includes('3'), 'the on-screen roll counter shows 3');
ok(await drawer.page.isDisabled('#btn-roll'), 'Roll button correctly disables once all 3 rolls are used');

// Score a category via the real confirm-overlay flow.
const available = await drawer.page.evaluate(() => Array.from(document.querySelectorAll('.score-row.available')).length);
ok(available === 13, 'every category is available before any is used');
await drawer.page.click('.score-row.available >> nth=0');
await drawer.page.waitForSelector('#ov-confirm:not([hidden])');
await drawer.page.screenshot({ path: `${OUT}/05-confirm-score.png` });
ok((await drawer.page.textContent('#confirm-msg')).includes('Score'), 'confirm dialog shows the points on offer');
await drawer.page.click('#btn-yes');
await sleep(150);
ok((await drawer.page.evaluate(() => window.__roll.S.st.turnsTaken ?? 1)) >= 0, 'sanity: state still present after scoring');
ok((await A.page.evaluate(() => window.__roll.S.st.turnSeat)) === (drawer === A ? await M.page.evaluate(() => window.__roll.S.st.you) : aSeat), 'turn passes to the other player');
ok((await drawer.page.evaluate(() => window.__roll.S.st.rollsUsed)) === 0, 'dice and rolls reset for the next turn');

// ── Accessibility / mute smoke ────────────────────────────────

await A.page.click('#btn-a11y-hud');
ok(await A.page.evaluate(() => document.documentElement.classList.contains('a11y-invert')), 'invert-colors toggles on');
await A.page.click('#btn-a11y-hud');
await A.page.click('#btn-mute');
ok((await A.page.getAttribute('#btn-mute', 'aria-pressed')) === 'true', 'mute toggles on');
await A.page.click('#btn-mute');

// ── Disconnect / reconnect ────────────────────────────────────

await M.page.goto('about:blank');
await sleep(400);
ok((await A.page.evaluate(() => window.__roll.S.st.players.find((p) => p.name === 'Maisie').connected)) === false, 'the other client sees Maisie disconnect');
await M.page.goto(URL0 + 'game/' + code);
await M.page.waitForFunction(() => window.__roll.S.st?.status === 'playing');
await sleep(300);
ok((await A.page.evaluate(() => window.__roll.S.st.players.find((p) => p.name === 'Maisie').connected)) === true, 'the other client sees Maisie reconnect');
ok((await M.page.evaluate(() => window.__roll.S.st.players.length)) === 2, 'no duplicate player after reconnect');

// ── Grind the rest of the game to completion (adaptively - real dice) ──

let guard = 0;
while ((await A.page.evaluate(() => window.__roll.S.st.status)) === 'playing' && guard++ < 400) {
  const st = await A.page.evaluate(() => window.__roll.S.st);
  const seat = st.turnSeat;
  const actor = seat === st.you ? A : M;
  await actor.page.evaluate(() => window.__roll.S.net.send({ type: 'roll' }));
  await sleep(30);
  const cat = await actor.page.evaluate(() => {
    const st = window.__roll.S.st;
    const me = st.players.find((p) => p.seat === st.you);
    return Object.keys(me.categories).find((c) => me.categories[c] == null);
  });
  await actor.page.evaluate((id) => window.__roll.S.net.send({ type: 'score', id }), cat);
  await sleep(30);
}
ok((await A.page.evaluate(() => window.__roll.S.st.status)) === 'finished', `game reaches 'finished' (guard=${guard})`);
await A.page.waitForSelector('#scr-over:not([hidden])');
await M.page.waitForSelector('#scr-over:not([hidden])');
await A.page.screenshot({ path: `${OUT}/06-game-over.png` });
ok((await A.page.textContent('#over-winner')).length > 0, 'a winner name is shown');
const rows = await A.page.evaluate(() => document.querySelectorAll('.over-score-row').length);
ok(rows === 2, 'the full score breakdown lists both players');

// ── Play Again ────────────────────────────────────────────────

await A.page.click('#btn-again');
await A.page.waitForFunction(() => window.__roll.S.st.status === 'playing' && window.__roll.S.st.round === 1);
await M.page.waitForFunction(() => window.__roll.S.st.status === 'playing');
ok(true, 'Play Again starts a fresh round with the same players');

// ── Leaving frees the seat ────────────────────────────────────

await M.page.evaluate(() => window.__roll.S.net.send({ type: 'leave' }));
await sleep(300);
ok((await A.page.evaluate(() => window.__roll.S.st.players.length)) === 1, 'leaving removes the player for everyone else watching');

ok(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));

await browser.close();
srv.kill();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
