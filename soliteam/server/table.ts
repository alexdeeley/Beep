// The table: one game of Solitaire, everyone who is looking at it, and the
// machinery that resets it when humanity gets stuck.
//
// It knows nothing about Cloudflare or Node sockets - it is handed anything
// with send() and close(), and a load/save pair for persistence - so the
// same code runs inside a Durable Object, in the local dev server and in
// the tests.

import { apply, cardText, deal, isStuck, isWon, SUIT_NAMES } from '../shared/solitaire.ts';
import type { Move, State } from '../shared/solitaire.ts';
import { MAX_MESSAGES_PER_SECOND, parseClient } from '../shared/protocol.ts';
import type { ResetStage, ServerMsg } from '../shared/protocol.ts';

export interface Conn {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface Client {
  conn: Conn;
  since: number;
  windowStart: number;
  count: number;
  closed: boolean;
  lastMoveAt: number;
  minutesTold: number;
}

// What survives restarts.
export interface Saved {
  state: State;
  game: number;
  moves: number;
  seq: number;
  startedAt: number;       // when this game was dealt
  lastMoveAt: number;
}

export interface TableOptions {
  load: () => Promise<Saved | null>;
  save: (s: Saved) => Promise<void>;
  now?: () => number;
  random?: () => number;
  gameOffset?: number;     // added to the displayed game number (see README)
  moveOffset?: number;     // ... and to the displayed move count
  log?: (event: string, detail?: Record<string, unknown>) => void;
  timescale?: number;      // tests: run the reset ceremony faster
}

// The reset ceremony, stage by stage, in milliseconds.
export const RESET_STAGES: [ResetStage, number][] = [
  ['over', 1800], ['nomoves', 2000], ['will', 1800], ['shuffle', 1600], ['begin', 0],
];
export const HOUSEKEEPING_AFTER_MS = 12 * 60 * 1000;    // the system tidies one card after this long without a human move
export const STUCK_CHECK_MS = 5 * 1000;

const DEADPAN = [
  'THE GAME CONTINUES.',
  'PLEASE DO NOT RUIN IT.',
  'SOMEONE IS CURRENTLY THINKING.',
  'THIS MOVE WAS MADE BY SOMEONE ELSE.',
  'YOU ARE NOT IN CHARGE.',
  'THE HUMAN RACE HAS MADE PROGRESS.',
  'THE HUMAN RACE HAS MADE A TERRIBLE DECISION.',
  'PLEASE WAIT. SOMEONE IS MOVING A CARD.',
  'THIS IS EVERYONE’S SOLITAIRE NOW.',
  'NOBODY STARTED THIS GAME.',
  'NOBODY WILL FINISH IT.',
  'THE CARDS REMEMBER.',
];

export class Table {
  readonly clients = new Set<Client>();
  private saved: Saved | null = null;
  private now: () => number;
  private random: () => number;
  private save: (s: Saved) => Promise<void>;
  private load: () => Promise<Saved | null>;
  private log: (event: string, detail?: Record<string, unknown>) => void;
  private gameOffset: number;
  private moveOffset: number;
  private timescale: number;
  private resetting: { stage: ResetStage; won: boolean; timer: ReturnType<typeof setTimeout> | null } | null = null;
  private ready: Promise<void>;
  private lastHousekeeping = 0;
  private pendingSave: Promise<void> = Promise.resolve();

  constructor(opts: TableOptions) {
    this.load = opts.load;
    this.save = opts.save;
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? Math.random;
    this.log = opts.log ?? (() => {});
    this.gameOffset = opts.gameOffset ?? 0;
    this.moveOffset = opts.moveOffset ?? 0;
    this.timescale = opts.timescale ?? 1;
    this.ready = this.boot();
  }

  private async boot(): Promise<void> {
    const s = await this.load();
    if (s && s.state && Array.isArray(s.state.tab) && s.state.tab.length === 7) {
      this.saved = s;
    } else {
      const t = this.now();
      this.saved = { state: deal(this.random), game: 1, moves: 0, seq: 0, startedAt: t, lastMoveAt: t };
      await this.save(this.saved);
      this.log('first_deal');
    }
  }

  whenReady(): Promise<void> { return this.ready; }

  // ── Connections ──────────────────────────────────────────

  async attach(conn: Conn): Promise<Client> {
    await this.ready;
    const t = this.now();
    const c: Client = { conn, since: t, windowStart: t, count: 0, closed: false, lastMoveAt: 0, minutesTold: 0 };
    this.clients.add(c);
    this.send(c, this.snapshot());
    this.broadcast({ t: 'players', n: this.clients.size });
    if (this.clients.size > 1) this.broadcastExcept(c, { t: 'event', kind: 'presence', text: 'SOMEONE HAS ARRIVED.' });
    return c;
  }

