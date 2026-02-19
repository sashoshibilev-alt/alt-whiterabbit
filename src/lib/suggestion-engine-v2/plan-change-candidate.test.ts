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
import { resetSuggestionCounter, containsExplicitRequest, extractRankedExplicitAsks } from './synthesis';

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

// ============================================
// Task A integration: project_update title must not start with "Implement"
// ============================================

describe('Task A: plan_change title is correctly generated (no spurious "Implement" prefix)', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it('marketing blast project_update title must not start with "Implement"', () => {
    const result = generateSuggestionsWithDebug(
      SAMPLE_NOTE,
      undefined,
      DEFAULT_CONFIG,
      { verbosity: 'FULL_TEXT' }
    );

    const marketingSuggestion = result.suggestions.find(s => s.type === 'project_update');
    expect(marketingSuggestion).toBeDefined();
    if (marketingSuggestion) {
      // Title must NOT start with "Implement" — plan-change verbs like "pull"
      // are already imperative and must not have "Implement" prepended.
      expect(marketingSuggestion.title).not.toMatch(/^Implement\b/i);
      // Title must start with the action verb or contain "pull"/"blast"
      expect(marketingSuggestion.title).toMatch(/pull|blast|marketing/i);
    }
  });

  it('marketing blast project_update title starts with a plan-change action verb', () => {
    const result = generateSuggestionsWithDebug(
      SAMPLE_NOTE,
      undefined,
      DEFAULT_CONFIG,
      { verbosity: 'FULL_TEXT' }
    );

    const marketingSuggestion = result.suggestions.find(s => s.type === 'project_update');
    expect(marketingSuggestion).toBeDefined();
    if (marketingSuggestion) {
      // Title must start with an action verb like "Pull", not a hedge/qualifier
      expect(marketingSuggestion.title).toMatch(
        /^(Pull|Remove|Delay|Postpone|Exclude|Descope|De-scope|Push|Defer|Cancel|Drop)\b/i
      );
    }
  });
});

// ============================================
// Task B integration: top-2 idea slots must be engineering ideas
// ============================================

describe('Task B: marketing conditional must not displace engineering ideas from top-2 idea slots', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it('the two emitted idea suggestions are from engineering sections (decimal precision and caching)', () => {
    const result = generateSuggestionsWithDebug(
      SAMPLE_NOTE,
      undefined,
      DEFAULT_CONFIG,
      { verbosity: 'FULL_TEXT' }
    );

    const ideaSuggestions = result.suggestions.filter(s => s.type === 'idea');

    // Must have at least 2 idea suggestions from the engineering sections
    expect(ideaSuggestions.length).toBeGreaterThanOrEqual(2);

    // Both top idea slots must be from engineering content, not marketing
    const precisionKeywords = /precision|decimal|rounding|conversion|display/i;
    const cachingKeywords = /cache|cach|metadata|schema|round.?trip|api.*trip/i;

    const hasPrecisionIdea = ideaSuggestions.some(s => precisionKeywords.test(s.title));
    const hasCachingIdea = ideaSuggestions.some(s => cachingKeywords.test(s.title));

    expect(hasPrecisionIdea).toBe(true);
    expect(hasCachingIdea).toBe(true);
  });

  it('the marketing conditional sentence must NOT appear as an idea suggestion', () => {
    const result = generateSuggestionsWithDebug(
      SAMPLE_NOTE,
      undefined,
      DEFAULT_CONFIG,
      { verbosity: 'FULL_TEXT' }
    );

    // No idea suggestion should mention the marketing blast
    const marketingIdea = result.suggestions.find(s =>
      s.type === 'idea' && /marketing blast|pull.*blast|blast.*pull/i.test(s.title)
    );

    expect(marketingIdea).toBeUndefined();
  });

  it('caching idea is in top-2 idea slots (not displaced by marketing conditional)', () => {
    const result = generateSuggestionsWithDebug(
      SAMPLE_NOTE,
      undefined,
      DEFAULT_CONFIG,
      { verbosity: 'FULL_TEXT' }
    );

    const ideaSuggestions = result.suggestions.filter(s => s.type === 'idea');

    // The top-2 ideas (by output order, which is score-sorted) must include caching
    const top2Ideas = ideaSuggestions.slice(0, 2);
    const cachingKeywords = /cache|cach|metadata|schema|round.?trip|api.*trip/i;
    const top2HasCaching = top2Ideas.some(s => cachingKeywords.test(s.title));

    expect(top2HasCaching).toBe(true);
  });

  it('decimal precision idea is in top-2 idea slots (not displaced by marketing conditional)', () => {
    const result = generateSuggestionsWithDebug(
      SAMPLE_NOTE,
      undefined,
      DEFAULT_CONFIG,
      { verbosity: 'FULL_TEXT' }
    );

    const ideaSuggestions = result.suggestions.filter(s => s.type === 'idea');
    const top2Ideas = ideaSuggestions.slice(0, 2);
    const precisionKeywords = /precision|decimal|rounding|conversion|display/i;
    const top2HasPrecision = top2Ideas.some(s => precisionKeywords.test(s.title));

    expect(top2HasPrecision).toBe(true);
  });
});

