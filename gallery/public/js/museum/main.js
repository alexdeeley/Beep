// The museum: an endless, walkable building of rooms, mazes and halls whose
// walls are hung with generated art. See world.js for how the floor plan is
// worked out and paintings.js for the art.

import * as THREE from 'three';
import { createWorld, REGION } from './world.js';
import { buildRegionMesh } from './mesh.js';
import { Paintings } from './paintings.js';
import { Controls } from './controls.js';
import { normalizeSeed } from '../art/rng.js';
import { randomSeed } from '../seeds.js';
import { createPiece } from '../art/index.js';

const $ = (id) => document.getElementById(id);
const EYE = 1.65, RADIUS = 0.3, WALK = 3.6, RUN = 6.5;
const FOG = 0x0d0d10;

// ── Three.js ─────────────────────────────────────────────────
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(FOG);
scene.fog = new THREE.Fog(FOG, 9, 44);
const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 90);
camera.rotation.order = 'YXZ';

let quality = (() => { try { return localStorage.getItem('museum.quality') || 'chunky'; } catch { return 'chunky'; } })();
function resize() {
  const w = innerWidth, h = innerHeight;
  // "chunky": a small picture scaled up with hard pixels, like the blocks themselves.
  const pr = quality === 'chunky' ? Math.min(1, 500 / h) * 1 : Math.min(devicePixelRatio || 1, 2, Math.sqrt(2.6e6 / (w * h)));
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  canvas.classList.toggle('chunky', quality === 'chunky');
  $('quality').textContent = quality === 'chunky' ? 'Look: chunky' : 'Look: sharp';
}
addEventListener('resize', resize);

// ── The world ────────────────────────────────────────────────
let world = null, paintings = null;
const loaded = new Map();     // "rx,rz" -> mesh
const player = { x: 0, z: 0, walked: 0 };
let seed = '';

function regionKey(rx, rz) { return rx + ',' + rz; }
function loadRegion(rx, rz) {
  const mesh = buildRegionMesh(world, rx, rz);
  scene.add(mesh);
  loaded.set(regionKey(rx, rz), mesh);
  paintings.addRegion(rx, rz, world.paintings(rx, rz));
}
function unloadRegion(rx, rz) {
  const key = regionKey(rx, rz), mesh = loaded.get(key);
  if (!mesh) return;
  scene.remove(mesh);
  mesh.geometry.dispose();
  mesh.material.dispose();
  loaded.delete(key);
  paintings.removeRegion(rx, rz);
}
function streamRegions(all = false) {
  const prx = Math.floor(player.x / REGION), prz = Math.floor(player.z / REGION);
  let built = 0;
  const wanted = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) wanted.push([prx + dx, prz + dz, Math.abs(dx) + Math.abs(dz)]);
  wanted.sort((a, b) => a[2] - b[2]);
  for (const [rx, rz] of wanted) {
    if (loaded.has(regionKey(rx, rz))) continue;
    loadRegion(rx, rz);
    if (!all && ++built >= 1) break;          // one region a frame while walking
  }
  for (const key of [...loaded.keys()]) {
    const [rx, rz] = key.split(',').map(Number);
    if (Math.max(Math.abs(rx - prx), Math.abs(rz - prz)) > 2) unloadRegion(rx, rz);
  }
}

function openMuseum(seedText) {
  seed = normalizeSeed(seedText) || randomSeed();
  for (const key of [...loaded.keys()]) { const [rx, rz] = key.split(',').map(Number); unloadRegion(rx, rz); }
  paintings?.clear();
  world = createWorld(seed);
  paintings = new Paintings(scene);
  player.x = world.spawn.x; player.z = world.spawn.z; player.walked = 0;
  controls.yaw = world.spawn.yaw; controls.pitch = 0;
  streamRegions(true);
  $('seed').value = seed;
  document.title = `Museum · ${seed}`;
  history.replaceState(null, '', '#' + encodeURIComponent(seed));
  $('seedtext').textContent = seed;
}

