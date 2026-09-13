import { writeFile } from "node:fs/promises";
import { config } from "../config/index.js";

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const RECENTLY_PLAYED_URL = "https://api.spotify.com/v1/me/player/recently-played?limit=5";
const OUTPUT_PATH = "recent-tracks.json";
const TRACK_COUNT = 5;

interface SpotifyImage {
  url: string;
  height: number | null;
  width: number | null;
}

interface SpotifyRecentlyPlayedItem {
  played_at: string;
  track: {
    name: string;
    external_urls: { spotify: string };
    album: { images: SpotifyImage[] };
    artists: { name: string }[];
  };
}

export interface RecentTrack {
  title: string;
  artist: string;
  url: string;
  image: string | null;
  playedAt: string;
}

async function getAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    throw new Error(`Spotify token refresh failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

async function fetchRecentlyPlayed(accessToken: string): Promise<RecentTrack[]> {
  const res = await fetch(RECENTLY_PLAYED_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Spotify recently-played fetch failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { items: SpotifyRecentlyPlayedItem[] };

  // Spotify can list the same track multiple times in a row (repeat plays) -
  // collapse those so the widget shows distinct recent tracks, not duplicates.
  const seen = new Set<string>();
  const tracks: RecentTrack[] = [];
  for (const item of data.items) {
    const key = item.track.external_urls.spotify;
    if (seen.has(key)) continue;
    seen.add(key);
    tracks.push({
      title: item.track.name,
      artist: item.track.artists.map((a) => a.name).join(", "),
      url: item.track.external_urls.spotify,
      image: item.track.album.images[item.track.album.images.length - 1]?.url ?? null,
      playedAt: item.played_at,
    });
    if (tracks.length >= TRACK_COUNT) break;
  }
  return tracks;
}

export async function fetchAndSaveRecentTracks(): Promise<void> {
  const { clientId, clientSecret, refreshToken } = config.spotify;
  if (!clientId || !clientSecret || !refreshToken) {
    console.log("Spotify not configured (missing client id/secret/refresh token) - skipping recent-tracks.json update.");
    return;
  }

  const accessToken = await getAccessToken(clientId, clientSecret, refreshToken);
  const tracks = await fetchRecentlyPlayed(accessToken);

  await writeFile(
    OUTPUT_PATH,
    JSON.stringify({ updatedAt: new Date().toISOString(), tracks }, null, 2) + "\n",
    "utf8"
  );
  console.log(`Wrote ${tracks.length} track(s) to ${OUTPUT_PATH}`);
}
