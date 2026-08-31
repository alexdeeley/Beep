import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isWeeklyCardRetired, writeRetirementMarker, readRetirementMarker } from "../src/weeklyCard/retirement.js";

describe("weekly card retirement marker", () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), "weekly-card-retirement-test-"));
  });
  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
  });

  it("reports not retired when no marker file exists yet", () => {
    expect(isWeeklyCardRetired(stateDir)).toBe(false);
    expect(readRetirementMarker(stateDir)).toBeNull();
  });

  it("reports retired once a marker has been written, and round-trips its content", () => {
    writeRetirementMarker(
      {
        retiredAt: "2036-08-31T09:22:00.000Z",
        retiredForRunDate: "2036-08-31",
        card: "Ace of Spades",
        reason: "test",
      },
      stateDir
    );
    expect(isWeeklyCardRetired(stateDir)).toBe(true);
    const record = readRetirementMarker(stateDir);
    expect(record?.retiredForRunDate).toBe("2036-08-31");
    expect(record?.card).toBe("Ace of Spades");
  });

  it("creates the state directory itself if it does not exist yet", () => {
    const nestedDir = join(stateDir, "nested", "deeper");
    writeRetirementMarker({ retiredAt: "2036-08-31T09:22:00.000Z", retiredForRunDate: "2036-08-31", card: "x", reason: "test" }, nestedDir);
    expect(isWeeklyCardRetired(nestedDir)).toBe(true);
  });
});
