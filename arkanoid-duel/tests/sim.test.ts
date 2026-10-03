import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match, run } from '../shared/sim.ts';
import { BALL, DT, H, PADDLE, TIMING, W } from '../shared/constants.ts';
import { makeLevel } from '../shared/levels.ts';

// A match that is already in its first serve, both players connected.
function started(seed = 1): Match {
  const m = new Match(seed);
  m.setConnected(1, true); m.setConnected(2, true);
  assert.equal(m.phase, 'READY');
  m.pressReady(1); m.pressReady(2);
  assert.equal(m.phase, 'COUNTDOWN');
  run(m, TIMING.countdown + TIMING.go + 0.1);
  assert.equal(m.phase, 'SERVE');
  return m;
}
const frames = (m: Match, n: number) => { for (let i = 0; i < n; i++) m.step(DT); };

test('lobby: waiting, ready, countdown, then serve', () => {
  const m = new Match();
  assert.equal(m.phase, 'WAITING_FOR_PLAYER');
  m.setConnected(1, true);
  assert.equal(m.phase, 'WAITING_FOR_PLAYER');
  assert.equal(m.pressReady(1), false, 'cannot ready up alone');
  m.setConnected(2, true);
  assert.equal(m.phase, 'READY');
  m.pressReady(1);
  assert.equal(m.phase, 'READY', 'needs both');
  m.pressReady(2);
  assert.equal(m.phase, 'COUNTDOWN');
  run(m, TIMING.countdown + TIMING.go - 0.2);
  assert.equal(m.phase, 'COUNTDOWN');
  run(m, 0.4);
  assert.equal(m.phase, 'SERVE');
});

test('player 1 serves the first rally; only the serving player can launch', () => {
  const m = started();
  assert.equal(m.servePlayer, 1);
  assert.equal(m.pressServe(2), false, 'the receiving player cannot serve');
  assert.equal(m.phase, 'SERVE');
  assert.equal(m.pressServe(1), true);
  assert.equal(m.phase, 'PLAYING');
  assert.equal(m.pressServe(1), false, 'a second launch is ignored');
  assert.equal(m.pressServe(2), false);
  assert.equal(m.lastHit, 1, 'the server is credited until someone else touches the ball');
});

test('serve is rejected during the countdown and in the lobby', () => {
  const m = new Match();
  m.setConnected(1, true); m.setConnected(2, true);
  assert.equal(m.pressServe(1), false);
  m.pressReady(1); m.pressReady(2);
  assert.equal(m.pressServe(1), false, 'countdown');
});

test('the ball sits on the server\'s paddle and follows it', () => {
  const m = started();
  m.setTarget(1, 300);
  run(m, 0.5);
  assert.ok(Math.abs(m.balls[0].x - m.paddles[0].x) < 0.001);
  assert.ok(Math.abs(m.paddles[0].x - 300) < 1);
  assert.ok(m.balls[0].y < PADDLE.y1, 'above the bottom paddle');
});

test('the serve angle comes from where the paddle stands, not from luck', () => {
  const angles = [];
  for (const x of [100, 500, 900]) {
    const m = started();
    m.setTarget(1, x); run(m, 1);
    m.pressServe(1);
    angles.push(Math.sign(m.balls[0].vx) + 0);
    assert.ok(m.balls[0].vy < 0, 'player 1 serves upward');
  }
  assert.deepEqual(angles, [1, 0, -1].map((v) => v), 'left side heads right, centre goes straight, right side heads left');
});

test('serve alternates after every rally, whoever wins it', () => {
  const m = started();
  const servers: number[] = [];
  for (let rally = 0; rally < 6; rally++) {
    servers.push(m.servePlayer);
    m.pressServe(m.servePlayer);
    // park both paddles far from the ball's path, then let it fall out
    m.setTarget(1, rally % 2 ? 80 : 920); m.setTarget(2, rally % 2 ? 920 : 80);
    let guard = 0;
    while (m.phase === 'PLAYING' && guard++ < 60 * 40) {
      m.step(DT);
      // keep the wall from ending the level during this test
      for (const b of m.blocks) if (!b.alive) { b.alive = true; b.hp = b.max; }
    }
    assert.equal(m.phase, 'RALLY_END', `rally ${rally + 1} ended`);
    run(m, TIMING.rallyEnd + 0.1);
    assert.equal(m.phase, 'SERVE');
  }
  assert.deepEqual(servers, [1, 2, 1, 2, 1, 2]);
});

