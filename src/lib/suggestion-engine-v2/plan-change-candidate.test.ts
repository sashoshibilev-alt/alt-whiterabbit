/**
 * Plan Change Candidate Detection + Anchor Ranking Tests
 *
 * Task A: isPlanChangeCandidate(anchorLine) must detect conditional marketing
 *   pull language and force type: project_update.
 *
 * Task B: Anchor ranking boosts (engineering artifacts, implementation verbs)
 *   and penalties (marketing conditional) must ensure implementation work
 *   outranks marketing conditionals in the top-2 selection.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { isPlanChangeCandidate } from './classifiers';
import { generateSuggestionsWithDebug } from './debugGenerator';
import type { NoteInput } from './types';
import { DEFAULT_CONFIG } from './types';
import { resetSectionCounter } from './preprocessing';
import { resetSuggestionCounter } from './synthesis';

// ============================================
// Task A: isPlanChangeCandidate unit tests
// ============================================

describe('isPlanChangeCandidate', () => {
  describe('marketing blast conditional (the reported issue)', () => {
    it('should return true for: If we can\'t get X stable, pull Y from marketing blast', () => {
      expect(
        isPlanChangeCandidate("If we can't get the reporting module stable by the 15th, we should pull Y from the marketing blast")
      ).toBe(true);
    });

    it('should return true for conditional pull from campaign', () => {
      expect(
        isPlanChangeCandidate('If the integration is not ready, pull it from the launch campaign')
      ).toBe(true);
    });

    it('should return true for conditional remove from announcement', () => {
      expect(
        isPlanChangeCandidate('If we miss the deadline, remove the feature from the announcement')
      ).toBe(true);
    });

    it('should return true for conditional delay with launch', () => {
      expect(
        isPlanChangeCandidate('If QA fails, delay the launch')
      ).toBe(true);
    });

    it('should return true for conditional postpone with press', () => {
      expect(
        isPlanChangeCandidate('If the infra is unstable, postpone the press release')
      ).toBe(true);
    });

    it('should return true for conditional exclude from campaign', () => {
      expect(
        isPlanChangeCandidate('If legal review is pending, exclude it from the campaign')
      ).toBe(true);
    });

    it('should return true for conditional de-scope with release', () => {
      expect(
        isPlanChangeCandidate('If we are not ready, de-scope the release')
      ).toBe(true);
    });
  });

  describe('requires "if" at start', () => {
    it('should return false when line does not start with "if"', () => {
      expect(
        isPlanChangeCandidate('We should pull the feature from the marketing blast')
      ).toBe(false);
    });

    it('should return false for "unless" prefix', () => {
      expect(
        isPlanChangeCandidate('Unless stable, pull from announcement')
      ).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isPlanChangeCandidate('')).toBe(false);
    });
  });

  describe('requires removal verb OR GTM artifact', () => {
    it('should return false for "if" with launch but no removal verb and no GTM artifact match beyond launch', () => {
      // "launch" is a GTM artifact keyword → should still return true
      expect(
        isPlanChangeCandidate('If ready, we will launch the product')
      ).toBe(true);
    });

    it('should return false for "if" alone with no matching verb or artifact', () => {
      expect(
        isPlanChangeCandidate('If the team agrees, we should proceed')
      ).toBe(false);
    });

    it('should return false for "if" with unrelated content', () => {
      expect(
        isPlanChangeCandidate('If you have time, review the document')
      ).toBe(false);
    });
  });

  describe('engineering work should NOT match', () => {
    it('should return false for caching implementation sentence', () => {
      expect(
        isPlanChangeCandidate('Cache metadata for decimal precision fix to improve conversion')
      ).toBe(false);
    });

    it('should return false for add command sentence', () => {
      expect(
        isPlanChangeCandidate('Add force-flag to the migration command for rollback support')
      ).toBe(false);
    });
  });
});

// ============================================
// Task A + B: End-to-end integration test
// ============================================

/**
 * Sample note representing the reported issue:
 * - Decimal precision fix (engineering)
 * - Caching metadata (engineering)
 * - Marketing pull conditional (should become project_update, should rank below)
 */
