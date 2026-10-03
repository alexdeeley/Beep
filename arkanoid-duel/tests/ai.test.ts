import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../shared/sim.ts';
import { Ai, DIFFICULTIES, isDifficulty } from '../shared/ai.ts';
import type { Difficulty } from '../shared/ai.ts';
import { DT } from '../shared/constants.ts';

// Two computer players, one on each side, playing a whole match with no humans anywhere.
function play(a: Difficulty, b: Difficulty, seed: number, maxSeconds = 1800) {
  const m = new Match(seed);
  m.setConnected(1, true); m.setConnected(2, true);
  const p1 = new Ai(m, 1, a, seed), p2 = new Ai(m, 2, b, seed + 100);
  const serves: number[] = [];
  let lastPhase = '', t = 0;
  while (m.phase !== 'MATCH_WON' && t < maxSeconds) {
    p1.update(DT); p2.update(DT);
    m.step(DT);
    t += DT;
    if (m.phase !== lastPhase) { if (m.phase === 'SERVE') serves.push(m.servePlayer); lastPhase = m.phase; }
  }
  return { m, serves, seconds: t };
}

test('difficulty names are validated', () => {
  assert.deepEqual([...DIFFICULTIES], ['easy', 'normal', 'hard']);
  assert.equal(isDifficulty('hard'), true);
  assert.equal(isDifficulty('impossible'), false);
  assert.equal(isDifficulty(undefined), false);
});

test('the computer readies up, serves when it is its turn, and plays a whole match to a winner', () => {
  const { m, seconds } = play('normal', 'normal', 7);
  assert.equal(m.phase, 'MATCH_WON');
  assert.ok(m.matchWinner === 1 || m.matchWinner === 2);
  assert.equal(Math.max(...m.levelWins), 3);
  assert.ok(seconds > 20 && seconds < 1800, `took ${seconds.toFixed(0)}s`);
});

test('serves alternate every rally, no matter who the computer is', () => {
  const { serves } = play('normal', 'hard', 11);
  assert.ok(serves.length >= 6, `only ${serves.length} serves`);
  assert.equal(serves[0], 1);
  for (let i = 1; i < serves.length; i++) assert.notEqual(serves[i], serves[i - 1], `serve ${i} repeated the server`);
});

test('a harder computer beats an easier one', () => {
  const wins = (strong: Difficulty, weak: Difficulty, games = 12) => {
    let n = 0;
    for (let seed = 1; seed <= games; seed++) {
      // alternate seats so neither side is favoured
      const strongIs1 = seed % 2 === 1;
      const { m } = strongIs1 ? play(strong, weak, seed) : play(weak, strong, seed);
      if (m.matchWinner === (strongIs1 ? 1 : 2)) n++;
    }
    return n;
  };
  assert.ok(wins('hard', 'easy') >= 11, 'hard should beat easy nearly every time');
  assert.ok(wins('hard', 'normal') >= 8, 'hard should beat normal most of the time');
  assert.ok(wins('normal', 'easy') >= 7, 'normal should beat easy more often than not');
});

test('the computer never moves its paddle target faster than its level allows', () => {
  const limits: Record<Difficulty, number> = { easy: 440, normal: 1100, hard: 1900 };
  for (const d of DIFFICULTIES) {
    const m = new Match(5);
    m.setConnected(1, true); m.setConnected(2, true);
    const ai = new Ai(m, 2, d, 5), other = new Ai(m, 1, 'normal', 6);
    let prev = m.paddles[1].target, worst = 0;
    for (let i = 0; i < 60 * 90; i++) {
      other.update(DT); ai.update(DT); m.step(DT);
      const now = m.paddles[1].target;
      worst = Math.max(worst, Math.abs(now - prev) / DT);
      prev = now;
    }
    assert.ok(worst <= limits[d] * 1.02, `${d}: target moved ${worst.toFixed(0)}/s, limit ${limits[d]}`);
  }
});

test('the same seed plays the same match', () => {
  const a = play('normal', 'hard', 3), b = play('normal', 'hard', 3);
  assert.deepEqual(a.m.score, b.m.score);
  assert.equal(a.seconds, b.seconds);
});

test('the computer only presses buttons the rules allow: it cannot serve out of turn', () => {
  const m = new Match(1);
  m.setConnected(1, true); m.setConnected(2, true);
  const ai = new Ai(m, 2, 'hard', 1);
  m.pressReady(1);
  for (let i = 0; i < 60 * 10 && m.phase !== 'SERVE'; i++) { ai.update(DT); m.step(DT); }
  assert.equal(m.phase, 'SERVE');
  assert.equal(m.servePlayer, 1);
  for (let i = 0; i < 60 * 5; i++) { ai.update(DT); m.step(DT); }      // a long time passes: it must not launch Player 1's serve
  assert.equal(m.phase, 'SERVE');
});
