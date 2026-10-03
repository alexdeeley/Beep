// One room: two seats, a passcode, a Match, and the loop that runs it.
//
// The Room knows nothing about Cloudflare or Node sockets - it is handed
// anything with send() and close() - so the same code runs inside a Durable
// Object, in the local dev server and in tests.

import { DT, NET, SNAPSHOT_EVERY, TIMING } from '../shared/constants.ts';
import { Match } from '../shared/sim.ts';
import { cleanCode, hashPass, parseClient, sameHash, validCode } from '../shared/protocol.ts';
import type { ClientMsg, ErrorCode, ServerMsg } from '../shared/protocol.ts';
import type { PlayerNo } from '../shared/types.ts';

export interface Conn {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface Client {
  conn: Conn;
  authed: boolean;
  seat: 0 | PlayerNo;
  pid: string;
  name: string;
  windowStart: number;
  count: number;
  helloTimer: ReturnType<typeof setTimeout> | null;
  closed: boolean;
}

export interface RoomOptions {
  code: string;
  passHash: string;
  creatorPid: string;
  now?: () => number;
  seed?: number;
  onIdle?: () => void;
  log?: (event: string, detail?: Record<string, unknown>) => void;
}

const MAX_SOCKETS = 8;

export class Room {
  readonly code: string;
  readonly match: Match;
  readonly clients = new Set<Client>();
  private seats: [Client | null, Client | null] = [null, null];
  private pids: [string | null, string | null];
  private names: [string, string] = ['', ''];
  private passHash: string;
  private now: () => number;
  private log: (event: string, detail?: Record<string, unknown>) => void;
  private onIdle: () => void;
  private failed = 0;
  private lockedUntil = 0;
  private lastPump = 0;
  private acc = 0;
  private ticks = 0;
  private levelSent = -1;
  private timer: ReturnType<typeof setInterval> | null = null;
  private emptySince = 0;
  private idleFired = false;

  // for stats
  lateMs = 0;
  maxLateMs = 0;
  pumps = 0;
  droppedMessages = 0;
  readonly createdAt: number;

  constructor(opts: RoomOptions) {
    this.code = opts.code;
    this.passHash = opts.passHash;
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => {});
    this.onIdle = opts.onIdle ?? (() => {});
    this.pids = [opts.creatorPid, null];       // the creator always gets Player 1
    this.createdAt = this.now();
    let seed = 0;
    for (const ch of opts.code) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    this.match = new Match(opts.seed ?? seed);
  }

  // ── Connections ──────────────────────────────────────────

  attach(conn: Conn): Client {
    const c: Client = {
      conn, authed: false, seat: 0, pid: '', name: '', windowStart: this.now(), count: 0, helloTimer: null, closed: false,
    };
    if (this.clients.size >= MAX_SOCKETS) { this.fail(c, 'rate', 'Too many connections to this game.', 1013); return c; }
    this.clients.add(c);
    // Anyone who doesn't say who they are promptly is let go.
    c.helloTimer = setTimeout(() => { if (!c.authed) this.fail(c, 'timeout', 'No passcode received.', 4408); }, NET.helloTimeoutMs);
    this.emptySince = 0;
    this.idleFired = false;
    return c;
  }

  detach(c: Client): void {
    if (c.closed) return;
    c.closed = true;
    if (c.helloTimer) clearTimeout(c.helloTimer);
    this.clients.delete(c);
    if (c.authed && c.seat && this.seats[c.seat - 1] === c) {
      const seat = (c.seat - 1) as 0 | 1;
      this.seats[seat] = null;
      this.match.setConnected(c.seat, false);
      this.log('left', { seat: c.seat, phase: this.match.phase });
      this.releaseSeats();
      this.sendNames();
    }
    if (this.clients.size === 0) this.emptySince = this.now();
  }

  // A seat is held for a player who dropped out mid-match, and freed when the
  // match gives up on them (or at once if no match was running).
  private releaseSeats(): void {
    if (this.match.phase === 'DISCONNECTED') return;
    for (const s of [0, 1] as const) if (!this.seats[s]) { this.pids[s] = null; this.names[s] = ''; }
  }

