// PLAY.DEELY.ORG — Cloudflare Worker entry point.
//
//   POST /api/rooms                → create a room, returns { code }
//   GET  /api/rooms/:code          → { exists, full, started }
//   GET  /api/rooms/:code/ws       → WebSocket into that room's Durable Object
//   GET  /api/leaderboard          → { entries } - the shared top-scores board
//
// Everything else is served from ./public by Workers Static Assets. There
// is deliberately no write route for the leaderboard here - a score only
// ever reaches it from a MatchRoom itself (server-to-Durable-Object), never
// from an HTTP request a client could forge. See src/leaderboard.js.

import { MatchRoom } from './match-room.js';
import { Leaderboard } from './leaderboard.js';
export { MatchRoom, Leaderboard };

// Short, game-show-themed room codes: a word + a digit. No 0/1 (look like O/I).
const CODE_WORDS = [
  'PLAY', 'SHOW', 'STAGE', 'LIVE', 'WILD', 'DARE', 'RISK', 'NERVE', 'PANIC',
  'CHAOS', 'BLAST', 'FUSE', 'SPARK', 'JOLT', 'DASH', 'RUSH', 'EDGE', 'ZONE',
  'ARENA', 'CLASH', 'BUZZ', 'HYPE', 'WIN', 'LOSE', 'FINAL', 'ROUND', 'GAME',
  'LUCK', 'BOOM', 'POP',
];
const DIGITS = '23456789';

function randomCode() {
  const w = CODE_WORDS[Math.floor(Math.random() * CODE_WORDS.length)];
  return w + DIGITS[Math.floor(Math.random() * DIGITS.length)];
}

const CODE_RE = /^[A-Z]{2,5}[2-9]$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean); // ['api','rooms',code?,'ws'?]

    if (parts[0] !== 'api') return new Response('Not found', { status: 404 });

    if (parts[1] === 'leaderboard') {
      if (parts.length !== 2 || request.method !== 'GET') return json({ error: 'notfound' }, 404);
      const stub = env.LEADERBOARD.get(env.LEADERBOARD.idFromName('global'));
      return stub.fetch('https://leaderboard/top');
    }

    if (parts[1] !== 'rooms') return json({ error: 'notfound' }, 404);

    if (parts.length === 2 && request.method === 'POST') {
      for (let i = 0; i < 12; i++) {
        const code = randomCode();
        const stub = env.MATCHES.get(env.MATCHES.idFromName(code));
        const res = await stub.fetch('https://room/init', {
          method: 'POST', body: JSON.stringify({ code }),
        });
        if (res.ok) return json({ code });
      }
      return json({ error: 'busy' }, 503);
    }

    const code = (parts[2] || '').toUpperCase();
    if (!CODE_RE.test(code)) {
      if (parts[3] === 'ws') return new Response('Not found', { status: 404 });
      return json({ exists: false });
    }
    const stub = env.MATCHES.get(env.MATCHES.idFromName(code));

    if (parts.length === 3 && request.method === 'GET') {
      return stub.fetch('https://room/exists');
    }
    if (parts.length === 4 && parts[3] === 'ws') {
      return stub.fetch(new Request('https://room/ws', request));
    }
    return json({ error: 'notfound' }, 404);
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
