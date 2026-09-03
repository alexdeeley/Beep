import { describe, it, expect } from "vitest";
import { splitIntoThread, countGraphemes, ThreadSplitError } from "../../src/newswire/publishing/threadSplitter.js";

describe("countGraphemes", () => {
  it("counts plain ASCII text as one grapheme per character", () => {
    expect(countGraphemes("hello")).toBe(5);
  });

  it("counts a multi-codepoint emoji ZWJ sequence as a single grapheme", () => {
    expect(countGraphemes("👨‍👩‍👧‍👦")).toBe(1);
  });
});

describe("splitIntoThread", () => {
  it("leaves a post under the limit unchanged", () => {
    expect(splitIntoThread([{ text: "Hello world." }], 300)).toEqual(["Hello world."]);
  });

  it("splits an oversized post at sentence boundaries, never mid-sentence", () => {
    const long =
      "Sentence one is here and reasonably long for testing purposes indeed. " +
      "Sentence two continues the thought with more detail about the situation at hand. " +
      "Sentence three wraps things up with a final concluding remark about everything.";
    const result = splitIntoThread([{ text: long }], 100);

    expect(result.length).toBeGreaterThan(1);
    for (const post of result) {
      expect(countGraphemes(post)).toBeLessThanOrEqual(100);
    }
    // Every post must end with sentence-terminal punctuation - proof no split happened mid-sentence.
    for (const post of result) {
      expect(post.trim()).toMatch(/[.!?]$/);
    }
    // Reassembling should reproduce the original sentences in order (mod whitespace).
    expect(result.join(" ").replace(/\s+/g, " ")).toBe(long.replace(/\s+/g, " "));
  });

  it("throws rather than truncating when a single sentence alone exceeds the limit", () => {
    const unsplittable = "A".repeat(150) + ".";
    expect(() => splitIntoThread([{ text: unsplittable }], 100)).toThrow(ThreadSplitError);
  });

  it("keeps multiple already-short draft posts as separate posts", () => {
    const result = splitIntoThread([{ text: "First post." }, { text: "Second post." }], 300);
    expect(result).toEqual(["First post.", "Second post."]);
  });

  it("throws if the result would start with an empty first post", () => {
    expect(() => splitIntoThread([{ text: "" }], 300)).toThrow(ThreadSplitError);
  });
});