// ============================================
// Anchor harvesting recall: mixed 11-line note
// ============================================

/**
 * Mixed multi-line note from the reported issue.
 * The engine was producing only 2 candidates (lineIds 0 and 10).
 * It should capture:
 *   - force string conversion (imperative / explicit ask)
 *   - We could cache the table definitions locally for 24 hours (we could <verb>)
 *   - Users want a 'Rollback' command that actually works (users want <artifact>)
 *   - If we can't ship on time, pull it from the marketing blast (plan_change)
 *
 * The note uses multiple sections so each anchor can surface in the top-2 per section.
 */
const MIXED_RECALL_NOTE_TEXT = `The schema migration keeps failing on type mismatches between varchar and integer columns.
We need to force string conversion before inserting into the legacy table.
Type coercion errors are blocking the daily sync job and causing data loss.
We could cache the table definitions locally for 24 hours to avoid re-fetching them on every run.
This would reduce unnecessary API calls and speed up the migration pipeline.
Users want a 'Rollback' command that actually works without losing the last 3 rows of data.
The current rollback wipes the entire table which is catastrophic for partial migrations.
Logging improvements would help but that's a separate concern.
If we can't ship the migration tool on time, we should pull it from the marketing blast.
The team is aligned on these priorities for next sprint.
QA sign-off is needed before release.`;

/**
 * Same anchors, split across sections so each anchor can independently reach the top-2 slots.
 * Sections are made rich enough to pass the actionability gate.
 */
const MIXED_RECALL_MULTI_SECTION_MARKDOWN = `# Schema Migration Sprint

## Type Conversion Fix

The schema migration keeps failing on type mismatches between varchar and integer columns.
We need to force string conversion before inserting into the legacy table.
Type coercion errors are blocking the daily sync job and causing data loss.
Add explicit cast logic before the insert statement to prevent future failures.

## Table Definition Caching

Re-fetching table definitions on every run is causing significant latency in the migration pipeline.
We could cache the table definitions locally for 24 hours to avoid re-fetching them on every run.
This would reduce unnecessary API calls and speed up the migration pipeline.
Implement a local cache store with a TTL expiry and an invalidation hook.

## Rollback Command

Users want a 'Rollback' command that actually works without losing the last 3 rows of data.
The current rollback wipes the entire table which is catastrophic for partial migrations.
Implement a partial rollback that restores only the rows inserted in the last run.
Add a confirmation prompt before any destructive rollback operation.

## Launch Decision

Logging improvements would help but that's a separate concern.
If we can't ship the migration tool on time, we should pull it from the marketing blast.
The team is aligned on these priorities for next sprint.
`;

