import { createEffectsChain } from "../../core/effects.js";
import { createMonoStepSequencer, noteToFreq } from "../../core/mono-step-sequencer.js";
import { buildParamRow } from "../../core/param-controls.js";

export const manifest = {
  id: "acid-choke",
  name: "Acid Choke",
  shortName: "Choke",
  description: "An acid bass with an adjustable Threshold knob - past a point the filter self-oscillates into that screaming, choked rave squelch.",
  category: "Bass",
  tags: ["bass", "acid", "303", "resonance", "rave", "sequencer", "monophonic"],
  version: "1.0.0",
  icon: "\u{1F52A}",
  supportsSequencer: true,
  supportsLivePlay: false,
  supportsEffects: true,
  supportsTempo: true,
  polyphony: 1,
  defaultWidth: 380,
  defaultHeight: 460,
  minimumWidth: 260,
  minimumHeight: 320,
};

const PORTAMENTO_TIME = 0.07;

// Same persistent saw + lowpass + amp-envelope shape as a standard acid
// bass, but the filter's resonance (Q) is a live-adjustable "Threshold"
// rather than a fixed value. A biquad lowpass genuinely self-oscillates
// once Q climbs into the ~15-25 range - it starts ringing a near-pure
// tone at the cutoff frequency instead of just shaping the saw's
// harmonics - which is the real mechanism behind the classic screaming/
// choked acid-house squelch, not a fake "distortion" stand-in for it.
function createChokeEngine(ctx, dest) {
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.value = 110;

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 450;
  filter.Q.value = 9;

  const compensate = ctx.createGain();
  compensate.gain.value = 1;

  const ampEnv = ctx.createGain();
  ampEnv.gain.value = 0;

  osc.connect(filter);
  filter.connect(compensate);
  compensate.connect(ampEnv);
  osc.start();

  let params = { cutoff: 450, envMod: 0.6, decay: 0.24, accentAmount: 0.5, tuning: 0 };
  let threshold = 0.35; // 0..1, maps to filter Q

  function applyThreshold() {
    const q = 0.7 + threshold * 24; // clean up to near-self-oscillating
    filter.Q.setTargetAtTime(q, ctx.currentTime, 0.01);
    // As resonance climbs the filter's peak gain grows sharply - tame the
    // output a little so "screaming" doesn't also mean "clipping".
    compensate.gain.setTargetAtTime(1 / (1 + threshold * 1.6), ctx.currentTime, 0.02);
  }
  applyThreshold();

  function trigger(time, { note, octave, accent, glideIn }) {
    const freq = noteToFreq(note, octave, 45) * Math.pow(2, params.tuning / 12);
    osc.frequency.cancelScheduledValues(time);
    if (glideIn) {
      osc.frequency.setValueAtTime(osc.frequency.value, time);
      osc.frequency.linearRampToValueAtTime(freq, time + PORTAMENTO_TIME);
    } else {
      osc.frequency.setValueAtTime(freq, time);
    }

    const decayTime = Math.max(0.05, params.decay);
    const envAmount = params.envMod * (accent ? 1 + params.accentAmount : 1) * (4000 + threshold * 3000);
    const peakCutoff = Math.min(9500, params.cutoff + envAmount);

    filter.frequency.cancelScheduledValues(time);
    filter.frequency.setValueAtTime(Math.max(60, params.cutoff), time);
    filter.frequency.linearRampToValueAtTime(peakCutoff, time + 0.01);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, params.cutoff * 0.85), time + decayTime);

    ampEnv.gain.cancelScheduledValues(time);
    if (glideIn) {
      const holdLevel = Math.max(ampEnv.gain.value, accent ? 0.9 : 0.65);
      ampEnv.gain.setValueAtTime(holdLevel, time);
      ampEnv.gain.exponentialRampToValueAtTime(0.0001, time + decayTime * 1.4);
    } else {
      const peakGain = accent ? 0.95 : 0.7;
      ampEnv.gain.setValueAtTime(0.0001, time);
      ampEnv.gain.exponentialRampToValueAtTime(peakGain, time + 0.004);
      ampEnv.gain.exponentialRampToValueAtTime(0.0001, time + decayTime * 1.4);
    }
  }

  function dispose() {
    try {
      osc.stop();
      osc.disconnect();
      filter.disconnect();
      compensate.disconnect();
      ampEnv.disconnect();
    } catch (e) {}
  }

  ampEnv.connect(dest);

  return {
    trigger,
    dispose,
    setThreshold(v) {
      threshold = Math.max(0, Math.min(1, v));
      applyThreshold();
    },
    getThreshold: () => threshold,
  };
}

export function create(ctx) {
  const output = createEffectsChain(ctx);
  const engine = createChokeEngine(ctx, output.input);
  let thresholdControl = null;

  const seq = createMonoStepSequencer({
    trigger: engine.trigger,
    extraControls: (row) => {
      thresholdControl = buildParamRow(row, {
        label: "Threshold",
        min: 0,
        max: 100,
        value: Math.round(engine.getThreshold() * 100),
        format: (v) => v + "%",
        onInput: (v) => engine.setThreshold(v / 100),
      });
    },
    defaultPattern: () => {
      const s = Array.from({ length: 16 }, () => ({ active: false, note: 0, octave: 0, accent: false, slide: false }));
      s[0] = { active: true, note: 0, octave: 0, accent: true, slide: false };
      s[2] = { active: true, note: 0, octave: 0, accent: false, slide: true };
      s[3] = { active: true, note: 0, octave: 0, accent: false, slide: false };
      s[6] = { active: true, note: 3, octave: 0, accent: false, slide: false };
      s[8] = { active: true, note: 0, octave: 0, accent: true, slide: false };
      s[11] = { active: true, note: 7, octave: 0, accent: false, slide: false };
      s[12] = { active: true, note: 0, octave: 1, accent: true, slide: true };
      s[14] = { active: true, note: 0, octave: 0, accent: false, slide: false };
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
    serialize() {
      return { ...seq.serialize(), threshold: engine.getThreshold() };
    },
    restore(state) {
      if (!state) return;
      seq.restore(state);
      if (typeof state.threshold === "number") {
        engine.setThreshold(state.threshold);
        thresholdControl?.setValue(Math.round(state.threshold * 100));
      }
    },
    dispose() {
      this.stop();
      this.unmount();
      engine.dispose();
      try { output.output.disconnect(); } catch (e) {}
    },
  };
}
