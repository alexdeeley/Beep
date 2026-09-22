import { rampTo } from "./audio.js";
import { degreeToFreq } from "./tonality.js";

// ---------------------------------------------------------------------
// Shared parameter schema. Every voice declares which of these concepts
// it actually uses (VOICE_PARAM_KEYS) so the edit-panel UI can be
// generated generically instead of six hand-built forms, and so
// setParam() has one place to validate/clamp against.
// ---------------------------------------------------------------------
export const VOICE_IDS = ["kick", "snare", "tom", "clap", "closedHat", "openHat"];

export const VOICE_LABELS = {
  kick: "KICK",
  snare: "SNARE",
  tom: "LOW / TOM",
  clap: "CLAP / PERC",
  closedHat: "CLOSED HAT",
  openHat: "OPEN HAT",
};

// label/min/max/default/step/unit - used both for UI generation and for
// clamping in setParam(). "curve: log" hints the UI to use a log-taper
// slider for frequency-like parameters.
export const PARAM_META = {
  waveform: { label: "Waveform", type: "enum", options: ["sine", "triangle", "sawtooth", "square"], default: "sine" },
  pitch: { label: "Pitch", min: 20, max: 2000, default: 60, unit: "Hz", curve: "log" },
  fineTune: { label: "Fine Tune", min: -50, max: 50, default: 0, unit: "cents" },
  octave: { label: "Octave", min: -2, max: 2, default: 0, step: 1 },
  pitchEnvAmount: { label: "Pitch Drop", min: 0, max: 100, default: 40, unit: "%" },
  pitchEnvTime: { label: "Pitch Env Time", min: 5, max: 400, default: 45, unit: "ms" },
  pitchBend: { label: "Pitch Bend", min: -100, max: 100, default: 0, unit: "%" },
  decay: { label: "Decay", min: 20, max: 2000, default: 220, unit: "ms" },
  sustain: { label: "Sustain", min: 0, max: 100, default: 0, unit: "%" },
  punch: { label: "Punch", min: 0, max: 100, default: 55, unit: "%" },
  click: { label: "Click", min: 0, max: 100, default: 35, unit: "%" },
  snap: { label: "Snap", min: 0, max: 100, default: 50, unit: "%" },
  body: { label: "Body", min: 0, max: 100, default: 55, unit: "%" },
  noise: { label: "Noise", min: 0, max: 100, default: 45, unit: "%" },
  wash: { label: "Wash", min: 0, max: 100, default: 30, unit: "%" },
  spread: { label: "Spread", min: 0, max: 100, default: 35, unit: "%" },
  metal: { label: "Metallicity", min: 0, max: 100, default: 40, unit: "%" },
  filter: { label: "Filter Cutoff", min: 200, max: 16000, default: 6000, unit: "Hz", curve: "log" },
  resonance: { label: "Resonance", min: 0.3, max: 20, default: 2, unit: "Q" },
  drive: { label: "Drive", min: 0, max: 100, default: 15, unit: "%" },
  tone: { label: "Tone", min: 0, max: 100, default: 55, unit: "%" },
  fmAmount: { label: "FM Amount", min: 0, max: 100, default: 20, unit: "%" },
  fmRatio: { label: "FM Ratio", min: 0.5, max: 8, default: 1.5, step: 0.01 },
  ringMod: { label: "Ring Mod", min: 0, max: 100, default: 0, unit: "%" },
  stereoWidth: { label: "Stereo Width", min: 0, max: 100, default: 20, unit: "%" },
  pan: { label: "Pan", min: -100, max: 100, default: 0, unit: "%" },
  volume: { label: "Volume", min: 0, max: 100, default: 85, unit: "%" },
  sendDelay: { label: "Delay Send", min: 0, max: 100, default: 0, unit: "%" },
  sendReverb: { label: "Reverb Send", min: 0, max: 100, default: 15, unit: "%" },
  sendDistortion: { label: "Distortion Send", min: 0, max: 100, default: 0, unit: "%" },
};

