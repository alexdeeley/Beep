// Draw Together — remix editor: load an already-finished gallery drawing
// (yours or someone else's) and add more strokes on top of it, saving the
// result as a brand-new gallery entry. The original is never touched -
// see submitRemix() in src/game-room.js.
import { Board } from './board.js';
import { TOOLS, SIZE_NAMES, PALETTE, MAX_NAME } from './shared.js';

const $ = (id) => document.getElementById(id);
const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const ICON = { pen: 'i-pen', marker: 'i-marker', crayon: 'i-crayon', dots: 'i-dots', rainbow: 'i-rainbow', eraser: 'i-eraser' };

const params = new URLSearchParams(location.search);
const code = (params.get('code') || '').trim().toUpperCase();
const entryIndex = Number(params.get('entry'));
const you = params.get('you') != null && params.get('you') !== '' ? Number(params.get('you')) : null;

const S = {
  tool: 'pen',
  sizeIdx: { pen: 1, marker: 1, crayon: 1, dots: 1, rainbow: 1, eraser: 0 },
  color: '#000000',
  stroke: null,
  lastPen: 0,
  baseLen: 0, // how many ops belonged to the source drawing - never undo/clear past this
};

let board;

function setState(text) { $('r-state').textContent = text; $('r-state').hidden = !text; }

