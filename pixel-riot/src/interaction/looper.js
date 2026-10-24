// Gesture looper: records raw pointer input for N bars of the musical clock, then replays
// it forever as SYNTHETIC pointers through the PointerManager — so every recognizer,
// mapping, effect and sound fires exactly as if you played it again.
//
// States: 'idle' -> record() -> 'recording' -> (loop length elapses) -> 'playing' -> stop() -> 'idle'
// Bounded: at most MAX_EVENTS events per loop; synthetic pointer ids start at 10000.

const MAX_EVENTS = 900;
const ID_BASE = 10000;

export class Looper {
  constructor({ events, clock, pointers }) {
    this.events = events; this.clock = clock; this.pointers = pointers;
    this.state = 'idle'; this.bars = 2;
    this.buffer = []; this.length = 0; this.t0 = 0; this._jobs = [];
    this._offs = [];
  }

  get loopSeconds() { return this.clock.secondsPerBeat() * 4 * this.bars; }

  record(bars = this.bars) {
    this.stop();
    this.bars = bars; this.buffer = []; this.length = this.loopSeconds; this.t0 = this.clock.time;
    this.state = 'recording';
    const rec = (kind) => (p) => {
      if (p.synthetic || this.buffer.length >= MAX_EVENTS) return;
      this.buffer.push({ t: this.clock.time - this.t0, kind, id: p.id, x: p.x, y: p.y });
    };
    this._offs.push(this.events.on('pointer:down', rec('down')), this.events.on('pointer:move', rec('move')), this.events.on('pointer:up', rec('up')));
    this._jobs.push(this.clock.after(this.length, () => this._startPlayback(), 'looper'));
    this.events.emit('looper:state', { state: this.state, bars });
  }

  _startPlayback() {
    for (const off of this._offs) off(); this._offs = [];
    // Close any gesture still open at the loop boundary.
    const open = new Map();
    for (const e of this.buffer) { if (e.kind === 'down') open.set(e.id, e); else if (e.kind === 'up') open.delete(e.id); }
    for (const e of open.values()) this.buffer.push({ t: this.length - 0.01, kind: 'up', id: e.id, x: e.x, y: e.y });
    if (!this.buffer.length) { this.state = 'idle'; this.events.emit('looper:state', { state: 'idle', empty: true }); return; }
    this.state = 'playing';
    this.events.emit('looper:state', { state: this.state, bars: this.bars, events: this.buffer.length });
    this._cycle();
  }

  _cycle() {
    if (this.state !== 'playing') return;
    this._jobs = [];
    for (const e of this.buffer) {
      this._jobs.push(this.clock.after(e.t, () => {
        const id = ID_BASE + e.id % 1000;
        if (e.kind === 'down') this.pointers.downAt(id, e.x, e.y, { pointerType: 'synthetic', synthetic: true });
        else if (e.kind === 'move') this.pointers.moveTo(id, e.x, e.y);
        else this.pointers.upAt(id);
      }, 'looper'));
    }
    this._jobs.push(this.clock.after(this.length, () => this._cycle(), 'looper'));
  }

  stop() {
    for (const off of this._offs) off(); this._offs = [];
    for (const j of this._jobs) this.clock.cancel(j); this._jobs = [];
    for (const p of this.pointers.list()) if (p.id >= ID_BASE) this.pointers.upAt(p.id, true);
    const was = this.state; this.state = 'idle';
    if (was !== 'idle') this.events.emit('looper:state', { state: 'idle' });
  }
}
