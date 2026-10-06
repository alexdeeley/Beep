import { describe, it, expect, afterEach } from "vitest";
import { loadConfig } from "../src/config/index.js";

const ENV_KEYS = [
  "APP_TIMEZONE",
  "MAX_MAJOR_EVENTS",
  "MIN_VERIFICATION_CONFIDENCE",
  "ENABLE_STORY_RENDER",
  "BRAND_THEME",
  "HASHTAGS",
  "STORAGE_PROVIDER",
];

describe("loadConfig", () => {
  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it("applies sensible defaults when no env vars are set", () => {
    const config = loadConfig();
    expect(config.timezone).toBe("America/Los_Angeles");
    expect(config.image.feedWidth).toBe(1080);
    expect(config.image.feedHeight).toBe(1350);
    expect(config.image.enableStory).toBe(false);
    expect(config.selection.maxMajorEvents).toBe(7);
  });

  it("reads string overrides from the environment", () => {
    process.env.APP_TIMEZONE = "Europe/London";
    process.env.BRAND_THEME = "deep_navy";
    const config = loadConfig();
    expect(config.timezone).toBe("Europe/London");
    expect(config.brand.theme).toBe("deep_navy");
  });

  it("parses integer overrides", () => {
    process.env.MAX_MAJOR_EVENTS = "3";
    const config = loadConfig();
    expect(config.selection.maxMajorEvents).toBe(3);
  });

  it("parses float overrides", () => {
    process.env.MIN_VERIFICATION_CONFIDENCE = "0.55";
    const config = loadConfig();
    expect(config.selection.minVerificationConfidence).toBe(0.55);
  });

  it("parses boolean overrides case-insensitively", () => {
    process.env.ENABLE_STORY_RENDER = "TRUE";
    expect(loadConfig().image.enableStory).toBe(true);
    process.env.ENABLE_STORY_RENDER = "0";
    expect(loadConfig().image.enableStory).toBe(false);
  });

  it("falls back to defaults instead of crashing on garbage numeric input", () => {
    process.env.MAX_MAJOR_EVENTS = "not-a-number";
    const config = loadConfig();
    expect(config.selection.maxMajorEvents).toBe(7);
  });

  it("splits the hashtag list on whitespace", () => {
    process.env.HASHTAGS = "#OnThisDay #History  #Today";
    const config = loadConfig();
    expect(config.brand.hashtags).toEqual(["#OnThisDay", "#History", "#Today"]);
  });
});
