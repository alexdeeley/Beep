import { TAU, background, quarterTurns, smooth } from '../common.js';

const SHAPES = [['quarter', 4], ['half', 3], ['circle', 3], ['ring', 2], ['diag', 3], ['stripes', 2], ['dots', 1.5], ['square', 1], ['empty', 0.6]];

function drawShape(ctx, kind, c1, c2, pal) {
  ctx.fillStyle = c1;
  switch (kind) {
    case 'quarter':
      ctx.beginPath(); ctx.moveTo(-0.5, -0.5); ctx.arc(-0.5, -0.5, 1, 0, Math.PI / 2); ctx.closePath(); ctx.fill(); break;
    case 'half':
      ctx.beginPath(); ctx.arc(0, 0.5, 0.5, Math.PI, TAU); ctx.closePath(); ctx.fill(); break;
    case 'circle':
      ctx.beginPath(); ctx.arc(0, 0, 0.4, 0, TAU); ctx.fill(); break;
    case 'ring':
      ctx.beginPath(); ctx.arc(0, 0, 0.4, 0, TAU); ctx.fill();
      ctx.fillStyle = c2; ctx.beginPath(); ctx.arc(0, 0, 0.18, 0, TAU); ctx.fill(); break;
    case 'diag':
      ctx.beginPath(); ctx.moveTo(-0.5, -0.5); ctx.lineTo(0.5, -0.5); ctx.lineTo(-0.5, 0.5); ctx.closePath(); ctx.fill(); break;
    case 'stripes':
      for (let i = 0; i < 4; i++) ctx.fillRect(-0.5, -0.5 + i * 0.25, 1, 0.125);
      break;
    case 'dots':
      for (const [x, y] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) {
        ctx.beginPath(); ctx.arc(x, y, 0.15, 0, TAU); ctx.fill();
      }
      break;
    case 'square':
      ctx.fillRect(-0.28, -0.28, 0.56, 0.56); break;
    default: break;
  }
}

export default {
  id: 'bauhaus',
  medium: 'Tiled geometry',
  words: ['Blocks', 'Study', 'Composition', 'Grid', 'Quarters', 'Pattern', 'Construction', 'Rhythm'],
  make({ rng, pal, A }) {
    const rows = rng.int(3, 6);
    const cell = 1 / rows;
    const cols = Math.max(1, Math.floor(A * rows + 0.001));
    const ox = (A - cols * cell) / 2;
    const gap = rng.chance(0.4) ? rng.range(0.004, 0.012) : 0;
    const tiles = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const c1 = rng.int(0, pal.n - 1);
        let c2 = rng.int(0, pal.n - 1);
        if (c2 === c1) c2 = (c2 + 2) % pal.n;
        tiles.push({
          x, y, kind: rng.weighted(SHAPES), c1, c2,
          hasBase: rng.chance(0.55), k: rng.int(0, 3),
          phase: rng.float(), period: rng.range(5, 13), moves: rng.chance(0.75),
        });
      }
    }
    const angle = rng.range(0, Math.PI);
    return (ctx, A2, t) => {
      background(ctx, A2, pal, angle);
      for (const tile of tiles) {
        const cx = ox + (tile.x + 0.5) * cell, cy = (tile.y + 0.5) * cell;
        const q = tile.moves ? quarterTurns(t, tile.phase, tile.period) : 0;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(cell - gap, cell - gap);
        if (tile.hasBase) { ctx.fillStyle = pal.c(tile.c2, 1); ctx.fillRect(-0.5, -0.5, 1, 1); }
        ctx.rotate((tile.k + q) * (Math.PI / 2));
        const turning = q % 1;
        if (turning > 0) { const pop = 1 + 0.08 * Math.sin(turning * Math.PI); ctx.scale(pop, pop); }
        drawShape(ctx, tile.kind, pal.c(tile.c1), tile.hasBase ? pal.c(tile.c2) : pal.bg, pal);
        ctx.restore();
      }
    };
  },
};
