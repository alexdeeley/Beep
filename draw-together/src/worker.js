// DRAW TOGETHER — Cloudflare Worker entry point.
//
//   POST /api/rooms              → create a room, returns { code }
//   GET  /api/rooms/:code        → { exists, full }
//   GET  /api/rooms/:code/ws     → WebSocket into that room's Durable Object
//
// Everything else is served from ./public by Workers Static Assets.

import { GameRoom } from './game-room.js';
export { GameRoom };

// Short, friendly room codes: a little word + a digit. No 0/1 (look like O/I).
const CODE_WORDS = [
  'CAT', 'DOG', 'OWL', 'FOX', 'BEE', 'PIG', 'COW', 'HEN', 'ELK', 'YAK',
  'SUN', 'MOON', 'STAR', 'SKY', 'RAIN', 'SNOW', 'LEAF', 'TREE', 'ROSE', 'FERN',
  'PINK', 'BLUE', 'GOLD', 'RED', 'MINT', 'PLUM', 'LIME', 'JAM', 'PIE', 'BUN',
  'CAKE', 'KITE', 'BOAT', 'DRUM', 'BELL', 'HAT', 'SOCK', 'FROG', 'DUCK', 'BEAR',
  'LION', 'SEAL', 'FISH', 'CRAB', 'WAVE', 'HUG', 'JOY', 'POP', 'ZIP', 'WOW',
];
const DIGITS = '23456789';

function randomCode() {
  const w = CODE_WORDS[Math.floor(Math.random() * CODE_WORDS.length)];
  return w + DIGITS[Math.floor(Math.random() * DIGITS.length)];
}

const CODE_RE = /^[A-Z]{3,4}[2-9]$/;

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
