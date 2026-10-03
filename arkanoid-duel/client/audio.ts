// All the sound, made with the Web Audio API - no samples, nothing copyrighted.
//
// The music is a TB-303-style acid bassline at 150 BPM (a 16th note = 100 ms).
// Notes are scheduled slightly ahead against the *audio* clock, which is far
// more accurate than setInterval, and the beat grid is anchored to the
// server's clock: step n happens at server time n x 100 ms. Both players
// therefore hear the same step at the same moment, and no musical note ever
// crosses the network.

import type { GameEvent } from '../shared/types.ts';

export const BPM = 150;
export const STEP_MS = 60000 / BPM / 4;     // 100

export interface AudioSettings { music: boolean; sfx: boolean; vibrate: boolean }
export type MusicMode = 'off' | 'game' | 'victory' | 'defeat';

const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

// One bar of acid bass, in A minor. null = rest. Accents get a harder filter
// sweep; slides glide up or down into the note from the one before.
const BASS = [33, 33, 45, 33, 36, null, 33, 48, 33, 45, 33, 40, 36, null, 43, 31];
const ACCENT = [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1];
const SLIDE = [0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0];
const SPARKLE = [69, 72, 76, 81, 76, 72, 79, 76];            // high pentatonic, for big combos
const VICTORY = [60, 64, 67, 72, 67, 64, 67, 72, 64, 67, 72, 76, 72, 67, 64, 60];
const DEFEAT = [57, 0, 0, 0, 53, 0, 0, 0, 50, 0, 0, 0, 45, 0, 0, 0];

export class GameAudio {
  settings: AudioSettings = { music: true, sfx: true, vibrate: true };
  mode: MusicMode = 'off';
  intensity = 0;                    // the biggest combo on court: more layers join as it grows
  getServerNow: () => number = () => Date.now();

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private shaper: WaveShaperNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextStep = 0;
  private lastFreq = 0;

