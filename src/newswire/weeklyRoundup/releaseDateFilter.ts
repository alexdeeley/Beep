import { DateTime } from "luxon";

/** The subset of a music_items/industry_release_items row this filter actually needs. */
export interface EventTimeInfo {
  event_time: string | null;
  event_time_confidence: string;
}

/**
 * True only if this item's independently-verified event_time falls on
 * exactly the given local calendar date. NEW MUSIC FRIDAY is meant to be
 * a snapshot of what actually came out today, not an accumulated backlog
 * of anything unposted - an album discovered late (rotation lag, a slow
 * news cycle) but that actually released on a different day must NOT
 * show up under today's date just because it happened to still be
 * sitting unposted. Deliberately strict: an "approximate" or "unknown"
 * confidence, or a missing event_time, is NOT good enough to claim "this
 * came out today" - it's excluded (left unposted; it simply won't be
 * eligible for this or a future Friday unless its date is later
 * confirmed as matching one exactly).
 */
export function wasReleasedOn(item: EventTimeInfo, isoDate: string, zone: string): boolean {
  if (item.event_time_confidence !== "exact" || !item.event_time) return false;
  const parsed = DateTime.fromISO(item.event_time, { zone });
  return parsed.isValid && parsed.toISODate() === isoDate;
}
