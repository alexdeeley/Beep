import { defaultVoiceParams } from "./voices.js";

// Full sound-world presets - synthesis parameters only, no sample
// packs. Each preset only needs to specify the params that make it
// distinctive; getPresetVoiceParams() fills in the rest from defaults
// so applying a preset always yields a fully-specified, reproducible
// sound rather than inheriting leftovers from whatever was loaded before.
export const PRESETS = {
  analog: {
    label: "Analog",
    voices: {
      kick: { pitch: 58, pitchEnvAmount: 35, decay: 260, punch: 60, click: 20, drive: 12, tone: 45 },
      snare: { pitch: 190, body: 60, noise: 45, decay: 180, snap: 40, filter: 3200, drive: 10 },
      tom: { pitch: 110, pitchBend: 25, decay: 300, fmAmount: 5, drive: 8, tone: 40 },
      clap: { spread: 30, decay: 200, noise: 55, metal: 10, filter: 1800 },
      closedHat: { pitch: 320, metal: 35, noise: 30, decay: 60, filter: 7000 },
      openHat: { pitch: 320, metal: 35, spread: 30, decay: 380, wash: 30, filter: 7500 },
    },
  },
  "808ish": {
    label: "808-ish",
    voices: {
      kick: { waveform: "sine", pitch: 46, pitchEnvAmount: 55, pitchEnvTime: 90, decay: 900, punch: 40, click: 10, drive: 30, tone: 25 },
      snare: { pitch: 160, body: 40, noise: 60, decay: 220, snap: 55, filter: 2600, drive: 15 },
      tom: { pitch: 90, pitchBend: 40, decay: 500, fmAmount: 0, tone: 30 },
      clap: { spread: 45, decay: 260, noise: 60, metal: 0, filter: 1500 },
      closedHat: { pitch: 380, metal: 20, noise: 20, decay: 45, filter: 6500 },
      openHat: { pitch: 380, metal: 20, spread: 40, decay: 420, wash: 35, filter: 7000 },
    },
  },
  "909ish": {
    label: "909-ish",
    voices: {
      kick: { waveform: "sine", pitch: 62, pitchEnvAmount: 45, pitchEnvTime: 40, decay: 240, punch: 75, click: 45, drive: 20, tone: 55 },
      snare: { pitch: 210, body: 55, noise: 65, decay: 170, snap: 60, filter: 3800, resonance: 3, drive: 18 },
      tom: { pitch: 130, pitchBend: 30, decay: 260, fmAmount: 8, tone: 50 },
      clap: { spread: 25, decay: 190, noise: 70, metal: 15, filter: 2000 },
      closedHat: { pitch: 420, metal: 45, noise: 25, decay: 55, filter: 8000 },
      openHat: { pitch: 420, metal: 45, spread: 30, decay: 350, wash: 25, filter: 8500 },
    },
  },
  dust: {
    label: "Dust",
    voices: {
      kick: { pitch: 50, pitchEnvAmount: 20, decay: 200, punch: 30, click: 15, drive: 35, tone: 20 },
      snare: { pitch: 140, body: 25, noise: 70, decay: 140, snap: 20, filter: 2200, drive: 25, tone: 25 },
      tom: { pitch: 85, pitchBend: 15, decay: 220, fmAmount: 3, drive: 20, tone: 20 },
      clap: { spread: 55, decay: 160, noise: 65, metal: 5, filter: 1400 },
      closedHat: { pitch: 260, metal: 15, noise: 55, decay: 40, filter: 5000 },
      openHat: { pitch: 260, metal: 15, spread: 45, decay: 260, wash: 55, filter: 5200 },
    },
  },
  wood: {
    label: "Wood",
    voices: {
      kick: { waveform: "triangle", pitch: 95, pitchEnvAmount: 15, decay: 130, punch: 65, click: 55, drive: 5, tone: 60 },
      snare: { pitch: 240, body: 70, noise: 20, decay: 90, snap: 35, filter: 3000, drive: 5, tone: 55 },
      tom: { waveform: "triangle", pitch: 160, pitchBend: 20, decay: 180, fmAmount: 0, tone: 55 },
      clap: { spread: 20, decay: 100, noise: 30, metal: 0, filter: 2400 },
      closedHat: { pitch: 480, metal: 10, noise: 15, decay: 35, filter: 6000 },
      openHat: { pitch: 480, metal: 10, spread: 20, decay: 140, wash: 15, filter: 6200 },
    },
  },
  metal: {
    label: "Metal",
    voices: {
      kick: { pitch: 70, pitchEnvAmount: 30, decay: 200, punch: 50, click: 60, drive: 45, tone: 65 },
      snare: { pitch: 260, body: 40, noise: 40, decay: 160, snap: 70, filter: 4500, resonance: 6, drive: 40 },
      tom: { pitch: 150, pitchBend: 30, decay: 280, fmAmount: 55, fmRatio: 2.8, drive: 30, tone: 65 },
      clap: { spread: 20, decay: 220, noise: 35, metal: 75, filter: 3000 },
      closedHat: { pitch: 520, metal: 80, noise: 20, decay: 50, filter: 9000, resonance: 5 },
      openHat: { pitch: 520, metal: 80, spread: 40, decay: 400, wash: 20, filter: 9500, resonance: 5 },
    },
  },
  digital: {
    label: "Digital",
    voices: {
      kick: { waveform: "square", pitch: 55, pitchEnvAmount: 60, pitchEnvTime: 15, decay: 150, punch: 90, click: 10, drive: 5, tone: 70 },
      snare: { pitch: 300, body: 30, noise: 55, decay: 110, snap: 65, filter: 5200, drive: 8 },
      tom: { waveform: "square", pitch: 140, pitchBend: 60, decay: 150, fmAmount: 35, fmRatio: 2, tone: 70 },
      clap: { spread: 12, decay: 130, noise: 50, metal: 25, filter: 3500 },
      closedHat: { pitch: 600, metal: 55, noise: 15, decay: 30, filter: 10000 },
      openHat: { pitch: 600, metal: 55, spread: 15, decay: 220, wash: 15, filter: 10500 },
    },
  },
  industrial: {
    label: "Industrial",
    voices: {
      kick: { pitch: 48, pitchEnvAmount: 25, decay: 400, punch: 70, click: 70, drive: 65, tone: 35 },
      snare: { pitch: 170, body: 35, noise: 75, decay: 260, snap: 60, filter: 3200, drive: 55, tone: 40 },
      tom: { pitch: 100, pitchBend: 20, decay: 450, fmAmount: 40, fmRatio: 3.5, drive: 45, tone: 35 },
      clap: { spread: 60, decay: 300, noise: 80, metal: 45, filter: 2200, drive: 30 },
      closedHat: { pitch: 300, metal: 60, noise: 60, decay: 70, filter: 6500, drive: 20 },
      openHat: { pitch: 300, metal: 60, spread: 50, decay: 500, wash: 60, filter: 7000, drive: 20 },
    },
  },
  soft: {
    label: "Soft",
    voices: {
      kick: { waveform: "sine", pitch: 52, pitchEnvAmount: 15, decay: 300, punch: 25, click: 5, drive: 0, tone: 30 },
      snare: { pitch: 160, body: 45, noise: 25, decay: 200, snap: 10, filter: 2400, drive: 0, tone: 30 },
      tom: { pitch: 100, pitchBend: 10, decay: 320, fmAmount: 0, drive: 0, tone: 30 },
      clap: { spread: 40, decay: 220, noise: 25, metal: 0, filter: 1600 },
      closedHat: { pitch: 300, metal: 15, noise: 20, decay: 40, filter: 5000 },
      openHat: { pitch: 300, metal: 15, spread: 25, decay: 300, wash: 15, filter: 5200 },
    },
  },
  sub: {
    label: "Sub",
    voices: {
      kick: { waveform: "sine", pitch: 38, pitchEnvAmount: 15, pitchEnvTime: 60, decay: 700, punch: 30, click: 0, drive: 15, tone: 12 },
      snare: { pitch: 120, body: 60, noise: 20, decay: 240, snap: 15, filter: 1800, drive: 10, tone: 20 },
      tom: { pitch: 65, pitchBend: 10, decay: 500, fmAmount: 0, tone: 15 },
      clap: { spread: 35, decay: 220, noise: 30, metal: 0, filter: 1200 },
      closedHat: { pitch: 220, metal: 10, noise: 25, decay: 45, filter: 4000 },
      openHat: { pitch: 220, metal: 10, spread: 25, decay: 300, wash: 20, filter: 4200 },
    },
  },
  alien: {
    label: "Alien",
    voices: {
      kick: { pitch: 65, pitchEnvAmount: 80, pitchEnvTime: 180, decay: 500, punch: 55, click: 40, drive: 25, tone: 55 },
      snare: { pitch: 320, body: 20, noise: 45, decay: 300, snap: 45, filter: 4800, resonance: 8, drive: 20 },
      tom: { pitch: 180, pitchBend: 90, decay: 400, fmAmount: 75, fmRatio: 3.7, drive: 15, tone: 60 },
      clap: { spread: 70, decay: 350, noise: 40, metal: 60, filter: 2800 },
      closedHat: { pitch: 700, metal: 70, noise: 25, decay: 60, filter: 9500, resonance: 8 },
      openHat: { pitch: 700, metal: 70, spread: 60, decay: 550, wash: 40, filter: 10000, resonance: 8 },
    },
  },
  tuned: {
    label: "Tuned",
    voices: {
      kick: { waveform: "sine", pitch: 65, pitchEnvAmount: 10, decay: 400, punch: 30, click: 10, drive: 5, tone: 40 },
      snare: { pitch: 220, body: 75, noise: 15, decay: 260, snap: 15, filter: 3000, drive: 5, tone: 45 },
      tom: { waveform: "sine", pitch: 165, pitchBend: 5, decay: 500, fmAmount: 0, tone: 45 },
      clap: { spread: 15, decay: 200, noise: 20, metal: 20, filter: 2600 },
      closedHat: { pitch: 440, metal: 30, noise: 10, decay: 50, filter: 7000 },
      openHat: { pitch: 440, metal: 30, spread: 20, decay: 350, wash: 15, filter: 7200 },
    },
  },
  glass: {
    label: "Glass",
    voices: {
      kick: { waveform: "sine", pitch: 90, pitchEnvAmount: 20, decay: 350, punch: 20, click: 30, drive: 0, tone: 65 },
      snare: { pitch: 380, body: 50, noise: 30, decay: 280, snap: 40, filter: 6000, resonance: 6, drive: 0, tone: 65 },
      tom: { waveform: "sine", pitch: 260, pitchBend: 15, decay: 450, fmAmount: 20, fmRatio: 4, tone: 70 },
      clap: { spread: 25, decay: 260, noise: 25, metal: 65, filter: 4000 },
      closedHat: { pitch: 900, metal: 40, noise: 10, decay: 65, filter: 11000, resonance: 4 },
      openHat: { pitch: 900, metal: 40, spread: 30, decay: 600, wash: 20, filter: 12000, resonance: 4 },
    },
  },
  broken: {
    label: "Broken",
    voices: {
      kick: { pitch: 42, pitchEnvAmount: 95, pitchEnvTime: 250, decay: 180, punch: 85, click: 80, drive: 80, tone: 25 },
      snare: { pitch: 150, body: 15, noise: 90, decay: 90, snap: 90, filter: 2600, resonance: 10, drive: 70, tone: 30 },
      tom: { pitch: 200, pitchBend: -70, decay: 120, fmAmount: 90, fmRatio: 0.6, drive: 60, tone: 30 },
      clap: { spread: 5, decay: 80, noise: 90, metal: 80, filter: 1800, drive: 50 },
      closedHat: { pitch: 250, metal: 90, noise: 70, decay: 25, filter: 5500, resonance: 12, drive: 35 },
      openHat: { pitch: 250, metal: 90, spread: 80, decay: 180, wash: 70, filter: 6000, resonance: 12, drive: 35 },
    },
  },
};

export const PRESET_KEYS = Object.keys(PRESETS);

export function getPresetVoiceParams(presetKey, voiceId) {
  const preset = PRESETS[presetKey];
  const overrides = preset?.voices?.[voiceId] || {};
  return { ...defaultVoiceParams(voiceId), ...overrides };
}

export function applyPresetToVoices(voices, presetKey) {
  for (const [voiceId, engine] of Object.entries(voices)) {
    engine.setParams(getPresetVoiceParams(presetKey, voiceId));
  }
}

export function applyPresetToVoice(voices, presetKey, voiceId) {
  voices[voiceId]?.setParams(getPresetVoiceParams(presetKey, voiceId));
}
