import {
  TILE_BASE_SIZE,
  tileWorldSize,
  tileBBox,
  tilesForBBox,
  viewportWorldBBox,
  type Camera,
} from "../shared/coords.js";
import { renderOperation, renderStroke, renderPixels, renderPixelGrid, type DrawContext2D } from "../shared/draw.js";
import { PALETTE, SIZES } from "../shared/palette.js";
import { WallStore, tileKeyFull } from "./store.js";

/** Must match the server's TILE_PX in src/server/tiles.ts. */
const TILE_PX = 512;
/** Target on-screen size (px) for a background tile - picks the LOD level. */
const TARGET_TILE_SCREEN_PX = 768;

export function chooseLevel(z: number): number {
  const raw = Math.log2(TARGET_TILE_SCREEN_PX / (TILE_BASE_SIZE * z));
  return Math.max(0, Math.min(12, Math.round(raw)));
}

export function visibleTiles(cam: Camera, vw: number, vh: number) {
  const level = chooseLevel(cam.z);
  const bbox = viewportWorldBBox(cam, vw, vh);
  return { level, tiles: tilesForBBox(level, bbox), bbox };
}

export function ensureTileLoaded(store: WallStore, level: number, tx: number, ty: number): void {
  const key = tileKeyFull(level, tx, ty);
  if (store.tileImages.has(key) || store.tileLoading.has(key)) return;
  store.tileLoading.add(key);
  fetch(`/api/tiles/${level}/${tx}/${ty}.png`)
    .then(async (res) => {
      if (!res.ok) return;
      const seq = Number(res.headers.get("x-tile-seq") ?? "0") || 0;
      const blob = await res.blob();
      const bitmap = await createImageBitmap(blob);
      store.registerTileImage(level, tx, ty, bitmap, seq);
    })
    .catch(() => {
      /* silent - next frame will just retry since it stays absent from tileImages */
    })
    .finally(() => store.tileLoading.delete(key));
}

export interface PixelModeState {
  active: boolean;
  cell: number;
}

export function drawFrame(
  ctx: DrawContext2D,
  vw: number,
  vh: number,
  cam: Camera,
  store: WallStore,
  pixelMode: PixelModeState
): void {
  ctx.save();
  ctx.clearRect(0, 0, vw, vh);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, vw, vh);

  const { level, tiles, bbox } = visibleTiles(cam, vw, vh);
  const worldPerLevelTile = tileWorldSize(level);
  const screenPxPerTile = worldPerLevelTile * cam.z;

  for (const t of tiles) {
    ensureTileLoaded(store, level, t.tx, t.ty);
    const image = store.imageFor(level, t.tx, t.ty);
    const b = tileBBox(t);
    const sx = (b.minX - cam.x) * cam.z + vw / 2;
    const sy = (b.minY - cam.y) * cam.z + vh / 2;
    if (image) {
      ctx.save();
      ctx.drawImage(image, sx, sy, screenPxPerTile, screenPxPerTile);
      ctx.restore();
    }
    if (level === 0) {
      const overlay = store.overlayForLevel0(t.tx, t.ty);
      if (overlay.length > 0) {
        const tf = {
          toLocalX: (wx: number) => (wx - cam.x) * cam.z + vw / 2,
          toLocalY: (wy: number) => (wy - cam.y) * cam.z + vh / 2,
          scale: cam.z,
        };
        for (const op of overlay) renderOperation(ctx, op, tf, PALETTE);
      }
    }
  }

  const worldTf = {
    toLocalX: (wx: number) => (wx - cam.x) * cam.z + vw / 2,
    toLocalY: (wy: number) => (wy - cam.y) * cam.z + vh / 2,
    scale: cam.z,
  };

  for (const live of store.liveStrokes.values()) {
    renderStroke(ctx, live, worldTf, PALETTE);
  }

  if (store.localPending) {
    if (store.localPending.type === "stroke") renderStroke(ctx, store.localPending, worldTf, PALETTE);
    else renderPixels(ctx, store.localPending, worldTf, PALETTE);
  }

  if (pixelMode.active) {
    renderPixelGrid(ctx as never, pixelMode.cell, worldTf, bbox);
  }

  ctx.restore();
}
