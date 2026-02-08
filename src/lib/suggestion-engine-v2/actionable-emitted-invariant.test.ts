/**
 * Actionability-Emitted Invariant Test
 *
 * Permanent regression guard to prevent cases where:
 * - Debug output looks correct (is_actionable=true)
 * - But UI-facing suggestion is missing, dropped, or neutered
 *
 * INVARIANT: is_actionable === true MUST imply emitted === true
 *
 * This test uses a real-world scenario inspired by the original bug report:
 * A short note with an imperative action ("Add inline alert") that should
 * always result in an emitted suggestion, regardless of other scores.
 *
 * The test verifies:
 * 1. Section is classified as actionable (is_actionable=true)
 * 2. Section has intentLabel="new_workstream"
 * 3. Section has type="idea"
 * 4. Section produces at least one emitted candidate
 * 5. Emitted candidate has complete suggestion context (title, body, evidence)
 * 6. Body contains the expected imperative action text
 * 7. Overall score meets the minimum threshold
 * 8. Final result includes the suggestion
 *
 * Without the protection in scoring.ts (applyConfidenceBasedProcessing),
 * this test would fail because the section would be dropped at THRESHOLD stage.
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
// Real-World Regression Input
// ============================================

/**
 * This exact note input exposed a bug where:
 * - Section classified as is_actionable=true
 * - Section classified as intentLabel="new_workstream"
 * - Section classified as type="idea"
 * - But emitted=false due to threshold drop
 *
 * The fix ensures any section with is_actionable=true
 * is never dropped at THRESHOLD stage, regardless of scores.
 */
const REGRESSION_NOTE: NoteInput = {
  note_id: 'actionable-emitted-regression',
  raw_markdown: `# Dashboard Issues

## Error Visibility

Users don't notice failures unless they dig into logs.

Add inline alert banners for critical errors.`,
};

// ============================================
// Contract Test
// ============================================