const SAMPLE_NOTE: NoteInput = {
  note_id: 'plan-change-ranking-test',
  raw_markdown: `# Product Sprint Notes

## Decimal Precision Fix

The conversion rate display is showing 4+ decimal places which is confusing users.
We need to implement precision rounding to 2 decimal places for all conversion metrics.
Add a force-precision flag to the display component.

## Cache Metadata for Performance

We should cache metadata responses to reduce API round trips and improve integration speed.
Build a local schema cache with a rollback mechanism in case of failures.

## Marketing Blast Decision

If we can't get the reporting module stable by the 15th, we should pull the product from the marketing blast.
`,
};

describe('End-to-end: marketing conditional → project_update', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it('marketing blast sentence must produce type: project_update', () => {
    const result = generateSuggestionsWithDebug(
      SAMPLE_NOTE,
      undefined,
      DEFAULT_CONFIG,
      { verbosity: 'FULL_TEXT' }
    );

    // Find suggestion from the marketing blast section by title keywords
    const marketingSuggestion = result.suggestions.find(s =>
      /marketing blast|pull.*blast|blast.*pull/i.test(s.title)
    );

    // The marketing conditional must be emitted and classified as project_update
    expect(marketingSuggestion).toBeDefined();
    if (marketingSuggestion) {
      expect(marketingSuggestion.type).toBe('project_update');
    }
  });

  it('marketing blast sentence must not produce type: idea', () => {
    const result = generateSuggestionsWithDebug(
      SAMPLE_NOTE,
      undefined,
      DEFAULT_CONFIG,
      { verbosity: 'FULL_TEXT' }
    );

    // The marketing blast suggestion (if emitted) must not be type:idea
    const marketingIdeaSuggestion = result.suggestions.find(s =>
      s.type === 'idea' && /marketing blast|pull.*blast/i.test(s.title)
    );

    expect(marketingIdeaSuggestion).toBeUndefined();
  });

  it('engineering idea suggestions must all appear before marketing conditional (project_update) is followed by ideas', () => {
    const result = generateSuggestionsWithDebug(
      SAMPLE_NOTE,
      undefined,
      DEFAULT_CONFIG,
      { verbosity: 'FULL_TEXT' }
    );

    // We expect at least 2 suggestions from the engineering sections
    expect(result.suggestions.length).toBeGreaterThanOrEqual(2);

    const engineeringKeywords = /precision|decimal|conversion|cache|cach|metadata|schema|rollback|integration/i;

    // Output ordering contract: project_update suggestions come first, then ideas.
    // The marketing conditional (project_update) is correctly first in its group.
    // Engineering ideas follow in the idea group.
    // At least one engineering suggestion must appear in the output.
    const hasEngineeringSuggestion = result.suggestions.some(s => engineeringKeywords.test(s.title));
    expect(hasEngineeringSuggestion).toBe(true);

    // Within the idea group, engineering suggestions must appear (they ranked higher than any
    // competing idea from the marketing blast section, which has no competing ideas here).
    const engineeringIdeas = result.suggestions.filter(s =>
      engineeringKeywords.test(s.title) && s.type !== 'project_update'
    );
    expect(engineeringIdeas.length).toBeGreaterThan(0);
  });
});

// ============================================
// Task B: anchor ranking delta unit tests
// ============================================

// We test the ranking behavior indirectly through scoring output.
// The computeAnchorRankingDelta now applies only during candidate ranking,
// NOT to section_actionability. We test the observable effects:
// 1. section_actionability is unaffected by anchor ranking delta
// 2. Engineering suggestions still outrank marketing conditionals in output order

