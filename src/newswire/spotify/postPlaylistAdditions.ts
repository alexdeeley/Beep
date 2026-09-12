import { getPlaylistTracks } from "./getPlaylistTracks.js";
import { getSeenPlaylistTrackCount, hasSeenPlaylistTrack, recordSeenPlaylistTrack } from "../db/spotifyPlaylistRepo.js";
import { createBlueskySession, postThreadMessage, buildLinkFacet } from "../../bluesky/threadPublish.js";
import { insertBlueskyPost } from "../db/postsRepo.js";
import { contentHash } from "../duplicateCheck/duplicateCheckEdition.js";
import type { NewsRunContext } from "../runContext.js";
import type { PlaylistTrack } from "./getPlaylistTracks.js";

const TAG = "playlist-watch";

/** Exported for unit testing. */
export function buildPostText(track: PlaylistTrack): string {
  return `NEW SINGLE: ${track.artistCredit} - ${track.name}\n\n${track.url}`;
}

/**
 * Monitors a user-maintained public Spotify playlist (config.news.newSinglesPlaylistId) and posts a
 * mechanical "NEW SINGLE" for each track added since the last check - directly built from the track's
 * own Spotify metadata, never through the writer/copy-edit/fact-check pipeline, since "this track is
 * now on the playlist" is a fact directly checkable against Spotify's own data, not a news claim
 * needing independent web-search corroboration the way everything else in this pipeline does.
 *
 * Reads the playlist via getPlaylistTracks.ts's embed-page scrape, NOT the official Spotify Web API -
 * this account's Spotify developer account no longer has access to self-serve API credentials, so the
 * Client Credentials flow lookupTrack.ts uses isn't an option here. No API key of any kind is needed
 * for this feature.
 *
 * First-ever check for this playlist seeds every currently-present track as a "seen" baseline WITHOUT
 * posting anything - the point is catching new additions going forward, not retroactively announcing
 * the playlist's entire existing history. From the next check on, only genuinely new tracks post.
 *
 * Each track posts as its own independent post (never threaded together - unrelated singles sharing a
 * reply chain would read as a non-sequitur, same reasoning as publishMusicItems.ts), and is recorded
 * as seen immediately after a successful post, so a mid-batch failure leaves an accurate record and
 * the next cycle only retries what didn't go out.
 *
 * A no-op (0, no DB/network beyond the initial playlist read) when newSinglesPlaylistId isn't
 * configured. Returns the number of physical posts actually published.
 */
export async function postPlaylistAdditions(ctx: NewsRunContext): Promise<number> {
  const playlistId = ctx.config.news.newSinglesPlaylistId;
  if (!playlistId) return 0;

  const tracks = await getPlaylistTracks(ctx.logger, playlistId);
  if (tracks.length === 0) {
    ctx.logger.info(TAG, "No tracks read from the playlist this cycle (empty, unavailable, or not configured correctly)");
    return 0;
  }

  const isFirstCheck = getSeenPlaylistTrackCount(ctx.db, playlistId) === 0;
  if (isFirstCheck) {
    for (const track of tracks) {
      recordSeenPlaylistTrack(ctx.db, { playlistId, trackId: track.trackId, postedInRunId: null });
    }
    ctx.logger.info(TAG, `First check for this playlist - seeded ${tracks.length} existing track(s) as baseline, nothing posted`);
    return 0;
  }

  const newTracks = tracks.filter((t) => !hasSeenPlaylistTrack(ctx.db, playlistId, t.trackId));
  if (newTracks.length === 0) return 0;

  ctx.logger.info(TAG, `${newTracks.length} new track(s) found on the playlist since the last check`);

  if (ctx.dryRun) {
    let position = 0;
    for (const track of newTracks) {
      const text = buildPostText(track);
      ctx.logger.info(TAG, `Dry run: would publish "${text}"`);
      insertBlueskyPost(ctx.db, {
        runId: ctx.hourlyRunId,
        threadPosition: position++,
        text,
        contentHash: contentHash(text),
        uri: null,
        cid: null,
        rootUri: null,
        parentUri: null,
        dryRun: true,
      });
      recordSeenPlaylistTrack(ctx.db, { playlistId, trackId: track.trackId, postedInRunId: ctx.hourlyRunId });
    }
    return newTracks.length;
  }

  if (!ctx.config.bluesky.identifier || !ctx.config.bluesky.appPassword) {
    ctx.logger.warn(TAG, "BLUESKY_IDENTIFIER / BLUESKY_APP_PASSWORD not configured; skipping");
    return 0;
  }

  const session = await createBlueskySession(ctx.config);
  let published = 0;
  let position = 0;

  for (const track of newTracks) {
    const text = buildPostText(track);
    const facet = track.url ? buildLinkFacet(text, track.url) : null;
    try {
      const ref = await postThreadMessage(ctx.config, ctx.logger, session, {
        text,
        reply: null,
        facets: facet ? [facet] : undefined,
      });
      insertBlueskyPost(ctx.db, {
        runId: ctx.hourlyRunId,
        threadPosition: position++,
        text,
        contentHash: contentHash(text),
        uri: ref.uri,
        cid: ref.cid,
        rootUri: ref.uri,
        parentUri: ref.uri,
        dryRun: false,
      });
      recordSeenPlaylistTrack(ctx.db, { playlistId, trackId: track.trackId, postedInRunId: ctx.hourlyRunId });
      ctx.logger.info(TAG, `Published: ${ref.uri}`);
      published++;
    } catch (err) {
      ctx.logger.error(TAG, `Failed to publish "${text}" - will retry next cycle`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return published;
}
