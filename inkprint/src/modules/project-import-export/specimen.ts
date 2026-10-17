/**
 * A PNG specimen sheet drawn with the generated font (already loaded into the
 * page). Characters the font lacks are drawn as empty dashed boxes, so the
 * sheet never shows a substitute letter.
 */
const PHRASES = ['The quick brown fox jumps', 'over the lazy dog.', 'Hello, world!', 'This is my handwriting.', 'Made entirely by me.'];

export async function renderSpecimen(opts: { family: string; title: string; designer: string; chars: Set<string>; dark?: boolean }): Promise<Blob> {
  const W = 1600, H = 2000, M = 100;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const fg = opts.dark ? '#fff' : '#000';
  ctx.fillStyle = opts.dark ? '#000' : '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = fg;
  ctx.textBaseline = 'alphabetic';
  await document.fonts.load(`80px "${opts.family}"`);

  const line = (text: string, y: number, size: number) => {
    let x = M;
    ctx.font = `${size}px "${opts.family}"`;
    for (const ch of Array.from(text)) {
      if (ch === ' ' || opts.chars.has(ch)) {
        ctx.fillText(ch, x, y);
        x += ctx.measureText(ch).width;
      } else {
        const w = size * 0.45;
        ctx.save();
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = opts.dark ? '#777' : '#999';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + size * 0.05, y - size * 0.7, w, size * 0.7);
        ctx.restore();
        x += w + size * 0.1;
      }
      if (x > W - M) break;
    }
  };

  ctx.font = `600 28px system-ui, sans-serif`;
  ctx.fillText(`${opts.title.toUpperCase()}${opts.designer ? ' · ' + opts.designer : ''} · MADE WITH INKPRINT`, M, 120);
  ctx.fillRect(M, 150, W - 2 * M, 3);
  line(opts.title, 330, 150);
  let y = 520;
  for (const row of ['ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ', 'abcdefghijklm', 'nopqrstuvwxyz', '0123456789 .,:;!?&@']) {
    line(row, y, 96);
    y += 135;
  }
  y += 40;
  for (const p of PHRASES) {
    line(p, y, 72);
    y += 105;
  }
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not render the specimen'))), 'image/png'));
}
