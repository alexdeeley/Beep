import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { openStoryDb, closeStoryDb } from "../../src/newswire/db/connection.js";
import { parseArtistListFile, importArtistList } from "../../src/newswire/artists/importArtistList.js";
import { getArtistResolutionCounts } from "../../src/newswire/db/watchedArtistsRepo.js";

describe("parseArtistListFile", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "artist-list-test-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("parses one artist per line, ignoring blank lines and # comments", () => {
    const path = join(dir, "artists.txt");
    writeFileSync(path, "Radiohead\n\n# a comment\nWilco\n  Beck  \n");
    expect(parseArtistListFile(path)).toEqual(["Radiohead", "Wilco", "Beck"]);
  });

  it("throws a clear error for a missing file", () => {
    expect(() => parseArtistListFile(join(dir, "does-not-exist.txt"))).toThrow(/not found/);
  });
});

describe("importArtistList", () => {
  let dir: string;
  let db: Database.Database;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "artist-list-db-test-"));
    db = openStoryDb(join(dir, "story.db"));
  });
  afterEach(() => {
    closeStoryDb(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it("imports names from the file into watched_artists, idempotently on rerun", () => {
    const path = join(dir, "artists.txt");
    writeFileSync(path, "Radiohead\nWilco\n");
    expect(importArtistList(db, path)).toBe(2);
    expect(getArtistResolutionCounts(db).pending).toBe(2);

    // Rerunning against the same (or an appended) file never re-inserts existing names.
    writeFileSync(path, "Radiohead\nWilco\nBeck\n");
    expect(importArtistList(db, path)).toBe(1);
    expect(getArtistResolutionCounts(db).pending).toBe(3);
  });
});
