import { DateTime } from "luxon";
import { hasShowsPostForDate, recordShowsPost } from "../db/showsRepo.js";
import { buildMultiLinePost } from "../publishing/multiPostChunker.js";
import { publishStandalonePostThread } from "../publishing/publishStandalonePostThread.js";
import { discoverShows } from "../discovery/discoverShows.js";
import { verifyShows } from "../verification/verifyShows.js";
import type { NewsRunContext } from "../runContext.js";
import type { VerifiedShow } from "../types.js";

const HEADER_LABEL = "SHOWS";
const TUESDAY_ISO_WEEKDAY = 2;
const WINDOW_DAYS = 7;

const MONTH_ABBREVIATIONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];

/**
 * A show's date is a calendar date at the venue, not a UTC instant - verification sometimes returns a
 * full timestamp with an offset (e.g. "2026-09-11T19:00:00-07:00") rather than a bare date. Parsing
 * that WITHOUT setZone:true would convert it into the server's local zone (UTC in CI), which can push
 * an evening Pacific show into the next UTC calendar day - confirmed live, this silently turned an
 * actual Sept 11 show into "Sept 12" before this fix. setZone:true keeps the string's own offset so the
 * calendar date read back out is the wall-clock date the source actually reported. Used for sorting and
 * dedup too (not just display), so a "9/11" and a "9/11T19:00-07:00" for the same show correctly match.
 */
export function localCalendarDate(eventDateIso: string): string {
  const dt = DateTime.fromISO(eventDateIso, { setZone: true });
  return dt.isValid ? dt.toISODate()! : eventDateIso;
}

export function formatShowDate(eventDateIso: string): string {
  const dt = DateTime.fromISO(eventDateIso, { setZone: true });
  if (!dt.isValid) return eventDateIso;
  return `${MONTH_ABBREVIATIONS[dt.month - 1]} ${dt.day}`;
}

function normalizeKey(show: VerifiedShow): string {
  return `${show.artistName.toLowerCase().trim()}|${localCalendarDate(show.eventDateIso)}`;
}

/** "Artist - Venue - Date", or "Artist - Date" when the venue wasn't independently confirmed (never guessed - see verifyShows.ts's extractConfirmedVenue). */
export function formatShowLine(show: VerifiedShow): string {
  const venue = show.venueName ? ` - ${show.venueName}` : "";
  return `${show.artistName}${venue} - ${formatShowDate(show.eventDateIso)}`;
}

/**
 * Once a week - the first cycle on a Tuesday, local time, at or after
 * NEWS_SHOWS_HOUR_LOCAL - posts a "SHOWS" calendar of upcoming concerts
 * in Portland, Oregon and the broader Pacific Northwest for the next 7
 * days, independent of watched-artists.txt entirely (any artist).
 *
 * Unlike the Friday roundup, this doesn't accumulate a backlog across
 * cycles - it's a single fresh web-search sweep (discoverShows +
 * verifyShows, same independent 2-corroborating-source rule as
 * everything else) each week, discovered and posted in one shot, like
 * TODAY IN HISTORY. Format is a tight one-line-per-show list, sorted
 * chronologically, with the venue when independently confirmed
 * (never guessed - see verifyShows.ts's extractConfirmedVenue):
 *
 *   SHOWS
 *   Matchbox 20 - Crystal Ballroom - Sept 7
 *   The Cure - Moda Center - Sept 8
 *
 * A no-op on any other day, before the configured hour, if a SHOWS post
 * already went out today, or if nothing turns up independently
 * verifiable for the window (in which case no post is recorded, so a
 * later cycle the same Tuesday can retry).
 *
 * Returns the number of physical posts actually published (0 if none).
 */
export async function postWeeklyShows(ctx: NewsRunContext): Promise<number> {
  const dt = DateTime.fromJSDate(ctx.now, { zone: ctx.editorialFocus.quietHours.timezone });
  if (dt.weekday !== TUESDAY_ISO_WEEKDAY || dt.hour < ctx.config.news.showsHourLocal) return 0;

  const runDate = dt.toISODate()!;
  if (hasShowsPostForDate(ctx.db, runDate)) return 0;

  const startIso = dt.toISODate()!;
  const endIso = dt.plus({ days: WINDOW_DAYS }).toISODate()!;

  const candidates = await discoverShows(ctx, startIso, endIso);
  const verified = await verifyShows(ctx, candidates);

  // discoverShows asks for shows within [startIso, endIso], but nothing stops the model from also
  // returning something outside it (confirmed live: a request for the next 7 days came back including
  // shows a full month out) - enforce the window here rather than trusting the prompt alone, since this
  // is meant to be a snapshot of THIS week, not "whatever the model felt like including."
  const inWindow = verified.filter((show) => {
    const d = localCalendarDate(show.eventDateIso);
    return d >= startIso && d <= endIso;
  });
  if (inWindow.length < verified.length) {
    ctx.logger.info("shows", `Dropped ${verified.length - inWindow.length} verified show(s) outside the ${startIso} to ${endIso} window`);
  }

  if (inWindow.length === 0) {
    ctx.logger.info("shows", "Tuesday, but no independently verifiable Portland/PNW shows found in this week's window - staying silent, will retry later today");
    return 0;
  }

  const seen = new Set<string>();
  const deduped = inWindow.filter((show) => {
    const key = normalizeKey(show);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const sorted = [...deduped].sort((a, b) => localCalendarDate(a.eventDateIso).localeCompare(localCalendarDate(b.eventDateIso)));

  const lines = sorted.map(formatShowLine);
  const posts = buildMultiLinePost(HEADER_LABEL, lines, undefined, "\n");

  const publishedAny = await publishStandalonePostThread(ctx, "shows", posts);
  if (publishedAny) {
    recordShowsPost(ctx.db, { runDate, postedInRunId: ctx.hourlyRunId, itemCount: sorted.length });
    ctx.logger.info("shows", `${HEADER_LABEL} posted: ${sorted.length} item(s) across ${posts.length} post(s)`);
    return posts.length;
  }
  return 0;
}
