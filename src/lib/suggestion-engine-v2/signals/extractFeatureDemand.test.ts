import { describe, it, expect } from "vitest";
import { extractFeatureDemand } from "./extractFeatureDemand";

describe("extractFeatureDemand", () => {
  it("returns one signal for a sentence with external actor + desire verb", () => {
    const sentences = ["They need the bulk-upload feature by Q3."];
    const signals = extractFeatureDemand(sentences);

    expect(signals).toHaveLength(1);
    expect(signals[0].label).toBe("idea");
    expect(signals[0].confidence).toBeGreaterThanOrEqual(0.65);
  });

  it("uses base confidence 0.65 when no amplifier is present", () => {
    const sentences = ["Users want a dark mode option."];
    const signals = extractFeatureDemand(sentences);

    expect(signals).toHaveLength(1);
    expect(signals[0].confidence).toBe(0.65);
  });

  it("boosts confidence to 0.75 when an amplifier keyword is present", () => {
    const sentences = ["Customers need this feature — it is a blocker for expansion."];
    const signals = extractFeatureDemand(sentences);

    expect(signals).toHaveLength(1);
    expect(signals[0].confidence).toBe(0.75);
  });

  it("returns empty array when no external actor is present", () => {
    const sentences = ["We need to refactor the module."];
    const signals = extractFeatureDemand(sentences);

    expect(signals).toHaveLength(0);
  });

  it("returns empty array when no desire verb is present", () => {
    const sentences = ["Users are happy with the current UI."];
    const signals = extractFeatureDemand(sentences);

    expect(signals).toHaveLength(0);
  });

  it("sets sentenceIndex correctly for multi-sentence input", () => {
    const sentences = [
      "The team met yesterday.",
      "Sales are asking for bulk import.",
    ];
    const signals = extractFeatureDemand(sentences);

    expect(signals).toHaveLength(1);
    expect(signals[0].sentenceIndex).toBe(1);
  });

  it("sets signalType to FEATURE_DEMAND and proposedType to idea", () => {
    const sentences = ["The CTO requires a reporting dashboard."];
    const signals = extractFeatureDemand(sentences);

    expect(signals[0].signalType).toBe("FEATURE_DEMAND");
    expect(signals[0].proposedType).toBe("idea");
  });
});
