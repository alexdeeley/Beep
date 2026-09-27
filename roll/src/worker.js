// ROLL — Cloudflare Worker entry point.
//
//   POST /api/rooms                → create a room, returns { code }
//   GET  /api/rooms/:code          → { exists, full, started }
//   GET  /api/rooms/:code/ws       → WebSocket into that room's Durable Object
//
// Everything else is served from ./public by Workers Static Assets.

import { RollRoom } from './roll-room.js';
export { RollRoom };

// Short, friendly room codes: a dice/game-themed word + a digit. No 0/1
// (look like O/I).
const CODE_WORDS = [
  'ROLL', 'DICE', 'LUCK', 'PIPS', 'FIVER', 'TRIPS', 'QUADS', 'FULL', 'HOUSE',
  'HOT', 'COLD', 'SHAKE', 'CUP', 'TURN', 'SCORE', 'BONUS', 'TOTAL', 'ACE',
  'DEUCE', 'TREY', 'QUAD', 'FIVES', 'SIXES', 'TABLE', 'CUBE', 'CUBES', 'TOSS',
  'FLIP', 'PAIR', 'TRIO', 'KEEP', 'HOLD', 'BANK', 'GOLD', 'STAR', 'KING', 'CROWN',
  'WINS', 'TOPS', 'BEST',
];
const DIGITS = '23456789';

function randomCode() {
  const w = CODE_WORDS[Math.floor(Math.random() * CODE_WORDS.length)];
  return w + DIGITS[Math.floor(Math.random() * DIGITS.length)];
}

const CODE_RE = /^[A-Z]{3,5}[2-9]$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean); // ['api','rooms',code?,'ws'?]

    if (parts[0] !== 'api') return new Response('Not found', { status: 404 });
    if (parts[1] !== 'rooms') return json({ error: 'notfound' }, 404);

    if (parts.length === 2 && request.method === 'POST') {
      for (let i = 0; i < 12; i++) {
        const code = randomCode();
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
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
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));

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