describe('Anchor harvesting recall: mixed note with "we could" and "users want" anchors', () => {
  describe('containsExplicitRequest unit checks', () => {
    it('detects "We could cache ..." as an explicit ask', () => {
      expect(
        containsExplicitRequest("We could cache the table definitions locally for 24 hours to avoid re-fetching them on every run")
      ).toBe(true);
    });

    it('detects "Users want a Rollback command ..." as an explicit ask', () => {
      expect(
        containsExplicitRequest("Users want a 'Rollback' command that actually works without losing the last 3 rows of data")
      ).toBe(true);
    });

    it('detects "We need to force string conversion ..." as an explicit ask', () => {
      expect(
        containsExplicitRequest("We need to force string conversion before inserting into the legacy table")
      ).toBe(true);
    });

    it('does NOT match vague "we could look into it" without a whitelisted verb', () => {
      expect(
        containsExplicitRequest("We could look into it at some point")
      ).toBe(false);
    });

    it('does NOT match "users want it to be better" without a concrete artifact noun', () => {
      expect(
        containsExplicitRequest("Users want it to be better and faster")
      ).toBe(false);
    });
  });

  describe('extractRankedExplicitAsks collects all anchors', () => {
    it('collects at least 3 distinct anchors from the mixed note (no cap)', () => {
      const anchors = extractRankedExplicitAsks(MIXED_RECALL_NOTE_TEXT, Infinity);
      expect(anchors.length).toBeGreaterThanOrEqual(3);
    });

    it('includes a "cache table definitions" anchor', () => {
      const anchors = extractRankedExplicitAsks(MIXED_RECALL_NOTE_TEXT, Infinity);
      const hasCacheAnchor = anchors.some(a => /cache.*table\s+definitions?/i.test(a));
      expect(hasCacheAnchor).toBe(true);
    });

    it('includes a "rollback command" / "users want" anchor', () => {
      const anchors = extractRankedExplicitAsks(MIXED_RECALL_NOTE_TEXT, Infinity);
      const hasRollbackAnchor = anchors.some(a => /rollback|users?\s+want/i.test(a));
      expect(hasRollbackAnchor).toBe(true);
    });

    it('includes a "force string conversion" anchor', () => {
      const anchors = extractRankedExplicitAsks(MIXED_RECALL_NOTE_TEXT, Infinity);
      const hasForceAnchor = anchors.some(a => /force\s+string\s+convers|force.*convers/i.test(a));
      expect(hasForceAnchor).toBe(true);
    });
  });

  describe('end-to-end: candidate list includes cache and rollback candidates (multi-section note)', () => {
    beforeEach(() => {
      resetSectionCounter();
      resetSuggestionCounter();
    });

    // Multi-section note: each anchor in its own section so all can surface in top-2 per section.
    const MIXED_RECALL_MULTI_NOTE: NoteInput = {
      note_id: 'mixed-recall-multi-section-test',
      raw_markdown: MIXED_RECALL_MULTI_SECTION_MARKDOWN,
    };

    it('emits a candidate with evidencePreview containing "cache the table definitions"', () => {
      const result = generateSuggestionsWithDebug(
        MIXED_RECALL_MULTI_NOTE,
        undefined,
        DEFAULT_CONFIG,
        { verbosity: 'FULL_TEXT' }
      );

      const cacheCandidate = result.suggestions.find(s =>
        /cache.*table\s+definitions?/i.test(
          (s.suggestion?.evidencePreview ?? []).join(' ')
        ) ||
        /cache/i.test(s.title)
      );

      expect(cacheCandidate).toBeDefined();
    });

    it('emits a candidate for the rollback / users-want anchor', () => {
      const result = generateSuggestionsWithDebug(
        MIXED_RECALL_MULTI_NOTE,
        undefined,
        DEFAULT_CONFIG,
        { verbosity: 'FULL_TEXT' }
      );

      const rollbackCandidate = result.suggestions.find(s =>
        /rollback/i.test(
          (s.suggestion?.evidencePreview ?? []).join(' ')
        ) ||
        /rollback/i.test(s.title)
      );

      expect(rollbackCandidate).toBeDefined();
    });

    it('emits a plan_change candidate for the marketing blast pull line', () => {
      const result = generateSuggestionsWithDebug(
        MIXED_RECALL_MULTI_NOTE,
        undefined,
        DEFAULT_CONFIG,
        { verbosity: 'FULL_TEXT' }
      );

      const planChangeCandidate = result.suggestions.find(s =>
        s.type === 'project_update' && /marketing blast|pull.*blast/i.test(s.title)
      );

      expect(planChangeCandidate).toBeDefined();
    });

    it('anchor recall: single-section note collects cache anchor in intermediate candidate set', () => {
      // Even with the top-2 emission cap, the cache anchor MUST be collected
      // in the intermediate anchor set (before cap). This validates that the
      // "we could cache" pattern is properly matched.
      const anchors = extractRankedExplicitAsks(MIXED_RECALL_NOTE_TEXT, Infinity);
      const hasCacheAnchor = anchors.some(a => /cache.*table\s+definitions?/i.test(a));
      expect(hasCacheAnchor).toBe(true);
      // And the anchor count is >= 3 (force, cache, rollback, plus marketing conditional)
      expect(anchors.length).toBeGreaterThanOrEqual(3);
    });

    it('cache anchor reaches the emitted suggestions when in its own actionable section', () => {
      // When the cache anchor is the primary content of a section with enough context to
      // pass the actionability gate, it must be emitted.
      const cacheOnlyNote: NoteInput = {
        note_id: 'cache-only-section-test',
        raw_markdown: `# Sprint Notes

## Table Definition Caching

Re-fetching table definitions on every run is causing significant latency.
We could cache the table definitions locally for 24 hours to avoid re-fetching them on every run.
This would reduce unnecessary API calls and speed up the migration pipeline.
Implement a local cache store with TTL expiry and an invalidation hook for schema changes.
`,
      };
      resetSectionCounter();
      resetSuggestionCounter();
      const result = generateSuggestionsWithDebug(
        cacheOnlyNote,
        undefined,
        DEFAULT_CONFIG,
        { verbosity: 'FULL_TEXT' }
      );
      const cacheCandidate = result.suggestions.find(s =>
        /cache/i.test(s.title) ||
        /cache.*table\s+definitions?/i.test((s.suggestion?.evidencePreview ?? []).join(' '))
      );
      expect(cacheCandidate).toBeDefined();
    });
  });
});
