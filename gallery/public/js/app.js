import { createPiece, normalizeSeed, SETTLE_SECONDS } from './art/index.js';

const $ = (id) => document.getElementById(id);
const canvas = $('art'), ctx = canvas.getContext('2d');
const frame = $('frame'), plaque = $('plaque'), wall = $('wall'), mat = $('mat');
const input = $('seed');

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const MAX_PIXELS = 2.6e6;     // keeps phones comfortable
const FRAME_MS = 1000 / 40;   // 40 frames a second is plenty for slow art

let piece = null;
let startedAt = 0;
let raf = 0;
let lastDraw = 0;

// ── Seeds ────────────────────────────────────────────────────

const WORDS_A = ['quiet', 'amber', 'velvet', 'hollow', 'gentle', 'electric', 'paper', 'silver', 'wild', 'slow', 'bright', 'secret', 'drifting', 'golden', 'lunar', 'mossy', 'salty', 'sleepy', 'tiny', 'violet'];
const WORDS_B = ['harbor', 'orchard', 'comet', 'lantern', 'meadow', 'echo', 'canyon', 'ribbon', 'garden', 'tide', 'engine', 'island', 'museum', 'thunder', 'window', 'forest', 'planet', 'river', 'carousel', 'cloud'];
const randomSeed = () => {
  const r = () => Math.floor(Math.random() * 1e9);
  return `${WORDS_A[r() % WORDS_A.length]} ${WORDS_B[r() % WORDS_B.length]} ${1 + (r() % 99)}`;
};
const seedFromUrl = () => { try { return normalizeSeed(decodeURIComponent(location.hash.slice(1))); } catch { return ''; } };

// ── Drawing ──────────────────────────────────────────────────

// The biggest the artwork can be inside the stage, at the piece's own shape.
function fit() {
  if (!piece) return;
  const room = wall.getBoundingClientRect();
  const framePad = 9 * 2;                       // the black frame
  const maxW = Math.max(120, room.width - framePad - 4);
  const maxH = Math.max(100, room.height - framePad - 4);
  const a = piece.aspect;
  // The mat is a margin of about 4.5% of the picture; it depends on the size
  // being solved for, so settle it in two passes.
  let matPad = 20, w = 0;
  for (let i = 0; i < 2; i++) {
    w = Math.min(maxW - 2 * matPad, (maxH - 2 * matPad) * a);
    matPad = Math.round(Math.min(32, Math.max(8, w * 0.045)));
  }
  w = Math.max(60, Math.floor(Math.min(maxW - 2 * matPad, (maxH - 2 * matPad) * a)));
  const h = Math.floor(w / a);
  mat.style.padding = matPad + 'px';

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const k = Math.min(dpr, Math.sqrt(MAX_PIXELS / (w * h)));
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  canvas.width = Math.round(w * k);
  canvas.height = Math.round(h * k);
  render();
}

function render(now = performance.now()) {
  if (!piece) return;
  const t = reduceMotion.matches ? SETTLE_SECONDS + 2 : (now - startedAt) / 1000;
  piece.draw(ctx, canvas.width, canvas.height, t);
}

function loop(now) {
  raf = requestAnimationFrame(loop);
  if (now - lastDraw < FRAME_MS) return;
  lastDraw = now;
  render(now);
}

function startLoop() {
  cancelAnimationFrame(raf);
  if (!reduceMotion.matches) raf = requestAnimationFrame(loop);
}
reduceMotion.addEventListener?.('change', () => { startLoop(); render(); });

// ── Showing a piece ─────────────────────────────────────────

let swapTimer = 0;
function show(seedText, { first = false } = {}) {
  const seed = normalizeSeed(seedText);
  if (!seed) return;
  input.value = seed;
  const next = createPiece(seed);
  const swap = () => {
    piece = next;
    startedAt = performance.now();
    $('title').textContent = piece.title;
    $('medium').textContent = piece.medium;
    $('num').textContent = piece.number;
    $('seedtext').textContent = piece.seed;
    canvas.setAttribute('aria-label', `${piece.title}. ${piece.medium}, generated from the seed “${piece.seed}”.`);
    document.title = `${piece.title} · Gallery`;
    fit();
    startLoop();
    frame.classList.remove('out');
    plaque.classList.remove('out');
  };
  clearTimeout(swapTimer);
  if (first || reduceMotion.matches) { swap(); return; }
  frame.classList.add('out');
  plaque.classList.add('out');
  swapTimer = setTimeout(swap, 260);
}

function go(seedText, { replace = false } = {}) {
  const seed = normalizeSeed(seedText);
  if (!seed) return;
  const url = '#' + encodeURIComponent(seed);
  if (replace) history.replaceState(null, '', url); else history.pushState(null, '', url);
  show(seed);
}

// ── Controls ─────────────────────────────────────────────────

$('seedform').addEventListener('submit', (e) => {
  e.preventDefault();
  const seed = normalizeSeed(input.value);
  if (!seed) { input.focus(); return; }
  if (piece && seed === piece.seed) return;
  go(seed);
  input.blur();
});

$('shuffle').addEventListener('click', () => go(randomSeed()));

$('save').addEventListener('click', () => {
  if (!piece) return;
  // A big, finished version of the piece - not whatever frame is on screen.
  const long = 2000;
  const w = piece.aspect >= 1 ? long : Math.round(long * piece.aspect);
  const h = Math.round(w / piece.aspect);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  piece.draw(c.getContext('2d'), w, h, SETTLE_SECONDS + 4);
  c.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = piece.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.png';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, 'image/png');
});

addEventListener('hashchange', () => { const s = seedFromUrl(); if (s && (!piece || s !== piece.seed)) show(s); });
addEventListener('popstate', () => { const s = seedFromUrl(); if (s && (!piece || s !== piece.seed)) show(s); });
new ResizeObserver(() => fit()).observe(wall);

// Easter egg for the future museum: window.gallery.createPiece
window.gallery = { createPiece };

// ── Start ───────────────────────────────────────────────────

{
  const seed = seedFromUrl() || randomSeed();
  if (!seedFromUrl()) history.replaceState(null, '', '#' + encodeURIComponent(seed));
  show(seed, { first: true });
}
