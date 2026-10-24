// Test helpers: Node-side fakes for the few browser APIs the core touches.

// A Canvas 2D context that accepts every call and records a few counters.
export function fakeContext2D() {
  const counts = {};
  const target = { canvas: null };
  return new Proxy(target, {
    get(t, k) {
      if (k === '__counts') return counts;
      if (k in t) return t[k];
      return (...args) => { counts[k] = (counts[k] || 0) + 1; void args; };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

export function fakeCanvas(width = 400, height = 800) {
  const ctx = fakeContext2D();
  const canvas = {
    width, height, _ctx: ctx,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
    addEventListener() {}, removeEventListener() {}, setPointerCapture() {},
    toBlob: (cb) => cb(null),
  };
  ctx.canvas = canvas;
  return canvas;
}

export function installDomStubs() {
  globalThis.document ??= { createElement: () => ({ getContext: () => fakeContext2D() }), addEventListener() {}, removeEventListener() {}, hidden: false };
  globalThis.devicePixelRatio ??= 1;
}

export function memoryBackend() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _map: m };
}

// Minimal fake AudioContext surface for the voice manager.
export function fakeAudioContext() {
  const param = () => ({ value: 0, setValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  return { currentTime: 0, gainNode: () => ({ gain: param() }) };
}

// Advance the app by N frames on a fake timeline shared with its input `now()`.
export const tick = (app, frames = 1, dtMs = 16.7) => { for (let i = 0; i < frames; i++) { app._timeRef.t += dtMs; app.frame(app._timeRef.t); } };
