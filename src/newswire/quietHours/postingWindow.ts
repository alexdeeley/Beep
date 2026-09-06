import { DateTime } from "luxon";

/**
 * Confirmed live: GitHub Actions has no SLA on scheduled workflow timing, and this pipeline's cron has
 * been observed firing 2.5-4 hours late against its target (an 8am-local cron actually executing
 * ~10:30am local). The original gate required the CURRENT local hour to exactly equal a target hour
 * (8 or 20) - a delayed firing landing on any other hour was silently treated as "off-hours" and
 * skipped entirely, which meant the account went a full day without posting anything once every
 * recent scheduled run started missing its window. This tolerance absorbs that delay instead of
 * requiring exact-hour luck.
 */
export const DEFAULT_POSTING_WINDOW_TOLERANCE_HOURS = 6;

/**
 * Finds the most recent target-hour "crossing" (today's or, if that hasn't happened yet, yesterday's)
 * that `nowLocal` currently falls within `toleranceHours` of - e.g. for target hour 8 and a 6-hour
 * tolerance, any local time from 8:00 through 13:59 resolves to today's 8:00 crossing. Returns null if
 * `nowLocal` isn't within tolerance of ANY target hour, in which case the cycle should stay a cheap,
 * DB-untouched no-op exactly as before. When multiple target hours all match (only possible with an
 * unreasonably large tolerance relative to the gap between target hours), the most recent crossing
 * wins.
 */
export function resolveEligiblePostingWindow(
  nowLocal: DateTime,
  postingHoursLocal: number[],
  toleranceHours: number = DEFAULT_POSTING_WINDOW_TOLERANCE_HOURS
): DateTime | null {
  let best: DateTime | null = null;

  for (const targetHour of postingHoursLocal) {
    let windowStart = nowLocal.set({ hour: targetHour, minute: 0, second: 0, millisecond: 0 });
    if (windowStart > nowLocal) windowStart = windowStart.minus({ days: 1 });

    const hoursSinceWindowStart = nowLocal.diff(windowStart, "hours").hours;
    if (hoursSinceWindowStart >= 0 && hoursSinceWindowStart < toleranceHours) {
      if (!best || windowStart > best) best = windowStart;
    }
  }

  return best;
}