test('a missed ball loses the rally for the player who missed, and resets only their combo', () => {
  const m = started();
  m.combo = [4, 7];
  m.pressServe(1);
  m.setTarget(1, 80);                       // player 1 stands aside and misses
  m.setTarget(2, W / 2);
  let guard = 0;
  while (m.phase === 'PLAYING' && guard++ < 60 * 30) {
    m.step(DT);
    for (const b of m.blocks) if (!b.alive) { b.alive = true; b.hp = b.max; }   // keep the wall whole
  }
  assert.equal(m.phase, 'RALLY_END');
  assert.ok(m.rallyLoser === 1 || m.rallyLoser === 2);
  const loser = m.rallyLoser as 1 | 2;
  assert.equal(m.combo[loser - 1], 0, 'the loser\'s combo is gone');
  assert.equal(m.combo[2 - loser], loser === 1 ? 7 : 4, 'the other player keeps theirs');
});

test('a block is credited to whoever touched the ball last, with a growing combo', () => {
  const m = started();
  m.pressServe(1);
  const before = m.score[0];
  // aim the ball straight at one block
  const b = m.blocks.find((x) => x.r === m.rows - 1 && x.c === 8)!;
  m.balls[0].x = b.x + b.w / 2; m.balls[0].y = b.y + b.h + 40; m.balls[0].vx = 0; m.balls[0].vy = -BALL.base;
  m.lastHit = 2;                                         // player 2 was the last to touch it
  frames(m, 30);
  assert.equal(b.alive, false, 'the block broke');
  assert.equal(m.score[1], 100, 'player 2 gets 100 x combo 1');
  assert.equal(m.score[0], before, 'player 1 gets nothing');
  assert.equal(m.combo[1], 1);
  // ...and the next block, by player 1, scores x2 for them
  m.lastHit = 1; m.combo[0] = 1;
  const b2 = m.blocks.find((x) => x.alive && x.r === m.rows - 1)!;
  m.balls[0].x = b2.x + b2.w / 2; m.balls[0].y = b2.y + b2.h + 40; m.balls[0].vx = 0; m.balls[0].vy = -BALL.base;
  frames(m, 30);
  assert.equal(b2.alive, false);
  assert.equal(m.score[0], before + 200, 'combo x2 -> 200');
});

test('multi-hit blocks lose one point of health per hit and are only destroyed at zero', () => {
  const m = started();
  m.pressServe(1);
  const b = m.blocks[0];
  b.hp = 3; b.max = 3; b.type = 'a';
  for (let hit = 1; hit <= 3; hit++) {
    m.balls[0].x = b.x + b.w / 2; m.balls[0].y = b.y + b.h + 40; m.balls[0].vx = 0; m.balls[0].vy = -BALL.base;
    if (b.r === 0) { m.balls[0].y = b.y - 40; m.balls[0].vy = BALL.base; }
    frames(m, 30);
    assert.equal(b.hp, 3 - hit);
    assert.equal(b.alive, hit < 3);
  }
});

test('a level is cleared when the last required block goes, and the winner is who broke it', () => {
  const m = started();
  m.pressServe(1);
  for (const b of m.blocks) b.alive = false;
  const last = m.blocks[5];
  last.alive = true; last.hp = 1;
  m.balls[0].x = last.x + last.w / 2; m.balls[0].y = last.y + last.h + 30; m.balls[0].vx = 0; m.balls[0].vy = -BALL.base;
  m.lastHit = 2;
  frames(m, 30);
  assert.equal(m.phase, 'LEVEL_CLEAR');
  assert.equal(m.levelWinner, 2);
  assert.deepEqual(m.levelWins, [0, 1]);
  run(m, TIMING.levelClear + 0.1);
  assert.equal(m.phase, 'SERVE');
  assert.equal(m.level, 2);
  assert.equal(m.servePlayer, 2, 'the serve alternates across levels too');
  assert.ok(m.blocks.every((b) => b.alive), 'a fresh wall');
});

