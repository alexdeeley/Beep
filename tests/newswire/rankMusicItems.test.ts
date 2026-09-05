import { describe, it, expect } from "vitest";
import { rankMusicItems } from "../../src/newswire/ranking/rankMusicItems.js";
import type { UnpostedMusicItemRow } from "../../src/newswire/db/musicItemsRepo.js";

function item(overrides: Partial<UnpostedMusicItemRow> = {}): UnpostedMusicItemRow {
  return {
    id: 1,
    watched_artist_id: 1,
    item_type: "release",
    release_format: null,
    release_title: null,
    headline: "H",
    summary: "S",
    fact_label: "FACT",
    event_time: null,
    event_time_confidence: "unknown",
    article_published_at: null,
    primary_source_url: "https://example.com/1",
    source_domains_json: JSON.stringify(["a.com", "b.com"]),
    facts_json: "[]",
    discovered_in_run_id: 1,
    posted_in_run_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    artist_name: "Artist",
    ...overrides,
  };
}

describe("rankMusicItems", () => {
  it("preserves input (FIFO) order", () => {
    const items = [item({ id: 1 }), item({ id: 2 }), item({ id: 3 })];
    expect(rankMusicItems(items, 10).map((r) => r.item.id)).toEqual([1, 2, 3]);
  });

  it("caps at max", () => {
    expect(rankMusicItems([item({ id: 1 }), item({ id: 2 }), item({ id: 3 })], 2)).toHaveLength(2);
  });

  it("scores a release higher than news, all else equal", () => {
    const [release] = rankMusicItems([item({ item_type: "release" })], 1);
    const [news] = rankMusicItems([item({ item_type: "news" })], 1);
    expect(release!.importanceScore).toBeGreaterThan(news!.importanceScore);
  });

  it("scores FACT higher than UNCONFIRMED", () => {
    const [fact] = rankMusicItems([item({ fact_label: "FACT" })], 1);
    const [unconfirmed] = rankMusicItems([item({ fact_label: "UNCONFIRMED" })], 1);
    expect(fact!.importanceScore).toBeGreaterThan(unconfirmed!.importanceScore);
  });

  it("gives a small bonus for extra corroborating domains beyond the required 2, capped", () => {
    const two = rankMusicItems([item({ source_domains_json: JSON.stringify(["a.com", "b.com"]) })], 1)[0]!.importanceScore;
    const five = rankMusicItems([item({ source_domains_json: JSON.stringify(["a.com", "b.com", "c.com", "d.com", "e.com"]) })], 1)[0]!.importanceScore;
    const ten = rankMusicItems(
      [item({ source_domains_json: JSON.stringify(Array.from({ length: 10 }, (_, i) => `d${i}.com`)) })],
      1
    )[0]!.importanceScore;
    expect(five).toBeGreaterThan(two);
    expect(ten).toBe(five); // capped - 5 domains already hits the bonus cap
  });

  it("scores stay within [0,1]", () => {
    for (const label of ["FACT", "ANALYSIS", "UNCONFIRMED", "BACKGROUND", "PREDICTION"] as const) {
      const [ranked] = rankMusicItems([item({ fact_label: label })], 1);
      expect(ranked!.importanceScore).toBeGreaterThanOrEqual(0);
      expect(ranked!.importanceScore).toBeLessThanOrEqual(1);
    }
  });
});
