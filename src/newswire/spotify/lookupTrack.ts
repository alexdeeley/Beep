import type { AppConfig } from "../../config/index.js";
import type { RunLogger } from "../../utils/logger.js";

/**
 * Best-effort catalog lookup for a single's canonical open.spotify.com
 * track link, used to enrich the newswire's mechanical "NEW SINGLE:
 * Artist - Title" post. Uses the Spotify Web API's Client Credentials
 * flow (app-only auth, no user login, catalog search only) - never
 * throws; any failure (missing credentials, network error, no confident
 * match) resolves to null, and the caller posts the single without a
 * link exactly as it did before this existed. A wrong or unrelated link
 * is worse than no link, so this deliberately errs toward null over a
 * shaky guess (see isConfidentMatch below).
 */

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const SEARCH_URL = "https://api.spotify.com/v1/search";

/** How stale a matching track's own release date can be and still count as "this new single" rather than an old catalog track that happens to share a title. Generous on purpose: discovery/verification can run a few days behind the real release date, and Spotify's own release_date is sometimes the *original* release for a reissue/remaster. */
const MAX_RELEASE_AGE_DAYS = 45;

interface CachedToken {
  accessToken: string;
  /** Epoch ms after which the token must be refreshed - a few minutes of margin before the real expiry. */
  expiresAt: number;
}

/** Module-level in-memory cache: one newswire cycle is a single short-lived process that may look up many singles, so this avoids re-authenticating per track. Never persisted - a fresh process always starts with no cached token, which is fine since the token is cheap to (re)fetch. */
let cachedToken: CachedToken | null = null;

async function getAccessToken(config: AppConfig, logger: RunLogger): Promise<string | null> {
  if (!config.spotify.clientId || !config.spotify.clientSecret) return null;

  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.accessToken;
  }

  try {
    const basic = Buffer.from(`${config.spotify.clientId}:${config.spotify.clientSecret}`).toString("base64");
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { access_token: string; expires_in: number };
    cachedToken = {
      accessToken: data.access_token,
      expiresAt: Date.now() + Math.max(0, data.expires_in - 60) * 1000,
    };
    return cachedToken.accessToken;
  } catch (err) {
    logger.warn("spotify", "Failed to obtain a Spotify access token; skipping link lookups for this cycle", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export interface SpotifySearchTrack {
  name: string;
  artists: { name: string }[];
  external_urls: { spotify?: string };
  album: { release_date: string; release_date_precision: "year" | "month" | "day" };
}

interface SpotifySearchResponse {
  tracks?: { items: SpotifySearchTrack[] };
}

/** Lowercases, trims, collapses whitespace, and strips a few common trailing qualifiers that Spotify's catalog title often carries but a clean announcement title won't ("- Single", "(Single Version)", "- Radio Edit", etc.) - comparison-only, never affects the stored link. Exported for unit testing. */
export function normalizeForComparison(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s*[-–—]\s*(single( version)?|radio edit|remaster(ed)?( \d{4})?)\s*$/i, "")
    .replace(/\s*\((single( version)?|radio edit|remaster(ed)?( \d{4})?)\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function releaseDateToMs(track: SpotifySearchTrack): number | null {
  const raw = track.album.release_date;
  if (!raw) return null;
  // Spotify returns "YYYY", "YYYY-MM", or "YYYY-MM-DD" depending on release_date_precision - pad to a full date so Date.parse is unambiguous.
  const iso =
    track.album.release_date_precision === "day"
      ? raw
      : track.album.release_date_precision === "month"
        ? `${raw}-01`
        : `${raw}-01-01`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** Exported for unit testing - see the doc comment on lookupSpotifyTrackUrl for what "confident" means and why. */
export function isConfidentMatch(track: SpotifySearchTrack, artistName: string, title: string, now: Date): boolean {
  const wantArtist = normalizeForComparison(artistName);
  const wantTitle = normalizeForComparison(title);
  const artistMatches = track.artists.some((a) => normalizeForComparison(a.name) === wantArtist);
  if (!artistMatches) return false;

  const gotTitle = normalizeForComparison(track.name);
  const titleMatches = gotTitle === wantTitle || gotTitle.startsWith(wantTitle) || wantTitle.startsWith(gotTitle);
  if (!titleMatches) return false;

  const releaseMs = releaseDateToMs(track);
  if (releaseMs === null) return false; // unknown release date - can't confirm this is the new release, not an old catalog track.
  const ageDays = (now.getTime() - releaseMs) / (1000 * 60 * 60 * 24);
  return ageDays <= MAX_RELEASE_AGE_DAYS;
}

/**
 * Looks up the canonical open.spotify.com track URL for a just-announced
 * single, or null if Spotify isn't configured, the API call fails, or no
 * result confidently matches both the artist and title *and* was
 * released recently (see isConfidentMatch) - a title collision with an
 * old catalog track is exactly the failure mode this guards against.
 */
export async function lookupSpotifyTrackUrl(
  config: AppConfig,
  logger: RunLogger,
  artistName: string,
  title: string
): Promise<string | null> {
  const token = await getAccessToken(config, logger);
  if (!token) return null;

  try {
    const query = `track:${title} artist:${artistName}`;
    const url = `${SEARCH_URL}?type=track&limit=5&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as SpotifySearchResponse;
    const items = data.tracks?.items ?? [];

    const now = new Date();
    const matches = items.filter((t) => isConfidentMatch(t, artistName, title, now));
    if (matches.length === 0) return null;

    // Most recently released match first - guards against, e.g., a compilation re-release sorting ahead of the actual new single.
    matches.sort((a, b) => (releaseDateToMs(b) ?? 0) - (releaseDateToMs(a) ?? 0));
    const best = matches[0]!;
    return best.external_urls.spotify ?? null;
  } catch (err) {
    logger.warn("spotify", `Track lookup failed for "${artistName} - ${title}"; posting without a Spotify link`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
