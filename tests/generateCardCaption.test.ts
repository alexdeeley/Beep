import { describe, it, expect } from "vitest";
import { buildCardAltText, buildCardTags, CARD_POST_MARKER } from "../src/weeklyCard/generateCardCaption.js";
import { formatHumanDate } from "../src/utils/dateUtils.js";
import type { PlayingCard } from "../src/weeklyCard/pickCard.js";

const CARD: PlayingCard = { rank: "Queen", suit: "Spades", label: "Queen of Spades" };

describe("buildCardAltText", () => {
  it("includes the card-draw marker, the card label, and the ISO date", () => {
    const alt = buildCardAltText("2026-09-06", CARD, false, ["CardDraw", "QueenOfSpades", "Spades"]);
    expect(alt).toContain(CARD_POST_MARKER);
    expect(alt).toContain(CARD.label);
    expect(alt).toContain("2026-09-06");
  });

  it("uses a distinct 'Special Edition' title on decade weeks", () => {
    const alt = buildCardAltText("2036-08-31", CARD, true, ["CardDraw", "SpecialEdition"]);
    expect(alt).toContain("Special Edition");
  });

  it("never contains the daily pipeline's human-formatted date string - avoids idempotency collisions on the shared account", () => {
    const isoDate = "2026-09-06";
    const alt = buildCardAltText(isoDate, CARD, false, ["CardDraw"]);
    expect(alt).not.toContain(formatHumanDate(isoDate));
  });
});

describe("buildCardTags", () => {
  it("includes the card's suit and a collapsed-label tag for a normal week", () => {
    const tags = buildCardTags(CARD, false);
    expect(tags).toContain("CardDraw");
    expect(tags).toContain("QueenOfSpades");
    expect(tags).toContain("Spades");
  });

  it("uses a fixed distinct tag set on decade weeks, independent of the drawn card", () => {
    const tags = buildCardTags(CARD, true);
    expect(tags).toEqual(["CardDraw", "SpecialEdition"]);
  });
});