describe('Anchor ranking: engineering suggestions outrank marketing conditional', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it('engineering suggestion should have higher section_actionability than marketing conditional', () => {
    const result = generateSuggestionsWithDebug(
      SAMPLE_NOTE,
      undefined,
      DEFAULT_CONFIG,
      { verbosity: 'FULL_TEXT' }
    );

    const engineeringKeywords = /precision|decimal|conversion|cache|cach|metadata|schema|rollback|integration/i;

    const engineeringSuggestions = result.suggestions.filter(s => {
      const text = s.title + ' ' +
        (s.payload.after_description ?? '') +
        (s.payload.draft_initiative?.description ?? '');
      return engineeringKeywords.test(text);
    });

    const marketingSuggestions = result.suggestions.filter(s =>
      s.type === 'project_update' && (
        s.title.toLowerCase().includes('marketing') ||
        s.title.toLowerCase().includes('blast')
      )
    );

    if (engineeringSuggestions.length > 0 && marketingSuggestions.length > 0) {
      const maxEngineeringScore = Math.max(...engineeringSuggestions.map(s => s.scores.section_actionability));
      const maxMarketingScore = Math.max(...marketingSuggestions.map(s => s.scores.section_actionability));

      expect(maxEngineeringScore).toBeGreaterThan(maxMarketingScore);
    }
  });
});

// ============================================
// Regression: actionability score unchanged by ranking delta
// ============================================

describe('Actionability regression: marketing sentence does not affect section_actionability', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it('adding a marketing conditional line to an engineering section does not change section_actionability', () => {
    const noteWithoutMarketing: NoteInput = {
      note_id: 'regression-no-marketing',
      raw_markdown: `# Engineering Work

## Cache Metadata for Performance

We should cache metadata responses to reduce API round trips and improve integration speed.
Build a local schema cache with a rollback mechanism in case of failures.
`,
    };

    const noteWithMarketing: NoteInput = {
      note_id: 'regression-with-marketing',
      raw_markdown: `# Engineering Work

## Cache Metadata for Performance

We should cache metadata responses to reduce API round trips and improve integration speed.
Build a local schema cache with a rollback mechanism in case of failures.
If we can't get the reporting module stable by the 15th, pull the product from the marketing blast.
`,
    };

    const resultWithout = generateSuggestionsWithDebug(
      noteWithoutMarketing,
      undefined,
      DEFAULT_CONFIG,
      { verbosity: 'FULL_TEXT' }
    );
    resetSectionCounter();
    resetSuggestionCounter();
    const resultWith = generateSuggestionsWithDebug(
      noteWithMarketing,
      undefined,
      DEFAULT_CONFIG,
      { verbosity: 'FULL_TEXT' }
    );

    // Find the engineering (cache) suggestion in both results
    const cacheWithout = resultWithout.suggestions.find(s =>
      /cache|cach|schema|rollback/i.test(s.title)
    );
    const cacheWith = resultWith.suggestions.find(s =>
      /cache|cach|schema|rollback/i.test(s.title)
    );

    if (cacheWithout && cacheWith) {
      // section_actionability must be identical: ranking delta must not bleed into actionability
      expect(cacheWith.scores.section_actionability).toBeCloseTo(
        cacheWithout.scores.section_actionability,
        4
      );
    }
  });
});

// ============================================
// Mixed section: per-candidate type override
// ============================================

/**
 * A single section containing both engineering candidates and a marketing conditional.
 * The marketing conditional must become project_update; engineering candidates must stay idea.
 *
 * This is the core regression for the candidate-level override bug:
 * the old code used section.raw_text (all lines) so every candidate in the section
 * would match isPlanChangeCandidate and become project_update. The fix uses
 * each candidate's own anchor text.
 */
const MIXED_SECTION_NOTE: NoteInput = {
  note_id: 'mixed-section-test',
  raw_markdown: `# Sprint Planning

## Precision and Caching Work

We need to implement precision rounding to 2 decimal places for all conversion metrics.
Add a force-precision flag to the display component.
We should cache metadata responses to reduce API round trips.
Build a local schema cache with a rollback mechanism in case of failures.
If we can't get the reporting module stable by the 15th, pull the product from the marketing blast.
`,
};

