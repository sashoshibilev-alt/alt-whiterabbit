/**
 * Generalized Explicit Asks - Heading-Agnostic B-lite Detection
 *
 * Tests that explicit request language produces idea-type suggestions
 * regardless of section heading, not only under "Discussion details".
 * B-lite fires as a fallback when normal synthesis fails to produce a candidate.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateSuggestions,
  NoteInput,
  DEFAULT_CONFIG,
} from './index';
import { resetSectionCounter } from './preprocessing';
import { resetSuggestionCounter } from './synthesis';

describe('Generalized Explicit Asks (heading-agnostic B-lite)', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it('should emit idea for "we should" language under non-Discussion heading', () => {
    const note: NoteInput = {
      note_id: 'test-strategic-alignment-heading',
      raw_markdown: `# Q2 Planning

## Strategic Alignment

We should build a partner API so third-party integrators can extend the platform without custom work.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should produce at least 1 suggestion from this section
    const suggestion = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('strategic')
    );
    expect(suggestion).toBeDefined();

    if (suggestion) {
      // Must be type idea (not project_update)
      expect(suggestion.type).toBe('idea');
    }
  });

  it('should emit idea for "suggestion:" language under "Key Takeaways" heading', () => {
    const note: NoteInput = {
      note_id: 'test-key-takeaways-heading',
      raw_markdown: `# Retrospective

## Key Takeaways

Suggestion: add automated regression tests to the CI pipeline before each release to catch breaking changes earlier.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    const suggestion = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('takeaway')
    );
    expect(suggestion).toBeDefined();

    if (suggestion) {
      expect(suggestion.type).toBe('idea');
    }
  });

  it('should emit idea for "requires us to" under "Infrastructure" heading', () => {
    const note: NoteInput = {
      note_id: 'test-infrastructure-heading',
      raw_markdown: `# Ops Review

## Infrastructure

Scaling to 10k concurrent users requires us to migrate the database to a horizontally sharded architecture.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    const suggestion = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('infrastructure')
    );
    expect(suggestion).toBeDefined();

    if (suggestion) {
      expect(suggestion.type).toBe('idea');
    }
  });

  it('should emit idea for "maybe we could" under non-Discussion heading', () => {
    const note: NoteInput = {
      note_id: 'test-maybe-we-could',
      raw_markdown: `# Engineering Sync

## Feature Ideas

Maybe we could add a keyboard shortcut system so power users can navigate faster without touching the mouse.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    const suggestion = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('feature')
    );
    expect(suggestion).toBeDefined();

    if (suggestion) {
      expect(suggestion.type).toBe('idea');
    }
  });

  it('should NOT trigger B-lite for purely informational section without explicit asks', () => {
    const note: NoteInput = {
      note_id: 'test-informational-no-false-positive',
      raw_markdown: `# Status Update

## Regional Expansion

The APAC launch completed on schedule last Tuesday.
Customer onboarding metrics are tracking above forecast.
The localization team finished all translations for the Japanese market.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should NOT produce an explicit_ask suggestion
    const explicitAskSuggestion = result.suggestions.find(s =>
      s.structural_hint === 'explicit_ask'
    );
    expect(explicitAskSuggestion).toBeUndefined();
  });
});
