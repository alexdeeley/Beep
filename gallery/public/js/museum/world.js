// The museum's floor plan. A pure function of the museum seed: any place can
// be worked out on demand, nothing is stored, and everyone who uses the same
// seed walks the same museum.
//
// Everything sits on a grid of unit blocks. Blocks are grouped into CELLS of
// CELL x CELL (3x3 of floor, plus a wall strip on the cell's north and west
// sides) and cells into REGIONS of REGION_CELLS x REGION_CELLS, each its own
// kind of space - a maze of art walls, a run of rooms, a big open hall, or a
// long winding gallery. A region only decides which of its cell walls are
// open; the rest (wall blocks, pillars, paintings) follows from that.
//
// Connectivity is guaranteed by construction: every region is connected
// inside, and every region border has at least one doorway.

import { makeRng, fork, normalizeSeed, hash01 } from '../art/rng.js';
import { createPiece } from '../art/index.js';

export const CELL = 4;
export const REGION_CELLS = 10;
export const REGION = CELL * REGION_CELLS;   // blocks per region side
export const WALL_H = 6;                     // wall / ceiling height, in blocks

const fdiv = (a, b) => Math.floor(a / b);
const N = REGION_CELLS;

// Looks for the walls and floors, one per kind of region mood.
// [wall, floor A, floor B, ceiling]
const THEMES = [
  ['#e8e2d4', '#8a6a4a', '#7b5c3e', '#cfc8b8'],   // ivory and oak
  ['#3d6b70', '#2b3f44', '#26383d', '#1f2d30'],   // slate teal
  ['#c4785a', '#5a3a2e', '#4f3228', '#8a5a46'],   // terracotta
  ['#a9b79a', '#d9d5c3', '#cdc8b4', '#8d9a80'],   // sage
  ['#26304f', '#11152a', '#171c36', '#0e1224'],   // midnight
  ['#e8c3c1', '#f4efe9', '#e6dcd3', '#d9aeab'],   // blush
  ['#4a4a4f', '#2a2a2e', '#232327', '#1c1c1f'],   // charcoal
  ['#d9b24a', '#5b4630', '#4f3d2a', '#a98a35'],   // mustard
  ['#f4f4f2', '#bdbdb8', '#b2b2ad', '#e6e6e2'],   // white cube
  ['#8f4a3c', '#3f3a34', '#363029', '#6a372d'],   // brick
  ['#5f7f5a', '#e2dcc8', '#d3ccb4', '#46603f'],   // moss
  ['#6a4e8c', '#2c2438', '#251f31', '#4a3866'],   // plum
];

const TYPES = [['maze', 3], ['rooms', 3], ['hall', 2], ['winding', 2]];

// ── Region generators ────────────────────────────────────────
// Each fills `r.openN` / `r.openW` (1 = open, 0 = wall) for the region's
// interior edges and leaves the border edges (row 0 / column 0) alone.

const idx = (x, z) => z * N + x;

function carveMaze(r, rng, straight) {
  const seen = new Uint8Array(N * N);
  const stack = [];
  const sx = rng.int(0, N - 1), sz = rng.int(0, N - 1);
  seen[idx(sx, sz)] = 1;
  stack.push([sx, sz, -1]);
  const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  while (stack.length) {
    const [x, z, last] = stack[stack.length - 1];
    const options = [];
    for (let d = 0; d < 4; d++) {
      const nx = x + dirs[d][0], nz = z + dirs[d][1];
      if (nx >= 0 && nx < N && nz >= 0 && nz < N && !seen[idx(nx, nz)]) options.push(d);
    }
    if (!options.length) { stack.pop(); continue; }
    const d = last >= 0 && options.includes(last) && rng.chance(straight) ? last : rng.pick(options);
    const nx = x + dirs[d][0], nz = z + dirs[d][1];
    openBetween(r, x, z, nx, nz);
    seen[idx(nx, nz)] = 1;
    stack.push([nx, nz, d]);
  }
}

function openBetween(r, x0, z0, x1, z1) {
  if (x1 === x0 + 1) r.openW[idx(x1, z0)] = 1;
  else if (x1 === x0 - 1) r.openW[idx(x0, z0)] = 1;
  else if (z1 === z0 + 1) r.openN[idx(x0, z1)] = 1;
  else r.openN[idx(x0, z0)] = 1;
}

