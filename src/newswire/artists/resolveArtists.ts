import { mapWithConcurrency } from "../../utils/concurrency.js";
import { searchArtist } from "../spotify/client.js";
import { getPendingArtists, markArtistResolved, recordFailedResolveAttempt } from "../db/watchedArtistsRepo.js";
import type { NewsRunContext } from "../runContext.js";

const RESOLVE_CONCURRENCY = 10;

export interface ResolveArtistsSummary {
  attempted: number;
  resolved: number;
  stillPending: number;
  unresolved: number;
}

/**
 * Attempts Spotify search resolution for a batch of never-resolved (or
 * previously-failed-but-under-the-retry-cap) watchlist entries. Runs
 * every cycle against a bounded batch (config.news.artistResolveBatchSize)
 * rather than all at once, since the watchlist can be thousands of names
 * long - the full list resolves gradually over the first day or two of
 * runs rather than in one enormous burst against the Spotify API.
 */
export async function resolvePendingArtists(ctx: NewsRunContext): Promise<ResolveArtistsSummary> {
  const pending = getPendingArtists(ctx.db, ctx.config.news.artistResolveBatchSize);
  if (pending.length === 0) {
    return { attempted: 0, resolved: 0, stillPending: 0, unresolved: 0 };
  }

  let resolved = 0;
  let failed = 0;

  await mapWithConcurrency(pending, RESOLVE_CONCURRENCY, async (artist) => {
    try {
      const match = await searchArtist(ctx.spotifyToken, artist.name);
      if (match) {
        markArtistResolved(ctx.db, artist.id, {
          spotifyArtistId: match.id,
          genres: match.genres,
          popularity: match.popularity,
        });
        resolved++;
      } else {
        recordFailedResolveAttempt(ctx.db, artist.id);
        failed++;
      }
    } catch (err) {
      ctx.logger.warn("artist-resolve", `Search failed for "${artist.name}"`, {
        error: err instanceof Error ? err.message : String(err),
      });
      recordFailedResolveAttempt(ctx.db, artist.id);
      failed++;
    }
  });

  ctx.logger.info("artist-resolve", `Resolved ${resolved}/${pending.length} artist(s) this cycle`, {
    attempted: pending.length,
    resolved,
    failed,
  });

  return { attempted: pending.length, resolved, stillPending: 0, unresolved: failed };
}
