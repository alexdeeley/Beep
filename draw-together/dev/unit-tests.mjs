// Automated checks. Starts the local server, then plays the game over real
// WebSockets as two players.   node dev/unit-tests.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORDS, checkGuess, pickWord } from '../src/words.js';
import { CATEGORIES, MAX_PLAYERS } from '../public/js/shared.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8799;
let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + label); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Word bank ────────────────────────────────────────────────
const cats = new Set(CATEGORIES.map((c) => c.id));
ok(WORDS.length >= 200, `word bank has ${WORDS.length} words`);
const names = new Set();
for (const w of WORDS) {
  ok(!names.has(w.w.toLowerCase()), `duplicate word ${w.w}`); names.add(w.w.toLowerCase());
  ok(w.c.every((c) => cats.has(c)), `bad category on ${w.w}`);
  ok(['easy', 'medium', 'silly'].includes(w.d), `bad difficulty on ${w.w}`);
  ok(w.e && w.e.length, `missing emoji on ${w.w}`);
  ok(checkGuess(w.w, w) === 'correct', `exact answer accepted: ${w.w}`);
  ok(checkGuess(w.w.toUpperCase() + '  ', w) === 'correct', `case/space-insensitive: ${w.w}`);
}
const find = (s) => WORDS.find((w) => w.w === s);
ok(checkGuess('ice-cream cone', find('Ice cream cone')) === 'correct', 'ice-cream cone');
ok(checkGuess('icecream', find('Ice cream cone')) === 'correct', 'icecream alias');
ok(checkGuess('t rex', find('T-Rex')) === 'correct', 't rex');
ok(checkGuess('unicorm', find('Unicorn')) === 'correct', 'typo unicorm');
ok(checkGuess('dog', find('Cat')) === 'wrong', 'dog is not cat');
ok(checkGuess('car', find('Cat')) === 'wrong', 'car is not cat (short word, no typo)');
ok(checkGuess('dinosaur pizza', find('Dinosaur eating pizza')) === 'correct', 'silly key words');
ok(checkGuess('pizza dinosaur', find('Dinosaur eating pizza')) === 'correct', 'silly any order');
ok(checkGuess('dinosaur', find('Dinosaur eating pizza')) === 'close', 'silly partial is close');
ok(checkGuess('cats', find('Cat')) === 'correct', 'plural');
ok(checkGuess('', find('Cat')) === 'wrong', 'empty');
// picking
const used = [];
for (let i = 0; i < 40; i++) { const { index } = pickWord({ categories: ['silly'], difficulty: 'silly' }, used); ok(!used.includes(index), 'no repeats'); used.push(index); }
const easy = pickWord({ categories: ['everything'], difficulty: 'easy' }, []);
ok(WORDS[easy.index].d === 'easy', 'easy pick');