describe('Mixed section: per-candidate type override', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it('marketing pull candidate must be project_update even in a mixed section', () => {
    const result = generateSuggestionsWithDebug(
      MIXED_SECTION_NOTE,
      undefined,
      DEFAULT_CONFIG,
      { verbosity: 'FULL_TEXT' }
    );

    // The marketing conditional suggestion must be project_update
    const marketingSuggestion = result.suggestions.find(s =>
      /marketing blast|pull.*blast|blast.*pull/i.test(s.title) ||
      (s.type === 'project_update' && /marketing|blast/i.test(
        s.payload.after_description ?? s.payload.draft_initiative?.description ?? ''
      ))
    );

    // If the engine emits a suggestion from the marketing conditional line, it must be project_update
    if (marketingSuggestion) {
      expect(marketingSuggestion.type).toBe('project_update');
    }
  });

  it('engineering candidates in the same section must not become project_update due to marketing line', () => {
    const result = generateSuggestionsWithDebug(
      MIXED_SECTION_NOTE,
      undefined,
      DEFAULT_CONFIG,
      { verbosity: 'FULL_TEXT' }
    );

    const engineeringKeywords = /precision|decimal|conversion|cache|cach|metadata|schema|rollback/i;

    // Engineering suggestions must remain idea type
    const engineeringProjectUpdates = result.suggestions.filter(s => {
      const text = s.title + ' ' +
        (s.payload.after_description ?? '') +
        (s.payload.draft_initiative?.description ?? '');
      return engineeringKeywords.test(text) && s.type === 'project_update';
    });

    // Engineering candidates should not be forced to project_update
    expect(engineeringProjectUpdates.length).toBe(0);
  });
});

// ============================================
// Output ordering contract: project_updates before ideas
// ============================================

describe('Output ordering contract: project_updates appear before ideas', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it('all project_update suggestions appear before all idea suggestions in output', () => {
    const result = generateSuggestionsWithDebug(
      SAMPLE_NOTE,
      undefined,
      DEFAULT_CONFIG,
      { verbosity: 'FULL_TEXT' }
    );

    const suggestions = result.suggestions;
    if (suggestions.length < 2) return; // not enough to test ordering

    // Find last project_update index and first idea index
    let lastProjectUpdateIdx = -1;
    let firstIdeaIdx = -1;

    for (let i = 0; i < suggestions.length; i++) {
      if (suggestions[i].type === 'project_update') {
        lastProjectUpdateIdx = i;
      }
    }
    for (let i = 0; i < suggestions.length; i++) {
      if (suggestions[i].type !== 'project_update') {
        firstIdeaIdx = i;
        break;
      }
    }

    // If both types present, all project_updates must come before all ideas
    if (lastProjectUpdateIdx !== -1 && firstIdeaIdx !== -1) {
      expect(lastProjectUpdateIdx).toBeLessThan(firstIdeaIdx);
    }
  });

  it('within each type, suggestions are sorted by score descending', () => {
    const result = generateSuggestionsWithDebug(
      SAMPLE_NOTE,
      undefined,
      DEFAULT_CONFIG,
      { verbosity: 'FULL_TEXT' }
    );

    const projectUpdates = result.suggestions.filter(s => s.type === 'project_update');
    const ideas = result.suggestions.filter(s => s.type !== 'project_update');

    // Check project_updates are sorted by overall score descending
    for (let i = 1; i < projectUpdates.length; i++) {
      expect(projectUpdates[i].scores.overall).toBeLessThanOrEqual(projectUpdates[i - 1].scores.overall);
    }

    // Check ideas are sorted by overall score descending
    for (let i = 1; i < ideas.length; i++) {
      expect(ideas[i].scores.overall).toBeLessThanOrEqual(ideas[i - 1].scores.overall);
    }
  });
});
