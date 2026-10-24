// Accessibility wiring that is not a setting by itself:
//  - follows OS "reduce motion" changes while the app is open (only if the user has not
//    explicitly chosen otherwise this session)
//  - keyboard shortcuts for people who cannot use multitouch:
//      M = menu (via onMenu), P / Space = pause ambient animation, U / Ctrl+Z = undo,
//      R = randomize, E = next effect set, C = next palette, S = sound on/off
//    Shortcuts are ignored while typing in inputs.
//
// ============================================================
// EXTENSION ZONE: ACCESSIBILITY FEATURES
// PURPOSE: Add accessibility behaviour (alternative input, contrast, motion limits).
// CONTRACT: Register a plugin of type 'accessibility' that uses api.settings /
//           api.commands / api.events; add a panel with api.ui.panels.register().
// SAFETY: Never remove the reduced-flash / reduced-motion guarantees; only add.
// INTEGRATION: See src/extensions/examples/colour-safe.js.
// ============================================================

export function installAccessibility(api, { onMenu } = {}) {
  const S = api.settings;
  let userChose = false;
  api.events.on('settings:changed', (e) => { if (e.key === 'a11y.reducedMotion') userChose = true; });
  try {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    mq.addEventListener?.('change', (e) => { if (!userChose) { S.set('a11y.reducedMotion', e.matches); userChose = false; } });
  } catch {}

  const keys = {
    m: () => onMenu?.(), p: () => S.set('visual.animate', !S.get('visual.animate')), ' ': () => S.set('visual.animate', !S.get('visual.animate')),
    u: () => api.commands.undo(), r: () => api.commands.randomize(2), e: () => api.commands.cycle('interaction', 1),
    c: () => api.commands.cycle('palette', 1), s: () => S.set('audio.enabled', !S.get('audio.enabled')),
  };
  const onKey = (ev) => {
    if (ev.target && /input|textarea|select/i.test(ev.target.tagName)) return;
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') { ev.preventDefault(); api.commands.undo(); return; }
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const fn = keys[ev.key.toLowerCase()];
    if (fn) { ev.preventDefault(); fn(); }
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}
