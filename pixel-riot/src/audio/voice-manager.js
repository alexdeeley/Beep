// Polyphony management: every sounding voice is tracked; the voice count is capped;
// the oldest voice is stolen with a fast (~12ms) fade so stealing never clicks; finished
// voices disconnect themselves. Works with any AudioContext-like object.

export class VoiceManager {
  constructor({ maxVoices = 24 } = {}) {
    this.maxVoices = maxVoices;
    this.voices = [];   // { id, end, gain, stop(t), sustain, key, started }
    this._id = 0;
    this.stolen = 0;
  }

  get count() { this._prune(); return this.voices.length; }

  _prune(now) {
    if (now == null) return;
    this.voices = this.voices.filter((v) => v.sustain || v.end > now - 0.05);
  }

  // Reserve a slot; steals if needed. Returns the voice record to fill in.
  allocate(ac, { sustain = false, key = null } = {}) {
    const now = ac.currentTime;
    this._prune(now);
    while (this.voices.length >= this.maxVoices) {
      // Prefer stealing one-shots over sustained voices.
      let idx = this.voices.findIndex((v) => !v.sustain);
      if (idx < 0) idx = 0;
      const v = this.voices.splice(idx, 1)[0];
      this._fadeOut(ac, v, now);
      this.stolen++;
    }
    const v = { id: ++this._id, end: Infinity, sustain, key, started: now, gain: null, stop: null };
    this.voices.push(v);
    return v;
  }

  _fadeOut(ac, v, now) {
    try {
      if (v.gain) { v.gain.gain.cancelScheduledValues(now); v.gain.gain.setTargetAtTime(0, now, 0.012); }
      v.stop?.(now + 0.08);
    } catch {}
    v.end = now;
  }

  release(key, ac, releaseTime = 0.25) {
    const now = ac.currentTime;
    for (const v of this.voices) {
      if (v.key === key && v.sustain) {
        v.sustain = false;
        try { v.release ? v.release(now, releaseTime) : this._fadeOut(ac, v, now); } catch {}
        v.end = now + releaseTime + 0.1;
      }
    }
  }

  find(key) { return this.voices.find((v) => v.key === key && v.sustain) || null; }

  stopAll(ac) { const now = ac.currentTime; for (const v of this.voices) this._fadeOut(ac, v, now); this.voices = []; }
}
