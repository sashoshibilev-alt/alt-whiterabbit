/**
 * Integration test to verify suggestion context flows through the system
 */

import { describe, it, expect } from 'vitest';
import { generateSuggestions, adaptConvexNote, type NoteInput } from './suggestion-engine-v2';

describe('Suggestion Context Integration', () => {
  it('should include suggestion context in generated suggestions', () => {
    const note: NoteInput = {
      note_id: 'test-context-flow',
      raw_markdown: `# Product Updates

## Mobile App Redesign

We're shifting focus to improve the onboarding flow because user drop-off is too high.

- Simplify signup process
- Add tutorial walkthrough
- Target launch: Q2 2024
`,
    };

    const result = generateSuggestions(note);

    // Should emit at least one suggestion
    expect(result.suggestions.length).toBeGreaterThan(0);

    const suggestion = result.suggestions[0];

    // Verify suggestion context exists and is properly shaped
    expect(suggestion.suggestion).toBeDefined();
    expect(suggestion.suggestion?.title).toBeDefined();
    expect(suggestion.suggestion?.body).toBeDefined();
    expect(suggestion.suggestion?.sourceSectionId).toBeDefined();
    expect(suggestion.suggestion?.sourceHeading).toBeDefined();

    // Verify body is standalone and reasonably sized
    const body = suggestion.suggestion?.body || '';
    expect(body.length).toBeGreaterThan(10);
    expect(body.length).toBeLessThanOrEqual(300);

    // Verify title matches the suggestion type
    expect(suggestion.suggestion?.title).toContain(suggestion.type === 'idea' ? 'idea' : 'Update');
  });

  it('should include evidencePreview when evidence exists', () => {
    const note: NoteInput = {
      note_id: 'test-evidence-flow',
      raw_markdown: `# Sprint Planning

## API Performance

Optimize database queries to reduce API response time from 500ms to 100ms.

- Index frequently queried fields
- Implement query caching
- Add monitoring alerts
`,
    };

    const result = generateSuggestions(note);

    if (result.suggestions.length > 0) {
      const suggestion = result.suggestions[0];

      // Evidence preview should exist
      expect(suggestion.suggestion?.evidencePreview).toBeDefined();

      if (suggestion.suggestion?.evidencePreview) {
        expect(suggestion.suggestion.evidencePreview.length).toBeGreaterThan(0);
        expect(suggestion.suggestion.evidencePreview.length).toBeLessThanOrEqual(2);

        // Each preview should be a reasonable length
        for (const preview of suggestion.suggestion.evidencePreview) {
          expect(preview.length).toBeGreaterThan(10);
          expect(preview.length).toBeLessThanOrEqual(150);
        }
      }
    }
  });

  it('should work with convex note adapter', () => {
    const convexNote = {
      _id: 'test-convex-id',
      body: `# Feature Request

## Dark Mode Support

Add dark mode toggle to settings because many users work late at night.

- Theme switcher in preferences
- System default detection
- Save user preference
`,
      createdAt: Date.now(),
      title: 'Feature Request Note',
    };

    const engineNote = adaptConvexNote(convexNote);
    const result = generateSuggestions(engineNote);

    if (result.suggestions.length > 0) {
      const suggestion = result.suggestions[0];

      // Verify all context fields are present and valid
      expect(suggestion.suggestion).toMatchObject({
        title: expect.any(String),
        body: expect.any(String),
        sourceSectionId: expect.any(String),
        sourceHeading: expect.any(String),
      });
    }
  });
});
