// The museum: an endless, walkable building of rooms, mazes and halls whose
// walls are hung with generated art. See world.js for how the floor plan is
// worked out and paintings.js for the art.

import * as THREE from 'three';
import { createWorld, MUSEUM_SEED, REGION } from './world.js';
import { buildRegionMesh } from './mesh.js';
import { Paintings } from './paintings.js';
import { Controls } from './controls.js';
import { Signs, fetchNear, fetchFarthest, leaveNote, ago } from './book.js';
import { createPiece } from '../art/index.js';

const $ = (id) => document.getElementById(id);
const EYE = 1.65, RADIUS = 0.3, WALK = 3.6, RUN = 6.5;
const FOG = 0x0d0d10;

// ── Three.js ─────────────────────────────────────────────────
const canvas = $('view');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
} catch (err) {
  // No WebGL (very old device, or switched off): point to the part that needs none.
  document.getElementById('overlay').innerHTML = '<div class="card"><h1>Museum</h1><p class="lede">This browser can’t draw 3D right now, so the museum can’t open. You can still see the art one piece at a time.</p><a class="enter" style="display:block;text-decoration:none" href="art">Open the art viewer →</a></div>';
  throw err;
}
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(FOG);
scene.fog = new THREE.Fog(FOG, 9, 44);
const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 90);
camera.rotation.order = 'YXZ';
const signs = new Signs(scene);

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

// There is one museum, the same for everyone: its floor plan, its art and
// its seeds all follow from MUSEUM_SEED. Where you are is the only thing that
// is yours - and it can be shared as a link (see `locationHash`).
function openMuseum(spot) {
  for (const key of [...loaded.keys()]) { const [rx, rz] = key.split(',').map(Number); unloadRegion(rx, rz); }
  paintings?.clear();
  signs.clear();
  bookAt = '';
  world = createWorld(MUSEUM_SEED);
  paintings = new Paintings(scene);
  const at = spot || { x: world.spawn.x, z: world.spawn.z, yaw: world.spawn.yaw };
  player.x = at.x; player.z = at.z; player.walked = 0;
  controls.yaw = at.yaw; controls.pitch = 0;
  // A shared link could point inside a wall; never start there.
  if (blocked(player.x, player.z)) { player.x = world.spawn.x; player.z = world.spawn.z; }
  streamRegions(true);
  refreshBook(true);
  document.title = 'Museum';
}

