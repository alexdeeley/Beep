// The generator is plain JavaScript on a canvas-shaped object, so most of it
// can be checked in Node with a stand-in canvas context.   node dev/unit-tests.mjs
import { createPiece, STYLES, normalizeSeed } from '../public/js/art/index.js';
import { makeRng } from '../public/js/art/rng.js';

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) pass++; else { fail++; console.log('  ✗ ' + l); } };

// A context that accepts anything, counts the drawing it is asked to do, and
// notices numbers that are not numbers (the classic generative-art bug).
function fakeCtx() {
  const stats = { calls: 0, bad: [] };
  const grad = { addColorStop(o, c) { if (!(o >= 0 && o <= 1)) stats.bad.push('stop ' + o); if (typeof c !== 'string') stats.bad.push('stop colour'); } };
  const ctx = new Proxy({}, {
    get(_, k) {
      if (k === 'stats') return stats;
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return (...a) => { for (const v of a) if (!Number.isFinite(v)) stats.bad.push(k + ' ' + v); return grad; };
      if (k === 'createPattern') return () => ({});
      return (...a) => { stats.calls++; for (const v of a) if (typeof v === 'number' && !Number.isFinite(v)) stats.bad.push(`${String(k)}(${a.join(',')})`); };
    },
    set(_, k, v) {
      if (typeof v === 'number' && !Number.isFinite(v)) stats.bad.push(`${String(k)}=${v}`);
      if ((k === 'fillStyle' || k === 'strokeStyle') && typeof v === 'string' && /NaN|undefined/.test(v)) stats.bad.push(`${String(k)}=${v}`);
      return true;
    },
  });
  return ctx;
}

// ── Seeds and randomness ─────────────────────────────────────
{
  const a = makeRng('hello'), b = makeRng('hello'), c = makeRng('hellp');
  const xs = Array.from({ length: 20 }, () => a.float()), ys = Array.from({ length: 20 }, () => b.float()), zs = Array.from({ length: 20 }, () => c.float());
  ok(xs.join() === ys.join(), 'the same seed gives the same numbers');
  ok(xs.join() !== zs.join(), 'a one-letter change gives different numbers');
  ok(xs.every((v) => v >= 0 && v < 1), 'numbers are in 0..1');
  const mean = Array.from({ length: 5000 }, () => a.float()).reduce((s, v) => s + v, 0) / 5000;
  ok(Math.abs(mean - 0.5) < 0.03, `numbers are evenly spread (mean ${mean.toFixed(3)})`);
  ok(normalizeSeed('  hello   world ') === 'hello world', 'extra spaces are tidied');
  ok(createPiece('  hello   world ').title === createPiece('hello world').title, 'tidied seeds make the same art');
  ok(createPiece('Hello').seed !== createPiece('hello').seed, 'seeds stay case-sensitive');
}

// ── Determinism ──────────────────────────────────────────────
const fingerprint = (p, t) => { const c = fakeCtx(); p.draw(c, 400, Math.round(400 / p.aspect), t); return c.stats.calls; };
for (const seed of ['hello', 'maisie', 'a', '🎨', 'The quick brown fox', '12345', '']) {
  const p1 = createPiece(seed), p2 = createPiece(seed);
  ok(p1.title === p2.title && p1.style === p2.style && p1.aspect === p2.aspect && p1.number === p2.number, `"${seed}": same seed → same title, style and shape`);
  ok(fingerprint(p1, 5) === fingerprint(p2, 5), `"${seed}": same seed → the same drawing`);
}

// ── Variety ──────────────────────────────────────────────────
{
  const styles = new Set(), titles = new Set(), aspects = new Set(), moods = new Set(), dark = { yes: 0, no: 0 };
  const N = 600;
  for (let i = 0; i < N; i++) {
    const p = createPiece('seed-' + i);
    styles.add(p.style); titles.add(p.title); aspects.add(p.aspect.toFixed(3)); moods.add(p.mood);
    dark[p.dark ? 'yes' : 'no']++;
  }
  ok(styles.size === STYLES.length, `all ${STYLES.length} styles turn up (${styles.size})`);
  ok(titles.size > N * 0.5, `titles are varied (${titles.size} different in ${N})`);
  ok(aspects.size >= 6, `pieces come in different shapes (${aspects.size})`);
  ok(moods.size >= 6, `colour moods vary (${moods.size})`);
  ok(dark.yes > N * 0.2 && dark.no > N * 0.2, `both dark and light pieces appear (${dark.yes} / ${dark.no})`);
}

// ── Every style draws cleanly, over time and at any size ─────
{
  const seen = {};
  for (let i = 0; i < 400; i++) {
    const p = createPiece('check ' + i);
    for (const t of [0, 0.4, 3, 9, 25, 600]) {
      for (const h of [64, 520]) {
        const c = fakeCtx();
        let threw = null;
        try { p.draw(c, Math.round(h * p.aspect), h, t); } catch (e) { threw = e; }
        seen[p.style] = (seen[p.style] || 0) + 1;
        if (threw) ok(false, `${p.style} "check ${i}" t=${t}: threw ${threw.message}`);
        else if (c.stats.bad.length) ok(false, `${p.style} "check ${i}" t=${t}: bad number ${c.stats.bad[0]}`);
        else if (c.stats.calls < (t < 0.5 ? 1 : 5)) ok(false, `${p.style} "check ${i}" t=${t}: hardly drew anything`);
        else pass++;
      }
    }
  }
  ok(Object.keys(seen).length === STYLES.length, 'every style was exercised');
}

// ── Titles read like wall labels ─────────────────────────────
for (let i = 0; i < 300; i++) {
  const p = createPiece('t' + i);
  if (!/^(The )?[A-Z][a-z]+ [A-Z][a-z]+$/.test(p.title)) { ok(false, `odd title "${p.title}"`); break; }
}
ok(true, 'titles are a colour word plus a word');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