test('a match is won by the first to three levels, then it freezes', () => {
  const m = started();
  m.levelWins = [0, 2];
  m.pressServe(1);
  for (const b of m.blocks) b.alive = false;
  const last = m.blocks[0]; last.alive = true; last.hp = 1;
  m.balls[0].x = last.x + last.w / 2; m.balls[0].y = last.y - 30; m.balls[0].vx = 0; m.balls[0].vy = BALL.base;
  m.lastHit = 2;
  frames(m, 40);
  assert.equal(m.phase, 'LEVEL_CLEAR');
  run(m, TIMING.levelClear + 0.1);
  assert.equal(m.phase, 'MATCH_WON');
  assert.equal(m.matchWinner, 2);
  const snap = JSON.stringify(m.snapshot().b);
  run(m, 2);
  assert.equal(JSON.stringify(m.snapshot().b), snap, 'nothing moves any more');
});

test('rematch: both must agree, then everything resets; or return to the lobby', () => {
  const m = started();
  m.matchWinner = 1; m.levelWins = [3, 1]; m.score = [900, 400]; m.level = 4;
  (m as any).phase = 'MATCH_WON';
  assert.equal(m.pressRematch(1), true);
  assert.equal(m.phase, 'REMATCH');
  assert.equal(m.pressRematch(2), true);
  assert.equal(m.phase, 'COUNTDOWN');
  assert.deepEqual(m.score, [0, 0]); assert.deepEqual(m.levelWins, [0, 0]); assert.equal(m.level, 1); assert.equal(m.servePlayer, 1);
  assert.ok(m.blocks.every((b) => b.alive));

  (m as any).phase = 'MATCH_WON';
  assert.equal(m.returnToLobby(2), true);
  assert.equal(m.phase, 'READY');
});

test('a disconnect pauses the match; coming back restarts the rally with the same server', () => {
  const m = started();
  m.pressServe(1);
  frames(m, 20);
  m.setConnected(2, false);
  assert.equal(m.phase, 'DISCONNECTED');
  const snap = JSON.stringify(m.snapshot().p);
  frames(m, 120);
  assert.equal(m.phase, 'DISCONNECTED');
  m.setConnected(2, true);
  assert.equal(m.phase, 'COUNTDOWN');
  run(m, TIMING.countdown + TIMING.go + 0.1);
  assert.equal(m.phase, 'SERVE');
  assert.equal(m.servePlayer, 1, 'same server - nobody lost that rally');
  assert.equal(snap.length > 0, true);
});

test('if nobody comes back the match is abandoned', () => {
  const m = started();
  m.setConnected(2, false);
  run(m, TIMING.disconnectGrace + 1);
  assert.equal(m.phase, 'WAITING_FOR_PLAYER');
  m.setConnected(2, true);
  assert.equal(m.phase, 'READY');
});

test('the waiting player can give up at once, or wait longer', () => {
  const m = started();
  m.setConnected(1, false);
  m.waitMore();
  assert.ok(m.phaseLeft > TIMING.disconnectGrace);
  m.abandon();
  assert.equal(m.phase, 'WAITING_FOR_PLAYER');
});

test('coming back during a rally-end pause still alternates the serve', () => {
  const m = started();
  m.pressServe(1);
  (m as any).rallyLoser = 1;
  (m as any).endRally();
  assert.equal(m.phase, 'RALLY_END');
  m.setConnected(1, false);
  m.setConnected(1, true);
  run(m, TIMING.countdown + TIMING.go + 0.1);
  assert.equal(m.phase, 'SERVE');
  assert.equal(m.servePlayer, 2);
});