async function main() {
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
  $('btn-back').addEventListener('click', () => history.back());

  if (!/^[A-Z]{3,4}[2-9]$/.test(code) || !Number.isInteger(entryIndex) || entryIndex < 0) {
    setState('Open this page from the Gallery’s “Add to this drawing” button.');
    return;
  }

  let data;
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(code)}/gallery`);
    data = await res.json();
  } catch {
    setState("Couldn't reach the game. Check your internet and try again.");
    return;
  }
  const entry = data?.entries?.[entryIndex];
  if (!data?.exists || !entry) {
    setState("Couldn't find that drawing — the game may have expired (games last 12 hours).");
    return;
  }

  const who = entry.remixOf != null ? `${entry.drawerName}'s remix` : `${entry.drawerName}'s drawing`;
  $('r-who').textContent = `— ${who} (${entry.word} ${entry.emoji})`;

  const host = $('board-host');
  board = new Board(host);
  board.setAspect(entry.aspect || 1);
  requestAnimationFrame(() => {
    board.layout();
    board.load(entry.ops || [], null);
    // Only known once the base drawing is actually loaded - everything
    // before this index is the original; undo/clear must never touch it.
    S.baseLen = board.ops.length;
    updateActs();
  });

  $('r-stage').hidden = false;
  $('tray').hidden = false;
  $('r-name-form').hidden = false;
  if (params.get('name')) $('in-name').value = params.get('name');

  buildTray();
  wireInput();
  wireSave(entry);
}

// ── Toolbar (same markup/behavior as the live game's tray, minus network) ──

function buildTray() {
  const tools = $('tools');
  tools.replaceChildren();
  for (const [id, t] of Object.entries(TOOLS)) {
    const b = document.createElement('button');
    b.className = 'btn tool';
    b.type = 'button';
    b.dataset.tool = id;
    b.setAttribute('aria-label', t.label);
    b.innerHTML = `<svg aria-hidden="true"><use href="#${ICON[id]}"/></svg><span>${t.label}</span>`;
    b.addEventListener('click', () => { S.tool = id; renderTray(); });
    tools.append(b);
  }
  const colors = $('colors');
  colors.replaceChildren();
  for (const c of PALETTE) {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', c.name);
    b.dataset.color = c.hex;
    b.style.setProperty('--sw', c.hex);
    b.style.setProperty('--tick', ['White', 'Yellow', 'Cyan', 'Pink', 'Orange', 'Gray', 'Green'].includes(c.name) ? '#000' : '#fff');
    b.addEventListener('click', () => {
      S.color = c.hex;
      if (S.tool === 'eraser') S.tool = 'pen';
      renderTray();
    });
    colors.append(b);
  }
  renderTray();
}

function renderTray() {
  document.querySelectorAll('#tools .tool').forEach((b) =>
    b.setAttribute('aria-pressed', b.dataset.tool === S.tool ? 'true' : 'false'));
  $('tools').style.color = S.color === '#ffffff' ? '#ffffff' : S.color;
  document.querySelectorAll('#colors .swatch').forEach((b) =>
    b.setAttribute('aria-checked', S.tool !== 'eraser' && b.dataset.color === S.color ? 'true' : 'false'));
  $('tray').classList.toggle('erasing', S.tool === 'eraser');

  const sizes = $('sizes');
  sizes.replaceChildren();
  const list = TOOLS[S.tool].sizes;
  list.forEach((sz, i) => {
    const b = document.createElement('button');
    b.className = 'btn';
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', S.sizeIdx[S.tool] === i ? 'true' : 'false');
    b.setAttribute('aria-label', SIZE_NAMES[S.tool][i]);
    const px = [10, 18, 28][list.length === 2 ? i * 2 : i];
    const bg = S.tool === 'eraser' ? '#fff' : S.color === '#ffffff' ? '#fff' : S.color;
    b.innerHTML = `<span class="blob" style="width:${px}px;height:${px}px;background:${bg};box-shadow:0 0 0 2.5px #000"></span>`;
    b.addEventListener('click', () => { S.sizeIdx[S.tool] = i; renderTray(); });
    sizes.append(b);
  });
  updateActs();
}

function updateActs() {
  $('btn-undo').disabled = board.ops.length <= S.baseLen;
  $('btn-clear').disabled = board.ops.length <= S.baseLen && !S.stroke;
}

$('btn-undo').addEventListener('click', () => {
  if (S.stroke || board.ops.length <= S.baseLen) return;
  board.ops.pop();
  board.rebuild();
  updateActs();
});
$('btn-clear').addEventListener('click', () => {
  if (!confirm('Clear everything you’ve added and start fresh on top of the original?')) return;
  board.clear(rid());
  updateActs();
});

// ── Pointer input (same capture logic as the live drawer, solo/local only) ──

function wireInput() {
  const sheet = board.sheet;
  const MIN_STEP = 10;

  sheet.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'pen') S.lastPen = performance.now();
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.pointerType === 'touch' && performance.now() - S.lastPen < 1500) return;
    if (S.stroke) return;
    e.preventDefault();
    try { sheet.setPointerCapture(e.pointerId); } catch {}
    const [x, y] = board.toBoard(e.clientX, e.clientY);
    const tool = S.tool;
    const size = TOOLS[tool].sizes[S.sizeIdx[tool]];
    const color = tool === 'eraser' ? '#ffffff' : S.color;
    const id = rid();
    S.stroke = { id, pointerId: e.pointerId, lx: x, ly: y };
    board.begin({ id, tool, color, size, pts: [x, y] });
  });

  sheet.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'pen') S.lastPen = performance.now();
    const s = S.stroke;
    if (!s || e.pointerId !== s.pointerId) return;
    e.preventDefault();
    let evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    if (!evs.length) evs = [e];
    const add = [];
    for (const ev of evs) {
      const [x, y] = board.toBoard(ev.clientX, ev.clientY);
      if (Math.abs(x - s.lx) + Math.abs(y - s.ly) < MIN_STEP) continue;
      s.lx = x; s.ly = y;
      add.push(x, y);
    }
    if (add.length) board.add(s.id, add);
  });

  const endStroke = (e) => {
    const s = S.stroke;
    if (!s || (e && e.pointerId !== s.pointerId)) return;
    if (e && e.type === 'pointerup') {
      const [x, y] = board.toBoard(e.clientX, e.clientY);
      if (x !== s.lx || y !== s.ly) board.add(s.id, [x, y]);
    }
    board.end(s.id);
    S.stroke = null;
    updateActs();
  };
  sheet.addEventListener('pointerup', endStroke);
  sheet.addEventListener('pointercancel', endStroke);
}

// ── Save ─────────────────────────────────────────────────────

function wireSave(entry) {
  $('r-name-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (board.ops.length <= S.baseLen) { alert('Draw something first!'); return; }
    const name = $('in-name').value.trim().slice(0, MAX_NAME);
    if (!name) { $('in-name').focus(); return; }
    const btn = $('btn-save');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    const newOps = board.ops.slice(S.baseLen);
    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(code)}/remix`, {
        method: 'POST',
        body: JSON.stringify({ sourceIndex: entryIndex, name, ops: newOps }),
      });
      // Fully read the body before navigating away - otherwise the browser
      // can report the still-open response stream as a failed request the
      // instant location.href below tears the page down, even though the
      // save itself already succeeded.
      const saved = await res.json().catch(() => null);
      if (!res.ok || !saved?.ok) throw new Error('save failed');
      const galleryParams = new URLSearchParams({ code });
      if (you != null) galleryParams.set('you', you);
      galleryParams.set('name', name);
      location.href = `gallery.html?${galleryParams}`;
    } catch {
      btn.disabled = false;
      btn.textContent = 'Save';
      alert("Couldn't save your remix. Check your internet and try again.");
    }
  });
}

main();
