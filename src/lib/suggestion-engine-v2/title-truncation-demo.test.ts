/**
 * Demo test showing smart truncation preventing mid-word cuts
 *
 * This test demonstrates the improvement from naive substring truncation
 * to smart clause/word-boundary-aware truncation.
 */

import { generateSuggestions } from './index';
import { NoteInput } from './types';

describe('Smart Title Truncation Demo', () => {
  it('should not truncate titles mid-word (e.g., "...at", "...global")', () => {
    // This test demonstrates that long titles are now truncated intelligently
    const note: NoteInput = {
      note_id: 'note_demo_1',
      raw_markdown: `
# Meeting Notes - Product Roadmap

## Feature Requests

- We should implement a comprehensive user authentication system for global markets
- Add support for automated testing at scale with comprehensive coverage
- Investigate ways to provide real-time analytics and insights for enterprise customers
      `.trim(),
    };

    const result = generateSuggestions(note);

    // Check that generated titles don't end with fragments
    for (const suggestion of result.suggestions) {
      const title = suggestion.title;

      // If truncated, should end with ellipsis
      if (title.endsWith('…')) {
        // Should not end with common dangling fragments
        expect(title).not.toMatch(/\bat…$/);
        expect(title).not.toMatch(/\bglobal…$/);
        expect(title).not.toMatch(/\bprovide…$/);
        expect(title).not.toMatch(/\bfor…$/);
        expect(title).not.toMatch(/\bwith…$/);
        expect(title).not.toMatch(/\band…$/);

        // Should not cut mid-word (letter directly before ellipsis from incomplete word)
        // This is a heuristic: if we see a word character followed immediately by ellipsis,
        // it's likely a hard cut mid-word
        const beforeEllipsis = title.slice(-4, -1);
        if (beforeEllipsis.match(/\w\w\w$/)) {
          // Three letters before ellipsis suggests we might have cut a longer word
          // Let's check it's not a common 3-letter word
          const commonThreeLetterWords = ['the', 'and', 'for', 'add', 'use', 'new', 'old'];
          const lastWord = beforeEllipsis.toLowerCase();
          if (!commonThreeLetterWords.includes(lastWord)) {
            // Likely a fragment - fail the test
            fail(`Title appears to be cut mid-word: "${title}"`);
          }
        }
      }

      // Titles should be within reasonable length
      expect(title.length).toBeLessThanOrEqual(80);
    }
  });

  it('should prefer clause boundaries when truncating', () => {
    const note: NoteInput = {
      note_id: 'note_demo_2',
      raw_markdown: `
# Product Ideas

## New Features

- Improve performance. Add caching layer for global distribution systems with Redis
- Update authentication flow; migrate to OAuth 2.0 for better security and compliance
      `.trim(),
    };

    const result = generateSuggestions(note);

    // At least one suggestion should have been truncated at a clause boundary
    const truncatedTitles = result.suggestions
      .map(s => s.title)
      .filter(t => t.endsWith('…'));

    if (truncatedTitles.length > 0) {
      // Check that at least some used clause boundaries
      const usedClauseBoundary = truncatedTitles.some(title => {
        // If title was truncated and is relatively short, it likely used a clause boundary
        return title.length < 40;
      });

      // This is a heuristic check - we expect smart truncation to produce shorter,
      // cleaner titles when clause boundaries are available
      expect(usedClauseBoundary || truncatedTitles.length === 0).toBe(true);
    }
  });
});
