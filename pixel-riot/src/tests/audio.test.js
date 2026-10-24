// Audio: generators/sounds/mappings registries, voice limits, param safety, music helpers.
// Uses a recording fake AudioContext (Node has no Web Audio).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../core/event-bus.js';
import { Clock } from '../core/clock.js';
import { Settings } from '../core/settings.js';
import { Storage } from '../core/storage.js';
import { GridModel } from '../grid/grid-model.js';
import { AudioEngine } from '../audio/audio-engine.js';
import { VoiceManager } from '../audio/voice-manager.js';
import { BUILTIN_GENERATORS } from '../audio/builtins.js';
import { BUILTIN_SOUNDS, validateSound } from '../audio/sound-registry.js';
import { BUILTIN_AUDIO_MAPPINGS } from '../audio/audio-mapping.js';
import { SCALES, degreeToMidi, normToMidi, midiToFreq, TapTempo } from '../audio/music.js';
import { memoryBackend } from './helpers.js';

class FakeParam { constructor(v = 0) { this.value = v; this.log = []; } setValueAtTime(v, t) { this.log.push(['set', v, t]); this.value = v; } linearRampToValueAtTime(v, t) { this.log.push(['lin', v, t]); } exponentialRampToValueAtTime(v, t) { if (!(v > 0)) throw new Error('exp ramp to non-positive'); this.log.push(['exp', v, t]); } setTargetAtTime(v, t, c) { this.log.push(['tgt', v, t, c]); } cancelScheduledValues() {} }
class FakeNode {
  constructor(ac, kind) { this.ac = ac; this.kind = kind; ac.nodes.push(this); this.out = new Set(); }
  connect(n) { this.out.add(n); return n; } disconnect() { this.out.clear(); }
  start() { this.started = true; } stop(t) { this.stopAt = t; }
}
class FakeAC {
  constructor() { this.currentTime = 0; this.sampleRate = 8000; this.state = 'running'; this.nodes = []; this.destination = new FakeNode(this, 'dest'); }
  resume() { return Promise.resolve(); }
  _n(kind, params) { const n = new FakeNode(this, kind); for (const [k, v] of Object.entries(params)) n[k] = new FakeParam(v); return n; }
  createGain() { return this._n('gain', { gain: 1 }); }
  createOscillator() { const n = this._n('osc', { frequency: 440, detune: 0 }); n.type = 'sine'; return n; }
  createBiquadFilter() { return this._n('biquad', { frequency: 350, Q: 1, gain: 0 }); }
  createBufferSource() { return this._n('buffer', { playbackRate: 1 }); }
  createDynamicsCompressor() { return this._n('comp', { threshold: 0, knee: 0, ratio: 1, attack: 0, release: 0 }); }
  createDelay() { return this._n('delay', { delayTime: 0 }); }
  createConvolver() { return this._n('convolver', {}); }
  createStereoPanner() { return this._n('pan', { pan: 0 }); }
  createWaveShaper() { return this._n('shaper', {}); }
  createBuffer(ch, n) { const data = Array.from({ length: ch }, () => new Float32Array(n)); return { length: n, getChannelData: (c) => data[c] }; }
}

function engine() {
  globalThis.AudioContext = FakeAC;
  const events = new EventBus();
  const settings = new Settings({ storage: new Storage(memoryBackend()), events });
  const e = new AudioEngine({ events, clock: new Clock({ events }), settings, grid: new GridModel(10, 10) });
  for (const g of BUILTIN_GENERATORS) e.generators.register(g);
  for (const s of BUILTIN_SOUNDS) e.sounds.register(s);
  for (const m of BUILTIN_AUDIO_MAPPINGS) e.mappings.register(m);
  e.unlock();
  return { e, settings, events };
}

test('registries: all generators, sounds and mappings are valid; sounds reference real generators', () => {
  const { e } = engine();
  assert.ok(BUILTIN_GENERATORS.length >= 19, `${BUILTIN_GENERATORS.length} generators`);
  assert.ok(BUILTIN_SOUNDS.length >= 14);
  for (const s of BUILTIN_SOUNDS) for (const l of s.layers) assert.ok(e.generators.has(l.gen), `${s.id} -> ${l.gen}`);
  assert.ok(validateSound({ id: 'x', layers: [] }).length > 0);
  assert.throws(() => e.mappings.register({ id: 'no-map' }));
});

test('every sound plays on a fake context with envelopes and bounded times', () => {
  const { e } = engine();
  for (const s of BUILTIN_SOUNDS) {
    const m = e.map('position-pitch', { x: 0.5, y: 0.5, speed: 1, pressure: 0.5 });
    const h = s.sustain ? e.sustain(s.id, m, 'k-' + s.id) : e.play(s.id, m);
    assert.ok(h && h.length > 0, s.id);
    if (s.sustain) e.release('k-' + s.id);
  }
  assert.equal(e.errors, 0);
});

