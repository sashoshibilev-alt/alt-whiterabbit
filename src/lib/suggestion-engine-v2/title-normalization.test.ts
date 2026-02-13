import { describe, it, expect } from 'vitest';
import { normalizeSuggestionTitle } from './title-normalization';

describe('normalizeSuggestionTitle', () => {
  describe('leading marker removal', () => {
    it('should strip "Suggestion:" prefix', () => {
      const input = 'Suggestion: add automated regression tests';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Add automated regression tests');
    });

    it('should strip "Maybe we could" prefix', () => {
      const input = 'Maybe we could add a keyboard shortcut system';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Add a keyboard shortcut system');
    });

    it('should strip "Consider" prefix', () => {
      const input = 'Consider adding dark mode to the app';
      const result = normalizeSuggestionTitle(input);
      // "Adding" is a gerund (valid verb form), keep it
      expect(result).toBe('Adding dark mode to the app');
    });

    it('should strip "We should consider" prefix', () => {
      const input = 'We should consider implementing retry logic';
      const result = normalizeSuggestionTitle(input);
      // "Implementing" is a gerund (valid verb form), keep it
      expect(result).toBe('Implementing retry logic');
    });

    it('should strip "Request for" prefix', () => {
      const input = 'Request for more templates for common workflows';
      const result = normalizeSuggestionTitle(input);
      // After stripping "Request for", "more templates..." gets mapped to "Add more templates..."
      expect(result).toBe('Add more templates for common workflows');
    });

    it('should strip "It would be good to" prefix', () => {
      const input = 'It would be good to add caching layer';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Add caching layer');
    });
  });

  describe('post-verb filler removal', () => {
    it('should remove "maybe we could" after verb', () => {
      const input = 'Implement maybe we could add retry logic';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Implement add retry logic');
    });

    it('should remove "consider" after verb', () => {
      const input = 'Implement consider adding templates';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Implement adding templates');
    });

    it('should remove multiple filler phrases', () => {
      const input = 'Add maybe we could consider implementing feature X';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Add implementing feature X');
    });
  });

  describe('weak verb mapping', () => {
    it('should map "Explore" to "Investigate" for concrete objects', () => {
      const input = 'Explore the new caching strategy';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Investigate the new caching strategy');
    });

    it('should map "Research" to "Investigate"', () => {
      const input = 'Research database sharding options';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Investigate database sharding options');
    });

    it('should NOT map "Explore whether" (pure research)', () => {
      const input = 'Explore whether users want dark mode';
      const result = normalizeSuggestionTitle(input);
      // Should keep "Explore" for abstract questions
      expect(result).toBe('Explore whether users want dark mode');
    });

    it('should map "look into" to "investigate"', () => {
      const input = 'Look into performance bottlenecks';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Investigate performance bottlenecks');
    });
  });

  describe('trailing deadline removal', () => {
    it('should remove "by end of March"', () => {
      const input = 'Launch new feature by end of March';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Launch new feature');
    });

    it('should remove "in Q3"', () => {
      const input = 'Implement caching in Q3';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Implement caching');
    });

    it('should remove "by Q2"', () => {
      const input = 'Deploy to production by Q2';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Deploy to production');
    });

    it('should remove "before March 15"', () => {
      const input = 'Add templates before March 15';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Add templates');
    });
  });

  describe('strong verb inference', () => {
    it('should add "Add" to noun phrases with "system"', () => {
      const input = 'keyboard shortcut system';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Add keyboard shortcut system');
    });

    it('should add "Add" to noun phrases with "tool"', () => {
      const input = 'supplier engagement tools';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Add supplier engagement tools');
    });

    it('should add "Add" to "automated X" patterns', () => {
      const input = 'automated regression tests';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Add automated regression tests');
    });

    it('should add "Add" to "new X" patterns', () => {
      const input = 'new dashboard component';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Add dashboard component');
    });

    it('should map "better X" to "Improve X"', () => {
      const input = 'better error messages';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Improve error messages');
    });

    it('should map "improved X" to "Improve X"', () => {
      const input = 'improved search functionality';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Improve search functionality');
    });
  });

  describe('real-world examples from requirements', () => {
    it('should transform "Maybe we could..." into clean title', () => {
      const input = 'Maybe we could add a keyboard shortcut system so power users can navigate faster';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Add a keyboard shortcut system so power users can navigate faster');
    });

    it('should transform "Suggestion: Maybe we could..." into clean title', () => {
      const input = 'Suggestion: Maybe we could use a schema mapper UI to visualize data transformations';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Add a schema mapper UI to visualize data transformations');
    });

    it('should transform "Request for..." into clean title', () => {
      const input = 'Request for more templates for common workflows';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Add more templates for common workflows');
    });

    it('should transform "Explore..." to "Investigate..." for concrete objects', () => {
      const input = 'Explore what settings users need';
      const result = normalizeSuggestionTitle(input);
      // "what" is abstract, so keep Explore
      expect(result).toBe('Explore what settings users need');
    });

    it('should transform "Consider..." into clean title', () => {
      const input = 'Consider adding dark mode to the app';
      const result = normalizeSuggestionTitle(input);
      // "Adding" is a gerund, keep it
      expect(result).toBe('Adding dark mode to the app');
    });

    it('should clean "Implement maybe we could..." artifact', () => {
      const input = 'Implement maybe we could add checklist UI';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Implement add checklist UI');
    });

    it('should clean "Implement consider..." artifact', () => {
      const input = 'Implement consider adding templates';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Implement adding templates');
    });
  });

  describe('edge cases', () => {
    it('should handle empty string', () => {
      const input = '';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('');
    });

    it('should handle whitespace-only string', () => {
      const input = '   ';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('');
    });

    it('should preserve titles that already start with strong verbs', () => {
      const input = 'Launch new user onboarding flow';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Launch new user onboarding flow');
    });

    it('should preserve "Add" verb', () => {
      const input = 'Add templates for common workflows';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Add templates for common workflows');
    });

    it('should preserve "Create" verb', () => {
      const input = 'Create certified user badge';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Create certified user badge');
    });

    it('should capitalize first letter', () => {
      const input = 'add new feature';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Add new feature');
    });
  });

  describe('determinism', () => {
    it('should produce identical results for same input', () => {
      const input = 'Maybe we could add keyboard shortcuts';
      const result1 = normalizeSuggestionTitle(input);
      const result2 = normalizeSuggestionTitle(input);
      expect(result1).toBe(result2);
    });

    it('should handle multiple calls with different inputs', () => {
      const inputs = [
        'Suggestion: add feature X',
        'Maybe we could implement Y',
        'Consider building Z',
      ];
      const results = inputs.map(normalizeSuggestionTitle);
      expect(results).toEqual([
        'Add feature X',
        'Implement Y',
        'Building Z',  // "Building" is a gerund, valid verb form
      ]);
    });
  });
});
