// The visitor's book: notes people leave at places in the museum, which
// everyone else then finds there. Plain logic over a tiny SQL interface
// (`sql.exec(query, ...params)` returning `{ toArray() }`), so the very same
// code runs inside the Durable Object, in Node tests, and in local dev.
//
// Because the museum is the same for everybody, a spot in it is just an
// (x, z) position, and a note left there is found there by the next visitor.

import { createWorld, MUSEUM_SEED, REGION } from '../public/js/museum/world.js';

export const NAME_MAX = 20;
export const MSG_MAX = 140;
const KEEP = 50000;               // newest notes kept, the rest are dropped
const PER_BLOCK = 6;              // notes left on a single block
const SPAWN = { x: 22.5, z: 26.5 };
const HOUR = 3600e3;

// ── Cleaning and moderation ──────────────────────────────────

const INVISIBLE = /[​-‏‪-‮⁦-⁩﻿]/g;
export function cleanText(v, max) {
  return String(v ?? '').normalize('NFC')
    .replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(INVISIBLE, '')
    .replace(/\s+/g, ' ').trim().slice(0, max);
}

// Link-spam, handles and phone numbers don't belong in a visitor's book.
const LINKS = /(https?:|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|uk|ru|xyz|info|me|ly|gg|tv|app|dev|ai)\b|@[a-z0-9_.]{3,}|\b\d{3}[-. ]?\d{3}[-. ]?\d{4}\b)/i;

// A short list of the strongest words, tested after undoing common letter swaps.
// It is a speed bump, not a guarantee - see `remove()` for the real tool.
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '!': 'i' };
const STRONG = [/f+u+c+k/, /\bshit/, /\bc+u+n+t/, /\bn+i+g{2,}[ae]/, /\bbitch/, /\bwhore\b/, /\bdickhead/, /\bprick\b/, /\bslut\b/, /\bretard(ed)?\b/, /\bfaggot/];
export function isRude(text) {
  const t = text.toLowerCase().replace(/[013457@$!]/g, (c) => LEET[c]);
  const squashed = t.replace(/[^a-z]+/g, '');
  // ...and with the spaces and dots taken out ("f u c k"), for the worst few.
  return STRONG.some((re) => re.test(t)) || [/fuck/, /nigg[ae]/].some((re) => re.test(squashed));
}

// ── The book ─────────────────────────────────────────────────

export class Book {
  constructor(sql, { now = () => Date.now(), world = null } = {}) {
    this.sql = sql;
    this.now = now;
    this.world = world || createWorld(MUSEUM_SEED);
    this.recent = new Map();   // who -> [{ t, msg }], kept in memory only
    sql.exec(`CREATE TABLE IF NOT EXISTS book (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, name TEXT NOT NULL, msg TEXT NOT NULL,
      x REAL NOT NULL, z REAL NOT NULL, rx INTEGER NOT NULL, rz INTEGER NOT NULL, dist INTEGER NOT NULL)`);
    sql.exec('CREATE INDEX IF NOT EXISTS book_region ON book (rx, rz)');
    sql.exec('CREATE INDEX IF NOT EXISTS book_dist ON book (dist)');
  }

  // Leave a note. `who` is anything that identifies the sender for rate limiting (an IP).
  sign({ name, msg, x, z }, who = 'anon') {
    const t = this.now();
    const nm = cleanText(name, NAME_MAX) || 'A visitor';
    const text = cleanText(msg, MSG_MAX);
    if (!text) return { ok: false, error: 'message', say: 'Write something first.' };
    x = Number(x); z = Number(z);
    if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > 1e7 || Math.abs(z) > 1e7) return { ok: false, error: 'place', say: 'That isn’t a place in the museum.' };
    x = Math.round(x * 10) / 10; z = Math.round(z * 10) / 10;
    if (this.world.solid(Math.floor(x), Math.floor(z))) return { ok: false, error: 'place', say: 'That spot is inside a wall.' };
    if (LINKS.test(text) || LINKS.test(nm)) return { ok: false, error: 'links', say: 'No links, handles or phone numbers, please.' };
    if (isRude(text) || isRude(nm)) return { ok: false, error: 'language', say: 'Please keep it friendly.' };