export const VOICE_PARAM_KEYS = {
  kick: ["waveform", "pitch", "fineTune", "octave", "pitchEnvAmount", "pitchEnvTime", "decay", "punch", "click", "drive", "tone", "pan", "volume", "sendDelay", "sendReverb", "sendDistortion"],
  snare: ["pitch", "fineTune", "body", "noise", "decay", "snap", "filter", "resonance", "drive", "tone", "pan", "volume", "sendDelay", "sendReverb", "sendDistortion"],
  tom: ["waveform", "pitch", "fineTune", "octave", "pitchBend", "decay", "fmAmount", "fmRatio", "drive", "tone", "pan", "volume", "sendDelay", "sendReverb", "sendDistortion"],
  clap: ["pitch", "spread", "decay", "noise", "metal", "filter", "drive", "tone", "pan", "volume", "sendDelay", "sendReverb", "sendDistortion"],
  closedHat: ["pitch", "metal", "noise", "decay", "filter", "resonance", "drive", "pan", "volume", "sendDelay", "sendReverb", "sendDistortion"],
  openHat: ["pitch", "metal", "spread", "decay", "filter", "resonance", "wash", "drive", "pan", "volume", "sendDelay", "sendReverb", "sendDistortion"],
};

// Every voice also carries a tonality attachment (whether its Pitch
// param is overridden by the global root/scale system) even though not
// every voice has an obviously "musical" pitch - a hat's base frequency
// is still audibly a pitch, and the spec explicitly wants the option
// everywhere ("the six pads can become a strange tuned percussion
// instrument").
export function defaultTonalityState() {
  return { follow: false, degree: 1, octaveOffset: 0 };
}

export function defaultVoiceParams(voiceId) {
  const params = {};
  for (const key of VOICE_PARAM_KEYS[voiceId]) params[key] = PARAM_META[key].default;
  return params;
}

export function clampParam(key, value) {
  const meta = PARAM_META[key];
  if (!meta) return value;
  if (meta.type === "enum") return meta.options.includes(value) ? value : meta.default;
  const n = Number(value);
  if (Number.isNaN(n)) return meta.default;
  return Math.min(meta.max, Math.max(meta.min, n));
}

// ---------------------------------------------------------------------
// DSP helpers
// ---------------------------------------------------------------------
function makeNoiseBuffer(ctx, seconds) {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function makeDriveCurve(amount01) {
  const n = 1024;
  const curve = new Float32Array(n);
  const k = amount01 * 18;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = Math.tanh(x * (1 + k));
  }
  return curve;
}

const HAT_RATIOS = [1, 1.34, 1.82, 2.4, 3.11, 4.02, 5.17];

// ---------------------------------------------------------------------
// Per-voice bus: pan / stereo-width / volume / sends. Every hit's final
// envelope node connects here. The Haas-style width trick keeps a
// single-oscillator mono voice from feeling completely flat without
// needing a stereo synthesis engine.
// ---------------------------------------------------------------------
function createVoiceBus(ctx, sends) {
  const input = ctx.createGain();
  input.gain.value = 1;

  const centerGain = ctx.createGain();
  const wideGain = ctx.createGain();
  const wideDelay = ctx.createDelay(0.05);
  wideDelay.delayTime.value = 0.011;
  const panL = ctx.createStereoPanner();
  panL.pan.value = -1;
  const panR = ctx.createStereoPanner();
  panR.pan.value = 1;
  const panCenter = ctx.createStereoPanner();
  panCenter.pan.value = 0;

  const volume = ctx.createGain();
  volume.gain.value = 0.85;
  const delaySend = ctx.createGain();
  delaySend.gain.value = 0;
  const reverbSend = ctx.createGain();
  reverbSend.gain.value = 0.15;
  const distortionSend = ctx.createGain();
  distortionSend.gain.value = 0;

  input.connect(centerGain);
  centerGain.connect(panCenter);
  panCenter.connect(volume);

  input.connect(wideGain);
  wideGain.connect(panL);
  panL.connect(volume);
  wideGain.connect(wideDelay);
  wideDelay.connect(panR);
  panR.connect(volume);

  volume.connect(sends.dry);
  volume.connect(delaySend);
  delaySend.connect(sends.delayBus);
  volume.connect(reverbSend);
  reverbSend.connect(sends.reverbBus);
  volume.connect(distortionSend);
  distortionSend.connect(sends.distortionBus);

  let basePan = 0;
  let width = 0.2;
  function applyPanWidth() {
    const t = ctx.currentTime;
    centerGain.gain.setTargetAtTime(1 - width, t, 0.02);
    wideGain.gain.setTargetAtTime(width, t, 0.02);
    panCenter.pan.setTargetAtTime(basePan, t, 0.02);
  }
  applyPanWidth();

  return {
    input,
    setPan(p) { basePan = p; applyPanWidth(); },
    setWidth(w) { width = w; applyPanWidth(); },
    setVolume(v) { volume.gain.setTargetAtTime(v, ctx.currentTime, 0.02); },
    setDelaySend(v) { delaySend.gain.setTargetAtTime(v, ctx.currentTime, 0.02); },
    setReverbSend(v) { reverbSend.gain.setTargetAtTime(v, ctx.currentTime, 0.02); },
    setDistortionSend(v) { distortionSend.gain.setTargetAtTime(v, ctx.currentTime, 0.02); },
  };
}

