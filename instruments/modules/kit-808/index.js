import { createEffectsChain } from "../../core/effects.js";
import { createDrumSequencer } from "../../core/drum-grid-ui.js";
import { makeNoiseBuffer, playMetallicHat } from "../../core/dsp-utils.js";

export const manifest = {
  id: "kit-808",
  name: "808 Kit",
  shortName: "808",
  description: "A deep, long-booming sub kick with a tunable tail, a thin snare, a low tom, and a closed hat.",
  category: "Drums",
  tags: ["drums", "808", "trap", "hip-hop", "sub", "synthesized"],
  version: "1.0.0",
  icon: "\u{1F4A3}",
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
  { id: "tom", label: "TOM" },
  { id: "hat", label: "HAT" },
];

function defaultPattern() {
  const p = Object.fromEntries(VOICES.map((v) => [v.id, new Array(16).fill(false)]));
  [0, 8].forEach((i) => (p.kick[i] = true));
  p.kick[10] = true;
  [4, 12].forEach((i) => (p.snare[i] = true));
  for (let i = 0; i < 16; i += 2) p.hat[i] = true;
  p.tom[7] = true;
  return p;
}

// The 808's whole identity is the kick: a sine with a long, musical pitch
// glide and a decay long enough to carry as a held sub note rather than
// just a transient thump - the other three voices stay comparatively
// simple so the kick has room to be the star.
function createKit808Engine(ctx, dest) {
  const noiseBuffer = makeNoiseBuffer(ctx, 0.3);

  function playKick(time) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(130, time);
    osc.frequency.exponentialRampToValueAtTime(38, time + 0.28);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.exponentialRampToValueAtTime(1, time + 0.006);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + 0.65);
    osc.connect(amp);
    amp.connect(dest);
    osc.start(time);
    osc.stop(time + 0.7);
  }

  function playSnare(time) {
    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0.4, time);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.09);
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = 175;
    osc.connect(bodyGain);
    bodyGain.connect(dest);
    osc.start(time);
    osc.stop(time + 0.1);

    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2200;
    bp.Q.value = 0.9;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.45, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.07);
    src.connect(bp);
    bp.connect(noiseGain);
    noiseGain.connect(dest);
    src.start(time);
    src.stop(time + 0.08);
  }

  function playTom(time) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(220, time);
    osc.frequency.exponentialRampToValueAtTime(90, time + 0.18);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.exponentialRampToValueAtTime(0.8, time + 0.005);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + 0.3);
    osc.connect(amp);
    amp.connect(dest);
    osc.start(time);
    osc.stop(time + 0.32);
  }

  function playHat(time) {
    playMetallicHat(ctx, dest, time, { baseFreq: 42, decay: 0.045, toneHz: 3600 });
  }

  return {
    kick: (time) => playKick(time),
    snare: (time) => playSnare(time),
    tom: (time) => playTom(time),
    hat: (time) => playHat(time),
  };
}

export function create(ctx) {
  const output = createEffectsChain(ctx);
  const engine = createKit808Engine(ctx, output.input);
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