// ── Multiplayer protocol ────────────────────────────────────
const srv = spawn('node', [path.join(ROOT, 'dev/local-server.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => srv.stdout.once('data', r));
const base = `http://localhost:${PORT}`;

class Client {
  constructor(code, pid, name) {
    Object.assign(this, { code, pid, name, msgs: [], raw: [] });
  }
  open() {
    return new Promise((res) => {
      this.ws = new WebSocket(`ws://localhost:${PORT}/api/rooms/${this.code}/ws`);
      this.ws.onopen = () => { this.ws.send(JSON.stringify({ type: 'hello', playerId: this.pid, name: this.name })); res(); };
      this.ws.onmessage = (e) => { this.raw.push(e.data); try { const m = JSON.parse(e.data); this.msgs.push(m); if (m.type === 'state') this.st = m; } catch {} };
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  close() { this.ws.close(); }
  of(type) { return this.msgs.filter((m) => m.type === type); }
}

const { code } = await (await fetch(base + '/api/rooms', { method: 'POST' })).json();
ok(/^[A-Z]{3,4}[2-9]$/.test(code), 'room code format ' + code);
ok((await (await fetch(base + '/api/rooms/NOPE9')).json()).exists === false, 'unknown room');

const A = new Client(code, 'alex-0001', 'Alex');
const M = new Client(code, 'maisie-0001', 'Maisie');
await A.open(); await sleep(80);
await M.open(); await sleep(120);
ok(A.st.players.length === 2 && M.st.players.length === 2, 'both joined');
ok(!JSON.stringify(A.st).includes('maisie-0001'), 'player tokens are private');

// room capacity: up to MAX_PLAYERS join, the next one is refused - tested
// in its own throwaway room so it doesn't disturb the two-player game
// flow tests below (which assume `code` has exactly Alex and Maisie).
{
  const { code: bigCode } = await (await fetch(base + '/api/rooms', { method: 'POST' })).json();
  const crowd = [];
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const c = new Client(bigCode, `crowd-${String(i).padStart(4, '0')}`, `Player ${i}`);
    await c.open(); await sleep(30);
    crowd.push(c);
  }
  ok(crowd.at(-1).st?.players.length === MAX_PLAYERS, `room fills to ${MAX_PLAYERS} players`);
  const overflow = new Client(bigCode, 'overflow-001', 'Overflow');
  await overflow.open(); await sleep(100);
  ok(overflow.msgs.some((m) => m.type === 'error' && m.code === 'full'), `player ${MAX_PLAYERS + 1} refused`);
  overflow.close();
  for (const c of crowd) c.close();
}

// non-host can't change settings or start
M.send({ type: 'settings', settings: { timer: 30 } }); M.send({ type: 'start' }); await sleep(80);
ok(A.st.settings.timer === 60 && A.st.phase === 'lobby', 'guest cannot configure/start');
A.send({ type: 'settings', settings: { timer: 90, rounds: 6, categories: ['animals'], difficulty: 'easy' } });
await sleep(60);
ok(M.st.settings.timer === 90 && M.st.settings.rounds === 6, 'host settings sync');
A.send({ type: 'start' }); await sleep(100);
ok(A.st.phase === 'choosing' && A.st.drawerSeat === A.st.you, 'round 1: Alex draws');
const word = A.st.word.w;
ok(!!word && M.st.word === null, 'drawer has word, guesser does not');
ok(M.raw.every((r) => !r.toLowerCase().includes(word.toLowerCase())), 'secret word never sent to guesser');

// guesser cannot draw / cannot ready
M.send({ type: 'ready', aspect: 1 }); await sleep(50);
ok(A.st.phase === 'choosing', 'guesser cannot start the round');
A.send({ type: 'swap' }); await sleep(60);
const word2 = A.st.word.w;
ok(A.st.swapsLeft === 1, 'word swap');
A.send({ type: 'ready', aspect: 0.7 }); await sleep(60);
ok(M.st.phase === 'drawing' && Math.abs(M.st.aspect - 0.7) < 1e-9, 'drawing started with aspect');
ok(M.st.timer.running && M.st.timer.endsAt > Date.now(), 'timer running');

// word-length hint: shape only, never the letters
ok(A.st.wordShape === null, 'drawer gets no word shape (already has the word)');
ok(Array.isArray(M.st.wordShape) && M.st.wordShape.length === word2.length, 'guesser sees the right number of blanks');
ok(M.st.wordShape.every((ch, i) => ch === null ? /[a-zA-Z]/.test(word2[i]) : ch === word2[i] && !/[a-zA-Z]/.test(ch)), 'blanks cover letters, punctuation/spaces shown as-is');
ok(M.raw.every((r) => !r.toLowerCase().includes(word2.toLowerCase())), 'word shape never spells out the secret word');

M.send({ type: 'strokeStart', id: 'hack0001', tool: 'pen', color: '#000000', size: 12, pts: [1, 1] }); await sleep(40);
ok(A.of('strokeStart').length === 0, 'guesser strokes rejected');

A.send({ type: 'strokeStart', id: 'strk0001', tool: 'pen', color: '#000000', size: 12, pts: [100, 100] });
A.send({ type: 'strokePoints', id: 'strk0001', pts: [200, 200, 300, 250] });
await sleep(40);
ok(M.of('strokeStart').length === 1 && M.of('strokePoints').length === 1, 'live stroke relayed before stroke ends');
A.send({ type: 'strokeEnd', id: 'strk0001' });
A.send({ type: 'strokeStart', id: 'eras0001', tool: 'eraser', color: '#ffffff', size: 30, pts: [150, 150] });
A.send({ type: 'strokePoints', id: 'eras0001', pts: [160, 160] });
A.send({ type: 'strokeEnd', id: 'eras0001' });
A.send({ type: 'strokeStart', id: 'bad00001', tool: 'pen', color: '#123456', size: 12, pts: [1, 1] });
A.send({ type: 'strokeStart', id: 'bad00002', tool: 'pen', color: '#000000', size: 999, pts: [1, 1] });
A.send({ type: 'strokeStart', id: 'bad00003', tool: 'pen', color: '#000000', size: 12, pts: [1, 99999] });
await sleep(60);
ok(M.of('strokeEnd').length === 2, 'eraser relayed live');
ok(!M.msgs.some((m) => String(m.id).startsWith('bad')), 'invalid strokes rejected');
A.send({ type: 'undo' }); await sleep(40);
ok(M.of('undo')[0]?.id === 'eras0001' && A.of('undo').length === 1, 'undo synced to both');
A.send({ type: 'clear', id: 'clr00001' }); await sleep(40);
ok(M.of('clear').length === 1, 'clear synced');
A.send({ type: 'undo' }); await sleep(40);
ok(M.of('undo')[1]?.id === 'clr00001', 'clear can be undone');

// reconnect in the middle of a stroke
A.send({ type: 'strokeStart', id: 'strk0002', tool: 'crayon', color: '#e8202a', size: 20, pts: [500, 500] });
A.send({ type: 'strokePoints', id: 'strk0002', pts: [600, 600] });
await sleep(40);
M.close(); await sleep(120);
ok(A.st.players.find((p) => p.seat !== A.st.you).connected === false, 'disconnect noticed');
ok(A.st.timer.running === false && A.st.timer.remaining > 0, 'timer paused while someone is away');
const M2 = new Client(code, 'maisie-0001', 'Maisie');
await M2.open(); await sleep(120);
const board = M2.of('board').at(-1);
ok(board && board.ops.length === 1 && board.ops[0].id === 'strk0001' && board.active?.id === 'strk0002', 'drawing restored on reconnect (incl. stroke in progress)');
ok(M2.st.players.length === 2, 'no duplicate player on reconnect');
ok(A.st.timer.running === true, 'timer resumes');
ok(M2.raw.every((r) => !r.toLowerCase().includes(word2.toLowerCase())), 'word still secret after reconnect');
A.send({ type: 'strokeEnd', id: 'strk0002' });

// drawer can't guess; guesser guesses
A.send({ type: 'guess', text: word2 }); await sleep(40);
ok(A.st.phase === 'drawing', 'drawer cannot guess');
M2.send({ type: 'guess', text: 'zzzzqqq' }); await sleep(400);
ok(M2.of('guess').at(-1)?.guess.verdict === 'wrong', 'wrong guess');
M2.send({ type: 'guess', text: '  ' + word2.toUpperCase() + ' ' }); await sleep(80);
ok(M2.st.phase === 'reveal' && M2.st.result.reason === 'correct', 'correct guess ends round');
const maisie = M2.st.players.find((p) => p.seat === M2.st.you);
ok(maisie.score === 5, 'score 3 + 2 time bonus (got ' + maisie.score + ')');
ok(M2.st.result.word === word2, 'word revealed after round');

M2.send({ type: 'next' }); await sleep(100);
ok(M2.st.round === 2 && M2.st.drawerSeat === M2.st.you, 'roles alternate');
ok(M2.of('board').at(-1).ops.length === 0, 'fresh board next round');
ok(A.st.word === null && !!M2.st.word, 'word goes to new drawer only');

// give up + timeout
M2.send({ type: 'ready', aspect: 1.3 }); await sleep(40);
A.send({ type: 'giveup' }); await sleep(60);
ok(A.st.phase === 'reveal' && A.st.result.reason === 'gaveup', 'give up');
// finish the game quickly
for (let r = 3; r <= 7; r++) {
  A.send({ type: 'next' }); await sleep(60);
  const d = A.st.drawerSeat === A.st.you ? A : M2;
  const g = d === A ? M2 : A;
  if (r > 6) break;
  d.send({ type: 'ready', aspect: 1 }); await sleep(40);
  g.send({ type: 'giveup' }); await sleep(60);
}
ok(A.st.phase === 'over' && A.st.drawings === 6, 'game over after 6 rounds');
A.send({ type: 'again' }); await sleep(80);
ok(A.st.phase === 'choosing' && A.st.round === 1 && A.st.players.every((p) => p.score === 0), 'play again keeps players');

// no-timer rounds & timeout via alarm
A.send({ type: 'next' }); // ignored (not reveal)
const Dr = A.st.drawerSeat === A.st.you ? A : M2;
Dr.send({ type: 'ready', aspect: 1 }); await sleep(40);
ok(A.st.timer.running, 'timer on');

A.close(); M2.close();

// timer expiry in a separate short room
{
  const { code: c2 } = await (await fetch(base + '/api/rooms', { method: 'POST' })).json();
  const P = new Client(c2, 'p-000001', 'P'), Q = new Client(c2, 'q-000001', 'Q');
  await P.open(); await Q.open(); await sleep(80);
  P.send({ type: 'settings', settings: { timer: 30 } }); await sleep(30);
  P.send({ type: 'start' }); await sleep(40);
  P.send({ type: 'ready', aspect: 1 }); await sleep(40);
  // fast-forward: set the room's timer to end now via the server clock is not possible from outside,
  // so check the alarm was scheduled by asserting endsAt ~ 30s ahead.
  ok(Math.abs(Q.st.timer.endsAt - Date.now() - 30000) < 1500, 'round timer scheduled');
  P.close(); Q.close();
}

srv.kill();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
