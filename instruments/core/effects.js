// Shared per-instrument effects chain: distortion -> delay -> reverb, each
// a dry/wet insert stage. One factory used by every instrument module so
// the effect engines themselves are never duplicated - only the UI knobs
// per instrument differ.

function makeDistortionCurve(amount) {
  const n = 44100;
  const curve = new Float32Array(n);
  const deg = Math.PI / 180;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

function makeImpulse(ctx, duration, decay) {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * duration));
  const impulse = ctx.createBuffer(2, length, rate);
  for (let c = 0; c < 2; c++) {
    const data = impulse.getChannelData(c);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

function createInsertStage(ctx, wetNode) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  dry.gain.value = 1;
  wet.gain.value = 0;
  input.connect(dry);
  dry.connect(output);
  input.connect(wetNode.node);
  wetNode.node.connect(wet);
  wet.connect(output);
  return { input, output, dry, wet };
}

function createDistortionStage(ctx) {
  const shaper = ctx.createWaveShaper();
  shaper.curve = makeDistortionCurve(0);
  shaper.oversample = "4x";
  const stage = createInsertStage(ctx, { node: shaper });
  return {
    ...stage,
    setAmount(amt) {
      const a = Math.max(0, Math.min(1, amt));
      shaper.curve = makeDistortionCurve(a * 80);
      stage.wet.gain.value = a;
      stage.dry.gain.value = 1 - a * 0.3; // keep some body under heavy drive
    },
  };
}

function createDelayStage(ctx) {
  const delay = ctx.createDelay(1.0);
  delay.delayTime.value = 0.3;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.35; // capped well short of 1 - no runaway feedback
  delay.connect(feedback);
  feedback.connect(delay);
  const stage = createInsertStage(ctx, { node: delay });
  return {
    ...stage,
    setAmount(amt) {
      stage.wet.gain.value = Math.max(0, Math.min(1, amt));
    },
    setTime(seconds) {
      delay.delayTime.setTargetAtTime(Math.max(0.02, Math.min(0.9, seconds)), ctx.currentTime, 0.02);
    },
  };
}

function createReverbStage(ctx) {
  const convolver = ctx.createConvolver();
  convolver.buffer = makeImpulse(ctx, 2.2, 2.0);
  const stage = createInsertStage(ctx, { node: convolver });
  return {
    ...stage,
    setAmount(amt) {
      stage.wet.gain.value = Math.max(0, Math.min(1, amt));
    },
  };
}

export function createEffectsChain(ctx) {
  const distortion = createDistortionStage(ctx);
  const delayFx = createDelayStage(ctx);
  const reverb = createReverbStage(ctx);
  distortion.output.connect(delayFx.input);
  delayFx.output.connect(reverb.input);
  return {
    input: distortion.input,
    output: reverb.output,
    distortion: { setAmount: (a) => distortion.setAmount(a) },
    delay: { setAmount: (a) => delayFx.setAmount(a), setTime: (t) => delayFx.setTime(t) },
    reverb: { setAmount: (a) => reverb.setAmount(a) },
  };
}
