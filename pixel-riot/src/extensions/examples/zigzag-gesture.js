// EXAMPLE EXTENSION — a gesture recognizer and a mapping for it.
// Recognizes a ZIGZAG (3+ horizontal direction flips within 0.9s) and publishes
// 'gesture:zigzag'. A `global: true` interaction profile maps it in EVERY effect set.

export default {
  manifest: {
    id: 'ex.zigzag', name: 'Zigzag Gesture (example)', version: '1.0.0', type: 'gesture', apiVersion: '1.0.0',
    description: 'Adds a zigzag gesture that triggers a glitch storm.', dependencies: ['core.gestures', 'core.interactions'],
    events: { emits: ['gesture:zigzag'] },
  },
  register(api) {
    // ============================================================
    // EXTENSION ZONE: GESTURE RECOGNIZERS (example)
    // PURPOSE: Register new gesture recognizers.
    // CONTRACT: src/input/gesture-recognizer.js — down/move/up/frame(p, ctx); publish with
    //           ctx.emit(type, p, extra). Keep per-pointer state in p.data[<your id>].
    // SAFETY: Never attach DOM listeners; never spawn effects directly (describe, don't act).
    // INTEGRATION: api.input.recognizers.register(def)
    // ============================================================
    api.input.recognizers.register({
      id: 'ex.zigzag', name: 'ZIGZAG', emits: ['zigzag'],
      down(p) { p.data.zig = { flips: [], sign: 0 }; },
      move(p, ctx) {
        const z = p.data.zig; if (!z || Math.abs(p.vx) < 0.6) return;
        const s = Math.sign(p.vx); const now = ctx.now() / 1000;
        if (z.sign && s !== z.sign) z.flips.push(now);
        z.sign = s;
        z.flips = z.flips.filter((t) => now - t < 0.9);
        if (z.flips.length >= 3) { ctx.emit('zigzag', p, { flips: z.flips.length }); z.flips = []; }
      },
    });
    // global: true merges these rules into whichever effect set is active.
    api.interactions.register({
      id: 'ex.zigzag-rules', name: 'ZIGZAG RULES', description: 'Zigzag -> glitch storm.', global: true,
      rules: [{ on: 'zigzag', do: [{ effect: 'glitch-blocks', params: { blocks: 9, spread: 10 } }, { effect: 'flash-grid' }, { sound: 'burst', map: 'fixed' }] }],
    });
  },
};
