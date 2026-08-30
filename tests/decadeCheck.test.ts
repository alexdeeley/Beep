import { describe, it, expect } from "vitest";
import { isDecadeWeek } from "../src/weeklyCard/decadeCheck.js";

const ANCHOR = "2026-08-30";

describe("isDecadeWeek", () => {
  it("fires on the first Sunday on/after the 10-year anniversary of the anchor date", () => {
    expect(isDecadeWeek("2036-08-31", ANCHOR)).toBe(true);
  });

  it("fires on the first Sunday on/after the 20-year anniversary", () => {
    expect(isDecadeWeek("2046-09-02", ANCHOR)).toBe(true);
  });

  it("does not fire on the Sunday before a decade anniversary", () => {
    expect(isDecadeWeek("2036-08-24", ANCHOR)).toBe(false);
  });

  it("does not fire more than a week after a decade anniversary", () => {
    expect(isDecadeWeek("2036-09-07", ANCHOR)).toBe(false);
  });

  it("does not fire on a non-decade (5-year) anniversary", () => {
    expect(isDecadeWeek("2031-08-30", ANCHOR)).toBe(false);
  });

  it("does not fire on the anchor date itself (year zero)", () => {
    expect(isDecadeWeek(ANCHOR, ANCHOR)).toBe(false);
  });

  it("does not fire before the anchor date", () => {
    expect(isDecadeWeek("2016-08-30", ANCHOR)).toBe(false);
  });

  it("returns false for an invalid date rather than throwing", () => {
    expect(isDecadeWeek("not-a-date", ANCHOR)).toBe(false);
  });
});
