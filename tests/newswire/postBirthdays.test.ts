import { describe, it, expect } from "vitest";
import { buildBirthdayText } from "../../src/newswire/birthdays/postBirthdays.js";
import type { WatchedArtistRow } from "../../src/newswire/db/watchedArtistsRepo.js";

function makeArtist(overrides: Partial<WatchedArtistRow> = {}): WatchedArtistRow {
  return {
    id: 1,
    name: "Björk",
    last_checked_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    birth_month: 11,
    birth_day: 21,
    birth_year: null,
    birth_date_checked_at: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildBirthdayText", () => {
  it("states the age when birth_year is known", () => {
    const artist = makeArtist({ birth_year: 1965 });
    expect(buildBirthdayText(artist, 2026, false)).toBe("Happy birthday, Björk. 61 years young.");
  });

  it("omits the age entirely when birth_year is unknown, rather than guessing", () => {
    const artist = makeArtist({ birth_year: null });
    expect(buildBirthdayText(artist, 2026, false)).toBe("Happy birthday, Björk.");
  });

  it("appends an emoji only when voice.allowEmoji is true", () => {
    const artist = makeArtist({ birth_year: 1965 });
    const withEmoji = buildBirthdayText(artist, 2026, true);
    const withoutEmoji = buildBirthdayText(artist, 2026, false);
    expect(withEmoji).not.toBe(withoutEmoji);
    expect(withEmoji.startsWith(withoutEmoji)).toBe(true);
  });
});