// "#x,z,turn": where you are, to the nearest block and 5 degrees.
const locationHash = () => `#${Math.round(player.x * 10) / 10},${Math.round(player.z * 10) / 10},${Math.round((controls.yaw % (Math.PI * 2)) * 36 / Math.PI) * 5}`;
function spotFromHash() {
  const m = /^#(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,(-?\d+(?:\.\d+)?))?$/.exec(location.hash);
  if (!m) return null;
  const x = Number(m[1]), z = Number(m[2]);
  if (Math.abs(x) > 1e7 || Math.abs(z) > 1e7) return null;
  return { x, z, yaw: m[3] != null ? Number(m[3]) * Math.PI / 180 : 0 };
}
let lastHash = 0;
function syncHash(now) {
  if (now - lastHash < 1000) return;
  lastHash = now;
  history.replaceState(null, '', locationHash());
  $('where').textContent = `x ${Math.round(player.x)} · z ${Math.round(player.z)}`;
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
// `target` is null, a painting { def, info }, or a visitor's note { note }.
function showCaption(target) {
  const key = !target ? null : target.note ? 'n' + target.note.id : 'p' + target.def.id;
  if (key === shown) return;
  shown = key;
  if (!target) { caption.classList.remove('on'); return; }
  caption.classList.toggle('note', !!target.note);
  const line = $('c-line');
  if (target.note) {
    const n = target.note;
    $('c-title').textContent = n.name;
    line.className = 'c-line sign';
    line.textContent = `“${n.msg}” — ${ago(n.ts)}`;
  } else {
    const { def, info } = target;
    $('c-title').textContent = info.title;
    line.className = 'c-line';
    line.innerHTML = '<span id="c-medium"></span> · seed “<span id="c-seed"></span>”';
    $('c-medium').textContent = def.founder ? `${info.medium} · the founder’s piece` : info.medium;
    $('c-seed').textContent = def.seed;
  }
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
  if (!on) { controls.keys.clear(); controls.moveX = controls.moveY = 0; showExplorers(); }
  else if (!sessionStorage.getItem('museum.hint')) {
    try { sessionStorage.setItem('museum.hint', '1'); } catch {}
    setTimeout(() => toast('Press B (or the button) to leave a note in the visitor’s book'), 1500);
  }
}
const controls = new Controls(canvas, {
  lockChange: (locked) => { if (!locked && bookOpen) return; setPlaying(locked); },
  touchStart: () => { if (!playing) setPlaying(true); },
  interact: () => openCurrent(),
  toggleMap: () => { showMap = !showMap; mini.classList.toggle('off', !showMap); },
  toggleQuality: () => setQuality(quality === 'chunky' ? 'sharp' : 'chunky'),
  toggleBook: () => { if (!playing) return; if (bookOpen) closeBook(); else openBook(); },
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
  window.open('art#' + encodeURIComponent(paintings.current.seed), '_blank', 'noopener');
}
caption.addEventListener('click', openCurrent);
caption.addEventListener('touchend', (e) => { e.preventDefault(); openCurrent(); });

$('enter').addEventListener('click', () => {
  if (matchMedia('(pointer: coarse)').matches) { setPlaying(true); return; }
  canvas.requestPointerLock?.();
  // Pointer lock can be refused (some browsers, embedded views): walk anyway.
  setTimeout(() => { if (!controls.locked) setPlaying(true); }, 250);
});
canvas.addEventListener('click', () => {
  if (!playing) $('enter').click();
  else if (!coarse && !controls.locked && !bookOpen) canvas.requestPointerLock?.();   // got the mouse back: take it again
});
$('menu').addEventListener('click', () => { document.exitPointerLock?.(); setPlaying(false); });
$('quality').addEventListener('click', () => setQuality(quality === 'chunky' ? 'sharp' : 'chunky'));
$('home').addEventListener('click', () => { openMuseum(null); });
$('share').addEventListener('click', async () => {
  const url = location.origin + location.pathname + locationHash();
  history.replaceState(null, '', locationHash());
  try { await navigator.clipboard.writeText(url); $('share').textContent = 'Link copied ✓'; }
  catch { $('share').textContent = 'Copy it from the address bar'; }
  setTimeout(() => { $('share').textContent = 'Copy a link to this spot'; }, 2200);
});
$('help-touch').hidden = !matchMedia('(pointer: coarse)').matches;
$('help-desk').hidden = matchMedia('(pointer: coarse)').matches;
$('enter').textContent = matchMedia('(pointer: coarse)').matches ? 'Start walking' : 'Click to walk';

// ── The visitor's book ───────────────────────────────────────
const coarse = matchMedia('(pointer: coarse)').matches;
let bookAt = '', lastNotes = [], bookOpen = false, bookPlace = null, signSync = 0, bookPoll = 0;

function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('on');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('on'), 4200);
}

// Fetch the notes in and around the region you are in (on arriving, when you
// cross into another region, and now and then in case others have written).
async function refreshBook(force = false) {
  if (!world) return;
  const key = Math.floor(player.x / REGION) + ',' + Math.floor(player.z / REGION);
  if (!force && key === bookAt) return;
  bookAt = key;
  const entries = await fetchNear(player.x, player.z);
  if (entries) { lastNotes = entries; signs.sync(lastNotes, player.x, player.z); }
}
function bookTick(now) {
  if (now - signSync > 1500) { signSync = now; refreshBook(); if (lastNotes.length) signs.sync(lastNotes, player.x, player.z); }
  if (now - bookPoll > 30000) { bookPoll = now; if (!document.hidden) refreshBook(true); }
}

