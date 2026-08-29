import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isAlreadyPublished } from "../src/utils/stateStore.js";
import { publishToInstagram } from "../src/instagram/publish.js";
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

describe("publishToInstagram idempotency + dry-run guards", () => {
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
    const record = await publishToInstagram(config, logger, {
      date: "2026-08-29",
      publicImageUrl: "https://example.com/img.png",
      caption: "caption",
      dryRun: false,
      alreadyPublished: true,
    });
    expect(record.status).toBe("SKIPPED_ALREADY_PUBLISHED");
    expect(record.mediaId).toBeNull();
  });

  it("never calls the network and returns SKIPPED_DRY_RUN when dryRun is true", async () => {
    const config = baseConfig(runsDir);
    const logger = new RunLogger(join(runsDir, "2026-08-29"));
    const record = await publishToInstagram(config, logger, {
      date: "2026-08-29",
      publicImageUrl: "https://example.com/img.png",
      caption: "caption",
      dryRun: true,
      alreadyPublished: false,
    });
    expect(record.status).toBe("SKIPPED_DRY_RUN");
  });

  it("returns SKIPPED_NO_CREDENTIALS when Instagram credentials are not configured", async () => {
    const config = baseConfig(runsDir);
    config.instagram.accessToken = undefined;
    config.instagram.userId = undefined;
    const logger = new RunLogger(join(runsDir, "2026-08-29"));
    const record = await publishToInstagram(config, logger, {
      date: "2026-08-29",
      publicImageUrl: "https://example.com/img.png",
      caption: "caption",
      dryRun: false,
      alreadyPublished: false,
    });
    expect(record.status).toBe("SKIPPED_NO_CREDENTIALS");
  });

  it("fails without a public image URL rather than calling Instagram with an unusable payload", async () => {
    const config = baseConfig(runsDir);
    config.instagram.accessToken = "token";
    config.instagram.userId = "12345";
    const logger = new RunLogger(join(runsDir, "2026-08-29"));
    const record = await publishToInstagram(config, logger, {
      date: "2026-08-29",
      publicImageUrl: null,
      caption: "caption",
      dryRun: false,
      alreadyPublished: false,
    });
    expect(record.status).toBe("FAILED");
    expect(record.error).toBeTruthy();
  });
});