// ---------------------------------------------------------------------
// Macro resolution - macros are NEVER written into a voice's stored
// params; they're applied fresh at every trigger so "without destroying
// their individual settings" is true by construction, not by
// convention. jitter carries this specific hit's humanize offsets
// (computed once by the looper, zero at humanize=0).
// ---------------------------------------------------------------------
function resolveEffective(voiceId, params, macros, jitter) {
  const p = { ...params };
  const pitchMul = Math.pow(2, ((macros.pitch || 0) + (jitter.pitchSemis || 0)) / 12);
  if ("pitch" in p) p.pitch = clampParam("pitch", p.pitch * pitchMul);
  const decayMul = Math.max(0.05, 1 + (macros.decay || 0)) * Math.max(0.05, 1 + (jitter.decayMult || 0));
  for (const k of ["decay", "pitchEnvTime", "spread"]) if (k in p) p[k] = clampParam(k, p[k] * decayMul);
  const toneMul = Math.pow(2, ((macros.tone || 0) + (macros.filter || 0)) * 2);
  if ("filter" in p) p.filter = clampParam("filter", p.filter * toneMul);
  if ("resonance" in p) p.resonance = clampParam("resonance", p.resonance + (macros.filter || 0) * 4);
  if ("tone" in p) p.tone = clampParam("tone", p.tone + (macros.tone || 0) * 40);
  if ("drive" in p) p.drive = clampParam("drive", p.drive + (macros.drive || 0) * 100);
  for (const k of ["metal", "fmAmount", "ringMod"]) {
    if (k in p) p[k] = clampParam(k, p[k] + (macros.metal || 0) * 60);
  }
  if ("sendReverb" in p) p.sendReverb = clampParam("sendReverb", p.sendReverb + (macros.space || 0) * 100);
  if ("pan" in p) p.pan = clampParam("pan", p.pan + (jitter.pan || 0) * 100);
  if ("tone" in p && jitter.toneShift) p.tone = clampParam("tone", p.tone + jitter.toneShift * 40);
  return p;
}

function s01(pct) { return Math.max(0, Math.min(1, pct / 100)); }
function ms(v) { return v / 1000; }

// ---------------------------------------------------------------------
// Kick: sine/triangle fundamental with a fast pitch-drop envelope, an
// optional click transient and saturation for everything from deep sub
// to an industrial thump.
// ---------------------------------------------------------------------
function playKick(ctx, dest, time, p, velocity, accent) {
  const vel = velocity * (accent ? 1.15 : 1);
  const osc = ctx.createOscillator();
  osc.type = p.waveform === "triangle" ? "triangle" : "sine";
  const startFreq = p.pitch * (1 + s01(p.pitchEnvAmount) * 3.2);
  osc.frequency.setValueAtTime(startFreq, time);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, p.pitch), time + Math.max(0.004, ms(p.pitchEnvTime)));

  const shaper = ctx.createWaveShaper();
  shaper.curve = makeDriveCurve(s01(p.drive));
  shaper.oversample = "2x";
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 300 + s01(p.tone) * 9000;

  const amp = ctx.createGain();
  const decayS = Math.max(0.02, ms(p.decay));
  const punch = s01(p.punch);
  amp.gain.setValueAtTime(0.0001, time);
  amp.gain.exponentialRampToValueAtTime(Math.min(1.3, vel * (0.6 + punch * 0.7)), time + 0.002 + punch * 0.006);
  amp.gain.exponentialRampToValueAtTime(0.0001, time + decayS);

  osc.connect(shaper);
  shaper.connect(tone);
  tone.connect(amp);
  amp.connect(dest);
  osc.start(time);
  osc.stop(time + decayS + 0.05);

  const clickAmt = s01(p.click);
  if (clickAmt > 0.001) {
    const noiseBuf = makeNoiseBuffer(ctx, 0.02);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 2500;
    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(clickAmt * vel * 0.6, time);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.015);
    src.connect(hp);
    hp.connect(clickGain);
    clickGain.connect(dest);
    src.start(time);
    src.stop(time + 0.02);
  }
}

