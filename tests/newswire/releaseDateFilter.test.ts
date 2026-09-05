import { describe, it, expect } from "vitest";
import { wasReleasedOn } from "../../src/newswire/weeklyRoundup/releaseDateFilter.js";

const ZONE = "America/Los_Angeles";

describe("wasReleasedOn", () => {
  it("matches an exact-confidence UTC timestamp that falls on the target local date", () => {
    // 2026-09-04T18:00:00Z is 11am PDT (UTC-7) on 2026-09-04.
    const item = { event_time: "2026-09-04T18:00:00.000Z", event_time_confidence: "exact" };
    expect(wasReleasedOn(item, "2026-09-04", ZONE)).toBe(true);
  });

  it("does not match a UTC timestamp that, converted to local time, falls on a different date", () => {
    // 2026-09-05T03:00:00Z is 8pm PDT on 2026-09-04, not 2026-09-05.
    const item = { event_time: "2026-09-05T03:00:00.000Z", event_time_confidence: "exact" };
    expect(wasReleasedOn(item, "2026-09-05", ZONE)).toBe(false);
    expect(wasReleasedOn(item, "2026-09-04", ZONE)).toBe(true);
  });

  it("rejects a date-only match when confidence is only approximate", () => {
    const item = { event_time: "2026-09-04T12:00:00.000Z", event_time_confidence: "approximate" };
    expect(wasReleasedOn(item, "2026-09-04", ZONE)).toBe(false);
  });

  it("rejects unknown confidence", () => {
    const item = { event_time: "2026-09-04T12:00:00.000Z", event_time_confidence: "unknown" };
    expect(wasReleasedOn(item, "2026-09-04", ZONE)).toBe(false);
  });

  it("rejects a null event_time even if confidence is somehow exact", () => {
    const item = { event_time: null, event_time_confidence: "exact" };
    expect(wasReleasedOn(item, "2026-09-04", ZONE)).toBe(false);
  });

  it("rejects an earlier date, even a few days prior", () => {
    const item = { event_time: "2026-09-01T12:00:00.000Z", event_time_confidence: "exact" };
    expect(wasReleasedOn(item, "2026-09-04", ZONE)).toBe(false);
  });

  it("rejects an unparseable event_time string", () => {
    const item = { event_time: "not-a-date", event_time_confidence: "exact" };
    expect(wasReleasedOn(item, "2026-09-04", ZONE)).toBe(false);
  });
});