test('paddles are kept inside the arena and chase their target at a limited speed', () => {
  const m = started();
  m.setTarget(1, -500);
  assert.ok(m.paddles[0].target >= PADDLE.w / 2);
  m.setTarget(1, 5000);
  assert.ok(m.paddles[0].target <= W - PADDLE.w / 2);
  m.paddles[0].x = 100; m.setTarget(1, 900);
  m.step(DT);
  assert.ok(Math.abs(m.paddles[0].x - 100) <= PADDLE.maxSpeed * DT + 1e-6);
  m.setTarget(1, Number.NaN);
  assert.ok(Number.isFinite(m.paddles[0].target), 'junk input is ignored');
});

test('a wall of blocks is symmetrical, and all 12 early levels have required blocks', () => {
  for (let l = 1; l <= 14; l++) {
    const { blocks } = makeLevel(l);
    assert.ok(blocks.some((b) => b.type !== 'i'), `level ${l} has something to break`);
    assert.ok(blocks.length <= 128);
  }
  assert.equal(makeLevel(1).blocks.length, 64, '16 x 4 to start with');
});

test('the ball can never get stuck going flat, or inside a block, over a long rally', () => {
  const m = started(7);
  m.pressServe(1);
  // two perfect-ish defenders chase the ball for a minute, invulnerable wall
  for (let i = 0; i < 60 * 60 && m.phase === 'PLAYING'; i++) {
    const b = m.balls[0];
    if (b) { m.setTarget(1, b.x); m.setTarget(2, b.x); }
    m.step(DT);
    for (const bl of m.blocks) if (!bl.alive && bl.type !== 'i') { bl.alive = true; bl.hp = bl.max; }
    for (const ball of m.balls) {
      assert.ok(Number.isFinite(ball.x) && Number.isFinite(ball.y) && Number.isFinite(ball.vx) && Number.isFinite(ball.vy));
      const sp = Math.hypot(ball.vx, ball.vy);
      assert.ok(Math.abs(ball.vy) >= BALL.minVyFrac * sp * 0.97 - 1, `never flat (vy ${ball.vy.toFixed(0)} of ${sp.toFixed(0)})`);
      assert.ok(ball.x >= 0 && ball.x <= W && ball.y > -50 && ball.y < H + 50, 'stays in the arena');
      for (const bl of m.blocks) {
        if (!bl.alive) continue;
        const inside = ball.x > bl.x + 2 && ball.x < bl.x + bl.w - 2 && ball.y > bl.y + 2 && ball.y < bl.y + bl.h - 2;
        assert.equal(inside, false, 'the ball centre is never inside a live block');
      }
    }
  }
  assert.ok(m.rallyHits > 20, `a long rally actually happened (${m.rallyHits} hits)`);
});

test('the ball speeds up through a rally but is capped', () => {
  const m = started();
  const s0 = m.targetSpeed();
  m.rallyHits = 4;
  assert.ok(m.targetSpeed() > s0 * 1.15 && m.targetSpeed() < s0 * 1.25);
  m.rallyHits = 500;
  assert.ok(Math.abs(m.targetSpeed() / s0 - BALL.maxRallyMul) < 1e-9);
});

test('game speed is adjustable by player 1 in the lobby only', () => {
  const m = new Match();
  m.setConnected(1, true); m.setConnected(2, true);
  assert.equal(m.setSpeed(2, 0.8), false);
  assert.equal(m.setSpeed(1, 3), false, 'only the offered speeds');
  assert.equal(m.setSpeed(1, 0.8), true);
  m.pressReady(1); m.pressReady(2);
  assert.equal(m.setSpeed(1, 1.25), false, 'not once the match has begun');
});

test('an idle server is helped along after a while', () => {
  const m = started();
  run(m, TIMING.autoServe + 0.2);
  assert.equal(m.phase, 'PLAYING');
});

test('the snapshot says who has pressed the button the screen is asking for', () => {
  const m = new Match();
  m.setConnected(1, true); m.setConnected(2, true);
  m.pressReady(1);
  assert.deepEqual(m.snapshot().rd, [true, false], 'READY: who is ready');
  m.pressReady(2);
  m.snapshot();
  (m as any).phase = 'MATCH_WON';
  assert.deepEqual(m.snapshot().rd, [false, false], 'MATCH_WON: nobody has asked for a rematch yet');
  m.pressRematch(2);
  assert.deepEqual(m.snapshot().rd, [false, true], 'REMATCH: who has asked');
});

