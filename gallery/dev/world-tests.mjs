// The museum floor plan, checked in Node.   node dev/world-tests.mjs
import { createWorld, MUSEUM_SEED, CELL, REGION, WALL_H } from '../public/js/museum/world.js';
import { createPiece } from '../public/js/art/index.js';

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) pass++; else { fail++; console.log('  ✗ ' + l); } };

const SEEDS = ['museum', 'maisie', 'a', 'velvet orchard 12', '🎨', 'x'.repeat(40)];

for (const seed of SEEDS) {
  const w = createWorld(seed);
  const R = 2;                       // regions -R..R around the start
  const lo = -R * REGION, hi = (R + 1) * REGION;

  // Every floor block in the area can be walked to from the start.
  const key = (x, z) => (x - lo) * (hi - lo) + (z - lo);
  const seen = new Uint8Array((hi - lo) * (hi - lo));
  const sx = Math.floor(w.spawn.x), sz = Math.floor(w.spawn.z);
  ok(!w.solid(sx, sz), `${seed}: the start is not inside a wall`);
  const q = [[sx, sz]]; seen[key(sx, sz)] = 1;
  let reached = 1;
  while (q.length) {
    const [x, z] = q.pop();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (nx < lo || nx >= hi || nz < lo || nz >= hi || seen[key(nx, nz)] || w.solid(nx, nz)) continue;
      seen[key(nx, nz)] = 1; reached++; q.push([nx, nz]);
    }
  }
  let floor = 0;
  for (let x = lo; x < hi; x++) for (let z = lo; z < hi; z++) if (!w.solid(x, z)) floor++;
  ok(reached === floor, `${seed}: every one of ${floor} floor blocks is reachable (${reached})`);
  ok(floor > (hi - lo) ** 2 * 0.45, `${seed}: the museum is mostly space to walk (${(floor / (hi - lo) ** 2 * 100).toFixed(0)}% floor)`);

  // Corridors are wide enough to walk: every cell interior is a 3x3 floor.
  let narrow = 0;
  for (let cx = -8; cx < 8; cx++) for (let cz = -8; cz < 8; cz++) {
    for (let lx = 1; lx < CELL; lx++) for (let lz = 1; lz < CELL; lz++) if (w.solid(cx * CELL + lx, cz * CELL + lz)) narrow++;
  }
  ok(narrow === 0, `${seed}: cell interiors are always open floor`);

  // The same seed makes the same museum.
  const w2 = createWorld(seed);
  let same = true;
  for (let x = lo; x < lo + 160 && same; x++) for (let z = lo; z < lo + 160; z++) if (w.solid(x, z) !== w2.solid(x, z)) { same = false; break; }
  ok(same, `${seed}: rebuilding gives the identical floor plan`);
  ok(JSON.stringify(w.paintings(1, -1)) === JSON.stringify(w2.paintings(1, -1)), `${seed}: ... and the identical paintings`);

  // Every region type turns up near the start, over a wider area.
  const types = new Set();
  for (let rz = -6; rz <= 6; rz++) for (let rx = -6; rx <= 6; rx++) types.add(w.region(rx, rz).type);
  ok(types.size === 4, `${seed}: mazes, rooms, halls and winding galleries all appear (${[...types].join(',')})`);

  // Paintings: on a wall face with open floor in front, never in a doorway.
  let bad = 0, count = 0, ids = new Set();
  for (let rz = -1; rz <= 1; rz++) for (let rx = -1; rx <= 1; rx++) {
    for (const p of w.paintings(rx, rz)) {
      count++;
      if (ids.has(p.id)) bad++;
      ids.add(p.id);
      // a point a little way in front of the painting must be floor, one behind must be wall
      const fx = Math.floor(p.x + p.nx * 0.6), fz = Math.floor(p.z + p.nz * 0.6);
      const bx = Math.floor(p.x - p.nx * 0.5), bz = Math.floor(p.z - p.nz * 0.5);
      if (w.solid(fx, fz) || !w.solid(bx, bz)) bad++;
      if (!(p.aw > 0.5 && p.aw <= 2.31 && p.ah > 0.5 && p.ah <= 2.01)) bad++;
    }
  }
  ok(bad === 0, `${seed}: all ${count} paintings hang on a wall, facing open floor, at a sensible size`);
  ok(count > 300, `${seed}: plenty of art (${count} paintings in 9 regions)`);
}

// The founder's piece carries the museum seed itself, facing the start.
{
  const w = createWorld('my museum');
  const f = w.paintings(0, 0).find((p) => p.founder);
  ok(f && f.seed === 'my museum', 'the entrance wall shows the visitor\'s own seed');
  ok(f && f.nz === 1 && Math.abs(f.x - w.spawn.x) < 0.01 && f.z < w.spawn.z, 'the entrance piece is straight ahead of the start');
  ok(f && f.y > 1.5 && f.y < WALL_H - 1, 'the entrance piece hangs at eye height');
}

// Different seeds are different museums.
{
  const a = createWorld('one'), b = createWorld('two');
  let diff = 0;
  for (let x = 0; x < 160; x++) for (let z = 0; z < 160; z++) if (a.solid(x, z) !== b.solid(x, z)) diff++;
  ok(diff > 2000, `different seeds give different floor plans (${diff} blocks differ)`);
}

// ── The one museum must never change ────────────────────────
// Everyone walks the same building, so these fingerprints are a promise: if a
// code change alters the floor plan or what hangs where, this fails. Only
// update the numbers on purpose - doing so reshuffles the museum for everyone.
{
  const fnv = (str, h = 2166136261) => { for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; };
  const w = createWorld(MUSEUM_SEED);
  let plan = '';
  for (let z = -2 * REGION; z < 3 * REGION; z++) { let row = ''; for (let x = -2 * REGION; x < 3 * REGION; x++) row += w.solid(x, z) ? '1' : '0'; plan += row + '\n'; }
  const art = [];
  for (let rz = -1; rz <= 1; rz++) for (let rx = -1; rx <= 1; rx++) for (const p of w.paintings(rx, rz)) art.push(`${p.id}|${p.seed}|${p.aspect}|${createPiece(p.seed).title}`);
  const far = createWorld(MUSEUM_SEED);
  let farPlan = '';
  for (let z = 100000; z < 100000 + 120; z++) for (let x = -777777; x < -777777 + 120; x++) farPlan += far.solid(x, z) ? '1' : '0';
  const got = { plan: fnv(plan), art: fnv(art.join('\n')), count: art.length, far: fnv(farPlan) };
  const want = { plan: 108403424, art: 1154008385, count: 901, far: 2384428015 };
  ok(JSON.stringify(got) === JSON.stringify(want), `the museum is exactly as it always was ${JSON.stringify(got)}${JSON.stringify(got) === JSON.stringify(want) ? '' : ' (expected ' + JSON.stringify(want) + ')'}`);
  ok(MUSEUM_SEED === 'the museum', 'the museum seed has not been changed');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
