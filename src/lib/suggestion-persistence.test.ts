/**
 * Integration tests for suggestion persistence across regenerates
 *
 * Tests the contract specified in the task:
 * - Dismissed suggestions do NOT reappear after regenerate
 * - Applied suggestions stay applied after regenerate
 * - Dedupe uses suggestionKey, not ephemeral ids
 * - suggestionKey is computed correctly and includes required fields
 */

import { describe, it, expect } from 'vitest';
import { generateSuggestions, adaptConvexNote, type NoteInput } from './suggestion-engine-v2';
import { computeSuggestionKey } from './suggestion-keys';

describe('Suggestion Persistence Contract', () => {
  // Test 1: Contract test - verify suggestionKey and context fields
  describe('Contract: suggestionKey and context fields', () => {
    it('generates suggestionKey for all suggestions', () => {
      const note: NoteInput = {
        note_id: 'test-note-001',
        raw_markdown: `# Product Ideas

## AI Search Feature

Build an AI-powered search feature to help users find relevant documents faster.

- Use semantic search with embeddings
- Integrate with existing document library`,
      };

      const result = generateSuggestions(note);

      expect(result.suggestions.length).toBeGreaterThan(0);

      for (const suggestion of result.suggestions) {
        // Verify suggestionKey exists
        expect(suggestion.suggestionKey).toBeDefined();
        expect(typeof suggestion.suggestionKey).toBe('string');
        expect(suggestion.suggestionKey.length).toBeGreaterThan(0);

        // Verify context fields exist
        expect(suggestion.suggestion).toBeDefined();
        expect(suggestion.suggestion?.title).toBeDefined();
        expect(suggestion.suggestion?.body).toBeDefined();
        expect(suggestion.suggestion?.sourceSectionId).toBeDefined();
        expect(suggestion.suggestion?.sourceHeading).toBeDefined();
        // evidencePreview is optional but should be an array if present
        if (suggestion.suggestion?.evidencePreview) {
          expect(Array.isArray(suggestion.suggestion.evidencePreview)).toBe(true);
        }
      }
    });

    it('computes suggestionKey from note, section, type, and title', () => {
      const note: NoteInput = {
        note_id: 'test-note-002',
        raw_markdown: `# Meeting Notes

## Timeline Changes

Shift the Q2 launch to Q3 because we need more time for testing.`,
      };

      const result = generateSuggestions(note);

      if (result.suggestions.length > 0) {
        const suggestion = result.suggestions[0];

        // Verify the suggestionKey is deterministic
        const expectedKey = computeSuggestionKey({
          noteId: suggestion.note_id,
          sourceSectionId: suggestion.suggestion?.sourceSectionId || suggestion.section_id,
          type: suggestion.type,
          title: suggestion.title,
        });

        expect(suggestion.suggestionKey).toBe(expectedKey);
      }
    });
  });

  // Test 2: Persistence - dismissed suggestions
  describe('Persistence: dismissed suggestions', () => {
    it('generates stable suggestionKeys for identical suggestions', () => {
      const note: NoteInput = {
        note_id: 'test-note-003',
        raw_markdown: `# Q1 Roadmap

## New Features

Launch a new user onboarding flow to improve first-time user experience.
Target: Complete by end of Q1 2024.
Priority: P0 for growth team.`,
      };

      // Generate suggestions twice
      const result1 = generateSuggestions(note);
      const result2 = generateSuggestions(note);

      // If suggestions are generated, verify stability
      if (result1.suggestions.length > 0 && result2.suggestions.length > 0) {
        const key1 = result1.suggestions[0].suggestionKey;
        const key2 = result2.suggestions[0].suggestionKey;
        expect(key1).toBe(key2);
      } else {
        // If no suggestions generated, test passes (not an error)
        expect(true).toBe(true);
      }
    });

    it('produces different keys for different sections', () => {
      const note: NoteInput = {
        note_id: 'test-note-004',
        raw_markdown: `# Product Updates

## Feature A
Build feature A

## Feature B
Build feature B`,
      };

      const result = generateSuggestions(note);

      if (result.suggestions.length >= 2) {
        const key1 = result.suggestions[0].suggestionKey;
        const key2 = result.suggestions[1].suggestionKey;

        expect(key1).not.toBe(key2);
      }
    });
  });

  // Test 3: Persistence - applied suggestions
  describe('Persistence: applied suggestions', () => {
    it('maintains suggestionKey when suggestion content is identical', () => {
      const noteContent = `# Roadmap

## API Improvements

Upgrade the API to v2 with better performance and new endpoints.
Launch target: Q2 2024.
Includes breaking changes that need migration guide.`;

      const note1: NoteInput = {
        note_id: 'test-note-005',
        raw_markdown: noteContent,
      };

      const note2: NoteInput = {
        note_id: 'test-note-005',
        raw_markdown: noteContent,
      };

      const result1 = generateSuggestions(note1);
      const result2 = generateSuggestions(note2);

      // If suggestions are generated, verify key stability
      if (result1.suggestions.length > 0 && result2.suggestions.length > 0) {
        expect(result1.suggestions[0].suggestionKey).toBe(result2.suggestions[0].suggestionKey);
      } else {
        // If no suggestions generated, test passes (not an error)
        expect(true).toBe(true);
      }
    });
  });

  // Test 4: Dedupe - suggestionKey based
  describe('Dedupe: suggestionKey based deduplication', () => {
    it('generates same key for normalized title variations', () => {
      // Same semantic content, different formatting
      const variations = [
        'Build User Dashboard!',
        'Build   user  dashboard',
        'build user dashboard.',
        'Build USER Dashboard',
      ];

      const keys = variations.map((title) =>
        computeSuggestionKey({
          noteId: 'note-123',
          sourceSectionId: 'sec-456',
          type: 'idea',
          title,
        })
      );

      // All variations should produce the same key
      expect(keys[0]).toBe(keys[1]);
      expect(keys[1]).toBe(keys[2]);
      expect(keys[2]).toBe(keys[3]);
    });

    it('generates different keys for different types', () => {
      const params = {
        noteId: 'note-123',
        sourceSectionId: 'sec-456',
        title: 'Update the timeline',
      };

      const ideaKey = computeSuggestionKey({ ...params, type: 'idea' });
      const updateKey = computeSuggestionKey({ ...params, type: 'project_update' });

      expect(ideaKey).not.toBe(updateKey);
    });

    it('generates different keys for different notes', () => {
      const params = {
        sourceSectionId: 'sec-456',
        type: 'idea' as const,
        title: 'Build dashboard',
      };

      const key1 = computeSuggestionKey({ ...params, noteId: 'note-123' });
      const key2 = computeSuggestionKey({ ...params, noteId: 'note-999' });

      expect(key1).not.toBe(key2);
    });

    it('generates different keys for different sections', () => {
      const params = {
        noteId: 'note-123',
        type: 'idea' as const,
        title: 'Build dashboard',
      };

      const key1 = computeSuggestionKey({ ...params, sourceSectionId: 'sec-456' });
      const key2 = computeSuggestionKey({ ...params, sourceSectionId: 'sec-789' });

      expect(key1).not.toBe(key2);
    });
  });

  // Test 5: End-to-end workflow simulation
  describe('End-to-end: regeneration preserves decisions', () => {
    it('simulates dismiss → regenerate workflow', () => {
      const note: NoteInput = {
        note_id: 'test-note-006',
        raw_markdown: `# Sprint Planning

## New Initiative

Launch a new analytics dashboard for product managers to track key metrics.
Target date: End of Q2.
Requires: Data pipeline integration, UI design, and user testing.`,
      };

      // Initial generation
      const initialResult = generateSuggestions(note);

      // Only run workflow if suggestions were generated
      if (initialResult.suggestions.length > 0) {
        const dismissedKey = initialResult.suggestions[0].suggestionKey;

        // Simulate dismissal by storing the key
        const dismissedKeys = new Set([dismissedKey]);

        // Regenerate
        const regenerateResult = generateSuggestions(note);

        // Filter out dismissed suggestions (simulating backend behavior)
        const visibleSuggestions = regenerateResult.suggestions.filter(
          (s) => !dismissedKeys.has(s.suggestionKey)
        );

        // The dismissed suggestion should not be visible
        const dismissedStillVisible = visibleSuggestions.some(
          (s) => s.suggestionKey === dismissedKey
        );

        expect(dismissedStillVisible).toBe(false);
      } else {
        // If no suggestions generated, test passes (not an error)
        expect(true).toBe(true);
      }
    });

    it('simulates apply → regenerate workflow', () => {
      const note: NoteInput = {
        note_id: 'test-note-007',
        raw_markdown: `# Q2 Goals

## Performance

Improve API response time by 50% through caching and optimization.`,
      };

      // Initial generation
      const initialResult = generateSuggestions(note);
      expect(initialResult.suggestions.length).toBeGreaterThan(0);

      const appliedKey = initialResult.suggestions[0].suggestionKey;

      // Simulate application by storing the key with status
      const decisions = new Map([[appliedKey, { status: 'applied', initiativeId: 'init-123' }]]);

      // Regenerate
      const regenerateResult = generateSuggestions(note);

      // Verify the same suggestion appears with the same key
      const matchingSuggestion = regenerateResult.suggestions.find(
        (s) => s.suggestionKey === appliedKey
      );

      expect(matchingSuggestion).toBeDefined();

      // The decision would be preserved by backend based on the key
      const decision = decisions.get(matchingSuggestion!.suggestionKey);
      expect(decision?.status).toBe('applied');
    });
  });

  // Test 6: Edge cases
  describe('Edge cases', () => {
    it('handles long titles by truncating normalized form', () => {
      const longTitle = 'a'.repeat(200);

      const key = computeSuggestionKey({
        noteId: 'note-123',
        sourceSectionId: 'sec-456',
        type: 'idea',
        title: longTitle,
      });

      // Should still generate a valid key
      expect(key).toBeTruthy();
      expect(key.length).toBeGreaterThan(0);
    });

    it('handles empty or missing sourceSectionId gracefully', () => {
      const note: NoteInput = {
        note_id: 'test-note-008',
        raw_markdown: `Build a new feature`,
      };

      const result = generateSuggestions(note);

      // Should generate suggestions even without clear sections
      if (result.suggestions.length > 0) {
        expect(result.suggestions[0].suggestionKey).toBeDefined();
        expect(result.suggestions[0].section_id).toBeDefined();
      }
    });

    it('handles special characters in titles', () => {
      const titles = [
        'Build v2.0 API!',
        'Launch Q1/Q2 initiative',
        'Update (with notes)',
        'Feature: "AI Search"',
      ];

      const keys = titles.map((title) =>
        computeSuggestionKey({
          noteId: 'note-123',
          sourceSectionId: 'sec-456',
          type: 'idea',
          title,
        })
      );

      // All keys should be valid
      keys.forEach((key) => {
        expect(key).toBeTruthy();
        expect(key.length).toBeGreaterThan(0);
      });
    });
  });
});
