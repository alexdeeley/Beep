import { describe, it, expect } from "vitest";
import {
  screenToWorld,
  worldToScreen,
  zoomAroundScreenPoint,
  tileWorldSize,
  worldToTile,
  tileBBox,
  tilesForBBox,
  parentTile,
  childTiles,
  quantize,
  type Camera,
} from "../../src/shared/coords.js";

describe("screenToWorld / worldToScreen round-trip", () => {
  it("is a perfect inverse for arbitrary cameras and points", () => {
    const cams: Camera[] = [
      { x: 0, y: 0, z: 1 },
      { x: 512, y: -230, z: 2.5 },
      { x: -9999, y: 4321, z: 0.1 },
    ];
    for (const cam of cams) {
      for (const [sx, sy] of [
        [0, 0],
        [400, 300],
        [1920, 1080],
      ]) {
        const w = screenToWorld(cam, 1000, 800, sx!, sy!);
        const back = worldToScreen(cam, 1000, 800, w.x, w.y);
        expect(back.x).toBeCloseTo(sx!, 9);
        expect(back.y).toBeCloseTo(sy!, 9);
      }
    }
  });
});

describe("zoomAroundScreenPoint keeps the world point under the cursor fixed", () => {
  it("holds for zooming in", () => {
    const cam: Camera = { x: 100, y: 50, z: 1 };
    const vw = 1024,
      vh = 768;
    const screenPoint = { x: 300, y: 200 };
    const before = screenToWorld(cam, vw, vh, screenPoint.x, screenPoint.y);
    const after = zoomAroundScreenPoint(cam, vw, vh, screenPoint.x, screenPoint.y, cam.z * 3.7);
    const worldAfter = screenToWorld(after, vw, vh, screenPoint.x, screenPoint.y);
    expect(worldAfter.x).toBeCloseTo(before.x, 9);
    expect(worldAfter.y).toBeCloseTo(before.y, 9);
  });

  it("holds for zooming out", () => {
    const cam: Camera = { x: -4000, y: 8000, z: 5 };
    const vw = 800,
      vh = 600;
    const screenPoint = { x: 12, y: 590 };
    const before = screenToWorld(cam, vw, vh, screenPoint.x, screenPoint.y);
    const after = zoomAroundScreenPoint(cam, vw, vh, screenPoint.x, screenPoint.y, cam.z * 0.2);
    const worldAfter = screenToWorld(after, vw, vh, screenPoint.x, screenPoint.y);
    expect(worldAfter.x).toBeCloseTo(before.x, 9);
    expect(worldAfter.y).toBeCloseTo(before.y, 9);
  });

  it("holds across repeated incremental zoom steps (as a wheel gesture would apply it)", () => {
    let cam: Camera = { x: 17, y: -42, z: 1 };
    const vw = 1000,
      vh = 700;
    const point = { x: 640, y: 210 };
    const worldAnchor = screenToWorld(cam, vw, vh, point.x, point.y);
    for (let i = 0; i < 30; i++) {
      cam = zoomAroundScreenPoint(cam, vw, vh, point.x, point.y, cam.z * 1.08);
    }
    const worldNow = screenToWorld(cam, vw, vh, point.x, point.y);
    expect(worldNow.x).toBeCloseTo(worldAnchor.x, 6);
    expect(worldNow.y).toBeCloseTo(worldAnchor.y, 6);
  });
});

describe("quantize", () => {
  it("snaps to the nearest 1/16 world unit", () => {
    expect(quantize(1.03)).toBeCloseTo(1, 9); // 1.03*16=16.48 -> rounds to 16 -> 16/16 = 1
    expect(quantize(0)).toBe(0);
    expect(quantize(-0.02)).toBeCloseTo(0, 9);
  });
});

describe("tile pyramid math", () => {
  it("doubles side length (quadruples area) per level", () => {
    expect(tileWorldSize(0)).toBe(512);
    expect(tileWorldSize(1)).toBe(1024);
    expect(tileWorldSize(2)).toBe(2048);
  });

  it("maps a world point to the tile that contains it", () => {
    expect(worldToTile(0, 0, 0)).toEqual({ level: 0, tx: 0, ty: 0 });
    expect(worldToTile(0, 511, 511)).toEqual({ level: 0, tx: 0, ty: 0 });
    expect(worldToTile(0, 512, 0)).toEqual({ level: 0, tx: 1, ty: 0 });
    expect(worldToTile(0, -1, -1)).toEqual({ level: 0, tx: -1, ty: -1 });
  });

  it("tileBBox and worldToTile are consistent", () => {
    const t = { level: 0, tx: 3, ty: -2 };
    const b = tileBBox(t);
    const mid = worldToTile(0, (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
    expect(mid).toEqual(t);
  });

  it("finds every level-0 tile a stroke crossing a tile boundary touches", () => {
    // A bbox straddling the boundary between tile (0,0) and (1,0) at x=512.
    const tiles = tilesForBBox(0, { minX: 500, minY: 10, maxX: 530, maxY: 20 });
    const keys = tiles.map((t) => `${t.tx},${t.ty}`).sort();
    expect(keys).toEqual(["0,0", "1,0"]);
  });

  it("finds all 4 tiles when a bbox straddles a 4-way corner", () => {
    const tiles = tilesForBBox(0, { minX: 500, minY: 500, maxX: 530, maxY: 530 });
    const keys = tiles.map((t) => `${t.tx},${t.ty}`).sort();
    expect(keys).toEqual(["0,0", "0,1", "1,0", "1,1"]);
  });

  it("parentTile / childTiles are inverses", () => {
    const t = { level: 0, tx: 5, ty: -3 };
    const parent = parentTile(t);
    const kids = childTiles(parent);
    expect(kids).toContainEqual(t);
  });
});
