import { TAU, background, quarterTurns } from '../common.js';
import { hash01 } from '../rng.js';

export default {
  id: 'truchet',
  medium: 'Truchet arcs',
  words: ['Weave', 'Maze', 'Tangle', 'Labyrinth', 'Meander', 'Circuit', 'Knot', 'Loom'],
  make({ rng, pal, noise, A }) {
    const rows = rng.int(5, 12);
    const cell = 1 / rows;
    const cols = Math.ceil(A * rows);
    const ox = (A - cols * cell) / 2;
    const width = rng.range(0.14, 0.34);
    const regionScale = rng.range(0.15, 0.5);
    const colors = [rng.int(0, pal.n - 1), 0, 0];
    colors[1] = (colors[0] + rng.int(1, 3)) % pal.n; colors[2] = (colors[1] + rng.int(1, 3)) % pal.n;
    const salt = rng.int(1, 1e6);
    const moving = rng.range(0.15, 0.5);
    const tiles = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const n = noise(x * regionScale, y * regionScale);
        tiles.push({
          x, y, k: hash01(x, y, salt) < 0.5 ? 0 : 1,
          ci: colors[n < -0.12 ? 0 : n < 0.12 ? 1 : 2],
          moves: hash01(x, y, salt + 1) < moving, phase: hash01(x, y, salt + 2), period: 6 + hash01(x, y, salt + 3) * 8,
        });
      }
    }
    const angle = rng.range(0, Math.PI);
    return (ctx, A2, t) => {
      background(ctx, A2, pal, angle);
      ctx.lineWidth = width;
      ctx.lineCap = 'butt';
      for (const tile of tiles) {
        const q = tile.moves ? quarterTurns(t, tile.phase, tile.period) : 0;
        ctx.save();
        ctx.translate(ox + (tile.x + 0.5) * cell, (tile.y + 0.5) * cell);
        ctx.scale(cell, cell);
        ctx.rotate((tile.k + q) * (Math.PI / 2));
        ctx.lineWidth = width;
        ctx.strokeStyle = pal.c(tile.ci);
        ctx.beginPath();
        ctx.arc(-0.5, -0.5, 0.5, 0, Math.PI / 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0.5, 0.5, 0.5, Math.PI, Math.PI * 1.5);
        ctx.stroke();
        ctx.restore();
      }
    };
  },
};
