import type Database from "better-sqlite3";

export interface BlueskyPostRow {
  id: number;
  run_id: number;
  thread_position: number;
  text: string;
  content_hash: string;
  uri: string | null;
  cid: string | null;
  root_uri: string | null;
  parent_uri: string | null;
  dry_run: number;
  created_at: string;
}

/**
 * Records a single thread post immediately after it's sent (not batched
 * at the end of the thread) so a mid-thread publish failure still leaves
 * an accurate record of what actually went out.
 */
export function insertBlueskyPost(
  db: Database.Database,
  input: {
    runId: number;
    threadPosition: number;
    text: string;
    contentHash: string;
    uri: string | null;
    cid: string | null;
    rootUri: string | null;
    parentUri: string | null;
    dryRun: boolean;
  }
): BlueskyPostRow {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO bluesky_posts (run_id, thread_position, text, content_hash, uri, cid, root_uri, parent_uri, dry_run, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.runId,
      input.threadPosition,
      input.text,
      input.contentHash,
      input.uri,
      input.cid,
      input.rootUri,
      input.parentUri,
      input.dryRun ? 1 : 0,
      now
    );
  return db.prepare("SELECT * FROM bluesky_posts WHERE id = ?").get(Number(result.lastInsertRowid)) as BlueskyPostRow;
}

export function findPostByContentHash(db: Database.Database, contentHash: string): BlueskyPostRow | undefined {
  return db
    .prepare("SELECT * FROM bluesky_posts WHERE content_hash = ? AND dry_run = 0 ORDER BY created_at DESC LIMIT 1")
    .get(contentHash) as BlueskyPostRow | undefined;
}

export function getRecentPosts(db: Database.Database, limit: number): BlueskyPostRow[] {
  return db
    .prepare("SELECT * FROM bluesky_posts WHERE dry_run = 0 ORDER BY created_at DESC LIMIT ?")
    .all(limit) as BlueskyPostRow[];
}
