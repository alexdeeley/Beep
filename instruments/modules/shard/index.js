import { createEffectsChain } from "../../core/effects.js";
import { createDrumSequencer } from "../../core/drum-grid-ui.js";
import { makeNoiseBuffer } from "../../core/dsp-utils.js";

export const manifest = {
  id: "shard",
  name: "Shard",
  shortName: "Shard",
  description: "Brittle digital percussion - glassy ticks, ceramic hits, and tiny metallic snaps from one shared engine.",
  category: "Drums",
  tags: ["percussion", "brittle", "glass", "synthesized"],
  version: "1.0.0",
  icon: "\u{1F9CA}",
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
  { id: "tick", label: "TICK", freq: 3600, decay: 0.03, q: 10 },
  { id: "snap", label: "SNAP", freq: 2100, decay: 0.05, q: 7 },
  { id: "click", label: "CLICK", freq: 4600, decay: 0.02, q: 14 },
  { id: "knock", label: "KNOCK", freq: 1100, decay: 0.09, q: 5 },
];

function defaultPattern() {
  const p = Object.fromEntries(VOICES.map((v) => [v.id, new Array(16).fill(false)]));
  [0, 4, 8, 12].forEach((i) => (p.tick[i] = true));
  [2, 10].forEach((i) => (p.click[i] = true));
  p.snap[6] = true;
  p.snap[14] = true;
  p.knock[0] = true;
  p.knock[8] = true;
  return p;
}

// One shared brittle-hit generator (short noise burst through a
// bandpass+highpass pair) driving all four voices, each just a different
// register/decay/resonance of the same material - that's what keeps a
// randomized pattern sounding like "one family of shards" rather than
// unrelated noise.
function createShardEngine(ctx, dest) {
  const noiseBuffer = makeNoiseBuffer(ctx, 0.05);
  const voiceParams = Object.fromEntries(VOICES.map((v) => [v.id, v]));

  function hit(id, time) {
    const t = time ?? ctx.currentTime;
    const v = voiceParams[id];
    const jitter = 1 + (Math.random() - 0.5) * 0.35;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = v.freq * jitter;
    bp.Q.value = v.q + Math.random() * 4;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = v.freq * 0.55;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.7, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + v.decay);
    src.connect(bp);
    bp.connect(hp);
    hp.connect(g);
    g.connect(dest);
    src.start(t);
    src.stop(t + v.decay + 0.02);
  }

  return { hit };
}

export function create(ctx) {
  const output = createEffectsChain(ctx);
  const engine = createShardEngine(ctx, output.input);
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
