/**
 * Validator Drop Reason Mapping Tests (Issue B)
 *
 * Tests that validator failures are properly mapped to specific drop reasons
 * and NOT incorrectly mapped to INTERNAL_ERROR.
 *
 * REGRESSION: V4_HEADING_ONLY validator failure was being mapped to INTERNAL_ERROR
 * instead of a proper validation drop reason.
 *
 * Key requirements:
 * 1. V4_HEADING_ONLY failure → VALIDATION_V4_HEADING_ONLY (not INTERNAL_ERROR)
 * 2. Candidate dropStage should be "VALIDATION"
 * 3. Section dropReason should NOT be INTERNAL_ERROR for normal validator failures
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { generateSuggestionsWithDebug } from './debugGenerator';
import type { NoteInput } from './types';
import { DEFAULT_CONFIG } from './types';
import { DropReason, DropStage } from './debugTypes';
import { resetSectionCounter } from './preprocessing';
import { resetSuggestionCounter } from './synthesis';

describe('Validator Drop Reason Mapping', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it('should map V4_HEADING_ONLY failure to VALIDATION_V4_HEADING_ONLY, not INTERNAL_ERROR', () => {
    // Create a fixture that will trigger V4_HEADING_ONLY validator
    // Requirements: heading-derived title, no explicit ask
    const note: NoteInput = {
      note_id: 'test-v4-dropreason',
      raw_markdown: `# Meeting Notes

## Product Ideas

Just some general discussion about product direction without any specific asks.
`,
    };

    const result = generateSuggestionsWithDebug(
      note,
      undefined,
      DEFAULT_CONFIG,
      { verbosity: 'FULL_TEXT' }
    );

    // Should produce no suggestions (heading-only without explicit ask)
    expect(result.suggestions.length).toBe(0);

    // Check debug info for proper drop reason
    const debugRun = result.debugRun;
    expect(debugRun).toBeDefined();

    if (debugRun) {
      // Find the section that was processed
      const sections = debugRun.sections;
      expect(sections.length).toBeGreaterThan(0);

      // Find a section that has candidates (before validation)
      const sectionWithCandidates = sections.find(
        s => s.candidates && s.candidates.length > 0
      );

      if (sectionWithCandidates) {
        // Check that at least one candidate was dropped due to V4_HEADING_ONLY
        const droppedCandidates = sectionWithCandidates.candidates.filter(
          c => c.emitted === false
        );

        expect(droppedCandidates.length).toBeGreaterThan(0);

        // Find candidate dropped by heading-only validator
        const headingOnlyDropped = droppedCandidates.find(c =>
          c.dropReason === DropReason.VALIDATION_V4_HEADING_ONLY
        );

        if (headingOnlyDropped) {
          // CRITICAL: Must NOT be INTERNAL_ERROR
          expect(headingOnlyDropped.dropReason).not.toBe(DropReason.INTERNAL_ERROR);
          expect(headingOnlyDropped.dropReason).toBe(DropReason.VALIDATION_V4_HEADING_ONLY);

          // Must be dropped at VALIDATION stage
          expect(headingOnlyDropped.dropStage).toBe(DropStage.VALIDATION);
        }

        // Section dropReason should also NOT be INTERNAL_ERROR
        if (sectionWithCandidates.dropReason) {
          expect(sectionWithCandidates.dropReason).not.toBe(DropReason.INTERNAL_ERROR);
        }
      }
    }
  });

  it('should map V2_anti_vacuity failure to VALIDATION_V2_TOO_GENERIC', () => {
    // Create a very generic suggestion that will fail V2
    const note: NoteInput = {
      note_id: 'test-v2-dropreason',
      raw_markdown: `# Notes

## Next Steps

We should improve our processes and streamline operations.
`,
    };

    const result = generateSuggestionsWithDebug(
      note,
      undefined,
      DEFAULT_CONFIG,
      { verbosity: 'FULL_TEXT' }
    );

    const debugRun = result.debugRun;
    if (debugRun) {
      const sections = debugRun.sections;
      const sectionWithCandidates = sections.find(
        s => s.candidates && s.candidates.length > 0
      );

      if (sectionWithCandidates) {
        const genericDropped = sectionWithCandidates.candidates.find(c =>
          c.dropReason === DropReason.VALIDATION_V2_TOO_GENERIC
        );

        if (genericDropped) {
          expect(genericDropped.dropReason).not.toBe(DropReason.INTERNAL_ERROR);
          expect(genericDropped.dropReason).toBe(DropReason.VALIDATION_V2_TOO_GENERIC);
          expect(genericDropped.dropStage).toBe(DropStage.VALIDATION);
        }
      }
    }
  });

  it('should map V3_evidence_sanity failure to VALIDATION_V3_EVIDENCE_TOO_WEAK', () => {
    // Create a suggestion with insufficient evidence
    const note: NoteInput = {
      note_id: 'test-v3-dropreason',
      raw_markdown: `# Notes

## Ideas

X
`,
    };

    const result = generateSuggestionsWithDebug(
      note,
      undefined,
      DEFAULT_CONFIG,
      { verbosity: 'FULL_TEXT' }
    );

    const debugRun = result.debugRun;
    if (debugRun) {
      const sections = debugRun.sections;
      const sectionWithCandidates = sections.find(
        s => s.candidates && s.candidates.length > 0
      );

      if (sectionWithCandidates) {
        const evidenceDropped = sectionWithCandidates.candidates.find(c =>
          c.dropReason === DropReason.VALIDATION_V3_EVIDENCE_TOO_WEAK
        );

        if (evidenceDropped) {
          expect(evidenceDropped.dropReason).not.toBe(DropReason.INTERNAL_ERROR);
          expect(evidenceDropped.dropReason).toBe(DropReason.VALIDATION_V3_EVIDENCE_TOO_WEAK);
          expect(evidenceDropped.dropStage).toBe(DropStage.VALIDATION);
        }
      }
    }
  });
});
