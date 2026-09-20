import { createEffectsChain } from "../../core/effects.js";
import { buildParamRow } from "../../core/param-controls.js";
import { createKeyboardUI } from "../../core/keyboard-ui.js";

export const manifest = {
  id: "accordion",
  name: "Accordion",
  shortName: "Accordion",
  description: "A reed-organ keyboard with three detuned reeds per note for that wobbly musette chorus, plus a live Bellows control for breath and dynamics.",
  category: "Keys",
  tags: ["accordion", "keys", "reed", "musette", "bellows", "polyphonic"],
  version: "1.0.0",
  icon: "\u{1FA97}",
  supportsSequencer: false,
  supportsLivePlay: true,
  supportsEffects: true,
  supportsTempo: false,
  polyphony: 8,
  defaultWidth: 420,
  defaultHeight: 340,
  minimumWidth: 300,
  minimumHeight: 260,
};

const OCTAVES = 2; // C3..B4, same window as the piano keyboard
const MAX_VOICES = 8;

function semitoneToFreq(semitoneFromC3) {
  const midi = 48 + semitoneFromC3;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// A real accordion sustains for as long as a key is held and as loud as
// the bellows push it - there's no natural decay like a struck string.
// Each voice is three sawtooth reeds (one true, two detuned +/- by the
// Musette amount) so their slowly drifting phase relationship produces
// the instrument's signature warbling chorus on its own, with no LFO
// needed. Bellows is a live breath control: dragging it while notes are
// held changes their volume in real time, exactly like squeezing harder
// or softer mid-note.
function createAccordionEngine(ctx, dest) {
  const bus = ctx.createGain();
  bus.gain.value = 1;
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 3200;
  bus.connect(tone);
  tone.connect(dest);

  let bellows = 0.6;
  let musette = 0.4;
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
    v.voiceGain.gain.cancelScheduledValues(t);
    v.voiceGain.gain.setTargetAtTime(0, t, 0.03);
    v.oscs.forEach((o) => { try { o.stop(t + 0.12); } catch (e) {} });
    voices.delete(voiceId);
  }

  function noteOn(semitone) {
    stealOldestIfNeeded();
    const t = ctx.currentTime;
    const freq = semitoneToFreq(semitone);
    const spreadCents = musette * 14;

    const voiceGain = ctx.createGain();
    voiceGain.gain.setValueAtTime(0.0001, t);
    voiceGain.gain.exponentialRampToValueAtTime(Math.max(0.05, bellows), t + 0.06);
    voiceGain.connect(bus);

    const oscs = [0, spreadCents, -spreadCents].map((cents, i) => {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = freq;
      osc.detune.value = cents;
      const g = ctx.createGain();
      g.gain.value = i === 0 ? 0.55 : 0.24;
      osc.connect(g);
      g.connect(voiceGain);
      osc.start(t);
      return osc;
    });

    const voiceId = nextVoiceId++;
    voices.set(voiceId, { oscs, voiceGain, semitone, startedAt: t });
    return voiceId;
  }

  function noteOff(voiceId) {
    const v = voices.get(voiceId);
    if (!v) return;
    const t = ctx.currentTime;
    v.voiceGain.gain.cancelScheduledValues(t);
    v.voiceGain.gain.setValueAtTime(v.voiceGain.gain.value, t);
    v.voiceGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    v.oscs.forEach((o) => { try { o.stop(t + 0.15); } catch (e) {} });
    voices.delete(voiceId);
  }

  function setBellows(v) {
    bellows = v;
    const t = ctx.currentTime;
    for (const voice of voices.values()) {
      voice.voiceGain.gain.setTargetAtTime(Math.max(0.001, bellows), t, 0.05);
    }
  }

  function setMusette(v) {
    musette = v;
    const cents = musette * 14;
    const t = ctx.currentTime;
    for (const voice of voices.values()) {
      voice.oscs[1].detune.setTargetAtTime(cents, t, 0.05);
      voice.oscs[2].detune.setTargetAtTime(-cents, t, 0.05);
    }
  }

  function dispose() {
    for (const id of [...voices.keys()]) hardStop(id);
    try {
      bus.disconnect();
      tone.disconnect();
    } catch (e) {}
  }

  return {
    noteOn,
    noteOff,
    dispose,
    setBellows,
    setMusette,
    getBellows: () => bellows,
    getMusette: () => musette,
  };
}

export function create(ctx) {
  const output = createEffectsChain(ctx);
  const engine = createAccordionEngine(ctx, output.input);
  let container = null;
  let octaveShift = 0;
  let keyboard = null;

  function octaveLabel() {
    return "Octave " + (octaveShift >= 0 ? "+" + octaveShift : octaveShift);
  }

  function buildUI() {
    container.innerHTML = "";
    container.classList.add("im-accordion");

    const params = document.createElement("div");
    params.className = "im-controls-row";
    params.style.flexDirection = "column";
    params.style.alignItems = "stretch";

    buildParamRow(params, {
      label: "Bellows",
      min: 0,
      max: 100,
      value: Math.round(engine.getBellows() * 100),
      format: (v) => v + "%",
      onInput: (v) => engine.setBellows(v / 100),
    });
    buildParamRow(params, {
      label: "Musette",
      min: 0,
      max: 100,
      value: Math.round(engine.getMusette() * 100),
      format: (v) => v + "%",
      onInput: (v) => engine.setMusette(v / 100),
    });
    container.appendChild(params);

    const octaveRow = document.createElement("div");
    octaveRow.className = "im-controls-row";
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
    octaveRow.appendChild(octDown);
    octaveRow.appendChild(octLabel);
    octaveRow.appendChild(octUp);
    container.appendChild(octaveRow);

    keyboard = createKeyboardUI({
      octaves: OCTAVES,
      onNoteOn: (semitone) => engine.noteOn(semitone + octaveShift * 12),
      onNoteOff: (voiceId) => engine.noteOff(voiceId),
    });
    container.appendChild(keyboard.el);
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
      keyboard?.dispose();
      keyboard = null;
    },
    start() {},
    stop() {},
    getAudioOutput() { return output.output; },
    setEffectAmount(kind, amount) { if (output[kind]) output[kind].setAmount(amount); },
    serialize() {
      return { bellows: engine.getBellows(), musette: engine.getMusette(), octaveShift };
    },
    restore(state) {
      if (!state) return;
      if (typeof state.bellows === "number") engine.setBellows(state.bellows);
      if (typeof state.musette === "number") engine.setMusette(state.musette);
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
