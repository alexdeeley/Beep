import { describe, it, expect } from "vitest";
import { buildArtAltText } from "../src/caption/generateCaption.js";
import type { SelectedContent } from "../src/utils/types.js";

function makeSelected(overrides: Partial<SelectedContent>): SelectedContent {
  return {
    date: "2026-05-02",
    monthDay: "05-02",
    displayDate: "MAY 2",
    subtitle: "",
    majorEvents: [],
    births: [],
    deaths: [],
    incidents: [],
    sourceCreditLine: "",
    theme: "classic_gold",
    ...overrides,
  };
}

describe("buildArtAltText", () => {
  it("puts the title first, then a human-readable date, then inline hashtags", () => {
    const alt = buildArtAltText("Fractured Dawn", makeSelected({}), ["ColdWar", "DNA"]);
    expect(alt.split("\n")).toEqual(["Fractured Dawn", "May 2, 2026", "#ColdWar #DNA"]);
  });

  it("omits the hashtag line entirely when there are no tags", () => {
    const alt = buildArtAltText("Fractured Dawn", makeSelected({}), []);
    expect(alt).toBe("Fractured Dawn\nMay 2, 2026");
  });

  it("formats the date using the actual ISO date, not the display date string", () => {
    const alt = buildArtAltText("Title", makeSelected({ date: "2026-12-25", displayDate: "DECEMBER 25" }), []);
    expect(alt).toContain("December 25, 2026");
  });
});
