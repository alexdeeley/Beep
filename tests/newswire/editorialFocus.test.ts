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
    expect(focus.sourceTiers.length).toBeGreaterThan(0);
  });

  it("tolerates // line comments", () => {
    const path = join(dir, "focus.json");
    writeFileSync(
      path,
      `{
        "$schemaVersion": 1,
        // a comment
        "sourceTiers": ["primary_official", "general_news"],
        "entertainmentTradePublishers": []
      }`
    );
    const focus = loadEditorialFocus(path);
    expect(focus.sourceTiers).toEqual(["primary_official", "general_news"]);
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
    writeFileSync(path, `{ "$schemaVersion": 1 }`);
    expect(() => loadEditorialFocus(path)).toThrow(/failed validation/);
  });

  it("defaults entertainmentTradePublishers to an empty array when omitted", () => {
    const path = join(dir, "no-trade-publishers.json");
    writeFileSync(path, `{ "$schemaVersion": 1, "sourceTiers": ["primary_official"] }`);
    const focus = loadEditorialFocus(path);
    expect(focus.entertainmentTradePublishers).toEqual([]);
  });
});
