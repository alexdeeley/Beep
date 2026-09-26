import { describe, it, expect } from "vitest";
import { validateOperation } from "../../src/shared/validate.js";
import { MAX_POINTS_PER_STROKE, MAX_CELLS_PER_PIXELS_OP } from "../../src/shared/types.js";

const ID = "11111111-1111-1111-1111-111111111111";
const SESSION = "session-abc";
const BBOX = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

function validStroke(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    type: "stroke",
    session: SESSION,
    color: 0,
    size: 0,
    points: [{ x: 0, y: 0, p: 0.5 }],
    bbox: BBOX,
    ...overrides,
  };
}

describe("validateOperation - malformed input", () => {
  it("rejects non-objects", () => {
    expect(validateOperation(null).ok).toBe(false);
    expect(validateOperation("hello").ok).toBe(false);
    expect(validateOperation(42).ok).toBe(false);
    expect(validateOperation(undefined).ok).toBe(false);
  });

  it("rejects a missing/malformed id", () => {
    expect(validateOperation(validStroke({ id: "not-a-uuid" })).ok).toBe(false);
    expect(validateOperation(validStroke({ id: 12345 })).ok).toBe(false);
    expect(validateOperation(validStroke({ id: undefined })).ok).toBe(false);
  });

  it("rejects an unknown operation type", () => {
    expect(validateOperation(validStroke({ type: "delete-everything" })).ok).toBe(false);
  });
});

describe("validateOperation - palette indexes", () => {
  it("rejects a negative colour index", () => {
    expect(validateOperation(validStroke({ color: -1 })).ok).toBe(false);
  });
  it("rejects a colour index past the end of the palette", () => {
    expect(validateOperation(validStroke({ color: 9 })).ok).toBe(false);
  });
  it("rejects a non-integer colour index", () => {
    expect(validateOperation(validStroke({ color: 1.5 })).ok).toBe(false);
  });
  it("accepts every valid palette index 0..8", () => {
    for (let c = 0; c <= 8; c++) {
      expect(validateOperation(validStroke({ color: c })).ok).toBe(true);
    }
  });
  it("rejects an out-of-range brush size index", () => {
    expect(validateOperation(validStroke({ size: 4 })).ok).toBe(false);
    expect(validateOperation(validStroke({ size: -1 })).ok).toBe(false);
  });
});

describe("validateOperation - oversized strokes", () => {
  it("accepts exactly MAX_POINTS_PER_STROKE points", () => {
    const points = Array.from({ length: MAX_POINTS_PER_STROKE }, (_, i) => ({ x: i, y: 0, p: 0.5 }));
    expect(validateOperation(validStroke({ points })).ok).toBe(true);
  });
  it("rejects one point over the cap", () => {
    const points = Array.from({ length: MAX_POINTS_PER_STROKE + 1 }, (_, i) => ({ x: i, y: 0, p: 0.5 }));
    expect(validateOperation(validStroke({ points })).ok).toBe(false);
  });
  it("rejects an empty points array", () => {
    expect(validateOperation(validStroke({ points: [] })).ok).toBe(false);
  });
  it("rejects a point with a pressure outside 0..1", () => {
    expect(validateOperation(validStroke({ points: [{ x: 0, y: 0, p: 1.5 }] })).ok).toBe(false);
    expect(validateOperation(validStroke({ points: [{ x: 0, y: 0, p: -0.1 }] })).ok).toBe(false);
  });
  it("rejects a point with a coordinate far outside the world bound", () => {
    expect(validateOperation(validStroke({ points: [{ x: 1e12, y: 0, p: 0.5 }] })).ok).toBe(false);
  });
  it("rejects a point missing a required field", () => {
    expect(validateOperation(validStroke({ points: [{ x: 0, p: 0.5 }] })).ok).toBe(false);
  });
});

describe("validateOperation - pixels", () => {
  function validPixels(overrides: Record<string, unknown> = {}) {
    return {
      id: ID,
      type: "pixels",
      session: SESSION,
      color: 1,
      cell: 2,
      cells: [[0, 0]],
      bbox: BBOX,
      ...overrides,
    };
  }
  it("rejects a non-standard cell size", () => {
    expect(validateOperation(validPixels({ cell: 3 })).ok).toBe(false);
  });
  it("accepts every standard cell size", () => {
    for (const cell of [1, 2, 4, 8]) {
      expect(validateOperation(validPixels({ cell })).ok).toBe(true);
    }
  });
  it("rejects too many cells", () => {
    const cells = Array.from({ length: MAX_CELLS_PER_PIXELS_OP + 1 }, (_, i) => [i, 0]);
    expect(validateOperation(validPixels({ cells })).ok).toBe(false);
  });
  it("rejects non-integer cell coordinates", () => {
    expect(validateOperation(validPixels({ cells: [[0.5, 0]] })).ok).toBe(false);
  });
});

describe("validateOperation - hide", () => {
  it("accepts a hide referencing earlier op ids", () => {
    const op = { id: ID, type: "hide", session: SESSION, color: 0, targetIds: [ID], bbox: BBOX };
    expect(validateOperation(op).ok).toBe(true);
  });
  it("rejects a hide with no targets", () => {
    const op = { id: ID, type: "hide", session: SESSION, color: 0, targetIds: [], bbox: BBOX };
    expect(validateOperation(op).ok).toBe(false);
  });
  it("rejects a hide targeting a malformed id", () => {
    const op = { id: ID, type: "hide", session: SESSION, color: 0, targetIds: ["not-a-uuid"], bbox: BBOX };
    expect(validateOperation(op).ok).toBe(false);
  });
});

describe("validateOperation - bbox", () => {
  it("rejects an inverted bbox", () => {
    expect(validateOperation(validStroke({ bbox: { minX: 10, minY: 0, maxX: 0, maxY: 10 } })).ok).toBe(false);
  });
  it("rejects a non-finite bbox value", () => {
    expect(validateOperation(validStroke({ bbox: { minX: NaN, minY: 0, maxX: 10, maxY: 10 } })).ok).toBe(false);
    expect(validateOperation(validStroke({ bbox: { minX: Infinity, minY: 0, maxX: 10, maxY: 10 } })).ok).toBe(false);
  });
});
