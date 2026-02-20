/**
 * B-Signal Actionability Rescue Test
 *
 * Tests that sections with low actionableSignal are rescued before being
 * dropped at ACTIONABILITY gate when a B-signal extractor fires with
 * confidence >= 0.65.
 *
 * Scenario: "Spoke with their CTO. They need bulk upload by Q3."
 * - actionableSignal is low (no explicit imperative, no plan_change)
 * - FEATURE_DEMAND signal fires on "They need bulk upload by Q3" (confidence 0.65)
 * - Section is rescued and marked actionable
 *
 * Do NOT modify sentence-actionability.test.ts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateSuggestionsWithDebug,
  NoteInput,
  DEFAULT_THRESHOLDS,
} from './index';
import { resetSectionCounter } from './preprocessing';
import { resetSuggestionCounter } from './synthesis';

// ============================================
// Rescue Input
// ============================================

/**
 * This note has low actionableSignal: no explicit imperative, no plan_change language.
 * Without rescue: dropped at ACTIONABILITY (actionableSignal < threshold).
 * With rescue: FEATURE_DEMAND fires on "They need bulk upload by Q3" (confidence 0.65),
 * boosting actionableSignal to 0.7 and marking the section actionable.
 */
const RESCUE_NOTE: NoteInput = {
  note_id: 'b-signal-rescue-test',
  raw_markdown: `# CTO Meeting Notes

## Bulk Upload Request

Spoke with their CTO. They need bulk upload by Q3.`,
};

// ============================================
// Test Suite
// ============================================

describe('B-Signal Actionability Rescue', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it('should rescue section via FEATURE_DEMAND b-signal before ACTIONABILITY drop', () => {
    const result = generateSuggestionsWithDebug(
      RESCUE_NOTE,
      undefined,
      {
        enable_debug: true,
        thresholds: DEFAULT_THRESHOLDS,
      },
      { verbosity: 'REDACTED' }
    );

    expect(result.debugRun).toBeDefined();
    const debugRun = result.debugRun!;

    // Find the "Bulk Upload Request" section
    expect(debugRun.sections.length).toBeGreaterThanOrEqual(1);
    const section = debugRun.sections.find(
      s => s.headingTextPreview.toLowerCase().includes('bulk upload')
    ) ?? debugRun.sections[0];
    expect(section).toBeDefined();

    // 1. Section must be actionable (rescued by B-signal)
    expect(section!.decisions.isActionable).toBe(true);

    // 2. Section must NOT be dropped at ACTIONABILITY stage
    expect(section!.dropStage).not.toBe('ACTIONABILITY');

    // 3. At least one candidate must be emitted
    const emittedCandidates = section!.candidates.filter(c => c.emitted);
    expect(emittedCandidates.length).toBeGreaterThanOrEqual(1);

    // 4. bSignalCount debug metric must be present and >= 1
    expect(section!.metadata?.bSignalCount).toBeGreaterThanOrEqual(1);

    // 5. Final result must include at least one suggestion
    expect(result.suggestions.length).toBeGreaterThanOrEqual(1);
  });
});
