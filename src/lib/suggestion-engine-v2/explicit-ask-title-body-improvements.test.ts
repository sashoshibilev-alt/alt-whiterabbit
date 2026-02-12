/**
 * Test cases for explicit-ask title/body improvements
 *
 * These tests verify that explicit-ask synthesis:
 * 1. Generates imperative titles (not heading-derived)
 * 2. Generates concise bodies (1-2 sentences max)
 * 3. Anchors on the ask sentence, not unrelated content
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateSuggestions,
  NoteInput,
  DEFAULT_CONFIG,
} from './index';
import { resetSectionCounter } from './preprocessing';
import { resetSuggestionCounter } from './synthesis';

describe('Explicit-ask title/body improvements', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it('should convert "we should explore" to imperative form', () => {
    const note: NoteInput = {
      note_id: 'test-imperative-explore',
      raw_markdown: `# Engineering Sync

## Deployment Velocity

We should explore automated canary deployments to reduce rollback time and improve release confidence.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    const suggestion = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('deployment')
    );

    expect(suggestion).toBeDefined();

    if (suggestion) {
      const title = suggestion.title.toLowerCase();

      // Should be imperative form starting with "explore"
      expect(title).toMatch(/^explore/);

      // Should include core subject matter
      expect(title).toContain('canary');
      expect(title).toContain('deployment');

      // Should be concise (max 12 words per requirements)
      const wordCount = title.split(/\s+/).length;
      expect(wordCount).toBeLessThanOrEqual(12);
    }
  });

  it('should convert "users need better" to "Improve"', () => {
    const note: NoteInput = {
      note_id: 'test-need-better',
      raw_markdown: `# Product Meeting

## Feature Requests

Users need better audit logging for compliance tracking.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    const suggestion = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('feature')
    );

    expect(suggestion).toBeDefined();

    if (suggestion) {
      const title = suggestion.title.toLowerCase();

      // Should convert to imperative: "Improve audit logging"
      expect(title).toMatch(/^improve/);
      expect(title).toContain('audit logging');
    }
  });

  it('should convert "request to add" to imperative form', () => {
    const note: NoteInput = {
      note_id: 'test-request-to-add',
      raw_markdown: `# Sprint Planning

## Discussion Details

There is a request to add audit logging to the admin panel for compliance tracking.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    const suggestion = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('discussion')
    );

    expect(suggestion).toBeDefined();

    if (suggestion) {
      const title = suggestion.title.toLowerCase();

      // Should be imperative: "Add audit logging to the admin panel"
      expect(title).toMatch(/^add/);
      expect(title).toContain('audit logging');
      expect(title).toContain('admin panel');
    }
  });

  it('should generate concise body focused on the ask', () => {
    const note: NoteInput = {
      note_id: 'test-concise-body',
      raw_markdown: `# Engineering Review

## Performance

We need to improve search response time to under 100ms for the product catalog.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    const suggestion = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('performance')
    );

    expect(suggestion).toBeDefined();

    if (suggestion) {
      const body = suggestion.suggestion?.body || '';

      // Body should include the core ask
      expect(body.toLowerCase()).toMatch(/search.*response.*time|improve.*search/);

      // Body should be concise (1-2 sentences max)
      const sentenceCount = body.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
      expect(sentenceCount).toBeLessThanOrEqual(2);

      // Should include the constraint if explicitly stated
      expect(body).toContain('100ms');
    }
  });

  it('should anchor on "Add offline mode" proposal line', () => {
    const note: NoteInput = {
      note_id: 'test-add-offline-mode',
      raw_markdown: `# Feature Requests

## Mobile App

Add offline mode for mobile to improve user experience in low-connectivity areas.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    const suggestion = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('mobile')
    );

    expect(suggestion).toBeDefined();

    if (suggestion) {
      const title = suggestion.title.toLowerCase();

      // Should anchor on the "Add" proposal line, not fall back to heading
      expect(title).toMatch(/^add/);
      expect(title).toContain('offline mode');
      expect(title).toContain('mobile');

      // Should not be heading-derived
      expect(title).not.toMatch(/^new idea:/);
    }
  });

  it('should prioritize "Add" line over other lines in multi-line section', () => {
    const note: NoteInput = {
      note_id: 'test-add-priority',
      raw_markdown: `# Engineering Discussion

## Backend Services

Current system has performance bottlenecks during peak load.
Add supplier segmentation filters to reduce query complexity.
This will improve response times for large catalogs.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    const suggestion = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('backend')
    );

    expect(suggestion).toBeDefined();

    if (suggestion) {
      const title = suggestion.title.toLowerCase();

      // Should anchor on the "Add supplier segmentation" proposal line
      expect(title).toMatch(/^add/);
      expect(title).toContain('supplier segmentation');
      expect(title).toContain('filter');

      // Should NOT anchor on "Current system has..." or "This will improve..."
      expect(title).not.toContain('performance bottleneck');
      expect(title).not.toContain('response time');
      expect(title).not.toMatch(/^improve/);
    }
  });
});