// ---------------------------------------------------------------------
// Snare: tonal body oscillator + filtered noise + a short transient.
// ---------------------------------------------------------------------
function playSnare(ctx, dest, time, p, velocity, accent) {
  const vel = velocity * (accent ? 1.15 : 1);
  const decayS = Math.max(0.02, ms(p.decay));

  const bodyOsc = ctx.createOscillator();
  bodyOsc.type = "triangle";
  bodyOsc.frequency.setValueAtTime(p.pitch * 1.6, time);
  bodyOsc.frequency.exponentialRampToValueAtTime(p.pitch, time + 0.05);
  const bodyGain = ctx.createGain();
  bodyGain.gain.setValueAtTime(0.0001, time);
  bodyGain.gain.exponentialRampToValueAtTime(s01(p.body) * vel, time + 0.003);
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, time + decayS * 0.7);
  bodyOsc.connect(bodyGain);

  const noiseBuf = makeNoiseBuffer(ctx, decayS + 0.1);
  const noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = noiseBuf;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = p.filter;
  bp.Q.value = p.resonance;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.0001, time);
  noiseGain.gain.exponentialRampToValueAtTime(s01(p.noise) * vel, time + 0.004);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, time + decayS);
  noiseSrc.connect(bp);
  bp.connect(noiseGain);

  const shaper = ctx.createWaveShaper();
  shaper.curve = makeDriveCurve(s01(p.drive));
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 800 + s01(p.tone) * 10000;
  const mix = ctx.createGain();

  bodyGain.connect(shaper);
  noiseGain.connect(shaper);
  shaper.connect(tone);
  tone.connect(mix);
  mix.connect(dest);

  bodyOsc.start(time);
  bodyOsc.stop(time + decayS + 0.05);
  noiseSrc.start(time);
  noiseSrc.stop(time + decayS + 0.1);

  const snapAmt = s01(p.snap);
  if (snapAmt > 0.001) {
    const snapSrc = ctx.createBufferSource();
    snapSrc.buffer = noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 4000;
    const snapGain = ctx.createGain();
    snapGain.gain.setValueAtTime(snapAmt * vel * 0.7, time);
    snapGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.02);
    snapSrc.connect(hp);
    hp.connect(snapGain);
    snapGain.connect(dest);
    snapSrc.start(time);
    snapSrc.stop(time + 0.025);
  }
}

// ---------------------------------------------------------------------
// Tom / Low Percussion: pitched oscillator with pitch bend, plus FM for
// anything from a normal tom to metallic FM percussion.
// ---------------------------------------------------------------------
function playTom(ctx, dest, time, p, velocity, accent) {
  const vel = velocity * (accent ? 1.15 : 1);
  const decayS = Math.max(0.03, ms(p.decay));

  const carrier = ctx.createOscillator();
  carrier.type = p.waveform || "sine";
  const bendAmt = p.pitchBend / 100;
  const startFreq = p.pitch * Math.pow(2, bendAmt * 0.8);
  carrier.frequency.setValueAtTime(startFreq, time);
  carrier.frequency.exponentialRampToValueAtTime(Math.max(20, p.pitch), time + decayS * 0.6);

  const fmAmt = s01(p.fmAmount);
  let modOsc = null;
  let modGain = null;
  if (fmAmt > 0.001) {
    modOsc = ctx.createOscillator();
    modOsc.type = "sine";
    modOsc.frequency.value = p.pitch * p.fmRatio;
    modGain = ctx.createGain();
    modGain.gain.value = p.pitch * fmAmt * 4;
    modOsc.connect(modGain);
    modGain.connect(carrier.frequency);
    modOsc.start(time);
    modOsc.stop(time + decayS + 0.05);
  }

  const shaper = ctx.createWaveShaper();
  shaper.curve = makeDriveCurve(s01(p.drive));
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 300 + s01(p.tone) * 9000;
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, time);
  amp.gain.exponentialRampToValueAtTime(vel, time + 0.003);
  amp.gain.exponentialRampToValueAtTime(0.0001, time + decayS);

  carrier.connect(shaper);
  shaper.connect(tone);
  tone.connect(amp);
  amp.connect(dest);
  carrier.start(time);
  carrier.stop(time + decayS + 0.05);
}

