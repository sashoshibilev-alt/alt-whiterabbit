/**
 * Unit tests for groupSuggestionsForDisplay (presentation.ts)
 *
 * Verifies:
 * - More than 5 per type → correctly capped
 * - Exactly 5 → no overflow
 * - Less than 5 → no truncation
 * - Correct remainingByType counts
 * - Stable deterministic sort (no mutation of input)
 */

import { describe, it, expect } from 'vitest';
import { groupSuggestionsForDisplay } from './presentation';
import type { Suggestion, SuggestionType } from './types';

// ============================================
// Test helpers
// ============================================

function makeSuggestion(
  id: string,
  type: SuggestionType,
  overall: number,
  label?: string
): Suggestion {
  return {
    suggestion_id: id,
    note_id: 'test-note',
    section_id: `${id}-section`,
    type,
    title: `Title ${id}`,
    payload:
      type === 'project_update'
        ? { after_description: `Desc ${id}` }
        : { draft_initiative: { title: `Title ${id}`, description: `Desc ${id}` } },
    evidence_spans: [],
    scores: {
      section_actionability: overall,
      type_choice_confidence: overall,
      synthesis_confidence: overall,
      overall,
    },
    routing: { create_new: true },
    suggestionKey: id,
    ...(label ? { metadata: { label } } : {}),
  };
}

// ============================================
// Tests
// ============================================

describe('groupSuggestionsForDisplay', () => {
  describe('capping behavior', () => {
    it('caps visible to maxPerType when count exceeds cap', () => {
      const suggestions: Suggestion[] = [
        makeSuggestion('i1', 'idea', 0.95),
        makeSuggestion('i2', 'idea', 0.90),
        makeSuggestion('i3', 'idea', 0.85),
        makeSuggestion('i4', 'idea', 0.80),
        makeSuggestion('i5', 'idea', 0.75),
        makeSuggestion('i6', 'idea', 0.70),
        makeSuggestion('i7', 'idea', 0.65),
      ];

      const { visible, remainingByType, buckets } = groupSuggestionsForDisplay(suggestions, {
        capPerType: 5,
      });

      // Only 5 shown
      expect(visible).toHaveLength(5);
      // 2 hidden
      expect(remainingByType.idea).toBe(2);
      expect(remainingByType.project_update).toBe(0);
      expect(remainingByType.risk).toBe(0);
      expect(remainingByType.bug).toBe(0);

      // bucket reports correct total
      const ideaBucket = buckets.find(b => b.key === 'idea')!;
      expect(ideaBucket.total).toBe(7);
      expect(ideaBucket.hiddenCount).toBe(2);
    });

    it('does not overflow when count equals cap (exactly 5)', () => {
      const suggestions: Suggestion[] = [
        makeSuggestion('u1', 'project_update', 0.95),
        makeSuggestion('u2', 'project_update', 0.90),
        makeSuggestion('u3', 'project_update', 0.85),
        makeSuggestion('u4', 'project_update', 0.80),
        makeSuggestion('u5', 'project_update', 0.75),
      ];

      const { visible, remainingByType } = groupSuggestionsForDisplay(suggestions, {
        capPerType: 5,
      });

      expect(visible).toHaveLength(5);
      expect(remainingByType.project_update).toBe(0);
    });

    it('does not truncate when count is less than cap', () => {
      const suggestions: Suggestion[] = [
        makeSuggestion('i1', 'idea', 0.9),
        makeSuggestion('i2', 'idea', 0.8),
        makeSuggestion('i3', 'idea', 0.7),
      ];

      const { visible, remainingByType } = groupSuggestionsForDisplay(suggestions, {
        capPerType: 5,
      });

      expect(visible).toHaveLength(3);
      expect(remainingByType.idea).toBe(0);
    });

    it('defaults capPerType to 5 when options omitted', () => {
      const suggestions: Suggestion[] = Array.from({ length: 8 }, (_, i) =>
        makeSuggestion(`i${i}`, 'idea', 0.9 - i * 0.05)
      );

      const { visible, remainingByType } = groupSuggestionsForDisplay(suggestions);

      expect(visible).toHaveLength(5);
      expect(remainingByType.idea).toBe(3);
    });
  });

  describe('remainingByType counts', () => {
    it('reports correct remaining counts across multiple types', () => {
      // 7 ideas (5 shown, 2 hidden), 3 risks (3 shown, 0 hidden)
      const suggestions: Suggestion[] = [
        ...Array.from({ length: 7 }, (_, i) => makeSuggestion(`i${i}`, 'idea', 0.9 - i * 0.05)),
        ...Array.from({ length: 3 }, (_, i) =>
          makeSuggestion(`r${i}`, 'project_update', 0.85 - i * 0.05, 'risk')
        ),
      ];

      const { remainingByType } = groupSuggestionsForDisplay(suggestions, { capPerType: 5 });

      expect(remainingByType.idea).toBe(2);
      expect(remainingByType.risk).toBe(0);
      expect(remainingByType.project_update).toBe(0);
      expect(remainingByType.bug).toBe(0);
    });

    it('reports remaining for bugs when count exceeds cap', () => {
      const suggestions: Suggestion[] = Array.from({ length: 8 }, (_, i) =>
        makeSuggestion(`b${i}`, 'idea', 0.9 - i * 0.05, 'bug')
      );

      const { remainingByType } = groupSuggestionsForDisplay(suggestions, { capPerType: 5 });

      expect(remainingByType.bug).toBe(3);
    });
  });

  describe('visible alias', () => {
    it('visible contains the same suggestions as flatShown', () => {
      const suggestions: Suggestion[] = [
        makeSuggestion('i1', 'idea', 0.9),
        makeSuggestion('u1', 'project_update', 0.85),
      ];

      const { visible, flatShown } = groupSuggestionsForDisplay(suggestions, { capPerType: 5 });

      expect(visible).toStrictEqual(flatShown);
    });
  });

  describe('determinism and immutability', () => {
    it('sorts within each type by score descending (stable)', () => {
      const suggestions: Suggestion[] = [
        makeSuggestion('i3', 'idea', 0.70),
        makeSuggestion('i1', 'idea', 0.95),
        makeSuggestion('i2', 'idea', 0.85),
      ];

      const { buckets } = groupSuggestionsForDisplay(suggestions, { capPerType: 5 });
      const shown = buckets.find(b => b.key === 'idea')!.shown;

      expect(shown[0].suggestion_id).toBe('i1');
      expect(shown[1].suggestion_id).toBe('i2');
      expect(shown[2].suggestion_id).toBe('i3');
    });

    it('does not mutate the input array', () => {
      const suggestions: Suggestion[] = [
        makeSuggestion('i3', 'idea', 0.70),
        makeSuggestion('i1', 'idea', 0.95),
      ];
      const originalOrder = suggestions.map(s => s.suggestion_id);

      groupSuggestionsForDisplay(suggestions, { capPerType: 5 });

      expect(suggestions.map(s => s.suggestion_id)).toEqual(originalOrder);
    });
  });

  describe('bucket ordering', () => {
    it('orders buckets: risk → project_update → idea → bug', () => {
      const suggestions: Suggestion[] = [
        makeSuggestion('i1', 'idea', 0.9),
        makeSuggestion('u1', 'project_update', 0.85),
        makeSuggestion('r1', 'project_update', 0.80, 'risk'),
        makeSuggestion('b1', 'idea', 0.75, 'bug'),
      ];

      const { buckets } = groupSuggestionsForDisplay(suggestions, { capPerType: 5 });

      expect(buckets.map(b => b.key)).toEqual(['risk', 'project_update', 'idea', 'bug']);
    });
  });
});
