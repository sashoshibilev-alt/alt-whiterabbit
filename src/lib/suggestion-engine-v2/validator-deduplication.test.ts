/**
 * Test for validator result deduplication
 *
 * Ensures that V3_EVIDENCE_SANITY and other validators
 * do not appear multiple times in validatorResults.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateSuggestionsWithDebug,
  NoteInput,
  DEFAULT_CONFIG,
  DebugGeneratorOptions,
} from './index';
import { resetSectionCounter } from './preprocessing';
import { resetSuggestionCounter } from './synthesis';

const DEBUG_OPTIONS: DebugGeneratorOptions = {
  verbosity: 'FULL',
};

describe('Validator deduplication', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it('should not have duplicate V3_EVIDENCE_SANITY in validatorResults', () => {
    const note: NoteInput = {
      note_id: 'test-validator-dedup',
      raw_markdown: `# Feature Requests

## Mobile App

Add offline mode for mobile to improve user experience in low-connectivity areas.
`,
    };

    const result = generateSuggestionsWithDebug(note, undefined, DEFAULT_CONFIG, DEBUG_OPTIONS);

    // Check all sections for validator results
    if (!result.debugRun) {
      throw new Error('Debug run not available');
    }
    for (const section of result.debugRun.sections) {
      if (!section.candidates || section.candidates.length === 0) continue;

      for (const candidate of section.candidates) {
        const validatorNames = candidate.validatorResults?.map((r) => r.name) || [];

        // Count occurrences of V3_EVIDENCE_SANITY
        const v3Count = validatorNames.filter(
          (name) => name === 'V3_EVIDENCE_SANITY'
        ).length;

        expect(v3Count).toBeLessThanOrEqual(1);

        // Also check for any duplicate entries
        const uniqueValidators = new Set(validatorNames);
        expect(validatorNames.length).toBe(uniqueValidators.size);
      }
    }
  });

  it('should have unique validators by (name, passed, reason)', () => {
    const note: NoteInput = {
      note_id: 'test-unique-validators',
      raw_markdown: `# Product Discussion

## Feature Ideas

We should consider adding templates for customer onboarding workflows.

Users need better audit logging for compliance tracking.
`,
    };

    const result = generateSuggestionsWithDebug(note, undefined, DEFAULT_CONFIG, DEBUG_OPTIONS);

    if (!result.debugRun) {
      throw new Error('Debug run not available');
    }
    for (const section of result.debugRun.sections) {
      if (!section.candidates || section.candidates.length === 0) continue;

      for (const candidate of section.candidates) {
        const validatorResults = candidate.validatorResults || [];

        // Build a set of unique keys
        const seen = new Set<string>();
        for (const vr of validatorResults) {
          const key = `${vr.name}|${vr.passed}|${vr.reason || ''}`;
          expect(seen.has(key)).toBe(false);
          seen.add(key);
        }
      }
    }
  });

  it('should preserve all distinct validators', () => {
    const note: NoteInput = {
      note_id: 'test-preserve-distinct',
      raw_markdown: `# Engineering Sync

## Backend Services

Add supplier segmentation filters to reduce query complexity.
`,
    };

    const result = generateSuggestionsWithDebug(note, undefined, DEFAULT_CONFIG, DEBUG_OPTIONS);

    if (!result.debugRun) {
      throw new Error('Debug run not available');
    }

    // Find a section with candidates
    const sectionWithCandidates = result.debugRun.sections.find(
      (s) => s.candidates && s.candidates.length > 0
    );

    if (sectionWithCandidates && sectionWithCandidates.candidates) {
      const candidate = sectionWithCandidates.candidates[0];
      const validatorNames = candidate.validatorResults?.map((r) => r.name) || [];

      // Should have V2 and V3 validators (and possibly V4)
      expect(validatorNames.length).toBeGreaterThan(0);

      // Each validator should appear at most once
      const nameCounts = new Map<string, number>();
      for (const name of validatorNames) {
        nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
      }

      for (const [name, count] of nameCounts.entries()) {
        expect(count).toBe(1);
      }
    }
  });
});
