// The lobby: people looking for an opponent, paired off as they arrive.
//
// Tap FIND AN OPPONENT, wait, and the next person who taps it is your
// opponent. Under the hood a game is still a room with a code and a
// passcode - that is what reconnection relies on - but the lobby makes
// them up and hands them to both players; nobody has to see a code.
//
// Like Room, it knows nothing about Cloudflare or Node sockets.

import { cleanName, hashPass } from '../shared/protocol.ts';

export interface LobbyConn {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface Seeker {
  conn: LobbyConn;
  pid: string;
  name: string;
  since: number;
  closed: boolean;
}

export interface LobbyOptions {
  // Create a room for these two; resolve true when the code was free.
  createRoom: (code: string, passHash: string, creatorPid: string) => Promise<boolean>;
  randomCode: () => string;
  now?: () => number;
  log?: (event: string, detail?: Record<string, unknown>) => void;
}

const PID = /^[A-Za-z0-9_-]{8,64}$/;
const PASS_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export class Lobby {
  readonly waiting: Seeker[] = [];
  private createRoom: LobbyOptions['createRoom'];
  private randomCode: () => string;
  private now: () => number;
  private log: (event: string, detail?: Record<string, unknown>) => void;
  private pairing = false;

  constructor(opts: LobbyOptions) {
    this.createRoom = opts.createRoom;
    this.randomCode = opts.randomCode;
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => {});
  }

  attach(conn: LobbyConn): Seeker {
    return { conn, pid: '', name: '', since: this.now(), closed: false };
  }

  detach(s: Seeker): void {
    if (s.closed) return;
    s.closed = true;
    const i = this.waiting.indexOf(s);
    if (i >= 0) this.waiting.splice(i, 1);
    this.tellCounts();
  }

  private send(s: Seeker, m: object): void {
    if (s.closed) return;
    try { s.conn.send(JSON.stringify(m)); } catch { this.detach(s); }
  }

  private tellCounts(): void {
    for (const s of this.waiting) this.send(s, { t: 'waiting', n: this.waiting.length });
  }

  async receive(s: Seeker, raw: unknown): Promise<void> {
    if (s.closed || typeof raw !== 'string' || raw.length > 512) return;
    let m: any;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'cancel') { this.detach(s); try { s.conn.close(1000, 'cancel'); } catch { /* gone */ } return; }
    if (m.t !== 'find' || typeof m.pid !== 'string' || !PID.test(m.pid)) return;
    if (s.pid) return;                                     // already in the queue
    s.pid = m.pid;
    s.name = cleanName(m.name);
    // the same person twice (two tabs): the newer one replaces the older
    for (const other of [...this.waiting]) if (other.pid === s.pid) { this.send(other, { t: 'err', say: 'You started searching somewhere else.' }); this.detach(other); try { other.conn.close(4000, 'replaced'); } catch { /* gone */ } }
    this.waiting.push(s);
    this.log('find', { waiting: this.waiting.length });
    this.tellCounts();
    await this.pair();
  }

  // Pair off the two who have waited longest, as long as they are different people.
  private async pair(): Promise<void> {
    if (this.pairing) return;
    this.pairing = true;
    try {
      while (this.waiting.length >= 2) {
        const a = this.waiting[0];
        const b = this.waiting.find((x) => x !== a && x.pid !== a.pid);
        if (!b) return;
        this.waiting.splice(this.waiting.indexOf(a), 1);
        this.waiting.splice(this.waiting.indexOf(b), 1);
        const pass = Array.from(crypto.getRandomValues(new Uint8Array(12)), (x) => PASS_ALPHABET[x % PASS_ALPHABET.length]).join('');
        let code = '';
        for (let i = 0; i < 12 && !code; i++) {
          const c = this.randomCode();
          if (await this.createRoom(c, await hashPass(c, pass), a.pid)) code = c;
        }
        if (!code) {
          for (const s of [a, b]) this.send(s, { t: 'err', say: 'Could not make a game. Try again.' });
          continue;
        }
        this.log('matched', { code });
        for (const s of [a, b]) {
          const opponent = s === a ? b : a;
          this.send(s, { t: 'matched', code, pass, you: s === a ? 1 : 2, opponent: opponent.name || `Player ${s === a ? 2 : 1}` });
          s.closed = true;
          try { s.conn.close(1000, 'matched'); } catch { /* gone */ }
        }
        this.tellCounts();
      }
    } finally {
      this.pairing = false;
    }
  }

  stats() { return { waiting: this.waiting.length }; }

  dispose(): void {
    for (const s of [...this.waiting]) { try { s.conn.close(1001, 'closing'); } catch { /* gone */ } }
    this.waiting.length = 0;
  }
}
