import { DateTime } from "luxon";
import { hasMusicNewsPostForDate, recordMusicNewsPost } from "../db/musicNewsRepo.js";
import { getArtistByNameCaseInsensitive } from "../db/watchedArtistsRepo.js";
import { buildCommaSeparatedPost } from "../publishing/multiPostChunker.js";
import { publishStandalonePostThread } from "../publishing/publishStandalonePostThread.js";
import { discoverMusicNews } from "../discovery/discoverMusicNews.js";
import { verifyMusicNews } from "../verification/verifyMusicNews.js";
import type { NewsRunContext } from "../runContext.js";
import type { VerifiedDramaticNews } from "../types.js";

const HEADER_LABEL = "MUSIC NEWS";
const TAG = "music-news-recap";

/** Capitalizes the first letter and appends a terminal period if the blurb doesn't already end with one - never rewrites the blurb's wording, since that's verification's own confirmed text. */
export function formatBlurbAsSentence(blurb: string): string {
  const trimmed = blurb.trim();
  const capitalized = trimmed.length > 0 ? trimmed[0]!.toUpperCase() + trimmed.slice(1) : trimmed;
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

/**
 * Once a day - the first cycle that finds at least one independently verifiable, genuinely major
 * dramatic music-news item (arrest, death, breakup, hospitalization, major lawsuit/scandal) for a
 * watchlist artist - posts a tight "MUSIC NEWS" recap, e.g.:
 *
 *   MUSIC NEWS
 *   Rivers Cuomo arrested. Idles breaks up. Avril Lavigne dies.
 *
 * discoverMusicNews sweeps industry-wide (11k+ watchlist names don't fit in a discovery prompt), so
 * this filters verified candidates down to watched-artists.txt here, in code, after verification -
 * same "enforce scope in code, not just the prompt" pattern as releaseDateFilter.ts and SHOWS' window
 * filter. Built directly from verification's own confirmed `blurb` field (never the writer/copy-edit/
 * fact-check pipeline - there's no new prose to check beyond what verification already confirmed).
 *
 * A no-op if a recap already went out today, or if nothing independently verifiable and
 * watchlist-relevant turns up (in which case no post is recorded, so a later cycle the same day can
 * retry - most days should have zero items, and that is correct, not a failure).
 *
 * Returns the number of physical posts actually published (0 if none).
 */
export async function postMusicNewsRecap(ctx: NewsRunContext): Promise<number> {
  const dt = DateTime.fromJSDate(ctx.now, { zone: ctx.editorialFocus.quietHours.timezone });
  const postDate = dt.toISODate()!;
  if (hasMusicNewsPostForDate(ctx.db, postDate)) return 0;

  const candidates = await discoverMusicNews(ctx);
  const verified = await verifyMusicNews(ctx, candidates);

  const onWatchlist: VerifiedDramaticNews[] = [];
  for (const item of verified) {
    const artist = getArtistByNameCaseInsensitive(ctx.db, item.artistName);
    if (artist) onWatchlist.push(item);
  }
  if (onWatchlist.length < verified.length) {
    ctx.logger.info(TAG, `Dropped ${verified.length - onWatchlist.length} verified item(s) about artist(s) not on the watchlist`);
  }

  if (onWatchlist.length === 0) {
    ctx.logger.info(TAG, "No independently verifiable, watchlist-relevant major music news today - staying silent, will retry later today");
    return 0;
  }

  const blurbs = onWatchlist.map((v) => formatBlurbAsSentence(v.blurb!));
  const posts = buildCommaSeparatedPost(HEADER_LABEL, blurbs, undefined, " ");

  const publishedAny = await publishStandalonePostThread(ctx, TAG, posts);
  if (publishedAny) {
    recordMusicNewsPost(ctx.db, { postDate, postedInRunId: ctx.hourlyRunId, itemCount: onWatchlist.length });
    ctx.logger.info(TAG, `${HEADER_LABEL} posted: ${onWatchlist.length} item(s) across ${posts.length} post(s)`);
    return posts.length;
  }
  return 0;
}
