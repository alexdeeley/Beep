// Browser entry point.
import { PixelRiot } from './app.js';
import { createControls } from './ui/controls.js';
import { installAccessibility } from './ui/accessibility.js';
import { APP_NAME } from './config.js';

function fatal(err) {
  console.error(err);
  const box = document.getElementById('fatal');
  if (box) { box.hidden = false; box.querySelector('pre').textContent = String(err && err.stack || err); }
}

try {
  document.title = APP_NAME;
  const canvas = document.getElementById('stage');
  const uiRoot = document.getElementById('ui');
  if (!canvas.getContext) throw new Error('This browser does not support canvas.');
  const app = new PixelRiot({ canvas });
  app.boot();
  const ui = createControls(uiRoot, app.api);
  installAccessibility(app.api, { onMenu: () => ui.openSheet() });

  let pending = false;
  const onResize = () => { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; app.resize(); }); };
  addEventListener('resize', onResize);
  addEventListener('orientationchange', () => setTimeout(onResize, 120));
  globalThis.visualViewport?.addEventListener('resize', onResize);
  // Block browser pinch-zoom / double-tap zoom gestures on the instrument (iOS Safari).
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
  document.addEventListener('dblclick', (e) => { if (e.target === canvas) e.preventDefault(); }, { passive: false });

  app.start();
  globalThis.pixelRiot = app;   // developer handle (console / automated tests)

  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !/[?&]nosw/.test(location.search)) {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.info('[sw] not registered:', e.message));
  }
} catch (err) { fatal(err); }

addEventListener('error', (e) => { if (!globalThis.pixelRiot) fatal(e.error || e.message); });