// ── Walking ──────────────────────────────────────────────────
function blocked(x, z) {
  const r = RADIUS;
  return world.solid(Math.floor(x - r), Math.floor(z - r)) || world.solid(Math.floor(x + r), Math.floor(z - r)) ||
    world.solid(Math.floor(x - r), Math.floor(z + r)) || world.solid(Math.floor(x + r), Math.floor(z + r));
}
function walk(dt) {
  const it = controls.intent();
  if (!it.x && !it.y) return;
  const speed = (it.run ? RUN : WALK) * dt;
  const sy = Math.sin(controls.yaw), cy = Math.cos(controls.yaw);
  // yaw 0 faces -z; right is +x
  const dx = (it.x * cy - it.y * sy) * speed, dz = (-it.x * sy - it.y * cy) * speed;
  // Move one axis at a time so you slide along walls instead of sticking to them.
  if (!blocked(player.x + dx, player.z)) player.x += dx;
  if (!blocked(player.x, player.z + dz)) player.z += dz;
  player.walked += Math.hypot(dx, dz);
}

// ── HUD ──────────────────────────────────────────────────────
const caption = $('caption');
let shown = null;
function showCaption(def, info) {
  if (def === shown) return;
  shown = def;
  if (!def) { caption.classList.remove('on'); return; }
  $('c-title').textContent = info.title;
  $('c-medium').textContent = def.founder ? `${info.medium} · the founder’s piece` : info.medium;
  $('c-seed').textContent = def.seed;
  caption.classList.add('on');
}

const mini = $('minimap'), mctx = mini.getContext('2d');
let showMap = true, lastMap = 0;
function drawMap(now) {
  if (!showMap || now - lastMap < 110) return;
  lastMap = now;
  const S = 3, R = 23, size = (R * 2 + 1) * S;
  if (mini.width !== size) { mini.width = size; mini.height = size; }
  mctx.fillStyle = '#0d0d10'; mctx.fillRect(0, 0, size, size);
  const bx = Math.floor(player.x), bz = Math.floor(player.z);
  for (let z = -R; z <= R; z++) {
    for (let x = -R; x <= R; x++) {
      mctx.fillStyle = world.solid(bx + x, bz + z) ? '#8c8a84' : '#2b2b31';
      mctx.fillRect((x + R) * S, (z + R) * S, S, S);
    }
  }
  const cx = (player.x - bx + R) * S, cz = (player.z - bz + R) * S;
  mctx.fillStyle = '#ff7a45';
  mctx.save();
  mctx.translate(cx, cz);
  mctx.rotate(-controls.yaw);
  mctx.beginPath(); mctx.moveTo(0, -7); mctx.lineTo(5, 5); mctx.lineTo(-5, 5); mctx.closePath(); mctx.fill();
  mctx.restore();
}

// ── Controls and overlay ─────────────────────────────────────
const overlay = $('overlay');
let playing = false;
function setPlaying(on) {
  playing = on;
  overlay.classList.toggle('hidden', on);
  $('hud').classList.toggle('on', on);
  if (!on) { controls.keys.clear(); controls.moveX = controls.moveY = 0; }
}
const controls = new Controls(canvas, {
  lockChange: (locked) => setPlaying(locked),
  touchStart: () => { if (!playing) setPlaying(true); },
  interact: () => openCurrent(),
  toggleMap: () => { showMap = !showMap; mini.classList.toggle('off', !showMap); },
  toggleQuality: () => setQuality(quality === 'chunky' ? 'sharp' : 'chunky'),
  stickMove: (origin, t) => { const k = $('stick'); k.style.display = 'block'; k.style.left = origin.x + 'px'; k.style.top = origin.y + 'px'; $('knob').style.transform = `translate(${Math.max(-40, Math.min(40, t.clientX - origin.x))}px, ${Math.max(-40, Math.min(40, t.clientY - origin.y))}px)`; },
  stickEnd: () => { $('stick').style.display = 'none'; },
});
function setQuality(q) {
  quality = q;
  try { localStorage.setItem('museum.quality', q); } catch {}
  resize();
}
function openCurrent() {
  if (!paintings?.current) return;
  window.open('./#' + encodeURIComponent(paintings.current.seed), '_blank', 'noopener');
}
caption.addEventListener('click', openCurrent);
caption.addEventListener('touchend', (e) => { e.preventDefault(); openCurrent(); });

