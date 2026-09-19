import { createEffectsChain } from "../../core/effects.js";
import { createDrumSequencer } from "../../core/drum-grid-ui.js";
import { makeNoiseBuffer, playMetallicHat } from "../../core/dsp-utils.js";

export const manifest = {
  id: "kit-909",
  name: "909 Kit",
  shortName: "909",
  description: "A punchy, clicky kick, a layered 909-style clap, and bright open/closed hats - the house and techno workhorse.",
  category: "Drums",
  tags: ["drums", "909", "house", "techno", "synthesized"],
  version: "1.0.0",
  icon: "\u{1F455}",
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
  { id: "kick", label: "KICK" },
  { id: "clap", label: "CLAP" },
  { id: "closedHat", label: "CH" },
  { id: "openHat", label: "OH" },
];

function defaultPattern() {
  const p = Object.fromEntries(VOICES.map((v) => [v.id, new Array(16).fill(false)]));
  [0, 4, 8, 12].forEach((i) => (p.kick[i] = true));
  [4, 12].forEach((i) => (p.clap[i] = true));
  for (let i = 0; i < 16; i += 2) p.closedHat[i] = true;
  p.openHat[14] = true;
  return p;
}

// Tighter, clickier kick than an 808 (shorter pitch sweep, a harder
// transient), a layered noise-burst "flam" clap that's the 909's most
// recognizable sound, and bright metallic hats a shade higher-pitched
// than the other kits so all three read as distinct kits stacked together.
function createKit909Engine(ctx, dest) {
  const noiseBuffer = makeNoiseBuffer(ctx, 0.3);
  let activeOpenHatEnv = null;

  function playKick(time) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(180, time);
    osc.frequency.exponentialRampToValueAtTime(52, time + 0.05);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.exponentialRampToValueAtTime(1, time + 0.002);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + 0.22);
    osc.connect(amp);
    amp.connect(dest);
    osc.start(time);
    osc.stop(time + 0.25);

    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1400;
    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(0.55, time);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.012);
    src.connect(hp);
    hp.connect(clickGain);
    clickGain.connect(dest);
    src.start(time);
    src.stop(time + 0.02);
  }

  function playClap(time) {
    // Three tight noise flams, then a longer bandpassed tail.
    [0, 0.011, 0.022].forEach((offset) => {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1200;
      bp.Q.value = 1.2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.5, time + offset);
      g.gain.exponentialRampToValueAtTime(0.0001, time + offset + 0.012);
      src.connect(bp);
      bp.connect(g);
      g.connect(dest);
      src.start(time + offset);
      src.stop(time + offset + 0.02);
    });

    const tailSrc = ctx.createBufferSource();
    tailSrc.buffer = noiseBuffer;
    const tailBp = ctx.createBiquadFilter();
    tailBp.type = "bandpass";
    tailBp.frequency.value = 1200;
    tailBp.Q.value = 1.2;
    const tailGain = ctx.createGain();
    tailGain.gain.setValueAtTime(0.0001, time + 0.03);
    tailGain.gain.exponentialRampToValueAtTime(0.4, time + 0.04);
    tailGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.2);
    tailSrc.connect(tailBp);
    tailBp.connect(tailGain);
    tailGain.connect(dest);
    tailSrc.start(time + 0.03);
    tailSrc.stop(time + 0.22);
  }

  function playHat(time, isOpen) {
    if (!isOpen && activeOpenHatEnv) {
      const env = activeOpenHatEnv;
      env.gain.cancelScheduledValues(time);
      env.gain.setValueAtTime(env.gain.value, time);
      env.gain.exponentialRampToValueAtTime(0.0001, time + 0.03);
      activeOpenHatEnv = null;
    }
    const env = playMetallicHat(ctx, dest, time, { baseFreq: 48, decay: isOpen ? 0.4 : 0.05, toneHz: 4200 });
    if (isOpen) activeOpenHatEnv = env;
  }

  return {
    kick: (time) => playKick(time),
    clap: (time) => playClap(time),
    closedHat: (time) => playHat(time, false),
    openHat: (time) => playHat(time, true),
  };
}

export function create(ctx) {
  const output = createEffectsChain(ctx);
  const engine = createKit909Engine(ctx, output.input);
  const seq = createDrumSequencer({
    voices: VOICES,
    defaultPattern,
    trigger: (id, time) => {
      const t = time ?? ctx.currentTime;
      engine[id](t);
    },
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
