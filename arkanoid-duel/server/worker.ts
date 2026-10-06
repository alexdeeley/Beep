// ARKANOID // DUEL — Cloudflare Worker entry point.
//
//   GET  /health                  → { ok: true }
//   POST /api/rooms               → { pass, pid, solo? }  creates a game, returns { code }
//                                    (solo: "easy" | "normal" | "hard" makes Player 2 the computer)
//   GET  /api/rooms/:code         → { exists, full }
//   GET  /api/rooms/:code/ws      → WebSocket into that game's Durable Object
//   GET  /api/lobby/ws            → WebSocket to the lobby: send { t: 'find', pid, name }, get { t: 'matched', code, pass }
//
// Everything else is served from ./public as static files.
//
// A game lives in one Durable Object: a single, persistent, single-threaded
// place that holds the match in memory and runs the 60 Hz simulation for as
// long as people are connected - which is exactly what a short-lived
// serverless function can't do.

import { Room } from './room.ts';
import { Lobby } from './lobby.ts';
import { isDifficulty } from '../shared/ai.ts';
import type { Difficulty } from '../shared/ai.ts';
import { cleanCode, hashPass, validCode, validPass } from '../shared/protocol.ts';

export interface Env {
  ROOMS: DurableObjectNamespace;
  LOBBY: DurableObjectNamespace;
  ALLOWED_ORIGINS?: string;        // extra origins allowed to open a WebSocket, comma separated
  ENVIRONMENT?: string;            // "production" tightens a few dev conveniences
  CREATE_LIMIT?: string;           // games one address may create per 10 minutes (default 20); raise it for load tests
}

const json = (obj: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });

// ── Room codes: four characters, no 0/1/O/I to mix up ────────

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  let s = '';
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s;
}

// ── WebSocket origin check ───────────────────────────────────
// Browsers always say where a page came from. Only our own pages (and any
// origins listed in ALLOWED_ORIGINS) may open a game socket. Non-browser
// clients send no Origin and can't be tricked into it by another website.

export function originAllowed(origin: string | null, requestHost: string, env: { ALLOWED_ORIGINS?: string; ENVIRONMENT?: string }): boolean {
  if (!origin) return true;
  let host: string;
  try { host = new URL(origin).host; } catch { return false; }
  if (host === requestHost) return true;
  if ((env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean).some((o) => o === origin || o === host)) return true;
  if (env.ENVIRONMENT !== 'production' && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return true;
  return false;
}

// ── Rate limit for creating games (best effort, per isolate) ─

const created = new Map<string, number[]>();
export function allowCreate(ip: string, now = Date.now(), limit = 20, windowMs = 10 * 60 * 1000): boolean {
  const list = (created.get(ip) || []).filter((t) => now - t < windowMs);
  if (list.length >= limit) { created.set(ip, list); return false; }
  list.push(now);
  created.set(ip, list);
  if (created.size > 2000) created.clear();
  return true;
}

// ── The Durable Object: one per game ─────────────────────────

export class DuelRoom {
  private room: Room | null = null;

  // (The room is held in memory on purpose: a match is live state, not data to store.)
  constructor(_state: DurableObjectState, _env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/init' && request.method === 'POST') {
      if (this.room) return json({ error: 'taken' }, 409);
      const { code, passHash, pid, solo } = (await request.json()) as { code: string; passHash: string; pid: string; solo?: Difficulty };
      this.room = new Room({
        code, passHash, creatorPid: pid, solo: isDifficulty(solo) ? solo : undefined,
        onIdle: () => { this.room?.dispose(); this.room = null; },
        log: (event, detail) => console.info(JSON.stringify({ room: code, event, ...detail })),
      });
      return json({ ok: true });
    }

    if (url.pathname === '/exists') {
      return json({ exists: !!this.room, full: !!this.room?.isFull });
    }

    if (url.pathname === '/ws') {
      if (!this.room) return json({ error: 'not_found' }, 404);
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
      server.accept();                       // a live, in-memory socket: the object stays awake while a game is on
      const room = this.room;
      const handle = room.attach({
        send: (d) => server.send(d),
        close: (c, r) => { try { server.close(c, r); } catch { /* already closed */ } },
      });
      server.addEventListener('message', (e) => { void room.receive(handle, e.data); });
      const gone = () => room.detach(handle);
      server.addEventListener('close', gone);
      server.addEventListener('error', gone);
      return new Response(null, { status: 101, webSocket: client });
    }

    return json({ error: 'not_found' }, 404);
  }
}