  private send(c: Client, m: ServerMsg): void {
    if (c.closed) return;
    try { c.conn.send(JSON.stringify(m)); } catch { this.detach(c); }
  }

  private broadcast(m: ServerMsg): void {
    const s = JSON.stringify(m);
    for (const c of [...this.clients]) {
      if (!c.authed || c.closed) continue;
      try { c.conn.send(s); } catch { this.detach(c); }
    }
  }

  private fail(c: Client, code: ErrorCode, say: string, closeCode = 4000, extra: { retry?: number; left?: number } = {}): void {
    this.send(c, { t: 'err', code, say, ...extra });
    c.closed = true;
    if (c.helloTimer) clearTimeout(c.helloTimer);
    this.clients.delete(c);
    try { c.conn.close(closeCode, code); } catch { /* already gone */ }
  }

  // ── Messages ─────────────────────────────────────────────

  async receive(c: Client, raw: unknown): Promise<void> {
    if (c.closed) return;
    const t = this.now();
    if (t - c.windowStart >= 1000) { c.windowStart = t; c.count = 0; }
    if (++c.count > NET.maxMessagesPerSecond) {
      this.droppedMessages++;
      if (c.count > NET.maxMessagesPerSecond * 4) this.fail(c, 'rate', 'Too many messages.', 4429);
      return;
    }
    const m = parseClient(raw);
    if (!m) { this.droppedMessages++; return; }
    if (m.t === 'ping') { this.send(c, { t: 'pong', c: m.c, st: t }); return; }
    if (m.t === 'hello') { await this.hello(c, m); return; }
    if (!c.authed || !c.seat) return;               // nothing else counts until the passcode has been right
    this.act(c, m);
  }

  private async hello(c: Client, m: Extract<ClientMsg, { t: 'hello' }>): Promise<void> {
    if (c.authed) return;
    const now = this.now();
    if (now < this.lockedUntil) {
      this.fail(c, 'locked', 'Too many wrong passcodes. Wait a minute and try again.', 4423, { retry: Math.ceil((this.lockedUntil - now) / 1000) });
      return;
    }
    if (cleanCode(m.code) !== this.code || !validCode(this.code)) { this.fail(c, 'not_found', 'No such game.', 4404); return; }
    const given = await hashPass(this.code, m.pass);
    if (c.closed) return;
    if (!sameHash(given, this.passHash)) {
      this.failed++;
      this.log('bad_passcode', { failed: this.failed });
      if (this.failed >= NET.passAttempts) {
        this.failed = 0;
        this.lockedUntil = this.now() + NET.passLockMs;
        this.fail(c, 'locked', 'Too many wrong passcodes. Wait a minute and try again.', 4423, { retry: NET.passLockMs / 1000 });
      } else {
        this.fail(c, 'bad_passcode', 'That passcode is not right.', 4401, { left: NET.passAttempts - this.failed });
      }
      return;
    }
    this.failed = 0;

    // Whose seat is this? Their own if they have been here, else the free one (the creator is Player 1).
    let seat: 0 | PlayerNo = 0;
    for (const s of [0, 1] as const) if (this.pids[s] === m.pid) seat = (s + 1) as PlayerNo;
    if (!seat) for (const s of [0, 1] as const) if (this.pids[s] === null && !this.seats[s]) { seat = (s + 1) as PlayerNo; break; }
    if (!seat) { this.fail(c, 'full', 'This game is full.', 4409); return; }

    const old = this.seats[seat - 1];
    if (old && old !== c) {
      this.send(old, { t: 'err', code: 'replaced', say: 'You joined from somewhere else.' });
      this.detachQuiet(old);
    }
    c.authed = true;
    c.seat = seat;
    c.pid = m.pid;
    c.name = m.name || `Player ${seat}`;
    if (c.helloTimer) clearTimeout(c.helloTimer);
    this.seats[seat - 1] = c;
    this.pids[seat - 1] = m.pid;
    this.names[seat - 1] = c.name;
    this.match.setConnected(seat, true);
    this.log('joined', { seat, phase: this.match.phase });

    this.send(c, { t: 'welcome', you: seat, code: this.code, st: this.now(), names: [...this.names] as [string, string] });
    this.send(c, { t: 'level', ...this.match.levelMessage() });
    this.sendSnapshot(c);
    this.sendNames();
    this.start();
  }