// ---------------------------------------------------------------------
// Clap / Percussion: a cluster of short noise bursts (the multiple
// hands-worth of a real clap) plus an optional metallic resonator.
// ---------------------------------------------------------------------
function playClap(ctx, dest, time, p, velocity, accent) {
  const vel = velocity * (accent ? 1.15 : 1);
  const decayS = Math.max(0.05, ms(p.decay));
  const spreadS = 0.003 + s01(p.spread) * 0.045;
  const noiseBuf = makeNoiseBuffer(ctx, decayS + 0.2);

  const offsets = [0, spreadS, spreadS * 2, spreadS * 3];
  offsets.forEach((offset, i) => {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = p.filter;
    bp.Q.value = 1.5;
    const g = ctx.createGain();
    const isLast = i === offsets.length - 1;
    const peak = s01(p.noise) * vel * (isLast ? 1 : 0.6);
    g.gain.setValueAtTime(0.0001, time + offset);
    g.gain.exponentialRampToValueAtTime(peak, time + offset + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, time + offset + (isLast ? decayS : 0.03));
    src.connect(bp);
    bp.connect(g);
    const shaper = ctx.createWaveShaper();
    shaper.curve = makeDriveCurve(s01(p.drive));
    g.connect(shaper);
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 800 + s01(p.tone) * 10000;
    shaper.connect(tone);
    tone.connect(dest);
    src.start(time + offset);
    src.stop(time + offset + decayS + 0.1);
  });

  const metalAmt = s01(p.metal);
  if (metalAmt > 0.001) {
    const partials = [1, 1.6, 2.3, 3.1];
    partials.forEach((ratio) => {
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = p.pitch * ratio * 3;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time + spreadS * 3);
      g.gain.exponentialRampToValueAtTime(metalAmt * vel * 0.18, time + spreadS * 3 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, time + spreadS * 3 + decayS * 0.6);
      osc.connect(g);
      g.connect(dest);
      osc.start(time + spreadS * 3);
      osc.stop(time + spreadS * 3 + decayS + 0.05);
    });
  }
}

// ---------------------------------------------------------------------
// Hats: an inharmonic square-oscillator bank through band/high-pass
// filtering, shared between closed and open with different decay/wash.
// ---------------------------------------------------------------------
function playHat(ctx, dest, time, p, velocity, accent, isOpen) {
  const vel = velocity * (accent ? 1.15 : 1);
  const decayS = Math.max(0.02, ms(p.decay));
  const metalAmt = s01(p.metal);
  const spread = isOpen ? 1 + s01(p.spread) * 0.6 : 1;

  const mix = ctx.createGain();
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = p.filter;
  bp.Q.value = p.resonance;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = Math.max(1500, p.filter * 0.5);
  const shaper = ctx.createWaveShaper();
  shaper.curve = makeDriveCurve(s01(p.drive));
  const env = ctx.createGain();
  env.gain.setValueAtTime(vel, time);
  env.gain.exponentialRampToValueAtTime(0.0001, time + decayS);

  mix.connect(bp);
  bp.connect(hp);
  hp.connect(shaper);
  shaper.connect(env);
  env.connect(dest);

  HAT_RATIOS.forEach((ratio) => {
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = p.pitch * ratio * (1 + metalAmt * ratio * spread * 0.35);
    osc.connect(mix);
    osc.start(time);
    osc.stop(time + decayS + 0.08);
  });

  const noiseAmt = s01(p.noise);
  if (noiseAmt > 0.001) {
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = makeNoiseBuffer(ctx, decayS + 0.1);
    const noiseHp = ctx.createBiquadFilter();
    noiseHp.type = "highpass";
    noiseHp.frequency.value = Math.max(1500, p.filter * 0.5);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(noiseAmt * vel * 0.5, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, time + decayS);
    noiseSrc.connect(noiseHp);
    noiseHp.connect(noiseGain);
    noiseGain.connect(dest);
    noiseSrc.start(time);
    noiseSrc.stop(time + decayS + 0.1);
  }

  if (isOpen) {
    const washAmt = s01(p.wash);
    if (washAmt > 0.001) {
      const washSrc = ctx.createBufferSource();
      washSrc.buffer = makeNoiseBuffer(ctx, decayS + 0.4);
      const washHp = ctx.createBiquadFilter();
      washHp.type = "highpass";
      washHp.frequency.value = 6000;
      const washGain = ctx.createGain();
      washGain.gain.setValueAtTime(0.0001, time);
      washGain.gain.exponentialRampToValueAtTime(washAmt * vel * 0.35, time + 0.01);
      washGain.gain.exponentialRampToValueAtTime(0.0001, time + decayS * 1.6);
      washSrc.connect(washHp);
      washHp.connect(washGain);
      washGain.connect(dest);
      washSrc.start(time);
      washSrc.stop(time + decayS * 1.6 + 0.1);
    }
  }

  return { env, stopAt(t) { rampTo(env.gain, 0, 0.03, t); } };
}

