// The visitor's book, seen from inside the museum: notes other people left
// stand around as little wooden signs where they were written, and you can
// leave your own. The server side is src/book.js.

import * as THREE from 'three';
import { REGION } from './world.js';

const MAX_SIGNS = 80;           // standing signs drawn at once (the nearest)
const SEE = 70;                 // ...and only within this many blocks

// ── Talking to the server ────────────────────────────────────

async function call(path, init) {
  const res = await fetch(path, init);
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, body };
}

export async function fetchNear(x, z) {
  try {
    const { body } = await call(`api/book?rx=${Math.floor(x / REGION)}&rz=${Math.floor(z / REGION)}&r=1`);
    return body?.entries || null;
  } catch { return null; }
}

export async function fetchFarthest(limit = 8) {
  try {
    const { body } = await call(`api/book/farthest?limit=${limit}`);
    return body?.entries || null;
  } catch { return null; }
}

// -> { ok: true, entry } or { ok: false, say }
export async function leaveNote({ name, msg, x, z }) {
  try {
    const { status, body } = await call('api/book', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, msg, x, z }) });
    if (body?.ok) return body;
    return { ok: false, say: body?.say || (status === 429 ? 'One moment, then try again.' : 'That didn’t work — try again in a moment.') };
  } catch { return { ok: false, say: 'Can’t reach the book right now — are you online?' }; }
}

export function ago(ts, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 60) return `${Math.round(s / 86400)} days ago`;
  return `${Math.round(s / (86400 * 30))} months ago`;
}

// ── Signs in the world ───────────────────────────────────────

const postGeo = new THREE.BoxGeometry(0.1, 1.05, 0.1);
const plateGeo = new THREE.BoxGeometry(0.96, 0.44, 0.06);
const wood = new THREE.MeshBasicMaterial({ color: 0x8b5a2b });
const paper = new THREE.MeshBasicMaterial({ color: 0xcdbf9f });

function nameTexture(name) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 112;
  const g = c.getContext('2d');
  g.fillStyle = '#ece3cc'; g.fillRect(0, 0, 256, 112);
  g.strokeStyle = '#8b5a2b'; g.lineWidth = 8; g.strokeRect(4, 4, 248, 104);
  g.fillStyle = '#5a3b1d';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  let size = 44;
  g.font = `700 ${size}px Georgia, serif`;
  while (g.measureText(name).width > 220 && size > 16) { size -= 2; g.font = `700 ${size}px Georgia, serif`; }
  g.fillText(name, 128, 46);
  g.font = 'italic 24px Georgia, serif';
  g.fillStyle = '#7c6240';
  g.fillText('was here', 128, 86);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = false;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  return t;
}

export class Signs {
  constructor(scene) {
    this.scene = scene;
    this.items = new Map();     // note id -> { entry, group, tex, mat }
    this.current = null;        // the sign you are looking at
  }

  // Make the standing signs match `entries` (nearest MAX_SIGNS to the visitor).
  sync(entries, px, pz) {
    const near = entries
      .map((e) => ({ e, d2: (e.x - px) ** 2 + (e.z - pz) ** 2 }))
      .filter((o) => o.d2 < SEE * SEE)
      .sort((a, b) => a.d2 - b.d2)
      .slice(0, MAX_SIGNS);
    const keep = new Set(near.map((o) => o.e.id));
    for (const id of [...this.items.keys()]) if (!keep.has(id)) this.remove(id);
    for (const { e } of near) if (!this.items.has(e.id)) this.add(e);
  }

  add(entry) {
    if (this.items.has(entry.id)) return;
    const group = new THREE.Group();
    group.position.set(entry.x, 0, entry.z);
    const post = new THREE.Mesh(postGeo, wood);
    post.position.y = 0.52;
    const tex = nameTexture(entry.name);
    const front = new THREE.MeshBasicMaterial({ map: tex });
    const plate = new THREE.Mesh(plateGeo, [paper, paper, paper, paper, front, paper]);
    plate.position.y = 1.2;
    group.add(post, plate);
    this.scene.add(group);
    this.items.set(entry.id, { entry, group, tex, front });
  }

  remove(id) {
    const it = this.items.get(id);
    if (!it) return;
    this.scene.remove(it.group);
    it.tex.dispose();
    it.front.dispose();
    this.items.delete(id);
  }

  // Turn every sign to face the visitor, and work out which one they are reading.
  update(px, pz, fx, fz) {
    let best = null, bestScore = 0;
    for (const it of this.items.values()) {
      const dx = it.entry.x - px, dz = it.entry.z - pz;
      it.group.rotation.y = Math.atan2(-dx, -dz);
      const d = Math.hypot(dx, dz);
      if (d > 5 || d < 0.2) continue;
      const facing = (dx * fx + dz * fz) / d;
      if (facing < 0.93) continue;
      const score = facing - d * 0.02;
      if (score > bestScore) { bestScore = score; best = it.entry; }
    }
    this.current = best;
    return best;
  }

  clear() { for (const id of [...this.items.keys()]) this.remove(id); this.current = null; }
}
