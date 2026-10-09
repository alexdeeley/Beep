import { discoverFestivalPosters } from "../discovery/discoverFestivalPosters.js";
import { verifyFestivalPosters } from "../verification/verifyFestivalPosters.js";
import { extractPosterImage } from "./extractPosterImage.js";
import { buildFestivalKey, hasPostedFestivalPoster, recordFestivalPosterPost } from "../db/festivalPostersRepo.js";
import { createBlueskySession, postImageMessage, type BlueskySession } from "../../bluesky/threadPublish.js";
import { insertBlueskyPost } from "../db/postsRepo.js";
import { contentHash } from "../contentHash.js";
import type { NewsRunContext } from "../runContext.js";
import type { VerifiedFestivalPoster } from "../types.js";

const TAG = "festival-posters";

const MAX_LINEUP_NAMES_SHOWN = 6;

/**
 * Discovery/verification sometimes return festivalName already containing the edition year (e.g.
 * "ArcTanGent Festival 2027") even though eventYear carries that same year separately - observed live
 * in production. Strips a trailing duplicate year before any display text is built, so the year is
 * never shown twice (header "... 2027 2027", hashtag "...Festival20272027").
 */
function cleanFestivalName(festivalName: string, eventYear: number | null): string {
  if (!eventYear) return festivalName;
  return festivalName.replace(new RegExp(`\\s*${eventYear}\\s*$`), "").trim();
}

