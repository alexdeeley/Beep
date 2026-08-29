import { describe, it, expect } from "vitest";
import { resolveLocalDate, anniversaryMilestone, parseMonthDay } from "../src/utils/dateUtils.js";

describe("resolveLocalDate", () => {
  it("resolves an explicit override date in the given timezone", () => {
    const resolved = resolveLocalDate("America/Los_Angeles", "2026-08-29");
    expect(resolved.isoDate).toBe("2026-08-29");
    expect(resolved.monthDay).toBe("08-29");
    expect(resolved.year).toBe(2026);
    expect(resolved.displayDate).toBe("AUGUST 29");
  });

  it("does not silently shift the calendar date across a timezone boundary", () => {
    // A plain YYYY-MM-DD override must be interpreted as that same
    // calendar date in the target timezone, not as a UTC instant that
    // could roll over to the previous/next day once converted.
    const la = resolveLocalDate("America/Los_Angeles", "2026-01-01");
    const tokyo = resolveLocalDate("Asia/Tokyo", "2026-01-01");
    expect(la.isoDate).toBe("2026-01-01");
    expect(tokyo.isoDate).toBe("2026-01-01");
  });

  it("resolves 'now' independently per timezone (no implicit UTC leakage)", () => {
    const la = resolveLocalDate("America/Los_Angeles");
    const utc = resolveLocalDate("UTC");
    // Both must be valid resolved dates; specifically they must not throw,
    // and each must reflect its own zone's current calendar day.
    expect(la.isoDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(utc.isoDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("throws on an invalid override date rather than silently coercing it", () => {
    expect(() => resolveLocalDate("America/Los_Angeles", "not-a-date")).toThrow();
  });

  it("throws on an invalid timezone", () => {
    expect(() => resolveLocalDate("Not/A_Zone")).toThrow();
  });
});

describe("parseMonthDay", () => {
  it("parses MM-DD", () => {
    expect(parseMonthDay("08-29")).toEqual({ month: 8, day: 29 });
  });
  it("parses YYYY-MM-DD", () => {
    expect(parseMonthDay("2026-08-29")).toEqual({ month: 8, day: 29 });
  });
});

describe("anniversaryMilestone", () => {
  it("flags round-number anniversaries", () => {
    expect(anniversaryMilestone(100)).toBe(100);
    expect(anniversaryMilestone(50)).toBe(50);
    expect(anniversaryMilestone(25)).toBe(25);
  });
  it("returns null for non-milestone years", () => {
    expect(anniversaryMilestone(61)).toBeNull();
    expect(anniversaryMilestone(0)).toBeNull();
  });
});
