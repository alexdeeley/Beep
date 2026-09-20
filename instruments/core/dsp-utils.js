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

const HAT_RATIOS = [2, 3, 4.16, 5.43, 6.79, 8.21];

// Classic 808/909/707-family metallic hat: six square oscillators at
// inharmonic ratios, summed through band/high-pass filtering. Returns the
// envelope GainNode so a caller with multiple hat voices (closed/open) can
// implement choking - ramp a still-ringing open-hat's envelope down early
// when a closed-hat hit lands, the way a real hi-hat's two cymbals
// physically damp each other on contact.
export function playMetallicHat(ctx, dest, time, { baseFreq = 40, decay = 0.06, toneHz = 3500 } = {}) {
  const mix = ctx.createGain();
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = toneHz * 2.5;
  bp.Q.value = 1;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = toneHz;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.5, time);
  env.gain.exponentialRampToValueAtTime(0.0001, time + Math.max(0.02, decay));

  mix.connect(bp);
  bp.connect(hp);
  hp.connect(env);
  env.connect(dest);

  HAT_RATIOS.forEach((r) => {
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = baseFreq * r;
    osc.connect(mix);
    osc.start(time);
    osc.stop(time + decay + 0.08);
  });

  return env;
}
