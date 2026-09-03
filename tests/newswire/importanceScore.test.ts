import { describe, it, expect } from "vitest";
import { computeImportanceScore, type ImportanceScoreInput } from "../../src/newswire/ranking/importanceScore.js";

function baseInput(overrides: Partial<ImportanceScoreInput> = {}): ImportanceScoreInput {
  return {
    topicWeight: 0.5,
    sourceTiers: ["general_news"],
    factLabels: ["FACT"],
    isContinuation: false,
    parentStoryImportance: null,
    watchListMatch: false,
    eventAgeHours: 1,
    distinctSourceDomains: 2,
    ...overrides,
  };
}

describe("computeImportanceScore", () => {
  it("always returns a score in [0, 1]", () => {
    const score = computeImportanceScore(baseInput());
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("scores a primary-official-sourced FACT higher than a blog_social-sourced UNCONFIRMED claim, all else equal", () => {
    const strong = computeImportanceScore(baseInput({ sourceTiers: ["primary_official"], factLabels: ["FACT"] }));
    const weak = computeImportanceScore(baseInput({ sourceTiers: ["blog_social"], factLabels: ["UNCONFIRMED"] }));
    expect(strong).toBeGreaterThan(weak);
  });

  it("is NOT driven by source/outlet count alone - two low-tier sources should not beat one high-tier source", () => {
    const manyWeak = computeImportanceScore(
      baseInput({ sourceTiers: ["blog_social", "blog_social", "blog_social"], distinctSourceDomains: 3 })
    );
    const oneStrong = computeImportanceScore(baseInput({ sourceTiers: ["primary_official"], distinctSourceDomains: 2 }));
    expect(oneStrong).toBeGreaterThan(manyWeak);
  });

  it("scores recent events higher than stale ones, all else equal", () => {
    const fresh = computeImportanceScore(baseInput({ eventAgeHours: 0.5 }));
    const stale = computeImportanceScore(baseInput({ eventAgeHours: 48 }));
    expect(fresh).toBeGreaterThan(stale);
  });

  it("boosts a watch-list match over an otherwise identical non-match", () => {
    const matched = computeImportanceScore(baseInput({ watchListMatch: true }));
    const unmatched = computeImportanceScore(baseInput({ watchListMatch: false }));
    expect(matched).toBeGreaterThan(unmatched);
  });

  it("lets a continuation inherit weight from an already-important parent story", () => {
    const continuation = computeImportanceScore(
      baseInput({ isContinuation: true, parentStoryImportance: 0.95, sourceTiers: ["blog_social"], factLabels: ["UNCONFIRMED"] })
    );
    const freshLowSignal = computeImportanceScore(baseInput({ sourceTiers: ["blog_social"], factLabels: ["UNCONFIRMED"] }));
    expect(continuation).toBeGreaterThan(freshLowSignal);
  });

  it("handles an empty sourceTiers/factLabels array without throwing", () => {
    expect(() => computeImportanceScore(baseInput({ sourceTiers: [], factLabels: [] }))).not.toThrow();
  });

  it("handles a null eventAgeHours (unknown timing) without throwing", () => {
    expect(() => computeImportanceScore(baseInput({ eventAgeHours: null }))).not.toThrow();
  });
});
