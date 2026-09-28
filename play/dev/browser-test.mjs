// Two real browsers play a full match against the local server.
//   PLAYWRIGHT_BROWSERS_PATH=... node dev/browser-test.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import(process.env.PW || 'playwright');
const PORT = 8788, URL0 = `http://localhost:${PORT}/`;
const OUT = process.env.SHOTS || '/tmp/play-shots';
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  ✓ ' + l); } else { fail++; console.log('  ✗ ' + l); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = spawn('node', [path.join(ROOT, 'dev/local-server.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => srv.stdout.once('data', r));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const errors = [];
async function player(name, opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|net::ERR_FAILED/.test(m.text())) errors.push(name + ': ' + m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  await page.goto(URL0);
  return { ctx, page, name };
}

const A = await player('Alex', { viewport: { width: 420, height: 860 } });
const M = await player('Maisie', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

await A.page.screenshot({ path: `${OUT}/01-home.png` });
ok(await A.page.textContent('#logo'), 'home screen shows the logo');
ok((await A.page.textContent('#stat-games')).trim() === '0', 'home stats start at zero for a fresh browser');

// ── Create + join ────────────────────────────────────────────

await A.page.click('#btn-create');
await A.page.waitForSelector('#scr-create:not([hidden])');
await A.page.fill('#in-name-c', 'Alex');
await A.page.click('#swatches-c .swatch >> nth=0');
await A.page.click('#btn-create-go');
await A.page.waitForSelector('#panel-lobby:not([hidden])');
const code = (await A.page.textContent('#lobby-code')).trim();
ok(/^[A-Z]+\d$/.test(code), 'room created: ' + code);
ok((await A.page.evaluate(() => location.pathname)) === `/room/${code}`, 'URL updates to /room/CODE');
await A.page.screenshot({ path: `${OUT}/02-lobby-host.png` });

await M.page.click('#btn-join');
await M.page.waitForSelector('#scr-join:not([hidden])');
await M.page.fill('#in-code', code);
await M.page.fill('#in-name-j', 'Maisie');
await M.page.click('#btn-join-go');
await M.page.waitForSelector('#panel-lobby:not([hidden])');
await A.page.waitForFunction(() => document.querySelectorAll('#lobby-players .player-row').length === 2);
ok(true, 'second player appears in the host’s lobby list');

// ── Ready / auto-start (no explicit "Start" click exists) ────

await A.page.click('#btn-ready');
await M.page.click('#btn-ready');
await A.page.waitForSelector('#panel-intro:not([hidden])', { timeout: 5000 });
ok(true, 'both ready auto-starts the match straight into the intro beat');
await A.page.screenshot({ path: `${OUT}/03-intro.png` });

// ── Play through the whole match, whatever games get picked ──

const COLOR_LABEL = { red: 'RED', white: 'WHITE', black: 'BLACK', yellow: 'YELLOW' };
const ropeHandled = new Set();

async function driveOneTick(pg) {
  const st = await pg.page.evaluate(() => window.__play?.S?.st);
  if (!st || st.status !== 'playing' || !st.gameState) return;
  const gs = st.gameState;
  const seat = st.you;
  switch (st.currentGameId) {
    case 'big-blast': {
      if (gs.phase === 'choosing' && gs.seats[gs.turnIdx] === seat) {
        const btn = pg.page.locator('.bb-btn.empty').first();
        if (await btn.count()) await btn.click().catch(() => {});
      }
      break;
    }
    case 'hot-potato': {
      if (gs.phase === 'holding' && gs.holder === seat) {
        const btn = pg.page.locator('.hp-target').first();
        if (await btn.count()) await btn.click().catch(() => {});
      }
      break;
    }
    case 'color-panic': {
      if (gs.phase === 'prompt' && gs.seats.includes(seat) && gs.picks[seat] == null) {
        // A little imperfection so the game can actually resolve: two bots
        // playing perfectly forever would never eliminate anyone.
        const mistake = Math.random() < 0.3;
        const label = COLOR_LABEL[mistake ? Object.keys(COLOR_LABEL).find((c) => c !== gs.target) : gs.target];
        await pg.page.locator('.cp-btn', { hasText: label }).click().catch(() => {});
      }
      break;
    }
    case 'rope': {
      // Decide once per (match round, pass) - a real player doesn't get to
      // keep re-rolling their decision every poll until they like the answer.
      const key = pg.name + ':' + st.round + ':' + gs.pass;
      if (gs.phase === 'sweeping' && gs.seats.includes(seat) && !ropeHandled.has(key)) {
        ropeHandled.add(key);
        const mistake = Math.random() < 0.3;
        const willJump = mistake ? !gs.requireJump : gs.requireJump;
        if (willJump) await pg.page.click('#rope-jump').catch(() => {});
      }
      break;
    }
    case 'wobbly-tower': {
      if (gs.phase === 'placing' && gs.seats[gs.turnIdx] === seat) {
        await pg.page.fill('#wt-slider', String(Math.floor((Math.random() - 0.5) * 40))).catch(() => {});
        await pg.page.click('#wt-drop').catch(() => {});
      }
      break;
    }
  }
}

const gamesSeen = new Set();
const start = Date.now();
while (Date.now() - start < 150000) {
  const stA = await A.page.evaluate(() => window.__play?.S?.st);
  if (stA?.status === 'matchover') break;
  if (stA?.currentGameId) gamesSeen.add(stA.currentGameId);
  await driveOneTick(A);
  await driveOneTick(M);
  await sleep(150);
}

const final = await A.page.evaluate(() => window.__play?.S?.st);
ok(final?.status === 'matchover', 'the match reaches matchover within 5 rounds');
ok(gamesSeen.size >= 2, `at least 2 different games were played during the match (saw ${[...gamesSeen].join(', ')})`);
await A.page.screenshot({ path: `${OUT}/04-matchover.png` });

const overWinner = (await A.page.textContent('#over-winner'))?.trim();
ok(!!overWinner, 'match-over screen names a winner: ' + overWinner);
const overScores = await A.page.locator('#over-scores .over-score-row').count();
ok(overScores === 2, 'match-over scoreboard lists both players');

// ── High scores (shared across every game) ────────────────────

const lbRendered = await A.page.locator('#over-leaderboard-list .lb-row, #over-leaderboard-list .lb-empty').count();
ok(lbRendered > 0, 'match-over screen renders the shared high-score list (rows or an empty-state message)');

for (const pg of [A, M]) {
  const formVisible = await pg.page.locator('#hs-form:not([hidden])').count();
  if (formVisible) {
    await pg.page.fill('#hs-name-input', pg.name);
    await pg.page.click('#btn-hs-submit');
    await pg.page.waitForFunction(() => document.getElementById('hs-form').hidden === true, { timeout: 3000 });
    ok(true, `${pg.name} qualified for the high-score board and submitted a name`);
    await pg.page.waitForFunction(
      (name) => [...document.querySelectorAll('#over-leaderboard-list .lb-name')].some((el) => el.textContent === name),
      pg.name,
      { timeout: 3000 },
    );
    ok(true, `${pg.name}'s submitted name now appears in the shared leaderboard`);
  }
}

// The standalone /leaderboard page needs no room or websocket at all.
await A.page.goto(`${URL0}leaderboard`);
await A.page.waitForSelector('#scr-leaderboard:not([hidden])');
await A.page.waitForFunction(() => document.querySelectorAll('#leaderboard-list .lb-row, #leaderboard-list .lb-empty').length > 0, { timeout: 5000 });
ok(true, 'the standalone /leaderboard page loads and renders on its own');
await A.page.goBack();
await A.page.waitForSelector('#panel-matchover:not([hidden])', { timeout: 5000 });

// ── Play again ────────────────────────────────────────────────

await A.page.click('#btn-again');
await A.page.waitForSelector('#panel-lobby:not([hidden])', { timeout: 5000 });
const lobbyAfterAgain = await A.page.evaluate(() => window.__play?.S?.st);
ok(lobbyAfterAgain.status === 'lobby' && lobbyAfterAgain.players.every((p) => p.score === 0), 'Play Again resets scores and returns to the lobby');
await M.page.waitForSelector('#panel-lobby:not([hidden])', { timeout: 5000 });
ok(true, 'the other player is returned to the lobby too');

// ── Reload mid-lobby resumes the same room via sessionStorage ─

await A.page.reload();
await A.page.waitForSelector('#panel-lobby:not([hidden])', { timeout: 5000 });
ok((await A.page.textContent('#lobby-code')).trim() === code, 'reloading the page resumes the same room, not the home screen');

ok(errors.length === 0, errors.length ? 'no console/page errors:\n    ' + errors.join('\n    ') : 'no console/page errors the whole run');

await browser.close();
srv.kill();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
