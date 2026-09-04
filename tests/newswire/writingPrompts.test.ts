import { describe, it, expect } from "vitest";
import { buildWritingUserPrompt, type WritingItem } from "../../src/newswire/writing/prompts.js";

describe("buildWritingUserPrompt", () => {
  const item: WritingItem = {
    musicItemId: 1,
    artistName: "Alvvays",
    itemType: "release",
    releaseFormat: "album",
    headline: "Alvvays release Blue Rev II",
    facts: [
      {
        claim: "Alvvays released a new album titled Blue Rev II on September 1.",
        factLabel: "FACT",
        eventTimeIso: "2026-09-01T00:00:00.000Z",
        eventTimeConfidence: "exact",
        articlePublishedAtIso: "2026-09-01T12:00:00.000Z",
        sources: [{ url: "https://pitchfork.com/a", title: "x", domain: "pitchfork.com", sourceTier: "entertainment_trade", isPrimary: true }],
      },
    ],
  };

  it("includes the artist name, item type, headline, and every fact with its label", () => {
    const prompt = buildWritingUserPrompt([item]);
    expect(prompt).toContain("Alvvays");
    expect(prompt).toContain("release");
    expect(prompt).toContain("Alvvays release Blue Rev II");
    expect(prompt).toContain("[FACT]");
    expect(prompt).toContain("Blue Rev II");
  });

  it("separates multiple items into distinct numbered blocks", () => {
    const second: WritingItem = { ...item, musicItemId: 2, artistName: "Wilco", headline: "Wilco announce tour" };
    const prompt = buildWritingUserPrompt([item, second]);
    expect(prompt).toContain("ITEM 0");
    expect(prompt).toContain("ITEM 1");
    expect(prompt).toContain("Wilco");
  });
});
