import { createEffectsChain } from "../../core/effects.js";
import { createDrumSequencer } from "../../core/drum-grid-ui.js";

export const manifest = {
  id: "real-kit",
  name: "Real Kit",
  shortName: "Real Kit",
  description: "An actual acoustic kit, not a synth - kick, snare, hats, clap, and tom sampled from real drums (CC0 recordings, see instruments/assets/real-kit/SOURCE.md).",
  category: "Drums",
  tags: ["drums", "acoustic", "samples", "real", "recorded", "kit"],
  version: "1.0.0",
  icon: "\u{1F4FC}",
  supportsSequencer: true,
  supportsLivePlay: true,
  supportsEffects: true,
  supportsTempo: true,
  polyphony: 6,
  defaultWidth: 380,
  defaultHeight: 440,
  minimumWidth: 260,
  minimumHeight: 320,
};

const VOICES = [
  { id: "kick", label: "KICK", file: "kick.wav" },
  { id: "snare", label: "SNARE", file: "snare.wav" },
  { id: "closedHat", label: "CH", file: "hat-closed.wav" },
  { id: "openHat", label: "OH", file: "hat-open.wav" },
  { id: "clap", label: "CLAP", file: "clap.wav" },
  { id: "tom", label: "TOM", file: "tom.wav" },
];

function defaultPattern() {
  const p = Object.fromEntries(VOICES.map((v) => [v.id, new Array(16).fill(false)]));
  [0, 8].forEach((i) => (p.kick[i] = true));
  [4, 12].forEach((i) => (p.snare[i] = true));
  for (let i = 0; i < 16; i += 2) p.closedHat[i] = true;
  p.openHat[14] = true;
  p.clap[12] = true;
  p.tom[15] = true;
  return p;
}

// Real recorded one-shots instead of synthesis - each voice's audio is
// fetched and decoded once up front, then every hit gets its own fresh
// AudioBufferSourceNode so overlapping/fast-retriggered hits never cut
// each other off. A closed-hat hit (or a fresh open-hat hit) chokes
// whatever open-hat tail is still ringing, the same physical behavior a
// real hi-hat's two cymbals have when they touch.
function createRealKitEngine(ctx, dest) {
  const buffers = {};
  let activeOpenHat = null;

  const ready = Promise.all(
    VOICES.map(async (v) => {
      const url = new URL(`../../assets/real-kit/${v.file}`, import.meta.url).href;
      const res = await fetch(url);
      const arrayBuffer = await res.arrayBuffer();
      buffers[v.id] = await ctx.decodeAudioData(arrayBuffer);
    })
  );

  function playBuffer(id, time, gainValue) {
    const buffer = buffers[id];
    if (!buffer) return null;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, time);
    src.connect(gain);
    gain.connect(dest);
    src.start(time);
    return { src, gain };
  }

  function chokeOpenHat(time) {
    if (!activeOpenHat) return;
    const { gain } = activeOpenHat;
    gain.gain.cancelScheduledValues(time);
    gain.gain.setValueAtTime(gain.gain.value, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.03);
    activeOpenHat = null;
  }

  return {
    ready,
    kick: (time) => playBuffer("kick", time, 1),
    snare: (time) => playBuffer("snare", time, 0.9),
    closedHat: (time) => { chokeOpenHat(time); playBuffer("closedHat", time, 0.8); },
    openHat: (time) => { chokeOpenHat(time); activeOpenHat = playBuffer("openHat", time, 0.8); },
    clap: (time) => playBuffer("clap", time, 0.85),
    tom: (time) => playBuffer("tom", time, 0.9),
  };
}

export function create(ctx) {
  const output = createEffectsChain(ctx);
  const engine = createRealKitEngine(ctx, output.input);
  const seq = createDrumSequencer({
    voices: VOICES,
    defaultPattern,
    trigger: (id, time) => {
      const t = time ?? ctx.currentTime;
      engine[id]?.(t);
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
