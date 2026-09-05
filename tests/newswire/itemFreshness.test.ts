import { describe, it, expect } from "vitest";
import { isFreshEnough } from "../../src/newswire/verification/itemFreshness.js";

const NOW = new Date("2026-09-05T12:00:00Z");

describe("isFreshEnough", () => {
  it("rejects an exact-confidence date well past the max age (the six-months-old release case)", () => {
    expect(isFreshEnough("2026-03-05T00:00:00Z", "exact", NOW, 30)).toBe(false);
  });

  it("accepts an exact-confidence date within the max age", () => {
    expect(isFreshEnough("2026-09-01T00:00:00Z", "exact", NOW, 30)).toBe(true);
  });

  it("accepts a date exactly at the boundary", () => {
    const exactlyMaxAge = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(isFreshEnough(exactlyMaxAge, "exact", NOW, 30)).toBe(true);
  });

  it("rejects a date one day past the boundary", () => {
    const overMaxAge = new Date(NOW.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString();
    expect(isFreshEnough(overMaxAge, "exact", NOW, 30)).toBe(false);
  });

  it("passes through an approximate-confidence stale date rather than blocking on an uncertain guess", () => {
    expect(isFreshEnough("2026-01-01T00:00:00Z", "approximate", NOW, 30)).toBe(true);
  });

  it("passes through an unknown-confidence date", () => {
    expect(isFreshEnough("2026-01-01T00:00:00Z", "unknown", NOW, 30)).toBe(true);
  });

  it("passes through a null date", () => {
    expect(isFreshEnough(null, "exact", NOW, 30)).toBe(true);
  });

  it("passes through an unparseable date string", () => {
    expect(isFreshEnough("not-a-date", "exact", NOW, 30)).toBe(true);
  });
});
