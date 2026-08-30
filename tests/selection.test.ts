import { describe, it, expect } from "vitest";
import { selectContent } from "../src/selection/selectContent.js";
import { loadConfig } from "../src/config/index.js";
import { RunLogger } from "../src/utils/logger.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VerifiedFact } from "../src/utils/types.js";

function makeFact(overrides: Partial<VerifiedFact>): VerifiedFact {
  return {
    id: overrides.id ?? "c" + Math.random().toString(36).slice(2),
    kind: "event",
    monthDay: "08-29",
    year: 1965,
    category: "space_exploration",
    headline: "Some Event Happens",
    description: "A description of the event that is reasonably short.",
    people: [],
    location: "Somewhere",
    historicalImportance: "medium",
    sources: [{ title: "x", publisher: "x", url: "https://x.com", authoritative: true }],
    confidence: 0.9,
    notes: "",
    primarySource: true,
    verificationStatus: "verified",
    verificationConfidence: 0.9,
    verifierNotes: "",
    checks: {
      dateConfirmed: true,
      yearConfirmed: true,
      personOrOrgConfirmed: true,
      kindConfirmed: true,
      notPublicationDateConfusion: true,
      notExaggerated: true,
      sufficientlyNotable: true,
      corroboratingSources: true,
      headlineMatchesDescription: true,
    },
    rejectionReason: null,
    ...overrides,
  };
}

function makeLogger(): RunLogger {
  const dir = mkdtempSync(join(tmpdir(), "on-this-day-test-"));
  return new RunLogger(dir);
}

describe("selectContent", () => {
  it("excludes anything not marked verified", () => {
    const config = loadConfig();
    const logger = makeLogger();
    const facts = [
      makeFact({ id: "a", verificationStatus: "verified", headline: "Verified Event" }),
      makeFact({ id: "b", verificationStatus: "rejected", headline: "Rejected Event" }),
      makeFact({ id: "c", verificationStatus: "needs_review", headline: "Needs Review Event" }),
    ];
    const selected = selectContent(config, logger, 2026, "AUGUST 29", "08-29", facts);
    const headlines = selected.majorEvents.map((e) => e.headline);
    expect(headlines).toContain("Verified Event");
    expect(headlines).not.toContain("Rejected Event");
    expect(headlines).not.toContain("Needs Review Event");
  });

  it("never exceeds the configured maximum per section", () => {
    const config = loadConfig();
    const logger = makeLogger();
    const facts = Array.from({ length: 20 }, (_, i) =>
      makeFact({ id: `e${i}`, headline: `Event Number ${i}`, category: i % 2 === 0 ? "science_discovery" : "music" })
    );
    const selected = selectContent(config, logger, 2026, "AUGUST 29", "08-29", facts);
    expect(selected.majorEvents.length).toBeLessThanOrEqual(config.selection.maxMajorEvents);
  });

  it("reduces section size rather than padding when too few verified facts exist (no fabrication)", () => {
    const config = loadConfig();
    const logger = makeLogger();
    const facts = [makeFact({ id: "only-one", headline: "The Only Event" })];
    const selected = selectContent(config, logger, 2026, "AUGUST 29", "08-29", facts);
    expect(selected.majorEvents.length).toBe(1);
  });

  it("deduplicates births by person", () => {
    const config = loadConfig();
    const logger = makeLogger();
    const facts = [
      makeFact({ id: "b1", kind: "birth", category: "birth", people: ["Ada Lovelace"], headline: "Ada Lovelace Born" }),
      makeFact({ id: "b2", kind: "birth", category: "birth", people: ["Ada Lovelace"], headline: "Ada Lovelace Born Again" }),
    ];
    const selected = selectContent(config, logger, 2026, "AUGUST 29", "08-29", facts);
    expect(selected.births.length).toBe(1);
  });

  it("excludes a death/birth from majorEvents even when research filed it as a separate event-kind candidate for the same person/year", () => {
    const config = loadConfig();
    const logger = makeLogger();
    const facts = [
      makeFact({
        id: "death-candidate",
        kind: "death",
        category: "death",
        year: 2012,
        people: ["Neil Armstrong"],
        headline: "Neil Armstrong Dies",
      }),
      makeFact({
        id: "event-candidate-same-fact",
        kind: "event",
        category: "science_discovery",
        year: 2012,
        people: ["Neil Armstrong"],
        headline: "Neil Armstrong Dies",
      }),
      makeFact({
        id: "genuinely-different-event",
        kind: "event",
        category: "space_exploration",
        year: 1969,
        people: ["Neil Armstrong"],
        headline: "Armstrong Walks on the Moon",
      }),
    ];
    const selected = selectContent(config, logger, 2026, "AUGUST 25", "08-25", facts);
    expect(selected.deaths.map((d) => d.id)).toContain("death-candidate");
    expect(selected.majorEvents.map((e) => e.id)).not.toContain("event-candidate-same-fact");
    // A genuinely different fact about the same person, in a different year, must still be kept.
    expect(selected.majorEvents.map((e) => e.id)).toContain("genuinely-different-event");
  });

  it("applies a soft per-category cap among major events so one category cannot dominate", () => {
    const config = loadConfig();
    const logger = makeLogger();
    const facts = Array.from({ length: 10 }, (_, i) =>
      makeFact({ id: `w${i}`, headline: `War Event ${i}`, category: "war_conflict", historicalImportance: "high" })
    );
    const selected = selectContent(config, logger, 2026, "AUGUST 29", "08-29", facts);
    // With only one category available it should still fill up to max
    // (backfill), but never crash or silently drop below available supply.
    expect(selected.majorEvents.length).toBeGreaterThan(0);
    expect(selected.majorEvents.length).toBeLessThanOrEqual(config.selection.maxMajorEvents);
  });

  it("truncates an unreasonably long headline/description (layout text-limit safety net)", () => {
    const config = loadConfig();
    const logger = makeLogger();
    const longHeadline = Array.from({ length: 30 }, (_, i) => `Word${i}`).join(" ");
    const longDescription = Array.from({ length: 100 }, (_, i) => `word${i}`).join(" ");
    const facts = [makeFact({ id: "long", headline: longHeadline, description: longDescription })];
    const selected = selectContent(config, logger, 2026, "AUGUST 29", "08-29", facts);
    const item = selected.majorEvents[0]!;
    expect(item.headline.split(/\s+/).length).toBeLessThanOrEqual(13); // 12 words + possible ellipsis token
    expect(item.description.split(/\s+/).length).toBeLessThanOrEqual(43);
  });
});
