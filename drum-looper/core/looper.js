import { getContext, createClock, getMasterInput, getDelayBus, getReverbBus, getDistortionBus } from "./audio.js";
import { createAllVoices, VOICE_IDS } from "./voices.js";

// ---------------------------------------------------------------------
// THE EVENT LOOPER
//
// The recorded "performance" is never audio - it is a flat list of hit
// events { id, voiceId, time (ms within the original recording),
// velocity, accent, layer }. Playback re-triggers the CURRENT voice
// synthesis for every event on every pass, so changing a voice's sound,
// the tonality, or a playback transform takes effect on the very next
// scheduled hit without ever re-recording. See voices.js for the
// per-hit synthesis and audio.js for the low-level look-ahead clock
// this module drives.
// ---------------------------------------------------------------------

const MAX_LAYERS = 8;

export function createLooper() {
  const ctx = getContext();
  const sends = {
    dry: getMasterInput(),
    delayBus: getDelayBus().input,
    reverbBus: getReverbBus().input,
    distortionBus: getDistortionBus().input,
  };
  // Voice param/tonality edits route through the same notify() path as
  // every other change (transport, transforms, macros, ...) so a single
  // subscription (autosave, transport UI refresh) never misses a voice
  // edit - this is exactly the kind of change that must be saved, since
  // "tweak the sound without re-recording" is the whole point.
  const voices = createAllVoices(ctx, sends, () => notify());

  // ---- recorded truth (mutated only by record/overdub/undo/clear) ----
  let events = []; // { id, voiceId, time, velocity, accent, layer }
  let layers = []; // ordered layer ids, layers[0] is always the base recording
  let durationMs = 0;
  let nextEventId = 1;
  let nextLayerId = 1;

  // ---- transport state machine ----
  // idle -> armed -> recording -> looping <-> overdubbing, or looping -> stopped -> looping
  let playbackState = "idle";
  let recordStartAudio = 0;
  let tempRecordEvents = [];
  let overdubLayerId = null;
  let overdubEvents = [];
  let masterCycleOrigin = 0; // audio time corresponding to timeline position 0

  // ---- non-destructive playback transforms ----
  const transforms = {
    reverse: false,
    rotateMs: 0,
    speedMultiplier: 1, // 0.5 | 1 | 2 (the three quick buttons)
    stretchMultiplier: 1, // continuous fine trim on top of speedMultiplier
    swing: 0, // 0..1
    velocityScale: 1,
    quantizeStrength: 0, // 0..1
    voiceLengthMultiplier: Object.fromEntries(VOICE_IDS.map((v) => [v, 1])),
    probability: Object.fromEntries(VOICE_IDS.map((v) => [v, 1])),
    stutter: Object.fromEntries(VOICE_IDS.map((v) => [v, 0])),
    dropped: Object.fromEntries(VOICE_IDS.map((v) => [v, false])),
  };

  const humanize = { velocity: 0, pitch: 0, timing: 0, decay: 0, pan: 0, tone: 0 };

  const macros = { pitch: 0, tone: 0, decay: 0, drive: 0, filter: 0, space: 0, chaos: 0, metal: 0 };

  const tonality = { mode: "free", rootSemitone: 0, customDegrees: null };

  // ---- automation (separate from the drum performance) ----
  let automationEvents = []; // { path, time, value }
  let automationEnabled = true;
  let automationRecording = false;
  let automationSetters = {}; // path -> (value) => void, registered by app.js

  // ---- per-voice scheduling cursors ----
  const voiceSchedules = Object.fromEntries(VOICE_IDS.map((v) => [v, { events: [], cursor: 0, cycleStart: 0, cycleLenMs: 0 }]));
  let automationSchedule = { events: [], cursor: 0, cycleStart: 0, cycleLenMs: 0 };

  const listeners = new Set();
  function notify() { for (const fn of listeners) fn(getSnapshotSummary()); }

  const hitListeners = new Set(); // visual flash callbacks (voiceId, kind)
  function notifyHit(voiceId, kind) { for (const fn of hitListeners) fn(voiceId, kind); }

  function effDurationMs() { return durationMs * transforms.speedMultiplier * transforms.stretchMultiplier; }

  function quantizeSnap(t, strength, cycleMs) {
    const bpm = getBpm();
    const gridMs = (60000 / bpm) / 4; // 16th-note grid, purely as an optional snapping reference
    const nearest = Math.round(t / gridMs) * gridMs;
    const snapped = t + (nearest - t) * strength;
    return ((snapped % cycleMs) + cycleMs) % cycleMs;
  }

  function buildVoiceSchedule(voiceId) {
    const base = events.filter((e) => e.voiceId === voiceId);
    const durS = durationMs;
    const spd = transforms.speedMultiplier * transforms.stretchMultiplier;
    const cycleLenMs = Math.max(1, effDurationMs() * (transforms.voiceLengthMultiplier[voiceId] || 1));
    const mapped = base.map((e) => {
      let t = transforms.reverse ? durS - e.time : e.time;
      t = t * spd;
      t = t + transforms.rotateMs * spd;
      if (transforms.quantizeStrength > 0) t = quantizeSnap(t, transforms.quantizeStrength, cycleLenMs);
      t = ((t % cycleLenMs) + cycleLenMs) % cycleLenMs;
      return { ...e, effectiveTime: t };
    });
    mapped.sort((a, b) => a.effectiveTime - b.effectiveTime);
    return { events: mapped, cycleLenMs };
  }

  // Fast-forwards a stale cycleStart to the most recent cycle boundary
  // at-or-before `now` via closed-form arithmetic (not an iterative
  // catch-up loop) - this is what lets a rebuild triggered by, say, an
  // overdub commit or a transform tweak preserve the voice's current
  // phase-within-cycle instead of either freezing time or having the
  // scheduler try to "catch up" through however many cycles elapsed
  // since the reference point was last set.
  function advanceCycleStart(prevCycleStart, cycleLenS, now) {
    if (cycleLenS <= 0) return now;
    const elapsedCycles = Math.floor((now - prevCycleStart) / cycleLenS);
    return prevCycleStart + elapsedCycles * cycleLenS;
  }

  function rebuildAllSchedules(resetPhase) {
    const now = ctx.currentTime;
    for (const voiceId of VOICE_IDS) {
      const built = buildVoiceSchedule(voiceId);
      const prev = voiceSchedules[voiceId];
      const cycleStart = resetPhase || !prev.cycleLenMs
        ? now
        : advanceCycleStart(prev.cycleStart, built.cycleLenMs / 1000, now);
      voiceSchedules[voiceId] = { events: built.events, cycleLenMs: built.cycleLenMs, cursor: 0, cycleStart };
    }
    const autoCycleLenMs = effDurationMs();
    const autoCycleStart = resetPhase || !automationSchedule.cycleLenMs
      ? now
      : advanceCycleStart(automationSchedule.cycleStart, autoCycleLenMs / 1000, now);
    automationSchedule = { events: [...automationEvents].sort((a, b) => a.time - b.time), cursor: 0, cycleLenMs: autoCycleLenMs, cycleStart: autoCycleStart };
    if (resetPhase) masterCycleOrigin = now;
  }

  // ---- BPM (display + delay sync + optional quantize reference only -
  // freely recorded loops never require bar boundaries) ----
  let bpm = 120;
  let tapTimes = [];
  function getBpm() { return bpm; }
  function setBpm(next) { bpm = Math.max(40, Math.min(300, Math.round(next))); notify(); return bpm; }
  function tapTempo() {
    const now = performance.now();
    tapTimes = tapTimes.filter((t) => now - t < 2000);
    tapTimes.push(now);
    if (tapTimes.length < 2) return bpm;
    const intervals = [];
    for (let i = 1; i < tapTimes.length; i++) intervals.push(tapTimes[i] - tapTimes[i - 1]);
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    return setBpm(60000 / avg);
  }

  // ---- humanize / macro jitter for one scheduled hit ----
  function computeJitter() {
    const chaos = macros.chaos || 0;
    const rnd = () => Math.random() * 2 - 1;
    return {
      pitchSemis: rnd() * (humanize.pitch + chaos * 0.5) * 12,
      decayMult: rnd() * (humanize.decay + chaos * 0.3) * 0.8,
      pan: rnd() * (humanize.pan + chaos * 0.3),
      toneShift: rnd() * (humanize.tone + chaos * 0.3),
      velocityMult: rnd() * (humanize.velocity + chaos * 0.4) * 0.5,
      timingMs: rnd() * (humanize.timing + chaos * 0.3) * 40,
    };
  }

  function scheduleHit(voiceId, event, cleanAbsTime, kind) {
    if (transforms.dropped[voiceId]) return;
    const prob = transforms.probability[voiceId];
    if (prob < 1 && Math.random() > prob) return;
    const jitter = computeJitter();
    const triggerTime = Math.max(ctx.currentTime + 0.001, cleanAbsTime + jitter.timingMs / 1000);
    const vel = Math.max(0.05, Math.min(1.4, event.velocity * transforms.velocityScale * (1 + jitter.velocityMult)));
    voices[voiceId].trigger(triggerTime, { velocity: vel, accent: event.accent, macros, jitter, globalTonality: tonality });
    scheduleVisualFlash(triggerTime, voiceId, event.layer === 0 ? "recorded" : "overdub");

    const stutterN = transforms.stutter[voiceId] || 0;
    for (let i = 1; i <= stutterN; i++) {
      const st = triggerTime + i * 0.032;
      voices[voiceId].trigger(st, { velocity: vel * (1 - i * 0.22), accent: false, macros, jitter, globalTonality: tonality });
      scheduleVisualFlash(st, voiceId, "overdub");
    }
  }

  function scheduleVisualFlash(audioTime, voiceId, kind) {
    const delayMs = Math.max(0, (audioTime - ctx.currentTime) * 1000);
    setTimeout(() => notifyHit(voiceId, kind), delayMs);
  }

  function onTick(now, lookaheadEnd) {
    const active = playbackState === "looping" || playbackState === "overdubbing";
    if (active) {
      for (const voiceId of VOICE_IDS) {
        const sched = voiceSchedules[voiceId];
        if (!sched || sched.cycleLenMs <= 0 || sched.events.length === 0) continue;
        let guard = 0;
        while (guard++ < 64) {
          const ev = sched.events[sched.cursor];
          const absTime = sched.cycleStart + ev.effectiveTime / 1000;
          if (absTime >= lookaheadEnd) break;
          scheduleHit(voiceId, ev, absTime);
          sched.cursor++;
          if (sched.cursor >= sched.events.length) {
            sched.cursor = 0;
            sched.cycleStart += sched.cycleLenMs / 1000;
          }
        }
      }
      if (automationEnabled && automationSchedule.events.length && automationSchedule.cycleLenMs > 0) {
        let guard = 0;
        while (guard++ < 64) {
          const ev = automationSchedule.events[automationSchedule.cursor];
          const absTime = automationSchedule.cycleStart + ev.time / 1000;
          if (absTime > now) break; // automation applies at "now" precision, not audio-sample precision
          automationSetters[ev.path]?.(ev.value);
          automationSchedule.cursor++;
          if (automationSchedule.cursor >= automationSchedule.events.length) {
            automationSchedule.cursor = 0;
            automationSchedule.cycleStart += automationSchedule.cycleLenMs / 1000;
          }
        }
      }
    }
  }

  const clock = createClock({ onTick });

  // ---------------------------------------------------------------------
  // Transport actions
  // ---------------------------------------------------------------------
  function record() {
    if (playbackState === "idle" || playbackState === "stopped") {
      playbackState = "armed";
      tempRecordEvents = [];
    } else if (playbackState === "armed") {
      // Tapped RECORD again before playing anything - cancel the arm.
      playbackState = "idle";
      tempRecordEvents = [];
    } else if (playbackState === "recording") {
      durationMs = Math.max(50, (ctx.currentTime - recordStartAudio) * 1000);
      events = tempRecordEvents.map((e) => ({ ...e }));
      layers = [0];
      nextLayerId = 1;
      playbackState = "looping";
      rebuildAllSchedules(true);
      clock.start();
    } else {
      // already looping/stopped/overdubbing - RECORD starts a brand new take.
      clock.stop();
      playbackState = "armed";
      tempRecordEvents = [];
      overdubEvents = [];
      overdubLayerId = null;
      events = [];
      layers = [];
      durationMs = 0;
      automationEvents = [];
    }
    notify();
  }

  function stop() {
    if (playbackState === "recording" || playbackState === "armed") {
      playbackState = events.length ? "stopped" : "idle";
      tempRecordEvents = [];
    } else if (playbackState === "overdubbing") {
      cancelOverdub();
      playbackState = "stopped";
      clock.stop();
    } else {
      playbackState = events.length ? "stopped" : "idle";
      clock.stop();
    }
    notify();
  }

  function play() {
    if (!events.length) return;
    if (playbackState === "stopped" || playbackState === "idle") {
      playbackState = "looping";
      rebuildAllSchedules(true);
      clock.start();
      notify();
    }
  }

  function overdub() {
    if (playbackState === "looping") {
      overdubLayerId = nextLayerId++;
      overdubEvents = [];
      playbackState = "overdubbing";
    } else if (playbackState === "overdubbing") {
      if (overdubEvents.length) {
        events.push(...overdubEvents);
        layers.push(overdubLayerId);
        if (layers.length > MAX_LAYERS + 1) {
          const dropped = layers.splice(1, layers.length - (MAX_LAYERS + 1));
          events = events.filter((e) => !dropped.includes(e.layer));
        }
        rebuildAllSchedules(false);
      }
      overdubEvents = [];
      overdubLayerId = null;
      playbackState = "looping";
    }
    notify();
  }

  function cancelOverdub() {
    overdubEvents = [];
    overdubLayerId = null;
  }

  function undo() {
    if (layers.length <= 1) return;
    const removed = layers.pop();
    events = events.filter((e) => e.layer !== removed);
    rebuildAllSchedules(false);
    notify();
  }

  function clear() {
    clock.stop();
    events = [];
    layers = [];
    durationMs = 0;
    tempRecordEvents = [];
    overdubEvents = [];
    overdubLayerId = null;
    automationEvents = [];
    playbackState = "idle";
    for (const v of VOICE_IDS) voiceSchedules[v] = { events: [], cursor: 0, cycleStart: 0, cycleLenMs: 0 };
    notify();
  }

  // ---------------------------------------------------------------------
  // Live pad hits - always sound immediately; also captured into the
  // recording/overdub buffers depending on transport state.
  // ---------------------------------------------------------------------
  function hitPad(voiceId, velocity = 1, accent = false) {
    const now = ctx.currentTime;
    voices[voiceId].trigger(now, { velocity, accent, macros, jitter: {}, globalTonality: tonality });
    notifyHit(voiceId, "live");

    if (playbackState === "armed") {
      recordStartAudio = now;
      playbackState = "recording";
      tempRecordEvents.push({ id: nextEventId++, voiceId, time: 0, velocity, accent, layer: 0 });
      notify();
    } else if (playbackState === "recording") {
      tempRecordEvents.push({ id: nextEventId++, voiceId, time: (now - recordStartAudio) * 1000, velocity, accent, layer: 0 });
    } else if (playbackState === "overdubbing") {
      const spd = transforms.speedMultiplier * transforms.stretchMultiplier;
      const cycleS = Math.max(0.001, effDurationMs() / 1000);
      const posInEffective = ((now - masterCycleOrigin) % cycleS + cycleS) % cycleS;
      const posOriginalMs = (posInEffective * 1000) / spd;
      overdubEvents.push({ id: nextEventId++, voiceId, time: posOriginalMs, velocity, accent, layer: overdubLayerId });
    }
  }

  // ---------------------------------------------------------------------
  // Playhead for the UI's thin progress indicator.
  // ---------------------------------------------------------------------
  function getPlayheadFraction() {
    if (playbackState !== "looping" && playbackState !== "overdubbing") return null;
    const cycleS = effDurationMs() / 1000;
    if (cycleS <= 0) return null;
    const elapsed = ((ctx.currentTime - masterCycleOrigin) % cycleS + cycleS) % cycleS;
    return elapsed / cycleS;
  }

  // ---------------------------------------------------------------------
  // Transform / humanize / macro / tonality setters - all recompute the
  // derived schedule (not the recorded truth) so changes apply live.
  // ---------------------------------------------------------------------
  function setTransform(key, value) {
    if (!(key in transforms)) return;
    transforms[key] = value;
    rebuildAllSchedules(false);
    notify();
  }
  function setVoiceTransform(kind, voiceId, value) {
    if (!transforms[kind] || !(voiceId in transforms[kind])) return;
    transforms[kind][voiceId] = value;
    if (kind === "voiceLengthMultiplier") rebuildAllSchedules(false);
    notify();
  }
  function setHumanize(key, value) { if (key in humanize) { humanize[key] = value; notify(); } }
  function setMacro(key, value) { if (key in macros) { macros[key] = value; notify(); } }
  function setTonality(next) { Object.assign(tonality, next); notify(); }

  function recordAutomation(path, value) {
    if (!automationRecording) return;
    if (playbackState !== "looping" && playbackState !== "overdubbing") return;
    const cycleS = Math.max(0.001, effDurationMs() / 1000);
    const posS = ((ctx.currentTime - masterCycleOrigin) % cycleS + cycleS) % cycleS;
    automationEvents.push({ path, time: posS * 1000, value });
    // Keep the list from growing unbounded during a long knob sweep.
    if (automationEvents.length > 4000) automationEvents.splice(0, automationEvents.length - 4000);
  }
  function startAutomationRecording() { automationRecording = true; notify(); }
  function stopAutomationRecording() { automationRecording = false; rebuildAllSchedules(false); notify(); }
  function setAutomationEnabled(v) { automationEnabled = v; notify(); }
  function clearAutomation() { automationEvents = []; rebuildAllSchedules(false); notify(); }
  function registerAutomationSetter(path, fn) { automationSetters[path] = fn; }

  function getSnapshotSummary() {
    return {
      playbackState,
      durationMs,
      effDurationMs: effDurationMs(),
      eventCount: events.length,
      layerCount: Math.max(0, layers.length - 1),
      bpm,
    };
  }

  return {
    voices,
    ctx,
    VOICE_IDS,
    // transport
    record, stop, play, overdub, undo, clear, hitPad,
    // state
    getState: () => ({ playbackState, durationMs, events, layers, transforms, humanize, macros, tonality, automationEvents, automationEnabled, bpm }),
    getPlaybackState: () => playbackState,
    getEvents: () => events,
    getDurationMs: () => durationMs,
    getTransforms: () => transforms,
    getHumanize: () => humanize,
    getMacros: () => macros,
    getTonality: () => tonality,
    getPlayheadFraction,
    getBpm, setBpm, tapTempo,
    // live tweak setters
    setTransform, setVoiceTransform, setHumanize, setMacro, setTonality,
    // automation
    startAutomationRecording, stopAutomationRecording, setAutomationEnabled, clearAutomation, recordAutomation, registerAutomationSetter,
    isAutomationRecording: () => automationRecording,
    isAutomationEnabled: () => automationEnabled,
    // events
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    onHit: (fn) => { hitListeners.add(fn); return () => hitListeners.delete(fn); },
    // restore (for state.js)
    _restore(state) {
      clock.stop();
      events = state.events || [];
      layers = state.layers || (events.length ? [0] : []);
      durationMs = state.durationMs || 0;
      nextEventId = (Math.max(0, ...events.map((e) => e.id || 0)) || 0) + 1;
      nextLayerId = (Math.max(0, ...layers) || 0) + 1;
      Object.assign(transforms, state.transforms || {});
      Object.assign(humanize, state.humanize || {});
      Object.assign(macros, state.macros || {});
      Object.assign(tonality, state.tonality || {});
      automationEvents = state.automationEvents || [];
      automationEnabled = state.automationEnabled !== false;
      bpm = state.bpm || 120;
      playbackState = events.length ? "stopped" : "idle";
      rebuildAllSchedules(true);
      notify();
    },
  };
}
