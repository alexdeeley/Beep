import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import { resolveEligiblePostingWindow } from "../../src/newswire/quietHours/postingWindow.js";

const ZONE = "America/Los_Angeles";

function localAt(iso: string): DateTime {
  return DateTime.fromISO(iso, { zone: ZONE });
}

describe("resolveEligiblePostingWindow", () => {
  it("matches exactly on the target hour", () => {
    const window = resolveEligiblePostingWindow(localAt("2026-09-06T08:00:00"), [8, 20], 6);
    expect(window?.hour).toBe(8);
    expect(window?.toISODate()).toBe("2026-09-06");
  });

  it("matches within tolerance after the target hour (the delayed-cron case)", () => {
    const window = resolveEligiblePostingWindow(localAt("2026-09-06T10:30:00"), [8, 20], 6);
    expect(window?.hour).toBe(8);
  });

  it("does not match right at the tolerance boundary", () => {
    // Exactly 6 hours after 8:00 is 14:00 - the window is [8, 8+tolerance), so 14:00 itself is excluded.
    expect(resolveEligiblePostingWindow(localAt("2026-09-06T14:00:00"), [8, 20], 6)).toBeNull();
  });

  it("matches just inside the tolerance boundary", () => {
    const window = resolveEligiblePostingWindow(localAt("2026-09-06T13:59:00"), [8, 20], 6);
    expect(window?.hour).toBe(8);
  });

  it("returns null well before any target hour (genuinely off-hours)", () => {
    expect(resolveEligiblePostingWindow(localAt("2026-09-06T03:00:00"), [8, 20], 6)).toBeNull();
  });

  it("returns null well after a target hour's tolerance has elapsed but before the next one", () => {
    expect(resolveEligiblePostingWindow(localAt("2026-09-06T16:00:00"), [8, 20], 6)).toBeNull();
  });

  it("resolves the 20:00 window correctly, including wrapping past midnight", () => {
    const atTarget = resolveEligiblePostingWindow(localAt("2026-09-06T20:00:00"), [8, 20], 6);
    expect(atTarget?.hour).toBe(20);
    expect(atTarget?.toISODate()).toBe("2026-09-06");

    // 1am the next calendar day is still within 6 hours of the PRIOR day's 20:00 crossing.
    const pastMidnight = resolveEligiblePostingWindow(localAt("2026-09-07T01:00:00"), [8, 20], 6);
    expect(pastMidnight?.hour).toBe(20);
    expect(pastMidnight?.toISODate()).toBe("2026-09-06");
  });

  it("picks the most recent crossing when tolerance is wide enough to overlap two target hours", () => {
    // With an unusually wide 14-hour tolerance, 20:00 is within 14h of BOTH the prior 8:00 crossing and
    // its own 20:00 crossing - the more recent (20:00 same day) should win.
    const window = resolveEligiblePostingWindow(localAt("2026-09-06T20:00:00"), [8, 20], 14);
    expect(window?.hour).toBe(20);
    expect(window?.toISODate()).toBe("2026-09-06");
  });
});
