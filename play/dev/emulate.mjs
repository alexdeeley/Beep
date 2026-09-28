// Shared Durable Object emulation for both dev/local-server.mjs (real HTTP +
// WebSocket) and dev/unit-tests.mjs (fast, in-process, no sockets at all).

export class Storage {
  constructor(owner) { this.m = new Map(); this.owner = owner; this.alarmT = null; }
  async get(k) {
    if (Array.isArray(k)) { const r = new Map(); for (const x of k) if (this.m.has(x)) r.set(x, structuredClone(this.m.get(x))); return r; }
    return this.m.has(k) ? structuredClone(this.m.get(k)) : undefined;
  }
  async put(k, v) { this.m.set(k, structuredClone(v)); }
  async delete(k) { for (const x of [].concat(k)) this.m.delete(x); }
  async deleteAll() { this.m.clear(); }
  async setAlarm(t) {
    clearTimeout(this.alarmT);
    this.alarmT = setTimeout(() => this.owner.instance.alarm(), Math.max(0, t - Date.now()));
  }
}

export class Ctx {
  constructor(owner) { this.sockets = new Set(); this.storage = new Storage(owner); }
  acceptWebSocket(ws) { this.sockets.add(ws); }
  getWebSockets() { return [...this.sockets]; }
  blockConcurrencyWhile(fn) { this.ready = Promise.resolve(fn()); return this.ready; }
  setWebSocketAutoResponse() {}
}

// A fake WebSocket for in-process tests: no real network, just records what
// was sent so a test can inspect it, and supports the same
// serialize/deserializeAttachment pair the real Workers runtime provides.
export class FakeSocket {
  constructor() { this.readyState = 1; this.att = null; this.sent = []; }
  send(s) { if (this.readyState !== 1) throw new Error('closed'); this.sent.push(s); }
  close(code = 1000) { this.readyState = 3; }
  serializeAttachment(v) { this.att = structuredClone(v); }
  deserializeAttachment() { return this.att; }
  lastState() {
    for (let i = this.sent.length - 1; i >= 0; i--) {
      const m = JSON.parse(this.sent[i]);
      if (m.type === 'state') return m;
    }
    return null;
  }
}

export function makeHolder(InstanceClass, env = {}) {
  const holder = {};
  holder.ctx = new Ctx(holder);
  holder.instance = new InstanceClass(holder.ctx, env);
  return holder;
}
