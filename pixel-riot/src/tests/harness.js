// Reusable headless harness for testing an extension in Node.
//
//   import { bootApp } from './harness.js';
//   const h = await bootApp({ extensions: [myExtension] });   // core + only your extension
//   h.tap(0.5, 0.5); h.drag([[0.1, 0.5], [0.9, 0.5]]); h.frames(60);
//   assert.deepEqual(h.app.errors, []);
//   h.dispose();
//
// Fake canvas + fake timeline; no audio (Web Audio is unavailable in Node, so sounds are
// no-ops — test audio code with the fake AudioContext pattern in audio.test.js).

import { installDomStubs, fakeCanvas, memoryBackend, tick } from './helpers.js';

export async function bootApp({ extensions = [], width = 390, height = 844, storage = memoryBackend() } = {}) {
  installDomStubs();
  const { PixelRiot } = await import('../app.js');
  const timeRef = { t: 1000 };
  const app = new PixelRiot({ canvas: fakeCanvas(width, height), storageBackend: storage, extensions, now: () => timeRef.t });
  app._timeRef = timeRef; app._last = timeRef.t;
  app.boot();
  tick(app, 2);
  const P = app.services.pointers;
  let nextId = 1;
  const h = {
    app, services: app.services, api: app.api,
    frames: (n = 1) => tick(app, n),
    tap(x, y) { const id = nextId++; P.downAt(id, x, y); tick(app, 3); P.upAt(id); tick(app, 1); },
    drag(points, frameMs = 16) { const id = nextId++; P.downAt(id, ...points[0]); for (const p of points.slice(1)) { tick(app, 1, frameMs); P.moveTo(id, ...p); } P.upAt(id); tick(app, 1); },
    hold(x, y, seconds = 1.5) { const id = nextId++; P.downAt(id, x, y); tick(app, Math.round(seconds * 60)); P.upAt(id); tick(app, 1); },
    plugin: (id) => app.diagnostics().plugins.find((p) => p.id === id),
    dispose: () => app.dispose(),
  };
  return h;
}
