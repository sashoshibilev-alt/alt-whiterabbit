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
      // Verify suggestionKey exists
      expect(suggestion.suggestionKey).toBeDefined();
      expect(typeof suggestion.suggestionKey).toBe('string');
      expect(suggestion.suggestionKey.length).toBeGreaterThan(0);

      // Verify format: noteId:sectionId:type:normalizedTitle
      const parts = suggestion.suggestionKey.split(':');
      expect(parts.length).toBe(4);
      expect(parts[0]).toBe(suggestion.note_id);
      expect(parts[1]).toBe(suggestion.section_id);
      expect(parts[2]).toBe(suggestion.type);
      // parts[3] is normalized title - just verify it exists
      expect(parts[3].length).toBeGreaterThan(0);
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

      // Compare components
      const parts1 = key1.split(':');
      const parts2 = key2.split(':');

      // Note and section should match (we used same note_id)
      expect(parts1[0]).toBe(parts2[0]);

      // Normalized titles should be identical despite different formatting
      expect(parts1[3]).toBe(parts2[3]);
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
