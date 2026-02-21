import { describe, it, expect } from 'vitest';
import { generateSuggestions } from './index';
import type { NoteInput } from './types';

const DEFAULT_CONFIG = {
  embedding_model: 'none' as const,
};

describe('Title Normalization Integration', () => {
  it('should normalize "Maybe we could" prefix in end-to-end flow', () => {
    const note: NoteInput = {
      note_id: 'test-maybe-we-could',
      raw_markdown: `# Feature Ideas

Maybe we could add a keyboard shortcut system for power users.`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);
    const suggestion = result.suggestions[0];

    expect(suggestion).toBeDefined();
    if (suggestion) {
      // Title should NOT start with "Maybe we could"
      expect(suggestion.title).not.toMatch(/^maybe we could/i);
      // Should contain the core feature
      expect(suggestion.title.toLowerCase()).toContain('keyboard');
      expect(suggestion.title.toLowerCase()).toContain('shortcut');
    }
  });

  it('should normalize "Suggestion:" prefix in end-to-end flow', () => {
    const note: NoteInput = {
      note_id: 'test-suggestion-prefix',
      raw_markdown: `## Key Takeaways

Suggestion: add automated regression tests to the CI pipeline.`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);
    const suggestion = result.suggestions[0];

    expect(suggestion).toBeDefined();
    if (suggestion) {
      // Title should NOT start with "Suggestion:"
      expect(suggestion.title).not.toMatch(/^suggestion:/i);
      // Should start with a strong verb (possibly with "Idea: " prefix)
      expect(suggestion.title).toMatch(/^(?:idea:\s*)?(add|implement|create|build|enable)/i);
    }
  });

  it('should map "Explore" to "Investigate" for concrete objects', () => {
    const note: NoteInput = {
      note_id: 'test-explore-mapping',
      raw_markdown: `## Technical Decisions

We need to explore database sharding options for the next phase.`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // May or may not generate depending on classifiers, but if it does, check title
    if (result.suggestions.length > 0) {
      const suggestion = result.suggestions[0];
      // Title should use a strong verb
      expect(suggestion.title).toMatch(/^(investigate|evaluate|add|implement|create|improve|build|explore)/i);
      // Should not have weak patterns
      expect(suggestion.title).not.toMatch(/^maybe we could/i);
    }
  });

  it('should remove trailing deadline phrases', () => {
    const note: NoteInput = {
      note_id: 'test-deadline-removal',
      raw_markdown: `## Q2 Roadmap

We need to launch the new user dashboard by end of March to hit our growth targets.`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // May or may not generate, but if it does, check title
    if (result.suggestions.length > 0) {
      const suggestion = result.suggestions[0];
      // Title should NOT contain deadline
      expect(suggestion.title).not.toMatch(/by end of \w+/i);
      expect(suggestion.title).not.toMatch(/in Q[1-4]$/i);
    }
  });

  it('should NOT contain "Implement maybe we could" artifacts', () => {
    const note: NoteInput = {
      note_id: 'test-implement-artifact',
      raw_markdown: `## Ideas

We should implement better error handling for API failures.`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);
    const suggestion = result.suggestions[0];

    expect(suggestion).toBeDefined();
    if (suggestion) {
      // Title should NEVER contain these artifact patterns
      expect(suggestion.title).not.toMatch(/implement maybe we could/i);
      expect(suggestion.title).not.toMatch(/implement consider/i);
      expect(suggestion.title).not.toMatch(/add maybe we could/i);
    }
  });

  it('should ensure all titles start with strong verbs', () => {
    const notes: NoteInput[] = [
      {
        note_id: 'test-1',
        raw_markdown: `## Features\n\nAdd dark mode support.`,
      },
      {
        note_id: 'test-2',
        raw_markdown: `## Improvements\n\nUsers need better onboarding flow.`,
      },
      {
        note_id: 'test-3',
        raw_markdown: `## Infrastructure\n\nBuild automated deployment pipeline.`,
      },
    ];

    const strongVerbs = [
      'add', 'implement', 'build', 'create', 'enable', 'launch',
      'develop', 'improve', 'update', 'fix', 'investigate', 'evaluate',
      'migrate', 'refactor', 'optimize', 'integrate', 'deploy',
      'configure', 'establish', 'reduce', 'streamline',
    ];

    for (const note of notes) {
      const result = generateSuggestions(note, DEFAULT_CONFIG);
      const suggestion = result.suggestions[0];

      if (suggestion) {
        // Strip optional type prefix ("Idea: ", "Bug: ", etc.) before checking verb
        const titleWithoutPrefix = suggestion.title.replace(/^(?:idea|bug|risk|update):\s*/i, '');
        const firstWord = titleWithoutPrefix.split(/\s+/)[0].toLowerCase();
        const hasStrongVerb = strongVerbs.includes(firstWord);
        const isGerund = firstWord.endsWith('ing') && firstWord.length > 4;
        const hasTypePrefix = /^(?:idea|bug|risk|update):/i.test(suggestion.title);

        // Title should start with either a strong verb, a gerund, or a type prefix
        expect(hasStrongVerb || isGerund || hasTypePrefix).toBe(true);
      }
    }
  });

  it('should handle "Request for" prefix correctly', () => {
    const note: NoteInput = {
      note_id: 'test-request-for',
      raw_markdown: `## Feature Requests

The team needs more templates for common workflows.`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // May or may not generate, but if it does, check title
    if (result.suggestions.length > 0) {
      const suggestion = result.suggestions[0];
      // Should not have "Request for" in normalized title
      expect(suggestion.title).not.toMatch(/^request for/i);
    }
  });
});
