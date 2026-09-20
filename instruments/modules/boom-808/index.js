import { createEffectsChain } from "../../core/effects.js";
import { createMonoStepSequencer, noteToFreq } from "../../core/mono-step-sequencer.js";
import { buildParamRow } from "../../core/param-controls.js";
import { makeDistortionCurve } from "../../core/dsp-utils.js";

export const manifest = {
  id: "boom-808",
  name: "Booming 808",
  shortName: "Boom 808",
  description: "A trap-style 808 bassline, not a drum hit - a long, saturated sub that glides between notes with an adjustable Drive and Decay for how loud and how long it booms.",
  category: "Bass",
  tags: ["bass", "808", "sub", "trap", "boom", "drive", "monophonic"],
  version: "1.0.0",
  icon: "\u{1F50A}",
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

// Unlike Depth (a short percussive sub impact), a real trap 808 is played
// as a bassline that rings through most of the bar and glides smoothly
// between notes - the "boom" comes from heavy saturation on a clean sine,
// not from a pitch-drop transient, so the pitch envelope here is just a
// small click on the attack rather than the main event.
function createBoom808Engine(ctx, dest) {
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = 55;

  const shaper = ctx.createWaveShaper();
  shaper.oversample = "4x";

  const amp = ctx.createGain();
  amp.gain.value = 0;

  osc.connect(shaper);
  shaper.connect(amp);
  osc.start();

  let params = { drive: 0.55, decay: 1.1 };

  function applyDrive() {
    shaper.curve = makeDistortionCurve(params.drive * 70);
  }
  applyDrive();

  function trigger(time, { note, octave, accent, glideIn }) {
    const freq = noteToFreq(note, octave, 28);
    osc.frequency.cancelScheduledValues(time);
    if (glideIn) {
      osc.frequency.setValueAtTime(osc.frequency.value, time);
      osc.frequency.exponentialRampToValueAtTime(freq, time + 0.09);
    } else {
      osc.frequency.setValueAtTime(freq * 1.5, time);
      osc.frequency.exponentialRampToValueAtTime(freq, time + 0.02);
    }

    const decayTime = Math.max(0.2, params.decay);
    amp.gain.cancelScheduledValues(time);
    if (!glideIn) {
      amp.gain.setValueAtTime(0.0001, time);
      amp.gain.exponentialRampToValueAtTime(accent ? 1 : 0.8, time + 0.006);
    }
    amp.gain.exponentialRampToValueAtTime(0.0001, time + decayTime);
  }

  function dispose() {
    try {
      osc.stop();
      osc.disconnect();
      shaper.disconnect();
      amp.disconnect();
    } catch (e) {}
  }

  amp.connect(dest);

  return {
    trigger,
    dispose,
    setDrive(v) { params.drive = v; applyDrive(); },
    setDecay(v) { params.decay = v; },
    getDrive: () => params.drive,
    getDecay: () => params.decay,
  };
}

export function create(ctx) {
  const output = createEffectsChain(ctx);
  const engine = createBoom808Engine(ctx, output.input);
  let driveControl = null;
  let decayControl = null;

  const seq = createMonoStepSequencer({
    trigger: engine.trigger,
    extraControls: (row) => {
      driveControl = buildParamRow(row, {
        label: "Drive",
        min: 0,
        max: 100,
        value: Math.round(engine.getDrive() * 100),
        format: (v) => v + "%",
        onInput: (v) => engine.setDrive(v / 100),
      });
      decayControl = buildParamRow(row, {
        label: "Decay",
        min: 20,
        max: 250,
        value: Math.round(engine.getDecay() * 100),
        format: (v) => (v / 100).toFixed(1) + "s",
        onInput: (v) => engine.setDecay(v / 100),
      });
    },
    defaultPattern: () => {
      const s = Array.from({ length: 16 }, () => ({ active: false, note: 0, octave: 0, accent: false, slide: false }));
      s[0] = { active: true, note: 0, octave: -1, accent: true, slide: false };
      s[4] = { active: true, note: 0, octave: -1, accent: false, slide: true };
      s[7] = { active: true, note: 5, octave: -1, accent: false, slide: false };
      s[10] = { active: true, note: 3, octave: -1, accent: true, slide: true };
      s[14] = { active: true, note: 0, octave: -1, accent: false, slide: false };
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
      return { ...seq.serialize(), drive: engine.getDrive(), decay: engine.getDecay() };
    },
    restore(state) {
      if (!state) return;
      seq.restore(state);
      if (typeof state.drive === "number") {
        engine.setDrive(state.drive);
        driveControl?.setValue(Math.round(state.drive * 100));
      }
      if (typeof state.decay === "number") {
        engine.setDecay(state.decay);
        decayControl?.setValue(Math.round(state.decay * 100));
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
