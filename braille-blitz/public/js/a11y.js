// Accessibility helpers: what the screen reader is told, keyboard handling,
// and respecting the system's reduced-motion setting.

export function liveRegion(id = 'sr-live') {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.className = 'sr-only';
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-atomic', 'true');
    document.body.appendChild(el);
  }
  // Clearing then setting makes repeated identical messages re-announce.
  return (text) => { el.textContent = ''; setTimeout(() => { el.textContent = text; }, 30); };
}

export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// Keyboard: 1/2/3 pick an answer by position; a letter or digit key picks
// the matching answer when it is one of the choices; arrows move between
// answers; Enter or Space presses the focused one (the browser does that
// for buttons already); P pauses; Escape goes back.
export function keyHandler({ choose, pause, back, choicesLabels }) {
  return (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const k = e.key;
    if (k === 'Escape') { back(); e.preventDefault(); return; }
    if (k === 'p' || k === 'P') { pause(); e.preventDefault(); return; }
    if (k === '1' || k === '2' || k === '3') { choose(Number(k) - 1); e.preventDefault(); return; }
    if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowUp') {
      const btns = [...document.querySelectorAll('.answers button:not([disabled])')];
      if (!btns.length) return;
      const i = btns.indexOf(document.activeElement);
      const dir = (k === 'ArrowRight' || k === 'ArrowDown') ? 1 : -1;
      btns[(i + dir + btns.length) % btns.length].focus();
      e.preventDefault();
      return;
    }
    if (k.length === 1) {
      const labels = choicesLabels();
      const i = labels.findIndex((l) => l.toLowerCase() === k.toLowerCase());
      if (i >= 0) { choose(i); e.preventDefault(); }
    }
  };
}

// Move keyboard focus somewhere sensible when a screen changes.
export function focusFirst(root) {
  const el = root.querySelector('[data-autofocus], h1, h2, button');
  if (el) { if (!el.hasAttribute('tabindex') && !/BUTTON|A|INPUT/.test(el.tagName)) el.setAttribute('tabindex', '-1'); el.focus({ preventScroll: false }); }
}
