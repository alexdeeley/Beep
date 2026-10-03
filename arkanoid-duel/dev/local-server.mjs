// Local server: the real Worker and Room code running in plain Node, with no
// Cloudflare account. Serves ./public, the HTTP API, and the game WebSockets.
//
//   node dev/local-server.mjs          -> http://localhost:8787
//
// It emulates just enough of the Workers runtime: a "Durable Object namespace"
// (a Map of Rooms) and WebSockets. For the real thing use `npm run dev:cf`.

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Room } from '../server/room.ts';
import worker, { originAllowed } from '../server/worker.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8787);
const QUIET = process.env.QUIET === '1';
// For tests and load tests only: run the games this many times faster than real time.
const TIMESCALE = Number(process.env.TIMESCALE || 1);
const clock = TIMESCALE === 1 ? Date.now : () => Date.now() * TIMESCALE;

// ── A stand-in for the Durable Object namespace ──────────────

const rooms = new Map();
const env = {
  CREATE_LIMIT: process.env.CREATE_LIMIT,
  ENVIRONMENT: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  ROOMS: {
    idFromName: (n) => n,
    get: (name) => ({
      async fetch(input, init) {
        const url = new URL(input instanceof Request ? input.url : input);
        if (url.pathname === '/init') {
          if (rooms.has(name)) return Response.json({ error: 'taken' }, { status: 409 });
          const { code, passHash, pid } = JSON.parse(init.body);
          rooms.set(name, new Room({
            code, passHash, creatorPid: pid, now: clock,
            onIdle: () => { rooms.get(name)?.dispose(); rooms.delete(name); },
            log: QUIET ? undefined : (event, detail) => console.log(JSON.stringify({ room: code, event, ...detail })),
          }));
          return Response.json({ ok: true });
        }
        if (url.pathname === '/exists') return Response.json({ exists: rooms.has(name), full: !!rooms.get(name)?.isFull });
        return Response.json({ error: 'not_found' }, { status: 404 });
      },
    }),
  },
};

// ── Minimal RFC 6455 WebSocket ───────────────────────────────

class ServerSocket {
  constructor(sock, onText, onClose) {
    this.sock = sock; this.readyState = 1; this.att = null;
    this.buf = Buffer.alloc(0); this.frag = [];
    sock.on('data', (d) => { this.buf = Buffer.concat([this.buf, d]); this.parse(onText); });
    const done = () => { if (this.readyState !== 3) { this.readyState = 3; onClose(this); } };
    sock.on('close', done); sock.on('error', done);
  }
  parse(onText) {
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = b[0] & 0x80, op = b[0] & 0x0f, masked = b[1] & 0x80;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      const mask = masked ? b.subarray(off, off + 4) : null;
      if (masked) off += 4;
      if (b.length < off + len) return;
      const payload = Buffer.from(b.subarray(off, off + len));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = b.subarray(off + len);
      if (op === 8) { this.close(1000); return; }
      if (op === 9) { this.frame(10, payload); continue; }
      if (op === 1 || op === 0) {
        this.frag.push(payload);
        if (fin) { const text = Buffer.concat(this.frag).toString('utf8'); this.frag = []; onText(this, text); }
      }
    }
  }
  frame(op, data) {
    if (this.readyState !== 1) return;
    const len = data.length;
    const head = len < 126 ? Buffer.from([0x80 | op, len])
      : len < 65536 ? Buffer.from([0x80 | op, 126, len >> 8, len & 255])
      : (() => { const h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(len), 2); return h; })();
    this.sock.write(Buffer.concat([head, data]));
  }
  send(s) { if (this.readyState !== 1) throw new Error('closed'); this.frame(1, Buffer.from(String(s), 'utf8')); }
  close(code = 1000) {
    if (this.readyState !== 1) return;
    const p = Buffer.alloc(2); p.writeUInt16BE(code);
    this.frame(8, p);
    this.readyState = 2;
    setTimeout(() => this.sock.destroy(), 50);
  }
  serializeAttachment(v) { this.att = structuredClone(v); }
  deserializeAttachment() { return this.att; }
}


// ── HTTP ─────────────────────────────────────────────────────

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.map': 'application/json',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/health' || url.pathname.startsWith('/api/')) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const r = await worker.fetch(new Request(url, { method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined }), env);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  if (url.pathname === '/dev/stats') {                       // local only: what the rooms are doing
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ rooms: [...rooms.values()].map((r) => r.stats()) }));
    return;
  }
  let file = path.join(PUBLIC, decodeURIComponent(url.pathname));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); res.end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});

server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const m = /^\/api\/rooms\/([A-Za-z0-9]+)\/ws$/.exec(url.pathname);
  const room = m && rooms.get(m[1].toUpperCase());
  const refuse = (code, text) => { socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`); socket.destroy(); };
  if (!m) return refuse(404, 'Not Found');
  if (!originAllowed(req.headers.origin || null, req.headers.host, env)) return refuse(403, 'Forbidden');
  const key = req.headers['sec-websocket-key'];
  if (!key) return refuse(400, 'Bad Request');
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  if (!room) {
    // like the Durable Object does for a game that does not exist: say so, then close
    const dead = new ServerSocket(socket, () => {}, () => {});
    dead.send(JSON.stringify({ t: 'err', code: 'not_found', say: 'No such game.' }));
    dead.close(4404);
    return;
  }
  let handle;
  const ws = new ServerSocket(socket,
    (_s, text) => { if (handle) void room.receive(handle, text); },
    () => { if (handle) room.detach(handle); });
  handle = room.attach({ send: (d) => ws.send(d), close: (c) => ws.close(c) });
});

server.listen(PORT, () => console.log(`ARKANOID // DUEL on http://localhost:${PORT}`));
export { server, rooms };
