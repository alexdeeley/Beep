import { createEffectsChain } from "../../core/effects.js";
import { makeNoiseBuffer } from "../../core/dsp-utils.js";

export const manifest = {
  id: "piano",
  name: "Piano",
  shortName: "Piano",
  description: "A synthesized polyphonic piano - a real black-and-white keyboard with a sustain pedal, no samples.",
  category: "Keys",
  tags: ["piano", "keys", "polyphonic", "played", "sustain"],
  version: "1.0.0",
  icon: "\u{1F3B9}",
  supportsSequencer: false,
  supportsLivePlay: true,
  supportsEffects: true,
  supportsTempo: false,
  polyphony: 16,
  defaultWidth: 420,
  defaultHeight: 340,
  minimumWidth: 300,
  minimumHeight: 260,
};

const WHITE_KEY_WIDTH = 36;
const BLACK_KEY_WIDTH = 22;
const OCTAVES = 2; // C3..B4, visible range; Octave +/- shifts this window
const SEMITONE_IS_BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];
const NOTE_LETTERS = ["C", "", "D", "", "E", "F", "", "G", "", "A", "", "B"];
const MAX_VOICES = 16;

function semitoneToFreq(semitoneFromC3) {
  // C3 = MIDI 48, a comfortable low anchor for a compact on-screen keyboard.
  const midi = 48 + semitoneFromC3;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Two-oscillator voice (mellow triangle fundamental + a quieter sine an
// octave up for shimmer) plus a short filtered-noise "hammer" transient at
// onset - a real piano's tone comes as much from that strike transient as
// from the sustained partials. The amplitude envelope decays naturally
// whether or not the key is held (a struck string isn't infinitely
// sustained just because a finger stays down) - what the sustain pedal
// actually controls is whether *releasing the key* cuts that decay short.
function createPianoEngine(ctx, dest) {
  const hammerNoise = makeNoiseBuffer(ctx, 0.03);
  const bus = ctx.createGain();
  bus.gain.value = 0.5;
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 6000;
  bus.connect(tone);
  tone.connect(dest);

  let nextVoiceId = 1;
  const voices = new Map();

  function stealOldestIfNeeded() {
    if (voices.size < MAX_VOICES) return;
    let oldestId = null;
    let oldestTime = Infinity;
    for (const [id, v] of voices) {
      if (v.startedAt < oldestTime) {
        oldestTime = v.startedAt;
        oldestId = id;
      }
    }
    if (oldestId !== null) hardStop(oldestId);
  }

  function hardStop(voiceId) {
    const v = voices.get(voiceId);
    if (!v) return;
    const t = ctx.currentTime;
    v.amp.gain.cancelScheduledValues(t);
    v.amp.gain.setTargetAtTime(0, t, 0.03);
    v.osc1.stop(t + 0.15);
    v.osc2.stop(t + 0.15);
    voices.delete(voiceId);
  }

  function noteOn(semitone, velocity = 1) {
    stealOldestIfNeeded();
    const t = ctx.currentTime;
    const freq = semitoneToFreq(semitone);

    const osc1 = ctx.createOscillator();
    osc1.type = "triangle";
    osc1.frequency.value = freq;
    const osc2 = ctx.createOscillator();
    osc2.type = "sine";
    osc2.frequency.value = freq * 2.003; // very slight detune for shimmer
    const osc2Gain = ctx.createGain();
    osc2Gain.gain.value = 0.18;

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(velocity, t + 0.004);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.08, velocity * 0.3), t + 0.35);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + 3.5);

    osc1.connect(amp);
    osc2.connect(osc2Gain);
    osc2Gain.connect(amp);
    amp.connect(bus);
    osc1.start(t);
    osc2.start(t);
    osc1.stop(t + 4);
    osc2.stop(t + 4);

    const src = ctx.createBufferSource();
    src.buffer = hammerNoise;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1200;
    const hammerGain = ctx.createGain();
    hammerGain.gain.setValueAtTime(velocity * 0.25, t);
    hammerGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.025);
    src.connect(hp);
    hp.connect(hammerGain);
    hammerGain.connect(bus);
    src.start(t);
    src.stop(t + 0.04);

    const voiceId = nextVoiceId++;
    voices.set(voiceId, { osc1, osc2, amp, semitone, startedAt: t, sustainedByPedal: false, released: false });
    return voiceId;
  }

  function noteOff(voiceId, sustainActive) {
    const v = voices.get(voiceId);
    if (!v) return;
    v.released = true;
    if (sustainActive) {
      v.sustainedByPedal = true;
      return; // let the natural decay continue uninterrupted
    }
    const t = ctx.currentTime;
    v.amp.gain.cancelScheduledValues(t);
    v.amp.gain.setValueAtTime(v.amp.gain.value, t);
    v.amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    v.osc1.stop(t + 0.18);
    v.osc2.stop(t + 0.18);
    voices.delete(voiceId);
  }

  function releaseSustainedVoices() {
    const t = ctx.currentTime;
    for (const [id, v] of [...voices]) {
      if (!v.sustainedByPedal) continue;
      v.amp.gain.cancelScheduledValues(t);
      v.amp.gain.setValueAtTime(v.amp.gain.value, t);
      v.amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      v.osc1.stop(t + 0.18);
      v.osc2.stop(t + 0.18);
      voices.delete(id);
    }
  }

  function dispose() {
    for (const id of [...voices.keys()]) hardStop(id);
    try {
      bus.disconnect();
      tone.disconnect();
    } catch (e) {}
  }

  return { noteOn, noteOff, releaseSustainedVoices, dispose };
}

