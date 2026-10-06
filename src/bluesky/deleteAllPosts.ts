import type { AppConfig } from "../config/index.js";
import type { RunLogger } from "../utils/logger.js";
import { type BlueskySession } from "./threadPublish.js";

interface ListRecordsResponse {
  records: { uri: string; cid: string }[];
  cursor?: string;
}

interface AtprotoError {
  error?: string;
  message?: string;
}

async function xrpcFetch<T>(service: string, pathAndQuery: string, opts: RequestInit): Promise<T> {
  const res = await fetch(`${service}/xrpc/${pathAndQuery}`, opts);
  const json = (await res.json().catch(() => ({}))) as T & AtprotoError;
  if (!res.ok) {
    throw new Error(`Bluesky API error (${pathAndQuery}): ${json.message ?? json.error ?? `HTTP ${res.status}`}`);
  }
  return json;
}

function rkeyFromUri(uri: string): string {
  const rkey = uri.split("/").pop();
  if (!rkey) throw new Error(`deleteAllPosts: couldn't extract an rkey from post URI "${uri}"`);
  return rkey;
}

/** Lists every app.bsky.feed.post record currently in the account's own repo, paginating via listRecords' cursor. */
export async function listAllPosts(config: AppConfig, session: BlueskySession): Promise<{ uri: string; cid: string }[]> {
  const all: { uri: string; cid: string }[] = [];
  let cursor: string | undefined;
  do {
    const params = new URLSearchParams({ repo: session.did, collection: "app.bsky.feed.post", limit: "100" });
    if (cursor) params.set("cursor", cursor);
    const res = await xrpcFetch<ListRecordsResponse>(config.bluesky.service, `com.atproto.repo.listRecords?${params}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${session.accessJwt}` },
    });
    for (const record of res.records) all.push({ uri: record.uri, cid: record.cid });
    cursor = res.cursor;
  } while (cursor);
  return all;
}

/**
 * Permanently deletes every post passed in - irreversible, at the account owner's explicit request.
 * Callers must list (and ideally persist a backup of) the posts themselves first via listAllPosts,
 * since there is no undo once a post is deleted. Failures on individual posts are logged and skipped
 * rather than aborting the whole batch, so one bad record can't block deleting the rest.
 */
export async function deleteAllPosts(
  config: AppConfig,
  logger: RunLogger,
  session: BlueskySession,
  posts: { uri: string }[]
): Promise<number> {
  let deleted = 0;
  for (const post of posts) {
    try {
      await xrpcFetch(config.bluesky.service, "com.atproto.repo.deleteRecord", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessJwt}` },
        body: JSON.stringify({ repo: session.did, collection: "app.bsky.feed.post", rkey: rkeyFromUri(post.uri) }),
      });
      deleted++;
      logger.info("bluesky-delete-all", `Deleted ${post.uri}`);
    } catch (err) {
      logger.error("bluesky-delete-all", `Failed to delete ${post.uri} - left in place`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return deleted;
}
