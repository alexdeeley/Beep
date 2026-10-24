// Procedural audio engine (Web Audio API).
//
// Graph:  voices -> [voice gain -> panner] -> bus -> compressor/limiter -> master -> destination
//                                            \-> space send -> delay + reverb ---^
//
// Safety: the context only starts from a user gesture (unlock()); master gain is capped
// (LIMITS.masterVolumeCeiling); every voice has an envelope (no clicks); polyphony is capped
// by the VoiceManager (oldest voice stolen with a fade); all params are clamped to each
// generator's declared range; when Web Audio is missing everything degrades to no-ops.
//
// Timing: sounds are scheduled on the Web Audio clock. In musical mode with quantize on,
// start times snap to the next subdivision of the shared Clock tempo; visuals are never
// delayed — they react immediately while the sound lands on the grid.

import { VoiceManager } from './voice-manager.js';
import { createSoundRegistry, createGeneratorRegistry, createAudioMappingRegistry } from './sound-registry.js';
import { makeNoiseBuffer } from './generators/common.js';
import { degreeToMidi, midiToFreq, normToMidi, SCALES } from './music.js';
import { LIMITS } from '../config.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class AudioEngine {
  constructor({ events, clock, settings, grid }) {
    this.events = events; this.clock = clock; this.settings = settings; this.grid = grid;
    this.generators = createGeneratorRegistry(events);
    this.sounds = createSoundRegistry(events);
    this.mappings = createAudioMappingRegistry(events);
    this.voices = new VoiceManager({ maxVoices: LIMITS.maxVoices });
    this.ac = null; this.state = 'locked';
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    this.supported = !!AC;
    if (!this.supported) this.state = 'unavailable';
    this._AC = AC;
    this.played = 0; this.errors = 0;
    this.mapCtx = {
      music: {},
      grid,
      mappings: this.mappings,
      energyAt: (x, y) => { const g = this.grid; const gx = Math.min(g.cols - 1, Math.floor(x * g.cols)), gy = Math.min(g.rows - 1, Math.floor(y * g.rows)); return g.energy[gy * g.cols + gx] || 0; },
      paintAt: (x, y) => { const g = this.grid; const gx = Math.min(g.cols - 1, Math.floor(x * g.cols)), gy = Math.min(g.rows - 1, Math.floor(y * g.rows)); return g.paint[gy * g.cols + gx]; },
      normToDegree: (n, octaves = 2) => { const s = SCALES[this.mapCtx.music.scale] || SCALES.chromatic; return Math.floor(clamp(n, 0, 0.999) * octaves * s.length); },
      normToMidi: (n, octaves = 2) => normToMidi(n, { ...this.mapCtx.music, octaves }),
    };
    this._syncMusic();
  }

  _syncMusic() {
    const s = this.settings;
    this.mapCtx.music = { scale: s.get('music.scale'), root: s.get('music.root'), free: s.get('music.freePitch'), base: 48 };
  }

  get enabled() { return this.settings.get('audio.enabled') && this.supported; }
  get running() { return this.ac && this.ac.state === 'running'; }

  // Must be called synchronously inside a user-gesture handler (pointerdown / click).
  unlock() {
    if (!this.supported || !this.settings.get('audio.enabled')) return false;
    try {
      if (!this.ac) this._build();
      if (this.ac.state !== 'running') this.ac.resume().then(() => this._setState('running')).catch(() => {});
      // iOS: play a 1-sample silent buffer inside the gesture.
      const b = this.ac.createBuffer(1, 1, this.ac.sampleRate); const src = this.ac.createBufferSource(); src.buffer = b; src.connect(this.ac.destination); src.start(0);
      return true;
    } catch (err) { this._fail(err); return false; }
  }

  _build() {
    const ac = new this._AC({ latencyHint: 'interactive' });
    this.ac = ac;
    this.shared = { noise: makeNoiseBuffer(ac) };
    this.bus = ac.createGain(); this.bus.gain.value = 0.8;
    this.comp = ac.createDynamicsCompressor();
    this.comp.threshold.value = -12; this.comp.knee.value = 6; this.comp.ratio.value = 12; this.comp.attack.value = 0.003; this.comp.release.value = 0.2;
    this.master = ac.createGain();
    this.send = ac.createGain();
    // Space: tempo-related feedback delay + generated-impulse reverb.
    this.delay = ac.createDelay(2); this.fb = ac.createGain(); this.fb.gain.value = 0.32;
    const dl = ac.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 3200;
    this.delay.connect(dl); dl.connect(this.fb); this.fb.connect(this.delay);
    this.reverb = ac.createConvolver(); this.reverb.buffer = this._impulse(2.4);
    const wet = ac.createGain(); wet.gain.value = 0.9;
    this.send.connect(this.delay); this.send.connect(this.reverb);
    dl.connect(wet); this.reverb.connect(wet); wet.connect(this.comp);
    this.bus.connect(this.comp); this.bus.connect(this.send);
    this.comp.connect(this.master); this.master.connect(ac.destination);
    this.clock.audioTimeSource = () => (this.running ? this.ac.currentTime : null);
    ac.onstatechange = () => this._setState(ac.state === 'running' ? 'running' : 'suspended');
    this.applySettings();
    this._setState(ac.state === 'running' ? 'running' : 'suspended');
  }

  _impulse(sec) {
    const ac = this.ac; const n = Math.floor(ac.sampleRate * sec);
    const buf = ac.createBuffer(2, n, ac.sampleRate);
    for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2); }
    return buf;
  }

  applySettings() {
    this._syncMusic();
    if (!this.ac) return;
    const t = this.ac.currentTime;
    const vol = this.settings.get('audio.enabled') ? Math.pow(this.settings.get('audio.volume'), 2) * LIMITS.masterVolumeCeiling : 0;
    this.master.gain.setTargetAtTime(vol, t, 0.03);
    this.send.gain.setTargetAtTime(this.settings.get('audio.space') * 0.55, t, 0.05);
    this.delay.delayTime.setTargetAtTime(clamp(this.clock.secondsPerBeat() * 0.75, 0.05, 1.9), t, 0.05);
    if (!this.settings.get('audio.enabled')) this.voices.stopAll(this.ac);
  }

  _setState(s) { if (this.state !== s) { this.state = s; this.events?.emit('audio:state', { state: s }); } }
  _fail(err) { this.errors++; this.events?.emit('app:error', { error: err, source: 'audio engine' }); }

  // Resolve a mapping result into a MIDI note for a layer.
  _layerMidi(m, layer) {
    const mc = this.mapCtx.music;
    let midi;
    if (m.degree != null && !mc.free) midi = degreeToMidi(m.degree + (layer.degree || 0), mc.scale, mc.root, mc.base);
    else midi = (m.midi ?? (m.degree != null ? mc.base + mc.root + m.degree * 2 : 60)) + (layer.degree || 0) * 2;
    return midi + (layer.octave || 0) * 12 + (layer.semis || 0);
  }

  // Compute the start time (quantized when musical mode asks for it).
  startTime(opts = {}) {
    const now = this.ac.currentTime + 0.005;
    if (opts.when != null) return Math.max(now, opts.when);
    const quant = opts.quantize ?? (this.settings.get('music.enabled') && this.settings.get('music.quantize'));
    return quant ? Math.max(now, this.clock.nextStepTime(now)) : now;
  }

  // Map an event with a mapping id -> params object.
  map(mappingId, ev) {
    const m = this.mappings.get(mappingId) || this.mappings.get('position-pitch');
    try { return m.map(ev, this.mapCtx) || {}; }
    catch (err) { this._fail(err); return {}; }
  }

  // Play a named sound. `m` is a mapping result (degree/midi/gain/pan/cutoff...).
  // opts: { when, quantize, key (sustained voices), gain }
  play(soundId, m = {}, opts = {}) {
    if (!this.enabled || !this.ac || this.ac.state !== 'running') return null;
    const sound = this.sounds.get(soundId);
    if (!sound) return null;
    const when = this.startTime(opts);
    const handles = [];
    for (const layer of sound.layers) {
      const gen = this.generators.get(layer.gen);
      if (!gen) continue;
      const p = {};
      for (const [k, s] of Object.entries(gen.params)) p[k] = s.default;
      Object.assign(p, layer.params || {});
      if (layer.pitch !== false) p.freq = midiToFreq(this._layerMidi(m, layer));
      // Any mapping value naming a generator param overrides it (freq/gain are derived below).
      for (const k of Object.keys(m)) if (k !== 'freq' && k !== 'gain' && k in gen.params && Number.isFinite(m[k])) p[k] = m[k];
      p.gain = (m.gain ?? 0.5) * (layer.gain ?? 1) * (opts.gain ?? 1);
      for (const [k, s] of Object.entries(gen.params)) p[k] = clamp(Number.isFinite(p[k]) ? p[k] : s.default, s.min, s.max);
      const h = this._voice(gen, p, when + (layer.delay || 0), m.pan || 0, sound.sustain ? opts.key ?? soundId : null);
      if (h) handles.push(h);
    }
    if (handles.length) { this.played++; this.events?.emit('audio:played', { soundId, when, voices: handles.length }); }
    return handles;
  }

  _voice(gen, p, when, pan, key) {
    const ac = this.ac;
    const v = this.voices.allocate(ac, { sustain: !!key, key });
    try {
      const g = ac.createGain(); g.gain.value = 1;
      let node = g;
      if (ac.createStereoPanner) { const pn = ac.createStereoPanner(); pn.pan.value = clamp(pan, -1, 1); g.connect(pn); node = pn; }
      node.connect(this.bus);
      const voice = gen.create(ac, g, when, p, this.shared);
      v.gain = g; v.stop = voice.stop; v.set = voice.set; v.release = voice.release; v.end = voice.end;
      const cleanupAt = (voice.end === Infinity ? null : voice.end);
      const cleanup = () => { try { voice.dispose?.(); g.disconnect(); node.disconnect(); } catch {} };
      if (cleanupAt != null) setTimeout(cleanup, Math.max(0, (cleanupAt - ac.currentTime) * 1000 + 300));
      else v.cleanup = cleanup;
      return v;
    } catch (err) { this._fail(err); v.end = 0; return null; }
  }

  // Sustained voices (long press, pads): start / update / release by key.
  sustain(soundId, m, key) {
    if (!this.enabled || !this.running) return null;
    const live = this.voices.voices.filter((v) => v.key === key && v.sustain);
    if (live.length) { this.update(key, m); return live; }
    return this.play(soundId, m, { key, quantize: false });
  }
  update(key, m) {
    if (!this.ac) return;
    const t = this.ac.currentTime;
    for (const v of this.voices.voices) {
      if (v.key !== key || !v.sustain || !v.set) continue;
      const q = { ...m };
      if (m.midi != null || m.degree != null) q.freq = midiToFreq(this._layerMidi(m, {}));
      try { v.set(q, t); } catch (err) { this._fail(err); }
    }
  }
  release(key, seconds = 0.35) {
    if (!this.ac) return;
    const t = this.ac.currentTime;
    for (const v of this.voices.voices) {
      if (v.key !== key || !v.sustain) continue;
      v.sustain = false;
      try { v.release ? v.release(t, seconds) : v.stop?.(t + 0.05); } catch {}
      v.end = t + seconds + 0.2;
      if (v.cleanup) setTimeout(v.cleanup, (seconds + 0.6) * 1000);
    }
  }

  stopAll() { if (this.ac) this.voices.stopAll(this.ac); }

  get activeVoices() { return this.ac ? (this.voices._prune(this.ac.currentTime), this.voices.voices.length) : 0; }
}
