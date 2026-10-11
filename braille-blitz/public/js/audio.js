// Sound and haptics. Everything is synthesised with Web Audio - no files -
// so it works offline and loads instantly. Vibration uses the Vibration API
// where the browser has it (Android browsers do; iOS Safari does not), and
// says so honestly in the settings panel.
//
// Nothing here is the only way the game tells you something: every sound
// and buzz goes with text and a visual.

export const SETTINGS_KEY = 'braille-blitz.settings.v1';

const DEFAULTS = Object.freeze({ sound: true, vibrate: true, mute: false, speak: true, session: 20 });

export class Settings {
  constructor(storage) {
    this.storage = storage;
    this.data = { ...DEFAULTS };
    try { const raw = storage?.getItem(SETTINGS_KEY); if (raw) this.data = { ...DEFAULTS, ...JSON.parse(raw) }; } catch { /* fresh */ }
  }
  get(k) { return this.data[k]; }
  set(k, v) { this.data[k] = v; try { this.storage?.setItem(SETTINGS_KEY, JSON.stringify(this.data)); } catch { /* blocked */ } }
  get soundOn() { return this.data.sound && !this.data.mute; }
  get vibrateOn() { return this.data.vibrate && !this.data.mute; }
  get speakOn() { return this.data.speak && !this.data.mute; }
}

export const canVibrate = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

export class Feedback {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
  }

  // Browsers only let audio start after a user gesture; call this from one.
  unlock() {
    try {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch { this.ctx = null; }
  }

  tone(freq, { at = 0, dur = 0.12, type = 'sine', gain = 0.22, slide = 0 } = {}) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + at;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  play(kind) {
    if (!this.settings.soundOn || !this.ctx) return;
    switch (kind) {
      case 'correct': this.tone(1046.5, { dur: 0.1 }); this.tone(1318.5, { at: 0.09, dur: 0.16 }); break;        // C6 -> E6
      case 'wrong': this.tone(240, { dur: 0.22, type: 'triangle', gain: 0.2, slide: -60 }); break;             // a soft low "bonk"
      case 'milestone': [523.3, 659.3, 784, 1046.5].forEach((f, i) => this.tone(f, { at: i * 0.09, dur: 0.18 })); break;
      case 'complete': [523.3, 659.3, 784, 1046.5, 1318.5].forEach((f, i) => this.tone(f, { at: i * 0.1, dur: 0.22 })); this.tone(1318.5, { at: 0.55, dur: 0.5, gain: 0.18 }); break;
      case 'tap': this.tone(660, { dur: 0.04, gain: 0.08 }); break;
      default: break;
    }
  }

  buzz(kind) {
    if (!this.settings.vibrateOn || !canVibrate()) return false;
    const pattern = { correct: [40], wrong: [70, 50, 70], milestone: [30, 30, 30, 30, 90], complete: [40, 40, 40, 40, 40, 40, 120] }[kind];
    try { return pattern ? navigator.vibrate(pattern) : false; } catch { return false; }
  }

  // Both at once, for an answer.
  react(kind) { this.play(kind); this.buzz(kind); }

  // Read a prompt out loud (Practice by Touch). Quietly does nothing where
  // speech synthesis is missing.
  speak(text) {
    if (!this.settings.speakOn) return;
    try {
      if (!('speechSynthesis' in window)) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.95;
      window.speechSynthesis.speak(u);
    } catch { /* no voices */ }
  }
}