describe('Actionability-Emitted Invariant', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it('should emit UI suggestion when section is actionable (regression guard)', () => {
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

    // Find the section (should be exactly one)
    expect(debugRun.sections.length).toBeGreaterThanOrEqual(1);
    const section = debugRun.sections[0];

    // ========================================
    // Core Contract Assertions
    // ========================================

    // 1. Section must be emitted
    expect(section.emitted).toBe(true);

    // 2. Section intent must be new_workstream
    expect(section.decisions.intentLabel).toBe('new_workstream');

    // 3. Section type must be idea
    expect(section.decisions.typeLabel).toBe('idea');

    // 4. Section must be actionable
    expect(section.decisions.isActionable).toBe(true);

    // 5. Section must have at least one candidate
    expect(section.candidates.length).toBeGreaterThanOrEqual(1);

    // 6. At least one candidate must be emitted
    const emittedCandidates = section.candidates.filter((c) => c.emitted);
    expect(emittedCandidates.length).toBeGreaterThanOrEqual(1);

    // 7. Emitted candidate must have suggestion context
    const emittedCandidate = emittedCandidates[0];
    expect(emittedCandidate.suggestion).toBeDefined();
    expect(emittedCandidate.suggestion!.title).toBeDefined();
    expect(emittedCandidate.suggestion!.body).toBeDefined();
    expect(emittedCandidate.suggestion!.body.toLowerCase()).toContain('inline alert');
    expect(emittedCandidate.suggestion!.sourceSectionId).toBeDefined();
    expect(emittedCandidate.suggestion!.sourceHeading).toBeDefined();

    // 8. Overall score must meet minimum threshold
    expect(emittedCandidate.scoreBreakdown.overallScore).toBeGreaterThanOrEqual(
      DEFAULT_THRESHOLDS.T_overall_min
    );

    // ========================================
    // Additional Assertions
    // ========================================

    // At least one suggestion should appear in the final result
    expect(result.suggestions.length).toBeGreaterThanOrEqual(1);

    // The suggestion should be type="idea"
    const ideaSuggestions = result.suggestions.filter((s) => s.type === 'idea');
    expect(ideaSuggestions.length).toBeGreaterThanOrEqual(1);

    // The suggestion should have the right content
    const suggestion = ideaSuggestions[0];
    expect(suggestion.suggestion).toBeDefined();
    expect(suggestion.suggestion!.body.toLowerCase()).toContain('inline alert');
  });

  it('should never drop actionable sections at THRESHOLD stage (invariant)', () => {
    // This tests the core invariant directly: is_actionable=true implies emitted=true
    const result = generateSuggestionsWithDebug(
      REGRESSION_NOTE,
      undefined,
      {
        enable_debug: true,
        thresholds: DEFAULT_THRESHOLDS,
      },
      { verbosity: 'REDACTED' }
    );

    expect(result.debugRun).toBeDefined();
    const debugRun = result.debugRun!;

    // Check all sections
    for (const section of debugRun.sections) {
      if (section.decisions.isActionable) {
        // INVARIANT: is_actionable === true MUST imply emitted === true
        expect(section.emitted).toBe(true);

        // Should not be dropped at THRESHOLD stage
        if (section.dropStage !== null) {
          expect(section.dropStage).not.toBe('THRESHOLD');
        }

        // Should have at least one emitted candidate
        const emittedCandidates = section.candidates.filter((c) => c.emitted);
        expect(emittedCandidates.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('should emit both high-confidence and low-confidence actionable suggestions', () => {
    // Actionable sections can be emitted as either high-confidence or needs_clarification
    // But they MUST be emitted
    const result = generateSuggestionsWithDebug(
      REGRESSION_NOTE,
      undefined,
      {
        enable_debug: true,
        thresholds: DEFAULT_THRESHOLDS,
      },
      { verbosity: 'REDACTED' }
    );

    expect(result.debugRun).toBeDefined();
    const debugRun = result.debugRun!;

    // Find actionable sections
    const actionableSections = debugRun.sections.filter(
      (s) => s.decisions.isActionable
    );

    expect(actionableSections.length).toBeGreaterThanOrEqual(1);

    for (const section of actionableSections) {
      // Must be emitted
      expect(section.emitted).toBe(true);

      // Must have at least one emitted candidate
      const emittedCandidates = section.candidates.filter((c) => c.emitted);
      expect(emittedCandidates.length).toBeGreaterThanOrEqual(1);

      // Each emitted candidate must have suggestion context
      for (const candidate of emittedCandidates) {
        expect(candidate.suggestion).toBeDefined();
        expect(candidate.suggestion!.title).toBeDefined();
        expect(candidate.suggestion!.body).toBeDefined();
      }
    }

    // Verify at least one suggestion in final result
    expect(result.suggestions.length).toBeGreaterThanOrEqual(1);

    // All suggestions should have suggestion context
    for (const suggestion of result.suggestions) {
      expect(suggestion.suggestion).toBeDefined();
      expect(suggestion.suggestion!.title).toBeDefined();
      expect(suggestion.suggestion!.body).toBeDefined();
    }
  });

  it('should emit idea suggestion for implicit feature request with pain + product context', () => {
    // Test the high-precision implicit feature request rule:
    // Pain signal ("dissatisfied", "too many clicks") + product context ("workflow", "usability")
    // should trigger actionable idea suggestion, even without explicit imperative
    const implicitFeatureRequestNote: NoteInput = {
      note_id: 'implicit-feature-request',
      raw_markdown: `# Customer Feedback
• CS shared that an enterprise customer is dissatisfied with the number of clicks required for employees to complete annual attestations.
• Issue is impacting usability and customer satisfaction.`,
    };

    const result = generateSuggestionsWithDebug(
      implicitFeatureRequestNote,
      undefined,
      {
        enable_debug: true,
        thresholds: DEFAULT_THRESHOLDS,
      },
      { verbosity: 'REDACTED' }
    );

    expect(result.debugRun).toBeDefined();
    const debugRun = result.debugRun!;

    // Find the Customer Feedback section
    expect(debugRun.sections.length).toBeGreaterThanOrEqual(1);
    const section = debugRun.sections.find(s =>
      s.heading?.toLowerCase().includes('customer feedback')
    ) || debugRun.sections[0];

    // Section must be actionable
    expect(section.decisions.isActionable).toBe(true);

    // Section must have intentLabel = new_workstream
    expect(section.decisions.intentLabel).toBe('new_workstream');

    // Section must have typeLabel = idea
    expect(section.decisions.typeLabel).toBe('idea');

    // Section must be emitted
    expect(section.emitted).toBe(true);

    // Must have at least one emitted candidate
    const emittedCandidates = section.candidates.filter(c => c.emitted);
    expect(emittedCandidates.length).toBeGreaterThanOrEqual(1);

    // Emitted candidate must have suggestion context
    const candidate = emittedCandidates[0];
    expect(candidate.suggestion).toBeDefined();
    expect(candidate.suggestion!.title).toBeDefined();
    expect(candidate.suggestion!.body).toBeDefined();

    // Evidence should include the complaint line(s), not the heading
    expect(candidate.suggestion!.evidencePreview).toBeDefined();
    const evidenceText = candidate.suggestion!.evidencePreview?.join(' ').toLowerCase() || '';
    expect(evidenceText).toContain('dissatisfied');
    expect(evidenceText).not.toContain('customer feedback');

    // Final result must include at least one idea suggestion
    expect(result.suggestions.length).toBeGreaterThanOrEqual(1);
    const ideaSuggestions = result.suggestions.filter(s => s.type === 'idea');
    expect(ideaSuggestions.length).toBeGreaterThanOrEqual(1);
  });

  it('should NOT emit suggestion for generic status line without pain or impact', () => {
    // Negative test: generic status update without pain/friction or product context
    // should NOT trigger implicit feature request rule
    const genericStatusNote: NoteInput = {
      note_id: 'generic-status',
      raw_markdown: `# Status Update
The team met with the customer last week to discuss the roadmap.`,
    };

    const result = generateSuggestionsWithDebug(
      genericStatusNote,
      undefined,
      {
        enable_debug: true,
        thresholds: DEFAULT_THRESHOLDS,
      },
      { verbosity: 'REDACTED' }
    );

    expect(result.debugRun).toBeDefined();
    const debugRun = result.debugRun!;

    // Section should NOT be actionable (no pain signal, no product context)
    if (debugRun.sections.length > 0) {
      const section = debugRun.sections[0];
      expect(section.decisions.isActionable).toBe(false);
      expect(section.emitted).toBe(false);
    }

    // No suggestions should be emitted
    expect(result.suggestions.length).toBe(0);
  });
});
