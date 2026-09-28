// Small helpers shared by the 5 per-game renderers - animation/DOM bits
// only, never game rules (those stay server-authoritative in src/games/*.js).

export function seatInfo(players, seat) {
  return players.find((p) => p.seat === seat) || { name: '???', color: '#888' };
}

export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

export function avatar(players, seat, extraClass = '') {
  const p = seatInfo(players, seat);
  const span = document.createElement('span');
  span.className = 'g-avatar' + (extraClass ? ' ' + extraClass : '');
  span.style.background = p.color;
  span.textContent = initials(p.name);
  span.title = p.name;
  return span;
}

// A brief CSS shake on the whole stage - skipped under reduced motion.
export function shakeScreen(el, reducedMotion) {
  if (reducedMotion) return;
  el.classList.remove('g-shake');
  // eslint-disable-next-line no-void
  void el.offsetWidth; // restart the animation if it's already mid-shake
  el.classList.add('g-shake');
}

// A handful of little squares flying outward from the center of `el`.
export function burstParticles(el, { count = 16, color = '#fff', reducedMotion = false } = {}) {
  if (reducedMotion) return;
  const rect = el.getBoundingClientRect();
  const layer = document.createElement('div');
  layer.className = 'g-particle-layer';
  document.body.append(layer);
  for (let i = 0; i < count; i++) {
    const p = document.createElement('span');
    p.className = 'g-particle';
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
    const dist = 60 + Math.random() * 90;
    p.style.left = `${rect.left + rect.width / 2}px`;
    p.style.top = `${rect.top + rect.height / 2}px`;
    p.style.background = color;
    p.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    p.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
    layer.append(p);
  }
  setTimeout(() => layer.remove(), 700);
}

export function secondsLeft(deadline, now) {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

// requestAnimationFrame loop that stops itself once `alive()` returns false.
// Returns a stop() function the caller can also call early (e.g. on destroy).
export function rafLoop(fn, alive) {
  let id = 0;
  const tick = () => {
    if (!alive()) return;
    fn();
    id = requestAnimationFrame(tick);
  };
  id = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(id);
}
