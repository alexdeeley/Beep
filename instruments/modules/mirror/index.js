import { createEffectsChain } from "../../core/effects.js";
import { createMonoStepSequencer, noteToFreq } from "../../core/mono-step-sequencer.js";

export const manifest = {
  id: "mirror",
  name: "Mirror",
  shortName: "Mirror",
  description: "Every note gets a reflected companion around a fixed pitch center - simple melodies become symmetrical harmony.",
  category: "Synths",
  tags: ["synth", "harmony", "reflection", "monophonic"],
  version: "1.0.0",
  icon: "\u{1FA9E}",
  supportsSequencer: true,
  supportsLivePlay: false,
  supportsEffects: true,
  supportsTempo: true,
  polyphony: 2,
  defaultWidth: 360,
  defaultHeight: 420,
  minimumWidth: 260,
  minimumHeight: 300,
};

const CENTER_NOTE = 6; // F# - the axis every note reflects across

function createVoice(ctx) {
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = 220;
  const amp = ctx.createGain();
  amp.gain.value = 0;
  osc.connect(amp);
  osc.start();
  return { osc, amp };
}

// Two persistent voices: the played note, and its reflection across
// CENTER_NOTE (mirrorNote = 2*center - note, wrapped to an octave). Both
// glide or retrigger together, so a "slide" step slides both halves of
// the reflected pair at once.
function createMirrorEngine(ctx, dest) {
  const primary = createVoice(ctx);
  const mirror = createVoice(ctx);
  primary.amp.connect(dest);
  mirror.amp.connect(dest);

  function trigger(time, { note, octave, accent, glideIn }) {
    const freq = noteToFreq(note, octave, 57);
    const mirrorNote = ((CENTER_NOTE * 2 - note) % 12 + 12) % 12;
    const mirrorFreq = noteToFreq(mirrorNote, octave, 57);
    const life = accent ? 0.45 : 0.65;

    [[primary, freq, 0.55], [mirror, mirrorFreq, 0.38]].forEach(([v, f, gainScale]) => {
      v.osc.frequency.cancelScheduledValues(time);
      if (glideIn) {
        v.osc.frequency.setValueAtTime(v.osc.frequency.value, time);
        v.osc.frequency.linearRampToValueAtTime(f, time + 0.09);
      } else {
        v.osc.frequency.setValueAtTime(f, time);
      }
      v.amp.gain.cancelScheduledValues(time);
      if (!glideIn) {
        v.amp.gain.setValueAtTime(0.0001, time);
        v.amp.gain.exponentialRampToValueAtTime((accent ? 1.25 : 1) * gainScale, time + 0.012);
      }
      v.amp.gain.exponentialRampToValueAtTime(0.0001, time + life);
    });
  }

  function dispose() {
    [primary, mirror].forEach((v) => {
      try {
        v.osc.stop();
        v.osc.disconnect();
        v.amp.disconnect();
      } catch (e) {}
    });
  }

  return { trigger, dispose };
}

export function create(ctx) {
  const output = createEffectsChain(ctx);
  const engine = createMirrorEngine(ctx, output.input);
  const seq = createMonoStepSequencer({
    trigger: engine.trigger,
    defaultPattern: () => {
      const s = Array.from({ length: 16 }, () => ({ active: false, note: 0, octave: 0, accent: false, slide: false }));
      s[0] = { active: true, note: 0, octave: 0, accent: true, slide: false };
      s[4] = { active: true, note: 4, octave: 0, accent: false, slide: false };
      s[8] = { active: true, note: 7, octave: 0, accent: false, slide: true };
      s[10] = { active: true, note: 9, octave: 0, accent: false, slide: false };
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
