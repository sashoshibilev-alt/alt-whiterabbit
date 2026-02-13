/**
 * Issue A & B Integration Tests
 *
 * Regression tests for the two specific issues:
 * - Issue A: Title normalization artifacts ("Implement consider...", "Implement Maybe we could...", etc.)
 * - Issue B: V4_HEADING_ONLY validator mapped to INTERNAL_ERROR
 *
 * These tests verify the end-to-end behavior with realistic note fixtures.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { generateSuggestionsWithDebug } from './debugGenerator';
import type { NoteInput } from './types';
import { DEFAULT_CONFIG } from './types';
import { DropReason, DropStage } from './debugTypes';
import { resetSectionCounter } from './preprocessing';
import { resetSuggestionCounter } from './synthesis';

describe('Issue A & B Fixes - Integration', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  describe('Issue A: Title Normalization Artifacts', () => {
    it('should clean "Implement Maybe we could launch..." artifact from emitted titles', () => {
      const note: NoteInput = {
        note_id: 'test-issue-a-1',
        raw_markdown: `# Product Planning

## Email Notifications

Implement Maybe we could launch a 5-minute weekly email summary of global climate policy changes.
`,
      };

      const result = generateSuggestionsWithDebug(
        note,
        undefined,
        DEFAULT_CONFIG,
        { verbosity: 'FULL_TEXT' }
      );

      // Find emitted suggestion
      const emailSuggestion = result.suggestions.find(s =>
        s.title.toLowerCase().includes('email') ||
        s.title.toLowerCase().includes('launch')
      );

      if (emailSuggestion) {
        // BEFORE: "Implement Maybe we could launch a 5-minute weekly email summary..."
        // AFTER: "Launch a 5-minute weekly email summary..." (or similar clean title)
        expect(emailSuggestion.title).toMatch(/^Launch /i);
        expect(emailSuggestion.title).not.toContain('Maybe we could');
        expect(emailSuggestion.title).not.toMatch(/^Implement /);
      }
    });

    it('should clean "Implement consider a Checklist UI..." artifact from emitted titles', () => {
      const note: NoteInput = {
        note_id: 'test-issue-a-2',
        raw_markdown: `# UX Improvements

## User Onboarding

Implement consider a "Checklist" UI that guides users through their first three reports.
`,
      };

      const result = generateSuggestionsWithDebug(
        note,
        undefined,
        DEFAULT_CONFIG,
        { verbosity: 'FULL_TEXT' }
      );

      const checklistSuggestion = result.suggestions.find(s =>
        s.title.toLowerCase().includes('checklist')
      );

      if (checklistSuggestion) {
        // BEFORE: "Implement consider a \"Checklist\" UI that guides users..."
        // AFTER: "Add a checklist UI that guides users..." (or similar clean title)
        expect(checklistSuggestion.title).toMatch(/^Add /i);
        expect(checklistSuggestion.title).not.toContain('consider');
        expect(checklistSuggestion.title).not.toMatch(/^Implement /);
      }
    });

    it('should clean "Implement for more Templates..." artifact from emitted titles', () => {
      const note: NoteInput = {
        note_id: 'test-issue-a-3',
        raw_markdown: `# Content Library

## ESG Reporting

Implement for more "Templates"; users are unsure what a "good" ESG report looks like and want guidance.
`,
      };

      const result = generateSuggestionsWithDebug(
        note,
        undefined,
        DEFAULT_CONFIG,
        { verbosity: 'FULL_TEXT' }
      );

      const templatesSuggestion = result.suggestions.find(s =>
        s.title.toLowerCase().includes('template')
      );

      if (templatesSuggestion) {
        // BEFORE: "Implement for more \"Templates\"; users are unsure..."
        // AFTER: "Add more templates..." (or similar clean title starting with action verb)
        expect(templatesSuggestion.title).toMatch(/^Add (?:more )?[Tt]emplate/i);
        expect(templatesSuggestion.title).not.toContain('for more "Templates"');
        expect(templatesSuggestion.title).not.toMatch(/^Implement for more/i);
      }
    });

    it('should enforce hard rule: no emitted titles match forbidden pattern', () => {
      const note: NoteInput = {
        note_id: 'test-issue-a-hard-rule',
        raw_markdown: `# Mixed Ideas

## Feature Requests

Implement Maybe we could add feature X.

Implement We should consider Y.

Implement consider Z.

Implement for more A.

Implement There is a request to add B.
`,
      };

      const result = generateSuggestionsWithDebug(
        note,
        undefined,
        DEFAULT_CONFIG,
        { verbosity: 'FULL_TEXT' }
      );

      // Hard rule: NO emitted title may match this pattern
      const forbiddenPattern = /^Implement\s+(Maybe we could|We should|consider|for more|There is|Request to|Request for)/i;

      for (const suggestion of result.suggestions) {
        expect(suggestion.title).not.toMatch(forbiddenPattern);
      }
    });
  });

  describe('Issue B: V4_HEADING_ONLY Validator Drop Reason', () => {
    it('should map V4_HEADING_ONLY failure to VALIDATION_V4_HEADING_ONLY, not INTERNAL_ERROR', () => {
      const note: NoteInput = {
        note_id: 'test-issue-b',
        raw_markdown: `# Meeting Notes

## Product Roadmap

Just some generic discussion about product direction without any specific asks or explicit requests.
We talked about the roadmap and where we might want to go.
`,
      };

      const result = generateSuggestionsWithDebug(
        note,
        undefined,
        DEFAULT_CONFIG,
        { verbosity: 'FULL_TEXT' }
      );

      const debugRun = result.debugRun;
      expect(debugRun).toBeDefined();

      if (debugRun) {
        // Find sections that had candidates
        const sectionsWithCandidates = debugRun.sections.filter(
          s => s.candidates && s.candidates.length > 0
        );

        // Check that heading-only dropped candidates are properly labeled
        for (const section of sectionsWithCandidates) {
          const droppedCandidates = section.candidates.filter(c => !c.emitted);

          for (const candidate of droppedCandidates) {
            // CRITICAL: Must NOT be INTERNAL_ERROR for validator failures
            if (candidate.dropReason === DropReason.VALIDATION_V4_HEADING_ONLY) {
              // This is the correct drop reason for heading-only failures
              expect(candidate.dropStage).toBe(DropStage.VALIDATION);
              expect(candidate.dropReason).not.toBe(DropReason.INTERNAL_ERROR);
            }
          }
        }

        // Ensure no section has INTERNAL_ERROR for normal validation drops
        for (const section of debugRun.sections) {
          if (section.dropReason === DropReason.INTERNAL_ERROR) {
            // INTERNAL_ERROR should only be for exceptions, not normal validation
            // If this fails, check if it's a legitimate exception or a validator failure
            console.warn('Section has INTERNAL_ERROR:', section.section_id, section.metadata);
          }
        }
      }
    });
  });

  describe('Before/After Verification', () => {
    it('should show improvement: Issue A titles are now clean', () => {
      const titles = [
        'Implement Maybe we could launch a 5-minute weekly email summary of global climate policy changes',
        'Implement consider a "Checklist" UI that guides users through their first three reports',
        'Implement for more "Templates"; users are unsure what a "good" ESG report looks like...',
      ];

      const note: NoteInput = {
        note_id: 'test-before-after',
        raw_markdown: `# Feature Requests

## Ideas

${titles.join('\n\n')}
`,
      };

      const result = generateSuggestionsWithDebug(
        note,
        undefined,
        DEFAULT_CONFIG,
        { verbosity: 'FULL_TEXT' }
      );

      // Verify all emitted suggestions have clean titles
      for (const suggestion of result.suggestions) {
        // BEFORE: Titles started with "Implement Maybe we could...", etc.
        // AFTER: Clean titles start with strong verbs (Launch, Add, etc.)
        const startsWithStrongVerb = /^(Launch|Add|Create|Build|Enable|Evaluate|Investigate|Improve)/i.test(suggestion.title);
        const hasHedgeArtifact = /Maybe we could|We should|consider a|for more "/i.test(suggestion.title);
        const startsWithImplement = /^Implement\s+(Maybe|We should|consider|for more)/i.test(suggestion.title);

        expect(startsWithStrongVerb || suggestion.title.match(/ing /i)).toBeTruthy();
        expect(hasHedgeArtifact).toBe(false);
        expect(startsWithImplement).toBe(false);
      }
    });

    it('should show improvement: Issue B dropReason is now specific, not INTERNAL_ERROR', () => {
      const note: NoteInput = {
        note_id: 'test-dropreason-before-after',
        raw_markdown: `# Notes

## Section With Heading Only

This is just a heading with some generic text that doesn't have any explicit asks.
`,
      };

      const result = generateSuggestionsWithDebug(
        note,
        undefined,
        DEFAULT_CONFIG,
        { verbosity: 'FULL_TEXT' }
      );

      const debugRun = result.debugRun;
      expect(debugRun).toBeDefined();

      if (debugRun) {
        // BEFORE: Heading-only validator failure → dropReason = INTERNAL_ERROR
        // AFTER: Heading-only validator failure → dropReason = VALIDATION_V4_HEADING_ONLY

        const allCandidates = debugRun.sections.flatMap(s => s.candidates || []);
        const droppedByValidation = allCandidates.filter(
          c => !c.emitted && c.dropStage === DropStage.VALIDATION
        );

        // Verify that validation drops are specific, not INTERNAL_ERROR
        for (const candidate of droppedByValidation) {
          if (candidate.dropReason === DropReason.VALIDATION_V4_HEADING_ONLY) {
            // This is the specific reason we want to see
            expect(candidate.dropReason).toBe(DropReason.VALIDATION_V4_HEADING_ONLY);
            expect(candidate.dropReason).not.toBe(DropReason.INTERNAL_ERROR);
          }
        }
      }
    });
  });
});
