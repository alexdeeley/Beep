// SOLITEAM - Cloudflare Worker entry point.
//
//   GET  /health        → { ok: true }
//   GET  /api/table     → the table as JSON (for the curious, and for uptime checks)
//   GET  /api/ws        → WebSocket into THE GAME
//
// Everything else is served from ./public as static files.
//
// There is exactly one game. It lives in exactly one Durable Object - a
// single, persistent, single-threaded place - whose storage keeps the cards
// across restarts, deployments and the long stretches when nobody is looking.

import { Table } from './table.ts';
import type { Saved } from './table.ts';

export interface Env {
  TABLE: DurableObjectNamespace;
  ALLOWED_ORIGINS?: string;
  ENVIRONMENT?: string;
  GAME_OFFSET?: string;
  MOVE_OFFSET?: string;
}

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export function originAllowed(origin: string | null, requestHost: string, env: { ALLOWED_ORIGINS?: string; ENVIRONMENT?: string }): boolean {
  if (!origin) return true;
  let host: string;
  try { host = new URL(origin).host; } catch { return false; }
  if (host === requestHost) return true;
  if ((env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean).some((o) => o === origin || o === host)) return true;
  if (env.ENVIRONMENT !== 'production' && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return true;
  return false;
}

export class SoliteamTable {
  private table: Table;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private state: DurableObjectState;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.table = new Table({
      load: () => this.state.storage.get<Saved>('table').then((v) => v ?? null),
      save: (s) => this.state.storage.put('table', s),
      gameOffset: Number(env.GAME_OFFSET) || 0,
      moveOffset: Number(env.MOVE_OFFSET) || 0,
      log: (event, detail) => console.info(JSON.stringify({ soliteam: event, ...detail })),
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    await this.table.whenReady();

    if (url.pathname === '/table') {
      const s = this.table.snapshot();
      return json({ game: s.game, moves: s.moves, players: s.players, resetting: s.resetting, state: s.state });
    }

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
      server.accept();
      const table = this.table;
      const handle = await table.attach({
        send: (d) => server.send(d),
        close: (c, r) => { try { server.close(c, r); } catch { /* already closed */ } },
      });
      server.addEventListener('message', (e) => { void table.receive(handle, e.data); });
      const gone = () => { table.detach(handle); if (table.clients.size === 0 && this.ticker) { clearInterval(this.ticker); this.ticker = null; } };
      server.addEventListener('close', gone);
      server.addEventListener('error', gone);
      if (!this.ticker) this.ticker = setInterval(() => this.table.tick(), 5000);
      return new Response(null, { status: 101, webSocket: client });
    }

    return json({ error: 'not_found' }, 404);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return json({ ok: true, service: 'soliteam' });
    if (!url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });

    const stub = env.TABLE.get(env.TABLE.idFromName('the-game'));     // there is only one
    if (url.pathname === '/api/table') return stub.fetch('https://table/table');
    if (url.pathname === '/api/ws') {
      if (!originAllowed(request.headers.get('Origin'), url.host, env)) return new Response('Forbidden origin', { status: 403 });
      return stub.fetch(new Request('https://table/ws', request));
    }
    return json({ error: 'not_found' }, 404);
  },
};
