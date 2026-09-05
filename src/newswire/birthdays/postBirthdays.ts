import { DateTime } from "luxon";
import {
  getArtistsNeedingBirthDateCheck,
  recordBirthDate,
  getArtistsWithBirthdayOn,
  type WatchedArtistRow,
} from "../db/watchedArtistsRepo.js";
import { hasBirthdayPostForYear, recordBirthdayPost } from "../db/birthdayPostsRepo.js";
import { discoverBirthDates } from "../discovery/discoverBirthDates.js";
import { verifyBirthDates } from "../verification/verifyBirthDates.js";
import { publishStandalonePostThread } from "../publishing/publishStandalonePostThread.js";
import type { NewsRunContext } from "../runContext.js";

const TAG = "birthdays";

export function buildBirthdayText(artist: WatchedArtistRow, currentYear: number, allowEmoji: boolean): string {
  const base = artist.birth_year
    ? `HAPPY BIRTHDAY: ${artist.name} turns ${currentYear - artist.birth_year} today!`
    : `HAPPY BIRTHDAY: ${artist.name}!`;
  return allowEmoji ? `${base} \u{1F382}` : base;
}

/**
 * Two independent jobs, both scoped strictly to watched-artists.txt (never industry-wide, and only
 * for an individual person - a band has no birthday):
 *
 * 1. Resolve birth dates for a small batch of artists that have never been checked
 *    (discoverBirthDates + verifyBirthDates, same 2-source rule as everything else) - a one-time
 *    lookup per artist, spread across cycles to bound cost, not a recurring check.
 * 2. Post a "HAPPY BIRTHDAY" shoutout for any watchlist artist whose confirmed birth month/day matches
 *    today's local date, guarded by a once-per-year idempotency table (birthday_posts) so the twice-
 *    daily cadence never double-posts the same birthday.
 *
 * Built directly from verified structured data - no writer/copy-edit/fact-check needed, and an age is
 * only ever stated when the birth year was independently confirmed.
 *
 * Returns the number of physical posts actually published (0 if none) -
 * the caller needs this to report the cycle's real publish count/status
 * accurately, since this can be the only thing that posts in a cycle.
 */
export async function postBirthdays(ctx: NewsRunContext): Promise<number> {
  const needsCheck = getArtistsNeedingBirthDateCheck(ctx.db, ctx.config.news.birthDateBatchSize);
  if (needsCheck.length > 0) {
    const candidates = await discoverBirthDates(ctx, needsCheck);
    const verified = await verifyBirthDates(ctx, candidates);
    const verifiedByArtistId = new Map(verified.map((v) => [v.watchedArtistId, v] as const));

    for (const artist of needsCheck) {
      const v = verifiedByArtistId.get(artist.id);
      recordBirthDate(ctx.db, artist.id, {
        month: v?.birthMonth ?? null,
        day: v?.birthDay ?? null,
        year: v?.birthYear ?? null,
      });
    }
    ctx.logger.info(TAG, `Resolved birth dates for ${verified.length} of ${needsCheck.length} newly-checked artist(s)`);
  }

  const dt = DateTime.fromJSDate(ctx.now, { zone: ctx.editorialFocus.quietHours.timezone });
  const todaysBirthdays = getArtistsWithBirthdayOn(ctx.db, dt.month, dt.day);
  const year = dt.year;
  let publishedCount = 0;

  for (const artist of todaysBirthdays) {
    if (hasBirthdayPostForYear(ctx.db, artist.id, year)) continue;

    const text = buildBirthdayText(artist, year, ctx.editorialFocus.voice.allowEmoji);
    const publishedAny = await publishStandalonePostThread(ctx, TAG, [text]);
    if (publishedAny) {
      recordBirthdayPost(ctx.db, { watchedArtistId: artist.id, year, postedInRunId: ctx.hourlyRunId });
      ctx.logger.info(TAG, `Posted birthday shoutout for ${artist.name}`);
      publishedCount += 1;
    }
  }

  return publishedCount;
}
