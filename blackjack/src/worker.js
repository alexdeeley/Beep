// BLACKJACK — Cloudflare Worker entry point.
//
//   POST /api/tables                    → create a table, returns { code }
//   GET  /api/tables/:code               → { exists, full }
//   GET  /api/tables/:code/ws            → WebSocket into that table's Durable Object
//   GET  /api/tables/:code/leaderboard   → { exists, code, rows: [{name, seat, chips, ...stats}] }
//
// Everything else is served from ./public by Workers Static Assets.

import { TableRoom } from './table-room.js';
export { TableRoom };

// Short, friendly table codes: a card-themed word + a digit. No 0/1 (look like O/I).
const CODE_WORDS = [
  'ACE', 'JACK', 'KING', 'QUEEN', 'TEN', 'JOKER', 'DECK', 'SHOE', 'CHIP', 'BET',
  'CARD', 'SUIT', 'HAND', 'DEAL', 'DRAW', 'HIT', 'STAY', 'PUSH', 'BUST', 'SOFT',
  'SPADE', 'CLUB', 'HEART', 'GOLD', 'LUCK', 'WIN', 'TABLE', 'FELT', 'REEL', 'BANK',
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
    const parts = url.pathname.split('/').filter(Boolean); // ['api','tables',code?,'ws'?]

    if (parts[0] !== 'api') return new Response('Not found', { status: 404 });
    if (parts[1] !== 'tables') return json({ error: 'notfound' }, 404);

    if (parts.length === 2 && request.method === 'POST') {
      for (let i = 0; i < 12; i++) {
        const code = randomCode();
        const stub = env.TABLES.get(env.TABLES.idFromName(code));
        const res = await stub.fetch('https://table/init', {
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
    const stub = env.TABLES.get(env.TABLES.idFromName(code));

    if (parts.length === 3 && request.method === 'GET') {
      return stub.fetch('https://table/exists');
    }
    if (parts.length === 4 && parts[3] === 'ws') {
      return stub.fetch(new Request('https://table/ws', request));
    }
    if (parts.length === 4 && parts[3] === 'leaderboard' && request.method === 'GET') {
      return stub.fetch('https://table/leaderboard');
    }
    return json({ error: 'notfound' }, 404);
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
