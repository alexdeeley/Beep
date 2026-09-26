// Draw Together — shared "invert colors" accessibility toggle. Persisted
// per-device (like the mute button), so it survives a reload and applies
// the moment either page loads: index.html (home + in-game HUD) and
// gallery.html both call initInvertToggle with their own button(s), and
// all of them stay in sync since they all read/write the same key.
const KEY = 'dt.invertColors';

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
