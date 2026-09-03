import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEditorialFocus } from "../../src/newswire/editorialFocus.js";

describe("loadEditorialFocus", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "editorial-focus-test-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads and validates the actual repo-root editorial-focus.json", () => {
    // loadEditorialFocus resolves relative to process.cwd() (see editorialFocus.ts), which vitest runs from the repo root.
    const focus = loadEditorialFocus("editorial-focus.json");
    expect(focus.priorityTopics.length).toBeGreaterThan(0);
    expect(focus.voice.allowJokes).toBe(false);
  });

  it("tolerates // line comments inside arrays", () => {
    const path = join(dir, "focus.json");
    writeFileSync(
      path,
      `{
        "$schemaVersion": 1,
        "priorityTopics": [{ "key": "politics", "label": "Politics", "weight": 1, "sourceTierTrack": "hard_news" }],
        "neutralityNote": "note",
        "watch": [
          // a comment
        ],
        "exclude": [],
        "sourceTiers": { "hard_news": ["general_news"], "entertainment": ["general_news"] },
        "entertainmentTradePublishers": [],
        "quietHours": { "timezone": "UTC", "slowStartHourLocal": 23, "slowEndHourLocal": 6, "minImportanceScoreDuringSlow": 0.6, "minImportanceScoreDuringSilentThreshold": 0.85 },
        "voice": { "allowJokes": false, "allowHashtagsInline": false, "allowEmoji": false, "allowRhetoricalQuestions": false }
      }`
    );
    const focus = loadEditorialFocus(path);
    expect(focus.watch).toEqual([]);
  });

  it("throws a clear error for a missing file", () => {
    expect(() => loadEditorialFocus(join(dir, "does-not-exist.json"))).toThrow(/not found/);
  });

  it("throws a clear error for invalid JSON", () => {
    const path = join(dir, "bad.json");
    writeFileSync(path, "{ not valid json");
    expect(() => loadEditorialFocus(path)).toThrow(/not valid JSON/);
  });

  it("throws a clear error when required fields are missing (schema validation)", () => {
    const path = join(dir, "incomplete.json");
    writeFileSync(path, `{ "$schemaVersion": 1, "priorityTopics": [] }`);
    expect(() => loadEditorialFocus(path)).toThrow(/failed validation/);
  });

  it("rejects a priorityTopics entry with an invalid sourceTierTrack", () => {
    const path = join(dir, "bad-track.json");
    writeFileSync(
      path,
      `{
        "$schemaVersion": 1,
        "priorityTopics": [{ "key": "politics", "label": "Politics", "weight": 1, "sourceTierTrack": "not_a_real_track" }],
        "neutralityNote": "note",
        "watch": [],
        "exclude": [],
        "sourceTiers": { "hard_news": ["general_news"], "entertainment": ["general_news"] },
        "entertainmentTradePublishers": [],
        "quietHours": { "timezone": "UTC", "slowStartHourLocal": 23, "slowEndHourLocal": 6, "minImportanceScoreDuringSlow": 0.6, "minImportanceScoreDuringSilentThreshold": 0.85 },
        "voice": { "allowJokes": false, "allowHashtagsInline": false, "allowEmoji": false, "allowRhetoricalQuestions": false }
      }`
    );
    expect(() => loadEditorialFocus(path)).toThrow();
  });
});
