// The WebSocket to the game: connect, say hello with the passcode, keep a
// running estimate of the server's clock and the round-trip time, and quietly
// reconnect if the line drops.

import type { ErrorCode, ServerMsg } from '../shared/protocol.ts';

export type NetState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'failed';
export type Quality = 'GOOD' | 'MODERATE' | 'POOR';

export interface Session { code: string; pass: string; pid: string; name: string }

const FATAL: ErrorCode[] = ['bad_passcode', 'locked', 'full', 'not_found', 'replaced', 'rate', 'bad_request'];

export class Net {
  state: NetState = 'idle';
  rtt = 0;                       // smoothed round trip, ms
  offset = 0;                    // server clock minus ours, ms
  fatal: { code: ErrorCode; say: string; retry?: number; left?: number } | null = null;
  you: 0 | 1 | 2 = 0;

  onMessage: (m: ServerMsg) => void = () => {};
  onState: (s: NetState) => void = () => {};

  private ws: WebSocket | null = null;
  private session: Session | null = null;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastHeard = 0;
  private samples: { rtt: number; off: number }[] = [];
  private wanted = false;
  private url: (code: string) => string;
  private firstOpen: ((r: { ok: true } | { ok: false; err: NonNullable<Net['fatal']> }) => void) | null = null;

  constructor(url: (code: string) => string) { this.url = url; }

  serverNow(): number { return Date.now() + this.offset; }

  get quality(): Quality { return this.rtt < 90 ? 'GOOD' : this.rtt < 200 ? 'MODERATE' : 'POOR'; }

  private set(s: NetState): void { if (this.state !== s) { this.state = s; this.onState(s); } }

  // Resolves when the server has accepted us (or refused, with the reason).
  connect(session: Session): Promise<{ ok: true } | { ok: false; err: NonNullable<Net['fatal']> }> {
    this.close();
    this.session = session;
    this.wanted = true;
    this.fatal = null;
    this.attempt = 0;
    this.samples = [];
    return new Promise((resolve) => { this.firstOpen = resolve; this.open(); });
  }

  private open(): void {
    if (!this.session || !this.wanted) return;
    this.set(this.attempt === 0 ? 'connecting' : 'reconnecting');
    let ws: WebSocket;
    try { ws = new WebSocket(this.url(this.session.code)); } catch { this.dropped(); return; }
    this.ws = ws;
    ws.onopen = () => {
      const s = this.session!;
      ws.send(JSON.stringify({ t: 'hello', code: s.code, pass: s.pass, pid: s.pid, name: s.name }));
    };
    ws.onmessage = (e) => {
      this.lastHeard = Date.now();
      let m: ServerMsg;
      try { m = JSON.parse(e.data as string) as ServerMsg; } catch { return; }
      if (m.t === 'pong') { this.pong(m.c, m.st); return; }
      if (m.t === 'welcome') {
        this.you = m.you;
        this.attempt = 0;
        this.set('open');
        this.startPings();
        this.firstOpen?.({ ok: true });
        this.firstOpen = null;
      } else if (m.t === 'err' && FATAL.includes(m.code)) {
        this.fatal = { code: m.code, say: m.say, retry: m.retry, left: m.left };
        this.wanted = false;
        this.set('failed');
        this.firstOpen?.({ ok: false, err: this.fatal });
        this.firstOpen = null;
      }
      this.onMessage(m);
    };
    ws.onclose = () => { if (this.ws === ws) this.dropped(); };
    ws.onerror = () => { /* onclose follows */ };
  }

  private dropped(): void {
    this.stopPings();
    this.ws = null;
    if (!this.wanted) return;
    this.attempt++;
    if (this.attempt > 12) {
      this.fatal = { code: 'not_found', say: 'The server is unavailable.' };
      this.wanted = false;
      this.set('failed');
      this.firstOpen?.({ ok: false, err: this.fatal });
      this.firstOpen = null;
      return;
    }
    this.set('reconnecting');
    const delay = Math.min(4000, 400 * 2 ** (this.attempt - 1));
    this.retryTimer = setTimeout(() => this.open(), delay);
  }

  private startPings(): void {
    this.stopPings();
    this.lastHeard = Date.now();
    const ping = () => this.send({ t: 'ping', c: Date.now() });
    ping();
    this.pingTimer = setInterval(() => {
      // Nothing heard for a while means the connection is dead even if the browser hasn't noticed.
      if (Date.now() - this.lastHeard > 6000) { try { this.ws?.close(); } catch { /* gone */ } this.dropped(); return; }
      ping();
    }, 2000);
  }
  private stopPings(): void { if (this.pingTimer) clearInterval(this.pingTimer); this.pingTimer = null; }

  // The server's clock = ours + offset. Keep the estimate from the best (lowest round trip) recent samples.
  private pong(c: number, st: number): void {
    const now = Date.now();
    const rtt = Math.max(0, now - c);
    this.samples.push({ rtt, off: st - (c + rtt / 2) });
    if (this.samples.length > 8) this.samples.shift();
    const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, 3);
    this.offset = best.reduce((s, x) => s + x.off, 0) / best.length;
    this.rtt = this.rtt ? this.rtt * 0.7 + rtt * 0.3 : rtt;
  }

  send(m: object): void {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
  }

  close(): void {
    this.wanted = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.stopPings();
    const ws = this.ws;
    this.ws = null;
    try { ws?.close(1000); } catch { /* gone */ }
    this.set('idle');
    this.you = 0;
  }
}
