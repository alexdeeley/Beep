import { describe, it, expect } from "vitest";
import { WallStore } from "../../src/client/store.js";
import type { Operation } from "../../src/shared/types.js";

function stroke(id: string, seq: number, x = 0): Operation {
  return {
    id,
    seq,
    ts: Date.now(),
    type: "stroke",
    session: "s",
    color: 0,
    size: 0,
    points: [{ x, y: 0, p: 0.5 }],
    bbox: { minX: x, minY: 0, maxX: x, maxY: 0 },
  };
}

describe("WallStore.addCommitted - dedup and ordering", () => {
  it("applying the same operation id twice is a no-op the second time", () => {
    const store = new WallStore();
    const op = stroke("11111111-1111-1111-1111-111111111111", 1);
    store.addCommitted(op);
    store.addCommitted(op);
    store.addCommitted({ ...op }); // a structurally-identical but distinct object, same id
    expect(store.knownIds.size).toBe(1);
    expect(store.headSeq).toBe(1);
  });

  it("tracks headSeq as the maximum seq seen, regardless of arrival order", () => {
    const store = new WallStore();
    store.addCommitted(stroke("11111111-1111-1111-1111-111111111111", 5));
    store.addCommitted(stroke("22222222-2222-2222-2222-222222222222", 2));
    store.addCommitted(stroke("33333333-3333-3333-3333-333333333333", 9));
    store.addCommitted(stroke("44444444-4444-4444-4444-444444444444", 3));
    expect(store.headSeq).toBe(9);
  });

  it("out-of-order arrival still results in every distinct operation being known", () => {
    const store = new WallStore();
    const ids = ["a1111111-1111-1111-1111-111111111111", "b2222222-2222-2222-2222-222222222222", "c3333333-3333-3333-3333-333333333333"];
    const seqOrder = [3, 1, 2];
    ids.forEach((id, i) => store.addCommitted(stroke(id, seqOrder[i]!, i)));
    expect(store.knownIds.size).toBe(3);
    for (const id of ids) expect(store.knownIds.has(id)).toBe(true);
  });

  it("a committed operation clears any matching live-stroke preview for the same id", () => {
    const store = new WallStore();
    const id = "d4444444-4444-4444-4444-444444444444";
    store.liveStrokes.set(id, { session: "s", color: 0, size: 0, points: [] });
    store.addCommitted(stroke(id, 1));
    expect(store.liveStrokes.has(id)).toBe(false);
  });
});
