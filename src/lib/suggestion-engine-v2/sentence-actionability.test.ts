/**
 * Sentence-Level Actionability Regression Test
 *
 * Tests that imperative actions are correctly detected when they appear
 * mid-line after sentence boundaries (periods, exclamation marks, etc.).
 *
 * REGRESSION: Previously, the text "Users don't notice failures unless they dig
 * into logs. Add inline alert." would be dropped with actionableSignal = 0 because
 * "Add" was not at line start. After the fix, sentence-level evaluation ensures
 * that "Add inline alert." is scored as a separate fragment.
 *
 * Key assertions:
 * 1. Sentence splitting yields a fragment starting with "Add"
 * 2. hasExplicitImperativeAction(section) === true
 * 3. section.isActionable === true
 * 4. Candidate is NOT dropped at ACTIONABILITY stage
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
// Regression Input
// ============================================

/**
 * This exact note exposed the bug where imperatives mid-line were missed.
 * The body line contains two sentences:
 * 1. "Users don't notice failures unless they dig into logs."
 * 2. "Add inline alert."
 *
 * Before fix: actionableSignal = 0 (imperative not at line start)
 * After fix: actionableSignal >= 0.9 (imperative detected via sentence splitting)
 */
const REGRESSION_NOTE: NoteInput = {
  note_id: 'sentence-actionability-regression',
  raw_markdown: `# Dashboard Issues

## Dashboard errors

Users don't notice failures unless they dig into logs. Add inline alert.`,
};

// ============================================
// Test Suite
// ============================================

describe('Sentence-Level Actionability', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it('should detect imperative action in mid-line sentence', () => {
    // Run the full engine pipeline with debug output
    const result = generateSuggestionsWithDebug(
      REGRESSION_NOTE,
      undefined,
      {
        enable_debug: true,
        thresholds: DEFAULT_THRESHOLDS,
      },
      { verbosity: 'REDACTED' }
    );

    // Verify debug info is present
    expect(result.debugRun).toBeDefined();
    const debugRun = result.debugRun!;

    // Find the "Dashboard errors" section (should be the only section)
    expect(debugRun.sections.length).toBeGreaterThanOrEqual(1);
    const section = debugRun.sections[0];
    expect(section).toBeDefined();

    // ========================================
    // Core Regression Assertions
    // ========================================

    // 1. Section must be classified as actionable
    expect(section!.decisions.isActionable).toBe(true);

    // 2. Section must have actionableSignal >= 0.9 (imperative floor triggered)
    // The imperative verb "Add" at sentence start should trigger +0.9
    expect(section.actionabilitySignals?.actionableSignal).toBeGreaterThanOrEqual(0.9);

    // 3. Section must NOT be dropped at ACTIONABILITY stage
    if (section!.dropStage !== null) {
      expect(section!.dropStage).not.toBe('ACTIONABILITY');
    }

    // 4. Section must be emitted
    expect(section!.emitted).toBe(true);

    // 5. Section must have at least one emitted candidate
    const emittedCandidates = section!.candidates.filter((c) => c.emitted);
    expect(emittedCandidates.length).toBeGreaterThanOrEqual(1);

    // 6. Emitted candidate must reference "inline alert"
    const emittedCandidate = emittedCandidates[0];
    expect(emittedCandidate.suggestion).toBeDefined();
    expect(emittedCandidate.suggestion!.body.toLowerCase()).toContain('inline alert');

    // ========================================
    // Additional Validation
    // ========================================

    // Final result should include at least one suggestion
    expect(result.suggestions.length).toBeGreaterThanOrEqual(1);

    // At least one suggestion should reference the content
    const relevantSuggestions = result.suggestions.filter((s) =>
      s.suggestion?.body.toLowerCase().includes('inline alert')
    );
    expect(relevantSuggestions.length).toBeGreaterThanOrEqual(1);
  });

  it('should handle smart quotes in negation patterns', () => {
    // Test that smart quotes ("don't") and ASCII quotes ("don't") behave identically
    const noteWithSmartQuotes: NoteInput = {
      note_id: 'smart-quotes-test',
      raw_markdown: `# Test

## Smart Quote Negation

Users don't notice the issue. Add logging.`,
    };

    const result = generateSuggestionsWithDebug(
      noteWithSmartQuotes,
      undefined,
      {
        enable_debug: true,
        thresholds: DEFAULT_THRESHOLDS,
      },
      { verbosity: 'REDACTED' }
    );

    expect(result.debugRun).toBeDefined();
    const debugRun = result.debugRun!;

    const section = debugRun.sections[0];
    expect(section).toBeDefined();

    // Imperative "Add" should be detected regardless of smart quote in previous sentence
    expect(section.decisions.isActionable).toBe(true);
    expect(section.actionabilitySignals?.actionableSignal).toBeGreaterThanOrEqual(0.9);
  });

  it('should preserve max score behavior across sentences', () => {
    // Test that when multiple sentences exist, we take the max score
    const noteWithMultipleSentences: NoteInput = {
      note_id: 'multi-sentence-test',
      raw_markdown: `# Test

## Multiple Sentences

This is context. Add feature A. Also consider feature B. Update the docs.`,
    };

    const result = generateSuggestionsWithDebug(
      noteWithMultipleSentences,
      undefined,
      {
        enable_debug: true,
        thresholds: DEFAULT_THRESHOLDS,
      },
      { verbosity: 'REDACTED' }
    );

    expect(result.debugRun).toBeDefined();
    const debugRun = result.debugRun!;

    const section = debugRun.sections[0];
    expect(section).toBeDefined();

    // Multiple imperatives ("Add", "Update") should result in high actionable signal
    expect(section.decisions.isActionable).toBe(true);
    expect(section.actionabilitySignals?.actionableSignal).toBeGreaterThanOrEqual(0.9);
  });

  it('should handle ellipsis as sentence boundary', () => {
    // Test that ellipsis (...) is treated as a sentence boundary
    const noteWithEllipsis: NoteInput = {
      note_id: 'ellipsis-test',
      raw_markdown: `# Test

## Ellipsis Boundary

We have some issues... Add monitoring to track them.`,
    };

    const result = generateSuggestionsWithDebug(
      noteWithEllipsis,
      undefined,
      {
        enable_debug: true,
        thresholds: DEFAULT_THRESHOLDS,
      },
      { verbosity: 'REDACTED' }
    );

    expect(result.debugRun).toBeDefined();
    const debugRun = result.debugRun!;

    const section = debugRun.sections[0];
    expect(section).toBeDefined();

    // Imperative "Add" after ellipsis should be detected
    expect(section.decisions.isActionable).toBe(true);
    expect(section.actionabilitySignals?.actionableSignal).toBeGreaterThanOrEqual(0.9);
  });
});
