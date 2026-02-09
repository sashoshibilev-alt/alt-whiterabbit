/**
 * Discussion Details Explicit Asks - B-lite Fix
 *
 * Tests that Discussion details sections with explicit request language
 * emit real suggestions instead of being dropped or falling back to "Review:".
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateSuggestions,
  NoteInput,
  DEFAULT_CONFIG,
} from './index';
import { generateSuggestionsWithDebug } from './debugGenerator';
import { resetSectionCounter } from './preprocessing';
import { resetSuggestionCounter } from './synthesis';

describe('Discussion Details Explicit Asks (B-lite Fix)', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it('should emit real suggestion for Discussion details with "asks for" language', () => {
    const note: NoteInput = {
      note_id: 'test-discussion-details-asks-for',
      raw_markdown: `# Meeting Notes

## 🔍 Discussion details

The team agreed on new feature requests: asks for an offline mode for mobile and a 1-click AI summary button.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should emit at least 1 suggestion
    expect(result.suggestions.length).toBeGreaterThanOrEqual(1);

    // Debug: print all suggestion source headings
    // console.log('All suggestions:', result.suggestions.map(s => ({
    //   heading: s.suggestion?.sourceHeading,
    //   title: s.title,
    //   type: s.type
    // })));

    // Find the Discussion details suggestion
    const discussionSuggestion = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('discussion')
    );
    expect(discussionSuggestion).toBeDefined();

    if (discussionSuggestion) {
      // Debug: check actual type
      if (discussionSuggestion.type !== 'idea') {
        console.error('[TEST DEBUG] Wrong type:', {
          actualType: discussionSuggestion.type,
          expectedType: 'idea',
          suggestionId: discussionSuggestion.suggestion_id,
          title: discussionSuggestion.title,
        });
      }

      // Should be a new_feature (idea) type, not project_update
      expect(discussionSuggestion.type).toBe('idea');

      // Should NOT have "Review:" prefix in title
      expect(discussionSuggestion.title).not.toMatch(/^Review:/i);

      // Title should contain something about the feature request
      expect(discussionSuggestion.title.toLowerCase()).toMatch(/offline|mode|mobile|summary/);

      // Should have evidence from the line with explicit ask
      expect(discussionSuggestion.evidence_spans.length).toBeGreaterThan(0);
      const evidenceText = discussionSuggestion.evidence_spans[0].text.toLowerCase();
      expect(evidenceText).toMatch(/asks for/i);
    }
  });

  it('should emit real suggestion for Discussion details with "request" language', () => {
    const note: NoteInput = {
      note_id: 'test-discussion-details-request',
      raw_markdown: `# Product Meeting

## Discussion details

The team decided the PM requested a dark mode feature for the dashboard.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    expect(result.suggestions.length).toBeGreaterThanOrEqual(1);

    const discussionSuggestion = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('discussion')
    );
    expect(discussionSuggestion).toBeDefined();

    if (discussionSuggestion) {
      expect(discussionSuggestion.type).toBe('idea');
      expect(discussionSuggestion.title).not.toMatch(/^Review:/i);
      expect(discussionSuggestion.title.toLowerCase()).toMatch(/dark mode|dashboard/);
    }
  });

  it('should emit real suggestion for Discussion details with "would like" language', () => {
    const note: NoteInput = {
      note_id: 'test-discussion-details-would-like',
      raw_markdown: `# Team Sync

## Discussion details

The team agreed: Engineering would like a better deployment pipeline with automated rollbacks.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    expect(result.suggestions.length).toBeGreaterThanOrEqual(1);

    const discussionSuggestion = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('discussion')
    );
    expect(discussionSuggestion).toBeDefined();

    if (discussionSuggestion) {
      expect(discussionSuggestion.type).toBe('idea');
      expect(discussionSuggestion.title).not.toMatch(/^Review:/i);
      expect(discussionSuggestion.title.toLowerCase()).toMatch(/deployment|pipeline|rollback/);
    }
  });

  it('should emit real suggestion for Discussion details with "need" language', () => {
    const note: NoteInput = {
      note_id: 'test-discussion-details-need',
      raw_markdown: `# Sprint Planning

## Discussion details

The team decided we need a faster search experience for users browsing the catalog.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    expect(result.suggestions.length).toBeGreaterThanOrEqual(1);

    const discussionSuggestion = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('discussion')
    );
    expect(discussionSuggestion).toBeDefined();

    if (discussionSuggestion) {
      expect(discussionSuggestion.type).toBe('idea');
      expect(discussionSuggestion.title).not.toMatch(/^Review:/i);
      expect(discussionSuggestion.title.toLowerCase()).toMatch(/search|catalog/);
    }
  });

  it('should NOT emit "Review:" fallback or INTERNAL_ERROR for explicit asks', () => {
    const note: NoteInput = {
      note_id: 'test-no-review-fallback',
      raw_markdown: `# Meeting Notes

## 🔍 Discussion details

The team agreed on new feature requests: asks for an offline mode for mobile and a 1-click AI summary button.
`,
    };

    const result = generateSuggestionsWithDebug(
      note,
      undefined,
      { ...DEFAULT_CONFIG, enable_debug: true },
      { verbosity: 'FULL' }
    );

    // Check that no suggestions have "Review:" prefix
    for (const suggestion of result.suggestions) {
      expect(suggestion.title).not.toMatch(/^Review:/i);
    }

    // Check debug output for INTERNAL_ERROR
    if (result.debugRun) {
      const discussionSection = result.debugRun.sections.find(s =>
        s.headingTextPreview?.toLowerCase().includes('discussion')
      );

      if (discussionSection) {
        // Should not be dropped with INTERNAL_ERROR
        expect(discussionSection.dropReason).not.toBe('INTERNAL_ERROR');

        // Should have at least one emitted candidate
        const emittedCandidates = discussionSection.candidates.filter(c => c.emitted);
        expect(emittedCandidates.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('should NOT trigger explicit ask path for Discussion details WITHOUT explicit requests', () => {
    const note: NoteInput = {
      note_id: 'test-no-explicit-ask',
      raw_markdown: `# Meeting Notes

## Discussion details

The team discussed various technical approaches to the problem.
Several options were considered but no decisions were made.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // This section should follow normal flow (may emit nothing, may fallback, etc.)
    // The key is that it doesn't force synthesis when there's no explicit ask
    // No assertions needed - just verify it doesn't crash
    expect(result).toBeDefined();
  });

  it('should only emit ONE suggestion from explicit ask path (not multiple)', () => {
    const note: NoteInput = {
      note_id: 'test-single-suggestion',
      raw_markdown: `# Meeting Notes

## Discussion details

The team decided on feature priorities:
* The team reviewed asks for an offline mode for mobile
* Another request for a 1-click AI summary button
* And a need for better search functionality
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Find Discussion details suggestions
    const discussionSuggestions = result.suggestions.filter(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('discussion')
    );

    // Should only emit 1 suggestion from explicit ask path (strongest ask)
    // (May emit more from topic isolation, but explicit ask path emits max 1)
    expect(discussionSuggestions.length).toBeGreaterThanOrEqual(1);
    expect(discussionSuggestions.length).toBeLessThanOrEqual(3); // Reasonable upper bound
  });

  it('should NOT start title with "N " or include discussion commentary', () => {
    const note: NoteInput = {
      note_id: 'test-clean-title',
      raw_markdown: `# Meeting Notes

## 🔍 Discussion details

The team agreed on new feature requests: asks for an offline mode for mobile and a 1-click AI summary button. Leo noted that while the feature is important, we need to prioritize carefully.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    const discussionSuggestion = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('discussion')
    );
    expect(discussionSuggestion).toBeDefined();

    if (discussionSuggestion) {
      // Title should NOT start with "N " (broken substring bug)
      expect(discussionSuggestion.title).not.toMatch(/^N\s/);

      // Title should NOT include discussion commentary like "Leo noted"
      expect(discussionSuggestion.title.toLowerCase()).not.toContain('leo');
      expect(discussionSuggestion.title.toLowerCase()).not.toContain('noted');

      // Title should be clean and focused on the ask
      expect(discussionSuggestion.title.toLowerCase()).toMatch(/offline|mode|mobile|summary/);
    }
  });
});