  detach(c: Client): void {
    if (c.closed) return;
    c.closed = true;
    this.clients.delete(c);
    this.broadcast({ t: 'players', n: this.clients.size });
    if (this.clients.size > 0) this.broadcast({ t: 'event', kind: 'presence', text: 'SOMEONE HAS LEFT. THE GAME CONTINUES.' });
  }

  private send(c: Client, m: ServerMsg): void {
    if (c.closed) return;
    try { c.conn.send(JSON.stringify(m)); } catch { this.detach(c); }
  }
  private broadcast(m: ServerMsg): void { for (const c of [...this.clients]) this.send(c, m); }
  private broadcastExcept(skip: Client, m: ServerMsg): void { for (const c of [...this.clients]) if (c !== skip) this.send(c, m); }

  snapshot(): ServerMsg & { t: 'state' } {
    const s = this.saved!;
    return { t: 'state', state: s.state, game: s.game + this.gameOffset, moves: s.moves + this.moveOffset, seq: s.seq, players: this.clients.size, resetting: !!this.resetting };
  }

  // ── Messages ─────────────────────────────────────────────

  async receive(c: Client, raw: unknown): Promise<void> {
    if (c.closed) return;
    await this.ready;
    const t = this.now();
    if (t - c.windowStart >= 1000) { c.windowStart = t; c.count = 0; }
    if (++c.count > MAX_MESSAGES_PER_SECOND) {
      if (c.count > MAX_MESSAGES_PER_SECOND * 5) { this.detach(c); try { c.conn.close(4429, 'rate'); } catch { /* gone */ } }
      return;
    }
    const m = parseClient(raw);
    if (!m) return;
    if (m.t === 'ping') { this.send(c, { t: 'pong', c: m.c }); return; }
    if (m.t === 'hello') { this.send(c, this.snapshot()); return; }
    this.play(c, m);
  }

  // One move at a time, against the table as it is right now. Two people
  // reaching for the same card: the first is applied, the second is checked
  // against the new table and simply doesn't happen.
  private play(c: Client, m: Move): void {
    if (this.resetting) { this.send(c, { t: 'event', kind: 'note', text: 'PLEASE WAIT. THE GAME IS RESETTING.' }); return; }
    const s = this.saved!;
    const r = apply(s.state, m);
    if (!r) { this.send(c, this.snapshot()); return; }      // not legal (any more): show them the real table

    const t = this.now();
    s.state = r.state;
    s.moves++;
    s.seq++;
    s.lastMoveAt = t;
    c.lastMoveAt = t;
    this.persist();

    for (const other of [...this.clients]) {
      this.send(other, { t: 'moved', seq: s.seq, mine: other === c, cards: r.moved, move: m, flipped: r.flipped });
      this.send(other, this.snapshot());
    }
    // the activity feed
    if (m.t === 'draw') this.broadcastExcept(c, { t: 'event', kind: 'move', text: r.state.waste.length ? 'SOMEONE DREW FROM THE STOCK.' : 'SOMEONE TURNED THE STOCK OVER.' });
    else {
      const what = r.moved.length === 1 ? cardText(r.moved[0]) : `${r.moved.length} CARDS`;
      this.broadcastExcept(c, { t: 'event', kind: 'move', text: `SOMEONE MOVED ${what}${r.toFoundation ? ' HOME' : ''}.` });
      if (r.completedSuit !== null) this.broadcast({ t: 'event', kind: 'note', text: `A PLAYER COMPLETED THE ${SUIT_NAMES[r.completedSuit].toUpperCase()}.` });
    }
    if (this.random() < 0.045) this.broadcast({ t: 'event', kind: 'deadpan', text: DEADPAN[Math.floor(this.random() * DEADPAN.length)] });
    this.log('move', { seq: s.seq, moves: s.moves });

    if (isWon(s.state)) this.beginReset(true);
    else if (isStuck(s.state)) this.beginReset(false);
  }

  // ── Time passing ─────────────────────────────────────────
  // Called every few seconds while anyone is connected.

