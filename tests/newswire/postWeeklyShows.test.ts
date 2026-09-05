import { describe, it, expect } from "vitest";
import { formatShowDate, localCalendarDate } from "../../src/newswire/shows/postWeeklyShows.js";

describe("formatShowDate", () => {
  it("formats a bare date as 'Month Day'", () => {
    expect(formatShowDate("2026-09-07")).toBe("Sept 7");
  });

  it("keeps the wall-clock calendar date for a timestamp with an explicit offset, regardless of server timezone", () => {
    // 7pm Pacific on Sept 11 - naively converting to UTC (no offset kept) would push this to Sept 12.
    expect(formatShowDate("2026-09-11T19:00:00-07:00")).toBe("Sept 11");
  });

  it("does not shift a late-evening Pacific show across midnight UTC", () => {
    // 11pm Pacific on Sept 30 is already the next UTC day (Oct 1) - confirms setZone:true, not the
    // system zone, is what's driving the month/day extraction.
    expect(formatShowDate("2026-09-30T23:00:00-07:00")).toBe("Sept 30");
  });
});

describe("localCalendarDate", () => {
  it("collapses a bare date and an offset timestamp for the same day to the same key", () => {
    expect(localCalendarDate("2026-09-11")).toBe(localCalendarDate("2026-09-11T19:00:00-07:00"));
  });

  it("returns distinct keys for genuinely different days", () => {
    expect(localCalendarDate("2026-09-11")).not.toBe(localCalendarDate("2026-09-12"));
  });
});
