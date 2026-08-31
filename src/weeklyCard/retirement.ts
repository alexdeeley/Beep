import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Once the once-a-decade special edition ("LIFE IS BEAUTIFUL. GOODBYE.")
 * is successfully published, the weekly card pipeline stops permanently -
 * per explicit direction, this is a one-way retirement, not just a skip
 * for that week.
 *
 * That has to be durable across GitHub Actions runs, which each start
 * from a fresh checkout with no local filesystem state carried over (the
 * same problem the daily pipeline solves by checking Bluesky's own post
 * history - see bluesky/publish.ts). Bluesky's own history isn't a good
 * fit here though: the daily pipeline keeps posting to the same account
 * forever, so a years-old special post would eventually scroll out of any
 * reasonably-bounded getAuthorFeed page. Instead, retirement is recorded
 * as a small tracked file committed back to the repo itself (see
 * .github/workflows/weekly-card.yml's commit step) - durable, free,
 * inspectable in git history, and immune to feed pagination depth.
 */
/** Default location, relative to the process's working directory (the repo root in both local and CI runs). Overridable for tests. */
const DEFAULT_STATE_DIR = "state";
const MARKER_FILENAME = "weekly-card-retired.json";

function markerPath(stateDir: string): string {
  return join(stateDir, MARKER_FILENAME);
}

export function isWeeklyCardRetired(stateDir: string = DEFAULT_STATE_DIR): boolean {
  return existsSync(markerPath(stateDir));
}

export interface RetirementRecord {
  retiredAt: string;
  retiredForRunDate: string;
  card: string;
  reason: string;
}

export function writeRetirementMarker(record: RetirementRecord, stateDir: string = DEFAULT_STATE_DIR): void {
  mkdirSync(dirname(markerPath(stateDir)), { recursive: true });
  writeFileSync(markerPath(stateDir), JSON.stringify(record, null, 2) + "\n", "utf-8");
}

export function readRetirementMarker(stateDir: string = DEFAULT_STATE_DIR): RetirementRecord | null {
  const path = markerPath(stateDir);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as RetirementRecord;
}