  // Closes an old connection for a seat that is being taken over, without freeing the seat.
  private detachQuiet(old: Client): void {
    old.closed = true;
    if (old.helloTimer) clearTimeout(old.helloTimer);
    this.clients.delete(old);
    if (this.seats[old.seat - 1] === old) this.seats[old.seat - 1] = null;
    try { old.conn.close(4000, 'replaced'); } catch { /* already gone */ }
  }

  private act(c: Client, m: ClientMsg): void {
    const p = c.seat as PlayerNo;
    const mt = this.match;
    switch (m.t) {
      case 'in': mt.setTarget(p, m.x); break;
      case 'ready': mt.pressReady(p); break;
      case 'serve': mt.pressServe(p); break;           // rejected unless it is your serve, in SERVE
      case 'rematch': mt.pressRematch(p); break;
      case 'lobby': mt.returnToLobby(p); break;
      case 'wait': mt.waitMore(); break;
      case 'leave': mt.abandon(); this.releaseSeats(); this.sendNames(); break;
      case 'speed': mt.setSpeed(p, m.v); break;
      default: break;
    }
  }

  private sendNames(): void { this.broadcast({ t: 'names', names: [...this.names] as [string, string] }); }

  private sendSnapshot(c?: Client): void {
    const snap = this.match.snapshot();
    const msg: ServerMsg = { t: 's', st: this.now(), ...snap };
    if (c) this.send(c, msg);
    else this.broadcast(msg);
  }

  // ── The loop ─────────────────────────────────────────────

  start(): void {
    if (this.timer) return;
    this.lastPump = this.now();
    this.timer = setInterval(() => this.pump(this.now()), 1000 / 60);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // Run every fixed 1/60 s step that is due, sending the picture every other one.
  // The simulation is tied to this clock, never to anyone's frame rate.
  pump(now: number): void {
    const elapsed = now - this.lastPump;
    this.lastPump = now;
    this.pumps++;
    this.lateMs = Math.max(0, elapsed - 1000 / 60);
    this.maxLateMs = Math.max(this.maxLateMs, this.lateMs);
    this.acc += Math.min(elapsed, 250) / 1000;
    while (this.acc >= DT) {
      this.acc -= DT;
      this.match.step(DT);
      this.ticks++;
      this.releaseSeats();
      if (this.match.levelSerial !== this.levelSent) {
        this.levelSent = this.match.levelSerial;
        this.broadcast({ t: 'level', ...this.match.levelMessage() });
      }
      if (this.ticks % SNAPSHOT_EVERY === 0) this.sendSnapshot();
    }
    if (!this.idleFired && this.clients.size === 0 && this.emptySince && now - this.emptySince > TIMING.serverIdleClose * 1000) {
      this.idleFired = true;
      this.stop();
      this.onIdle();
    }
  }

  // ── Introspection ────────────────────────────────────────

  get seated(): number { return this.seats.filter(Boolean).length; }
  get isFull(): boolean { return this.pids[0] !== null && this.pids[1] !== null; }

  stats() {
    return {
      code: this.code,
      phase: this.match.phase,
      connections: this.clients.size,
      players: this.seated,
      ticks: this.ticks,
      lateMs: Math.round(this.lateMs * 10) / 10,
      maxLateMs: Math.round(this.maxLateMs * 10) / 10,
      droppedMessages: this.droppedMessages,
      ageSec: Math.round((this.now() - this.createdAt) / 1000),
    };
  }

  dispose(): void {
    this.stop();
    for (const c of [...this.clients]) { try { c.conn.close(1001, 'closing'); } catch { /* gone */ } }
    this.clients.clear();
  }
}
