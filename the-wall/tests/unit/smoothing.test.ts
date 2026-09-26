import { describe, it, expect } from "vitest";
import { smoothPoints, distanceToLine } from "../../src/shared/smoothing.js";
import type { PointSample } from "../../src/shared/types.js";

function pt(x: number, y: number, p = 0.5): PointSample {
  return { x, y, p };
}

describe("smoothPoints", () => {
  it("leaves the endpoints exactly where they were", () => {
    const raw = [pt(0, 0), pt(3, 7), pt(10, -4), pt(20, 20)];
    const smoothed = smoothPoints(raw, 1);
    expect(smoothed[0]).toEqual(raw[0]);
    expect(smoothed[smoothed.length - 1]).toEqual(raw[raw.length - 1]);
  });

  it("leaves an already-straight line unchanged (within floating point tolerance)", () => {
    const raw = [pt(0, 0), pt(1, 1), pt(2, 2), pt(3, 3), pt(4, 4)];
    const smoothed = smoothPoints(raw, 2);
    for (let i = 0; i < raw.length; i++) {
      expect(smoothed[i]!.x).toBeCloseTo(raw[i]!.x, 9);
      expect(smoothed[i]!.y).toBeCloseTo(raw[i]!.y, 9);
    }
  });

  it("pulls a single jittery outlier back toward the line its neighbours describe", () => {
    // A straight-ish line with one point kicked far off to the side.
    const raw = [pt(0, 0), pt(2, 0), pt(4, 30), pt(6, 0), pt(8, 0)];
    const before = distanceToLine(raw[2]!, raw[1]!, raw[3]!);
    const smoothed = smoothPoints(raw, 1);
    const after = distanceToLine(smoothed[2]!, smoothed[1]!, smoothed[3]!);
    expect(after).toBeLessThan(before);
  });

  it("is a no-op on fewer than 3 points", () => {
    const raw = [pt(0, 0), pt(5, 5)];
    expect(smoothPoints(raw, 3)).toEqual(raw);
  });

  it("more passes smooths more (monotonically reduces the outlier's deviation)", () => {
    const raw = [pt(0, 0), pt(2, 0), pt(4, 30), pt(6, 0), pt(8, 0)];
    const dev = (pts: PointSample[]) => distanceToLine(pts[2]!, pts[1]!, pts[3]!);
    const d1 = dev(smoothPoints(raw, 1));
    const d3 = dev(smoothPoints(raw, 3));
    expect(d3).toBeLessThan(d1);
  });
});
