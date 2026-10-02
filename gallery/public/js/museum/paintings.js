// Hangs the generated art on the walls. A painting is only a flat panel until
// you are near it; then it gets a small texture, and as you come close a bigger
// one. The few nearest pieces are redrawn live, so the walls around you move.

import * as THREE from 'three';
import { createPiece, SETTLE_SECONDS } from '../art/index.js';

const PAD = 0.16;                 // frame + mat, in world units, on every side
const SHOW = 46, HIDE = 56;       // paintings exist as panels within this distance
const TIER1 = 42, TIER2 = 13;     // distance for a small texture, for a big one
const LIVE_DIST = 9, LIVE_MAX = 4, LIVE_EVERY_MS = 70;
const PX_PER_UNIT = { 1: 40, 2: 130 };

const plane = new THREE.PlaneGeometry(1, 1);

function drawFramed(ctx, piece, W, H, padPx, t) {
  ctx.fillStyle = '#17171a';
  ctx.fillRect(0, 0, W, H);
  const f = padPx * 0.3;
  ctx.fillStyle = '#f3f0e8';
  ctx.fillRect(f, f, W - 2 * f, H - 2 * f);
  ctx.save();
  ctx.translate(padPx, padPx);
  piece.draw(ctx, W - 2 * padPx, H - 2 * padPx, t);
  ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,.35)';
  ctx.lineWidth = Math.max(1, padPx * 0.06);
  ctx.strokeRect(padPx, padPx, W - 2 * padPx, H - 2 * padPx);
}

export class Paintings {
  constructor(scene, maxAniso = 1) {
    this.scene = scene;
    this.regions = new Map();   // "rx,rz" -> [defs]
    this.items = new Map();     // painting id -> live item
    this.sinceRefresh = 1e9;
    this.liveClock = 0;
    this.maxAniso = maxAniso;
    this.live = [];
    this.current = null;        // the painting being looked at
  }

  addRegion(rx, rz, defs) { this.regions.set(rx + ',' + rz, defs); }
  removeRegion(rx, rz) {
    const key = rx + ',' + rz;
    for (const d of this.regions.get(key) || []) this.drop(d.id);
    this.regions.delete(key);
  }

  make(def) {
    const w = def.aw + 2 * PAD, h = def.ah + 2 * PAD;
    const mat = new THREE.MeshBasicMaterial({ color: 0x2a2a2e });
    const mesh = new THREE.Mesh(plane, mat);
    mesh.position.set(def.x, def.y, def.z);
    mesh.rotation.y = Math.atan2(def.nx, def.nz);
    mesh.scale.set(w, h, 1);
    this.scene.add(mesh);
    const item = { def, mesh, mat, tier: 0, tex: null, canvas: null, piece: null, d2: 0, lastLive: 0, w, h };
    this.items.set(def.id, item);
    return item;
  }

  drop(id) {
    const it = this.items.get(id);
    if (!it) return;
    this.scene.remove(it.mesh);
    it.mat.dispose();
    it.tex?.dispose();
    this.items.delete(id);
  }

  // Paint the item at texture tier 1 (small) or 2 (big); `t` seconds into its life.
  paint(it, tier, t) {
    const k = PX_PER_UNIT[tier];
    const W = Math.max(24, Math.round(it.w * k)), H = Math.max(24, Math.round(it.h * k));
    if (!it.canvas || it.tier !== tier) {
      it.canvas = document.createElement('canvas');
      it.canvas.width = W; it.canvas.height = H;
      it.tex?.dispose();
      it.tex = new THREE.CanvasTexture(it.canvas);
      it.tex.colorSpace = THREE.SRGBColorSpace;
      it.tex.generateMipmaps = false;
      it.tex.minFilter = THREE.LinearFilter;
      it.tex.magFilter = THREE.LinearFilter;
      it.mat.map = it.tex;
      it.mat.color.set(0xffffff);
      it.mat.needsUpdate = true;
      it.tier = tier;
    }
    if (!it.piece) it.piece = createPiece(it.def.seed);
    drawFramed(it.canvas.getContext('2d'), it.piece, W, H, Math.round(PAD * k), t);
    it.tex.needsUpdate = true;
  }

  // px, pz: where the visitor is; fx, fz: the way they face (unit vector).
  update(px, pz, fx, fz, now, dt) {
    this.sinceRefresh += dt * 1000;
    if (this.sinceRefresh > 250) {
      this.sinceRefresh = 0;
      for (const defs of this.regions.values()) {
        for (const def of defs) {
          const d2 = (def.x - px) ** 2 + (def.z - pz) ** 2;
          const it = this.items.get(def.id);
          if (it) it.d2 = d2;
          if (d2 < SHOW * SHOW) { if (!it) this.make(def).d2 = d2; }
          else if (it && d2 > HIDE * HIDE) this.drop(def.id);
        }
      }
    }

    // Texture jobs, nearest first (small before big), as many as fit in a
    // few milliseconds - at least one per frame, so nothing ever starves.
    const t0 = SETTLE_SECONDS + 3;
    const started = performance.now();
    do {
      let job = null, best = Infinity;
      for (const it of this.items.values()) {
        const want = it.d2 < TIER2 * TIER2 ? 2 : it.d2 < TIER1 * TIER1 ? 1 : 0;
        if (want > it.tier && it.d2 < best) { best = it.d2; job = [it, want]; }
      }
      if (!job) break;
      this.paint(job[0], job[1], t0 + now / 1000);
    } while (performance.now() - started < 5);

    // The nearest few big paintings in front of you keep moving.
    this.live.length = 0;
    for (const it of this.items.values()) {
      if (it.tier !== 2 || it.d2 > LIVE_DIST * LIVE_DIST) continue;
      const dx = it.def.x - px, dz = it.def.z - pz;
      if (dx * fx + dz * fz < -1) continue;     // behind you
      this.live.push(it);
    }
    this.live.sort((a, b) => a.d2 - b.d2);
    for (const it of this.live.slice(0, LIVE_MAX)) {
      if (now - it.lastLive < LIVE_EVERY_MS) continue;
      it.lastLive = now;
      this.paint(it, 2, t0 + now / 1000);
    }

    // What are you looking at?
    let seen = null, bestScore = 0;
    for (const it of this.items.values()) {
      if (it.d2 > 36) continue;
      const d = Math.sqrt(it.d2) || 0.01;
      const dx = (it.def.x - px) / d, dz = (it.def.z - pz) / d;
      const facing = dx * fx + dz * fz;                         // toward it
      const front = -(it.def.nx * fx + it.def.nz * fz);          // it faces you
      if (facing < 0.88 || front < 0.25) continue;
      const score = facing - d * 0.01;
      if (score > bestScore) { bestScore = score; seen = it; }
    }
    this.current = seen ? seen.def : null;
  }

  clear() {
    for (const id of [...this.items.keys()]) this.drop(id);
    this.regions.clear();
    this.current = null;
  }
}
