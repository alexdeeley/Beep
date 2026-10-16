// THE DROP WALL on drop.deeley.org.
//
//   GET  /api/scores?key=K        -> { key, entries: [{ name, score, t }], lower }
//   POST /api/scores { key, name, score } -> { ok, rank, entries }   (rank 0 = did not make the board)
//   GET  /api/health
//
// The game itself is a static page in ./public. One Durable Object holds
// every board, so the scores survive and everyone sees the same list.

import { DurableObject } from 'cloudflare:workers';
import { cleanKey, cleanName, cleanScore, insert, lowerIsBetter } from './scores.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') return json({ ok: true });
    if (url.pathname === '/api/scores') {
      const stub = env.SCORES.get(env.SCORES.idFromName('the-one-board'));
      const ip = request.headers.get('cf-connecting-ip') || '';
      const h = new Headers(request.headers); h.set('x-ip', ip);
      return stub.fetch(new Request('https://scores' + url.pathname + url.search, { method: request.method, headers: h, body: request.method === 'POST' ? await request.text() : undefined }));
    }
    if (url.pathname.startsWith('/api/')) return json({ error: 'not found' }, 404);
    return env.ASSETS.fetch(request);
  },
};

export class DropWallScores extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.recent = new Map();       // ip -> timestamps of recent submissions (a gentle rate limit)
  }

  async board(key) { return (await this.ctx.storage.get('board:' + key)) || []; }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'GET') {
      const key = cleanKey(url.searchParams.get('key'));
      if (!key) return json({ error: 'bad key' }, 400);
      return json({ key, lower: lowerIsBetter(key), entries: await this.board(key) });
    }
    if (request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
      const key = cleanKey(body?.key);
      if (!key) return json({ error: 'bad key' }, 400);
      const score = cleanScore(key, body?.score);
      if (score === null) return json({ error: 'bad score' }, 400);
      const ip = request.headers.get('x-ip') || '?';
      const now = Date.now();
      const times = (this.recent.get(ip) || []).filter((t) => now - t < 60_000);
      if (times.length >= 20) return json({ error: 'slow down' }, 429);
      times.push(now); this.recent.set(ip, times);
      const entry = { name: cleanName(body?.name), score, t: now };
      const { entries, rank } = insert(await this.board(key), key, entry);
      if (rank) await this.ctx.storage.put('board:' + key, entries);
      return json({ ok: true, rank, entries });
    }
    return json({ error: 'method' }, 405);
  }
}
