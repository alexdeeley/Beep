import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type Database from "better-sqlite3";
import { importArtistNames } from "../db/watchedArtistsRepo.js";

/**
 * Parses the user-maintained watchlist (one artist name per line, blank
 * lines and `#`-prefixed comment lines ignored) and upserts any names not
 * already tracked. Safe - and cheap, a single indexed-unique-constraint
 * transaction - to run at the top of every hourly cycle, so a user
 * editing watched-artists.txt takes effect on the next run automatically
 * without a separate import step.
 */
export function parseArtistListFile(path: string): string[] {
  const absPath = resolve(process.cwd(), path);
  let raw: string;
  try {
    raw = readFileSync(absPath, "utf8");
  } catch (err) {
    throw new Error(`watched-artists.txt not found at "${absPath}" (set NEWS_ARTIST_LIST_PATH to override). (${(err as Error).message})`);
  }
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

export function importArtistList(db: Database.Database, path: string): number {
  const names = parseArtistListFile(path);
  return importArtistNames(db, names);
}
