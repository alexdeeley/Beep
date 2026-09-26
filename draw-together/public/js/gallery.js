// Draw Together — shareable gallery of a room's finished drawings.
// Reuses the same Board renderer the live game uses, replaying each
// drawing's stored strokes rather than shipping a rasterized image.

import { Board } from './board.js';
import { initInvertToggle } from './a11y.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const params = new URLSearchParams(location.search);
const code = (params.get('code') || '').trim().toUpperCase();

function setState(text) { $('g-state').textContent = text; }

async function main() {
  initInvertToggle($('btn-a11y-gallery'));
  wireInvite();
  wireShare();

  if (!/^[A-Z]{3,4}[2-9]$/.test(code)) {
    setState("No game code given — open this page from the game's “View & share the gallery” button.");
    return;
  }
  $('g-code').textContent = code;

  let data;
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(code)}/gallery`);
    data = await res.json();
  } catch {
    setState("Couldn't reach the game. Check your internet and try again.");
    return;
  }
  if (!data.exists) {
    setState("We couldn't find that game — it may have expired (games last 12 hours).");
    return;
  }
  if (!data.entries.length) {
    setState('No drawings yet — play a round, then come back!');
    return;
  }
  setState('');
  renderGrid(data.entries);
}

function renderGrid(entries) {
  const grid = $('g-grid');
  entries.forEach((entry, i) => {
    const card = document.createElement('div');
    card.className = 'gcard';
    const host = document.createElement('div');
    host.className = 'board-host';
    card.appendChild(host);

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.innerHTML = `<div class="word">${esc(entry.word)} ${esc(entry.emoji)}</div>
      <div class="who">Round ${entry.round} · drawn by ${esc(entry.drawerName)}</div>`;
    card.appendChild(meta);

    const dl = document.createElement('button');
    dl.className = 'btn small ghost dl';
    dl.type = 'button';
    dl.textContent = '⬇️ Save drawing';
    card.appendChild(dl);

    grid.appendChild(card);

    const board = new Board(host);
    board.setAspect(entry.aspect || 1);
    requestAnimationFrame(() => {
      board.layout();
      board.load(entry.ops || [], null);
    });

    dl.addEventListener('click', () => downloadDrawing(board, entry, i));
  });
}

function downloadDrawing(board, entry, i) {
  board.base.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const safeWord = entry.word.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'drawing';
    a.download = `draw-together-${code}-${i + 1}-${safeWord}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, 'image/png');
}

function wireInvite() {
  const url = location.origin + '/';
  const img = $('qr-img');
  img.src = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=8&data=${encodeURIComponent(url)}`;
  img.addEventListener('load', () => { $('invite').hidden = false; });
  img.addEventListener('error', () => { $('invite').hidden = true; });
}

function wireShare() {
  $('btn-share').addEventListener('click', async () => {
    const url = location.href.split('#')[0];
    const shareData = { title: 'Draw Together — the gallery', text: `See what we drew in game ${code}!`, url };
    if (navigator.share) {
      try { await navigator.share(shareData); return; } catch { /* cancelled or unsupported, fall through */ }
    }
    try {
      await navigator.clipboard.writeText(url);
      flash('Link copied!');
    } catch {
      flash(url);
    }
  });
}

function flash(text) {
  const btn = $('btn-share');
  const prev = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = prev; }, 2200);
}

main();
