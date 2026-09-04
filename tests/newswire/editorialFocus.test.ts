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
    expect(focus.neutralityNote.length).toBeGreaterThan(0);
    expect(focus.voice.allowJokes).toBe(false);
  });

  it("tolerates // line comments", () => {
    const path = join(dir, "focus.json");
    writeFileSync(
      path,
      `{
        "$schemaVersion": 2,
        // a comment
        "neutralityNote": "note",
        "quietHours": { "timezone": "UTC", "slowStartHourLocal": 23, "slowEndHourLocal": 6, "minImportanceScoreDuringSlow": 0.6, "minImportanceScoreDuringSilentThreshold": 0.85 },
        "voice": { "allowJokes": false, "allowHashtagsInline": false, "allowEmoji": false, "allowRhetoricalQuestions": false }
      }`
    );
    const focus = loadEditorialFocus(path);
    expect(focus.neutralityNote).toBe("note");
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
    writeFileSync(path, `{ "$schemaVersion": 2 }`);
    expect(() => loadEditorialFocus(path)).toThrow(/failed validation/);
  });

  it("rejects an invalid quietHours field", () => {
    const path = join(dir, "bad-quiet-hours.json");
    writeFileSync(
      path,
      `{
        "$schemaVersion": 2,
        "neutralityNote": "note",
        "quietHours": { "timezone": "UTC", "slowStartHourLocal": 25, "slowEndHourLocal": 6, "minImportanceScoreDuringSlow": 0.6, "minImportanceScoreDuringSilentThreshold": 0.85 },
        "voice": { "allowJokes": false, "allowHashtagsInline": false, "allowEmoji": false, "allowRhetoricalQuestions": false }
      }`
    );
    expect(() => loadEditorialFocus(path)).toThrow();
  });
});
