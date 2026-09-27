// BLACKJACK — shared "invert colors" accessibility toggle. Persisted
// per-device, survives a reload. Unlike Draw Together, nothing here needs
// exempting from the invert (there's no user-drawn "true color" to
// preserve), so this is just a straight page-wide filter.
const KEY = 'bj.invertColors';

const isOn = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
const setOn = (v) => { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch {} };

export function initInvertToggle(...buttons) {
  const btns = buttons.filter(Boolean);
  const render = () => {
    const on = isOn();
    document.documentElement.classList.toggle('a11y-invert', on);
    for (const b of btns) {
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.setAttribute('aria-label', on ? 'Turn off inverted colors' : 'Invert colors for readability');
    }
  };
  render();
  for (const b of btns) b.addEventListener('click', () => { setOn(!isOn()); render(); });
}
