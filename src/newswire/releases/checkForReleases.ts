import { mapWithConcurrency } from "../../utils/concurrency.js";
import { getArtistAlbums } from "../spotify/client.js";
import type { SpotifyAlbum } from "../spotify/types.js";
import { getArtistsDueForReleaseCheck, markArtistChecked, type WatchedArtistRow } from "../db/watchedArtistsRepo.js";
import { insertRelease } from "../db/releasesRepo.js";
import type { NewsRunContext } from "../runContext.js";

const CHECK_CONCURRENCY = 15;

/** Even if an artist's last-seen release fell off the returned page (e.g. a large backlog dump), never treat more than this many as "new" in one check - a defensive cap against flooding the feed. */
export const MAX_NEW_PER_ARTIST_PER_CHECK = 5;

export interface ReleaseCheckSummary {
  checked: number;
  newReleasesFound: number;
}

/** Everything strictly newer than `lastSeenReleaseId` in a newest-first list, stopping as soon as the previously-seen release is found (or exhausting the page, capped). */
export function collectNewAlbums(albums: SpotifyAlbum[], lastSeenReleaseId: string | null): SpotifyAlbum[] {
  const collected: SpotifyAlbum[] = [];
  for (const album of albums) {
    if (lastSeenReleaseId !== null && album.id === lastSeenReleaseId) break;
    collected.push(album);
    if (collected.length >= MAX_NEW_PER_ARTIST_PER_CHECK) break;
  }
  return collected;
}

async function checkOneArtist(ctx: NewsRunContext, artist: WatchedArtistRow, lookbackCutoff: Date): Promise<number> {
  if (!artist.spotify_artist_id) return 0;

  let albums: SpotifyAlbum[];
  try {
    albums = await getArtistAlbums(ctx.spotifyToken, artist.spotify_artist_id);
  } catch (err) {
    ctx.logger.warn("release-check", `Album fetch failed for "${artist.name}" - will retry next rotation`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return 0; // leave last_checked_at untouched so a transient failure is retried soon, not pushed to the back of the rotation.
  }

  const newest = albums[0];

  // First time this artist has ever been checked: seed the baseline to whatever they currently have
  // out (their existing catalog), but never treat pre-existing releases as "news" - only releases that
  // appear on a LATER check, after this baseline, are genuinely new. Sentinel is last_checked_at (not
  // last_seen_release_id), because an artist with zero releases at baseline time still needs a later
  // real release to register as new, not be silently absorbed as "seen" forever.
  if (artist.last_checked_at === null) {
    markArtistChecked(ctx.db, artist.id, {
      lastSeenReleaseId: newest?.id ?? null,
      lastSeenReleaseDate: newest?.release_date ?? null,
    });
    return 0;
  }

  const newAlbums = collectNewAlbums(albums, artist.last_seen_release_id);
  let found = 0;
  for (const album of newAlbums) {
    // Spotify always tags a genuinely fresh release with day precision - year/month precision only
    // shows up on old catalog metadata, never on something worth announcing as news.
    if (album.release_date_precision !== "day") continue;
    if (new Date(album.release_date) < lookbackCutoff) continue;

    insertRelease(ctx.db, {
      watchedArtistId: artist.id,
      spotifyReleaseId: album.id,
      releaseType: album.album_type,
      title: album.name,
      releaseDate: album.release_date,
      releaseDatePrecision: album.release_date_precision,
      totalTracks: album.total_tracks,
      spotifyUrl: album.external_urls.spotify,
      imageUrl: album.images[0]?.url ?? null,
      discoveredInRunId: ctx.hourlyRunId,
    });
    found++;
  }

  markArtistChecked(ctx.db, artist.id, {
    lastSeenReleaseId: newest?.id ?? artist.last_seen_release_id,
    lastSeenReleaseDate: newest?.release_date ?? artist.last_seen_release_date,
  });
  return found;
}

/**
 * Rotation batch through resolved watchlist artists (oldest-checked-first),
 * checking each against the Spotify catalog for releases newer than the
 * last time they were checked. Runs a bounded batch per cycle
 * (config.news.releaseCheckBatchSize) rather than the whole watchlist at
 * once, so with 11k+ artists the full list still gets checked at least
 * once a day without hammering the Spotify API in one burst.
 */
export async function checkForNewReleases(ctx: NewsRunContext): Promise<ReleaseCheckSummary> {
  const artists = getArtistsDueForReleaseCheck(ctx.db, ctx.config.news.releaseCheckBatchSize);
  if (artists.length === 0) return { checked: 0, newReleasesFound: 0 };

  const lookbackCutoff = new Date(ctx.now.getTime() - ctx.config.news.releaseLookbackDays * 24 * 60 * 60 * 1000);

  const results = await mapWithConcurrency(artists, CHECK_CONCURRENCY, (artist) => checkOneArtist(ctx, artist, lookbackCutoff));
  const newReleasesFound = results.reduce((sum, n) => sum + n, 0);

  ctx.logger.info("release-check", `Checked ${artists.length} artist(s), found ${newReleasesFound} new release(s)`, {
    checked: artists.length,
    newReleasesFound,
  });

  return { checked: artists.length, newReleasesFound };
}
