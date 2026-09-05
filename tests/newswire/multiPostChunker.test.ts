import { describe, it, expect } from "vitest";
import { buildCommaSeparatedPost, buildMultiLinePost } from "../../src/newswire/publishing/multiPostChunker.js";

describe("buildCommaSeparatedPost", () => {
  it("puts the header and every item, comma-separated, in one post when it fits", () => {
    const posts = buildCommaSeparatedPost("NEW MUSIC FRIDAY 9/4/26", ["Alvvays", "Wilco"]);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toBe("NEW MUSIC FRIDAY 9/4/26\n\nAlvvays, Wilco");
  });

  it("splits into multiple posts when the list is too long for one, never splitting an item", () => {
    const items = Array.from({ length: 40 }, (_, i) => `A Moderately Long Artist Name Number ${i}`);
    const posts = buildCommaSeparatedPost("NEW MUSIC FRIDAY 9/4/26", items, 200);
    expect(posts.length).toBeGreaterThan(1);
    const rejoined = posts
      .join(", ")
      .replace("NEW MUSIC FRIDAY 9/4/26\n\n", "")
      .split(", ");
    expect(rejoined).toEqual(items);
  });

  it("throws if the header alone exceeds the limit", () => {
    expect(() => buildCommaSeparatedPost("x".repeat(400), ["Artist"])).toThrow(/header/);
  });

  it("throws if a single item alone exceeds the limit", () => {
    expect(() => buildCommaSeparatedPost("NEW MUSIC FRIDAY 9/4/26", ["x".repeat(400)], 300)).toThrow(/single item/);
  });

  it("produces just the header when there are no items", () => {
    expect(buildCommaSeparatedPost("NEW MUSIC FRIDAY 9/4/26", [])).toEqual(["NEW MUSIC FRIDAY 9/4/26"]);
  });
});

describe("buildMultiLinePost", () => {
  it("puts the header and every line in one post when it fits", () => {
    const posts = buildMultiLinePost("TODAY IN HISTORY 9/5", ["1977: Fleetwood Mac releases Dreams", "2019: Idles releases Suffer"]);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toBe("TODAY IN HISTORY 9/5\n\n1977: Fleetwood Mac releases Dreams\n\n2019: Idles releases Suffer");
  });

  it("splits into multiple posts when the list is too long for one, never splitting a line", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `19${50 + i}: A moderately long historical event description number ${i}`);
    const posts = buildMultiLinePost("TODAY IN HISTORY 9/5", lines, 200);
    expect(posts.length).toBeGreaterThan(1);
    const rejoined = posts.join("\n\n").split("\n\n").filter((l) => /^\d{4}:/.test(l));
    expect(rejoined).toEqual(lines);
  });

  it("throws if the header alone exceeds the limit", () => {
    expect(() => buildMultiLinePost("x".repeat(400), ["line"])).toThrow(/header/);
  });

  it("throws if a single line alone exceeds the limit", () => {
    expect(() => buildMultiLinePost("TODAY IN HISTORY 9/5", ["x".repeat(400)], 300)).toThrow(/single line/);
  });

  it("produces just the header when there are no lines", () => {
    expect(buildMultiLinePost("TODAY IN HISTORY 9/5", [])).toEqual(["TODAY IN HISTORY 9/5"]);
  });
});