/** Turns a festival name into a bare (no "#") PascalCase hashtag token, e.g. "Rock am Ring" -> "RockAmRing". */
function slugifyForHashtag(name: string): string {
  return name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

function buildHashtagLine(item: VerifiedFestivalPoster): string {
  const slug = slugifyForHashtag(cleanFestivalName(item.festivalName, item.eventYear));
  const tags = [slug ? (item.eventYear ? `${slug}${item.eventYear}` : slug) : null, "MusicFestival", "FestivalLineup"].filter(
    (t): t is string => Boolean(t)
  );
  return `\n\n${tags.map((t) => `#${t}`).join(" ")}`;
}

/** "Lineup: Artist A, Artist B, ..." - capped at a handful of names (real lineups can list dozens) so it never dominates the post on its own. */
function buildLineupLine(lineupArtists: string[]): string {
  if (lineupArtists.length === 0) return "";
  const shown =
    lineupArtists.length > MAX_LINEUP_NAMES_SHOWN
      ? [...lineupArtists.slice(0, MAX_LINEUP_NAMES_SHOWN), `+${lineupArtists.length - MAX_LINEUP_NAMES_SHOWN} more`]
      : lineupArtists;
  return `\n\nLineup: ${shown.join(", ")}`;
}

/**
 * Exported for unit testing. Builds the full descriptive caption - festival name/year, verification's
 * blurb, the lineup list, and hashtags - but this is used ONLY as the image's alt text (read by screen
 * readers, used for search), never as the post's visible body text. The account owner wants these posts
 * to show just the poster image with nothing else visible in the feed - see postFestivalPosters's call
 * site, which always passes an empty string as the actual post text. Alt text has no AT Protocol length
 * limit (unlike the 300-grapheme visible-post cap elsewhere in this pipeline), so this is never
 * truncated.
 *
 * headerLabel defaults to "FESTIVAL LINEUP" (the just-announced pipeline's framing); postThrowbackPoster.ts
 * passes "THROWBACK THURSDAY" instead so a historical repost is never mistaken for a new announcement.
 */
export function buildAltText(item: VerifiedFestivalPoster, headerLabel: string = "FESTIVAL LINEUP"): string {
  const name = cleanFestivalName(item.festivalName, item.eventYear);
  const label = item.eventYear ? `${name} ${item.eventYear}` : name;
  const header = `${headerLabel}: ${label}\n\n`;
  const lineupLine = buildLineupLine(item.lineupArtists);
  const hashtagLine = buildHashtagLine(item);
  const blurb = item.blurb!;
  return `${header}${blurb}${lineupLine}${hashtagLine}`;
}

/**
 * Every cycle, searches industry-wide for major music festivals that have just announced their
 * lineup/poster - "major" is an LLM judgment call (see discovery/festivalPostersPrompts.ts's high bar
 * and calibration examples), not a fixed watchlist. Unlike the daily recaps above, this is NOT a
 * once-a-day digest: each distinct festival edition (see db/festivalPostersRepo.ts's festival_key) gets
 * its own standalone post as soon as it's found, and there is no cap on how many can post in one cycle.
 *
 * Posts the festival's OWN official poster image, not a generated graphic, and with no visible caption
 * text - just the poster, at the account owner's explicit request (the rich caption still goes into the
 * image's alt text; see buildAltText). The image is never sourced from anything the model reports
 * directly - verifyFestivalPosters.ts only confirms the announcement is real and picks the single most
 * authoritative source URL (preferring the festival's own site); extractPosterImage.ts then does a plain
 * HTTP fetch of that exact page and mechanically looks for an image that's actually signalled as the
 * poster/flyer/artwork graphic (never a generic social-share photo), so the image that gets posted is
 * always something that genuinely, verifiably exists at a URL a real page actually links to - never a
 * hallucinated one. If no such image can be mechanically found (no poster signal anywhere on the page,
 * wrong content-type, too large even after compression, network failure), that item is simply skipped
 * and left unrecorded, so a later cycle can retry rather than posting nothing or posting something
 * guessed.
 *
 * Reposting a festival's own promotional artwork is a deliberate choice made explicitly by the account
 * owner (this pipeline never posts anything without independent 2-source verification that the
 * announcement itself is real) - see README §18.15.
 *
 * A no-op (0, no Bluesky calls) when nothing new is found. Returns the number of physical posts actually
 * published.
 */
export async function postFestivalPosters(ctx: NewsRunContext): Promise<number> {
  const candidates = await discoverFestivalPosters(ctx);
  const verified = await verifyFestivalPosters(ctx, candidates);
  if (verified.length === 0) return 0;

  const newItems = verified.filter((v) => !hasPostedFestivalPoster(ctx.db, buildFestivalKey(v.festivalName, v.eventYear)));
  if (newItems.length === 0) return 0;

  ctx.logger.info(TAG, `${newItems.length} new major festival lineup announcement(s) found`);

  if (!ctx.dryRun && (!ctx.config.bluesky.identifier || !ctx.config.bluesky.appPassword)) {
    ctx.logger.warn(TAG, "BLUESKY_IDENTIFIER / BLUESKY_APP_PASSWORD not configured; skipping");
    return 0;
  }

  let session: BlueskySession | null = null;
  let published = 0;

  for (const item of newItems) {
    if (!item.primarySourceUrl) {
      ctx.logger.warn(TAG, `No primary source URL for "${item.festivalName}" - can't extract a poster image, skipping`);
      continue;
    }

    const image = await extractPosterImage(ctx.logger, item.primarySourceUrl, cleanFestivalName(item.festivalName, item.eventYear));
    if (!image) continue; // already logged inside extractPosterImage; left unrecorded so a later cycle retries

    const key = buildFestivalKey(item.festivalName, item.eventYear);
    // The post itself is image-only, no visible body text - the account owner wants just the poster in
    // the feed. The rich caption (festival/blurb/lineup/hashtags) still goes into altText (accessibility
    // + search) and is what's recorded as this row's "text" for an audit trail that's actually useful.
    const altText = buildAltText(item);

    if (ctx.dryRun) {
      ctx.logger.info(
        TAG,
        `Dry run: would publish poster image for "${item.festivalName}" (${image.imageBytes.length} bytes from ${image.imageUrl})`,
        { altText }
      );
      insertBlueskyPost(ctx.db, {
        runId: ctx.hourlyRunId,
        threadPosition: 0,
        text: altText,
        contentHash: contentHash(altText),
        uri: null,
        cid: null,
        rootUri: null,
        parentUri: null,
        dryRun: true,
      });
      recordFestivalPosterPost(ctx.db, { festivalKey: key, festivalName: item.festivalName, postedInRunId: ctx.hourlyRunId });
      published++;
      continue;
    }

    try {
      session = session ?? (await createBlueskySession(ctx.config));
      const ref = await postImageMessage(ctx.config, ctx.logger, session, {
        text: "",
        altText,
        imageBytes: image.imageBytes,
        mimeType: image.mimeType,
      });
      insertBlueskyPost(ctx.db, {
        runId: ctx.hourlyRunId,
        threadPosition: 0,
        text: altText,
        contentHash: contentHash(altText),
        uri: ref.uri,
        cid: ref.cid,
        rootUri: ref.uri,
        parentUri: ref.uri,
        dryRun: false,
      });
      recordFestivalPosterPost(ctx.db, { festivalKey: key, festivalName: item.festivalName, postedInRunId: ctx.hourlyRunId });
      ctx.logger.info(TAG, `Published: ${ref.uri}`);
      published++;
    } catch (err) {
      ctx.logger.error(TAG, `Failed to publish poster for "${item.festivalName}" - will retry next cycle`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return published;
}
