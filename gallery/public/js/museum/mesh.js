// Turns one region of the floor plan into a single block-built mesh: floor,
// ceiling, and walls stacked from unit cubes. Everything is flat-coloured with
// a little per-block variation (that's the voxel look) and lit by baking the
// ceiling lamps into the vertex colours, so drawing it costs almost nothing.

import * as THREE from 'three';
import { CELL, REGION, REGION_CELLS, WALL_H } from './world.js';
import { hash01 } from '../art/rng.js';

const fdiv = (a, b) => Math.floor(a / b);
const LAMP_REACH = 7;

export function buildRegionMesh(world, rx, rz) {
  const theme = world.region(rx, rz).theme;
  const wallC = new THREE.Color(theme[0]), floorA = new THREE.Color(theme[1]), floorB = new THREE.Color(theme[2]), ceilC = new THREE.Color(theme[3]);
  const lampC = new THREE.Color('#fff1c9');

  // Which cells around this region have a lamp (a cell's lamp hangs over its middle).
  const c0x = rx * REGION_CELLS - 1, c0z = rz * REGION_CELLS - 1, span = REGION_CELLS + 2;
  const lamps = new Uint8Array(span * span);
  for (let z = 0; z < span; z++) for (let x = 0; x < span; x++) lamps[z * span + x] = world.lamp(c0x + x, c0z + z) ? 1 : 0;
  const light = (x, y, z) => {
    const cx = fdiv(x, CELL), cz = fdiv(z, CELL);
    let sum = 0.5;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const lx = cx + dx - c0x, lz = cz + dz - c0z;
        if (lx < 0 || lz < 0 || lx >= span || lz >= span || !lamps[lz * span + lx]) continue;
        const d = Math.hypot(x - ((cx + dx) * CELL + 2.5), y - (WALL_H - 0.3), z - ((cz + dz) * CELL + 2.5));
        const f = Math.max(0, 1 - d / LAMP_REACH);
        sum += f * f * 0.75;
      }
    }
    return Math.min(1.2, sum);
  };

  const pos = [], col = [], idx = [];
  let vcount = 0;
  const tmp = new THREE.Color();
  // One unit quad: origin o, edge vectors u and v (u x v is the outward normal).
  const quad = (ox, oy, oz, ux, uy, uz, vx, vy, vz, base, shade, noise, lampy) => {
    const pts = [[ox, oy, oz], [ox + ux, oy + uy, oz + uz], [ox + ux + vx, oy + uy + vy, oz + uz + vz], [ox + vx, oy + vy, oz + vz]];
    for (const [x, y, z] of pts) {
      pos.push(x, y, z);
      if (lampy) tmp.copy(lampC);
      else tmp.copy(base).multiplyScalar(shade * noise * light(x, y, z));
      col.push(tmp.r, tmp.g, tmp.b);
    }
    idx.push(vcount, vcount + 1, vcount + 2, vcount, vcount + 2, vcount + 3);
    vcount += 4;
  };

  const x0 = rx * REGION, z0 = rz * REGION;
  for (let bz = z0; bz < z0 + REGION; bz++) {
    for (let bx = x0; bx < x0 + REGION; bx++) {
      if (world.solid(bx, bz)) {
        const n = (f, r) => 0.93 + 0.14 * hash01(bx * 5 + f, bz, r * 17 + f);
        for (let row = 0; row < WALL_H; row++) {
          const ao = row === 0 ? 0.8 : row === WALL_H - 1 ? 0.88 : 1;
          if (!world.solid(bx, bz - 1)) quad(bx + 1, row, bz, -1, 0, 0, 0, 1, 0, wallC, 0.86 * ao, n(0, row));
          if (!world.solid(bx, bz + 1)) quad(bx, row, bz + 1, 1, 0, 0, 0, 1, 0, wallC, 0.86 * ao, n(1, row));
          if (!world.solid(bx - 1, bz)) quad(bx, row, bz, 0, 0, 1, 0, 1, 0, wallC, 0.7 * ao, n(2, row));
          if (!world.solid(bx + 1, bz)) quad(bx + 1, row, bz + 1, 0, 0, -1, 0, 1, 0, wallC, 0.7 * ao, n(3, row));
        }
      } else {
        const near = world.solid(bx - 1, bz) || world.solid(bx + 1, bz) || world.solid(bx, bz - 1) || world.solid(bx, bz + 1);
        const nz = 0.94 + 0.12 * hash01(bx, bz, 3);
        quad(bx, 0, bz, 0, 0, 1, 1, 0, 0, ((bx + bz) & 1) ? floorA : floorB, near ? 0.82 : 1, nz);
        const cx = fdiv(bx, CELL), cz = fdiv(bz, CELL);
        const isLamp = bx - cx * CELL === 2 && bz - cz * CELL === 2 && world.lamp(cx, cz);
        quad(bx, WALL_H, bz, 1, 0, 0, 0, 0, 1, ceilC, 0.8, 0.95 + 0.1 * hash01(bx, bz, 5), isLamp);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true }));
  mesh.matrixAutoUpdate = false;
  return mesh;
}
