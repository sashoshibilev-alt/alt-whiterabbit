/**
 * Integration test for suggestionKey in the full pipeline
 */

import { describe, it, expect } from 'vitest';
import { generateSuggestions } from './suggestion-engine-v2';
import type { NoteInput } from './suggestion-engine-v2/types';

describe('suggestionKey integration', () => {
  it('should include suggestionKey in generated suggestions', () => {
    const note: NoteInput = {
      note_id: 'test-note-123',
      raw_markdown: `# Project Updates

- We need to pivot from mobile-first to web-first approach
- Timeline: Q1 2024
- Owner: Alex`,
    };

    const result = generateSuggestions(note);

    expect(result.suggestions.length).toBeGreaterThan(0);

    for (const suggestion of result.suggestions) {
      // Verify suggestionKey exists and is a hash (SHA1-based)
      expect(suggestion.suggestionKey).toBeDefined();
      expect(typeof suggestion.suggestionKey).toBe('string');
      expect(suggestion.suggestionKey.length).toBeGreaterThan(0);

      // New format is a hash, not colon-separated
      // Should not contain the raw noteId or title
      expect(suggestion.suggestionKey).not.toContain(suggestion.note_id);
      expect(suggestion.suggestionKey).not.toContain(suggestion.title);
    }
  });

  it('should produce same suggestionKey for equivalent titles', () => {
    const note1: NoteInput = {
      note_id: 'note-abc',
      raw_markdown: `# Updates

- Build User Dashboard!`,
    };

    const note2: NoteInput = {
      note_id: 'note-abc',
      raw_markdown: `# Updates

- Build   user  dashboard`,
    };

    const result1 = generateSuggestions(note1);
    const result2 = generateSuggestions(note2);

    if (result1.suggestions.length > 0 && result2.suggestions.length > 0) {
      // If both produce suggestions from the same section/type, keys should match
      const key1 = result1.suggestions[0].suggestionKey;
      const key2 = result2.suggestions[0].suggestionKey;

      // Since the titles normalize to the same value and it's the same note/section,
      // the SHA1 hash should be identical
      expect(key1).toBe(key2);
    }
  });

  it('should use suggestionKey for dedupe', () => {
    const note: NoteInput = {
      note_id: 'test-dedupe',
      raw_markdown: `# Project Updates

- Pivot to web-first approach
- Shift to web-first strategy

Both say the same thing but with different words in section heading.`,
    };

    const result = generateSuggestions(note);

    // Collect all suggestionKeys
    const keys = result.suggestions.map(s => s.suggestionKey);
    const uniqueKeys = new Set(keys);

    // All keys should be unique (dedupe should have removed duplicates)
    expect(keys.length).toBe(uniqueKeys.size);
  });
});