  tick(): void {
    if (!this.saved || this.resetting) return;
    const t = this.now();
    const s = this.saved;

    // someone has been here a while
    for (const c of this.clients) {
      const mins = Math.floor((t - c.since) / 60000);
      if (mins >= 10 && mins % 10 === 0 && c.minutesTold !== mins) {
        c.minutesTold = mins;
        this.broadcastExcept(c, { t: 'event', kind: 'presence', text: `SOMEONE HAS BEEN PLAYING FOR ${mins} MINUTES.` });
      }
    }

    // a game can be stuck without anyone having moved (e.g. it was dealt that way)
    if (isStuck(s.state)) { this.beginReset(false); return; }

    // housekeeping: after a long quiet spell, the system may put ONE card home.
    // It never plays the game - it only tidies what is obviously finished.
    if (t - s.lastMoveAt > HOUSEKEEPING_AFTER_MS && t - this.lastHousekeeping > HOUSEKEEPING_AFTER_MS) {
      const tidy = this.obviousFoundationMove();
      if (tidy) {
        this.lastHousekeeping = t;
        const r = apply(s.state, tidy)!;
        s.state = r.state; s.moves++; s.seq++; s.lastMoveAt = t;
        this.persist();
        for (const other of [...this.clients]) {
          this.send(other, { t: 'moved', seq: s.seq, mine: false, cards: r.moved, move: tidy, flipped: r.flipped });
          this.send(other, this.snapshot());
        }
        this.broadcast({ t: 'event', kind: 'note', text: `NOBODY WAS LOOKING. THE SYSTEM PUT ${cardText(r.moved[0])} HOME.` });
        if (isWon(s.state)) this.beginReset(true);
      }
    }
  }

  private obviousFoundationMove(): Move | null {
    const s = this.saved!.state;
    for (let i = 0; i < 7; i++) {
      const col = s.tab[i];
      const top = col.up[col.up.length - 1];
      if (top === undefined) continue;
      const m: Move = { t: 'move', from: { p: 't', i }, n: 1, to: { p: 'f', i: Math.floor(top / 13) } };
      if (apply(s, m)) return m;
    }
    if (s.waste.length) {
      const top = s.waste[s.waste.length - 1];
      const m: Move = { t: 'move', from: { p: 'w' }, n: 1, to: { p: 'f', i: Math.floor(top / 13) } };
      if (apply(s, m)) return m;
    }
    return null;
  }

  // ── The reset ceremony ───────────────────────────────────

  private beginReset(won: boolean): void {
    if (this.resetting) return;
    this.resetting = { stage: 'over', won, timer: null };
    this.log(won ? 'won' : 'stuck', { game: this.saved!.game });
    this.runStage(0);
  }

  private runStage(i: number): void {
    const s = this.saved!;
    const [stage, ms] = RESET_STAGES[i];
    this.resetting!.stage = stage;
    if (stage === 'begin') {
      const t = this.now();
      s.state = deal(this.random);
      s.game++;
      s.seq++;
      s.startedAt = t;
      s.lastMoveAt = t;
      this.resetting = null;
      this.persist();
      this.broadcast(this.snapshot());
      this.broadcast({ t: 'reset', stage: 'begin', game: s.game + this.gameOffset, won: false });
      this.log('new_game', { game: s.game });
      return;
    }
    this.broadcast({ t: 'reset', stage, game: s.game + this.gameOffset, won: this.resetting!.won });
    this.resetting!.timer = setTimeout(() => this.runStage(i + 1), ms / this.timescale);
  }

  get isResetting(): boolean { return !!this.resetting; }

  // ── Persistence ──────────────────────────────────────────

  private persist(): void {
    const copy: Saved = JSON.parse(JSON.stringify(this.saved));
    this.pendingSave = this.pendingSave.then(() => this.save(copy)).catch((e) => this.log('save_failed', { error: String(e) }));
  }
  flush(): Promise<void> { return this.pendingSave; }

  // Tests and the local dev server: swap in a whole table (e.g. a stuck one).
  async replace(saved: Saved): Promise<void> {
    await this.ready;
    if (this.resetting?.timer) clearTimeout(this.resetting.timer);
    this.resetting = null;
    this.saved = { ...saved, seq: (this.saved?.seq ?? 0) + 1 };
    this.persist();
    this.broadcast(this.snapshot());
  }

  // ── Introspection ────────────────────────────────────────

  get state(): State { return this.saved!.state; }
  get game(): number { return this.saved!.game; }
  get moves(): number { return this.saved!.moves; }

  stats() {
    const s = this.saved;
    return { game: s?.game, moves: s?.moves, seq: s?.seq, players: this.clients.size, resetting: this.resetting?.stage ?? null, lastMoveAt: s?.lastMoveAt };
  }

  dispose(): void {
    if (this.resetting?.timer) clearTimeout(this.resetting.timer);
    this.resetting = null;
    for (const c of [...this.clients]) { try { c.conn.close(1001, 'closing'); } catch { /* gone */ } }
    this.clients.clear();
  }
}
