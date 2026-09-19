// Pure geometry logic for the workspace's layout presets - no DOM, so it's
// trivially testable and the workspace just applies whatever positions
// come back. "Freeform" is the one preset that means "leave positions
// alone"; it only supplies a position for a panel that doesn't have one
// yet (a fresh cascade offset).
export const LAYOUTS = ["split", "grid", "performance", "freeform"];

export function computeLayoutPositions(layout, count, viewport) {
  const vw = Math.max(1, viewport.width);
  const vh = Math.max(1, viewport.height);
  const positions = [];
  if (count === 0) return positions;

  if (layout === "split") {
    const w = Math.floor(vw / count);
    for (let i = 0; i < count; i++) {
      positions.push({ x: i * w, y: 0, width: w, height: vh });
    }
  } else if (layout === "grid") {
    const cols = count <= 1 ? 1 : 2;
    const rows = Math.ceil(count / cols);
    const w = Math.floor(vw / cols);
    const h = Math.floor(vh / rows);
    for (let i = 0; i < count; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      positions.push({ x: col * w, y: row * h, width: w, height: h });
    }
  } else if (layout === "performance") {
    if (count === 1) {
      positions.push({ x: 0, y: 0, width: vw, height: vh });
    } else {
      const mainW = Math.floor(vw * 0.62);
      const sideW = vw - mainW;
      const sideH = Math.floor(vh / (count - 1));
      positions.push({ x: 0, y: 0, width: mainW, height: vh });
      for (let i = 1; i < count; i++) {
        positions.push({ x: mainW, y: (i - 1) * sideH, width: sideW, height: sideH });
      }
    }
  } else {
    // freeform cascade for panels with no saved position
    for (let i = 0; i < count; i++) {
      positions.push({ x: 20 + i * 28, y: 20 + i * 28, width: 360, height: 400 });
    }
  }
  return positions;
}

// Used whenever the viewport shrinks (e.g. a layout saved on desktop is
// reopened on a phone) so a freeform panel can never end up entirely
// off-screen or larger than the viewport.
export function clampGeometryToViewport(geom, viewport, minWidth, minHeight) {
  const vw = Math.max(1, viewport.width);
  const vh = Math.max(1, viewport.height);
  const width = Math.min(Math.max(geom.width, minWidth), vw);
  const height = Math.min(Math.max(geom.height, minHeight), vh);
  const x = Math.min(Math.max(geom.x, 0), Math.max(0, vw - width));
  const y = Math.min(Math.max(geom.y, 0), Math.max(0, vh - height));
  return { x, y, width, height };
}
