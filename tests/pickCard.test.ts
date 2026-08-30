import { describe, it, expect } from "vitest";
import { pickWeeklyCard } from "../src/weeklyCard/pickCard.js";

describe("pickWeeklyCard", () => {
  it("is deterministic - the same date always returns the same card", () => {
    expect(pickWeeklyCard("2026-09-06")).toEqual(pickWeeklyCard("2026-09-06"));
  });

  it("never picks the same card on two consecutive weekly runs", () => {
    expect(pickWeeklyCard("2026-09-06")).not.toEqual(pickWeeklyCard("2026-09-13"));
  });

  it("cycles through the full 52-card deck before repeating any card", () => {
    const seen = new Set<string>();
    let date = new Date("2026-01-04T00:00:00Z"); // a Sunday
    let firstRepeatAt = -1;
    for (let i = 0; i < 200; i++) {
      const iso = date.toISOString().slice(0, 10);
      const label = pickWeeklyCard(iso).label;
      if (seen.has(label)) {
        firstRepeatAt = i;
        break;
      }
      seen.add(label);
      date = new Date(date.getTime() + 7 * 86_400_000);
    }
    expect(seen.size).toBe(52);
    expect(firstRepeatAt).toBe(52);
  });

  it("every card has a well-formed label matching its rank and suit", () => {
    const card = pickWeeklyCard("2026-09-06");
    expect(card.label).toBe(`${card.rank} of ${card.suit}`);
  });
});
