// The visitor's book, checked in Node on a real (in-memory) SQLite database.
//   node dev/book-tests.mjs
import { DatabaseSync } from 'node:sqlite';
import { Book, handleBook, cleanText, isRude, MSG_MAX, NAME_MAX } from '../src/book.js';
import { createWorld, MUSEUM_SEED } from '../public/js/museum/world.js';

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) pass++; else { fail++; console.log('  ✗ ' + l); } };

function makeBook(clock = { t: 1_000_000 }) {
  const db = new DatabaseSync(':memory:');
  const sql = { exec(q, ...p) { const st = db.prepare(q); if (/^\s*(select|with)\b/i.test(q) || /\breturning\b/i.test(q)) { const rows = st.all(...p); return { toArray: () => rows }; } st.run(...p); return { toArray: () => [] }; } };
  return { book: new Book(sql, { now: () => clock.t }), clock, db };
}
const world = createWorld(MUSEUM_SEED);
// a few floor spots to sign at
const spots = [];
for (let x = 20; x < 400 && spots.length < 40; x++) for (let z = 20; z < 400 && spots.length < 40; z += 13) if (!world.solid(x, z)) spots.push([x + 0.5, z + 0.5]);

// ── Cleaning ─────────────────────────────────────────────────
ok(cleanText('  hello   <b>world</b>  ', 50) === 'hello b world /b', 'markup characters are removed and spaces tidied');
ok(cleanText('a​b‮c', 50) === 'abc', 'invisible and direction-flipping characters are removed');
ok(cleanText('x'.repeat(500), MSG_MAX).length === MSG_MAX, 'long text is cut to the limit');
ok(!isRude('What a lovely room') && !isRude('Nigeria is far away') && !isRude('Scunthorpe') && !isRude('the shiitake wall'), 'ordinary words are not caught');
ok(isRude('f u c k') && isRude('sh1t') && isRude('you b!tch'), 'the worst words are, even with spaces or letter swaps');

// ── Signing ──────────────────────────────────────────────────
{
  const { book, clock } = makeBook();
  const [x, z] = spots[0];
  const r = book.sign({ name: '  Maisie ', msg: 'I was here! 🎨', x, z }, 'ip-1');
  ok(r.ok && r.entry.name === 'Maisie' && r.entry.msg === 'I was here! 🎨' && r.entry.id > 0, 'a note is saved, with name tidied and emoji kept');
  ok(r.entry.dist === Math.round(Math.hypot(x - 22.5, z - 26.5)), 'its distance from the entrance is worked out by the server');

  ok(book.sign({ name: 'x', msg: '   ', x, z }, 'ip-2').error === 'message', 'an empty note is refused');
  ok(book.sign({ name: '', msg: 'hello', x: x + 0.1, z }, 'ip-3').entry.name === 'A visitor', 'no name becomes "A visitor"');
  ok(book.sign({ name: 'x'.repeat(60), msg: 'hello there', x, z }, 'ip-4').entry.name.length === NAME_MAX, 'long names are cut');
  ok(book.sign({ name: 'x', msg: 'hi', x: NaN, z }, 'ip-5').error === 'place', 'a non-place is refused');
  ok(book.sign({ name: 'x', msg: 'hi', x: 1e12, z }, 'ip-5').error === 'place', 'a place absurdly far away is refused');
  // inside a wall
  let wall = null; for (let i = 0; i < 400 && !wall; i++) if (world.solid(i, 21)) wall = [i + 0.5, 21.5];
  ok(book.sign({ name: 'x', msg: 'stuck', x: wall[0], z: wall[1] }, 'ip-6').error === 'place', 'a note cannot be left inside a wall');
  for (const msg of ['see www.example.com', 'visit http://x.y', 'email me a@b.co', 'call 555-123-4567', 'follow @someone']) ok(book.sign({ name: 'x', msg, x, z }, 'ip-' + msg).error === 'links', `links and contact details are refused: "${msg}"`);
  ok(book.sign({ name: 'x', msg: 'what a fucking room', x, z }, 'ip-rude').error === 'language', 'strong language is refused');
  ok(book.sign({ name: 'sh1thead', msg: 'nice', x, z }, 'ip-rude2').error === 'language', '... in names too');

  // rate limits
  const who = 'ip-rate';
  ok(book.sign({ name: 'a', msg: 'first', x: spots[1][0], z: spots[1][1] }, who).ok, 'first note from a sender goes through');
  ok(book.sign({ name: 'a', msg: 'second', x: spots[1][0], z: spots[1][1] }, who).error === 'slow', 'a second one straight away is held back');
  clock.t += 16000;
  ok(book.sign({ name: 'a', msg: 'FIRST', x: spots[1][0], z: spots[1][1] }, who).error === 'dupe', 'the same words again are refused');
  ok(book.sign({ name: 'a', msg: 'second', x: spots[1][0], z: spots[1][1] }, who).ok, 'after a pause another note is fine');
  let n = 2;
  for (let i = 0; i < 20; i++) { clock.t += 16000; const rr = book.sign({ name: 'a', msg: 'note ' + i, x: spots[5 + (i % 30)][0], z: spots[5 + (i % 30)][1] }, who); if (rr.ok) n++; }
  ok(n === 12, `at most 12 notes an hour from one sender (${n})`);
  clock.t += 3600e3 + 16000;
  ok(book.sign({ name: 'a', msg: 'a new hour', x: spots[3][0], z: spots[3][1] }, who).ok, 'an hour later they can sign again');

  // crowded block
  const [cx, cz] = spots[4];
  let accepted = 0;
  for (let i = 0; i < 10; i++) { clock.t += 16000; if (book.sign({ name: 'p' + i, msg: 'crowd ' + i, x: cx, z: cz }, 'crowd-' + i).ok) accepted++; }
  ok(accepted === 6, `one block holds at most 6 notes (${accepted})`);
}