// Splits the region into rooms (each fully open inside) and joins neighbouring
// rooms with doorways until they are all connected.
function carveRooms(r, rng, minSize, splitOdds) {
  const rooms = [];
  const split = (x, z, w, h) => {
    const canW = w >= minSize * 2, canH = h >= minSize * 2;
    if ((!canW && !canH) || (w * h <= minSize * minSize * 2 && !rng.chance(splitOdds * 0.4))) { rooms.push({ x, z, w, h }); return; }
    const vertical = canW && (!canH || w > h || (w === h && rng.chance(0.5)));
    if (vertical) {
      const at = rng.int(minSize, w - minSize);
      split(x, z, at, h); split(x + at, z, w - at, h);
    } else {
      const at = rng.int(minSize, h - minSize);
      split(x, z, w, at); split(x, z + at, w, h - at);
    }
  };
  split(0, 0, N, N);
  const roomOf = new Int16Array(N * N);
  rooms.forEach((rm, i) => { for (let z = rm.z; z < rm.z + rm.h; z++) for (let x = rm.x; x < rm.x + rm.w; x++) roomOf[idx(x, z)] = i; });
  // open everything inside rooms
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      if (x > 0 && roomOf[idx(x, z)] === roomOf[idx(x - 1, z)]) r.openW[idx(x, z)] = 1;
      if (z > 0 && roomOf[idx(x, z)] === roomOf[idx(x, z - 1)]) r.openN[idx(x, z)] = 1;
    }
  }
  // candidate doorways between different rooms
  const pairs = new Map();
  const add = (a, b, edge) => {
    const key = a < b ? a + ',' + b : b + ',' + a;
    if (!pairs.has(key)) pairs.set(key, { a, b, edges: [] });
    pairs.get(key).edges.push(edge);
  };
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      if (x > 0 && roomOf[idx(x, z)] !== roomOf[idx(x - 1, z)]) add(roomOf[idx(x, z)], roomOf[idx(x - 1, z)], ['W', x, z]);
      if (z > 0 && roomOf[idx(x, z)] !== roomOf[idx(x, z - 1)]) add(roomOf[idx(x, z)], roomOf[idx(x, z - 1)], ['N', x, z]);
    }
  }
  const parent = rooms.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const open = ([kind, x, z]) => { (kind === 'W' ? r.openW : r.openN)[idx(x, z)] = 1; };
  for (const p of rng.shuffle([...pairs.values()])) {
    const joined = find(p.a) !== find(p.b);
    if (joined || rng.chance(0.22)) {
      open(rng.pick(p.edges));
      if (joined) parent[find(p.a)] = find(p.b);
    }
  }
}

// Is every cell still reachable from cell 0, given the open edges?
function connected(r) {
  const seen = new Uint8Array(N * N);
  const q = [0]; seen[0] = 1;
  let n = 1;
  while (q.length) {
    const c = q.pop(), x = c % N, z = (c / N) | 0;
    const tryGo = (nx, nz, open) => {
      if (!open || nx < 0 || nx >= N || nz < 0 || nz >= N || seen[idx(nx, nz)]) return;
      seen[idx(nx, nz)] = 1; n++; q.push(idx(nx, nz));
    };
    tryGo(x + 1, z, x + 1 < N && r.openW[idx(x + 1, z)]);
    tryGo(x - 1, z, x > 0 && r.openW[idx(x, z)]);
    tryGo(x, z + 1, z + 1 < N && r.openN[idx(x, z + 1)]);
    tryGo(x, z - 1, z > 0 && r.openN[idx(x, z)]);
  }
  return n === N * N;
}

// A big open hall: all walls down, with some columns and short free-standing
// walls to hang art on.
function carveHall(r, rng) {
  r.openN.fill(1); r.openW.fill(1);
  for (let z = 1; z < N; z++) for (let x = 1; x < N; x++) if (rng.chance(0.28)) r.pillars[idx(x, z)] = 1;
  const segments = rng.int(3, 6);
  for (let s = 0; s < segments; s++) {
    const vertical = rng.chance(0.5), len = rng.int(1, 3);
    const x = rng.int(2, N - 3), z = rng.int(2, N - 3);
    const cells = [];
    for (let i = 0; i < len; i++) cells.push(vertical ? idx(x, z + i) : idx(x + i, z));
    if (cells.some((c) => (vertical ? !r.openW[c] : !r.openN[c]))) continue;   // keep walls from touching
    // Keep the front of the home hall clear (where visitors arrive).
    if (r.rx === 0 && r.rz === 0 && cells.some((c) => { const cx = c % N, cz = (c / N) | 0; return cx >= 3 && cx <= 7 && cz >= 3 && cz <= 8; })) continue;
    for (const c of cells) (vertical ? r.openW : r.openN)[c] = 0;
    if (!connected(r)) for (const c of cells) (vertical ? r.openW : r.openN)[c] = 1;
  }
}

// ── The world ────────────────────────────────────────────────

