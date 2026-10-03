// A computer opponent that plays over a real WebSocket, exactly as a browser
// would. Used by the integration tests and the load test.

export class Bot {
  constructor({ base, code, pass, pid, name = 'Bot', skill = 0.8, rematch = false, seed = 1 }) {
    Object.assign(this, { base, code, pass, pid, name, skill, rematch });
    this.you = 0;
    this.snap = null;
    this.level = null;
    this.errors = [];
    this.phases = [];
    this.snapshots = 0;
    this.lastSendAt = 0;
    this.sentReady = false;
    this.serveAt = 0;
    this.rng = (() => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
    this.offset = 0;
    this.events = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      const url = this.base.replace(/^http/, 'ws') + `/api/rooms/${this.code}/ws`;
      const ws = (this.ws = new WebSocket(url));
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(v); } };
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', code: this.code, pass: this.pass, pid: this.pid, name: this.name }));
      ws.onerror = () => { if (!settled) { settled = true; reject(new Error('socket error')); } };
      ws.onclose = (e) => { this.closed = e; done({ ok: false, closed: e.code }); };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.t === 'welcome') { this.you = m.you; done({ ok: true, you: m.you }); }
        else if (m.t === 'err') { this.errors.push(m); done({ ok: false, err: m }); }
        this.handle(m);
      };
    });
  }

  send(o) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(o)); }
  close() { try { this.ws?.close(); } catch { /* gone */ } }

  handle(m) {
    if (m.t === 'level') { this.level = m; return; }
    if (m.t !== 's') return;
    this.snap = m;
    this.snapshots++;
    for (const ev of m.ev) this.events.push(ev);
    if (this.phases.at(-1) !== m.ph) this.phases.push(m.ph);

    if (m.ph === 'READY' && !this.sentReady) { this.sentReady = true; this.send({ t: 'ready' }); }
    if (m.ph !== 'READY') this.sentReady = false;
    if (m.ph === 'SERVE' && m.sv === this.you) {
      this.serveAt = this.serveAt || Date.now();
      if (Date.now() - this.serveAt > 150) { this.send({ t: 'serve' }); this.serveAt = 0; }
    } else this.serveAt = 0;
    if (m.ph === 'MATCH_WON' && this.rematch && !m.rd[this.you - 1]) this.send({ t: 'rematch' });
    if (m.ph === 'REMATCH' && this.rematch && !m.rd[this.you - 1]) this.send({ t: 'rematch' });

    // Where to put the paddle: under the ball that is coming this way, with a
    // human-ish error that grows when the bot is less skilled.
    const mine = this.you === 1;
    let target = 500, best = null;
    for (const [, x, y, vx, vy] of m.b) {
      const coming = mine ? vy > 0 : vy < 0;
      if (!coming) continue;
      if (!best || (mine ? y > best.y : y < best.y)) best = { x, y, vx, vy };
    }
    if (best) target = best.x + best.vx * 0.04;
    if (m.ph === 'SERVE') target = 300 + this.rng() * 400;
    if (!best || this.rng() < 0.01) this.offset = (this.rng() - 0.5) * 2 * (1 - this.skill) * 220;
    this.send({ t: 'in', x: target + this.offset });
  }
}

export async function createGame(base, pass, pid) {
  const res = await fetch(base + '/api/rooms', { method: 'POST', body: JSON.stringify({ pass, pid }) });
  return { status: res.status, body: await res.json() };
}
