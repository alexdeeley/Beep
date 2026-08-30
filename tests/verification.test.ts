import { describe, it, expect } from "vitest";
import { applyProgrammaticGate } from "../src/verification/verifyAgent.js";
import { loadConfig } from "../src/config/index.js";
import type { VerifiedFact } from "../src/utils/types.js";

function makeFact(overrides: Partial<VerifiedFact> = {}): VerifiedFact {
  return {
    id: "c001",
    kind: "event",
    monthDay: "08-29",
    year: 1965,
    category: "space_exploration",
    headline: "Gemini V Splashes Down",
    description: "NASA's Gemini V capsule returned to Earth after nearly eight days in orbit.",
    people: [],
    location: "Atlantic Ocean",
    historicalImportance: "medium",
    sources: [{ title: "NASA", publisher: "NASA", url: "https://nasa.gov", authoritative: true }],
    confidence: 0.9,
    notes: "",
    primarySource: true,
    verificationStatus: "verified",
    verificationConfidence: 0.9,
    verifierNotes: "",
    checks: {
      dateConfirmed: true,
      yearConfirmed: true,
      personOrOrgConfirmed: true,
      kindConfirmed: true,
      notPublicationDateConfusion: true,
      notExaggerated: true,
      sufficientlyNotable: true,
      corroboratingSources: true,
      headlineMatchesDescription: true,
    },
    rejectionReason: null,
    ...overrides,
  };
}

describe("applyProgrammaticGate (strict verification threshold enforcement)", () => {
  it("keeps a fact verified when it clears every configured threshold", () => {
    const config = loadConfig();
    const [result] = applyProgrammaticGate(config, [makeFact()]);
    expect(result!.verificationStatus).toBe("verified");
  });

  it("downgrades to needs_review when verificationConfidence is below the configured minimum", () => {
    const config = { ...loadConfig() };
    config.selection = { ...config.selection, minVerificationConfidence: 0.95 };
    const [result] = applyProgrammaticGate(config, [makeFact({ verificationConfidence: 0.8 })]);
    expect(result!.verificationStatus).toBe("needs_review");
  });

  it("downgrades a high-importance item lacking enough authoritative sources", () => {
    const config = { ...loadConfig() };
    config.selection = { ...config.selection, minAuthoritativeSources: 2 };
    const [result] = applyProgrammaticGate(
      config,
      [makeFact({ historicalImportance: "high", sources: [{ title: "x", publisher: "x", url: "https://x.com", authoritative: true }] })]
    );
    expect(result!.verificationStatus).toBe("needs_review");
  });

  it("downgrades when the verifier's own required checks disagree with an overall 'verified' label", () => {
    const config = loadConfig();
    const [result] = applyProgrammaticGate(
      config,
      [makeFact({ checks: { ...makeFact().checks, notPublicationDateConfusion: false } })]
    );
    expect(result!.verificationStatus).toBe("needs_review");
  });

  it("never upgrades a rejected fact - the gate only ever tightens, never loosens", () => {
    const config = loadConfig();
    const [result] = applyProgrammaticGate(config, [makeFact({ verificationStatus: "rejected" })]);
    expect(result!.verificationStatus).toBe("rejected");
  });

  it("leaves needs_review facts untouched (gate only applies to already-verified facts)", () => {
    const config = loadConfig();
    const [result] = applyProgrammaticGate(config, [makeFact({ verificationStatus: "needs_review" })]);
    expect(result!.verificationStatus).toBe("needs_review");
  });
});