const PLAYERS = {
  kick: (ctx, dest, time, p, v, a) => playKick(ctx, dest, time, p, v, a),
  snare: (ctx, dest, time, p, v, a) => playSnare(ctx, dest, time, p, v, a),
  tom: (ctx, dest, time, p, v, a) => playTom(ctx, dest, time, p, v, a),
  clap: (ctx, dest, time, p, v, a) => playClap(ctx, dest, time, p, v, a),
  closedHat: (ctx, dest, time, p, v, a) => playHat(ctx, dest, time, p, v, a, false),
  openHat: (ctx, dest, time, p, v, a) => playHat(ctx, dest, time, p, v, a, true),
};

// ---------------------------------------------------------------------
// Public factory: one of these per voice. Owns the stored params
// (never touched by macros), the tonality attachment, and the bus.
// ---------------------------------------------------------------------
export function createVoice(voiceId, ctx, sends, onChange) {
  const bus = createVoiceBus(ctx, sends);
  let params = defaultVoiceParams(voiceId);
  let tonalityState = defaultTonalityState();
  let activeOpenHat = null;

  function applyBusFromParams() {
    if ("pan" in params) bus.setPan(params.pan / 100);
    if ("stereoWidth" in params) bus.setWidth(params.stereoWidth / 100);
    if ("volume" in params) bus.setVolume(s01(params.volume));
    if ("sendDelay" in params) bus.setDelaySend(s01(params.sendDelay));
    if ("sendReverb" in params) bus.setReverbSend(s01(params.sendReverb));
    if ("sendDistortion" in params) bus.setDistortionSend(s01(params.sendDistortion));
  }
  applyBusFromParams();

  return {
    id: voiceId,
    getParams: () => ({ ...params }),
    getTonality: () => ({ ...tonalityState }),
    setParam(key, value) {
      if (!(key in params)) return;
      params[key] = clampParam(key, value);
      applyBusFromParams();
      onChange?.();
    },
    setParams(next) {
      for (const [k, v] of Object.entries(next)) if (k in params) params[k] = clampParam(k, v);
      applyBusFromParams();
      onChange?.();
    },
    setTonality(next) {
      tonalityState = { ...tonalityState, ...next };
      onChange?.();
    },
    // globalTonality: { mode, rootSemitone, customDegrees } shared across all voices.
    trigger(time, { velocity = 1, accent = false, macros = {}, jitter = {}, globalTonality } = {}) {
      const effective = resolveEffective(voiceId, params, macros, jitter);
      if (tonalityState.follow && globalTonality && globalTonality.mode !== "free" && "pitch" in effective) {
        effective.pitch = clampParam("pitch", degreeToFreq({
          rootSemitone: globalTonality.rootSemitone,
          mode: globalTonality.mode,
          degree: tonalityState.degree,
          octaveOffset: tonalityState.octaveOffset,
          customDegrees: globalTonality.customDegrees,
        }));
      } else if ("fineTune" in effective) {
        effective.pitch = effective.pitch * Math.pow(2, (effective.fineTune + (effective.octave || 0) * 1200) / 1200);
      } else if ("octave" in effective && "pitch" in effective) {
        effective.pitch = effective.pitch * Math.pow(2, effective.octave);
      }
      const vClamped = Math.max(0.05, Math.min(1.4, velocity));
      const result = PLAYERS[voiceId](ctx, bus.input, time, effective, vClamped, accent);
      if (voiceId === "openHat") {
        if (activeOpenHat) activeOpenHat.stopAt(time);
        activeOpenHat = result;
      } else if (voiceId === "closedHat" && activeOpenHat) {
        activeOpenHat.stopAt(time);
        activeOpenHat = null;
      }
    },
  };
}

export function createAllVoices(ctx, sends, onChange) {
  const voices = {};
  for (const id of VOICE_IDS) voices[id] = createVoice(id, ctx, sends, onChange);
  return voices;
}