$('enter').addEventListener('click', () => {
  if (matchMedia('(pointer: coarse)').matches) { setPlaying(true); return; }
  canvas.requestPointerLock?.();
  // Pointer lock can be refused (some browsers, embedded views): walk anyway.
  setTimeout(() => { if (!controls.locked) setPlaying(true); }, 250);
});
canvas.addEventListener('click', () => { if (!playing) $('enter').click(); });
$('menu').addEventListener('click', () => { document.exitPointerLock?.(); setPlaying(false); });
$('quality').addEventListener('click', () => setQuality(quality === 'chunky' ? 'sharp' : 'chunky'));
$('seedform').addEventListener('submit', (e) => {
  e.preventDefault();
  const s = normalizeSeed($('seed').value);
  if (s) openMuseum(s);
});
$('dice').addEventListener('click', () => openMuseum(randomSeed()));
$('help-touch').hidden = !matchMedia('(pointer: coarse)').matches;
$('help-desk').hidden = matchMedia('(pointer: coarse)').matches;
$('enter').textContent = matchMedia('(pointer: coarse)').matches ? 'Start walking' : 'Click to walk';

// ── Frame loop ───────────────────────────────────────────────
let last = performance.now(), paused = false;

// Everything that changes from moment to moment except drawing it.
function update(dt, now) {
  if (playing) walk(dt);
  streamRegions();
  const bob = playing ? Math.sin(player.walked * 2.6) * 0.035 : 0;
  camera.position.set(player.x, EYE + bob, player.z);
  camera.rotation.set(controls.pitch, controls.yaw, 0);
  const fx = -Math.sin(controls.yaw), fz = -Math.cos(controls.yaw);
  paintings.update(player.x, player.z, fx, fz, now, dt);
  const cur = paintings.current;
  showCaption(cur, cur ? paintings.items.get(cur.id).piece ?? infoFor(cur) : null);
}

function frame(now) {
  requestAnimationFrame(frame);
  if (paused) return;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt, now);
  drawMap(now);
  renderer.render(scene, camera);
}
const infoCache = new Map();
function infoFor(def) {
  let i = infoCache.get(def.seed);
  if (!i) { i = createPiece(def.seed); if (infoCache.size > 200) infoCache.clear(); infoCache.set(def.seed, i); }
  return i;
}

// A few handles for tests and for poking around in the console.
window.museum = {
  get world() { return world; }, player, controls, paintings: () => paintings,
  teleport(x, z, yaw = 0, pitch = 0) { player.x = x; player.z = z; controls.yaw = yaw; controls.pitch = pitch; streamRegions(true); },
  enter: () => setPlaying(true),
  pause: (p = true) => { paused = p; },
  render: () => renderer.render(scene, camera),
  // Advance the museum by `seconds` of walking and housekeeping without
  // drawing anything (tests use this; so can a console).
  step(seconds, fps = 30) { const n = Math.max(1, Math.round(seconds * fps)); for (let i = 0; i < n; i++) update(1 / fps, performance.now()); },
  stats: () => ({ regions: loaded.size, paintings: paintings.items.size, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, textures: renderer.info.memory.textures }),
};

// ── Go ───────────────────────────────────────────────────────
resize();
{
  let s = '';
  try { s = normalizeSeed(decodeURIComponent(location.hash.slice(1))); } catch {}
  openMuseum(s);
}
requestAnimationFrame(frame);