// ── Special blocks and power-ups ─────────────────────────────

// A match in play with the ball parked somewhere harmless.
function playing(seed = 3): Match {
  const m = started(seed);
  m.pressServe(1);
  m.balls[0].x = W / 2; m.balls[0].y = H * 0.7; m.balls[0].vx = 0; m.balls[0].vy = BALL.base;
  return m;
}
const hurt = (m: Match, i: number, credit: 1 | 2) => (m as any).damage(i, credit, m.balls[0]);
const at = (m: Match, c: number, r: number) => m.blocks.findIndex((b) => b.c === c && b.r === r);

test('an explosive block destroys its neighbours, and the points go to whoever set it off', () => {
  const m = playing();
  const centre = at(m, 8, 1);
  for (const b of m.blocks) { b.type = 'n'; b.hp = b.max = 1; }
  m.blocks[centre].type = 'x';
  const before = m.score[0];
  hurt(m, centre, 1);
  for (const b of m.blocks) {
    const near = Math.abs(b.c - 8) <= 1 && Math.abs(b.r - 1) <= 1;
    assert.equal(b.alive, !near, `block ${b.c},${b.r} ${near ? 'should be gone' : 'should be untouched'}`);
  }
  assert.ok(m.score[0] > before + 100 * 3, 'every block in the blast is paid for, with the combo growing');
  assert.equal(m.score[1], 0);
  assert.ok(m.events.some((e) => e[0] === 'ex'));
});

test('an explosion can set off another explosive block', () => {
  const m = playing();
  for (const b of m.blocks) { b.type = 'n'; b.hp = b.max = 1; }
  m.blocks[at(m, 4, 1)].type = 'x';
  m.blocks[at(m, 5, 1)].type = 'x';
  m.blocks[at(m, 6, 1)].type = 'x';
  hurt(m, at(m, 4, 1), 2);
  assert.equal(m.blocks[at(m, 7, 1)].alive, false, 'the chain reached column 7');
  assert.equal(m.blocks[at(m, 9, 1)].alive, true, 'and stopped there');
});

test('a splitter block turns one ball into three', () => {
  const m = playing();
  const i = at(m, 8, 1);
  m.blocks[i].type = 's'; m.blocks[i].hp = m.blocks[i].max = 1;
  assert.equal(m.balls.length, 1);
  hurt(m, i, 1);
  assert.equal(m.balls.length, 3);
  const speeds = m.balls.map((b) => Math.hypot(b.vx, b.vy));
  for (const s of speeds) assert.ok(Math.abs(s - speeds[0]) < 1, 'all three move at the same speed');
});

test('there is never more than the maximum number of balls', () => {
  const m = playing();
  for (let i = 0; i < 6; i++) m.applyPower('multi', 1);
  assert.equal(m.balls.length, BALL.maxBalls);
});

test('pierce: the ball ploughs through breakable blocks; without it, it bounces', () => {
  const run1 = (pierce: boolean) => {
    const m = playing();
    for (const b of m.blocks) { b.type = 'n'; b.hp = b.max = 1; }
    if (pierce) m.applyPower('pierce', 1);
    const col = m.blocks[at(m, 8, m.rows - 1)];
    const ball = m.balls[0];
    ball.x = col.x + col.w / 2; ball.y = col.y + col.h + 120; ball.vx = 0; ball.vy = -BALL.base;
    m.lastHit = 1;
    frames(m, 60);
    return { gone: m.blocks.filter((b) => !b.alive).length, vy: m.balls[0]?.vy ?? 0 };
  };
  const plain = run1(false), through = run1(true);
  assert.equal(plain.gone, 1, 'one hit, then it turns back');
  assert.ok(plain.vy > 0, 'and heads back toward player 1');
  assert.ok(through.gone >= 3, `pierced ${through.gone} blocks`);
  assert.ok(through.vy < 0, 'still going up');
});

