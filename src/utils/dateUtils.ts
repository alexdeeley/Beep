import { DateTime } from "luxon";

/**
 * All "what day is it" decisions must go through here. We never use
 * `new Date()` + UTC fields directly anywhere else in the pipeline,
 * because the server running the scheduler (GitHub Actions runners are
 * UTC) can be on a different calendar day than America/Los_Angeles,
 * especially overnight and around DST transitions.
 */

export interface ResolvedDate {
  /** YYYY-MM-DD in the target timezone. */
  isoDate: string;
  /** MM-DD, used to match "on this day" historical facts. */
  monthDay: string;
  year: number;
  month: number;
  day: number;
  weekday: string;
  /** "AUGUST 29" style display string. */
  displayDate: string;
  timezone: string;
  /**
   * True when isoDate is the actual current calendar date in `timezone` -
   * false for a --date override pointing at a different day (past or
   * future). Used to decide whether the art's subject matter should be
   * today's live trending topics (real daily production, where the date
   * is always today) or content independently researched for that
   * specific date (a test/backfill run for a date that isn't today).
   */
  isToday: boolean;
}

/**
 * Resolve the local calendar date in `timezone` for "now", or for an
 * explicit override (used by CLI --date flags and tests). An override
 * is interpreted as a plain calendar date (YYYY-MM-DD), not a UTC instant.
 */
export function resolveLocalDate(timezone: string, override?: string): ResolvedDate {
  let dt: DateTime;
  if (override) {
    dt = DateTime.fromISO(override, { zone: timezone });
    if (!dt.isValid) {
      throw new Error(`Invalid --date override "${override}": ${dt.invalidReason} ${dt.invalidExplanation ?? ""}`);
    }
  } else {
    dt = DateTime.now().setZone(timezone);
    if (!dt.isValid) {
      throw new Error(`Invalid timezone "${timezone}": ${dt.invalidReason}`);
    }
  }

  const isoDate = dt.toFormat("yyyy-LL-dd");
  const monthDay = dt.toFormat("LL-dd");
  const todayIsoDate = DateTime.now().setZone(timezone).toFormat("yyyy-LL-dd");

  return {
    isoDate,
    monthDay,
    year: dt.year,
    month: dt.month,
    day: dt.day,
    weekday: dt.toFormat("cccc"),
    displayDate: dt.toFormat("LLLL d").toUpperCase(),
    timezone,
    isToday: isoDate === todayIsoDate,
  };
}

/** Parse a "MM-DD" or "YYYY-MM-DD" string back into month/day integers. */
export function parseMonthDay(value: string): { month: number; day: number } {
  const parts = value.includes("-") ? value.split("-") : [];
  if (parts.length === 2) {
    const [m, d] = parts;
    return { month: Number.parseInt(m!, 10), day: Number.parseInt(d!, 10) };
  }
  if (parts.length === 3) {
    const [, m, d] = parts;
    return { month: Number.parseInt(m!, 10), day: Number.parseInt(d!, 10) };
  }
  throw new Error(`Cannot parse month-day from "${value}"`);
}

export function nowIso(): string {
  return DateTime.now().toISO() ?? new Date().toISOString();
}

/** Compute how many whole years separate `eventYear` from `currentYear`. */
export function yearsSince(eventYear: number, currentYear: number): number {
  return currentYear - eventYear;
}

const MILESTONE_ANNIVERSARIES = [25, 50, 75, 100, 125, 150, 175, 200, 250, 300, 400, 500];

/** Returns the milestone anniversary number if `years` lands on one, else null. */
export function anniversaryMilestone(years: number): number | null {
  return MILESTONE_ANNIVERSARIES.includes(years) ? years : null;
}

/** "2026-08-30" -> "August 30, 2026". Shared by the alt-text builder and the Bluesky-based idempotency check, which both need the exact same format to match against each other. */
export function formatHumanDate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(d);
}
