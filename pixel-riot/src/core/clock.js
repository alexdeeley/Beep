// Shared timing model.
//
//  - `time`      visual time in seconds; advances only while animation runs; dt is clamped
//                (LIMITS.maxFrameDt) so an inactive tab never accumulates a backlog.
//  - tempo       beats per minute for musical mode; beats/steps are derived from the
//                Web Audio clock when audio is running (sample-accurate scheduling),
//                otherwise from visual time.
//  - scheduler   `after(seconds, fn, owner)` runs callbacks on the visual timeline
//                (used by chain reactions, loopers and extensions). Bounded; cancellable.
//
// Events emitted on the bus: 'clock:beat' { beat, bar, time }, 'clock:step' { step, subdivision, time, audioTime }.

import { LIMITS } from '../config.js';

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(x) { const a = this.a; a.push(x); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p].t <= a[i].t) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  peek() { return this.a[0]; }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < a.length && a[l].t < a[m].t) m = l; if (r < a.length && a[r].t < a[m].t) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top;
  }
  filter(fn) { this.a = this.a.filter(fn); const old = this.a; this.a = []; for (const x of old) this.push(x); }
  clear() { this.a.length = 0; }
}

export class Clock {
  constructor({ events, maxScheduled = LIMITS.maxChainEvents } = {}) {
    this.events = events;
    this.time = 0; this.dt = 0; this.frame = 0;
    this.tempo = 112; this.subdivision = 4;
    this.audioTimeSource = null;   // () => seconds | null  (installed by audio engine)
    this._heap = new MinHeap();
    this._seq = 0;
    this.maxScheduled = maxScheduled;
    this.dropped = 0;
    this._lastBeat = -1; this._lastStep = -1;
    this.musical = false;
  }

  // Advance visual time by real elapsed seconds.
  tick(realDt) {
    const dt = Math.min(Math.max(realDt, 0), LIMITS.maxFrameDt);
    this.dt = dt; this.time += dt; this.frame++;
    this._runScheduled();
    this._beats();
    return dt;
  }

  audioTime() { return this.audioTimeSource ? this.audioTimeSource() : null; }

  // Position in beats on the musical timeline (audio clock preferred).
  beatPosition() {
    const at = this.audioTime();
    const t = at != null ? at : this.time;
    return (t * this.tempo) / 60;
  }
  beatPhase() { const b = this.beatPosition(); return b - Math.floor(b); }
  secondsPerBeat() { return 60 / this.tempo; }
  secondsPerStep() { return 60 / this.tempo / this.subdivision; }

  // Next quantized audio time at or after `t` (audio seconds).
  nextStepTime(t, subdivision = this.subdivision) {
    const step = 60 / this.tempo / subdivision;
    return Math.ceil((t - 0.004) / step) * step;
  }

  setTempo(bpm) { this.tempo = Math.max(20, Math.min(300, bpm)); this.events?.emit('clock:tempo', { tempo: this.tempo }); }

  after(seconds, fn, owner = 'core') {
    if (this._heap.size >= this.maxScheduled) { this.dropped++; return null; }
    const job = { t: this.time + Math.max(0, seconds), fn, owner, id: ++this._seq, cancelled: false };
    this._heap.push(job);
    return job;
  }
  cancel(job) { if (job) job.cancelled = true; }
  cancelOwner(owner) { this._heap.filter((j) => j.owner !== owner); }
  clearScheduled() { this._heap.clear(); }
  get scheduledCount() { return this._heap.size; }

  _runScheduled() {
    let guard = 0;
    while (this._heap.size && this._heap.peek().t <= this.time && guard++ < 2000) {
      const job = this._heap.pop();
      if (job.cancelled) continue;
      try { job.fn(this.time); }
      catch (err) { this.events?.emit('app:error', { error: err, source: `clock job (${job.owner})` }); }
    }
  }

  _beats() {
    const pos = this.beatPosition();
    const beat = Math.floor(pos);
    const step = Math.floor(pos * this.subdivision);
    if (beat !== this._lastBeat) {
      this._lastBeat = beat;
      this.events?.emit('clock:beat', { beat, bar: Math.floor(beat / 4), time: this.time, musical: this.musical });
    }
    if (step !== this._lastStep) {
      this._lastStep = step;
      this.events?.emit('clock:step', { step, subdivision: this.subdivision, time: this.time, musical: this.musical });
    }
  }
}