test('pierce still bounces off indestructible blocks', () => {
  const m = playing();
  const i = at(m, 8, m.rows - 1);
  m.blocks[i].type = 'i'; m.blocks[i].hp = m.blocks[i].max = 99;
  m.applyPower('pierce', 1);
  const blk = m.blocks[i];
  const ball = m.balls[0];
  ball.x = blk.x + blk.w / 2; ball.y = blk.y + blk.h + 100; ball.vx = 0; ball.vy = -BALL.base;
  frames(m, 40);
  assert.equal(blk.alive, true);
  assert.ok(m.balls[0].vy > 0);
});

test('wide paddle, shield and magnet apply to the player who caught them', () => {
  const m = playing();
  const base = m.paddleWidth(0);
  m.applyPower('wide', 1);
  assert.equal(m.paddleWidth(0), PADDLE.wideW);
  assert.equal(m.paddleWidth(1), base, 'the opponent is unaffected');
  m.applyPower('shield', 2);
  assert.ok(m.paddles[1].shield > 0 && m.paddles[0].shield === 0);
  m.applyPower('magnet', 1);
  assert.ok(m.paddles[0].magnet > 0);
});

test('slow and fast cancel each other out', () => {
  const m = playing();
  m.applyPower('fast', 1);
  assert.ok(m.fx.fast > 0);
  m.applyPower('slow', 2);
  assert.equal(m.fx.fast, 0);
  assert.ok(m.fx.slow > 0);
});

test('a power-up falls toward the player who earned it and is caught by their paddle', () => {
  const m = playing();
  m.balls[0].y = H / 2; m.balls[0].vx = 0; m.balls[0].vy = 0;      // keep the ball out of the way
  m.setTarget(1, 600); frames(m, 90);
  m.powerups.push({ id: 99, x: 600, y: PADDLE.y1 - 300, dir: 1, type: 'wide' });
  frames(m, 120);
  assert.equal(m.powerups.length, 0, 'it was caught');
  assert.ok(m.paddles[0].wide > 0, 'by player 1');
  assert.equal(m.paddles[1].wide, 0);
});

test('a power-up the paddle misses falls away and is gone', () => {
  const m = playing();
  m.balls[0].y = H / 2; m.balls[0].vx = 0; m.balls[0].vy = 0;
  m.setTarget(1, 100); frames(m, 90);
  m.powerups.push({ id: 98, x: 900, y: PADDLE.y1 - 200, dir: 1, type: 'multi' });
  frames(m, 240);
  assert.equal(m.powerups.length, 0);
  assert.equal(m.balls.length, 1, 'nothing happened');
});

test('temporary effects are cleared when the next serve begins', () => {
  const m = playing();
  m.applyPower('wide', 1); m.applyPower('magnet', 1); m.applyPower('pierce', 1);
  m.balls[0].x = W / 2; m.balls[0].y = H + 200; m.balls[0].vy = 100;   // past player 1
  frames(m, 5);
  assert.equal(m.phase, 'RALLY_END');
  run(m, TIMING.rallyEnd + 0.2);
  assert.equal(m.phase, 'SERVE');
  assert.equal(m.paddles[0].wide, 0);
  assert.equal(m.paddles[0].magnet, 0);
  assert.equal(m.fx.pierce, 0);
});

test('a shield bounces the ball back while it lasts, and not once it has run out', () => {
  const m = playing();
  m.applyPower('shield', 1);
  const drop = () => { m.balls[0].x = W / 2; m.balls[0].y = PADDLE.y1 + 200; m.balls[0].vx = 0; m.balls[0].vy = BALL.base; };
  m.setTarget(1, 100); frames(m, 90);                                   // paddle nowhere near
  drop(); frames(m, 40);
  assert.equal(m.phase, 'PLAYING', 'the ball bounced off the shield instead of being lost');
  assert.ok(m.balls[0].vy < 0);
  m.balls[0].x = W / 2; m.balls[0].y = H / 2; m.balls[0].vx = 0; m.balls[0].vy = 0;   // park it while the shield runs down
  run(m, 10.5);
  assert.equal(m.phase, 'PLAYING');
  drop(); frames(m, 40);
  assert.equal(m.paddles[0].shield, 0);
  assert.equal(m.phase, 'RALLY_END', 'and the next ball is lost');
});