export function createWorld(seedText) {
  const seed = normalizeSeed(seedText) || 'museum';
  const regions = new Map();

  function makeRegion(rx, rz) {
    const rng = fork(seed, `region:${rx},${rz}`);
    const home = rx === 0 && rz === 0;
    const type = home ? 'hall' : rng.weighted(TYPES);
    const r = {
      rx, rz, type,
      openN: new Uint8Array(N * N), openW: new Uint8Array(N * N), pillars: new Uint8Array(N * N),
      theme: THEMES[Math.floor(hash01(rx, rz, 7) * THEMES.length)],
      lamps: 0.45 + rng.float() * 0.5,
    };
    if (type === 'maze') carveMaze(r, rng, 0.35);
    else if (type === 'winding') carveMaze(r, rng, 0.92);
    else if (type === 'rooms') carveRooms(r, rng, 2, 0.8);
    else carveHall(r, rng);
    // Doorways on the west and north borders (the east and south borders are
    // the neighbours' doorways, so every border always has some).
    const doors = type === 'hall' ? rng.int(2, 4) : rng.int(1, 3);
    for (let i = 0; i < doors; i++) { r.openW[idx(0, rng.int(0, N - 1))] = 1; r.openN[idx(rng.int(0, N - 1), 0)] = 1; }
    // Home hall: a free-standing wall a little way ahead of the starting spot,
    // which carries the visitor's own seed.
    if (home) { r.openN[idx(5, 5)] = 0; r.openN[idx(4, 5)] = 1; r.openN[idx(6, 5)] = 1; r.openW[idx(5, 5)] = 1; r.openW[idx(6, 5)] = 1; }
    return r;
  }

  function region(rx, rz) {
    const key = rx + ',' + rz;
    let r = regions.get(key);
    if (!r) {
      if (regions.size > 600) regions.clear();
      r = makeRegion(rx, rz);
      regions.set(key, r);
    }
    return r;
  }

  // Open-ness of a cell's north / west wall strip, by global cell coordinates.
  function cellEdge(cx, cz, which) {
    const rx = fdiv(cx, N), rz = fdiv(cz, N);
    const r = region(rx, rz);
    const i = idx(cx - rx * N, cz - rz * N);
    return which === 'N' ? r.openN[i] === 1 : r.openW[i] === 1;
  }
  const openN = (cx, cz) => cellEdge(cx, cz, 'N');
  const openW = (cx, cz) => cellEdge(cx, cz, 'W');
  function pillar(cx, cz) {
    const rx = fdiv(cx, N), rz = fdiv(cz, N);
    return region(rx, rz).pillars[idx(cx - rx * N, cz - rz * N)] === 1;
  }

  // Is the block at (bx, bz) solid wall?
  function solid(bx, bz) {
    const cx = fdiv(bx, CELL), cz = fdiv(bz, CELL);
    const lx = bx - cx * CELL, lz = bz - cz * CELL;
    if (lx === 0 && lz === 0) {
      return !(openN(cx, cz) && openN(cx - 1, cz) && openW(cx, cz) && openW(cx, cz - 1)) || pillar(cx, cz);
    }
    if (lz === 0) return !openN(cx, cz);
    if (lx === 0) return !openW(cx, cz);
    return false;
  }

  // A ceiling lamp over the middle of this cell?
  function lamp(cx, cz) {
    const r = region(fdiv(cx, N), fdiv(cz, N));
    return hash01(cx, cz, 91) < r.lamps;
  }

  // Paintings hang on both faces of every closed wall strip.
  // `face` is the unit normal pointing out of the wall, into the open space.
  function paintings(rx, rz) {
    const out = [];
    const r = region(rx, rz);
    for (let lz = 0; lz < N; lz++) {
      for (let lx = 0; lx < N; lx++) {
        const cx = rx * N + lx, cz = rz * N + lz;
        const x0 = cx * CELL, z0 = cz * CELL;
        for (const edge of ['N', 'W']) {
          if (edge === 'N' ? r.openN[idx(lx, lz)] : r.openW[idx(lx, lz)]) continue;
          for (const side of [0, 1]) {
            const founder = rx === 0 && rz === 0 && lx === 5 && lz === 5 && edge === 'N' && side === 1;
            if (!founder && hash01(cx, cz, edge === 'N' ? 11 + side : 21 + side) > 0.72) continue;
            const id = `${cx},${cz}:${edge}${side}`;
            const art = founder ? seed : `${seed}|${id}`;
            const info = createPiece(art);
            // Fit the artwork inside a box, then add the frame.
            const fit = Math.min(2.3 / info.aspect, 2.0);
            const ah = Math.min(fit, 2.0), aw = ah * info.aspect;
            if (edge === 'N') {
              out.push({ id, seed: art, founder, aspect: info.aspect, aw, ah, x: x0 + 2.5, y: 2.35, z: side ? z0 + 1.02 : z0 - 0.02, nx: 0, nz: side ? 1 : -1 });
            } else {
              out.push({ id, seed: art, founder, aspect: info.aspect, aw, ah, x: side ? x0 + 1.02 : x0 - 0.02, y: 2.35, z: z0 + 2.5, nx: side ? 1 : -1, nz: 0 });
            }
          }
        }
      }
    }
    return out;
  }

  return {
    seed, region, solid, lamp, paintings,
    // Where a visitor starts, and which way they face (-z is "north").
    spawn: { x: 5 * CELL + 2.5, z: 6 * CELL + 2.5, yaw: 0 },
  };
}
