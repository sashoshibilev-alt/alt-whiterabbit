/**
 * Test cases for specific title normalization requirements
 *
 * These tests verify the exact examples from the user's requirements.
 */

import { describe, it, expect } from 'vitest';
import { normalizeSuggestionTitle, truncateTitleSmart } from './title-normalization';

describe('Title normalization - User requirements', () => {
  describe('Hedge prefix removal', () => {
    it('should remove "Maybe we could"', () => {
      const input = 'Maybe we could launch X';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Launch X');
    });

    it('should remove "We should consider"', () => {
      const input = 'We should consider launching X';
      const result = normalizeSuggestionTitle(input);
      // "launching" is a gerund, preserve it
      expect(result).toBe('Launching X');
    });

    it('should remove "We should explore"', () => {
      const input = 'We should explore X';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Evaluate X');
    });

    it('should remove "Consider"', () => {
      const input = 'Consider adding Y';
      const result = normalizeSuggestionTitle(input);
      // "adding" is gerund, preserve it
      expect(result).toBe('Adding Y');
    });

    it('should remove "Explore"', () => {
      const input = 'Explore new feature';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Evaluate new feature');
    });

    it('should remove "Suggestion:"', () => {
      const input = 'Suggestion: Add X';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Add X');
    });

    it('should remove "There is an indirect request for"', () => {
      const input = 'There is an indirect request for more Templates for customer workflows';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Add more Templates for customer workflows');
    });

    it('should remove "There is a request to"', () => {
      const input = 'There is a request to add feature X';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Add feature X');
    });

    it('should remove "Request to"', () => {
      const input = 'Request to implement Y';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Implement Y');
    });
  });

  describe('Action verb preservation', () => {
    it('should preserve "Launch" when present', () => {
      const input = 'Maybe we could launch X';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Launch X');
      expect(result).toMatch(/^Launch/);
    });

    it('should preserve strong verbs: add|build|create|enable|launch|evaluate|investigate|improve|reduce|transition', () => {
      const verbs = ['add', 'build', 'create', 'enable', 'launch', 'evaluate', 'investigate', 'improve', 'reduce', 'transition'];

      for (const verb of verbs) {
        const input = `${verb.charAt(0).toUpperCase()}${verb.slice(1)} feature X`;
        const result = normalizeSuggestionTitle(input);
        expect(result).toMatch(new RegExp(`^${verb}`, 'i'));
      }
    });
  });

  describe('Hedge opener mapping', () => {
    it('should map "We should explore X" to "Evaluate X"', () => {
      const input = 'We should explore new authentication methods';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Evaluate new authentication methods');
    });

    it('should map "We should consider X" with UI noun to "Add X"', () => {
      const input = 'We should consider a Checklist UI for task management';
      const result = normalizeSuggestionTitle(input);
      expect(result).toMatch(/^Add/);
      expect(result).toContain('Checklist UI');
    });

    it('should map "We should consider X" with template to "Add X"', () => {
      const input = 'We should consider templates for onboarding';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Add templates for onboarding');
    });

    it('should map "We should consider X" with integration to "Add X"', () => {
      const input = 'We should consider integration with payment gateway';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Add integration with payment gateway');
    });

    it('should map "We should consider X" with dashboard to "Add X"', () => {
      const input = 'We should consider dashboard for analytics';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Add dashboard for analytics');
    });

    it('should map "We should consider X" with report to "Add X"', () => {
      const input = 'We should consider report generation feature';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Add report generation feature');
    });

    it('should map "There is an indirect request for more Templates" to "Add templates for"', () => {
      const input = 'There is an indirect request for more Templates for workflow automation';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Add more Templates for workflow automation');
    });
  });

  describe('No blind "Implement" prefix', () => {
    it('should NOT add "Implement" to titles that already start with strong verbs', () => {
      const strongVerbs = ['Add', 'Build', 'Create', 'Enable', 'Launch', 'Evaluate', 'Investigate', 'Improve', 'Reduce', 'Transition'];

      for (const verb of strongVerbs) {
        const input = `${verb} feature X`;
        const result = normalizeSuggestionTitle(input);
        expect(result).toBe(`${verb} feature X`);
        expect(result).not.toMatch(/^Implement/);
      }
    });

    it('should NOT prefix "Implement" to titles with action verbs', () => {
      const input = 'Launch a 5-minute weekly email summary';
      const result = normalizeSuggestionTitle(input);
      expect(result).toBe('Launch a 5-minute weekly email summary');
      expect(result).not.toContain('Implement Launch');
    });
  });

  describe('Artifact suppression', () => {
    it('should not contain "Implement Maybe we could"', () => {
      const inputs = [
        'Implement Maybe we could add feature X',
        'Implement maybe we could launch Y',
      ];

      for (const input of inputs) {
        const result = normalizeSuggestionTitle(input);
        expect(result).not.toContain('Maybe we could');
        expect(result).not.toContain('Implement Maybe');
        expect(result).not.toMatch(/^Implement Maybe/i);
      }
    });

    it('should not contain "Implement consider"', () => {
      const input = 'Implement consider adding templates';
      const result = normalizeSuggestionTitle(input);
      expect(result).not.toContain('consider');
      expect(result).not.toMatch(/^Implement consider/i);
    });

    it('should not contain "for more" at the start', () => {
      const input = 'There is an indirect request for more templates';
      const result = normalizeSuggestionTitle(input);
      expect(result).not.toMatch(/^for more/i);
      expect(result).toMatch(/^Add more/i);
    });
  });
});

describe('Smart truncation - User requirements', () => {
  it('should truncate at clause/punctuation/word boundary', () => {
    const input = 'Add comprehensive authentication system, improve security measures, and enable two-factor authentication for all users';
    const result = truncateTitleSmart(input, 60);

    expect(result).toContain('...');
    expect(result.length).toBeLessThanOrEqual(60);

    // Should break at clause boundary (comma)
    expect(result).toMatch(/^Add comprehensive authentication system\.\.\.$/);
  });

  it('should add ellipsis when truncated', () => {
    const input = 'A'.repeat(100);
    const result = truncateTitleSmart(input, 50);

    expect(result).toContain('...');
    expect(result.length).toBeLessThanOrEqual(50);
  });

  it('should not cut mid-word', () => {
    const input = 'Add authentication functionality to the platform';
    const result = truncateTitleSmart(input, 30);

    const withoutEllipsis = result.replace('...', '').trim();
    const words = withoutEllipsis.split(' ');

    // Every word should be complete
    for (const word of words) {
      expect(word).toMatch(/^[a-zA-Z]+$/);
    }
  });

  it('should handle before/after examples', () => {
    // Before: "Implement Maybe we could launch a 5-minute weekly email summary"
    // After: "Launch a 5-minute weekly email summary"
    const before = 'Implement Maybe we could launch a 5-minute weekly email summary of team updates';
    const normalized = normalizeSuggestionTitle(before);

    expect(normalized).toBe('Launch a 5-minute weekly email summary of team updates');

    // If we need to truncate at 50 chars
    const truncated = truncateTitleSmart(normalized, 50);
    expect(truncated.length).toBeLessThanOrEqual(50);
    if (truncated !== normalized) {
      expect(truncated).toContain('...');
    }
  });
});
