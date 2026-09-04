import { describe, it, expect } from "vitest";
import { resolveQuietHoursOutcome } from "../../src/newswire/quietHours/quietHoursPolicy.js";
import type { EditorialFocus } from "../../src/newswire/editorialFocus.js";

function makeFocus(overrides: Partial<EditorialFocus["quietHours"]> = {}): EditorialFocus {
  return {
    $schemaVersion: 2,
    neutralityNote: "",
    quietHours: {
      timezone: "America/Los_Angeles",
      slowStartHourLocal: 23,
      slowEndHourLocal: 6,
      minImportanceScoreDuringSlow: 0.6,
      minImportanceScoreDuringSilentThreshold: 0.85,
      ...overrides,
    },
    voice: { allowJokes: false, allowHashtagsInline: false, allowEmoji: false, allowRhetoricalQuestions: false },
  };
}

// 2026-09-03T09:00:00Z is 2am America/Los_Angeles (PDT, UTC-7) - inside the default 23:00-06:00 window.
const TWO_AM_PT = new Date("2026-09-03T09:00:00Z");
// 2026-09-03T21:00:00Z is 2pm America/Los_Angeles - outside the window.
const TWO_PM_PT = new Date("2026-09-03T21:00:00Z");

describe("resolveQuietHoursOutcome", () => {
  it("is silent inside the quiet window with no score at all", () => {
    const result = resolveQuietHoursOutcome(makeFocus(), TWO_AM_PT, null);
    expect(result.outcome).toBe("silent");
    expect(result.localHour).toBe(2);
  });

  it("is silent inside the quiet window when the top score is below the slow bar", () => {
    const result = resolveQuietHoursOutcome(makeFocus(), TWO_AM_PT, 0.3);
    expect(result.outcome).toBe("silent");
  });

  it("is slow inside the quiet window when the top score clears the slow bar but not the silent-override bar", () => {
    const result = resolveQuietHoursOutcome(makeFocus(), TWO_AM_PT, 0.7);
    expect(result.outcome).toBe("slow");
  });

  it("is normal inside the quiet window when the top score clears the silent-override bar (breaking news)", () => {
    const result = resolveQuietHoursOutcome(makeFocus(), TWO_AM_PT, 0.9);
    expect(result.outcome).toBe("normal");
  });

  it("is exactly at the slow-bar boundary treated as slow (inclusive)", () => {
    const result = resolveQuietHoursOutcome(makeFocus(), TWO_AM_PT, 0.6);
    expect(result.outcome).toBe("slow");
  });

  it("is exactly at the silent-override boundary treated as normal (inclusive)", () => {
    const result = resolveQuietHoursOutcome(makeFocus(), TWO_AM_PT, 0.85);
    expect(result.outcome).toBe("normal");
  });

  it("is always normal outside the quiet window regardless of score", () => {
    expect(resolveQuietHoursOutcome(makeFocus(), TWO_PM_PT, null).outcome).toBe("normal");
    expect(resolveQuietHoursOutcome(makeFocus(), TWO_PM_PT, 0.01).outcome).toBe("normal");
  });

  it("handles a window that does not wrap midnight", () => {
    const focus = makeFocus({ slowStartHourLocal: 1, slowEndHourLocal: 5 });
    // 2am PT is inside [1,5); 2pm PT is outside.
    expect(resolveQuietHoursOutcome(focus, TWO_AM_PT, null).outcome).toBe("silent");
    expect(resolveQuietHoursOutcome(focus, TWO_PM_PT, null).outcome).toBe("normal");
  });

  it("treats a zero-width window (start === end) as never in the quiet window", () => {
    const focus = makeFocus({ slowStartHourLocal: 3, slowEndHourLocal: 3 });
    expect(resolveQuietHoursOutcome(focus, TWO_AM_PT, null).outcome).toBe("normal");
  });
});
