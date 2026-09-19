import { createEffectsChain } from "../../core/effects.js";
import { createMonoStepSequencer, noteToFreq } from "../../core/mono-step-sequencer.js";

export const manifest = {
  id: "fold",
  name: "Fold",
  shortName: "Fold",
  description: "A harsh wavefolder synth - a simple sine driven into repeated folding until it screams.",
  category: "Synths",
  tags: ["synth", "wavefolding", "harsh", "monophonic"],
  version: "1.0.0",
  icon: "\u{1F300}",
  supportsSequencer: true,
  supportsLivePlay: false,
  supportsEffects: true,
  supportsTempo: true,
  polyphony: 1,
  defaultWidth: 360,
  defaultHeight: 420,
  minimumWidth: 260,
  minimumHeight: 300,
};

// Repeated sin(x*k) folding stages, applied to an over-driven sine. Small
// changes in drive push the signal across another fold boundary, which is
// why this one reacts so disproportionately to small knob moves.
function makeFoldCurve(stages) {
  const n = 2048;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let x = (i * 2) / n - 1;
    for (let s = 0; s < stages; s++) x = Math.sin(x * Math.PI * 1.5);
    curve[i] = x;
  }
  return curve;
}

function createFoldEngine(ctx, dest) {
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = 110;
  const drive = ctx.createGain();
  drive.gain.value = 3;
  const shaper = ctx.createWaveShaper();
  shaper.curve = makeFoldCurve(3);
  shaper.oversample = "4x";
  const post = ctx.createBiquadFilter();
  post.type = "lowpass";
  post.frequency.value = 6000;
  const amp = ctx.createGain();
  amp.gain.value = 0;
  osc.connect(drive);
  drive.connect(shaper);
  shaper.connect(post);
  post.connect(amp);
  osc.start();

  function trigger(time, { note, octave, accent, glideIn }) {
    const freq = noteToFreq(note, octave, 40);
    osc.frequency.cancelScheduledValues(time);
    if (glideIn) {
      osc.frequency.setValueAtTime(osc.frequency.value, time);
      osc.frequency.linearRampToValueAtTime(freq, time + 0.06);
    } else {
      osc.frequency.setValueAtTime(freq, time);
    }
    drive.gain.setTargetAtTime(accent ? 6.5 : 3.2, time, 0.01);

    amp.gain.cancelScheduledValues(time);
    if (!glideIn) {
      amp.gain.setValueAtTime(0.0001, time);
      amp.gain.exponentialRampToValueAtTime(accent ? 0.7 : 0.5, time + 0.008);
    }
    amp.gain.exponentialRampToValueAtTime(0.0001, time + 0.35);
  }

  function dispose() {
    try {
      osc.stop();
      osc.disconnect();
      drive.disconnect();
      shaper.disconnect();
      post.disconnect();
      amp.disconnect();
    } catch (e) {}
  }

  amp.connect(dest);
  return { trigger, dispose };
}

export function create(ctx) {
  const output = createEffectsChain(ctx);
  const engine = createFoldEngine(ctx, output.input);
  const seq = createMonoStepSequencer({
    trigger: engine.trigger,
    defaultPattern: () => {
      const s = Array.from({ length: 16 }, () => ({ active: false, note: 0, octave: 0, accent: false, slide: false }));
      [0, 2, 4, 6, 8, 10, 12, 14].forEach((i, k) => {
        s[i] = { active: true, note: [0, 0, 3, 0, 7, 5, 3, 0][k], octave: 0, accent: k % 4 === 0, slide: false };
      });
      return s;
    },
  });

  return {
    manifest,
    mount(el) { seq.mount(el, "im-mono-synth"); },
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
      engine.dispose();
      try { output.output.disconnect(); } catch (e) {}
    },
  };
}
