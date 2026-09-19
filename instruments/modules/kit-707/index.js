import { createEffectsChain } from "../../core/effects.js";
import { createDrumSequencer } from "../../core/drum-grid-ui.js";
import { makeNoiseBuffer, playMetallicHat } from "../../core/dsp-utils.js";

export const manifest = {
  id: "kit-707",
  name: "707 Kit",
  shortName: "707",
  description: "A tight electronic kick, a bright snare, and a distinctive resonant rimshot - an 80s drum-machine kit.",
  category: "Drums",
  tags: ["drums", "707", "electro", "new-wave", "synthesized"],
  version: "1.0.0",
  icon: "\u{1F4BF}",
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
  { id: "snare", label: "SNARE" },
  { id: "rim", label: "RIM" },
  { id: "hat", label: "HAT" },
];

function defaultPattern() {
  const p = Object.fromEntries(VOICES.map((v) => [v.id, new Array(16).fill(false)]));
  [0, 6, 8].forEach((i) => (p.kick[i] = true));
  [4, 12].forEach((i) => (p.snare[i] = true));
  [2, 10, 14].forEach((i) => (p.rim[i] = true));
  for (let i = 0; i < 16; i += 2) p.hat[i] = true;
  return p;
}

// Neither the boom of an 808 nor the click of a 909 - the 707's kick is a
// clean, short mid-range pop, and its signature voice is the rimshot: a
// resonant bandpassed "tock" that's the one sound none of the other kits
// have, so it reads as its own kit even sitting next to them.
function createKit707Engine(ctx, dest) {
  const noiseBuffer = makeNoiseBuffer(ctx, 0.3);

  function playKick(time) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(70, time + 0.09);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.exponentialRampToValueAtTime(0.95, time + 0.003);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + 0.16);
    osc.connect(amp);
    amp.connect(dest);
    osc.start(time);
    osc.stop(time + 0.18);
  }

  function playSnare(time) {
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = 210;
    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0.35, time);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);
    osc.connect(bodyGain);
    bodyGain.connect(dest);
    osc.start(time);
    osc.stop(time + 0.07);

    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 3200;
    bp.Q.value = 0.8;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.5, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.09);
    src.connect(bp);
    bp.connect(noiseGain);
    noiseGain.connect(dest);
    src.start(time);
    src.stop(time + 0.1);
  }

  function playRim(time) {
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = 1800;
    const tickGain = ctx.createGain();
    tickGain.gain.setValueAtTime(0.3, time);
    tickGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.015);
    osc.connect(tickGain);
    tickGain.connect(dest);
    osc.start(time);
    osc.stop(time + 0.02);

    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 3000;
    bp.Q.value = 9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.6, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.035);
    src.connect(bp);
    bp.connect(g);
    g.connect(dest);
    src.start(time);
    src.stop(time + 0.04);
  }

  function playHat(time) {
    playMetallicHat(ctx, dest, time, { baseFreq: 45, decay: 0.05, toneHz: 3900 });
  }

  return {
    kick: (time) => playKick(time),
    snare: (time) => playSnare(time),
    rim: (time) => playRim(time),
    hat: (time) => playHat(time),
  };
}

export function create(ctx) {
  const output = createEffectsChain(ctx);
  const engine = createKit707Engine(ctx, output.input);
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
