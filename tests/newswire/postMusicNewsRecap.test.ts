import { describe, it, expect } from "vitest";
import { formatBlurbAsSentence } from "../../src/newswire/musicNews/postMusicNewsRecap.js";

describe("formatBlurbAsSentence", () => {
  it("capitalizes the first letter and appends a period", () => {
    expect(formatBlurbAsSentence("rivers cuomo arrested")).toBe("Rivers cuomo arrested.");
  });

  it("does not double up a terminal period already present", () => {
    expect(formatBlurbAsSentence("Idles breaks up.")).toBe("Idles breaks up.");
  });

  it("does not append a period after a question mark or exclamation point", () => {
    expect(formatBlurbAsSentence("Is this real?")).toBe("Is this real?");
    expect(formatBlurbAsSentence("Wow!")).toBe("Wow!");
  });

  it("trims surrounding whitespace before formatting", () => {
    expect(formatBlurbAsSentence("  avril lavigne dies  ")).toBe("Avril lavigne dies.");
  });
});