// ── Finding notes ────────────────────────────────────────────
{
  const { book, clock } = makeBook();
  const put = (i, name, x, z, msg) => { clock.t += 16000; return book.sign({ name, msg: msg || 'note ' + i, x, z }, 'u' + i); };
  const a = put(1, 'Ann', 22.5, 26.5), b = put(2, 'Ben', 24.5, 26.5), c = put(3, 'Cy', 24.5, 28.5);
  // a far away one in another region
  let far = null; for (let x = 4000; x < 4400 && !far; x++) for (let z = 4000; z < 4100 && !far; z++) if (!world.solid(x, z)) far = [x + 0.5, z + 0.5];
  const d = put(4, 'Dee', far[0], far[1], 'very far away');
  ok(book.near(0, 0, 0).length === 3 && book.near(0, 0, 1).length === 3, 'notes near the entrance are found in their region');
  ok(book.near(Math.floor(far[0] / 40), Math.floor(far[1] / 40), 0).map((e) => e.name).join() === 'Dee', 'a far region has only its own notes');
  ok(book.near(0, 0, 0)[0].name === 'Cy', 'newest first');
  ok(book.near(-5, -5, 1).length === 0, 'an empty part of the museum has no notes');
  ok(book.farthest(10)[0].name === 'Dee' && book.farthest(10)[0].dist > 4000, 'the farthest explorer tops the board');
  put(5, 'dee', spots[10][0], spots[10][1], 'second note');   // same person, closer
  ok(book.farthest(10).filter((e) => e.name.toLowerCase() === 'dee').length === 1, 'each explorer appears once, at their best distance');
  ok(book.latest(2).length === 2 && book.latest(1)[0].msg === 'second note', 'the latest notes are listed');
  ok(book.remove(a.entry.id) === true && book.remove(a.entry.id) === false && book.near(0, 0, 0).length === 2, 'the owner can remove a note');
}

// ── HTTP ─────────────────────────────────────────────────────
{
  const { book } = makeBook();
  const req = (method, path, body, headers = {}) => handleBook(book, new Request('http://x' + path, { method, body: body ? JSON.stringify(body) : undefined, headers }), { adminKey: 'secret' });
  const [x, z] = spots[5];
  let res = await req('POST', '/api/book', { name: 'Web', msg: 'hello from the web', x, z }, { 'cf-connecting-ip': '1.2.3.4' });
  const posted = await res.json();
  ok(res.status === 200 && posted.ok, 'POST /api/book saves a note');
  res = await req('POST', '/api/book', { name: 'Web', msg: 'again', x, z }, { 'cf-connecting-ip': '1.2.3.4' });
  ok(res.status === 429, 'too fast is a 429');
  res = await req('POST', '/api/book', { name: 'Web', msg: 'visit www.spam.com', x, z }, { 'cf-connecting-ip': '5.6.7.8' });
  ok(res.status === 400 && (await res.json()).say.includes('links'), 'a refused note says why, in words');
  res = await req('GET', `/api/book?rx=${Math.floor(x / 40)}&rz=${Math.floor(z / 40)}&r=1`);
  ok((await res.json()).entries.some((e) => e.msg === 'hello from the web'), 'GET /api/book returns nearby notes');
  res = await req('GET', '/api/book/farthest?limit=3');
  ok((await res.json()).entries.length === 1, 'GET /api/book/farthest lists explorers');
  res = await req('DELETE', `/api/book/${posted.entry.id}`);
  ok(res.status === 403, 'removing a note needs the owner key');
  res = await req('DELETE', `/api/book/${posted.entry.id}`, null, { 'x-admin-key': 'wrong' });
  ok(res.status === 403, '... and the right one');
  res = await req('DELETE', `/api/book/${posted.entry.id}`, null, { 'x-admin-key': 'secret' });
  ok((await res.json()).ok === true, 'the owner can remove it');
  res = await req('POST', '/api/book', undefined);
  ok(res.status === 400, 'a broken request is a 400, not a crash');
  res = await req('GET', '/api/nope');
  ok(res.status === 404, 'unknown API paths are 404');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