    const mine = (this.recent.get(who) || []).filter((h) => t - h.t < HOUR);
    if (mine.length && t - mine[mine.length - 1].t < 15000) return { ok: false, error: 'slow', say: 'One moment before leaving another note.' };
    if (mine.length >= 12) return { ok: false, error: 'slow', say: 'That’s plenty for now — come back in a while.' };
    if (mine.some((h) => h.msg === text.toLowerCase())) return { ok: false, error: 'dupe', say: 'You already left that one.' };
    const bx = Math.floor(x), bz = Math.floor(z);
    const here = this.sql.exec('SELECT COUNT(*) AS n FROM book WHERE x >= ? AND x < ? AND z >= ? AND z < ?', bx, bx + 1, bz, bz + 1).toArray()[0].n;
    if (here >= PER_BLOCK) return { ok: false, error: 'crowded', say: 'This spot is full — step a little further along.' };

    const rx = Math.floor(x / REGION), rz = Math.floor(z / REGION);
    const dist = Math.round(Math.hypot(x - SPAWN.x, z - SPAWN.z));
    const row = this.sql.exec('INSERT INTO book (ts, name, msg, x, z, rx, rz, dist) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id', t, nm, text, x, z, rx, rz, dist).toArray()[0];
    this.sql.exec('DELETE FROM book WHERE id <= (SELECT id FROM book ORDER BY id DESC LIMIT 1 OFFSET ?)', KEEP);
    mine.push({ t, msg: text.toLowerCase() });
    this.recent.set(who, mine);
    if (this.recent.size > 5000) this.recent.clear();
    return { ok: true, entry: { id: row.id, ts: t, name: nm, msg: text, x, z, dist } };
  }

  // Notes in the regions around (rx, rz), newest first.
  near(rx, rz, r = 1) {
    r = Math.max(0, Math.min(2, r | 0));
    return this.sql.exec('SELECT id, ts, name, msg, x, z, dist FROM book WHERE rx BETWEEN ? AND ? AND rz BETWEEN ? AND ? ORDER BY id DESC LIMIT 300', rx - r, rx + r, rz - r, rz + r).toArray();
  }

  // The visitors who have signed furthest from the entrance - one line each.
  farthest(limit = 10) {
    limit = Math.max(1, Math.min(50, limit | 0));
    return this.sql.exec('SELECT name, MAX(dist) AS dist, x, z, ts FROM book GROUP BY LOWER(name) ORDER BY dist DESC, ts ASC LIMIT ?', limit).toArray();
  }

  latest(limit = 20) {
    limit = Math.max(1, Math.min(100, limit | 0));
    return this.sql.exec('SELECT id, ts, name, msg, x, z, dist FROM book ORDER BY id DESC LIMIT ?', limit).toArray();
  }

  // For the owner: take a note out of the book.
  remove(id) {
    const gone = this.sql.exec('DELETE FROM book WHERE id = ? RETURNING id', Number(id)).toArray();
    return gone.length > 0;
  }
}

// ── HTTP ─────────────────────────────────────────────────────

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const int = (v, d = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };

//   GET    /api/book?rx=&rz=&r=      notes in and around a region
//   GET    /api/book/farthest?limit= the furthest-travelled signatures
//   GET    /api/book/latest?limit=   the newest notes anywhere
//   POST   /api/book                 { name, msg, x, z }
//   DELETE /api/book/:id             owner only: x-admin-key header
export async function handleBook(book, request, { adminKey = '' } = {}) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const q = url.searchParams;
  if (request.method === 'GET' && path === '/api/book') return json({ entries: book.near(int(q.get('rx')), int(q.get('rz')), int(q.get('r'), 1)) });
  if (request.method === 'GET' && path === '/api/book/farthest') return json({ entries: book.farthest(int(q.get('limit'), 10)) });
  if (request.method === 'GET' && path === '/api/book/latest') return json({ entries: book.latest(int(q.get('limit'), 20)) });
  if (request.method === 'POST' && path === '/api/book') {
    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: 'json', say: 'Something went wrong.' }, 400); }
    if (!body || typeof body !== 'object') return json({ ok: false, error: 'json', say: 'Something went wrong.' }, 400);
    const who = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'local';
    const res = book.sign(body, who);
    return json(res, res.ok ? 200 : (res.error === 'slow' ? 429 : 400));
  }
  const m = /^\/api\/book\/(\d+)$/.exec(path);
  if (request.method === 'DELETE' && m) {
    if (!adminKey || request.headers.get('x-admin-key') !== adminKey) return json({ error: 'forbidden' }, 403);
    return json({ ok: book.remove(m[1]) });
  }
  return json({ error: 'notfound' }, 404);
}
