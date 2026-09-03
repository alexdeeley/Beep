import { DateTime } from "luxon";
import type { EditorialFocus } from "../editorialFocus.js";
import type { QuietHoursOutcome } from "../types.js";

export interface QuietHoursDecision {
  outcome: QuietHoursOutcome;
  /** Minimum importance score an item must clear to be included in this hour's edition, given the outcome. */
  minImportanceScore: number;
  localHour: number;
}

/**
 * Pure function: given the configured quiet-hours window and the top
 * importance score found this run, decides how cautious this hour's
 * edition should be. Three outcomes:
 *
 * - "normal": outside the configured slow window, OR inside it but the
 *   top story is important enough (>= minImportanceScoreDuringSilentThreshold)
 *   to justify posting as usual regardless of the hour - genuine breaking
 *   news is not held back until morning.
 * - "slow": inside the slow window, nothing cleared the high bar above,
 *   but at least something clears the moderate minImportanceScoreDuringSlow
 *   bar - post, but only the item(s) that clear it.
 * - "silent": inside the slow window and nothing clears even the moderate
 *   bar - stay quiet. This is an expected, healthy outcome, not a failure.
 *
 * `topImportanceScore` is null when there is nothing at all to consider
 * (e.g. discovery/verification found nothing) - always resolves to
 * "silent" (inside the window) or "normal" (outside it, with nothing to
 * post so the caller's downstream posting step is simply a no-op).
 */
export function resolveQuietHoursOutcome(
  focus: EditorialFocus,
  now: Date,
  topImportanceScore: number | null
): QuietHoursDecision {
  const dt = DateTime.fromJSDate(now, { zone: focus.quietHours.timezone });
  const localHour = dt.hour;
  const inWindow = isHourInWindow(localHour, focus.quietHours.slowStartHourLocal, focus.quietHours.slowEndHourLocal);

  if (!inWindow) {
    return { outcome: "normal", minImportanceScore: 0, localHour };
  }

  if (topImportanceScore !== null && topImportanceScore >= focus.quietHours.minImportanceScoreDuringSilentThreshold) {
    return { outcome: "normal", minImportanceScore: focus.quietHours.minImportanceScoreDuringSilentThreshold, localHour };
  }
  if (topImportanceScore !== null && topImportanceScore >= focus.quietHours.minImportanceScoreDuringSlow) {
    return { outcome: "slow", minImportanceScore: focus.quietHours.minImportanceScoreDuringSlow, localHour };
  }
  return { outcome: "silent", minImportanceScore: focus.quietHours.minImportanceScoreDuringSlow, localHour };
}

/** Handles a window that wraps past midnight (e.g. 23 -> 6) as well as one that doesn't. */
function isHourInWindow(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}
