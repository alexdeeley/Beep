import { createEffectsChain } from "../../core/effects.js";
import { createDrumSequencer } from "../../core/drum-grid-ui.js";

export const manifest = {
  id: "static",
  name: "Static",
  shortName: "Static",
  description: "Noise as raw material - white, pink, brown, and crackle noise, sliced into a rhythm.",
  category: "Experimental",
  tags: ["noise", "texture", "synthesized", "percussion"],
  version: "1.0.0",
  icon: "\u{1F4FA}",
  supportsSequencer: true,
  supportsLivePlay: true,
  supportsEffects: true,
  supportsTempo: true,
  polyphony: 4,
  defaultWidth: 380,
  defaultHeight: 420,
  minimumWidth: 260,
  minimumHeight: 300,
};

const VOICES = [
  { id: "white", label: "WHITE" },
  { id: "pink", label: "PINK" },
  { id: "brown", label: "BROWN" },
  { id: "crackle", label: "CRACKLE" },
];

function defaultPattern() {
  const p = Object.fromEntries(VOICES.map((v) => [v.id, new Array(16).fill(false)]));
  for (let i = 0; i < 16; i += 2) p.white[i] = true;
  p.pink[4] = true;
  p.pink[12] = true;
  p.brown[0] = true;
  p.brown[8] = true;
  [3, 7, 11, 15].forEach((i) => (p.crackle[i] = true));
  return p;
}

function makeColoredNoiseBuffer(ctx, color, duration = 1.5) {
  const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buf = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buf.getChannelData(0);
  if (color === "white") {
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  } else if (color === "brown") {
    let last = 0;
    for (let i = 0; i < length; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      data[i] = last * 3.5;
    }
  } else if (color === "pink") {
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      data[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
  } else {
    for (let i = 0; i < length; i++) data[i] = Math.random() < 0.015 ? Math.random() * 2 - 1 : 0;
  }
  return buf;
}

function createStaticEngine(ctx, dest) {
  const buffers = Object.fromEntries(VOICES.map((v) => [v.id, makeColoredNoiseBuffer(ctx, v.id)]));
  const settings = { white: { decay: 0.06, cutoff: 12000 }, pink: { decay: 0.12, cutoff: 6000 }, brown: { decay: 0.2, cutoff: 1200 }, crackle: { decay: 0.15, cutoff: 8000 } };

  function hit(id, time) {
    const t = time ?? ctx.currentTime;
    const cfg = settings[id];
    const src = ctx.createBufferSource();
    src.buffer = buffers[id];
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = cfg.cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + cfg.decay);
    src.connect(lp);
    lp.connect(g);
    g.connect(dest);
    src.start(t);
    src.stop(t + cfg.decay + 0.02);
  }

  return { hit };
}

export function create(ctx) {
  const output = createEffectsChain(ctx);
  const engine = createStaticEngine(ctx, output.input);
  const seq = createDrumSequencer({
    voices: VOICES,
    defaultPattern,
    trigger: (id, time) => engine.hit(id, time),
    now: () => ctx.currentTime,
  });

  return {
    manifest,
    mount(el) { seq.mount(el, "im-drum-kit"); },
    unmount() { seq.unmount(); },
    start() { seq.start(); },
    stop() { seq.stop(); },
    getAudioOutput() { return output.output; },
    setEffectAmount(kind, amount) { if (output[kind]) output[kind].setAmount(amount); },
    serialize() { return seq.serialize(); },
    restore(state) { seq.restore(state); },
    dispose() {
      this.stop();
      this.unmount();
      try { output.output.disconnect(); } catch (e) {}
    },
  };
}
