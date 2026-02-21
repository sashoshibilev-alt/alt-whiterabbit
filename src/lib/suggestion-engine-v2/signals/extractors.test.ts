/**
 * Minimal extractor tests — one per B-signal extractor.
 *
 * Each test asserts:
 * - Exactly one signal returned
 * - Correct label
 * - Confidence >= base threshold for that extractor
 *
 * Do NOT modify extractFeatureDemand.test.ts.
 */

import { describe, it, expect } from "vitest";
import { extractPlanChange } from "./extractPlanChange";
import { extractScopeRisk } from "./extractScopeRisk";
import { extractBug } from "./extractBug";

describe("extractPlanChange", () => {
  it("detects a plan change when launch is pushed to Q3", () => {
    const sentences = ["We're pushing the launch to Q3."];
    const signals = extractPlanChange(sentences);

    expect(signals).toHaveLength(1);
    expect(signals[0].label).toBe("project_update");
    expect(signals[0].confidence).toBeGreaterThanOrEqual(0.75);
  });
});

describe("extractScopeRisk", () => {
  it("detects a scope risk when a conditional threatens the release", () => {
    const sentences = ["If we don't fix auth, we'll pull mobile from release."];
    const signals = extractScopeRisk(sentences);

    expect(signals).toHaveLength(1);
    expect(signals[0].label).toBe("risk");
    expect(signals[0].confidence).toBeGreaterThanOrEqual(0.7);
  });
});

describe("extractBug", () => {
  it("detects a bug when trial failure and latency are mentioned", () => {
    const sentences = ["The trial is failing due to latency."];
    const signals = extractBug(sentences);

    expect(signals).toHaveLength(1);
    expect(signals[0].label).toBe("bug");
    expect(signals[0].confidence).toBeGreaterThanOrEqual(0.7);
  });
});
