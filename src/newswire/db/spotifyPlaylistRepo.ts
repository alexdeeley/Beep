import type Database from "better-sqlite3";

export interface SpotifyPlaylistTrackSeenRow {
  id: number;
  playlist_id: string;
  track_id: string;
  posted_in_run_id: number | null;
  created_at: string;
}

export function hasSeenPlaylistTrack(db: Database.Database, playlistId: string, trackId: string): boolean {
  return (
    db.prepare("SELECT 1 FROM spotify_playlist_tracks_seen WHERE playlist_id = ? AND track_id = ?").get(playlistId, trackId) !== undefined
  );
}

/** How many tracks have ever been recorded for this playlist - 0 means this is the first check ever, so the caller should seed a baseline rather than posting the playlist's entire existing history. */
export function getSeenPlaylistTrackCount(db: Database.Database, playlistId: string): number {
  const row = db.prepare("SELECT COUNT(*) as c FROM spotify_playlist_tracks_seen WHERE playlist_id = ?").get(playlistId) as { c: number };
  return row.c;
}

/**
 * postedInRunId is null when a track is recorded as part of the first-run baseline seed (nothing was
 * actually posted for it) - non-null when it was recorded because a real "NEW SINGLE" post went out.
 */
export function recordSeenPlaylistTrack(
  db: Database.Database,
  input: { playlistId: string; trackId: string; postedInRunId: number | null }
): void {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT OR IGNORE INTO spotify_playlist_tracks_seen (playlist_id, track_id, posted_in_run_id, created_at) VALUES (?, ?, ?, ?)"
  ).run(input.playlistId, input.trackId, input.postedInRunId, now);
}
