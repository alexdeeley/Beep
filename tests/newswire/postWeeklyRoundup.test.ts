import { describe, it, expect } from "vitest";
import { buildRoundupPosts } from "../../src/newswire/weeklyRoundup/postWeeklyRoundup.js";

describe("buildRoundupPosts", () => {
  it("puts the header and every line in one post when it fits", () => {
    const posts = buildRoundupPosts("WEEKLY NEW RELEASES", ["- Alvvays: Blue Rev II", "- Wilco: New album"]);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toBe("WEEKLY NEW RELEASES\n- Alvvays: Blue Rev II\n- Wilco: New album");
  });

  it("splits into multiple posts when the list is too long for one, never splitting a line", () => {
    const lines = Array.from({ length: 40 }, (_, i) => `- Artist ${i}: A moderately long album title number ${i}`);
    const posts = buildRoundupPosts("WEEKLY NEW RELEASES", lines, 200);
    expect(posts.length).toBeGreaterThan(1);
    // every line appears in exactly one post, in order, never broken mid-line
    const rejoined = posts.join("\n").split("\n").filter((l) => l.startsWith("- "));
    expect(rejoined).toEqual(lines);
  });

  it("throws if the header alone exceeds the limit", () => {
    expect(() => buildRoundupPosts("x".repeat(400), ["line"])).toThrow(/header/);
  });

  it("throws if a single line alone exceeds the limit", () => {
    expect(() => buildRoundupPosts("WEEKLY NEW RELEASES", ["x".repeat(400)], 300)).toThrow(/single roundup line/);
  });

  it("produces just the header when there are no lines", () => {
    expect(buildRoundupPosts("WEEKLY NEW RELEASES", [])).toEqual(["WEEKLY NEW RELEASES"]);
  });
});