const savedName = () => { try { return localStorage.getItem('museum.name') || ''; } catch { return ''; } };
function openBook() {
  if (bookOpen || !world) return;
  bookOpen = true;
  bookPlace = { x: Math.round(player.x * 10) / 10, z: Math.round(player.z * 10) / 10 };
  controls.keys.clear(); controls.moveX = controls.moveY = 0;
  document.exitPointerLock?.();
  const away = Math.round(Math.hypot(player.x - world.spawn.x, player.z - world.spawn.z));
  $('bp-where').textContent = `x ${Math.round(player.x)} · z ${Math.round(player.z)} — ${away} blocks from the entrance`;
  $('bp-name').value = savedName();
  $('bp-msg').value = '';
  $('bp-count').textContent = '0 / 140';
  $('bp-err').textContent = '';
  $('bookpanel').classList.remove('hidden');
  setTimeout(() => ($('bp-name').value ? $('bp-msg') : $('bp-name')).focus(), 60);
}
function closeBook(resume = true) {
  if (!bookOpen) return;
  bookOpen = false;
  $('bookpanel').classList.add('hidden');
  document.activeElement?.blur?.();
  if (resume && playing && !coarse) canvas.requestPointerLock?.();
}
$('signbtn').addEventListener('click', () => { if (!bookOpen) openBook(); });
$('bp-cancel').addEventListener('click', () => closeBook());
$('bookpanel').addEventListener('keydown', (e) => { if (e.key === 'Escape') closeBook(false); });
$('bp-msg').addEventListener('input', () => { $('bp-count').textContent = `${$('bp-msg').value.length} / 140`; });
$('bookform').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('bp-name').value, msg = $('bp-msg').value;
  if (!msg.trim()) { $('bp-err').textContent = 'Write something first.'; return; }
  const btn = $('bp-send');
  btn.disabled = true;
  $('bp-err').textContent = '';
  const res = await leaveNote({ name, msg, ...bookPlace });
  btn.disabled = false;
  if (!res.ok) { $('bp-err').textContent = res.say; return; }
  try { localStorage.setItem('museum.name', name.trim()); } catch {}
  lastNotes.unshift(res.entry);
  signs.add(res.entry);
  closeBook();
  toast('Your note is now part of the museum ✓');
});

// The menu's board of the farthest-travelled signatures, with a way to go and see.
async function showExplorers() {
  const box = $('explorers');
  const list = await fetchFarthest(8);
  if (!list || !list.length) { box.hidden = true; return; }
  const ol = $('explorers-list');
  ol.replaceChildren();
  for (const e of list) {
    const li = document.createElement('li');
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = e.name;
    const km = document.createElement('span'); km.className = 'km'; km.textContent = `${e.dist.toLocaleString()} blocks`;
    const go = document.createElement('button'); go.type = 'button'; go.textContent = 'Go there';
    go.addEventListener('click', () => { visit(e.x, e.z); });
    li.append(nm, km, go);
    ol.append(li);
  }
  box.hidden = false;
}
function visit(x, z) {
  player.x = x; player.z = z; controls.pitch = 0;
  if (blocked(player.x, player.z)) { player.x = Math.floor(x) + 0.5; player.z = Math.floor(z) + 0.5; }
  streamRegions(true);
  refreshBook(true);
  $('enter').click();
}

// ── Frame loop ───────────────────────────────────────────────
let last = performance.now(), paused = false;

// Everything that changes from moment to moment except drawing it.
function update(dt, now) {
  if (playing && !bookOpen) walk(dt);
  streamRegions();
  const bob = playing ? Math.sin(player.walked * 2.6) * 0.035 : 0;
  camera.position.set(player.x, EYE + bob, player.z);
  camera.rotation.set(controls.pitch, controls.yaw, 0);
  const fx = -Math.sin(controls.yaw), fz = -Math.cos(controls.yaw);
  paintings.update(player.x, player.z, fx, fz, now, dt);
  const cur = paintings.current;
  const note = signs.update(player.x, player.z, fx, fz);
  showCaption(cur ? { def: cur, info: paintings.items.get(cur.id).piece ?? infoFor(cur) } : note ? { note } : null);
  bookTick(now);
}

function frame(now) {
  requestAnimationFrame(frame);
  if (paused) return;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt, now);
  drawMap(now);
  syncHash(now);
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
  locationHash, spotFromHash, signs, notes: () => lastNotes, refreshBook, openBook, closeBook, visit, bookIsOpen: () => bookOpen,
  stats: () => ({ regions: loaded.size, paintings: paintings.items.size, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, textures: renderer.info.memory.textures }),
};

// ── Go ───────────────────────────────────────────────────────
resize();
openMuseum(spotFromHash());
showExplorers();
$('where').textContent = `x ${Math.round(player.x)} · z ${Math.round(player.z)}`;
addEventListener('hashchange', () => { const at = spotFromHash(); if (at && Math.hypot(at.x - player.x, at.z - player.z) > 1) openMuseum(at); });
requestAnimationFrame(frame);
