import { DateTime } from "luxon";
import { hasBiggestStoriesPostForDate, recordBiggestStoriesPost } from "../db/biggestStoriesRepo.js";
import { buildMultiLinePost } from "../publishing/multiPostChunker.js";
import { publishStandalonePostThread } from "../publishing/publishStandalonePostThread.js";
import { discoverBiggestStories } from "../discovery/discoverBiggestStories.js";
import { verifyBiggestStories } from "../verification/verifyBiggestStories.js";
import { formatBlurbAsSentence } from "../musicNews/postMusicNewsRecap.js";
import type { NewsRunContext } from "../runContext.js";

const HEADER_LABEL = "TOP MUSIC STORIES";
const TAG = "biggest-stories";

/**
 * Once a day - the first cycle that finds at least one independently verifiable, genuinely major music
 * story (of any kind: releases, chart records, awards, major business news, huge tour/festival
 * announcements, deaths, scandals) - posts a "TOP MUSIC STORIES <date>" recap, one sentence per story,
 * ranked most significant first, e.g.:
 *
 *   TOP MUSIC STORIES 9/14
 *
 *   Olivia Rodrigo's new album breaks the platform's first-week streaming record.
 *
 *   Live Nation agrees to pay $50M to settle an antitrust lawsuit.
 *
 * Deliberately a SEPARATE, broader post from musicNews/postMusicNewsRecap.ts's "MUSIC NEWS" recap,
 * which stays narrowly scoped to dramatic events (arrests, deaths, breakups, lawsuits) for watchlist
 * artists only - this one is industry-wide and covers routine-but-major news that recap explicitly
 * excludes (new releases, tours, awards). The two can both post the same day; there is no cross-check
 * against each other or against watched-artists.txt.
 *
 * Built directly from verification's own confirmed `blurb` field (never the writer/copy-edit/fact-check
 * pipeline - there's no new prose to check beyond what verification already confirmed).
 *
 * A no-op if a recap already went out today, or if nothing independently verifiable turns up (in which
 * case no post is recorded, so a later cycle the same day can retry - most days should have at most a
 * few items, and zero is a normal, expected outcome, not a failure).
 *
 * Returns the number of physical posts actually published (0 if none).
 */
export async function postBiggestStoriesRecap(ctx: NewsRunContext): Promise<number> {
  const dt = DateTime.fromJSDate(ctx.now, { zone: ctx.editorialFocus.quietHours.timezone });
  const postDate = dt.toISODate()!;
  if (hasBiggestStoriesPostForDate(ctx.db, postDate)) return 0;

  const candidates = await discoverBiggestStories(ctx);
  const verified = await verifyBiggestStories(ctx, candidates);

  if (verified.length === 0) {
    ctx.logger.info(TAG, "No independently verifiable major music stories today - staying silent, will retry later today");
    return 0;
  }

  const header = `${HEADER_LABEL} ${dt.toFormat("M/d")}`;
  const lines = verified.map((v) => formatBlurbAsSentence(v.blurb!));
  const posts = buildMultiLinePost(header, lines);

  const publishedAny = await publishStandalonePostThread(ctx, TAG, posts);
  if (publishedAny) {
    recordBiggestStoriesPost(ctx.db, { postDate, postedInRunId: ctx.hourlyRunId, itemCount: verified.length });
    ctx.logger.info(TAG, `${HEADER_LABEL} posted: ${verified.length} item(s) across ${posts.length} post(s)`);
    return posts.length;
  }
  return 0;
}
