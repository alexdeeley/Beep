// EXAMPLE EXTENSION — a performance optimization: when the device stays below 30 fps at
// LOW quality and the grid is not adaptive, it steps the grid resolution down once and
// tells the user (instead of letting the instrument feel sluggish).

export default {
  manifest: { id: 'ex.frame-budget', name: 'Frame Budget Guard (example)', version: '1.0.0', type: 'performance', apiVersion: '1.0.0', description: 'Steps resolution down when the frame rate collapses.' },
  register(api) {
    let slow = 0, done = false;
    // ============================================================
    // EXTENSION ZONE: PERFORMANCE OPTIMIZATIONS (example)
    // PURPOSE: React to measured performance (stats once per second).
    // CONTRACT: api.performance.addOptimizer(fn(stats, monitor)) — stats: fps, frameMs,
    //           effects, particles, voices, cellsDrawn, workload, quality, cols, rows.
    // SAFETY: Change settings through api.settings; never block the frame.
    // INTEGRATION: api.performance.addOptimizer(fn)
    // ============================================================
    api.performance.addOptimizer((s) => {
      if (done || api.settings.get('grid.resolution') === 'adaptive') return;
      slow = s.fps < 30 && s.quality === 'low' ? slow + 1 : 0;
      if (slow >= 4) {
        const order = ['dense', 'detailed', 'standard', 'coarse'];
        const i = order.indexOf(api.settings.get('grid.resolution'));
        if (i >= 0 && i < order.length - 1) { api.settings.set('grid.resolution', order[i + 1]); api.ui.toast('LOWERED GRID RESOLUTION TO KEEP UP'); }
        done = true;
      }
    });
  },
};
