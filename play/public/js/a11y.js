// PLAY — shared "invert colors" + "reduced motion" accessibility toggles.
// Persisted per-device, survive a reload.
const INVERT_KEY = 'play.invertColors';

const isOn = (key) => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };
const setOn = (key, v) => { try { localStorage.setItem(key, v ? '1' : '0'); } catch {} };

export function initInvertToggle(...buttons) {
  const btns = buttons.filter(Boolean);
  const render = () => {
    const on = isOn(INVERT_KEY);
    document.documentElement.classList.toggle('a11y-invert', on);
    for (const b of btns) {
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.setAttribute('aria-label', on ? 'Turn off inverted colors' : 'Invert colors for readability');
    }
  };
  render();
  for (const b of btns) b.addEventListener('click', () => { setOn(INVERT_KEY, !isOn(INVERT_KEY)); render(); });
}

// prefers-reduced-motion: checked once and exported live, since the games
// read it at render time rather than needing a toggle of their own.
const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
export const reducedMotion = { value: !!media?.matches };
media?.addEventListener?.('change', (e) => { reducedMotion.value = e.matches; });