  // Browsers only allow sound after a tap: call this from the first one.
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = (this.ctx = new AC());
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.ratio.value = 5;
      this.master = ctx.createGain(); this.master.gain.value = 0.9;
      this.musicBus = ctx.createGain(); this.musicBus.gain.value = this.settings.music ? 0.5 : 0;
      this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = this.settings.sfx ? 0.9 : 0;
      this.musicBus.connect(this.master); this.sfxBus.connect(this.master);
      this.master.connect(comp); comp.connect(ctx.destination);
      // a little grit for the bass: soft clipping
      this.shaper = ctx.createWaveShaper();
      const n = 256, curve = new Float32Array(n);
      for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(x * 2.6); }
      this.shaper.curve = curve;
      this.shaper.connect(this.musicBus);
      // a second of white noise to cut hats, claps and explosions from
      this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (!this.timer) this.timer = setInterval(() => this.schedule(), 25);
  }

  apply(settings: Partial<AudioSettings>): void {
    Object.assign(this.settings, settings);
    if (this.musicBus && this.ctx) this.musicBus.gain.setTargetAtTime(this.settings.music ? 0.5 : 0, this.ctx.currentTime, 0.05);
    if (this.sfxBus && this.ctx) this.sfxBus.gain.setTargetAtTime(this.settings.sfx ? 0.9 : 0, this.ctx.currentTime, 0.05);
  }

  setMode(m: MusicMode): void {
    if (m === this.mode) return;
    this.mode = m;
    // restart the grid at the next step so the new pattern starts on the beat
    this.nextStep = Math.ceil(this.getServerNow() / STEP_MS);
  }

  vibrate(ms: number): void {
    if (this.settings.vibrate && 'vibrate' in navigator) navigator.vibrate(ms);
  }

  // ── The sequencer ────────────────────────────────────────

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || this.mode === 'off' || !this.settings.music || ctx.state !== 'running') return;
    const serverNow = this.getServerNow();
    const AHEAD = 140;
    if (this.nextStep * STEP_MS < serverNow - 60) this.nextStep = Math.ceil(serverNow / STEP_MS);   // fell behind: catch up
    while (this.nextStep * STEP_MS < serverNow + AHEAD) {
      const t = ctx.currentTime + Math.max(0, (this.nextStep * STEP_MS - serverNow) / 1000);
      this.playStep(this.nextStep, t);
      this.nextStep++;
    }
  }

  private playStep(step: number, t: number): void {
    const i = ((step % 16) + 16) % 16;
    const bar = Math.floor(step / 16);
    const beat = STEP_MS / 1000;
    if (this.mode === 'victory') {
      this.pluck(midiHz(VICTORY[i]), t, beat * 1.6, 0.16, 'square');
      if (i % 4 === 0) { this.kick(t, 0.5); this.pluck(midiHz(VICTORY[i] - 24), t, beat * 3, 0.2, 'sawtooth'); }
      return;
    }
    if (this.mode === 'defeat') {
      if (DEFEAT[i]) this.pluck(midiHz(DEFEAT[i]), t, beat * 3.6, 0.2, 'sawtooth');
      return;
    }
    // The acid line: a slow filter sweep over eight bars keeps it hypnotic.
    const n = BASS[i];
    if (n !== null) this.acid(midiHz(n), t, beat * 0.9, !!ACCENT[i], !!SLIDE[i], 0.5 + 0.5 * Math.sin((bar / 8) * Math.PI * 2));
    const heat = this.intensity;
    if (heat >= 3 && i % 4 === 2) this.hat(t, 0.05, false);                       // off-beat hats
    if (heat >= 6 && i % 4 === 0) this.kick(t, 0.55);                              // four on the floor
    if (heat >= 10) { if (i % 2 === 1) this.hat(t, 0.035, true); if (i === 4 || i === 12) this.clap(t); }
    if (heat >= 20 && i % 2 === 0) this.pluck(midiHz(SPARKLE[(i / 2 + bar) % SPARKLE.length]), t, beat * 1.2, 0.07, 'square');
  }

  private acid(freq: number, t: number, len: number, accent: boolean, slide: boolean, sweep: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    if (slide && this.lastFreq) { osc.frequency.setValueAtTime(this.lastFreq, t); osc.frequency.exponentialRampToValueAtTime(freq, t + 0.07); }
    else osc.frequency.setValueAtTime(freq, t);
    this.lastFreq = freq;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.Q.value = accent ? 17 : 11;
    const base = 180 + sweep * 420;
    const peak = (accent ? 3200 : 1500) * (0.55 + 0.45 * sweep);
    filt.frequency.setValueAtTime(peak, t);
    filt.frequency.exponentialRampToValueAtTime(base, t + (accent ? 0.2 : 0.14));
    const amp = ctx.createGain();
    const vol = accent ? 0.34 : 0.24;
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(vol, t + 0.006);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + len);
    osc.connect(filt); filt.connect(amp); amp.connect(this.shaper!);
    osc.start(t); osc.stop(t + len + 0.05);
  }

  private pluck(freq: number, t: number, len: number, vol: number, type: OscillatorType): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator(); osc.type = type; osc.frequency.setValueAtTime(freq, t);
    const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 2600; filt.Q.value = 3;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t); amp.gain.linearRampToValueAtTime(vol, t + 0.004); amp.gain.exponentialRampToValueAtTime(0.0001, t + len);
    osc.connect(filt); filt.connect(amp); amp.connect(this.musicBus!);
    osc.start(t); osc.stop(t + len + 0.05);
  }

  private kick(t: number, vol: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(160, t); osc.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(vol, t); amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    osc.connect(amp); amp.connect(this.musicBus!);
    osc.start(t); osc.stop(t + 0.22);
  }

  private noise(t: number, len: number, type: BiquadFilterType, freq: number, vol: number, bus: GainNode, q = 0.7): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf!;
    const filt = ctx.createBiquadFilter(); filt.type = type; filt.frequency.value = freq; filt.Q.value = q;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(vol, t); amp.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(filt); filt.connect(amp); amp.connect(bus);
    src.start(t, Math.random() * 0.5); src.stop(t + len + 0.02);
  }
  private hat(t: number, vol: number, open: boolean): void { this.noise(t, open ? 0.09 : 0.04, 'highpass', 7500, vol, this.musicBus!); }
  private clap(t: number): void { for (const d of [0, 0.012, 0.026]) this.noise(t + d, 0.07, 'bandpass', 1600, 0.12, this.musicBus!, 1.2); }

  // ── Sound effects ────────────────────────────────────────

  private ready(): boolean { return !!this.ctx && this.ctx.state === 'running' && this.settings.sfx; }

  private blip(freq: number, type: OscillatorType, len: number, vol: number, to = 0, pan = 0, delay = 0): void {
    if (!this.ready()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator(); osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + len);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t); amp.gain.linearRampToValueAtTime(vol, t + 0.004); amp.gain.exponentialRampToValueAtTime(0.0001, t + len);
    osc.connect(amp);
    if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); amp.connect(p); p.connect(this.sfxBus!); }
    else amp.connect(this.sfxBus!);
    osc.start(t); osc.stop(t + len + 0.03);
  }

  private burst(len: number, freq: number, vol: number, type: BiquadFilterType = 'lowpass', delay = 0): void {
    if (!this.ready()) return;
    this.noise(this.ctx!.currentTime + delay, len, type, freq, vol, this.sfxBus!);
  }

  private arp(notes: number[], type: OscillatorType, step: number, vol: number, len = 0.18): void {
    notes.forEach((n, i) => this.blip(midiHz(n), type, len, vol, 0, 0, i * step));
  }

  tap(): void { this.blip(880, 'square', 0.05, 0.08); }

  // `me` is this player; `W` is the arena width, for panning sounds to where they happen.
  event(e: GameEvent, me: number, W: number): void {
    const pan = (x: number) => (x / W) * 2 - 1;
    switch (e[0]) {
      case 'sv': this.blip(260, 'sawtooth', 0.22, 0.14, 900); break;
      case 'pd': this.blip(e[1] === me ? 190 : 150, 'square', 0.07, 0.2, 90, pan(e[2]) * 0.6); this.vibrateOnce(me === e[1] ? 12 : 0); break;
      case 'wl': this.blip(130, 'triangle', 0.05, 0.1, 0, pan(e[1]) * 0.6); break;
      case 'bh': this.blip(540, 'square', 0.05, 0.1, 430); break;
      case 'bd': {
        const lift = 2 ** (Math.min(e[3], 14) / 12);
        this.burst(0.16, 2600, 0.2, 'lowpass');
        this.blip(430 * lift, 'sawtooth', 0.13, 0.14, 120 * lift);
        this.vibrateOnce(e[2] === me ? 14 : 0);
        break;
      }
      case 'ex': this.burst(0.5, 700, 0.5); this.blip(110, 'sine', 0.4, 0.4, 36); this.vibrateOnce(40); break;
      case 'sp': this.arp([72, 79, 84], 'triangle', 0.045, 0.14, 0.12); break;
      case 'pu': this.arp(e[1] === me ? [64, 68, 71, 76] : [64, 67], 'square', 0.055, 0.12); break;
      case 'cb': { const big = e[2] >= 20 ? 3 : e[2] >= 10 ? 2 : 1; this.arp([72, 76, 79, 84, 88].slice(0, 2 + big), 'square', 0.05, 0.14); break; }
      case 'sh': this.blip(900, 'sawtooth', 0.12, 0.14, 300); break;
      case 'lose': if (e[1] === me) { this.blip(320, 'sawtooth', 0.5, 0.22, 60); this.vibrateOnce(90); } else this.arp([60, 67, 72], 'triangle', 0.07, 0.12); break;
      case 'lc': this.arp([60, 64, 67, 72, 76, 79, 84], 'square', 0.07, 0.14, 0.25); break;
      default: break;
    }
  }

  private vibrateOnce(ms: number): void { if (ms) this.vibrate(ms); }

  // The end of a match: a short victory (or defeat) pattern replaces the gameplay sequence.
  finish(won: boolean): void {
    this.setMode(won ? 'victory' : 'defeat');
    if (won) this.arp([60, 64, 67, 72, 76, 79, 84, 88], 'square', 0.08, 0.16, 0.4);
    else this.arp([67, 64, 60, 55], 'sawtooth', 0.16, 0.12, 0.5);
  }
}