function buildKeyboardModel(octaves) {
  const keys = [];
  let whiteIndex = 0;
  for (let o = 0; o < octaves; o++) {
    for (let s = 0; s < 12; s++) {
      const semitone = o * 12 + s;
      const isBlack = SEMITONE_IS_BLACK[s];
      if (isBlack) {
        keys.push({ semitone, isBlack: true, left: whiteIndex * WHITE_KEY_WIDTH - BLACK_KEY_WIDTH / 2 });
      } else {
        keys.push({ semitone, isBlack: false, whiteIndex, label: NOTE_LETTERS[s] === "C" ? "C" + (o + 3) : "" });
        whiteIndex++;
      }
    }
  }
  return { keys, whiteCount: whiteIndex };
}

export function create(ctx) {
  const output = createEffectsChain(ctx);
  const engine = createPianoEngine(ctx, output.input);
  let container = null;
  let sustain = false;
  let octaveShift = 0;
  const pointerVoices = new Map(); // pointerId -> { voiceId, keyEl }

  function buildUI() {
    container.innerHTML = "";
    container.classList.add("im-piano");

    const controls = document.createElement("div");
    controls.className = "im-controls-row";

    const sustainBtn = document.createElement("button");
    sustainBtn.type = "button";
    sustainBtn.className = "im-btn im-piano-sustain" + (sustain ? " im-btn-on" : "");
    sustainBtn.textContent = "Sustain";
    sustainBtn.setAttribute("aria-pressed", String(sustain));
    sustainBtn.addEventListener("click", () => {
      sustain = !sustain;
      sustainBtn.classList.toggle("im-btn-on", sustain);
      sustainBtn.setAttribute("aria-pressed", String(sustain));
      if (!sustain) engine.releaseSustainedVoices();
    });
    controls.appendChild(sustainBtn);

    const octDown = document.createElement("button");
    octDown.type = "button";
    octDown.className = "im-btn";
    octDown.textContent = "‹ Oct";
    octDown.addEventListener("click", () => { octaveShift = Math.max(-2, octaveShift - 1); octLabel.textContent = octaveLabel(); });
    const octLabel = document.createElement("span");
    octLabel.className = "im-label";
    octLabel.textContent = octaveLabel();
    const octUp = document.createElement("button");
    octUp.type = "button";
    octUp.className = "im-btn";
    octUp.textContent = "Oct ›";
    octUp.addEventListener("click", () => { octaveShift = Math.min(3, octaveShift + 1); octLabel.textContent = octaveLabel(); });
    controls.appendChild(octDown);
    controls.appendChild(octLabel);
    controls.appendChild(octUp);

    container.appendChild(controls);

    const keysWrap = document.createElement("div");
    keysWrap.className = "im-piano-keys";
    const { keys, whiteCount } = buildKeyboardModel(OCTAVES);
    keysWrap.style.width = whiteCount * WHITE_KEY_WIDTH + "px";

    for (const key of keys) {
      const el = document.createElement("div");
      el.dataset.semitone = String(key.semitone);
      if (key.isBlack) {
        el.className = "im-piano-key im-piano-key-black";
        el.style.left = key.left + "px";
      } else {
        el.className = "im-piano-key im-piano-key-white";
        if (key.label) {
          const label = document.createElement("span");
          label.className = "im-piano-key-label";
          label.textContent = key.label;
          el.appendChild(label);
        }
      }
      attachKeyPointerHandlers(el, key.semitone);
      keysWrap.appendChild(el);
    }
    container.appendChild(keysWrap);
  }

  function octaveLabel() {
    return "Octave " + (octaveShift >= 0 ? "+" + octaveShift : octaveShift);
  }

  function attachKeyPointerHandlers(el, semitone) {
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      try {
        el.setPointerCapture(e.pointerId);
      } catch (err) {}
      el.classList.add("im-piano-key-active");
      const voiceId = engine.noteOn(semitone + octaveShift * 12);
      pointerVoices.set(e.pointerId, { voiceId, el });
    });
    const release = (e) => {
      const entry = pointerVoices.get(e.pointerId);
      if (!entry) return;
      entry.el.classList.remove("im-piano-key-active");
      engine.noteOff(entry.voiceId, sustain);
      pointerVoices.delete(e.pointerId);
    };
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
    el.addEventListener("pointerleave", (e) => {
      // Leaving the key while still pressed (a real sliding-finger risk on
      // a compact on-screen keyboard) should still release that note -
      // pointer capture keeps the up/cancel events routed here regardless.
      if (pointerVoices.has(e.pointerId) && e.buttons === 0) release(e);
    });
  }

  return {
    manifest,
    mount(el) {
      container = el;
      buildUI();
    },
    unmount() {
      if (container) container.innerHTML = "";
      container = null;
      pointerVoices.clear();
    },
    start() {},
    stop() {
      engine.releaseSustainedVoices();
    },
    getAudioOutput() { return output.output; },
    setEffectAmount(kind, amount) { if (output[kind]) output[kind].setAmount(amount); },
    serialize() {
      return { sustain, octaveShift };
    },
    restore(state) {
      if (!state) return;
      if (typeof state.sustain === "boolean") sustain = state.sustain;
      if (typeof state.octaveShift === "number") octaveShift = state.octaveShift;
      if (container) buildUI();
    },
    dispose() {
      this.stop();
      this.unmount();
      engine.dispose();
      try { output.output.disconnect(); } catch (e) {}
    },
  };
}