// ── The lobby: one for everyone, pairing people off as they arrive ──

export class DuelLobby {
  private lobby: Lobby;

  constructor(_state: DurableObjectState, env: Env) {
    this.lobby = new Lobby({
      randomCode,
      createRoom: async (code, passHash, pid) => {
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        const res = await stub.fetch('https://room/init', { method: 'POST', body: JSON.stringify({ code, passHash, pid }) });
        return res.ok;
      },
      log: (event, detail) => console.info(JSON.stringify({ lobby: event, ...detail })),
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    server.accept();
    const lobby = this.lobby;
    const seeker = lobby.attach({
      send: (d) => server.send(d),
      close: (c, r) => { try { server.close(c, r); } catch { /* already closed */ } },
    });
    server.addEventListener('message', (e) => { void lobby.receive(seeker, e.data); });
    const gone = () => lobby.detach(seeker);
    server.addEventListener('close', gone);
    server.addEventListener('error', gone);
    return new Response(null, { status: 101, webSocket: client });
  }
}

// ── The Worker ───────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') return json({ ok: true, service: 'arkanoid-duel' });
    const parts = url.pathname.split('/').filter(Boolean);        // ['api', 'rooms', code?, 'ws'?]
    if (parts[0] === 'api' && parts[1] === 'lobby' && parts[2] === 'ws' && parts.length === 3) {
      if (!originAllowed(request.headers.get('Origin'), url.host, env)) return new Response('Forbidden origin', { status: 403 });
      return env.LOBBY.get(env.LOBBY.idFromName('lobby')).fetch(new Request('https://lobby/ws', request));
    }
    if (parts[0] !== 'api' || parts[1] !== 'rooms') return new Response('Not found', { status: 404 });

    // Create a game.
    if (parts.length === 2 && request.method === 'POST') {
      const ip = request.headers.get('cf-connecting-ip') || 'local';
      if (!allowCreate(ip, Date.now(), Number(env.CREATE_LIMIT) || 20)) return json({ error: 'rate', say: 'You\'ve made a lot of games. Try again in a few minutes.' }, 429);
      let body: { pass?: unknown; pid?: unknown; solo?: unknown };
      try { body = (await request.json()) as typeof body; } catch { return json({ error: 'bad_request' }, 400); }
      if (!validPass(body.pass) || typeof body.pid !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(body.pid)) {
        return json({ error: 'bad_request', say: 'A passcode of 3 to 24 characters is needed.' }, 400);
      }
      if (body.solo !== undefined && !isDifficulty(body.solo)) return json({ error: 'bad_request', say: 'Pick easy, normal or hard.' }, 400);
      for (let i = 0; i < 12; i++) {
        const code = randomCode();
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        const res = await stub.fetch('https://room/init', {
          method: 'POST',
          body: JSON.stringify({ code, passHash: await hashPass(code, body.pass), pid: body.pid, solo: body.solo }),
        });
        if (res.ok) return json({ code });
      }
      return json({ error: 'busy' }, 503);
    }

    const code = cleanCode(parts[2]);
    if (!validCode(code)) return json({ exists: false, error: 'not_found' }, 404);
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));

    if (parts.length === 3 && request.method === 'GET') return stub.fetch('https://room/exists');

    if (parts.length === 4 && parts[3] === 'ws') {
      if (!originAllowed(request.headers.get('Origin'), url.host, env)) return new Response('Forbidden origin', { status: 403 });
      return stub.fetch(new Request('https://room/ws', request));
    }
    return json({ error: 'not_found' }, 404);
  },
};
