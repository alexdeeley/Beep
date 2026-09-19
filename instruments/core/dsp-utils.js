// Trivial, widely-reused DSP building blocks - kept here once instead of
// copy-pasted into every module that wants a noise burst or a drive curve.
export function makeNoiseBuffer(ctx, durationSeconds = 1.0) {
  const length = Math.max(1, Math.floor(ctx.sampleRate * durationSeconds));
  const buf = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

export function makeDistortionCurve(amount) {
  const n = 4096;
  const curve = new Float32Array(n);
  const deg = Math.PI / 180;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}
