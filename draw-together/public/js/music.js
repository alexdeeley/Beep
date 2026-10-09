// Draw Together — background music, playing everywhere in the app (home
// screen, lobby, and the whole game) as a two-track playlist that alternates
// forever: track A plays through, then track B, then back to A. Pauses on
// the game-over screen (see pause()/resume() - app.js calls these) so a
// finished game ends on its chime instead of the music running forever
// underneath it. Shares the sound effects' mute state (see sound.js) - one
// mute button silences both - call refreshMute() whenever that toggles so
// an already-playing track responds immediately.
import { isMuted } from './sound.js';

const TRACKS = ['/audio/music-1.mp3', '/audio/music-2.mp3'];
const VOLUME = 0.35;

const els = TRACKS.map((src) => {
  const a = new Audio(src);
  a.preload = 'auto';
  a.volume = 0;
  return a;
});
let idx = 0;
let started = false;

// One token per element so a newer fade() call (rapid mute toggling) cancels
// any earlier fade still in flight on that element, rather than two rAF
// loops fighting over the same volume.
const fadeToken = new WeakMap();

function fade(el, to, ms = 400, onDone) {
  const from = el.volume;
  const t0 = performance.now();
  const token = Symbol();
  fadeToken.set(el, token);
  (function step(t) {
    if (fadeToken.get(el) !== token) return;
    const p = Math.max(0, Math.min(1, (t - t0) / ms));
    el.volume = from + (to - from) * p;
    if (p < 1) requestAnimationFrame(step);
    else onDone?.();
  })(t0);
}

function playCurrent() {
  const el = els[idx];
  el.currentTime = 0;
  el.play().catch(() => {});
  fade(el, isMuted() ? 0 : VOLUME);
}

// Called once, on first user interaction (same moment sound.js unlocks its
// AudioContext) - starts the playlist and keeps it advancing to the next
// track whenever the current one finishes.
export function init() {
  if (started) return;
  started = true;
  els.forEach((el, i) => {
    el.addEventListener('ended', () => { idx = (i + 1) % els.length; playCurrent(); });
  });
  playCurrent();
}

export function refreshMute() {
  if (started) fade(els[idx], isMuted() ? 0 : VOLUME, 150);
}

// Game-over gets quiet (just the "over" chime) instead of the music
// continuing under it; resume() picks the same track back up (not a
// restart) once the next round actually begins.
export function pause() {
  if (!started) return;
  const el = els[idx];
  fade(el, 0, 250, () => el.pause());
}

export function resume() {
  if (!started) return;
  const el = els[idx];
  if (el.paused) el.play().catch(() => {});
  fade(el, isMuted() ? 0 : VOLUME, 250);
}

// For tests/debugging only.
export function isPlaying() { return started && !els[idx].paused; }
