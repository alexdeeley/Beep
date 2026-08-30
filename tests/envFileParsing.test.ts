import { describe, it, expect } from "vitest";
import { parse } from "dotenv";
import { readFileSync } from "node:fs";

/**
 * Regression test for a real bug: dotenv treats an unquoted "#" as an
 * inline comment delimiter, so `HASHTAGS=#OnThisDay #History` silently
 * parses to an EMPTY STRING rather than the hashtag list - no error, no
 * warning, just silent data loss. The fix is quoting any env value that
 * contains "#" (e.g. `HASHTAGS="#OnThisDay #History"`). This test parses
 * the actual .env.example file on disk so a future edit that reintroduces
 * an unquoted "#" value fails loudly instead of silently.
 */
describe(".env.example parsing (dotenv '#' comment pitfall)", () => {
  const parsed = parse(readFileSync(".env.example"));

  it("demonstrates the pitfall: an unquoted value containing # parses to empty", () => {
    expect(parse("FOO=#bar baz").FOO).toBe("");
  });

  it("demonstrates the fix: quoting preserves a value containing #", () => {
    expect(parse('FOO="#bar baz"').FOO).toBe("#bar baz");
  });

  it("HASHTAGS in .env.example is non-empty and contains real hashtags", () => {
    expect(parsed.HASHTAGS).toBeTruthy();
    expect(parsed.HASHTAGS).toContain("#");
    expect(parsed.HASHTAGS!.split(/\s+/).length).toBeGreaterThan(1);
  });

  it("no documented env value is silently emptied by an unquoted #", () => {
    const raw = readFileSync(".env.example", "utf-8");
    for (const line of raw.split("\n")) {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=.*#/);
      if (!match) continue;
      const key = match[1]!;
      // If the source line contains a "#" after the "=", the parsed value
      // must still be non-empty (i.e. it was properly quoted), unless the
      // key legitimately has no default value at all.
      if (parsed[key] === "") {
        throw new Error(`${key} contains "#" but parsed to an empty string - quote its value in .env.example`);
      }
    }
  });
});