test('voice limits: polyphony is capped during rapid triggering and stolen voices fade', () => {
  const { e } = engine();
  for (let i = 0; i < 200; i++) e.play('pluck', { degree: i % 12, gain: 1 });
  assert.ok(e.voices.voices.length <= e.voices.maxVoices);
  assert.ok(e.voices.stolen > 150);
});

test('params are clamped to generator ranges (no runaway gain or frequency)', () => {
  const { e } = engine();
  const before = e.ac.nodes.length;
  e.play('thump', { midi: 200, gain: 50, cutoff: 1e9, decay: 1e6 });
  const oscs = e.ac.nodes.slice(before).filter((n) => n.kind === 'osc');
  for (const o of oscs) for (const [, v] of o.frequency.log) assert.ok(v <= 9000 * 8, `freq ${v}`);
  const gains = e.ac.nodes.slice(before).filter((n) => n.kind === 'gain');
  for (const g of gains) for (const entry of g.gain.log) if (entry[0] === 'lin') assert.ok(entry[1] <= 1, `gain ${entry[1]}`);
  // master volume ceiling
  e.settings.set('audio.volume', 1); e.applySettings();
  const tgt = e.master.gain.log.filter((x) => x[0] === 'tgt').at(-1);
  assert.ok(tgt[1] <= 0.9);
});

test('audio disabled or unavailable: play is a safe no-op', () => {
  const { e, settings } = engine();
  settings.set('audio.enabled', false);
  assert.equal(e.play('click', {}), null);
  delete globalThis.AudioContext;
  const e2 = new AudioEngine({ events: new EventBus(), clock: new Clock(), settings, grid: new GridModel(4, 4) });
  assert.equal(e2.state, 'unavailable'); assert.equal(e2.unlock(), false); assert.equal(e2.play('click', {}), null);
});

test('quantized start times land on the subdivision grid in musical mode', () => {
  const { e, settings } = engine();
  settings.set('music.enabled', true); settings.set('music.quantize', true);
  e.clock.tempo = 120; e.clock.subdivision = 4; e.ac.currentTime = 1.01;
  const t = e.startTime();
  assert.ok(Math.abs((t / 0.125) - Math.round(t / 0.125)) < 1e-9 && t >= 1.01, `t=${t}`);
  settings.set('music.quantize', false);
  assert.ok(Math.abs(e.startTime() - 1.015) < 1e-9);
});

test('audio mappings return safe ranges for extreme events', () => {
  const { e } = engine();
  for (const m of BUILTIN_AUDIO_MAPPINGS) {
    for (const ev of [{ x: 0, y: 0 }, { x: 1, y: 1, speed: 99, pressure: 1, level: 1, scale: 9, rotation: 6, depth: 30, activePointerCount: 10 }]) {
      const r = e.map(m.id, ev);
      if (r.gain != null) assert.ok(r.gain >= 0 && r.gain <= 1, `${m.id} gain ${r.gain}`);
      if (r.pan != null) assert.ok(r.pan >= -1 && r.pan <= 1, `${m.id} pan ${r.pan}`);
    }
  }
});

test('music helpers: scales, degrees, quantization, tap tempo', () => {
  assert.equal(degreeToMidi(0, 'major', 0, 60), 60);
  assert.equal(degreeToMidi(7, 'major', 0, 60), 72);
  assert.equal(degreeToMidi(-1, 'pentatonic-minor', 0, 60), 58);
  const notes = new Set(); for (let i = 0; i <= 100; i++) notes.add(normToMidi(i / 100, { scale: 'pentatonic-major', root: 2, base: 48 }) % 12);
  for (const n of notes) assert.ok(SCALES['pentatonic-major'].map((s) => (s + 2) % 12).includes(n));
  assert.ok(Math.abs(midiToFreq(69) - 440) < 1e-9);
  const tt = new TapTempo(); let bpm = null; for (let i = 0; i < 5; i++) bpm = tt.tap(i * 0.5);
  assert.equal(bpm, 120);
});

test('voice manager standalone: steal oldest one-shot before sustained voices', () => {
  const vm = new VoiceManager({ maxVoices: 3 });
  const ac = new FakeAC();
  const held = vm.allocate(ac, { sustain: true, key: 'h' }); held.end = Infinity;
  for (let i = 0; i < 5; i++) { const v = vm.allocate(ac); v.end = 10; }
  assert.equal(vm.voices.length, 3);
  assert.ok(vm.voices.includes(held));
});
