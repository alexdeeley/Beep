import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isAlreadyPublished } from "../src/utils/stateStore.js";
import { publishToBluesky, selectBlueskyTags } from "../src/bluesky/publish.js";
import { loadConfig } from "../src/config/index.js";
import { RunLogger } from "../src/utils/logger.js";

function baseConfig(runsDir: string) {
  const config = loadConfig();
  return { ...config, paths: { ...config.paths, runsDir } };
}

describe("isAlreadyPublished (publish-state checking)", () => {
  let runsDir: string;

  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), "on-this-day-test-"));
  });
  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  it("returns false when no publish.json exists yet", () => {
    const config = baseConfig(runsDir);
    expect(isAlreadyPublished(config, "2026-08-29")).toBe(false);
  });

  it("returns true only when status is SUCCESS", () => {
    const config = baseConfig(runsDir);
    const dateDir = join(runsDir, "2026-08-29");
    mkdirSync(dateDir, { recursive: true });
    writeFileSync(join(dateDir, "publish.json"), JSON.stringify({ status: "SUCCESS" }));
    expect(isAlreadyPublished(config, "2026-08-29")).toBe(true);
  });

  it("returns false for a failed or skipped prior attempt (allows retry)", () => {
    const config = baseConfig(runsDir);
    const dateDir = join(runsDir, "2026-08-29");
    mkdirSync(dateDir, { recursive: true });
    writeFileSync(join(dateDir, "publish.json"), JSON.stringify({ status: "FAILED" }));
    expect(isAlreadyPublished(config, "2026-08-29")).toBe(false);
  });

  it("fails closed (treats as not-published) on a corrupt publish.json rather than blocking forever", () => {
    const config = baseConfig(runsDir);
    const dateDir = join(runsDir, "2026-08-29");
    mkdirSync(dateDir, { recursive: true });
    writeFileSync(join(dateDir, "publish.json"), "{ this is not valid json");
    expect(isAlreadyPublished(config, "2026-08-29")).toBe(false);
  });

  it("is scoped per-date and does not leak across dates", () => {
    const config = baseConfig(runsDir);
    const dateDir = join(runsDir, "2026-08-29");
    mkdirSync(dateDir, { recursive: true });
    writeFileSync(join(dateDir, "publish.json"), JSON.stringify({ status: "SUCCESS" }));
    expect(isAlreadyPublished(config, "2026-08-30")).toBe(false);
  });
});

describe("publishToBluesky idempotency + dry-run guards", () => {
  let runsDir: string;
  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), "on-this-day-test-"));
  });
  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  it("never calls the network and returns SKIPPED_ALREADY_PUBLISHED when alreadyPublished is true", async () => {
    const config = baseConfig(runsDir);
    const logger = new RunLogger(join(runsDir, "2026-08-29"));
    const record = await publishToBluesky(config, logger, {
      date: "2026-08-29",
      localImagePath: "/tmp/does-not-matter.png",
      publicImageUrl: "https://example.com/img.png",
      altText: "caption",
      tags: ["history", "onthisday"],
      dryRun: false,
      alreadyPublished: true,
    });
    expect(record.status).toBe("SKIPPED_ALREADY_PUBLISHED");
    expect(record.postUri).toBeNull();
  });

  it("never calls the network and returns SKIPPED_DRY_RUN when dryRun is true", async () => {
    const config = baseConfig(runsDir);
    const logger = new RunLogger(join(runsDir, "2026-08-29"));
    const record = await publishToBluesky(config, logger, {
      date: "2026-08-29",
      localImagePath: "/tmp/does-not-matter.png",
      publicImageUrl: "https://example.com/img.png",
      altText: "caption",
      tags: ["history", "onthisday"],
      dryRun: true,
      alreadyPublished: false,
    });
    expect(record.status).toBe("SKIPPED_DRY_RUN");
  });

  it("returns SKIPPED_NO_CREDENTIALS when Bluesky credentials are not configured", async () => {
    const config = baseConfig(runsDir);
    config.bluesky.identifier = undefined;
    config.bluesky.appPassword = undefined;
    const logger = new RunLogger(join(runsDir, "2026-08-29"));
    const record = await publishToBluesky(config, logger, {
      date: "2026-08-29",
      localImagePath: "/tmp/does-not-matter.png",
      publicImageUrl: "https://example.com/img.png",
      altText: "caption",
      tags: ["history", "onthisday"],
      dryRun: false,
      alreadyPublished: false,
    });
    expect(record.status).toBe("SKIPPED_NO_CREDENTIALS");
  });

  it("fails without a local image file rather than calling Bluesky with an unusable payload", async () => {
    const config = baseConfig(runsDir);
    config.bluesky.identifier = "user.bsky.social";
    config.bluesky.appPassword = "app-password";
    const logger = new RunLogger(join(runsDir, "2026-08-29"));
    const record = await publishToBluesky(config, logger, {
      date: "2026-08-29",
      localImagePath: null,
      publicImageUrl: null,
      altText: "caption",
      tags: ["history", "onthisday"],
      dryRun: false,
      alreadyPublished: false,
    });
    expect(record.status).toBe("FAILED");
    expect(record.error).toBeTruthy();
  });
});

describe("selectBlueskyTags (hard 8-tag AT Protocol limit)", () => {
  it("never returns more than 8 tags even given a much larger pool", () => {
    const pool = Array.from({ length: 50 }, (_, i) => `#Tag${i}`);
    expect(selectBlueskyTags(pool).length).toBeLessThanOrEqual(8);
  });

  it("strips leading # and deduplicates case-insensitively", () => {
    const tags = selectBlueskyTags(["#History", "history", "#HISTORY", "#Past"]);
    expect(tags).toEqual(["History", "Past"]);
  });

  it("preserves pool order so callers can prioritize evergreen tags first", () => {
    const tags = selectBlueskyTags(["#OnThisDay", "#History", "#Random"]);
    expect(tags).toEqual(["OnThisDay", "History", "Random"]);
  });

  it("truncates an individual tag longer than 64 graphemes", () => {
    const longTag = "#" + "a".repeat(100);
    const tags = selectBlueskyTags([longTag]);
    expect(tags[0]!.length).toBe(64);
  });

  it("drops empty/whitespace-only entries without counting toward the cap", () => {
    const tags = selectBlueskyTags(["#", "  ", "#Valid"]);
    expect(tags).toEqual(["Valid"]);
  });
});
